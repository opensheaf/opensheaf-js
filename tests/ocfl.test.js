// Generated from literate/77-tests-ocfl.md by opensheaf-literate: edit the document, not this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm, cp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DiskStorage } from '../cli/disk.js';
import { validateObject, validateStorageRoot, pyJson, pyRepr, PyFloat, InventoryValidator, ValidationLog } from '../core/ocfl.js';
import { LIMITS } from '../core/http.js';

const FIXTURES = fileURLToPath(new URL('./ocfl-fixtures/1.1/', import.meta.url));
const OTHERWISE = {
  E010_missing_versions: ['E046'],
  E011_E013_invalid_padded_head_version: ['E011'],
  E015_content_not_in_content_dir: ['E042'],
  E019_inconsistent_content_dir: ['E020'],
  E040_wrong_version_in_version_dir: ['E066'],
  E100_E099_fixity_invalid_content_paths: ['E057'],
};

function listedCodes(name) {
  return name.split('_').filter((w) => /^[EW]\d{3}$/.test(w));
}

function codesOf(entries) {
  return new Set(entries.map((e) => e.code.slice(0, 4)));
}

async function fixtures(kind) {
  return (await readdir(path.join(FIXTURES, kind))).sort();
}

test('the valid objects of the OCFL fixtures are valid, without errors or warnings', async () => {
  const s = new DiskStorage(FIXTURES);
  for (const name of await fixtures('good-objects')) {
    const { valid, log } = await validateObject(s, `good-objects/${name}`, { logWarnings: true });
    assert.ok(valid, `${name}: ${log.statusStr()}`);
    assert.deepEqual([...log.errors, ...log.warnings], [], name);
  }
});

test('the bad objects of the OCFL fixtures are invalid, with the errors they list', async () => {
  const s = new DiskStorage(FIXTURES);
  const names = await fixtures('bad-objects');
  assert.equal(names.length, 55);
  for (const name of names) {
    const { valid, log } = await validateObject(s, `bad-objects/${name}`);
    assert.equal(valid, false, name);
    const found = codesOf(log.errors);
    for (const code of OTHERWISE[name] ?? listedCodes(name)) assert.ok(found.has(code), `${name}: ${code} not in\n${log.statusStr()}`);
  }
});

test('the warn objects of the OCFL fixtures are valid, with the warnings they list', async () => {
  const s = new DiskStorage(FIXTURES);
  for (const name of await fixtures('warn-objects')) {
    const { valid, log } = await validateObject(s, `warn-objects/${name}`, { logWarnings: true });
    assert.ok(valid, `${name}: ${log.statusStr()}`);
    assert.deepEqual(log.errors, [], name);
    const found = codesOf(log.warnings);
    for (const code of listedCodes(name)) assert.ok(found.has(code), `${name}: ${code} not in\n${log.statusStr()}`);
  }
});

test('a content file changed is found, and its digests are left out on request', async () => {
  const box = await mkdtemp(path.join(os.tmpdir(), 'osheaf-ocfl-'));
  try {
    await cp(path.join(FIXTURES, 'good-objects', 'spec-ex-full'), path.join(box, 'o'), { recursive: true });
    const file = path.join(box, 'o', 'v1', 'content', 'foo', 'bar.xml');
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.from('x')]));
    const s = new DiskStorage(box);
    const { valid, log } = await validateObject(s, 'o');
    assert.equal(valid, false);
    assert.match(log.statusStr(), /^\[E092a\] OCFL Object root inventory manifest using digest algorithm sha512 has digest [0-9a-f]{128} for file v1\/content\/foo\/bar.xml which doesn't match calculated digest [0-9a-f]{128} for that file \(see https:\/\/ocfl.io\/1.1\/spec\/#E092\)$/m);
    assert.ok((await validateObject(s, 'o', { checkDigests: false })).valid);
  } finally {
    await rm(box, { recursive: true, force: true });
  }
});

async function storageRoot(box, name, breakIt = async () => {}) {
  const root = path.join(box, name);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, '0=ocfl_1.1'), 'ocfl_1.1\n');
  await cp(path.join(FIXTURES, 'good-objects', 'minimal_one_version_one_file'), path.join(root, 'a'), { recursive: true });
  await cp(path.join(FIXTURES, 'good-objects', 'spec-ex-full'), path.join(root, 'b1', 'b2', 'b'), { recursive: true });
  await breakIt(root);
  return name;
}

