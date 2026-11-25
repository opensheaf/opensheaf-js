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

It also sets up a new archive, the owner included: the owner's keys and
key log made in the page as `osheaf init --new-owner --key DID` makes
them, the archive set up as the template's setup sets it up, and the key
of the archive's workflows stored as a secret of the repository (below,
"The owner, made in the page").

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
             CURRENT, ROTATION, newKey, readRotationKey, rotationKeyText, rotationFileName, rotationKeySheet,
             sheetCheck } from '../core/keys.js';
    import { describeEntry, putKey, addPasskey, readAny, WalletError, hints, ownersHeld } from '../core/wallets.js';
    import { keyWallet } from '../core/owner.js';
    import { sameBytes, unbase64 } from '../core/crypto.js';
    import { oneCommit } from '../core/github.js';
    import { carryOut } from '../core/requests.js';
    import { rotate, loadKeyLog, OwnerError } from '../core/keylogs.js';
    import { objectId, keeperValid } from '../core/names.js';
    import { writeKeyLog, newOwner } from '../core/write.js';
    import { MemoryStorage } from '../core/storage.js';
    import { base64 } from '../core/keys.js';
    import { writeDiscovery } from '../core/discovery.js';
    import { readableIndex, hasWebsite } from '../core/website.js';
    import { verifyFolder } from '../core/check.js';
    import { short, plural, Stop } from '../core/folder.js';

    export { GitHub, GitHubStorage, GitHubError, CommitConflict, RateLimited, oneCommit, gitBlobSha, GITHUB_API } from '../core/github.js';
    export { carryOut, Problem, OPERATIONS, WORKFLOW_ONLY, NEW_PAPER, NEW_VERSION, ownLineOf } from '../core/requests.js';
    export { popupUrl, popupRequest, openPopupAnswer, openPopupAnswers, MAX_POPUP_OWNERS, sameCode, confirmationCode, POPUP, POPUP_ENROLL, POPUP_MESSAGES,
             UNLOCK_ORIGIN, UnlockFailed } from '../core/passkey.js';
    export { Key, readKey, KeyError, PASSKEY_RP, CURRENT, ROTATION, newKey, sheetCheck } from '../core/keys.js';
    export { GitHubWallet, WalletError, hints as walletHints, ownersHeld } from '../core/wallets.js';
    export { OwnerError } from '../core/keylogs.js';
    export { ArchiveFolder, Stop } from '../core/folder.js';
    export { verifyFolder } from '../core/check.js';

    <<the environment of a page>>

    <<the keys that sign>>

    <<setting up a key wallet>>

    <<the wallets of an owner>>

    <<a new current key, made in the page>>

    <<the owner, made in the page>>

    <<a secret for the workflows>>

    <<a request written directly>>

The environment of a page
-------------------------

The environment of the core (chapter [23](23-folder.md)) in a page: no
terminal (what the commands say is collected by `carryOut`), no new keys
for the commands (the new current key of the setup of a wallet is made
by its own functions, below), no passphrase, no folder to export to; the current keys that the page
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

