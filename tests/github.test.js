// Generated from literate/76-tests-github.md by opensheaf-literate: edit the document, not this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { fakeGitHub } from './fake-github.js';
import { GitHub, GitHubStorage, CommitConflict, oneCommit, gitBlobSha } from '../core/github.js';
import { MemoryStorage, StorageError } from '../core/storage.js';
import { DiskStorage } from '../cli/disk.js';
import { environment } from '../core/folder.js';
import { init } from '../core/init.js';
import { carryOut, yamlText, readZip, NEW_PAPER, NEW_VERSION } from '../core/requests.js';
import { exampleKey } from '../core/keys.js';
import { loadSchemas } from '../core/schema.js';
import { utf8 } from '../core/crypto.js';
import { KeeperUnreachable } from '../core/keepers.js';
import { keyPairOf, seal, popupRequest, openPopupAnswer, openPopupAnswers, popupUrl, b64url, UnlockFailed } from '../core/passkey.js';
import { ArchiveFolder } from '../core/folder.js';
import { ownerInitCommand } from '../core/owner.js';
import { keyFileText, keyText, Passkey, passkeySalt, passkeyKek, readKey, passkeysOf } from '../core/keys.js';
import { GitHubWallet } from '../core/wallets.js';
import { browserEnvironment, schemasOf, directWrite, keyFromText, walletLocks, openLocks, signers,
         prefetched, checkWallet, walletEntries, passphraseConfirmed, checkPassphrase, keyToPush, pushKey,
         enrollPlan, openWithPassphrase, enrollPasskey, rotationKeysFromTexts, rotationKeysFromWallet, walletRotationKeys,
         newKeys, rotationFiles, checksConfirmed, keepRotationKeys, directRotate, ownerKeyLog, keyLogFolder, signingCopy,
         directSetup, seedLine, sealedBox, openSealedBox, storeSecret, newOwnerKeys, ownerLabelProblem, directRecordWallet,
         walletCandidates } from '../web/manager.js';
import { writeKeyLog } from '../core/write.js';
import { verifyFolder } from '../core/check.js';

const REPO = 'jane/papers';

function client(g) {
  return new GitHub({ api: g.api, fetch: g.fetch, token: g.token });
}

function repository(files = {}) {
  const g = fakeGitHub();
  g.create(REPO, { 'README.md': 'An archive.\n', 'ocfl/0=ocfl_1.1': 'ocfl_1.1\n', 'run.sh': [utf8('#!/bin/sh\n'), '100755'],
                   ...files });
  return g;
}

const text = (bytes) => new TextDecoder().decode(bytes);

test('a storage over GitHub reads the head and behaves as the storage in memory', async () => {
  const g = repository({ 'ocfl/jane/a/inventory.json': '{}\n' });
  const s = await GitHubStorage.open(REPO, client(g));
  const m = new MemoryStorage();
  for (const [p, bytes] of g.files(REPO)) await m.write(p, bytes);
  for (const st of [s, m]) {
    assert.equal(text(await st.read('README.md')), 'An archive.\n');
    assert.equal(await st.read('nothing'), null);
    assert.equal(await st.kind(''), 'dir');
    assert.equal(await st.kind('ocfl/jane'), 'dir');
    assert.equal(await st.kind('ocfl/jane/a/inventory.json'), 'file');
    assert.deepEqual(await st.list('ocfl'), [{ name: '0=ocfl_1.1', kind: 'file' }, { name: 'jane', kind: 'dir' }]);
    await st.write('stage/v1/content/a.txt', utf8('a'));
    await st.write('stage/v1/content/b.txt', utf8('b'));
    await assert.rejects(st.write('stage/v1/content/a.txt', utf8('again'), { exclusive: true }), StorageError);
    await assert.rejects(st.write('stage/v1', utf8('x')), StorageError);
    await assert.rejects(st.write('README.md/x', utf8('x')), StorageError);
    await st.rename('stage/v1', 'ocfl/jane/a/v1');
    assert.equal(await st.kind('stage'), null);
    assert.deepEqual(await st.list('ocfl/jane/a'), [{ name: 'inventory.json', kind: 'file' }, { name: 'v1', kind: 'dir' }]);
    await assert.rejects(st.rename('README.md', 'ocfl/jane'), StorageError);
    await assert.rejects(st.remove('ocfl/jane/a/v1'), StorageError);
    await st.remove('ocfl/jane/a/v1/content/b.txt');
    assert.deepEqual(await st.list('ocfl/jane/a/v1/content'), [{ name: 'a.txt', kind: 'file' }]);
    await st.rename('ocfl/jane/a/v1/content/a.txt', 'README.md');
    assert.equal(text(await st.read('README.md')), 'a');
    assert.equal(await st.kind('ocfl/jane/a/v1'), null);
  }
  assert.deepEqual(await s.list(''), await m.list(''));
});

