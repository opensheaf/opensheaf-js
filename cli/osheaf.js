// Generated from literate/40-cli.md by opensheaf-literate: edit the document, not this file.
import process from 'node:process';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DiskStorage } from './disk.js';
import { fileKeyStore, exportFolder, passphrases, readLine } from './keystore.js';
import { ArchiveFolder, environment, Stop, CONFIG_NAMES, REBUILD, sentence } from '../core/folder.js';
import { init } from '../core/init.js';
import { deposit, checkRights } from '../core/deposit.js';
import { collect } from '../core/collect.js';
import { writeDiscovery } from '../core/discovery.js';
import { verifyFolder, findingsJson } from '../core/check.js';
import { loadSchemas } from '../core/schema.js';
import { notice, withdraw, complete, relate, relicense, describe, RELATIONS } from '../core/describe.js';
import * as collections from '../core/collections.js';
import { present, readableIndex, hasWebsite } from '../core/website.js';
import { fetchJsonWith } from '../core/keepers.js';
import { loadEntries, merge, UsageProblem } from '../core/inputs.js';

export const VERSION = '0.1.0';

const flag = (dest) => ({ dest, flag: true });
const value = (dest, extra = {}) => ({ dest, ...extra });
const int = (dest, extra = {}) => ({ dest, type: 'int', ...extra });

const DEPOSIT = {
  positionals: ['label', 'source'],
  options: {
    '--pdf': value('pdf'), '--no-source': value('noSource'), '--source-format': value('sourceFormat'),
    '--abstract': value('abstract'), '--abstract-file': value('abstractFile'),
    '--keyword': value('keyword', { repeat: true }), '--language': value('language'),
    '--toolchain': value('toolchain', { repeat: true }), '--title': value('title'),
    '--author': value('author', { repeat: true }), '--available': value('available'), '--date': value('available'),
    '--created': value('created'), '--issued': value('issued'), '--date-info': value('dateInfo'),
    '--stage': value('stage', { choices: ['AO', 'SMUR', 'AM', 'P', 'VoR', 'CVoR', 'EVoR'] }),
    '--changes': value('changes'), '--after': int('after'), '--type': value('type'),
    '--rights': value('rights', { check: checkRights }), '--related': value('related', { repeat: true }),
    '--extra-source': value('extraSource', { repeat: true }), '--message': value('message'),
    '--agreement': value('agreement'), '--licence-file': value('licenceFile'), '--i-know': flag('iKnow'),
    '--new': flag('new'), '--owner': value('owner'), '--from': value('fromFile'),
  },
  defaults: { type: 'Preprint' },
};

const I_KNOW = { '--i-know': flag('iKnow') };
const MEMBERS = (more) => ({ positionals: ['collection!', 'uri+'], options: { ...more, '--message': value('message') } });

