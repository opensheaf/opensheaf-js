Validating against the JSON Schemas
===================================

> This chapter is chapter 12 of the [OpenSheaf
> Explorer](https://opensheaf.org/explorer/source/12-schema.html), copied
> with its reasoning (chapter [00](00-plan.md)). "The explorer" below is the
> reader of archives this code was written for, in a browser; opensheaf-js
> reads and verifies archives with the same code, from a web server or from
> a storage (chapter [20](20-storage.md)), and the Explorer will import it
> from here.


The JSON files defined by the specification (`opensheaf.json`,
`object.json`, `members.json`, `genesis.json`, `keys.json`, signature
files, the files of indexes) must validate against its JSON Schemas
(section 2 and appendix B), and section 14.2 asks a verifier to check
them "formats (dates, URIs) included as assertions, which JSON Schema
2020-12 leaves optional". `osheaf verify` uses the Python package
`jsonschema`. The explorer has no dependencies, so it has its own
validator: not a general one, but one for the keywords the schemas of
version 0.2 use, which are few, with the formats they use checked as
assertions.

The schemas are those of the specification, copied unchanged into
`schemas/` (they are dedicated to the public domain under CC0 1.0, so that
any software can embed them); a new version of the specification brings
new files there. The application reads them from its own site; the tests
read them from the disk.

The module is `core/schema.js`.

    // in core/schema.js:
    <<comparing JSON values>>

    <<the formats checked as assertions>>

    <<the validator>>

    <<loading the schemas of the specification>>

Comparing JSON values
---------------------

`const`, `enum` and `uniqueItems` compare JSON values, and so does the
verification (a notice must be kept "unchanged", section 4.2). Two values
are the same if they have the same canonical text: the JSON text with the
keys of every object sorted, so that the order in which a file writes its
keys does not matter, as it does not for Python's dictionaries, which
`osheaf verify` compares.

    // in comparing JSON values:
    export function canonical(value) {
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
      }
      return JSON.stringify(value) ?? 'null';
    }

    export function same(a, b) {
      return canonical(a) === canonical(b);
    }

Formats
-------

The schemas use three formats:

- `date`, a full date of RFC 3339 (`2026-11-14`), which must also be a
  day of the calendar (no 30 February);
- `uri`, an absolute URI of RFC 3986: a scheme, a colon, and characters
  allowed in URIs, with `%` only in percent-encodings. A `tag:` URI
  (`tag:opensheaf.org,2026:mgubi`) is one;
- `uri-reference`, a URI or a relative reference (the `storageRoot` may be
  `ocfl/`).

The checks of URIs are syntactic and lenient about the structure of the
parts (they do not parse the authority), but strict about characters:
spaces and non-ASCII characters, which are allowed in IRIs and not in
URIs, are rejected.

A difference with `osheaf verify` is worth stating. `jsonschema` checks a
format only if a package for it is installed: dates always, URIs only with
the package `rfc3987`, which `opensheaf-py` does not require. The explorer
always checks all three, as section 14.2 asks; an archive whose URIs are
malformed fails here and may pass there.

    // in the formats checked as assertions:
    const URI_CHAR = "[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%]";
    const URI = new RegExp(`^[A-Za-z][A-Za-z0-9+.\\-]*:${URI_CHAR}*$`);
    const URI_REFERENCE = new RegExp(`^${URI_CHAR}*$`);
    const PERCENT_OK = (s) => !/%(?![0-9A-Fa-f]{2})/.test(s);

    export const FORMATS = {
      date(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return false;
        const [y, mo, d] = m.slice(1).map(Number);
        const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
        return days !== undefined && d >= 1 && d <= days;
      },
      uri: (s) => URI.test(s) && PERCENT_OK(s),
      'uri-reference': (s) => URI_REFERENCE.test(s) && PERCENT_OK(s),
    };

The validator
-------------

`validate(schema, data)` returns the list of errors, each with the place
in the data (a JSON pointer such as `/objects/3/head`) and a message. The
keywords are those of the schemas: `type`, `required`, `properties`,
`additionalProperties`, `pattern`, `format`, `items`, `minLength`,
`maxLength`, `minItems`, `maxItems`, `minimum`, `maximum`,
`minProperties`, `const`, `enum`, `if`/`then`/`else`, `anyOf`, `oneOf`,
`allOf`, `not`, `$ref` to the schema's own `$defs`, `uniqueItems`,
`propertyNames` and `dependentRequired`. A schema using
another keyword is not wrong, but the keyword is ignored, so a new schema
must be checked against this list.

    // in the validator:
    <<the messages of the validator>>

    <<the keywords of a schema>>

    export function validate(schema, data) {
      const errors = [];
      check(schema, data, '', schema, errors);
      return errors;
    }

    function isValid(schema, data, root) {
      const errors = [];
      check(schema, data, '', root, errors);
      return errors.length === 0;
    }

