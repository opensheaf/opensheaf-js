// Generated from literate/39-branches-kept.md by opensheaf-literate: edit the document, not this file.
import { sha512 } from './http.js';
import { Copy } from './resolve.js';
import { readGenesis, nameOf, algorithm, objectId, LABEL } from './names.js';
import { judgeFolder, GOOD } from './signatures.js';
import { isEvidence, filesOf, historyOf } from './versions.js';
import { level, verdict, CONFIRMED } from './branches.js';
import { pathOf } from './paths.js';
import { jsonBytes } from './write.js';
import { joinPath } from './storage.js';
import { writeDiscovery } from './discovery.js';
import { OBJ, OBJ_FORMAT, GENESIS, SPEC, exit } from './folder.js';
import { landingUrl } from './deposit.js';
import { openResolver, held, memberRecord, write } from './collections.js';
import { recordKeyLog, keyLogOf } from './owner.js';
import { lineWitnessNames, MAX_BYTES } from './mirror.js';

async function fileOf(archive, id, inv, ver, logical) {
  const url = archive.fileUrl(id, inv, ver, logical);
  return url ? archive.http.request(url, { limit: MAX_BYTES }) : null;
}

export async function branchPointFiles(c, k) {
  const ver = `v${k}`, inv = c.line.inv, a = c.archive;
  const state = filesOf(inv, ver);
  const read = new Map();
  for (const p of Object.keys(state)) read.set(p, await fileOf(a, c.id, inv, ver, p));
  const pobj = JSON.parse(new TextDecoder().decode(read.get(OBJ)));
  const files = new Map();
  for (const [p, bytes] of read) if (p !== 'datacite.json' && p !== OBJ && !isEvidence(p)) files.set(p, bytes);
  files.set('parent/inventory.json', await a.inventoryBytes(c.id, ver));
  files.set('parent/object.json', read.get(OBJ));
  const names = (await a.listWitnesses(c.id, ver)) ?? await lineWitnessNames(c.line.log)();
  const witnesses = new Map();
  for (const name of names) {
    const bytes = await a.witness(c.id, ver, name);
    if (bytes) witnesses.set(name, bytes);
  }
  const log = c.line.log;
  const good = (await judgeFolder(witnesses, { objectId: c.id, version: ver, inventory: c.digest(k), owner: pobj.owner,
                                               lookup: log ? (n, d) => log.lookup(n, d) : () => null }))
    .filter((j) => j.status === GOOD).map((j) => j.file);
  for (const [name, bytes] of witnesses) {
    if (good.includes(name) || good.some((g) => name.startsWith(g + '.'))) files.set(`parent/signatures/${name}`, bytes);
  }
  for (const p of Object.keys(state).filter(isEvidence).sort()) files.set(`parent/${p}`, read.get(p));
  const parent = { owner: pobj.owner, name: pobj.name, objectVersion: ver, documentVersion: pobj.documentVersion,
                   inventorySha512: c.digest(k) };
  return { files, parent };
}

export function chainOwners(files) {
  const out = [];
  for (let prefix = ''; files.has(prefix + 'parent/object.json'); prefix += 'parent/') {
    out.push(JSON.parse(new TextDecoder().decode(files.get(prefix + 'parent/object.json'))).owner);
  }
  return out;
}

async function levelOfFiles(files) {
  const digests = new Map();
  for (const [p, bytes] of files) digests.set(p, await sha512(bytes));
  return level(digests, async (p) => files.get(p));
}

async function branchName(f, genesis, parent, owner, later) {
  const taken = new Set(f.tombstones.filter((t) => t.owner === owner).map((t) => t.name));
  for (let k = algorithm(parent.name); k < 16; k++) {
    const name = await nameOf(genesis, k);
    const dir = await f.dirOf(objectId(name, owner));
    const inv = await f.inventory(dir);
    if (!inv && !taken.has(name)) return [name, false];
    if (!inv) continue;
    const head = (await f.readObjectJson(dir, inv, OBJ)) || {};
    const hp = head.parent || {};
    if (hp.owner === parent.owner && hp.name === parent.name && await later(head)) return [name, true];
  }
  exit(`no name of the genesis record from algorithm ${algorithm(parent.name)} to 15 is free for ${owner}: the ` +
       'branch is refused (section 5.3)');
}