The current keys of an owner that may sign now (the archive's default
owner, or another owner it hosts): those of the latest version of its key
log, which a version needs `threshold` of;
and, for each, the first version of the log that lists it, which a key
file of a wallet records (`version`, as `osheaf key push` writes it).
With them, what a new version of the key log needs (section 6.2): the
number of the latest version, the digests of the rotation keys it commits
(`next`), and how many of them sign the next one (`nextThreshold`).

    // in the keys that sign:
    export async function signers(storage, env, owner = null) {
      const f = await ArchiveFolder.open(storage, env);
      owner ||= f.archive.owner;
      const log = await f.keyLog(owner);
      const latest = log?.latest();
      if (!latest) return { owner, dids: [], threshold: 0, versions: {}, number: null, next: [], nextThreshold: 0 };
      const versions = {};
      for (const did of latest.keys.keys) {
        versions[did] = log.side().find((v) => v.keys && (v.keys.keys || []).includes(did))?.number ?? null;
      }
      return { owner, dids: [...latest.keys.keys], threshold: latest.keys.threshold, versions, number: latest.number,
               next: [...(latest.keys.next || [])], nextThreshold: latest.keys.nextThreshold ?? 0 };
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

The wallets of an owner
-----------------------

Wallets and owners are many to many (chapter [35](35-wallets.md)): a
wallet may hold the keys of several owners, several people may share one
owner's keys in it, each with a passkey of their own, and an owner's keys
may be in several wallets. A page chooses a wallet, then the owners in it.
Three functions serve it:

- `walletCandidates(settings, owner, given)`: the wallets in which the
  keys of `owner` are looked for, in order: `given`, the person's own list
  (kept by the page), then those the archive's `osheaf.json` hints for it
  (`keys`, GitHub wallets only, the owner's entry), each once, as `osheaf`
  orders them (chapter [35](35-wallets.md)): `osheaf.json` is written by
  whoever can change the archive, and a hint of it must not decide where
  the owner's keys go;
- `ownersHeld(wallet)` (chapter [35](35-wallets.md)): the owners whose
  keys a wallet holds, `[owner, number of keys, locks in words]`;
- `holdingWallet(wallets, owner)`: the first of `wallets` (`GitHubWallet`
  objects) that holds keys of `owner`, one that cannot be read passed
  over, or null.

`directRecordWallet` records a wallet as a hint for an owner in the
archive's `osheaf.json`, as `osheaf key wallet --owner OWNER --add
WALLET` does, in one commit; when the archive hints it already, nothing
is committed (`recorded` false).

    // in the wallets of an owner:
    export function walletCandidates(settings, owner, given = []) {
      const out = [];
      for (const w of [...given, ...hints(settings?.keys, owner)]) {
        if (typeof w === 'string' && /^github:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(w) && !out.includes(w)) out.push(w);
      }
      return out;
    }

    export async function holdingWallet(wallets, owner) {
      for (const w of wallets) {
        try {
          if ((await w.entries(owner)).length) return w;
        } catch (error) {
          if (!(error instanceof WalletError)) throw error;
        }
      }
      return null;
    }

    export async function directRecordWallet({ repo, github, env, owner, wallet, mirror = null, cache = new Map(),
                                               origin = 'the OpenSheaf manager', attempts = 3 }) {
      const said = [];
      const quiet = { ...env, out: (l) => said.push(l), err: (l) => said.push(l) };
      const done = await oneCommit(repo, github, async (storage) => {
        said.length = 0;
        const f = await ArchiveFolder.open(storage, quiet);
        try {
          await keyWallet(f, { owner, add: wallet }, quiet);
        } catch (error) {
          if (error instanceof Stop) throw new OwnerError(error.message);
          throw error;
        }
        const recorded = said.some((l) => l.startsWith('Done: '));
        return { message: recorded ? `Key wallet ${wallet} hinted for ${short(owner)} in osheaf.json (${origin})\n` : null,
                 recorded };
      }, { mirror, cache, attempts });
      return { recorded: Boolean(done.recorded), commit: done.commit || null, said };
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
   as it is. The seed is wiped once the file is written. Or, when the
   key is not at hand, a new current key is made in the page and added
   to the key log, signed by rotation keys (below);
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
made; and the keys that get a wrap. A person who keeps the keys of
several owners in one wallet may use one passkey for all of them, so that
one touch unlocks two owners at once (chapter [36](36-passkeys.md)): with
`borrowed`, the passkeys that open the keys of another owner of the
wallet, an owner none of whose passkeys is known yet is enrolled with one
of those (its own salt, the same credential), not with a new one.

    // in setting up a key wallet:
    const encrypted = (text) => text.split(/\r\n|\r|\n/).some((x) => {
      const p = x.split(/\s+/).filter(Boolean);
      return x.startsWith('encryption ') && p[1] !== 'none';
    });

    export async function enrollPlan(wallet, owner, { newPasskey = false, entries = null, borrowed = [] } = {}) {
      entries = (entries || await walletEntries(wallet, owner)).filter((e) => encrypted(e.text));
      if (!entries.length) throw new WalletError(`the wallet ${wallet.name} holds no key of ${owner} locked with a passphrase`);
      const salt = await passkeySalt(owner);
      const ours = (text) => passkeysOf(text).filter((p) => sameBytes(p.salt, salt) && p.rp === PASSKEY_RP).map((p) => p.cred);
      let known = [...new Set(entries.flatMap((e) => ours(e.text)))];
      const borrow = !newPasskey && !known.length && borrowed.length > 0;
      if (borrow) known = [...new Set(borrowed)];
      const fresh = Boolean(newPasskey) || !known.length;
      const todo = fresh || borrow ? entries : entries.filter((e) => !passkeysOf(e.text).some((p) => known.includes(p.cred)));
      return { owner, salt, entries, known, fresh, todo, borrowed: borrow };
    }

Every key to change is opened with the passphrase first, so that a wrong
passphrase changes nothing; then the passkey's secret is taken, and the
wraps added. A passkey enrolled already must open a key it is enrolled
for; a passkey borrowed from another owner opens none of this owner's
keys yet, and its secret, for this owner's salt, is checked by nothing
but the popup's answer (the credential is one of those asked for).

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
        if (!plan.fresh && !plan.borrowed) {
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

A new current key, made in the page
-----------------------------------

An owner whose current key is not at hand (it is on another computer, or
was lost) may make a new one in the page instead of giving a key file in
step 2: the page makes the key, adds it to the current keys of the owner
by a new version of the key log, as `osheaf owner rotate --add DID` does
(section 6.2), commits that version to the archive, and puts the key in
the wallet as `osheaf key push` puts it. The new version keeps the
current keys and the threshold of the latest one, and commits new
rotation keys, as many as the latest version commits, with the same
`nextThreshold`; it is signed by `nextThreshold` of the rotation keys the
latest version commits, which the person gives:

- as the files `osheaf init --export` or `osheaf owner rotate --export`
  wrote (`rotation-OWNER-K.txt`, locked with the passphrase or not; a
  typed sheet of `--print` too). The new rotation keys are then given
  back the same way: one file each, with the names and the text `osheaf`
  writes, locked with the passphrase, and the sheets of `--print`; the
  new version is committed only once the person has typed the check of
  each file, as `osheaf owner rotate --export` asks;
- or from the wallet, when it keeps the rotation keys (the security level
  `--keys github:OWNER/REPO`): they are opened with the passphrase, and
  the new ones are put there, locked with it, before the key log is
  written, as `osheaf owner rotate --keys github:OWNER/REPO` does.

The rotation keys pass through the page's memory, as they pass through
`osheaf`'s on a computer; the maximum security level keeps them offline,
used by `osheaf` alone. The seeds are wiped once used: the rotation keys
that sign are kept as WebCrypto keys that cannot be exported, the new
ones once their files are written (or once they are in the wallet), the
new current key once it is in the wallet.

The rotation keys the wallet keeps that the latest version commits: their
digests.

    // in a new current key, made in the page:
    export function walletRotationKeys(entries, next) {
      return entries.filter((e) => e.fields.kind === ROTATION && next.includes(e.fields.digest)).map((e) => e.fields.digest);
    }

A rotation key given, read and checked: of the owner, committed by the
latest version (one used up, or of another version, is refused), and
sealed. The keys given are each counted once, and must be as many as
sign the next version.

    // in a new current key, made in the page:
    async function signing(rk, { owner, number, next }, where) {
      if ((rk.owner !== null && rk.owner !== owner) || rk.kind !== ROTATION || !next.includes(rk.key.digest)) {
        rk.key.seed?.fill(0);
        throw new KeyError(rk.owner !== null && rk.owner !== owner ? `${where} is a rotation key of ${short(rk.owner)}, not of ${short(owner)}`
          : rk.kind !== ROTATION ? `${where} is a ${rk.kind} key, not a rotation key`
          : `${where}: ${rk.key.did} is not a rotation key that v${number} of the key log commits (used up already, or of another version)`);
      }
      return sealedKey(rk.key);
    }

    function enough(keys, { number, nextThreshold }, where) {
      if (keys.length < nextThreshold) {
        throw new KeyError(`${where} ${plural(keys.length, 'rotation key')} of v${number} of the key log, and ` +
                           `${nextThreshold} sign the next version`);
      }
      return keys;
    }

    export async function rotationKeysFromTexts(files, plan, passphrase = null) {
      const out = [];
      for (const { name, text } of files) {
        let rk;
        try {
          try {
            rk = await readRotationKey(text);
          } catch (error) {
            if (!(error instanceof PassphraseNeeded)) throw error;
            if (!passphrase) throw new KeyError('it is locked with a passphrase: give the passphrase');
            rk = await readRotationKey(text, passphrase);
          }
        } catch (error) {
          if (error instanceof KeyError) throw new KeyError(`${name}: ${error.message}`);
          throw error;
        }
        if (out.some((k) => k.did === rk.key.did)) {
          rk.key.seed?.fill(0);
          continue;
        }
        out.push(await signing(rk, plan, name));
      }
      return enough(out, plan, 'given:');
    }

    export async function rotationKeysFromWallet(wallet, plan, passphrase) {
      const out = [];
      for (const digest of plan.next) {
        const kid = digest.slice(0, 16);
        const text = await wallet.read(plan.owner, kid, ROTATION);
        if (!text) continue;
        let rk;
        try {
          rk = await readKey(text, passphrase);
        } catch (error) {
          if (error instanceof KeyError) throw new WalletError(`${wallet.name} ${plan.owner}/${kid}: ${error.message}`);
          throw error;
        }
        out.push(await signing(rk, plan, `${wallet.name} ${plan.owner}/${kid}`));
        if (out.length === plan.nextThreshold) break;
      }
      return enough(out, plan, `the wallet ${wallet.name} holds`);
    }

The keys made: the current key, and the new rotation keys. For files,
each is written as `osheaf owner rotate --export` writes it, for the
version the key log will have, locked with the passphrase, and read back;
with its name, its check, and its sheet. The seeds of the rotation keys
are then wiped: the key log needs only their digests.

    // in a new current key, made in the page:
    export async function newKeys(plan) {
      const rotation = [];
      for (let k = 0; k < plan.next.length; k++) rotation.push(await newKey());
      return { current: await newKey(), rotation };
    }

    export async function rotationFiles(keys, owner, version, passphrase, { cost = {} } = {}) {
      const files = [];
      for (const key of keys) {
        const name = rotationFileName(owner, key);
        const text = await rotationKeyText(key, owner, version, passphrase, cost);
        if ((await readRotationKey(text, passphrase)).key.did !== key.did) throw new KeyError(`${name} does not read back`);
        files.push({ name, did: key.did, digest: key.digest, text, check: await sheetCheck(key.seed),
                     sheet: await rotationKeySheet(key, owner, version) });
      }
      for (const key of keys) key.seed.fill(0);
      return files;
    }

    export function checksConfirmed(files, typed) {
      return files.every((f, k) => String(typed[k] ?? '').trim().toUpperCase() === f.check);
    }

For the wallet, the new rotation keys are put there before the key log
is written, as `osheaf owner rotate --keys` puts them; if one cannot be
put, nothing is written to the key log.

    // in a new current key, made in the page:
    export async function keepRotationKeys(wallet, owner, keys, version, passphrase, { cost = {} } = {}) {
      try {
        for (const key of keys) await putKey(wallet, owner, key, ROTATION, version, passphrase, [], cost);
      } catch (error) {
        if (error instanceof WalletError || error instanceof KeyError) {
          throw new WalletError(`${error.message}: nothing was written to the key log`);
        }
        throw error;
      }
      for (const key of keys) key.seed.fill(0);
    }

The new version of the key log, as `osheaf owner rotate --add DID` makes
it: the latest version must be the one the keys were read for (if the
key log changed meanwhile, nothing is written); the current key added,
the rotation keys committed by their digests, the message `Keys changed`,
the depositor of the archive and the time given; then the key log and the
discovery document written. `created` is given by the tests, which make
the same version with opensheaf-py.

    // in a new current key, made in the page:
    export const NEW_KEY_MESSAGE = 'Keys changed';

    export async function rotateAdding(storage, env, plan, signers, { add, next, created = null }) {
      const f = await ArchiveFolder.open(storage, env);
      const owner = f.archive.owner;
      const dir = await f.dirOf(objectId(owner, owner));
      if (owner !== plan.owner || (await storage.kind(`${dir}/inventory.json`)) !== 'file') {
        throw new OwnerError(`the key log of ${short(plan.owner)} is not in the storage root`);
      }
      const log = await loadKeyLog(storage, dir);
      const prev = log.latest();
      if (!prev) throw new OwnerError(`the owner ${short(owner)} has ended (section 6.3): its key log takes no new version`);
      if (prev.number !== plan.number) {
        throw new OwnerError(`the key log of ${short(owner)} changed meanwhile (v${prev.number}, not v${plan.number}): ` +
                             'nothing was written; start again');
      }
      const v = await rotate(log, signers, { nextKeys: next, nextThreshold: Math.min(prev.keys.nextThreshold, next.length),
                                             add: [add], message: NEW_KEY_MESSAGE, user: f.depositor(),
                                             created: created || env.now() });
      await writeKeyLog(storage, dir, log);
      f.changed();
      await writeDiscovery(f);
      return { owner, number: v.number, dids: [...v.keys.keys], threshold: v.keys.threshold };
    }

Committed as a request is (below): on the head of the archive's branch,
read through the same prefetch, verified before the commit (the content
of papers trusted to match its inventories), one commit; if the branch
moved meanwhile, the version is made again on the new head, refused if
the key log moved. Gives the new version, with the commit.

    // in a new current key, made in the page:
    export async function directRotate({ repo, github, env, schemas, plan, signers, add, next, created = null,
                                         mirror = null, cache = new Map(), origin = 'the OpenSheaf manager',
                                         progress = () => {}, attempts = 3 }) {
      created ||= env.now();
      const done = await oneCommit(repo, github, async (storage) => {
        progress('carrying out');
        let v;
        try {
          v = await rotateAdding(storage, env, plan, signers, { add, next, created });
        } catch (error) {
          if (error instanceof Stop) throw new OwnerError(error.message);
          throw error;
        }
        if (schemas) {
          const report = await verifyFolder(storage, { schemas, digests: false, fetch: env.fetch, fetchJson: env.fetchJson });
          if (report.counts().error) {
            const errors = report.findings.filter((x) => x.level === 'error').map((x) => `${x.place}: ${x.message}`);
            throw new OwnerError(`the archive would not verify: ${errors.slice(0, 5).join('; ')}`);
          }
        }
        progress('committing');
        const message = `Keys changed: v${v.number} of the key log of ${short(v.owner)}, a new current key ` +
          `${short(add)} (${origin})\n\n` + v.dids.map((d) => `current key ${d}\n`).join('');
        return { message, version: v };
      }, { mirror, cache, attempts, prepare: async (storage) => {
        progress('reading');
        await storage.prefetch({ skip: (p, size) => !prefetched(p, size), concurrency: 12 });
      } });
      return { ...done.version, commit: done.commit };
    }

The owner, made in the page
---------------------------

A repository made from the archive template and not set up yet is set up
from the Manager, the owner included, as the key ceremony of the
template's README sets it up on a computer, with the same files: the
owner made as `osheaf init --new-owner --key DID` makes it (`DID` the
current key of the archive's workflows, as the README's ceremony makes it
with `osheaf key new`), then the archive as the template's setup makes it
with that owner (chapter [48](48-requests.md)). The page makes:

- the owner's current key, which signs in the page and is put in the key
  wallet, as `osheaf key push` puts it;
- the current key of the archive's workflows, unless the person does not
  want the workflows to sign (then the archive is kept from the page or
  the command line only); it is stored as the repository secret
  `OPENSHEAF_SIGNING_KEY` (below), and nowhere else;
- the rotation keys, three, two of which sign the next version of the key
  log, as `osheaf`'s default: written as the files of `osheaf init
  --export`, locked with the passphrase, with their sheets, and confirmed
  by their checks typed back before anything is committed; or kept in the
  wallet, locked with the passphrase, a lower security level (`osheaf
  init --keys github:OWNER/REPO`), put there before anything is
  committed.

The first version of the key log lists both current keys, the owner's
first, with threshold 1, so that either signs; the rotation keys are
committed by their digests. `created` and `nonce` are given by the tests,
which make the same key log with opensheaf-py.

    // in the owner, made in the page:
    export const ROTATION_KEYS = 3;

    export async function newOwnerKeys({ workflows = true, rotation = ROTATION_KEYS } = {}) {
      const keys = { current: await newKey(), workflows: workflows ? await newKey() : null, rotation: [] };
      for (let k = 0; k < rotation; k++) keys.rotation.push(await newKey());
      return keys;
    }

    export async function ownerKeyLog(keys, { keeper = null, created = null, nonce = null } = {}) {
      if (keeper && !keeperValid(keeper, true)) {
        throw new OwnerError(`a keeper is an ORCID iD (with its check digit) or https://<domain>/: ${keeper}`);
      }
      return newOwner([keys.current, ...(keys.workflows ? [keys.workflows] : [])], keys.rotation,
                      { threshold: 1, nextThreshold: Math.floor(keys.rotation.length / 2) + 1, keeper: keeper || null,
                        created, nonce });
    }

