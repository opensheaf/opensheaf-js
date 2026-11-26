Reading archives over HTTP
==========================

> This chapter is chapter 10 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/10-http.html), copied with
> its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


Everything the explorer knows about an archive it reads over HTTP, with
the `fetch` of the browser: the discovery document, the inventories, the
two descriptions of every object version, the member lists, and, when
asked, the content files. An OpenSheaf archive is a folder of static
files (section 3), so every request is a plain GET of a file, and the
explorer never writes anything anywhere.

What it reads comes from servers it does not control, and is untrusted
(section 15.2). This chapter is the one place where requests are made, and
so the place where the rules for them are kept: only `http:` and `https:`
addresses, never cookies, a limit on the size of every answer, time
limits on every request, and a limit on the requests in flight at once, so
that a large archive does not flood its server or the browser. When a
request fails, the error says why in terms a reader can act on: above all,
whether the browser refused to let the page read an answer that the server
did send, which is what happens when a server does not allow cross-origin
requests.

The module is `core/http.js`.

    // in core/http.js:
    <<the limits of the explorer>>

    <<what went wrong with a request>>

    <<explaining a failed request to the reader>>

    <<a pool of requests>>

    <<the watchdog of a request>>

    <<reading a body within a limit>>

    <<the HTTP client>>

    <<decoding JSON>>

    <<the SHA-512 digest of bytes>>

Limits
------

Section 15 asks verifiers to limit the size of the files they fetch, and
section 14.1 lets them bound the depth of the chains and collections they follow. The
limits are gathered here, so that they are stated once. JSON files are
small: the inventory of an object with many versions and files is a few
hundred kilobytes, so sixteen megabytes leave a wide margin while still
stopping a server that answers with something absurd. A content file of
an object, whatever it holds, is bounded by `file`, one gibibyte, as
opensheaf-py bounds it (`MAX_BYTES`): the files of a key log and the
evidence of a branch point are content files, and the JSON limit does not
apply to them; a browser holds a file in memory to hash it (WebCrypto has
no incremental hashing), and a file larger than `large` is read alone
(see below, reading a body). These limits are a reader's choice (section
15.2): a file not read because of one is unavailable, never a file that
is not there nor a version that is not one. The answers kept for the
session (see below, the client) are bounded too.

Time is limited in three ways: a server must start answering (send the
headers) within `timeout`, and, once it has, must not stay silent for
more than `stall` between two pieces of the body; and one request may not
take more than `deadline` in all, as opensheaf-py's `DEADLINE`, so that a
server sending a byte every few seconds cannot hold a reader for ever. The
deadline is wide (five minutes, a file of 600 MB read at 2 MB/s), since
it must not fail the download of a large file from a slow but steady
server, which is a valid archive; the time a body waits for its turn
among the large ones (below) is not counted.

A hostile archive can make the work huge without making any file large:
a collection with thousands of members, each with dozens of mirrors, an
object with thousands of versions, a discovery document listing a
hundred thousand objects. Section 15 asks verifiers to limit what they
follow, so each of these is bounded as well, and the pages and the
verification say when a limit stopped them.

What a resolver reads from other archives is bounded as a whole too, as
opensheaf-py bounds what the copies of one resolver bring
(`MAX_RUN_FILES`, `MAX_RUN_BYTES`): a client given a `run`, the counts of
one resolver (chapter [15](15-resolve.md)), reads at most `runFiles`
files and `runBytes` bytes for it.

The same holds for what one page of the explorer may cost. Each limit
above bounds one thing; together they still allow a hostile archive to
make a page read for hours. So the requests made and the bytes read for
one page are counted, and the page stops reading once it has made
`pageRequests` requests or read `pageBytes` bytes. The limits are wide:
the page of an archive at the limit of objects, each of one or two
versions, reads three or four files per object for their descriptions,
some forty thousand in all. A verification is not counted against them:
it reads a whole archive on purpose, and has limits of its own.

A JSON file may also be small and still harmful: an array nested a
million times is a few megabytes, and makes every function that walks it
by recursion (the validator, `JSON.stringify`) overflow the stack. JSON
nested deeper than `nesting` levels is refused; the files of OpenSheaf
need fewer than ten.

    // in the limits of the explorer:
    export const LIMITS = {
      json: 16 * 2 ** 20,      // a JSON file: discovery document, page, inventory, checksum file, witness (opensheaf-py's MAX_JSON)
      page: 16 * 2 ** 20,      // the index page, read for the check of the presentation
      file: 2 ** 30,           // a content file of an object: key-log files, evidence, documents (opensheaf-py's MAX_BYTES)
      large: 32 * 2 ** 20,     // a body larger than this is read alone, one at a time
      cache: 64 * 2 ** 20,     // bytes of answers kept by one client
      timeout: 60_000,         // milliseconds to wait for the headers of an answer
      stall: 30_000,           // milliseconds to wait for the next piece of a body
      deadline: 300_000,       // milliseconds one request may take in all (opensheaf-py's DEADLINE)
      concurrency: 6,          // requests in flight at once
      depth: 3,                // levels of member collections followed
      pins: 2000,              // pins resolved in one walk through collections, or in one verification
      mirrors: 5,              // locations of copies (at, hints) tried for one line, after the archive explored
      probes: 8,               // prefixes of a URL tried for the archive that holds it
      versions: 10_000,        // object versions of one object
      objects: 10_000,         // objects of one archive listed or verified
      nesting: 64,             // levels of arrays and objects in a JSON file
      retry: 30_000,           // milliseconds a busy server may ask to be left alone (Retry-After)
      pageRequests: 40_000,    // requests made for one page
      pageBytes: 256 * 2 ** 20, // bytes read for one page
      runFiles: 200_000,       // files one resolver reads from other archives (opensheaf-py's MAX_RUN_FILES)
      runBytes: 16 * 2 ** 30,  // bytes one resolver reads from other archives (opensheaf-py's MAX_RUN_BYTES)
    };