function later(head, c, k) {
  const old = head.parent;
  const before = Number(String(old.objectVersion).slice(1));
  if (k === before) exit(`v${k} is the branch point of the branch already`);
  if (k < before) return false;
  const objOf = (v) => c.line.objs.get(v) ?? null;
  const order = historyOf(c.line.inv, objOf, `v${k}`).map((h) => objOf(h)?.documentVersion);
  const dv = objOf(`v${k}`)?.documentVersion;
  if (dv === old.documentVersion) {
    exit(`v${k} holds document version ${dv}, as the branch point does: not a new branch point (section 9.4)`);
  }
  return order.includes(old.documentVersion) && order.includes(dv) && order.indexOf(dv) > order.indexOf(old.documentVersion);
}

export async function makeBranch(f, uri, where, { owner = null, label = null, message = null } = {}) {
  owner ||= f.archive.owner;
  if (!f.archiveOwners().includes(owner)) exit(`${owner} is not an owner this archive hosts`);
  const r = await openResolver(f);
  let line, found;
  try {
    ({ id: line, found } = await r.resolve(uri, where));
  } catch (error) {
    if (error?.kind) throw error;
    exit(error.message);
  }
  if (found.status !== 'verified' || !found.copy) {
    exit(`${uri}: ${found.status}: only a signed version, not contested, is branched (section 9.1)`);
  }
  const c = found.copy, k = Number(found.version.slice(1));
  let { files, parent } = await branchPointFiles(c, k);
  const genesis = files.get(GENESIS);
  const rec = await readGenesis(genesis);
  if (owner === parent.owner || owner === rec.originator) {
    exit("the owner of a branch is neither the parent's owner nor the originator (sections 5.3 and 9.1): the " +
         "originator takes in another line's work by depositing it (section 9.5)");
  }
  const isHere = c.archive === r.home;
  const at = isHere ? f.archive.baseUrl : c.archive.base.startsWith('https://') ? c.archive.base : null;
  const segments = await pathOf(c.id, isHere ? f.layout : c.archive.layout);
  const url = isHere ? `${f.archive.baseUrl}ocfl/${segments.join('/')}/v${k}/`
    : at ? new URL((c.archive.disc.storageRoot ?? 'ocfl/') + segments.join('/'), at).href + `/v${k}/` : null;
  const parentAt = at ? [at] : [];
  if (url) parent.url = url;
  for (const o of chainOwners(files)) {
    await r.keyLog(o, isHere ? where : [c.where, ...where]);
    const others = (r.logs.get(o)?.found || []).filter((x) => x.where !== r.home.base).map((x) => [x.where, x.log]);
    if (!(await recordKeyLog(f, o, others))) {
      exit(`no key log of ${o} found: the evidence of the branch point needs it beside the branch (section 6.5)`);
    }
  }
  const [name, move] = await branchName(f, genesis, parent, owner, (head) => later(head, c, k));
  const id = objectId(name, owner);
  const pobj = JSON.parse(new TextDecoder().decode(files.get('parent/object.json')));
  let pdc = null;
  try {
    pdc = await c.archive.json(c.id, c.line.inv, `v${k}`, 'datacite.json');
  } catch {
    pdc = null;
  }
  pdc ||= {};
  const keep = ['mainSource', 'sourceFormat', 'sourcesMissing', 'renditions', 'toolchain', 'changes', 'stage',
                'licence', 'agreement'];
  const obj = { format: OBJ_FORMAT, specification: SPEC, kind: pobj.kind, name, owner, parent,
                documentVersion: 1 };
  for (const k2 of keep) if (Object.hasOwn(pobj, k2)) obj[k2] = pobj[k2];
  obj.status = 'active';
  if (move) {
    const bdir = await f.dirOf(id);
    const binv = await f.inventory(bdir);
    let most = 0;
    for (const x of Object.keys(binv.versions)) most = Math.max(most, (await f.readObjectJson(bdir, binv, OBJ, x)).documentVersion);
    obj.documentVersion = most + 1;
    const ownNotices = (await f.readObjectJson(bdir, binv, OBJ)).notices || [];
    if (ownNotices.length) obj.notices = ownNotices;
    for (const n of ownNotices) {
      if (n.path) {
        if (files.has(n.path)) exit(`${n.path}: a notice of the branch has the path of a file of the new parent version (section 9.4)`);
        files.set(n.path, await f.readLogical(bdir, binv, n.path));
      }
    }
  }
  const dc = Object.fromEntries(Object.entries(pdc).filter(([key]) => key !== 'doi' && key !== 'url'));
  dc.publisher = { name: f.archive.name };
  dc.version = String(obj.documentVersion);
  dc.url = await landingUrl(f, id, (await readGenesis(files.get(GENESIS))).originator ?? null);
  const rel = pdc.doi ? { relatedIdentifier: pdc.doi, relatedIdentifierType: 'DOI', relationType: 'IsIdenticalTo' }
    : parent.url ? { relatedIdentifier: parent.url, relatedIdentifierType: 'URL', relationType: 'IsIdenticalTo' } : null;
  if (rel) {
    dc.relatedIdentifiers = [...(dc.relatedIdentifiers || []).filter((x) => x.relationType !== 'IsIdenticalTo' ||
      !['URL', 'DOI'].includes(x.relatedIdentifierType)), rel];
  }
  const content = new Map([...files, ['datacite.json', jsonBytes(dc)]]);
  if (label && !move && (f.labels.has(label) || !LABEL.test(label))) {
    exit(`--label: a new label of the form of section 3.1 (not '${label}')`);
  }
  const [v, problems] = await verdict(await levelOfFiles(content), obj, genesis, (o) => keyLogOf(f, o));
  if (v !== CONFIRMED) exit(`${id}: the branch point would be ${v}: ` + problems.join('; '));
  const done = await f.addVersion(id, content, obj, message || (move
    ? `New branch point ${parent.objectVersion} of ${line}`
    : `Branch of ${line} at ${parent.objectVersion} (document version ${parent.documentVersion})`));
  if (label && !move) f.labels.set(label, id);
  await writeDiscovery(f);
  f.env.out(`${label || f.labelOf(id) || id}: ${done.head} ` + (move ? 'takes the new branch point ' : 'branch of ') +
            `${line} ${parent.objectVersion} (document version ${parent.documentVersion})`);
  return { id, head: done.head, inv: done, parentAt };
}