export const COMMANDS = {
  init: {
    help: 'create an archive (osheaf.json, storage root, owner, main catalogue)',
    positionals: ['folder'],
    options: {
      '--name': value('name'), '--base-url': value('baseUrl'), '--curator': value('curator'),
      '--affiliation': value('affiliation'), '--contact': value('contact'),
      '--layout': value('layout', { choices: ['owner-name', 'hashed'] }), '--owner': value('owner'),
      '--key-log': value('keyLog'), '--new-owner': flag('newOwner'), '--threshold': int('threshold'),
      '--key': value('key', { repeat: true }), '--rotation': int('rotation'), '--next-threshold': int('nextThreshold'),
      '--single-rotation-key': flag('singleRotationKey'), '--keeper': value('keeper'), '--export': value('export'),
      '--no-passphrase': flag('noPassphrase'), '--print': flag('print'), '--yes': flag('yes'),
      '--keys': value('keys'), '--plain-current': flag('plainCurrent'), '--curated': flag('curated'),
      '--index': value('index', { choices: ['website', 'texmacs'] }), '--index-template': value('indexTemplate'),
      '--from': value('fromFile'),
    },
  },
  deposit: { help: 'deposit a document (any source with --pdf); --new seals a new work under a new label', ...DEPOSIT },
  relicense: {
    help: 'description-only version with a new licence', positionals: ['label'],
    options: { '--rights': value('rights', { check: checkRights }), '--method': value('method'),
               '--date': value('date'), '--message': value('message'), '--from': value('fromFile'), ...I_KNOW },
  },
  relate: {
    help: 'description-only version linking the same work elsewhere', positionals: ['label'],
    options: { '--to': value('to'), '--relation': value('relation', { choices: RELATIONS }),
               '--issued': value('issued'), '--message': value('message'), '--from': value('fromFile'), ...I_KNOW },
    defaults: { relation: 'IsIdenticalTo' },
  },
  describe: {
    help: 'description-only version correcting the title, abstract, keywords or authors', positionals: ['label'],
    options: { '--title': value('title'), '--abstract': value('abstract'), '--abstract-file': value('abstractFile'),
               '--keyword': value('keyword', { repeat: true }), '--author': value('author', { repeat: true }),
               '--message': value('message'), '--from': value('fromFile'), ...I_KNOW },
  },
  notice: {
    help: 'a notice about a document version (description-only)', positionals: ['label!'],
    options: { '--about': int('about', { required: true }), '--text': value('text', { required: true }),
               '--file': value('file'), '--date': value('date'), '--message': value('message'), ...I_KNOW },
  },
  withdraw: {
    help: 'withdraw a document (description-only; the content stays)', positionals: ['label!'],
    options: { '--reason': value('reason', { required: true }), '--file': value('file'), '--date': value('date'),
               '--message': value('message'), ...I_KNOW },
  },
  complete: {
    help: 'add the sources of a version deposited without them', positionals: ['label!'],
    options: { '--version': int('version', { required: true }), '--source': value('source', { required: true }),
               '--extra-source': value('extraSource', { repeat: true }), '--source-format': value('sourceFormat'),
               '--message': value('message'), ...I_KNOW },
  },
  collect: { help: 'new version of the main catalogue when needed', positionals: [],
             options: { '--i-know': flag('iKnow') } },
  collection: {
    help: 'catalogues and selections, with members of any archive',
    actions: {
      new: { help: 'a new, empty collection', positionals: ['label!'],
             options: { '--type': value('type', { choices: ['catalogue', 'selection'], required: true }),
                        '--title': value('title', { required: true }), '--description': value('description'),
                        '--order': value('order', { choices: ['manual', 'issued-desc', 'issued-asc'] }),
                        '--owner': value('owner') } },
      add: { help: 'add members, or revisions of a member of a selection',
             ...MEMBERS({ '--revision': int('revision', { repeat: true }), '--at': value('at', { repeat: true }),
                          '--follow': flag('follow') }) },
      remove: { help: 'remove members, or revisions', ...MEMBERS({ '--revision': int('revision', { repeat: true }) }) },
      follow: { help: 'members of a catalogue that follow their lines', ...MEMBERS({ '--off': flag('off') }) },
      update: { help: 'follow the members that follow their lines', positionals: ['collection*'], options: {} },
      status: { help: 'the status of every member (section 8.5)', positionals: ['collection!'], options: {} },
      sync: { help: 'write a collection from collection.yaml', positionals: ['collection!'],
              options: { '--from': value('fromFile', { required: true }), '--message': value('message') } },
    },
  },
  index: { help: 'write opensheaf.json, the indexes and the website', positionals: [],
           options: { '--no-html': flag('noHtml') } },
  verify: { help: 'check the archive (section 14 of the specification)', positionals: [],
            options: { '--remote': flag('remote'), '--json': flag('json') } },
};

const LATER = ['resolve', 'mirror', 'branch', 'accept', 'draft', 'seal', 'takedown', 'zenodo', 'arxiv', 'owner',
               'sign', 'key', 'help-config'];

const METAVARS = { label: 'LABEL', collection: 'LABEL', uri: 'URI', source: 'SOURCE', folder: 'FOLDER' };

function positional(p) {
  const m = /^([a-zA-Z]+)([!+*]?)$/.exec(p);
  return { name: m[1], kind: m[2], metavar: METAVARS[m[1]] || m[1].toUpperCase() };
}

export class UsageError extends Error {}

function option(spec, given, cmd) {
  if (Object.hasOwn(spec.options, given)) return given;
  const matches = Object.keys(spec.options).filter((o) => o.startsWith(given));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new UsageError(`osheaf ${cmd}: error: ambiguous option: ${given} could match ${matches.join(', ')}`);
  throw new UsageError(`osheaf ${cmd}: error: unrecognized arguments: ${given}`);
}

