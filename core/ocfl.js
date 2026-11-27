// Generated from literate/50-ocfl.md by opensheaf-literate: edit the document, not this file.
import { LIMITS, nesting, utf8Problem } from './http.js';
import { joinPath } from './storage.js';

const MESSAGES = {
  E001a: [['file'], 'OCFL Object root contains unexpected file: %s'],
  E001b: [['dir'], 'OCFL Object root contains unexpected directory: %s'],
  E001c: [['entry'], 'OCFL Object root contains unexpected entry that isn\'t a file or directory: %s'],
  E003a: [['assumed_version'], 'OCFL Object version declaration file is missing (assuming version %s)'],
  E003b: [['files', 'using_version'], 'OCFL Object includes more that one file that looks like an object declaration (got %s), using version %s'],
  E003c: [['assumed_version'], 'OCFL Object includes one or more object declaration files (starting 0=) but no valid version number could be extracted from any of them (assuming version %s)'],
  E003d: [['path'], 'OCFL Storage Root hierarchy includes directory %s with more that one file that looks like an object declaration, ignoring'],
  E003e: [['path'], 'No OCFL Object to validate at path %s. The root of an OCFL Object must be a directory containing an object declaration'],
  E004a: [['path', 'version'], 'OCFL Storage Root hierarchy includes directory %s with an object declaration giving unknown version %s, ignoring'],
  E004b: [['path', 'declaration'], 'OCFL Storage Root hierarchy includes directory %s with an unrecognized object declaration %s, ignoring'],
  E006: [['filename'], 'The OCFL object conformance declaration filename must be 0=ocfl_object_, followed by the OCFL specification version number, got %s instead'],
  E007: [['filename'], 'OCFL Object declaration file %s contents do not match file name without leading 0= (the \'dvalue\')'],
  E008: [['where'], 'OCFL Object %s inventory versions block does not contain any versions, there must be at least version 1'],
  E009: [['where'], 'OCFL Object %s inventory versions block does not contain v1 or a zero padded equivalent'],
  E010: [['where'], 'OCFL Object %s inventory versions block includes an out-of-sequence version'],
  E015: [['where', 'entry'], 'OCFL Object version directory %s includes an illegal file (%s)'],
  E017: [['where'], 'OCFL Object %s inventory contentDirectory must be a string and must not contain a forward slash (/)'],
  E018: [['where'], 'OCFL Object %s inventory contentDirectory must not be either . or ..'],
  E019: [['where'], 'OCFL Object %s inventory sets contentDirectory whereas it was not set in the first version inventory'],
  E020: [['where', 'version_content_directory', 'root_content_directory'], 'OCFL Object %s inventory contentDirectory %s does not match root contentDirectory %s'],
  E023a: [['where', 'extra_files'], 'OCFL Object includes one or more files that are not mentioned in the  %s inventory manifest (%s)'],
  E023b: [['where', 'missing_filepaths'], 'OCFL Object %s manifest does not include files listed in previous version manifests (%s)'],
  E024: [['where', 'path'], 'OCFL Object version %s content directory includes empty path %s'],
  E025a: [['where', 'digest_algorithm'], 'OCFL Object %s inventory `digestAlgorithm` attribute not an allowed digest type (got \'%s\')'],
  E025b: [['where', 'digest', 'algorithm'], 'OCFL Object %s inventory manifest block includes a digest (%s) that doesn\'t have the correct form for the %s algorithm'],
  E026a: [['where', 'digest'], 'OCFL Object %s inventory uses unknown digest type %s'],
  E033: [['where', 'explanation'], 'OCFL Object %s inventory is not valid JSON (%s)'],
  E036a: [['where'], 'OCFL Object %s inventory missing `id` attribute'],
  E036b: [['where'], 'OCFL Object %s inventory missing `type` attribute'],
  E036c: [['where'], 'OCFL Object %s inventory missing `digestAlgorithm` attribute'],
  E036d: [['where'], 'OCFL Object %s inventory missing `head` attribute'],
  E037a: [['where'], 'OCFL Object %s inventory `id` attribute is empty or badly formed'],
  E037b: [['where', 'version_id', 'root_id'], 'OCFL Object %s inventory id `%s` does not match the value in the root inventory `%s`'],
  E038a: [['where', 'expected', 'got'], 'OCFL Object %s inventory `type` attribute has wrong value (expected %s, got %s)'],
  E038b: [['where', 'got', 'assumed_spec_version'], 'OCFL Object %s inventory `type` attribute does not look like a valid specification URI (got %s), will proceed as if using version %s'],
  E038c: [['where', 'got', 'assumed_spec_version'], 'OCFL Object %s inventory `type` attribute has an unsupported specification version number (%s), will proceed as if using version %s'],
  E038d: [['where'], 'OCFL Object %s inventory `type` attribute does not have a string value'],
  E040: [['where', 'got', 'expected'], 'OCFL Object %s inventory head attribute doesn\'t match versions (got %s, expected %s)'],
  E041a: [['where'], 'OCFL Object %s inventory missing `manifest` attribute'],
  E041b: [['where'], 'OCFL Object %s inventory missing `versions` attribute'],
  E041c: [['where'], 'OCFL Object %s inventory manifest block is not a JSON object'],
  E042a: [['where', 'path'], 'OCFL Object %s inventory manifest includes invalid content path %s'],
  E042b: [['where', 'path'], 'OCFL Object %s inventory manifest includes content path %s with invalid version directory'],
  E042c: [['where', 'path', 'content_directory'], 'OCFL Object %s inventory manifest includes invalid content path %s that doesn\'t match the content directory name %s'],
  E044: [['where'], 'OCFL Object %s inventory versions block is not a JSON object'],
  E046a: [['version_dir'], 'OCFL Object root inventory describes version %s but no corresponding version directory is present'],
  E046b: [['dir'], 'OCFL Object includes directory %s that looks like a version directory but isn\'t a valid version in the inventory'],
  E048: [['where', 'version'], 'OCFL Object %s inventory %s version block does not include a created date or it is malformed'],
  E048c: [['where', 'version'], 'OCFL Object %s inventory %s version block does not include a state block'],
  E049a: [['where', 'version'], 'OCFL Object %s inventory %s version block created date SHOULD include a timezone designator'],
  E049b: [['where', 'version'], 'OCFL Object %s inventory %s version block created date SHOULD be granular to the seconds level'],
  E049c: [['where', 'version', 'description'], 'OCFL Object %s inventory %s version block has bad created date, must be IS8601 (%s)'],
  E049d: [['where', 'version'], 'OCFL Object %s inventory %s version block created value is not a JSON string'],
  E050a: [['where', 'digests'], 'OCFL Object %s inventory state refers to one or more digests that are not in the manifest (%s)'],
  E050c: [['where', 'version'], 'OCFL Object %s inventory %s version block state block is not a JSON object'],
  E050d: [['where', 'version', 'digest'], 'OCFL Object %s inventory %s version state block includes a bad digest (%s)'],
  E050e: [['where', 'version', 'digest'], 'OCFL Object %s inventory %s version block state block value for digest %s is not list'],
  E050f: [['where', 'version', 'digest'], 'OCFL Object %s inventory version %s state includes digest value %s that is not listed in the manifest block'],
  E052: [['where', 'version', 'path'], 'OCFL Object %s inventory %s version block state block includes an invalid path %s that starts or ends with /'],
  E053: [['where', 'version', 'path'], 'OCFL Object %s inventory %s version block state block includes an invalid path %s that includes . .. or //'],
  E054a: [['where', 'version'], 'OCFL Object %s inventory %s version block has user key with value that isn\'t a JSON object'],
  E054b: [['where', 'version'], 'OCFL Object %s inventory %s version block has user/name key with value that isn\'t a string'],
  E054c: [['where', 'version'], 'OCFL Object %s inventory %s version block has user/address key with value that isn\'t a string'],
  E056a: [['where'], 'OCFL Object %s inventory includes a fixity key with value that isn\'t a JSON object'],
  E056b: [['where', 'algorithm'], 'OCFL Object %s inventory fixity block includes a key that is not a known digest algorithm name: %s'],
  E057a: [['where', 'algorithm'], 'OCFL Object %s inventory fixity block entry for digest algorithm name %s is not a JSON object'],
  E057b: [['where', 'algorithm', 'digest'], 'OCFL Object %s inventory fixity block entry for digest algorithm %s includes digest %s which has the wrong form'],
  E057c: [['where', 'algorithm', 'digest'], 'OCFL Object %s inventory fixity block entry for digest algorithm %s, digest %s is not a JSON list'],
  E057d: [['where', 'algorithm', 'digest', 'path'], 'OCFL Object %s inventory fixity block entry for digest algorithm %s, digest %s includes a content path %s that is not in the manifest'],
  E058a: [['where', 'path'], 'OCFL Object %s inventory is missing sidecar digest file at %s'],
  E058b: [['inv_digest_file'], 'Cannot extract digest type from inventory digest file name %s'],
  E060: [['inv_file', 'actual', 'recorded', 'inv_digest_file'], 'Mismatch between actual and recorded inventory digests for %s (calculated %s but read %s from %s)'],
  E061: [['description'], 'Cannot extract digest from inventory digest file (%s)'],
  E063: [null, 'OCFL Object root inventory is missing'],
  E064: [['root_inv_file', 'inv_file'], 'Object root inventory and copy in last version MUST be identical but are not (%s and %s)'],
  E066a: [['prior_head', 'where'], 'OCFL Object inventory for %s doesn\'t have a subset of version blocks of inventory for %s'],
  E066b: [['prior_head', 'version', 'where', 'logical_paths', 'only_in'], 'OCFL Object %s inventory %s version state doesn\'t have same logical paths as same version in %s inventory (paths %s only in %s inventory)'],
  E066c: [['prior_head', 'version', 'logical_path', 'prior_content', 'where', 'current_content'], 'OCFL Object %s inventory %s version state has logical path %s that maps to content path %s, but in %s inventory it maps to content path %s'],
  E066d: [['where', 'version', 'digest', 'logical_files', 'prior_head'], 'OCFL Object %s inventory %s version state has digest %s (mapping to logical files %s) that does not appear in the %s inventory'],
  E066e: [['prior_head', 'version', 'digest', 'logical_files', 'where'], 'OCFL Object %s inventory %s version state has digest %s (mapping to logical files %s) that does not appear in the %s inventory'],
  E067: [['entry'], 'OCFL Object extensions direct contains an unexpected non-directory entry: %s'],
  E069a: [['root'], 'OCFL Storage Root %s lacks required 0= declaration file'],
  E069b: [['root'], 'OCFL Storage Root %s has more than one 0= declaration file'],
  E069c: [['root', 'namaste_file'], 'OCFL Storage Root %s has unrecognized 0= declaration file %s'],
  E069e: [['root', 'namaste_file'], 'OCFL Storage Root %s required declaration file %s has invalid content'],
  E070a: [['root', 'message'], 'OCFL Storage Root %s includes ocfl_layout.json with unknown layout %s'],
  E070b: [['root', 'message'], 'OCFL Storage Root %s has an ocfl_layout.json file that isn\'t a JSON object'],
  E070c: [['root', 'message'], 'OCFL Storage Root %s Storage root %s has layout file doesn\'t have required extension and description string entries'],
  E071: [['root', 'layout_name'], 'OCFL Storage Root %s includes ocfl_layout.json with unknown layout %s'],
  E072: [['path'], 'OCFL storage root hierarchy include directory %s with at least one file but no object declaration. Such additional files are not allowed'],
  E073: [['path'], 'OCFL storage root hierarchy contains an empty directory: %s'],
  E086: [['entry'], 'OCFL Storage Root extensions direct contains an unexpected non-directory entry: %s'],
  E092a: [['where', 'digest_algorithm', 'digest', 'content_path', 'content_digest'], 'OCFL Object %s inventory manifest using digest algorithm %s has digest %s for file %s which doesn\'t match calculated digest %s for that file'],
  E092b: [['where', 'content_path'], 'OCFL Object %s inventory manifest refers to a file path that is not present in the object (%s)'],
  E093a: [['where', 'digest_algorithm', 'digest', 'content_path', 'content_digest'], 'OCFL Object %s inventory fixity block for digest algorithm %s has digest %s for file %s which doesn\'t match calculated digest %s for that file'],
  E093b: [['where', 'digest_algorithm', 'digest', 'content_path'], 'OCFL Object %s inventory fixity block for digest algorithm %s has digest %s for a file %s which does not exist in the object'],
  E094: [['where', 'version'], 'OCFL Object %s inventory %s version block has message key with value that isn\'t a string'],
  E095a: [['where', 'version', 'path'], 'OCFL Object %s inventory version %s state has logical path %s used more than once'],
  E095b: [['where', 'version', 'path'], 'OCFL Object %s inventory version %s state has logical path %s used as both a directory and a file path.'],
  E096: [['where', 'digest'], 'OCFL Object %s inventory manifest block includes digest %s more than once with different normalizations'],
  E097: [['where', 'algorithm', 'digest'], 'OCFL Object %s inventory fixity block for digest algorithm %s, includes digest %s more than once with different normalizations'],
  E099: [['where', 'path'], 'OCFL Object %s inventory manifest content path %s includes invalid element ., .., or empty (//).'],
  E100: [['where', 'path'], 'OCFL Object %s inventory manifest content path %s must not begin or end with /.'],
  E101a: [['where', 'path'], 'OCFL Object %s inventory manifest content path %s is repeated'],
  E101b: [['where', 'path'], 'OCFL Object %s inventory manifest content path %s used as both a directory and a file path'],
  E103: [['where', 'this_spec_version', 'prev_version_dir', 'prev_spec_version'], 'OCFL Object %s inventory conforms to specification version %s which is an earlier version than the %s inventory which conforms to specification version %s'],
  E107: [['where', 'digests'], 'OCFL Object %s inventory manifest contains digest(s) (%s) that are not used in the object state'],
  E111: [['where'], 'OCFL Object %s inventory includes a fixity key with value that isn\'t a JSON object'],
  W001: [['where'], 'OCFL Object %s inventory version numbers SHOULD NOT be zero-padded'],
  W002: [['where', 'entry'], 'OCFL Object version directory %s SHOULD NOT contain any directory except the designated content directory (found %s)'],
  W003: [['where'], 'OCFL Object version directory %s SHOULD NOT contain an empty content directory'],
  W004: [['where'], 'OCFL Object %s inventory SHOULD use sha512 but uses sha256 as the DigestAlgorithm'],
  W005: [['where', 'id'], 'OCFL Object %s inventory id SHOULD be a URI (got %s)'],
  W007a: [['where', 'version'], 'OCFL Object %s inventory %s version block SHOULD include a message key'],
  W007b: [['where', 'version'], 'OCFL Object %s inventory %s version block SHOULD include a user key'],
  W008: [['where', 'version'], 'OCFL Object %s inventory %s version block user description SHOULD have an address'],
  W009: [['where', 'version'], 'OCFL Object %s inventory %s version block user description SHOULD be a mailto: or person identifier URI'],
  W010: [['where'], 'OCFL Object %s SHOULD have an inventory file but does not'],
  W011: [['key', 'version', 'prior_head', 'where'], 'OCFL Object version metadata \'%s\' for %s in %s inventory does not match that in %s inventory'],
  W013: [['entry'], 'OCFL Object includes unregistered extension directory \'%s\''],
  W901: [['entry'], 'OCFL Storage Root includes unregistered extension directory \'%s\''],
  E901: [['path', 'limit'], 'OCFL Object file %s is larger than %s bytes, the limit of this validator (LIMITS.file): its digests are not checked'],
  E902: [['path', 'explanation'], 'OCFL file %s is not read: %s, the limits of this validator (LIMITS.json, LIMITS.nesting)'],
  E903: [['limit'], 'OCFL Storage Root holds more than %s objects, the limit of this validator (LIMITS.objects): the others are not checked'],
  E904: [['explanation'], 'The validation stops here, where ocfl-py would stop with an exception of Python (%s)'],
};

