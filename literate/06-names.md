Names, keys and sheaf: URIs
===========================

> This chapter is chapter 06 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/06-names.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


A work and an owner have a name, the digest of their genesis record, the
same in every archive and every copy (section 5); an owner has keys,
written as `did:key` URIs (section 6.1); and lines, versions and owners
are written as `sheaf:` URIs (section 12.1). This chapter reads and checks
all of them, and computes the canonical JSON of the files of the first
version of a key log, which every reader rebuilds byte for byte (section
6.1). It follows the chapter of the reference implementation,
opensheaf-py's
[05-names](https://opensheaf.org/opensheaf-py/05-names.html), function by
function, so that both read the same files the same way.

The module is `core/names.js`.

    // in core/names.js:
    import { sha256, base32, base58, unbase58, utf8, B32 } from './crypto.js';
    import { parseIntegers } from './http.js';

The forms
---------

A name is 52 characters of lowercase base32 (section 5.2); an owner name
is a name of algorithm 0, whose last character is `a` or `q`; a draft has
the reserved owner `draft` and a label (section 10.1). A `did:key` URI of
an Ed25519 key starts with `z6Mk`, the base58btc of the multicodec prefix
`0xed 0x01`, followed by 44 characters. The genesis record's `created` is
a date and time in UTC, and its nonce has at least 128 bits.

    // in core/names.js:
    export const NAME = /^[a-z2-7]{52}$/;
    export const OWNER_NAME = /^[a-z2-7]{51}[aq]$/;
    export const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    export const DID_KEY = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
    export const CREATED = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;
    export const NONCE = /^([0-9a-f]{2}){16,}$/;
    export const GENESIS = 'genesis.json';
    export const GENESIS_FORMAT = 'opensheaf-genesis/0.2';
    export const KINDS = ['document', 'collection', 'owner'];

Keys
----

The 32 bytes of the key of a `did:key` URI, or an exception if the URI is
not one of an Ed25519 key, or not in the canonical form of its key (a
leading zero or another prefix would give another URI for the same key).
The digest of a key, which `next` lists and which names signature files,
is the base32 SHA-256 digest of its URI (sections 6.1 and 7.2).

    // in core/names.js:
    const ED25519_PUB = [0xed, 0x01];

    export function didKey(publicKey) {
      if (publicKey.length !== 32) throw new Error('an Ed25519 public key has 32 bytes');
      return 'did:key:z' + base58(new Uint8Array([...ED25519_PUB, ...publicKey]));
    }

    export function didKeyPublic(did) {
      if (typeof did !== 'string' || !did.startsWith('did:key:z')) throw new Error(`not a did:key URI in base58btc: ${did}`);
      const raw = unbase58(did.slice('did:key:z'.length));
      if (raw.length !== 34 || raw[0] !== ED25519_PUB[0] || raw[1] !== ED25519_PUB[1]) {
        throw new Error(`not the did:key URI of an Ed25519 key: ${did}`);
      }
      if (didKey(raw.subarray(2)) !== did) throw new Error(`not the canonical did:key URI of its key: ${did}`);
      return raw.subarray(2);
    }

    export async function keyDigest(did) {
      return base32(await sha256(utf8(did)));
    }

    export async function keyId(did) {
      return (await keyDigest(did)).slice(0, 16);
    }

Names
-----

Algorithm k takes the SHA-256 digest of `opensheaf-name-<k>` and a line
feed, followed by the bytes of the genesis record, writes it in base32,
and sets the four zero bits of the last character to k (section 5.2). The
algorithm of a name is read back from its last character; a name is one
of the sixteen names of a record when the algorithm it states gives it.

    // in core/names.js:
    export async function nameOf(genesis, k = 0) {
      if (!(Number.isInteger(k) && k >= 0 && k <= 15)) throw new Error('the algorithms of names are numbered 0 to 15');
      const s = base32(await sha256(new Uint8Array([...utf8(`opensheaf-name-${k}\n`), ...genesis])));
      return s.slice(0, -1) + B32[B32.indexOf(s[s.length - 1]) | k];
    }

    export function algorithm(name) {
      return B32.indexOf(name[name.length - 1]) & 0xf;
    }

    export async function isNameOf(name, genesis) {
      return typeof name === 'string' && NAME.test(name) && (await nameOf(genesis, algorithm(name))) === name;
    }

    export function objectId(name, owner) {
      return `sheaf:${name}:${owner}`;
    }

    export function keyLogPin(owner, number, digest) {
      return `sheaf:${owner}/v${number}?sha512=${digest}`;
    }

The parts of an identifier, `sheaf:<name>:<owner>`, or of a draft,
`sheaf:draft:<id>` (sections 4 and 10.1), or `null`. Identifiers come
from archives, and are untrusted: only these forms make an address
(chapter [11](11-paths.md)).

    // in core/names.js:
    export function parseId(id) {
      const m = typeof id === 'string' ? /^sheaf:([^:]+):([^:]+)$/.exec(id) : null;
      if (!m) return null;
      if (m[1] === 'draft') return LABEL.test(m[2]) && m[2].length <= 64 ? { draft: m[2] } : null;
      return NAME.test(m[1]) && OWNER_NAME.test(m[2]) ? { name: m[1], owner: m[2] } : null;
    }

The genesis record
------------------

A genesis record is read from its bytes (section 5.1): JSON in UTF-8
without a byte order mark, of format `opensheaf-genesis/0.2`, with its
kind, its date and its nonce, and the fields of its kind: an owner's
first keys and the digests of its first rotation keys, with their
thresholds and the rules of section 6.1, and possibly a keeper and the
data of extensions; a document's or a collection's originator, an owner
name. Its numbers are integers as their text writes them, of at most
2^53 - 1 in absolute value (chapter [10](10-http.md)): a threshold of `1.0`
is no threshold, as in opensheaf-py. The answer is the record, or an
exception saying what is wrong, with the words of opensheaf-py.

    // in core/names.js:
    export async function readGenesis(bytes) {
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error('a genesis record has no byte order mark');
      let rec;
      try {
        rec = parseIntegers(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch (error) {
        throw new Error(`a genesis record is JSON in UTF-8 (${error.message})`);
      }
      if (!isObject(rec) || rec.format !== GENESIS_FORMAT) throw new Error(`not a genesis record of format ${GENESIS_FORMAT}`);
      if (!KINDS.includes(rec.kind)) throw new Error(`unknown kind ${JSON.stringify(rec.kind)}`);
      if (typeof rec.created !== 'string' || !CREATED.test(rec.created)) throw new Error('created must be a date and time in UTC');
      if (typeof rec.nonce !== 'string' || !NONCE.test(rec.nonce)) throw new Error('nonce must have at least 128 bits in lowercase hexadecimal');
      const ownerFields = ['keys', 'threshold', 'next', 'nextThreshold', 'keeper', 'extensions'];
      const allowed = ['format', 'kind', 'created', 'nonce', ...(rec.kind === 'owner' ? ownerFields : ['originator'])];
      const extra = Object.keys(rec).filter((k) => !allowed.includes(k)).sort();
      if (extra.length) throw new Error(`fields not allowed in a genesis record of kind ${rec.kind}: ${extra.join(', ')}`);
      if (rec.kind === 'owner') {
        const problems = await keyRulesOfRecord(rec);
        if ('keeper' in rec && !(Array.isArray(rec.keeper) && rec.keeper.length === 1 &&
                                 typeof rec.keeper[0] === 'string' && keeperValid(rec.keeper[0]))) {
          problems.push('keeper must be a list of one ORCID iD (with its check digit) or https://<domain>/');
        }
        if ('extensions' in rec && !(isObject(rec.extensions) && Object.values(rec.extensions).every(isObject))) {
          problems.push('extensions must map names of extensions to objects');
        }
        if (problems.length) throw new Error(problems.join('; '));
      } else if (typeof rec.originator !== 'string' || !OWNER_NAME.test(rec.originator)) {
        throw new Error('a document or a collection names its originator, an owner name');
      }
      return rec;
    }

    export function isObject(x) {
      return x !== null && typeof x === 'object' && !Array.isArray(x);
    }

The rules of section 6.1 that a genesis record, or a version of a key log
that is not an ending, obeys on its own: at least one key and one
rotation key, each distinct and of its form; thresholds that are positive
and not more than what they count (rule 1); and no key both current and
rotation key (rules 2 and 3). The rules across versions are in chapter
[07](07-owners.md).

    // in core/names.js:
    export async function keyRulesOfRecord(rec) {
      const problems = [];
      let keys = rec.keys, next = rec.next;
      if (!Array.isArray(keys) || !keys.length || !keys.every((k) => typeof k === 'string' && DID_KEY.test(k))) {
        problems.push('keys must be a list of at least one did:key URI of an Ed25519 key');
        keys = [];
      }
      if (!Array.isArray(next) || !next.length || !next.every((d) => typeof d === 'string' && OWNER_NAME.test(d))) {
        problems.push('next must be a list of at least one digest of a key (52 characters of base32)');
        next = [];
      }
      for (const [field, items] of [['keys', keys], ['next', next]]) {
        if (new Set(items).size !== items.length) problems.push(`${field} lists an item twice`);
      }
      for (const [field, count, items] of [['threshold', rec.threshold, keys], ['nextThreshold', rec.nextThreshold, next]]) {
        if (!Number.isInteger(count) || count < 1) problems.push(`${field} must be a positive integer`);
        else if (count > items.length) problems.push(`${field} ${count} exceeds the ${items.length} item(s) it counts (rule 1)`);
      }
      const digests = await Promise.all(keys.map(keyDigest));
      if (digests.some((d) => next.includes(d))) problems.push('a key is both a current key and a rotation key (rules 2 and 3)');
      return problems;
    }

Canonical JSON
--------------

The `object.json` and `keys.json` of the first version of a key log, and
its inventory, are the JCS form (RFC 8785) of their fields, without a
final line feed (section 6.1). JCS was made from the JSON of JavaScript:
strings are written as `JSON.stringify` writes them, and members are
sorted by the UTF-16 code units of their names, which is how JavaScript
compares strings. The files of OpenSheaf hold no fractional numbers, and
integers only up to 2^53 - 1 in absolute value (section 2), which JCS
writes as JavaScript does; a string
with a lone surrogate has no JCS form, as opensheaf-py says.

    // in core/names.js:
    export function jcs(value) {
      if (value === null || typeof value === 'boolean') return String(value);
      if (typeof value === 'number') {
        if (!Number.isInteger(value)) throw new Error('the canonical JSON of OpenSheaf has no fractional numbers');
        if (!Number.isSafeInteger(value)) throw new Error(`the integer ${value} has no exact form in JCS`);
        return String(value);
      }
      if (typeof value === 'string') {
        if (!value.isWellFormed()) throw new Error('a string with a lone surrogate has no JCS form');
        return JSON.stringify(value);
      }
      if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
      if (isObject(value)) {
        const names = Object.keys(value).sort();
        return `{${names.map((k) => jcs(k) + ':' + jcs(value[k])).join(',')}}`;
      }
      throw new Error(`not a JSON value: ${typeof value}`);
    }

    export function jcsBytes(value) {
      return utf8(jcs(value));
    }

sheaf: URIs
-----------

A `sheaf:` URI has, in this order: the scheme and a name; possibly an
owner part, `:` and an owner name, or `:*` for the work; possibly `/v`
and a positive number; possibly parameters, of which `sha512` (one, after
a version, an inventory digest) and `at` (one, after `sha512`, a
percent-encoded `https` base URL); others are kept and ignored (section
12.1). Short forms, prefixes of at least 8 characters, are accepted when
asked (section 12.2), and so are uppercase letters where case is folded.
The parts are kept as an object; `toString` writes them back, `canonical`
writes the canonical form (complete parts, no owner part for the
originator, no `at`).

    // in core/names.js:
    export class SheafUri {
      constructor({ name, owner = null, version = null, sha512 = null, at = null, params = [] }) {
        Object.assign(this, { name, owner, version, sha512, at, params });
      }

      toString() {
        let s = `sheaf:${this.name}`;
        if (this.owner !== null) s += `:${this.owner}`;
        if (this.version !== null) s += `/v${this.version}`;
        const query = [];
        if (this.sha512 !== null) query.push(`sha512=${this.sha512}`);
        if (this.at !== null) query.push('at=' + encodeURIComponent(this.at).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()));
        for (const [k, v] of this.params) query.push(`${k}=${v}`);
        return s + (query.length ? '?' + query.join('&') : '');
      }

      isComplete() {
        return this.name.length === 52 && (this.owner === null || this.owner === '*' || this.owner.length === 52);
      }

      canonical(originator = null) {
        if (!this.isComplete()) throw new Error(`a short form has no canonical form until it is expanded: ${this}`);
        const owner = this.owner !== null && this.owner === originator ? null : this.owner;
        return new SheafUri({ name: this.name, owner, version: this.version, sha512: this.sha512 }).toString();
      }

      matches(name, owner) {
        return name.startsWith(this.name) && (this.owner === null || this.owner === '*' || owner.startsWith(this.owner));
      }
    }

    const PART = /^[a-z2-7]+$/;
    const ESCAPED = /^(?:[A-Za-z0-9\-._~]|%[0-9A-Fa-f]{2})*$/;

    export function parseSheaf(text, { short = false, fold = false } = {}) {
      const fail = (why) => { throw new Error(`not a sheaf: URI (${why}): ${text}`); };
      if (typeof text !== 'string') fail('not a string');
      const q = text.indexOf('?');
      let head = q < 0 ? text : text.slice(0, q);
      const query = q < 0 ? null : text.slice(q + 1);
      if (fold) head = head.toLowerCase();
      const m = /^sheaf:([^:/]+)(?::([^:/]+))?(?:\/v([^/]*))?$/.exec(head);
      if (!m) fail('sheaf:<name>[:<owner>][/v<n>]');
      const [, name, owner = null, version = null] = m;
      for (const [label, part] of [['name', name], ['owner', owner]]) {
        if (part === null || (label === 'owner' && part === '*')) continue;
        if (!PART.test(part) || part.length > 52 || (part.length < 52 && !(short && part.length >= 8))) {
          fail(`the ${label} has 52 characters of base32` + (short ? ', or at least 8' : ''));
        }
      }
      if (owner && owner.length === 52 && !OWNER_NAME.test(owner)) fail('an owner name is a name of algorithm 0');
      if (version !== null && !/^[1-9][0-9]*$/.test(version)) fail('a version is /v and a positive integer without leading zeros');
      const uri = new SheafUri({ name, owner, version: version === null ? null : Number(version) });
      if (query !== null) {
        const seen = [];
        for (const p of query.split('&')) {
          const eq = p.indexOf('=');
          let key = eq < 0 ? p : p.slice(0, eq);
          let value = eq < 0 ? '' : p.slice(eq + 1);
          if (fold) key = key.toLowerCase();
          if (eq < 0 || !key) fail('parameters are name=value');
          if (key === 'sha512') {
            if (fold) value = value.toLowerCase();
            if (seen.includes('sha512') || uri.version === null || !/^[0-9a-f]{128}$/.test(value)) {
              fail('one sha512, after a version, of 128 hexadecimal digits');
            }
            if (seen.includes('at')) fail('at comes after sha512');
            uri.sha512 = value;
          } else if (key === 'at') {
            if (seen.includes('at') || !ESCAPED.test(value)) fail('one at, percent-encoded');
            const at = decodeURIComponent(value);
            if (!at.startsWith('https://') || !at.endsWith('/')) fail('at is an https URL ending with /');
            uri.at = at;
          } else {
            uri.params.push([key, value]);
          }
          seen.push(key);
        }
      }
      if (owner === '*' && (uri.version !== null || uri.sha512 !== null)) fail('a work, sheaf:<name>:*, has no version');
      return uri;
    }

Keepers
-------

A keeper is a list of one URI: an ORCID iD, whose last character is a
check digit (ISO 7064 MOD 11-2), or a domain written `https://<domain>/`
(section 6.6).

    // in core/names.js:
    const ORCID = /^(?:https:\/\/orcid\.org\/)?([0-9]{4})-([0-9]{4})-([0-9]{4})-([0-9]{3}[0-9X])$/;

    export function orcidValid(text) {
      const m = ORCID.exec(text);
      if (!m) return false;
      const digits = m.slice(1).join('');
      let total = 0;
      for (const ch of digits.slice(0, 15)) total = (total + Number(ch)) * 2;
      const r = (12 - (total % 11)) % 11;
      return (r === 10 ? 'X' : String(r)) === digits[15];
    }

    export function keeperValid(uri) {
      if (uri.startsWith('https://orcid.org/')) return orcidValid(uri);
      return /^https:\/\/[a-z0-9.-]+\/$/.test(uri);
    }
