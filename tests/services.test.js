// Generated from literate/75-tests-services.md by opensheaf-literate: edit the document, not this file.
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
import { SERVICES, Zenodo } from '../core/zenodo.js';
import { tarGz } from './fixtures.js';

function fakeZenodo(production) {
  const s = SERVICES[production], api = 'https://zenodo.invalid/api';
  const records = new Map(), uploads = {}, calls = [];
  const double = { records, uploads, calls, api, fail: [] };
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
    const k = double.fail.findIndex(([m, part]) => m === method && u.pathname.includes(part));
    if (k >= 0) {
      const [[, , when]] = double.fail.splice(k, 1);
      if (when === 'lost') await answer(method, u, init);
      throw new TypeError(`fetch failed (${when})`);
    }
    return answer(method, u, init);
  };
  const answer = async (method, u, init) => {
    calls.push([method, u.pathname]);
    const parts = u.pathname.split('/');
    if (method === 'POST' && u.pathname === '/api/deposit/depositions') return json(record(null), 201);
    if (u.pathname.endsWith('/actions/newversion')) {
      const parent = records.get(Number(parts.at(-3)));
      const rec = record(parent.conceptrecid);
      parent.links.latest_draft = rec.links.latest_draft;
      return json({ links: { latest_draft: rec.links.latest_draft } }, 201);
    }
    if (u.pathname.endsWith('/actions/publish')) {
      const rec = records.get(Number(parts.at(-3)));
      Object.assign(rec, { submitted: true, doi: `${s.prefix}/zenodo.${rec.id}` });
      return json({ doi: `${s.prefix}/zenodo.${rec.id}`, conceptdoi: `${s.prefix}/zenodo.${rec.conceptrecid}` }, 202);
    }
    if (u.pathname.includes('/deposit/depositions/') && /^[0-9]+$/.test(parts.at(-1)) && ['GET', 'DELETE'].includes(method)) {
      const n = Number(parts.at(-1));
      if (!records.has(n)) return json({ status: 404, message: 'PID does not exist.' }, 404);
      if (method === 'DELETE') {
        records.delete(n);
        return new Response(null, { status: 204 });
      }
      return json(records.get(n));
    }
    if (method === 'PUT' && u.pathname.startsWith('/bucket/')) {
      const data = new Uint8Array(init.body);
      uploads[decodeURIComponent(parts.at(-1))] = data;
      return json({ checksum: 'md5:' + crypto.createHash('md5').update(data).digest('hex') });
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return json({});
  };
  return Object.assign(double, { fetch });
}

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

test('the token of Zenodo is not sent on a redirect to another host', async () => {
  const http = await import('node:http');
  const seen = [];
  const servers = await Promise.all([0, 1].map(() => new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      seen.push([srv.address().port, req.url, req.headers.authorization]);
      if (req.url.startsWith('/to-')) {
        res.writeHead(302, { Location: decodeURIComponent(req.url.slice(4)) });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end('{}');
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  })));
  try {
    const [a, b] = servers.map((srv) => `http://127.0.0.1:${srv.address().port}`);
    const z = new Zenodo({ production: true, token: 'SECRET', api: `${a}/api` });
    await assert.rejects(z.call('GET', `${a}/to-${encodeURIComponent(`${b}/x`)}`), /: 302 /);
    assert.ok(seen.every(([port]) => port !== servers[1].address().port));
    assert.deepEqual(await z.call('GET', `${a}/to-${encodeURIComponent('/here')}`), {});
    assert.deepEqual(seen.at(-1), [servers[0].address().port, '/here', 'Bearer SECRET']);
  } finally {
    for (const srv of servers) srv.close();
  }
});

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

