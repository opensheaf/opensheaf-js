Signatures and the statuses of versions
=======================================

> This chapter is chapter 08 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/08-signatures.html),
> copied with its reasoning (chapter [00](00-plan.md)). "The explorer" below
> is the reader of archives this code was written for, in a browser;
> opensheaf-js reads and verifies archives with the same code, from a web
> server or from a storage (chapter [20](20-storage.md)), and the Explorer
> will import it from here.


Every sealed version of a line is signed by its owner: by `threshold`
current keys of one version of the owner's key log, each in a signature
file of the version's witness folder that names that key-log version
(section 7). From the signature files, a reader decides the status of
each file (good, unchecked or invalid), then of each version of the line
(signed directly, vouched for, contested, unchecked, or not a version:
invalid or unsigned), and so the line's latest signed version, which
gives its history, its current version and its status (section 7.3).

This chapter follows opensheaf-py's
[08-signatures](https://opensheaf.org/opensheaf-py/08-signatures.html):
the same message, the same checks in the same order, and the same
statuses, so that a version the reference implementation finds signed,
the explorer finds signed.

The module is `core/signatures.js`.

    // in core/signatures.js:
    import { verifyEd25519, utf8, unbase64 } from './crypto.js';
    import { nesting, LIMITS } from './http.js';
    import { didKeyPublic, keyId, keyDigest, OWNER_NAME, DID_KEY } from './names.js';

    export const SIGNATURE_FORMAT = 'opensheaf-signature/0.2';
    export const WITNESSES = 'extensions/opensheaf-witnesses';

The signed message
------------------

Five lines, each ended by a line feed (section 7.2); the first keeps
these signatures apart from any other use of the key, the others bind the
signature to one object version, its inventory and one key-log version.
A signature file of key `<k>` is `signature-<k>.json`, `<k>` being the
first 16 characters of the digest of the key: a reader that knows the
keys of an owner names every signature file without listing the folder,
which a server cannot do.

    // in core/signatures.js:
    export function message(objectId, version, inventory, keyLog) {
      return utf8(`${SIGNATURE_FORMAT}\nobject ${objectId}\nversion ${version}\ninventorySha512 ${inventory}\nkeyLog ${keyLog}\n`);
    }

    export async function fileName(did) {
      return `signature-${await keyId(did)}.json`;
    }

Signature files
---------------

A signature file has exactly eight fields, each of its form, its key the
canonical `did:key` of an Ed25519 key, and its `keyLog` a version of the
key log of its signer. A file that is not so is malformed. Its
`signature` is the canonical base64 of 64 bytes (section 7.2): 86
characters, the last of them `A`, `Q`, `g` or `w`, whose four bits that
encode nothing are zero, then `==`. Another encoding of the same bytes is
malformed too, so that the bytes of a signature file, which timestamps
cover, are fixed by what it says. As every JSON file read, it is nested
no deeper than `LIMITS.nesting` (chapter [10](10-http.md)), and it is
UTF-8 without a byte order mark (section 2): a file that starts with one
is malformed, as opensheaf-py finds it, not read with the mark dropped,
and said so in the words of Python's parser.

    // in core/signatures.js:
    const FIELDS = {
      format: new RegExp(`^${SIGNATURE_FORMAT.replace(/[./]/g, '\\$&')}$`),
      object: /^sheaf:[a-z2-7]{52}:[a-z2-7]{51}[aq]$/,
      version: /^v[1-9][0-9]*$/,
      inventorySha512: /^[0-9a-f]{128}$/,
      signer: OWNER_NAME,
      key: DID_KEY,
      keyLog: /^sheaf:([a-z2-7]{51}[aq])\/v([1-9][0-9]*)\?sha512=([0-9a-f]{128})$/,
      signature: /^[A-Za-z0-9+/]{85}[AQgw]==$/,
    };

    export function readSignatureFile(bytes) {
      let d;
      try {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (text.charCodeAt(0) === 0xfeff) throw new Error('Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)');
        if (nesting(text) > LIMITS.nesting) throw new Error(`nested deeper than ${LIMITS.nesting} levels`);
        d = JSON.parse(text);
      } catch (error) {
        throw new Error(`not JSON in UTF-8 (${error.message})`);
      }
      const names = Object.keys(FIELDS);
      if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).length !== names.length ||
          !names.every((n) => Object.hasOwn(d, n))) {
        throw new Error('a signature file has exactly the fields ' + names.join(', '));
      }
      for (const [field, pattern] of Object.entries(FIELDS)) {
        if (typeof d[field] !== 'string' || !pattern.test(d[field])) throw new Error(`${field} is not of its form`);
      }
      didKeyPublic(d.key);
      if (FIELDS.keyLog.exec(d.keyLog)[1] !== d.signer) throw new Error('keyLog names the key log of another owner than the signer');
      return d;
    }

