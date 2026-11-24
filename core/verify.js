// Generated from literate/17-verify.md by opensheaf-literate: edit the document, not this file.
import { sha512, pool, LIMITS, parseJson } from './http.js';
import { Archive } from './archive.js';
import { versionsOf, filesOf, documentVersionErrors, noticeWarnings, historyOf, withdrawnVersions } from './versions.js';
import { versionNumber, logicalPathProblem, OWNER_NAME_LAYOUT, HASHED_LAYOUT, LAYOUT_FILE } from './paths.js';
import { finding, schemaFindings, descriptionErrors, memberErrors, memberPins, indexEntries, INDEX_KEY } from './rules.js';
import { readGenesis, nameOf, isNameOf, algorithm, objectId, parseId, isObject, OWNER_NAME } from './names.js';
import { sidecarDigest, jsonOrNull } from './owners.js';
import { latestSigned, GOOD, SIGNED, VOUCHED, CONTESTED, UNCHECKED, UNSIGNED, INVALID, WITNESSES } from './signatures.js';
import { verdict, levelOfVersion, INCONSISTENT, UNCHECKED as BRANCH_UNCHECKED, ORDER } from './branches.js';
import { Resolver } from './resolve.js';
import { same } from './schema.js';

export const NOT_CHECKED = [
  { section: '14.1', text: 'Completeness: whether the storage root holds objects that the discovery document does not list, and files of witness folders whose names cannot be computed (others’ witnesses, timestamps, stray files). A server does not list folders, so only the listed objects, and the signature files named by the keys of their owners, are read.' },
  { section: '14.2', text: 'OCFL 1.1 as a whole. The explorer checks the declarations of the storage root and of each object, the layout, the inventories (versions without gaps, the head, safe content paths), the copy of the inventory in each version folder and the inventory chain; osheaf verify also runs an independent OCFL validator when it is installed.' },
  { section: '14.2', text: 'The digests of the content files, unless "also check file digests" is chosen: without it, files are trusted to match their inventories (which are checked against their checksum files, signatures and pins). The files of key logs, genesis records and evidence of branches are always checked, the parent/object.json of a branch point by the digest of its bytes as read, at every level of the chain.' },
  { section: '4.4', text: 'datacite.json against the DataCite 4.7 XML Schema (neither does osheaf verify): only the properties section 4.4 requires are checked.' },
  { section: '14.5', text: 'The pins of members of other archives in earlier versions of a collection (optional; neither does osheaf verify). Members held in the archive are checked in every version.' },
  { section: '12.3', text: 'The digests of the content files of copies found in other archives: their inventories, checksum files, descriptions, genesis records and signatures are checked, which is what pins rest on.' },
  { section: '6.6', text: 'Keepers: the check digit of an ORCID iD is checked, not the confirmation of the link by the keeper.' },
  { section: '15.4', text: 'Files that look like private keys in the archive, which osheaf verify looks for in the folder.' },
  { section: 'appendix A', text: 'The requirements of the profiles (zenodo, texmacs) and of extensions; of the profile website, the home page and the landing pages of the members of the owner catalogues.' },
];

export class Report {
  constructor(archive, options) {
    this.archive = archive;
    this.options = options;
    this.findings = [];
    this.stats = { objects: 0, versions: 0, pins: 0, files: 0, filesBytes: 0 };
    this.started = new Date();
    this.finished = null;
    this.cancelled = false;
    this.requests = 0;
    this.bytesRead = 0;
    this.listeners = new Set();
  }

  add(...found) {
    for (const f of found) {
      this.findings.push(f);
      for (const listen of this.listeners) listen(f);
    }
  }

  counts() {
    const counts = { error: 0, warning: 0, result: 0 };
    for (const f of this.findings) counts[f.level]++;
    return counts;
  }

  text() {
    const lines = this.findings.map((f) => `${f.level}: ${f.text}`);
    const c = this.counts();
    return [...lines, (c.error ? `${c.error} error(s)` : 'OK') + `, ${c.warning} warning(s), ${c.result} result(s)`].join('\n');
  }
}

export async function verify(given, { schemas, remote = true, digests = false, signal,
                                      progress = () => {}, onFinding, pages = true } = {}) {
  const report = new Report(given, { remote, digests });
  if (onFinding) report.listeners.add(onFinding);
  const http = given.http.another({ budget: null });
  const options = { signal };
  const aborted = (e) => e?.kind === 'aborted' || signal?.aborted;
  const add = (level, place, message, context) => report.add(finding(level, place, message, context));
  const schema = (place, data, format, level = 'error', context = {}) =>
    report.add(...schemaFindings(place, data, schemas[`opensheaf-${format}/0.2`], level, context));
  let archive;
  try {
    archive = await Archive.open(http, given.base, options);
    archive.lister = given.lister ?? null;
    archive.unlisted = given.unlisted ?? [];
    report.archive = archive;
    if (archive.old) {
      add('error', 'archive', 'specification 0.1: rebuild (section 16.1)');
    } else {
      const v = new Verification(archive, { report, add, schema, options, aborted, remote, digests, progress, http, pages });
      await v.run();
    }
  } catch (error) {
    if (!aborted(error)) throw error;
    report.cancelled = true;
  }
  report.finished = new Date();
  report.requests = http.requests;
  report.bytesRead = http.bytesRead;
  return report;
}

class Verification {
  constructor(archive, context) {
    Object.assign(this, context);
    this.archive = archive;
    this.found = new Map();
    this.logs = new Map();
    this.statuses = new Map();
    this.tombstoned = new Set(archive.tombstones().map((t) => t.id));
    this.resolver = context.remote ? new Resolver(context.http, archive) : null;
  }

  where(id) {
    return this.archive.where(id);
  }

  async run() {
    const a = this.archive;
    this.schema('opensheaf.json', a.disc, 'archive');
    for (const problem of a.pageProblems || []) this.add('error', 'opensheaf.json', problem);
    for (const { path, page } of a.pages || []) this.schema(path, page, 'objects');
    await this.storageRoot();
    const ids = [...a.objects().map((o) => o.id), ...a.drafts().map((d) => d.id), ...(a.unlisted || [])];
    const entries = [...new Set(ids)].slice(0, LIMITS.objects);
    if (ids.length > entries.length) this.add('warning', 'opensheaf.json', `lists more than ${LIMITS.objects} objects: only the first ${LIMITS.objects} are checked (section 15.2)`);
    let done = 0;
    const atOnce = pool(4);
    this.progress({ phase: 'objects', done, total: entries.length });
    await Promise.all(entries.map((id) => atOnce(async () => {
      if (this.options.signal?.aborted) return;
      await this.objectStorage(id);
      this.report.stats.objects++;
      this.progress({ phase: 'objects', done: ++done, total: entries.length, current: id });
    })));
    this.cancelled();
    await this.keyLogs();
    await this.lines();
    await this.archiveAsAWhole();
    await this.indexes();
    if (this.pages) await this.presentation();
    if (this.digests) await this.contentDigests();
    for (const { level, message } of this.resolver?.notes || []) this.add(level, 'resolution', message);
  }

