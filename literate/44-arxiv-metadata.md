Importing from arXiv: the metadata
==================================

The description of a document version imported from arXiv, its
`datacite.json` (section 4.4), is made from arXiv's OAI record and from
the abstract page of each version, both downloaded as chapter
[43](43-arxiv.md) describes. This chapter reads the record and converts
its fields, as opensheaf-py's chapter
[41-arxiv-metadata](https://opensheaf.org/opensheaf-py/41-arxiv-metadata.html)
does, expression for expression: the names of the authors, the title and
the abstract, written by the authors in TeX, and the licences. The
regular expressions are Python's, written for JavaScript: `re.S` is the
class `[\s\S]`, and the replacements are functions, so that a `$` in a
replacement is never read as a reference to a group.

Reading the record
------------------

The record is XML: the envelope of OAI-PMH, and in it the metadata in the
format `arXivRaw`. opensheaf-py reads it with ElementTree. No parser of
XML is common to browsers, Deno and Node (browsers have `DOMParser`, the
others do not), and the record is simple: the fields we use are elements
of the `arXivRaw` element holding only text, and the versions, elements
`version` with an attribute and three such fields. So the record is read
with regular expressions: the `arXivRaw` element, then the first element
of each name in it, its text with the five entities of XML and the
references to characters decoded, as a parser of XML would. Lines end
with `\n`, as XML normalises them.

    // in arXiv: reading the arXivRaw record:
    export function xmlText(text) {
      return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, c) => c.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[x]))
        .replace(/&(lt|gt|amp|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, (m, e) => {
          if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
          return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
        });
    }

    function element(xml, tag) {
      const m = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>)`).exec(xml);
      if (!m) return null;
      return { text: m[1] === undefined ? null : xmlText(m[1]), attrs: m[0].slice(0, m[0].indexOf('>')) };
    }

    function elements(xml, tag) {
      const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`, 'g');
      return [...xml.matchAll(re)].map((m) => ({ inner: m[1], attrs: m[0].slice(0, m[0].indexOf('>')) }));
    }

    export function words(s) {
      return s.split(/\s+/).filter(Boolean);
    }

The fields, as opensheaf-py's `record` gives them. Text fields have
their white space normalised, since arXiv folds long lines; the abstract
keeps its line breaks, which separate paragraphs, but loses the spaces
around them. The dates of the versions are written as in e-mail (`Mon, 3
Apr 2023 17:59:58 GMT`) and become ISO 8601; Python's `strftime` writes
the time as the date gives it, with a `Z`, and so do we.

    // in arXiv: reading the arXivRaw record:
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    export function emailDate(text) {
      const m = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text || '');
      if (!m || !MONTHS.includes(m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase())) throw new Error(`not a date: ${text}`);
      let year = Number(m[3]);
      if (m[3].length === 2) year += year > 68 ? 1900 : 2000;
      const two = (n) => String(n).padStart(2, '0');
      const month = MONTHS.indexOf(m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()) + 1;
      return `${String(year).padStart(4, '0')}-${two(month)}-${two(m[1])}T${two(m[4])}:${m[5]}:${m[6] || '00'}Z`;
    }

    export function record(xmlBytes, where) {
      const xml = new TextDecoder().decode(xmlBytes).replace(/\r\n?/g, '\n');
      const raw = /<(?:[A-Za-z_][\w.-]*:)?arXivRaw(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?arXivRaw\s*>/.exec(xml);
      if (!raw) exit(`${where}: no arXivRaw record`);
      const r = raw[1];
      const text = (tag) => {
        const e = element(r, tag);
        return e && e.text ? words(e.text).join(' ') || '' : null;
      };
      const versions = elements(r, 'version').map((v) => ({
        v: /version="([^"]*)"/.exec(v.attrs)?.[1] ?? null,
        date: emailDate(element(v.inner, 'date')?.text),
        source_type: (element(v.inner, 'source_type')?.text || '').trim(),
      }));
      const authors = authorNames(text('authors'));
      const abstract = (element(r, 'abstract')?.text ?? '').trim();
      return { id: text('id'), title: text('title'), authors: authors.filter((a) => a.trim()).map(detex),
               abstract: abstract.replace(/[ \t]*\n[ \t]*/g, '\n'), license: text('license'), doi: text('doi'),
               journal: text('journal-ref'), categories: words(text('categories') || ''), comments: text('comments'),
               versions };
    }

