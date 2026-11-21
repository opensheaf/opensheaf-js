// Generated from literate/76-tests-github.md by opensheaf-literate: edit the document, not this file.
import { createHash } from 'node:crypto';

const enc = new TextEncoder();

function gitName(type, body) {
  return createHash('sha1').update(enc.encode(`${type} ${body.length}\0`)).update(body).digest('hex');
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const treeOrder = (a, b) => {
  const x = a.type === 'tree' ? a.name + '/' : a.name, y = b.type === 'tree' ? b.name + '/' : b.name;
  return x < y ? -1 : x > y ? 1 : 0;
};

export function fakeGitHub({ token = 'fake-token-of-the-tests', api = 'https://api.github.test' } = {}) {
  const objects = new Map(), repos = new Map(), calls = [], sites = new Map();
  const g = { api, token, objects, repos, calls, sites, truncate: Infinity, beforeMove: null, time: 1_700_000_000 };

  g.put = (type, body, extra = {}) => {
    const sha = gitName(type, body);
    if (!objects.has(sha)) objects.set(sha, { type, body, ...extra });
    return sha;
  };

  g.blob = (bytes) => g.put('blob', bytes);

  g.tree = (flat) => {
    const build = (prefix) => {
      const here = new Map();
      for (const [p, e] of flat) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length), k = rest.indexOf('/');
        if (k < 0) here.set(rest, { name: rest, type: 'blob', mode: e.mode, sha: e.sha });
        else if (!here.has(rest.slice(0, k))) here.set(rest.slice(0, k), { name: rest.slice(0, k), type: 'tree', mode: '40000' });
      }
      const entries = [...here.values()];
      for (const e of entries) if (e.type === 'tree') e.sha = build(prefix + e.name + '/');
      entries.sort(treeOrder);
      const body = concat(entries.flatMap((e) => [enc.encode(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')]));
      return g.put('tree', body, { entries });
    };
    return build('');
  };

  g.flat = (treeSha, prefix = '', out = new Map()) => {
    for (const e of objects.get(treeSha).entries) {
      if (e.type === 'tree') g.flat(e.sha, prefix + e.name + '/', out);
      else out.set(prefix + e.name, { mode: e.mode, sha: e.sha });
    }
    return out;
  };

  g.commit = (tree, parents, message) => {
    g.time += 60;
    const text = [`tree ${tree}`, ...parents.map((p) => `parent ${p}`),
                  `author Tests <tests@example.org> ${g.time} +0000`, `committer Tests <tests@example.org> ${g.time} +0000`,
                  '', message].join('\n');
    return g.put('commit', enc.encode(text), { tree, parents, message });
  };

  g.create = (repo, files, { branch = 'main' } = {}) => {
    repos.set(repo, { branch, refs: new Map() });
    const flat = new Map();
    for (const [p, v] of Object.entries(files)) {
      const [bytes, mode] = Array.isArray(v) ? v : [v, '100644'];
      flat.set(p, { mode, sha: g.blob(typeof bytes === 'string' ? enc.encode(bytes) : bytes) });
    }
    repos.get(repo).refs.set(branch, g.commit(g.tree(flat), [], 'The first commit'));
  };

  g.push = (repo, files, message = 'A push') => {
    const r = repos.get(repo), head = r.refs.get(r.branch);
    const flat = g.flat(objects.get(head).tree);
    for (const [p, v] of Object.entries(files)) {
      if (v === null) flat.delete(p);
      else flat.set(p, { mode: '100644', sha: g.blob(typeof v === 'string' ? enc.encode(v) : v) });
    }
    r.refs.set(r.branch, g.commit(g.tree(flat), [head], message));
  };

  g.head = (repo) => repos.get(repo).refs.get(repos.get(repo).branch);

  g.files = (repo, commit = g.head(repo)) => {
    const out = new Map();
    for (const [p, e] of g.flat(objects.get(commit).tree)) out.set(p, objects.get(e.sha).body);
    return out;
  };

  g.modes = (repo) => new Map([...g.flat(objects.get(g.head(repo)).tree)].map(([p, e]) => [p, e.mode]));

  const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');

  g.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    for (const [base, site] of sites) {
      if (String(url).startsWith(base)) {
        calls.push({ method: 'GET', path: String(url) });
        const p = decodeURIComponent(String(url).slice(base.length));
        const at = site.stale || g.head(site.repo);
        const bytes = g.files(site.repo, at).get(p);
        if (!bytes) return new Response('not found', { status: 404 });
        return new Response(site.alter?.has(p) ? enc.encode('altered') : bytes, { status: 200 });
      }
    }
    if (!String(url).startsWith(api + '/')) throw new TypeError(`no network in the tests: ${url}`);
    const method = init.method || 'GET';
    calls.push({ method, path: u.pathname + u.search });
    if ((init.headers?.Authorization || init.headers?.authorization) !== `Bearer ${token}`) {
      return json(401, { message: 'Bad credentials' });
    }
    const body = init.body ? JSON.parse(init.body) : null;
    const m = /^\/repos\/([^/]+\/[^/]+)(?:\/(.*))?$/.exec(u.pathname);
    const r = m && repos.get(m[1]);
    if (!r) return json(404, { message: 'Not Found' });
    const rest = m[2] || '';
    if (!rest) return json(200, { full_name: m[1], default_branch: r.branch, private: false });
    let x;
    if ((x = /^git\/ref\/heads\/(.+)$/.exec(rest)) && method === 'GET') {
      const sha = r.refs.get(decodeURIComponent(x[1]));
      return sha ? json(200, { ref: `refs/heads/${x[1]}`, object: { type: 'commit', sha } }) : json(404, { message: 'Not Found' });
    }
    if ((x = /^git\/commits\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
      const c = objects.get(x[1]);
      if (c?.type !== 'commit') return json(404, { message: 'Not Found' });
      return json(200, { sha: x[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message });
    }
    if ((x = /^git\/trees\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
      const t = objects.get(x[1]);
      if (t?.type !== 'tree') return json(404, { message: 'Not Found' });
      const item = (e, p) => ({ path: p, mode: e.mode, type: e.type, sha: e.sha,
                                ...(e.type === 'blob' ? { size: objects.get(e.sha).body.length } : {}) });
      if (u.searchParams.get('recursive')) {
        const all = [];
        const walk = (sha, prefix) => {
          for (const e of objects.get(sha).entries) {
            all.push(item(e, prefix + e.name));
            if (e.type === 'tree') walk(e.sha, prefix + e.name + '/');
          }
        };
        walk(x[1], '');
        if (all.length > g.truncate) return json(200, { sha: x[1], tree: all.slice(0, g.truncate), truncated: true });
        return json(200, { sha: x[1], tree: all, truncated: false });
      }
      return json(200, { sha: x[1], tree: t.entries.map((e) => item(e, e.name)), truncated: false });
    }
    if ((x = /^git\/blobs\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
      const b = objects.get(x[1]);
      if (b?.type !== 'blob') return json(404, { message: 'Not Found' });
      if ((init.headers?.Accept || '').includes('raw')) return new Response(b.body, { status: 200 });
      return json(200, { sha: x[1], content: b64(b.body), encoding: 'base64', size: b.body.length });
    }
    if (rest === 'git/blobs' && method === 'POST') {
      return json(201, { sha: g.blob(new Uint8Array(Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf-8'))) });
    }
    if (rest === 'git/trees' && method === 'POST') {
      const flat = body.base_tree ? g.flat(body.base_tree) : new Map();
      for (const e of body.tree) {
        if (e.sha === null) {
          flat.delete(e.path);
        } else {
          if (objects.get(e.sha)?.type !== 'blob') return json(422, { message: `tree.sha ${e.sha} is not a valid blob` });
          flat.set(e.path, { mode: e.mode, sha: e.sha });
        }
      }
      return json(201, { sha: g.tree(flat) });
    }
    if (rest === 'git/commits' && method === 'POST') {
      const sha = g.commit(body.tree, body.parents, body.message);
      return json(201, { sha, html_url: `https://github.test/${m[1]}/commit/${sha}` });
    }
    if ((x = /^git\/refs\/heads\/(.+)$/.exec(rest)) && method === 'PATCH') {
      if (g.beforeMove) {
        const f = g.beforeMove;
        g.beforeMove = null;
        f(m[1]);
      }
      const branch = decodeURIComponent(x[1]), current = r.refs.get(branch);
      if (!body.force && !objects.get(body.sha)?.parents.includes(current)) {
        return json(422, { message: 'Update is not a fast forward' });
      }
      r.refs.set(branch, body.sha);
      return json(200, { ref: `refs/heads/${branch}`, object: { type: 'commit', sha: body.sha } });
    }
    return json(404, { message: 'Not Found' });
  };

  return g;
}
