Owners and their key logs
=========================

> This chapter is chapter 07 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/07-owners.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


An owner is a keyed identity, an object of kind `owner` whose versions
are its key log (section 6). The first version is computed from the
owner's genesis record; each later one lists the owner's current keys and
commits the digests of the rotation keys that sign the next, and is
signed by rotation keys of the version before. Signatures of the
owner's lines name a version of its key log, and are judged against it
(chapter [08](08-signatures.md)); so a reader checks the key log first,
version by version from the first, as section 14.3 says.

The explorer reads a key log over HTTP (chapter [14](14-archive.md)) into
the versions described here, then checks it with the class `KeyLog`,
which follows the class of the same name of opensheaf-py's chapter
[06-owners](https://opensheaf.org/opensheaf-py/06-owners.html) check by
check, with the same words, so that `osheaf verify` and the explorer
report the same problems.

The module is `core/owners.js`.

    // in core/owners.js:
    import { sha512, parseIntegers } from './http.js';
    import { sha256, base32, sameBytes, utf8 } from './crypto.js';
    import { readGenesis, nameOf, objectId, keyLogPin, keyDigest, keyRulesOfRecord, jcsBytes, isObject,
             OWNER_NAME, DID_KEY, GENESIS } from './names.js';
    import { judgeFolder, GOOD } from './signatures.js';
    import { same } from './schema.js';

    export const OBJECT_FORMAT = 'opensheaf-object/0.2';
    export const KEYS_FORMAT = 'opensheaf-keys/0.2';
    export const INVENTORY_TYPE = 'https://ocfl.io/1.1/spec/#inventory';
    const OBJ = 'object.json', KEYS = 'keys.json', FORKED = 'forked/';
    export const RESERVED = ['object.json', 'datacite.json', 'genesis.json', 'members.json', 'keys.json', 'forked',
                             'parent'];

Versions
--------

A version of a key log, as a reader holds it: its number, its files (a
map from logical path to bytes), its inventory file and checksum file,
and the files of its witness folder that the reader found. Its digest,
the SHA-512 of its inventory file, is computed when it is made, since
WebCrypto is asynchronous; `keys` is its `keys.json` read as JSON whose
numbers are all exact integers (chapter [10](10-http.md)), or `null`
(opensheaf-py reads a threshold of `1.0` as a float, which breaks rule 1). A version holding no `keys.json` and files under `forked/` is a
fork record (section 6.3), whose carried versions are read from those
files.

    // in core/owners.js:
    export class Version {
      static async make(number, files, inventory, sidecar = null, witnesses = new Map()) {
        const v = new Version(number, files, inventory, sidecar, witnesses);
        v.digest = await sha512(inventory);
        if (v.forkRecord) v.carried = await carriedOf(files);
        return v;
      }

      constructor(number, files, inventory, sidecar, witnesses) {
        Object.assign(this, { number, files, inventory, sidecar, witnesses, isVersion: true, carried: [] });
      }

      get keys() {
        return jsonOrNull(this.files.get(KEYS), { integers: true });
      }

      get forkRecord() {
        return !this.files.has(KEYS) && [...this.files.keys()].some((p) => p.startsWith(FORKED));
      }
    }

    export function jsonOrNull(bytes, { integers = false } = {}) {
      if (!bytes) return null;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return integers ? parseIntegers(text) : JSON.parse(text);
      } catch {
        return null;
      }
    }

