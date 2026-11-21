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
   made by opensheaf-py: refused for a closed licence, made, brought up to
   date by `mirror --all` up to the latest signed version only; the
   mirror's object is the source's, byte for byte;
3. `accept` and `branch` in an archive made by this program, of a line of
   an archive made by opensheaf-py: an accepted copy with the original
   revision set, its branch point moved, the refusal of the same branch
   point; then a branch of that branch, made in an archive of
   opensheaf-py; both verifications, with `--remote` (the parent's line
   found through `parent.url`), agree;
4. `draft new|deposit` (`--replace`), `seal` and `draft delete`;
5. `takedown` of a mirror, its return by a new mirror, and the takedown
   of a line and of its key log by law, with the findings of both
   verifications on the archive each took down.

These tests are part of `tests/parity.test.js`, and use its helpers.

    // in tests/parity.test.js:
    <<across: the archives of the tests>>

    <<across: resolution and mirrors>>

    <<across: branches and accepted copies>>

    <<across: drafts, seals and takedowns>>

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
        await both(s, lib, ['mirror', `${await idOf(authors, 'closed')}?${at('authors')}`], { more: s.more, status: 1 });
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
        await paper(s, 'py', authors, 'work', 'three');
        ({ a, b } = await both(s, journal, ['accept', v(3), '--selection', 'issue-1'], { more: s.more }));
        await sameWithSelection(a, b, selection);
        verified(s, b, s.more);
        ok(s.py(['accept', v(3), '--selection', 'issue-1'], { cwd: journal }), 'py accept');
        await both(s, journal, ['accept', v(3), '--selection', 'issue-1'], { more: s.more, status: 1 });
        const accepted = await idOf(journal, 'work');
        ({ a, b } = await both(s, bb, ['branch', `${accepted}/v3?${at('journal')}`, '--label', 'continued'], { more: s.more }));
        await sameArchives(a, b);
        const found = verified(s, a, s.more);
        assert.ok(found.some((f) => /continued: a branch of .*: confirmed/.test(f)), found.join('\n'));
        await both(s, authors, ['branch', `${accepted}/v3?${at('journal')}`, '--label', 'back'], { more: s.more, status: 1 });
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