Errors
------

A failed request is a `FetchError` with a *kind*, which the pages use to
explain the failure, and the address it concerns. The kinds are:

- `scheme`: not an `http:` or `https:` address (a `file:` address, which a
  collection made from a local folder may record, cannot be read by a web
  page);
- `unsafe`: an address that would be built from an identifier or a path
  breaking the rules of sections 3.2 and 4.1, refused before any request
  (see [untrusted names](11-paths.md));
- `not-found`, `forbidden` (403), `busy` (429 or 5xx, still so after
  two more tries) and `http`: the server answered with an error status;
- `html`: the server answered with an HTML page where a JSON file was
  expected;
- `cors`: the server answered, but the browser did not let the page read
  the answer;
- `mixed`: an `http:` address read from an `https:` page, which browsers
  block;
- `network`: no answer at all, or an answer interrupted;
- `budget`: the page has made all the requests, or read all the bytes,
  it may, or a resolver all the files or bytes of its run (see the limits
  above);
- `timeout`, `too-large`, `json` (not UTF-8 JSON), `digest` (an inventory
  that does not match its checksum file), `crypto` (no WebCrypto) and
  `aborted` (cancelled by the reader).

    // in what went wrong with a request:
    export class FetchError extends Error {
      constructor(kind, url, detail, status = null) {
        super(url ? `${url}: ${detail}` : detail);
        this.kind = kind;
        this.url = url;
        this.detail = detail;
        this.status = status;
      }
    }

Cross-origin requests deserve an explanation, since they are the usual
reason why an archive that opens in a browser tab cannot be explored: a
page served from one site (here `opensheaf.org`) may read files of another
site only if that site says so, with the header
`Access-Control-Allow-Origin`. Section 5 asks archives to send it
(`Access-Control-Allow-Origin: *`) precisely so that tools running in a
browser can read them; GitHub Pages sends it for every file. When it is
missing, the remedies are on the side of the archive: send the header, or
serve a copy of the explorer from the archive's own site, where every
request is same-origin (see [the application](https://opensheaf.org/explorer/source/30-app.html)). A browser
cannot tell a refusal from a missing file, though: a server that answers
404 without the header is refused the same way, so the explanation says
that the file may simply not be there.

Some failures are common enough on the hosts archives use to deserve an
explanation of their own. A site that serves a page of its own for every
address it does not know (a "fallback" page, as single-page sites and
some hosts do), or a base URL that names the site rather than the
archive, answers with an HTML page where a JSON file was expected.
Object storage (S3 and its imitators) answers 403 both for a key that
does not exist and for a bucket that the public may not read. And a
server that stays busy after the tries described below is reported as
busy, not as broken.

    // in explaining a failed request to the reader:
    export function explain(error) {
      switch (error?.kind) {
        case 'cors':
          return 'The server answered, but without the header Access-Control-Allow-Origin, so the ' +
            'browser does not let this page read the answer. OpenSheaf archives should allow ' +
            'cross-origin requests (section 3 of the specification); GitHub Pages does. Otherwise, ' +
            'copy the explorer into the archive’s own site (for instance as explorer/ next to ' +
            'opensheaf.json): served from there, it reads the archive without cross-origin requests. ' +
            'The file may also simply be missing: a server that answers 404 without the header looks ' +
            'the same to the browser.';
        case 'html':
          return 'The server sent an HTML page instead of the file: probably a wrong base URL (it ' +
            'should be the folder holding opensheaf.json), or a site that answers every unknown ' +
            'address with a page of its own.';
        case 'forbidden':
          return 'The server refuses to give the file (403). Object storage answers so both for a ' +
            'file that does not exist and for a bucket that is not public: check the address, and ' +
            'that the bucket allows public read.';
        case 'busy':
          return 'The server is busy or failing (429 or 5xx), and still was after two more tries. ' +
            'Try again later.';
        case 'budget':
          return 'This page has made all the requests, or read all the bytes, the explorer allows ' +
            'for one page (section 15 asks verifiers to limit what they fetch). Open a page that ' +
            'needs less, or verify the archive.';
        case 'mixed':
          return 'This page was loaded over https:, and browsers do not let it read http: addresses. ' +
            'Serve the archive over https:, or open a copy of the explorer served over http:.';
        case 'scheme':
          return 'Only http: and https: addresses can be read by a web page. A collection made from ' +
            'a folder on disk records file: addresses, which only tools on that computer can read.';
        case 'network':
          return 'No answer, or an answer interrupted: the address may be wrong, the server down, or ' +
            'the network unavailable. Some browsers also report a refused cross-origin request this way.';
        case 'not-found':
          return 'The server has no such file. Check the address: it should be the base URL of ' +
            'the archive, the folder holding opensheaf.json.';
        case 'timeout':
          return 'The server did not answer in time, or stopped sending.';
        case 'too-large':
          return 'The answer is larger than the explorer accepts (section 15 asks verifiers to ' +
            'limit the size of what they fetch).';
        case 'crypto':
          return 'Digests are computed with the WebCrypto of the browser, which is only available ' +
            'to pages served over https: or from localhost.';
        case 'unsafe':
          return 'The archive names a file with an identifier or a path that breaks the rules of ' +
            'sections 3.2 and 4.1; the explorer does not fetch it (section 15.2).';
        default:
          return '';
      }
    }

A pool of requests
------------------

Requests go through a pool that lets a few run at once and queues the
others. Without it, verifying an archive of a hundred documents would
start a thousand requests at once. A place in the pool is *acquired* and
then *released*; a request waiting for its place gives up the wait as
soon as its reader cancels, so that the queue of a page the reader has
left empties at once instead of running request after request only to
abort each. `run(task)` runs a task in a place, for those who need no
more.

    // in a pool of requests:
    export function pool(size) {
      let active = 0;
      const waiting = [];
      const next = () => {
        while (active < size && waiting.length) {
          active++;
          waiting.shift()();
        }
      };
      function acquire(signal) {
        return new Promise((resolve, reject) => {
          if (signal?.aborted) return reject(new FetchError('aborted', '', 'cancelled'));
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            active--;
            next();
          };
          const grant = () => {
            signal?.removeEventListener('abort', give);
            resolve(release);
          };
          const give = () => {
            const k = waiting.indexOf(grant);
            if (k >= 0) {
              waiting.splice(k, 1);
              reject(new FetchError('aborted', '', 'cancelled'));
            }
          };
          signal?.addEventListener('abort', give, { once: true });
          waiting.push(grant);
          next();
        });
      }
      async function run(task, signal) {
        const release = await acquire(signal);
        try {
          return await task();
        } finally {
          release();
        }
      }
      run.acquire = acquire;
      return run;
    }

A pause between two tries of a request (below) ends early, with an
error, when the reader cancels.

    // in a pool of requests:
    function pause(ms, signal) {
      return new Promise((resolve, reject) => {
        const stop = () => {
          clearTimeout(timer);
          reject(new FetchError('aborted', '', 'cancelled'));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', stop);
          resolve();
        }, ms);
        if (signal?.aborted) stop();
        else signal?.addEventListener('abort', stop, { once: true });
      });
    }

