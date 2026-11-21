opensheaf-js, a literate program
================================

> [!WARNING]
> **Draft.** OpenSheaf 0.2 is a draft specification: until version 1.0, a
> revision may change the format in incompatible ways, and these tools
> follow the latest draft. opensheaf-js is in its sixth phase: it has the
> commands of `osheaf`, arXiv and Zenodo included, and the core of the
> Manager, which writes archives held on GitHub from a browser; TeXmacs
> sources without their PDF are typeset by
> [opensheaf-py](https://opensheaf.org/opensheaf-py/).

This is the source of [opensheaf-js](https://github.com/opensheaf/opensheaf-js),
the tools of [OpenSheaf](https://opensheaf.org) (the `osheaf` command) in
JavaScript, written as a literate program. It is a port of
[opensheaf-py](https://opensheaf.org/opensheaf-py/), the reference
implementation, whose commands, options, messages and files it keeps, so
that either keeps an archive the other made; and it reuses the reading
and verification of archives of the
[OpenSheaf Explorer](https://opensheaf.org/explorer/), which the Explorer
will import from here in turn. It runs on Deno (a command line, and a
single binary made by `deno compile`), on Node, and, for its core, in
browsers.

An OpenSheaf archive is a folder of plain files: an
[OCFL](https://ocfl.io) storage root in which every work is a line of
versions, decided by one owner, who signs them with Ed25519 keys; every
version fixed by SHA-512 digests and described by
[DataCite](https://datacite.org) metadata; works and owners named by the
digests of their genesis records; owners with key logs that check
themselves from their names; collections that pin lines of any archive;
and a discovery document, `opensheaf.json`, that makes it all findable.

The files of the program (`core/*.js`, `cli/*.js`) and its tests are
*tangled* out of these documents and kept in the repository, so that the
program runs as it stands; the documents are also *woven* into this
website. One edits the documents, never the files. The tangler and the
weaver are [opensheaf-literate](https://opensheaf.org/literate/) (the
`literate` command), pinned in `requirements-literate.txt` and configured
by `literate.json`; `literate tangle --where FILE:LINE` tells which line
of which chapter a line of a tangled file comes from. The JSON Schemas in
`schemas/` and the symbol `opensheaf-symbol.svg` are copies of the
specification's own files.

Reading the code
----------------

Code is set in grey boxes. Above each box stands the name of its chunk,
with `≡` for the first fragment of a chunk and `+≡` for the ones that
continue it; a name in angle brackets inside the code is a reference to
another chunk, and a link to it. Below each box: where the chunk is used,
and where it continues. The [index of chunks](chunks.html) lists them
all. Sections of the specification are cited as "section 7.3"; the
specification is at
[opensheaf.org](https://opensheaf.org/opensheaf-specification-0.2.html).

The plan
--------

0. [The plan](00-plan.md): goals, architecture, the map of the modules,
   the phases, parity with opensheaf-py, and what stays in Python.

Identity (from the Explorer)
----------------------------

1. [Digests, encodings and signatures](05-crypto.md): SHA-256 and
   SHA-512, base32, base58btc, and Ed25519 verified as section 7.2 asks.
2. [Names, keys and sheaf: URIs](06-names.md): genesis records, names,
   `did:key` URIs, canonical JSON, `sheaf:` URIs.
3. [Owners and their key logs](07-owners.md): the computed first version,
   rotation, exposure, ending, fork records, copies met.
4. [Signatures and the statuses of versions](08-signatures.md).
5. [Branches and their verdicts](09-branches.md).

Reading and verifying archives (from the Explorer)
--------------------------------------------------

6. [Reading archives over HTTP](10-http.md): requests, limits, errors.
7. [Untrusted names and storage layouts](11-paths.md).
8. [Validating against the JSON Schemas](12-schema.md).
9. [Document versions and history](13-versions.md).
10. [An archive read over HTTP](14-archive.md).
11. [Resolution: copies, pins and sheaf: URIs](15-resolve.md).
12. [The rules of an archive](16-rules.md).
13. [Verifying an archive](17-verify.md), in agreement with `osheaf
    verify`.

Keeping an archive
------------------

14. [Storage: an archive as files](20-storage.md): on a disk, in memory,
    over GitHub (chapter 47); and a storage read over `fetch`.
15. [Keys: signing, and key files](21-keys.md): Ed25519 with WebCrypto,
    rotation key files in clear and under a passphrase, envelopes that a
    passphrase or a passkey opens, texts for password managers.
16. [Writing files as opensheaf-py writes them](22-writing.md): JSON,
    genesis records, inventories, signature files, key logs.
17. [The archive kept](23-folder.md): configuration, objects, key logs
    and statuses, the keys that sign, adding a signed version.
18. [The main catalogue](24-main-catalogue.md).
19. [The discovery document and the indexes](25-discovery.md).
20. [Depositing documents](26-deposit.md).
21. [A new owner, a new archive](27-init.md).
22. [Verifying an archive folder](28-verify-folder.md), with the
    presentation and the keepers checked as opensheaf-py checks them.
23. [Descriptions](29-description.md): notices, withdrawals, completions,
    related works, licences and corrections.
24. [Collections](30-collections.md): catalogues and selections, with
    members of any archive.
25. [The website](31-website.md): home page, landing pages, owner pages
    and sitemap, from opensheaf-py's templates.
26. [Keepers](32-keepers.md): the link of an owner to its keeper.
27. [Options from files](33-inputs.md): `--from FILE`, YAML or JSON.

Owners and keys
---------------

28. [Key logs, changed](34-key-logs.md): rotating, exposing, ending, fork
    records, copies met, key logs read from folders.
29. [Key wallets](35-wallets.md): a private GitHub repository through
    GitHub's API, or commands of the user's.
30. [Passkey unlock](36-passkeys.md): the hand-off from
    `unlock.opensheaf.org`, X25519 and HKDF with WebCrypto.
31. [The commands of owners and keys](37-owner-commands.md): `owner`,
    `key`, `sign`, `init --owner`.

Across archives
---------------

32. [Resolution and mirrors](38-mirrors.md): `resolve`, objects copied
    from other archives, `mirror`.
33. [Branches and accepted copies](39-branches-kept.md): `branch`,
    `accept`.
34. [Drafts and sealing](41-drafts.md): `draft`, `seal`.
35. [Takedowns and tombstones](42-takedown.md): `takedown`, the return of
    a line.

Services
--------

36. [Importing from arXiv: fetching](43-arxiv.md): the downloads folder,
    arXiv asked politely.
37. [Importing from arXiv: the metadata](44-arxiv-metadata.md): the
    record, names, titles and abstracts from TeX, licences.
38. [Importing from arXiv: the signed versions](45-arxiv-import.md):
    e-prints unpacked, one sealed line per paper, `arxiv import`.
39. [Zenodo: DOIs for document versions](46-zenodo.md): a version built
    and signed before Zenodo publishes it, `sources.zip`, the sandbox.

The Manager
-----------

40. [A storage over GitHub](47-github-storage.md): the head of a branch
    read through its tree, blobs checked by their git names, a mirror,
    and every command one commit, never forced.
41. [The requests of a page](48-requests.md): the archive template's
    script, which carries out the forms, in JavaScript.
42. [The Manager's core](49-manager.md): the keys a passkey unlocks,
    kept unexportable, a request written directly, the bundle.

The command line
----------------

43. [The command line](40-cli.md): a folder on a disk, the keys of this
    device (files, the macOS keychain), the clipboard, the listener of
    the passkey hand-off, the tokens of Zenodo, the commands.

The tests
---------

44. [The tests](70-tests.md): storages, files, key files, an archive in
    memory, owners, wallets and passkeys.
45. [The tests of names, keys and signatures](71-tests-identity.md),
    against appendix C and the edge cases of Ed25519.
46. [The tests of parity with opensheaf-py](72-tests-parity.md).
47. [The tests across archives](74-tests-across.md): resolution, mirrors,
    branches, drafts and takedowns, by both programs.
48. [The tests of the services](75-tests-services.md): arXiv and Zenodo,
    against doubles, by both programs.
49. [The tests of GitHub and the requests](76-tests-github.md): the
    storage against a double of GitHub, the same requests on a disk and
    on GitHub, by the template's script and by this program, and the
    Manager's core.
