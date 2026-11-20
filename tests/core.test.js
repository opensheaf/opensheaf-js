// Generated from literate/70-tests.md by opensheaf-literate: edit the document, not this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, storageFetch, readJson, compareText, StorageError } from '../core/storage.js';
import { jsonText, orderedInventory, sidecar, sha512hex } from '../core/write.js';
import { exampleKey, rotationKeyText, readRotationKey, readKey, sheetCheck, unbase32, rotationFileName,
         KeyError, PassphraseNeeded } from '../core/keys.js';
import { base32, utf8 } from '../core/crypto.js';
import { ArchiveFolder, environment, Stop } from '../core/folder.js';
import { init } from '../core/init.js';
import { deposit, creator, checkRights } from '../core/deposit.js';
import { collect } from '../core/collect.js';
import { verifyFolder } from '../core/check.js';
import { loadSchemas } from '../core/schema.js';
import { notice, withdraw, relate, relicense, describe, complete } from '../core/describe.js';
import * as collections from '../core/collections.js';
import { esc, fmtDate, pyJson, namesJoined, readableIndex } from '../core/website.js';
import { keeperLink, successorClaim, CONFIRMED, CLAIMED, NOT_CHECKED, KeeperUnreachable } from '../core/keepers.js';
import { loadEntries, merge, normalise } from '../core/inputs.js';

const schemas = await loadSchemas(async (url) => JSON.parse(await readFile(fileURLToPath(url), 'utf-8')));

function testEnvironment({ passphrase = 'correct horse' } = {}) {
  const keys = new Map(), exported = new Map(), said = [];
  let n = 0;
  const env = environment({
    out: (line) => said.push(line),
    err: (line) => said.push(line),
    newKey: () => exampleKey(`test key ${n++}`),
    fetch: async (url) => { throw new TypeError(`no network in the tests: ${url}`); },
    fetchJson: async (url) => { throw new KeeperUnreachable(`${url}: no network in the tests`); },
    template: async (name) => new Uint8Array(await readFile(new URL(`../templates/${name}`, import.meta.url))),
    passphrase: async () => passphrase,
    input: async () => '',
    keyStore: {
      keptOnDevice: () => true,
      storeName: () => 'memory',
      async current(owner, dids) {
        return dids.map((d) => keys.get(`${owner} ${d}`)).filter(Boolean);
      },
      async keep(owner, key) {
        keys.set(`${owner} ${key.did}`, key);
        return 'memory';
      },
    },
    exportFolder: {
      inside: async () => null,
      async write(folder, name, text) {
        const p = `${folder}/${name}`;
        if (exported.has(p)) throw new Error(`${p} exists`);
        exported.set(p, text);
        return p;
      },
      read: async (p) => exported.get(p),
      resolve: async (folder) => folder,
    },
  });
  return Object.assign(env, { keys, exported, said });
}

const COST = { opslimit: 1, memlimit: 8192 };
const INIT = { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
               newOwner: true, export: '/keys', yes: true, cost: COST };

async function newArchive(options = {}) {
  const storage = new MemoryStorage(), env = testEnvironment();
  const f = await init(storage, env, { ...INIT, ...options }, '/archive');
  return { storage, env, f };
}

const PDF = utf8('%PDF-1.4 a test\n');

function paper(label, more = {}) {
  return { label, new: true, source: { name: 'paper.tex', bytes: utf8('\\documentclass{article}\n') },
           pdf: { name: 'paper.pdf', bytes: PDF }, title: 'A paper', author: ['Doe, Jane|University'],
           type: 'Preprint', ...more };
}

async function errorsOf(storage) {
  const report = await verifyFolder(storage, { schemas });
  return report.findings.filter((x) => x.level !== 'result').map((x) => x.text);
}

