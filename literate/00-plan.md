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
  mirror, branch, drafts, takedown                across archives
  arxiv, zenodo                                   services (the command line gives the network)
  github, requests                                an archive on GitHub, one commit per request
web/    manager: what the Manager imports, bundled for browsers by tools/bundle.js
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

**Four libraries.** Argon2id and XSalsa20-Poly1305, which encrypt the keys
kept outside an archive, are not in WebCrypto. They come from
`hash-wasm` 4.12.0 and `tweetnacl` 1.0.3, pinned, loaded only when a key
file is encrypted or decrypted (chapter [21](21-keys.md) says why these
two). `hash-wasm` also gives MD5, for the fixity of OCFL inventories.
YAML, read by `--from FILE` and `osheaf collection sync`, comes from
`yaml` 2.8.1, pinned the same way and loaded only when a YAML file is read
(chapter [33](33-inputs.md)). Deflate, for the `sources.zip` of a deposit on
Zenodo, comes from `pako` 2.1.0, pinned and loaded only when the zip is
made (chapter [46](46-zenodo.md)).

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
| [24](24-owner-catalogues.md) | `core/collect.js` | the owner catalogues | opensheaf-py 15 |
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
| [38](38-mirrors.md) | `core/mirror.js` | `resolve`, objects copied from other archives, `mirror` | opensheaf-py 20, 22 |
| [39](39-branches-kept.md) | `core/branch.js` | `branch`, `accept` | opensheaf-py 23 |
| [41](41-drafts.md) | `core/drafts.js` | `draft`, `seal` | opensheaf-py 24 |
| [42](42-takedown.md) | `core/takedown.js` | `takedown`, tombstones, the return of a line | opensheaf-py 25 |
| [43](43-arxiv.md)–[45](45-arxiv-import.md) | `core/arxiv.js` | `arxiv fetch|import`: downloads, metadata, e-prints, signed lines | opensheaf-py 40, 41, 42 |
| [46](46-zenodo.md) | `core/zenodo.js` | `zenodo`: a version staged and signed, uploads, publication, the sandbox | opensheaf-py 50 |
| [47](47-github-storage.md) | `core/github.js` | a storage over GitHub: the tree of a branch, blobs, one commit | new |
| [48](48-requests.md) | `core/requests.js` | the requests of the forms, carried out | the archive template's `osheaf_issue.py` |
| [49](49-manager.md) | `web/manager.js`, `tools/bundle.js` | the Manager's core: keys unlocked by a passkey, direct writes, the bundle | new |
| [40](40-cli.md) | `cli/*.js` | the command line | opensheaf-py 60 |
| [70](70-tests.md)–[76](76-tests-github.md) | `tests/*.test.js` | the tests | |

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
4. **Across archives** (done): `resolve`, `mirror`, `branch`, `accept`,
   `draft`, `seal`, `takedown`; `verify --remote` with the parent lines
   of branches found through their discovery documents; the completeness
   checks of the storage root. See "Phase 4: results and notes" below.
5. **Services** (done): `arxiv fetch|import` and `zenodo`, on the command
   line only (their APIs do not allow requests from other origins, CORS,
   so a browser cannot call them); `addVersion` split into building a
   version and installing it, with the lock of a Zenodo deposit. See
   "Phase 5: results and notes" below.
