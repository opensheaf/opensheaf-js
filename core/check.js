// Generated from literate/28-verify-folder.md by opensheaf-literate: edit the document, not this file.
import { Http, FetchError } from './http.js';
import { Archive } from './archive.js';
import { verify, Report } from './verify.js';
import { finding } from './rules.js';
import { storageFetch, readJson, joinPath, ORIGIN } from './storage.js';
import { ROTATION_FORMAT, SHEET_TITLE } from './keys.js';
import { unbase64 } from './crypto.js';

export async function verifyFolder(storage, { schemas, remote = false, fetch = globalThis.fetch,
                                              digests = true } = {}) {
  let base = ORIGIN;
  try {
    const cfg = await readJson(storage, 'osheaf.json');
    if (typeof cfg?.baseUrl === 'string' && /^https?:\/\/[^/]+\/(.*\/)?$/.test(cfg.baseUrl)) base = cfg.baseUrl;
  } catch {
    // a configuration that cannot be read gives no base URL
  }
  const http = new Http({ fetch: storageFetch(storage, base, { fallback: remote ? fetch : null }), budget: null });
  let report;
  try {
    const archive = await Archive.open(http, base);
    report = await verify(archive, { schemas, remote, digests });
  } catch (error) {
    if (!(error instanceof FetchError)) throw error;
    report = new Report(base, { remote, digests });
    report.add(finding('error', 'opensheaf.json', error.kind === 'not-found'
      ? 'the discovery document is missing (section 3.1)' : `not JSON: ${error.detail}`));
  }
  if (!report.findings.some((f) => f.message === 'specification 0.1: rebuild (section 16.1)')) {
    report.add(...await lookForKeys(storage));
  }
  return report;
}

export function findingsJson(report) {
  return report.findings.map((f) => ({ severity: f.level, place: f.place, message: f.message }));
}

const ROTATION_NAME = /^rotation-[a-z2-7]{16}-[a-z2-7]{16}\.txt$/;

export async function lookForKeys(storage) {
  const found = [];
  const walk = async (dir) => {
    for (const entry of (await storage.list(dir)) || []) {
      const path = joinPath(dir, entry.name);
      if (!dir && (entry.name === '.git' || entry.name.startsWith('.staging-'))) continue;
      if (entry.kind === 'dir') {
        await walk(path);
        continue;
      }
      if (entry.kind !== 'file') continue;
      let looks = ROTATION_NAME.test(entry.name) || (entry.name.endsWith('.key') && entry.name !== '.key');
      if (!looks) {
        const bytes = await storage.read(path);
        if (bytes && bytes.length < 4096) {
          const text = Array.from(bytes, (b) => (b < 128 ? String.fromCharCode(b) : '�')).join('');
          if (text.startsWith(ROTATION_FORMAT) || text.startsWith(SHEET_TITLE)) {
            looks = true;
          } else {
            try {
              looks = unbase64(text.trim()).length === 32;
            } catch {
              looks = false;
            }
          }
        }
      }
      if (looks) {
        found.push(finding('warning', path, 'looks like a private key: keys are never kept in an archive (section 15.4)'));
      }
    }
  };
  await walk('');
  return found;
}