test('a storage in memory', async () => {
  const s = new MemoryStorage();
  await s.write('a/b/c.txt', utf8('c'));
  await s.write('a/z.txt', utf8('z'));
  await s.write('a/\u{1F600}.txt', utf8('smile'));
  await s.write('a/\uFFFD.txt', utf8('replacement'));
  assert.equal(await s.kind('a'), 'dir');
  assert.equal(await s.kind('a/b/c.txt'), 'file');
  assert.equal(await s.kind('nothing'), null);
  assert.deepEqual((await s.list('a')).map((e) => e.name), ['b', 'z.txt', '\uFFFD.txt', '\u{1F600}.txt']);
  assert.equal(await s.list('nothing'), null);
  await s.rename('a/b', 'x/y');
  assert.equal(new TextDecoder().decode(await s.read('x/y/c.txt')), 'c');
  await assert.rejects(s.write('x/y/c.txt', utf8('again'), { exclusive: true }), StorageError);
  for (const bad of ['../up', '/abs', 'a//b', 'a/./b', 'a\\b', '']) await assert.rejects(s.read(bad), StorageError);
  const fetch = storageFetch(s, 'https://example.org/papers/');
  assert.equal(await (await fetch('https://example.org/papers/a/z.txt')).text(), 'z');
  assert.equal((await fetch('https://example.org/papers/a/missing')).status, 404);
  assert.equal((await fetch('https://example.org/papers/x%2F..%2Fa/z.txt')).status, 404);
  await assert.rejects(fetch('https://example.org/other/a/z.txt'), TypeError);
  assert.ok(compareText('\uFFFD', '\u{1F600}') < 0 && '\uFFFD' > '\u{1F600}');
});

test('JSON as Python writes it', () => {
  assert.equal(jsonText({ a: [], b: {}, c: [1, { d: 'é\u2028\n\u0001' }] }),
               '{\n  "a": [],\n  "b": {},\n  "c": [\n    1,\n    {\n      "d": "é\u2028\\n\\u0001"\n    }\n  ]\n}\n');
});

test('inventories in the order of opensheaf-py', async () => {
  const inv = orderedInventory({
    versions: { v10: { user: {}, state: { b: ['z'], a: ['y', 'a'] }, created: 't', zz: 1, message: 'm' },
                v2: { state: {}, created: 't' } },
    type: 'T', manifest: { x: ['v10/content/a'], y: ['v2/content/z', 'v2/content/b'], w: ['v2/content/c'] },
    id: 'I', head: 'v10', digestAlgorithm: 'sha512',
  });
  assert.deepEqual(Object.keys(inv), ['digestAlgorithm', 'head', 'id', 'manifest', 'type', 'versions']);
  assert.deepEqual(Object.keys(inv.manifest), ['y', 'w', 'x']);
  assert.deepEqual(Object.keys(inv.versions), ['v2', 'v10']);
  assert.deepEqual(Object.keys(inv.versions.v10), ['created', 'state', 'message', 'user', 'zz']);
  assert.deepEqual(Object.keys(inv.versions.v10.state), ['a', 'b']);
  const bytes = utf8(jsonText(inv));
  assert.equal(new TextDecoder().decode(await sidecar(bytes)), `${await sha512hex(bytes)}  inventory.json\n`);
});

test('creators and licences, as opensheaf-py makes them', () => {
  assert.deepEqual(creator('Doe, Jane|Uni'), { name: 'Doe, Jane', nameType: 'Personal', familyName: 'Doe',
                                              givenName: 'Jane', affiliation: [{ name: 'Uni' }] });
  assert.deepEqual(creator('Plato'), { name: 'Plato', nameType: 'Personal', familyName: 'Plato' });
  assert.equal(checkRights('cc-by-4.0'), 'cc-by-4.0');
  assert.equal(checkRights('Licensed to the journal'), 'Licensed to the journal');
  assert.throws(() => checkRights('cc-by-4'), /not a licence known/);
  assert.throws(() => checkRights('two\nlines'), /one line/);
});

