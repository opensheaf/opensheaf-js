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
[17](17-verify.md) lists them); and with `--remote`, the links of owners
to their keepers (section 6.6). The parity tests (chapter
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

    <<verifying a folder>>

    <<files that look like private keys>>

Verifying a folder
------------------

The origin is the base URL of `osheaf.json` when it is one; without a
configuration (a copy of an archive, a mirror), any origin will do. With
`remote`, the members of collections held in other archives are resolved
over the network, through `fetch`.

    // in verifying a folder:
    export async function verifyFolder(storage, { schemas, remote = false, fetch = globalThis.fetch,
                                                  digests = true } = {}) {
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
        report = await verify(archive, { schemas, remote, digests });
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

The findings are printed as opensheaf-py prints them, one per line, then
the count; or as JSON, a list of objects with `severity`, `place` and
`message`.

    // in verifying a folder:
    export function findingsJson(report) {
      return report.findings.map((f) => ({ severity: f.level, place: f.place, message: f.message }));
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
