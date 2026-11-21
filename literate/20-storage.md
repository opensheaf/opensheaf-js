Storage: an archive as files
============================

An OpenSheaf archive is a folder of plain files (section 3). The tools
read and write it in three places: a folder on a disk, for the command
line; a repository on GitHub, written through its API, for the Manager in
a browser (chapter [47](47-github-storage.md)); and memory, for the tests. The chapters that
keep an archive (from chapter [22](22-writing.md) on) never touch a disk
or a network themselves: they go through a **storage**, a small object
with six methods, and the same code then keeps an archive wherever it is.

The module is `core/storage.js`. Like everything in `core/`, it uses only
what browsers, Deno and Node all have: no `Deno.*`, no `node:` modules.
The disk storage of the command line is in `cli/disk.js` (chapter
[40](40-cli.md)).

    // in core/storage.js:
    import { utf8 } from './crypto.js';

    <<paths in a storage>>

    <<a storage in memory>>

    <<reading JSON and text from a storage>>

    <<reading a storage over fetch>>

The interface
-------------

A storage holds files under paths relative to the archive folder,
written with `/` whatever the system: `ocfl/0=ocfl_1.1`,
`opensheaf.json`. Its methods, all asynchronous:

- `read(path)`: the bytes of the file (`Uint8Array`), or `null` if there is
  no file there;
- `write(path, bytes, { exclusive })`: write the file, making the folders
  above it; with `exclusive`, fail if the file exists (genesis records and
  signature files are never replaced, as in opensheaf-py);
- `kind(path)`: `'file'`, `'dir'`, or `null` if there is nothing there
  (the empty path is the archive folder itself);
- `list(path)`: the entries of a folder, `[{ name, kind }]` sorted by name,
  or `null` if there is no folder; a symbolic link on a disk is listed with
  the kind `'link'`, so that walks can leave it out, as opensheaf-py does;
- `rename(from, to)`: move a file or a folder; an existing *file* at `to`
  is replaced (as `os.replace` does), an existing folder is an error;
- `remove(path)`: remove a file, or an empty folder.

That is all an archive needs: versions are added by building them in a
staging folder and moving them into place (chapter [22](22-writing.md)),
which a disk does atomically and which GitHub will do in one commit.

Paths are checked before any of these methods is called, so that no name
read from an archive can lead a storage out of its folder: a path is
relative, its segments are not empty, `.` or `..`, and hold no backslash
and no control character. The empty path names the archive folder, and is
allowed only where a folder is meant.

    // in paths in a storage:
    export class StorageError extends Error {}

    export function checkPath(path, { folder = false } = {}) {
      if (typeof path !== 'string') throw new StorageError(`not a path: ${String(path)}`);
      if (path === '' && folder) return path;
      if (path === '' || path.startsWith('/')) throw new StorageError(`not a relative path: ${JSON.stringify(path)}`);
      for (const segment of path.split('/')) {
        if (segment === '' || segment === '.' || segment === '..' || /[\u0000-\u001f\u007f\\]/.test(segment)) {
          throw new StorageError(`an unsafe path: ${JSON.stringify(path)}`);
        }
      }
      return path;
    }

    export function joinPath(...parts) {
      return parts.filter((p) => p !== '' && p !== null && p !== undefined).join('/');
    }

    export function parentOf(path) {
      const k = path.lastIndexOf('/');
      return k < 0 ? '' : path.slice(0, k);
    }

A storage in memory
-------------------

The tests, and later the browser, keep an archive in memory: a map from
paths to bytes. Folders are not stored; a folder exists when a file is
below it, so an empty folder vanishes, which no archive relies on.

    // in a storage in memory:
    export class MemoryStorage {
      constructor() {
        this.files = new Map();
      }

      async read(path) {
        checkPath(path);
        const bytes = this.files.get(path);
        return bytes ? bytes.slice() : null;
      }

      async write(path, bytes, { exclusive = false } = {}) {
        checkPath(path);
        if (exclusive && this.files.has(path)) throw new StorageError(`${path} exists already`);
        if ((await this.kind(path)) === 'dir') throw new StorageError(`${path} is a folder`);
        for (let p = parentOf(path); p; p = parentOf(p)) {
          if (this.files.has(p)) throw new StorageError(`${p} is a file`);
        }
        this.files.set(path, Uint8Array.from(bytes));
      }

      async kind(path) {
        checkPath(path, { folder: true });
        if (path === '') return 'dir';
        if (this.files.has(path)) return 'file';
        const prefix = path + '/';
        for (const k of this.files.keys()) if (k.startsWith(prefix)) return 'dir';
        return null;
      }

      async list(path) {
        checkPath(path, { folder: true });
        if ((await this.kind(path)) !== 'dir') return null;
        const prefix = path ? path + '/' : '';
        const found = new Map();
        for (const k of this.files.keys()) {
          if (!k.startsWith(prefix)) continue;
          const rest = k.slice(prefix.length);
          const slash = rest.indexOf('/');
          found.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? 'file' : 'dir');
        }
        return [...found].map(([name, kind]) => ({ name, kind })).sort((a, b) => compareText(a.name, b.name));
      }

      async rename(from, to) {
        checkPath(from);
        checkPath(to);
        const what = await this.kind(from);
        if (!what) throw new StorageError(`no ${from} to move`);
        if ((await this.kind(to)) === 'dir') throw new StorageError(`${to} exists already`);
        if (what === 'file') {
          this.files.set(to, this.files.get(from));
          this.files.delete(from);
          return;
        }
        for (const k of [...this.files.keys()]) {
          if (k.startsWith(from + '/')) {
            this.files.set(to + k.slice(from.length), this.files.get(k));
            this.files.delete(k);
          }
        }
      }

      async remove(path) {
        checkPath(path);
        const what = await this.kind(path);
        if (what === 'dir') throw new StorageError(`${path} is a folder that is not empty`);
        this.files.delete(path);
      }
    }

