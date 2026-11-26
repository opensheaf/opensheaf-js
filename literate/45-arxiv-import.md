Importing from arXiv: the signed versions
=========================================

`osheaf arxiv import` turns the downloads of chapter [43](43-arxiv.md)
into lines of the archive, with the metadata of chapter
[44](44-arxiv-metadata.md), as opensheaf-py's chapter
[42-arxiv-import](https://opensheaf.org/opensheaf-py/42-arxiv-import.html)
does: each paper becomes one line of the archive's owner, sealed at its
first import as `deposit --new` seals one (section 10.2), and each arXiv
version one object version of that line, added and signed by
`addVersion` (chapter [23](23-folder.md)), each after the first naming
the inventory before it, `previous` (section 4.3). The rules are the
specification's, which opensheaf-py's chapter sets out: the PDF and the
sources are arXiv's, byte for byte, and named with their digests in
`object.json` under `external`; document versions are numbered without
gaps; a version for which arXiv has only a PDF has `sourcesMissing`;
each version `IsIdenticalTo` its arXiv version and `IsVersionOf` the
paper's arXiv DOI.

The downloads are read through a storage (chapter [20](20-storage.md)),
like the archive: the command line gives the folder on the disk, and the
tests a folder or memory. `where` is the folder as the person named it,
for the messages.

Papers already in the archive
-----------------------------

A paper is in the archive when some version of a document line of the
archive's owners relates to it, by its arXiv identifier or its arXiv
DOI, or was imported from it (an `external` record of arXiv); copies of
other owners' lines and drafts do not count. The answer maps arXiv
identifiers to lines.

    // in arXiv: papers already in the archive:
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

A new paper without a label in `identifiers.json` stops the import with
a proposal: the first words of its title, at most 56 characters, in lower
case ASCII, numbered if taken.

    // in arXiv: proposing a label from the title:
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

The sources
-----------

### Unpacking an e-print

An e-print is a PDF, a gzipped tar archive or a single gzipped file. A
PDF gives no sources; a single file is named after the paper, with
`.tex` if it looks like TeX; the files of a tar archive go under
`source/`, in their folders. The archive is untrusted (section 15): only
regular files are taken, links and devices are noted, a path with `..`
is refused and a leading `/` dropped, a path equal to one taken in NFC
and lower case (in case only, or in Unicode normalisation, which collide
on macOS) is skipped, and so is a file of the name of a folder taken, or
a file under a file taken, each with a note; and the archive is refused as a whole if it
expands to more than `MAX_UNPACKED` bytes (1 GiB) or has more than
`MAX_MEMBERS` members (10000), or if the sizes its files declare add up
to more, before anything is kept. The limits are those of opensheaf-py,
and the tests lower them as opensheaf-py's do.

The files are kept in memory, not written to a temporary folder as
opensheaf-py writes them: a storage takes bytes.

    // in arXiv: unpacking an e-print:
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
      const seen = new Set(), folders = new Set();
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
        const key = logical.normalize('NFC').toLowerCase();
        if (seen.has(key)) {
          notes.push(`skipped ${m.name}: differs only in case or Unicode normalisation from another file`);
          continue;
        }
        const parts = key.split('/');
        const parents = parts.slice(1).map((_, k) => parts.slice(0, k + 1).join('/'));
        if (folders.has(key) || parents.some((x) => seen.has(x))) {
          notes.push(`skipped ${m.name}: a file and a folder of the same name`);
          continue;
        }
        seen.add(key);
        for (const x of parents) folders.add(x);
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

Bytes are read as Latin-1, as opensheaf-py reads TeX files to look into
them: each byte one character. (`TextDecoder('latin1')` would not do: the
standard makes it Windows-1252, which reads the bytes 0x80 to 0x9F
otherwise.)

    // in arXiv: unpacking an e-print:
    export function latin1(bytes) {
      let s = '';
      for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
      return s;
    }

Decompression uses `DecompressionStream`, which browsers, Deno and Node
all have, read up to the limit and no further, so that a few kilobytes
of gzip cannot fill the memory. What is not gzip stops the import, where
opensheaf-py stops with Python's error.

Python's `gzip` reads several members one after the other, as one
stream, and skips zero bytes after a member (padding to a block); what
else follows a member must be another. `DecompressionStream` refuses
anything after the first member, and does not say where it ended. So
when the whole is refused, the end of the first member is looked for:
at each later place where a gzip header (`1f 8b 08`) starts, the bytes
before it, and then those bytes without the zeros that end them (the
eight bytes of the trailer, CRC-32 and size, may end with zeros too, so
each length up to eight more is tried), are decompressed alone; the
first that decompresses whole is the member, and the rest is read the
same way, after its leading zeros. A member never ends elsewhere, since
`DecompressionStream` checks the CRC-32 and the size of each.

    // in arXiv: unpacking an e-print:
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
        exit(`${src}: neither a PDF nor a gzip file (${error.message}); refused`);
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

### Tar archives

A tar archive is read as Python's `tarfile` reads it in the mode `r:`
(uncompressed, so that a compressed archive inside the gzip stays one
file): blocks of 512 bytes, each member a header and its data. The data
are not a tar archive when the first header is missing, short, or has a
wrong checksum (`tarfile` then raises, and opensheaf-py keeps the data as
a single file); a block of zeros ends the archive, and so does a later
header that is not one. The data of a regular file, or of a member of a
type `tarfile` does not know, follow its header; links, folders and
devices have none. Names are those of the header, with the `prefix`
of the POSIX format, the long names of GNU (`L`) and the `path` of pax
headers (`x`), as `tarfile` gives them (the length that starts a pax
record counts bytes, so the records are cut from the bytes before they
are decoded); a directory loses its trailing
slashes, and an old regular file whose name ends with a slash is a
directory. The members are counted as they are read, and the archive
refused past `MAX_MEMBERS`. A file whose data the archive cuts short is
listed, and refused when it is read, as `tarfile` raises `ReadError`
(unexpected end of data) then, rather than imported short.

    // in arXiv: unpacking an e-print:
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

### The main TeX file

`object.json` names the main source, which arXiv works out without
saying which it is; we guess as arXiv does: a TeX file (or a file without
extension) with a `\documentclass` or `\documentstyle` not commented out,
nearer the top first, then one with `\begin{document}`, then the first by
name. The lines are those ending with `\n` only, as Python's `re.M` reads
them: a line start is matched explicitly, since JavaScript's `m` flag
would also start lines after a lone `\r`.

    // in arXiv: finding the main TeX file:
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

Importing a paper
-----------------

`importPaper` imports the versions of one paper: it finds its line, or
the label of a new one, then goes through arXiv's versions in order, and
for each one gathers the files, writes `datacite.json` and `object.json`,
and adds the object version, signed; the first seals the line. What it
did goes into the report, one entry per version, and one line is printed
per paper.

The TeXmacs sources found in the authors' files (`--texmacs`) are not
imported here: the import of opensheaf-py typesets the HTML version of
such a document with TeXmacs, which this program does not run (chapter
[00](00-plan.md)). The command refuses the option, and says to use
opensheaf-py; what follows is the import of arXiv's own sources.

    // in arXiv: importing a paper:
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
        <<arXiv: one version>>
      }
      info.id = id;
      report.push(info);
      const kinds = info.versions.map((x) => x.kind ?? '?').join(',');
      f.env.out(`${aid.padStart(18)}  ${label}  ${id || '(a new line)'}  [${kinds}]`);
    }

