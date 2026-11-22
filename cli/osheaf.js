// Generated from literate/40-cli.md by opensheaf-literate: edit the document, not this file.
import process from 'node:process';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DiskStorage } from './disk.js';
import { keyStore, exportFolder, passphrases, readLine } from './keystore.js';
import { outside } from './outside.js';
import { enroll, unlock, systemBrowser } from './unlock.js';
import { ArchiveFolder, environment, Stop, CONFIG_NAMES, REBUILD, sentence } from '../core/folder.js';
import { init } from '../core/init.js';
import { deposit, checkRights } from '../core/deposit.js';
import { collect } from '../core/collect.js';
import { writeDiscovery } from '../core/discovery.js';
import { verifyFolder, findingsJson } from '../core/check.js';
import { loadSchemas } from '../core/schema.js';
import { notice, withdraw, complete, relate, relicense, describe, RELATIONS } from '../core/describe.js';
import * as collections from '../core/collections.js';
import { present, readableIndex, hasWebsite, labelCommand } from '../core/website.js';
import { fetchJsonWith } from '../core/keepers.js';
import { loadEntries, merge, UsageProblem } from '../core/inputs.js';
import * as owners from '../core/owner.js';
import { loadKeyLog, OwnerError } from '../core/keylogs.js';
import { CONFIG_HELP } from '../core/wallets.js';
import { resolveCommand, mirror } from '../core/mirror.js';
import { branch, accept } from '../core/branch.js';
import { draftDeposit, draftDelete, seal } from '../core/drafts.js';
import { takedown } from '../core/takedown.js';
import { fetchPapers, authorPapers, politeGetter, importCommand } from '../core/arxiv.js';
import { Zenodo, SERVICES, zenodoCommand } from '../core/zenodo.js';
import { securityCommand } from './keystore.js';
import os from 'node:os';
import zlib from 'node:zlib';
import { existsSync } from 'node:fs';

export const VERSION = '0.1.0';

const flag = (dest) => ({ dest, flag: true });
const value = (dest, extra = {}) => ({ dest, ...extra });
const int = (dest, extra = {}) => ({ dest, type: 'int', ...extra });

const DEPOSIT = {
  positionals: ['label', 'source'],
  options: {
    '--pdf': value('pdf'), '--no-source': value('noSource'), '--source-format': value('sourceFormat'),
    '--abstract': value('abstract'), '--abstract-file': value('abstractFile'),
    '--keyword': value('keyword', { repeat: true }), '--language': value('language'),
    '--toolchain': value('toolchain', { repeat: true }), '--title': value('title'),
    '--author': value('author', { repeat: true }), '--available': value('available'), '--date': value('available'),
    '--created': value('created'), '--issued': value('issued'), '--date-info': value('dateInfo'),
    '--stage': value('stage', { choices: ['AO', 'SMUR', 'AM', 'P', 'VoR', 'CVoR', 'EVoR'] }),
    '--changes': value('changes'), '--after': int('after'), '--type': value('type'),
    '--rights': value('rights', { check: checkRights }), '--related': value('related', { repeat: true }),
    '--extra-source': value('extraSource', { repeat: true }), '--message': value('message'),
    '--agreement': value('agreement'), '--licence-file': value('licenceFile'), '--i-know': flag('iKnow'),
    '--new': flag('new'), '--owner': value('owner'), '--from': value('fromFile'),
  },
  defaults: { type: 'Preprint' },
};

const I_KNOW = { '--i-know': flag('iKnow') };
const DRAFT_DEPOSIT = {
  positionals: ['draft', 'source'],
  options: Object.fromEntries(Object.entries(DEPOSIT.options).filter(([o]) => !['--new', '--owner', '--from'].includes(o))),
};
const MEMBERS = (more) => ({ positionals: ['collection!', 'uri+'], options: { ...more, '--message': value('message') } });

const EXPORT = { '--export': value('export'), '--no-passphrase': flag('noPassphrase'), '--print': flag('print'),
                 '--yes': flag('yes') };
const level = (fresh) => ({ '--keys': value('keys'), ...(fresh ? { '--plain-current': flag('plainCurrent') } : {}) });
const OWNER_INIT = { '--threshold': int('threshold'), '--key': value('key', { repeat: true }), '--rotation': int('rotation'),
                     '--next-threshold': int('nextThreshold'), '--single-rotation-key': flag('singleRotationKey'),
                     '--keeper': value('keeper'), ...EXPORT, ...level(true) };
const CHANGE = { '--threshold': int('threshold'), '--rotation': int('rotation'), '--next-threshold': int('nextThreshold') };
const ROTATION_OPTIONS = { '--rotation-key': value('rotationKey', { repeat: true }), '--owner': value('owner'),
                           '--message': value('message') };
const WALLET = { '--owner': value('owner'), '--wallet': value('wallet') };

