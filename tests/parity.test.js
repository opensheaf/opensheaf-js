// Generated from literate/72-tests-parity.md by opensheaf-literate: edit the document, not this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readRotationKey } from '../core/keys.js';
import { keyDigest } from '../core/names.js';

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
  const run = (command, args, { cwd = root, more = {} } = {}) => {
    const r = spawnSync(command[0], [...command.slice(1), ...args], { cwd, env: { ...env, ...more }, encoding: 'utf-8' });
    if (r.error) throw r.error;
    return r;
  };
  const isDeno = typeof globalThis.Deno !== 'undefined';
  const jsCommand = isDeno ? [process.execPath, 'run', '-A', '--config', CONFIG, CLI] : [process.execPath, CLI];
  return {
    root,
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
    const again = findings(s.py(['verify', '--json'], { cwd: arch }));
    assert.deepEqual(again.filter((f) => !f.startsWith('result: ')),
                     ['error: paper: v3 document version 3 holds the same files and change note as document version 1, whose number it keeps']);
    assert.deepEqual(findings(s.js(['verify', '--json'], { cwd: arch })), again);
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