test('the changes of a command are one commit on top of the head', async () => {
  const g = repository();
  const before = g.head(REPO);
  const s = await GitHubStorage.open(REPO, client(g));
  await s.write('README.md', utf8('An archive.\n'));
  await s.write('.staging-1/v1/content/paper.pdf', utf8('%PDF'));
  await s.rename('.staging-1/v1', 'ocfl/jane/paper/v1');
  await s.write('index.html', utf8('<p>home</p>\n'));
  await s.remove('ocfl/0=ocfl_1.1');
  const { changed, removed } = await s.changes();
  assert.deepEqual(changed.map((e) => e.path), ['index.html', 'ocfl/jane/paper/v1/content/paper.pdf']);
  assert.deepEqual(removed.map((e) => e.path), ['ocfl/0=ocfl_1.1']);
  const done = await s.commit('A deposit\n\npaper: v1\n');
  assert.equal(done.changed, 2);
  assert.equal(g.head(REPO), done.sha);
  assert.deepEqual(g.objects.get(done.sha).parents, [before]);
  assert.equal(g.objects.get(done.sha).message, 'A deposit\n\npaper: v1\n');
  const files = g.files(REPO);
  assert.deepEqual([...files.keys()].sort(), ['README.md', 'index.html', 'ocfl/jane/paper/v1/content/paper.pdf', 'run.sh']);
  assert.equal(text(files.get('ocfl/jane/paper/v1/content/paper.pdf')), '%PDF');
  assert.equal(g.modes(REPO).get('run.sh'), '100755');
  assert.equal(g.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/git/blobs')).length, 2);
  assert.equal(await s.commit('nothing'), null);
  assert.equal(await s.size('README.md'), 12);
  assert.equal(await s.size('ocfl/jane'), null);
  await s.write('run.sh', utf8('#!/bin/sh\necho\n'));
  await s.commit('Changed');
  assert.equal(g.modes(REPO).get('run.sh'), '100755');
  assert.equal(await gitBlobSha(utf8('')), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('a branch moved meanwhile: the commit is refused, and the command run again on the new head', async () => {
  const g = repository();
  const s = await GitHubStorage.open(REPO, client(g));
  await s.write('a.txt', utf8('a'));
  g.push(REPO, { 'b.txt': 'b' });
  await assert.rejects(s.commit('a'), CommitConflict);
  let runs = 0;
  g.beforeMove = () => g.push(REPO, { 'c.txt': 'c' });
  const done = await oneCommit(REPO, client(g), async (st) => {
    runs++;
    await st.write('a.txt', utf8(`a after ${(await st.list('')).length} entries`));
    return { message: 'a', seen: await st.kind('c.txt') };
  });
  assert.equal(runs, 2);
  assert.equal(done.attempts, 2);
  assert.equal(done.seen, 'file');
  assert.deepEqual([...g.files(REPO).keys()].sort(), ['README.md', 'a.txt', 'b.txt', 'c.txt', 'ocfl/0=ocfl_1.1', 'run.sh']);
  const nothing = await oneCommit(REPO, client(g), async () => ({ message: null }));
  assert.equal(nothing.commit, null);
});

test('a truncated tree, the mirror and its check, prefetching', async () => {
  const files = {};
  for (let k = 0; k < 30; k++) files[`ocfl/jane/p${k}/inventory.json`] = `{"n": ${k}}\n`;
  const g = repository(files);
  g.truncate = 10;
  const site = 'https://jane.example/papers/';
  g.sites.set(site, { repo: REPO });
  const cache = new Map();
  const s = await GitHubStorage.open(REPO, client(g), { mirror: site, cache });
  assert.equal((await s.list('ocfl/jane')).length, 30);
  assert.equal(text(await s.read('ocfl/jane/p7/inventory.json')), '{"n": 7}\n');
  assert.deepEqual(s.reads, { cache: 0, mirror: 1, api: 0 });
  const old = g.head(REPO);
  g.push(REPO, { 'ocfl/jane/p8/inventory.json': '{"n": "eight"}\n' });
  g.sites.set(site, { repo: REPO, stale: old, alter: new Set(['README.md']) });
  const t = await GitHubStorage.open(REPO, client(g), { mirror: site, cache });
  assert.equal(text(await t.read('ocfl/jane/p8/inventory.json')), '{"n": "eight"}\n');
  assert.equal(text(await t.read('README.md')), 'An archive.\n');
  assert.deepEqual(t.reads, { cache: 0, mirror: 0, api: 2 });
  assert.ok((await t.prefetch()) >= 28);
  const before = t.reads.mirror + t.reads.api;
  for (let k = 0; k < 30; k++) await t.read(`ocfl/jane/p${k}/inventory.json`);
  assert.equal(t.reads.mirror + t.reads.api, before);
  const u = await GitHubStorage.open(REPO, client(g), { cache });
  await u.read('ocfl/jane/p3/inventory.json');
  assert.deepEqual(u.reads, { cache: 1, mirror: 0, api: 0 });
  await assert.rejects(GitHubStorage.open(REPO, new GitHub({ api: g.api, fetch: g.fetch, token: 'wrong' })), /Bad credentials/);
});

const schemas = await loadSchemas(async (url) => JSON.parse(await readFile(fileURLToPath(url), 'utf-8')));

function requestEnvironment() {
  const keys = new Map(), exported = new Map();
  let n = 0;
  const env = environment({
    out: () => {},
    err: () => {},
    newKey: () => exampleKey(`github key ${n++}`),
    now: () => '2026-11-21T10:00:00Z',
    today: () => '2026-11-21',
    fetch: async (url) => { throw new TypeError(`no network in the tests: ${url}`); },
    fetchJson: async (url) => { throw new KeeperUnreachable(`${url}: no network in the tests`); },
    template: async (name) => new Uint8Array(await readFile(new URL(`../templates/${name}`, import.meta.url))),
    passphrase: async () => 'correct horse',
    input: async () => '',
    keyStore: {
      keptOnDevice: () => true,
      storeName: () => 'memory',
      current: async (owner, dids) => dids.map((d) => keys.get(`${owner} ${d}`)).filter(Boolean),
      keep: async (owner, key) => {
        keys.set(`${owner} ${key.did}`, key);
        return 'memory';
      },
    },
    exportFolder: { inside: async () => null, resolve: async (folder) => folder,
                    write: async (folder, name, t) => exported.set(`${folder}/${name}`, t) && `${folder}/${name}`,
                    read: async (p) => exported.get(p) },
  });
  env.exported = exported;
  return env;
}

async function withRandomness(seed, run) {
  let x = seed;
  const iso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => '2026-11-21T10:00:00.000Z';
  Object.defineProperty(crypto, 'getRandomValues', {
    configurable: true, writable: true,
    value: (a) => {
      for (let k = 0; k < a.length; k++) {
        x = (x * 1103515245 + 12345) >>> 0;
        a[k] = x >>> 24;
      }
      return a;
    },
  });
  try {
    return await run();
  } finally {
    delete crypto.getRandomValues;
    Date.prototype.toISOString = iso;
  }
}

async function diskFiles(root, rel = '', out = new Map()) {
  for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await diskFiles(root, p, out);
    else out.set(p, new Uint8Array(await readFile(path.join(root, p))));
  }
  return out;
}

const PDF = (n) => utf8(`%PDF-1.4 version ${n}\n`);
const TEX = utf8('\\documentclass{article}\n\\begin{document}Sheaves.\\end{document}\n');

const SOURCES_ZIP = new Uint8Array(Buffer.from(
  'UEsDBBQAAAAIAAAAIVyFO1gOOQAAAEYAAAAPAAAAcGFwZXIvcGFwZXIudGV4i0nJTy7NTc0rSc5JLC6uTiwqyUzOSa3liklKTc/Mq4bJ' +
  '1gZnpCaWpRbrKCSmJ2bm6cWk5qUgJLkAUEsDBBQAAAAIAAAAIVzbQLPDDAAAAAoAAAANAAAAcGFwZXIvTElDRU5TRXN2VnCKVDDRM+AC' +
  'AFBLAwQUAAAACAAAACFcY/UjSwsAAAAJAAAADwAAAHBhcGVyL2ZpZy9hLnR4dEtUSMtMLy1K5QIAUEsDBBQAAAAIAAAAIVw5nPsGBgAA' +
  'AAQAAAAaAAAAX19NQUNPU1gvcGFwZXIvLl9wYXBlci50ZXjLKs3LBgBQSwMEFAAAAAgAAAAhXDmc+wYGAAAABAAAAA8AAABwYXBlci8u' +
  'RFNfU3RvcmXLKs3LBgBQSwECFAMUAAAACAAAACFchTtYDjkAAABGAAAADwAAAAAAAAAAAAAAgAEAAAAAcGFwZXIvcGFwZXIudGV4UEsB' +
  'AhQDFAAAAAgAAAAhXNtAs8MMAAAACgAAAA0AAAAAAAAAAAAAAIABZgAAAHBhcGVyL0xJQ0VOU0VQSwECFAMUAAAACAAAACFcY/UjSwsA' +
  'AAAJAAAADwAAAAAAAAAAAAAAgAGdAAAAcGFwZXIvZmlnL2EudHh0UEsBAhQDFAAAAAgAAAAhXDmc+wYGAAAABAAAABoAAAAAAAAAAAAA' +
  'AIAB1QAAAF9fTUFDT1NYL3BhcGVyLy5fcGFwZXIudGV4UEsBAhQDFAAAAAgAAAAhXDmc+wYGAAAABAAAAA8AAAAAAAAAAAAAAIABEwEA' +
  'AHBhcGVyLy5EU19TdG9yZVBLBQYAAAAABQAFADoBAABGAQAAAAA=', 'base64'));

const REQUESTS = [
  ['deposit', { 'This deposit': NEW_VERSION, Label: 'first', 'What changed (for a new version)': 'Corrected.',
                'In collection': 'reading' },
   { 'PDF of this version': [{ name: 'paper v2.pdf', bytes: PDF(2) }], Sources: [{ name: 'paper.tex', bytes: TEX }] }],
  ['deposit', { 'This deposit': NEW_PAPER, Label: 'second', Title: 'A second paper', Authors: 'Doe, Jane|University\nRoe, Rich',
                Abstract: 'We study: archives.', Keywords: 'sheaves, archives', Licence: 'CC BY 4.0 (cc-by-4.0)',
                'If there are no sources, why': 'Lost.', 'Date the paper first appeared': '2025-03-01',
                'In collection': 'reading', Position: '1', 'Why (optional)': 'A test' },
   { 'PDF of this version': [{ name: 'second.pdf', bytes: PDF(1) }] }],
  ['notice', { Label: 'first', 'Document version it is about': '1', 'Text of the notice': 'A sign error in section 2.' }, {}],
  ['notice', { Label: 'first', 'Document version it is about': '1', 'Text of the notice': 'The sign error is in section 3.',
               'Notice it replaces (optional)': '1' }, {}],
  ['relicense', { Label: 'second', 'New licence': 'CC0 1.0 (cc0-1.0)', 'How the authors agreed': 'by e-mail' }, {}],
  ['new_collection', { 'Label of the new collection': 'issue-1', 'Title of the collection': 'Issue 1: sheaves',
                       Kind: 'Selection', Description: 'The first issue.\n\nTwo papers.', 'In collection': 'reading',
                       'Feature it on the home page': 'Yes' }, {}],
  ['add', { 'In collection': 'issue-1', 'New member': 'first', 'Versions you vet (selection)': '1' }, {}],
  ['vet', { 'In collection': 'issue-1', Member: 'first', 'Versions to vet': '2' }, {}],
  ['remove', { 'In collection': 'reading', 'Member to remove': 'second' }, {}],
  ['withdraw', { Label: 'second', 'Reason for the withdrawal': 'A duplicate.' }, {}],
  ['deposit', { 'This deposit': NEW_VERSION, Label: 'first', 'Licence file': 'LICENSE', Licence: 'Keep as before' },
   { 'PDF of this version': [{ name: 'paper.pdf', bytes: PDF(3) }], Sources: [{ name: 'sources.zip', bytes: SOURCES_ZIP }] }],
];

const REFUSED = [
  ['vet', { 'In collection': 'reading', Member: 'first', 'Versions to vet': '1' }, {}],
  ['deposit', { 'This deposit': NEW_PAPER, Label: 'first', Title: 'Again', Authors: 'Doe, Jane' },
   { 'PDF of this version': [{ name: 'p.pdf', bytes: PDF(1) }] }],
  ['add', { 'In collection': 'issue-1', 'New member': 'first' }, {}],
  ['notice', { Label: 'first', 'Document version it is about': '9', 'Text of the notice': 'No such version.' }, {}],
  ['notice', { Label: 'first', 'Document version it is about': '1', 'Text of the notice': 'Again.',
               'Notice it replaces (optional)': '1' }, {}],
  ['notice', { Label: 'first', 'Document version it is about': '1', 'Text of the notice': 'x',
               'Notice it replaces (optional)': 'the first' }, {}],
];

test('the same requests carried out on a disk and on GitHub give the same files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'osheaf-github-'));
  try {
    const env = requestEnvironment();
    const start = await withRandomness(1, async () => {
      const m = new MemoryStorage();
      await init(m, env, { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                           newOwner: true, export: '/keys', yes: true, cost: { opslimit: 1, memlimit: 8192 } }, '/archive');
      const r1 = await carryOut(m, env, 'deposit', { 'This deposit': NEW_PAPER, Label: 'first', Title: 'A paper',
                                                      Authors: 'Doe, Jane', Licence: 'CC BY 4.0 (cc-by-4.0)' },
                                { 'PDF of this version': [{ name: 'paper.pdf', bytes: PDF(1) }],
                                  Sources: [{ name: 'paper.tex', bytes: TEX }] }, { schemas });
      assert.ok(r1.ok, r1.message);
      await m.write('collections/reading.yaml', utf8('title: Reading\ntype: catalogue\nmembers: []\n'));
      return m;
    });
    const disk = new DiskStorage(path.join(root, 'archive'));
    const g = fakeGitHub();
    const files = {};
    for (const [p, bytes] of start.files) {
      await disk.write(p, bytes);
      files[p] = bytes;
    }
    g.create(REPO, files);
    let seed = 10;
    for (const [operation, fields, attached] of REQUESTS) {
      seed++;
      const a = await withRandomness(seed, () => carryOut(disk, env, operation, fields, attached, { schemas }));
      const b = await withRandomness(seed, async () => {
        const s = await GitHubStorage.open(REPO, client(g));
        const r = await carryOut(s, env, operation, fields, attached, { schemas, digests: false });
        if (r.ok) await s.commit(r.commitMessage);
        return r;
      });
      assert.ok(a.ok, `${operation}: ${a.message}`);
      assert.deepEqual(b, a, operation);
      const onDisk = await diskFiles(path.join(root, 'archive'));
      const onGitHub = g.files(REPO);
      assert.deepEqual([...onGitHub.keys()].sort(), [...onDisk.keys()].sort(), operation);
      for (const [p, bytes] of onDisk) assert.deepEqual(onGitHub.get(p), bytes, `${operation}: ${p}`);
      assert.equal(g.objects.get(g.head(REPO)).message, a.commitMessage);
    }
    const yaml = text(g.files(REPO).get('collections/issue-1.yaml'));
    assert.match(yaml, /^title: 'Issue 1: sheaves'\ndescription: 'The first issue.\n\n\n  Two papers.'\ntype: selection\n/m);
    const refused = await carryOut(disk, env, 'vet', { 'In collection': 'reading', Member: 'first', 'Versions to vet': '1' }, {});
    assert.equal(refused.ok, false);
    assert.match(refused.message, /Versions are vetted only in a selection/);
    assert.equal((await carryOut(disk, env, 'arxiv', {}, {})).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a zip of sources is read as zipfile reads it', async () => {
  const zip = Buffer.from(
    'UEsDBBQAAAAAAAAAIVwAAAAAAAAAAAAAAAAEAAAAc3JjL1BLAwQUAAAACAAAACFc4oDrxBAAAAAOAAAADQAAAHNyYy9wYXBlci50ZXiL' +
    'SclPLs1NzStJzkksLgYAUEsDBBQAAAAAAAAAIVx/jaU3BQAAAAUAAAANAAAAc3JjL2ZpZy9hLnR4dGZpZ3VyUEsBAhQDFAAAAAAAAAAh' +
    'XAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAIABAAAAAHNyYy9QSwECFAMUAAAACAAAACFc4oDrxBAAAAAOAAAADQAAAAAAAAAAAAAAgAEi' +
    'AAAAc3JjL3BhcGVyLnRleFBLAQIUAxQAAAAAAAAAIVx/jaU3BQAAAAUAAAANAAAAAAAAAAAAAACAAV0AAABzcmMvZmlnL2EudHh0UEsF' +
    'BgAAAAADAAMAqAAAAI0AAAAAAA==', 'base64');
  const members = await readZip(new Uint8Array(zip));
  assert.deepEqual(members.map((m) => m.name), ['src/', 'src/paper.tex', 'src/fig/a.txt']);
  assert.equal(text(await members[1].read()), '\\documentclass');
  assert.equal(text(await members[2].read()), 'figur');
  assert.equal(await yamlText({ members: [] }), 'members: []\n');
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.OSHEAF_PY || (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, 'osheaf'))
  .find((p) => existsSync(p));
const ISSUE = process.env.OSHEAF_ISSUE ||
  [path.join(HERE, '..', '..', 'archive-template', '.github', 'scripts', 'osheaf_issue.py')].find((p) => existsSync(p));
const PYTHON = PY && existsSync(path.join(path.dirname(PY), 'python3')) ? path.join(path.dirname(PY), 'python3') : 'python3';
const noScript = !PY ? 'opensheaf-py is not installed (set OSHEAF_PY)'
  : !ISSUE ? 'the script of the archive template is not found (set OSHEAF_ISSUE)' : false;

async function scriptSandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'osheaf-requests-'));
  const env = { PATH: process.env.PATH, HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'xdg'),
                OPENSHEAF_KEY_STORE: 'file', LANG: 'C.UTF-8', OSHEAF: PY,
                GITHUB_ACTIONS: '', OPENSHEAF_SIGNING_KEY: '' };
  env.DENO_DIR = process.env.DENO_DIR || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/deno'
    : '.cache/deno');
  await mkdir(env.HOME);
  const run = (command, args, cwd = root) => {
    const r = spawnSync(command[0], [...command.slice(1), ...args], { cwd, env, encoding: 'utf-8' });
    if (r.error) throw r.error;
    return r;
  };
  const isDeno = typeof globalThis.Deno !== 'undefined';
  const node = isDeno ? [process.execPath, 'run', '-A', '--config', path.join(HERE, '..', 'deno.json')] : [process.execPath];
  return { root, run, node, done: () => rm(root, { recursive: true, force: true }) };
}