The key log as the folder of its owner object, in memory: what the setup
copies into the storage root, as the template's setup copies `key-log/`.

    // in the owner, made in the page:
    export async function keyLogFolder(log) {
      const storage = new MemoryStorage();
      await writeKeyLog(storage, '', log);
      return { storage, dir: '', where: `the key log of ${short(log.owner)} made in the page` };
    }

The current key that signs in the page, kept unexportable, from a copy of
the seed: the seed itself is kept until the key is in the wallet.

    // in the owner, made in the page:
    export async function signingCopy(key) {
      return sealedKey(await Key.fromSeed(Uint8Array.from(key.seed)));
    }

The archive set up, committed as a request is (below), on the head of the
archive's branch: the setup of chapter [48](48-requests.md) with this key
log, `defaultBase` giving the base URL when the form leaves it empty.

    // in the owner, made in the page:
    export async function directSetup({ repo, github, fields, keyLog, defaultBase = null, ownerLabel = '', env, schemas,
                                        mirror = null, cache = new Map(), origin = 'the OpenSheaf manager',
                                        progress = () => {}, attempts = 3 }) {
      const owner = ownerLabel ? (await keyLog.storage.read(`${keyLog.dir ? keyLog.dir + '/' : ''}inventory.json`)) : null;
      const after = ownerLabel ? async (storage) => {
        const id = JSON.parse(new TextDecoder().decode(owner)).id;
        await labelOwner(storage, env, id.split(':')[1], ownerLabel);
      } : null;
      return directWrite({ repo, github, operation: 'setup', fields, env, schemas, mirror, cache, origin, progress, attempts,
                           options: { keyLog, defaultBase }, after });
    }

