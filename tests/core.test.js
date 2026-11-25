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
import { deposit, creator, checkRights, nameAddress } from '../core/deposit.js';
import { descriptionErrors } from '../core/rules.js';
import { collect, memberOrder } from '../core/collect.js';
import { verifyFolder, landingDescriptionGaps } from '../core/check.js';
import { loadSchemas } from '../core/schema.js';
import { notice, withdraw, relate, relicense, describe, complete } from '../core/describe.js';
import * as collections from '../core/collections.js';
import { esc, fmtDate, pyJson, jsonInScript, namesJoined, readableIndex, present, safeUrl, link, fill, number }
  from '../core/website.js';
import { keeperLink, successorClaim, CONFIRMED, CLAIMED, NOT_CHECKED, KeeperUnreachable } from '../core/keepers.js';
import { loadEntries, merge, normalise } from '../core/inputs.js';
import { mirror, fetchObject, Unavailable } from '../core/mirror.js';
import { branch } from '../core/branch.js';
import { draftDeposit, draftDelete, seal } from '../core/drafts.js';
import { takedown } from '../core/takedown.js';
import { Resolver } from '../core/resolve.js';
import { Http } from '../core/http.js';
import { verify } from '../core/verify.js';
import { Archive } from '../core/archive.js';
import { verdict, level, levelOfVersion, INCONSISTENT } from '../core/branches.js';
import { writeDiscovery, PAGING } from '../core/discovery.js';
import { ownerRotate } from '../core/owner.js';
import { loadKeyLog } from '../core/keylogs.js';
import { WITNESSES, fileName } from '../core/signatures.js';
import { currentVersion, versionsOf, withdrawnVersions, dateOf } from '../core/versions.js';

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
                                      'curator', 'depositor', 'index']);
  assert.deepEqual(cfg.profiles, ['website']);
  assert.equal(await storage.kind('templates/paper.html'), 'file');
  assert.equal(await storage.kind('index.html'), 'file');
  assert.equal(env.exported.size, 3);
  for (const text of env.exported.values()) assert.equal((await readRotationKey(text, 'correct horse')).owner, cfg.owner);
  assert.deepEqual(await errorsOf(storage), []);
  const disc = await readJson(storage, 'opensheaf.json');
  assert.deepEqual(disc.objects.map((o) => [o.kind, o.head, o.label ?? null]).sort(),
                   [['collection', 'v1', 'main'], ['owner', 'v1', null]]);
  assert.deepEqual(disc.owners, [{ owner: cfg.owner, catalogue: f.labels.get('main') }]);
  assert.equal('mainCollection' in disc, false);
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
  assert.equal(dc.url, `https://example.org/papers/paper/${id.split(':')[1]}/`);
  await deposit(f, paper('old-notes', { created: '2019-05-01' }));
  const notes = (await head(f, 'old-notes', 'datacite.json')).json;
  assert.deepEqual([dateOf(notes, 'Available'), dateOf(notes, 'Created')], [env.today(), '2019-05-01']);
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
  await assert.rejects(deposit(f, paper('tm', { source: { name: 'x.tm', bytes: utf8('') }, pdf: null })), /TeXmacs/);
  env.keys.clear();
  await assert.rejects(deposit(f, paper('unsigned')), (e) => e instanceof Stop && /holds 0 of the current keys/.test(e.message));
});

test('no version on a head whose checksum file is wrong (section 4.1)', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('paper-a'));
  const dir = await f.dirOf(f.labels.get('paper-a'));
  const sc = `${dir}/v1/inventory.json.sha512`;
  const good = await storage.read(sc);
  for (const bad of [null, utf8('not a checksum file'), await sidecar(utf8('other bytes'))]) {
    if (bad === null) await storage.remove(sc);
    else await storage.write(sc, bad);
    await assert.rejects(deposit(f, { ...paper('paper-a', { new: false }), pdf: { name: 'v2.pdf', bytes: utf8('%PDF-1.4 two') } }),
                         /the checksum file of its inventory is missing/);
    assert.equal((await f.inventory(dir)).head, 'v1');
    assert.equal(await storage.kind(`${dir}/v2`), null);
  }
  await storage.write(sc, good);
  await deposit(f, { ...paper('paper-a', { new: false }), pdf: { name: 'v2.pdf', bytes: utf8('%PDF-1.4 two') } });
  const inv = await f.inventory(dir);
  assert.equal((await f.readObjectJson(dir, inv, 'object.json')).previous, await sha512hex(await storage.read(`${dir}/v1/inventory.json`)));
});

test('a deposit of the current files is refused; a revert is a new version (section 4.2)', async () => {
  const { storage, f } = await newArchive();
  const pdf = (text) => ({ name: 'p.pdf', bytes: utf8(`%PDF-1.4 ${text}`) });
  await deposit(f, paper('p', { pdf: pdf('one') }));
  await assert.rejects(deposit(f, paper('p', { new: false, pdf: pdf('one') })),
                       /p: these are the files and the change note of the current version, document version 1: nothing new to deposit \(section 4\.2\)/);
  await deposit(f, paper('p', { new: false, pdf: pdf('two') }));
  await deposit(f, paper('p', { new: false, pdf: pdf('one') }));
  let h = await head(f, 'p');
  assert.equal(h.inv.head, 'v3');
  assert.equal(h.json.documentVersion, 3);
  await collect(f);
  await readableIndex(f);
  assert.deepEqual(await errorsOf(storage), []);
  const id = f.labels.get('p');
  const repeat = async (n, rename = null) => {
    h = await head(f, 'p');
    const files = new Map();
    for (const p of Object.values(h.inv.versions[h.inv.head].state).flat()) {
      if (p !== 'object.json') files.set(p === rename ? 'renamed.tex' : p, await f.readLogical(h.dir, h.inv, p));
    }
    const obj = { ...h.json, documentVersion: n };
    if (rename) obj.mainSource = 'renamed.tex';
    await f.addVersion(id, files, obj, `document version ${n}`);
  };
  await repeat(4);
  await repeat(5, 'paper.tex');
  assert.deepEqual((await errorsOf(storage)).filter((e) => e.includes('section 4.2')),
                   ['p: v4 document version 4 holds the same files and change note as the current version 3: ' +
                    'it is no new document version (section 4.2)']);
});

async function again(f, label, change, replace = {}) {
  const h = await head(f, label);
  const files = new Map();
  for (const p of Object.values(h.inv.versions[h.inv.head].state).flat()) {
    if (p !== 'object.json') files.set(p, await f.readLogical(h.dir, h.inv, p));
  }
  for (const [p, bytes] of Object.entries(replace)) files.set(p, bytes);
  const obj = structuredClone(h.json);
  change(obj);
  return f.addVersion(f.labels.get(label), files, obj, 'a version written by hand');
}

test('a description-only version keeps the fields of its document version (section 4.2)', async () => {
  const { storage, f } = await newArchive();
  const arxiv = { role: 'source', service: 'arXiv', record: 'https://arxiv.org/abs/2601.00001v1' };
  const zenodo = { role: 'deposit', service: 'Zenodo', record: 'https://zenodo.org/records/1' };
  for (const label of ['pa', 'pb', 'pc', 'pd']) await deposit(f, paper(label));
  await again(f, 'pa', (o) => { o.renditions = o.renditions.map((r) => ({ ...r, mediaType: 'application/octet-stream' })); });
  await again(f, 'pb', (o) => { o.external = [arxiv]; });
  await again(f, 'pb', (o) => { o.external = [arxiv, zenodo]; });
  await again(f, 'pc', (o) => { o.external = [arxiv]; });
  await again(f, 'pc', (o) => { delete o.external; });
  await again(f, 'pd', (o) => { o.toolchain = [{ name: 'TeX Live', version: '2026' }]; });
  assert.deepEqual((await errorsOf(storage)).filter((e) => e.includes('section 4.2')).sort(), [
    'pa: v2 changes renditions of document version 1, which belongs to it (section 4.2)',
    'pc: v3 drops or changes an external record of document version 1 (section 4.2)',
    'pd: v2 changes toolchain of document version 1, which belongs to it (section 4.2)',
  ]);
});

