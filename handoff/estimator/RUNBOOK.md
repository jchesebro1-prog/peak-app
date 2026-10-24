# Estimator handoff — production run (for Peak; never shipped)

This runbook is for Peak, producing the package. It is **not** part of the package: `handoff:build` copies
only `handoff/estimator/spec/{README,data-model,pricing,ports}.md` into `spec/`, and the package audit fails
on any file outside the package layout. PUNCHLIST #361 carries the same checklist.

The export and everything cut from it are **confidential and stay on Jeff's machine**: the export file
(`~/peak-prod-export.json`) is as sensitive as the database, and `output/` is git-ignored. Nothing here is
ever committed, uploaded or emailed, and the Artifact is published only on Jeff's go-ahead. Run from the
repository root, in this order:

```bash
# 1. production export (format 2 — includes the customer tables)
DATABASE_URL=<prod> OUT=~/peak-prod-export.json npm run db:export

# 2. product photos from the private Blob store (needs the production token in this shell only).
#    Only the parts the recent Estimator estimates and the assemblies use (--recent-days, default 28 — see "The window").
#    Check first with --dry-run: no token, no network. --out must be inside output/ and be empty, missing or
#    an earlier handoff:photos folder (it holds our manifest.json); anything else is refused before a byte is written.
npm run handoff:photos -- --in ~/peak-prod-export.json --out output/peak-estimator-handoff/images --dry-run
BLOB_READ_WRITE_TOKEN=<prod token> npm run handoff:photos -- --in ~/peak-prod-export.json --out output/peak-estimator-handoff/images

# 3. slice the export through the allow-list (writes data/*.js and, with the photo manifest, data/photos.js).
#    Pass the SAME --recent-days as step 2 (default 28 — see "The window" below).
npm run handoff:slice -- --in ~/peak-prod-export.json --out output/peak-estimator-handoff/data

# 4. bundle (the audit fails on a private Blob path, a secret, a stray file or a file over 15,000,000 bytes)
npm run handoff:build

# 5. verify, STRICT: no --allow-missing-features. The slice must hold an alternate, a rack line,
#    a curtain + track pair and bonus lines, or --full fails. --full writes the zip only on a pass.
npm run handoff:verify -- --drift --parity --export ~/peak-prod-export.json --full

# 6. every estimate through every step, from file:// and over http (the Artifact path)
npm run handoff:verify -- --smoke --all-steps
npm run handoff:verify -- --serve
```

Do **not** pass `--extra-estimates` to the slicer (dev only).

**The window (what the package holds).** The package is a recent sample (Jeff, Oct 20): only **Estimator**
estimates (a live system quote with at least one line whose `source` is `estimator` or empty — not Grid,
Quick Design, inbox-made, Daylite or portal quotes) whose `updatedAt` (else `createdAt`) is within
**28 days** of the export's own `meta.exportedAt` — the clock is never read, so re-slicing the same export
gives the same package. The catalog is trimmed to match: the parts on those estimates, **every assembly**
and its members, the parts the shipped rules blobs name (track series, curtain mounts, system categories,
rack defaults), every curtain fabric the picker offers, every Labor part, and rename stubs for those
(`selectCatalogScope` in `slice-rules.ts`). The slice and the photos fetch print the window and the
selection (id, number, name, customer, updated date per estimate; catalog count and why).

- `--recent-days <n>` (1 – 3650, default 28) is accepted by **both** `handoff:photos` and `handoff:slice`
  and they share one function, so pass the same value to both or the photo set won't match the data
  (the slicer then warns about parts with no downloaded photo). To widen to eight weeks add
  `--recent-days 56` to steps 2 and 3.
- No estimate in the window, or no `exportedAt` in the export, is a refusal that names the window and
  writes nothing (exit 1 and 2).
- **Strict verify (step 5) needs examples.** `--full` still fails when the slice has no alternate, rack
  line, curtain + track pair or bonus lines, and a four-week sample may lack one. Widen `--recent-days`
  (re-run steps 2–5), or accept a missing example and say so (`--allow-missing-features`); `--full` is
  not relaxed for you.

**Dev rehearsal** (never production data). The local dev book is old and thin: its quotes are usually
outside 28 days, so widen the window and, if you want an alternate and bonus lines, add the golden
fixtures. Work on a COPY of `.data/pglite` (never open the live one while a dev server or script may hold
it):

```bash
cp -R .data/pglite /tmp/pglite-rehearsal
PGLITE_PATH=/tmp/pglite-rehearsal OUT=/tmp/dev-export.json npm run db:export
npm run handoff:slice -- --in /tmp/dev-export.json --out output/peak-estimator-handoff/data \
  --recent-days 3650 --extra-estimates docs/estimating-core/golden-fixtures/export.json
npm run handoff:build
npm run handoff:verify -- --drift --parity --export /tmp/dev-export.json --export docs/estimating-core/golden-fixtures/export.json --full --allow-missing-features
npm run handoff:verify -- --smoke --all-steps
```

The dev book has no assemblies and the trimmed catalog is tiny (the fabric and Labor parts plus what the
estimates name), so `--full` reports the missing rack and curtain + track examples (allowed here) and
`--catalog` stops with "needs the full slice" (it wants at least 200 parts). The golden fixtures are not in
the dev export, so `--parity` is given both exports. Move `output/peak-estimator-handoff` aside afterwards
(for example to `output/_dev-rehearsal-recent/`) so the production run starts from a clean folder.

**Time.** `--smoke --all-steps` and `--serve` walk **every** bundled estimate through every step and tab
(about a dozen views each, a few seconds a view), so on a production book of hundreds of estimates they take
a long while — an hour or more. `--full` walks only its 20-estimate sample (one per feature first); if
the full walk is impractical, rely on `--full`'s sample and say so in the report, but expect the time
and prefer running it.

**Artifact path.** `--serve` serves exactly the files the zip carries (never `images/manifest.json`, which is
handoff:photos' workspace file and never ships) on `127.0.0.1`, opens `index.html?v=1` (a host adds a query
string), and runs `--smoke --all-steps` plus the fonts check (Public Sans / IBM Plex Mono computed, also with
`<html>`'s attributes stripped, as a host that rewrites `<html>` would).

**File count.** One Artifact publish carries at most 255 files and one Artifact version at most 511. The
build and `--full` print the package's file count and warn past 255 (publish in several passes to the same
Artifact) and loudly past 511 (the package cannot be one Artifact; ship the zip, or bundle fewer photos).
The zip has no such limit. Photos are the only thing that grows the count (one file per bundled photo).

Then Claude reads the verify report, the screenshots in `spec/screenshots/` and the golden files, and only
then does `output/peak-estimator-handoff.zip` go to Jeff. Re-run `--drift` after every merge from main (a
changed original needs its port re-checked and `--drift --update <port>` for that entry; a runtime module
that says it ports a `src/` module but has no entry in `port-sources.json` fails `--drift` too).
