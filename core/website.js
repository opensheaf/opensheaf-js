// Generated from literate/31-website.md by opensheaf-literate: edit the document, not this file.
import { readGenesis, objectId, parseId, SheafUri } from './names.js';
import { historyOf, currentVersion, dateOf, pdfOf, memberPins } from './versions.js';
import { CONTESTED, SIGNED, VOUCHED } from './signatures.js';
import { Http } from './http.js';
import { pathOf } from './paths.js';
import { sha512hex } from './write.js';
import { compareText, joinPath } from './storage.js';
import { GENESIS, OBJ, plural, exit } from './folder.js';
import { displayName } from './deposit.js';
import { keeperOf, keeperLink, successorClaim, CONFIRMED } from './keepers.js';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

export function fill(text, values) {
  for (const [k, v] of Object.entries(values)) text = text.split(`{{${k}}}`).join(v);
  return text;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
                'October', 'November', 'December'];

export function fmtDate(iso) {
  if (!iso) return '';
  const parts = iso.split('/')[0].split('-');
  if (parts.length === 3) return `${Number(parts[2])} ${MONTHS[Number(parts[1]) - 1]} ${parts[0]}`;
  if (parts.length === 2) return `${MONTHS[Number(parts[1]) - 1]} ${parts[0]}`;
  return parts[0];
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

export async function pageAddress(f, id, ids = null) {
  const label = f.labelOf(id);
  if (label) return label;
  const [, name, owner] = id.split(':');
  ids ??= (await f.objects()).map((o) => o.id);
  const same = ids.filter((i) => typeof i === 'string' && i.startsWith(`sheaf:${name}:`));
  return same.length <= 1 ? name : `${name}-${owner}`;
}

export class Site {
  constructor(f, { keeperFetch = null, home = true } = {}) {
    this.f = f;
    this.home = home;
    this.lines = new Map();
    this.keepers = new Map();
    this.keeperFetch = keeperFetch;
    this.remotes = new Map();
    this.ids = null;
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
    this.ids ??= (await f.objects()).map((o) => o.id);
    const slug = await pageAddress(f, id, this.ids);
    let originator = null;
    try {
      const g = await f.readLogical(dir, inv, GENESIS, 'v1');
      originator = g ? (await readGenesis(g)).originator ?? null : null;
    } catch {
      originator = null;
    }
    const read = await f.line(id);
    const json = (logical, ver = null) => f.readObjectJson(dir, inv, logical, ver);
    const line = { id, name, owner, dir, inv, slug, originator, statuses: read.statuses, signed: read.latest,
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
    const ns = m.revisions.map((r) => String(r.documentVersion));
    return `vetted: version${ns.length > 1 ? 's' : ''} ${ns.join(', ')}`;
  }
  return `version ${obj.documentVersion}`;
}

async function versionBlock(f, line, ver, shown, notices, root, vetted = null) {
  const obj = await line.json(OBJ, ver);
  const dc = await line.json('datacite.json', ver);
  const n = obj.documentVersion;
  const labels = (obj.external || []).filter((e) => e.role === 'source' && e.label).map((e) => `${e.service} ${e.label}`);
  let head = `Version ${n}` + (labels.length ? ` (${esc(labels.join(', '))})` : '');
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
      files.push(`<a href="${esc(e.record)}">${esc(label)}</a>`);
    }
  }
  if (arxiv && !(obj.external || []).some((e) => e.service === 'arXiv')) {
    files.push(`<a href="https://arxiv.org/abs/${esc(arxiv)}">arXiv:${esc(arxiv)}</a>`);
  }
  if (dc.doi) files.push(`<a href="https://doi.org/${esc(dc.doi)}">doi:${esc(dc.doi)}</a>`);
  const out = [`<li class="version${n === shown ? ' is-current' : ''}" id="v${n}">`,
               `<div class="version-head">${head}</div>`];
  if (when) out.push(`<div class="version-date">${esc(when)}</div>`);
  if (changesNote(obj)) out.push(`<div class="changes">${esc(changesNote(obj))}</div>`);
  out.push(`<div class="files">${files.filter(Boolean).join(' · ')}</div>`);
  const uri = await pinUri(line, ver);
  out.push(`<div class="pin" title="${esc(uri)}">${ver} · pin <code class="copy" data-copy="${esc(uri)}">` +
           `${line.digest(ver).slice(0, 32)}…</code> (<a href="${root}ocfl/${at}/` +
           `${ver}/inventory.json">inventory</a>)</div>`);
  for (const x of notices) {
    if (x.documentVersion === n) {
      const src = line.signed || line.inv.head;
      const link = x.path ? ` ${await fileLink(f, root, line, src, x.path, 'statement')}` : '';
      out.push(`<div class="notice"><strong>Notice (${esc(fmtDate(x.date))}):</strong> ` +
               `${esc(x.text ?? '')}${link}</div>`);
    }
  }
  out.push('</li>');
  return out.join('\n');
}

