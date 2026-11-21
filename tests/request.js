// Generated from literate/76-tests-github.md by opensheaf-literate: edit the document, not this file.
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
