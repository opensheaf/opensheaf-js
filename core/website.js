// Generated from literate/31-website.md by opensheaf-literate: edit the document, not this file.
import { readGenesis, objectId, parseId, SheafUri } from './names.js';
import { historyOf, currentVersion, dateOf, pdfOf, memberPins, withdrawnVersions } from './versions.js';
import { CONTESTED, SIGNED, VOUCHED } from './signatures.js';
import { Http, parseJson } from './http.js';
import { pathOf } from './paths.js';
import { sha512hex } from './write.js';
import { compareText, joinPath } from './storage.js';
import { GENESIS, OBJ, CONFIG_NAME, plural, exit, short } from './folder.js';
import { memberOrder, catalogueLabel } from './collect.js';
import { readJson, writeText } from './storage.js';
import { LABEL } from './names.js';
import { same } from './schema.js';
import { writeDiscovery, listedObjects } from './discovery.js';
import { lineOf } from './describe.js';
import { displayName, nameAddress } from './deposit.js';
import { keeperOf, keeperLink, successorClaim, CONFIRMED } from './keepers.js';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

export function safeUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '';
}

export function link(u, label, cls = '') {
  const safe = safeUrl(u);
  const attr = cls ? ` class="${cls}"` : '';
  if (safe) return `<a${attr} href="${esc(safe)}">${label}</a>`;
  return cls ? `<span${attr}>${label}</span>` : label;
}

const PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g;

export function fill(text, values) {
  return text.replace(PLACEHOLDER, (all, k) => (Object.hasOwn(values, k) ? values[k] : all));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
                'October', 'November', 'December'];

export function fmtDate(iso) {
  if (!iso) return '';
  const text = String(iso);
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T[^]*)?)?)?$/.exec(text.split('/')[0].trim());
  if (!m) return text;
  const [, year, month, day] = m.map(Number);
  if (m[2] && (month < 1 || month > 12)) return text;
  if (m[3]) {
    if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return text;
    return `${day} ${MONTHS[month - 1]} ${m[1]}`;
  }
  return m[2] ? `${MONTHS[month - 1]} ${m[1]}` : m[1];
}

export function namesJoined(names) {
  names = [...names];
  return names.length > 1 ? [names.slice(0, -1).join(', '), names[names.length - 1]].join(' and ') : names.join('');
}

export function authorsOf(dc) {
  return namesJoined(dc.creators.map(displayName));
}

const SPACE = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

export function words(s) {
  return s.split(SPACE).filter(Boolean);
}