export const COMMANDS = {
  init: {
    help: 'create an archive (osheaf.json, storage root, owner, owner catalogue)',
    positionals: ['folder'],
    options: {
      '--name': value('name'), '--base-url': value('baseUrl'), '--curator': value('curator'),
      '--affiliation': value('affiliation'), '--contact': value('contact'),
      '--layout': value('layout', { choices: ['owner-name', 'hashed'] }), '--owner': value('owner'),
      '--key-log': value('keyLog'), '--new-owner': flag('newOwner'), '--threshold': int('threshold'),
      '--key': value('key', { repeat: true }), '--rotation': int('rotation'), '--next-threshold': int('nextThreshold'),
      '--single-rotation-key': flag('singleRotationKey'), '--keeper': value('keeper'), '--export': value('export'),
      '--no-passphrase': flag('noPassphrase'), '--print': flag('print'), '--yes': flag('yes'),
      '--keys': value('keys'), '--plain-current': flag('plainCurrent'), '--curated': flag('curated'),
      '--index': value('index', { choices: ['website', 'texmacs'] }), '--index-template': value('indexTemplate'),
      '--from': value('fromFile'),
    },
  },
  deposit: { help: 'deposit a document (any source with --pdf); --new seals a new work under a new label', ...DEPOSIT },
  relicense: {
    help: 'description-only version with a new licence', positionals: ['label'],
    options: { '--rights': value('rights', { check: checkRights }), '--method': value('method'),
               '--date': value('date'), '--message': value('message'), '--from': value('fromFile'), ...I_KNOW },
  },
  relate: {
    help: 'description-only version linking the same work elsewhere', positionals: ['label'],
    options: { '--to': value('to'), '--relation': value('relation', { choices: RELATIONS }),
               '--issued': value('issued'), '--message': value('message'), '--from': value('fromFile'), ...I_KNOW },
    defaults: { relation: 'IsIdenticalTo' },
  },
  describe: {
    help: 'description-only version correcting the title, abstract, keywords or authors', positionals: ['label'],
    options: { '--title': value('title'), '--abstract': value('abstract'), '--abstract-file': value('abstractFile'),
               '--keyword': value('keyword', { repeat: true }), '--author': value('author', { repeat: true }),
               '--message': value('message'), '--from': value('fromFile'), ...I_KNOW },
  },
  notice: {
    help: 'a notice about a document version (description-only)', positionals: ['label!'],
    options: { '--about': int('about', { required: true }), '--text': value('text', { required: true }),
               '--file': value('file'), '--date': value('date'), '--message': value('message'), ...I_KNOW },
  },
  withdraw: {
    help: 'withdraw a document (description-only; the content stays)', positionals: ['label!'],
    options: { '--reason': value('reason', { required: true }), '--file': value('file'), '--date': value('date'),
               '--message': value('message'), ...I_KNOW },
  },
  complete: {
    help: 'add the sources of a version deposited without them', positionals: ['label!'],
    options: { '--version': int('version', { required: true }), '--source': value('source', { required: true }),
               '--extra-source': value('extraSource', { repeat: true }), '--source-format': value('sourceFormat'),
               '--message': value('message'), ...I_KNOW },
  },
  collect: { help: 'new versions of the owner catalogues when needed', positionals: [],
             options: { '--owner': value('owner'), '--i-know': flag('iKnow') } },
  collection: {
    help: 'catalogues and selections, with members of any archive',
    actions: {
      new: { help: 'a new, empty collection', positionals: ['label!'],
             options: { '--type': value('type', { choices: ['catalogue', 'selection'], required: true }),
                        '--title': value('title', { required: true }), '--description': value('description'),
                        '--order': value('order', { choices: ['manual', 'issued-desc', 'issued-asc'] }),
                        '--owner': value('owner') } },
      add: { help: 'add members, or revisions of a member of a selection',
             ...MEMBERS({ '--revision': int('revision', { repeat: true }), '--at': value('at', { repeat: true }),
                          '--follow': flag('follow') }) },
      remove: { help: 'remove members, or revisions', ...MEMBERS({ '--revision': int('revision', { repeat: true }) }) },
      follow: { help: 'members of a catalogue that follow their lines', ...MEMBERS({ '--off': flag('off') }) },
      update: { help: 'follow the members that follow their lines', positionals: ['collection*'], options: {} },
      status: { help: 'the status of every member (section 8.5)', positionals: ['collection!'], options: {} },
      sync: { help: 'write a collection from collection.yaml', positionals: ['collection!'],
              options: { '--from': value('fromFile', { required: true }), '--message': value('message') } },
    },
  },
  index: { help: 'write opensheaf.json, the indexes and the website', positionals: [],
           options: { '--no-html': flag('noHtml') } },
  verify: { help: 'check the archive (section 14 of the specification)', positionals: [],
            options: { '--remote': flag('remote'), '--json': flag('json') } },
  resolve: { help: 'find and check what a sheaf: URI names (section 12.3)', positionals: ['uri!'],
             options: { '--at': value('at', { repeat: true }), '--json': flag('json') } },
  mirror: { help: "copy a line written elsewhere, with its owner's key log (section 11)", positionals: ['uri'],
            options: { '--at': value('at', { repeat: true }), '--label': value('label'), '--all': flag('all'),
                       '--licence-checked': flag('licenceChecked') } },
  branch: { help: 'a branch of a signed version of another line (section 9)', positionals: ['uri!'],
            options: { '--at': value('at', { repeat: true }), '--label': value('label'), '--message': value('message'),
                       '--owner': value('owner') } },
  accept: { help: 'an accepted copy, listed in a selection (section 9.6)', positionals: ['uri!'],
            options: { '--at': value('at', { repeat: true }), '--label': value('label'), '--message': value('message'),
                       '--selection': value('selection', { required: true }), '--with-original': flag('withOriginal') } },
  draft: {
    help: 'unsigned work in progress at draft/<id>/ (section 10.1)',
    actions: {
      new: { help: 'make a draft with a first deposit', ...DRAFT_DEPOSIT, defaults: { type: 'Preprint' } },
      deposit: { help: 'deposit a new version into a draft', ...DRAFT_DEPOSIT,
                 options: { ...DRAFT_DEPOSIT.options, '--replace': flag('replace') }, defaults: { type: 'Preprint' } },
      delete: { help: 'delete a draft (no tombstone)', positionals: ['draft!'], options: {} },
    },
  },
  seal: { help: 'seal the work of a draft as a new line (section 10.2)', positionals: ['draft!'],
          options: { '--label': value('newLabel', { required: true }), '--owner': value('owner'),
                     '--delete-draft': flag('deleteDraft'), '--message': value('message') } },
  label: { help: 'give a line a label, change it, or remove it (--unset); the old address of its page redirects',
           positionals: ['line', 'label'], options: { '--owner': value('owner'), '--unset': flag('unset') } },
  takedown: { help: 'delete an object, leaving a tombstone (section 13.2)', positionals: ['label!'],
              options: { '--reason': value('reason', { required: true }), '--by-law': flag('byLaw'),
                         '--keeper': flag('keeper'), '--yes': flag('yes') },
              exclusive: [['--by-law', '--keeper']] },
  owner: {
    help: 'make an owner, change its keys, end it, show its key log',
    actions: {
      init: { help: 'make an owner: current key, rotation keys exported, key log', positionals: [], options: OWNER_INIT },
      rotate: { help: 'a new version of the key log: add or retire current keys', positionals: [],
                options: { '--add': value('add', { repeat: true }), '--retire': value('retire', { repeat: true }),
                           ...CHANGE, ...ROTATION_OPTIONS, ...EXPORT, ...level(true) } },
      expose: { help: 'a new version of the key log exposing stolen or leaked keys', positionals: ['exposed+'],
                options: { '--add': value('add', { repeat: true }), ...CHANGE, ...ROTATION_OPTIONS, ...EXPORT, ...level(true) } },
      end: { help: 'the last version of the key log (section 6.3)', positionals: [],
             options: { '--successor': value('successor'), '--expose': value('expose', { repeat: true }),
                        ...ROTATION_OPTIONS, ...level(false) } },
      show: { help: 'the key log of the owner', positionals: [],
              options: { '--owner': value('owner'), '--offline': flag('offline') } },
      pull: { help: 'meet another copy of the key log: extend it, or record a fork', positionals: ['place!'],
              options: { '--owner': value('owner') } },
    },
  },
  sign: { help: 'sign again a version contested by an exposed key (section 7.1)', positionals: ['label!'],
          options: { '--version': value('version', { required: true }), '--yes': flag('yes') } },
  key: {
    help: 'current keys of this device, key wallets, password managers',
    actions: {
      new: { help: 'a new current key for this device; prints its did:key', positionals: [], options: { '--owner': value('owner') } },
      push: { help: 'put the current keys of this device into the key wallet', positionals: ['did*'],
              options: { '--plain-current': flag('plainCurrent'), ...WALLET } },
      pull: { help: "keep on this device the owner's current keys that the wallet holds", positionals: [], options: WALLET },
      list: { help: 'what the key wallet holds, as a table: owner, kind, key, version, locks (no secrets)', positionals: [],
              options: WALLET },
      forget: { help: 'remove keys from this device, and with --from-wallet from the wallet; or passkey locks (--passkey, --rp)',
                positionals: ['did*'],
                options: { '--from-wallet': flag('fromWallet'), '--used': flag('used'), '--passkey': value('passkey'),
                           '--rp': value('rp'), '--force': flag('force'), '--yes': flag('yes'), ...WALLET } },
      export: { help: 'copy a current key to the clipboard, for a password manager', positionals: ['did'],
                options: { '--owner': value('owner'), '--clipboard': flag('clipboard'), '--stdout': flag('stdout'),
                           '--encrypt': flag('encrypt') } },
      import: { help: 'keep on this device a key copied from a password manager', positionals: [],
                options: { '--clipboard': flag('clipboard'), '--stdin': flag('stdin'), '--owner': value('owner') } },
      enroll: { help: 'let a passkey (Touch ID, in the browser) open the keys of the wallet', positionals: [],
                options: { '--new-passkey': flag('newPasskey'), ...WALLET, '--no-browser': flag('noBrowser') } },
      unlock: { help: 'open the keys of the wallet with the passkey; pull the current keys', positionals: [],
                options: { ...WALLET, '--no-browser': flag('noBrowser') } },
      wallet: { help: "the key wallets in which the owner's keys are looked for; hint one for the owner in osheaf.json " +
                      '(--add), or remove a hint (--remove)', positionals: [],
                options: { '--owner': value('owner'), '--add': value('add'), '--remove': value('remove') } },
      wallets: { help: 'your key wallets, with the owners whose keys each holds and their locks; add one to your ' +
                       'configuration (--add), or remove one (--remove)', positionals: [],
                 options: { '--add': value('add'), '--remove': value('remove') } },
    },
  },
  'help-config': { help: 'describe osheaf.json and your own configuration (key wallets)', positionals: [], options: {} },
  zenodo: {
    help: 'deposit the current document version on Zenodo (appendix A.1)', positionals: ['label!'],
    options: { '--production': flag('production'), '--keep': flag('keep') },
  },
  arxiv: {
    help: 'download from arXiv, import into the archive',
    actions: {
      fetch: { help: 'download papers from arXiv (no archive needed)', positionals: ['downloads!', 'ids*'],
               options: { '--author': value('author'), '--refresh': flag('refresh') } },
      import: { help: 'import the downloads, one signed line per paper', positionals: ['downloads!', 'ids*'],
                options: { '--dry-run': flag('dryRun'), '--texmacs': value('texmacs', { repeat: true }),
                           '--versions': value('versions'), '--update': flag('update'), '--identifiers': value('identifiers'),
                           '--rebuild': flag('rebuild'), '--agreement': value('agreement'),
                           '--agreed-by': value('agreedBy', { repeat: true }) } },
    },
  },
};

