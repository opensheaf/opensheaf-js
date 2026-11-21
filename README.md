# opensheaf-js

[![tests](https://github.com/opensheaf/opensheaf-js/actions/workflows/tests.yml/badge.svg)](https://github.com/opensheaf/opensheaf-js/actions/workflows/tests.yml)
[![licence: GPL v3+](https://img.shields.io/badge/licence-GPL--3.0--or--later-blue)](LICENSE)

> [!WARNING]
> **Draft.** OpenSheaf 0.2 is a draft specification. Until version 1.0, any
> revision may change the format in incompatible ways, and archives made now
> may have to be rebuilt. opensheaf-js is at its fourth phase: it makes
> archives and their websites, deposits papers, keeps their descriptions
> and collections, keeps owners and their keys (wallets and passkeys
> included), resolves, mirrors, branches and takes down lines, keeps
> drafts, and verifies archives; for arXiv, Zenodo and TeXmacs, use
> [opensheaf-py](https://github.com/opensheaf/opensheaf-py).

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

Phases 1 to 4 (version 0.1.0):

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
  `osheaf verify [--remote] [--json]`;
- `osheaf owner init|rotate|expose|end|show|pull`: an owner's key log
  changed with rotation keys read from their files (`--rotation-key`) or
  from a key wallet, a fork recorded when copies meet; `osheaf sign LABEL
  --version vN`, which signs again what an exposed key signed; `osheaf
  init --owner NAME --key-log DIR` and `init --keys LEVEL`;
- `osheaf key new|push|pull|list|forget|export|import|enroll|unlock`: the
  current keys of this device, key wallets (a private GitHub repository,
  through GitHub's API, or commands of a password manager), the clipboard,
  and passkeys (Touch ID) through `https://unlock.opensheaf.org/`;
  `osheaf help-config`;
- `osheaf resolve URI [--at URL] [--json]`: what a `sheaf:` URI names, in
  any archive, checked; `osheaf mirror URI --at URL [--label]` and
  `mirror --all`: copies of lines written elsewhere, with their owners'
  key logs, grown only by signed versions from copies that agree;
- `osheaf branch URI --label LABEL` and `osheaf accept URI --selection
  LABEL [--with-original]`: branches and accepted copies, with the
  evidence of their branch points, and branch points moved;
- `osheaf draft new|deposit|delete DRAFT` and `osheaf seal DRAFT --label
  LABEL`: drafts and the works sealed from them;
- `osheaf takedown LABEL --reason TEXT [--by-law | --keeper]`: objects
  taken down, with their tombstones, and lines that return.

Every command that changes an archive writes its website again. The files
written are those opensheaf-py writes, byte for byte (the times of
versions aside): the parity tests compare them, and the websites the two
write for one archive are the same. Archives made by opensheaf-js pass
`osheaf verify` of opensheaf-py with no finding, and the other way round;
rotation keys exported by one sign with the other; one owner is kept by
both in turn, and one key wallet serves both; each mirrors, branches and
takes down what the other made, with the same files and the same
findings of both verifications. Other archives are read
where `OPENSHEAF_LOCATIONS` (or `locations` in `osheaf.json`) says, as
opensheaf-py reads them. TeXmacs sources without a PDF, the TeXmacs
index, arXiv and Zenodo are in opensheaf-py, and come here in later
phases; the differences known are listed in the plan
([phase 2](literate/00-plan.md#phase-2-results-and-notes),
[phase 3](literate/00-plan.md#phase-3-results-and-notes),
[phase 4](literate/00-plan.md#phase-4-results-and-notes)).

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

Current keys are kept where opensheaf-py keeps them: on macOS in the
keychain (through `security`), else in files under `XDG_CONFIG_HOME` or
`~/.config` (`OPENSHEAF_KEY_STORE=security|file|none` chooses;
`keyring`, a Python package, is taken as the keychain on macOS and
refused elsewhere). `OPENSHEAF_SIGNING_KEY`, `OPENSHEAF_PASSPHRASE`,
`OPENSHEAF_PASSPHRASE_COMMAND`, `OPENSHEAF_WALLET` and `OPENSHEAF_UNLOCK`
work as in opensheaf-py, and `~/.config/opensheaf/config.json` configures
a key wallet (`osheaf help-config`). The GitHub wallet needs no `gh`: its
token is `GH_TOKEN`, `GITHUB_TOKEN`, or that of `gh auth token`.

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
