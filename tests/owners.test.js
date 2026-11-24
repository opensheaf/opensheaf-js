// Generated from literate/73-tests-owners.md by opensheaf-literate: edit the document, not this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, cp, mkdir, symlink, realpath, rename, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { main } from '../cli/osheaf.js';
import { keyStore, exportFolder } from '../cli/keystore.js';
import { DiskStorage } from '../cli/disk.js';
import { ask, peerUid } from '../cli/unlock.js';
import * as passkey from '../core/passkey.js';
import { passkeySalt, keyFileText, keyText, readKey, exampleKey, removePasskeys, passkeysOf, passkeyKek, Passkey,
         KeyError } from '../core/keys.js';
import { sha256, utf8 } from '../core/crypto.js';
import { base64 } from '../core/keys.js';

const COST = { opslimit: 1, memlimit: 8192 };
const PASS = 'correct horse';

function fakeGitHub(repos) {
  const calls = [];
  const json = (status, value) => new Response(JSON.stringify(value), { status });
  const sha = async (text) => [...await sha256(utf8(text))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push(`${method} ${u.pathname}`);
    const parts = u.pathname.split('/').filter(Boolean);
    const repo = `${parts[1]}/${parts[2]}`;
    if (parts[0] !== 'repos' || !(repo in repos)) return json(404, { message: 'Not Found' });
    const r = repos[repo];
    if (parts.length === 3) return json(200, { full_name: repo, private: r.visibility !== 'public', visibility: r.visibility });
    const p = parts.slice(4).join('/');
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'GET') {
      if (p in r.files) return json(200, { type: 'file', sha: await sha(r.files[p]), content: base64(utf8(r.files[p])) });
      const below = Object.keys(r.files).filter((f) => p === '' || f.startsWith(p + '/'));
      if (!below.length) return json(404, { message: 'Not Found' });
      const names = new Map();
      for (const f of below) {
        const rest = p === '' ? f : f.slice(p.length + 1);
        const k = rest.indexOf('/');
        names.set(k < 0 ? rest : rest.slice(0, k), k < 0 ? 'file' : 'dir');
      }
      return json(200, [...names].map(([name, type]) => ({ name, type })));
    }
    if (method === 'PUT') {
      if (p in r.files && body.sha !== (await sha(r.files[p]))) return json(409, { message: 'sha does not match' });
      r.files[p] = new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)));
      return json(200, {});
    }
    if (method === 'DELETE') {
      if (!(p in r.files) || body.sha !== (await sha(r.files[p]))) return json(404, { message: 'Not Found' });
      delete r.files[p];
      return json(200, {});
    }
    return json(405, {});
  };
  return { fetch, calls };
}

const CRED = 'ZmFrZS1wYXNza2V5LWNyZWRlbnRpYWw';

async function followStart(url) {
  assert.match(url, /^http:\/\/127\.0\.0\.1:[0-9]+\/start$/);
  const r = await fetch(url, { redirect: 'manual' });
  await r.text();
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  return r.headers.get('location');
}

function fakeBrowser(opened, { answer = 'secret', cred = CRED } = {}) {
  return async (url) => {
    url = await followStart(url);
    assert.ok(url.startsWith(passkey.UNLOCK_PAGE + '#') && !url.includes('?'));
    const q = Object.fromEntries(new URLSearchParams(url.split('#')[1]));
    opened.push(q);
    if (answer === 'none') return true;
    const salt = await passkeySalt(q.owner);
    const used = q.mode === 'enroll' ? ((q.cred || '').split(',').includes(cred) ? null : cred) : q.cred.split(',')[0];
    const fields = { state: q.state };
    if (answer === 'error' || used === null) {
      fields.error = used === null ? 'InvalidStateError: a passkey of this owner is here already' : 'NotAllowedError: the user cancelled';
    } else {
      let prf = await sha256(new Uint8Array([...utf8('fake prf ' + used), ...salt]));
      if (answer === 'forged') prf = await sha256(utf8('forged'));
      let [epk, ct, tag] = await passkey.seal(prf, passkey.fromB64url(q.pk), q.state, q.mode, q.owner, used);
      if (answer === 'tampered') ct = new Uint8Array(32);
      Object.assign(fields, { epk: passkey.b64url(epk), ct: passkey.b64url(ct), tag: passkey.b64url(tag), cred: used });
    }
    setTimeout(async () => {
      const r = await fetch(`http://127.0.0.1:${q.port}/callback?` + new URLSearchParams(fields));
      opened.push({ status: r.status });
      await r.text();
    }, 10);
    return true;
  };
}

async function sandbox({ repos = null, security = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'osheaf-owners-'));
  const githubRepos = repos || { 'me/keys': { visibility: 'private', files: {} },
                                 'me/open': { visibility: 'public', files: {} },
                                 'me/papers': { visibility: 'private', files: {} } };
  const github = fakeGitHub(githubRepos);
  const box = { root, github, githubRepos, clip: '', opened: [], browser: null, vars: {}, inputs: [], cleared: [] };
  box.run = async (argv, { vars = {}, stdin = '' } = {}) => {
    const out = [], err = [];
    const environ = { XDG_CONFIG_HOME: path.join(root, 'config'), OPENSHEAF_KEY_STORE: 'file', ...box.vars, ...vars };
    const ask = async () => PASS;
    ask.known = () => true;
    const status = await main(argv, {
      out: (l) => out.push(l), err: (l) => err.push(l), write: (t) => out.push(t.replace(/\n$/, '')),
      input: async () => box.inputs.shift() ?? '',
      keyStore: keyStore({ env: environ, warn: (t) => err.push('Warning: ' + t), err: (t) => err.push(t), security }),
      passphrase: ask, cost: COST, environ,
      clipboard: { clearAfter: 60, copy: async (t) => { box.clip = t; }, paste: async () => box.clip,
                   clearLater: (t) => box.cleared.push(t) },
      wallets: {
        userConfig: () => JSON.parse(environ.USER_CONFIG || '{}'), userConfigPath: () => path.join(root, 'config', 'opensheaf', 'config.json'),
        userFile: () => {
          try {
            return JSON.parse(readFileSync(path.join(root, 'config', 'opensheaf', 'config.json'), 'utf-8'));
          } catch {
            return { keys: JSON.parse(environ.USER_CONFIG || '{}') };
          }
        },
        writeUserFile: (data) => {
          mkdirSync(path.join(root, 'config', 'opensheaf'), { recursive: true });
          writeFileSync(path.join(root, 'config', 'opensheaf', 'config.json'), JSON.stringify(data, null, 2) + '\n');
        },
        walletEnv: () => environ.OPENSHEAF_WALLET || '', remotes: async () => environ.REMOTES || '',
        run: async (command, input) => runShell(command, input),
        github: { api: 'https://api.github.invalid', fetch: github.fetch, token: async () => 'a token' },
      },
      readStdin: async () => stdin,
      openBrowser: box.browser || (async (url) => assert.fail(`a browser was opened: ${url}`)),
      unlockTimeout: 3000, unlockMode: environ.OPENSHEAF_UNLOCK || '', passphraseGiven: Boolean(environ.GIVEN),
      signingKeyGiven: false,
    });
    return { status, out: out.join('\n'), err: err.join('\n'), said: [...out, ...err].join('\n') };
  };
  box.ok = async (argv, options) => {
    const r = await box.run(argv, options);
    assert.equal(r.status, 0, `${argv.join(' ')}:\n${r.said}`);
    return r;
  };
  box.done = () => rm(root, { recursive: true, force: true });
  return box;
}

