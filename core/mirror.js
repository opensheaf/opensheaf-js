// Generated from literate/38-mirrors.md by opensheaf-literate: edit the document, not this file.
import { Http, FetchError, sha512 } from './http.js';
import { Resolver, Copy } from './resolve.js';
import { parseSheaf, objectId, LABEL } from './names.js';
import { sidecarDigest } from './owners.js';
import { fileName, WITNESSES } from './signatures.js';
import { joinPath, readJson, writeText, ORIGIN } from './storage.js';
import { jsonText, sidecar } from './write.js';
import { hex } from './crypto.js';
import { randomBytes } from './keys.js';
import { writeDiscovery } from './discovery.js';
import { exit, removeTree, CONFIG_NAME, Stop } from './folder.js';
import { openResolver } from './collections.js';
import { recordKeyLog, keyLogOf } from './owner.js';
import { mayReturn } from './takedown.js';

export async function commandResolver(f, env) {
  if (f) return openResolver(f);
  return new Resolver(new Http({ fetch: env.fetch, budget: null }), null, { local: true });
}

export function here(text) {
  return typeof text === 'string' ? text.split(ORIGIN).join('here') : text;
}

export async function resolveCommand(f, args, env) {
  const r = await commandResolver(f, env);
  let id, found;
  try {
    ({ id, found } = await r.resolve(args.uri, args.at || []));
  } catch (error) {
    if (error instanceof FetchError) throw error;
    exit(error.message);
  }
  const owner = id ? id.split(':')[2] : null;
  const out = {
    uri: args.uri, line: id, status: found.status, version: found.version, inventorySha512: found.digest,
    foundAt: found.copy ? here(found.copy.where) : null,
    copies: found.copies.map((c) => {
      const after = [];
      for (let n = c.latestSigned + 1; n <= c.head; n++) after.push({ version: `v${n}`, status: c.status(n) });
      return { at: here(c.where), head: `v${c.head}`, latestSigned: c.latestSigned ? `v${c.latestSigned}` : null, after };
    }),
    notes: [...r.notes.map((n) => here(`${n.level}: ${n.message}`)), ...(owner ? r.ownerNotes(owner) : [])],
  };
  if (found.ok && found.copy) {
    const dv = found.copy.obj(Number(found.version.slice(1)))?.documentVersion;
    if (dv !== undefined && dv !== null) out.pin = `sheaf:${id.split(':')[1]}:${owner}/v${dv}?sha512=${found.digest}`;
  }
  if (args.json) {
    env.out(JSON.stringify(out, null, 2));
  } else {
    env.out(`${out.uri}\n  line ${out.line ?? 'None'}`);
    for (const c of out.copies) {
      const after = c.after.map((a) => `${a.version} ${a.status}`).join(', ');
      env.out(`  copy at ${c.at}: head ${c.head}, latest signed ${c.latestSigned ?? 'None'}` +
              (after ? `; after it: ${after} (section 7.4)` : ''));
    }
    env.out(`  ${found.status}` + (found.version ? `: ${found.version} sha512=${found.digest}` : '') +
            (out.foundAt ? ` at ${out.foundAt}` : ''));
    if (out.pin) env.out(`  pin ${out.pin}`);
    for (const n of out.notes) env.out(`  ${n}`);
  }
  return found.ok ? 0 : 1;
}

export const MAX_BYTES = 2 ** 30, MAX_FETCH_BYTES = 4 * 2 ** 30, MAX_FETCH_FILES = 20000;

export class Unavailable extends Error {}

function contentPathOk(cp, inv, n) {
  const cd = typeof inv?.contentDirectory === 'string' ? inv.contentDirectory : 'content';
  const safe = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\\') &&
    p.split('/').every((x) => !['', '.', '..'].includes(x));
  if (!safe(cp) || !safe(cd) || cd.includes('/')) return false;
  const parts = cp.split('/');
  return parts.length >= 3 && /^v[1-9][0-9]*$/.test(parts[0]) && parts[1] === cd && Number(parts[0].slice(1)) <= n;
}

export function checksumWarning(where, id, n) {
  return `${where}: ${id} v${n}: the checksum file of its inventory is missing, or does not state its digest (section 12.3)`;
}

