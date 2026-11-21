The Manager's core
==================

The [Manager](https://opensheaf.org/manager/) (repository
[opensheaf/manager](https://github.com/opensheaf/manager)) is a page that
keeps an archive held on GitHub. With this phase it writes to the
archive itself: it reads the archive from the head of its branch
(chapter [47](47-github-storage.md)), carries the person's request out
as the archive's workflow would (chapter [48](48-requests.md)), signs the
new versions in the browser with the owner's current keys, and commits
the result, one commit per request, with the person's GitHub sign-in.
The keys come from the owner's key wallet (chapter [35](35-wallets.md)),
opened by the owner's passkey through the popup of chapter
[36](36-passkeys.md); they are kept in the page's memory, as WebCrypto
keys that cannot be exported, and forgotten when the page is closed.

This chapter is what the Manager imports: one module, `web/manager.js`,
which gathers the parts of the core it uses and adds the few functions
that are the Manager's own; and the script that makes of it, with the
JSON Schemas and the default templates of the website, one file a
browser loads, `dist/opensheaf-manager.js` (`deno task bundle`). The
Manager keeps a copy of that file, with the commit of this repository it
was made from.

    // in web/manager.js:
    import { environment, ArchiveFolder } from '../core/folder.js';
    import { loadSchemas } from '../core/schema.js';
    import { fetchJsonWith } from '../core/keepers.js';
    import { Key, readKey, passkeysOf, passkeySalt, passkeyKek, PASSKEY_RP, KeyError } from '../core/keys.js';
    import { describeEntry } from '../core/wallets.js';
    import { sameBytes, unbase64 } from '../core/crypto.js';
    import { oneCommit } from '../core/github.js';
    import { carryOut } from '../core/requests.js';

    export { GitHub, GitHubStorage, GitHubError, CommitConflict, oneCommit, gitBlobSha, GITHUB_API } from '../core/github.js';
    export { carryOut, Problem, OPERATIONS, WORKFLOW_ONLY, NEW_PAPER, NEW_VERSION } from '../core/requests.js';
    export { popupUrl, popupRequest, openPopupAnswer, sameCode, confirmationCode, POPUP, POPUP_MESSAGES, UNLOCK_ORIGIN,
             UnlockFailed } from '../core/passkey.js';
    export { Key, readKey, KeyError, PASSKEY_RP } from '../core/keys.js';
    export { GitHubWallet, WalletError } from '../core/wallets.js';
    export { ArchiveFolder, Stop } from '../core/folder.js';

    <<the environment of a page>>

    <<the keys that sign>>

    <<a request written directly>>

The environment of a page
-------------------------

The environment of the core (chapter [23](23-folder.md)) in a page: no
terminal (what the commands say is collected by `carryOut`), no new keys,
no passphrase, no folder to export to; the current keys that the page
holds; other archives and keepers read with the page's `fetch`; and the
default templates of the website from the bundle (an archive made from
the template has its own). The schemas are those of the bundle.

    // in the environment of a page:
    export function browserEnvironment({ assets, keys = new Map(), fetch = globalThis.fetch?.bind(globalThis) } = {}) {
      const refuse = (what) => async () => {
        throw new Error(`the Manager does not ${what}: use osheaf on your computer`);
      };
      return environment({
        out: () => {},
        err: () => {},
        fetch,
        fetchJson: fetchJsonWith(fetch),
        template: async (name) => (name in (assets?.templates || {}) ? new TextEncoder().encode(assets.templates[name]) : null),
        newKey: refuse('make keys'),
        passphrase: refuse('ask for passphrases'),
        input: refuse('ask questions'),
        keyStore: {
          keptOnDevice: () => false,
          storeName: () => 'the memory of this page',
          current: async (owner, dids) => (keys.get(owner) || []).filter((k) => dids.includes(k.did)),
          keep: refuse('keep keys'),
        },
        signingKeyGiven: true,
      });
    }

    export async function schemasOf(assets) {
      return loadSchemas(async (url) => assets.schemas[String(url).split('/').pop()]);
    }

The keys that sign
------------------

The current keys of the owner of the archive that may sign now: those of
the latest version of its key log, which a version needs `threshold` of.

    // in the keys that sign:
    export async function signers(storage, env) {
      const f = await ArchiveFolder.open(storage, env);
      const owner = f.archive.owner;
      const log = await f.keyLog(owner);
      const latest = log?.latest();
      if (!latest) return { owner, dids: [], threshold: 0 };
      return { owner, dids: [...latest.keys.keys], threshold: latest.keys.threshold };
    }

The locks of those keys in a wallet: each entry of the owner that holds
one of them as a current key, with the passkeys (of the relying party of
the unlock page, and of this owner's PRF salt) that open it.

    // in the keys that sign:
    export async function walletLocks(wallet, owner, dids) {
      const salt = await passkeySalt(owner);
      const out = [];
      for (const [o, kid] of await wallet.entries(owner)) {
        const text = await wallet.read(o, kid, 'current');
        if (!text) continue;
        const fields = describeEntry(text);
        if (fields.kind !== 'current' || !dids.includes(fields.key)) continue;
        const creds = passkeysOf(text).filter((p) => p.rp === PASSKEY_RP && sameBytes(p.salt, salt)).map((p) => p.cred);
        out.push({ kid, did: fields.key, text, creds });
      }
      return out;
    }

A key opened by the secret of a passkey, kept as a WebCrypto key that
cannot be exported: the seed is dropped once the key is made.

    // in the keys that sign:
    const PKCS8_ED25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

    export async function sealedKey(key) {
      const signing = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8_ED25519, ...key.seed]),
                                                    { name: 'Ed25519' }, false, ['sign']);
      key.seed.fill(0);
      return new Key(null, signing, key.publicKey, key.did, key.digest);
    }

    export async function openLocks(locks, owner, cred, prf) {
      const kek = await passkeyKek(prf);
      const keys = [];
      for (const lock of locks) {
        if (!lock.creds.includes(cred)) continue;
        const rk = await readKey(lock.text, null, { [cred]: kek });
        if (rk.owner !== owner || rk.kind !== 'current' || rk.key.did !== lock.did) {
          throw new KeyError(`the wallet's entry ${lock.kid} holds another key`);
        }
        keys.push(await sealedKey(rk.key));
      }
      kek.fill(0);
      return keys;
    }