test('a withdrawal is kept until a new document version, which reinstates the line (section 13.1)', async () => {
  const { storage, f } = await newArchive();
  const gone = { date: '2026-03-01', reason: { text: 'An error.' } };
  const withdrawn = (o) => { o.status = 'withdrawn'; o.withdrawal = gone; };
  for (const label of ['pa', 'pb', 'pc']) await deposit(f, paper(label));
  await again(f, 'pa', withdrawn);
  await again(f, 'pa', (o) => { o.status = 'active'; delete o.withdrawal; });
  await again(f, 'pb', (o) => { withdrawn(o); o.documentVersion = 2; }, { 'paper.pdf': utf8('%PDF-1.4 two\n') });
  await again(f, 'pc', withdrawn);
  await again(f, 'pc', (o) => { o.status = 'active'; delete o.withdrawal; o.documentVersion = 2; },
              { 'paper.pdf': utf8('%PDF-1.4 two\n') });
  const errors = (await errorsOf(storage)).filter((e) => e.includes('(section 13.1)'));
  assert.deepEqual(errors.sort(), [
    'pa: v3 drops or changes the withdrawal of v2: only a new document version reinstates a line (section 13.1)',
    'pb: v2 is a new document version and a withdrawal: a withdrawal is a description-only version (section 13.1)',
  ]);
  const h = await head(f, 'pc');
  const objs = new Map();
  for (const v of Object.keys(h.inv.versions)) objs.set(v, await f.readObjectJson(h.dir, h.inv, 'object.json', v));
  assert.deepEqual([...withdrawnVersions(h.inv, (v) => objs.get(v) ?? null)], [[1, 'v2']]);
});

test('collections follow the rules of documents (section 4.2)', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('one'));
  await deposit(f, paper('two'));
  await collect(f);
  await collections.newCollection(f, { label: 'list', type: 'catalogue', title: 'List' });
  await collections.add(f, { collection: 'list', uri: ['one'] });
  await collections.add(f, { collection: 'list', uri: ['two'] });
  let h = await head(f, 'list');
  assert.equal(h.json.documentVersion, 3);
  const at = async (n, ver) => {
    const dc = await f.readObjectJson(h.dir, h.inv, 'datacite.json');
    return { 'members.json': await f.readLogical(h.dir, h.inv, 'members.json', ver),
             'datacite.json': utf8(jsonText({ ...dc, version: String(n) })) };
  };
  await again(f, 'list', (o) => { o.documentVersion = 2; }, await at(2, 'v2'));
  h = await head(f, 'list');
  const objs = new Map();
  for (const v of versionsOf(h.inv)) objs.set(v, await f.readObjectJson(h.dir, h.inv, 'object.json', v));
  assert.equal(currentVersion(h.inv, (v) => objs.get(v)), 'v3');
  assert.deepEqual((await errorsOf(storage)).filter((e) => e.startsWith('list:')), []);
  await again(f, 'list', (o) => { o.documentVersion = 3; }, await at(3, 'v1'));
  assert.ok((await errorsOf(storage)).includes('list: v5 has other files than document version 3'));
});

test('notices replace earlier ones about the same version, once (section 4.2)', async () => {
  const { storage, f } = await newArchive();
  const first = { documentVersion: 1, date: '2026-02-01', text: 'Theorem 2 is wrong as stated.' };
  const fix = { documentVersion: 1, date: '2026-03-01', text: 'Theorem 2 is right.', replaces: 1 };
  for (const label of ['pa', 'pb', 'pc', 'pd']) await deposit(f, paper(label));
  await again(f, 'pa', (o) => { o.notices = [first]; });
  await again(f, 'pa', (o) => { o.notices = [first, fix]; });
  await again(f, 'pb', (o) => { o.notices = [first, { ...fix, documentVersion: 2 }]; });
  await again(f, 'pc', (o) => { o.notices = [first, fix, { ...fix, text: 'Again.' }]; });
  await again(f, 'pd', (o) => { o.notices = [fix]; });
  assert.deepEqual((await errorsOf(storage)).filter((e) => / notice \d/.test(e)).sort(), [
    'pb: v2 notice 2 replaces notice 1, about another document version',
    'pc: v2 notice 3 replaces notice 1, which is already replaced',
    'pd: v2 notice 1 replaces no earlier notice (1)',
  ]);
});

test('digests in upper case are reported (section 4.1)', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('pa'));
  await deposit(f, paper('pb'));
  assert.deepEqual(await errorsOf(storage), []);
  let dir = await f.dirOf(f.labels.get('pa'));
  const sc = new TextDecoder().decode(await storage.read(`${dir}/inventory.json.sha512`));
  await storage.write(`${dir}/inventory.json.sha512`, utf8(`${sc.split(' ')[0].toUpperCase()}  inventory.json\n`));
  dir = await f.dirOf(f.labels.get('pb'));
  const inv = JSON.parse(new TextDecoder().decode(await storage.read(`${dir}/inventory.json`)));
  inv.manifest = Object.fromEntries(Object.entries(inv.manifest).map(([k, v]) => [k.toUpperCase(), v]));
  for (const v of Object.values(inv.versions)) {
    v.state = Object.fromEntries(Object.entries(v.state).map(([k, p]) => [k.toUpperCase(), p]));
  }
  await storage.write(`${dir}/inventory.json`, utf8(JSON.stringify(inv, null, 2) + '\n'));
  const errors = await errorsOf(storage);
  assert.ok(errors.includes('pa: inventory.json.sha512 states its digest not in lower case (section 4.1)'), errors.join('\n'));
  assert.ok(errors.includes('pb: the inventory has digests not in lower case (section 4.1)'), errors.join('\n'));
});

test('JSON nested too deep is a finding (section 15.2)', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('deep'));
  const dir = await f.dirOf(f.labels.get('deep'));
  const deep = '['.repeat(20000) + ']'.repeat(20000);
  for (const p of [`${dir}/inventory.json`, `${dir}/v1/inventory.json`]) {
    const t = new TextDecoder().decode(await storage.read(p)).replace(/"state": \{/, `"state": { "x": ${deep},`);
    await storage.write(p, utf8(t));
    await storage.write(`${p}.sha512`, utf8(`${await sha512hex(utf8(t))}  inventory.json\n`));
  }
  const errors = await errorsOf(storage);
  assert.ok(errors.some((e) => e.includes('an object without a readable inventory')), errors.join('\n'));
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
  await assert.rejects(deposit(f, paper('doc', { new: false })), /the files and the change note of the current version/);
  await deposit(f, paper('doc', { new: false, pdf: { name: 'paper.pdf', bytes: utf8('%PDF-1.4 two\n') },
                                  changes: 'Corrected; the error is fixed.' }));
  assert.ok(f.env.said.some((l) => l.startsWith('Note: doc is withdrawn; this version reinstates it')), f.env.said.join('\n'));
  h = await head(f, 'doc');
  assert.equal(h.inv.head, 'v7');
  assert.equal(h.json.documentVersion, 2);
  assert.equal(h.json.status, 'active');
  assert.ok(!('withdrawal' in h.json));
  const objOf = async () => {
    const m = new Map();
    for (const v of Object.keys(h.inv.versions)) m.set(v, await f.readObjectJson(h.dir, h.inv, 'object.json', v));
    return (v) => m.get(v) ?? null;
  };
  assert.deepEqual([...withdrawnVersions(h.inv, await objOf())], [[1, 'v6']]);
  assert.deepEqual(await errorsOf(storage), []);
  await readableIndex(f);
  const page = new TextDecoder().decode(await storage.read('paper/doc/index.html'));
  assert.equal(page.split('class="withdrawn"').length - 1, 1);
  await withdraw(f, { label: 'doc', reason: 'Another error.' });
  h = await head(f, 'doc');
  assert.deepEqual([...withdrawnVersions(h.inv, await objOf())], [[1, 'v6'], [2, 'v8']]);
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

test('a notice replaces an earlier one, once (section 4.2)', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('p'));
  await deposit(f, paper('p', { new: false, pdf: { name: 'paper.pdf', bytes: utf8('%PDF-1.4 two\n') } }));
  await notice(f, { label: 'p', about: 1, text: 'Lemma 2 is wrong as stated.' });
  await notice(f, { label: 'p', about: 2, text: 'Lemma 3 is wrong too.' });
  await assert.rejects(notice(f, { label: 'p', about: 1, text: 'x', replaces: 3 }), /p has no notice 3 \(it has 2\)/);
  await assert.rejects(notice(f, { label: 'p', about: 1, text: 'x', replaces: 2 }),
                       /notice 2 is about document version 2, not 1: a notice replaces one about the same version/);
  await notice(f, { label: 'p', about: 1, text: 'Lemma 2 is right after all.', replaces: 1 });
  await assert.rejects(notice(f, { label: 'p', about: 1, text: 'Again.', replaces: 1 }), /notice 1 is already replaced/);
  const h = await head(f, 'p');
  assert.deepEqual(h.json.notices.map((n) => n.replaces ?? null), [null, null, 1]);
  assert.deepEqual(await errorsOf(storage), []);
});