Values are shown in messages as short JSON; the type of a value is the
type of JSON Schema, in which an integer is a number without a fractional
part (`2.0` is an integer, as JSON Schema says).

    // in the messages of the validator:
    function show(value) {
      const text = JSON.stringify(value) ?? String(value);
      return text.length > 60 ? text.slice(0, 57) + '...' : text;
    }

    function typeOf(value) {
      if (value === null) return 'null';
      if (Array.isArray(value)) return 'array';
      if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
      return typeof value;
    }

    function hasType(type, value) {
      const t = typeOf(value);
      return type === t || (type === 'number' && t === 'integer');
    }

`not` is used by the schemas only to forbid properties ("a member of a
selection has no `version`, `inventorySha512` or `follow`"); its message
says so when it can, rather than "is valid under a forbidden schema".

    // in the messages of the validator:
    function describeNot(schema) {
      const names = (s) => s?.required || [];
      const forbidden = [...names(schema), ...(schema?.anyOf || []).flatMap(names)];
      return forbidden.length ? `must not have ${forbidden.join(', ')}` : 'is valid under a schema it must not match';
    }

The keywords are checked in turn. Those of a type apply only to values of
that type, as JSON Schema says: `minLength` says nothing about a number.
`$ref` is a JSON pointer into the schema itself (`#/$defs/note`); since
2020-12 it applies together with the other keywords beside it. Lengths of
strings are counted in characters (code points), not in UTF-16 units.

    // in the keywords of a schema:
    function check(s, v, path, root, errors) {
      if (s === true || s === undefined) return;
      if (s === false) {
        errors.push({ path, message: 'is not allowed' });
        return;
      }
      const fail = (message) => errors.push({ path, message });
      if (typeof s.$ref === 'string') check(resolveRef(root, s.$ref), v, path, root, errors);
      if (s.type !== undefined) {
        const types = Array.isArray(s.type) ? s.type : [s.type];
        if (!types.some((t) => hasType(t, v))) {
          fail(`${show(v)} is not of type ${types.join(' or ')}`);
          return;
        }
      }
      if ('const' in s && !same(s.const, v)) fail(`${show(v)} should be ${show(s.const)}`);
      if (s.enum && !s.enum.some((e) => same(e, v))) fail(`${show(v)} is not one of ${show(s.enum)}`);
      if (typeof v === 'string') {
        <<the keywords of strings>>
      }
      if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) fail(`${v} is less than ${s.minimum}`);
      if (typeof v === 'number' && s.maximum !== undefined && v > s.maximum) fail(`${v} is greater than ${s.maximum}`);
      if (Array.isArray(v)) {
        <<the keywords of arrays>>
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        <<the keywords of objects>>
      }
      <<the keywords that combine schemas>>
    }

    function resolveRef(root, ref) {
      if (!ref.startsWith('#')) throw new Error(`unsupported $ref ${ref}`);
      return ref.slice(1).split('/').filter(Boolean)
        .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
        .reduce((node, key) => node?.[key], root);
    }

Patterns are regular expressions of ECMA-262, which is what JSON Schema
specifies, so they are used as they are, with the `u` flag (code points),
and match anywhere unless anchored. They are compiled once.

    // in the keywords of strings:
    const length = [...v].length;
    if (s.minLength !== undefined && length < s.minLength) fail(`${show(v)} is shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && length > s.maxLength) fail(`${show(v)} is longer than ${s.maxLength}`);
    if (s.pattern !== undefined && !pattern(s.pattern).test(v)) fail(`${show(v)} does not match ${s.pattern}`);
    if (s.format !== undefined && FORMATS[s.format] && !FORMATS[s.format](v)) fail(`${show(v)} is not a valid ${s.format}`);

The compiled patterns are kept by their source.

    // in the validator:
    const patterns = new Map();
    function pattern(source) {
      if (!patterns.has(source)) patterns.set(source, new RegExp(source, 'u'));
      return patterns.get(source);
    }

Arrays have a minimum and a maximum length, may require distinct items
(compared as JSON values, above), and have a schema for every item.

    // in the keywords of arrays:
    if (s.minItems !== undefined && v.length < s.minItems) fail(`has fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) fail(`has more than ${s.maxItems} items`);
    if (s.uniqueItems && new Set(v.map(canonical)).size !== v.length) fail('has repeated items');
    if (s.items !== undefined) v.forEach((item, k) => check(s.items, item, `${path}/${k}`, root, errors));

