Descriptions
============

A document version is fixed by its content; what is said about it can
change. A **description-only version** (section 4.2) is an object version
that keeps the files of the head and changes only `datacite.json` and
`object.json`: a new licence, a link to the same work elsewhere, a
corrected title, a notice about a version, a withdrawal. Its document
version stays that of the head, so the history replaces the entry of that
document version with the new object version, and `datacite.json` gets the
date `Updated`. A **completion** adds the sources of a document version
recorded without them (`sourcesMissing`).

This chapter ports opensheaf-py's chapter
[14-description](https://opensheaf.org/opensheaf-py/14-description.html):
`osheaf notice`, `withdraw`, `complete`, `relate`, `relicense` and
`describe`, with the same checks, the same messages and the same files.
Every one is signed by the owner, extends the line only when its versions
are signed (or with `--i-know`, chapter [23](23-folder.md)), and writes the
discovery document and the indexes again.

    // in core/describe.js:
    import { jsonBytes } from './write.js';
    import { same } from './schema.js';
    import { joinPath } from './storage.js';
    import { writeDiscovery } from './discovery.js';
    import { OBJ, exit } from './folder.js';
    import { carryForward, carriedFiles, rightsList, checkRights, creator, setDate, suffixOf,
             SOURCE_FORMATS } from './deposit.js';

    <<the line a label names>>

    <<a description-only version>>

    <<notices and withdrawals>>

    <<completing the sources>>

    <<related works, licences and corrections>>

The line a label names
----------------------

A command names a line by its label in the archive, or by its identifier
when the line is held here without a label.

    // in the line a label names:
    export async function lineOf(f, label) {
      if (f.labels.has(label)) return f.labels.get(label);
      if (typeof label === 'string' && label.startsWith('sheaf:')) {
        try {
          if ((await f.storage.kind(joinPath(await f.dirOf(label), 'inventory.json'))) === 'file') return label;
        } catch {
          // not the identifier of an object
        }
      }
      exit(`no line labelled ${label} in this archive (osheaf deposit --new ${label} seals a new work)`);
    }

    async function headOf(f, label) {
      const id = await lineOf(f, label);
      const dir = await f.dirOf(id);
      const inv = await f.inventory(dir);
      if (inv === null) exit(`no object ${label}`);
      return { id, dir, inv };
    }

    async function headFiles(f, dir, inv, ver = inv.head) {
      const out = new Map();
      for (const paths of Object.values(inv.versions[ver].state)) {
        for (const p of paths) if (p !== 'datacite.json' && p !== OBJ) out.set(p, await f.readLogical(dir, inv, p, ver));
      }
      return out;
    }

A description-only version
--------------------------

The files of the head, with the files a command adds (the statement of a
notice, for instance), and `datacite.json` and `object.json` changed by the
command's `change`. The object description is copied from the head and
changed; its notices and its history are then carried forward as a
deposit carries them (chapter [26](26-deposit.md)).

The notices are carried after the change: those of the head first, in
their order, then those the change adds, so that a second notice about a
line keeps the first (opensheaf-py lost it until it was corrected there,
and this port with it, for parity).

    // in a description-only version:
    export async function descriptionVersion(f, label, change, message, addFiles = null, acknowledged = false) {
      const { id, dir, inv } = await headOf(f, label);
      const files = await headFiles(f, dir, inv);
      const dc = await f.readObjectJson(dir, inv, 'datacite.json');
      const prev = await f.readObjectJson(dir, inv, OBJ);
      if (prev.kind !== 'document') exit(`${label} is not a document`);
      const obj = JSON.parse(JSON.stringify(prev));
      await change(dc, obj);
      setDate(dc, 'Updated', f.env.today());
      await carryForward(f, prev, obj, dir, inv, `v${Number(inv.head.slice(1)) + 1}`);
      for (const [lp, bytes] of addFiles || []) {
        if (files.has(lp)) exit(`${label} has a file ${lp} already`);
        files.set(lp, bytes);
      }
      files.set('datacite.json', jsonBytes(dc));
      const done = await f.addVersion(id, files, obj, typeof message === 'function' ? message() : message,
                                      { acknowledged: Boolean(acknowledged) });
      await writeDiscovery(f);
      return done;
    }

Notices and withdrawals
-----------------------

A note (section 4.3) is a text, a file of the content, or both. The file
of a notice is kept at `notices/<its name>`, that of a withdrawal at
`withdrawal/<its name>`; the command line gives it as a name and bytes.

    // in notices and withdrawals:
    export const NOTE_TYPES = { '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain',
                                '.html': 'text/html' };

    export function noteFrom(text, file, folder) {
      const note = {}, add = new Map();
      if (text) note.text = text;
      if (file) {
        const lp = `${folder}/${file.name}`;
        note.path = lp;
        note.mediaType = NOTE_TYPES[suffixOf(file.name).toLowerCase()] || 'application/octet-stream';
        add.set(lp, file.bytes);
      }
      if (!Object.keys(note).length) exit('a note needs a text, a file, or both');
      return { note, add };
    }

A notice is about one document version, which the line must hold,
possibly not the current one. It is appended to the notices of the head,
which every later object version keeps unchanged and in order (section
4.2), so that its position is its number: notice 1, 2, ... of the line. A
notice is never edited: a later notice corrects or withdraws it by naming
its number in `replaces` (`--replaces`), and must then be about the same
document version; a notice is replaced at most once. Its `date` is the
date its author issued it, today unless `--date` says otherwise.

    // in notices and withdrawals:
    export async function notice(f, a) {
      const { dir, inv } = await headOf(f, a.label);
      const numbers = new Set();
      for (const v of Object.keys(inv.versions)) numbers.add((await f.readObjectJson(dir, inv, OBJ, v)).documentVersion);
      if (!numbers.has(a.about)) exit(`${a.label} has no document version ${a.about}`);
      const { note, add } = noteFrom(a.text, a.file, 'notices');
      Object.assign(note, { documentVersion: a.about, date: a.date || f.env.today() });
      const earlier = (await f.readObjectJson(dir, inv, OBJ)).notices || [];
      const r = a.replaces ?? null;
      if (r !== null) {
        if (!(r >= 1 && r <= earlier.length)) exit(`${a.label} has no notice ${r} (it has ${earlier.length})`);
        if (earlier[r - 1].documentVersion !== a.about) {
          exit(`notice ${r} is about document version ${earlier[r - 1].documentVersion}, ` +
               `not ${a.about}: a notice replaces one about the same version (section 4.2)`);
        }
        if (earlier.some((x) => x.replaces === r)) exit(`notice ${r} is already replaced (section 4.2)`);
        note.replaces = r;
      }
      const done = await descriptionVersion(f, a.label, (dc, obj) => {
        obj.notices = [...(obj.notices || []), note];
      }, a.message || `Notice about document version ${a.about} (description-only version)`, add, a.iKnow);
      f.env.out(`${a.label}: ${done.head} (notice ${earlier.length + 1}, about version ${a.about}` +
                (r !== null ? `, replacing notice ${r})` : ')'));
      return done;
    }

A withdrawal (section 13.1) sets the status `withdrawn`, with the date and
the reason, and the date `Withdrawn` in `datacite.json`; the content stays.
The withdrawal covers the versions deposited so far; the description-only
versions after it (notices, relations) keep it, and a new document version
(chapter [26](26-deposit.md)) reinstates the document, the versions
withdrawn staying withdrawn.

    // in notices and withdrawals:
    export async function withdraw(f, a) {
      const { note: reason, add } = noteFrom(a.reason, a.file, 'withdrawal');
      const date = a.date || f.env.today();
      const done = await descriptionVersion(f, a.label, (dc, obj) => {
        if (obj.status === 'withdrawn') exit(`${a.label} is withdrawn already`);
        obj.status = 'withdrawn';
        obj.withdrawal = { date, reason };
        setDate(dc, 'Withdrawn', date);
      }, a.message || 'Withdrawal (description-only version)', add, a.iKnow);
      f.env.out(`${a.label}: ${done.head} (withdrawn)`);
      return done;
    }

Completing the sources
----------------------

`osheaf complete LABEL --version N --source FILE` adds the sources of
document version `N`, deposited without them: a new object version holding
the files of the last object version of that document version, and the
sources; completing only adds files. Its description is that document
version's, without `sourcesMissing`, with the main source and its format;
its status, notices, history and withdrawal are those of the head, which
the new object version follows.

    // in completing the sources:
    export async function complete(f, a) {
      const { id, dir, inv } = await headOf(f, a.label);
      let last = null;
      for (const v of Object.keys(inv.versions)) {
        if ((await f.readObjectJson(dir, inv, OBJ, v)).documentVersion === a.version) last = v;
      }
      if (last === null) exit(`${a.label} has no document version ${a.version}`);
      const obj = await f.readObjectJson(dir, inv, OBJ, last);
      if (!obj.sourcesMissing) exit(`${a.label}: document version ${a.version} has its sources already`);
      const head = await f.readObjectJson(dir, inv, OBJ);
      const dc = await f.readObjectJson(dir, inv, 'datacite.json', last);
      const files = await headFiles(f, dir, inv, last);
      const main = a.source.name;
      for (const { logical, bytes } of [{ logical: main, bytes: a.source.bytes }, ...(a.extraSource || [])]) {
        if (files.has(logical)) {
          exit(`${a.label}: version ${a.version} has a file ${logical} already (completing only adds files)`);
        }
        files.set(logical, bytes);
      }
      delete obj.sourcesMissing;
      obj.mainSource = main;
      obj.sourceFormat = a.sourceFormat || SOURCE_FORMATS[suffixOf(main).toLowerCase()] || 'application/octet-stream';
      delete obj.notices;
      delete obj.history;
      await carryForward(f, head, obj, dir, inv, `v${Number(inv.head.slice(1)) + 1}`);
      delete obj.withdrawal;
      obj.status = head.status;
      if (head.withdrawal) {
        obj.withdrawal = head.withdrawal;
        setDate(dc, 'Withdrawn', head.withdrawal.date);
        const lp = head.withdrawal.reason.path;
        if (lp && !files.has(lp)) files.set(lp, await f.readLogical(dir, inv, lp));
      }
      setDate(dc, 'Updated', f.env.today());
      const fmt = obj.sourceFormat;
      if (!(dc.formats || []).includes(fmt)) dc.formats = [fmt, ...(dc.formats || [])];
      files.set('datacite.json', jsonBytes(dc));
      for (const [lp, bytes] of await carriedFiles(f, dir, inv)) if (!files.has(lp)) files.set(lp, bytes);
      const done = await f.addVersion(id, files, obj, a.message ||
                                      `Sources of document version ${a.version} added (sourcesMissing completed)`,
                                      { acknowledged: Boolean(a.iKnow) });
      await writeDiscovery(f);
      f.env.out(`${a.label}: ${done.head} (sources of version ${a.version})`);
      return done;
    }

Related works, licences and corrections
---------------------------------------

`osheaf relate LABEL --to arxiv:ID|doi:DOI` links the document to the same
work elsewhere, with a relation (`IsIdenticalTo` by default), and can
correct the date `Issued`, the first public appearance of the work.

    // in related works, licences and corrections:
    export const RELATIONS = ['IsIdenticalTo', 'IsVariantFormOf', 'IsPreprintOf', 'IsVersionOf'];

    export async function relate(f, a) {
      const k = a.to.indexOf(':');
      const kind = k < 0 ? a.to : a.to.slice(0, k), value = k < 0 ? '' : a.to.slice(k + 1);
      if (!['arxiv', 'doi'].includes(kind) || !value) exit('--to must be arxiv:ID or doi:DOI');
      const relation = a.relation || 'IsIdenticalTo';
      const rel = { relatedIdentifier: kind === 'arxiv' ? `arXiv:${value}` : value,
                    relatedIdentifierType: kind === 'arxiv' ? 'arXiv' : 'DOI', relationType: relation };
      const done = await descriptionVersion(f, a.label, (dc) => {
        const rels = (dc.relatedIdentifiers ??= []);
        if (rels.some((r) => r.relatedIdentifier === rel.relatedIdentifier)) {
          exit(`${a.label} already relates to ${rel.relatedIdentifier}`);
        }
        rels.push(rel);
        if (a.issued) setDate(dc, 'Issued', a.issued);
      }, a.message || `Related: ${relation} ${rel.relatedIdentifier} (description-only version)`, null, a.iKnow);
      f.env.out(`${a.label}: ${done.head} (${relation} ${rel.relatedIdentifier})`);
      return done;
    }

`osheaf relicense LABEL --rights KEY --method HOW` gives a new licence, and
records the authors' agreement (who, when, how) in `object.json`.

    // in related works, licences and corrections:
    export async function relicense(f, a) {
      const fresh = rightsList(checkRights(a.rights))[0];
      const done = await descriptionVersion(f, a.label, (dc, obj) => {
        if (dc.rightsList !== undefined && same(dc.rightsList, [fresh])) exit(`${a.label} already has ${a.rights}`);
        dc.rightsList = [fresh];
        obj.agreement = { by: dc.creators.map((c) => c.name), date: a.date || f.env.today(), method: a.method };
      }, a.message || `Licence: ${fresh.rights} (description-only version; content unchanged)`, null, a.iKnow);
      f.env.out(`${a.label}: ${done.head} (${fresh.rights})`);
      return done;
    }

`osheaf describe LABEL` corrects the title, the abstract, the keywords or
the authors; a keyword list replaces the keywords that have no scheme, and
keeps those that have one (from arXiv, for instance). Nothing to change is
refused.

    // in related works, licences and corrections:
    export async function describe(f, a) {
      if (a.abstract !== undefined && a.abstract !== null && a.abstractFile) {
        exit('describe: give --abstract or --abstract-file, not both');
      }
      let abstract = a.abstractFile ? a.abstractFile.text : a.abstract;
      abstract = abstract !== undefined && abstract !== null ? abstract.trim() : null;
      const title = a.title ?? null;
      if ((title !== null && !title.trim()) || abstract === '') exit('describe: a title or an abstract cannot be empty');
      const changed = [];
      const done = await descriptionVersion(f, a.label, (dc) => {
        if (title !== null && title.trim() !== dc.titles[0].title) {
          dc.titles[0].title = title.trim();
          changed.push('title');
        }
        if (abstract !== null) {
          const descs = (dc.descriptions ??= []);
          const old = descs.find((x) => x.descriptionType === 'Abstract');
          if (!old) {
            descs.unshift({ description: abstract, descriptionType: 'Abstract' });
            changed.push('abstract');
          } else if (old.description !== abstract) {
            old.description = abstract;
            changed.push('abstract');
          }
        }
        if (a.keyword?.length) {
          const subjects = dc.subjects || [];
          const plain = subjects.filter((x) => !x.subjectScheme).map((x) => x.subject);
          if (!same(plain, a.keyword)) {
            dc.subjects = [...a.keyword.map((k) => ({ subject: k })), ...subjects.filter((x) => x.subjectScheme)];
            changed.push('keywords');
          }
        }
        if (a.author?.length) {
          const creators = a.author.map(creator);
          if (!same(creators, dc.creators)) {
            dc.creators = creators;
            changed.push('authors');
          }
        }
        if (!changed.length) exit(`${a.label}: nothing to change in the description`);
      }, a.message || (() => `Description corrected: ${changed.join(', ')} (description-only version)`), null, a.iKnow);
      f.env.out(`${a.label}: ${done.head} (${changed.join(', ')} corrected)`);
      return done;
    }
