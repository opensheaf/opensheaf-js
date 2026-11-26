// Generated from literate/71-tests-identity.md by opensheaf-literate: edit the document, not this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyEd25519, strictlyAcceptable, base32, sha256, utf8, unbase64, hex } from '../core/crypto.js';
import { nameOf, algorithm, isNameOf, readGenesis, didKey, didKeyPublic, keyDigest, keyId, jcs, parseSheaf,
         orcidValid, keeperValid } from '../core/names.js';
import { firstVersion, KeyLog, Version, keyRules, ownerObject, jsonOrNull } from '../core/owners.js';
import { message, fileName, judge, lineStatuses, latestSigned, readSignatureFile, GOOD, UNCHECKED, INVALID }
  from '../core/signatures.js';
import { Key, exampleKey } from '../core/keys.js';
import { genesisRecord, signatureFile as writeSignatureFile, newOwner } from '../core/write.js';
import { rotate, end, recordFork, extendInventory, loadKeyLog, completeOrphan } from '../core/keylogs.js';
import { inventoryFile, sidecar, writeKeyLog } from '../core/write.js';
import { MemoryStorage } from '../core/storage.js';

const A = '56wo6cdpjsxk7ddgnqfp2quipfghukhtmvjuahvwzko7m4tkz3pa';
const N = 'zzgdggwlldcrw4bdeuvntiaobtw2kge6bc4go737pfekhfc5oz4q';
const N1 = 'aajozkubvmxu37pbu2lumdl37llv4ntkazd6j2es54zn23fkiknb';
const KL1 = 'afaabe7b9489bc408ecbb20e8477a7eeb4e8a0ebde0dc15e32d30be17d922207504953e3e52101015f770844449c8382c4c4d9bec472a908ed47200efaef1220';
const KL2 = '7673bfae6ba91f6e9acf862635649efde7b6af0e1a787f6dc2cb2f2a583d5d4fab7bf236f7284582a4894aebef2769eacbf69d9036f1ecd4f89c07bc31313f84';
const KL3 = 'd006b40d988e88c16cfe7d83d81c5b8a0cb318daad1a78180566568c2553f4b7ef7de1d3ebadd785fba94bb3648e70d6a8f8b40cb8a7cfdd913fc76ba959ce7e';
const D2 = 'e3e1319055b967af645713c3baa4dc1974eb8ce02f6b2591bbcce55b068e7a98df54dfa8ab2fd8996d27a2b31df8bee814281d681187014eaa0316f048edbb25';
const K1 = 'did:key:z6MksKLDefPeXwhL6SJCLqpW1dGZcvBjfsv9mxGCFpMkMuVW';
const K3 = 'did:key:z6MkugKqPPkysjyartSzszBbMh8fVhENmqGXvddtD8DDvThn';
const R1 = 'did:key:z6Mkh5i2epG9LsWNnYbBHG7ctEiNLZPjsBNXxNUcsaYgEtNm';
const R4 = 'did:key:z6MksaMy3cmXbnUKqzGv18xhbBreY6berNYVtTZyDrYRb1Hn';
const OWNER_ID = `sheaf:${A}:${A}`;
const PAPER_ID = `sheaf:${N}:${A}`;

const GENESIS_A = utf8(`{
  "format": "opensheaf-genesis/0.2",
  "kind": "owner",
  "created": "2026-03-01T17:40:00Z",
  "nonce": "1b4d9964664d9825076eb8558af61162",
  "keys": [
    "${K1}"
  ],
  "threshold": 1,
  "next": [
    "oxthfb6b4q3sqathmcpnciqggfxlr3aekgfg2tpm2lgrm2qnalha",
    "h6k4k6c5u4dusj4szwimmaa5cozrwu4jo45xa6erpjggpyvla6vq",
    "lnaifwjnrmhyjj3x7uikmzxznxfbgydi25iftupd2ktobmnpaklq"
  ],
  "nextThreshold": 2,
  "keeper": [
    "https://orcid.org/0000-0002-1234-5677"
  ],
  "extensions": {
    "https://opensheaf.org/opensheaf-timestamps-0.2": {
      "timestampAuthorities": [
        "5b4e3f0c9d2a7e18c6f4b0a39d7e2c51f8a6b3d09e4c7a12f5b8d6e3a0c9f147"
      ]
    }
  }
}
`);

const GENESIS_N = utf8(`{
  "format": "opensheaf-genesis/0.2",
  "kind": "document",
  "created": "2026-03-02T09:14:00Z",
  "originator": "${A}",
  "nonce": "6f65cd32058c16d6d78b05011772ff1d"
}
`);

