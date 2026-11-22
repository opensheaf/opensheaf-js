// Generated from literate/46-zenodo.md by opensheaf-literate: edit the document, not this file.
import { pathOf, LAYOUT_FILE } from './paths.js';
import { validate } from './schema.js';
import { dateOf, currentVersion, historyOf } from './versions.js';
import { CONTESTED } from './signatures.js';
import { jsonBytes, md5hex, sha512hex } from './write.js';
import { joinPath, readJson, compareText, MemoryStorage } from './storage.js';
import { ArchiveFolder, OBJ, OBJ_FORMAT, exit, removeStage } from './folder.js';
import { carryForward, setDate, landingUrl } from './deposit.js';
import { lineOf } from './describe.js';
import { writeDiscovery } from './discovery.js';
import { signAgain } from './owner.js';

export const SERVICES = {
  false: { api: 'https://sandbox.zenodo.org/api', records: 'https://sandbox.zenodo.org/records/',
           token: 'zenodo-sandbox-token', env: 'ZENODO_SANDBOX_TOKEN', prefix: '10.5072' },
  true: { api: 'https://zenodo.org/api', records: 'https://zenodo.org/records/',
          token: 'zenodo-token', env: 'ZENODO_TOKEN', prefix: '10.5281' },
};
export const SERVICE_NAME = 'Zenodo';
export const MAX_FILES = 100;
export const METADATA_FILES = ['datacite.json', 'object.json'];

export class ZenodoError extends Error {}

export class Zenodo {
  constructor({ production, token, fetch = globalThis.fetch?.bind(globalThis), api = null }) {
    this.production = production;
    this.s = { ...SERVICES[production] };
    if (api) this.s.api = api.replace(/\/+$/, '');
    if (!token) exit(`no Zenodo token: set ${this.s.env}, or store it under the name ${this.s.token} (see osheaf zenodo --help)`);
    this.token = token;
    this.fetch = fetch;
  }

  async call(method, url, data = null, raw = null) {
    if (!url.startsWith('http')) url = this.s.api + url;
    const body = raw !== null ? raw : (data !== null ? JSON.stringify(data) : undefined);
    const r = await this.fetch(url, { method, body, headers: {
      Authorization: `Bearer ${this.token}`, 'Content-Type': raw !== null ? 'application/octet-stream' : 'application/json',
      Accept: 'application/json' } });
    const text = await r.text();
    if (!r.ok) throw new ZenodoError(`Zenodo ${method} ${url}: ${r.status} ${text.slice(0, 1000)}`);
    return text ? JSON.parse(text) : null;
  }

  doi(recid) {
    return `${this.s.prefix}/zenodo.${recid}`;
  }
}

export const PUBLICATION_TYPES = { Preprint: 'preprint', JournalArticle: 'article', Book: 'book', BookChapter: 'section',
                                   Dissertation: 'thesis', Report: 'report', ConferencePaper: 'conferencepaper', Text: 'other' };
export const SCHEMES = { arXiv: 'arxiv', DOI: 'doi', URL: 'url', Handle: 'handle', ISBN: 'isbn', ISSN: 'issn', PMID: 'pmid',
                         SWHID: 'swh' };
export const OPEN_LICENCES = new Set(['cc-by-4.0', 'cc-by-sa-4.0', 'cc-by-nc-4.0', 'cc-by-nd-4.0', 'cc-by-nc-sa-4.0',
                                      'cc-by-nc-nd-4.0', 'cc0-1.0', 'mit', 'apache-2.0', 'gpl-3.0-or-later']);

export function htmlEscape(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]);
}

