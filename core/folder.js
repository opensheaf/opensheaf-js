// Generated from literate/23-folder.md by opensheaf-literate: edit the document, not this file.
import { OWNER_NAME_LAYOUT, HASHED_LAYOUT, LAYOUT_FILE, pathOf } from './paths.js';
import { objectId, nameOf, LABEL } from './names.js';
import { sidecarDigest } from './owners.js';
import { Http } from './http.js';
import { Archive } from './archive.js';
import { SIGNED, VOUCHED } from './signatures.js';
import { hex } from './crypto.js';
import { readJson, writeText, storageFetch, storageLister, compareText, joinPath, ORIGIN } from './storage.js';
import { jsonBytes, utcNow, today, genesisRecord, orderedInventory, inventoryFile, sidecar, sha512hex,
         sha256hex, md5hex, signatureFile, signatureFileName, WITNESSES, INVENTORY_TYPE } from './write.js';
import { newKey, randomBytes } from './keys.js';

export class Stop extends Error {}

const LOWER_NAMES = ['gh', 'osheaf', 'command'];

export function sentence(text) {
  const m = /^([a-z][a-z']{0,14})(?=[ ,;])/.exec(text);
  if (m && !LOWER_NAMES.includes(m[1])) text = text[0].toUpperCase() + text.slice(1);
  return /[.?!:…]$/.test(text) ? text : text + '.';
}

export function stop(text) {
  throw new Stop(sentence(text));
}

export function exit(text) {
  throw new Stop(text);
}

export function short(name) {
  if (name.startsWith('did:key:')) name = name.slice('did:key:'.length);
  return [...name].length <= 14 ? name : `${name.slice(0, 8)}…${name.slice(-4)}`;
}

export function plural(n, noun) {
  return n === 1 ? `${n} ${noun}` : `${n} ${noun}s`;
}

export function environment(given = {}) {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    warn(text) {
      this.err('Warning: ' + sentence(text));
    },
    newKey,
    now: utcNow,
    today,
    fetch: globalThis.fetch?.bind(globalThis),
    fetchJson: null,
    template: null,
    ...given,
  };
}

export const CONFIG_NAME = 'osheaf.json';
export const CONFIG_NAMES = ['osheaf.json', 'osheaf.yaml', 'osheaf.yml'];
export const SPEC = '0.2';
export const OBJ = 'object.json', OBJ_FORMAT = 'opensheaf-object/0.2', GENESIS = 'genesis.json';
export const LAYOUTS = { 'owner-name': OWNER_NAME_LAYOUT, hashed: HASHED_LAYOUT };
export const LAYOUT_TEXT = 'Lines at <owner>/<name>/, drafts at draft/<id>/: the owner-name layout of the ' +
  'OpenSheaf specification 0.2, section 3.2\n';
export const REQUIRED = ['owner', 'name', 'baseUrl', 'mainCollection', 'curator', 'depositor'];
export const REBUILD = 'this archive is of specification 0.1, which these tools no longer read: rebuild it under ' +
  'specification 0.2 (section 16.1)';

export async function readConfig(storage) {
  const cfg = await readJson(storage, CONFIG_NAME);
  if (cfg !== null) return cfg;
  for (const n of CONFIG_NAMES.slice(1)) {
    if (await storage.kind(n)) exit(`${n}: opensheaf-js reads osheaf.json only (opensheaf-py also reads YAML)`);
  }
  exit(`no ${CONFIG_NAME} or osheaf.yaml in the archive folder`);
}

export class ArchiveFolder {
  static async open(storage, env = environment()) {
    const folder = new ArchiveFolder(storage, env);
    await folder.configure();
    return folder;
  }

  constructor(storage, env = environment()) {
    this.storage = storage;
    this.env = env;
    this.archive = {};
    this.index = {};
    this.labels = new Map();
    this.tombstones = [];
    this.layout = OWNER_NAME_LAYOUT;
    this.old = false;
    this.cached = null;
  }

  async configure() {
    const cfg = await readConfig(this.storage);
    const disc = (await readJson(this.storage, 'opensheaf.json')) || {};
    this.old = 'archiveId' in cfg || disc.specification === '0.1';
    this.layout = cfg.storageLayout || OWNER_NAME_LAYOUT;
    this.archive = Object.fromEntries(Object.entries(cfg).filter(([k]) => k !== 'texmacs' && k !== 'index'));
    if (this.old) return this;
    const missing = REQUIRED.filter((k) => !(k in cfg));
    if (missing.length) exit(`${CONFIG_NAME} lacks ${missing.join(', ')}`);
    if (!Object.values(LAYOUTS).includes(this.layout)) {
      exit(`${CONFIG_NAME}: storageLayout is one of ${Object.values(LAYOUTS).join(', ')}`);
    }
    this.archive.profiles ??= [];
    this.archive.contact ??= this.archive.baseUrl;
    this.index = cfg.index || {};
    this.labels = new Map((disc.objects || []).filter((o) => o.label).map((o) => [o.label, o.id]));
    this.tombstones = [...(disc.tombstones || [])];
    return this;
  }

  archiveOwners() {
    const out = [this.archive.owner];
    return out.concat((this.archive.owners || []).filter((o) => !out.includes(o)));
  }

  labelOf(id) {
    for (const [label, i] of this.labels) if (i === id) return label;
    return null;
  }

  depositor() {
    return { name: this.archive.depositor.name, address: this.archive.depositor.address };
  }

  async dirOf(id) {
    return joinPath('ocfl', ...(await pathOf(id, this.layout)));
  }

  async initStorageRoot() {
    const s = this.storage;
    await writeText(s, 'ocfl/0=ocfl_1.1', 'ocfl_1.1\n');
    if (this.layout === HASHED_LAYOUT) {
      await s.write('ocfl/ocfl_layout.json', jsonBytes({
        extension: HASHED_LAYOUT,
        description: 'Hashed n-tuple storage layout with its default parameters (OpenSheaf 0.2, section 3.2)' }));
    } else if (!(await s.kind(`ocfl/${LAYOUT_FILE}`))) {
      await writeText(s, `ocfl/${LAYOUT_FILE}`, LAYOUT_TEXT);
    }
  }

  async inventory(dir) {
    try {
      return await readJson(this.storage, joinPath(dir, 'inventory.json'));
    } catch {
      return null;
    }
  }

  contentPath(inv, version, logical) {
    for (const [d, paths] of Object.entries(inv.versions[version].state)) {
      if (paths.includes(logical)) return inv.manifest[d][0];
    }
    return null;
  }

  async readLogical(dir, inv, logical, version = null) {
    const cp = this.contentPath(inv, version || inv.head, logical);
    return cp ? this.storage.read(joinPath(dir, cp)) : null;
  }

  async readObjectJson(dir, inv, logical, version = null) {
    const bytes = await this.readLogical(dir, inv, logical, version);
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  }

  async objects() {
    const out = [];
    const walk = async (dir) => {
      for (const entry of (await this.storage.list(dir)) || []) {
        if (entry.kind !== 'dir') continue;
        const child = joinPath(dir, entry.name);
        if ((await this.storage.kind(joinPath(child, '0=ocfl_object_1.1'))) === 'file') {
          const inv = await this.inventory(child);
          out.push({ id: inv?.id ?? null, dir: child, inv });
        } else if (!(dir === 'ocfl' && entry.name === 'extensions')) {
          await walk(child);
        }
      }
    };
    if ((await this.storage.kind('ocfl')) === 'dir') await walk('ocfl');
    const idOf = (o) => (typeof o.id === 'string' ? o.id : 'None');
    return out.sort((a, b) => compareText(idOf(a), idOf(b)) || compareText(a.dir, b.dir));
  }

  reader() {
    if (!this.cached) {
      const base = /^https?:\/\/[^/]+\/(.*\/)?$/.test(this.archive.baseUrl || '') ? this.archive.baseUrl : ORIGIN;
      const http = new Http({ fetch: storageFetch(this.storage, base), budget: null });
      this.cached = new Archive(http, base, { specification: SPEC, storageRoot: 'ocfl/', storageLayout: this.layout });
      this.cached.lister = storageLister(this.storage, base);
    }
    return this.cached;
  }

  changed() {
    this.cached = null;
  }

  async keyLog(owner) {
    return this.reader().keyLog(owner);
  }

  async line(id) {
    await this.reader().locate(id);
    return this.reader().line(id);
  }

  async latestSigned(id) {
    return (await this.line(id)).latest;
  }

  async signingKeys(owner) {
    const who = short(owner);
    const log = await this.keyLog(owner);
    if (!log) stop(`the key log of ${who} is not in the storage root (section 6.5)`);
    const { errors } = await log.check();
    if (errors.length) stop(`the key log of ${who} has errors: ` + errors.join('; '));
    const latest = log.latest();
    if (!latest) stop(`the owner ${who} has ended (section 6.3): nothing is signed for it`);
    let found = await this.env.keyStore.current(owner, latest.keys.keys);
    const need = latest.keys.threshold;
    if (found.length < need && !this.env.signingKeyGiven && this.env.pullFromWallet) {
      found = await this.env.pullFromWallet(this, owner, latest, found);
    }
    if (found.length < need) {
      const hint = this.env.keyStore.keptOnDevice() ? 'osheaf key new makes one for this computer'
        : 'configure a key wallet, from which each command opens them';
      stop(`this computer holds ${found.length} of the current keys of ${who}, and v${latest.number} ` +
           `of its key log needs ${need} to sign (${hint})`);
    }
    return { log, latest, signers: found };
  }

  async checkBeforeExtending(id, acknowledged = false) {
    const { statuses } = await this.line(id);
    const doubtful = statuses.map((s, k) => [`v${k + 1}`, s]).filter(([, s]) => s !== SIGNED && s !== VOUCHED);
    if (!doubtful.length) return;
    const lines = doubtful.map(([v, s]) => `  ${v}: ${s}`).join('\n');
    if (!acknowledged) {
      exit(`${id}: the new version would extend versions that are not signed, or are contested (section 7.3):\n` +
           `${lines}\nlook at them; give --i-know to extend them anyway`);
    }
    this.env.err(`warning: ${id}: extending versions that are not signed, or are contested:\n${lines}`);
  }

  async zenodoPending(id) {
    try {
      const state = await readJson(this.storage, joinPath('zenodo-staging', ...(await pathOf(id, this.layout)), 'state.json'));
      return state?.phase === 'published';
    } catch {
      return false;
    }
  }

  async addVersion(id, files, obj, message, { acknowledged = false, stageIn = null } = {}) {
    const s = this.storage;
    const dir = await this.dirOf(id);
    let inv = await this.inventory(dir);
    if (stageIn === null && await this.zenodoPending(id)) {
      const name = this.labelOf(id) || id;
      exit(`${name}: a Zenodo deposit was published and its version is not added yet: osheaf zenodo ${name} ` +
           'completes it first (appendix A.1)');
    }
    const draft = id.startsWith('sheaf:draft:');
    const { log, latest, signers } = draft ? { log: null, latest: null, signers: [] } : await this.signingKeys(obj.owner);
    obj = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'previous'));
    if (inv === null) {
      if (await s.kind(dir)) exit(`${dir} exists, and is not an object`);
      inv = { id, type: INVENTORY_TYPE, digestAlgorithm: 'sha512', head: 'v0', manifest: {}, versions: {},
              fixity: { md5: {}, sha256: {} } };
    } else if (!draft) {
      await this.checkBeforeExtending(id, acknowledged);
      obj.previous = sidecarDigest(await s.read(joinPath(dir, inv.head, 'inventory.json.sha512')));
    }
    const ver = `v${Number(inv.head.slice(1)) + 1}`;
    if (stageIn !== null && await s.kind(stageIn)) exit(`${stageIn} exists`);
    const stage = stageIn ?? `.staging-${hex(randomBytes(6))}`;
    try {
      const content = new Map(files);
      content.set(OBJ, jsonBytes(obj));
      const state = {};
      for (const logical of [...content.keys()].sort(compareText)) {
        const data = content.get(logical);
        const d = await sha512hex(data);
        (state[d] ||= []).push(logical);
        if (!Object.hasOwn(inv.manifest, d)) {
          const cp = `${ver}/content/${logical}`;
          await s.write(joinPath(stage, cp), data);
          inv.manifest[d] = [cp];
          inv.fixity ??= {};
          inv.fixity.md5 ??= {};
          (inv.fixity.md5[await md5hex(data)] ||= []).push(cp);
          inv.fixity.sha256 ??= {};
          (inv.fixity.sha256[await sha256hex(data)] ||= []).push(cp);
        }
      }
      inv.head = ver;
      inv.versions[ver] = { created: this.env.now(), message, user: this.depositor(), state };
      inv = orderedInventory(inv);
      const data = inventoryFile(inv);
      await s.write(joinPath(stage, ver, 'inventory.json'), data);
      await s.write(joinPath(stage, ver, 'inventory.json.sha512'), await sidecar(data));
      const pin = log ? log.pin(latest.number) : null, digest = await sha512hex(data);
      for (const key of signers) {
        await s.write(joinPath(stage, 'witnesses', await signatureFileName(key.did)),
                      await signatureFile(key, id, ver, digest, obj.owner, pin));
      }
      if (stageIn === null) await this.moveStaged(dir, stage, ver, draft);
    } finally {
      if (stageIn === null) await removeTree(s, stage);
      this.changed();
    }
    return inv;
  }

  async moveStaged(dir, stage, ver, draft = false) {
    const s = this.storage;
    const data = await s.read(joinPath(stage, ver, 'inventory.json'));
    const sc = await s.read(joinPath(stage, ver, 'inventory.json.sha512'));
    if (ver === 'v1') {
      const obj = joinPath(stage, 'object');
      await writeText(s, joinPath(obj, '0=ocfl_object_1.1'), 'ocfl_object_1.1\n');
      await s.rename(joinPath(stage, ver), joinPath(obj, ver));
      if (!draft) await s.rename(joinPath(stage, 'witnesses'), joinPath(obj, WITNESSES, ver));
      await s.write(joinPath(obj, 'inventory.json'), data);
      await s.write(joinPath(obj, 'inventory.json.sha512'), sc);
      await s.rename(obj, dir);
    } else {
      await s.rename(joinPath(stage, ver), joinPath(dir, ver));
      if (!draft) await s.rename(joinPath(stage, 'witnesses'), joinPath(dir, WITNESSES, ver));
      for (const [name, bytes] of [['inventory.json', data], ['inventory.json.sha512', sc]]) {
        await s.write(joinPath(stage, name), bytes);
        await s.rename(joinPath(stage, name), joinPath(dir, name));
      }
    }
  }

  async installVersion(id, stage) {
    const s = this.storage;
    const ver = ((await s.list(stage)) || []).find((e) => e.kind === 'dir' && /^v[1-9][0-9]*$/.test(e.name))?.name;
    if (!ver) exit(`${stage} holds no version`);
    const inv = JSON.parse(new TextDecoder().decode(await s.read(joinPath(stage, ver, 'inventory.json'))));
    const dir = await this.dirOf(id);
    const before = await this.inventory(dir);
    if ((before ? before.head : 'v0') !== `v${Number(ver.slice(1)) - 1}`) {
      exit(`${id}: the line has moved since ${ver} was built in ${stage}: it cannot be added`);
    }
    await this.moveStaged(dir, stage, ver, id.startsWith('sheaf:draft:'));
    await removeStage(s, stage);
    this.changed();
    return inv;
  }

  async seal(kind, owner) {
    const taken = new Set();
    for (const { id } of await this.objects()) {
      const name = (id || '').split(':')[1];
      if (name !== undefined) taken.add(name);
    }
    for (const t of this.tombstones) {
      taken.add(t.genesisName);
      taken.add(t.name);
    }
    for (;;) {
      const genesis = await genesisRecord(kind, { originator: owner });
      const name = await nameOf(genesis);
      if (!taken.has(name)) return { genesis, id: objectId(name, owner) };
    }
  }
}

export async function removeTree(storage, path) {
  if (!/^\.staging-[0-9a-f]+$/.test(path.split('/')[0])) throw new Error(`not a staging folder: ${path}`);
  const kind = await storage.kind(path);
  if (kind === 'dir') {
    for (const entry of (await storage.list(path)) || []) await removeTree(storage, joinPath(path, entry.name));
    await storage.remove(path);
  } else if (kind) {
    await storage.remove(path);
  }
}

export async function removeStage(storage, path) {
  if (!/^zenodo-staging\/./.test(path)) throw new Error(`not a staging folder of Zenodo: ${path}`);
  const walk = async (p) => {
    const kind = await storage.kind(p);
    if (kind === 'dir') for (const entry of (await storage.list(p)) || []) await walk(joinPath(p, entry.name));
    if (kind) await storage.remove(p);
  };
  await walk(path);
  for (let p = path.slice(0, path.lastIndexOf('/')); p; p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') {
    if ((await storage.kind(p)) !== 'dir' || ((await storage.list(p)) || []).length) break;
    await storage.remove(p);
  }
}

export { LABEL };
