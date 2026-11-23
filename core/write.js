// Generated from literate/22-writing.md by opensheaf-literate: edit the document, not this file.
import { sha256, sha512bytes, hex, utf8 } from './crypto.js';
import { GENESIS_FORMAT, KINDS, NONCE, CREATED, OWNER_NAME, keyRulesOfRecord, keeperValid, nameOf } from './names.js';
import { KeyLog, INVENTORY_TYPE } from './owners.js';
import { message, fileName, SIGNATURE_FORMAT, WITNESSES } from './signatures.js';
import { compareText, joinPath, StorageError } from './storage.js';
import { base64, randomBytes } from './keys.js';

export function jsonText(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

export function jsonBytes(value) {
  return utf8(jsonText(value));
}

export function utcNow() {
  return new Date().toISOString().replace(/\.[0-9]{3}Z$/, 'Z');
}

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newNonce() {
  return hex(randomBytes(16));
}

export async function genesisRecord(kind, { originator = null, keys = null, threshold = null, next = null,
                                            nextThreshold = null, keeper = null, extensions = null,
                                            created = null, nonce = null } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown kind '${kind}'`);
  nonce = nonce || newNonce();
  created = created || utcNow();
  if (!NONCE.test(nonce) || !CREATED.test(created)) {
    throw new Error('a nonce of at least 128 bits in hexadecimal, and a date in UTC, are needed');
  }
  const rec = { format: GENESIS_FORMAT, kind, created };
  if (kind === 'owner') {
    if (originator !== null) throw new Error('an owner is its own originator: its genesis record names none');
    Object.assign(rec, { nonce, keys: [...(keys || [])], threshold, next: [...(next || [])], nextThreshold });
    const problems = await keyRulesOfRecord(rec);
    if (problems.length) throw new Error(problems.join('; '));
    if (keeper !== null) {
      rec.keeper = typeof keeper === 'string' ? [keeper] : [...keeper];
      if (rec.keeper.length !== 1 || !keeperValid(rec.keeper[0])) {
        throw new Error(`a keeper is one ORCID iD or https://<domain>/: '${keeper}'`);
      }
    }
    if (extensions) rec.extensions = extensions;
  } else {
    if (typeof originator !== 'string' || !OWNER_NAME.test(originator)) {
      throw new Error(`the originator must be an owner name: '${originator}'`);
    }
    if ([keys, threshold, next, nextThreshold, keeper, extensions].some((v) => v !== null)) {
      throw new Error('keys, thresholds, keeper and extensions are only for an owner');
    }
    Object.assign(rec, { originator, nonce });
  }
  return jsonBytes(rec);
}

function place(contentPath) {
  const k = contentPath.indexOf('/');
  const ver = k < 0 ? contentPath : contentPath.slice(0, k);
  const rest = k < 0 ? '' : contentPath.slice(k + 1);
  return [/^[0-9]+$/.test(ver.slice(1)) ? Number(ver.slice(1)) : 0, rest];
}

function comparePlace(a, b) {
  return a[0] - b[0] || compareText(a[1], b[1]);
}

function smallest(list, compare) {
  return list.reduce((best, x) => (compare(x, best) < 0 ? x : best));
}

const sortedKeys = (o) => Object.keys(o).sort(compareText);

function orderedVersion(e) {
  const out = {};
  for (const k of ['created', 'state', 'message', 'user']) if (k in e) out[k] = e[k];
  out.state = Object.fromEntries(Object.entries(e.state)
    .map(([d, paths]) => [d, paths, smallest(paths, compareText)])
    .sort((x, y) => compareText(x[2], y[2])).map(([d, paths]) => [d, paths]));
  for (const k of sortedKeys(e)) if (!(k in out)) out[k] = e[k];
  return out;
}

export function orderedInventory(inv) {
  const out = {};
  for (const k of sortedKeys(inv)) out[k] = inv[k];
  out.manifest = Object.fromEntries(Object.entries(inv.manifest)
    .map(([d, paths]) => [d, paths, place(smallest(paths, (a, b) => comparePlace(place(a), place(b))))])
    .sort((x, y) => comparePlace(x[2], y[2])).map(([d, paths]) => [d, paths]));
  out.versions = {};
  for (const k of Object.keys(inv.versions).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    out.versions[k] = orderedVersion(inv.versions[k]);
  }
  return out;
}