Time limits
-----------

Each try of a request is watched by a *watchdog*: a controller that
aborts the request when its timer runs out. It is armed first for the
headers (`timeout`), then for each piece of the body (`stall`), and
remembers which limit ran out, so that the error can say so. It can be
stopped, and re-armed with the same limit. It also keeps the deadline of
the whole try (`within`), whose clock stops while the watchdog is stopped
and goes on, with the time left, when it is re-armed.

    // in the watchdog of a request:
    function watchdog() {
      const controller = new AbortController();
      let timer = null, ms = 0, end = null, left = Infinity, since = 0, late = '';
      const fire = (dog, why) => { dog.fired = why; controller.abort(); };
      return {
        signal: controller.signal,
        fired: null,
        why: '',
        arm(limit, why) {
          ms = limit;
          this.why = why;
          this.rearm();
        },
        within(limit, why) {
          left = limit;
          late = why;
          this.resume();
        },
        rearm() {
          clearTimeout(timer);
          timer = setTimeout(() => fire(this, this.why), ms);
          this.resume();
        },
        resume() {
          if (end !== null || left === Infinity) return;
          since = Date.now();
          end = setTimeout(() => fire(this, late), left);
        },
        stop() {
          clearTimeout(timer);
          if (end === null) return;
          clearTimeout(end);
          end = null;
          left = Math.max(0, left - (Date.now() - since));
        },
      };
    }


Reading a body within a limit
-----------------------------

The size a server declares (`Content-Length`) is checked first, and the
body is then read piece by piece, stopping as soon as the limit is passed:
a server may declare nothing, or declare the size of a compressed body
smaller than what it decompresses to.

Memory is spent with care, since a content file may be hundreds of
megabytes. The declared size is a claim, not bytes: a server may declare
a gibibyte and send ten bytes, and the buffer is therefore allocated as the
bytes arrive. It starts at 64 KiB at most and grows by doubling, never
beyond the declared size while that is right. A body that passes
`LIMITS.large`, or whose buffer would, waits, before going further, until
no other large body is being read by the client: the digests of large
files are thus checked one at a time, whatever the number of requests in
flight (six files of a gibibyte at once would be six gigabytes). The hash
of one large file may still overlap the download of the next. While a
body waits for its turn, its watchdog is stopped. Once a body holds the
place of the large ones, its buffer grows at once to the declared size
(keeping the pieces and copying them at the end would hold the file
twice); a server lying about the size can then waste one buffer within
the limit, one body at a time.

