The tests across archives
=========================

The commands that work across archives (chapters [38](38-mirrors.md) to
[42](42-takedown.md)) are tested as the others are, against opensheaf-py
(chapter [72](72-tests-parity.md)): each command is run by both programs
on two copies of one archive, which must then hold the same files (the
times of versions aside, and for a sealed work its name), say the same,
and give the same findings to both verifications. The other archives are
served over HTTP by a local server, and both programs read them at
`https://example.org/...` through `OPENSHEAF_LOCATIONS`, as in chapter
[72](72-tests-parity.md). The archives are made by either program, so
that each copies, branches and checks what the other wrote:

1. `resolve`, by its JSON, of a line, a document version, a pin, a short
   form and a key log, inside an archive and outside any;
2. `mirror` of a line of an archive made by this program, into an archive
   made by opensheaf-py: made with a warning for a closed licence (section
   11.2), made, brought up to
   date by `mirror --all` up to the latest signed version only; the
   mirror's object is the source's, byte for byte;
3. `accept` and `branch` in an archive made by this program, of a line of
   an archive made by opensheaf-py: an accepted copy with the original
   revision set, numbered 1 with the parent's number kept (section 9.4),
   a notice of the journal with its file, a new branch point that keeps
   it, the refusal of the same branch point; then a branch of that branch, made in an archive of
   opensheaf-py; both verifications, with `--remote` (the parent's line
   found through `parent.url`), agree;
4. `draft new|deposit` (`--replace`), `seal` and `draft delete`;
5. `takedown` of a mirror, its return by a new mirror, and the takedown
   of a line and of its key log by law, with the findings of both
   verifications on the archive each took down;
6. the owner catalogues of an archive with two owners (section 8.1):
   `collect --owner` and `collect`, the label of the second owner's
   catalogue, the home page together and by owner, and the checks of
   `owners` (sections 3.1 and 14.6);
7. the checks of the final review of 0.2, on an archive of opensheaf-py
   broken one way at a time: files of the specification that break
   section 2, symbolic links, a private key, empty folders, a tombstone
   sharing a genesis record, signature files where they do not belong
   or with a byte order mark, a discovery document with a fraction.
8. the OCFL validator and ocfl-py on the same archive, broken where OCFL
   allows nothing: the same findings, in ocfl-py's words.

These tests are part of `tests/parity.test.js`, and use its helpers.

    // in tests/parity.test.js:
    <<across: the archives of the tests>>

    <<across: resolution and mirrors>>

    <<across: branches and accepted copies>>

    <<across: drafts, seals and takedowns>>

    <<across: owner catalogues>>

    <<across: the checks of the final review>>

    <<across: the OCFL validator on broken copies>>

The archives
------------

An archive is made by one program or the other, under
`https://example.org/<name>/`, and a paper deposited as a PDF alone. A
`sheaf:` URI of a line names the archive where it is found in its `at`.

    // in across: the archives of the tests:
    async function archiveBy(s, tool, name) {
      ok(s[tool](['init', name, '--name', name, '--base-url', `https://example.org/${name}/`, '--curator', 'Doe, Jane',
                  '--new-owner', '--export', path.join(s.root, `${name}-keys`), '--yes', '--no-passphrase']), `${tool} init ${name}`);
      return path.join(s.root, name);
    }

    async function paper(s, tool, root, label, text, more = [], rights = 'cc-by-4.0') {
      await s.file(`${label}.pdf`, `%PDF-1.4 ${text}`);
      return ok(s[tool](['deposit', label, '--pdf', path.join(s.root, `${label}.pdf`), '--no-source', 'x', '--title', label,
                         '--author', 'Doe, J', '--issued', '2020-01-01', '--rights', rights, ...more], { cwd: root }),
                `${tool} deposit ${label}`);
    }

    async function headFile(root, id, logical) {
      const [, name, owner] = id.split(':');
      const dir = path.join(root, 'ocfl', owner, name);
      const inv = JSON.parse(await readFile(path.join(dir, 'inventory.json'), 'utf-8'));
      const state = inv.versions[inv.head].state;
      const d = Object.keys(state).find((k) => state[k].includes(logical));
      return readFile(path.join(dir, inv.manifest[d][0]));
    }

    async function headJson(root, id, logical = 'object.json') {
      return JSON.parse(new TextDecoder().decode(await headFile(root, id, logical)));
    }

    async function idOf(root, label) {
      return JSON.parse(await readFile(path.join(root, 'opensheaf.json'), 'utf-8')).objects.find((o) => o.label === label).id;
    }

    function at(name) {
      return `at=${encodeURIComponent(`https://example.org/${name}/`)}`;
    }

    async function across() {
      const s = await sandbox();
      const server = await serve(s.root);
      const more = { OPENSHEAF_LOCATIONS: `https://example.org/=${server.url}` };
      const run = (tool) => (args, options = {}) => s[tool](args, { ...options, more: { ...more, ...(options.more || {}) } });
      return { ...s, server, more, js: run('js'), py: run('py'), done: async () => { server.stop(); await s.done(); } };
    }

    function json(r) {
      return JSON.parse(r.stdout);
    }

