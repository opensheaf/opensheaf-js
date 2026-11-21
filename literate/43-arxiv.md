Importing from arXiv: fetching
==============================

Many archives start from papers already on arXiv, which keeps every
version of a paper, with its PDF and usually its sources; an archive can
hold the same versions, byte for byte, as the signed document versions of
a line. This chapter and the two after it are opensheaf-py's chapters
[40-arxiv](https://opensheaf.org/opensheaf-py/40-arxiv.html),
[41-arxiv-metadata](https://opensheaf.org/opensheaf-py/41-arxiv-metadata.html)
and [42-arxiv-import](https://opensheaf.org/opensheaf-py/42-arxiv-import.html)
in JavaScript: the same two commands, the same folder of downloads, the
same files in the archive, the same messages.

```
osheaf arxiv fetch DOWNLOADS --author gubinelli_m_1
osheaf arxiv import DOWNLOADS
```

The first only downloads, into a folder of its own, and needs no archive;
the second reads that folder and deposits, and touches nothing on the
network. The download can be resumed, and the import repeated, without
asking arXiv again; and the folder records what was received from arXiv,
with the digests of every file:

```
DOWNLOADS/
  download.json              what was fetched, when, from where, with SHA-256
  version-licences.json      the licence and the comments of every version
  identifiers.json           arXiv identifier -> label (by the depositor)
  papers/
    2303.18112/
      record.xml             the OAI-PMH record, in the arXivRaw format
      v1.pdf  v1-source.tar.gz
      v2.pdf  v2-source.gz
      v3.pdf  v3-source.pdf
    math_0601001/            old identifiers have a slash, written _
```

Only `identifiers.json` is written by hand: it gives each paper its label
(section 3.1), and the import stops, with a proposal, when one is
missing.

**On the command line only.** arXiv sends no CORS headers, so a page in a
browser cannot read it; the fetching below is in the core all the same,
since it needs nothing but a `fetch`, which the command line gives, and
the tests give a double of arXiv. The import needs no network at all, and
would run in a browser on downloads held there.

The module
----------

`core/arxiv.js` holds the three chapters: the metadata (chapter
[44](44-arxiv-metadata.md)), the sources and the import (chapter
[45](45-arxiv-import.md)), and the fetching (here).

    // in core/arxiv.js:
    import { LABEL } from './names.js';
    import { jsonBytes, md5hex, sha512hex, sha256hex } from './write.js';
    import { joinPath, compareText } from './storage.js';
    import { OBJ, OBJ_FORMAT, GENESIS, SPEC, exit } from './folder.js';
    import { carryForward, carriedFiles, landingUrl } from './deposit.js';
    import { writeDiscovery } from './discovery.js';
    import { removeFolder } from './takedown.js';

    <<arXiv: reading the arXivRaw record>>

    <<arXiv: plain names from TeX>>

    <<arXiv: a creator from an author's name>>

    <<arXiv: titles and abstracts as plain text>>

    <<arXiv: the authors' macros from the preamble>>

    <<arXiv: the standard mathematical commands>>

    <<arXiv: macros left unknown>>

    <<arXiv: licences known by name>>

    <<arXiv: papers already in the archive>>

    <<arXiv: proposing a label from the title>>

    <<arXiv: unpacking an e-print>>

    <<arXiv: finding the main TeX file>>

    <<arXiv: importing a paper>>

    <<arXiv: the import command>>

    <<arXiv: downloading politely>>

    <<arXiv: the kind of an e-print>>

    <<arXiv: the papers of an author>>

    <<arXiv: fetching papers>>

Downloading
-----------

### Politely

arXiv asks automated clients to make at most one request every three
seconds, and to say who they are. Every request goes through one getter,
which waits until three seconds have passed since the previous one and
sends a `User-Agent` naming this program. A request that fails is tried
again, up to four times, waiting 15, 30, 45 and 60 seconds; an answer 403
or 404 is final, and raised at once, with the words Python's `urllib`
gives it (`HTTP Error 404: Not Found`), which `download.json` records.
After four failures the getter gives up on that address.

The getter is made from a `fetch`, the wait between requests and a
`sleep`, so that the tests run it at once against a double of arXiv.

    // in arXiv: downloading politely:
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

### What is fetched for each paper

The **record**, by OAI-PMH, in the format `arXivRaw`, which lists every
version with its date (fetched again with `--refresh`, which finds new
versions); the **PDF and the e-print** of every version, from
`export.arxiv.org`, the e-print named by its first bytes; and the
**licence and comments** of every version, from its abstract page, since
the record has only those of the current version.

    // in arXiv: the kind of an e-print:
    export async function sourceKind(data) {
      if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return 'pdf';
      if (data[0] === 0x1f && data[1] === 0x8b) {
        let raw;
        try {
          raw = await gunzip(data, Infinity);
        } catch {
          return 'gz';
        }
        return tarMembers(raw) === null ? 'gz' : 'tar.gz';
      }
      return 'bin';
    }

The download goes through the papers in turn, and can be interrupted and
started again: a file listed in `download.json` and present is not
fetched again, and both JSON files are written after every file. A
failure is recorded, with the error, and does not stop the download; the
next run tries again. The times are those of Python's `isoformat`, with
`+00:00`.

    // in arXiv: fetching papers:
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
          <<arXiv: fetch the PDF and the e-print of a version>>
          <<arXiv: fetch the licence and comments of a version>>
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

Each file is recorded with its address, size, SHA-256 digest and the time
it was fetched.

    // in arXiv: fetch the PDF and the e-print of a version:
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

The page of a version is fetched unless both its licence and its comments
are known (comments known to be absent are `null`). The licence is the
link of the licence box, or else the first link to a Creative Commons or
arXiv licence; the comments are the text of their cell, links replaced by
their addresses and the entities of HTML decoded.

    // in arXiv: fetch the licence and comments of a version:
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

Python's `html.unescape` knows every named reference of HTML5; the
comments of arXiv use few of them. These are decoded, with the numeric
references; any other is left as it is, which the report would show.

    // in arXiv: fetching papers:
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

### Which papers

The papers are named by their identifiers, or by an author: the Atom
feed of the author's page on arXiv (`arxiv.org/a/gubinelli_m_1`) lists
them, and the identifiers of its entries are taken without their version.

    // in arXiv: the papers of an author:
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
