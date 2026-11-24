// Generated from literate/43-arxiv.md by opensheaf-literate: edit the document, not this file.
import { LABEL } from './names.js';
import { jsonBytes, md5hex, sha512hex, sha256hex } from './write.js';
import { joinPath, compareText } from './storage.js';
import { OBJ, OBJ_FORMAT, GENESIS, SPEC, exit } from './folder.js';
import { carryForward, carriedFiles, landingUrl } from './deposit.js';
import { writeDiscovery } from './discovery.js';
import { removeFolder } from './takedown.js';

export function xmlText(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, c) => c.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[x]))
    .replace(/&(lt|gt|amp|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
    });
}

function element(xml, tag) {
  const m = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>)`).exec(xml);
  if (!m) return null;
  return { text: m[1] === undefined ? null : xmlText(m[1]), attrs: m[0].slice(0, m[0].indexOf('>')) };
}

function elements(xml, tag) {
  const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`, 'g');
  return [...xml.matchAll(re)].map((m) => ({ inner: m[1], attrs: m[0].slice(0, m[0].indexOf('>')) }));
}

export function words(s) {
  return s.split(/\s+/).filter(Boolean);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function emailDate(text) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text || '');
  if (!m || !MONTHS.includes(m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase())) throw new Error(`not a date: ${text}`);
  let year = Number(m[3]);
  if (m[3].length === 2) year += year > 68 ? 1900 : 2000;
  const two = (n) => String(n).padStart(2, '0');
  const month = MONTHS.indexOf(m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()) + 1;
  return `${String(year).padStart(4, '0')}-${two(month)}-${two(m[1])}T${two(m[4])}:${m[5]}:${m[6] || '00'}Z`;
}

export function record(xmlBytes, where) {
  const xml = new TextDecoder().decode(xmlBytes).replace(/\r\n?/g, '\n');
  const raw = /<(?:[A-Za-z_][\w.-]*:)?arXivRaw(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?arXivRaw\s*>/.exec(xml);
  if (!raw) exit(`${where}: no arXivRaw record`);
  const r = raw[1];
  const text = (tag) => {
    const e = element(r, tag);
    return e && e.text ? words(e.text).join(' ') || '' : null;
  };
  const versions = elements(r, 'version').map((v) => ({
    v: /version="([^"]*)"/.exec(v.attrs)?.[1] ?? null,
    date: emailDate(element(v.inner, 'date')?.text),
    source_type: (element(v.inner, 'source_type')?.text || '').trim(),
  }));
  const authors = authorNames(text('authors'));
  const abstract = (element(r, 'abstract')?.text ?? '').trim();
  return { id: text('id'), title: text('title'), authors: authors.filter((a) => a.trim()).map(detex),
           abstract: abstract.replace(/[ \t]*\n[ \t]*/g, '\n'), license: text('license'), doi: text('doi'),
           journal: text('journal-ref'), categories: words(text('categories') || ''), comments: text('comments'),
           versions };
}

export function authorNames(s) {
  for (;;) {
    const t = s.replace(/\s*\([^()]*\)/g, '');
    if (t === s) break;
    s = t;
  }
  return s.split(/,\s*(?:and\s+)?|\s+and\s+/).filter((a) => a.trim());
}

export const ACCENTS = { "'": '́', '`': '̀', '"': '̈', '^': '̂', '~': '̃',
                         c: '̧', v: '̌', u: '̆', H: '̋', '=': '̄' };
const TEX_LETTERS = { o: 'ø', O: 'Ø', ss: 'ss', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł',
                      ae: 'æ', oe: 'œ', i: 'i' };

const accent = (m, a, letter) => (letter + ACCENTS[a]).normalize('NFC');

