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
cli/    the command line: node: modules, which Deno has too
  disk       an archive folder on a disk
  keystore   current keys, exported keys, passphrases
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

**Two libraries.** Argon2id and XSalsa20-Poly1305, which encrypt the keys
kept outside an archive, are not in WebCrypto. They come from
`hash-wasm` 4.12.0 and `tweetnacl` 1.0.3, pinned, loaded only when a key
file is encrypted or decrypted (chapter [21](21-keys.md) says why these
two). `hash-wasm` also gives MD5, for the fixity of OCFL inventories.

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
| [40](40-cli.md) | `cli/*.js` | the command line | opensheaf-py 60 |
| [70](70-tests.md)–[72](72-tests-parity.md) | `tests/*.test.js` | the tests | |

The chapters 05 to 17 are the Explorer's, copied with their reasoning;
where they speak of "the explorer", they speak of the reader of archives
the code was first written for, whose behaviour the core keeps. When the
Explorer imports the core from this repository (phase 7), these chapters
will be the only copy.

The phases
----------

1. **Foundation** (this version, 0.1.0): the core above; `osheaf init`
   with a new owner (rotation keys exported in clear or under a
   passphrase, the current key in the file store), `osheaf deposit` (a new
   work, new document versions, any source with its PDF, or a PDF alone),
   `osheaf collect`, `osheaf index` (the discovery document and the
   indexes), `osheaf verify`; the tests of appendix C and of parity.
2. **Descriptions and the website**: `notice`, `relicense`, `relate`,
   `describe`, `withdraw`, `complete`; `collection` (catalogues and
   selections, members of any archive, a curated main catalogue); the
   website of the profile `website` (home page, landing pages, owner pages,
   sitemap, as opensheaf-py's templates write them), so that `init` makes
   the same configuration as opensheaf-py; `--from FILE`.
3. **Owners and keys**: `owner rotate|expose|end|show|init`, `sign`,
   `key new|export|import|forget`; key wallets (GitHub and command
   wallets, envelopes, `key push|pull|list`); passkey unlock
   (`key enroll|unlock`, WebAuthn PRF, `unlock.opensheaf.org`); the macOS
   keychain through `security`; `init --owner --key-log`.
4. **Across archives**: `resolve`, `mirror`, `owner pull`, `branch`,
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

What stays in Python for now
----------------------------

- **TeXmacs**: a TeXmacs source without its PDF is typeset by
  opensheaf-py, which runs TeXmacs headless; the command line here will
  call TeXmacs as an external program in a later phase. Until then, a
  deposit gives the PDF.
- Everything of phases 2 to 5, above: `osheaf` of opensheaf-py does it on
  the same archives, and the command here says so when asked.
- YAML configurations (`osheaf.yaml`), which opensheaf-py reads; this
  program reads `osheaf.json`.