export function pyJson(value) {
  if (Array.isArray(value)) return `[${value.map(pyJson).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${pyJson(v)}`).join(', ')}}`;
  }
  return JSON.stringify(value);
}

export function jsonInScript(value) {
  return pyJson(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function arxivId(obj, dc) {
  for (const e of obj.external || []) {
    if (e.service === 'arXiv' && (e.record || '').includes('/abs/')) {
      return e.record.slice(e.record.lastIndexOf('/abs/') + 5).replace(/v\d+$/, '');
    }
  }
  for (const r of dc.relatedIdentifiers || []) {
    if (r.relatedIdentifierType === 'arXiv') {
      const k = r.relatedIdentifier.indexOf(':');
      return (k < 0 ? '' : r.relatedIdentifier.slice(k + 1)).replace(/v\d+$/, '');
    }
  }
  return null;
}

export function changesNote(obj) {
  const text = obj.changes?.text;
  if (!text) return null;
  const arxiv = (obj.external || []).some((e) => e.role === 'source' && e.service === 'arXiv');
  return `${arxiv ? 'arXiv comments' : 'changes'}: ${text}`;
}

export function presentedVersion(m, inv, objOf) {
  if (m.revisions?.length) return m.revisions[m.revisions.length - 1].version;
  return currentVersion(inv, objOf, m.version);
}

function lastPin(m) {
  const pins = memberPins(m);
  const p = pins[pins.length - 1];
  return [p.version, p.pin];
}

const PIN = /^[0-9a-f]{128}$/;
const OBJECT_VERSION = /^v[1-9][0-9]*$/;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function number(n) {
  return Number.isInteger(n) && n > 0 ? String(n) : '?';
}

export function pinHtml(pin) {
  if (typeof pin === 'string' && PIN.test(pin)) return `<span class="pin" title="${pin}">pin ${pin.slice(0, 32)}…</span>`;
  return '<span class="contested">no valid pin</span>';
}

export function pinsOk(m, line = null) {
  if (m === null || typeof m !== 'object' || (Object.hasOwn(m, 'revisions') && !Array.isArray(m.revisions))) return false;
  const pins = memberPins(m);
  return pins.length > 0 && pins.every(({ version: v, pin: d }) =>
    typeof v === 'string' && OBJECT_VERSION.test(v) && typeof d === 'string' && PIN.test(d) &&
    (line === null || Object.hasOwn(line.inv.versions, v)));
}

export async function pageAddress(f, id) {
  return f.labelOf(id) || nameAddress(f, id);
}

export class Site {
  constructor(f, { keeperFetch = null, home = true } = {}) {
    this.f = f;
    this.home = home;
    this.lines = new Map();
    this.keepers = new Map();
    this.keeperFetch = keeperFetch;
    this.remotes = new Map();
    this.http = new Http({ fetch: f.env.fetch, budget: null });
  }

  async held(m) {
    if (typeof m?.name !== 'string' || typeof m?.owner !== 'string') return null;
    const id = objectId(m.name, m.owner);
    if (!parseId(id) || parseId(id).draft) return null;
    let dir;
    try {
      dir = await this.f.dirOf(id);
    } catch {
      return null;
    }
    if ((await this.f.storage.kind(joinPath(dir, 'inventory.json'))) !== 'file') return null;
    if (!this.lines.has(id)) this.lines.set(id, await this.line(id, dir));
    return this.lines.get(id);
  }

  async line(id, dir) {
    const f = this.f;
    const [, name, owner] = id.split(':');
    const inv = await f.inventory(dir);
    const slug = await pageAddress(f, id);
    const home = await nameAddress(f, id);
    let originator = null;
    try {
      const g = await f.readLogical(dir, inv, GENESIS, 'v1');
      originator = g ? (await readGenesis(g)).originator ?? null : null;
    } catch {
      originator = null;
    }
    const read = await f.line(id);
    const json = (logical, ver = null) => f.readObjectJson(dir, inv, logical, ver);
    const line = { id, name, owner, dir, inv, slug, home, originator, statuses: read.statuses, signed: read.latest,
                   objs: read.objs, json,
                   status: (ver) => read.statuses[Number(ver.slice(1)) - 1],
                   digest: (ver) => read.versions[Number(ver.slice(1)) - 1].digest };
    line.objOf = (v) => read.objs.get(v) ?? null;
    line.state = (await json(OBJ, line.signed)) || {};
    line.withdrawn = line.state.status === 'withdrawn';
    return line;
  }
}

export function removed(f, m) {
  return f.tombstones.some((t) => t.id === `sheaf:${m?.name}:${m?.owner}`);
}

export function fullUri(line) {
  return new SheafUri({ name: line.name, owner: line.owner }).canonical(line.originator);
}

export function shortUri(line) {
  return `sheaf:${line.name.slice(0, 16)}` + (line.owner === line.originator ? '' : `:${line.owner.slice(0, 16)}`);
}

export async function pinUri(line, ver) {
  const n = (await line.json(OBJ, ver)).documentVersion;
  return `${fullUri(line)}/v${n}?sha512=${line.digest(ver)}`;
}

async function fileUrl(f, root, line, ver, logical) {
  const cp = logical ? contentPathOf(line.inv, ver, logical) : null;
  return cp ? `${root}ocfl/${(await f.dirOf(line.id)).slice('ocfl/'.length)}/${cp}` : null;
}

function contentPathOf(inv, ver, logical) {
  for (const [d, paths] of Object.entries(inv.versions[ver || inv.head].state)) {
    if (paths.includes(logical)) return inv.manifest[d][0];
  }
  return null;
}

async function fileLink(f, root, line, ver, logical, label) {
  const u = await fileUrl(f, root, line, ver, logical);
  return u ? `<a href="${esc(u)}">${esc(label)}</a>` : '';
}

export function withdrawalHtml(state, where = '') {
  if (state?.status !== 'withdrawn') return '';
  const w = state.withdrawal || {};
  return `<div class="withdrawn"><strong>Withdrawn${where} (${esc(fmtDate(w.date))}):</strong> ` +
    `${esc(w.reason?.text ?? '')}</div>`;
}

export function versionsLine(m, obj) {
  if (m.revisions?.length) {
    const ns = m.revisions.map((r) => number(r?.documentVersion));
    return `vetted: version${ns.length > 1 ? 's' : ''} ${ns.join(', ')}`;
  }
  return `version ${number(obj.documentVersion)}`;
}

async function versionBlock(f, line, ver, shown, notices, root, vetted = null) {
  const obj = await line.json(OBJ, ver);
  const dc = await line.json('datacite.json', ver);
  const n = obj.documentVersion;
  const labels = (obj.external || []).filter((e) => e.role === 'source' && e.label).map((e) => `${e.service} ${e.label}`);
  const vs = Object.keys(line.inv.versions);
  const first = vs.find((v) => line.objOf(v)?.documentVersion === n);
  const par = first ? line.objOf(first)?.parent : null;
  if (par && (vs.indexOf(first) === 0 || !same(line.objOf(vs[vs.indexOf(first) - 1])?.parent ?? null, par))) {
    labels.unshift(`the parent's version ${par.documentVersion}`);
  }
  let head = `Version ${number(n)}` + (labels.length ? ` (${esc(labels.join(', '))})` : '');
  if (obj.stage) head += ` <span class="stage">${esc(obj.stage.value)}</span>`;
  if (vetted !== null && vetted.has(n)) head += ' <span class="current">vetted</span>';
  else if (vetted === null && n === shown) head += ' <span class="current">current</span>';
  const status = line.status(ver);
  if (status === VOUCHED) head += ' <span class="stage">vouched for</span>';
  else if (status !== SIGNED) head += ` <span class="contested">${esc(status)}</span>`;
  let when = '';
  if (dateOf(dc, 'Available')) when = fmtDate(dateOf(dc, 'Available'));
  else if (dateOf(dc, 'Created')) when = `written ${fmtDate(dateOf(dc, 'Created'))}, not public at the time`;
  const files = [];
  for (const r of obj.renditions || []) files.push(await fileLink(f, root, line, ver, r.path, 'PDF'));
  if (obj.mainSource) {
    const kind = { 'application/x-tex': 'LaTeX source', 'application/x-texmacs': 'TeXmacs source' }[obj.sourceFormat] || 'source';
    files.push(await fileLink(f, root, line, ver, obj.mainSource, kind));
  } else if (obj.sourcesMissing) {
    files.push(`<span class="missing">sources not available: ${esc(obj.sourcesMissing.text ?? '')}</span>`);
  }
  const at = (await f.dirOf(line.id)).slice('ocfl/'.length);
  files.push(`<a href="${root}ocfl/${at}/${ver}/inventory.json">files and digests</a>`);
  const arxiv = arxivId(obj, dc);
  for (const e of obj.external || []) {
    if (e.record) {
      const label = e.service === 'arXiv' && arxiv ? `arXiv:${arxiv}` : e.service;
      files.push(link(e.record, esc(label)));
    }
  }
  if (arxiv && !(obj.external || []).some((e) => e.service === 'arXiv')) {
    files.push(`<a href="https://arxiv.org/abs/${esc(arxiv)}">arXiv:${esc(arxiv)}</a>`);
  }
  if (dc.doi) files.push(`<a href="https://doi.org/${esc(dc.doi)}">doi:${esc(dc.doi)}</a>`);
  const out = [`<li class="version${n === shown ? ' is-current' : ''}" id="v${number(n)}">`,
               `<div class="version-head">${head}</div>`];
  if (when) out.push(`<div class="version-date">${esc(when)}</div>`);
  const withdrawn = withdrawnVersions(line.inv, line.objOf, line.signed || line.inv.head);
  if (withdrawn.has(n)) out.push(withdrawalHtml(line.objOf(withdrawn.get(n))));
  if (changesNote(obj)) out.push(`<div class="changes">${esc(changesNote(obj))}</div>`);
  out.push(`<div class="files">${files.filter(Boolean).join(' · ')}</div>`);
  const uri = await pinUri(line, ver);
  out.push(`<div class="pin" title="${esc(uri)}">${ver} · pin <code class="copy" data-copy="${esc(uri)}">` +
           `${line.digest(ver).slice(0, 32)}…</code> (<a href="${root}ocfl/${at}/` +
           `${ver}/inventory.json">inventory</a>)</div>`);
  const replaced = new Set(notices.map((x) => x.replaces));
  for (const [i, x] of notices.entries()) {
    const k = i + 1;
    if (x.documentVersion === n && !replaced.has(k)) {
      const src = line.signed || line.inv.head;
      const link = x.path ? ` ${await fileLink(f, root, line, src, x.path, 'statement')}` : '';
      const repl = x.replaces ? `, replacing notice ${x.replaces}` : '';
      out.push(`<div class="notice"><strong>Notice ${k} (${esc(fmtDate(x.date))}${repl}):</strong> ` +
               `${esc(x.text ?? '')}${link}</div>`);
    }
  }
  out.push('</li>');
  return out.join('\n');
}

