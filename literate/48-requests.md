The requests of a page
======================

An archive made from the [archive
template](https://github.com/opensheaf/archive-template) is kept by
forms: the issue forms of its repository, and the
[Manager](https://manager.opensheaf.org/), whose forms have the same
fields. Until this phase, every form became a **request** that the
archive's workflow carried out with opensheaf-py, through the template's
script `.github/scripts/osheaf_issue.py`: it reads the fields, checks
them, runs `osheaf` (a deposit, a notice, a collection's members written
to `collections/LABEL.yaml` and synced, the collections that include a
changed one brought up to date), then `osheaf collect`, `osheaf index`
and `osheaf verify`, and answers in Markdown.

This chapter is that script in JavaScript, so that the Manager carries
a request out itself, in the browser, on a storage over GitHub (chapter
[47](47-github-storage.md)), and commits the result: the same fields,
the same checks and messages, the same commands in the same order, the
same files. It is a port as the rest of this program is, and opensheaf-py
with the template's script is its reference: the tests of chapter
[76](76-tests-github.md) run both on copies of one archive and compare
the files.

The operations carried out here are those of documents and collections:
`deposit`, `notice`, `withdraw`, `relicense`, `new_collection`, `add`,
`vet`, `remove`; and `setup`, which makes the archive (`osheaf init` with
an owner that exists already, whose key log is given), for the Manager,
which makes the owner in the page (chapter [49](49-manager.md)). One stays
with the archive's workflow: `arxiv`, since arXiv sends no CORS headers
and a browser cannot read it (chapter [00](00-plan.md)).

The module is `core/requests.js`.

    // in core/requests.js:
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

    <<the forms and their fields>>

    <<the archive, its lines and its collections>>

    <<members of collections>>

    <<running the commands>>

    <<attachments>>

    <<the operations>>

    <<carrying a request out>>

The forms and their fields
--------------------------

A request is an operation and the fields of its form, by their labels
(`Label`, `PDF of this version`, ...), with the files attached to some of
them: `{ label: [{ name, bytes }] }`. An error the author can fix is a
`Problem`, explained in plain words; nothing is committed then.

    // in the forms and their fields:
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

The fields, read as the script reads them: trimmed; lines of a text,
without the links that an issue form makes of attached files; a label;
the address of an archive; document versions; a position; a date; a
licence, from the choices of the forms.

    // in the forms and their fields:
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

The archive, its lines and its collections
------------------------------------------

What the script reads of the archive, read here from the storage: the
configuration, the lines of the discovery document by their labels, the
files of collections (`collections/LABEL.yaml`, YAML 1.1 as PyYAML reads
it), and a file of the head version of a line.

    // in the archive, its lines and its collections:
    const COLLECTIONS = 'collections';
    const listPath = (label) => `${COLLECTIONS}/${label}.yaml`;

    async function settings(r) {
      return readJson(r.storage, 'osheaf.json');
    }

    async function labels(r) {
      const disc = (await readJson(r.storage, 'opensheaf.json')) || {};
      return new Map((disc.objects || []).filter((o) => o.label).map((o) => [o.label, o]));
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

A collection's file is written as PyYAML's `safe_dump` writes it (keys in
their order, Unicode as it is, lines up to 200 characters), after the
header: the `yaml` package, with the schema of YAML 1.1, sequences not
indented under their keys, single quotes, and no block scalars, writes
the same text for the members, titles and descriptions of collections
(the tests compare them).

    // in the archive, its lines and its collections:
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

Members of collections
----------------------

A member is written in a collection's file as `{label: L}` (a line of
this archive) or `{uri: sheaf:<name>:<owner>, at: [URL, ...]}` (a line
of any archive), and known by its name and owner. A member named by a
label of another archive is looked up in that archive's discovery
document, read with the `fetch` of the environment.

    // in members of collections:
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

Collections inside collections: the members of a collection that are
collections of this archive, all those below it, and the collections
that hold it.

    // in members of collections:
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

Running the commands
--------------------

The script runs `osheaf` once per command, a new process each time: the
archive is read afresh, and the website written again after a command
that changes the archive. Here a command is a function of the core run
on an archive folder opened afresh on the same storage, followed by the
presentation, as the command line does (chapter [40](40-cli.md)). What a
command says is collected; the lines that name an object version added
(`kpz: v3 (document version 2) sheaf:...`) make the body of the commit
message, as the git companion asks (its section 6.1). A command that
stops becomes a `Problem`, with its message.

    // in running the commands:
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

A collection that includes a changed collection is brought up to date in
turn: a selection vets the new version (the same curator made it), a
catalogue follows it.

    // in running the commands:
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

Attachments
-----------

The files of a field, named as the Manager names them in a request (a
safe name, made unique by a number). The sources are one file, several
files and the name of the main one, or a zip: unpacked safely (no
absolute path, no `..`, no system files of macOS), and, when everything
is in one folder, from inside it.

    // in attachments:
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

### Reading a zip

Zip archives are read here, with what all three runtimes have: the
central directory, then each member, stored or compressed with deflate
(`DecompressionStream`). A member that is encrypted, or in ZIP64, is
refused; a name not in UTF-8 is read as UTF-8 with replacement
characters. The paths are those of Python's `zipfile` for the script:
`.` segments and doubled slashes left out.

    // in attachments:
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

The operations
--------------

Each returns the collection it changed (or `''`), the subject of the
commit, the title of the request, and what was done. A deposit: a new
paper or a new version, its PDF, its sources (or why there are none), its
description; the title and the authors of a new version may be left
empty, and are then those of the current version.

    // in the operations:
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
      await osheaf(r, (f) => deposit(f, a));
      const where = await place(r, form, cid, label);
      const kind = fresh ? 'new paper' : 'new version';
      return [cid, `Deposit ${label}, ${kind}${where} (${origin})`, `Deposit: ${label}`,
              `\`${label}\` was deposited (${kind})${where}`];
    }

A document deposited into a collection is added to it, or, in a
selection where it is already, its new version is vetted.

    // in the operations:
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

Notices, withdrawals and new licences: description-only versions
(chapter [29](29-description.md)).

    // in the operations:
    async function noticeOp(r, form, origin) {
      const label = labelField(form, 'Label');
      await knownDocument(r, label);
      const about = field(form, 'Document version it is about', true);
      if (!/^\d+$/.test(about)) throw new Problem(`**Document version it is about** should be a number (1, 2, ...), not \`${about}\`.`);
      const text = field(form, 'Text of the notice', true);
      const files = attached(form, 'Full statement (optional)');
      await osheaf(r, (f) => notice(f, { label, about: Number(about), text, file: files[0] || null,
                                         message: `Notice from ${origin}` }));
      return ['', `Notice about ${label}, version ${about} (${origin})`, `Notice: ${label}, version ${about}`,
              `\`${label}\` was given a notice`];
    }

    async function withdrawOp(r, form, origin) {
      const label = labelField(form, 'Label');
      await knownDocument(r, label);
      const reason = field(form, 'Reason for the withdrawal', true);
      await osheaf(r, (f) => withdraw(f, { label, reason, file: null, message: `Withdrawal from ${origin}` }));
      return ['', `Withdraw ${label} (${origin})`, `Withdrawal: ${label}`, `\`${label}\` was withdrawn (its files stay in the archive)`];
    }

    async function relicenseOp(r, form, origin) {
      const label = labelField(form, 'Label');
      await knownDocument(r, label);
      const rights = licence(form, 'New licence');
      if (!LICENCES.has(rights)) throw new Problem('Choose the new licence in the field **New licence**.');
      const method = field(form, 'How the authors agreed', true);
      await osheaf(r, (f) => relicense(f, { label, rights, method, message: `New licence from ${origin}` }));
      return ['', `Relicense ${label} as ${rights} (${origin})`, `Licence: ${label}, ${rights}`,
              `\`${label}\` was relicensed as ${rights}`];
    }

Collections: a new one (its file written, then synced; featured on the
home page if asked; placed in another collection if named), a member
added, versions of a member of a selection vetted, a member removed. The
collection changed is then synced by the end of the request.

    // in the operations:
    async function makeCollection(r, label, title, kind, description, message) {
      const data = { title };
      if (description) data.description = description;
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
      if ((await exists(r, listPath(label))) || (await labels(r)).has(label) || label === (await settings(r)).mainCollection) {
        throw new Problem(`\`${label}\` is already taken in this archive.`);
      }
      const title = field(form, 'Title of the collection', true);
      const kind = field(form, 'Kind').toLowerCase().startsWith('catalogue') ? 'catalogue' : 'selection';
      const parent = await collection(r, form, false);
      await makeCollection(r, label, title, kind, field(form, 'Description'), `New collection ${label} (${origin})`);
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
      const data = await load(r, cid);
      const [entry, key, text] = await memberRef(r, form, 'New member', 'Archive of the new member');
      const revisions = versions(form, 'Versions you vet (selection)');
      for (const m of data.members) if ((await entryKey(r, m)) === key) throw new Problem(`${text} is already a member of \`${cid}\`.`);
      const own = entry.label;
      if (own && (own === (await settings(r)).mainCollection || own === cid ||
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
      const data = await load(r, cid);
      const [, key, text] = await memberRef(r, form, 'Member to remove', 'Archive of the member');
      const member = await find(r, data, key, text);
      data.members.splice(data.members.indexOf(member), 1);
      await save(r, cid, data);
      return [cid, `Remove ${text.replaceAll('`', '')} from ${cid} (${origin})`, `Member removed from ${cid}`,
              `${text} was removed from \`${cid}\``];
    }

The setup: `osheaf init` with the owner whose key log is given, as the
script's `setup` runs it for the workflow "Set up the archive" and for a
page's request. The base URL is the one given in the form (an address of
a site: https, ending with `/`), or else the one GitHub Pages will serve
the site at; the script asks GitHub's API for it, and a page that asks it
the same way (the Manager's `load.js`) gives it to `carryOut` as
`defaultBase`, a function that gives `{ url, rule }`. The key log is the
folder of the owner object: a zip attached to the request, or the key log
the page made (`keyLog`, `{ storage, dir }`), or the folder `key-log/` of
the repository, which is removed once the key log is in the storage root.
For a selection or a catalogue, its collection is created, with the
archive's name for its title and a label made from it, and featured on
the home page.

    // in the operations:
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
      if ((await r.storage.kind(KEY_LOG)) === 'dir') await removeTree(r.storage, KEY_LOG);
      const purpose = field(form, 'Purpose').toLowerCase() || 'papers';
      let done;
      if (purpose === 'selection' || purpose === 'catalogue') {
        let label = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
          .replace(/^-+|-+$/g, '') || 'collection';
        if (label === (await settings(r)).mainCollection) label += '-collection';
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

Carrying a request out
----------------------

The request on a storage, with an environment of the core (chapter
[23](23-folder.md)) whose key store holds the current keys that sign:
the operation, the reason given (`Why (optional)`) added to the subject,
`osheaf collect`, the collection changed synced and the collections
above it brought up to date, `osheaf index`, and `osheaf verify`. The
verification reads every file of the archive with `digests` (as the
script's `osheaf verify` does); without, it trusts the content files to
match their inventories, which a storage over GitHub may (its blobs are
named by their content), and reads only the inventories, descriptions,
signatures and key logs. For the setup, `keyLog` and `defaultBase` are
those of the setup above.

The answer: `ok`, the message for the person (Markdown), and, when it is
done, the commit message (the subject, then the object versions added),
the title, and what the commands said. A `Problem` is an answer, not an
exception: the storage is then left uncommitted, and the person corrects
the form.

    // in carrying a request out:
    export async function carryOut(storage, env, operation, fields, files = {}, { origin = 'the OpenSheaf manager',
                                                                                  schemas = null, digests = true,
                                                                                  keyLog = null, defaultBase = null } = {}) {
      const said = [];
      const r = {
        storage, said, added: [], keyLog, defaultBase,
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
        let [cid, message, title, done] = await op(r, form, origin);
        const why = field(form, 'Why (optional)');
        if (why) message += `: ${why}`;
        await osheaf(r, (f) => collect(f, {}));
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
