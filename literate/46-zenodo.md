Zenodo: DOIs for document versions
==================================

An OpenSheaf archive is a set of static files, and cannot register DOIs.
Zenodo registers DataCite DOIs for what is deposited with it, and keeps
the files. Appendix A.1 of the specification binds the two: each line of
a document is one Zenodo record, whose concept DOI stands for the line,
each document version a version of that record, with its own DOI, and the
archive records the DOI in a new object version of the line, signed by
its owner. This chapter is opensheaf-py's chapter
[50-zenodo](https://opensheaf.org/opensheaf-py/50-zenodo.html) in
JavaScript, whose reasons it keeps short: the same command, the same
requests to Zenodo, the same object versions, the same messages.

```
osheaf zenodo LABEL                  try it on the Zenodo sandbox, on a copy
osheaf zenodo LABEL --production     deposit on zenodo.org and add the version
```

**On the command line only.** Zenodo's API sends no CORS headers for
deposits, and asks for a token that a page should not hold; the module
is in the core, since it needs only the storage of an archive and a
`fetch`, but the command line is what gives it the token and the fetch.

The module is `core/zenodo.js`.

    // in core/zenodo.js:
    import { pathOf, LAYOUT_FILE } from './paths.js';
    import { validate } from './schema.js';
    import { dateOf, currentVersion, historyOf } from './versions.js';
    import { CONTESTED } from './signatures.js';
    import { jsonBytes, md5hex, sha512hex } from './write.js';
    import { joinPath, readJson, compareText, MemoryStorage } from './storage.js';
    import { ArchiveFolder, OBJ, OBJ_FORMAT, exit, removeStage } from './folder.js';
    import { carryForward, setDate, landingUrl } from './deposit.js';
    import { lineOf } from './describe.js';
    import { writeDiscovery } from './discovery.js';
    import { signAgain } from './owner.js';

    <<Zenodo: the production and sandbox services>>

    <<Zenodo: talking to the API>>

    <<Zenodo: deposit metadata from datacite.json>>

    <<Zenodo: deposits recorded in object.json>>

    <<Zenodo: a reproducible sources.zip>>

    <<Zenodo: what is uploaded>>

    <<Zenodo: files of notices>>

    <<Zenodo: the record of the version before>>

    <<Zenodo: committing the deposit>>

    <<Zenodo: the checks of a deposit record>>

    <<Zenodo: depositing a document version>>

    <<Zenodo: sandbox or production>>

Sandbox and production
----------------------

Zenodo's sandbox, `sandbox.zenodo.org`, registers test DOIs, with the
prefix `10.5072`, which do not resolve; production DOIs have the prefix
`10.5281`. The two have separate accounts and tokens, each stored under
a name, or given in an environment variable.

    // in Zenodo: the production and sandbox services:
    export const SERVICES = {
      false: { api: 'https://sandbox.zenodo.org/api', records: 'https://sandbox.zenodo.org/records/',
               token: 'zenodo-sandbox-token', env: 'ZENODO_SANDBOX_TOKEN', prefix: '10.5072' },
      true: { api: 'https://zenodo.org/api', records: 'https://zenodo.org/records/',
              token: 'zenodo-token', env: 'ZENODO_TOKEN', prefix: '10.5281' },
    };
    export const SERVICE_NAME = 'Zenodo';
    export const MAX_FILES = 100;
    export const METADATA_FILES = ['datacite.json', 'object.json'];

The API
-------

Zenodo's REST API for deposits: requests and answers in JSON, except
uploads, which send the bytes of a file. An answer that is an error
becomes an error with Zenodo's explanation. The token is found by the
command line (chapter [40](40-cli.md)): `ZENODO_TOKEN` or
`ZENODO_SANDBOX_TOKEN`, then, on macOS, the keychain through `security`,
under the name `zenodo-token` or `zenodo-sandbox-token`. `api` replaces
the address of the API (`OPENSHEAF_ZENODO_API`, for a double of Zenodo);
the addresses of the records recorded in `object.json` stay Zenodo's.

    // in Zenodo: talking to the API:
    export class ZenodoError extends Error {}

    export class Zenodo {
      constructor({ production, token, fetch = globalThis.fetch?.bind(globalThis), api = null }) {
        this.production = production;
        this.s = { ...SERVICES[production] };
        if (api) this.s.api = api.replace(/\/+$/, '');
        if (!token) exit(`no Zenodo token: set ${this.s.env}, or store it under the name ${this.s.token} (see osheaf zenodo --help)`);
        this.token = token;
        this.fetch = fetch;
      }

      async call(method, url, data = null, raw = null) {
        if (!url.startsWith('http')) url = this.s.api + url;
        const body = raw !== null ? raw : (data !== null ? JSON.stringify(data) : undefined);
        const r = await this.fetch(url, { method, body, headers: {
          Authorization: `Bearer ${this.token}`, 'Content-Type': raw !== null ? 'application/octet-stream' : 'application/json',
          Accept: 'application/json' } });
        const text = await r.text();
        if (!r.ok) throw new ZenodoError(`Zenodo ${method} ${url}: ${r.status} ${text.slice(0, 1000)}`);
        return text ? JSON.parse(text) : null;
      }

      doi(recid) {
        return `${this.s.prefix}/zenodo.${recid}`;
      }
    }

Sandbox or production
---------------------

A deposit on the sandbox would leave a test DOI in the archive for ever,
which appendix A.1 forbids. So, without `--production`, the deposit is
made on a copy of the line, with its owner's key log at the paths of the
archive's layout and the files that say what the storage root is, and
the result is printed and thrown away, or kept with `--keep`. The copy is
an archive folder over another storage, given by `env.sandbox` (a
temporary folder of the command line) or kept in memory, with the
configuration and the labels of the archive: the deposit runs on it
unchanged. The current keys of the device sign the version of the copy as
they would sign a real one, which also tries the keys.

    // in Zenodo: sandbox or production:
    export async function zenodoCommand(f, args, z) {
      if (args.production) return deposit(f, args.label, z);
      const id = await lineOf(f, args.label);
      const owner = id.split(':')[2];
      const copy = f.env.sandbox ? await f.env.sandbox() : { storage: new MemoryStorage(), where: '(memory)', remove: async () => {} };
      for (const oid of [id, `sheaf:${owner}:${owner}`]) {
        const dir = await f.dirOf(oid);
        if (await f.storage.kind(dir)) await copyTree(f.storage, copy.storage, dir);
      }
      for (const name of ['0=ocfl_1.1', 'ocfl_layout.json', LAYOUT_FILE]) {
        const bytes = await f.storage.read(`ocfl/${name}`);
        if (bytes !== null) await copy.storage.write(`ocfl/${name}`, bytes);
      }
      const g = new ArchiveFolder(copy.storage, f.env);
      Object.assign(g, { archive: f.archive, index: f.index, labels: new Map(f.labels), tombstones: [...f.tombstones],
                         layout: f.layout, old: false });
      try {
        f.env.out(`sandbox: working on a copy in ${copy.where}`);
        await deposit(g, args.label, z);
        const dir = await g.dirOf(id);
        const inv = await g.inventory(dir);
        f.env.out(JSON.stringify((await g.readObjectJson(dir, inv, OBJ)).external, null, 2));
        f.env.out('statuses: ' + (await g.line(id)).statuses.join(', '));
      } finally {
        if (args.keep) f.env.out(`sandbox copy kept in ${copy.where}`);
        else await copy.remove();
      }
    }

    async function copyTree(from, to, dir) {
      for (const entry of (await from.list(dir)) || []) {
        const p = joinPath(dir, entry.name);
        if (entry.kind === 'dir') await copyTree(from, to, p);
        else if (entry.kind === 'file') await to.write(p, await from.read(p));
      }
    }

The deposit
-----------

The version deposited is the current version of the document: the last
of the history of the latest signed version of the line (section 4.2),
sealed and signed, not contested; a document version already on Zenodo
is not deposited again. A branch (section 9) is not deposited by these
tools yet; a withdrawn line gets no DOI.

A deposit changes a record on Zenodo and an object version in the
archive, neither of which can be undone. Appendix A.1 fixes the order of
operations: (1) create an unpublished version of the record, (2) take
the DOI Zenodo reserves for it, (3) build the object version in a staging
folder with that DOI and have its owner sign it, (4) upload the files
and compare their MD5 checksums with the inventory's fixity, (5) publish,
(6) add the object version with its signatures and write the discovery
document again. The state of the deposit is `state.json` in
`zenodo-staging/<path of the line>/`, its phase written after each step;
while it is `published`, the line is locked (`zenodoPending`, chapter
[23](23-folder.md)).

    // in Zenodo: depositing a document version:
    export async function deposit(f, label, z) {
      const out = (line) => f.env.out(line);
      const id = await lineOf(f, label);
      label = f.labelOf(id) || id.split(':')[1];
      const dir = await f.dirOf(id);
      const inv = await f.inventory(dir);
      if (inv === null) exit(`no line ${label}`);
      const stage = joinPath('zenodo-staging', ...(await pathOf(id, f.layout)));
      const statePath = joinPath(stage, 'state.json');
      <<Zenodo: complete or discard an interrupted deposit>>

      <<Zenodo: the document version to deposit>>

      <<Zenodo: a draft and its DOI>>

      const state = { phase: 'draft', record: recid, doi, documentVersion: docVersion };
      await f.storage.write(statePath, jsonBytes(state));
      let pub;
      try {
        <<Zenodo: stage the files of the version>>
        <<Zenodo: the DOI and the relations in datacite.json>>
        <<Zenodo: the deposit in object.json>>
        <<Zenodo: build and sign the object version in the staging folder>>

        <<Zenodo: upload and compare the checksums>>

        pub = await z.call('POST', `/deposit/depositions/${recid}/actions/publish`);
      } catch (error) {
        out(`${label}: failed before publication; discarding draft ${recid}`);
        try {
          await z.call('DELETE', `/deposit/depositions/${recid}`);
        } catch (e) {
          if (!(e instanceof ZenodoError)) throw e;
          out(`  (could not discard: ${e.message})`);
        }
        await removeStage(f.storage, stage);
        f.changed();
        throw error;
      }
      state.phase = 'published';
      await f.storage.write(statePath, jsonBytes(state));
      if (pub?.doi !== doi) {
        exit(`Zenodo published DOI ${pub?.doi ?? 'None'}, not the reserved ${doi}; the staging folder ${stage} is kept: ` +
             'the version built there records the reserved DOI');
      }
      out(`${label}: published ${doi} (concept ${pub.conceptdoi ?? 'None'})`);
      await commit(f, id, stage, state);
    }

### Starting again

A deposit that finds the staging folder of an earlier one completes it if
it was published, and does nothing else; otherwise it discards its draft,
as far as Zenodo allows, and starts again.

    // in Zenodo: complete or discard an interrupted deposit:
    const pending = await readJson(f.storage, statePath);
    if (pending) {
      if (pending.phase === 'published' || pending.phase === 'added') {
        out(`${label}: completing the object version of record ${pending.record}`);
        return commit(f, id, stage, pending);
      }
      out(`${label}: discarding the unpublished draft ${pending.record}`);
      try {
        await z.call('DELETE', `/deposit/depositions/${pending.record}`);
      } catch (e) {
        if (!(e instanceof ZenodoError)) throw e;
        out(`  (could not discard: ${e.message})`);
      }
      await removeStage(f.storage, stage);
    }

### Steps 1 and 2: the draft and its DOI

The status and the history are read from the latest signed version of
the line; the current version and its description from the object
version that holds it.

    // in Zenodo: the document version to deposit:
    const objs = new Map();
    for (const ver of Object.keys(inv.versions)) objs.set(ver, await f.readObjectJson(dir, inv, OBJ, ver));
    const headObj = objs.get(inv.head);
    if (headObj.kind !== 'document') exit(`${label} is not a document`);
    if (headObj.parent) exit(`${label} is a branch (section 9), which these tools do not deposit on Zenodo yet`);
    const signed = await f.latestSigned(id);
    if (signed === null) exit(`${label} has no signed version that is not contested (section 7.3): nothing is deposited`);
    const stateObj = objs.get(signed);
    if (stateObj.status !== 'active') exit(`${label} is withdrawn`);
    const cur = currentVersion(inv, (v) => objs.get(v), signed);
    const obj = JSON.parse(JSON.stringify(objs.get(cur)));
    const dc = await f.readObjectJson(dir, inv, 'datacite.json', cur);
    const docVersion = obj.documentVersion;
    if (zenodoEntries(obj).length) {
      exit(`${label}: document version ${docVersion} is already on Zenodo (${zenodoEntries(obj)[0].doi})`);
    }

If an earlier document version is on Zenodo, the new one becomes a new
version of its record, whose files, which Zenodo copies from the version
before, are deleted; otherwise a new record is made.

    // in Zenodo: a draft and its DOI:
    const [prevRec, prevDoi] = previousRecord(inv, objs, docVersion, signed);
    let draft;
    if (prevRec) {
      const nv = await z.call('POST', `/deposit/depositions/${prevRec}/actions/newversion`);
      draft = await z.call('GET', nv.links.latest_draft);
      for (const file of draft.files || []) await z.call('DELETE', `/deposit/depositions/${draft.id}/files/${file.id}`);
    } else {
      draft = await z.call('POST', '/deposit/depositions', {});
    }
    const recid = draft.id;
    const concept = draft.conceptrecid;
    const doi = z.doi(recid);
    const conceptDoi = concept ? z.doi(concept) : null;

The earlier version is the latest before the current one in the history
that was deposited; its deposit may be recorded in any object version
holding it, which are looked at, the newest first.

    // in Zenodo: the record of the version before:
    export function previousRecord(inv, objs, docVersion, signed) {
      const hist = historyOf(inv, (v) => objs.get(v), signed);
      const docs = hist.map((v) => objs.get(v).documentVersion);
      const before = docs.includes(docVersion) ? docs.slice(0, docs.indexOf(docVersion)) : docs;
      const versions = Object.keys(inv.versions).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
      for (const n of [...before].reverse()) {
        for (const v of versions) {
          const obj = objs.get(v);
          if (obj.documentVersion === n && zenodoEntries(obj).length) {
            const e = zenodoEntries(obj)[0];
            return [e.record.replace(/\/+$/, '').split('/').pop(), e.doi];
          }
        }
      }
      return [null, null];
    }

A deposit is an entry of `external` with role `deposit` and service
Zenodo.

    // in Zenodo: deposits recorded in object.json:
    export function zenodoEntries(obj) {
      return (obj.external || []).filter((e) => e.service === SERVICE_NAME && e.role === 'deposit');
    }

### Step 3: the new object version

A description-only version (section 4.2): the files of the object version
holding the current version, all but the two descriptions, which are
written anew, and the files of the notices of the latest signed version,
which are kept but not uploaded, since the files of a published Zenodo
version are fixed.

    // in Zenodo: stage the files of the version:
    const files = new Map();
    for (const paths of Object.values(inv.versions[cur].state)) {
      for (const lp of paths) if (!METADATA_FILES.includes(lp)) files.set(lp, await f.readLogical(dir, inv, lp, cur));
    }
    const skip = noticeFiles(stateObj);
    for (const n of stateObj.notices || []) {
      if (n.path && !files.has(n.path)) files.set(n.path, await f.readLogical(dir, inv, n.path, signed));
    }

The files left out of the upload are those named by the notices of the
latest signed version and by its withdrawal reason; the licence terms are
uploaded, with the content they govern.

    // in Zenodo: files of notices:
    export function noticeFiles(obj) {
      const paths = new Set((obj.notices || []).filter((n) => n.path).map((n) => n.path));
      const reason = obj.withdrawal?.reason || {};
      if (reason.path) paths.add(reason.path);
      return paths;
    }

`datacite.json` gets the DOI, keeps its `url` (or gets the landing page),
and its relations to Zenodo versions are made anew: a version of the
concept DOI, a new version of the version before. A version not public
before becomes public now; `Updated` is today.

    // in Zenodo: the DOI and the relations in datacite.json:
    const today = f.env.today();
    dc.doi = doi;
    dc.url = dc.url || landingUrl(f, label);
    const rel = (dc.relatedIdentifiers || []).filter((r) => !(['IsVersionOf', 'IsNewVersionOf'].includes(r.relationType) &&
                                                               r.relatedIdentifier.includes('zenodo')));
    if (conceptDoi) rel.push({ relatedIdentifier: conceptDoi, relatedIdentifierType: 'DOI', relationType: 'IsVersionOf' });
    if (prevDoi) rel.push({ relatedIdentifier: prevDoi, relatedIdentifierType: 'DOI', relationType: 'IsNewVersionOf' });
    dc.relatedIdentifiers = rel;
    if (!dateOf(dc, 'Available')) setDate(dc, 'Available', today);
    setDate(dc, 'Updated', today);

`object.json` gets the deposit in `external`: role `deposit`, service
`Zenodo`, the record, the DOI and, when one is uploaded, `sources.zip`
with its digests. The notices and the history are those of the latest
signed version, carried forward.

    // in Zenodo: the deposit in object.json:
    const upload = new Map([...files].filter(([lp]) => !skip.has(lp)));
    const { plan, extra } = await uploadPlan(upload, obj, f.env.deflateRaw);
    const entry = { role: 'deposit', service: SERVICE_NAME, record: `${z.s.records}${recid}`, doi };
    if (extra.length) entry.files = extra;
    obj.external = [...(obj.external || []), entry];
    delete obj.notices;
    delete obj.history;
    await carryForward(f, stateObj, obj, dir, inv, `v${Number(inv.head.slice(1)) + 1}`);

The version is built and signed in the staging folder, `version/`
(`addVersion` with `stageIn`, chapter [23](23-folder.md)); its
`object.json` is checked, before anything is uploaded, against the
schema of section 4.3 and the rules of appendix A.1, since a malformed
record would be signed and published for good.

    // in Zenodo: build and sign the object version in the staging folder:
    const content = new Map(files);
    content.set('datacite.json', jsonBytes(dc));
    const staged = await f.addVersion(id, content, obj, `Zenodo: document version ${docVersion}, DOI ${doi}`,
                                      { stageIn: joinPath(stage, 'version') });
    const ver = staged.head;
    const stagedFile = async (logical) => {
      const cp = f.contentPath(staged, ver, logical);
      return f.storage.read(cp.startsWith(`${ver}/`) ? joinPath(stage, 'version', cp) : joinPath(dir, cp));
    };
    const stagedObj = JSON.parse(new TextDecoder().decode(await stagedFile(OBJ)));
    checkDepositRecord(stagedObj, doi, f.env.schemas);
    plan.set('datacite.json', await stagedFile('datacite.json'));
    plan.set(OBJ, await stagedFile(OBJ));
    Object.assign(state, { phase: 'staged', version: ver });
    await f.storage.write(statePath, jsonBytes(state));

The checks: the schema of `object.json`, and for every entry of
`external` the fields section 4.3 requires, an `https` record and a DOI
of the form of DOIs; and an entry for the deposit just made.

    // in Zenodo: the checks of a deposit record:
    export function checkDepositRecord(obj, doi, schemas = null) {
      const problems = [];
      const schema = schemas?.[OBJ_FORMAT];
      if (schema) for (const e of validate(schema, obj)) problems.push(`${e.path ? e.path + ': ' : ''}${e.message}`);
      for (const e of obj.external || []) {
        if (!['role', 'service', 'record'].every((k) => typeof e[k] === 'string' && e[k])) {
          problems.push(`an external entry lacks role, service or record: ${JSON.stringify(e)}`);
        } else if (!['deposit', 'source'].includes(e.role) || !e.record.startsWith('https://')) {
          problems.push(`an external entry with a bad role or record: ${JSON.stringify(e)}`);
        }
        if ('doi' in e && !/^10\.[0-9]+(\.[0-9]+)*\/\S+$/.test(String(e.doi))) problems.push(`an external entry with a malformed DOI: ${e.doi}`);
      }
      if (!zenodoEntries(obj).some((e) => e.doi === doi)) problems.push(`no external entry of the deposit of ${doi}`);
      if (problems.length) exit('the object version built is malformed: ' + problems.join('; '));
    }

### Step 4: the upload

Each file goes into the draft's bucket, and Zenodo answers with the MD5
of what it received, which is compared with the inventory of the version
built (section 4.1, appendix A.1), and that of `sources.zip` with its
`md5` in `external`. A difference stops the deposit before publication.
The metadata of the record are sent last. Names are quoted as Python's
`urllib.parse.quote` quotes them.

    // in Zenodo: upload and compare the checksums:
    const bucket = draft.links.bucket;
    for (const [name, data] of [...plan].sort(([a], [b]) => compareText(a, b))) {
      let expect;
      if (name === 'sources.zip') {
        expect = extra[0].md5;
      } else {
        const cp = f.contentPath(staged, ver, name);
        expect = Object.entries(staged.fixity?.md5 || {}).find(([, ps]) => ps.includes(cp))?.[0];
        if (!expect) exit(`the inventory records no MD5 of ${name} (appendix A.1)`);
      }
      if ((await md5hex(data)) !== expect) exit(`${name} does not have the MD5 the inventory records`);
      const r = await z.call('PUT', `${bucket}/${quote(name)}`, null, data);
      if (r?.checksum !== `md5:${expect}`) exit(`checksum of ${name}: Zenodo ${r?.checksum ?? 'None'}, inventory md5:${expect}`);
      out(`  uploaded ${name} (md5 ${expect})`);
    }
    await z.call('PUT', `/deposit/depositions/${recid}`, { metadata: zenodoMetadata(dc, f.archive, id) });
    state.phase = 'uploaded';
    await f.storage.write(statePath, jsonBytes(state));

A name is quoted as `urllib.parse.quote` quotes it: every byte of its
UTF-8 but letters, digits, `_.-~` and `/` as `%XX`.

    // in Zenodo: what is uploaded:
    export function quote(name) {
      return [...new TextEncoder().encode(name)].map((b) => (/[A-Za-z0-9_.\-~/]/.test(String.fromCharCode(b)) ? String.fromCharCode(b)
        : '%' + b.toString(16).toUpperCase().padStart(2, '0'))).join('');
    }

### Step 6: adding the version

The version built is added as it is, with its signature files; if a key
that signed it was exposed meanwhile (a deposit interrupted after
publication), it is signed again with current keys not exposed, as
`osheaf sign` does, without asking, since this very deposit made it.
Then the staging folder goes, and the line is unlocked.

    // in Zenodo: committing the deposit:
    export async function commit(f, id, stage, state) {
      const label = f.labelOf(id) || id;
      let inv;
      if (state.phase === 'published') {
        inv = await f.installVersion(id, joinPath(stage, 'version'));
        state.phase = 'added';
        await f.storage.write(joinPath(stage, 'state.json'), jsonBytes(state));
      } else {
        inv = await f.inventory(await f.dirOf(id));
      }
      const ver = state.version || inv.head;
      f.changed();
      const { statuses } = await f.line(id);
      if (statuses[Number(ver.slice(1)) - 1] === CONTESTED) {
        f.env.out(`${label}: ${ver} is contested (a key that signed it was exposed): signing it again`);
        await signAgain(f, { label: id, version: ver, yes: true });
      }
      await writeDiscovery(f);
      await removeStage(f.storage, stage);
      f.changed();
      f.env.out(`${label}: ${ver} added, DOI ${state.doi}`);
    }

The files on Zenodo
-------------------

A record has no folders and at most 100 files. A version whose files are
flat and few enough is uploaded as it is; otherwise the renditions and
the descriptions as they are, and the sources in one `sources.zip`, whose
digests go into the deposit's entry in `object.json`. A rendition in a
folder stops the deposit.

    // in Zenodo: what is uploaded:
    export async function uploadPlan(files, obj, deflateRaw) {
      if (![...files.keys()].some((n) => n.includes('/')) && files.size <= MAX_FILES) return { plan: new Map(files), extra: [] };
      const keep = new Set([...METADATA_FILES, ...(obj.renditions || []).map((r) => r.path)]);
      if ([...keep].some((n) => n.includes('/'))) exit('renditions in sub-folders cannot be uploaded to Zenodo');
      const sources = new Map([...files].filter(([n]) => !keep.has(n)));
      const zip = await reproducibleZip(sources, deflateRaw);
      const plan = new Map([...files].filter(([n]) => keep.has(n)));
      plan.set('sources.zip', zip);
      return { plan, extra: [{ name: 'sources.zip', sha512: await sha512hex(zip), md5: await md5hex(zip), bytes: zip.length }] };
    }

`sources.zip` is built reproducibly, as Python's `zipfile` writes it for
opensheaf-py: entries in the byte order of their names, each compressed
by Deflate, dated 1 January 1980, with the permissions `0644` of Unix and
no extra fields, so that both programs write the same bytes from the
same files, and anyone can check the record against the archive. The
compression must be zlib's, at its default level, for the bytes to be
the same: the command line gives `node:zlib` (whose output is zlib's
under Node and Deno alike), and the `CompressionStream` of the platform
serves otherwise, giving a valid archive whose bytes may differ.

    // in Zenodo: a reproducible sources.zip:
    const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });

    export function crc32(bytes) {
      let c = 0xffffffff;
      for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    }

    async function deflateStream(bytes) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    export async function reproducibleZip(files, deflateRaw = null) {
      const deflate = deflateRaw || deflateStream;
      const encoder = new TextEncoder();
      const parts = [], central = [];
      let offset = 0;
      const names = [...files.keys()].sort((a, b) => compareBytes(encoder.encode(a), encoder.encode(b)));
      for (const name of names) {
        const data = files.get(name), packed = await deflate(data), nameBytes = encoder.encode(name);
        const flags = /^[\x00-\x7f]*$/.test(name) ? 0 : 0x800;
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, flags, true);
        local.setUint16(8, 8, true);
        local.setUint16(10, 0, true);
        local.setUint16(12, (0 << 9) | (1 << 5) | 1, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, packed.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);
        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, (3 << 8) | 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, flags, true);
        entry.setUint16(10, 8, true);
        entry.setUint16(12, 0, true);
        entry.setUint16(14, (0 << 9) | (1 << 5) | 1, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, packed.length, true);
        entry.setUint32(24, data.length, true);
        entry.setUint16(28, nameBytes.length, true);
        entry.setUint32(38, (0o644 << 16) >>> 0, true);
        entry.setUint32(42, offset, true);
        parts.push(new Uint8Array(local.buffer), nameBytes, packed);
        central.push(new Uint8Array(entry.buffer), nameBytes);
        offset += 30 + nameBytes.length + packed.length;
      }
      const size = central.reduce((n, p) => n + p.length, 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, names.length, true);
      end.setUint16(10, names.length, true);
      end.setUint32(12, size, true);
      end.setUint32(16, offset, true);
      const all = [...parts, ...central, new Uint8Array(end.buffer)];
      const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
      let k = 0;
      for (const p of all) {
        out.set(p, k);
        k += p.length;
      }
      return out;
    }

    function compareBytes(a, b) {
      for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) return a[k] - b[k];
      return a.length - b.length;
    }