async function runShell(command, input) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(command, { shell: true, input: input ?? undefined, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function archive(box, name = 'arch', more = []) {
  const dir = path.join(box.root, name);
  await box.ok(['init', dir, '--name', 'Papers', '--base-url', `https://example.org/${name}/`, '--curator', 'Doe, Jane',
                '--new-owner', '--yes', ...more]);
  const cfg = JSON.parse(await readFile(path.join(dir, 'osheaf.json'), 'utf-8'));
  return { dir, owner: cfg.owner, r: ['--root', dir] };
}

async function exported(box, folder) {
  return (await readdir(path.join(box.root, folder))).map((n) => path.join(box.root, folder, n));
}

async function deposit(box, a, label, text, isNew = false) {
  await writeFile(path.join(box.root, `${label}.pdf`), `%PDF-1.4 ${text}\n`);
  return box.ok([...a.r, 'deposit', label, '--pdf', path.join(box.root, `${label}.pdf`), '--no-source', 'x',
                 '--title', 'T', '--author', 'Doe, J', ...(isNew ? ['--new'] : [])]);
}

async function errorsOf(box, a) {
  const r = await box.run([...a.r, 'verify', '--json']);
  return JSON.parse(r.out).filter((f) => f.severity !== 'result').map((f) => `${f.severity}: ${f.place}: ${f.message}`);
}

test('an owner offline: rotate, expose, sign again, end', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    await deposit(box, a, 'paper', 'one', true);
    const fresh = (await box.ok([...a.r, 'key', 'new'])).out.split('\n')[1].trim();
    assert.match(fresh, /^did:key:z6Mk/);
    const k1 = await exported(box, 'k1');
    const r = await box.ok([...a.r, 'owner', 'rotate', '--add', fresh, '--rotation-key', k1[0], '--rotation-key', k1[1],
                            '--export', path.join(box.root, 'k2'), '--no-passphrase', '--yes']);
    assert.match(r.out, /Done: v2 of the key log of .*, signed by 2 rotation keys of v1:/);
    const show = (await box.ok([...a.r, 'owner', 'show', '--offline'])).out;
    const first = /Current keys  (did:key:\S+)/.exec(show)[1];
    assert.equal((show.match(/\(on this computer\)/g) || []).length, 2);
    const k2 = await exported(box, 'k2');
    await box.ok([...a.r, 'owner', 'expose', first, '--rotation-key', k2[0], '--rotation-key', k2[2],
                  '--export', path.join(box.root, 'k3'), '--no-passphrase', '--yes']);
    assert.match((await box.ok([...a.r, 'owner', 'show', '--offline'])).out, /Exposed keys  did:key:/);
    const refused = await box.run([...a.r, 'sign', 'paper', '--version', 'v2']);
    assert.equal(refused.status, 1);
    assert.match(refused.err, /no object version v2/);
    box.inputs.push('wrong');
    assert.match((await box.run([...a.r, 'sign', 'paper', '--version', 'v1'])).err, /Not confirmed: nothing was signed/);
    const again = await box.ok([...a.r, 'sign', 'paper', '--version', 'v1', '--yes']);
    assert.match(again.out, /signed again by 1 key of .*, under v3 of the key log; it is now signed\./);
    await box.ok([...a.r, 'sign', 'main', '--version', 'v1', '--yes']);
    assert.deepEqual(await errorsOf(box, a), []);
    const k3 = await exported(box, 'k3');
    const ended = await box.ok([...a.r, 'owner', 'end', '--rotation-key', k3[0], '--rotation-key', k3[1]]);
    assert.match(ended.out, /has ended, at v4 of its key log\./);
    const after = await box.run([...a.r, 'deposit', 'paper', '--pdf', path.join(box.root, 'paper.pdf'), '--no-source', 'x',
                                 '--title', 'T', '--author', 'Doe, J', '--changes', 'A version after the end.']);
    assert.equal(after.status, 1);
    assert.match(after.err, /has ended \(section 6\.3\): nothing is signed for it/);
    assert.deepEqual(await errorsOf(box, a), []);
  } finally {
    await box.done();
  }
});

test('copies of a key log: init --owner, pull, a fork recorded', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    const ownerDir = path.join(a.dir, 'ocfl', a.owner, a.owner);
    await cp(ownerDir, path.join(box.root, 'v1copy'), { recursive: true });
    const b = path.join(box.root, 'b');
    await box.ok(['init', b, '--name', 'B', '--base-url', 'https://example.org/b/', '--curator', 'Doe, Jane',
                  '--owner', a.owner, '--key-log', path.join(box.root, 'v1copy')]);
    const k1 = await exported(box, 'k1');
    await box.ok([...a.r, 'owner', 'rotate', '--rotation-key', k1[0], '--rotation-key', k1[1],
                  '--export', path.join(box.root, 'k2'), '--no-passphrase', '--yes']);
    const pulled = await box.ok(['--root', b, 'owner', 'pull', ownerDir]);
    assert.match(pulled.out, /1 version added from the copy at/);
    assert.match(pulled.out, /is here up to v2\./);
    assert.match((await box.ok(['--root', b, 'owner', 'pull', ownerDir])).out, /is here up to v2\./);
    const c = path.join(box.root, 'c');
    await box.ok(['init', c, '--name', 'C', '--base-url', 'https://example.org/c/', '--curator', 'Doe, Jane',
                  '--owner', a.owner, '--key-log', path.join(box.root, 'v1copy')]);
    await box.ok(['--root', c, 'owner', 'rotate', '--rotation-key', k1[1], '--rotation-key', k1[2],
                  '--export', path.join(box.root, 'k2c'), '--no-passphrase', '--yes']);
    const fork = await box.ok([...a.r, 'owner', 'pull', path.join(c, 'ocfl', a.owner, a.owner)]);
    assert.match(fork.out, /a fork at v2 met at .*: fork record appended as v3; the owner has ended/);
    assert.match(fork.out, /it was ended by a fork at v2\./);
    assert.match((await box.ok([...a.r, 'owner', 'show', '--offline'])).out, /Status        ended by a fork at v2/);
    assert.deepEqual(await errorsOf(box, a), []);
    const wrong = await box.run(['--root', b, 'owner', 'pull', path.join(box.root, 'nowhere')]);
    assert.equal(wrong.status, 1);
  } finally {
    await box.done();
  }
});

test('an owner in a GitHub wallet', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--keys', 'github:me/keys']);
    const repo = Object.keys(fakeFiles(box));
    assert.equal(repo.length, 4);
    assert.deepEqual(JSON.parse(await readFile(path.join(a.dir, 'osheaf.json'), 'utf-8')).keys,
                     { [a.owner]: { wallets: ['github:me/keys'] } });
    const list = await box.ok([...a.r, 'key', 'list']);
    assert.match(list.out, /The wallet github:me\/keys holds 4 keys:/);
    assert.equal((list.out.match(/rotation/g) || []).length, 3);
    assert.match(list.out, /current\s+\S+\s+v1\s+passphrase/);
    assert.ok(!/seed/.test(list.said));
    const show = (await box.ok([...a.r, 'owner', 'show', '--offline'])).out;
    const did = /Current keys  (did:key:\S+)/.exec(show)[1];
    assert.match((await box.ok([...a.r, 'key', 'forget', did, '--yes'])).out, /no longer holds the current key/);
    assert.match((await box.ok([...a.r, 'key', 'pull'])).out, /Pulled 1 current key of .* into a file of this computer\./);
    assert.match((await box.ok([...a.r, 'key', 'pull'])).out, /already on this computer/);
    await box.ok([...a.r, 'key', 'forget', did, '--yes']);
    await deposit(box, a, 'paper', 'one', true);
    assert.match((await box.ok([...a.r, 'owner', 'show', '--offline'])).out, /\(on this computer\)/);
    box.inputs.push('no');
    const asked = await box.run([...a.r, 'key', 'push']);
    assert.equal(asked.status, 1);
    assert.match(asked.err, /named by osheaf\.json of this archive/);
    assert.match(asked.err, /not confirmed: nothing was put into github:me\/keys/i);
    assert.match((await box.ok([...a.r, 'key', 'push', '--yes'])).out, /already in github:me\/keys/);
    mkdirSync(path.join(box.root, 'config', 'opensheaf'), { recursive: true });
    writeFileSync(path.join(box.root, 'config', 'opensheaf', 'config.json'), JSON.stringify({ wallets: ['github:me/keys'] }));
    assert.match((await box.ok([...a.r, 'key', 'push'])).out, /already in github:me\/keys/);
    writeFileSync(path.join(box.root, 'config', 'opensheaf', 'config.json'), '{}');
    const moved = await box.ok([...a.r, 'owner', 'rotate', '--keys', 'offline', '--export', path.join(box.root, 'k2'),
                                '--no-passphrase', '--yes']);
    assert.match(moved.err, /Reading the 2 rotation keys of v1 .* from github:me\/keys/);
    assert.match(moved.err, /Moved up to the maximum security level/);
    const refused = await box.run([...a.r, 'key', 'forget', '--from-wallet', '--used']);
    assert.equal(refused.status, 1);
    box.inputs.push('forget');
    const gone = await box.ok([...a.r, 'key', 'forget', '--from-wallet', '--used']);
    assert.match(gone.out, /Done: 3 keys of .* removed from github:me\/keys\./);
    assert.equal(Object.keys(fakeFiles(box)).length, 1);
    assert.deepEqual(await errorsOf(box, a), []);
  } finally {
    await box.done();
  }
});

