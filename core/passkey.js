// Generated from literate/36-passkeys.md by opensheaf-literate: edit the document, not this file.
import { sha256, utf8, unbase64 } from './crypto.js';
import { hkdf, hmacSha256, base64, PASSKEY_RP } from './keys.js';
import { OWNER_NAME } from './names.js';

export const UNLOCK_PAGE = `https://${PASSKEY_RP}/`;
export const UNLOCK = 'OPENSHEAF_UNLOCK';
export const TIMEOUT = 120_000, STILL = 10_000;

export class UnlockFailed extends Error {}

export function b64url(bytes) {
  return base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromB64url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new Error('not base64url');
  const b = text.replaceAll('-', '+').replaceAll('_', '/');
  return unbase64(b + '='.repeat((4 - (b.length % 4)) % 4));
}

export function pageUrl(mode, port, state, pk, owner, creds = []) {
  const fragment = new URLSearchParams({ mode, port: String(port), state, pk: b64url(pk), owner });
  if (creds.length) fragment.set('cred', creds.join(','));
  return UNLOCK_PAGE + '#' + fragment.toString();
}

export function randomState() {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

const CODE_LABEL = utf8('opensheaf unlock code v1');

export async function confirmationCode(state, pk) {
  const d = await sha256(new Uint8Array([...CODE_LABEL, ...utf8(state), ...pk]));
  const n = ((d[0] << 24) >>> 0) + (d[1] << 16) + (d[2] << 8) + d[3];
  const digits = String(n % 1_000_000).padStart(6, '0');
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

const HAND_OFF_INFO = utf8('opensheaf unlock hand-off v2');
const PKCS8_X25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20];

async function withPublic(privateKey) {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  return { privateKey, publicKey: fromB64url(jwk.x) };
}

export async function newKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  return withPublic(pair.privateKey);
}

export async function keyPairOf(secret) {
  const key = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8_X25519, ...secret]),
                                            { name: 'X25519' }, true, ['deriveBits']);
  return withPublic(key);
}

async function handOffKeys(pair, other, state) {
  const pub = await crypto.subtle.importKey('raw', other, { name: 'X25519' }, true, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: pub }, pair.privateKey, 256));
  const both = await hkdf(shared, utf8(state), HAND_OFF_INFO, 64);
  return [both.slice(0, 32), both.slice(32)];
}

export function associatedData(mode, owner, cred, pk, epk) {
  return utf8(`${mode}|${owner}|${cred}|${b64url(pk)}|${b64url(epk)}`);
}

export function sameSecret(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let k = 0; k < a.length; k++) diff |= a[k] ^ b[k];
  return diff === 0;
}

const xor = (a, b) => a.map((x, k) => x ^ b[k]);

export async function seal(secret, pk, state, mode, owner, cred, ephemeral = null) {
  ephemeral ||= await newKeyPair();
  const [enc, mac] = await handOffKeys(ephemeral, pk, state);
  const ct = xor(secret, enc);
  const aad = associatedData(mode, owner, cred, pk, ephemeral.publicKey);
  return [ephemeral.publicKey, ct, await hmacSha256(mac, new Uint8Array([...aad, ...ct]))];
}

export async function unseal(pair, epk, ct, tag, state, mode, owner, cred) {
  if (epk.length !== 32 || ct.length !== 32 || tag.length !== 32) throw new Error('not a hand-off of 32 bytes');
  const [enc, mac] = await handOffKeys(pair, epk, state);
  const aad = associatedData(mode, owner, cred, pair.publicKey, epk);
  if (!sameSecret(await hmacSha256(mac, new Uint8Array([...aad, ...ct])), tag)) {
    throw new Error('the answer of the page is not authentic');
  }
  return xor(ct, enc);
}

export const DONE = 'osheaf has the key. You can close this tab.';
export const FAILED = (error) => `osheaf did not get the key (${error}): it asks for the passphrase instead. You can close this tab.`;
export const NO_X25519 = 'this browser has no X25519 in WebCrypto, and cannot hand the key to osheaf securely (known to ' +
  'work: Safari 17+, Chrome 133+, Firefox 130+); osheaf uses the passphrase';
const ANSWERS = [['cred', 'ct', 'epk', 'state', 'tag'], ['error', 'state']];

export function queryFields(query) {
  if (query.length > 8192) return null;
  const fields = {};
  for (const part of query.split(/[&;]/)) {
    if (!part.includes('=')) return null;
    const [k, v] = part.split('=', 2).map((x) => decodeURIComponent(x.replaceAll('+', ' ')));
    if (v === '') continue;
    if (k in fields) return null;
    fields[k] = v;
  }
  const names = Object.keys(fields).sort().join(',');
  return ANSWERS.some((a) => a.join(',') === names) ? fields : null;
}

