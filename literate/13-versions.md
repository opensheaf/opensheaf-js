Document versions and history
=============================

> This chapter is chapter 13 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/13-versions.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


OCFL knows object versions, `v1`, `v2`, ..., one for every change of an
object. Readers want the versions of the *work*: OpenSheaf calls them
document versions, numbers them from 1 without gaps, and orders them by a
*history* (section 4.2). The two numberings diverge: a description-only
version changes the description and keeps the document version, a
completion adds the sources of a version deposited without them and keeps
its number, and a version found later gets the next number although it
comes earlier in the history of the work. The rules are explained at
length in the chapter
[Document versions, history and dates](https://opensheaf.org/opensheaf-py/11-versions.html)
of opensheaf-py; this chapter gives the same functions in JavaScript,
working on data already fetched, so that they can be tested without a
network.

The module is `core/versions.js`. Every function here is pure: it reads an
inventory and a function `objOf(version)` that returns the `object.json` of
an object version (or `null` if it could not be read).

    // in core/versions.js:
    import { isVersion, versionNumber } from './paths.js';
    import { same } from './schema.js';

    <<the versions and the state of an inventory>>

    <<the history and the current version>>

    <<what each object version did>>

    <<the pins of a member>>

    <<reading the descriptions>>

    <<the rules of document versions>>

The versions and the state of an inventory
------------------------------------------

The versions of an inventory are its keys of the form `vN`, in the order
of their numbers. The *state* of a version maps digests to the logical
paths of its files; turned around, it gives the digest of each path, and a
logical path is found in the manifest through that digest. When a digest
has several content paths (OCFL allows it), the first is used, as
opensheaf-py does.

Logical paths and digests are names chosen by the archive, and so is
every key of an inventory: a logical path may be `constructor` or
`__proto__`, a digest `toString`. An ordinary JavaScript object answers
to such names with what it inherits (`'toString' in {}` is true, and
`files['__proto__'] = d` changes the object's prototype instead of adding
a file), so remote names never index ordinary objects here and in the
other modules: the files of a version are an object without a prototype
(`Object.create(null)`), and a remote key is looked up with
`Object.hasOwn`.

    // in the versions and the state of an inventory:
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

The history and the current version
-----------------------------------

Without `history` in `object.json`, the history is the last object version
holding each document version, in the order of the numbers, among the
object versions up to `at` (by default the head); with it, it is the
`history` of the object version `at`. The current version is the last
entry of the history (section 4.2). The history of a line is read from its
latest signed version (section 7.3), which is what `at` is for: the
pages give it the latest signed version that [the signatures](08-signatures.md)
find, and a collection the object version it pins, whose history is that
known at that version (section 8.3).

    // in the history and the current version:
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

A withdrawal (section 13.1) withdraws every document version deposited
before it, in the order of deposit, and later description-only versions
keep it; a new document version reinstates the line, and the versions
withdrawn stay withdrawn. Which versions are withdrawn is read from the
object versions themselves, up to `at`: each document version goes to the
first withdrawal after the object version that first held it, as
`withdrawn_versions` of opensheaf-py computes it.

    // in the rules of document versions:
    export function withdrawnVersions(inv, objOf, at = inv.head) {
      const out = new Map();
      const held = [];
      for (const ver of versionsOf(inv)) {
        const obj = objOf(ver);
        const n = obj?.documentVersion;
        if (Number.isInteger(n) && !held.includes(n)) held.push(n);
        if (obj?.status === 'withdrawn') for (const k of held) if (!out.has(k)) out.set(k, ver);
        if (ver === at) break;
      }
      return out;
    }

What each object version did
----------------------------

The explorer shows, for every object version, what it did to the
document: deposited a new document version, completed one that lacked its
sources, or only described one (a description-only version, section 4.2,
which also covers notices and withdrawals). A version of a key log does
none of these: it is a version of an owner (section 6). A collection is a
document whose source is `members.json` (section 4.2), and its versions
have the same roles. This is read from the same
data as the rules below: a document version seen before, with files added
while its sources were missing, is a completion; seen before otherwise, a
description.

    // in what each object version did:
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

The pins of a member
--------------------

A member of a catalogue has one pin, its `version` with its
`inventorySha512`; a member of a selection has one per revision, each also
stating the document version that the pinned object version holds
(section 8.4). The pin presented, and the version shown at it, are
those of [resolving members](15-resolve.md): the last revision of a
selection's member; for a catalogue's member, the current version read
from the history of the pinned version (section 8.3).

    // in the pins of a member:
    export function memberPins(m) {
      if (own(m, 'revisions')) {
        return (Array.isArray(m.revisions) ? m.revisions : []).map((r) => ({
          version: r?.version, pin: r?.inventorySha512, documentVersion: r?.documentVersion,
        }));
      }
      return [{ version: m?.version, pin: m?.inventorySha512, documentVersion: null }];
    }

Reading the descriptions
------------------------

A few small readers of `datacite.json` and `object.json`, shared by the
pages and the verification: a date of a given type (the first type found
wins, as in opensheaf-py), the title, the names of the creators, the
abstract, and the PDF of a document version (the first rendition of type
`application/pdf`, or else the first whose path ends in `.pdf`). Remote
data may have any shape, so each reader checks types and returns `null` or
an empty list rather than failing.

    // in reading the descriptions:
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

The rules of document versions
------------------------------

Section 14.4 asks a verifier to check "the rules of sections 4.2 to 4.4
in every version and between versions (numbering, new versions,
completion, `history`, notices), as far as the files decide them": object
versions with the same document version have the same sources, renditions
and change note, except that a version with `sourcesMissing` may be
completed by adding files; new numbers follow the rule of new versions,
without gaps; `history`, when present, lists distinct document versions,
covers all of them, each entry being the last object version holding its
document version; no object version after the first one with `history`
lacks it; every notice is kept unchanged in every later object version.

The check is a port of `document_version_errors` of `osheaf verify`
([its chapter](https://opensheaf.org/opensheaf-py/17-verify.html)), line
for line, with the same messages, so that the two verifiers report the
same problems in the same words. It goes once through the object
versions, remembering for each document version its *own* files, its
change note, and whether its sources were missing.

The own files of a document version are, by section 4.2, "the sources,
the renditions and the change note": everything the version holds except
the two descriptions, the identity files (the genesis record and the
evidence of a branch point, section 4.1), and the files of the notes that
describe the object rather than the document version. Those notes are the
notices and a withdrawal, which description-only versions add (section
4.2), and the licence terms (`licence`, section 4.3), which belong to the
description of the object, like `rightsList` in `datacite.json`: a
description-only version may add or replace the file of the licence
terms. The note of missing sources stays with the document version (a
completion "changes or removes no file of the version", section 4.2).
A collection is a document whose source is `members.json` (section 4.2),
and is checked the same way. The check stops at the first object version
that is neither a document nor a collection or whose `object.json` could
not be read, as opensheaf-py does. A branch numbers its own document
versions from 1, as every line does (section 9.4); `parent.documentVersion`
keeps the parent's number.

    // in the rules of document versions:
    export function documentVersionErrors(inv, objOf) {
      const errors = [];
      const add = (ver, message) => errors.push({ ver, message });
      const versions = versionsOf(inv);
      const seen = new Map(), filesOfDoc = new Map(), missingOf = new Map();
      const fieldsOf = new Map(), externalOf = new Map();
      let highest = 0, hadHistory = false, notices = [], prevVer = null, prevObj = null;
      const currentBefore = (at) => {
        if (!at) return null;
        const n = objOf(currentVersion(inv, objOf, at))?.documentVersion;
        return Number.isInteger(n) ? n : null;
      };
      for (const ver of versions) {
        const obj = objOf(ver);
        if (!obj || (obj.kind !== 'document' && obj.kind !== 'collection')) return errors;
        const n = obj.documentVersion;
        const newDoc = !seen.has(n);
        const own = ownFiles(inv, ver, obj);
        const change = obj.changes?.text ?? null;
        <<check the number and the files of a document version>>
        <<check the fields that belong to a document version>>
        <<check that a withdrawal is kept until a new document version>>
        <<check the history recorded in an object version>>
        <<check that an object version keeps the earlier notices>>
        prevVer = ver;
        prevObj = obj;
      }
      return errors;
    }

A document version seen before must have the same own files and change
note, except while its sources are missing: then files may be added,
never changed or removed. A document version not seen before must have
the next number, and must hold something new: its own files (compared by
path and digest, so that a rename is a change) or its change note differ
from those of the current version as of the object version before
(section 4.2). Files of an earlier version that is not the current one,
deposited again, are a revert, a new document version. opensheaf-py makes
the same check, with the same message.

    // in check the number and the files of a document version:
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

The fields that say what the files of a document version are belong to it,
like its change note (section 4.2): every object version holding the
document version has the same `mainSource`, `sourceFormat`,
`sourcesMissing`, `renditions` and `toolchain`, except while its sources
are missing, when a completion names them and may add renditions but drop
none. The records at external services of a document version are only
added to: each stays, unchanged, in every later object version holding it.
opensheaf-py makes the same check, with the same messages.

    // in check the fields that belong to a document version:
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

The fields, in the order they are reported:

    // in the rules of document versions:
    const DOCUMENT_VERSION_FIELDS = ['mainSource', 'sourceFormat', 'sourcesMissing', 'renditions', 'toolchain'];

A withdrawal is a description-only version: a new document version is
never one. Once a line is withdrawn, every later object version keeps
`status` `withdrawn` and the same `withdrawal` until a new document
version reinstates it (section 13.1).

    // in check that a withdrawal is kept until a new document version:
    if (newDoc && obj.status === 'withdrawn') {
      add(ver, 'is a new document version and a withdrawal: a withdrawal is a description-only version (section 13.1)');
    } else if (!newDoc && prevObj?.status === 'withdrawn' && (obj.status !== 'withdrawn' || !same(obj.withdrawal ?? null, prevObj.withdrawal ?? null))) {
      add(ver, `drops or changes the withdrawal of ${prevVer}: only a new document version reinstates a line (section 13.1)`);
    }

The history, once present, must stay; it may name only object versions
that exist at that point; it must list each document version known so far
exactly once; and each entry must be the last object version holding its
document version, as known when the history was written.

    // in check the history recorded in an object version:
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

Every notice of an object version must be present, unchanged and in the
same order, at the start of the notices of the next one, and so of every
later one: a notice is numbered by its position, from 1 (section 4.2). A
new notice may replace an earlier one, by its number, which must be about
the same document version and not replaced already. opensheaf-py makes the
same checks, with the same messages.

    // in check that an object version keeps the earlier notices:
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

The date of a notice is the date its author issued it, which should not
be later than its deposit, the `created` date of the object version that
added it (section 4.2): a later date is a warning.

    // in the rules of document versions:
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
