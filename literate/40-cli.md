The command line
================

`osheaf` is the command of opensheaf-py, and this is the same command in
JavaScript: the same names of commands and options, the same messages,
the same files. It runs on Deno (`deno run -A cli/osheaf.js`, or a
binary made by `deno compile`) and on Node (`node cli/osheaf.js`, or
`npx`), with one source: the command line uses the built-in modules of
Node (`node:fs`, `node:path`, `node:process`), which Deno provides too,
so nothing here is written twice. Only the command line touches a disk,
a terminal or the environment; everything it does to an archive is done
by `core/` (chapters [20](20-storage.md) to [28](28-verify-folder.md)).

This phase has the commands of the first path from nothing to a verified
archive: `init`, `deposit`, `collect`, `index` (without the website) and
`verify`. The others answer that they are in opensheaf-py for now
(chapter [00](00-plan.md) gives the order in which they come).

The three files are `cli/disk.js` (an archive folder on a disk),
`cli/keystore.js` (the current keys of this device, the exported
rotation keys, what the person types) and `cli/osheaf.js` (the command).

A folder on a disk
------------------

The storage of chapter [20](20-storage.md) over a folder. Paths are
checked before they reach the disk, and joined with the separator of the
system. A symbolic link is listed as such, and never read or followed:
an archive is plain files, and a link in it could lead a command outside
it.

    // in cli/disk.js:
    import { promises as fs } from 'node:fs';
    import path from 'node:path';
    import { checkPath, compareText, StorageError } from '../core/storage.js';

    const MISSING = ['ENOENT', 'ENOTDIR'];

    export class DiskStorage {
      constructor(root) {
        this.root = path.resolve(root);
      }

      full(p) {
        checkPath(p, { folder: true });
        return p ? path.join(this.root, ...p.split('/')) : this.root;
      }

      async read(p) {
        const f = this.full(checkPath(p));
        try {
          const st = await fs.lstat(f);
          if (!st.isFile()) return null;
          return new Uint8Array(await fs.readFile(f));
        } catch (error) {
          if (MISSING.includes(error.code)) return null;
          throw error;
        }
      }

      async write(p, bytes, { exclusive = false } = {}) {
        const f = this.full(checkPath(p));
        await fs.mkdir(path.dirname(f), { recursive: true });
        try {
          await fs.writeFile(f, bytes, { flag: exclusive ? 'wx' : 'w' });
        } catch (error) {
          if (error.code === 'EEXIST') throw new StorageError(`${p} exists already`);
          throw error;
        }
      }

      async kind(p) {
        try {
          const st = await fs.lstat(this.full(p));
          return st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file';
        } catch (error) {
          if (MISSING.includes(error.code)) return null;
          throw error;
        }
      }

      async list(p) {
        let entries;
        try {
          entries = await fs.readdir(this.full(p), { withFileTypes: true });
        } catch (error) {
          if (MISSING.includes(error.code)) return null;
          throw error;
        }
        return entries.map((e) => ({ name: e.name, kind: e.isSymbolicLink() ? 'link' : e.isDirectory() ? 'dir' : 'file' }))
          .sort((a, b) => compareText(a.name, b.name));
      }

      async rename(from, to) {
        const target = this.full(checkPath(to));
        if ((await this.kind(to)) === 'dir') throw new StorageError(`${to} exists already`);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(this.full(checkPath(from)), target);
      }

      async remove(p) {
        const f = this.full(checkPath(p));
        if ((await this.kind(p)) === 'dir') await fs.rmdir(f);
        else await fs.unlink(f);
      }
    }

Keys on this device
-------------------