The list of authors is split at the commas and at the word "and", also
when the two come together, as in `A, B, and C`; affiliations in
parentheses are removed first, innermost first, since their commas are
not separators.

    // in arXiv: reading the arXivRaw record:
    export function authorNames(s) {
      for (;;) {
        const t = s.replace(/\s*\([^()]*\)/g, '');
        if (t === s) break;
        s = t;
      }
      return s.split(/,\s*(?:and\s+)?|\s+and\s+/).filter((a) => a.trim());
    }

Names
-----

arXiv keeps the names of authors as the authors typed them, often in TeX:
`G\"unter`, `Ga\'{e}tan`, `\v{S}imon`. An accent command becomes the
corresponding combining character after the letter, and normalisation
(NFC) merges the two where one character exists. `texText` is
opensheaf-py's `tex_text`, which also gives the letters that are commands
of their own (`\o`, `\l`, `\ss`); Python's `\b`, which knows the letters
of every script, is a look-ahead for a letter, a digit or `_`.

    // in arXiv: plain names from TeX:
    export const ACCENTS = { "'": '́', '`': '̀', '"': '̈', '^': '̂', '~': '̃',
                             c: '̧', v: '̌', u: '̆', H: '̋', '=': '̄' };
    const TEX_LETTERS = { o: 'ø', O: 'Ø', ss: 'ss', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł',
                          ae: 'æ', oe: 'œ', i: 'i' };

    const accent = (m, a, letter) => (letter + ACCENTS[a]).normalize('NFC');

    export function texText(s) {
      s = s.replace(/\{?\\(['`"^~=])\s*\{?([A-Za-z])\}?\}?/g, accent);
      s = s.replace(/\{?\\([cvuH])\s*\{([A-Za-z])\}\}?/g, accent);
      return s.replace(/\{\\(o|O|ss|aa|AA|l|L|ae|oe)\}|\\(o|O|ss|aa|AA|l|L|ae|oe)(?![\p{L}\p{N}_])/gu,
                       (m, a, b) => TEX_LETTERS[a || b]);
    }

    export function detex(s) {
      s = s.replace(/\\(['`"^~=])\s*\{?([A-Za-z])\}?/g, accent);
      s = s.replace(/\\([cvuH])\s*\{([A-Za-z])\}/g, accent);
      s = texText(s).replaceAll('{', '').replaceAll('}', '').replaceAll('~', ' ');
      return words(s).join(' ');
    }

A creator's family name is the last word, with the particles before it;
the rest are the given names.

    // in arXiv: a creator from an author's name:
    const PARTICLES = ['de', 'van', 'von', 'der', 'di', 'da', 'del', 'la', 'le'];

    export function creatorOf(name) {
      const w = words(name);
      let i = w.length - 1;
      while (i > 0 && PARTICLES.includes(w[i - 1].toLowerCase())) i--;
      const family = w.slice(i).join(' '), given = w.slice(0, i).join(' ');
      const c = { name: given ? `${family}, ${given}` : family, nameType: 'Personal', familyName: family };
      if (given) c.givenName = given;
      return c;
    }

Titles and abstracts
--------------------

Plain text with mathematics between single dollar signs (section 4.4):
all mathematics is brought between single dollars, then text and
mathematics are treated apart. In the text, accents become Unicode, TeX
quotes typographic quotes, changes of font their argument, braces around
plain words go, and ties and dashes become characters. In the mathematics,
the authors' macros without arguments, defined in the preamble and not
standard commands, are replaced by their definitions, in braces, at most
four times over.

    // in arXiv: titles and abstracts as plain text:
    export function cleanText(s, macros = null) {
      s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => '$' + x + '$');
      s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, x) => '$' + x.trim() + '$');
      s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, x) => '$' + x.trim() + '$');
      const out = [];
      for (let [isMath, part] of splitMath(s)) {
        if (!isMath) {
          part = texText(part).replaceAll('``', '“').replaceAll("''", '”').replaceAll('\\&', '&');
          part = plainMarkup(part);
          part = part.replace(/(\\[A-Za-z]+\s*)?\{([^{}\\$]*)\}/g, (m, command, inner) => (command ? m : inner));
          part = typographicText(part);
        } else if (macros && Object.keys(macros).length) {
          for (let k = 0; k < 4; k++) {
            const next = part.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (m, name) =>
              (Object.hasOwn(macros, name) && !STANDARD.has(name) ? `{${macros[name]}}` : m));
            if (next === part) break;
            part = next;
          }
        }
        out.push(isMath ? '$' + part + '$' : part);
      }
      return out.join('');
    }

    export const FONT_COMMANDS = 'emph|textit|textbf|textsl|textsc|textrm|textsf|texttt|textup|textmd|textnormal|' +
      'tmtextit|tmtextbf|tmtextsl|tmtextsc|tmtextrm|tmtextsf|tmtexttt|tmtextup|tmtextmd|tmem|tmstrong|tmname|tmsamp';
    export const FONT_DECLARATIONS = 'it|em|bf|sl|sc|rm|sf|tt|itshape|bfseries|slshape|scshape|upshape|mdseries|normalfont';

    export function plainMarkup(s) {
      const commands = new RegExp(`\\\\(?:${FONT_COMMANDS})\\s*\\{([^{}]*)\\}`, 'g');
      const declarations = new RegExp(`\\{\\\\(?:${FONT_DECLARATIONS})(?![A-Za-z])\\s*([^{}]*)\\}`, 'g');
      for (;;) {
        const t = s.replace(commands, (m, x) => x).replace(declarations, (m, x) => x);
        if (t === s) return s;
        s = t;
      }
    }

    export function typographicText(s) {
      return s.replace(/(?<![/\\])~/g, ' ').replaceAll('---', '—').replaceAll('--', '–');
    }

    export function splitMath(s) {
      return s.split(/(?<!\\)\$/).map((p, i) => [i % 2 === 1, p]);
    }

The definitions come from the preamble of the main TeX file of the same
version: those without arguments of `\newcommand` and `\renewcommand`, and
those of `\def`, a `\newcommand` winning over a `\def` of the same name.
A definition is the text between a brace and the brace that closes it,
within 2000 characters.

    // in arXiv: the authors' macros from the preamble:
    export function preambleMacros(tex) {
      const k = tex.indexOf('\\begin{document}');
      const pre = k < 0 ? tex : tex.slice(0, k);
      const out = {};
      for (const m of pre.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z]+)\}?\s*(\[\d\])?\s*\{/g)) {
        if (m[2]) continue;
        const body = balanced(pre, m.index + m[0].length - 1);
        if (body !== null) out[m[1]] = body;
      }
      for (const m of pre.matchAll(/\\def\s*\\([A-Za-z]+)\s*\{/g)) {
        const body = balanced(pre, m.index + m[0].length - 1);
        if (body !== null && !Object.hasOwn(out, m[1])) out[m[1]] = body;
      }
      return out;
    }

    export function balanced(s, i) {
      let depth = 0;
      for (let j = i; j < Math.min(s.length, i + 2000); j++) {
        if (s[j] === '{' && (j === 0 || s[j - 1] !== '\\')) {
          depth++;
        } else if (s[j] === '}' && s.at(j - 1) !== '\\') {
          depth--;
          if (depth === 0) return s.slice(i + 1, j);
        }
      }
      return null;
    }