async function metaTags(site, f, line, cur, obj, dc) {
  const base = f.archive.baseUrl;
  const landing = `${base}paper/${line.slug}/`;
  const pdf = await fileUrl(f, base, line, cur, pdfOf(obj));
  const date = dateOf(dc, 'Issued') || dateOf(dc, 'Available') || dateOf(dc, 'Created') || '';
  const tags = [`<meta name="citation_title" content="${esc(dc.titles[0].title)}">`];
  for (const c of dc.creators) tags.push(`<meta name="citation_author" content="${esc(c.name)}">`);
  if (date) tags.push(`<meta name="citation_publication_date" content="${esc(date.replace(/-/g, '/'))}">`);
  if (pdf) tags.push(`<meta name="citation_pdf_url" content="${esc(pdf)}">`);
  if (dc.doi) tags.push(`<meta name="citation_doi" content="${esc(dc.doi)}">`);
  const abstract = (dc.descriptions || []).find((x) => x.descriptionType === 'Abstract')?.description ?? '';
  if (abstract) tags.push(`<meta name="description" content="${esc([...words(abstract).join(' ')].slice(0, 300).join(''))}">`);
  const rel = (r, href, media = null) => `<link rel="${r}" href="${esc(href)}"` + (media ? ` type="${esc(media)}"` : '') + '>';
  const cite = dc.doi ? `https://doi.org/${dc.doi}` : landing;
  const kind = schemaType(obj, dc);
  tags.push(rel('canonical', landing), rel('cite-as', cite),
            rel('describedby', await fileUrl(f, base, line, cur, 'datacite.json'), 'application/vnd.datacite.datacite+json'));
  for (const [path, media] of contentItems(obj)) {
    const u = await fileUrl(f, base, line, cur, path);
    if (u) tags.push(rel('item', u, media));
  }
  for (const u of licenceUrls(dc)) tags.push(rel('license', u));
  tags.push(rel('type', `https://schema.org/${kind}`));
  for (const c of dc.creators) {
    const o = orcidOf(c);
    if (o) tags.push(rel('author', o));
  }
  const ld = { '@context': 'https://schema.org', '@type': kind, name: dc.titles[0].title, url: landing,
               author: dc.creators.map(personLd), datePublished: date, version: dc.version,
               identifier: [fullUri(line), ...[dc.doi, conceptDoi(dc)].filter(Boolean).map((d) => `https://doi.org/${d}`)] };
  const encodings = [];
  for (const r of obj.renditions || []) {
    const u = await fileUrl(f, base, line, cur, r.path);
    if (u) encodings.push({ '@type': 'MediaObject', contentUrl: u, encodingFormat: r.mediaType ?? null });
  }
  if (encodings.length) ld.encoding = encodings;
  const licences = [...licenceUrls(dc), ...(dc.rightsList || []).filter((r) => r.rights && !(r.rightsUri || r.rightsIdentifier))
    .map((r) => r.rights)];
  if (licences.length) ld.license = licences.length === 1 ? licences[0] : licences;
  const same = sameAs(dc);
  if (same.length) ld.sameAs = same;
  if (abstract) ld.abstract = abstract;
  const keywords = (dc.subjects || []).filter((x) => x.subject).map((x) => x.subject);
  if (keywords.length) ld.keywords = keywords;
  if (obj.kind === 'collection') ld.hasPart = await collectionParts(site, f, line, cur);
  if (obj.status === 'withdrawn') ld.creativeWorkStatus = 'Withdrawn';
  tags.push('<script type="application/ld+json">' + jsonInScript(ld) + '</script>');
  return tags.join('\n');
}

function contentItems(obj) {
  const out = (obj.renditions || []).map((r) => [r.path, r.mediaType ?? null]);
  if (obj.mainSource) out.push([obj.mainSource, obj.sourceFormat ?? null]);
  else if (obj.kind === 'collection') out.push(['members.json', 'application/json']);
  const seen = new Set();
  return out.filter((x) => {
    const k = JSON.stringify(x);
    return !seen.has(k) && seen.add(k);
  });
}

function licenceUrls(dc) {
  const out = [];
  for (const r of dc.rightsList || []) {
    if (safeUrl(r.rightsUri)) out.push(r.rightsUri);
    else if (r.rightsIdentifier) out.push(`https://spdx.org/licenses/${r.rightsIdentifier}.html`);
  }
  return out;
}

function orcidOf(creator) {
  for (const x of creator.nameIdentifiers || []) {
    if ((x.nameIdentifierScheme || '').toUpperCase() === 'ORCID' && x.nameIdentifier) {
      return `https://orcid.org/${x.nameIdentifier.split('/').pop()}`;
    }
  }
  return null;
}

const SCHEMA_TYPES = { Collection: 'Collection', Dataset: 'Dataset', Software: 'SoftwareSourceCode', Book: 'Book',
                       BookChapter: 'Chapter', Audiovisual: 'MediaObject', Image: 'ImageObject', Text: 'ScholarlyArticle',
                       Preprint: 'ScholarlyArticle', JournalArticle: 'ScholarlyArticle', ConferencePaper: 'ScholarlyArticle',
                       Report: 'Report', Dissertation: 'Thesis', Presentation: 'PresentationDigitalDocument' };

function schemaType(obj, dc) {
  if (obj.kind === 'collection') return 'Collection';
  const t = dc.types?.resourceTypeGeneral;
  return Object.hasOwn(SCHEMA_TYPES, t) ? SCHEMA_TYPES[t] : 'CreativeWork';
}

function personLd(c) {
  const p = { '@type': (c.nameType ?? 'Personal') === 'Personal' ? 'Person' : 'Organization', name: displayName(c) };
  const o = orcidOf(c);
  if (o) p['@id'] = o;
  return p;
}

function conceptDoi(dc) {
  return (dc.relatedIdentifiers || []).find((r) => r.relationType === 'IsVersionOf' && r.relatedIdentifierType === 'DOI')
    ?.relatedIdentifier ?? null;
}

function sameAs(dc) {
  const out = [];
  for (const r of dc.relatedIdentifiers || []) {
    if (r.relationType !== 'IsIdenticalTo') continue;
    const ident = r.relatedIdentifier ?? '', kind = r.relatedIdentifierType;
    const url = { DOI: `https://doi.org/${ident}`, URL: ident,
                  arXiv: `https://arxiv.org/abs/${ident.startsWith('arXiv:') ? ident.slice(6) : ident}` }[kind];
    if (Object.hasOwn({ DOI: 1, URL: 1, arXiv: 1 }, kind) && safeUrl(url)) out.push(url);
  }
  return out;
}

async function collectionParts(site, f, line, ver) {
  const out = [];
  for (const m of (await line.json('members.json', ver))?.members || []) {
    const h = await site.held(m);
    if (h) out.push({ '@id': `${f.archive.baseUrl}paper/${h.slug}/` });
    else if (m.doi) out.push({ '@id': `https://doi.org/${m.doi}` });
  }
  return out;
}

export function abstractHtml(dc) {
  for (const x of dc.descriptions || []) {
    if (x.descriptionType === 'Abstract') {
      return x.description.split('\n\n').map((p) => `<p>${esc(words(p).join(' '))}</p>`).join('\n');
    }
  }
  return '';
}