export function texText(s) {
  s = s.replace(/\{?\\(['`"^~=])\s*\{?([A-Za-z])\}?\}?/g, accent);
  s = s.replace(/\{?\\([cvuH])\s*\{([A-Za-z])\}\}?/g, accent);
  return s.replace(/\{\\(o|O|ss|aa|AA|l|L|ae|oe)\}|\\(o|O|ss|aa|AA|l|L|ae|oe)(?![\p{L}\p{N}_])/gu,
                   (m, a, b) => TEX_LETTERS[a || b]);
}

export function detex(s) {
  s = s.replace(/\\(['`"^~=])\s*\{?([A-Za-z])\}?/g, accent);
  s = s.replace(/\\([cvuH])\s*\{([A-Za-z])\}/g, accent);
  s = texText(s).replaceAll('{', '').replaceAll('}', '').replaceAll('~', ' ');
  return words(s).join(' ');
}

const PARTICLES = ['de', 'van', 'von', 'der', 'di', 'da', 'del', 'la', 'le'];

export function creatorOf(name) {
  const w = words(name);
  let i = w.length - 1;
  while (i > 0 && PARTICLES.includes(w[i - 1].toLowerCase())) i--;
  const family = w.slice(i).join(' '), given = w.slice(0, i).join(' ');
  const c = { name: given ? `${family}, ${given}` : family, nameType: 'Personal', familyName: family };
  if (given) c.givenName = given;
  return c;
}

export function cleanText(s, macros = null) {
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => '$' + x + '$');
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, x) => '$' + x.trim() + '$');
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, x) => '$' + x.trim() + '$');
  const out = [];
  for (let [isMath, part] of splitMath(s)) {
    if (!isMath) {
      part = texText(part).replaceAll('``', '“').replaceAll("''", '”').replaceAll('\\&', '&');
      part = plainMarkup(part);
      part = part.replace(/(\\[A-Za-z]+\s*)?\{([^{}\\$]*)\}/g, (m, command, inner) => (command ? m : inner));
      part = typographicText(part);
    } else if (macros && Object.keys(macros).length) {
      for (let k = 0; k < 4; k++) {
        const next = part.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (m, name) =>
          (Object.hasOwn(macros, name) && !STANDARD.has(name) ? `{${macros[name]}}` : m));
        if (next === part) break;
        part = next;
      }
    }
    out.push(isMath ? '$' + part + '$' : part);
  }
  return out.join('');
}

export const FONT_COMMANDS = 'emph|textit|textbf|textsl|textsc|textrm|textsf|texttt|textup|textmd|textnormal|' +
  'tmtextit|tmtextbf|tmtextsl|tmtextsc|tmtextrm|tmtextsf|tmtexttt|tmtextup|tmtextmd|tmem|tmstrong|tmname|tmsamp';
export const FONT_DECLARATIONS = 'it|em|bf|sl|sc|rm|sf|tt|itshape|bfseries|slshape|scshape|upshape|mdseries|normalfont';

export function plainMarkup(s) {
  const commands = new RegExp(`\\\\(?:${FONT_COMMANDS})\\s*\\{([^{}]*)\\}`, 'g');
  const declarations = new RegExp(`\\{\\\\(?:${FONT_DECLARATIONS})(?![A-Za-z])\\s*([^{}]*)\\}`, 'g');
  for (;;) {
    const t = s.replace(commands, (m, x) => x).replace(declarations, (m, x) => x);
    if (t === s) return s;
    s = t;
  }
}

export function typographicText(s) {
  return s.replace(/(?<![/\\])~/g, ' ').replaceAll('---', '—').replaceAll('--', '–');
}

export function splitMath(s) {
  return s.split(/(?<!\\)\$/).map((p, i) => [i % 2 === 1, p]);
}

export function preambleMacros(tex) {
  const k = tex.indexOf('\\begin{document}');
  const pre = k < 0 ? tex : tex.slice(0, k);
  const out = {};
  for (const m of pre.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z]+)\}?\s*(\[\d\])?\s*\{/g)) {
    if (m[2]) continue;
    const body = balanced(pre, m.index + m[0].length - 1);
    if (body !== null) out[m[1]] = body;
  }
  for (const m of pre.matchAll(/\\def\s*\\([A-Za-z]+)\s*\{/g)) {
    const body = balanced(pre, m.index + m[0].length - 1);
    if (body !== null && !Object.hasOwn(out, m[1])) out[m[1]] = body;
  }
  return out;
}

export function balanced(s, i) {
  let depth = 0;
  for (let j = i; j < Math.min(s.length, i + 2000); j++) {
    if (s[j] === '{' && (j === 0 || s[j - 1] !== '\\')) {
      depth++;
    } else if (s[j] === '}' && s.at(j - 1) !== '\\') {
      depth--;
      if (depth === 0) return s.slice(i + 1, j);
    }
  }
  return null;
}

export const STANDARD = new Set(`alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi
pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma
Upsilon Phi Psi Omega mathbb mathcal mathfrak mathrm mathbf mathit mathsf mathtt operatorname text textrm
frac dfrac tfrac sqrt sum prod int oint iint lim limsup liminf sup inf max min exp log ln sin cos tan sinh cosh
partial nabla infty cdot cdots ldots dots times otimes oplus leq geq le ge neq approx sim simeq equiv to mapsto
in notin subset subseteq supset cup cap setminus emptyset forall exists left right big Big bigg Bigg langle rangle
lfloor rfloor lceil rceil hat tilde bar vec dot ddot overline underline widehat widetilde quad qquad prime ast
star circ bullet pm mp div mid parallel perp lesssim gtrsim ll gg ell hbar Re Im wedge vee neg det dim ker deg
varnothing alpha_ operatorname* boldsymbol displaystyle textstyle mathscr llbracket rrbracket
rightarrow leftarrow Rightarrow Leftarrow longrightarrow leftrightarrow hookrightarrow uparrow downarrow
geqslant leqslant bot top vartriangle triangle square diamond angle backslash colon vert Vert lvert rvert
lVert rVert binom choose mathring check breve acute grave over not neq ne propto cong asymp nearrow searrow`.split(/\s+/));

export function unknownMacros(s) {
  const found = new Set();
  for (const [isMath, part] of splitMath(s)) {
    if (isMath) for (const m of part.matchAll(/\\([A-Za-z]+)/g)) if (!STANDARD.has(m[1])) found.add(m[1]);
  }
  return [...found].sort();
}