test('the order of an owner catalogue is reproducible from its member list (section 8.2)', async () => {
  const { storage, f } = await newArchive();
  for (const [label, available, pdf] of [['pa', '2026-01-03', 'a'], ['pb', '2026-01-05', 'b'], ['pc', '2026-01-04', 'c']]) {
    await deposit(f, paper(label, { issued: '2026-01-01', available, pdf: { name: 'paper.pdf', bytes: utf8(`%PDF-1.4 ${pdf}`) } }));
  }
  await collect(f);
  await readableIndex(f);
  assert.deepEqual(await errorsOf(storage), []);
  const members = (await head(f, 'main', 'members.json')).json.members;
  assert.deepEqual(members.map((m) => m.cite.available), ['2026-01-05', '2026-01-04', '2026-01-03']);
  assert.deepEqual(memberOrder(structuredClone(members).reverse()), members);
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
  const oneName = f.labels.get('one').split(':')[1];
  assert.match(landing, new RegExp(`sheaf:${oneName}`));
  assert.equal(new TextDecoder().decode(await storage.read(`paper/${oneName}/index.html`)), landing);
  await storage.remove(`paper/${oneName}/index.html`);
  assert.ok((await errorsOf(storage)).some((e) => /no landing page giving the sheaf: URI of one/.test(e)));
});

test('what a member says is escaped', async () => {
  assert.equal(fill('{{a}} {{b}} {{c}}', { a: '{{b}}', b: 'X' }), '{{b}} X {{c}}');
  assert.equal(number(3), '3');
  assert.equal(number('<b>'), '?');
  assert.equal(number(true), '?');
  const { storage, f, env } = await newArchive();
  const asked = [];
  env.fetch = async (url) => { asked.push(url); throw new TypeError(`no network in the tests: ${url}`); };
  await deposit(f, paper('one'));
  await collections.newCollection(f, { label: 'list', type: 'catalogue', title: '{{versions}}' });
  const [, nm, owner] = f.labels.get('one').split(':');
  const m = { kind: 'document', name: 'a'.repeat(64), owner: 'b'.repeat(64), at: ['https://example.org/other/'],
              revisions: [{ version: 'v1', documentVersion: '<img src=x onerror=alert(1)>',
                            inventorySha512: '"><script>alert(2)</script>' }],
              cite: { title: '{{versions}}' } };
  const bad = { kind: 'document', name: nm, owner, version: 'v99', at: [],
                inventorySha512: '"><script>alert(3)</script>' };
  const listId = f.labels.get('list');
  const mem = (await head(f, 'list', 'members.json')).json;
  await collections.write(f, listId, { ...mem, members: [bad, m] }, { message: 'by hand' });
  f.index.html.featured = 'list';
  await readableIndex(f);
  assert.deepEqual(asked, []);
  const pages = ['index.html', ...((await storage.list('paper')) || []).map((e) => `paper/${e.name}/index.html`)];
  for (const p of pages) {
    const page = new TextDecoder().decode(await storage.read(p));
    assert.ok(!page.includes('<script>alert') && !page.includes('<img src=x'), p);
  }
  const home = new TextDecoder().decode(await storage.read('index.html'));
  assert.match(home, /no valid pin/);
  assert.match(home, /vetted: version \?/);
  const page = new TextDecoder().decode(await storage.read('paper/list/index.html'));
  assert.ok(page.includes('{{versions}}'));
  assert.equal(page.split('<li class="version').length - 1, 2);
  assert.match(new TextDecoder().decode(await storage.read('sitemap.xml')), /<lastmod>/);
});

test('JSON nested too deeply', async () => {
  const { parseJson } = await import('../core/http.js');
  assert.deepEqual(parseJson(utf8('['.repeat(64) + ']'.repeat(64))).length, 1);
  for (const text of ['['.repeat(65) + ']'.repeat(65), '['.repeat(400000) + ']'.repeat(400000), '{"a":'.repeat(65) + '1' + '}'.repeat(65)]) {
    assert.throws(() => parseJson(utf8(text)), /nested/);
  }
  const { storage, f, env } = await newArchive();
  env.fetch = async () => new Response('['.repeat(400000) + ']'.repeat(400000));
  await collections.newCollection(f, { label: 'list', type: 'catalogue', title: 'List' });
  const m = { kind: 'document', name: 'a'.repeat(52), owner: 'b'.repeat(52), at: ['https://example.org/deep/'],
              version: 'v1', inventorySha512: 'c'.repeat(128), cite: { title: 'Cached' } };
  const mem = (await head(f, 'list', 'members.json')).json;
  await collections.write(f, f.labels.get('list'), { ...mem, members: [m] }, { message: 'by hand' });
  f.index.html.featured = 'list';
  await readableIndex(f);
  const home = new TextDecoder().decode(await storage.read('index.html'));
  assert.match(home, /Cached/);
  assert.match(home, /archive unavailable: cached citation/);
});

test('a pin whose number bounds nothing', async () => {
  const obj = utf8(JSON.stringify({ documentVersion: 1 }));
  const d = await sha512hex(obj);
  const ver = 'v999999999999';
  const inv = utf8(JSON.stringify({ head: ver, versions: { [ver]: { state: { [d]: ['object.json'] } } },
                                    manifest: { [d]: [`${ver}/content/object.json`] } }));
  const { storage, f, env } = await newArchive();
  env.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('opensheaf.json')) return new Response(JSON.stringify({ specification: '0.2' }));
    return new Response(u.endsWith('inventory.json') ? inv : obj);
  };
  await collections.newCollection(f, { label: 'list', type: 'catalogue', title: 'List' });
  const m = { kind: 'document', name: 'a'.repeat(52), owner: 'b'.repeat(51) + 'a', at: ['https://evil.example/'],
              version: ver, inventorySha512: await sha512hex(inv), cite: { title: 'Cached' } };
  const mem = (await head(f, 'list', 'members.json')).json;
  await collections.write(f, f.labels.get('list'), { ...mem, members: [m] }, { message: 'by hand' });
  f.index.html.featured = 'list';
  await readableIndex(f);
  assert.match(new TextDecoder().decode(await storage.read('index.html')), /archive unavailable: cached citation/);
});

test('a TeXmacs index: the landing pages are written, the home page left', async () => {
  const { storage, f, env } = await newArchive();
  const home = await storage.read('index.html');
  f.index = { template: 'index.template' };
  env.said.length = 0;
  await deposit(f, paper('one'));
  await collect(f);
  await present(f);
  const name = f.labels.get('one').split(':')[1];
  assert.equal(await storage.kind(`paper/${name}/index.html`), 'file');
  assert.equal(await storage.kind('sitemap.xml'), 'file');
  assert.deepEqual(await storage.read('index.html'), home);
  assert.ok(!env.said.some((l) => /TeXmacs/.test(l)), env.said.join('\n'));
  await storage.remove(`paper/${name}/index.html`);
  await readableIndex(f);
  assert.equal(await storage.kind(`paper/${name}/index.html`), 'file');
  assert.ok(env.said.some((l) => /index\.tm.*typeset by opensheaf-py/.test(l)), env.said.join('\n'));
  assert.ok(env.said.some((l) => /^Done: opensheaf\.json, 4 landing pages and sitemap\.xml written\.$/.test(l)), env.said.join('\n'));
});

