// Generated from literate/27-init.md by opensheaf-literate: edit the document, not this file.
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
  if (args.keeper && !keeperValid(args.keeper, true)) {
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

export const GITIGNORE = ['texmacs_home/', '.staging-*'];

async function keepOutOfGit(storage) {
  const bytes = (await storage.kind('.gitignore')) === 'file' ? await storage.read('.gitignore') : null;
  const ignore = bytes ? new TextDecoder().decode(bytes) : '';
  const lines = ignore.split(/\r\n|\r|\n/);
  const missing = GITIGNORE.filter((x) => !lines.includes(x));
  if (missing.length) {
    await writeText(storage, '.gitignore', ignore + (ignore && !ignore.endsWith('\n') ? '\n' : '') +
                    missing.map((x) => `${x}\n`).join(''));
  }
}

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
  await keepOutOfGit(storage);
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