  cancelled() {
    if (this.options.signal?.aborted) throw this.options.signal.reason;
  }

  async fetchOrNull(url, limit = LIMITS.json) {
    try {
      return await this.http.request(url, { limit, signal: this.options.signal });
    } catch (error) {
      if (this.aborted(error)) throw error;
      if (error.kind === 'not-found') return null;
      throw error;
    }
  }

  async storageRoot() {
    const a = this.archive;
    const root = a.root;
    const read = async (name) => {
      try {
        return await this.fetchOrNull(root + name, 1 << 20);
      } catch (error) {
        if (this.aborted(error)) throw error;
        return null;
      }
    };
    if (await read('0=ocfl_1.1') === null) this.add('error', 'ocfl', 'no OCFL 1.1 storage root (0=ocfl_1.1)');
    const declared = a.disc.storageLayout;
    if (declared !== OWNER_NAME_LAYOUT && declared !== HASHED_LAYOUT) {
      this.add('error', 'opensheaf.json', `storageLayout is ${declared}, not a layout of section 3.2`);
    }
    if (a.layout === OWNER_NAME_LAYOUT) {
      if (await read('ocfl_layout.json') !== null) {
        this.add('error', 'ocfl', 'ocfl_layout.json names only registered layouts: the owner-name layout has none (section 3.2)');
      }
      if (await read(LAYOUT_FILE) === null) this.add('warning', 'ocfl', `${LAYOUT_FILE}, which describes the layout, is missing (section 3.2)`);
    } else {
      const layout = jsonOrNull(await read('ocfl_layout.json'));
      if (layout?.extension !== HASHED_LAYOUT) this.add('error', 'ocfl', `ocfl_layout.json must name the extension ${HASHED_LAYOUT} (section 3.2)`);
      const raw = await read(`extensions/${HASHED_LAYOUT}/config.json`);
      const config = raw === null ? {} : jsonOrNull(raw);
      if (!isObject(config)) {
        this.add('error', 'ocfl', `extensions/${HASHED_LAYOUT}/config.json is not a JSON object`);
      } else if ((config.digestAlgorithm ?? 'sha256') !== 'sha256' || (config.tupleSize ?? 3) !== 3 || (config.numberOfTuples ?? 3) !== 3) {
        this.add('error', 'ocfl', 'the hashed layout keeps its default parameters (section 3.2)');
      }
    }
  }