### Each version

A version is skipped when the line has it, or when `--versions` leaves it
out. Its licence must be known; a version whose PDF could not be
downloaded is reported, and takes no document version number.

    // in arXiv: one version:
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

The sources, unpacked; a version without an e-print is one whose source
arXiv withholds. The main source and its format follow from the kind of
source; when no main TeX file is found, the first file stands in for it,
and the report says so.

    // in arXiv: one version:
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

The content is the sources and arXiv's PDF as `paper.pdf`; the files
received are the PDF and the e-print as downloaded. The relations: the
version is identical to arXiv's and a version of the paper's arXiv DOI;
if the authors gave the DOI of the published article, each version is a
preprint of it, except the last when its comments say it is the
published version.

    // in arXiv: one version:
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

The title and the abstract, with the macros of the preamble of the main
TeX file; those that remain unknown go into the report. Then
`datacite.json` (section 4.4): a `Preprint`, issued on the date of the
first arXiv version and available on that of this one, arXiv's
categories as subjects, the journal reference as `SeriesInformation`, and
the paper's landing page in this archive as `url`.

    // in arXiv: one version:
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

`object.json` names the line (its name is filled in when the first version
seals it), the main source or why there is none, arXiv's comments as the
change note, and in `external` where the version comes from, with arXiv's
label and the files received, with their SHA-512 and MD5; and the
agreement under which it is deposited, with `--agreement`.

    // in arXiv: one version:
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