A selection that lists an accepted copy pins a version of it, whose
inventory records the time it was made, which differs between the two
copies: the selection is compared with its pins left out, and the rest
of the archive as it is.

    // in across: the archives of the tests:
    async function sameWithSelection(a, b, selection) {
      const [, , owner] = selection.split(':'), name = selection.split(':')[1];
      const dir = `ocfl/${owner}/${name}/`;
      await sameArchives(a, b, (p) => p.startsWith(dir));
      const headOf = async (root) => JSON.parse(await readFile(path.join(root, 'opensheaf.json'), 'utf-8'))
        .objects.find((o) => o.id === selection).head;
      assert.equal(await headOf(b), await headOf(a));
      const members = async (root) => {
        const inv = JSON.parse(await readFile(path.join(root, 'ocfl', owner, name, 'inventory.json'), 'utf-8'));
        const state = inv.versions[inv.head].state;
        const d = Object.keys(state).find((k) => state[k].includes('members.json'));
        return (await readFile(path.join(root, 'ocfl', owner, name, inv.manifest[d][0]), 'utf-8'))
          .replace(/"inventorySha512": "[0-9a-f]*"/g, '"inventorySha512": "-"');
      };
      assert.equal(await members(b), await members(a));
    }

Resolution and mirrors
----------------------

    // in across: resolution and mirrors:
    test('resolve and mirror across archives, by both', { skip }, async () => {
      const s = await across();
      try {
        const authors = await archiveBy(s, 'js', 'authors'), lib = await archiveBy(s, 'py', 'lib');
        await paper(s, 'js', authors, 'paper', 'one', ['--new']);
        await paper(s, 'js', authors, 'paper', 'two');
        await paper(s, 'js', authors, 'closed', 'closed', ['--new'], 'All rights reserved');
        const id = await idOf(authors, 'paper'), [, name, owner] = id.split(':');
        for (const uri of [`${id}?${at('authors')}`, `sheaf:${name}/v1?${at('authors')}`, `sheaf:${name.slice(0, 12)}?${at('authors')}`,
                           `sheaf:${owner}?${at('authors')}`, `${id}/v9?${at('authors')}`]) {
          const p = s.py(['resolve', uri, '--json'], { cwd: lib }), j = s.js(['resolve', uri, '--json'], { cwd: lib });
          assert.equal(j.status, p.status, uri);
          assert.deepEqual(json(j), json(p), uri);
        }
        const outside = ['resolve', `sheaf:${name}`, '--at', 'https://example.org/authors/', '--json'];
        assert.deepEqual(json(ok(s.js(outside), 'js resolve')), json(ok(s.py(outside), 'py resolve')));
        assert.equal(json(s.js(outside)).status, 'verified');
        const closed = await both(s, lib, ['mirror', `${await idOf(authors, 'closed')}?${at('authors')}`], { more: s.more });
        await sameArchives(closed.a, closed.b);
        let { a, b } = await both(s, lib, ['mirror', `${id}?${at('authors')}`, '--label', 'copy'], { more: s.more });
        assert.deepEqual(await filesOf(path.join(b, 'ocfl', owner, name)), await filesOf(path.join(authors, 'ocfl', owner, name)));
        await sameArchives(a, b);
        assert.deepEqual(verified(s, b, s.more).filter((f) => !f.startsWith('result')), []);
        ok(s.py(['mirror', `${id}?${at('authors')}`, '--label', 'copy'], { cwd: lib }), 'py mirror');
        await paper(s, 'js', authors, 'paper', 'three');
        await paper(s, 'py', authors, 'paper', 'four');
        await rm(path.join(authors, 'ocfl', owner, name, 'extensions', 'opensheaf-witnesses', 'v4'), { recursive: true });
        ({ a, b } = await both(s, lib, ['mirror', '--all'], { more: s.more }));
        await sameArchives(a, b);
        assert.equal(JSON.parse(await readFile(path.join(b, 'ocfl', owner, name, 'inventory.json'), 'utf-8')).head, 'v3');
        assert.deepEqual(verified(s, a, s.more).filter((f) => !f.startsWith('result')), []);
      } finally {
        await s.done();
      }
    });