The status of one file
----------------------

A signature file is judged against the version whose folder holds it
(its object, version and inventory digest), the owner of the line, and
`lookup(n, digest)`, which gives the version of the owner's key log the
file names, held or carried by a fork record, or `null` when the reader
cannot reach it. In the order of section 7.3: invalid when malformed, not
named by its key, not verifying, about another version, by another
signer, against a key-log version that is not one (a fork record, or a
version found not to be a version) or that does not list the key (for a
version of a key log: that does not commit it as a rotation key, or is
not the version before); unchecked when the key-log version is not
reached; otherwise good. A good file keeps the key, the key-log version
it names, and that version's threshold.

    // in core/signatures.js:
    export const GOOD = 'good', UNCHECKED = 'unchecked', INVALID = 'invalid';

    export async function judge(bytes, file, { objectId, version, inventory, owner, lookup, keyLog = false }) {
      const bad = (reason, d = null) => ({ file, status: INVALID, reason, key: d?.key ?? null, keyLog: null, threshold: null });
      let d;
      try {
        d = readSignatureFile(bytes);
      } catch (error) {
        return bad(`malformed: ${error.message}`);
      }
      if (file !== await fileName(d.key)) return bad('its name does not match the digest of its key');
      let signature;
      try {
        signature = unbase64(d.signature);
      } catch {
        return bad('the signature is not base64', d);
      }
      if (!await verifyEd25519(didKeyPublic(d.key), message(d.object, d.version, d.inventorySha512, d.keyLog), signature)) {
        return bad('the signature does not verify', d);
      }
      if (d.object !== objectId || d.version !== version || d.inventorySha512 !== inventory) {
        return bad('it signs another version, or another inventory', d);
      }
      if (d.signer !== owner) return bad('its signer is not the owner of the line', d);
      const [, , number, digest] = FIELDS.keyLog.exec(d.keyLog);
      const n = Number(number);
      if (keyLog && (version === 'v1' || n !== Number(version.slice(1)) - 1)) {
        return bad('a key-log version is signed against the version before it, never the first', d);
      }
      const found = lookup(n, digest);
      if (!found) {
        return { file, status: UNCHECKED, reason: `v${n} of the key log, with that digest, is not reached`,
                 key: d.key, keyLog: [n, digest], threshold: null };
      }
      if (found.forkRecord || !found.isVersion) return bad(`v${n} is not a version of the key log, or is a fork record`, d);
      const keys = found.keys || {};
      let threshold;
      if (keyLog) {
        if (!(Array.isArray(keys.next) && keys.next.includes(await keyDigest(d.key)))) {
          return bad(`the key is not a rotation key of v${n} of the key log`, d);
        }
        threshold = keys.nextThreshold;
      } else {
        if (!(Array.isArray(keys.keys) && keys.keys.includes(d.key))) return bad(`the key is not a current key of v${n} of the key log`, d);
        threshold = keys.threshold;
      }
      return { file, status: GOOD, reason: '', key: d.key, keyLog: [n, digest], threshold };
    }

