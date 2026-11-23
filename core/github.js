// Generated from literate/47-github-storage.md by opensheaf-literate: edit the document, not this file.
import { base64 } from './keys.js';
import { hex, utf8 } from './crypto.js';
import { checkPath, compareText, parentOf, StorageError } from './storage.js';

export const GITHUB_API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export class CommitConflict extends GitHubError {}

export class RateLimited extends GitHubError {}

const MAX_WAIT = 60_000, TRIES = 3;

function rateLimitWait(r, now) {
  const after = r.headers.get('retry-after'), reset = r.headers.get('x-ratelimit-reset');
  if (r.status !== 429 && !(r.status === 403 && (after !== null || r.headers.get('x-ratelimit-remaining') === '0'))) return null;
  if (after !== null && /^\d+$/.test(after.trim())) return Number(after) * 1000;
  if (reset !== null && /^\d+$/.test(reset.trim())) return Math.max(0, Number(reset) * 1000 - now) + 1000;
  return MAX_WAIT;
}

export class GitHub {
  constructor({ api = GITHUB_API, fetch = globalThis.fetch?.bind(globalThis), token = null,
                sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() } = {}) {
    this.api = api.replace(/\/$/, '');
    this.fetch = fetch;
    this.token = token;
    this.sleep = sleep;
    this.now = now;
  }

  async request(method, path, body = null, options = {}) {
    for (let tries = 1; ; tries++) {
      const r = await this.once(method, path, body, options);
      const wait = rateLimitWait(r, this.now());
      if (wait === null) return this.answer(r, path, options);
      if (wait > MAX_WAIT || tries >= TRIES) {
        const when = new Date(this.now() + wait).toISOString().slice(0, 19) + 'Z';
        throw new RateLimited(`GitHub API ${path}: rate limit reached; try again after ${when}`, r.status);
      }
      await r.body?.cancel();
      await this.sleep(wait);
    }
  }

  async once(method, path, body, { raw = false, fresh = false }) {
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
    return r;
  }

  async answer(r, path, { raw = false }) {
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

const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

export function checkRepository(repo) {
  if (!REPOSITORY.test(repo || '') || /\/\.\.?$/.test(repo)) throw new GitHubError(`not a repository: ${repo}`);
  return repo;
}

export function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export async function gitBlobSha(bytes) {
  const header = utf8(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-1', all)));
}

export async function inTurn(items, work, concurrency = 6) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await work(queue.shift());
  });
  await Promise.all(workers);
}

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

  async readHead() {
    const r = `repos/${this.repo}/git`;
    const ref = await this.github.request('GET', `${r}/ref/heads/${encodePath(this.branch)}`, null, { fresh: true });
    if (ref?.object?.type !== 'commit') throw new GitHubError(`${this.repo}: the branch ${this.branch} is not a commit`);
    this.head = ref.object.sha;
    this.tree = (await this.github.request('GET', `${r}/commits/${this.head}`)).tree.sha;
    const entries = [];
    const under = (prefix, e) => ({ ...e, path: prefix ? `${prefix}/${e.path}` : e.path });
    const walk = async (sha, prefix) => {
      const whole = await this.github.request('GET', `${r}/trees/${sha}?recursive=1`);
      if (!whole.truncated) {
        for (const e of whole.tree) entries.push(under(prefix, e));
        return;
      }
      const t = await this.github.request('GET', `${r}/trees/${sha}`);
      if (t.truncated) throw new GitHubError(`${this.repo}: the folder ${prefix || '/'} is too large for GitHub's API`);
      for (const e of t.tree) {
        if (e.type === 'tree') await walk(e.sha, under(prefix, e).path);
        else entries.push(under(prefix, e));
      }
    };
    await walk(this.tree, '');
    this.base = new Map();
    for (const e of entries) {
      if (e.type === 'blob') this.base.set(e.path, { sha: e.sha, mode: e.mode, size: e.size ?? null });
    }
    this.files = new Map();
    this.dirs = new Map([['', new Map()]]);
    for (const [path, e] of this.base) this.put(path, { ...e });
  }

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

  async size(path) {
    const e = this.files.get(checkPath(path));
    if (!e || e.mode === LINK) return null;
    return e.bytes ? e.bytes.length : e.size;
  }

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

  async prefetch({ maxSize = 1 << 20, skip = () => false, concurrency = 6 } = {}) {
    const todo = new Map();
    for (const [path, e] of this.base) {
      if (e.mode === LINK || this.cache.has(e.sha) || todo.has(e.sha)) continue;
      if (e.size !== null && e.size > maxSize) continue;
      if (!skip(path, e.size)) todo.set(e.sha, path);
    }
    let limited = null;
    await inTurn([...todo], async ([sha, path]) => {
      if (limited) return;
      try {
        await this.blob(sha, path);
      } catch (error) {
        if (error instanceof RateLimited) limited = error;
        // otherwise read again, or reported, when the command needs it
      }
    }, concurrency);
    if (limited) throw limited;
    return todo.size;
  }

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
