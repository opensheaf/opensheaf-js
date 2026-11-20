// Generated from literate/30-collections.md by opensheaf-literate: edit the document, not this file.
import { Http } from './http.js';
import { Archive } from './archive.js';
import { Resolver, MEMBER_STATUS } from './resolve.js';
import { parseSheaf, objectId, LABEL } from './names.js';
import { historyOf, currentVersion, dateOf, memberPins } from './versions.js';
import { same } from './schema.js';
import { storageFetch, compareText, ORIGIN } from './storage.js';
import { jsonBytes } from './write.js';
import { writeDiscovery } from './discovery.js';
import { OBJ, OBJ_FORMAT, GENESIS, SPEC, exit, plural } from './folder.js';
import { displayName, landingUrl, RIGHTS } from './deposit.js';
import { memberOrder } from './collect.js';
import { lineOf } from './describe.js';
import { parseData } from './inputs.js';

export const KINDS = ['catalogue', 'selection'];
export const ORDERS = ['manual', 'issued-desc', 'issued-asc'];
export const FORMAT = 'opensheaf-collection/0.2';

export async function openResolver(f) {
  const base = ORIGIN;
  const http = new Http({ fetch: storageFetch(f.storage, base, { fallback: f.env.fetch }), budget: null });
  const home = await Archive.open(http, base);
  return new Resolver(http, home, { local: true });
}

const objOf = (c) => (v) => c.line.objs.get(v) ?? null;

async function copyJson(c, logical, ver) {
  try {
    return await c.archive.json(c.id, c.line.inv, ver, logical);
  } catch {
    return null;
  }
}

function historyOrder(c) {
  if (!c.latestSigned) return [];
  return historyOf(c.line.inv, objOf(c), `v${c.latestSigned}`).map((h) => objOf(c)(h)?.documentVersion);
}

export async function cite(c, k) {
  const dc = (await copyJson(c, 'datacite.json', currentVersion(c.line.inv, objOf(c), `v${k}`))) || {};
  const out = { title: (dc.titles || [{}])[0]?.title ?? '', creators: (dc.creators || []).map(displayName) };
  if (Number.isInteger(dc.publicationYear)) out.year = dc.publicationYear;
  if (dateOf(dc, 'Issued')) out.issued = dateOf(dc, 'Issued');
  return out;
}

export async function revision(c, k) {
  const obj = objOf(c)(`v${k}`);
  const dc = (await copyJson(c, 'datacite.json', `v${k}`)) || {};
  const out = { documentVersion: obj.documentVersion, version: `v${k}`, inventorySha512: c.digest(k) };
  if (dc.doi) out.doi = dc.doi;
  return out;
}

export async function memberRecord(kind, c, k, name, owner, at, follow = false) {
  const obj = objOf(c)(`v${k}`);
  const dc = (await copyJson(c, 'datacite.json', `v${k}`)) || {};
  const m = { kind: obj.kind, name, owner, at: [...at] };
  if (kind === 'catalogue') {
    Object.assign(m, { version: `v${k}`, inventorySha512: c.digest(k) });
    if (follow) m.follow = 'latest';
  } else {
    m.revisions = [await revision(c, k)];
  }
  if (dc.doi && kind === 'catalogue') m.doi = dc.doi;
  m.cite = await cite(c, k);
  return m;
}

export function sortRevisions(revs, order) {
  const key = (x) => (order.includes(x.documentVersion) ? order.indexOf(x.documentVersion) : order.length + x.documentVersion);
  return [...revs].sort((a, b) => key(a) - key(b));
}

export async function target(f, r, text, where) {
  if (f.labels.has(text)) {
    const [, name, owner] = f.labels.get(text).split(':');
    return { name, owner, u: null, places: [] };
  }
  let u, name, owner;
  const places = [];
  try {
    u = parseSheaf(text, { short: true, fold: true });
    for (const w of [...(u.at ? [u.at] : []), ...where]) if (w && !places.includes(w)) places.push(w);
    [name, owner] = await r.expand(u, places);
  } catch (error) {
    exit(error.message);
  }
  return { name, owner, u, places };
}