Properties not named in `properties` are checked against
`additionalProperties`, which the schemas never set to `false`: readers
ignore unknown properties (section 2). The names of the properties of
the data are the archive's: a property named `constructor` must not be
taken for one named in the schema because every JavaScript object
inherits a `constructor`, so names are looked up with `Object.hasOwn`
(see also [the versions](13-versions.md)).

    // in the keywords of objects:
    if (s.minProperties !== undefined && Object.keys(v).length < s.minProperties) {
      fail(`has fewer than ${s.minProperties} properties`);
    }
    for (const name of s.required || []) {
      if (!Object.hasOwn(v, name)) fail(`${JSON.stringify(name)} is a required property`);
    }
    const props = s.properties || {};
    for (const [name, value] of Object.entries(v)) {
      const where = `${path}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (Object.hasOwn(props, name)) check(props[name], value, where, root, errors);
      else if (s.additionalProperties !== undefined) check(s.additionalProperties, value, where, root, errors);
      if (s.propertyNames !== undefined) {
        for (const e of collect(s.propertyNames, name, root)) {
          errors.push({ path: where, message: `the name ${e.message}` });
        }
      }
    }
    for (const [name, needed] of Object.entries(s.dependentRequired || {})) {
      if (Object.hasOwn(v, name)) {
        for (const other of needed) {
          if (!Object.hasOwn(v, other)) fail(`${JSON.stringify(other)} is required with ${JSON.stringify(name)}`);
        }
      }
    }

`anyOf` fails with the first error of each alternative, which usually
says what is missing ("`text` is required; or `path` is required");
`oneOf` also fails when more than one alternative holds.

    // in the keywords that combine schemas:
    for (const sub of s.allOf || []) check(sub, v, path, root, errors);
    if (s.anyOf && !s.anyOf.some((sub) => isValid(sub, v, root))) {
      const reasons = s.anyOf.map((sub) => collect(sub, v, root)[0]).filter(Boolean)
        .map((e) => (e.path ? `${e.path}: ` : '') + e.message);
      fail(`satisfies none of the alternatives (${reasons.join('; or ')})`);
    }
    if (s.oneOf) {
      const holding = s.oneOf.filter((sub) => isValid(sub, v, root)).length;
      if (holding === 0) {
        const reasons = s.oneOf.map((sub) => collect(sub, v, root)[0]).filter(Boolean)
          .map((e) => (e.path ? `${e.path}: ` : '') + e.message);
        fail(`satisfies none of the alternatives (${reasons.join('; or ')})`);
      } else if (holding > 1) {
        fail(`satisfies ${holding} of the alternatives, and should satisfy one`);
      }
    }
    if (s.not !== undefined && isValid(s.not, v, root)) fail(describeNot(s.not));
    if (s.if !== undefined) {
      if (isValid(s.if, v, root)) {
        if (s.then !== undefined) check(s.then, v, path, root, errors);
      } else if (s.else !== undefined) {
        check(s.else, v, path, root, errors);
      }
    }

The errors of a schema, collected without being reported, serve `anyOf`
and `propertyNames`.

    // in the validator:
    function collect(schema, data, root) {
      const errors = [];
      check(schema, data, '', root, errors);
      return errors;
    }

The schemas
-----------

The schemas are read once, by a function given to `loadSchemas` that
reads a file next to the application: `fetch` in the browser, the file
system in the tests. The result maps the format version declared by a
file (its `format`) to its schema, which is how section 2 says a file is
validated: "against the JSON Schemas of appendix B for their declared
format version". The explorer reads only version 0.2: an archive of
version 0.1 is not read, but recognised and reported as one to rebuild
(chapter [14](14-archive.md)). A file declaring a version the explorer does not know is
reported as such (section 16), not validated against another version's
schema.

    // in loading the schemas of the specification:
    export const SCHEMA_FILES = {
      'opensheaf-archive/0.2': 'opensheaf-archive-0.2.schema.json',
      'opensheaf-object/0.2': 'opensheaf-object-0.2.schema.json',
      'opensheaf-collection/0.2': 'opensheaf-collection-0.2.schema.json',
      'opensheaf-genesis/0.2': 'opensheaf-genesis-0.2.schema.json',
      'opensheaf-keys/0.2': 'opensheaf-keys-0.2.schema.json',
      'opensheaf-signature/0.2': 'opensheaf-signature-0.2.schema.json',
      'opensheaf-index/0.2': 'opensheaf-index-0.2.schema.json',
      'opensheaf-keeper/0.2': 'opensheaf-keeper-0.2.schema.json',
      'opensheaf-timestamps/0.2': 'opensheaf-timestamps-0.2.schema.json',
    };

    export async function loadSchemas(read) {
      const schemas = {};
      for (const [format, file] of Object.entries(SCHEMA_FILES)) {
        schemas[format] = await read(new URL(`../schemas/${file}`, import.meta.url));
      }
      return schemas;
    }

    export async function fetchSchemas() {
      return loadSchemas(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`cannot read the schema ${url}`);
        return response.json();
      });
    }
