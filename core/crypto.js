// Generated from literate/05-crypto.md by opensheaf-literate: edit the document, not this file.
import { FetchError } from './http.js';

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

export function strictlyAcceptable(publicKey, signature) {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  if (littleEndian(signature.subarray(32)) >= L) return false;
  const a = yOf(publicKey), r = yOf(signature.subarray(0, 32));
  return a < P && r < P && !SMALL_ORDER_Y.has(a) && !SMALL_ORDER_Y.has(r);
}

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

async function verifyInJs(publicKey, message, signature) {
  const a = decode(publicKey);
  if (!a) return false;
  const r = signature.subarray(0, 32);
  const s = littleEndian(signature.subarray(32));
  const k = littleEndian(await sha512bytes(new Uint8Array([...r, ...publicKey, ...message]))) % L;
  const minusA = { X: mod(-a.X), Y: a.Y, Z: a.Z, T: mod(-a.T) };
  return sameBytes(encode(add(multiply(s, BASE), multiply(k, minusA))), r);
}
