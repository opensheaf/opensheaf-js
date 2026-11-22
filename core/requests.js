// Generated from literate/48-requests.md by opensheaf-literate: edit the document, not this file.
import { ArchiveFolder, Stop, REBUILD } from './folder.js';
import { deposit } from './deposit.js';
import { collect } from './collect.js';
import { notice, withdraw, relicense } from './describe.js';
import * as collections from './collections.js';
import { writeDiscovery } from './discovery.js';
import { present, readableIndex, hasWebsite } from './website.js';
import { verifyFolder } from './check.js';
import { readJson, readText, writeText, joinPath, MemoryStorage } from './storage.js';
import { jsonText } from './write.js';
import { parseData } from './inputs.js';
import { init } from './init.js';
import { keyWallet } from './owner.js';
import { makeBranch } from './branch.js';
import { nameOf, objectId } from './names.js';
import { OBJ, GENESIS } from './folder.js';

export class Problem extends Error {}

const LINK = /^!?\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/;
const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHEAF = /^sheaf:([a-z2-7]{52}):([a-z2-7]{51}[aq])(\/v\d+)?(?:\?(.*))?$/;
export const NEW_PAPER = 'A new paper';
export const NEW_VERSION = 'A new version of a paper in the archive';
const SOURCE_SUFFIXES = new Set(['.tex', '.ltx', '.tm', '.md', '.typ', '.lyx', '.rst', '.org', '.txt']);
const LICENCES = new Set(['cc-by-4.0', 'cc-by-sa-4.0', 'cc0-1.0', 'gpl-3.0-only', 'gpl-3.0-or-later']);
export const HEADER = `# The members of a collection of this archive, in order, for
# \`osheaf collection sync LABEL --from collections/LABEL.yaml\`: kept by the
# issue forms of this repository (Issues, New issue), the OpenSheaf manager,
# or by hand (see the README). A member is a line of this archive, by its
# label (\`label: kpz-uniqueness\`), or of any archive, by its sheaf: URI and
# the base URLs of archives that hold it (\`uri: sheaf:<name>:<owner>\`,
# \`at: [https://example.org/papers/]\`). In a selection, \`revisions\` lists the
# document versions vetted (1, 2, ...); in a catalogue, \`follow: true\` follows
# the line to its latest signed version.
`;

function field(form, label, required = false) {
  const value = String(form.fields[label] ?? '').trim();
  if (required && !value) throw new Problem(`The field **${label}** is empty, and it is needed.`);
  return value;
}

function lines(text) {
  return text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l && !LINK.test(l));
}

function labelField(form, name, limit = 64) {
  const label = field(form, name, true);
  if (!LABEL.test(label) || label.length > limit) {
    throw new Problem(`\`${label}\` is not a valid label: at most ${limit} characters, ` +
                      'lower-case letters and digits, words joined by `-` (for instance `kpz-uniqueness`).');
  }
  return label;
}

function archiveUrl(form, name, required = true) {
  let url = field(form, name, required);
  if (!url) return '';
  if (!/^https:\/\/\S+$/.test(url)) {
    throw new Problem(`**${name}** should be the address of an OpenSheaf archive, the https address of the ` +
                      'folder that holds its `opensheaf.json` (for instance `https://mgubi.org/papers/`), ' +
                      `not \`${url}\`.`);
  }
  url = url.replace(/opensheaf\.json$/, '');
  return url.endsWith('/') ? url : url + '/';
}

function versions(form, name, required = false) {
  const text = field(form, name, required);
  const found = text.match(/\d+/g) || [];
  if (text && (!found.length || text.replace(/[\d,;\s]/g, ''))) {
    throw new Problem(`**${name}** should be document versions, numbers such as \`5\` or \`5, 6\`, not \`${text}\`.`);
  }
  return found.map(Number);
}

function position(form) {
  const value = field(form, 'Position');
  if (value && !/^\d+$/.test(value)) throw new Problem(`**Position** should be a number (1 for the first), not \`${value}\`.`);
  return value ? Number(value) : null;
}

function date(form, name) {
  const value = field(form, name);
  if (value && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) {
    throw new Problem(`The field **${name}** should be a date written as YYYY-MM-DD, not \`${value}\`.`);
  }
  return value;
}

function licence(form, name) {
  const value = field(form, name);
  const m = /\(([a-z0-9.-]+)\)\s*$/.exec(value);
  if (m && LICENCES.has(m[1])) return m[1];
  if (value.toLowerCase().startsWith('all rights reserved')) return 'All rights reserved';
  return null;
}

const COLLECTIONS = 'collections';
const listPath = (label) => `${COLLECTIONS}/${label}.yaml`;

async function settings(r) {
  return readJson(r.storage, 'osheaf.json');
}

async function labels(r) {
  const disc = (await readJson(r.storage, 'opensheaf.json')) || {};
  return new Map((disc.objects || []).filter((o) => o.label).map((o) => [o.label, o]));
}

async function catalogues(r) {
  const disc = (await readJson(r.storage, 'opensheaf.json')) || {};
  const ids = new Set((disc.owners || []).filter((e) => e && typeof e === 'object').map((e) => e.catalogue));
  return new Set([...(await labels(r))].filter(([, o]) => ids.has(o.id)).map(([label]) => label));
}

async function labelOf(r, name, owner) {
  for (const [label, o] of await labels(r)) if (o.name === name && o.owner === owner) return label;
  return null;
}

