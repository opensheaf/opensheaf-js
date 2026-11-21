A storage over GitHub
=====================

The Manager (phase 6 of chapter [00](00-plan.md)) keeps an archive held
in a GitHub repository from a browser, with no program installed and no
workflow of the repository in between: it reads the archive from the
head of the repository's branch, runs a command of the core on it, signs
in the browser, and writes the result back as **one commit**. This
chapter is the storage it does that through (chapter
[20](20-storage.md)): the six methods of a storage over GitHub's REST
API, with the Git Data API for the commit. The module is
`core/github.js`; like everything in `core/`, it needs only `fetch`,
WebCrypto and `Uint8Array`, and a token given to it.

    // in core/github.js:
    import { base64 } from './keys.js';
    import { hex, utf8 } from './crypto.js';
    import { checkPath, compareText, parentOf, StorageError } from './storage.js';

    <<the API of GitHub>>

    <<blobs and their names>>

    <<the storage of a branch>>

    <<one command, one commit>>

The design
----------

A command reads many small files (inventories, key logs, signature files,
the head versions of the lines for the website) and writes a few dozen:
the files of a new version, built in a staging folder and moved into
place (chapter [23](23-folder.md)), the main catalogue, the discovery
document, the pages of the website. Written file by file, through the
contents API, each would be a commit of its own, and a command stopped
half way would leave an archive half changed. So the storage is an
**overlay**:

- **at opening**, it reads the head of the branch: the reference, its
  commit, and the commit's whole tree (`git/trees/SHA?recursive=1`),
  which names every file with the digest of its content (its blob), its
  mode and its size. That is enough to answer `kind` and `list` for the
  whole archive without another request, and gives the `lister` of a
  complete verification (chapter [14](14-archive.md)) for nothing;
- **reads** fetch a blob by its digest, once: blobs are named by their
  content, so a blob read is valid for ever, and a cache shared between
  storages (the commands of a session, a command run again) never goes
  stale;
- **writes, renames and removals** change only the overlay, in memory: a
  rename of a staging folder is a change of names, its blobs untouched;
- **the commit** compares the overlay with the tree read: the files whose
  content is new are uploaded as blobs, a tree is made on top of the
  tree read with the files changed and those removed, a commit on top of
  the head, and the branch moved to it, **only if it still points to the
  head read** (`force: false`). If someone else pushed meanwhile, GitHub
  refuses the move; the command is then run again on the new head, from
  the start, never merged.

A command stopped before its commit leaves the repository as it was. Two
commands from two pages never mix: the second to commit finds the branch
moved and runs again on the first one's result.

**Reading faster.** Each blob read through the API is a request, and the
website alone reads the head versions of every line: an archive of a
hundred papers means hundreds of reads. Two things help. A **mirror**:
the archive's own site, which GitHub Pages serves from the same branch
with CORS headers, read in parallel from a CDN; what it serves is taken
only if its git digest is the blob's, so that a page served from before
the last push, or altered on the way, is never used, and the blob is
then read through the API. And **prefetch**: the files of the tree below
a size are read in parallel before the command starts, so that the
command, which reads one file after the other, finds them in the cache.

The API of GitHub
-----------------

A request to GitHub's REST API, with the token of the person (a string,
or a function that gives one, so that a page can renew it), and GitHub's
own message when it refuses. `fresh` asks the browser not to answer from
its cache (GitHub's answers may be kept for a minute, and the head of a
branch must be the current one). `raw` takes the body as bytes.

    // in the API of GitHub:
    export const GITHUB_API = 'https://api.github.com';

    export class GitHubError extends Error {
      constructor(message, status = 0) {
        super(message);
        this.status = status;
      }
    }

    export class CommitConflict extends GitHubError {}

    export class GitHub {
      constructor({ api = GITHUB_API, fetch = globalThis.fetch?.bind(globalThis), token = null } = {}) {
        this.api = api.replace(/\/$/, '');
        this.fetch = fetch;
        this.token = token;
      }

      async request(method, path, body = null, { raw = false, fresh = false } = {}) {
        const token = typeof this.token === 'function' ? await this.token() : this.token;
        const headers = { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
                          'X-GitHub-Api-Version': '2022-11-28' };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== null) headers['Content-Type'] = 'application/json';
        let r;
        try {
          r = await this.fetch(`${this.api}/${path}`, { method, headers, body: body === null ? undefined : JSON.stringify(body),
                                                       ...(fresh ? { cache: 'no-store' } : {}) });
        } catch (error) {
          throw new GitHubError(`GitHub API ${path}: ${error.message}`);
        }
        if (r.ok && raw) return new Uint8Array(await r.arrayBuffer());
        const text = await r.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        if (!r.ok) throw new GitHubError(`GitHub API ${path}: ${data?.message || text.slice(0, 200) || r.status}`, r.status);
        return data;
      }
    }