const ROOTS = {
  'a valid storage root': [null, async () => {}],
  'a layout of OCFL with its configuration': [null, async (r) => {
    await writeFile(path.join(r, 'ocfl_layout.json'), '{"extension": "0003-hash-and-id-n-tuple-storage-layout", "description": "x"}');
    await mkdir(path.join(r, 'extensions', '0003-hash-and-id-n-tuple-storage-layout'), { recursive: true });
    await writeFile(path.join(r, 'extensions', '0003-hash-and-id-n-tuple-storage-layout', 'config.json'),
                    '{"extensionName": "0003-hash-and-id-n-tuple-storage-layout", "digestAlgorithm": "sha256", "tupleSize": 3, "numberOfTuples": 3}');
  }],
  'no declaration': ['E069a', async (r) => rm(path.join(r, '0=ocfl_1.1'))],
  'two declarations': ['E069b', async (r) => writeFile(path.join(r, '0=ocfl_1.0'), 'ocfl_1.0\n')],
  'a declaration of another version': ['E069c', async (r) => {
    await rm(path.join(r, '0=ocfl_1.1'));
    await writeFile(path.join(r, '0=ocfl_2.0'), 'ocfl_2.0\n');
  }],
  'a declaration of the wrong text': ['E069e', async (r) => writeFile(path.join(r, '0=ocfl_1.1'), 'ocfl_1.0\n')],
  'a layout file that is not JSON': ['E070a', async (r) => writeFile(path.join(r, 'ocfl_layout.json'), '{"extension": ')],
  'a layout file that is not an object': ['E070b', async (r) => writeFile(path.join(r, 'ocfl_layout.json'), '[]')],
  'a layout file without a description': ['E070c', async (r) => writeFile(path.join(r, 'ocfl_layout.json'), '{"extension": "0002"}')],
  'an unknown layout': ['E071', async (r) => writeFile(path.join(r, 'ocfl_layout.json'), '{"extension": "x", "description": "y"}')],
  'a configuration of the layout refused': ['E904', async (r) => {
    await writeFile(path.join(r, 'ocfl_layout.json'), '{"extension": "0003-hash-and-id-n-tuple-storage-layout", "description": "x"}');
    await mkdir(path.join(r, 'extensions', '0003-hash-and-id-n-tuple-storage-layout'), { recursive: true });
    await writeFile(path.join(r, 'extensions', '0003-hash-and-id-n-tuple-storage-layout', 'config.json'),
                    '{"extensionName": "0003-hash-and-id-n-tuple-storage-layout", "digestAlgorithm": "sha256", "tupleSize": 40, "numberOfTuples": 3}');
  }],
  'a file in the extensions folder': ['E086', async (r) => {
    await mkdir(path.join(r, 'extensions'));
    await writeFile(path.join(r, 'extensions', 'stray'), 'x');
  }],
  'an extension folder not registered': ['W901', async (r) => mkdir(path.join(r, 'extensions', 'mine', 'x'), { recursive: true })],
  'an empty folder': ['E073', async (r) => mkdir(path.join(r, 'c', 'd'), { recursive: true })],
  'a file between the root and an object': ['E072', async (r) => writeFile(path.join(r, 'b1', 'stray.txt'), 'x')],
  'two declarations of an object': ['E003d', async (r) => writeFile(path.join(r, 'a', '0=ocfl_object_1.0'), 'ocfl_object_1.0\n')],
  'a declaration of an unknown version': ['E004a', async (r) => {
    await mkdir(path.join(r, 'e'));
    await writeFile(path.join(r, 'e', '0=ocfl_object_2.0'), 'ocfl_object_2.0\n');
  }],
  'an unrecognised declaration': ['E004b', async (r) => {
    await mkdir(path.join(r, 'e'));
    await writeFile(path.join(r, 'e', '0=something'), 'something\n');
  }],
};

test('storage roots, valid and broken', async () => {
  const box = await mkdtemp(path.join(os.tmpdir(), 'osheaf-ocfl-'));
  try {
    const s = new DiskStorage(box);
    for (const [what, [code, breakIt]] of Object.entries(ROOTS)) {
      const name = await storageRoot(box, what.replace(/ /g, '-'), breakIt);
      const { valid, log, objects } = await validateStorageRoot(s, name, { logWarnings: true });
      if (!code || code.startsWith('W')) {
        assert.ok(valid, `${what}: ${log.statusStr()}`);
        assert.deepEqual(objects.map((o) => [o.path, o.valid]).sort(), [['a', true], ['b1/b2/b', true]], what);
      } else {
        assert.equal(valid, false, what);
      }
      assert.deepEqual([...log.errors, ...log.warnings].map((e) => e.code.slice(0, code?.length ?? 4)), code ? [code] : [], `${what}: ${log.statusStr()}`);
    }
  } finally {
    await rm(box, { recursive: true, force: true });
  }
});

