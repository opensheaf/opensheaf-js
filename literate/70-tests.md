The tests
=========

The tests are written with `node:test` and `node:assert`, which both
`deno test` and `node --test` run; they are tangled into `tests/`:

- `tests/core.test.js` (this chapter): storages, the writing of files as
  opensheaf-py writes them, key files, and a whole archive kept in memory,
  from `init` to `verify`, with predictable keys; descriptions,
  collections, the website, keepers and the options read from files;
- `tests/identity.test.js` (chapter [71](71-tests-identity.md)): names,
  keys and signatures against appendix C, and the edge cases of Ed25519;
- `tests/parity.test.js` (chapter [72](72-tests-parity.md)): the two
  implementations on each other's archives, key logs, key files and
  wallets;
- `tests/owners.test.js` (chapter [73](73-tests-owners.md)): the commands
  of owners and keys, wallets, passkeys and key stores, through the
  command line, with doubles of GitHub, the keychain, the clipboard and
  the browser;
- `tests/services.test.js` (chapter [75](75-tests-services.md)): arXiv
  and Zenodo, against doubles of both: the metadata, the e-prints, an
  import, deposits, a deposit interrupted and completed.

`deno task test` runs them all (`deno test -A tests/`).

    // in tests/core.test.js:
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
    import { verifyFolder } from '../core/check.js';
    import { loadSchemas } from '../core/schema.js';
    import { notice, withdraw, relate, relicense, describe, complete } from '../core/describe.js';
    import * as collections from '../core/collections.js';
    import { esc, fmtDate, pyJson, namesJoined, readableIndex, present, safeUrl, link } from '../core/website.js';
    import { keeperLink, successorClaim, CONFIRMED, CLAIMED, NOT_CHECKED, KeeperUnreachable } from '../core/keepers.js';
    import { loadEntries, merge, normalise } from '../core/inputs.js';
    import { mirror } from '../core/mirror.js';
    import { branch } from '../core/branch.js';
    import { draftDeposit, draftDelete, seal } from '../core/drafts.js';
    import { takedown } from '../core/takedown.js';
    import { Resolver } from '../core/resolve.js';
    import { Http } from '../core/http.js';
    import { writeDiscovery, PAGING } from '../core/discovery.js';
    import { ownerRotate } from '../core/owner.js';
    import { loadKeyLog } from '../core/keylogs.js';
    import { WITNESSES, fileName } from '../core/signatures.js';
    import { currentVersion, versionsOf, withdrawnVersions, dateOf } from '../core/versions.js';

    <<an environment for the tests>>

    <<tests of storages>>

    <<tests of the files written>>

    <<tests of key files>>

    <<tests of an archive in memory>>

    <<tests of descriptions>>

    <<tests of collections and the website>>

    <<tests of keepers and of options read from files>>

An environment for the tests
----------------------------

The tests keep everything in memory: the archive in a `MemoryStorage`,
the current keys in a map, the exported rotation keys in another; the
new keys are those of appendix C's labels, in turn, so that a test is
the same at every run; what the commands print is collected; nothing is
read over the network, and the templates are those of the repository. The cost of
Argon2id is lowered to its minimum, which the files record.

    // in an environment for the tests:
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

Storages
--------

A storage in memory reads what it was given, lists folders in the order
of code points, moves folders, refuses paths that leave it, and does not
replace a file written exclusively; its `fetch` answers files under its
origin and nothing else.

    // in tests of storages:
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

The files written
-----------------

JSON is written as `json.dumps(..., indent=2, ensure_ascii=False)` writes
it; an inventory is ordered as opensheaf-py's `ordered_inventory` orders
it, whatever the order it was built in.

    // in tests of the files written:
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

Key files
---------

A rotation key file is read back, in clear or under its passphrase; a
wrong passphrase, a missing one, a damaged seed, a seed of another key,
and an Argon2id cost out of bounds are refused. A sheet's seed in base32
is read back with its check, and a mistyped character is caught.

    // in tests of key files:
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

An archive in memory
--------------------

