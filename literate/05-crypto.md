Digests, encodings and signatures
=================================

> This chapter is chapter 05 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/05-crypto.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


Version 0.2 of the specification names works, owners and keys by
digests, and makes owners sign the versions of their lines with Ed25519
keys (sections 5 to 7). A reader checks all of it from the files: it
computes names as SHA-256 digests written in base32, decodes the keys of
`did:key` URIs written in base58btc, and verifies signatures. This
chapter gathers these primitives, so that the chapters on names, owners
and signatures (the next three) state only the rules of the format.

Digests come from the WebCrypto of the browser (`crypto.subtle`), as the
SHA-512 digests of files already do (chapter [10](10-http.md)); Ed25519
signatures are verified by a verifier of the explorer's own, below, in
every browser. Everything here works on
bytes (`Uint8Array`), and is asynchronous only where WebCrypto is.

The module is `core/crypto.js`.

    // in core/crypto.js:
    import { FetchError } from './http.js';

Digests
-------

WebCrypto is available only to pages served over `https:` or from
`localhost`; elsewhere the explorer cannot check anything, and says so
with the error of kind `crypto` that chapter [10](10-http.md) explains.

    // in core/crypto.js:
    function subtle() {
      const s = globalThis.crypto?.subtle;
      if (!s) throw new FetchError('crypto', '', 'WebCrypto is not available (it needs https: or localhost)');
      return s;
    }

    export async function sha256(bytes) {
      return new Uint8Array(await subtle().digest('SHA-256', bytes));
    }

    export async function sha512bytes(bytes) {
      return new Uint8Array(await subtle().digest('SHA-512', bytes));
    }

    export function hex(bytes) {
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    export function utf8(text) {
      return new TextEncoder().encode(text);
    }

    export function sameBytes(a, b) {
      if (!a || !b || a.length !== b.length) return false;
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
      return true;
    }

Base32, base58btc and base64
----------------------------

Names, the digests of keys and the names of signature files are in
lowercase base32 (RFC 4648) without padding (sections 5.2, 6.1 and 7.2);
`did:key` URIs write keys in base58btc, the alphabet of Bitcoin; and
signatures are in base64 with padding. Base32 is only ever written by the
explorer, never decoded: names are compared as strings (section 5.2).

    // in core/crypto.js:
    export const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

    export function base32(bytes) {
      let out = '', bits = 0, value = 0;
      for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
          out += B32[(value >>> (bits - 5)) & 31];
          bits -= 5;
        }
        value &= (1 << bits) - 1;
      }
      if (bits > 0) out += B32[(value << (5 - bits)) & 31];
      return out;
    }

    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    export function base58(bytes) {
      let n = 0n;
      for (const b of bytes) n = n * 256n + BigInt(b);
      let out = '';
      while (n > 0n) {
        out = B58[Number(n % 58n)] + out;
        n /= 58n;
      }
      let zeros = 0;
      while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
      return '1'.repeat(zeros) + out;
    }

    export function unbase58(text) {
      let n = 0n;
      for (const c of text) {
        const k = B58.indexOf(c);
        if (k < 0) throw new Error(`not base58btc: ${JSON.stringify(c)}`);
        n = n * 58n + BigInt(k);
      }
      const body = [];
      while (n > 0n) {
        body.unshift(Number(n % 256n));
        n /= 256n;
      }
      let zeros = 0;
      while (zeros < text.length && text[zeros] === '1') zeros++;
      return new Uint8Array([...new Array(zeros).fill(0), ...body]);
    }

    export function unbase64(text) {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
        throw new Error('not base64');
      }
      const binary = atob(text);
      return Uint8Array.from(binary, (c) => c.charCodeAt(0));
    }

Ed25519 verification
--------------------

