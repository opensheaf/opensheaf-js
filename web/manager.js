// Generated from literate/49-manager.md by opensheaf-literate: edit the document, not this file.
import { environment, ArchiveFolder } from '../core/folder.js';
import { loadSchemas } from '../core/schema.js';
import { fetchJsonWith } from '../core/keepers.js';
import { Key, readKey, passkeysOf, passkeySalt, passkeyKek, Passkey, wrapsOf, PASSKEY_RP, KeyError, PassphraseNeeded,
         CURRENT, ROTATION, newKey, readRotationKey, rotationKeyText, rotationFileName, rotationKeySheet,
         sheetCheck } from '../core/keys.js';
import { describeEntry, putKey, addPasskey, readAny, WalletError, hints, ownersHeld } from '../core/wallets.js';
import { keyWallet } from '../core/owner.js';
import { sameBytes, unbase64 } from '../core/crypto.js';
import { oneCommit } from '../core/github.js';
import { carryOut } from '../core/requests.js';
import { rotate, loadKeyLog, OwnerError } from '../core/keylogs.js';
import { objectId, keeperValid } from '../core/names.js';
import { writeKeyLog, newOwner } from '../core/write.js';
import { MemoryStorage } from '../core/storage.js';
import { base64 } from '../core/keys.js';
import { writeDiscovery } from '../core/discovery.js';
import { readableIndex, hasWebsite } from '../core/website.js';
import { verifyFolder } from '../core/check.js';
import { short, plural, Stop } from '../core/folder.js';

export { GitHub, GitHubStorage, GitHubError, CommitConflict, oneCommit, gitBlobSha, GITHUB_API } from '../core/github.js';
export { carryOut, Problem, OPERATIONS, WORKFLOW_ONLY, NEW_PAPER, NEW_VERSION } from '../core/requests.js';
export { popupUrl, popupRequest, openPopupAnswer, sameCode, confirmationCode, POPUP, POPUP_ENROLL, POPUP_MESSAGES,
         UNLOCK_ORIGIN, UnlockFailed } from '../core/passkey.js';
export { Key, readKey, KeyError, PASSKEY_RP, CURRENT, ROTATION, newKey, sheetCheck } from '../core/keys.js';
export { GitHubWallet, WalletError, hints as walletHints, ownersHeld } from '../core/wallets.js';
export { OwnerError } from '../core/keylogs.js';
export { ArchiveFolder, Stop } from '../core/folder.js';
export { verifyFolder } from '../core/check.js';

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
  if (!latest) return { owner, dids: [], threshold: 0, versions: {}, number: null, next: [], nextThreshold: 0 };
  const versions = {};
  for (const did of latest.keys.keys) {
    versions[did] = log.side().find((v) => v.keys && (v.keys.keys || []).includes(did))?.number ?? null;
  }
  return { owner, dids: [...latest.keys.keys], threshold: latest.keys.threshold, versions, number: latest.number,
           next: [...(latest.keys.next || [])], nextThreshold: latest.keys.nextThreshold ?? 0 };
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

export async function checkWallet(wallet) {
  wallet.checkName();
  const info = await wallet.api('GET', `repos/${wallet.repo}`);
  if (info === null) {
    throw new WalletError(`no repository ${wallet.repo} that this sign-in can reach: create it, private, and install ` +
                          'the OpenSheaf app on it');
  }
  if (info.private !== true || info.visibility !== 'private') {
    throw new WalletError(`${wallet.repo} is not a private repository: a wallet must be private`);
  }
  if (wallet.forbidden.has(String(info.full_name ?? wallet.repo).toLowerCase())) {
    throw new WalletError(`${wallet.repo} is a repository of the archive, which is public: a wallet is a repository of its own`);
  }
  if (info.permissions && info.permissions.push !== true) {
    throw new WalletError(`this sign-in cannot write to ${wallet.repo}`);
  }
  wallet.checked = true;
  return info;
}

