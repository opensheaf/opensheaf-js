// Generated from literate/33-inputs.md by opensheaf-literate: edit the document, not this file.
import { exit, pyRepr } from './folder.js';

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
    }
    out[k] = v;
  }
  return out;
}

export function camel(name) {
  return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export function merge(args, entry, defaults, command, rename = {}, specs = {}) {
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
    if (JSON.stringify(ns[d]) === JSON.stringify(defaults[d])) ns[d] = specs[d] ? valueOf(specs[d], v, command, k.replace(/_/g, '-')) : v;
  }
  return ns;
}

const BOOLEAN = { true: true, yes: true, false: false, no: false };

export function valueOf(spec, v, command, name) {
  const bad = (why) => {
    throw new UsageProblem(`${command}: ${name} in the file: ${why}`);
  };
  if (spec.flag) {
    const b = typeof v === 'boolean' ? v : typeof v === 'string' && Object.hasOwn(BOOLEAN, v) ? BOOLEAN[v] : null;
    if (b === null) bad(`true or false, not ${pyRepr(v)}`);
    return b;
  }
  const one = (x) => {
    if ((x !== null && typeof x === 'object') || (typeof x === 'boolean' && !spec.type && !spec.check)) {
      bad(`a value, not ${pyRepr(x)}`);
    }
    if (spec.type === 'int') {
      const text = typeof x === 'number' ? String(x) : String(x);
      if (!/^\s*[-+]?[0-9]+\s*$/.test(text)) bad(`not ${pyRepr(x)} (invalid literal for int() with base 10: ${pyRepr(String(x))})`);
      x = Number(text);
    } else if (spec.check) {
      try {
        spec.check(String(x));
      } catch (error) {
        bad(`not ${pyRepr(x)} (${error.message})`);
      }
      x = String(x);
    } else if (typeof x !== 'string') {
      x = typeof x === 'boolean' ? (x ? 'True' : 'False') : String(x);
    }
    if (spec.choices && !spec.choices.includes(x)) bad(`one of ${spec.choices.join(', ')}, not ${pyRepr(x)}`);
    return x;
  };
  if (spec.repeat || spec.list) return (Array.isArray(v) ? v : [v]).map(one);
  return one(v);
}

export class UsageProblem extends Error {}
