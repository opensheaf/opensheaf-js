Resolution: copies, pins and sheaf: URIs
========================================

> This chapter is chapter 15 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/15-resolve.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


A line is found by its name and owner, wherever it is held, never by a
location (section 12): a `sheaf:` URI names a line, a version or a pin; a
member of a collection names its line and pins a version, with `at`, the
base URLs where copies may be found (section 8.2); a branch names its
parent's line, with a hint, `parent.url` (section 9.1). Nothing found at
a location is believed: every copy is checked (section 12.3), its name
against its genesis record, its `object.json` against the line, its
versions against the owner's signatures, and the resolver uses the latest
signed version among the copies that agree.

This chapter gives the class `Resolver`, which does this over HTTP, as
opensheaf-py's resolver does from folders and over HTTP (its chapter
[20-resolution](https://opensheaf.org/opensheaf-py/20-resolution.html)),
with the same statuses, so that a member `osheaf verify --remote` finds
verified, the explorer finds verified. It differs in one respect:
opensheaf-py copies every remote object it resolves, and checks the
digest of every file on the way; a browser cannot download every PDF of
every member of a collection to show it, so the explorer checks the
inventories, checksum files, descriptions, genesis records and signature
files of a copy, which is what pins and statuses rest on, and leaves the
digests of content files to the verification of the archive that holds
them (chapter [17](17-verify.md)).

The module is `core/resolve.js`.

    // in core/resolve.js:
    import { Archive, baseOf } from './archive.js';
    import { LIMITS } from './http.js';
    import { isVersion, versionNumber } from './paths.js';
    import { objectId, isNameOf, parseSheaf, readGenesis, isObject } from './names.js';
    import { titleOf, creatorsOf, historyOf } from './versions.js';
    import { SIGNED, VOUCHED, CONTESTED, UNCHECKED, UNSIGNED, INVALID } from './signatures.js';

Statuses of members
-------------------

The status of a pin, as section 8.5 names it, from the status of the
version pinned (section 7.3): a version signed or vouched for is
*verified*, a contested one *contested*, an unchecked one *unchecked*,
and one that is not a version *not a version*. The other statuses come
from where copies were looked for: *mismatch* when a copy was found that
does not hold the pin, *unavailable* when none was, *removed* when none
was and an archive read holds a tombstone of the line.

    // in core/resolve.js:
    export const MEMBER_STATUS = {
      [SIGNED]: 'verified', [VOUCHED]: 'verified', [CONTESTED]: 'contested', [UNCHECKED]: 'unchecked',
      [UNSIGNED]: 'not a version', [INVALID]: 'not a version',
    };

A copy
------

A copy of a line is the object as one archive holds it (section 11),
read with its statuses (chapter [14](14-archive.md)), against the key log
the resolver has met: where it was found, the archive, the line read
there, the digest and status of each version, and its latest signed
version (0 when there is none). Two copies *agree* when they hold the
same inventory file at the earlier of their latest signed versions
(section 7.4).

    // in core/resolve.js:
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

What a resolver found: a status (section 8.5), and when there is one,
the copy, the version and its digest; with the copies seen.

    // in core/resolve.js:
    export function found(status, copy = null, version = null, digest = null, copies = [], log = null) {
      return { status, copy, version, digest, copies, log, ok: status === 'verified' || status === 'contested' };
    }

Local and private addresses
---------------------------

The locations a resolver tries are named by the data of archives: the
`at` of a member, a parent's `url`, a mirror. A hostile archive could
name addresses of the reader's own machine or network (a router's page,
a development server, a printer), and have the explorer, running in the
reader's browser and inside the reader's network, send requests there.
Most such requests fail on CORS, and they carry no credentials, but they
are still requests the reader never meant to make, and their timing tells
the archive what answers. So the explorer does not fetch, from locations
named in archive data, a host that is local or private: `localhost` and
names under `.localhost` or `.local`, the loopback addresses (127/8,
`::1`), the private ranges of RFC 1918 (10/8, 172.16/12, 192.168/16), the
link-local ones (169.254/16, fe80::/10), 0/8 and `::`, and the unique
local addresses fc00::/7 (also as IPv4-mapped IPv6 addresses). An archive
that is itself on such a host, as one under development is, may name
others: what is local to it is local to its reader. A name of the public
DNS that resolves to a private address is not seen; a browser does not
tell a page the address it connects to. The command line, which is not a
page in the reader's browser and fetches what opensheaf-py fetches, makes
its resolvers with `local: true`, which lifts this rule.