test('the small pieces of the pages', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#x27;&amp;&#x27;&lt;/a&gt;');
  assert.equal(fmtDate('2026-06-03'), '3 June 2026');
  assert.equal(fmtDate('2019-03'), 'March 2019');
  assert.equal(fmtDate('2026-06-03T10:00:00Z'), '3 June 2026');
  assert.equal(fmtDate('2026-06-03T23:30:00-05:00/2026-07-01'), '3 June 2026');
  assert.equal(fmtDate('2026-02-30'), '2026-02-30');
  assert.equal(fmtDate('June 2026'), 'June 2026');
  assert.equal(fmtDate('soon'), 'soon');
  assert.equal(fmtDate('2019-03/2019-05'), 'March 2019');
  assert.equal(fmtDate('2026'), '2026');
  assert.equal(namesJoined(['A', 'B', 'C']), 'A, B and C');
  assert.equal(pyJson({ a: [1, 'x'], b: { c: null } }), '{"a": [1, "x"], "b": {"c": null}}');
  const data = { abstract: 'a <!--<script> b </script> c & d', name: 'x</SCRIPT >' };
  const text = jsonInScript(data);
  assert.ok(!/[<>&]/.test(text));
  assert.deepEqual(JSON.parse(text), data);
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
  await assert.rejects(newArchive({ keeper: 'https://127.0.0.1/' }), /ORCID iD|DNS name/);
  const { KeyLog } = await import('../core/owners.js');
  const local = await KeyLog.of(utf8(new TextDecoder().decode(glog.genesis).replace('example.org', '127.0.0.1')));
  assert.equal((await keeperLink(local, async (url) => assert.fail(url))).status, NOT_CHECKED);
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

test('the values of a file of options are converted', async () => {
  const { main } = await import('../cli/osheaf.js');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await mkdtemp(`${os.tmpdir()}/osheaf-options-`);
  const said = [];
  const run = (argv) => main(argv, { out: (l) => said.push(l), err: (l) => said.push(l),
                                     environ: { XDG_CONFIG_HOME: `${dir}/config`, OPENSHEAF_KEY_STORE: 'file' } });
  try {
    const e = (await loadEntries('init.yaml', 'name: Test\nbase-url: https://example.org/\ncurator: Doe, Jane\n' +
      "new-owner: true\nno-passphrase: false\nplain-current: 'no'\nyes: false\nrotation: 3\n"))[0];
    const specs = { newOwner: { flag: true }, noPassphrase: { flag: true }, plainCurrent: { flag: true },
                    yes: { flag: true }, rotation: { type: 'int' }, name: {}, baseUrl: {}, curator: {} };
    const defaults = { newOwner: undefined, noPassphrase: undefined, plainCurrent: undefined, yes: undefined,
                       rotation: undefined, name: undefined, baseUrl: undefined, curator: undefined };
    const ns = merge({}, e, defaults, 'init', {}, specs);
    assert.deepEqual([ns.newOwner, ns.noPassphrase, ns.plainCurrent, ns.yes, ns.rotation], [true, false, false, false, 3]);
    for (const [bad, what] of [['i-know: maybe\n', /i-know in the file: true or false, not 'maybe'/],
                               ['stage: BOGUS\n', /stage in the file: one of AO, SMUR/],
                               ['after: two\n', /after in the file: not 'two'/],
                               ['title: [a, b]\n', /title in the file: a value, not \['a', 'b'\]/]]) {
      await writeFile(`${dir}/dep.yaml`, `id: x\nauthor: Doe, J\n${bad.startsWith('title') ? '' : 'title: T\n'}${bad}`);
      said.length = 0;
      assert.equal(await run(['--root', dir, 'deposit', '--from', `${dir}/dep.yaml`]), 2, said.join('\n'));
      assert.match(said.join('\n'), what);
    }
    const ok = merge({ label: null, iKnow: undefined, new: undefined, stage: undefined, author: [] },
      (await loadEntries('dep.yaml', 'id: x\ni-know: no\nnew: yes\nstage: AM\nauthor: Doe, J\n'))[0],
      { label: null, iKnow: undefined, new: undefined, stage: undefined, author: [] }, 'deposit', { id: 'label' },
      { iKnow: { flag: true }, new: { flag: true }, stage: { choices: ['AO', 'AM'] }, author: { repeat: true } });
    assert.deepEqual([ok.iKnow, ok.new, ok.stage, ok.author], [false, true, 'AM', ['Doe, J']]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mirrors, branches, drafts and takedowns, in memory', async () => {
  const one = await newArchive();
  await deposit(one.f, paper('first', { rights: 'cc-by-4.0' }));
  const two = await newArchive({ baseUrl: 'https://example.org/two/' });
  two.f.env.fetch = storageFetch(one.storage, 'https://example.org/papers/');
  const id = one.f.labels.get('first'), [, name, owner] = id.split(':');
  const at = ['https://example.org/papers/'];
  await mirror(two.f, { uri: id, at, label: 'copy' });
  assert.equal(two.f.labels.get('copy'), id);
  assert.deepEqual(await errorsOf(two.storage), []);
  assert.ok(two.env.said.some((l) => l.endsWith(`mirrored, v1 to v1, from ${at[0]}`)), two.env.said.join('\n'));
  await assert.rejects(mirror(two.f, { uri: id, at, label: 'copy' }), /not given to another line/);
  await deposit(one.f, paper('closed', { rights: 'All rights reserved' }));
  await mirror(two.f, { uri: one.f.labels.get('closed'), at });
  assert.ok(two.env.said.some((l) => l.includes('not one known to allow redistribution')), two.env.said.join('\n'));
  await branch(two.f, { uri: `sheaf:${name}:${owner}/v1`, at, label: 'kept' });
  const kept = two.f.labels.get('kept');
  assert.equal(kept, `sheaf:${name}:${two.f.archive.owner}`);
  assert.deepEqual(await errorsOf(two.storage), []);
  const draft = { label: 'notes', pdf: { name: 'd.pdf', bytes: utf8('%PDF-1.4 one') }, noSource: 'x', title: 'Notes',
                  author: ['Doe, J'], type: 'Preprint' };
  await draftDeposit(two.f, draft, true);
  await draftDeposit(two.f, { ...draft, pdf: { name: 'd.pdf', bytes: utf8('%PDF-1.4 two') } });
  await draftDeposit(two.f, { ...draft, pdf: { name: 'd.pdf', bytes: utf8('%PDF-1.4 three') }, replace: true });
  assert.equal((await readJson(two.storage, 'opensheaf.json')).drafts[0].head, 'v2');
  assert.equal(await two.storage.kind('ocfl/draft/notes/extensions'), null);
  await seal(two.f, { label: 'notes', newLabel: 'lecture-notes' });
  await draftDelete(two.f, { label: 'notes' });
  assert.equal((await readJson(two.storage, 'opensheaf.json')).drafts, undefined);
  assert.deepEqual(await errorsOf(two.storage), []);
  const closed = one.f.labels.get('closed');
  await takedown(one.f, { label: 'closed', reason: 'Withdrawn by its authors.', yes: true });
  two.env.said.length = 0;
  await mirror(two.f, { all: true });
  assert.ok(two.env.said.some((l) => l.includes(`${closed} was taken down at`)), two.env.said.join('\n'));
  assert.equal(await two.storage.kind(`${await two.f.dirOf(closed)}/inventory.json`), 'file');
  await takedown(two.f, { label: 'copy', reason: 'Stopped keeping it.', yes: true });
  const disc = await readJson(two.storage, 'opensheaf.json');
  assert.deepEqual(Object.keys(disc.tombstones[0]), ['id', 'kind', 'name', 'owner', 'genesisName', 'lastVersion',
                                                     'inventorySha512', 'date', 'reason']);
  assert.deepEqual(await errorsOf(two.storage), []);
  await assert.rejects(takedown(two.f, { label: `sheaf:${owner}:${owner}`, reason: 'x', yes: true }), /--by-law or --keeper/);
  await takedown(two.f, { label: `sheaf:${owner}:${owner}`, reason: 'A court order.', byLaw: true, yes: true });
  const found = await errorsOf(two.storage);
  assert.ok(found.some((x) => x.includes('kept v1: unchecked branch point')), found.join('\n'));
  assert.ok(!found.some((x) => x.startsWith('error')), found.join('\n'));
});

test('root inventories and osheaf.json are replaced by a rename', async () => {
  const { storage, f, env } = await newArchive();
  const direct = [];
  const write = storage.write.bind(storage);
  storage.write = async (p, bytes, options) => {
    if (/^osheaf\.json$|^ocfl\/(?:.*\/)?[^/]+\/inventory\.json(?:\.sha512)?$/.test(p) && !/\/v\d+\/inventory/.test(p)) direct.push(p);
    return write(p, bytes, options);
  };
  const keys = [...env.exported.keys()].filter((p) => p.startsWith('/keys/')).sort();
  env.readText = async (p) => env.exported.get(p);
  await ownerRotate(f, { rotationKey: keys.slice(0, 2), export: '/k2', yes: true });
  const draft = { label: 'notes', pdf: { name: 'd.pdf', bytes: utf8('%PDF-1.4 one') }, noSource: 'x', title: 'Notes',
                  author: ['Doe, J'], type: 'Preprint' };
  await draftDeposit(f, draft, true);
  await draftDeposit(f, { ...draft, pdf: { name: 'd.pdf', bytes: utf8('%PDF-1.4 two') } });
  await draftDeposit(f, { ...draft, pdf: { name: 'd.pdf', bytes: utf8('%PDF-1.4 three') }, replace: true });
  await f.writeConfig(await readJson(storage, 'osheaf.json'));
  assert.deepEqual(direct, []);
  assert.deepEqual([...storage.files.keys()].filter((p) => p.endsWith('.tmp')), []);
  assert.deepEqual(await errorsOf(storage), []);
});

test('a key-log version cannot take its content from a later one', async () => {
  const { storage, f, env } = await newArchive();
  const owner = f.archive.owner;
  const keys = [...env.exported.keys()].filter((p) => p.startsWith('/keys/')).sort();
  env.readText = async (p) => env.exported.get(p);
  await ownerRotate(f, { rotationKey: keys.slice(0, 2), export: '/k2', yes: true });
  const kd = await f.dirOf(`sheaf:${owner}:${owner}`);
  const inv = JSON.parse(new TextDecoder().decode(await storage.read(`${kd}/v1/inventory.json`)));
  const [d] = Object.entries(inv.manifest).find(([, ps]) => ps[0] === 'v1/content/genesis.json');
  inv.manifest[d] = ['v2/content/genesis.json'];
  await storage.write(`${kd}/v2/content/genesis.json`, await storage.read(`${kd}/v1/content/genesis.json`));
  await storage.write(`${kd}/v1/inventory.json`, utf8(jsonText(inv)));
  const out = "v1: a content path out of the object: 'v2/content/genesis.json'";
  const local = await loadKeyLog(storage, kd);
  assert.ok(local.problems.includes(out), local.problems.join('\n'));
  const archive = await Archive.open(new Http({ fetch: storageFetch(storage, 'https://example.org/papers/'), budget: null }),
                                     'https://example.org/papers/');
  const remote = await archive.keyLog(owner);
  assert.deepEqual(remote.problems, local.problems);
});

test('a cancelled verification reports no file missing', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('one'));
  const controller = new AbortController();
  const plain = storageFetch(storage, 'https://example.org/papers/');
  const fetch = async (url, init) => {
    if (/\/v1\/inventory\.json$/.test(String(url))) {
      controller.abort();
      throw new DOMException('cancelled', 'AbortError');
    }
    return plain(url, init);
  };
  const archive = await Archive.open(new Http({ fetch, budget: null }), 'https://example.org/papers/');
  const report = await verify(archive, { schemas, signal: controller.signal, pages: false });
  assert.equal(report.cancelled, true);
  assert.deepEqual(report.findings.filter((x) => x.level === 'error').map((x) => x.message), []);
});

test('only http and https addresses become links', async () => {
  const p = await newArchive();
  await deposit(p.f, paper('one'));
  const a = await newArchive({ baseUrl: 'https://example.org/author/' });
  a.f.env.fetch = storageFetch(p.storage, 'https://example.org/papers/');
  const id = p.f.labels.get('one');
  const sync = (at) => collections.sync(a.f, { collection: 'list', fromFile: { name: 'list.yaml', given: 'list.yaml',
    text: `title: A list\nmembers:\n  - uri: '${id}'\n    at: [${at.map((w) => `'${w}'`).join(', ')}]\n` } });
  await sync(['https://example.org/papers/']);
  const before = (await head(a.f, 'list', 'members.json')).json.members[0].at;
  a.env.said.length = 0;
  await sync(['javascript:alert(1)//', 'http://example.com/']);
  assert.deepEqual((await head(a.f, 'list', 'members.json')).json.members[0].at, before);
  assert.equal(a.env.said.filter((l) => l.includes('not recorded')).length, 2, a.env.said.join('\n'));
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl(' https://x/'), '');
  assert.equal(safeUrl('HTTP://x/'), 'HTTP://x/');
  assert.equal(link('javascript:alert(1)', 'x'), 'x');
  assert.equal(link('data:text/html,x', 'x', 'paper-title'), '<span class="paper-title">x</span>');
  assert.equal(link('https://x/?a=1&b', 'x'), '<a href="https://x/?a=1&amp;b">x</a>');
});

