// Generated from literate/40-cli.md by opensheaf-literate: edit the document, not this file.
import { promises as fs, existsSync, openSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import tty from 'node:tty';
import { StringDecoder } from 'node:string_decoder';
import { execSync, spawnSync } from 'node:child_process';
import { Key, KeyError, base64 } from '../core/keys.js';
import { keyId, OWNER_NAME } from '../core/names.js';
import { unbase64 } from '../core/crypto.js';
import { Stop, sentence, short } from '../core/folder.js';

export const SIGNING_KEY = 'OPENSHEAF_SIGNING_KEY', KEY_STORE = 'OPENSHEAF_KEY_STORE';
export const SERVICE = 'opensheaf-current-key';
const STORES = ['keyring', 'security', 'file', 'none'];
const STORE_NAMES = { keyring: 'the keychain', security: 'the keychain', file: 'a file of this computer',
                      none: 'memory, for this command only' };

function ownerName(owner) {
  if (typeof owner !== 'string' || !OWNER_NAME.test(owner)) throw new KeyError(`not an owner name: '${owner}'`);
  return owner;
}

export function keyFolder(owner, env = process.env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'opensheaf', 'keys', ownerName(owner));
}

async function keyFromBase64(text, where) {
  let seed = new Uint8Array();
  try {
    seed = unbase64(text.trim());
  } catch {
    // not base64
  }
  if (seed.length !== 32) throw new Stop(sentence(`${where}: not the base64 seed of an Ed25519 key`));
  return Key.fromSeed(seed);
}