  async objectStorage(id) {
    const a = this.archive;
    const place = this.where(id);
    const options = this.options;
    const listed = (message) => this.add('error', 'opensheaf.json', message, { object: id });
    let rootBytes;
    try {
      await a.locate(id);
      if (await this.fetchOrNull(a.url(id, '0=ocfl_object_1.1'), 4096) === null) {
        listed(`lists ${id}, which is not an object of the storage root (section 3.1)`);
        return;
      }
      rootBytes = await a.inventoryBytes(id, null, options);
    } catch (error) {
      if (this.aborted(error)) throw error;
      if (error.kind === 'not-found') listed(`lists ${id}, which is not an object of the storage root (section 3.1)`);
      else this.add('error', `ocfl/${(a.paths.get(id) || [id]).join('/')}`, 'an object without a readable inventory', { object: id });
      return;
    }
    const inv = jsonOrNull(rootBytes);
    if (!isObject(inv) || !isObject(inv.versions) || !isObject(inv.manifest)) {
      this.add('error', `ocfl/${a.paths.get(id).join('/')}`, 'an object without a readable inventory', { object: id });
      return;
    }
    if (inv.id !== id) {
      const expected = parseId(inv.id) ? (await a.locate(inv.id).catch((e) => { if (this.aborted(e)) throw e; return null; }))?.join('/') : null;
      this.add('error', this.where(inv.id), expected
        ? `is at ocfl/${a.paths.get(id).join('/')}, and its identifier puts it at ocfl/${expected} (section 3.2)`
        : `${inv.id}: not the identifier of a line or of a draft (sections 3.2 and 4)`, { object: id });
      listed(`lists ${id}, which is not an object of the storage root (section 3.1)`);
      return;
    }
    const kindOfHead = await a.json(id, inv, inv.head, 'object.json', options).catch((e) => { if (this.aborted(e)) throw e; return null; });
    const kind = kindOfHead?.kind;
    const draft = Boolean(parseId(id).draft);
    const o = { id, inv, rootBytes, head: kindOfHead, objs: new Map(), digests: [], sidecars: [], kind, draft };
    this.found.set(id, o);
    const at = (ver) => ({ object: id, ver });
    if (inv.digestAlgorithm !== 'sha512') this.add('error', place, 'the digest algorithm is not sha512 (section 4.1)', at());
    const stated = [...Object.keys(inv.manifest),
      ...Object.values(inv.versions).flatMap((v) => Object.keys(isObject(v?.state) ? v.state : {})),
      ...Object.values(isObject(inv.fixity) ? inv.fixity : {}).flatMap((alg) => Object.keys(isObject(alg) ? alg : {}))];
    if (stated.some((x) => x !== x.toLowerCase())) this.add('error', place, 'the inventory has digests not in lower case (section 4.1)', at());
    const upper = (bytes, file) => {
      const word = sidecarDigest(bytes);
      if (word && word !== word.toLowerCase()) this.add('error', place, `${file} states its digest not in lower case (section 4.1)`, at());
    };
    const rootDigest = await sha512(rootBytes);
    const sc = await a.sidecarBytes(id, null, options).catch((e) => { if (this.aborted(e)) throw e; return null; });
    upper(sc, 'inventory.json.sha512');
    if (!sc || sidecarDigest(sc) !== rootDigest) this.add('error', place, 'the checksum file of the inventory does not state its digest', at());
    o.sidecar = sc ? sidecarDigest(sc) : null;
    const head = typeof inv.head === 'string' ? inv.head : '';
    const headCopy = /^v[0-9]+$/.test(head) ? await this.fetchOrNull(a.inventoryUrl(id, head)).catch((e) => { if (this.aborted(e)) throw e; return null; }) : null;
    if (!headCopy || await sha512(headCopy) !== rootDigest) this.add('error', place, `the inventory of ${head} is not the root inventory`, at());
    const names = Object.keys(inv.versions).sort((x, y) => (Number(x.slice(1)) || 0) - (Number(y.slice(1)) || 0));
    for (const [k, ver] of names.entries()) {
      const n = k + 1;
      const where = `${place} ${ver}`;
      this.report.stats.versions++;
      if (ver !== `v${n}`) {
        this.add('error', where, 'versions are numbered v1, v2, ... without zero padding (section 4.1)', at(ver));
        continue;
      }
      const copy = await this.fetchOrNull(a.inventoryUrl(id, ver)).catch((e) => { if (this.aborted(e)) throw e; return null; });
      const copySc = await a.sidecarBytes(id, ver, this.options).catch((e) => { if (this.aborted(e)) throw e; return null; });
      o.digests[k] = copy ? await sha512(copy) : '';
      o.sidecars[k] = copySc ? sidecarDigest(copySc) : null;
      upper(copySc, `${ver}/inventory.json.sha512`);
      if (!copy || !copySc) {
        this.add('error', where, 'no copy of the inventory with its checksum file in the version folder (section 4.1)', at(ver));
      } else {
        if (sidecarDigest(copySc) !== o.digests[k]) this.add('error', where, 'the checksum file of the inventory copy does not state its digest', at(ver));
        const c = jsonOrNull(copy) || {};
        const upto = names.slice(0, n);
        if (c.head !== ver) this.add('error', where, `the inventory copy has the head ${c.head ?? 'None'}`, at(ver));
        const theirs = isObject(c.versions) ? Object.keys(c.versions).sort() : [];
        if (!same(theirs, [...upto].sort())) {
          this.add('error', where, `the inventory copy does not record exactly the versions v1 to ${ver}`, at(ver));
        } else if (upto.some((v) => !same(c.versions[v], inv.versions[v]))) {
          this.add('error', where, 'the inventory copy disagrees with the inventory about the versions it records', at(ver));
        }
      }
      const vinfo = isObject(inv.versions[ver]) ? inv.versions[ver] : {};
      if (!(kind === 'owner' && n === 1) && (!vinfo.user?.name || !vinfo.message)) {
        this.add('error', where, 'a version has a user with a name, and a message (section 4.1)', at(ver));
      }
      const logical = Object.keys(filesOf(inv, ver));
      for (const p of [...logical].sort()) {
        if (logicalPathProblem(p)) this.add('error', where, `the logical path '${p}' breaks the rules of section 4.1`, at(ver));
      }
      const needed = ['object.json', ...(kind !== 'owner' ? ['datacite.json'] : []), ...(draft ? [] : ['genesis.json'])];
      for (const name of needed) if (!logical.includes(name)) this.add('error', where, `has no ${name} (section 4.1)`, at(ver));
      if (!logical.includes('object.json')) continue;
      let obj = null;
      try {
        obj = await a.json(id, inv, ver, 'object.json', this.options);
      } catch (error) {
        if (this.aborted(error)) throw error;
        this.add('error', where, `object.json cannot be read: ${error.detail || error.message}`, at(ver));
      }
      o.objs.set(ver, obj);
      if (!obj || kind === 'owner') continue;
      this.schema(`${where}/object.json`, obj, 'object', 'error', at(ver));
      for (const message of reservedNameErrors(obj, logical)) this.add('error', where, message, at(ver));
      if (n === 1 || draft) {
        if (isObject(obj) && 'previous' in obj) this.add('error', where, 'a first version, or a draft, has no previous (section 4.3)', at(ver));
      } else if (!isObject(obj) || !('previous' in obj)) {
        this.add('error', where, 'object.json has no previous (section 4.3)', at(ver));
      } else if (obj.previous !== o.sidecars[k - 1]) {
        this.add('error', where, `previous is not the digest of the inventory of v${n - 1} (section 4.3)`, at(ver));
      }
    }
  }

  async keyLogs() {
    for (const [id, o] of this.found) {
      if (o.kind !== 'owner') continue;
      const place = this.where(id);
      const owner = parseId(id).owner;
      let log;
      try {
        log = await this.archive.keyLog(owner, this.options);
      } catch (error) {
        if (this.aborted(error)) throw error;
        this.add('error', place, error.detail || error.message, { object: id });
        continue;
      }
      if (!log) continue;
      const { errors, warnings } = await log.check();
      for (const e of errors) this.add('error', place, e, { object: id });
      for (const w of warnings) this.add('warning', place, w, { object: id });
      const genesis = jsonOrNull(log.genesis);
      if (genesis) this.schema(`${place} v1/genesis.json`, genesis, 'genesis', 'error', { object: id, ver: 'v1' });
      for (const v of log.versions) {
        if (v.keys !== null) this.schema(`${place} v${v.number}/keys.json`, v.keys, 'keys', 'error', { object: id, ver: `v${v.number}` });
      }
      this.logs.set(log.owner, log);
      const held = log.versions.filter((v) => v.isVersion);
      if (held.length) this.add('result', place, `key log of ${log.owner}: latest version v${held[held.length - 1].number}`, { object: id });
      for (const did of [...log.exposedKeys()].sort()) this.add('result', place, `exposed key ${did}`, { object: id });
      if (log.forkPoint) this.add('result', place, `ended by a fork of its key log at v${log.forkPoint} (section 6.3)`, { object: id });
      else if (log.ended) {
        this.add('result', place, 'ended (section 6.3)' + (log.successor ? `, successor ${log.successor} (named by the ending version)` : ''), { object: id });
      }
    }
  }

