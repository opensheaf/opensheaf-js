Verifying an archive folder
===========================

`osheaf verify` checks the archive of the folder it is run in (section
14). The checks are those of the Explorer (chapter [17](17-verify.md)),
which agree, finding by finding, with `osheaf verify` of opensheaf-py on
everything a reader over HTTP can see; here they read the archive from
its storage, over the storage's own `fetch` (chapter
[20](20-storage.md)), with the base URL of the archive as its origin. A
folder can also be listed, which a web server cannot: the check that
opensheaf-py makes on the files of the folder that look like private keys
(section 15.4) is made here too, and so is its report of the symbolic
links among the files of the specification, which no reader follows
(section 15.2). Content digests are always checked, as
opensheaf-py checks them.

A folder can be listed, so the verification of a folder is complete as
opensheaf-py's is (section 14.1): the objects of the storage root that
the discovery document does not list are found and checked with the
others, and reported unlisted; and every file of every witness folder is
read (the `lister` of chapter [14](14-archive.md)), so that signature
files of keys the key log does not list, or without a key log, are
judged, and other files and folders are reported (section 7.2).

The storage root is also given to an independent OCFL validator, a port
of `ocfl-py`, which opensheaf-py runs when it is installed (chapter
[50](50-ocfl.md)): each object, then the storage root without its
objects, as opensheaf-py gives them to `ocfl-py`, with its errors in its
words (below). An object at a path other than its identifier gives is
reported as not listed rather than misplaced. Two checks are made as
opensheaf-py makes them, from the folder rather than over HTTP: the
presentation of appendix A.3, which also applies to an archive that
configures a readable index or has landing pages without declaring the
profile `website`; and the links of owners to their keepers (section
6.6), reported as not checked, or with `--remote` read from the keeper's
place (chapter [32](32-keepers.md)). The parity tests (chapter
[72](72-tests-parity.md)) compare the findings of the two on the
archives each makes.

The module is `core/check.js`.

    // in core/check.js:
    import { Http, FetchError, nesting, parseFormat, LIMITS } from './http.js';
    import { Archive } from './archive.js';
    import { verify, Report } from './verify.js';
    import { finding, schemaFindings } from './rules.js';
    import { storageFetch, storageLister, readJson, joinPath, ORIGIN } from './storage.js';
    import { ROTATION_FORMAT, SHEET_TITLE } from './keys.js';
    import { unbase64 } from './crypto.js';
    import { objectId, parseId, isObject } from './names.js';
    import { memberPins } from './versions.js';
    import { ArchiveFolder, environment } from './folder.js';
    import { nameAddress } from './deposit.js';
    import { keeperOf, keeperLink, successorClaim, NOT_CHECKED } from './keepers.js';
    import { pathOf } from './paths.js';
    import { validateObject, validateStorageRoot } from './ocfl.js';

    <<verifying a folder>>

    <<keepers>>

    <<the presentation of a folder>>

    <<files that look like private keys>>

    <<symbolic links>>

    <<the OCFL validator>>

Verifying a folder
------------------

