// Generated from literate/28-verify-folder.md by opensheaf-literate: edit the document, not this file.
import { Http, FetchError, nesting, parseFormat, LIMITS, sha512 } from './http.js';
import { Archive } from './archive.js';
import { verify, Report } from './verify.js';
import { finding, schemaFindings } from './rules.js';
import { storageFetch, storageLister, readJson, joinPath, ORIGIN } from './storage.js';
import { ROTATION_FORMAT, SHEET_TITLE } from './keys.js';
import { unbase64 } from './crypto.js';
import { objectId, parseId, isObject } from './names.js';
import { memberPins } from './versions.js';
import { ArchiveFolder, environment } from './folder.js';
import { nameAddress } from './deposit.js';
import { keeperOf, keeperLink, successorClaim, NOT_CHECKED } from './keepers.js';
import { pathOf } from './paths.js';
import { validateObject, validateStorageRoot } from './ocfl.js';

export async function verifyFolder(storage, { schemas, remote = false, fetch = globalThis.fetch,
                                              digests = true, fetchJson = null } = {}) {
  let base = ORIGIN;
  try {
    const cfg = await readJson(storage, 'osheaf.json');
    if (typeof cfg?.baseUrl === 'string' && /^https?:\/\/[^/]+\/(.*\/)?$/.test(cfg.baseUrl)) base = cfg.baseUrl;
  } catch {
    // a configuration that cannot be read gives no base URL
  }
  const http = new Http({ fetch: storageFetch(storage, base, { fallback: remote ? fetch : null }), budget: null });
  let archive, unread = null;
  try {
    archive = await Archive.open(http, base);
  } catch (error) {
    if (!(error instanceof FetchError) || error.kind === 'aborted') throw error;
    unread = finding('error', 'opensheaf.json', error.kind === 'not-found'
      ? 'the discovery document is missing (section 3.1)'
      : error.detail === 'is not a JSON object' ? 'the discovery document is a JSON object (section 3.1)'
        : await formatProblem(storage, error));
  }
  if (archive && !archive.old) {
    try {
      parseFormat(await storage.read('opensheaf.json'));
    } catch (error) {
      unread = finding('error', 'opensheaf.json', error.message);
    }
  }
  const f = archive?.old ? null : await folderOf(storage);
  if (unread) {
    const lenient = archive;
    archive = new Archive(http, base, { specification: '0.2', storageRoot: 'ocfl/', storageLayout: f?.layout });
    archive.unreadDiscovery = true;
    if (lenient) archive.labelOf = (id) => lenient.labelOf(id);
  }
  archive.lister = storageLister(storage, base);
  const linked = [];
  if (f) {
    archive.unlisted = await unlistedObjects(f, archive);
    archive.contentProblems = await contentProblems(f);
    for (const { id, dir } of await f.objects()) {
      if (!(await holdsLink(storage, dir))) continue;
      linked.push(finding('warning', dir, 'an object holding a symbolic link: not read, nor given to the OCFL validator ' +
                          '(section 15.2)'));
      if (typeof id === 'string') (archive.linkedObjects ??= new Set()).add(id);
    }
  }
  const report = await verify(archive, { schemas, remote, digests, pages: false });
  report.add(...linked);
  if (unread && (await storage.kind('opensheaf.json')) !== 'link') report.add(unread);
  if (!archive.old && f) {
    report.add(...await guarded('the keepers', () => keeperFindings(f, remote, fetchJson, schemas)));
    report.add(...await guarded('the presentation files', () => presentationFindings(f, unread ? {} : archive.disc)));
    report.add(...await guarded('the storage root', () => ocflFindings(f, report)));
  }
  if (!report.findings.some((f) => f.message === 'specification 0.1: rebuild (section 16.1)')) {
    report.add(...await lookForKeys(storage));
    const said = new Set(report.findings.map((x) => `${x.place}\n${x.message}`));
    report.add(...(await lookForLinks(storage)).filter((x) => !said.has(`${x.place}\n${x.message}`)));
  }
  return report;
}

async function formatProblem(storage, error) {
  try {
    parseFormat(await storage.read('opensheaf.json'));
  } catch (problem) {
    return problem.message;
  }
  return `not JSON: ${error.detail}`;
}