export const LICENCES = {
  'http://arxiv.org/licenses/assumed-1991-2003/':
    { rights: 'arXiv.org non-exclusive license to distribute, assumed for submissions of 1991-2003; ' +
              'all other rights reserved to the authors' },
  'http://arxiv.org/licenses/nonexclusive-distrib/1.0/':
    { rights: 'arXiv.org perpetual, non-exclusive license to distribute; all other rights reserved to the authors' },
  'http://creativecommons.org/licenses/by/4.0/':
    { rights: 'Creative Commons Attribution 4.0 International', rightsIdentifier: 'cc-by-4.0' },
  'http://creativecommons.org/licenses/by-sa/4.0/':
    { rights: 'Creative Commons Attribution Share Alike 4.0 International', rightsIdentifier: 'cc-by-sa-4.0' },
  'http://creativecommons.org/licenses/by-nc-sa/4.0/':
    { rights: 'Creative Commons Attribution Non Commercial Share Alike 4.0 International',
      rightsIdentifier: 'cc-by-nc-sa-4.0' },
  'http://creativecommons.org/licenses/by-nc-nd/4.0/':
    { rights: 'Creative Commons Attribution Non Commercial No Derivatives 4.0 International',
      rightsIdentifier: 'cc-by-nc-nd-4.0' },
  'http://creativecommons.org/publicdomain/zero/1.0/':
    { rights: 'Creative Commons Zero v1.0 Universal', rightsIdentifier: 'cc0-1.0' },
};

export function rightsOf(uri) {
  uri = uri || 'http://arxiv.org/licenses/nonexclusive-distrib/1.0/';
  const r = { ...(Object.hasOwn(LICENCES, uri) ? LICENCES[uri] : { rights: uri }), rightsUri: uri };
  if ('rightsIdentifier' in r) r.rightsIdentifierScheme = 'SPDX';
  return r;
}

const VERSION_SUFFIX = /v\d+$/;

export async function alreadyArchived(f) {
  const out = new Map(), mine = new Set(f.archiveOwners());
  for (const { id, dir, inv } of await f.objects()) {
    if (!id || inv === null || id.startsWith('sheaf:draft:') || !mine.has(id.split(':')[2])) continue;
    for (const ver of Object.keys(inv.versions)) {
      const obj = (await f.readObjectJson(dir, inv, OBJ, ver)) || {};
      if (obj.kind !== 'document') break;
      for (const e of obj.external || []) {
        if (e.service === 'arXiv' && (e.record || '').includes('/abs/')) {
          out.set(e.record.slice(e.record.lastIndexOf('/abs/') + 5).replace(VERSION_SUFFIX, ''), id);
        }
      }
      const dc = (await f.readObjectJson(dir, inv, 'datacite.json', ver)) || {};
      for (const r of dc.relatedIdentifiers || []) {
        const v = r.relatedIdentifier;
        if (r.relatedIdentifierType === 'arXiv') {
          out.set(v.slice(v.indexOf(':') + 1).replace(VERSION_SUFFIX, ''), id);
        } else if (r.relatedIdentifierType === 'DOI' && v.toLowerCase().startsWith('10.48550/arxiv.')) {
          out.set(v.slice('10.48550/arXiv.'.length).replace(VERSION_SUFFIX, ''), id);
        }
      }
    }
  }
  return out;
}

export async function archivedVersions(f, id) {
  const dir = await f.dirOf(id);
  const inv = await f.inventory(dir);
  const out = new Set();
  for (const ver of Object.keys(inv.versions)) {
    const obj = await f.readObjectJson(dir, inv, OBJ, ver);
    for (const e of obj.external || []) {
      if (e.service === 'arXiv' && (e.record || '').includes('/abs/')) out.add(e.record.slice(e.record.lastIndexOf('/abs/') + 5));
    }
  }
  return out;
}

export function slug(title, taken) {
  let t = detex(title).normalize('NFKD');
  t = t.replace(/\\[a-zA-Z]+/g, (m) => m.slice(1));
  t = t.replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let out = '';
  for (const w of t.split('-')) {
    if (out.length + w.length + 1 > 56) break;
    out = out ? `${out}-${w}` : w;
  }
  const base = out;
  for (let n = 2; taken.has(out); n++) out = `${base}-${n}`;
  return out;
}

export const LIMITS = { unpacked: 2 ** 30, members: 10000 };