The origin is the base URL of `osheaf.json` when it is one; without a
configuration (a copy of an archive, a mirror), any origin will do. With
`remote`, the members of collections held in other archives are resolved
over the network, through `fetch`.

    // in verifying a folder:
    export async function verifyFolder(storage, { schemas, remote = false, fetch = globalThis.fetch,
                                                  digests = true, fetchJson = null } = {}) {
      let base = ORIGIN;
      try {
        const cfg = await readJson(storage, 'osheaf.json');
        if (typeof cfg?.baseUrl === 'string' && /^https?:\/\/[^/]+\/(.*\/)?$/.test(cfg.baseUrl)) base = cfg.baseUrl;
      } catch {
        // a configuration that cannot be read gives no base URL
      }
      const http = new Http({ fetch: storageFetch(storage, base, { fallback: remote ? fetch : null }), budget: null });
      let archive, unread = null;
      try {
        archive = await Archive.open(http, base);
      } catch (error) {
        if (!(error instanceof FetchError) || error.kind === 'aborted') throw error;
        unread = finding('error', 'opensheaf.json', error.kind === 'not-found'
          ? 'the discovery document is missing (section 3.1)'
          : error.detail === 'is not a JSON object' ? 'the discovery document is a JSON object (section 3.1)'
            : await formatProblem(storage, error));
      }
      if (archive && !archive.old) {
        try {
          parseFormat(await storage.read('opensheaf.json'));
        } catch (error) {
          unread = finding('error', 'opensheaf.json', error.message);
        }
      }
      const f = archive?.old ? null : await folderOf(storage);
      if (unread) {
        const lenient = archive;
        archive = new Archive(http, base, { specification: '0.2', storageRoot: 'ocfl/', storageLayout: f?.layout });
        archive.unreadDiscovery = true;
        if (lenient) archive.labelOf = (id) => lenient.labelOf(id);
      }
      archive.lister = storageLister(storage, base);
      const linked = [];
      if (f) {
        archive.unlisted = await unlistedObjects(f, archive);
        archive.contentProblems = await contentProblems(f);
        for (const { id, dir } of await f.objects()) {
          if (!(await holdsLink(storage, dir))) continue;
          linked.push(finding('warning', dir, 'an object holding a symbolic link: not read, nor given to the OCFL validator ' +
                              '(section 15.2)'));
          if (typeof id === 'string') (archive.linkedObjects ??= new Set()).add(id);
        }
      }
      const report = await verify(archive, { schemas, remote, digests, pages: false });
      report.add(...linked);
      if (unread && (await storage.kind('opensheaf.json')) !== 'link') report.add(unread);
      if (!archive.old && f) {
        report.add(...await guarded('the keepers', () => keeperFindings(f, remote, fetchJson, schemas)));
        report.add(...await guarded('the presentation files', () => presentationFindings(f, unread ? {} : archive.disc)));
        report.add(...await guarded('the storage root', () => ocflFindings(f, report)));
      }
      if (!report.findings.some((f) => f.message === 'specification 0.1: rebuild (section 16.1)')) {
        report.add(...await lookForKeys(storage));
        const said = new Set(report.findings.map((x) => `${x.place}\n${x.message}`));
        report.add(...(await lookForLinks(storage)).filter((x) => !said.has(`${x.place}\n${x.message}`)));
      }
      return report;
    }

A discovery document that is missing, or cannot be read, is said to be
so in the words of opensheaf-py, which reads it as section 2 defines JSON
(`parseFormat`, chapter [10](10-http.md), which also refuses numbers
that the reading of an archive takes); the folder is then verified as
opensheaf-py verifies it, with an empty discovery document
(`unreadDiscovery`): the objects of the storage root, found by walking
it, in the layout of the configuration, but none of the checks of the
discovery document itself (chapter [17](17-verify.md)); the labels it
gives, when it can be read at all, still name the objects, as
opensheaf-py, which reads it leniently for them, names them.

    // in verifying a folder:
    async function formatProblem(storage, error) {
      try {
        parseFormat(await storage.read('opensheaf.json'));
      } catch (problem) {
        return problem.message;
      }
      return `not JSON: ${error.detail}`;
    }

The folder is read as an archive kept (chapter [23](23-folder.md)) for
the checks below, when its configuration can be read; without one, they
are not made. Its storage root is walked, as opensheaf-py walks it, for
the objects the discovery document does not list (drafts included), which
the verification then checks with the others (section 14.1:
completeness).

The checks made through the archive folder run guarded, as opensheaf-py
runs each step of its verifier (`guarded`): a file they cannot read (a
content path that is not read, a file that is not JSON) becomes an
error, and the verification goes on.

    // in verifying a folder:
    async function guarded(what, step) {
      try {
        return await step();
      } catch (error) {
        if (error?.kind === 'aborted') throw error;
        return [finding('error', 'archive', `the checks of ${what} stopped on a file they cannot read ` +
                        `(${error?.constructor?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 300)}); ` +
                        'the rest of them are not made')];
      }
    }

The objects the discovery document does not list:

    // in verifying a folder:
    async function unlistedObjects(f, archive) {
      const listed = new Set([...archive.objects().map((o) => o.id), ...archive.drafts().map((d) => d.id)]);
      const out = [];
      for (const { id } of await f.objects()) {
        if (typeof id === 'string' && parseId(id) && !listed.has(id) && !out.includes(id)) out.push(id);
      }
      return out;
    }

