# Catalog Starter-Set Import (#39) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the ~65-item catalog starter set (Lighting Controls, Fixtures, Video Controls, Speakers, Audio Controls, Curtains) into `catalog_parts`, with Jeff's locked review adjustments applied, so The Grid's device palette and #40's client-package generator have real inventory to work with.

**Architecture:** Two small data edits to the already-staged `scripts/starter-import-data.json` (drop 3 rows, add ports to 9 rows using 2 new connection types), one new one-off DB-import script mirroring the existing `scripts/import-catalog.ts` pattern, run against a scratch DB first, then (Jeff's call) the real target.

**Tech Stack:** TypeScript, `tsx` (script runner), PGlite / Postgres via `src/db`, the app's custom `ok()` assertion runner (`npm run test:specs`) — no jest/vitest in this repo.

## Global Constraints

- Every DB-writing script must resolve its target via `resolveDbTarget()` and gate hosted writes via `requireHostedConfirmation()` (`scripts/db-target.ts`) — never write to a hosted DB without an explicit `--yes` flag typed by a human.
- `npm run dev` must be STOPPED before running any import script — PGlite is single-writer on `.data/pglite`.
- Never run an import script against `.data/pglite` for *verification* — use a scratch `PGLITE_PATH` per the project's standing DB-safety convention. Only the final, explicitly-requested real import touches the real target.
- `catalog_parts` writes only happen through `mergeUpsert()` (`src/lib/stores/catalog.ts`) — never hand-write JSONB.
- Locked decisions (do not re-litigate): Draper excluded entirely; 3 unidentified Biamp rows (`Biamp:930-10008-00019`, `Biamp:930-00005-00036`, `Biamp:930-00005-00030`) dropped; ChamSys/Chauvet Professional/Danley/Meyer Sound/Shure rows imported as-is with their `note: "verify price"`-style flags intact; full existing `CONNECTION_TYPES` list kept, no strikes; two new types added (`Network/NDI`, `RF/antenna`).

---

### Task 1: Add the two new connection types

**Files:**
- Modify: `src/lib/catalog-connect.ts:39-67` (`CONNECTION_TYPES`)
- Modify: `scripts/test-review-and-spec.ts` (new assertions near the existing Task 3 block, ~line 140)

**Interfaces:**
- Consumes: nothing new — `CONNECTION_TYPES: readonly string[]`, existing export.
- Produces: `CONNECTION_TYPES` now includes `"Network/NDI"` and `"RF/antenna"`, which Task 2 and the import data reference by exact string.

- [ ] **Step 1: Write the failing assertions**

Add to `scripts/test-review-and-spec.ts` directly after line 140 (`ok(allKnownConnTypes, ...)`):

```ts
ok(CONNECTION_TYPES.includes("Network/NDI"), "connect: CONNECTION_TYPES includes the new Network/NDI type (punch #39 starter-set import)");
ok(CONNECTION_TYPES.includes("RF/antenna"), "connect: CONNECTION_TYPES includes the new RF/antenna type (punch #39 starter-set import)");
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — the two new `ok(...)` calls report `false` (everything else still passes).

- [ ] **Step 3: Add the two connection types**

In `src/lib/catalog-connect.ts`, change the end of the `CONNECTION_TYPES` array (lines 63-67) from:

```ts
  // video
  "HDMI",
  "SDI/BNC",
  "HDBaseT (Cat6a)",
  "fiber",
  // rigging
  "motor power",
  "low-voltage pendant control",
];
```

to:

```ts
  // video
  "HDMI",
  "SDI/BNC",
  "HDBaseT (Cat6a)",
  "fiber",
  // rigging
  "motor power",
  "low-voltage pendant control",
  // network / RF (added 2026-08-07, starter-set import gap — punch #39)
  "Network/NDI",
  "RF/antenna",
];
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS — all assertions including the two new ones report `true`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-connect.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): add Network/NDI and RF/antenna connection types (#39)"
```

---

### Task 2: Back-fill ports on the 9 rows that need the new types

**Files:**
- Modify: `scripts/starter-import-data.json` (9 rows: 4 BirdDog, 3 Matrox, 2 Shure)
- Modify: `scripts/test-review-and-spec.ts` (new assertion block)

**Interfaces:**
- Consumes: `CONNECTION_TYPES` from Task 1 (must already include `Network/NDI`/`RF/antenna` for this task's test to be meaningful).
- Produces: every row in `starter-import-data.json` has a `ports: Port[]` array where every `connectionType` is a real member of `CONNECTION_TYPES` — this is what Task 4's import script trusts without re-validating.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test-review-and-spec.ts`, after Task 1's new assertions:

```ts
/* --- Starter-set import data: every port's connectionType is real (#39) --- */
import { readFileSync } from "node:fs";
import path from "node:path";

const starterSetRaw = JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "starter-import-data.json"), "utf8")) as Array<{ sku: string; ports: Array<{ connectionType: string }> }>;

const allPortTypesKnown = starterSetRaw.every((row) => row.ports.every((p) => CONNECTION_TYPES.includes(p.connectionType)));
ok(allPortTypesKnown, "starter-set: every row's port connectionType is a member of CONNECTION_TYPES");

const birdDogBackfilled = starterSetRaw.find((r) => r.sku === "BirdDog:BDA200")!.ports.some((p) => p.connectionType === "Network/NDI");
ok(birdDogBackfilled, "starter-set: BirdDog:BDA200 has a Network/NDI port after back-fill");

const shureBackfilled = starterSetRaw.find((r) => r.sku === "Shure:AD8CUS")!.ports.some((p) => p.connectionType === "RF/antenna");
ok(shureBackfilled, "starter-set: Shure:AD8CUS has an RF/antenna port after back-fill");
```

`readFileSync`/`path` are not already imported anywhere in `test-review-and-spec.ts` (confirmed by grep before this plan's execution began) — the plain imports above are safe to add as-is, no aliasing needed.

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — `allPortTypesKnown` is `false` (rows exist with `ports: []` that should have entries), and the two SKU-specific checks fail because those SKUs don't have the new ports yet.

- [ ] **Step 3: Edit `scripts/starter-import-data.json`**

Locate each of these 9 objects by `"sku"` and replace their `"ports"` array exactly as shown (every other field on the row is untouched):

`BirdDog:BDA200` — currently `[{"name":"Video Out","direction":"out","connectionType":"SDI/BNC"}]` — add a Network/NDI io port:
```json
[
  { "name": "Video Out", "direction": "out", "connectionType": "SDI/BNC" },
  { "name": "Network (NDI)", "direction": "io", "connectionType": "Network/NDI" }
]
```

`BirdDog:BDP100B` — same pattern:
```json
[
  { "name": "Video Out", "direction": "out", "connectionType": "SDI/BNC" },
  { "name": "Network (NDI)", "direction": "io", "connectionType": "Network/NDI" }
]
```

`BirdDog:BD4KHDMI` — currently `[{"name":"HDMI","direction":"io","connectionType":"HDMI"}]` — add Network/NDI io:
```json
[
  { "name": "HDMI", "direction": "io", "connectionType": "HDMI" },
  { "name": "Network (NDI)", "direction": "io", "connectionType": "Network/NDI" }
]
```

`BirdDog:BDOG4` — currently `[{"name":"SDI In","direction":"in","connectionType":"SDI/BNC","count":4}]` — add Network/NDI io:
```json
[
  { "name": "SDI In", "direction": "in", "connectionType": "SDI/BNC", "count": 4 },
  { "name": "Network (NDI)", "direction": "io", "connectionType": "Network/NDI" }
]
```

`Matrox:MHD/I` — currently `[{"name":"HDMI In","direction":"in","connectionType":"HDMI"}]` — add Network out (streaming encoder output):
```json
[
  { "name": "HDMI In", "direction": "in", "connectionType": "HDMI" },
  { "name": "Network (stream out)", "direction": "out", "connectionType": "Network/NDI" }
]
```

`Matrox:MHDX/I` — same pattern:
```json
[
  { "name": "HDMI In", "direction": "in", "connectionType": "HDMI" },
  { "name": "Network (stream out)", "direction": "out", "connectionType": "Network/NDI" }
]
```

`Matrox:MHLCS/I` — same pattern:
```json
[
  { "name": "HDMI In", "direction": "in", "connectionType": "HDMI" },
  { "name": "Network (stream out)", "direction": "out", "connectionType": "Network/NDI" }
]
```

`Shure:AD8CUS` — currently `[]` — 8-port RF combiner input:
```json
[
  { "name": "RF In", "direction": "in", "connectionType": "RF/antenna", "count": 8 }
]
```

`Shure:ADTQUS=-G57` — currently `[]` — quad RF transmitter output:
```json
[
  { "name": "RF Out", "direction": "out", "connectionType": "RF/antenna", "count": 4 }
]
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/starter-import-data.json scripts/test-review-and-spec.ts
git commit -m "feat(catalog): back-fill Network/NDI and RF/antenna ports on 9 starter-set rows (#39)"
```

---

### Task 3: Drop the 3 unidentified Biamp rows

**Files:**
- Modify: `scripts/starter-import-data.json` (remove 3 objects)
- Modify: `scripts/test-review-and-spec.ts` (extend the assertion block from Task 2)

**Interfaces:**
- Consumes: nothing new.
- Produces: `starter-import-data.json` no longer contains the 3 dropped SKUs; the array length drops by 3 (68 drafted → confirm exact final count as part of this task, since some rows on the drafted list may already differ from the 65 figure quoted in `PUNCHLIST.md` — count what's actually in the file after Task 3, don't assume).

- [ ] **Step 1: Write the failing test**

Append to the same assertion block in `scripts/test-review-and-spec.ts`:

```ts
const droppedBiampSkus = ["Biamp:930-10008-00019", "Biamp:930-00005-00036", "Biamp:930-00005-00030"];
const noDroppedBiamp = droppedBiampSkus.every((sku) => !starterSetRaw.some((r) => r.sku === sku));
ok(noDroppedBiamp, "starter-set: the 3 unidentified Biamp rows are not present after the review drop (#39)");
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — all 3 Biamp SKUs are still present.

- [ ] **Step 3: Remove the 3 rows from `scripts/starter-import-data.json`**

Delete the 3 JSON objects whose `"sku"` is `"Biamp:930-10008-00019"`, `"Biamp:930-00005-00036"`, and `"Biamp:930-00005-00030"` from the array (remember to fix the trailing comma on whichever row becomes the new last item in its group, so the JSON stays valid).

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS. Also run `node -e "console.log(JSON.parse(require('fs').readFileSync('scripts/starter-import-data.json','utf8')).length)"` and record the printed count in the commit message / PUNCHLIST update in Task 5 — this is the real, final item count (not necessarily exactly 65).

- [ ] **Step 5: Commit**

```bash
git add scripts/starter-import-data.json scripts/test-review-and-spec.ts
git commit -m "feat(catalog): drop 3 unidentified Biamp rows from starter set (#39)"
```

---

### Task 4: Write `scripts/import-starter-set.ts`

**Files:**
- Create: `scripts/import-starter-set.ts`
- Modify: `package.json` (`"scripts"` block)

**Interfaces:**
- Consumes: `mergeUpsert(sku: string, part: Omit<CatalogPart, "id">): Promise<...>` from `src/lib/stores/catalog.ts` (existing, used unchanged); `resolveDbTarget`/`requireHostedConfirmation` from `scripts/db-target.ts` (existing, used unchanged); reads `scripts/starter-import-data.json` (as edited by Tasks 2-3).
- Produces: a runnable script `npx tsx scripts/import-starter-set.ts [--yes]`, mirroring `scripts/import-catalog.ts`'s exact shape so any future catalog-import script that lands here follows the same pattern.

- [ ] **Step 1: Write the script (no test — this is a one-off DB script; Step 3 is its verification)**

```ts
/**
 * One-off: import the reviewed catalog starter set (punch #39, beta build-out).
 *
 *   npm run dev must be STOPPED first (PGlite is single-writer on .data/pglite).
 *   npx tsx scripts/import-starter-set.ts
 *
 * Reads scripts/starter-import-data.json — the reviewed starter set (Draper
 * excluded, 3 unidentified Biamp rows dropped, verify-flagged manufacturers
 * kept as-is, Network/NDI + RF/antenna ports back-filled — PUNCHLIST.md #39,
 * resolved 2026-08-07). Rows go through mergeUpsert, so re-running re-prices
 * existing SKUs in place while preserving fields this file doesn't carry
 * (datasheet attachments, spec text). Safe to re-run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../src/db";
import { mergeUpsert, type CatalogPart } from "../src/lib/stores/catalog";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";

type ImportPart = Omit<CatalogPart, "id">;

async function main() {
  const { hosted } = resolveDbTarget("catalog starter-set import");
  requireHostedConfirmation(hosted, process.argv);
  await getDb(); // ensure DB is up + migrated before upserting
  const file = path.join(process.cwd(), "scripts", "starter-import-data.json");
  const parts: ImportPart[] = JSON.parse(readFileSync(file, "utf8"));
  console.log(`Importing ${parts.length} starter-set catalog parts…`);

  let n = 0;
  let flagged = 0;
  for (const p of parts) {
    await mergeUpsert(p.sku, p);
    n++;
    if (p.note) flagged++;
  }
  console.log(`Done. Upserted ${n} parts (${flagged} carry a review-flag note).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, inside `"scripts"`, add a line alongside the existing script entries (e.g. near any other one-off `tsx scripts/...` entry):

```json
    "import:starter-set": "tsx scripts/import-starter-set.ts",
```

- [ ] **Step 3: Verify against a scratch DB (never `.data/pglite`)**

```bash
PGLITE_PATH=/tmp/peak-scratch-starter-set npx tsx scripts/import-starter-set.ts
```

Expected output ends with `Done. Upserted <N> parts (<M> carry a review-flag note).` where `N` matches the count recorded in Task 3 Step 4, with no thrown errors.

Then confirm the parts actually landed:

```bash
PGLITE_PATH=/tmp/peak-scratch-starter-set node -e "
require('ts-node/register');
" 2>/dev/null; PGLITE_PATH=/tmp/peak-scratch-starter-set npx tsx -e "
import { search } from './src/lib/stores/catalog';
search({ q: 'ETC:ION XE 2K-US' }).then((r) => console.log(JSON.stringify(r, null, 2)));
"
```

Expected: the ETC Ion Xe console row is found with its full `ports` array intact.

Clean up the scratch dir afterward: `rm -rf /tmp/peak-scratch-starter-set`.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-starter-set.ts package.json
git commit -m "feat(catalog): add scripts/import-starter-set.ts (#39)"
```

---

### Task 5: Run the real import and close out #39

**Files:**
- Modify: `PUNCHLIST.md` (#39 status line)

**Interfaces:**
- Consumes: everything above.
- Produces: the starter set is live in whichever DB `DATABASE_URL`/local PGlite resolves to when this task is actually run by a human (this step is NOT something an agent should run unattended against a hosted target — `requireHostedConfirmation` exists specifically to force a human decision here).

- [ ] **Step 1: Run the import against the real target**

```bash
npm run import:starter-set
```

If `resolveDbTarget` reports `HOSTED (DATABASE_URL)`, the script will refuse and print the `--yes` instructions — re-run as `npm run import:starter-set -- --yes` only after confirming a backup was taken (`DATABASE_URL=... npm run db:export`), per the script's own gate. If it reports `LOCAL PGlite (.data/pglite)`, it runs immediately — this writes into the real dev database (not a scratch one), which is the intended outcome for this final task only.

- [ ] **Step 2: Spot-check in the app**

Start the dev server (`npm run dev`), open `/catalog`, filter by each of the six groups (Lighting Controls, Fixtures, Video Controls, Speakers, Audio Controls, Curtains), and confirm the new rows appear with the expected manufacturer counts. Open `/design/grid/<any project>` and confirm the device palette's group filters now show the new parts.

- [ ] **Step 3: Update PUNCHLIST.md**

Change #39's status line from `IMPORT APPROVED 2026-08-07 — decisions locked, not yet executed; queued as the first build task ahead of #38/#40/#41` to `DONE 2026-08-07 — <N> items imported (see scripts/import-starter-set.ts)`, filling in the actual `N` from Task 4's verification run.

- [ ] **Step 4: Commit**

```bash
git add PUNCHLIST.md
git commit -m "docs: close #39 — starter-set catalog import complete"
```

## Self-Review Notes

- **Spec coverage:** All 4 locked decisions from the planning pass (Draper out, Biamp dropped, verify-flagged mfrs kept, 2 new connection types + back-fill) map to Tasks 1-3. Task 4 covers the missing "how does this actually get into the DB" piece the spec didn't need to answer (mirrors an existing script). Task 5 is the real-target execution + PUNCHLIST close-out.
- **Sequencing:** This plan has no dependency on the other two plans and should run first — both #38+#41 and #40 benefit from (but don't strictly require) the palette/attachments this populates.