A label for the owner in the archive (section 3.1: an archive may label
any line it lists, owner objects included), given when the archive is set
up: written in the discovery document as the labels of documents and
collections are, and kept there by every later command of either program,
which take the labels of the discovery document as they find them; the
indexes and the website are written again. `osheaf` has no command that
labels an owner object; the label is the archive's, not signed by the
owner. It is checked as a label of a collection is (at most 64
characters here), and must not be taken.

    // in the owner, made in the page:
    const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

    export function ownerLabelProblem(label) {
      if (!LABEL.test(label) || label.length > 64) {
        return `\`${label}\` is not a valid label: at most 64 characters, lower-case letters and digits, words joined by \`-\``;
      }
      return null;
    }

    export async function labelOwner(storage, env, owner, label) {
      const problem = ownerLabelProblem(label);
      if (problem) throw new OwnerError(problem);
      const f = await ArchiveFolder.open(storage, env);
      const id = objectId(owner, owner);
      const taken = f.labels.get(label);
      if (taken && taken !== id) {
        throw new OwnerError(`\`${label}\` is already taken in this archive`);
      }
      for (const [l, i] of [...f.labels]) if (i === id) f.labels.delete(l);
      f.labels.set(label, id);
      await writeDiscovery(f);
      if (hasWebsite(f)) await readableIndex(f);
    }

