Options from files
==================

`osheaf deposit`, `relicense`, `relate`, `describe` and `init` also take
their options from a file, `--from FILE`: a YAML or JSON mapping with the
names of the options (`title`, `author` or `authors`, `extra-source` or
`extra-sources`, `keyword` or `keywords`, `abstract-file`, ...), or a list
of such mappings, which makes several runs, in order. Options given on the
command line win over the file; paths are relative to the file. `osheaf
collection sync LABEL --from collection.yaml` describes a collection the
same way (chapter [30](30-collections.md)).

This chapter ports opensheaf-py's `inputs` (its chapter
[60-command-line](https://opensheaf.org/opensheaf-py/60-command-line.html)).
YAML is read by the package [`yaml`](https://eemeli.org/yaml/) 2.8.1,
pinned like the two others (chapter [00](00-plan.md)): it runs in browsers,
Deno and Node, and is loaded only when a YAML file is read. The options of
a command are read as opensheaf-py's `BaseLoader` reads them, every value
kept as text (the schema `failsafe`), so that nothing is converted
silently: `2611.14296` stays an arXiv identifier, `2025-01-02` a date. A
collection is read as `yaml.safe_load` reads it, with the schema of YAML
1.1, so that `follow: yes` is true there as in opensheaf-py.

    // in core/inputs.js:
    import { exit } from './folder.js';

    <<reading a file of options>>

    <<the options of a run>>

Reading a file of options
-------------------------

The command line gives the name of the file and its text; a name ending
with `.json` is JSON, anything else YAML.

    // in reading a file of options:
    export async function parseData(name, text, { yaml11 = false } = {}) {
      if (name.toLowerCase().endsWith('.json')) return JSON.parse(text);
      const YAML = await import('yaml');
      const options = yaml11 ? { version: '1.1', schema: 'yaml-1.1' } : { schema: 'failsafe' };
      return YAML.parse(text, options);
    }

    export const ALIASES = { authors: 'author', keywords: 'keyword', extra_sources: 'extra_source',
                             relations: 'related', tools: 'toolchain' };
    export const PATHS = ['source', 'pdf', 'abstract_file', 'folder'];
    export const LISTS = ['author', 'keyword', 'extra_source', 'related', 'toolchain'];

    export async function loadEntries(name, text) {
      let data;
      try {
        data = await parseData(name, text);
      } catch (error) {
        if (name.toLowerCase().endsWith('.json')) throw error;
        exit(`${name}: not valid YAML: ${error.message}\n(texts with ': ' or starting with a special character need quotes)`);
      }
      if (data !== null && typeof data === 'object' && !Array.isArray(data)) data = [data];
      const isMap = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
      if (!Array.isArray(data) || !data.every(isMap)) exit(`${name}: expected a mapping of options, or a list of them`);
      const k = name.lastIndexOf('/');
      const base = k < 0 ? '' : name.slice(0, k);
      return data.map((x) => normalise(x, base));
    }

A path in the file is relative to the folder of the file. Authors may be
mappings of a name and an affiliation, extra sources mappings of a file
and its path in the deposit, tools mappings of a name and a version.

    // in reading a file of options:
    export function under(base, p) {
      if (p.startsWith('/') || !base || base === '.') return p;
      return `${base}/${p}`;
    }

    export function normalise(entry, base) {
      const out = {};
      for (let [k, v] of Object.entries(entry)) {
        k = String(k).trim().toLowerCase().replace(/-/g, '_');
        k = ALIASES[k] || k;
        if (LISTS.includes(k) && !Array.isArray(v)) v = [v];
        if (k === 'author') {
          v = v.map((a) => (typeof a === 'string' ? a : a.name + (a.affiliation ? `|${a.affiliation}` : '')));
        } else if (k === 'extra_source') {
          v = v.map((x) => {
            if (typeof x === 'string' && !x.includes('=')) return under(base, x);
            if (typeof x === 'string') {
              const e = x.indexOf('=');
              return under(base, x.slice(0, e)) + '=' + x.slice(e + 1);
            }
            return under(base, x.file) + (x.path ? `=${x.path}` : '');
          });
        } else if (k === 'toolchain') {
          v = v.map((x) => (typeof x === 'string' ? x : Object.entries(x)[0].join('=')));
        } else if (PATHS.includes(k) && typeof v === 'string') {
          v = under(base, v);
        } else if (k === 'after') {
          v = Number.parseInt(v, 10);
        }
        out[k] = v;
      }
      return out;
    }

The options of a run
--------------------

An entry of the file gives the options the command line left at their
defaults. Its names are opensheaf-py's (`abstract_file`, `id` for the
label), which the command line maps to its own; a name that is not an
option of the command is refused, and a file's `date` is `available`, as
on the command line.

    // in the options of a run:
    export function camel(name) {
      return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    }

    export function merge(args, entry, defaults, command, rename = {}) {
      const ns = { ...args };
      const known = new Set(Object.keys(defaults));
      const dest = (k) => rename[k] || camel(k);
      if ('date' in entry && !known.has('date') && known.has('available')) {
        entry = Object.fromEntries(Object.entries(entry).map(([k, v]) => [k === 'date' ? 'available' : k, v]));
      }
      const unknown = Object.keys(entry).filter((k) => !known.has(dest(k)));
      if (unknown.length) throw new UsageProblem(`${command}: unknown option(s) in the file: ${unknown.sort().join(', ')}`);
      for (const [k, v] of Object.entries(entry)) {
        const d = dest(k);
        if (JSON.stringify(ns[d]) === JSON.stringify(defaults[d])) ns[d] = v;
      }
      return ns;
    }

    export class UsageProblem extends Error {}
