// Generated from literate/11-paths.md by opensheaf-literate: edit the document, not this file.
import { FetchError } from './http.js';
import { sha256, hex, utf8 } from './crypto.js';
import { parseId } from './names.js';

export const VERSION_RE = /^v[1-9][0-9]*$/;

export function isObjectId(s) {
  return parseId(s) !== null;
}

export function isVersion(s) {
  return typeof s === 'string' && VERSION_RE.test(s);
}

export function versionNumber(v) {
  return Number(String(v).slice(1));
}

export const OWNER_NAME_LAYOUT = 'opensheaf-owner-name-storage-layout';
export const HASHED_LAYOUT = '0003-hash-and-id-n-tuple-storage-layout';
export const LAYOUT_FILE = 'opensheaf-owner-name-storage-layout.md';

export async function pathOf(id, layout = OWNER_NAME_LAYOUT) {
  const parts = parseId(id);
  if (!parts) throw new FetchError('unsafe', '', `${JSON.stringify(id)}: not the identifier of a line or of a draft (sections 3.2 and 4)`);
  if (layout === HASHED_LAYOUT) {
    const h = hex(await sha256(utf8(id)));
    let encoded = [...id].map((c) => (/^[A-Za-z0-9_-]$/.test(c) ? c
      : Array.from(utf8(c), (b) => '%' + b.toString(16).padStart(2, '0')).join(''))).join('');
    if (encoded.length > 100) encoded = encoded.slice(0, 100) + '-' + h;
    return [h.slice(0, 3), h.slice(3, 6), h.slice(6, 9), encoded];
  }
  return parts.draft ? ['draft', parts.draft] : [parts.owner, parts.name];
}

export function logicalPathProblem(p) {
  if (typeof p !== 'string') return 'is not a string';
  if (p.includes('\\')) return 'has a \\';
  if (p.split('/').some((x) => x === '' || x === '.' || x === '..')) return 'has an empty, . or .. segment';
  if (p.normalize('NFC') !== p) return 'is not in Unicode normalisation form C';
  return null;
}

export function unsafePath(path) {
  if (typeof path !== 'string' || path === '') return 'is empty';
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') return 'has an empty, . or .. segment';
    if (/[\u0000-\u001f\u007f\\]/.test(segment)) return 'has a control character or a backslash';
  }
  return null;
}

export function contentPathProblem(cp, contentDirectory = 'content') {
  const unsafe = unsafePath(cp);
  if (unsafe) return unsafe;
  const [ver, dir, ...rest] = cp.split('/');
  if (!isVersion(ver) || dir !== contentDirectory || rest.length === 0) {
    return `is not in the content directory of a version (vN/${contentDirectory}/...)`;
  }
  return null;
}

function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%(3D|2C|3A|40|2B|24|26|3B)/g, (m) => decodeURIComponent(m));
}

export function under(root, segments) {
  let url = root;
  segments.forEach((segment, k) => {
    const problem = unsafePath(segment) || (segment.includes('/') ? 'has a /' : null);
    if (problem) throw new FetchError('unsafe', root, `the name ${JSON.stringify(segment)} ${problem}`);
    url += encodeSegment(segment) + (k + 1 < segments.length ? '/' : '');
  });
  if (!new URL(url).href.startsWith(new URL(root).href)) {
    throw new FetchError('unsafe', url, 'is not under the storage root');
  }
  return url;
}

export function underPath(root, path) {
  const problem = unsafePath(path);
  if (problem) throw new FetchError('unsafe', root, `the path ${JSON.stringify(path)} ${problem}`);
  return under(root, path.split('/'));
}