export class ValidationLog {
  constructor({ logWarnings = false, logErrors = true, specVersion = DEFAULT_SPEC_VERSION } = {}) {
    this.logWarnings = logWarnings;
    this.logErrors = logErrors;
    this.specVersion = specVersion;
    this.codes = {};
    this.messages = [];
    this.errors = [];
    this.warnings = [];
    this.numErrors = 0;
    this.numWarnings = 0;
  }

  get specUrl() {
    return `https://ocfl.io/${this.specVersion}/spec/`;
  }

  log(code, isError, args) {
    const severity = isError ? 'error' : 'warning';
    let message;
    if (Object.hasOwn(MESSAGES, code)) {
      const [params, text] = MESSAGES[code];
      let desc = text;
      if (params) {
        const values = params.map((p) => (Object.hasOwn(args, p) ? pyStr(args[p]) : '???'));
        const holes = (text.match(/%s/g) || []).length;
        if (holes === values.length) {
          let k = 0;
          desc = text.replace(/%s/g, () => values[k++]);
        } else {
          desc = `${text} ${pyRepr(args)}`;
        }
      }
      message = `[${code}] ${desc}`;
    } else {
      message = `Unknown ${severity}: ${code} - params (${pyRepr(args)})`;
    }
    const m = /^([EW](\d\d\d))/.exec(code);
    if (m && Number(m[2]) < 200) message += ` (see ${this.specUrl}#${m[1]})`;
    this.codes[code] = message;
    if ((isError && this.logErrors) || (!isError && this.logWarnings)) this.messages.push(message);
    (isError ? this.errors : this.warnings).push({ code, message });
  }

  error(code, args = {}) {
    this.log(code, true, args);
    this.numErrors++;
  }

  warning(code, args = {}) {
    this.log(code, false, args);
    this.numWarnings++;
  }

  statusStr(prefix = '') {
    return [...this.messages].sort(compareCodePoints).map((m) => prefix + m).join('\n');
  }
}

function compareCodePoints(a, b) {
  const x = [...a], y = [...b];
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const d = x[k].codePointAt(0) - y[k].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
}

export class PyFloat {
  constructor(value) {
    this.value = value;
  }
}

export class PyStop extends Error {}

const isDict = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && !(x instanceof PyFloat);
const isList = (x) => Array.isArray(x);
const isStr = (x) => typeof x === 'string';

function pyType(x) {
  if (x === null || x === undefined) return 'NoneType';
  if (typeof x === 'boolean') return 'bool';
  if (typeof x === 'number' || typeof x === 'bigint') return 'int';
  if (x instanceof PyFloat) return 'float';
  if (isStr(x)) return 'str';
  return isList(x) ? 'list' : 'dict';
}

function has(container, key) {
  if (isDict(container)) return isStr(key) && Object.hasOwn(container, key);
  if (isList(container)) return container.some((x) => pyEq(x, key));
  if (isStr(container)) return container.includes(key);
  throw new PyStop(`TypeError: argument of type '${pyType(container)}' is not iterable`);
}

function get(container, key) {
  if (isDict(container)) {
    if (!Object.hasOwn(container, key)) throw new PyStop(`KeyError: ${pyRepr(key)}`);
    return container[key];
  }
  if (isList(container) || isStr(container)) throw new PyStop(`TypeError: ${pyType(container)} indices must be integers or slices, not str`);
  throw new PyStop(`TypeError: '${pyType(container)}' object is not subscriptable`);
}

