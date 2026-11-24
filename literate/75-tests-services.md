The tests of the services
=========================

arXiv and Zenodo are never reached by the tests. Both are replaced by
doubles, as opensheaf-py's tests replace them (its chapter 70): arXiv by
recorded files, Zenodo by a double of its deposit API that answers as
Zenodo does (drafts, new versions, uploads with their MD5, publication)
and keeps what it was sent. The tokens are fake, and every address of an
API is a double's; a test that would send a token elsewhere stops first.

The tests are in two places:

- `tests/services.test.js`: the command line of this program, run in
  this process (`main` of chapter [40](40-cli.md)), with doubles given in
  its environment: the conversions of the metadata, the unpacking of
  e-prints and its limits, the order in which the token of Zenodo is
  looked for, the import of a paper of two versions, a deposit on
  Zenodo's sandbox and on Zenodo, and a deposit interrupted after
  publication, completed, and signed again after a key was exposed;
- `tests/parity.test.js` (with chapter [72](72-tests-parity.md)): both
  programs against one double of arXiv and Zenodo, a server of its own
  (`tests/fake-services.js`): the same downloads, the same imports, the
  same requests to Zenodo and the same object versions; and each
  program completing what the other began.

    // in tests/services.test.js:
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
    import { existsSync } from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    import zlib from 'node:zlib';
    import crypto from 'node:crypto';
    import { main } from '../cli/osheaf.js';
    import { keyStore } from '../cli/keystore.js';
    import { ArchiveFolder } from '../core/folder.js';
    import * as arxiv from '../core/arxiv.js';
    import { SERVICES } from '../core/zenodo.js';
    import { tarGz } from './fixtures.js';

    <<services: doubles>>

    <<services: the metadata>>

    <<services: the sources>>

    <<services: the token>>

    <<services: an import>>

    <<services: deposits on Zenodo>>

Doubles
-------

A tar archive, as Python's `tarfile` writes one (the POSIX format, names
of at most 100 bytes), gzipped; the parity tests use it too, from a
module of its own.

    // in tests/fixtures.js:
    import zlib from 'node:zlib';

    export function tarGz(members) {
      const blocks = [];
      for (const [name, text, type = '0'] of members) {
        const data = typeof text === 'string' ? new TextEncoder().encode(text) : text;
        const h = new Uint8Array(512);
        const put = (at, s) => h.set(new TextEncoder().encode(s), at);
        put(0, name);
        put(100, '0000644\0');
        put(108, '0000000\0');
        put(116, '0000000\0');
        put(124, data.length.toString(8).padStart(11, '0') + '\0');
        put(136, '00000000000\0');
        put(148, '        ');
        h[156] = type.charCodeAt(0);
        put(257, 'ustar\x0000');
        const sum = h.reduce((n, b) => n + b, 0);
        put(148, sum.toString(8).padStart(6, '0') + '\0 ');
        blocks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
      }
      blocks.push(new Uint8Array(1024));
      return new Uint8Array(zlib.gzipSync(Buffer.concat(blocks)));
    }

Zenodo's deposit API, as far as the binding uses it, in memory, as a
`fetch`: what opensheaf-py's `FakeZenodo` answers, over HTTP. Its
addresses are those of `zenodo.invalid`, which nothing resolves.

    // in services: doubles:
    function fakeZenodo(production) {
      const s = SERVICES[production], api = 'https://zenodo.invalid/api';
      const records = new Map(), uploads = {}, calls = [];
      let next = 100;
      const record = (concept) => {
        next += 1;
        const rec = { id: next, conceptrecid: concept || next + 1000,
                      links: { bucket: `https://zenodo.invalid/bucket/${next}`, latest_draft: `${api}/deposit/depositions/${next}` },
                      files: concept ? [{ id: 'inherited' }] : [] };
        records.set(rec.id, rec);
        return rec;
      };
      const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
      const fetch = async (url, init = {}) => {
        const method = init.method || 'GET', u = new URL(url);
        assert.equal(u.hostname, 'zenodo.invalid', `a request left the double: ${url}`);
        assert.equal(init.headers.Authorization, 'Bearer fake-token');
        calls.push([method, u.pathname]);
        const parts = u.pathname.split('/');
        if (method === 'POST' && u.pathname === '/api/deposit/depositions') return json(record(null), 201);
        if (u.pathname.endsWith('/actions/newversion')) {
          const rec = record(records.get(Number(parts.at(-3))).conceptrecid);
          return json({ links: { latest_draft: rec.links.latest_draft } }, 201);
        }
        if (u.pathname.endsWith('/actions/publish')) {
          const rec = records.get(Number(parts.at(-3)));
          return json({ doi: `${s.prefix}/zenodo.${rec.id}`, conceptdoi: `${s.prefix}/zenodo.${rec.conceptrecid}` }, 202);
        }
        if (method === 'GET') return json(records.get(Number(parts.at(-1))));
        if (method === 'PUT' && u.pathname.startsWith('/bucket/')) {
          const data = new Uint8Array(init.body);
          uploads[decodeURIComponent(parts.at(-1))] = data;
          return json({ checksum: 'md5:' + crypto.createHash('md5').update(data).digest('hex') });
        }
        if (method === 'DELETE') return new Response(null, { status: 204 });
        return json({});
      };
      return { fetch, records, uploads, calls, api };
    }