6. **The Manager** (done): a storage over GitHub's API, the head of a
   branch read through its tree and every request one commit through
   the Git Data API (chapter [47](47-github-storage.md)); the requests of
   the forms carried out as the archive template's script carries them
   out (chapter [48](48-requests.md)); the core the
   [Manager](https://manager.opensheaf.org/) imports, with the owner's
   current keys opened from its key wallet by a passkey, through a popup
   of `unlock.opensheaf.org`, and kept in the page as WebCrypto keys
   that cannot be exported (chapter [49](49-manager.md)). See "Phase 6:
   results and notes" below.
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

Phase 4: results and notes
--------------------------

What the tests show (chapters [70](70-tests.md) and
[74](74-tests-across.md)), each command run by both programs on two
copies of one archive, the other archives served over HTTP:

- `resolve` gives the same JSON as opensheaf-py for a line, a document
  version, a pin, a short form, a key log and a version not found, in an
  archive and outside one;
- `mirror` of a line of an archive made by this program, made by
  opensheaf-py and by this program, writes the same files, the mirrored
  object byte for byte as its source, with the key log copied beside it;
  both refuse a closed licence alike, and `mirror --all` stops alike at
  the latest signed version, reporting the version after it;
- `accept` (with `--with-original`) and `branch` of a line of an archive
  made by opensheaf-py give the same branches, evidence included, and the
  same selections (the pins of the accepted copy aside, whose
  inventories record their times); a branch point moves alike, and the
  same branch point is refused alike; a branch of that branch, made in an
  archive of opensheaf-py, carries the same `parent/parent/`; both
  verifications, also with `--remote`, find the branch points confirmed
  and the parent's line where `parent.url` says;
- `draft new|deposit` (with `--replace`), `seal` and `draft delete` give
  the same files (a sealed work its name aside);
- `takedown` of a line, of a mirror and of a key log by law writes the
  same tombstones and indexes, refuses alike what it refuses, and the
  line returns alike through a new mirror; both verifications give the
  same findings on the archives each took down, the signature files left
  unchecked by a key log taken down included;
- the verification of a folder is complete as opensheaf-py's is: objects
  the discovery document does not list, and every file of the witness
  folders, are read and checked (the `lister` of chapter
  [14](14-archive.md)).

Where the two differ:

- **Witness files read over HTTP.** A copy read over HTTP brings the
  signature files whose names the reader computes from the owner's key
  log, as in both programs; but where opensheaf-py reads another archive
  from a folder (`--at PATH`, or locations that name a folder), it lists
  the witness folders and copies every file, timestamps and stray files
  included, into a mirror or the evidence of a branch, while this program,
  which reaches such a folder through its `fetch`, copies the signature
  files only. The archive's own witness folders are listed by both.
- **The OCFL validator.** opensheaf-py also runs `ocfl-py` when it is
  installed; this program makes the checks of OCFL that OpenSheaf relies
  on itself (chapter [28](28-verify-folder.md)), and reports an object at
  a path other than its identifier gives as not listed, where
  opensheaf-py says where it is.
- **Quoting in two messages.** A `sheaf:` URI that cannot be read is
  quoted in opensheaf-py's message (Python's `repr`), and not here (the
  message is the Explorer's, chapter [06](06-names.md)).

Two options were added to the Explorer's chapters, to be carried to the
Explorer (or taken with the core in phase 7): the `lister` of an archive
(chapter [14](14-archive.md)), with the `listed` witness files of a line
and the `unlisted` objects of a verification (chapter
[17](17-verify.md)), and `archiveOf` of the resolver (chapter
[15](15-resolve.md)), which the Explorer can use for the parent lines of
branches too.

Notes for phase 5 (arXiv and Zenodo, on the command line only):

- `osheaf zenodo` builds and signs a version before Zenodo publishes it,
  and adds it later (opensheaf-py's `add_version(..., stage_in=...)` and
  `install_version`); `addVersion` (chapter [23](23-folder.md)) builds in
  a staging folder already and will need the same split, the lock
  (`zenodoPending`) being read already;
- `arxiv import` deposits with `--from` entries and seals new works, which
  `deposit` does; it reads arXiv's API with its rate limits, and arXiv's
  PDFs and sources, through the `fetch` of the environment;
- TeXmacs sources without a PDF remain opensheaf-py's until TeXmacs is
  called as an external program.

Notes for phase 6 (the Manager, writing directly):

- every command of this phase writes through a storage: versions,
  mirrors and branches are built in `.staging-*` folders and renamed into
  place, and takedowns remove folders file by file; a storage over the
  Git Data API makes the whole command one commit, the renames costing
  nothing;
- such a storage should also give a `lister` (from Git's trees), so that
  the Manager's verification is complete, as that of a folder is;
- `mirror` and `branch` read other archives in the browser, which needs
  their servers to send CORS headers (GitHub Pages does); `fetchObject`
  holds each file in memory once, which bounds what a page can copy.

Phase 5: results and notes
--------------------------

What the tests show (chapters [72](72-tests-parity.md) and
[75](75-tests-services.md)), both programs against one double of arXiv
and Zenodo, a server on the loopback address (opensheaf-py behind a
guard on `urllib` that sends every other address to the double and
stops any request that would leave the computer; the tokens fake):

- `arxiv fetch` of an author's papers writes the same downloads folder
  (record, PDFs, e-prints named by their kind, `version-licences.json`,
  `download.json` apart from the times), asks arXiv for the same
  addresses, records a missing e-print with the same error, says the
  same, and asks again for it alone at the next run;
- `arxiv import` of two papers (an e-print that is a tar archive with a
  folder and an unsafe path, a single TeX file, a PDF as source, no
  e-print at all; macros of the preamble in the abstract, a DOI and a
  journal reference, licences changed between versions, `--agreement`
  and `--agreed-by`) gives the same lines, `object.json`,
  `datacite.json`, sources and report, the names of the new works
  aside, says the same, and both verifications agree; a fourth arXiv
  version added with `--update` by either program to the lines either
  imported gives the same files, byte for byte; `--dry-run` and the
  refusals are alike;
- `zenodo` on the sandbox (on a copy: the archive is unchanged), on
  Zenodo, again (refused), and for a second document version (a new
  version of the record) sends the same requests, with the same bodies
  (the metadata of the record, the MD5 and size of every upload,
  `sources.zip` included, byte for byte), says the same, and leaves the
  same object versions, verified alike;
- a deposit stopped after publication (Zenodo answers another DOI than
  the one it reserved) keeps the line locked: both refuse a deposit
  alike, and the other program completes the deposit; and the other way
  round;
- in this program alone, as in opensheaf-py's tests: a deposit
  interrupted after publication, the key that signed it exposed
  meanwhile, completed and signed again with a current key; the order in
  which the token is looked for; the limits of the unpacking.

Where the two differ:

- **XML without a parser.** opensheaf-py reads the OAI record and the
  Atom feed with ElementTree; browsers, Deno and Node share no parser of
  XML, and the core reads the few elements it needs with regular
  expressions (chapter [44](44-arxiv-metadata.md)), decoding the
  entities of XML. A record that a parser would refuse may be read here.
- **HTML entities.** The comments of a version are decoded with the
  common named references of HTML and the numeric ones; Python's
  `html.unescape` knows them all.
- **The token of Zenodo.** It is read from the environment, then, on
  macOS, from the keychain through `security`; opensheaf-py also asks
  the package `keyring` between the two (on macOS, the same keychain).
  `OPENSHEAF_ZENODO_API` replaces the address of Zenodo's API (a double
  of it); opensheaf-py has no such variable, and its tests replace the
  class that calls the API.
- **TeXmacs sources of arXiv versions** (`arxiv import --texmacs`) are
  refused, with a message pointing to opensheaf-py: their import
  typesets the HTML version with TeXmacs.
- **Failures.** What opensheaf-py raises as an exception (a checksum
  that Zenodo reports otherwise, an error of the API, an e-print that is
  not gzip) ends here with a message and the status 1, where Python
  prints its traceback; the draft is discarded alike.
- **`sources.zip`** is byte for byte opensheaf-py's: it is compressed by
  pako, a port of zlib's deflate, whose bytes are those of the zlib that
  CPython links, in Deno, Node and browsers alike (the zlib of each
  runtime, zlib-ng or Chromium's, compresses otherwise).
- **Tar archives** are read by a reader of this program (chapter
  [45](45-arxiv-import.md)), which takes the members as `tarfile` does
  (POSIX prefixes, GNU long names, pax paths), but a GNU sparse file as
  a plain one, and names not in UTF-8 with replacement characters;
  `tarfile` keeps their bytes.
- **The schema of `object.json`** is always checked before a deposit;
  opensheaf-py checks it when `jsonschema` is installed.

Notes for phase 6 (the Manager), from this phase:

- **A storage over GitHub's Git Data API.** The Manager writes through a
  storage (chapter [20](20-storage.md)) whose writes are gathered in
  memory and made one commit at the end of a command: blobs for the new
  files, a tree built on the tree of the branch's head, a commit, and the
  reference moved only if the head is still the one read (otherwise the
  command is refused, and run again on the new head). The staging
  folders (`.staging-*`, the versions built by `addVersion`) cost
  nothing then, since a rename is a change of the tree; reading falls
  back to the tree of the head (`git/trees?recursive=1`, then blobs by
  digest), which also gives the `lister` of a complete verification. A
  takedown removes paths from the tree. The token is the person's,
  fine-grained, for that repository only; GitHub's REST API sends CORS
  headers, its OAuth device flow does not, so a page asks for the token
  or goes through an OAuth application with a server of its own.
- **The passkey origin question.** Passkeys are bound to the relying
  party `unlock.opensheaf.org` (chapter [36](36-passkeys.md)); a page of
  another origin cannot use them (WebAuthn's related origins would let a
  listed origin do so, but not every browser has them). So the Manager
  must either live on `unlock.opensheaf.org` itself, where it calls
  WebAuthn directly and opens the rotation keys in its own page, or hand
  off to that page as the command line does: the Manager opens it in a
  window, with an X25519 key of its own and a state, and the page sends
  back the sealed secret, by `postMessage` to the opener's origin instead
  of the loopback listener of the command line, with the same
  confirmation code and the same associated data. The first is simpler
  and keeps the secret in one page; the second keeps the Manager
  wherever it is published (a project's own Pages). This needs a
  decision before the Manager is written.
- **The services are not the Manager's.** arXiv and Zenodo send no CORS
  headers, so `arxiv fetch` and `zenodo` stay on the command line; `arxiv
  import` needs no network, and could run in the Manager on downloads
  committed to the repository, which would be large: it is better left
  to the command line too.
- Versions, mirrors, branches and Zenodo deposits are built in staging
  folders of the storage; a Zenodo deposit leaves `zenodo-staging/` only
  while it is incomplete, and the Manager, which does not deposit, needs
  only to respect its lock, which `addVersion` reads.

Phase 6: results and notes
--------------------------

The decision asked for at the end of phase 5 was made: the Manager stays
where it is published (`https://opensheaf.org/manager/` then; since
21 November 2026 on an origin of its own, `https://manager.opensheaf.org/`,
the only one the unlock page answers) and hands off
to `unlock.opensheaf.org` in a popup, by window messages, with the
cryptography of the command line's hand-off and the mode `popup` in its
authenticated data (chapter [36](36-passkeys.md)). Keys made for one
browser were not chosen: the keys that sign are the owner's current keys
in its key wallet, which the passkey opens.

What the tests show (chapter [76](76-tests-github.md)), against a double
of GitHub's API whose objects are git's:

- the storage over GitHub behaves as the storage in memory; a command is
  one commit on top of the head read, a folder moved costs no upload, a
  file written again with its bytes is no change, modes are kept; a
  branch moved meanwhile refuses the commit, and the command is run
  again on the new head; trees too large for one answer, the mirror
  (taken only when what it serves is the blob) and prefetching work;
- the same requests (new papers and new versions, sources in a zip,
  notices, licences, a withdrawal, a new collection inside another and
  featured, members added, vetted and removed) carried out on a folder
  and on the double's repository leave the same files, byte for byte,
  and the same commit messages;
- the same requests carried out by the archive template's script with
  opensheaf-py and by `carryOut` give the same files (new works by their
  labels, pins of inventories aside), the same commit messages, and the
  same answers, refusals included;
- the popup's answer is the vector the unlock page's tests compute; a
  key opened from a wallet by a passkey's secret signs as the key, and
  cannot be exported.

And live, against a throwaway archive on GitHub
(`opensheaf/opensheaf-manager-test`), with the Manager's own code run by
Node (its `tools/live-test.mjs`, a key from a file in place of the
passkey): a notice was committed 11 s after the start (2 s to read the
head, 3 s to prefetch about 160 small files, 1.5 s to carry it out and
sign, 4.5 s to upload 21 files and commit), and GitHub Pages served it
27 s later; a new paper in a collection, 18 s and 24 s. The archive's
workflow took about 25 s for a request, then Pages about 27 s. The
commits pass `osheaf verify` of opensheaf-py, and the archive's own
verification workflow.

Where the Manager differs from the workflow:

- **The verification** of a request trusts the content files to match
  their inventories (`digests: false`): they are git blobs, named by
  their content, and the content of papers is never read. The search for
  private keys reads only the files under 4096 bytes, whose sizes the
  tree gives (a seventh method of a storage, `size`).
- **Attachments** are files only: the links of an issue form, which the
  script downloads, are not followed.
- **YAML** of the collections' files is written by the `yaml` package as
  PyYAML writes it for the texts the forms give; a tab, or a text that
  YAML 1.1 reads as a float without a dot (`1e3`), would be quoted
  otherwise.
- **`setup` and `arxiv`** stay with the workflow: the setup makes the
  archive with an owner made on the author's computer, and arXiv sends
  no CORS headers.
- **The rate of GitHub's API**: a request uploads each new file as a blob
  (a deposit, some forty), and GitHub limits the creation of content
  (eighty requests a minute); a page that writes many requests in a row
  may be slowed down.

What stays in Python for now
----------------------------

- **TeXmacs**: a TeXmacs source without its PDF is typeset by
  opensheaf-py, which runs TeXmacs headless; the command line here will
  call TeXmacs as an external program in a later phase. Until then, a
  deposit gives the PDF.
- The TeXmacs sources of arXiv versions found in the authors' files
  (`osheaf arxiv import --texmacs`), whose import typesets their HTML
  version.
- The TeXmacs index of an archive (`--index texmacs`).
- YAML configurations (`osheaf.yaml`), which opensheaf-py reads; this
  program reads `osheaf.json` (it reads YAML for `--from FILE` only).