export function parseArgs(argv) {
  const out = { root: null, cmd: null, args: {} };
  let k = 0;
  for (; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--root') out.root = argv[++k];
    else if (a.startsWith('--root=')) out.root = a.slice(7);
    else if (a === '--version' || a === '-h' || a === '--help') return { ...out, cmd: a };
    else break;
  }
  out.cmd = argv[k++] ?? null;
  if (out.cmd === null) throw new UsageError('osheaf: error: the following arguments are required: command');
  let spec = COMMANDS[out.cmd];
  if (!spec) return out;
  let where = out.cmd;
  if (spec.actions) {
    const action = argv[k++];
    if (action === '-h' || action === '--help') {
      out.args = { help: true };
      return out;
    }
    if (action === undefined) throw new UsageError(`osheaf ${out.cmd}: error: the following arguments are required: action`);
    if (!Object.hasOwn(spec.actions, action)) {
      throw new UsageError(`osheaf ${out.cmd}: error: argument action: invalid choice: '${action}' (choose from ` +
                           `${Object.keys(spec.actions).map((c) => `'${c}'`).join(', ')})`);
    }
    out.action = action;
    spec = spec.actions[action];
    where = `${out.cmd} ${action}`;
  }
  const args = { ...(spec.defaults || {}) };
  for (const o of Object.values(spec.options)) if (o.repeat) args[o.dest] = [];
  const positionals = [];
  let rest = false;
  for (; k < argv.length; k++) {
    const a = argv[k];
    if (rest || !a.startsWith('--') || a === '--') {
      if (a === '--' && !rest) rest = true;
      else if (a === '-h') args.help = true;
      else positionals.push(a);
      continue;
    }
    if (a === '--help') {
      args.help = true;
      continue;
    }
    const eq = a.indexOf('=');
    const name = option(spec, eq < 0 ? a : a.slice(0, eq), where);
    const o = spec.options[name];
    if (o.flag) {
      if (eq >= 0) throw new UsageError(`osheaf ${where}: error: argument ${name}: ignored explicit argument`);
      args[o.dest] = true;
      continue;
    }
    let v = eq >= 0 ? a.slice(eq + 1) : argv[++k];
    if (v === undefined) throw new UsageError(`osheaf ${where}: error: argument ${name}: expected one argument`);
    if (o.type === 'int') {
      if (!/^[-+]?[0-9]+$/.test(v.trim())) throw new UsageError(`osheaf ${where}: error: argument ${name}: invalid int value: '${v}'`);
      v = Number(v);
    }
    if (o.choices && !o.choices.includes(v)) {
      throw new UsageError(`osheaf ${where}: error: argument ${name}: invalid choice: '${v}' (choose from ` +
                           `${o.choices.map((c) => `'${c}'`).join(', ')})`);
    }
    if (o.check) {
      try {
        o.check(v);
      } catch (error) {
        throw new UsageError(`osheaf ${where}: error: argument ${name}: ${error.message}`);
      }
    }
    if (o.repeat) args[o.dest].push(v);
    else args[o.dest] = v;
  }
  if (args.help) {
    out.args = args;
    return out;
  }
  const specs = spec.positionals.map(positional);
  const many = specs.findIndex((p) => p.kind === '+' || p.kind === '*');
  const fixed = many < 0 ? specs.length : specs.length - 1;
  if (many < 0 && positionals.length > specs.length) {
    throw new UsageError(`osheaf ${where}: error: unrecognized arguments: ${positionals.slice(specs.length).join(' ')}`);
  }
  const missing = [];
  let at = 0;
  specs.forEach((p, i) => {
    if (i === many) {
      const take = Math.max(0, positionals.length - fixed);
      args[p.name] = positionals.slice(at, at + take);
      at += take;
      if (p.kind === '+' && !take) missing.push(p.metavar);
    } else {
      args[p.name] = positionals[at] ?? null;
      if (positionals[at] === undefined && p.kind === '!') missing.push(p.metavar);
      at++;
    }
  });
  for (const [o, d] of Object.entries(spec.options)) {
    if (d.required && args[d.dest] === undefined && !missing.includes(o)) missing.push(o);
  }
  if (missing.length) throw new UsageError(`osheaf ${where}: error: the following arguments are required: ${missing.join(', ')}`);
  out.args = args;
  return out;
}

export async function findRoot(start) {
  let p = path.resolve(start);
  for (;;) {
    for (const n of CONFIG_NAMES) {
      try {
        await fs.access(path.join(p, n));
        return p;
      } catch {
        // not here
      }
    }
    if (path.dirname(p) === p) break;
    p = path.dirname(p);
  }
  throw new Stop(`no osheaf.json in ${path.resolve(start)} or above it (use --root)`);
}

export function makeEnvironment(archiveRoot = null, given = {}) {
  const env = environment({
    out: (line) => process.stdout.write(line + '\n'),
    err: (line) => process.stderr.write(line + '\n'),
    input: readLine,
    exportFolder: exportFolder(archiveRoot),
    ...given,
  });
  env.keyStore ??= fileKeyStore({ warn: (t) => env.warn(t) });
  env.passphrase ??= passphrases(process.env, (t) => env.warn(t));
  if (!given.fetch) env.fetch = locatedFetch(() => env.locations || {});
  env.fetchJson ??= fetchJsonWith(env.fetch);
  env.template ??= defaultTemplate;
  return env;
}

