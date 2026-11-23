// Generated from literate/40-cli.md by opensheaf-literate: edit the document, not this file.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkPath, compareText, StorageError } from '../core/storage.js';

const MISSING = ['ENOENT', 'ENOTDIR'];

export class DiskStorage {
  constructor(root) {
    this.root = path.resolve(root);
  }

  full(p) {
    checkPath(p, { folder: true });
    return p ? path.join(this.root, ...p.split('/')) : this.root;
  }

  async linked(p, { last = true } = {}) {
    const parts = p ? p.split('/') : [];
    if (!last) parts.pop();
    let f = this.root;
    for (const part of parts) {
      f = path.join(f, part);
      try {
        if ((await fs.lstat(f)).isSymbolicLink()) return true;
      } catch (error) {
        if (MISSING.includes(error.code)) return false;
        throw error;
      }
    }
    return false;
  }

  async unlinked(p, options) {
    if (await this.linked(p, options)) throw new StorageError(`${p} passes through a symbolic link`);
    return this.full(p);
  }

  async read(p) {
    const f = this.full(checkPath(p));
    try {
      if (await this.linked(p)) return null;
      const st = await fs.lstat(f);
      if (!st.isFile()) return null;
      return new Uint8Array(await fs.readFile(f));
    } catch (error) {
      if (MISSING.includes(error.code)) return null;
      throw error;
    }
  }

  async write(p, bytes, { exclusive = false } = {}) {
    const f = await this.unlinked(checkPath(p));
    await fs.mkdir(path.dirname(f), { recursive: true });
    try {
      await fs.writeFile(f, bytes, { flag: exclusive ? 'wx' : 'w' });
    } catch (error) {
      if (error.code === 'EEXIST') throw new StorageError(`${p} exists already`);
      throw error;
    }
  }

  async kind(p) {
    try {
      const st = await fs.lstat(this.full(p));
      return st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file';
    } catch (error) {
      if (MISSING.includes(error.code)) return null;
      throw error;
    }
  }

  async list(p) {
    let entries;
    try {
      entries = await fs.readdir(this.full(p), { withFileTypes: true });
    } catch (error) {
      if (MISSING.includes(error.code)) return null;
      throw error;
    }
    return entries.map((e) => ({ name: e.name, kind: e.isSymbolicLink() ? 'link' : e.isDirectory() ? 'dir' : 'file' }))
      .sort((a, b) => compareText(a.name, b.name));
  }

  async rename(from, to) {
    const target = await this.unlinked(checkPath(to));
    const source = await this.unlinked(checkPath(from));
    if ((await this.kind(to)) === 'dir') throw new StorageError(`${to} exists already`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
  }

  async remove(p) {
    const f = await this.unlinked(checkPath(p), { last: false });
    if ((await this.kind(p)) === 'dir') await fs.rmdir(f);
    else await fs.unlink(f);
  }
}
