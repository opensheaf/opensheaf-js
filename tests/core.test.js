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

const schemas = await loadSchemas(async (url) => JSON.parse(await readFile(fileURLToPath(url), 'utf-8')));

function testEnvironment({ passphrase = 'correct horse' } = {}) {
  const keys = new Map(), exported = new Map(), said = [];
  let n = 0;
  const env = environment({
    out: (line) => said.push(line),
    err: (line) => said.push(line),
    newKey: () => exampleKey(`test key ${n++}`),
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
                                      'mainCollection', 'curator', 'depositor']);
  assert.equal(env.exported.size, 3);
  for (const text of env.exported.values()) assert.equal((await readRotationKey(text, 'correct horse')).owner, cfg.owner);
  assert.deepEqual(await errorsOf(storage), []);
  const disc = await readJson(storage, 'opensheaf.json');
  assert.deepEqual(disc.objects.map((o) => [o.kind, o.head, o.label ?? null]).sort(),
                   [['collection', 'v1', 'main'], ['owner', 'v1', null]]);
  await deposit(f, paper('first', { abstract: '  An abstract.  ', keyword: ['x'], rights: 'cc-by-4.0' }));
  await deposit(f, { ...paper('first', { new: false }), pdf: { name: 'v2.pdf', bytes: utf8('%PDF-1.4 two') } });
  await collect(f);
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
