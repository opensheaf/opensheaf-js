An OCFL validator
=================

An OpenSheaf archive keeps its objects in an [OCFL 1.1](https://ocfl.io/1.1/spec/)
storage root (section 3). The tools write OCFL themselves, and a second
implementation of OCFL catches what they might get wrong in the same way
twice: opensheaf-py gives every object, and then the storage root, to
[ocfl-py](https://github.com/zimeon/ocfl-py), the validator of the OCFL
editors, when it is installed (its chapter
[17-verify](https://opensheaf.org/opensheaf-py/17-verify.html), "An
independent OCFL validator"). This chapter is that validator, in
JavaScript, so that `osheaf verify` of this program checks the storage
root as fully, and says what it finds in the same words.

It is a port of ocfl-py 2.1.0 (MIT licence, by Simeon Warner), check for
check: the classes `Validator` (an object: its declaration, its root, the
inventory and its checksum file, every version folder, every content
file against its digests), `InventoryValidator` (the structure of an
inventory and every rule on its fields, and an inventory of an earlier
version against the root inventory) and the validation of `StorageRoot`
(its declaration, `ocfl_layout.json` and the configuration of its
layout, its `extensions` folder, and the hierarchy of folders down to the
objects). The messages are ocfl-py's (its `validation-errors.json`, with
the codes of OCFL's
[validation codes](https://ocfl.io/1.1/spec/validation-codes.html) and a
letter where one code covers several cases), put together as its
`ValidationLogger` puts them, so that `status_str()`, the text
opensheaf-py quotes, is the same text here. The order of the checks is
ocfl-py's too, because it decides which errors are found: ocfl-py stops
reading an object at some errors, and checks the content only of an object
whose root inventory is valid.

Errors (the codes `E`, a MUST of the specification) and warnings (`W`, a
SHOULD) are both kept, separately; `osheaf verify` reports only the
errors, as opensheaf-py does (its warnings are on what OpenSheaf does on
purpose: the witness folders, extensions not registered with OCFL, the
first version of a key log without message or user).

What the codes of OCFL ask that ocfl-py does not check, and so this
program does not either:

- statements on how objects are made, which a validator cannot see in the
  files: E062 (the checksum file written last), E013 (a new version
  follows the naming of the earlier ones), E074 (storage roots are
  independent), E083 (the mapping from identifiers to paths is
  deterministic), E089 (non-OCFL features wrapped in an image), E028 and
  E087 (what a client ignores);
- E002, E075 (NAMASTE formatting beyond the checks of E003 to E007 and
  E069), E016, E021, E022, E035, E039, E043, E045, E047, E051, E055,
  E059, E098, E104 to E106, E108, E110 and E112, which restate rules that
  other codes check (E007, E017, E033, E036, E041, E042, E044, E048, E058,
  E099, E101) or that every inventory read here satisfies by
  construction;
- E081 (an object declares the same or an earlier version of OCFL than
  the storage root: a `FIXME` of ocfl-py), E082, E084 and E085 (objects
  nested inside objects: ocfl-py does not enter an object, so it does not
  see one inside another), E088 (the storage root's other folders are
  taken for a hierarchy of objects, and reported as E072 or E073 there),
  E090 (links: ocfl-py follows them; the storage of the command line
  never does, and `osheaf verify` reports every link in the archive,
  chapter [28](28-verify-folder.md)), E102 (keys that the specification
  does not define), E009, E012 and E014 beyond what the version sequence
  checks (E009 to E011, E042b, E046), W012, W014 and W015;
- W016 is given ocfl-py's code W901, its own for an extension folder of the
  storage root that is not registered.

Where ocfl-py would stop with an exception of Python (an inventory whose
paths are not strings, a configuration of a layout it refuses, a digest
algorithm of an older inventory that it cannot compute, a file or folder
it is not allowed to read), opensheaf-py's
verification would stop with it; here the validation of that object or
storage root stops with an error of this program's own, E904, and the
verification goes on. The limits of a run (`LIMITS`, chapter
[10](10-http.md)) hold: an inventory, a checksum file, a declaration or a
layout file is read within `LIMITS.json` and `LIMITS.nesting`, a larger
one is not read beyond the limit (E902); a content file is read in pieces, so that its
digests are computed whatever its size, within `LIMITS.file` (beyond it,
E901: its digests are not checked); a storage root is walked up to
`LIMITS.objects` objects (E903 beyond). These codes, from 900, are this
program's, as W901 is ocfl-py's, and have no link to the specification.

The module is `core/ocfl.js`. It reads the files through a storage
(chapter [20](20-storage.md)) that can list folders: the disk of the
command line, or a storage in memory; content files are read in pieces
where the storage can (`stream`). It computes digests with `hash-wasm`,
which hashes as it reads, and which has every algorithm of the fixity
block (MD5, SHA-1, SHA-256, SHA-512, BLAKE2b).

    // in core/ocfl.js:
    import { LIMITS, nesting, utf8Problem } from './http.js';
    import { joinPath } from './storage.js';

    <<the messages of ocfl-py>>

    <<the log of a validation>>

    <<values as Python has them>>

    <<JSON as Python reads it>>

    <<dates as ocfl-py reads them>>

    <<digests>>

    <<the files of an object or storage root>>

    <<the inventory validator>>

    <<the object validator>>

    <<the storage root validator>>

The messages
------------

The messages of the codes that ocfl-py's validators log, with the names
of their parameters, copied from its `validation-errors.json` (English);
then this program's own. A message is filled with its parameters as
Python's `%` fills it: when their number is not that of the `%s` of the
message (three messages of ocfl-py ask for parameters it does not give),
Python refuses, and ocfl-py appends the parameters to the message as it
stands, as a Python dictionary. A code without a message (ocfl-py logs
E011 and E092 without one) is said as "Unknown error", with its
parameters.

    // in the messages of ocfl-py:
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

The log
-------

ocfl-py's `ValidationLogger`. Every message names its code and, for the
codes of the specification (below 200), links to it in the version of
the specification being validated against, which the declaration of the
object and the `type` of each inventory set as they are read. The
messages are kept in the order they come, the errors always and the
warnings when asked (`logWarnings`); `statusStr()` gives them sorted
(as Python sorts strings, by code points), one per line, which is what
opensheaf-py quotes. `errors` and `warnings` are the two lists.

    // in the log of a validation:
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

Values as Python has them
-------------------------

ocfl-py reads inventories with Python's `json`, and its messages show the
values it found with Python's `str` and `repr`: a head that is a JSON
object is shown `{'should not': 'be a JSON object'}`, `true` is `True`,
`null` is `None`, `1.0` stays `1.0`. So the inventories are read here as
Python reads them (below): objects as dictionaries without a prototype,
arrays, strings, `true`, `false` and `null`, integers as numbers (or
`BigInt` beyond 2^53), and the numbers Python reads as floats (with a
fraction or an exponent, and `NaN` and `Infinity`) as a `PyFloat`, which
remembers that it is one. `pyRepr` writes them as Python does;
`pyEq` compares them as Python's `==` does (`1 == 1.0`, `True == 1`).

The rest of ocfl-py's behaviour on values that are not what it expects
follows from Python's: `key in x` looks among the keys of a dictionary,
the items of a list, or within a string, and fails on anything else;
`x[key]` fails on anything but a dictionary; iterating a string gives its
characters. Where Python fails, ocfl-py stops with an exception
(`PyStop` here, which the validators turn into E904): `sep.join` of
anything but strings, `sorted` of values of different types. Where
ocfl-py catches the exception and quotes it, it quotes `str(e)`, the
message without the name of its class (`pyMessage`).

    // in values as Python has them:
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

    function pyJoin(sep, items) {
      const list = [...items];
      list.forEach((x, k) => {
        if (!isStr(x)) throw new PyStop(`TypeError: sequence item ${k}: expected str instance, ${pyType(x)} found`);
      });
      return list.join(sep);
    }

    function pySorted(items) {
      const list = [...items];
      const kinds = new Set(list.map((x) => (pyType(x) === 'bool' ? 'int' : pyType(x))));
      if (kinds.size > 1) throw new PyStop(`TypeError: '<' not supported between instances of '${[...kinds][1]}' and '${[...kinds][0]}'`);
      return list.sort((a, b) => (isStr(a) ? compareCodePoints(a, b) : (a < b ? -1 : a > b ? 1 : 0)));
    }

    function pyMessage(error) {
      return error instanceof PyStop ? error.message.replace(/^[A-Za-z]+: /, '') : error.message;
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

Python writes a float in the fewest digits that read back as the same
number, as JavaScript does, but in fixed notation only for exponents from
-4 to 15, with at least one decimal (`1.0`), and otherwise with an
exponent of at least two digits and its sign (`1e-05`, `1e+16`).

    // in values as Python has them:
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

A string is quoted with single quotes, or double quotes if it holds a
single quote and no double quote; the backslash, the quote, tab, line
feed and carriage return are escaped, and the characters Python does not
print (controls, formats, separators but the space, surrogates, private
use and unassigned) are written as `\x`, `\u` or `\U` escapes.

    // in values as Python has them:
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

Python's regular expressions on text are not JavaScript's: `\d` is any
decimal digit of Unicode (`\p{Nd}`), and `int()` reads them all; `\s`,
and the white space `str.strip()` removes, are Python's `str.isspace`
characters, which include the separators `\x1c` to `\x1f` and `\x85` but
not the byte order mark that JavaScript's `\s` and `trim()` take; `.`
stops only at a line feed, not at a carriage return or U+2028; and
`[a-z]` with `re.IGNORECASE` also matches the four letters whose case
folds into it (U+0130, U+0131, U+017F, the Kelvin sign U+212A). The
regular expressions of this chapter spell these classes out.

    // in values as Python has them:
    const PY_SPACE = '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
    const PY_LETTER = 'A-Za-z\\u0130\\u0131\\u017f\\u212a';
    const STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'gu');

    function pyStrip(s) {
      return s.replace(STRIP, '');
    }

    function pyInt(s) {
      let n = 0;
      for (const ch of s) {
        const c = ch.codePointAt(0);
        let zero = c;
        while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--;
        n = 10 * n + (c - zero) % 10;
      }
      return n;
    }

JSON as Python reads it
-----------------------

ocfl-py opens an inventory as text (UTF-8, with Python's universal
newlines: `\r\n` and `\r` become `\n`) and reads it with `json.load`. An
inventory that does not parse is E033, with the reason in the words of
Python's parser, `Expecting ',' delimiter: line 3 column 5 (char 41)`,
which `pyJson` gives: it reads JSON as Python 3.13's `json` module does,
its scanner in C (`_json.c`) included, which decides the position each
message names. Positions count characters (code points), lines and
columns from 1. Python takes `NaN`, `Infinity` and `-Infinity` for
numbers; it refuses a byte order mark, with a message of its own. An
integer of more than 4300 digits is refused too, by Python's `int`
(its limit on the conversion of text, since Python 3.11 and the
releases of the earlier versions that followed), with a `ValueError`
that is not an error of the parser: ocfl-py stops on it in an inventory,
and quotes it where it catches every exception (`ocfl_layout.json`).

    // in JSON as Python reads it:
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
        const digits = m[1].replace('-', '').length;
        if (digits > 4300) {
          throw new PyStop(`ValueError: Exceeds the limit (4300 digits) for integer string conversion: value has ${digits} digits; ` +
                           'use sys.set_int_max_str_digits() to increase the limit');
        }
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

A file read as text: its bytes within `LIMITS.json` (a larger file is
`E902`, as is JSON nested deeper than `LIMITS.nesting`), decoded as
UTF-8, where Python's decoder would stop (`PyStop`, with its words), and
with its line ends made `\n`.

    // in JSON as Python reads it:
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

ocfl-py opens `ocfl_layout.json` and the configuration of a layout in
binary instead, and `json.load` of bytes finds their encoding as Python's
`json.detect_encoding` does: UTF-32 or UTF-16 by their byte order mark,
UTF-8 with or without one, or UTF-16 or UTF-32 without one by where the
first bytes are zero. It decodes them with `surrogatepass` (a surrogate
alone is let through, in UTF-8 as `ED A0 80` and the like), and does not
make the line ends `\n`. A decoder that stops says so in Python's words
(`'utf-16-le' codec can't decode byte 0x7d in position 4: truncated
data`).

    // in JSON as Python reads it:
    function jsonBytes(bytes) {
      return jsonText(decodeDetected(bytes));
    }

    function decodeDetected(b) {
      const starts = (...xs) => xs.every((x, k) => b[k] === x);
      if (b.length >= 4 && (starts(0, 0, 0xfe, 0xff) || starts(0xff, 0xfe, 0, 0))) return wide(b, 4, b[0] === 0, 4);
      if (b.length >= 2 && (starts(0xfe, 0xff) || starts(0xff, 0xfe))) return wide(b, 2, b[0] === 0xfe, 2);
      if (b.length >= 3 && starts(0xef, 0xbb, 0xbf)) return utf8Pass(b.subarray(3));
      if (b.length >= 4) {
        if (!b[0]) return b[1] ? wide(b, 2, true, 0) : wide(b, 4, true, 0);
        if (!b[1]) return b[2] || b[3] ? wide(b, 2, false, 0) : wide(b, 4, false, 0);
      } else if (b.length === 2) {
        if (!b[0]) return wide(b, 2, true, 0);
        if (!b[1]) return wide(b, 2, false, 0);
      }
      return utf8Pass(b);
    }

    function wide(b, size, bigEndian, start) {
      const codec = `'utf-${size * 8}-${bigEndian ? 'be' : 'le'}' codec`;
      let out = '';
      for (let k = start; k < b.length; k += size) {
        if (k + size > b.length) {
          const left = b.length - k;
          throw new PyStop(left === 1
            ? `UnicodeDecodeError: ${codec} can't decode byte 0x${b[k].toString(16).padStart(2, '0')} in position ${k}: truncated data`
            : `UnicodeDecodeError: ${codec} can't decode bytes in position ${k}-${b.length - 1}: truncated data`);
        }
        let unit = 0;
        for (let j = 0; j < size; j++) unit = unit * 256 + b[bigEndian ? k + j : k + size - 1 - j];
        if (unit > 0x10ffff) throw new PyStop(`UnicodeDecodeError: ${codec} can't decode bytes in position ${k}-${k + size - 1}: code point not in range(0x110000)`);
        out += unit > 0xffff ? String.fromCodePoint(unit) : String.fromCharCode(unit);
      }
      return out;
    }

    function utf8Pass(bytes) {
      const copy = bytes.slice();
      const surrogates = new Map();
      for (let k = 0; k + 2 < copy.length; k++) {
        if (copy[k] === 0xed && copy[k + 1] >= 0xa0 && copy[k + 1] <= 0xbf && copy[k + 2] >= 0x80 && copy[k + 2] <= 0xbf) {
          surrogates.set(k, 0xd000 | ((copy[k + 1] & 0x3f) << 6) | (copy[k + 2] & 0x3f));
          copy.set([0xe0, 0xa0, 0x80], k);
          k += 2;
        }
      }
      const bad = utf8Problem(copy);
      if (bad) throw new PyStop(`UnicodeDecodeError: ${bad}`);
      if (!surrogates.size) return new TextDecoder('utf-8', { ignoreBOM: true }).decode(copy);
      let out = '', from = 0;
      for (const [k, unit] of surrogates) {
        out += new TextDecoder('utf-8', { ignoreBOM: true }).decode(copy.subarray(from, k)) + String.fromCharCode(unit);
        from = k + 3;
      }
      return out + new TextDecoder('utf-8', { ignoreBOM: true }).decode(copy.subarray(from));
    }

Dates as ocfl-py reads them
---------------------------

The `created` of a version is read by ocfl-py's `str_to_datetime`
(its module `w3c_datetime`): a date alone is taken for midnight, a
fraction of a second is set aside, the rest must be
`YYYY-MM-DDThh:mm[:ss]` with `Z` or an offset (otherwise "Bad datetime
format"), and is then given to the parser of `dateutil` with `Z`, which
refuses a field out of range in the words of Python's `datetime` (the
year, then the month, the day, the hour, the minute and the second),
followed by the text it was given. An offset beyond 23 hours or 59
minutes is refused last. Python's `$` also matches before a line feed
that ends the text, hence `(?=\n?$)`; its `\d` and `int()` take every
decimal digit of Unicode (so does `dateutil`), and its `.` a carriage
return.

    // in dates as ocfl-py reads them:
    class DateError extends Error {}

    function strToDatetime(s) {
      if (s === '') throw new DateError('Attempt to set empty datetime');
      let m = /^\p{Nd}{4}(-\p{Nd}{2}(-\p{Nd}{2})?)?(?=\n?$)/u.exec(s);
      if (m) {
        if (m[1] === undefined) s += '-01-01';
        else if (m[2] === undefined) s += '-01';
        s += 'T00:00:00Z';
      }
      m = /^([^\n]*\p{Nd}{2}:\p{Nd}{2}:\p{Nd}{2})(\.\p{Nd}+)([^\p{Nd}][^\n]*)?(?=\n?$)/u.exec(s);
      if (m) s = m[1] + (m[3] ?? '');
      m = /^(\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}T\p{Nd}{2}:\p{Nd}{2}(:\p{Nd}{2})?)(Z|([+-])(\p{Nd}{2}):(\p{Nd}{2}))?(?=\n?$)/u.exec(s);
      if (!m) throw new DateError(`Bad datetime format (${s})`);
      const given = m[1] + 'Z';
      const [year, month, day, hour, minute, second] = m[1].split(/[-T:]/).map(pyInt).concat(0).slice(0, 6);
      const days = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      const problem = year < 1 ? `year ${year} is out of range`
        : month < 1 || month > 12 ? 'month must be in 1..12'
          : day < 1 || day > days[month - 1] ? 'day is out of range for month'
            : hour > 23 ? 'hour must be in 0..23'
              : minute > 59 ? 'minute must be in 0..59'
                : second > 59 ? 'second must be in 0..59' : null;
      if (problem) throw new DateError(`${problem}: ${given}`);
      if (m[3] && m[3] !== 'Z' && (pyInt(m[5]) > 23 || pyInt(m[6]) > 59)) throw new DateError(`Bad timezone offset (${s})`);
    }

Digests
-------

The digest algorithms of OCFL (section 4.2 of the specification of OCFL,
and its extension 0001): the forms their values take in an inventory,
case aside, and their computation, for the content (sha512 or sha256) and
the fixity block (md5, sha1, sha256, sha512, blake2b-512, and blake2b-160,
-256 and -384 of the extension); ocfl-py's truncated forms of the
examples of the specification (`sha512-spec-ex`, `sha256-spec-ex`) too.
Values are compared in lower case. A content file is read once, in
pieces, for all the digests asked of it: a file read in one piece, as most
are, is digested by WebCrypto where it can (the SHA algorithms, about
twice as fast as `hash-wasm`), a file of several pieces by `hash-wasm`,
which hashes them as they come.

    // in digests:
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

The files of an object or storage root
--------------------------------------

The validators see a folder of a storage as ocfl-py sees the folder it is
given, through `fsspec`: names relative to the folder, `exists`,
`isdir`, and a listing in which each entry is a `file`, a `directory` or
`other`. A symbolic link is `other` in a listing, as `fsspec` lists it
(without following it), and is not read: the storage of the command line
never follows a link (chapter [40](40-cli.md)). A file is read in pieces
through the storage's `stream` when it has one, and whole otherwise:
whole within `LIMITS.json` (`bytes`), the reading stopping at the first
piece beyond it, so that a file of gigabytes is not brought into memory
to be refused, or piece by piece (`chunks`). A path the storage refuses (a
name with a backslash or a control character, which a storage never
reaches), a file that cannot be opened or read (its permissions, say),
and a folder that cannot be listed or is missing stop the validation as
they stop ocfl-py, with Python's `OSError`, `PermissionError` or
`FileNotFoundError`.

    // in the files of an object or storage root:
    const osError = (error) => (['EACCES', 'EPERM'].includes(error?.code) ? 'PermissionError' : 'OSError');

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
        let entries;
        try {
          entries = await this.storage.list(this.at(p));
        } catch (error) {
          throw new PyStop(`PermissionError: ${p || '.'} cannot be listed (${error.message})`);
        }
        if (entries === null) throw new PyStop(`FileNotFoundError: ${p || '.'}`);
        return entries.map((e) => ({ name: e.name, type: e.kind === 'dir' ? 'directory' : e.kind === 'file' ? 'file' : 'other' }));
      }

      async source(p) {
        try {
          if (this.storage.stream) return await this.storage.stream(this.at(p));
          const whole = await this.storage.read(this.at(p));
          return whole === null ? null : [whole];
        } catch (error) {
          throw new PyStop(`${osError(error)}: ${p} cannot be read (${error.message})`);
        }
      }

      async* pieces(p, source, limit) {
        const it = (source[Symbol.asyncIterator] ?? source[Symbol.iterator]).call(source);
        let total = 0;
        try {
          for (;;) {
            let next;
            try {
              next = await it.next();
            } catch (error) {
              throw new PyStop(`${osError(error)}: ${p} cannot be read (${error.message})`);
            }
            if (next.done) return;
            total += next.value.length;
            if (total > limit) throw new TooLarge(`larger than ${limit} bytes`);
            yield next.value;
          }
        } finally {
          await it.return?.();
        }
      }

      async bytes(p, limit = LIMITS.json) {
        const source = await this.source(p);
        if (source === null) return null;
        const parts = [];
        for await (const piece of this.pieces(p, source, limit)) parts.push(piece);
        if (parts.length === 1) return parts[0];
        const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
        let at = 0;
        for (const x of parts) {
          out.set(x, at);
          at += x.length;
        }
        return out;
      }

      async chunks(p, limit = LIMITS.file) {
        const source = await this.source(p);
        if (source === null) throw new PyStop(`FileNotFoundError: ${p}`);
        return this.pieces(p, source, limit);
      }
    }

The inventory validator
-----------------------

ocfl-py's `InventoryValidator`: the inventory read as JSON, checked
alone; `where` says which inventory it is in the messages (`root`, or
the version folder of an inventory copy). It finds the version of the
specification from `type`, the digest algorithm, the content directory,
and the versions in sequence (`allVersions`), which the object validator
uses for the files. The checks, in ocfl-py's order: the required keys and
their values (E036 to E038), the digest algorithm (sha512, or sha256 with
W004; any other stops the check, E025a), the content directory (E017,
E018), the manifest (E041, E025b, E092, E096, the content paths: E042,
E099 to E101), the version sequence (E008 to E011, W001), each version
(E048 to E054, E094, E095, W007 to W009), the head (E040), the content
paths against the versions (E042b), the digests of the manifest against
those of the states (E050a, E107), and the fixity block (E056, E057,
E097, E111).

    // in the inventory validator:
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
            if (!new RegExp(`^[${PY_LETTER}][${PY_LETTER}\\p{Nd}+\\-.]*:[^\\n]`, 'u').test(iid)) this.warning('W005', { id: iid });
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
          const m = /^https:\/\/ocfl[^\n]io\/(\p{Nd}+[^\n]\p{Nd})\/spec\/#inventory/u.exec(inventory.type);
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

An inventory of an earlier version against this one, the root inventory
(E066, W011): its versions a proper subset of these; for each, the same
states when the two use the same digest algorithm, and in any case the
same logical paths, each mapped to the same content paths; the same
`created`, `message` and `user` (a warning). Where ocfl-py joins the
members of a Python set into a message, their order is Python's, which
changes from run to run; here it is the order of the inventory.

    // in the inventory validator:
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
                this.error('E066b', { version, prior_head: prior.head, only_in: prior.head, logical_paths: pyJoin(',', onlyInPrior) });
              }
              if (onlyInSelf.length) {
                this.error('E066b', { version, prior_head: prior.head, only_in: this.where, logical_paths: pyJoin(',', onlyInSelf) });
              }
            } else {
              for (const [logicalPath, thisMap] of priorMap) {
                const theirs = selfMap.get(logicalPath);
                if (![...thisMap].every((p) => theirs.has(p))) {
                  this.error('E066c', { version, prior_head: prior.head, logical_path: logicalPath,
                                        prior_content: pyJoin(',', thisMap), current_content: pyJoin(',', theirs) });
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

The manifest: each digest of the form of the algorithm (E025b), mapping
to a list (E092, which ocfl-py logs without a message), once whatever its
case (E096); each content path checked (below), and no content path also
the folder of another (E101b). It gives the content path of every file
with its digest, the content paths of the right form, and the digests as
written, which the states must use exactly.

    // in the inventory validator:
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

The fixity block: a JSON object (E111; E056a under OCFL 1.0), each key a
known algorithm (E056b, which names, as ocfl-py does, the algorithm of
the content), each value an object (E057a) of digests of its form
(E057b), once whatever the case (E097), each mapping to a list (E057c) of
content paths of the manifest (E057d).

    // in the inventory validator:
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

The version sequence: `v1`, `v2`, ... or zero-padded of one width
(`v01`, or up to nine zeros, W001), from 1 without a gap (E009, E010),
and no more versions than the width allows (E011, logged without a
message). The versions found in sequence are the ones checked further.

    // in the inventory validator:
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

Each version: `created` present (E048), a string (E049d), a date and time
with a time zone (E049a) to the second (E049b), which ocfl-py's reading of
dates accepts (E049c); a state (E048c); a message, a string (W007a,
E094); a user (W007b), a JSON object (E054a) with a name (E054b) and an
address (W008), a string (E054c) that looks like a URI (W009). It gives
the digests the states use.

    // in the inventory validator:
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
              if (!/(Z|[+-]\p{Nd}{2}:\p{Nd}{2})(?=\n?$)/u.test(created)) this.error('E049a', { version: v });
              if (!/T\p{Nd}{2}:\p{Nd}{2}:\p{Nd}{2}/u.test(created)) this.error('E049b', { version: v });
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

A state: a JSON object (E050c) of digests of the form of the algorithm
(E050d), each mapping to a list (E050e) and written exactly as in the
manifest (E050f), its logical paths unique (E095a), well formed (E052,
E053) and none also the folder of another (E095b). The messages E052 and
E053 are crossed in ocfl-py's file of messages (E052 says "starts or
ends with /" of a path with `..`); they are kept as ocfl-py says them.

    // in the inventory validator:
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

A content path: not starting or ending with `/` (E100), of the form
`vN/content-directory/...` (E042a, E042c), without empty, `.` or `..`
elements (E099), not repeated (E101a). Whether `vN` is a version is
known only once the versions are (E042b, above).

    // in the inventory validator:
      checkContentPath(p, contentPaths, contentDirectories) {
        if (pyText(p).startsWith('/') || p.endsWith('/')) {
          this.error('E100', { path: p });
          return false;
        }
        const m = /^(v\p{Nd}+)\/([^/]+)\/([^\n]+)/u.exec(p);
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
            this.error('E066d', { version, prior_head: prior.head, digest, logical_files: pyJoin(', ', pyIter(get(selfState, digest))) });
          } else if (!has(selfState, digest)) {
            this.error('E066e', { version, prior_head: prior.head, digest, logical_files: pyJoin(', ', pyIter(get(priorState, digest))) });
          }
        }
      }
    }

