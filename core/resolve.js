// Generated from literate/15-resolve.md by opensheaf-literate: edit the document, not this file.
import { Archive, baseOf } from './archive.js';
import { LIMITS } from './http.js';
import { isVersion, versionNumber } from './paths.js';
import { objectId, isNameOf, parseSheaf, readGenesis, isObject, NAME } from './names.js';
import { titleOf, creatorsOf, historyOf } from './versions.js';
import { SIGNED, VOUCHED, CONTESTED, UNCHECKED, UNSIGNED, INVALID } from './signatures.js';

export const MEMBER_STATUS = {
  [SIGNED]: 'verified', [VOUCHED]: 'verified', [CONTESTED]: 'contested', [UNCHECKED]: 'unchecked',
  [UNSIGNED]: 'not a version', [INVALID]: 'not a version',
};

export class Copy {
  constructor(where, archive, line) {
    Object.assign(this, { where, archive, line, id: line.id });
  }

  get head() {
    return this.line.versions.length;
  }

  get statuses() {
    return this.line.statuses;
  }

  get latestSigned() {
    return this.line.latest ? versionNumber(this.line.latest) : 0;
  }

  digest(n) {
    return n > 0 && n <= this.line.versions.length ? this.line.versions[n - 1].digest : null;
  }

  status(n) {
    return n > 0 && n <= this.statuses.length ? this.statuses[n - 1] : null;
  }

  find(digest) {
    const k = this.line.versions.findIndex((v) => v.digest === digest);
    return k < 0 ? null : k + 1;
  }

  obj(n) {
    return this.line.versions[n - 1]?.obj ?? null;
  }

  agrees(other) {
    const k = Math.min(this.latestSigned, other.latestSigned);
    return k === 0 || this.digest(k) === other.digest(k);
  }
}

export function found(status, copy = null, version = null, digest = null, copies = [], log = null) {
  return { status, copy, version, digest, copies, log, ok: status === 'verified' || status === 'contested' };
}