test('the Zenodo token and records stay with their service', async () => {
  const sent = [];
  const z = new Zenodo({ production: true, token: 'secret', fetch: async (url, init) => {
    sent.push([url, init.headers.Authorization]);
    return new Response('{}');
  } });
  for (const bad of ['https://evil.example/api/files/1', 'http://zenodo.org/api/files/1',
                     'https://zenodo.org@evil.example/x', 'https://sandbox.zenodo.org/api/files/1', 'files/1']) {
    await assert.rejects(z.call('PUT', bad, null, new Uint8Array([1])), /the token is not sent there/);
  }
  assert.deepEqual(sent, []);
  await z.call('GET', '/deposit/depositions/1');
  await z.call('PUT', 'https://zenodo.org/api/files/abc/paper.pdf', null, new Uint8Array([1]));
  assert.deepEqual(sent, [['https://zenodo.org/api/deposit/depositions/1', 'Bearer secret'],
                          ['https://zenodo.org/api/files/abc/paper.pdf', 'Bearer secret']]);
  const box = await sandbox();
  try {
    const a = await archive(box);
    await writeFile(path.join(box.root, 'p.pdf'), '%PDF-1.4 p');
    const paper = ['--pdf', path.join(box.root, 'p.pdf'), '--no-source', 'lost', '--title', 'P', '--author', 'Doe, Jane'];
    await box.ok([...a.r, 'deposit', 'p', ...paper, '--new']);
    await box.ok([...a.r, 'zenodo', 'p', '--production']);
    await writeFile(path.join(box.root, 'p.pdf'), '%PDF-1.4 p2');
    await box.ok([...a.r, 'deposit', 'p', ...paper, '--changes', 'Typos.']);
    await box.ok([...a.r, 'zenodo', 'p']);
    assert.ok(Object.keys(box.zenodo.false.uploads).length);
    assert.ok(!box.zenodo.false.calls.some(([, u]) => u.endsWith('/actions/newversion')));
  } finally {
    await box.done();
  }
});

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

test('answers of Zenodo lost: an interrupted deposit is settled by asking Zenodo', async () => {
  const box = await sandbox();
  try {
    const a = await archive(box);
    const z = box.zenodo.true;
    const pdf = path.join(box.root, 'p.pdf');
    await writeFile(pdf, '%PDF-1.4 p');
    const paper = ['--pdf', pdf, '--no-source', 'lost', '--title', 'P', '--author', 'Doe, Jane'];
    const zenodo = [...a.r, 'zenodo', 'p', '--production'];
    await box.ok([...a.r, 'deposit', 'p', ...paper, '--new']);
    const [, name, owner] = (await lineOf(a.dir, 'p')).id.split(':');
    const stage = path.join(a.dir, 'zenodo-staging', owner, name);
    const stateOf = async () => JSON.parse(await readFile(path.join(stage, 'state.json'), 'utf-8'));
    const publishes = () => z.calls.filter(([, u]) => u.endsWith('/actions/publish')).length;
    z.fail = [['POST', '/actions/publish', 'lost'], ['GET', '/deposit/depositions/', 'before']];
    assert.equal((await box.run(zenodo)).status, 1);
    assert.equal((await stateOf()).phase, 'publishing');
    assert.match((await box.run([...a.r, 'deposit', 'p', ...paper, '--changes', 'x'])).err, /completes it first/);
    await box.ok(zenodo);
    let l = await lineOf(a.dir, 'p');
    assert.equal(l.inv.head, 'v2');
    assert.ok(!existsSync(stage));
    assert.equal(publishes(), 1);
    assert.equal(z.records.size, 1);
    assert.equal((await l.json('datacite.json')).doi, `10.5281/zenodo.${[...z.records.keys()][0]}`);
    await writeFile(pdf, '%PDF-1.4 p2');
    await box.ok([...a.r, 'deposit', 'p', ...paper, '--changes', 'Typos.']);
    z.fail = [['GET', '/deposit/depositions/', 'before'], ['DELETE', '/deposit/depositions/', 'before']];
    assert.equal((await box.run(zenodo)).status, 1);
    const state = await stateOf();
    assert.equal(state.phase, 'draft');
    assert.ok(z.records.has(state.record));
    await box.ok(zenodo);
    assert.equal(publishes(), 2);
    assert.equal(z.records.size, 2);
    assert.ok(!z.records.has(state.record));
    l = await lineOf(a.dir, 'p');
    assert.equal(l.inv.head, 'v4');
    assert.deepEqual((await findings(box, a)).filter((x) => x.startsWith('error')), []);
    await box.ok([...a.r, 'deposit', 'p', ...paper, '--changes', 'More.']);
    z.fail = [['POST', '/actions/newversion', 'lost'], ['GET', '/deposit/depositions/', 'before']];
    assert.equal((await box.run(zenodo)).status, 1);
    assert.ok(!('record' in (await stateOf())));
    const drafts = [...z.records].filter(([, rec]) => !rec.submitted).map(([k]) => k);
    assert.equal(drafts.length, 1);
    await box.ok(zenodo);
    assert.ok(!z.records.has(drafts[0]));
    assert.equal(publishes(), 3);
    await mkdir(path.join(stage, 'version'), { recursive: true });
    await box.ok([...a.r, 'deposit', 'p', ...paper, '--changes', 'Last.']);
    await box.ok(zenodo);
    assert.equal(publishes(), 4);
    assert.ok(!existsSync(stage));
  } finally {
    await box.done();
  }
});
