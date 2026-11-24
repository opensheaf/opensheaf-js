// Generated from literate/72-tests-parity.md by opensheaf-literate: edit the document, not this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, cp, rm, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readRotationKey } from '../core/keys.js';
import { keyDigest } from '../core/names.js';
import zlib from 'node:zlib';
import { tarGz } from './fixtures.js';
import { DiskStorage } from '../cli/disk.js';
import { GitHubWallet } from '../core/wallets.js';
import { browserEnvironment, signers, checkWallet, walletEntries, passphraseConfirmed, checkPassphrase, keyToPush, pushKey,
         enrollPlan, openWithPassphrase, enrollPasskey, walletLocks, openLocks, rotationKeysFromTexts,
         rotationKeysFromWallet, walletRotationKeys, rotationFiles, keepRotationKeys, rotateAdding, ownerKeyLog, keyLogFolder,
         signingCopy, sealedBox, seedLine } from '../web/manager.js';
import { carryOut } from '../core/requests.js';
import { loadSchemas } from '../core/schema.js';
import { exampleKey } from '../core/keys.js';
import { reproducibleZip } from '../core/zenodo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'cli', 'osheaf.js');
const CONFIG = path.join(HERE, '..', 'deno.json');

function onPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  return null;
}

const PY = process.env.OSHEAF_PY || onPath('osheaf');
const skip = PY ? false : 'opensheaf-py is not installed (set OSHEAF_PY to its osheaf command)';

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'osheaf-parity-'));
  await mkdir(path.join(root, 'home'));
  const env = { PATH: process.env.PATH, HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'xdg'),
                OPENSHEAF_KEY_STORE: 'file', LANG: 'C.UTF-8' };
  if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
  env.DENO_DIR = process.env.DENO_DIR || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/deno'
    : process.platform === 'win32' ? 'AppData/Local/deno' : '.cache/deno');
  const run = (command, args, { cwd = root, more = {}, input = undefined } = {}) => {
    const r = spawnSync(command[0], [...command.slice(1), ...args], { cwd, env: { ...env, ...more }, encoding: 'utf-8', input });
    if (r.error) throw r.error;
    return r;
  };
  const isDeno = typeof globalThis.Deno !== 'undefined';
  const jsCommand = isDeno ? [process.execPath, 'run', '-A', '--config', CONFIG, CLI] : [process.execPath, CLI];
  return {
    root,
    run,
    js: (args, options) => run(jsCommand, args, options),
    py: (args, options) => run([PY], args, options),
    file: (name, text) => writeFile(path.join(root, name), text),
    done: () => rm(root, { recursive: true, force: true }),
  };
}

function ok(r, what) {
  assert.equal(r.status, 0, `${what} failed:\n${r.stdout}\n${r.stderr}`);
  return r;
}

function findings(r) {
  return JSON.parse(r.stdout).map((x) => `${x.severity}: ${x.place}: ${x.message}`).sort();
}

async function initArgs(dir, keys, { passphrase = false } = {}) {
  return [ 'init', dir, '--name', 'Papers of Jane Doe', '--base-url', 'https://example.org/papers/',
           '--curator', 'Doe, Jane', '--new-owner', '--export', keys, '--yes',
           ...(passphrase ? [] : ['--no-passphrase']) ];
}

const DEPOSIT = ['--pdf', '../paper.pdf', '--title', 'A paper on sheaves', '--author', 'Doe, Jane|University',
                 '--abstract', 'We study archives.', '--keyword', 'sheaves', '--rights', 'cc-by-4.0'];

async function papers(s) {
  await s.file('paper.tex', '\\documentclass{article}\n\\begin{document}Sheaves.\\end{document}\n');
  await s.file('paper.pdf', '%PDF-1.4 the first version\n');
  await s.file('paper2.pdf', '%PDF-1.4 the second version\n');
}

