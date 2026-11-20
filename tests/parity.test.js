// Generated from literate/72-tests-parity.md by opensheaf-literate: edit the document, not this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
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
  env.DENO_DIR = process.env.DENO_DIR || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/deno'
    : process.platform === 'win32' ? 'AppData/Local/deno' : '.cache/deno');
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

async function sameArchives(a, b) {
  const A = await filesOf(a), B = await filesOf(b);
  const kept = (p) => p.startsWith('ocfl/') && (p.includes('/content/') || p.endsWith('inventory.json'));
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
      ['notice', 'paper', '--about', '1', '--text', 'A notice.', '--file', '../statement.md', '--date', '2025-01-02'],
      ['withdraw', 'paper', '--reason', 'An error.', '--file', '../statement.md'],
      ['relate', 'paper', '--to', 'arxiv:2501.00001', '--relation', 'IsVariantFormOf', '--issued', '2024-12-01'],
      ['relicense', 'paper', '--rights', 'cc0-1.0', '--method', 'confirmed by email'],
      ['describe', 'paper', '--title', 'Another title', '--keyword', 'a', '--keyword', 'b', '--author', 'Roe, Richard|Elsewhere'],
      ['complete', 'bare', '--version', '1', '--source', '../paper.tex', '--extra-source', '../refs.bib=bib/refs.bib'],
    ];
    for (const args of runs) {
      const { a, b } = await both(s, arch, args);
      await sameArchives(a, b);
      assert.deepEqual(verified(s, a), verified(s, b));
    }
    for (const args of [['notice', 'paper', '--about', '2', '--text', 'x'], ['relicense', 'paper', '--rights', 'cc-by-4.0',
                                                                             '--method', 'again'],
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
    for (const label of ['one', 'two', 'three']) {
      ok(s.py(['deposit', label, '../paper.tex', ...DEPOSIT, '--title', `Paper ${label} on $x < y$ & "z"`, '--new',
               '--issued', '2024-0' + (label.length) + '-01'], { cwd: arch }), `py deposit ${label}`);
    }
    ok(s.py(['deposit', 'one', '../paper.tex', ...DEPOSIT, '--pdf', '../paper2.pdf', '--changes', 'Corrected.',
             '--stage', 'AM', '--related', 'arxiv=2401.00001'], { cwd: arch }), 'py deposit v2');
    ok(s.py(['notice', 'one', '--about', '1', '--text', 'An erratum.'], { cwd: arch }), 'py notice');
    ok(s.py(['withdraw', 'three', '--reason', 'Wrong.'], { cwd: arch }), 'py withdraw');
    ok(s.py(['collect'], { cwd: arch }), 'py collect');
    ok(s.py(['collection', 'new', 'picks', '--type', 'selection', '--title', 'Picks', '--description', 'Chosen.'],
            { cwd: arch }), 'py collection new');
    ok(s.py(['collection', 'add', 'picks', 'one', 'two'], { cwd: arch }), 'py collection add');
    const pages = await sameWebsite(s, arch);
    assert.ok(pages.has('paper/one/index.html') && pages.has('paper/picks/index.html') && pages.has('sitemap.xml'));
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
      ['collection', 'add', 'sel', theirs, ...at, '--revision', '2'],
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
    await both(s, arch, ['collection', 'remove', 'sel', theirs, '--revision', '1'], { more, status: 1 });
    ({ a, b } = await both(s, arch, ['collection', 'remove', 'cat', 'paper'], { more }));
    await sameArchives(a, b);
    await s.file('coll.yaml', ['title: Synced', 'description: From a file.', 'order: issued-asc', 'members:', '  - paper',
                               `  - uri: ${theirs}`, '    at: https://example.org/other/', '    follow: yes', ''].join('\n'));
    ({ a, b } = await both(s, arch, ['collection', 'sync', 'synced', '--from', '../coll.yaml'], { more }));
    await sameNewWork(a, b, 'synced');
    ({ a, b } = await both(s, arch, ['collection', 'sync', 'cat', '--from', '../coll.yaml'], { more }));
    await sameArchives(a, b);
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