The judgements of the signature files of one version, among the files of
its witness folder (a map from name to bytes), in the order of their
names; other witnesses are not signature files of the line (section 7.2).

    // in core/signatures.js:
    export async function judgeFolder(witnesses, context) {
      const names = [...witnesses.keys()].filter((n) => n.startsWith('signature-') && n.endsWith('.json')).sort();
      return Promise.all(names.map((n) => judge(witnesses.get(n), n, context)));
    }

The statuses of the versions of a line
--------------------------------------

A version is signed directly when, among its good files naming one
key-log version, at least that version's `threshold` distinct keys sign
it (section 7.3); `leaveOut` leaves out the files that do not count.

    // in core/signatures.js:
    export const SIGNED = 'signed', VOUCHED = 'vouched for', CONTESTED = 'contested', UNSIGNED = 'unsigned';

    export function signedDirectly(judgements, leaveOut = null) {
      const groups = new Map();
      for (const j of judgements) {
        if (j.status !== GOOD || (leaveOut && leaveOut(j))) continue;
        const key = j.keyLog.join(' ');
        if (!groups.has(key)) groups.set(key, { threshold: j.threshold, keys: new Set() });
        groups.get(key).keys.add(j.key);
      }
      return [...groups.values()].some((g) => g.keys.size >= g.threshold);
    }

The status of each version of one copy of a line, from the judgements of
its signature files, version by version from `v1`: signed if signed
directly, vouched for if a later version is signed directly (it extends
this one, byte for byte, inventories included: the verifier checks the
`previous` chain apart); contested if it would not be so without the
files made with a key the owner's key log exposes, or naming a version of
it from the fork point on, unless `trusted` says other evidence dates
them before; unchecked if it would be signed were its unchecked files
good; otherwise not a version, invalid if one of its files is, and
unsigned if none is.

    // in core/signatures.js:
    export function lineStatuses(versions, { exposed = new Set(), forkPoint = null, trusted = null } = {}) {
      const leaveOut = (j) => {
        const suspect = exposed.has(j.key) || (forkPoint !== null && j.keyLog[0] >= forkPoint);
        return suspect && !(trusted && trusted(j));
      };
      const direct = versions.map((js) => signedDirectly(js));
      const clean = versions.map((js) => signedDirectly(js, leaveOut));
      const would = versions.map((js) => js.some((j) => j.status === UNCHECKED) || signedDirectly(js));
      const later = (list, k) => list.slice(k).some(Boolean);
      return versions.map((js, k) => {
        if (direct[k] || later(direct, k + 1)) {
          if (clean[k] || later(clean, k + 1)) return direct[k] ? SIGNED : VOUCHED;
          return CONTESTED;
        }
        if (would[k] || later(would, k + 1)) return UNCHECKED;
        return js.some((j) => j.status === INVALID) ? INVALID : UNSIGNED;
      });
    }

The latest signed version: the number of the last version signed or
vouched for, and not contested; `null` when there is none.

    // in core/signatures.js:
    export function latestSigned(statuses) {
      let found = null;
      statuses.forEach((s, k) => { if (s === SIGNED || s === VOUCHED) found = k + 1; });
      return found;
    }

The judgements and statuses of a copy of a line of `owner`, from its
versions in order (each with its version, inventory digest and witness
files), against a key log (chapter [07](07-owners.md)), or none: then no
file can be checked, and every signature file that verifies is unchecked.

    // in core/signatures.js:
    export async function lineStatusesOf(objectId, owner, versions, log) {
      if (log) await log.check();
      const lookup = log ? (n, d) => log.lookup(n, d) : () => null;
      const judgements = await Promise.all(versions.map(({ version, digest, witnesses }) =>
        judgeFolder(witnesses, { objectId, version, inventory: digest, owner, lookup })));
      const statuses = lineStatuses(judgements, log ? { exposed: log.exposedKeys(), forkPoint: log.forkPoint } : {});
      return { judgements, statuses };
    }