export async function openAnswer(fields, listener) {
  if ('error' in fields) return { error: fields.error.slice(0, 200) || 'an error' };
  try {
    const [epk, ct, tag] = [fromB64url(fields.epk), fromB64url(fields.ct), fromB64url(fields.tag)];
    fromB64url(fields.cred);
    const secret = await unseal(listener.pair, epk, ct, tag, listener.state, listener.mode, listener.owner, fields.cred);
    return { cred: fields.cred, secret };
  } catch {
    return { error: 'the page sent a damaged answer' };
  }
}

export function answerPage(text) {
  const esc = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
  return `<!DOCTYPE html><html lang=en><meta charset=utf-8><title>osheaf</title><p style='font-family:sans-serif'>${esc}</p></html>`;
}

export function checkOwner(mode, owner) {
  if (!OWNER_NAME.test(owner) || !['enroll', 'unlock'].includes(mode)) throw new UnlockFailed(`not an owner name: ${owner}`);
}

export function failure(result) {
  const error = result.error;
  return new UnlockFailed(error === 'x25519-unavailable' ? NO_X25519 : `the page says: ${error.slice(0, 200)}`);
}

export function answerOf(result, creds = []) {
  const secret = result.secret || new Uint8Array(), cred = result.cred ?? null;
  if (secret.length !== 32) throw new UnlockFailed('the page sent a secret that is not 32 bytes');
  if (creds.length && cred !== null && !creds.includes(cred)) throw new UnlockFailed('the page used another passkey than those asked for');
  return [cred, secret];
}

export const POPUP = 'popup', POPUP_ENROLL = 'popup-enroll';
export const UNLOCK_ORIGIN = new URL(UNLOCK_PAGE).origin;
export const POPUP_MESSAGES = { ready: 'opensheaf-unlock-ready', request: 'opensheaf-unlock-request',
                                answer: 'opensheaf-unlock-answer', done: 'opensheaf-unlock-done' };

function popupMode(mode) {
  if (mode !== POPUP && mode !== POPUP_ENROLL) throw new UnlockFailed(`not a mode of the popup: ${mode}`);
  return mode;
}

export function popupUrl(origin, mode = POPUP) {
  return UNLOCK_PAGE + '#' + new URLSearchParams({ mode: popupMode(mode), origin }).toString();
}

export async function popupRequest(owner, creds, pair = null, state = null, mode = POPUP) {
  if (!OWNER_NAME.test(owner || '')) throw new UnlockFailed(`not an owner name: ${owner}`);
  if (!creds.length && popupMode(mode) === POPUP) {
    throw new UnlockFailed('no passkey is enrolled for the keys of this owner (osheaf key enroll)');
  }
  pair ||= await newKeyPair();
  state ||= randomState();
  return { owner, mode, creds: [...creds], state, pair, code: await confirmationCode(state, pair.publicKey),
           message: { type: POPUP_MESSAGES.request, state, pk: b64url(pair.publicKey), owner, cred: creds.join(',') } };
}

export function sameCode(typed, code) {
  const digits = (t) => utf8(String(t ?? '').replace(/[^0-9]/g, ''));
  return digits(typed).length === 6 && sameSecret(digits(typed), digits(code));
}

export async function openPopupAnswer(request, data, typed) {
  if (!data || data.type !== POPUP_MESSAGES.answer || typeof data.state !== 'string' ||
      !sameSecret(utf8(data.state), utf8(request.state))) {
    throw new UnlockFailed('this is not the answer to this request');
  }
  if (typeof data.error === 'string') throw failure({ error: data.error });
  if (!sameCode(typed, request.code)) {
    throw new UnlockFailed('the code typed is not the code of this request: close the window of the passkey, and ' +
                           'unlock again');
  }
  let secret;
  try {
    const [epk, ct, tag] = [fromB64url(data.epk), fromB64url(data.ct), fromB64url(data.tag)];
    fromB64url(data.cred);
    secret = await unseal(request.pair, epk, ct, tag, request.state, request.mode || POPUP, request.owner, data.cred);
  } catch {
    throw new UnlockFailed('the page sent a damaged answer');
  }
  if (request.mode === POPUP_ENROLL) {
    if (request.creds.includes(data.cred)) throw new UnlockFailed('the page sent no new credential');
    return answerOf({ cred: data.cred, secret });
  }
  return answerOf({ cred: data.cred, secret }, request.creds);
}