The whole first path, in memory: an archive made with a new owner, whose
rotation keys are exported under a passphrase and read back; a paper
deposited, a second version, the owner catalogue collected; and the
verification, which finds nothing wrong. Then what must fail: a label
taken, a version without its PDF or with a file that is not one, a key
that does not sign, a content file changed behind the archive's back.

    // in tests of an archive in memory:
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

A deposit of the own files and change note of the current version is
refused, writing nothing; a return to the files of an earlier version is
a revert, a new document version (section 4.2). An object version that
repeats the current version under a new number, written behind the
deposit's back, is reported by the verification; a renamed file is
something new, and is not.

    // in tests of an archive in memory:
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

The fields that say what the files of a document version are belong to it
(section 4.2): an object version written behind the commands' back that
holds the same document version, and changes the media type of a
rendition, or adds a toolchain, is reported. Records at external services
are only added to: a later version may add one, and one that drops a
record is reported. These are the cases of opensheaf-py's test, with the
same messages.

    // in tests of an archive in memory:
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

A withdrawal is kept by the description-only versions after it, and only
a new document version reinstates the line; a new document version is
never a withdrawal (section 13.1). The cases of opensheaf-py's test, with
the same messages.

    // in tests of an archive in memory:
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

A collection is a document whose source is `members.json` (section 4.2):
a new member list is a new document version, and a description-only
version may hold an earlier one, which leaves the current version where it
was. A member list changed under the same number is reported.

    // in tests of an archive in memory:
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

Notices written behind the commands' back: a replacement of a notice
about another document version, of one replaced already, or of no earlier
notice is reported, as in opensheaf-py's test.

    // in tests of an archive in memory:
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

Digests in inventories and checksum files are in lower case (section 4.1):
a checksum file rewritten in upper case, and an inventory whose manifest
and state are rewritten in upper case, are each reported as such.

    // in tests of an archive in memory:
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

JSON nested deeper than `LIMITS.nesting` is a finding, as the HTTP
client refuses it (chapter [10](10-http.md)), not a stack overflow of
the verification: an inventory with arrays nested twenty thousand deep,
in the root and in the version folder, with checksum files that state
its digest, is an object without a readable inventory.

    // in tests of an archive in memory:
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

Descriptions
------------

Every description-only version keeps the files and the document version
of the head, and the history follows it; a completion adds the sources;
each is refused when there is nothing to do, and a line whose versions are
not all signed is extended only with `iKnow`.

    // in tests of descriptions:
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

Notices are numbered by their position (section 4.2). A later notice
replaces an earlier one about the same document version by its number,
once; a replacement of a notice about another version, of one replaced
already, or of no notice is refused, with opensheaf-py's messages.

    // in tests of descriptions:
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

Collections and the website
---------------------------

The cached citation of each member keeps its `Available` date beside its
`Issued` date (section 8.2), so that sorting the written member list again
gives the order the catalogue has: here three papers with one `Issued`
date, ordered by their `Available` dates, newest first, as in
opensheaf-py's test.

    // in tests of collections and the website:
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

A selection and a catalogue of the archive's own lines, made, changed and
read back; the website shows the pins and the `sheaf:` URIs, and its
verification fails when a landing page is missing.

    // in tests of collections and the website:
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

An archive whose home page is a TeXmacs index has its landing pages
written after a change (`present`, which the command line calls), and by
`osheaf index`, as opensheaf-py writes
them; its home page is left alone, and `osheaf index` says that
`index.tm` is opensheaf-py's to typeset.

    // in tests of collections and the website:
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
      assert.equal(namesJoined(['A', 'B', 'C']), 'A, B and C');
      assert.equal(pyJson({ a: [1, 'x'], b: { c: null } }), '{"a": [1, "x"], "b": {"c": null}}');
    });

Keepers, and options read from files
------------------------------------

The link to a keeper, read with a fetch of the tests: an ORCID record that
links the owner (and names a successor), one that does not, a domain that
lists the owner, a place that does not answer.

    // in tests of keepers and of options read from files:
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

The options of a file keep their values as text, take their paths
relative to the file, and give way to the command line.

    // in tests of keepers and of options read from files:
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

Across archives, in memory
--------------------------

