// Generated from literate/13-versions.md by opensheaf-literate: edit the document, not this file.
import { isVersion, versionNumber } from './paths.js';
import { same } from './schema.js';

export function versionsOf(inv) {
  const versions = inv && typeof inv.versions === 'object' && inv.versions ? Object.keys(inv.versions) : [];
  return versions.filter(isVersion).sort((a, b) => versionNumber(a) - versionNumber(b));
}

const own = (o, k) => o !== null && typeof o === 'object' && Object.hasOwn(o, k);

export function filesOf(inv, ver) {
  const files = Object.create(null);
  const state = (own(inv?.versions, ver) && inv.versions[ver]?.state) || {};
  for (const [digest, paths] of Object.entries(state)) {
    for (const p of Array.isArray(paths) ? paths : []) files[p] = digest;
  }
  return files;
}

export function contentPath(inv, ver, logical) {
  const digest = filesOf(inv, ver)[logical];
  const paths = digest && own(inv.manifest, digest) ? inv.manifest[digest] : null;
  return Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : null;
}

export function defaultHistory(inv, objOf, at = inv.head) {
  const last = new Map();
  for (const ver of versionsOf(inv)) {
    if (versionNumber(ver) <= versionNumber(at)) {
      const n = objOf(ver)?.documentVersion;
      if (Number.isInteger(n)) last.set(n, ver);
    }
  }
  return [...last.keys()].sort((a, b) => a - b).map((n) => last.get(n));
}

export function historyOf(inv, objOf, at = inv.head) {
  const hist = objOf(at)?.history;
  return Array.isArray(hist) && hist.length ? hist : defaultHistory(inv, objOf, at);
}

export function currentVersion(inv, objOf, at = inv.head) {
  const hist = historyOf(inv, objOf, at);
  return hist[hist.length - 1] || at;
}

export function rolesOf(inv, objOf) {
  const roles = {};
  const seen = new Map();
  for (const ver of versionsOf(inv)) {
    const obj = objOf(ver);
    const n = obj?.documentVersion;
    if (!obj || (obj.kind !== 'document' && obj.kind !== 'collection')) {
      roles[ver] = obj ? 'owner' : 'unknown';
      continue;
    }
    const files = Object.keys(ownFiles(inv, ver, obj)).length;
    if (!seen.has(n)) roles[ver] = 'new';
    else if (seen.get(n).missing && files > seen.get(n).files) roles[ver] = 'completion';
    else roles[ver] = 'description';
    seen.set(n, { missing: Boolean(obj.sourcesMissing), files });
  }
  return roles;
}

export function memberPins(m) {
  if (own(m, 'revisions')) {
    return (Array.isArray(m.revisions) ? m.revisions : []).map((r) => ({
      version: r?.version, pin: r?.inventorySha512, documentVersion: r?.documentVersion,
    }));
  }
  return [{ version: m?.version, pin: m?.inventorySha512, documentVersion: null }];
}

const list = (x) => (Array.isArray(x) ? x : []);
const text = (x) => (typeof x === 'string' ? x : null);

export function dateOf(dc, ...types) {
  for (const type of types) {
    const d = list(dc?.dates).find((x) => x?.dateType === type);
    if (d && text(d.date)) return d.date;
  }
  return null;
}

export function titleOf(dc) {
  return text(list(dc?.titles).find((t) => !t?.titleType)?.title) || text(list(dc?.titles)[0]?.title);
}

export function creatorsOf(dc) {
  return list(dc?.creators).map((c) => text(c?.name) || [c?.givenName, c?.familyName].filter(text).join(' '))
    .filter(Boolean);
}

export function abstractOf(dc) {
  return text(list(dc?.descriptions).find((d) => d?.descriptionType === 'Abstract')?.description);
}

export function pdfOf(obj) {
  const rs = list(obj?.renditions).filter((r) => text(r?.path));
  return (rs.find((r) => r.mediaType === 'application/pdf') || rs.find((r) => r.path.toLowerCase().endsWith('.pdf')))?.path || null;
}

export const IDENTITY = ['datacite.json', 'object.json', 'genesis.json'];

export function isEvidence(p) {
  return p.startsWith('parent/');
}

export function ownFiles(inv, ver, obj) {
  const notes = new Set([...list(obj?.notices), obj?.withdrawal?.reason, obj?.licence]
    .map((x) => x?.path).filter(text));
  const files = Object.create(null);
  for (const [p, digest] of Object.entries(filesOf(inv, ver))) {
    if (!IDENTITY.includes(p) && !isEvidence(p) && !notes.has(p)) files[p] = digest;
  }
  return files;
}