The content paths of each object that are not read, with the reason
(`contentProblem`, chapter [23](23-folder.md)): a path out of the object,
one that passes through a symbolic link, one that names a folder. The
verification (chapter [17](17-verify.md)) reports them and checks such an
object no further, as opensheaf-py's `check_object_storage` does; over
HTTP no link is seen, and only the paths out of the object are found
there, by their form.

    // in verifying a folder:
    async function contentProblems(f) {
      const out = new Map();
      for (const { id, dir, inv } of await f.objects()) {
        if (typeof id !== 'string' || out.has(id) || !isObject(inv?.manifest)) continue;
        const found = new Map();
        for (const paths of Object.values(inv.manifest)) {
          for (const cp of Array.isArray(paths) ? paths : []) {
            const problem = await f.contentProblem(dir, cp);
            if (problem && !found.has(cp)) found.set(cp, problem);
          }
        }
        if (found.size) out.set(id, found);
      }
      return out;
    }

The archive kept is opened quietly: what it would say is not a finding.

    // in verifying a folder:
    async function folderOf(storage) {
      try {
        return await ArchiveFolder.open(storage, environment({ out: () => {}, err: () => {} }));
      } catch {
        return null;
      }
    }

The findings are printed as opensheaf-py prints them, one per line, then
the count; or as JSON, a list of objects with `severity`, `place` and
`message`.

    // in verifying a folder:
    export function findingsJson(report) {
      return report.findings.map((f) => ({ severity: f.level, place: f.place, message: f.message }));
    }

Keepers
-------

The keeper an owner names (section 6.6) is reported for every key log held:
not checked, unless `--remote` reads its ORCID record or its domain; a
place that cannot be read is a warning. The keeper's file of format
`opensheaf-keeper/0.2`, when one is read, is checked against its schema
(section 14.2). An object whose `object.json`
cannot be read is left to the checks of the storage root, which report it.

    // in keepers:
    export async function keeperFindings(f, remote, fetchJson = null, schemas = {}) {
      const out = [];
      for (const { id, dir, inv } of await f.objects()) {
        if (!inv || typeof id !== 'string') continue;
        let kind;
        try {
          kind = (await f.readObjectJson(dir, inv, 'object.json'))?.kind;
        } catch {
          continue;
        }
        if (kind !== 'owner') continue;
        let log;
        try {
          log = await f.keyLog(id.split(':')[2]);
        } catch {
          continue;
        }
        const keeper = log ? await keeperOf(log) : null;
        if (!keeper) continue;
        const place = `owner ${log.owner}`;
        if (!remote) {
          out.push(finding('result', place, `keeper ${keeper}: not checked (osheaf verify --remote reads its ORCID ` +
                                            'record or domain, section 6.6)'));
          continue;
        }
        const link = await keeperLink(log, fetchJson);
        if (link.status === NOT_CHECKED) {
          out.push(finding('warning', place, `keeper ${keeper}: not checked (${link.reason})`));
          continue;
        }
        if (link.document) out.push(...schemaFindings(`${place} keeper ${keeper}`, link.document, schemas['opensheaf-keeper/0.2']));
        out.push(finding('result', place, `keeper ${keeper}: ${link.status} (${link.reason}; section 6.6)`));
        const claim = successorClaim(log, link);
        if (claim) out.push(finding('result', place, `successor ${link.successor} ${claim}`));
      }
      return out;
    }

The presentation of a folder
----------------------------