const SIGNATURES = [
  { object: OWNER_ID, version: 'v2', inventorySha512: KL2, key: R1, keyLog: `sheaf:${A}/v1?sha512=${KL1}`,
    signature: '1SHM2Xc8RX7/lE8fJq4cbJ/iNV5+v3jji4ObMcjjJZdDKjxsV+j3SKMn8g2kGnf6QCe0FOfPenFkXcjWYGauAQ==', file: 'oxthfb6b4q3sqath' },
  { object: PAPER_ID, version: 'v2', inventorySha512: D2, key: K3, keyLog: `sheaf:${A}/v2?sha512=${KL2}`,
    signature: 'Gf9KOxH/6Bg4HzaXGt/HHP+iwdDkSpc/3laukJ5YDSxT6Vy7YDJslpFB3zsi1H/L6QsIaf+mNFhsLCYYqipyBA==', file: '4hz7zgsiazl6hx7i' },
  { object: OWNER_ID, version: 'v3', inventorySha512: KL3, key: R4, keyLog: `sheaf:${A}/v2?sha512=${KL2}`,
    signature: '1zEI4EoFG/ZJlZ+e2Y0iswNCCi4oceb8k/gTR8KV+qKM8FAcJocW/eCfJ2zLYhjRlguS1lpoVwGnxBX8lMGKCg==', file: 'j77iavvdclktxkwm' },
];

function signatureFile(s, change = {}) {
  return utf8(JSON.stringify({ format: 'opensheaf-signature/0.2', object: s.object, version: s.version,
    inventorySha512: s.inventorySha512, signer: A, key: s.key, keyLog: s.keyLog, signature: s.signature, ...change }));
}

test('the names of appendix C (sections 5.2 and C.1, C.2)', async () => {
  assert.equal(await nameOf(GENESIS_A), A);
  assert.equal(await nameOf(GENESIS_N), N);
  assert.equal(await nameOf(GENESIS_N, 1), N1);
  const all = await Promise.all(Array.from({ length: 16 }, (_, k) => nameOf(GENESIS_N, k)));
  assert.equal(new Set(all).size, 16);
  assert.deepEqual(all.map(algorithm), Array.from({ length: 16 }, (_, k) => k));
  for (const n of all) assert.ok(await isNameOf(n, GENESIS_N));
  assert.ok(!await isNameOf(A, GENESIS_N));
  await assert.rejects(nameOf(GENESIS_N, 16), /numbered 0 to 15/);
  assert.equal((await readGenesis(GENESIS_A)).keeper[0], 'https://orcid.org/0000-0002-1234-5677');
});

test('genesis records that are not', async () => {
  const g = JSON.parse(new TextDecoder().decode(GENESIS_A));
  const bad = async (change) => readGenesis(utf8(JSON.stringify({ ...g, ...change })));
  await assert.rejects(bad({ threshold: 2 }), /threshold 2 exceeds the 1 item\(s\) it counts \(rule 1\)/);
  await assert.rejects(bad({ next: [await keyDigest(K1)] }), /both a current key and a rotation key/);
  await assert.rejects(bad({ keeper: ['https://orcid.org/0000-0002-1234-5678'] }), /keeper must be/);
  await assert.rejects(bad({ originator: A }), /fields not allowed in a genesis record of kind owner: originator/);
  await assert.rejects(readGenesis(new Uint8Array([0xef, 0xbb, 0xbf, ...GENESIS_N])), /byte order mark/);
  const deep = (text) => utf8(text.replace(/}\s*$/, `, "x": ${'['.repeat(70)}${']'.repeat(70)}}`));
  await assert.rejects(readGenesis(deep(new TextDecoder().decode(GENESIS_A))), /nested deeper than 64 levels/);
  assert.throws(() => readSignatureFile(deep('{"format": "x"}')), /nested deeper than 64 levels/);
});

test('thresholds that are not integers in their text', async () => {
  const text = new TextDecoder().decode(GENESIS_A);
  for (const t of ['1.0', '1e0', '1E0', '9007199254740992', '9007199254740993']) {
    const changed = text.replace('"threshold": 1,', `"threshold": ${t},`);
    assert.notEqual(changed, text);
    await assert.rejects(readGenesis(utf8(changed)), new RegExp(`the number ${t} is (not an integer written without a fraction or an exponent|beyond 2\\^53 - 1) \\(section 2\\)$`), t);
  }
  const keys = (t) => new Version(2, new Map([['keys.json', utf8(`{"format":"opensheaf-keys/0.2","keys":["${K1}"],"threshold":${t},` +
    `"next":["oxthfb6b4q3sqathmcpnciqggfxlr3aekgfg2tpm2lgrm2qnalha"],"nextThreshold":1}`)]]), new Uint8Array()).keys;
  assert.equal(keys('1').threshold, 1);
  assert.equal(keys('1.0'), null);
  assert.equal(keys('1e0'), null);
  const { parseFormat } = await import('../core/http.js');
  const said = (bytes) => { try { parseFormat(bytes); return 'ok'; } catch (error) { return error.message; } };
  const decoder = (b) => `JSON is UTF-8, and this file is not ('utf-8' codec can't decode ${b}) (section 2)`;
  assert.equal(said(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), 'JSON is UTF-8 without a byte order mark, and this file starts with one (section 2)');
  assert.equal(said(new Uint8Array([0xff, 0x7b, 0x7d])), decoder('byte 0xff in position 0: invalid start byte'));
  assert.equal(said(new Uint8Array([0xe2, 0x82])), decoder('bytes in position 0-1: unexpected end of data'));
  assert.equal(said(new Uint8Array([0xe2, 0x82, 0x61])), decoder('bytes in position 0-1: invalid continuation byte'));
  assert.equal(said(new Uint8Array([0xed, 0xa0, 0x80])), decoder('byte 0xed in position 0: invalid continuation byte'));
  assert.equal(said(utf8('{"a": 1.5, "b": [2.5]}')), 'the number 2.5 is not an integer written without a fraction or an exponent (section 2)');
  assert.equal(said(utf8('[NaN]')), 'the number NaN is not an integer written without a fraction or an exponent (section 2)');
  assert.equal(said(utf8('[1, [2e3], 9007199254740993]')), 'the number 9007199254740993 is beyond 2^53 - 1 (section 2)');
  assert.equal(said(utf8('{"x": {"https://example.org/ext": {"n": -9007199254740991}}}')), 'ok');
});

