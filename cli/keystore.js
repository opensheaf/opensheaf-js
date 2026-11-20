// Generated from literate/40-cli.md by opensheaf-literate: edit the document, not this file.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Key, KeyError, base64 } from '../core/keys.js';
import { keyId } from '../core/names.js';
import { unbase64 } from '../core/crypto.js';
import { Stop, sentence, short } from '../core/folder.js';

export const SIGNING_KEY = 'OPENSHEAF_SIGNING_KEY', KEY_STORE = 'OPENSHEAF_KEY_STORE';
const STORES = ['keyring', 'security', 'file', 'none'];
const STORE_NAMES = { file: 'a file of this computer', none: 'memory, for this command only' };

export function keyFolder(owner, env = process.env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'opensheaf', 'keys', owner);
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

export function fileKeyStore({ env = process.env, warn } = {}) {
  const pinned = env[KEY_STORE] || null;
  const memory = new Map();
  const store = () => {
    if (pinned && !STORES.includes(pinned)) throw new Stop(sentence(`${KEY_STORE} is one of ${STORES.join(', ')}`));
    if (pinned === 'keyring' || pinned === 'security') {
      throw new Stop(sentence(`${KEY_STORE}=${pinned}: opensheaf-js keeps current keys in files for now ` +
                              `(${KEY_STORE}=file); the keychain comes in a later version`));
    }
    return pinned || 'file';
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
      const kind = store();
      for (const did of dids) {
        const kid = await keyId(did);
        let text = memory.get(`${owner}:${kid}`) ?? null;
        if (text === null && kind === 'file') {
          const p = path.join(keyFolder(owner, env), `${kid}.key`);
          let st = null;
          try {
            st = await fs.lstat(p);
          } catch {
            st = null;
          }
          if (st?.isSymbolicLink()) throw new Stop(sentence(`${p} is a symbolic link: a key file is a plain file of its own`));
          if (st && process.platform !== 'win32' && (st.mode & 0o077)) {
            throw new Stop(sentence(`${p} can be read by other users: chmod 600 it (and check who read it)`));
          }
          if (st) text = (await fs.readFile(p, 'ascii')).trim();
        }
        if (text) {
          const key = await keyFromBase64(text, `${kind} ${owner}:${kid}`);
          if (key.did !== did) throw new Stop(sentence(`${kind} ${owner}:${kid} holds another key than ${did}`));
          found.push(key);
        }
      }
      return found;
    },
    async keep(owner, key) {
      const kind = store();
      const text = base64(key.seed);
      if (kind === 'none') {
        memory.set(`${owner}:${key.id}`, text);
        return 'none';
      }
      const folder = keyFolder(owner, env);
      await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      const p = path.join(folder, `${key.id}.key`);
      await fs.writeFile(p, text + '\n', { flag: 'wx', mode: 0o600 });
      warn(`a current key of ${short(owner)} is kept in ${p}, protected only by the permissions of your files; ` +
           'opensheaf-js does not use the system\'s credential store yet');
      return 'file';
    },
  };
}

export function exportFolder(archiveRoot = null) {
  return {
    async inside(folder) {
      const p = path.resolve(folder);
      if (archiveRoot) {
        const root = path.resolve(archiveRoot);
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

export async function readLine(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  process.stdout.write(prompt);
  try {
    for await (const line of rl) return line;
    return '';
  } finally {
    rl.close();
  }
}

function hidden(prompt) {
  process.stderr.write(prompt);
  if (!process.stdin.isTTY) return readLine('');
  return new Promise((resolve, reject) => {
    let typed = '';
    const done = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stderr.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          done();
          resolve(typed);
          return;
        }
        if (ch === '\u0003') {
          done();
          reject(new Stop('Interrupted.'));
          return;
        }
        typed = ch === '\u007f' || ch === '\b' ? typed.slice(0, -1) : typed + ch;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

export function passphrases(env = process.env, warn = () => {}) {
  let asked = null;
  return async ({ confirm = true, where = null } = {}) => {
    if (env.OPENSHEAF_PASSPHRASE) return env.OPENSHEAF_PASSPHRASE;
    if (asked !== null) return asked;
    const command = (env.OPENSHEAF_PASSPHRASE_COMMAND || '').trim();
    if (command) {
      try {
        const out = execSync(command, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
        const given = out.endsWith('\n') ? out.slice(0, -1) : out;
        if (given) return (asked = given);
        warn('OPENSHEAF_PASSPHRASE_COMMAND gave no passphrase: ');
      } catch (error) {
        warn(`OPENSHEAF_PASSPHRASE_COMMAND gave no passphrase: ${String(error.stderr || '').trim()}`);
      }
    }
    const first = await hidden(where ? `Passphrase of the keys in ${where}: ` : 'Passphrase of the keys: ');
    if (!first) throw new Stop(sentence('an empty passphrase: give --no-passphrase to export the keys without a passphrase lock'));
    if (confirm && (await hidden('The passphrase again: ')) !== first) throw new Stop(sentence('the two passphrases differ'));
    return (asked = first);
  };
}

export { KeyError };
