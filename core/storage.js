// Generated from literate/20-storage.md by opensheaf-literate: edit the document, not this file.
import { utf8 } from './crypto.js';

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

export function compareText(a, b) {
  const x = [...a], y = [...b];
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const d = x[k].codePointAt(0) - y[k].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
}

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