A carried version is a version of the other side of a fork, held under
`forked/<d>/` in a fork record: its inventory file and checksum file, its
`keys.json`, and its signature files with their witnesses (section 6.3).
Its number is the head of its inventory.

    // in core/owners.js:
    const CARRIED_FILES = ['inventory.json', 'inventory.json.sha512', 'keys.json'];

    async function carriedOf(files) {
      const groups = new Map();
      for (const [path, bytes] of files) {
        if (!path.startsWith(FORKED)) continue;
        const rest = path.slice(FORKED.length);
        const k = rest.indexOf('/');
        const d = k < 0 ? rest : rest.slice(0, k);
        if (!groups.has(d)) groups.set(d, new Map());
        groups.get(d).set(k < 0 ? '' : rest.slice(k + 1), bytes);
      }
      const out = [];
      for (const [d, group] of groups) {
        const inventory = group.get('inventory.json') || new Uint8Array();
        const inv = jsonOrNull(inventory);
        const head = isObject(inv) ? inv.head : null;
        const number = typeof head === 'string' && /^v[0-9]+$/.test(head) ? Number(head.slice(1)) : null;
        out.push({
          d, files: group, inventory, sidecar: group.get('inventory.json.sha512') || new Uint8Array(),
          digest: await sha512(inventory), number, isVersion: true, forkRecord: false,
          keys: jsonOrNull(group.get('keys.json'), { integers: true }),
          witnesses: new Map([...group].filter(([n]) => !CARRIED_FILES.includes(n))),
        });
      }
      return out.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    }

The digest a checksum file states: two words, the digest and
`inventory.json`; `null` if it says anything else.

    // in core/owners.js:
    export function sidecarDigest(bytes) {
      if (!bytes) return null;
      let text;
      try {
        text = new TextDecoder('ascii', { fatal: true }).decode(bytes);
      } catch {
        return null;
      }
      const parts = text.split(/\s+/).filter(Boolean);
      return parts.length === 2 && parts[1] === 'inventory.json' ? parts[0].toLowerCase() : null;
    }

The computed first version
--------------------------

The first version holds exactly three files whose bytes are fixed by the
genesis record (section 6.1): the record itself; `object.json`, the JCS
form of the fields of an owner object; and `keys.json`, the JCS form of
the keys, thresholds and rotation keys of the record. Its inventory is
the JCS form of the OCFL inventory of these files, with the `created` of
the record and nothing else, so that every reader rebuilds it, and its
digest, from the genesis record alone.

    // in core/owners.js:
    export function ownerObject(owner, previous = null) {
      const d = { format: OBJECT_FORMAT, specification: '0.2', kind: 'owner', status: 'active', name: owner, owner };
      if (previous !== null) d.previous = previous;
      return d;
    }

    export async function firstVersion(genesis) {
      const rec = await readGenesis(genesis);
      if (rec.kind !== 'owner') throw new Error('the genesis record of an owner has kind owner');
      const owner = await nameOf(genesis);
      const files = new Map([
        [GENESIS, genesis],
        [OBJ, jcsBytes(ownerObject(owner))],
        [KEYS, jcsBytes({ format: KEYS_FORMAT, keys: rec.keys, threshold: rec.threshold, next: rec.next,
                          nextThreshold: rec.nextThreshold })],
      ]);
      const manifest = {}, state = {};
      for (const [path, bytes] of files) {
        const d = await sha512(bytes);
        manifest[d] = [`v1/content/${path}`];
        state[d] = [path];
      }
      const inv = { digestAlgorithm: 'sha512', head: 'v1', id: objectId(owner, owner), manifest,
                    type: INVENTORY_TYPE, versions: { v1: { created: rec.created, state } } };
      const bytes = jcsBytes(inv);
      return Version.make(1, files, bytes, utf8(`${await sha512(bytes)}  inventory.json\n`));
    }

The rules across versions
-------------------------