async function openArchive(root, env) {
  const where = await findRoot(root || process.cwd());
  const f = await ArchiveFolder.open(new DiskStorage(where), env);
  if (f.old) throw new Stop(REBUILD);
  env.locations = f.archive.locations || {};
  return f;
}

export async function defaultTemplate(name) {
  try {
    return new Uint8Array(await fs.readFile(new URL(`../templates/${name}`, import.meta.url)));
  } catch {
    return null;
  }
}

export function locations(configured = {}, text = process.env.OPENSHEAF_LOCATIONS || '') {
  const out = { ...configured };
  for (const part of text.split(';')) {
    const k = part.indexOf('=');
    if (k >= 0 && part.slice(0, k).trim()) out[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return out;
}

export function locate(url, found) {
  for (const prefix of Object.keys(found).sort((a, b) => b.length - a.length)) {
    if (url.startsWith(prefix)) return found[prefix] + url.slice(prefix.length);
  }
  return url;
}

export function locatedFetch(configured, base = globalThis.fetch?.bind(globalThis)) {
  return async (url, init = {}) => {
    const target = locate(String(url), locations(configured()));
    if (/^https?:\/\//.test(target)) return base(target, init);
    const file = target.startsWith('file://') ? fileURLToPath(target.split('?')[0]) : decodeURIComponent(target.split('?')[0]);
    try {
      const st = await fs.lstat(file);
      if (!st.isFile()) return new Response('not found', { status: 404 });
      const bytes = new Uint8Array(await fs.readFile(file));
      return new Response(init.method === 'HEAD' ? null : bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
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

export const USAGE = `usage: osheaf [-h] [--version] [--root ROOT] COMMAND ...

osheaf: keep an OpenSheaf archive (specification 0.2, https://opensheaf.org).
This is opensheaf-js ${VERSION}, the JavaScript port of opensheaf-py.

The archive is the folder given with --root, or else the nearest folder above
the current one that has an osheaf.json. Lines are named by their labels in
the archive.

Commands:
${Object.entries(COMMANDS).map(([c, s]) => `  ${c.padEnd(11)}${s.help}`).join('\n')}

The website (osheaf.json "index": {"html": ...}) is written again after every
command that changes the archive. deposit, relicense, relate, describe and
init also take their options from a YAML or JSON file: --from FILE.

The other commands of opensheaf-py (owner, key, resolve, mirror, branch,
zenodo, arxiv, ...) come in later versions; until then, use opensheaf-py.

Warning: OpenSheaf 0.2 is a draft. Until version 1.0, a revision may change
the format in incompatible ways, and archives may have to be rebuilt.`;

function usageOf(cmd, action) {
  if (COMMANDS[cmd].actions && !action) {
    const acts = Object.entries(COMMANDS[cmd].actions).map(([a, x]) => `  ${a.padEnd(8)}${x.help}`).join('\n');
    return `usage: osheaf ${cmd} [-h] {${Object.keys(COMMANDS[cmd].actions).join(',')}} ...\n\n${COMMANDS[cmd].help}\n\n${acts}`;
  }
  const s = action ? COMMANDS[cmd].actions[action] : COMMANDS[cmd];
  cmd = action ? `${cmd} ${action}` : cmd;
  const opts = Object.entries(s.options).map(([o, d]) => (d.flag ? `[${o}]` : `[${o} ${d.dest.toUpperCase()}]`));
  return `usage: osheaf ${cmd} [-h] ${opts.join(' ')} ${s.positionals.map((p) => `[${positional(p).metavar}]`).join(' ')}\n\n${s.help}`;
}

export async function main(argv, given = {}) {
  const env = makeEnvironment(null, given);
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    env.err(error.message);
    return 2;
  }
  const { cmd, root, args, action } = parsed;
  if (cmd === '--version') {
    env.out(`osheaf (opensheaf-js) ${VERSION}`);
    return 0;
  }
  if (cmd === '-h' || cmd === '--help') {
    env.out(USAGE);
    return 0;
  }
  if (!COMMANDS[cmd]) {
    env.err(LATER.includes(cmd)
      ? `osheaf ${cmd}: not in opensheaf-js ${VERSION} yet: use osheaf of opensheaf-py (https://opensheaf.org/opensheaf-py/)`
      : `osheaf: error: argument command: invalid choice: '${cmd}'`);
    return 2;
  }
  if (args.help) {
    env.out(usageOf(cmd, action));
    return 0;
  }
  try {
    return await RUN[cmd](root, { ...args, action }, env);
  } catch (error) {
    if (error instanceof Stop) {
      env.err(error.message);
      return 1;
    }
    if (error instanceof UsageProblem) {
      env.err(`osheaf: error: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main ?? (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