function pyIter(x) {
  if (isDict(x)) return Object.keys(x);
  if (isList(x)) return x;
  if (isStr(x)) return [...x];
  throw new PyStop(`TypeError: '${pyType(x)}' object is not iterable`);
}

function pyText(x, what = 'startswith') {
  if (!isStr(x)) throw new PyStop(`AttributeError: '${pyType(x)}' object has no attribute '${what}'`);
  return x;
}

function hashable(x) {
  if (isDict(x) || isList(x)) throw new PyStop(`TypeError: unhashable type: '${pyType(x)}'`);
  return x;
}

function pyNumber(x) {
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'number' || typeof x === 'bigint') return x;
  if (x instanceof PyFloat) return x.value;
  return null;
}

export function pyEq(a, b) {
  const [x, y] = [pyNumber(a), pyNumber(b)];
  if (x !== null || y !== null) return x !== null && y !== null && x == y;   // eslint-disable-line eqeqeq
  if (isList(a) || isList(b)) return isList(a) && isList(b) && a.length === b.length && a.every((v, k) => pyEq(v, b[k]));
  if (isDict(a) || isDict(b)) {
    if (!isDict(a) || !isDict(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && pyEq(a[k], b[k]));
  }
  return a === b;
}

export function pyStr(x) {
  return isStr(x) ? x : pyRepr(x);
}

export function pyRepr(x) {
  if (x === null || x === undefined) return 'None';
  if (x === true) return 'True';
  if (x === false) return 'False';
  if (typeof x === 'number' || typeof x === 'bigint') return String(x);
  if (x instanceof PyFloat) return floatRepr(x.value);
  if (isStr(x)) return stringRepr(x);
  if (isList(x)) return `[${x.map(pyRepr).join(', ')}]`;
  return `{${Object.entries(x).map(([k, v]) => `${stringRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
}

function floatRepr(v) {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  const [mantissa, exp] = v.toExponential().split('e');
  const e = Number(exp);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace(/^-/, '').replace('.', '');
  let body;
  if (e >= -4 && e < 16) {
    if (e >= 0) {
      body = digits.length <= e + 1 ? `${digits.padEnd(e + 1, '0')}.0` : `${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`;
    } else {
      body = `0.${'0'.repeat(-e - 1)}${digits}`;
    }
  } else {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    body = `${m}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  return (negative ? '-' : '') + body;
}

function stringRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\\' || ch === quote) out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch !== ' ' && /[\p{C}\p{Z}]/u.test(ch)) {
      out += c < 0x100 ? `\\x${c.toString(16).padStart(2, '0')}`
        : c < 0x10000 ? `\\u${c.toString(16).padStart(4, '0')}` : `\\U${c.toString(16).padStart(8, '0')}`;
    } else out += ch;
  }
  return out + quote;
}

export class PyJsonError extends Error {
  constructor(msg, doc, pos) {
    const cp = (k) => [...doc.slice(0, k)].length;
    const at = cp(pos);
    const nl = pos > 0 ? doc.lastIndexOf('\n', pos - 1) : -1;
    const lineno = (doc.slice(0, pos).match(/\n/g) || []).length + 1;
    const colno = nl < 0 ? at + 1 : at - cp(nl);
    super(`${msg}: line ${lineno} column ${colno} (char ${at})`);
  }
}

const WS = ' \t\n\r';
const NUMBER = /(-?(?:0|[1-9][0-9]*))(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

export function pyJson(doc) {
  if (doc.startsWith('\ufeff')) throw new PyJsonError('Unexpected UTF-8 BOM (decode using utf-8-sig)', doc, 0);
  const skip = (k) => {
    while (k < doc.length && WS.includes(doc[k])) k++;
    return k;
  };
  const string = (end) => {
    const begin = end - 1;
    let out = '';
    for (;;) {
      let k = end;
      while (k < doc.length && doc[k] !== '"' && doc[k] !== '\\' && doc.charCodeAt(k) >= 0x20) k++;
      if (k >= doc.length) throw new PyJsonError('Unterminated string starting at', doc, begin);
      out += doc.slice(end, k);
      const t = doc[k];
      end = k + 1;
      if (t === '"') return [out, end];
      if (t !== '\\') throw new PyJsonError('Invalid control character at', doc, k);
      if (end >= doc.length) throw new PyJsonError('Unterminated string starting at', doc, begin);
      const esc = doc[end];
      if (esc !== 'u') {
        if (!Object.hasOwn(ESCAPES, esc)) throw new PyJsonError('Invalid \\escape', doc, end - 1);
        out += ESCAPES[esc];
        end++;
        continue;
      }
      const hex4 = (at) => {
        const h = doc.slice(at, at + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(h)) throw new PyJsonError('Invalid \\uXXXX escape', doc, at - 1);
        return parseInt(h, 16);
      };
      let u = hex4(end + 1);
      end += 5;
      if (u >= 0xd800 && u <= 0xdbff && doc.slice(end, end + 2) === '\\u') {
        const u2 = hex4(end + 2);
        if (u2 >= 0xdc00 && u2 <= 0xdfff) {
          u = 0x10000 + (((u - 0xd800) << 10) | (u2 - 0xdc00));
          end += 6;
        }
      }
      out += String.fromCodePoint(u);
    }
  };
  const value = (k) => {
    const c = doc[k];
    if (c === '"') return string(k + 1);
    if (c === '{') return object(k + 1);
    if (c === '[') return array(k + 1);
    if (c === 'n' && doc.startsWith('null', k)) return [null, k + 4];
    if (c === 't' && doc.startsWith('true', k)) return [true, k + 4];
    if (c === 'f' && doc.startsWith('false', k)) return [false, k + 5];
    if (c === 'N' && doc.startsWith('NaN', k)) return [new PyFloat(NaN), k + 3];
    if (c === 'I' && doc.startsWith('Infinity', k)) return [new PyFloat(Infinity), k + 8];
    if (c === '-' && doc.startsWith('-Infinity', k)) return [new PyFloat(-Infinity), k + 9];
    NUMBER.lastIndex = k;
    const m = k < doc.length ? NUMBER.exec(doc) : null;
    if (!m) throw new PyJsonError('Expecting value', doc, k);
    const end = k + m[0].length;
    if (m[2] || m[3]) return [new PyFloat(Number(m[0])), end];
    const n = Number(m[1]);
    return [Number.isSafeInteger(n) ? n : BigInt(m[1]), end];
  };
  const object = (k) => {
    const out = Object.create(null);
    k = skip(k);
    if (doc[k] === '}') return [out, k + 1];
    if (doc[k] !== '"') throw new PyJsonError('Expecting property name enclosed in double quotes', doc, k);
    for (;;) {
      let key;
      [key, k] = string(k + 1);
      k = skip(k);
      if (doc[k] !== ':') throw new PyJsonError("Expecting ':' delimiter", doc, k);
      k = skip(k + 1);
      let v;
      [v, k] = value(k);
      out[key] = v;
      k = skip(k);
      if (doc[k] === '}') return [out, k + 1];
      if (doc[k] !== ',') throw new PyJsonError("Expecting ',' delimiter", doc, k);
      const comma = k;
      k = skip(k + 1);
      if (doc[k] !== '"') {
        if (doc[k] === '}') throw new PyJsonError('Illegal trailing comma before end of object', doc, comma);
        throw new PyJsonError('Expecting property name enclosed in double quotes', doc, k);
      }
    }
  };
  const array = (k) => {
    const out = [];
    k = skip(k);
    if (doc[k] === ']') return [out, k + 1];
    for (;;) {
      let v;
      [v, k] = value(k);
      out.push(v);
      k = skip(k);
      if (doc[k] === ']') return [out, k + 1];
      if (doc[k] !== ',') throw new PyJsonError("Expecting ',' delimiter", doc, k);
      const comma = k;
      k = skip(k + 1);
      if (doc[k] === ']') throw new PyJsonError('Illegal trailing comma before end of array', doc, comma);
    }
  };
  const [v, end] = value(skip(0));
  const rest = skip(end);
  if (rest !== doc.length) throw new PyJsonError('Extra data', doc, rest);
  return v;
}

class TooLarge extends Error {}

function textOf(bytes) {
  const bad = utf8Problem(bytes);
  if (bad) throw new PyStop(`UnicodeDecodeError: ${bad}`);
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).replace(/\r\n?/g, '\n');
}

function jsonText(text) {
  if (nesting(text) > LIMITS.nesting) throw new TooLarge(`nested deeper than ${LIMITS.nesting} levels`);
  return pyJson(text);
}

class DateError extends Error {}

function strToDatetime(s) {
  if (s === '') throw new DateError('Attempt to set empty datetime');
  let m = /^\d\d\d\d(-\d\d(-\d\d)?)?(?=\n?$)/.exec(s);
  if (m) {
    if (m[1] === undefined) s += '-01-01';
    else if (m[2] === undefined) s += '-01';
    s += 'T00:00:00Z';
  }
  m = /^(.*\d{2}:\d{2}:\d{2})(\.\d+)([^\d].*)?(?=\n?$)/.exec(s);
  if (m) s = m[1] + (m[3] ?? '');
  m = /^(\d\d\d\d-\d\d-\d\dT\d\d:\d\d(:\d\d)?)(Z|([+-])(\d\d):(\d\d))?(?=\n?$)/.exec(s);
  if (!m) throw new DateError(`Bad datetime format (${s})`);
  const given = m[1] + 'Z';
  const [year, month, day, hour, minute, second] = m[1].split(/[-T:]/).map(Number).concat(0).slice(0, 6);
  const days = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const problem = year < 1 ? `year ${year} is out of range`
    : month < 1 || month > 12 ? 'month must be in 1..12'
      : day < 1 || day > days[month - 1] ? 'day is out of range for month'
        : hour > 23 ? 'hour must be in 0..23'
          : minute > 59 ? 'minute must be in 0..59'
            : second > 59 ? 'second must be in 0..59' : null;
  if (problem) throw new DateError(`${problem}: ${given}`);
  if (m[3] && m[3] !== 'Z' && (Number(m[5]) > 23 || Number(m[6]) > 59)) throw new DateError(`Bad timezone offset (${s})`);
}

const DIGEST_FORMS = {
  sha512: /^[0-9a-fA-F]{128}(?=\n?$)/,
  sha256: /^[0-9a-fA-F]{64}(?=\n?$)/,
  sha1: /^[0-9a-fA-F]{40}(?=\n?$)/,
  md5: /^[0-9a-fA-F]{32}(?=\n?$)/,
  'blake2b-512': /^[0-9a-fA-F]{128}(?=\n?$)/,
  'blake2b-384': /^[0-9a-fA-F]{96}(?=\n?$)/,
  'blake2b-256': /^[0-9a-fA-F]{64}(?=\n?$)/,
  'blake2b-160': /^[0-9a-fA-F]{40}(?=\n?$)/,
  'sha512-spec-ex': /^[0-9a-f]{6}\.\.\.[0-9a-f]{3}(?=\n?$)/,
  'sha256-spec-ex': /^[0-9a-f]{6}\.\.\.[0-9a-f]{3}(?=\n?$)/,
};

function digestForm(alg) {
  if (!isStr(alg) || !Object.hasOwn(DIGEST_FORMS, alg)) return null;
  return DIGEST_FORMS[alg];
}

function normalizedDigest(digest, alg) {
  if (alg === 'sha512-spec-ex' || alg === 'sha256-spec-ex') return digest;
  return pyText(digest, 'lower').toLowerCase();
}

async function hasher(alg) {
  const h = await import('hash-wasm');
  switch (alg) {
    case 'sha512': case 'sha512-spec-ex': return h.createSHA512();
    case 'sha256': case 'sha256-spec-ex': return h.createSHA256();
    case 'sha1': return h.createSHA1();
    case 'md5': return h.createMD5();
    case 'blake2b-512': return h.createBLAKE2b(512);
    case 'blake2b-384': return h.createBLAKE2b(384);
    case 'blake2b-256': return h.createBLAKE2b(256);
    case 'blake2b-160': return h.createBLAKE2b(160);
    default: return null;
  }
}

const SUBTLE = { sha512: 'SHA-512', 'sha512-spec-ex': 'SHA-512', sha256: 'SHA-256', 'sha256-spec-ex': 'SHA-256', sha1: 'SHA-1' };

async function digestsOf(chunks, algs) {
  const wanted = [...new Set(algs)];
  const it = (chunks[Symbol.asyncIterator] ?? chunks[Symbol.iterator]).call(chunks);
  const first = await it.next();
  const second = first.done ? first : await it.next();
  const raw = {};
  if (second.done) {
    const bytes = first.done ? new Uint8Array() : first.value;
    for (const alg of wanted) {
      if (SUBTLE[alg] && globalThis.crypto?.subtle) {
        raw[alg] = Array.from(new Uint8Array(await crypto.subtle.digest(SUBTLE[alg], bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
      } else {
        const h = await hasher(alg);
        if (h) raw[alg] = h.init().update(bytes).digest('hex');
      }
    }
  } else {
    const hs = new Map();
    for (const alg of wanted) {
      const h = await hasher(alg);
      if (h) hs.set(alg, h.init());
    }
    const feed = (chunk) => {
      for (const h of hs.values()) h.update(chunk);
    };
    feed(first.value);
    feed(second.value);
    for (let next = await it.next(); !next.done; next = await it.next()) feed(next.value);
    for (const [alg, h] of hs) raw[alg] = h.digest('hex');
  }
  const out = {};
  for (const [alg, d] of Object.entries(raw)) {
    out[alg] = alg === 'sha512-spec-ex' ? `${d.slice(0, 15)}...${d.slice(-3)}`
      : alg === 'sha256-spec-ex' ? `${d.slice(0, 6)}...${d.slice(-3)}` : d;
  }
  return out;
}

class Folder {
  constructor(storage, base) {
    this.storage = storage;
    this.base = base;
  }

  at(p) {
    return joinPath(this.base, p);
  }

  async kind(p) {
    try {
      return await this.storage.kind(this.at(p));
    } catch {
      return null;
    }
  }

  async exists(p) {
    return (await this.kind(p)) !== null;
  }

  async isdir(p) {
    return (await this.kind(p)) === 'dir';
  }

  async listdir(p) {
    let entries = null;
    try {
      entries = await this.storage.list(this.at(p));
    } catch {
      entries = null;
    }
    if (entries === null) return null;
    return entries.map((e) => ({ name: e.name, type: e.kind === 'dir' ? 'directory' : e.kind === 'file' ? 'file' : 'other' }));
  }

  async bytes(p, limit = LIMITS.json) {
    let bytes;
    try {
      bytes = await this.storage.read(this.at(p));
    } catch (error) {
      throw new PyStop(`OSError: ${p} cannot be read (${error.message})`);
    }
    if (bytes === null) return null;
    if (bytes.length > limit) throw new TooLarge(`larger than ${limit} bytes`);
    return bytes;
  }

  async chunks(p, limit = LIMITS.file) {
    let source;
    try {
      source = this.storage.stream ? await this.storage.stream(this.at(p)) : null;
      if (!source) {
        const whole = await this.storage.read(this.at(p));
        source = whole === null ? null : [whole];
      }
    } catch (error) {
      throw new PyStop(`OSError: ${p} cannot be read (${error.message})`);
    }
    if (source === null) throw new PyStop(`FileNotFoundError: ${p}`);
    return (async function* () {
      let total = 0;
      for await (const chunk of source) {
        total += chunk.length;
        if (total > limit) throw new TooLarge(`larger than ${limit} bytes`);
        yield chunk;
      }
    })();
  }
}

const SPEC_VERSIONS = ['1.0', '1.1'];
const DEFAULT_SPEC_VERSION = '1.1';
const DEFAULT_CONTENT_DIRECTORY = 'content';

export class InventoryValidator {
  constructor({ log = new ValidationLog(), where = '???', defaultSpecVersion = DEFAULT_SPEC_VERSION } = {}) {
    this.log = log;
    this.where = where;
    this.defaultSpecVersion = defaultSpecVersion;
    this.inventory = null;
    this.id = null;
    this.specVersion = defaultSpecVersion;
    this.digestAlgorithm = 'sha512';
    this.contentDirectory = DEFAULT_CONTENT_DIRECTORY;
    this.contentDirectorySet = false;
    this.allVersions = [];
    this.manifestFiles = null;
    this.unnormalizedDigests = null;
    this.head = 'UNKNOWN';
  }

  error(code, args = {}) {
    this.log.error(code, { where: this.where, ...args });
  }

  warning(code, args = {}) {
    this.log.warning(code, { where: this.where, ...args });
  }

  validate(inventory, forceSpecVersion = null) {
    const start = this.log.numErrors;
    this.inventory = inventory;
    this.specVersion = forceSpecVersion ?? this.defaultSpecVersion;
    this.log.specVersion = this.specVersion;
    if (has(inventory, 'id')) {
      const iid = get(inventory, 'id');
      if (!isStr(iid) || iid === '') {
        this.error('E037a');
      } else {
        if (!/^[a-z][a-z\d+\-.]*:./i.test(iid)) this.warning('W005', { id: iid });
        this.id = iid;
      }
    } else {
      this.error('E036a');
    }
    if (!has(inventory, 'type')) {
      this.error('E036b');
    } else if (!isStr(get(inventory, 'type'))) {
      this.error('E038d');
    } else if (forceSpecVersion && inventory.type !== `https://ocfl.io/${forceSpecVersion}/spec/#inventory`) {
      this.error('E038a', { expected: `https://ocfl.io/${forceSpecVersion}/spec/#inventory`, got: inventory.type });
    } else {
      const m = /^https:\/\/ocfl.io\/(\d+.\d)\/spec\/#inventory/.exec(inventory.type);
      if (!m) {
        this.error('E038b', { got: inventory.type, assumed_spec_version: this.specVersion });
      } else if (SPEC_VERSIONS.includes(m[1])) {
        this.specVersion = m[1];
        this.log.specVersion = this.specVersion;
      } else {
        this.error('E038c', { got: m[1], assumed_spec_version: this.specVersion });
      }
    }
    if (!has(inventory, 'digestAlgorithm')) {
      this.error('E036c');
    } else if (pyEq(get(inventory, 'digestAlgorithm'), 'sha512')) {
      // the default
    } else if (pyEq(inventory.digestAlgorithm, 'sha256')) {
      this.warning('W004');
      this.digestAlgorithm = 'sha256';
    } else {
      this.error('E025a', { digest_algorithm: inventory.digestAlgorithm });
      return false;
    }
    if (has(inventory, 'contentDirectory')) {
      const cd = get(inventory, 'contentDirectory');
      if (!isStr(cd) || cd.includes('/')) {
        this.error('E017');
      } else if (cd === '.' || cd === '..') {
        this.error('E018');
      } else {
        this.contentDirectory = cd;
        this.contentDirectorySet = true;
      }
    }
    let manifestFilesCorrectFormat = null;
    if (!has(inventory, 'manifest')) {
      this.error('E041a');
    } else {
      [this.manifestFiles, manifestFilesCorrectFormat, this.unnormalizedDigests] = this.validateManifest(get(inventory, 'manifest'));
    }
    let digestsUsed = [];
    if (!has(inventory, 'versions')) {
      this.error('E041b');
    } else {
      this.allVersions = this.validateVersionSequence(get(inventory, 'versions'));
      digestsUsed = this.validateVersions(inventory.versions, this.allVersions, this.unnormalizedDigests);
    }
    if (!has(inventory, 'head')) {
      this.error('E036d');
    } else if (this.allVersions.length > 0) {
      this.head = this.allVersions[this.allVersions.length - 1];
      if (!pyEq(get(inventory, 'head'), this.head)) this.error('E040', { got: inventory.head, expected: this.head });
    }
    if (this.allVersions.length === 0) {
      if (this.log.numErrors - start === 0) this.error('E008');
      return false;
    }
    if (manifestFilesCorrectFormat !== null) this.checkContentPathsMapToVersions(manifestFilesCorrectFormat, this.allVersions);
    if (this.manifestFiles !== null) this.checkDigestsPresentAndUsed(this.manifestFiles, digestsUsed);
    if (has(inventory, 'fixity')) this.validateFixity(get(inventory, 'fixity'), this.manifestFiles);
    return this.log.numErrors - start === 0;
  }

  validateAsPriorVersion(prior) {
    const start = this.log.numErrors;
    const mine = new Set(this.allVersions);
    if (!(prior.allVersions.every((v) => mine.has(v)) && prior.allVersions.length < mine.size)) {
      this.error('E066a', { prior_head: prior.head });
    } else {
      for (const version of prior.allVersions) {
        if (prior.digestAlgorithm === this.digestAlgorithm) this.compareStatesForVersion(prior, version);
        const priorMap = logicalPathMap(prior.inventory, version);
        const selfMap = logicalPathMap(this.inventory, version);
        const onlyInPrior = [...priorMap.keys()].filter((p) => !selfMap.has(p));
        const onlyInSelf = [...selfMap.keys()].filter((p) => !priorMap.has(p));
        if (onlyInPrior.length || onlyInSelf.length) {
          if (onlyInPrior.length) {
            this.error('E066b', { version, prior_head: prior.head, only_in: prior.head, logical_paths: onlyInPrior.join(',') });
          }
          if (onlyInSelf.length) {
            this.error('E066b', { version, prior_head: prior.head, only_in: this.where, logical_paths: onlyInSelf.join(',') });
          }
        } else {
          for (const [logicalPath, thisMap] of priorMap) {
            const theirs = selfMap.get(logicalPath);
            if (![...thisMap].every((p) => theirs.has(p))) {
              this.error('E066c', { version, prior_head: prior.head, logical_path: logicalPath,
                                    prior_content: [...thisMap].join(','), current_content: [...theirs].join(',') });
            }
          }
        }
        const priorVersion = get(get(prior.inventory, 'versions'), version);
        const selfVersion = get(get(this.inventory, 'versions'), version);
        for (const key of ['created', 'message', 'user']) {
          if (!isDict(priorVersion) || !isDict(selfVersion)) throw new PyStop(`AttributeError: '${pyType(isDict(priorVersion) ? selfVersion : priorVersion)}' object has no attribute 'get'`);
          if (!pyEq(priorVersion[key] ?? null, selfVersion[key] ?? null)) this.warning('W011', { version, prior_head: prior.head, key });
        }
      }
    }
    return this.log.numErrors - start === 0;
  }

  validateManifest(manifest) {
    const manifestFiles = new Map();
    const correctFormat = [];
    const unnormalized = new Set();
    const seen = new Set();
    if (!isDict(manifest)) {
      this.error('E041c');
    } else {
      const contentPaths = new Set();
      const contentDirectories = new Set();
      const form = this.digestRegex();
      for (const digest of Object.keys(manifest)) {
        if (!form.test(digest)) {
          this.error('E025b', { digest, algorithm: this.digestAlgorithm });
        } else if (!isList(manifest[digest])) {
          this.error('E092', { digest });
        } else {
          unnormalized.add(digest);
          const norm = normalizedDigest(digest, this.digestAlgorithm);
          if (seen.has(norm)) this.error('E096', { digest: norm });
          else seen.add(norm);
          for (const file of manifest[digest]) {
            manifestFiles.set(hashable(file), norm);
            if (this.checkContentPath(file, contentPaths, contentDirectories)) correctFormat.push(file);
          }
        }
      }
      for (const p of contentDirectories) if (contentPaths.has(p)) this.error('E101b', { path: p });
    }
    return [manifestFiles, correctFormat, unnormalized];
  }

  validateFixity(fixity, manifestFiles) {
    if (!isDict(fixity)) {
      this.error(this.specVersion === '1.0' ? 'E056a' : 'E111');
      return;
    }
    for (const alg of Object.keys(fixity)) {
      const form = digestForm(alg);
      if (!form) {
        this.error('E056b', { algorithm: this.digestAlgorithm });
        continue;
      }
      const block = fixity[alg];
      if (!isDict(block)) {
        this.error('E057a', { algorithm: this.digestAlgorithm });
        continue;
      }
      const seen = new Set();
      for (const digest of Object.keys(block)) {
        if (!form.test(digest)) {
          this.error('E057b', { digest, algorithm: alg });
        } else if (!isList(block[digest])) {
          this.error('E057c', { digest, algorithm: alg });
        } else {
          const norm = normalizedDigest(digest, alg);
          if (seen.has(norm)) this.error('E097', { digest: norm, algorithm: alg });
          else seen.add(norm);
          for (const file of block[digest]) {
            if (!manifestFiles || !manifestFiles.has(hashable(file))) this.error('E057d', { digest: norm, algorithm: alg, path: file });
          }
        }
      }
    }
  }

  validateVersionSequence(versions) {
    const all = [];
    if (!isDict(versions)) {
      this.error('E044');
      return all;
    }
    const count = Object.keys(versions).length;
    if (count === 0) {
      this.error('E008');
      return all;
    }
    let width = 0, max = 999999;
    if (Object.hasOwn(versions, 'v1')) {
      all.push('v1');
    } else {
      for (let n = 2; n < 11; n++) {
        if (Object.hasOwn(versions, `v${'1'.padStart(n, '0')}`)) {
          all.push(`v${'1'.padStart(n, '0')}`);
          width = n;
          max = 10 ** (n - 1) - 1;
          break;
        }
      }
      if (!width) {
        this.error('E009');
        return all;
      }
    }
    if (width) this.warning('W001');
    for (let n = 2; n <= max; n++) {
      const v = `v${String(n).padStart(width, '0')}`;
      if (Object.hasOwn(versions, v)) {
        all.push(v);
      } else {
        if (count !== n - 1) this.error('E010');
        return all;
      }
    }
    if (count > max) this.error('E011');
    return all;
  }

  validateVersions(versions, all, unnormalized) {
    let used = [];
    for (const v of all) {
      const version = versions[v];
      if (!has(version, 'created')) {
        this.error('E048', { version: v });
      } else if (!isStr(get(version, 'created'))) {
        this.error('E049d', { version: v });
      } else {
        const created = version.created;
        try {
          strToDatetime(created);
          if (!/(Z|[+-]\d\d:\d\d)(?=\n?$)/.test(created)) this.error('E049a', { version: v });
          if (!/T\d\d:\d\d:\d\d/.test(created)) this.error('E049b', { version: v });
        } catch (error) {
          if (!(error instanceof DateError)) throw error;
          this.error('E049c', { version: v, description: error.message });
        }
      }
      if (has(version, 'state')) {
        used = used.concat(this.validateStateBlock(get(version, 'state'), v, unnormalized));
      } else {
        this.error('E048c', { version: v });
      }
      if (!has(version, 'message')) this.warning('W007a', { version: v });
      else if (!isStr(get(version, 'message'))) this.error('E094', { version: v });
      if (!has(version, 'user')) {
        this.warning('W007b', { version: v });
      } else {
        const user = get(version, 'user');
        if (!isDict(user)) {
          this.error('E054a', { version: v });
        } else {
          if (!Object.hasOwn(user, 'name') || !isStr(user.name)) this.error('E054b', { version: v });
          if (!Object.hasOwn(user, 'address')) this.warning('W008', { version: v });
          else if (!isStr(user.address)) this.error('E054c', { version: v });
          else if (!/^[\p{L}\p{N}_]{3,6}:/u.test(user.address)) this.warning('W009', { version: v });
        }
      }
    }
    return used;
  }

  validateStateBlock(state, version, unnormalized) {
    const digests = [];
    const logicalPaths = new Set();
    const logicalDirectories = new Set();
    if (!isDict(state)) {
      this.error('E050c', { version });
      return digests;
    }
    const form = this.digestRegex();
    for (const digest of Object.keys(state)) {
      if (!form.test(digest)) {
        this.error('E050d', { version, digest });
      } else if (!isList(state[digest])) {
        this.error('E050e', { version, digest });
      } else {
        for (const p of state[digest]) {
          if (logicalPaths.has(hashable(p))) this.error('E095a', { version, path: p });
          else this.checkLogicalPath(p, version, logicalPaths, logicalDirectories);
        }
        if (!unnormalized) throw new PyStop("TypeError: argument of type 'NoneType' is not iterable");
        if (!unnormalized.has(digest)) this.error('E050f', { version, digest });
        digests.push(normalizedDigest(digest, this.digestAlgorithm));
      }
    }
    for (const p of logicalDirectories) if (logicalPaths.has(p)) this.error('E095b', { version, path: p });
    return digests;
  }

  checkContentPathsMapToVersions(files, all) {
    for (const p of files) if (!all.includes(p.split('/')[0])) this.error('E042b', { path: p });
  }

  checkDigestsPresentAndUsed(manifestFiles, used) {
    const inManifest = new Set(manifestFiles.values());
    const inState = new Set(used);
    const notInManifest = [...inState].filter((d) => !inManifest.has(d)).sort(compareCodePoints);
    if (notInManifest.length) this.error('E050a', { digests: notInManifest.join(', ') });
    const notInState = [...inManifest].filter((d) => !inState.has(d)).sort(compareCodePoints);
    if (notInState.length) this.error('E107', { digests: notInState.join(', ') });
  }

  digestRegex() {
    const form = digestForm(this.digestAlgorithm);
    if (form) return form;
    this.error('E026a', { digest: this.digestAlgorithm });
    return /^/;
  }

  checkLogicalPath(p, version, logicalPaths, logicalDirectories) {
    if (pyText(p).startsWith('/') || p.endsWith('/')) {
      this.error('E053', { version, path: p });
      return;
    }
    const elements = p.split('/');
    if (elements.some((e) => e === '.' || e === '..' || e === '')) {
      this.error('E052', { version, path: p });
      return;
    }
    logicalPaths.add(p);
    logicalDirectories.add(elements.slice(0, -1).join('/'));
  }

  checkContentPath(p, contentPaths, contentDirectories) {
    if (pyText(p).startsWith('/') || p.endsWith('/')) {
      this.error('E100', { path: p });
      return false;
    }
    const m = /^(v\d+)\/([^/]+)\/(.+)/.exec(p);
    if (!m) {
      this.error('E042a', { path: p });
      return false;
    }
    if (m[2] !== this.contentDirectory) {
      this.error('E042c', { path: p, content_directory: this.contentDirectory });
      return false;
    }
    const elements = m[3].split('/');
    if (elements.some((e) => e === '' || e === '.' || e === '..')) {
      this.error('E099', { path: p });
      return false;
    }
    if (contentPaths.has(p)) {
      this.error('E101a', { path: p });
      return false;
    }
    contentPaths.add(p);
    contentDirectories.add([m[1], m[2], ...elements.slice(0, -1)].join('/'));
    return true;
  }

  compareStatesForVersion(prior, version) {
    const selfState = get(get(get(this.inventory, 'versions'), version), 'state');
    const priorState = get(get(get(prior.inventory, 'versions'), version), 'state');
    const digests = [...new Set([...pyIter(selfState), ...pyIter(priorState)])];
    for (const digest of digests) {
      if (!has(priorState, digest)) {
        this.error('E066d', { version, prior_head: prior.head, digest, logical_files: pyIter(get(selfState, digest)).join(', ') });
      } else if (!has(selfState, digest)) {
        this.error('E066e', { version, prior_head: prior.head, digest, logical_files: pyIter(get(priorState, digest)).join(', ') });
      }
    }
  }
}

function logicalPathMap(inventory, version) {
  const state = get(get(get(inventory, 'versions'), version), 'state');
  const manifest = get(inventory, 'manifest');
  const out = new Map();
  for (const digest of pyIter(state)) {
    if (has(manifest, digest)) {
      for (const file of pyIter(get(state, digest))) out.set(hashable(file), new Set(pyIter(get(manifest, digest))));
    }
  }
  return out;
}

const INVENTORY = 'inventory.json';
const REGISTERED_OBJECT_EXTENSIONS = ['0001-digest-algorithms', '0002-flat-direct-storage-layout',
  '0003-hash-and-id-n-tuple-storage-layout', '0004-hashed-n-tuple-storage-layout', '0005-mutable-head'];

class Abort extends Error {}
class DigestFileError extends Error {}

export async function validateObject(storage, dir, { logWarnings = false, checkDigests = true, log = null } = {}) {
  const v = new ObjectValidator(storage, dir, { logWarnings, checkDigests, log });
  const valid = await v.validate();
  return { valid, log: v.log, id: v.id, specVersion: v.specVersion };
}

class ObjectValidator {
  constructor(storage, dir, { logWarnings, checkDigests, log }) {
    this.fs = new Folder(storage, dir);
    this.dir = dir;
    this.checkDigests = checkDigests;
    this.log = log ?? new ValidationLog({ logWarnings });
    this.id = null;
    this.specVersion = DEFAULT_SPEC_VERSION;
    this.log.specVersion = this.specVersion;
    this.digestAlgorithm = 'sha512';
    this.contentDirectory = DEFAULT_CONTENT_DIRECTORY;
    this.contentDirectorySet = false;
    this.inventoryDigestFiles = new Map();
    this.rootInvValidator = null;
  }

  async validate() {
    const start = this.log.numErrors;
    try {
      await this.run();
    } catch (error) {
      if (error instanceof Abort) {
        // ocfl-py's ValidatorAbortException: what was found stands
      } else if (error instanceof PyStop) {
        this.log.error('E904', { explanation: error.message });
      } else {
        throw error;
      }
    }
    return this.log.numErrors === start;
  }

  async run() {
    const fs = this.fs;
    if (!(await fs.isdir(''))) {
      this.log.error('E003e', { path: this.dir });
      throw new Abort();
    }
    const names = (await fs.listdir('')).map((e) => e.name).filter((n) => n.startsWith('0=')).sort(compareCodePoints);
    if (names.length === 0) {
      this.log.error('E003a', { assumed_version: this.specVersion });
    } else {
      let spec = null;
      for (const name of names) {
        const version = SPEC_VERSIONS.find((x) => name === `0=ocfl_object_${x}`) ?? null;
        if (version === null) {
          this.log.error('E006', { filename: name });
        } else if (spec === null || version > spec) {
          spec = version;
          if (!(await namasteContentOk(fs, name))) this.log.error('E007', { filename: name });
        }
      }
      if (spec === null) {
        this.log.error('E003c', { assumed_version: this.specVersion });
      } else {
        this.specVersion = spec;
        this.log.specVersion = spec;
        if (names.length > 1) this.log.error('E003b', { files: names.length, using_version: this.specVersion });
      }
    }
    if (!(await fs.exists(INVENTORY))) {
      this.log.error('E063');
      throw new Abort();
    }
    const [inventory, inv] = await this.validateInventory(INVENTORY);
    const inventoryIsValid = this.log.numErrors === 0;
    this.rootInvValidator = inv;
    const all = inv.allVersions;
    this.id = inv.id;
    this.contentDirectory = inv.contentDirectory;
    this.contentDirectorySet = inv.contentDirectorySet;
    this.digestAlgorithm = inv.digestAlgorithm;
    await this.validateInventoryDigest(INVENTORY, this.digestAlgorithm);
    await this.validateObjectRoot(all, names);
    const [priorManifest, priorFixity] = await this.validateVersionInventories(all);
    if (inventoryIsValid) await this.validateContent(inventory, all, priorManifest, priorFixity);
  }

  async validateInventory(file, where = 'root') {
    let inventory;
    try {
      const bytes = await this.fs.bytes(file);
      if (bytes === null) {
        this.log.error('E033', { where, explanation: 'Inventory not present' });
        throw new Abort();
      }
      inventory = jsonText(textOf(bytes));
    } catch (error) {
      if (error instanceof PyJsonError) {
        this.log.error('E033', { where, explanation: error.message });
        throw new Abort();
      }
      if (error instanceof TooLarge) {
        this.log.error('E902', { path: file, explanation: error.message });
        throw new Abort();
      }
      throw error;
    }
    const inv = new InventoryValidator({ log: this.log, where, defaultSpecVersion: this.specVersion });
    inv.validate(inventory);
    return [inventory, inv];
  }

  async validateInventoryDigest(file, alg, where = 'root') {
    const sidecar = `${file}.${alg}`;
    if (!(await this.fs.exists(sidecar))) this.log.error('E058a', { where, path: sidecar });
    else await this.validateInventoryDigestMatch(file, sidecar);
  }

  async validateInventoryDigestMatch(file, sidecar) {
    if (!this.checkDigests) return;
    const m = /^.*\.(\w+)$/.exec(sidecar);
    if (!m) {
      this.log.error('E058b', { inv_digest_file: sidecar });
      return;
    }
    let recorded;
    try {
      recorded = await this.readInventoryDigest(sidecar);
    } catch (error) {
      if (!(error instanceof DigestFileError)) throw error;
      this.log.error('E061', { description: error.message });
      return;
    }
    const bytes = await this.fs.bytes(file).catch((error) => {
      if (error instanceof TooLarge) throw new PyStop(`${file} is larger than ${LIMITS.json} bytes`);
      throw error;
    });
    if (!digestForm(m[1])) {
      this.log.error('E061', { description: `Unsupport digest type ${m[1]}` });
      return;
    }
    const actual = (await digestsOf([bytes], [m[1]]))[m[1]];
    if (actual !== recorded) this.log.error('E060', { inv_file: file, actual, recorded, inv_digest_file: sidecar });
  }

  async readInventoryDigest(sidecar) {
    let text;
    try {
      const bytes = await this.fs.bytes(sidecar);
      if (bytes === null) throw new PyStop(`FileNotFoundError: ${sidecar}`);
      text = textOf(bytes);
    } catch (error) {
      if (error instanceof TooLarge) throw new DigestFileError(`Bad inventory digest file ${sidecar}, wrong format`);
      throw error;
    }
    const nl = text.indexOf('\n');
    const line = nl < 0 ? text : text.slice(0, nl + 1);
    const m = /^([\p{L}\p{N}_]+)\s+(\S+)\s*$/u.exec(line);
    if (!m) throw new DigestFileError(`Bad inventory digest file ${sidecar}, wrong format`);
    if (m[2] !== INVENTORY) throw new DigestFileError(`Bad inventory name in inventory digest file ${sidecar}`);
    return m[1];
  }

  async validateObjectRoot(versionDirs, alreadyChecked) {
    const expected = [`0=ocfl_object_${this.specVersion}`, INVENTORY, `${INVENTORY}.${this.digestAlgorithm}`];
    for (const { name, type } of await this.fs.listdir('')) {
      if (type === 'file') {
        if (!expected.includes(name) && !alreadyChecked.includes(name)) this.log.error('E001a', { file: name });
      } else if (type === 'directory') {
        if (versionDirs.includes(name) || name === 'logs') continue;
        if (name === 'extensions') await this.validateExtensionsDir();
        else if (/^v\d+$/.test(name)) this.log.error('E046b', { dir: name });
        else this.log.error('E001b', { dir: name });
      } else {
        this.log.error('E001c', { entry: name });
      }
    }
  }

  async validateExtensionsDir() {
    for (const { name, type } of await this.fs.listdir('extensions')) {
      if (type === 'directory') {
        if (!REGISTERED_OBJECT_EXTENSIONS.includes(name)) this.log.warning('W013', { entry: `extensions/${name}` });
      } else {
        this.log.error('E067', { entry: `extensions/${name}` });
      }
    }
  }

  async validateVersionInventories(versionDirs) {
    const priorManifest = new Map(), priorFixity = new Map();
    if (versionDirs.length === 0) return [priorManifest, priorFixity];
    const last = versionDirs[versionDirs.length - 1];
    let prevVersionDir = 'NONE', prevSpecVersion = '1.0';
    const record = (table, file, alg, digest, versionDir) => {
      if (!table.has(file)) table.set(file, new Map());
      const byAlg = table.get(file);
      if (!byAlg.has(alg)) byAlg.set(alg, new Map());
      const byDigest = byAlg.get(alg);
      if (!byDigest.has(digest)) byDigest.set(digest, []);
      byDigest.get(digest).push(versionDir);
    };
    for (const versionDir of versionDirs) {
      const file = `${versionDir}/${INVENTORY}`;
      if (!(await this.fs.exists(file))) {
        this.log.warning('W010', { where: versionDir });
        continue;
      }
      let thisSpecVersion;
      if (versionDir === last) {
        if (!(await this.filesIdentical(file, INVENTORY))) {
          this.log.error('E064', { root_inv_file: INVENTORY, inv_file: file });
        } else {
          await this.validateInventoryDigest(file, this.digestAlgorithm, versionDir);
        }
        this.inventoryDigestFiles.set(versionDir, `${INVENTORY}.${this.digestAlgorithm}`);
        thisSpecVersion = this.specVersion;
      } else {
        const [versionInventory, inv] = await this.validateInventory(file, versionDir);
        thisSpecVersion = inv.specVersion;
        const alg = inv.digestAlgorithm;
        await this.validateInventoryDigest(file, alg, versionDir);
        this.inventoryDigestFiles.set(versionDir, `${INVENTORY}.${alg}`);
        if (this.id && has(versionInventory, 'id') && !pyEq(get(versionInventory, 'id'), this.id)) {
          this.log.error('E037b', { where: versionDir, root_id: this.id, version_id: versionInventory.id });
        }
        if (!inv.contentDirectorySet && this.contentDirectorySet) this.log.error('E019', { where: 'root' });
        if (this.contentDirectory !== inv.contentDirectory) {
          this.log.error('E020', { where: versionDir, root_content_directory: this.contentDirectory,
                                   version_content_directory: inv.contentDirectory });
        }
        if (has(versionInventory, 'manifest')) {
          const manifest = get(versionInventory, 'manifest');
          const notSeen = new Set(priorManifest.keys());
          for (const digest of pyIter(manifest)) {
            for (const p of pyIter(get(manifest, digest))) notSeen.delete(hashable(p));
          }
          if (notSeen.size) {
            this.log.error('E023b', { where: versionDir, missing_filepaths: [...notSeen].map(pyStr).sort(compareCodePoints).join(', ') });
          }
          for (const digest of pyIter(manifest)) {
            const norm = normalizedDigest(digest, alg);
            for (const p of pyIter(get(manifest, digest))) record(priorManifest, hashable(p), alg, norm, versionDir);
          }
        }
        if (this.rootInvValidator) this.rootInvValidator.validateAsPriorVersion(inv);
        if (has(versionInventory, 'fixity')) {
          const fixity = get(versionInventory, 'fixity');
          for (const falg of pyIter(fixity)) {
            const block = get(fixity, falg);
            for (const digest of pyIter(block)) {
              const norm = normalizedDigest(digest, falg);
              for (const p of pyIter(get(block, digest))) record(priorFixity, hashable(p), falg, norm, versionDir);
            }
          }
        }
      }
      if (prevSpecVersion > thisSpecVersion) {
        this.log.error('E103', { where: versionDir, this_spec_version: thisSpecVersion,
                                 prev_version_dir: prevVersionDir, prev_spec_version: prevSpecVersion });
      }
      prevVersionDir = versionDir;
      prevSpecVersion = thisSpecVersion;
    }
    return [priorManifest, priorFixity];
  }

  async filesIdentical(a, b) {
    const [x, y] = [await this.fs.kind(a), await this.fs.kind(b)];
    if (x === null || y === null) throw new PyStop(`FileNotFoundError: ${x === null ? a : b}`);
    if (x !== y) return false;
    if (a === b) return true;
    const read = (p) => this.fs.bytes(p).catch((error) => {
      if (error instanceof TooLarge) return null;
      throw error;
    });
    const [p, q] = [await read(a), await read(b)];
    return p !== null && q !== null && p.length === q.length && p.every((byte, k) => byte === q[k]);
  }

  async validateContent(inventory, versionDirs, priorManifest, priorFixity) {
    const filesSeen = new Set();
    for (const versionDir of versionDirs) {
      const kind = await this.fs.kind(versionDir);
      if (kind === null) {
        this.log.error('E046a', { version_dir: versionDir });
        continue;
      }
      if (kind !== 'dir') {
        this.log.error('E015', { where: versionDir, entry: '.' });
        continue;
      }
      for (const { name: entry } of await this.fs.listdir(versionDir)) {
        if (entry === INVENTORY || entry === this.inventoryDigestFiles.get(versionDir)) continue;
        if (entry === this.contentDirectory) {
          const contentPath = `${versionDir}/${this.contentDirectory}`;
          let files = 0;
          for await (const [dirpath, dirs, names] of walk(this.fs, contentPath)) {
            if (dirpath !== `/${contentPath}` && dirs.length + names.length === 0) {
              this.log.error('E024', { where: versionDir, path: dirpath });
            }
            for (const name of names) {
              filesSeen.add(`${dirpath}/${name}`.replace(/^\/+/, ''));
              files++;
            }
          }
          if (files === 0) this.log.warning('W003', { where: versionDir });
        } else if (await this.fs.isdir(`${versionDir}/${entry}`)) {
          this.log.warning('W002', { where: versionDir, entry });
        } else {
          this.log.error('E015', { where: versionDir, entry });
        }
      }
    }
    const fixityDigests = new Map();
    if (Object.hasOwn(inventory, 'fixity')) {
      for (const alg of Object.keys(inventory.fixity)) {
        for (const digest of Object.keys(inventory.fixity[alg])) {
          for (const p of inventory.fixity[alg][digest]) {
            if (filesSeen.has(p)) {
              if (!fixityDigests.has(p)) fixityDigests.set(p, new Map());
              const byAlg = fixityDigests.get(p);
              if (!byAlg.has(alg)) byAlg.set(alg, new Map());
              if (!byAlg.get(alg).has(digest)) byAlg.get(alg).set(digest, ['root']);
            } else {
              this.log.error('E093b', { where: 'root', digest_algorithm: alg, digest, content_path: p });
            }
          }
        }
      }
    }
    if (Object.hasOwn(inventory, 'manifest')) {
      const digested = this.checkDigests ? await this.digestAll(inventory.manifest, filesSeen, fixityDigests, priorManifest, priorFixity) : null;
      for (const digest of Object.keys(inventory.manifest)) {
        for (const p of inventory.manifest[digest]) {
          if (!filesSeen.has(p)) {
            this.log.error('E092b', { where: 'root', content_path: p });
            continue;
          }
          if (this.checkDigests) this.checkFile(p, digest, digested.get(p), fixityDigests, priorManifest, priorFixity);
          filesSeen.delete(p);
        }
      }
    }
    if (filesSeen.size) {
      this.log.error('E023a', { where: 'root', extra_files: [...filesSeen].sort(compareCodePoints).join(', ') });
    }
  }

  async digestAll(manifest, filesSeen, fixityDigests, priorManifest, priorFixity) {
    const todo = [...new Set(Object.values(manifest).flat().filter((p) => filesSeen.has(p)))];
    const out = new Map();
    let next = 0;
    const work = async () => {
      while (next < todo.length) {
        const p = todo[next++];
        const algs = [this.digestAlgorithm];
        for (const table of [fixityDigests, priorManifest, priorFixity]) {
          for (const alg of table.get(p)?.keys() ?? []) algs.push(alg);
        }
        try {
          out.set(p, { known: await digestsOf(await this.fs.chunks(p), algs.filter((a) => digestForm(a))) });
        } catch (error) {
          if (!(error instanceof TooLarge) && !(error instanceof PyStop)) throw error;
          out.set(p, { error });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LIMITS.concurrency, todo.length) }, work));
    return out;
  }

  checkFile(p, digest, { known, error }, fixityDigests, priorManifest, priorFixity) {
    if (error instanceof TooLarge) {
      this.log.error('E901', { path: p, limit: LIMITS.file });
      return;
    }
    if (error) throw error;
    const contentDigest = known[this.digestAlgorithm];
    if (contentDigest !== normalizedDigest(digest, this.digestAlgorithm)) {
      this.log.error('E092a', { where: 'root', digest_algorithm: this.digestAlgorithm, digest, content_path: p, content_digest: contentDigest });
    }
    this.checkAdditionalDigests(p, known, fixityDigests, 'E093a');
    this.checkAdditionalDigests(p, known, priorManifest, 'E092a');
    this.checkAdditionalDigests(p, known, priorFixity, 'E093a');
  }

  checkAdditionalDigests(p, known, table, code) {
    if (!table.has(p)) return;
    for (const [alg, byDigest] of table.get(p)) {
      if (!Object.hasOwn(known, alg)) throw new PyStop(`ValueError: Unsupport digest type ${pyStr(alg)}`);
      for (const [digest, versions] of byDigest) {
        if (known[alg] !== normalizedDigest(digest, alg)) {
          this.log.error(code, { where: versions.join(','), digest_algorithm: alg, digest, content_path: p, content_digest: known[alg] });
        }
      }
    }
  }
}