Every `keys.json` after the first obeys the rules of section 6.1 against
the versions before it on its side: an ending version has no keys and
names a successor other than itself (section 6.3); the others obey the
rules of a genesis record; and across versions, no exposed key is current
again, no rotation key is ever current, a digest is committed in one
`next` only, and only keys once current are exposed (rules 2 to 4).

    // in core/owners.js:
    const KEYS_FIELDS = ['format', 'keys', 'threshold', 'next', 'nextThreshold', 'extensions', 'ended', 'successor', 'exposed'];

    export async function keyRules(k, earlier, owner) {
      if (!isObject(k) || k.format !== KEYS_FORMAT) return [`keys.json is not of format ${KEYS_FORMAT}`];
      const problems = [];
      const extra = Object.keys(k).filter((f) => !KEYS_FIELDS.includes(f)).sort();
      if (extra.length) problems.push('keys.json has fields the specification does not define: ' + extra.join(', '));
      if ('ended' in k && k.ended !== true) problems.push('ended, when present, is true');
      if (k.ended === true) {
        if (['keys', 'threshold', 'next', 'nextThreshold'].some((f) => f in k)) {
          problems.push('an ending version has no keys, threshold, next or nextThreshold (section 6.3)');
        }
        const succ = k.successor;
        if (succ !== undefined && succ !== null && (typeof succ !== 'string' || !OWNER_NAME.test(succ) || succ === owner)) {
          problems.push('successor is the owner name of another owner (section 6.3)');
        }
      } else {
        if ('successor' in k) problems.push('only an ending version names a successor (section 6.3)');
        problems.push(...await keyRulesOfRecord(k));
      }
      if ('extensions' in k && !(isObject(k.extensions) && Object.values(k.extensions).every(isObject))) {
        problems.push('extensions maps names of extensions to objects');
      }
      let exposed = Array.isArray(k.exposed) ? k.exposed : [];
      if ('exposed' in k && (!Array.isArray(k.exposed) || !k.exposed.length ||
          !k.exposed.every((x) => typeof x === 'string' && DID_KEY.test(x)) || new Set(k.exposed).size !== k.exposed.length)) {
        problems.push('exposed is a list of distinct did:key URIs');
        exposed = [];
      }
      const strings = (x) => (Array.isArray(x) ? x.filter((y) => typeof y === 'string') : []);
      const keys = strings(k.keys), next = strings(k.next);
      const earlierKeys = new Set(earlier.flatMap((e) => strings(e?.keys)));
      const earlierNext = new Set(earlier.flatMap((e) => strings(e?.next)));
      const earlierExposed = new Set(earlier.flatMap((e) => strings(e?.exposed)));
      if (keys.some((x) => earlierExposed.has(x) || exposed.includes(x))) {
        problems.push('keys lists a key exposed by this version or an earlier one (rule 2)');
      }
      if ((await Promise.all(keys.map(keyDigest))).some((d) => earlierNext.has(d))) {
        problems.push('keys lists a rotation key of an earlier version (rule 2)');
      }
      const earlierKeyDigests = new Set(await Promise.all([...earlierKeys].map(keyDigest)));
      if (next.some((d) => earlierKeyDigests.has(d))) problems.push('next holds the digest of a current key of an earlier version (rule 3)');
      if (next.some((d) => earlierNext.has(d))) problems.push('next holds a digest that next of an earlier version holds (rule 3)');
      if (exposed.some((x) => !earlierKeys.has(x))) problems.push('exposed lists a key that keys of no earlier version lists (rule 4)');
      return problems;
    }

The key log
-----------