export const TEMPLATES = ['collection.html', 'index.html', 'owner.html', 'paper.html', 'style.css'];

export async function template(f, name) {
  const html = f.index.html && typeof f.index.html === 'object' ? f.index.html : {};
  const dir = html.templates || f.index.templates || 'templates';
  const own = await f.storage.read(joinPath(dir, name));
  if (own) return own;
  const given = await f.env.template?.(name);
  if (!given) exit(`no template ${name} (the templates of the website are not found)`);
  return given;
}

const text = async (f, name) => new TextDecoder().decode(await template(f, name));

export async function render(f, members, { home = true, featured = null, keeperFetch = null, groups = null } = {}) {
  f.refuseUnreadPages?.();
  const site = new Site(f, { keeperFetch, home });
  members = members.filter((m) => !removed(f, m));
  const base = f.archive.baseUrl;
  const urls = [[base, null]], written = [], seenOwners = [];
  const pageT = await text(f, 'paper.html');
  let fline = null, fmembers = [];
  if (featured) {
    fline = await site.held({ name: featured.split(':')[1], owner: featured.split(':')[2] });
    fmembers = ((await fline.json('members.json', fline.signed)) || {}).members || [];
  }
  const pages = new Map(), followed = new Set();
  const walk = async (queue) => {
    while (queue.length) {
      const qm = queue.shift();
      const line = await site.held(qm);
      if (!line || !pinsOk(qm, line)) continue;
      if (!pages.has(line.id)) pages.set(line.id, qm);
      if (qm.kind === 'collection' && !followed.has(line.id)) {
        followed.add(line.id);
        const ver = presentedVersion(qm, line.inv, line.objOf);
        queue.push(...(((await line.json('members.json', ver)) || {}).members || []));
      }
    }
  };
  fmembers = fmembers.filter((m) => !removed(f, m));
  await walk([...members, ...fmembers]);
  for (const [, id] of [...f.labels].sort((a, b) => compareText(a[0], b[0]))) {
    const [, nm, owner] = id.split(':');
    const line = await site.held({ name: nm, owner });
    if (!pages.has(id) && line && line.signed && ['document', 'collection'].includes(line.state.kind)) {
      await walk([{ kind: line.state.kind, name: nm, owner, version: line.signed,
                    inventorySha512: line.digest(line.signed) }]);
    }
  }
  for (const [id, m] of pages) {
    const line = site.lines.get(id);
    const cur = presentedVersion(m, line.inv, line.objOf);
    const [pinVer, pin] = lastPin(m);
    const ref = line.signed || pinVer;
    const vetted = m.revisions ? new Set(m.revisions.map((r) => r.documentVersion)) : null;
    const obj = await line.json(OBJ, cur);
    const dc = await line.json('datacite.json', cur);
    const notices = line.state.notices || [];
    const root = '../../';
    const blocks = [];
    for (const v of [...historyOf(line.inv, line.objOf, ref || line.inv.head)].reverse()) {
      blocks.push(await versionBlock(f, line, v, obj.documentVersion, notices, root, vetted));
    }
    const issued = dateOf(dc, 'Issued');
    const contested = line.status(cur) === CONTESTED || line.status(pinVer) === CONTESTED
      ? '<div class="contested"><strong>Contested:</strong> this version is signed only with ' +
        'keys its owner has since exposed (sections 6.3 and 7.3 of the specification); ' +
        'what it holds may not be the owner\'s.</div>' : '';
    const rights = (dc.rightsList?.length ? dc.rightsList : [{}])[0];
    let licence = esc(rights.rights ?? '');
    if (rights.rightsUri) licence = link(rights.rightsUri, licence);
    const citeUrl = dc.doi ? `https://doi.org/${dc.doi}` : `${base}paper/${line.slug}/`;
    const cite = esc(`${authorsOf(dc)}. ${dc.titles[0].title}. ${f.archive.name}, ` +
                     `${(issued || '').slice(0, 4)}, version ${obj.documentVersion}.`) +
      ` <code class="copy">${esc(await pinUri(line, cur))}</code>.` +
      ` <a href="${esc(citeUrl)}">${esc(citeUrl)}</a>`;
    let htmlLink = '';
    if ((await f.storage.kind(`site/${line.slug}/${line.slug}.html`)) === 'file') {
      htmlLink = ` · <a href="${root}site/${line.slug}/${line.slug}.html">HTML</a>`;
    }
    const at = (await f.dirOf(line.id)).slice('ocfl/'.length);
    const common = {
      root, archive_name: esc(f.archive.name), base_url: esc(base),
      head: await metaTags(site, f, line, cur, obj, dc), title: esc(dc.titles[0].title),
      issued: esc(fmtDate(issued)), withdrawn: withdrawalHtml(line.state), contested,
      versions: blocks.join('\n'), licence, cite,
      pin: esc(pin), pin_url: `${root}ocfl/${at}/${pinVer}/inventory.json`,
      sheaf_uri: esc(fullUri(line)), sheaf_short: esc(shortUri(line)),
      owner: await ownerHtml(site, line.owner, root),
    };
    if (!seenOwners.includes(line.owner)) seenOwners.push(line.owner);
    let page;
    if (obj.kind === 'collection') {
      const cmembers = (await line.json('members.json', cur)) || {};
      const kind = { selection: 'A selection', catalogue: 'A catalogue' }[cmembers.type] || 'A collection';
      const items = [];
      for (const cm of cmembers.members || []) {
        if (!removed(f, cm)) items.push(await site.held(cm) ? await localEntry(site, cm, root) : await remoteEntry(site, cm, root));
      }
      page = fill(await text(f, 'collection.html'), { ...common,
        kind: `${kind} curated by ${esc(authorsOf(dc))}`,
        count: `${items.length} member${items.length !== 1 ? 's' : ''}`,
        description: abstractHtml(dc),
        members: items.length ? items.join('\n') : '<li class="empty">No members yet.</li>' });
    } else {
      page = fill(pageT, { ...common,
        authors: esc(authorsOf(dc)), abstract: abstractHtml(dc),
        pdf: esc((await fileUrl(f, root, line, cur, pdfOf(obj))) || `#v${number(obj.documentVersion)}`),
        html_link: htmlLink });
    }
    for (const address of new Set([line.home, line.slug])) {
      await f.storage.write(`paper/${address}/index.html`, new TextEncoder().encode(page));
      written.push(address);
    }
    let lastmod = String(line.inv.versions[line.inv.head].created ?? '').slice(0, 10);
    lastmod = DAY.test(lastmod) ? lastmod : null;
    urls.push([`${base}paper/${line.slug}/`, lastmod]);
    if (htmlLink) urls.push([`${base}site/${line.slug}/${line.slug}.html`, lastmod]);
  }
  if (home) {
    await writeHome(site, members, featured, fline, fmembers, groups);
  } else if (pageT.includes('style.css')) {
    await f.storage.write('style.css', await template(f, 'style.css'));
  }
  const ownerPages = [];
  for (const owner of seenOwners) {
    const log = await keyLogOf(f, owner);
    if (!log) continue;
    const lines = [...pages.keys()].map((i) => site.lines.get(i)).filter((ln) => ln.owner === owner);
    await f.storage.write(`owner/${owner}/index.html`, new TextEncoder().encode(await ownerPage(site, owner, log, lines)));
    ownerPages.push(owner);
    urls.push([`${base}owner/${owner}/`, null]);
  }
  const sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const [url, last] of urls) sm.push(`  <url><loc>${esc(url)}</loc>` + (last ? `<lastmod>${last}</lastmod>` : '') + '</url>');
  sm.push('</urlset>');
  await f.storage.write('sitemap.xml', new TextEncoder().encode(sm.join('\n') + '\n'));
  const moved = [];
  const former = Object.entries(f.archive.formerAddresses || {}).sort((a, b) => compareText(a[0], b[0]));
  for (const [address, id] of former) {
    if (written.includes(address) || !pages.has(id) || !LABEL.test(address)) continue;
    const slug = site.lines.get(id).slug;
    await f.storage.write(`paper/${address}/index.html`,
                          new TextEncoder().encode(redirectPage(`../${slug}/`, `${base}paper/${slug}/`)));
    moved.push(address);
  }
  for (const [folder, keep] of [['paper', new Set([...written, ...moved])], ['owner', new Set(ownerPages)]]) {
    for (const entry of (await f.storage.list(folder)) || []) {
      if (entry.kind === 'dir' && !keep.has(entry.name)) await removeAll(f.storage, `${folder}/${entry.name}`);
    }
  }
  return written.length;
}

