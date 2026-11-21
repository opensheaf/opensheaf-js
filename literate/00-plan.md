The plan
========

opensheaf-js is a port of [opensheaf-py](https://opensheaf.org/opensheaf-py/),
the reference tools of OpenSheaf (the `osheaf` command), to JavaScript,
so that the same tools run in three places:

- on **Deno**, as a command line (`deno run -A cli/osheaf.js`) and as a
  single binary made by `deno compile`, with nothing else installed;
- on **Node**, as a package (`npx`), for those who have Node and not
  Python;
- in **browsers**, where the [Explorer](https://opensheaf.org/explorer/)
  reads and verifies archives, and where a Manager will keep an archive
  held on GitHub without any program installed, writing through GitHub's
  API.

It is written in phases. This chapter gives the goals, the architecture,
the map of the modules, the phases, how parity with opensheaf-py is
checked, and what stays in Python for now.

Goals
-----

1. **The same archives.** An archive made or changed by opensheaf-js is
   one opensheaf-py reads, changes and verifies without a finding, and the
   other way round. The files are written as opensheaf-py writes them,
   byte for byte where the inputs are the same (chapter
   [22](22-writing.md)), so that the two can be compared file by file, not
   only checked against each other.
2. **The same command.** The commands, options and messages are those of
   opensheaf-py ("How the commands speak", chapter
   [23](23-folder.md)), so that its documentation, its tutorials and the
   habits of its users carry over.
3. **One core for every platform.** Everything that reads, writes, signs
   and verifies an archive is in `core/`, written with web standards only,
   and runs unchanged in Deno, Node and browsers.
4. **Read as a literate program**, like opensheaf-py and the Explorer: the
   reasons with the code, and the sections of the specification each part
   implements.

Architecture
------------

```
core/   web-standard ES modules: no Deno.*, no node: modules
  crypto, names, owners, signatures, branches   identity (from the Explorer)
  http, paths, schema, versions, archive,        reading archives (from the Explorer)
  resolve, rules, verify
  storage                                         files, wherever they are
  keys                                            keys, signatures, key files
  write, folder, discovery, collect,              keeping an archive
  deposit, init, check
  describe, collections, website, keepers,        descriptions, collections, the website
  inputs
  keylogs, wallets, passkey, owner                owners, keys, wallets, passkeys
cli/    the command line: node: modules, which Deno has too
  disk       an archive folder on a disk
  keystore   current keys (files, the macOS keychain), exported keys, passphrases
  outside    the clipboard, key wallets' commands and GitHub's API, files, stdin
  unlock     the listener of the passkey hand-off
  osheaf     the command
tests/  node:test, run by deno test and node --test
```

**Web standards in the core.** Digests come from WebCrypto
(`crypto.subtle`): SHA-256 and SHA-512, and Ed25519 for signing, which
is deterministic (RFC 8032), so that a key signs a message with the same
64 bytes as libsodium does in opensheaf-py (chapter [71](71-tests-identity.md)
checks it on the signatures of appendix C). Verifying stays with the
Explorer's own strict verifier (chapter [05](05-crypto.md)), which decides
alone, the same in every runtime. Bytes are `Uint8Array`, text is
`TextEncoder` and `TextDecoder`, files over HTTP come with `fetch`.

**Storage.** The core never touches a disk: it keeps an archive through a
storage (chapter [20](20-storage.md)), an object of six methods (read,
write, kind, list, rename, remove) over paths relative to the archive.
The command line gives a folder on a disk; the tests give memory; the
Manager will give a GitHub repository, whose writes it will gather into
one commit through the Git Data API. Reading is shared with verification:
a storage has a `fetch` of its own, so the reading of archives written for
the Explorer, over HTTP, reads a storage too, and a command judges the
signatures of a line exactly as a verification does.

**Three libraries.** Argon2id and XSalsa20-Poly1305, which encrypt the keys
kept outside an archive, are not in WebCrypto. They come from
`hash-wasm` 4.12.0 and `tweetnacl` 1.0.3, pinned, loaded only when a key
file is encrypted or decrypted (chapter [21](21-keys.md) says why these
two). `hash-wasm` also gives MD5, for the fixity of OCFL inventories.
YAML, read by `--from FILE` and `osheaf collection sync`, comes from
`yaml` 2.8.1, pinned the same way and loaded only when a YAML file is read
(chapter [33](33-inputs.md)).

**The command line on node: modules.** The command line could use
`Deno.*`; it uses the built-in modules of Node instead (`node:fs`,
`node:path`, `node:process`, `node:child_process`, `node:readline`),
which Deno implements, so that one source runs under both, and `deno
compile` makes a binary of it all the same. The price is small: Deno's
own APIs are not needed for files, processes and terminals.

**JavaScript, not TypeScript.** The code is plain modern JavaScript (ES
modules, `async`, `BigInt`), as the Explorer's is. Deno runs TypeScript
directly, but browsers do not: TypeScript would need a build step (`deno
bundle` or esbuild) between the documents and the code a browser loads,
and the Explorer, which will import `core/` as it stands, has none. Plain
JavaScript runs everywhere as written, the files tangled from the chapters
are the files that run, and `literate tangle --where` points from a line
that fails to the line of the chapter. Types are named in the prose where
they matter; JSDoc annotations can be added where a checker would earn
them.

Module map
----------

| chapter | module | what | from |
|---|---|---|---|
| [05](05-crypto.md) | `core/crypto.js` | digests, encodings, strict Ed25519 verification | Explorer |
| [06](06-names.md) | `core/names.js` | genesis records, names, did:key, JCS, sheaf: URIs | Explorer |
| [07](07-owners.md) | `core/owners.js` | key logs, the computed first version, rules 1 to 4 | Explorer |
| [08](08-signatures.md) | `core/signatures.js` | signature files, statuses of versions | Explorer |
| [09](09-branches.md) | `core/branches.js` | branch points and their verdicts | Explorer |
| [10](10-http.md) | `core/http.js` | requests, limits, JSON | Explorer |
| [11](11-paths.md) | `core/paths.js` | identifiers, layouts, safe paths | Explorer |
| [12](12-schema.md) | `core/schema.js` | the JSON Schema validator | Explorer |
| [13](13-versions.md) | `core/versions.js` | document versions and history | Explorer |
| [14](14-archive.md) | `core/archive.js` | an archive read over `fetch` | Explorer |
| [15](15-resolve.md) | `core/resolve.js` | resolution across archives | Explorer |
| [16](16-rules.md) | `core/rules.js` | findings and the rules of descriptions | Explorer |
| [17](17-verify.md) | `core/verify.js` | the verification of section 14 | Explorer |
| [20](20-storage.md) | `core/storage.js` | storages, in memory and over `fetch` | new |
| [21](21-keys.md) | `core/keys.js` | keys, signing, rotation key files | opensheaf-py 07 |
| [22](22-writing.md) | `core/write.js` | JSON, genesis records, inventories, signature files, key logs | opensheaf-py 05, 06, 08, 10 |
| [23](23-folder.md) | `core/folder.js` | the archive kept: configuration, objects, signing, versions | opensheaf-py 10 |
| [24](24-main-catalogue.md) | `core/collect.js` | the main catalogue | opensheaf-py 15 |
| [25](25-discovery.md) | `core/discovery.js` | the discovery document and the indexes | opensheaf-py 16 |
| [26](26-deposit.md) | `core/deposit.js` | deposits | opensheaf-py 13 |
| [27](27-init.md) | `core/init.js` | new owners, new archives | opensheaf-py 18, 19 |
| [28](28-verify-folder.md) | `core/check.js` | verifying an archive folder | opensheaf-py 17 |
| [29](29-description.md) | `core/describe.js` | description-only versions, completions | opensheaf-py 14 |
| [30](30-collections.md) | `core/collections.js` | catalogues and selections, across archives | opensheaf-py 21 |
| [31](31-website.md) | `core/website.js` | the website (profile `website`) | opensheaf-py 30, 31 |
| [32](32-keepers.md) | `core/keepers.js` | the link of an owner to its keeper | opensheaf-py 06 |
| [33](33-inputs.md) | `core/inputs.js` | options from YAML or JSON files | opensheaf-py 60 |
| [34](34-key-logs.md) | `core/keylogs.js` | key logs rotated, exposed, ended, forked, met; read from folders | opensheaf-py 06 |
| [35](35-wallets.md) | `core/wallets.js` | key wallets: GitHub (REST API), commands of the user's | opensheaf-py 09 |
| [36](36-passkeys.md) | `core/passkey.js`, `cli/unlock.js` | the passkey hand-off from `unlock.opensheaf.org` | opensheaf-py 09 |
| [37](37-owner-commands.md) | `core/owner.js` | `owner`, `key`, `sign` | opensheaf-py 19, 22 |
| [40](40-cli.md) | `cli/*.js` | the command line | opensheaf-py 60 |
| [70](70-tests.md)–[73](73-tests-owners.md) | `tests/*.test.js` | the tests | |

The chapters 05 to 17 are the Explorer's, copied with their reasoning;
where they speak of "the explorer", they speak of the reader of archives
the code was first written for, whose behaviour the core keeps. When the
Explorer imports the core from this repository (phase 7), these chapters
will be the only copy.

The phases
----------

1. **Foundation** (done): the core above; `osheaf init`
   with a new owner (rotation keys exported in clear or under a
   passphrase, the current key in the file store), `osheaf deposit` (a new
   work, new document versions, any source with its PDF, or a PDF alone),
   `osheaf collect`, `osheaf index` (the discovery document and the
   indexes), `osheaf verify`; the tests of appendix C and of parity.
2. **Descriptions and the website** (done): `notice`, `relicense`,
   `relate`, `describe`, `withdraw`, `complete`; `collection` (catalogues
   and selections, members of any archive read over HTTP, a curated main
   catalogue with `init --curated`, a featured collection); the website of
   the profile `website` (home page, landing pages, owner pages, sitemap,
   from opensheaf-py's templates, copied unchanged into `templates/`), so
   that `init` makes the same configuration as opensheaf-py; `--from
   FILE`; the presentation and keeper checks of `verify`. See "Phase 2:
   results and notes" below.
3. **Owners and keys** (done): `owner init|rotate|expose|end|show|pull`,
   `sign`, `key new|push|pull|list|forget|export|import|enroll|unlock`,
   `help-config`; key wallets (GitHub, through its REST API, and command
   wallets; envelopes); passkey unlock (the hand-off from
   `unlock.opensheaf.org`); the macOS keychain through `security`; `init
   --owner --key-log` and `init --keys`. See "Phase 3: results and notes"
   below.
4. **Across archives**: `resolve`, `mirror`, `branch`,
   `accept`, `draft`, `seal`, `takedown`; `verify --remote` with keepers;
   the completeness checks of the storage root.
5. **Services**: `arxiv fetch|import` and `zenodo`, on the command line
   only (their APIs do not allow requests from other origins, CORS, so a
   browser cannot call them).
6. **The Manager**: a browser application that keeps an archive held on
   GitHub, with a storage over the Git Data API (one commit per command),
   the current keys in the browser (WebCrypto, non-extractable), the
   rotation keys unlocked by a passkey.
7. **The Explorer on the core**: the Explorer imports `core/` from this
   repository instead of its own copy.

Parity with opensheaf-py
------------------------

opensheaf-py is the reference: where the two differ, this program is
wrong until the specification says otherwise. Parity is checked by the
tests of chapter [72](72-tests-parity.md), which run both commands on
archives made by each, in temporary folders with key stores of their
own: an archive made here passes `osheaf verify` of opensheaf-py with no
error and no warning, and an archive made there passes the verification
here, with the same findings; rotation keys exported by one sign with the
other; and the same deposit made by both gives the same files. The tests
of chapter [71](71-tests-identity.md) check the computed values of
appendix C byte for byte. The continuous integration installs
opensheaf-py from its repository and runs them all.

Phase 2: results and notes
--------------------------

What the parity tests (chapter [72](72-tests-parity.md)) show:

- every command of descriptions, `deposit --from` a YAML file, and every
  action of `collection` (members of another archive served over HTTP
  included) writes the same `object.json`, `datacite.json` and
  `members.json` as opensheaf-py, byte for byte, the same inventories
  apart from the times of versions, and says the same; a new work differs
  only by its name, which its genesis record draws at random;
- the website written by this program for an archive is the one
  opensheaf-py writes, file for file and byte for byte: home page (with a
  featured collection), landing pages (notices, withdrawals, contested
  marks, keepers, members held elsewhere), owner pages, `style.css`,
  `sitemap.xml`; `osheaf init` of both writes the same configuration and
  the same templates;
- both verifications, with and without `--remote`, give the same findings
  on every archive of the tests.

Where the two differ, on purpose or not yet:

- **Faults of opensheaf-py, corrected in both.** A second notice about
  a line that has one already was lost (the notices of the head were
  carried over those of the change, chapter [29](29-description.md));
  `collection remove --revision` of a revision of a member that keeps
  others said "no member matches" (chapter [30](30-collections.md)); and
  opensheaf-py's resolver, given a short form of a `sheaf:` URI of a line
  held only elsewhere, copied the line without its signatures and found
  it unsigned. All three were corrected in opensheaf-py (its commits
  24afb1d, 27653cf and fb22886), this program follows, and the parity
  tests use a second notice, `remove --revision` and a short form again.
- **Messages about unreachable places.** The reason given for an archive
  or a keeper that cannot be read comes from the network library of each
  program, and differs in its wording.
- **Folders as locations.** opensheaf-py reads another archive from a
  folder given to `--at`; here a folder is reached through the locations
  (`OPENSHEAF_LOCATIONS`, `locations` of `osheaf.json`), and `--at` takes
  URLs.
- **The TeXmacs index** (`index.template`) is written by opensheaf-py;
  this program warns and leaves it.

Notes for phase 3:

- the owner commands will need `owner end` to test the refusal of an ended
  owner across the two programs (the refusal itself is the signing of
  chapter [23](23-folder.md), already in place);
- the keeper of an owner is read with `env.fetchJson`; a browser Manager
  will need ORCID's CORS headers, which its public API sends, and a proxy
  for domains that do not;
- two options were added to the Explorer's chapters, to be carried to the
  Explorer (or taken with the core in phase 7): `local` of the resolver
  (chapter [15](15-resolve.md)), with which the command line lifts the
  rule against local hosts that the Explorer keeps, and `pages` of
  `verify` (chapter [17](17-verify.md)), with which the verification of a
  folder makes the check of the presentation as opensheaf-py makes it.

Phase 3: results and notes
--------------------------

What the tests show (chapters [72](72-tests-parity.md) and
[73](73-tests-owners.md)):

- one owner is kept by both programs in turn: this program rotates,
  exposes and ends key logs opensheaf-py made, and the other way round;
  each signs again what a key exposed by the other signed; `owner show`
  says the same in both; both verifications agree, without a finding;
- copies of a key log are met by either (`owner pull` of a folder, `init
  --owner --key-log`): extended alike, and a fork recorded by each on the
  other's copy verifies with both;
- one key wallet serves both: the keys opensheaf-py puts in a private
  GitHub repository (through `gh`) are listed, pulled and signed with by
  this program (through GitHub's API), and those this program puts there
  by opensheaf-py; `key list` says the same in both;
- the text of `key export` of either, in clear or under the passphrase,
  is imported by the other;
- the hand-off of a passkey gives the vector of opensheaf-py's tests (the
  code `371 704`, the same ciphertext and tag), with WebCrypto's X25519
  and HMAC; the messages of the commands are opensheaf-py's.

Where the two differ:

- **GitHub without `gh`.** The GitHub wallet calls GitHub's REST API with
  `fetch`; the token is `GH_TOKEN`, `GITHUB_TOKEN` or `gh auth token`,
  and `OPENSHEAF_GITHUB_API` names another API (a test double, GitHub
  Enterprise). The messages of a failed request are GitHub's, not `gh`'s.
- **`keyring`.** The Python package has no equivalent: on macOS,
  `OPENSHEAF_KEY_STORE=keyring` is taken as `security`, the keychain that
  `keyring` uses there (with a note); elsewhere it is refused, and a key
  kept in the Secret Service or the Credential Manager by opensheaf-py is
  moved with `key export --stdout` and `key import --stdin`. Without
  `OPENSHEAF_KEY_STORE`, keys are kept in the keychain on macOS, else in
  files, and the warning on a key kept in a file says so.
- **Witness files of key logs read over HTTP.** A key log read from
  another archive (`owner pull URL`) carries the signature files of the
  rotation keys the reader of chapter [14](14-archive.md) expects, not
  every file of the folder; a fork record made from it may carry fewer
  witness files than opensheaf-py's would, and is as valid.
- **`owner pull` of a folder that is an archive**: as for `--at` (phase
  2), an archive is reached by its URL, through the locations; a folder
  given is read as the folder of an owner object.

Notes for phase 4:

- `owner pull URL` reads the key log through the resolver; `mirror` will
  write the key log beside the lines it copies with `recordKeyLog`
  (chapter [37](37-owner-commands.md)), which needs the takedown check of
  opensheaf-py's `record_key_log` (a key log taken down here returns only
  with the version its tombstone pins) before it copies a key log not
  held yet;
- the Manager (phase 6) can reuse `core/wallets.js` (GitHub's API through
  `fetch`) and `core/keys.js` as they are; a page of another origin cannot
  use the passkeys of `unlock.opensheaf.org`, so the Manager will either
  live on that origin or hand off to that page as the command line does.

What stays in Python for now
----------------------------

- **TeXmacs**: a TeXmacs source without its PDF is typeset by
  opensheaf-py, which runs TeXmacs headless; the command line here will
  call TeXmacs as an external program in a later phase. Until then, a
  deposit gives the PDF.
- Everything of phases 4 and 5, above: `osheaf` of opensheaf-py does it on
  the same archives, and the command here says so when asked.
- The TeXmacs index of an archive (`--index texmacs`).
- YAML configurations (`osheaf.yaml`), which opensheaf-py reads; this
  program reads `osheaf.json` (it reads YAML for `--from FILE` only).
