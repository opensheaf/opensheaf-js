The discovery document and the indexes
=======================================

After every change of the storage root, the discovery document
`opensheaf.json` (section 12.2) and the three indexes `names/`, `owners/`
and `sha512/` (section 12.5) are written again from the storage root, as
opensheaf-py's `write_discovery` writes them (its chapter
[16-index](https://opensheaf.org/opensheaf-py/16-index.html)): the same
entries, in the same order, with the same bytes. The website that
opensheaf-py writes next to them (the profile `website`, appendix A.3)
comes in a later phase; an archive whose configuration asks for one is
told to run `osheaf index` of opensheaf-py (chapter [40](40-cli.md)).

The module is `core/discovery.js`.

    // in core/discovery.js:
    import { readGenesis } from './names.js';
    import { sidecarDigest } from './owners.js';
    import { readJson, compareText, joinPath } from './storage.js';
    import { jsonBytes } from './write.js';
    import { OBJ, GENESIS, SPEC } from './folder.js';

    <<the status of a line>>

    <<the discovery document>>

    <<the entries of the indexes>>

    <<writing the discovery document and the indexes>>

The status of a line
--------------------

The status a line is listed with (section 13.1) is that of its latest
signed version, or else of its head; a key log is always active.

    // in the status of a line:
    export async function lineStatus(f, id, dir, inv, head) {
      if (head?.kind === 'owner') return 'active';
      const signed = await f.latestSigned(id);
      const obj = signed ? await f.readObjectJson(dir, inv, OBJ, signed) : head;
      return obj?.status ?? 'active';
    }

The discovery document
----------------------

One entry per object of the storage root, drafts apart: its identifier,
kind, name, owner, head, the digest of its root inventory (from the
checksum file), its status, and its label in the archive if it has one.
The extensions declared are those named by the heads of objects and by
the key logs in force; the owners, the archive's own first, each with its
owner catalogue (section 8.1), in the order in which the index presents
them. The first drafts of 0.2 had `mainCollection`, the one catalogue of
the archive, which `owners`, naming each owner with its catalogue, has
replaced (#72); an owner whose catalogue is not made yet (between its key
log and its catalogue, when it is set up) is left out of `owners` until
it is.

    // in the discovery document:
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
      const hosted = f.archiveOwners().filter((o) => f.catalogues.has(o))
        .map((o) => ({ owner: o, catalogue: f.catalogues.get(o) }));
      Object.assign(doc, { profiles: a.profiles, extensions: [...used].sort(compareText), owners: hosted,
                           indexes: { ...INDEXES }, objects: objs });
      if (drafts.length) doc.drafts = drafts;
      if (f.tombstones.length) doc.tombstones = f.tombstones;
      return doc;
    }

The entries of the indexes
--------------------------

The index `names` has an entry per line: its name, owner and identifier,
its status, its originator (an owner is its own) and its genesis record as
text, and its label. `owners` lists the names of the lines of each owner;
`sha512`, every version of every line by the digest of its inventory, and
the versions a fork record carries. The lines taken down keep their
entries, with the status `removed` (section 13.3).

    // in the entries of the indexes:
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

The entries go into files by the first characters of their keys
(`INDEXES` gives how many, section 12.5), sorted by key, identifier and
version number.

    // in the entries of the indexes:
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

Writing them
------------