test('a member elsewhere whose files are not those pinned', async () => {
  const p = await newArchive();
  await deposit(p.f, paper('one', { title: 'One' }));
  const a = await newArchive({ baseUrl: 'https://example.org/author/' });
  a.f.env.fetch = storageFetch(p.storage, 'https://example.org/papers/');
  const id = p.f.labels.get('one');
  await collections.sync(a.f, { collection: 'list', fromFile: { name: 'list.yaml', given: 'list.yaml',
    text: `title: A list\ntype: catalogue\nmembers:\n  - uri: '${id}'\n    at: ['https://example.org/papers/']\n` } });
  a.f.index.html = { ...(a.f.index.html || {}), featured: 'list' };
  const home = async () => {
    await readableIndex(a.f);
    return new TextDecoder().decode(await a.storage.read('index.html'));
  };
  let page = await home();
  assert.ok(page.includes('>One</a>') && !page.includes('cached citation'), page);
  const d = await p.f.dirOf(id);
  const inv = await readJson(p.storage, `${d}/inventory.json`);
  const [dig, [cp]] = Object.entries(inv.manifest).find(([k]) => inv.versions.v1.state[k]?.includes('datacite.json'));
  const saved = await p.storage.read(`${d}/${cp}`);
  await p.storage.write(`${d}/${cp}`, utf8(new TextDecoder().decode(saved).replace('"One"', '"Forged"')));
  page = await home();
  assert.ok(!page.includes('Forged') && page.includes('archive unavailable: cached citation'), page);
  const dc = JSON.parse(new TextDecoder().decode(saved));
  dc.titles = [];
  const forged = utf8(JSON.stringify(dc)), fd = await sha512hex(forged);
  await p.storage.write(`${d}/${cp}`, forged);
  delete inv.manifest[dig];
  inv.manifest[fd] = [cp];
  inv.versions.v1.state[fd] = inv.versions.v1.state[dig];
  delete inv.versions.v1.state[dig];
  const raw = utf8(JSON.stringify(inv));
  await p.storage.write(`${d}/v1/inventory.json`, raw);
  await p.storage.write(`${d}/inventory.json`, raw);
  const mem = (await head(a.f, 'list', 'members.json')).json;
  mem.members[0].inventorySha512 = await sha512hex(raw);
  await collections.write(a.f, a.f.labels.get('list'), mem, { message: 'a pin by hand' });
  page = await home();
  assert.ok(page.includes('archive unavailable: cached citation') && page.includes('>One<'), page);
});

test('a mirror copies what it judged', async () => {
  const one = await newArchive();
  await deposit(one.f, paper('open'));
  await deposit(one.f, paper('open', { new: false, pdf: { name: 'v2.pdf', bytes: utf8('%PDF-1.4 two') } }));
  const id = one.f.labels.get('open'), dir = await one.f.dirOf(id);
  const at = ['https://example.org/papers/'];
  const two = await newArchive({ baseUrl: 'https://example.org/two/' });
  const inner = storageFetch(one.storage, at[0]);
  let changing = true, reads = 0;
  two.f.env.fetch = async (url, init = {}) => {
    const res = await inner(url, init);
    if (changing && res.ok && init.method !== 'HEAD' && String(url).endsWith(`${dir}/v2/inventory.json`) && ++reads > 1) {
      return new Response(new Uint8Array([...new Uint8Array(await res.arrayBuffer()), 10]), { status: 200 });
    }
    return res;
  };
  await assert.rejects(mirror(two.f, { uri: id, at }), /not the one verified/);
  assert.equal(await two.storage.kind(`${dir}/inventory.json`), null);
  changing = false;
  const extra = await exampleKey('a key added');
  one.env.readText = async (p) => one.env.exported.get(p);
  const keys = [...one.env.exported.keys()].filter((p) => p.startsWith('/keys/')).sort();
  await ownerRotate(one.f, { rotationKey: keys.slice(0, 2), export: '/k2', add: [extra.did], yes: true });
  const w = `${dir}/${WITNESSES}/v1`;
  const [good] = (await one.storage.list(w)).map((e) => e.name);
  const forged = await readJson(one.storage, `${w}/${good}`);
  forged.inventorySha512 = '0'.repeat(128);
  const name = await fileName(extra.did);
  await one.storage.write(`${w}/${name}`, utf8(JSON.stringify(forged)));
  two.env.said.length = 0;
  await mirror(two.f, { uri: id, at });
  assert.ok(two.env.said.some((l) => l.includes(name) && l.includes('not copied')), two.env.said.join('\n'));
  const mw = `${dir}/${WITNESSES}/v1`;
  assert.equal(await two.storage.kind(`${mw}/${good}`), 'file');
  assert.equal(await two.storage.kind(`${mw}/${name}`), null);
  assert.deepEqual(await errorsOf(two.storage), []);
});

test('a withdrawn member of a paged archive', async () => {
  PAGING.perPage = 1;
  try {
    const p = await newArchive();
    await deposit(p.f, paper('one'));
    await deposit(p.f, paper('two'));
    const a = await newArchive({ baseUrl: 'https://example.org/author/' });
    a.f.env.fetch = storageFetch(p.storage, 'https://example.org/papers/');
    await collections.sync(a.f, { collection: 'list', fromFile: { name: 'list.yaml', given: 'list.yaml',
      text: `title: A list\ntype: catalogue\nmembers:\n  - uri: '${p.f.labels.get('one')}'\n    at: ['https://example.org/papers/']\n` } });
    await withdraw(p.f, { label: 'one', reason: 'a mistake', file: null });
    const disc = await readJson(p.storage, 'opensheaf.json');
    assert.ok(!('objects' in disc) && disc.objectPages.length);
    a.f.index.html = { ...(a.f.index.html || {}), featured: 'list' };
    await readableIndex(a.f);
    const home = new TextDecoder().decode(await a.storage.read('index.html'));
    assert.ok(home.includes('Withdrawn by its owner') && home.includes('a mistake'), home);
  } finally {
    PAGING.perPage = 1000;
  }
});

