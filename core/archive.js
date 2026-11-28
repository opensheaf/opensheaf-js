// Generated from literate/14-archive.md by opensheaf-literate: edit the document, not this file.
import { FetchError, parseJson, sha512, LIMITS } from './http.js';
import { isObjectId, isVersion, under, underPath, contentPathProblem, pathOf, storageRootOk, OWNER_NAME_LAYOUT,
         HASHED_LAYOUT } from './paths.js';
import { contentPath, historyOf, currentVersion, versionsOf, filesOf } from './versions.js';
import { objectId, parseId, isObject } from './names.js';
import { KeyLog, Version, sidecarDigest, jsonOrNull } from './owners.js';
import { fileName, lineStatusesOf, latestSigned, judgeFolder, lineStatuses, WITNESSES, UNCHECKED } from './signatures.js';
import { sameBytes } from './crypto.js';

export function baseOf(url, relativeTo = globalThis.location?.href) {
  const u = new URL(url, relativeTo);
  u.hash = '';
  u.search = '';
  let s = u.href;
  if (/\/[^/]*\.[A-Za-z0-9]{1,8}$/.test(u.pathname)) s = s.slice(0, s.lastIndexOf('/') + 1);
  return s.endsWith('/') ? s : s + '/';
}

export function withScheme(given) {
  const s = String(given).trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  const host = /^(\[[0-9a-f:.]+\]|[a-z0-9][a-z0-9.-]*)(:\d+)?(\/|$)/i.exec(s);
  if (!host || !(host[2] || host[1].includes('.') || host[1].toLowerCase() === 'localhost')) return s;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host[1]);
  return (local ? 'http://' : 'https://') + s;
}

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
    const given = disc.storageRoot ?? 'ocfl/';
    this.rootRefused = !storageRootOk(given);
    this.root = under(base, (this.rootRefused ? 'ocfl/' : given).slice(0, -1).split('/')) + '/';
    this.paths = new Map();
    this.keyLogs = new Map();
    this.lines = new Map();
    this.lister = null;
  }

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

  async loadPages(options = {}) {
    const ok = (path) => typeof path === 'string' && path.endsWith('.json') && !path.startsWith('/') &&
      !path.includes('\\') && !path.split('/')[0].includes(':') &&
      path.split('/').every((x) => x !== '' && x !== '.' && x !== '..');
    this.pages = [];
    this.unparsed = [];
    this.pageProblems = [];
    const entries = [];
    for (const path of Array.isArray(this.disc.objectPages) ? this.disc.objectPages : []) {
      if (!ok(path)) {
        this.pageProblems.push(`${JSON.stringify(path)} is not the path of a page below the discovery document (section 3.1)`);
        continue;
      }
      let page, bytes = null;
      try {
        bytes = await this.http.cached(this.base + path, options);
        page = parseJson(bytes, this.base + path);
      } catch (error) {
        if (error?.kind === 'aborted') throw error;
        if (bytes) this.unparsed.push({ path, bytes });
        this.pageProblems.push(error?.kind === 'not-found' ? `the page of objects ${path} is missing (section 3.1)`
          : `the page of objects ${path} is not JSON`);
        continue;
      }
      this.pages.push({ path, page, bytes, entries: isObject(page) && Array.isArray(page.objects) ? page.objects : [] });
      if (isObject(page) && Array.isArray(page.objects)) entries.push(...page.objects);
      else this.pageProblems.push(`${path} is not a page of objects (section 3.1)`);
    }
    this.paged = entries;
  }

  where(id) {
    const parts = parseId(id);
    if (parts && parts.name === parts.owner) return `owner ${parts.owner}`;
    return this.labelOf(id) || id || '?';
  }

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
    const bytes = await this.http.cached(url, { ...options, limit: LIMITS.file });
    const digest = filesOf(inv, ver)[logical];
    if (typeof digest !== 'string' || (await sha512(bytes)) !== digest.toLowerCase()) {
      throw Object.assign(new FetchError('digest', url, `does not have the digest its inventory states for ${logical} (section 4.1)`),
                          { logical });
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

  async listWitnesses(id, ver) {
    if (!this.lister) return null;
    const found = await this.lister(this.url(id, ...WITNESSES.split('/'), ver, 'x').slice(0, -1));
    return found ? found.filter((e) => e.kind === 'file').map((e) => e.name) : null;
  }

  async listFolder(id, ...segments) {
    if (!this.lister) return null;
    return this.lister(this.url(id, ...segments, 'x').slice(0, -1));
  }

  async witness(id, ver, name, options = {}) {
    await this.locate(id);
    try {
      return await this.http.cached(this.witnessUrl(id, ver, name), { ...options, limit: LIMITS.json });
    } catch (error) {
      if (error.kind === 'not-found' || error.kind === 'forbidden') return null;
      throw error;
    }
  }

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
            bytes = await this.http.cached(this.contentUrl(id, entry, cp), { ...options, limit: LIMITS.file });
          } catch (error) {
            if (['aborted', 'too-large', 'timeout', 'budget'].includes(error.kind)) throw error;
            problems.push(`${ver}: the content of ${paths[0]} is missing`);
          }
        }
        if ((await sha512(bytes)) !== d) problems.push(`${ver}: ${paths[0]} does not have the digest its inventory states`);
        for (const p of paths) files.set(p, bytes);
      }
      const witnesses = new Map();
      const prev = versions[versions.length - 1]?.keys;
      const listed = await this.listWitnesses(id, ver);
      const named = listed ?? (n > 1 && Array.isArray(prev?.next) ? prev.next : [])
        .filter((d) => typeof d === 'string').map((d) => `signature-${d.slice(0, 16)}.json`);
      for (const name of named) {
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

  line(id, options = {}) {
    const log = options.log;
    this.linesBy ??= new WeakMap();
    const lines = log === undefined ? this.lines : !options.keep ? new Map() : log === null ? (this.linesWithout ??= new Map())
      : this.linesBy.get(log) ?? this.linesBy.set(log, new Map()).get(log);
    if (lines.has(id)) return lines.get(id);
    const loading = this.readLine(id, options);
    lines.set(id, loading);
    loading.catch(() => lines.delete(id));
    return loading;
  }

  async readLine(id, { log, signal } = {}) {
    const options = { signal };
    const inv = await this.headInventory(id, options);
    const names = versionsOf(inv);
    const objs = await this.objectsOf(id, inv, options);
    const copies = [];
    const versions = await Promise.all(names.map(async (ver, k) => {
      const bytes = await this.inventoryBytes(id, ver, options).catch((error) => {
        if (error.kind === 'aborted') throw error;
        return null;
      });
      copies[k] = bytes;
      return { ver, digest: bytes ? await sha512(bytes) : '', obj: objs.get(ver) ?? null };
    }));
    const inventoriesProblem = inventoriesProblemOf(inv, names, copies);
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
    return { id, inv, versions, objs, owner, log, judgements, statuses, unnamed, listed, latest: n ? `v${n}` : null,
             inventoriesProblem };
  }
}


export function jsonEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, k) => jsonEqual(x, b[k]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
}

export function versionProblem(inv, n, copy) {
  const upto = Array.from({ length: n }, (_, k) => `v${k + 1}`);
  if (!isObject(copy) || copy.head !== `v${n}`) return 'its inventory is not one of that version';
  const held = copy.versions, stated = inv?.versions;
  if (!isObject(held) || !isObject(stated) || Object.keys(held).sort().join() !== [...upto].sort().join() ||
      upto.some((v) => !jsonEqual(held[v], stated[v]))) {
    return 'its inventory does not record the versions up to it as the head inventory does';
  }
  return null;
}

function inventoriesProblemOf(inv, names, copies) {
  const head = Number(String(inv.head).slice(1));
  for (let n = 1; n < head; n++) {
    if (names[n - 1] !== `v${n}` || !copies[n - 1]) return `v${n} has no inventory (section 4.1)`;
    let copy = null;
    try {
      copy = JSON.parse(new TextDecoder().decode(copies[n - 1]));
    } catch {
      copy = null;
    }
    const problem = versionProblem(inv, n, copy);
    if (problem) return `v${n}: ${problem} (section 14.2)`;
  }
  return null;
}