The watchdog is re-armed by every piece that arrives, so that the time
limit is on silence, not on the length of the download.

    // in reading a body within a limit:
    function tooLarge(url, limit, declared = null) {
      return new FetchError('too-large', url, declared === null ? `more than ${limit} bytes`
        : `${declared} bytes, more than the limit of ${limit}`);
    }

    async function readLimited(response, url, limit, { dog, large, signal } = {}) {
      const declared = Number(response.headers.get('content-length'));
      if (declared > limit) {
        response.body?.cancel().catch(() => {});
        throw tooLarge(url, limit, declared);
      }
      if (!response.body?.getReader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > limit) throw tooLarge(url, limit);
        return bytes;
      }
      const reader = response.body.getReader();
      let buffer = new Uint8Array(Math.min(declared > 0 ? declared : limit, 65536));
      let size = 0, release = null;
      const turn = async () => {
        dog?.stop();
        release = await large.acquire(signal);
        dog?.rearm();
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const end = size + value.length;
          if (end > limit) throw tooLarge(url, limit);
          if (!release && large && end > LIMITS.large) await turn();
          if (end > buffer.length) {
            let room = Math.min(limit, Math.max(2 * buffer.length, end));
            if (declared >= end) room = Math.min(room, declared);
            if (!release && large && room > LIMITS.large) await turn();
            if (release && declared >= end) room = declared;
            const grown = new Uint8Array(room);
            grown.set(buffer.subarray(0, size));
            buffer = grown;
          }
          buffer.set(value, size);
          size = end;
          dog?.rearm();
        }
      } catch (error) {
        reader.cancel().catch(() => {});
        throw error;
      } finally {
        release?.();
      }
      return size === buffer.length ? buffer : buffer.slice(0, size);
    }

The client
----------

