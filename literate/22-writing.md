Writing files as opensheaf-py writes them
=========================================

The files an archive keeps are named by their digests: a genesis record
by its name, an inventory by the digest a pin gives, every content file
by the digest of its inventory's manifest. Two implementations that
wrote the same content with different bytes, an indentation or an order
of keys apart, would still make valid archives, but different ones;
and one could not check the other by comparing files. So this program
writes its files as opensheaf-py does, byte for byte: the same JSON
layout, the same order of keys, the same order of entries in inventories.
Given the same inputs, the two write the same files, apart from what is
random (nonces, keys, salts) or dated.

This chapter gathers the writing of files that do not depend on an
archive: JSON as Python's `json.dumps` writes it, dates and nonces,
genesis records, inventories with their checksum files, signature files,
and the versions of a key log. The module is `core/write.js`.

    // in core/write.js:
    import { sha256, sha512bytes, hex, utf8 } from './crypto.js';
    import { GENESIS_FORMAT, KINDS, NONCE, CREATED, OWNER_NAME, keyRulesOfRecord, keeperValid, nameOf } from './names.js';
    import { KeyLog, INVENTORY_TYPE } from './owners.js';
    import { message, fileName, SIGNATURE_FORMAT, WITNESSES } from './signatures.js';
    import { compareText, joinPath, StorageError } from './storage.js';
    import { base64, randomBytes } from './keys.js';

    <<JSON as opensheaf-py writes it>>

    <<dates and nonces>>

    <<genesis records>>

    <<inventories and their checksum files>>

    <<signature files>>

    <<writing a key log>>

JSON
----

opensheaf-py writes JSON with `json.dumps(data, indent=2,
ensure_ascii=False)` and a final line feed. `JSON.stringify(data, null,
2)` writes the same text for the values the tools write: two spaces of
indentation, `": "` after a key, `[]` and `{}` for empty arrays and
objects, characters beyond ASCII as they are, and the same escapes (the
short ones for `\b \f \n \r \t`, `\u00XX` in lowercase hexadecimal for
the other control characters). Numbers are integers (section 2), written
alike. Two differences cannot arise: a lone surrogate, which Python
cannot encode in UTF-8 at all, and keys that are array indices
(`"1"`, `"25"`), which JavaScript puts first in an object; the keys the
tools write are field names and digests of 32 hexadecimal digits or more,
never array indices.

    // in JSON as opensheaf-py writes it:
    export function jsonText(value) {
      return JSON.stringify(value, null, 2) + '\n';
    }

    export function jsonBytes(value) {
      return utf8(jsonText(value));
    }

Dates and nonces
----------------