Appendix A.3, as opensheaf-py checks it: the home page shows the pin of
every member of the latest signed version of each owner catalogue, and each
member held here has a landing page giving the full `sheaf:` URI of its
line, at the address built from its name, which fixed files record
(`paper/<name>/`, or `paper/<name>-<owner>/` for a line whose owner is
not the originator; a label may give a second address, which is not
checked); errors under the profile `website`, warnings for an archive that
presents pages (a home page, a readable index configured, landing pages)
without declaring it.

    // in the presentation of a folder:
    export async function presentationFindings(f, disc) {
      const out = [];
      const profiles = Array.isArray(disc.profiles) ? disc.profiles : [];
      const website = profiles.includes('website');
      const home = await f.storage.read('index.html');
      const landingPages = profiles.includes('texmacs') || Boolean(f.index.html || f.index.template) ||
        (await f.storage.kind('paper')) === 'dir';
      if (!(website || home || landingPages)) return out;
      const level = website ? 'error' : 'warning';
      const note = website ? '' : ' (the archive does not declare the profile website)';
      const report = (place, message) => out.push(finding(level, place, message + (website ? '' : note)));
      let members = [];
      for (const owner of f.archiveOwners()) {
        const cid = f.catalogues.get(owner);
        if (!cid) continue;
        const dir = await f.dirOf(cid);
        const inv = await f.inventory(dir);
        const ver = inv ? await f.latestSigned(cid).catch(() => null) : null;
        if (ver) members = members.concat((await f.readObjectJson(dir, inv, 'members.json', ver))?.members || []);
      }
      const page = home ? new TextDecoder().decode(home) : null;
      if (page === null && website) out.push(finding(level, 'index.html', 'the home page is missing (appendix A.3)'));
      const gone = new Set(f.tombstones.map((t) => t.id));
      for (const m of members) {
        const id = objectId(m?.name, m?.owner);
        if (gone.has(id)) continue;
        const pins = memberPins(m);
        const pin = pins[pins.length - 1]?.pin || '';
        if (page !== null && !page.includes(pin.slice(0, 32))) report('index.html', `does not show the pin of ${m?.name}`);
        let dir;
        try {
          dir = await f.dirOf(id);
        } catch {
          continue;
        }
        if ((await f.storage.kind(joinPath(dir, 'inventory.json'))) !== 'file') continue;
        const landing = `paper/${await nameAddress(f, id)}/index.html`;
        const bytes = await f.storage.read(landing);
        const text = bytes ? new TextDecoder().decode(bytes) : '';
        if (!(await landingNames(f, text, m.name, m.owner, id, dir))) {
          report(landing, `no landing page giving the sheaf: URI of ${where(f, id)} (appendix A.3)`);
        } else {
          const missing = landingDescriptionGaps(text);
          if (missing.length) report(landing, `the landing page of ${where(f, id)} lacks ${missing.join(', ')} (appendix A.3)`);
        }
      }
      return out;
    }

A landing page also describes itself for programs (appendix A.3), as
opensheaf-py's `landing_description_gaps` checks: the Signposting links
`cite-as`, `describedby` and `type`, and a schema.org record in JSON-LD
with a type and identifiers. The record is read as every JSON file is,
nested no deeper than `LIMITS.nesting`; a deeper one is no record.

    // in the presentation of a folder:
    export function landingDescriptionGaps(text) {
      const rels = new Set([...text.matchAll(/<link rel="([a-z-]+)"/g)].map((m) => m[1]));
      const missing = ['cite-as', 'describedby', 'type'].filter((r) => !rels.has(r)).map((r) => `the Signposting link ${r}`);
      const record = /<script type="application\/ld\+json">([^]*?)<\/script>/.exec(text);
      let ld = null;
      try {
        ld = record && nesting(record[1]) <= LIMITS.nesting ? JSON.parse(record[1]) : null;
      } catch {
        ld = null;
      }
      if (!ld || typeof ld !== 'object' || Array.isArray(ld) || !ld['@type'] || !ld.identifier ||
          (Array.isArray(ld.identifier) && !ld.identifier.length)) {
        missing.push('a schema.org record in JSON-LD with a type and identifiers');
      }
      return missing;
    }

    function where(f, id) {
      const parts = (id || '').split(':');
      if (parts.length === 3 && parts[1] === parts[2]) return `owner ${parts[1]}`;
      return f.labelOf(id) || id || '?';
    }

    async function landingNames(f, text, name, owner, id, dir) {
      let originator = null;
      try {
        const inv = await f.inventory(dir);
        const g = await f.readLogical(dir, inv, 'genesis.json', 'v1');
        if (!g) return false;
        originator = JSON.parse(new TextDecoder().decode(g)).originator ?? null;
      } catch {
        return false;
      }
      if (originator === owner) return new RegExp(`sheaf:${name}(?![a-z0-9:/])`).test(text);
      return text.includes(`sheaf:${name}:${owner}`);
    }

Files that look like private keys
---------------------------------