The commands that MathJax and KaTeX know anyway are never expanded, and
are not reported as unknown; the list is opensheaf-py's.

    // in arXiv: the standard mathematical commands:
    export const STANDARD = new Set(`alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi
    pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma
    Upsilon Phi Psi Omega mathbb mathcal mathfrak mathrm mathbf mathit mathsf mathtt operatorname text textrm
    frac dfrac tfrac sqrt sum prod int oint iint lim limsup liminf sup inf max min exp log ln sin cos tan sinh cosh
    partial nabla infty cdot cdots ldots dots times otimes oplus leq geq le ge neq approx sim simeq equiv to mapsto
    in notin subset subseteq supset cup cap setminus emptyset forall exists left right big Big bigg Bigg langle rangle
    lfloor rfloor lceil rceil hat tilde bar vec dot ddot overline underline widehat widetilde quad qquad prime ast
    star circ bullet pm mp div mid parallel perp lesssim gtrsim ll gg ell hbar Re Im wedge vee neg det dim ker deg
    varnothing alpha_ operatorname* boldsymbol displaystyle textstyle mathscr llbracket rrbracket
    rightarrow leftarrow Rightarrow Leftarrow longrightarrow leftrightarrow hookrightarrow uparrow downarrow
    geqslant leqslant bot top vartriangle triangle square diamond angle backslash colon vert Vert lvert rvert
    lVert rVert binom choose mathring check breve acute grave over not neq ne propto cong asymp nearrow searrow`.split(/\s+/));

