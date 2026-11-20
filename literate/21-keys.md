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
the key files of a key wallet, which this chapter reads when they are
locked with a passphrase. Writing wallets, passkeys and the keychain come
in a later phase (chapter [00](00-plan.md)).

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

    export class PassphraseNeeded extends KeyError {}

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
      return hashWasm.argon2id({ password: utf8(passphrase), salt, parallelism: 1, iterations: ops,
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
    const KINDS = [CURRENT, ROTATION];

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
optionally, under passkeys) by lines `wrap ...`: the data key is
unwrapped with the passphrase, and the seed with the data key. Passkey
wraps need the passkey's secret, which a later phase brings; until then
such a key opens with its passphrase only.

    // in reading a key file back:
    function parseWrap(line) {
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

    async function openEnvelope(wraps, data, passphrase) {
      const parsed = wraps.map(parseWrap);
      if (passphrase === null || passphrase === undefined) {
        throw new PassphraseNeeded('this key is encrypted: a passphrase is needed');
      }
      let dataKey = null;
      for (const w of parsed) {
        if (w.method !== 'passphrase' || w.kind !== 'argon2id') continue;
        if (!('opslimit' in w) || !('memlimit' in w)) throw new KeyError('the encryption of the key is damaged');
        dataKey = await unseal(w.box, await argon2id(passphrase, w.salt || new Uint8Array(), w.opslimit, w.memlimit));
        if (dataKey) break;
      }
      if (!dataKey) throw new KeyError('wrong passphrase, or a damaged key');
      const seed = await unseal(data, dataKey);
      if (!seed) throw new KeyError('the seed of the key is damaged');
      return seed;
    }

    export async function readKey(text, passphrase = null) {
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
        seed = await openEnvelope(wraps, data, passphrase);
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
