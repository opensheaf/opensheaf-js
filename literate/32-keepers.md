Keepers
=======

The genesis record of an owner may name a **keeper** (section 6.6): an
ORCID iD or `https://<domain>/`, who answers for the owner. The link is
confirmed when the keeper's own place names the owner: a link of the
ORCID record (its researcher URLs, read at
`https://pub.orcid.org/v3.0/<id>/researcher-urls`) whose address holds the
owner name as a word, or the file `.well-known/opensheaf` of the domain, of
format `opensheaf-keeper/0.2`, listing the owner. Without that, the link is
only claimed. A keeper may also name a successor of the owner, which a
reader weighs against the successor the ending version of the key log
names.

This chapter ports `keeper_link` of opensheaf-py (its chapter
[06-owners](https://opensheaf.org/opensheaf-py/06-owners.html)), with the
same statuses and reasons; the landing pages mark a confirmed keeper
(chapter [31](31-website.md)), and `osheaf verify --remote` reports the link
(chapter [28](28-verify-folder.md)). The place is read with a function of a
URL, `fetchJson`, which the tests replace.

    // in core/keepers.js:
    import { readGenesis, OWNER_NAME } from './names.js';

    export const KEEPER_FORMAT = 'opensheaf-keeper/0.2';
    export const CONFIRMED = 'confirmed', CLAIMED = 'claimed only', ABSENT = 'absent', NOT_CHECKED = 'not checked';
    export const ORCID_API = 'https://pub.orcid.org/v3.0/{}/researcher-urls';
    export const KEEPER_TIMEOUT = 15_000;
    const OWNER_WORD = /(?<![a-z0-9])[a-z2-7]{51}[aq](?![a-z0-9])/g;

    export class KeeperUnreachable extends Error {}

    <<reading the place of a keeper>>

    <<the link to a keeper>>

Reading the place of a keeper
-----------------------------

The JSON value at a URL, or `null` when there is none (HTTP 404 or 410);
`KeeperUnreachable` when it cannot be read: an error of the network, of the
server, an answer of more than 1 MB, or one that is not JSON.

    // in reading the place of a keeper:
    export function fetchJsonWith(fetch = globalThis.fetch?.bind(globalThis)) {
      return async (url) => {
        let response;
        try {
          response = await fetch(url, { headers: { Accept: 'application/json' },
                                        signal: AbortSignal.timeout(KEEPER_TIMEOUT) });
        } catch (error) {
          throw new KeeperUnreachable(`${url}: ${error.cause?.message || error.message}`);
        }
        if (response.status === 404 || response.status === 410) return null;
        if (!response.ok) throw new KeeperUnreachable(`${url}: HTTP ${response.status}`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.length > 1 << 20) throw new KeeperUnreachable(`${url}: more than 1 MB`);
        try {
          return JSON.parse(new TextDecoder().decode(data));
        } catch {
          throw new KeeperUnreachable(`${url}: not JSON`);
        }
      };
    }

The link to a keeper
--------------------

    // in the link to a keeper:
    export async function keeperOf(log) {
      try {
        return log ? ((await readGenesis(log.genesis)).keeper || [null])[0] : null;
      } catch {
        return null;
      }
    }

    export async function keeperLink(log, fetchJson = null) {
      fetchJson ||= fetchJsonWith();
      const keeper = await keeperOf(log), owner = log.owner;
      if (keeper === null) return { keeper: null, status: ABSENT, reason: 'the owner names no keeper', successor: null };
      const link = (status, reason, successor = null) => ({ keeper, status, reason, successor });
      const orcid = keeper.startsWith('https://orcid.org/');
      const url = orcid ? ORCID_API.replace('{}', keeper.slice(keeper.lastIndexOf('/') + 1)) : keeper + '.well-known/opensheaf';
      let data;
      try {
        data = await fetchJson(url);
      } catch (error) {
        if (!(error instanceof KeeperUnreachable)) throw error;
        return link(NOT_CHECKED, `offline: ${error.message}`);
      }
      const isMap = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
      if (orcid) {
        const links = isMap(data) ? data['researcher-url'] : null;
        for (const item of Array.isArray(links) ? links : []) {
          const value = isMap(item) ? (item.url || {}).value : null;
          const found = typeof value === 'string' ? value.match(OWNER_WORD) || [] : [];
          if (found.length && found[0] === owner) {
            const others = found.slice(1).filter((w) => w !== owner);
            return link(CONFIRMED, 'ORCID record links the owner', others[0] ?? null);
          }
        }
        return link(CLAIMED, 'the ORCID record has no link naming the owner');
      }
      if (data === null) return link(CLAIMED, `there is no ${url}`);
      if (!isMap(data) || data.format !== KEEPER_FORMAT) return link(CLAIMED, `${url} is not of format ${KEEPER_FORMAT}`);
      if (!(Array.isArray(data.owners) && data.owners.includes(owner))) return link(CLAIMED, `${url} does not list the owner`);
      let succ = isMap(data.successors) ? data.successors[owner] : null;
      succ = typeof succ === 'string' && OWNER_NAME.test(succ) && succ !== owner ? succ : null;
      return link(CONFIRMED, `${url} lists the owner`, succ);
    }

A successor the keeper names is "named by the keeper" when the key log
names none, and only "claimed by the keeper" when the ending version of
the key log names another.

    // in the link to a keeper:
    export function successorClaim(log, link) {
      if (!link || link.successor === null || link.successor === undefined || link.successor === log.successor) return null;
      if (log.successor) return `claimed by the keeper (the ending version names ${log.successor}; section 6.6)`;
      return 'named by the keeper (section 6.6)';
    }