export function recordedAt(f, r, found, places) {
  const out = places.filter((w) => typeof w === 'string' && w.startsWith('https://') && w.endsWith('/'));
  const c = found.copy;
  if (c && c.archive === r.home) out.push(f.archive.baseUrl);
  else if (c && c.where.startsWith('https://')) out.push(c.where);
  return [...new Set(out)];
}

export async function pinned(r, name, owner, u, places, kind, revisions = []) {
  let founds;
  if (u?.sha512) {
    founds = [(await r.resolve(String(u), places)).found];
  } else if (kind === 'selection' && revisions.length) {
    founds = [];
    for (const n of revisions) founds.push(await r.documentVersion(name, owner, n, places));
  } else {
    let found = await r.latest(name, owner, places);
    if (kind === 'selection' && found.copy) {
      const c = found.copy;
      const cur = currentVersion(c.line.inv, objOf(c), found.version);
      const k = Number(cur.slice(1));
      found = { ...found, status: MEMBER_STATUS[c.status(k)] || 'not a version', version: cur, digest: c.digest(k) };
    }
    founds = [found];
  }
  for (const fd of founds) {
    if (fd.status !== 'verified' || !fd.copy) {
      const notes = r.notes.map((n) => n.message).join('; ');
      exit(`sheaf:${name}:${owner}: ${fd.status}` + (notes ? ` (${notes})` : '') +
           ': a collection pins only verified versions (section 8.5)');
    }
  }
  return founds;
}

export function describeCollection(f, title, description, version, issued, members, label = null) {
  const cur = f.archive.curator;
  const creator = { name: cur.name, nameType: 'Personal', familyName: cur.familyName };
  if (cur.givenName) creator.givenName = cur.givenName;
  const dc = { titles: [{ title }], creators: [creator], publisher: { name: f.archive.name },
               publicationYear: Number(issued.slice(0, 4)), types: { resourceTypeGeneral: 'Collection' },
               version: String(version),
               dates: [{ date: issued, dateType: 'Issued' }, { date: f.env.today(), dateType: 'Available' }],
               rightsList: [{ ...RIGHTS['cc0-1.0'] }] };
  if (label) dc.url = landingUrl(f, label);
  if (description) dc.descriptions = [{ description, descriptionType: 'Abstract' }];
  const dois = [...members.filter((m) => m.doi).map((m) => m.doi),
                ...members.flatMap((m) => (m.revisions || []).filter((x) => x.doi).map((x) => x.doi))];
  if (dois.length) {
    dc.relatedIdentifiers = [...new Set(dois)].map((x) => ({ relatedIdentifier: x, relatedIdentifierType: 'DOI',
                                                              relationType: 'HasPart' }));
  }
  return dc;
}

export async function write(f, collId, mem, { message, title = null, description = null, owner = null, label = null }) {
  const dir = collId ? await f.dirOf(collId) : null;
  const inv = dir ? await f.inventory(dir) : null;
  mem = { ...mem };
  if ((mem.order ?? 'manual') !== 'manual') mem.members = memberOrder(mem.members, mem.order);
  let version = 1, issued = f.env.today(), genesis = null;
  if (inv) {
    const oldMem = await f.readObjectJson(dir, inv, 'members.json');
    const oldDc = (await f.readObjectJson(dir, inv, 'datacite.json')) || {};
    const oldTitle = (oldDc.titles || [{}])[0]?.title ?? null;
    const oldDesc = (oldDc.descriptions || []).find((x) => x.descriptionType === 'Abstract')?.description ?? null;
    title = title ?? oldTitle;
    description = description ?? oldDesc;
    version = (await f.readObjectJson(dir, inv, OBJ)).documentVersion;
    if (!same(oldMem, mem)) {
      version += 1;
    } else if (title === oldTitle && description === oldDesc) {
      f.env.out(`${f.labelOf(collId) || collId}: unchanged (${inv.head})`);
      return null;
    }
    issued = dateOf(oldDc, 'Issued') || f.env.today();
    genesis = await f.readLogical(dir, inv, GENESIS);
    owner = collId.split(':')[2];
  } else {
    ({ genesis, id: collId } = await f.seal('collection', owner));
  }
  label = label || f.labelOf(collId);
  const files = new Map([
    ['members.json', jsonBytes(mem)], [GENESIS, genesis],
    ['datacite.json', jsonBytes(describeCollection(f, title, description, version, issued, mem.members, label))],
  ]);
  const obj = { format: OBJ_FORMAT, specification: SPEC, kind: 'collection', name: collId.split(':')[1], owner,
                documentVersion: version, status: 'active' };
  if (label) f.labels.set(label, collId);
  const done = await f.addVersion(collId, files, obj, message);
  await writeDiscovery(f);
  const n = mem.members.length;
  f.env.out(`Done: the collection ${label || collId} is at ${done.head}, document version ${version}, with ` +
            `${n ? plural(n, 'member') : 'no members'}.`);
  return done;
}