An `Http` client makes the requests. Its `fetch` can be replaced, which is
how the [tests](70-tests.md) read archives from the disk; by default it is
the browser's. Every request is checked for its scheme, carries no
credentials (an archive has no business with the reader's cookies), runs
in the pool, and is aborted when the reader cancels or a time limit
passes. The client counts the requests it makes and the bytes it reads.
A verification makes a client of its own (see
[the verification](17-verify.md)), so that its report gives the requests
and bytes of that run alone, and reads the archive afresh; two clients may
share one pool (`run`), so that together they stay within the limit of
requests in flight.

The client also counts what is spent for the page shown, against the
`budget` of a page (see the limits above): the requests made and the
bytes read since `newPage()` was last called, which
[the application](https://opensheaf.org/explorer/source/30-app.html) calls whenever the reader goes to another
page. A budget of `null` sets no such limit.

A client given `counts`, `{ files, bytes }`, counts in it the files and
bytes it reads, against `LIMITS.runFiles` and `LIMITS.runBytes`: these are
the counts of one resolver's run. A client given an `upstream` client
adds its requests and bytes to that one's too, so that a verification
reports what its resolver read.

    // in the HTTP client:
    export class Http {
      constructor({ fetch = globalThis.fetch?.bind(globalThis), concurrency = LIMITS.concurrency,
                    timeout = LIMITS.timeout, stall = LIMITS.stall, cacheLimit = LIMITS.cache,
                    run = pool(concurrency), large = pool(1),
                    budget = { requests: LIMITS.pageRequests, bytes: LIMITS.pageBytes },
                    spent = { requests: 0, bytes: 0 }, counts = null, upstream = null } = {}) {
        this.fetchImpl = fetch;
        this.run = run;
        this.large = large;
        this.timeout = timeout;
        this.stall = stall;
        this.cache = new Map();
        this.cacheLimit = cacheLimit;
        this.cacheBytes = 0;
        this.requests = 0;
        this.bytesRead = 0;
        this.budget = budget;
        this.spent = spent;
        this.counts = counts;
        this.upstream = upstream;
      }

      newPage() {
        this.spent.requests = 0;
        this.spent.bytes = 0;
      }

      <<another client like this one>>

      <<check the scheme of an address>>

      <<make one request>>

      <<find why a request failed>>

      <<requests whose answers are kept>>
    }

Another client, with an empty cache and counts of its own, is made by
`another()`. It shares the fetch, the time limits and the pools of this
one, so that together they stay within the limit of requests in flight
and read one large body at a time, and, unless told otherwise, its page
budget too: what it spends is spent for the same page. A verification
asks for one without a page budget; a member resolved again asks for one
so as to read the server again rather than the answers kept (see
[resolving members](15-resolve.md)).

    // in another client like this one:
    another({ budget = this.budget, counts = null, upstream = null } = {}) {
      return new Http({ fetch: this.fetchImpl, timeout: this.timeout, stall: this.stall, run: this.run,
                        large: this.large, cacheLimit: this.cacheLimit, budget,
                        spent: budget === this.budget ? this.spent : undefined, counts, upstream });
    }

Only `http:` and `https:` addresses are read; anything else (`file:`,
`data:`, `javascript:`) is refused before a request is made.

    // in check the scheme of an address:
    checkUrl(url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new FetchError('scheme', String(url), 'not an absolute URL');
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new FetchError('scheme', parsed.href, `${parsed.protocol} addresses cannot be read by a web page`);
      }
      return parsed.href;
    }

A request returns the bytes of the answer, or, for `HEAD`, the response
itself, whose headers give the size of a file. A status other than 2xx is
an error; 404 and 410 are told apart, since "not found" is what a reader
most often needs to see.

Some statuses say that the server is busy rather than that the file is
missing: 429 (too many requests) and 5xx. Static hosts answer so now and
then under the load of a verification that reads a whole archive (GitHub
Pages answered one 503 in a thousand requests while this was written), so
such a request is tried again, twice, after a pause of one and then three
seconds, before it counts as failed (as `busy`). A server may say how
long to wait, with the header `Retry-After` (a number of seconds, or a
date); the pause is then what it asks, but never more than
`LIMITS.retry`. The body of the busy answer is cancelled at once, and the
pause is made *outside* the pool: a request waiting to be tried again
does not hold a place that another could use, and a cancelled one stops
waiting at once.

    // in make one request:
    async request(url, { method = 'GET', limit = LIMITS.json, signal, headers } = {}) {
      url = this.checkUrl(url);
      const cancelled = () => new FetchError('aborted', url, 'cancelled');
      for (const wait of [1000, 3000, null]) {
        const release = await this.run.acquire(signal).catch(() => { throw cancelled(); });
        let answer;
        try {
          answer = await this.attempt(url, method, limit, signal, wait !== null, headers);
        } finally {
          release();
        }
        if (!(answer instanceof Busy)) return answer;
        await pause(answer.after ?? wait, signal).catch(() => { throw cancelled(); });
      }
    }

A busy answer carries the pause the server asked for, if any, in
milliseconds.

    // in the watchdog of a request:
    class Busy {
      constructor(retryAfter) {
        const s = String(retryAfter ?? '').trim();
        const ms = /^\d+$/.test(s) ? Number(s) * 1000 : s ? Date.parse(s) - Date.now() : NaN;
        this.after = Number.isNaN(ms) ? null : Math.min(Math.max(ms, 0), LIMITS.retry);
      }
    }

Before each try, the page budget is checked, and the counts of the run;
the try then counts as a request of the page, and its body may not read
more than the bytes left to the page and to the run. A body stopped by
that, and not by the limit of its own kind, is reported as `budget`, in
the words of opensheaf-py for the run. A try that passes `deadline` is a
`timeout`, "not read in 300 seconds", as opensheaf-py says it.

A body that breaks off after the answer has arrived (the connection is
cut, the server stops) is not diagnosed as a request that never got an
answer: the answer did arrive, so the browser had let the page read it,
and the failure is `network`, "the answer was interrupted", not a
cross-origin refusal.

A request may carry `headers`: only `Accept`, which the ORCID registry
needs to answer in JSON (see [the page of an owner](https://opensheaf.org/explorer/source/27-owner-page.html)),
and which a browser sends across origins without asking the server first.

One try, in its place in the pool, under its watchdog:

    // in make one request:
    async attempt(url, method, limit, signal, canRetry, headers) {
      const pageRoom = this.budget ? this.budget.bytes - this.spent.bytes : Infinity;
      const runRoom = this.counts ? LIMITS.runBytes - this.counts.bytes : Infinity;
      const room = Math.min(pageRoom, runRoom);
      if (this.budget && (this.spent.requests >= this.budget.requests || pageRoom <= 0)) {
        throw new FetchError('budget', url, `not read: this page has made ${this.spent.requests} requests ` +
          `and read ${this.spent.bytes} bytes, the most allowed for one page`);
      }
      const runOut = () => new FetchError('budget', url, `not read: the copies of this run have brought ` +
        `${LIMITS.runFiles} files or ${LIMITS.runBytes} bytes (section 15.2)`);
      if (this.counts && (this.counts.files >= LIMITS.runFiles || runRoom <= 0)) throw runOut();
      const dog = watchdog();
      const both = signal ? AbortSignal.any([signal, dog.signal]) : dog.signal;
      this.requests++;
      this.spent.requests++;
      if (this.upstream) this.upstream.requests++;
      dog.within(LIMITS.deadline, `not read in ${LIMITS.deadline / 1000} seconds`);
      dog.arm(this.timeout, `no answer in ${this.timeout / 1000} s`);
      try {
        let response;
        try {
          response = await this.fetchImpl(url, { method, signal: both, credentials: 'omit', redirect: 'follow',
                                                 ...(headers ? { headers } : {}) });
        } catch (error) {
          throw await this.diagnose(url, error, signal, dog);
        }
        const status = response.status;
        const busy = status === 429 || status >= 500;
        if (canRetry && busy) {
          response.body?.cancel().catch(() => {});
          return new Busy(response.headers.get('retry-after'));
        }
        if (!response.ok) {
          response.body?.cancel().catch(() => {});
          const kind = status === 404 || status === 410 ? 'not-found' : status === 403 ? 'forbidden' : busy ? 'busy' : 'http';
          throw new FetchError(kind, url, `HTTP ${status}`, status);
        }
        if (method === 'HEAD') return response;
        dog.arm(this.stall, `the answer stalled: nothing received for ${this.stall / 1000} s`);
        try {
          const bytes = await readLimited(response, url, Math.min(limit, room), { dog, large: this.large, signal });
          this.bytesRead += bytes.length;
          this.spent.bytes += bytes.length;
          if (this.upstream) this.upstream.bytesRead += bytes.length;
          if (this.counts) {
            this.counts.files++;
            this.counts.bytes += bytes.length;
          }
          return bytes;
        } catch (error) {
          if (error?.kind === 'too-large' && room < limit) {
            if (runRoom < pageRoom) throw runOut();
            throw new FetchError('budget', url, `not read whole: this page may read ${this.budget.bytes} bytes at most`);
          }
          if (error instanceof FetchError && error.kind !== 'aborted') throw error;
          throw this.interrupted(url, error, signal, dog);
        }
      } finally {
        dog.stop();
      }
    }

When `fetch` fails without an answer, the browser does not say why: a
refused cross-origin request and an unreachable server look the same to
the page, on purpose. A second request in `no-cors` mode tells them apart:
it is allowed to reach any server, and returns an opaque answer that the
page cannot read but that proves the server is there. If it succeeds, the
first failure was a cross-origin refusal. Outside a browser (in the tests)
there is no such thing, and the failure is a network error. A request
stopped by its watchdog is a `timeout`, which says which limit ran out.

    // in find why a request failed:
    async diagnose(url, error, signal, dog) {
      if (signal?.aborted) return new FetchError('aborted', url, 'cancelled');
      if (dog.fired) return new FetchError('timeout', url, dog.fired);
      const page = globalThis.location;
      if (page?.protocol === 'https:' && url.startsWith('http:') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) {
        return new FetchError('mixed', url, 'an http: address cannot be read from an https: page');
      }
      if (typeof document !== 'undefined') {
        try {
          await this.fetchImpl(url, { method: 'HEAD', mode: 'no-cors', credentials: 'omit',
                                      signal: AbortSignal.timeout(this.timeout) });
          return new FetchError('cors', url, 'the server does not allow other sites to read it ' +
                                '(no Access-Control-Allow-Origin header), or it is missing');
        } catch {
          // no answer at all: a network error
        }
      }
      return new FetchError('network', url, `cannot be reached (${error?.message || error})`);
    }

    interrupted(url, error, signal, dog) {
      if (signal?.aborted) return new FetchError('aborted', url, 'cancelled');
      if (dog.fired) return new FetchError('timeout', url, dog.fired);
      return new FetchError('network', url, `the answer was interrupted (${error?.message || error})`);
    }

The answers of most requests are kept: inventories and the files of
object versions never change (that is the point of OCFL), so reading them
twice would be waste, and the discovery document changes rarely enough.
Content files are not kept: they may be large, and are read once.

A kept answer is shared by everyone who asks for it while it is being
read, and their requests must not depend on one another. So the request
is made with a signal of its own, not with the signal of the first
caller; each caller waits with its own signal, and leaves when it is
aborted; only when every caller has left is the request aborted, and
forgotten at once, so that the next caller (the page the reader goes to,
which starts while the old one is being aborted) makes a new one instead
of receiving a request already cancelled. A failed request is forgotten
too, so that it can be tried again.

    // in requests whose answers are kept:
    cached(url, options = {}) {
      url = this.checkUrl(url);
      const { signal, ...rest } = options;
      let entry = this.cache.get(url);
      if (entry) {
        this.cache.delete(url);
        this.cache.set(url, entry);
      } else {
        const controller = new AbortController();
        entry = { controller, waiters: 0, settled: false, size: 0 };
        entry.answer = this.request(url, { ...rest, signal: controller.signal });
        this.cache.set(url, entry);
        entry.answer.then((bytes) => {
          entry.settled = true;
          if (this.cache.get(url) !== entry) return;
          entry.size = bytes.length;
          this.cacheBytes += entry.size;
          this.evict();
        }, () => {
          entry.settled = true;
          this.forget(url, entry);
        });
      }
      return this.share(url, entry, signal);
    }

    share(url, entry, signal) {
      if (signal?.aborted) return Promise.reject(new FetchError('aborted', url, 'cancelled'));
      entry.waiters++;
      return new Promise((resolve, reject) => {
        let left = false;
        const leave = () => {
          if (left) return false;
          left = true;
          signal?.removeEventListener('abort', give);
          if (--entry.waiters === 0 && !entry.settled) {
            entry.controller.abort();
            this.forget(url, entry);
          }
          return true;
        };
        const give = () => { if (leave()) reject(new FetchError('aborted', url, 'cancelled')); };
        signal?.addEventListener('abort', give, { once: true });
        entry.answer.then((bytes) => { if (leave()) resolve(bytes); },
                          (error) => { if (leave()) reject(error); });
      });
    }

The answers kept are bounded by `LIMITS.cache` bytes: when they pass it,
the answers used least recently are forgotten (a `Map` keeps the order in
which its entries were set, and an entry is set again whenever it is
used), and are read again if needed.

    // in requests whose answers are kept:
    forget(url, entry) {
      if (this.cache.get(url) !== entry) return;
      this.cache.delete(url);
      this.cacheBytes -= entry.size;
    }

    evict() {
      for (const [url, entry] of this.cache) {
        if (this.cacheBytes <= this.cacheLimit) break;
        if (entry.settled) this.forget(url, entry);
      }
    }

JSON is parsed from the kept bytes; the index page and the size of a file
are not kept. The size, for the estimate shown before the digests are
checked, comes from a `HEAD` request; it is what the server declares,
which for a compressed answer is the compressed size.

    // in requests whose answers are kept:
    async json(url, options = {}) {
      return parseJson(await this.cached(url, options), url);
    }

    async text(url, options = {}) {
      const bytes = await this.request(url, { limit: LIMITS.page, ...options });
      return new TextDecoder('utf-8').decode(bytes);
    }

    async size(url, options = {}) {
      const response = await this.request(url, { ...options, method: 'HEAD' });
      const length = response.headers.get('content-length');
      return length === null ? null : Number(length);
    }

JSON, as section 2 defines it, is UTF-8 without a byte order mark. Bytes
that are not UTF-8, or start with a byte order mark, or do not parse, are
an error of kind `json`. Bytes that start with `<` (after white space,
and a byte order mark if any) are an HTML page, where a file was
expected: an error of kind `html`, which says what probably happened
(see the explanations above).

JSON nested deeper than `LIMITS.nesting` levels is refused as
`too-large` before it is parsed. The depth is found in one pass over the
text: brackets count only outside strings, and a string ends at a
quotation mark that no backslash escapes. The depth is also what readers
of bytes already at hand look at (`jsonOrNull`, chapter
[07](07-owners.md)).

    // in decoding JSON:
    export function nesting(text) {
      let depth = 0, most = 0, inString = false;
      for (let k = 0; k < text.length; k++) {
        const c = text.charCodeAt(k);
        if (inString) {
          if (c === 92) k++;                                // \ escapes the next character
          else if (c === 34) inString = false;              // "
        } else if (c === 34) inString = true;
        else if (c === 91 || c === 123) most = Math.max(most, ++depth);   // [ {
        else if (c === 93 || c === 125) depth--;            // ] }
      }
      return most;
    }

    export function parseJson(bytes, url = '', { integers = false } = {}) {
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new FetchError('json', url, 'is not UTF-8 (section 2)');
      }
      if (/^\ufeff?\s*</.test(text)) {
        throw new FetchError('html', url, 'an HTML page, not the file: probably a wrong base URL or a site’s fallback page');
      }
      if (text.charCodeAt(0) === 0xfeff) throw new FetchError('json', url, 'starts with a byte order mark (section 2)');
      if (nesting(text) > LIMITS.nesting) {
        throw new FetchError('too-large', url, `is nested deeper than ${LIMITS.nesting} levels`);
      }
      try {
        return integers ? parseIntegers(text) : JSON.parse(text);
      } catch (error) {
        throw new FetchError('json', url, `is not JSON (${error.message})`);
      }
    }

The files whose numbers count, genesis records and `keys.json` (their
thresholds), are read with `integers`: every number in them must be an
integer as its text writes it, without a fraction or an exponent, and of
at most 2^53 - 1 in absolute value, the integers that JSON numbers and JCS
represent exactly, each by one number only (section 2; 2^53 + 1 is read
as 2^53). The reference implementation reads
`1.0` or `1e0` as a float, which is no threshold and has no canonical
form, and `9007199254740992` as an integer too large for JCS; a JavaScript
reader that took `JSON.parse` at its word would see the integers 1 and
2^53, and accept what the reference refuses.

The text of a number is what decides, so it is read from the text:
`JSON.parse` gives it to the reviver as `context.source` in the browsers
that have this (Chrome 114, Firefox 135, Node 21), and elsewhere the
number tokens are found in one pass over the text, outside strings, as
for the nesting above.

    // in decoding JSON:
    const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
    const EXACT = 2n ** 53n - 1n;

    export function numberProblem(token) {
      if (!INTEGER.test(token)) return `the number ${token} is not an integer written without a fraction or an exponent (section 2)`;
      const n = BigInt(token);
      return n > EXACT || n < -EXACT ? `the number ${token} is beyond 2^53 - 1 (section 2)` : null;
    }

    export function numberTokens(text, { constants = false } = {}) {
      const tokens = [];
      let inString = false;
      for (let k = 0; k < text.length; k++) {
        const c = text[k];
        if (inString) {
          if (c === '\\') k++;
          else if (c === '"') inString = false;
        } else if (c === '"') inString = true;
        else if (constants && /^-?(NaN|Infinity)/.test(text.slice(k, k + 9))) {
          const word = /^-?(NaN|Infinity)/.exec(text.slice(k, k + 9))[0];
          tokens.push(word);
          k += word.length - 1;
        } else if (c === '-' || (c >= '0' && c <= '9')) {
          let end = k;
          while (end < text.length && /[-+.eE0-9]/.test(text[end])) end++;
          tokens.push(text.slice(k, end));
          k = end - 1;
        }
      }
      return tokens;
    }

    const HAS_SOURCE = (() => {
      try {
        return JSON.parse('1', (key, value, context) => context?.source === '1') === true;
      } catch {
        return false;
      }
    })();

    export function parseIntegers(text, { source = HAS_SOURCE } = {}) {
      const check = (token) => {
        const problem = numberProblem(token);
        if (problem) throw new Error(problem);
      };
      if (!source) {
        const value = JSON.parse(text);
        numberTokens(text).forEach(check);
        return value;
      }
      return JSON.parse(text, (key, value, context) => {
        if (typeof value === 'number') check(context.source);
        return value;
      });
    }

The files of the specification other than genesis records and
`keys.json` (the discovery document, its pages, the index files,
`object.json`, `members.json`, and the evidence of branch points) are read
leniently where they are used, but the verifier holds them to section 2
as well, as opensheaf-py's `loads_format` does: UTF-8 without a byte
order mark, and every number an integer written without a fraction or an
exponent, of at most 2^53 - 1 in absolute value, extension data
included. `parseFormat` gives the value, or throws an `Error` whose
message is opensheaf-py's. The reason a text is not UTF-8 is given in
the words of Python's decoder (`utf8Problem`), and among several numbers
that break the rule the one named is the one opensheaf-py names, found
by walking the value as it walks it (a stack, each value's members
pushed in order, the last popped first); `NaN` and `Infinity`, which
Python's parser takes for numbers, are named as numbers too.

    // in decoding JSON:
    const BOM_MESSAGE = 'JSON is UTF-8 without a byte order mark, and this file starts with one (section 2)';

    export function parseFormat(bytes) {
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error(BOM_MESSAGE);
      const bad = utf8Problem(bytes);
      if (bad) throw new Error(`JSON is UTF-8, and this file is not (${bad}) (section 2)`);
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
      if (nesting(text) > LIMITS.nesting) throw new Error(`JSON nested more than ${LIMITS.nesting} levels deep`);
      class Bad {
        constructor(token) {
          this.problem = numberProblem(token);
        }
      }
      let value;
      try {
        value = HAS_SOURCE
          ? JSON.parse(text, (key, v, context) => (typeof v === 'number' && numberProblem(context.source) ? new Bad(context.source) : v))
          : JSON.parse(text);
      } catch (error) {
        const constant = numberTokens(text, { constants: true }).find((t) => /^-?(NaN|Infinity)$/.test(t));
        if (constant) throw new Error(numberProblem(constant));
        throw new Error(`not JSON (${error.message})`);
      }
      if (!HAS_SOURCE) {
        const token = numberTokens(text).find((t) => numberProblem(t));
        if (token) throw new Error(numberProblem(token));
        return value;
      }
      const todo = [value];
      while (todo.length) {
        const v = todo.pop();
        if (v instanceof Bad) throw new Error(v.problem);
        if (v !== null && typeof v === 'object') todo.push(...(Array.isArray(v) ? v : Object.values(v)));
      }
      return value;
    }

Why bytes are not UTF-8, as Python's decoder says it: the first byte
that cannot start a character (`invalid start byte`), or the bytes of a
character cut short by one that cannot continue it (`invalid continuation
byte`) or by the end of the data (`unexpected end of data`); `null` for
UTF-8. The second byte of a character of three or four bytes is held to
the ranges that leave out overlong forms, surrogates and code points
beyond U+10FFFF, as Python holds it.

    // in decoding JSON:
    export function utf8Problem(bytes) {
      const say = (start, end, why) => (end - start === 1
        ? `'utf-8' codec can't decode byte 0x${bytes[start].toString(16).padStart(2, '0')} in position ${start}: ${why}`
        : `'utf-8' codec can't decode bytes in position ${start}-${end - 1}: ${why}`);
      for (let k = 0; k < bytes.length;) {
        const b = bytes[k];
        if (b < 0x80) {
          k++;
          continue;
        }
        const size = b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
        if (!size) return say(k, k + 1, 'invalid start byte');
        const [low, high] = b === 0xe0 ? [0xa0, 0xbf] : b === 0xed ? [0x80, 0x9f] : b === 0xf0 ? [0x90, 0xbf]
          : b === 0xf4 ? [0x80, 0x8f] : [0x80, 0xbf];
        for (let j = 1; j < size; j++) {
          if (k + j >= bytes.length) return say(k, bytes.length, 'unexpected end of data');
          const c = bytes[k + j];
          if (j === 1 ? c < low || c > high : c < 0x80 || c > 0xbf) return say(k, k + j, 'invalid continuation byte');
        }
        k += size;
      }
      return null;
    }

Digests
-------

Integrity rests on SHA-512 digests (section 7.6): of every file, in the
inventories, and of every inventory, in its checksum file and in the pins
of collections. The browser computes them with WebCrypto, which needs no
library, and is available to pages served over `https:` or from
`localhost`. Digests are written in lowercase hexadecimal (section 2).

    // in the SHA-512 digest of bytes:
    export async function sha512(bytes) {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) {
        throw new FetchError('crypto', '', 'WebCrypto is not available (it needs https: or localhost)');
      }
      const digest = new Uint8Array(await subtle.digest('SHA-512', bytes));
      return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    }
