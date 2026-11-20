// Generated from literate/40-cli.md by opensheaf-literate: edit the document, not this file.
import process from 'node:process';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DiskStorage } from './disk.js';
import { fileKeyStore, exportFolder, passphrases, readLine } from './keystore.js';
import { ArchiveFolder, environment, Stop, CONFIG_NAMES, REBUILD, sentence } from '../core/folder.js';
import { init } from '../core/init.js';
import { deposit, checkRights } from '../core/deposit.js';
import { collect } from '../core/collect.js';
import { writeDiscovery } from '../core/discovery.js';
import { verifyFolder, findingsJson } from '../core/check.js';
import { loadSchemas } from '../core/schema.js';

export const VERSION = '0.1.0';

const flag = (dest) => ({ dest, flag: true });
const value = (dest, extra = {}) => ({ dest, ...extra });
const int = (dest) => ({ dest, type: 'int' });

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

export const COMMANDS = {
  init: {
    help: 'create an archive (osheaf.json, storage root, owner, main catalogue)',
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
  collect: { help: 'new version of the main catalogue when needed', positionals: [],
             options: { '--i-know': flag('iKnow') } },
  index: { help: 'write opensheaf.json and the indexes (the website: opensheaf-py)', positionals: [], options: {} },
  verify: { help: 'check the archive (section 14 of the specification)', positionals: [],
            options: { '--remote': flag('remote'), '--json': flag('json') } },
};

const LATER = ['relicense', 'relate', 'describe', 'notice', 'withdraw', 'complete', 'resolve', 'collection',
               'mirror', 'branch', 'accept', 'draft', 'seal', 'takedown', 'zenodo', 'arxiv', 'owner', 'sign',
               'key', 'help-config'];

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
  const spec = COMMANDS[out.cmd];
  if (!spec) return out;
  const args = { ...(spec.defaults || {}) };
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
    const name = option(spec, eq < 0 ? a : a.slice(0, eq), out.cmd);
    const o = spec.options[name];
    if (o.flag) {
      if (eq >= 0) throw new UsageError(`osheaf ${out.cmd}: error: argument ${name}: ignored explicit argument`);
      args[o.dest] = true;
      continue;
    }
    let v = eq >= 0 ? a.slice(eq + 1) : argv[++k];
    if (v === undefined) throw new UsageError(`osheaf ${out.cmd}: error: argument ${name}: expected one argument`);
    if (o.type === 'int') {
      if (!/^[-+]?[0-9]+$/.test(v.trim())) throw new UsageError(`osheaf ${out.cmd}: error: argument ${name}: invalid int value: '${v}'`);
      v = Number(v);
    }
    if (o.choices && !o.choices.includes(v)) {
      throw new UsageError(`osheaf ${out.cmd}: error: argument ${name}: invalid choice: '${v}' (choose from ` +
                           `${o.choices.map((c) => `'${c}'`).join(', ')})`);
    }
    if (o.check) {
      try {
        o.check(v);
      } catch (error) {
        throw new UsageError(`osheaf ${out.cmd}: error: argument ${name}: ${error.message}`);
      }
    }
    if (o.repeat) args[o.dest].push(v);
    else args[o.dest] = v;
  }
  if (positionals.length > spec.positionals.length) {
    throw new UsageError(`osheaf ${out.cmd}: error: unrecognized arguments: ${positionals.slice(spec.positionals.length).join(' ')}`);
  }
  spec.positionals.forEach((p, i) => { args[p] = positionals[i] ?? null; });
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
  env.keyStore ??= fileKeyStore({ warn: (t) => env.warn(t) });
  env.passphrase ??= passphrases(process.env, (t) => env.warn(t));
  return env;
}

async function openArchive(root, env) {
  const where = await findRoot(root || process.cwd());
  const f = await ArchiveFolder.open(new DiskStorage(where), env);
  if (f.old) throw new Stop(REBUILD);
  return f;
}