export function documentVersionErrors(inv, objOf) {
  const errors = [];
  const add = (ver, message) => errors.push({ ver, message });
  const versions = versionsOf(inv);
  const seen = new Map(), filesOfDoc = new Map(), missingOf = new Map();
  const fieldsOf = new Map(), externalOf = new Map();
  let highest = 0, hadHistory = false, notices = [], prevVer = null;
  const currentBefore = (at) => {
    if (!at) return null;
    const n = objOf(currentVersion(inv, objOf, at))?.documentVersion;
    return Number.isInteger(n) ? n : null;
  };
  for (const ver of versions) {
    const obj = objOf(ver);
    if (!obj || (obj.kind !== 'document' && obj.kind !== 'collection')) return errors;
    const n = obj.documentVersion;
    const own = ownFiles(inv, ver, obj);
    const change = obj.changes?.text ?? null;
    if (!seen.size && obj.parent) highest = (Number.isInteger(n) ? n : 1) - 1;
    if (seen.has(n)) {
      const before = filesOfDoc.get(n);
      if (missingOf.get(n)) {
        const changed = Object.entries(own).some(([p, d]) => Object.hasOwn(before, p) && before[p] !== d);
        const removed = Object.keys(before).some((p) => !Object.hasOwn(own, p));
        if (changed || removed) add(ver, `changes files of document version ${n} (only additions allowed)`);
      } else if (!same(own, before) || change !== seen.get(n)) {
        add(ver, `has other files than document version ${n}`);
      }
      missingOf.set(n, Boolean(obj.sourcesMissing));
      filesOfDoc.set(n, own);
    } else {
      if (n !== highest + 1) add(ver, `document version ${n} breaks the numbering (expected ${highest + 1})`);
      const m = currentBefore(prevVer);
      if (seen.has(m) && same(own, filesOfDoc.get(m)) && change === seen.get(m)) {
        add(ver, `document version ${n} holds the same files and change note as the current version ${m}: it is no new document version (section 4.2)`);
      }
      highest = Math.max(highest, Number.isInteger(n) ? n : 0);
      seen.set(n, change);
      filesOfDoc.set(n, own);
      missingOf.set(n, Boolean(obj.sourcesMissing));
    }
    const fields = Object.fromEntries(DOCUMENT_VERSION_FIELDS.map((k) => [k, obj[k] ?? null]));
    const external = Array.isArray(obj.external) ? obj.external : [];
    if (fieldsOf.has(n)) {
      const before = fieldsOf.get(n);
      if (before.sourcesMissing) {
        const now = Array.isArray(fields.renditions) ? fields.renditions : [];
        if ((Array.isArray(before.renditions) ? before.renditions : []).some((r) => !now.some((x) => same(r, x)))) {
          add(ver, `removes a rendition of document version ${n} (section 4.2)`);
        }
      } else {
        for (const k of DOCUMENT_VERSION_FIELDS) {
          if (!same(fields[k], before[k])) add(ver, `changes ${k} of document version ${n}, which belongs to it (section 4.2)`);
        }
      }
      if (externalOf.get(n).some((e) => !external.some((x) => same(e, x)))) {
        add(ver, `drops or changes an external record of document version ${n} (section 4.2)`);
      }
    }
    fieldsOf.set(n, fields);
    externalOf.set(n, external);
    const hist = obj.history;
    if (hadHistory && hist == null) add(ver, 'lacks the history of earlier versions');
    if (hist != null) {
      hadHistory = true;
      const known = versions.filter((v) => versionNumber(v) <= versionNumber(ver));
      if (!Array.isArray(hist) || hist.some((h) => !known.includes(h))) {
        add(ver, 'history names unknown object versions');
      } else {
        const docs = hist.map((h) => objOf(h)?.documentVersion);
        const all = Array.from({ length: highest }, (_, k) => k + 1);
        if (new Set(docs).size !== docs.length || !same([...new Set(docs)].sort((a, b) => a - b), all)) {
          add(ver, 'history does not list each document version once');
        }
        hist.forEach((h, k) => {
          const later = known.filter((v) => versionNumber(v) > versionNumber(h) && objOf(v)?.documentVersion === docs[k]);
          if (later.length) add(ver, `history entry ${h} is not the last object version of ${docs[k]}`);
        });
      }
    }
    const current = Array.isArray(obj.notices) ? obj.notices : [];
    if (!same(current.slice(0, notices.length), notices)) {
      add(ver, 'drops, changes or moves an earlier notice');
    } else {
      for (let k = notices.length; k < current.length; k++) {
        const r = current[k]?.replaces;
        if (r === undefined || r === null) continue;
        if (!Number.isInteger(r) || r < 1 || r > k) add(ver, `notice ${k + 1} replaces no earlier notice (${r})`);
        else if (current[r - 1]?.documentVersion !== current[k]?.documentVersion) add(ver, `notice ${k + 1} replaces notice ${r}, about another document version`);
        else if (current.slice(0, k).some((y) => y?.replaces === r)) add(ver, `notice ${k + 1} replaces notice ${r}, which is already replaced`);
      }
    }
    notices = current;
    prevVer = ver;
  }
  return errors;
}

const DOCUMENT_VERSION_FIELDS = ['mainSource', 'sourceFormat', 'sourcesMissing', 'renditions', 'toolchain'];

export function noticeWarnings(inv, objOf) {
  const out = [];
  let before = 0;
  for (const ver of versionsOf(inv)) {
    const notices = Array.isArray(objOf(ver)?.notices) ? objOf(ver).notices : [];
    const created = String(inv.versions?.[ver]?.created ?? '').slice(0, 10);
    for (let k = before; k < notices.length; k++) {
      const date = notices[k]?.date;
      if (typeof date === 'string' && created && date > created) {
        out.push({ ver, message: `notice ${k + 1} is dated ${date}, after its deposit (${created}, section 4.2)` });
      }
    }
    before = Math.max(before, notices.length);
  }
  return out;
}