export async function unpack(data, src, baseId) {
  const notes = [], files = [];
  if (isPdf(data)) return { kind: 'pdf', files, notes };
  const raw = await gunzip(data, LIMITS.unpacked + 1, src);
  if (raw.length > LIMITS.unpacked) exit(`${src}: expands to more than ${LIMITS.unpacked / 2 ** 20 | 0} MiB; refused (section 15)`);
  const members = tarMembers(raw, src);
  if (members === null) {
    const name = baseId.replaceAll('/', '-') + (includes(raw, '\\documentclass') || includes(raw, '\\begin') ? '.tex' : '');
    files.push([`source/${name}`, raw]);
    return { kind: 'single', files, notes };
  }
  if (members.filter((m) => m.isFile).reduce((n, m) => n + m.size, 0) > LIMITS.unpacked) {
    exit(`${src}: its files add up to more than ${LIMITS.unpacked / 2 ** 20 | 0} MiB; refused (section 15)`);
  }
  const seen = new Set();
  for (const m of members) {
    if (m.isDir) continue;
    const logical = safeLogical(m.name);
    if (!m.isFile) {
      notes.push(`skipped ${m.isLink ? 'link' : 'special file'} ${m.name}`);
      continue;
    }
    if (logical === null) {
      notes.push(`skipped unsafe path ${m.name}`);
      continue;
    }
    if (seen.has(logical.toLowerCase())) {
      notes.push(`skipped ${m.name}: differs only in case from another file`);
      continue;
    }
    seen.add(logical.toLowerCase());
    files.push([`source/${logical}`, m.data()]);
  }
  return { kind: 'tar', files, notes };
}

export function safeLogical(name) {
  const parts = name.replaceAll('\\', '/').split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

function isPdf(data) {
  return data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46;
}

function includes(bytes, text) {
  return latin1(bytes).includes(text);
}

export function latin1(bytes) {
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return s;
}

async function inflateGzip(data, limit) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size >= limit) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return { chunks, size };
}

function* memberEnds(data) {
  yield data.length;
  for (let k = 18; k + 2 < data.length; k++) {
    if (data[k] === 0x1f && data[k + 1] === 0x8b && data[k + 2] === 0x08) yield k;
  }
}

async function firstMember(data, limit) {
  let first = null;
  for (const end of memberEnds(data)) {
    let bare = end;
    while (bare > 0 && data[bare - 1] === 0) bare--;
    for (const k of [end, ...Array.from({ length: Math.min(end - bare, 9) }, (_, j) => bare + j)]) {
      try {
        return { ...(await inflateGzip(data.subarray(0, k), limit)), used: end };
      } catch (error) {
        first ??= error;
      }
    }
  }
  throw first;
}

export async function gunzip(data, limit, src = 'data') {
  const chunks = [];
  let size = 0, rest = data;
  try {
    while (rest.length && size < limit) {
      const got = await firstMember(rest, limit - size);
      chunks.push(...got.chunks);
      size += got.size;
      let k = got.used;
      while (k < rest.length && rest[k] === 0) k++;
      rest = rest.subarray(k);
    }
  } catch (error) {
    exit(`${src}: not a gzip file (${error.message})`);
  }
  const out = new Uint8Array(Math.min(size, limit));
  let k = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.length, out.length - k));
    out.set(part, k);
    k += part.length;
    if (k >= out.length) break;
  }
  return out;
}

const TAR_FILE = ['0', '\0', '7', 'S'], TAR_LINK = ['1', '2'], GNU_TYPES = ['L', 'K', 'S'];
const TAR_KNOWN = [...TAR_FILE, ...TAR_LINK, '3', '4', '5', '6'];

function octal(field) {
  if (field[0] === 0o200 || field[0] === 0o377) {
    let n = 0;
    for (const b of field.subarray(1)) n = n * 256 + b;
    return field[0] === 0o377 ? -n : n;
  }
  const text = cString(field).trim();
  if (text && !/^[0-7]+$/.test(text)) return NaN;
  return text ? Number.parseInt(text, 8) : 0;
}

function cString(field) {
  const k = field.indexOf(0);
  return new TextDecoder().decode(k < 0 ? field : field.subarray(0, k));
}

function header(block) {
  const stored = octal(block.subarray(148, 156));
  let unsigned = 256, signed = 256;
  for (let k = 0; k < 512; k++) {
    if (k >= 148 && k < 156) continue;
    unsigned += block[k];
    signed += block[k] > 127 ? block[k] - 256 : block[k];
  }
  if (Number.isNaN(stored) || (stored !== unsigned && stored !== signed)) return null;
  return { name: cString(block.subarray(0, 100)), size: octal(block.subarray(124, 136)),
           type: String.fromCharCode(block[156]), prefix: cString(block.subarray(345, 500)) };
}

export function tarMembers(raw, src = 'data') {
  const members = [];
  let offset = 0, longName = null, pax = {};
  for (;;) {
    const block = raw.subarray(offset, offset + 512);
    if (block.length < 512 || block.every((b) => b === 0)) {
      if (offset === 0 && block.length < 512) return null;
      break;
    }
    const h = header(block);
    if (!h || Number.isNaN(h.size) || h.size < 0) {
      if (offset === 0) return null;
      break;
    }
    const start = offset + 512;
    if (h.type === 'L' || h.type === 'x' || h.type === 'g' || h.type === 'K') {
      offset = start + Math.ceil(h.size / 512) * 512;
      const body = raw.subarray(start, start + h.size);
      if (h.type === 'L') longName = cString(body);
      if (h.type === 'x') pax = paxRecords(body);
      continue;
    }
    let name = h.name;
    if (h.prefix && !GNU_TYPES.includes(h.type)) name = `${h.prefix}/${name}`;
    if (longName !== null) name = longName;
    if (pax.path !== undefined) name = pax.path;
    const size = pax.size !== undefined ? Number(pax.size) : h.size;
    longName = null;
    pax = {};
    let type = h.type;
    if (type === '\0' && name.endsWith('/')) type = '5';
    const isDir = type === '5';
    if (isDir) name = name.replace(/\/+$/, '');
    const isFile = TAR_FILE.includes(type);
    offset = start + (isFile || !TAR_KNOWN.includes(type) ? Math.ceil(size / 512) * 512 : 0);
    members.push({ name, size, isDir, isFile, isLink: TAR_LINK.includes(type),
                   data: () => {
                     if (start + size > raw.length) exit(`${src}: ${name}: unexpected end of data`);
                     return raw.slice(start, start + size);
                   } });
    if (members.length > LIMITS.members) exit(`${src}: more than ${LIMITS.members} files; refused (section 15)`);
  }
  return members;
}