export async function held(f, label) {
  const collId = await lineOf(f, label);
  const dir = await f.dirOf(collId);
  const inv = await f.inventory(dir);
  const head = (await f.readObjectJson(dir, inv, OBJ)) || {};
  if (head.kind !== 'collection') exit(`${label} is not a collection`);
  if (!f.archiveOwners().includes(head.owner)) exit(`${label} is a collection of an owner this archive does not host`);
  return { collId, dir, inv, mem: await f.readObjectJson(dir, inv, 'members.json') };
}

export async function newCollection(f, a) {
  if (f.labels.has(a.label) || !LABEL.test(a.label || '')) exit(`${a.label}: a new label of the form of section 3.1`);
  if (!KINDS.includes(a.type) || !a.title) exit('a new collection needs --type catalogue|selection and --title');
  const owner = a.owner || f.archive.owner;
  if (!f.archiveOwners().includes(owner)) exit(`${owner} is not an owner this archive hosts`);
  await f.initStorageRoot();
  const mem = { format: FORMAT, type: a.type, order: a.order || 'manual', members: [] };
  return write(f, null, mem, { message: `New ${a.type}: ${a.title}`, title: a.title,
                               description: a.description ?? null, owner, label: a.label });
}

export async function add(f, a) {
  const { collId, mem } = await held(f, a.collection);
  const kind = mem.type, changed = [];
  if (kind === 'catalogue' && a.revision?.length) {
    exit('--revision is for selections: a catalogue pins one version of each member');
  }
  const r = await openResolver(f);
  for (const text of a.uri) {
    const { name, owner, u, places } = await target(f, r, text, a.at || []);
    const founds = await pinned(r, name, owner, u, places, kind, a.revision || []);
    const at = recordedAt(f, r, founds[0], places);
    if (!at.length) exit(`${text}: no https base URL where copies are found: give --at URL (section 8.2)`);
    const c = founds[0].copy;
    let m = mem.members.find((x) => x.name === name && x.owner === owner) ?? null;
    if (m !== null && kind === 'catalogue') exit(`${text} is a member already (osheaf collection follow, or update)`);
    let rest = founds;
    if (m === null) {
      m = await memberRecord(kind, c, Number(founds[0].version.slice(1)), name, owner, at, a.follow);
      mem.members.push(m);
      rest = founds.slice(1);
    }
    if (kind === 'selection') {
      for (const fd of rest) {
        const rev = await revision(fd.copy, Number(fd.version.slice(1)));
        if (m.revisions.every((x) => x.documentVersion !== rev.documentVersion)) m.revisions.push(rev);
      }
      m.revisions = sortRevisions(m.revisions, historyOrder(c));
    }
    changed.push(`sheaf:${name}:${owner}`);
  }
  return write(f, collId, mem, { message: a.message || `Added: ${changed.join(', ')}` });
}

export function matches(f, m, text) {
  if (f.labels.has(text)) return f.labels.get(text) === objectId(m.name, m.owner);
  let u;
  try {
    u = parseSheaf(text, { short: true, fold: true });
  } catch {
    return m.name.startsWith(text);
  }
  return u.matches(m.name, m.owner);
}

