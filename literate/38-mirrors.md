Resolution and mirrors
======================

The reading of other archives is the Explorer's resolver (chapter
[15](15-resolve.md)), which this program already uses for collections
and for `owner pull`. This chapter adds the two commands built directly
on it, as opensheaf-py has them (its chapters
[20-resolution](https://opensheaf.org/opensheaf-py/20-resolution.html)
and [22-mirrors](https://opensheaf.org/opensheaf-py/22-mirrors.html)):

```
osheaf resolve URI [--at URL]... [--json]
osheaf mirror URI [--at URL]... [--label LABEL] [--licence-checked]
osheaf mirror --all [--licence-checked]
```

and what they need: copying an object of another archive into the
storage root, every file checked, and the open licences. The module is
`core/mirror.js`.

    // in core/mirror.js:
    import { Http, FetchError, sha512 } from './http.js';
    import { Resolver, Copy } from './resolve.js';
    import { parseSheaf, objectId, LABEL } from './names.js';
    import { sidecarDigest } from './owners.js';
    import { fileName, WITNESSES } from './signatures.js';
    import { joinPath, readJson, writeText, ORIGIN } from './storage.js';
    import { jsonText } from './write.js';
    import { hex } from './crypto.js';
    import { randomBytes } from './keys.js';
    import { writeDiscovery } from './discovery.js';
    import { exit, removeTree, CONFIG_NAME } from './folder.js';
    import { openResolver } from './collections.js';
    import { recordKeyLog, keyLogOf } from './owner.js';
    import { mayReturn } from './takedown.js';

    <<mirrors: the resolver of a command>>

    <<mirrors: the command resolve>>

    <<mirrors: copying an object from another archive>>

    <<mirrors: open licences>>

    <<mirrors: mirroring a line>>

The resolver of a command
-------------------------

In an archive, the resolver's home is the archive, read from its storage
(chapter [30](30-collections.md)), as opensheaf-py's resolver reads
"here"; outside one, `resolve` has no home and reads only the places it is
given. The home is read at an origin of its own, which the commands name
`here`, as opensheaf-py does, in what they print.

    // in mirrors: the resolver of a command:
    export async function commandResolver(f, env) {
      if (f) return openResolver(f);
      return new Resolver(new Http({ fetch: env.fetch, budget: null }), null, { local: true });
    }

    export function here(text) {
      return typeof text === 'string' ? text.split(ORIGIN).join('here') : text;
    }

The command resolve
-------------------

`osheaf resolve URI` prints what the resolver found: the line, the copies
seen (where, head, latest signed version, and the versions after it with
their status, section 7.4), the version the URI resolves to with its pin
and status, and the notes, among them the state of the owner (section
12.3). It exits with an error when nothing was resolved to. The output,
also as JSON with `--json`, is opensheaf-py's.

    // in mirrors: the command resolve:
    export async function resolveCommand(f, args, env) {
      const r = await commandResolver(f, env);
      let id, found;
      try {
        ({ id, found } = await r.resolve(args.uri, args.at || []));
      } catch (error) {
        if (error instanceof FetchError) throw error;
        exit(error.message);
      }
      const owner = id ? id.split(':')[2] : null;
      const out = {
        uri: args.uri, line: id, status: found.status, version: found.version, inventorySha512: found.digest,
        foundAt: found.copy ? here(found.copy.where) : null,
        copies: found.copies.map((c) => {
          const after = [];
          for (let n = c.latestSigned + 1; n <= c.head; n++) after.push({ version: `v${n}`, status: c.status(n) });
          return { at: here(c.where), head: `v${c.head}`, latestSigned: c.latestSigned ? `v${c.latestSigned}` : null, after };
        }),
        notes: [...r.notes.map((n) => here(`${n.level}: ${n.message}`)), ...(owner ? r.ownerNotes(owner) : [])],
      };
      if (found.ok && found.copy) {
        const dv = found.copy.obj(Number(found.version.slice(1)))?.documentVersion;
        if (dv !== undefined && dv !== null) out.pin = `sheaf:${id.split(':')[1]}:${owner}/v${dv}?sha512=${found.digest}`;
      }
      if (args.json) {
        env.out(JSON.stringify(out, null, 2));
      } else {
        env.out(`${out.uri}\n  line ${out.line ?? 'None'}`);
        for (const c of out.copies) {
          const after = c.after.map((a) => `${a.version} ${a.status}`).join(', ');
          env.out(`  copy at ${c.at}: head ${c.head}, latest signed ${c.latestSigned ?? 'None'}` +
                  (after ? `; after it: ${after} (section 7.4)` : ''));
        }
        env.out(`  ${found.status}` + (found.version ? `: ${found.version} sha512=${found.digest}` : '') +
                (out.foundAt ? ` at ${out.foundAt}` : ''));
        if (out.pin) env.out(`  pin ${out.pin}`);
        for (const n of out.notes) env.out(`  ${n}`);
      }
      return found.ok ? 0 : 1;
    }

Copying an object
-----------------

`fetchObject` copies an object of another archive, its versions up to
`upto` (by default its head), into the folder `dest` of the storage, as
opensheaf-py's `fetch_object` does:

1. the inventory of every version, from its version folder, with its
   checksum file, which must state its digest (section 4.1); every path of
   its manifest must be a content path of the object (`vK/content/...`,
   `K` not after the version);
2. every file the inventory of the last version copied records, each
   checked against its digest: a file that does not match makes the copy
   unavailable, never a copy with a wrong file;
3. the witness folder of each version: listed when the archive can be
   listed (an archive in a folder, the home), and otherwise the files
   whose names the reader can compute (section 14.1), given by
   `witnessNames`;
4. the inventory of the last version copied becomes the root inventory,
   so that a copy stopping before the head is a valid object of its own.

One copy brings `MAX_FETCH_FILES` files and `MAX_FETCH_BYTES` bytes at
most (section 15.2), and a file `MAX_BYTES`.

    // in mirrors: copying an object from another archive:
    export const MAX_BYTES = 2 ** 30, MAX_FETCH_BYTES = 4 * 2 ** 30, MAX_FETCH_FILES = 20000;

    export class Unavailable extends Error {}

    function contentPathOk(cp, inv, n) {
      const cd = typeof inv?.contentDirectory === 'string' ? inv.contentDirectory : 'content';
      const safe = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\\') &&
        p.split('/').every((x) => !['', '.', '..'].includes(x));
      if (!safe(cp) || !safe(cd) || cd.includes('/')) return false;
      const parts = cp.split('/');
      return parts.length >= 3 && /^v[1-9][0-9]*$/.test(parts[0]) && parts[1] === cd && Number(parts[0].slice(1)) <= n;
    }

    export async function fetchObject(storage, archive, id, dest, { upto = null, witnessNames = null, where = archive.base } = {}) {
      await archive.locate(id);
      const fetched = { files: 0, bytes: 0 };
      const get = async (url) => {
        let data;
        try {
          data = await archive.http.request(url, { limit: MAX_BYTES });
        } catch (error) {
          if (error.kind === 'not-found') return null;
          if (error.kind === 'aborted') throw error;
          throw new Unavailable(error.message);
        }
        fetched.files++;
        fetched.bytes += data.length;
        if (fetched.files > MAX_FETCH_FILES || fetched.bytes > MAX_FETCH_BYTES) {
          throw new Unavailable(`${where}: ${id} has more than ${MAX_FETCH_FILES} files or ${MAX_FETCH_BYTES} bytes: not ` +
                                'copied (section 15.2)');
        }
        return data;
      };
      const root = await get(archive.inventoryUrl(id, null));
      if (root === null) throw new Unavailable(`${where}: no object ${id}`);
      let head;
      try {
        head = Number(JSON.parse(new TextDecoder().decode(root)).head.slice(1));
        if (!Number.isInteger(head)) throw new Error();
      } catch {
        throw new Unavailable(`${where}: the inventory of ${id} cannot be read`);
      }
      upto = Math.min(upto || head, head);
      await writeText(storage, joinPath(dest, '0=ocfl_object_1.1'), 'ocfl_object_1.1\n');
      let last = null;
      for (let n = 1; n <= upto; n++) {
        const data = await get(archive.inventoryUrl(id, `v${n}`));
        const sc = await get(archive.versionUrl(id, `v${n}`, 'inventory.json.sha512'));
        if (data === null || sc === null || sidecarDigest(sc) !== await sha512(data)) {
          throw new Unavailable(`${where}: ${id} v${n} has no inventory with its checksum file (section 4.1)`);
        }
        let bad;
        try {
          const invN = JSON.parse(new TextDecoder().decode(data));
          bad = Object.values(invN.manifest).flat().filter((cp) => !contentPathOk(cp, invN, n));
        } catch {
          throw new Unavailable(`${where}: the inventory of ${id} v${n} cannot be read`);
        }
        if (bad.length) throw new Unavailable(`${where}: ${id} v${n}: a content path out of the object: '${bad[0]}'`);
        await storage.write(joinPath(dest, `v${n}`, 'inventory.json'), data);
        await storage.write(joinPath(dest, `v${n}`, 'inventory.json.sha512'), sc);
        last = [data, sc];
      }
      const inv = JSON.parse(new TextDecoder().decode(last[0]));
      if (inv.id !== id || inv.head !== `v${upto}`) throw new Unavailable(`${where}: the inventory of ${id} v${upto} is not one of that version`);
      for (const [d, paths] of Object.entries(inv.manifest || {})) {
        for (const cp of paths) {
          if (!contentPathOk(cp, inv, upto)) throw new Unavailable(`${where}: ${id}: a content path out of the object: '${cp}'`);
          const data = await get(archive.contentUrl(id, inv, cp));
          if (data === null || await sha512(data) !== d) throw new Unavailable(`${where}: ${id}: ${cp} is missing, or does not have its digest`);
          await storage.write(joinPath(dest, cp), data);
        }
      }
      await storage.write(joinPath(dest, 'inventory.json'), last[0]);
      await storage.write(joinPath(dest, 'inventory.json.sha512'), last[1]);
      for (let n = 1; n <= upto; n++) {
        let found = await archive.listWitnesses(id, `v${n}`);
        if (found === null) found = witnessNames ? await witnessNames(n) : [];
        for (const name of found) {
          if (!name || name.includes('/') || name === '.' || name === '..' || name.includes('\\')) continue;
          const data = await get(archive.witnessUrl(id, `v${n}`, name));
          if (data !== null) await storage.write(joinPath(dest, WITNESSES, `v${n}`, name), data);
        }
      }
      return upto;
    }

The witness names a reader over HTTP can compute for a line: a version of
a line is signed by current keys of some version of its owner's key log,
so every key that any version lists, on either side of a fork, may have
signed it; the first 16 characters of a key's digest name its signature
file (section 7.2).

    // in mirrors: copying an object from another archive:
    export function lineWitnessNames(log) {
      let names = null;
      return async () => {
        if (names === null) {
          const dids = new Set();
          for (const v of log?.versions || []) {
            for (const did of v.keys?.keys || []) dids.add(did);
            for (const c of (v.forkRecord ? v.carried : null) || []) for (const did of c.keys?.keys || []) dids.add(did);
          }
          names = (await Promise.all([...dids].filter((d) => typeof d === 'string').map(fileName))).sort();
        }
        return names;
      };
    }

Open licences
-------------

Copying is redistribution, which the licence of every version copied must
allow (section 11.2). A licence is recognised as open by its SPDX
identifier, in lower case, or by its URL, by stem, the NonCommercial and
NoDerivatives variants excluded; one open entry suffices. The list is
opensheaf-py's, short on purpose; a curator who knows that redistribution
is allowed otherwise says so with `--licence-checked`.

    // in mirrors: open licences:
    export const OPEN = ['cc-by-4.0', 'cc-by-sa-4.0', 'cc0-1.0', 'gpl-3.0-only', 'gpl-3.0-or-later', 'cc-by-3.0'];
    export const OPEN_URIS = ['creativecommons.org/licenses/by/', 'creativecommons.org/licenses/by-sa/',
                              'creativecommons.org/publicdomain/zero/', 'gnu.org/licenses/gpl'];

    export function isOpen(rights) {
      for (const r of Array.isArray(rights) ? rights : []) {
        if (OPEN.includes(String(r?.rightsIdentifier || '').toLowerCase())) return true;
        const uri = String(r?.rightsUri || '').toLowerCase();
        if (OPEN_URIS.some((u) => uri.includes(u)) && !uri.includes('-nc') && !uri.includes('-nd')) return true;
      }
      return false;
    }

Mirroring a line
----------------

A mirror holds the object's versions up to the latest signed version of
the copy it copies, byte for byte, with the witnesses it can find, at the
path its layout gives, and beside it the key log of the line's owner
(section 11.1). `mirrorLine` both makes a mirror and brings it up to
date, as opensheaf-py's `mirror_line` does:

1. the key log of the owner is recorded first, met with every copy found
   (`recordKeyLog`, chapter [37](37-owner-commands.md)), so that the
   versions are judged against the key log the archive will hold
   (section 7.5);
2. a fork of the key log freezes the owner: no version of its lines is
   added (these tools trust no timestamps yet, which section 7.5 would
   admit as evidence);
3. the copy with the latest signed version is taken, and every other must
   agree with it, or the fork of the line is reported and nothing copied
   (section 7.4); the versions copied stop at its latest signed version,
   never contested, and those after it are reported;
4. a mirror held must agree with the copy; every new version must be
   openly licensed, or the curator must have said so; a line taken down
   here returns only from a copy holding the version its tombstone pins
   (section 13.2, chapter [42](42-takedown.md));
5. the object is copied into a staging folder and moved into place: a new
   mirror whole, an existing one by its new version folders, its new
   witness files and its root inventory. A witness file of the same name
   with other bytes is reported, and the mirror keeps its own.

A line of an owner the archive hosts is never mirrored: it is written
here.

    // in mirrors: mirroring a line:
    export async function mirrorLine(f, name, owner, where, { licenceChecked = false, label = null } = {}) {
      const env = f.env;
      const id = objectId(name, owner);
      if (f.archiveOwners().includes(owner)) {
        exit(`${id} is a line of an owner this archive hosts: its owner writes it here, and it is not mirrored (section 11)`);
      }
      const r = await openResolver(f);
      let copies = (await r.copies(name, owner, where)).filter((c) => c.archive !== r.home);
      if (!copies.length) exit(`no copy of ${id} found at ${where.join(', ') || 'the places given'}`);
      const others = (r.logs.get(owner)?.found || []).filter((x) => x.where !== r.home.base).map((x) => [x.where, x.log]);
      const log = await recordKeyLog(f, owner, others);
      if (!log) {
        exit(`no copy of the key log of ${owner} found beside the line: a copy holds it beside every line (section 6.5)`);
      }
      if (log.forkPoint) {
        exit(`the key log of ${owner} forks at v${log.forkPoint}: the owner is frozen, and no version of its lines is added ` +
             'here (section 7.5)');
      }
      copies = await Promise.all(copies.map(async (c) => new Copy(c.where, c.archive, await c.archive.line(id, { log }))));
      copies.sort((a, b) => b.latestSigned - a.latestSigned);
      const source = copies[0];
      if (!source.latestSigned) exit(`${id}: no copy found has a signed version that is not contested (section 7.5)`);
      for (const c of copies.slice(1)) {
        if (!source.agrees(c)) {
          exit(`${id}: the copies at ${source.where} and ${c.where} do not agree: a fork of the line (section 7.4), not copied`);
        }
      }
      const target = source.latestSigned;
      for (let n = target + 1; n <= source.statuses.length; n++) {
        env.out(`${id} v${n}: ${source.status(n)} at ${source.where}: not added (section 7.5)`);
      }
      <<mirrors: check the mirror held, the licences and the tombstone>>
      <<mirrors: copy the versions into the storage root>>
      if (label) f.labels.set(label, id);
      await remember(f, id, where);
      await writeDiscovery(f);
    }

The checks before copying.

    // in mirrors: check the mirror held, the licences and the tombstone:
    const dir = await f.dirOf(id);
    const inv = await f.inventory(dir);
    const held = inv ? Number(inv.head.slice(1)) : 0;
    if (held) {
      const k = Math.min(held, target);
      if (source.digest(k) !== await sha512(await f.storage.read(joinPath(dir, `v${k}`, 'inventory.json')))) {
        exit(`${id}: the copy at ${source.where} does not agree with the mirror held here: a fork of the line ` +
             '(section 7.4); the mirror keeps its own side');
      }
    }
    for (let n = held + 1; n <= target; n++) {
      let dc = null;
      try {
        dc = await source.archive.json(id, source.line.inv, `v${n}`, 'datacite.json');
      } catch {
        dc = null;
      }
      if (!licenceChecked && !isOpen(dc?.rightsList)) {
        exit(`${id} v${n}: its licence does not clearly allow redistribution (section 11.2); give --licence-checked if ` +
             'it is allowed otherwise');
      }
    }
    if (!held && !(await mayReturn(f, id, async (n, d) => source.digest(n) === d))) {
      exit(`${id} was taken down here: it returns only from a copy holding the version its tombstone pins (section 13.2)`);
    }

The copy, through a staging folder of the archive.

    // in mirrors: copy the versions into the storage root:
    const stage = `.staging-${hex(randomBytes(6))}`;
    const s = f.storage;
    try {
      const fresh = joinPath(stage, 'object');
      try {
        await fetchObject(s, source.archive, id, fresh, { upto: target, witnessNames: lineWitnessNames(log), where: source.where });
      } catch (error) {
        if (error instanceof Unavailable) exit(error.message);
        throw error;
      }
      if (!held) {
        await s.rename(fresh, dir);
        env.out(`${id}: mirrored, v1 to v${target}, from ${source.where}`);
      } else {
        for (let n = held + 1; n <= target; n++) await s.rename(joinPath(fresh, `v${n}`), joinPath(dir, `v${n}`));
        let added = 0;
        for (let n = 1; n <= target; n++) {
          const wNew = joinPath(fresh, WITNESSES, `v${n}`), wOld = joinPath(dir, WITNESSES, `v${n}`);
          for (const e of (await s.list(wNew)) || []) {
            if (e.kind !== 'file') continue;
            const bytes = await s.read(joinPath(wNew, e.name));
            const mine = await s.read(joinPath(wOld, e.name));
            if (mine === null && !(await s.kind(joinPath(wOld, e.name)))) {
              await s.write(joinPath(wOld, e.name), bytes);
              added++;
            } else if (mine === null || mine.length !== bytes.length || mine.some((b, k) => b !== bytes[k])) {
              env.err(`warning: ${id} v${n}: ${e.name} at ${source.where} differs from the one held here, which is kept ` +
                      '(section 11.1)');
            }
          }
        }
        if (target > held) {
          for (const name of ['inventory.json', 'inventory.json.sha512']) await s.rename(joinPath(fresh, name), joinPath(dir, name));
        }
        env.out(target > held ? `${id}: v${held + 1} to v${target} added from ${source.where}`
          : `${id}: up to date (v${held})` + (added ? `, ${added} witness file(s) added` : ''));
      }
    } finally {
      await removeTree(s, stage);
      f.changed();
    }

The places a mirror was made from are remembered in the configuration,
under `mirrors`, so that `osheaf mirror --all` can bring every mirror up
to date; they are hints like any location, which the discovery document
does not show.

    // in mirrors: mirroring a line:
    async function remember(f, id, where) {
      const cfg = await readJson(f.storage, CONFIG_NAME);
      if (!cfg || !where.length) return;
      cfg.mirrors ??= {};
      const known = (cfg.mirrors[id] ??= []);
      if (where.every((w) => known.includes(w))) return;
      for (const w of where) if (!known.includes(w)) known.push(w);
      await writeText(f.storage, CONFIG_NAME, jsonText(cfg));
      f.archive.mirrors = cfg.mirrors;
    }

The command. `osheaf mirror URI` mirrors the line a `sheaf:` URI names, at
the URI's `at` and the places given with `--at`; a label gives it a
readable name here. Without an owner part, the URI names the originator's
line, which the resolver finds. `osheaf mirror --all` brings every mirror
up to date from the places remembered.

    // in mirrors: mirroring a line:
    export async function mirror(f, args) {
      if (args.all) {
        const known = f.archive.mirrors || {};
        for (const id of Object.keys(known).sort()) {
          const [, name, owner] = id.split(':');
          if ((await f.storage.kind(joinPath(await f.dirOf(id), 'inventory.json'))) === 'file') {
            await mirrorLine(f, name, owner, known[id], { licenceChecked: Boolean(args.licenceChecked) });
          }
        }
        return;
      }
      if (!args.uri) exit('osheaf mirror URI, or --all');
      if (args.label && (!LABEL.test(args.label) || f.labels.has(args.label))) {
        exit(`${args.label}: a label of the form of section 3.1, not given to another line`);
      }
      const at = [...(args.at || [])];
      const r = await openResolver(f);
      let u, name, owner;
      try {
        u = parseSheaf(args.uri, { short: true, fold: true });
        [name, owner] = await r.expand(u, [...(u.at ? [u.at] : []), ...at]);
      } catch (error) {
        if (error instanceof FetchError) throw error;
        exit(error.message);
      }
      await mirrorLine(f, name, owner, [...(u.at ? [u.at] : []), ...at],
                       { licenceChecked: Boolean(args.licenceChecked), label: args.label || null });
    }
