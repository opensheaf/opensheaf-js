// Generated from literate/07-owners.md by opensheaf-literate: edit the document, not this file.
import { sha512, parseIntegers, nesting, LIMITS } from './http.js';
import { sha256, base32, sameBytes, utf8 } from './crypto.js';
import { readGenesis, nameOf, objectId, keyLogPin, keyDigest, keyRulesOfRecord, jcsBytes, isObject,
         OWNER_NAME, DID_KEY, GENESIS } from './names.js';
import { judgeFolder, GOOD } from './signatures.js';
import { same } from './schema.js';

export const OBJECT_FORMAT = 'opensheaf-object/0.2';
export const KEYS_FORMAT = 'opensheaf-keys/0.2';
export const INVENTORY_TYPE = 'https://ocfl.io/1.1/spec/#inventory';
const OBJ = 'object.json', KEYS = 'keys.json', FORKED = 'forked/';
export const RESERVED = ['object.json', 'datacite.json', 'genesis.json', 'members.json', 'keys.json', 'forked',
                         'parent'];

export class Version {
  static async make(number, files, inventory, sidecar = null, witnesses = new Map()) {
    const v = new Version(number, files, inventory, sidecar, witnesses);
    v.digest = await sha512(inventory);
    if (v.forkRecord) v.carried = await carriedOf(files);
    return v;
  }

  constructor(number, files, inventory, sidecar, witnesses) {
    Object.assign(this, { number, files, inventory, sidecar, witnesses, isVersion: true, carried: [] });
  }

  get keys() {
    return jsonOrNull(this.files.get(KEYS), { integers: true });
  }

  get forkRecord() {
    return !this.files.has(KEYS) && [...this.files.keys()].some((p) => p.startsWith(FORKED));
  }
}

export function jsonOrNull(bytes, { integers = false } = {}) {
  if (!bytes) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (nesting(text) > LIMITS.nesting) return null;
    return integers ? parseIntegers(text) : JSON.parse(text);
  } catch {
    return null;
  }
}

const CARRIED_FILES = ['inventory.json', 'inventory.json.sha512', 'keys.json'];

