Untrusted names and storage layouts
===================================

> This chapter is chapter 11 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/11-paths.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


An archive names its files by identifiers and paths that the explorer
puts into addresses: the identifier of an object gives its folder in the
storage root, by the layout the discovery document names (section 3.2),
the object version gives the folder of a version, and the content paths
of an inventory give the files. These names come from the archive, or
from another archive through a collection, and are untrusted (section
15.2). A name like `../../elsewhere` would make the explorer read outside
the storage root, and a name with `?` or `#` would change the meaning of
the address. So every name is checked before it becomes part of an
address, and an address is built only by appending checked,
percent-encoded segments to the storage root, which keeps it under the
root by construction.

The module is `core/paths.js`. It also holds the rules of section 4.1 on
logical paths, which the verification reports.

    // in core/paths.js:
    import { FetchError } from './http.js';
    import { sha256, hex, utf8 } from './crypto.js';
    import { parseId } from './names.js';

Identifiers and version names
-----------------------------

An identifier is `sheaf:<name>:<owner>`, or `sheaf:draft:<id>` for a
draft (sections 4 and 10.1; chapter [06](06-names.md) reads them); any
other is an error of the layout. An object version is `v` followed by a
number without leading zeros (section 4.1 forbids zero-padding). Versions
are compared by their numbers, never as strings, for which `v10` would
come before `v9`.

    // in core/paths.js:
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

Storage layouts
---------------

Section 3.2 has two layouts. In the owner-name layout, the default, the
line `sheaf:<name>:<owner>` is at `<owner>/<name>/`, so that an owner's
key log, `sheaf:<owner>:<owner>`, is at `<owner>/<owner>/`, and a draft
at `draft/<id>/`. In the hashed layout, OCFL's extension 0003 with its
default parameters, an object is at three tuples of three characters of
the hexadecimal SHA-256 digest of its identifier, then the identifier
percent-encoded (every character but letters, digits, `-` and `_`, in
lowercase hexadecimal) and, when that is longer than 100 characters,
shortened to its first 100, `-` and the digest. Identifiers of lines are
always shortened so (appendix C gives an example, which the tests
check). A reader computes paths, and never decodes them.

The path is a list of segments; an identifier of no known form is
refused, as `osheaf` refuses it.

    // in core/paths.js:
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

Logical paths
-------------

Section 4.1: logical paths are in Unicode normalisation form C, and do
not begin or end with `/`, or contain empty, `.` or `..` segments, or
`\`. The answer is the reason a path is rejected, or `null`; the
verification reports it in the words of `osheaf verify`.

    // in core/paths.js:
    export function logicalPathProblem(p) {
      if (typeof p !== 'string') return 'is not a string';
      if (p.includes('\\')) return 'has a \\';
      if (p.split('/').some((x) => x === '' || x === '.' || x === '..')) return 'has an empty, . or .. segment';
      if (p.normalize('NFC') !== p) return 'is not in Unicode normalisation form C';
      return null;
    }

Safe segments
-------------

What goes into an address must be stricter than the rules of section 4.1,
since an address has its own syntax: no empty segment (`a//b`), no `.` or
`..`, no backslash (which some servers read as a slash) and no control
character. Everything else is allowed, and percent-encoded when the
address is built, so that a file called `notes #2.pdf` is fetched as
such, and the folder `sheaf%3a...` of the hashed layout as `sheaf%253a...`.
A content path of an inventory must moreover be inside a version folder
of the object (`v3/content/...`), which is where OCFL puts content (OCFL
1.1, section 3.3); one that is not is reported by the verification, and
not fetched.

    // in core/paths.js:
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

An address under a root
-----------------------

A segment is percent-encoded except for the characters that RFC 3986
allows as they are in a segment of a path (`=`, `,`, `:`, `@`, `+`, `$`,
`&`, `;`, besides letters, digits and `-._~!*'()`): OCFL names its
declaration files `0=ocfl_1.1` and `0=ocfl_object_1.1`, and an address
should name a file as the archive does.

    // in core/paths.js:
    function encodeSegment(segment) {
      return encodeURIComponent(segment).replace(/%(3D|2C|3A|40|2B|24|26|3B)/g, (m) => decodeURIComponent(m));
    }

An address is the root (a storage root, always ending with `/`) followed
by segments, each checked and percent-encoded. The result is checked
once more against the root, so that no future change of this function can
make it leave the root silently.

    // in core/paths.js:
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