export async function walletEntries(wallet, owner) {
  const out = [];
  for (const [o, kid] of await wallet.entries(owner)) {
    const text = await readAny(wallet, o, kid);
    if (text) out.push({ kid, text, fields: describeEntry(text) });
  }
  return out;
}

export function passphraseConfirmed(entries) {
  return !entries.some((e) => wrapsOf(e.text).length);
}

export async function checkPassphrase(entries, passphrase, owner, walletName) {
  const locked = entries.filter((e) => wrapsOf(e.text).length);
  if (!locked.length) return;
  try {
    await readKey(locked[0].text, passphrase);
  } catch (error) {
    if (error instanceof KeyError) {
      throw new WalletError(`${error.message}: this is not the passphrase of the keys of ${owner} in ${walletName}`);
    }
    throw error;
  }
}

export async function keyToPush(text, { owner, dids }) {
  const line = String(text ?? '').trim();
  let key, of = owner;
  if (/^[A-Za-z0-9+/]{43}=$/.test(line)) {
    key = await Key.fromSeed(unbase64(line));
  } else {
    let rk;
    try {
      rk = await readKey(String(text ?? ''));
    } catch (error) {
      if (error instanceof PassphraseNeeded) {
        throw new KeyError('this key is locked with a passphrase: give the key file of osheaf\'s key store, or the ' +
                           'text of osheaf key export without --encrypt');
      }
      if (error instanceof KeyError) {
        throw new KeyError(`not a key file of osheaf (${error.message}): give the file OWNER/K.key of its key store, ` +
                           'or the text of osheaf key export');
      }
      throw error;
    }
    if (rk.kind !== CURRENT) {
      rk.key.seed?.fill(0);
      throw new KeyError(`this is a ${rk.kind} key: only a current key is put in the wallet here`);
    }
    key = rk.key;
    of = rk.owner;
  }
  if (of !== owner || !dids.includes(key.did)) {
    key.seed.fill(0);
    throw new KeyError(of !== owner ? `this key is of the owner ${of}, not of the archive's owner ${owner}`
      : `${key.did} is not a current key of the latest version of the owner's key log`);
  }
  return key;
}

export async function pushKey(wallet, owner, key, version, passphrase, { cost = {} } = {}) {
  if ((await wallet.read(owner, key.id, CURRENT)) !== null) return false;
  await putKey(wallet, owner, key, CURRENT, version, passphrase, [], cost);
  return true;
}

const encrypted = (text) => text.split(/\r\n|\r|\n/).some((x) => {
  const p = x.split(/\s+/).filter(Boolean);
  return x.startsWith('encryption ') && p[1] !== 'none';
});

export async function enrollPlan(wallet, owner, { newPasskey = false, entries = null } = {}) {
  entries = (entries || await walletEntries(wallet, owner)).filter((e) => encrypted(e.text));
  if (!entries.length) throw new WalletError(`the wallet ${wallet.name} holds no key of ${owner} locked with a passphrase`);
  const salt = await passkeySalt(owner);
  const ours = (text) => passkeysOf(text).filter((p) => sameBytes(p.salt, salt) && p.rp === PASSKEY_RP).map((p) => p.cred);
  const known = [...new Set(entries.flatMap((e) => ours(e.text)))];
  const fresh = Boolean(newPasskey) || !known.length;
  const todo = fresh ? entries : entries.filter((e) => !passkeysOf(e.text).some((p) => known.includes(p.cred)));
  return { owner, salt, entries, known, fresh, todo };
}

export async function openWithPassphrase(plan, passphrase, walletName) {
  for (const e of plan.todo) {
    try {
      await readKey(e.text, passphrase);
    } catch (error) {
      if (error instanceof KeyError) throw new WalletError(`${walletName} ${e.kid}: ${error.message}: nothing was changed`);
      throw error;
    }
  }
}