const METAVARS = { label: 'LABEL', collection: 'LABEL', uri: 'URI', source: 'SOURCE', folder: 'FOLDER', did: 'DID', draft: 'DRAFT',
                   exposed: 'DID', place: 'URL|PATH', downloads: 'DOWNLOADS', ids: 'ARXIV-ID' };

function positional(p) {
  const m = /^([a-zA-Z]+)([!+*]?)$/.exec(p);
  return { name: m[1], kind: m[2], metavar: METAVARS[m[1]] || m[1].toUpperCase() };
}

const CONFIG_DOC = `An archive is a folder with a configuration file osheaf.json:

    {
      "owner": "<owner name>",           the owner of the archive (section 6), who signs
                                         its documents and its owner catalogue
      "owners": ["<owner name>", ...],   optional: other owners it hosts, each with its own
                                         owner catalogue (section 8.1)
      "name": "...", "contact": "https://...", "baseUrl": "https://.../",
      "profiles": ["website"],
      "storageLayout": "opensheaf-owner-name-storage-layout",   or
                       "0003-hash-and-id-n-tuple-storage-layout" (section 3.2)
      "curator": {"name": "Family, Given", "givenName": "...", "familyName": "...",
                  "affiliation": "..."},
      "depositor": {"name": "Given Family", "address": "https://..."},
      "index": {"html": {"templates": "templates", "featured": "<label>"}},
      "keys": {"<owner name>": {"wallets": ["github:OWNER/REPO", ...]}, ...}   optional:
                                         hints, the GitHub key wallets that hold the keys of
                                         each owner (osheaf key wallet --add|--remove); a
                                         general {"wallet": ...} is a hint for every owner;
                                         your own wallets are in ~/.config/opensheaf/config.json
      "formerAddresses": {"<address>": "sheaf:<name>:<owner>"}   written by osheaf label:
                                         the old addresses of relabelled lines, which redirect
    }

The private keys of the owner are never in the archive (section 15.4): the
current key of this device is kept in the keychain (macOS) or in
~/.config/opensheaf/keys/, the rotation keys in files exported once to a
folder outside the archive (osheaf owner init --export DIR), unless the owner
chooses a lower security level, a key wallet, which keeps them encrypted
under a passphrase (--keys github:OWNER/REPO, a private repository, or
--keys command); OPENSHEAF_WALLET overrides "keys", and only it and
~/.config/opensheaf/config.json may configure a command wallet.
`;

