// Generated from literate/32-keepers.md by opensheaf-literate: edit the document, not this file.
import { readGenesis, OWNER_NAME, keeperDomain } from './names.js';
import { parseJson } from './http.js';

export const KEEPER_FORMAT = 'opensheaf-keeper/0.2';
export const CONFIRMED = 'confirmed', CLAIMED = 'claimed only', ABSENT = 'absent', NOT_CHECKED = 'not checked';
export const ORCID_API = 'https://pub.orcid.org/v3.0/{}/researcher-urls';
export const KEEPER_TIMEOUT = 15_000;
const OWNER_WORD = /(?<![a-z0-9])[a-z2-7]{51}[aq](?![a-z0-9])/g;

export class KeeperUnreachable extends Error {}

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
      return parseJson(data, url);
    } catch {
      throw new KeeperUnreachable(`${url}: not JSON`);
    }
  };
}

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
  if (!orcid && !keeperDomain(keeper)) return link(NOT_CHECKED, 'not a DNS name (an address, localhost): not fetched');
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

export function successorClaim(log, link) {
  if (!link || link.successor === null || link.successor === undefined || link.successor === log.successor) return null;
  if (log.successor) return `claimed by the keeper (the ending version names ${log.successor}; section 6.6)`;
  return 'named by the keeper (section 6.6)';
}
