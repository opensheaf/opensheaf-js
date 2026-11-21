Passkey unlock
==============

A passkey (WebAuthn) may open the keys of a wallet in place of the
passphrase: Touch ID instead of typing. A command line cannot use a
passkey itself; a page can. The page `https://unlock.opensheaf.org/`
creates a passkey for its relying party `unlock.opensheaf.org`, or uses
one, and derives with its PRF extension a secret of 32 bytes for the PRF
salt of the owner (chapter [21](21-keys.md)); it then hands the secret
back to the command, which waits for it on a one-time listener on
`127.0.0.1`. This is opensheaf-py's design (its chapter
[09-wallets](https://opensheaf.org/opensheaf-py/09-wallets.html), "Passkey
unlock"), and this chapter is the command line's side of it, written so
that the page cannot tell the two programs apart:

1. the command makes a one-time X25519 key pair and a random `state`, and
   listens on a free port of `127.0.0.1`;
2. it opens the page with everything in the fragment of its address
   (never sent to a server): `mode` (`enroll` or `unlock`), `port`,
   `state`, `pk` (its public key, base64url), `owner`, and for `unlock`
   the credentials `cred` that may answer (for `enroll`, those to
   exclude);
3. it prints a code of six digits, which the page shows too: the person
   checks that the page is talking to this command;
4. the page makes its own one-time X25519 key pair, derives from the
   shared secret and the state, by HKDF-SHA256 with the info `opensheaf
   unlock hand-off v2`, 64 bytes: a key that encrypts the secret by XOR,
   and a key of HMAC-SHA256 that authenticates `mode|owner|cred|pk|epk`
   and the ciphertext (encrypt-then-MAC);
5. it calls `http://127.0.0.1:PORT/callback?state=..&epk=..&ct=..&tag=..&cred=..`
   (or `state` and `error`); the listener takes one answer, compares the
   state in constant time, checks the tag, and decrypts.

A key-encryption key made from an answer is kept by a command only once it
has opened a key (chapter [37](37-owner-commands.md)): an answer that
opens nothing is never cached.

The cryptography is WebCrypto's: X25519 (`deriveBits`), HMAC-SHA256 and
SHA-256, in Deno, Node and browsers; the module is `core/passkey.js`. The
listener is the command line's, in `cli/unlock.js`.

    // in core/passkey.js:
    import { sha256, utf8, unbase64 } from './crypto.js';
    import { hkdf, hmacSha256, base64, PASSKEY_RP } from './keys.js';
    import { OWNER_NAME } from './names.js';

    <<the page and its address>>

    <<the hand-off, sealed and opened>>

    <<the answers of the page>>

The page and its address
------------------------

    // in the page and its address:
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

The code: the first four bytes of a digest of the state and the public
key, as a number, modulo a million, in two groups of three digits.

    // in the page and its address:
    const CODE_LABEL = utf8('opensheaf unlock code v1');

    export async function confirmationCode(state, pk) {
      const d = await sha256(new Uint8Array([...CODE_LABEL, ...utf8(state), ...pk]));
      const n = ((d[0] << 24) >>> 0) + (d[1] << 16) + (d[2] << 8) + d[3];
      const digits = String(n % 1_000_000).padStart(6, '0');
      return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    }

The hand-off
------------

An X25519 key pair of WebCrypto; one made from a given private key (the
tests' vector, shared with opensheaf-py) is imported in PKCS #8, its
32 bytes after a fixed prefix (RFC 8410).

    // in the hand-off, sealed and opened:
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

Sealing is the page's work; it is here for the tests, which act as the
page, and for the vector shared with opensheaf-py. Opening is the
listener's: a hand-off of other than 32 bytes, or whose tag does not
check, is refused.

    // in the hand-off, sealed and opened:
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

The answers of the page
-----------------------

The listener accepts on `/callback` one query, of the fields of an answer
(`state`, `epk`, `ct`, `tag`, `cred`) or of an error (`state`, `error`),
each once; anything else is refused with a status the page shows. The
answer is read here, and the page told what happened.

    // in the answers of the page:
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

What a command takes from an answer: a secret of 32 bytes, from one of the
passkeys it asked for; a new credential when enrolling.

    // in the answers of the page:
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

The listener
------------

The listener of the command line, on `node:http` (which Deno has too):
it opens the page with `open` (the browser of the system; a test gives
its own), says where to go if it could not, prints the code, and waits,
two minutes by default, saying once after ten seconds where to go if the
browser did not open. Ctrl-C gives up. The key pair is dropped as soon as
the listener closes.

    // in cli/unlock.js:
    import http from 'node:http';
    import process from 'node:process';
    import { spawn } from 'node:child_process';
    import { short } from '../core/folder.js';
    import { pageUrl, confirmationCode, newKeyPair, randomState, queryFields, openAnswer, answerPage, sameSecret,
             checkOwner, failure, answerOf, UnlockFailed, DONE, FAILED, NO_X25519, TIMEOUT, STILL } from '../core/passkey.js';
    import { utf8 } from '../core/crypto.js';

    export function systemBrowser(url) {
      const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
        : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
      return new Promise((resolve) => {
        try {
          const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
          child.on('error', () => resolve(false));
          child.on('spawn', () => {
            child.unref();
            resolve(true);
          });
        } catch {
          resolve(false);
        }
      });
    }

    export async function ask(mode, owner, creds = [], { noBrowser = false, timeout = TIMEOUT, ctrlC = 'type the passphrase instead',
                                                       open = systemBrowser, err = (l) => process.stderr.write(l + '\n') } = {}) {
      checkOwner(mode, owner);
      const listener = { mode, owner, state: randomState(), pair: await newKeyPair(), result: null };
      let finish;
      const done = new Promise((resolve) => { finish = resolve; });
      const server = http.createServer(async (req, res) => {
        const answer = (status, text) => {
          const page = utf8(answerPage(text));
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                                  'Referrer-Policy': 'no-referrer', 'Content-Length': String(page.length) });
          res.end(page);
        };
        const url = new URL(req.url, 'http://127.0.0.1');
        if (req.method !== 'GET' || url.pathname !== '/callback') return answer(404, 'not found');
        const fields = queryFields(url.search.slice(1));
        if (!fields) {
          return answer(400, 'this is not an answer of the page (if osheaf or the page was just updated, update the other too)');
        }
        if (!sameSecret(utf8(fields.state), utf8(listener.state))) return answer(403, 'this is not the answer osheaf is waiting for');
        if (listener.result !== null) return answer(409, 'osheaf has its answer already');
        listener.result = { pending: true };
        const result = await openAnswer(fields, listener);
        listener.result = result;
        if ('error' in result) answer(200, FAILED(result.error === 'x25519-unavailable' ? NO_X25519 : result.error.slice(0, 200)));
        else answer(200, DONE);
        finish();
      });
      server.requestTimeout = 5000;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const interrupted = new Promise((resolve) => {
        listener.onSigint = () => resolve('interrupted');
        process.once('SIGINT', listener.onSigint);
      });
      const wait = (ms) => {
        let timer;
        return Promise.race([done.then(() => 'done'), interrupted,
                             new Promise((resolve) => { timer = setTimeout(() => resolve('time'), ms); })])
          .finally(() => clearTimeout(timer));
      };
      try {
        const url = pageUrl(mode, server.address().port, listener.state, listener.pair.publicKey, owner, creds);
        const what = mode === 'enroll' ? `create a passkey for ${short(owner)}` : `unlock the keys of ${short(owner)} with your passkey`;
        let opened = false;
        if (!noBrowser) {
          err(`Opening the browser to ${what} (Touch ID)…`);
          try {
            opened = Boolean(await open(url));
          } catch {
            opened = false;
          }
        }
        if (!opened) err(`Go to this address in your browser, to ${what} (Touch ID):\n  ${url}`);
        err(`Check that the browser shows the code ${await confirmationCode(listener.state, listener.pair.publicKey)}`);
        err(`Waiting for the browser (Ctrl-C to ${ctrlC})…`);
        let limit = timeout, got = null;
        if (opened && limit > STILL) {
          got = await wait(STILL);
          if (got === 'time') {
            err(`Still waiting… if the browser did not open, go to:\n  ${url}`);
            limit -= STILL;
            got = null;
          }
        }
        got ??= await wait(limit);
        if (got === 'interrupted') throw new UnlockFailed('interrupted');
        if (got === 'time') throw new UnlockFailed('no answer from the browser in time');
      } finally {
        process.off('SIGINT', listener.onSigint);
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(() => resolve()));
        listener.pair = null;
      }
      if ('error' in listener.result) throw failure(listener.result);
      return listener.result;
    }

    export async function enroll(owner, exclude = [], options = {}) {
      const [cred, secret] = answerOf(await ask('enroll', owner, exclude, options));
      if (cred === null || exclude.includes(cred)) throw new UnlockFailed('the page sent no new credential');
      return [cred, secret];
    }

    export async function unlock(owner, creds, options = {}) {
      return answerOf(await ask('unlock', owner, creds, options), creds);
    }

    export { UnlockFailed };