Branches and accepted copies
----------------------------

    // in across: branches and accepted copies:
    test('accept and branch across archives, by both', { skip }, async () => {
      const s = await across();
      try {
        const authors = await archiveBy(s, 'py', 'authors'), journal = await archiveBy(s, 'js', 'journal');
        const bb = await archiveBy(s, 'py', 'bb');
        await paper(s, 'py', authors, 'work', 'one', ['--new']);
        await paper(s, 'py', authors, 'work', 'two');
        ok(s.js(['collection', 'new', 'issue-1', '--type', 'selection', '--title', 'Issue 1'], { cwd: journal }), 'js new');
        const id = await idOf(authors, 'work');
        const v = (n) => `${id}/v${n}?${at('authors')}`;
        const selection = await idOf(journal, 'issue-1');
        let { a, b } = await both(s, journal, ['accept', v(2), '--selection', 'issue-1', '--label', 'work', '--with-original'],
                                  { more: s.more });
        await sameWithSelection(a, b, selection);
        for (const where of [a, b]) {
          const found = verified(s, where, s.more, true);
          assert.deepEqual(found.filter((f) => f.startsWith('error')), [], found.join('\n'));
          assert.ok(found.some((f) => /work: a branch of .*: confirmed \(section 9\.3\)/.test(f)), found.join('\n'));
          assert.ok(found.some((f) => /the parent's line: verified at https:\/\/example.org\/authors\//.test(f)), found.join('\n'));
        }
        ok(s.js(['accept', v(2), '--selection', 'issue-1', '--label', 'work', '--with-original'], { cwd: journal }), 'js accept');
        const accepted = await idOf(journal, 'work');
        let obj = await headJson(journal, accepted);
        assert.ok(obj.documentVersion === 1 && obj.parent.documentVersion === 2 && !('notices' in obj));
        await paper(s, 'py', authors, 'work', 'three');
        await s.file('remark.md', 'Accepted with a remark.');
        ok(s.js(['notice', 'work', '--about', '1', '--text', 'A remark.', '--file', path.join(s.root, 'remark.md')],
                { cwd: journal }), 'js notice');
        ({ a, b } = await both(s, journal, ['accept', v(3), '--selection', 'issue-1'], { more: s.more }));
        await sameWithSelection(a, b, selection);
        for (const where of [a, b]) {
          obj = await headJson(where, accepted);
          assert.ok(obj.documentVersion === 2 && obj.parent.documentVersion === 3 && obj.parent.objectVersion === 'v3');
          assert.equal(obj.notices[0].text, 'A remark.');
          assert.equal(new TextDecoder().decode(await headFile(where, accepted, obj.notices[0].path)), 'Accepted with a remark.');
          assert.deepEqual(verified(s, where, s.more).filter((f) => f.startsWith('error')), []);
        }
        ok(s.py(['accept', v(3), '--selection', 'issue-1'], { cwd: journal }), 'py accept');
        await both(s, journal, ['accept', v(3), '--selection', 'issue-1'], { more: s.more, status: 1 });
        ({ a, b } = await both(s, bb, ['branch', `${accepted}/v2?${at('journal')}`, '--label', 'continued'], { more: s.more }));
        await sameArchives(a, b);
        const found = verified(s, a, s.more);
        assert.ok(found.some((f) => /continued: a branch of .*: confirmed/.test(f)), found.join('\n'));
        await both(s, authors, ['branch', `${accepted}/v2?${at('journal')}`, '--label', 'back'], { more: s.more, status: 1 });
      } finally {
        await s.done();
      }
    });

Drafts, seals and takedowns
---------------------------

    // in across: drafts, seals and takedowns:
    test('drafts, seals and takedowns, by both', { skip }, async () => {
      const s = await across();
      try {
        const authors = await archiveBy(s, 'py', 'authors'), lib = await archiveBy(s, 'js', 'lib');
        await paper(s, 'py', authors, 'paper', 'one', ['--new']);
        const id = await idOf(authors, 'paper'), owner = id.split(':')[2];
        const pdf = path.join(s.root, 'd.pdf');
        const draft = ['--pdf', pdf, '--no-source', 'x', '--title', 'Notes', '--author', 'Doe, J'];
        await s.file('d.pdf', '%PDF-1.4 draft one');
        let { a, b } = await both(s, authors, ['draft', 'new', 'notes', ...draft]);
        await sameArchives(a, b);
        ok(s.py(['draft', 'new', 'notes', ...draft], { cwd: authors }), 'py draft new');
        await s.file('d.pdf', '%PDF-1.4 draft two');
        ok(s.js(['draft', 'deposit', 'notes', ...draft], { cwd: authors }), 'js draft deposit');
        await s.file('d.pdf', '%PDF-1.4 draft two, corrected');
        ({ a, b } = await both(s, authors, ['draft', 'deposit', 'notes', ...draft, '--replace']));
        await sameArchives(a, b);
        verified(s, b);
        ({ a, b } = await both(s, authors, ['seal', 'notes', '--label', 'lecture-notes']));
        await sameNewWork(a, b, 'lecture-notes');
        verified(s, a);
        const sealed = path.join(s.root, 'sealed');
        await cp(authors, sealed, { recursive: true });
        ({ a, b } = await both(s, sealed, ['seal', 'notes', '--label', 'lecture-notes', '--delete-draft']));
        for (const where of [a, b]) {
          await assert.rejects(readdir(path.join(where, 'ocfl', 'draft')), { code: 'ENOENT' });
          assert.deepEqual(verified(s, where).filter((f) => f.startsWith('error')), []);
        }
        await rm(sealed, { recursive: true });
        ({ a, b } = await both(s, authors, ['draft', 'delete', 'notes']));
        await sameArchives(a, b);
        ok(s.js(['mirror', `${id}?${at('authors')}`, '--label', 'copy'], { cwd: lib }), 'js mirror');
        ({ a, b } = await both(s, lib, ['takedown', id, '--reason', 'Stopped keeping it.', '--yes']));
        await sameArchives(a, b);
        verified(s, b);
        ok(s.py(['takedown', id, '--reason', 'Stopped keeping it.', '--yes'], { cwd: lib }), 'py takedown');
        ({ a, b } = await both(s, lib, ['mirror', `${id}?${at('authors')}`], { more: s.more }));
        await sameArchives(a, b);
        assert.equal(JSON.parse(await readFile(path.join(b, 'opensheaf.json'), 'utf-8')).tombstones, undefined);
        assert.deepEqual(verified(s, a).filter((f) => !f.startsWith('result')), []);
        ({ a, b } = await both(s, authors, ['takedown', 'paper', '--reason', 'At the request of the holder of the rights.', '--yes']));
        await sameArchives(a, b);
        for (const where of [a, b]) {
          const found = verified(s, where);
          assert.deepEqual(found.filter((f) => f.startsWith('error')), [], found.join('\n'));
          assert.ok(found.some((f) => f.startsWith(`result: opensheaf.json: removed: ${id}`)));
        }
        await both(s, authors, ['takedown', `sheaf:${owner}:${owner}`, '--reason', 'x', '--yes'], { status: 1 });
        await both(s, authors, ['takedown', 'paper', '--reason', 'x', '--by-law', '--keeper', '--yes'], { status: 2 });
        ({ a, b } = await both(s, authors, ['takedown', `sheaf:${owner}:${owner}`, '--reason', 'A court order.', '--by-law', '--yes']));
        await sameArchives(a, b);
        const unchecked = verified(s, a);
        assert.ok(unchecked.some((f) => /signature-.*: unchecked/.test(f)), unchecked.join('\n'));
        verified(s, b);
      } finally {
        await s.done();
      }
    });

Owner catalogues
----------------

An archive of opensheaf-py with two owners, as opensheaf-py's
`test_owner_catalogues` makes it: a paper of the first owner, collected;
a second owner set up by `osheaf owner init`, which seals its owner
catalogue, empty, unlabelled; a paper of the second owner and its branch
of the first owner's paper. `collect --owner` of the second owner, by
both, gives a new version to its catalogue only, signed by it; `collect`
then changes nothing. `label --owner` gives the second owner's catalogue
the label `<label>-catalogue`, the same by both. Both write the same home
page, the documents together, each naming its owner, and, with
`index.owners` `by-owner`, under a heading for each owner, in the order of
`owners`. A discovery document naming an owner twice, or giving one owner
the catalogue of another, is an error to both verifications, `owners` in
another order is none, and a discovery document without `owners` is an
error (section 3.1). Without the second owner's keys, `collect` by both
collects the first owner's catalogue, skips the second's, writes the
website and fails, naming it (opensheaf-py's issue #5); `collect --owner`
of the second still stops.

    // in across: owner catalogues:
    test('owner catalogues, by both', { skip }, async () => {
      const s = await across();
      try {
        const arch = await archiveBy(s, 'py', 'oc');
        const json = async (root, p) => JSON.parse(await readFile(path.join(root, p), 'utf-8'));
        const head = async (root, id) => (await json(root, `ocfl/${id.split(':')[2]}/${id.split(':')[1]}/inventory.json`)).head;
        await paper(s, 'py', arch, 'paper', 'one', ['--new']);
        ok(s.py(['collect'], { cwd: arch }), 'py collect');
        ok(s.py(['owner', 'init', '--export', path.join(s.root, 'second-keys'), '--no-passphrase', '--yes'], { cwd: arch }),
           'py owner init');
        const cfg = await json(arch, 'osheaf.json');
        const [first, second] = [cfg.owner, cfg.owners[0]];
        let disc = await json(arch, 'opensheaf.json');
        assert.deepEqual(disc.owners.map((e) => e.owner), [first, second]);
        assert.equal('mainCollection' in disc, false);
        const [cat1, cat2] = disc.owners.map((e) => e.catalogue);
        assert.equal(cat1, await idOf(arch, 'main'));
        assert.equal(cat2.split(':')[2], second);
        assert.equal(disc.objects.find((o) => o.id === cat2).label, undefined);
        assert.equal(await head(arch, cat2), 'v1');
        let { a, b } = await both(s, arch, ['label', '--owner', second, 'jane'], { more: s.more });
        for (const where of [a, b]) {
          assert.equal((await json(where, 'opensheaf.json')).objects.find((o) => o.id === cat2).label, 'jane-catalogue');
        }
        assert.equal(await readFile(path.join(b, 'osheaf.json'), 'utf-8'), await readFile(path.join(a, 'osheaf.json'), 'utf-8'));
        ok(s.py(['label', '--owner', second, 'jane'], { cwd: arch }), 'py label');
        const head1 = await head(arch, cat1);
        await paper(s, 'py', arch, 'theirs', 'two', ['--new', '--owner', second]);
        ok(s.py(['branch', `${await idOf(arch, 'paper')}/v1`, '--owner', second, '--label', 'continued'], { cwd: arch }),
           'py branch');
        ({ a, b } = await both(s, arch, ['collect', '--owner', second], { more: s.more }));
        await sameArchives(a, b);
        assert.equal(await head(b, cat1), head1);
        assert.equal(await head(b, cat2), 'v2');
        const collected = path.join(s.root, 'collected');
        await cp(a, collected, { recursive: true });
        await both(s, collected, ['collect', '--owner', 'a'.repeat(51) + 'q'], { more: s.more, status: 1 });
        ({ a, b } = await both(s, collected, ['collect'], { more: s.more }));
        await sameArchives(a, b);
        assert.equal(await head(b, cat1), head1);
        const members = await json(b, `ocfl/${second}/${cat2.split(':')[1]}/v2/content/members.json`);
        assert.deepEqual(members.members.map((m) => m.owner), [second, second]);
        ok(s.js(['index'], { cwd: b }), 'js index');
        assert.deepEqual(verified(s, b, s.more).filter((f) => f.startsWith('error')), []);
        const own = await json(b, `ocfl/${first}/${cat1.split(':')[1]}/${head1}/content/members.json`);
        const theirs = await idOf(b, 'theirs');
        const p1 = own.members[0].inventorySha512.slice(0, 32);
        const p2 = members.members.find((m) => `sheaf:${m.name}:${m.owner}` === theirs).inventorySha512.slice(0, 32);
        const homes = async (dir) => {
          ({ a, b } = await both(s, dir, ['index'], { more: s.more }));
          const page = await readFile(path.join(a, 'index.html'), 'utf-8');
          assert.equal(await readFile(path.join(b, 'index.html'), 'utf-8'), page);
          return page;
        };
        let home = await homes(collected);
        assert.ok(home.includes(p1) && home.includes(p2) && !home.includes('owner-heading'));
        assert.ok(home.includes(`<a class="owner" href="owner/${second}/">jane</a>`));
        const grouped = path.join(s.root, 'grouped');
        await cp(collected, grouped, { recursive: true });
        const gcfg = await json(grouped, 'osheaf.json');
        gcfg.index = { ...gcfg.index, owners: 'by-owner' };
        await writeFile(path.join(grouped, 'osheaf.json'), JSON.stringify(gcfg, null, 2) + '\n');
        home = await homes(grouped);
        const h = [...home.matchAll(/<h2 class="owner-heading">/g)].map((m) => m.index);
        assert.equal(h.length, 2);
        assert.ok(h[0] < home.indexOf(p1) && home.indexOf(p1) < h[1] && h[1] < home.indexOf(p2));
        disc = await json(b, 'opensheaf.json');
        const write = (d) => writeFile(path.join(b, 'opensheaf.json'), JSON.stringify(d));
        await write({ ...disc, owners: [disc.owners[0], { owner: second, catalogue: cat1 }, { owner: first, catalogue: cat2 }] });
        const errors = verified(s, b, s.more).filter((f) => f.startsWith('error'));
        assert.ok(errors.some((f) => f.includes(`the catalogue of ${second} in owners`)), errors.join('\n'));
        assert.ok(errors.some((f) => f.includes(`owners lists ${first} twice`)), errors.join('\n'));
        await write({ ...disc, owners: [...disc.owners].reverse() });
        assert.deepEqual(verified(s, b, s.more).filter((f) => f.startsWith('error')), []);
        await write({ ...disc, owners: undefined });
        for (const by of [s.py, s.js]) {   // the schema's message is worded by each validator
          const missing = findings(by(['verify', '--json'], { cwd: b, more: s.more })).filter((f) => f.startsWith('error'));
          assert.ok(missing.some((f) => f.includes('no owners')), missing.join('\n'));
        }
        const skipping = path.join(s.root, 'skipping');
        await cp(collected, skipping, { recursive: true });
        await paper(s, 'py', skipping, 'theirs', 'three', ['--owner', second]);
        await paper(s, 'py', skipping, 'paper', 'four');
        const [heads1, heads2] = [await head(skipping, cat1), await head(skipping, cat2)];
        const dids = (await json(skipping, `ocfl/${second}/${second}/v1/content/genesis.json`)).keys;
        ok(s.py(['key', 'forget', ...dids, '--owner', second, '--yes'], { cwd: skipping, more: s.more }), 'py key forget');
        ({ a, b } = await both(s, skipping, ['collect'], { more: s.more, status: 1 }));
        await sameArchives(a, b);
        assert.equal(await head(b, cat2), heads2);
        assert.equal(await head(b, cat1), `v${Number(heads1.slice(1)) + 1}`);
        assert.deepEqual(verified(s, b, s.more).filter((f) => f.startsWith('error')), []);
        await both(s, skipping, ['collect', '--owner', second], { more: s.more, status: 1 });
      } finally {
        await s.done();
      }
    });

The checks of the final review
------------------------------

An archive of opensheaf-py, a paper in two versions, broken one way at a
time; both verifications find the same, as opensheaf-py's tests of its
final pass (`test_the_verifier_reports_what_it_cannot_read`,
`test_symbolic_links_are_not_followed`,
`test_keys_in_the_archive_are_reported`,
`test_checks_of_the_final_review`) break it. Each case says what it must
find, so that a case that breaks nothing does not pass unnoticed.

    // in across: the checks of the final review:
    test('the checks of the final review, by both', { skip }, async () => {
      const s = await across();
      try {
        const arch = await archiveBy(s, 'py', 'final');
        await paper(s, 'py', arch, 'paper', 'one', ['--new']);
        await paper(s, 'py', arch, 'paper', 'two', ['--changes', 'Second.']);
        ok(s.py(['collect'], { cwd: arch }), 'py collect');
        const id = await idOf(arch, 'paper'), [, name, owner] = id.split(':');
        const dir = (root) => path.join(root, 'ocfl', owner, name);
        const contentOf = async (root, logical, ver = 'v1') => {
          const inv = JSON.parse(await readFile(path.join(dir(root), 'inventory.json'), 'utf-8'));
          const d = Object.entries(inv.versions[ver].state).find(([, ps]) => ps.includes(logical))[0];
          return path.join(dir(root), inv.manifest[d][0]);
        };
        const witness = async (root) => {
          const w = path.join(dir(root), 'extensions', 'opensheaf-witnesses', 'v1');
          return path.join(w, (await readdir(w))[0]);
        };
        const edit = async (file, change) => writeFile(file, change(await readFile(file)));
        const text = (change) => (bytes) => change(new TextDecoder().decode(bytes));
        const cases = {
          'object.json with a byte order mark': [/object\.json: JSON is UTF-8 without a byte order mark/, async (r) =>
            edit(await contentOf(r, 'object.json'), (b) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b]))],
          'a documentVersion 1.0': [/the number 1\.0 is not an integer/, async (r) =>
            edit(await contentOf(r, 'object.json'), text((t) => t.replace('"documentVersion": 1,', '"documentVersion": 1.0,')))],
          'a number in extension data': [/the number 0\.5 is not an integer/, async (r) =>
            edit(await contentOf(r, 'object.json'), text((t) => t.replace('{', '{"extensions": {"https://example.org/ext": {"x": 0.5}},')))],
          'a discovery document with a fraction': [/opensheaf\.json: the number 1\.5 is not an integer/, async (r) =>
            edit(path.join(r, 'opensheaf.json'), text((t) => t.replace('{', '{"x-number": 1.5,')))],
          'a signature file through a link': [/a symbolic link in the archive: never followed/, async (r) => {
            const w = await witness(r);
            await rename(w, path.join(r, 'outside.json'));
            await symlink(path.join(r, 'outside.json'), w);
          }],
          'a private key': [/looks like a private key/, async (r) =>
            writeFile(path.join(r, 'rotation-abcdefghijklmnop-abcdefghijklmnop.txt'), 'x')],
          'an empty draft folder': [/the OCFL validator rejects the storage root/, async (r) => mkdir(path.join(r, 'ocfl', 'draft'))],
          'empty folders in the content': [/\[E024\]/, async (r) =>
            mkdir(path.join(dir(r), 'v1', 'content', 'e', 'f'), { recursive: true })],
          'a tombstone of the same genesis record': [/objects with the same genesis record/, async (r) => {
            const genesis = await readFile(await contentOf(r, 'genesis.json'));
            const other = await nameOf(genesis, 1), genesisName = await nameOf(genesis);
            await edit(path.join(r, 'opensheaf.json'), text((t) => {
              const d = JSON.parse(t);
              d.tombstones = [{ id: `sheaf:${other}:${owner}`, kind: 'document', name: other, owner, lastVersion: 'v1',
                                genesisName, inventorySha512: '0'.repeat(128), date: '2026-01-02', reason: 'x' }];
              return JSON.stringify(d, null, 2);
            }));
          }],
          'a signature file in the first version of the key log': [/a signature file of the computed first version/, async (r) => {
            const w = path.join(r, 'ocfl', owner, owner, 'extensions', 'opensheaf-witnesses', 'v1');
            await mkdir(w, { recursive: true });
            const from = await witness(r);
            await writeFile(path.join(w, path.basename(from)), await readFile(from));
          }],
          'a signature file with a byte order mark': [/Unexpected UTF-8 BOM/, async (r) =>
            edit(await witness(r), (b) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b]))],
        };
        for (const [what, [expected, breakIt]] of Object.entries(cases)) {
          const copy = path.join(s.root, 'broken');
          await rm(copy, { recursive: true, force: true });
          await cp(arch, copy, { recursive: true });
          await breakIt(copy);
          const found = verified(s, copy);
          assert.ok(found.some((f) => expected.test(f)), `${what}:\n${found.join('\n')}`);
        }
      } finally {
        await s.done();
      }
    });