The logical paths of a version, each with the set of content paths of
its digest (ocfl-py's `_get_logical_path_map`).

    // in the inventory validator:
    function logicalPathMap(inventory, version) {
      const state = get(get(get(inventory, 'versions'), version), 'state');
      const manifest = get(inventory, 'manifest');
      const out = new Map();
      for (const digest of pyIter(state)) {
        if (has(manifest, digest)) {
          for (const file of pyIter(get(state, digest))) out.set(hashable(file), new Set(pyIter(get(manifest, digest)).map(hashable)));
        }
      }
      return out;
    }

The object validator
--------------------

ocfl-py's `Validator.validate_object`, for the object in the folder `dir`
of the storage: its declaration (E003, E006, E007: the latest version of
OCFL declared wins, and sets the version of the specification), the root
inventory (E063, then the inventory validator; an inventory that cannot
be read stops here, E033), its checksum file (E058, E060, E061), the root
of the object (E001, E046b; the `logs` folder ignored; the `extensions`
folder, E067 and W013), the inventories of the versions (W010, E064 for
the last, which must be the root's copy, and for the others: the
inventory validator, their checksum files, the same `id` (E037b), the
content directory (E019, E020), the content paths of the earlier versions
kept (E023b), the versions of the specification in order (E103), and
each against the root inventory, E066 and W011), and, when the root
inventory is valid, the content: the folders of the versions (E015,
E046a, W002, W003, E024), and every file against the manifest, its
digest and the digests of the fixity blocks and of the earlier
inventories (E023a, E092, E093).

The result is the log and `valid` (no error). `checkDigests: false`
leaves out the digests of the content files and of the inventories, as
ocfl-py's option does.

Two behaviours of ocfl-py are kept as they are, because the messages
must be the same: the listing of `extensions` that `fsspec` gives names
each entry with its folder (`extensions/0001-digest-algorithms`), which
ocfl-py compares with the bare names of the registered extensions, so
that every extension folder of an object is W013, registered or not; and
more than ten files `0=...` in the object are a `NamasteException` of
ocfl-py's `find_namastes`, which stops it. What else stops this
validator, an exception that ocfl-py would not have raised or that this
port did not foresee, is E904 too, for this object alone: the validation
of the other objects and of the storage root goes on.

    // in the object validator:
    const INVENTORY = 'inventory.json';
    const REGISTERED_OBJECT_EXTENSIONS = ['0001-digest-algorithms', '0002-flat-direct-storage-layout',
      '0003-hash-and-id-n-tuple-storage-layout', '0004-hashed-n-tuple-storage-layout', '0005-mutable-head'];

    class Abort extends Error {}
    class DigestFileError extends Error {}

    function stopped(error) {
      return error instanceof PyStop ? error.message : `${error?.constructor?.name ?? 'Error'}: ${error?.message ?? error}`;
    }

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
          } else {
            this.log.error('E904', { explanation: stopped(error) });
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
        if (names.length > 10) throw new PyStop('NamasteException: Found too many Namaste files with tag 0 in ');
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

The validity of the root inventory is taken before the checksum file,
the root and the versions are checked, as ocfl-py takes it: only the
errors so far (the declaration's among them) keep the content from being
checked.

An inventory is read, as Python reads it, and given to the inventory
validator; one that is missing or does not parse stops the validation of
the object (E033). One that is too large for this program's limits stops
it too (E902).

    // in the object validator:
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

The checksum file: its first line (as Python's text mode reads lines: a
line ends at `\n`, `\r` or `\r\n`) is a digest, white space and
`inventory.json`, with nothing after but white space, in the classes of
Python's `\w`, `\s` and `\S`. Python reads that line through a decoder
of UTF-8 that is given the file 8192 bytes at a time, until a piece holds
the end of the line: bytes that are not UTF-8 in those pieces (and only
there) are a `UnicodeDecodeError`, a `ValueError` that ocfl-py reports as
E061 before going on, as it reports a line of the wrong form.

    // in the object validator:
      async readInventoryDigest(sidecar) {
        let line;
        try {
          const bytes = await this.fs.bytes(sidecar);
          if (bytes === null) throw new PyStop(`FileNotFoundError: ${sidecar}`);
          line = firstLine(bytes);
        } catch (error) {
          if (error instanceof TooLarge) throw new DigestFileError(`Bad inventory digest file ${sidecar}, wrong format`);
          if (error instanceof PyStop && error.message.startsWith('UnicodeDecodeError: ')) throw new DigestFileError(pyMessage(error));
          throw error;
        }
        const m = new RegExp(`^([\\p{L}\\p{N}_]+)[${PY_SPACE}]+([^${PY_SPACE}]+)[${PY_SPACE}]*$`, 'u').exec(line);
        if (!m) throw new DigestFileError(`Bad inventory digest file ${sidecar}, wrong format`);
        if (m[2] !== INVENTORY) throw new DigestFileError(`Bad inventory name in inventory digest file ${sidecar}`);
        return m[1];
      }

The root of the object: the declaration, the inventory and its checksum
file, the version folders, `logs` and `extensions`; anything else is an
error, a folder that looks like a version and is none E046b.

    // in the object validator:
      async validateObjectRoot(versionDirs, alreadyChecked) {
        const expected = [`0=ocfl_object_${this.specVersion}`, INVENTORY, `${INVENTORY}.${this.digestAlgorithm}`];
        for (const { name, type } of await this.fs.listdir('')) {
          if (type === 'file') {
            if (!expected.includes(name) && !alreadyChecked.includes(name)) this.log.error('E001a', { file: name });
          } else if (type === 'directory') {
            if (versionDirs.includes(name) || name === 'logs') continue;
            if (name === 'extensions') await this.validateExtensionsDir();
            else if (/^v\p{Nd}+(?=\n?$)/u.test(name)) this.log.error('E046b', { dir: name });
            else this.log.error('E001b', { dir: name });
          } else {
            this.log.error('E001c', { entry: name });
          }
        }
      }

      async validateExtensionsDir() {
        for (const { name, type } of await this.fs.listdir('extensions')) {
          if (type === 'directory') {
            if (!REGISTERED_OBJECT_EXTENSIONS.includes(`extensions/${name}`)) this.log.warning('W013', { entry: `extensions/${name}` });
          } else {
            this.log.error('E067', { entry: `extensions/${name}` });
          }
        }
      }

The inventories of the versions, in sequence. The last must be a copy of
the root inventory, byte for byte; the others are validated, each with
its own digest algorithm and version of the specification, and against
the root inventory. ocfl-py reports E019 for each of them that does not
set the content directory when the root inventory does (its test of the
first version is always true), and so does this program. The content
paths and digests of the manifests and fixity blocks of these inventories
are kept, by content path, algorithm and digest, with the versions that
state them, to be checked against the files.

    // in the object validator:
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
                this.log.error('E023b', { where: versionDir, missing_filepaths: pyJoin(', ', pySorted(notSeen)) });
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

The content. Each version folder holds its inventory and checksum file,
the content directory, whose every folder holds something (E024) and
which holds at least one file (W003), and no other file (E015) or folder
(W002); a version of the inventory without its folder is E046a. The
fixity block of the root inventory must name only files that are there
(E093b), the manifest every file that is there (E023a) and only those
(E092b), with their digests (E092a), and the fixity blocks of the root and
of the earlier inventories theirs (E093a), each computed once.

    // in the object validator:
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

A file is read once for all the algorithms asked of it: that of the
content, and those of the fixity blocks and earlier manifests that name
it. The files are read `LIMITS.concurrency` at a time, before the checks,
which then go in ocfl-py's order: what reading a file met (a file beyond
`LIMITS.file`, E901, or one that cannot be read) is said when its turn
comes. An algorithm that no digest of this program computes stops the
validation where ocfl-py would stop (it raises the `ValueError` of its
`file_digest`), after the checks before it.

    // in the object validator:
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

The first line of a file, as `readline` of a file opened as text gives
it: the pieces decoded in turn (a sequence of UTF-8 cut by the end of a
piece waits for the next), the line ends made `\n`.

    // in the object validator:
    function firstLine(bytes) {
      const PIECE = 8192;
      const nl = bytes.findIndex((b) => b === 0x0a || b === 0x0d);
      const end = nl < 0 ? bytes.length : Math.min(bytes.length, (Math.floor(nl / PIECE) + 1) * PIECE);
      let carry = new Uint8Array(0), text = '';
      for (let k = 0; k < end; k += PIECE) {
        const piece = new Uint8Array(carry.length + Math.min(PIECE, end - k));
        piece.set(carry);
        piece.set(bytes.subarray(k, k + PIECE).subarray(0, piece.length - carry.length), carry.length);
        const cut = k + PIECE >= bytes.length ? 0 : incompleteTail(piece);
        const whole = piece.subarray(0, piece.length - cut);
        const bad = utf8Problem(whole);
        if (bad) throw new PyStop(`UnicodeDecodeError: ${bad}`);
        text += new TextDecoder('utf-8', { ignoreBOM: true }).decode(whole);
        carry = piece.slice(piece.length - cut);
      }
      const m = /\r\n|\r|\n/.exec(text);
      return m ? text.slice(0, m.index) + '\n' : text;
    }

    function incompleteTail(b) {
      for (let back = 1; back <= Math.min(3, b.length); back++) {
        const lead = b[b.length - back];
        if (lead < 0x80) return 0;
        if (lead < 0xc0) continue;
        const size = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
        if (size <= back) return 0;
        const [low, high] = lead === 0xe0 ? [0xa0, 0xbf] : lead === 0xed ? [0x80, 0x9f] : lead === 0xf0 ? [0x90, 0xbf]
          : lead === 0xf4 ? [0x80, 0x8f] : [0x80, 0xbf];
        for (let j = 1; j < back; j++) {
          const c = b[b.length - back + j];
          if (j === 1 ? c < low || c > high : c < 0x80 || c > 0xbf) return 0;
        }
        return back;
      }
      return 0;
    }

A declaration (NAMASTE) holds its name after `0=`, then a line feed: its
text, stripped of Python's white space (a byte order mark stays) and cut
to 40 characters, with every character but letters, digits, `_`, `.`,
`-` and `:` made `_`, must be that name.

    // in the object validator:
    async function namasteContentOk(fs, name) {
      try {
        const bytes = await fs.bytes(name);
        if (bytes === null) return false;
        const content = pyStrip(textOf(bytes));
        return name.slice(2) !== '' && name.slice(2) === [...content].slice(0, 40).join('').replace(/[^\p{L}\p{N}_.\-:]/gu, '_');
      } catch (error) {
        if (error instanceof TooLarge) return false;
        throw error;
      }
    }

A walk of a folder as ocfl-py's `fsw_walk` walks it: each folder with
the names of its folders and of its other entries (files, and links,
which `fsspec` does not count as folders), the folders entered in turn
unless the caller empties the list it was given. Paths start with `/`, as
ocfl-py's do.

    // in the object validator:
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

The storage root validator
--------------------------

ocfl-py's `StorageRoot.validate`, for the storage root in the folder
`root` of the storage: its declaration, one file `0=ocfl_1.1` (or
`0=ocfl_1.0`) holding its name (E069), its `ocfl_layout.json` if any (a
JSON object, E070, naming a layout that ocfl-py knows, E071, whose
configuration in `extensions/` it accepts), then the hierarchy of folders
down to the objects: the `extensions` folder of the root (E086, W901),
then every other folder, which holds folders only, or is an object (a
declaration of an object of a known version, E003d, E004), and is never
empty (E073); a folder with files and no declaration is E072. Objects are
not entered. A storage root whose declaration or layout is refused is
not walked.

With `validateObjects`, every object found is validated too, as
`validate()` of ocfl-py does by default; `osheaf verify` validates each
object once, by itself, and the storage root without them, as
opensheaf-py does. The result: `valid` (no error in the declaration,
the layout or the hierarchy: as in ocfl-py, an object that is not valid
does not make the storage root so), the log of the storage root, and the
objects, each with its path and, with `validateObjects`, its result.

    // in the storage root validator:
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
        else log.error('E904', { explanation: stopped(error) });
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
        traversalError('E904', { explanation: stopped(error) });
      }
      return { valid: traversal === 0, log, objects };
    }