test('rotation key files, in clear and under a passphrase', async () => {
  const key = await exampleKey('authors rotation 1');
  const owner = 'a'.repeat(51) + 'a';
  const plain = await rotationKeyText(key, owner, 1);
  assert.match(plain, /^opensheaf-rotation-key\/0\.2\nowner a{52}\nversion v1\nkey did:key:z6Mk[^\n]+\ndigest [a-z2-7]{52}\nencryption none\nseed [A-Za-z0-9+/]{43}=\n$/);
  assert.equal((await readRotationKey(plain)).key.did, key.did);
  assert.equal((await readRotationKey(plain)).version, 1);
  assert.equal(rotationFileName(owner, key), `rotation-${'a'.repeat(16)}-${key.id}.txt`);
  const locked = await rotationKeyText(key, owner, 1, 'secret', COST);
  assert.match(locked, /\nencryption argon2id-secretbox opslimit=1 memlimit=8192 salt=[A-Za-z0-9+/]{22}==\nseed /);
  assert.equal((await readRotationKey(locked, 'secret')).key.did, key.did);
  await assert.rejects(readRotationKey(locked), PassphraseNeeded);
  await assert.rejects(readRotationKey(locked, 'wrong'), /wrong passphrase/);
  await assert.rejects(readRotationKey(locked.replace('opslimit=1', 'opslimit=9'), 'secret'), /out of bounds/);
  await assert.rejects(readRotationKey(plain.replace(/seed (.)/, (m, c) => `seed ${c === 'A' ? 'B' : 'A'}`)),
                       /not that of the key/);
  await assert.rejects(readRotationKey(plain.replace('seed ', 'seed !')), /not base64/);
  await assert.rejects(readRotationKey(plain.replace('encryption none', 'encryption rot13')), /unknown encryption/);
  await assert.rejects(readRotationKey(plain.replace('opensheaf-rotation-key/0.2', 'opensheaf-key/0.2\nkind current')),
                       KeyError);
});

test('sheets typed back, with their checks', async () => {
  const key = await exampleKey('authors rotation 2');
  const check = await sheetCheck(key.seed);
  const groups = base32(key.seed).toUpperCase().match(/.{1,4}/g).join(' ');
  const sheet = `opensheaf-key-text/0.2\nkind rotation\nkey ${key.did}\nseed ${groups}\ncheck ${check}\n`;
  assert.equal((await readKey(sheet)).key.did, key.did);
  const typo = sheet.replace(/seed (.)/, (m, c) => `seed ${c === 'A' ? 'B' : 'A'}`);
  await assert.rejects(readKey(typo), /mistyped/);
  assert.deepEqual(unbase32(base32(key.seed)), key.seed);
  assert.throws(() => unbase32('abc'), KeyError);
});

test('init, deposit, collect, verify, in memory', async () => {
  const { storage, env, f } = await newArchive();
  const cfg = await readJson(storage, 'osheaf.json');
  assert.deepEqual(Object.keys(cfg), ['owner', 'name', 'contact', 'baseUrl', 'profiles', 'storageLayout',
                                      'mainCollection', 'curator', 'depositor', 'index']);
  assert.deepEqual(cfg.profiles, ['website']);
  assert.equal(await storage.kind('templates/paper.html'), 'file');
  assert.equal(await storage.kind('index.html'), 'file');
  assert.equal(env.exported.size, 3);
  for (const text of env.exported.values()) assert.equal((await readRotationKey(text, 'correct horse')).owner, cfg.owner);
  assert.deepEqual(await errorsOf(storage), []);
  const disc = await readJson(storage, 'opensheaf.json');
  assert.deepEqual(disc.objects.map((o) => [o.kind, o.head, o.label ?? null]).sort(),
                   [['collection', 'v1', 'main'], ['owner', 'v1', null]]);
  await deposit(f, paper('first', { abstract: '  An abstract.  ', keyword: ['x'], rights: 'cc-by-4.0' }));
  await deposit(f, { ...paper('first', { new: false }), pdf: { name: 'v2.pdf', bytes: utf8('%PDF-1.4 two') } });
  await collect(f);
  await readableIndex(f);
  assert.deepEqual(await errorsOf(storage), []);
  const g = await ArchiveFolder.open(storage, env);
  const id = g.labels.get('first');
  const dir = await g.dirOf(id);
  const inv = await g.inventory(dir);
  assert.equal(inv.head, 'v2');
  const dc = await g.readObjectJson(dir, inv, 'datacite.json');
  assert.equal(dc.descriptions[0].description, 'An abstract.');
  assert.equal(dc.rightsList[0].rightsIdentifier, 'cc-by-4.0');
  assert.deepEqual(dc.subjects, [{ subject: 'x' }]);
  const obj = await g.readObjectJson(dir, inv, 'object.json');
  assert.equal(obj.documentVersion, 2);
  assert.equal(obj.previous, (await sha512hex(await storage.read(`${dir}/v1/inventory.json`))));
  assert.deepEqual(Object.keys(inv.fixity), ['md5', 'sha256']);
  const main = await g.readObjectJson(await g.dirOf(g.labels.get('main')), await g.inventory(await g.dirOf(g.labels.get('main'))), 'members.json');
  assert.deepEqual(main.members.map((m) => [m.name, m.version]), [[id.split(':')[1], 'v2']]);
  assert.equal(await g.latestSigned(id), 'v2');
});

