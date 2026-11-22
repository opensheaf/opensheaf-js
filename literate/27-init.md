A new owner, a new archive
==========================

`osheaf init DIR --new-owner --export KEYS` makes an archive and the
owner who signs it, in one command, as opensheaf-py's `init` and `owner
init` do (its chapters
[18-init](https://opensheaf.org/opensheaf-py/18-init.html) and
[19-owner-commands](https://opensheaf.org/opensheaf-py/19-owner-commands.html)):

1. the owner (section 6.2): a current key for this device, kept in its
   key store; rotation keys, three by default, any two of which sign the
   next version of the key log, exported once to files outside the
   archive; the genesis record that commits to them; and the first
   version of its key log, computed from the record, in the storage root;
2. the configuration `osheaf.json`, the storage root, and the
   `.gitattributes` that keeps git from changing the archive's bytes
   (OpenSheaf archives in git, section 4.1);
3. the owner's owner catalogue (section 8.1), labelled `main`, sealed and
   signed, with no members;
4. the discovery document and the indexes;
5. the website (profile `website`, chapter [31](31-website.md)): the
   templates copied into `templates/`, where the curator edits them, and
   the pages, with the configuration `"index": {"html": {"templates":
   "templates"}}`, as opensheaf-py writes it.

An archive may also be made for an owner that exists already, whose key
log is copied from the folder of its owner object in another archive
(`--owner NAME --key-log DIR`). The keys of a new owner go where its
security level says: the rotation keys exported to files (`--export
DIR`, the maximum), or kept in a key wallet (`--keys
github:OWNER/REPO|command`, chapters [35](35-wallets.md) and
[37](37-owner-commands.md)), with its current key. The TeXmacs index
(`--index texmacs`) is opensheaf-py's.

The module is `core/init.js`.

    // in core/init.js:
    import { keeperValid, didKeyPublic } from './names.js';
    import { readRotationKey, rotationKeyText, rotationFileName, rotationKeySheet, sheetCheck, KeyError } from './keys.js';
    import { newOwner, writeKeyLog, jsonText } from './write.js';
    import { writeText } from './storage.js';
    import { ArchiveFolder, CONFIG_NAME, CONFIG_NAMES, LAYOUTS, exit, stop, short, plural } from './folder.js';
    import { collect } from './collect.js';
    import { writeDiscovery } from './discovery.js';
    import { readableIndex, TEMPLATES } from './website.js';
    import { levelWallet, keepInWallet, walletConfig, keptWhere } from './owner.js';
    import { loadKeyLog, OwnerError } from './keylogs.js';

    <<the messages of owners>>

    <<exporting the rotation keys>>

    <<a new owner>>

    <<a new archive>>

The messages of owners
----------------------

    // in the messages of owners:
    export const SINGLE_ROTATION_RISK = 'With a single rotation key, its loss leaves the owner unable ever to change ' +
      'its keys or end, and its theft lets the thief take the owner over (sections 6.2 and 15.1).';
    export const ROTATION_KEYS_WARNING = 'Keep the rotation keys safe: an owner left with fewer of them than the next ' +
      'version of its key log needs to sign can never change its keys or end (section 6.2).';

    export function keyLabel(kind, did) {
      return `${kind} key`.padEnd(14) + short(did);
    }

    export function rotationLine(n, nextThreshold, where, isNew = false) {
      const verb = nextThreshold === 1 ? 'signs' : 'sign';
      const more = n === 1 ? '' : `; any ${nextThreshold} of them ${verb} the next version of the key log`;
      return `  rotation keys  ${n}${isNew ? ' new' : ''}, kept in ${where}${more}`;
    }

Exporting the rotation keys
---------------------------

The rotation keys are written to a folder outside the archive (section
15.4: keys are never kept in an archive), one file each, locked with a
passphrase unless `--no-passphrase`; each file is read back and checked
before anything is written to the key log. The person then confirms that
the files are put away by typing their checks, unless `--yes`. If they do
not, nothing is written to the key log, and the owner is not made.

    // in exporting the rotation keys:
    export async function exportAndConfirm(f, rotation, owner, version, args) {
      const env = f.env;
      const secret = args.noPassphrase ? null : await env.passphrase({ confirm: true });
      const ex = env.exportFolder;
      const inside = await ex.inside(args.export);
      if (inside) stop(`${args.export} is inside the archive ${inside}: keys are never kept in an archive (section 15.4)`);
      const paths = [];
      try {
        for (const key of rotation) {
          const path = await ex.write(args.export, rotationFileName(owner, key),
                                      await rotationKeyText(key, owner, version, secret, args.cost || env.cost));
          if ((await readRotationKey(await ex.read(path), secret)).key.did !== key.did) {
            throw new KeyError(`${path} does not read back`);
          }
          paths.push(path);
        }
      } catch (error) {
        if (error instanceof KeyError) stop(error.message);
        throw error;
      }
      const lock = secret !== null ? 'locked with your passphrase' : 'with no lock (--no-passphrase)';
      env.out(`Exported ${plural(rotation.length, 'rotation key')} of ${short(owner)} to ${args.export}, ${lock}:`);
      for (const key of rotation) {
        env.out(`  ${keyLabel('rotation', key.did)}  ${rotationFileName(owner, key)}  check ${await sheetCheck(key.seed)}`);
      }
      if (args.print) for (const key of rotation) env.out(await rotationKeySheet(key, owner, version));
      if (args.yes) return paths;
      env.out('Put the files (or the printed sheets) away, apart from this computer and from each other.');
      for (const key of rotation) {
        const typed = (await env.input(`Type the check of ${rotationFileName(owner, key)} to confirm: `)).trim().toUpperCase();
        if (typed !== await sheetCheck(key.seed)) {
          stop('not confirmed: nothing was written to the key log (the exported files may be deleted)');
        }
      }
      return paths;
    }

A new owner
-----------

The thresholds are checked (section 6.1, rule 1): at least one, at most
the number of keys they count; the current keys of other devices
(`--key DID`, made there with `osheaf key new`) are checked as did:key
URIs of Ed25519 keys; and the keeper, if given, is an ORCID iD with its
check digit or `https://<domain>/` (section 6.6). The genesis record is
made again, with a new nonce, in the unlikely case that its owner object
exists in the storage root already.

    // in a new owner:
    export async function ownerInit(f, args, { done = true } = {}) {
      const env = f.env;
      const single = Boolean(args.singleRotationKey);
      const nRot = single ? 1 : Number(args.rotation || 3);
      const nextThreshold = single ? 1 : Number(args.nextThreshold || Math.floor(nRot / 2) + 1);
      const others = [...(args.key || [])];
      const threshold = Number(args.threshold || 1);
      if (!(nextThreshold >= 1 && nextThreshold <= nRot) || !(threshold >= 1 && threshold <= 1 + others.length)) {
        stop('a threshold is at least 1, and at most the number of keys (section 6.1, rule 1)');
      }
      if (args.keeper && !keeperValid(args.keeper)) {
        stop(`a keeper is an ORCID iD (with its check digit) or https://<domain>/: ${args.keeper}`);
      }
      const w = await levelWallet(f, args);
      if (!w && !args.export) {
        stop('give --export DIR, a folder outside the archive where the rotation keys are written ' +
             '(or keep them in a wallet, a lower security level: --keys github:OWNER/REPO|command)');
      }
      if (w && args.noPassphrase) stop('--no-passphrase: the keys in a wallet are always locked with a passphrase');
      if (!w && !env.keyStore.keptOnDevice()) {
        stop('OPENSHEAF_KEY_STORE=none keeps no current key on this computer: keep the keys in a ' +
             'wallet (--keys github:OWNER/REPO|command)');
      }
      for (const did of others) {
        try {
          didKeyPublic(did);
        } catch {
          stop(`not a did:key URI of an Ed25519 key: ${did}`);
        }
      }
      const current = await env.newKey();
      const rotation = [];
      for (let k = 0; k < nRot; k++) rotation.push(await env.newKey());
      let log;
      for (;;) {
        try {
          log = await newOwner([current, ...others], rotation, { threshold, nextThreshold, keeper: args.keeper || null });
        } catch (error) {
          stop(error.message);
        }
        if (!(await f.storage.kind(await f.dirOf(log.id)))) break;
      }
      if (nextThreshold === 1) env.warn(SINGLE_ROTATION_RISK);
      if (args.export) await exportAndConfirm(f, rotation, log.owner, 1, args);
      if (w) await keepInWallet(f, w, log.owner, rotation, 1, args, [[current, 1]]);
      let store;
      try {
        store = await env.keyStore.keep(log.owner, current);
      } catch (error) {
        if (error instanceof KeyError || error.code) stop(error.message);
        throw error;
      }
      await writeKeyLog(f.storage, await f.dirOf(log.id), log);
      f.changed();
      const kept = store === 'none' ? `${w.name} only (OPENSHEAF_KEY_STORE=none)` : env.keyStore.storeName(store);
      env.out(`${done ? 'Done: the' : 'The'} owner ${short(log.owner)} is made, with v1 of its key log:`);
      env.out(`  owner          ${log.owner}`);
      env.out(`  current key    ${current.did}, kept in ${kept}`);
      for (const did of others) env.out(`  current key    ${did}, of another device`);
      const resolved = args.export ? await env.exportFolder.resolve(args.export) : null;
      env.out(rotationLine(nRot, nextThreshold, keptWhere(args, w, resolved)));
      env.warn(ROTATION_KEYS_WARNING);
      return log;
    }