`localKind` says what a host is, as the URL parser writes it (IPv4
addresses in dotted decimal, IPv6 ones in brackets, in hexadecimal), or
`null` for a public host.

    // in core/resolve.js:
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

The resolver
------------

A resolver keeps the archives it has opened, by base URL, so that the
members of one archive (usually many) cost one discovery document, and
the key logs it has met, by owner. The archive being explored, if any, is
its home, which it reads first, as opensheaf-py reads the archive it
runs in; an archive of another version than 0.2, or one that cannot be
read, is noted, as are forks of lines and of key logs it meets. Notes
are what `osheaf verify --remote` reports under the place `resolution`.

A member resolved again must be resolved from the server, not from what
the resolver and its HTTP client have kept: the curator who presses
"Resolve again" has usually just fixed something. `again()` gives a
resolver for the same home, with nothing kept and an
[HTTP client](10-http.md) of its own, whose cache is empty (it shares the
pool and the page budget of the first).

    // in core/resolve.js:
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

An archive is opened once; one that cannot be read, or is not of version
0.2, counts as none, and is noted as unavailable, in the words of
opensheaf-py. The places a resolver looks in are the archive explored and
the locations it is given (the `at` of a URI or of a member, a parent's
`url`): hints, which a hostile collection may make many, each costing
requests and perhaps a time limit; at most `LIMITS.mirrors` of them are
tried, and the resolver notes how many were left (section 15.2). A
location on a local or private host is not fetched unless the home is on
one too (above); it is noted as unavailable, with the reason, which the
page of a collection shows under "What was met" and a verification under
`resolution`.

    // in core/resolve.js:
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

The archive of a parent version
-------------------------------

A branch records where its parent version is, `parent.url`, the URL of
the object version (section 9.1), not the base URL of the archive that
holds it, which the resolver needs to read that archive's discovery
document. As opensheaf-py's `archive_of` does, the prefixes of the URL
that end with `/` are tried, the conventional `.../ocfl/` cut first, then
from the longest to the shortest; the first whose discovery document
names a storage root (a relative path below the archive) that the URL is
below is the archive. A prefix that is not an archive is not noted: it
was only a guess. The answer, a list of one base URL or none, is kept,
and so is the archive found.

    // in core/resolve.js:
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

Key logs met
------------

The key log of an owner is read in every archive the resolver looks in,
and the copies are met (chapter [07](07-owners.md)): the longer one is
used, and a fork between them is noted, and ends the owner for this
reader. A key log is copied beside every copy of the lines it signs
(section 6.5), so this finds it wherever a line is found.

    // in core/resolve.js:
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

What a reader is told about an owner (section 12.3): an end, by an ending
version or a fork, its successor, and the keys it exposes.

    // in core/resolve.js:
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

Copies of a line
----------------

The copies of the line (name, owner) at the places given, after the home:
an archive other than the home counts only if its discovery document
lists the line; each copy found must be a copy of the line (below); and
its statuses are judged against the key log met in every archive read so
far, as opensheaf-py's `copies` does. A line taken down in an archive read
and found elsewhere is noted (section 12.3).

    // in core/resolve.js:
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
          out.push(new Copy(w, archive, line));
        }
        if (out.length && await this.tombstoned(id, where, options)) {
          this.note('result', `${id}: taken down in an archive read, and found elsewhere (section 12.3)`);
        }
        return out;
      }

