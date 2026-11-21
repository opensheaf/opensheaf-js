// Generated from literate/49-manager.md by opensheaf-literate: edit the document, not this file.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (dir) => Object.fromEntries(await Promise.all((await readdir(path.join(ROOT, dir))).sort()
  .map(async (n) => [n, await readFile(path.join(ROOT, dir, n), 'utf-8')])));
const schemas = Object.fromEntries(Object.entries(await read('schemas')).map(([n, t]) => [n, JSON.parse(t)]));
const templates = await read('templates');
await mkdir(path.join(ROOT, 'dist'), { recursive: true });
const entry = path.join(ROOT, 'dist', 'manager-entry.js');
await writeFile(entry, "export * from '../web/manager.js';\n" +
                `export const ASSETS = ${JSON.stringify({ schemas, templates })};\n`);
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf-8' }).stdout.trim();
const commit = git('rev-parse', 'HEAD') + (git('status', '--porcelain') ? ' (with changes)' : '');
const out = process.argv[2] || path.join(ROOT, 'dist', 'opensheaf-manager.js');
const r = spawnSync('deno', ['bundle', '--platform', 'browser', '--config', path.join(ROOT, 'deno.json'), '-o', out, entry],
                    { cwd: ROOT, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
const bundled = await readFile(out, 'utf-8');
await writeFile(out, `// opensheaf-js ${commit}: web/manager.js bundled by tools/bundle.js (GPL-3.0-or-later)\n${bundled}`);
console.log(`${out}: opensheaf-js ${commit}`);