export async function fetchObject(storage, archive, id, dest, { upto = null, witnessNames = null, where = archive.base,
                                                                warn = null } = {}) {
  await archive.locate(id);
  const fetched = { files: 0, bytes: 0 };
  const get = async (url) => {
    let data;
    try {
      data = await archive.http.request(url, { limit: MAX_BYTES });
    } catch (error) {
      if (error.kind === 'not-found') return null;
      if (error.kind === 'aborted') throw error;
      throw new Unavailable(error.message);
    }
    fetched.files++;
    fetched.bytes += data.length;
    if (fetched.files > MAX_FETCH_FILES || fetched.bytes > MAX_FETCH_BYTES) {
      throw new Unavailable(`${where}: ${id} has more than ${MAX_FETCH_FILES} files or ${MAX_FETCH_BYTES} bytes: not ` +
                            'copied (section 15.2)');
    }
    return data;
  };
  const root = await get(archive.inventoryUrl(id, null));
  if (root === null) throw new Unavailable(`${where}: no object ${id}`);
  let head;
  try {
    head = Number(JSON.parse(new TextDecoder().decode(root)).head.slice(1));
    if (!Number.isInteger(head)) throw new Error();
  } catch {
    throw new Unavailable(`${where}: the inventory of ${id} cannot be read`);
  }
  upto = Math.min(upto || head, head);
  await writeText(storage, joinPath(dest, '0=ocfl_object_1.1'), 'ocfl_object_1.1\n');
  let last = null;
  for (let n = 1; n <= upto; n++) {
    const data = await get(archive.inventoryUrl(id, `v${n}`));
    if (data === null) throw new Unavailable(`${where}: ${id} v${n} has no inventory (section 4.1)`);
    let sc = await get(archive.versionUrl(id, `v${n}`, 'inventory.json.sha512'));
    if (sc === null || sidecarDigest(sc) !== await sha512(data)) {
      if (warn) warn(checksumWarning(where, id, n));
      sc = await sidecar(data);
    }
    let bad;
    try {
      const invN = JSON.parse(new TextDecoder().decode(data));
      bad = Object.values(invN.manifest).flat().filter((cp) => !contentPathOk(cp, invN, n));
    } catch {
      throw new Unavailable(`${where}: the inventory of ${id} v${n} cannot be read`);
    }
    if (bad.length) throw new Unavailable(`${where}: ${id} v${n}: a content path out of the object: '${bad[0]}'`);
    await storage.write(joinPath(dest, `v${n}`, 'inventory.json'), data);
    await storage.write(joinPath(dest, `v${n}`, 'inventory.json.sha512'), sc);
    last = [data, sc];
  }
  const inv = JSON.parse(new TextDecoder().decode(last[0]));
  if (inv.id !== id || inv.head !== `v${upto}`) throw new Unavailable(`${where}: the inventory of ${id} v${upto} is not one of that version`);
  for (const [d, paths] of Object.entries(inv.manifest || {})) {
    for (const cp of paths) {
      if (!contentPathOk(cp, inv, upto)) throw new Unavailable(`${where}: ${id}: a content path out of the object: '${cp}'`);
      const data = await get(archive.contentUrl(id, inv, cp));
      if (data === null || await sha512(data) !== d) throw new Unavailable(`${where}: ${id}: ${cp} is missing, or does not have its digest`);
      await storage.write(joinPath(dest, cp), data);
    }
  }
  await storage.write(joinPath(dest, 'inventory.json'), last[0]);
  await storage.write(joinPath(dest, 'inventory.json.sha512'), last[1]);
  for (let n = 1; n <= upto; n++) {
    let found = await archive.listWitnesses(id, `v${n}`);
    if (found === null) found = witnessNames ? await witnessNames(n) : [];
    for (const name of found) {
      if (!name || name.includes('/') || name === '.' || name === '..' || name.includes('\\')) continue;
      const data = await get(archive.witnessUrl(id, `v${n}`, name));
      if (data !== null) await storage.write(joinPath(dest, WITNESSES, `v${n}`, name), data);
    }
  }
  return upto;
}

export function lineWitnessNames(log) {
  let names = null;
  return async () => {
    if (names === null) {
      const dids = new Set();
      for (const v of log?.versions || []) {
        for (const did of v.keys?.keys || []) dids.add(did);
        for (const c of (v.forkRecord ? v.carried : null) || []) for (const did of c.keys?.keys || []) dids.add(did);
      }
      names = (await Promise.all([...dids].filter((d) => typeof d === 'string').map(fileName))).sort();
    }
    return names;
  };
}

