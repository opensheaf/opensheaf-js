Branches and their verdicts
===========================

> This chapter is chapter 09 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/09-branches.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


A branch is a line of another owner that continues a work from a signed
version of another line, its branch point (section 9). It holds the
files of the parent version, and the *evidence* of the branch point, in
the folder `parent/`: `parent/inventory.json`, the parent's inventory; `parent/object.json`,
its `object.json`; `parent/signatures/`, the parent owner's signature
files of that version; and, when the parent is itself a branch,
`parent/parent/`, the parent's own folder `parent/`, level by level back to the
originator's line (section 9.2). From these files alone, with the key
logs kept beside the branch, a reader checks that the branch point is the
parent owner's, and gives it a verdict: *inconsistent*, *confirmed* or
*unchecked* (section 9.3).

This chapter follows `verdict` of opensheaf-py's chapter
[23-branches](https://opensheaf.org/opensheaf-py/23-branches.html), check
by check and in the same words.

The module is `core/branches.js`.

    // in core/branches.js:
    import { sha512 } from './http.js';
    import { readGenesis, isNameOf, algorithm, objectId, NAME, OWNER_NAME, isObject } from './names.js';
    import { jsonOrNull } from './owners.js';
    import { judgeFolder, lineStatuses, SIGNED, VOUCHED, UNSIGNED, INVALID } from './signatures.js';
    import { isEvidence, filesOf } from './versions.js';

    export const INCONSISTENT = 'inconsistent', CONFIRMED = 'confirmed', UNCHECKED = 'unchecked';
    export const ORDER = { [CONFIRMED]: 0, [UNCHECKED]: 1, [INCONSISTENT]: 2 };
    export const MAX_DEPTH = 64;

A level
-------

One level of a branch point is a set of files: those of a version of the
branch at the first level, those under `parent/parent/` at the next, and
so on. A level is the digests of its files, by logical path, and a
function reading the bytes of one; `sub` gives the level below.

    // in core/branches.js:
    export function level(digests, read) {
      return {
        digests, read,
        sub(prefix) {
          const below = new Map();
          for (const [p, d] of digests) if (p.startsWith(prefix)) below.set(p.slice(prefix.length), d);
          return level(below, (p) => read(prefix + p));
        },
        async json(path) {
          return digests.has(path) ? jsonOrNull(await read(path)) : null;
        },
      };
    }

    export function levelOfVersion(archive, id, inv, ver, options = {}) {
      const digests = new Map(Object.entries(filesOf(inv, ver)));
      return level(digests, (p) => archive.bytes(id, inv, ver, p, options));
    }

The verdict of a branch point
-----------------------------

The checks of section 9.3, in their order, on the branch point that
`obj`, an `object.json` of the branch, records: the names (the branch's
and `parent.name` are names of the genesis record, and a branch renamed
after a clash has the greater algorithm number); the pin (the digest of
`parent/inventory.json` is the one `parent` records, and its head the
version, and `parent/object.json` is the one it records); at the first
level only, the files (every file of the parent version but its
descriptions and evidence is held with its digest, and nothing else);
the parent (the fields of `parent` are those of `parent/object.json`, the
branch's owner is neither the parent's owner nor the originator, and the
parent is the originator's line or itself a branch); the signatures (the
parent version signed, against the parent owner's key log, `logs(owner)`,
or unchecked without one); and the chain, level by level.

The answer is the verdict and its reasons: an inconsistent branch point
with every problem found at its level, a confirmed one with none, an
unchecked one with why.

    // in core/branches.js:
    export async function verdict(lv, obj, genesis, logs, depth = 0) {
      const p = obj?.parent;
      if (!isObject(p)) return [INCONSISTENT, ['object.json has no parent']];
      if (depth > MAX_DEPTH) return [UNCHECKED, [`the chain is not followed beyond ${MAX_DEPTH} levels`]];
      const problems = [];
      let rec;
      try {
        rec = await readGenesis(genesis);
      } catch (error) {
        return [INCONSISTENT, [`genesis.json: ${error.message}`]];
      }
      const name = typeof obj.name === 'string' ? obj.name : '', pname = typeof p.name === 'string' ? p.name : '';
      if (!await isNameOf(name, genesis) || !await isNameOf(pname, genesis)) {
        problems.push('the name and parent.name are not names of genesis.json (section 5.2)');
      } else if (name !== pname && algorithm(name) <= algorithm(pname)) {
        problems.push('a branch renamed after a clash has a greater algorithm number than parent.name (section 5.3)');
      }
      const pinvBytes = lv.digests.has('parent/inventory.json') ? await lv.read('parent/inventory.json') : null;
      const pinv = jsonOrNull(pinvBytes);
      const pobj = await lv.json('parent/object.json');
      if (!isObject(pinv) || !isObject(pobj)) {
        return [INCONSISTENT, [...problems, 'parent/inventory.json or parent/object.json is missing (section 9.2)']];
      }
      if (await sha512(pinvBytes) !== p.inventorySha512 || pinv.head !== p.objectVersion) {
        problems.push('parent/inventory.json is not the inventory the pin of parent names');
      }
      const pstate = new Map();
      const state = pinv.versions?.[pinv.head]?.state;
      for (const [d, paths] of Object.entries(isObject(state) ? state : {})) {
        for (const path of Array.isArray(paths) ? paths : []) pstate.set(path, d);
      }
      if (pstate.get('object.json') !== lv.digests.get('parent/object.json')) {
        problems.push('parent/object.json is not the object.json the parent inventory records');
      }
      if (depth === 0) {
        const own = ['datacite.json', 'object.json'];
        for (const [path, d] of pstate) {
          if (own.includes(path) || isEvidence(path)) continue;
          if (lv.digests.get(path) !== d) problems.push(`${path}: a file of the parent version is missing, or differs (section 9.3)`);
        }
        for (const path of lv.digests.keys()) {
          if (!own.includes(path) && !isEvidence(path) && !pstate.has(path)) problems.push(`${path}: not a file of the parent version (section 9.3)`);
        }
      }
      if (p.owner !== pobj.owner || p.name !== pobj.name || p.documentVersion !== pobj.documentVersion) {
        problems.push('parent does not agree with parent/object.json');
      }
      if (obj.owner === p.owner || obj.owner === rec.originator) {
        problems.push("the owner of a branch is neither the parent's owner nor the originator (section 9.3)");
      }
      if (!((p.owner === rec.originator && !('parent' in pobj)) || 'parent' in pobj)) {
        problems.push("the parent is the originator's line, or a branch with its own parent (section 9.3)");
      }
      const log = await logs(p.owner);
      const pid = NAME.test(pname) && OWNER_NAME.test(p.owner || '') ? objectId(pname, p.owner) : null;
      if (pid === null) return [INCONSISTENT, [...problems, 'parent does not name a line']];
      const witnesses = new Map();
      for (const path of lv.digests.keys()) {
        const rest = path.slice('parent/signatures/'.length);
        if (path.startsWith('parent/signatures/') && !rest.includes('/')) witnesses.set(rest, await lv.read(path));
      }
      const judgements = await judgeFolder(witnesses, { objectId: pid, version: p.objectVersion, inventory: p.inventorySha512,
                                                         owner: p.owner, lookup: log ? (n, d) => log.lookup(n, d) : () => null });
      const status = lineStatuses([judgements], log ? { exposed: log.exposedKeys(), forkPoint: log.forkPoint } : {})[0];
      if (status === UNSIGNED || status === INVALID) problems.push(`the parent version is not a version: ${status} (sections 7.3 and 9.3)`);
      let result = status === SIGNED || status === VOUCHED ? CONFIRMED : UNCHECKED;
      const notes = result === CONFIRMED ? [] : [`the parent version is ${status} (section 9.3)`];
      if (problems.length) return [INCONSISTENT, problems];
      if ('parent' in pobj) {
        const inner = lv.sub('parent/');
        const chain = level(new Map([...inner.digests].filter(([path]) => isEvidence(path))), inner.read);
        const evidence = new Map([...pstate].filter(([path]) => isEvidence(path)));
        if (chain.digests.size !== evidence.size || [...evidence].some(([path, d]) => chain.digests.get(path) !== d)) {
          return [INCONSISTENT, ['parent/parent/ is not the evidence of the parent version (section 9.3)']];
        }
        const [sub, more] = await verdict(chain, pobj, genesis, logs, depth + 1);
        if (sub === INCONSISTENT) return [INCONSISTENT, more.map((m) => `parent/parent/: ${m}`)];
        notes.push(...more.map((m) => `parent/parent/: ${m}`));
        if (ORDER[sub] > ORDER[result]) result = sub;
      }
      return [result, notes];
    }