function fakeFiles(box) {
  return box.githubRepos['me/keys'].files;
}

test('key forget asks, and reports a store that fails', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'usb'), '--no-passphrase']);
    const show = (await box.ok([...a.r, 'owner', 'show', '--offline'])).out;
    const current = /Current keys  (did:key:\S+)/.exec(show)[1];
    const folder = path.join(box.root, 'config', 'opensheaf', 'keys', a.owner);
    box.inputs.push('no');
    const refused = await box.run([...a.r, 'key', 'forget', current]);
    assert.equal(refused.status, 1);
    assert.match(refused.err, /not confirmed/i);
    assert.match(refused.err, /a current key of the latest version/);
    assert.equal((await readdir(folder)).length, 1);
    const { chmod } = await import('node:fs/promises');
    await chmod(folder, 0o500);
    try {
      const failed = await box.run([...a.r, 'key', 'forget', current, '--yes']);
      assert.equal(failed.status, 1);
      assert.match(failed.err, /not removed from this computer/i);
    } finally {
      await chmod(folder, 0o700);
    }
    const answers = [{ status: 44, stdout: '', stderr: '' }, { status: 51, stdout: '', stderr: 'User interaction is not allowed.' }];
    const store = keyStore({ env: { OPENSHEAF_KEY_STORE: 'security' }, platform: 'darwin',
                             security: async () => answers.shift() });
    assert.deepEqual(await store.forget(a.owner, current), []);
    assert.deepEqual(await store.forget(a.owner, current), [['security', 'User interaction is not allowed.']]);
  } finally {
    await box.done();
  }
});

test('the wallets of each owner', async () => {
  const box = await sandbox({ repos: { 'me/keys': { visibility: 'private', files: {} },
                                       'me/other': { visibility: 'private', files: {} } } });
  try {
    const a = await archive(box, 'arch', ['--keys', 'github:me/keys']);
    await box.ok([...a.r, 'owner', 'init', '--keys', 'github:me/other', '--yes']);
    const cfgOf = async () => JSON.parse(await readFile(path.join(a.dir, 'osheaf.json'), 'utf-8'));
    const second = (await cfgOf()).owners[0];
    const disc = JSON.parse(await readFile(path.join(a.dir, 'opensheaf.json'), 'utf-8'));
    assert.deepEqual(disc.owners.map((e) => e.owner), [a.owner, second]);
    assert.equal(disc.owners[1].catalogue.split(':')[2], second);
    assert.deepEqual((await cfgOf()).keys, { [a.owner]: { wallets: ['github:me/keys'] },
                                             [second]: { wallets: ['github:me/other'] } });
    assert.match((await box.ok([...a.r, 'key', 'list', '--owner', second])).out, /The wallet github:me\/other holds 4 keys of/);
    await box.ok([...a.r, 'key', 'push', '--wallet', 'github:me/other']);
    assert.deepEqual((await cfgOf()).keys[a.owner], { wallets: ['github:me/keys', 'github:me/other'] });
    await box.ok([...a.r, 'key', 'wallet', '--add', 'github:me/missing']);
    await box.ok([...a.r, 'key', 'wallet', '--remove', 'github:me/keys']);
    assert.deepEqual((await cfgOf()).keys[a.owner], { wallets: ['github:me/other', 'github:me/missing'] });
    assert.equal((await box.ok([...a.r, 'key', 'wallet'])).out,
                 `The keys of ${a.owner.slice(0, 8)}\u2026${a.owner.slice(-4)} are looked for in, in order:\n` +
                 '  github:me/other    osheaf.json\n  github:me/missing  osheaf.json');
    assert.match((await box.ok([...a.r, 'key', 'pull'])).out, /already on this computer|Pulled/);
    await box.ok([...a.r, 'key', 'wallet', '--remove', 'github:me/missing']);
    assert.equal((await box.run([...a.r, 'key', 'wallet', '--add', 'command'])).status, 1);
    const user = path.join(box.root, 'config', 'opensheaf', 'config.json');
    await mkdir(path.dirname(user), { recursive: true });
    await writeFile(user, JSON.stringify({ other: 1 }));
    await box.ok([...a.r, 'key', 'wallets', '--add', 'github:me/keys']);
    assert.deepEqual(JSON.parse(await readFile(user, 'utf-8')), { other: 1, wallets: ['github:me/keys'] });
    const listed = (await box.ok([...a.r, 'key', 'wallets'])).out.split('\n');
    assert.equal(listed[0], 'github:me/other (osheaf.json):');
    assert.equal(listed[3], `github:me/keys (${user}):`);
    assert.deepEqual(listed[4].trim().split(/\s+/).slice(1), ['4', 'keys', 'passphrase']);
    await box.ok([...a.r, 'key', 'wallet', '--owner', a.owner, '--remove', 'github:me/other']);
    await box.ok([...a.r, 'key', 'wallets', '--remove', 'github:me/keys']);
    assert.deepEqual(JSON.parse(await readFile(user, 'utf-8')).wallets, []);
    const cfg = await cfgOf();
    cfg.keys = { wallet: 'github:me/other' };
    await writeFile(path.join(a.dir, 'osheaf.json'), JSON.stringify(cfg, null, 2) + '\n');
    assert.match((await box.run([...a.r, 'key', 'list'])).said, /no longer read/);
  } finally {
    await box.done();
  }
});