test('what a deposit refuses', async () => {
  const { f, env } = await newArchive();
  await deposit(f, paper('taken'));
  await assert.rejects(deposit(f, paper('taken')), /label of a line already/);
  await assert.rejects(deposit(f, paper('nothing', { new: false })), /no line labelled nothing/);
  await assert.rejects(deposit(f, paper('Bad_Label')), /a label must match/);
  await assert.rejects(deposit(f, paper('nopdf', { pdf: null })), /give the PDF/);
  await assert.rejects(deposit(f, paper('notpdf', { pdf: { name: 'x.pdf', bytes: utf8('hello') } })), /x.pdf is not a PDF/);
  await assert.rejects(deposit(f, paper('nosource', { source: null })), /--no-source REASON/);
  await assert.rejects(deposit(f, paper('both', { created: '2020-01-01', available: '2020-02-01' })), /not both/);
  await assert.rejects(deposit(f, paper('tm', { source: { name: 'x.tm', bytes: utf8('') }, pdf: null })), /TeXmacs/);
  env.keys.clear();
  await assert.rejects(deposit(f, paper('unsigned')), (e) => e instanceof Stop && /holds 0 of the current keys/.test(e.message));
});

test('a file changed behind the archive', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('changed'));
  const dir = await f.dirOf(f.labels.get('changed'));
  await storage.write(`${dir}/v1/content/paper.pdf`, utf8('%PDF-1.4 another'));
  assert.ok((await errorsOf(storage)).some((e) => /paper\.pdf does not have the digest of the manifest/.test(e)));
});

test('rotation keys are not exported into an archive', async () => {
  const storage = new MemoryStorage(), env = testEnvironment();
  env.exportFolder.inside = async () => '/archive';
  await assert.rejects(init(storage, env, INIT, '/archive'), /inside the archive/);
  assert.equal(await storage.kind('osheaf.json'), null);
});

async function head(f, label, logical = 'object.json') {
  const dir = await f.dirOf(f.labels.get(label));
  const inv = await f.inventory(dir);
  return { inv, json: await f.readObjectJson(dir, inv, logical), dir };
}

test('notices, withdrawals, relations, licences, corrections', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('doc', { rights: 'cc-by-4.0' }));
  await notice(f, { label: 'doc', about: 1, text: 'A notice.', file: { name: 'n.md', bytes: utf8('# n') } });
  let h = await head(f, 'doc');
  assert.equal(h.inv.head, 'v2');
  assert.equal(h.json.documentVersion, 1);
  assert.deepEqual(h.json.notices[0], { text: 'A notice.', path: 'notices/n.md', mediaType: 'text/markdown',
                                        documentVersion: 1, date: f.env.today() });
  await assert.rejects(notice(f, { label: 'doc', about: 2, text: 'x' }), /has no document version 2/);
  await relate(f, { label: 'doc', to: 'arxiv:2501.00001', issued: '2024-12-01' });
  await assert.rejects(relate(f, { label: 'doc', to: 'arxiv:2501.00001' }), /already relates/);
  await assert.rejects(relate(f, { label: 'doc', to: 'isbn:1' }), /--to must be/);
  await relicense(f, { label: 'doc', rights: 'cc0-1.0', method: 'by email' });
  await assert.rejects(relicense(f, { label: 'doc', rights: 'cc0-1.0', method: 'again' }), /already has cc0-1.0/);
  await describe(f, { label: 'doc', title: 'Another title', keyword: ['k'] });
  await assert.rejects(describe(f, { label: 'doc', title: 'Another title' }), /nothing to change/);
  const dc = (await head(f, 'doc', 'datacite.json')).json;
  assert.equal(dc.titles[0].title, 'Another title');
  assert.deepEqual(dc.rightsList.map((r) => r.rightsIdentifier), ['cc0-1.0']);
  assert.ok(dc.dates.some((d) => d.dateType === 'Updated'));
  assert.ok(dc.relatedIdentifiers.some((r) => r.relatedIdentifier === 'arXiv:2501.00001'));
  await withdraw(f, { label: 'doc', reason: 'An error.' });
  await assert.rejects(withdraw(f, { label: 'doc', reason: 'again' }), /withdrawn already/);
  h = await head(f, 'doc');
  assert.equal(h.json.status, 'withdrawn');
  assert.equal(h.inv.head, 'v6');
  assert.ok(Object.values(h.inv.versions.v6.state).flat().includes('notices/n.md'));
  await assert.rejects(deposit(f, paper('doc', { new: false })), /is withdrawn/);
  assert.deepEqual(await errorsOf(storage), []);
});