test('did:key URIs and the digests of keys (sections 6.1 and 7.2)', async () => {
  const public3 = didKeyPublic(K3);
  assert.equal(public3.length, 32);
  assert.equal(didKey(public3), K3);
  assert.throws(() => didKeyPublic('did:key:z6MkugKqPPkysjyartSzszBbMh8fVhENmqGXvddtD8DDvTh'), /Ed25519|canonical/);
  assert.equal(await keyId(K3), '4hz7zgsiazl6hx7i');
  assert.equal(await fileName(K3), 'signature-4hz7zgsiazl6hx7i.json');
  assert.equal(await keyDigest(R1), (await readGenesis(GENESIS_A)).next.find((d) => d.startsWith('oxthfb6b4q3sqath')));
  assert.equal(base32(await sha256(utf8(R4))), 'j77iavvdclktxkwmwefs7lw6fisdi7lqphwe33g4nboea35t2zga');
});

test('canonical JSON (RFC 8785)', () => {
  assert.equal(jcs({ b: [1, 'é', null], a: { d: true, c: '\u0001"' } }), '{"a":{"c":"\\u0001\\"","d":true},"b":[1,"é",null]}');
  assert.equal(jcs({ 'é': 1, z: 2, '😀': 3 }), '{"z":2,"é":1,"😀":3}');
  assert.throws(() => jcs({ x: 0.5 }), /fractional/);
  assert.equal(jcs([2 ** 53 - 1, -(2 ** 53 - 1)]), '[9007199254740991,-9007199254740991]');
  assert.throws(() => jcs(2 ** 53), /no exact form/);
  assert.throws(() => jcs('\ud800'), /lone surrogate/);
  assert.equal(jcs(ownerObject(A, KL1)),
    `{"format":"opensheaf-object/0.2","kind":"owner","name":"${A}","owner":"${A}","previous":"${KL1}","specification":"0.2","status":"active"}`);
});

test('keepers: ORCID check digits and domains, DNS names where written (section 6.6)', () => {
  assert.ok(orcidValid('https://orcid.org/0000-0002-1234-5677'));
  assert.ok(!orcidValid('https://orcid.org/0000-0002-1234-5678'));
  assert.ok(orcidValid('0000-0002-1694-006X'));
  assert.ok(orcidValid('https://orcid.org/0000-0002-1825-0097'));
  assert.ok(keeperValid('https://journal.example.org/'));
  assert.ok(!keeperValid('http://journal.example.org/'));
  for (const noDomain of ['https://127.0.0.1/', 'https://localhost/', 'https://./', 'https://a..b/',
                          'https://example/', 'https://-a.org/', 'https://10.0.0.1/']) {
    assert.ok(!keeperValid(noDomain, true), noDomain);
  }
  assert.ok(keeperValid('https://127.0.0.1/'));
  assert.ok(keeperValid('https://unlock.opensheaf.org/', true));
});

test('sheaf: URIs (sections 12.1, 12.2 and C.7)', () => {
  const J = 'tqr6lchnd2vk7ezskdc5zdxpaidpsiuduo5sqhiis3i55iautdka';
  const at = 'at=https%3A%2F%2Fmgubi.org%2Fpapers%2F';
  for (const text of [`sheaf:${N}`, `sheaf:${N}/v2`, `sheaf:${N}/v2?sha512=${D2}`, `sheaf:${N}/v2?sha512=${D2}&${at}`,
                      `sheaf:${N}:${J}/v2`, `sheaf:${N}:*`, `sheaf:${A}`, `sheaf:${A}/v2?sha512=${KL2}`]) {
    assert.equal(String(parseSheaf(text)), text);
  }
  const u = parseSheaf(`sheaf:${N}/v2?sha512=${D2}&${at}`);
  assert.deepEqual([u.name, u.owner, u.version, u.sha512, u.at], [N, null, 2, D2, 'https://mgubi.org/papers/']);
  assert.equal(u.canonical(A), `sheaf:${N}/v2?sha512=${D2}`);
  assert.equal(parseSheaf(`sheaf:${N}:${A}/v2`).canonical(A), `sheaf:${N}/v2`);
  assert.equal(parseSheaf(`sheaf:${N}:${J}/v2`).canonical(A), `sheaf:${N}:${J}/v2`);
  const short = parseSheaf('sheaf:zzgdggwl:tqr6lchn/v2', { short: true });
  assert.ok(!short.isComplete() && short.matches(N, J) && !short.matches(N, A));
  assert.throws(() => parseSheaf('sheaf:zzgdggwl/v2'), /52 characters/);
  assert.equal(String(parseSheaf(`SHEAF:${N.toUpperCase()}/V2`, { fold: true })), `sheaf:${N}/v2`);
  for (const bad of [`sheaf:${N}:*/v2`, `sheaf:${N}/v02`, `sheaf:${N}?sha512=${D2}`, `sheaf:${N}/v2?${at}&sha512=${D2}`,
                     `sheaf:${N}:${N1}`, `sheaf:${N}/v2?at=http%3A%2F%2Fx%2F`]) {
    assert.throws(() => parseSheaf(bad), /not a sheaf: URI/, bad);
  }
});