export const REDIRECT_MARK = '<!-- opensheaf: a former address -->';

export function redirectPage(href, canonical) {
  return `<!DOCTYPE html>\n${REDIRECT_MARK}\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>Moved</title>\n<link rel="canonical" href="${esc(canonical)}">\n` +
    '<meta name="robots" content="noindex">\n' +
    `<meta http-equiv="refresh" content="0; url=${esc(href)}">\n</head>\n` +
    `<body><p>This page has moved to <a href="${esc(href)}">${esc(canonical)}</a>.</p></body>\n</html>\n`;
}

export async function removeAll(storage, path) {
  if ((await storage.kind(path)) === 'dir') {
    for (const entry of (await storage.list(path)) || []) await removeAll(storage, `${path}/${entry.name}`);
  }
  await storage.remove(path);
}

async function keyLogOf(f, owner) {
  try {
    return await f.keyLog(owner);
  } catch {
    return null;
  }
}

async function ownerTag(site, owner, root = '') {
  const f = site.f;
  const name = esc(f.labelOf(objectId(owner, owner)) || short(owner));
  return (await keyLogOf(f, owner)) ? `<a class="owner" href="${root}owner/${owner}/">${name}</a>` : name;
}

async function writeHome(site, members, featured, fline, fmembers, groups) {
  const f = site.f;
  const here = (groups || []).map(([o, ms]) => [o, ms.filter((m) => !removed(f, m))]);
  const several = here.length > 1;
  const byOwner = several && (f.index.owners ?? 'together') === 'by-owner';
  const showOwner = several && !byOwner;
  const entry = async (m) => (await site.held(m) ? await localEntry(site, m, '', showOwner)
    : await remoteEntry(site, m, '', showOwner));
  const empty = '<li class="empty">No documents yet.</li>';
  const entries = [];
  let papersHtml, papersHeading = '';
  if (byOwner) {
    const blocks = [];
    for (const [owner, ms] of here) {
      const items = [];
      for (const m of ms) items.push(await entry(m));
      entries.push(...items);
      blocks.push([`<h2 class="owner-heading">${await ownerTag(site, owner)}</h2>`, items.join('\n') || empty]);
    }
    papersHeading = blocks[0][0];
    papersHtml = blocks[0][1] + blocks.slice(1).map(([h, body]) => `\n  </ol>\n${h}\n  <ol class="papers">\n${body}`).join('');
  } else {
    for (const m of several ? memberOrder(members) : members) entries.push(await entry(m));
    papersHtml = entries.join('\n') || empty;
  }
  let featuredHtml = '';
  if (featured) {
    const fdc = await fline.json('datacite.json', fline.signed);
    const items = [];
    for (const fm of fmembers) items.push(await site.held(fm) ? await localEntry(site, fm) : await remoteEntry(site, fm));
    featuredHtml = '<section class="featured">\n' +
      `<h2>${esc(fdc.titles[0].title)}</h2>\n<ol class="papers">\n` +
      (items.length ? items.join('\n') : '<li class="empty">No members yet.</li>') + '\n</ol>\n</section>';
  }
  let lead = 'Papers with their sources, every version, fixed by digests and signed by their owners. An ' +
    '<a href="https://opensheaf.org">OpenSheaf</a> archive: programs start from ' +
    '<a href="opensheaf.json">opensheaf.json</a>.';
  const cats = f.archiveOwners().filter((o) => f.catalogues.has(o)).map((o) => f.catalogues.get(o));
  const mainId = cats.length === 1 ? cats[0] : null;
  const cline = featured ? fline : mainId ? (site.lines.get(mainId) ||
    await site.held({ name: mainId.split(':')[1], owner: mainId.split(':')[2] })) : null;
  const cmem = cline ? ((await cline.json('members.json', cline.signed)) || {}) : {};
  if (featured || cmem.order === 'manual') {
    const cdc = await cline.json('datacite.json', cline.signed);
    const desc = (cdc.descriptions || [])[0]?.description ?? '';
    lead = esc(desc) + ' A collection in the <a href="https://opensheaf.org">OpenSheaf</a> format: each ' +
      'member is kept in its own archive and pinned by a digest' +
      (cmem.type === 'selection' ? ', in the versions its curator vetted' : '') +
      '; programs start from <a href="opensheaf.json">opensheaf.json</a>.';
  }
  const index = fill(await text(f, 'index.html'), {
    root: '', archive_name: esc(f.archive.name), base_url: esc(f.archive.baseUrl), lead,
    papers: papersHtml,
    featured: featuredHtml,
    papers_heading: papersHeading || (featured ? '<h2>In this archive</h2>' : ''),
    count: String(entries.length), updated: esc(fmtDate(f.env.today())),
  });
  await f.storage.write('index.html', new TextEncoder().encode(index));
  await f.storage.write('style.css', await template(f, 'style.css'));
  if (!(await f.storage.kind('.nojekyll'))) await f.storage.write('.nojekyll', new Uint8Array());
}

