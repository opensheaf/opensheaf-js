// Generated from literate/10-http.md by opensheaf-literate: edit the document, not this file.
export const LIMITS = {
  json: 16 * 2 ** 20,      // a JSON file: discovery document, inventory, object.json, members.json
  page: 16 * 2 ** 20,      // the index page, read for the check of the presentation
  file: 512 * 2 ** 20,     // a content file whose digest is checked
  large: 32 * 2 ** 20,     // a body larger than this is read alone, one at a time
  cache: 64 * 2 ** 20,     // bytes of answers kept by one client
  timeout: 60_000,         // milliseconds to wait for the headers of an answer
  stall: 30_000,           // milliseconds to wait for the next piece of a body
  concurrency: 6,          // requests in flight at once
  depth: 3,                // levels of member collections followed
  pins: 2000,              // pins resolved in one walk through collections, or in one verification
  mirrors: 5,              // locations of copies (at, hints) tried for one line, after the archive explored
  versions: 10_000,        // object versions of one object
  objects: 10_000,         // objects of one archive listed or verified
  nesting: 64,             // levels of arrays and objects in a JSON file
  retry: 30_000,           // milliseconds a busy server may ask to be left alone (Retry-After)
  pageRequests: 40_000,    // requests made for one page
  pageBytes: 256 * 2 ** 20, // bytes read for one page
};

export class FetchError extends Error {
  constructor(kind, url, detail, status = null) {
    super(url ? `${url}: ${detail}` : detail);
    this.kind = kind;
    this.url = url;
    this.detail = detail;
    this.status = status;
  }
}

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

function watchdog() {
  const controller = new AbortController();
  let timer = null, ms = 0;
  return {
    signal: controller.signal,
    fired: null,
    why: '',
    arm(limit, why) {
      ms = limit;
      this.why = why;
      this.rearm();
    },
    rearm() {
      clearTimeout(timer);
      timer = setTimeout(() => { this.fired = this.why; controller.abort(); }, ms);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

class Busy {
  constructor(retryAfter) {
    const s = String(retryAfter ?? '').trim();
    const ms = /^\d+$/.test(s) ? Number(s) * 1000 : s ? Date.parse(s) - Date.now() : NaN;
    this.after = Number.isNaN(ms) ? null : Math.min(Math.max(ms, 0), LIMITS.retry);
  }
}

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

export class Http {
  constructor({ fetch = globalThis.fetch?.bind(globalThis), concurrency = LIMITS.concurrency,
                timeout = LIMITS.timeout, stall = LIMITS.stall, cacheLimit = LIMITS.cache,
                run = pool(concurrency), large = pool(1),
                budget = { requests: LIMITS.pageRequests, bytes: LIMITS.pageBytes },
                spent = { requests: 0, bytes: 0 } } = {}) {
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
  }

  newPage() {
    this.spent.requests = 0;
    this.spent.bytes = 0;
  }

  another({ budget = this.budget } = {}) {
    return new Http({ fetch: this.fetchImpl, timeout: this.timeout, stall: this.stall, run: this.run,
                      large: this.large, cacheLimit: this.cacheLimit, budget,
                      spent: budget === this.budget ? this.spent : undefined });
  }

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

  async attempt(url, method, limit, signal, canRetry, headers) {
    const room = this.budget ? this.budget.bytes - this.spent.bytes : Infinity;
    if (this.budget && (this.spent.requests >= this.budget.requests || room <= 0)) {
      throw new FetchError('budget', url, `not read: this page has made ${this.spent.requests} requests ` +
        `and read ${this.spent.bytes} bytes, the most allowed for one page`);
    }
    const dog = watchdog();
    const both = signal ? AbortSignal.any([signal, dog.signal]) : dog.signal;
    this.requests++;
    this.spent.requests++;
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
        return bytes;
      } catch (error) {
        if (error?.kind === 'too-large' && room < limit) {
          throw new FetchError('budget', url, `not read whole: this page may read ${this.budget.bytes} bytes at most`);
        }
        if (error instanceof FetchError && error.kind !== 'aborted') throw error;
        throw this.interrupted(url, error, signal, dog);
      }
    } finally {
      dog.stop();
    }
  }

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
}

function nesting(text) {
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

const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const EXACT = 2n ** 53n - 1n;

export function numberProblem(token) {
  if (!INTEGER.test(token)) return `the number ${token} is not an integer`;
  const n = BigInt(token);
  return n > EXACT || n < -EXACT ? `the integer ${token} has no exact form in JSON (section 2)` : null;
}

export function numberTokens(text) {
  const tokens = [];
  let inString = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (inString) {
      if (c === '\\') k++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '-' || (c >= '0' && c <= '9')) {
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

export async function sha512(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new FetchError('crypto', '', 'WebCrypto is not available (it needs https: or localhost)');
  }
  const digest = new Uint8Array(await subtle.digest('SHA-512', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
