Tests: GitHub and the requests
==============================

The tests of chapters [47](47-github-storage.md) and
[48](48-requests.md), in `tests/github.test.js`:

- the storage over GitHub against a **double of GitHub's API**, in the
  process (`tests/fake-github.js`): a repository of real git objects
  (blobs, trees and commits named as git names them), the endpoints the
  storage calls, and the refusal of a move of a branch that is not a fast
  forward; nothing reaches GitHub;
- the six methods of a storage, as the storage in memory does them;
- one commit per command, nothing committed when nothing changed, the
  conflict of two pages and the command run again, trees too large for
  one answer, the mirror and its check, prefetching;
- **the same requests on a disk and on GitHub**: one archive, copied into
  a folder and into the double's repository, the same requests carried
  out on both (new papers and new versions, sources in a zip, notices,
  licences, a withdrawal, collections and their members); the folder and the
  repository's head then hold the same files, byte for byte;
- **the same requests by the template's script and by this program**: the
  script `osheaf_issue.py` of the archive template with opensheaf-py, and
  `carryOut` with this program's command line (`tests/request.js`), on two
  copies of one archive (outside GitHub's workflows as far as the script
  can tell: it refuses to run there without the workflows' key); the files are compared as the parity tests of
  chapter [72](72-tests-parity.md) compare them. These run when
  opensheaf-py is installed and the script is found (`OSHEAF_ISSUE`, or
  the template's repository next to this one);
- **the Manager's core** (chapter [49](49-manager.md)): the popup's
  hand-off (a vector shared with the unlock page's tests, the code, the
  answers refused), keys opened from a wallet by a passkey's secret and
  kept unexportable, and a request written directly to the double's
  repository.

    // in tests/github.test.js:
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { mkdtemp, rm, cp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
    import { existsSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    import { fileURLToPath } from 'node:url';
    import path from 'node:path';
    import os from 'node:os';
    import process from 'node:process';
    import { fakeGitHub } from './fake-github.js';
    import { GitHub, GitHubStorage, CommitConflict, oneCommit, gitBlobSha } from '../core/github.js';
    import { MemoryStorage, StorageError } from '../core/storage.js';
    import { DiskStorage } from '../cli/disk.js';
    import { environment } from '../core/folder.js';
    import { init } from '../core/init.js';
    import { carryOut, yamlText, readZip, NEW_PAPER, NEW_VERSION } from '../core/requests.js';
    import { exampleKey } from '../core/keys.js';
    import { loadSchemas } from '../core/schema.js';
    import { utf8 } from '../core/crypto.js';
    import { KeeperUnreachable } from '../core/keepers.js';
    import { keyPairOf, seal, popupRequest, openPopupAnswer, popupUrl, b64url, UnlockFailed } from '../core/passkey.js';
    import { keyFileText, keyText, Passkey, passkeySalt, passkeyKek } from '../core/keys.js';
    import { browserEnvironment, schemasOf, directWrite, keyFromText, walletLocks, openLocks, signers,
             prefetched } from '../web/manager.js';

    <<the double of GitHub, used>>

    <<tests of the storage over GitHub>>

    <<tests of the same requests on a disk and on GitHub>>

    <<tests of the same requests by the script and by this program>>

    <<tests of the Manager's core>>

The double of GitHub
--------------------

Objects are kept by their names, which are git's: the SHA-1 digest of
`blob`, `tree` or `commit`, the size, a zero byte and the content. A tree
lists its entries in git's order (a folder compared as its name followed
by `/`), each its mode, its name, a zero byte and the 20 bytes of the
object's name. Commits carry a fixed author and a time that counts up.

    // in tests/fake-github.js:
    import { createHash } from 'node:crypto';

    const enc = new TextEncoder();

    function gitName(type, body) {
      return createHash('sha1').update(enc.encode(`${type} ${body.length}\0`)).update(body).digest('hex');
    }

    function concat(parts) {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    }

    const treeOrder = (a, b) => {
      const x = a.type === 'tree' ? a.name + '/' : a.name, y = b.type === 'tree' ? b.name + '/' : b.name;
      return x < y ? -1 : x > y ? 1 : 0;
    };

The repository: objects, branches, a log of the calls, and switches for
the tests: `truncate` (the largest recursive tree answered whole),
`beforeMove` (called before a branch is moved, to push meanwhile), and
`sites`, the addresses of mirrors of a repository, which serve the files
of its branch, or of an older commit (`stale`), or altered (`alter`).

    // in tests/fake-github.js:
    export function fakeGitHub({ token = 'fake-token-of-the-tests', api = 'https://api.github.test' } = {}) {
      const objects = new Map(), repos = new Map(), calls = [], sites = new Map();
      const g = { api, token, objects, repos, calls, sites, truncate: Infinity, beforeMove: null, time: 1_700_000_000 };

      g.put = (type, body, extra = {}) => {
        const sha = gitName(type, body);
        if (!objects.has(sha)) objects.set(sha, { type, body, ...extra });
        return sha;
      };

      g.blob = (bytes) => g.put('blob', bytes);

A tree from a flat map of paths to `{ mode, sha }`, folder by folder; and
the flat map of a tree, for the trees made on top of another.

    // in tests/fake-github.js:
      g.tree = (flat) => {
        const build = (prefix) => {
          const here = new Map();
          for (const [p, e] of flat) {
            if (!p.startsWith(prefix)) continue;
            const rest = p.slice(prefix.length), k = rest.indexOf('/');
            if (k < 0) here.set(rest, { name: rest, type: 'blob', mode: e.mode, sha: e.sha });
            else if (!here.has(rest.slice(0, k))) here.set(rest.slice(0, k), { name: rest.slice(0, k), type: 'tree', mode: '40000' });
          }
          const entries = [...here.values()];
          for (const e of entries) if (e.type === 'tree') e.sha = build(prefix + e.name + '/');
          entries.sort(treeOrder);
          const body = concat(entries.flatMap((e) => [enc.encode(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')]));
          return g.put('tree', body, { entries });
        };
        return build('');
      };

      g.flat = (treeSha, prefix = '', out = new Map()) => {
        for (const e of objects.get(treeSha).entries) {
          if (e.type === 'tree') g.flat(e.sha, prefix + e.name + '/', out);
          else out.set(prefix + e.name, { mode: e.mode, sha: e.sha });
        }
        return out;
      };

      g.commit = (tree, parents, message) => {
        g.time += 60;
        const text = [`tree ${tree}`, ...parents.map((p) => `parent ${p}`),
                      `author Tests <tests@example.org> ${g.time} +0000`, `committer Tests <tests@example.org> ${g.time} +0000`,
                      '', message].join('\n');
        return g.put('commit', enc.encode(text), { tree, parents, message });
      };

A repository made from files, `{ path: bytes or text }` (a mode may be
given as `[bytes, mode]`); a push to it (as another page, or a person,
would push); and its files at the head, or at a commit.

    // in tests/fake-github.js:
      g.create = (repo, files, { branch = 'main' } = {}) => {
        repos.set(repo, { branch, refs: new Map() });
        const flat = new Map();
        for (const [p, v] of Object.entries(files)) {
          const [bytes, mode] = Array.isArray(v) ? v : [v, '100644'];
          flat.set(p, { mode, sha: g.blob(typeof bytes === 'string' ? enc.encode(bytes) : bytes) });
        }
        repos.get(repo).refs.set(branch, g.commit(g.tree(flat), [], 'The first commit'));
      };

      g.push = (repo, files, message = 'A push') => {
        const r = repos.get(repo), head = r.refs.get(r.branch);
        const flat = g.flat(objects.get(head).tree);
        for (const [p, v] of Object.entries(files)) {
          if (v === null) flat.delete(p);
          else flat.set(p, { mode: '100644', sha: g.blob(typeof v === 'string' ? enc.encode(v) : v) });
        }
        r.refs.set(r.branch, g.commit(g.tree(flat), [head], message));
      };

      g.head = (repo) => repos.get(repo).refs.get(repos.get(repo).branch);

      g.files = (repo, commit = g.head(repo)) => {
        const out = new Map();
        for (const [p, e] of g.flat(objects.get(commit).tree)) out.set(p, objects.get(e.sha).body);
        return out;
      };

      g.modes = (repo) => new Map([...g.flat(objects.get(g.head(repo)).tree)].map(([p, e]) => [p, e.mode]));

The API, as `fetch`: the token is checked, the call logged, and the
answers are GitHub's, as far as the storage reads them.

    // in tests/fake-github.js:
      const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
      const b64 = (bytes) => Buffer.from(bytes).toString('base64');

      g.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        for (const [base, site] of sites) {
          if (String(url).startsWith(base)) {
            calls.push({ method: 'GET', path: String(url) });
            const p = decodeURIComponent(String(url).slice(base.length));
            const at = site.stale || g.head(site.repo);
            const bytes = g.files(site.repo, at).get(p);
            if (!bytes) return new Response('not found', { status: 404 });
            return new Response(site.alter?.has(p) ? enc.encode('altered') : bytes, { status: 200 });
          }
        }
        if (!String(url).startsWith(api + '/')) throw new TypeError(`no network in the tests: ${url}`);
        const method = init.method || 'GET';
        calls.push({ method, path: u.pathname + u.search });
        if ((init.headers?.Authorization || init.headers?.authorization) !== `Bearer ${token}`) {
          return json(401, { message: 'Bad credentials' });
        }
        const body = init.body ? JSON.parse(init.body) : null;
        const m = /^\/repos\/([^/]+\/[^/]+)(?:\/(.*))?$/.exec(u.pathname);
        const r = m && repos.get(m[1]);
        if (!r) return json(404, { message: 'Not Found' });
        const rest = m[2] || '';
        if (!rest) return json(200, { full_name: m[1], default_branch: r.branch, private: false });
        let x;
        if ((x = /^git\/ref\/heads\/(.+)$/.exec(rest)) && method === 'GET') {
          const sha = r.refs.get(decodeURIComponent(x[1]));
          return sha ? json(200, { ref: `refs/heads/${x[1]}`, object: { type: 'commit', sha } }) : json(404, { message: 'Not Found' });
        }
        if ((x = /^git\/commits\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
          const c = objects.get(x[1]);
          if (c?.type !== 'commit') return json(404, { message: 'Not Found' });
          return json(200, { sha: x[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message });
        }
        if ((x = /^git\/trees\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
          const t = objects.get(x[1]);
          if (t?.type !== 'tree') return json(404, { message: 'Not Found' });
          const item = (e, p) => ({ path: p, mode: e.mode, type: e.type, sha: e.sha,
                                    ...(e.type === 'blob' ? { size: objects.get(e.sha).body.length } : {}) });
          if (u.searchParams.get('recursive')) {
            const all = [];
            const walk = (sha, prefix) => {
              for (const e of objects.get(sha).entries) {
                all.push(item(e, prefix + e.name));
                if (e.type === 'tree') walk(e.sha, prefix + e.name + '/');
              }
            };
            walk(x[1], '');
            if (all.length > g.truncate) return json(200, { sha: x[1], tree: all.slice(0, g.truncate), truncated: true });
            return json(200, { sha: x[1], tree: all, truncated: false });
          }
          return json(200, { sha: x[1], tree: t.entries.map((e) => item(e, e.name)), truncated: false });
        }
        if ((x = /^git\/blobs\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
          const b = objects.get(x[1]);
          if (b?.type !== 'blob') return json(404, { message: 'Not Found' });
          if ((init.headers?.Accept || '').includes('raw')) return new Response(b.body, { status: 200 });
          return json(200, { sha: x[1], content: b64(b.body), encoding: 'base64', size: b.body.length });
        }
        if (rest === 'git/blobs' && method === 'POST') {
          return json(201, { sha: g.blob(new Uint8Array(Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf-8'))) });
        }
        if (rest === 'git/trees' && method === 'POST') {
          const flat = body.base_tree ? g.flat(body.base_tree) : new Map();
          for (const e of body.tree) {
            if (e.sha === null) {
              flat.delete(e.path);
            } else {
              if (objects.get(e.sha)?.type !== 'blob') return json(422, { message: `tree.sha ${e.sha} is not a valid blob` });
              flat.set(e.path, { mode: e.mode, sha: e.sha });
            }
          }
          return json(201, { sha: g.tree(flat) });
        }
        if (rest === 'git/commits' && method === 'POST') {
          const sha = g.commit(body.tree, body.parents, body.message);
          return json(201, { sha, html_url: `https://github.test/${m[1]}/commit/${sha}` });
        }
        if ((x = /^git\/refs\/heads\/(.+)$/.exec(rest)) && method === 'PATCH') {
          if (g.beforeMove) {
            const f = g.beforeMove;
            g.beforeMove = null;
            f(m[1]);
          }
          const branch = decodeURIComponent(x[1]), current = r.refs.get(branch);
          if (!body.force && !objects.get(body.sha)?.parents.includes(current)) {
            return json(422, { message: 'Update is not a fast forward' });
          }
          r.refs.set(branch, body.sha);
          return json(200, { ref: `refs/heads/${branch}`, object: { type: 'commit', sha: body.sha } });
        }
        return json(404, { message: 'Not Found' });
      };

      return g;
    }

The double, used
----------------

A client of the storage for the double, and a repository of a few files.

    // in the double of GitHub, used:
    const REPO = 'jane/papers';

    function client(g) {
      return new GitHub({ api: g.api, fetch: g.fetch, token: g.token });
    }

    function repository(files = {}) {
      const g = fakeGitHub();
      g.create(REPO, { 'README.md': 'An archive.\n', 'ocfl/0=ocfl_1.1': 'ocfl_1.1\n', 'run.sh': [utf8('#!/bin/sh\n'), '100755'],
                       ...files });
      return g;
    }

    const text = (bytes) => new TextDecoder().decode(bytes);

The storage over GitHub
-----------------------

The six methods, as the storage in memory does them: reading, writing
(exclusive or not, never over a folder, never under a file), kinds and
lists, renames of files and folders, removals.

    // in tests of the storage over GitHub:
    test('a storage over GitHub reads the head and behaves as the storage in memory', async () => {
      const g = repository({ 'ocfl/jane/a/inventory.json': '{}\n' });
      const s = await GitHubStorage.open(REPO, client(g));
      const m = new MemoryStorage();
      for (const [p, bytes] of g.files(REPO)) await m.write(p, bytes);
      for (const st of [s, m]) {
        assert.equal(text(await st.read('README.md')), 'An archive.\n');
        assert.equal(await st.read('nothing'), null);
        assert.equal(await st.kind(''), 'dir');
        assert.equal(await st.kind('ocfl/jane'), 'dir');
        assert.equal(await st.kind('ocfl/jane/a/inventory.json'), 'file');
        assert.deepEqual(await st.list('ocfl'), [{ name: '0=ocfl_1.1', kind: 'file' }, { name: 'jane', kind: 'dir' }]);
        await st.write('stage/v1/content/a.txt', utf8('a'));
        await st.write('stage/v1/content/b.txt', utf8('b'));
        await assert.rejects(st.write('stage/v1/content/a.txt', utf8('again'), { exclusive: true }), StorageError);
        await assert.rejects(st.write('stage/v1', utf8('x')), StorageError);
        await assert.rejects(st.write('README.md/x', utf8('x')), StorageError);
        await st.rename('stage/v1', 'ocfl/jane/a/v1');
        assert.equal(await st.kind('stage'), null);
        assert.deepEqual(await st.list('ocfl/jane/a'), [{ name: 'inventory.json', kind: 'file' }, { name: 'v1', kind: 'dir' }]);
        await assert.rejects(st.rename('README.md', 'ocfl/jane'), StorageError);
        await assert.rejects(st.remove('ocfl/jane/a/v1'), StorageError);
        await st.remove('ocfl/jane/a/v1/content/b.txt');
        assert.deepEqual(await st.list('ocfl/jane/a/v1/content'), [{ name: 'a.txt', kind: 'file' }]);
        await st.rename('ocfl/jane/a/v1/content/a.txt', 'README.md');
        assert.equal(text(await st.read('README.md')), 'a');
        assert.equal(await st.kind('ocfl/jane/a/v1'), null);
      }
      assert.deepEqual(await s.list(''), await m.list(''));
    });

One command, one commit: the files written are uploaded, a folder moved
costs no upload, a file written with the bytes it had is no change, an
executable file keeps its mode; the head moves once, and the repository
then holds what the storage held. Nothing changed, nothing committed.

    // in tests of the storage over GitHub:
    test('the changes of a command are one commit on top of the head', async () => {
      const g = repository();
      const before = g.head(REPO);
      const s = await GitHubStorage.open(REPO, client(g));
      await s.write('README.md', utf8('An archive.\n'));
      await s.write('.staging-1/v1/content/paper.pdf', utf8('%PDF'));
      await s.rename('.staging-1/v1', 'ocfl/jane/paper/v1');
      await s.write('index.html', utf8('<p>home</p>\n'));
      await s.remove('ocfl/0=ocfl_1.1');
      const { changed, removed } = await s.changes();
      assert.deepEqual(changed.map((e) => e.path), ['index.html', 'ocfl/jane/paper/v1/content/paper.pdf']);
      assert.deepEqual(removed.map((e) => e.path), ['ocfl/0=ocfl_1.1']);
      const done = await s.commit('A deposit\n\npaper: v1\n');
      assert.equal(done.changed, 2);
      assert.equal(g.head(REPO), done.sha);
      assert.deepEqual(g.objects.get(done.sha).parents, [before]);
      assert.equal(g.objects.get(done.sha).message, 'A deposit\n\npaper: v1\n');
      const files = g.files(REPO);
      assert.deepEqual([...files.keys()].sort(), ['README.md', 'index.html', 'ocfl/jane/paper/v1/content/paper.pdf', 'run.sh']);
      assert.equal(text(files.get('ocfl/jane/paper/v1/content/paper.pdf')), '%PDF');
      assert.equal(g.modes(REPO).get('run.sh'), '100755');
      assert.equal(g.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/git/blobs')).length, 2);
      assert.equal(await s.commit('nothing'), null);
      assert.equal(await s.size('README.md'), 12);
      assert.equal(await s.size('ocfl/jane'), null);
      await s.write('run.sh', utf8('#!/bin/sh\necho\n'));
      await s.commit('Changed');
      assert.equal(g.modes(REPO).get('run.sh'), '100755');
      assert.equal(await gitBlobSha(utf8('')), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    });

Two pages, one branch: the second to commit finds the branch moved and is
refused; `oneCommit` runs its command again on the new head, which then
holds both changes.

    // in tests of the storage over GitHub:
    test('a branch moved meanwhile: the commit is refused, and the command run again on the new head', async () => {
      const g = repository();
      const s = await GitHubStorage.open(REPO, client(g));
      await s.write('a.txt', utf8('a'));
      g.push(REPO, { 'b.txt': 'b' });
      await assert.rejects(s.commit('a'), CommitConflict);
      let runs = 0;
      g.beforeMove = () => g.push(REPO, { 'c.txt': 'c' });
      const done = await oneCommit(REPO, client(g), async (st) => {
        runs++;
        await st.write('a.txt', utf8(`a after ${(await st.list('')).length} entries`));
        return { message: 'a', seen: await st.kind('c.txt') };
      });
      assert.equal(runs, 2);
      assert.equal(done.attempts, 2);
      assert.equal(done.seen, 'file');
      assert.deepEqual([...g.files(REPO).keys()].sort(), ['README.md', 'a.txt', 'b.txt', 'c.txt', 'ocfl/0=ocfl_1.1', 'run.sh']);
      const nothing = await oneCommit(REPO, client(g), async () => ({ message: null }));
      assert.equal(nothing.commit, null);
    });

A tree too large for one answer is read folder by folder; the mirror is
used when what it serves is the blob, and left when it serves an older
commit or something altered; prefetching fills the cache, which the
next storage shares.

    // in tests of the storage over GitHub:
    test('a truncated tree, the mirror and its check, prefetching', async () => {
      const files = {};
      for (let k = 0; k < 30; k++) files[`ocfl/jane/p${k}/inventory.json`] = `{"n": ${k}}\n`;
      const g = repository(files);
      g.truncate = 10;
      const site = 'https://jane.example/papers/';
      g.sites.set(site, { repo: REPO });
      const cache = new Map();
      const s = await GitHubStorage.open(REPO, client(g), { mirror: site, cache });
      assert.equal((await s.list('ocfl/jane')).length, 30);
      assert.equal(text(await s.read('ocfl/jane/p7/inventory.json')), '{"n": 7}\n');
      assert.deepEqual(s.reads, { cache: 0, mirror: 1, api: 0 });
      const old = g.head(REPO);
      g.push(REPO, { 'ocfl/jane/p8/inventory.json': '{"n": "eight"}\n' });
      g.sites.set(site, { repo: REPO, stale: old, alter: new Set(['README.md']) });
      const t = await GitHubStorage.open(REPO, client(g), { mirror: site, cache });
      assert.equal(text(await t.read('ocfl/jane/p8/inventory.json')), '{"n": "eight"}\n');
      assert.equal(text(await t.read('README.md')), 'An archive.\n');
      assert.deepEqual(t.reads, { cache: 0, mirror: 0, api: 2 });
      assert.ok((await t.prefetch()) >= 28);
      const before = t.reads.mirror + t.reads.api;
      for (let k = 0; k < 30; k++) await t.read(`ocfl/jane/p${k}/inventory.json`);
      assert.equal(t.reads.mirror + t.reads.api, before);
      const u = await GitHubStorage.open(REPO, client(g), { cache });
      await u.read('ocfl/jane/p3/inventory.json');
      assert.deepEqual(u.reads, { cache: 1, mirror: 0, api: 0 });
      await assert.rejects(GitHubStorage.open(REPO, new GitHub({ api: g.api, fetch: g.fetch, token: 'wrong' })), /Bad credentials/);
    });

The same requests on a disk and on GitHub
-----------------------------------------

One archive made in memory (chapter [70](70-tests.md)'s way: predictable
keys, the templates of this repository), with a paper and a collection;
copied into a folder of a disk and into the double's repository. The
same requests are then carried out on both, with the same times and the
same random bytes and clock (new works draw their names at random, and
their genesis records carry the time), and the folder
and the head of the repository hold the same files after each.

    // in tests of the same requests on a disk and on GitHub:
    const schemas = await loadSchemas(async (url) => JSON.parse(await readFile(fileURLToPath(url), 'utf-8')));

    function requestEnvironment() {
      const keys = new Map(), exported = new Map();
      let n = 0;
      const env = environment({
        out: () => {},
        err: () => {},
        newKey: () => exampleKey(`github key ${n++}`),
        now: () => '2026-11-21T10:00:00Z',
        today: () => '2026-11-21',
        fetch: async (url) => { throw new TypeError(`no network in the tests: ${url}`); },
        fetchJson: async (url) => { throw new KeeperUnreachable(`${url}: no network in the tests`); },
        template: async (name) => new Uint8Array(await readFile(new URL(`../templates/${name}`, import.meta.url))),
        passphrase: async () => 'correct horse',
        input: async () => '',
        keyStore: {
          keptOnDevice: () => true,
          storeName: () => 'memory',
          current: async (owner, dids) => dids.map((d) => keys.get(`${owner} ${d}`)).filter(Boolean),
          keep: async (owner, key) => {
            keys.set(`${owner} ${key.did}`, key);
            return 'memory';
          },
        },
        exportFolder: { inside: async () => null, resolve: async (folder) => folder,
                        write: async (folder, name, t) => exported.set(`${folder}/${name}`, t) && `${folder}/${name}`,
                        read: async (p) => exported.get(p) },
      });
      return env;
    }

    async function withRandomness(seed, run) {
      let x = seed;
      const iso = Date.prototype.toISOString;
      Date.prototype.toISOString = () => '2026-11-21T10:00:00.000Z';
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true, writable: true,
        value: (a) => {
          for (let k = 0; k < a.length; k++) {
            x = (x * 1103515245 + 12345) >>> 0;
            a[k] = x >>> 24;
          }
          return a;
        },
      });
      try {
        return await run();
      } finally {
        delete crypto.getRandomValues;
        Date.prototype.toISOString = iso;
      }
    }

    async function diskFiles(root, rel = '', out = new Map()) {
      for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await diskFiles(root, p, out);
        else out.set(p, new Uint8Array(await readFile(path.join(root, p))));
      }
      return out;
    }

    const PDF = (n) => utf8(`%PDF-1.4 version ${n}\n`);
    const TEX = utf8('\\documentclass{article}\n\\begin{document}Sheaves.\\end{document}\n');

    const SOURCES_ZIP = new Uint8Array(Buffer.from(
      'UEsDBBQAAAAIAAAAIVyFO1gOOQAAAEYAAAAPAAAAcGFwZXIvcGFwZXIudGV4i0nJTy7NTc0rSc5JLC6uTiwqyUzOSa3liklKTc/Mq4bJ' +
      '1gZnpCaWpRbrKCSmJ2bm6cWk5qUgJLkAUEsDBBQAAAAIAAAAIVzbQLPDDAAAAAoAAAANAAAAcGFwZXIvTElDRU5TRXN2VnCKVDDRM+AC' +
      'AFBLAwQUAAAACAAAACFcY/UjSwsAAAAJAAAADwAAAHBhcGVyL2ZpZy9hLnR4dEtUSMtMLy1K5QIAUEsDBBQAAAAIAAAAIVw5nPsGBgAA' +
      'AAQAAAAaAAAAX19NQUNPU1gvcGFwZXIvLl9wYXBlci50ZXjLKs3LBgBQSwMEFAAAAAgAAAAhXDmc+wYGAAAABAAAAA8AAABwYXBlci8u' +
      'RFNfU3RvcmXLKs3LBgBQSwECFAMUAAAACAAAACFchTtYDjkAAABGAAAADwAAAAAAAAAAAAAAgAEAAAAAcGFwZXIvcGFwZXIudGV4UEsB' +
      'AhQDFAAAAAgAAAAhXNtAs8MMAAAACgAAAA0AAAAAAAAAAAAAAIABZgAAAHBhcGVyL0xJQ0VOU0VQSwECFAMUAAAACAAAACFcY/UjSwsA' +
      'AAAJAAAADwAAAAAAAAAAAAAAgAGdAAAAcGFwZXIvZmlnL2EudHh0UEsBAhQDFAAAAAgAAAAhXDmc+wYGAAAABAAAABoAAAAAAAAAAAAA' +
      'AIAB1QAAAF9fTUFDT1NYL3BhcGVyLy5fcGFwZXIudGV4UEsBAhQDFAAAAAgAAAAhXDmc+wYGAAAABAAAAA8AAAAAAAAAAAAAAIABEwEA' +
      'AHBhcGVyLy5EU19TdG9yZVBLBQYAAAAABQAFADoBAABGAQAAAAA=', 'base64'));

    const REQUESTS = [
      ['deposit', { 'This deposit': NEW_VERSION, Label: 'first', 'What changed (for a new version)': 'Corrected.',
                    'In collection': 'reading' },
       { 'PDF of this version': [{ name: 'paper v2.pdf', bytes: PDF(2) }], Sources: [{ name: 'paper.tex', bytes: TEX }] }],
      ['deposit', { 'This deposit': NEW_PAPER, Label: 'second', Title: 'A second paper', Authors: 'Doe, Jane|University\nRoe, Rich',
                    Abstract: 'We study: archives.', Keywords: 'sheaves, archives', Licence: 'CC BY 4.0 (cc-by-4.0)',
                    'If there are no sources, why': 'Lost.', 'Date the paper first appeared': '2025-03-01',
                    'In collection': 'reading', Position: '1', 'Why (optional)': 'A test' },
       { 'PDF of this version': [{ name: 'second.pdf', bytes: PDF(1) }] }],
      ['notice', { Label: 'first', 'Document version it is about': '1', 'Text of the notice': 'A sign error in section 2.' }, {}],
      ['relicense', { Label: 'second', 'New licence': 'CC0 1.0 (cc0-1.0)', 'How the authors agreed': 'by e-mail' }, {}],
      ['new_collection', { 'Label of the new collection': 'issue-1', 'Title of the collection': 'Issue 1: sheaves',
                           Kind: 'Selection', Description: 'The first issue.\n\nTwo papers.', 'In collection': 'reading',
                           'Feature it on the home page': 'Yes' }, {}],
      ['add', { 'In collection': 'issue-1', 'New member': 'first', 'Versions you vet (selection)': '1' }, {}],
      ['vet', { 'In collection': 'issue-1', Member: 'first', 'Versions to vet': '2' }, {}],
      ['remove', { 'In collection': 'reading', 'Member to remove': 'second' }, {}],
      ['withdraw', { Label: 'second', 'Reason for the withdrawal': 'A duplicate.' }, {}],
      ['deposit', { 'This deposit': NEW_VERSION, Label: 'first', 'Licence file': 'LICENSE', Licence: 'Keep as before' },
       { 'PDF of this version': [{ name: 'paper.pdf', bytes: PDF(3) }], Sources: [{ name: 'sources.zip', bytes: SOURCES_ZIP }] }],
    ];

    const REFUSED = [
      ['vet', { 'In collection': 'reading', Member: 'first', 'Versions to vet': '1' }, {}],
      ['deposit', { 'This deposit': NEW_PAPER, Label: 'first', Title: 'Again', Authors: 'Doe, Jane' },
       { 'PDF of this version': [{ name: 'p.pdf', bytes: PDF(1) }] }],
      ['add', { 'In collection': 'issue-1', 'New member': 'first' }, {}],
      ['notice', { Label: 'first', 'Document version it is about': '9', 'Text of the notice': 'No such version.' }, {}],
    ];

    test('the same requests carried out on a disk and on GitHub give the same files', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'osheaf-github-'));
      try {
        const env = requestEnvironment();
        const start = await withRandomness(1, async () => {
          const m = new MemoryStorage();
          await init(m, env, { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                               newOwner: true, export: '/keys', yes: true, cost: { opslimit: 1, memlimit: 8192 } }, '/archive');
          const r1 = await carryOut(m, env, 'deposit', { 'This deposit': NEW_PAPER, Label: 'first', Title: 'A paper',
                                                          Authors: 'Doe, Jane', Licence: 'CC BY 4.0 (cc-by-4.0)' },
                                    { 'PDF of this version': [{ name: 'paper.pdf', bytes: PDF(1) }],
                                      Sources: [{ name: 'paper.tex', bytes: TEX }] }, { schemas });
          assert.ok(r1.ok, r1.message);
          await m.write('collections/reading.yaml', utf8('title: Reading\ntype: catalogue\nmembers: []\n'));
          return m;
        });
        const disk = new DiskStorage(path.join(root, 'archive'));
        const g = fakeGitHub();
        const files = {};
        for (const [p, bytes] of start.files) {
          await disk.write(p, bytes);
          files[p] = bytes;
        }
        g.create(REPO, files);
        let seed = 10;
        for (const [operation, fields, attached] of REQUESTS) {
          seed++;
          const a = await withRandomness(seed, () => carryOut(disk, env, operation, fields, attached, { schemas }));
          const b = await withRandomness(seed, async () => {
            const s = await GitHubStorage.open(REPO, client(g));
            const r = await carryOut(s, env, operation, fields, attached, { schemas, digests: false });
            if (r.ok) await s.commit(r.commitMessage);
            return r;
          });
          assert.ok(a.ok, `${operation}: ${a.message}`);
          assert.deepEqual(b, a, operation);
          const onDisk = await diskFiles(path.join(root, 'archive'));
          const onGitHub = g.files(REPO);
          assert.deepEqual([...onGitHub.keys()].sort(), [...onDisk.keys()].sort(), operation);
          for (const [p, bytes] of onDisk) assert.deepEqual(onGitHub.get(p), bytes, `${operation}: ${p}`);
          assert.equal(g.objects.get(g.head(REPO)).message, a.commitMessage);
        }
        const yaml = text(g.files(REPO).get('collections/issue-1.yaml'));
        assert.match(yaml, /^title: 'Issue 1: sheaves'\ndescription: 'The first issue.\n\n\n  Two papers.'\ntype: selection\n/m);
        const refused = await carryOut(disk, env, 'vet', { 'In collection': 'reading', Member: 'first', 'Versions to vet': '1' }, {});
        assert.equal(refused.ok, false);
        assert.match(refused.message, /Versions are vetted only in a selection/);
        assert.equal((await carryOut(disk, env, 'arxiv', {}, {})).ok, false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

Sources in a zip: the central directory is read, stored and deflated
members alike, and the paths are those `zipfile` gives.

    // in tests of the same requests on a disk and on GitHub:
    test('a zip of sources is read as zipfile reads it', async () => {
      const zip = Buffer.from(
        'UEsDBBQAAAAAAAAAIVwAAAAAAAAAAAAAAAAEAAAAc3JjL1BLAwQUAAAACAAAACFc4oDrxBAAAAAOAAAADQAAAHNyYy9wYXBlci50ZXiL' +
        'SclPLs1NzStJzkksLgYAUEsDBBQAAAAAAAAAIVx/jaU3BQAAAAUAAAANAAAAc3JjL2ZpZy9hLnR4dGZpZ3VyUEsBAhQDFAAAAAAAAAAh' +
        'XAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAIABAAAAAHNyYy9QSwECFAMUAAAACAAAACFc4oDrxBAAAAAOAAAADQAAAAAAAAAAAAAAgAEi' +
        'AAAAc3JjL3BhcGVyLnRleFBLAQIUAxQAAAAAAAAAIVx/jaU3BQAAAAUAAAANAAAAAAAAAAAAAACAAV0AAABzcmMvZmlnL2EudHh0UEsF' +
        'BgAAAAADAAMAqAAAAI0AAAAAAA==', 'base64');
      const members = await readZip(new Uint8Array(zip));
      assert.deepEqual(members.map((m) => m.name), ['src/', 'src/paper.tex', 'src/fig/a.txt']);
      assert.equal(text(await members[1].read()), '\\documentclass');
      assert.equal(text(await members[2].read()), 'figur');
      assert.equal(await yamlText({ members: [] }), 'members: []\n');
    });

The same requests by the script and by this program
---------------------------------------------------

The template's script runs as the archive's workflow runs it, with
`--request requests/ID/request.json`, opensheaf-py as `osheaf`, in the
archive's folder; this program runs `carryOut` through its command line's
environment (key stores, locations), in `tests/request.js`, on a copy of
the same archive, with the same request. Both use the current key that
`osheaf init` of opensheaf-py kept in the sandbox's file store.

    // in tests/request.js:
    import { readFile, writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import process from 'node:process';
    import { fileURLToPath } from 'node:url';
    import { makeEnvironment } from '../cli/osheaf.js';
    import { DiskStorage } from '../cli/disk.js';
    import { carryOut } from '../core/requests.js';
    import { loadSchemas } from '../core/schema.js';

    const [archive, requestFile, answerFile] = process.argv.slice(2);
    const request = JSON.parse(await readFile(requestFile, 'utf-8'));
    const files = {};
    for (const [label, names] of Object.entries(request.files || {})) {
      files[label] = [];
      for (const name of names) files[label].push({ name, bytes: new Uint8Array(await readFile(path.join(path.dirname(requestFile), name))) });
    }
    const schemas = await loadSchemas(async (url) => JSON.parse(await readFile(fileURLToPath(url), 'utf-8')));
    const env = makeEnvironment(archive);
    const answer = await carryOut(new DiskStorage(archive), env, request.operation, request.fields, files,
                                  { origin: `request ${path.basename(path.dirname(requestFile))}`, schemas });
    await writeFile(answerFile, JSON.stringify(answer, null, 2));

The two copies are compared as in chapter [72](72-tests-parity.md): the
content files and the inventories (their times left out) of every
object, a new work by its label with its name left out; and the files the
script writes outside the storage root, byte for byte: the collections'
files and `osheaf.json`. The commit messages are the same, names left
out.

    // in tests of the same requests by the script and by this program:
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const PY = process.env.OSHEAF_PY || (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, 'osheaf'))
      .find((p) => existsSync(p));
    const ISSUE = process.env.OSHEAF_ISSUE ||
      [path.join(HERE, '..', '..', 'archive-template', '.github', 'scripts', 'osheaf_issue.py')].find((p) => existsSync(p));
    const PYTHON = PY && existsSync(path.join(path.dirname(PY), 'python3')) ? path.join(path.dirname(PY), 'python3') : 'python3';
    const noScript = !PY ? 'opensheaf-py is not installed (set OSHEAF_PY)'
      : !ISSUE ? 'the script of the archive template is not found (set OSHEAF_ISSUE)' : false;

    async function scriptSandbox() {
      const root = await mkdtemp(path.join(os.tmpdir(), 'osheaf-requests-'));
      const env = { PATH: process.env.PATH, HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'xdg'),
                    OPENSHEAF_KEY_STORE: 'file', LANG: 'C.UTF-8', OSHEAF: PY,
                    GITHUB_ACTIONS: '', OPENSHEAF_SIGNING_KEY: '' };
      env.DENO_DIR = process.env.DENO_DIR || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/deno'
        : '.cache/deno');
      await mkdir(env.HOME);
      const run = (command, args, cwd = root) => {
        const r = spawnSync(command[0], [...command.slice(1), ...args], { cwd, env, encoding: 'utf-8' });
        if (r.error) throw r.error;
        return r;
      };
      const isDeno = typeof globalThis.Deno !== 'undefined';
      const node = isDeno ? [process.execPath, 'run', '-A', '--config', path.join(HERE, '..', 'deno.json')] : [process.execPath];
      return { root, run, node, done: () => rm(root, { recursive: true, force: true }) };
    }

    async function writeRequest(dir, operation, fields, files = {}) {
      await mkdir(dir, { recursive: true });
      const names = {};
      for (const [label, list] of Object.entries(files)) {
        names[label] = [];
        for (const { name, bytes } of list) {
          await writeFile(path.join(dir, name), bytes);
          names[label].push(name);
        }
      }
      await writeFile(path.join(dir, 'request.json'), JSON.stringify({ operation, fields, files: names }, null, 2));
      return path.join(dir, 'request.json');
    }

    async function treeOf(root) {
      return diskFiles(root);
    }

    const timeless = (bytes) => text(bytes).replace(/"created": "[^"]*"/g, '"created": "-"');

    function sameFiles(a, b, newNames = []) {
      const mask = (s) => newNames.reduce((t, [x, y]) => t.split(x).join(y), s)
        .replace(/"previous": "[0-9a-f]*"/g, '"previous": "-"').replace(/"inventorySha512": "[0-9a-f]*"/g, '"inventorySha512": "-"');
      const kept = (p) => (p.startsWith('ocfl/') && (p.includes('/content/') || p.endsWith('/inventory.json')) &&
                           !p.endsWith('genesis.json')) || p.startsWith('collections/') || p === 'osheaf.json';
      const A = [...a.keys()].filter(kept).map(mask).sort(), B = [...b.keys()].filter(kept).map(mask).sort();
      assert.deepEqual(B, A);
      const byMask = new Map([...b].map(([p, v]) => [mask(p), v]));
      for (const [p, bytes] of a) {
        if (!kept(p)) continue;
        const other = byMask.get(mask(p));
        if (p.endsWith('/inventory.json') && (text(bytes).includes('"members.json"') || mask(p) !== p)) continue;
        if (/\.(json|yaml)$/.test(p) || newNames.length) assert.equal(mask(timeless(other)), mask(timeless(bytes)), p);
        else assert.deepEqual(other, bytes, p);
      }
    }

    test('the requests carried out by the template\'s script and by this program give the same files', { skip: noScript }, async () => {
      const s = await scriptSandbox();
      try {
        const base = path.join(s.root, 'base');
        const r0 = s.run([PY], ['init', base, '--name', 'Papers of Jane Doe', '--base-url', 'https://example.org/papers/',
                                '--curator', 'Doe, Jane', '--new-owner', '--export', path.join(s.root, 'keys'), '--yes', '--no-passphrase']);
        assert.equal(r0.status, 0, r0.stderr);
        const first = await writeRequest(path.join(s.root, 'req', 'r0'), 'deposit',
          { 'This deposit': NEW_PAPER, Label: 'first', Title: 'A paper', Authors: 'Doe, Jane', Licence: 'CC BY 4.0 (cc-by-4.0)' },
          { 'PDF of this version': [{ name: 'paper.pdf', bytes: PDF(1) }], Sources: [{ name: 'paper.tex', bytes: TEX }] });
        const r1 = s.run([PYTHON, ISSUE], ['--request', first], base);
        assert.equal(r1.status, 0, r1.stdout + r1.stderr + await readFile(path.join(base, 'result.md'), 'utf-8').catch(() => ''));
        await mkdir(path.join(base, 'collections'));
        await writeFile(path.join(base, 'collections', 'reading.yaml'), 'title: Reading\ntype: catalogue\nmembers: []\n');
        for (const name of ['result.md', 'commit.txt', 'title.txt']) await rm(path.join(base, name), { force: true });
        let k = 0;
        for (const [operation, fields, files] of [...REQUESTS, ...REFUSED]) {
          k++;
          const a = path.join(s.root, 'a'), b = path.join(s.root, 'b');
          for (const d of [a, b]) {
            await rm(d, { recursive: true, force: true });
            await cp(base, d, { recursive: true });
          }
          const request = await writeRequest(path.join(s.root, 'req', `r${k}`), operation, fields, files);
          const p = s.run([PYTHON, ISSUE], ['--request', request], a);
          const j = s.run(s.node, [path.join(HERE, 'request.js'), b, request, path.join(s.root, 'answer.json')]);
          assert.equal(j.status, 0, j.stderr);
          const answer = JSON.parse(await readFile(path.join(s.root, 'answer.json'), 'utf-8'));
          const pyResult = await readFile(path.join(a, 'result.md'), 'utf-8');
          assert.equal(answer.ok, p.status === 0, `${operation}: ${pyResult}\n${answer.message}`);
          assert.equal(answer.message.replace(/\n+Correct it.*$/s, ''), pyResult.replace(/\n+Correct it.*$/s, ''), operation);
          if (answer.ok) {
            assert.equal(answer.commitMessage.replace(/sheaf:[a-z2-7]{52}:/g, 'sheaf:NAME:'),
                         (await readFile(path.join(a, 'commit.txt'), 'utf-8')).replace(/sheaf:[a-z2-7]{52}:/g, 'sheaf:NAME:'), operation);
          }
          for (const name of ['result.md', 'commit.txt', 'title.txt']) await rm(path.join(a, name), { force: true });
          const A = await treeOf(a), B = await treeOf(b);
          const disc = async (d) => JSON.parse(await readFile(path.join(d, 'opensheaf.json'), 'utf-8')).objects;
          const newNames = [];
          for (const o of await disc(a)) {
            const other = (await disc(b)).find((x) => x.label === o.label);
            if (other && other.name !== o.name) newNames.push([o.name, `NAME-${o.label}`], [other.name, `NAME-${o.label}`]);
          }
          sameFiles(A, B, newNames);
          await rm(base, { recursive: true, force: true });
          await cp(a, base, { recursive: true });
        }
      } finally {
        await s.done();
      }
    });

The Manager's core
------------------

The popup's hand-off: the answer of the page, sealed with the mode
`popup`, is the vector that the unlock page's tests compute too (fixed
X25519 keys for the Manager and the page, a fixed state, owner, credential
and secret); it opens only with the code of the request, and an answer
sealed for the command line (mode `unlock`), for another state, or an
error, is refused.

    // in tests of the Manager's core:
    const VECTOR = { owner: 'a'.repeat(52), state: 'popup-state-of-the-tests', cred: 'Y3JlZGVudGlhbC1vZi10aGUtdGVzdHM',
                     pk: 'E75P6uryBMf9M1j8nAByGIHRdCeBKCJ-xnTzf3_pe20', epk: 'V9tLNZ8jrl4Ubk4lEgVnBHIlBjSMFQwUdT0Mkz0E1CE',
                     ct: '5G1AcynkQgGMF4zDTK5jAHzpINvJJpVIKW_a172XDTY', tag: 'x9nebDAtOsMhfeqtGvRgbjU2r828_nAI4qzFA4JSt6U',
                     code: '329 875' };

    test('the popup of the Manager: the hand-off of the page, opened with the code of the request', async () => {
      const mine = await keyPairOf(new Uint8Array(32).fill(7)), page = await keyPairOf(new Uint8Array(32).fill(9));
      const secret = new Uint8Array(32).map((_, i) => i);
      const req = await popupRequest(VECTOR.owner, [VECTOR.cred], mine, VECTOR.state);
      assert.equal(req.code, VECTOR.code);
      assert.deepEqual(req.message, { type: 'opensheaf-unlock-request', state: VECTOR.state, pk: VECTOR.pk, owner: VECTOR.owner,
                                      cred: VECTOR.cred });
      const [epk, ct, tag] = await seal(secret, mine.publicKey, VECTOR.state, 'popup', VECTOR.owner, VECTOR.cred, page);
      assert.deepEqual([b64url(epk), b64url(ct), b64url(tag)], [VECTOR.epk, VECTOR.ct, VECTOR.tag]);
      const answer = { type: 'opensheaf-unlock-answer', state: VECTOR.state, epk: VECTOR.epk, ct: VECTOR.ct, tag: VECTOR.tag,
                       cred: VECTOR.cred };
      assert.deepEqual(await openPopupAnswer(req, answer, '329875'), [VECTOR.cred, secret]);
      await assert.rejects(openPopupAnswer(req, answer, '329 876'), /the code typed is not the code/);
      await assert.rejects(openPopupAnswer(req, { ...answer, state: 'another-state-of-the-tests' }, '329875'), /not the answer/);
      await assert.rejects(openPopupAnswer(req, { type: 'opensheaf-unlock-answer', state: VECTOR.state, error: 'no' }, '329875'),
                           /the page says: no/);
      const [e2, c2, t2] = await seal(secret, mine.publicKey, VECTOR.state, 'unlock', VECTOR.owner, VECTOR.cred, page);
      await assert.rejects(openPopupAnswer(req, { ...answer, epk: b64url(e2), ct: b64url(c2), tag: b64url(t2) }, '329875'),
                           /damaged answer/);
      await assert.rejects(popupRequest(VECTOR.owner, []), UnlockFailed);
      assert.equal(popupUrl('https://opensheaf.org'), 'https://unlock.opensheaf.org/#mode=popup&origin=https%3A%2F%2Fopensheaf.org');
    });

The keys of a wallet opened by a passkey's secret: the locks found are
those of the current keys the key log lists, with the passkeys of this
owner; the key opened signs as the key it is, and its seed is gone.

    // in tests of the Manager's core:
    test('keys of a wallet opened by the secret of a passkey, kept unexportable', async () => {
      const env = requestEnvironment();
      const m = new MemoryStorage();
      await init(m, env, { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                           newOwner: true, export: '/keys', yes: true, cost: { opslimit: 1, memlimit: 8192 } }, '/archive');
      const { owner, dids, threshold } = await signers(m, browserEnvironment({ assets: { templates: {} } }));
      assert.equal(threshold, 1);
      const [key] = await env.keyStore.current(owner, dids);
      const prf = new Uint8Array(32).fill(5), cred = 'Y3JlZGVudGlhbC1vZi10aGUtdGVzdHM';
      const passkey = new Passkey(cred, await passkeySalt(owner), { kek: await passkeyKek(prf) });
      const text = await keyFileText(key, owner, 'current', null, 'correct horse', { passkeys: [passkey], cost: { opslimit: 1, memlimit: 8192 } });
      const wallet = { entries: async () => [[owner, key.id], [owner, 'aaaaaaaaaaaaaaaa']],
                       read: async (o, kid) => (kid === key.id ? text : null) };
      const locks = await walletLocks(wallet, owner, dids);
      assert.deepEqual(locks.map((l) => [l.did, l.creds]), [[key.did, [cred]]]);
      const [opened] = await openLocks(locks, owner, cred, prf);
      assert.equal(opened.did, key.did);
      assert.equal(opened.seed, null);
      assert.equal(opened.signing.extractable, false);
      assert.deepEqual(await opened.sign(utf8('a message')), await key.sign(utf8('a message')));
      await assert.rejects(openLocks(locks, owner, cred, new Uint8Array(32).fill(6)));
    });

A request written directly: an archive made in memory is pushed to the
double's repository; the Manager's environment holds the owner's current
key, read from the text `osheaf key export` gives; a notice is one
commit, read through the prefetch, with what the commands said; a
request refused commits nothing.

    // in tests of the Manager's core:
    test('a request written directly: one commit, signed in the page', async () => {
      const env = requestEnvironment();
      const m = new MemoryStorage();
      await init(m, env, { name: 'Papers of Jane Doe', baseUrl: 'https://example.org/papers/', curator: 'Doe, Jane',
                           newOwner: true, export: '/keys', yes: true, cost: { opslimit: 1, memlimit: 8192 } }, '/archive');
      const r1 = await carryOut(m, env, 'deposit', { 'This deposit': NEW_PAPER, Label: 'first', Title: 'A paper',
                                                      Authors: 'Doe, Jane', Licence: 'CC BY 4.0 (cc-by-4.0)' },
                                { 'PDF of this version': [{ name: 'paper.pdf', bytes: PDF(1) }], Sources: [{ name: 'paper.tex', bytes: TEX }] },
                                { schemas });
      assert.ok(r1.ok, r1.message);
      const g = fakeGitHub();
      g.create(REPO, Object.fromEntries(m.files));
      const owner = JSON.parse(text(await m.read('osheaf.json'))).owner;
      const [key] = [...env.keyStore ? await env.keyStore.current(owner, (await signers(m, env)).dids) : []];
      const given = await keyFromText(await keyText(key, owner, 'current'));
      assert.equal(given.owner, owner);
      const seed = btoa(String.fromCharCode(...key.seed));
      assert.equal((await keyFromText(seed + '\n', { owner })).key.did, key.did);
      await assert.rejects(keyFromText(seed), /give the owner/);
      const assets = { schemas: Object.fromEntries(await Promise.all((await readdir(new URL('../schemas/', import.meta.url)))
        .map(async (n) => [n, JSON.parse(await readFile(new URL(`../schemas/${n}`, import.meta.url), 'utf-8'))]))),
                       templates: {} };
      const benv = browserEnvironment({ assets, keys: new Map([[owner, [given.key]]]),
                                        fetch: async (url) => { throw new TypeError(`no network in the tests: ${url}`); } });
      const phases = [];
      const done = await directWrite({ repo: REPO, github: client(g), operation: 'notice', env: benv, schemas: await schemasOf(assets),
                                       fields: { Label: 'first', 'Document version it is about': '1', 'Text of the notice': 'A typo.' },
                                       progress: (p) => phases.push(p) });
      assert.ok(done.ok, done.message);
      assert.deepEqual(phases, ['reading', 'carrying out', 'committing']);
      assert.equal(g.head(REPO), done.commit.sha);
      assert.match(g.objects.get(done.commit.sha).message, /^Notice about first, version 1 \(the OpenSheaf manager\)\n\nfirst: v2 /);
      const files = [...g.files(REPO).keys()];
      assert.ok(done.reads.api <= files.length && done.reads.cache > done.reads.api, JSON.stringify(done.reads));
      assert.ok(prefetched('ocfl/x/y/v1/content/object.json') && !prefetched('ocfl/x/y/v1/content/paper.pdf'));
      const head = g.head(REPO);
      const refused = await directWrite({ repo: REPO, github: client(g), operation: 'withdraw', env: benv, schemas: await schemasOf(assets),
                                          fields: { Label: 'nothing', 'Reason for the withdrawal': 'x' } });
      assert.equal(refused.ok, false);
      assert.equal(refused.commit, null);
      assert.equal(g.head(REPO), head);
      const unsigned = await directWrite({ repo: REPO, github: client(g), operation: 'notice', schemas: await schemasOf(assets),
                                           env: browserEnvironment({ assets }), fields: { Label: 'first',
                                           'Document version it is about': '1', 'Text of the notice': 'Again.' } });
      assert.equal(unsigned.ok, false);
      assert.match(unsigned.message, /holds 0 of the current keys/);
    });