export class UsageError extends Error {}

function option(spec, given, cmd) {
  if (Object.hasOwn(spec.options, given)) return given;
  const matches = Object.keys(spec.options).filter((o) => o.startsWith(given));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new UsageError(`osheaf ${cmd}: error: ambiguous option: ${given} could match ${matches.join(', ')}`);
  throw new UsageError(`osheaf ${cmd}: error: unrecognized arguments: ${given}`);
}

export function parseArgs(argv) {
  const out = { root: null, cmd: null, args: {} };
  let k = 0;
  for (; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--root') out.root = argv[++k];
    else if (a.startsWith('--root=')) out.root = a.slice(7);
    else if (a === '--version' || a === '-h' || a === '--help') return { ...out, cmd: a };
    else break;
  }
  out.cmd = argv[k++] ?? null;
  if (out.cmd === null) throw new UsageError('osheaf: error: the following arguments are required: command');
  let spec = COMMANDS[out.cmd];
  if (!spec) return out;
  let where = out.cmd;
  if (spec.actions) {
    const action = argv[k++];
    if (action === '-h' || action === '--help') {
      out.args = { help: true };
      return out;
    }
    if (action === undefined) throw new UsageError(`osheaf ${out.cmd}: error: the following arguments are required: action`);
    if (!Object.hasOwn(spec.actions, action)) {
      throw new UsageError(`osheaf ${out.cmd}: error: argument action: invalid choice: '${action}' (choose from ` +
                           `${Object.keys(spec.actions).map((c) => `'${c}'`).join(', ')})`);
    }
    out.action = action;
    spec = spec.actions[action];
    where = `${out.cmd} ${action}`;
  }
  const args = { ...(spec.defaults || {}) };
  const k0 = k;
  for (const o of Object.values(spec.options)) if (o.repeat) args[o.dest] = [];
  const positionals = [];
  let rest = false;
  for (; k < argv.length; k++) {
    const a = argv[k];
    if (rest || !a.startsWith('--') || a === '--') {
      if (a === '--' && !rest) rest = true;
      else if (a === '-h') args.help = true;
      else positionals.push(a);
      continue;
    }
    if (a === '--help') {
      args.help = true;
      continue;
    }
    const eq = a.indexOf('=');
    const name = option(spec, eq < 0 ? a : a.slice(0, eq), where);
    const o = spec.options[name];
    if (o.flag) {
      if (eq >= 0) throw new UsageError(`osheaf ${where}: error: argument ${name}: ignored explicit argument`);
      args[o.dest] = true;
      continue;
    }
    let v = eq >= 0 ? a.slice(eq + 1) : argv[++k];
    if (v === undefined) throw new UsageError(`osheaf ${where}: error: argument ${name}: expected one argument`);
    if (o.type === 'int') {
      if (!/^[-+]?[0-9]+$/.test(v.trim())) throw new UsageError(`osheaf ${where}: error: argument ${name}: invalid int value: '${v}'`);
      v = Number(v);
    }
    if (o.choices && !o.choices.includes(v)) {
      throw new UsageError(`osheaf ${where}: error: argument ${name}: invalid choice: '${v}' (choose from ` +
                           `${o.choices.map((c) => `'${c}'`).join(', ')})`);
    }
    if (o.check) {
      try {
        o.check(v);
      } catch (error) {
        throw new UsageError(`osheaf ${where}: error: argument ${name}: ${error.message}`);
      }
    }
    if (o.repeat) args[o.dest].push(v);
    else args[o.dest] = v;
  }
  for (const group of spec.exclusive || []) {
    const given = argv.slice(k0).map((a) => a.split('=')[0]).map((a) => {
      try {
        return a.startsWith('--') && a !== '--' ? option(spec, a, where) : null;
      } catch {
        return null;
      }
    }).filter((o) => group.includes(o));
    if (new Set(given).size > 1) {
      const [first, second] = [...new Set(given)];
      throw new UsageError(`osheaf ${where}: error: argument ${second}: not allowed with argument ${first}`);
    }
  }
  if (args.help) {
    out.args = args;
    return out;
  }
  const specs = spec.positionals.map(positional);
  const many = specs.findIndex((p) => p.kind === '+' || p.kind === '*');
  const fixed = many < 0 ? specs.length : specs.length - 1;
  if (many < 0 && positionals.length > specs.length) {
    throw new UsageError(`osheaf ${where}: error: unrecognized arguments: ${positionals.slice(specs.length).join(' ')}`);
  }
  const missing = [];
  let at = 0;
  specs.forEach((p, i) => {
    if (i === many) {
      const take = Math.max(0, positionals.length - fixed);
      args[p.name] = positionals.slice(at, at + take);
      at += take;
      if (p.kind === '+' && !take) missing.push(p.metavar);
    } else {
      args[p.name] = positionals[at] ?? null;
      if (positionals[at] === undefined && p.kind === '!') missing.push(p.metavar);
      at++;
    }
  });
  for (const [o, d] of Object.entries(spec.options)) {
    if (d.required && args[d.dest] === undefined && !missing.includes(o)) missing.push(o);
  }
  if (missing.length) throw new UsageError(`osheaf ${where}: error: the following arguments are required: ${missing.join(', ')}`);
  out.args = args;
  return out;
}