The metadata on Zenodo
----------------------

Zenodo takes its own metadata, from which it makes the DataCite record of
the DOI; `datacite.json` stays the authority (appendix A.1), and the
translation is faithful, not complete. Licences Zenodo does not know by
an SPDX identifier become "Other (Not Open)", with their text in the
notes; the abstract becomes HTML, a paragraph per block of text; the
versioning relations between Zenodo records are left to Zenodo.

    // in Zenodo: deposit metadata from datacite.json:
    export const PUBLICATION_TYPES = { Preprint: 'preprint', JournalArticle: 'article', Book: 'book', BookChapter: 'section',
                                       Dissertation: 'thesis', Report: 'report', ConferencePaper: 'conferencepaper', Text: 'other' };
    export const SCHEMES = { arXiv: 'arxiv', DOI: 'doi', URL: 'url', Handle: 'handle', ISBN: 'isbn', ISSN: 'issn', PMID: 'pmid',
                             SWHID: 'swh' };
    export const OPEN_LICENCES = new Set(['cc-by-4.0', 'cc-by-sa-4.0', 'cc-by-nc-4.0', 'cc-by-nd-4.0', 'cc-by-nc-sa-4.0',
                                          'cc-by-nc-nd-4.0', 'cc0-1.0', 'mit', 'apache-2.0', 'gpl-3.0-or-later']);

    export function htmlEscape(s) {
      return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]);
    }

    export function zenodoMetadata(dc, archive, id) {
      const creators = dc.creators.map((c) => {
        const z = { name: c.name };
        const affs = (c.affiliation || []).map((a) => (typeof a === 'object' && a !== null ? a.name : a));
        if (affs.length) z.affiliation = affs.join('; ');
        for (const ni of c.nameIdentifiers || []) {
          if (ni.nameIdentifierScheme === 'ORCID') z.orcid = ni.nameIdentifier.split('/').pop();
        }
        return z;
      });
      const abstract = (dc.descriptions || []).find((d) => d.descriptionType === 'Abstract')?.description ?? null;
      const description = abstract ? abstract.split('\n\n').map((p) => `<p>${htmlEscape(p.trim())}</p>`).join('')
        : `<p>${htmlEscape(dc.titles[0].title)}</p>`;
      const dates = Object.fromEntries((dc.dates || []).map((d) => [d.dateType, d.date]));
      const rights = (dc.rightsList || [{}])[0];
      const licence = (rights.rightsIdentifier || '').toLowerCase();
      const m = {
        upload_type: 'publication',
        publication_type: PUBLICATION_TYPES[dc.types.resourceTypeGeneral] || 'other',
        title: dc.titles[0].title,
        creators,
        description,
        access_right: 'open',
        license: OPEN_LICENCES.has(licence) ? licence : 'other-closed',
        version: dc.version,
        publication_date: (dates.Issued || dates.Available).slice(0, 10),
        notes: `Deposited from the OpenSheaf archive ${archive.name} (${archive.baseUrl}), line ${id}, document version ` +
               `${dc.version}. Rights: ${rights.rights ?? 'see the files'}.`,
      };
      if (dc.language === 'en') m.language = 'eng';
      const keywords = (dc.subjects || []).map((s) => s.subject);
      if (keywords.length) m.keywords = keywords;
      const related = [{ identifier: dc.url, relation: 'isIdenticalTo', scheme: 'url' }];
      for (const r of dc.relatedIdentifiers || []) {
        const rel = r.relationType;
        if (['IsVersionOf', 'IsNewVersionOf', 'IsPreviousVersionOf'].includes(rel) && r.relatedIdentifier.includes('zenodo')) continue;
        const scheme = SCHEMES[r.relatedIdentifierType];
        if (scheme) related.push({ identifier: r.relatedIdentifier, relation: rel[0].toLowerCase() + rel.slice(1), scheme });
      }
      m.related_identifiers = related;
      return m;
    }