A key log is its genesis record, its owner name and identifier, and the
versions a reader holds, with the problems met while reading them. It is
checked once (`check`, below); what the checks found is then kept on the
versions (`isVersion`), and the questions a reader asks are answered from
there: the side of the key log (its versions that are versions, fork
record excluded), its latest version with keys, the fork record and fork
point, whether the owner has ended, its successor, the keys it exposes,
and the version a signature names (`lookup`).

    // in core/owners.js:
    export class KeyLog {
      static async of(genesis, versions = null, problems = []) {
        const owner = await nameOf(genesis);
        return new KeyLog(genesis, owner, versions || [await firstVersion(genesis)], problems);
      }

      constructor(genesis, owner, versions, problems = []) {
        this.genesis = genesis;
        this.owner = owner;
        this.id = objectId(owner, owner);
        this.versions = versions;
        this.problems = problems;
        this.checked = null;
        this.met = null;
      }

      pin(number) {
        return keyLogPin(this.owner, number, this.versions[number - 1].digest);
      }

      side() {
        return this.versions.filter((v) => v.isVersion && !v.forkRecord);
      }

      latest() {
        if (this.ended) return null;
        const side = this.side();
        const last = side[side.length - 1];
        return last && isObject(last.keys) && 'keys' in last.keys ? last : null;
      }

      get forkRecord() {
        return this.versions.find((v) => v.forkRecord && v.isVersion) || this.met || null;
      }

      get forkPoint() {
        return this.forkRecord?.carried[0]?.number ?? null;
      }

      get ended() {
        return this.forkRecord !== null || this.side().slice(1).some((v) => v.keys?.ended);
      }

      get successor() {
        return this.side().slice(1).find((v) => v.keys?.ended)?.keys.successor ?? null;
      }

      exposedKeys() {
        const found = new Set();
        for (const v of this.side()) for (const x of arrayOf(v.keys?.exposed)) found.add(x);
        for (const c of this.forkRecord?.carried || []) for (const x of arrayOf(c.keys?.exposed)) found.add(x);
        return found;
      }

      lookup(number, digest) {
        for (const v of this.versions) if (v.number === number && v.digest === digest) return v;
        for (const c of this.forkRecord?.carried || []) if (c.number === number && c.digest === digest) return c;
        return null;
      }

      extensions() {
        const side = this.side();
        if (side.length <= 1) return jsonOrNull(this.genesis)?.extensions ?? null;
        return side[side.length - 1].keys?.extensions ?? null;
      }

### The checks of section 14.3

Version by version from the first: the genesis record; the first version,
which must be the computed one, byte for byte; then each later version,
against the latest version of its side: its inventory names the owner
object and its own number, its genesis record is the first's, its
`object.json` has the fields of an owner and `previous`, the digest of the
version before, and it holds no other file with a name the specification
reserves; a fork record is checked as such, any other version must hold
`keys.json`, obey the rules across versions, and be signed by
`nextThreshold` rotation keys of the version before. A version that fails
is not a version of the key log, nor is anything held after it, after a
fork record, or after an ending version but a fork record; those after a
fork record or an ending version are warnings (section 14.3, rule 4).
The answer is the lists of errors and warnings, and the versions keep
what was found.

    // in core/owners.js:
      async check() {
        if (!this.checked) this.checked = this.checkNow();
        return this.checked;
      }

      async checkNow() {
        const errors = [...this.problems], warnings = [];
        let rec = null;
        try {
          rec = await readGenesis(this.genesis);
        } catch (error) {
          errors.push(`genesis.json: ${error.message}`);
        }
        if (rec !== null && rec.kind !== 'owner') {
          errors.push('genesis.json: the genesis record of an owner has kind owner');
          rec = null;
        }
        if (rec === null || !this.versions.length) {
          for (const v of this.versions) v.isVersion = false;
          return { errors, warnings };
        }
        const v1 = this.versions[0];
        const computed = await firstVersion(this.genesis);
        if (v1.number !== 1 || !sameFiles(v1.files, computed.files) || !sameBytes(v1.inventory, computed.inventory)) {
          errors.push('v1: not the version computed from the genesis record (section 6.1)');
          v1.isVersion = false;
        } else if (v1.sidecar && v1.sidecar.length && sidecarDigest(v1.sidecar) !== v1.digest) {
          errors.push('v1: the checksum file does not state the digest of the inventory');
          v1.isVersion = false;
        }
        if ([...v1.witnesses.keys()].some((n) => n.startsWith('signature-'))) {
          warnings.push('v1: a signature file of the computed first version is invalid (section 7.3)');
        }
        const side = [v1];
        let state = v1.isVersion ? null : 'broken';
        for (const v of this.versions.slice(1)) {
          const where = `v${v.number}`;
          if (state === 'broken') {
            v.isVersion = false;
            warnings.push(`${where}: follows a version that is not a version of the key log`);
            continue;
          }
          if (state === 'forked' || (state === 'ended' && !v.forkRecord)) {
            v.isVersion = false;
            warnings.push(`${where}: held after ${state === 'forked' ? 'a fork record' : 'an ending version'}: ` +
                          'not a version of the key log (section 6.3)');
            continue;
          }
          const problems = await this.commonProblems(v, side[side.length - 1]);
          if (v.forkRecord) {
            problems.push(...await this.forkRecordProblems(v, side));
          } else if (v.keys === null) {
            problems.push('no keys.json, and not a fork record');
          } else {
            problems.push(...await keyRules(v.keys, side.map((x) => x.keys), this.owner));
            if (!problems.length) problems.push(...await this.signatureProblems(v, side[side.length - 1], heldLookup(side), warnings));
          }
          if (problems.length) {
            v.isVersion = false;
            errors.push(...problems.map((p) => `${where}: ${p}`));
            state = 'broken';
          } else if (v.forkRecord) {
            state = 'forked';
          } else {
            side.push(v);
            if (v.keys.ended) state = 'ended';
          }
        }
        return { errors, warnings };
      }

      async commonProblems(v, prev) {
        const problems = [];
        const inv = jsonOrNull(v.inventory);
        if (!isObject(inv) || inv.id !== this.id || inv.head !== `v${v.number}`) {
          problems.push(`the inventory is not that of v${v.number} of ${this.id}`);
        }
        if (v.sidecar && v.sidecar.length && sidecarDigest(v.sidecar) !== v.digest) {
          problems.push('the checksum file does not state the digest of the inventory');
        }
        if (!sameBytes(v.files.get(GENESIS), this.genesis)) problems.push('genesis.json differs from that of the first version');
        const obj = jsonOrNull(v.files.get(OBJ));
        const expected = ownerObject(this.owner, prev.digest);
        const withoutExtensions = isObject(obj) ? Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'extensions')) : null;
        if (!withoutExtensions || !same(withoutExtensions, expected)) {
          problems.push('object.json has not the fields of an owner and previous, the digest of ' +
                        `the inventory of v${prev.number} (section 4.3)`);
        }
        for (const path of v.files.keys()) {
          const top = path.split('/')[0];
          if (RESERVED.includes(top) && ![GENESIS, OBJ, KEYS].includes(path) && !path.startsWith(FORKED)) {
            problems.push(`${path}: a name reserved by section 4.1`);
          }
        }
        return problems;
      }