function ipv6Groups(text) {
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (s) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
  const head = groups(halves[0]), tail = halves.length === 2 ? groups(halves[1]) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const out = [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
  return out.length === 8 && out.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? out : null;
}

function ipv4Kind([a, b]) {
  if (a === 127) return 'a loopback address';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'a private address';
  if (a === 169 && b === 254) return 'a link-local address';
  if (a === 0) return 'an address of this network';
  return null;
}

export function localKind(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return 'a loopback address';
  if (host === 'local' || host.endsWith('.local')) return 'a name of the local network (.local)';
  if (/^[0-9]+(\.[0-9]+){3}$/.test(host)) return ipv4Kind(host.split('.').map(Number));
  if (!host.startsWith('[')) return null;
  const g = ipv6Groups(host.slice(1, -1));
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return ipv4Kind([g[6] >> 8, g[6] & 255]);
  if (g.slice(0, 7).every((x) => x === 0)) return g[7] === 1 ? 'a loopback address' : g[7] === 0 ? 'an address of this network' : null;
  if ((g[0] & 0xfe00) === 0xfc00) return 'a unique local address';
  if ((g[0] & 0xffc0) === 0xfe80) return 'a link-local address';
  return null;
}

export class Resolver {
  constructor(http, home = null, { local = false } = {}) {
    this.http = http;
    this.home = home;
    this.local = local;
    this.archives = new Map();
    this.logs = new Map();
    this.notes = [];
    if (home) this.archives.set(home.base, Promise.resolve(home));
  }

  again() {
    const fresh = new Resolver(this.http.another(), null, { local: this.local });
    if (this.home) fresh.home = this.home;
    return fresh;
  }

  note(level, message) {
    if (!this.notes.some((n) => n.level === level && n.message === message)) this.notes.push({ level, message });
  }

  source(where, options = {}) {
    const base = baseOf(where);
    if (!this.archives.has(base)) {
      const refused = this.refused(base);
      if (refused) {
        this.note('warning', `unavailable: ${where}: ${refused}`);
        this.archives.set(base, Promise.resolve(null));
        return this.archives.get(base);
      }
      const opening = Archive.open(this.http, base, options).then((archive) => {
        if (archive.old || archive.disc.specification !== '0.2') {
          this.note('warning', `unavailable: ${where}: not an archive of specification 0.2`);
          return null;
        }
        if (archive.pageProblems?.length) {
          this.note('warning', `unavailable: ${where}: ${archive.pageProblems[0]}`);
          return null;
        }
        return archive;
      }, (error) => {
        if (error?.kind === 'aborted') {
          this.archives.delete(base);
          throw error;
        }
        this.note('warning', `unavailable: ${where}: ${error.kind === 'not-found' ? 'no discovery document opensheaf.json'
          : error.kind === 'json' ? 'the discovery document is not JSON' : error.detail || error.message}`);
        return null;
      });
      this.archives.set(base, opening);
    }
    return this.archives.get(base);
  }

  refused(base) {
    const kind = localKind(new URL(base).hostname);
    if (!kind || this.local) return null;
    if (this.home && localKind(new URL(this.home.base).hostname)) return null;
    return `not fetched: ${new URL(base).hostname} is ${kind}, which the explorer fetches only for an archive ` +
      'that is itself on a local or private host';
  }

  places(where) {
    const out = this.home ? [this.home.base] : [];
    const given = [];
    for (const w of where) {
      if (typeof w !== 'string' || !w) continue;
      let base;
      try {
        base = baseOf(w);
      } catch {
        continue;
      }
      if (!out.includes(base) && !given.includes(base)) given.push(base);
    }
    if (given.length > LIMITS.mirrors) {
      this.note('warning', `${given.length - LIMITS.mirrors} more location(s) not tried (at most ${LIMITS.mirrors} are tried, section 15.2)`);
    }
    return [...out, ...given.slice(0, LIMITS.mirrors)];
  }

  async archiveOf(url, options = {}) {
    this.bases ??= new Map();
    if (this.bases.has(url)) return this.bases.get(url);
    const out = [];
    this.bases.set(url, out);
    let u;
    try {
      u = new URL(url);
    } catch {
      return out;
    }
    if (!['https:', 'http:'].includes(u.protocol) || !u.host) return out;
    const origin = `${u.protocol}//${u.host}`, path = u.pathname, whole = origin + path;
    const cuts = [];
    for (let k = path.length - 2; k >= 0; k--) if (path[k] === '/') cuts.push(k + 1);
    const guess = path.indexOf('/ocfl/');
    if (guess >= 0) cuts.unshift(guess + 1);
    for (const k of [...new Set(cuts)]) {
      const base = origin + path.slice(0, k);
      if (this.refused(base)) continue;
      let archive = this.archives.has(base) ? await this.archives.get(base) : null;
      if (!archive) {
        try {
          archive = await Archive.open(this.http, base, options);
        } catch (error) {
          if (error?.kind === 'aborted') throw error;
          continue;
        }
        if (archive.old || archive.disc.specification !== '0.2') continue;
      }
      const root = archive.disc.storageRoot ?? 'ocfl/';
      if (typeof root !== 'string' || root.includes(':') || !root.endsWith('/') ||
          root.slice(0, -1).split('/').some((x) => ['', '.', '..'].includes(x)) || root.includes('\\')) continue;
      if (whole.startsWith(archive.root) && whole.length > archive.root.length) {
        this.archives.set(base, Promise.resolve(archive));
        out.push(base);
        break;
      }
    }
    return out;
  }

  async keyLog(owner, where = [], options = {}) {
    if (!this.logs.has(owner)) this.logs.set(owner, { log: null, met: new Set(), found: [] });
    const entry = this.logs.get(owner);
    for (const w of this.places(where)) {
      if (entry.met.has(w)) continue;
      entry.met.add(w);
      const archive = await this.source(w, options);
      if (!archive) continue;
      let log;
      try {
        log = await archive.keyLog(owner, options);
      } catch (error) {
        if (error?.kind === 'aborted') throw error;
        this.note('warning', `${w}: the key log of ${owner}: ${error.detail || error.message}`);
        continue;
      }
      if (!log || log.owner !== owner) continue;
      entry.found.push({ where: w, log });
      const before = entry.log;
      entry.log = before ? await before.meet(log) : log;
      if (before && before.forkPoint === null && entry.log.forkPoint !== null) {
        this.note('result', `a fork of the key log of ${owner} at v${entry.log.forkPoint}, met at ${w} (section 6.3)`);
      }
    }
    return entry.log;
  }

  ownerNotes(owner) {
    const log = this.logs.get(owner)?.log;
    if (!log) return [];
    const out = [];
    if (log.forkPoint) out.push(`owner ${owner} ended by a fork of its key log at v${log.forkPoint}`);
    else if (log.ended) out.push(`owner ${owner} ended`);
    if (log.successor) out.push(`owner ${owner}: successor ${log.successor} named by its ending version`);
    for (const did of [...log.exposedKeys()].sort()) out.push(`owner ${owner}: exposed key ${did}`);
    return out;
  }

  async copies(name, owner, where = [], options = {}) {
    const id = objectId(name, owner);
    const held = [];
    for (const w of this.places(where)) {
      const archive = await this.source(w, options);
      if (!archive) continue;
      if (archive !== this.home && !archive.objects().some((o) => o.id === id)) continue;
      await this.keyLog(owner, archive === this.home ? [] : [w], options);
      held.push({ w, archive });
    }
    const log = await this.keyLog(owner, [], options);
    const out = [];
    for (const { w, archive } of held) {
      let line;
      try {
        line = await archive.line(id, { log, signal: options.signal });
      } catch (error) {
        if (error?.kind === 'aborted') throw error;
        if (error?.kind !== 'not-found') this.note('warning', `${w}: ${id}: ${error.detail || error.message}`);
        continue;
      }
      const problem = await this.identityProblem(archive, id, line, options);
      if (problem) {
        this.note('warning', `${w}: ${id}: not a copy of the line: ${problem}`);
        continue;
      }
      if (archive !== this.home) {
        for (const v of line.versions) {
          if (!v.digest) continue;
          const sc = await archive.sidecar(id, v.ver, options).catch((error) => {
            if (error?.kind === 'aborted') throw error;
            return '';
          });
          if (sc !== v.digest) {
            this.note('warning', `${w}: ${id} ${v.ver}: the checksum file of its inventory is missing, or does not state its digest (section 12.3)`);
          }
        }
      }
      out.push(new Copy(w, archive, line));
    }
    if (out.length && await this.tombstoned(id, where, options)) {
      this.note('result', `${id}: taken down in an archive read, and found elsewhere (section 12.3)`);
    }
    return out;
  }

  async identityProblem(archive, id, line, options) {
    if (line.inv.id !== id) return 'its inventory names another object';
    if (line.inventoriesProblem) return line.inventoriesProblem;
    const [, name, owner] = id.split(':');
    let genesis = null;
    try {
      genesis = await archive.bytes(id, line.inv, 'v1', 'genesis.json', options);
    } catch (error) {
      if (error?.kind === 'aborted') throw error;
    }
    if (!genesis || !await isNameOf(name, genesis)) return 'the name is not a name of its genesis record (section 5.2)';
    for (const v of line.versions) {
      if (v.obj?.name !== name || v.obj?.owner !== owner) return `${v.ver}: object.json does not record the line`;
    }
    return null;
  }

  async tombstoned(id, where = [], options = {}) {
    for (const w of this.places(where)) {
      const archive = await this.source(w, options);
      if (archive?.tombstones().some((t) => t.id === id)) return true;
    }
    return false;
  }

  async pin(name, owner, version, digest, where = [], options = {}) {
    if (!([name, owner].every((x) => typeof x === 'string' && NAME.test(x)) &&
          typeof version === 'string' && /^v[1-9][0-9]*$/.test(version) &&
          typeof digest === 'string' && /^[0-9a-f]{128}$/.test(digest))) {
      const repr = (x) => (typeof x === 'string' ? `'${x}'` : 'None');
      this.note('warning', `sheaf:${name}:${owner}: the pin ${repr(version)} sha512=${repr(digest)} is not a line, ` +
                'an object version and a digest (section 8.5)');
      return found('not a version', null, typeof version === 'string' ? version : null, digest, []);
    }
    if (name === owner) {
      const log = await this.keyLog(owner, where, options);
      const v = log && isVersion(version) ? log.lookup(versionNumber(version), digest) : null;
      if (v && log.verified(versionNumber(version), digest)) return found('verified', null, version, digest, [], log);
      return found(!log ? 'unavailable' : v ? 'not a version' : 'mismatch', null, version, digest, [], log);
    }
    const copies = await this.copies(name, owner, where, options);
    const n = isVersion(version) ? versionNumber(version) : 0;
    for (const c of copies) {
      const d = n ? c.digest(n) : null;
      if (d && d !== digest) this.note('warning', `${c.where}: ${objectId(name, owner)} ${version} does not match the pin (section 12.3)`);
    }
    for (const c of copies) {
      if (n && c.digest(n) === digest) return found(MEMBER_STATUS[c.status(n)] || 'not a version', c, version, digest, copies);
    }
    if (copies.length) return found('mismatch', null, version, digest, copies);
    return found(await this.tombstoned(objectId(name, owner), where, options) ? 'removed' : 'unavailable',
                 null, version, digest, copies);
  }

  async latest(name, owner, where = [], options = {}) {
    const copies = await this.copies(name, owner, where, options);
    const signed = copies.filter((c) => c.latestSigned).sort((a, b) => b.latestSigned - a.latestSigned);
    if (!signed.length) {
      const status = copies.length ? 'not a version'
        : await this.tombstoned(objectId(name, owner), where, options) ? 'removed' : 'unavailable';
      return found(status, null, null, null, copies);
    }
    const top = signed[0];
    const forks = signed.filter((c) => !top.agrees(c));
    for (const c of forks) {
      this.note('result', `a fork of the line ${top.id}: the copy at ${c.where} (latest signed ` +
        `v${c.latestSigned}) does not agree with the copy at ${top.where} (latest signed ` +
        `v${top.latestSigned}) (section 7.4)`);
    }
    if (forks.length) return found('fork', null, null, null, copies);
    return found('verified', top, `v${top.latestSigned}`, top.digest(top.latestSigned), copies);
  }

  async documentVersion(name, owner, n, where = [], options = {}) {
    const latest = await this.latest(name, owner, where, options);
    if (!latest.copy) return latest;
    const c = latest.copy;
    const objOf = (v) => c.line.objs.get(v) ?? null;
    for (const h of historyOf(c.line.inv, objOf, latest.version)) {
      if (objOf(h)?.documentVersion === n) {
        const k = versionNumber(h);
        return found(MEMBER_STATUS[c.status(k)] || 'not a version', c, h, c.digest(k), latest.copies);
      }
    }
    this.note('warning', `${c.id}: no document version ${n} in the history of ${latest.version}`);
    return found('unavailable', null, null, null, latest.copies);
  }

  async resolve(text, where = [], options = {}) {
    const u = parseSheaf(text, { short: true, fold: true });
    where = [...(u.at ? [u.at] : []), ...where];
    if (u.owner === '*') throw new Error('a work, sheaf:<name>:*, is searched for (section 12.4), which the explorer does not do');
    const [name, owner] = await this.expand(u, where, options);
    if (name === owner) {
      const id = objectId(owner, owner);
      const log = await this.keyLog(owner, where, options);
      if (!log) return { id, found: found('unavailable') };
      const side = log.side();
      if (u.version === null) {
        const v = side[side.length - 1];
        return { id, found: found('verified', null, `v${v.number}`, v.digest, [], log) };
      }
      if (u.sha512 === null) {
        if (u.version > side.length) return { id, found: found('unavailable', null, null, null, [], log) };
        return { id, found: found('verified', null, `v${u.version}`, side[u.version - 1].digest, [], log) };
      }
      return { id, found: await this.pin(owner, owner, `v${u.version}`, u.sha512, where, options) };
    }
    const id = objectId(name, owner);
    if (u.version === null) return { id, found: await this.latest(name, owner, where, options) };
    if (u.sha512 === null) return { id, found: await this.documentVersion(name, owner, u.version, where, options) };
    const copies = await this.copies(name, owner, where, options);
    for (const c of copies) {
      const k = c.find(u.sha512);
      if (k === null) continue;
      const held = c.obj(k)?.documentVersion;
      if (held !== u.version) {
        this.note('warning', `${id}: the version pinned holds document version ${held}, not ${u.version}`);
        return { id, found: found('mismatch', c, `v${k}`, u.sha512) };
      }
      return { id, found: found(MEMBER_STATUS[c.status(k)] || 'not a version', c, `v${k}`, u.sha512) };
    }
    const status = copies.length ? 'mismatch' : await this.tombstoned(id, where, options) ? 'removed' : 'unavailable';
    return { id, found: found(status, null, null, u.sha512, copies) };
  }

  async expand(u, where, options = {}) {
    if (u.isComplete() && u.owner !== null) return [u.name, u.owner];
    const candidates = new Set();
    for (const w of this.places(where)) {
      const archive = await this.source(w, options);
      if (!archive) continue;
      for (const o of archive.objects()) {
        const name = typeof o.name === 'string' ? o.name : '', owner = typeof o.owner === 'string' ? o.owner : '';
        if (!u.matches(name, owner)) continue;
        if (u.owner === null) {
          if (o.kind === 'owner' ? name !== owner : await this.originator(archive, o.id, options) !== owner) continue;
        }
        candidates.add(`${name} ${owner}`);
      }
    }
    if (candidates.size !== 1) {
      const listed = [...candidates].sort().map((c) => `  sheaf:${c.replace(' ', ':')}`).join('\n');
      throw new Error(`${u}: ` + (candidates.size ? 'ambiguous, the candidates are:\n' + listed
        : 'no line of that name in the archives read'));
    }
    return [...candidates][0].split(' ');
  }

  async originator(archive, id, options = {}) {
    try {
      const inv = await archive.headInventory(id, options);
      const genesis = await archive.bytes(id, inv, 'v1', 'genesis.json', options);
      return genesis ? (await readGenesis(genesis)).originator ?? null : null;
    } catch (error) {
      if (error?.kind === 'aborted') throw error;
      return null;
    }
  }

  async describe(result, { presentCurrent = false } = {}, options = {}) {
    const c = result.copy;
    if (!c) return null;
    const objOf = (v) => c.line.objs.get(v) ?? null;
    const shown = presentCurrent ? historyOf(c.line.inv, objOf, result.version).slice(-1)[0] || result.version : result.version;
    const { obj, dc } = await c.archive.descriptions(c.id, c.line.inv, shown, options);
    const latest = c.line.latest ? objOf(c.line.latest) : null;
    return {
      version: shown, title: titleOf(dc), creators: creatorsOf(dc), documentVersion: obj?.documentVersion ?? null,
      status: latest?.status ?? null, withdrawal: latest?.withdrawal ?? null, archive: c.archive,
    };
  }
}

export function presentedPin(m) {
  if (m && Object.hasOwn(m, 'revisions')) {
    const revs = Array.isArray(m.revisions) ? m.revisions : [];
    return revs.length ? revs[revs.length - 1]?.version : null;
  }
  return m?.version ?? null;
}

export class Budget {
  constructor({ depth = LIMITS.depth, pins = LIMITS.pins } = {}) {
    this.depth = depth;
    this.pins = pins;
    this.used = 0;
    this.walked = new Set();
    this.stopped = [];
  }

  allows(depth) {
    return depth <= this.depth && this.used < this.pins;
  }

  take(count) {
    const granted = Math.max(0, Math.min(count, this.pins - this.used));
    this.used += granted;
    return granted;
  }

  reason(depth) {
    if (depth > this.depth) return `the depth limit (${this.depth} levels of member collections) is reached`;
    return `the limit of ${this.pins} pins resolved in one walk is reached`;
  }

  first(id, ver) {
    const key = JSON.stringify([id, ver]);
    if (this.walked.has(key)) return false;
    this.walked.add(key);
    return true;
  }
}