async function metaTags(f, line, cur, obj, dc) {
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
  const rights = (dc.rightsList?.length ? dc.rightsList : [{}])[0];
  const cite = dc.doi ? `https://doi.org/${dc.doi}` : landing;
  tags.push(`<link rel="canonical" href="${esc(landing)}">`,
            `<link rel="cite-as" href="${esc(cite)}">`,
            `<link rel="describedby" href="${esc(await fileUrl(f, base, line, cur, 'datacite.json'))}"` +
            ' type="application/vnd.datacite.datacite+json">');
  if (pdf) tags.push(`<link rel="item" href="${esc(pdf)}" type="application/pdf">`);
  if (rights.rightsUri) tags.push(`<link rel="license" href="${esc(rights.rightsUri)}">`);
  const ld = { '@context': 'https://schema.org', '@type': 'ScholarlyArticle', name: dc.titles[0].title, url: landing,
               author: dc.creators.map((c) => ({ '@type': 'Person', name: displayName(c) })),
               datePublished: date, version: dc.version,
               identifier: [...(dc.doi ? [`https://doi.org/${dc.doi}`] : []), fullUri(line)] };
  if (pdf) ld.encoding = { '@type': 'MediaObject', contentUrl: pdf, encodingFormat: 'application/pdf' };
  if (abstract) ld.abstract = abstract;
  if (rights.rightsUri) ld.license = rights.rightsUri;
  tags.push('<script type="application/ld+json">' + pyJson(ld).replace(/<\//g, '<\\/') + '</script>');
  return tags.join('\n');
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

export async function render(f, members, { home = true, featured = null, keeperFetch = null } = {}) {
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
      if (!line) continue;
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
    if (rights.rightsUri) licence = `<a href="${esc(rights.rightsUri)}">${licence}</a>`;
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
      head: await metaTags(f, line, cur, obj, dc), title: esc(dc.titles[0].title),
      issued: esc(fmtDate(issued)), withdrawn: withdrawalHtml(line.state), contested,
      versions: blocks.join('\n'), licence, cite,
      pin, pin_url: `${root}ocfl/${at}/${pinVer}/inventory.json`,
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
        pdf: esc((await fileUrl(f, root, line, cur, pdfOf(obj))) || `#v${obj.documentVersion}`),
        html_link: htmlLink });
    }
    await f.storage.write(`paper/${line.slug}/index.html`, new TextEncoder().encode(page));
    written.push(line.slug);
    const lastmod = line.inv.versions[line.inv.head].created.slice(0, 10);
    urls.push([`${base}paper/${line.slug}/`, lastmod]);
    if (htmlLink) urls.push([`${base}site/${line.slug}/${line.slug}.html`, lastmod]);
  }
  if (home) {
    await writeHome(site, members, featured, fline, fmembers);
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
  for (const [folder, keep] of [['paper', new Set(written)], ['owner', new Set(ownerPages)]]) {
    for (const entry of (await f.storage.list(folder)) || []) {
      if (entry.kind === 'dir' && !keep.has(entry.name)) await removeAll(f.storage, `${folder}/${entry.name}`);
    }
  }
  return written.length;
}

async function removeAll(storage, path) {
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

async function writeHome(site, members, featured, fline, fmembers) {
  const f = site.f;
  const entries = [];
  for (const m of members) entries.push(await site.held(m) ? await localEntry(site, m) : await remoteEntry(site, m));
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
  const mainId = f.labels.get(f.archive.mainCollection);
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
    papers: entries.length ? entries.join('\n') : '<li class="empty">No documents yet.</li>',
    featured: featuredHtml,
    papers_heading: featured ? '<h2>In this archive</h2>' : '',
    count: String(entries.length), updated: esc(fmtDate(f.env.today())),
  });
  await f.storage.write('index.html', new TextEncoder().encode(index));
  await f.storage.write('style.css', await template(f, 'style.css'));
  if (!(await f.storage.kind('.nojekyll'))) await f.storage.write('.nojekyll', new Uint8Array());
}

async function localEntry(site, m, root = '') {
  const f = site.f;
  const line = await site.held(m);
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
    `<div class="paper-meta">${esc((issued || '').slice(0, 4))} · ${versionsLine(m, obj)}` +
      (pdf ? ` · <a href="${esc(pdf)}">PDF</a>` : '') +
      (contested ? ' · <span class="contested">contested</span>' : '') +
      ` · <span class="pin" title="${pin}">pin ${pin.slice(0, 32)}…</span></div>`,
    abstract ? `<details><summary>${summary}</summary>${abstract}</details>` : '',
    '</li>'].join('\n');
}