const VECTORS = [
  ['8c93255d71dcab10e8f379c26200f3c7bd5f09d9bc3068d3ef4edeb4853022b6', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
   'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a0000000000000000000000000000000000000000000000000000000000000000'],
  ['9bd9f44f4dcc75bd531b56b2cd280b0bb38fc1cd6d1230e14861d861de092e79', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
   'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43a5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04'],
  ['aebf3f2601a0c8c5d39cc7d8911642f740b78168218da8471772b35f9d35b9ab', 'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43',
   'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa8c4bd45aecaca5b24fb97bc10ac27ac8751a7dfe1baff8b953ec9f5833ca260e'],
  ['9bd9f44f4dcc75bd531b56b2cd280b0bb38fc1cd6d1230e14861d861de092e79', 'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d',
   '9046a64750444938de19f227bb80485e92b83fdb4b6506c160484c016cc1852f87909e14428a7a1d62e9f22f3d3ad7802db02eb2e688b6c52fcd6648a98bd009'],
  ['e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec4011eaccd55b53f56c', 'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d',
   '160a1cb0dc9c0258cd0a7d23e94d8fa878bcb1925f2c64246b2dee1796bed5125ec6bc982a269b723e0668e540911a9a6a58921d6925e434ab10aa7940551a09'],
  ['e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec4011eaccd55b53f56c', 'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d',
   '21122a84e0b5fca4052f5b1235c80a537878b38f3142356b2c2384ebad4668b7e40bc836dac0f71076f9abe3a53f9c03c1ceeeddb658d0030494ace586687405'],
  ['85e241a07d148b41e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec40', '442aad9f089ad9e14647b1ef9099a1ff4798d78589e66f28eca69c11f582a623',
   'e96f66be976d82e60150baecff9906684aebb1ef181f67a7189ac78ea23b6c0e547f7690a0e2ddcd04d87dbc3490dc19b3b3052f7ff0538cb68afb369ba3a514'],
  ['85e241a07d148b41e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec40', '442aad9f089ad9e14647b1ef9099a1ff4798d78589e66f28eca69c11f582a623',
   '8ce5b96c8f26d0ab6c47958c9e68b937104cd36e13c33566acd2fe8d38aa19427e71f98a473474f2f13f06f97c20d58cc3f54b8bd0d272f42b695dd7e89a8c22'],
  ['9bedc267423725d473888631ebf45988bad3db83851ee85c85e241a07d148b41', 'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43',
   'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff03be9678ac102edcd92b0210bb34d7428d12ffc5df5f37e359941266a4e35f0f'],
  ['9bedc267423725d473888631ebf45988bad3db83851ee85c85e241a07d148b41', 'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43',
   'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffca8c5b64cd208982aa38d4936621a4775aa233aa0505711d8fdcfdaa943d4908'],
  ['e96b7021eb39c1a163b6da4e3093dcd3f21387da4cc4572be588fafae23c155b', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   'a9d55260f765261eb9b84e106f665e00b867287a761990d7135963ee0a7d59dca5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04'],
  ['39a591f5321bbe07fd5a23dc2f39d025d74526615746727ceefd6e82ae65c06f', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   'a9d55260f765261eb9b84e106f665e00b867287a761990d7135963ee0a7d59dca5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04'],
];
const bytes = (text) => Uint8Array.from(text.match(/../g), (b) => parseInt(b, 16));

test('the edge cases of Ed25519, with both verifiers (section 7.2)', async () => {
  for (const engine of ['webcrypto', 'js', null]) {
    const accepted = [];
    for (const [msg, key, sig] of VECTORS) accepted.push(await verifyEd25519(bytes(key), bytes(msg), bytes(sig), { engine }));
    assert.deepEqual(accepted, VECTORS.map((_, k) => k === 3), `engine ${engine}`);
  }
  assert.deepEqual(VECTORS.map(([, key, sig]) => strictlyAcceptable(bytes(key), bytes(sig))),
    [false, false, false, true, true, true, false, false, false, false, false, false]);
});

test('the computed first version (sections 6.1 and C.1)', async () => {
  const v1 = await firstVersion(GENESIS_A);
  assert.equal(v1.digest, KL1);
  assert.equal(new TextDecoder().decode(v1.files.get('object.json')),
    `{"format":"opensheaf-object/0.2","kind":"owner","name":"${A}","owner":"${A}","specification":"0.2","status":"active"}`);
  assert.equal(new TextDecoder().decode(v1.files.get('keys.json')),
    `{"format":"opensheaf-keys/0.2","keys":["${K1}"],"next":["oxthfb6b4q3sqathmcpnciqggfxlr3aekgfg2tpm2lgrm2qnalha",` +
    '"h6k4k6c5u4dusj4szwimmaa5cozrwu4jo45xa6erpjggpyvla6vq","lnaifwjnrmhyjj3x7uikmzxznxfbgydi25iftupd2ktobmnpaklq"],' +
    '"nextThreshold":2,"threshold":1}');
  const log = await KeyLog.of(GENESIS_A);
  assert.deepEqual(await log.check(), { errors: [], warnings: [] });
  assert.equal(log.owner, A);
  assert.equal(log.pin(1), `sheaf:${A}/v1?sha512=${KL1}`);
  assert.equal(log.latest().number, 1);
  const [s] = SIGNATURES;
  const j = await judge(signatureFile(s), `signature-${s.file}.json`, { objectId: OWNER_ID, version: 'v2',
    inventory: KL2, owner: A, lookup: (n, d) => log.lookup(n, d), keyLog: true });
  assert.deepEqual([j.status, j.key, j.keyLog, j.threshold], [GOOD, R1, [1, KL1], 2]);
});