async function allCollections(r) {
  return ((await r.storage.list(COLLECTIONS)) || []).filter((e) => e.kind === 'file' && e.name.endsWith('.yaml'))
    .map((e) => e.name.slice(0, -'.yaml'.length)).sort();
}

async function exists(r, path) {
  return (await r.storage.kind(path)) === 'file';
}

async function collection(r, form, required) {
  const label = field(form, 'In collection');
  const known = await allCollections(r);
  if (!label) {
    if (required) {
      throw new Problem('Name the collection in **In collection**' +
        (known.length ? ": the archive's collections are " + known.map((k) => `\`${k}\``).join(', ')
          : '; the archive has none yet (create one with the form **New collection**)') + '.');
    }
    return '';
  }
  if (!LABEL.test(label) || !(await exists(r, listPath(label)))) {
    throw new Problem(`The archive has no collection \`${label}\`` +
      (known.length ? ': its collections are ' + known.map((k) => `\`${k}\``).join(', ') : ' (none has been created yet)') + '.');
  }
  return label;
}

async function load(r, label) {
  const data = (await parseData(listPath(label), await readText(r.storage, listPath(label)), { yaml11: true })) || {};
  if (data.members === null || data.members === undefined) data.members = [];
  return data;
}

export async function yamlText(data) {
  const YAML = await import('yaml');
  return YAML.stringify(data, { version: '1.1', schema: 'yaml-1.1', indentSeq: false, lineWidth: 200,
                                singleQuote: true, blockQuote: false });
}

async function save(r, label, data) {
  await writeText(r.storage, listPath(label), HEADER + await yamlText(data));
}

async function headFile(r, label, name) {
  const entry = (await labels(r)).get(label);
  if (!entry) return null;
  const f = await r.folder();
  const dir = await f.dirOf(entry.id);
  const inv = await f.inventory(dir);
  return inv ? f.readObjectJson(dir, inv, name) : null;
}

async function documentVersion(r, label) {
  return (await headFile(r, label, 'object.json')).documentVersion;
}

async function knownDocument(r, label) {
  const all = await labels(r);
  const entry = all.get(label);
  if (!entry || entry.kind !== 'document') {
    const known = [...all].filter(([, o]) => o.kind === 'document').map(([k]) => k).sort();
    throw new Problem(`The archive has no paper labelled \`${label}\`` +
      (known.length ? ': its papers are ' + known.slice(0, 40).map((k) => `\`${k}\``).join(', ') : '') + '.');
  }
  return entry;
}

function parseSheaf(text) {
  const m = SHEAF.exec(text.trim());
  if (!m) return null;
  const at = new URLSearchParams(m[4] || '').get('at') || '';
  return [m[1], m[2], at];
}

async function entryKey(r, entry) {
  if (typeof entry === 'string') entry = { uri: entry };
  if (entry.label) {
    const o = (await labels(r)).get(entry.label);
    return o ? `${o.name}:${o.owner}` : null;
  }
  const parsed = parseSheaf(String(entry.uri ?? ''));
  return parsed ? `${parsed[0]}:${parsed[1]}` : null;
}

async function readDiscovery(r, base) {
  try {
    const res = await r.env.fetch(base + 'opensheaf.json');
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    return await res.json();
  } catch (error) {
    throw new Problem(`The archive at \`${base}\` could not be read (${error.message}): give the address of an ` +
                      'OpenSheaf archive of specification 0.2, the folder that holds its `opensheaf.json`.');
  }
}

async function memberRef(r, form, name, archiveName, required = true) {
  const text = field(form, name, required);
  if (!text) return [null, null, ''];
  const archive = archiveUrl(form, archiveName, false);
  if (text.startsWith('sheaf:')) {
    const parsed = parseSheaf(text);
    if (!parsed) throw new Problem(`\`${text}\` is not the sheaf: URI of a line (\`sheaf:<name>:<owner>\`, possibly with \`?at=...\`).`);
    const [nm, owner] = parsed;
    const own = await labelOf(r, nm, owner);
    if (own) return [{ label: own }, `${nm}:${owner}`, `\`${own}\``];
    const at = archive || parsed[2];
    if (at && !at.startsWith('https://')) throw new Problem(`The \`at\` of \`${text}\` should be the https address of an archive.`);
    const entry = { uri: `sheaf:${nm}:${owner}` };
    if (at) entry.at = [at];
    return [entry, `${nm}:${owner}`, `\`sheaf:${nm.slice(0, 12)}...\`` + (at ? ` (${at})` : '')];
  }
  if (!LABEL.test(text)) {
    throw new Problem(`**${name}** should be a label (\`kpz-uniqueness\`) or a sheaf: URI (\`sheaf:<name>:<owner>\`), not \`${text}\`.`);
  }
  const own = (await settings(r)).baseUrl || '';
  if (!archive || archive.replace(/\/+$/, '') === own.replace(/\/+$/, '')) {
    const o = (await labels(r)).get(text);
    if (!o) {
      throw new Problem(`This archive has no line labelled \`${text}\`; for a line of another archive, give its ` +
                        `address in **${archiveName}**.`);
    }
    return [{ label: text }, `${o.name}:${o.owner}`, `\`${text}\``];
  }
  const o = ((await readDiscovery(r, archive)).objects || []).find((x) => x.label === text);
  if (!o) throw new Problem(`The archive at \`${archive}\` has no line labelled \`${text}\`.`);
  return [{ uri: `sheaf:${o.name}:${o.owner}`, at: [archive] }, `${o.name}:${o.owner}`, `\`${text}\` of ${archive}`];
}