async function namasteContentOk(fs, name) {
  try {
    const bytes = await fs.bytes(name);
    if (bytes === null) return false;
    const content = textOf(bytes).trim();
    return name.slice(2) === [...content].slice(0, 40).join('').replace(/[^\p{L}\p{N}_.\-:]/gu, '_');
  } catch (error) {
    if (error instanceof TooLarge) return false;
    throw error;
  }
}

async function* walk(fs, dir) {
  const stack = [`/${dir}`.replace(/^\/+/, '/')];
  while (stack.length) {
    const dirpath = stack.pop();
    const dirs = [], files = [];
    for (const { name, type } of (await fs.listdir(dirpath.replace(/^\/+/, ''))) ?? []) {
      (type === 'directory' ? dirs : files).push(name);
    }
    yield [dirpath, dirs, files];
    for (const name of [...dirs].reverse()) stack.push(dirpath === '/' ? `/${name}` : `${dirpath}/${name}`);
  }
}

const LAYOUTS = {
  '0002-flat-direct-storage-layout': ['0002-flat-direct-storage-layout', null],
  '0002': ['0002-flat-direct-storage-layout', null],
  'flat-direct': ['0002-flat-direct-storage-layout', null],
  '0003-hash-and-id-n-tuple-storage-layout': ['0003-hash-and-id-n-tuple-storage-layout', checkHashedLayout],
  '0003': ['0003-hash-and-id-n-tuple-storage-layout', checkHashedLayout],
  'nnnn-flat-quoted-storage-layout': ['nnnn-flat-quoted-storage-layout', null],
  'flat-quoted': ['nnnn-flat-quoted-storage-layout', null],
  'nnnn-tuple-tree': ['nnnn-tuple-tree-layout', checkTupleTree],
  'nnnn-uuid-quadtree': ['nnnn-uuid-quadtree', checkQuadtree],
};
const REGISTERED_ROOT_EXTENSIONS = ['0002-flat-direct-storage-layout', '0003-hash-and-id-n-tuple-storage-layout'];

