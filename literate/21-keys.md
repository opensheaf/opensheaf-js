Keys: signing, and key files
============================

An owner signs the versions of its lines with Ed25519 keys (sections 6
and 7). This chapter makes and uses those keys: a key from its seed, the
signature of a message, new keys from a secure generator, the predictable
keys of appendix C for the tests; and the files that keep a key outside
the archive, as opensheaf-py writes them (its chapter
[07-keys](https://opensheaf.org/opensheaf-py/07-keys.html)): the
**rotation key files** exported by `osheaf init --export DIR`, with the
seed in clear (`--no-passphrase`) or encrypted under a passphrase, and
the key files of a key wallet, an **envelope** whose seed is unlocked by
the passphrase or by a passkey; and the text of a key for a password
manager. Wallets themselves are kept by chapter [35](35-wallets.md), the
passkeys' hand-off by chapter [36](36-passkeys.md), and the stores of
current keys on a computer by the command line (chapter [40](40-cli.md)).

The files must be read and written byte for byte as opensheaf-py reads
and writes them: a rotation key exported by one implementation is used
by the other to sign the next version of a key log (the parity tests of
chapter [72](72-tests-parity.md) check it both ways).

The module is `core/keys.js`.

    // in core/keys.js:
    import { sha256, base32, unbase64, utf8 } from './crypto.js';
    import { didKey, keyDigest } from './names.js';

    <<errors of keys>>

    <<a key and its signatures>>

    <<base64 and base32>>

    <<encrypting a seed under a passphrase>>

    <<rotation key files>>

    <<envelopes: a seed unlocked in several ways>>

    <<key files for wallets, and texts for password managers>>

    <<reading a key file back>>

Keys and signatures
-------------------

An Ed25519 private key is a seed of 32 bytes (RFC 8032, section 5.1.5).
The key signs with the WebCrypto of the platform, `crypto.subtle`, which
Deno, Node and the browsers that matter have for Ed25519: signing is
deterministic in RFC 8032, so the signature of a message by a key is
one string of 64 bytes, the same as libsodium's (which opensheaf-py uses,
through PyNaCl); the tests check it on the three signatures of appendix
C. Verification stays with the strict verifier of chapter
[05](05-crypto.md), which decides alone.

WebCrypto imports a private Ed25519 key only wrapped in PKCS #8: the
seed after a fixed prefix of 16 bytes (RFC 8410). Its public key comes
back from the JSON Web Key of the private key (`x`, in base64url). The
key keeps its seed, its `did:key` URI, the digest of that URI (section
6.1) and the first 16 characters of the digest, which name its signature
files (section 7.2).

    // in errors of keys:
    export class KeyError extends Error {}

    export class PassphraseNeeded extends KeyError {
      constructor(message, passkeys = []) {
        super(message);
        this.passkeys = passkeys;
      }
    }

The key itself:

    // in a key and its signatures:
    const PKCS8_ED25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

    export class Key {
      static async fromSeed(seed) {
        if (!(seed instanceof Uint8Array) || seed.length !== 32) {
          throw new KeyError('the seed of an Ed25519 key has 32 bytes');
        }
        const own = Uint8Array.from(seed);
        const signing = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8_ED25519, ...own]),
                                                      { name: 'Ed25519' }, true, ['sign']);
        const jwk = await crypto.subtle.exportKey('jwk', signing);
        const publicKey = unbase64(jwk.x.replaceAll('-', '+').replaceAll('_', '/') + '=');
        const did = didKey(publicKey);
        return new Key(own, signing, publicKey, did, await keyDigest(did));
      }

      constructor(seed, signing, publicKey, did, digest) {
        Object.assign(this, { seed, signing, publicKey, did, digest, id: digest.slice(0, 16) });
      }

      async sign(message) {
        return new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, this.signing, message));
      }

      toString() {
        return `Key(${this.did})`;
      }
    }

A new key comes from the secure generator of the platform,
`crypto.getRandomValues`. The keys of appendix C come from their labels:
the seed of a label is the SHA-256 digest of `opensheaf appendix C example
key ` followed by the label, as in opensheaf-py's `example_key`; they are
for the tests and the examples only, and nothing else in this program
makes them.

    // in a key and its signatures:
    export function randomBytes(n) {
      return crypto.getRandomValues(new Uint8Array(n));
    }

    export async function newKey() {
      return Key.fromSeed(randomBytes(32));
    }

    export const EXAMPLE_PREFIX = 'opensheaf appendix C example key ';

    export async function exampleKey(label) {
      return Key.fromSeed(await sha256(utf8(EXAMPLE_PREFIX + label)));
    }