test('JSON is read, and refused, in the words of Python', () => {
  const refused = (text) => {
    try {
      pyJson(text);
    } catch (error) {
      return error.message;
    }
    return null;
  };
  assert.equal(refused(''), 'Expecting value: line 1 column 1 (char 0)');
  assert.equal(refused('{"a":1,}'), 'Illegal trailing comma before end of object: line 1 column 7 (char 6)');
  assert.equal(refused('[1,]'), 'Illegal trailing comma before end of array: line 1 column 3 (char 2)');
  assert.equal(refused('{"a" 1}'), "Expecting ':' delimiter: line 1 column 6 (char 5)");
  assert.equal(refused('[1 2]'), "Expecting ',' delimiter: line 1 column 4 (char 3)");
  assert.equal(refused('{a:1}'), 'Expecting property name enclosed in double quotes: line 1 column 2 (char 1)');
  assert.equal(refused('"abc'), 'Unterminated string starting at: line 1 column 1 (char 0)');
  assert.equal(refused('"a\\qb"'), 'Invalid \\escape: line 1 column 3 (char 2)');
  assert.equal(refused('"a\\u12G4"'), 'Invalid \\uXXXX escape: line 1 column 4 (char 3)');
  assert.equal(refused('"a\tb"'), 'Invalid control character at: line 1 column 3 (char 2)');
  assert.equal(refused('{"a":1} x'), 'Extra data: line 1 column 9 (char 8)');
  assert.equal(refused('﻿{}'), 'Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)');
  assert.equal(refused('{"\u{1F600}": x}'), 'Expecting value: line 1 column 7 (char 6)');
  assert.equal(refused('\n\n  {"a": [1, 2,\n ]}'), 'Illegal trailing comma before end of array: line 3 column 14 (char 15)');
  assert.equal(pyRepr(pyJson('[NaN, 1.5e300, 1e-7, 2, 1.0, 12345678901234567890123, true, null, "it\'s", {"a": -Infinity}]')),
               '[nan, 1.5e+300, 1e-07, 2, 1.0, 12345678901234567890123, True, None, "it\'s", {\'a\': -inf}]');
  assert.ok(pyJson('2.0') instanceof PyFloat);
});

test('the dates of versions, read as ocfl-py reads them', () => {
  const said = (created) => {
    const log = new ValidationLog();
    new InventoryValidator({ log, where: 'root' }).validate(pyJson(JSON.stringify({
      id: 'urn:x', type: 'https://ocfl.io/1.1/spec/#inventory', digestAlgorithm: 'sha512', head: 'v1',
      manifest: { ['a'.repeat(128)]: ['v1/content/f'] },
      versions: { v1: { created, state: { ['a'.repeat(128)]: ['f'] }, message: 'm', user: { name: 'n', address: 'mailto:n@x' } } } })));
    return log.errors.map((e) => e.message.replace(/ \(see .*\)$/, '')).join('\n');
  };
  assert.equal(said('2019-01-01T00:00:00.5+01:00'), '');
  assert.equal(said('2019-02-29T00:00:00Z'), '[E049c] OCFL Object root inventory v1 version block has bad created date, must be IS8601 (day is out of range for month: 2019-02-29T00:00:00Z)');
  assert.equal(said('2019-13-01T00:00:00+01:00'), '[E049c] OCFL Object root inventory v1 version block has bad created date, must be IS8601 (month must be in 1..12: 2019-13-01T00:00:00Z)');
  assert.equal(said('2019-01-01T00:00:00+24:00'), '[E049c] OCFL Object root inventory v1 version block has bad created date, must be IS8601 (Bad timezone offset (2019-01-01T00:00:00+24:00))');
  assert.equal(said('2019-01-01 00:00:00Z'), '[E049c] OCFL Object root inventory v1 version block has bad created date, must be IS8601 (Bad datetime format (2019-01-01 00:00:00Z))');
  assert.equal(said('2019-01-01T00:00'), '[E049a] OCFL Object root inventory v1 version block created date SHOULD include a timezone designator\n' +
               '[E049b] OCFL Object root inventory v1 version block created date SHOULD be granular to the seconds level');
});

