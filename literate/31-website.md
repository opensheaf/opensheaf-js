The website
===========

An archive of the profile `website` (appendix A.3) is served as a website:
a home page presenting the latest signed versions of the owner catalogues, a
landing page for each line at `paper/<label>/` (its full `sheaf:` URI, its
owner and keeper, every signed document version of its history with its
status, notices, files and pin, the withdrawal if any, and the metadata
read by search engines), a page for each owner at `owner/<owner>/`, and a
sitemap. This chapter ports opensheaf-py's chapters
[30-website](https://opensheaf.org/opensheaf-py/30-website.html) and
[31-templates](https://opensheaf.org/opensheaf-py/31-templates.html): the
same pages, from the same templates, filled in the same way, so that the
two programs write the same HTML for the same archive, byte for byte (the
date of the home page and the dates of the sitemap aside, which are those
of the day and of the inventories).

The templates are opensheaf-py's own files, copied unchanged into
[`templates/`](../templates/) of this repository (a test of chapter
[72](72-tests-parity.md) checks that they are the files `osheaf init` of
opensheaf-py writes). `osheaf init` copies them into the archive, where the
curator edits them; the pages are made from the archive's templates
(`index.html.templates` of `osheaf.json`, else `templates/`), or from the
defaults when a file is missing there. They still say "made with
opensheaf-py": they are that program's templates, and an archive kept by
both stays one archive.

The home page of an archive whose readable index is a TeXmacs document
(`index.template`) is typeset by opensheaf-py; this program writes the
website only, and warns.

    // in core/website.js:
    import { readGenesis, objectId, parseId, SheafUri } from './names.js';
    import { historyOf, currentVersion, dateOf, pdfOf, memberPins, withdrawnVersions } from './versions.js';
    import { CONTESTED, SIGNED, VOUCHED } from './signatures.js';
    import { Http } from './http.js';
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

    <<small pieces>>

    <<the lines presented>>

    <<a version of a line>>

    <<the metadata of a landing page>>

    <<writing the pages>>

    <<the entries of members>>

    <<owners and keepers>>

    <<the website after a change>>

    <<changing a label>>

Small pieces
------------

Text is escaped as Python's `html.escape` escapes it, quotes included.
Placeholders `{{name}}` are replaced one after the other, in the order
opensheaf-py gives them, with no interpretation of the text put in (a
`$` stays a `$`).

    // in small pieces:
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

The landing page of a line is written at the address built from its
name, which fixed files record and which never changes (`nameAddress`,
chapter [26](26-deposit.md)), and, for a line with a label, also at its
label, the address the pages link to and the canonical one: the same page
at both, so that the readable address and the permanent one both work
(appendix A.3), as opensheaf-py's `page_address` and `name_address`.

    // in small pieces:
    export async function pageAddress(f, id) {
      return f.labelOf(id) || nameAddress(f, id);
    }

The lines presented
-------------------

A line held in the storage root, as the pages present it: its folder and
inventory, the statuses of its versions against its owner's key log, its
latest signed version, and the state of the line read from that version
(section 13.1). The pages of one run share the lines they read.

    // in the lines presented:
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

A version of a line
-------------------

One document version on a landing page: its number and labels, its stage,
whether it is the current or a vetted one, its status when it is not
plainly signed, its date, its withdrawal if it is withdrawn (also after a
new document version has reinstated the line, section 13.1), its change
note, its files (the PDF, the source, the inventory, the records
elsewhere, arXiv, the DOI), its pin, and the notices about it.

A branch numbers its own document versions from 1, and a version that
holds a branch point (the first, and each new branch point) also shows the
number of the parent version, which `parent.documentVersion` keeps:
"Version 1 (the parent's version 3)" (section 9.4).

    // in the number in the parent line of a version of a branch:
    const vs = Object.keys(line.inv.versions);
    const first = vs.find((v) => line.objOf(v)?.documentVersion === n);
    const par = first ? line.objOf(first)?.parent : null;
    if (par && (vs.indexOf(first) === 0 || !same(line.objOf(vs[vs.indexOf(first) - 1])?.parent ?? null, par))) {
      labels.unshift(`the parent's version ${par.documentVersion}`);
    }

The links to the files of a version, and the version itself:

    // in a version of a line:
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
      <<the number in the parent line of a version of a branch>>
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
      const withdrawn = withdrawnVersions(line.inv, line.objOf, line.signed || line.inv.head);
      if (withdrawn.has(n)) out.push(withdrawalHtml(line.objOf(withdrawn.get(n))));
      if (changesNote(obj)) out.push(`<div class="changes">${esc(changesNote(obj))}</div>`);
      out.push(`<div class="files">${files.filter(Boolean).join(' · ')}</div>`);
      const uri = await pinUri(line, ver);
      out.push(`<div class="pin" title="${esc(uri)}">${ver} · pin <code class="copy" data-copy="${esc(uri)}">` +
               `${line.digest(ver).slice(0, 32)}…</code> (<a href="${root}ocfl/${at}/` +
               `${ver}/inventory.json">inventory</a>)</div>`);
      <<the notices about a version>>
      out.push('</li>');
      return out.join('\n');
    }

The notices come from the latest signed version, and each current one is
shown under the version it is about, with its number; a notice replaced by
a later one is not, and the one replacing it says so (section 4.2). A
notice with a file (a full statement, with mathematics or as a PDF) links
to it, as stored in that version.

    // in the notices about a version:
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

The metadata of a landing page
------------------------------

Google Scholar's `citation_*` tags, a schema.org description in JSON-LD
(written as Python's `json.dumps` writes it, with its spaces), and FAIR
Signposting links.

    // in the metadata of a landing page:
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

Writing the pages
-----------------

`render` writes `index.html`, a landing page for every line presented,
the owner pages, `style.css` and `sitemap.xml`, and removes the landing
pages and owner pages of lines no longer presented. The lines presented
are the members of the owner catalogues held here, those of the featured
collection, the members of the collections among them, followed once, and
every labelled line with a signed version that is a document or a
collection. It returns the number of landing pages.

    // in writing the pages:
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
        for (const address of new Set([line.home, line.slug])) {
          await f.storage.write(`paper/${address}/index.html`, new TextEncoder().encode(page));
          written.push(address);
        }
        const lastmod = line.inv.versions[line.inv.head].created.slice(0, 10);
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

The pages at the former addresses of lines whose label changed
(`formerAddresses` of `osheaf.json`, written by `osheaf label`, below),
where no page of a line is: a small page sending the reader on, marked,
out of the sitemap (opensheaf-py's `redirect_page`).

    // in writing the pages:
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

The home page lists the members of the owner catalogues, after those of
the featured collection, if any; its lead paragraph presents the archive,
or the featured collection, or the one owner catalogue of an archive with
one, curated (order `manual`), by its description. An archive with one
owner lists its catalogue's members in their order. With several owners,
`index.owners` of the configuration decides (appendix A.3, as
opensheaf-py's website): `together`, the default, one list ordered as an
owner catalogue is (`memberOrder`), each entry naming the owner of its
line after its year; `by-owner`, a heading for each owner, in the order of
the owners, each catalogue in its order, the first heading in place of
`{{papers_heading}}` and each later one closing the list and opening
another, so that templates written before keep working. The owner is
named by the label of its key log or the beginning of its name, linked to
its page (`ownerTag`).

    // in writing the pages:
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

The entries of members
----------------------

A member held here is shown in the version its collection presents, with
its PDF and its pin; a member held elsewhere is read from the first
location of its `at` that answers and whose copy matches the pin (its
title, authors, abstract, landing page and PDF), or else shown from the
citation cached in the member.

    // in the entries of members:
    async function localEntry(site, m, root = '', showOwner = false) {
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
        `<div class="paper-meta">${esc((issued || '').slice(0, 4))}` +
          (showOwner ? ` · ${await ownerTag(site, m.owner, root)}` : '') + ` · ${versionsLine(m, obj)}` +
          (pdf ? ` · <a href="${esc(pdf)}">PDF</a>` : '') +
          (contested ? ' · <span class="contested">contested</span>' : '') +
          ` · <span class="pin" title="${pin}">pin ${pin.slice(0, 32)}…</span></div>`,
        abstract ? `<details><summary>${summary}</summary>${abstract}</details>` : '',
        '</li>'].join('\n');
    }

    async function remoteEntry(site, m, root = '', showOwner = false) {
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
        `<div class="paper-meta">${esc(String(year))}` +
          (showOwner ? ` · ${await ownerTag(site, m.owner, root)}` : '') +
          ` · in <a href="${esc(at)}">${esc(archiveName)}</a>` +
          (m.revisions ? ` · ${versionsLine(m, {})}` : '') +
          (links.length ? ' · ' + links.join(' · ') : '') +
          ` · <span class="pin" title="${pin}">pin ${pin.slice(0, 32)}…</span></div>`,
        withdrawn,
        abstract ? `<details><summary>Abstract</summary>${abstract}</details>` : '',
        '</li>'].join('\n');
    }

A copy elsewhere is read over HTTP (`env.fetch`, which the command line
points at the locations configured, as opensheaf-py's `OPENSHEAF_LOCATIONS`
does). The address recorded for its files is the location given when it is
an `https` one, as opensheaf-py records it. A discovery document with
pages has its entries read from them (`listedObjects`, chapter
[25](25-discovery.md)), as opensheaf-py's `Source` reads them.

    // in the entries of members:
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

Owners and keepers
------------------

The owner of a line, on its landing page: its name, linked to its page,
its keeper, marked `(confirmed)` when the keeper confirms the link (section
6.6, read once per run, chapter [32](32-keepers.md), and what a reader is
told about it: an end, a fork, a successor, exposed keys.

    // in owners and keepers:
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

The page of an owner summarises its key log as the archive holds it, and
lists its lines that have a page here.

    // in owners and keepers:
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

The website after a change
--------------------------

The members presented are those of the owner catalogues, in the order of
the owners (appendix A.3), each read from the latest signed version of its
catalogue, not from its head (section 7.3). An owner catalogue without a
signed version presents none of its members, and the command says so; an
archive none of whose catalogues has a signed version presents nothing.
The members are given by owner (`catalogueGroups`), for a home page that
groups them so, or in one list; `index.owners` is `together` or
`by-owner`, and another value stops the command. `osheaf index` writes the discovery document, the indexes and
the website; every command that changes the archive writes the website
again (`present`), and a failure there leaves the change made and says to
run `osheaf index`. A featured collection must be a collection of the
archive.

    // in the website after a change:
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
      if (f.index.template && !f.index.html) {
        f.env.warn('the TeXmacs index (index.template) is written by opensheaf-py: run osheaf index of ' +
                   'opensheaf-py to write it and its landing pages again');
        return;
      }
      const groups = await catalogueGroups(f);
      if (groups === null) return;
      const members = groups.flatMap(([, ms]) => ms);
      if (!['together', 'by-owner'].includes(f.index.owners ?? 'together')) {
        exit(`osheaf.json: index.owners is together or by-owner, not ${f.index.owners}`);
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
        await readableIndex(f);
      } catch (error) {
        f.env.err(`warning: the website was not regenerated (${error.message}); run osheaf index`);
      }
    }

Changing a label
----------------

`osheaf label` (opensheaf-py's `label_command`, in its chapter
[10](https://opensheaf.org/opensheaf-py/10-archive.html)): a line held
here, named by its label or identifier, or an owner object (`--owner`),
gets a label, a new one, or none (`--unset`). The label has the form of
section 3.1 and is not another line's; the featured collection is renamed
in `osheaf.json` with it, and cannot lose it. The owner catalogues are
named by their identifiers in the discovery document, and their labels are
free; that of an owner other than the archive's first is labelled after
the owner (`catalogueLabel`), so a new label of such an owner is given to
its catalogue too, as `<label>-catalogue`, when the catalogue has no label
or that of the owner's old one, and the new one is free; a label taken off
the owner is taken off its catalogue so labelled (`relabelCatalogue`);
giving an owner the label it has labels its catalogue so, if it has none. The
discovery document and the indexes are written again, and the website by
the command line after the command. A document or a collection whose page
moves leaves its old address in `formerAddresses` of `osheaf.json`, where
`render` (above) writes a page that sends readers on; its HTML version,
`site/<label>/<label>.html`, moves with its other files, and a page of the
same kind is left at each of its former addresses. A collection's
description gives the archive's address, not that of its page, so its old
address is kept only if it had a page there.

    // in changing a label:
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

The HTML version moves with its folder, file by file (a storage has no
rename), its HTML file renamed for the new address; a folder at the new
place is in the way only if it is more than a page of a former address.

    // in changing a label:
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