test('a key log answers once checked; a broken copy meets no other (section 6.5)', async () => {
  const [a, r1, r2, b] = await Promise.all(['a', 'r1', 'r2', 'b'].map((x) => exampleKey(`checked first ${x}`)));
  const log = await newOwner([a], [r1]);
  await rotate(log, [r1], { nextKeys: [r2], nextThreshold: 1, add: [b], user: { name: 'Doe, Jane' },
                            created: '2026-01-01T00:00:00Z' });
  const v2 = log.versions[1];
  const forged = await Version.make(2, v2.files, v2.inventory, v2.sidecar, new Map());
  const copy = new KeyLog(log.genesis, log.owner, [log.versions[0], forged]);
  assert.throws(() => copy.lookup(2, forged.digest), /before it is checked/);
  assert.throws(() => copy.side(), /before it is checked/);
  assert.throws(() => copy.latest(), /before it is checked/);
  const { errors } = await copy.check();
  assert.ok(errors.some((e) => e.startsWith('v2: signed by 0 rotation keys')), errors.join('\n'));
  assert.deepEqual(copy.side().map((v) => v.number), [1]);
  const met = await copy.meet(log);
  assert.equal(met, copy);
  assert.deepEqual(met.side().map((v) => v.number), [1]);
  assert.deepEqual((await log.meet(copy)).side().map((v) => v.number), [1, 2]);
});

test('a version after an ending one is a problem (section 6.3)', async () => {
  const [a, r1, r2, r3, n1, c, d] = await Promise.all(['a', 'r1', 'r2', 'r3', 'n1', 'c', 'd']
    .map((x) => exampleKey(`after an end ${x}`)));
  const user = { name: 'Doe, Jane' }, created = '2026-01-01T00:00:00Z';
  const mine = await newOwner([a], [r1, r2, r3], { threshold: 1, nextThreshold: 1 });
  const theirs = new KeyLog(mine.genesis, mine.owner, [mine.versions[0]]);
  await theirs.check();
  await rotate(mine, [r1], { nextKeys: [n1], nextThreshold: 1, user, created });
  await end(theirs, [r2], { user, created });
  const prev = theirs.versions[1];
  const kb = utf8(jcs({ format: 'opensheaf-keys/0.2', keys: [c.did], next: [d.digest], nextThreshold: 1, threshold: 1 }));
  const content = new Map([['genesis.json', theirs.genesis], ['object.json', utf8(jcs(ownerObject(theirs.owner, prev.digest)))],
                           ['keys.json', kb]]);
  const inv = await extendInventory(JSON.parse(new TextDecoder().decode(prev.inventory)), theirs.id, 3, content, created);
  const ib = inventoryFile(inv);
  const after = await Version.make(3, content, ib, await sidecar(ib), new Map());
  await assert.rejects(recordFork(mine, [theirs.versions[1], after], { user, created }), /nothing follows an ending version/);
  const forged = new KeyLog(theirs.genesis, theirs.owner, [...theirs.versions, after]);
  const { warnings } = await forged.check();
  assert.ok(warnings.some((w) => /^v3: held after an ending version/.test(w)), warnings.join('\n'));
});

test('a version written and not completed', async () => {
  const [a, r1, r2, n1, n2, n3] = await Promise.all(['a', 'r1', 'r2', 'n1', 'n2', 'n3']
    .map((x) => exampleKey(`not completed ${x}`)));
  const user = { name: 'Doe, Jane' }, created = '2026-01-01T00:00:00Z';
  const storage = new MemoryStorage();
  const log = await newOwner([a], [r1, r2], { threshold: 1, nextThreshold: 1 });
  await writeKeyLog(storage, 'kl', log);
  const v2 = await rotate(log, [r1], { nextKeys: [n1], nextThreshold: 1, user, created });
  const broken = Object.create(storage);
  broken.rename = async () => { throw new Error('the disk is full'); };
  await assert.rejects(writeKeyLog(broken, 'kl', log), /the disk is full/);
  let back = await loadKeyLog(storage, 'kl');
  assert.equal(back.versions.length, 1);
  assert.equal(back.orphan.number, 2);
  assert.ok(back.orphan.witnesses.size);
  await assert.rejects(rotate(back, [r1], { nextKeys: [n2], nextThreshold: 1, user, created }), /osheaf owner complete/);
  const other = await loadKeyLog(storage, 'kl');
  other.orphan = null;
  await rotate(other, [r1], { nextKeys: [n2], nextThreshold: 1, user, created });
  await assert.rejects(writeKeyLog(storage, 'kl', other), /another version/);
  assert.equal(await completeOrphan(storage, 'kl'), 'completed');
  back = await loadKeyLog(storage, 'kl');
  assert.equal(back.orphan, null);
  assert.equal(back.versions.at(-1).digest, v2.digest);
  assert.deepEqual((await back.check()).errors, []);
  assert.equal(await completeOrphan(storage, 'kl'), null);
  const v3 = await rotate(log, [n1], { nextKeys: [n3], nextThreshold: 1, user, created });
  await storage.write('kl/v3/inventory.json', v3.inventory);
  assert.equal(await completeOrphan(storage, 'kl'), 'removed');
  assert.equal(await storage.kind('kl/v3'), null);
  await writeKeyLog(storage, 'kl', log);
  assert.equal((await loadKeyLog(storage, 'kl')).versions.at(-1).digest, v3.digest);
  await storage.write('kl/v4/inventory.json', utf8('{}'));
  await storage.write('kl/extensions/opensheaf-witnesses/v4/signature-x.json', utf8('{}'));
  await assert.rejects(completeOrphan(storage, 'kl'), /left for a person/);
  assert.equal(await storage.kind('kl/v4'), 'dir');
});

