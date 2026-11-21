Takedowns and tombstones
========================

An owner *withdraws* a line, by a description-only version that keeps
every version (chapter [29](29-description.md), section 13.1); an
archive *takes down* an object, which deletes it and leaves a tombstone
(sections 13.2 and 13.3). This chapter ports opensheaf-py's chapter
[25-takedown](https://opensheaf.org/opensheaf-py/25-takedown.html): the
command `osheaf takedown LABEL --reason TEXT [--by-law | --keeper]
[--yes]`, the tombstones it writes, and the rule by which a line taken
down returns. The module is `core/takedown.js`.

What a takedown does, as opensheaf-py does it:

- it deletes a sealed object, its witness folder included, from the
  storage root, with the folders the deletion leaves empty, and its
  landing page and HTML version, and its former addresses
  (`formerAddresses` of `osheaf.json`, written by `osheaf label`, chapter
  [31](31-website.md)), their pages and their record; the rest of the website is written again
  after the command, as after every change, and leaves out every member
  whose line has a tombstone (chapter [31](31-website.md));
- it leaves in place the key logs a line's copy carries (section 6.5);
  a key log that objects of the archive need (a line of its owner, or a
  branch whose evidence holds its owner's signatures, at any level) is
  taken down only for itself, by law or at its keeper's request (section
  6.6), and the command asks for `--by-law` or `--keeper` then;
- it writes a tombstone with the fields of section 13.3: `id`, `kind`,
  `name`, `owner`, `genesisName` (so that a later deposit of the same
  genesis record is refused, section 5.4), `lastVersion` and
  `inventorySha512` (a pin of the head), `date` and `reason`;
- the indexes keep the object's entries in `names/` and `sha512/` with the
  status `removed` (chapter [25](25-discovery.md)): they are carried from
  the index files being replaced, so these are written just before the
  files go.

A draft is never taken down: it is deleted, and leaves no tombstone
(chapter [41](41-drafts.md)).

    // in core/takedown.js:
    import { nameOf, LABEL } from './names.js';
    import { sidecarDigest } from './owners.js';
    import { joinPath, readJson } from './storage.js';
    import { writeIndexes, writeDiscovery } from './discovery.js';
    import { OBJ, GENESIS, CONFIG_NAME, exit } from './folder.js';
    import { lineOf } from './describe.js';

    <<takedown: the tombstone of a line, and its return>>

    <<takedown: folders removed>>

    <<takedown: the key logs the objects of the archive need>>

    <<takedown: the command>>

The return of a line
--------------------

A line taken down returns only from a copy holding the version its
tombstone pins (section 13.2), added as section 7.5 says; its tombstone
is then dropped, and written with the next discovery document. A
[mirror](38-mirrors.md) and the copies of key logs check this with
`mayReturn`, given a function telling whether the copy holds a version
with a given digest.

    // in takedown: the tombstone of a line, and its return:
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

Folders removed
---------------

A folder of the archive is removed with everything below it, as Python's
`shutil.rmtree` removes it; only the folders a command may remove are
accepted (the storage root, the landing pages, the HTML versions), so
that a mistake cannot remove the archive.

    // in takedown: folders removed:
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

The key logs needed
-------------------

The owner of every line held needs its key log, and a branch needs the key
log of the owner of each parent whose signatures its evidence holds, at
every level of `parent.chain/`, in any version (section 6.5).

    // in takedown: the key logs the objects of the archive need:
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

The command
-----------

The object is named by its label or its identifier (a key log by
`sheaf:<owner>:<owner>`); a confirmation is asked, the first eight
characters of the line's name typed back, unless `--yes`. The main
catalogue keeps its member, a pin of a version now removed (section
8.5), until `osheaf collect` writes its next version.

    // in takedown: the command:
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