A sandbox: a temporary folder with its configuration, and `run`, which
runs a command line of this program in this process, with the doubles:
the key store in files of the folder, arXiv answering from a map, Zenodo
from its double (one for the sandbox, one for production), the fake
token in the environment, and no keychain.

    // in services: doubles:
    async function sandbox({ arxivFiles = {} } = {}) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'osheaf-services-'));
      const zenodo = { true: fakeZenodo(true), false: fakeZenodo(false) };
      const box = { root, zenodo, vars: {}, asked: [] };
      box.run = async (argv, { vars = {} } = {}) => {
        const out = [], err = [];
        const environ = { XDG_CONFIG_HOME: path.join(root, 'config'), OPENSHEAF_KEY_STORE: 'file',
                          ZENODO_TOKEN: 'fake-token', ZENODO_SANDBOX_TOKEN: 'fake-token',
                          OPENSHEAF_ZENODO_API: 'https://zenodo.invalid/api', ...box.vars, ...vars };
        const production = argv.includes('--production');
        const status = await main(argv, {
          out: (l) => out.push(l), err: (l) => err.push(l), environ,
          keyStore: keyStore({ env: environ, warn: (t) => err.push('Warning: ' + t), err: (t) => err.push(t) }),
          passphrase: async () => 'correct horse', input: async () => '', cost: { opslimit: 1, memlimit: 8192 },
          openBrowser: async (url) => assert.fail(`a browser was opened: ${url}`),
          signingKeyGiven: false, passphraseGiven: false, unlockMode: '',
          arxivGet: async (url) => {
            box.asked.push(url);
            if (!(url in arxivFiles)) throw new arxiv.HttpError('HTTP Error 404: Not Found');
            return new TextEncoder().encode(arxivFiles[url]);
          },
          zenodoFetch: zenodo[production].fetch,
          security: async (args) => assert.fail(`the keychain was asked: ${args.join(' ')}`),
          sandbox: async () => {
            const where = await mkdtemp(path.join(root, 'zenodo-sandbox-'));
            const { DiskStorage } = await import('../cli/disk.js');
            return { storage: new DiskStorage(where), where, remove: () => rm(where, { recursive: true, force: true }) };
          },
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

    async function archive(box, name = 'a') {
      const dir = path.join(box.root, name);
      await box.ok(['init', dir, '--name', 'T', '--base-url', 'https://example.org/T/', '--curator', 'Doe, Jane',
                    '--new-owner', '--yes', '--export', path.join(box.root, 'k1'), '--no-passphrase']);
      return { dir, r: ['--root', dir] };
    }

    async function lineOf(dir, label) {
      const disc = JSON.parse(await readFile(path.join(dir, 'opensheaf.json'), 'utf-8'));
      const o = disc.objects.find((x) => x.label === label);
      const objDir = path.join(dir, 'ocfl', o.owner, o.name);
      const inv = JSON.parse(await readFile(path.join(objDir, 'inventory.json'), 'utf-8'));
      const file = async (logical, ver = inv.head) => {
        const state = inv.versions[ver].state;
        const d = Object.keys(state).find((k) => state[k].includes(logical));
        return readFile(path.join(objDir, inv.manifest[d][0]));
      };
      const json = async (logical, ver) => JSON.parse((await file(logical, ver)).toString('utf-8'));
      return { id: o.id, dir: objDir, inv, file, json };
    }

    async function findings(box, a) {
      const r = await box.run([...a.r, 'verify', '--json']);
      return JSON.parse(r.out).map((f) => `${f.severity}: ${f.place}: ${f.message}`);
    }

The metadata
------------

The cases of opensheaf-py's tests: TeX accents and quotes, macros of the
preamble, changes of font, ties and dashes, lists of authors with
affiliations.

    // in services: the metadata:
    test('titles, abstracts and names from TeX, as opensheaf-py makes them', () => {
      const s = String.raw`Comment on ${'``'}Dynamic behavior'' of H\"older drift, It\^o, \[ \R^3 \] and $\be^2<4\pi$`;
      assert.equal(arxiv.cleanText(s, { R: String.raw`\mathbb{R}`, be: String.raw`\beta` }),
                   'Comment on \u201cDynamic behavior\u201d of H\u00f6lder drift, It\u00f4, ${\\mathbb{R}}^3$ and ${\\beta}^2<4\\pi$');
      assert.deepEqual(arxiv.unknownMacros(String.raw`$\FF L^p$ and $\alpha$`), ['FF']);
      assert.equal(arxiv.cleanText(String.raw`a \emph{distribution} in the Osterwalder--Schrader sense`),
                   'a distribution in the Osterwalder\u2013Schrader sense');
      assert.equal(arxiv.cleanText(String.raw`{\it without} the Korteweg-de~Vries equation --- or Dyson--Schwinger`),
                   'without the Korteweg-de Vries equation \u2014 or Dyson\u2013Schwinger');
      assert.equal(arxiv.cleanText(String.raw`$\rho$-\tmtextit{irregularity}`), String.raw`$\rho$-irregularity`);
      assert.equal(arxiv.cleanText(String.raw`{\em x}, {\bf y}, \textit{z}, \textbf{\textsl{w}}, \tmtextbf{u}, \tmem{v}`),
                   'x, y, z, w, u, v');
      assert.equal(arxiv.cleanText(String.raw`$a--b$ and \url{https://example.org/~user}`),
                   String.raw`$a--b$ and \url{https://example.org/~user}`);
      assert.deepEqual(arxiv.authorNames('Andreia Chapouto, Jiawei Li, and Tadahiro Oh'), ['Andreia Chapouto', 'Jiawei Li', 'Tadahiro Oh']);
      assert.deepEqual(arxiv.authorNames(String.raw`Massimiliano Gubinelli (CEREMADE), Samy Tindel (INRIA Nancy - Grand Est / ` +
                                         String.raw`IECN, IECL) and Iv\'an Torrecilla (IECN (Nancy))`),
                       ['Massimiliano Gubinelli', 'Samy Tindel', String.raw`Iv\'an Torrecilla`]);
      assert.deepEqual(arxiv.preambleMacros(String.raw`\newcommand{\R}{\mathbb{R}}\def\be{\beta}\newcommand{\F}[1]{x}\begin{document}\newcommand{\Z}{z}`),
                       { R: String.raw`\mathbb{R}`, be: String.raw`\beta` });
      assert.equal(arxiv.texText(String.raw`H{\o}egh It\^o Pawe{\l}`), 'H\u00f8egh It\u00f4 Pawe\u0142');
      assert.equal(arxiv.detex(String.raw`G\"unter \v{S}imon`), 'G\u00fcnter \u0160imon');
      assert.deepEqual(arxiv.creatorOf('Johannes van der Waals'),
                       { name: 'van der Waals, Johannes', nameType: 'Personal', familyName: 'van der Waals', givenName: 'Johannes' });
      assert.equal(arxiv.slug(String.raw`On the $\Phi^4_3$ model of It\^o`, new Set(['on-the-phi-4-3-model-of-ito'])),
                   'on-the-phi-4-3-model-of-ito-2');
      assert.equal(arxiv.emailDate('Mon, 3 Apr 2023 17:59:58 GMT'), '2023-04-03T17:59:58Z');
    });

The sources
-----------

An e-print of a tar archive: a path given by a pax header, whose record
lengths count bytes, not characters (as Python's `tarfile` reads them);
its files under `source/`, an unsafe path skipped and noted; then the limits, lowered as opensheaf-py's tests lower
them: too many members, and a gzip bomb. As Python's `gzip`, members
concatenated are read as one stream and zeros after a member skipped,
while other bytes after it are refused; as `tarfile`, a file cut short
by the end of the archive is refused, not imported short. The kind of an e-print is told from one decompressed
tar block, as opensheaf-py's `test_source_kind_reads_one_block`: ten
megabytes of zeros compressed are `gz`, found without decompressing them.

    // in services: the sources:
    test('e-prints unpacked, within their limits', async () => {
      const record = (key, value) => {
        const rest = new TextEncoder().encode(` ${key}=${value}\n`).length;
        let n = rest + 1;
        while (String(n).length + rest !== n) n = String(n).length + rest;
        return `${n} ${key}=${value}\n`;
      };
      const pax = tarGz([['PaxHeader', record('path', 'sources/\u00e9t\u00e9.tex') + record('mtime', '1'), 'x'],
                         ['ignored.tex', '\\documentclass{article}']]);
      assert.deepEqual(arxiv.tarMembers(new Uint8Array(zlib.gunzipSync(pax))).map((m) => m.name), ['sources/\u00e9t\u00e9.tex']);
      const ok = tarGz([['main.tex', '\\documentclass{article}'], ['../evil.tex', 'x']]);
      const { kind, files, notes } = await arxiv.unpack(ok, 'ok', '2611.14296');
      assert.equal(kind, 'tar');
      assert.deepEqual(files.map(([lp]) => lp), ['source/main.tex']);
      assert.ok(notes.some((n) => n.includes('unsafe path ../evil.tex')));
      assert.equal(arxiv.mainTex(files), 'source/main.tex');
      assert.equal(await arxiv.sourceKind(ok), 'tar.gz');
      assert.equal(await arxiv.sourceKind(new Uint8Array(zlib.gzipSync('\\documentclass{x}'))), 'gz');
      assert.equal(await arxiv.sourceKind(new Uint8Array(zlib.gzipSync(new Uint8Array(10_000_000)))), 'gz');
      assert.equal(await arxiv.sourceKind(new Uint8Array([0x1f, 0x8b, ...new TextEncoder().encode('broken')])), 'gz');
      assert.equal(await arxiv.sourceKind(new TextEncoder().encode('%PDF-1.4')), 'pdf');
      const single = await arxiv.unpack(new Uint8Array(zlib.gzipSync('\\documentclass{x}')), 'single', 'math/0601001');
      assert.deepEqual(single.files.map(([lp]) => lp), ['source/math-0601001.tex']);
      const join = (...parts) => new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
      const two = join(zlib.gzipSync(new Uint8Array(256)), new Uint8Array(1024), zlib.gzipSync('\\documentclass{x}'),
                       new Uint8Array(3));
      assert.equal(new TextDecoder().decode((await arxiv.gunzip(two, Infinity)).subarray(256)), '\\documentclass{x}');
      assert.equal((await arxiv.gunzip(two, Infinity)).length, 256 + 17);
      await assert.rejects(arxiv.gunzip(join(zlib.gzipSync('x'), 'junk'), Infinity, 'junk'), /junk: not a gzip file/);
      const whole = zlib.gunzipSync(tarGz([['main.tex', '\\documentclass{article}' + ' '.repeat(2000)]]));
      const cut = new Uint8Array(zlib.gzipSync(whole.subarray(0, 512 + 1000)));
      await assert.rejects(arxiv.unpack(cut, 'cut', '2611.14296'), /cut: main\.tex: unexpected end of data/);
      const limits = { ...arxiv.LIMITS };
      try {
        arxiv.LIMITS.members = 3;
        await assert.rejects(arxiv.unpack(tarGz([0, 1, 2, 3, 4].map((i) => [`f${i}.tex`, 'x'])), 'many', '2611.14296'), /more than 3 files/);
        arxiv.LIMITS.unpacked = 1000;
        await assert.rejects(arxiv.unpack(new Uint8Array(zlib.gzipSync(new Uint8Array(100000))), 'bomb', '2611.14296'),
                             /expands to more than/);
      } finally {
        Object.assign(arxiv.LIMITS, limits);
      }
    });

The token
---------

The token of Zenodo is looked for in the environment, then in the
keychain through `security`, on macOS only, as opensheaf-py looks for it
(the package `keyring` aside).

    // in services: the token:
    test('the token of Zenodo: the environment, then the keychain on macOS', async () => {
      const asked = [];
      const security = async (args) => {
        asked.push(args);
        return { status: 0, stdout: 'from-security\n' };
      };
      const { makeEnvironment } = await import('../cli/osheaf.js');
      const token = (environ, platform) => makeEnvironment(null, { environ, platform, security, out: () => {}, err: () => {} })
        .zenodoToken(SERVICES[true]);
      assert.equal(await token({ ZENODO_TOKEN: ' from-env ' }, 'darwin'), 'from-env');
      assert.equal(await token({}, 'linux'), null);
      assert.deepEqual(asked, []);
      assert.equal(await token({}, 'darwin'), 'from-security');
      assert.deepEqual(asked[0], ['find-generic-password', '-s', 'zenodo-token', '-w']);
      assert.equal(await makeEnvironment(null, { environ: {}, platform: 'darwin', security, out: () => {}, err: () => {} })
        .zenodoToken(SERVICES[false]), 'from-security');
      assert.equal(asked[1][2], 'zenodo-sandbox-token');
    });

An import
---------

The paper of opensheaf-py's test: two versions, the first with its
source, the second a PDF alone; a line sealed with them, each version
signed, the second naming the first; skipped when imported again, and
the same with `--update`; a label of another paper refused.

    // in services: an import:
    function downloads(aid = '2611.00001', label = 'first-paper') {
      const record = `<?xml version="1.0"?>
    <OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><GetRecord><record><metadata>
    <arXivRaw xmlns="http://arxiv.org/OAI/arXivRaw/"><id>${aid}</id>
    <version version="v1"><date>Mon, 2 Nov 2026 10:00:00 GMT</date></version>
    <version version="v2"><date>Tue, 10 Nov 2026 10:00:00 GMT</date></version>
    <title>On the $\\Phi^4_3$ model</title><authors>Jane Doe and Richard Roe</authors>
    <categories>math-ph math.PR</categories><license>http://creativecommons.org/licenses/by/4.0/</license>
    <abstract>We prove $x&lt;y$.</abstract></arXivRaw></metadata></record></GetRecord></OAI-PMH>
    `;
      const cc = 'http://creativecommons.org/licenses/by/4.0/';
      return {
        [`papers/${aid}/record.xml`]: record,
        [`papers/${aid}/v1.pdf`]: '%PDF-1.4 one',
        [`papers/${aid}/v1-source.gz`]: new Uint8Array(zlib.gzipSync('\\documentclass{article}\\begin{document}x\\end{document}')),
        [`papers/${aid}/v2.pdf`]: '%PDF-1.4 two',
        'version-licences.json': JSON.stringify({ [`${aid}v1`]: { licence: cc, comments: '10 pages' },
                                                  [`${aid}v2`]: { licence: cc, comments: '11 pages' } }),
        'identifiers.json': JSON.stringify({ [aid]: label }),
      };
    }

    async function writeFiles(dir, files) {
      for (const [name, data] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
        await writeFile(path.join(dir, name), data);
      }
    }

    test('an arXiv paper of two versions, imported as a signed line', async () => {
      const box = await sandbox();
      try {
        const a = await archive(box);
        const dl = path.join(box.root, 'dl');
        await writeFiles(dl, downloads());
        await box.ok([...a.r, 'arxiv', 'import', dl, '--agreement', 'deposited by an author']);
        const l = await lineOf(a.dir, 'first-paper');
        assert.equal(l.inv.head, 'v2');
        const [v1, v2] = [await l.json('object.json', 'v1'), await l.json('object.json', 'v2')];
        assert.deepEqual([v1.name, v1.owner], l.id.split(':').slice(1));
        assert.ok(!('previous' in v1));
        assert.equal(v2.previous, crypto.createHash('sha512').update(await readFile(path.join(l.dir, 'v1', 'inventory.json'))).digest('hex'));
        assert.equal(v1.mainSource, 'source/2611.00001.tex');
        assert.ok('sourcesMissing' in v2);
        assert.deepEqual([v1.external[0].label, v2.external[0].label], ['v1', 'v2']);
        assert.equal(v1.external[0].record, 'https://arxiv.org/abs/2611.00001v1');
        assert.equal(v2.agreement.method, 'deposited by an author');
        assert.deepEqual(v2.agreement.by, ['Doe, Jane', 'Roe, Richard']);
        const dc = await l.json('datacite.json', 'v2');
        assert.equal(dc.url, `https://example.org/T/paper/${l.id.split(':')[1]}/`);
        assert.equal(dc.version, '2');
        assert.deepEqual(await l.file('genesis.json'), await l.file('genesis.json', 'v1'));
        assert.match((await box.ok([...a.r, 'arxiv', 'import', dl])).out, /skipped: already archived as first-paper/);
        await box.ok([...a.r, 'arxiv', 'import', dl, '--update']);
        assert.equal((await lineOf(a.dir, 'first-paper')).inv.head, 'v2');
        assert.match(await readFile(path.join(a.dir, 'paper', 'first-paper', 'index.html'), 'utf-8'), /Version 2 \(arXiv v2\)/);
        assert.deepEqual((await findings(box, a)).filter((f) => !f.startsWith('result')), []);
        const other = path.join(box.root, 'other');
        await writeFiles(other, downloads('2611.00002', 'first-paper'));
        const refused = await box.run([...a.r, 'arxiv', 'import', other]);
        assert.equal(refused.status, 1);
        assert.match(refused.err, /not related to this arXiv paper/);
        assert.match((await box.run([...a.r, 'arxiv', 'import', dl, '--texmacs', 'x.json'])).err, /opensheaf-py/);
      } finally {
        await box.done();
      }
    });

The fetch: a record, two PDFs, an e-print, the abstract pages, and a
second e-print arXiv does not have, recorded as an error and asked for
again by the next run.

    // in services: an import:
    test('arXiv fetched, resumed', async () => {
      const aid = '2611.00001', files = downloads(aid);
      const page = (n) => `<div class="abs-license"><a href="http://creativecommons.org/licenses/by/4.0/">CC BY</a></div>` +
        `<td class="tablecell comments mathjax">${n} pages, <a href="https://example.org/x">https://example.org/x</a> &amp; more</td>`;
      const arxivFiles = {
        'https://arxiv.org/a/doe_j_1.atom2': `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/${aid}v2</id></entry></feed>`,
        [`https://oaipmh.arxiv.org/oai?verb=GetRecord&identifier=oai:arXiv.org:${aid}&metadataPrefix=arXivRaw`]: files[`papers/${aid}/record.xml`],
        [`https://export.arxiv.org/pdf/${aid}v1`]: '%PDF-1.4 one', [`https://export.arxiv.org/pdf/${aid}v2`]: '%PDF-1.4 two',
        [`https://export.arxiv.org/e-print/${aid}v1`]: '%PDF-1.4 as a source',
        [`https://arxiv.org/abs/${aid}v1`]: page(10), [`https://arxiv.org/abs/${aid}v2`]: page(11),
      };
      const box = await sandbox({ arxivFiles });
      try {
        const dl = path.join(box.root, 'dl');
        const r = await box.ok(['arxiv', 'fetch', dl, '--author', 'doe_j_1']);
        assert.equal(r.out, `[1/1] ${aid}: v1, v2\n    v2.src ERROR HTTP Error 404: Not Found\ndone; 1 errors [('${aid}', 'v2.src')]`);
        assert.deepEqual((await readdir(path.join(dl, 'papers', aid))).sort(), ['record.xml', 'v1-source.pdf', 'v1.pdf', 'v2.pdf']);
        const info = JSON.parse(await readFile(path.join(dl, 'version-licences.json'), 'utf-8'));
        assert.deepEqual(info[`${aid}v1`], { licence: 'http://creativecommons.org/licenses/by/4.0/', comments: '10 pages, https://example.org/x & more' });
        const log = JSON.parse(await readFile(path.join(dl, 'download.json'), 'utf-8'));
        assert.match(log[aid]['v1.pdf'].fetched, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/);
        box.asked.length = 0;
        await box.ok(['arxiv', 'fetch', dl, aid]);
        assert.deepEqual(box.asked, [`https://export.arxiv.org/e-print/${aid}v2`]);
        assert.equal((await box.run(['arxiv', 'fetch', dl])).status, 2);
      } finally {
        await box.done();
      }
    });

Deposits on Zenodo
------------------

opensheaf-py's test of a deposit: on the sandbox first, on a copy, which
leaves the archive as it was and no test DOI in it; then on Zenodo
itself: the object version added holds the DOI in `datacite.json` and the
deposit in `external`, names the version before, and is signed; the files
uploaded are those of the version, its `object.json` byte for byte the
one added. The same version is not deposited twice; a second document
version is a new version of the record, `IsNewVersionOf` the first.

    // in services: deposits on Zenodo:
    test('a deposit on the sandbox, then on Zenodo, and a new version', async () => {
      const box = await sandbox();
      try {
        const a = await archive(box);
        await writeFile(path.join(box.root, 'p.tex'), '\\documentclass{article}');
        await writeFile(path.join(box.root, 'p.pdf'), '%PDF-1.4 p');
        const paper = [path.join(box.root, 'p.tex'), '--pdf', path.join(box.root, 'p.pdf'), '--title', 'On $x$', '--author', 'Doe, Jane',
                       '--rights', 'cc-by-4.0'];
        await box.ok([...a.r, 'deposit', 'p', ...paper, '--new']);
        const trial = await box.ok([...a.r, 'zenodo', 'p']);
        assert.match(trial.out, /sandbox: working on a copy in /);
        assert.match(trial.out, /statuses: signed, signed/);
        let l = await lineOf(a.dir, 'p');
        assert.equal(l.inv.head, 'v1');
        assert.ok(!existsSync(path.join(a.dir, 'zenodo-staging')));
        assert.ok(Object.keys(box.zenodo.false.uploads).length);
        assert.ok(!(await readFile(path.join(l.dir, 'v1', 'inventory.json'), 'utf-8')).includes('10.5072'));
        assert.deepEqual((await readdir(box.root)).filter((n) => n.startsWith('zenodo-sandbox-')), []);
        await box.ok([...a.r, 'zenodo', 'p', '--production']);
        l = await lineOf(a.dir, 'p');
        assert.equal(l.inv.head, 'v2');
        const obj = await l.json('object.json'), dc = await l.json('datacite.json');
        const entry = obj.external[0];
        assert.deepEqual([entry.role, entry.service, entry.doi], ['deposit', 'Zenodo', dc.doi]);
        assert.match(dc.doi, /^10\.5281\/zenodo\./);
        assert.match(entry.record, /^https:\/\/zenodo\.org\/records\//);
        assert.equal(obj.documentVersion, 1);
        assert.equal(dc.url, `https://example.org/T/paper/${l.id.split(':')[1]}/`);
        assert.deepEqual(Object.keys(box.zenodo.true.uploads).sort(), ['datacite.json', 'genesis.json', 'object.json', 'p.tex', 'paper.pdf']);
        assert.deepEqual(Buffer.from(box.zenodo.true.uploads['object.json']), await l.file('object.json'));
        assert.match((await box.run([...a.r, 'zenodo', 'p', '--production'])).err, /already on Zenodo/);
        await box.ok([...a.r, 'deposit', 'p', ...paper, '--changes', 'Typos.']);
        await box.ok([...a.r, 'zenodo', 'p', '--production']);
        l = await lineOf(a.dir, 'p');
        assert.ok((await l.json('datacite.json')).relatedIdentifiers.some((r) => r.relatedIdentifier === dc.doi &&
                                                                         r.relationType === 'IsNewVersionOf'));
        assert.ok(box.zenodo.true.calls.some(([, p]) => p.endsWith('/actions/newversion')));
        await box.ok([...a.r, 'collect']);
        assert.deepEqual((await findings(box, a)).filter((f) => !f.startsWith('result')), []);
      } finally {
        await box.done();
      }
    });

A deposit interrupted after publication keeps its staging folder, with
the version built and signed, and locks the line until the next run of
`osheaf zenodo` adds the version. The key that signed it is exposed
meanwhile: the version would be contested, and the run signs it again,
with a current key not exposed (section 7.3), as in opensheaf-py's test.

    // in services: deposits on Zenodo:
    test('a deposit interrupted after publication, completed and signed again', async () => {
      const box = await sandbox();
      const install = ArchiveFolder.prototype.installVersion;
      try {
        const a = await archive(box);
        await writeFile(path.join(box.root, 'p.pdf'), '%PDF-1.4 p');
        const paper = ['--pdf', path.join(box.root, 'p.pdf'), '--no-source', 'lost', '--title', 'P', '--author', 'Doe, Jane'];
        await box.ok([...a.r, 'deposit', 'p', ...paper, '--new']);
        ArchiveFolder.prototype.installVersion = async () => {
          throw new Error('the disk is full');
        };
        const full = await box.run([...a.r, 'zenodo', 'p', '--production']);
        assert.equal(full.status, 1);
        assert.match(full.err, /the disk is full/);
        ArchiveFolder.prototype.installVersion = install;
        let l = await lineOf(a.dir, 'p');
        const [, name, owner] = l.id.split(':');
        const state = JSON.parse(await readFile(path.join(a.dir, 'zenodo-staging', owner, name, 'state.json'), 'utf-8'));
        assert.equal(state.phase, 'published');
        assert.match((await box.run([...a.r, 'deposit', 'p', ...paper, '--changes', 'x'])).err, /completes it first/);
        const fresh = (await box.ok([...a.r, 'key', 'new'])).out.split('\n')[1].trim();
        const first = /Current keys {2}(did:key:\S+)/.exec((await box.ok([...a.r, 'owner', 'show', '--offline'])).out)[1];
        const k1 = (await readdir(path.join(box.root, 'k1'))).map((n) => path.join(box.root, 'k1', n));
        await box.ok([...a.r, 'owner', 'expose', first, '--add', fresh, '--rotation-key', k1[0], '--rotation-key', k1[1],
                      '--export', path.join(box.root, 'k2'), '--no-passphrase', '--yes']);
        const done = await box.ok([...a.r, 'zenodo', 'p', '--production']);
        assert.match(done.out, /completing the object version of record 101/);
        assert.match(done.out, /v2 is contested \(a key that signed it was exposed\): signing it again/);
        l = await lineOf(a.dir, 'p');
        assert.equal(l.inv.head, 'v2');
        assert.equal((await readdir(path.join(l.dir, 'extensions', 'opensheaf-witnesses', 'v2'))).length, 2);
        assert.ok(!existsSync(path.join(a.dir, 'zenodo-staging')));
        assert.match((await l.json('datacite.json')).doi, /^10\.5281\/zenodo\./);
        const found = await findings(box, a);
        assert.ok(found.includes('result: p: latest signed version v2'), found.join('\n'));
      } finally {
        ArchiveFolder.prototype.installVersion = install;
        await box.done();
      }
    });

Both programs against one double
--------------------------------

The parity tests run both programs, as chapter [72](72-tests-parity.md)
does, against a double of arXiv and Zenodo that is a server of its own,
in another process (the commands run while the tests wait for them, so
the double cannot be in the process of the tests). It listens on the
loopback address only, and serves, under `/<host>/...`, the hosts it
stands for: `zenodo.org` and `sandbox.zenodo.org`, with the deposit API
of opensheaf-py's `FakeZenodo`, and `arxiv.org`, `export.arxiv.org` and
`oaipmh.arxiv.org`, from files the test writes (an OAI record under the
name of its identifier). It answers only the fake token; it records
every request, method, path and body (the JSON of a request, or the MD5
and size of an upload), and gives them at `/_calls`; `/_mismatch/<host>`
makes the next publication answer another DOI than the one reserved,
which stops a deposit after publication.

    // in tests/fake-services.js:
    import http from 'node:http';
    import crypto from 'node:crypto';
    import { readFile } from 'node:fs/promises';
    import path from 'node:path';
    import process from 'node:process';

    const fixtures = process.argv[2];
    const TOKEN = 'Bearer fake-token-of-the-tests';
    const PREFIX = { 'zenodo.org': '10.5281', 'sandbox.zenodo.org': '10.5072' };
    const services = {}, calls = [];
    let base = '';

    const service = (host) => (services[host] ??= { records: new Map(), next: 100, mismatch: false });

    function zenodo(host, req, p, body, send) {
      const s = service(host), prefix = PREFIX[host];
      const call = { host, method: req.method, path: p };
      if (body.length) {
        call.body = (req.headers['content-type'] || '').startsWith('application/json') ? JSON.parse(body.toString('utf-8'))
          : { md5: crypto.createHash('md5').update(body).digest('hex'), bytes: body.length };
      }
      calls.push(call);
      if (req.headers.authorization !== TOKEN) return send(403, { message: 'not the token of the tests' });
      const record = (concept) => {
        s.next += 1;
        const rec = { id: s.next, conceptrecid: concept || s.next + 1000,
                      links: { bucket: `${base}${host}/bucket/${s.next}`, latest_draft: `${base}${host}/api/deposit/depositions/${s.next}` },
                      files: concept ? [{ id: 'inherited' }] : [] };
        s.records.set(rec.id, rec);
        return rec;
      };
      const parts = p.split('/');
      if (req.method === 'POST' && p === '/api/deposit/depositions') return send(201, record(null));
      if (p.endsWith('/actions/newversion')) {
        const rec = record(s.records.get(Number(parts.at(-3))).conceptrecid);
        return send(201, { links: { latest_draft: rec.links.latest_draft } });
      }
      if (p.endsWith('/actions/publish')) {
        const rec = s.records.get(Number(parts.at(-3)));
        const doi = `${prefix}/zenodo.${rec.id}${s.mismatch ? '9' : ''}`;
        s.mismatch = false;
        return send(202, { doi, conceptdoi: `${prefix}/zenodo.${rec.conceptrecid}` });
      }
      if (req.method === 'GET') return send(200, s.records.get(Number(parts.at(-1))));
      if (req.method === 'PUT' && p.startsWith('/bucket/')) {
        return send(200, { checksum: 'md5:' + crypto.createHash('md5').update(body).digest('hex') });
      }
      if (req.method === 'DELETE') return send(204, null);
      return send(200, {});
    }

    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const u = new URL(req.url, base);
      const send = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(value === null ? '' : JSON.stringify(value));
      };
      if (u.pathname === '/_calls') return send(200, calls);
      if (u.pathname.startsWith('/_mismatch/')) {
        service(u.pathname.slice('/_mismatch/'.length)).mismatch = true;
        return send(200, {});
      }
      const [, host, ...rest] = u.pathname.split('/');
      if (host in PREFIX) return zenodo(host, req, '/' + rest.join('/'), body, send);
      calls.push({ host, method: req.method, path: '/' + rest.join('/') + u.search });
      const id = u.searchParams.get('identifier');
      const file = path.join(fixtures, host, ...rest.map(decodeURIComponent), ...(id ? [id.replace(/[:/]/g, '_')] : []));
      if (!path.resolve(file).startsWith(path.resolve(fixtures) + path.sep)) return send(404, null);
      try {
        const data = await readFile(file);
        res.writeHead(200);
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}/`;
      process.stdout.write(`port ${server.address().port}\n`);
    });

### Running the two against it

opensheaf-py reaches arXiv and Zenodo at their own addresses, with
`urllib`. It runs here with a guard put in front of `urllib`: every
address that is not the loopback's is sent to the double, as
`/<host>/<path>`, and an address that would still leave the computer
stops the command; the waits between requests to arXiv are skipped. Its
Python is the one named by the first lines of its `osheaf` command.
This program is told the address of the double's API
(`OPENSHEAF_ZENODO_API`); arXiv, which only its `fetch` command reads, is
read through a `fetch` given to `main`, in this process. The tokens are
fake, and `zenodoVars` refuses to give an address that is not the
loopback's.

    // in tests/parity.test.js:
    import { main as jsMain } from '../cli/osheaf.js';

    const FAKE_TOKEN = 'fake-token-of-the-tests';
    const GUARD = `
    import os, sys, time, urllib.parse, urllib.request
    FAKE = os.environ["OSHEAF_FAKE_HOSTS"]
    assert FAKE.startswith("http://127.0.0.1:"), FAKE
    real = urllib.request.urlopen
    def guarded(req, *a, **k):
        if isinstance(req, str):
            req = urllib.request.Request(req)
        u = urllib.parse.urlsplit(req.full_url)
        if u.hostname != "127.0.0.1":
            req.full_url = FAKE + u.netloc + u.path + ("?" + u.query if u.query else "")
        if urllib.parse.urlsplit(req.full_url).hostname != "127.0.0.1":
            raise SystemExit("a test reached for the network: " + req.full_url)
        return real(req, *a, **k)
    urllib.request.urlopen = guarded
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

### Fetching

Both programs fetch one paper of an author, one of whose e-prints arXiv
does not have; the folders they write are the same, the times of the
downloads aside, they say the same, and they asked for the same
addresses. A second run of each asks again for what failed.

    // in tests/parity.test.js:
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

### Importing

The downloads of two papers: the first with three versions, its first
e-print a tar archive with a folder, a macro of the preamble in its
abstract, the DOI and the reference of the published article, its second
a single TeX file, its third a PDF; the second paper, older, with a PDF
and no e-print. Each program imports them into a copy of an archive of
opensheaf-py: the same lines, apart from their names, the same report,
the same words, and both verifications agree on each. Then arXiv has a
fourth version of the first paper: each program adds it, with
`--update`, to the archive each of them made, and the copies are the
same, byte for byte. A paper whose label is another line's is refused
alike.

    // in tests/parity.test.js:
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

### Depositing on Zenodo

A paper with a source in a folder, which goes to Zenodo in
`sources.zip`, deposited by each program on a copy of an archive of this
program, each against a double of its own: on the sandbox, which leaves
the archive as it was; on Zenodo, twice, the second time refused; and a
second document version, a new version of the record. The two send the
same requests, with the same bodies, and the copies are the same. The
second document version is deposited once, by opensheaf-py, and its copy
given to both: deposited by each, it would be made in two different
seconds, and the `previous` of the version recording its DOI, a digest
of the inventory that records that time, would differ.

    // in tests/parity.test.js:
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

A deposit stopped after its publication (Zenodo answers another DOI than
the one it reserved) leaves the line locked, and each program refuses a
deposit alike; the other program completes the deposit, and the archive
verifies; and the other way round. Each round's deposit has its own change
note, since a deposit repeating the current version is refused first
(section 4.2).

    // in tests/parity.test.js:
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
