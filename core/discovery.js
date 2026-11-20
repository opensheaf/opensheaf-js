// Generated from literate/25-discovery.md by opensheaf-literate: edit the document, not this file.
import { readGenesis } from './names.js';
import { sidecarDigest } from './owners.js';
import { readJson, compareText, joinPath } from './storage.js';
import { jsonBytes } from './write.js';
import { OBJ, GENESIS, SPEC } from './folder.js';

export async function lineStatus(f, id, dir, inv, head) {
  if (head?.kind === 'owner') return 'active';
  const signed = await f.latestSigned(id);
  const obj = signed ? await f.readObjectJson(dir, inv, OBJ, signed) : head;
  return obj?.status ?? 'active';
}

export const INDEXES = { names: 2, owners: 2, sha512: 2 };
export const INDEX_FORMAT = 'opensheaf-index/0.2';
export const INDEX_KEY = { names: 'name', owners: 'owner', sha512: 'inventorySha512' };

export async function discovery(f) {
  const objs = [], drafts = [], used = new Set();
  for (const { id, dir, inv } of await f.objects()) {
    if (!inv || typeof id !== 'string') continue;
    const head = (await f.readObjectJson(dir, inv, OBJ)) || {};
    for (const k of Object.keys(head.extensions || {})) used.add(k);
    if (id.startsWith('sheaf:draft:')) {
      drafts.push({ id, kind: head.kind ?? null, head: inv.head });
      continue;
    }
    if (head.kind === 'owner') {
      try {
        const log = await f.keyLog(id.split(':')[2]);
        for (const k of Object.keys((log && log.extensions()) || {})) used.add(k);
      } catch {
        // a key log that cannot be read declares nothing
      }
    }
    const entry = { id, kind: head.kind ?? null, name: head.name ?? null, owner: head.owner ?? null,
                    head: inv.head,
                    inventorySha512: sidecarDigest(await f.storage.read(joinPath(dir, 'inventory.json.sha512'))),
                    status: await lineStatus(f, id, dir, inv, head) };
    const label = f.labelOf(id);
    if (label) entry.label = label;
    objs.push(entry);
  }
  const a = f.archive;
  const doc = { format: 'opensheaf-archive/0.2', specification: SPEC, name: a.name, contact: a.contact,
                storageRoot: 'ocfl/', storageLayout: f.layout };
  if (f.labels.has(a.mainCollection)) doc.mainCollection = f.labels.get(a.mainCollection);
  Object.assign(doc, { profiles: a.profiles, extensions: [...used].sort(compareText), owners: f.archiveOwners(),
                       indexes: { ...INDEXES }, objects: objs });
  if (drafts.length) doc.drafts = drafts;
  if (f.tombstones.length) doc.tombstones = f.tombstones;
  return doc;
}

export async function indexEntries(f) {
  const out = { names: [], owners: [], sha512: [] };
  const lines = new Map();
  for (const { id, dir, inv } of await f.objects()) {
    if (!inv || typeof id !== 'string' || id.startsWith('sheaf:draft:')) continue;
    const head = (await f.readObjectJson(dir, inv, OBJ)) || {};
    const genesis = await f.readLogical(dir, inv, GENESIS);
    if (!genesis || id.split(':').length !== 3) continue;
    let rec;
    try {
      rec = await readGenesis(genesis);
    } catch {
      continue;
    }
    const [, name, owner] = id.split(':');
    const status = await lineStatus(f, id, dir, inv, head);
    const entry = { name, owner, id, status, originator: rec.kind === 'owner' ? owner : (rec.originator ?? null),
                    genesis: new TextDecoder().decode(genesis) };
    const label = f.labelOf(id);
    if (label) entry.label = label;
    out.names.push(entry);
    if (!lines.has(owner)) lines.set(owner, []);
    lines.get(owner).push(name);
    for (let n = 1; n <= Number(inv.head.slice(1)); n++) {
      const sc = await f.storage.read(joinPath(dir, `v${n}`, 'inventory.json.sha512'));
      if (sc) out.sha512.push({ inventorySha512: sidecarDigest(sc), id, version: `v${n}`, status });
    }
    if (head.kind === 'owner') {
      let log = null;
      try {
        log = await f.keyLog(owner);
      } catch {
        continue;
      }
      for (const v of log?.versions || []) {
        for (const c of v.forkRecord ? v.carried : []) {
          out.sha512.push({ inventorySha512: c.digest, id, version: `v${c.number}`, status: 'active' });
        }
      }
    }
  }
  out.owners = [...lines.keys()].sort(compareText).map((o) => ({ owner: o, names: lines.get(o).sort(compareText) }));
  out.names.push(...await removedEntries(f, 'names'));
  out.sha512.push(...await removedEntries(f, 'sha512'));
  return out;
}

export async function readIndex(f, index) {
  const out = [];
  for (const entry of (await f.storage.list(index)) || []) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    try {
      const data = await readJson(f.storage, `${index}/${entry.name}`);
      out.push(...(Array.isArray(data?.entries) ? data.entries : []));
    } catch {
      // a file that is not JSON gives no entries
    }
  }
  return out;
}

export async function removedEntries(f, index) {
  const gone = new Map(f.tombstones.map((t) => [t.id, t]));
  const kept = (await readIndex(f, index)).filter((e) => gone.has(e.id)).map((e) => ({ ...e, status: 'removed' }));
  for (const t of gone.values()) {
    if (index === 'names' && !kept.some((e) => e.id === t.id)) {
      kept.push({ name: t.name, owner: t.owner, id: t.id, status: 'removed' });
    }
    if (index === 'sha512' && !kept.some((e) => e.id === t.id && e.version === t.lastVersion)) {
      kept.push({ inventorySha512: t.inventorySha512, id: t.id, version: t.lastVersion, status: 'removed' });
    }
  }
  return kept;
}

export function indexFiles(entries) {
  const out = {};
  for (const [index, list] of Object.entries(entries)) {
    const files = (out[index] = {});
    const key = INDEX_KEY[index];
    const number = (e) => Number((e.version ?? 'v0').slice(1));
    const sorted = [...list].sort((a, b) => compareText(a[key], b[key]) || compareText(a.id ?? '', b.id ?? '') ||
                                            number(a) - number(b));
    for (const e of sorted) {
      const p = e[key].slice(0, INDEXES[index]);
      (files[p] ||= { format: INDEX_FORMAT, index, entries: [] }).entries.push(e);
    }
  }
  return out;
}

export async function writeIndexes(f) {
  const files = indexFiles(await indexEntries(f));
  for (const index of Object.keys(INDEXES)) {
    const want = files[index] || {};
    for (const entry of (await f.storage.list(index)) || []) {
      if (entry.kind === 'file' && entry.name.endsWith('.json') && !Object.hasOwn(want, entry.name.slice(0, -5))) {
        await f.storage.remove(`${index}/${entry.name}`);
      }
    }
    for (const [prefix, data] of Object.entries(want)) await f.storage.write(`${index}/${prefix}.json`, jsonBytes(data));
  }
}

export async function writeDiscovery(f) {
  await writeIndexes(f);
  await f.storage.write('opensheaf.json', jsonBytes(await discovery(f)));
}
