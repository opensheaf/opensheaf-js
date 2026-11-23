// Generated from literate/41-drafts.md by opensheaf-literate: edit the document, not this file.
import { LABEL } from './names.js';
import { joinPath, replaceFile } from './storage.js';
import { jsonBytes } from './write.js';
import { writeDiscovery } from './discovery.js';
import { OBJ, GENESIS, exit } from './folder.js';
import { deposit, landingUrl } from './deposit.js';
import { removeFolder, removeEmptyAbove } from './takedown.js';

export async function draftDir(f, draftId) {
  if (!draftId || !LABEL.test(draftId) || draftId.length > 64) exit(`${draftId}: not the identifier of a draft (section 10.1)`);
  const id = `sheaf:draft:${draftId}`;
  const dir = await f.dirOf(id);
  const inv = await f.inventory(dir);
  if (!inv) exit(`no draft ${draftId} in this archive`);
  return { id, dir, inv };
}

async function dropHead(f, dir, inv) {
  const n = Number(inv.head.slice(1));
  if (n === 1) {
    await removeFolder(f.storage, dir);
    return;
  }
  await removeFolder(f.storage, joinPath(dir, `v${n}`));
  for (const name of ['inventory.json', 'inventory.json.sha512']) {
    await replaceFile(f.storage, joinPath(dir, name), await f.storage.read(joinPath(dir, `v${n - 1}`, name)));
  }
}

export async function draftDelete(f, args) {
  const { dir } = await draftDir(f, args.label);
  await removeFolder(f.storage, dir);
  await removeEmptyAbove(f.storage, dir);
  f.changed();
  await writeDiscovery(f);
  f.env.out(`draft ${args.label}: deleted`);
}

export async function draftDeposit(f, args, isNew = false) {
  if (!args.title || !args.author?.length) exit('a deposit into a draft needs --title and --author');
  const a = { ...args, draft: true, new: isNew };
  if (!isNew && args.replace) {
    const { dir, inv } = await draftDir(f, args.label);
    await dropHead(f, dir, inv);
    f.changed();
    if ((await f.storage.kind(joinPath(dir, 'inventory.json'))) !== 'file') a.new = true;
  }
  await deposit(f, a);
}

export async function seal(f, args) {
  const { dir, inv } = await draftDir(f, args.label);
  const label = args.newLabel;
  if (!label || !LABEL.test(label) || label.length > 64 || f.labels.has(label)) {
    exit(`--label: a new label of the form of section 3.1 (not ${label ? `'${label}'` : 'None'})`);
  }
  const owner = args.owner || f.archive.owner;
  if (!f.archiveOwners().includes(owner)) exit(`${owner} is not an owner this archive hosts`);
  const head = await f.readObjectJson(dir, inv, OBJ);
  const dc = await f.readObjectJson(dir, inv, 'datacite.json');
  const notes = new Set((head.notices || []).filter((n) => n.path).map((n) => n.path));
  const files = new Map();
  for (const [d, paths] of Object.entries(inv.versions[inv.head].state)) {
    for (const p of paths) {
      if (p !== OBJ && p !== 'datacite.json' && !notes.has(p)) files.set(p, await f.storage.read(joinPath(dir, inv.manifest[d][0])));
    }
  }
  const kept = Object.fromEntries(Object.entries(head).filter(([k]) => !['history', 'notices', 'previous'].includes(k)));
  kept.documentVersion = 1;
  dc.version = '1';
  dc.dates = (dc.dates || []).filter((x) => x.dateType !== 'Updated');
  const { genesis, id: line } = await f.seal(head.kind, owner);
  const rest = Object.fromEntries(Object.entries(kept).filter(([k]) => !['format', 'specification', 'kind'].includes(k)));
  const obj = { format: kept.format, specification: kept.specification, kind: kept.kind, name: line.split(':')[1], owner, ...rest };
  dc.url = await landingUrl(f, line);
  files.set(GENESIS, genesis);
  files.set('datacite.json', jsonBytes(dc));
  const done = await f.addVersion(line, files, obj, args.message || `Sealed from the draft ${args.label}`);
  f.labels.set(label, line);
  if (args.deleteDraft) {
    await removeFolder(f.storage, dir);
    f.changed();
  }
  await writeDiscovery(f);
  f.env.out(`${label}: ${done.head} (document version 1) ${line}, sealed from the draft ${args.label}`);
}