export const OPEN = ['cc-by-4.0', 'cc-by-sa-4.0', 'cc0-1.0', 'gpl-3.0-only', 'gpl-3.0-or-later', 'cc-by-3.0'];
export const OPEN_URIS = ['creativecommons.org/licenses/by/', 'creativecommons.org/licenses/by-sa/',
                          'creativecommons.org/publicdomain/zero/', 'gnu.org/licenses/gpl'];

export function isOpen(rights) {
  for (const r of Array.isArray(rights) ? rights : []) {
    if (OPEN.includes(String(r?.rightsIdentifier || '').toLowerCase())) return true;
    const uri = String(r?.rightsUri || '').toLowerCase();
    if (OPEN_URIS.some((u) => uri.includes(u)) && !uri.includes('-nc') && !uri.includes('-nd')) return true;
  }
  return false;
}

export async function mirrorLine(f, name, owner, where, { licenceChecked = false, label = null } = {}) {
  const env = f.env;
  const id = objectId(name, owner);
  if (f.archiveOwners().includes(owner)) {
    exit(`${id} is a line of an owner this archive hosts: its owner writes it here, and it is not mirrored (section 11)`);
  }
  const r = await openResolver(f);
  let copies = (await r.copies(name, owner, where)).filter((c) => c.archive !== r.home);
  for (const w of r.places(where)) {
    const archive = w === r.home?.base ? null : await r.source(w);
    const t = archive?.tombstones().find((x) => x.id === id);
    if (t) {
      env.err(`Warning: ${id} was taken down at ${w} on ${t.date} (${t.reason}); this archive decides whether to ` +
              'keep its mirror, and answers for what it serves (section 13.3)');
    }
  }
  if (!copies.length) exit(`no copy of ${id} found at ${where.join(', ') || 'the places given'}`);
  const others = (r.logs.get(owner)?.found || []).filter((x) => x.where !== r.home.base).map((x) => [x.where, x.log]);
  const log = await recordKeyLog(f, owner, others);
  if (!log) {
    exit(`no copy of the key log of ${owner} found beside the line: a copy holds it beside every line (section 6.5)`);
  }
  if (log.forkPoint) {
    exit(`the key log of ${owner} forks at v${log.forkPoint}: the owner is frozen, and no version of its lines is added ` +
         'here (section 7.5)');
  }
  copies = await Promise.all(copies.map(async (c) => new Copy(c.where, c.archive, await c.archive.line(id, { log }))));
  copies.sort((a, b) => b.latestSigned - a.latestSigned);
  const source = copies[0];
  if (!source.latestSigned) exit(`${id}: no copy found has a signed version that is not contested (section 7.5)`);
  for (const c of copies.slice(1)) {
    if (!source.agrees(c)) {
      exit(`${id}: the copies at ${source.where} and ${c.where} do not agree: a fork of the line (section 7.4), not copied`);
    }
  }
  const target = source.latestSigned;
  for (let n = target + 1; n <= source.statuses.length; n++) {
    env.out(`${id} v${n}: ${source.status(n)} at ${source.where}: not added (section 7.5)`);
  }
  const dir = await f.dirOf(id);
  const inv = await f.inventory(dir);
  const held = inv ? Number(inv.head.slice(1)) : 0;
  if (held) {
    const k = Math.min(held, target);
    if (source.digest(k) !== await sha512(await f.storage.read(joinPath(dir, `v${k}`, 'inventory.json')))) {
      exit(`${id}: the copy at ${source.where} does not agree with the mirror held here: a fork of the line ` +
           '(section 7.4); the mirror keeps its own side');
    }
  }
  for (let n = held + 1; n <= target; n++) {
    let dc = null;
    try {
      dc = await source.archive.json(id, source.line.inv, `v${n}`, 'datacite.json');
    } catch {
      dc = null;
    }
    if (!licenceChecked && !isOpen(dc?.rightsList)) {
      env.err(`Warning: ${id} v${n}: its licence is not one known to allow redistribution; the archive answers for the ` +
              'copy (section 11.2); give --licence-checked if it is allowed');
    }
  }
  if (!held && !(await mayReturn(f, id, async (n, d) => source.digest(n) === d))) {
    exit(`${id} was taken down here: it returns only from a copy holding the version its tombstone pins (section 13.2)`);
  }
  const stage = `.staging-${hex(randomBytes(6))}`;
  const s = f.storage;
  try {
    const fresh = joinPath(stage, 'object');
    try {
      await fetchObject(s, source.archive, id, fresh, {
        upto: target, witnessNames: lineWitnessNames(log), where: source.where,
        warn: (m) => env.err(`Warning: ${m}; the mirror gets a checksum file that states it`),
      });
    } catch (error) {
      if (error instanceof Unavailable) exit(error.message);
      throw error;
    }
    if (!held) {
      await s.rename(fresh, dir);
      env.out(`${id}: mirrored, v1 to v${target}, from ${source.where}`);
    } else {
      for (let n = held + 1; n <= target; n++) await s.rename(joinPath(fresh, `v${n}`), joinPath(dir, `v${n}`));
      let added = 0;
      for (let n = 1; n <= target; n++) {
        const wNew = joinPath(fresh, WITNESSES, `v${n}`), wOld = joinPath(dir, WITNESSES, `v${n}`);
        for (const e of (await s.list(wNew)) || []) {
          if (e.kind !== 'file') continue;
          const bytes = await s.read(joinPath(wNew, e.name));
          const mine = await s.read(joinPath(wOld, e.name));
          if (mine === null && !(await s.kind(joinPath(wOld, e.name)))) {
            await s.write(joinPath(wOld, e.name), bytes);
            added++;
          } else if (mine === null || mine.length !== bytes.length || mine.some((b, k) => b !== bytes[k])) {
            env.err(`warning: ${id} v${n}: ${e.name} at ${source.where} differs from the one held here, which is kept ` +
                    '(section 11.1)');
          }
        }
      }
      if (target > held) {
        for (const name of ['inventory.json', 'inventory.json.sha512']) await s.rename(joinPath(fresh, name), joinPath(dir, name));
      }
      env.out(target > held ? `${id}: v${held + 1} to v${target} added from ${source.where}`
        : `${id}: up to date (v${held})` + (added ? `, ${added} witness file(s) added` : ''));
    }
  } finally {
    await removeTree(s, stage);
    f.changed();
  }
  if (label) f.labels.set(label, id);
  await remember(f, id, where);
  await writeDiscovery(f);
}