Section 7.2 asks verifiers to verify a signature as RFC 8032 (section
5.1.7) says, *without* the cofactor, and to reject it when `S` is not less
than the group order L, when the key is not the canonical encoding of a
point or is a point of small order, or when `R` is a point of small
order. These are the rules of libsodium, which the reference
implementation uses (opensheaf-py's chapter
[08-signatures](https://opensheaf.org/opensheaf-py/08-signatures.html)),
and they matter: implementations of Ed25519 differ exactly on these edge
cases ("Taming the many EdDSAs", Chalkias, Garillot and Nikolaenko, 2020),
and a reader that accepted a signature that another rejects would see
another line.

**The choice.** The explorer makes these checks itself, in JavaScript,
before any verification of the equation; and verifies the equation with a
small verifier of its own, below, of some sixty lines on `BigInt`, in
every browser, even where WebCrypto has Ed25519 (Chrome 137, Firefox 129
and Safari 17 do, and Node 22). With the checks made first, what is left
is the equation `[S]B = R + [k]A` on canonical encodings of points that
are not of small order, and the cofactorless implementations of the
browsers (BoringSSL, NSS's HACL*, CoreCrypto) agree with libsodium there
too, as far as the tests can tell (the twelve vectors of
ed25519-speccheck, and points with a component of small order). But the
verdict of the explorer is a statement about an archive, and it should not
depend on the browser it is read in: a native implementation could change
under it, in a release of a browser nobody here has read, and two readers
would then see two lines. The verifier below is the same in every
browser, and every line of it is here to be read.

What it costs, measured on Node 26 (V8, as Chrome) on one hundred random
signatures of 300-byte messages: 1.8 ms a signature, against 0.07 ms for
WebCrypto. The 147 signature files of the fixture archives take a quarter
of a second in all, and an archive of a few thousand signed versions a few
seconds, next to the fetching of its files, which dominates. A verifier
that ran WebCrypto first and the verifier below only when WebCrypto
accepts would cost the same on the archives that matter, those whose
signatures are good, so it would buy nothing; WebCrypto is kept only for
the tests, which check on every case that the two agree. The verifier
works on public data only, so the timing of its arithmetic leaks nothing.

The constants: the prime p = 2^255 − 19 of the field, the order L of the
group, and the y coordinates of the points of small order (0, 1, −1, the
two points of order 8 and their opposites, and the non-canonical
encodings p and p + 1 of 0 and 1), as libsodium blacklists them.

    // in core/crypto.js:
    const P = 2n ** 255n - 19n;
    export const L = 2n ** 252n + 27742317777372353535851937790883648493n;
    const Y8 = littleEndian(fromHex('26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05'));
    const SMALL_ORDER_Y = new Set([0n, 1n, P - 1n, P, P + 1n, Y8, P - Y8]);

    function fromHex(text) {
      return Uint8Array.from(text.match(/../g), (b) => parseInt(b, 16));
    }

    function littleEndian(bytes) {
      let n = 0n;
      for (let k = bytes.length - 1; k >= 0; k--) n = (n << 8n) | BigInt(bytes[k]);
      return n;
    }

    function yOf(encoding) {
      return littleEndian(encoding) & ((1n << 255n) - 1n);
    }

The checks of section 7.2, on the 32 bytes of the key and the 64 of the
signature: `S` less than L; the key and `R` canonical (their y coordinate
less than p) and not of small order.

    // in core/crypto.js:
    export function strictlyAcceptable(publicKey, signature) {
      if (publicKey.length !== 32 || signature.length !== 64) return false;
      if (littleEndian(signature.subarray(32)) >= L) return false;
      const a = yOf(publicKey), r = yOf(signature.subarray(0, 32));
      return a < P && r < P && !SMALL_ORDER_Y.has(a) && !SMALL_ORDER_Y.has(r);
    }

The verification itself: the checks, then the equation, by the verifier
below. The tests pass `engine: 'webcrypto'` to verify the equation with
WebCrypto instead, to compare the two; a key or a signature that WebCrypto
refuses to read is then a signature that does not verify.

    // in core/crypto.js:
    export async function verifyEd25519(publicKey, message, signature, { engine = 'js' } = {}) {
      if (!strictlyAcceptable(publicKey, signature)) return false;
      if (engine === 'webcrypto') {
        try {
          const key = await subtle().importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
          return await subtle().verify({ name: 'Ed25519' }, key, signature, message);
        } catch {
          return false;
        }
      }
      return verifyInJs(publicKey, message, signature);
    }

### A verifier of its own

The curve is the twisted Edwards curve −x² + y² = 1 + d x² y² over the
field of p elements, with points in extended coordinates (X : Y : Z : T),
x = X/Z, y = Y/Z, xy = T/Z, and the addition of RFC 8032 (section
5.1.4), which also doubles. B is the base point, whose y is 4/5.

    // in core/crypto.js:
    const mod = (a) => ((a % P) + P) % P;

    function power(base, exponent) {
      let result = 1n;
      base = mod(base);
      while (exponent > 0n) {
        if (exponent & 1n) result = mod(result * base);
        base = mod(base * base);
        exponent >>= 1n;
      }
      return result;
    }

    const invert = (a) => power(a, P - 2n);
    const D = mod(-121665n * invert(121666n));
    const SQRT_M1 = power(2n, (P - 1n) / 4n);
    const BY = mod(4n * invert(5n));
    const BASE = { X: 15112221349535400772501151409588531511454012693041857206046113283949847762202n, Y: BY, Z: 1n,
                   T: mod(15112221349535400772501151409588531511454012693041857206046113283949847762202n * BY) };
    const ZERO = { X: 0n, Y: 1n, Z: 1n, T: 0n };

    function add(p, q) {
      const a = mod((p.Y - p.X) * (q.Y - q.X));
      const b = mod((p.Y + p.X) * (q.Y + q.X));
      const c = mod(2n * D * p.T * q.T);
      const d = mod(2n * p.Z * q.Z);
      const e = b - a, f = d - c, g = d + c, h = b + a;
      return { X: mod(e * f), Y: mod(g * h), Z: mod(f * g), T: mod(e * h) };
    }

    function multiply(n, point) {
      let result = ZERO;
      while (n > 0n) {
        if (n & 1n) result = add(result, point);
        point = add(point, point);
        n >>= 1n;
      }
      return result;
    }

Decoding a point (RFC 8032, section 5.1.3): y from the 255 low bits, x
from the equation of the curve and the sign in the high bit. A
non-canonical y, or an x of zero with the sign bit set, or a y with no x
on the curve, is no point. Encoding writes y and the low bit of x.

    // in core/crypto.js:
    function decode(bytes) {
      const y = yOf(bytes);
      const sign = bytes[31] >> 7;
      if (y >= P) return null;
      const u = mod(y * y - 1n), v = mod(D * y * y + 1n);
      let x = mod(u * power(v, 3n) * power(u * power(v, 7n), (P - 5n) / 8n));
      if (mod(v * x * x) !== u) {
        if (mod(v * x * x) !== mod(-u)) return null;
        x = mod(x * SQRT_M1);
      }
      if (x === 0n && sign === 1) return null;
      if (Number(x & 1n) !== sign) x = P - x;
      return { X: x, Y: y, Z: 1n, T: mod(x * y) };
    }

    function encode(point) {
      const zi = invert(point.Z);
      const x = mod(point.X * zi), y = mod(point.Y * zi);
      const out = new Uint8Array(32);
      let n = y;
      for (let k = 0; k < 32; k++) {
        out[k] = Number(n & 255n);
        n >>= 8n;
      }
      out[31] |= Number(x & 1n) << 7;
      return out;
    }

The verification (RFC 8032, section 5.1.7, without the cofactor):
k = SHA-512(R ‖ A ‖ M) modulo L, and the signature is good when [S]B −
[k]A, encoded, is the 32 bytes of R. Comparing encodings rather than
points also rejects an R that is not canonical.

    // in core/crypto.js:
    async function verifyInJs(publicKey, message, signature) {
      const a = decode(publicKey);
      if (!a) return false;
      const r = signature.subarray(0, 32);
      const s = littleEndian(signature.subarray(32));
      const k = littleEndian(await sha512bytes(new Uint8Array([...r, ...publicKey, ...message]))) % L;
      const minusA = { X: mod(-a.X), Y: a.Y, Z: a.Z, T: mod(-a.T) };
      return sameBytes(encode(add(multiply(s, BASE), multiply(k, minusA))), r);
    }