  async lines() {
    const genesisNames = new Map();
    for (const [id, o] of this.found) {
      this.cancelled();
      const head = o.objs.get(o.inv.head) || {};
      if (o.kind === 'owner') continue;
      const place = this.where(id);
      const a = this.archive;
      if (o.draft) {
        const g = await a.bytes(id, o.inv, o.inv.head, 'genesis.json', this.options).catch((e) => { if (this.aborted(e)) throw e; return null; });
        if (['name', 'owner', 'parent'].some((k) => isObject(head) && k in head) || g) {
          this.add('error', place, 'a draft has no genesis record, and no name, owner or parent (section 10.1)', { object: id });
        }
        continue;
      }
      const [, name, owner] = id.split(':');
      let genesis = null;
      for (const ver of versionsOf(o.inv)) {
        const g = await a.bytes(id, o.inv, ver, 'genesis.json', this.options).catch((e) => { if (this.aborted(e)) throw e; return null; });
        const obj = o.objs.get(ver) || {};
        if (obj.name !== name || obj.owner !== owner) {
          this.add('error', `${place} ${ver}`, 'object.json does not record the line of the identifier (section 4.3)', { object: id, ver });
        }
        if (!g) continue;
        if (genesis === null) genesis = g;
        else if (!sameBytes(g, genesis)) this.add('error', `${place} ${ver}`, 'genesis.json differs from that of v1 (section 5.1)', { object: id, ver });
      }
      o.genesis = genesis;
      let rec = null;
      if (genesis !== null) {
        try {
          rec = await readGenesis(genesis);
          this.schema(`${place} genesis.json`, parseJson(genesis, '', { integers: true }), 'genesis', 'error', { object: id });
        } catch (error) {
          this.add('error', place, `genesis.json: ${error.message}`, { object: id });
        }
      }
      o.rec = rec;
      if (rec !== null) {
        const g0 = await nameOf(genesis);
        if (!genesisNames.has(g0)) genesisNames.set(g0, []);
        genesisNames.get(g0).push([id, isObject(head) && 'parent' in head]);
        if (rec.kind !== head.kind) {
          this.add('error', place, `its genesis record is of kind ${rec.kind}, its object.json of kind ${head.kind}`, { object: id });
        }
        if (!await isNameOf(name, genesis)) {
          this.add('error', place, 'its name is not a name of its genesis record (section 5.2)', { object: id });
        } else if (rec.originator !== owner) {
          if (isObject(head) && 'parent' in head) await this.branch(id, o, genesis);
          else this.add('error', place, 'a line of another owner than the originator is a branch, and declares its parent (section 5.3)', { object: id });
        } else if (algorithm(name) !== 0) {
          this.add('error', place, "the originator's line is named by algorithm 0 (section 5.3)", { object: id });
        } else if ([...o.objs.values()].some((x) => isObject(x) && 'parent' in x)) {
          this.add('error', place, "the originator's line has no parent: an originator never owns a branch of its own " +
            'work (sections 5.3 and 9)', { object: id });
        }
      }
      for (const ver of versionsOf(o.inv)) {
        const obj = o.objs.get(ver);
        if (!obj || !filesOf(o.inv, ver)['datacite.json']) continue;
        const dc = await a.json(id, o.inv, ver, 'datacite.json', this.options).catch((e) => { if (this.aborted(e)) throw e; return null; });
        for (const message of descriptionErrors(o.inv, ver, obj, dc)) this.add('error', `${place} ${ver}`, message, { object: id, ver });
      }
      if (head.kind === 'document' || head.kind === 'collection') {
        for (const e of documentVersionErrors(o.inv, (v) => o.objs.get(v) ?? null)) this.add('error', place, `${e.ver} ${e.message}`, { object: id, ver: e.ver });
        for (const e of noticeWarnings(o.inv, (v) => o.objs.get(v) ?? null)) this.add('warning', place, `${e.ver} ${e.message}`, { object: id, ver: e.ver });
      }
      let log = this.logs.get(owner) ?? null;
      if (!log) {
        const ownerId = objectId(owner, owner);
        this.add(this.tombstoned.has(ownerId) ? 'warning' : 'error', place,
          `the key log of its owner ${owner} is not in the storage root (section 6.5)`, { object: id });
      }
      const line = await a.line(id, { log, signal: this.options.signal });
      o.line = line;
      this.statuses.set(id, line.statuses);
      line.statuses.forEach((s, k) => {
        const ver = `v${k + 1}`, where = `${place} ${ver}`;
        for (const j of line.judgements[k]) if (j.status !== GOOD) this.add('warning', where, `${j.file}: ${j.status}: ${j.reason}`, { object: id, ver });
        for (const n of line.listed?.[k] || []) {
          if (!(n.startsWith('signature-') && n.endsWith('.json'))) this.add('warning', where, `${n}: not a witness these tools know (section 7.2)`, { object: id, ver });
        }
        if (s === UNSIGNED || s === INVALID) this.add('warning', where, `not a version of the line: ${s} (sections 7.3 and 7.5)`, { object: id, ver });
        else if (s === UNCHECKED) this.add('warning', where, 'unchecked: the version of the key log its signatures name is not reached (section 7.3)', { object: id, ver });
        else if (s === CONTESTED) this.add('result', where, 'contested (section 7.3)', { object: id, ver });
      });
      for (const x of (await a.listFolder(id, ...WITNESSES.split('/'))) || []) {
        if (!(x.kind === 'dir' && Object.hasOwn(o.inv.versions, x.name))) {
          this.add('warning', place, `${WITNESSES}/${x.name}: not the folder of a version (section 7.2)`, { object: id });
        }
      }
      const signed = latestSigned(line.statuses);
      if (signed === null) this.add('warning', place, 'the line has no signed version (section 7.3)', { object: id });
      else {
        this.add('result', place, `latest signed version v${signed}`, { object: id });
        if (o.objs.get(`v${signed}`)?.status === 'withdrawn') this.add('result', place, 'withdrawn (section 13.1)', { object: id });
        else {
          const withdrawn = withdrawnVersions(o.inv, (v) => o.objs.get(v) ?? null, `v${signed}`);
          if (withdrawn.size) this.add('result', place, `reinstated; withdrawn: document version(s) ${[...withdrawn.keys()].sort((x, y) => x - y).join(', ')} (section 13.1)`, { object: id });
        }
      }
    }
    for (const ids of genesisNames.values()) {
      const lines = ids.filter(([, branch]) => !branch).map(([id]) => id);
      if (lines.length > 1) {
        this.add('error', lines.map((id) => this.where(id)).join(', '), 'objects with the same genesis record: only the ' +
          "originator's line and its branches may share one (section 5.4)");
      }
    }
    for (const [id, o] of this.found) {
      if (o.kind === 'collection' && this.statuses.has(id)) await this.members(id, o);
    }
  }