Paths of the repository go into the addresses of the API segment by
segment; a repository is named `owner/name`, as GitHub allows it.

    // in the API of GitHub:
    const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

    export function checkRepository(repo) {
      if (!REPOSITORY.test(repo || '') || /\/\.\.?$/.test(repo)) throw new GitHubError(`not a repository: ${repo}`);
      return repo;
    }

    export function encodePath(path) {
      return path.split('/').map(encodeURIComponent).join('/');
    }

Blobs and their names
---------------------

Git names a blob by the SHA-1 digest of a header, `blob`, a space, the
size in decimal and a zero byte, followed by the content. WebCrypto has
SHA-1; it is used here as git uses it, to name content, and every blob
read is checked against the name it was asked for.

    // in blobs and their names:
    export async function gitBlobSha(bytes) {
      const header = utf8(`blob ${bytes.length}\0`);
      const all = new Uint8Array(header.length + bytes.length);
      all.set(header);
      all.set(bytes, header.length);
      return hex(new Uint8Array(await crypto.subtle.digest('SHA-1', all)));
    }

A few requests at a time: GitHub asks clients not to send many
concurrent requests, and a CDN serves a handful as fast as many.

    // in blobs and their names:
    export async function inTurn(items, work, concurrency = 6) {
      const queue = [...items];
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) await work(queue.shift());
      });
      await Promise.all(workers);
    }

The storage of a branch
-----------------------