function paxRecords(body) {
  const out = {};
  const text = new TextDecoder();
  for (let k = 0; k < body.length;) {
    let space = k;
    while (space < body.length && body[space] >= 0x30 && body[space] <= 0x39) space++;
    if (space === k || body[space] !== 0x20) break;
    const length = Number(text.decode(body.subarray(k, space)));
    if (length <= space - k + 1 || k + length > body.length) break;
    const record = text.decode(body.subarray(space + 1, k + length - 1));
    const equals = record.indexOf('=');
    if (equals < 0) break;
    out[record.slice(0, equals)] = record.slice(equals + 1);
    k += length;
  }
  return out;
}

export function mainTex(files) {
  const cands = [];
  for (const [logical, bytes] of files) {
    const base = logical.slice(logical.lastIndexOf('/') + 1);
    if (/\.(tex|ltx)$/i.test(logical) || !base.includes('.')) {
      const head = latin1(bytes);
      if (/(?:^|\n)[^%\n]*\\documentclass/.test(head) || /(?:^|\n)[^%\n]*\\documentstyle/.test(head)) {
        cands.push([logical.split('/').length - 1, !/\\begin\s*\{document\}/.test(head), logical]);
      }
    }
  }
  cands.sort((a, b) => a[0] - b[0] || Number(a[1]) - Number(b[1]) || compareText(a[2], b[2]));
  return cands.length ? cands[0][2] : null;
}