class RootError extends Error {
  constructor(code, args) {
    super(code);
    this.code = code;
    this.args = args;
  }
}

export async function validateStorageRoot(storage, root, { validateObjects = true, checkDigests = true, logWarnings = false } = {}) {
  const fs = new Folder(storage, root);
  const log = new ValidationLog({ logWarnings });
  const objects = [];
  let traversal = 0;
  const traversalError = (code, args) => {
    traversal++;
    log.error(code, args);
  };
  try {
    log.specVersion = await checkRootStructure(fs, root);
  } catch (error) {
    if (error instanceof RootError) log.error(error.code, error.args);
    else if (error instanceof PyStop) log.error('E904', { explanation: error.message });
    else throw error;
    return { valid: false, log, objects };
  }
  try {
    for await (const dirpath of objectPaths(fs, log, traversalError)) {
      if (objects.length >= LIMITS.objects) {
        traversalError('E903', { limit: LIMITS.objects });
        break;
      }
      const entry = { path: dirpath };
      if (validateObjects) Object.assign(entry, await validateObject(storage, joinPath(root, dirpath), { logWarnings, checkDigests }));
      objects.push(entry);
    }
  } catch (error) {
    if (!(error instanceof PyStop)) throw error;
    traversalError('E904', { explanation: error.message });
  }
  return { valid: traversal === 0, log, objects };
}