Dates and times are in UTC to the second, `2026-03-02T09:14:00Z`; a date
alone (`TODAY` in opensheaf-py) is the local date of the computer, as
Python's `date.today()`. Nonces have 128 bits from the secure generator,
in lowercase hexadecimal (section 5.1).

    // in dates and nonces:
    export function utcNow() {
      return new Date().toISOString().replace(/\.[0-9]{3}Z$/, 'Z');
    }

    export function today() {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    export function newNonce() {
      return hex(randomBytes(16));
    }

Genesis records
---------------

A genesis record (section 5.1) is written once and named by the digest
of its bytes, so its bytes are fixed: the fields in the order opensheaf-py
writes them, `format`, `kind`, `created`, then for an owner `nonce`,
`keys`, `threshold`, `next`, `nextThreshold` and optionally `keeper` and
`extensions`, and for a document or a collection `originator` and `nonce`.
The record is checked as it is made, by the rules a reader applies
(chapter [06](06-names.md)): an owner names no originator, its thresholds
fit its keys, no key is both current and rotation; a document or a
collection names its originator, an owner name, and nothing else.

    // in genesis records:
    export async function genesisRecord(kind, { originator = null, keys = null, threshold = null, next = null,
                                                nextThreshold = null, keeper = null, extensions = null,
                                                created = null, nonce = null } = {}) {
      if (!KINDS.includes(kind)) throw new Error(`unknown kind '${kind}'`);
      nonce = nonce || newNonce();
      created = created || utcNow();
      if (!NONCE.test(nonce) || !CREATED.test(created)) {
        throw new Error('a nonce of at least 128 bits in hexadecimal, and a date in UTC, are needed');
      }
      const rec = { format: GENESIS_FORMAT, kind, created };
      if (kind === 'owner') {
        if (originator !== null) throw new Error('an owner is its own originator: its genesis record names none');
        Object.assign(rec, { nonce, keys: [...(keys || [])], threshold, next: [...(next || [])], nextThreshold });
        const problems = await keyRulesOfRecord(rec);
        if (problems.length) throw new Error(problems.join('; '));
        if (keeper !== null) {
          rec.keeper = typeof keeper === 'string' ? [keeper] : [...keeper];
          if (rec.keeper.length !== 1 || !keeperValid(rec.keeper[0])) {
            throw new Error(`a keeper is one ORCID iD or https://<domain>/: '${keeper}'`);
          }
        }
        if (extensions) rec.extensions = extensions;
      } else {
        if (typeof originator !== 'string' || !OWNER_NAME.test(originator)) {
          throw new Error(`the originator must be an owner name: '${originator}'`);
        }
        if ([keys, threshold, next, nextThreshold, keeper, extensions].some((v) => v !== null)) {
          throw new Error('keys, thresholds, keeper and extensions are only for an owner');
        }
        Object.assign(rec, { originator, nonce });
      }
      return jsonBytes(rec);
    }

Inventories
-----------

An inventory (OCFL 1.1, section 3.5) is a JSON object whose digest is
the pin of its version; opensheaf-py writes its members in a fixed order,
its `ordered_inventory`, and so does this program:

- the top-level fields sorted by name (`contentDirectory`,
  `digestAlgorithm`, `fixity`, `head`, `id`, `manifest`, `type`,
  `versions`);
- the manifest by the place of the first content path of each digest:
  the number of its version, then the rest of the path;
- the versions by their numbers; in each, `created`, `state`, `message`,
  `user`, then any other field by name; and the state by the first
  logical path of each digest.

`fixity` keeps the order in which its entries were added. Strings are
compared by code points, as Python compares them (chapter
[20](20-storage.md)).

    // in inventories and their checksum files:
    function place(contentPath) {
      const k = contentPath.indexOf('/');
      const ver = k < 0 ? contentPath : contentPath.slice(0, k);
      const rest = k < 0 ? '' : contentPath.slice(k + 1);
      return [/^[0-9]+$/.test(ver.slice(1)) ? Number(ver.slice(1)) : 0, rest];
    }

    function comparePlace(a, b) {
      return a[0] - b[0] || compareText(a[1], b[1]);
    }

    function smallest(list, compare) {
      return list.reduce((best, x) => (compare(x, best) < 0 ? x : best));
    }

    const sortedKeys = (o) => Object.keys(o).sort(compareText);

    function orderedVersion(e) {
      const out = {};
      for (const k of ['created', 'state', 'message', 'user']) if (k in e) out[k] = e[k];
      out.state = Object.fromEntries(Object.entries(e.state)
        .map(([d, paths]) => [d, paths, smallest(paths, compareText)])
        .sort((x, y) => compareText(x[2], y[2])).map(([d, paths]) => [d, paths]));
      for (const k of sortedKeys(e)) if (!(k in out)) out[k] = e[k];
      return out;
    }

    export function orderedInventory(inv) {
      const out = {};
      for (const k of sortedKeys(inv)) out[k] = inv[k];
      out.manifest = Object.fromEntries(Object.entries(inv.manifest)
        .map(([d, paths]) => [d, paths, place(smallest(paths, (a, b) => comparePlace(place(a), place(b))))])
        .sort((x, y) => comparePlace(x[2], y[2])).map(([d, paths]) => [d, paths]));
      out.versions = {};
      for (const k of Object.keys(inv.versions).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
        out.versions[k] = orderedVersion(inv.versions[k]);
      }
      return out;
    }

The inventory file is that object as JSON (the computed first version of a
key log is the exception: its inventory is canonical JSON, chapter
[07](07-owners.md)); its checksum file holds its SHA-512 digest, two
spaces and its name.

    // in inventories and their checksum files:
    export function inventoryFile(inv) {
      return jsonBytes(inv);
    }

    export async function sha512hex(bytes) {
      return hex(await sha512bytes(bytes));
    }

    export async function sidecar(inventoryBytes) {
      return utf8(`${await sha512hex(inventoryBytes)}  inventory.json\n`);
    }

    export async function sha256hex(bytes) {
      return hex(await sha256(bytes));
    }

    export async function md5hex(bytes) {
      const hashWasm = await import('hash-wasm');
      return hashWasm.md5(bytes);
    }

Signature files
---------------

A signature file (section 7.2) states what it signs and holds the
signature of the message of section 7.2 (chapter
[08](08-signatures.md)), in base64. opensheaf-py writes it with
`json.dumps(d, indent=2)`, which escapes characters beyond ASCII; every
field of a signature file is ASCII, so the bytes are the same.

    // in signature files:
    export async function signatureFile(key, objectId, version, inventory, signer, keyLog) {
      const signature = await key.sign(message(objectId, version, inventory, keyLog));
      return jsonBytes({ format: SIGNATURE_FORMAT, object: objectId, version, inventorySha512: inventory,
                         signer, key: key.did, keyLog, signature: base64(signature) });
    }

    export { fileName as signatureFileName, WITNESSES };

The key log of a new owner
--------------------------

A new owner (section 6.2) is its genesis record: its current keys and the
digests of its rotation keys, with their thresholds. The first version of
its key log is computed from the record (chapter [07](07-owners.md)), so
the whole key log of a new owner is `KeyLog.of(genesis)`, checked before it
is given (chapter [07](07-owners.md): a key log answers only once checked). The default
`nextThreshold` is a majority of the rotation keys, as in opensheaf-py.

    // in writing a key log:
    export async function newOwner(current, rotation, { threshold = 1, nextThreshold = null, keeper = null,
                                                        extensions = null, created = null, nonce = null } = {}) {
      const genesis = await genesisRecord('owner', {
        keys: current.map((k) => (typeof k === 'string' ? k : k.did)), threshold,
        next: rotation.map((k) => (typeof k === 'string' ? k : k.digest)),
        nextThreshold: nextThreshold || Math.floor(rotation.length / 2) + 1,
        keeper, extensions, created, nonce,
      });
      const log = await KeyLog.of(genesis);
      await log.check();
      return log;
    }

A key log is written into its OCFL object folder (`dir`, a path in a
storage) as opensheaf-py's `write_key_log` writes it: the declaration of
the object, then each version not held yet, its content files where its
manifest puts them, its inventory and checksum file, its witness files
(never replaced), and last the root inventory, by a rename, so that the
object never names a version it does not have. A version already held
must have the inventory the key log has, or the folder holds another key
log.

    // in writing a key log:
    export async function writeKeyLog(storage, dir, log) {
      const namaste = joinPath(dir, '0=ocfl_object_1.1');
      if ((await storage.kind(namaste)) !== 'file') await storage.write(namaste, utf8('ocfl_object_1.1\n'));
      let held = 0;
      const root = await storage.read(joinPath(dir, 'inventory.json'));
      if (root) held = Number(JSON.parse(new TextDecoder().decode(root)).head.slice(1));
      for (const v of log.versions.slice(0, held)) {
        const bytes = await storage.read(joinPath(dir, `v${v.number}`, 'inventory.json'));
        if (!bytes || bytes.length !== v.inventory.length || bytes.some((b, k) => b !== v.inventory[k])) {
          throw new StorageError(`${dir}: v${v.number} differs from that of the key log of ${log.owner}`);
        }
      }
      for (const v of log.versions.slice(held)) {
        const inv = JSON.parse(new TextDecoder().decode(v.inventory));
        const byDigest = new Map();
        for (const bytes of v.files.values()) byDigest.set(await sha512hex(bytes), bytes);
        for (const [d, paths] of Object.entries(inv.manifest)) {
          for (const cp of paths) {
            if (cp.startsWith(`v${v.number}/`)) await storage.write(joinPath(dir, cp), byDigest.get(d));
          }
        }
        await storage.write(joinPath(dir, `v${v.number}`, 'inventory.json'), v.inventory);
        await storage.write(joinPath(dir, `v${v.number}`, 'inventory.json.sha512'),
                            v.sidecar?.length ? v.sidecar : await sidecar(v.inventory));
      }
      for (const v of log.versions) {
        for (const [name, bytes] of v.witnesses || []) {
          const path = joinPath(dir, WITNESSES, `v${v.number}`, name);
          if (!(await storage.kind(path))) await storage.write(path, bytes, { exclusive: true });
        }
      }
      if (log.versions.length > held) {
        const head = log.versions[log.versions.length - 1];
        await storage.write(joinPath(dir, 'inventory.json.tmp'), head.inventory);
        await storage.rename(joinPath(dir, 'inventory.json.tmp'), joinPath(dir, 'inventory.json'));
        await storage.write(joinPath(dir, 'inventory.json.sha512'),
                            head.sidecar?.length ? head.sidecar : await sidecar(head.inventory));
      }
    }

    export { nameOf, INVENTORY_TYPE };
