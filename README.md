# opensheaf-js

[![tests](https://github.com/opensheaf/opensheaf-js/actions/workflows/tests.yml/badge.svg)](https://github.com/opensheaf/opensheaf-js/actions/workflows/tests.yml)
[![licence: GPL v3+](https://img.shields.io/badge/licence-GPL--3.0--or--later-blue)](LICENSE)

> [!WARNING]
> **Draft.** OpenSheaf 0.2 is a draft specification. Until version 1.0, any
> revision may change the format in incompatible ways, and archives made now
> may have to be rebuilt. opensheaf-js is at its second phase: it makes
> archives and their websites, deposits papers, keeps their descriptions
> and collections, and verifies archives; for owners, keys and everything
> else, use [opensheaf-py](https://github.com/opensheaf/opensheaf-py).

The tools of [OpenSheaf](https://opensheaf.org) archives (the `osheaf`
command) in JavaScript: a port of
[opensheaf-py](https://github.com/opensheaf/opensheaf-py), the reference
implementation, that runs on [Deno](https://deno.com) (a command line, or
a single binary), on Node, and, for its core, in browsers. It keeps the
commands, options, messages and files of opensheaf-py, so that either
implementation keeps an archive the other made; and it reuses the reading
and verification of archives of the
[OpenSheaf Explorer](https://github.com/opensheaf/explorer), which will
import its core from here.

It is a literate program: the code is tangled from the chapters in
[`literate/`](literate/index.md), which explain it, and which are woven
into a website. [The plan](literate/00-plan.md) gives the architecture
and the phases.

## Status

Phases 1 and 2 (version 0.1.0):

- `osheaf init DIR --new-owner --export KEYS`: an archive and a new owner
  (rotation keys exported, in clear with `--no-passphrase` or under a
  passphrase; the current key in `~/.config/opensheaf/keys/`), the main
  catalogue sealed and signed (`--curated`: chosen by hand), the
  discovery document, the indexes and the website, with its templates
  copied into `templates/`;
- `osheaf deposit LABEL SOURCE --pdf PDF --title ... --author ... --new`,
  and new versions without `--new`; a PDF alone with `--no-source REASON`;
  `--from FILE.yaml` (one entry or several);
- `osheaf notice`, `withdraw`, `complete`, `relate`, `relicense`,
  `describe`: description-only versions and completions;
- `osheaf collection new|add|remove|follow|update|status|sync`:
  catalogues and selections, with members of any archive, read over HTTP;
- `osheaf collect`, `osheaf index` (the discovery document, the indexes
  and the website: home page, landing pages, owner pages, sitemap),
  `osheaf verify [--remote] [--json]`.

Every command that changes an archive writes its website again. The files
written are those opensheaf-py writes, byte for byte (the times of
versions aside): the parity tests compare them, and the websites the two
write for one archive are the same. Archives made by opensheaf-js pass
`osheaf verify` of opensheaf-py with no finding, and the other way round;
rotation keys exported by one sign with the other. Other archives are read
where `OPENSHEAF_LOCATIONS` (or `locations` in `osheaf.json`) says, as
opensheaf-py reads them. TeXmacs sources without a PDF, the TeXmacs
index, owners' key rotation, wallets, mirrors, branches, arXiv and Zenodo
are in opensheaf-py, and come here in later phases; the differences known
are listed in [the plan](literate/00-plan.md#phase-2-results-and-notes).

## Running

With Deno (2.x), from a clone, install the command `osheaf` (with the
import map of `deno.json`, which names the two packages the core uses):

```
deno install -g -A --config deno.json -n osheaf cli/osheaf.js
osheaf init papers --name "Papers of Jane Doe" \
    --base-url https://example.org/papers/ --curator "Doe, Jane" \
    --new-owner --export ~/opensheaf-rotation-keys
cd papers
osheaf deposit first ../paper.tex --pdf ../paper.pdf \
    --title "A first paper" --author "Doe, Jane|University" --new
osheaf collect
osheaf verify
```

or run it in place: `deno run -A --config /path/to/opensheaf-js/deno.json
/path/to/opensheaf-js/cli/osheaf.js ...` (`deno task osheaf ...` from the
clone). If opensheaf-py is installed too, name one of the two otherwise
(`-n josheaf`).

A single binary, which needs nothing installed (not committed; made in
`dist/`):

```
deno task compile        # deno compile -A --include schemas --include templates --output dist/osheaf cli/osheaf.js
./dist/osheaf --version
```

With Node (22 or later):

```
npm ci
node cli/osheaf.js --help
npx github:opensheaf/opensheaf-js --help
```

Current keys are kept in files (`OPENSHEAF_KEY_STORE=file`, under
`XDG_CONFIG_HOME` or `~/.config`), where opensheaf-py keeps them when it
has no keyring; `OPENSHEAF_SIGNING_KEY` and `OPENSHEAF_PASSPHRASE` work as
in opensheaf-py.

## Building and testing

```
python3 -m venv .venv && .venv/bin/pip install -r requirements-literate.txt
.venv/bin/literate tangle            # write core/, cli/, tests/ from literate/
.venv/bin/literate tangle --check    # they are what the chapters say
.venv/bin/literate weave             # the website, in site/
deno test -A tests/                  # the tests; the parity tests need opensheaf-py:
OSHEAF_PY=/path/to/osheaf deno test -A tests/
```

See [AGENTS.md](AGENTS.md) for the rules of the repository.

## Licence

GPL-3.0-or-later, as opensheaf-py. The OpenSheaf symbol
(`opensheaf-symbol.svg`) is licensed under CC BY 4.0, and its use as a mark
follows the OpenSheaf
[trademark policy](https://github.com/opensheaf/opensheaf.github.io/blob/main/TRADEMARKS.md).
