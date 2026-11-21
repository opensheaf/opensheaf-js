Drafts and sealing
==================

A *draft* is a sandbox for a work not yet sealed, on which nothing may
rely; *sealing* makes from a work, under a new genesis record, the first
version of its originator's line (section 10). This chapter ports
opensheaf-py's chapter
[24-drafts](https://opensheaf.org/opensheaf-py/24-drafts.html):

```
osheaf draft new DRAFT [SOURCE] [the options of deposit]
osheaf draft deposit DRAFT [SOURCE] [the options of deposit] [--replace]
osheaf draft delete DRAFT
osheaf seal DRAFT --label LABEL [--owner OWNER] [--delete-draft] [--message TEXT]
```

A draft belongs to the reserved owner `draft`: its identifier is
`sheaf:draft:<id>`, `<id>` of the form of a label, at `draft/<id>/` in the
owner-name layout (section 10.1). It is a document like any other, with
`object.json` and `datacite.json`, but without a genesis record, and its
`object.json` has no `name`, `owner` or `parent`. It is never signed,
pinned, copied out, indexed or named by a `sheaf:` URI; the discovery
document lists it apart, in `drafts` (chapter [25](25-discovery.md)). A
draft may change: these tools add a version with every deposit, as to any
object, and rewrite only its head, on request (`--replace`): the head
version folder is removed and the root inventory goes back to the
version before, after which the deposit adds the version again. A draft
deleted leaves no tombstone. The deposits themselves are those of chapter
[26](26-deposit.md), with `draft` set, and versions are added by chapter
[23](23-folder.md), unsigned.

Sealing writes a new genesis record, with the archive's owner (or
`--owner`) as `originator`, and makes the line `sheaf:<name>:<owner>`,
whose first version holds the genesis record and the files of the
draft's head as document version 1, signed (section 10.2). The versions
of the draft are never part of the line: its history and notices, which
name its own versions, are left out with the files of the notices, and
the description keeps everything but the version and the date of its
last change.

The module is `core/drafts.js`.

    // in core/drafts.js:
    import { LABEL } from './names.js';
    import { joinPath } from './storage.js';
    import { jsonBytes } from './write.js';
    import { writeDiscovery } from './discovery.js';
    import { OBJ, GENESIS, exit } from './folder.js';
    import { deposit, landingUrl } from './deposit.js';
    import { removeFolder, removeEmptyAbove } from './takedown.js';

    <<drafts: the folder of a draft>>

    <<drafts: depositing into a draft>>

    <<drafts: sealing a draft>>

The folder of a draft
---------------------

A draft is named by its `<id>` alone, local to the archive. `dropHead`
rewrites it, removing its head version; a draft of one version goes
whole.

    // in drafts: the folder of a draft:
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
        await f.storage.write(joinPath(dir, name), await f.storage.read(joinPath(dir, `v${n - 1}`, name)));
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

Depositing into a draft
-----------------------

`draft new` makes the draft, `draft deposit` adds a version, or with
`--replace` rewrites the head; the title and the authors are asked first,
as opensheaf-py asks them.

    // in drafts: depositing into a draft:
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

Sealing
-------

The files of the draft's head become the files of the new line's first
version, with the genesis record added and the two descriptions
rewritten, in the order of opensheaf-py's: `object.json` names the line
first, then keeps what the draft's had, but its history, notices and
`previous`; `datacite.json` is the draft's, of version 1, without the
date `Updated`, with the address of the new line's landing page.

    // in drafts: sealing a draft:
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
      dc.url = landingUrl(f, label);
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
