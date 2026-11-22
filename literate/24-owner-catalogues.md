The owner catalogues
====================

Each owner an archive hosts has there an *owner catalogue* of its own
(section 8.1): a collection, signed by that owner, that lists its
documents in the archive, each pinned to its latest signed version and
following its line, branches of its own included (section 9), never the
copies the archive holds of others' lines. Version 0.2 had at first one
*main catalogue* per archive, a line of the archive's owner listing the
lines of every owner it hosts, so that a deposit by another owner needed a
new version signed by the archive's owner; since #72 a change by an owner
touches its own catalogue only, and no owner signs for another.

An owner catalogue is sealed when the owner is set up in the archive:
`osheaf init` seals that of the archive's first owner (labelled `main`),
`osheaf owner init` that of another. The discovery document names each
with its owner in `owners` (section 3.1), and the folder reads them from
there (`catalogues`, chapter [23](23-folder.md)). `osheaf collect` adds a
version to each owner catalogue whose documents have a new signed version,
or, with `--owner`, to that one owner's, as opensheaf-py's `collect` does
(its chapter
[15-owner-catalogues](https://opensheaf.org/opensheaf-py/15-owner-catalogues.html)),
with the same members in the same order and the same descriptions. A
curated owner catalogue (`order` `manual`) is changed by `osheaf
collection` (chapter [30](30-collections.md)), and `collect` leaves it
alone.

The module is `core/collect.js`.

    // in core/collect.js:
    import { currentVersion, dateOf } from './versions.js';
    import { same } from './schema.js';
    import { joinPath } from './storage.js';
    import { jsonBytes, sha512hex } from './write.js';
    import { OBJ, OBJ_FORMAT, GENESIS, SPEC, CATALOGUE_LABEL, plural, short, exit } from './folder.js';
    import { objectId } from './names.js';
    import { writeDiscovery } from './discovery.js';
    import { displayName, RIGHTS } from './deposit.js';

    <<the documents of the archive>>

    <<the order of the members>>

    <<new versions of the owner catalogues>>

The documents
-------------

The documents of an owner are its lines of documents in the archive
(without an owner, those of every owner the archive hosts); each is listed at its latest signed version,
with the citation of its current document version as of that version. A
line with no signed version is left out, with a warning.

    // in the documents of the archive:
    export async function documents(f, owner = null) {
      const out = [], mine = owner ? [owner] : f.archiveOwners();
      for (const { id, dir, inv } of await f.objects()) {
        if (!inv || typeof id !== 'string' || id.startsWith('sheaf:draft:')) continue;
        const head = await f.readObjectJson(dir, inv, OBJ);
        if (head?.kind !== 'document' || !mine.includes(head.owner)) continue;
        const line = await f.line(id);
        const signed = line.latest;
        if (!signed) {
          f.env.err(`warning: ${f.labelOf(id) || id} has no signed version (section 7.3): left out`);
          continue;
        }
        const cur = currentVersion(inv, (v) => line.objs.get(v) ?? null, signed);
        out.push({ id, dir, inv, signed, cur, obj: await f.readObjectJson(dir, inv, OBJ, cur),
                   dc: await f.readObjectJson(dir, inv, 'datacite.json', cur) });
      }
      return out;
    }

The order
---------

A catalogue in the order `issued-desc` (section 8.2) lists its members by
their Issued date, then their Available date, newest first; members with
neither come last; ties go by name and then owner. The Available date
orders only: it is not part of the citation kept in the member. A
collection of another order, `issued-asc`, gives it to `memberOrder`
(chapter [30](30-collections.md)), as opensheaf-py sets its `ORDER` for a
while.

    // in the order of the members:
    export const ORDER = 'issued-desc';

    function compareTuples(a, b) {
      for (let k = 0; k < a.length; k++) {
        if (a[k] < b[k]) return -1;
        if (a[k] > b[k]) return 1;
      }
      return 0;
    }

    export function memberOrder(members, order = ORDER) {
      const key = (m) => [m.cite?.issued || '', m.cite?.available || ''];
      const line = (a, b) => compareTuples([a.name ?? '', a.owner ?? ''], [b.name ?? '', b.owner ?? '']);
      const dated = members.filter((m) => key(m).some(Boolean)).sort(line);
      dated.sort((a, b) => (order === 'issued-desc' ? compareTuples(key(b), key(a)) : compareTuples(key(a), key(b))));
      return [...dated, ...members.filter((m) => !key(m).some(Boolean)).sort(line)];
    }

The comparisons of strings here are those of JavaScript, by UTF-16 code
units: dates and names are ASCII, where they agree with Python's.

New versions
------------

`collect` goes through the owners the archive hosts, or the one given
(which must be one of them), and for each makes the members of its
catalogue from its documents; if they are those of the head of the
catalogue, nothing is done. Otherwise a new version is added, signed by
that owner: `members.json`, a DataCite description of the catalogue (the
archive as a collection, its curator as creator, CC0; the title of an
owner other than the archive's first followed by its label or short
name), and its genesis record, made when the catalogue is first sealed.
The catalogue of the archive's first owner gets the label `main` when it
is sealed, if that label is free; that of another owner
`<label>-catalogue`, after the label of the owner's key log, if the owner
has one and that label is free, and none otherwise (`catalogueLabel`, as
opensheaf-py's `catalogue_label`); `osheaf label --owner` labels it so
when the owner gets a label later.

    // in new versions of the owner catalogues:
    export function catalogueLabel(f, owner) {
      if (owner === f.archive.owner) return CATALOGUE_LABEL;
      const own = f.labelOf(objectId(owner, owner));
      return own && own.length <= 64 - '-catalogue'.length ? `${own}-catalogue` : null;
    }

    export async function collect(f, { owner = null, curated = false, iKnow = false } = {}) {
      await f.initStorageRoot();
      if (owner && !f.archiveOwners().includes(owner)) exit(`${owner} is not an owner this archive hosts`);
      let last = null;
      for (const o of owner ? [owner] : f.archiveOwners()) last = (await collectOwner(f, o, { curated, iKnow })) ?? last;
      return last;
    }

    export async function collectOwner(f, owner, { curated = false, iKnow = false } = {}) {
      const collId = f.catalogues.get(owner) ?? null;
      const collDir = collId ? await f.dirOf(collId) : null;
      const cinv = collDir ? await f.inventory(collDir) : null;
      let label = (collId ? f.labelOf(collId) : null) || short(owner);
      if (cinv && (await f.readObjectJson(collDir, cinv, 'members.json'))?.order === 'manual') {
        f.env.out(`${label} is curated (order manual): use osheaf collection add|sync|update`);
        return null;
      }
      const isCurated = cinv === null && Boolean(curated);
      const order = isCurated ? 'manual' : ORDER;
      let members = [];
      for (const { dir, signed, obj, dc } of await documents(f, owner)) {
        const cite = { title: dc.titles[0].title, creators: dc.creators.map(displayName), year: dc.publicationYear };
        if (dateOf(dc, 'Issued')) cite.issued = dateOf(dc, 'Issued');
        const m = { kind: 'document', name: obj.name, owner: obj.owner, at: [f.archive.baseUrl], version: signed,
                    inventorySha512: await sha512hex(await f.storage.read(joinPath(dir, signed, 'inventory.json'))),
                    follow: 'latest', cite };
        m.cite.available = dateOf(dc, 'Available', 'Created');
        members.push(m);
      }
      members = isCurated ? [] : memberOrder(members);
      for (const m of members) delete m.cite.available;
      const today = f.env.today();
      let version = 1, issued = today;
      if (cinv) {
        const old = await f.readObjectJson(collDir, cinv, 'members.json');
        if (same(old.members, members) && old.type === 'catalogue') {
          f.env.out(`${label}: unchanged (${cinv.head})`);
          return null;
        }
        version = (await f.readObjectJson(collDir, cinv, OBJ)).documentVersion + 1;
        issued = dateOf(await f.readObjectJson(collDir, cinv, 'datacite.json'), 'Issued') || today;
      }
      let genesis, id = collId;
      if (id === null) {
        ({ genesis, id } = await f.seal('collection', owner));
        const wanted = catalogueLabel(f, owner);
        if (wanted && !f.labels.has(wanted)) f.labels.set(wanted, id);
      } else {
        genesis = await f.readLogical(collDir, cinv, GENESIS);
      }
      f.catalogues.set(owner, id);
      let title = f.archive.name;
      if (owner !== f.archive.owner) title += ', ' + (f.labelOf(objectId(owner, owner)) || short(owner));
      const cur = f.archive.curator;
      const creator = { name: cur.name, nameType: 'Personal', familyName: cur.familyName };
      if (cur.givenName) creator.givenName = cur.givenName;
      if (cur.affiliation) creator.affiliation = [{ name: cur.affiliation }];
      const files = new Map([
        ['members.json', jsonBytes({ format: 'opensheaf-collection/0.2', type: 'catalogue', order, members })],
        ['datacite.json', jsonBytes({
          titles: [{ title }],
          creators: [creator],
          publisher: { name: f.archive.name },
          publicationYear: Number(issued.slice(0, 4)),
          types: { resourceTypeGeneral: 'Collection' },
          version: String(version),
          url: f.archive.baseUrl,
          dates: [{ date: issued, dateType: 'Issued' }, { date: today, dateType: 'Available' }],
          descriptions: [{ description: 'The documents of one owner deposited in this archive, newest first.',
                           descriptionType: 'Abstract' }],
          rightsList: [{ ...RIGHTS['cc0-1.0'] }],
        })],
        [GENESIS, genesis],
      ]);
      const obj = { format: OBJ_FORMAT, specification: SPEC, kind: 'collection', name: id.split(':')[1], owner,
                    documentVersion: version, status: 'active' };
      label = f.labelOf(id) || id;
      const inv = await f.addVersion(id, files, obj, `Collection version ${version}: ${members.length} documents`,
                                     { acknowledged: iKnow });
      await writeDiscovery(f);
      f.env.out(`Done: the owner catalogue ${label} of ${short(owner)} is at ${inv.head}, with ` +
                `${members.length ? plural(members.length, 'member') : 'no members'}.`);
      return inv;
    }