A private key is never kept in an archive (section 15.4): one found is an
error, as it is for opensheaf-py. A file is
suspect by its name (a rotation key file as exported, `rotation-<16>-<16>.txt`,
or any `.key`), or, if it is small, by its content: the first line of a
rotation key file or of its printed sheet, or 32 bytes in base64, the
form of a seed in a key store. The folders `.git` and the staging folders
are not searched; symbolic links are not followed. A storage that knows
the size of a file without reading it (the storage over GitHub of
chapter [47](47-github-storage.md), from its tree) has a method `size`,
and a file of 4096 bytes or more is then not read at all.

    // in files that look like private keys:
    const ROTATION_NAME = /^rotation-[a-z2-7]{16}-[a-z2-7]{16}\.txt$/;

    export async function lookForKeys(storage) {
      const found = [];
      const walk = async (dir) => {
        for (const entry of (await storage.list(dir)) || []) {
          const path = joinPath(dir, entry.name);
          if (!dir && (entry.name === '.git' || entry.name.startsWith('.staging-'))) continue;
          if (entry.kind === 'dir') {
            await walk(path);
            continue;
          }
          if (entry.kind !== 'file') continue;
          let looks = ROTATION_NAME.test(entry.name) || (entry.name.endsWith('.key') && entry.name !== '.key');
          if (!looks && !((await storage.size?.(path)) >= 4096)) {
            const bytes = await storage.read(path);
            if (bytes && bytes.length < 4096) {
              const text = Array.from(bytes, (b) => (b < 128 ? String.fromCharCode(b) : '�')).join('');
              if (text.startsWith(ROTATION_FORMAT) || text.startsWith(SHEET_TITLE)) {
                looks = true;
              } else {
                try {
                  looks = unbase64(text.trim()).length === 32;
                } catch {
                  looks = false;
                }
              }
            }
          }
          if (looks) {
            found.push(finding('error', path, 'looks like a private key: keys are never kept in an archive (section 15.4)'));
          }
        }
      };
      await walk('');
      return found;
    }

Symbolic links
--------------

No reader follows a symbolic link in an archive (section 15.2): the
storage of a disk reads none (chapter [40](40-cli.md)), so a signature
file or a content file reached through one is not there. Each link among
the files of the specification (the storage root, the discovery
document and its pages, the indexes) is an error at its path, as
opensheaf-py's `look_for_links` reports it; a link is not walked into. A
link the verification has reported already (a link named as a file of
an index, chapter [17](17-verify.md)) is not reported twice, and a
discovery document that is a link is that error alone, not also a
document missing. An object
whose folder holds a link anywhere (`holdsLink`, opensheaf-py's
`links_in`), or that is reached through one, is not read at all: a
warning says so at its folder, the verification leaves it out
(`linkedObjects`), as opensheaf-py leaves it out of the storage root its
later steps see, and the OCFL validator is not given it.

    // in symbolic links:
    export async function holdsLink(storage, dir) {
      if ((await storage.kind(dir)) === 'link' || await storage.linked?.(dir)) return true;
      for (const entry of (await storage.list(dir).catch(() => null)) || []) {
        if (entry.kind === 'link') return true;
        if (entry.kind === 'dir' && await holdsLink(storage, joinPath(dir, entry.name))) return true;
      }
      return false;
    }

    const LINKS_SEARCHED = ['ocfl', 'opensheaf.json', 'objects', 'indexes.json', 'names', 'owners', 'sha512'];

    export async function lookForLinks(storage) {
      const found = [];
      const say = (path) => found.push(finding('error', path, 'a symbolic link in the archive: never followed (section 15.2)'));
      const walk = async (dir) => {
        for (const entry of (await storage.list(dir)) || []) {
          const path = joinPath(dir, entry.name);
          if (entry.kind === 'link') say(path);
          else if (entry.kind === 'dir') await walk(path);
        }
      };
      for (const top of LINKS_SEARCHED) {
        const kind = await storage.kind(top);
        if (kind === 'link') say(top);
        else if (kind === 'dir') await walk(top);
      }
      return found;
    }

The OCFL validator
------------------

