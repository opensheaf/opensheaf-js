// Generated from literate/75-tests-services.md by opensheaf-literate: edit the document, not this file.
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const fixtures = process.argv[2];
const TOKEN = 'Bearer fake-token-of-the-tests';
const PREFIX = { 'zenodo.org': '10.5281', 'sandbox.zenodo.org': '10.5072' };
const services = {}, calls = [];
let base = '';

const service = (host) => (services[host] ??= { records: new Map(), next: 100, mismatch: false });

function zenodo(host, req, p, body, send) {
  const s = service(host), prefix = PREFIX[host];
  const call = { host, method: req.method, path: p };
  if (body.length) {
    call.body = (req.headers['content-type'] || '').startsWith('application/json') ? JSON.parse(body.toString('utf-8'))
      : { md5: crypto.createHash('md5').update(body).digest('hex'), bytes: body.length };
  }
  calls.push(call);
  if (req.headers.authorization !== TOKEN) return send(403, { message: 'not the token of the tests' });
  const record = (concept) => {
    s.next += 1;
    const rec = { id: s.next, conceptrecid: concept || s.next + 1000,
                  links: { bucket: `${base}${host}/bucket/${s.next}`, latest_draft: `${base}${host}/api/deposit/depositions/${s.next}` },
                  files: concept ? [{ id: 'inherited' }] : [] };
    s.records.set(rec.id, rec);
    return rec;
  };
  const parts = p.split('/');
  if (req.method === 'POST' && p === '/api/deposit/depositions') return send(201, record(null));
  if (p.endsWith('/actions/newversion')) {
    const rec = record(s.records.get(Number(parts.at(-3))).conceptrecid);
    return send(201, { links: { latest_draft: rec.links.latest_draft } });
  }
  if (p.endsWith('/actions/publish')) {
    const rec = s.records.get(Number(parts.at(-3)));
    const doi = `${prefix}/zenodo.${rec.id}${s.mismatch ? '9' : ''}`;
    s.mismatch = false;
    return send(202, { doi, conceptdoi: `${prefix}/zenodo.${rec.conceptrecid}` });
  }
  if (req.method === 'GET') return send(200, s.records.get(Number(parts.at(-1))));
  if (req.method === 'PUT' && p.startsWith('/bucket/')) {
    return send(200, { checksum: 'md5:' + crypto.createHash('md5').update(body).digest('hex') });
  }
  if (req.method === 'DELETE') return send(204, null);
  return send(200, {});
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const u = new URL(req.url, base);
  const send = (status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(value === null ? '' : JSON.stringify(value));
  };
  if (u.pathname === '/_calls') return send(200, calls);
  if (u.pathname.startsWith('/_mismatch/')) {
    service(u.pathname.slice('/_mismatch/'.length)).mismatch = true;
    return send(200, {});
  }
  const [, host, ...rest] = u.pathname.split('/');
  if (host in PREFIX) return zenodo(host, req, '/' + rest.join('/'), body, send);
  calls.push({ host, method: req.method, path: '/' + rest.join('/') + u.search });
  const id = u.searchParams.get('identifier');
  const file = path.join(fixtures, host, ...rest.map(decodeURIComponent), ...(id ? [id.replace(/[:/]/g, '_')] : []));
  if (!path.resolve(file).startsWith(path.resolve(fixtures) + path.sep)) return send(404, null);
  try {
    const data = await readFile(file);
    res.writeHead(200);
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(0, '127.0.0.1', () => {
  base = `http://127.0.0.1:${server.address().port}/`;
  process.stdout.write(`port ${server.address().port}\n`);
});
