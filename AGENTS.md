# Working on opensheaf-js

This repository is a literate program. The sources are the chapters in
`literate/` (4-space indented code chunks headed `// in NAME:`, with
whole-line `<<NAME>>` references; prose between the chunks; examples that
are not code in fenced blocks). Tangling and weaving are done by
[opensheaf-literate](https://opensheaf.org/literate/) (the `literate`
command), pinned in `requirements-literate.txt` and configured by
`literate.json`.

**Never edit the tangled files directly.** They are generated from the
chapters and overwritten by the next tangle:

- `core/*.js` (the core: web standards only)
- `cli/*.js` (the command line)
- `tests/*.js` (the tests, their fixtures and the double of arXiv and
  Zenodo)

`literate tangle --list` gives the current list, with the chapter of each
file. `literate tangle --where FILE:LINE` gives the line of the chapter a
line of a tangled file comes from.

To make a change:

1. edit the chapter in `literate/`, its code and the prose explaining it;
2. tangle: `literate tangle` (once: `pip install -r
   requirements-literate.txt`, in a virtual environment outside the
   repository or in `.venv/`, which git ignores); `literate weave` weaves
   the website into `site/`;
3. check: `literate tangle --check` (CI fails if a file differs from its
   chapter);
4. test: `deno test -A tests/` (`deno task test`). The parity tests need
   opensheaf-py's `osheaf` on the `PATH`, or `OSHEAF_PY=/path/to/osheaf`;
   without it they are skipped. Under Node: `npm ci && node --test
   tests/core.test.js tests/identity.test.js tests/owners.test.js
   tests/services.test.js`.

## Rules

- **No platform APIs in `core/`.** Only what browsers, Deno and Node all
  have: `crypto.subtle`, `crypto.getRandomValues`, `fetch`, `Response`,
  `Uint8Array`, `TextEncoder`/`TextDecoder`, `URL`. No `Deno.*`, no
  `node:` imports. The core reaches files through a storage (chapter 20)
  and the outside world through the environment of chapter 23. The only
  packages are `hash-wasm`, `tweetnacl` and `yaml` (pinned in `deno.json`
  and `package.json`), imported by bare name and only where a key file is
  encrypted or decrypted, MD5 computed, or a YAML file read.
- **The command line** (`cli/`) uses `node:` modules, which Deno has too,
  so that one source runs under both. No `Deno.*` there either.
- **Parity with opensheaf-py.** opensheaf-py is the reference: same
  commands, options and messages ("How the commands speak"), same files,
  byte for byte where the inputs are the same (JSON as `json.dumps(...,
  indent=2, ensure_ascii=False)`, inventories in the order of
  `ordered_inventory`). A change of behaviour starts in opensheaf-py; the
  parity tests (chapter 72) must pass. Never write to a user's key store,
  keychain or wallet in tests: temporary folders, `OPENSHEAF_KEY_STORE=file`
  and a temporary `XDG_CONFIG_HOME`. Never reach arXiv or Zenodo
  (production or sandbox) in tests, nor read a real Zenodo token: doubles
  on the loopback address, fake tokens, every API address the double's.
- **The chapters 05 to 17 are the Explorer's** (opensheaf/explorer),
  copied with their prose. Keep them in step with the Explorer until it
  imports the core from here (phase 7 of chapter 00).
- **Version 0.1.0** (in `deno.json`, `package.json` and `cli/osheaf.js`):
  not bumped during the draft of the specification.
- British English in prose; plain, precise sentences.

Plain files, edited directly: `README.md`, `AGENTS.md`, `CLAUDE.md`,
`deno.json`, `package.json` (and the lock files), `literate.json`,
`requirements-literate.txt`, `schemas/` and `opensheaf-symbol.svg` (copies
of the specification's files), `templates/` (copies of opensheaf-py's
`src/opensheaf/templates/`, unchanged: a parity test checks that they are
the files `osheaf init` of opensheaf-py writes), `.github/workflows/*`.