test('rights are required, and a landing page describes itself', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('paper-a', { rights: 'cc-by-4.0' }));
  const id = f.labels.get('paper-a');
  const { inv, json: obj } = await head(f, 'paper-a');
  const dc = (await head(f, 'paper-a', 'datacite.json')).json;
  assert.deepEqual(descriptionErrors(inv, inv.head, obj, dc).filter((e) => e.includes('rightsList')), []);
  const { rightsList, ...bare } = dc;
  assert.deepEqual(descriptionErrors(inv, inv.head, obj, bare).filter((e) => e.includes('rightsList')),
                   ['datacite.json has no licence or rights statement in rightsList (section 4.4)']);
  assert.deepEqual(descriptionErrors(inv, inv.head, obj, { ...dc, rightsList: [{ rights: 'All rights reserved' }] })
    .filter((e) => e.includes('rightsList')), []);
  await collect(f);
  await readableIndex(f);
  assert.deepEqual(await errorsOf(storage), []);
  const page = `paper/${await nameAddress(f, id)}/index.html`;
  const text = new TextDecoder().decode(await storage.read(page));
  for (const r of ['cite-as', 'describedby', 'item', 'license', 'type']) assert.ok(text.includes(`<link rel="${r}"`), r);
  const ld = JSON.parse(/<script type="application\/ld\+json">([^]*?)<\/script>/.exec(text)[1]);
  assert.equal(ld['@type'], 'ScholarlyArticle');
  assert.equal(ld.license, 'https://creativecommons.org/licenses/by/4.0/');
  assert.ok(ld.identifier.includes(`sheaf:${id.split(':')[1]}`));
  assert.ok(ld.encoding.some((e) => e.encodingFormat === 'application/pdf'));
  await storage.write(page, utf8(text.replace(/<script type="application\/ld\+json">[^]*?<\/script>/, '')));
  assert.ok((await errorsOf(storage)).some((e) => e.includes('lacks a schema.org record')));
  const record = /<script type="application\/ld\+json">([^]*?)<\/script>/.exec(text)[1];
  const deep = text.replace(record, record.replace(/}$/, `, "x": ${'['.repeat(70)}${']'.repeat(70)}}`));
  assert.deepEqual(landingDescriptionGaps(text), []);
  assert.deepEqual(landingDescriptionGaps(deep), ['a schema.org record in JSON-LD with a type and identifiers']);
});

test('a pin to a key-log version that is not one', async () => {
  const { storage, f, env } = await newArchive();
  const owner = f.archive.owner;
  const keys = [...env.exported.keys()].filter((p) => p.startsWith('/keys/')).sort();
  env.readText = async (p) => env.exported.get(p);
  await ownerRotate(f, { rotationKey: keys.slice(0, 2), export: '/k2', yes: true });
  const kd = await f.dirOf(`sheaf:${owner}:${owner}`);
  const dig = await sha512hex(await storage.read(`${kd}/v2/inventory.json`));
  const member = { kind: 'owner', name: owner, owner, at: ['https://example.org/papers/'], version: 'v2', inventorySha512: dig };
  await collections.write(f, null, { format: 'opensheaf-collection/0.2', type: 'catalogue', order: 'manual', members: [member] },
                          { message: 'test', title: 'Keys', owner, label: 'keys' });
  const fetch = storageFetch(storage, 'https://example.org/papers/');
  const pin = () => new Resolver(new Http({ fetch, budget: null })).pin(owner, owner, 'v2', dig, ['https://example.org/papers/']);
  assert.equal((await pin()).status, 'verified');
  assert.ok(!(await errorsOf(storage)).some((e) => e.includes('not a version of the key log')));
  for (const e of (await storage.list(`${kd}/${WITNESSES}/v2`)) || []) await storage.remove(`${kd}/${WITNESSES}/v2/${e.name}`);
  const log = await loadKeyLog(storage, kd);
  assert.ok(log.lookup(2, dig) !== null && log.verified(2, dig) === null);
  assert.equal((await pin()).status, 'not a version');
  const errors = await errorsOf(storage);
  assert.ok(errors.some((e) => e.includes('not a version of the key log')), errors.join('\n'));
});

test('copies that disagree with a pin (section 12.3)', async () => {
  const one = await newArchive();
  await deposit(one.f, paper('first', { rights: 'cc-by-4.0' }));
  const id = one.f.labels.get('first'), [, name, owner] = id.split(':');
  const dir = await one.f.dirOf(id);
  const digest = await sha512hex(await one.storage.read(`${dir}/v1/inventory.json`));
  const inner = storageFetch(one.storage, 'https://example.org/papers/');
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://example.org/nocheck/')) {
      if (u.endsWith('inventory.json.sha512')) return new Response('not found', { status: 404 });
      return inner(u.replace('/nocheck/', '/papers/'), init);
    }
    if (u.startsWith('https://example.org/tampered/')) {
      const real = u.replace('/tampered/', '/papers/');
      const res = await inner(real, init);
      if (res.ok && init.method !== 'HEAD' && real.endsWith(`${dir}/v1/inventory.json`)) {
        const bytes = new Uint8Array([...new Uint8Array(await res.arrayBuffer()), 32]);
        return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
      }
      return res;
    }
    return inner(u, init);
  };
  const fresh = () => new Resolver(new Http({ fetch, budget: null }));
  const messages = (r) => r.notes.map((n) => n.message);
  const [nocheck, tampered, papers] = ['nocheck', 'tampered', 'papers'].map((x) => `https://example.org/${x}/`);
  let r = fresh();
  assert.equal((await r.pin(name, owner, 'v1', digest, [nocheck])).status, 'verified');
  assert.ok(messages(r).some((m) => m.startsWith(nocheck) && m.includes('the checksum file of its inventory is missing')),
            messages(r).join('\n'));
  r = fresh();
  assert.equal((await r.pin(name, owner, 'v1', digest, [tampered, papers])).status, 'verified');
  assert.ok(messages(r).includes(`${tampered}: ${id} v1 does not match the pin (section 12.3)`), messages(r).join('\n'));
  r = fresh();
  assert.equal((await r.pin(name, owner, 'v1', digest, [tampered])).status, 'mismatch');
});

test('a version is resolved to only when every file of it is found with its digest (section 12.3)', async () => {
  const one = await newArchive();
  await deposit(one.f, paper('first'));
  await deposit(one.f, { ...paper('first', { new: false }), pdf: { name: 'v2.pdf', bytes: utf8('%PDF-1.4 two') } });
  const id = one.f.labels.get('first'), [, name, owner] = id.split(':');
  const dir = await one.f.dirOf(id);
  const inv = await readJson(one.storage, `${dir}/inventory.json`);
  const pdfOf = (ver) => Object.entries(inv.versions[ver].state).filter(([, ps]) => ps.some((p) => p.endsWith('.pdf')))
    .map(([d]) => inv.manifest[d][0]).find((cp) => cp.startsWith(`${ver}/`));
  const [pdf1, pdf2] = [pdfOf('v1'), pdfOf('v2')];
  const d1 = await sha512hex(await one.storage.read(`${dir}/v1/inventory.json`));
  const inner = storageFetch(one.storage, 'https://example.org/papers/');
  const asked = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    asked.push(u);
    if (u.startsWith('https://example.org/tampered/')) {
      const real = u.replace('/tampered/', '/papers/');
      if (real.endsWith(`${dir}/${pdf1}`)) return new Response(utf8('%PDF tampered'), { status: 200 });
      return inner(real, init);
    }
    return inner(u, init);
  };
  const fresh = (options) => new Resolver(new Http({ fetch, budget: null }), null, options);
  const messages = (r) => r.notes.map((n) => n.message);
  const [tampered, papers] = ['tampered', 'papers'].map((x) => `https://example.org/${x}/`);
  let r = fresh();
  let res = await r.latest(name, owner, [tampered]);
  assert.deepEqual([res.status, res.version], ['verified', 'v2']);
  assert.ok(asked.some((u) => u.endsWith(`/${pdf2}`)) && !asked.some((u) => u.endsWith(`/${pdf1}`)), asked.join('\n'));
  assert.equal((await r.pin(name, owner, 'v1', d1, [tampered])).status, 'unavailable');
  assert.ok(messages(r).includes(`${tampered}: ${id} v1: ${pdf1} is missing, or does not have its digest: not read (section 12.3)`),
            messages(r).join('\n'));
  r = fresh();
  res = await r.pin(name, owner, 'v1', d1, [tampered, papers]);
  assert.deepEqual([res.status, res.copy.where], ['verified', papers]);
  asked.length = 0;
  r = fresh({ contents: false });
  assert.equal((await r.pin(name, owner, 'v1', d1, [tampered])).status, 'verified');
  assert.ok(!asked.some((u) => u.endsWith('.pdf')));
});

