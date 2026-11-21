// Generated from literate/42-takedown.md by opensheaf-literate: edit the document, not this file.
import { nameOf, LABEL } from './names.js';
import { sidecarDigest } from './owners.js';
import { joinPath, readJson } from './storage.js';
import { writeIndexes, writeDiscovery } from './discovery.js';
import { OBJ, GENESIS, CONFIG_NAME, exit } from './folder.js';
import { lineOf } from './describe.js';

export function tombstoneOf(f, id) {
  return f.tombstones.find((t) => t.id === id) ?? null;
}

export async function mayReturn(f, id, holds) {
  const t = tombstoneOf(f, id);
  if (!t) return true;
  if (!(await holds(Number(String(t.lastVersion).slice(1)), t.inventorySha512))) return false;
  f.tombstones.splice(f.tombstones.indexOf(t), 1);
  f.env.out(`${id} returns: its tombstone is dropped (section 13.2)`);
  return true;
}

export async function removeFolder(storage, path) {
  if (!/^(ocfl|paper|site)\/./.test(path)) throw new Error(`not a folder a takedown removes: ${path}`);
  const kind = await storage.kind(path);
  if (kind === 'dir') {
    for (const entry of (await storage.list(path)) || []) await removeFolder(storage, joinPath(path, entry.name));
  }
  if (kind) await storage.remove(path);
}

export async function removeEmptyAbove(storage, dir) {
  for (let p = dir.slice(0, dir.lastIndexOf('/')); p !== 'ocfl' && p.includes('/'); p = p.slice(0, p.lastIndexOf('/'))) {
    if (((await storage.list(p)) || []).length) break;
    await storage.remove(p);
  }
}

export async function neededOwners(f) {
  const out = new Map();
  const need = (owner, id) => {
    if (!out.has(owner)) out.set(owner, []);
    if (!out.get(owner).includes(id)) out.get(owner).push(id);
  };
  for (const { id, dir, inv } of await f.objects()) {
    if (!id || !inv || id.startsWith('sheaf:draft:')) continue;
    const [, name, owner] = id.split(':');
    if (name === owner) continue;
    need(owner, id);
    for (const ver of Object.keys(inv.versions)) {
      for (let prefix = ''; ; prefix += 'parent.chain/') {
        const bytes = await f.readLogical(dir, inv, prefix + 'parent.object.json', ver);
        if (!bytes) break;
        let pobj;
        try {
          pobj = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          break;
        }
        need(pobj?.owner, id);
      }
    }
  }
  return out;
}

export async function takedown(f, args) {
  const env = f.env;
  const id = await lineOf(f, args.label);
  if (id.startsWith('sheaf:draft:')) exit('a draft is deleted, not taken down: osheaf draft delete (section 10.1)');
  const dir = await f.dirOf(id);
  const inv = await f.inventory(dir);
  const head = (await f.readObjectJson(dir, inv, OBJ)) || {};
  const [, name, owner] = id.split(':');
  if (head.kind === 'owner') {
    const users = ((await neededOwners(f)).get(owner) || []).filter((i) => i !== id);
    if (users.length && !(args.byLaw || args.keeper)) {
      exit(`the key log of ${owner} is needed by ${users.length} object(s) of this archive: it is taken down only ` +
           "for itself, by law or at its keeper's request (section 13.2); give --by-law or --keeper");
    }
    if (users.length) {
      env.err(`warning: the signatures of ${owner} in ${users.length} object(s) become unchecked here, and the ` +
              'tombstone stands in for its key log (sections 6.5 and 13.2)');
    }
  }
  if (!args.reason || !args.reason.trim()) exit('a takedown needs --reason, a plain text (section 13.3)');
  if (!args.yes) {
    const typed = (await env.input(`take down ${id} for good? type ${name.slice(0, 8)} to confirm: `)).trim();
    if (typed !== name.slice(0, 8)) exit('not confirmed: nothing was taken down');
  }
  const genesis = await f.readLogical(dir, inv, GENESIS, 'v1');
  const tomb = { id, kind: head.kind ?? null, name, owner, genesisName: await nameOf(genesis), lastVersion: inv.head,
                 inventorySha512: sidecarDigest(await f.storage.read(joinPath(dir, 'inventory.json.sha512'))),
                 date: env.today(), reason: args.reason.trim() };
  await writeIndexes(f);
  const label = f.labelOf(id);
  if (label) f.labels.delete(label);
  const cfg = await readJson(f.storage, CONFIG_NAME);
  const former = { ...(cfg.formerAddresses || {}) };
  const gone = Object.keys(former).filter((a) => former[a] === id);
  for (const folder of [`paper/${label || name}`, `site/${label || name}`,
                        ...gone.filter((a) => LABEL.test(a)).map((a) => `site/${a}`)]) {
    await removeFolder(f.storage, folder);
  }
  if (gone.length) {
    for (const a of gone) delete former[a];
    if (Object.keys(former).length) cfg.formerAddresses = former;
    else delete cfg.formerAddresses;
    await f.writeConfig(cfg);
  }
  await removeFolder(f.storage, dir);
  await removeEmptyAbove(f.storage, dir);
  f.changed();
  f.tombstones.push(tomb);
  await writeDiscovery(f);
  env.out(`${label || id}: taken down (${inv.head}); tombstone written (section 13.3)`);
}
