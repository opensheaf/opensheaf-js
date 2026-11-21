The tests of parity with opensheaf-py
=====================================

opensheaf-py is the reference implementation; this program is a port of
it, and the two must be interchangeable on an archive. The tests of this
chapter run both commands, `osheaf` of opensheaf-py and `cli/osheaf.js`,
on the same archives, in temporary folders, each with a key store of its
own (`OPENSHEAF_KEY_STORE=file` under a temporary `XDG_CONFIG_HOME`),
never the user's:

1. an archive made by this program (`init`, a paper deposited, a second
   version, the main catalogue collected) passes `osheaf verify` of
   opensheaf-py with no error and no warning, and the two verifications
   give the same findings;
2. an archive made by opensheaf-py passes this program's verification,
   with the same findings as opensheaf-py's;
3. rotation keys exported by this program, in clear and under a
   passphrase, sign the next version of the key log with opensheaf-py
   (`osheaf owner rotate --rotation-key`), after which this program signs
   deposits against the new version of the key log; and the rotation keys
   exported by opensheaf-py are read by this program;
4. the same deposit, made by each implementation on two copies of one
   archive, gives the same `object.json`, `datacite.json` and
   `members.json`, byte for byte, and the same inventory apart from the
   time of the version;
5. `osheaf init` of both writes the same configuration and the same
   templates, which are the files of `templates/` of this repository;
6. each command of descriptions (`notice`, `withdraw`, `relate`,
   `relicense`, `describe`, `complete`) and `deposit --from` a YAML file,
   made by each implementation on two copies of one archive, gives the
   same files (the times of versions aside, and for a new work its name),
   and both verifications of either copy give the same findings;
7. the website written by this program for an archive is the one
   opensheaf-py writes for it, file for file, byte for byte: landing
   pages with notices, a withdrawal, a selection featured on the home
   page, and members held in another archive, read over HTTP;
8. the collections, with members of another archive served over HTTP by a
   local server (both programs reading it through `OPENSHEAF_LOCATIONS`):
   `collection new|add|status|update|remove|follow|sync` give the same
   `members.json` and `datacite.json` and say the same, and `osheaf verify
   --remote` gives the same findings;
9. one owner kept by both: each rotates, exposes and ends the key log the
   other made, signs again what an exposed key signed, and meets the
   other's copies (`owner pull`, `init --owner --key-log`), extending them
   or recording a fork; both verifications agree, and `owner show` says
   the same;
10. one key wallet, a double of a private GitHub repository shared by the
    two (a double of `gh` for opensheaf-py, a local double of GitHub's API
    for this program, on the same files): the keys either puts there the
    other lists, pulls and signs with; and the texts of `key export` of
    either are imported by the other.
11. arXiv and Zenodo, against one double of both (chapter
    [75](75-tests-services.md)): the same downloads, the same imports,
    each updating what the other imported; the same requests to Zenodo
    and the same object versions; a deposit stopped after publication
    and completed by the other program.

opensheaf-py is found as `OSHEAF_PY`, or as `osheaf` on the `PATH`; the
continuous integration installs it from its repository. Without it, the
tests are skipped, with the reason.

    // in tests/parity.test.js:
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

    <<running the two implementations>>

    <<parity: an archive made here, verified by opensheaf-py>>

    <<parity: an archive made by opensheaf-py, verified here>>

    <<parity: rotation keys across the two>>

    <<parity: the same deposit by both>>

    <<parity: comparing two copies>>

    <<parity: init and the templates>>

    <<parity: descriptions by both>>

    <<parity: the website>>

    <<parity: collections across archives>>

    <<parity: owners kept by both>>

    <<parity: one wallet for both>>

Running the two
---------------

Each test makes a temporary folder with its own home, configuration and
key store, and removes it at the end. This program runs under the
runtime that runs the tests: Deno (`deno run -A`, with the import map of
`deno.json`, and the cache of packages of the person running the tests,
not one in the temporary home) or Node.

    // in running the two implementations:
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

1. Made here, verified by opensheaf-py
--------------------------------------

    // in parity: an archive made here, verified by opensheaf-py:
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

2. Made by opensheaf-py, verified here
--------------------------------------

