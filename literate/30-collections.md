Collections
===========

A collection (section 8) is a line whose versions list members: lines of
any archive, each pinned by the digest of the inventory of one of its
versions. A **catalogue** pins one version of each member, which may
follow its line (`follow: latest`); a **selection** pins, for each member,
the document versions its curator vetted, its revisions (section 8.4).
This chapter ports opensheaf-py's chapter
[21-collections](https://opensheaf.org/opensheaf-py/21-collections.html):

```
osheaf collection new LABEL --type catalogue|selection --title TITLE [--description TEXT]
osheaf collection add LABEL URI... [--at URL]... [--follow] [--revision N]...
osheaf collection remove LABEL URI... [--revision N]...
osheaf collection follow LABEL URI... [--off]
osheaf collection update [LABEL...]
osheaf collection status LABEL
osheaf collection sync LABEL --from collection.yaml
```

with the same checks and messages, and the same `members.json` and
`datacite.json`. Members of other archives are found and checked by the
resolver of chapter [15](15-resolve.md), over HTTP: the archive itself is
its home, and other archives are read at the locations a member records
(`at`) or a command gives (`--at`). A collection pins only verified
versions (section 8.5).

    // in core/collections.js:
    import { Http } from './http.js';
    import { Archive } from './archive.js';
    import { Resolver, MEMBER_STATUS } from './resolve.js';
    import { parseSheaf, objectId, LABEL } from './names.js';
    import { historyOf, currentVersion, dateOf, memberPins } from './versions.js';
    import { same } from './schema.js';
    import { storageFetch, storageLister, compareText, ORIGIN } from './storage.js';
    import { jsonBytes } from './write.js';
    import { writeDiscovery } from './discovery.js';
    import { OBJ, OBJ_FORMAT, GENESIS, SPEC, exit, plural } from './folder.js';
    import { displayName, landingUrl, RIGHTS } from './deposit.js';
    import { memberOrder } from './collect.js';
    import { lineOf } from './describe.js';
    import { parseData } from './inputs.js';

    export const KINDS = ['catalogue', 'selection'];
    export const ORDERS = ['manual', 'issued-desc', 'issued-asc'];
    export const FORMAT = 'opensheaf-collection/0.2';

    <<the resolver of an archive>>

    <<members and revisions>>

    <<writing a collection>>

    <<the commands of collections>>

    <<following and statuses>>

    <<a collection from a file>>

The resolver of an archive
--------------------------

The home of the resolver is the archive, read from its storage through its
discovery document, so that its lines are found by their short forms as
opensheaf-py's "here" finds them; other archives are read with the fetch
of the environment (chapter [40](40-cli.md): the locations configured).
A copy is read through the archive that holds it. The home is read at an
origin of its own, not at its base URL: a member that records the base URL
of the archive in its `at` is read there too, as opensheaf-py reads it
(from the copy published, or from where the locations say it is).

    // in the resolver of an archive:
    export async function openResolver(f) {
      const base = ORIGIN;
      const http = new Http({ fetch: storageFetch(f.storage, base, { fallback: f.env.fetch }), budget: null });
      const home = await Archive.open(http, base);
      home.lister = storageLister(f.storage, base);
      return new Resolver(http, home, { local: true });
    }

    const objOf = (c) => (v) => c.line.objs.get(v) ?? null;

    async function copyJson(c, logical, ver) {
      try {
        return await c.archive.json(c.id, c.line.inv, ver, logical);
      } catch {
        return null;
      }
    }

    function historyOrder(c) {
      if (!c.latestSigned) return [];
      return historyOf(c.line.inv, objOf(c), `v${c.latestSigned}`).map((h) => objOf(c)(h)?.documentVersion);
    }

Members and revisions
---------------------

A member caches a citation of its line (section 8.2) as of the version it
pins: the title, the creators and the year of the current document version
then, and the date `Issued`. A revision of a selection gives the document
version, the object version and its digest, and the DOI of that version.

    // in members and revisions:
    export async function cite(c, k) {
      const dc = (await copyJson(c, 'datacite.json', currentVersion(c.line.inv, objOf(c), `v${k}`))) || {};
      const out = { title: (dc.titles || [{}])[0]?.title ?? '', creators: (dc.creators || []).map(displayName) };
      if (Number.isInteger(dc.publicationYear)) out.year = dc.publicationYear;
      if (dateOf(dc, 'Issued')) out.issued = dateOf(dc, 'Issued');
      return out;
    }

    export async function revision(c, k) {
      const obj = objOf(c)(`v${k}`);
      const dc = (await copyJson(c, 'datacite.json', `v${k}`)) || {};
      const out = { documentVersion: obj.documentVersion, version: `v${k}`, inventorySha512: c.digest(k) };
      if (dc.doi) out.doi = dc.doi;
      return out;
    }

    export async function memberRecord(kind, c, k, name, owner, at, follow = false) {
      const obj = objOf(c)(`v${k}`);
      const dc = (await copyJson(c, 'datacite.json', `v${k}`)) || {};
      const m = { kind: obj.kind, name, owner, at: [...at] };
      if (kind === 'catalogue') {
        Object.assign(m, { version: `v${k}`, inventorySha512: c.digest(k) });
        if (follow) m.follow = 'latest';
      } else {
        m.revisions = [await revision(c, k)];
      }
      if (dc.doi && kind === 'catalogue') m.doi = dc.doi;
      m.cite = await cite(c, k);
      return m;
    }

    export function sortRevisions(revs, order) {
      const key = (x) => (order.includes(x.documentVersion) ? order.indexOf(x.documentVersion) : order.length + x.documentVersion);
      return [...revs].sort((a, b) => key(a) - key(b));
    }

What a command names: a label of the archive, or a `sheaf:` URI (short
forms included), expanded among the lines of the archives read; the
places tried for it are the location of the URI, if any, and those given.
The locations a member records are the `https` base URLs among them, and
the archive's own base URL when its copy is held here.

    // in members and revisions:
    export async function target(f, r, text, where) {
      if (f.labels.has(text)) {
        const [, name, owner] = f.labels.get(text).split(':');
        return { name, owner, u: null, places: [] };
      }
      let u, name, owner;
      const places = [];
      try {
        u = parseSheaf(text, { short: true, fold: true });
        for (const w of [...(u.at ? [u.at] : []), ...where]) if (w && !places.includes(w)) places.push(w);
        [name, owner] = await r.expand(u, places);
      } catch (error) {
        exit(error.message);
      }
      return { name, owner, u, places };
    }

    export function recordedAt(f, r, found, places) {
      const out = places.filter((w) => typeof w === 'string' && w.startsWith('https://') && w.endsWith('/'));
      const c = found.copy;
      if (c && c.archive === r.home) out.push(f.archive.baseUrl);
      else if (c && c.where.startsWith('https://')) out.push(c.where);
      return [...new Set(out)];
    }

The versions a member pins: the version a URI with a digest names; the
document versions asked for, in a selection; or else the latest signed
version of the line, which a selection takes as its current document
version.

    // in members and revisions:
    export async function pinned(r, name, owner, u, places, kind, revisions = []) {
      let founds;
      if (u?.sha512) {
        founds = [(await r.resolve(String(u), places)).found];
      } else if (kind === 'selection' && revisions.length) {
        founds = [];
        for (const n of revisions) founds.push(await r.documentVersion(name, owner, n, places));
      } else {
        let found = await r.latest(name, owner, places);
        if (kind === 'selection' && found.copy) {
          const c = found.copy;
          const cur = currentVersion(c.line.inv, objOf(c), found.version);
          const k = Number(cur.slice(1));
          found = { ...found, status: MEMBER_STATUS[c.status(k)] || 'not a version', version: cur, digest: c.digest(k) };
        }
        founds = [found];
      }
      for (const fd of founds) {
        if (fd.status !== 'verified' || !fd.copy) {
          const notes = r.notes.map((n) => n.message).join('; ');
          exit(`sheaf:${name}:${owner}: ${fd.status}` + (notes ? ` (${notes})` : '') +
               ': a collection pins only verified versions (section 8.5)');
        }
      }
      return founds;
    }

Writing a collection
--------------------

A new version of a collection, signed by its owner: `members.json`, in the
order the collection declares, and `datacite.json`, whose title and
description are kept unless new ones are given, with the DOIs of the
members as parts. The document version of a collection counts the changes
of its members; a new title or description alone keeps it. Nothing
changed, nothing is written.

    // in writing a collection:
    export function describeCollection(f, title, description, version, issued, members, label = null) {
      const cur = f.archive.curator;
      const creator = { name: cur.name, nameType: 'Personal', familyName: cur.familyName };
      if (cur.givenName) creator.givenName = cur.givenName;
      const dc = { titles: [{ title }], creators: [creator], publisher: { name: f.archive.name },
                   publicationYear: Number(issued.slice(0, 4)), types: { resourceTypeGeneral: 'Collection' },
                   version: String(version),
                   dates: [{ date: issued, dateType: 'Issued' }, { date: f.env.today(), dateType: 'Available' }],
                   rightsList: [{ ...RIGHTS['cc0-1.0'] }] };
      if (label) dc.url = landingUrl(f, label);
      if (description) dc.descriptions = [{ description, descriptionType: 'Abstract' }];
      const dois = [...members.filter((m) => m.doi).map((m) => m.doi),
                    ...members.flatMap((m) => (m.revisions || []).filter((x) => x.doi).map((x) => x.doi))];
      if (dois.length) {
        dc.relatedIdentifiers = [...new Set(dois)].map((x) => ({ relatedIdentifier: x, relatedIdentifierType: 'DOI',
                                                                  relationType: 'HasPart' }));
      }
      return dc;
    }

    export async function write(f, collId, mem, { message, title = null, description = null, owner = null, label = null }) {
      const dir = collId ? await f.dirOf(collId) : null;
      const inv = dir ? await f.inventory(dir) : null;
      mem = { ...mem };
      if ((mem.order ?? 'manual') !== 'manual') mem.members = memberOrder(mem.members, mem.order);
      let version = 1, issued = f.env.today(), genesis = null;
      if (inv) {
        const oldMem = await f.readObjectJson(dir, inv, 'members.json');
        const oldDc = (await f.readObjectJson(dir, inv, 'datacite.json')) || {};
        const oldTitle = (oldDc.titles || [{}])[0]?.title ?? null;
        const oldDesc = (oldDc.descriptions || []).find((x) => x.descriptionType === 'Abstract')?.description ?? null;
        title = title ?? oldTitle;
        description = description ?? oldDesc;
        version = (await f.readObjectJson(dir, inv, OBJ)).documentVersion;
        if (!same(oldMem, mem)) {
          version += 1;
        } else if (title === oldTitle && description === oldDesc) {
          f.env.out(`${f.labelOf(collId) || collId}: unchanged (${inv.head})`);
          return null;
        }
        issued = dateOf(oldDc, 'Issued') || f.env.today();
        genesis = await f.readLogical(dir, inv, GENESIS);
        owner = collId.split(':')[2];
      } else {
        ({ genesis, id: collId } = await f.seal('collection', owner));
      }
      label = label || f.labelOf(collId);
      const files = new Map([
        ['members.json', jsonBytes(mem)], [GENESIS, genesis],
        ['datacite.json', jsonBytes(describeCollection(f, title, description, version, issued, mem.members, label))],
      ]);
      const obj = { format: OBJ_FORMAT, specification: SPEC, kind: 'collection', name: collId.split(':')[1], owner,
                    documentVersion: version, status: 'active' };
      if (label) f.labels.set(label, collId);
      const done = await f.addVersion(collId, files, obj, message);
      await writeDiscovery(f);
      const n = mem.members.length;
      f.env.out(`Done: the collection ${label || collId} is at ${done.head}, document version ${version}, with ` +
                `${n ? plural(n, 'member') : 'no members'}.`);
      return done;
    }

`memberOrder` (chapter [24](24-main-catalogue.md)) sorts by the order the
collection declares, `issued-desc` or `issued-asc`.

The commands
------------

    // in the commands of collections:
    export async function held(f, label) {
      const collId = await lineOf(f, label);
      const dir = await f.dirOf(collId);
      const inv = await f.inventory(dir);
      const head = (await f.readObjectJson(dir, inv, OBJ)) || {};
      if (head.kind !== 'collection') exit(`${label} is not a collection`);
      if (!f.archiveOwners().includes(head.owner)) exit(`${label} is a collection of an owner this archive does not host`);
      return { collId, dir, inv, mem: await f.readObjectJson(dir, inv, 'members.json') };
    }

    export async function newCollection(f, a) {
      if (f.labels.has(a.label) || !LABEL.test(a.label || '')) exit(`${a.label}: a new label of the form of section 3.1`);
      if (!KINDS.includes(a.type) || !a.title) exit('a new collection needs --type catalogue|selection and --title');
      const owner = a.owner || f.archive.owner;
      if (!f.archiveOwners().includes(owner)) exit(`${owner} is not an owner this archive hosts`);
      await f.initStorageRoot();
      const mem = { format: FORMAT, type: a.type, order: a.order || 'manual', members: [] };
      return write(f, null, mem, { message: `New ${a.type}: ${a.title}`, title: a.title,
                                   description: a.description ?? null, owner, label: a.label });
    }

    export async function add(f, a) {
      const { collId, mem } = await held(f, a.collection);
      const kind = mem.type, changed = [];
      if (kind === 'catalogue' && a.revision?.length) {
        exit('--revision is for selections: a catalogue pins one version of each member');
      }
      const r = await openResolver(f);
      for (const text of a.uri) {
        const { name, owner, u, places } = await target(f, r, text, a.at || []);
        const founds = await pinned(r, name, owner, u, places, kind, a.revision || []);
        const at = recordedAt(f, r, founds[0], places);
        if (!at.length) exit(`${text}: no https base URL where copies are found: give --at URL (section 8.2)`);
        const c = founds[0].copy;
        let m = mem.members.find((x) => x.name === name && x.owner === owner) ?? null;
        if (m !== null && kind === 'catalogue') exit(`${text} is a member already (osheaf collection follow, or update)`);
        let rest = founds;
        if (m === null) {
          m = await memberRecord(kind, c, Number(founds[0].version.slice(1)), name, owner, at, a.follow);
          mem.members.push(m);
          rest = founds.slice(1);
        }
        if (kind === 'selection') {
          for (const fd of rest) {
            const rev = await revision(fd.copy, Number(fd.version.slice(1)));
            if (m.revisions.every((x) => x.documentVersion !== rev.documentVersion)) m.revisions.push(rev);
          }
          m.revisions = sortRevisions(m.revisions, historyOrder(c));
        }
        changed.push(`sheaf:${name}:${owner}`);
      }
      return write(f, collId, mem, { message: a.message || `Added: ${changed.join(', ')}` });
    }

A member is named by a label, a `sheaf:` URI, or the beginning of its
name. `--revision` removes those revisions of a member of a selection,
and the member with its last one; nothing removed is an error.

    // in the commands of collections:
    export function matches(f, m, text) {
      if (f.labels.has(text)) return f.labels.get(text) === objectId(m.name, m.owner);
      let u;
      try {
        u = parseSheaf(text, { short: true, fold: true });
      } catch {
        return m.name.startsWith(text);
      }
      return u.matches(m.name, m.owner);
    }

    export async function remove(f, a) {
      const { collId, mem } = await held(f, a.collection);
      const out = [];
      let changed = false;
      for (const m of mem.members) {
        if (!a.uri.some((t) => matches(f, m, t))) {
          out.push(m);
        } else if (a.revision?.length && m.revisions?.length) {
          const kept = m.revisions.filter((x) => !a.revision.includes(x.documentVersion));
          changed ||= kept.length < m.revisions.length;
          if (kept.length) out.push({ ...m, revisions: kept });
        } else {
          changed = true;
        }
      }
      if (!changed) exit('no member matches');
      mem.members = out;
      return write(f, collId, mem, { message: a.message || `Removed: ${a.uri.join(', ')}` });
    }

    export async function follow(f, a) {
      const { collId, mem } = await held(f, a.collection);
      if (mem.type !== 'catalogue') exit('only the members of a catalogue follow their lines (section 8.3)');
      const found = mem.members.filter((m) => a.uri.some((t) => matches(f, m, t)));
      if (!found.length) exit('no member matches');
      for (const m of found) {
        if (a.off) delete m.follow;
        else m.follow = 'latest';
      }
      return write(f, collId, mem, { message: a.message || (a.off ? 'Not followed: ' : 'Followed: ') + a.uri.join(', ') });
    }

`osheaf collection remove` with `--revision` removes a member whose
revisions are all removed. It compares the members before and after as
opensheaf-py does, by value: a member whose revisions were changed in
place counts as the same, which is a quirk of opensheaf-py this port
keeps.

Following and statuses
----------------------

`osheaf collection update` moves the pin of each followed member of a
catalogue to the latest signed version of its line that extends it
(section 8.3), and tells, for a selection, the document versions not
vetted. Without labels, it updates every collection of the archive's
owners but a main catalogue that `osheaf collect` makes.

    // in following and statuses:
    export async function update(f, a) {
      let labels = a.collection || [];
      if (!labels.length) {
        for (const [label, id] of [...f.labels].sort((x, y) => compareText(x[0], y[0]))) {
          if (await isCurated(f, label, id)) labels.push(label);
        }
      }
      for (const label of labels) {
        const { collId, mem } = await held(f, label);
        const changed = [];
        const r = await openResolver(f);
        for (const m of mem.members) {
          if (mem.type === 'selection') await reportUnvetted(f, r, label, m);
          else if (m.follow === 'latest' && await followMember(f, r, label, m)) {
            changed.push(`sheaf:${m.name}:${m.owner} ${m.version}`);
          }
        }
        for (const { level, message } of r.notes) f.env.out(`${level}: ${message}`);
        if (changed.length) await write(f, collId, mem, { message: `Followed: ${changed.join(', ')}` });
        else f.env.out(`${label}: no member to follow further`);
      }
    }

    async function isCurated(f, label, id) {
      const dir = await f.dirOf(id);
      const inv = await f.inventory(dir);
      const head = inv ? await f.readObjectJson(dir, inv, OBJ) : {};
      if (head?.kind !== 'collection' || !f.archiveOwners().includes(head.owner)) return false;
      const mem = (await f.readObjectJson(dir, inv, 'members.json')) || {};
      return !(label === f.archive.mainCollection && mem.order !== 'manual');
    }

    async function followMember(f, r, label, m) {
      const log = await r.keyLog(m.owner, m.at || []);
      if (log && log.forkPoint) {
        f.env.out(`${label}: sheaf:${m.name}:${m.owner}: its owner's key log forks at v${log.forkPoint}: ` +
                  'not followed (section 7.5)');
        return false;
      }
      const found = await r.latest(m.name, m.owner, m.at || []);
      if (!found.copy) {
        f.env.out(`${label}: sheaf:${m.name}:${m.owner}: ${found.status}: the pin is kept`);
        return false;
      }
      const c = found.copy, k = Number(found.version.slice(1)), old = Number(m.version.slice(1));
      if (c.digest(old) !== m.inventorySha512) {
        f.env.out(`${label}: sheaf:${m.name}:${m.owner}: the copy at ${c.where} does not extend the pin ` +
                  `${m.version}: a fork of the line (section 7.4); the pin is kept`);
        return false;
      }
      if (k <= old) return false;
      Object.assign(m, { version: `v${k}`, inventorySha512: c.digest(k), cite: await cite(c, k) });
      return true;
    }

    async function reportUnvetted(f, r, label, m) {
      const found = await r.latest(m.name, m.owner, m.at || []);
      if (!found.copy) return;
      const vetted = new Set(m.revisions.map((x) => x.documentVersion));
      const rest = historyOrder(found.copy).filter((n) => !vetted.has(n));
      if (rest.length) {
        f.env.out(`${label}: sheaf:${m.name}:${m.owner}: document version(s) ${rest.join(', ')} not vetted`);
      }
    }

`osheaf collection status LABEL` gives the status of every pin (section
8.5): verified, contested, unchecked, mismatch, not a version, removed,
unavailable.

    // in following and statuses:
    export async function status(f, a) {
      const { mem } = await held(f, a.collection);
      const r = await openResolver(f);
      for (const m of mem.members) {
        for (const { version, pin } of memberPins(m)) {
          const found = await r.pin(m.name, m.owner, version, pin, m.at || []);
          f.env.out(`${found.status}: sheaf:${m.name}:${m.owner} ${version} (${m.cite?.title ?? ''})`);
        }
      }
      for (const { level, message } of r.notes) f.env.out(`${level}: ${message}`);
    }

A collection from a file
------------------------

`osheaf collection sync LABEL --from collection.yaml` writes a collection
from a description: its title, description, type, order, owner and members,
each a URI or a label, with its locations, `follow` for a catalogue, and
`revisions` for a selection. A member already in the collection keeps its
pin; one that is new is resolved and pinned. The type of an existing
collection does not change.

    // in a collection from a file:
    export async function loadSpec(name, text) {
      const spec = await parseData(name, text, { yaml11: true });
      if (spec === null || typeof spec !== 'object' || Array.isArray(spec) ||
          !Array.isArray(spec.members ?? [])) exit(`${name}: a mapping with members, a list`);
      for (const k of Object.keys(spec)) {
        if (!['title', 'description', 'type', 'order', 'owner', 'members'].includes(k)) exit(`${name}: unknown key ${k}`);
      }
      if (!KINDS.includes(spec.type ?? 'catalogue') || !ORDERS.includes(spec.order ?? 'manual')) {
        exit(`${name}: type is catalogue or selection, order one of ${ORDERS.join(', ')}`);
      }
      return spec;
    }

    export async function sync(f, a) {
      const spec = await loadSpec(a.fromFile.name, a.fromFile.text);
      const exists = f.labels.has(a.collection);
      let collId = null, old, kind;
      if (exists) {
        ({ collId, mem: old } = await held(f, a.collection));
        kind = old.type;
        if ((spec.type ?? kind) !== kind) exit(`${a.collection} is a ${kind}: its type does not change`);
      } else {
        if (!spec.title) exit('a new collection needs a title');
        old = { members: [] };
        kind = spec.type ?? 'catalogue';
        if (!('type' in spec)) f.env.out(`${a.collection}: no type: a catalogue`);
      }
      const members = [];
      const r = await openResolver(f);
      for (const entry of spec.members ?? []) members.push(await syncMember(f, r, entry, kind, old.members));
      const mem = { format: FORMAT, type: kind, order: spec.order ?? old.order ?? 'manual', members };
      const owner = spec.owner || f.archive.owner;
      if (!exists) await f.initStorageRoot();
      return write(f, collId, mem, { message: a.message || `Members from ${a.fromFile.given}`,
                                     title: spec.title ?? null, description: spec.description ?? null, owner,
                                     label: a.collection });
    }

    async function syncMember(f, r, entry, kind, oldMembers) {
      if (typeof entry === 'string') entry = { uri: entry };
      const text = entry.uri || entry.label;
      if (!text) exit(`a member needs uri or label: ${pyRepr(entry)}`);
      let at = entry.at || [];
      at = typeof at === 'string' ? [at] : [...at];
      const { name, owner, u, places } = await target(f, r, String(text), at);
      const follow = [true, 'yes', 'true', 'latest'].includes(entry.follow);
      const revs = (entry.revisions || []).map((x) => Number.parseInt(x, 10));
      if (kind === 'catalogue' && revs.length) exit(`${text}: revisions are for selections`);
      const old = oldMembers.find((m) => m.name === name && m.owner === owner) ?? null;
      if (old !== null && !u?.sha512) {
        const m = JSON.parse(JSON.stringify(old));
        if (at.length) m.at = [...new Set([...at, ...m.at])];
        if (kind === 'catalogue') {
          delete m.follow;
          if (follow) m.follow = 'latest';
          return m;
        }
        const vetted = new Set(m.revisions.map((x) => x.documentVersion));
        const asked = new Set(revs);
        if (!revs.length || (asked.size === vetted.size && [...asked].every((n) => vetted.has(n)))) {
          return m;
        }
        const founds = await pinned(r, name, owner, u, places, kind, revs.filter((n) => !vetted.has(n)));
        m.revisions = m.revisions.filter((x) => revs.includes(x.documentVersion));
        for (const fd of founds) m.revisions.push(await revision(fd.copy, Number(fd.version.slice(1))));
        m.revisions = sortRevisions(m.revisions, historyOrder(founds[0].copy));
        return m;
      }
      const founds = await pinned(r, name, owner, u, places, kind, revs);
      const recAt = recordedAt(f, r, founds[0], places);
      if (!recAt.length) exit(`${text}: no https base URL where copies are found: give at (section 8.2)`);
      const c = founds[0].copy;
      const m = await memberRecord(kind, c, Number(founds[0].version.slice(1)), name, owner, recAt, follow);
      if (kind === 'selection') {
        const revisions = [];
        for (const fd of founds) revisions.push(await revision(fd.copy, Number(fd.version.slice(1))));
        m.revisions = sortRevisions(revisions, historyOrder(c));
      }
      return m;
    }

    function pyRepr(entry) {
      return '{' + Object.entries(entry).map(([k, v]) => `'${k}': ${typeof v === 'string' ? `'${v}'` : JSON.stringify(v)}`)
        .join(', ') + '}';
    }
