// Generated from literate/40-cli.md by opensheaf-literate: edit the document, not this file.
import { promises as fs, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { WalletError } from '../core/wallets.js';
import { sha256hex } from '../core/write.js';
import { utf8 } from '../core/crypto.js';
import { readAllStdin } from './keystore.js';

export const CLEAR_AFTER = 60;

function runCommand(cmd, args, input = null) {
  const r = spawnSync(cmd, args, { input: input ?? undefined, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  return { status: r.error ? 127 : r.status, stdout: r.stdout || '', stderr: r.stderr || '', missing: r.error?.code === 'ENOENT' };
}

export function clipboard({ copy = ['pbcopy'], paste = ['pbpaste'], clearAfter = CLEAR_AFTER } = {}) {
  return {
    clearAfter,
    async copy(text) {
      const r = runCommand(copy[0], copy.slice(1), text);
      if (r.missing) throw new WalletError(`no clipboard command ${copy[0]} on this system: use --stdout`);
      if (r.status !== 0) throw new WalletError('the text could not be copied to the clipboard');
    },
    async paste() {
      const r = runCommand(paste[0], paste.slice(1));
      if (r.missing) throw new WalletError(`no clipboard command ${paste[0]} on this system: use --stdin`);
      if (r.status !== 0) throw new WalletError('the clipboard could not be read');
      return r.stdout;
    },
    async clearLater(text) {
      if (!clearAfter) return;
      const digest = await sha256hex(utf8(text));
      const script = `sleep "$1"; if [ "$(${paste.join(' ')} | shasum -a 256 | cut -d ' ' -f 1)" = "$2" ]; then printf '' | ${copy.join(' ')}; fi`;
      const child = spawn('/bin/sh', ['-c', script, 'clear', String(clearAfter), digest], { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
    },
  };
}

export function userConfigPath(env = process.env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'opensheaf', 'config.json');
}

export function userConfig(env = process.env) {
  const p = userConfigPath(env);
  let text;
  try {
    text = readFileSync(p, 'utf-8');
  } catch {
    return {};
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new WalletError(`${p}: ${error.message}`);
  }
  const found = data && typeof data === 'object' ? data.keys : null;
  return found && typeof found === 'object' && !Array.isArray(found) ? found : {};
}

export function userFile(env = process.env) {
  const p = userConfigPath(env);
  let text;
  try {
    text = readFileSync(p, 'utf-8');
  } catch {
    return {};
  }
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    throw new WalletError(`${p}: ${error.message}`);
  }
}

export function writeUserFile(data, env = process.env) {
  const p = userConfigPath(env);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function githubToken(env = process.env) {
  const given = (env.GH_TOKEN || env.GITHUB_TOKEN || '').trim();
  if (given) return given;
  const r = runCommand('gh', ['auth', 'token']);
  return r.status === 0 ? r.stdout.trim() || null : null;
}

export function outside(env, given = {}) {
  const vars = given.environ || process.env;
  let token;
  return {
    clipboard: given.clipboard || clipboard(),
    wallets: given.wallets || {
      userConfig: () => userConfig(vars),
      userConfigPath: () => userConfigPath(vars),
      userFile: () => userFile(vars),
      writeUserFile: (data) => writeUserFile(data, vars),
      walletEnv: () => vars.OPENSHEAF_WALLET || '',
      run: async (command, input) => {
        const r = spawnSync(command, { shell: true, input: input ?? undefined, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return { status: r.error ? 127 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
      },
      remotes: async () => (env.archiveRoot ? runCommand('git', ['-C', env.archiveRoot, 'remote', '-v']).stdout : ''),
      github: { api: vars.OPENSHEAF_GITHUB_API || 'https://api.github.com', fetch: globalThis.fetch.bind(globalThis),
                token: async () => (token === undefined ? (token = githubToken(vars)) : token) },
    },
    readText: given.readText || ((p) => fs.readFile(p, 'utf-8')),
    readStdin: given.readStdin || readAllStdin,
    write: given.write || ((text) => process.stdout.write(text)),
  };
}