A key given as the text of `osheaf key export`, or as the one line of
its seed in base64 that the file key store and `OPENSHEAF_SIGNING_KEY`
hold (whose owner is then given): for the tests, and the live test of the
Manager against a repository, which have no passkey. Read, and sealed the
same way.

    // in the keys that sign:
    export async function keyFromText(text, { passphrase = null, owner = null } = {}) {
      const line = text.trim();
      if (/^[A-Za-z0-9+/]{43}=$/.test(line)) {
        if (!owner) throw new KeyError('a seed alone: give the owner of the key');
        return { owner, kind: 'current', key: await sealedKey(await Key.fromSeed(unbase64(line))) };
      }
      const rk = await readKey(text, passphrase);
      return { owner: rk.owner, kind: rk.kind, key: await sealedKey(rk.key) };
    }

A request written directly
--------------------------

A request carried out on the head of the archive's branch and committed,
one commit, the command run again if the branch moved meanwhile (chapter
[47](47-github-storage.md)). Before the request, the files the commands
read are prefetched: the configuration, the discovery document, the
collections' files, the templates, and in the storage root the JSON
files and checksums (inventories, descriptions, members, genesis
records, signatures, key logs); and every file under 4096 bytes, which
the verification's search for private keys reads (chapter
[28](28-verify-folder.md)). Not the content of papers, which no command
of a request reads again. The verification trusts the content
files to match their inventories (`digests: false`): they are git blobs,
named by their content, and unchanged. The prefetch reads twelve files
at a time: most come from the mirror, a CDN.

`progress(phase)` is told `reading`, `carrying out` and `committing`.
The answer is that of `carryOut`, with the commit (`null` when the
request was refused, and nothing was committed).

    // in a request written directly:
    export function prefetched(path, size = null) {
      return (size !== null && size < 4096) || path === 'osheaf.json' || path === 'opensheaf.json' || path.startsWith('collections/') ||
        path.startsWith('templates/') || (path.startsWith('ocfl/') && /\.(json|sha512)$/.test(path)) ||
        (path.startsWith('ocfl/') && !path.includes('/content/'));
    }

    export async function directWrite({ repo, github, operation, fields, files = {}, env, schemas, assets = null,
                                        mirror = null, cache = new Map(), origin = 'the OpenSheaf manager',
                                        progress = () => {}, attempts = 3 }) {
      const done = await oneCommit(repo, github, async (storage) => {
        progress('carrying out');
        const answer = await carryOut(storage, env, operation, fields, files, { origin, schemas, digests: false });
        if (answer.ok) progress('committing');
        return { message: answer.ok ? answer.commitMessage : null, answer };
      }, { mirror, cache, attempts, prepare: async (storage) => {
        progress('reading');
        await storage.prefetch({ skip: (p, size) => !prefetched(p, size), concurrency: 12 });
      } });
      return { ...done.answer, commit: done.commit, reads: done.storage.reads, attempts: done.attempts ?? 1 };
    }

The bundle
----------

`tools/bundle.js` writes an entry that adds to `web/manager.js` the
schemas and the templates, as text, then bundles it for browsers with
`deno bundle` (esbuild): one ES module, with the packages of the core
(`yaml`, `hash-wasm`, `tweetnacl`) inside. Its first line names the
commit of this repository it was made from, and whether the working
tree had changes.

    // in tools/bundle.js:
    import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
    import { spawnSync } from 'node:child_process';
    import path from 'node:path';
    import process from 'node:process';
    import { fileURLToPath } from 'node:url';

    const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const read = async (dir) => Object.fromEntries(await Promise.all((await readdir(path.join(ROOT, dir))).sort()
      .map(async (n) => [n, await readFile(path.join(ROOT, dir, n), 'utf-8')])));
    const schemas = Object.fromEntries(Object.entries(await read('schemas')).map(([n, t]) => [n, JSON.parse(t)]));
    const templates = await read('templates');
    await mkdir(path.join(ROOT, 'dist'), { recursive: true });
    const entry = path.join(ROOT, 'dist', 'manager-entry.js');
    await writeFile(entry, "export * from '../web/manager.js';\n" +
                    `export const ASSETS = ${JSON.stringify({ schemas, templates })};\n`);
    const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf-8' }).stdout.trim();
    const commit = git('rev-parse', 'HEAD') + (git('status', '--porcelain') ? ' (with changes)' : '');
    const out = process.argv[2] || path.join(ROOT, 'dist', 'opensheaf-manager.js');
    const r = spawnSync('deno', ['bundle', '--platform', 'browser', '--config', path.join(ROOT, 'deno.json'), '-o', out, entry],
                        { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    const bundled = await readFile(out, 'utf-8');
    await writeFile(out, `// opensheaf-js ${commit}: web/manager.js bundled by tools/bundle.js (GPL-3.0-or-later)\n${bundled}`);
    console.log(`${out}: opensheaf-js ${commit}`);