test('a mirror serving a root inventory or content of its own (section 12.3)', async () => {
  const one = await newArchive();
  await deposit(one.f, paper('first'));
  const id = one.f.labels.get('first'), [, name, owner] = id.split(':');
  const dir = await one.f.dirOf(id);
  const root = await readJson(one.storage, `${dir}/inventory.json`);
  const genuine = Object.entries(root.versions.v1.state).find(([, ps]) => ps.includes('datacite.json'))[0];
  const dc = await readJson(one.storage, `${dir}/${root.manifest[genuine][0]}`);
  const forged = utf8(JSON.stringify({ ...dc, titles: [{ title: 'A forged title' }] }));
  const d = await sha512hex(forged);
  const state = root.versions.v1.state;
  state[genuine] = state[genuine].filter((p) => p !== 'datacite.json');
  if (!state[genuine].length) delete state[genuine];
  state[d] = ['datacite.json'];
  root.manifest[d] = ['v1/content/forged.json'];
  const inner = storageFetch(one.storage, 'https://example.org/papers/');
  const genuinePath = (await readJson(one.storage, `${dir}/inventory.json`)).manifest[genuine][0];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    for (const [mirror, served] of [['rootinv', { 'inventory.json': utf8(JSON.stringify(root)), 'v1/content/forged.json': forged }],
                                    ['swapped', { [genuinePath]: forged }]]) {
      if (!u.startsWith(`https://example.org/${mirror}/`)) continue;
      const real = u.replace(`/${mirror}/`, '/papers/');
      for (const [rel, bytes] of Object.entries(served)) {
        if (real.endsWith(`${dir}/${rel}`)) return new Response(bytes, { status: 200 });
      }
      return inner(real, init);
    }
    return inner(u, init);
  };
  const fresh = () => new Resolver(new Http({ fetch, budget: null }));
  let r = fresh();
  let res = await r.latest(name, owner, ['https://example.org/rootinv/']);
  assert.equal(res.status, 'verified');
  assert.equal((await r.describe(res)).title, 'A paper');
  r = fresh();
  res = await r.latest(name, owner, ['https://example.org/swapped/']);
  assert.equal(res.status, 'unavailable');
  assert.ok(r.notes.some((n) => n.message.includes(`${genuinePath} is missing, or does not have its digest`)));
  r = new Resolver(new Http({ fetch, budget: null }), null, { contents: false });
  res = await r.latest(name, owner, ['https://example.org/swapped/']);
  await assert.rejects(r.describe(res), (e) => e.kind === 'digest' && /does not have the digest/.test(e.message));
});

async function rewriteInventory(storage, dir, change) {
  const inv = JSON.parse(new TextDecoder().decode(await storage.read(`${dir}/inventory.json`)));
  change(inv);
  const bytes = utf8(JSON.stringify(inv, null, 2));
  const sc = utf8(`${await sha512hex(bytes)} inventory.json\n`);
  for (const at of [dir, `${dir}/${typeof inv.head === 'string' ? inv.head : 'v1'}`]) {
    await storage.write(`${at}/inventory.json`, bytes);
    await storage.write(`${at}/inventory.json.sha512`, sc);
  }
}

async function rewriteFile(storage, dir, logical, bytes) {
  const inv = JSON.parse(new TextDecoder().decode(await storage.read(`${dir}/inventory.json`)));
  const state = inv.versions[inv.head].state;
  const old = Object.keys(state).find((k) => state[k].includes(logical));
  await storage.write(`${dir}/${inv.manifest[old][0]}`, bytes);
  const d = await sha512hex(bytes);
  await rewriteInventory(storage, dir, (i) => {
    i.manifest[d] = i.manifest[old];
    delete i.manifest[old];
    for (const v of Object.values(i.versions)) {
      if (v.state[old]) {
        v.state[d] = v.state[old];
        delete v.state[old];
      }
    }
  });
}

test('the verifier reports what it cannot read', async () => {
  const cases = {
    'documentVersion text': [/documentVersion is a positive integer/, async (s, dir, f) => {
      const obj = await f.readObjectJson(dir, await f.inventory(dir), 'object.json');
      await rewriteFile(s, dir, 'object.json', utf8(JSON.stringify({ ...obj, documentVersion: '1' })));
    }],
    'documentVersion missing': [/documentVersion is a positive integer/, async (s, dir, f) => {
      const obj = await f.readObjectJson(dir, await f.inventory(dir), 'object.json');
      await rewriteFile(s, dir, 'object.json', utf8(JSON.stringify({ ...obj, documentVersion: null })));
    }],
    'discovery list': [/is a JSON object/, async (s) => s.write('opensheaf.json', utf8('[]'))],
    'deep inventory': [/without a readable inventory|inventory/, async (s, dir) => s.write(`${dir}/inventory.json`, utf8('['.repeat(100000)))],
    'object.json latin-1': [/cannot be read|UTF-8/, async (s, dir) => rewriteFile(s, dir, 'object.json', new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]))],
    'hashed config': [/config\.json is not a JSON object/, async (s) => {
      await s.write('ocfl/extensions/0003-hash-and-id-n-tuple-storage-layout/config.json', utf8('[1'));
    }, { layout: 'hashed' }],
    'versions list': [/without a readable inventory/, async (s, dir) => rewriteInventory(s, dir, (i) => { i.versions = ['v1']; })],
    'user text': [/a version has a user with a name/, async (s, dir) => rewriteInventory(s, dir, (i) => { i.versions.v1.user = 'me'; })],
  };
  for (const [name, [expected, breakIt, options = {}]] of Object.entries(cases)) {
    const { storage, f } = await newArchive(options);
    await deposit(f, paper('paper-a'));
    const dir = await f.dirOf(f.labels.get('paper-a'));
    await breakIt(storage, dir, f);
    const report = await verifyFolder(storage, { schemas });
    const errors = report.findings.filter((x) => x.level === 'error').map((x) => x.text);
    assert.ok(errors.some((e) => expected.test(e)), `${name}:\n${errors.join('\n')}`);
    assert.ok(!errors.some((e) => /stopped on a file/.test(e)), `${name}:\n${errors.join('\n')}`);
  }
});

test('reserved names in a document', async () => {
  const { reservedNameErrors } = await import('../core/verify.js');
  const errors = reservedNameErrors({ kind: 'document' }, ['object.json', 'datacite.json', 'members.json', 'keys.json',
                                                            'parent/object.json', 'forked/x', 'figs/a.png']);
  for (const name of ['members.json', 'keys.json', 'parent/object.json', 'forked/x']) {
    assert.ok(errors.some((e) => e.startsWith(`${name}: the name`)), name);
  }
  assert.ok(!errors.some((e) => e.includes('figs/a.png')));
  assert.deepEqual(reservedNameErrors({ kind: 'collection', parent: {} }, ['members.json', 'parent/object.json']), []);
  const { f } = await newArchive();
  for (const logical of ['members.json', 'parent/object.json', 'genesis.json', 'paper.pdf', 'paper.tex',
                         'a//b', 'a\\b', 'e\u0301.tex', './x']) {
    await assert.rejects(deposit(f, paper('paper-b', { extraSource: [{ name: 'main.tex', bytes: utf8('x'), logical }] })),
                         /--extra-source/, logical);
  }
  await deposit(f, paper('paper-b', { extraSource: [{ name: 'main.tex', bytes: utf8('x'), logical: 'sub/main.tex' }] }));
});

test('an interrupted version is named', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('paper-a'));
  const dir = await f.dirOf(f.labels.get('paper-a'));
  await storage.write(`${dir}/v2/content/x`, utf8('x'));
  const again = paper('paper-a', { new: false, pdf: { name: 'v2.pdf', bytes: utf8('%PDF-1.4 v2') } });
  await assert.rejects(deposit(f, again), /v2 was interrupted/);
  assert.ok(!((await storage.list('')) || []).some((e) => e.name.startsWith('.staging-')));
  await storage.remove(`${dir}/v2/content/x`);
  await deposit(f, again);
  assert.deepEqual(await errorsOf(storage), []);
});

test('a pin that is not one', async () => {
  const asked = [];
  const r = new Resolver(new Http({ fetch: async (url) => { asked.push(url); throw new TypeError('no network'); }, budget: null }));
  const name = 'a'.repeat(52), owner = 'b'.repeat(51) + 'a', dig = 'c'.repeat(128);
  assert.equal((await r.pin(name, owner, 'latest', dig, ['https://example.org/papers/'])).status, 'not a version');
  assert.equal((await r.pin('../x', owner, 'v1', dig, ['https://example.org/papers/'])).status, 'not a version');
  assert.deepEqual(asked, []);
  assert.ok(r.notes.some((n) => /the pin 'latest' sha512='c+' is not a line, an object version and a digest/.test(n.message)));
});