async function writeRequest(dir, operation, fields, files = {}) {
  await mkdir(dir, { recursive: true });
  const names = {};
  for (const [label, list] of Object.entries(files)) {
    names[label] = [];
    for (const { name, bytes } of list) {
      await writeFile(path.join(dir, name), bytes);
      names[label].push(name);
    }
  }
  await writeFile(path.join(dir, 'request.json'), JSON.stringify({ operation, fields, files: names }, null, 2));
  return path.join(dir, 'request.json');
}

async function treeOf(root) {
  return diskFiles(root);
}

const timeless = (bytes) => text(bytes).replace(/"created": "[^"]*"/g, '"created": "-"');

function sameFiles(a, b, newNames = []) {
  const mask = (s) => newNames.reduce((t, [x, y]) => t.split(x).join(y), s)
    .replace(/"previous": "[0-9a-f]*"/g, '"previous": "-"').replace(/"inventorySha512": "[0-9a-f]*"/g, '"inventorySha512": "-"');
  const kept = (p) => (p.startsWith('ocfl/') && (p.includes('/content/') || p.endsWith('/inventory.json')) &&
                       !p.endsWith('genesis.json')) || p.startsWith('collections/') || p === 'osheaf.json';
  const A = [...a.keys()].filter(kept).map(mask).sort(), B = [...b.keys()].filter(kept).map(mask).sort();
  assert.deepEqual(B, A);
  const byMask = new Map([...b].map(([p, v]) => [mask(p), v]));
  for (const [p, bytes] of a) {
    if (!kept(p)) continue;
    const other = byMask.get(mask(p));
    if (p.endsWith('/inventory.json') && (text(bytes).includes('"members.json"') || mask(p) !== p)) continue;
    if (/\.(json|yaml)$/.test(p) || newNames.length) assert.equal(mask(timeless(other)), mask(timeless(bytes)), p);
    else assert.deepEqual(other, bytes, p);
  }
}

test('the requests carried out by the template\'s script and by this program give the same files', { skip: noScript }, async () => {
  const s = await scriptSandbox();
  try {
    const base = path.join(s.root, 'base');
    const r0 = s.run([PY], ['init', base, '--name', 'Papers of Jane Doe', '--base-url', 'https://example.org/papers/',
                            '--curator', 'Doe, Jane', '--new-owner', '--export', path.join(s.root, 'keys'), '--yes', '--no-passphrase']);
    assert.equal(r0.status, 0, r0.stderr);
    const first = await writeRequest(path.join(s.root, 'req', 'r0'), 'deposit',
      { 'This deposit': NEW_PAPER, Label: 'first', Title: 'A paper', Authors: 'Doe, Jane', Licence: 'CC BY 4.0 (cc-by-4.0)' },
      { 'PDF of this version': [{ name: 'paper.pdf', bytes: PDF(1) }], Sources: [{ name: 'paper.tex', bytes: TEX }] });
    const r1 = s.run([PYTHON, ISSUE], ['--request', first], base);
    assert.equal(r1.status, 0, r1.stdout + r1.stderr + await readFile(path.join(base, 'result.md'), 'utf-8').catch(() => ''));
    await mkdir(path.join(base, 'collections'));
    await writeFile(path.join(base, 'collections', 'reading.yaml'), 'title: Reading\ntype: catalogue\nmembers: []\n');
    for (const name of ['result.md', 'commit.txt', 'title.txt']) await rm(path.join(base, name), { force: true });
    let k = 0;
    for (const [operation, fields, files] of [...REQUESTS, ...REFUSED]) {
      k++;
      const a = path.join(s.root, 'a'), b = path.join(s.root, 'b');
      for (const d of [a, b]) {
        await rm(d, { recursive: true, force: true });
        await cp(base, d, { recursive: true });
      }
      const request = await writeRequest(path.join(s.root, 'req', `r${k}`), operation, fields, files);
      const p = s.run([PYTHON, ISSUE], ['--request', request], a);
      const j = s.run(s.node, [path.join(HERE, 'request.js'), b, request, path.join(s.root, 'answer.json')]);
      assert.equal(j.status, 0, j.stderr);
      const answer = JSON.parse(await readFile(path.join(s.root, 'answer.json'), 'utf-8'));
      const pyResult = await readFile(path.join(a, 'result.md'), 'utf-8');
      assert.equal(answer.ok, p.status === 0, `${operation}: ${pyResult}\n${answer.message}`);
      assert.equal(answer.message.replace(/\n+Correct it.*$/s, ''), pyResult.replace(/\n+Correct it.*$/s, ''), operation);
      if (answer.ok) {
        assert.equal(answer.commitMessage.replace(/sheaf:[a-z2-7]{52}:/g, 'sheaf:NAME:'),
                     (await readFile(path.join(a, 'commit.txt'), 'utf-8')).replace(/sheaf:[a-z2-7]{52}:/g, 'sheaf:NAME:'), operation);
      }
      for (const name of ['result.md', 'commit.txt', 'title.txt']) await rm(path.join(a, name), { force: true });
      const A = await treeOf(a), B = await treeOf(b);
      const disc = async (d) => JSON.parse(await readFile(path.join(d, 'opensheaf.json'), 'utf-8')).objects;
      const newNames = [];
      for (const o of await disc(a)) {
        const other = (await disc(b)).find((x) => x.label === o.label);
        if (other && other.name !== o.name) newNames.push([o.name, `NAME-${o.label}`], [other.name, `NAME-${o.label}`]);
      }
      sameFiles(A, B, newNames);
      await rm(base, { recursive: true, force: true });
      await cp(a, base, { recursive: true });
    }
  } finally {
    await s.done();
  }
});

