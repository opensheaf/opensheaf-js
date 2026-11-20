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
(section 15.4) is made here too. Content digests are always checked, as
opensheaf-py checks them.

What opensheaf-py checks and this program does not yet: the completeness
of the storage root (objects and witness files that the discovery
document does not list), and an independent OCFL validator (chapter
[17](17-verify.md) lists them). Two checks are made as opensheaf-py makes
them, from the folder rather than over HTTP: the presentation of appendix
A.3, which also applies to an archive that configures a readable index or
has landing pages without declaring the profile `website`; and the links
of owners to their keepers (section 6.6), reported as not checked, or with
`--remote` read from the keeper's place (chapter [32](32-keepers.md)). The
parity tests (chapter
[72](72-tests-parity.md)) compare the findings of the two on the archives
each makes.

The module is `core/check.js`.

    // in core/check.js:
    import { Http, FetchError } from './http.js';
    import { Archive } from './archive.js';
    import { verify, Report } from './verify.js';
    import { finding } from './rules.js';
    import { storageFetch, readJson, joinPath, ORIGIN } from './storage.js';
    import { ROTATION_FORMAT, SHEET_TITLE } from './keys.js';
    import { unbase64 } from './crypto.js';
    import { objectId } from './names.js';
    import { memberPins } from './versions.js';
    import { ArchiveFolder, environment } from './folder.js';
    import { pageAddress } from './website.js';
    import { keeperOf, keeperLink, successorClaim, NOT_CHECKED } from './keepers.js';

    <<verifying a folder>>

    <<keepers>>

    <<the presentation of a folder>>

    <<files that look like private keys>>

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
      let report;
      try {
        const archive = await Archive.open(http, base);
        report = await verify(archive, { schemas, remote, digests, pages: false });
        if (!archive.old) {
          const f = await folderOf(storage);
          if (f) {
            report.add(...await keeperFindings(f, remote, fetchJson));
            report.add(...await presentationFindings(f, archive.disc));
          }
        }
      } catch (error) {
        if (!(error instanceof FetchError)) throw error;
        report = new Report(base, { remote, digests });
        report.add(finding('error', 'opensheaf.json', error.kind === 'not-found'
          ? 'the discovery document is missing (section 3.1)' : `not JSON: ${error.detail}`));
      }
      if (!report.findings.some((f) => f.message === 'specification 0.1: rebuild (section 16.1)')) {
        report.add(...await lookForKeys(storage));
      }
      return report;
    }

The folder is read as an archive kept (chapter [23](23-folder.md)) for
the two checks below, when its configuration can be read; without one,
they are not made.

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
place that cannot be read is a warning.

    // in keepers:
    export async function keeperFindings(f, remote, fetchJson = null) {
      const out = [];
      for (const { id, dir, inv } of await f.objects()) {
        if (!inv || typeof id !== 'string') continue;
        if ((await f.readObjectJson(dir, inv, 'object.json'))?.kind !== 'owner') continue;
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
        out.push(finding('result', place, `keeper ${keeper}: ${link.status} (${link.reason}; section 6.6)`));
        const claim = successorClaim(log, link);
        if (claim) out.push(finding('result', place, `successor ${link.successor} ${claim}`));
      }
      return out;
    }

The presentation of a folder
----------------------------

Appendix A.3, as opensheaf-py checks it: the home page shows the pin of
every member of the latest signed version of the main catalogue, and each
member held here has a landing page giving the full `sheaf:` URI of its
line; errors under the profile `website`, warnings for an archive that
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
      const mainId = f.labels.get(f.archive.mainCollection);
      if (mainId) {
        const dir = await f.dirOf(mainId);
        const inv = await f.inventory(dir);
        const ver = inv ? await f.latestSigned(mainId).catch(() => null) : null;
        if (ver) members = (await f.readObjectJson(dir, inv, 'members.json', ver))?.members || [];
      }
      const page = home ? new TextDecoder().decode(home) : null;
      if (page === null && website) out.push(finding(level, 'index.html', 'the home page is missing (appendix A.3)'));
      const gone = new Set(f.tombstones.map((t) => t.id));
      const ids = (await f.objects()).map((o) => o.id);
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
        const landing = `paper/${await pageAddress(f, id, ids)}/index.html`;
        const bytes = await f.storage.read(landing);
        const text = bytes ? new TextDecoder().decode(bytes) : '';
        if (!(await landingNames(f, text, m.name, m.owner, id, dir))) {
          report(landing, `no landing page giving the sheaf: URI of ${where(f, id)} (appendix A.3)`);
        }
      }
      return out;
    }

    function where(f, id) {
      const parts = (id || '').split(':');
      if (parts.length === 3 && parts[1] === parts[2]) return `owner ${parts[1]}`;
      return f.labelOf(id) || id || '?';
    }

    async function landingNames(f, text, name, owner, id, dir) {
      if (text.includes(`sheaf:${name}:${owner}`)) return true;
      let originator = null;
      try {
        const inv = await f.inventory(dir);
        const g = await f.readLogical(dir, inv, 'genesis.json', 'v1');
        if (!g) return false;
        originator = JSON.parse(new TextDecoder().decode(g)).originator ?? null;
      } catch {
        return false;
      }
      return originator === owner && new RegExp(`sheaf:${name}(?![a-z0-9:/])`).test(text);
    }

Files that look like private keys
---------------------------------

A private key is never kept in an archive (section 15.4). A file is
suspect by its name (a rotation key file as exported, `rotation-<16>-<16>.txt`,
or any `.key`), or, if it is small, by its content: the first line of a
rotation key file or of its printed sheet, or 32 bytes in base64, the
form of a seed in a key store. The folders `.git` and the staging folders
are not searched; symbolic links are not followed.

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
          if (!looks) {
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
            found.push(finding('warning', path, 'looks like a private key: keys are never kept in an archive (section 15.4)'));
          }
        }
      };
      await walk('');
      return found;
    }
