The rules of an archive
=======================

> This chapter is chapter 16 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/16-rules.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


The verification (chapter [17](17-verify.md)) reads an archive and
reports its findings (section 14.1). This chapter holds the rules it
applies to what it has read, as pure functions of the data: the form of
a finding, the schemas, the descriptions of an object version, the
member lists of collections, and what the discovery document and the
indexes should say of the objects held. Each is a port of the function of
the same purpose in `osheaf verify` (opensheaf-py's chapter
[17-verify](https://opensheaf.org/opensheaf-py/17-verify.html)), with the
same messages, so that the two verifiers report the same problems in the
same words; the tests compare them on the fixture archives.

The module is `core/rules.js`.

    // in core/rules.js:
    import { validate } from './schema.js';
    import { filesOf, dateOf } from './versions.js';
    import { isObject } from './names.js';

Findings
--------

A finding (section 14.1) is an *error* (a breach of a MUST), a *warning*
(a breach of a SHOULD, a breach the archive cannot repair, or a check not
made), or a *result* (statuses, verdicts, forks, ends, exposures,
withdrawals, removals). It has a place, as `osheaf verify` names places:
`opensheaf.json`, `ocfl`, the label or identifier of an object (`owner
<name>` for a key log), followed by an object version where the finding
is about one, or `resolution` for what the resolution of other archives
met. The section of the specification cited in the message is kept apart
for the pages, which link to it. `text` is the finding as `osheaf verify`
prints it.

    // in core/rules.js:
    export function finding(level, place, message, { object = null, ver = null } = {}) {
      const section = /\(sections? ([0-9A-Z][^)]*)\)/.exec(message)?.[1]?.split(/,| and /)[0].trim() ?? null;
      return { level, place, message, object, ver, section, text: `${place}: ${message}` };
    }

Schemas
-------

A file defined by the specification is checked against the schema of its
format (chapter [12](12-schema.md)); each error is a finding of the
severity given (an error, but a warning for the files of witness
folders, section 14.2).

    // in core/rules.js:
    export function schemaFindings(place, data, schema, level = 'error', context = {}) {
      if (!schema) return [];
      return validate(schema, data).map((e) => finding(level, place, `${e.path ? e.path + ': ' : ''}${e.message}`, context));
    }

The descriptions of an object version
-------------------------------------

The rules of sections 4.3 and 4.4 that the files of one version decide:
`object.json` and `datacite.json` agree on the document version and the
date of a withdrawal; `datacite.json` has the properties section 4.4
requires; a licence without an SPDX identifier has its URL; the files of
the notes, the main source and the renditions are in the version; and a
collection has its member list. The answer is a list of messages.

    // in core/rules.js:
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

Member lists
------------

The rules of sections 8.2 to 8.4 on one member, whatever its archive: a
member of a catalogue has a pin and no revisions; a member of a selection
has a revision set, each revision complete, no document version twice,
and no pin of its own.

    // in core/rules.js:
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

The pins of a member, as `osheaf verify` reads them: one in a catalogue,
one for each revision in a selection, with the document version a
revision states.

    // in core/rules.js:
    export function memberPins(m) {
      if (isObject(m) && Object.hasOwn(m, 'revisions')) {
        return (Array.isArray(m.revisions) ? m.revisions : []).map((r) => ({
          version: r?.version, pin: r?.inventorySha512, documentVersion: r?.documentVersion ?? null,
        }));
      }
      return [{ version: m?.version, pin: m?.inventorySha512, documentVersion: null }];
    }

What the indexes should hold
----------------------------

The entries of the three indexes for the objects held (section 12.5): in
`names/`, an entry for each object with a genesis record, with its
status, originator (an owner object being its own) and the text of its
genesis record; in `owners/`, the names of each owner's lines; in
`sha512/`, an entry for each version, by the digest its checksum file
states, and one for each version of a key log a fork record carries. The
objects are given as the verification read them.

    // in core/rules.js:
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