Names are sorted as Python sorts strings, by code points, not as
JavaScript's default `sort` does, by UTF-16 code units: the two differ
only for characters beyond the Basic Multilingual Plane, but where
opensheaf-py writes files in an order (inventories, indexes), the order
must be the same for the same bytes to come out.

    // in a storage in memory:
    export function compareText(a, b) {
      const x = [...a], y = [...b];
      for (let k = 0; k < Math.min(x.length, y.length); k++) {
        const d = x[k].codePointAt(0) - y[k].codePointAt(0);
        if (d) return d;
      }
      return x.length - y.length;
    }

Reading JSON and text
---------------------

The files the tools read back are their own (`osheaf.json`, inventories,
`object.json`), or files they check anyway; a file that is not JSON is
an error the caller reports. A missing file is `null`.

    // in reading JSON and text from a storage:
    export const decoder = new TextDecoder('utf-8', { fatal: true });

    export async function readText(storage, path) {
      const bytes = await storage.read(path);
      return bytes === null ? null : decoder.decode(bytes);
    }

    export async function readJson(storage, path) {
      const text = await readText(storage, path);
      if (text === null) return null;
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new StorageError(`${path}: not JSON (${error.message})`);
      }
    }

    export async function writeText(storage, path, text, options) {
      return storage.write(path, utf8(text), options);
    }

Reading a storage over fetch
----------------------------

The reading of archives, verification included, comes from the
Explorer (chapters [10](10-http.md) to [17](17-verify.md)), which reads
everything over HTTP with `fetch`. Rather than writing that reading a
second time for files, a storage is given a `fetch` of its own: a
function with the signature of `fetch` that answers the addresses under
`origin` from the storage, with the status 404 for a missing file, and
passes every other address to `fallback` (the real `fetch`, when
members of other archives are to be resolved), or fails as a network
does. The origin is the base URL of the archive, from `osheaf.json`, so
that the addresses the archive gives itself (the `at` of the members of
its main catalogue) are read from the storage too.

The answers are `Response` objects, which browsers, Deno and Node all
have. A path that is not safe, or that names a folder, is not found.

    // in reading a storage over fetch:
    export const ORIGIN = 'https://archive.invalid/';

    export function storageFetch(storage, origin = ORIGIN, { fallback = null } = {}) {
      const base = new URL(origin);
      return async (url, init = {}) => {
        const u = new URL(url);
        if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) {
          if (fallback) return fallback(url, init);
          throw new TypeError(`fetch failed: ${url} is not in this archive`);
        }
        let bytes = null;
        try {
          bytes = await storage.read(checkPath(decodeURIComponent(u.pathname.slice(base.pathname.length))));
        } catch {
          bytes = null;
        }
        if (bytes === null) return new Response('not found', { status: 404 });
        const headers = { 'content-length': String(bytes.length) };
        return new Response(init.method === 'HEAD' ? null : bytes, { status: 200, headers });
      };
    }

A storage can also be listed, which a web server cannot: `storageLister`
gives the `lister` of an archive read over the storage's own `fetch`
(chapter [14](14-archive.md)), the entries of the folder at an address
under `origin`, an empty list when there is no such folder, and `null`
for an address elsewhere, which it cannot list.

    // in reading a storage over fetch:
    export function storageLister(storage, origin = ORIGIN) {
      const base = new URL(origin);
      return async (url) => {
        const u = new URL(url);
        if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) return null;
        try {
          const path = decodeURIComponent(u.pathname.slice(base.pathname.length)).replace(/\/$/, '');
          return (await storage.list(checkPath(path, { folder: true }))) || [];
        } catch {
          return [];
        }
      };
    }
