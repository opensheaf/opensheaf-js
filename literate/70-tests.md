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
    import { deposit, creator, checkRights } from '../core/deposit.js';
    import { collect } from '../core/collect.js';
    import { verifyFolder } from '../core/check.js';
    import { loadSchemas } from '../core/schema.js';
    import { notice, withdraw, relate, relicense, describe, complete } from '../core/describe.js';
    import * as collections from '../core/collections.js';
    import { esc, fmtDate, pyJson, namesJoined, readableIndex } from '../core/website.js';
    import { keeperLink, successorClaim, CONFIRMED, CLAIMED, NOT_CHECKED, KeeperUnreachable } from '../core/keepers.js';
    import { loadEntries, merge, normalise } from '../core/inputs.js';
    import { mirror } from '../core/mirror.js';
    import { branch } from '../core/branch.js';
    import { draftDeposit, draftDelete, seal } from '../core/drafts.js';
    import { takedown } from '../core/takedown.js';

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
deposited, a second version, the main catalogue collected; and the
verification, which finds nothing wrong. Then what must fail: a label
taken, a version without its PDF or with a file that is not one, a key
that does not sign, a content file changed behind the archive's back.

    // in tests of an archive in memory:
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

Collections and the website
---------------------------

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
