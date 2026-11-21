Key wallets
===========

An owner who prefers convenience to the maximum security keeps its keys,
rotation keys and current keys, in a **key wallet** (section 6.2 calls the
choice its security level): each key a file `<owner>/<k>.key.enc`, an
envelope of chapter [21](21-keys.md) under the passphrase and any passkeys
enrolled. There are two kinds of wallet, as in opensheaf-py (its chapter
[09-wallets](https://opensheaf.org/opensheaf-py/09-wallets.html)):

- **a private GitHub repository**, `github:OWNER/REPO`. opensheaf-py
  reaches it through the GitHub CLI (`gh api`); this program calls
  GitHub's REST API directly, with `fetch`, so that it needs no other
  program and runs in a browser as well. The token is the one `gh` holds
  (`gh auth token`), or `GH_TOKEN`, or `GITHUB_TOKEN`; the command line
  finds it (chapter [40](40-cli.md)). The files are those `gh` writes, so
  that either program reads the keys the other put there;
- **a command of the user's** (`command`): commands of a password manager
  (1Password's `op`, Bitwarden's `bw`, `pass`), configured with `{owner}`,
  `{k}` and `{kind}`, which read a key file on their standard output and
  write one from their standard input. They run on the user's computer, so
  they are read only from the user's own configuration, never from an
  archive.

The wallet is named by `--keys` (the commands that make keys) or
`--wallet` (the key commands), or configured. Wallets and owners are many
to many: a wallet may hold the keys of several owners, several people may
share an owner's keys in one wallet (each with a passkey of their own), and
an owner's keys may be in several wallets. So the user's configuration file
`~/.config/opensheaf/config.json` lists the wallets the user reads
(`{"wallets": [...]}`), and `keys` of `osheaf.json` hints, for each owner,
the wallets that hold its keys (`{"<owner>": {"wallets": [...]}}`, GitHub
wallets only). `OPENSHEAF_WALLET` (text or JSON) wins; otherwise the keys
of an owner are looked for in its hinted wallets, then in the user's, the
first that holds keys of the owner being used.

The core reaches the outside through the environment of the command
(chapter [23](23-folder.md)): `env.wallets` gives the user's configuration
(`userConfig`, the commands of a command wallet; `userFile`, the whole
file, when it can be read, and `writeUserFile`, for `osheaf key wallets
--add`), `OPENSHEAF_WALLET`, a `fetch` and a token for GitHub, and a runner
of shell commands. The module is `core/wallets.js`.

    // in core/wallets.js:
    import { OWNER_NAME } from './names.js';
    import { readKey, keyFileText, addPasskey as addPasskeyLock, KeyError, PassphraseNeeded, KINDS, ROTATION,
             ENVELOPE, PASSKEY_RP, wrapsOf, base64, passkeysOf } from './keys.js';
    import { unbase64, utf8 } from './crypto.js';
    import { short } from './folder.js';

    <<errors of wallets>>

    <<security levels and their risk>>

    <<choosing a wallet>>

    <<the archive's own repositories>>

    <<a private GitHub repository>>

    <<a command of the user's>>

    <<keys in and out of a wallet>>

Security levels
---------------

The level is `offline`, the default and the maximum (rotation keys
exported to files, apart from each other), or a wallet. The risk of a
wallet is said once, when keys are put there.

    // in errors of wallets:
    export class WalletError extends Error {}

The levels, and the risk:

    // in security levels and their risk:
    export const OFFLINE = 'offline';
    export const WALLET = 'OPENSHEAF_WALLET';

    export function risk(where, owner) {
      return `The rotation keys and the current keys of ${short(owner)} are kept in ${where} (security ` +
        `level ${where}), locked with your passphrase. Whoever controls ${where} and knows the passphrase ` +
        'controls the owner: they can sign in its name and change its keys (sections 6.2 and 15.1), and ' +
        'a current key pulled from the wallet is on every computer that pulls it. The maximum security ' +
        'level keeps the rotation keys offline, apart from each other. To move up later, run once ' +
        'osheaf owner rotate --keys offline --export DIR: the rotation keys in the wallet are then ' +
        'used up, and the new ones are kept offline only.';
    }

Choosing a wallet
-----------------

A wallet named by text: `offline` or nothing is none; `github:OWNER/REPO`;
`command`, with the commands of `config` (or of the user's configuration);
or a JSON object, which `OPENSHEAF_WALLET` may hold, `{"wallet": ...}`
with the commands beside it. `forbidden` are the repositories of the
archive itself, which is public, and never a wallet.

    // in choosing a wallet:
    const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
    const COMMANDS = ['read', 'write', 'list', 'forget'];

    export function parseWallet(spec, env, { config = null, forbidden = [] } = {}) {
      spec = (spec || '').trim();
      if (spec.startsWith('{')) {
        try {
          config = JSON.parse(spec);
        } catch {
          throw new WalletError(`${WALLET}: not JSON: ${spec}`);
        }
        spec = String(config?.wallet ?? '');
      }
      if (spec === '' || spec === OFFLINE) return null;
      if (spec.startsWith('github:')) {
        const repo = spec.slice('github:'.length);
        if (!REPO.test(repo)) throw new WalletError(`a GitHub wallet is github:OWNER/REPO: ${spec}`);
        return new GitHubWallet(repo, env.wallets?.github, forbidden);
      }
      if (spec === 'command') return new CommandWallet(config || env.wallets.userConfig(), env.wallets);
      throw new WalletError(`a security level is offline, github:OWNER/REPO or command: ${spec}`);
    }

The wallets of an owner, in the order they are tried (opensheaf-py's
`candidates`): that of `OPENSHEAF_WALLET` alone; or else those
`osheaf.json` hints for the owner (its entry's `wallets`, and `wallet`,
then those of the entry for every owner, the earlier form `{"wallet":
...}`), then the user's (`wallets` of the file, then its earlier `keys`),
each once. A command wallet anywhere in `osheaf.json` is refused.
`candidateWallets` gives `[wallet, place]`, which the Manager uses too.

    // in choosing a wallet:
    export const CONFIG_FILE = 'osheaf.json';

    function isMap(x) {
      return x !== null && typeof x === 'object' && !Array.isArray(x);
    }

    function named(e) {
      if (!isMap(e)) return [];
      const out = Array.isArray(e.wallets) ? e.wallets.filter((w) => typeof w === 'string') : [];
      return e.wallet ? [...out, String(e.wallet)] : out;
    }

    export function hints(config, owner = null) {
      config = isMap(config) ? config : {};
      const out = [];
      for (const w of [...(owner ? named(config[owner]) : []), ...named(config)]) if (!out.includes(w)) out.push(w);
      return out;
    }

    export function userWallets(env) {
      const data = env.wallets.userFile ? env.wallets.userFile() : { keys: env.wallets.userConfig() };
      const out = isMap(data) && Array.isArray(data.wallets)
        ? data.wallets.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim()) : [];
      const old = isMap(data) && isMap(data.keys) ? data.keys.wallet : null;
      return old && !out.includes(String(old)) ? [...out, String(old)] : out;
    }

    export function checkArchiveConfig(config, env) {
      config = isMap(config) ? config : {};
      const entries = [config, ...Object.entries(config).filter(([k, v]) => OWNER_NAME.test(k) && isMap(v)).map(([, v]) => v)];
      for (const e of entries) {
        if (named(e).includes('command') || COMMANDS.some((c) => c in e)) {
          throw new WalletError('osheaf.json configures a command wallet ("keys"), whose commands would run on ' +
            'this machine: they are read only from your own configuration. Move "keys" to ' +
            `${env.wallets.userConfigPath()} (or to ${WALLET}), and leave osheaf.json without it`);
        }
      }
    }

    export function candidateWallets(config, env, owner = null) {
      checkArchiveConfig(config, env);
      const given = (env.wallets.walletEnv() || '').trim();
      if (given) return [[given, WALLET]];
      const out = hints(config, owner).map((w) => [w, CONFIG_FILE]);
      const seen = new Set(out.map(([w]) => w));
      for (const w of userWallets(env)) if (!seen.has(w)) out.push([w, env.wallets.userConfigPath()]);
      return out;
    }

The wallet of an owner is then the first candidate that holds keys of
it (its folder listed); one that cannot be read or listed is passed over;
a single candidate is taken without a listing; when none holds keys of the
owner, the first, where its keys would go. Without an owner, the first.

    // in choosing a wallet:
    export async function configuredWallet(config, env, { forbidden = [], owner = null } = {}) {
      const named = candidateWallets(config, env, owner);
      const wallets = [];
      for (const [spec] of named) {
        let w;
        try {
          w = parseWallet(spec, env, { forbidden });
        } catch (error) {
          if (named.length === 1 || !(error instanceof WalletError)) throw error;
          continue;
        }
        if (w) wallets.push(w);
      }
      if (wallets.length <= 1 || !owner) return wallets[0] || null;
      for (const w of wallets) {
        try {
          if ((await w.entries(owner)).length) return w;
        } catch (error) {
          if (!(error instanceof WalletError)) throw error;
        }
      }
      return wallets[0];
    }

The archive's own repositories
------------------------------

The repositories of the archive are those its git remotes name on GitHub
(the command line reads `git remote -v`), and the one its base URL names
when it is served by GitHub Pages; their names are compared in lowercase.

    // in the archive's own repositories:
    const GITHUB_REMOTE = /github\.com[:/]+([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?(?:\s|$)/g;
    const PAGES = /^https?:\/\/([A-Za-z0-9-]+)\.github\.io(?:\/([A-Za-z0-9._-]+))?\/?/;

    export function archiveRepositories(remotes, baseUrl) {
      const out = new Set();
      for (const m of `${remotes || ''}\n`.matchAll(GITHUB_REMOTE)) out.add(`${m[1]}/${m[2]}`.toLowerCase());
      const m = PAGES.exec(baseUrl || '');
      if (m) out.add(`${m[1]}/${m[2] || m[1] + '.github.io'}`.toLowerCase());
      return out;
    }

A private GitHub repository
---------------------------

The contents API (`/repos/OWNER/REPO/contents/PATH`) reads a file (its
content in base64, and its `sha`), lists a folder, writes a file (`PUT`,
with the `sha` of the file it replaces) and removes one (`DELETE`). A
missing file answers 404. Before writing, the repository is checked once:
it exists, it is private, and it is not one of the archive's.

    // in a private GitHub repository:
    export const ENTRY_SUFFIX = '.key.enc';

    export function entryPath(owner, kid) {
      if (!OWNER_NAME.test(owner || '') || !/^[a-z2-7]{16}$/.test(kid || '')) {
        throw new WalletError(`not an owner name and a key: ${owner} ${kid}`);
      }
      return `${owner}/${kid}${ENTRY_SUFFIX}`;
    }

    export class GitHubWallet {
      constructor(repo, github, forbidden = []) {
        this.repo = repo;
        this.name = `github:${repo}`;
        this.github = github;
        this.forbidden = new Set([...forbidden].map((f) => f.toLowerCase()));
        this.token = undefined;
        this.checked = false;
      }

      async api(method, path, body = null) {
        if (this.token === undefined) this.token = await this.github.token();
        if (!this.token) throw new WalletError('gh is not signed in to GitHub, and GITHUB_TOKEN is not set: run gh auth login');
        let r;
        try {
          r = await this.github.fetch(`${this.github.api.replace(/\/$/, '')}/${path}`, {
            method,
            headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`,
                       'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'opensheaf-js',
                       ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
          });
        } catch (error) {
          throw new WalletError(`GitHub API ${path}: ${error.message}`);
        }
        const text = await r.text();
        if (r.status === 404) return null;
        if (!r.ok) {
          let message = text;
          try {
            message = JSON.parse(text).message || text;
          } catch {
            // not JSON
          }
          throw new WalletError(`GitHub API ${path}: ${message.trim()} (HTTP ${r.status})`);
        }
        try {
          return text.trim() ? JSON.parse(text) : {};
        } catch {
          throw new WalletError(`GitHub API ${path}: not JSON`);
        }
      }

      contents(path = '') {
        return `repos/${this.repo}/contents/${path}`.replace(/\/$/, '');
      }

      checkName() {
        if (this.forbidden.has(this.repo.toLowerCase())) {
          throw new WalletError(`${this.repo} is a repository of the archive, which is public: a wallet is a repository of its own`);
        }
      }

      async checkWritable() {
        this.checkName();
        if (this.checked) return;
        const info = await this.api('GET', `repos/${this.repo}`);
        if (info === null) {
          throw new WalletError(`no repository ${this.repo} that gh can reach: create it, private, with ` +
                                `gh repo create ${this.repo} --private`);
        }
        if (info.private !== true || info.visibility !== 'private') {
          throw new WalletError(`${this.repo} is not a private repository: a wallet must be private`);
        }
        if (this.forbidden.has(String(info.full_name ?? this.repo).toLowerCase())) {
          throw new WalletError(`${this.repo} is a repository of the archive, which is public: a wallet is a repository of its own`);
        }
        this.checked = true;
      }

      async read(owner, kid) {
        this.checkName();
        const got = await this.api('GET', this.contents(entryPath(owner, kid)));
        if (!got || typeof got !== 'object' || Array.isArray(got) || !('content' in got)) return null;
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(unbase64(String(got.content).replace(/\s+/g, '')));
        } catch {
          throw new WalletError(`${this.name}: ${entryPath(owner, kid)} is not a key file`);
        }
      }

      async write(owner, kid, kind, text) {
        await this.checkWritable();
        const path = entryPath(owner, kid);
        const old = await this.api('GET', this.contents(path));
        const body = { message: `opensheaf: ${kind} key ${kid} of ${owner}`, content: base64(utf8(text)) };
        if (old?.sha) body.sha = old.sha;
        if ((await this.api('PUT', this.contents(path), body)) === null) throw new WalletError(`${this.repo} refused ${path}`);
      }

      async entries(owner = null) {
        this.checkName();
        const listing = async (p) => {
          const got = await this.api('GET', this.contents(p));
          return Array.isArray(got) ? got : [];
        };
        const folders = owner ? [owner]
          : (await listing('')).filter((x) => x.type === 'dir' && OWNER_NAME.test(x.name)).map((x) => x.name);
        const out = [];
        for (const o of folders) {
          for (const x of await listing(o)) {
            if (x.type === 'file' && x.name.endsWith(ENTRY_SUFFIX)) out.push([o, x.name.slice(0, -ENTRY_SUFFIX.length)]);
          }
        }
        return out;
      }

      async forget(owner, kid, kind) {
        await this.checkWritable();
        const path = entryPath(owner, kid);
        const old = await this.api('GET', this.contents(path));
        if (old?.sha) await this.api('DELETE', this.contents(path), { message: `opensheaf: forget ${kind} key ${kid} of ${owner}`, sha: old.sha });
      }
    }

A command of the user's
-----------------------

The commands of a command wallet are configured in the user's
configuration (or `OPENSHEAF_WALLET`); `{owner}`, `{k}` and `{kind}` are
replaced, after the owner and the key are checked to be names, so that
nothing else enters the shell. `env.wallets.run(command, input)` runs a
command in the shell, and answers its status and outputs.

    // in a command of the user's:
    export const CONFIG_HELP = `Your own configuration: ~/.config/opensheaf/config.json ($XDG_CONFIG_HOME/opensheaf/config.json)

    {"keys": {"wallet": "github:OWNER/REPO"}}         a key wallet in a private GitHub repository, or
    {"keys": {"wallet": "command",                      a key wallet in your password manager:
              "read":   "op read 'op://Private/opensheaf-{owner}-{k}/notesPlain'",
              "write":  "...",                          receives the key file on its standard input
              "list":   "...",                          optional: prints "<owner> <k>" per key
              "forget": "..."}}                         optional: removes a key

    {"wallets": ["github:OWNER/REPO", "command", ...]}  the key wallets you read, in order: the
                                                        keys of an owner are looked for in those
                                                        osheaf.json hints for it, then in these
                                                        (osheaf key wallets --add|--remove)

    The commands run in the shell; {owner} is the owner name, {k} the 16 characters
    that name the key, {kind} current or rotation. read prints the key file as it was
    written, and fails or prints nothing for a key it does not hold. A command wallet is
    read only from this file or from OPENSHEAF_WALLET (the same JSON, or text such as
    github:OWNER/REPO), which wins; never from an archive's osheaf.json, which may name a
    GitHub wallet only. Examples for 1Password, Bitwarden and pass: chapter 9 of the
    literate program of opensheaf-py ("A command of the user's"), and its README,
    section "Keys and security levels".`;

    export class CommandWallet {
      constructor(config, wallets) {
        this.name = 'command';
        this.config = config;
        this.wallets = wallets;
        if (!config.read || !config.write) {
          throw new WalletError('a command wallet needs "read" and "write" commands, in "keys" of ' +
                                `${wallets.userConfigPath()} or in ${WALLET}`);
        }
      }

      async run(what, owner = '', kid = '', kind = '', text = null) {
        if (owner || kid) entryPath(owner, kid);
        if (kind && !KINDS.includes(kind)) throw new WalletError(`unknown kind of key: ${kind}`);
        const command = this.config[what].replaceAll('{owner}', owner).replaceAll('{k}', kid).replaceAll('{kind}', kind);
        return this.wallets.run(command, text);
      }

      async checkWritable() {}

      async read(owner, kid, kind) {
        const r = await this.run('read', owner, kid, kind);
        return r.status === 0 && r.stdout.trim() ? r.stdout : null;
      }

      async write(owner, kid, kind, text) {
        const r = await this.run('write', owner, kid, kind, text);
        if (r.status !== 0) throw new WalletError(`the write command of the wallet failed: ${r.stderr.trim()}`);
      }

      async entries(owner = null) {
        if (!this.config.list) throw new WalletError('this command wallet has no "list" command');
        const r = await this.run('list');
        if (r.status !== 0) throw new WalletError(`the list command of the wallet failed: ${r.stderr.trim()}`);
        const out = [];
        for (const line of r.stdout.split(/\r\n|\r|\n/)) {
          const parts = line.replaceAll('/', ' ').split(/\s+/).filter(Boolean);
          if (parts.length >= 2 && OWNER_NAME.test(parts[0]) && (owner === null || owner === parts[0])) {
            out.push([parts[0], parts[1].endsWith(ENTRY_SUFFIX) ? parts[1].slice(0, -ENTRY_SUFFIX.length) : parts[1]]);
          }
        }
        return out;
      }

      async forget(owner, kid, kind) {
        if (!this.config.forget) {
          throw new WalletError('this command wallet has no "forget" command: remove the key with your password manager');
        }
        const r = await this.run('forget', owner, kid, kind);
        if (r.status !== 0) throw new WalletError(`the forget command of the wallet failed: ${r.stderr.trim()}`);
      }
    }

Keys in and out of a wallet
---------------------------

A key is put in a wallet as its key file, and read back: a wallet that
does not give back what it was given has not kept the key. A rotation key
is always locked with a passphrase; a current key may be kept in clear.

    // in keys in and out of a wallet:
    export async function putKey(wallet, owner, key, kind, version, passphrase, passkeys = [], cost = {}) {
      if ((passphrase === null || passphrase === undefined) && kind === ROTATION) {
        throw new WalletError('a rotation key is kept in a wallet only locked with a passphrase');
      }
      const text = await keyFileText(key, owner, kind, version, passphrase, { passkeys, cost });
      await wallet.write(owner, key.id, kind, text);
      if (((await wallet.read(owner, key.id, kind)) || '').trim() !== text.trim()) {
        throw new WalletError(`${wallet.name} did not keep the ${kind} key ${key.did}`);
      }
    }

A key is read from a wallet and opened: in clear, or with the passkeys a
command has unlocked (`passkey(owner, passkeys)`, which may ask the
browser, chapter [36](36-passkeys.md)), or else with the passphrase
(`passphrase()`, asked when needed). It must be the key it is filed as.

    // in keys in and out of a wallet:
    export async function getKey(wallet, owner, kid, kind, passphrase, passkey = null) {
      const text = await wallet.read(owner, kid, kind);
      if (text === null) return null;
      let rk;
      try {
        try {
          rk = await readKey(text);
        } catch (error) {
          if (!(error instanceof PassphraseNeeded)) throw error;
          const keks = passkey && error.passkeys.length ? await passkey(owner, error.passkeys) : null;
          rk = null;
          if (keks) {
            try {
              rk = await readKey(text, null, keks);
            } catch (again) {
              if (!(again instanceof PassphraseNeeded)) throw again;
            }
          }
          if (rk === null) rk = await readKey(text, await passphrase());
        }
      } catch (error) {
        if (error instanceof KeyError) throw new WalletError(`${wallet.name} ${entryPath(owner, kid)}: ${error.message}`);
        throw error;
      }
      if (rk.owner !== owner || rk.kind !== kind || rk.key.id !== kid) {
        throw new WalletError(`${wallet.name} ${entryPath(owner, kid)} holds another key: ${rk.kind} key ${rk.key.did} of ${rk.owner}`);
      }
      return rk.key;
    }

A passkey lock is added to a key of the wallet opened with the
passphrase, checked to open the same key with the passkey alone, then
written and read back.

    // in keys in and out of a wallet:
    export async function readAny(wallet, owner, kid) {
      for (const kind of KINDS) {
        const t = await wallet.read(owner, kid, kind);
        if (t) return t;
      }
      return '';
    }

    export async function addPasskey(wallet, owner, kid, passphrase, passkey, cost = {}) {
      const text = await readAny(wallet, owner, kid);
      const where = `${wallet.name} ${entryPath(owner, kid)}`;
      let before, fresh, after;
      try {
        before = await readKey(text, passphrase);
        fresh = await addPasskeyLock(text, passphrase, passkey, cost);
        after = await readKey(fresh, null, { [passkey.cred]: passkey.kek });
      } catch (error) {
        if (error instanceof KeyError) throw new WalletError(`${where}: ${error.message}`);
        throw error;
      }
      if (after.key.did !== before.key.did || after.kind !== before.kind) {
        throw new WalletError(`${where}: the key changed when the passkey lock was added`);
      }
      await wallet.write(owner, kid, before.kind, fresh);
      if (((await wallet.read(owner, kid, before.kind)) || '').trim() !== fresh.trim()) {
        throw new WalletError(`${wallet.name} did not keep the ${before.kind} key ${before.key.did}`);
      }
      return [before.kind, before.key.did];
    }

What a wallet holds, for `osheaf key list`: the fields of each key file
before its seed (never the seed), and its locks.

    // in keys in and out of a wallet:
    export function describeEntry(text) {
      const fields = {};
      for (const line of text.split(/\r\n|\r|\n/)) {
        const t = line.trim();
        const k = t.indexOf(' ');
        const name = k < 0 ? t : t.slice(0, k);
        if (['encryption', 'wrap', 'seed'].includes(name)) break;
        if (!(name in fields)) fields[name] = k < 0 ? '' : t.slice(k + 1).trim();
      }
      return fields;
    }

    export function locks(text) {
      const line = text.split(/\r\n|\r|\n/).find((x) => x.startsWith('encryption '));
      const enc = line ? line.split(/\s+/).filter(Boolean)[1] : undefined;
      if (enc === undefined || enc === 'none') return [];
      if (enc !== ENVELOPE) return ['passphrase'];
      const out = [];
      for (const w of wrapsOf(text)) {
        const parts = w.split(/\s+/).filter(Boolean);
        let method = parts[1] ?? '?';
        if (method === 'passkey') {
          const rp = parts.find((p) => p.startsWith('rp='));
          method = `passkey (${rp ? rp.slice(3) : PASSKEY_RP})`;
        }
        if (!out.includes(method)) out.push(method);
      }
      return out;
    }

For `osheaf key wallets`, and for the Manager, which shows the owners of
a wallet before the person chooses those to unlock: `ownersHeld` sums a
wallet up by owner, `[owner, number of keys, locks in words]`: by the
passphrase, by so many passkeys (counted by credential over the owner's
keys: each person or device family that enrolled one), or not at all.

    // in keys in and out of a wallet:
    export async function ownersHeld(wallet, owner = null) {
      const by = new Map();
      for (const [o, kid] of await wallet.entries(owner)) {
        const text = await readAny(wallet, o, kid);
        const held = locks(text);
        const b = by.get(o) || { n: 0, phrase: false, creds: new Set(), bare: 0 };
        b.n += 1;
        b.phrase ||= held.includes('passphrase');
        for (const p of passkeysOf(text)) b.creds.add(p.cred);
        if (!held.length) b.bare += 1;
        by.set(o, b);
      }
      return [...by].map(([o, b]) => {
        const words = [...(b.phrase ? ['passphrase'] : []),
                       ...(b.creds.size ? [`${b.creds.size} passkey${b.creds.size !== 1 ? 's' : ''}`] : []),
                       ...(b.bare ? [`${b.bare} without a lock`] : [])];
        return [o, b.n, words.join(', ') || 'no lock'];
      });
    }

    export async function listing(wallet, owner = null) {
      const out = [];
      for (const [o, kid] of await wallet.entries(owner)) {
        const text = await readAny(wallet, o, kid);
        const f = describeEntry(text);
        out.push([o, kid, f.kind ?? '?', f.key ?? '?', f.version ?? '', locks(text)]);
      }
      return out;
    }