async function remember(f, id, where) {
  const cfg = await readJson(f.storage, CONFIG_NAME);
  if (!cfg || !where.length) return;
  cfg.mirrors ??= {};
  const known = (cfg.mirrors[id] ??= []);
  if (where.every((w) => known.includes(w))) return;
  for (const w of where) if (!known.includes(w)) known.push(w);
  await writeText(f.storage, CONFIG_NAME, jsonText(cfg));
  f.archive.mirrors = cfg.mirrors;
}

export async function mirror(f, args) {
  if (args.all) {
    const known = f.archive.mirrors || {};
    for (const id of Object.keys(known).sort()) {
      const [, name, owner] = id.split(':');
      if ((await f.storage.kind(joinPath(await f.dirOf(id), 'inventory.json'))) === 'file') {
        try {
          await mirrorLine(f, name, owner, known[id], { licenceChecked: Boolean(args.licenceChecked) });
        } catch (error) {
          if (!(error instanceof Stop)) throw error;
          f.env.err(`${id}: ${error.message}`);
        }
      }
    }
    return;
  }
  if (!args.uri) exit('osheaf mirror URI, or --all');
  if (args.label && (!LABEL.test(args.label) || f.labels.has(args.label))) {
    exit(`${args.label}: a label of the form of section 3.1, not given to another line`);
  }
  const at = [...(args.at || [])];
  const r = await openResolver(f);
  let u, name, owner;
  try {
    u = parseSheaf(args.uri, { short: true, fold: true });
    [name, owner] = await r.expand(u, [...(u.at ? [u.at] : []), ...at]);
  } catch (error) {
    if (error instanceof FetchError) throw error;
    exit(error.message);
  }
  await mirrorLine(f, name, owner, [...(u.at ? [u.at] : []), ...at],
                   { licenceChecked: Boolean(args.licenceChecked), label: args.label || null });
}