A version after the first is signed by `nextThreshold` distinct rotation
keys of the version before (section 6.1), each signature naming that
version; the signature files that are not good are warnings, as files of
a witness folder that are not witnesses (section 7.2).

    // in core/owners.js:
      async signatureProblems(v, prev, lookup, warnings, where = null) {
        where = where || `v${v.number}`;
        const good = new Set();
        for (const j of await judgeFolder(v.witnesses, { objectId: this.id, version: `v${v.number}`, inventory: v.digest,
                                                           owner: this.owner, lookup, keyLog: true })) {
          if (j.status === GOOD && j.keyLog[0] === prev.number && j.keyLog[1] === prev.digest) good.add(j.key);
          else if (j.status !== GOOD) warnings.push(`${where}/${j.file}: ${j.status}: ${j.reason}`);
        }
        const need = prev.keys.nextThreshold;
        if (good.size < need) return [`signed by ${good.size} rotation key${good.size === 1 ? '' : 's'} of v${prev.number}, which needs ${need} (section 6.1)`];
        return [];
      }

A fork record holds only the genesis record, an `object.json` and the
versions it carries, consecutive from the fork point; the first differs
from the version of its number held below the record, and each is the
inventory of the owner object under the name its digest gives, with its
checksum file and the `keys.json` its inventory lists, obeys the rules
across versions and is signed against the version before it on its side
(section 6.3).

    // in core/owners.js:
      async forkRecordProblems(fr, side) {
        const problems = [...fr.files.keys()].filter((p) => p !== GENESIS && p !== OBJ && !p.startsWith(FORKED))
          .map((p) => `${p}: a fork record holds only genesis.json, object.json and forked/ (section 6.3)`);
        const carried = fr.carried;
        if (!carried.length || carried.some((c) => c.number === null)) {
          return [...problems, 'a fork record carries versions, each with its inventory'];
        }
        const first = carried[0].number;
        const held = new Map(side.map((x) => [x.number, x]));
        if (carried.some((c, k) => c.number !== first + k)) problems.push('the versions carried are consecutive');
        if (!held.has(first - 1) || !held.has(first) || held.get(first).digest === carried[0].digest) {
          problems.push(`the first version carried, v${first}, differs from a version held of that number`);
          return problems;
        }
        let before = side.filter((x) => x.number < first);
        for (const c of carried) {
          const where = `forked/${c.d}`;
          const inv = jsonOrNull(c.inventory);
          if (c.d !== base32(await sha256(c.inventory)).slice(0, 16)) problems.push(`${where}: not the name its inventory digest gives`);
          if (!isObject(inv) || inv.id !== this.id) {
            problems.push(`${where}: the inventory carried is not one of ${this.id}`);
            continue;
          }
          if (sidecarDigest(c.sidecar) !== c.digest) problems.push(`${where}: the checksum file does not state the digest of the inventory`);
          const state = inv.versions?.[`v${c.number}`]?.state || {};
          const keysDigest = c.files.has('keys.json') ? await sha512(c.files.get('keys.json')) : null;
          if (!keysDigest || !Object.entries(state).some(([d, paths]) => Array.isArray(paths) && paths.includes(KEYS) && d === keysDigest)) {
            problems.push(`${where}: keys.json is not the one its inventory lists`);
            continue;
          }
          const rules = await keyRules(c.keys, before.map((x) => x.keys), this.owner);
          problems.push(...rules.map((p) => `${where}: ${p}`));
          if (!rules.length) {
            const more = await this.signatureProblems(c, before[before.length - 1], heldLookup(before), [], where);
            problems.push(...more.map((p) => `${where}: ${p}`));
          }
          before = [...before, c];
        }
        return problems;
      }