A new archive
-------------

The configuration of a new archive takes its name, base URL (with a final
`/`), contact (by default the base URL) and curator (`"Family, Given"`)
from the options; the depositor named in every inventory is the curator,
as `Given Family`, at the contact address. The storage layout is the
owner-name layout of section 3.2 unless `--layout hashed`.

    // in a new archive:
    export const GITATTRIBUTES = `# OpenSheaf archive files: stored and checked out byte for byte,
    # never merged as text (OpenSheaf archives in git, section 4.1). Every
    # attribute is named, so that no attribute of the user's own settings (a
    # user-wide \`*.pdf filter=lfs\`, for instance) applies to them.
    opensheaf.json -text -filter -ident -working-tree-encoding -export-subst -merge
    ocfl/**        -text -filter -ident -working-tree-encoding -export-subst -merge
    indexes.json   -text -filter -ident -working-tree-encoding -export-subst -merge
    names/**       -text -filter -ident -working-tree-encoding -export-subst -merge
    owners/**      -text -filter -ident -working-tree-encoding -export-subst -merge
    sha512/**      -text -filter -ident -working-tree-encoding -export-subst -merge
    *.pdf binary
    `;

    export async function init(storage, env, args, where) {
      for (const n of CONFIG_NAMES) if (await storage.kind(n)) exit(`${where} has a configuration already`);
      const layout = LAYOUTS[args.layout || 'owner-name'];
      if (!layout) exit(`--layout is one of ${Object.keys(LAYOUTS).join(', ')}`);
      if (Boolean(args.newOwner) === Boolean(args.owner)) stop('init: give --new-owner, or --owner NAME --key-log DIR');
      if (args.index && args.index !== 'website') {
        stop(`--index ${args.index}: the TeXmacs index is made by opensheaf-py`);
      }
      if (!args.name || !args.baseUrl || !args.curator) stop('init: give --name, --base-url and --curator');
      const [family, given] = (() => {
        const k = args.curator.indexOf(',');
        return k < 0 ? [args.curator.trim(), ''] : [args.curator.slice(0, k).trim(), args.curator.slice(k + 1).trim()];
      })();
      const cfg = {
        owner: null,
        name: args.name,
        contact: args.contact || args.baseUrl,
        baseUrl: args.baseUrl.endsWith('/') ? args.baseUrl : args.baseUrl + '/',
        profiles: ['website'],
        storageLayout: layout,
        curator: { name: given ? `${family}, ${given}` : family, givenName: given, familyName: family,
                   affiliation: args.affiliation || '' },
        depositor: { name: `${given} ${family}`.trim(), address: args.contact || args.baseUrl },
        index: { html: { templates: 'templates' } },
      };
      const f = new ArchiveFolder(storage, env);
      f.archive = { ...cfg };
      f.layout = layout;
      await f.initStorageRoot();
      let log;
      if (args.newOwner) {
        log = await ownerInit(f, args, { done: false });
      } else {
        if (!args.keyLog) stop('init --owner NAME needs --key-log DIR, the folder of its owner object');
        try {
          const { storage: from, dir, where: shown } = args.keyLogSource;
          log = await loadKeyLog(from, dir, shown);
        } catch (error) {
          if (error instanceof OwnerError) stop(error.message);
          throw error;
        }
        const { errors } = await log.check();
        if (log.owner !== args.owner || errors.length) {
          stop(`${args.keyLog} is not a valid key log of ${short(args.owner)}: ` + errors.join('; '));
        }
        if (log.ended) stop(`the owner ${short(log.owner)} has ended (section 6.3)`);
        await writeKeyLog(storage, await f.dirOf(log.id), log);
        f.changed();
      }
      cfg.owner = log.owner;
      if (args.newOwner && walletConfig(args, log.owner)) cfg.keys = walletConfig(args, log.owner);
      await writeText(storage, CONFIG_NAME, jsonText(cfg));
      if (!(await storage.kind('.gitattributes'))) await writeText(storage, '.gitattributes', GITATTRIBUTES);
      for (const name of TEMPLATES) {
        if (!(await storage.kind(`templates/${name}`))) await storage.write(`templates/${name}`, await env.template(name));
      }
      await f.configure();
      await collect(f, { curated: args.curated });
      await writeDiscovery(f);
      await readableIndex(f);
      if (cfg.keys) {
        env.out(`The key wallet ${args.keys} is recorded in ${CONFIG_NAME} for ${short(log.owner)} ` +
                `(osheaf key wallet --remove ${args.keys} removes it).`);
      }
      env.out(`Done: the archive is made in ${where}, owned by ${short(log.owner)}. Edit ${CONFIG_NAME} and ` +
              'templates/, then deposit a paper: osheaf deposit --new LABEL ...');
      env.err('Note: OpenSheaf 0.2 is a draft; until version 1.0 a revision may change the format in incompatible ' +
              'ways, and archives may have to be rebuilt.');
      return f;
    }