  async branch(id, o, genesis) {
    const a = this.archive;
    const place = this.where(id);
    const [, name, owner] = id.split(':');
    let prevObj = null, prevEvidence = null;
    const verdicts = [];
    for (const ver of versionsOf(o.inv)) {
      const where = `${place} ${ver}`;
      const obj = o.objs.get(ver) || {};
      const files = filesOf(o.inv, ver);
      const evidence = Object.fromEntries(Object.entries(files).filter(([p]) => p === 'genesis.json' || isEvidencePath(p)));
      const p = obj.parent;
      if (!isObject(p)) {
        this.add('error', where, 'every version of a branch has parent (section 9.1)', { object: id, ver });
        continue;
      }
      if (prevObj !== null && same(p, prevObj.parent)) {
        if (!same(evidence, prevEvidence)) this.add('error', where, 'the identity files change without a new branch point (section 9.4)', { object: id, ver });
      } else {
        const [v, problems] = await verdict(levelOfVersion(a, id, o.inv, ver, this.options), obj, genesis,
                                            async (who) => this.logs.get(who) ?? null);
        verdicts.push(v);
        if (v === INCONSISTENT) this.add('error', where, 'inconsistent branch point: ' + problems.join('; '), { object: id, ver });
        else if (v === BRANCH_UNCHECKED) this.add('warning', where, 'unchecked branch point: ' + problems.join('; '), { object: id, ver });
        if (prevObj !== null && v !== INCONSISTENT) await this.movedBranchPoint(id, o, ver, p, prevObj.parent, where);
      }
      prevObj = obj;
      prevEvidence = evidence;
    }
    if (!verdicts.length) return;
    const worst = verdicts.reduce((x, y) => (ORDER[y] > ORDER[x] ? y : x));
    const p = prevObj.parent;
    const pid = objectId(p.name, p.owner);
    this.add('result', place, `a branch of ${this.where(pid)}: ${worst} (section 9.3)`, { object: id });
    if (this.found.has(pid)) {
      const line = await a.line(pid, { log: this.logs.get(p.owner) ?? null, signal: this.options.signal });
      const status = line.latest ? line.objs.get(line.latest)?.status : null;
      this.add('result', place, "the parent's line is held here" + (status === 'withdrawn' ? ', withdrawn' : ''), { object: id });
    } else if (this.tombstoned.has(pid)) {
      this.add('result', place, "the parent's line is removed: a tombstone in this archive (section 13.3)", { object: id });
    } else if (this.resolver) {
      const at = typeof p.url === 'string' ? await this.resolver.archiveOf(p.url, this.options) : [];
      const res = await this.resolver.latest(p.name, p.owner, at, this.options);
      this.add('result', place, `the parent's line: ${res.status}` + (res.copy ? ` at ${res.copy.where}` : ''), { object: id });
    } else {
      this.add('result', place, "the parent's line is not held here (osheaf verify --remote looks for it)", { object: id });
    }
    if (name !== p.name && algorithm(name) > algorithm(p.name)) {
      const gone = new Set(a.tombstones().filter((t) => t.owner === owner).map((t) => t.name));
      for (let k = algorithm(p.name); k < algorithm(name); k++) {
        const other = await nameOf(genesis, k);
        if (!this.found.has(objectId(other, owner)) && !gone.has(other)) {
          this.add('warning', place, `renamed by algorithm ${algorithm(name)}, though algorithm ${k} gives a line free here (section 5.3)`, { object: id });
          break;
        }
      }
    }
    if (owner === o.rec?.originator) this.add('error', place, 'an originator never owns a branch of its own work (section 5.3)', { object: id });
  }

  async movedBranchPoint(id, o, ver, p, old, where) {
    const a = this.archive;
    const before = `v${versionNumber(ver) - 1}`;
    const read = async (v) => jsonOrNull(await a.bytes(id, o.inv, v, 'parent/inventory.json', this.options).catch((e) => { if (this.aborted(e)) throw e; return null; })) || {};
    const [oldInv, newInv] = [await read(before), await read(ver)];
    if (p.owner !== old.owner || p.name !== old.name) {
      this.add('error', where, 'a new branch point is a version of the same parent line (section 9.4)', { object: id, ver });
    } else if (versionNumber(p.objectVersion) <= versionNumber(old.objectVersion) || p.documentVersion === old.documentVersion) {
      this.add('error', where, 'a new branch point is a higher object version, holding another document version (section 9.4)', { object: id, ver });
    }
    const oldVersions = isObject(oldInv.versions) ? oldInv.versions : {};
    const newVersions = isObject(newInv.versions) ? newInv.versions : {};
    const manifest = isObject(newInv.manifest) ? newInv.manifest : {};
    if (oldInv.id !== newInv.id || Object.entries(oldVersions).some(([v, e]) => !same(newVersions[v], e)) ||
        Object.values(oldVersions).some((e) => Object.keys(isObject(e?.state) ? e.state : {}).some((d) => !Object.hasOwn(manifest, d)))) {
      this.add('error', where, 'the new parent inventory does not continue the previous one (section 9.4)', { object: id, ver });
    }
  }

  async members(id, o) {
    const a = this.archive;
    for (const ver of versionsOf(o.inv)) {
      this.cancelled();
      const at = `${this.where(id)} ${ver}`;
      const mem = await a.json(id, o.inv, ver, 'members.json', this.options).catch((e) => { if (this.aborted(e)) throw e; return null; });
      if (!mem) continue;
      this.schema(`${at}/members.json`, mem, 'collection', 'error', { object: id, ver });
      const type = mem.type;
      if (type !== 'catalogue' && type !== 'selection') this.add('error', at, 'members.json has no valid type (catalogue or selection)', { object: id, ver });
      for (const m of Array.isArray(mem.members) ? mem.members : []) {
        const mid = objectId(m?.name, m?.owner);
        const who = `${at} member ${this.where(mid)}`;
        const context = { object: id, ver };
        for (const message of memberErrors(type, m)) this.add('error', who, message, context);
        if (this.found.has(mid)) {
          await this.memberHeld(m, mid, who, type, context, ver === o.inv.head);
        } else if (ver === o.inv.head) {
          await this.memberElsewhere(m, mid, who, context);
        }
      }
    }
  }