test('addresses given by others, and what one run reads', async () => {
  const { locate } = await import('../cli/osheaf.js');
  const { LIMITS } = await import('../core/http.js');
  const found = { 'https://example.org/': '/tmp/a/' };
  for (const climb of ['https://example.org/../secret/', 'https://example.org/%2e%2e/secret/',
                       'https://example.org/x/..%2f..%2fsecret/']) {
    assert.equal(locate(climb, found), null, climb);
  }
  assert.equal(locate('https://example.org/a/opensheaf.json', found), '/tmp/a/a/opensheaf.json');
  const seen = [];
  const r = new Resolver(new Http({ fetch: async (url) => { seen.push(String(url)); return new Response('no', { status: 404 }); },
                                    budget: null }));
  assert.deepEqual(await r.archiveOf('https://example.org/' + 'x/'.repeat(30) + 'v1/'), []);
  assert.equal(new Set(seen.map((u) => u.replace(/opensheaf\.json.*$/, ''))).size, LIMITS.probes);
  const pins = LIMITS.pins;
  LIMITS.pins = 1;
  try {
    const name = 'a'.repeat(52), owner = 'b'.repeat(51) + 'a', dig = 'c'.repeat(128);
    await r.pin(name, owner, 'v1', dig, ['https://example.org/a/']);
    assert.equal((await r.pin(name, owner, 'v1', dig, ['https://example.org/a/'])).status, 'unavailable');
    assert.ok(r.notes.some((n) => /at most 1 pins are resolved in one run/.test(n.message)));
  } finally {
    LIMITS.pins = pins;
  }
});

test('evidence of another form', async () => {
  const { genesisRecord } = await import('../core/write.js');
  const { nameOf } = await import('../core/names.js');
  const { chainOwners } = await import('../core/branch.js');
  const { MAX_DEPTH } = await import('../core/branches.js');
  const g = await genesisRecord('document', { originator: 'z' + 'a'.repeat(51) });
  const nm = await nameOf(g, 0);
  for (const pinv of ['not json', '[1]', '{"versions": []}', '['.repeat(100) + ']'.repeat(100)]) {
    const files = new Map([['parent/inventory.json', utf8(pinv)], ['parent/object.json', utf8('{}')]]);
    const lv = level(new Map([...files.keys()].map((p) => [p, 'd'])), async (p) => files.get(p));
    const [v, problems] = await verdict(lv, { parent: { name: nm }, name: nm, owner: 'x' }, g, () => null);
    assert.equal(v, INCONSISTENT, pinv);
    assert.ok(problems.length);
  }
  const owner = 'q'.repeat(51) + 'a';
  const files = new Map(Array.from({ length: 200 }, (_, k) => ['parent/'.repeat(k) + 'parent/object.json',
                                                                utf8(JSON.stringify({ owner }))]));
  assert.equal(chainOwners(files).length, MAX_DEPTH + 1);
  files.set('parent/parent/object.json', utf8('[]'));
  assert.deepEqual(chainOwners(files), [owner]);
});

test('a branch point reading a parent/object.json that its parent inventory does not record', async () => {
  const one = await newArchive();
  await deposit(one.f, paper('first', { rights: 'cc-by-4.0' }));
  const two = await newArchive({ baseUrl: 'https://example.org/two/' });
  two.f.env.fetch = storageFetch(one.storage, 'https://example.org/papers/');
  const [, name, owner] = one.f.labels.get('first').split(':');
  await branch(two.f, { uri: `sheaf:${name}:${owner}/v1`, at: ['https://example.org/papers/'], label: 'kept' });
  const kept = two.f.labels.get('kept');
  const archive = await Archive.open(new Http({ fetch: storageFetch(two.storage, 'https://example.org/two/'), budget: null }),
                                     'https://example.org/two/');
  const inv = await archive.headInventory(kept);
  const lv = levelOfVersion(archive, kept, inv, inv.head);
  const obj = await archive.json(kept, inv, inv.head, 'object.json');
  const genesis = await archive.bytes(kept, inv, 'v1', 'genesis.json');
  assert.notEqual((await verdict(lv, obj, genesis, () => null))[0], INCONSISTENT);
  const pobj = JSON.parse(new TextDecoder().decode(await lv.read('parent/object.json')));
  const forged = utf8(JSON.stringify({ ...pobj, parent: { ...obj.parent } }));
  const stated = level(lv.digests, async (p) => (p === 'parent/object.json' ? forged : lv.read(p)));
  const [v, problems] = await verdict(stated, obj, genesis, () => null);
  assert.equal(v, INCONSISTENT);
  assert.ok(problems.includes('parent/object.json is not the object.json the parent inventory records'), problems.join('\n'));
});

test('an unsigned head cannot restate a signed version (section 14.2)', async () => {
  const { storage, f } = await newArchive();
  await deposit(f, paper('paper'));
  const id = f.labels.get('paper'), [, name, owner] = id.split(':');
  const d = await f.dirOf(id);
  const forged = await readJson(storage, `${d}/v1/inventory.json`);
  const state = forged.versions.v1.state;
  const pdf = Object.keys(state).find((dg) => state[dg][0].endsWith('.pdf'));
  const other = utf8('%PDF-1.4 forged');
  const od = await sha512hex(other);
  state[od] = state[pdf];
  delete state[pdf];
  forged.manifest[od] = ['v2/content/forged.pdf'];
  forged.versions.v2 = { ...forged.versions.v1, message: 'forged' };
  forged.head = 'v2';
  await storage.write(`${d}/v2/content/forged.pdf`, other);
  const data = utf8(JSON.stringify(forged));
  for (const p of [`${d}/v2/inventory.json`, `${d}/inventory.json`]) {
    await storage.write(p, data);
    await storage.write(`${p}.sha512`, await sidecar(data));
  }
  const base = 'https://example.org/papers/';
  const r = new Resolver(new Http({ fetch: storageFetch(storage, base), budget: null }));
  assert.equal((await r.latest(name, owner, [base])).status, 'unavailable');
  assert.ok(r.notes.some((n) => n.message.includes('not a copy of the line: v1: its inventory does not record the versions')),
            JSON.stringify(r.notes));
  const archive = await Archive.open(new Http({ fetch: storageFetch(storage, base), budget: null }), base);
  await assert.rejects(fetchObject(new MemoryStorage(), archive, id, 'copy'),
                       (e) => e instanceof Unavailable && /v1: its inventory does not record the versions/.test(e.message));
  assert.ok((await errorsOf(storage)).some((e) => e.includes('the inventory copy disagrees with the inventory')));
});

test('the objects of the discovery document in pages (section 3.1)', async () => {
  const { storage, f, env } = await newArchive();
  PAGING.perPage = 2;
  try {
    for (const label of ['one', 'two', 'three']) await deposit(f, paper(label));
    const disc = await readJson(storage, 'opensheaf.json');
    assert.ok(!('objects' in disc) && disc.objectPages.length > 1);
    const pages = await Promise.all(disc.objectPages.map((p) => readJson(storage, p)));
    assert.ok(pages.every((p) => p.format === 'opensheaf-objects/0.2' && p.objects.length <= 2));
    const listed = pages.flatMap((p) => p.objects.map((o) => o.id));
    assert.equal(new Set(listed).size, listed.length);
    assert.deepEqual(await errorsOf(storage), []);
    assert.equal((await ArchiveFolder.open(storage, env)).labels.get('two'), f.labels.get('two'));
    const first = disc.objectPages[0], saved = await storage.read(first);
    await storage.remove(first);
    assert.ok((await errorsOf(storage)).some((e) => /is missing \(section 3\.1\)/.test(e)));
    await readableIndex(f);
    const before = await storage.read('opensheaf.json');
    const g = await ArchiveFolder.open(storage, env);
    assert.throws(() => g.refuseUnreadPages(), /the labels of the lines are not known/);
    await assert.rejects(writeDiscovery(g), /the labels of the lines are not known/);
    await assert.rejects(readableIndex(g), /the labels of the lines are not known/);
    assert.deepEqual(await storage.read('opensheaf.json'), before);
    assert.equal(await storage.kind('paper/two/index.html'), 'file');
    await storage.write(first, saved);
    PAGING.perPage = 1000;
    await writeDiscovery(f);
    assert.ok(!('objectPages' in await readJson(storage, 'opensheaf.json')));
    assert.equal(await storage.kind('objects'), null);
    assert.deepEqual(await errorsOf(storage), []);
  } finally {
    PAGING.perPage = 1000;
  }
});
