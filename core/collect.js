// Generated from literate/24-owner-catalogues.md by opensheaf-literate: edit the document, not this file.
import { currentVersion, dateOf } from './versions.js';
import { same } from './schema.js';
import { joinPath } from './storage.js';
import { jsonBytes, sha512hex } from './write.js';
import { OBJ, OBJ_FORMAT, GENESIS, SPEC, CATALOGUE_LABEL, CannotSign, plural, short, exit, stop } from './folder.js';
import { objectId } from './names.js';
import { writeDiscovery } from './discovery.js';
import { displayName, RIGHTS } from './deposit.js';

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

export function catalogueLabel(f, owner) {
  if (owner === f.archive.owner) return CATALOGUE_LABEL;
  const own = f.labelOf(objectId(owner, owner));
  return own && own.length <= 64 - '-catalogue'.length ? `${own}-catalogue` : null;
}

export async function collect(f, { owner = null, curated = false, iKnow = false, present = null } = {}) {
  await f.initStorageRoot();
  if (owner && !f.archiveOwners().includes(owner)) exit(`${owner} is not an owner this archive hosts`);
  if (owner) return collectOwner(f, owner, { curated, iKnow });
  let last = null;
  const skipped = [];
  for (const o of f.archiveOwners()) {
    const noted = [new Map(f.labels), new Map(f.catalogues)];
    try {
      last = (await collectOwner(f, o, { curated, iKnow })) ?? last;
    } catch (error) {
      if (!(error instanceof CannotSign)) throw error;
      for (const [now, before] of [[f.labels, noted[0]], [f.catalogues, noted[1]]]) {
        now.clear();
        for (const [k, v] of before) now.set(k, v);
      }
      skipped.push(o);
      f.env.warn(`skipped the owner catalogue of ${short(o)}: ${error.reason}; osheaf collect --owner ${o} ` +
                 'collects it on a computer that holds its keys');
    }
  }
  if (skipped.length) {
    if (present) await present(f);
    stop(`${plural(skipped.length, 'owner catalogue')} not collected (${skipped.map(short).join(', ')}): this ` +
         `computer does not hold the keys to sign for ${skipped.length === 1 ? 'it' : 'them'}; the others are ` +
         'collected and the website is written');
  }
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
    if (dateOf(dc, 'Available', 'Created')) m.cite.available = dateOf(dc, 'Available', 'Created');
    members.push(m);
  }
  members = isCurated ? [] : memberOrder(members);
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