export async function remove(f, a) {
  const { collId, mem } = await held(f, a.collection);
  const out = [];
  for (const m of mem.members) {
    if (!a.uri.some((t) => matches(f, m, t))) {
      out.push(m);
    } else if (a.revision?.length && m.revisions?.length) {
      m.revisions = m.revisions.filter((x) => !a.revision.includes(x.documentVersion));
      if (m.revisions.length) out.push(m);
    }
  }
  if (same(out, mem.members) && out.length === mem.members.length) exit('no member matches');
  mem.members = out;
  return write(f, collId, mem, { message: a.message || `Removed: ${a.uri.join(', ')}` });
}

export async function follow(f, a) {
  const { collId, mem } = await held(f, a.collection);
  if (mem.type !== 'catalogue') exit('only the members of a catalogue follow their lines (section 8.3)');
  const found = mem.members.filter((m) => a.uri.some((t) => matches(f, m, t)));
  if (!found.length) exit('no member matches');
  for (const m of found) {
    if (a.off) delete m.follow;
    else m.follow = 'latest';
  }
  return write(f, collId, mem, { message: a.message || (a.off ? 'Not followed: ' : 'Followed: ') + a.uri.join(', ') });
}

async function readFile(given) {
  try {
    const st = await fs.stat(given);
    if (!st.isFile()) throw new Error();
  } catch {
    throw new Stop(`no file ${given}`);
  }
  return { name: path.basename(given), bytes: new Uint8Array(await fs.readFile(given)) };
}

async function extraSources(specs) {
  const out = [];
  for (const spec of specs || []) {
    const k = spec.indexOf('=');
    const file = await readFile(k < 0 ? spec : spec.slice(0, k));
    out.push({ ...file, logical: (k < 0 ? '' : spec.slice(k + 1)) || file.name });
  }
  return out;
}

async function depositRun(f, args) {
  const a = { ...args };
  a.source = args.source ? await readFile(args.source) : null;
  a.pdf = args.pdf ? await readFile(args.pdf) : null;
  a.extraSource = (await extraSources(args.extraSource)).map((x) => ({ ...x, logical: x.logical === x.name ? '' : x.logical }));
  a.abstractFile = args.abstractFile ? await fs.readFile(args.abstractFile, 'utf-8') : null;
  await deposit(f, a);
}

const REQUIRED = { deposit: ['label', 'title', 'author'], relicense: ['label', 'rights', 'method'],
                   relate: ['label', 'to'], describe: ['label'], init: ['name', 'baseUrl', 'curator'] };
const PY_NAMES = { label: 'id', baseUrl: 'base-url' };

function defaultsOf(cmd) {
  const spec = COMMANDS[cmd];
  const out = {};
  for (const p of spec.positionals) out[positional(p).name] = null;
  for (const o of Object.values(spec.options)) out[o.dest] = o.repeat ? [] : spec.defaults?.[o.dest];
  return out;
}

async function runsOf(cmd, args) {
  let entries = [{}];
  if (args.fromFile) {
    let text;
    try {
      text = await fs.readFile(args.fromFile, 'utf-8');
    } catch {
      throw new Stop(`no file ${args.fromFile}`);
    }
    entries = await loadEntries(args.fromFile, text);
  }
  const out = [];
  for (const entry of entries) {
    const ns = merge(args, entry, defaultsOf(cmd), cmd, { id: 'label' });
    const missing = (REQUIRED[cmd] || []).filter((k) => ns[k] === undefined || ns[k] === null ||
                                                        (Array.isArray(ns[k]) && !ns[k].length));
    if (missing.length) throw new UsageProblem(`${cmd}: missing ` + missing.map((m) => PY_NAMES[m] || m).join(', '));
    if (ns.rights !== undefined && ns.rights !== null && ['deposit', 'relicense'].includes(cmd)) {
      try {
        checkRights(ns.rights);
      } catch (error) {
        throw new UsageProblem(`${cmd}: ${error.message}`);
      }
    }
    if (typeof ns.after === 'string') ns.after = Number.parseInt(ns.after, 10);
    out.push(ns);
  }
  return out;
}