export function zenodoMetadata(dc, archive, id) {
  const creators = dc.creators.map((c) => {
    const z = { name: c.name };
    const affs = (c.affiliation || []).map((a) => (typeof a === 'object' && a !== null ? a.name : a));
    if (affs.length) z.affiliation = affs.join('; ');
    for (const ni of c.nameIdentifiers || []) {
      if (ni.nameIdentifierScheme === 'ORCID') z.orcid = ni.nameIdentifier.split('/').pop();
    }
    return z;
  });
  const abstract = (dc.descriptions || []).find((d) => d.descriptionType === 'Abstract')?.description ?? null;
  const description = abstract ? abstract.split('\n\n').map((p) => `<p>${htmlEscape(p.trim())}</p>`).join('')
    : `<p>${htmlEscape(dc.titles[0].title)}</p>`;
  const dates = Object.fromEntries((dc.dates || []).map((d) => [d.dateType, d.date]));
  const rights = (dc.rightsList || [{}])[0];
  const licence = (rights.rightsIdentifier || '').toLowerCase();
  const m = {
    upload_type: 'publication',
    publication_type: PUBLICATION_TYPES[dc.types.resourceTypeGeneral] || 'other',
    title: dc.titles[0].title,
    creators,
    description,
    access_right: 'open',
    license: OPEN_LICENCES.has(licence) ? licence : 'other-closed',
    version: dc.version,
    publication_date: (dates.Issued || dates.Available).slice(0, 10),
    notes: `Deposited from the OpenSheaf archive ${archive.name} (${archive.baseUrl}), line ${id}, document version ` +
           `${dc.version}. Rights: ${rights.rights ?? 'see the files'}.`,
  };
  if (dc.language === 'en') m.language = 'eng';
  const keywords = (dc.subjects || []).map((s) => s.subject);
  if (keywords.length) m.keywords = keywords;
  const related = [{ identifier: dc.url, relation: 'isIdenticalTo', scheme: 'url' }];
  for (const r of dc.relatedIdentifiers || []) {
    const rel = r.relationType;
    if (['IsVersionOf', 'IsNewVersionOf', 'IsPreviousVersionOf'].includes(rel) && r.relatedIdentifier.includes('zenodo')) continue;
    const scheme = SCHEMES[r.relatedIdentifierType];
    if (scheme) related.push({ identifier: r.relatedIdentifier, relation: rel[0].toLowerCase() + rel.slice(1), scheme });
  }
  m.related_identifiers = related;
  return m;
}