test('the wallets refused', async () => {
  const box = await sandbox();
  try {
    const open = await box.run(['init', path.join(box.root, 'x'), '--name', 'X', '--base-url', 'https://example.org/x/',
                                '--curator', 'Doe, Jane', '--new-owner', '--yes', '--keys', 'github:me/open']);
    assert.equal(open.status, 1);
    assert.match(open.err, /me\/open is not a private repository: a wallet must be private: nothing was written to the key log\./);
    const own = await box.run(['init', path.join(box.root, 'y'), '--name', 'Y', '--base-url', 'https://me.github.io/papers/',
                               '--curator', 'Doe, Jane', '--new-owner', '--yes', '--keys', 'github:me/papers']);
    assert.equal(own.status, 1);
    assert.match(own.err, /me\/papers is a repository of the archive, which is public/);
    const remote = await box.run(['init', path.join(box.root, 'z'), '--name', 'Z', '--base-url', 'https://example.org/z/',
                                  '--curator', 'Doe, Jane', '--new-owner', '--yes', '--keys', 'github:Me/Keys'],
                                 { vars: { REMOTES: 'origin\tgit@github.com:me/keys.git (fetch)\n' } });
    assert.match(remote.err, /is a repository of the archive/);
    const a = await archive(box, 'arch', ['--keys', 'github:me/keys']);
    const cfg = JSON.parse(await readFile(path.join(a.dir, 'osheaf.json'), 'utf-8'));
    await writeFile(path.join(a.dir, 'osheaf.json'), JSON.stringify({ ...cfg, keys: { wallet: 'command', read: 'cat x' } }, null, 2));
    const cmd = await box.run([...a.r, 'key', 'list']);
    assert.equal(cmd.status, 1);
    assert.match(cmd.err, /osheaf.json configures a command wallet/);
    await writeFile(path.join(a.dir, 'osheaf.json'), JSON.stringify(cfg, null, 2));
    const rows = (await box.ok([...a.r, 'key', 'list'])).out.split('\n').filter((l) => /rotation/.test(l));
    const show = (await box.ok([...a.r, 'owner', 'show', '--offline'])).out;
    assert.ok(rows.length === 3 && show);
    const files = box.githubRepos['me/keys'].files;
    const rotation = Object.entries(files).find(([, t]) => /kind rotation/.test(t))[1];
    const rdid = /key (did:key:\S+)/.exec(rotation)[1];
    const kept = await box.run([...a.r, 'key', 'forget', '--from-wallet', rdid, '--yes']);
    assert.equal(kept.status, 1);
    assert.match(kept.err, /a rotation key of the latest version of the key log, kept/);
    await box.ok([...a.r, 'key', 'forget', '--from-wallet', rdid, '--yes', '--force']);
    assert.equal(Object.keys(files).length, 3);
  } finally {
    await box.done();
  }
});

test('a command wallet', async () => {
  const box = await sandbox();
  try {
    const store = path.join(box.root, 'pm');
    await mkdir(store);
    box.vars.OPENSHEAF_WALLET = JSON.stringify({
      wallet: 'command', read: `cat '${store}/{owner}-{k}' 2>/dev/null`, write: `cat > '${store}/{owner}-{k}'`,
      list: `ls '${store}' | tr '-' ' '`, forget: `rm '${store}/{owner}-{k}'` });
    const a = await archive(box, 'arch', ['--keys', 'command']);
    assert.equal((await readdir(store)).length, 4);
    assert.equal(JSON.parse(await readFile(path.join(a.dir, 'osheaf.json'), 'utf-8')).keys, undefined);
    assert.match((await box.ok([...a.r, 'key', 'list'])).out, /The wallet command holds 4 keys:/);
    await box.ok([...a.r, 'owner', 'rotate', '--keys', 'command']);
    assert.equal((await readdir(store)).length, 7);
    box.inputs.push('forget');
    await box.ok([...a.r, 'key', 'forget', '--from-wallet', '--used']);
    assert.equal((await readdir(store)).length, 4);
    assert.deepEqual(await errorsOf(box, a), []);
  } finally {
    await box.done();
  }
});

test('a command that writes stops when a page of objects cannot be read (#19)', async () => {
  const { PAGING } = await import('../core/discovery.js');
  const box = await sandbox();
  PAGING.perPage = 1;
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    await deposit(box, a, 'one', 'one', true);
    await deposit(box, a, 'two', 'two', true);
    const disc = JSON.parse(await readFile(path.join(a.dir, 'opensheaf.json'), 'utf-8'));
    await rm(path.join(a.dir, disc.objectPages[0]));
    const before = await readFile(path.join(a.dir, 'opensheaf.json'));
    for (const argv of [['index'], ['deposit', 'two', '--pdf', path.join(box.root, 'two.pdf'), '--no-source', 'x',
                                   '--title', 'Two', '--author', 'Doe, J']]) {
      const r = await box.run([...a.r, ...argv]);
      assert.equal(r.status, 1, r.said);
      assert.match(r.err, /the labels of the lines are not known/);
    }
    assert.deepEqual(await readFile(path.join(a.dir, 'opensheaf.json')), before);
    assert.ok((await errorsOf(box, a)).some((e) => /is missing \(section 3\.1\)/.test(e)));
  } finally {
    PAGING.perPage = 1000;
    await box.done();
  }
});

test('key files, passkey locks and texts', async () => {
  const owner = 'a'.repeat(51) + 'q', k = await exampleKey('wallet passkey');
  const salt = await passkeySalt(owner);
  const old = new Passkey('b2xkLWNyZWRlbnRpYWw', salt, { rp: 'opensheaf.org', kek: await passkeyKek(new Uint8Array(32).fill(4)) });
  const now = new Passkey('bmV3LWNyZWRlbnRpYWw', salt, { kek: await passkeyKek(new Uint8Array(32).fill(5)) });
  const text = await keyFileText(k, owner, 'current', 1, 'pass', { passkeys: [old, now], cost: COST });
  assert.match(text, /wrap passkey prf rp=opensheaf.org cred=b2xkLWNyZWRlbnRpYWw/);
  assert.equal((await readKey(text, null, { [old.cred]: old.kek })).key.did, k.did);
  assert.equal((await readKey(text, 'pass')).key.did, k.did);
  await assert.rejects(readKey(text, null, { [now.cred]: old.kek }), /a passphrase is needed/);
  const found = Object.fromEntries(passkeysOf(text).map((p) => [p.cred, p]));
  assert.ok((await found[now.cred].opens(now.kek)) && !(await found[now.cred].opens(old.kek)));
  const moved = removePasskeys(text, null, 'opensheaf.org');
  assert.ok(!moved.includes('rp=opensheaf.org') && moved.split('wrap passkey').length === 2);
  assert.throws(() => removePasskeys(text), KeyError);
  const costly = text.replace('opslimit=1 memlimit=8192', 'opslimit=5 memlimit=8192');
  await assert.rejects(readKey(costly, 'pass'), /out of bounds/);
  const plain = await keyText(k, owner);
  assert.equal((await readKey(plain)).key.did, k.did);
  const locked = await keyText(k, owner, 'current', 'pass', COST);
  assert.equal((await readKey(locked, 'pass')).key.did, k.did);
  const accented = '\u00c9lan caf\u00e9, cr\u00e8me br\u00fbl\u00e9e';
  const nfc = accented.normalize('NFC'), nfd = accented.normalize('NFD');
  assert.notEqual(nfc, nfd);
  for (const [one, other] of [[nfc, nfd], [nfd, nfc]]) {
    for (const t of [await keyFileText(k, owner, 'current', 2, one, { cost: COST }), await keyText(k, owner, 'current', one, COST)]) {
      assert.equal((await readKey(t, other)).key.did, k.did);
      assert.equal((await readKey(t, one)).key.did, k.did);
    }
  }
  await assert.rejects(readKey(await keyText(k, owner, 'current', nfc, COST), 'Elan cafe, creme brulee'), /wrong passphrase/);
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    assert.equal((await box.run([...a.r, 'key', 'export'])).status, 1);
    const out = (await box.ok([...a.r, 'key', 'export', '--stdout'])).out;
    assert.match(out, /^opensheaf-key-text\/0\.2\nkind current\n/);
    const clip = await box.ok([...a.r, 'key', 'export', '--clipboard', '--encrypt']);
    assert.match(clip.err, /is on the clipboard: paste it/);
    assert.equal(box.cleared[0], box.clip);
    const did = /key (did:key:\S+)/.exec(out)[1];
    await box.ok([...a.r, 'key', 'forget', did, '--yes']);
    assert.match((await box.ok([...a.r, 'key', 'import', '--clipboard'])).out, /is now kept in a file of this computer\./);
    assert.match((await box.ok([...a.r, 'key', 'import', '--stdin'], { stdin: out + '\n' })).out, /already on this computer/);
    const rot = await readFile((await exported(box, 'k1'))[0], 'utf-8');
    assert.match((await box.run([...a.r, 'key', 'import', '--stdin'], { stdin: rot })).err, /A rotation key is never kept on a device/);
  } finally {
    await box.done();
  }
});