async function each(root, cmd, args, env, run) {
  const todo = await runsOf(cmd, args);
  const f = await openArchive(root, env);
  for (const ns of todo) await run(f, ns);
  await present(f);
  return 0;
}

const RUN = {
  async init(root, args, env) {
    const [a] = await runsOf('init', args);
    const where = path.resolve(a.folder || '.');
    await fs.mkdir(where, { recursive: true });
    if (a.keyLog) throw new Stop(sentence('--key-log: an archive of an existing owner is made by opensheaf-py'));
    env.exportFolder = exportFolder(where);
    await init(new DiskStorage(where), env, a, where);
    return 0;
  },

  deposit: (root, args, env) => each(root, 'deposit', args, env, depositRun),
  relicense: (root, args, env) => each(root, 'relicense', args, env, relicense),
  relate: (root, args, env) => each(root, 'relate', args, env, relate),

  describe: (root, args, env) => each(root, 'describe', args, env, async (f, a) => {
    if (a.abstractFile) {
      if (a.abstract !== undefined && a.abstract !== null) throw new Stop('describe: give --abstract or --abstract-file, not both');
      a = { ...a, abstractFile: { text: await fs.readFile(a.abstractFile, 'utf-8') } };
    }
    await describe(f, a);
  }),

  async notice(root, args, env) {
    const f = await openArchive(root, env);
    await notice(f, { ...args, file: args.file ? await readFile(args.file) : null });
    await present(f);
    return 0;
  },

  async withdraw(root, args, env) {
    const f = await openArchive(root, env);
    await withdraw(f, { ...args, file: args.file ? await readFile(args.file) : null });
    await present(f);
    return 0;
  },

  async complete(root, args, env) {
    const f = await openArchive(root, env);
    const extra = (await extraSources(args.extraSource)).map(({ logical, bytes }) => ({ logical, bytes }));
    await complete(f, { ...args, source: await readFile(args.source), extraSource: extra });
    await present(f);
    return 0;
  },

  async collect(root, args, env) {
    const f = await openArchive(root, env);
    await collect(f, { iKnow: args.iKnow });
    await present(f);
    return 0;
  },

  async collection(root, args, env) {
    const f = await openArchive(root, env);
    const a = { ...args };
    if (args.action === 'sync') {
      try {
        a.fromFile = { name: args.fromFile, given: args.fromFile, text: await fs.readFile(args.fromFile, 'utf-8') };
      } catch {
        throw new Stop(`no file ${args.fromFile}`);
      }
    }
    const run = { new: collections.newCollection, add: collections.add, remove: collections.remove,
                  follow: collections.follow, update: collections.update, status: collections.status,
                  sync: collections.sync }[args.action];
    await run(f, a);
    if (args.action !== 'status') await present(f);
    return 0;
  },

  async index(root, args, env) {
    const f = await openArchive(root, env);
    await writeDiscovery(f);
    if (hasWebsite(f)) await readableIndex(f);
    else env.out('opensheaf.json and the indexes written (no readable index configured)');
    return 0;
  },

  async verify(root, args, env) {
    const where = await findRoot(root || process.cwd());
    const schemas = await loadSchemas(async (url) => JSON.parse(await fs.readFile(fileURLToPath(url), 'utf-8')));
    let configured = {};
    try {
      configured = JSON.parse(await fs.readFile(path.join(where, 'osheaf.json'), 'utf-8')).locations || {};
    } catch {
      // no locations
    }
    env.locations = configured;
    const report = await verifyFolder(new DiskStorage(where), { schemas, remote: Boolean(args.remote),
                                                                fetch: env.fetch, fetchJson: env.fetchJson });
    if (args.json) {
      env.out(JSON.stringify(findingsJson(report), null, 2));
    } else {
      for (const f of report.findings) env.out(`${f.level}: ${f.place}: ${f.message}`);
      const c = report.counts();
      env.out((c.error ? `${c.error} error(s)` : 'OK') + `, ${c.warning} warning(s), ${c.result} result(s)`);
    }
    return report.counts().error ? 1 : 0;
  },
};