async function checkRootStructure(fs, root) {
  const listing = await fs.listdir('');
  if (listing === null) throw new PyStop(`FileNotFoundError: no folder ${root}`);
  const names = listing.map((e) => e.name).filter((n) => n.startsWith('0=')).sort(compareCodePoints);
  if (names.length === 0) throw new RootError('E069a', { root });
  if (names.length > 1) throw new RootError('E069b', { root });
  const spec = SPEC_VERSIONS.find((x) => names[0] === `0=ocfl_${x}`);
  if (!spec) throw new RootError('E069c', { root, namaste_file: names[0] });
  if (!(await namasteContentOk(fs, names[0]))) throw new RootError('E069e', { root, namaste_file: names[0] });
  if (await fs.exists('ocfl_layout.json')) {
    let layout;
    try {
      const bytes = await fs.bytes('ocfl_layout.json');
      layout = jsonText(textOf(bytes ?? new Uint8Array()));
    } catch (error) {
      if (error instanceof PyJsonError || error instanceof TooLarge || error instanceof PyStop) {
        throw new RootError('E070a', { root, message: error.message });
      }
      throw error;
    }
    if (!isDict(layout)) throw new RootError('E070b', { root });
    if (!isStr(layout.extension) || !isStr(layout.description)) throw new RootError('E070c', { root });
    if (!Object.hasOwn(LAYOUTS, layout.extension)) throw new RootError('E071', { root, layout_name: layout.extension });
    const [name, check] = LAYOUTS[layout.extension];
    const file = `extensions/${name}/config.json`;
    if (await fs.exists(file)) {
      let config;
      try {
        config = jsonText(textOf((await fs.bytes(file)) ?? new Uint8Array()));
      } catch (error) {
        if (error instanceof PyJsonError || error instanceof TooLarge || error instanceof PyStop) {
          throw new PyStop(`LayoutException: Storage root extension config file ${file} exists but can't be read/parsed (${error.message})`);
        }
        throw error;
      }
      if (!isDict(config)) throw new PyStop(`LayoutException: Storage root extension config ${file} contents not a JSON object`);
      if (!Object.hasOwn(config, 'extensionName')) throw new PyStop('LayoutException: Storage root extension config missing extensionName');
      if (config.extensionName !== name) {
        throw new PyStop(`LayoutException: Storage root extension config extensionName is ${pyStr(config.extensionName)}, expected ${name}`);
      }
      if (!check) throw new PyStop("AttributeError: 'NoneType' object has no attribute 'items'");
      const problem = check(config);
      if (problem) throw new PyStop(`LayoutException: ${problem}`);
    }
  }
  return spec;
}