export async function importPaper(f, dl, where, name, { taken, report, dry, licences = {}, existing = null,
                                                         only = null, ids = {}, agreement = null }) {
  const folder = joinPath('papers', name), shown = `${where}/papers/${name}`;
  const rec = record(await dl.read(joinPath(folder, 'record.xml')), shown);
  const aid = rec.id;
  let id, present, label;
  if (existing) {
    id = existing;
    present = await archivedVersions(f, existing);
    label = f.labelOf(id) || id.split(':')[1];
  } else {
    if (!Object.hasOwn(ids, aid)) {
      exit(`${aid}: no label in identifiers.json (proposal: "${aid}": "${slug(rec.title, taken)}"); ` +
           'labels are chosen by the depositor (section 3.1)');
    }
    id = null;
    present = new Set();
    label = ids[aid];
    if (!LABEL.test(label) || label.length > 64) {
      exit(`${aid}: ${label} is not a label: ^[a-z0-9]+(-[a-z0-9]+)*$, at most 64 characters (section 3.1)`);
    }
    if (taken.has(label)) exit(`${aid}: label ${label} is taken`);
    taken.add(label);
  }
  const info = { arxiv: aid, label, id, versions: [], license: rightsOf(rec.license).rights };
  const firstDate = rec.versions[0].date.slice(0, 10);
  let docn = 0;
  if (existing) {
    const dir = await f.dirOf(existing);
    const inv = await f.inventory(dir);
    for (const v of Object.keys(inv.versions)) docn = Math.max(docn, (await f.readObjectJson(dir, inv, OBJ, v)).documentVersion);
  }
  const listed = ((await dl.list(folder)) || []).filter((e) => e.kind === 'file').map((e) => e.name);
  for (const [k, v] of rec.versions.entries()) {
    const n = k + 1, vid = v.v;
    const srcs = listed.filter((x) => x.startsWith(`${vid}-source.`)).sort(compareText);
    if (present.has(`${aid}${vid}`) || (only && !only.has(vid))) continue;
    const vinfo = { v: vid, date: v.date.slice(0, 10) };
    if (!Object.hasOwn(licences, `${aid}${vid}`)) exit(`${aid}${vid}: licence of this version unknown (run osheaf arxiv fetch)`);
    const rights = rightsOf(licences[`${aid}${vid}`].licence);
    vinfo.licence = rights.rightsUri;
    info.versions.push(vinfo);
    if (!listed.includes(`${vid}.pdf`)) {
      vinfo.error = 'not available from arXiv';
      continue;
    }
    const pdf = await dl.read(joinPath(folder, `${vid}.pdf`));
    docn += 1;

    let kind, files, notes;
    if (srcs.length) {
      ({ kind, files, notes } = await unpack(await dl.read(joinPath(folder, srcs[0])), `${shown}/${srcs[0]}`, aid));
    } else {
      [kind, files, notes] = ['pdf', [], ['source withheld on arXiv']];
    }
    Object.assign(vinfo, { kind, files: files.length, notes });
    let main = kind === 'tar' ? mainTex(files) : (files.length ? files[0][0] : null);
    let fmt;
    if (kind === 'pdf') {
      [main, fmt] = [null, null];
    } else {
      fmt = 'application/x-tex';
      if (main === null) {
        vinfo.notes.push('no main TeX file found');
        main = files[0][0];
      }
    }
    vinfo.main = main;

    const content = new Map(files);
    content.set('paper.pdf', pdf);
    const received = [[`${vid}.pdf`, pdf]];
    for (const s of srcs) received.push([s, await dl.read(joinPath(folder, s))]);
    const formats = ['application/pdf', ...(kind === 'pdf' ? [] : ['application/x-tex'])];
    const related = [{ relatedIdentifier: `arXiv:${aid}${vid}`, relatedIdentifierType: 'arXiv', relationType: 'IsIdenticalTo' },
                     { relatedIdentifier: `10.48550/arXiv.${aid}`, relatedIdentifierType: 'DOI', relationType: 'IsVersionOf' }];
    const comments = licences[`${aid}${vid}`].comments;
    if (rec.doi) {
      const published = n === rec.versions.length && comments && /published version/i.test(comments);
      for (const doi of words(rec.doi)) {
        related.push({ relatedIdentifier: doi, relatedIdentifierType: 'DOI', relationType: published ? 'IsIdenticalTo' : 'IsPreprintOf' });
      }
    }

    const texMain = fmt === 'application/x-tex' ? main : null;
    const macros = texMain ? preambleMacros(latin1(content.get(texMain))) : {};
    const title = cleanText(rec.title, macros), abstract = cleanText(rec.abstract, macros);
    const left = unknownMacros(abstract);
    if (left.length) vinfo.notes.push('macros in the abstract not defined in the source: ' + left.join(', '));
    const datacite = {
      titles: [{ title }],
      creators: rec.authors.map(creatorOf),
      publisher: { name: f.archive.name },
      publicationYear: Number(firstDate.slice(0, 4)),
      types: { resourceTypeGeneral: 'Preprint' },
      version: String(docn),
      url: id ? await landingUrl(f, id) : null,
      dates: [{ date: firstDate, dateType: 'Issued' }, { date: v.date.slice(0, 10), dateType: 'Available' }],
      language: 'en',
      formats,
      subjects: rec.categories.map((c) => ({ subject: c, subjectScheme: 'arXiv' })),
      rightsList: [rights],
      descriptions: [{ description: abstract, descriptionType: 'Abstract' }],
      relatedIdentifiers: related,
    };
    if (rec.journal) datacite.descriptions.push({ description: `Journal reference: ${rec.journal}`, descriptionType: 'SeriesInformation' });

    const owner = id ? id.split(':')[2] : f.archive.owner;
    const obj = { format: OBJ_FORMAT, specification: SPEC, kind: 'document', name: id ? id.split(':')[1] : null, owner,
                  documentVersion: docn };
    if (main) Object.assign(obj, { mainSource: main, sourceFormat: fmt });
    else obj.sourcesMissing = { text: srcs.length ? 'arXiv keeps only the PDF of this version' : 'the source of this version is withheld on arXiv' };
    obj.renditions = [{ path: 'paper.pdf', mediaType: 'application/pdf' }];
    if (comments) obj.changes = { text: cleanText(comments) };
    const described = [];
    for (const [fileName, bytes] of received) {
      described.push({ name: fileName, sha512: await sha512hex(bytes), md5: await md5hex(bytes), bytes: bytes.length });
    }
    obj.external = [{ role: 'source', service: 'arXiv', record: `https://arxiv.org/abs/${aid}${vid}`,
                      doi: `10.48550/arXiv.${aid}`, label: vid, files: described }];
    obj.status = 'active';
    if (agreement) {
      obj.agreement = { by: agreement.by?.length ? agreement.by : datacite.creators.map((c) => c.name),
                        date: f.env.today(), method: agreement.method };
    }

    if (!dry) {
      let genesis;
      if (id === null) {
        const sealed = await f.seal('document', owner);
        ({ genesis, id } = sealed);
        obj.name = id.split(':')[1];
        f.labels.set(label, id);
      }
      const dir = await f.dirOf(id);
      const inv0 = await f.inventory(dir);
      if (inv0 !== null) genesis = await f.readLogical(dir, inv0, GENESIS);
      content.set(GENESIS, genesis);
      datacite.url = await landingUrl(f, id);
      const next = inv0 ? `v${Number(inv0.head.slice(1)) + 1}` : 'v1';
      await carryForward(f, inv0 ? await f.readObjectJson(dir, inv0, OBJ) : null, obj, dir, inv0, next);
      for (const [lp, bytes] of await carriedFiles(f, dir, inv0)) if (!content.has(lp)) content.set(lp, bytes);
      content.set('datacite.json', jsonBytes(datacite));
      const done = await f.addVersion(id, content, obj, `Imported from arXiv: ${aid}${vid} of ${v.date.slice(0, 10)}`);
      await writeDiscovery(f);
      vinfo.object_version = done.head;
      if (n === rec.versions.length && (await f.storage.kind(`site/${label}`)) === 'dir') await removeFolder(f.storage, `site/${label}`);
    }
  }
  info.id = id;
  report.push(info);
  const kinds = info.versions.map((x) => x.kind ?? '?').join(',');
  f.env.out(`${aid.padStart(18)}  ${label}  ${id || '(a new line)'}  [${kinds}]`);
}