async function find(r, data, key, text) {
  for (const m of data.members) if ((await entryKey(r, m)) === key) return m;
  throw new Problem(`${text} is not a member of this collection.`);
}

function insert(data, member, where) {
  if (where && where >= 1 && where <= data.members.length) data.members.splice(where - 1, 0, member);
  else data.members.push(member);
}

async function ownChildren(r, label) {
  const out = [];
  for (const m of (await load(r, label)).members) {
    if (m && typeof m === 'object' && m.label && (await exists(r, listPath(m.label)))) out.push(m.label);
  }
  return out;
}

async function descendants(r, label, seen = new Set()) {
  for (const child of await ownChildren(r, label)) {
    if (!seen.has(child)) {
      seen.add(child);
      await descendants(r, child, seen);
    }
  }
  return seen;
}

async function parents(r, label) {
  const out = [];
  for (const c of await allCollections(r)) {
    if (c !== label && (await load(r, c)).members.some((m) => m && typeof m === 'object' && m.label === label)) out.push(c);
  }
  return out;
}

async function vetted(r, label, key) {
  for (const m of ((await headFile(r, label, 'members.json')) || {}).members || []) {
    if (`${m.name}:${m.owner}` === key) return (m.revisions || []).map((x) => x.documentVersion);
  }
  return [];
}

const ADDED = /^(\S+): v\d+ (\(|branch of|moves )/;

async function osheaf(r, run, { presented = true } = {}) {
  const f = await ArchiveFolder.open(r.storage, r.env);
  if (f.old) throw new Problem('osheaf stopped with this message:\n\n```\n' + REBUILD + '\n```');
  const start = r.said.length;
  try {
    await run(f);
    if (presented) await present(f);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    throw new Problem('osheaf stopped with this message:\n\n```\n' + error.message.split('\n').slice(-15).join('\n') + '\n```');
  }
  for (const line of r.said.slice(start)) if (ADDED.test(line.trim())) r.added.push(line.trim());
}

async function sync(r, label, message) {
  const text = await readText(r.storage, listPath(label));
  await osheaf(r, (f) => collections.sync(f, { collection: label, message,
                                                fromFile: { name: listPath(label), given: listPath(label), text } }));
  if ((await load(r, label)).type !== 'selection') {
    try {
      await osheaf(r, (f) => collections.update(f, { collection: [label] }));
    } catch (error) {
      if (!(error instanceof Problem)) throw error;
    }
  }
}

async function propagate(r, label, message, seen = new Set()) {
  for (const parent of await parents(r, label)) {
    if (seen.has(parent)) continue;
    seen.add(parent);
    const data = await load(r, parent);
    const member = data.members.find((m) => m && typeof m === 'object' && m.label === label);
    if (data.type === 'selection') {
      const dv = await documentVersion(r, label);
      const o = (await labels(r)).get(label);
      const revisions = [...(member.revisions?.length ? member.revisions : await vetted(r, parent, `${o.name}:${o.owner}`))];
      if (!revisions.includes(dv)) member.revisions = [...revisions, dv].sort((a, b) => a - b);
    } else {
      member.follow = true;
    }
    await save(r, parent, data);
    await sync(r, parent, message);
    await propagate(r, parent, message, seen);
  }
}

export function safeName(name) {
  const last = String(name).split(/[\\/]/).pop().trim();
  return last.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'file';
}

function attached(form, label) {
  const used = new Set(), out = [];
  for (const file of form.files[label] || []) {
    let name = safeName(file.name);
    const dot = name.lastIndexOf('.');
    for (let k = 1; used.has(name); k++) {
      const s = safeName(file.name);
      name = dot > 0 ? `${s.slice(0, dot)}-${k}${s.slice(dot)}` : `${s}-${k}`;
    }
    used.add(name);
    out.push({ name, bytes: file.bytes });
  }
  return out;
}

const suffix = (name) => {
  const k = name.lastIndexOf('.');
  return k > 0 ? name.slice(k).toLowerCase() : '';
};

async function sources(form) {
  const files = attached(form, 'Sources');
  const mainName = field(form, 'Main source');
  if (!files.length) return [null, []];
  if (files.length === 1 && suffix(files[0].name) === '.zip') {
    const { names, bytesOf } = await unpack(files[0].bytes);
    if (!names.length) throw new Problem('The zip of the sources is empty.');
    let main;
    if (mainName) {
      if (!names.includes(mainName)) {
        throw new Problem(`The main source \`${mainName}\` is not in the zip; it holds: ` +
                          [...names].sort().slice(0, 30).map((n) => `\`${n}\``).join(', ') + '.');
      }
      main = mainName;
    } else {
      const candidates = names.filter((n) => !n.includes('/') && SOURCE_SUFFIXES.has(suffix(n)));
      if (candidates.length !== 1) {
        throw new Problem('Say which file of the zip is the main source, in the field **Main source** (for ' +
                          'instance `paper.tex`).');
      }
      main = candidates[0];
    }
    const file = (n) => ({ name: n.split('/').pop(), bytes: bytesOf(n), logical: n });
    return [file(main), names.filter((n) => n !== main).map(file)];
  }
  if (files.length === 1) return [files[0], []];
  if (!mainName) {
    throw new Problem('Several source files are attached: put them in one zip, or say which one is the main ' +
                      'source in the field **Main source**.');
  }
  const named = files.find((p) => p.name === safeName(mainName));
  if (!named) throw new Problem(`The main source \`${mainName}\` is not among the attached files.`);
  return [named, files.filter((p) => p !== named).map((p) => ({ ...p, logical: p.name }))];
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let k = bytes.length - 22; k >= Math.max(0, bytes.length - 22 - 65535); k--) {
    if (view.getUint32(k, true) === 0x06054b50) {
      end = k;
      break;
    }
  }
  if (end < 0) throw new Problem('The zip of the sources cannot be read (no central directory).');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = [];
  const text = new TextDecoder('utf-8');
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Problem('The zip of the sources is damaged.');
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
    const csize = view.getUint32(at + 20, true), nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = text.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (csize === 0xffffffff || local === 0xffffffff) throw new Problem('The zip of the sources is a ZIP64 archive: make an ordinary zip.');
    if (flags & 1) throw new Problem('The zip of the sources is encrypted.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + csize);
    out.push({ name, read: async () => {
      if (method === 0) return raw.slice();
      if (method === 8) return inflate(raw);
      throw new Problem(`The zip of the sources compresses ${name} with a method other than deflate.`);
    } });
  }
  return out;
}