const isInt = (x) => typeof x === 'boolean' || typeof x === 'bigint' || Number.isInteger(x);
const HEX_LENGTHS = { sha512: 128, sha256: 64, sha1: 40, md5: 32 };

function checkHashedLayout(config) {
  const alg = config.digestAlgorithm ?? null, size = config.tupleSize ?? null, count = config.numberOfTuples ?? null;
  if (alg === null) return 'digestAlgorithm parameter must be specified';
  if (!Object.hasOwn(HEX_LENGTHS, alg)) return `digestAlgorithm parameter specifies unknown or unsupported digests ${pyStr(alg)} (Unsupport digest type ${pyStr(alg)})`;
  if (size === null) return 'tupleSize parameter must be specified';
  if (!isInt(size) || size < 0 || size > 32) return 'tupleSize parameter must be aninteger between 0 and 32 inclusive';
  if (count === null) return 'numberOfTuples parameter must be specified';
  if (!isInt(count) || count < 0 || count > 32) return 'numberOfTuples parameter must be aninteger between 0 and 32 inclusive';
  if ((Number(size) === 0) !== (Number(count) === 0)) {
    return 'Bad layout configuration: If tupleSize is set to 0, then numberOfTuples MUST also equal 0.';
  }
  if (Number(size) * Number(count) > HEX_LENGTHS[alg]) {
    return 'Bad layout configuration: The product of tupleSize and numberOfTuples MUST be less than or equal to the number of characters in the hex encoded digest.';
  }
  return null;
}