export function inventoryFile(inv) {
  return jsonBytes(inv);
}

export async function sha512hex(bytes) {
  return hex(await sha512bytes(bytes));
}

export async function sidecar(inventoryBytes) {
  return utf8(`${await sha512hex(inventoryBytes)}  inventory.json\n`);
}

export async function sha256hex(bytes) {
  return hex(await sha256(bytes));
}

export async function md5hex(bytes) {
  const hashWasm = await import('hash-wasm');
  return hashWasm.md5(bytes);
}

export async function signatureFile(key, objectId, version, inventory, signer, keyLog) {
  const signature = await key.sign(message(objectId, version, inventory, keyLog));
  return jsonBytes({ format: SIGNATURE_FORMAT, object: objectId, version, inventorySha512: inventory,
                     signer, key: key.did, keyLog, signature: base64(signature) });
}

export { fileName as signatureFileName, WITNESSES };

export async function newOwner(current, rotation, { threshold = 1, nextThreshold = null, keeper = null,
                                                    extensions = null, created = null, nonce = null } = {}) {
  const genesis = await genesisRecord('owner', {
    keys: current.map((k) => (typeof k === 'string' ? k : k.did)), threshold,
    next: rotation.map((k) => (typeof k === 'string' ? k : k.digest)),
    nextThreshold: nextThreshold || Math.floor(rotation.length / 2) + 1,
    keeper, extensions, created, nonce,
  });
  const log = await KeyLog.of(genesis);
  await log.check();
  return log;
}

export async function writeKeyLog(storage, dir, log) {
  const namaste = joinPath(dir, '0=ocfl_object_1.1');
  if ((await storage.kind(namaste)) !== 'file') await storage.write(namaste, utf8('ocfl_object_1.1\n'));
  let held = 0;
  const root = await storage.read(joinPath(dir, 'inventory.json'));
  if (root) held = Number(JSON.parse(new TextDecoder().decode(root)).head.slice(1));
  for (const v of log.versions.slice(0, held)) {
    const bytes = await storage.read(joinPath(dir, `v${v.number}`, 'inventory.json'));
    if (!bytes || bytes.length !== v.inventory.length || bytes.some((b, k) => b !== v.inventory[k])) {
      throw new StorageError(`${dir}: v${v.number} differs from that of the key log of ${log.owner}`);
    }
  }
  for (const v of log.versions.slice(held)) {
    const inv = JSON.parse(new TextDecoder().decode(v.inventory));
    const byDigest = new Map();
    for (const bytes of v.files.values()) byDigest.set(await sha512hex(bytes), bytes);
    for (const [d, paths] of Object.entries(inv.manifest)) {
      for (const cp of paths) {
        if (cp.startsWith(`v${v.number}/`)) await storage.write(joinPath(dir, cp), byDigest.get(d));
      }
    }
    await storage.write(joinPath(dir, `v${v.number}`, 'inventory.json'), v.inventory);
    await storage.write(joinPath(dir, `v${v.number}`, 'inventory.json.sha512'),
                        v.sidecar?.length ? v.sidecar : await sidecar(v.inventory));
  }
  for (const v of log.versions) {
    for (const [name, bytes] of v.witnesses || []) {
      const path = joinPath(dir, WITNESSES, `v${v.number}`, name);
      if (!(await storage.kind(path))) await storage.write(path, bytes, { exclusive: true });
    }
  }
  if (log.versions.length > held) {
    const head = log.versions[log.versions.length - 1];
    await storage.write(joinPath(dir, 'inventory.json.tmp'), head.inventory);
    await storage.rename(joinPath(dir, 'inventory.json.tmp'), joinPath(dir, 'inventory.json'));
    await storage.write(joinPath(dir, 'inventory.json.sha512'),
                        head.sidecar?.length ? head.sidecar : await sidecar(head.inventory));
  }
}

export { nameOf, INVENTORY_TYPE };
