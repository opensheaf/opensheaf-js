// Generated from literate/16-rules.md by opensheaf-literate: edit the document, not this file.
import { validate } from './schema.js';
import { filesOf, dateOf } from './versions.js';
import { isObject } from './names.js';

export function finding(level, place, message, { object = null, ver = null } = {}) {
  const section = /\(sections? ([0-9A-Z][^)]*)\)/.exec(message)?.[1]?.split(/,| and /)[0].trim() ?? null;
  return { level, place, message, object, ver, section, text: `${place}: ${message}` };
}

export function schemaFindings(place, data, schema, level = 'error', context = {}) {
  if (!schema) return [];
  return validate(schema, data).map((e) => finding(level, place, `${e.path ? e.path + ': ' : ''}${e.message}`, context));
}

export function descriptionErrors(inv, ver, obj, dc) {
  const out = [];
  const logical = Object.keys(filesOf(inv, ver));
  if (!isObject(obj) || !isObject(dc)) return out;
  if (String(obj.documentVersion) !== dc.version) out.push('datacite.json and object.json disagree on the version');
  if (obj.status === 'withdrawn' && dateOf(dc, 'Withdrawn') !== (obj.withdrawal?.date ?? null)) out.push('withdrawal dates disagree');
  for (const k of ['titles', 'creators', 'publicationYear', 'types', 'version', 'publisher']) {
    if (!Object.hasOwn(dc, k)) out.push(`datacite.json lacks ${k}`);
  }
  for (const r of Array.isArray(dc.rightsList) ? dc.rightsList : []) {
    const rights = typeof r?.rights === 'string' ? r.rights.toLowerCase() : '';
    if (r?.rightsIdentifier == null && (rights.startsWith('creative') || rights.startsWith('arxiv')) && !r?.rightsUri) {
      out.push('licence without SPDX identifier and without rightsUri');
    }
  }
  const notes = [obj.changes, obj.sourcesMissing, obj.licence, ...(Array.isArray(obj.notices) ? obj.notices : []), obj.withdrawal?.reason];
  for (const note of notes) {
    if (note?.path && !logical.includes(note.path)) out.push(`note file ${note.path} not in the version`);
  }
  if (obj.kind === 'document') {
    if (obj.mainSource && !logical.includes(obj.mainSource)) out.push('main source not in the version');
    if (obj.sourcesMissing && obj.mainSource) out.push('sourcesMissing together with a main source');
    for (const r of Array.isArray(obj.renditions) ? obj.renditions : []) {
      if (!logical.includes(r?.path)) out.push(`rendition ${r?.path} not in the version`);
    }
  } else if (obj.kind === 'collection' && !logical.includes('members.json')) {
    out.push('collection without members.json');
  }
  return out;
}

export function memberErrors(type, m) {
  const out = [];
  if (type === 'catalogue' && (!m?.version || !m?.inventorySha512 || (isObject(m) && Object.hasOwn(m, 'revisions')))) {
    out.push('a member of a catalogue needs version and inventorySha512, and no revisions');
  }
  if (type === 'selection') {
    const revs = m?.revisions;
    if (['version', 'inventorySha512', 'follow'].some((k) => isObject(m) && Object.hasOwn(m, k))) {
      out.push('a member of a selection has no version, inventorySha512 or follow');
    }
    if (!Array.isArray(revs) || !revs.length ||
        revs.some((r) => !['documentVersion', 'version', 'inventorySha512'].every((k) => r?.[k]))) {
      out.push('a member of a selection needs revisions, each with documentVersion, version and inventorySha512');
    } else if (new Set(revs.map((r) => r.documentVersion)).size !== revs.length) {
      out.push('a document version is vetted twice');
    }
  }
  return out;
}

export function memberPins(m) {
  if (isObject(m) && Object.hasOwn(m, 'revisions')) {
    return (Array.isArray(m.revisions) ? m.revisions : []).map((r) => ({
      version: r?.version, pin: r?.inventorySha512, documentVersion: r?.documentVersion ?? null,
    }));
  }
  return [{ version: m?.version, pin: m?.inventorySha512, documentVersion: null }];
}

export const INDEX_KEY = { names: 'name', owners: 'owner', sha512: 'inventorySha512' };

export function indexEntries(objects) {
  const out = { names: [], owners: [], sha512: [] };
  const lines = new Map();
  for (const o of objects) {
    const [, name, owner] = o.id.split(':');
    const entry = { name, owner, id: o.id, status: o.status,
                    originator: o.rec.kind === 'owner' ? owner : o.rec.originator ?? null,
                    genesis: new TextDecoder().decode(o.genesis) };
    if (o.label) entry.label = o.label;
    out.names.push(entry);
    if (!lines.has(owner)) lines.set(owner, []);
    lines.get(owner).push(name);
    o.sidecars.forEach((digest, k) => {
      if (digest !== null) out.sha512.push({ inventorySha512: digest, id: o.id, version: `v${k + 1}`, status: o.status });
    });
    for (const c of o.carried || []) {
      out.sha512.push({ inventorySha512: c.digest, id: o.id, version: `v${c.number}`, status: 'active' });
    }
  }
  out.owners = [...lines].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([owner, names]) => ({ owner, names: names.sort() }));
  return out;
}