test('passphrases piped in, and after a key read from the standard input', async () => {
  const { spawn } = await import('node:child_process');
  const isDeno = typeof globalThis.Deno !== 'undefined';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'osheaf-stdin-'));
  try {
    const script = path.join(dir, 'ask.mjs');
    await writeFile(script, [
      "import process from 'node:process';",
      `import { passphrases, readAllStdin } from ${JSON.stringify(new URL('../cli/keystore.js', import.meta.url).href)};`,
      "const all = process.argv.includes('all');",
      "const env = process.argv.includes('command') ? { OPENSHEAF_PASSPHRASE_COMMAND: 'head -n 1' } : {};",
      'try {',
      "  if (all) console.log('read', (await readAllStdin()).length);",
      "  console.log('got', JSON.stringify(await passphrases(env)({ confirm: !all })));",
      "} catch (e) { console.log('stop', e.message); }"].join('\n'));
    const run = (args, input) => new Promise((resolve, reject) => {
      const command = isDeno ? [process.execPath, 'run', '-A', script, ...args] : [process.execPath, script, ...args];
      // detached: a session of its own, without the terminal of the tests
      const child = spawn(command[0], command.slice(1), { detached: true, stdio: ['pipe', 'pipe', 'pipe'],
                                                          env: { PATH: process.env.PATH, HOME: dir } });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`no answer: ${out}`)); }, 30000);
      child.on('close', () => { clearTimeout(timer); resolve(out); });
      child.stdin.end(input);
    });
    assert.match(await run([], 'a passphrase\na passphrase\n'), /got "a passphrase"/);
    const after = await run(['all'], 'the text of a key\n');
    assert.match(after, /read 18\nstop An empty passphrase/);
    assert.match(await run(['command'], 'from the command\n'), /got "from the command"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('passkeys: enroll, unlock, and keys opened by them', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--keys', 'github:me/keys']);
    box.browser = fakeBrowser(box.opened);
    const enrolled = await box.ok([...a.r, 'key', 'enroll']);
    assert.match(enrolled.out, /Done: the 4 keys of .* open with your passkey \(Touch ID\) and still with your passphrase\./);
    assert.deepEqual(box.opened.filter((q) => q.mode).map((q) => q.mode), ['enroll', 'unlock']);
    assert.match(enrolled.err, /Check that the browser shows the code \d{3} \d{3}/);
    assert.match((await box.ok([...a.r, 'key', 'enroll'])).out, /already opens with your passkey/);
    assert.match((await box.ok([...a.r, 'key', 'list'])).out, /passphrase, passkey \(unlock\.opensheaf\.org\)/);
    const show = (await box.ok([...a.r, 'owner', 'show', '--offline'])).out;
    await box.ok([...a.r, 'key', 'forget', /Current keys  (did:key:\S+)/.exec(show)[1], '--yes']);
    box.opened.length = 0;
    const unlocked = await box.ok([...a.r, 'key', 'unlock']);
    assert.match(unlocked.out, /All 4 keys of .* opened with your passkey\./);
    assert.match(unlocked.out, /Pulled 1 current key/);
    box.opened.length = 0;
    const rotated = await box.ok([...a.r, 'owner', 'rotate', '--keys', 'github:me/keys']);
    assert.equal(box.opened.filter((q) => q.mode).length, 1);
    assert.match(rotated.err, /2\/2 rotation key/);
    assert.ok(!/open with your passphrase only/.test(rotated.err));
    const files = Object.values(box.githubRepos['me/keys'].files);
    assert.ok(files.every((t) => t.includes(`cred=${CRED}`)));
    box.opened.length = 0;
    const passphraseOnly = await box.ok([...a.r, 'owner', 'rotate', '--keys', 'github:me/keys'], { vars: { OPENSHEAF_UNLOCK: 'passphrase' } });
    assert.equal(box.opened.length, 0);
    assert.match(passphraseOnly.err, /open with your passphrase only: run osheaf key enroll/);
    const current = /Current keys  (did:key:\S+)/.exec((await box.ok([...a.r, 'owner', 'show', '--offline'])).out)[1];
    for (const answer of ['forged', 'tampered', 'error']) {
      box.browser = fakeBrowser(box.opened, { answer });
      const r = await box.run([...a.r, 'key', 'unlock']);
      assert.equal(r.status, 1, answer);
      assert.match(r.err, answer === 'forged' ? /opens no key/ : /did not unlock the keys/);
      await box.ok([...a.r, 'key', 'forget', current, '--yes']);
      const fallback = await box.ok([...a.r, 'key', 'pull']);
      assert.match(fallback.err, /osheaf asks for the passphrase instead/);
      assert.match(fallback.out, /Pulled 1 current key/);
    }
    assert.deepEqual(await errorsOf(box, a), []);
  } finally {
    await box.done();
  }
});

test('passkeys of the old relying party are reported, and moved', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--keys', 'github:me/keys']);
    box.browser = fakeBrowser(box.opened);
    await box.ok([...a.r, 'key', 'enroll']);
    const files = box.githubRepos['me/keys'].files;
    for (const p of Object.keys(files)) files[p] = files[p].replace('rp=unlock.opensheaf.org', 'rp=opensheaf.org');
    assert.match((await box.ok([...a.r, 'key', 'list'])).out, /passphrase, passkey \(opensheaf\.org\)/);
    box.opened.length = 0;
    const r = await box.ok([...a.r, 'owner', 'rotate', '--keys', 'github:me/keys']);
    assert.equal(box.opened.length, 0);
    assert.equal((r.err.match(/was enrolled on opensheaf\.org, which osheaf no longer asks/g) || []).length, 1);
    box.browser = fakeBrowser(box.opened, { cred: 'c2Vjb25kLWNyZWRlbnRpYWw' });
    await box.ok([...a.r, 'key', 'enroll', '--new-passkey']);
    const gone = await box.ok([...a.r, 'key', 'forget', '--rp', 'opensheaf.org', '--yes']);
    assert.match(gone.out, /Done: the 4 keys open with your passkey \(unlock\.opensheaf\.org\) and your passphrase\./);
    assert.ok(Object.values(files).every((t) => !t.includes('rp=opensheaf.org')));
  } finally {
    await box.done();
  }
});

function fakeSecurity() {
  const items = new Map(), calls = [];
  const run = async (args, input = null) => {
    calls.push(args[0]);
    if (args[0] === '-i') {
      const m = /^add-generic-password -U -s (\S+) -a (\S+) -w (\S+)\n$/.exec(input);
      if (!m) return { status: 1, stdout: '' };
      items.set(`${m[1]} ${m[2]}`, m[3]);
      return { status: 0, stdout: '' };
    }
    const key = `${args[args.indexOf('-s') + 1]} ${args[args.indexOf('-a') + 1]}`;
    if (args[0] === 'find-generic-password') return items.has(key) ? { status: 0, stdout: items.get(key) + '\n' } : { status: 44, stdout: '' };
    if (args[0] === 'delete-generic-password') return { status: items.delete(key) ? 0 : 44, stdout: '' };
    return { status: 1, stdout: '' };
  };
  return { items, calls, run };
}