Two archives in memory, the second reading the first through the `fetch`
of its storage, at the first's base URL: a mirror of a line of the first,
a branch of it, a draft rewritten and sealed, and takedowns of the mirror
and of its key log by law, the second verifying without an error at
every step (once the key log is gone, the branch point is unchecked). The tests of chapter [74](74-tests-across.md) compare all of
it with opensheaf-py.

    // in tests of keepers and of options read from files:
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

Files rewritten in place are written beside themselves and renamed
(chapter [20](20-storage.md)): through a rotation of the owner's keys
(the key log's root inventory), a draft replaced (the draft's) and a
change of `osheaf.json`, none of them is written where it is read, and
no temporary file is left behind.

    // in tests of keepers and of options read from files:
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

Only `http` and `https` addresses become links, as opensheaf-py's
`test_only_http_links`: a file of members that adds a `javascript:` URL,
or a plain `http` one, to the `at` of a member already in a collection
does not get it recorded, and each is noted; `safeUrl` and `link` let
only `http` and `https` URLs through, any other value staying text.

    // in tests of keepers and of options read from files:
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

A member elsewhere shows only the files its pinned inventory names, as
opensheaf-py's `test_a_member_elsewhere_whose_files_are_not_those_pinned`:
a `datacite.json` changed behind its inventory is not shown, the entry
falls back on the cached citation; and a description whose inventory is
rewritten to match, pinned by hand, but without a title, fails that member
only, the rest of the website being written.

    // in tests of keepers and of options read from files:
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

A mirror copies what it judged, as opensheaf-py's
`test_mirror_copies_what_it_judged`: when the authors' copy changes
between the reading that judges it and the fetch that copies it (the
inventory of v2 gets another byte), nothing is copied. A signature file
that does not verify, beside the good one and named after a key of the
key log (a server lists no folders), is left out of the mirror, which
verifies.

    // in tests of keepers and of options read from files:
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

The status of a member elsewhere is read from the discovery document of
its archive, from its pages of objects when it pages them (#19), as
opensheaf-py's `test_a_withdrawn_member_of_a_paged_archive`: a line
withdrawn in an archive with a page per object is shown withdrawn, with
its reason, on the home page of the archive that features it.

    // in tests of keepers and of options read from files:
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

A description without a licence or rights statement is an error, and a
landing page describes itself for programs (appendix A.3), as
opensheaf-py's `test_missing_rights_is_an_error` and
`test_landing_page_describes_itself`: Signposting links, and a schema.org
record with its type, licence, identifiers and encodings; without that
record, the page is reported.

    // in tests of keepers and of options read from files:
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
    });

A pin of a key-log version resolves only to a version of the key log, as
opensheaf-py's `test_a_pin_to_a_key_log_version_that_is_not_one`: once
the signatures of v2 are gone, v2 is still held with the number and
digest pinned, but it is no longer a version of the key log; the pin is
*not a version*, never verified, and a collection held here that pins it
(written by hand: the tools pin only documents and collections) is
reported by the verifier.

    // in tests of keepers and of options read from files:
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

A pin is decided by the bytes of the inventory (section 12.3), as
opensheaf-py's `test_copies_that_disagree_with_a_pin`: a copy without
checksum files still matches, with a warning naming it; a copy whose
inventory was changed does not match, and is reported with its location,
while another copy decides the status; alone, it is a mismatch.

    // in tests of keepers and of options read from files:
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

What a mirror serves is believed only as far as the signed inventories
bind it, as opensheaf-py's resolver checks every file it copies: a root
inventory of the mirror's own, which maps `datacite.json` to other bytes,
is not read (the copy in the folder of the head version is), and other
bytes served at the content path of `datacite.json` are refused, since
they do not have the digest the inventory states.

    // in tests of keepers and of options read from files:
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
      await assert.rejects(r.describe(res), (e) => e.kind === 'digest' && /does not have the digest/.test(e.message));
    });

An archive of many objects lists them in pages (section 3.1), as
opensheaf-py's `test_object_pages`, with pages of two objects: the
discovery document names the pages, which hold every entry once; the
archive verifies, and its labels are read from the pages; a page missing
is an error, and writing the discovery document or the website then
stops, leaving both as they were (as opensheaf-py's `refuse_unread_pages`,
#19); back to one page, the pages are removed.

    // in tests of keepers and of options read from files:
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