export async function importCommand(f, dl, where, a) {
  if (a.texmacs?.length) {
    exit('--texmacs: TeXmacs sources are imported, and their HTML version typeset, by opensheaf-py (osheaf arxiv ' +
         'import of opensheaf-py); opensheaf-js imports the sources arXiv has');
  }
  if (a.agreedBy?.length && !a.agreement) exit('--agreed-by needs --agreement');
  const agreement = a.agreement ? { method: a.agreement, by: a.agreedBy?.length ? a.agreedBy : null } : null;
  await f.initStorageRoot();
  const licences = await jsonOf(dl, 'version-licences.json', `${where}/version-licences.json`);
  const ids = a.identifiers ? a.identifiers : await jsonOf(dl, 'identifiers.json', `${where}/identifiers.json`);
  const done = await alreadyArchived(f);
  const asked = a.ids || [];
  if (a.rebuild) {
    if (!asked.length) exit('--rebuild needs the arXiv identifiers');
    for (const i of asked) {
      const obj = done.get(i);
      done.delete(i);
      if (obj) {
        const label = f.labelOf(obj);
        await removeFolder(f.storage, await f.dirOf(obj));
        if (label) {
          f.labels.delete(label);
          if (await f.storage.kind(`site/${label}`)) await removeFolder(f.storage, `site/${label}`);
        }
        f.changed();
        f.env.out(`${i.padStart(18)}  removed ${obj}`);
      }
    }
    await writeDiscovery(f);
  }
  for (const [aid, label] of Object.entries(ids).sort(([x], [y]) => compareText(x, y))) {
    if (f.labels.has(label) && done.has(aid) && done.get(aid) !== f.labels.get(label)) {
      exit(`${aid}: identifiers.json gives the label ${label}, but the paper is in the archive as ` +
           `${f.labelOf(done.get(aid)) || done.get(aid)}`);
    }
    if (f.labels.has(label) && !done.has(aid)) {
      if (asked.length && !asked.includes(aid)) continue;
      exit(`${aid}: the label ${label} is that of a line not related to this arXiv paper; choose another label in identifiers.json`);
    }
  }
  const taken = new Set(f.labels.keys());
  const folders = asked.length ? asked.map((i) => i.replaceAll('/', '_'))
    : ((await dl.list('papers')) || []).filter((e) => e.kind === 'dir').map((e) => e.name).sort(compareText);
  const recs = [];
  for (const name of folders) {
    const bytes = await dl.read(joinPath('papers', name, 'record.xml'));
    if (bytes === null) continue;
    const r = record(bytes, `${where}/papers/${name}`);
    if (done.has(r.id)) {
      if (a.update) recs.push([r.versions[0].date, name, done.get(r.id)]);
      else f.env.out(`${r.id.padStart(18)}  skipped: already archived as ${f.labelOf(done.get(r.id)) || done.get(r.id)} (--update adds new versions)`);
      continue;
    }
    recs.push([r.versions[0].date, name, null]);
  }
  recs.sort((x, y) => compareText(x[0], y[0]) || compareText(`${where}/papers/${x[1]}`, `${where}/papers/${y[1]}`));
  const report = [];
  for (const [, name, existing] of recs) {
    await importPaper(f, dl, where, name, { taken, report, dry: Boolean(a.dryRun), licences, existing,
                                             only: a.versions ? new Set(a.versions.split(',')) : null, ids, agreement });
  }
  const file = 'import-report' + (a.dryRun ? '-dry' : '') + (asked.length ? '-partial' : '') + '.json';
  await dl.write(file, jsonBytes(report));
}

