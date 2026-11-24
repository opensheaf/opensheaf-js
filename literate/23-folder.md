The archive kept: configuration, objects, signed versions
=========================================================

The command line keeps one archive at a time: the folder of its
configuration `osheaf.json`, next to its storage root `ocfl/` and its
discovery document `opensheaf.json` (opensheaf-py's chapter
[10-archive](https://opensheaf.org/opensheaf-py/10-archive.html), whose
configuration this program reads and writes unchanged, so that either
implementation keeps an archive the other made). This chapter opens such
an archive in a storage (chapter [20](20-storage.md)) and gives what
every command that changes it needs: the folders of objects, their
inventories and files, the walk of the storage root, the key logs of
owners and the statuses of versions, the keys that sign, and the one way
a version is added to a line, signed.

Where opensheaf-py keeps the archive in module globals (`ROOT`, `ARCHIVE`,
`LABELS`), this program keeps it in an object, `ArchiveFolder`; the
commands of the next chapters are its methods. The module is
`core/folder.js`.

    // in core/folder.js:
    import { OWNER_NAME_LAYOUT, HASHED_LAYOUT, LAYOUT_FILE, pathOf } from './paths.js';
    import { objectId, nameOf, LABEL } from './names.js';
    import { sidecarDigest } from './owners.js';
    import { Http } from './http.js';
    import { Archive } from './archive.js';
    import { SIGNED, VOUCHED } from './signatures.js';
    import { hex } from './crypto.js';
    import { readJson, writeText, replaceFile, storageFetch, storageLister, compareText, joinPath, ORIGIN } from './storage.js';
    import { jsonBytes, utcNow, today, genesisRecord, orderedInventory, inventoryFile, sidecar, sha512hex,
             sha256hex, md5hex, signatureFile, signatureFileName, WITNESSES, INVENTORY_TYPE } from './write.js';
    import { newKey, randomBytes } from './keys.js';

    <<how the commands speak>>

    <<the configuration of an archive>>

    <<the archive folder>>

How the commands speak
----------------------

The commands speak as opensheaf-py's do (its chapter
[19-owner-commands](https://opensheaf.org/opensheaf-py/19-owner-commands.html),
"How the commands speak"): a command that cannot go on stops with one
sentence saying why and what to do, its first word capitalized unless it
is a name, and a final period; a warning is a sentence after `Warning:`,
on the standard error; owner names and keys are shortened for a person to
their first 8 and last 4 characters. A few messages of opensheaf-py are
printed as they are, without the capital; this program keeps them so, so
that the two say the same.

A command that stops throws `Stop`; the command line prints its message
on the standard error and exits with the status 1, as Python's
`sys.exit(message)` does.

    // in how the commands speak:
    export class Stop extends Error {}

    const LOWER_NAMES = ['gh', 'osheaf', 'command'];

    export function sentence(text) {
      const m = /^([a-z][a-z']{0,14})(?=[ ,;])/.exec(text);
      if (m && !LOWER_NAMES.includes(m[1])) text = text[0].toUpperCase() + text.slice(1);
      return /[.?!:…]$/.test(text) ? text : text + '.';
    }

    export function stop(text) {
      throw new Stop(sentence(text));
    }

    export function exit(text) {
      throw new Stop(text);
    }

    export function short(name) {
      if (name.startsWith('did:key:')) name = name.slice('did:key:'.length);
      return [...name].length <= 14 ? name : `${name.slice(0, 8)}…${name.slice(-4)}`;
    }

    export function plural(n, noun) {
      return n === 1 ? `${n} ${noun}` : `${n} ${noun}s`;
    }

The environment
---------------

What a command needs from outside the archive comes in an
**environment**, so that `core/` stays free of disks, terminals and
credential stores:

- `out(line)` and `err(line)`: the standard output and error;
- `keyStore`: the current keys of this device (chapter
  [40](40-cli.md)): `current(owner, dids)` gives the keys held among the
  did:keys listed, `keep(owner, key)` keeps one and gives the name of the
  store, `storeName(store)` says it for a person;
- `exportFolder`: the folder outside the archive where rotation keys are
  exported: `inside(folder)` names the archive that holds `folder`, if
  any, `write(folder, name, text)` writes a file of its own (never
  replacing one) and gives its path, `read(path)` reads it back;
- `passphrase({ confirm, where })` and `input(prompt)`: what the person
  types;
- `newKey()`: a new key (the tests give predictable ones);
- `fetch(url, init)`: how other archives are read (collections, the
  entries of members held elsewhere), and `fetchJson(url)`, how the places
  of keepers are read (chapter [32](32-keepers.md)); the command line
  points them at the locations configured;
- `template(name)`: the bytes of a default template of the website
  (chapter [31](31-website.md)), which the command line reads from
  `templates/` next to the program.

    // in the configuration of an archive:
    export function environment(given = {}) {
      return {
        out: (line) => console.log(line),
        err: (line) => console.error(line),
        warn(text) {
          this.err('Warning: ' + sentence(text));
        },
        newKey,
        now: utcNow,
        today,
        fetch: globalThis.fetch?.bind(globalThis),
        fetchJson: null,
        template: null,
        ...given,
      };
    }

The configuration
-----------------

`osheaf.json` (opensheaf-py's `help-config` describes it): the owner of
the archive and the other owners it hosts, its name, contact and base
URL, its profiles and storage layout, its curator and depositor, and the
configuration of its index. Five of them are required; the label of the
owner catalogue of the archive's first owner is fixed, `main`.
An archive of specification 0.1 is recognised (an `archiveId` in its
configuration, or `specification` 0.1 in its discovery document) and
told to be rebuilt. opensheaf-py also reads `osheaf.yaml`; this program
reads JSON only, and says so.

    // in the configuration of an archive:
    export const CONFIG_NAME = 'osheaf.json';
    export const CONFIG_NAMES = ['osheaf.json', 'osheaf.yaml', 'osheaf.yml'];
    export const SPEC = '0.2';
    export const OBJ = 'object.json', OBJ_FORMAT = 'opensheaf-object/0.2', GENESIS = 'genesis.json';
    export const LAYOUTS = { 'owner-name': OWNER_NAME_LAYOUT, hashed: HASHED_LAYOUT };
    export const LAYOUT_TEXT = 'Lines at <owner>/<name>/, drafts at draft/<id>/: the owner-name layout of the ' +
      'OpenSheaf specification 0.2, section 3.2\n';
    export const REQUIRED = ['owner', 'name', 'baseUrl', 'curator', 'depositor'];
    export const CATALOGUE_LABEL = 'main';
    export const REBUILD = 'this archive is of specification 0.1, which these tools no longer read: rebuild it under ' +
      'specification 0.2 (section 16.1)';

    export async function readConfig(storage) {
      const cfg = await readJson(storage, CONFIG_NAME);
      if (cfg !== null) return cfg;
      for (const n of CONFIG_NAMES.slice(1)) {
        if (await storage.kind(n)) exit(`${n}: opensheaf-js reads osheaf.json only (opensheaf-py also reads YAML)`);
      }
      exit(`no ${CONFIG_NAME} or osheaf.yaml in the archive folder`);
    }

The archive folder
------------------

An archive is opened from its storage: the configuration and the
discovery document, from which the labels of lines, the owner catalogues
(`catalogues`, each owner hosted to its catalogue, section 8.1) and the
tombstones are read, as opensheaf-py's `configure` reads them; the labels
come from the pages of objects of a discovery document that pages them
(section 3.1), and a page missing gives none. Only the
forms of the current draft are read, in the discovery document as in the
configuration: `mainCollection`, and owners given as bare names, of
earlier drafts of 0.2, are not. `writeConfig` writes
`osheaf.json` back, as Python's `json.dumps(..., indent=2)` writes it, and
the settings of this run with it (opensheaf-py's `write_config`).

    // in the archive folder:
    function settingsOf(cfg) {
      return Object.fromEntries(Object.entries(cfg).filter(([k]) => !['texmacs', 'index'].includes(k)));
    }

    export class ArchiveFolder {
      static async open(storage, env = environment()) {
        const folder = new ArchiveFolder(storage, env);
        await folder.configure();
        return folder;
      }

      constructor(storage, env = environment()) {
        this.storage = storage;
        this.env = env;
        this.archive = {};
        this.index = {};
        this.labels = new Map();
        this.catalogues = new Map();
        this.tombstones = [];
        this.layout = OWNER_NAME_LAYOUT;
        this.old = false;
        this.cached = null;
      }

      async configure() {
        const cfg = await readConfig(this.storage);
        const disc = (await readJson(this.storage, 'opensheaf.json')) || {};
        this.old = 'archiveId' in cfg || disc.specification === '0.1';
        this.layout = cfg.storageLayout || OWNER_NAME_LAYOUT;
        this.archive = settingsOf(cfg);
        if (this.old) return this;
        const missing = REQUIRED.filter((k) => !(k in cfg));
        if (missing.length) exit(`${CONFIG_NAME} lacks ${missing.join(', ')}`);
        if (!Object.values(LAYOUTS).includes(this.layout)) {
          exit(`${CONFIG_NAME}: storageLayout is one of ${Object.values(LAYOUTS).join(', ')}`);
        }
        this.archive.profiles ??= [];
        this.archive.contact ??= this.archive.baseUrl;
        this.index = cfg.index || {};
        let listed = Array.isArray(disc.objects) ? disc.objects : [];
        if (Object.hasOwn(disc, 'objectPages')) {
          const paged = new Archive(new Http({ fetch: storageFetch(this.storage, ORIGIN), budget: null }), ORIGIN, disc);
          await paged.loadPages();
          listed = paged.pageProblems.length ? [] : paged.listed();
          this.unreadPages = paged.pageProblems[0] ?? null;
        } else {
          this.unreadPages = null;
        }
        this.labels = new Map(listed.filter((o) => o && typeof o === 'object' && o.label).map((o) => [o.label, o.id]));
        this.catalogues = new Map((disc.owners || []).filter((e) => e && typeof e === 'object' && e.owner && e.catalogue)
          .map((e) => [e.owner, e.catalogue]));
        this.tombstones = [...(disc.tombstones || [])];
        return this;
      }

      archiveOwners() {
        const out = [this.archive.owner];
        return out.concat((this.archive.owners || []).filter((o) => !out.includes(o)));
      }

A page of objects that cannot be read (missing, not JSON, not a page, or
out of the archive) leaves the labels unknown (`unreadPages` says why);
writing the discovery document or the website then would lose them, and
`refuseUnreadPages` stops whatever would, as opensheaf-py's
`refuse_unread_pages` (#19). The verification still runs, and reports the
page.

    // in the archive folder:
      refuseUnreadPages() {
        if (this.unreadPages) {
          exit(`opensheaf.json: ${this.unreadPages}: the labels of the lines are not known, and writing ` +
               'the discovery document or the website now would lose them; nothing is written ' +
               '(restore the pages of objects, from git for instance, and run the command again)');
        }
      }

      labelOf(id) {
        for (const [label, i] of this.labels) if (i === id) return label;
        return null;
      }

      depositor() {
        return { name: this.archive.depositor.name, address: this.archive.depositor.address };
      }

      async writeConfig(cfg) {
        await replaceFile(this.storage, CONFIG_NAME, jsonBytes(cfg));
        this.archive = settingsOf(cfg);
        this.archive.profiles ??= [];
        this.archive.contact ??= this.archive.baseUrl;
        this.index = cfg.index || {};
      }

      async dirOf(id) {
        return joinPath('ocfl', ...(await pathOf(id, this.layout)));
      }

The storage root is declared by its NAMASTE file and, in the owner-name
layout, by the text file that describes the layout (section 3.2); the
hashed layout of OCFL's extension 0003 is declared in `ocfl_layout.json`.

    // in the archive folder:
      async initStorageRoot() {
        const s = this.storage;
        await writeText(s, 'ocfl/0=ocfl_1.1', 'ocfl_1.1\n');
        if (this.layout === HASHED_LAYOUT) {
          await s.write('ocfl/ocfl_layout.json', jsonBytes({
            extension: HASHED_LAYOUT,
            description: 'Hashed n-tuple storage layout with its default parameters (OpenSheaf 0.2, section 3.2)' }));
        } else if (!(await s.kind(`ocfl/${LAYOUT_FILE}`))) {
          await writeText(s, `ocfl/${LAYOUT_FILE}`, LAYOUT_TEXT);
        }
      }

### Objects and their files

An inventory that cannot be read counts as none. The folder of an
object that is a symbolic link (or lies under one) stops the command, as
opensheaf-py's `unlinked` stops it: it is not read as missing, which
would let a command go on as for a new object, and nothing is written
through it. A logical path of a version is found through the state of
the version and the manifest (chapter [13](13-versions.md)).

    // in the archive folder:
      async inventory(dir) {
        if (await this.storage.linked?.(dir)) exit(`${dir} passes through a symbolic link`);
        try {
          return await readJson(this.storage, joinPath(dir, 'inventory.json'));
        } catch {
          return null;
        }
      }

      contentPath(inv, version, logical) {
        for (const [d, paths] of Object.entries(inv.versions[version].state)) {
          if (paths.includes(logical)) return inv.manifest[d][0];
        }
        return null;
      }

      async readLogical(dir, inv, logical, version = null) {
        const cp = this.contentPath(inv, version || inv.head, logical);
        return cp ? this.storage.read(joinPath(dir, cp)) : null;
      }

      async readObjectJson(dir, inv, logical, version = null) {
        const bytes = await this.readLogical(dir, inv, logical, version);
        return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
      }

The objects of the storage root are found by walking it, as
opensheaf-py's `objects` does: every folder that holds the declaration
`0=ocfl_object_1.1` is an object, and is not entered; the folder
`extensions` of the storage root is not an object's; symbolic links are
left alone. The objects come in the order of their identifiers, then of
their folders.

    // in the archive folder:
      async objects() {
        const out = [];
        const walk = async (dir) => {
          for (const entry of (await this.storage.list(dir)) || []) {
            if (entry.kind !== 'dir') continue;
            const child = joinPath(dir, entry.name);
            if ((await this.storage.kind(joinPath(child, '0=ocfl_object_1.1'))) === 'file') {
              const inv = await this.inventory(child);
              out.push({ id: inv?.id ?? null, dir: child, inv });
            } else if (!(dir === 'ocfl' && entry.name === 'extensions')) {
              await walk(child);
            }
          }
        };
        if ((await this.storage.kind('ocfl')) === 'dir') await walk('ocfl');
        const idOf = (o) => (typeof o.id === 'string' ? o.id : 'None');
        return out.sort((a, b) => compareText(idOf(a), idOf(b)) || compareText(a.dir, b.dir));
      }

### Key logs and statuses

Key logs and the statuses of versions are read as a verifier reads them:
by the reading of archives of chapter [14](14-archive.md), over the
storage's own `fetch` (chapter [20](20-storage.md)). So a command judges a
signature exactly as `osheaf verify` and this program's verification do,
with the same code. The reader caches what it reads; since commands
change the archive, a reader is made afresh after every change.

    // in the archive folder:
      reader() {
        if (!this.cached) {
          const base = /^https?:\/\/[^/]+\/(.*\/)?$/.test(this.archive.baseUrl || '') ? this.archive.baseUrl : ORIGIN;
          const http = new Http({ fetch: storageFetch(this.storage, base), budget: null });
          this.cached = new Archive(http, base, { specification: SPEC, storageRoot: 'ocfl/', storageLayout: this.layout });
          this.cached.lister = storageLister(this.storage, base);
        }
        return this.cached;
      }

      changed() {
        this.cached = null;
      }

      async keyLog(owner) {
        return this.reader().keyLog(owner);
      }

      async line(id) {
        await this.reader().locate(id);
        return this.reader().line(id);
      }

      async latestSigned(id) {
        return (await this.line(id)).latest;
      }

The keys that sign for an owner (opensheaf-py's `signing_keys`): its key
log must be in the storage root, without errors, and not ended; the
current keys of its latest version that this device holds must reach
its threshold; if they do not, those it lacks are pulled from the wallet
configured (`env.pullFromWallet`, chapter
[37](37-owner-commands.md)), unless `OPENSHEAF_SIGNING_KEY` gives the key
(`env.signingKeyGiven`).

    // in the archive folder:
      async signingKeys(owner) {
        const who = short(owner);
        const log = await this.keyLog(owner);
        if (!log) stop(`the key log of ${who} is not in the storage root (section 6.5)`);
        const { errors } = await log.check();
        if (errors.length) stop(`the key log of ${who} has errors: ` + errors.join('; '));
        const latest = log.latest();
        if (!latest) stop(`the owner ${who} has ended (section 6.3): nothing is signed for it`);
        let found = await this.env.keyStore.current(owner, latest.keys.keys);
        const need = latest.keys.threshold;
        if (found.length < need && !this.env.signingKeyGiven && this.env.pullFromWallet) {
          found = await this.env.pullFromWallet(this, owner, latest, found);
        }
        if (found.length < need) {
          const hint = this.env.keyStore.keptOnDevice() ? 'osheaf key new makes one for this computer'
            : 'configure a key wallet, from which each command opens them';
          stop(`this computer holds ${found.length} of the current keys of ${who}, and v${latest.number} ` +
               `of its key log needs ${need} to sign (${hint})`);
        }
        return { log, latest, signers: found };
      }

A new version extends the versions before it; if some of them are not
signed, or are contested, the person looks at them first (section 7.3),
and says so with `--i-know`.

    // in the archive folder:
      async checkBeforeExtending(id, acknowledged = false) {
        const { statuses } = await this.line(id);
        const doubtful = statuses.map((s, k) => [`v${k + 1}`, s]).filter(([, s]) => s !== SIGNED && s !== VOUCHED);
        if (!doubtful.length) return;
        const lines = doubtful.map(([v, s]) => `  ${v}: ${s}`).join('\n');
        if (!acknowledged) {
          exit(`${id}: the new version would extend versions that are not signed, or are contested (section 7.3):\n` +
               `${lines}\nlook at them; give --i-know to extend them anyway`);
        }
        this.env.err(`warning: ${id}: extending versions that are not signed, or are contested:\n${lines}`);
      }

### Adding a version

Every version of a line is added here (opensheaf-py's `add_version`):
its state is the files given (logical paths to bytes) and its
`object.json`, which gets `previous`, the digest of the inventory of the
version before (section 4.3); a content file already in the manifest is
not stored again; the inventory records MD5 and SHA-256 fixity, as
opensheaf-py's does; and the version is signed by the current keys of
the owner that this device holds, against the latest version of its key
log.

A draft (section 10.1, chapter [41](41-drafts.md)) goes through the
same function, with three differences, as in opensheaf-py: it is never
signed, so no key is needed and no witness folder is written; it has no
`previous`, since its versions may be rewritten; and nothing is checked
before extending it, since nothing relies on it. Its identifier,
`sheaf:draft:<id>`, tells it apart.

The version is built in a staging folder `.staging-<random>` of the
archive, then moved into place: a new object as a whole, a new version
by its folder, its witness folder, and last the root inventory, replaced,
so that an object never names a version it does not hold.

A deposit with Zenodo (appendix A.1, chapter [46](46-zenodo.md)) needs
the version built and signed before it is added: its files are uploaded,
and only once Zenodo has published them is the version added to the
storage root. With `stageIn`, a folder of the storage that does not exist
yet, the function builds and signs the version there, and stops before
the moves; `installVersion` makes them later, as opensheaf-py's
`add_version(..., stage_in=...)` and `install_version` do. Meanwhile the
line is locked: a Zenodo deposit that was published but not yet added
leaves its state in `zenodo-staging/<path of the line>/state.json`, with
the phase `published`, and no other version of the line is added until
`osheaf zenodo` completes it, as appendix A.1 requires.

The next version records as `previous` the digest of the head's inventory
that its checksum file states, which must be the SHA-512 of the
inventory's bytes, as opensheaf-py's `previous_digest` requires: a
checksum file missing, malformed or stale stops the command, and no
version is added until it is repaired.

    // in the archive folder:
      async previousDigest(id, dir, head) {
        const inv = await this.storage.read(joinPath(dir, head, 'inventory.json'));
        const sc = await this.storage.read(joinPath(dir, head, 'inventory.json.sha512'));
        const stated = sc ? sidecarDigest(sc) : null;
        if (!inv || !stated || stated !== await sha512hex(inv)) {
          exit(`${this.labelOf(id) || id} ${head}: the checksum file of its inventory is missing, or does not state ` +
               'the digest of the inventory (section 4.1): no version is added until it is repaired');
        }
        return stated;
      }

      async zenodoPending(id) {
        try {
          const state = await readJson(this.storage, joinPath('zenodo-staging', ...(await pathOf(id, this.layout)), 'state.json'));
          return state?.phase === 'published';
        } catch {
          return false;
        }
      }

      async addVersion(id, files, obj, message, { acknowledged = false, stageIn = null } = {}) {
        const s = this.storage;
        const dir = await this.dirOf(id);
        let inv = await this.inventory(dir);
        if (stageIn === null && await this.zenodoPending(id)) {
          const name = this.labelOf(id) || id;
          exit(`${name}: a Zenodo deposit was published and its version is not added yet: osheaf zenodo ${name} ` +
               'completes it first (appendix A.1)');
        }
        const draft = id.startsWith('sheaf:draft:');
        const { log, latest, signers } = draft ? { log: null, latest: null, signers: [] } : await this.signingKeys(obj.owner);
        obj = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'previous'));
        if (inv === null) {
          if (await s.kind(dir)) exit(`${dir} exists, and is not an object`);
          inv = { id, type: INVENTORY_TYPE, digestAlgorithm: 'sha512', head: 'v0', manifest: {}, versions: {},
                  fixity: { md5: {}, sha256: {} } };
        } else if (!draft) {
          await this.checkBeforeExtending(id, acknowledged);
          obj.previous = await this.previousDigest(id, dir, inv.head);
        }
        const ver = `v${Number(inv.head.slice(1)) + 1}`;
        if (stageIn !== null && await s.kind(stageIn)) exit(`${stageIn} exists`);
        const stage = stageIn ?? `.staging-${hex(randomBytes(6))}`;
        try {
          const content = new Map(files);
          content.set(OBJ, jsonBytes(obj));
          const state = {};
          for (const logical of [...content.keys()].sort(compareText)) {
            const data = content.get(logical);
            const d = await sha512hex(data);
            (state[d] ||= []).push(logical);
            if (!Object.hasOwn(inv.manifest, d)) {
              const cp = `${ver}/content/${logical}`;
              await s.write(joinPath(stage, cp), data);
              inv.manifest[d] = [cp];
              inv.fixity ??= {};
              inv.fixity.md5 ??= {};
              (inv.fixity.md5[await md5hex(data)] ||= []).push(cp);
              inv.fixity.sha256 ??= {};
              (inv.fixity.sha256[await sha256hex(data)] ||= []).push(cp);
            }
          }
          inv.head = ver;
          inv.versions[ver] = { created: this.env.now(), message, user: this.depositor(), state };
          inv = orderedInventory(inv);
          const data = inventoryFile(inv);
          await s.write(joinPath(stage, ver, 'inventory.json'), data);
          await s.write(joinPath(stage, ver, 'inventory.json.sha512'), await sidecar(data));
          const pin = log ? log.pin(latest.number) : null, digest = await sha512hex(data);
          for (const key of signers) {
            await s.write(joinPath(stage, 'witnesses', await signatureFileName(key.did)),
                          await signatureFile(key, id, ver, digest, obj.owner, pin));
          }
          if (stageIn === null) await this.moveStaged(dir, stage, ver, draft);
        } finally {
          if (stageIn === null) await removeTree(s, stage);
          this.changed();
        }
        return inv;
      }

      async moveStaged(dir, stage, ver, draft = false) {
        const s = this.storage;
        const data = await s.read(joinPath(stage, ver, 'inventory.json'));
        const sc = await s.read(joinPath(stage, ver, 'inventory.json.sha512'));
        if (ver === 'v1') {
          const obj = joinPath(stage, 'object');
          await writeText(s, joinPath(obj, '0=ocfl_object_1.1'), 'ocfl_object_1.1\n');
          await s.rename(joinPath(stage, ver), joinPath(obj, ver));
          if (!draft) await s.rename(joinPath(stage, 'witnesses'), joinPath(obj, WITNESSES, ver));
          await s.write(joinPath(obj, 'inventory.json'), data);
          await s.write(joinPath(obj, 'inventory.json.sha512'), sc);
          await s.rename(obj, dir);
        } else {
          await s.rename(joinPath(stage, ver), joinPath(dir, ver));
          if (!draft) await s.rename(joinPath(stage, 'witnesses'), joinPath(dir, WITNESSES, ver));
          for (const [name, bytes] of [['inventory.json', data], ['inventory.json.sha512', sc]]) {
            await s.write(joinPath(stage, name), bytes);
            await s.rename(joinPath(stage, name), joinPath(dir, name));
          }
        }
      }

A version built in a staging folder is added only if the line has not
moved meanwhile: its head must still be the version before. The staging
folder holds the version folder, named by its number, and the witness
folder; it is removed once they are moved.

    // in the archive folder:
      async installVersion(id, stage) {
        const s = this.storage;
        const ver = ((await s.list(stage)) || []).find((e) => e.kind === 'dir' && /^v[1-9][0-9]*$/.test(e.name))?.name;
        if (!ver) exit(`${stage} holds no version`);
        const inv = JSON.parse(new TextDecoder().decode(await s.read(joinPath(stage, ver, 'inventory.json'))));
        const dir = await this.dirOf(id);
        const before = await this.inventory(dir);
        if ((before ? before.head : 'v0') !== `v${Number(ver.slice(1)) - 1}`) {
          exit(`${id}: the line has moved since ${ver} was built in ${stage}: it cannot be added`);
        }
        await this.moveStaged(dir, stage, ver, id.startsWith('sheaf:draft:'));
        await removeStage(s, stage);
        this.changed();
        return inv;
      }

### Sealing a new work

A new work (sections 5.3 and 10.2) gets a new genesis record, whose
originator is its owner, and a name free in this archive: not the name of
a line held, nor of a line taken down.

    // in the archive folder:
      async seal(kind, owner) {
        const taken = new Set();
        for (const { id } of await this.objects()) {
          const name = (id || '').split(':')[1];
          if (name !== undefined) taken.add(name);
        }
        for (const t of this.tombstones) {
          taken.add(t.genesisName);
          taken.add(t.name);
        }
        for (;;) {
          const genesis = await genesisRecord(kind, { originator: owner });
          const name = await nameOf(genesis);
          if (!taken.has(name)) return { genesis, id: objectId(name, owner) };
        }
      }
    }

The staging folder is removed once its content is moved, or when the
command fails half-way; the walk removes only what is below the staging
folder.

    // in the archive folder:
    export async function removeTree(storage, path) {
      if (!/^\.staging-[0-9a-f]+$/.test(path.split('/')[0])) throw new Error(`not a staging folder: ${path}`);
      const kind = await storage.kind(path);
      if (kind === 'dir') {
        for (const entry of (await storage.list(path)) || []) await removeTree(storage, joinPath(path, entry.name));
        await storage.remove(path);
      } else if (kind) {
        await storage.remove(path);
      }
    }

The staging folder of a Zenodo deposit, under `zenodo-staging/`, is
removed with what is left in it; the folders above it that it leaves
empty go too, up to `zenodo-staging/` itself, so that an archive with no
deposit under way has none (opensheaf-py's `remove_stage`).

    // in the archive folder:
    export async function removeStage(storage, path) {
      if (!/^zenodo-staging\/./.test(path)) throw new Error(`not a staging folder of Zenodo: ${path}`);
      const walk = async (p) => {
        const kind = await storage.kind(p);
        if (kind === 'dir') for (const entry of (await storage.list(p)) || []) await walk(joinPath(p, entry.name));
        if (kind) await storage.remove(p);
      };
      await walk(path);
      for (let p = path.slice(0, path.lastIndexOf('/')); p; p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') {
        if ((await storage.kind(p)) !== 'dir' || ((await storage.list(p)) || []).length) break;
        await storage.remove(p);
      }
    }

    export { LABEL };