test('content files are read in pieces, within LIMITS.file', async () => {
  const box = await mkdtemp(path.join(os.tmpdir(), 'osheaf-ocfl-'));
  const limit = LIMITS.file;
  try {
    const o = path.join(box, 'o');
    const big = new Uint8Array(9 * 2 ** 20).map((_, k) => k % 251);
    const digest = Buffer.from(await crypto.subtle.digest('SHA-512', big)).toString('hex');
    const inventory = JSON.stringify({ id: 'urn:big', type: 'https://ocfl.io/1.1/spec/#inventory', digestAlgorithm: 'sha512', head: 'v1',
      manifest: { [digest]: ['v1/content/big'] },
      versions: { v1: { created: '2026-01-01T00:00:00Z', state: { [digest]: ['big'] }, message: 'm', user: { name: 'n', address: 'mailto:n@x' } } } });
    const sidecar = `${Buffer.from(await crypto.subtle.digest('SHA-512', Buffer.from(inventory))).toString('hex')}  inventory.json\n`;
    await mkdir(path.join(o, 'v1', 'content'), { recursive: true });
    await writeFile(path.join(o, '0=ocfl_object_1.1'), 'ocfl_object_1.1\n');
    for (const d of [o, path.join(o, 'v1')]) {
      await writeFile(path.join(d, 'inventory.json'), inventory);
      await writeFile(path.join(d, 'inventory.json.sha512'), sidecar);
    }
    await writeFile(path.join(o, 'v1', 'content', 'big'), big);
    const s = new DiskStorage(box);
    const pieces = [];
    for await (const piece of await s.stream('o/v1/content/big')) pieces.push(piece.length);
    assert.deepEqual(pieces, [4 * 2 ** 20, 4 * 2 ** 20, 2 ** 20]);
    assert.ok((await validateObject(s, 'o')).valid);
    LIMITS.file = 8 * 2 ** 20;
    const { valid, log } = await validateObject(s, 'o');
    assert.equal(valid, false);
    assert.equal(log.statusStr(), `[E901] OCFL Object file v1/content/big is larger than ${8 * 2 ** 20} bytes, the limit of this validator (LIMITS.file): its digests are not checked`);
  } finally {
    LIMITS.file = limit;
    await rm(box, { recursive: true, force: true });
  }
});

function onPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  return null;
}

const OSHEAF = process.env.OSHEAF_PY || onPath('osheaf');
const PYTHON = await (async () => {
  if (!OSHEAF) return null;
  const first = (await readFile(OSHEAF, 'utf-8').catch(() => '')).split('\n')[0];
  return first.startsWith('#!') ? first.slice(2).trim().split(' ')[0] : null;
})();
const noPython = PYTHON ? false : 'opensheaf-py is not installed (set OSHEAF_PY to its osheaf command)';

const OCFL_PY = `
import json, sys
import ocfl
from ocfl.validator import Validator
out = []
for kind, where in json.loads(sys.argv[1]):
    if kind == "object":
        v = Validator(log_warnings=True)
        out.append({"valid": v.validate_object(where), "status": v.status_str()})
    else:
        r = ocfl.StorageRoot(root=where)
        try:
            valid = r.validate(validate_objects=True, log_warnings=True)
            out.append({"valid": valid, "status": r.log.status_str(),
                        "objects": sorted([p, m] for p, m in r.errors)})
        except Exception as e:
            out.append({"crash": type(e).__name__})
print(json.dumps(out))
`;

function ocflPy(cwd, items) {
  const r = spawnSync(PYTHON, ['-I', '-c', OCFL_PY, JSON.stringify(items)], { cwd, encoding: 'utf-8', maxBuffer: 2 ** 26 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function unordered(status) {
  return status.split('\n').map((line) => line.replace(/\(paths (\S*) only in/, (m, p) => `(paths ${p.split(',').sort().join(',')} only in`)).sort().join('\n');
}

test('ocfl-py and this validator say the same of every OCFL fixture', { skip: noPython }, async () => {
  const s = new DiskStorage(FIXTURES);
  const items = [];
  for (const kind of ['good-objects', 'bad-objects', 'warn-objects']) {
    for (const name of await fixtures(kind)) items.push(['object', `${kind}/${name}`]);
  }
  const theirs = ocflPy(FIXTURES, items);
  for (const [k, [, where]] of items.entries()) {
    const { valid, log } = await validateObject(s, where, { logWarnings: true });
    assert.equal(valid, theirs[k].valid, where);
    assert.equal(unordered(log.statusStr()), unordered(theirs[k].status), where);
  }
});

test('ocfl-py and this validator say the same of every storage root', { skip: noPython }, async () => {
  const box = await mkdtemp(path.join(os.tmpdir(), 'osheaf-ocfl-'));
  try {
    const s = new DiskStorage(box);
    const names = [];
    for (const [what, [code, breakIt]] of Object.entries(ROOTS)) {
      if (code !== 'E904') names.push(await storageRoot(box, what.replace(/ /g, '-'), breakIt));
    }
    const theirs = ocflPy(box, names.map((n) => ['root', n]));
    for (const [k, name] of names.entries()) {
      const { valid, log, objects } = await validateStorageRoot(s, name, { logWarnings: true });
      assert.equal(valid, theirs[k].valid, name);
      assert.equal(log.statusStr(), theirs[k].status, name);
      const mine = objects.filter((o) => o.log.statusStr()).map((o) => [o.path, o.log.statusStr(`[[${o.path}]]`)]).sort();
      assert.deepEqual(mine, theirs[k].objects, name);
    }
  } finally {
    await rm(box, { recursive: true, force: true });
  }
});