export async function update(f, a) {
  let labels = a.collection || [];
  if (!labels.length) {
    for (const [label, id] of [...f.labels].sort((x, y) => compareText(x[0], y[0]))) {
      if (await isCurated(f, label, id)) labels.push(label);
    }
  }
  for (const label of labels) {
    const { collId, mem } = await held(f, label);
    const changed = [];
    const r = await openResolver(f);
    for (const m of mem.members) {
      if (mem.type === 'selection') await reportUnvetted(f, r, label, m);
      else if (m.follow === 'latest' && await followMember(f, r, label, m)) {
        changed.push(`sheaf:${m.name}:${m.owner} ${m.version}`);
      }
    }
    for (const { level, message } of r.notes) f.env.out(`${level}: ${message}`);
    if (changed.length) await write(f, collId, mem, { message: `Followed: ${changed.join(', ')}` });
    else f.env.out(`${label}: no member to follow further`);
  }
}

async function isCurated(f, label, id) {
  const dir = await f.dirOf(id);
  const inv = await f.inventory(dir);
  const head = inv ? await f.readObjectJson(dir, inv, OBJ) : {};
  if (head?.kind !== 'collection' || !f.archiveOwners().includes(head.owner)) return false;
  const mem = (await f.readObjectJson(dir, inv, 'members.json')) || {};
  return !(label === f.archive.mainCollection && mem.order !== 'manual');
}

async function followMember(f, r, label, m) {
  const log = await r.keyLog(m.owner, m.at || []);
  if (log && log.forkPoint) {
    f.env.out(`${label}: sheaf:${m.name}:${m.owner}: its owner's key log forks at v${log.forkPoint}: ` +
              'not followed (section 7.5)');
    return false;
  }
  const found = await r.latest(m.name, m.owner, m.at || []);
  if (!found.copy) {
    f.env.out(`${label}: sheaf:${m.name}:${m.owner}: ${found.status}: the pin is kept`);
    return false;
  }
  const c = found.copy, k = Number(found.version.slice(1)), old = Number(m.version.slice(1));
  if (c.digest(old) !== m.inventorySha512) {
    f.env.out(`${label}: sheaf:${m.name}:${m.owner}: the copy at ${c.where} does not extend the pin ` +
              `${m.version}: a fork of the line (section 7.4); the pin is kept`);
    return false;
  }
  if (k <= old) return false;
  Object.assign(m, { version: `v${k}`, inventorySha512: c.digest(k), cite: await cite(c, k) });
  return true;
}

async function reportUnvetted(f, r, label, m) {
  const found = await r.latest(m.name, m.owner, m.at || []);
  if (!found.copy) return;
  const vetted = new Set(m.revisions.map((x) => x.documentVersion));
  const rest = historyOrder(found.copy).filter((n) => !vetted.has(n));
  if (rest.length) {
    f.env.out(`${label}: sheaf:${m.name}:${m.owner}: document version(s) ${rest.join(', ')} not vetted`);
  }
}

export async function status(f, a) {
  const { mem } = await held(f, a.collection);
  const r = await openResolver(f);
  for (const m of mem.members) {
    for (const { version, pin } of memberPins(m)) {
      const found = await r.pin(m.name, m.owner, version, pin, m.at || []);
      f.env.out(`${found.status}: sheaf:${m.name}:${m.owner} ${version} (${m.cite?.title ?? ''})`);
    }
  }
  for (const { level, message } of r.notes) f.env.out(`${level}: ${message}`);
}

export async function loadSpec(name, text) {
  const spec = await parseData(name, text, { yaml11: true });
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec) ||
      !Array.isArray(spec.members ?? [])) exit(`${name}: a mapping with members, a list`);
  for (const k of Object.keys(spec)) {
    if (!['title', 'description', 'type', 'order', 'owner', 'members'].includes(k)) exit(`${name}: unknown key ${k}`);
  }
  if (!KINDS.includes(spec.type ?? 'catalogue') || !ORDERS.includes(spec.order ?? 'manual')) {
    exit(`${name}: type is catalogue or selection, order one of ${ORDERS.join(', ')}`);
  }
  return spec;
}