The macros left in the mathematics, whose definition was not found, are
kept and reported.

    // in arXiv: macros left unknown:
    export function unknownMacros(s) {
      const found = new Set();
      for (const [isMath, part] of splitMath(s)) {
        if (isMath) for (const m of part.matchAll(/\\([A-Za-z]+)/g)) if (!STANDARD.has(m[1])) found.add(m[1]);
      }
      return [...found].sort();
    }

Licences
--------

The licences arXiv offers, recorded by their SPDX identifier when they
have one, and otherwise by name and the URI arXiv uses (section 4.4); a
version without a licence gets arXiv's default, and an unknown licence is
recorded under its URI.

    // in arXiv: licences known by name:
    export const LICENCES = {
      'http://arxiv.org/licenses/assumed-1991-2003/':
        { rights: 'arXiv.org non-exclusive license to distribute, assumed for submissions of 1991-2003; ' +
                  'all other rights reserved to the authors' },
      'http://arxiv.org/licenses/nonexclusive-distrib/1.0/':
        { rights: 'arXiv.org perpetual, non-exclusive license to distribute; all other rights reserved to the authors' },
      'http://creativecommons.org/licenses/by/4.0/':
        { rights: 'Creative Commons Attribution 4.0 International', rightsIdentifier: 'cc-by-4.0' },
      'http://creativecommons.org/licenses/by-sa/4.0/':
        { rights: 'Creative Commons Attribution Share Alike 4.0 International', rightsIdentifier: 'cc-by-sa-4.0' },
      'http://creativecommons.org/licenses/by-nc-sa/4.0/':
        { rights: 'Creative Commons Attribution Non Commercial Share Alike 4.0 International',
          rightsIdentifier: 'cc-by-nc-sa-4.0' },
      'http://creativecommons.org/licenses/by-nc-nd/4.0/':
        { rights: 'Creative Commons Attribution Non Commercial No Derivatives 4.0 International',
          rightsIdentifier: 'cc-by-nc-nd-4.0' },
      'http://creativecommons.org/publicdomain/zero/1.0/':
        { rights: 'Creative Commons Zero v1.0 Universal', rightsIdentifier: 'cc0-1.0' },
    };

    export function rightsOf(uri) {
      uri = uri || 'http://arxiv.org/licenses/nonexclusive-distrib/1.0/';
      const r = { ...(Object.hasOwn(LICENCES, uri) ? LICENCES[uri] : { rights: uri }), rightsUri: uri };
      if ('rightsIdentifier' in r) r.rightsIdentifierScheme = 'SPDX';
      return r;
    }