export function securityCommand(args, input = null) {
  const r = spawnSync('security', args, { input: input ?? undefined, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  return { status: r.error ? 127 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

export function keyStore({ env = process.env, warn = () => {}, err = warn, security = null,
                           platform = process.platform } = {}) {
  const pinned = env[KEY_STORE] || null;
  const run = security || securityCommand;
  const hasSecurity = Boolean(security) || (platform === 'darwin' && existsSync('/usr/bin/security'));
  const memory = new Map(), seen = new Map();
  let noted = false;
  const stores = () => {
    if (pinned && !STORES.includes(pinned)) throw new Stop(sentence(`${KEY_STORE} is one of ${STORES.join(', ')}`));
    if (pinned === 'none') return [];
    if (pinned === 'keyring') {
      if (platform !== 'darwin') {
        throw new Stop(sentence(`${KEY_STORE}=keyring: opensheaf-js cannot reach the system keyring of this system ` +
                                `(keyring is a Python package); use ${KEY_STORE}=file, and move a key kept there with ` +
                                'osheaf key export --stdout and osheaf key import --stdin'));
      }
      if (!noted) err(`Note: ${KEY_STORE}=keyring: opensheaf-js uses the macOS keychain through security, where keyring keeps the keys.`);
      noted = true;
      return ['security'];
    }
    if (pinned) return [pinned];
    return hasSecurity ? ['security', 'file'] : ['file'];
  };
  const account = (owner, kid) => `${ownerName(owner)}:${kid}`;
  const slot = (store, owner, kid) => `${store}|${store === 'file' ? keyFolder(owner, env) : ''}|${owner}|${kid}`;
  const read = async (store, owner, kid) => {
    if (store === 'none') return memory.get(account(owner, kid)) ?? null;
    if (store === 'security') {
      if (!hasSecurity) return null;
      const r = await run(['find-generic-password', '-s', SERVICE, '-a', account(owner, kid), '-w']);
      return r.status === 0 ? r.stdout.trim() : null;
    }
    const p = path.join(keyFolder(owner, env), `${kid}.key`);
    let st = null;
    try {
      st = await fs.lstat(p);
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) throw new Stop(sentence(`${p} is a symbolic link: a key file is a plain file of its own`));
    if (platform !== 'win32' && (st.mode & 0o077)) {
      throw new Stop(sentence(`${p} can be read by other users: chmod 600 it (and check who read it)`));
    }
    return (await fs.readFile(p, 'ascii')).trim();
  };
  const lookup = async (store, owner, kid) => {
    const s = slot(store, owner, kid);
    if (store === 'none') return read(store, owner, kid);
    if (!seen.has(s)) seen.set(s, await read(store, owner, kid));
    return seen.get(s);
  };

  const write = async (store, owner, kid, text) => {
    if (store === 'none') {
      memory.set(account(owner, kid), text);
      return true;
    }
    if (store === 'security') {
      if (!hasSecurity) return false;
      const r = await run(['-i'], `add-generic-password -U -s ${SERVICE} -a ${account(owner, kid)} -w ${text}\n`);
      if (r.status !== 0) return false;
      const back = await run(['find-generic-password', '-s', SERVICE, '-a', account(owner, kid), '-w']);
      return back.status === 0 && back.stdout.trim() === text;
    }
    const folder = keyFolder(owner, env);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const p = path.join(folder, `${kid}.key`);
    await fs.writeFile(p, text + '\n', { flag: 'wx', mode: 0o600 });
    warn(`a current key of ${short(owner)} is kept in ${p}, protected only by the permissions of your files` +
         (platform === 'darwin' ? '' : '; opensheaf-js reaches no credential store on this system'));
    return true;
  };
  return {
    keptOnDevice: () => pinned !== 'none',
    storeName: (s) => STORE_NAMES[s] || s,
    async current(owner, dids) {
      const given = (env[SIGNING_KEY] || '').trim();
      if (given) {
        const key = await keyFromBase64(given, SIGNING_KEY);
        if (!dids.includes(key.did)) {
          throw new Stop(sentence(`${SIGNING_KEY} holds ${key.did}, which is not a current key of ${owner}`));
        }
        return [key];
      }
      const found = [];
      for (const did of dids) {
        const kid = await keyId(did);
        for (const store of [...stores(), 'none']) {
          const text = await lookup(store, owner, kid);
          if (!text) continue;
          const key = await keyFromBase64(text, `${store} ${account(owner, kid)}`);
          if (key.did !== did) throw new Stop(sentence(`${store} ${account(owner, kid)} holds another key than ${did}`));
          found.push(key);
          break;
        }
      }
      return found;
    },
    async keep(owner, key, store = null) {
      const text = base64(key.seed);
      const todo = store ? [store] : stores();
      for (const s of todo.length ? todo : ['none']) {
        if (await write(s, owner, key.id, text)) {
          if (s !== 'none') seen.set(slot(s, owner, key.id), text);
          return s;
        }
      }
      throw new Stop(sentence(`no store kept the key ${key.did}`));
    },
    async forget(owner, did) {
      const kid = await keyId(did);
      const failed = [];
      for (const s of stores()) {
        if (s === 'security' && hasSecurity) {
          const r = await run(['delete-generic-password', '-s', SERVICE, '-a', account(owner, kid)]);
          if (![0, 44].includes(r.status)) failed.push([s, (r.stderr || '').trim() || `exit status ${r.status}`]);
        } else if (s === 'file') {
          try {
            await fs.unlink(path.join(keyFolder(owner, env), `${kid}.key`));
          } catch (error) {
            if (error.code !== 'ENOENT') failed.push([s, error.message]);
          }
        }
        seen.set(slot(s, owner, kid), null);
      }
      memory.delete(account(owner, kid));
      return failed;
    },
  };
}

export const fileKeyStore = keyStore;

async function realPath(p) {
  try {
    return await fs.realpath(p);
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code) || path.dirname(p) === p) throw error;
    return path.join(await realPath(path.dirname(p)), path.basename(p));
  }
}

export function exportFolder(archiveRoot = null) {
  return {
    async inside(folder) {
      const p = await realPath(path.resolve(folder));
      if (archiveRoot) {
        const root = await realPath(path.resolve(archiveRoot));
        if (p === root || p.startsWith(root + path.sep)) return root;
      }
      for (let d = p; ; d = path.dirname(d)) {
        try {
          await fs.access(path.join(d, 'osheaf.json'));
          return d;
        } catch {
          // not here
        }
        if (path.dirname(d) === d) return null;
      }
    },
    async write(folder, name, text) {
      await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      const p = path.join(folder, name);
      await fs.writeFile(p, text, { flag: 'wx', mode: 0o600, encoding: 'ascii' });
      return p;
    },
    read: (p) => fs.readFile(p, 'utf-8'),
    resolve: async (folder) => path.resolve(folder),
  };
}

const stdin = { text: '', ended: false, decoder: new StringDecoder('utf8') };

function taken() {
  const k = stdin.text.indexOf('\n');
  if (k >= 0) {
    const line = stdin.text.slice(0, k);
    stdin.text = stdin.text.slice(k + 1);
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  }
  if (!stdin.ended) return null;
  const rest = stdin.text;
  stdin.text = '';
  return rest;
}

function fromStdin(until) {
  if (!stdin.ended && process.stdin.readableEnded) stdin.ended = true;
  const now = until();
  if (now !== null) return Promise.resolve(now);
  return new Promise((resolve, reject) => {
    const done = (error, value) => {
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      process.stdin.pause();
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      stdin.text += typeof chunk === 'string' ? chunk : stdin.decoder.write(chunk);
      const value = until();
      if (value !== null) done(null, value);
    };
    const onEnd = () => {
      stdin.text += stdin.decoder.end();
      stdin.ended = true;
      done(null, until());
    };
    const onError = (error) => done(error);
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.resume();
  });
}

export async function readLine(prompt) {
  process.stdout.write(prompt);
  const line = await fromStdin(() => (stdin.ended && !stdin.text ? END : taken()));
  return line === END ? null : line;
}

const END = Symbol('the end of the standard input');

export function readAllStdin() {
  return fromStdin(() => {
    if (!stdin.ended) return null;
    const all = stdin.text;
    stdin.text = '';
    return all;
  });
}

function terminal() {
  try {
    return new tty.ReadStream(openSync('/dev/tty', 'r'));
  } catch {
    return null;
  }
}

function hidden(prompt) {
  if (process.stdin.isTTY) return typed(process.stdin, prompt);
  if ((stdin.ended || process.stdin.readableEnded) && !stdin.text) {
    const input = terminal();
    if (input) return typed(input, prompt).finally(() => input.destroy());
  }
  process.stderr.write(prompt);
  return fromStdin(taken);
}

function typed(input, prompt) {
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    let text = '';
    const done = () => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      process.stderr.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          done();
          resolve(text);
          return;
        }
        if (ch === '\u0003') {
          done();
          reject(new Stop('Interrupted.'));
          return;
        }
        text = ch === '\u007f' || ch === '\b' ? text.slice(0, -1) : text + ch;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

export function passphrases(env = process.env, warn = () => {}, read = hidden) {
  const asked = new Map();
  const ask = async ({ confirm = true, where = null } = {}) => {
    if (env.OPENSHEAF_PASSPHRASE) return env.OPENSHEAF_PASSPHRASE;
    if (asked.has(where)) return asked.get(where);
    const command = (env.OPENSHEAF_PASSPHRASE_COMMAND || '').trim();
    if (command) {
      try {
        const out = execSync(command, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] });
        const given = out.endsWith('\n') ? out.slice(0, -1) : out;
        if (given) {
          asked.set(where, given);
          return given;
        }
        warn('OPENSHEAF_PASSPHRASE_COMMAND gave no passphrase: ');
      } catch (error) {
        warn(`OPENSHEAF_PASSPHRASE_COMMAND gave no passphrase: ${String(error.stderr || '').trim()}`);
      }
    }
    const first = await read(where ? `Passphrase of the keys in ${where}: ` : 'Passphrase of the keys: ');
    if (!first) throw new Stop(sentence('an empty passphrase: give --no-passphrase to export the keys without a passphrase lock'));
    if (confirm && (await read('The passphrase again: ')) !== first) throw new Stop(sentence('the two passphrases differ'));
    asked.set(where, first);
    return first;
  };
  ask.known = (where = null) => Boolean(env.OPENSHEAF_PASSPHRASE) || asked.has(where);
  return ask;
}

export { KeyError };