test('the keychain, through security', async () => {
  const sec = fakeSecurity();
  const box = await sandbox({ security: sec.run });
  try {
    box.vars.OPENSHEAF_KEY_STORE = 'security';
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    assert.equal(sec.items.size, 1);
    assert.ok([...sec.items.keys()][0].startsWith(`opensheaf-current-key ${a.owner}:`));
    assert.ok(!(await readdir(box.root)).includes('config'));
    sec.calls.length = 0;
    await deposit(box, a, 'one', 'one', true);
    assert.equal(sec.calls.filter((c) => c === 'find-generic-password').length, 1);
    const store = keyStore({ env: { OPENSHEAF_KEY_STORE: 'keyring' }, platform: 'darwin', security: sec.run, err: (t) => sec.calls.push(t) });
    const did = /Current keys  (did:key:\S+)/.exec((await box.ok([...a.r, 'owner', 'show', '--offline'])).out)[1];
    assert.equal((await store.current(a.owner, [did])).length, 1);
    assert.ok(sec.calls.some((c) => /keyring: opensheaf-js uses the macOS keychain/.test(c)));
    const elsewhere = keyStore({ env: { OPENSHEAF_KEY_STORE: 'keyring' }, platform: 'linux' });
    await assert.rejects(elsewhere.current(a.owner, [did]), /cannot reach the system keyring/);
    await box.ok([...a.r, 'key', 'forget', did, '--yes']);
    assert.equal(sec.items.size, 0);
  } finally {
    await box.done();
  }
});

test('dates given and shown', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    await writeFile(path.join(box.root, 'p.pdf'), '%PDF-1.4 p');
    await box.ok([...a.r, 'deposit', 'p', '--new', '--pdf', path.join(box.root, 'p.pdf'), '--no-source', 'lost',
                  '--title', 'T', '--author', 'Doe, J', '--available', '2026-06-03T10:00:00Z']);
    for (const bad of ['2026-06-03T10:00:00Z', '3 June 2026', '2026-02-30', '2026-6-3']) {
      for (const argv of [['notice', 'p', '--about', '1', '--text', 'A remark.', '--date', bad],
                          ['withdraw', 'p', '--reason', 'wrong', '--date', bad],
                          ['relicense', 'p', '--rights', 'cc0-1.0', '--method', 'by email', '--date', bad]]) {
        const r = await box.run([...a.r, ...argv]);
        assert.equal(r.status, 1, r.said);
        assert.match(r.err, /a date, YYYY-MM-DD/);
      }
    }
    const cfg = JSON.parse(await readFile(path.join(a.dir, 'opensheaf.json'), 'utf-8'));
    assert.equal(cfg.objects.find((o) => o.label === 'p').head, 'v1');
    await box.ok([...a.r, 'notice', 'p', '--about', '1', '--text', 'A remark.', '--date', '2026-06-04']);
    await box.ok([...a.r, 'collect']);
    assert.match(await readFile(path.join(a.dir, 'paper', 'p', 'index.html'), 'utf-8'), /3 June 2026/);
  } finally {
    await box.done();
  }
});

test('key new takes an owner name only', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    const store = keyStore({ env: { XDG_CONFIG_HOME: path.join(box.root, 'config'), OPENSHEAF_KEY_STORE: 'file' } });
    const key = await exampleKey('a key');
    for (const bad of ['../..', '../../escaped', 'a b', '-w', a.owner.toUpperCase()]) {
      const r = await box.run([...a.r, 'key', 'new', `--owner=${bad}`]);
      assert.equal(r.status, 1, r.said);
      assert.match(r.err, /an owner name/);
      await assert.rejects(store.keep(bad, key), /not an owner name/);
      await assert.rejects(store.current(bad, [key.did]), /not an owner name/);
    }
    assert.ok(!(await readdir(box.root)).includes('escaped'));
    assert.deepEqual(await readdir(path.join(box.root, 'config', 'opensheaf', 'keys')), [a.owner]);
  } finally {
    await box.done();
  }
});

test('links are not followed: writing through them is refused, and an export folder linked into an archive is inside it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'osheaf-links-'));
  try {
    await mkdir(path.join(root, 'arch', 'sub'), { recursive: true });
    await mkdir(path.join(root, 'out'));
    await writeFile(path.join(root, 'out', 'target'), 'secret\n');
    await symlink(path.join(root, 'out', 'target'), path.join(root, 'arch', 'opensheaf.json'));
    await symlink(path.join(root, 'out'), path.join(root, 'arch', 'site'));
    const disk = new DiskStorage(path.join(root, 'arch'));
    assert.equal(await disk.read('opensheaf.json'), null);
    assert.equal(await disk.read('site/target'), null);
    await assert.rejects(disk.write('opensheaf.json', utf8('x')), /symbolic link/);
    await assert.rejects(disk.write('site/new.html', utf8('x')), /symbolic link/);
    await disk.write('sub/a', utf8('a'));
    await assert.rejects(disk.rename('sub/a', 'site/a'), /symbolic link/);
    assert.equal(await readFile(path.join(root, 'out', 'target'), 'utf-8'), 'secret\n');
    assert.deepEqual(await readdir(path.join(root, 'out')), ['target']);
    await disk.remove('site');
    assert.deepEqual(await readdir(path.join(root, 'out')), ['target']);
    await writeFile(path.join(root, 'arch', 'osheaf.json'), '{}');
    await symlink(path.join(root, 'arch', 'sub'), path.join(root, 'keys'));
    const arch = await realpath(path.join(root, 'arch'));
    assert.equal(await exportFolder(null).inside(path.join(root, 'keys')), arch);
    assert.equal(await exportFolder(path.join(root, 'arch')).inside(path.join(root, 'keys', 'new')), arch);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('no version through a linked object; files written whole, with the usual permissions', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    await deposit(box, a, 'paper', 'one', true);
    const id = JSON.parse(await readFile(path.join(a.dir, 'opensheaf.json'), 'utf-8')).objects.find((o) => o.label === 'paper').id;
    const [, name, owner] = id.split(':');
    const d = path.join(a.dir, 'ocfl', owner, name), outside = path.join(box.root, 'outside');
    await rename(d, outside);
    await symlink(outside, d);
    await writeFile(path.join(box.root, 'paper.pdf'), '%PDF-1.4 two\n');
    const r = await box.run([...a.r, 'deposit', 'paper', '--pdf', path.join(box.root, 'paper.pdf'), '--no-source', 'x',
                             '--title', 'T', '--author', 'Doe, J']);
    assert.notEqual(r.status, 0, r.said);
    assert.match(r.said, /symbolic link/);
    assert.deepEqual((await readdir(outside)).filter((n) => /^v\d+$/.test(n)), ['v1']);
    const disk = new DiskStorage(path.join(box.root, 'w'));
    await disk.write('x/y.txt', utf8('text'));
    await disk.write('x/y.txt', utf8('text, again'));
    assert.equal(await readFile(path.join(box.root, 'w', 'x', 'y.txt'), 'utf-8'), 'text, again');
    const umask = process.umask();
    assert.equal((await stat(path.join(box.root, 'w', 'x', 'y.txt'))).mode & 0o777, 0o666 & ~umask);
    assert.deepEqual(await readdir(path.join(box.root, 'w', 'x')), ['y.txt']);
  } finally {
    await box.done();
  }
});

test('options that would do nothing are refused', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    const p = await box.run([...a.r, 'owner', 'rotate', '--print', '--keys', 'command']);
    assert.notEqual(p.status, 0);
    assert.match(p.err, /--print/);
    await writeFile(path.join(box.root, 'two.yaml'),
      "- {name: A, base-url: 'https://example.org/a/', curator: 'Doe, J', new-owner: true}\n" +
      "- {name: B, base-url: 'https://example.org/b/', curator: 'Doe, J', new-owner: true}\n");
    const two = await box.run(['init', path.join(box.root, 'a'), '--from', path.join(box.root, 'two.yaml')]);
    assert.notEqual(two.status, 0);
    assert.match(two.err, /one archive/);
    assert.ok(!existsSync(path.join(box.root, 'a')));
    await writeFile(path.join(box.root, 'dep.yaml'), `root: ${box.root}\nid: x\ntitle: T\nauthor: Doe, J\n`);
    const root = await box.run([...a.r, 'deposit', '--from', path.join(box.root, 'dep.yaml')]);
    assert.notEqual(root.status, 0);
    assert.match(root.err, /give --root on the command line/);
  } finally {
    await box.done();
  }
});