export function zenodoEntries(obj) {
  return (obj.external || []).filter((e) => e.service === SERVICE_NAME && e.role === 'deposit');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateStream(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function reproducibleZip(files, deflateRaw = null) {
  const deflate = deflateRaw || deflateStream;
  const encoder = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const names = [...files.keys()].sort((a, b) => compareBytes(encoder.encode(a), encoder.encode(b)));
  for (const name of names) {
    const data = files.get(name), packed = await deflate(data), nameBytes = encoder.encode(name);
    const flags = /^[\x00-\x7f]*$/.test(name) ? 0 : 0x800;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, 8, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, (0 << 9) | (1 << 5) | 1, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, (3 << 8) | 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, flags, true);
    entry.setUint16(10, 8, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, (0 << 9) | (1 << 5) | 1, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, packed.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(38, (0o644 << 16) >>> 0, true);
    entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, packed);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, names.length, true);
  end.setUint16(10, names.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of all) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

function compareBytes(a, b) {
  for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) return a[k] - b[k];
  return a.length - b.length;
}

export function quote(name) {
  return [...new TextEncoder().encode(name)].map((b) => (/[A-Za-z0-9_.\-~/]/.test(String.fromCharCode(b)) ? String.fromCharCode(b)
    : '%' + b.toString(16).toUpperCase().padStart(2, '0'))).join('');
}

export async function uploadPlan(files, obj, deflateRaw) {
  if (![...files.keys()].some((n) => n.includes('/')) && files.size <= MAX_FILES) return { plan: new Map(files), extra: [] };
  const keep = new Set([...METADATA_FILES, ...(obj.renditions || []).map((r) => r.path)]);
  if ([...keep].some((n) => n.includes('/'))) exit('renditions in sub-folders cannot be uploaded to Zenodo');
  const sources = new Map([...files].filter(([n]) => !keep.has(n)));
  const zip = await reproducibleZip(sources, deflateRaw);
  const plan = new Map([...files].filter(([n]) => keep.has(n)));
  plan.set('sources.zip', zip);
  return { plan, extra: [{ name: 'sources.zip', sha512: await sha512hex(zip), md5: await md5hex(zip), bytes: zip.length }] };
}

export function noticeFiles(obj) {
  const paths = new Set((obj.notices || []).filter((n) => n.path).map((n) => n.path));
  const reason = obj.withdrawal?.reason || {};
  if (reason.path) paths.add(reason.path);
  return paths;
}

export function previousRecord(inv, objs, docVersion, signed) {
  const hist = historyOf(inv, (v) => objs.get(v), signed);
  const docs = hist.map((v) => objs.get(v).documentVersion);
  const before = docs.includes(docVersion) ? docs.slice(0, docs.indexOf(docVersion)) : docs;
  const versions = Object.keys(inv.versions).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  for (const n of [...before].reverse()) {
    for (const v of versions) {
      const obj = objs.get(v);
      if (obj.documentVersion === n && zenodoEntries(obj).length) {
        const e = zenodoEntries(obj)[0];
        return [e.record.replace(/\/+$/, '').split('/').pop(), e.doi];
      }
    }
  }
  return [null, null];
}

export async function commit(f, id, stage, state) {
  const label = f.labelOf(id) || id;
  let inv;
  if (state.phase === 'published') {
    inv = await f.installVersion(id, joinPath(stage, 'version'));
    state.phase = 'added';
    await f.storage.write(joinPath(stage, 'state.json'), jsonBytes(state));
  } else {
    inv = await f.inventory(await f.dirOf(id));
  }
  const ver = state.version || inv.head;
  f.changed();
  const { statuses } = await f.line(id);
  if (statuses[Number(ver.slice(1)) - 1] === CONTESTED) {
    f.env.out(`${label}: ${ver} is contested (a key that signed it was exposed): signing it again`);
    await signAgain(f, { label: id, version: ver, yes: true });
  }
  await writeDiscovery(f);
  await removeStage(f.storage, stage);
  f.changed();
  f.env.out(`${label}: ${ver} added, DOI ${state.doi}`);
}

export function checkDepositRecord(obj, doi, schemas = null) {
  const problems = [];
  const schema = schemas?.[OBJ_FORMAT];
  if (schema) for (const e of validate(schema, obj)) problems.push(`${e.path ? e.path + ': ' : ''}${e.message}`);
  for (const e of obj.external || []) {
    if (!['role', 'service', 'record'].every((k) => typeof e[k] === 'string' && e[k])) {
      problems.push(`an external entry lacks role, service or record: ${JSON.stringify(e)}`);
    } else if (!['deposit', 'source'].includes(e.role) || !e.record.startsWith('https://')) {
      problems.push(`an external entry with a bad role or record: ${JSON.stringify(e)}`);
    }
    if ('doi' in e && !/^10\.[0-9]+(\.[0-9]+)*\/\S+$/.test(String(e.doi))) problems.push(`an external entry with a malformed DOI: ${e.doi}`);
  }
  if (!zenodoEntries(obj).some((e) => e.doi === doi)) problems.push(`no external entry of the deposit of ${doi}`);
  if (problems.length) exit('the object version built is malformed: ' + problems.join('; '));
}

export async function deposit(f, label, z) {
  const out = (line) => f.env.out(line);
  const id = await lineOf(f, label);
  label = f.labelOf(id) || id.split(':')[1];
  const dir = await f.dirOf(id);
  const inv = await f.inventory(dir);
  if (inv === null) exit(`no line ${label}`);
  const stage = joinPath('zenodo-staging', ...(await pathOf(id, f.layout)));
  const statePath = joinPath(stage, 'state.json');
  const pending = await readJson(f.storage, statePath);
  if (pending) {
    if (pending.phase === 'published' || pending.phase === 'added') {
      out(`${label}: completing the object version of record ${pending.record}`);
      return commit(f, id, stage, pending);
    }
    out(`${label}: discarding the unpublished draft ${pending.record}`);
    try {
      await z.call('DELETE', `/deposit/depositions/${pending.record}`);
    } catch (e) {
      if (!(e instanceof ZenodoError)) throw e;
      out(`  (could not discard: ${e.message})`);
    }
    await removeStage(f.storage, stage);
  }

  const objs = new Map();
  for (const ver of Object.keys(inv.versions)) objs.set(ver, await f.readObjectJson(dir, inv, OBJ, ver));
  const headObj = objs.get(inv.head);
  if (headObj.kind !== 'document') exit(`${label} is not a document`);
  if (headObj.parent) exit(`${label} is a branch (section 9), which these tools do not deposit on Zenodo yet`);
  const signed = await f.latestSigned(id);
  if (signed === null) exit(`${label} has no signed version that is not contested (section 7.3): nothing is deposited`);
  const stateObj = objs.get(signed);
  if (stateObj.status !== 'active') exit(`${label} is withdrawn`);
  const cur = currentVersion(inv, (v) => objs.get(v), signed);
  const obj = JSON.parse(JSON.stringify(objs.get(cur)));
  const dc = await f.readObjectJson(dir, inv, 'datacite.json', cur);
  const docVersion = obj.documentVersion;
  if (zenodoEntries(obj).length) {
    exit(`${label}: document version ${docVersion} is already on Zenodo (${zenodoEntries(obj)[0].doi})`);
  }

  const [prevRec, prevDoi] = previousRecord(inv, objs, docVersion, signed);
  let draft;
  if (prevRec) {
    const nv = await z.call('POST', `/deposit/depositions/${prevRec}/actions/newversion`);
    draft = await z.call('GET', nv.links.latest_draft);
    for (const file of draft.files || []) await z.call('DELETE', `/deposit/depositions/${draft.id}/files/${file.id}`);
  } else {
    draft = await z.call('POST', '/deposit/depositions', {});
  }
  const recid = draft.id;
  const concept = draft.conceptrecid;
  const doi = z.doi(recid);
  const conceptDoi = concept ? z.doi(concept) : null;

  const state = { phase: 'draft', record: recid, doi, documentVersion: docVersion };
  await f.storage.write(statePath, jsonBytes(state));
  let pub;
  try {
    const files = new Map();
    for (const paths of Object.values(inv.versions[cur].state)) {
      for (const lp of paths) if (!METADATA_FILES.includes(lp)) files.set(lp, await f.readLogical(dir, inv, lp, cur));
    }
    const skip = noticeFiles(stateObj);
    for (const n of stateObj.notices || []) {
      if (n.path && !files.has(n.path)) files.set(n.path, await f.readLogical(dir, inv, n.path, signed));
    }
    const today = f.env.today();
    dc.doi = doi;
    dc.url = dc.url || await landingUrl(f, id);
    const rel = (dc.relatedIdentifiers || []).filter((r) => !(['IsVersionOf', 'IsNewVersionOf'].includes(r.relationType) &&
                                                               r.relatedIdentifier.includes('zenodo')));
    if (conceptDoi) rel.push({ relatedIdentifier: conceptDoi, relatedIdentifierType: 'DOI', relationType: 'IsVersionOf' });
    if (prevDoi) rel.push({ relatedIdentifier: prevDoi, relatedIdentifierType: 'DOI', relationType: 'IsNewVersionOf' });
    dc.relatedIdentifiers = rel;
    if (!dateOf(dc, 'Available')) setDate(dc, 'Available', today);
    setDate(dc, 'Updated', today);
    const upload = new Map([...files].filter(([lp]) => !skip.has(lp)));
    const { plan, extra } = await uploadPlan(upload, obj, f.env.deflateRaw);
    const entry = { role: 'deposit', service: SERVICE_NAME, record: `${z.s.records}${recid}`, doi };
    if (extra.length) entry.files = extra;
    obj.external = [...(obj.external || []), entry];
    delete obj.notices;
    delete obj.history;
    await carryForward(f, stateObj, obj, dir, inv, `v${Number(inv.head.slice(1)) + 1}`);
    const content = new Map(files);
    content.set('datacite.json', jsonBytes(dc));
    const staged = await f.addVersion(id, content, obj, `Zenodo: document version ${docVersion}, DOI ${doi}`,
                                      { stageIn: joinPath(stage, 'version') });
    const ver = staged.head;
    const stagedFile = async (logical) => {
      const cp = f.contentPath(staged, ver, logical);
      return f.storage.read(cp.startsWith(`${ver}/`) ? joinPath(stage, 'version', cp) : joinPath(dir, cp));
    };
    const stagedObj = JSON.parse(new TextDecoder().decode(await stagedFile(OBJ)));
    checkDepositRecord(stagedObj, doi, f.env.schemas);
    plan.set('datacite.json', await stagedFile('datacite.json'));
    plan.set(OBJ, await stagedFile(OBJ));
    Object.assign(state, { phase: 'staged', version: ver });
    await f.storage.write(statePath, jsonBytes(state));

    const bucket = draft.links.bucket;
    for (const [name, data] of [...plan].sort(([a], [b]) => compareText(a, b))) {
      let expect;
      if (name === 'sources.zip') {
        expect = extra[0].md5;
      } else {
        const cp = f.contentPath(staged, ver, name);
        expect = Object.entries(staged.fixity?.md5 || {}).find(([, ps]) => ps.includes(cp))?.[0];
        if (!expect) exit(`the inventory records no MD5 of ${name} (appendix A.1)`);
      }
      if ((await md5hex(data)) !== expect) exit(`${name} does not have the MD5 the inventory records`);
      const r = await z.call('PUT', `${bucket}/${quote(name)}`, null, data);
      if (r?.checksum !== `md5:${expect}`) exit(`checksum of ${name}: Zenodo ${r?.checksum ?? 'None'}, inventory md5:${expect}`);
      out(`  uploaded ${name} (md5 ${expect})`);
    }
    await z.call('PUT', `/deposit/depositions/${recid}`, { metadata: zenodoMetadata(dc, f.archive, id) });
    state.phase = 'uploaded';
    await f.storage.write(statePath, jsonBytes(state));

    pub = await z.call('POST', `/deposit/depositions/${recid}/actions/publish`);
  } catch (error) {
    out(`${label}: failed before publication; discarding draft ${recid}`);
    try {
      await z.call('DELETE', `/deposit/depositions/${recid}`);
    } catch (e) {
      if (!(e instanceof ZenodoError)) throw e;
      out(`  (could not discard: ${e.message})`);
    }
    await removeStage(f.storage, stage);
    f.changed();
    throw error;
  }
  state.phase = 'published';
  await f.storage.write(statePath, jsonBytes(state));
  if (pub?.doi !== doi) {
    exit(`Zenodo published DOI ${pub?.doi ?? 'None'}, not the reserved ${doi}; the staging folder ${stage} is kept: ` +
         'the version built there records the reserved DOI');
  }
  out(`${label}: published ${doi} (concept ${pub.conceptdoi ?? 'None'})`);
  await commit(f, id, stage, state);
}

export async function zenodoCommand(f, args, z) {
  if (args.production) return deposit(f, args.label, z);
  const id = await lineOf(f, args.label);
  const owner = id.split(':')[2];
  const copy = f.env.sandbox ? await f.env.sandbox() : { storage: new MemoryStorage(), where: '(memory)', remove: async () => {} };
  for (const oid of [id, `sheaf:${owner}:${owner}`]) {
    const dir = await f.dirOf(oid);
    if (await f.storage.kind(dir)) await copyTree(f.storage, copy.storage, dir);
  }
  for (const name of ['0=ocfl_1.1', 'ocfl_layout.json', LAYOUT_FILE]) {
    const bytes = await f.storage.read(`ocfl/${name}`);
    if (bytes !== null) await copy.storage.write(`ocfl/${name}`, bytes);
  }
  const g = new ArchiveFolder(copy.storage, f.env);
  Object.assign(g, { archive: f.archive, index: f.index, labels: new Map(f.labels), tombstones: [...f.tombstones],
                     layout: f.layout, old: false });
  try {
    f.env.out(`sandbox: working on a copy in ${copy.where}`);
    await deposit(g, args.label, z);
    const dir = await g.dirOf(id);
    const inv = await g.inventory(dir);
    f.env.out(JSON.stringify((await g.readObjectJson(dir, inv, OBJ)).external, null, 2));
    f.env.out('statuses: ' + (await g.line(id)).statuses.join(', '));
  } finally {
    if (args.keep) f.env.out(`sandbox copy kept in ${copy.where}`);
    else await copy.remove();
  }
}

async function copyTree(from, to, dir) {
  for (const entry of (await from.list(dir)) || []) {
    const p = joinPath(dir, entry.name);
    if (entry.kind === 'dir') await copyTree(from, to, p);
    else if (entry.kind === 'file') await to.write(p, await from.read(p));
  }
}
