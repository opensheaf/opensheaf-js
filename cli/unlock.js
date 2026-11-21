// Generated from literate/36-passkeys.md by opensheaf-literate: edit the document, not this file.
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