### Two copies of a key log

A reader that finds a key log in several archives meets them (section
6.5): of two copies, compared up to their fork records, either one
extends the other, and the reader uses the longer, or they differ from a
fork point, which ends the owner (section 6.3). An archive records such a
fork with a fork record; a reader that meets it only notes it, as
opensheaf-py's resolver does when it meets copies in memory: the key log
it uses then has the other side as carried versions, so that the fork
point, the keys the other side exposes, and the versions signatures name
on either side are known. `meet` answers the key log a reader uses after
meeting OTHER, both checked.

    // in core/owners.js:
      async meet(other) {
        await this.check();
        await other.check();
        if (!sameBytes(this.genesis, other.genesis)) return this;
        const mine = this.side(), theirs = other.side();
        for (let k = 0; k < Math.min(mine.length, theirs.length); k++) {
          if (mine[k].digest !== theirs[k].digest) return this.withFork(theirs.slice(k));
        }
        const theirFork = other.forkRecord;
        if (theirs.length > mine.length) {
          if (this.forkRecord) return this;
          const log = new KeyLog(this.genesis, this.owner, [...mine, ...theirs.slice(mine.length), ...(theirFork ? [theirFork] : [])]);
          log.checked = Promise.resolve({ errors: [], warnings: [] });
          log.met = other.met;
          return log;
        }
        if (theirFork) {
          const first = theirFork.carried[0];
          const held = first && first.number <= mine.length ? mine[first.number - 1] : null;
          if (held && held.digest !== first.digest && !this.forkRecord) return this.withFork(theirFork.carried);
        }
        return this;
      }

      withFork(otherSide) {
        if (this.forkRecord) return this;
        const log = new KeyLog(this.genesis, this.owner, this.versions, this.problems);
        log.checked = this.checked;
        log.met = { carried: otherSide, isVersion: true, forkRecord: true, met: true };
        return log;
      }
    }

    function heldLookup(side) {
      return (number, digest) => side.find((x) => x.number === number && x.digest === digest) || null;
    }

    function sameFiles(a, b) {
      if (a.size !== b.size) return false;
      for (const [path, bytes] of a) if (!sameBytes(bytes, b.get(path))) return false;
      return true;
    }

    function arrayOf(x) {
      return Array.isArray(x) ? x : [];
    }

How a key log is described to a reader, as `osheaf owner show` describes
it: each version, with what it did.

    // in core/owners.js:
    export function describeVersion(v) {
      const k = v.keys || {};
      if (v.forkRecord) return 'fork record, carrying ' + v.carried.map((c) => `v${c.number}`).join(', ');
      if (k.ended) return 'ended' + (k.successor ? `, successor ${k.successor}` : '');
      const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
      return `${count(arrayOf(k.keys).length, 'current key')}, threshold ${k.threshold}, ` +
        `${count(arrayOf(k.next).length, 'rotation key')}, nextThreshold ${k.nextThreshold}` +
        (arrayOf(k.exposed).length ? `, exposes ${k.exposed.length}` : '');
    }