A storage opened on a branch of a repository (its default branch if none
is named). `github` is a `GitHub`; `cache` a map of blobs by their
names, which the caller may share; `mirror` the address of a site that
serves the files of the branch at their paths.

    // in the storage of a branch:
    const FILE = '100644', LINK = '120000';

    export class GitHubStorage {
      static async open(repo, github, { branch = null, cache = new Map(), mirror = null } = {}) {
        const s = new GitHubStorage(checkRepository(repo), github, { cache, mirror });
        s.branch = branch || (await github.request('GET', `repos/${repo}`)).default_branch;
        await s.readHead();
        return s;
      }

      constructor(repo, github, { cache = new Map(), mirror = null } = {}) {
        Object.assign(this, { repo, github, cache, mirror: mirror && (mirror.endsWith('/') ? mirror : mirror + '/') });
        this.base = new Map();
        this.files = new Map();
        this.dirs = new Map([['', new Map()]]);
        this.reads = { cache: 0, mirror: 0, api: 0 };
      }

The head: the reference, the commit, and the tree. A tree too large for
one answer comes `truncated`; it is then read folder by folder. Only
blobs are kept: a submodule (`commit`) is not a file of the archive. A
symbolic link is kept with its mode, listed as a link and never read, as
the disk storage does (chapter [40](40-cli.md)).

    // in the storage of a branch:
      async readHead() {
        const r = `repos/${this.repo}/git`;
        const ref = await this.github.request('GET', `${r}/ref/heads/${encodePath(this.branch)}`, null, { fresh: true });
        if (ref?.object?.type !== 'commit') throw new GitHubError(`${this.repo}: the branch ${this.branch} is not a commit`);
        this.head = ref.object.sha;
        this.tree = (await this.github.request('GET', `${r}/commits/${this.head}`)).tree.sha;
        const entries = [];
        const walk = async (sha, prefix) => {
          const t = await this.github.request('GET', `${r}/trees/${sha}${prefix === null ? '?recursive=1' : ''}`);
          if (prefix === null && !t.truncated) {
            entries.push(...t.tree);
            return;
          }
          for (const e of t.tree) {
            const path = prefix ? `${prefix}/${e.path}` : e.path;
            if (e.type === 'tree') await walk(e.sha, path);
            else entries.push({ ...e, path });
          }
        };
        await walk(this.tree, null);
        this.base = new Map();
        for (const e of entries) {
          if (e.type === 'blob') this.base.set(e.path, { sha: e.sha, mode: e.mode, size: e.size ?? null });
        }
        this.files = new Map();
        this.dirs = new Map([['', new Map()]]);
        for (const [path, e] of this.base) this.put(path, { ...e });
      }

The index of folders: for each folder, its entries and their kinds, kept
as files come and go, so that `kind` and `list` need no walk. A folder
exists while it holds something, as in git.

    // in the storage of a branch:
      put(path, entry) {
        this.files.set(path, entry);
        let p = path, kind = entry.mode === LINK ? 'link' : 'file';
        for (;;) {
          const parent = parentOf(p), name = p.slice(parent ? parent.length + 1 : 0);
          const fresh = !this.dirs.has(parent);
          if (fresh) this.dirs.set(parent, new Map());
          this.dirs.get(parent).set(name, kind);
          if (!fresh || parent === '') return;
          p = parent;
          kind = 'dir';
        }
      }

      drop(path) {
        this.files.delete(path);
        let p = path;
        while (p) {
          const parent = parentOf(p), entries = this.dirs.get(parent);
          entries.delete(p.slice(parent ? parent.length + 1 : 0));
          if (entries.size || parent === '') return;
          this.dirs.delete(parent);
          p = parent;
        }
      }

### The six methods

As the storage in memory of chapter [20](20-storage.md) does them,
whose tests these pass too (chapter [76](76-tests-github.md)).

    // in the storage of a branch:
      async read(path) {
        checkPath(path);
        const e = this.files.get(path);
        if (!e || e.mode === LINK) return null;
        if (e.bytes) return e.bytes.slice();
        return (await this.blob(e.sha, path)).slice();
      }

      async write(path, bytes, { exclusive = false } = {}) {
        checkPath(path);
        const old = this.files.get(path);
        if (exclusive && old) throw new StorageError(`${path} exists already`);
        if (this.dirs.has(path)) throw new StorageError(`${path} is a folder`);
        for (let p = parentOf(path); p; p = parentOf(p)) {
          if (this.files.has(p)) throw new StorageError(`${p} is a file`);
        }
        this.put(path, { bytes: Uint8Array.from(bytes), mode: old && old.mode !== LINK ? old.mode : FILE, sha: null });
      }

      async kind(path) {
        checkPath(path, { folder: true });
        if (this.dirs.has(path)) return 'dir';
        const e = this.files.get(path);
        return e ? (e.mode === LINK ? 'link' : 'file') : null;
      }

      async list(path) {
        checkPath(path, { folder: true });
        const entries = this.dirs.get(path);
        if (!entries) return null;
        return [...entries].map(([name, kind]) => ({ name, kind })).sort((a, b) => compareText(a.name, b.name));
      }

      async rename(from, to) {
        checkPath(from);
        checkPath(to);
        const what = await this.kind(from);
        if (!what) throw new StorageError(`no ${from} to move`);
        if (this.dirs.has(to)) throw new StorageError(`${to} exists already`);
        if (what !== 'dir') {
          const e = this.files.get(from);
          this.drop(from);
          if (this.files.has(to)) this.drop(to);
          this.put(to, e);
          return;
        }
        for (const k of [...this.files.keys()]) {
          if (k.startsWith(from + '/')) {
            const e = this.files.get(k);
            this.drop(k);
            this.put(to + k.slice(from.length), e);
          }
        }
      }

      async remove(path) {
        checkPath(path);
        if (this.dirs.has(path)) throw new StorageError(`${path} is a folder that is not empty`);
        if (this.files.has(path)) this.drop(path);
      }

A seventh method, which the other storages do not have: the size of a
file, known from the tree without reading it (`null` if there is no file
there). The search for private keys of a verification (chapter
[28](28-verify-folder.md)) reads only the small files, and with it
leaves the large ones unread.

    // in the storage of a branch:
      async size(path) {
        const e = this.files.get(checkPath(path));
        if (!e || e.mode === LINK) return null;
        return e.bytes ? e.bytes.length : e.size;
      }

### Reading blobs

A blob from the cache, else from the mirror (taken only if its digest is
the blob's), else from the API. Every blob is checked against its name.

    // in the storage of a branch:
      async blob(sha, path = null) {
        const known = this.cache.get(sha);
        if (known) {
          this.reads.cache++;
          return known;
        }
        let bytes = null;
        if (this.mirror && path) {
          try {
            const r = await this.github.fetch(this.mirror + encodePath(path));
            if (r.ok) {
              const got = new Uint8Array(await r.arrayBuffer());
              if ((await gitBlobSha(got)) === sha) bytes = got;
            }
          } catch {
            bytes = null;
          }
          if (bytes) this.reads.mirror++;
        }
        if (!bytes) {
          bytes = await this.github.request('GET', `repos/${this.repo}/git/blobs/${sha}`, null, { raw: true });
          if ((await gitBlobSha(bytes)) !== sha) throw new GitHubError(`${this.repo}: the blob ${sha} read is not ${sha}`);
          this.reads.api++;
        }
        this.cache.set(sha, bytes);
        return bytes;
      }

Prefetch: every file of the head up to `maxSize` bytes (a mebibyte by
default) that the cache lacks, a few at a time; `skip(path, size)` leaves
some out. A blob that cannot be read now is left to the command, which will
say so if it needs it.

    // in the storage of a branch:
      async prefetch({ maxSize = 1 << 20, skip = () => false, concurrency = 6 } = {}) {
        const todo = new Map();
        for (const [path, e] of this.base) {
          if (e.mode === LINK || this.cache.has(e.sha) || todo.has(e.sha)) continue;
          if (e.size !== null && e.size > maxSize) continue;
          if (!skip(path, e.size)) todo.set(e.sha, path);
        }
        await inTurn([...todo], async ([sha, path]) => {
          try {
            await this.blob(sha, path);
          } catch {
            // read again, or reported, when the command needs it
          }
        }, concurrency);
        return todo.size;
      }

### What a command changed

The files whose content or mode differs from the tree read, with their
digests, and the files removed. A file written with the bytes it had is
not a change; a file moved keeps its blob, and is a change of its path
only.

    // in the storage of a branch:
      async changes() {
        const changed = [], removed = [];
        for (const [path, e] of this.files) {
          if (e.bytes && e.sha === null) e.sha = await gitBlobSha(e.bytes);
          const b = this.base.get(path);
          if (!b || b.sha !== e.sha || b.mode !== e.mode) changed.push({ path, ...e });
        }
        for (const [path, b] of this.base) if (!this.files.has(path)) removed.push({ path, ...b });
        const order = (a, b) => compareText(a.path, b.path);
        return { changed: changed.sort(order), removed: removed.sort(order) };
      }

### The commit

The blobs that GitHub does not hold yet (those of the files written,
unless the same content is somewhere in the tree read) are uploaded;
GitHub's name for each must be the one computed here. Then the tree, on
top of the tree read: the files changed with their blobs, the files
removed with no blob (`sha: null`). Then the commit, whose parent is the
head read, and the move of the branch, never forced. GitHub refuses a
move that is not a fast forward with the status 422: the branch has
moved, and the command must be run again (`CommitConflict`).

Nothing changed, nothing is committed: the result is then `null`. After
a commit, the storage stands on it, and may be used for the next command.

    // in the storage of a branch:
      async commit(message, { author = null } = {}) {
        const { changed, removed } = await this.changes();
        if (!changed.length && !removed.length) return null;
        const r = `repos/${this.repo}/git`;
        const held = new Set([...this.base.values()].map((e) => e.sha));
        const upload = new Map();
        for (const e of changed) if (e.bytes && !held.has(e.sha)) upload.set(e.sha, e.bytes);
        await inTurn([...upload], async ([sha, bytes]) => {
          const made = await this.github.request('POST', `${r}/blobs`, { content: base64(bytes), encoding: 'base64' });
          if (made.sha !== sha) throw new GitHubError(`${this.repo}: GitHub named a blob ${made.sha}, not ${sha}`);
        }, 4);
        const tree = await this.github.request('POST', `${r}/trees`, {
          base_tree: this.tree,
          tree: [...changed.map((e) => ({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha })),
                 ...removed.map((e) => ({ path: e.path, mode: e.mode, type: 'blob', sha: null }))],
        });
        const made = await this.github.request('POST', `${r}/commits`, {
          message, tree: tree.sha, parents: [this.head], ...(author ? { author } : {}) });
        try {
          await this.github.request('PATCH', `${r}/refs/heads/${encodePath(this.branch)}`, { sha: made.sha, force: false });
        } catch (error) {
          if (error.status === 422 || error.status === 409) {
            throw new CommitConflict(`${this.repo}: the branch ${this.branch} has moved since ${this.head.slice(0, 7)} was read`, error.status);
          }
          throw error;
        }
        for (const e of changed) if (e.bytes) this.cache.set(e.sha, e.bytes);
        this.head = made.sha;
        this.tree = tree.sha;
        this.base = new Map([...this.files].map(([path, e]) => [path, { sha: e.sha, mode: e.mode, size: e.bytes?.length ?? e.size }]));
        for (const e of this.files.values()) {
          if (e.bytes) {
            e.size = e.bytes.length;
            delete e.bytes;
          }
        }
        return { sha: made.sha, url: made.html_url ?? null, changed: changed.length, removed: removed.length };
      }
    }

One command, one commit
-----------------------

A command run on a fresh storage of the branch and committed; if the
branch moved meanwhile, run again from the start on the new head, up to
`attempts` times. `run(storage)` gives the message of the commit (or
`null` for nothing to commit) and anything else it wants returned. The
cache of blobs is shared by the attempts.

    // in one command, one commit:
    export async function oneCommit(repo, github, run, { branch = null, cache = new Map(), mirror = null, attempts = 3,
                                                         prepare = null } = {}) {
      for (let k = 1; ; k++) {
        const storage = await GitHubStorage.open(repo, github, { branch, cache, mirror });
        if (prepare) await prepare(storage);
        const { message, ...rest } = await run(storage);
        if (message === null || message === undefined) return { ...rest, commit: null, storage };
        try {
          return { ...rest, commit: await storage.commit(message), storage, attempts: k };
        } catch (error) {
          if (!(error instanceof CommitConflict) || k >= attempts) throw error;
        }
      }
    }
