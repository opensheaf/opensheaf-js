Depositing documents
====================

`osheaf deposit LABEL SOURCE --pdf PDF --new` seals a new work (section
10.2) and makes the first version of its line; without `--new`, it adds
a new document version to the line labelled `LABEL`. This chapter ports
opensheaf-py's `deposit` (its chapter
[13-deposit](https://opensheaf.org/opensheaf-py/13-deposit.html)) for
every source that comes with its PDF, or a PDF alone (`--no-source`): the
same checks, the same `object.json` and `datacite.json`, field by field
and in the same order, so that the same deposit gives the same files.
A TeXmacs source without its PDF is typeset by opensheaf-py, which runs
TeXmacs; this program asks for the PDF (chapter [00](00-plan.md): TeXmacs
will be called as an external program later).

The command line reads the files and gives them as bytes; the module,
`core/deposit.js`, never touches a disk.

    // in core/deposit.js:
    import { LABEL } from './names.js';
    import { same } from './schema.js';
    import { dateOf, isEvidence } from './versions.js';
    import { jsonBytes } from './write.js';
    import { writeDiscovery } from './discovery.js';
    import { OBJ, OBJ_FORMAT, GENESIS, SPEC, exit } from './folder.js';
    import { joinPath } from './storage.js';

    <<licences>>

    <<creators and related works>>

    <<the history of a line, carried forward>>

    <<a deposit>>

Licences
--------

A licence is given by its SPDX key, one of five known with their names
and addresses, or as a statement in plain text, on one line. A word that
looks like an SPDX key and is not one of the five is refused, so that a
typing mistake does not become a licence. Without `--rights`, a new
version keeps the licence of the one before, and a first version has all
rights reserved.

    // in licences:
    export const RIGHTS = {
      'cc-by-4.0': { rights: 'Creative Commons Attribution 4.0 International',
                     rightsUri: 'https://creativecommons.org/licenses/by/4.0/',
                     rightsIdentifier: 'cc-by-4.0', rightsIdentifierScheme: 'SPDX' },
      'cc0-1.0': { rights: 'Creative Commons Zero v1.0 Universal',
                   rightsUri: 'https://creativecommons.org/publicdomain/zero/1.0/',
                   rightsIdentifier: 'cc0-1.0', rightsIdentifierScheme: 'SPDX' },
      'cc-by-sa-4.0': { rights: 'Creative Commons Attribution Share Alike 4.0 International',
                        rightsUri: 'https://creativecommons.org/licenses/by-sa/4.0/',
                        rightsIdentifier: 'cc-by-sa-4.0', rightsIdentifierScheme: 'SPDX' },
      'gpl-3.0-only': { rights: 'GNU General Public License v3.0 only',
                        rightsUri: 'https://www.gnu.org/licenses/gpl-3.0.html',
                        rightsIdentifier: 'gpl-3.0-only', rightsIdentifierScheme: 'SPDX' },
      'gpl-3.0-or-later': { rights: 'GNU General Public License v3.0 or later',
                            rightsUri: 'https://www.gnu.org/licenses/gpl-3.0.html',
                            rightsIdentifier: 'gpl-3.0-or-later', rightsIdentifierScheme: 'SPDX' },
    };

    export function rightsList(rights, prevDc = null) {
      if (rights) return [Object.hasOwn(RIGHTS, rights) ? { ...RIGHTS[rights] } : { rights }];
      if (prevDc?.rightsList?.length) return prevDc.rightsList;
      return [{ rights: 'All rights reserved' }];
    }

    export function checkRights(rights) {
      const known = Object.keys(RIGHTS).sort().join(', ');
      if (typeof rights !== 'string' || !rights.trim() || rights.length > 1000 || /[\u0000-\u001f\u007f]/.test(rights)) {
        throw new Error(`--rights is one of ${known}, or a statement on one line`);
      }
      if (!Object.hasOwn(RIGHTS, rights) && /^[a-z0-9][a-z0-9.+-]*$/.test(rights)) {
        throw new Error(`--rights ${rights}: not a licence known by its SPDX key (${known}); give one of ` +
                        'them, or the licence as a statement, by its name or its address');
      }
      return rights;
    }

Creators and related works
--------------------------

An author is given as `"Family, Given|Affiliation"`, as printed in the
document, and becomes a DataCite creator; readers see `Given Family`.
Related works are given as `arxiv=ID` (the same work on arXiv, as
`IsVariantFormOf`), or `RELATION:doi:DOI` and `RELATION:arxiv:ID`.

    // in creators and related works:
    function partition(text, sep) {
      const k = text.indexOf(sep);
      return k < 0 ? [text, ''] : [text.slice(0, k), text.slice(k + sep.length)];
    }

    export function creator(spec) {
      const [name, aff] = partition(spec, '|');
      let [family, given] = partition(name, ',');
      family = family.trim();
      given = given.trim();
      const c = { name: given ? `${family}, ${given}` : family, nameType: 'Personal', familyName: family };
      if (given) c.givenName = given;
      if (aff.trim()) c.affiliation = [{ name: aff.trim() }];
      return c;
    }

    export function displayName(c) {
      return 'familyName' in c ? `${c.givenName ?? ''} ${c.familyName}`.trim() : c.name;
    }

    export function relatedFromArgs(specs) {
      const related = [];
      for (const kv of specs || []) {
        const [k, v] = partition(kv, '=');
        if (k === 'arxiv' && v) {
          related.push({ relatedIdentifier: `arXiv:${v}`, relatedIdentifierType: 'arXiv', relationType: 'IsVariantFormOf' });
          continue;
        }
        const [rel, rest] = partition(kv, ':');
        const [type, value] = partition(rest, ':');
        if (!(rel && ['doi', 'arxiv'].includes(type) && value)) {
          exit(`--related ${kv}: use arxiv=ID or RELATION:doi:DOI or RELATION:arxiv:ID`);
        }
        related.push({ relatedIdentifier: type === 'arxiv' ? `arXiv:${value}` : value,
                       relatedIdentifierType: type === 'arxiv' ? 'arXiv' : 'DOI', relationType: rel });
      }
      return related;
    }

    export const SOURCE_FORMATS = {
      '.tex': 'application/x-tex', '.ltx': 'application/x-tex', '.tm': 'application/x-texmacs',
      '.md': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.odt': 'application/vnd.oasis.opendocument.text', '.zip': 'application/zip',
    };

    export function suffixOf(name) {
      const base = name.slice(name.lastIndexOf('/') + 1);
      const k = base.lastIndexOf('.');
      return k > 0 && k < base.length - 1 ? base.slice(k) : '';
    }

    export function setDate(dc, dateType, date, info = null) {
      const entry = { date, dateType };
      if (info) entry.dateInformation = info;
      dc.dates = [...(dc.dates || []).filter((d) => d.dateType !== dateType), entry];
    }

The address in a description is the landing page of the line, which the
website writes (`paper/<label>/`), or else the HTML version of a TeXmacs
document, as in opensheaf-py.

    // in creators and related works:
    export function landingUrl(f, label) {
      if (f.index.html || f.index.template) return `${f.archive.baseUrl}paper/${label}/`;
      return `${f.archive.baseUrl}site/${label}/${label}.html`;
    }

The history, carried forward
----------------------------

A new object version keeps what persists (section 4.2): the notices of
the head, unchanged, with their files, followed by the notices the new
version adds that the head lacks (a second notice about a line keeps the
first), and the history of document
versions when the head has one. A new document version is appended to the
history, or placed after document version `--after N` (a version found
later), which then writes a history; a version without a history follows
the default order of section 4.2, which needs none.

    // in the history of a line, carried forward:
    async function docVersionOf(f, dir, inv, ver) {
      return (await f.readObjectJson(dir, inv, OBJ, ver)).documentVersion;
    }

    async function defaultHistory(f, dir, inv) {
      const last = new Map();
      for (const ver of Object.keys(inv.versions)) last.set(await docVersionOf(f, dir, inv, ver), ver);
      return [...last.keys()].sort((a, b) => a - b).map((n) => last.get(n));
    }

    export async function carryForward(f, prev, obj, dir, inv, newVer, afterDoc = null) {
      if (prev === null) {
        if (afterDoc !== null && afterDoc !== undefined) exit('--after needs an existing document');
        return;
      }
      if (prev.notices?.length) {
        const kept = [...prev.notices];
        obj.notices = [...kept, ...(obj.notices || []).filter((n) => !kept.some((k) => same(k, n)))];
      }
      if ((prev.history === undefined || prev.history === null) && (afterDoc === null || afterDoc === undefined)) return;
      const hist = [...(prev.history?.length ? prev.history : await defaultHistory(f, dir, inv))];
      const docs = new Map();
      for (const v of hist) docs.set(await docVersionOf(f, dir, inv, v), v);
      const n = obj.documentVersion;
      if (docs.has(n)) {
        hist[hist.indexOf(docs.get(n))] = newVer;
      } else if (afterDoc === null || afterDoc === undefined) {
        hist.push(newVer);
      } else {
        if (!docs.has(afterDoc)) exit(`--after: no document version ${afterDoc}`);
        hist.splice(hist.indexOf(docs.get(afterDoc)) + 1, 0, newVer);
      }
      obj.history = hist;
    }

    export async function carriedFiles(f, dir, inv) {
      const out = new Map();
      if (!inv) return out;
      const head = await f.readObjectJson(dir, inv, OBJ);
      for (const n of head.notices || []) if (n.path) out.set(n.path, await f.readLogical(dir, inv, n.path));
      return out;
    }

A deposit
---------

The arguments are those of `osheaf deposit`, with the files read: the
main source and the extra sources as `{ name, bytes }`, the PDF likewise,
and the abstract file as its text. The checks come in opensheaf-py's
order, with its messages. The title and the authors are given with every
deposit, as in opensheaf-py (which does not take them from the version
before).

The same function deposits into a *draft* (section 10.1), which `osheaf
draft` calls with `draft` set (chapter [41](41-drafts.md)): the label is
then the draft's own identifier, `sheaf:draft:<id>`, local to the
archive; `new` makes the draft, and without it the draft must exist. A
draft has no owner, no name, no genesis record and no landing page, and
is not listed among the labels.

    // in a deposit:
    export async function deposit(f, a) {
      const label = a.label;
      const draft = Boolean(a.draft);
      let id = null, owner = null;
      if (draft) {
        if (!label || !LABEL.test(label) || label.length > 64) {
          exit('the identifier of a draft matches ^[a-z0-9]+(-[a-z0-9]+)*$ and has at most 64 characters (section 10.1)');
        }
        id = `sheaf:draft:${label}`;
        const held = (await f.storage.kind(joinPath(await f.dirOf(id), 'inventory.json'))) === 'file';
        if (a.new && held) exit(`the draft ${label} exists: osheaf draft deposit ${label} adds a version to it`);
        if (!a.new && !held) exit(`no draft ${label} in this archive (osheaf draft new ${label} makes one)`);
      } else if (f.labels.has(label)) {
        if (a.new) exit(`${label} is the label of a line already: deposit a new version without --new, ` +
                        'or choose another label for a new work');
        id = f.labels.get(label);
      } else if (!a.new) {
        exit(`no line labelled ${label} in this archive: give --new to seal a new work ` +
             '(section 10.2), or check the label (osheaf verify lists them)');
      } else {
        if (!LABEL.test(label || '') || label.length > 64) {
          exit('a label must match ^[a-z0-9]+(-[a-z0-9]+)*$ and have at most 64 characters');
        }
        if (label.length > 32) f.env.err(`warning: ${label} is longer than 32 characters (it appears in every URL of the website)`);
        owner = a.owner || f.archive.owner;
        if (!f.archiveOwners().includes(owner)) exit(`${owner} is not an owner this archive hosts`);
      }
      await f.initStorageRoot();
      const dir = id ? await f.dirOf(id) : null;
      const inv = dir ? await f.inventory(dir) : null;
      let prevObj = null, prevDc = null, docVersion = 1;
      if (inv) {
        prevObj = await f.readObjectJson(dir, inv, OBJ);
        prevDc = await f.readObjectJson(dir, inv, 'datacite.json');
        if (prevObj.kind !== 'document') exit(`${label} is not a document`);
        if (prevObj.status === 'withdrawn') exit(`${label} is withdrawn (section 13.1): a withdrawn document gets no new versions`);
        let most = 0;
        for (const v of Object.keys(inv.versions)) most = Math.max(most, await docVersionOf(f, dir, inv, v));
        docVersion = most + 1;
        owner = prevObj.owner;
      }
      if (a.created && a.available) exit('give --created (a version not public at the time) or --available, not both');
      const available = a.created ? null : (a.available || f.env.today());
      const issued = a.issued || (prevDc ? dateOf(prevDc, 'Issued') : null) || available;
      const source = a.source || null;
      if (source && suffixOf(source.name) === '.tm' && !a.pdf) {
        exit('TeXmacs sources are typeset by opensheaf-py (osheaf deposit of opensheaf-py); with opensheaf-js, ' +
             'give the PDF with --pdf');
      }
      if (!a.pdf) exit('give the PDF of this version with --pdf (only TeXmacs sources are typeset by the archive)');
      if (!source && !a.noSource) exit('a deposit without sources needs --no-source REASON (section 4.3: sourcesMissing)');
      if (!a.title || !a.author?.length) exit('give the title (--title) and the authors (--author) of this version');
      const files = new Map(), formats = [];
      let main = null, format = null;
      if (source) {
        main = source.name.slice(source.name.lastIndexOf('/') + 1);
        format = a.sourceFormat || SOURCE_FORMATS[suffixOf(main).toLowerCase()] || 'application/octet-stream';
        files.set(main, source.bytes);
        formats.push(format);
      }
      formats.push('application/pdf');
      for (const extra of a.extraSource || []) {
        const logical = extra.logical || extra.name.slice(extra.name.lastIndexOf('/') + 1);
        const parts = logical.split('/');
        if (logical.startsWith('/') || parts.includes('..') || parts.includes('.')) exit(`bad logical path ${logical}`);
        files.set(logical, extra.bytes);
        if (logical.endsWith('.bib') && !formats.includes('application/x-bibtex')) formats.push('application/x-bibtex');
      }
      const pdf = a.pdf.bytes;
      if (!(pdf[0] === 0x25 && pdf[1] === 0x50 && pdf[2] === 0x44 && pdf[3] === 0x46)) exit(`${a.pdf.name} is not a PDF`);
      files.set('paper.pdf', pdf);

The description of the version: DataCite 4.7, with the dates of section
4.4 (Issued, the first public appearance of the work; Available, when
this version became public, or Created, for a version that was not), and
the abstract and keywords of the version before unless new ones are
given.

    // in a deposit:
      let abstract = null;
      if (a.abstractFile !== undefined && a.abstractFile !== null) abstract = a.abstractFile.trim();
      else if (a.abstract) abstract = a.abstract.trim();
      if (abstract === null && prevDc) {
        abstract = (prevDc.descriptions || []).find((x) => x.descriptionType === 'Abstract')?.description ?? null;
      }
      const datacite = {
        titles: [{ title: a.title }],
        creators: a.author.map(creator),
        publisher: { name: f.archive.name },
        publicationYear: Number((issued || a.created).slice(0, 4)),
        types: { resourceTypeGeneral: a.type || 'Preprint' },
        version: String(docVersion),
        url: landingUrl(f, label),
        dates: [],
        language: a.language || 'en',
        formats,
        rightsList: rightsList(a.rights, prevDc),
      };
      if (a.keyword?.length) datacite.subjects = a.keyword.map((k) => ({ subject: k }));
      else if (prevDc?.subjects?.length) datacite.subjects = prevDc.subjects;
      if (issued) setDate(datacite, 'Issued', issued);
      if (available) setDate(datacite, 'Available', available, a.dateInfo);
      else setDate(datacite, 'Created', a.created, a.dateInfo);
      if (abstract) datacite.descriptions = [{ description: abstract, descriptionType: 'Abstract' }];
      const related = relatedFromArgs(a.related);
      if (related.length) datacite.relatedIdentifiers = related;
      if (draft) delete datacite.url;

The `object.json` of the version (section 4.3): its kind, name, owner and
document version; its main source and format, or why the sources are
missing; the PDF as its rendition; the tools that produced it; its status;
and, when given, the change note, the agreement of the authors, the stage
of the version (NISO-JAV) and the file of its licence.

    // in a deposit:
      const obj = { format: OBJ_FORMAT, specification: SPEC, kind: 'document', name: null, owner,
                    documentVersion: docVersion };
      if (source) Object.assign(obj, { mainSource: main, sourceFormat: format });
      else obj.sourcesMissing = { text: a.noSource };
      obj.renditions = [{ path: 'paper.pdf', mediaType: 'application/pdf' }];
      if (a.toolchain?.length) obj.toolchain = a.toolchain.map((t) => partition(t, '=')).map(([name, version]) => ({ name, version }));
      obj.status = 'active';
      if (a.changes) obj.changes = { text: a.changes };
      if (a.agreement) {
        obj.agreement = { by: datacite.creators.map((c) => c.name), date: available || a.created || f.env.today(),
                          method: a.agreement };
      }
      if (a.stage) obj.stage = { scheme: 'NISO-JAV', value: a.stage };
      if (a.licenceFile) {
        if (!files.has(a.licenceFile)) {
          exit(`--licence-file ${a.licenceFile} is not a file of the deposit (give it as the main source or with ` +
               `--extra-source; files: ${[...files.keys()].sort().join(', ')})`);
        }
        obj.licence = { path: a.licenceFile, mediaType: { '.pdf': 'application/pdf', '.md': 'text/markdown',
          '.txt': 'text/plain', '.html': 'text/html' }[suffixOf(a.licenceFile).toLowerCase()] || 'text/plain' };
      }

A new work is sealed now, with its genesis record; a new version carries
the genesis record of its line, the evidence of its branch point if it
is a branch (section 9.2), the notices, and the history.

    // in a deposit:
      if (draft) {
        delete obj.name;
        delete obj.owner;
      } else if (id === null) {
        const sealed = await f.seal('document', owner);
        id = sealed.id;
        files.set(GENESIS, sealed.genesis);
      } else {
        files.set(GENESIS, await f.readLogical(dir, inv, GENESIS));
      }
      if (!draft) obj.name = id.split(':')[1];
      if (prevObj?.parent) {
        obj.parent = prevObj.parent;
        const state = inv.versions[inv.head].state;
        for (const lp of Object.values(state).flat().filter(isEvidence).sort()) files.set(lp, await f.readLogical(dir, inv, lp));
      }
      const next = inv ? `v${Number(inv.head.slice(1)) + 1}` : 'v1';
      await carryForward(f, prevObj, obj, dir, inv, next, a.after ?? null);
      for (const [lp, bytes] of await carriedFiles(f, dir, inv)) if (!files.has(lp)) files.set(lp, bytes);
      files.set('datacite.json', jsonBytes(datacite));
      const done = await f.addVersion(id, files, obj, a.message || `Deposit: document version ${docVersion}`,
                                      { acknowledged: Boolean(a.iKnow) });
      if (!draft) f.labels.set(label, id);
      await writeDiscovery(f);
      f.env.out(`${label}: ${done.head} (document version ${docVersion}) ${id}`);
      return { id, head: done.head, documentVersion: docVersion };
    }