The files of each index replace those of its folder: a file no entry
needs any more is removed. The discovery document is written last, with
its pages of objects when it has many (below).

    // in writing the discovery document and the indexes:
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
      let doc = await discovery(f);
      const pages = objectPages(doc.objects);
      const stale = ((await f.storage.list(OBJECT_PAGES)) || [])
        .filter((e) => e.kind === 'file' && e.name.endsWith('.json') && !Object.hasOwn(pages, `${OBJECT_PAGES}/${e.name}`));
      for (const e of stale) await f.storage.remove(`${OBJECT_PAGES}/${e.name}`);
      if ((await f.storage.kind(OBJECT_PAGES)) === 'dir' && !((await f.storage.list(OBJECT_PAGES)) || []).length) {
        await f.storage.remove(OBJECT_PAGES);
      }
      if (Object.keys(pages).length) {
        for (const [path, entries] of Object.entries(pages)) {
          await f.storage.write(path, jsonBytes({ format: 'opensheaf-objects/0.2', objects: entries }));
        }
        doc = Object.fromEntries(Object.entries(doc).map(([k, v]) => (k === 'objects' ? ['objectPages', Object.keys(pages)] : [k, v])));
      }
      await f.storage.write('opensheaf.json', jsonBytes(doc));
    }

Pages
-----

An archive with many objects lists them in pages (section 3.1): in place
of `objects`, `objectPages` lists the paths of page files, each with
`format` `"opensheaf-objects/0.2"` and its entries. As opensheaf-py, this
program pages beyond `OBJECTS_PER_PAGE` objects, a thousand, as the
specification advises, in `objects/<p>.json`, `<p>` being the shortest
prefix of the names that keeps every page within a thousand entries, as
far as the names allow: names are digests, so objects spread evenly.
Pages no longer written are removed. The pages are read back through the
reader of an archive (`loadPages`, chapter [14](14-archive.md)), when the
archive kept is opened (chapter [23](23-folder.md)) and when it is
verified.

    // in writing the discovery document and the indexes:
    export const OBJECT_PAGES = 'objects';
    export const PAGING = { perPage: 1000 };

    export function objectPages(objs) {
      if (objs.length <= PAGING.perPage) return {};
      let groups;
      for (let k = 1; k < 53; k++) {
        groups = new Map();
        for (const o of objs) {
          const p = o.name.slice(0, k);
          if (!groups.has(p)) groups.set(p, []);
          groups.get(p).push(o);
        }
        if (Math.max(...[...groups.values()].map((g) => g.length)) <= PAGING.perPage) break;
      }
      return Object.fromEntries([...groups.keys()].sort(compareText).map((p) => [`${OBJECT_PAGES}/${p}.json`, groups.get(p)]));
    }

What reads the entries of a discovery document without the reader of an
archive (the requests of chapter [48](48-requests.md), the members of
other archives in the website, chapter [31](31-website.md)) reads them
with `listedObjects`, as opensheaf-py's `listed_objects`: the entries of
`objects`, or those of every page `objectPages` names, `read(path)`
giving the bytes of a page or `null`. A page that is missing, is not
JSON, is not a page, or whose path is not one below the discovery
document is an error, with the message of opensheaf-py.

    // in writing the discovery document and the indexes:
    export function pagePathOk(path) {
      return typeof path === 'string' && path.endsWith('.json') && !path.startsWith('/') && !path.includes('\\') &&
        !path.split('/')[0].includes(':') && path.split('/').every((x) => x !== '' && x !== '.' && x !== '..');
    }

    export async function listedObjects(disc, read) {
      const entries = (list) => (Array.isArray(list) ? list : []).filter((o) => o && typeof o === 'object' && !Array.isArray(o));
      if (!Object.hasOwn(disc, 'objectPages')) return entries(disc.objects);
      const out = [];
      for (const path of Array.isArray(disc.objectPages) ? disc.objectPages : []) {
        if (!pagePathOk(path)) {
          throw new Error(`${JSON.stringify(path)} is not the path of a page below the discovery document (section 3.1)`);
        }
        const data = await read(path);
        if (data === null || data === undefined) throw new Error(`the page of objects ${path} is missing (section 3.1)`);
        let page;
        try {
          page = JSON.parse(new TextDecoder().decode(data));
        } catch {
          throw new Error(`the page of objects ${path} is not JSON`);
        }
        if (!page || typeof page !== 'object' || !Array.isArray(page.objects)) {
          throw new Error(`${path} is not a page of objects (section 3.1)`);
        }
        out.push(...entries(page.objects));
      }
      return out;
    }
