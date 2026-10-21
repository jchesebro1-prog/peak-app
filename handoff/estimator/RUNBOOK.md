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
#    Check first with --dry-run: no token, no network. --out must be inside output/ and be empty, missing or
#    an earlier handoff:photos folder (it holds our manifest.json); anything else is refused before a byte is written.
npm run handoff:photos -- --in ~/peak-prod-export.json --out output/peak-estimator-handoff/images --dry-run
BLOB_READ_WRITE_TOKEN=<prod token> npm run handoff:photos -- --in ~/peak-prod-export.json --out output/peak-estimator-handoff/images

# 3. slice the export through the allow-list (writes data/*.js and, with the photo manifest, data/photos.js)
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