test('a passphrase per place', async () => {
  const { passphrases } = await import('../cli/keystore.js');
  const typed = ['for the files', 'for the wallet'];
  const ask = passphrases({}, () => {}, async () => typed.shift());
  assert.equal(await ask({ confirm: false }), 'for the files');
  assert.equal(await ask({ confirm: false }), 'for the files');
  assert.ok(!ask.known('github:me/keys'));
  assert.equal(await ask({ confirm: false, where: 'github:me/keys' }), 'for the wallet');
  assert.equal(await ask({ confirm: false, where: 'github:me/keys' }), 'for the wallet');
  assert.ok(ask.known('github:me/keys'));
});

test('an explicit wallet wins', async () => {
  const { fromWallets } = await import('../core/owner.js');
  const given = { name: 'github:me/given' }, conf = { name: 'github:me/conf' };
  const held = { 'github:me/given': ['k'], 'github:me/conf': ['k'] };
  const said = [];
  const env = { err: (l) => said.push(l) };
  const prev = { number: 1, keys: { nextThreshold: 1, next: [] } };
  const read = async (e, w) => held[w.name];
  assert.equal((await fromWallets(env, [given, conf], 'o'.repeat(52), prev, read))[1], given);
  assert.equal((await fromWallets(env, [conf], 'o'.repeat(52), prev, read))[1], conf);
  held['github:me/given'] = [];
  assert.equal((await fromWallets(env, [given, conf], 'o'.repeat(52), prev, read))[1], conf);
  assert.ok(said.some((l) => l.includes('reading from github:me/conf')));
});

test('a broken discovery document, a broken configuration', async () => {
  for (const text of ['{"format": "opensheaf-archive/0.2", "objects": [', '[]', '{"objects": 5, "owners": "x", "tombstones": 3}']) {
    const box = await sandbox();
    try {
      const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
      await deposit(box, a, 'paper-a', 'one', true);
      await writeFile(path.join(a.dir, 'opensheaf.json'), text);
      const v = await box.run([...a.r, 'verify']);
      assert.equal(v.status, 1, text);
      assert.match(v.out, /opensheaf\.json/);
      if (text.startsWith('{"objects": 5')) {
        await box.ok([...a.r, 'collect']);
        continue;
      }
      const c = await box.run([...a.r, 'collect']);
      assert.equal(c.status, 1);
      assert.match(c.err, /nothing is written/);
      const i = await box.ok([...a.r, 'index']);
      assert.match(i.err, /without the labels/);
      const disc = JSON.parse(await readFile(path.join(a.dir, 'opensheaf.json'), 'utf-8'));
      assert.equal(disc.format, 'opensheaf-archive/0.2');
      assert.ok(disc.objects.length >= 2);
    } finally {
      await box.done();
    }
  }
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    await writeFile(path.join(a.dir, 'osheaf.json'), '{"owner": ');
    assert.match((await box.run([...a.r, 'verify'])).err, /osheaf\.json: cannot be read/);
    assert.match((await box.run([...a.r, 'collect'])).err, /osheaf\.json: cannot be read/);
    await writeFile(path.join(a.dir, 'osheaf.json'), '[]');
    assert.match((await box.run([...a.r, 'collect'])).err, /mapping/);
  } finally {
    await box.done();
  }
});

test('a label that is a path is left out', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    await deposit(box, a, 'paper-a', 'one', true);
    const file = path.join(a.dir, 'opensheaf.json');
    const disc = JSON.parse(await readFile(file, 'utf-8'));
    for (const o of disc.objects) if (o.label === 'paper-a') o.label = '../../escaped';
    await writeFile(file, JSON.stringify(disc));
    const r = await box.run([...a.r, 'index']);
    assert.equal(r.status, 0, r.said);
    assert.match(r.err, /^warning: opensheaf\.json: the label '\.\.\/\.\.\/escaped' of 'sheaf:[a-z2-7]+:[a-z2-7]+' is not a label of a line/m);
    assert.ok(!existsSync(path.join(box.root, 'escaped')));
    assert.ok(!JSON.parse(await readFile(file, 'utf-8')).objects.some((o) => o.label === '../../escaped'));
  } finally {
    await box.done();
  }
});

test('content paths outside the object are not read', async () => {
  const { createHash } = await import('node:crypto');
  for (const where of ['absolute', 'up', 'link']) {
    const box = await sandbox();
    try {
      const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
      await deposit(box, a, 'paper-a', 'one', true);
      const id = JSON.parse(await readFile(path.join(a.dir, 'opensheaf.json'), 'utf-8')).objects
        .find((o) => o.label === 'paper-a').id;
      const [, name, owner] = id.split(':');
      const d = path.join(a.dir, 'ocfl', owner, name);
      const inv = JSON.parse(await readFile(path.join(d, 'inventory.json'), 'utf-8'));
      const secret = path.join(box.root, 'secret.json');
      await writeFile(secret, '{"kind": "document", "x": "outside"}');
      const dig = Object.keys(inv.manifest).find((k) => inv.manifest[k][0].endsWith('object.json'));
      if (where === 'link') {
        await rm(path.join(d, inv.manifest[dig][0]));
        await symlink('/dev/zero', path.join(d, inv.manifest[dig][0]));
      } else {
        inv.manifest[dig] = [where === 'absolute' ? secret : 'v1/../../../../../secret.json'];
        const data = JSON.stringify(inv, null, 2);
        const sc = `${createHash('sha512').update(data).digest('hex')} inventory.json\n`;
        for (const folder of [d, path.join(d, inv.head)]) {
          await writeFile(path.join(folder, 'inventory.json'), data);
          await writeFile(path.join(folder, 'inventory.json.sha512'), sc);
        }
      }
      const r = await box.run([...a.r, 'describe', 'paper-a', '--title', 'T']);
      assert.equal(r.status, 1, r.said);
      assert.match(r.err, /nothing is read from it/);
      assert.ok((await errorsOf(box, a)).some((e) => /not read|symbolic link|cannot be read/.test(e)), where);
    } finally {
      await box.done();
    }
  }
});

test('an error of the storage is said, not thrown', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box, 'arch', ['--export', path.join(box.root, 'k1'), '--no-passphrase']);
    await writeFile(path.join(box.root, 'elsewhere.json'), '{}\n');
    await rm(path.join(a.dir, 'opensheaf.json'));
    await symlink(path.join(box.root, 'elsewhere.json'), path.join(a.dir, 'opensheaf.json'));
    const r = await box.run([...a.r, 'index']);
    assert.equal(r.status, 1, r.said);
    assert.match(r.err, /^opensheaf\.json passes through a symbolic link$/m);
    assert.equal(await readFile(path.join(box.root, 'elsewhere.json'), 'utf-8'), '{}\n');
  } finally {
    await box.done();
  }
});

const HAND_OFF = { sk: '3MnQ1WVJ9j-gIHW04onidnPAdXBkj8Ex38awjc_xIFU', pk: 'EDUGNAoWiXZye3oZT1uexqCDj6g-_pOiwL6N01HzQX0',
                   esk: 'XsIioGnOBETGr9GuOkvzh0s9Mnee8lz8KkfLHClLxGc', epk: 'wz_hpV5NNJh92Eqb4TE6dA7IVbA2LrWBmV8GisGgjBE',
                   state: 'Zaz8C5ywR4VKbNOX7dQHUg', mode: 'unlock',
                   owner: 'em4v3kp5btra7jlggxhvl5y6uluymzk2ezcdjg4pnptnk5tygora', cred: 'ZmFrZS1wYXNza2V5LWNyZWRlbnRpYWw',
                   secret: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
                   ct: '715olE38lfUKZdHslhzg2vWDWtGo88nSvuZNo4v-Hrc', tag: '2MlYwfCCb9AS4OVAMHXml-cxWi4HCPyd34BNYNVGeyU',
                   code: '371 704' };