export async function findRoot(start) {
  let p = path.resolve(start);
  for (;;) {
    for (const n of CONFIG_NAMES) {
      try {
        await fs.access(path.join(p, n));
        return p;
      } catch {
        // not here
      }
    }
    if (path.dirname(p) === p) break;
    p = path.dirname(p);
  }
  throw new Stop(`no osheaf.json in ${path.resolve(start)} or above it (use --root)`);
}

export function makeEnvironment(archiveRoot = null, given = {}) {
  const env = environment({
    out: (line) => process.stdout.write(line + '\n'),
    err: (line) => process.stderr.write(line + '\n'),
    input: readLine,
    exportFolder: exportFolder(archiveRoot),
    ...given,
  });
  env.keyStore ??= keyStore({ warn: (t) => env.warn(t), err: (t) => env.err(t) });
  env.passphrase ??= passphrases(process.env, (t) => env.warn(t));
  Object.assign(env, outside(env, given));
  env.passkeys ??= {
    enroll: (owner, exclude, o) => enroll(owner, exclude, { ...o, open: env.openBrowser, err: env.err, timeout: env.unlockTimeout }),
    unlock: (owner, creds, o) => unlock(owner, creds, { ...o, open: env.openBrowser, err: env.err, timeout: env.unlockTimeout }),
  };
  env.openBrowser ??= systemBrowser;
  env.unlockMode ??= process.env.OPENSHEAF_UNLOCK || '';
  env.passphraseGiven ??= Boolean(process.env.OPENSHEAF_PASSPHRASE);
  env.signingKeyGiven ??= Boolean(process.env.OPENSHEAF_SIGNING_KEY);
  env.pullFromWallet ??= owners.pullFromWallet;
  env.asked ??= {};
  env.environ ??= process.env;
  env.arxivGet ??= politeGetter({ fetch: env.arxivFetch || globalThis.fetch?.bind(globalThis), wait: env.arxivWait ?? 3000 });
  env.zenodoToken ??= async (service) => {
    const token = (env.environ[service.env] || '').trim();
    if (token) return token;
    const platform = env.platform || process.platform;
    if (platform === 'darwin' && (env.security || existsSync('/usr/bin/security'))) {
      const r = await (env.security || securityCommand)(['find-generic-password', '-s', service.token, '-w']);
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    }
    return null;
  };
  env.deflateRaw ??= async (bytes) => new Uint8Array(zlib.deflateRawSync(bytes));
  env.sandbox ??= async () => {
    const where = await fs.mkdtemp(path.join(os.tmpdir(), 'opensheaf-zenodo-sandbox-'));
    return { storage: new DiskStorage(where), where, remove: () => fs.rm(where, { recursive: true, force: true }) };
  };
  if (!given.fetch) env.fetch = locatedFetch(() => env.locations || {});
  env.fetchJson ??= fetchJsonWith(env.fetch);
  env.template ??= defaultTemplate;
  return env;
}

async function openArchive(root, env) {
  const where = await findRoot(root || process.cwd());
  const f = await ArchiveFolder.open(new DiskStorage(where), env);
  if (f.old) throw new Stop(REBUILD);
  env.locations = f.archive.locations || {};
  env.archiveRoot = where;
  env.exportFolder = exportFolder(where);
  return f;
}

