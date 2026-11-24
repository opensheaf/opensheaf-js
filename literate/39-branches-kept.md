Branches and accepted copies
============================

A *branch* is a line of another owner that continues a work from a signed
version of another line, its *branch point* or *parent version* (section
9); an *accepted copy* is a branch kept by the owner of a selection from
a revision it vetted (section 9.6). The checks of a branch point and its
verdicts are the Explorer's (chapter [09](09-branches.md)), which the
verification uses; this chapter makes branches, as opensheaf-py's chapter
[23-branches](https://opensheaf.org/opensheaf-py/23-branches.html) does:

```
osheaf branch URI [--at URL]... [--label LABEL] [--owner OWNER] [--message TEXT]
osheaf accept URI [--at URL]... --selection LABEL [--label LABEL] [--with-original] [--message TEXT]
```

The first version of a branch holds exactly the files of the parent
version, the genesis record included, except the parent's `datacite.json`,
`object.json` and own evidence; its own `datacite.json` and
`object.json`; and the *evidence* of the branch point (section 9.2),
in the folder `parent/`: `parent/inventory.json`, `parent/object.json`,
`parent/signatures/` (the parent owner's good signature files of the
parent version, with the files kept beside them), and `parent/parent/`
when the parent is itself a branch (the parent version's own folder
`parent/`, byte for byte). The key logs the evidence needs are kept beside the branch in the
storage root (section 6.5). A branch is named by `parent.name`, or after
a clash by the smallest greater algorithm number that gives a line free
for its owner (section 5.3); when the line it would take is the owner's
own branch of the same parent line and the new branch point is later in
that line's history, its branch point *moves* instead (section 9.4).

The module is `core/branch.js`.

    // in core/branch.js:
    import { sha512 } from './http.js';
    import { Copy } from './resolve.js';
    import { readGenesis, nameOf, algorithm, objectId, LABEL, OWNER_NAME } from './names.js';
    import { jsonOrNull } from './owners.js';
    import { judgeFolder, GOOD } from './signatures.js';
    import { isEvidence, filesOf, historyOf } from './versions.js';
    import { level, verdict, CONFIRMED, MAX_DEPTH } from './branches.js';
    import { pathOf } from './paths.js';
    import { jsonBytes } from './write.js';
    import { joinPath } from './storage.js';
    import { writeDiscovery } from './discovery.js';
    import { OBJ, OBJ_FORMAT, GENESIS, SPEC, exit } from './folder.js';
    import { landingUrl } from './deposit.js';
    import { openResolver, held, memberRecord, write } from './collections.js';
    import { recordKeyLog, keyLogOf } from './owner.js';
    import { lineWitnessNames, MAX_BYTES } from './mirror.js';

    <<branch: the evidence of a branch point>>

    <<branch: the name of a new branch>>

    <<branch: making a branch or moving its branch point>>

    <<branch: accepting a version into a selection>>

The evidence of a branch point
------------------------------

The files of the parent version vK of a copy (chapter
[15](15-resolve.md)), read in full from the archive that holds it, every
file of the state, and its witnesses: listed in a folder, named from the
owner's key log otherwise. The signature files that are good, with the
files named after them (`signature-<k>.json.<...>`, timestamps), are the
evidence; others are left out.

    // in branch: the evidence of a branch point:
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

The owners whose key logs a branch needs beside it: the parent's, and the
one at every level of the chain, as far as `MAX_DEPTH` levels and the
first level whose `parent/object.json` cannot be read or names no owner,
as opensheaf-py's `chain_owners` stops.

    // in branch: the evidence of a branch point:
    export function chainOwners(files) {
      const out = [];
      for (let prefix = ''; files.has(prefix + 'parent/object.json') && out.length <= MAX_DEPTH; prefix += 'parent/') {
        const owner = jsonOrNull(files.get(prefix + 'parent/object.json'))?.owner;
        if (typeof owner !== 'string' || !OWNER_NAME.test(owner)) break;
        out.push(owner);
      }
      return out;
    }

    async function levelOfFiles(files) {
      const digests = new Map();
      for (const [p, bytes] of files) digests.set(p, await sha512(bytes));
      return level(digests, async (p) => files.get(p));
    }

The name of a new branch
------------------------

The names of the record are tried from `parent.name` upwards: a line free
for the owner (no object and no tombstone here) takes the branch; the
owner's own branch of the same parent line, when the new branch point is
later in its history, takes the new branch point; any other line of the
owner is a clash, and the next number is tried.

    // in branch: the name of a new branch:
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

Whether a new branch point is later than a branch's current one (section
9.4): a higher object version of the same parent line, holding a document
version later in the history of the new parent version. The same parent
version is the branch point already, and the same document version is not
a new branch point: the command stops there, as opensheaf-py does, rather
than make a second branch of the same version under another name. An
earlier version makes a new branch, renamed.

    // in branch: the name of a new branch:
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

Making a branch
---------------

`makeBranch` resolves the parent version, which must be signed and not
contested (section 9.1); checks the owner (sections 5.3 and 9.1); copies
beside the branch the key logs its evidence needs, from the copies found;
names the branch, or finds the branch that takes a new branch point; and
writes the version, after checking its branch point as a verifier will.
`parent.url` is the URL of the parent version where it was found, at the
`https` base URL of its archive (here, the archive's own `baseUrl`).

    // in branch: making a branch or moving its branch point:
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
      <<branch: the files and records of the new version>>
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

The records of the branch. `object.json` keeps the parent's description
of the document's files and records the branch's own line and branch
point; it drops what belongs to the parent's line alone (its history, its
external records, its withdrawal, and its notices, which are about the
parent's document versions and stay in `parent/object.json`, their files
among the parent's). The branch numbers its own document versions from 1
(section 9.4): its first version is its document version 1,
`parent.documentVersion` keeping the parent's number. A version that
takes a new branch point is the branch's next document version, and keeps
the branch's own notices with their files, which must not have the path
of a file of the new parent version (section 9.4). `datacite.json` is the parent's, with
the archive as publisher, the branch's own address, no DOI of the
parent's, and an `IsIdenticalTo` relation to the parent version: its DOI,
or else `parent.url` (section 9.7).

    // in branch: the files and records of the new version:
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

The command `osheaf branch` makes the branch under the archive's owner, or
another owner it hosts.

    // in branch: making a branch or moving its branch point:
    export async function branch(f, args) {
      if (!args.label && !args.uri) exit('osheaf branch URI --label LABEL');
      return makeBranch(f, args.uri, [...(args.at || [])], { owner: args.owner || null, label: args.label || null,
                                                           message: args.message || null });
    }

Accepting a version
-------------------

A journal accepting a version (section 9.6) makes an accepted copy, a
branch under the selection's owner, and lists it in the selection with
the revision it holds; with `--with-original` the selection also lists
the original revision set, the parent version (section 9.6: it MAY).
Accepting a later version of the same paper moves the accepted copy's
branch point, and the new revision is added to the member's revision set:
a new version of the selection, whose message says what was accepted
(section 8.4).

    // in branch: accepting a version into a selection:
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