export async function branch(f, args) {
  if (!args.label && !args.uri) exit('osheaf branch URI --label LABEL');
  return makeBranch(f, args.uri, [...(args.at || [])], { owner: args.owner || null, label: args.label || null,
                                                       message: args.message || null });
}

export async function accept(f, args) {
  const { collId: selId, mem } = await held(f, args.selection);
  if (mem.type !== 'selection') exit(`${args.selection} is not a selection (section 8.1)`);
  const owner = selId.split(':')[2];
  const { id, head: ver, parentAt } = await makeBranch(f, args.uri, [...(args.at || [])],
                                                       { owner, label: args.label || null, message: args.message || null });
  const bdir = await f.dirOf(id);
  const binv = await f.inventory(bdir);
  const bobj = await f.readObjectJson(bdir, binv, OBJ, ver);
  const name = id.split(':')[1];
  const revision = { documentVersion: bobj.documentVersion, version: ver,
                     inventorySha512: await sha512(await f.storage.read(joinPath(bdir, ver, 'inventory.json'))) };
  const members = mem.members;
  let m = members.find((x) => x.name === name && x.owner === owner);
  if (!m) {
    const c = new Copy('here', f.reader(), await f.line(id));
    m = await memberRecord('selection', c, Number(ver.slice(1)), name, owner, [f.archive.baseUrl]);
    members.push(m);
  } else if (m.revisions.every((x) => x.documentVersion !== revision.documentVersion)) {
    m.revisions.push(revision);
  }
  if (args.withOriginal) {
    const p = bobj.parent;
    if (!parentAt.length) exit('--with-original: the parent was found at no https base URL to record (section 8.2)');
    const vetted = { documentVersion: p.documentVersion, version: p.objectVersion, inventorySha512: p.inventorySha512 };
    const orig = members.find((x) => x.name === p.name && x.owner === p.owner);
    if (!orig) members.push({ kind: bobj.kind, name: p.name, owner: p.owner, at: parentAt, revisions: [vetted] });
    else if (orig.revisions.every((x) => x.documentVersion !== vetted.documentVersion)) orig.revisions.push(vetted);
  }
  await write(f, selId, mem, { message: args.message ||
    `Accepted: document version ${revision.documentVersion} of ${name.slice(0, 16)}..., kept as ${id} ${ver}` });
}