test('the hand-off vector shared with opensheaf-py', async () => {
  const v = HAND_OFF, b = passkey.fromB64url;
  const sk = await passkey.keyPairOf(b(v.sk)), esk = await passkey.keyPairOf(b(v.esk));
  assert.equal(passkey.b64url(sk.publicKey), v.pk);
  assert.equal(passkey.b64url(esk.publicKey), v.epk);
  assert.deepEqual([...b(v.secret)], [...Array(32).keys()]);
  const ctx = [v.state, v.mode, v.owner, v.cred];
  const [epk, ct, tag] = await passkey.seal(b(v.secret), sk.publicKey, ...ctx, esk);
  assert.deepEqual([passkey.b64url(epk), passkey.b64url(ct), passkey.b64url(tag)], [v.epk, v.ct, v.tag]);
  assert.equal(passkey.b64url(await passkey.unseal(sk, b(v.epk), b(v.ct), b(v.tag), ...ctx)), v.secret);
  assert.equal(await passkey.confirmationCode(v.state, sk.publicKey), v.code);
  const changed = [[b(v.epk), b(v.ct), b(v.tag), 'another state', ...ctx.slice(1)],
                   [b(v.epk), b(v.ct), b(v.tag), v.state, 'enroll', ...ctx.slice(2)],
                   [b(v.epk), b(v.ct), b(v.tag), v.state, v.mode, 'a'.repeat(52), v.cred],
                   [b(v.epk), b(v.ct), b(v.tag), v.state, v.mode, v.owner, 'b3RoZXI'],
                   [b(v.epk), Uint8Array.from(b(v.ct), (x, k) => (k ? x : x ^ 1)), b(v.tag), ...ctx],
                   [b(v.epk), b(v.ct), new Uint8Array(32), ...ctx],
                   [sk.publicKey, b(v.ct), b(v.tag), ...ctx],
                   [b(v.epk), b(v.ct).slice(0, 16), b(v.tag), ...ctx]];
  for (const args of changed) await assert.rejects(passkey.unseal(sk, ...args));
});

test('the listener takes one answer, from the page it opened', async () => {
  const owner = 'em4v3kp5btra7jlggxhvl5y6uluymzk2ezcdjg4pnptnk5tygora';
  const said = [];
  const statuses = [];
  const open = async (url) => {
    url = await followStart(url);
    const q = Object.fromEntries(new URLSearchParams(url.split('#')[1]));
    const base = `http://127.0.0.1:${q.port}`;
    const get = async (p) => {
      const r = await fetch(base + p);
      statuses.push(r.status);
      return r.text();
    };
    await get('/other');
    await get('/callback?state=x');
    await get('/callback?state=' + 'W'.repeat(22) + '&error=no');
    const [epk, ct, tag] = await passkey.seal(new Uint8Array(32).fill(7), passkey.fromB64url(q.pk), q.state, q.mode, q.owner, CRED);
    const fields = { state: q.state, epk: passkey.b64url(epk), ct: passkey.b64url(ct), tag: passkey.b64url(tag), cred: CRED };
    assert.match(await get('/callback?' + new URLSearchParams(fields)), /osheaf has the key/);
    await get('/callback?' + new URLSearchParams(fields));
    return true;
  };
  const got = await ask('unlock', owner, [CRED], { open, err: (l) => said.push(l), timeout: 3000 });
  assert.deepEqual([...got.secret], Array(32).fill(7));
  assert.deepEqual(statuses, [404, 400, 403, 200, 409]);
  await assert.rejects(ask('unlock', owner, [CRED], { noBrowser: true, err: (l) => said.push(l), timeout: 200 }),
                       /no answer from the browser in time/);
  assert.ok(said.some((l) => /^Go to this address in your browser.*\n  http:\/\/127\.0\.0\.1:[0-9]+\/start$/s.test(l)));
  assert.ok(!said.some((l) => l.includes(passkey.UNLOCK_PAGE)));
  await assert.rejects(ask('unlock', 'not an owner', [], { timeout: 100 }), /not an owner name/);
});

test('the address /start is answered once, and only to the user who runs the command', async () => {
  const owner = 'em4v3kp5btra7jlggxhvl5y6uluymzk2ezcdjg4pnptnk5tygora';
  const said = [], statuses = [];
  const status = async (url) => {
    const r = await fetch(url, { redirect: 'manual' });
    await r.text();
    statuses.push(r.status);
  };
  const twice = async (url) => {
    assert.ok((await followStart(url)).startsWith(passkey.UNLOCK_PAGE + '#mode=unlock&'));
    await status(url);
    return true;
  };
  await assert.rejects(ask('unlock', owner, [CRED], { open: twice, err: (l) => said.push(l), timeout: 3000 }), /opened twice/);
  assert.deepEqual(statuses, [409]);
  assert.ok(said.includes(`Warning: ${passkey.TWICE}.`));

  const me = process.getuid?.() ?? 0, who = [me + 1];
  statuses.length = 0;
  const open = async (url) => {
    await status(url);
    who[0] = me;
    const q = Object.fromEntries(new URLSearchParams((await followStart(url)).split('#')[1]));
    const [epk, ct, tag] = await passkey.seal(new Uint8Array(32), passkey.fromB64url(q.pk), q.state, q.mode, q.owner, CRED);
    const answer = url.replace('/start', '/callback?') + new URLSearchParams(
      { state: q.state, epk: passkey.b64url(epk), ct: passkey.b64url(ct), tag: passkey.b64url(tag), cred: CRED });
    who[0] = me + 1;
    await status(answer);
    who[0] = me;
    await status(answer);
    return true;
  };
  said.length = 0;
  const got = await ask('unlock', owner, [CRED], { open, err: (l) => said.push(l), timeout: 3000, sameUserOnly: true,
                                                   uidOf: () => who[0] });
  assert.deepEqual([got.cred, [...got.secret]], [CRED, Array(32).fill(0)]);
  assert.deepEqual(statuses, [403, 403, 200]);
  assert.equal(said.filter((l) => l.startsWith('Warning: another user of this computer asked osheaf for ')).length, 2);
});

test('peerUid reads the owner of a connection in /proc/net/tcp', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'osheaf-tcp-'));
  try {
    const tcp = path.join(dir, 'tcp'), tcp6 = path.join(dir, 'tcp6');
    writeFileSync(tcp,
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' +
      '   0: 0100007F:D431 0100007F:0050 06 00000000:00000000 03:00000000 00000000     0        0 0\n' +
      '   1: 0100007F:D431 0100007F:0050 01 00000000:00000000 00:00000000 00000000  1001        0 0\n' +
      '   2: 0100007F:0050 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1002        0 0\n');
    writeFileSync(tcp6,
      '  sl  local_address                         remote_address                        st tx_queue rx_queue ' +
      'tr tm->when retrnsmt   uid  timeout inode\n' +
      '   0: 0000000000000000FFFF00000100007F:D432 0000000000000000FFFF00000100007F:0050 01 00000000:00000000 ' +
      '00:00000000 00000000  1003        0 0\n');
    const tables = [tcp, tcp6, path.join(dir, 'missing')];
    assert.equal(peerUid('127.0.0.1', 0xD431, 0x50, tables), 1001);
    assert.equal(peerUid('127.0.0.1', 0x50, 0xD431, tables), 1002);
    assert.equal(peerUid('127.0.0.1', 0xD432, 0x50, tables), 1003);
    assert.equal(peerUid('127.0.0.1', 0xD433, 0x50, tables), null);
    assert.equal(peerUid('127.0.0.2', 0xD431, 0x50, tables), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  if (process.platform === 'linux') {
    const net = await import('node:net');
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const accepted = new Promise((resolve) => server.once('connection', resolve));
    const client = net.connect(server.address().port, '127.0.0.1');
    const socket = await accepted;
    try {
      assert.equal(peerUid('127.0.0.1', socket.remotePort, server.address().port), process.getuid());
    } finally {
      client.destroy();
      socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