The current key of an owner on this device is found as opensheaf-py finds
it (its chapter [07-keys](https://opensheaf.org/opensheaf-py/07-keys.html)):
first in the environment variable `OPENSHEAF_SIGNING_KEY` (the base64
seed of one key, for continuous integration), then in the key store. Of
opensheaf-py's stores, this phase has the file store:
`~/.config/opensheaf/keys/<owner>/<k>.key` (or under `XDG_CONFIG_HOME`),
the seed in base64, readable by its owner only, in the same place and
form as opensheaf-py's, so that a key made by one signs with the other.
The system's credential store (the macOS keychain, through `security`)
comes later; `OPENSHEAF_KEY_STORE=keyring|security` says so, and
`OPENSHEAF_KEY_STORE=none` keeps a new key in the memory of the command
only, as in opensheaf-py.

    // in cli/keystore.js:
    import { promises as fs } from 'node:fs';
    import path from 'node:path';
    import os from 'node:os';
    import process from 'node:process';
    import { execSync } from 'node:child_process';
    import { createInterface } from 'node:readline/promises';
    import { Key, KeyError, base64 } from '../core/keys.js';
    import { keyId } from '../core/names.js';
    import { unbase64 } from '../core/crypto.js';
    import { Stop, sentence, short } from '../core/folder.js';

    export const SIGNING_KEY = 'OPENSHEAF_SIGNING_KEY', KEY_STORE = 'OPENSHEAF_KEY_STORE';
    const STORES = ['keyring', 'security', 'file', 'none'];
    const STORE_NAMES = { file: 'a file of this computer', none: 'memory, for this command only' };

    export function keyFolder(owner, env = process.env) {
      const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
      return path.join(base, 'opensheaf', 'keys', owner);
    }

    async function keyFromBase64(text, where) {
      let seed = new Uint8Array();
      try {
        seed = unbase64(text.trim());
      } catch {
        // not base64
      }
      if (seed.length !== 32) throw new Stop(sentence(`${where}: not the base64 seed of an Ed25519 key`));
      return Key.fromSeed(seed);
    }

    export function fileKeyStore({ env = process.env, warn } = {}) {
      const pinned = env[KEY_STORE] || null;
      const memory = new Map();
      const store = () => {
        if (pinned && !STORES.includes(pinned)) throw new Stop(sentence(`${KEY_STORE} is one of ${STORES.join(', ')}`));
        if (pinned === 'keyring' || pinned === 'security') {
          throw new Stop(sentence(`${KEY_STORE}=${pinned}: opensheaf-js keeps current keys in files for now ` +
                                  `(${KEY_STORE}=file); the keychain comes in a later version`));
        }
        return pinned || 'file';
      };
      return {
        keptOnDevice: () => pinned !== 'none',
        storeName: (s) => STORE_NAMES[s] || s,
        async current(owner, dids) {
          const given = (env[SIGNING_KEY] || '').trim();
          if (given) {
            const key = await keyFromBase64(given, SIGNING_KEY);
            if (!dids.includes(key.did)) {
              throw new Stop(sentence(`${SIGNING_KEY} holds ${key.did}, which is not a current key of ${owner}`));
            }
            return [key];
          }
          const found = [];
          const kind = store();
          for (const did of dids) {
            const kid = await keyId(did);
            let text = memory.get(`${owner}:${kid}`) ?? null;
            if (text === null && kind === 'file') {
              const p = path.join(keyFolder(owner, env), `${kid}.key`);
              let st = null;
              try {
                st = await fs.lstat(p);
              } catch {
                st = null;
              }
              if (st?.isSymbolicLink()) throw new Stop(sentence(`${p} is a symbolic link: a key file is a plain file of its own`));
              if (st && process.platform !== 'win32' && (st.mode & 0o077)) {
                throw new Stop(sentence(`${p} can be read by other users: chmod 600 it (and check who read it)`));
              }
              if (st) text = (await fs.readFile(p, 'ascii')).trim();
            }
            if (text) {
              const key = await keyFromBase64(text, `${kind} ${owner}:${kid}`);
              if (key.did !== did) throw new Stop(sentence(`${kind} ${owner}:${kid} holds another key than ${did}`));
              found.push(key);
            }
          }
          return found;
        },
        async keep(owner, key) {
          const kind = store();
          const text = base64(key.seed);
          if (kind === 'none') {
            memory.set(`${owner}:${key.id}`, text);
            return 'none';
          }
          const folder = keyFolder(owner, env);
          await fs.mkdir(folder, { recursive: true, mode: 0o700 });
          const p = path.join(folder, `${key.id}.key`);
          await fs.writeFile(p, text + '\n', { flag: 'wx', mode: 0o600 });
          warn(`a current key of ${short(owner)} is kept in ${p}, protected only by the permissions of your files; ` +
               'opensheaf-js does not use the system\'s credential store yet');
          return 'file';
        },
      };
    }

The rotation keys exported by `init` go to a folder outside the archive:
the folder is refused if it is inside an archive (this one, or any folder
with an `osheaf.json` above it); it is made readable by its owner only,
and each file is written once, never replacing another.

    // in cli/keystore.js:
    export function exportFolder(archiveRoot = null) {
      return {
        async inside(folder) {
          const p = path.resolve(folder);
          if (archiveRoot) {
            const root = path.resolve(archiveRoot);
            if (p === root || p.startsWith(root + path.sep)) return root;
          }
          for (let d = p; ; d = path.dirname(d)) {
            try {
              await fs.access(path.join(d, 'osheaf.json'));
              return d;
            } catch {
              // not here
            }
            if (path.dirname(d) === d) return null;
          }
        },
        async write(folder, name, text) {
          await fs.mkdir(folder, { recursive: true, mode: 0o700 });
          const p = path.join(folder, name);
          await fs.writeFile(p, text, { flag: 'wx', mode: 0o600, encoding: 'ascii' });
          return p;
        },
        read: (p) => fs.readFile(p, 'utf-8'),
        resolve: async (folder) => path.resolve(folder),
      };
    }

What the person types
---------------------

The passphrase of exported keys comes from `OPENSHEAF_PASSPHRASE`, or from
the output of the command `OPENSHEAF_PASSPHRASE_COMMAND`, or is asked,
twice, without echo; it is asked once per command. Answers to questions
are read from the standard input.

    // in cli/keystore.js:
    export async function readLine(prompt) {
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
      process.stdout.write(prompt);
      try {
        for await (const line of rl) return line;
        return '';
      } finally {
        rl.close();
      }
    }

    function hidden(prompt) {
      process.stderr.write(prompt);
      if (!process.stdin.isTTY) return readLine('');
      return new Promise((resolve, reject) => {
        let typed = '';
        const done = () => {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stderr.write('\n');
        };
        const onData = (chunk) => {
          for (const ch of chunk.toString('utf8')) {
            if (ch === '\r' || ch === '\n') {
              done();
              resolve(typed);
              return;
            }
            if (ch === '\u0003') {
              done();
              reject(new Stop('Interrupted.'));
              return;
            }
            typed = ch === '\u007f' || ch === '\b' ? typed.slice(0, -1) : typed + ch;
          }
        };
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onData);
      });
    }

    export function passphrases(env = process.env, warn = () => {}) {
      let asked = null;
      return async ({ confirm = true, where = null } = {}) => {
        if (env.OPENSHEAF_PASSPHRASE) return env.OPENSHEAF_PASSPHRASE;
        if (asked !== null) return asked;
        const command = (env.OPENSHEAF_PASSPHRASE_COMMAND || '').trim();
        if (command) {
          try {
            const out = execSync(command, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
            const given = out.endsWith('\n') ? out.slice(0, -1) : out;
            if (given) return (asked = given);
            warn('OPENSHEAF_PASSPHRASE_COMMAND gave no passphrase: ');
          } catch (error) {
            warn(`OPENSHEAF_PASSPHRASE_COMMAND gave no passphrase: ${String(error.stderr || '').trim()}`);
          }
        }
        const first = await hidden(where ? `Passphrase of the keys in ${where}: ` : 'Passphrase of the keys: ');
        if (!first) throw new Stop(sentence('an empty passphrase: give --no-passphrase to export the keys without a passphrase lock'));
        if (confirm && (await hidden('The passphrase again: ')) !== first) throw new Stop(sentence('the two passphrases differ'));
        return (asked = first);
      };
    }

    export { KeyError };

The command
-----------

`cli/osheaf.js` reads its arguments as opensheaf-py's `argparse` reads
them: the global options `--root`, `--version` and `--help`, a command,
then its options and positional arguments in any order, an option's
value after it or after `=`, a long option shortened to any prefix that
names it alone, repeatable options collected in order. A mistake in the
arguments ends with the status 2, as argparse does.

    // in cli/osheaf.js:
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

    <<the options of the commands>>

    <<reading the arguments>>

    <<running a command>>

    <<the commands>>

    <<the entry point>>

The options are those of opensheaf-py, for the commands of this phase.

    // in the options of the commands:
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

The reading of the arguments:

    // in reading the arguments:
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

### Running a command

The archive is the folder of `--root`, or else the nearest folder above
the current one that has an `osheaf.json`. The environment of chapter
[23](23-folder.md) is made from the terminal, the key store and the
export folder. A command that stops prints its message and exits with
the status 1.

    // in running a command:
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

### The commands

`init` makes the folder if needed, then the archive in it. `deposit`
reads the files it is given, checking that each is a file, and hands
them to the deposit of chapter [26](26-deposit.md).

    // in the commands:
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

`verify` reads the JSON Schemas of the specification from `schemas/`
next to the program (a binary made by `deno compile` carries them, with
`--include schemas`).

    // in the commands:
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

### The entry point

    // in the entry point:
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