function website(f) {
  if (f.index.html || f.index.template) {
    f.env.warn('the website is not written by opensheaf-js 0.1.0: run osheaf index of opensheaf-py to write it again');
  }
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

const RUN = {
  async init(root, args, env) {
    const where = path.resolve(args.folder || '.');
    await fs.mkdir(where, { recursive: true });
    if (args.fromFile) throw new Stop('--from is read by opensheaf-py only (for now): give the options on the command line.');
    if (args.keyLog) throw new Stop(sentence('--key-log: an archive of an existing owner is made by opensheaf-py'));
    env.exportFolder = exportFolder(where);
    await init(new DiskStorage(where), env, args, where);
    return 0;
  },

  async deposit(root, args, env) {
    const f = await openArchive(root, env);
    if (args.fromFile) throw new Stop('--from is read by opensheaf-py only (for now): give the options on the command line.');
    const a = { ...args };
    a.source = args.source ? await readFile(args.source) : null;
    a.pdf = args.pdf ? await readFile(args.pdf) : null;
    a.extraSource = [];
    for (const spec of args.extraSource) {
      const k = spec.indexOf('=');
      const file = await readFile(k < 0 ? spec : spec.slice(0, k));
      a.extraSource.push({ ...file, logical: k < 0 ? '' : spec.slice(k + 1) });
    }
    a.abstractFile = args.abstractFile ? await fs.readFile(args.abstractFile, 'utf-8') : null;
    await deposit(f, a);
    website(f);
    return 0;
  },

  async collect(root, args, env) {
    const f = await openArchive(root, env);
    await collect(f, { iKnow: args.iKnow });
    website(f);
    return 0;
  },

  async index(root, args, env) {
    const f = await openArchive(root, env);
    await writeDiscovery(f);
    if (f.index.html || f.index.template) website(f);
    else env.out('opensheaf.json and the indexes written (no readable index configured)');
    return 0;
  },

  async verify(root, args, env) {
    const where = await findRoot(root || process.cwd());
    const schemas = await loadSchemas(async (url) => JSON.parse(await fs.readFile(fileURLToPath(url), 'utf-8')));
    const report = await verifyFolder(new DiskStorage(where), { schemas, remote: Boolean(args.remote) });
    if (args.json) {
      env.out(JSON.stringify(findingsJson(report), null, 2));
    } else {
      for (const f of report.findings) env.out(`${f.level}: ${f.place}: ${f.message}`);
      const c = report.counts();
      env.out((c.error ? `${c.error} error(s)` : 'OK') + `, ${c.warning} warning(s), ${c.result} result(s)`);
    }
    return report.counts().error ? 1 : 0;
  },
};

export const USAGE = `usage: osheaf [-h] [--version] [--root ROOT] COMMAND ...

osheaf: keep an OpenSheaf archive (specification 0.2, https://opensheaf.org).
This is opensheaf-js ${VERSION}, the JavaScript port of opensheaf-py.

The archive is the folder given with --root, or else the nearest folder above
the current one that has an osheaf.json. Lines are named by their labels in
the archive.

Commands:
${Object.entries(COMMANDS).map(([c, s]) => `  ${c.padEnd(9)}${s.help}`).join('\n')}

The other commands of opensheaf-py (owner, key, collection, mirror, branch,
zenodo, arxiv, ...) come in later versions; until then, use opensheaf-py.

Warning: OpenSheaf 0.2 is a draft. Until version 1.0, a revision may change
the format in incompatible ways, and archives may have to be rebuilt.`;

function usageOf(cmd) {
  const s = COMMANDS[cmd];
  const opts = Object.entries(s.options).map(([o, d]) => (d.flag ? `[${o}]` : `[${o} ${d.dest.toUpperCase()}]`));
  return `usage: osheaf ${cmd} [-h] ${opts.join(' ')} ${s.positionals.map((p) => `[${p.toUpperCase()}]`).join(' ')}\n\n${s.help}`;
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
  const { cmd, root, args } = parsed;
  if (cmd === '--version') {
    env.out(`osheaf (opensheaf-js) ${VERSION}`);
    return 0;
  }
  if (cmd === '-h' || cmd === '--help') {
    env.out(USAGE);
    return 0;
  }
  if (!COMMANDS[cmd]) {
    env.err(LATER.includes(cmd)
      ? `osheaf ${cmd}: not in opensheaf-js ${VERSION} yet: use osheaf of opensheaf-py (https://opensheaf.org/opensheaf-py/)`
      : `osheaf: error: argument command: invalid choice: '${cmd}'`);
    return 2;
  }
  if (args.help) {
    env.out(usageOf(cmd));
    return 0;
  }
  try {
    return await RUN[cmd](root, args, env);
  } catch (error) {
    if (error instanceof Stop) {
      env.err(error.message);
      return 1;
    }
    throw error;
  }
}

if (import.meta.main ?? (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