async function jsonOf(storage, name, shown) {
  const bytes = await storage.read(name);
  if (bytes === null) exit(`no file ${shown}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const UA = { 'User-Agent': 'opensheaf-js (https://github.com/opensheaf/opensheaf-js)' };

export class HttpError extends Error {}

export function politeGetter({ fetch = globalThis.fetch?.bind(globalThis), wait = 3000,
                               sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  let last = -Infinity;
  return async (url) => {
    const left = wait - (now() - last);
    if (left > 0) await sleep(left);
    for (let attempt = 0; attempt < 4; attempt++) {
      last = now();
      try {
        const r = await fetch(url, { headers: UA });
        if (r.ok) return new Uint8Array(await r.arrayBuffer());
        await r.body?.cancel();
        if (r.status === 403 || r.status === 404) throw new HttpError(`HTTP Error ${r.status}: ${r.statusText}`);
      } catch (error) {
        if (error instanceof HttpError) throw error;
      }
      await sleep(15000 * (attempt + 1));
    }
    throw new Error('giving up on ' + url);
  };
}

export async function sourceKind(data) {
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return 'pdf';
  if (data[0] === 0x1f && data[1] === 0x8b) {
    let block;
    try {
      block = await gunzip(data, 512);
    } catch {
      return 'gz';
    }
    return block.length === 512 && !block.every((b) => b === 0) && header(block) ? 'tar.gz' : 'gz';
  }
  return 'bin';
}

export async function authorPapers(get, author) {
  const feed = new TextDecoder().decode(await get(`https://arxiv.org/a/${author}.atom2`));
  const out = [];
  for (const e of feed.matchAll(/<(?:[A-Za-z_][\w.-]*:)?entry(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?entry\s*>/g)) {
    const id = /<(?:[A-Za-z_][\w.-]*:)?id(?:\s[^>]*)?>([\s\S]*?)<\//.exec(e[1]);
    const text = xmlText(id ? id[1] : '');
    out.push(text.slice(text.lastIndexOf('/abs/') + 5).replace(/v\d+$/, ''));
  }
  return out;
}

export async function fetchPapers(dl, ids, { get, refresh = false, out = console.log, now = () => new Date() }) {
  const log = (await readJsonOf(dl, 'download.json')) ?? {};
  const info = (await readJsonOf(dl, 'version-licences.json')) ?? {};
  for (const [k, aid] of ids.entries()) {
    const d = joinPath('papers', aid.replaceAll('/', '_'));
    if (refresh || (await dl.kind(joinPath(d, 'record.xml'))) !== 'file') {
      await dl.write(joinPath(d, 'record.xml'), await get('https://oaipmh.arxiv.org/oai?verb=GetRecord&identifier=' +
                                                        `oai:arXiv.org:${aid}&metadataPrefix=arXivRaw`));
    }
    const text = new TextDecoder().decode(await dl.read(joinPath(d, 'record.xml')));
    const versions = [...text.matchAll(/<version version="(v\d+)">/g)].map((m) => m[1]);
    out(`[${k + 1}/${ids.length}] ${aid}: ${versions.join(', ')}`);
    const entry = (log[aid] ??= {});
    for (const v of versions) {
      for (const [what, url] of [['pdf', `https://export.arxiv.org/pdf/${aid}${v}`], ['src', `https://export.arxiv.org/e-print/${aid}${v}`]]) {
        const key = `${v}.${what}`;
        if (key in entry && entry[key].file && (await dl.kind(joinPath(d, entry[key].file))) === 'file') continue;
        let data;
        try {
          data = await get(url);
        } catch (error) {
          entry[key] = { error: error.message, url };
          out(`    ${key} ERROR ${error.message}`);
          continue;
        }
        const name = what === 'pdf' ? `${v}.pdf` : `${v}-source.${await sourceKind(data)}`;
        await dl.write(joinPath(d, name), data);
        entry[key] = { file: name, url, bytes: data.length, sha256: await sha256hex(data), fetched: isoSeconds(now()) };
        await dl.write('download.json', jsonBytes(log));
      }
      const kv = aid + v;
      if (!(kv in info && 'comments' in info[kv] && info[kv].licence)) {
        const page = new TextDecoder().decode(await get(`https://arxiv.org/abs/${kv}`));
        const m = /class="abs-license"[^>]*>\s*<a[^>]*href="([^"]+)"/.exec(page) ||
          /href="(https?:\/\/(?:creativecommons\.org\/(?:licenses|publicdomain)\/[^"]+|arxiv\.org\/licenses\/[^"]+))"/.exec(page);
        const c = /<td class="tablecell comments[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(page);
        let comments = null;
        if (c) {
          const body = c[1].replace(/<a [^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/g, (x, href) => href);
          comments = words(htmlUnescape(body.replace(/<[^>]+>/g, ''))).join(' ');
        }
        info[kv] = { licence: m ? m[1] : null, comments };
        await dl.write('version-licences.json', jsonBytes(info));
      }
    }
  }
  const errs = Object.entries(log).flatMap(([a, e]) => Object.entries(e).filter(([, x]) => 'error' in x).map(([key]) => [a, key]));
  out(`done; ${errs.length} errors [${errs.map(([a, key]) => `('${a}', '${key}')`).join(', ')}]`);
}

async function readJsonOf(storage, name) {
  const bytes = await storage.read(name);
  return bytes === null ? null : JSON.parse(new TextDecoder().decode(bytes));
}

function isoSeconds(date) {
  return date.toISOString().replace(/\.\d+Z$/, '+00:00');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
                   hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', eacute: 'é',
                   egrave: 'è', agrave: 'à', ouml: 'ö', uuml: 'ü', auml: 'ä', szlig: 'ß',
                   ccedil: 'ç', times: '×', copy: '©', middot: '·' };

export function htmlUnescape(s) {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '�';
    }
    return Object.hasOwn(ENTITIES, e) ? ENTITIES[e] : m;
  });
}