async function localEntry(site, m, root = '', showOwner = false) {
  const f = site.f;
  const line = await site.held(m);
  if (!pinsOk(m, line)) return remoteEntry(site, m, root, showOwner);
  const cur = presentedVersion(m, line.inv, line.objOf);
  const [pinVer, pin] = lastPin(m);
  const obj = await line.json(OBJ, cur);
  const dc = await line.json('datacite.json', cur);
  const issued = dateOf(dc, 'Issued');
  const pdf = await fileUrl(f, root, line, cur, pdfOf(obj));
  const abstract = abstractHtml(dc);
  const summary = obj.kind === 'collection' ? 'Description' : 'Abstract';
  const contested = [line.status(cur), line.status(pinVer)].includes(CONTESTED);
  return [
    `<li class="paper${line.withdrawn ? ' withdrawn' : ''}">`,
    `<a class="paper-title" href="${root}paper/${line.slug}/">${esc(dc.titles[0].title)}</a>`,
    `<div class="paper-authors">${esc(authorsOf(dc))}</div>`,
    `<div class="paper-meta">${esc((issued || '').slice(0, 4))}` +
      (showOwner ? ` · ${await ownerTag(site, m.owner, root)}` : '') + ` · ${versionsLine(m, obj)}` +
      (pdf ? ` · <a href="${esc(pdf)}">PDF</a>` : '') +
      (contested ? ' · <span class="contested">contested</span>' : '') +
      ` · ${pinHtml(pin)}</div>`,
    abstract ? `<details><summary>${summary}</summary>${abstract}</details>` : '',
    '</li>'].join('\n');
}

async function remoteEntry(site, m, root = '', showOwner = false) {
  const cite = m.cite || {};
  let title = cite.title || m.name, by = namesJoined(cite.creators || []);
  const year = cite.year ?? '';
  const pin = pinsOk(m) ? lastPin(m)[1] : null;
  const links = [];
  let abstract = '', landing = '', withdrawn = '';
  let at = (Array.isArray(m.at) && m.at.length ? m.at : [''])[0];
  at = typeof at === 'string' ? at : '';
  let archiveName = at;
  const view = pin ? await remoteView(site, m) : null;
  if (view === null) {
    links.push('<span class="missing">archive unavailable: cached citation</span>');
  } else if (view.mismatch) {
    ({ archive: archiveName, at } = view);
    links.push('<span class="contested">mismatch: its archive holds another version under this pin</span>');
  } else {
    ({ archive: archiveName, at, title, by, abstract, withdrawn, landing } = view);
    if (view.pdf) links.push(link(view.pdf, 'PDF'));
    if (landing) links.unshift(link(landing, 'landing page'));
  }
  return [
    `<li class="paper member${withdrawn ? ' withdrawn' : ''}">`,
    link(landing, esc(title), 'paper-title'),
    `<div class="paper-authors">${esc(by)}</div>`,
    `<div class="paper-meta">${esc(String(year))}` +
      (showOwner ? ` · ${await ownerTag(site, m.owner, root)}` : '') +
      ` · in ${link(at, esc(archiveName))}` +
      (m.revisions ? ` · ${versionsLine(m, {})}` : '') +
      (links.length ? ' · ' + links.join(' · ') : '') +
      ` · ${pinHtml(pin)}</div>`,
    withdrawn,
    abstract ? `<details><summary>Abstract</summary>${abstract}</details>` : '',
    '</li>'].join('\n');
}

function safePath(rel) {
  return typeof rel === 'string' && Boolean(rel) && !rel.startsWith('/') && !rel.includes('\\') &&
    rel.split('/').every((x) => !['', '.', '..'].includes(x));
}

async function remoteSource(site, at) {
  if (!site.remotes.has(at)) {
    site.remotes.set(at, (async () => {
      const url = at.endsWith('/') ? at : at + '/';
      const get = async (rel) => {
        try {
          return await site.http.cached(url + rel.split('/').map(encodeURIComponent).join('/'));
        } catch (error) {
          if (error.kind === 'not-found') return null;
          throw error;
        }
      };
      const raw = await get('opensheaf.json');
      if (raw === null) throw new Error('no discovery document');
      const disc = parseJson(raw, url + 'opensheaf.json');
      if (disc === null || typeof disc !== 'object' || disc.specification !== '0.2') throw new Error('not 0.2');
      if (Object.hasOwn(disc, 'objectPages')) disc.objects = await listedObjects(disc, get);
      const root = disc.storageRoot ?? 'ocfl/';
      if (typeof root !== 'string' || root.includes(':') || !safePath(root.replace(/\/+$/, '')) || !root.endsWith('/')) {
        throw new Error('storage root');
      }
      const hint = at.startsWith('https://') ? (at.endsWith('/') ? at : at + '/') : null;
      return { disc, root, get, at: hint };
    })());
  }
  return site.remotes.get(at);
}

async function remoteView(site, m) {
  const id = objectId(m.name, m.owner);
  const [pinVer, pin] = lastPin(m);
  for (const at of m.at || []) {
    try {
      const src = await remoteSource(site, at);
      const path = src.root + (await pathOf(id, src.disc.storageLayout)).join('/');
      const data = await src.get(`${path}/${pinVer}/inventory.json`);
      if (data === null) continue;
      const name = src.disc.name;
      const view = { archive: typeof name === 'string' && name ? name : at, at: src.at || at };
      if ((await sha512hex(data)) !== pin) return { ...view, mismatch: true };
      const inv = parseJson(data);
      const read = async (ver, logical, from = inv) => {
        const dig = Object.entries(from.versions[ver].state).find(([, ps]) => ps.includes(logical))?.[0] ?? null;
        const cp = dig ? from.manifest[dig][0] : null;
        const raw = cp && safePath(cp) ? await src.get(`${path}/${cp}`) : null;
        if (raw !== null && (await sha512hex(raw)) !== dig) throw new Error(`${cp}: not the file its inventory names`);
        return raw ? parseJson(raw) : null;
      };
      let shown;
      if (m.revisions) {
        shown = pinVer;
      } else {
        const hist = ((await read(pinVer, OBJ)) || {}).history;
        if (hist?.length) {
          shown = hist[hist.length - 1];
        } else {
          const last = new Map();
          for (let k = 1; k <= Number(pinVer.slice(1)); k++) {
            const o = Object.hasOwn(inv.versions, `v${k}`) ? await read(`v${k}`, OBJ) : null;
            if (o) last.set(o.documentVersion, `v${k}`);
          }
          if (!last.size) continue;
          shown = last.get(Math.max(...last.keys()));
        }
      }
      view.dc = await read(shown, 'datacite.json');
      const lp = pdfOf((await read(shown, OBJ)) || {});
      const cp = lp ? contentPathOf(inv, shown, lp) : null;
      if (cp && safePath(cp) && src.at) view.pdf = `${src.at}${path}/${cp}`;
      const entry = (src.disc.objects || []).find((o) => o && typeof o === 'object' && o.id === id) || {};
      if (entry.status === 'withdrawn') {
        const rootInv = parseJson((await src.get(`${path}/inventory.json`)) || new TextEncoder().encode('{}'));
        const state = rootInv.versions ? await read(rootInv.head ?? pinVer, OBJ, rootInv) : null;
        view.state = state?.status === 'withdrawn' ? state : { status: 'withdrawn' };
      }
      if (!view.dc) continue;
      const dc = view.dc;
      Object.assign(view, { title: dc.titles[0].title, by: authorsOf(dc), abstract: abstractHtml(dc),
                            landing: safeUrl(dc.url), withdrawn: withdrawalHtml(view.state || {}, ' by its owner') });
      if (typeof view.title !== 'string' || typeof view.by !== 'string') continue;
      return view;
    } catch {
      continue;
    }
  }
  return null;
}