async function remoteEntry(site, m, root = '') {
  const cite = m.cite || {};
  let title = cite.title || m.name, by = namesJoined(cite.creators || []);
  const year = cite.year ?? '';
  const pin = lastPin(m)[1];
  const links = [];
  let abstract = '', landing = '', withdrawn = '';
  let at = (m.at?.length ? m.at : [''])[0];
  let archiveName = at;
  const view = await remoteView(site, m);
  if (view === null) {
    links.push('<span class="missing">archive unavailable: cached citation</span>');
  } else if (view.mismatch) {
    ({ archive: archiveName, at } = view);
    links.push('<span class="contested">mismatch: its archive holds another version under this pin</span>');
  } else {
    ({ archive: archiveName, at } = view);
    const dc = view.dc;
    title = dc.titles[0].title;
    by = authorsOf(dc);
    abstract = abstractHtml(dc);
    if (view.pdf) links.push(`<a href="${esc(view.pdf)}">PDF</a>`);
    landing = dc.url || '';
    if (landing) links.unshift(`<a href="${esc(landing)}">landing page</a>`);
    withdrawn = withdrawalHtml(view.state || {}, ' by its owner');
  }
  return [
    `<li class="paper member${withdrawn ? ' withdrawn' : ''}">`,
    landing ? `<a class="paper-title" href="${esc(landing)}">${esc(title)}</a>`
      : `<span class="paper-title">${esc(title)}</span>`,
    `<div class="paper-authors">${esc(by)}</div>`,
    `<div class="paper-meta">${esc(String(year))} · in <a href="${esc(at)}">${esc(archiveName)}</a>` +
      (m.revisions ? ` · ${versionsLine(m, {})}` : '') +
      (links.length ? ' · ' + links.join(' · ') : '') +
      ` · <span class="pin" title="${pin}">pin ${pin.slice(0, 32)}…</span></div>`,
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
      const disc = JSON.parse(new TextDecoder().decode(raw));
      if (disc === null || typeof disc !== 'object' || disc.specification !== '0.2') throw new Error('not 0.2');
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
      const view = { archive: src.disc.name || at, at: src.at || at };
      if ((await sha512hex(data)) !== pin) return { ...view, mismatch: true };
      const inv = JSON.parse(new TextDecoder().decode(data));
      const read = async (ver, logical, from = inv) => {
        const cp = contentPathOf(from, ver, logical);
        const raw = cp && safePath(cp) ? await src.get(`${path}/${cp}`) : null;
        return raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
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
        const rootInv = JSON.parse(new TextDecoder().decode((await src.get(`${path}/inventory.json`)) || new TextEncoder().encode('{}')));
        const state = rootInv.versions ? await read(rootInv.head ?? pinVer, OBJ, rootInv) : null;
        view.state = state?.status === 'withdrawn' ? state : { status: 'withdrawn' };
      }
      if (!view.dc) continue;
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
  return `<a href="${esc(keeper)}">${esc(keeper)}</a>${mark}`;
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

export async function mainMembers(f) {
  const mainId = f.labels.get(f.archive.mainCollection);
  const dir = mainId ? await f.dirOf(mainId) : null;
  const inv = dir ? await f.inventory(dir) : null;
  if (inv === null) return null;
  const ver = await f.latestSigned(mainId);
  if (ver === null) {
    f.env.err('warning: the main catalogue has no signed version (section 7.3): nothing is presented');
    return null;
  }
  return (await f.readObjectJson(dir, inv, 'members.json', ver)).members;
}

export function hasWebsite(f) {
  return Boolean(f.index.html || f.index.template);
}

export async function readableIndex(f, options = {}) {
  if (f.index.template && !f.index.html) {
    f.env.warn('the TeXmacs index (index.template) is written by opensheaf-py: run osheaf index of ' +
               'opensheaf-py to write it and its landing pages again');
    return;
  }
  const members = await mainMembers(f);
  if (members === null) return;
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
  const pages = await render(f, members, { featured: fid, ...options });
  f.env.out(`Done: opensheaf.json, index.html, ${plural(pages, 'landing page')} and sitemap.xml written.`);
}

export async function present(f) {
  if (!hasWebsite(f) || f.old) return;
  try {
    await readableIndex(f);
  } catch (error) {
    f.env.err(`warning: the website was not regenerated (${error.message}); run osheaf index`);
  }
}