opensheaf-py's archive has the profile `website`, with its home page and
landing pages, which the verification checks too.

    // in parity: an archive made by opensheaf-py, verified here:
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

The last deposit, made by this program on opensheaf-py's archive,
repeats the first version's files on purpose: both verifiers must then
report the same error of section 4.2, and nothing else.

3. Rotation keys across the two
-------------------------------

The rotation keys this program exports, under a passphrase, are used by
opensheaf-py to sign version 2 of the key log; this program then signs a
deposit against version 2; both verifications agree that all is signed.
The rotation keys opensheaf-py exports, in clear and under a passphrase,
are read here, and are those its key log commits to.

    // in parity: rotation keys across the two:
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

4. The same deposit by both
---------------------------

An archive made by opensheaf-py, with one paper, is copied twice; the
same second version is deposited by opensheaf-py in one copy and by this
program in the other, and the main catalogue collected in each. The files
of the new version must be the same: the descriptions byte for byte, the
inventory once the time of the version is set aside, the same signature
files; and the same members of the main catalogue.

    // in parity: the same deposit by both:
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

Comparing two copies
--------------------

Two copies of one archive, changed by one command each, are compared file
by file: the content files of every object byte for byte, the inventories
with the times of their versions left out; the other files (checksums,
signatures, the indexes, the pages) hold digests of the inventories, and
so the times. A new work has a new name in each copy: it is compared by
its label, its name and the digest of its previous version left out.

    // in parity: comparing two copies:
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

A new work is named by a new genesis record in each copy, so the names in
what the commands say are left out too. `osheaf collection remove
--revision` of a revision of a member that keeps others says "no member
matches", in both: opensheaf-py compares the members after the change
with themselves (chapter [30](30-collections.md)).

    // in parity: comparing two copies:
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

Init and the templates
----------------------

An owner with a keeper is shown with it, and verified with the keeper not
checked; the keeper's place is not read (a proxy that does not answer
keeps both programs offline), so neither marks it confirmed.

    // in parity: init and the templates:
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

Descriptions by both
--------------------

    // in parity: descriptions by both:
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

The website
-----------

One archive, two copies, `osheaf index` of each program on one: the two
trees are the same, byte for byte (the date of the home page is the day's,
the same for both).

    // in parity: the website:
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

Collections across archives
---------------------------

Another archive, made by opensheaf-py, is served over HTTP by a local
server (Python's `http.server`, a process of its own, since the commands
run synchronously); both programs read it at `https://example.org/other/`
through `OPENSHEAF_LOCATIONS`, and read the archive itself, whose base URL
members record, from its folder, so that nothing is fetched from the
network.

    // in parity: collections across archives:
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

Owners kept by both
-------------------

One owner, made by opensheaf-py, its rotation keys exported in clear;
both programs share the file store of the sandbox, so that a current key
made by one signs with the other. Each step is made by one program on the
key log the other wrote last, and the two verifications of the archive
agree, without a finding.

    // in parity: owners kept by both:
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

Copies of the key log across the two: an archive made by each for the
owner of an archive of the other (`init --owner --key-log`), brought up to
date by `owner pull` of each, then forked, each recording the fork the
other's copy shows.

    // in parity: owners kept by both:
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

One wallet for both
-------------------

A private GitHub repository, as two doubles over one folder: opensheaf-py
reaches it through a double of `gh` (the one of its own tests, found first
on the `PATH`), and this program through a double of GitHub's contents
API, a local server (`OPENSHEAF_GITHUB_API`, with a token in
`GITHUB_TOKEN`), both written in Python, a process of their own, so that
they answer while the tests wait for the commands. The keys are locked
with the passphrase of `OPENSHEAF_PASSPHRASE`, at the cost both programs
use.

    // in parity: one wallet for both:
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

The keys put in the wallet by `init --keys` of opensheaf-py are listed by
this program as by opensheaf-py; a current key forgotten here is pulled
back from it; this program rotates with the rotation keys opensheaf-py
put there and puts new ones, which opensheaf-py lists and rotates with in
turn; each removes the keys used up; the archive stays without a finding.

    // in parity: one wallet for both:
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

The text of a key for a password manager, in clear and under the
passphrase, exported by either program and imported by the other into a
key store of its own.

    // in parity: one wallet for both:
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