test('the rules of keys across versions (section 6.1, rules 1 to 4)', async () => {
  const first = (await readGenesis(GENESIS_A));
  const v2 = { format: 'opensheaf-keys/0.2', keys: [K3], threshold: 1,
               next: ['j77iavvdclktxkwmwefs7lw6fisdi7lqphwe33g4nboea35t2zga', 'nzvwkea25p62akdygzheep4qgoo3fw7ryimwytckea4njabtlfzq',
                      'fhujijfn3zmvteieps5l6raae73kndteaoju5js3ja33l2wvrqmq'], nextThreshold: 2 };
  assert.deepEqual(await keyRules(v2, [first], A), []);
  const rules = (change) => keyRules({ ...v2, ...change }, [first], A);
  assert.deepEqual(await rules({ threshold: 2 }), ['threshold 2 exceeds the 1 item(s) it counts (rule 1)']);
  assert.deepEqual(await rules({ keys: [K3, R1] }), ['keys lists a rotation key of an earlier version (rule 2)']);
  assert.deepEqual(await rules({ next: [...v2.next.slice(1), first.next[0]] }),
    ['next holds a digest that next of an earlier version holds (rule 3)']);
  assert.deepEqual(await rules({ next: [...v2.next.slice(1), await keyDigest(K1)] }),
    ['next holds the digest of a current key of an earlier version (rule 3)']);
  assert.deepEqual(await rules({ exposed: [K3] }), [
    'keys lists a key exposed by this version or an earlier one (rule 2)',
    'exposed lists a key that keys of no earlier version lists (rule 4)']);
  assert.deepEqual(await rules({ exposed: [K1] }), []);
  assert.deepEqual(await keyRules({ format: 'opensheaf-keys/0.2', ended: true, successor: A }, [first], A),
    ['successor is the owner name of another owner (section 6.3)']);
  assert.deepEqual(await keyRules({ format: 'opensheaf-keys/0.2', ended: true, keys: [K3] }, [first], A),
    ['an ending version has no keys, threshold, next or nextThreshold (section 6.3)']);
});

const nonce = async (label) => hex(await sha256(utf8('nonce ' + label))).slice(0, 32);
const TIMESTAMPS = { 'https://opensheaf.org/opensheaf-timestamps-0.2': { timestampAuthorities: [
  '5b4e3f0c9d2a7e18c6f4b0a39d7e2c51f8a6b3d09e4c7a12f5b8d6e3a0c9f147'] } };

test('the keys of appendix C, made from their labels', async () => {
  assert.equal((await exampleKey('authors laptop')).did, K1);
  assert.equal((await exampleKey('authors new laptop')).did, K3);
  assert.equal((await exampleKey('authors rotation 1')).did, R1);
  assert.equal((await exampleKey('authors rotation 4')).did, R4);
  const k = await exampleKey('authors laptop');
  assert.equal(k.digest, await keyDigest(K1));
  assert.equal(k.id, await keyId(K1));
  assert.deepEqual((await Key.fromSeed(k.seed)).publicKey, didKeyPublic(K1));
  await assert.rejects(Key.fromSeed(new Uint8Array(31)), /32 bytes/);
});

test('genesis records written byte for byte (sections C.1 and C.2)', async () => {
  const rotation = await Promise.all([1, 2, 3].map((i) => exampleKey(`authors rotation ${i}`)));
  const owner = await genesisRecord('owner', {
    keys: [K1], threshold: 1, next: rotation.map((r) => r.digest), nextThreshold: 2,
    keeper: 'https://orcid.org/0000-0002-1234-5677', extensions: TIMESTAMPS,
    created: '2026-03-01T17:40:00Z', nonce: await nonce('A') });
  assert.deepEqual(owner, GENESIS_A);
  assert.equal((await firstVersion(owner)).digest, KL1);
  const paper = await genesisRecord('document', { originator: A, created: '2026-03-02T09:14:00Z', nonce: await nonce('N') });
  assert.deepEqual(paper, GENESIS_N);
  await assert.rejects(genesisRecord('document', { originator: A, keys: [K1] }), /only for an owner/);
  await assert.rejects(genesisRecord('owner', { keys: [K1], threshold: 2, next: [rotation[0].digest], nextThreshold: 1 }),
                       /exceeds/);
  const fresh = await readGenesis(await genesisRecord('document', { originator: A }));
  assert.match(fresh.nonce, /^[0-9a-f]{32}$/);
  assert.match(fresh.created, /Z$/);
});