export async function defaultTemplate(name) {
  try {
    return new Uint8Array(await fs.readFile(new URL(`../templates/${name}`, import.meta.url)));
  } catch {
    return null;
  }
}

export function locations(configured = {}, text = process.env.OPENSHEAF_LOCATIONS || '') {
  const out = { ...configured };
  for (const part of text.split(';')) {
    const k = part.indexOf('=');
    if (k >= 0 && part.slice(0, k).trim()) out[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return out;
}

export function locate(url, found) {
  for (const prefix of Object.keys(found).sort((a, b) => b.length - a.length)) {
    if (url.startsWith(prefix)) return found[prefix] + url.slice(prefix.length);
  }
  return url;
}

export function locatedFetch(configured, base = globalThis.fetch?.bind(globalThis)) {
  return async (url, init = {}) => {
    const target = locate(String(url), locations(configured()));
    if (/^https?:\/\//.test(target)) return base(target, init);
    const file = target.startsWith('file://') ? fileURLToPath(target.split('?')[0]) : decodeURIComponent(target.split('?')[0]);
    try {
      const st = await fs.lstat(file);
      if (!st.isFile()) return new Response('not found', { status: 404 });
      const bytes = new Uint8Array(await fs.readFile(file));
      return new Response(init.method === 'HEAD' ? null : bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
}

export function pythonPath(given) {
  const absolute = given.startsWith('/');
  const parts = given.split('/').filter((p) => p !== '' && p !== '.');
  return (absolute ? '/' : '') + parts.join('/') || (absolute ? '/' : '.');
}

async function readFile(given) {
  try {
    const st = await fs.stat(given);
    if (!st.isFile()) throw new Error();
  } catch {
    throw new Stop(`no file ${given}`);
  }
  return { name: path.basename(given), bytes: new Uint8Array(await fs.readFile(given)) };
}

async function extraSources(specs) {
  const out = [];
  for (const spec of specs || []) {
    const k = spec.indexOf('=');
    const file = await readFile(k < 0 ? spec : spec.slice(0, k));
    out.push({ ...file, logical: (k < 0 ? '' : spec.slice(k + 1)) || file.name });
  }
  return out;
}

async function depositRun(f, args) {
  await deposit(f, await depositFiles(args));
}

async function depositFiles(args) {
  const a = { ...args };
  a.source = args.source ? await readFile(args.source) : null;
  a.pdf = args.pdf ? await readFile(args.pdf) : null;
  a.extraSource = (await extraSources(args.extraSource)).map((x) => ({ ...x, logical: x.logical === x.name ? '' : x.logical }));
  a.abstractFile = args.abstractFile ? await fs.readFile(args.abstractFile, 'utf-8') : null;
  return a;
}

const REQUIRED = { deposit: ['label', 'title', 'author'], relicense: ['label', 'rights', 'method'],
                   relate: ['label', 'to'], describe: ['label'], init: ['name', 'baseUrl', 'curator'] };
const PY_NAMES = { label: 'id', baseUrl: 'base-url' };

function defaultsOf(cmd) {
  const spec = COMMANDS[cmd];
  const out = {};
  for (const p of spec.positionals) out[positional(p).name] = null;
  for (const o of Object.values(spec.options)) out[o.dest] = o.repeat ? [] : spec.defaults?.[o.dest];
  return out;
}

async function runsOf(cmd, args) {
  let entries = [{}];
  if (args.fromFile) {
    let text;
    try {
      text = await fs.readFile(args.fromFile, 'utf-8');
    } catch {
      throw new Stop(`no file ${args.fromFile}`);
    }
    entries = await loadEntries(args.fromFile, text);
  }
  const out = [];
  for (const entry of entries) {
    const ns = merge(args, entry, defaultsOf(cmd), cmd, { id: 'label' });
    const missing = (REQUIRED[cmd] || []).filter((k) => ns[k] === undefined || ns[k] === null ||
                                                        (Array.isArray(ns[k]) && !ns[k].length));
    if (missing.length) throw new UsageProblem(`${cmd}: missing ` + missing.map((m) => PY_NAMES[m] || m).join(', '));
    if (ns.rights !== undefined && ns.rights !== null && ['deposit', 'relicense'].includes(cmd)) {
      try {
        checkRights(ns.rights);
      } catch (error) {
        throw new UsageProblem(`${cmd}: ${error.message}`);
      }
    }
    if (typeof ns.after === 'string') ns.after = Number.parseInt(ns.after, 10);
    out.push(ns);
  }
  return out;
}

async function each(root, cmd, args, env, run) {
  const todo = await runsOf(cmd, args);
  const f = await openArchive(root, env);
  for (const ns of todo) await run(f, ns);
  await present(f);
  return 0;
}

const RUN = {
  async init(root, args, env) {
    const [a] = await runsOf('init', args);
    const where = path.resolve(a.folder || '.');
    await fs.mkdir(where, { recursive: true });
    if (a.keyLog) a.keyLogSource = { storage: new DiskStorage(path.resolve(a.keyLog)), dir: '', where: a.keyLog };
    env.exportFolder = exportFolder(where);
    env.archiveRoot = where;
    await init(new DiskStorage(where), env, a, where);
    return 0;
  },

  deposit: (root, args, env) => each(root, 'deposit', args, env, depositRun),
  relicense: (root, args, env) => each(root, 'relicense', args, env, relicense),
  relate: (root, args, env) => each(root, 'relate', args, env, relate),

  describe: (root, args, env) => each(root, 'describe', args, env, async (f, a) => {
    if (a.abstractFile) {
      if (a.abstract !== undefined && a.abstract !== null) throw new Stop('describe: give --abstract or --abstract-file, not both');
      a = { ...a, abstractFile: { text: await fs.readFile(a.abstractFile, 'utf-8') } };
    }
    await describe(f, a);
  }),

  async notice(root, args, env) {
    const f = await openArchive(root, env);
    await notice(f, { ...args, file: args.file ? await readFile(args.file) : null });
    await present(f);
    return 0;
  },

  async withdraw(root, args, env) {
    const f = await openArchive(root, env);
    await withdraw(f, { ...args, file: args.file ? await readFile(args.file) : null });
    await present(f);
    return 0;
  },

  async complete(root, args, env) {
    const f = await openArchive(root, env);
    const extra = (await extraSources(args.extraSource)).map(({ logical, bytes }) => ({ logical, bytes }));
    await complete(f, { ...args, source: await readFile(args.source), extraSource: extra });
    await present(f);
    return 0;
  },

  async collect(root, args, env) {
    const f = await openArchive(root, env);
    await collect(f, { owner: args.owner || null, iKnow: args.iKnow });
    await present(f);
    return 0;
  },

  async collection(root, args, env) {
    const f = await openArchive(root, env);
    const a = { ...args };
    if (args.action === 'sync') {
      try {
        a.fromFile = { name: args.fromFile, given: args.fromFile, text: await fs.readFile(args.fromFile, 'utf-8') };
      } catch {
        throw new Stop(`no file ${args.fromFile}`);
      }
    }
    const run = { new: collections.newCollection, add: collections.add, remove: collections.remove,
                  follow: collections.follow, update: collections.update, status: collections.status,
                  sync: collections.sync }[args.action];
    await run(f, a);
    if (args.action !== 'status') await present(f);
    return 0;
  },

  async index(root, args, env) {
    const f = await openArchive(root, env);
    await writeDiscovery(f);
    if (hasWebsite(f)) await readableIndex(f);
    else env.out('opensheaf.json and the indexes written (no readable index configured)');
    return 0;
  },

  async verify(root, args, env) {
    const where = await findRoot(root || process.cwd());
    const schemas = await loadSchemas(async (url) => JSON.parse(await fs.readFile(fileURLToPath(url), 'utf-8')));
    let configured = {};
    try {
      configured = JSON.parse(await fs.readFile(path.join(where, 'osheaf.json'), 'utf-8')).locations || {};
    } catch {
      // no locations
    }
    env.locations = configured;
    const report = await verifyFolder(new DiskStorage(where), { schemas, remote: Boolean(args.remote),
                                                                fetch: env.fetch, fetchJson: env.fetchJson });
    if (args.json) {
      env.out(JSON.stringify(findingsJson(report), null, 2));
    } else {
      for (const f of report.findings) env.out(`${f.level}: ${f.place}: ${f.message}`);
      const c = report.counts();
      env.out((c.error ? `${c.error} error(s)` : 'OK') + `, ${c.warning} warning(s), ${c.result} result(s)`);
    }
    return report.counts().error ? 1 : 0;
  },

  async owner(root, args, env) {
    const f = await openArchive(root, env);
    if (args.action === 'pull') {
      const a = { ...args, source: args.place };
      const st = await fs.stat(args.place).catch(() => null);
      const exists = async (p) => Boolean(await fs.stat(p).catch(() => null));
      if (st?.isDirectory() && (await exists(path.join(args.place, 'inventory.json'))) &&
          !(await exists(path.join(args.place, 'opensheaf.json')))) {
        try {
          a.folderLog = await loadKeyLog(new DiskStorage(path.resolve(args.place)), '', args.place);
        } catch (error) {
          if (error instanceof OwnerError) throw new Stop(error.message);
          throw error;
        }
      }
      await owners.ownerPull(f, a);
    } else {
      const run = { init: owners.ownerInitCommand, rotate: owners.ownerRotate, expose: owners.ownerExpose,
                    end: owners.ownerEnd, show: owners.ownerShow }[args.action];
      await run(f, args);
    }
    if (args.action !== 'show') await present(f);
    return 0;
  },

  async sign(root, args, env) {
    const f = await openArchive(root, env);
    await owners.signAgain(f, args);
    await present(f);
    return 0;
  },

  async key(root, args, env) {
    let f = null;
    if (['list', 'import', 'export', 'enroll', 'unlock', 'wallet', 'wallets'].includes(args.action)) {
      try {
        f = await openArchive(root, env);
      } catch (error) {
        if (root || !(error instanceof Stop)) throw error;
      }
    } else {
      f = await openArchive(root, env);
    }
    const run = { new: owners.keyNew, push: owners.keyPush, pull: owners.keyPull, list: owners.keyList,
                  forget: owners.keyForget, export: owners.keyExport, import: owners.keyImport,
                  enroll: owners.keyEnroll, unlock: owners.keyUnlock, wallet: owners.keyWallet,
                  wallets: owners.keyWallets }[args.action];
    await run(f, args, env);
    return 0;
  },

  async 'help-config'(root, args, env) {
    env.out(CONFIG_DOC);
    env.out(CONFIG_HELP);
    return 0;
  },

  async resolve(root, args, env) {
    let f = null;
    try {
      f = await openArchive(root, env);
    } catch (error) {
      if (root || !(error instanceof Stop)) throw error;
    }
    return resolveCommand(f, args, env);
  },

  async mirror(root, args, env) {
    const f = await openArchive(root, env);
    await mirror(f, args);
    await present(f);
    return 0;
  },

  async branch(root, args, env) {
    const f = await openArchive(root, env);
    await branch(f, args);
    await present(f);
    return 0;
  },

  async accept(root, args, env) {
    const f = await openArchive(root, env);
    await accept(f, args);
    await present(f);
    return 0;
  },

  async draft(root, args, env) {
    const f = await openArchive(root, env);
    if (args.action === 'delete') await draftDelete(f, { label: args.draft });
    else await draftDeposit(f, await depositFiles({ ...args, label: args.draft }), args.action === 'new');
    await present(f);
    return 0;
  },

  async seal(root, args, env) {
    const f = await openArchive(root, env);
    await seal(f, { ...args, label: args.draft });
    await present(f);
    return 0;
  },

  async label(root, args, env) {
    const f = await openArchive(root, env);
    await labelCommand(f, args);
    await present(f);
    return 0;
  },

  async takedown(root, args, env) {
    const f = await openArchive(root, env);
    await takedown(f, args);
    await present(f);
    return 0;
  },

  async arxiv(root, args, env) {
    const dl = new DiskStorage(path.resolve(args.downloads));
    if (args.action === 'fetch') {
      const ids = [...args.ids, ...(args.author ? await authorPapers(env.arxivGet, args.author) : [])];
      if (!ids.length) {
        env.err(`${usageOf('arxiv', 'fetch')}\nosheaf arxiv fetch: error: give arXiv identifiers or --author`);
        return 2;
      }
      await fetchPapers(dl, ids, { get: env.arxivGet, refresh: Boolean(args.refresh), out: env.out });
      return 0;
    }
    const f = await openArchive(root, env);
    const a = { ...args };
    if (args.identifiers) {
      try {
        a.identifiers = JSON.parse(await fs.readFile(args.identifiers, 'utf-8'));
      } catch {
        throw new Stop(`no file ${args.identifiers}`);
      }
    }
    await importCommand(f, dl, pythonPath(args.downloads), a);
    await present(f);
    return 0;
  },

  async zenodo(root, args, env) {
    const f = await openArchive(root, env);
    const production = Boolean(args.production);
    const z = new Zenodo({ production, token: await env.zenodoToken(SERVICES[production]),
                           fetch: env.zenodoFetch || globalThis.fetch?.bind(globalThis),
                           api: env.environ.OPENSHEAF_ZENODO_API || null });
    env.schemas ??= await loadSchemas(async (url) => JSON.parse(await fs.readFile(fileURLToPath(url), 'utf-8')));
    await zenodoCommand(f, args, z);
    if (production) await present(f);
    return 0;
  },
};

export const USAGE = `usage: osheaf [-h] [--version] [--root ROOT] COMMAND ...

osheaf: keep an OpenSheaf archive (specification 0.2, https://opensheaf.org).
This is opensheaf-js ${VERSION}, the JavaScript port of opensheaf-py.

The archive is the folder given with --root, or else the nearest folder above
the current one that has an osheaf.json. Lines are named by their labels in
the archive.

Commands:
${Object.entries(COMMANDS).map(([c, s]) => `  ${c.padEnd(11)}${c.length >= 11 ? " " : ""}${s.help}`).join('\n')}

The website (osheaf.json "index": {"html": ...}) is written again after every
command that changes the archive. deposit, relicense, relate, describe and
init also take their options from a YAML or JSON file: --from FILE.

TeXmacs sources without their PDF, and the TeXmacs index, are opensheaf-py's;
with opensheaf-js, give the PDF.

Warning: OpenSheaf 0.2 is a draft. Until version 1.0, a revision may change
the format in incompatible ways, and archives may have to be rebuilt.`;

function usageOf(cmd, action) {
  if (COMMANDS[cmd].actions && !action) {
    const acts = Object.entries(COMMANDS[cmd].actions).map(([a, x]) => `  ${a.padEnd(8)}${x.help}`).join('\n');
    return `usage: osheaf ${cmd} [-h] {${Object.keys(COMMANDS[cmd].actions).join(',')}} ...\n\n${COMMANDS[cmd].help}\n\n${acts}`;
  }
  const s = action ? COMMANDS[cmd].actions[action] : COMMANDS[cmd];
  cmd = action ? `${cmd} ${action}` : cmd;
  const opts = Object.entries(s.options).map(([o, d]) => (d.flag ? `[${o}]` : `[${o} ${d.dest.toUpperCase()}]`));
  return `usage: osheaf ${cmd} [-h] ${opts.join(' ')} ${s.positionals.map((p) => `[${positional(p).metavar}]`).join(' ')}\n\n${s.help}`;
}

export async function main(argv, given = {}) {
  const env = makeEnvironment(null, given);
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    env.err(error.message);
    return 2;
  }
  const { cmd, root, args, action } = parsed;
  if (cmd === '--version') {
    env.out(`osheaf (opensheaf-js) ${VERSION}`);
    return 0;
  }
  if (cmd === '-h' || cmd === '--help') {
    env.out(USAGE);
    return 0;
  }
  if (!COMMANDS[cmd]) {
    env.err(`osheaf: error: argument command: invalid choice: '${cmd}'`);
    return 2;
  }
  if (args.help) {
    env.out(usageOf(cmd, action));
    return 0;
  }
  try {
    return await RUN[cmd](root, { ...args, action }, env);
  } catch (error) {
    if (error instanceof Stop) {
      env.err(error.message);
      return 1;
    }
    if (error instanceof UsageProblem) {
      env.err(`osheaf: error: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main ?? (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