async function keeperLinkOf(site, log) {
  if (!site.keepers.has(log.owner)) site.keepers.set(log.owner, await keeperLink(log, site.keeperFetch || site.f.env.fetchJson));
  return site.keepers.get(log.owner);
}

async function keeperHtml(site, log) {
  const keeper = await keeperOf(log);
  if (!keeper) return '';
  const mark = (await keeperLinkOf(site, log)).status === CONFIRMED ? ' (confirmed)' : '';
  return `${link(keeper, esc(keeper))}${mark}`;
}

async function ownerHtml(site, owner, root) {
  const log = await keyLogOf(site.f, owner);
  const name = `<code>${esc(owner)}</code>`;
  let out = log ? `<a href="${root}owner/${owner}/">${name}</a>` : name;
  const keeper = log ? await keeperHtml(site, log) : '';
  if (keeper) out += ` · keeper ${keeper}`;
  const notes = ownerNotes(log);
  return out + (notes.length ? ` · <span class="contested">${esc(notes.join('; '))}</span>` : '');
}

export function ownerNotes(log) {
  if (!log) return [];
  const out = [];
  if (log.forkPoint) out.push(`ended by a fork of its key log at v${log.forkPoint}`);
  else if (log.ended) out.push('ended');
  if (log.successor) out.push(`successor ${log.successor}`);
  const exposed = log.exposedKeys();
  if (exposed.size) out.push(`${exposed.size} key${exposed.size !== 1 ? 's' : ''} exposed`);
  return out;
}

async function ownerPage(site, owner, log, lines) {
  const f = site.f;
  const side = log.side();
  const last = side.length ? side[side.length - 1] : null;
  const keys = last ? (last.keys || {}) : {};
  const facts = [`<li>Key log <code class="copy">sheaf:${esc(owner)}</code>, ${log.versions.length} version` +
    `${log.versions.length !== 1 ? 's' : ''}` +
    (last ? `; latest <code class="copy">sheaf:${esc(owner)}/v${last.number}?sha512=${last.digest}</code>` : '') +
    '</li>'];
  const keeper = await keeperHtml(site, log);
  if (keeper) {
    facts.push(`<li>Keeper: ${keeper}</li>`);
    const link = await keeperLinkOf(site, log);
    const claim = successorClaim(log, link);
    if (claim) facts.push(`<li>Successor ${esc(claim)}: <code>${esc(link.successor)}</code></li>`);
  }
  const latest = log.latest();
  if (latest !== null) {
    facts.push(`<li>Current keys (${latest.keys.threshold} of ${latest.keys.keys.length} sign):` +
      '<ul>' + latest.keys.keys.map((k) => `<li><code>${esc(k)}</code></li>`).join('') + '</ul></li>');
    facts.push(`<li>Rotation keys committed to: ${(keys.next || []).length}, of which ` +
      `${keys.nextThreshold ?? 'None'} sign the next version of the key log</li>`);
  }
  facts.push(`<li>Rotations, exposures and ends: ${Math.max(side.length - 1, 0)}</li>`);
  const exposed = [...log.exposedKeys()].sort(compareText);
  if (exposed.length) {
    facts.push('<li class="contested">Exposed keys (what they alone signed is contested):<ul>' +
      exposed.map((k) => `<li><code>${esc(k)}</code></li>`).join('') + '</ul></li>');
  }
  if (log.forkPoint) facts.push(`<li class="contested">Ended by a fork of its key log at v${log.forkPoint}</li>`);
  else if (log.ended) facts.push('<li class="contested">Ended: it signs nothing more</li>');
  if (log.successor) facts.push(`<li>Successor named by its ending version: <code>${esc(log.successor)}</code></li>`);
  const items = [];
  for (const ln of lines) {
    const title = ((await ln.json('datacite.json', ln.signed)) || {}).titles?.[0]?.title ?? ln.slug;
    items.push(`<li><a href="../../paper/${ln.slug}/">${esc(title)}</a> <code class="small">${esc(fullUri(ln))}</code></li>`);
  }
  return fill(await text(f, 'owner.html'), {
    root: '../../', archive_name: esc(f.archive.name), base_url: esc(f.archive.baseUrl),
    owner: esc(owner), facts: facts.join('\n'),
    lines: items.length ? items.join('\n') : '<li class="empty">No lines with a page here.</li>' });
}

export async function catalogueGroups(f) {
  const out = [];
  for (const owner of f.archiveOwners()) {
    const cid = f.catalogues.get(owner);
    const dir = cid ? await f.dirOf(cid) : null;
    const inv = dir ? await f.inventory(dir) : null;
    if (inv === null) continue;
    const ver = await f.latestSigned(cid);
    if (ver === null) {
      f.env.err(`warning: the owner catalogue of ${short(owner)} has no signed version (section 7.3): ` +
                'none of its members is presented');
      continue;
    }
    out.push([owner, (await f.readObjectJson(dir, inv, 'members.json', ver)).members]);
  }
  return out.length ? out : null;
}

export async function catalogueMembers(f) {
  const groups = await catalogueGroups(f);
  return groups === null ? null : groups.flatMap(([, ms]) => ms);
}

export function hasWebsite(f) {
  return Boolean(f.index.html || f.index.template);
}

export async function readableIndex(f, options = {}) {
  const groups = await catalogueGroups(f);
  if (groups === null) return;
  const members = groups.flatMap(([, ms]) => ms);
  if (!['together', 'by-owner'].includes(f.index.owners ?? 'together')) {
    exit(`osheaf.json: index.owners is together or by-owner, not ${f.index.owners}`);
  }
  if (f.index.template && !f.index.html) {
    const { quiet = false, ...rest } = options;
    const pages = await render(f, members, { ...rest, home: false });
    if (quiet) return;
    f.env.warn('the TeXmacs index (index.tm, from index.template) is typeset by opensheaf-py: run osheaf index of ' +
               'opensheaf-py to write it again');
    f.env.out(`Done: opensheaf.json, ${plural(pages, 'landing page')} and sitemap.xml written.`);
    return;
  }
  const html = f.index.html && typeof f.index.html === 'object' ? f.index.html : {};
  const featured = html.featured || null;
  let fid = null;
  if (featured) {
    fid = f.labels.get(featured) ?? null;
    if (fid === null) {
      exit(`osheaf.json: index.html.featured names ${featured}, which is not a label of this archive`);
    }
    const fd = await f.dirOf(fid);
    if (((await f.readObjectJson(fd, await f.inventory(fd), OBJ)) || {}).kind !== 'collection') {
      exit(`osheaf.json: index.html.featured names ${featured}, which is not a collection`);
    }
  }
  const pages = await render(f, members, { featured: fid, groups, ...options });
  f.env.out(`Done: opensheaf.json, index.html, ${plural(pages, 'landing page')} and sitemap.xml written.`);
}