const TEMPLATE = ISSUE ? path.resolve(path.dirname(ISSUE), '..', '..') : null;
const noNetwork = async (url) => { throw new TypeError(`no network in the tests: ${url}`); };

async function templateFiles() {
  const all = await diskFiles(TEMPLATE);
  return new Map([...all].filter(([p]) => !p.startsWith('.git/')));
}

test('an archive set up by the Manager with an owner made in the page is the one the template\'s setup makes', { skip: noScript },
     async () => {
  const s = await scriptSandbox();
  try {
    const keys = { current: await exampleKey('setup current key'), workflows: await exampleKey('setup workflows key'),
                   rotation: await Promise.all([1, 2, 3].map((n) => exampleKey(`setup rotation key ${n}`))) };
    const log = await ownerKeyLog(keys, { keeper: 'https://example.org/', created: '2026-11-21T09:00:00Z',
                                          nonce: '00112233445566778899aabbccddeeff' });
    const owner = log.owner;
    const fields = { Name: 'A Reading List on Sheaves', Purpose: 'selection', Description: 'Papers to read first.',
                     Curator: 'Doe, Jane', Affiliation: 'Example University', Contact: 'https://example.org/~jane',
                     'Base URL': 'https://jane.github.io/reading', 'Key wallet': 'github:jane/opensheaf-keys' };
    // the template's script, with the key log as key-log/
    const a = path.join(s.root, 'a');
    const files = await templateFiles();
    for (const [p, bytes] of files) {
      await mkdir(path.dirname(path.join(a, p)), { recursive: true });
      await writeFile(path.join(a, p), bytes);
    }
    const { storage: mem } = await keyLogFolder(log);
    await writeKeyLog(new DiskStorage(a), 'key-log', log);
    const request = await writeRequest(path.join(s.root, 'req', 'setup'), 'setup', fields);
    const p = spawnSync(PYTHON, [ISSUE, '--request', request], { cwd: a, encoding: 'utf-8',
      env: { PATH: process.env.PATH, HOME: path.join(s.root, 'home'), XDG_CONFIG_HOME: path.join(s.root, 'xdg'),
             OPENSHEAF_KEY_STORE: 'file', LANG: 'C.UTF-8', OSHEAF: PY, GITHUB_ACTIONS: '',
             OPENSHEAF_SIGNING_KEY: seedLine(keys.current) } });
    const pyResult = await readFile(path.join(a, 'result.md'), 'utf-8');
    assert.equal(p.status, 0, p.stdout + p.stderr + pyResult);
    const pyCommit = await readFile(path.join(a, 'commit.txt'), 'utf-8');
    for (const name of ['result.md', 'commit.txt', 'title.txt']) await rm(path.join(a, name), { force: true });
    // the Manager, with the key log in memory, on the double
    const g = fakeGitHub();
    g.create(REPO, Object.fromEntries(files));
    const signing = new Map([[owner, [await signingCopy(keys.current)]]]);
    const answer = await directSetup({ repo: REPO, github: client(g), fields, keyLog: await keyLogFolder(log),
                                       env: browserEnvironment({ assets: { templates: {} }, keys: signing, fetch: noNetwork }),
                                       schemas, origin: 'request setup' });
    assert.equal(answer.ok, true, answer.message);
    assert.equal(answer.message, pyResult);
    const masked = (t) => t.replace(/sheaf:[a-z2-7]{52}:/g, 'sheaf:NAME:');
    assert.equal(masked(answer.commitMessage), masked(pyCommit));
    assert.match(answer.commitMessage, /^Set up the archive: A Reading List on Sheaves \(request setup\)\n/);
    const A = await treeOf(a), B = g.files(REPO);
    assert.ok(![...A.keys(), ...B.keys()].some((x) => x.startsWith('key-log/')));
    // the key log, byte for byte: the one written in memory
    const own = `ocfl/${owner}/${owner}/`;
    const logFiles = [...mem.files.keys()].map((x) => own + x).sort();
    assert.deepEqual([...B.keys()].filter((x) => x.startsWith(own)).sort(), logFiles);
    for (const x of logFiles) {
      assert.deepEqual(B.get(x), A.get(x), x);
      assert.deepEqual(B.get(x), await mem.read(x.slice(own.length)), x);
    }
    const disc = (m) => JSON.parse(text(m.get('opensheaf.json'))).objects;
    const newNames = [];
    for (const o of disc(A)) {
      const other = disc(B).find((x) => x.label === o.label);
      if (other && other.name !== o.name) newNames.push([o.name, `NAME-${o.label}`], [other.name, `NAME-${o.label}`]);
    }
    assert.deepEqual(disc(A).map((o) => o.label).filter(Boolean).sort(), ['a-reading-list-on-sheaves', 'main']);
    sameFiles(A, B, newNames);
    const outside = (m) => [...m.keys()].filter((x) => !/^(ocfl|names|sha512)\//.test(x)).sort();
    assert.deepEqual(outside(B), outside(A));
    const cfg = JSON.parse(text(B.get('osheaf.json')));
    assert.deepEqual([cfg.owner, cfg.baseUrl, cfg.index.html.featured, cfg.keys], [owner, 'https://jane.github.io/reading/',
                                                                                   'a-reading-list-on-sheaves',
                                                                                   { [owner]: { wallets: ['github:jane/opensheaf-keys'] } }]);
    // verified by both
    const c = path.join(s.root, 'c');
    for (const [x, bytes] of B) {
      await mkdir(path.dirname(path.join(c, x)), { recursive: true });
      await writeFile(path.join(c, x), bytes);
    }
    const v = s.run([PY], ['verify', '--json'], c);
    assert.equal(v.status, 0, v.stdout + v.stderr);
    assert.deepEqual(JSON.parse(v.stdout).filter((f) => f.severity !== 'result'), []);
    const report = await verifyFolder(new DiskStorage(c), { schemas });
    assert.equal(report.counts().error + report.counts().warning, 0, JSON.stringify(report.findings));
    // the base URL of the page, when the form gives none; a second setup is refused
    const g2 = fakeGitHub();
    g2.create(REPO, Object.fromEntries(files));
    const { 'Base URL': _, 'Key wallet': __, ...noBase } = fields;
    const taken = await directSetup({ repo: REPO, github: client(g2), fields: { ...noBase, Purpose: 'papers' },
                                      keyLog: await keyLogFolder(log), ownerLabel: 'main',
                                      defaultBase: async () => ({ url: 'https://example.org/reading/', rule: 'r' }),
                                      env: browserEnvironment({ assets: { templates: {} }, keys: signing, fetch: noNetwork }),
                                      schemas }).then(() => null, (e) => e);
    assert.match(String(taken), /`main` is already taken/);
    assert.equal(g2.files(REPO).has('osheaf.json'), false);
    const second = await directSetup({ repo: REPO, github: client(g2), fields: { ...noBase, Purpose: 'papers' },
                                       keyLog: await keyLogFolder(log), ownerLabel: 'jane-doe',
                                       defaultBase: async () => ({ url: 'https://example.org/reading/',
                                                                   rule: 'the domain of the owner\'s GitHub Pages' }),
                                       env: browserEnvironment({ assets: { templates: {} }, keys: signing, fetch: noNetwork }),
                                       schemas });
    assert.equal(second.ok, true, second.message);
    assert.match(second.message, /owned by `[a-z2-7]{52}`\. Its base URL is https:\/\/example\.org\/reading\/ \(the domain of the owner's GitHub Pages\)/);
    assert.equal(JSON.parse(text(g2.files(REPO).get('osheaf.json'))).index.html.featured, undefined);
    // the owner labelled in the archive: in the discovery document and the indexes, verified by both
    const labelled = JSON.parse(text(g2.files(REPO).get('opensheaf.json'))).objects.find((o) => o.id === `sheaf:${owner}:${owner}`);
    assert.equal(labelled.label, 'jane-doe');
    const d = path.join(s.root, 'd');
    for (const [x, bytes] of g2.files(REPO)) {
      await mkdir(path.dirname(path.join(d, x)), { recursive: true });
      await writeFile(path.join(d, x), bytes);
    }
    const v2 = s.run([PY], ['verify', '--json'], d);
    assert.equal(v2.status, 0, v2.stdout + v2.stderr);
    assert.deepEqual(JSON.parse(v2.stdout).filter((f) => f.severity !== 'result'), []);
    // opensheaf-py keeps the label: its index is the same once written again
    const before = await readFile(path.join(d, 'opensheaf.json'), 'utf-8');
    const ix = s.run([PY], ['index'], d);
    assert.equal(ix.status, 0, ix.stdout + ix.stderr);
    assert.equal(await readFile(path.join(d, 'opensheaf.json'), 'utf-8'), before);
    // a wallet recorded afterwards as a hint for the owner, in one commit; once only
    const env2 = browserEnvironment({ assets: { templates: {} }, keys: signing, fetch: noNetwork });
    const hinted = await directRecordWallet({ repo: REPO, github: client(g2), env: env2, owner, wallet: 'github:jane/keys' });
    assert.equal(hinted.recorded, true);
    assert.ok(hinted.commit);
    const s2 = JSON.parse(text(g2.files(REPO).get('osheaf.json')));
    assert.deepEqual(s2.keys, { [owner]: { wallets: ['github:jane/keys'] } });
    assert.deepEqual((await directRecordWallet({ repo: REPO, github: client(g2), env: env2, owner,
                                                 wallet: 'github:jane/keys' })).recorded, false);
    assert.deepEqual(walletCandidates(s2, owner, ['github:jane/other', 'github:jane/keys', 'command']),
                     ['github:jane/keys', 'github:jane/other']);
    assert.deepEqual(walletCandidates({ keys: { wallet: 'github:old/keys' } }, owner), ['github:old/keys']);
    const again = await directSetup({ repo: REPO, github: client(g2), fields, keyLog: await keyLogFolder(log),
                                      env: browserEnvironment({ assets: { templates: {} }, keys: signing, fetch: noNetwork }),
                                      schemas });
    assert.deepEqual([again.ok, again.commit], [false, null]);
    assert.match(again.message, /The archive is already set up\./);
  } finally {
    await s.done();
  }
});

const VECTOR = { owner: 'a'.repeat(52), state: 'popup-state-of-the-tests', cred: 'Y3JlZGVudGlhbC1vZi10aGUtdGVzdHM',
                 pk: 'E75P6uryBMf9M1j8nAByGIHRdCeBKCJ-xnTzf3_pe20', epk: 'V9tLNZ8jrl4Ubk4lEgVnBHIlBjSMFQwUdT0Mkz0E1CE',
                 ct: '5G1AcynkQgGMF4zDTK5jAHzpINvJJpVIKW_a172XDTY', tag: 'x9nebDAtOsMhfeqtGvRgbjU2r828_nAI4qzFA4JSt6U',
                 code: '329 875', enrollTag: 'lTxj4rxHKf2zYq2Z6qJP-tfFeHEIEhvDgxiGvgR9zCI' };

test('the popup of the Manager: the hand-off of the page, opened with the code of the request', async () => {
  const mine = await keyPairOf(new Uint8Array(32).fill(7)), page = await keyPairOf(new Uint8Array(32).fill(9));
  const secret = new Uint8Array(32).map((_, i) => i);
  const req = await popupRequest(VECTOR.owner, [VECTOR.cred], mine, VECTOR.state);
  assert.equal(req.code, VECTOR.code);
  assert.deepEqual(req.message, { type: 'opensheaf-unlock-request', state: VECTOR.state, pk: VECTOR.pk, owner: VECTOR.owner,
                                  cred: VECTOR.cred });
  const [epk, ct, tag] = await seal(secret, mine.publicKey, VECTOR.state, 'popup', VECTOR.owner, VECTOR.cred, page);
  assert.deepEqual([b64url(epk), b64url(ct), b64url(tag)], [VECTOR.epk, VECTOR.ct, VECTOR.tag]);
  const answer = { type: 'opensheaf-unlock-answer', state: VECTOR.state, epk: VECTOR.epk, ct: VECTOR.ct, tag: VECTOR.tag,
                   cred: VECTOR.cred };
  assert.deepEqual(await openPopupAnswer(req, answer, '329875'), [VECTOR.cred, secret]);
  await assert.rejects(openPopupAnswer(req, answer, '329 876'), /the code typed is not the code/);
  await assert.rejects(openPopupAnswer(req, { ...answer, state: 'another-state-of-the-tests' }, '329875'), /not the answer/);
  await assert.rejects(openPopupAnswer(req, { type: 'opensheaf-unlock-answer', state: VECTOR.state, error: 'no' }, '329875'),
                       /the page says: no/);
  const [e2, c2, t2] = await seal(secret, mine.publicKey, VECTOR.state, 'unlock', VECTOR.owner, VECTOR.cred, page);
  await assert.rejects(openPopupAnswer(req, { ...answer, epk: b64url(e2), ct: b64url(c2), tag: b64url(t2) }, '329875'),
                       /damaged answer/);
  await assert.rejects(popupRequest(VECTOR.owner, []), UnlockFailed);
  assert.equal(popupUrl('https://manager.opensheaf.org'),
               'https://unlock.opensheaf.org/#mode=popup&origin=https%3A%2F%2Fmanager.opensheaf.org');
});

test('the popup that creates a passkey: its own mode, a new credential', async () => {
  const mine = await keyPairOf(new Uint8Array(32).fill(7)), page = await keyPairOf(new Uint8Array(32).fill(9));
  const secret = new Uint8Array(32).map((_, i) => i);
  assert.equal(popupUrl('https://manager.opensheaf.org', 'popup-enroll'),
               'https://unlock.opensheaf.org/#mode=popup-enroll&origin=https%3A%2F%2Fmanager.opensheaf.org');
  assert.throws(() => popupUrl('https://manager.opensheaf.org', 'enroll'), UnlockFailed);
  const req = await popupRequest(VECTOR.owner, [], mine, VECTOR.state, 'popup-enroll');
  assert.equal(req.message.cred, '');
  assert.equal(req.code, VECTOR.code);
  const [epk, ct, tag] = await seal(secret, mine.publicKey, VECTOR.state, 'popup-enroll', VECTOR.owner, VECTOR.cred, page);
  assert.deepEqual([b64url(epk), b64url(ct), b64url(tag)], [VECTOR.epk, VECTOR.ct, VECTOR.enrollTag]);
  const answer = { type: 'opensheaf-unlock-answer', state: VECTOR.state, epk: VECTOR.epk, ct: VECTOR.ct, tag: VECTOR.enrollTag,
                   cred: VECTOR.cred };
  assert.deepEqual(await openPopupAnswer(req, answer, '329 875'), [VECTOR.cred, secret]);
  // an answer of the popup that unlocks is not one that enrolls, nor the other way round
  await assert.rejects(openPopupAnswer(req, { ...answer, tag: VECTOR.tag }, '329875'), /damaged answer/);
  const unlocking = await popupRequest(VECTOR.owner, [VECTOR.cred], mine, VECTOR.state);
  await assert.rejects(openPopupAnswer(unlocking, answer, '329875'), /damaged answer/);
  // a credential the request excludes is not a new passkey
  const excluding = await popupRequest(VECTOR.owner, [VECTOR.cred], mine, VECTOR.state, 'popup-enroll');
  await assert.rejects(openPopupAnswer(excluding, answer, '329875'), /no new credential/);
});

const VECTOR2 = { owner: 'b'.repeat(51) + 'a', epk: 'c7LYt2qptTZgAyvI9di-46OuTjs6f9Sa3oH3NHo0qmg',
                  ct: 'ib0GOq8sfUobf__9-Vwwot4zM6T82n9r9ZVdnlGLulo', tag: '_4P3d-XwSi0QXm8oB8raCpbh75XwRwI3xmIjap7vlYI' };

test('the popup of the Manager for two owners at one touch (version 2)', async () => {
  const mine = await keyPairOf(new Uint8Array(32).fill(7));
  const pages = [await keyPairOf(new Uint8Array(32).fill(9)), await keyPairOf(new Uint8Array(32).fill(11))];
  const owners = [VECTOR.owner, VECTOR2.owner];
  const secrets = [new Uint8Array(32).map((_, i) => i), new Uint8Array(32).map((_, i) => 255 - i)];
  const req = await popupRequest(owners, [VECTOR.cred], mine, VECTOR.state);
  assert.equal(req.code, VECTOR.code);
  assert.deepEqual(req.message, { type: 'opensheaf-unlock-request', v: 2, state: VECTOR.state, pk: VECTOR.pk,
                                  owners: owners.join(','), cred: VECTOR.cred });
  const sealed = [];
  for (let k = 0; k < 2; k++) {
    const [epk, ct, tag] = await seal(secrets[k], mine.publicKey, VECTOR.state, 'popup', owners[k], VECTOR.cred, pages[k]);
    sealed.push({ owner: owners[k], epk: b64url(epk), ct: b64url(ct), tag: b64url(tag) });
  }
  assert.deepEqual(sealed, [{ owner: VECTOR.owner, epk: VECTOR.epk, ct: VECTOR.ct, tag: VECTOR.tag },
                            { owner: VECTOR2.owner, epk: VECTOR2.epk, ct: VECTOR2.ct, tag: VECTOR2.tag }]);
  const answer = { type: 'opensheaf-unlock-answer', v: 2, state: VECTOR.state, cred: VECTOR.cred, sealed };
  assert.deepEqual(await openPopupAnswers(req, answer, '329 875'),
                   { cred: VECTOR.cred, secrets: [[owners[0], secrets[0]], [owners[1], secrets[1]]] });
  await assert.rejects(openPopupAnswers(req, answer, '329 876'), /the code typed is not the code/);
  await assert.rejects(openPopupAnswers(req, { ...answer, sealed: [sealed[1], sealed[0]] }, '329875'), /damaged answer/);
  const swapped = [{ ...sealed[0], owner: owners[1] }, { ...sealed[1], owner: owners[0] }];
  await assert.rejects(openPopupAnswers({ ...req, owners: [owners[1], owners[0]] }, { ...answer, sealed: swapped }, '329875'),
                       /damaged answer/);
  const { v, ...first } = answer;
  await assert.rejects(openPopupAnswers(req, first, '329875'), /did not answer for every owner/);
  await assert.rejects(openPopupAnswers(req, { type: 'opensheaf-unlock-answer', state: VECTOR.state, error: 'no' }, '329875'),
                       /the page says: no/);
  await assert.rejects(popupRequest([...owners, 'c'.repeat(51) + 'a'], [VECTOR.cred]), /one owner, or two at once/);
  await assert.rejects(popupRequest([owners[0], owners[0]], [VECTOR.cred]), /one owner, or two at once/);
  await assert.rejects(popupRequest(owners, [VECTOR.cred], null, null, 'popup-enroll'), /one owner at a time/);
  const one = await popupRequest([VECTOR.owner], [VECTOR.cred], mine, VECTOR.state);
  assert.equal(one.message.v, undefined);
  const single = { type: 'opensheaf-unlock-answer', state: VECTOR.state, epk: VECTOR.epk, ct: VECTOR.ct, tag: VECTOR.tag,
                   cred: VECTOR.cred };
  assert.deepEqual(await openPopupAnswers(one, single, '329875'), { cred: VECTOR.cred, secrets: [[VECTOR.owner, secrets[0]]] });
});

test('keys of a wallet opened by the secret of a passkey, kept unexportable', async () => {
  const env = requestEnvironment();
  const m = new MemoryStorage();
  await init(m, env, { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                       newOwner: true, export: '/keys', yes: true, cost: { opslimit: 1, memlimit: 8192 } }, '/archive');
  const { owner, dids, threshold } = await signers(m, browserEnvironment({ assets: { templates: {} } }));
  assert.equal(threshold, 1);
  const [key] = await env.keyStore.current(owner, dids);
  const prf = new Uint8Array(32).fill(5), cred = 'Y3JlZGVudGlhbC1vZi10aGUtdGVzdHM';
  const passkey = new Passkey(cred, await passkeySalt(owner), { kek: await passkeyKek(prf) });
  const text = await keyFileText(key, owner, 'current', null, 'correct horse', { passkeys: [passkey], cost: { opslimit: 1, memlimit: 8192 } });
  const wallet = { entries: async () => [[owner, key.id], [owner, 'aaaaaaaaaaaaaaaa']],
                   read: async (o, kid) => (kid === key.id ? text : null) };
  const locks = await walletLocks(wallet, owner, dids);
  assert.deepEqual(locks.map((l) => [l.did, l.creds]), [[key.did, [cred]]]);
  const [opened] = await openLocks(locks, owner, cred, prf);
  assert.equal(opened.did, key.did);
  assert.equal(opened.seed, null);
  assert.equal(opened.signing.extractable, false);
  assert.deepEqual(await opened.sign(utf8('a message')), await key.sign(utf8('a message')));
  await assert.rejects(openLocks(locks, owner, cred, new Uint8Array(32).fill(6)));
});

test('a key wallet set up from the page: checked, the current key pushed, a passkey enrolled', async () => {
  const env = requestEnvironment();
  const m = new MemoryStorage();
  const cost = { opslimit: 1, memlimit: 8192 };
  await init(m, env, { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                       newOwner: true, export: '/keys', yes: true, cost }, '/archive');
  const { owner, dids, versions } = await signers(m, browserEnvironment({ assets: { templates: {} } }));
  assert.deepEqual(Object.values(versions), [1]);
  const [key] = await env.keyStore.current(owner, dids);
  const g = fakeGitHub();
  g.create('jane/opensheaf-keys', {}, { visibility: 'private' });
  g.create('jane/open-keys', {}, { visibility: 'public' });
  g.create('jane/read-only', {}, { visibility: 'private', push: false });
  g.create(REPO, {}, { visibility: 'private' });
  const gh = { api: g.api, fetch: g.fetch, token: async () => g.token };
  const wallet = (repo) => new GitHubWallet(repo, gh, [REPO]);
  await assert.rejects(checkWallet(wallet('jane/open-keys')), /not a private repository/);
  await assert.rejects(checkWallet(wallet('jane/read-only')), /cannot write/);
  await assert.rejects(checkWallet(wallet(REPO)), /repository of the archive/);
  await assert.rejects(checkWallet(wallet('jane/nothing')), /install the OpenSheaf app/);
  const w = wallet('jane/opensheaf-keys');
  await checkWallet(w);
  let entries = await walletEntries(w, owner);
  assert.deepEqual(entries, []);
  assert.equal(passphraseConfirmed(entries), true);
  const line = btoa(String.fromCharCode(...key.seed)) + '\n';
  const other = await exampleKey('another key');
  await assert.rejects(keyToPush(btoa(String.fromCharCode(...other.seed)), { owner, dids }), /not a current key/);
  await assert.rejects(keyToPush(await keyText(key, 'b'.repeat(52), 'current'), { owner, dids }), /of the owner b{52}/);
  await assert.rejects(keyToPush(await keyText(key, owner, 'current', 'a passphrase', cost), { owner, dids }), /locked/);
  await assert.rejects(keyToPush('not a key', { owner, dids }), /not a key file/);
  const given = await keyToPush(line, { owner, dids });
  assert.equal(given.did, key.did);
  const head = g.head('jane/opensheaf-keys');
  assert.equal(await pushKey(w, owner, given, versions[given.did], 'correct horse', { cost }), true);
  given.seed.fill(0);
  const path = `${owner}/${key.id}.key.enc`;
  const pushed = text(g.files('jane/opensheaf-keys').get(path));
  assert.match(pushed, new RegExp(`^opensheaf-key/0\\.2\nkind current\nowner ${owner}\nversion v1\nkey ${key.did}\n`));
  assert.match(g.objects.get(g.head('jane/opensheaf-keys')).message, new RegExp(`^opensheaf: current key ${key.id} of ${owner}$`));
  assert.notEqual(g.head('jane/opensheaf-keys'), head);
  assert.equal((await readKey(pushed, 'correct horse')).key.did, key.did);
  assert.equal(await pushKey(w, owner, await keyToPush(line, { owner, dids }), 1, 'another', { cost }), false);
  assert.equal(text(g.files('jane/opensheaf-keys').get(path)), pushed);
  entries = await walletEntries(w, owner);
  assert.equal(passphraseConfirmed(entries), false);
  await assert.rejects(checkPassphrase(entries, 'wrong horse', owner, w.name), /not the passphrase of the keys/);
  await checkPassphrase(entries, 'correct horse', owner, w.name);
  // the passkey: none yet, so a new one, excluding none
  const plan = await enrollPlan(w, owner);
  assert.deepEqual([plan.fresh, plan.known, plan.todo.map((e) => e.kid)], [true, [], [key.id]]);
  await assert.rejects(openWithPassphrase(plan, 'wrong horse', w.name), /nothing was changed/);
  await openWithPassphrase(plan, 'correct horse', w.name);
  const cred = 'Y3JlZGVudGlhbC1vZi10aGUtdGVzdHM', prf = new Uint8Array(32).fill(5);
  const done = await enrollPasskey(w, plan, 'correct horse', cred, Uint8Array.from(prf), { cost });
  assert.deepEqual(done, [['current', key.did]]);
  const enrolled = text(g.files('jane/opensheaf-keys').get(path));
  assert.equal(enrolled.split('\n').filter((l) => l.startsWith('wrap passkey prf rp=unlock.opensheaf.org cred=' + cred)).length, 1);
  assert.equal(passkeysOf(enrolled).length, 1);
  assert.equal((await readKey(enrolled, 'correct horse')).key.did, key.did);
  // unlocked as the Manager unlocks: the locks of the wallet, the passkey's secret
  const locks = await walletLocks(w, owner, dids);
  assert.deepEqual(locks.map((l) => [l.did, l.creds]), [[key.did, [cred]]]);
  const [opened] = await openLocks(locks, owner, cred, Uint8Array.from(prf));
  assert.deepEqual(await opened.sign(utf8('a message')), await key.sign(utf8('a message')));
  // enrolled already: nothing to do; a new passkey only if asked for
  const again = await enrollPlan(w, owner);
  assert.deepEqual([again.fresh, again.known, again.todo], [false, [cred], []]);
  const fresh = await enrollPlan(w, owner, { newPasskey: true });
  assert.equal(fresh.fresh, true);
  await assert.rejects(enrollPasskey(w, fresh, 'correct horse', cred, prf, { cost }), /no new passkey/);
  // a key put later, without the passkey: the passkey enrolled is used for it, and must open what it is enrolled for
  const later = await exampleKey('a later key');
  await w.write(owner, later.id, 'current', await keyFileText(later, owner, 'current', 2, 'correct horse', { cost }));
  const plan2 = await enrollPlan(w, owner);
  assert.deepEqual([plan2.fresh, plan2.todo.map((e) => e.kid)], [false, [later.id]]);
  await assert.rejects(enrollPasskey(w, plan2, 'correct horse', cred, new Uint8Array(32).fill(6), { cost }),
                       /does not open the keys it is enrolled for/);
  await enrollPasskey(w, plan2, 'correct horse', cred, Uint8Array.from(prf), { cost });
  const laterText = text(g.files('jane/opensheaf-keys').get(`${owner}/${later.id}.key.enc`));
  assert.equal((await readKey(laterText, null, { [cred]: await passkeyKek(prf) })).key.did, later.did);
});

test('a new current key made in the page: the key log rotated with rotation keys from files, then from the wallet', async () => {
  const env = requestEnvironment();
  const m = new MemoryStorage();
  const cost = { opslimit: 1, memlimit: 8192 };
  await init(m, env, { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                       newOwner: true, export: '/keys', yes: true, cost }, '/archive');
  const g = fakeGitHub();
  g.create(REPO, Object.fromEntries(m.files));
  g.create('jane/opensheaf-keys', {}, { visibility: 'private' });
  const w = new GitHubWallet('jane/opensheaf-keys', { api: g.api, fetch: g.fetch, token: async () => g.token }, [REPO]);
  const benv = browserEnvironment({ assets: { templates: {} },
                                    fetch: async (url) => { throw new TypeError(`no network in the tests: ${url}`); } });
  const head = async () => signers(await GitHubStorage.open(REPO, client(g)), benv);
  const plan = await head();
  const owner = plan.owner;
  assert.deepEqual([plan.number, plan.next.length, plan.nextThreshold, plan.threshold], [1, 3, 2, 1]);
  const files = [...env.exported].map(([p, t]) => ({ name: p.split('/').pop(), text: t }));
  assert.equal(files.length, 3);
  await assert.rejects(rotationKeysFromTexts(files.slice(0, 1), plan, 'correct horse'),
                       /given: 1 rotation key of v1 of the key log, and 2 sign the next version/);
  await assert.rejects(rotationKeysFromTexts([files[0], files[0]], plan, 'correct horse'), /given: 1 rotation key/);
  await assert.rejects(rotationKeysFromTexts(files, plan, 'wrong horse'), /^Error: rotation-.*\.txt: wrong passphrase/);
  await assert.rejects(rotationKeysFromTexts(files, plan), /locked with a passphrase: give the passphrase/);
  const sealed = await rotationKeysFromTexts([files[0], files[2]], plan, 'correct horse');
  assert.deepEqual(sealed.map((k) => [k.seed, k.signing.extractable]), [[null, false], [null, false]]);
  // the new keys: the rotation keys given as files, their seeds wiped
  const made = await newKeys(plan);
  assert.equal(made.rotation.length, 3);
  const exported = await rotationFiles(made.rotation, owner, 2, 'correct horse', { cost });
  assert.ok(made.rotation.every((k) => k.seed.every((b) => b === 0)));
  for (const f of exported) {
    assert.match(f.name, new RegExp(`^rotation-${owner.slice(0, 16)}-[a-z2-7]{16}\\.txt$`));
    assert.match(f.text, new RegExp(`^opensheaf-rotation-key/0\\.2\nowner ${owner}\nversion v2\nkey ${f.did}\n`));
    assert.match(f.sheet, /^OpenSheaf rotation key \(opensheaf-rotation-key\/0\.2\)\n/);
    assert.match(f.check, /^[A-Z2-7]{4}$/);
  }
  assert.equal(checksConfirmed(exported, exported.map((f) => ` ${f.check.toLowerCase()} `)), true);
  assert.equal(checksConfirmed(exported, exported.map((f) => f.check).slice(0, 2)), false);
  const phases = [];
  const done = await directRotate({ repo: REPO, github: client(g), env: benv, schemas, plan, signers: sealed,
                                    add: made.current.did, next: exported.map((f) => f.digest), progress: (p) => phases.push(p) });
  assert.deepEqual(phases, ['reading', 'carrying out', 'committing']);
  assert.deepEqual([done.number, done.dids, done.threshold], [2, [...plan.dids, made.current.did], 1]);
  assert.equal(g.head(REPO), done.commit.sha);
  assert.match(g.objects.get(done.commit.sha).message,
               /^Keys changed: v2 of the key log of \S+, a new current key \S+ \(the OpenSheaf manager\)\n\ncurrent key did:key:/);
  const plan2 = await head();
  assert.deepEqual([plan2.number, plan2.dids, plan2.next], [2, done.dids, exported.map((f) => f.digest)]);
  assert.deepEqual(plan2.versions[made.current.did], 2);
  const before = g.head(REPO);
  await assert.rejects(directRotate({ repo: REPO, github: client(g), env: benv, schemas, plan, signers: sealed,
                                      add: made.current.did, next: exported.map((f) => f.digest) }), /changed meanwhile/);
  assert.equal(g.head(REPO), before);
  await assert.rejects(rotationKeysFromTexts(files, plan2, 'correct horse'), /not a rotation key that v2 of the key log commits/);
  // the current key put in the wallet, as osheaf key push
  assert.equal(await pushKey(w, owner, made.current, done.number, 'correct horse', { cost }), true);
  made.current.seed.fill(0);
  // the files given back sign the next version, whose rotation keys go to the wallet
  const sealed2 = await rotationKeysFromTexts(exported, plan2, 'correct horse');
  const made2 = await newKeys(plan2);
  await keepRotationKeys(w, owner, made2.rotation, 3, 'correct horse', { cost });
  assert.ok(made2.rotation.every((k) => k.seed.every((b) => b === 0)));
  const done2 = await directRotate({ repo: REPO, github: client(g), env: benv, schemas, plan: plan2, signers: sealed2,
                                     add: made2.current.did, next: made2.rotation.map((k) => k.digest) });
  assert.equal(done2.number, 3);
  // and those sign a third, read from the wallet
  const plan3 = await head();
  const entries = await walletEntries(w, owner);
  assert.deepEqual(walletRotationKeys(entries, plan3.next).sort(), [...plan3.next].sort());
  assert.deepEqual(walletRotationKeys(entries, plan2.next), []);
  await assert.rejects(rotationKeysFromWallet(w, plan3, 'wrong horse'), /wrong passphrase/);
  const sealed3 = await rotationKeysFromWallet(w, plan3, 'correct horse');
  assert.equal(sealed3.length, 2);
  await assert.rejects(rotationKeysFromWallet(w, plan2, 'correct horse'), /the wallet github:jane\/opensheaf-keys holds 0 rotation keys/);
  const made3 = await newKeys(plan3);
  await keepRotationKeys(w, owner, made3.rotation, 4, 'correct horse', { cost });
  const done3 = await directRotate({ repo: REPO, github: client(g), env: benv, schemas, plan: plan3, signers: sealed3,
                                     add: made3.current.did, next: made3.rotation.map((k) => k.digest) });
  assert.deepEqual([done3.number, done3.dids.length], [4, 4]);
});

test('the passkey of another owner of the wallet enrolled for an owner', async () => {
  const env = requestEnvironment();
  const m = new MemoryStorage();
  const cost = { opslimit: 1, memlimit: 8192 };
  await init(m, env, { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                       newOwner: true, export: '/keys', yes: true, cost }, '/archive');
  const { owner, dids } = await signers(m, browserEnvironment({ assets: { templates: {} } }));
  const [key] = await env.keyStore.current(owner, dids);
  const g = fakeGitHub();
  g.create('jane/opensheaf-keys', {}, { visibility: 'private' });
  const w = new GitHubWallet('jane/opensheaf-keys', { api: g.api, fetch: g.fetch, token: async () => g.token }, [REPO]);
  await pushKey(w, owner, key, 1, 'correct horse', { cost });
  const cred = 'Y3JlZGVudGlhbC1vZi10aGUtdGVzdHM', prf = new Uint8Array(32).fill(3);
  assert.deepEqual([(await enrollPlan(w, owner)).fresh, (await enrollPlan(w, owner)).borrowed], [true, false]);
  const fresh = await enrollPlan(w, owner, { borrowed: [cred], newPasskey: true });
  assert.deepEqual([fresh.fresh, fresh.borrowed], [true, false]);
  const plan = await enrollPlan(w, owner, { borrowed: [cred] });
  assert.deepEqual([plan.fresh, plan.borrowed, plan.known, plan.todo.length], [false, true, [cred], 1]);
  await openWithPassphrase(plan, 'correct horse', w.name);
  assert.equal((await enrollPasskey(w, plan, 'correct horse', cred, prf, { cost })).length, 1);
  const locks = await walletLocks(w, owner, dids);
  assert.deepEqual(locks.map((l) => l.creds), [[cred]]);
  assert.equal((await openLocks(locks, owner, cred, prf))[0].did, key.did);
  const after = await enrollPlan(w, owner, { borrowed: ['b3RoZXItY3JlZGVudGlhbC1vZi10ZXN0cw'] });
  assert.deepEqual([after.borrowed, after.known, after.todo.length], [false, [cred], 0]);
});

test('acting for another owner: a new version of its line goes into a branch', async () => {
  const env = requestEnvironment();
  const m = new MemoryStorage();
  const cost = { opslimit: 1, memlimit: 8192 };
  await init(m, env, { name: 'Papers of a group', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                       newOwner: true, export: '/keys', yes: true, cost }, '/archive');
  const files = (n) => ({ 'PDF of this version': [{ name: 'paper.pdf', bytes: PDF(n) }], Sources: [{ name: 'paper.tex', bytes: TEX }] });
  const paper = { 'This deposit': NEW_PAPER, Label: 'first', Title: 'A paper', Authors: 'Doe, Jane',
                  Licence: 'CC BY 4.0 (cc-by-4.0)' };
  const again = { 'This deposit': NEW_VERSION, Label: 'first', 'What changed (for a new version)': 'Corrections.' };
  const objects = async () => JSON.parse(text(await m.read('opensheaf.json'))).objects;
  const line = async (label) => (await objects()).find((o) => o.label === label);
  assert.ok((await carryOut(m, env, 'deposit', paper, files(1), { schemas })).ok);
  assert.ok((await carryOut(m, env, 'new_collection', { 'Label of the new collection': 'reading',
                                                        'Title of the collection': 'Reading', Kind: 'Catalogue' }, {},
                            { schemas })).ok);
  await ownerInitCommand(await ArchiveFolder.open(m, env), { export: '/keys-b', yes: true, cost });
  const cfg = JSON.parse(text(await m.read('osheaf.json')));
  const [a, b] = [cfg.owner, cfg.owners[0]];
  const label = `first-${b.slice(0, 8)}`;
  const catalogue = async (o) => {
    const disc = JSON.parse(text(await m.read('opensheaf.json')));
    const id = disc.owners.find((e) => e.owner === o).catalogue;
    return disc.objects.find((x) => x.id === id);
  };
  const before = await catalogue(a);
  assert.equal((await catalogue(b)).head, 'v1');

  const r1 = await carryOut(m, env, 'deposit', again, files(2), { schemas, owner: b });
  assert.ok(r1.ok, r1.message);
  assert.deepEqual(await catalogue(a), before);
  assert.equal((await catalogue(b)).head, 'v2');
  assert.ok(r1.done.includes(`in the new branch \`${label}\``), r1.done);
  assert.deepEqual([(await line(label)).owner, (await line(label)).head], [b, 'v2']);
  assert.deepEqual([(await line('first')).owner, (await line('first')).head], [a, 'v1']);
  const r2 = await carryOut(m, env, 'deposit', again, files(3), { schemas, owner: b });
  assert.ok(r2.ok, r2.message);
  assert.ok(r2.done.includes(`in the line \`${label}\``), r2.done);
  assert.equal((await line(label)).head, 'v3');

  const notice = (l) => ({ Label: l, 'Document version it is about': '1', 'Text of the notice': 'A typo.' });
  const n1 = await carryOut(m, env, 'notice', notice('first'), {}, { schemas, owner: b });
  assert.equal(n1.ok, false);
  assert.match(n1.message, /given only by the owner of the line/);
  assert.ok((await carryOut(m, env, 'notice', notice(label), {}, { schemas, owner: b })).ok);
  const w = await carryOut(m, env, 'withdraw', { Label: 'first', 'Reason for the withdrawal': 'x' }, {}, { owner: b });
  assert.match(w.message, /given only by the owner of the line/);

  const r3 = await carryOut(m, env, 'deposit', { ...again, Label: label }, files(4), { schemas, owner: a });
  assert.ok(r3.ok, r3.message);
  assert.ok(r3.done.includes('in the line `first`'), r3.done);
  assert.equal((await line('first')).head, 'v2');

  const add = await carryOut(m, env, 'add', { 'In collection': 'reading', 'New member': label }, {}, { owner: b });
  assert.match(add.message, /only its owner changes its members/);
  const mine = await carryOut(m, env, 'new_collection', { 'Label of the new collection': 'mine',
                                                          'Title of the collection': 'Mine', Kind: 'Selection' }, {},
                              { schemas, owner: b });
  assert.ok(mine.ok, mine.message);
  assert.equal((await line('mine')).owner, b);
  assert.match(text(await m.read('collections/mine.yaml')), new RegExp(`\nowner: ${b}\n`));
  const fresh = await carryOut(m, env, 'deposit', { ...paper, Label: 'second' }, files(5), { schemas, owner: b });
  assert.ok(fresh.ok, fresh.message);
  assert.equal((await line('second')).owner, b);

  await ownerInitCommand(await ArchiveFolder.open(m, env), { export: '/keys-c', yes: true, cost });
  const c = JSON.parse(text(await m.read('osheaf.json'))).owners[1];
  const taken = await carryOut(m, env, 'deposit', again, files(6), { schemas, owner: c, branchLabel: 'second' });
  assert.match(taken.message, /already a label of this archive/);
  const r4 = await carryOut(m, env, 'deposit', again, files(6), { schemas, owner: c, branchFrom: 1, branchLabel: 'first-kept' });
  assert.ok(r4.ok, r4.message);
  const kept = await line('first-kept');
  assert.deepEqual([kept.owner, kept.head], [c, 'v2']);
  const f = await ArchiveFolder.open(m, env);
  const dir = await f.dirOf(kept.id);
  const v1 = await f.readObjectJson(dir, await f.inventory(dir), 'object.json', 'v1');
  assert.deepEqual([v1.parent.owner, v1.parent.documentVersion], [a, 1]);
  const stranger = await carryOut(m, env, 'deposit', again, files(7), { owner: 'c'.repeat(51) + 'a' });
  assert.match(stranger.message, /not an owner this archive hosts/);
  assert.deepEqual((await verifyFolder(m, { schemas })).findings.filter((x) => x.level === 'error'), []);
});

test('a request written directly: one commit, signed in the page', async () => {
  const env = requestEnvironment();
  const m = new MemoryStorage();
  await init(m, env, { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                       newOwner: true, export: '/keys', yes: true, cost: { opslimit: 1, memlimit: 8192 } }, '/archive');
  const r1 = await carryOut(m, env, 'deposit', { 'This deposit': NEW_PAPER, Label: 'first', Title: 'A paper',
                                                  Authors: 'Doe, Jane', Licence: 'CC BY 4.0 (cc-by-4.0)' },
                            { 'PDF of this version': [{ name: 'paper.pdf', bytes: PDF(1) }], Sources: [{ name: 'paper.tex', bytes: TEX }] },
                            { schemas });
  assert.ok(r1.ok, r1.message);
  const g = fakeGitHub();
  g.create(REPO, Object.fromEntries(m.files));
  const owner = JSON.parse(text(await m.read('osheaf.json'))).owner;
  const [key] = [...env.keyStore ? await env.keyStore.current(owner, (await signers(m, env)).dids) : []];
  const given = await keyFromText(await keyText(key, owner, 'current'));
  assert.equal(given.owner, owner);
  const seed = btoa(String.fromCharCode(...key.seed));
  assert.equal((await keyFromText(seed + '\n', { owner })).key.did, key.did);
  await assert.rejects(keyFromText(seed), /give the owner/);
  const assets = { schemas: Object.fromEntries(await Promise.all((await readdir(new URL('../schemas/', import.meta.url)))
    .map(async (n) => [n, JSON.parse(await readFile(new URL(`../schemas/${n}`, import.meta.url), 'utf-8'))]))),
                   templates: {} };
  const benv = browserEnvironment({ assets, keys: new Map([[owner, [given.key]]]),
                                    fetch: async (url) => { throw new TypeError(`no network in the tests: ${url}`); } });
  const phases = [];
  const done = await directWrite({ repo: REPO, github: client(g), operation: 'notice', env: benv, schemas: await schemasOf(assets),
                                   fields: { Label: 'first', 'Document version it is about': '1', 'Text of the notice': 'A typo.' },
                                   progress: (p) => phases.push(p) });
  assert.ok(done.ok, done.message);
  assert.deepEqual(phases, ['reading', 'carrying out', 'committing']);
  assert.equal(g.head(REPO), done.commit.sha);
  assert.match(g.objects.get(done.commit.sha).message, /^Notice about first, version 1 \(the OpenSheaf manager\)\n\nfirst: v2 /);
  const files = [...g.files(REPO).keys()];
  assert.ok(done.reads.api <= files.length && done.reads.cache > done.reads.api, JSON.stringify(done.reads));
  assert.ok(prefetched('ocfl/x/y/v1/content/object.json') && !prefetched('ocfl/x/y/v1/content/paper.pdf'));
  const head = g.head(REPO);
  const refused = await directWrite({ repo: REPO, github: client(g), operation: 'withdraw', env: benv, schemas: await schemasOf(assets),
                                      fields: { Label: 'nothing', 'Reason for the withdrawal': 'x' } });
  assert.equal(refused.ok, false);
  assert.equal(refused.commit, null);
  assert.equal(g.head(REPO), head);
  const unsigned = await directWrite({ repo: REPO, github: client(g), operation: 'notice', schemas: await schemasOf(assets),
                                       env: browserEnvironment({ assets }), fields: { Label: 'first',
                                       'Document version it is about': '1', 'Text of the notice': 'Again.' } });
  assert.equal(unsigned.ok, false);
  assert.match(unsigned.message, /holds 0 of the current keys/);
});

test('the keys of a new owner made in the page, and the secret of the workflows', async () => {
  const keys = await newOwnerKeys();
  assert.deepEqual([keys.rotation.length, Boolean(keys.workflows)], [3, true]);
  const log = await ownerKeyLog(keys);
  const v1 = log.latest();
  assert.deepEqual([v1.number, v1.keys.keys, v1.keys.threshold, v1.keys.next, v1.keys.nextThreshold],
                   [1, [keys.current.did, keys.workflows.did], 1, keys.rotation.map((k) => k.digest), 2]);
  const alone = await ownerKeyLog({ ...keys, workflows: null });
  assert.deepEqual(alone.latest().keys.keys, [keys.current.did]);
  await assert.rejects(ownerKeyLog(keys, { keeper: 'example.org' }), /a keeper is an ORCID iD/);
  assert.equal(ownerLabelProblem('jane-doe'), null);
  for (const bad of ['Jane', 'jane--doe', '-jane', 'x'.repeat(65)]) assert.match(ownerLabelProblem(bad), /not a valid label/);
  const copy = await signingCopy(keys.current);
  assert.ok(keys.current.seed.some((b) => b !== 0));
  assert.equal(copy.seed, null);
  const message = new TextEncoder().encode('signed in the page');
  assert.deepEqual(await copy.sign(message), await keys.current.sign(message));

  const g = repository();
  const line = seedLine(keys.workflows);
  assert.equal((await keyFromText(line, { owner: log.owner })).key.did, keys.workflows.did);
  g.repos.get(REPO).allow.secrets = false;
  await assert.rejects(storeSecret(client(g), REPO, 'OPENSHEAF_SIGNING_KEY', line), (e) => e.status === 403);
  assert.equal(g.secret(REPO, 'OPENSHEAF_SIGNING_KEY'), null);
  g.repos.get(REPO).allow.secrets = true;
  await storeSecret(client(g), REPO, 'OPENSHEAF_SIGNING_KEY', line);
  const box = g.repos.get(REPO).box;
  const opened = await openSealedBox(g.secret(REPO, 'OPENSHEAF_SIGNING_KEY'), box.publicKey, box.secretKey);
  assert.equal(new TextDecoder().decode(opened), line);
  const altered = Uint8Array.from(g.secret(REPO, 'OPENSHEAF_SIGNING_KEY'));
  altered[40] ^= 1;
  await assert.rejects(openSealedBox(altered, box.publicKey, box.secretKey), /does not open/);
  assert.equal(g.calls.filter((c) => c.method === 'PUT').length, 1);
  const sealed = await sealedBox(new Uint8Array([1, 2, 3]), g.repos.get(REPO).box.publicKey);
  assert.equal(sealed.length, 32 + 16 + 3);
  await assert.rejects(sealedBox(new Uint8Array([1]), new Uint8Array(31)), /not an X25519 public key/);
});