Base64 and base32
-----------------

Key files write seeds and salts in base64 with padding, read strictly (a
character out of the alphabet is an error, as Python's `b64decode(...,
validate=True)` says); sheets and texts for password managers write them
in uppercase base32, read in either case, with the padding Python needs
added back. The encoders of chapter [05](05-crypto.md) write lowercase
base32 and read base64; the rest is here.

    // in base64 and base32:
    export function base64(bytes) {
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    }

    export function unbase32(text) {
      const t = text.toUpperCase();
      if (!/^[A-Z2-7]*$/.test(t) || [1, 3, 6].includes(t.length % 8)) throw new KeyError(`not base32: ${text}`);
      const out = [];
      let bits = 0, value = 0;
      for (const c of t) {
        value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);
        bits += 5;
        if (bits >= 8) {
          out.push((value >>> (bits - 8)) & 255);
          bits -= 8;
        }
        value &= (1 << bits) - 1;
      }
      return new Uint8Array(out);
    }

    function strictBase64(text) {
      try {
        return unbase64(text);
      } catch {
        throw new KeyError('not base64');
      }
    }

    function concat(...parts) {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let k = 0;
      for (const p of parts) {
        out.set(p, k);
        k += p.length;
      }
      return out;
    }

Encrypting a seed
-----------------

A seed is encrypted under a passphrase as libsodium does it in
opensheaf-py: a key of 32 bytes derived from the passphrase by Argon2id
(RFC 9106; version 1.3, one lane, the cost `opslimit` passes over
`memlimit` bytes), with a random salt of 16 bytes; then the seed sealed
with that key by `crypto_secretbox` (XSalsa20-Poly1305), with a random
nonce of 24 bytes. The bytes kept are the nonce followed by the sealed
box (its 16 bytes of authenticator, then the ciphertext), as PyNaCl's
`SecretBox.encrypt` writes them, and the line `encryption` of the file
names the method and its parameters:

```
encryption argon2id-secretbox opslimit=3 memlimit=268435456 salt=<base64>
```

The cost is libsodium's "moderate" level, as in opensheaf-py: three
passes over 256 MiB, under a second. A file read gives its own cost,
which is checked against libsodium's bounds first (a file asking for
terabytes is refused before anything is allocated).

**The libraries.** WebCrypto has neither Argon2id nor XSalsa20-Poly1305,
and writing either here would be writing cryptography, which this
program should not do. Two packages, well known, small and used widely,
do it, in every browser, in Deno and in Node, with no native code:
[hash-wasm](https://github.com/Daninet/hash-wasm) (4.12.0), whose
Argon2id is compiled to WebAssembly from the reference implementation,
and [TweetNaCl.js](https://tweetnacl.js.org) (1.0.3), the audited port
of TweetNaCl, whose `secretbox` is libsodium's. Their versions are
pinned (in `deno.json` and `package.json`); the tests check them against
files written by opensheaf-py. They are imported by their bare names, which
`deno.json` maps to `npm:` packages, Node finds in `node_modules`, and a
page maps with an import map; and only when a seed is encrypted or
decrypted, so that a program that only verifies (the Explorer) never
loads them. hash-wasm also gives MD5, which OCFL fixity needs and
WebCrypto lacks (chapter [22](22-writing.md)).

**The passphrase in Unicode NFC.** The same accented letter can be typed
as one character or as a letter and a combining accent, depending on the
keyboard, the operating system or the password manager. A passphrase is
normalised to NFC before Argon2id reads it, in UTF-8, as opensheaf-py
does, so that both spellings open the same key, in either program. This
function is the one place where a passphrase becomes bytes: a seed
encrypted on its own, the passphrase lock of an envelope, a key file, a
key text and a wallet all go through it. An ASCII passphrase is unchanged
by NFC.

    // in encrypting a seed under a passphrase:
    export const OPSLIMIT = 3, MEMLIMIT = 268435456;
    const ARGON2ID = { opsMin: 1, opsMax: 4, memMin: 8192, memMax: 1073741824, saltBytes: 16 };

    async function argon2id(passphrase, salt, opslimit, memlimit) {
      const ops = /^[0-9]+$/.test(String(opslimit)) ? Number(opslimit) : NaN;
      const mem = /^[0-9]+$/.test(String(memlimit)) ? Number(memlimit) : NaN;
      if (Number.isNaN(ops) || Number.isNaN(mem)) throw new KeyError('the encryption of the key is damaged');
      if (!(ARGON2ID.opsMin <= ops && ops <= ARGON2ID.opsMax && ARGON2ID.memMin <= mem && mem <= ARGON2ID.memMax)) {
        throw new KeyError(`the key asks for an Argon2id cost out of bounds (opslimit=${ops}, memlimit=${mem}): ` +
                           `at most ${ARGON2ID.opsMax} and ${ARGON2ID.memMax}`);
      }
      if (salt.length !== ARGON2ID.saltBytes) throw new KeyError('the encryption of the key is damaged');
      const hashWasm = await import('hash-wasm');
      return hashWasm.argon2id({ password: utf8(passphrase.normalize('NFC')), salt, parallelism: 1, iterations: ops,
                                 memorySize: Math.floor(mem / 1024), hashLength: 32, outputType: 'binary' });
    }

    async function secretbox() {
      const nacl = await import('tweetnacl');
      return (nacl.default || nacl).secretbox;
    }

    async function seal(data, key) {
      const box = await secretbox();
      const nonce = randomBytes(24);
      return concat(nonce, box(data, nonce, key));
    }

    async function unseal(data, key) {
      const box = await secretbox();
      if (data.length < 24 + 16) return null;
      return box.open(data.subarray(24), data.subarray(0, 24), key);
    }

    export async function encryptSeed(seed, passphrase, { opslimit = OPSLIMIT, memlimit = MEMLIMIT } = {}) {
      if (passphrase === null || passphrase === undefined) return ['none', seed];
      const salt = randomBytes(ARGON2ID.saltBytes);
      const box = await seal(seed, await argon2id(passphrase, salt, opslimit, memlimit));
      return [`argon2id-secretbox opslimit=${opslimit} memlimit=${memlimit} salt=${base64(salt)}`, box];
    }

    function parameters(words) {
      const out = {};
      for (const w of words) {
        const k = w.indexOf('=');
        out[k < 0 ? w : w.slice(0, k)] = k < 0 ? '' : w.slice(k + 1);
      }
      return out;
    }

    export async function decryptSeed(encryption, data, passphrase) {
      const words = encryption.split(/\s+/).filter(Boolean);
      if (words.length === 1 && words[0] === 'none') return data;
      if (!words.length || words[0] !== 'argon2id-secretbox') {
        throw new KeyError(`unknown encryption: '${words.join(' ')}'`);
      }
      if (passphrase === null || passphrase === undefined) {
        throw new PassphraseNeeded('this key is encrypted: a passphrase is needed');
      }
      const p = parameters(words.slice(1));
      if (!('salt' in p) || !('opslimit' in p) || !('memlimit' in p)) throw new KeyError('the encryption of the key is damaged');
      let salt;
      try {
        salt = strictBase64(p.salt);
      } catch {
        throw new KeyError('the encryption of the key is damaged');
      }
      const seed = await unseal(data, await argon2id(passphrase, salt, p.opslimit, p.memlimit));
      if (!seed) throw new KeyError('wrong passphrase, or a damaged key');
      return seed;
    }

Rotation key files
------------------

`osheaf init --export DIR` writes each rotation key of the new owner to a
file of its own in a folder outside the archive (section 15.4), named
`rotation-<the first 16 characters of the owner name>-<k>.txt`, `k` naming
the key as its signature files do. The file is a few lines of text, a
format line and then fields, one per line:

```
opensheaf-rotation-key/0.2
owner <owner name>
version v1
key did:key:z6Mk...
digest <the digest of the key>
encryption none
seed <the seed, in base64>
```

`version` is the version of the key log that commits the key (in its
`next`); `key` and `digest` let a reader check the seed it decrypts.

    // in rotation key files:
    export const ROTATION_FORMAT = 'opensheaf-rotation-key/0.2';
    export const KEY_FORMAT = 'opensheaf-key/0.2';
    export const TEXT_FORMAT = 'opensheaf-key-text/0.2';
    export const ENVELOPE = 'envelope-secretbox';
    export const CURRENT = 'current', ROTATION = 'rotation';
    export const KINDS = [CURRENT, ROTATION];

    export function rotationFileName(owner, key) {
      return `rotation-${owner.slice(0, 16)}-${key.id}.txt`;
    }

    export async function rotationKeyText(key, owner, version, passphrase = null, cost = {}) {
      return fileText([ROTATION_FORMAT], key, owner, version, passphrase, cost);
    }

    async function fileText(head, key, owner, version, passphrase, cost) {
      const [encryption, data] = await encryptSeed(key.seed, passphrase, cost);
      const lines = [...head, `owner ${owner}`, ...(version ? [`version v${version}`] : [])];
      lines.push(`key ${key.did}`, `digest ${key.digest}`, `encryption ${encryption}`, `seed ${base64(data)}`);
      return lines.join('\n') + '\n';
    }

The export also prints, for each key, four characters that check it: the
first four of the base32 digest of the seed after a fixed line. They are
typed back to confirm that the files were put away (unless `--yes`), and
printed on the sheet of `--print`, from which a seed typed back by hand is
checked.

    // in rotation key files:
    export const SHEET_TITLE = 'OpenSheaf rotation key';

    export async function sheetCheck(seed) {
      return base32(await sha256(concat(utf8('opensheaf-rotation-key-check\n'), seed))).slice(0, 4).toUpperCase();
    }

    export async function rotationKeySheet(key, owner, version) {
      const groups = base32(key.seed).toUpperCase().match(/.{1,4}/g).join(' ');
      return [
        `${SHEET_TITLE} (${ROTATION_FORMAT})`,
        "Keep this sheet offline, apart from the owner's devices and its other rotation keys:",
        "with enough of them, whoever holds it can change the owner's keys.",
        '',
        `owner    ${owner}`,
        `version  v${version}`,
        `key      ${key.did}`,
        `digest   ${key.digest}`,
        `seed     ${groups}`,
        `check    ${await sheetCheck(key.seed)}`,
      ].join('\n') + '\n';
    }

Envelopes
---------

A key kept in a wallet may be opened in more than one way: with the
passphrase, and with any of the passkeys enrolled for it (`osheaf key
enroll`). Its seed is encrypted under a random **data key** of 32 bytes,
and the data key is wrapped once for each way, each wrap a line of the
file:

```
encryption envelope-secretbox
wrap passphrase argon2id opslimit=3 memlimit=268435456 salt=<base64> <box>
wrap passkey prf rp=unlock.opensheaf.org cred=<credential> salt=<base64> <box>
seed <the seed under the data key, in base64>
```

A passphrase wrap is the data key sealed under the key Argon2id derives
from the passphrase; a passkey wrap is the data key sealed under the
passkey's **key-encryption key**, derived by HKDF-SHA256 (RFC 5869, an
empty salt, the info `opensheaf wallet passkey v1`) from the secret of
the passkey's PRF extension (WebAuthn), for the PRF salt of its owner,
the SHA-256 digest of `opensheaf wallet unlock v1 ` and the owner name.
`rp` names the relying party the passkey belongs to: `unlock.opensheaf.org`
now; a wrap of `opensheaf.org`, where the first passkeys were made, is
read, and reported as needing a new enrollment (chapter
[37](37-owner-commands.md)).

HMAC-SHA256 comes from WebCrypto, so HKDF is written here in its few
lines, as opensheaf-py writes it; the same function serves the hand-off of
chapter [36](36-passkeys.md).

    // in envelopes: a seed unlocked in several ways:
    export const PASSKEY_RP = 'unlock.opensheaf.org';
    export const OLD_PASSKEY_RP = 'opensheaf.org';
    const PASSKEY_INFO = utf8('opensheaf wallet passkey v1');
    const PASSKEY_SALT = 'opensheaf wallet unlock v1 ';

    export async function hmacSha256(key, data) {
      const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
    }

    export async function hkdf(ikm, salt, info, length) {
      const prk = await hmacSha256(salt.length ? salt : new Uint8Array(32), ikm);
      const out = [];
      let block = new Uint8Array();
      for (let i = 1; out.length < length; i++) {
        block = await hmacSha256(prk, concat(block, info, new Uint8Array([i])));
        out.push(...block);
      }
      return new Uint8Array(out.slice(0, length));
    }

    export async function passkeySalt(owner) {
      return sha256(utf8(PASSKEY_SALT + owner));
    }

    export async function passkeyKek(prfSecret) {
      return hkdf(prfSecret, new Uint8Array(32), PASSKEY_INFO, 32);
    }

A passkey, as a wrap names it: its credential (base64url), its PRF salt,
its relying party, the box of its wrap when it was read from a file, and
its key-encryption key once it is unlocked.

    // in envelopes: a seed unlocked in several ways:
    export class Passkey {
      constructor(cred, salt, { rp = PASSKEY_RP, kek = null, box = null } = {}) {
        Object.assign(this, { cred, salt: Uint8Array.from(salt), rp, kek, box });
      }

      async opens(kek) {
        return this.box !== null && (await unseal(this.box, kek)) !== null;
      }

      async wrap(dataKey) {
        return `wrap passkey prf rp=${this.rp} cred=${this.cred} salt=${base64(this.salt)} ` +
          base64(await seal(dataKey, this.kek));
      }

      toString() {
        return `Passkey(${this.rp} ${this.cred})`;
      }
    }

An envelope is made with a new data key; its wraps are the passphrase's,
first, then each unlocked passkey's.

    // in envelopes: a seed unlocked in several ways:
    async function wrapsFor(dataKey, passphrase, passkeys, { opslimit = OPSLIMIT, memlimit = MEMLIMIT } = {}) {
      const salt = randomBytes(ARGON2ID.saltBytes);
      const box = await seal(dataKey, await argon2id(passphrase, salt, opslimit, memlimit));
      const out = [`wrap passphrase argon2id opslimit=${opslimit} memlimit=${memlimit} salt=${base64(salt)} ${base64(box)}`];
      for (const p of passkeys) out.push(await p.wrap(dataKey));
      return out;
    }

    export async function envelope(seed, passphrase, passkeys = [], cost = {}) {
      const dataKey = randomBytes(32);
      return [await wrapsFor(dataKey, passphrase, passkeys, cost), await seal(seed, dataKey)];
    }

    export function parseWrap(line) {
      const parts = line.split(/\s+/).filter(Boolean);
      if (parts.length < 4 || parts[0] !== 'wrap') throw new KeyError(`a damaged lock of the key: '${line}'`);
      const out = parameters(parts.slice(3, -1));
      try {
        out.method = parts[1];
        out.kind = parts[2];
        out.box = strictBase64(parts[parts.length - 1]);
        if ('salt' in out) out.salt = strictBase64(out.salt);
      } catch {
        throw new KeyError('a lock of the key is damaged');
      }
      return out;
    }

    export function wrapsOf(text) {
      return text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l.startsWith('wrap '));
    }

    function passkeyOfWrap(w) {
      return new Passkey(w.cred, w.salt || new Uint8Array(), { rp: w.rp || PASSKEY_RP, box: w.box });
    }

    export function passkeysOf(text) {
      return wrapsOf(text).map(parseWrap).filter((w) => w.method === 'passkey' && w.kind === 'prf' && w.cred)
        .map(passkeyOfWrap);
    }

The data key is unwrapped by an unlocked passkey (`keks`, credential to
key-encryption key) if one of the wraps is that passkey's, and otherwise
by the passphrase; without a passphrase, `PassphraseNeeded` names the
passkeys that could open the key instead.

    // in envelopes: a seed unlocked in several ways:
    export async function dataKey(wraps, passphrase = null, keks = null) {
      const parsed = wraps.map(parseWrap);
      for (const w of parsed) {
        if (w.method === 'passkey' && keks && w.cred in keks) {
          const opened = await unseal(w.box, keks[w.cred]);
          if (opened) return opened;
        }
      }
      if (passphrase === null || passphrase === undefined) {
        throw new PassphraseNeeded('this key is encrypted: a passphrase is needed',
                                   parsed.filter((w) => w.method === 'passkey' && w.cred).map(passkeyOfWrap));
      }
      for (const w of parsed) {
        if (w.method !== 'passphrase' || w.kind !== 'argon2id') continue;
        if (!('salt' in w) || !('opslimit' in w) || !('memlimit' in w)) throw new KeyError('the encryption of the key is damaged');
        const opened = await unseal(w.box, await argon2id(passphrase, w.salt, w.opslimit, w.memlimit));
        if (opened) return opened;
      }
      throw new KeyError('wrong passphrase, or a damaged key');
    }

    export async function openEnvelope(wraps, data, passphrase = null, keks = null) {
      const seed = await unseal(data, await dataKey(wraps, passphrase, keks));
      if (!seed) throw new KeyError('the seed of the key is damaged');
      return seed;
    }

A passkey is added to a key file opened with the passphrase: one more
wrap of the same data key, after the others; a key file locked the older
way, its seed under the passphrase alone, becomes an envelope. Passkey
wraps are removed by credential or by relying party, never the last
passphrase wrap.

    // in envelopes: a seed unlocked in several ways:
    export async function addPasskey(text, passphrase, passkey, cost = {}) {
      const lines = text.split(/\r\n|\r|\n/);
      if (lines[lines.length - 1] === '') lines.pop();
      const enc = lines.findIndex((x) => x.startsWith('encryption '));
      const seedAt = lines.findIndex((x) => x.startsWith('seed '));
      if (enc < 0 || seedAt < 0 || seedAt < enc) throw new KeyError('not a key file');
      const method = lines[enc].split(/\s+/).filter(Boolean)[1];
      if (method === ENVELOPE) {
        const key = await dataKey(wrapsOf(text), passphrase);
        let last = -1;
        lines.forEach((x, k) => { if (x.startsWith('wrap ')) last = k; });
        lines.splice(last + 1, 0, await passkey.wrap(key));
      } else if (method === 'none') {
        throw new KeyError('this key is kept unencrypted: there is nothing to unlock');
      } else {
        let data;
        try {
          data = strictBase64(lines[seedAt].slice(5).trim());
        } catch {
          throw new KeyError('the seed of the key is damaged');
        }
        const seed = await decryptSeed(lines[enc].slice('encryption '.length), data, passphrase);
        const [wraps, sealed] = await envelope(seed, passphrase, [passkey], cost);
        lines.splice(enc, seedAt + 1 - enc, `encryption ${ENVELOPE}`, ...wraps, 'seed ' + base64(sealed));
      }
      return lines.join('\n') + '\n';
    }

    export function removePasskeys(text, cred = null, rp = null) {
      if (cred === null && rp === null) throw new KeyError('name the passkey locks to remove, by credential or relying party');
      const gone = (line) => {
        if (!line.startsWith('wrap passkey ')) return false;
        const w = parseWrap(line);
        return (cred === null || w.cred === cred) && (rp === null || (w.rp || PASSKEY_RP) === rp);
      };
      const lines = text.split(/\r\n|\r|\n/);
      if (lines[lines.length - 1] === '') lines.pop();
      const kept = lines.filter((x) => !gone(x.trim()));
      if (!kept.some((x) => x.trim().startsWith('wrap passphrase '))) throw new KeyError('the key would have no passphrase lock left');
      return kept.join('\n') + '\n';
    }

Key files for wallets, texts for password managers
--------------------------------------------------

A key in a wallet is a file of format `opensheaf-key/0.2`, with its kind,
`current` or `rotation`: an envelope under the passphrase and the
passkeys given, or, for a current key the owner chooses to keep so
(`--plain-current`), the seed in clear.

    // in key files for wallets, and texts for password managers:
    export async function keyFileText(key, owner, kind, version = null, passphrase = null, { passkeys = [], cost = {} } = {}) {
      if (!KINDS.includes(kind)) throw new KeyError(`a key is ${KINDS.join(' or ')}`);
      const head = [KEY_FORMAT, `kind ${kind}`];
      if (passphrase === null || passphrase === undefined) return fileText(head, key, owner, version, null, cost);
      const [wraps, data] = await envelope(key.seed, passphrase, passkeys, cost);
      const lines = [...head, `owner ${owner}`, ...(version ? [`version v${version}`] : [])];
      lines.push(`key ${key.did}`, `digest ${key.digest}`, `encryption ${ENVELOPE}`, ...wraps, 'seed ' + base64(data));
      return lines.join('\n') + '\n';
    }

A current key goes to and from a password manager (`osheaf key export`,
`import`) as a short text of format `opensheaf-key-text/0.2`: the seed in
uppercase base32, in groups of four, with its check, encrypted under the
passphrase if asked.

    // in key files for wallets, and texts for password managers:
    export async function keyText(key, owner, kind = CURRENT, passphrase = null, cost = {}) {
      const [encryption, data] = await encryptSeed(key.seed, passphrase, cost);
      const groups = base32(data).toUpperCase().match(/.{1,4}/g).join(' ');
      const lines = [TEXT_FORMAT, `kind ${kind}`, `owner ${owner}`, `key ${key.did}`];
      if (passphrase !== null && passphrase !== undefined) lines.push(`encryption ${encryption}`);
      lines.push(`seed ${groups}`, `check ${await sheetCheck(data)}`);
      return lines.join('\n') + '\n';
    }

Reading a key back
------------------

A key is read back from a rotation key file, from a key file of a wallet,
or from a sheet or a text typed back: the line of its format, then its
fields, the first of each name winning. The seed is base64 in files, and
base32 in sheets and texts, where it must match its check (a mistyped
character is caught there). The seed is decrypted if it is encrypted; the
key it makes must be the one the fields name.

A wallet's key file (`encryption envelope-secretbox`) keeps the seed
under a random data key, itself wrapped under the passphrase (and,
under passkeys) by lines `wrap ...`, opened as the envelopes above say:
with an unlocked passkey (`keks`) or with the passphrase.

    // in reading a key file back:
    export async function readKey(text, passphrase = null, keks = null) {
      const lines = text.split(/\r\n|\r|\n/);
      if (lines[lines.length - 1] === '') lines.pop();
      const formats = [ROTATION_FORMAT, KEY_FORMAT, TEXT_FORMAT];
      const start = lines.findIndex((line) => formats.includes(line.trim()));
      const format = start < 0 ? null : lines[start].trim();
      const fields = {};
      for (const line of lines.slice(start + 1)) {
        const t = line.trim();
        const k = t.indexOf(' ');
        const name = k < 0 ? t : t.slice(0, k);
        if (name && !(name in fields)) fields[name] = k < 0 ? '' : t.slice(k + 1).trim();
      }
      let data;
      if (format === ROTATION_FORMAT || format === KEY_FORMAT) {
        try {
          data = strictBase64(fields.seed ?? '');
        } catch {
          throw new KeyError('the seed of the file is not base64');
        }
      } else {
        try {
          data = unbase32((fields.seed ?? '').replaceAll(' ', ''));
        } catch {
          data = new Uint8Array();
        }
        if (!data.length || (fields.check ?? '').toUpperCase() !== await sheetCheck(data)) {
          throw new KeyError('the seed does not match its check: a character is mistyped');
        }
      }
      let seed;
      if ((fields.encryption ?? '').split(' ')[0] === ENVELOPE) {
        const wraps = lines.slice(Math.max(start, 0)).map((l) => l.trim()).filter((l) => l.startsWith('wrap '));
        seed = await openEnvelope(wraps, data, passphrase, keks);
      } else {
        seed = await decryptSeed(fields.encryption ?? 'none', data, passphrase);
      }
      if (seed.length !== 32) throw new KeyError('not the seed of an Ed25519 key');
      const key = await Key.fromSeed(seed);
      if ((fields.key ?? key.did) !== key.did || (fields.digest ?? key.digest) !== key.digest) {
        throw new KeyError('the seed is not that of the key the file or sheet names');
      }
      const kind = fields.kind ?? ROTATION;
      if (!KINDS.includes(kind)) throw new KeyError(`unknown kind of key: '${kind}'`);
      const version = (fields.version ?? '').split(' ')[0];
      return { key, owner: fields.owner ?? null, kind,
               version: /^v[0-9]+$/.test(version) ? Number(version.slice(1)) : null };
    }

    export async function readRotationKey(text, passphrase = null) {
      const found = await readKey(text, passphrase);
      if (found.kind !== ROTATION) throw new KeyError(`${found.key.did} is a ${found.kind} key, not a rotation key`);
      return found;
    }

The seed of a key is never written anywhere else by this module, and
never printed.