The declaration and the layout. ocfl-py would stop with an exception on
a configuration of the layout that it refuses (its `LayoutException`);
that is E904 here. `ocfl_layout.json` and the configuration are read as
bytes (`jsonBytes`, above), and every exception in the reading of
`ocfl_layout.json` is E070a, with the message Python gives, as ocfl-py
catches them all there. A `digestAlgorithm` that is not a string (a list
or a mapping) is not one of the digests of `string_digest`.

    // in the storage root validator:
    async function checkRootStructure(fs, root) {
      if (!(await fs.isdir(''))) throw new PyStop(`FileNotFoundError: no folder ${root}`);
      const names = (await fs.listdir('')).map((e) => e.name).filter((n) => n.startsWith('0=')).sort(compareCodePoints);
      if (names.length > 10) throw new PyStop('NamasteException: Found too many Namaste files with tag 0 in ');
      if (names.length === 0) throw new RootError('E069a', { root });
      if (names.length > 1) throw new RootError('E069b', { root });
      const spec = SPEC_VERSIONS.find((x) => names[0] === `0=ocfl_${x}`);
      if (!spec) throw new RootError('E069c', { root, namaste_file: names[0] });
      if (!(await namasteContentOk(fs, names[0]))) throw new RootError('E069e', { root, namaste_file: names[0] });
      if (await fs.exists('ocfl_layout.json')) {
        let layout;
        try {
          layout = jsonBytes((await fs.bytes('ocfl_layout.json')) ?? new Uint8Array());
        } catch (error) {
          throw new RootError('E070a', { root, message: pyMessage(error) });
        }
        if (!isDict(layout)) throw new RootError('E070b', { root });
        if (!isStr(layout.extension) || !isStr(layout.description)) throw new RootError('E070c', { root });
        if (!Object.hasOwn(LAYOUTS, layout.extension)) throw new RootError('E071', { root, layout_name: layout.extension });
        const [name, check] = LAYOUTS[layout.extension];
        const file = `extensions/${name}/config.json`;
        if (await fs.exists(file)) {
          let config;
          try {
            config = jsonBytes((await fs.bytes(file)) ?? new Uint8Array());
          } catch (error) {
            throw new PyStop(`LayoutException: Storage root extension config file ${file} exists but can't be read/parsed (${pyMessage(error)})`);
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

The parameters of the layouts that have them, as ocfl-py checks them;
each gives the reason it refuses them, or `null`.

    // in the storage root validator:
    const isInt = (x) => typeof x === 'boolean' || typeof x === 'bigint' || Number.isInteger(x);
    const HEX_LENGTHS = { sha512: 128, sha256: 64, sha1: 40, md5: 32 };

    function checkHashedLayout(config) {
      const alg = config.digestAlgorithm ?? null, size = config.tupleSize ?? null, count = config.numberOfTuples ?? null;
      if (alg === null) return 'digestAlgorithm parameter must be specified';
      if (!isStr(alg) || !Object.hasOwn(HEX_LENGTHS, alg)) return `digestAlgorithm parameter specifies unknown or unsupported digests ${pyStr(alg)} (Unsupport digest type ${pyStr(alg)})`;
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

The hierarchy, as ocfl-py's `object_paths` walks it; the paths of the
objects are relative to the storage root.

    // in the storage root validator:
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
            const m = /^0=ocfl_object_(\p{Nd}+\.\p{Nd}+)/u.exec(declarations[0]);
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