async function unpack(bytes) {
  const found = new Map();
  for (const m of await readZip(bytes)) {
    const parts = m.name.split('/').filter((p) => p !== '' && p !== '.');
    if (m.name.endsWith('/') || !parts.length || m.name.startsWith('/') || parts.includes('..') ||
        parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store') continue;
    found.set(parts.join('/'), await m.read());
  }
  let names = [...found.keys()];
  let prefix = '';
  const tops = new Set(names.map((n) => n.split('/')[0]));
  if (tops.size === 1 && names.every((n) => n.includes('/'))) {
    prefix = [...tops][0] + '/';
    names = names.map((n) => n.slice(prefix.length));
  }
  return { names, bytesOf: (n) => found.get(prefix + n) };
}

async function currentDescription(r, label) {
  const d = await headFile(r, label, 'datacite.json');
  if (!d) return [null, []];
  const title = (d.titles || [{}])[0]?.title ?? null;
  const authors = (d.creators || []).map((c) => {
    const aff = (c.affiliation || []).map((a) => (a && typeof a === 'object' ? a.name : a));
    return c.name + (aff.length && aff[0] ? `|${aff[0]}` : '');
  });
  return [title, authors];
}

async function depositOp(r, form, origin) {
  const what = field(form, 'This deposit', true);
  if (what !== NEW_PAPER && what !== NEW_VERSION) throw new Problem(`**This deposit** is "${NEW_PAPER}" or "${NEW_VERSION}".`);
  const fresh = what === NEW_PAPER;
  const label = labelField(form, 'Label', fresh ? 32 : 64);
  const cid = await collection(r, form, false);
  await ownCollection(r, cid);
  const entry = (await labels(r)).get(label);
  if (fresh && entry) {
    throw new Problem(`\`${label}\` is already the label of a ${entry.kind || 'line'} of this archive: for a new ` +
                      `version of it, choose "${NEW_VERSION}"; for a new paper, another label.`);
  }
  if (!fresh) await knownDocument(r, label);
  const pdfs = attached(form, 'PDF of this version').filter((p) => suffix(p.name) === '.pdf');
  if (!pdfs.length) throw new Problem('Attach the PDF of this version to the field **PDF of this version**.');
  const [main, others] = await sources(form);
  const missing = field(form, 'If there are no sources, why');
  if (!main && !missing) {
    throw new Problem('Attach the sources (one file, or a zip), or say why there are none in the field ' +
                      '**If there are no sources, why**.');
  }
  const a = { label, source: main ? { name: main.name, bytes: main.bytes } : null, pdf: pdfs[0], type: 'Preprint',
              keyword: [], toolchain: [], author: [], related: [], extraSource: [] };
  if (fresh) a.new = true;
  if (!main) a.noSource = missing;
  const licenceFile = field(form, 'Licence file');
  if (licenceFile) {
    if (!main) throw new Problem('A **Licence file** must be one of the sources; there are none.');
    if (![main.name, ...others.map((o) => o.logical)].includes(licenceFile)) {
      throw new Problem(`The licence file \`${licenceFile}\` is not among the sources: give its path inside the zip ` +
                        '(for instance `LICENSE`).');
    }
    a.licenceFile = licenceFile;
  }
  a.extraSource = others.map((o) => ({ name: o.name, bytes: o.bytes, logical: o.logical === o.name ? '' : o.logical }));
  let title = field(form, 'Title'), authors = lines(field(form, 'Authors'));
  if (!fresh && (!title || !authors.length)) {
    const [oldTitle, oldAuthors] = await currentDescription(r, label);
    title ||= oldTitle;
    if (!authors.length) authors = oldAuthors;
  }
  if (!title || !authors.length) {
    throw new Problem('Give the **Title** and the **Authors** (they can be left empty only for a new version of a ' +
                      'paper already in the archive).');
  }
  a.title = title;
  a.author = authors;
  const abstract = field(form, 'Abstract');
  if (abstract) a.abstractFile = abstract + '\n';
  for (const keyword of field(form, 'Keywords').split(/[,;\n]/)) if (keyword.trim()) a.keyword.push(keyword.trim());
  const rights = licence(form, 'Licence');
  if (rights) a.rights = rights;
  else if (fresh) {
    throw new Problem('Choose a **Licence** for a new paper ("Keep as before" is for new versions). "All rights ' +
                      'reserved" lets readers read the paper but not copy it; CC BY 4.0 lets anyone copy it with ' +
                      'credit. Check what your publisher allows for papers published in journals.');
  }
  a.related = lines(field(form, 'Related identifiers'));
  const changes = field(form, 'What changed (for a new version)');
  if (changes) a.changes = changes;
  const available = date(form, 'Date this version became public');
  if (available) a.available = available;
  const issued = date(form, 'Date the paper first appeared');
  if (issued) a.issued = issued;
  a.message = `Deposit from ${origin}`;
  if (fresh && r.owner) a.owner = r.owner;
  const [target, branched] = fresh ? [label, ''] : await continued(r, entry, label, origin);
  a.label = target;
  await osheaf(r, (f) => deposit(f, a));
  const where = await place(r, form, cid, target);
  const kind = fresh ? 'new paper' : 'new version';
  return [cid, `Deposit ${label}, ${kind}${branched}${where} (${origin})`, `Deposit: ${label}`,
          `\`${label}\` was deposited (${kind})${branched}${where}`];
}

async function place(r, form, cid, label) {
  if (!cid) return '';
  const data = await load(r, cid);
  const o = (await labels(r)).get(label), key = `${o.name}:${o.owner}`;
  let member = null;
  for (const m of data.members) {
    if ((await entryKey(r, m)) === key) {
      member = m;
      break;
    }
  }
  if (!member) {
    const entry = { label };
    if (data.type !== 'selection') entry.follow = true;
    insert(data, entry, position(form));
  } else if (data.type === 'selection') {
    const dv = await documentVersion(r, label);
    const old = member.revisions?.length ? member.revisions : await vetted(r, cid, key);
    member.revisions = [...new Set([...old, dv])].sort((x, y) => x - y);
  }
  await save(r, cid, data);
  return ` in the collection \`${cid}\``;
}

async function noticeOp(r, form, origin) {
  const label = labelField(form, 'Label');
  ownLine(r, await knownDocument(r, label), label, 'A notice');
  const about = field(form, 'Document version it is about', true);
  if (!/^\d+$/.test(about)) throw new Problem(`**Document version it is about** should be a number (1, 2, ...), not \`${about}\`.`);
  const text = field(form, 'Text of the notice', true);
  const replaces = field(form, 'Notice it replaces (optional)');
  if (replaces && !/^\d+$/.test(replaces)) {
    throw new Problem(`**Notice it replaces** should be a number (1 for the first notice of the paper), not \`${replaces}\`.`);
  }
  const files = attached(form, 'Full statement (optional)');
  await osheaf(r, (f) => notice(f, { label, about: Number(about), text, file: files[0] || null,
                                     replaces: replaces ? Number(replaces) : null, message: `Notice from ${origin}` }));
  return ['', `Notice about ${label}, version ${about} (${origin})`, `Notice: ${label}, version ${about}`,
          `\`${label}\` was given a notice`];
}

async function withdrawOp(r, form, origin) {
  const label = labelField(form, 'Label');
  ownLine(r, await knownDocument(r, label), label, 'A withdrawal');
  const reason = field(form, 'Reason for the withdrawal', true);
  await osheaf(r, (f) => withdraw(f, { label, reason, file: null, message: `Withdrawal from ${origin}` }));
  return ['', `Withdraw ${label} (${origin})`, `Withdrawal: ${label}`, `\`${label}\` was withdrawn (its files stay in the archive)`];
}

async function relicenseOp(r, form, origin) {
  const label = labelField(form, 'Label');
  ownLine(r, await knownDocument(r, label), label, 'A new licence');
  const rights = licence(form, 'New licence');
  if (!LICENCES.has(rights)) throw new Problem('Choose the new licence in the field **New licence**.');
  const method = field(form, 'How the authors agreed', true);
  await osheaf(r, (f) => relicense(f, { label, rights, method, message: `New licence from ${origin}` }));
  return ['', `Relicense ${label} as ${rights} (${origin})`, `Licence: ${label}, ${rights}`,
          `\`${label}\` was relicensed as ${rights}`];
}

async function makeCollection(r, label, title, kind, description, message, owner = null) {
  const data = { title };
  if (description) data.description = description;
  if (owner) data.owner = owner;
  Object.assign(data, { type: kind, order: 'manual', members: [] });
  await save(r, label, data);
  await sync(r, label, message);
}

async function feature(r, label) {
  const s = await settings(r);
  s.index ??= {};
  s.index.html ??= { templates: 'templates' };
  s.index.html.featured = label;
  await writeText(r.storage, 'osheaf.json', jsonText(s));
}

async function newCollectionOp(r, form, origin) {
  const label = labelField(form, 'Label of the new collection', 32);
  if ((await exists(r, listPath(label))) || (await labels(r)).has(label) || (await catalogues(r)).has(label)) {
    throw new Problem(`\`${label}\` is already taken in this archive.`);
  }
  const title = field(form, 'Title of the collection', true);
  const kind = field(form, 'Kind').toLowerCase().startsWith('catalogue') ? 'catalogue' : 'selection';
  const parent = await collection(r, form, false);
  await ownCollection(r, parent);
  const s = await settings(r);
  await makeCollection(r, label, title, kind, field(form, 'Description'), `New collection ${label} (${origin})`,
                       r.owner && r.owner !== s.owner ? r.owner : null);
  if (field(form, 'Feature it on the home page').toLowerCase().startsWith('yes')) await feature(r, label);
  let where = '';
  if (parent) {
    const pdata = await load(r, parent);
    const entry = { label };
    if (pdata.type !== 'selection') entry.follow = true;
    insert(pdata, entry, position(form));
    await save(r, parent, pdata);
    where = ` in the collection \`${parent}\``;
  }
  return [parent, `New collection ${label}${where} (${origin})`, `Collection: ${label}`,
          `the collection \`${label}\` was created${where}`];
}

async function addOp(r, form, origin) {
  const cid = await collection(r, form, true);
  await ownCollection(r, cid);
  const data = await load(r, cid);
  const [entry, key, text] = await memberRef(r, form, 'New member', 'Archive of the new member');
  const revisions = versions(form, 'Versions you vet (selection)');
  for (const m of data.members) if ((await entryKey(r, m)) === key) throw new Problem(`${text} is already a member of \`${cid}\`.`);
  const own = entry.label;
  if (own && ((await catalogues(r)).has(own) || own === cid ||
              ((await exists(r, listPath(own))) && (await descendants(r, own)).has(cid)))) {
    throw new Problem(`\`${own}\` cannot be a member of itself, or of a collection inside it.`);
  }
  if (data.type === 'selection') {
    if (revisions.length) entry.revisions = revisions;
  } else {
    if (revisions.length) {
      throw new Problem(`Versions are vetted only in a selection; \`${cid}\` is a catalogue, which follows its ` +
                        'members. Leave **Versions you vet** empty.');
    }
    entry.follow = true;
  }
  insert(data, entry, position(form));
  await save(r, cid, data);
  return [cid, `Add ${text.replaceAll('`', '')} to ${cid} (${origin})`, `Member added to ${cid}`, `${text} was added to \`${cid}\``];
}

async function vetOp(r, form, origin) {
  const cid = await collection(r, form, true);
  await ownCollection(r, cid);
  const data = await load(r, cid);
  if (data.type !== 'selection') {
    throw new Problem(`Versions are vetted only in a selection; \`${cid}\` is a catalogue, which follows its members ` +
                      '(run **Update the collections** in the Actions tab to move them on).');
  }
  const [, key, text] = await memberRef(r, form, 'Member', 'Archive of the member');
  let member = await find(r, data, key, text);
  const wanted = versions(form, 'Versions to vet', true);
  const old = member && typeof member === 'object' && member.revisions?.length ? [...member.revisions] : await vetted(r, cid, key);
  const added = wanted.filter((v) => !old.includes(v));
  if (!added.length) throw new Problem(`${text} already has the versions ${wanted.join(', ')} vetted.`);
  if (typeof member !== 'object') {
    const index = data.members.indexOf(member);
    member = data.members[index] = { uri: member };
  }
  member.revisions = [...old, ...added].sort((x, y) => x - y);
  await save(r, cid, data);
  const vs = added.join(', ');
  return [cid, `Vet version ${vs} of ${text.replaceAll('`', '')} in ${cid} (${origin})`, `Vetted: version ${vs} (in ${cid})`,
          `version ${vs} of ${text} was vetted`];
}

async function removeOp(r, form, origin) {
  const cid = await collection(r, form, true);
  await ownCollection(r, cid);
  const data = await load(r, cid);
  const [, key, text] = await memberRef(r, form, 'Member to remove', 'Archive of the member');
  const member = await find(r, data, key, text);
  data.members.splice(data.members.indexOf(member), 1);
  await save(r, cid, data);
  return [cid, `Remove ${text.replaceAll('`', '')} from ${cid} (${origin})`, `Member removed from ${cid}`,
          `${text} was removed from \`${cid}\``];
}

const KEY_LOG = 'key-log';

function siteUrl(url) {
  url = url.trim().replace(/^http:\/\//, 'https://');
  return url.endsWith('/') ? url : url + '/';
}

async function keyLogFolder(r, form) {
  const zips = attached(form, 'Key log of the owner');
  if (zips.length) {
    if (zips.length !== 1 || suffix(zips[0].name) !== '.zip') {
      throw new Problem('Attach the key log of the owner as one zip of its folder.');
    }
    const { names, bytesOf } = await unpack(zips[0].bytes);
    const storage = new MemoryStorage();
    for (const n of names) await storage.write(n, bytesOf(n));
    return { storage, dir: '', where: zips[0].name };
  }
  if (r.keyLog) return { where: 'the key log given', ...r.keyLog };
  if ((await r.storage.kind(KEY_LOG)) === 'dir') return { storage: r.storage, dir: KEY_LOG, where: KEY_LOG };
  throw new Problem(
    "The archive needs its owner's key log, made on your computer by the key ceremony of the " +
    'README (`osheaf init` with `--new-owner`, then a key for GitHub\'s workflows): add the ' +
    'folder of the owner object (`ocfl/<owner>/<owner>/` of the archive where it was made) to ' +
    'the repository as `key-log/`, or attach it as a zip. The repository secret ' +
    '`OPENSHEAF_SIGNING_KEY` must hold the current key made for the workflows.');
}

async function removeTree(storage, dir) {
  for (const e of (await storage.list(dir)) || []) {
    const p = joinPath(dir, e.name);
    if (e.kind === 'dir') await removeTree(storage, p);
    else await storage.remove(p);
  }
}

async function initCommand(r, args) {
  const start = r.said.length;
  try {
    await init(r.storage, r.env, args, '.');
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    throw new Problem('osheaf stopped with this message:\n\n```\n' + error.message.split('\n').slice(-15).join('\n') + '\n```');
  }
  for (const line of r.said.slice(start)) if (ADDED.test(line.trim())) r.added.push(line.trim());
}

async function setupOp(r, form, origin) {
  if (await exists(r, 'osheaf.json')) throw new Problem('The archive is already set up.');
  let base, rule;
  const given = field(form, 'Base URL');
  if (given) {
    [base, rule] = [siteUrl(given), 'as given'];
  } else if (r.defaultBase) {
    ({ url: base, rule } = await r.defaultBase());
  } else {
    throw new Problem('Give the address where the site will be served in the field **Base URL**.');
  }
  const title = field(form, 'Name', true);
  const folder = await keyLogFolder(r, form);
  let owner;
  try {
    const inv = await readJson(folder.storage, joinPath(folder.dir, 'inventory.json'));
    const [, o, again] = String(inv.id).split(':');
    if (!o || o !== again || String(inv.id).split(':').length !== 3) throw new Error('not an owner');
    owner = o;
  } catch {
    throw new Problem('The key log given is not the folder of an owner object: it should hold the ' +
                      '`inventory.json` of `sheaf:<owner>:<owner>` (copy `ocfl/<owner>/<owner>/` of the ' +
                      'archive where the owner was made).');
  }
  const named = field(form, 'Owner');
  if (named && named !== owner) throw new Problem(`The key log given is that of the owner \`${owner}\`, not \`${named}\`.`);
  const args = { owner, keyLog: folder.where, keyLogSource: folder, name: title, baseUrl: base,
                 curator: field(form, 'Curator', true) };
  for (const [label, option] of [['Affiliation', 'affiliation'], ['Contact', 'contact']]) {
    const value = field(form, label);
    if (value) args[option] = value;
  }
  await initCommand(r, args);
  const wallet = field(form, 'Key wallet');
  if (wallet) await osheaf(r, (f) => keyWallet(f, { owner, add: wallet }, f.env), { presented: false });
  if ((await r.storage.kind(KEY_LOG)) === 'dir') await removeTree(r.storage, KEY_LOG);
  const purpose = field(form, 'Purpose').toLowerCase() || 'papers';
  let done;
  if (purpose === 'selection' || purpose === 'catalogue') {
    let label = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
      .replace(/^-+|-+$/g, '') || 'collection';
    if ((await catalogues(r)).has(label)) label += '-collection';
    await makeCollection(r, label, title, purpose, field(form, 'Description'), `The collection is set up (${origin})`);
    await feature(r, label);
    done = `the archive was set up, owned by \`${owner}\`, with the collection \`${label}\` featured on its home page`;
  } else {
    done = `the archive was set up, owned by \`${owner}\``;
  }
  done += `. Its base URL is ${base} (${rule}); if that is not where its site is served, change ` +
    '`baseUrl` in `osheaf.json` and run `osheaf index`';
  return ['', `Set up the archive: ${title} (${origin})`, `Setup: ${title}`, done];
}

export const OPERATIONS = { setup: setupOp, deposit: depositOp, notice: noticeOp, withdraw: withdrawOp,
                            relicense: relicenseOp, new_collection: newCollectionOp, add: addOp, vet: vetOp,
                            remove: removeOp };
export const WORKFLOW_ONLY = ['arxiv'];

export async function ownLineOf(f, id, owner) {
  const dir = await f.dirOf(id);
  const inv = await f.inventory(dir);
  if (!inv) return null;
  const genesis = await f.readLogical(dir, inv, GENESIS);
  const [, name, lineOwner] = id.split(':');
  for (let k = 0; k < 16; k++) {
    const other = objectId(await nameOf(genesis, k), owner);
    if (other === id) continue;
    const d = await f.dirOf(other);
    const i = await f.inventory(d);
    if (!i) continue;
    const head = (await f.readObjectJson(d, i, OBJ)) || {};
    if (!head.parent || (head.parent.owner === lineOwner && head.parent.name === name)) return other;
  }
  return null;
}

async function branchLabelFor(r, label, owner) {
  const all = await labels(r);
  const given = r.branchLabel;
  if (given) {
    if (!LABEL.test(given) || given.length > 64) {
      throw new Problem(`\`${given}\` is not a valid label for the branch: at most 64 characters, lower-case ` +
                        'letters and digits, words joined by `-`.');
    }
    if (all.has(given)) throw new Problem(`\`${given}\` is already a label of this archive: choose another for the branch.`);
    return given;
  }
  const named = [...all].find(([, o]) => o.kind === 'owner' && o.name === owner);
  const word = named ? named[0] : owner.slice(0, 8);
  const stem = `${label.slice(0, 63 - word.length)}-${word}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
  let candidate = stem;
  for (let n = 2; all.has(candidate); n++) candidate = `${stem.slice(0, 63 - String(n).length)}-${n}`;
  return candidate;
}

async function continued(r, entry, label, origin) {
  if (!r.owner || entry.owner === r.owner) return [label, ''];
  const f = await r.folder();
  const id = objectId(entry.name, entry.owner);
  const own = await ownLineOf(f, id, r.owner);
  if (own) {
    const ownLabel = f.labelOf(own);
    if (!ownLabel) {
      throw new Problem(`The owner \`${r.owner.slice(0, 8)}\` has a line of this work, \`${own}\`, without a ` +
                        'label in this archive: give it one (`osheaf label`), and deposit into it.');
    }
    return [ownLabel, `, in the line \`${ownLabel}\` of the owner \`${r.owner.slice(0, 8)}\``];
  }
  const branchLabel = await branchLabelFor(r, label, r.owner);
  const at = r.branchFrom ? `/v${r.branchFrom}` : '';
  await osheaf(r, (g) => makeBranch(g, `sheaf:${entry.name}:${entry.owner}${at}`, [],
                                    { owner: r.owner, label: branchLabel, message: `Branch of ${label} from ${origin}` }));
  return [branchLabel, `, in the new branch \`${branchLabel}\` of the owner \`${r.owner.slice(0, 8)}\``];
}