function checkTupleTree(config) {
  const size = config.tupleSize ?? null;
  if (size === null) return 'tupleSize parameter must be specified';
  if (!isInt(size) || size < 2 || size > 6) return 'tupleSize parameter must be an integer between 2 and 6 inclusive';
  return null;
}

function checkQuadtree(config) {
  const prefix = config.prefix ?? null;
  if (prefix === null) return 'prefix parameter must be specified';
  if (!isStr(prefix) || prefix === '') return 'prefix parameter must be a non-empty string';
  return null;
}

async function* objectPaths(fs, log, traversalError) {
  for await (const [dirpath, dirs, files] of walk(fs, '')) {
    if (dirpath === '/') {
      const k = dirs.indexOf('extensions');
      if (k >= 0) {
        for (const { name, type } of await fs.listdir('extensions')) {
          if (type === 'directory') {
            if (!REGISTERED_ROOT_EXTENSIONS.includes(name)) log.warning('W901', { entry: `extensions/${name}` });
          } else {
            traversalError('E086', { entry: `extensions/${name}` });
          }
        }
        dirs.splice(k, 1);
      }
    } else if (dirs.length + files.length === 0) {
      traversalError('E073', { path: dirpath });
    } else if (files.length > 0) {
      const declarations = files.filter((f) => f.startsWith('0='));
      if (declarations.length > 1) {
        traversalError('E003d', { path: dirpath });
      } else if (declarations.length === 1) {
        const m = /^0=ocfl_object_(\d+\.\d+)/.exec(declarations[0]);
        if (m && SPEC_VERSIONS.includes(m[1])) yield dirpath.replace(/^\/+/, '');
        else if (m) traversalError('E004a', { path: dirpath, version: m[1] });
        else traversalError('E004b', { path: dirpath, declaration: declarations[0] });
      } else {
        traversalError('E072', { path: dirpath });
      }
    }
    if (dirpath !== '/' && files.length > 0) dirs.length = 0;
  }
}