test('a completion adds the sources, and keeps the state of the head', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('bare', { source: null, noSource: 'lost' }));
  await notice(f, { label: 'bare', about: 1, text: 'Sources found.' });
  await assert.rejects(complete(f, { label: 'bare', version: 2, source: { name: 'p.tex', bytes: utf8('x') } }),
                       /no document version 2/);
  await complete(f, { label: 'bare', version: 1, source: { name: 'p.tex', bytes: utf8('\\relax') },
                      extraSource: [{ logical: 'refs.bib', bytes: utf8('@x') }] });
  const h = await head(f, 'bare');
  assert.equal(h.json.mainSource, 'p.tex');
  assert.equal(h.json.notices.length, 1);
  assert.equal(h.json.sourcesMissing, undefined);
  await assert.rejects(complete(f, { label: 'bare', version: 1, source: { name: 'q.tex', bytes: utf8('x') } }),
                       /has its sources already/);
  assert.deepEqual(await errorsOf(storage), []);
});

test('a description extends unsigned versions only when told', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('weak'));
  const dir = await f.dirOf(f.labels.get('weak'));
  for (const e of await storage.list(`${dir}/extensions/opensheaf-witnesses/v1`)) {
    await storage.remove(`${dir}/extensions/opensheaf-witnesses/v1/${e.name}`);
  }
  f.changed();
  await assert.rejects(notice(f, { label: 'weak', about: 1, text: 'x' }), /give --i-know/);
  await notice(f, { label: 'weak', about: 1, text: 'x', iKnow: true });
  assert.equal((await head(f, 'weak')).inv.head, 'v2');
});

test('collections of the archive, and the website', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('one', { issued: '2020-01-01' }));
  await deposit(f, paper('two', { issued: '2021-01-01' }));
  await collect(f);
  await collections.newCollection(f, { label: 'picks', type: 'selection', title: 'Picks', description: 'Chosen.' });
  await assert.rejects(collections.newCollection(f, { label: 'picks', type: 'selection', title: 'x' }), /a new label/);
  await collections.add(f, { collection: 'picks', uri: ['one', 'two'], revision: [] });
  await collections.newCollection(f, { label: 'cat', type: 'catalogue', title: 'Cat', order: 'issued-asc' });
  await collections.add(f, { collection: 'cat', uri: ['two', 'one'], follow: true });
  await assert.rejects(collections.add(f, { collection: 'cat', uri: ['one'] }), /a member already/);
  let mem = (await head(f, 'cat', 'members.json')).json;
  assert.deepEqual(mem.members.map((m) => m.cite.issued), ['2020-01-01', '2021-01-01']);
  assert.deepEqual(mem.members[0].at, ['https://example.org/papers/']);
  await deposit(f, paper('one', { new: false, pdf: { name: 'v2.pdf', bytes: utf8('%PDF-1.4 v2') } }));
  await collections.update(f, { collection: ['cat'] });
  mem = (await head(f, 'cat', 'members.json')).json;
  assert.equal(mem.members[0].version, 'v2');
  await collections.remove(f, { collection: 'picks', uri: ['two'] });
  assert.equal((await head(f, 'picks', 'members.json')).json.members.length, 1);
  await assert.rejects(collections.remove(f, { collection: 'picks', uri: ['nobody'] }), /no member matches/);
  f.index.html.featured = 'picks';
  await readableIndex(f);
  const home = new TextDecoder().decode(await storage.read('index.html'));
  assert.match(home, /<section class="featured">/);
  assert.equal(await storage.kind('paper/picks/index.html'), 'file');
  assert.deepEqual(await errorsOf(storage), []);
  const landing = new TextDecoder().decode(await storage.read('paper/one/index.html'));
  assert.match(landing, new RegExp(`sheaf:${f.labels.get('one').split(':')[1]}`));
  await storage.remove('paper/one/index.html');
  assert.ok((await errorsOf(storage)).some((e) => /no landing page giving the sheaf: URI of one/.test(e)));
});

