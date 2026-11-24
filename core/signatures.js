// Generated from literate/08-signatures.md by opensheaf-literate: edit the document, not this file.
import { verifyEd25519, utf8, unbase64 } from './crypto.js';
import { nesting, LIMITS } from './http.js';
import { didKeyPublic, keyId, keyDigest, OWNER_NAME, DID_KEY } from './names.js';

export const SIGNATURE_FORMAT = 'opensheaf-signature/0.2';
export const WITNESSES = 'extensions/opensheaf-witnesses';

export function message(objectId, version, inventory, keyLog) {
  return utf8(`${SIGNATURE_FORMAT}\nobject ${objectId}\nversion ${version}\ninventorySha512 ${inventory}\nkeyLog ${keyLog}\n`);
}

export async function fileName(did) {
  return `signature-${await keyId(did)}.json`;
}

const FIELDS = {
  format: new RegExp(`^${SIGNATURE_FORMAT.replace(/[./]/g, '\\$&')}$`),
  object: /^sheaf:[a-z2-7]{52}:[a-z2-7]{51}[aq]$/,
  version: /^v[1-9][0-9]*$/,
  inventorySha512: /^[0-9a-f]{128}$/,
  signer: OWNER_NAME,
  key: DID_KEY,
  keyLog: /^sheaf:([a-z2-7]{51}[aq])\/v([1-9][0-9]*)\?sha512=([0-9a-f]{128})$/,
  signature: /^[A-Za-z0-9+/]{85}[AQgw]==$/,
};

export function readSignatureFile(bytes) {
  let d;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (nesting(text) > LIMITS.nesting) throw new Error(`nested deeper than ${LIMITS.nesting} levels`);
    d = JSON.parse(text);
  } catch (error) {
    throw new Error(`not JSON in UTF-8 (${error.message})`);
  }
  const names = Object.keys(FIELDS);
  if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).length !== names.length ||
      !names.every((n) => Object.hasOwn(d, n))) {
    throw new Error('a signature file has exactly the fields ' + names.join(', '));
  }
  for (const [field, pattern] of Object.entries(FIELDS)) {
    if (typeof d[field] !== 'string' || !pattern.test(d[field])) throw new Error(`${field} is not of its form`);
  }
  didKeyPublic(d.key);
  if (FIELDS.keyLog.exec(d.keyLog)[1] !== d.signer) throw new Error('keyLog names the key log of another owner than the signer');
  return d;
}

export const GOOD = 'good', UNCHECKED = 'unchecked', INVALID = 'invalid';

export async function judge(bytes, file, { objectId, version, inventory, owner, lookup, keyLog = false }) {
  const bad = (reason, d = null) => ({ file, status: INVALID, reason, key: d?.key ?? null, keyLog: null, threshold: null });
  let d;
  try {
    d = readSignatureFile(bytes);
  } catch (error) {
    return bad(`malformed: ${error.message}`);
  }
  if (file !== await fileName(d.key)) return bad('its name does not match the digest of its key');
  let signature;
  try {
    signature = unbase64(d.signature);
  } catch {
    return bad('the signature is not base64', d);
  }
  if (!await verifyEd25519(didKeyPublic(d.key), message(d.object, d.version, d.inventorySha512, d.keyLog), signature)) {
    return bad('the signature does not verify', d);
  }
  if (d.object !== objectId || d.version !== version || d.inventorySha512 !== inventory) {
    return bad('it signs another version, or another inventory', d);
  }
  if (d.signer !== owner) return bad('its signer is not the owner of the line', d);
  const [, , number, digest] = FIELDS.keyLog.exec(d.keyLog);
  const n = Number(number);
  if (keyLog && (version === 'v1' || n !== Number(version.slice(1)) - 1)) {
    return bad('a key-log version is signed against the version before it, never the first', d);
  }
  const found = lookup(n, digest);
  if (!found) {
    return { file, status: UNCHECKED, reason: `v${n} of the key log, with that digest, is not reached`,
             key: d.key, keyLog: [n, digest], threshold: null };
  }
  if (found.forkRecord || !found.isVersion) return bad(`v${n} is not a version of the key log, or is a fork record`, d);
  const keys = found.keys || {};
  let threshold;
  if (keyLog) {
    if (!(Array.isArray(keys.next) && keys.next.includes(await keyDigest(d.key)))) {
      return bad(`the key is not a rotation key of v${n} of the key log`, d);
    }
    threshold = keys.nextThreshold;
  } else {
    if (!(Array.isArray(keys.keys) && keys.keys.includes(d.key))) return bad(`the key is not a current key of v${n} of the key log`, d);
    threshold = keys.threshold;
  }
  return { file, status: GOOD, reason: '', key: d.key, keyLog: [n, digest], threshold };
}

export async function judgeFolder(witnesses, context) {
  const names = [...witnesses.keys()].filter((n) => n.startsWith('signature-') && n.endsWith('.json')).sort();
  return Promise.all(names.map((n) => judge(witnesses.get(n), n, context)));
}

export const SIGNED = 'signed', VOUCHED = 'vouched for', CONTESTED = 'contested', UNSIGNED = 'unsigned';

export function signedDirectly(judgements, leaveOut = null) {
  const groups = new Map();
  for (const j of judgements) {
    if (j.status !== GOOD || (leaveOut && leaveOut(j))) continue;
    const key = j.keyLog.join(' ');
    if (!groups.has(key)) groups.set(key, { threshold: j.threshold, keys: new Set() });
    groups.get(key).keys.add(j.key);
  }
  return [...groups.values()].some((g) => g.keys.size >= g.threshold);
}

export function lineStatuses(versions, { exposed = new Set(), forkPoint = null, trusted = null } = {}) {
  const leaveOut = (j) => {
    const suspect = exposed.has(j.key) || (forkPoint !== null && j.keyLog[0] >= forkPoint);
    return suspect && !(trusted && trusted(j));
  };
  const direct = versions.map((js) => signedDirectly(js));
  const clean = versions.map((js) => signedDirectly(js, leaveOut));
  const would = versions.map((js) => js.some((j) => j.status === UNCHECKED) || signedDirectly(js));
  const later = (list, k) => list.slice(k).some(Boolean);
  return versions.map((js, k) => {
    if (direct[k] || later(direct, k + 1)) {
      if (clean[k] || later(clean, k + 1)) return direct[k] ? SIGNED : VOUCHED;
      return CONTESTED;
    }
    if (would[k] || later(would, k + 1)) return UNCHECKED;
    return js.some((j) => j.status === INVALID) ? INVALID : UNSIGNED;
  });
}

export function latestSigned(statuses) {
  let found = null;
  statuses.forEach((s, k) => { if (s === SIGNED || s === VOUCHED) found = k + 1; });
  return found;
}

export async function lineStatusesOf(objectId, owner, versions, log) {
  if (log) await log.check();
  const lookup = log ? (n, d) => log.lookup(n, d) : () => null;
  const judgements = await Promise.all(versions.map(({ version, digest, witnesses }) =>
    judgeFolder(witnesses, { objectId, version, inventory: digest, owner, lookup })));
  const statuses = lineStatuses(judgements, log ? { exposed: log.exposedKeys(), forkPoint: log.forkPoint } : {});
  return { judgements, statuses };
}