test('an archive made by opensheaf-js passes osheaf verify of opensheaf-py', { skip }, async () => {
  const s = await sandbox();
  try {
    await papers(s);
    ok(s.js(await initArgs('arch', path.join(s.root, 'keys'))), 'js init');
    const arch = path.join(s.root, 'arch');
    ok(s.js(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--new'], { cwd: arch }), 'js deposit --new');
    ok(s.js(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf', '--changes', 'Corrected.'],
            { cwd: arch }), 'js deposit');
    ok(s.js(['collect'], { cwd: arch }), 'js collect');
    const theirs = findings(ok(s.py(['verify', '--json'], { cwd: arch }), 'py verify'));
    assert.deepEqual(theirs.filter((f) => !f.startsWith('result: ')), []);
    assert.equal(theirs.length, 3);
    assert.ok(theirs.includes('result: paper: latest signed version v2'));
    assert.ok(theirs.includes('result: main: latest signed version v2'));
    const ours = findings(ok(s.js(['verify', '--json'], { cwd: arch }), 'js verify'));
    assert.deepEqual(ours, theirs);
  } finally {
    await s.done();
  }
});

test('an archive made by opensheaf-py passes the verification of opensheaf-js, with the same findings', { skip }, async () => {
  const s = await sandbox();
  try {
    await papers(s);
    ok(s.py(await initArgs('arch', path.join(s.root, 'keys'))), 'py init');
    const arch = path.join(s.root, 'arch');
    ok(s.py(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--new'], { cwd: arch }), 'py deposit --new');
    ok(s.py(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf'], { cwd: arch }), 'py deposit');
    ok(s.py(['collect'], { cwd: arch }), 'py collect');
    const theirs = findings(ok(s.py(['verify', '--json'], { cwd: arch }), 'py verify'));
    const ours = findings(ok(s.js(['verify', '--json'], { cwd: arch }), 'js verify'));
    assert.deepEqual(ours, theirs);
    assert.deepEqual(ours.filter((f) => !f.startsWith('result: ')), []);
    ok(s.js(['deposit', 'paper', '../paper.tex', ...DEPOSIT], { cwd: arch }), 'js deposit on a py archive');
    const again = findings(ok(s.py(['verify', '--json'], { cwd: arch }), 'py verify'));
    assert.deepEqual(again.filter((f) => !f.startsWith('result: ')), []);
    assert.deepEqual(findings(s.js(['verify', '--json'], { cwd: arch })), again);
    const repeat = ['deposit', 'paper', '../paper.tex', ...DEPOSIT];
    const [p, j] = [s.py(repeat, { cwd: arch }), s.js(repeat, { cwd: arch })];
    assert.equal(p.status, 1);
    assert.equal(j.status, 1);
    assert.match(p.stderr, /paper: these are the files and the change note of the current version, document version 3: nothing new to deposit \(section 4\.2\)/);
    assert.equal(j.stderr.trim(), p.stderr.trim());
    ok(s.py(['withdraw', 'paper', '--reason', 'An error.'], { cwd: arch }), 'py withdraw');
    const back = ok(s.js(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf', '--changes', 'Back.'],
                         { cwd: arch }), 'js deposit on a withdrawn py line');
    assert.match(back.stderr, /Note: paper is withdrawn; this version reinstates it/);
    const reinstated = findings(ok(s.py(['verify', '--json'], { cwd: arch }), 'py verify'));
    assert.ok(reinstated.some((f) => f.includes('reinstated; withdrawn: document version(s) 1, 2, 3 (section 13.1)')),
              reinstated.join('\n'));
    assert.deepEqual(reinstated.filter((f) => !f.startsWith('result: ')), []);
    assert.deepEqual(findings(s.js(['verify', '--json'], { cwd: arch })), reinstated);
  } finally {
    await s.done();
  }
});

test('rotation keys exported by opensheaf-js sign with opensheaf-py, and back', { skip }, async () => {
  const s = await sandbox();
  const more = { OPENSHEAF_PASSPHRASE: 'a passphrase for the tests' };
  try {
    await papers(s);
    const keys = path.join(s.root, 'keys');
    ok(s.js(await initArgs('arch', keys, { passphrase: true }), { more }), 'js init (locked keys)');
    const arch = path.join(s.root, 'arch');
    const files = (await readdir(keys)).sort();
    assert.equal(files.length, 3);
    for (const f of files) assert.match(await readFile(path.join(keys, f), 'utf-8'), /\nencryption argon2id-secretbox /);
    ok(s.py(['owner', 'rotate', '--rotation-key', path.join(keys, files[0]), '--rotation-key', path.join(keys, files[2]),
             '--export', path.join(s.root, 'keys2'), '--no-passphrase', '--yes'], { cwd: arch, more }), 'py owner rotate');
    ok(s.js(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--new'], { cwd: arch }), 'js deposit after rotation');
    const theirs = findings(ok(s.py(['verify', '--json'], { cwd: arch }), 'py verify'));
    assert.ok(theirs.some((f) => /key log of .*: latest version v2$/.test(f)));
    assert.ok(theirs.includes('result: paper: latest signed version v1'));
    assert.deepEqual(findings(ok(s.js(['verify', '--json'], { cwd: arch }), 'js verify')), theirs);

    for (const locked of [false, true]) {
      const name = locked ? 'pyl' : 'pyp';
      const pyKeys = path.join(s.root, `${name}-keys`);
      ok(s.py(await initArgs(name, pyKeys, { passphrase: locked }), { more }), `py init (${name})`);
      const cfg = JSON.parse(await readFile(path.join(s.root, name, 'osheaf.json'), 'utf-8'));
      const genesis = JSON.parse(await readFile(path.join(s.root, name, 'ocfl', cfg.owner, cfg.owner, 'v1', 'content', 'genesis.json'), 'utf-8'));
      for (const f of await readdir(pyKeys)) {
        const read = await readRotationKey(await readFile(path.join(pyKeys, f), 'utf-8'), locked ? more.OPENSHEAF_PASSPHRASE : null);
        assert.equal(read.owner, cfg.owner);
        assert.equal(read.version, 1);
        assert.ok(genesis.next.includes(await keyDigest(read.key.did)));
      }
    }
  } finally {
    await s.done();
  }
});

test('the same deposit by both gives the same files', { skip }, async () => {
  const s = await sandbox();
  try {
    await papers(s);
    ok(s.py(await initArgs('arch', path.join(s.root, 'keys'))), 'py init');
    const arch = path.join(s.root, 'arch');
    ok(s.py(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--new'], { cwd: arch }), 'py deposit --new');
    await cp(arch, path.join(s.root, 'a'), { recursive: true });
    await cp(arch, path.join(s.root, 'b'), { recursive: true });
    const second = ['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf', '--changes', 'Corrected.',
                    '--toolchain', 'pdflatex=TeX Live 2025', '--stage', 'AM', '--related', 'IsSupplementTo:doi:10.1234/x'];
    ok(s.py(second, { cwd: path.join(s.root, 'a') }), 'py deposit');
    ok(s.js(second, { cwd: path.join(s.root, 'b') }), 'js deposit');
    ok(s.py(['collect'], { cwd: path.join(s.root, 'a') }), 'py collect');
    ok(s.js(['collect'], { cwd: path.join(s.root, 'b') }), 'js collect');
    const disc = JSON.parse(await readFile(path.join(arch, 'opensheaf.json'), 'utf-8'));
    const line = disc.objects.find((o) => o.label === 'paper');
    const main = disc.objects.find((o) => o.label === 'main');
    const dirOf = (copy, o) => path.join(s.root, copy, 'ocfl', o.owner, o.name);
    const bytes = (copy, o, rel) => readFile(path.join(dirOf(copy, o), rel));
    for (const rel of ['v2/content/object.json', 'v2/content/datacite.json']) {
      assert.deepEqual(await bytes('b', line, rel), await bytes('a', line, rel), rel);
    }
    const timeless = async (copy, o, rel) => {
      const inv = JSON.parse(await readFile(path.join(dirOf(copy, o), rel), 'utf-8'));
      for (const v of Object.values(inv.versions)) v.created = '-';
      return JSON.stringify(inv, null, 2);
    };
    assert.equal(await timeless('b', line, 'inventory.json'), await timeless('a', line, 'inventory.json'));
    const asWritten = async (copy) => (await readFile(path.join(dirOf(copy, line), 'inventory.json'), 'utf-8'))
      .replace(/"created": "[^"]*"/g, '"created": "-"');
    assert.equal(await asWritten('b'), await asWritten('a'));
    assert.deepEqual(await readdir(path.join(dirOf('b', line), 'extensions/opensheaf-witnesses/v2')),
                     await readdir(path.join(dirOf('a', line), 'extensions/opensheaf-witnesses/v2')));
    const members = async (copy) => {
      const m = JSON.parse(await readFile(path.join(dirOf(copy, main), 'v2/content/members.json'), 'utf-8'));
      for (const x of m.members) delete x.inventorySha512;
      return m;
    };
    assert.deepEqual(await members('b'), await members('a'));
    assert.deepEqual(await bytes('b', main, 'v2/content/datacite.json'), await bytes('a', main, 'v2/content/datacite.json'));
  } finally {
    await s.done();
  }
});

async function filesOf(root, rel = '') {
  const out = new Map();
  for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) for (const [k, v] of await filesOf(root, p)) out.set(k, v);
    else out.set(p, await readFile(path.join(root, p)));
  }
  return out;
}

const timeless = (bytes) => bytes.toString('utf-8').replace(/"created": "[^"]*"/g, '"created": "-"');

async function sameArchives(a, b, skip = () => false) {
  const A = await filesOf(a), B = await filesOf(b);
  const kept = (p) => p.startsWith('ocfl/') && (p.includes('/content/') || p.endsWith('inventory.json')) && !skip(p);
  assert.deepEqual([...B.keys()].filter(kept).sort(), [...A.keys()].filter(kept).sort());
  for (const [p, bytes] of A) {
    if (!kept(p)) continue;
    if (p.endsWith('inventory.json')) assert.equal(timeless(B.get(p)), timeless(bytes), p);
    else assert.deepEqual(B.get(p), bytes, p);
  }
}

async function lineOf(root, label) {
  const disc = JSON.parse(await readFile(path.join(root, 'opensheaf.json'), 'utf-8'));
  const o = disc.objects.find((x) => x.label === label);
  return { name: o.name, dir: path.join(root, 'ocfl', o.owner, o.name) };
}

async function sameNewWork(a, b, label) {
  const A = await lineOf(a, label), B = await lineOf(b, label);
  const mask = (bytes, name) => bytes.toString('utf-8').split(name).join('NAME')
    .replace(/"previous": "[0-9a-f]*"/, '"previous": "-"');
  const fa = await filesOf(A.dir), fb = await filesOf(B.dir);
  const content = (m) => [...m.keys()].filter((p) => p.includes('/content/')).sort();
  assert.deepEqual(content(fb), content(fa));
  for (const p of content(fa)) {
    if (!p.endsWith('genesis.json')) assert.equal(mask(fb.get(p), B.name), mask(fa.get(p), A.name), p);
  }
}

function said(r) {
  return (r.stdout + r.stderr).split('\n').filter((l) => l && !l.startsWith('usage:') && !l.startsWith('  ') &&
                                                      !l.includes('Download')).join('\n')
    .replace(/sheaf:[a-z2-7]{52}:/g, 'sheaf:NAME:');
}

async function both(s, base, args, { more = {}, status = 0 } = {}) {
  for (const copy of ['a', 'b']) await rm(path.join(s.root, copy), { recursive: true, force: true });
  await cp(base, path.join(s.root, 'a'), { recursive: true });
  await cp(base, path.join(s.root, 'b'), { recursive: true });
  const p = s.py(args, { cwd: path.join(s.root, 'a'), more });
  const j = s.js(args, { cwd: path.join(s.root, 'b'), more });
  assert.equal(p.status, status, `py ${args.join(' ')}:\n${p.stdout}\n${p.stderr}`);
  assert.equal(j.status, status, `js ${args.join(' ')}:\n${j.stdout}\n${j.stderr}`);
  assert.equal(said(j), said(p), args.join(' '));
  return { a: path.join(s.root, 'a'), b: path.join(s.root, 'b') };
}

function verified(s, where, more = {}, remote = false) {
  const extra = remote ? ['--remote'] : [];
  const p = findings(s.py(['verify', '--json', ...extra], { cwd: where, more }));
  const j = findings(s.js(['verify', '--json', ...extra], { cwd: where, more }));
  assert.deepEqual(j, p, `verify ${where}`);
  return p;
}

test('init by both writes the same configuration, and the templates of this repository', { skip }, async () => {
  const s = await sandbox();
  try {
    ok(s.py(await initArgs('pa', path.join(s.root, 'k1'))), 'py init');
    ok(s.js(await initArgs('ja', path.join(s.root, 'k2'))), 'js init');
    const cfg = async (d) => {
      const c = JSON.parse(await readFile(path.join(s.root, d, 'osheaf.json'), 'utf-8'));
      c.owner = '-';
      return JSON.stringify(c, null, 2);
    };
    assert.equal(await cfg('ja'), await cfg('pa'));
    const mine = path.join(HERE, '..', 'templates');
    const names = (await readdir(mine)).sort();
    assert.deepEqual((await readdir(path.join(s.root, 'pa', 'templates'))).sort(), names);
    for (const n of names) {
      assert.deepEqual(await readFile(path.join(s.root, 'pa', 'templates', n)), await readFile(path.join(mine, n)), n);
      assert.deepEqual(await readFile(path.join(s.root, 'ja', 'templates', n)), await readFile(path.join(mine, n)), n);
    }
    const top = async (d) => (await readdir(path.join(s.root, d))).sort();
    assert.deepEqual(await top('ja'), await top('pa'));
    assert.equal(await readFile(path.join(s.root, 'ja', '.gitignore'), 'utf-8'),
                 await readFile(path.join(s.root, 'pa', '.gitignore'), 'utf-8'));
    assert.deepEqual(verified(s, path.join(s.root, 'ja')).filter((f) => !f.startsWith('result: ')), []);
    const offline = { https_proxy: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' };
    const keeper = ['--keeper', 'https://example.org/'];
    ok(s.py([...await initArgs('pk', path.join(s.root, 'k3')), ...keeper], { more: offline }), 'py init --keeper');
    ok(s.js([...await initArgs('jk', path.join(s.root, 'k4')), ...keeper], { more: offline }), 'js init --keeper');
    for (const d of ['pk', 'jk']) {
      assert.ok(verified(s, path.join(s.root, d), offline).some((f) => /^result: owner [a-z2-7]+: keeper https:\/\/example.org\/: not checked \(osheaf verify --remote/.test(f)));
    }
    const pages = await sameWebsite(s, path.join(s.root, 'pk'), offline);
    assert.match(pages.get('paper/main/index.html').toString(), /keeper <a href="https:\/\/example.org\/">/);
  } finally {
    await s.done();
  }
});

test('descriptions and deposits from a file, by both, give the same files', { skip }, async () => {
  const s = await sandbox();
  try {
    await papers(s);
    await s.file('statement.md', '# A statement\n');
    await s.file('refs.bib', '@article{x}\n');
    ok(s.py(await initArgs('arch', path.join(s.root, 'keys'))), 'py init');
    const arch = path.join(s.root, 'arch');
    ok(s.py(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--new'], { cwd: arch }), 'py deposit');
    ok(s.py(['deposit', 'bare', '--pdf', '../paper.pdf', '--no-source', 'lost', '--title', 'Bare', '--author', 'Doe, Jane',
             '--new'], { cwd: arch }), 'py deposit --no-source');
    ok(s.py(['notice', 'bare', '--about', '1', '--text', 'Sources found.'], { cwd: arch }), 'py notice');
    ok(s.py(['collect'], { cwd: arch }), 'py collect');
    const runs = [
      ['notice', 'bare', '--about', '1', '--text', 'A second notice.'],
      ['notice', 'bare', '--about', '1', '--replaces', '1', '--text', 'The first notice is withdrawn.', '--date', '2025-01-03'],
      ['notice', 'paper', '--about', '1', '--text', 'A notice.', '--file', '../statement.md', '--date', '2025-01-02'],
      ['withdraw', 'paper', '--reason', 'An error.', '--file', '../statement.md'],
      ['relate', 'paper', '--to', 'arxiv:2501.00001', '--relation', 'IsVariantFormOf', '--issued', '2024-12-01'],
      ['relicense', 'paper', '--rights', 'cc0-1.0', '--method', 'confirmed by email'],
      ['describe', 'paper', '--title', 'Another title', '--keyword', 'a', '--keyword', 'b', '--author', 'Roe, Richard|Elsewhere'],
      ['complete', 'bare', '--version', '1', '--source', '../paper.tex', '--extra-source', '../refs.bib=bib/refs.bib'],
      ['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf', '--changes', 'Corrected; the error is fixed.'],
      ['withdraw', 'paper', '--reason', 'Another error.'],
    ];
    for (const args of runs) {
      const { a, b } = await both(s, arch, args);
      await sameArchives(a, b);
      assert.deepEqual(verified(s, a), verified(s, b));
    }
    for (const args of [['notice', 'paper', '--about', '2', '--text', 'x'],
                        ['notice', 'paper', '--about', '1', '--replaces', '1', '--text', 'x'],
                        ['notice', 'bare', '--about', '1', '--replaces', '9', '--text', 'x'],
                        ['relicense', 'paper', '--rights', 'cc-by-4.0', '--method', 'again'],
                        ['describe', 'paper'], ['complete', 'paper', '--version', '1', '--source', '../paper.tex']]) {
      await both(s, arch, args, { status: 1 });
    }
    await both(s, arch, ['relicense', 'paper'], { status: 2 });
    await s.file('deposits.yaml', [
      '- id: yml', '  new: true', '  source: paper.tex', '  pdf: paper.pdf', '  title: From a file, 2611.14296',
      '  authors:', '    - Doe, Jane|University', '    - {name: "Roe, Richard", affiliation: Elsewhere}',
      '  keywords: [a, b]', '  available: 2025-01-02', '  extra-sources:', '    - {file: refs.bib, path: x/refs.bib}',
      '  rights: cc-by-4.0', '- id: yml', '  source: paper.tex', '  pdf: paper2.pdf', '  title: Second', '  author: Doe, Jane',
      '  date: 2025-02-03', '  changes: Better.', ''].join('\n'));
    const { a, b } = await both(s, arch, ['deposit', '--from', '../deposits.yaml', '--keyword', 'given']);
    await sameNewWork(a, b, 'yml');
  } finally {
    await s.done();
  }
});

async function sameWebsite(s, arch, more = {}) {
  const { a, b } = await both(s, arch, ['index'], { more });
  const A = await filesOf(a), B = await filesOf(b);
  assert.deepEqual([...B.keys()].sort(), [...A.keys()].sort());
  for (const [p, bytes] of A) assert.deepEqual(B.get(p), bytes, p);
  return A;
}

test('the website written by both is the same', { skip }, async () => {
  const s = await sandbox();
  try {
    await papers(s);
    ok(s.py(await initArgs('arch', path.join(s.root, 'keys'))), 'py init');
    const arch = path.join(s.root, 'arch');
    for (const label of ['one', 'two', 'three', 'four']) {
      ok(s.py(['deposit', label, '../paper.tex', ...DEPOSIT, '--title', `Paper ${label} on $x < y$ & "z"`, '--new',
               '--issued', '2024-0' + (label.length) + '-01'], { cwd: arch }), `py deposit ${label}`);
    }
    ok(s.py(['deposit', 'one', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf', '--changes', 'Corrected.',
             '--stage', 'AM', '--related', 'arxiv=2401.00001'], { cwd: arch }), 'py deposit v2');
    ok(s.py(['notice', 'one', '--about', '1', '--text', 'An erratum.'], { cwd: arch }), 'py notice');
    ok(s.py(['notice', 'one', '--about', '2', '--text', 'A notice about version 2.'], { cwd: arch }), 'py notice 2');
    ok(s.py(['notice', 'one', '--about', '1', '--replaces', '1', '--text', 'The erratum is withdrawn.'], { cwd: arch }),
       'py notice --replaces');
    ok(s.py(['withdraw', 'three', '--reason', 'Wrong.'], { cwd: arch }), 'py withdraw');
    ok(s.py(['withdraw', 'four', '--reason', 'Wrong too.'], { cwd: arch }), 'py withdraw four');
    ok(s.py(['deposit', 'four', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf', '--changes', 'Back.'], { cwd: arch }),
       'py deposit four, reinstated');
    ok(s.py(['collect'], { cwd: arch }), 'py collect');
    ok(s.py(['collection', 'new', 'picks', '--type', 'selection', '--title', 'Picks', '--description', 'Chosen.'],
            { cwd: arch }), 'py collection new');
    ok(s.py(['collection', 'add', 'picks', 'one', 'two'], { cwd: arch }), 'py collection add');
    const pages = await sameWebsite(s, arch);
    assert.ok(pages.has('paper/one/index.html') && pages.has('paper/picks/index.html') && pages.has('sitemap.xml'));
    const landing = pages.get('paper/one/index.html').toString();
    assert.ok(!landing.includes('An erratum.') && landing.includes('Notice 3') && landing.includes('replacing notice 1'));
    const four = pages.get('paper/four/index.html').toString();
    assert.equal(four.split('class="withdrawn"').length - 1, 1);
    const cfg = JSON.parse(await readFile(path.join(arch, 'osheaf.json'), 'utf-8'));
    cfg.index.html.featured = 'picks';
    await writeFile(path.join(arch, 'osheaf.json'), JSON.stringify(cfg, null, 2) + '\n');
    const featured = await sameWebsite(s, arch);
    assert.match(featured.get('index.html').toString(), /<section class="featured">/);
    assert.deepEqual(verified(s, arch).filter((f) => !f.startsWith('result: ')), []);
  } finally {
    await s.done();
  }
});

async function serve(dir) {
  const server = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1', '--directory', dir],
                       { stdio: ['ignore', 'pipe', 'ignore'] });
  const port = await new Promise((resolve, reject) => {
    let text = '';
    server.stdout.on('data', (chunk) => {
      text += chunk;
      const m = /port (\d+)/.exec(text);
      if (m) resolve(Number(m[1]));
    });
    server.on('error', reject);
    server.on('exit', () => reject(new Error('the server stopped')));
  });
  return { url: `http://127.0.0.1:${port}/`, stop: () => server.kill() };
}

test('collections with members of another archive, by both', { skip }, async () => {
  const s = await sandbox();
  let server = null;
  try {
    await papers(s);
    ok(s.py([...(await initArgs('other', path.join(s.root, 'k2'))).slice(0, 2), '--name', 'Other papers', '--base-url',
             'https://example.org/other/', '--curator', 'Roe, Richard', '--new-owner', '--export', path.join(s.root, 'k2'),
             '--yes', '--no-passphrase']), 'py init other');
    const other = path.join(s.root, 'other');
    ok(s.py(['deposit', 'op', '../paper.tex', ...DEPOSIT, '--title', 'Other paper', '--new'], { cwd: other }), 'other v1');
    ok(s.py(['deposit', 'op', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf', '--title', 'Other paper, v2'],
            { cwd: other }), 'other v2');
    ok(s.py(['collect'], { cwd: other }), 'other collect');
    server = await serve(other);
    const arch = path.join(s.root, 'arch');
    const more = { OPENSHEAF_LOCATIONS: `https://example.org/other/=${server.url};https://example.org/papers/=${arch}/` };
    ok(s.py(await initArgs('arch', path.join(s.root, 'keys'))), 'py init');
    ok(s.py(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--new'], { cwd: arch, more }), 'py deposit');
    ok(s.py(['collect'], { cwd: arch, more }), 'py collect');
    const theirs = JSON.parse(await readFile(path.join(other, 'opensheaf.json'), 'utf-8')).objects.find((o) => o.label === 'op').id;
    const at = ['--at', 'https://example.org/other/'];
    const short = `sheaf:${theirs.split(':')[1].slice(0, 16)}`;
    for (const args of [['collection', 'new', 'sel', '--type', 'selection', '--title', 'A selection', '--description', 'Vetted.'],
                        ['collection', 'new', 'cat', '--type', 'catalogue', '--title', 'A catalogue', '--order', 'issued-desc']]) {
      const { a, b } = await both(s, arch, args, { more });
      ok(s.py(args, { cwd: arch, more }), args.join(' '));
      await sameNewWork(a, b, args[2]);
    }
    const steps = [
      ['collection', 'add', 'cat', theirs, ...at, '--follow'],
      ['collection', 'add', 'sel', theirs, ...at, '--revision', '1'],
      ['collection', 'add', 'cat', 'paper'],
      ['collection', 'add', 'sel', short, ...at, '--revision', '2'],
      ['collection', 'follow', 'cat', theirs, '--off'],
      ['collection', 'follow', 'cat', theirs],
    ];
    for (const args of steps) {
      const { a, b } = await both(s, arch, args, { more });
      await sameArchives(a, b);
      ok(s.py(args, { cwd: arch, more }), args.join(' '));
    }
    await both(s, arch, ['collection', 'status', 'cat'], { more });
    await both(s, arch, ['collection', 'status', 'sel'], { more });
    await both(s, arch, ['collection', 'add', 'cat', 'paper'], { more, status: 1 });
    ok(s.py(['deposit', 'op', '../paper.tex', ...DEPOSIT, '--pdf', '../paper.pdf', '--title', 'Other paper, v3'],
            { cwd: other }), 'other v3');
    let { a, b } = await both(s, arch, ['collection', 'update'], { more });
    await sameArchives(a, b);
    ({ a, b } = await both(s, arch, ['collection', 'remove', 'sel', short, '--revision', '1'], { more }));
    await sameArchives(a, b);
    ok(s.py(['collection', 'remove', 'sel', theirs, '--revision', '1'], { cwd: arch, more }), 'remove --revision');
    await both(s, arch, ['collection', 'remove', 'sel', theirs, '--revision', '1'], { more, status: 1 });
    ({ a, b } = await both(s, arch, ['collection', 'remove', 'cat', 'paper'], { more }));
    await sameArchives(a, b);
    await s.file('coll.yaml', ['title: Synced', 'description: From a file.', 'order: issued-asc', 'members:', '  - paper',
                               `  - uri: ${theirs}`, '    at: https://example.org/other/', '    follow: yes', ''].join('\n'));
    ({ a, b } = await both(s, arch, ['collection', 'sync', 'synced', '--from', '../coll.yaml'], { more }));
    await sameNewWork(a, b, 'synced');
    ({ a, b } = await both(s, arch, ['collection', 'sync', 'cat', '--from', '../coll.yaml'], { more }));
    await sameArchives(a, b);
    await s.file('digest.yaml', ['type: selection', 'title: Digest', 'members:', `  - uri: ${theirs}`,
                                 '    at: https://example.org/other/', '    revisions: [2, 1, 2]', ''].join('\n'));
    ({ a, b } = await both(s, arch, ['collection', 'sync', 'digest', '--from', '../digest.yaml'], { more }));
    await sameNewWork(a, b, 'digest');
    ok(s.py(['collection', 'sync', 'digest', '--from', '../digest.yaml'], { cwd: arch, more }), 'sync digest');
    ({ a, b } = await both(s, arch, ['collection', 'add', 'digest', theirs, ...at, '--revision', '3', '--revision', '3'], { more }));
    await sameArchives(a, b);
    const digest = await lineOf(b, 'digest');
    const dinv = JSON.parse(await readFile(path.join(digest.dir, 'inventory.json'), 'utf-8'));
    const [dm] = Object.entries(dinv.versions[dinv.head].state).find(([, ps]) => ps.includes('members.json'));
    const dmembers = JSON.parse(await readFile(path.join(digest.dir, dinv.manifest[dm][0]), 'utf-8')).members;
    assert.deepEqual(dmembers[0].revisions.map((x) => x.documentVersion), [1, 2, 3]);
    ok(s.py(['collection', 'add', 'digest', theirs, ...at, '--revision', '3', '--revision', '3'], { cwd: arch, more }), 'add digest');
    await sameWebsite(s, arch, more);
    const remote = verified(s, arch, more, true);
    assert.ok(remote.some((f) => /^result: cat v\d+ member .* verified at https:\/\/example.org\/other\//.test(f)));
    assert.deepEqual(remote.filter((f) => f.startsWith('error')), []);
    assert.ok(verified(s, arch, more).some((f) => /not held in this archive: not resolved/.test(f)));
  } finally {
    server?.stop();
    await s.done();
  }
});

async function keyFiles(dir) {
  return (await readdir(dir)).sort().map((n) => path.join(dir, n));
}

function clean(s, where, more = {}) {
  const found = verified(s, where, more);
  assert.deepEqual(found.filter((f) => !f.startsWith('result: ')), [], where);
  return found;
}

test('one owner kept by both: rotate, expose, sign again, end', { skip }, async () => {
  const s = await sandbox();
  try {
    await papers(s);
    const k = (n) => path.join(s.root, n);
    ok(s.py(await initArgs('arch', k('k1'))), 'py init');
    const arch = k('arch');
    ok(s.py(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--new'], { cwd: arch }), 'py deposit');
    const k1 = await keyFiles(k('k1'));
    const fresh = ok(s.js(['key', 'new'], { cwd: arch }), 'js key new').stdout.split('\n')[1].trim();
    ok(s.js(['owner', 'rotate', '--add', fresh, '--rotation-key', k1[0], '--rotation-key', k1[2], '--export', k('k2'),
             '--no-passphrase', '--yes'], { cwd: arch }), 'js rotate a py key log');
    clean(s, arch);
    const k2 = await keyFiles(k('k2'));
    ok(s.py(['owner', 'rotate', '--rotation-key', k2[1], '--rotation-key', k2[2], '--export', k('k3'), '--no-passphrase',
             '--yes', '--next-threshold', '1', '--rotation', '2'], { cwd: arch }), 'py rotate a js key log');
    clean(s, arch);
    const show = ok(s.py(['owner', 'show', '--offline'], { cwd: arch }), 'py show').stdout;
    const first = /Current keys  (did:key:\S+)/.exec(show)[1];
    assert.notEqual(first, fresh);
    const k3 = await keyFiles(k('k3'));
    ok(s.js(['owner', 'expose', first, '--rotation-key', k3[0], '--export', k('k4'), '--no-passphrase', '--yes'],
            { cwd: arch }), 'js expose');
    const contested = verified(s, arch);
    assert.ok(contested.some((f) => /contested/.test(f)), contested.join('\n'));
    ok(s.py(['sign', 'paper', '--version', 'v1', '--yes'], { cwd: arch }), 'py sign again');
    ok(s.js(['sign', 'main', '--version', 'v1', '--yes'], { cwd: arch }), 'js sign again');
    clean(s, arch);
    await both(s, arch, ['owner', 'show', '--offline']);
    await both(s, arch, ['sign', 'paper', '--version', 'v1', '--yes'], { status: 1 });
    const k4 = await keyFiles(k('k4'));
    const { a, b } = await both(s, arch, ['owner', 'end', '--successor', 'a'.repeat(51) + 'q', '--rotation-key', k4[0]]);
    clean(s, a);
    clean(s, b);
    ok(s.py(['owner', 'end', '--rotation-key', k4[0]], { cwd: arch }), 'py end');
    await both(s, arch, ['deposit', 'paper', '../paper.tex', ...DEPOSIT], { status: 1 });
    await both(s, arch, ['owner', 'show', '--offline']);
    clean(s, arch);
  } finally {
    await s.done();
  }
});

test('copies of a key log met by both: init --owner, pull, forks', { skip }, async () => {
  const s = await sandbox();
  try {
    const k = (n) => path.join(s.root, n);
    ok(s.py(await initArgs('one', k('k1'))), 'py init a');
    const owner = JSON.parse(await readFile(k('one/osheaf.json'), 'utf-8')).owner;
    const folder = (dir) => path.join(dir, 'ocfl', owner, owner);
    const init = (dir) => ['init', dir, '--name', 'B', '--base-url', 'https://example.org/b/', '--curator', 'Doe, Jane',
                           '--owner', owner, '--key-log', folder(k('one'))];
    ok(s.js(init(k('two'))), 'js init --owner');
    ok(s.py([...init(k('three')).slice(0, 2), '--name', 'C', '--base-url', 'https://example.org/c/', ...init(k('three')).slice(6)]),
       'py init --owner');
    const k1 = await keyFiles(k('k1'));
    ok(s.py(['owner', 'rotate', '--rotation-key', k1[0], '--rotation-key', k1[1], '--export', k('k2'), '--no-passphrase',
             '--yes'], { cwd: k('one') }), 'py rotate a');
    const pulled = ok(s.js(['owner', 'pull', folder(k('one'))], { cwd: k('two') }), 'js pull');
    assert.match(pulled.stdout, /1 version added/);
    const again = ok(s.py(['owner', 'pull', folder(k('one'))], { cwd: k('three') }), 'py pull');
    assert.equal(said(again).replaceAll(k('one'), 'A'), said(pulled).replaceAll(k('one'), 'A'));
    clean(s, k('two'));
    clean(s, k('three'));
    ok(s.js(['owner', 'rotate', '--rotation-key', (await keyFiles(k('k2')))[0], '--rotation-key', (await keyFiles(k('k2')))[1],
             '--export', k('k3b'), '--no-passphrase', '--yes'], { cwd: k('two') }), 'js rotate b');
    ok(s.py(['owner', 'rotate', '--rotation-key', (await keyFiles(k('k2')))[1], '--rotation-key', (await keyFiles(k('k2')))[2],
             '--export', k('k3c'), '--no-passphrase', '--yes'], { cwd: k('three') }), 'py rotate c');
    const fj = ok(s.js(['owner', 'pull', folder(k('three'))], { cwd: k('two') }), 'js pull a fork');
    const fp = ok(s.py(['owner', 'pull', folder(k('two'))], { cwd: k('three') }), 'py pull a fork');
    assert.match(fj.stdout, /a fork at v3 met at .*: fork record appended as v4/);
    assert.match(fp.stdout, /a fork at v3 met at .*: fork record appended as v4/);
    for (const dir of [k('two'), k('three')]) {
      const found = clean(s, dir);
      assert.ok(found.some((f) => /fork/.test(f)), found.join('\n'));
    }
    await both(s, k('two'), ['owner', 'show', '--offline']);
  } finally {
    await s.done();
  }
});

const FAKE_STATE = `import base64, hashlib, json, os, sys
state = os.environ["FAKE_GH_DIR"]
def repos():
    return json.load(open(os.path.join(state, "repos.json")))
def sha(f):
    return hashlib.sha1(open(f, "rb").read()).hexdigest()
def answer(method, path, body):
    """(status, value) of the contents API for METHOD on PATH (repos/OWNER/REPO/contents/...)."""
    parts = path.strip("/").split("/")
    repo = "/".join(parts[1:3])
    if parts[0] != "repos" or repo not in repos():
        return 404, {"message": "Not Found"}
    if len(parts) == 3:
        vis = repos()[repo]
        vis = vis if isinstance(vis, str) else "private" if vis else "public"
        return 200, {"full_name": repo, "private": vis != "public", "visibility": vis}
    full = os.path.join(state, "contents", repo, *parts[4:])
    if method == "GET":
        if os.path.isdir(full):
            return 200, [{"name": n, "type": "dir" if os.path.isdir(os.path.join(full, n)) else "file"}
                         for n in sorted(os.listdir(full))]
        if os.path.isfile(full):
            return 200, {"type": "file", "sha": sha(full), "content": base64.encodebytes(open(full, "rb").read()).decode()}
        return 404, {"message": "Not Found"}
    if method == "PUT":
        if os.path.exists(full) and body.get("sha") != sha(full):
            return 409, {"message": "sha does not match"}
        os.makedirs(os.path.dirname(full), exist_ok=True)
        open(full, "wb").write(base64.b64decode(body["content"]))
        return 200, {}
    if method == "DELETE":
        if not os.path.isfile(full) or body.get("sha") != sha(full):
            return 404, {"message": "Not Found"}
        os.remove(full)
        return 200, {}
    return 405, {}
`;

const FAKE_GH = `${FAKE_STATE}
args = sys.argv[1:]
if args[:2] == ["auth", "status"]:
    sys.exit(0)
method, body, path, rest = "GET", None, None, args[1:]
while rest:
    a = rest.pop(0)
    if a == "-H":
        rest.pop(0)
    elif a == "-X":
        method = rest.pop(0)
    elif a == "--input":
        rest.pop(0)
        body = json.loads(sys.stdin.read())
    else:
        path = a
status, value = answer(method, path, body)
if status != 200:
    print(json.dumps(value))
    print(f"gh: {value.get('message')} (HTTP {status})", file=sys.stderr)
    sys.exit(1)
print(json.dumps(value))
`;

const FAKE_API = `${FAKE_STATE}
import http.server
class Handler(http.server.BaseHTTPRequestHandler):
    def go(self):
        if self.headers.get("Authorization") != "Bearer a-token":
            return self.send(401, {"message": "Bad credentials"})
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n)) if n else None
        self.send(*answer(self.command, self.path, body))
    do_GET = do_PUT = do_DELETE = go
    def send(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *args):
        pass
server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
print(f"port {server.server_port}", flush=True)
server.serve_forever()
`;

async function wallets(s) {
  const state = path.join(s.root, 'gh-state');
  await mkdir(path.join(state, 'contents'), { recursive: true });
  await writeFile(path.join(state, 'repos.json'), JSON.stringify({ 'me/keys': true, 'me/open': false }));
  const bin = path.join(s.root, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'gh'), '#!/usr/bin/env python3\n' + FAKE_GH, { mode: 0o755 });
  const server = spawn('python3', ['-u', '-c', FAKE_API], { stdio: ['ignore', 'pipe', 'inherit'],
                                                              env: { ...process.env, FAKE_GH_DIR: state } });
  const port = await new Promise((resolve, reject) => {
    let text = '';
    server.stdout.on('data', (chunk) => {
      text += chunk;
      const m = /port (\d+)/.exec(text);
      if (m) resolve(Number(m[1]));
    });
    server.on('exit', () => reject(new Error('the double of GitHub stopped')));
  });
  return {
    state, stop: () => server.kill(),
    more: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GH_DIR: state, OPENSHEAF_PASSPHRASE: 'correct horse',
            OPENSHEAF_GITHUB_API: `http://127.0.0.1:${port}`, GITHUB_TOKEN: 'a-token', OPENSHEAF_UNLOCK: 'passphrase' },
  };
}

test('one wallet for both: keys put by either, read by the other', { skip }, async () => {
  const s = await sandbox();
  const w = await wallets(s);
  try {
    const more = w.more;
    const arch = path.join(s.root, 'arch');
    ok(s.py(['init', arch, '--name', 'Papers', '--base-url', 'https://example.org/papers/', '--curator', 'Doe, Jane',
             '--new-owner', '--keys', 'github:me/keys', '--yes'], { more }), 'py init --keys');
    await both(s, arch, ['key', 'list'], { more });
    assert.match(said(s.js(['key', 'list'], { cwd: arch, more })), /holds 4 keys/);
    const show = ok(s.js(['owner', 'show', '--offline'], { cwd: arch, more }), 'js show').stdout;
    const did = /Current keys  (did:key:\S+)/.exec(show)[1];
    ok(s.js(['key', 'forget', did], { cwd: arch, more }), 'js forget');
    assert.match(ok(s.js(['key', 'pull'], { cwd: arch, more }), 'js pull').stdout, /Pulled 1 current key/);
    ok(s.js(['owner', 'rotate', '--keys', 'github:me/keys'], { cwd: arch, more }), 'js rotate from the wallet');
    await both(s, arch, ['key', 'list'], { more });
    ok(s.py(['owner', 'rotate', '--keys', 'github:me/keys'], { cwd: arch, more }), 'py rotate from the wallet');
    ok(s.py(['key', 'forget', '--from-wallet', '--used', '--yes'], { cwd: arch, more }), 'py forget --used');
    await both(s, arch, ['key', 'list'], { more });
    await both(s, arch, ['key', 'list', '--wallet', 'github:me/open'], { more, status: 0 });
    ok(s.js(['init', path.join(s.root, 'js'), '--name', 'J', '--base-url', 'https://example.org/j/', '--curator', 'Doe, Jane',
             '--new-owner', '--keys', 'github:me/keys', '--yes'], { more }), 'js init --keys');
    const jsArch = path.join(s.root, 'js');
    await both(s, jsArch, ['key', 'list'], { more });
    ok(s.py(['owner', 'rotate', '--keys', 'github:me/keys'], { cwd: jsArch, more }), 'py rotate with keys put by js');
    clean(s, arch, more);
    clean(s, jsArch, more);
  } finally {
    w.stop();
    await s.done();
  }
});

const PY_OPENS = `import sys
from opensheaf import keys
prf = bytes.fromhex(sys.argv[2])
for path in sys.argv[3:]:
    rk = keys.read_key(open(path).read(), keks={sys.argv[1]: keys.passkey_kek(prf)})
    print(rk.kind, rk.key.did)
`;

test('a key wallet set up by the Manager is read by both, and the Manager enrolls keys put by opensheaf-py', { skip },
     async () => {
  const s = await sandbox();
  const w = await wallets(s);
  try {
    const more = w.more;
    const gh = { api: more.OPENSHEAF_GITHUB_API, fetch: globalThis.fetch.bind(globalThis), token: async () => 'a-token' };
    const env = browserEnvironment({ assets: { templates: {} } });
    const cred = 'Y3JlZGVudGlhbC1vZi10aGUtdGVzdHM', prf = new Uint8Array(32).fill(5);
    const store = (owner) => path.join(s.root, 'xdg', 'opensheaf', 'keys', owner);
    const pyOpens = (owner, kids) => ok(s.run([path.join(path.dirname(PY), 'python3')],
      ['-c', PY_OPENS, cred, Buffer.from(prf).toString('hex'),
       ...kids.map((k) => path.join(w.state, 'contents', 'me', 'keys', owner, `${k}.key.enc`))]), 'py opens').stdout;
    ok(s.py(await initArgs('arch', path.join(s.root, 'keys'))), 'py init');
    const arch = path.join(s.root, 'arch');
    const owner = JSON.parse(await readFile(path.join(arch, 'osheaf.json'), 'utf-8')).owner;
    const { dids, versions } = await signers(new DiskStorage(arch), env);
    const [file] = await readdir(store(owner));
    await assert.rejects(checkWallet(new GitHubWallet('me/open', gh, [])), /not a private repository/);
    const wallet = new GitHubWallet('me/keys', gh, []);
    await checkWallet(wallet);
    assert.equal(passphraseConfirmed(await walletEntries(wallet, owner)), true);
    const key = await keyToPush(await readFile(path.join(store(owner), file), 'utf-8'), { owner, dids });
    assert.equal(await pushKey(wallet, owner, key, versions[key.did], 'correct horse'), true);
    key.seed.fill(0);
    const plan = await enrollPlan(wallet, owner);
    await openWithPassphrase(plan, 'correct horse', wallet.name);
    await enrollPasskey(wallet, plan, 'correct horse', cred, Uint8Array.from(prf));
    assert.equal(pyOpens(owner, [file.replace(/\.key$/, '')]), `current ${dids[0]}\n`);
    await both(s, arch, ['key', 'list', '--wallet', 'github:me/keys'], { more });
    assert.match(ok(s.py(['key', 'list', '--wallet', 'github:me/keys'], { cwd: arch, more }), 'py list').stdout,
                 /passkey \(unlock\.opensheaf\.org\)/);
    for (const [who, run] of [['py', s.py], ['js', s.js]]) {
      const elsewhere = { ...more, XDG_CONFIG_HOME: path.join(s.root, `xdg-${who}`) };
      assert.match(ok(run(['key', 'pull', '--wallet', 'github:me/keys'], { cwd: arch, more: elsewhere }), `${who} pull`).stdout,
                   /Pulled 1 current key/);
    }
    // the other way round: keys put by opensheaf-py, enrolled and unlocked by the Manager
    ok(s.py(['init', path.join(s.root, 'arch2'), '--name', 'Papers', '--base-url', 'https://example.org/p2/', '--curator',
             'Doe, Jane', '--new-owner', '--keys', 'github:me/keys', '--yes'], { more }), 'py init --keys');
    const arch2 = path.join(s.root, 'arch2');
    const owner2 = JSON.parse(await readFile(path.join(arch2, 'osheaf.json'), 'utf-8')).owner;
    const signing2 = await signers(new DiskStorage(arch2), env);
    const entries = await walletEntries(wallet, owner2);
    assert.equal(entries.length, 4);
    assert.equal(passphraseConfirmed(entries), false);
    await assert.rejects(checkPassphrase(entries, 'wrong horse', owner2, wallet.name), /not the passphrase/);
    await checkPassphrase(entries, 'correct horse', owner2, wallet.name);
    const plan2 = await enrollPlan(wallet, owner2);
    assert.equal(plan2.todo.length, 4);
    await openWithPassphrase(plan2, 'correct horse', wallet.name);
    await enrollPasskey(wallet, plan2, 'correct horse', cred, Uint8Array.from(prf));
    assert.equal(pyOpens(owner2, plan2.todo.map((e) => e.kid)).split('\n').filter(Boolean).length, 4);
    const [unlocked] = await openLocks(await walletLocks(wallet, owner2, signing2.dids), owner2, cred, Uint8Array.from(prf));
    assert.equal(unlocked.did, signing2.dids[0]);
    const [file2] = await readdir(store(owner2));
    const again = await keyToPush(await readFile(path.join(store(owner2), file2), 'utf-8'),
                                  { owner: owner2, dids: signing2.dids });
    assert.equal(await pushKey(wallet, owner2, again, 1, 'correct horse'), false);
    again.seed.fill(0);
    ok(s.py(['owner', 'rotate', '--keys', 'github:me/keys'], { cwd: arch2, more }), 'py rotate with keys the Manager enrolled');
    clean(s, arch2, more);
  } finally {
    w.stop();
    await s.done();
  }
});

test('key texts exported by either are imported by the other', { skip }, async () => {
  const s = await sandbox();
  try {
    ok(s.py(await initArgs('arch', path.join(s.root, 'keys'))), 'py init');
    const arch = path.join(s.root, 'arch');
    const pass = { OPENSHEAF_PASSPHRASE: 'correct horse' };
    for (const [from, to, extra] of [['py', 'js', []], ['js', 'py', []], ['py', 'js', ['--encrypt']], ['js', 'py', ['--encrypt']]]) {
      const text = ok(s[from](['key', 'export', '--stdout', ...extra], { cwd: arch, more: pass }), `${from} export`).stdout;
      assert.match(text, /^opensheaf-key-text\/0\.2\n/);
      const other = { ...pass, XDG_CONFIG_HOME: path.join(s.root, `xdg-${from}-${to}-${extra.length}`) };
      const r = ok(s[to](['key', 'import', '--stdin'], { cwd: arch, more: other, input: text }), `${to} import`);
      assert.match(r.stdout, /is now kept in a file of this computer\./);
      assert.match(ok(s[from](['owner', 'show', '--offline'], { cwd: arch, more: other }), 'show').stdout, /\(on this computer\)/);
    }
  } finally {
    await s.done();
  }
});

const PY_ROTATES = `import json, sys
from pathlib import Path
from opensheaf import core, keys, owners
root, created, add, passphrase, files, seeds = sys.argv[1:7]
core.configure(root)
owner = core.ARCHIVE["owner"]
log = core.key_log(owner)
signers = [keys.read_rotation_key(Path(f).read_text(encoding="utf-8"), passphrase or None).key for f in files.split(",")]
new = [keys.Key(bytes.fromhex(h)) for h in seeds.split(",")]
prev = log.latest()
log.rotate(signers, next_keys=new, next_threshold=min(prev.keys["nextThreshold"], len(new)), add=[add],
           message="Keys changed", user=core.depositor(), created=created)
owners.write_key_log(core.obj_dir(log.id), log)
core.write_discovery()
`;

const PY_FILES = `import json, sys
from opensheaf import keys
owner, version, seed = sys.argv[1], int(sys.argv[2]), bytes.fromhex(sys.argv[3])
key = keys.Key(seed)
print(json.dumps({"name": keys.rotation_file_name(owner, key), "text": keys.rotation_key_text(key, owner, version),
                  "sheet": keys.rotation_key_sheet(key, owner, version), "check": keys.sheet_check(seed)}))
`;

const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('a new current key made by the Manager: the version of opensheaf-py, byte for byte; rotation files across the two',
     { skip }, async () => {
  const s = await sandbox();
  const more = { OPENSHEAF_PASSPHRASE: 'correct horse' };
  const python = path.join(path.dirname(PY), 'python3');
  try {
    await papers(s);
    const k = (n) => path.join(s.root, n);
    ok(s.py(await initArgs('arch', k('k1'), { passphrase: true }), { more }), 'py init (locked rotation keys)');
    const arch = k('arch');
    ok(s.py(['deposit', 'paper', '../paper.tex', ...DEPOSIT, '--new'], { cwd: arch }), 'py deposit --new');
    const env = browserEnvironment({ assets: { templates: {} } });
    const plan = await signers(new DiskStorage(arch), env);
    assert.deepEqual([plan.number, plan.next.length, plan.nextThreshold], [1, 3, 2]);
    const k1 = await keyFiles(k('k1'));
    const given = await Promise.all(k1.map(async (f) => ({ name: path.basename(f), text: await readFile(f, 'utf-8') })));
    // the same version by both: the Manager's on one copy, opensheaf-py's on the other
    const current = await exampleKey('the Manager current key');
    const fresh = await Promise.all(['one', 'two', 'three'].map((x) => exampleKey(`the Manager rotation key ${x}`)));
    const created = '2026-11-21T10:00:00Z';
    await cp(arch, k('a'), { recursive: true });
    await cp(arch, k('b'), { recursive: true });
    ok(s.run([python], ['-c', PY_ROTATES, k('a'), created, current.did, 'correct horse', [k1[0], k1[2]].join(','),
                        fresh.map((x) => hex(x.seed)).join(',')]), 'py rotate');
    const sealed = await rotationKeysFromTexts([given[0], given[2]], plan, 'correct horse');
    const v = await rotateAdding(new DiskStorage(k('b')), env, plan, sealed, { add: current.did, next: fresh.map((x) => x.digest),
                                                                                 created });
    assert.deepEqual([v.number, v.dids], [2, [...plan.dids, current.did]]);
    const A = await filesOf(k('a')), B = await filesOf(k('b'));
    assert.deepEqual([...B.keys()].sort(), [...A.keys()].sort());
    for (const [p, bytes] of A) assert.deepEqual(B.get(p), bytes, p);
    clean(s, k('b'));
    // the files of the new rotation keys: those opensheaf-py writes
    const owner = plan.owner;
    const plain = await rotationFiles(await Promise.all(['one', 'two', 'three'].map((x) => exampleKey(`the Manager rotation key ${x}`))),
                                      owner, 2, null);
    for (const [n, f] of plain.entries()) {
      const theirs = JSON.parse(ok(s.run([python], ['-c', PY_FILES, owner, '2', hex(fresh[n].seed)]), 'py files').stdout);
      assert.deepEqual({ name: f.name, text: f.text, sheet: f.sheet, check: f.check }, theirs);
    }
    // the Manager's locked files sign the next version with opensheaf-py
    const made = await Promise.all([1, 2, 3].map((n) => exampleKey(`the Manager new rotation key ${n}`)));
    const locked = await rotationFiles(made, owner, 2, 'correct horse');
    assert.ok(made.every((x) => x.seed.every((b) => b === 0)));
    await mkdir(k('k2'));
    for (const f of locked) await writeFile(path.join(k('k2'), f.name), f.text);
    const added = await exampleKey('another current key');
    const v2 = await rotateAdding(new DiskStorage(arch), env, plan,
                                  await rotationKeysFromTexts([given[1], given[2]], plan, 'correct horse'),
                                  { add: added.did, next: locked.map((f) => f.digest) });
    assert.equal(v2.number, 2);
    clean(s, arch);
    const k2 = await keyFiles(k('k2'));
    ok(s.py(['owner', 'rotate', '--rotation-key', k2[0], '--rotation-key', k2[2], '--export', k('k3'), '--no-passphrase', '--yes'],
            { cwd: arch, more }), 'py owner rotate with the Manager\'s files');
    clean(s, arch);
    // and the Manager rotates with the files opensheaf-py exported in clear
    const plan3 = await signers(new DiskStorage(arch), env);
    assert.equal(plan3.number, 3);
    const k3 = await Promise.all((await keyFiles(k('k3'))).map(async (f) => ({ name: path.basename(f), text: await readFile(f, 'utf-8') })));
    await assert.rejects(rotationKeysFromTexts(given, plan3, 'correct horse'), /not a rotation key that v3 of the key log commits/);
    const v4 = await rotateAdding(new DiskStorage(arch), env, plan3, await rotationKeysFromTexts(k3.slice(1), plan3),
                                  { add: (await exampleKey('a fourth key')).did,
                                    next: (await Promise.all([4, 5, 6].map((n) => exampleKey(`k${n}`)))).map((x) => x.digest) });
    assert.equal(v4.number, 4);
    clean(s, arch);
  } finally {
    await s.done();
  }
});

test('a new current key made by the Manager with the rotation keys of the wallet; opensheaf-py goes on with them', { skip },
     async () => {
  const s = await sandbox();
  const w = await wallets(s);
  try {
    const more = w.more;
    const arch = path.join(s.root, 'arch');
    ok(s.py(['init', arch, '--name', 'Papers', '--base-url', 'https://example.org/papers/', '--curator', 'Doe, Jane',
             '--new-owner', '--keys', 'github:me/keys', '--yes'], { more }), 'py init --keys');
    const gh = { api: more.OPENSHEAF_GITHUB_API, fetch: globalThis.fetch.bind(globalThis), token: async () => 'a-token' };
    const env = browserEnvironment({ assets: { templates: {} } });
    const plan = await signers(new DiskStorage(arch), env);
    const wallet = new GitHubWallet('me/keys', gh, []);
    await checkWallet(wallet);
    const entries = await walletEntries(wallet, plan.owner);
    assert.deepEqual(walletRotationKeys(entries, plan.next).sort(), [...plan.next].sort());
    await assert.rejects(rotationKeysFromWallet(wallet, plan, 'wrong horse'), /wrong passphrase/);
    const sealed = await rotationKeysFromWallet(wallet, plan, 'correct horse');
    assert.equal(sealed.length, plan.nextThreshold);
    const current = await exampleKey('the Manager current key');
    const fresh = await Promise.all([1, 2, 3].map((n) => exampleKey(`the Manager wallet rotation key ${n}`)));
    await keepRotationKeys(wallet, plan.owner, fresh, plan.number + 1, 'correct horse');
    const v = await rotateAdding(new DiskStorage(arch), env, plan, sealed, { add: current.did, next: fresh.map((x) => x.digest) });
    assert.equal(await pushKey(wallet, plan.owner, current, v.number, 'correct horse'), true);
    clean(s, arch, more);
    const listed = ok(s.py(['key', 'list'], { cwd: arch, more }), 'py key list').stdout;
    assert.match(listed, new RegExp(`current +${current.did.slice(8, 16)}…${current.did.slice(-4)} +v2 +passphrase`));
    const elsewhere = { ...more, XDG_CONFIG_HOME: path.join(s.root, 'xdg-elsewhere') };
    assert.match(ok(s.py(['key', 'pull'], { cwd: arch, more: elsewhere }), 'py pull').stdout, /Pulled 2 current keys/);
    ok(s.py(['owner', 'rotate', '--keys', 'github:me/keys'], { cwd: arch, more }), 'py rotate with the Manager\'s rotation keys');
    clean(s, arch, more);
  } finally {
    w.stop();
    await s.done();
  }
});

const PY_SEALED = `import base64, sys
from nacl.public import PrivateKey, SealedBox
secret = PrivateKey(bytes.fromhex(sys.argv[1]))
if sys.argv[2] == "public":
    print(base64.b64encode(bytes(secret.public_key)).decode())
else:
    print(SealedBox(secret).decrypt(base64.b64decode(sys.argv[2])).decode())
`;

test('an owner made by the Manager: the key log of osheaf init --new-owner --key, byte for byte; its rotation files',
     { skip }, async () => {
  const s = await sandbox();
  const python = path.join(path.dirname(PY), 'python3');
  try {
    const k = (n) => path.join(s.root, n);
    const labels = ['manager owner current', ...[1, 2, 3].map((n) => `manager owner rotation ${n}`)];
    const make = async () => ({ current: await exampleKey(labels[0]), workflows: await exampleKey('manager owner workflows'),
                                rotation: await Promise.all(labels.slice(1).map((l) => exampleKey(l))) });
    const keys = await make();
    ok(s.py(['init', 'py', '--name', 'Papers of Jane Doe', '--base-url', 'https://example.org/papers/', '--curator', 'Doe, Jane',
             '--new-owner', '--key', keys.workflows.did, '--keeper', 'https://example.org/', '--export', k('k1'),
             '--yes', '--no-passphrase'],
            { more: { OSHEAF_TEST_KEYS: labels.join(','), PYTEST_CURRENT_TEST: 'parity' } }), 'py init --new-owner --key');
    const owner = JSON.parse(await readFile(path.join(k('py'), 'osheaf.json'), 'utf-8')).owner;
    const theirs = path.join(k('py'), 'ocfl', owner, owner);
    const genesis = JSON.parse(await readFile(path.join(theirs, 'v1', 'content', 'genesis.json'), 'utf-8'));
    const log = await ownerKeyLog(keys, { keeper: 'https://example.org/', created: genesis.created, nonce: genesis.nonce });
    assert.equal(log.owner, owner);
    const { storage } = await keyLogFolder(log);
    const A = await filesOf(theirs);
    assert.deepEqual([...storage.files.keys()].sort(), [...A.keys()].sort());
    for (const [p, bytes] of A) assert.deepEqual(Buffer.from(await storage.read(p)), bytes, p);
    // the rotation files in clear: those opensheaf-py exported
    const plain = await rotationFiles((await make()).rotation, owner, 1, null);
    const exported = await keyFiles(k('k1'));
    assert.deepEqual(plain.map((f) => f.name).sort(), exported.map((f) => path.basename(f)));
    for (const f of plain) assert.equal(f.text, await readFile(path.join(k('k1'), f.name), 'utf-8'));
    // the archive set up by the Manager with that owner; its locked rotation files sign with opensheaf-py
    const templates = Object.fromEntries(await Promise.all((await readdir(path.join(HERE, '..', 'templates'))).map(async (n) =>
      [n, await readFile(path.join(HERE, '..', 'templates', n), 'utf-8')])));
    const schemas = await loadSchemas(async (url) => JSON.parse(await readFile(fileURLToPath(url), 'utf-8')));
    const env = browserEnvironment({ assets: { templates }, keys: new Map([[owner, [await signingCopy(keys.current)]]]),
                                     fetch: async (url) => { throw new TypeError(`no network in the tests: ${url}`); } });
    await mkdir(k('m'));
    const answer = await carryOut(new DiskStorage(k('m')), env, 'setup',
                                  { Name: 'Papers of Jane Doe', Curator: 'Doe, Jane', 'Base URL': 'https://example.org/papers/' },
                                  {}, { keyLog: await keyLogFolder(log), schemas });
    assert.equal(answer.ok, true, answer.message);
    clean(s, k('m'));
    const locked = await rotationFiles(keys.rotation, owner, 1, 'correct horse');
    await mkdir(k('k2'));
    for (const f of locked) await writeFile(path.join(k('k2'), f.name), f.text);
    const files = await keyFiles(k('k2'));
    ok(s.py(['owner', 'rotate', '--rotation-key', files[0], '--rotation-key', files[2], '--export', k('k3'),
             '--no-passphrase', '--yes'], { cwd: k('m'), more: { OPENSHEAF_PASSPHRASE: 'correct horse' } }),
       'py owner rotate with the Manager\'s files');
    const found = clean(s, k('m'));
    assert.ok(found.some((f) => /key log of .*: latest version v2$/.test(f)), found.join('\n'));
    // the secret of the workflows, sealed for GitHub, opened by PyNaCl
    const recipient = Buffer.alloc(32, 7).toString('hex');
    const pk = ok(s.run([python], ['-c', PY_SEALED, recipient, 'public']), 'py public key').stdout.trim();
    const line = seedLine(keys.workflows);
    const sealed = await sealedBox(new TextEncoder().encode(line), new Uint8Array(Buffer.from(pk, 'base64')));
    assert.equal(sealed.length, 32 + 16 + line.length);
    const opened = ok(s.run([python], ['-c', PY_SEALED, recipient, Buffer.from(sealed).toString('base64')]), 'py open').stdout.trim();
    assert.equal(opened, line);
  } finally {
    await s.done();
  }
});

test('the wallets of each owner, by both', { skip }, async () => {
  const s = await sandbox();
  const w = await wallets(s);
  try {
    await writeFile(path.join(w.state, 'repos.json'), JSON.stringify({ 'me/keys': true, 'me/other': true, 'me/open': false }));
    const more = w.more;
    const arch = path.join(s.root, 'arch');
    ok(s.py(['init', arch, '--name', 'Papers', '--base-url', 'https://example.org/papers/', '--curator', 'Doe, Jane',
             '--new-owner', '--keys', 'github:me/keys', '--yes'], { more }), 'py init --keys');
    ok(s.py(['owner', 'init', '--keys', 'github:me/other', '--yes'], { cwd: arch, more }), 'py owner init --keys');
    const cfgOf = (d) => readFile(path.join(d, 'osheaf.json'), 'utf-8');
    const second = JSON.parse(await cfgOf(arch)).owners[0];
    await both(s, arch, ['key', 'wallet'], { more });
    await both(s, arch, ['key', 'wallet', '--owner', second], { more });
    let r = await both(s, arch, ['key', 'wallet', '--add', 'github:me/other'], { more });
    assert.equal(await cfgOf(r.b), await cfgOf(r.a));
    r = await both(s, arch, ['key', 'wallet', '--remove', 'github:me/keys'], { more });
    assert.equal(await cfgOf(r.b), await cfgOf(r.a));
    await both(s, arch, ['key', 'wallet', '--add', 'command'], { more, status: 1 });
    for (const [d, run] of [['pa', s.py], ['ja', s.js]]) {
      await cp(arch, path.join(s.root, d), { recursive: true });
      ok(run(['key', 'push', '--wallet', 'github:me/other'], { cwd: path.join(s.root, d), more }), `${d} key push`);
    }
    assert.equal(await cfgOf(path.join(s.root, 'ja')), await cfgOf(path.join(s.root, 'pa')));
    assert.deepEqual(JSON.parse(await cfgOf(path.join(s.root, 'pa'))).keys[second], { wallets: ['github:me/other'] });
    const mine = (d) => ({ ...more, XDG_CONFIG_HOME: path.join(s.root, d) });
    const p = ok(s.py(['key', 'wallets', '--add', 'github:me/keys'], { cwd: arch, more: mine('xp') }), 'py wallets --add');
    const j = ok(s.js(['key', 'wallets', '--add', 'github:me/keys'], { cwd: arch, more: mine('xj') }), 'js wallets --add');
    assert.equal(said(j).replace('/xj/', '/xp/'), said(p));
    const user = (d) => readFile(path.join(s.root, d, 'opensheaf', 'config.json'), 'utf-8');
    assert.equal(await user('xj'), await user('xp'));
    const lp = ok(s.py(['key', 'wallets'], { cwd: arch, more: mine('xp') }), 'py wallets').stdout;
    const lj = ok(s.js(['key', 'wallets'], { cwd: arch, more: mine('xj') }), 'js wallets').stdout;
    assert.equal(lj.replaceAll('/xj/', '/xp/'), lp);
    assert.match(lp, /^github:me\/keys \(osheaf\.json\):\n  \S+  4 keys  passphrase\ngithub:me\/other \(osheaf\.json\):\n/);
  } finally {
    w.stop();
    await s.done();
  }
});

async function sameFiles(a, b) {
  const A = await filesOf(a), B = await filesOf(b);
  assert.deepEqual([...B.keys()].sort(), [...A.keys()].sort());
  for (const [p, bytes] of A) assert.deepEqual(B.get(p), bytes, p);
}

test('labels changed by both', { skip }, async () => {
  const s = await sandbox();
  try {
    await papers(s);
    ok(s.py(await initArgs('arch', path.join(s.root, 'keys'))), 'py init');
    const arch = path.join(s.root, 'arch');
    for (const label of ['one', 'two']) {
      ok(s.py(['deposit', label, '../paper.tex', ...DEPOSIT, '--new'], { cwd: arch }), `py deposit ${label}`);
    }
    ok(s.py(['collect'], { cwd: arch }), 'py collect');
    await mkdir(path.join(arch, 'site', 'one'), { recursive: true });
    await writeFile(path.join(arch, 'site', 'one', 'one.html'), '<img src="one-1.png">');
    await writeFile(path.join(arch, 'site', 'one', 'one-1.png'), 'png');
    const owner = JSON.parse(await readFile(path.join(arch, 'osheaf.json'), 'utf-8')).owner;
    const steps = [['label', 'one', 'first'], ['label', 'first', 'premier'], ['label', 'main', 'papers'],
                   ['label', '--owner', owner, 'jane-doe'], ['label', '--owner', owner, '--unset'],
                   ['label', 'two', '--unset']];
    let base = arch;
    for (const step of steps) {
      const r = await both(s, base, step);
      await sameFiles(r.a, r.b);
      await rm(path.join(s.root, 'next'), { recursive: true, force: true });
      await cp(r.a, path.join(s.root, 'next'), { recursive: true });
      base = path.join(s.root, 'next');
    }
    const files = await filesOf(base);
    assert.match(files.get('paper/one/index.html').toString(), /url=\.\.\/premier\//);
    assert.match(files.get('site/one/one.html').toString(), /url=\.\.\/premier\/premier\.html/);
    assert.equal(files.get('site/premier/one-1.png').toString(), 'png');
    const disc = JSON.parse(files.get('opensheaf.json'));
    assert.equal(disc.owners[0].catalogue, disc.objects.find((o) => o.label === 'papers').id);
    assert.equal('mainCollection' in JSON.parse(files.get('osheaf.json')), false);
    for (const bad of [['label', 'premier', 'papers'], ['label', 'premier', 'Bad'], ['label', 'premier']]) {
      await both(s, base, bad, { status: 1 });
    }
    const r = await both(s, base, ['takedown', 'premier', '--reason', 'At the request of the holder of the rights.', '--yes']);
    await sameFiles(r.a, r.b);
    assert.deepEqual(verified(s, r.a).filter((f) => !f.startsWith('result: ')), []);
  } finally {
    await s.done();
  }
});

async function archiveBy(s, tool, name) {
  ok(s[tool](['init', name, '--name', name, '--base-url', `https://example.org/${name}/`, '--curator', 'Doe, Jane',
              '--new-owner', '--export', path.join(s.root, `${name}-keys`), '--yes', '--no-passphrase']), `${tool} init ${name}`);
  return path.join(s.root, name);
}

async function paper(s, tool, root, label, text, more = [], rights = 'cc-by-4.0') {
  await s.file(`${label}.pdf`, `%PDF-1.4 ${text}`);
  return ok(s[tool](['deposit', label, '--pdf', path.join(s.root, `${label}.pdf`), '--no-source', 'x', '--title', label,
                     '--author', 'Doe, J', '--issued', '2020-01-01', '--rights', rights, ...more], { cwd: root }),
            `${tool} deposit ${label}`);
}

async function headFile(root, id, logical) {
  const [, name, owner] = id.split(':');
  const dir = path.join(root, 'ocfl', owner, name);
  const inv = JSON.parse(await readFile(path.join(dir, 'inventory.json'), 'utf-8'));
  const state = inv.versions[inv.head].state;
  const d = Object.keys(state).find((k) => state[k].includes(logical));
  return readFile(path.join(dir, inv.manifest[d][0]));
}

async function headJson(root, id, logical = 'object.json') {
  return JSON.parse(new TextDecoder().decode(await headFile(root, id, logical)));
}

async function idOf(root, label) {
  return JSON.parse(await readFile(path.join(root, 'opensheaf.json'), 'utf-8')).objects.find((o) => o.label === label).id;
}

function at(name) {
  return `at=${encodeURIComponent(`https://example.org/${name}/`)}`;
}

async function across() {
  const s = await sandbox();
  const server = await serve(s.root);
  const more = { OPENSHEAF_LOCATIONS: `https://example.org/=${server.url}` };
  const run = (tool) => (args, options = {}) => s[tool](args, { ...options, more: { ...more, ...(options.more || {}) } });
  return { ...s, server, more, js: run('js'), py: run('py'), done: async () => { server.stop(); await s.done(); } };
}

function json(r) {
  return JSON.parse(r.stdout);
}

async function sameWithSelection(a, b, selection) {
  const [, , owner] = selection.split(':'), name = selection.split(':')[1];
  const dir = `ocfl/${owner}/${name}/`;
  await sameArchives(a, b, (p) => p.startsWith(dir));
  const headOf = async (root) => JSON.parse(await readFile(path.join(root, 'opensheaf.json'), 'utf-8'))
    .objects.find((o) => o.id === selection).head;
  assert.equal(await headOf(b), await headOf(a));
  const members = async (root) => {
    const inv = JSON.parse(await readFile(path.join(root, 'ocfl', owner, name, 'inventory.json'), 'utf-8'));
    const state = inv.versions[inv.head].state;
    const d = Object.keys(state).find((k) => state[k].includes('members.json'));
    return (await readFile(path.join(root, 'ocfl', owner, name, inv.manifest[d][0]), 'utf-8'))
      .replace(/"inventorySha512": "[0-9a-f]*"/g, '"inventorySha512": "-"');
  };
  assert.equal(await members(b), await members(a));
}

test('resolve and mirror across archives, by both', { skip }, async () => {
  const s = await across();
  try {
    const authors = await archiveBy(s, 'js', 'authors'), lib = await archiveBy(s, 'py', 'lib');
    await paper(s, 'js', authors, 'paper', 'one', ['--new']);
    await paper(s, 'js', authors, 'paper', 'two');
    await paper(s, 'js', authors, 'closed', 'closed', ['--new'], 'All rights reserved');
    const id = await idOf(authors, 'paper'), [, name, owner] = id.split(':');
    for (const uri of [`${id}?${at('authors')}`, `sheaf:${name}/v1?${at('authors')}`, `sheaf:${name.slice(0, 12)}?${at('authors')}`,
                       `sheaf:${owner}?${at('authors')}`, `${id}/v9?${at('authors')}`]) {
      const p = s.py(['resolve', uri, '--json'], { cwd: lib }), j = s.js(['resolve', uri, '--json'], { cwd: lib });
      assert.equal(j.status, p.status, uri);
      assert.deepEqual(json(j), json(p), uri);
    }
    const outside = ['resolve', `sheaf:${name}`, '--at', 'https://example.org/authors/', '--json'];
    assert.deepEqual(json(ok(s.js(outside), 'js resolve')), json(ok(s.py(outside), 'py resolve')));
    assert.equal(json(s.js(outside)).status, 'verified');
    const closed = await both(s, lib, ['mirror', `${await idOf(authors, 'closed')}?${at('authors')}`], { more: s.more });
    await sameArchives(closed.a, closed.b);
    let { a, b } = await both(s, lib, ['mirror', `${id}?${at('authors')}`, '--label', 'copy'], { more: s.more });
    assert.deepEqual(await filesOf(path.join(b, 'ocfl', owner, name)), await filesOf(path.join(authors, 'ocfl', owner, name)));
    await sameArchives(a, b);
    assert.deepEqual(verified(s, b, s.more).filter((f) => !f.startsWith('result')), []);
    ok(s.py(['mirror', `${id}?${at('authors')}`, '--label', 'copy'], { cwd: lib }), 'py mirror');
    await paper(s, 'js', authors, 'paper', 'three');
    await paper(s, 'py', authors, 'paper', 'four');
    await rm(path.join(authors, 'ocfl', owner, name, 'extensions', 'opensheaf-witnesses', 'v4'), { recursive: true });
    ({ a, b } = await both(s, lib, ['mirror', '--all'], { more: s.more }));
    await sameArchives(a, b);
    assert.equal(JSON.parse(await readFile(path.join(b, 'ocfl', owner, name, 'inventory.json'), 'utf-8')).head, 'v3');
    assert.deepEqual(verified(s, a, s.more).filter((f) => !f.startsWith('result')), []);
  } finally {
    await s.done();
  }
});

test('accept and branch across archives, by both', { skip }, async () => {
  const s = await across();
  try {
    const authors = await archiveBy(s, 'py', 'authors'), journal = await archiveBy(s, 'js', 'journal');
    const bb = await archiveBy(s, 'py', 'bb');
    await paper(s, 'py', authors, 'work', 'one', ['--new']);
    await paper(s, 'py', authors, 'work', 'two');
    ok(s.js(['collection', 'new', 'issue-1', '--type', 'selection', '--title', 'Issue 1'], { cwd: journal }), 'js new');
    const id = await idOf(authors, 'work');
    const v = (n) => `${id}/v${n}?${at('authors')}`;
    const selection = await idOf(journal, 'issue-1');
    let { a, b } = await both(s, journal, ['accept', v(2), '--selection', 'issue-1', '--label', 'work', '--with-original'],
                              { more: s.more });
    await sameWithSelection(a, b, selection);
    for (const where of [a, b]) {
      const found = verified(s, where, s.more, true);
      assert.deepEqual(found.filter((f) => f.startsWith('error')), [], found.join('\n'));
      assert.ok(found.some((f) => /work: a branch of .*: confirmed \(section 9\.3\)/.test(f)), found.join('\n'));
      assert.ok(found.some((f) => /the parent's line: verified at https:\/\/example.org\/authors\//.test(f)), found.join('\n'));
    }
    ok(s.js(['accept', v(2), '--selection', 'issue-1', '--label', 'work', '--with-original'], { cwd: journal }), 'js accept');
    const accepted = await idOf(journal, 'work');
    let obj = await headJson(journal, accepted);
    assert.ok(obj.documentVersion === 1 && obj.parent.documentVersion === 2 && !('notices' in obj));
    await paper(s, 'py', authors, 'work', 'three');
    await s.file('remark.md', 'Accepted with a remark.');
    ok(s.js(['notice', 'work', '--about', '1', '--text', 'A remark.', '--file', path.join(s.root, 'remark.md')],
            { cwd: journal }), 'js notice');
    ({ a, b } = await both(s, journal, ['accept', v(3), '--selection', 'issue-1'], { more: s.more }));
    await sameWithSelection(a, b, selection);
    for (const where of [a, b]) {
      obj = await headJson(where, accepted);
      assert.ok(obj.documentVersion === 2 && obj.parent.documentVersion === 3 && obj.parent.objectVersion === 'v3');
      assert.equal(obj.notices[0].text, 'A remark.');
      assert.equal(new TextDecoder().decode(await headFile(where, accepted, obj.notices[0].path)), 'Accepted with a remark.');
      assert.deepEqual(verified(s, where, s.more).filter((f) => f.startsWith('error')), []);
    }
    ok(s.py(['accept', v(3), '--selection', 'issue-1'], { cwd: journal }), 'py accept');
    await both(s, journal, ['accept', v(3), '--selection', 'issue-1'], { more: s.more, status: 1 });
    ({ a, b } = await both(s, bb, ['branch', `${accepted}/v2?${at('journal')}`, '--label', 'continued'], { more: s.more }));
    await sameArchives(a, b);
    const found = verified(s, a, s.more);
    assert.ok(found.some((f) => /continued: a branch of .*: confirmed/.test(f)), found.join('\n'));
    await both(s, authors, ['branch', `${accepted}/v2?${at('journal')}`, '--label', 'back'], { more: s.more, status: 1 });
  } finally {
    await s.done();
  }
});

test('drafts, seals and takedowns, by both', { skip }, async () => {
  const s = await across();
  try {
    const authors = await archiveBy(s, 'py', 'authors'), lib = await archiveBy(s, 'js', 'lib');
    await paper(s, 'py', authors, 'paper', 'one', ['--new']);
    const id = await idOf(authors, 'paper'), owner = id.split(':')[2];
    const pdf = path.join(s.root, 'd.pdf');
    const draft = ['--pdf', pdf, '--no-source', 'x', '--title', 'Notes', '--author', 'Doe, J'];
    await s.file('d.pdf', '%PDF-1.4 draft one');
    let { a, b } = await both(s, authors, ['draft', 'new', 'notes', ...draft]);
    await sameArchives(a, b);
    ok(s.py(['draft', 'new', 'notes', ...draft], { cwd: authors }), 'py draft new');
    await s.file('d.pdf', '%PDF-1.4 draft two');
    ok(s.js(['draft', 'deposit', 'notes', ...draft], { cwd: authors }), 'js draft deposit');
    await s.file('d.pdf', '%PDF-1.4 draft two, corrected');
    ({ a, b } = await both(s, authors, ['draft', 'deposit', 'notes', ...draft, '--replace']));
    await sameArchives(a, b);
    verified(s, b);
    ({ a, b } = await both(s, authors, ['seal', 'notes', '--label', 'lecture-notes']));
    await sameNewWork(a, b, 'lecture-notes');
    verified(s, a);
    ({ a, b } = await both(s, authors, ['draft', 'delete', 'notes']));
    await sameArchives(a, b);
    ok(s.js(['mirror', `${id}?${at('authors')}`, '--label', 'copy'], { cwd: lib }), 'js mirror');
    ({ a, b } = await both(s, lib, ['takedown', id, '--reason', 'Stopped keeping it.', '--yes']));
    await sameArchives(a, b);
    verified(s, b);
    ok(s.py(['takedown', id, '--reason', 'Stopped keeping it.', '--yes'], { cwd: lib }), 'py takedown');
    ({ a, b } = await both(s, lib, ['mirror', `${id}?${at('authors')}`], { more: s.more }));
    await sameArchives(a, b);
    assert.equal(JSON.parse(await readFile(path.join(b, 'opensheaf.json'), 'utf-8')).tombstones, undefined);
    assert.deepEqual(verified(s, a).filter((f) => !f.startsWith('result')), []);
    ({ a, b } = await both(s, authors, ['takedown', 'paper', '--reason', 'At the request of the holder of the rights.', '--yes']));
    await sameArchives(a, b);
    for (const where of [a, b]) {
      const found = verified(s, where);
      assert.deepEqual(found.filter((f) => f.startsWith('error')), [], found.join('\n'));
      assert.ok(found.some((f) => f.startsWith(`result: opensheaf.json: removed: ${id}`)));
    }
    await both(s, authors, ['takedown', `sheaf:${owner}:${owner}`, '--reason', 'x', '--yes'], { status: 1 });
    await both(s, authors, ['takedown', 'paper', '--reason', 'x', '--by-law', '--keeper', '--yes'], { status: 2 });
    ({ a, b } = await both(s, authors, ['takedown', `sheaf:${owner}:${owner}`, '--reason', 'A court order.', '--by-law', '--yes']));
    await sameArchives(a, b);
    const unchecked = verified(s, a);
    assert.ok(unchecked.some((f) => /signature-.*: unchecked/.test(f)), unchecked.join('\n'));
    verified(s, b);
  } finally {
    await s.done();
  }
});

test('owner catalogues, by both', { skip }, async () => {
  const s = await across();
  try {
    const arch = await archiveBy(s, 'py', 'oc');
    const json = async (root, p) => JSON.parse(await readFile(path.join(root, p), 'utf-8'));
    const head = async (root, id) => (await json(root, `ocfl/${id.split(':')[2]}/${id.split(':')[1]}/inventory.json`)).head;
    await paper(s, 'py', arch, 'paper', 'one', ['--new']);
    ok(s.py(['collect'], { cwd: arch }), 'py collect');
    ok(s.py(['owner', 'init', '--export', path.join(s.root, 'second-keys'), '--no-passphrase', '--yes'], { cwd: arch }),
       'py owner init');
    const cfg = await json(arch, 'osheaf.json');
    const [first, second] = [cfg.owner, cfg.owners[0]];
    let disc = await json(arch, 'opensheaf.json');
    assert.deepEqual(disc.owners.map((e) => e.owner), [first, second]);
    assert.equal('mainCollection' in disc, false);
    const [cat1, cat2] = disc.owners.map((e) => e.catalogue);
    assert.equal(cat1, await idOf(arch, 'main'));
    assert.equal(cat2.split(':')[2], second);
    assert.equal(disc.objects.find((o) => o.id === cat2).label, undefined);
    assert.equal(await head(arch, cat2), 'v1');
    let { a, b } = await both(s, arch, ['label', '--owner', second, 'jane'], { more: s.more });
    for (const where of [a, b]) {
      assert.equal((await json(where, 'opensheaf.json')).objects.find((o) => o.id === cat2).label, 'jane-catalogue');
    }
    assert.equal(await readFile(path.join(b, 'osheaf.json'), 'utf-8'), await readFile(path.join(a, 'osheaf.json'), 'utf-8'));
    ok(s.py(['label', '--owner', second, 'jane'], { cwd: arch }), 'py label');
    const head1 = await head(arch, cat1);
    await paper(s, 'py', arch, 'theirs', 'two', ['--new', '--owner', second]);
    ok(s.py(['branch', `${await idOf(arch, 'paper')}/v1`, '--owner', second, '--label', 'continued'], { cwd: arch }),
       'py branch');
    ({ a, b } = await both(s, arch, ['collect', '--owner', second], { more: s.more }));
    await sameArchives(a, b);
    assert.equal(await head(b, cat1), head1);
    assert.equal(await head(b, cat2), 'v2');
    const collected = path.join(s.root, 'collected');
    await cp(a, collected, { recursive: true });
    await both(s, collected, ['collect', '--owner', 'a'.repeat(51) + 'q'], { more: s.more, status: 1 });
    ({ a, b } = await both(s, collected, ['collect'], { more: s.more }));
    await sameArchives(a, b);
    assert.equal(await head(b, cat1), head1);
    const members = await json(b, `ocfl/${second}/${cat2.split(':')[1]}/v2/content/members.json`);
    assert.deepEqual(members.members.map((m) => m.owner), [second, second]);
    ok(s.js(['index'], { cwd: b }), 'js index');
    assert.deepEqual(verified(s, b, s.more).filter((f) => f.startsWith('error')), []);
    const own = await json(b, `ocfl/${first}/${cat1.split(':')[1]}/${head1}/content/members.json`);
    const theirs = await idOf(b, 'theirs');
    const p1 = own.members[0].inventorySha512.slice(0, 32);
    const p2 = members.members.find((m) => `sheaf:${m.name}:${m.owner}` === theirs).inventorySha512.slice(0, 32);
    const homes = async (dir) => {
      ({ a, b } = await both(s, dir, ['index'], { more: s.more }));
      const page = await readFile(path.join(a, 'index.html'), 'utf-8');
      assert.equal(await readFile(path.join(b, 'index.html'), 'utf-8'), page);
      return page;
    };
    let home = await homes(collected);
    assert.ok(home.includes(p1) && home.includes(p2) && !home.includes('owner-heading'));
    assert.ok(home.includes(`<a class="owner" href="owner/${second}/">jane</a>`));
    const grouped = path.join(s.root, 'grouped');
    await cp(collected, grouped, { recursive: true });
    const gcfg = await json(grouped, 'osheaf.json');
    gcfg.index = { ...gcfg.index, owners: 'by-owner' };
    await writeFile(path.join(grouped, 'osheaf.json'), JSON.stringify(gcfg, null, 2) + '\n');
    home = await homes(grouped);
    const h = [...home.matchAll(/<h2 class="owner-heading">/g)].map((m) => m.index);
    assert.equal(h.length, 2);
    assert.ok(h[0] < home.indexOf(p1) && home.indexOf(p1) < h[1] && h[1] < home.indexOf(p2));
    disc = await json(b, 'opensheaf.json');
    const write = (d) => writeFile(path.join(b, 'opensheaf.json'), JSON.stringify(d));
    await write({ ...disc, owners: [disc.owners[0], { owner: second, catalogue: cat1 }, { owner: first, catalogue: cat2 }] });
    const errors = verified(s, b, s.more).filter((f) => f.startsWith('error'));
    assert.ok(errors.some((f) => f.includes(`the catalogue of ${second} in owners`)), errors.join('\n'));
    assert.ok(errors.some((f) => f.includes(`owners lists ${first} twice`)), errors.join('\n'));
    await write({ ...disc, owners: [...disc.owners].reverse() });
    assert.deepEqual(verified(s, b, s.more).filter((f) => f.startsWith('error')), []);
    await write({ ...disc, owners: undefined });
    for (const by of [s.py, s.js]) {   // the schema's message is worded by each validator
      const missing = findings(by(['verify', '--json'], { cwd: b, more: s.more })).filter((f) => f.startsWith('error'));
      assert.ok(missing.some((f) => f.includes('no owners')), missing.join('\n'));
    }
  } finally {
    await s.done();
  }
});

import { main as jsMain } from '../cli/osheaf.js';

const FAKE_TOKEN = 'fake-token-of-the-tests';
const GUARD = `
import os, socket, sys, time, urllib.parse, urllib.request
FAKE = os.environ["OSHEAF_FAKE_HOSTS"]
assert FAKE.startswith("http://127.0.0.1:"), FAKE
real = urllib.request.OpenerDirector.open
def guarded(self, req, *a, **k):
    if isinstance(req, str):
        req = urllib.request.Request(req)
    u = urllib.parse.urlsplit(req.full_url)
    if u.hostname != "127.0.0.1":
        req.full_url = FAKE + u.netloc + u.path + ("?" + u.query if u.query else "")
        req.add_header("X-osheaf-guarded", "1")
    if urllib.parse.urlsplit(req.full_url).hostname != "127.0.0.1":
        raise SystemExit("a test reached for the network: " + req.full_url)
    return real(self, req, *a, **k)
urllib.request.OpenerDirector.open = guarded
resolve = socket.getaddrinfo
def loopback_only(host, *a, **k):
    if host not in ("127.0.0.1", b"127.0.0.1"):
        raise SystemExit(f"a test reached for the network: {host!r}")
    return resolve(host, *a, **k)
socket.getaddrinfo = loopback_only
time.sleep = lambda s: None
from opensheaf.cli import main
sys.exit(main(sys.argv[1:]))
`;

function pythonOf(command) {
  const text = spawnSync('head', ['-c', '2000', command], { encoding: 'utf-8' }).stdout || '';
  const m = /exec' '([^']+)'/.exec(text) || /^#!\s*(\S+)/.exec(text);
  return process.env.OSHEAF_PY_PYTHON || (m ? m[1] : 'python3');
}

async function startServices(fixtures) {
  await mkdir(fixtures, { recursive: true });
  const isDeno = typeof globalThis.Deno !== 'undefined';
  const script = path.join(HERE, 'fake-services.js');
  const server = spawn(process.execPath, [...(isDeno ? ['run', '-A'] : []), script, fixtures],
                       { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let text = '';
    server.stdout.on('data', (chunk) => {
      text += chunk;
      const m = /port (\d+)/.exec(text);
      if (m) resolve(Number(m[1]));
    });
    server.on('error', reject);
    server.on('exit', () => reject(new Error('the double of the services stopped')));
  });
  const url = `http://127.0.0.1:${port}/`;
  return {
    url,
    stop: () => server.kill(),
    calls: async (host = null) => (await (await fetch(url + '_calls')).json()).filter((c) => !host || c.host === host),
    mismatch: async (host) => (await fetch(url + '_mismatch/' + host, { method: 'POST' })).text(),
  };
}

function zenodoVars(server, production) {
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'the double of Zenodo is on this computer');
  return { ZENODO_TOKEN: FAKE_TOKEN, ZENODO_SANDBOX_TOKEN: FAKE_TOKEN, OSHEAF_FAKE_HOSTS: server.url,
           OPENSHEAF_ZENODO_API: `${server.url}${production ? '' : 'sandbox.'}zenodo.org/api` };
}

function withServer(s, server) {
  const vars = (args) => zenodoVars(server, args.includes('--production'));
  return {
    py: (args, { cwd = s.root } = {}) => s.run([pythonOf(PY), '-c', GUARD], args, { cwd, more: vars(args) }),
    js: (args, { cwd = s.root } = {}) => s.js(args, { cwd, more: vars(args) }),
  };
}

function zenodoCalls(calls) {
  for (const c of calls) assert.ok(!c.host.includes('zenodo') || c.body === undefined || c.method !== 'GET');
  return calls.map(({ method, path: p, body }) => ({ method, path: p, body }));
}

function saidOf(r) {
  return said(r).replace(/sandbox: working on a copy in \S+/g, 'sandbox: working on a copy in -');
}

async function arxivFixtures(s, aid = '2611.00001') {
  const f = (p, text) => mkdir(path.dirname(path.join(s.root, 'fixtures', p)), { recursive: true })
    .then(() => writeFile(path.join(s.root, 'fixtures', p), text));
  const page = (n) => `<div class="metatable"><td class="tablecell comments mathjax">${n} pages, see ` +
    `<a href="https://example.org/data">https://example.org/data</a> &amp; the published version</td>` +
    `<div class="abs-license"><a href="http://creativecommons.org/licenses/by/4.0/" title="Rights">CC BY 4.0</a></div>`;
  await f('arxiv.org/a/doe_j_1.atom2', `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">` +
          `<entry><id>http://arxiv.org/abs/${aid}v2</id></entry></feed>`);
  await f(`oaipmh.arxiv.org/oai/oai_arXiv.org_${aid}`, RECORD(aid, ['v1', 'v2']));
  await f(`export.arxiv.org/pdf/${aid}v1`, '%PDF-1.4 one');
  await f(`export.arxiv.org/pdf/${aid}v2`, '%PDF-1.4 two');
  await f(`export.arxiv.org/e-print/${aid}v1`, tarGz([['paper/main.tex', MAIN_TEX], ['paper/fig.txt', 'a figure']]));
  await f(`arxiv.org/abs/${aid}v1`, page(10));
  await f(`arxiv.org/abs/${aid}v2`, page(11));
}

test('arXiv: the same downloads by both', { skip }, async () => {
  const s = await sandbox();
  const server = await startServices(path.join(s.root, 'fixtures'));
  try {
    await arxivFixtures(s);
    const two = withServer(s, server);
    const fetchJs = async (args) => {
      const out = [], err = [];
      const status = await jsMain(args, { out: (l) => out.push(l), err: (l) => err.push(l), arxivWait: 0,
                                          arxivFetch: (url, init) => fetch(server.url + url.replace(/^https:\/\//, ''), init) });
      return { status, stdout: out.join('\n') + '\n', stderr: err.join('\n') };
    };
    for (const round of [1, 2]) {
      const before = (await server.calls()).length;
      const p = ok(two.py(['arxiv', 'fetch', path.join(s.root, 'dl-py'), '--author', 'doe_j_1']), `py fetch ${round}`);
      const middle = (await server.calls()).length;
      const j = await fetchJs(['arxiv', 'fetch', path.join(s.root, 'dl-js'), '--author', 'doe_j_1']);
      assert.equal(j.status, 0, j.stderr);
      assert.equal(j.stdout, p.stdout);
      const calls = await server.calls();
      const asked = (list) => list.map((c) => `${c.method} ${c.host}${c.path}`);
      assert.deepEqual(asked(calls.slice(middle)), asked(calls.slice(before, middle)));
      assert.ok(middle - before >= (round === 1 ? 8 : 1), asked(calls.slice(before, middle)).join('\n'));
      if (round === 1) assert.match(p.stdout, /v2\.src ERROR HTTP Error 404: Not Found/);
    }
    const A = await filesOf(path.join(s.root, 'dl-py')), B = await filesOf(path.join(s.root, 'dl-js'));
    assert.deepEqual([...B.keys()].sort(), [...A.keys()].sort());
    const untimed = (b) => b.toString('utf-8').replace(/"fetched": "[^"]*"/g, '"fetched": "-"');
    for (const [p, bytes] of A) {
      if (p === 'download.json') assert.equal(untimed(B.get(p)), untimed(bytes));
      else assert.deepEqual(B.get(p), bytes, p);
    }
  } finally {
    server.stop();
    await s.done();
  }
});

const MAIN_TEX = '\\documentclass{article}\n\\newcommand{\\R}{\\mathbb{R}}\n\\def\\eps{\\varepsilon}\n' +
  '\\begin{document}Sheaves.\\end{document}\n';

function RECORD(aid, versions, { title = 'Sheaves on $\\R^2$ and It\\^o\'s formula', doi = '10.1000/j.x.1' } = {}) {
  const dates = ['Mon, 2 Nov 2026 10:00:00 GMT', 'Tue, 10 Nov 2026 11:30:00 GMT', 'Fri, 13 Nov 2026 09:00:00 GMT',
                 'Sat, 14 Nov 2026 09:00:00 GMT'];
  return `<?xml version="1.0"?>\n<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><GetRecord><record><metadata>\n` +
    `<arXivRaw xmlns="http://arxiv.org/OAI/arXivRaw/"><id>${aid}</id>\n` +
    versions.map((v, k) => `<version version="${v}"><date>${dates[k]}</date><size>10kb</size><source_type>D</source_type></version>\n`).join('') +
    `<title>${title}</title><authors>G\\"unter Doe (Paris, IHES), Jane van der Roe, and Richard Roe</authors>\n` +
    `<categories>math.PR math-ph</categories><comments>old</comments>` +
    `<license>http://creativecommons.org/licenses/by/4.0/</license>` +
    (doi ? `<doi>${doi}</doi><journal-ref>J. Sheaves 1 (2027) 1--10</journal-ref>` : '') +
    `<abstract>  We prove that $\\eps &lt; 1$ on $\\R^2$,\n  with \\emph{care} --- and $\\FF$.\n</abstract>` +
    `</arXivRaw></metadata></record></GetRecord></OAI-PMH>\n`;
}

async function importFixtures(dl, versions) {
  const f = (p, data) => mkdir(path.dirname(path.join(dl, p)), { recursive: true }).then(() => writeFile(path.join(dl, p), data));
  const a = 'papers/2611.00001', b = 'papers/2512.00002';
  const cc = 'http://creativecommons.org/licenses/by/4.0/', closed = 'http://arxiv.org/licenses/nonexclusive-distrib/1.0/';
  await f(`${a}/record.xml`, RECORD('2611.00001', versions));
  await f(`${a}/v1.pdf`, '%PDF-1.4 one');
  await f(`${a}/v1-source.tar.gz`, tarGz([['paper/main.tex', MAIN_TEX], ['paper/fig.txt', 'a figure'], ['../evil', 'x']]));
  await f(`${a}/v2.pdf`, '%PDF-1.4 two');
  await f(`${a}/v2-source.gz`, gzipped('\\documentclass{article}\\begin{document}Two.\\end{document}'));
  await f(`${a}/v3.pdf`, '%PDF-1.4 three');
  await f(`${a}/v3-source.pdf`, '%PDF-1.4 three, as a source');
  await f(`${a}/v4.pdf`, '%PDF-1.4 four');
  await f(`${a}/v4-source.gz`, gzipped('plain text, not TeX'));
  await f(`${b}/record.xml`, RECORD('2512.00002', ['v1'], { title: 'An older paper', doi: null })
    .replace('2 Nov 2026', '2 Dec 2025'));
  await f(`${b}/v1.pdf`, '%PDF-1.4 old');
  const licences = {};
  for (const v of ['v1', 'v2', 'v3', 'v4']) {
    licences[`2611.00001${v}`] = { licence: v === 'v1' ? closed : cc, comments: v === 'v3' ? 'the published version, 12 pages' : null };
  }
  licences['2512.00002v1'] = { licence: closed, comments: 'notes' };
  await f('version-licences.json', JSON.stringify(licences));
  await f('identifiers.json', JSON.stringify({ '2611.00001': 'sheaves', '2512.00002': 'older' }));
}

function gzipped(text) {
  return new Uint8Array(zlib.gzipSync(text));
}

test('arXiv: the same imports by both, and each updating what the other imported', { skip }, async () => {
  const s = await sandbox();
  try {
    const base = await archiveBy(s, 'py', 'base');
    const dl = path.join(s.root, 'dl');
    await importFixtures(dl, ['v1', 'v2', 'v3']);
    const args = ['arxiv', 'import', dl, '--agreement', 'deposited by an author', '--agreed-by', 'Doe, Jane'];
    const { a, b } = await both(s, base, args);
    await rename(a, path.join(s.root, 'by-py'));
    await rename(b, path.join(s.root, 'by-js'));
    const [pyArch, jsArch] = [path.join(s.root, 'by-py'), path.join(s.root, 'by-js')];
    await sameNewWork(pyArch, jsArch, 'sheaves');
    await sameNewWork(pyArch, jsArch, 'older');
    for (const where of [pyArch, jsArch]) {
      assert.deepEqual(verified(s, where).filter((f) => !f.startsWith('result')), []);
    }
    const line = await lineOf(jsArch, 'sheaves');
    assert.equal(JSON.parse(await readFile(path.join(line.dir, 'inventory.json'), 'utf-8')).head, 'v3');
    await importFixtures(dl, ['v1', 'v2', 'v3', 'v4']);
    for (const where of [pyArch, jsArch]) {
      const { a: pa, b: jb } = await both(s, where, ['arxiv', 'import', dl, '--update']);
      await sameArchives(pa, jb);
      assert.deepEqual(verified(s, jb).filter((f) => !f.startsWith('result')), []);
    }
    const other = path.join(s.root, 'other');
    await importFixtures(other, ['v1']);
    await writeFile(path.join(other, 'identifiers.json'), JSON.stringify({ '2611.00001': 'older' }));
    await both(s, path.join(s.root, 'base'), ['arxiv', 'import', dl, '2611.00001', '--dry-run']);
    await both(s, pyArch, ['arxiv', 'import', other], { status: 1 });
  } finally {
    await s.done();
  }
});

function corpus(seed) {
  let x = seed >>> 0 || 1;
  const next = () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296;
  const pick = (list) => list[Math.floor(next() * list.length)];
  const words = ['sheaf', 'object', 'version', 'archive', 'owner', 'catalogue', 'the', 'of', 'a', 'Zenodo', 'proof',
                 'lemma', '\\section', '\\begin{equation}', 'x_{n+1}', '=', '\n', '  '];
  const sizes = [0, 1, 2, 3, 100, 258, 1000, 32767, 32768, 32769, 65536, 100000, 300000];
  const kinds = {
    random: (n) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256)),
    words: (n) => new TextEncoder().encode(Array.from({ length: n }, () => pick(words)).join(' ').slice(0, n)),
    runs: (n) => Uint8Array.from({ length: n }, () => (next() < 0.5 ? 97 : 98)),
    noisy: (n) => Uint8Array.from({ length: n }, () => (next() < 0.05 ? Math.floor(next() * 256) : 65)),
    json: (n) => new TextEncoder().encode(JSON.stringify(Array.from({ length: n / 40 }, () => ({ k: next(), w: pick(words) })), null, 1)),
    repeats: (n) => { const unit = kinds.random(1 + Math.floor(next() * 300)); return Uint8Array.from({ length: n }, (_, i) => unit[i % unit.length]); },
  };
  const files = new Map();
  for (const [kind, make] of Object.entries(kinds)) for (const n of sizes) files.set(`${seed}/${kind}-${n}`, make(n));
  return files;
}

test('sources.zip: the bytes of opensheaf-py, compressed as zlib compresses, for files of every kind', { skip }, async () => {
  const s = await sandbox();
  try {
    const seed = Math.floor(Math.random() * 2 ** 32);
    const files = new Map([...corpus(20261124), ...corpus(seed)]);
    for (const dir of ['literate', 'core', 'schemas']) {
      for (const n of (await readdir(path.join(HERE, '..', dir))).sort()) {
        files.set(`${dir}/${n}`, new Uint8Array(await readFile(path.join(HERE, '..', dir, n))));
      }
    }
    const src = path.join(s.root, 'src');
    for (const [name, bytes] of files) {
      await mkdir(path.dirname(path.join(src, name)), { recursive: true });
      await writeFile(path.join(src, name), bytes);
    }
    ok(s.run([path.join(path.dirname(PY), 'python3')], ['-c', PY_ZIPS, src, path.join(s.root, 'py.zip')]), 'py zip');
    const py = new Uint8Array(await readFile(path.join(s.root, 'py.zip')));
    const js = await reproducibleZip(files);
    assert.ok(js.length === py.length && js.every((b, k) => b === py[k]),
              `sources.zip differs from opensheaf-py's (seed ${seed}, ${js.length} and ${py.length} bytes)`);
  } finally {
    await s.done();
  }
});

const PY_ZIPS = `import sys, pathlib
from opensheaf.zenodo import reproducible_zip
src = pathlib.Path(sys.argv[1])
reproducible_zip(sys.argv[2], {p.relative_to(src).as_posix(): p for p in src.rglob('*') if p.is_file()})
`;

test('Zenodo: the same deposits by both, the same requests', { skip }, async () => {
  const s = await sandbox();
  const servers = [await startServices(path.join(s.root, 'f1')), await startServices(path.join(s.root, 'f2'))];
  try {
    await papers(s);
    await s.file('fig.txt', 'a figure');
    const base = await archiveBy(s, 'js', 'base');
    ok(s.js(['deposit', 'p', '../paper.tex', ...DEPOSIT, '--extra-source', '../fig.txt=figs/fig.txt', '--new'], { cwd: base }), 'deposit');
    const [pyc, jsc] = [path.join(s.root, 'zpy'), path.join(s.root, 'zjs')];
    await cp(base, pyc, { recursive: true });
    await cp(base, jsc, { recursive: true });
    const [py, js] = [withServer(s, servers[0]).py, withServer(s, servers[1]).js];
    const step = async (args, status = 0) => {
      const [c0, c1] = [(await servers[0].calls()).length, (await servers[1].calls()).length];
      const p = py(args, { cwd: pyc }), j = js(args, { cwd: jsc });
      assert.equal(p.status, status, `py ${args.join(' ')}:\n${p.stdout}\n${p.stderr}`);
      assert.equal(j.status, status, `js ${args.join(' ')}:\n${j.stdout}\n${j.stderr}`);
      assert.equal(saidOf(j), saidOf(p), args.join(' '));
      const sent = zenodoCalls((await servers[0].calls()).slice(c0));
      assert.deepEqual(zenodoCalls((await servers[1].calls()).slice(c1)), sent);
      return { p, j, zipped: sent.some((c) => c.method === 'PUT' && c.path.endsWith('/sources.zip')) };
    };
    const trial = await step(['zenodo', 'p']);
    assert.ok(trial.zipped);
    assert.match(trial.p.stdout, /uploaded sources\.zip/);
    await sameArchives(base, pyc);
    await sameArchives(base, jsc);
    assert.ok((await step(['zenodo', 'p', '--production'])).zipped);
    await sameArchives(pyc, jsc);
    assert.ok(!existsSync(path.join(jsc, 'zenodo-staging')));
    for (const where of [pyc, jsc]) assert.deepEqual(verified(s, where).filter((f) => !f.startsWith('result')), []);
    await step(['zenodo', 'p', '--production'], 1);
    ok(s.py(['deposit', 'p', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf', '--changes', 'Corrected.'], { cwd: pyc }), 'py v2');
    await rm(jsc, { recursive: true, force: true });
    await cp(pyc, jsc, { recursive: true });
    await step(['zenodo', 'p', '--production']);
    await sameArchives(pyc, jsc);
    const calls = await servers[1].calls('zenodo.org');
    assert.ok(calls.some((c) => c.path.endsWith('/actions/newversion')));
    for (const where of [pyc, jsc]) assert.deepEqual(verified(s, where).filter((f) => !f.startsWith('result')), []);
  } finally {
    for (const server of servers) server.stop();
    await s.done();
  }
});

test('Zenodo: a deposit stopped after publication, completed by the other program', { skip }, async () => {
  const s = await sandbox();
  const server = await startServices(path.join(s.root, 'f'));
  try {
    await papers(s);
    const arch = await archiveBy(s, 'py', 'arch');
    const two = withServer(s, server);
    ok(s.py(['deposit', 'p', '--pdf', '../paper.pdf', '--no-source', 'lost', '--title', 'P', '--author', 'Doe, Jane', '--new'], { cwd: arch }), 'v1');
    for (const [first, second] of [['py', 'js'], ['js', 'py']]) {
      await server.mismatch('zenodo.org');
      const stopped = two[first](['zenodo', 'p', '--production'], { cwd: arch });
      assert.equal(stopped.status, 1, stopped.stdout + stopped.stderr);
      assert.match(stopped.stderr, /Zenodo published DOI 10\.5281\/zenodo\.\d+9, not the reserved/);
      const deposit = ['deposit', 'p', '--pdf', '../paper2.pdf', '--no-source', 'lost', '--title', 'P', '--author', 'Doe, Jane',
                       '--changes', `Deposited after ${first}.`];
      const [rp, rj] = [s.py(deposit, { cwd: arch }), s.js(deposit, { cwd: arch })];
      assert.equal(rp.status, 1);
      assert.equal(said(rj), said(rp));
      assert.match(rp.stderr, /completes it first \(appendix A\.1\)/);
      const done = ok(two[second](['zenodo', 'p', '--production'], { cwd: arch }), `${second} completes`);
      assert.match(done.stdout, /p: completing the object version of record \d+\np: v\d+ added, DOI 10\.5281\/zenodo\.\d+\n/);
      assert.ok(!existsSync(path.join(arch, 'zenodo-staging')));
      assert.deepEqual(verified(s, arch).filter((f) => !f.startsWith('result')), []);
      ok(s[second](deposit, { cwd: arch }), 'the next version');
    }
  } finally {
    server.stop();
    await s.done();
  }
});