async function guarded(what, step) {
  try {
    return await step();
  } catch (error) {
    if (error?.kind === 'aborted') throw error;
    return [finding('error', 'archive', `the checks of ${what} stopped on a file they cannot read ` +
                    `(${error?.constructor?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 300)}); ` +
                    'the rest of them are not made')];
  }
}

async function unlistedObjects(f, archive) {
  const listed = new Set([...archive.objects().map((o) => o.id), ...archive.drafts().map((d) => d.id)]);
  const out = [];
  for (const { id } of await f.objects()) {
    if (typeof id === 'string' && parseId(id) && !listed.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

async function contentProblems(f) {
  const out = new Map();
  for (const { id, dir, inv } of await f.objects()) {
    if (typeof id !== 'string' || out.has(id) || !isObject(inv?.manifest)) continue;
    const found = new Map();
    for (const paths of Object.values(inv.manifest)) {
      for (const cp of Array.isArray(paths) ? paths : []) {
        const problem = await f.contentProblem(dir, cp);
        if (problem && !found.has(cp)) found.set(cp, problem);
      }
    }
    if (found.size) out.set(id, found);
  }
  return out;
}

async function folderOf(storage) {
  try {
    return await ArchiveFolder.open(storage, environment({ out: () => {}, err: () => {} }));
  } catch {
    return null;
  }
}

export function findingsJson(report) {
  return report.findings.map((f) => ({ severity: f.level, place: f.place, message: f.message }));
}

export async function keeperFindings(f, remote, fetchJson = null, schemas = {}) {
  const out = [];
  for (const { id, dir, inv } of await f.objects()) {
    if (!inv || typeof id !== 'string') continue;
    let kind;
    try {
      kind = (await f.readObjectJson(dir, inv, 'object.json'))?.kind;
    } catch {
      continue;
    }
    if (kind !== 'owner') continue;
    let log;
    try {
      log = await f.keyLog(id.split(':')[2]);
    } catch {
      continue;
    }
    const keeper = log ? await keeperOf(log) : null;
    if (!keeper) continue;
    const place = `owner ${log.owner}`;
    if (!remote) {
      out.push(finding('result', place, `keeper ${keeper}: not checked (osheaf verify --remote reads its ORCID ` +
                                        'record or domain, section 6.6)'));
      continue;
    }
    const link = await keeperLink(log, fetchJson);
    if (link.status === NOT_CHECKED) {
      out.push(finding('warning', place, `keeper ${keeper}: not checked (${link.reason})`));
      continue;
    }
    if (link.document) out.push(...schemaFindings(`${place} keeper ${keeper}`, link.document, schemas['opensheaf-keeper/0.2']));
    out.push(finding('result', place, `keeper ${keeper}: ${link.status} (${link.reason}; section 6.6)`));
    const claim = successorClaim(log, link);
    if (claim) out.push(finding('result', place, `successor ${link.successor} ${claim}`));
  }
  return out;
}

export async function presentationFindings(f, disc) {
  const out = [];
  const profiles = Array.isArray(disc.profiles) ? disc.profiles : [];
  const website = profiles.includes('website');
  const home = await f.storage.read('index.html');
  const landingPages = profiles.includes('texmacs') || Boolean(f.index.html || f.index.template) ||
    (await f.storage.kind('paper')) === 'dir';
  if (!(website || home || landingPages)) return out;
  const level = website ? 'error' : 'warning';
  const note = website ? '' : ' (the archive does not declare the profile website)';
  const report = (place, message) => out.push(finding(level, place, message + (website ? '' : note)));
  let members = [];
  for (const owner of f.archiveOwners()) {
    const cid = f.catalogues.get(owner);
    if (!cid) continue;
    const dir = await f.dirOf(cid);
    const inv = await f.inventory(dir);
    const ver = inv ? await f.latestSigned(cid).catch(() => null) : null;
    if (ver) members = members.concat((await f.readObjectJson(dir, inv, 'members.json', ver))?.members || []);
  }
  const page = home ? new TextDecoder().decode(home) : null;
  if (page === null && website) out.push(finding(level, 'index.html', 'the home page is missing (appendix A.3)'));
  const gone = new Set(f.tombstones.map((t) => t.id));
  for (const m of members) {
    const id = objectId(m?.name, m?.owner);
    if (gone.has(id)) continue;
    const pins = memberPins(m);
    const pin = pins[pins.length - 1]?.pin || '';
    if (page !== null && !page.includes(pin.slice(0, 32))) report('index.html', `does not show the pin of ${m?.name}`);
    let dir;
    try {
      dir = await f.dirOf(id);
    } catch {
      continue;
    }
    if ((await f.storage.kind(joinPath(dir, 'inventory.json'))) !== 'file') continue;
    const landing = `paper/${await nameAddress(f, id)}/index.html`;
    const bytes = await f.storage.read(landing);
    const text = bytes ? new TextDecoder().decode(bytes) : '';
    if (!(await landingNames(f, text, m.name, m.owner, id, dir))) {
      report(landing, `no landing page giving the sheaf: URI of ${where(f, id)} (appendix A.3)`);
    } else {
      const missing = landingDescriptionGaps(text);
      if (missing.length) report(landing, `the landing page of ${where(f, id)} lacks ${missing.join(', ')} (appendix A.3)`);
    }
  }
  return out;
}

export function landingDescriptionGaps(text) {
  const rels = new Set([...text.matchAll(/<link rel="([a-z-]+)"/g)].map((m) => m[1]));
  const missing = ['cite-as', 'describedby', 'type'].filter((r) => !rels.has(r)).map((r) => `the Signposting link ${r}`);
  const record = /<script type="application\/ld\+json">([^]*?)<\/script>/.exec(text);
  let ld = null;
  try {
    ld = record && nesting(record[1]) <= LIMITS.nesting ? JSON.parse(record[1]) : null;
  } catch {
    ld = null;
  }
  if (!ld || typeof ld !== 'object' || Array.isArray(ld) || !ld['@type'] || !ld.identifier ||
      (Array.isArray(ld.identifier) && !ld.identifier.length)) {
    missing.push('a schema.org record in JSON-LD with a type and identifiers');
  }
  return missing;
}

function where(f, id) {
  const parts = (id || '').split(':');
  if (parts.length === 3 && parts[1] === parts[2]) return `owner ${parts[1]}`;
  return f.labelOf(id) || id || '?';
}

async function landingNames(f, text, name, owner, id, dir) {
  const short = new RegExp(`sheaf:${name}(?![a-z0-9:/])`).test(text), long = text.includes(`sheaf:${name}:${owner}`);
  let g = null;
  try {
    const inv = await f.inventory(dir);
    const digest = Object.entries(inv?.versions?.v1?.state ?? {}).find(([, ps]) => Array.isArray(ps) && ps.includes('genesis.json'))?.[0];
    g = typeof digest === 'string' ? await f.readLogical(dir, inv, 'genesis.json', 'v1') : null;
    if (g && (await sha512(g)) !== digest.toLowerCase()) g = null;
  } catch {
    g = null;
  }
  if (!g) return short || long;
  let record;
  try {
    record = JSON.parse(new TextDecoder().decode(g));
  } catch {
    return false;
  }
  const originator = isObject(record) ? record.originator ?? null : null;
  return originator === owner ? short : long;
}

const ROTATION_NAME = /^rotation-[a-z2-7]{16}-[a-z2-7]{16}\.txt$/;

export async function lookForKeys(storage) {
  const found = [];
  const walk = async (dir) => {
    for (const entry of (await storage.list(dir)) || []) {
      const path = joinPath(dir, entry.name);
      if (!dir && (entry.name === '.git' || entry.name.startsWith('.staging-'))) continue;
      if (entry.kind === 'dir') {
        await walk(path);
        continue;
      }
      if (entry.kind !== 'file') continue;
      let looks = ROTATION_NAME.test(entry.name) || (entry.name.endsWith('.key') && entry.name !== '.key');
      if (!looks && !((await storage.size?.(path)) >= 4096)) {
        const bytes = await storage.read(path);
        if (bytes && bytes.length < 4096) {
          const text = Array.from(bytes, (b) => (b < 128 ? String.fromCharCode(b) : '�')).join('');
          if (text.startsWith(ROTATION_FORMAT) || text.startsWith(SHEET_TITLE)) {
            looks = true;
          } else {
            try {
              looks = unbase64(text.trim()).length === 32;
            } catch {
              looks = false;
            }
          }
        }
      }
      if (looks) {
        found.push(finding('error', path, 'looks like a private key: keys are never kept in an archive (section 15.4)'));
      }
    }
  };
  await walk('');
  return found;
}

export async function holdsLink(storage, dir) {
  if ((await storage.kind(dir)) === 'link' || await storage.linked?.(dir)) return true;
  for (const entry of (await storage.list(dir).catch(() => null)) || []) {
    if (entry.kind === 'link') return true;
    if (entry.kind === 'dir' && await holdsLink(storage, joinPath(dir, entry.name))) return true;
  }
  return false;
}

const LINKS_SEARCHED = ['ocfl', 'opensheaf.json', 'objects', 'indexes.json', 'names', 'owners', 'sha512'];

export async function lookForLinks(storage) {
  const found = [];
  const say = (path) => found.push(finding('error', path, 'a symbolic link in the archive: never followed (section 15.2)'));
  const walk = async (dir) => {
    for (const entry of (await storage.list(dir)) || []) {
      const path = joinPath(dir, entry.name);
      if (entry.kind === 'link') say(path);
      else if (entry.kind === 'dir') await walk(path);
    }
  };
  for (const top of LINKS_SEARCHED) {
    const kind = await storage.kind(top);
    if (kind === 'link') say(top);
    else if (kind === 'dir') await walk(top);
  }
  return found;
}

async function ocflFindings(f, report) {
  const s = f.storage;
  if (typeof s.stream !== 'function' || (await s.kind('ocfl')) !== 'dir') return [];
  const out = [];
  const given = [];
  let unread = 0;
  const checkedNoFurther = (id) => report.findings.some((x) => x.level === 'error' && x.object === id &&
    (x.message.endsWith('nor the object checked further') || x.message.endsWith('section 2: not checked further')));
  for (const { id, dir, inv } of await f.objects()) {
    if (await holdsLink(s, dir) || !isObject(inv) || id === null || id === undefined) {
      unread++;
      continue;
    }
    try {
      await pathOf(id, f.layout);
    } catch {
      let unsafe = inventoryProblem(inv);
      for (const cp of unsafe ? [] : Object.values(inv.manifest).flat()) unsafe ||= Boolean(await f.contentProblem(dir, cp));
      if (unsafe) unread++;
      else given.push([dir, dir]);
      continue;
    }
    if (inventoryProblem(inv) || checkedNoFurther(id)) unread++;
    else given.push([where(f, id), dir]);
  }
  for (const [place, dir] of given) {
    const { valid, log } = await validateObject(s, dir);
    if (!valid) out.push(finding('error', place, `OCFL validator: ${log.statusStr()}`));
  }
  if (unread) {
    out.push(finding('warning', 'ocfl', 'the storage root as a whole is not given to the OCFL validator: it would read ' +
                     'the files of the objects that cannot be read'));
  } else if (await holdsLink(s, 'ocfl')) {
    out.push(finding('warning', 'ocfl', 'the storage root as a whole is not given to the OCFL validator: it would follow ' +
                     'the symbolic links in it'));
  } else if (!(await validateStorageRoot(s, 'ocfl', { validateObjects: false })).valid) {
    out.push(finding('error', 'ocfl', 'the OCFL validator rejects the storage root'));
  }
  return out;
}

function inventoryProblem(inv) {
  const pathsMap = (m) => isObject(m) && Object.values(m).every((v) =>
    Array.isArray(v) && v.length > 0 && v.every((p) => typeof p === 'string'));
  if (!pathsMap(inv.manifest)) return true;
  const versions = inv.versions;
  if (!isObject(versions) || !Object.keys(versions).length || !Object.values(versions).every(isObject)) return true;
  if (typeof inv.head !== 'string' || !Object.hasOwn(versions, inv.head)) return true;
  return Object.values(versions).some((v) => !pathsMap(v.state) || ('user' in v && !isObject(v.user)) ||
    ('message' in v && typeof v.message !== 'string') || ('created' in v && typeof v.created !== 'string'));
}