The storage root is given to the OCFL validator of chapter
[50](50-ocfl.md) exactly where opensheaf-py gives it to `ocfl-py`, and
reported in the same words. Each object that opensheaf-py's checks of
storage keep (its `found`) is validated once, by itself, and an object
the validator rejects is one error at the object, `OCFL validator:`
followed by the errors of the validator, one per line, sorted (its
warnings are not reported: they are on what OpenSheaf does on purpose).
Then, if every object could be read, the storage root as a whole is
validated without its objects: its declaration, its layout, its
`extensions` folder and the hierarchy of folders down to the objects,
whose errors (a folder left empty by a tool, such as `draft/` once its
last draft is sealed, E073; files outside the objects, E072) are the only
ones that make it rejected, which is one error, "the OCFL validator
rejects the storage root"; otherwise a warning says that it is not given
to the validator, which would read the files of the objects that cannot
be read.

The objects given to the validator are those opensheaf-py's
`check_storage` gives it: every folder of an object once (two objects
with one identifier are both given), but those left out, which are
counted as unread: an object that holds a symbolic link anywhere (the
validator would follow it, chapter [17](17-verify.md)), one without a
readable inventory or an identifier, one whose inventory does not have the
shape the checks read (`inventoryProblem`, opensheaf-py's
`inventory_problem`), one that the verification checked no further (a
content path out of the object, a file of the specification that breaks
section 2). An object whose identifier is not that of a line or of a
draft is given, at its folder, when its inventory has that shape and its
content paths can be read. The storage root as a whole is not given when
an object was left out, nor when a symbolic link is in it.

The validator runs where files can be read in pieces (a storage with
`stream`, the disk of the command line): it reads every file of every
object, and its content digests are of files of any size. Elsewhere (the
Manager's storage over GitHub, a storage in memory) it does not run, and
the verification says nothing of it.

    // in the OCFL validator:
    async function ocflFindings(f, report) {
      const s = f.storage;
      if (typeof s.stream !== 'function' || (await s.kind('ocfl')) !== 'dir') return [];
      const out = [];
      const given = [];
      let unread = 0;
      const checkedNoFurther = (id) => report.findings.some((x) => x.level === 'error' && x.object === id &&
        (x.message.endsWith('nor the object checked further') || x.message.endsWith('section 2: not checked further')));
      for (const { id, dir, inv } of await f.objects()) {
        if (await holdsLink(s, dir) || !isObject(inv) || id === null || id === undefined) {
          unread++;
          continue;
        }
        try {
          await pathOf(id, f.layout);
        } catch {
          let unsafe = inventoryProblem(inv);
          for (const cp of unsafe ? [] : Object.values(inv.manifest).flat()) unsafe ||= Boolean(await f.contentProblem(dir, cp));
          if (unsafe) unread++;
          else given.push([dir, dir]);
          continue;
        }
        if (inventoryProblem(inv) || checkedNoFurther(id)) unread++;
        else given.push([where(f, id), dir]);
      }
      for (const [place, dir] of given) {
        const { valid, log } = await validateObject(s, dir);
        if (!valid) out.push(finding('error', place, `OCFL validator: ${log.statusStr()}`));
      }
      if (unread) {
        out.push(finding('warning', 'ocfl', 'the storage root as a whole is not given to the OCFL validator: it would read ' +
                         'the files of the objects that cannot be read'));
      } else if (await holdsLink(s, 'ocfl')) {
        out.push(finding('warning', 'ocfl', 'the storage root as a whole is not given to the OCFL validator: it would follow ' +
                         'the symbolic links in it'));
      } else if (!(await validateStorageRoot(s, 'ocfl', { validateObjects: false })).valid) {
        out.push(finding('error', 'ocfl', 'the OCFL validator rejects the storage root'));
      }
      return out;
    }

    function inventoryProblem(inv) {
      const pathsMap = (m) => isObject(m) && Object.values(m).every((v) =>
        Array.isArray(v) && v.length > 0 && v.every((p) => typeof p === 'string'));
      if (!pathsMap(inv.manifest)) return true;
      const versions = inv.versions;
      if (!isObject(versions) || !Object.keys(versions).length || !Object.values(versions).every(isObject)) return true;
      if (typeof inv.head !== 'string' || !Object.hasOwn(versions, inv.head)) return true;
      return Object.values(versions).some((v) => !pathsMap(v.state) || ('user' in v && !isObject(v.user)) ||
        ('message' in v && typeof v.message !== 'string') || ('created' in v && typeof v.created !== 'string'));
    }