test('the signatures of appendix C, made again (sections C.1, C.3 and C.8)', async () => {
  const keys = { [R1]: 'authors rotation 1', [K3]: 'authors new laptop', [R4]: 'authors rotation 4' };
  for (const s of SIGNATURES) {
    const key = await exampleKey(keys[s.key]);
    const signature = await key.sign(message(s.object, s.version, s.inventorySha512, s.keyLog));
    assert.equal(btoa(String.fromCharCode(...signature)), s.signature);
    const file = await writeSignatureFile(key, s.object, s.version, s.inventorySha512, A, s.keyLog);
    assert.deepEqual(readSignatureFile(file).signature, s.signature);
    assert.ok(await verifyEd25519(key.publicKey, message(s.object, s.version, s.inventorySha512, s.keyLog), signature));
  }
});

const good = (key, n = 1, threshold = 1) => ({ status: GOOD, key, keyLog: [n, 'd'], threshold });

test('the statuses of the versions of a line (section 7.3)', () => {
  assert.deepEqual(lineStatuses([[good('k1')], [], [good('k1')]]), ['signed', 'vouched for', 'signed']);
  assert.deepEqual(lineStatuses([[good('k1')], [good('k2')]], { exposed: new Set(['k1']) }), ['signed', 'signed']);
  assert.deepEqual(lineStatuses([[good('k1')], []], { exposed: new Set(['k1']) }), ['contested', 'unsigned']);
  assert.deepEqual(lineStatuses([[], [good('k1')]], { exposed: new Set(['k1']) }), ['contested', 'contested']);
  assert.deepEqual(lineStatuses([[good('k1', 1)], [good('k1', 2)]], { forkPoint: 2 }), ['signed', 'contested']);
  assert.deepEqual(lineStatuses([[good('k1', 2)]], { forkPoint: 2, trusted: () => true }), ['signed']);
  assert.deepEqual(lineStatuses([[good('k1', 1, 2)], [good('k1', 1, 2), good('k2', 1, 2)]]), ['vouched for', 'signed']);
  assert.deepEqual(lineStatuses([[{ status: UNCHECKED, key: 'k', keyLog: [1, 'd'] }]]), ['unchecked']);
  assert.deepEqual(lineStatuses([[{ status: INVALID }], []]), ['invalid', 'unsigned']);
  assert.equal(latestSigned(['signed', 'vouched for', 'contested']), 2);
  assert.equal(latestSigned(['contested']), null);
});

test('the statuses of a signature file (section 7.3)', async () => {
  const s = SIGNATURES[1];
  const file = `signature-${s.file}.json`;
  const context = { objectId: PAPER_ID, version: 'v2', inventory: D2, owner: A, lookup: () => null };
  const status = async (bytes, name = file, change = {}) => {
    const j = await judge(bytes, name, { ...context, ...change });
    return [j.status, j.reason];
  };
  assert.deepEqual(await status(signatureFile(s)), [UNCHECKED, 'v2 of the key log, with that digest, is not reached']);
  const v2 = { number: 2, isVersion: true, forkRecord: false, keys: { keys: [K3], threshold: 1 } };
  assert.deepEqual(await status(signatureFile(s), file, { lookup: () => v2 }), [GOOD, '']);
  assert.deepEqual(await status(signatureFile(s), file, { lookup: () => ({ ...v2, keys: { keys: [K1], threshold: 1 } }) }),
    [INVALID, 'the key is not a current key of v2 of the key log']);
  assert.deepEqual(await status(signatureFile(s), file, { lookup: () => ({ ...v2, forkRecord: true }) }),
    [INVALID, 'v2 is not a version of the key log, or is a fork record']);
  assert.equal((await status(utf8('not json')))[0], INVALID);
  assert.deepEqual(await status(signatureFile(s), 'signature-aaaaaaaaaaaaaaaa.json'), [INVALID, 'its name does not match the digest of its key']);
  assert.deepEqual(await status(signatureFile(s), file, { version: 'v3' }), [INVALID, 'it signs another version, or another inventory']);
  assert.deepEqual(await status(signatureFile(s), file, { owner: 'tqr6lchnd2vk7ezskdc5zdxpaidpsiuduo5sqhiis3i55iautdka' }),
    [INVALID, 'its signer is not the owner of the line']);
  assert.deepEqual(await status(signatureFile(s, { inventorySha512: KL1 })), [INVALID, 'the signature does not verify']);
  assert.throws(() => readSignatureFile(signatureFile(s, { extra: 1 })), /exactly the fields/);
  const loose = s.signature.slice(0, 85) + String.fromCharCode(s.signature.charCodeAt(85) + 1) + '==';
  assert.notEqual(loose, s.signature);
  assert.deepEqual(unbase64(loose), unbase64(s.signature));
  assert.deepEqual(await status(signatureFile(s, { signature: loose }), file, { lookup: () => v2 }),
    [INVALID, 'malformed: signature is not of its form']);
  assert.match(s.signature, /[AQgw]==$/);
  assert.throws(() => readSignatureFile(signatureFile(s, { signer: 'tqr6lchnd2vk7ezskdc5zdxpaidpsiuduo5sqhiis3i55iautdka' })),
    /keyLog names the key log of another owner/);
});

