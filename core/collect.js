// Generated from literate/24-main-catalogue.md by opensheaf-literate: edit the document, not this file.
import { currentVersion, dateOf } from './versions.js';
import { same } from './schema.js';
import { joinPath } from './storage.js';
import { jsonBytes, sha512hex } from './write.js';
import { OBJ, OBJ_FORMAT, GENESIS, SPEC, plural } from './folder.js';
import { writeDiscovery } from './discovery.js';
import { displayName, RIGHTS } from './deposit.js';

export async function documents(f) {
  const out = [], mine = f.archiveOwners();
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

export async function collect(f, { curated = false, iKnow = false } = {}) {
  await f.initStorageRoot();
  const label = f.archive.mainCollection;
  const collId = f.labels.get(label) ?? null;
  const collDir = collId ? await f.dirOf(collId) : null;
  const cinv = collDir ? await f.inventory(collDir) : null;
  if (cinv && (await f.readObjectJson(collDir, cinv, 'members.json'))?.order === 'manual') {
    f.env.out(`${label} is curated (order manual): use osheaf collection add|sync|update`);
    return null;
  }
  const isCurated = cinv === null && Boolean(curated);
  const order = isCurated ? 'manual' : ORDER;
  let members = [];
  for (const { dir, signed, obj, dc } of await documents(f)) {
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
  const owner = f.archive.owner;
  let genesis, id = collId;
  if (id === null) {
    ({ genesis, id } = await f.seal('collection', owner));
  } else {
    genesis = await f.readLogical(collDir, cinv, GENESIS);
  }
  const cur = f.archive.curator;
  const creator = { name: cur.name, nameType: 'Personal', familyName: cur.familyName };
  if (cur.givenName) creator.givenName = cur.givenName;
  if (cur.affiliation) creator.affiliation = [{ name: cur.affiliation }];
  const files = new Map([
    ['members.json', jsonBytes({ format: 'opensheaf-collection/0.2', type: 'catalogue', order, members })],
    ['datacite.json', jsonBytes({
      titles: [{ title: f.archive.name }],
      creators: [creator],
      publisher: { name: f.archive.name },
      publicationYear: Number(issued.slice(0, 4)),
      types: { resourceTypeGeneral: 'Collection' },
      version: String(version),
      url: f.archive.baseUrl,
      dates: [{ date: issued, dateType: 'Issued' }, { date: today, dateType: 'Available' }],
      descriptions: [{ description: 'The documents deposited in this archive, newest first.',
                       descriptionType: 'Abstract' }],
      rightsList: [{ ...RIGHTS['cc0-1.0'] }],
    })],
    [GENESIS, genesis],
  ]);
  const obj = { format: OBJ_FORMAT, specification: SPEC, kind: 'collection', name: id.split(':')[1], owner,
                documentVersion: version, status: 'active' };
  f.labels.set(label, id);
  const inv = await f.addVersion(id, files, obj, `Collection version ${version}: ${members.length} documents`,
                                 { acknowledged: iKnow });
  await writeDiscovery(f);
  f.env.out(`Done: the main catalogue ${label} is at ${inv.head}, with ` +
            `${members.length ? plural(members.length, 'member') : 'no members'}.`);
  return inv;
}
