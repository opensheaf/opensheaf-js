The Manager's core
==================

The [Manager](https://manager.opensheaf.org/) (repository
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
    import { Key, readKey, passkeysOf, passkeySalt, passkeyKek, Passkey, wrapsOf, PASSKEY_RP, KeyError, PassphraseNeeded,
             CURRENT } from '../core/keys.js';
    import { describeEntry, putKey, addPasskey, readAny, WalletError } from '../core/wallets.js';
    import { sameBytes, unbase64 } from '../core/crypto.js';
    import { oneCommit } from '../core/github.js';
    import { carryOut } from '../core/requests.js';

    export { GitHub, GitHubStorage, GitHubError, CommitConflict, oneCommit, gitBlobSha, GITHUB_API } from '../core/github.js';
    export { carryOut, Problem, OPERATIONS, WORKFLOW_ONLY, NEW_PAPER, NEW_VERSION } from '../core/requests.js';
    export { popupUrl, popupRequest, openPopupAnswer, sameCode, confirmationCode, POPUP, POPUP_ENROLL, POPUP_MESSAGES,
             UNLOCK_ORIGIN, UnlockFailed } from '../core/passkey.js';
    export { Key, readKey, KeyError, PASSKEY_RP } from '../core/keys.js';
    export { GitHubWallet, WalletError } from '../core/wallets.js';
    export { ArchiveFolder, Stop } from '../core/folder.js';

    <<the environment of a page>>

    <<the keys that sign>>

    <<setting up a key wallet>>

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
the latest version of its key log, which a version needs `threshold` of;
and, for each, the first version of the log that lists it, which a key
file of a wallet records (`version`, as `osheaf key push` writes it).

    // in the keys that sign:
    export async function signers(storage, env) {
      const f = await ArchiveFolder.open(storage, env);
      const owner = f.archive.owner;
      const log = await f.keyLog(owner);
      const latest = log?.latest();
      if (!latest) return { owner, dids: [], threshold: 0, versions: {} };
      const versions = {};
      for (const did of latest.keys.keys) {
        versions[did] = log.side().find((v) => v.keys && (v.keys.keys || []).includes(did))?.number ?? null;
      }
      return { owner, dids: [...latest.keys.keys], threshold: latest.keys.threshold, versions };
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

Setting up a key wallet
-----------------------

An owner whose current key is on one computer only, in the key store of
`osheaf` (`~/.config/opensheaf/keys/OWNER/K.key`, or the system's
credential store), sets up its key wallet from the Manager in three
steps, each the work of a command of chapter [37](37-owner-commands.md),
with the same files, so that `osheaf key pull`, `key list`, `key enroll`
and `key unlock` of either program take what the page wrote, and the
page what they wrote:

1. the wallet: a private repository the person creates on GitHub and
   installs the OpenSheaf app on; the page checks that it can be read and
   written, that it is private, and that it is not the archive's
   repository, as `osheaf key push` checks it;
2. the current key, as `osheaf key push`: the person gives the key file
   of the key store (one line, the seed in base64) or the text of `osheaf
   key export` in clear; it must be a current key of the owner that the
   latest version of its key log lists. It is locked with the passphrase,
   asked twice, or once when the wallet holds keys of the owner locked
   already, and then checked to open one of them, as
   `osheaf key push` asks it; a key that the wallet holds already is left
   as it is. The seed is wiped once the file is written;
3. the passkey, as `osheaf key enroll`: every key of the owner locked
   with a passphrase is opened with it first; a new passkey is created by
   the popup of the unlock page in the mode `popup-enroll` (chapter
   [36](36-passkeys.md)) when none of the owner's keys opens with a
   passkey yet, or else the passkey already enrolled is used, through the
   popup in the mode `popup`, for the keys it does not open yet; each of
   those keys gets one more wrap, checked to open with the passkey alone,
   written and read back.

`osheaf key enroll` asks a new passkey once more, to check that it gives
the same secret twice; the page does not (the unlock page derives the
secret with an assertion, as an unlock does, and each wrap is checked to
open with it).

The wallet is a `GitHubWallet` of chapter [35](35-wallets.md) with the
page's `fetch` and token. Its check here asks one more thing than
`osheaf key push` does: that the sign-in may write to it (the page's
token is that of the GitHub app, whose installation must include the
wallet).

    // in setting up a key wallet:
    export async function checkWallet(wallet) {
      wallet.checkName();
      const info = await wallet.api('GET', `repos/${wallet.repo}`);
      if (info === null) {
        throw new WalletError(`no repository ${wallet.repo} that this sign-in can reach: create it, private, and install ` +
                              'the OpenSheaf app on it');
      }
      if (info.private !== true || info.visibility !== 'private') {
        throw new WalletError(`${wallet.repo} is not a private repository: a wallet must be private`);
      }
      if (wallet.forbidden.has(String(info.full_name ?? wallet.repo).toLowerCase())) {
        throw new WalletError(`${wallet.repo} is a repository of the archive, which is public: a wallet is a repository of its own`);
      }
      if (info.permissions && info.permissions.push !== true) {
        throw new WalletError(`this sign-in cannot write to ${wallet.repo}`);
      }
      wallet.checked = true;
      return info;
    }

What the wallet holds of the owner: each key file, by its key's name.

    // in setting up a key wallet:
    export async function walletEntries(wallet, owner) {
      const out = [];
      for (const [o, kid] of await wallet.entries(owner)) {
        const text = await readAny(wallet, o, kid);
        if (text) out.push({ kid, text, fields: describeEntry(text) });
      }
      return out;
    }

The passphrase: asked twice when no key of the owner in the wallet is
locked yet, once otherwise, and then checked against the first of them
(`walletPassphrase` of chapter [37](37-owner-commands.md)).

    // in setting up a key wallet:
    export function passphraseConfirmed(entries) {
      return !entries.some((e) => wrapsOf(e.text).length);
    }

    export async function checkPassphrase(entries, passphrase, owner, walletName) {
      const locked = entries.filter((e) => wrapsOf(e.text).length);
      if (!locked.length) return;
      try {
        await readKey(locked[0].text, passphrase);
      } catch (error) {
        if (error instanceof KeyError) {
          throw new WalletError(`${error.message}: this is not the passphrase of the keys of ${owner} in ${walletName}`);
        }
        throw error;
      }
    }

The key given: the line of a key store, of the archive's owner, or the
text of `osheaf key export`, which names its owner; a current key of the
latest version of the key log in either case. Its seed is wiped if it is
refused.

    // in setting up a key wallet:
    export async function keyToPush(text, { owner, dids }) {
      const line = String(text ?? '').trim();
      let key, of = owner;
      if (/^[A-Za-z0-9+/]{43}=$/.test(line)) {
        key = await Key.fromSeed(unbase64(line));
      } else {
        let rk;
        try {
          rk = await readKey(String(text ?? ''));
        } catch (error) {
          if (error instanceof PassphraseNeeded) {
            throw new KeyError('this key is locked with a passphrase: give the key file of osheaf\'s key store, or the ' +
                               'text of osheaf key export without --encrypt');
          }
          if (error instanceof KeyError) {
            throw new KeyError(`not a key file of osheaf (${error.message}): give the file OWNER/K.key of its key store, ` +
                               'or the text of osheaf key export');
          }
          throw error;
        }
        if (rk.kind !== CURRENT) {
          rk.key.seed?.fill(0);
          throw new KeyError(`this is a ${rk.kind} key: only a current key is put in the wallet here`);
        }
        key = rk.key;
        of = rk.owner;
      }
      if (of !== owner || !dids.includes(key.did)) {
        key.seed.fill(0);
        throw new KeyError(of !== owner ? `this key is of the owner ${of}, not of the archive's owner ${owner}`
          : `${key.did} is not a current key of the latest version of the owner's key log`);
      }
      return key;
    }

The key put in the wallet as `osheaf key push` puts it, unless it is
there already; whether it was put.

    // in setting up a key wallet:
    export async function pushKey(wallet, owner, key, version, passphrase, { cost = {} } = {}) {
      if ((await wallet.read(owner, key.id, CURRENT)) !== null) return false;
      await putKey(wallet, owner, key, CURRENT, version, passphrase, [], cost);
      return true;
    }

What enrolling does, before any passkey is asked: the keys locked with a
passphrase; the passkeys of this owner (its PRF salt, the relying party
of the unlock page) that open some of them; whether a new passkey is
made; and the keys that get a wrap.

    // in setting up a key wallet:
    const encrypted = (text) => text.split(/\r\n|\r|\n/).some((x) => {
      const p = x.split(/\s+/).filter(Boolean);
      return x.startsWith('encryption ') && p[1] !== 'none';
    });

    export async function enrollPlan(wallet, owner, { newPasskey = false, entries = null } = {}) {
      entries = (entries || await walletEntries(wallet, owner)).filter((e) => encrypted(e.text));
      if (!entries.length) throw new WalletError(`the wallet ${wallet.name} holds no key of ${owner} locked with a passphrase`);
      const salt = await passkeySalt(owner);
      const ours = (text) => passkeysOf(text).filter((p) => sameBytes(p.salt, salt) && p.rp === PASSKEY_RP).map((p) => p.cred);
      const known = [...new Set(entries.flatMap((e) => ours(e.text)))];
      const fresh = Boolean(newPasskey) || !known.length;
      const todo = fresh ? entries : entries.filter((e) => !passkeysOf(e.text).some((p) => known.includes(p.cred)));
      return { owner, salt, entries, known, fresh, todo };
    }

Every key to change is opened with the passphrase first, so that a wrong
passphrase changes nothing; then the passkey's secret is taken, and the
wraps added. A passkey enrolled already must open a key it is enrolled
for.

    // in setting up a key wallet:
    export async function openWithPassphrase(plan, passphrase, walletName) {
      for (const e of plan.todo) {
        try {
          await readKey(e.text, passphrase);
        } catch (error) {
          if (error instanceof KeyError) throw new WalletError(`${walletName} ${e.kid}: ${error.message}: nothing was changed`);
          throw error;
        }
      }
    }

    export async function enrollPasskey(wallet, plan, passphrase, cred, prf, { cost = {}, progress = () => {} } = {}) {
      if (plan.fresh && plan.known.includes(cred)) throw new WalletError('the page sent no new passkey: nothing was changed');
      const kek = await passkeyKek(prf);
      try {
        if (!plan.fresh) {
          let opens = false;
          for (const e of plan.entries) {
            if (!passkeysOf(e.text).some((p) => p.cred === cred)) continue;
            try {
              await readKey(e.text, null, { [cred]: kek });
              opens = true;
              break;
            } catch (error) {
              if (!(error instanceof KeyError)) throw error;
            }
          }
          if (!opens) throw new WalletError('the passkey used does not open the keys it is enrolled for: nothing was changed');
        }
        const passkey = new Passkey(cred, plan.salt, { kek });
        const done = [];
        for (const e of plan.todo) {
          done.push(await addPasskey(wallet, plan.owner, e.kid, passphrase, passkey, cost));
          progress(done.length, plan.todo.length);
        }
        return done;
      } finally {
        kek.fill(0);
      }
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