A secret for the workflows
--------------------------

The current key of the workflows is the line that `OPENSHEAF_SIGNING_KEY`
holds, as the README's ceremony stores it: the seed, in base64. GitHub
takes a repository secret sealed to the repository's public key (its
X25519 key, `actions/secrets/public-key`), as libsodium's
`crypto_box_seal` seals it: an ephemeral key pair; the nonce, the BLAKE2b
digest of 24 bytes of the ephemeral public key and the recipient's; the
message boxed (`crypto_box`, X25519, XSalsa20 and Poly1305) with the
ephemeral secret key; and the ephemeral public key followed by the box.
The ephemeral secret key is drawn with `crypto.getRandomValues` (tweetnacl
finds no source of random bytes of its own in the bundle under Node).
The tests open it with PyNaCl's `SealedBox`.

    // in a secret for the workflows:
    export function seedLine(key) {
      return base64(key.seed);
    }

    export async function sealedBox(message, publicKey) {
      const nacl = (await import('tweetnacl')).default;
      const { createBLAKE2b } = await import('hash-wasm');
      if (publicKey.length !== nacl.box.publicKeyLength) throw new KeyError('not an X25519 public key');
      const drawn = crypto.getRandomValues(new Uint8Array(nacl.box.secretKeyLength));
      const pair = nacl.box.keyPair.fromSecretKey(drawn);
      drawn.fill(0);
      const h = await createBLAKE2b(nacl.box.nonceLength * 8);
      h.init();
      h.update(pair.publicKey);
      h.update(publicKey);
      const nonce = h.digest('binary');
      const boxed = nacl.box(message, nonce, publicKey, pair.secretKey);
      pair.secretKey.fill(0);
      const out = new Uint8Array(pair.publicKey.length + boxed.length);
      out.set(pair.publicKey);
      out.set(boxed, pair.publicKey.length);
      return out;
    }

