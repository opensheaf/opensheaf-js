Key logs, changed
=================

The key log of an owner (section 6) is read and checked by chapter
[07](07-owners.md), which is the Explorer's and only reads. This chapter
writes it on: the versions that change the keys of an owner (rotating,
section 6.2), expose some (section 6.3) or end it, each signed by enough
rotation keys of the version before; the fork record that a copy of a key
log appends when it meets another copy that forks from it; the meeting of
two copies (`osheaf owner pull`, sections 6.3 and 6.5); the description
of a key log for a person (`osheaf owner show`); and the reading of a key
log from an OCFL object folder that is not in an archive (`osheaf owner
pull PATH`, `osheaf init --owner NAME --key-log DIR`). It follows
opensheaf-py's chapter
[06-owners](https://opensheaf.org/opensheaf-py/06-owners.html), and writes
the same files: the bytes of `keys.json`, of the inventories and of the
signature files of a new version are those opensheaf-py writes, the date
of the version and the random keys aside.

The module is `core/keylogs.js`.

    // in core/keylogs.js:
    import { sha256, base32, utf8, sameBytes } from './crypto.js';
    import { objectId, keyDigest, didKeyPublic, jcsBytes, OWNER_NAME, GENESIS, isObject } from './names.js';
    import { KeyLog, Version, ownerObject, keyRules, jsonOrNull, sidecarDigest, RESERVED, INVENTORY_TYPE } from './owners.js';
    import { WITNESSES } from './signatures.js';
    import { jsonBytes, orderedInventory, inventoryFile, sidecar, sha512hex, signatureFile, signatureFileName,
             utcNow } from './write.js';
    import { joinPath } from './storage.js';

    <<errors of key logs>>

    <<the files of a new version>>

    <<adding a version to a key log>>

    <<rotating, exposing and ending>>

    <<fork records, and meeting another copy>>

    <<a key log for a person>>

    <<a key log read from a folder>>

The files of a new version
--------------------------

A version after the first holds three files: the genesis record, as in
every version; `object.json`, the owner object naming the digest of the
inventory of the version before (section 4.3), in canonical JSON as the
computed first version has it; and `keys.json` (section 6.1); the owner object is canonical JSON (RFC
8785), as opensheaf-py's `owner_object` writes it; `keys.json` is written as
opensheaf-py writes it, with `json.dumps(indent=2)`: its format, then
either the keys, the threshold, the digests of the next rotation keys and
how many of them sign, or, for the ending version, `ended` and the
successor; then the extensions in force and the keys exposed.

    // in errors of key logs:
    export class OwnerError extends Error {}

    const OBJ = 'object.json', KEYS = 'keys.json', FORKED = 'forked/';
    const KEYS_FORMAT = 'opensheaf-keys/0.2';

The file `keys.json` of a new version:

    // in the files of a new version:
    export function keysFile({ keys = null, threshold = null, next = null, nextThreshold = null, extensions = null,
                               exposed = null, ended = false, successor = null } = {}) {
      const d = { format: KEYS_FORMAT };
      if (ended) {
        if ([keys, threshold, next, nextThreshold].some((v) => v !== null && v !== undefined)) {
          throw new OwnerError('an ending version has no keys, threshold, next or nextThreshold (section 6.3)');
        }
        d.ended = true;
        if (successor !== null && successor !== undefined) d.successor = successor;
      } else {
        if (successor !== null && successor !== undefined) throw new OwnerError('only an ending version names a successor (section 6.3)');
        Object.assign(d, { keys: [...keys], threshold, next: [...next], nextThreshold });
      }
      if (extensions && Object.keys(extensions).length) d.extensions = extensions;
      if (exposed && exposed.length) d.exposed = [...exposed];
      return jsonBytes(d);
    }

The inventory of a new version extends the inventory of the version
before, as opensheaf-py's `inventory` does: each file not held yet is
added to the manifest under the new version's content folder, the state
lists every file of the version, and the whole is put in the order of
chapter [22](22-writing.md).

    // in the files of a new version:
    export async function extendInventory(prev, id, number, files, created, message = null, user = null) {
      const v = `v${number}`;
      if (prev.head !== `v${number - 1}` || prev.id !== id) throw new OwnerError(`${v} must follow v${number - 1} of ${id}`);
      const inv = JSON.parse(JSON.stringify(prev));
      const content = inv.contentDirectory || 'content';
      inv.head = v;
      const state = {};
      for (const path of [...files.keys()].sort()) {
        const d = await sha512hex(files.get(path));
        if (!(d in inv.manifest)) inv.manifest[d] = [`${v}/${content}/${path}`];
        (state[d] ||= []).push(path);
      }
      const entry = { created, state };
      if (message !== null) entry.message = message;
      if (user !== null) entry.user = user;
      inv.versions[v] = entry;
      return orderedInventory(inv);
    }

    function keyOf(k) {
      return typeof k === 'string' ? k : k.did;
    }

    async function digestOf(k) {
      if (typeof k !== 'string') return k.digest;
      if (k.startsWith('did:key:')) {
        didKeyPublic(k);
        return keyDigest(k);
      }
      if (!OWNER_NAME.test(k)) throw new OwnerError(`not a key, a did:key URI or the digest of a key: '${k}'`);
      return k;
    }

Adding a version
----------------

A version is added only to a key log without errors, and that has not
ended; it is signed by rotation keys of the version before, at least as
many as its `nextThreshold`; its `keys.json` obeys the rules of section
6.1 given the versions before. The signature files name the version
before as `keyLog` (section 7.2). The new version is then checked with the
whole key log, as a reader checks it, and refused if it would not be a
version of it.

    // in adding a version to a key log:
    export async function checked(log) {
      log.checked = null;
      return log.check();
    }

    async function prepare(log, signers) {
      const { errors } = await checked(log);
      if (errors.length) throw new OwnerError('the key log has errors: ' + errors.join('; '));
      if (log.ended) throw new OwnerError(`the owner ${log.owner} has ended (section 6.3): nothing is signed for it`);
      const side = log.side();
      const prev = side[side.length - 1];
      const rotation = new Set(prev.keys.next);
      for (const key of signers) {
        if (!rotation.has(key.digest)) throw new OwnerError(`${key.did} is not a rotation key of v${prev.number} (section 6.1)`);
      }
      const need = prev.keys.nextThreshold, have = new Set(signers.map((k) => k.did)).size;
      if (have < need) throw new OwnerError(`v${prev.number} needs ${need} rotation keys to sign the next version, ${have} given`);
      return prev;
    }

    export async function append(log, version) {
      log.versions.push(version);
      const { errors } = await checked(log);
      if (errors.length) {
        log.versions.pop();
        await checked(log);
        throw new OwnerError('the new version would not be a version of the key log: ' + errors.join('; '));
      }
      return version;
    }

    export async function addVersion(log, keysBytes, signers, { message, user, created = null, files = null }) {
      const prev = await prepare(log, signers);
      const problems = await keyRules(jsonOrNull(keysBytes, { integers: true }), log.side().map((v) => v.keys), log.owner);
      if (problems.length) throw new OwnerError(problems.join('; '));
      for (const path of (files || new Map()).keys()) {
        if (RESERVED.includes(path.split('/')[0])) throw new OwnerError(`${path}: a name reserved by section 4.1`);
      }
      const n = prev.number + 1;
      const content = new Map([[GENESIS, log.genesis], [OBJ, jcsBytes(ownerObject(log.owner, prev.digest))],
                               [KEYS, keysBytes], ...(files || new Map())]);
      const inv = await extendInventory(JSON.parse(new TextDecoder().decode(prev.inventory)), log.id, n, content,
                                        created || utcNow(), message, user);
      const invBytes = inventoryFile(inv);
      const digest = await sha512hex(invBytes);
      const pin = log.pin(prev.number);
      const witnesses = new Map();
      for (const key of signers) {
        witnesses.set(await signatureFileName(key.did),
                      await signatureFile(key, log.id, `v${n}`, digest, log.owner, pin));
      }
      return append(log, await Version.make(n, content, invBytes, await sidecar(invBytes), witnesses));
    }

Rotating, exposing, ending
--------------------------

A rotation (section 6.2) keeps the current keys of the latest version,
less those retired and those exposed, adds the new ones, and commits new
rotation keys by their digests; the threshold stays unless given, and the
extensions in force are carried. An exposure (section 6.3) is a rotation
that also lists the keys exposed, which leave the current keys. The ending
version names the successor, if any, and may expose keys too.

    // in rotating, exposing and ending:
    export async function rotate(log, signers, { nextKeys, nextThreshold, add = [], retire = [], exposed = [],
                                                 threshold = null, extensions = undefined,
                                                 message = 'Keys changed', user, created = null }) {
      await checked(log);
      const prev = log.latest();
      if (!prev) throw new OwnerError(`the owner ${log.owner} has ended (section 6.3): nothing is signed for it`);
      const current = prev.keys.keys;
      for (const did of retire) if (!current.includes(did)) throw new OwnerError(`${did} is not a current key of ${log.owner}`);
      const keys = current.filter((k) => !retire.includes(k) && !exposed.includes(k));
      for (const k of add) if (!keys.includes(keyOf(k))) keys.push(keyOf(k));
      if (extensions === undefined) extensions = log.extensions();
      const next = [];
      for (const k of nextKeys) next.push(await digestOf(k));
      const data = keysFile({ keys, threshold: threshold || prev.keys.threshold, next, nextThreshold, extensions,
                              exposed: exposed.length ? exposed : null });
      return addVersion(log, data, signers, { message, user, created });
    }

    export async function expose(log, signers, exposed, options) {
      return rotate(log, signers, { message: 'Keys exposed', ...options, exposed });
    }

    export async function end(log, signers, { successor = null, exposed = [], message = 'Owner ended', user, created = null }) {
      if (successor === log.owner) throw new OwnerError('the successor of an owner is another owner (section 6.3)');
      const data = keysFile({ ended: true, successor, exposed: exposed.length ? exposed : null });
      return addVersion(log, data, signers, { message, user, created });
    }

Fork records, and meeting another copy
--------------------------------------

Two copies of a key log that hold different versions of one number have
forked (section 6.3). A copy that meets the other side appends a **fork
record**: a version without `keys.json`, carrying the versions of the
other side from the fork point on under `forked/<d>/`, `d` the first 16
characters of the base32 SHA-256 digest of the inventory carried, each
with its inventory, checksum file, `keys.json` and signature files. The
owner has then ended.

    // in fork records, and meeting another copy:
    export async function recordFork(log, other, { user, message = 'Fork record: another version met', created = null }) {
      const { errors } = await checked(log);
      if (errors.length) throw new OwnerError('the key log has errors: ' + errors.join('; '));
      if (log.forkRecord) throw new OwnerError('a fork met once the key log has a fork record is reported, not recorded');
      const prev = log.versions[log.versions.length - 1];
      const content = new Map([[GENESIS, log.genesis], [OBJ, jcsBytes(ownerObject(log.owner, prev.digest))]]);
      for (const v of other) {
        const base = `${FORKED}${base32(await sha256(v.inventory)).slice(0, 16)}/`;
        content.set(base + 'inventory.json', v.inventory);
        content.set(base + 'inventory.json.sha512', v.sidecar?.length ? v.sidecar : await sidecar(v.inventory));
        content.set(base + 'keys.json', v.files.get(KEYS) ?? v.files.get('keys.json'));
        for (const [name, bytes] of v.witnesses) content.set(base + name, bytes);
      }
      const n = prev.number + 1;
      const inv = await extendInventory(JSON.parse(new TextDecoder().decode(prev.inventory)), log.id, n, content,
                                        created || utcNow(), message, user);
      const invBytes = inventoryFile(inv);
      return append(log, await Version.make(n, content, invBytes, await sidecar(invBytes)));
    }

Meeting another copy (`pull`, opensheaf-py's `KeyLog.pull`): if the two
differ at some version held by both, a fork record carries the other's
versions from there; if the other is longer, its versions (and its fork
record, if any) are appended; if the other holds a fork record whose first
carried version differs from one held here, that fork is met too. The
answer is what happened and a number: `extended` and how many versions,
`fork` and the fork point, `reported` (a second fork, which is not
recorded), `same` or `behind`.

    // in fork records, and meeting another copy:
    async function copyOf(v) {
      return Version.make(v.number, v.files, v.inventory, v.sidecar, v.witnesses);
    }

    async function metFork(log, otherSide, user, created) {
      if (log.forkRecord) return ['reported', otherSide[0].number];
      await recordFork(log, otherSide, { user, created });
      return ['fork', otherSide[0].number];
    }

    export async function pull(log, other, { user, created = null }) {
      if (!sameBytes(other.genesis, log.genesis)) throw new OwnerError('the other copy is the key log of another owner');
      const { errors } = await checked(log);
      if (errors.length) throw new OwnerError('the key log has errors: ' + errors.join('; '));
      await other.check();
      const mine = log.side(), theirs = other.side();
      for (let k = 0; k < Math.min(mine.length, theirs.length); k++) {
        if (mine[k].digest !== theirs[k].digest) return metFork(log, theirs.slice(mine[k].number - 1), user, created);
      }
      const theirFork = other.forkRecord;
      if (theirs.length > mine.length) {
        if (log.forkRecord) return ['reported', mine.length + 1];
        for (const v of [...theirs.slice(mine.length), ...(theirFork ? [theirFork] : [])]) await append(log, await copyOf(v));
        return ['extended', theirs.length - mine.length + (theirFork ? 1 : 0)];
      }
      if (theirFork) {
        const first = theirFork.carried[0];
        const held = first.number <= mine.length ? mine[first.number - 1] : null;
        if (held && held.digest !== first.digest) {
          if (log.forkRecord) return ['reported', first.number];
          if (theirs.length === mine.length && log.versions[log.versions.length - 1] === mine[mine.length - 1]) {
            await append(log, await copyOf(theirFork));
            return ['fork', first.number];
          }
          return metFork(log, theirFork.carried, user, created);
        }
      }
      return [theirs.length === mine.length ? 'same' : 'behind', 0];
    }

A key log for a person
----------------------

`osheaf owner show` describes a key log line by line, as opensheaf-py's
`describe` does: the owner, its keeper and how the link to it stands
(chapter [32](32-keepers.md)), a successor the keeper names, each version
with the first 16 characters of its digest and what it says, the current
keys (those on this computer marked), the keys exposed, the status of an
owner that has ended, and the errors and warnings of the key log.

    // in a key log for a person:
    function count(items, noun) {
      return `${items.length} ${noun}` + (items.length === 1 ? '' : 's');
    }

    function signers(items, threshold, noun, what) {
      if (items.length === 1) return count(items, noun);
      const verb = threshold === 1 ? what.replace('sign', 'signs') : what;
      return `${count(items, noun)} (any ${threshold} ${verb})`;
    }

    export async function describeLog(log, here = [], link = null, successorClaim = () => null) {
      const { errors, warnings } = await log.check();
      const rec = jsonOrNull(log.genesis) || {};
      const out = [`Owner         ${log.owner}`];
      if (Array.isArray(rec.keeper) && rec.keeper.length) {
        const how = link ? `  ${link.status}` + (link.reason ? ` (${link.reason})` : '') : '';
        out.push(`Keeper        ${rec.keeper[0]}${how}`);
        const claim = successorClaim(log, link);
        if (claim) out.push(`Successor     ${link.successor}  ${claim}`);
      }
      log.versions.forEach((v, i) => {
        const k = v.keys || {};
        const arr = (x) => (Array.isArray(x) ? x : []);
        const what = v.forkRecord ? 'fork record, carrying ' + v.carried.map((c) => `v${c.number}`).join(', ')
          : k.ended ? 'ended' + (k.successor ? `, successor ${k.successor}` : '')
          : signers(arr(k.keys), k.threshold, 'current key', 'sign') + ', ' +
            signers(arr(k.next), k.nextThreshold, 'rotation key', 'sign the next version') +
            (arr(k.exposed).length ? `, exposes ${k.exposed.length}` : '');
        const mark = v.isVersion ? '' : ' (not a version)';
        out.push(`${(i === 0 ? 'Key log' : '').padEnd(14)}v${v.number}  ${v.digest.slice(0, 16)}  ${what}${mark}`);
      });
      const latest = log.latest();
      if (latest) {
        latest.keys.keys.forEach((did, i) => {
          out.push(`${(i === 0 ? 'Current keys' : '').padEnd(14)}${did}` + (here.includes(did) ? '  (on this computer)' : ''));
        });
      }
      [...log.exposedKeys()].sort().forEach((did, i) => out.push(`${(i === 0 ? 'Exposed keys' : '').padEnd(14)}${did}`));
      if (log.forkPoint) out.push(`Status        ended by a fork at v${log.forkPoint}`);
      else if (log.ended) out.push('Status        ended');
      out.push(...errors.map((e) => `Error: ${e}`), ...warnings.map((w) => `Warning: ${w}`));
      return out;
    }

A key log read from a folder
----------------------------

The key log held in an OCFL object folder, read through a storage (`dir`,
the folder's path in it), as opensheaf-py's `load_key_log` reads it: each
version's inventory, checksum file, content and witness files, every
witness file of the version (the reader of archives of chapter
[14](14-archive.md) reads only those of the rotation keys it expects). What
is missing or wrong is recorded as a problem of the key log, which its
check reports; a folder without an inventory, or without a genesis record,
is not a key log at all.

    // in a key log read from a folder:
    function contentPath(cp, inv, n) {
      const cd = isObject(inv) && typeof inv.contentDirectory === 'string' ? inv.contentDirectory : 'content';
      const safe = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\\') &&
        p.split('/').every((x) => !['', '.', '..'].includes(x));
      if (!safe(cp) || !safe(cd) || cd.includes('/')) return false;
      const parts = cp.split('/');
      return parts.length >= 3 && /^v[1-9][0-9]*$/.test(parts[0]) && parts[1] === cd && Number(parts[0].slice(1)) <= n;
    }

    export async function loadKeyLog(storage, dir, where = dir) {
      const problems = [], versions = [];
      const root = await storage.read(joinPath(dir, 'inventory.json'));
      const rootInv = jsonOrNull(root);
      const head = typeof rootInv?.head === 'string' && /^v[0-9]+$/.test(rootInv.head) ? Number(rootInv.head.slice(1)) : NaN;
      if (!root || !Number.isInteger(head)) throw new OwnerError(`${where}: not an OCFL object with an inventory`);
      for (let n = 1; n <= head; n++) {
        const vdir = joinPath(dir, `v${n}`);
        const invBytes = await storage.read(joinPath(vdir, 'inventory.json'));
        const entry = jsonOrNull(invBytes);
        if (!invBytes || !isObject(entry?.manifest) || !isObject(entry?.versions?.[`v${n}`]?.state)) {
          problems.push(`v${n}: no readable inventory in the version folder (section 4.1)`);
          break;
        }
        const sc = (await storage.read(joinPath(vdir, 'inventory.json.sha512'))) || new Uint8Array();
        if (sidecarDigest(sc) !== await sha512hex(invBytes)) problems.push(`v${n}: the checksum file does not state the digest of the inventory`);
        const files = new Map();
        for (const [d, paths] of Object.entries(entry.versions[`v${n}`].state)) {
          if (!Array.isArray(paths) || !paths.length) continue;
          let bytes = new Uint8Array();
          const cp = entry.manifest[d]?.[0];
          if (!contentPath(cp, entry, n)) {
            problems.push(`v${n}: a content path out of the object: '${cp}'`);
            problems.push(`v${n}: the content of ${paths[0]} is missing`);
          } else {
            bytes = (await storage.read(joinPath(dir, cp))) ?? (problems.push(`v${n}: the content of ${paths[0]} is missing`), new Uint8Array());
          }
          if ((await sha512hex(bytes)) !== d) problems.push(`v${n}: ${paths[0]} does not have the digest its inventory states`);
          for (const p of paths) files.set(p, bytes);
        }
        const witnesses = new Map();
        const wdir = joinPath(dir, WITNESSES, `v${n}`);
        for (const { name, kind } of (await storage.list(wdir)) || []) {
          if (kind === 'file') witnesses.set(name, await storage.read(joinPath(wdir, name)));
        }
        versions.push(await Version.make(n, files, invBytes, sc, witnesses));
      }
      if (!versions.length || !versions[0].files.has(GENESIS)) throw new OwnerError(`${where}: no genesis record in the first version`);
      if (versions[versions.length - 1].number === head && !sameBytes(root, versions[versions.length - 1].inventory)) {
        problems.push('the root inventory differs from that of the head version');
      }
      const log = await KeyLog.of(versions[0].files.get(GENESIS), versions, problems);
      if (rootInv.id !== log.id) problems.push(`the identifier of the object is not ${log.id}, that of the owner its genesis record names`);
      return log;
    }

    export { INVENTORY_TYPE, objectId };