function ownLine(r, entry, label, what) {
  if (r.owner && entry.owner !== r.owner) {
    throw new Problem(`${what} is given only by the owner of the line: \`${label}\` is a line of the owner ` +
                      `\`${entry.owner.slice(0, 8)}\`, not of \`${r.owner.slice(0, 8)}\`. Act as its owner, or give ` +
                      'it on your own branch of the paper.');
  }
}

async function ownCollection(r, cid) {
  if (!r.owner || !cid) return;
  const entry = (await labels(r)).get(cid);
  if (entry && entry.owner !== r.owner) {
    throw new Problem(`The collection \`${cid}\` is a line of the owner \`${entry.owner.slice(0, 8)}\`, not of ` +
                      `\`${r.owner.slice(0, 8)}\`: only its owner changes its members. Act as its owner.`);
  }
}

export async function carryOut(storage, env, operation, fields, files = {}, { origin = 'the OpenSheaf manager',
                                                                              schemas = null, digests = true,
                                                                              keyLog = null, defaultBase = null,
                                                                              owner = null, branchFrom = null,
                                                                              branchLabel = null } = {}) {
  const said = [];
  const r = {
    storage, said, added: [], keyLog, defaultBase, owner, branchFrom, branchLabel,
    env: { ...env, out: (line) => said.push(line), err: (line) => said.push(line) },
    async folder() {
      return ArchiveFolder.open(storage, this.env);
    },
  };
  const form = { fields: fields || {}, files: files || {} };
  try {
    if (WORKFLOW_ONLY.includes(operation)) {
      throw new Problem(`The operation \`${operation}\` is carried out by the archive's workflow, not by the page.`);
    }
    const op = OPERATIONS[operation];
    if (!op) throw new Problem(`Unknown operation \`${operation}\`.`);
    if (operation !== 'setup' && !(await exists(r, 'osheaf.json'))) {
      throw new Problem('The archive is not set up yet: set it up first (the workflow **Set up the archive** in ' +
                        "the Actions tab, or the manager's setup).");
    }
    if (owner && operation !== 'setup' && !(await r.folder()).archiveOwners().includes(owner)) {
      throw new Problem(`\`${owner}\` is not an owner this archive hosts (\`owner\` and \`owners\` in \`osheaf.json\`).`);
    }
    if (branchFrom !== null && !(Number.isInteger(branchFrom) && branchFrom >= 1)) {
      throw new Problem(`A branch is made from a document version, 1, 2, ..., not \`${branchFrom}\`.`);
    }
    let [cid, message, title, done] = await op(r, form, origin);
    const why = field(form, 'Why (optional)');
    if (why) message += `: ${why}`;
    await osheaf(r, (f) => collect(f, { owner: owner || f.archive.owner }));
    if (cid) {
      await sync(r, cid, message);
      await propagate(r, cid, message);
    }
    await osheaf(r, async (f) => {
      await writeDiscovery(f);
      if (hasWebsite(f)) await readableIndex(f);
      else r.env.out('opensheaf.json and the indexes written (no readable index configured)');
    }, { presented: false });
    if (schemas) await verified(r, schemas, digests);
    const body = [...new Set(r.added)].join('\n');
    const base = (await settings(r)).baseUrl;
    return { ok: true, title, done, said,
             commitMessage: message + '\n' + (body ? `\n${body}\n` : ''),
             message: `Done: ${done}.\n\nThe archive's site, <${base}>, shows it once GitHub Pages has published it ` +
                      '(usually within a few minutes).\n' };
  } catch (error) {
    if (!(error instanceof Problem)) throw error;
    return { ok: false, said, message: `Nothing was changed in the archive.\n\n${error.message}\n\nCorrect it and send the request again.\n` };
  }
}

async function verified(r, schemas, digests) {
  const report = await verifyFolder(r.storage, { schemas, digests, fetch: r.env.fetch, fetchJson: r.env.fetchJson });
  if (!report.counts().error) return;
  const out = report.findings.map((x) => `${x.level}: ${x.place}: ${x.message}`);
  const c = report.counts();
  out.push(`${c.error} error(s), ${c.warning} warning(s), ${c.result} result(s)`);
  throw new Problem('osheaf stopped with this message:\n\n```\n' + out.slice(-15).join('\n') + '\n```');
}