const MIXED = [
  ['good', true,
   'b381c70a1226a49d37d14a2f28e320faca0669bd1917fe37b13400f2fbda6be1',
   '7e1768277342b3fa5e07391fa697f865ffb3b57005048712e29e2994eed5a7db' +
   'fda846d52b178dfba8d8024a95b1a36d8e4384a49217b7814d393e23a68d1e0c'],
  ['mixed A, k%8==0', true,
   '8b4e59d6cc75cbec4a4714928c50a829800f8c5a100bb1152b8f3e01c4358a4b',
   'f15f18fac77872ba75b95ab61ffd4e2acef7975513a2e5d87779c7be039ccd45' +
   'd48c0501bf8b2d341b229e11f7f9ad0e18dcf75bc990fabb05db136c6f283c0a'],
  ['mixed A, k%8!=0', false,
   '8b4e59d6cc75cbec4a4714928c50a829800f8c5a100bb1152b8f3e01c4358a4b',
   '78aeac38bf6e47831e87c649f4a75a24cd80679f364d5b52cfc36d237836657e' +
   'b6e3a1c9c87d2e91ee53423f1c08da2d095ba1e34e8da2fda7e37fa38078a10d'],
  ['mixed A (order4), k%4==0-ish', true,
   '1c9b40eae3ed8505ff93426d56f39d8ba1afef58a7ff14c07cb337a49317f33f',
   'c6f65e9234496623db52a7c824421289e0699cb6c154823226bf6da1ed629ab6' +
   'b054866ae4ebfd798ea2a4541d887c56ba0eeb57ab8743f2a220ce341baa540c'],
  ['R + T8 (cofactored only)', false,
   'b381c70a1226a49d37d14a2f28e320faca0669bd1917fe37b13400f2fbda6be1',
   '60796497920dfae3f4804659f9210b95f4a75130e24b87014eeb1423a2c40801' +
   '2357b2efe2284192b5f6cd6b7ecfcbc623c258a4bb8c0c62d19b9869c791930e'],
  ['S+L', false,
   'b381c70a1226a49d37d14a2f28e320faca0669bd1917fe37b13400f2fbda6be1',
   '7e1768277342b3fa5e07391fa697f865ffb3b57005048712e29e2994eed5a7db' +
   'ea7c3c32467a9f537f75faec73ab82828e4384a49217b7814d393e23a68d1e1c'],
  ['A=identity R=id S=0', false,
   '0100000000000000000000000000000000000000000000000000000000000000',
   '0100000000000000000000000000000000000000000000000000000000000000' +
   '0000000000000000000000000000000000000000000000000000000000000000'],
  ['A=y0 sign1 R=id S=0', false,
   '0000000000000000000000000000000000000000000000000000000000000080',
   '0100000000000000000000000000000000000000000000000000000000000000' +
   '0000000000000000000000000000000000000000000000000000000000000000'],
  ['A=T8 R=id S=0', false,
   '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
   '0100000000000000000000000000000000000000000000000000000000000000' +
   '0000000000000000000000000000000000000000000000000000000000000000'],
  ['noncanon R', false,
   'b381c70a1226a49d37d14a2f28e320faca0669bd1917fe37b13400f2fbda6be1',
   'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f' +
   'fda846d52b178dfba8d8024a95b1a36d8e4384a49217b7814d393e23a68d1e0c'],
];

test('points with a component of small order, as libsodium decides them (section 7.2)', async () => {
  const msg = utf8('opensheaf audit');
  for (const [name, good, key, sig] of MIXED) {
    assert.equal(await verifyEd25519(bytes(key), msg, bytes(sig)), good, name);
    assert.equal(await verifyEd25519(bytes(key), msg, bytes(sig), { engine: 'webcrypto' }), good, `${name}, WebCrypto`);
  }
});

test('the signatures of appendix C (sections C.1, C.3 and C.8)', async () => {
  for (const s of SIGNATURES) {
    const msg = message(s.object, s.version, s.inventorySha512, s.keyLog);
    const sig = unbase64(s.signature);
    for (const engine of ['webcrypto', 'js']) {
      assert.ok(await verifyEd25519(didKeyPublic(s.key), msg, sig, { engine }), `${s.file} ${engine}`);
      const changed = sig.slice();
      changed[10] ^= 1;
      assert.ok(!await verifyEd25519(didKeyPublic(s.key), msg, changed, { engine }));
      assert.ok(!await verifyEd25519(didKeyPublic(K1), msg, sig, { engine }));
    }
    assert.equal(await fileName(s.key), `signature-${s.file}.json`);
  }
  assert.equal(new TextDecoder().decode(message(PAPER_ID, 'v2', D2, `sheaf:${A}/v2?sha512=${KL2}`)),
    `opensheaf-signature/0.2\nobject ${PAPER_ID}\nversion v2\ninventorySha512 ${D2}\nkeyLog sheaf:${A}/v2?sha512=${KL2}\n`);
});