test('the small pieces of the pages', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#x27;&amp;&#x27;&lt;/a&gt;');
  assert.equal(fmtDate('2026-06-03'), '3 June 2026');
  assert.equal(fmtDate('2019-03'), 'March 2019');
  assert.equal(namesJoined(['A', 'B', 'C']), 'A, B and C');
  assert.equal(pyJson({ a: [1, 'x'], b: { c: null } }), '{"a": [1, "x"], "b": {"c": null}}');
});

test('the link to a keeper', async () => {
  const { f } = await newArchive({ keeper: 'https://orcid.org/0000-0002-1825-0097' });
  const log = await f.keyLog(f.archive.owner);
  const succ = 'b'.repeat(51) + 'a';
  const orcid = async () => ({ 'researcher-url': [{ url: { value: `https://x.org/${log.owner}/${succ}` } }] });
  let link = await keeperLink(log, orcid);
  assert.equal(link.status, CONFIRMED);
  assert.equal(link.successor, succ);
  assert.equal(successorClaim(log, link), 'named by the keeper (section 6.6)');
  link = await keeperLink(log, async () => ({ 'researcher-url': [] }));
  assert.equal(link.status, CLAIMED);
  link = await keeperLink(log, async () => { throw new KeeperUnreachable('x: HTTP 500'); });
  assert.deepEqual([link.status, link.reason], [NOT_CHECKED, 'offline: x: HTTP 500']);
  const g = await newArchive({ keeper: 'https://example.org/' });
  const glog = await g.f.keyLog(g.f.archive.owner);
  let asked = null;
  link = await keeperLink(glog, async (url) => {
    asked = url;
    return { format: 'opensheaf-keeper/0.2', owners: [glog.owner] };
  });
  assert.equal(asked, 'https://example.org/.well-known/opensheaf');
  assert.equal(link.status, CONFIRMED);
  link = await keeperLink(glog, async () => null);
  assert.equal(link.reason, 'there is no https://example.org/.well-known/opensheaf');
});

test('options read from a file', async () => {
  const text = 'id: p\ntitle: 2611.14296\nauthors:\n  - {name: "Doe, Jane", affiliation: U}\n' +
               'source: paper.tex\nextra-sources: [{file: a.bib, path: b/a.bib}]\navailable: 2025-01-02\n';
  const [e] = await loadEntries('dir/p.yaml', text);
  assert.deepEqual(e, { id: 'p', title: '2611.14296', author: ['Doe, Jane|U'], source: 'dir/paper.tex',
                        extra_source: ['dir/a.bib=b/a.bib'], available: '2025-01-02' });
  const merged = merge({ label: null, title: 'Given', author: [] }, e,
                       { label: null, title: undefined, author: [], source: null, extraSource: [], available: undefined },
                       'deposit', { id: 'label' });
  assert.equal(merged.title, 'Given');
  assert.equal(merged.label, 'p');
  assert.throws(() => merge({}, { nonsense: 1 }, {}, 'deposit'), /unknown option\(s\) in the file: nonsense/);
  assert.deepEqual(normalise({ 'Date-Info': 'x', tools: { pdflatex: '2025' } }, ''), { date_info: 'x', toolchain: ['pdflatex=2025'] });
});