Unless the run is a dry run, the version is added. The first version of a
new paper seals its line, with a new genesis record of a document of the
archive's owner; later versions carry the genesis record. What later
versions must keep (the history, the notices and their files) is carried
forward, and the discovery document is written at once, since it keeps
the label. After the last version, an HTML version of a TeXmacs document
left from before is removed: the head now has arXiv's sources, and an
HTML version is made only from a TeXmacs source.

    // in arXiv: one version:
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

The command
-----------

`osheaf arxiv import DOWNLOADS [ARXIV-ID ...]` imports the papers of the
downloads folder, or those named, in the order of their first submission
to arXiv. Papers already in the archive are skipped, or get their new
versions with `--update`. A label of `identifiers.json` that is already
the label of a line must name the paper's own line; otherwise the import
stops. `--rebuild` first deletes the lines of the named papers, their
labels and their HTML, without a tombstone: only for an archive not yet
published (opensheaf-py's chapter explains why). The report,
`import-report.json` (with `-dry` and `-partial` for dry runs and runs on
some papers), is written into the downloads folder. The files the
import reads (the downloads folder, its `version-licences.json`, the
identifiers) are checked before the archive is touched, as opensheaf-py
checks them: a file missing says what it should be, one that is not JSON
says so.

    // in arXiv: the import command:
    export async function importCommand(f, dl, where, a) {
      if (a.texmacs?.length) {
        exit('--texmacs: TeXmacs sources are imported, and their HTML version typeset, by opensheaf-py (osheaf arxiv ' +
             'import of opensheaf-py); opensheaf-js imports the sources arXiv has');
      }
      if (a.agreedBy?.length && !a.agreement) exit('--agreed-by needs --agreement');
      const agreement = a.agreement ? { method: a.agreement, by: a.agreedBy?.length ? a.agreedBy : null } : null;
      if ((await dl.list('')) === null) exit(`${where}: not a folder (the folder of osheaf arxiv fetch)`);
      const licences = await jsonOf(dl, 'version-licences.json', `${where}/version-licences.json`,
                                    'DOWNLOADS is the folder written by osheaf arxiv fetch');
      const ids = a.identifiers ? a.identifiers : await jsonOf(dl, 'identifiers.json', `${where}/identifiers.json`,
                                                              IDENTIFIERS_HELP);
      await f.initStorageRoot();
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

    export const IDENTIFIERS_HELP = 'write it, arXiv identifier -> label of the line, or give --identifiers';

    async function jsonOf(storage, name, shown, what) {
      const bytes = await storage.read(name);
      if (bytes === null) exit(`${shown}: not found: ${what}`);
      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch (error) {
        exit(`${shown}: not read: ${error.message}`);
      }
    }