export async function enrollPasskey(wallet, plan, passphrase, cred, prf, { cost = {}, progress = () => {} } = {}) {
  if (plan.fresh && plan.known.includes(cred)) throw new WalletError('the page sent no new passkey: nothing was changed');
  const kek = await passkeyKek(prf);
  try {
    if (!plan.fresh) {
      let opens = false;
      for (const e of plan.entries) {
        if (!passkeysOf(e.text).some((p) => p.cred === cred)) continue;
        try {
          await readKey(e.text, null, { [cred]: kek });
          opens = true;
          break;
        } catch (error) {
          if (!(error instanceof KeyError)) throw error;
        }
      }
      if (!opens) throw new WalletError('the passkey used does not open the keys it is enrolled for: nothing was changed');
    }
    const passkey = new Passkey(cred, plan.salt, { kek });
    const done = [];
    for (const e of plan.todo) {
      done.push(await addPasskey(wallet, plan.owner, e.kid, passphrase, passkey, cost));
      progress(done.length, plan.todo.length);
    }
    return done;
  } finally {
    kek.fill(0);
  }
}

export function walletCandidates(settings, owner, given = []) {
  const out = [];
  for (const w of [...hints(settings?.keys, owner), ...given]) {
    if (typeof w === 'string' && /^github:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

export async function holdingWallet(wallets, owner) {
  for (const w of wallets) {
    try {
      if ((await w.entries(owner)).length) return w;
    } catch (error) {
      if (!(error instanceof WalletError)) throw error;
    }
  }
  return null;
}

export async function directRecordWallet({ repo, github, env, owner, wallet, mirror = null, cache = new Map(),
                                           origin = 'the OpenSheaf manager', attempts = 3 }) {
  const said = [];
  const quiet = { ...env, out: (l) => said.push(l), err: (l) => said.push(l) };
  const done = await oneCommit(repo, github, async (storage) => {
    said.length = 0;
    const f = await ArchiveFolder.open(storage, quiet);
    try {
      await keyWallet(f, { owner, add: wallet }, quiet);
    } catch (error) {
      if (error instanceof Stop) throw new OwnerError(error.message);
      throw error;
    }
    const recorded = said.some((l) => l.startsWith('Done: '));
    return { message: recorded ? `Key wallet ${wallet} hinted for ${short(owner)} in osheaf.json (${origin})\n` : null,
             recorded };
  }, { mirror, cache, attempts });
  return { recorded: Boolean(done.recorded), commit: done.commit || null, said };
}

export function walletRotationKeys(entries, next) {
  return entries.filter((e) => e.fields.kind === ROTATION && next.includes(e.fields.digest)).map((e) => e.fields.digest);
}

async function signing(rk, { owner, number, next }, where) {
  if ((rk.owner !== null && rk.owner !== owner) || rk.kind !== ROTATION || !next.includes(rk.key.digest)) {
    rk.key.seed?.fill(0);
    throw new KeyError(rk.owner !== null && rk.owner !== owner ? `${where} is a rotation key of ${short(rk.owner)}, not of ${short(owner)}`
      : rk.kind !== ROTATION ? `${where} is a ${rk.kind} key, not a rotation key`
      : `${where}: ${rk.key.did} is not a rotation key that v${number} of the key log commits (used up already, or of another version)`);
  }
  return sealedKey(rk.key);
}

function enough(keys, { number, nextThreshold }, where) {
  if (keys.length < nextThreshold) {
    throw new KeyError(`${where} ${plural(keys.length, 'rotation key')} of v${number} of the key log, and ` +
                       `${nextThreshold} sign the next version`);
  }
  return keys;
}

export async function rotationKeysFromTexts(files, plan, passphrase = null) {
  const out = [];
  for (const { name, text } of files) {
    let rk;
    try {
      try {
        rk = await readRotationKey(text);
      } catch (error) {
        if (!(error instanceof PassphraseNeeded)) throw error;
        if (!passphrase) throw new KeyError('it is locked with a passphrase: give the passphrase');
        rk = await readRotationKey(text, passphrase);
      }
    } catch (error) {
      if (error instanceof KeyError) throw new KeyError(`${name}: ${error.message}`);
      throw error;
    }
    if (out.some((k) => k.did === rk.key.did)) {
      rk.key.seed?.fill(0);
      continue;
    }
    out.push(await signing(rk, plan, name));
  }
  return enough(out, plan, 'given:');
}

export async function rotationKeysFromWallet(wallet, plan, passphrase) {
  const out = [];
  for (const digest of plan.next) {
    const kid = digest.slice(0, 16);
    const text = await wallet.read(plan.owner, kid, ROTATION);
    if (!text) continue;
    let rk;
    try {
      rk = await readKey(text, passphrase);
    } catch (error) {
      if (error instanceof KeyError) throw new WalletError(`${wallet.name} ${plan.owner}/${kid}: ${error.message}`);
      throw error;
    }
    out.push(await signing(rk, plan, `${wallet.name} ${plan.owner}/${kid}`));
    if (out.length === plan.nextThreshold) break;
  }
  return enough(out, plan, `the wallet ${wallet.name} holds`);
}

export async function newKeys(plan) {
  const rotation = [];
  for (let k = 0; k < plan.next.length; k++) rotation.push(await newKey());
  return { current: await newKey(), rotation };
}

export async function rotationFiles(keys, owner, version, passphrase, { cost = {} } = {}) {
  const files = [];
  for (const key of keys) {
    const name = rotationFileName(owner, key);
    const text = await rotationKeyText(key, owner, version, passphrase, cost);
    if ((await readRotationKey(text, passphrase)).key.did !== key.did) throw new KeyError(`${name} does not read back`);
    files.push({ name, did: key.did, digest: key.digest, text, check: await sheetCheck(key.seed),
                 sheet: await rotationKeySheet(key, owner, version) });
  }
  for (const key of keys) key.seed.fill(0);
  return files;
}

export function checksConfirmed(files, typed) {
  return files.every((f, k) => String(typed[k] ?? '').trim().toUpperCase() === f.check);
}

export async function keepRotationKeys(wallet, owner, keys, version, passphrase, { cost = {} } = {}) {
  try {
    for (const key of keys) await putKey(wallet, owner, key, ROTATION, version, passphrase, [], cost);
  } catch (error) {
    if (error instanceof WalletError || error instanceof KeyError) {
      throw new WalletError(`${error.message}: nothing was written to the key log`);
    }
    throw error;
  }
  for (const key of keys) key.seed.fill(0);
}

export const NEW_KEY_MESSAGE = 'Keys changed';

export async function rotateAdding(storage, env, plan, signers, { add, next, created = null }) {
  const f = await ArchiveFolder.open(storage, env);
  const owner = f.archive.owner;
  const dir = await f.dirOf(objectId(owner, owner));
  if (owner !== plan.owner || (await storage.kind(`${dir}/inventory.json`)) !== 'file') {
    throw new OwnerError(`the key log of ${short(plan.owner)} is not in the storage root`);
  }
  const log = await loadKeyLog(storage, dir);
  const prev = log.latest();
  if (!prev) throw new OwnerError(`the owner ${short(owner)} has ended (section 6.3): its key log takes no new version`);
  if (prev.number !== plan.number) {
    throw new OwnerError(`the key log of ${short(owner)} changed meanwhile (v${prev.number}, not v${plan.number}): ` +
                         'nothing was written; start again');
  }
  const v = await rotate(log, signers, { nextKeys: next, nextThreshold: Math.min(prev.keys.nextThreshold, next.length),
                                         add: [add], message: NEW_KEY_MESSAGE, user: f.depositor(),
                                         created: created || env.now() });
  await writeKeyLog(storage, dir, log);
  f.changed();
  await writeDiscovery(f);
  return { owner, number: v.number, dids: [...v.keys.keys], threshold: v.keys.threshold };
}

export async function directRotate({ repo, github, env, schemas, plan, signers, add, next, created = null,
                                     mirror = null, cache = new Map(), origin = 'the OpenSheaf manager',
                                     progress = () => {}, attempts = 3 }) {
  created ||= env.now();
  const done = await oneCommit(repo, github, async (storage) => {
    progress('carrying out');
    let v;
    try {
      v = await rotateAdding(storage, env, plan, signers, { add, next, created });
    } catch (error) {
      if (error instanceof Stop) throw new OwnerError(error.message);
      throw error;
    }
    if (schemas) {
      const report = await verifyFolder(storage, { schemas, digests: false, fetch: env.fetch, fetchJson: env.fetchJson });
      if (report.counts().error) {
        const errors = report.findings.filter((x) => x.level === 'error').map((x) => `${x.place}: ${x.message}`);
        throw new OwnerError(`the archive would not verify: ${errors.slice(0, 5).join('; ')}`);
      }
    }
    progress('committing');
    const message = `Keys changed: v${v.number} of the key log of ${short(v.owner)}, a new current key ` +
      `${short(add)} (${origin})\n\n` + v.dids.map((d) => `current key ${d}\n`).join('');
    return { message, version: v };
  }, { mirror, cache, attempts, prepare: async (storage) => {
    progress('reading');
    await storage.prefetch({ skip: (p, size) => !prefetched(p, size), concurrency: 12 });
  } });
  return { ...done.version, commit: done.commit };
}

export const ROTATION_KEYS = 3;

export async function newOwnerKeys({ workflows = true, rotation = ROTATION_KEYS } = {}) {
  const keys = { current: await newKey(), workflows: workflows ? await newKey() : null, rotation: [] };
  for (let k = 0; k < rotation; k++) keys.rotation.push(await newKey());
  return keys;
}

export async function ownerKeyLog(keys, { keeper = null, created = null, nonce = null } = {}) {
  if (keeper && !keeperValid(keeper)) {
    throw new OwnerError(`a keeper is an ORCID iD (with its check digit) or https://<domain>/: ${keeper}`);
  }
  return newOwner([keys.current, ...(keys.workflows ? [keys.workflows] : [])], keys.rotation,
                  { threshold: 1, nextThreshold: Math.floor(keys.rotation.length / 2) + 1, keeper: keeper || null,
                    created, nonce });
}

export async function keyLogFolder(log) {
  const storage = new MemoryStorage();
  await writeKeyLog(storage, '', log);
  return { storage, dir: '', where: `the key log of ${short(log.owner)} made in the page` };
}

export async function signingCopy(key) {
  return sealedKey(await Key.fromSeed(Uint8Array.from(key.seed)));
}

export async function directSetup({ repo, github, fields, keyLog, defaultBase = null, ownerLabel = '', env, schemas,
                                    mirror = null, cache = new Map(), origin = 'the OpenSheaf manager',
                                    progress = () => {}, attempts = 3 }) {
  const owner = ownerLabel ? (await keyLog.storage.read(`${keyLog.dir ? keyLog.dir + '/' : ''}inventory.json`)) : null;
  const after = ownerLabel ? async (storage) => {
    const id = JSON.parse(new TextDecoder().decode(owner)).id;
    await labelOwner(storage, env, id.split(':')[1], ownerLabel);
  } : null;
  return directWrite({ repo, github, operation: 'setup', fields, env, schemas, mirror, cache, origin, progress, attempts,
                       options: { keyLog, defaultBase }, after });
}

const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function ownerLabelProblem(label) {
  if (!LABEL.test(label) || label.length > 64) {
    return `\`${label}\` is not a valid label: at most 64 characters, lower-case letters and digits, words joined by \`-\``;
  }
  return null;
}

export async function labelOwner(storage, env, owner, label) {
  const problem = ownerLabelProblem(label);
  if (problem) throw new OwnerError(problem);
  const f = await ArchiveFolder.open(storage, env);
  const id = objectId(owner, owner);
  const taken = f.labels.get(label);
  if ((taken && taken !== id) || label === f.archive.mainCollection) {
    throw new OwnerError(`\`${label}\` is already taken in this archive`);
  }
  for (const [l, i] of [...f.labels]) if (i === id) f.labels.delete(l);
  f.labels.set(label, id);
  await writeDiscovery(f);
  if (hasWebsite(f)) await readableIndex(f);
}

export function seedLine(key) {
  return base64(key.seed);
}

export async function sealedBox(message, publicKey) {
  const nacl = (await import('tweetnacl')).default;
  const { createBLAKE2b } = await import('hash-wasm');
  if (publicKey.length !== nacl.box.publicKeyLength) throw new KeyError('not an X25519 public key');
  const drawn = crypto.getRandomValues(new Uint8Array(nacl.box.secretKeyLength));
  const pair = nacl.box.keyPair.fromSecretKey(drawn);
  drawn.fill(0);
  const h = await createBLAKE2b(nacl.box.nonceLength * 8);
  h.init();
  h.update(pair.publicKey);
  h.update(publicKey);
  const nonce = h.digest('binary');
  const boxed = nacl.box(message, nonce, publicKey, pair.secretKey);
  pair.secretKey.fill(0);
  const out = new Uint8Array(pair.publicKey.length + boxed.length);
  out.set(pair.publicKey);
  out.set(boxed, pair.publicKey.length);
  return out;
}

export async function openSealedBox(sealed, publicKey, secretKey) {
  const nacl = (await import('tweetnacl')).default;
  const { createBLAKE2b } = await import('hash-wasm');
  const epk = sealed.slice(0, nacl.box.publicKeyLength);
  const h = await createBLAKE2b(nacl.box.nonceLength * 8);
  h.init();
  h.update(epk);
  h.update(publicKey);
  const opened = nacl.box.open(sealed.slice(epk.length), h.digest('binary'), epk, secretKey);
  if (!opened) throw new KeyError('the sealed box does not open with this key');
  return opened;
}

export const SIGNING_SECRET = 'OPENSHEAF_SIGNING_KEY';

export async function storeSecret(github, repo, name, value) {
  const pk = await github.request('GET', `repos/${repo}/actions/secrets/public-key`);
  const bytes = new TextEncoder().encode(value);
  let sealed;
  try {
    sealed = await sealedBox(bytes, unbase64(pk.key));
  } finally {
    bytes.fill(0);
  }
  await github.request('PUT', `repos/${repo}/actions/secrets/${name}`, { encrypted_value: base64(sealed), key_id: pk.key_id });
}

export function prefetched(path, size = null) {
  return (size !== null && size < 4096) || path === 'osheaf.json' || path === 'opensheaf.json' || path.startsWith('collections/') ||
    path.startsWith('templates/') || (path.startsWith('ocfl/') && /\.(json|sha512)$/.test(path)) ||
    (path.startsWith('ocfl/') && !path.includes('/content/'));
}

export async function directWrite({ repo, github, operation, fields, files = {}, env, schemas, assets = null,
                                    mirror = null, cache = new Map(), origin = 'the OpenSheaf manager',
                                    progress = () => {}, attempts = 3, options = {}, after = null }) {
  const done = await oneCommit(repo, github, async (storage) => {
    progress('carrying out');
    const answer = await carryOut(storage, env, operation, fields, files, { origin, schemas, digests: false, ...options });
    if (answer.ok && after) {
      await after(storage);
      if (schemas) {
        const report = await verifyFolder(storage, { schemas, digests: false, fetch: env.fetch, fetchJson: env.fetchJson });
        if (report.counts().error) {
          throw new OwnerError(`the archive would not verify: ${report.findings.filter((x) => x.level === 'error')
            .slice(0, 5).map((x) => `${x.place}: ${x.message}`).join('; ')}`);
        }
      }
    }
    if (answer.ok) progress('committing');
    return { message: answer.ok ? answer.commitMessage : null, answer };
  }, { mirror, cache, attempts, prepare: async (storage) => {
    progress('reading');
    await storage.prefetch({ skip: (p, size) => !prefetched(p, size), concurrency: 12 });
  } });
  return { ...done.answer, commit: done.commit, reads: done.storage.reads, attempts: done.attempts ?? 1 };
}