export async function present(f) {
  if (!hasWebsite(f) || f.old) return;
  try {
    await readableIndex(f, f.index.html ? {} : { quiet: true });
  } catch (error) {
    f.env.err(`warning: the website was not regenerated (${error.message}); run osheaf index`);
  }
}

export async function labelCommand(f, args) {
  const env = f.env;
  const given = [args.line, args.label].filter((x) => x);
  const owner = args.owner || null, unset = Boolean(args.unset);
  let id, fresh, extra;
  if (owner) {
    if (!OWNER_NAME_RE.test(owner)) exit(`--owner: an owner name, not ${owner}`);
    id = `sheaf:${owner}:${owner}`;
    if ((await f.storage.kind(joinPath(await f.dirOf(id), 'inventory.json'))) !== 'file') {
      exit(`the archive holds no key log of ${owner}`);
    }
    [fresh = null, ...extra] = given;
  } else {
    if (!given.length) exit('osheaf label LINE LABEL, or osheaf label --owner OWNER LABEL; --unset removes the label');
    id = await lineOf(f, given[0]);
    fresh = given[1] ?? null;
    extra = given.slice(2);
  }
  if (id.startsWith('sheaf:draft:')) exit('a draft has no label: its identifier names it (section 10.1)');
  if (extra.length || Boolean(fresh) === unset) exit('give the new label, or --unset');
  const old = f.labelOf(id);
  const cfg = await readJson(f.storage, CONFIG_NAME);
  const featured = cfg.index?.html?.featured;
  if (fresh) {
    if (!LABEL.test(fresh) || fresh.length > 64) {
      exit('a label must match ^[a-z0-9]+(-[a-z0-9]+)*$ and have at most 64 characters');
    }
    if (fresh === old) {
      env.out(`${fresh}: unchanged`);
      if (owner) await relabelCatalogue(f, owner, old, featured);
      return;
    }
    if (f.labels.has(fresh)) exit(`${fresh} is the label of another line already: ${f.labels.get(fresh)}`);
    if (fresh.length > 32) env.err(`warning: ${fresh} is longer than 32 characters (it appears in every URL of the website)`);
  } else if (old === null) {
    env.out(`${id}: has no label`);
    return;
  } else if (old === featured) {
    exit(`${old} names the featured collection in ${CONFIG_NAME}: give it another label instead`);
  }
  const dir = await f.dirOf(id);
  const kind = ((await f.readObjectJson(dir, await f.inventory(dir), OBJ)) || {}).kind;
  const before = await pageAddress(f, id);
  if (old) f.labels.delete(old);
  if (fresh) f.labels.set(fresh, id);
  const after = await pageAddress(f, id);
  const former = { ...(cfg.formerAddresses || {}) };
  delete former[after];
  const moves = before !== after && (kind === 'document' ||
    (kind === 'collection' && (await f.storage.kind(`paper/${before}/index.html`)) === 'file'));
  if (moves) {
    former[before] = id;
    await moveHtmlVersion(f, id, before, after, former);
  }
  const sorted = Object.entries(former).sort((a, b) => compareText(a[0], b[0]));
  if (sorted.length) cfg.formerAddresses = Object.fromEntries(sorted);
  else delete cfg.formerAddresses;
  if (old && featured === old) cfg.index.html.featured = fresh;
  await f.writeConfig(cfg);
  f.changed();
  await writeDiscovery(f);
  env.out(fresh ? `Done: ${id} is labelled ${fresh}` + (old ? `, no longer ${old}.` : '.')
    : `Done: ${id} has no label any more (it was ${old}).`);
  if (moves) env.out(`Its old address paper/${before}/ leads to paper/${after}/ (${CONFIG_NAME}, formerAddresses).`);
  const relabelled = Boolean(owner) && await relabelCatalogue(f, owner, old, featured);
  if (f.index.template && !relabelled) env.out('Run osheaf index to typeset the TeXmacs index with the new label.');
}

async function relabelCatalogue(f, owner, old, featured) {
  const cat = f.catalogues.get(owner);
  if (owner === f.archive.owner || !cat) return false;
  const have = f.labelOf(cat), wanted = catalogueLabel(f, owner);
  if (have === wanted || ![null, old ? `${old}-catalogue` : null].includes(have)) return false;
  if ((wanted && f.labels.has(wanted)) || (wanted === null && have === featured)) {
    f.env.out(`The owner catalogue ${have || cat} keeps its label: ` +
              (wanted ? `${wanted} is taken.` : 'it is the featured collection.'));
    return false;
  }
  await labelCommand(f, { line: cat, label: wanted, owner: null, unset: wanted === null });
  return true;
}

const OWNER_NAME_RE = /^[a-z2-7]{52}$/;

async function redirectOnly(f, folder, address) {
  if ((await f.storage.kind(folder)) !== 'dir') return false;
  const entries = (await f.storage.list(folder)) || [];
  if (entries.length !== 1 || entries[0].name !== `${address}.html` || entries[0].kind !== 'file') return false;
  return new TextDecoder().decode(await f.storage.read(`${folder}/${address}.html`)).includes(REDIRECT_MARK);
}

async function moveTree(storage, from, to) {
  for (const e of (await storage.list(from)) || []) {
    if (e.kind === 'dir') await moveTree(storage, `${from}/${e.name}`, `${to}/${e.name}`);
    else await storage.write(`${to}/${e.name}`, await storage.read(`${from}/${e.name}`));
  }
  await removeAll(storage, from);
}

async function moveHtmlVersion(f, id, before, after, former) {
  const src = `site/${before}`, dst = `site/${after}`;
  if ((await f.storage.kind(`${src}/${before}.html`)) !== 'file' || (await redirectOnly(f, src, before))) return;
  if (await f.storage.kind(dst)) {
    if (!(await redirectOnly(f, dst, after))) exit(`${dst} is in the way of the HTML version of ${id}`);
    await removeAll(f.storage, dst);
  }
  await moveTree(f.storage, src, dst);
  await f.storage.write(`${dst}/${after}.html`, await f.storage.read(`${dst}/${before}.html`));
  await f.storage.remove(`${dst}/${before}.html`);
  for (const [address, i] of Object.entries(former)) {
    if (i === id && LABEL.test(address)) {
      await writeText(f.storage, `site/${address}/${address}.html`,
                      redirectPage(`../${after}/${after}.html`, `${f.archive.baseUrl}site/${after}/${after}.html`));
    }
  }
}