export async function sync(f, a) {
  const spec = await loadSpec(a.fromFile.name, a.fromFile.text);
  const exists = f.labels.has(a.collection);
  let collId = null, old, kind;
  if (exists) {
    ({ collId, mem: old } = await held(f, a.collection));
    kind = old.type;
    if ((spec.type ?? kind) !== kind) exit(`${a.collection} is a ${kind}: its type does not change`);
  } else {
    if (!spec.title) exit('a new collection needs a title');
    old = { members: [] };
    kind = spec.type ?? 'catalogue';
    if (!('type' in spec)) f.env.out(`${a.collection}: no type: a catalogue`);
  }
  const members = [];
  const r = await openResolver(f);
  for (const entry of spec.members ?? []) members.push(await syncMember(f, r, entry, kind, old.members));
  const mem = { format: FORMAT, type: kind, order: spec.order ?? old.order ?? 'manual', members };
  const owner = spec.owner || f.archive.owner;
  if (!exists) await f.initStorageRoot();
  return write(f, collId, mem, { message: a.message || `Members from ${a.fromFile.given}`,
                                 title: spec.title ?? null, description: spec.description ?? null, owner,
                                 label: a.collection });
}

async function syncMember(f, r, entry, kind, oldMembers) {
  if (typeof entry === 'string') entry = { uri: entry };
  const text = entry.uri || entry.label;
  if (!text) exit(`a member needs uri or label: ${pyRepr(entry)}`);
  let at = entry.at || [];
  at = typeof at === 'string' ? [at] : [...at];
  const { name, owner, u, places } = await target(f, r, String(text), at);
  const follow = [true, 'yes', 'true', 'latest'].includes(entry.follow);
  const revs = (entry.revisions || []).map((x) => Number.parseInt(x, 10));
  if (kind === 'catalogue' && revs.length) exit(`${text}: revisions are for selections`);
  const old = oldMembers.find((m) => m.name === name && m.owner === owner) ?? null;
  if (old !== null && !u?.sha512) {
    const m = JSON.parse(JSON.stringify(old));
    if (at.length) m.at = [...new Set([...at, ...m.at])];
    if (kind === 'catalogue') {
      delete m.follow;
      if (follow) m.follow = 'latest';
      return m;
    }
    const vetted = new Set(m.revisions.map((x) => x.documentVersion));
    const asked = new Set(revs);
    if (!revs.length || (asked.size === vetted.size && [...asked].every((n) => vetted.has(n)))) {
      return m;
    }
    const founds = await pinned(r, name, owner, u, places, kind, revs.filter((n) => !vetted.has(n)));
    m.revisions = m.revisions.filter((x) => revs.includes(x.documentVersion));
    for (const fd of founds) m.revisions.push(await revision(fd.copy, Number(fd.version.slice(1))));
    m.revisions = sortRevisions(m.revisions, historyOrder(founds[0].copy));
    return m;
  }
  const founds = await pinned(r, name, owner, u, places, kind, revs);
  const recAt = recordedAt(f, r, founds[0], places);
  if (!recAt.length) exit(`${text}: no https base URL where copies are found: give at (section 8.2)`);
  const c = founds[0].copy;
  const m = await memberRecord(kind, c, Number(founds[0].version.slice(1)), name, owner, recAt, follow);
  if (kind === 'selection') {
    const revisions = [];
    for (const fd of founds) revisions.push(await revision(fd.copy, Number(fd.version.slice(1))));
    m.revisions = sortRevisions(revisions, historyOrder(c));
  }
  return m;
}

function pyRepr(entry) {
  return '{' + Object.entries(entry).map(([k, v]) => `'${k}': ${typeof v === 'string' ? `'${v}'` : JSON.stringify(v)}`)
    .join(', ') + '}';
}