A copy is one of the line when its inventory names it, the name is a name
of its genesis record (section 5.2), and every version's `object.json`
records the line (section 12.3).

    // in core/resolve.js:
      async identityProblem(archive, id, line, options) {
        if (line.inv.id !== id) return 'its inventory names another object';
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

A pin
-----

The status of a pin (version, digest) of the line (name, owner), as
section 8.5 defines it: the status of the version that holds the pin in a
copy found; *mismatch* when copies were found and none holds it;
*removed* or *unavailable* when none was found. A pin of a key log is
verified when the key log met holds or carries that version (section
12.3).

    // in core/resolve.js:
      async pin(name, owner, version, digest, where = [], options = {}) {
        if (name === owner) {
          const log = await this.keyLog(owner, where, options);
          const v = log && isVersion(version) ? log.lookup(versionNumber(version), digest) : null;
          if (v) return found('verified', null, version, digest, [], log);
          return found(log ? 'mismatch' : 'unavailable', null, version, digest, [], log);
        }
        const copies = await this.copies(name, owner, where, options);
        const n = isVersion(version) ? versionNumber(version) : 0;
        for (const c of copies) {
          if (n && c.digest(n) === digest) return found(MEMBER_STATUS[c.status(n)] || 'not a version', c, version, digest, copies);
        }
        if (copies.length) return found('mismatch', null, version, digest, copies);
        return found(await this.tombstoned(objectId(name, owner), where, options) ? 'removed' : 'unavailable',
                     null, version, digest, copies);
      }

The latest signed version
-------------------------

Since a copy that stops early looks complete, the resolver uses the
latest signed version among the copies that agree (section 12.3); copies
that are signed and do not agree with the one that goes furthest are a
fork of the line, noted with the status of each side, and nothing is
chosen. Without a signed copy, the line is *not a version* when copies
were found, and otherwise *removed* or *unavailable*.

    // in core/resolve.js:
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

A document version of a line, without a digest, is the object version
holding it that the history of the latest signed version lists (section
12.1).

    // in core/resolve.js:
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

sheaf: URIs
-----------

A `sheaf:` URI is resolved at its `at` first, then at the places given
(section 12.3), with short forms expanded among the lines of the archives
read (section 12.2). It names a key log (`sheaf:<owner>`: its latest
version, or a version), a line (its latest signed version), a document
version, or a pin; `sheaf:<name>:*`, a work, is searched for in indexes
(section 12.4), which the explorer does not do. The answer is the
identifier of the line and what was found.

    // in core/resolve.js:
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

The line a URI names, among the lines the archives read list: a complete
URI with its owner part names its line; otherwise the candidates are the
lines whose name and owner start with the parts given, without an owner
part only the originators' lines (whose owner is the originator its
genesis record names, or an owner's own key log). Exactly one candidate
is needed; several are ambiguous, and listed (section 12.2).

    // in core/resolve.js:
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
          const inv = await archive.inventory(id, null, options);
          const genesis = await archive.bytes(id, inv, 'v1', 'genesis.json', options);
          return genesis ? (await readGenesis(genesis)).originator ?? null : null;
        } catch (error) {
          if (error?.kind === 'aborted') throw error;
          return null;
        }
      }

Describing what was found
-------------------------

A collection keeps a cached citation of each member (`cite`), which is
not authoritative (section 8.2). Once a pin is resolved, the explorer
shows the member as the copy found states it: the title and creators of
the version presented, the document version it holds, and the status of
the line, read from its latest signed version (section 13.1): a
withdrawal in the member's line is shown, also one made after the version
pinned (section 8.3). For a catalogue's member, the version presented is
the current version read from the history of the version pinned (section
8.3).

    // in core/resolve.js:
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

The pin presented
-----------------

What is presented of a member is read at one of its pins: the last
revision of a selection's member (the revision presented as the
selection's, section 8.4), or the single pin of a catalogue's member.

    // in core/resolve.js:
    export function presentedPin(m) {
      if (m && Object.hasOwn(m, 'revisions')) {
        const revs = Array.isArray(m.revisions) ? m.revisions : [];
        return revs.length ? revs[revs.length - 1]?.version : null;
      }
      return m?.version ?? null;
    }

A budget for walking collections
--------------------------------

A collection may have collections as members, in any archive, and those
may have more: section 14.1 lets a verifier bound the depth it follows,
and section 15.2 asks it to bound what it fetches. A walk through
collections has a budget: a depth (levels of member collections opened)
and a number of pins resolved; when either is spent, the walk stops and
says why. A collection reached twice in one walk is shown once.

    // in core/resolve.js:
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