async function carriedOf(files) {
  const groups = new Map();
  for (const [path, bytes] of files) {
    if (!path.startsWith(FORKED)) continue;
    const rest = path.slice(FORKED.length);
    const k = rest.indexOf('/');
    const d = k < 0 ? rest : rest.slice(0, k);
    if (!groups.has(d)) groups.set(d, new Map());
    groups.get(d).set(k < 0 ? '' : rest.slice(k + 1), bytes);
  }
  const out = [];
  for (const [d, group] of groups) {
    const inventory = group.get('inventory.json') || new Uint8Array();
    const inv = jsonOrNull(inventory);
    const head = isObject(inv) ? inv.head : null;
    const number = typeof head === 'string' && /^v[0-9]+$/.test(head) ? Number(head.slice(1)) : null;
    out.push({
      d, files: group, inventory, sidecar: group.get('inventory.json.sha512') || new Uint8Array(),
      digest: await sha512(inventory), number, isVersion: true, forkRecord: false,
      keys: jsonOrNull(group.get('keys.json'), { integers: true }),
      witnesses: new Map([...group].filter(([n]) => !CARRIED_FILES.includes(n))),
    });
  }
  return out.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

export function sidecarDigest(bytes) {
  if (!bytes) return null;
  let text;
  try {
    text = new TextDecoder('ascii', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length === 2 && parts[1] === 'inventory.json' ? parts[0] : null;
}

export function ownerObject(owner, previous = null) {
  const d = { format: OBJECT_FORMAT, specification: '0.2', kind: 'owner', status: 'active', name: owner, owner };
  if (previous !== null) d.previous = previous;
  return d;
}

export async function firstVersion(genesis) {
  const rec = await readGenesis(genesis);
  if (rec.kind !== 'owner') throw new Error('the genesis record of an owner has kind owner');
  const owner = await nameOf(genesis);
  const files = new Map([
    [GENESIS, genesis],
    [OBJ, jcsBytes(ownerObject(owner))],
    [KEYS, jcsBytes({ format: KEYS_FORMAT, keys: rec.keys, threshold: rec.threshold, next: rec.next,
                      nextThreshold: rec.nextThreshold })],
  ]);
  const manifest = {}, state = {};
  for (const [path, bytes] of files) {
    const d = await sha512(bytes);
    manifest[d] = [`v1/content/${path}`];
    state[d] = [path];
  }
  const inv = { digestAlgorithm: 'sha512', head: 'v1', id: objectId(owner, owner), manifest,
                type: INVENTORY_TYPE, versions: { v1: { created: rec.created, state } } };
  const bytes = jcsBytes(inv);
  return Version.make(1, files, bytes, utf8(`${await sha512(bytes)}  inventory.json\n`));
}

const KEYS_FIELDS = ['format', 'keys', 'threshold', 'next', 'nextThreshold', 'extensions', 'ended', 'successor', 'exposed'];

export async function keyRules(k, earlier, owner) {
  if (!isObject(k) || k.format !== KEYS_FORMAT) return [`keys.json is not of format ${KEYS_FORMAT}`];
  const problems = [];
  const extra = Object.keys(k).filter((f) => !KEYS_FIELDS.includes(f)).sort();
  if (extra.length) problems.push('keys.json has fields the specification does not define: ' + extra.join(', '));
  if ('ended' in k && k.ended !== true) problems.push('ended, when present, is true');
  if (k.ended === true) {
    if (['keys', 'threshold', 'next', 'nextThreshold'].some((f) => f in k)) {
      problems.push('an ending version has no keys, threshold, next or nextThreshold (section 6.3)');
    }
    const succ = k.successor;
    if (succ !== undefined && succ !== null && (typeof succ !== 'string' || !OWNER_NAME.test(succ) || succ === owner)) {
      problems.push('successor is the owner name of another owner (section 6.3)');
    }
  } else {
    if ('successor' in k) problems.push('only an ending version names a successor (section 6.3)');
    problems.push(...await keyRulesOfRecord(k));
  }
  if ('extensions' in k && !(isObject(k.extensions) && Object.values(k.extensions).every(isObject))) {
    problems.push('extensions maps names of extensions to objects');
  }
  let exposed = Array.isArray(k.exposed) ? k.exposed : [];
  if ('exposed' in k && (!Array.isArray(k.exposed) || !k.exposed.length ||
      !k.exposed.every((x) => typeof x === 'string' && DID_KEY.test(x)) || new Set(k.exposed).size !== k.exposed.length)) {
    problems.push('exposed is a list of distinct did:key URIs');
    exposed = [];
  }
  const strings = (x) => (Array.isArray(x) ? x.filter((y) => typeof y === 'string') : []);
  const keys = strings(k.keys), next = strings(k.next);
  const earlierKeys = new Set(earlier.flatMap((e) => strings(e?.keys)));
  const earlierNext = new Set(earlier.flatMap((e) => strings(e?.next)));
  const earlierExposed = new Set(earlier.flatMap((e) => strings(e?.exposed)));
  if (keys.some((x) => earlierExposed.has(x) || exposed.includes(x))) {
    problems.push('keys lists a key exposed by this version or an earlier one (rule 2)');
  }
  if ((await Promise.all(keys.map(keyDigest))).some((d) => earlierNext.has(d))) {
    problems.push('keys lists a rotation key of an earlier version (rule 2)');
  }
  const earlierKeyDigests = new Set(await Promise.all([...earlierKeys].map(keyDigest)));
  if (next.some((d) => earlierKeyDigests.has(d))) problems.push('next holds the digest of a current key of an earlier version (rule 3)');
  if (next.some((d) => earlierNext.has(d))) problems.push('next holds a digest that next of an earlier version holds (rule 3)');
  if (exposed.some((x) => !earlierKeys.has(x))) problems.push('exposed lists a key that keys of no earlier version lists (rule 4)');
  return problems;
}

export class KeyLog {
  static async of(genesis, versions = null, problems = []) {
    const owner = await nameOf(genesis);
    return new KeyLog(genesis, owner, versions || [await firstVersion(genesis)], problems);
  }

  constructor(genesis, owner, versions, problems = []) {
    this.genesis = genesis;
    this.owner = owner;
    this.id = objectId(owner, owner);
    this.versions = versions;
    this.problems = problems;
    this.checked = null;
    this.met = null;
  }

  pin(number) {
    return keyLogPin(this.owner, number, this.versions[number - 1].digest);
  }

  ready() {
    if (!this.checked?.result) {
      throw new Error(`the key log of ${this.owner} is read before it is checked (check() first)`);
    }
  }

  side() {
    this.ready();
    return this.versions.filter((v) => v.isVersion && !v.forkRecord);
  }

  latest() {
    if (this.ended) return null;
    const side = this.side();
    const last = side[side.length - 1];
    return last && isObject(last.keys) && 'keys' in last.keys ? last : null;
  }

  get forkRecord() {
    this.ready();
    return this.versions.find((v) => v.forkRecord && v.isVersion) || this.met || null;
  }

  get forkPoint() {
    return this.forkRecord?.carried[0]?.number ?? null;
  }

  get ended() {
    return this.forkRecord !== null || this.side().slice(1).some((v) => v.keys?.ended);
  }

  get successor() {
    return this.side().slice(1).find((v) => v.keys?.ended)?.keys.successor ?? null;
  }

  exposedKeys() {
    const found = new Set();
    for (const v of this.side()) for (const x of arrayOf(v.keys?.exposed)) found.add(x);
    for (const c of this.forkRecord?.carried || []) for (const x of arrayOf(c.keys?.exposed)) found.add(x);
    return found;
  }

  lookup(number, digest) {
    this.ready();
    for (const v of this.versions) if (v.number === number && v.digest === digest) return v;
    for (const c of this.forkRecord?.carried || []) if (c.number === number && c.digest === digest) return c;
    return null;
  }

  verified(number, digest) {
    const v = this.lookup(number, digest);
    return v && v.isVersion ? v : null;
  }

  extensions() {
    const side = this.side();
    if (side.length <= 1) return jsonOrNull(this.genesis)?.extensions ?? null;
    return side[side.length - 1].keys?.extensions ?? null;
  }

  async check() {
    if (!this.checked) {
      const checking = this.checkNow().then((result) => {
        checking.result = result;
        return result;
      });
      this.checked = checking;
    }
    return this.checked;
  }

  async checkNow() {
    const errors = [...this.problems], warnings = [];
    let rec = null;
    try {
      rec = await readGenesis(this.genesis);
    } catch (error) {
      errors.push(`genesis.json: ${error.message}`);
    }
    if (rec !== null && rec.kind !== 'owner') {
      errors.push('genesis.json: the genesis record of an owner has kind owner');
      rec = null;
    }
    if (rec === null || !this.versions.length) {
      for (const v of this.versions) v.isVersion = false;
      return { errors, warnings };
    }
    const v1 = this.versions[0];
    const computed = await firstVersion(this.genesis);
    if (v1.number !== 1 || !sameFiles(v1.files, computed.files) || !sameBytes(v1.inventory, computed.inventory)) {
      errors.push('v1: not the version computed from the genesis record (section 6.1)');
      v1.isVersion = false;
    } else if (v1.sidecar && v1.sidecar.length && sidecarDigest(v1.sidecar) !== v1.digest) {
      errors.push('v1: the checksum file does not state the digest of the inventory');
      v1.isVersion = false;
    }
    if ([...v1.witnesses.keys()].some((n) => n.startsWith('signature-'))) {
      warnings.push('v1: a signature file of the computed first version is invalid (section 7.3)');
    }
    const side = [v1];
    let state = v1.isVersion ? null : 'broken';
    for (const v of this.versions.slice(1)) {
      const where = `v${v.number}`;
      if (state === 'broken') {
        v.isVersion = false;
        warnings.push(`${where}: follows a version that is not a version of the key log`);
        continue;
      }
      if (state === 'forked' || (state === 'ended' && !v.forkRecord)) {
        v.isVersion = false;
        warnings.push(`${where}: held after ${state === 'forked' ? 'a fork record' : 'an ending version'}: ` +
                      'not a version of the key log (section 6.3)');
        continue;
      }
      const problems = await this.commonProblems(v, side[side.length - 1]);
      if (v.forkRecord) {
        problems.push(...await this.forkRecordProblems(v, side));
      } else if (v.keys === null) {
        problems.push('no keys.json, and not a fork record');
      } else {
        problems.push(...await keyRules(v.keys, side.map((x) => x.keys), this.owner));
        if (!problems.length) problems.push(...await this.signatureProblems(v, side[side.length - 1], heldLookup(side), warnings));
      }
      if (problems.length) {
        v.isVersion = false;
        errors.push(...problems.map((p) => `${where}: ${p}`));
        state = 'broken';
      } else if (v.forkRecord) {
        state = 'forked';
      } else {
        side.push(v);
        if (v.keys.ended) state = 'ended';
      }
    }
    return { errors, warnings };
  }

  async commonProblems(v, prev) {
    const problems = [];
    const inv = jsonOrNull(v.inventory);
    if (!isObject(inv) || inv.id !== this.id || inv.head !== `v${v.number}`) {
      problems.push(`the inventory is not that of v${v.number} of ${this.id}`);
    }
    if (v.sidecar && v.sidecar.length && sidecarDigest(v.sidecar) !== v.digest) {
      problems.push('the checksum file does not state the digest of the inventory');
    }
    if (!sameBytes(v.files.get(GENESIS), this.genesis)) problems.push('genesis.json differs from that of the first version');
    const obj = jsonOrNull(v.files.get(OBJ));
    const expected = ownerObject(this.owner, prev.digest);
    const withoutExtensions = isObject(obj) ? Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'extensions')) : null;
    if (!withoutExtensions || !same(withoutExtensions, expected)) {
      problems.push('object.json has not the fields of an owner and previous, the digest of ' +
                    `the inventory of v${prev.number} (section 4.3)`);
    }
    for (const path of v.files.keys()) {
      const top = path.split('/')[0];
      if (RESERVED.includes(top) && ![GENESIS, OBJ, KEYS].includes(path) && !path.startsWith(FORKED)) {
        problems.push(`${path}: a name reserved by section 4.1`);
      }
    }
    return problems;
  }

  async signatureProblems(v, prev, lookup, warnings, where = null) {
    where = where || `v${v.number}`;
    const need = prev.keys?.nextThreshold;
    if (prev.keys?.ended || !Number.isInteger(need)) {
      return [`follows v${prev.number}, which ends the key log or commits to no rotation keys: ` +
              'nothing follows an ending version (section 6.3)'];
    }
    const good = new Set();
    for (const j of await judgeFolder(v.witnesses, { objectId: this.id, version: `v${v.number}`, inventory: v.digest,
                                                       owner: this.owner, lookup, keyLog: true })) {
      if (j.status === GOOD && j.keyLog[0] === prev.number && j.keyLog[1] === prev.digest) good.add(j.key);
      else if (j.status !== GOOD) warnings.push(`${where}/${j.file}: ${j.status}: ${j.reason}`);
    }
    if (good.size < need) return [`signed by ${good.size} rotation key${good.size === 1 ? '' : 's'} of v${prev.number}, which needs ${need} (section 6.1)`];
    return [];
  }

  async forkRecordProblems(fr, side) {
    const problems = [...fr.files.keys()].filter((p) => p !== GENESIS && p !== OBJ && !p.startsWith(FORKED))
      .map((p) => `${p}: a fork record holds only genesis.json, object.json and forked/ (section 6.3)`);
    const carried = fr.carried;
    if (!carried.length || carried.some((c) => c.number === null)) {
      return [...problems, 'a fork record carries versions, each with its inventory'];
    }
    const first = carried[0].number;
    const held = new Map(side.map((x) => [x.number, x]));
    if (carried.some((c, k) => c.number !== first + k)) problems.push('the versions carried are consecutive');
    if (!held.has(first - 1) || !held.has(first) || held.get(first).digest === carried[0].digest) {
      problems.push(`the first version carried, v${first}, differs from a version held of that number`);
      return problems;
    }
    let before = side.filter((x) => x.number < first);
    for (const c of carried) {
      const where = `forked/${c.d}`;
      const inv = jsonOrNull(c.inventory);
      if (c.d !== base32(await sha256(c.inventory)).slice(0, 16)) problems.push(`${where}: not the name its inventory digest gives`);
      if (!isObject(inv) || inv.id !== this.id) {
        problems.push(`${where}: the inventory carried is not one of ${this.id}`);
        continue;
      }
      if (sidecarDigest(c.sidecar) !== c.digest) problems.push(`${where}: the checksum file does not state the digest of the inventory`);
      const state = inv.versions?.[`v${c.number}`]?.state || {};
      const keysDigest = c.files.has('keys.json') ? await sha512(c.files.get('keys.json')) : null;
      if (!keysDigest || !Object.entries(state).some(([d, paths]) => Array.isArray(paths) && paths.includes(KEYS) && d === keysDigest)) {
        problems.push(`${where}: keys.json is not the one its inventory lists`);
        continue;
      }
      const rules = await keyRules(c.keys, before.map((x) => x.keys), this.owner);
      problems.push(...rules.map((p) => `${where}: ${p}`));
      if (!rules.length) {
        const more = await this.signatureProblems(c, before[before.length - 1], heldLookup(before), [], where);
        problems.push(...more.map((p) => `${where}: ${p}`));
      }
      before = [...before, c];
    }
    return problems;
  }

  async meet(other) {
    const { errors } = await this.check();
    await other.check();
    if (errors.length || !sameBytes(this.genesis, other.genesis)) return this;
    const mine = this.side(), theirs = other.side();
    for (let k = 0; k < Math.min(mine.length, theirs.length); k++) {
      if (mine[k].digest !== theirs[k].digest) return this.withFork(theirs.slice(k));
    }
    const theirFork = other.forkRecord;
    if (theirs.length > mine.length) {
      if (this.forkRecord) return this;
      const log = new KeyLog(this.genesis, this.owner, [...mine, ...theirs.slice(mine.length), ...(theirFork ? [theirFork] : [])]);
      const result = { errors: [], warnings: [] };
      log.checked = Object.assign(Promise.resolve(result), { result });
      log.met = other.met;
      return log;
    }
    if (theirFork) {
      const first = theirFork.carried[0];
      const held = first && first.number <= mine.length ? mine[first.number - 1] : null;
      if (held && held.digest !== first.digest && !this.forkRecord) return this.withFork(theirFork.carried);
    }
    return this;
  }

  withFork(otherSide) {
    if (this.forkRecord) return this;
    const log = new KeyLog(this.genesis, this.owner, this.versions, this.problems);
    log.checked = this.checked;
    log.met = { carried: otherSide, isVersion: true, forkRecord: true, met: true };
    return log;
  }
}

function heldLookup(side) {
  return (number, digest) => side.find((x) => x.number === number && x.digest === digest) || null;
}

function sameFiles(a, b) {
  if (a.size !== b.size) return false;
  for (const [path, bytes] of a) if (!sameBytes(bytes, b.get(path))) return false;
  return true;
}

function arrayOf(x) {
  return Array.isArray(x) ? x : [];
}

export function describeVersion(v) {
  const k = v.keys || {};
  if (v.forkRecord) return 'fork record, carrying ' + v.carried.map((c) => `v${c.number}`).join(', ');
  if (k.ended) return 'ended' + (k.successor ? `, successor ${k.successor}` : '');
  const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return `${count(arrayOf(k.keys).length, 'current key')}, threshold ${k.threshold}, ` +
    `${count(arrayOf(k.next).length, 'rotation key')}, nextThreshold ${k.nextThreshold}` +
    (arrayOf(k.exposed).length ? `, exposes ${k.exposed.length}` : '');
}