  async memberHeld(m, mid, who, type, context, inHead = false) {
    const a = this.archive;
    const held = this.found.get(mid);
    const sts = this.statuses.get(mid) || [];
    for (const { version: pv, pin, documentVersion: n } of memberPins(m)) {
      this.report.stats.pins++;
      const k = typeof pv === 'string' && /^v[1-9][0-9]*$/.test(pv) ? versionNumber(pv) : 0;
      const digest = k ? held.digests[k - 1] : undefined;
      if (!digest) {
        this.add('warning', `${who} ${pv}`, 'unavailable: the copy held here lacks this version', context);
        continue;
      }
      if (digest !== pin) {
        this.add('error', `${who} ${pv}`, 'mismatch: the inventory held here has another digest (section 8.5)', context);
        continue;
      }
      const pobj = held.objs.get(pv) || {};
      if (pobj.kind !== m.kind || pobj.name !== m.name || pobj.owner !== m.owner) {
        this.add('error', `${who} ${pv}`, 'kind, name and owner are not those of the version pinned (section 8.5)', context);
      }
      if (n !== null && pobj.documentVersion !== n) this.add('error', `${who} ${pv}`, `does not hold document version ${n}`, context);
      const s = k <= sts.length ? sts[k - 1] : null;
      if (s === UNSIGNED || s === INVALID) this.add('error', `${who} ${pv}`, 'not a version: a collection pins only signed versions (section 8.5)', context);
      else if (s === UNCHECKED || s === CONTESTED) this.add('warning', `${who} ${pv}`, `${s} (section 8.5)`, context);
      const log = m.name === m.owner ? this.logs.get(m.owner) ?? null : null;
      if (log && !log.verified(k, pin)) {
        this.add('error', `${who} ${pv}`, 'not a version of the key log: a collection pins only versions (sections 6.1 and 8.5)', context);
      }
      const signed = latestSigned(sts);
      if (inHead && signed) {
        const withdrawn = withdrawnVersions(held.inv, (v) => held.objs.get(v) ?? null, `v${signed}`);
        if (withdrawn.has(pobj.documentVersion)) {
          this.add('result', `${who} ${pv}`, `document version ${pobj.documentVersion} is withdrawn, in ${withdrawn.get(pobj.documentVersion)} (section 13.1)`, context);
        }
      }
    }
    if (type === 'selection' && sts.length) {
      const signed = latestSigned(sts);
      const objOf = (v) => held.objs.get(v) ?? null;
      const order = historyOf(held.inv, objOf, signed ? `v${signed}` : held.inv.head).map((h) => objOf(h)?.documentVersion);
      const vetted = (Array.isArray(m.revisions) ? m.revisions : []).map((r) => r?.documentVersion);
      const pos = vetted.filter((x) => order.includes(x)).map((x) => order.indexOf(x));
      if (pos.some((p, i) => i > 0 && p < pos[i - 1])) this.add('error', who, 'revisions not in the order of the history (section 8.4)', context);
    }
  }

  async memberElsewhere(m, mid, who, context) {
    if (this.resolver) {
      for (const { version: pv, pin, documentVersion: n } of memberPins(m)) {
        this.report.stats.pins++;
        const res = await this.resolver.pin(m.name, m.owner, pv, pin, Array.isArray(m.at) ? m.at : [], this.options);
        if (res.copy) {
          const pobj = res.copy.obj(versionNumber(pv)) || {};
          if (pobj.kind !== m.kind || pobj.name !== m.name || pobj.owner !== m.owner || (n !== null && pobj.documentVersion !== n)) {
            this.add('error', `${who} ${pv}`, 'the version pinned is not of the kind, line and document version the ' +
              'member gives (section 8.5)', context);
          }
        }
        if (res.status === 'not a version') this.add('error', `${who} ${pv}`, 'not a version: a collection pins only signed versions (section 8.5)', context);
        else if (res.status === 'verified') this.add('result', `${who} ${pv}`, `verified at ${res.copy ? res.copy.where : '?'} (section 8.5)`, context);
        else this.add('warning', `${who} ${pv}`, `${res.status} (section 8.5)`, context);
        this.progress({ phase: 'members', done: this.report.stats.pins, total: this.report.stats.pins, current: mid });
      }
    } else if (this.tombstoned.has(mid)) {
      this.add('result', who, 'removed: a tombstone in this archive (section 13.3)', context);
    } else {
      this.add('warning', who, 'not held in this archive: not resolved (osheaf verify --remote resolves it, section 14.5)', context);
    }
  }

  status(id, o) {
    if (o.kind === 'owner') return 'active';
    const latest = o.line?.latest;
    return ((latest ? o.objs.get(latest) : o.objs.get(o.inv.head)) || {}).status ?? 'active';
  }

