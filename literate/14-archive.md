An archive read over HTTP
=========================

> This chapter is chapter 14 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/14-archive.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


An archive is found by its *base URL*, the folder holding its discovery
document `opensheaf.json` (section 3). The discovery document names the
storage root (`storageRoot`, relative to the base URL or absolute) and
its layout (`storageLayout`, section 3.2), from which the path of every
object is computed (chapter [11](11-paths.md)): the object
`sheaf:<name>:<owner>` is at `<storageRoot><owner>/<name>/` in the
owner-name layout, at a hashed path in the other, and its version `<v>`
in the folder `<v>/` of the object. Every object has an inventory at its
root (the head) and a copy of the inventory as of each version in that
version's folder, with a checksum file next to each (section 4.1); its
witnesses, signature files among them, are in its extension folder
`extensions/opensheaf-witnesses/<v>/` (section 7.2). Those are all the
addresses the explorer needs.

This chapter gives the class `Archive`, which reads an archive through
these addresses, as `Source` does in opensheaf-py's chapter
[20-resolution](https://opensheaf.org/opensheaf-py/20-resolution.html):
the discovery document, inventories, the files of a version by their
logical paths, pins, histories, key logs (chapter [07](07-owners.md)) and
the signature files of lines, with their statuses (chapter
[08](08-signatures.md)). Every address is built under the storage root by
the functions of chapter [11](11-paths.md), and every answer goes through
the HTTP client of chapter [10](10-http.md), which keeps it for the
session.

The module is `core/archive.js`.

    // in core/archive.js:
    import { FetchError, parseJson, sha512, LIMITS } from './http.js';
    import { isObjectId, isVersion, under, underPath, contentPathProblem, pathOf, OWNER_NAME_LAYOUT,
             HASHED_LAYOUT } from './paths.js';
    import { contentPath, historyOf, currentVersion, versionsOf, filesOf } from './versions.js';
    import { objectId, parseId, isObject } from './names.js';
    import { KeyLog, Version, sidecarDigest, jsonOrNull } from './owners.js';
    import { fileName, lineStatusesOf, latestSigned, judgeFolder, lineStatuses, WITNESSES, UNCHECKED } from './signatures.js';
    import { sameBytes } from './crypto.js';

The base URL
------------

A reader may give the base URL with or without its final slash, or the
address of a file in that folder: `opensheaf.json` itself, or a page of
the archive's website such as `index.html`. All mean the folder. A last
segment with an extension (a dot followed by a few letters or digits) is
taken as a file and dropped; one without is taken as a folder whose
final slash was left out. (A folder whose name has such an extension must
be given with its final slash.) A relative address is resolved against
the page (so that `../` names the folder above the explorer, see
[the application](https://opensheaf.org/explorer/source/30-app.html)).

    // in core/archive.js:
    export function baseOf(url, relativeTo = globalThis.location?.href) {
      const u = new URL(url, relativeTo);
      u.hash = '';
      u.search = '';
      let s = u.href;
      if (/\/[^/]*\.[A-Za-z0-9]{1,8}$/.test(u.pathname)) s = s.slice(0, s.lastIndexOf('/') + 1);
      return s.endsWith('/') ? s : s + '/';
    }

An address typed by a reader often lacks its scheme: `mgubi.org/papers/`,
or `localhost:8000/papers/` for an archive served on the reader's own
computer. Such an address is completed with `http:` for the reader's own
computer (`localhost`, `127.0.0.1`, `[::1]`), where archives are served
without TLS, and with `https:` otherwise. A host with a port
(`localhost:8000`) looks like a scheme to the URL parser, which would
read `localhost:8000/x` as the scheme `localhost:`; it is recognised
first. An address with a scheme (`https://`, or any `name://`) is left as
it is, and so is one that does not start with a host (a relative address
such as `../`).

    // in core/archive.js:
    export function withScheme(given) {
      const s = String(given).trim();
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
      const host = /^(\[[0-9a-f:.]+\]|[a-z0-9][a-z0-9.-]*)(:\d+)?(\/|$)/i.exec(s);
      if (!host || !(host[2] || host[1].includes('.') || host[1].toLowerCase() === 'localhost')) return s;
      const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host[1]);
      return (local ? 'http://' : 'https://') + s;
    }

The archive
-----------

Opening an archive reads its discovery document, which is kept parsed,
and computes the paths of the objects it lists (in the hashed layout a
path needs a SHA-256 digest, which WebCrypto computes asynchronously;
once computed, every address of the object is built synchronously). The
discovery document is a map, not a witness (section 3.1): what it says is
used to find files, and checked by the verification.

An archive of version 0.1 of the specification (`specification` `0.1`,
or an `archiveId`, which 0.1 had and 0.2 dropped) is not read: version
0.2 is incompatible with it, and its archives are rebuilt (section 16.1).
The explorer opens it only to say so (`old`). An unknown
`storageLayout` is read as the owner-name layout, and reported by the
verification.

    // in core/archive.js:
    export class Archive {
      static async open(http, url, options = {}) {
        const base = baseOf(url);
        const where = base + 'opensheaf.json';
        const disc = parseJson(await http.cached(where, options), where);
        if (!isObject(disc)) throw new FetchError('json', where, 'is not a JSON object');
        const archive = new Archive(http, base, disc);
        if (!archive.old && Object.hasOwn(disc, 'objectPages')) await archive.loadPages(options);
        if (!archive.old) {
          const ids = [...archive.objects().map((o) => o.id), ...archive.drafts().map((d) => d.id),
                       ...archive.tombstones().map((t) => t.id).filter(isObjectId)];
          await Promise.all(ids.map((id) => archive.locate(id).catch(() => null)));
        }
        return archive;
      }

      constructor(http, base, disc) {
        this.http = http;
        this.base = base;
        this.disc = disc;
        this.old = disc.specification === '0.1' || disc.format === 'opensheaf-archive/0.1' ||
          (disc.specification !== '0.2' && Object.hasOwn(disc, 'archiveId'));
        this.name = typeof disc.name === 'string' && disc.name ? disc.name : base;
        this.layout = disc.storageLayout === HASHED_LAYOUT ? HASHED_LAYOUT : OWNER_NAME_LAYOUT;
        let root;
        try {
          root = new URL(typeof disc.storageRoot === 'string' ? disc.storageRoot : 'ocfl/', base).href;
        } catch {
          root = base + 'ocfl/';
        }
        this.root = root.endsWith('/') ? root : root + '/';
        this.paths = new Map();
        this.keyLogs = new Map();
        this.lines = new Map();
        this.lister = null;
      }

The entries of the discovery document, as far as they can be used: the
objects with a valid identifier (section 4), the drafts it shows, its
tombstones, the owners it hosts, each with its owner catalogue (section
8.1), in the order in which the archive presents them, and the labels it
gives (section 3.1),
which the explorer uses in its addresses and as names of objects, as
`osheaf` does in its findings. `listed` gives the entries as listed, for
verification; an archive that pages its objects (section 3.1) has them
from its pages, read when it is opened (below).

    // in core/archive.js:
      listed() {
        if (Array.isArray(this.paged)) return this.paged;
        return Array.isArray(this.disc.objects) ? this.disc.objects : [];
      }

      objects() {
        return this.listed().filter((o) => isObject(o) && isObjectId(o.id) && !parseId(o.id).draft);
      }

      entry(id) {
        return this.objects().find((o) => o.id === id) || null;
      }

      drafts() {
        const list = Array.isArray(this.disc.drafts) ? this.disc.drafts : [];
        return list.filter((d) => isObject(d) && isObjectId(d.id) && parseId(d.id).draft);
      }

      tombstones() {
        const list = Array.isArray(this.disc.tombstones) ? this.disc.tombstones : [];
        return list.filter((t) => isObject(t) && typeof t.id === 'string');
      }

      owners() {
        return (Array.isArray(this.disc.owners) ? this.disc.owners : [])
          .filter((e) => isObject(e) && typeof e.owner === 'string');
      }

      labelOf(id) {
        return this.objects().find((o) => o.id === id && typeof o.label === 'string')?.label ?? null;
      }

      byLabel(label) {
        return this.objects().find((o) => o.label === label)?.id ?? null;
      }

An archive with many objects lists them in pages (section 3.1):
`objectPages` gives the paths of page files below the discovery document,
each with `format` `"opensheaf-objects/0.2"` and entries of the form of
`objects`. They are read when the archive is opened, and their entries
take the place of `objects`. A path must be relative, without `.`, `..`
or empty segments, a scheme or a backslash, and name a JSON file. A path
refused, a page missing or not a page is kept in `pageProblems`, which
verification reports as errors and which makes the archive unavailable to
a resolver, as `osheaf` does; the pages read are kept in `pages`, for
verification against their schema.

    // in core/archive.js:
      async loadPages(options = {}) {
        const ok = (path) => typeof path === 'string' && path.endsWith('.json') && !path.startsWith('/') &&
          !path.includes('\\') && !path.split('/')[0].includes(':') &&
          path.split('/').every((x) => x !== '' && x !== '.' && x !== '..');
        this.pages = [];
        this.pageProblems = [];
        const entries = [];
        for (const path of Array.isArray(this.disc.objectPages) ? this.disc.objectPages : []) {
          if (!ok(path)) {
            this.pageProblems.push(`${JSON.stringify(path)} is not the path of a page below the discovery document (section 3.1)`);
            continue;
          }
          let page;
          try {
            page = parseJson(await this.http.cached(this.base + path, options), this.base + path);
          } catch (error) {
            if (error?.kind === 'aborted') throw error;
            this.pageProblems.push(error?.kind === 'not-found' ? `the page of objects ${path} is missing (section 3.1)`
              : `the page of objects ${path} is not JSON`);
            continue;
          }
          this.pages.push({ path, page });
          if (isObject(page) && Array.isArray(page.objects)) entries.push(...page.objects);
          else this.pageProblems.push(`${path} is not a page of objects (section 3.1)`);
        }
        this.paged = entries;
      }

How an object is named to a reader, in findings and on pages: a key log
as `owner <name>`, a line by its label if the archive gives one, and
otherwise by its identifier; these are the places of `osheaf verify`.

    // in core/archive.js:
      where(id) {
        const parts = parseId(id);
        if (parts && parts.name === parts.owner) return `owner ${parts.owner}`;
        return this.labelOf(id) || id || '?';
      }

Addresses
---------

The path of an object is computed once (`locate`); the addresses of its
files are then built from it. An identifier whose path is not known yet
is an error of the program, not of the archive, and is refused.

    // in core/archive.js:
      async locate(id) {
        if (!this.paths.has(id)) this.paths.set(id, await pathOf(id, this.layout));
        return this.paths.get(id);
      }

      url(id, ...segments) {
        if (!this.paths.has(id)) {
          throw new FetchError('unsafe', this.root, `${JSON.stringify(id)} is not the identifier of an object (section 4)`);
        }
        return under(this.root, [...this.paths.get(id), ...segments]);
      }

      versionUrl(id, ver, file) {
        if (!isVersion(ver)) throw new FetchError('unsafe', this.root, `${JSON.stringify(ver)} is not an object version (section 4.1)`);
        return this.url(id, ver, file);
      }

      folderUrl(id, ver) {
        const folder = this.url(id, 'x').slice(0, -1);
        if (!ver) return folder;
        return this.versionUrl(id, ver, 'x').slice(0, -1);
      }

      contentUrl(id, inv, cp) {
        const problem = contentPathProblem(cp, inv?.contentDirectory || 'content');
        if (problem) throw new FetchError('unsafe', this.root, `the content path ${JSON.stringify(cp)} ${problem}`);
        return underPath(this.folderUrl(id), cp);
      }

      inventoryUrl(id, ver) {
        return ver ? this.versionUrl(id, ver, 'inventory.json') : this.url(id, 'inventory.json');
      }

      witnessUrl(id, ver, name) {
        if (!isVersion(ver)) throw new FetchError('unsafe', this.root, `${JSON.stringify(ver)} is not an object version (section 4.1)`);
        return this.url(id, ...WITNESSES.split('/'), ver, name);
      }

Inventories and pins
--------------------

The inventory of an object (its root inventory, or the copy in a version
folder) is read and kept by the HTTP client; its checksum file states its
digest (section 4.1). A pin is the pair (object version, digest of that
version's inventory file, as its checksum file states it), and holds only
when the checksum file states the digest of the bytes served.

    // in core/archive.js:
      async inventoryBytes(id, ver, options = {}) {
        await this.locate(id);
        return this.http.cached(this.inventoryUrl(id, ver), options);
      }

      async inventory(id, ver, options = {}) {
        const bytes = await this.inventoryBytes(id, ver, options);
        const where = this.inventoryUrl(id, ver);
        const inv = parseJson(bytes, where);
        if (!isObject(inv) || !isObject(inv.versions) || !isObject(inv.manifest)) {
          throw new FetchError('json', where, 'is not an OCFL inventory');
        }
        if (Object.keys(inv.versions).length > LIMITS.versions) {
          throw new FetchError('too-large', where, `has more than ${LIMITS.versions} object versions`);
        }
        return inv;
      }

      async sidecarBytes(id, ver, options = {}) {
        await this.locate(id);
        const where = ver ? this.versionUrl(id, ver, 'inventory.json.sha512') : this.url(id, 'inventory.json.sha512');
        return this.http.cached(where, { ...options, limit: 4096 });
      }

      async sidecar(id, ver, options = {}) {
        return sidecarDigest(await this.sidecarBytes(id, ver, options)) ?? '';
      }

The root inventory is not signed: a signature signs the copy in a version
folder (section 7.1). What is read of a line, its versions and their
files, is therefore read through the copy in the folder of the head
version, as opensheaf-py's resolver does: the root inventory only names
the head, and the copy of that version must be one of the same object
and of that version.

    // in core/archive.js:
      async headInventory(id, options = {}) {
        const root = await this.inventory(id, null, options);
        if (!isVersion(root.head)) {
          throw new FetchError('json', this.inventoryUrl(id, null), 'names no head version (section 4.1)');
        }
        const inv = await this.inventory(id, root.head, options);
        if (inv.id !== root.id || inv.head !== root.head) {
          throw new FetchError('json', this.inventoryUrl(id, root.head), `is not the inventory of ${root.head} of the object`);
        }
        return inv;
      }

Files
-----

A file of an object version is found by its logical path, through the
state of the version and the manifest (chapter [13](13-versions.md)). JSON
files are read with the limit on JSON; other small files (a genesis
record, a key log's `keys.json`, the evidence of a branch) as bytes.

Every file read has the digest the inventory states for it, or is not
read: a server, a mirror above all, may serve other bytes at the content
path, and what the signatures sign is the inventory, which binds the
content only through these digests (section 4.1). A file whose bytes do
not have that digest is refused with an error of kind `digest`, as
opensheaf-py refuses a copy with such a file.

    // in core/archive.js:
      fileUrl(id, inv, ver, logical) {
        const cp = contentPath(inv, ver, logical);
        return cp ? this.contentUrl(id, inv, cp) : null;
      }

      async json(id, inv, ver, logical, options = {}) {
        const bytes = await this.bytes(id, inv, ver, logical, options);
        return bytes === null ? null : parseJson(bytes, this.fileUrl(id, inv, ver, logical));
      }

      async bytes(id, inv, ver, logical, options = {}) {
        await this.locate(id);
        const url = this.fileUrl(id, inv, ver, logical);
        if (!url) return null;
        const bytes = await this.http.cached(url, { ...options, limit: LIMITS.json });
        const digest = filesOf(inv, ver)[logical];
        if (typeof digest !== 'string' || (await sha512(bytes)) !== digest.toLowerCase()) {
          throw new FetchError('digest', url, `does not have the digest its inventory states for ${logical} (section 4.1)`);
        }
        return bytes;
      }

      async descriptions(id, inv, ver, options = {}) {
        const [obj, dc] = await Promise.all([
          this.json(id, inv, ver, 'object.json', options),
          this.json(id, inv, ver, 'datacite.json', options),
        ]);
        return { obj, dc };
      }

      async objectsOf(id, inv, options = {}) {
        const versions = versionsOf(inv);
        const objs = await Promise.all(versions.map((v) =>
          this.json(id, inv, v, 'object.json', options).catch((error) => {
            if (error.kind === 'aborted') throw error;
            return null;
          })));
        return new Map(versions.map((v, k) => [v, objs[k]]));
      }

      async history(id, at, options = {}) {
        const inv = await this.headInventory(id, options);
        const objs = await this.objectsOf(id, inv, options);
        const objOf = (v) => objs.get(v) ?? null;
        return { inv, objs, hist: historyOf(inv, objOf, at || inv.head), current: currentVersion(inv, objOf, at || inv.head) };
      }

A file of a witness folder is read only when its name is known, since a
server lists no folders (section 14.1); `null` when there is none.

An archive read from files that can be listed (a folder, through its
storage, chapter [20](20-storage.md)) is given a `lister`: a function
from the address of a folder to its entries, `[{ name, kind }]`, or
`null` when it cannot list it. Its witness folders are then read whole,
as opensheaf-py reads a folder: every signature file is judged, also one
of a key its key log does not list, or without any key log, and the other
files are seen (the verification reports them, section 7.2). This
option is opensheaf-js's, to be carried to the Explorer (chapter
[00](00-plan.md)).

    // in core/archive.js:
      async listWitnesses(id, ver) {
        if (!this.lister) return null;
        const found = await this.lister(this.url(id, ...WITNESSES.split('/'), ver, 'x').slice(0, -1));
        return found ? found.filter((e) => e.kind === 'file').map((e) => e.name) : null;
      }

      async listFolder(id, ...segments) {
        if (!this.lister) return null;
        return this.lister(this.url(id, ...segments, 'x').slice(0, -1));
      }

One file of a witness folder, by its name:

    // in core/archive.js:
      async witness(id, ver, name, options = {}) {
        await this.locate(id);
        try {
          return await this.http.cached(this.witnessUrl(id, ver, name), { ...options, limit: LIMITS.json });
        } catch (error) {
          if (error.kind === 'not-found' || error.kind === 'forbidden') return null;
          throw error;
        }
      }

Key logs
--------

The key log of an owner is its owner object, `sheaf:<owner>:<owner>`, in
the same storage root as the lines it signs (section 6.5). It is read
version by version, as opensheaf-py's `load_key_log` reads it from a
folder, with the same problems: each version's inventory copy and
checksum file, every file of its state, checked against its digest, and
the signature files of its rotation keys, whose names the version before
gives (`signature-<k>.json`, `<k>` the first 16 characters of a digest of
`next`). A content path must be one of the object (`contentUrl`) and of
this version or an earlier one, as `content_path(cp, inv, n)` requires
in opensheaf-py: a version cannot take its content from a later one. A
fork record carries the signatures of the other side in its content
(section 6.3). The key log is then checked (chapter
[07](07-owners.md)), and kept: `null` when the archive holds no such
object, an exception when it cannot be read as a key log.

    // in core/archive.js:
      keyLog(owner, options = {}) {
        if (!this.keyLogs.has(owner)) {
          const loading = this.readKeyLog(owner, options);
          this.keyLogs.set(owner, loading);
          loading.catch((error) => { if (error?.kind === 'aborted') this.keyLogs.delete(owner); });
        }
        return this.keyLogs.get(owner);
      }

      async readKeyLog(owner, options) {
        const id = objectId(owner, owner);
        let rootBytes;
        try {
          rootBytes = await this.inventoryBytes(id, null, options);
        } catch (error) {
          if (error.kind === 'not-found') return null;
          throw error;
        }
        const root = jsonOrNull(rootBytes);
        const head = typeof root?.head === 'string' && /^v[0-9]+$/.test(root.head) ? Number(root.head.slice(1)) : NaN;
        if (!Number.isInteger(head)) throw new Error(`${this.where(id)}: not an OCFL object with an inventory`);
        const versions = [], problems = [];
        for (let n = 1; n <= Math.min(head, LIMITS.versions); n++) {
          const ver = `v${n}`;
          let invBytes, entry;
          try {
            invBytes = await this.inventoryBytes(id, ver, options);
            entry = parseJson(invBytes);
            if (!isObject(entry.manifest) || !isObject(entry.versions?.[ver]?.state)) throw new Error('not an inventory');
          } catch (error) {
            if (error.kind === 'aborted') throw error;
            problems.push(`${ver}: no readable inventory in the version folder (section 4.1; ${error.detail || error.message})`);
            break;
          }
          const sc = await this.sidecarBytes(id, ver, options).catch((error) => {
            if (error.kind === 'aborted') throw error;
            return new Uint8Array();
          });
          const digest = await sha512(invBytes);
          if (sidecarDigest(sc) !== digest) problems.push(`${ver}: the checksum file does not state the digest of the inventory`);
          const files = new Map();
          for (const [d, paths] of Object.entries(entry.versions[ver].state)) {
            if (!Array.isArray(paths) || !paths.length) continue;
            let bytes = new Uint8Array();
            const cp = entry.manifest[d]?.[0];
            const k = typeof cp === 'string' ? /^v([1-9][0-9]*)\//.exec(cp) : null;
            if (!k || Number(k[1]) > n) {
              problems.push(`${ver}: a content path out of the object: '${cp}'`);
              problems.push(`${ver}: the content of ${paths[0]} is missing`);
            } else {
              try {
                bytes = await this.http.cached(this.contentUrl(id, entry, cp), { ...options, limit: LIMITS.json });
              } catch (error) {
                if (error.kind === 'aborted') throw error;
                problems.push(`${ver}: the content of ${paths[0]} is missing`);
              }
            }
            if ((await sha512(bytes)) !== d) problems.push(`${ver}: ${paths[0]} does not have the digest its inventory states`);
            for (const p of paths) files.set(p, bytes);
          }
          const witnesses = new Map();
          const prev = versions[versions.length - 1]?.keys;
          for (const d of n > 1 && Array.isArray(prev?.next) ? prev.next : []) {
            if (typeof d !== 'string') continue;
            const name = `signature-${d.slice(0, 16)}.json`;
            const bytes = await this.witness(id, ver, name, options);
            if (bytes) witnesses.set(name, bytes);
          }
          versions.push(await Version.make(n, files, invBytes, sc, witnesses));
        }
        if (!versions.length || !versions[0].files.has('genesis.json')) {
          throw new Error(`${this.where(id)}: no genesis record in the first version`);
        }
        if (versions[versions.length - 1].number === head && !sameBytes(rootBytes, versions[versions.length - 1].inventory)) {
          problems.push('the root inventory differs from that of the head version');
        }
        const log = await KeyLog.of(versions[0].files.get('genesis.json'), versions, problems);
        if (root.id !== log.id) {
          problems.push(`the identifier of the object is not ${log.id}, that of the owner its genesis record names`);
        }
        await log.check();
        return log;
      }

Lines and their statuses
------------------------

A line is read with what its statuses need (section 7.3): the inventory
copy of every version (its digest is what signatures sign), the
`object.json` of every version, and the signature files of every version,
named from the keys of its owner's key log, every key any version of it
lists, the versions a fork record carries included, as opensheaf-py's
resolver names them. The owner is the `owner` of the first version's
`object.json`; its key log is the one this archive holds, unless the
caller gives another (a resolver gives the key log met in every archive
it read, chapter [15](15-resolve.md)).

Without a key log, the signature files cannot be named, and so cannot be
read: the versions are then unchecked (`osheaf verify`, which lists the
folders, finds the files and judges them unchecked, since the key-log
versions they name are not reached; a version without signature files,
which it finds unsigned, the explorer cannot tell from one whose files
it could not name, and also calls unchecked).

The answer is kept for the session: `inv`, the inventory of the head
version (the copy in its folder, not the root inventory); `versions`,
for each object version, its digest and `object.json`; `log`, `statuses`,
`judgements`; `latest`, the latest signed version (`vN` or `null`); and
`unnamed` when the signature files could not be named.

    // in core/archive.js:
      line(id, options = {}) {
        const key = options.log === undefined ? id : null;
        if (key && this.lines.has(key)) return this.lines.get(key);
        const loading = this.readLine(id, options);
        if (key) {
          this.lines.set(key, loading);
          loading.catch(() => this.lines.delete(key));
        }
        return loading;
      }

      async readLine(id, { log, signal } = {}) {
        const options = { signal };
        const inv = await this.headInventory(id, options);
        const names = versionsOf(inv);
        const objs = await this.objectsOf(id, inv, options);
        const versions = await Promise.all(names.map(async (ver) => {
          const bytes = await this.inventoryBytes(id, ver, options).catch((error) => {
            if (error.kind === 'aborted') throw error;
            return null;
          });
          return { ver, digest: bytes ? await sha512(bytes) : '', obj: objs.get(ver) ?? null };
        }));
        const owner = objs.get(names[0])?.owner;
        if (log === undefined) {
          log = typeof owner === 'string' ? await this.keyLog(owner, options).catch((error) => {
            if (error?.kind === 'aborted') throw error;
            return null;
          }) : null;
        }
        let judgements, statuses, unnamed = false, listed = null;
        if (this.lister) listed = await Promise.all(versions.map((v) => this.listWitnesses(id, v.ver)));
        if (listed?.every((x) => x !== null)) {
          const withWitnesses = await Promise.all(versions.map(async (v, k) => {
            const witnesses = new Map();
            for (const name of listed[k]) {
              const bytes = await this.witness(id, v.ver, name, options);
              if (bytes) witnesses.set(name, bytes);
            }
            return { version: v.ver, digest: v.digest, witnesses };
          }));
          if (log) {
            ({ judgements, statuses } = await lineStatusesOf(id, owner, withWitnesses, log));
          } else {
            judgements = await Promise.all(withWitnesses.map((v) => judgeFolder(v.witnesses, {
              objectId: id, version: v.version, inventory: v.digest, owner, lookup: () => null })));
            statuses = lineStatuses(judgements);
          }
        } else if (!log) {
          listed = null;
          unnamed = true;
          judgements = versions.map(() => []);
          statuses = versions.map(() => UNCHECKED);
        } else {
          listed = null;
          const dids = new Set();
          for (const v of log.versions) {
            for (const did of Array.isArray(v.keys?.keys) ? v.keys.keys : []) dids.add(did);
            for (const c of v.carried || []) for (const did of Array.isArray(c.keys?.keys) ? c.keys.keys : []) dids.add(did);
          }
          for (const c of log.met?.carried || []) for (const did of Array.isArray(c.keys?.keys) ? c.keys.keys : []) dids.add(did);
          const files = (await Promise.all([...dids].filter((d) => typeof d === 'string').map(fileName))).sort();
          const withWitnesses = await Promise.all(versions.map(async (v) => {
            const witnesses = new Map();
            for (const name of files) {
              const bytes = await this.witness(id, v.ver, name, options);
              if (bytes) witnesses.set(name, bytes);
            }
            return { version: v.ver, digest: v.digest, witnesses };
          }));
          ({ judgements, statuses } = await lineStatusesOf(id, owner, withWitnesses, log));
        }
        const n = latestSigned(statuses);
        return { id, inv, versions, objs, owner, log, judgements, statuses, unnamed, listed, latest: n ? `v${n}` : null };
      }
    }
