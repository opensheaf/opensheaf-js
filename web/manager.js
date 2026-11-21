// Generated from literate/49-manager.md by opensheaf-literate: edit the document, not this file.
import { environment, ArchiveFolder } from '../core/folder.js';
import { loadSchemas } from '../core/schema.js';
import { fetchJsonWith } from '../core/keepers.js';
import { Key, readKey, passkeysOf, passkeySalt, passkeyKek, PASSKEY_RP, KeyError } from '../core/keys.js';
import { describeEntry } from '../core/wallets.js';
import { sameBytes, unbase64 } from '../core/crypto.js';
import { oneCommit } from '../core/github.js';
import { carryOut } from '../core/requests.js';

export { GitHub, GitHubStorage, GitHubError, CommitConflict, oneCommit, gitBlobSha, GITHUB_API } from '../core/github.js';
export { carryOut, Problem, OPERATIONS, WORKFLOW_ONLY, NEW_PAPER, NEW_VERSION } from '../core/requests.js';
export { popupUrl, popupRequest, openPopupAnswer, sameCode, confirmationCode, POPUP, POPUP_MESSAGES, UNLOCK_ORIGIN,
         UnlockFailed } from '../core/passkey.js';
export { Key, readKey, KeyError, PASSKEY_RP } from '../core/keys.js';
export { GitHubWallet, WalletError } from '../core/wallets.js';
export { ArchiveFolder, Stop } from '../core/folder.js';

export function browserEnvironment({ assets, keys = new Map(), fetch = globalThis.fetch?.bind(globalThis) } = {}) {
  const refuse = (what) => async () => {
    throw new Error(`the Manager does not ${what}: use osheaf on your computer`);
  };
  return environment({
    out: () => {},
    err: () => {},
    fetch,
    fetchJson: fetchJsonWith(fetch),
    template: async (name) => (name in (assets?.templates || {}) ? new TextEncoder().encode(assets.templates[name]) : null),
    newKey: refuse('make keys'),
    passphrase: refuse('ask for passphrases'),
    input: refuse('ask questions'),
    keyStore: {
      keptOnDevice: () => false,
      storeName: () => 'the memory of this page',
      current: async (owner, dids) => (keys.get(owner) || []).filter((k) => dids.includes(k.did)),
      keep: refuse('keep keys'),
    },
    signingKeyGiven: true,
  });
}

export async function schemasOf(assets) {
  return loadSchemas(async (url) => assets.schemas[String(url).split('/').pop()]);
}

export async function signers(storage, env) {
  const f = await ArchiveFolder.open(storage, env);
  const owner = f.archive.owner;
  const log = await f.keyLog(owner);
  const latest = log?.latest();
  if (!latest) return { owner, dids: [], threshold: 0 };
  return { owner, dids: [...latest.keys.keys], threshold: latest.keys.threshold };
}

export async function walletLocks(wallet, owner, dids) {
  const salt = await passkeySalt(owner);
  const out = [];
  for (const [o, kid] of await wallet.entries(owner)) {
    const text = await wallet.read(o, kid, 'current');
    if (!text) continue;
    const fields = describeEntry(text);
    if (fields.kind !== 'current' || !dids.includes(fields.key)) continue;
    const creds = passkeysOf(text).filter((p) => p.rp === PASSKEY_RP && sameBytes(p.salt, salt)).map((p) => p.cred);
    out.push({ kid, did: fields.key, text, creds });
  }
  return out;
}

const PKCS8_ED25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

export async function sealedKey(key) {
  const signing = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8_ED25519, ...key.seed]),
                                                { name: 'Ed25519' }, false, ['sign']);
  key.seed.fill(0);
  return new Key(null, signing, key.publicKey, key.did, key.digest);
}

export async function openLocks(locks, owner, cred, prf) {
  const kek = await passkeyKek(prf);
  const keys = [];
  for (const lock of locks) {
    if (!lock.creds.includes(cred)) continue;
    const rk = await readKey(lock.text, null, { [cred]: kek });
    if (rk.owner !== owner || rk.kind !== 'current' || rk.key.did !== lock.did) {
      throw new KeyError(`the wallet's entry ${lock.kid} holds another key`);
    }
    keys.push(await sealedKey(rk.key));
  }
  kek.fill(0);
  return keys;
}

export async function keyFromText(text, { passphrase = null, owner = null } = {}) {
  const line = text.trim();
  if (/^[A-Za-z0-9+/]{43}=$/.test(line)) {
    if (!owner) throw new KeyError('a seed alone: give the owner of the key');
    return { owner, kind: 'current', key: await sealedKey(await Key.fromSeed(unbase64(line))) };
  }
  const rk = await readKey(text, passphrase);
  return { owner: rk.owner, kind: rk.kind, key: await sealedKey(rk.key) };
}

export function prefetched(path, size = null) {
  return (size !== null && size < 4096) || path === 'osheaf.json' || path === 'opensheaf.json' || path.startsWith('collections/') ||
    path.startsWith('templates/') || (path.startsWith('ocfl/') && /\.(json|sha512)$/.test(path)) ||
    (path.startsWith('ocfl/') && !path.includes('/content/'));
}

export async function directWrite({ repo, github, operation, fields, files = {}, env, schemas, assets = null,
                                    mirror = null, cache = new Map(), origin = 'the OpenSheaf manager',
                                    progress = () => {}, attempts = 3 }) {
  const done = await oneCommit(repo, github, async (storage) => {
    progress('carrying out');
    const answer = await carryOut(storage, env, operation, fields, files, { origin, schemas, digests: false });
    if (answer.ok) progress('committing');
    return { message: answer.ok ? answer.commitMessage : null, answer };
  }, { mirror, cache, attempts, prepare: async (storage) => {
    progress('reading');
    await storage.prefetch({ skip: (p, size) => !prefetched(p, size), concurrency: 12 });
  } });
  return { ...done.answer, commit: done.commit, reads: done.storage.reads, attempts: done.attempts ?? 1 };
}