  async archiveAsAWhole() {
    const a = this.archive;
    const disc = a.disc;
    const listed = new Map();
    for (const e of a.listed()) {
      if (!isObject(e)) continue;
      if (listed.has(e.id)) this.add('error', 'opensheaf.json', `lists ${this.where(e.id)} twice`);
      listed.set(e.id, e);
    }
    const needed = new Set();
    for (const id of this.found.keys()) {
      const parts = parseId(id);
      if (parts && !parts.draft) needed.add(objectId(parts.owner, parts.owner));
    }
    for (const kid of needed) {
      if (this.found.has(kid) || listed.has(kid)) continue;
      const owner = parseId(kid).owner;
      const log = await a.keyLog(owner, this.options).catch((e) => { if (this.aborted(e)) throw e; return null; });
      if (log) this.add('error', 'opensheaf.json', `does not list ${this.where(kid)}, an object of the storage root (section 3.1)`);
    }
    const fields = ['kind', 'name', 'owner', 'head', 'inventorySha512', 'status'];
    for (const [id, o] of this.found) {
      if (o.draft) continue;
      const e = listed.get(id);
      if (!e) {
        this.add('error', 'opensheaf.json', `does not list ${this.where(id)}, an object of the storage root (section 3.1)`, { object: id });
        continue;
      }
      const expected = { kind: o.head?.kind ?? null, name: o.head?.name ?? null, owner: o.head?.owner ?? null,
                         head: o.inv.head, inventorySha512: o.sidecar, status: this.status(id, o) };
      const stale = fields.filter((k) => (e?.[k] ?? null) !== expected[k]);
      if (stale.length) {
        this.add('error', 'opensheaf.json', `the entry of ${this.where(id)} is stale: ` +
          stale.map((k) => `${k} ${py(e?.[k])} instead of ${py(expected[k])}`).join(', '), { object: id });
      }
    }
    const labels = [...listed.values()].map((e) => e.label).filter(Boolean);
    for (const lb of [...new Set(labels.filter((x, k) => labels.indexOf(x) !== k))].sort()) {
      this.add('error', 'opensheaf.json', `the label ${lb} is given twice (section 3.1)`);
    }
    if (!('owners' in disc)) {
      this.add('error', 'opensheaf.json', 'no owners: the owners hosted and their catalogues are not named (section 3.1)');
    }
    const seenOwners = new Set(), seenCatalogues = new Set();
    for (const e of Array.isArray(disc.owners) ? disc.owners : []) {
      if (!isObject(e)) continue;   // the schema reports it
      const o = e.owner, cat = e.catalogue;
      if (seenOwners.has(o)) this.add('error', 'opensheaf.json', `owners lists ${o} twice (section 3.1)`);
      if (seenCatalogues.has(cat)) this.add('error', 'opensheaf.json', `owners gives ${cat} as the catalogue of two owners (section 3.1)`);
      seenOwners.add(o);
      seenCatalogues.add(cat);
      if (typeof o !== 'string' || !OWNER_NAME.test(o)) continue;
      if (!this.found.has(objectId(o, o))) this.add('warning', 'opensheaf.json', `owners lists ${o}, whose key log is not held here (section 3.1)`);
      const entry = listed.get(cat) || {};
      if (entry.kind !== 'collection' || entry.owner !== o) {
        this.add('error', 'opensheaf.json', `the catalogue of ${o} in owners, ${cat}, is not a collection of that owner it lists (section 8.1)`);
        continue;
      }
      const held = this.found.get(cat);
      if (!held) continue;
      const mem = await a.json(cat, held.inv, held.inv.head, 'members.json', this.options).catch((e) => { if (this.aborted(e)) throw e; return null; }) || {};
      if (mem.type !== 'catalogue') {
        this.add('error', 'opensheaf.json', `the owner catalogue of ${o}, ${this.where(cat)}, is not a catalogue (section 8.1)`);
      }
      for (const m of Array.isArray(mem.members) ? mem.members : []) {
        if (this.tombstoned.has(`sheaf:${m?.name}:${m?.owner}`)) continue;   // taken down: section 13.2 asks for a version without it
        let mine = false;
        try {
          mine = m?.owner === o && m?.kind === 'document' && this.found.has(objectId(m?.name, o));
        } catch {
          mine = false;
        }
        if (!mine) {
          this.add('warning', 'opensheaf.json', `the owner catalogue of ${o} lists ${m?.name}, which is not a document of a line of that owner held here (section 8.1)`);
        }
      }
    }
    for (const d of Array.isArray(disc.drafts) ? disc.drafts : []) {
      const o = this.found.get(d?.id);
      if (!o || !o.draft || o.inv.head !== d.head) {
        this.add('error', 'opensheaf.json', `drafts lists ${d?.id}, which is not a draft held with that head`);
      }
    }
    const used = new Set();
    for (const o of this.found.values()) {
      if (isObject(o.head?.extensions)) for (const k of Object.keys(o.head.extensions)) used.add(k);
      if (o.kind === 'owner') {
        const log = this.logs.get(parseId(o.id).owner);
        const ext = log?.extensions();
        if (isObject(ext)) for (const k of Object.keys(ext)) used.add(k);
      }
    }
    const declared = Array.isArray(disc.extensions) ? disc.extensions : [];
    for (const e of [...used].filter((x) => !declared.includes(x)).sort()) {
      this.add('warning', 'opensheaf.json', `extensions does not list ${e}, which objects use (section 3.1)`);
    }
    const seen = new Set();
    for (const t of Array.isArray(disc.tombstones) ? disc.tombstones : []) {
      const tid = t?.id;
      if (tid !== objectId(t?.name, t?.owner)) this.add('error', 'opensheaf.json', `the tombstone ${tid} is not the line of its name and owner (section 13.3)`);
      if (seen.has(tid)) this.add('error', 'opensheaf.json', `two tombstones of ${tid}`);
      seen.add(tid);
      if (this.found.has(tid) || listed.has(tid)) {
        this.add('error', 'opensheaf.json', `${tid} has a tombstone, and is an object of the archive (section 13.3)`);
      } else if (t?.kind === 'owner' && needed.has(tid)) {
        this.add('warning', 'opensheaf.json', `a tombstone stands for the key log ${tid}, which lines of the archive ` +
          'need: only the law or its keeper justifies it (section 13.2)');
      } else {
        this.add('result', 'opensheaf.json', `removed: ${tid} (${py(t?.date)}: ${py(t?.reason)})`);
      }
    }
  }

  async indexes() {
    const a = this.archive;
    const declared = isObject(a.disc.indexes) ? a.disc.indexes : {};
    if (!Object.keys(declared).length) {
      this.add('warning', 'opensheaf.json', 'no indexes declared (section 12.5)');
      return;
    }
    const objects = [];
    for (const [id, o] of this.found) {
      if (o.draft) continue;
      if (o.kind === 'owner') {
        const log = this.logs.get(parseId(id).owner);
        if (!log) continue;
        objects.push({ id, rec: { kind: 'owner' }, genesis: log.genesis, status: 'active', label: a.labelOf(id),
                       sidecars: o.sidecars, carried: log.versions.filter((v) => v.forkRecord).flatMap((v) => v.carried) });
      } else if (o.rec) {
        objects.push({ id, rec: o.rec, genesis: o.genesis, status: this.status(id, o), label: a.labelOf(id), sidecars: o.sidecars });
      }
    }
    const expected = indexEntries(objects);
    const gone = new Map(a.tombstones().map((t) => [t.id, t]));
    const listedNames = [];
    const order = (x) => ['owners', 'names', 'sha512'].indexOf(x);
    for (const [index, length] of Object.entries(declared).sort(([x], [y]) => order(x) - order(y))) {
      if (!Object.hasOwn(INDEX_KEY, index)) continue;
      const key = INDEX_KEY[index];
      const want = expected[index];
      const prefixes = new Set(want.map((e) => String(e[key]).slice(0, length)));
      if (index === 'names') for (const n of listedNames) prefixes.add(n.slice(0, length));
      for (const t of gone.values()) {
        const k = index === 'names' ? t.name : index === 'owners' ? t.owner : t.inventorySha512;
        if (typeof k === 'string') prefixes.add(k.slice(0, length));
      }
      const held = [];
      for (const p of [...prefixes].sort()) {
        const place = `${index}/${p}.json`;
        let data;
        try {
          const bytes = await this.fetchOrNull(a.base + place);
          if (bytes === null) continue;
          data = parseJson(bytes);
        } catch (error) {
          if (this.aborted(error)) throw error;
          this.add('error', place, `not JSON: ${error.message}`);
          continue;
        }
        this.schema(place, data, 'index');
        if (data?.index !== index) this.add('error', place, `an index file of ${index}/ names the index ${data?.index}`);
        for (const e of Array.isArray(data?.entries) ? data.entries : []) {
          if (!isObject(e) || String(e[key] ?? '').slice(0, length) !== p || p.length !== length) {
            this.add('error', place, `an entry not in the file of its prefix (${JSON.stringify(e).slice(0, 60)}...)`);
          }
          held.push(e);
          if (index === 'owners' && Array.isArray(e?.names)) listedNames.push(...e.names.filter((n) => typeof n === 'string'));
        }
      }
      for (const e of want) {
        if (!held.some((x) => same(x, e))) {
          this.add('error', `${index}/`, `no entry, or a stale one, for ${e.id ?? e.owner} ${e.version ?? ''} (section 12.5)`);
        }
      }
      for (const e of held) {
        if (want.some((x) => same(x, e))) continue;
        if (gone.has(e?.id) && e?.status === 'removed') continue;
        this.add('error', `${index}/`, `an entry the storage root does not justify: ${e?.id ?? e?.owner} ${e?.version ?? ''} (section 12.5)`);
      }
      for (const [tid, t] of gone) {
        if ((index === 'names' || index === 'sha512') && !held.some((e) => e?.id === tid && e?.status === 'removed')) {
          this.add('error', `${index}/`, `no entry with the status removed for the tombstone ${tid} (section 12.5)`);
        }
        if (index === 'owners' && held.some((e) => e?.owner === t.owner && Array.isArray(e?.names) && e.names.includes(t.name))) {
          this.add('error', `${index}/`, `owners/ lists ${tid}, which is taken down (section 12.5)`);
        }
      }
    }
  }