Opened again, as `crypto_box_seal_open` opens it, with the recipient's
key pair: what the tests do with the double of GitHub's secrets.

    // in a secret for the workflows:
    export async function openSealedBox(sealed, publicKey, secretKey) {
      const nacl = (await import('tweetnacl')).default;
      const { createBLAKE2b } = await import('hash-wasm');
      const epk = sealed.slice(0, nacl.box.publicKeyLength);
      const h = await createBLAKE2b(nacl.box.nonceLength * 8);
      h.init();
      h.update(epk);
      h.update(publicKey);
      const opened = nacl.box.open(sealed.slice(epk.length), h.digest('binary'), epk, secretKey);
      if (!opened) throw new KeyError('the sealed box does not open with this key');
      return opened;
    }

The secret stored with GitHub's API (`PUT
repos/OWNER/REPO/actions/secrets/NAME`, the value sealed, with the
identifier of the key it is sealed to); the sign-in needs the repository
permission *Secrets: read and write*. A refusal is a `GitHubError` with
GitHub's status (403 when the permission is not granted). The value's
bytes are wiped once sealed.

    // in a secret for the workflows:
    export const SIGNING_SECRET = 'OPENSHEAF_SIGNING_KEY';

    export async function storeSecret(github, repo, name, value) {
      const pk = await github.request('GET', `repos/${repo}/actions/secrets/public-key`);
      const bytes = new TextEncoder().encode(value);
      let sealed;
      try {
        sealed = await sealedBox(bytes, unbase64(pk.key));
      } finally {
        bytes.fill(0);
      }
      await github.request('PUT', `repos/${repo}/actions/secrets/${name}`, { encrypted_value: base64(sealed), key_id: pk.key_id });
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

`after(storage)`, given for the setup, changes the storage once the
request is carried out (the owner's label, above), which is then verified
again. `progress(phase)` is told `reading`, `carrying out` and `committing`.
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
                                        progress = () => {}, attempts = 3, options = {}, after = null }) {
      const done = await oneCommit(repo, github, async (storage) => {
        progress('carrying out');
        const answer = await carryOut(storage, env, operation, fields, files, { origin, schemas, digests: false, ...options });
        if (answer.ok && after) {
          await after(storage);
          if (schemas) {
            const report = await verifyFolder(storage, { schemas, digests: false, fetch: env.fetch, fetchJson: env.fetchJson });
            if (report.counts().error) {
              throw new OwnerError(`the archive would not verify: ${report.findings.filter((x) => x.level === 'error')
                .slice(0, 5).map((x) => `${x.place}: ${x.message}`).join('; ')}`);
            }
          }
        }
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
