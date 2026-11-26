The commands of owners and keys
===============================

The commands that keep an owner and its keys, as opensheaf-py's chapter
[19-owner-commands](https://opensheaf.org/opensheaf-py/19-owner-commands.html)
has them, with the same options and the same messages:

- `osheaf owner init` (an owner in an archive that has one already: the
  making of an owner is chapter [27](27-init.md)'s), `owner rotate`,
  `owner expose`, `owner end`, `owner show`, `owner pull URL|PATH`;
- `osheaf sign LABEL --version vN`, which signs again a version contested
  by an exposed key;
- `osheaf key new|push|pull|list|forget|export|import|enroll|unlock`: the
  current keys of this device, the key wallets of chapter
  [35](35-wallets.md), password managers through the clipboard, and
  passkeys through the hand-off of chapter [36](36-passkeys.md).

Keys go where the owner's **security level** says: offline, the default
and the maximum (the rotation keys exported to files, chapter
[27](27-init.md)), or in a wallet. A command that signs a new version of
the key log reads the rotation keys from their files (`--rotation-key
FILE`, a file or a typed sheet) or from the wallet; a command that signs a
line finds the current keys on this device, and else in the wallet
configured.

The outside world comes through the environment (chapter
[23](23-folder.md)), as for every command, with these more:

- `keyStore.forget(owner, did)` removes a current key from this device;
- `passphrase({ confirm, where })` asks once per command, and
  `passphrase.known()` says whether it is given or asked already;
- `wallets`: the user's configuration, `OPENSHEAF_WALLET`, a runner of
  shell commands, GitHub's API, the git remotes of the archive (chapter
  [35](35-wallets.md));
- `passkeys.enroll` and `passkeys.unlock`, the listener of chapter
  [36](36-passkeys.md); `unlockMode`, the value of `OPENSHEAF_UNLOCK`;
  `passphraseGiven`, whether `OPENSHEAF_PASSPHRASE` is set;
- `clipboard.copy`, `paste`, `clearLater` and `clearAfter`; `readText(path)`,
  `readStdin()`, `write(text)` (to the standard output, as it is);
- `asked`, what this command has unlocked: the passkeys that opened keys,
  the owners asked for, those whose passkey failed.

The module is `core/owner.js`.

    // in core/owner.js:
    import { OWNER_NAME, objectId, didKeyPublic, keyId } from './names.js';
    import { sameBytes } from './crypto.js';
    import { readRotationKey, readKey, keyText, rotationKeySheet, sheetCheck, passkeySalt, passkeyKek, passkeysOf,
             removePasskeys, wrapsOf, Passkey, KeyError, PassphraseNeeded, CURRENT, ROTATION, PASSKEY_RP,
             OLD_PASSKEY_RP } from './keys.js';
    import { CONTESTED, fileName as signatureFileName, WITNESSES } from './signatures.js';
    import { signatureFile, sha512hex, writeKeyLog, jsonText } from './write.js';
    import { joinPath, readJson, writeText } from './storage.js';
    import { collect } from './collect.js';
    import { stop, exit, short, plural, ask, CONFIG_NAME, OBJ } from './folder.js';
    import { rotate, end, pull, describeLog, loadKeyLog, checked, completeOrphan, OwnerError } from './keylogs.js';
    import { keeperLink, keeperOf, successorClaim, NOT_CHECKED } from './keepers.js';
    import { WalletError, parseWallet, configuredWallet, archiveRepositories, putKey, getKey, readAny,
             addPasskey as addPasskeyToWallet, listing, locks, describeEntry, risk, CommandWallet, OFFLINE,
             hints, candidateWallets, userWallets, ownersHeld, WALLET, hintedOnly } from './wallets.js';
    import { UnlockFailed } from './passkey.js';
    import { writeDiscovery } from './discovery.js';
    import { exportAndConfirm, keyLabel, rotationLine, ownerInit, SINGLE_ROTATION_RISK } from './init.js';
    import { lineOf } from './describe.js';

    <<the owner a command is about>>

    <<the words of the commands of keys>>

    <<the wallet of a command>>

    <<keys kept in a wallet>>

    <<the rotation keys that sign>>

    <<owner init, in an archive>>

    <<change the keys of an owner>>

    <<end an owner>>

    <<show an owner>>

    <<pull another copy of a key log>>

    <<a new current key>>

    <<push, pull and list>>

    <<passkeys that open keys>>

    <<enroll and unlock>>

    <<a key to and from a password manager>>

    <<forget keys>>

    <<sign again>>

The owner a command is about
----------------------------

The owner named by `--owner`, or the archive's; its key log is read from
the storage root as opensheaf-py reads it, every witness file included
(chapter [34](34-key-logs.md)).

    // in the owner a command is about:
    export async function keyLogOf(f, owner) {
      const dir = await f.dirOf(objectId(owner, owner));
      if ((await f.storage.kind(joinPath(dir, 'inventory.json'))) !== 'file') return null;
      try {
        return await loadKeyLog(f.storage, dir);
      } catch (error) {
        if (error instanceof OwnerError) exit(error.message);
        throw error;
      }
    }

    export async function ownerOf(f, args) {
      if (!f) stop('no archive here (no osheaf.json in this folder or above it): give --root');
      const owner = args.owner || f.archive.owner;
      const log = await keyLogOf(f, owner);
      if (!log) stop(`the key log of ${short(owner)} is not in the storage root`);
      await log.check();
      return [owner, log];
    }

    function keyOwner(f, args) {
      const owner = args.owner || f?.archive.owner;
      if (!owner || !OWNER_NAME.test(owner)) stop('give --owner NAME, or run the command in an archive');
      return owner;
    }

    async function writeLog(f, log) {
      await writeKeyLog(f.storage, await f.dirOf(log.id), log);
      f.changed();
    }

    function checkDid(did) {
      try {
        didKeyPublic(did);
      } catch {
        stop(`not a did:key URI of an Ed25519 key: ${did}`);
      }
    }

    function versionListing(log, did) {
      return log.side().find((v) => v.keys && (v.keys.keys || []).includes(did))?.number ?? null;
    }

    async function currentHere(f, owner, dids) {
      try {
        return await f.env.keyStore.current(owner, dids);
      } catch (error) {
        if (error instanceof KeyError) stop(error.message);
        throw error;
      }
    }

The words of the commands
-------------------------

    // in the words of the commands of keys:
    export function theKeys(n, noun = 'key') {
      return n === 1 ? `the ${noun}` : `the ${n} ${noun}s`;
    }

    export function lockWords(found) {
      const words = [...found.filter((x) => x.startsWith('passkey')), ...found.filter((x) => !x.startsWith('passkey'))]
        .map((x) => `your ${x}`);
      return words.join(' and ') || 'no passphrase or passkey (they have no lock)';
    }

    export function notKeptText(f) {
      return 'No current key is kept on this computer (OPENSHEAF_KEY_STORE=none), so a new one would be lost when the command ends';
    }

    function notKept(w, owner) {
      return `The current keys of ${short(owner)} are not kept on this computer, by choice ` +
        `(OPENSHEAF_KEY_STORE=none): each command that signs opens them in ${w.name}.`;
    }

    async function confirmed(env, word, args = null) {
      if (args?.yes) return true;
      return (await ask(env, `Type ${word} to confirm: `)).trim() === word;
    }

    function walletStop(error) {
      if (error instanceof WalletError || error instanceof KeyError || error instanceof OwnerError) stop(error.message);
      throw error;
    }

The wallet of a command
-----------------------

The security level `--keys` (or `--wallet`): `offline` or nothing is
none; `command` is the command wallet configured; else the wallet named.
A command that reads keys takes the wallet named, or the one configured
for the owner it is about (chapter [35](35-wallets.md)): `owner` null, for
a command about no owner yet, takes the first wallet configured.

    // in the wallet of a command:
    export async function forbiddenRepositories(f) {
      if (!f) return new Set();
      return archiveRepositories(f.env.wallets?.remotes ? await f.env.wallets.remotes() : '', f.archive.baseUrl);
    }

    export async function configured(f, env = f.env, owner = null) {
      try {
        return await configuredWallet(f?.archive.keys, env, { forbidden: await forbiddenRepositories(f), owner });
      } catch (error) {
        return walletStop(error);
      }
    }

    export async function levelWallet(f, args, env = f.env, owner = null) {
      const spec = args.keys || args.wallet || OFFLINE;
      if (spec === OFFLINE) return null;
      try {
        if (spec === 'command') {
          const w = await configured(f, env, owner);
          return w instanceof CommandWallet ? w : parseWallet(spec, env);
        }
        return parseWallet(spec, env, { forbidden: await forbiddenRepositories(f) });
      } catch (error) {
        return walletStop(error);
      }
    }

    async function walletFor(f, args, env, owner = null, { putting = false } = {}) {
      let w = await levelWallet(f, args, env, owner);
      if (!w) {
        w = await configured(f, env, owner);
        if (w && putting && hintedOnly(f?.archive.keys, env, owner, w.name)) {
          env.err(`The key wallet ${w.name} is named by ${CONFIG_NAME} of this archive, which whoever can change ` +
                  'the archive writes, and not by your own configuration: the keys would be put there.');
          if (!(await confirmed(env, 'put', args))) {
            stop(`not confirmed: nothing was put into ${w.name} (give --wallet, or add the wallet to ` +
                 `${env.wallets.userConfigPath()})`);
          }
        }
      }
      if (!w) {
        stop('no key wallet: give --wallet github:OWNER/REPO (or command), or configure one in ' +
             `${env.wallets.userConfigPath()}, or in osheaf.json for the owner ("keys": {"<owner>": {"wallets": [...]}}), ` +
             'or in OPENSHEAF_WALLET');
      }
      return w;
    }

    export function walletConfig(args, owner) {
      const spec = args.keys || '';
      return spec.startsWith('github:') ? { [owner]: { wallets: [spec] } } : null;
    }

A GitHub wallet given to a command that keeps keys in it is recorded in
`osheaf.json` as a hint for the owner, added to those it has, unless it is
one of them (opensheaf-py's `record_wallet`); `hinted` adds or removes one.
`writeConfig` writes `osheaf.json` and the settings of this run.

    // in the wallet of a command:
    export async function writeConfig(f, cfg) {
      await f.writeConfig(cfg);
    }

    export function hinted(cfg, owner, spec, add = true) {
      const given = cfg.keys && typeof cfg.keys === 'object' && !Array.isArray(cfg.keys) ? { ...cfg.keys } : {};
      let own = hints({ [owner]: given[owner] }, owner);
      own = add ? [...own, spec] : own.filter((w) => w !== spec);
      if (own.length) given[owner] = { wallets: own };
      else delete given[owner];
      const out = { ...cfg };
      if (Object.keys(given).length) out.keys = given;
      else delete out.keys;
      return out;
    }

    export async function recordWallet(f, owner, spec) {
      spec = (spec || '').trim();
      if (!f || !spec.startsWith('github:')) return;
      const cfg = await readJson(f.storage, CONFIG_NAME);
      if (!cfg || hints(cfg.keys, owner).includes(spec)) return;
      await writeConfig(f, hinted(cfg, owner, spec));
      f.env.out(`The key wallet ${spec} is recorded in ${CONFIG_NAME} for ${short(owner)} ` +
                `(osheaf key wallet --remove ${spec} removes it).`);
    }

    export function keptWhere(args, w, resolved) {
      return [...(args.export ? [resolved] : []), ...(w ? [w.name] : [])].join(' and in ');
    }

Keys kept in a wallet
---------------------

New rotation keys, and the current keys not there yet, are put in the
wallet, under the passphrase and the passkeys already unlocked in this
command; the risk is said first.

    // in keys kept in a wallet:
    export async function keepInWallet(f, w, owner, rotation, version, args, current = []) {
      const env = f.env;
      env.warn(risk(w.name, owner));
      const unlocked = await unlockedPasskeys(env, owner);
      const secret = unlocked.length ? await walletPassphrase(env, w, owner) : await env.passphrase({ where: w.name });
      try {
        await w.checkWritable();
        const todo = rotation.map((key) => [key, ROTATION, version]);
        for (const [key, v] of current) if ((await w.read(owner, key.id, CURRENT)) === null) todo.push([key, CURRENT, v]);
        const n = todo.length;
        env.err(`Saving ${theKeys(n)} of ${short(owner)} to ${w.name}…`);
        let i = 0;
        for (const [key, kind, v] of todo) {
          const plain = kind === CURRENT && args.plainCurrent;
          await putKey(w, owner, key, kind, v, plain ? null : secret, unlocked, env.cost);
          env.err(`  ${++i}/${n} ${keyLabel(kind, key.did)}  saved`);
        }
      } catch (error) {
        if (error instanceof WalletError || error instanceof KeyError) stop(`${error.message}: nothing was written to the key log`);
        throw error;
      }
      enrollHint(env, owner, unlocked);
    }

The rotation keys that sign
---------------------------

From their files (`--rotation-key`, each read with the passphrase if it is
locked), or from a wallet, as many as the latest version needs: the
wallet named (`--keys`) first, then the one configured, if the first
holds fewer than `nextThreshold` of them (a rotation moving the keys to a
new wallet), and the command says so, as opensheaf-py's
`rotation_signers` reads them (an explicit `--keys` was ignored when a
wallet was configured). `fromWallets` takes the reading of one wallet as
an argument, which the tests replace.

    // in the rotation keys that sign:
    async function rotationKeysFromFiles(f, files, owner) {
      const out = [];
      for (const file of files) {
        let rk;
        try {
          const text = await f.env.readText(file);
          try {
            rk = await readRotationKey(text);
          } catch (error) {
            if (!(error instanceof PassphraseNeeded)) throw error;
            rk = await readRotationKey(text, await f.env.passphrase({ confirm: false }));
          }
        } catch (error) {
          if (error instanceof KeyError || error.code) stop(`${file}: ${error.message}`);
          throw error;
        }
        if (rk.owner !== null && rk.owner !== owner) stop(`${file} is a rotation key of ${short(rk.owner)}, not of ${short(owner)}`);
        out.push(rk.key);
      }
      return out;
    }

    export async function rotationSigners(f, args, owner, prev) {
      const env = f.env;
      if (args.rotationKey?.length) return [await rotationKeysFromFiles(f, args.rotationKey, owner), null];
      const tried = [];
      for (const w of [await levelWallet(f, args, env, owner), await configured(f, env, owner)]) {
        if (w && !tried.some((x) => x.name === w.name)) tried.push(w);
      }
      if (!tried.length) {
        stop('give the rotation keys that sign the new version of the key log (--rotation-key FILE), ' +
             'or the wallet that keeps them (--keys github:OWNER/REPO)');
      }
      return fromWallets(env, tried, owner, prev);
    }

    export async function fromWallets(env, tried, owner, prev, read = walletRotationKeys) {
      const need = prev.keys.nextThreshold;
      let out = [], w = null;
      for (const [k, wallet] of tried.entries()) {
        w = wallet;
        out = await read(env, w, owner, prev);
        if (out.length >= need) {
          env.err(`Read ${plural(out.length, 'rotation key')} of v${prev.number} from ${w.name}.`);
          return [out, w];
        }
        if (k + 1 < tried.length) env.err(`${w.name} holds ${out.length} of them: reading from ${tried[k + 1].name}, the wallet configured`);
      }
      stop(`the wallet ${w.name} holds ${out.length} of the rotation keys of v${prev.number} of the key log of ` +
           `${short(owner)}, and ${need} sign the next version: give them with --rotation-key FILE`);
    }

    async function walletRotationKeys(env, w, owner, prev) {
      const need = prev.keys.nextThreshold, out = [];
      env.err(`Reading ${theKeys(need, 'rotation key')} of v${prev.number} of ${short(owner)} that sign from ${w.name}…`);
      try {
        for (const digest of prev.keys.next) {
          const key = await unlockKey(env, w, owner, digest.slice(0, 16), ROTATION);
          if (key && key.digest === digest) {
            out.push(key);
            env.err(`  ${out.length}/${need} ${keyLabel(ROTATION, key.did)}  opened`);
          }
          if (out.length === need) break;
        }
      } catch (error) {
        walletStop(error);
      }
      return out;
    }

Owner init, in an archive
-------------------------

`osheaf owner init` makes another owner in an archive (chapter
[27](27-init.md) makes it), adds it to the owners of `osheaf.json`, records
the GitHub wallet of `--keys` as a hint for it, seals its owner catalogue,
empty and signed with its new current key (section 8.1: the catalogue is
created when the owner is set up in the archive; chapter
[24](24-owner-catalogues.md)), and writes the discovery document again,
which lists it with its catalogue.

    // in owner init, in an archive:
    export async function ownerInitCommand(f, args) {
      const log = await ownerInit(f, args);
      const cfg = await readJson(f.storage, CONFIG_NAME);
      if (cfg) {
        let changed = false;
        if (![cfg.owner, ...(cfg.owners || [])].includes(log.owner)) {
          cfg.owners = [...(cfg.owners || []), log.owner];
          f.archive.owners = [...(f.archive.owners || []), log.owner];
          changed = true;
        }
        if (changed) await writeText(f.storage, CONFIG_NAME, jsonText(cfg));
        await recordWallet(f, log.owner, args.keys);
        if (f.archiveOwners().includes(log.owner) && !f.catalogues.has(log.owner)) await collect(f, { owner: log.owner });
      }
      await writeDiscovery(f);
    }

Change the keys of an owner
---------------------------

`osheaf owner rotate` (section 6.2) adds current keys (`--add`, made on
other devices with `osheaf key new`), retires some (`--retire`), and
commits new rotation keys, kept where the security level says;
`osheaf owner expose DID...` (section 6.3) does the same and lists the
keys exposed. Moving from a wallet to the offline level (`--keys offline
--export DIR`) uses the rotation keys of the wallet up.

    // in change the keys of an owner:
    const MOVED_UP = (w) => `Moved up to the maximum security level: the rotation keys kept in ${w} are used up and sign ` +
      'nothing more (section 6.2), and the new ones are kept offline only. To remove the used ones ' +
      `from ${w}: osheaf key forget --from-wallet --used. The current keys kept in ${w} still sign until ` +
      'a version of the key log retires them (osheaf owner rotate --retire DID); then osheaf key ' +
      `forget --from-wallet DID removes them.`;

    export async function ownerRotate(f, args, exposed = []) {
      const env = f.env;
      const [owner, log] = await ownerOf(f, args);
      const who = short(owner);
      const prev = log.latest();
      if (!prev) stop(`the owner ${who} has ended (section 6.3): its key log takes no new version`);
      if (args.print && !args.export) {
        stop('--print prints the sheets of the rotation keys exported with --export DIR: give ' +
             '--export DIR with it (in a wallet, the keys are not exported, and no sheet is printed)');
      }
      const w = await levelWallet(f, args, env, owner);
      if (!w && !args.export) {
        stop('give --export DIR, a folder outside the archive where the new rotation keys are written ' +
             '(or keep them in a wallet, a lower security level: --keys github:OWNER/REPO|command)');
      }
      if (w && args.noPassphrase) stop('--no-passphrase: the keys in a wallet are always locked with a passphrase');
      const [signers, source] = await rotationSigners(f, args, owner, prev);
      const nRot = Number(args.rotation || prev.keys.next.length);
      const nextThreshold = Number(args.nextThreshold || Math.min(prev.keys.nextThreshold, nRot));
      for (const did of [...(args.add || []), ...(args.retire || []), ...exposed]) checkDid(did);
      const fresh = [];
      for (let k = 0; k < nRot; k++) fresh.push(await env.newKey());
      let v;
      try {
        v = await rotate(log, signers, { nextKeys: fresh, nextThreshold, add: args.add || [], retire: args.retire || [],
                                         exposed, threshold: args.threshold || null,
                                         message: args.message || (exposed.length ? 'Keys exposed' : 'Keys changed'),
                                         user: f.depositor(), created: env.now() });
      } catch (error) {
        if (error instanceof OwnerError) stop(error.message);
        throw error;
      }
      if (nextThreshold === 1) env.warn(SINGLE_ROTATION_RISK);
      if (args.export) await exportAndConfirm(f, fresh, owner, v.number, args);
      if (w) {
        let here = [];
        try {
          here = await env.keyStore.current(owner, v.keys.keys);
        } catch {
          here = [];
        }
        await keepInWallet(f, w, owner, fresh, v.number, args, here.map((k) => [k, versionListing(log, k.did)]));
      }
      await writeLog(f, log);
      await writeDiscovery(f);
      env.out(`Done: v${v.number} of the key log of ${who}, signed by ${plural(signers.length, 'rotation key')} of v${prev.number}:`);
      for (const did of v.keys.keys) env.out(`  current key    ${did}`);
      for (const did of exposed) env.out(`  exposed key    ${did}`);
      const resolved = args.export ? await env.exportFolder.resolve(args.export) : null;
      env.out(rotationLine(nRot, nextThreshold, keptWhere(args, w, resolved), true));
      if (exposed.length) env.out('What an exposed key alone signed is contested (section 7.3): osheaf sign signs it again.');
      if (source && !w) env.err(MOVED_UP(source.name));
      if (w) await recordWallet(f, owner, args.keys);
    }

    export async function ownerExpose(f, args) {
      return ownerRotate(f, args, [...args.exposed]);
    }

End an owner
------------

The ending version (section 6.3), naming a successor if given, and
exposing keys if asked.

    // in end an owner:
    export async function ownerEnd(f, args) {
      const [owner, log] = await ownerOf(f, args);
      const who = short(owner);
      const successor = args.successor ?? null;
      if (successor !== null && !OWNER_NAME.test(successor)) stop(`the successor is an owner name: ${successor}`);
      if (!log.latest()) stop(`the owner ${who} has ended (section 6.3): its key log takes no new version`);
      if (!args.yes) {
        f.env.out(`Ending the owner ${who}: its key log takes no new version after this one, and nothing is ` +
                  'signed for it again (section 6.3). This cannot be undone.');
        if (!(await confirmed(f.env, owner.slice(0, 8)))) stop('not confirmed: the owner has not ended');
      }
      const [signers] = await rotationSigners(f, args, owner, log.latest());
      let v;
      try {
        v = await end(log, signers, { successor, exposed: args.expose || [], message: args.message || 'Owner ended',
                                      user: f.depositor(), created: f.env.now() });
      } catch (error) {
        if (error instanceof OwnerError) stop(error.message);
        throw error;
      }
      await writeLog(f, log);
      await writeDiscovery(f);
      f.env.out(`Done: the owner ${who} has ended, at v${v.number} of its key log` + (successor ? `; its successor is ${successor}.` : '.'));
    }

`osheaf owner complete` settles a version of the key log that an
interrupted write left after its head (chapter
[34](34-key-logs.md)), as opensheaf-py's `owner_complete`: a signed one
that passes the checks becomes the head, an unsigned one is removed, and
one that fails the checks stops the command, left for a person.

    // in end an owner:
    export async function ownerComplete(f, args) {
      const [owner, log] = await ownerOf(f, args);
      const who = short(owner);
      if (!log.orphan) {
        f.env.out(`The key log of ${who} has no version written after its head: nothing to do.`);
        return;
      }
      const n = log.orphan.number;
      let done;
      try {
        done = await completeOrphan(f.storage, await f.dirOf(log.id));
      } catch (error) {
        if (error instanceof OwnerError) stop(error.message);
        throw error;
      }
      f.changed();
      await writeDiscovery(f);
      f.env.out(`Done: v${n} of the key log of ${who} ` +
                (done === 'completed' ? 'is completed: it is the head.' : 'carried no signature, and is removed.'));
    }

Show an owner
-------------

The key log, the current keys this computer holds, and the link to the
keeper, read unless `--offline`.

    // in show an owner:
    export async function ownerShow(f, args) {
      const env = f.env;
      const [owner, log] = await ownerOf(f, args);
      const latest = log.latest();
      let here = [];
      if (latest) {
        try {
          here = (await env.keyStore.current(owner, latest.keys.keys)).map((k) => k.did);
        } catch (error) {
          if (!(error instanceof KeyError)) throw error;
          env.warn(error.message);
        }
      }
      const link = args.offline ? { keeper: await keeperOf(log), status: NOT_CHECKED, reason: 'offline: --offline given', successor: null }
        : await keeperLink(log, env.fetchJson);
      for (const line of await describeLog(log, here, link, successorClaim)) env.out(line);
    }

Pull another copy of a key log
------------------------------

A key log taken down here returns only from a copy holding the version its
tombstone pins, also as carried by a fork record (section 13.2, chapter
[42](42-takedown.md)): `recordKeyLog` checks it before it copies a key
log not held, and the tombstone is then dropped.

`osheaf owner pull URL|PATH` meets another copy of the key log of the
owner (section 6.3), in another archive or in the folder of an owner
object: the versions it has beyond this one are appended, or a fork
record. A key log not held here yet is copied (opensheaf-py's
`record_key_log`). The copy in a folder is read by the command line
(`args.folderLog`); an archive is read through the resolver, as
collections read other archives.

    // in pull another copy of a key log:
    export async function ownerPull(f, args) {
      const env = f.env;
      const owner = args.owner || f.archive.owner;
      const place = args.source;
      const others = [];
      if (args.folderLog) {
        if (args.folderLog.owner !== owner) stop(`${place} is the key log of ${short(args.folderLog.owner)}, not of ${short(owner)}`);
        others.push([place, args.folderLog]);
      } else {
        const { openResolver } = await import('./collections.js');
        const r = await openResolver(f);
        await r.keyLog(owner, [place]);
        for (const { where, log } of r.logs.get(owner)?.found || []) if (where !== r.home.base) others.push([where, log]);
      }
      if (!others.length) stop(`no copy of the key log of ${short(owner)} at ${place}`);
      const log = await recordKeyLog(f, owner, others);
      await writeDiscovery(f);
      if (log) {
        env.out(`The key log of ${short(owner)} is here up to v${log.versions.length}` +
                (log.forkPoint ? `; it was ended by a fork at v${log.forkPoint}.` : log.ended ? '; the owner has ended.' : '.'));
      }
    }

    export async function recordKeyLog(f, owner, others) {
      const env = f.env;
      let local = await keyLogOf(f, owner);
      if (!local) {
        if (!others.length) return null;
        const [w, first] = others.shift();
        await first.check();
        const { mayReturn } = await import('./takedown.js');
        if (!(await mayReturn(f, objectId(owner, owner), async (n, d) => first.verified(n, d) != null))) {
          env.err(`warning: the key log of ${owner} was taken down here, and the copy at ${w} does not hold the version ` +
                  'its tombstone pins (section 13.2): not copied');
          return null;
        }
        const { KeyLog } = await import('./owners.js');
        local = await KeyLog.of(first.genesis, first.versions.filter((v) => v.isVersion));
        env.out(`key log of ${owner}: copied from ${w} (v${local.versions.length})`);
      }
      for (const [w, other] of others) {
        let what, n;
        try {
          [what, n] = await pull(local, other, { user: f.depositor(), created: env.now() });
        } catch (error) {
          if (!(error instanceof OwnerError)) throw error;
          env.err(`warning: the key log of ${owner} at ${w}: ${error.message}`);
          continue;
        }
        if (what === 'extended') env.out(`key log of ${owner}: ${n} version${n === 1 ? '' : 's'} added from the copy at ${w}`);
        else if (what === 'fork') {
          env.out(`key log of ${owner}: a fork at v${n} met at ${w}: fork record appended as ` +
                  `v${local.versions[local.versions.length - 1].number}; the owner has ended (section 6.3)`);
        } else if (what === 'reported') {
          env.out(`key log of ${owner}: the copy at ${w} forks at v${n}; a fork record is held already, ` +
                  'so it is reported, not recorded (section 6.3)');
        }
      }
      await writeLog(f, local);
      const back = await keyLogOf(f, owner);
      await back?.check();
      return back;
    }

A new current key
-----------------

`osheaf key new`: a current key for this device, which signs once a
version of the key log adds it. `--owner` must be an owner name, as in
opensheaf-py: the owner names the folder of the key files and the account
of the keychain, and every key store refuses another value too (chapter
[40](40-cli.md)), so that `../..` cannot lead a key file out of its
folder.

    // in a new current key:
    export async function keyNew(f, args) {
      const env = f.env;
      const owner = args.owner || f.archive.owner;
      if (typeof owner !== 'string' || !OWNER_NAME.test(owner)) stop(`--owner: an owner name, not '${owner}'`);
      if (!env.keyStore.keptOnDevice()) stop(notKeptText());
      const key = await env.newKey();
      let store;
      try {
        store = await env.keyStore.keep(owner, key);
      } catch (error) {
        if (error instanceof KeyError || error.code) stop(error.message);
        throw error;
      }
      env.out(`New current key of ${short(owner)}, kept in ${env.keyStore.storeName(store)}:`);
      env.out(`  ${key.did}`);
      env.out(`It signs once a version of the key log adds it: osheaf owner rotate --add ${key.did} --rotation-key FILE ... --export DIR`);
      return key;
    }

Push, pull and list
-------------------

`osheaf key push` puts the current keys of this device into the wallet;
`key pull` keeps on this device those the wallet holds; `key list` shows
what the wallet holds, without a secret.

    // in push, pull and list:
    export async function keyPush(f, args) {
      const env = f.env;
      const [owner, log] = await ownerOf(f, args);
      const who = short(owner);
      const latest = log.latest();
      if (!latest) stop(`the owner ${who} has ended (section 6.3)`);
      const w = await walletFor(f, args, env, owner, { putting: true });
      const dids = args.did?.length ? [...args.did] : [...latest.keys.keys];
      const here = await currentHere(f, owner, dids);
      if (!here.length) stop(`this computer holds none of the keys ${dids.map(short).join(', ')} of ${who}`);
      const there = new Set();
      try {
        await w.checkWritable();
        for (const k of here) if ((await w.read(owner, k.id, CURRENT)) !== null) there.add(k.did);
      } catch (error) {
        walletStop(error);
      }
      const n = here.length;
      if (there.size === n) {
        env.out(`${n === 1 ? 'The current key' : `The ${n} current keys`} of ${who} ${n === 1 ? 'is' : 'are'} already in ${w.name}.`);
        await recordWallet(f, owner, args.wallet);
        return;
      }
      env.warn(risk(w.name, owner));
      const plain = Boolean(args.plainCurrent);
      const unlocked = plain ? [] : await unlockedPasskeys(env, owner);
      const secret = plain ? null : unlocked.length ? await walletPassphrase(env, w, owner) : await env.passphrase({ where: w.name });
      env.err(`Saving ${theKeys(n, 'current key')} of ${who} to ${w.name}…`);
      try {
        let i = 0;
        for (const key of here) {
          i++;
          if (there.has(key.did)) {
            env.err(`  ${i}/${n} ${keyLabel(CURRENT, key.did)}  already there`);
            continue;
          }
          await putKey(w, owner, key, CURRENT, versionListing(log, key.did), secret, unlocked, env.cost);
          env.err(`  ${i}/${n} ${keyLabel(CURRENT, key.did)}  saved`);
        }
      } catch (error) {
        walletStop(error);
      }
      const lock = plain ? 'with no lock (--plain-current)'
        : unlocked.length ? 'locked with your passkey and your passphrase' : 'locked with your passphrase';
      env.out(`Done: ${plural(n - there.size, 'current key')} of ${who} saved to ${w.name}, ${lock}.`);
      await recordWallet(f, owner, args.wallet);
    }

    export async function keyPull(f, args) {
      const env = f.env;
      const [owner, log] = await ownerOf(f, args);
      const latest = log.latest();
      if (!latest) stop(`the owner ${short(owner)} has ended (section 6.3)`);
      const w = await walletFor(f, args, env, owner);
      if (!env.keyStore.keptOnDevice()) {
        env.out(notKept(w, owner));
        return;
      }
      const have = new Set((await currentHere(f, owner, latest.keys.keys)).map((k) => k.did));
      const pulled = await pullCurrentKeys(env, w, owner, latest.keys.keys.filter((d) => !have.has(d)));
      env.out(pullSummary(env, w, owner, latest, have, pulled));
    }

    async function pullCurrentKeys(env, w, owner, dids) {
      const out = [];
      if (dids.length) env.err(`Pulling ${theKeys(dids.length, 'current key')} of ${short(owner)} from ${w.name}…`);
      try {
        for (const did of dids) {
          const key = await unlockKey(env, w, owner, await keyId(did), CURRENT);
          if (!key) {
            env.err(`  ${keyLabel(CURRENT, did)}  not in ${w.name}`);
            continue;
          }
          if (key.did !== did) stop(`the wallet ${w.name} holds another key than ${did} under its name`);
          const store = await env.keyStore.keep(owner, key);
          env.err(`  ${keyLabel(CURRENT, did)}  kept in ${env.keyStore.storeName(store)}`);
          out.push([key, store]);
        }
      } catch (error) {
        if (error.code) stop(error.message);
        walletStop(error);
      }
      return out;
    }

    function pullSummary(env, w, owner, latest, have, pulled) {
      const total = latest.keys.keys.length, held = have.size + pulled.length, who = short(owner);
      if (pulled.length) {
        const stores = [...new Set(pulled.map(([, s]) => env.keyStore.storeName(s)))].sort();
        const out = `Pulled ${plural(pulled.length, 'current key')} of ${who} from ${w.name} into ${stores.join(' and ')}.`;
        return out + (held < total ? ` This computer holds ${held} of its ${total} current keys.` : '');
      }
      if (held === total) {
        return total === 1 ? `The current key of ${who} is already on this computer.`
          : `The ${total} current keys of ${who} are already on this computer.`;
      }
      return `The wallet ${w.name} holds no current key of ${who} that this computer lacks: this computer holds ${held} of the ${total}.`;
    }

When a command that signs finds too few current keys on this device, it
pulls the others from the wallet configured, if any (opensheaf-py's
`pull_from_wallet`); the signing of chapter [23](23-folder.md) calls it
through the environment.

    // in push, pull and list:
    export async function pullFromWallet(f, owner, latest, found) {
      const w = await configured(f, f.env, owner);
      if (!w) return found;
      const held = new Set(found.map((k) => k.did));
      const more = await pullCurrentKeys(f.env, w, owner, latest.keys.keys.filter((d) => !held.has(d)));
      return [...found, ...more.map(([k]) => k)];
    }

    export async function keyList(f, args, env) {
      const owner = args.owner || null;
      const w = await walletFor(f, args, env, owner || f?.archive.owner || null);
      let rows;
      try {
        rows = await listing(w, owner);
      } catch (error) {
        walletStop(error);
      }
      const whose = owner ? ` of ${short(owner)}` : '';
      if (!rows.length) {
        env.out(`The wallet ${w.name} holds no key${whose}.`);
        return;
      }
      env.out(`The wallet ${w.name} holds ${plural(rows.length, 'key')}${whose}:`);
      const table = [['Owner', 'Kind', 'Key', 'Version', 'Locks'],
                     ...rows.map(([o, , kind, did, version, l]) => [short(o), kind, short(did), version || '-', l.join(', ') || 'none'])];
      const widths = [0, 1, 2, 3].map((i) => Math.max(...table.map((r) => [...r[i]].length)));
      for (const r of table) env.out('  ' + r.slice(0, 4).map((c, i) => c + ' '.repeat(widths[i] - [...c].length)).join('  ') + '  ' + r[4]);
    }

`osheaf key wallet` and `osheaf key wallets`, the two sides of the many
to many (opensheaf-py's `key_wallet` and `key_wallets`): the wallets in
which the keys of an owner are looked for, in order, with the hints of
`osheaf.json` added (`--add`) or removed (`--remove`); and the wallets of
the person, with, for each, the owners whose keys it holds and their
locks, and the list of the configuration file changed. The configuration
file is written as Python's `json.dumps(..., indent=2, ensure_ascii=False)`
writes it.

    // in push, pull and list:
    export async function keyWallet(f, args, env) {
      const owner = keyOwner(f, args), who = short(owner);
      const add = args.add || null, remove = args.remove || null;
      if (add && remove) stop('give --add or --remove, not both');
      if (!add && !remove) {
        let found;
        try {
          found = candidateWallets(f?.archive.keys, env, owner);
        } catch (error) {
          walletStop(error);
        }
        if (!found.length) {
          env.out(`No key wallet is configured for ${who}: osheaf key wallet --add github:OWNER/REPO hints one ` +
                  `in ${CONFIG_NAME}, osheaf key wallets --add github:OWNER/REPO adds one to yours.`);
          return;
        }
        env.out(`The keys of ${who} are looked for in, in order:`);
        const width = Math.max(...found.map(([w]) => [...w].length));
        for (const [w, where] of found) env.out(`  ${w + ' '.repeat(width - [...w].length)}  ${where}`);
        return;
      }
      if (!f) stop(`run the command in an archive: the hints are in its ${CONFIG_NAME}`);
      if (!f.archiveOwners().includes(owner)) stop(`${who} is not an owner of this archive`);
      const cfg = await readJson(f.storage, CONFIG_NAME);
      const own = cfg.keys && typeof cfg.keys === 'object' && !Array.isArray(cfg.keys)
        ? hints({ [owner]: cfg.keys[owner] }, owner) : [];
      if (remove) {
        if (!own.includes(remove)) {
          env.out(`${CONFIG_NAME} hints no ${remove} for ${who}.`);
          return;
        }
        await writeConfig(f, hinted(cfg, owner, remove, false));
        env.out(`Done: ${CONFIG_NAME} no longer hints ${remove} for ${who}.`);
        return;
      }
      if (!add.startsWith('github:')) {
        stop(`${CONFIG_NAME} names GitHub wallets only, github:OWNER/REPO: a command wallet is configured ` +
             `in ${env.wallets.userConfigPath()} or in ${WALLET}`);
      }
      let w;
      try {
        w = parseWallet(add, env);
      } catch (error) {
        walletStop(error);
      }
      if ((await forbiddenRepositories(f)).has(w.repo.toLowerCase())) {
        stop(`${w.repo} is a repository of this archive, which is public: a key wallet is a private repository of its own`);
      }
      if (own.includes(add)) {
        env.out(`${CONFIG_NAME} hints ${add} for ${who} already.`);
        return;
      }
      await writeConfig(f, hinted(cfg, owner, add));
      env.out(`Done: ${CONFIG_NAME} hints ${add} for ${who}.`);
    }

    export async function keyWallets(f, args, env) {
      const add = args.add || null, remove = args.remove || null;
      if (add && remove) stop('give --add or --remove, not both');
      if (add || remove) return changeUserWallets(env, add, remove);
      const listed = [];
      try {
        const given = (env.wallets.walletEnv() || '').trim();
        if (given) listed.push([given, WALLET]);
        for (const o of f?.archive.owner ? f.archiveOwners() : []) {
          for (const w of hints(f.archive.keys, o)) listed.push([w, CONFIG_NAME]);
        }
        for (const w of userWallets(env)) listed.push([w, env.wallets.userConfigPath()]);
      } catch (error) {
        walletStop(error);
      }
      const seen = new Set(), rows = [];
      for (const [spec, where] of listed) {
        if (!seen.has(spec) && !spec.startsWith('{')) {
          seen.add(spec);
          rows.push([spec, where]);
        }
      }
      if (!rows.length) {
        env.out('No key wallet is configured: osheaf key wallets --add github:OWNER/REPO adds one.');
        return;
      }
      const forbidden = await forbiddenRepositories(f);
      for (const [spec, where] of rows) {
        env.out(`${spec} (${where}):`);
        let held;
        try {
          const w = parseWallet(spec, env, { forbidden });
          held = w ? await ownersHeld(w) : [];
        } catch (error) {
          if (!(error instanceof WalletError)) throw error;
          env.out(`  cannot be read: ${error.message}`);
          continue;
        }
        if (!held.length) env.out('  holds no key');
        for (const [o, n, lock] of held) env.out(`  ${short(o)}  ${plural(n, 'key').padEnd(7)} ${lock}`);
      }
    }

    async function changeUserWallets(env, add, remove) {
      const p = env.wallets.userConfigPath();
      let data;
      try {
        data = env.wallets.userFile();
      } catch (error) {
        walletStop(error);
      }
      const listed = Array.isArray(data.wallets) ? data.wallets.filter((w) => typeof w === 'string') : [];
      if (add) {
        try {
          parseWallet(add, env);
        } catch (error) {
          walletStop(error);
        }
        if (add === '' || add === OFFLINE || add.startsWith('{')) stop('a wallet is github:OWNER/REPO or command');
        if (listed.includes(add)) {
          env.out(`${add} is one of your wallets already.`);
          return;
        }
        data.wallets = [...listed, add];
      } else {
        if (!listed.includes(remove)) {
          const old = data.keys && typeof data.keys === 'object' ? data.keys.wallet : null;
          stop(remove === old ? `${remove} is named by "keys" of ${p}: edit it there` : `${remove} is not one of your wallets`);
        }
        data.wallets = listed.filter((w) => w !== remove);
      }
      env.wallets.writeUserFile(data);
      env.out(`Done: ${add || remove} is ${add ? 'added to' : 'removed from'} your wallets (${p}).`);
    }

Passkeys that open keys
-----------------------

The passkeys of an owner open the keys of its wallet in a command: the
first key that needs one asks the browser (chapter [36](36-passkeys.md)),
unless the passphrase is given (`OPENSHEAF_PASSPHRASE`), or
`OPENSHEAF_UNLOCK=passphrase`, or the passkey failed already in this
command; then the passphrase is asked instead. A key-encryption key is
kept for the command only once it has opened the box of a wrap it was
asked for: an answer that opens nothing is never kept. Wraps of the old
relying party `opensheaf.org` are not asked for, and the person is told
once how to move them.

    // in passkeys that open keys:
    function askedOf(env) {
      env.asked ??= {};
      const a = env.asked;
      a.passkeys ??= new Map();
      a.seen ??= new Set();
      a.failed ??= new Set();
      a.oldRp ??= new Set();
      return a;
    }

    function keksOf(cache) {
      return Object.fromEntries([...cache].map(([c, p]) => [c, p.kek]));
    }

    export async function passkeyKeks(env, owner, wraps, force = false) {
      const asked = askedOf(env);
      asked.seen.add(owner);
      const salt = await passkeySalt(owner);
      wraps = wraps.filter((p) => sameBytes(p.salt, salt));
      if (wraps.some((p) => p.rp === OLD_PASSKEY_RP) && !asked.oldRp.has(owner)) {
        asked.oldRp.add(owner);
        env.err(`A passkey of ${short(owner)} was enrolled on ${OLD_PASSKEY_RP}, which osheaf no longer asks: run osheaf key ` +
                `enroll --new-passkey to move it to ${PASSKEY_RP} (then osheaf key forget --rp ${OLD_PASSKEY_RP}).`);
      }
      wraps = wraps.filter((p) => p.rp === PASSKEY_RP);
      if (!wraps.length) return null;
      if (wraps.some((p) => asked.passkeys.has(p.cred))) return keksOf(asked.passkeys);
      if (!force && (env.passphraseGiven || env.unlockMode === 'passphrase' || asked.failed.has(owner))) return null;
      const creds = [...new Set(wraps.map((p) => p.cred))];
      let cred, prf;
      try {
        [cred, prf] = await env.passkeys.unlock(owner, creds, { noBrowser: Boolean(asked.noBrowser),
                                                                ctrlC: force ? 'stop' : 'type the passphrase instead' });
      } catch (error) {
        if (!(error instanceof UnlockFailed)) throw error;
        asked.failed.add(owner);
        if (force) stop(`the passkey did not unlock the keys of ${short(owner)}: ${error.message}`);
        env.err(`The passkey did not open the keys (${error.message}): osheaf asks for the passphrase instead.`);
        return null;
      }
      const kek = await passkeyKek(prf);
      const opened = [];
      for (const c of cred ? [cred] : creds) {
        for (const p of wraps) {
          if (p.cred === c && (await p.opens(kek))) {
            opened.push(c);
            break;
          }
        }
      }
      if (!opened.length) {
        asked.failed.add(owner);
        if (force) stop(`the passkey's answer opens no key of ${short(owner)}: nothing was unlocked`);
        env.err("The passkey's answer opens no key: osheaf asks for the passphrase instead.");
        return null;
      }
      asked.passkeys.set(opened[0], new Passkey(opened[0], salt, { kek }));
      return keksOf(asked.passkeys);
    }

    export async function unlockKey(env, w, owner, kid, kind) {
      return getKey(w, owner, kid, kind, () => env.passphrase({ confirm: false, where: w.name }),
                    (o, wraps) => passkeyKeks(env, o, wraps));
    }

    async function unlockedPasskeys(env, owner) {
      const salt = await passkeySalt(owner);
      return [...askedOf(env).passkeys.values()].filter((p) => sameBytes(p.salt, salt));
    }

The passphrase of keys written after a passkey opened others is asked
once, and checked against a key of the owner already in the wallet, so
that all its keys stay under one passphrase.

    // in passkeys that open keys:
    async function walletEntries(w, owner) {
      try {
        const out = [];
        for (const [o, kid] of await w.entries(owner)) out.push([kid, await readAny(w, o, kid)]);
        return out;
      } catch (error) {
        return walletStop(error);
      }
    }

    async function walletPassphrase(env, w, owner) {
      if (env.passphrase.known?.(w.name)) return env.passphrase({ where: w.name });
      let texts = [];
      try {
        texts = (await walletEntries(w, owner)).map(([, t]) => t).filter((t) => wrapsOf(t).length);
      } catch {
        texts = [];
      }
      if (!texts.length) return env.passphrase({ where: w.name });
      const secret = await env.passphrase({ confirm: false, where: w.name });
      try {
        await readKey(texts[0], secret);
      } catch (error) {
        if (error instanceof KeyError) stop(`${error.message}: this is not the passphrase of the keys of ${short(owner)} in ${w.name}`);
        throw error;
      }
      return secret;
    }

    function enrollHint(env, owner, unlocked) {
      if (!unlocked.length && askedOf(env).seen.has(owner)) {
        env.err(`The new keys of ${short(owner)} open with your passphrase only: run osheaf key enroll so that your passkey opens them too.`);
      }
    }

Enroll and unlock
-----------------

`osheaf key enroll` lets a passkey open the keys of the owner in the
wallet: every key is opened with the passphrase first; a new passkey is
made (when none opens any key yet, or with `--new-passkey`) and checked
with a second unlock, which must give the same secret; or the passkey
already enrolled is used for the keys it does not open yet. Each key gets
one more wrap. `osheaf key unlock` opens the keys with the passkey, and,
in an archive, pulls the current keys this device lacks.

    // in enroll and unlock:
    async function encryptedEntries(w, owner) {
      const out = (await walletEntries(w, owner)).filter(([, t]) => t.split(/\r\n|\r|\n/).some((x) => {
        const p = x.split(/\s+/).filter(Boolean);
        return x.startsWith('encryption ') && p[1] !== 'none';
      }));
      if (!out.length) stop(`the wallet ${w.name} holds no key of ${short(owner)} locked with a passphrase`);
      return out;
    }

    async function opensWith(text, cred, kek) {
      try {
        await readKey(text, null, { [cred]: kek });
        return true;
      } catch (error) {
        if (error instanceof KeyError) return false;
        throw error;
      }
    }

    export async function keyEnroll(f, args, env) {
      const owner = keyOwner(f, args), w = await walletFor(f, args, env, owner);
      askedOf(env).noBrowser = Boolean(args.noBrowser);
      try {
        await w.checkWritable();
      } catch (error) {
        walletStop(error);
      }
      const who = short(owner);
      env.err(`Reading the keys of ${who} in ${w.name}…`);
      const entries = await encryptedEntries(w, owner);
      const salt = await passkeySalt(owner);
      const known = [...new Set(entries.flatMap(([, t]) => passkeysOf(t)
        .filter((p) => sameBytes(p.salt, salt) && p.rp === PASSKEY_RP).map((p) => p.cred)))];
      const fresh = Boolean(args.newPasskey) || !known.length;
      const todo = fresh ? entries : entries.filter(([, t]) => !passkeysOf(t).some((p) => known.includes(p.cred)));
      if (!todo.length) {
        env.out(`Every key of ${who} in ${w.name} already opens with your passkey.`);
        return;
      }
      const secret = await env.passphrase({ confirm: false, where: w.name });
      const n = todo.length;
      env.err(`Opening ${theKeys(n)} of ${who} in ${w.name} with the passphrase…`);
      let i = 0;
      for (const [kid, t] of todo) {
        let rk;
        try {
          rk = await readKey(t, secret);
        } catch (error) {
          if (error instanceof KeyError) stop(`${w.name} ${kid}: ${error.message}: nothing was changed`);
          throw error;
        }
        env.err(`  ${++i}/${n} ${keyLabel(rk.kind, rk.key.did)}  opened`);
      }
      const halt = 'stop: nothing is changed';
      const options = { noBrowser: Boolean(args.noBrowser), ctrlC: halt };
      let cred, prf;
      try {
        if (fresh) {
          [cred, prf] = await env.passkeys.enroll(owner, known, options);
          env.err('The passkey is made. Once more, to check it…');
          const [again, prf2] = await env.passkeys.unlock(owner, [cred], options);
          if ((again !== null && again !== cred) || prf.length !== prf2.length || !prf.every((b, k) => b === prf2[k])) {
            stop('the new passkey did not give the same secret twice: nothing was changed');
          }
        } else {
          [cred, prf] = await env.passkeys.unlock(owner, known, options);
        }
      } catch (error) {
        if (error instanceof UnlockFailed) stop(`no passkey: ${error.message}; nothing was changed`);
        throw error;
      }
      const kek = await passkeyKek(prf);
      if (!fresh) {
        const opened = [];
        for (const c of cred ? [cred] : known) {
          for (const [, t] of entries) {
            if (passkeysOf(t).some((p) => p.cred === c) && (await opensWith(t, c, kek))) {
              opened.push(c);
              break;
            }
          }
        }
        if (!opened.length) stop('the passkey used does not open the keys it is enrolled for: nothing was changed');
        cred = opened[0];
      }
      const unlocked = new Passkey(cred, salt, { kek });
      env.err(`Adding a passkey lock to ${theKeys(n)} of ${who} in ${w.name}…`);
      try {
        i = 0;
        for (const [kid] of todo) {
          const [kind, did] = await addPasskeyToWallet(w, owner, kid, secret, unlocked, env.cost);
          env.err(`  ${++i}/${n} ${keyLabel(kind, did)}  lock added`);
        }
      } catch (error) {
        walletStop(error);
      }
      env.out(`Done: ${theKeys(n)} of ${who} ${n === 1 ? 'opens' : 'open'} with your passkey (Touch ID) and still with your passphrase.`);
    }

    export async function keyUnlock(f, args, env) {
      const owner = keyOwner(f, args), w = await walletFor(f, args, env, owner);
      askedOf(env).noBrowser = Boolean(args.noBrowser);
      const who = short(owner);
      env.err(`Reading the keys of ${who} in ${w.name}…`);
      const entries = (await walletEntries(w, owner)).filter(([, t]) => passkeysOf(t).length);
      if (!entries.length) stop(`no key of ${who} in ${w.name} has a passkey lock: run osheaf key enroll`);
      const keks = await passkeyKeks(env, owner, entries.flatMap(([, t]) => passkeysOf(t)), true);
      if (!keks) stop(`no passkey of ${who} to unlock with`);
      let opened = 0;
      for (const [, t] of entries) {
        for (const [c, k] of Object.entries(keks)) {
          if (await opensWith(t, c, k)) {
            opened++;
            break;
          }
        }
      }
      const n = entries.length;
      if (opened === n) env.out(`${n === 1 ? 'The key' : n === 2 ? 'Both keys' : `All ${n} keys`} of ${who} opened with your passkey.`);
      else env.out(`${opened} of the ${n} keys of ${who} opened with your passkey; the others need the passphrase.`);
      const log = f ? await keyLogOf(f, owner) : null;
      if (log) await log.check();
      const latest = log ? log.latest() : null;
      if (latest && !env.keyStore.keptOnDevice()) {
        env.out(notKept(w, owner));
      } else if (latest) {
        const have = new Set((await currentHere({ env }, owner, latest.keys.keys)).map((k) => k.did));
        const pulled = await pullCurrentKeys(env, w, owner, latest.keys.keys.filter((d) => !have.has(d)));
        env.out(pullSummary(env, w, owner, latest, have, pulled));
      }
    }

A key to and from a password manager
------------------------------------

`osheaf key export` copies a current key of this device to the clipboard
(or prints it, `--stdout`), as the text of chapter [21](21-keys.md),
encrypted under the passphrase with `--encrypt`; the clipboard is cleared
a minute later if it still holds the key. `osheaf key import` keeps on
this device a current key read back from the clipboard or the standard
input. A rotation key is never kept on a device.

    // in a key to and from a password manager:
    export async function keyExport(f, args, env) {
      if (!args.clipboard && !args.stdout) stop('give --clipboard, or --stdout to print the key');
      const owner = args.owner || f?.archive.owner;
      if (!owner) stop('give --owner NAME, or run the command in an archive');
      const who = short(owner);
      let dids;
      if (args.did) {
        dids = [args.did];
      } else {
        const log = f ? await keyLogOf(f, owner) : null;
        if (log) await log.check();
        const latest = log ? log.latest() : null;
        if (!latest) stop(`name the key to export, by its did:key (no key log of ${who} here)`);
        dids = latest.keys.keys;
      }
      const here = await currentHere({ env }, owner, dids);
      if (!here.length) stop(`this computer holds none of the keys ${dids.map(short).join(', ')} of ${who}`);
      if (here.length > 1) {
        stop(`this computer holds ${here.length} current keys of ${who}: name the one to export by its did:key, one of ` +
             here.map((k) => k.did).join(', '));
      }
      const key = here[0];
      const locked = Boolean(args.encrypt);
      const text = await keyText(key, owner, CURRENT, locked ? await env.passphrase() : null, env.cost);
      if (args.stdout) {
        env.write(text);
      } else {
        try {
          await env.clipboard.copy(text);
        } catch (error) {
          walletStop(error);
        }
        env.clipboard.clearLater(text);
        env.err(`The current key ${short(key.did)} of ${who}${locked ? ', locked with your passphrase,' : ''} is on the clipboard: ` +
                `paste it into a note of your password manager (the Passwords app) within ${Math.trunc(env.clipboard.clearAfter)} ` +
                'seconds; then osheaf clears the clipboard if it still holds the key.');
        env.warn('any program of yours can read the clipboard, and Universal Clipboard may send it to your other Apple devices nearby');
      }
      env.warn('a current key kept in a password manager is on every device that it syncs with, while section 6.2 has one key per device');
    }

    export async function keyImport(f, args, env) {
      if (Boolean(args.clipboard) === Boolean(args.stdin)) stop('give --clipboard or --stdin');
      if (!env.keyStore.keptOnDevice()) stop(notKeptText());
      let text;
      try {
        text = args.clipboard ? await env.clipboard.paste() : await env.readStdin();
      } catch (error) {
        walletStop(error);
      }
      let rk;
      try {
        try {
          rk = await readKey(text);
        } catch (error) {
          if (!(error instanceof PassphraseNeeded)) throw error;
          rk = await readKey(text, await env.passphrase({ confirm: false }));
        }
      } catch (error) {
        if (error instanceof KeyError) stop(error.message);
        throw error;
      }
      if (rk.kind !== CURRENT) {
        stop('a rotation key is never kept on a device: give its file to the command it signs (--rotation-key FILE), or keep it in a wallet');
      }
      const owner = rk.owner || args.owner || f?.archive.owner;
      if (args.owner && rk.owner && args.owner !== rk.owner) stop(`the key is one of ${short(rk.owner)}, not of ${short(args.owner)}`);
      if (!owner || !OWNER_NAME.test(owner)) stop('the text names no owner: give --owner NAME');
      const who = short(owner);
      const log = f ? await keyLogOf(f, owner) : null;
      if (log) await log.check();
      const latest = log ? log.latest() : null;
      if (latest && !latest.keys.keys.includes(rk.key.did)) {
        env.warn(`${rk.key.did} is not a current key of v${latest.number} of the key log of ${who}: it signs nothing until a ` +
                 `version adds it (osheaf owner rotate --add ${rk.key.did})`);
      }
      let store;
      try {
        if ((await env.keyStore.current(owner, [rk.key.did])).length) {
          env.out(`The current key ${short(rk.key.did)} of ${who} is already on this computer.`);
          return;
        }
        store = await env.keyStore.keep(owner, rk.key);
      } catch (error) {
        if (error instanceof KeyError || error.code) stop(error.message);
        throw error;
      }
      env.out(`The current key ${short(rk.key.did)} of ${who} is now kept in ${env.keyStore.storeName(store)}.`);
    }

Forget keys
-----------

`osheaf key forget DID...` removes current keys from this device, after
listing them (whether each is a current key of the latest version of the
key log, without which this computer may no longer sign) and a
confirmation (`forget`, or `--yes`), as opensheaf-py asks it; a store that
fails to remove a key (a keychain that refuses, a folder that cannot be
written) is reported, and the command stops, instead of saying the key is
gone; with `--from-wallet`, from the wallet too, after a confirmation; `--used` with `--from-wallet` removes the keys of the wallet the
latest version of the key log no longer lists or commits. A rotation key
still committed is kept unless `--force`. `--passkey CRED` and `--rp RP`
remove passkey locks instead.

    // in forget keys:
    async function forgetHere(env, owner, dids) {
      const failed = [];
      for (const did of dids) {
        for (const [store, why] of (await env.keyStore.forget(owner, did)) || []) failed.push([did, store, why]);
      }
      if (failed.length) {
        stop('not removed from this computer:\n' + failed.map(([did, store, why]) =>
          `  ${short(did)} in ${env.keyStore.storeName?.(store) ?? store}: ${why}`).join('\n'));
      }
      if (dids.length) {
        env.out(`This computer no longer holds ${theKeys(dids.length, 'current key')} ${dids.map(short).join(', ')} of ${short(owner)}.`);
      }
    }

    export async function keyForget(f, args, env) {
      if (args.passkey || args.rp) return forgetPasskeyWraps(f, args, env);
      const [owner, log] = await ownerOf(f, args);
      const who = short(owner);
      const latest = log.latest();
      const listed = new Set(latest ? latest.keys.keys : []);
      const committed = new Set(latest ? latest.keys.next.map((d) => d.slice(0, 16)) : []);
      const dids = [...(args.did || [])];
      if (args.used) {
        if (!args.fromWallet || dids.length) stop('--used goes with --from-wallet, and names no key');
      } else if (!dids.length) {
        stop('name the keys to forget, by their did:key');
      }
      for (const did of dids) checkDid(did);
      if (!args.fromWallet) {
        env.err(`Removing ${theKeys(dids.length, 'current key')} of ${who} from this computer:`);
        for (const did of dids) {
          const use = listed.has(did) ? 'a current key of the latest version of the key log: without it, this computer ' +
            'may no longer sign' : 'not a current key of the latest version';
          env.err(`  ${short(did)}  (${use})`);
        }
        if (!(await confirmed(env, 'forget', args))) stop('not confirmed: nothing was removed');
        await forgetHere(env, owner, dids);
        return;
      }
      const w = await walletFor(f, args, env, owner);
      let rows;
      try {
        rows = await listing(w, owner);
      } catch (error) {
        walletStop(error);
      }
      const gone = args.used ? rows.filter((r) => !listed.has(r[3]) && !committed.has(r[1])) : rows.filter((r) => dids.includes(r[3]));
      const needed = gone.filter((r) => committed.has(r[1]));
      if (needed.length && !args.force) {
        stop(`${needed.map((r) => short(r[3])).join(', ')}: ${needed.length === 1 ? 'a rotation key' : 'rotation keys'} of the latest ` +
             'version of the key log, kept (an owner without enough of them to sign the next version can never change its keys, ' +
             'section 6.2); --force removes them');
      }
      const n = gone.length;
      if (n) {
        const here = dids.length ? `, and ${theKeys(dids.length, 'current key')} from this computer` : '';
        env.err(`Removing ${plural(n, 'key')} of ${who} from ${w.name}${here}:`);
        for (const r of gone) env.err(`  ${keyLabel(r[2], r[3])}`);
        if (!(await confirmed(env, 'forget', args))) stop('not confirmed: nothing was removed');
      }
      await forgetHere(env, owner, dids);
      if (!n) {
        env.out(`The wallet ${w.name} holds none of these keys of ${who}.`);
        return;
      }
      try {
        let i = 0;
        for (const [o, kid, kind, did] of gone) {
          await w.forget(o, kid, kind);
          env.err(`  ${++i}/${n} ${keyLabel(kind, did)}  removed`);
        }
      } catch (error) {
        walletStop(error);
      }
      env.out(`Done: ${plural(n, 'key')} of ${who} removed from ${w.name}.`);
    }

    async function forgetPasskeyWraps(f, args, env) {
      const cred = args.passkey || null, rp = args.rp || null;
      if (args.did?.length || args.used) stop('--passkey and --rp remove passkey locks, and name no key');
      const owner = keyOwner(f, args), w = await walletFor(f, args, env, owner);
      const who = short(owner);
      try {
        await w.checkWritable();
      } catch (error) {
        walletStop(error);
      }
      const todo = [];
      for (const [kid, text] of await walletEntries(w, owner)) {
        let fresh;
        try {
          fresh = removePasskeys(text, cred, rp);
        } catch (error) {
          if (error instanceof KeyError) stop(`${w.name} ${kid}: ${error.message}: nothing was changed`);
          throw error;
        }
        if (fresh.trim() !== text.trim()) todo.push([kid, describeEntry(text), fresh]);
      }
      const what = cred && rp ? `the ${rp} lock of the passkey ${cred}` : rp ? `the ${rp} passkey lock` : `the lock of the passkey ${cred}`;
      if (!todo.length) {
        env.out(`No key of ${who} in ${w.name} has ${what}.`);
        return;
      }
      const n = todo.length;
      env.err(`Removing ${what} from ${plural(n, 'key')} of ${who} in ${w.name}:`);
      for (const [, fields] of todo) env.err(`  ${keyLabel(fields.kind ?? '?', fields.key ?? '?')}`);
      if (!(await confirmed(env, 'forget', args))) stop('not confirmed: nothing was removed');
      try {
        let i = 0;
        for (const [kid, fields, fresh] of todo) {
          const kind = fields.kind ?? CURRENT;
          await w.write(owner, kid, kind, fresh);
          if (((await w.read(owner, kid, kind)) || '').trim() !== fresh.trim()) {
            throw new WalletError(`${w.name} did not keep the ${kind} key ${fields.key}`);
          }
          env.err(`  ${++i}/${n} ${keyLabel(kind, fields.key ?? kid)}  lock removed`);
        }
      } catch (error) {
        walletStop(error);
      }
      const groups = new Map();
      for (const [, , fresh] of todo) {
        const k = JSON.stringify(locks(fresh));
        groups.set(k, (groups.get(k) || 0) + 1);
      }
      const said = [...groups].map(([l, k]) => `${groups.size === 1 ? theKeys(k) : plural(k, 'key')} ${k === 1 ? 'opens' : 'open'} ` +
                                               `with ${lockWords(JSON.parse(l))}`);
      env.out('Done: ' + said.join('; ') + '.');
    }

Sign again
----------

A version of a line signed only by a key exposed later is contested
(section 7.3); its owner may sign it again (sections 6.4 and 7.1) with
current keys that are not exposed and have not signed it, after
confirming, by the first eight characters of the digest of its inventory,
that it made the version (unless `--yes`).

    // in sign again:
    export async function signAgain(f, args) {
      const env = f.env;
      const id = await lineOf(f, args.label);
      const dir = await f.dirOf(id);
      const inv = await f.inventory(dir);
      const ver = args.version;
      if (!(ver in inv.versions)) stop(`${args.label} has no object version ${ver}`);
      const owner = id.split(':')[2];
      const who = short(owner);
      if (!f.archiveOwners().includes(owner)) stop(`${args.label} is a line of an owner this archive does not host: only its owner signs it`);
      const { log, latest, signers } = await f.signingKeys(owner);
      const { statuses } = await f.line(id);
      const status = statuses[Number(ver.slice(1)) - 1];
      if (status !== CONTESTED) {
        stop(`${args.label} ${ver} is ${status}: signing again is for a version contested by an exposed key (section 7.1)`);
      }
      const wdir = joinPath(dir, WITNESSES, ver);
      const held = new Set(((await f.storage.list(wdir)) || []).filter((e) => e.kind === 'file').map((e) => e.name));
      const exposed = log.exposedKeys();
      const fresh = [];
      for (const k of signers) if (!exposed.has(k.did) && !held.has(await signatureFileName(k.did))) fresh.push(k);
      const need = latest.keys.threshold;
      if (fresh.length < need) {
        stop(`this computer holds ${plural(fresh.length, 'current key')} of ${who} that ${fresh.length === 1 ? 'has' : 'have'} ` +
             `not signed ${ver}, and v${latest.number} of the key log needs ${need}`);
      }
      const dig = await sha512hex(await f.storage.read(joinPath(dir, ver, 'inventory.json')));
      if (!args.yes) {
        const entry = inv.versions[ver];
        const doc = (await f.readObjectJson(dir, inv, OBJ, ver))?.documentVersion;
        env.out(`Signing ${args.label} ${ver} again, with ${plural(fresh.length, 'current key')} of ${who}:`);
        env.out(`  document version ${doc}, deposited ${entry.created}` + (entry.message ? `: ${entry.message}` : ''));
        env.out(`Sign it again only if ${who} made this version.`);
        if (!(await confirmed(env, dig.slice(0, 8)))) stop('not confirmed: nothing was signed');
      }
      const pin = log.pin(latest.number);
      for (const key of fresh) {
        await f.storage.write(joinPath(wdir, await signatureFileName(key.did)),
                              await signatureFile(key, id, ver, dig, owner, pin), { exclusive: true });
      }
      f.changed();
      await writeDiscovery(f);
      const now = (await f.line(id)).statuses[Number(ver.slice(1)) - 1];
      env.out(`Done: ${args.label} ${ver} signed again by ${plural(fresh.length, 'key')} of ${who}, under v${latest.number} ` +
              `of the key log; it is now ${now}.`);
    }