The OCFL validator on broken copies
-----------------------------------

The same archive of opensheaf-py, broken in the ways an OCFL validator
finds (chapter [50](50-ocfl.md)): files and folders where OCFL allows
none, in an object, a version folder, a content directory, the
`extensions` folder of an object or of the storage root, or between the
storage root and the objects; a version inventory that is not JSON, a
content file changed. A checksum file of the wrong form and a fixity
block with a wrong digest are left to the fixtures (chapter
[77](77-tests-ocfl.md)): either changes what the index `sha512/` must
hold, on which the two programs differ (opensheaf-py reads every file of
the index, and builds its entries from the checksum files; this program
reads the files of the prefixes it expects). Both verifications give the
same findings, the messages of `ocfl-py` and of its port included, and
each case finds what it must; a `logs` folder in an object, which OCFL
allows, is no error of the validator.

    // in across: the OCFL validator on broken copies:
    test('the OCFL validator on broken copies, by both', { skip }, async () => {
      const s = await across();
      try {
        const arch = await archiveBy(s, 'py', 'ocfl');
        await paper(s, 'py', arch, 'paper', 'one', ['--new']);
        await paper(s, 'py', arch, 'paper', 'two', ['--changes', 'Second.']);
        ok(s.py(['collect'], { cwd: arch }), 'py collect');
        const id = await idOf(arch, 'paper'), [, name, owner] = id.split(':');
        const dir = (root) => path.join(root, 'ocfl', owner, name);
        const put = async (file, text = 'x') => {
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, text);
        };
        const cases = {
          'a file in the root of an object': [/\[E001a\] OCFL Object root contains unexpected file: stray.txt/,
            (r) => put(path.join(dir(r), 'stray.txt'))],
          'a folder that looks like a version': [/\[E046b\]/, (r) => put(path.join(dir(r), 'v9', 'f'))],
          'a file in a version folder': [/\[E015\]/, (r) => put(path.join(dir(r), 'v1', 'stray.txt'))],
          'a file of the content not in the manifest': [/\[E023a\]/, (r) => put(path.join(dir(r), 'v1', 'content', 'extra.txt'))],
          'a file in the extensions folder of an object': [/\[E067\]/, (r) => put(path.join(dir(r), 'extensions', 'stray.txt'))],
          'a version inventory that is not JSON': [/\[E033\] OCFL Object v1 inventory is not valid JSON \(.*: line \d+ column \d+ \(char \d+\)\)/,
            async (r) => {
              const file = path.join(dir(r), 'v1', 'inventory.json');
              const text = await readFile(file, 'utf-8');
              await writeFile(file, text.slice(0, text.length >> 1));
            }],
          'a content file changed': [/\[E092a\]/, async (r) => {
            const inv = JSON.parse(await readFile(path.join(dir(r), 'inventory.json'), 'utf-8'));
            const file = path.join(dir(r), Object.values(inv.manifest).flat().find((p) => p.endsWith('.pdf')));
            await writeFile(file, Buffer.concat([await readFile(file), Buffer.from('x')]));
          }],
          'a file between the storage root and the objects': [/ocfl: the OCFL validator rejects the storage root/,
            (r) => put(path.join(r, 'ocfl', owner, 'stray.txt'))],
          'an empty folder down the storage root': [/ocfl: the OCFL validator rejects the storage root/,
            (r) => mkdir(path.join(r, 'ocfl', 'x', 'y'), { recursive: true })],
          'a file in the extensions folder of the storage root': [/ocfl: the OCFL validator rejects the storage root/,
            (r) => put(path.join(r, 'ocfl', 'extensions', 'stray.txt'))],
          'a logs folder': [null, (r) => put(path.join(dir(r), 'logs', 'a log.txt'))],
        };
        for (const [what, [expected, breakIt]] of Object.entries(cases)) {
          const copy = path.join(s.root, 'broken');
          await rm(copy, { recursive: true, force: true });
          await cp(arch, copy, { recursive: true });
          await breakIt(copy);
          const found = verified(s, copy);
          if (expected) assert.ok(found.some((f) => expected.test(f)), `${what}:\n${found.join('\n')}`);
          else assert.ok(!found.some((f) => /OCFL validator/.test(f)), `${what}:\n${found.join('\n')}`);
        }
      } finally {
        await s.done();
      }
    });