  async presentation() {
    const a = this.archive;
    const website = Array.isArray(a.disc.profiles) && a.disc.profiles.includes('website');
    const home = await this.fetchOrNull(a.base + 'index.html', LIMITS.page).catch((e) => { if (this.aborted(e)) throw e; return null; });
    if (!website && home === null) return;
    const level = website ? 'error' : 'warning';
    const note = website ? '' : ' (the archive does not declare the profile website)';
    if (home === null) {
      this.add(level, 'index.html', 'the home page is missing (appendix A.3)' + note);
      return;
    }
    let members = [];
    for (const e of a.owners()) {
      const cat = this.found.get(e.catalogue);
      if (!cat?.line?.latest) continue;
      const mem = await a.json(cat.id, cat.inv, cat.line.latest, 'members.json', this.options).catch((e) => { if (this.aborted(e)) throw e; return null; });
      if (Array.isArray(mem?.members)) members = members.concat(mem.members);
    }
    const page = new TextDecoder().decode(home);
    for (const m of members) {
      const mid = objectId(m?.name, m?.owner);
      if (this.tombstoned.has(mid)) continue;
      const pins = memberPins(m);
      const pin = pins[pins.length - 1]?.pin || '';
      if (!page.includes(pin.slice(0, 32))) this.add(level, 'index.html', `does not show the pin of ${m?.name}` + note);
      if (!this.found.has(mid)) continue;
      const originator = this.found.get(mid).rec?.originator === m.owner;
      const landing = `paper/${originator ? m.name : `${m.name}-${m.owner}`}/index.html`;
      const text = await this.fetchOrNull(a.base + landing, LIMITS.page).catch((e) => { if (this.aborted(e)) throw e; return null; });
      const words = text ? new TextDecoder().decode(text) : '';
      if (originator ? !new RegExp(`sheaf:${m.name}(?![a-z0-9:/])`).test(words) : !words.includes(mid)) {
        this.add(level, landing, `no landing page giving the sheaf: URI of ${this.where(mid)} (appendix A.3)` + note);
      }
    }
  }

  async contentDigests() {
    const a = this.archive;
    const files = [];
    for (const [id, o] of this.found) {
      for (const [digest, paths] of Object.entries(o.inv.manifest)) {
        for (const cp of Array.isArray(paths) ? paths : []) {
          try {
            files.push({ id, url: a.contentUrl(id, o.inv, cp), cp, digest });
          } catch {
            const outside = typeof cp !== 'string' || !cp || cp.startsWith('/') || cp.includes('\\') ||
              cp.split('/').some((p) => ['', '.', '..'].includes(p));
            this.add('error', this.where(id), outside
              ? `the content path ${JSON.stringify(cp).replace(/^"(.*)"$/, "'$1'")} is not a relative path inside ` +
                'the object (section 4.1): it is not read, nor the object checked further'
              : `missing ${cp}`, { object: id });
          }
        }
      }
    }
    let checked = 0;
    this.progress({ phase: 'digests', done: 0, total: files.length });
    await Promise.all(files.map(async ({ id, url, cp, digest }) => {
      const place = this.where(id);
      try {
        const bytes = await this.http.request(url, { limit: LIMITS.file, signal: this.options.signal });
        this.report.stats.files++;
        this.report.stats.filesBytes += bytes.length;
        if (await sha512(bytes) !== digest) this.add('error', place, `${cp} does not have the digest of the manifest`, { object: id });
      } catch (error) {
        if (this.aborted(error)) throw error;
        if (error.kind === 'not-found') this.add('error', place, `missing ${cp}`, { object: id });
        else if (error.kind === 'too-large') this.add('warning', place, `${cp} is too large to be checked in the browser`, { object: id });
        else this.add('error', place, `${cp} cannot be read (${error.detail})`, { object: id });
      }
      this.progress({ phase: 'digests', done: ++checked, total: files.length, current: cp });
    }));
  }
}

export const RESERVED = ['object.json', 'datacite.json', 'genesis.json', 'members.json', 'keys.json', 'forked', 'parent'];

export function reservedNameErrors(obj, logical) {
  const out = [];
  for (const p of [...logical].sort()) {
    const top = p.split('/')[0];
    if (!RESERVED.includes(top)) continue;
    if (p === top && ['object.json', 'datacite.json', 'genesis.json'].includes(top)) continue;
    if (p === top && top === 'members.json' && obj?.kind === 'collection') continue;
    if (top === 'parent' && p !== top && isObject(obj) && 'parent' in obj) continue;
    out.push(`${p}: the name ${top} is reserved for the file section 4.1 defines`);
  }
  return out;
}

function isEvidencePath(p) {
  return p.startsWith('parent/');
}

function sameBytes(x, y) {
  if (x.length !== y.length) return false;
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
  return true;
}

function py(value) {
  return value === null || value === undefined ? 'None' : String(value);
}

export async function estimateContent(archive, { signal, progress = () => {} } = {}) {
  const options = { signal };
  const files = [];
  for (const entry of [...archive.objects(), ...archive.drafts()]) {
    try {
      const inv = await archive.inventory(entry.id, null, options);
      for (const paths of Object.values(inv.manifest)) {
        for (const cp of Array.isArray(paths) ? paths : []) {
          try {
            files.push(archive.contentUrl(entry.id, inv, cp));
          } catch {
            // unsafe: not fetched
          }
        }
      }
    } catch (error) {
      if (error.kind === 'aborted') throw error;
    }
  }
  const http = archive.http.another({ budget: null });
  let bytes = 0, unknown = 0, done = 0;
  await Promise.all(files.map(async (url) => {
    try {
      const size = await http.size(url, options);
      if (size === null) unknown++;
      else bytes += size;
    } catch (error) {
      if (error.kind === 'aborted') throw error;
      unknown++;
    }
    progress({ phase: 'sizes', done: ++done, total: files.length });
  }));
  return { files: files.length, bytes, unknown };
}
