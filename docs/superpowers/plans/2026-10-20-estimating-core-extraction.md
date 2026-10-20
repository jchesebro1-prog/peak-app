# Estimating-core Extraction (Handoff PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Estimator's pricing domain into one browser-pure library, `src/lib/estimating-core/`. Guard it with a purity gate (`npm run core:check`) and golden totals (`npm run core:golden`), with no change in how Quartzite behaves.

**Architecture:**
- The persisted domain types and 12 pure helper files move out of the route folder `src/app/(app)/estimator/` into `src/lib/estimating-core/`.
- Each old path keeps a one-line `export *` shim, so none of the ~400 existing importers change.
- Three type-only edges that drag the database and the UI into the closure are cut.
- A TypeScript-API gate walks the core's import closure (value and type imports) from `index.ts` and refuses stores, the database, route folders, React and server packages.
- Golden totals, taken from the untouched code before the move, prove nothing changed.

**Tech Stack:** Next.js 16 / TypeScript 5 (`typescript` compiler API), tsx scripts, the `scripts/test-review-and-spec.ts` harness (`ok(cond, msg)`), Python 3 for the one-off codemods.

**Spec:** `docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md` (§3 engine extraction, §6 verification). This is **Plan 1 of 2**. Plan 2 (slicer, prototype UI, package docs, verification, zip) is written after this PR merges, against the core's final API. Facts for Plan 2 are at the end.

**Pre-verified:** every codemod, the gate and the golden generator below were run end-to-end on a throwaway worktree of `origin/main` @ `1c20c3f8`. Results:
- gate PASS: 82 files, 0 violations
- golden fixtures match the pre-move code to the cent
- `tsc`: 0 new errors
- `eslint` on all 52 touched files: 0 problems

If `origin/main` has moved since, an `assert` in a codemod fails loudly instead of silently mis-editing.

## Global Constraints

- **No behaviour change.** Golden totals before and after must be byte-identical (fixtures + the local dev database).
- **Old import paths keep working.** Every moved file leaves `export * from "@/lib/estimating-core/<name>";` at its old path. Re-pointing other importers is out of scope.
- **Core purity** (spec §3): nothing reachable from `src/lib/estimating-core/index.ts` may be under `src/db/`, `src/lib/stores/`, `src/app/`, `src/components/`, be `*-server.ts(x)` or `.tsx`, or come from `next`, `react`, `react-dom`, `server-only`, `drizzle-orm`, `@electric-sql/pglite`, `@neondatabase/serverless`, `pg`, `@vercel/blob`, `@sparticuz/chromium`, `puppeteer-core`, `docx`, `pdf-lib`, `sharp`, `googleapis`, `@anthropic-ai/sdk`, `next-auth` (or their `@types/*`).
- **The dev database is single-process** (AGENTS.md). Never open `~/Downloads/peak-app/.data/pglite` directly. Copy it and point `PGLITE_PATH` at the copy, with no dev server or `tsx` running.
- **Never `git stash`**: the stash is shared across worktrees. Commit instead.
- **Don't push or open a PR** until Jeff says so.
- **Verification gate** (memory `peak-verification-gate-protocol`): `tsc`, `test:specs` (report base + new PASS), `test:smoke`, `eslint`, `next build`. Report real numbers.
- **D-/punch-/phase numbers are recomputed against `origin/main` right before the docs commit.** At planning time the next free ones were D1228, #359 and phase 66.

## File structure

**Created**
| File | Responsibility |
|---|---|
| `src/lib/estimating-core/index.ts` | The one public entry. Flat exports for the moved domain, namespaced exports for pure `src/lib` modules in the closure. |
| `src/lib/estimating-core/types.ts` | Persisted domain types: `SpecItem`, `SpecSection`, configurator drafts, `FabricOpt`, `TravelLite`, `PAYMENT_TERMS`. |
| `src/lib/estimating-core/{pricing,estimator-data,tier-reprice,labor-group,labor-defaults,track-bom,curtain-line,fixture-bom,freight-default,catalog-rank,copy-system,narrative}.ts` | Moved verbatim (`git mv`). `pricing.ts` also gains `systemPrintsInBody`. |
| `src/lib/design/quick-types.ts` | Quick Design's shared vocabulary (`SysKey`, `TierKey`, `BomItem`, `SystemBlock`, …), out of a route file. |
| `src/lib/estimate-output/response-types.ts` | `ClientResponse` / `ClientResponseKind`, without the customer-document import. |
| `scripts/core-check.ts` | The purity gate: CLI + `coreCheckChecks(ok)`. |
| `scripts/estimating-golden.ts` | Golden totals: CLI + `goldenChecks(ok)`. |
| `docs/estimating-core/golden-fixtures/export.json` | Six synthetic quotes in `db:export` shape. |
| `docs/estimating-core/golden/Q-G00{1,2,3}.json` | Their committed golden totals. |

**Modified**
- `src/app/(app)/estimator/types.ts`: keeps the page/view types and re-exports the core types.
- 12 route files under `src/app/(app)/estimator/` become one-line shims.
- `src/app/(app)/estimator/quote-document-view.ts`: re-exports `systemPrintsInBody`.
- `src/app/(app)/design/quick/engine.ts`: re-exports the quick types.
- `src/lib/estimate-output/responses.ts`: re-exports the response types.
- `src/lib/fixture-assemblies.ts`: a local structural `CatalogPart`.
- 12 `src/lib` closure files are repointed at `@/lib/estimating-core/*`.
- 5 `src/lib/design/*` files import `@/lib/design/quick-types`.
- `scripts/test-review-and-spec.ts`: wires both checks.
- `package.json`: adds `core:check` and `core:golden`.
- `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`.

Codemods live in `.data-golden/codemods/`, which `.gitignore`'s `.data-*/` rule ignores; they are never committed. Local golden runs go in `.data-golden/` too.

---

### Task 0: Workspace and baselines

**Files:** none committed.

- [ ] **Step 1: Branch from the spec branch.** The worktree `/Users/sm/Downloads/peak-app-handoff` is on `spec/estimator-handoff`, which holds the spec and this plan.

```bash
cd /Users/sm/Downloads/peak-app-handoff
git fetch -q origin
git log --oneline -1 origin/main
git switch -c feat/estimating-core
git rebase origin/main   # spec + plan commits on top of current main; docs only, should be clean
```

- [ ] **Step 2: Install dependencies.** Memory `worktree-missing-gitignored-files`: run `npm ci` and never symlink. Copy `next-env.d.ts` and `.env.local` only after checking `.env.local` has no `DATABASE_URL`.

```bash
cd /Users/sm/Downloads/peak-app-handoff
df -h . | tail -1                      # need a few GB free
npm ci
cp ../peak-app/next-env.d.ts .
grep -c -E '^\s*DATABASE_URL\s*=' ../peak-app/.env.local   # must print 0 — otherwise STOP and ask Jeff
cp ../peak-app/.env.local .env.local
```

- [ ] **Step 3: Record baselines.** Write the numbers down; Task 5 compares against them.

```bash
cd /Users/sm/Downloads/peak-app-handoff
npx tsc --noEmit -p tsconfig.json; echo "tsc exit $?"            # expect exit 0
npm run test:specs 2>&1 | tail -5                                 # record the PASS / FAIL counts (FAIL must be 0)
npm run lint 2>&1 | tail -3                                       # record the error / warning counts
```

Expected: tsc exit 0; test:specs `N PASS, 0 FAIL`. Record N and the lint counts.

---

### Task 1: Golden totals: the before picture

**Files:**
- Create: `scripts/estimating-golden.ts`
- Create: `docs/estimating-core/golden-fixtures/export.json`
- Create: `docs/estimating-core/golden/Q-G001.json`, `Q-G002.json`, `Q-G003.json` (generated)
- Modify: `scripts/test-review-and-spec.ts` (import near the `./test-assessments` import; chain after `assessmentDbChecks`)
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `lineExtSellOf`, `systemSellTotal`, `totals`, `QuoteTotals` from `@/app/(app)/estimator/pricing`; `SpecSection` from `@/app/(app)/estimator/types` (pre-move paths; Task 5 switches them).
- Produces:
  - `systemQuotesOf(file: ExportFile): SystemQuote[]`, `goldenFor(q: SystemQuote): GoldenQuote`
  - `writeGolden(file, dir): number`, `checkGolden(file, dir): string[]` (`[]` = identical)
  - `goldenChecks(ok: Ok): Promise<void>`
  - CLI `npm run core:golden -- --in <export.json> (--out <dir> | --check <dir>)`
  - Plan 2's bundle-parity test reuses `goldenFor` and `checkGolden`.

- [ ] **Step 1: Write the fixture export.** Create `docs/estimating-core/golden-fixtures/export.json`:

```json
{
  "meta": { "app": "Peak Backend", "format": 1, "source": "golden-fixture (estimator handoff, spec 2026-10-20 §6)" },
  "collections": {
    "quotes": [
      {
        "id": "Q-G001", "deleted": false,
        "doc": { "quoteType": "system", "estNo": 9001, "spec": { "sections": [
          { "id": "s1", "name": "Stage lighting", "kind": "lighting", "mfr": "ETC", "freightPct": 5, "items": [
            { "id": 1, "sku": "ETC:CS15", "desc": "ColorSource 15 fixture", "qty": 4, "unit": "ea", "cost": 900, "price": 1250 },
            { "id": 2, "sku": "LABOR", "desc": "Install labor", "qty": 16, "unit": "hr", "cost": 55, "price": 95, "labor": true },
            { "id": 3, "sku": "ETC:IONXE", "desc": "Ion Xe console", "qty": 1, "unit": "ea", "cost": 9000, "price": 12500, "option": true }
          ] }
        ] } }
      },
      {
        "id": "Q-G002", "deleted": false,
        "doc": { "quoteType": "system", "estNo": 9002, "spec": { "sections": [
          { "id": "s1", "name": "Main curtain", "kind": "curtains", "mfr": "", "freightPct": 0, "items": [
            { "id": 1, "sku": "CUSTOM", "desc": "Main drape, IFR velour", "qty": 1, "unit": "ea", "cost": 6400, "price": 9100, "custom": true }
          ] },
          { "id": "s2", "name": "Motorized main (alternate)", "kind": "rigging", "mfr": "", "freightPct": 3, "alternate": true, "items": [
            { "id": 1, "sku": "CUSTOM", "desc": "Motorized traveler", "qty": 1, "unit": "ea", "cost": 7200, "price": 10400, "custom": true }
          ] }
        ] } }
      },
      {
        "id": "Q-G003", "deleted": false,
        "doc": { "quoteType": "system", "estNo": 9003, "spec": { "sections": [
          { "id": "s1", "name": "Audio", "kind": "av", "mfr": "", "freightPct": 4, "priceRound": 25, "items": [
            { "id": 1, "sku": "Symetrix:Jupiter 4", "desc": "DSP", "qty": 2, "unit": "ea", "cost": 1100, "price": 1540 },
            { "id": 2, "sku": "CUSTOM", "desc": "Cable package", "qty": 1, "unit": "ea", "cost": 800, "price": 1150, "custom": true, "extSellOverride": 1200 },
            { "id": 3, "sku": "LABOR", "desc": "Install labor", "qty": 24, "unit": "hr", "cost": 55, "price": 95, "labor": true },
            { "id": 4, "sku": "BONUS-PKG", "desc": "Package bonus", "qty": 1, "unit": "ea", "cost": 260, "price": 364, "bonus": "package", "bonusPct": 5 },
            { "id": 5, "sku": "BONUS-EST", "desc": "Estimator bonus", "qty": 1, "unit": "ea", "cost": 128, "price": 128, "bonus": "estimator", "bonusPct": 2 }
          ] }
        ] } }
      },
      {
        "id": "Q-G004", "deleted": true,
        "doc": { "quoteType": "system", "estNo": 9004, "spec": { "sections": [
          { "id": "s1", "name": "Deleted", "kind": "lighting", "mfr": "", "freightPct": 0, "items": [
            { "id": 1, "sku": "X", "desc": "x", "qty": 1, "unit": "ea", "cost": 1, "price": 2 }
          ] }
        ] } }
      },
      {
        "id": "Q-G005", "deleted": false,
        "doc": { "quoteType": "flame_test", "estNo": 9005, "spec": { "sections": [
          { "id": "s1", "name": "Not a system quote", "kind": "lighting", "mfr": "", "freightPct": 0, "items": [
            { "id": 1, "sku": "X", "desc": "x", "qty": 1, "unit": "ea", "cost": 1, "price": 2 }
          ] }
        ] } }
      },
      {
        "id": "Q-G006", "deleted": false,
        "doc": { "quoteType": "system", "estNo": 9006, "spec": { "sections": [
          { "id": "s1", "name": "Empty", "kind": "lighting", "mfr": "", "freightPct": 0, "items": [] }
        ] } }
      }
    ]
  }
}
```

- [ ] **Step 2: Wire the failing harness check.** In `scripts/test-review-and-spec.ts`, directly after the line `import { assessmentChecks, assessmentDbChecks } from "./test-assessments";` add:

```ts
import { goldenChecks } from "./estimating-golden";
```

Then, in the `.then` chain, replace the line `  .then(() => assessmentChecks(ok)).then(() => assessmentDbChecks(ok))` with:

```ts
  .then(() => assessmentChecks(ok)).then(() => assessmentDbChecks(ok))
  .then(() => goldenChecks(ok))
```

- [ ] **Step 3: Run it to verify it fails.**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the run fails with `Cannot find module './estimating-golden'`.

- [ ] **Step 4: Write `scripts/estimating-golden.ts`.**

```ts
/**
 * core:golden — golden totals for Estimator system quotes (estimator handoff,
 * spec docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md §6).
 *
 * Prices every live system quote in a db:export file with the Estimator's own
 * pricing and writes one JSON per quote: per-system sell, per-line extended
 * sell, and totals(). The same files prove the engine move changed nothing
 * (PR 1) and that the handoff prototype prices to the cent (PR 2).
 *
 *   npm run core:golden -- --in <export.json> --out <dir>     write <quoteId>.json files
 *   npm run core:golden -- --in <export.json> --check <dir>   recompute, compare byte for byte
 *   test:specs → goldenChecks(ok) over docs/estimating-core/golden-fixtures + golden
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { lineExtSellOf, systemSellTotal, totals, type QuoteTotals } from "@/app/(app)/estimator/pricing";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { Ok } from "./test-inbox-org";

/** use-estimator-state.ts TAX_RATE_PCT — the Estimator prices with no tax. */
export const GOLDEN_TAX_RATE_PCT = 0;
export const FIXTURE_EXPORT = "docs/estimating-core/golden-fixtures/export.json";
export const FIXTURE_GOLDEN = "docs/estimating-core/golden";

type ExportRow = { id: string; doc?: unknown; deleted?: boolean | null };
export type ExportFile = { collections?: { quotes?: ExportRow[] } };
export type SystemQuote = { id: string; estNo: number | null; sections: SpecSection[] };
export type GoldenQuote = {
  id: string;
  estNo: number | null;
  systems: Array<{
    id: string;
    name: string;
    alternate: boolean;
    sell: number;
    lines: Array<{ id: number; sku: string; ext: number }>;
  }>;
  totals: QuoteTotals;
};

/** Live system quotes with at least one line, sorted by id. */
export function systemQuotesOf(file: ExportFile): SystemQuote[] {
  const out: SystemQuote[] = [];
  for (const row of file.collections?.quotes ?? []) {
    if (row.deleted) continue;
    const doc = (row.doc ?? {}) as { quoteType?: string; estNo?: unknown; spec?: { sections?: unknown } };
    if ((doc.quoteType ?? "system") !== "system") continue;
    const sections = doc.spec?.sections;
    if (!Array.isArray(sections)) continue;
    const secs = sections as SpecSection[];
    if (!secs.some((s) => Array.isArray(s.items) && s.items.length > 0)) continue;
    out.push({ id: row.id, estNo: typeof doc.estNo === "number" ? doc.estNo : null, sections: secs });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function goldenFor(q: SystemQuote): GoldenQuote {
  return {
    id: q.id,
    estNo: q.estNo,
    systems: q.sections.map((s) => ({
      id: s.id,
      name: s.name,
      alternate: s.alternate === true,
      sell: systemSellTotal(s),
      lines: (s.items ?? []).map((it) => ({ id: it.id, sku: it.sku, ext: lineExtSellOf(it) })),
    })),
    totals: totals(q.sections, GOLDEN_TAX_RATE_PCT),
  };
}

export const goldenFileName = (id: string) => `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
export const goldenJson = (g: GoldenQuote) => JSON.stringify(g, null, 2) + "\n";

export function writeGolden(file: ExportFile, dir: string): number {
  fs.mkdirSync(dir, { recursive: true });
  const quotes = systemQuotesOf(file);
  for (const q of quotes) fs.writeFileSync(path.join(dir, goldenFileName(q.id)), goldenJson(goldenFor(q)));
  return quotes.length;
}

/** Problems found comparing a fresh run against `dir`; [] = identical. */
export function checkGolden(file: ExportFile, dir: string): string[] {
  const problems: string[] = [];
  const expected = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : []);
  for (const q of systemQuotesOf(file)) {
    const name = goldenFileName(q.id);
    if (!expected.has(name)) { problems.push(`${name}: no golden file`); continue; }
    expected.delete(name);
    if (fs.readFileSync(path.join(dir, name), "utf8") !== goldenJson(goldenFor(q))) problems.push(`${name}: totals differ`);
  }
  for (const extra of expected) problems.push(`${extra}: golden file has no matching quote`);
  return problems;
}

const readExport = (p: string) => JSON.parse(fs.readFileSync(p, "utf8")) as ExportFile;

export async function goldenChecks(ok: Ok) {
  const file = readExport(FIXTURE_EXPORT);
  const quotes = systemQuotesOf(file);
  ok(quotes.map((q) => q.id).join(",") === "Q-G001,Q-G002,Q-G003",
    "core:golden: only live system quotes with lines (deleted, flame-test and empty quotes skipped)");
  const problems = checkGolden(file, FIXTURE_GOLDEN);
  ok(problems.length === 0, `core:golden: fixture totals match ${FIXTURE_GOLDEN}` + (problems.length ? ` — ${problems.join("; ")}` : ""));
  const alt = goldenFor(quotes[1]);
  ok(alt.totals.alt === alt.systems[1].sell && alt.totals.rev === alt.systems[0].sell,
    "core:golden: an alternate system prices into totals.alt only, never rev");
}

if (process.argv[1]?.endsWith("estimating-golden.ts")) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const input = arg("--in"), out = arg("--out"), check = arg("--check");
  if (!input || (!out && !check)) {
    console.error("usage: npm run core:golden -- --in <export.json> (--out <dir> | --check <dir>)");
    process.exit(2);
  }
  const file = readExport(input);
  if (out) {
    console.log(`wrote ${writeGolden(file, out)} golden file(s) to ${out}`);
  } else {
    const problems = checkGolden(file, check!);
    if (problems.length) { console.error(`${problems.length} golden mismatch(es):\n  ${problems.join("\n  ")}`); process.exit(1); }
    console.log(`all ${systemQuotesOf(file).length} quote(s) match ${check}`);
  }
}
```

- [ ] **Step 5: Add the npm script.** In `package.json` `"scripts"`, after `"test:smoke": "tsx scripts/smoke-routes.ts",` add:

```json
    "core:golden": "tsx scripts/estimating-golden.ts",
```

- [ ] **Step 6: Generate the fixture goldens from the untouched code.**

Run: `npm run core:golden -- --in docs/estimating-core/golden-fixtures/export.json --out docs/estimating-core/golden`
Expected: `wrote 3 golden file(s) to docs/estimating-core/golden`.

Sanity-check them:
```bash
python3 -c "import json;[print(f, json.load(open('docs/estimating-core/golden/'+f))['totals']['grand']) for f in ['Q-G001.json','Q-G002.json','Q-G003.json']]"
```
Expected: `Q-G001.json 6744`, `Q-G002.json 9100`, `Q-G003.json 7250`. `Q-G002.json` also has `"alt": 10616` in its totals.

- [ ] **Step 7: Run the harness to verify it passes.**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: `N+3 PASS, 0 FAIL`.

- [ ] **Step 8: Capture the real-data "before" from a copy of the dev database.** It isn't committed: it holds real Peak quotes.

```bash
cd /Users/sm/Downloads/peak-app-handoff
ps aux | grep -E "next dev|next-server|tsx " | grep -v grep   # must print nothing touching peak-app; if it does, STOP
mkdir -p .data-golden
cp -R ../peak-app/.data/pglite .data-golden/pglite-copy
PGLITE_PATH=.data-golden/pglite-copy OUT=.data-golden/local-export.json npm run db:export
npm run core:golden -- --in .data-golden/local-export.json --out .data-golden/before
```
Expected:
- `Backup written: …/.data-golden/local-export.json`
- `wrote K golden file(s) to .data-golden/before`, with K > 0. Record K.

`git status --short` must show no `.data-golden` entries; it's ignored by `.data-*/`.

- [ ] **Step 9: Commit.**

```bash
git add scripts/estimating-golden.ts docs/estimating-core package.json scripts/test-review-and-spec.ts
git commit -m "test(estimating-core): golden totals for Estimator system quotes (before the move)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Split the Estimator's domain types into estimating-core

**Files:**
- Create: `src/lib/estimating-core/types.ts`
- Modify: `src/app/(app)/estimator/types.ts`

**Interfaces:**
- Produces: `@/lib/estimating-core/types` exports `PAYMENT_TERMS`, `PaymentTerms`, `SpecMob`, `LaborTravelKind`, `LaborGroupRecord`, `SpecItem`, `KeyProduct`, `SpecSection`, `CustomDraft`, `CurtainDraft`, `TrackDraft`, `TrackPart`, `FixtureDraft`, `MobDraft`, `LaborDraft`, `FabricOpt`, `TravelLite`. Its only imports are `AssemblyRole` (`@/lib/fixture-assemblies`), `CurtainRequest` (`@/lib/portal-cart-types`), `TrackConfig` (`@/lib/track-engine`), `TrackMounting` and `TrackOperation` (`@/lib/track-series`).
- `@/app/(app)/estimator/types` still exports every name it exported before, through `export * from "@/lib/estimating-core/types"`.

- [ ] **Step 1: Write the codemod** to `.data-golden/codemods/split-types.py`:

```python
#!/usr/bin/env python3
"""Estimator handoff, PR 1 — split src/app/(app)/estimator/types.ts.

The persisted pricing domain (spec shapes + configurator drafts) moves to
src/lib/estimating-core/types.ts; the page/view types stay in the route file,
which re-exports the core so its 300+ importers keep working. Run from the
repo root. Idempotent guard: refuses if the core file already exists."""
import os, re, sys

RT = "src/app/(app)/estimator/types.ts"
CORE = "src/lib/estimating-core/types.ts"
CORE_NAMES = [
    "PAYMENT_TERMS", "PaymentTerms", "SpecMob", "LaborTravelKind", "LaborGroupRecord", "SpecItem",
    "KeyProduct", "SpecSection", "CustomDraft", "CurtainDraft", "TrackDraft", "TrackPart",
    "FixtureDraft", "MobDraft", "LaborDraft", "FabricOpt", "TravelLite",
]
CORE_IMPORTS = [
    'import type { AssemblyRole } from "@/lib/fixture-assemblies";',
    'import type { CurtainRequest } from "@/lib/portal-cart-types";',
    'import type { TrackConfig } from "@/lib/track-engine";',
    'import type { TrackMounting, TrackOperation } from "@/lib/track-series";',
]

if os.path.exists(CORE):
    sys.exit(f"{CORE} already exists — split already done")
lines = open(RT).read().split("\n")
decls = [(i, m.group(1)) for i, l in enumerate(lines)
         if (m := re.match(r"export (?:type|const|function) (\w+)", l))]

def block_start(i):
    j = i
    while j > 0 and re.match(r"\s*(/\*\*|\*|\*/|//)", lines[j - 1]):
        j -= 1
    return j

starts = [block_start(i) for i, _ in decls]
blocks = []
for k, (_, name) in enumerate(decls):
    end = starts[k + 1] if k + 1 < len(decls) else len(lines)
    blocks.append((name, lines[starts[k]:end]))
preamble = lines[:starts[0]]

missing = [n for n in CORE_NAMES if n not in {n for n, _ in blocks}]
if missing:
    sys.exit(f"core names not found in {RT}: {missing}")

def code(text):
    return re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", text)

core_body = [l for n, b in blocks if n in CORE_NAMES for l in b]
route_blocks = [(n, b) for n, b in blocks if n not in CORE_NAMES]
route_code = code("\n".join(l for _, b in route_blocks for l in b))

header = [
    "/**",
    " * The Estimator's persisted pricing domain: the spec shapes saved on",
    " * quote.spec ({ sections, mobs }) and the configurator drafts the pricing",
    " * helpers read. Moved here from src/app/(app)/estimator/types.ts (estimator",
    " * handoff, spec 2026-10-20 §3); that file re-exports everything below.",
    " * Must stay browser-pure: `npm run core:check`.",
    " */",
]
os.makedirs(os.path.dirname(CORE), exist_ok=True)
open(CORE, "w").write("\n".join(header + CORE_IMPORTS + [""] + core_body).rstrip("\n") + "\n")

# Route file: keep only the preamble imports its remaining declarations use.
kept = []
for l in preamble:
    m = re.match(r'import type \{ ([^}]*) \} from "([^"]+)";$', l)
    if not m:
        kept.append(l)
        continue
    names = [n.strip() for n in m.group(1).split(",") if n.strip()]
    used = [n for n in names if re.search(r"\b" + re.escape(n.split(" as ")[-1]) + r"\b", route_code)]
    if used:
        kept.append(f'import type {{ {", ".join(used)} }} from "{m.group(2)}";')
used_core = [n for n in CORE_NAMES if re.search(r"\b" + n + r"\b", route_code)]
while kept and kept[-1].strip() == "":
    kept.pop()
reexport = ['export * from "@/lib/estimating-core/types";']
if used_core:
    reexport.append(f'import type {{ {", ".join(used_core)} }} from "@/lib/estimating-core/types";')
out = kept + reexport + [""] + [l for _, b in route_blocks for l in b]
open(RT, "w").write("\n".join(out).rstrip("\n") + "\n")
print(f"core: {len(CORE_NAMES)} declarations → {CORE}; route keeps {len(route_blocks)}: {[n for n, _ in route_blocks]}")
```

- [ ] **Step 2: Run it.**

Run: `python3 .data-golden/codemods/split-types.py`
Expected: `core: 17 declarations → src/lib/estimating-core/types.ts; route keeps 17: ['VENDOR_ATTACHMENT_BUDGET', 'VendorQuoteLine', 'VendorQuoteExtracted', 'VendorQuote', 'vendorAttachmentLoad', 'VendorLineDraft', 'VendorDraft', 'CatalogHit', 'CatalogSearch', 'QuoteLite', 'CustomerLite', 'PortalPanelData', 'InitialQuote', 'AiSource', 'AssistDraftView', 'EstimatorProps', 'VendorPdfFormState']`

- [ ] **Step 3: Type-check and lint.**

Run: `npx tsc --noEmit -p tsconfig.json; echo "tsc exit $?" && npx eslint "src/app/(app)/estimator/types.ts" src/lib/estimating-core/types.ts`
Expected: `tsc exit 0`; eslint prints nothing.

- [ ] **Step 4: Confirm behaviour is unchanged.**

Run: `npm run core:golden -- --in docs/estimating-core/golden-fixtures/export.json --check docs/estimating-core/golden`
Expected: `all 3 quote(s) match docs/estimating-core/golden`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/estimating-core/types.ts "src/app/(app)/estimator/types.ts"
git commit -m "refactor(estimating-core): persisted Estimator domain types move to src/lib/estimating-core/types.ts

The route types.ts keeps the page/view types and re-exports the core.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Move the pure Estimator helpers, leaving shims

**Files:**
- Move (`git mv`) to `src/lib/estimating-core/`: `pricing.ts`, `estimator-data.ts`, `tier-reprice.ts`, `labor-group.ts`, `labor-defaults.ts`, `track-bom.ts`, `curtain-line.ts`, `fixture-bom.ts`, `freight-default.ts`, `catalog-rank.ts`, `copy-system.ts`, `narrative.ts`
- Create: a one-line shim at each old path under `src/app/(app)/estimator/`
- Modify: `src/lib/estimating-core/pricing.ts` (append `systemPrintsInBody`), `src/lib/estimating-core/narrative.ts` (import it from `./pricing`), `src/app/(app)/estimator/quote-document-view.ts` (import + re-export it)

**Interfaces:**
- Produces: `@/lib/estimating-core/<name>` for each of the 12 files, with the same exports as before. `@/lib/estimating-core/pricing` also exports `systemPrintsInBody(sec: SpecSection): boolean`. Every old path keeps every export.
- Why `systemPrintsInBody` moves: `narrative.ts` needs it, and its old home `quote-document-view.ts` imports a `.tsx` type (`QuoteDocumentProps`), so it can't join the core.

- [ ] **Step 1: Write `.data-golden/codemods/move-core.sh`:**

```bash
#!/usr/bin/env bash
# Estimator handoff, PR 1 — move the pure Estimator helpers into
# src/lib/estimating-core/ and leave a one-line re-export at each old path.
# Run from the repo root on a clean tree.
set -euo pipefail
RT="src/app/(app)/estimator"
CORE="src/lib/estimating-core"
FILES=(pricing estimator-data tier-reprice labor-group labor-defaults track-bom curtain-line fixture-bom freight-default catalog-rank copy-system narrative)
for f in "${FILES[@]}"; do
  git mv "$RT/$f.ts" "$CORE/$f.ts"
  printf '// Moved to src/lib/estimating-core (estimator handoff, spec 2026-10-20 §3).\nexport * from "@/lib/estimating-core/%s";\n' "$f" > "$RT/$f.ts"
  git add "$RT/$f.ts"
done
echo "moved ${#FILES[@]} files"
```

- [ ] **Step 2: Write `.data-golden/codemods/move-print-rule.py`:**

```python
#!/usr/bin/env python3
"""Estimator handoff, PR 1 — move systemPrintsInBody from the route-folder
quote-document-view.ts into estimating-core/pricing.ts (narrative.ts needs it,
and quote-document-view imports a .tsx type). quote-document-view re-exports
it so its importers are unchanged. Run from the repo root after move-core.sh."""
import re

QDV = "src/app/(app)/estimator/quote-document-view.ts"
PRICING = "src/lib/estimating-core/pricing.ts"
NARR = "src/lib/estimating-core/narrative.ts"

q = open(QDV).read()
m = re.search(r"(/\*\*[^\n]*\n(?: \*[^\n]*\n)*?)?export function systemPrintsInBody\(sec: SpecSection\): boolean \{\n[\s\S]*?\n\}\n", q)
assert m, "systemPrintsInBody not found"
fn = m.group(0)
q = q.replace(fn, "")
old_import = 'import { systemFreight, systemItemsRev, systemSellTotal } from "./pricing";'
assert old_import in q, "pricing import line changed — update this script"
q = q.replace(old_import, 'import { systemSellTotal } from "./pricing";\nimport { systemPrintsInBody } from "@/lib/estimating-core/pricing";', 1)
assert "systemFreight" not in q and "systemItemsRev" not in q, "quote-document-view still uses the moved helpers"
q = q.rstrip("\n") + "\n\nexport { systemPrintsInBody };\n"
open(QDV, "w").write(q)

pricing = open(PRICING).read()  # read first: open(..., "w") truncates
open(PRICING, "w").write(pricing.rstrip("\n") + "\n\n" + fn)

n = open(NARR).read()
old = 'import { systemPrintsInBody } from "./quote-document-view";'
assert old in n, "narrative.ts import changed — update this script"
open(NARR, "w").write(n.replace(old, 'import { systemPrintsInBody } from "./pricing";'))
print("systemPrintsInBody → estimating-core/pricing.ts")
```

- [ ] **Step 3: Run both.**

Run: `bash .data-golden/codemods/move-core.sh && python3 .data-golden/codemods/move-print-rule.py`
Expected: `moved 12 files` then `systemPrintsInBody → estimating-core/pricing.ts`.

Check the shape:
```bash
cat "src/app/(app)/estimator/pricing.ts"                       # the two-line shim
grep -c "^export function totals" src/lib/estimating-core/pricing.ts             # 1
grep -c "^export function systemPrintsInBody" src/lib/estimating-core/pricing.ts # 1
```

- [ ] **Step 4: Type-check, lint, golden.**

Run:
```bash
npx tsc --noEmit -p tsconfig.json; echo "tsc exit $?"
npx eslint src/lib/estimating-core "src/app/(app)/estimator/quote-document-view.ts"
npm run core:golden -- --in docs/estimating-core/golden-fixtures/export.json --check docs/estimating-core/golden
```
Expected: `tsc exit 0`; eslint prints nothing; `all 3 quote(s) match`.

- [ ] **Step 5: Commit.**

```bash
git add -A src/lib/estimating-core "src/app/(app)/estimator"
git commit -m "refactor(estimating-core): move the pure Estimator helpers out of the route folder

pricing, estimator-data, tier-reprice, labor-group, labor-defaults, track-bom,
curtain-line, fixture-bom, freight-default, catalog-rank, copy-system and
narrative now live in src/lib/estimating-core; each old path is a one-line
export * shim. systemPrintsInBody moves into core pricing; quote-document-view
re-exports it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The purity gate, and the cuts that make it pass

**Files:**
- Create: `scripts/core-check.ts`, `src/lib/estimating-core/index.ts`, `src/lib/design/quick-types.ts`, `src/lib/estimate-output/response-types.ts`
- Modify:
  - Repoint to `@/lib/estimating-core/*`: `src/lib/curtain-cut-sheets/track-link.ts`, `src/lib/estimate-bonus/{canonical,card,record,rules}.ts`, `src/lib/estimate-line-move/{move,reid}.ts`, `src/lib/estimate-output/fields.ts`, `src/lib/package-doc/chips.ts`, `src/lib/review-limits.ts`, `src/lib/rewards/credit-line.ts`, `src/lib/system-categories.ts`
  - `src/app/(app)/design/quick/engine.ts`, `src/lib/design/{equipment-map,equipment-vocab,grid-scopes,grid-virtual-parts,wire-labor}.ts`
  - `src/lib/fixture-assemblies.ts`, `src/lib/estimate-output/responses.ts`
  - `scripts/test-review-and-spec.ts`, `package.json`

**Interfaces:**
- Produces:
  - `coreReport(root?: string): CoreReport` (`{ files: string[]; violations: CoreViolation[] }`), `whyForbidden(rel: string): string | null`, `moduleSpecifiers(sf: ts.SourceFile): string[]`, `coreCheckChecks(ok: Ok)`
  - CLI `npm run core:check`
  - `@/lib/estimating-core` (index) exports the 13 core files flat, plus 33 namespaced pure modules (`rackRules`, `bonusRules`, `lineMove`, …). This is what Plan 2 bundles.

- [ ] **Step 1: Write the gate, `scripts/core-check.ts`:**

```ts
/**
 * core:check — the estimating-core purity gate (estimator handoff, spec
 * docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md §3).
 *
 * Builds a TypeScript program from src/lib/estimating-core/index.ts alone and
 * walks every file it reaches through value AND type imports. The core has to
 * run in a browser with no server, so nothing it reaches may live under
 * src/db, src/lib/stores, src/app or src/components, be a *-server.ts or .tsx
 * file, or come from a server/UI package. A violation names the clean file
 * that imports it — that import is the edge to cut.
 *
 *   npm run core:check   → prints the closure size; exits 1 on any violation
 *   test:specs           → coreCheckChecks(ok)
 */
import * as path from "node:path";
import ts from "typescript";
import type { Ok } from "./test-inbox-org";

export const CORE_ENTRY = "src/lib/estimating-core/index.ts";

const FORBIDDEN_PATHS: Array<[RegExp, string]> = [
  [/^src\/db\//, "database layer"],
  [/^src\/lib\/stores\//, "store (database-backed)"],
  [/^src\/app\//, "route folder (import the estimating-core path)"],
  [/^src\/components\//, "React component"],
  [/-server\.tsx?$/, "server-only module"],
  [/\.tsx$/, "React component"],
];

export const FORBIDDEN_PACKAGES = new Set([
  "next", "next-auth", "react", "react-dom", "server-only", "drizzle-orm", "@electric-sql/pglite",
  "@neondatabase/serverless", "pg", "@vercel/blob", "@sparticuz/chromium", "puppeteer-core",
  "docx", "pdf-lib", "sharp", "googleapis", "@anthropic-ai/sdk",
]);

export type CoreViolation = { file: string; why: string; importedBy: string[] };
export type CoreReport = { files: string[]; violations: CoreViolation[] };

function packageOf(rel: string): string | null {
  const i = rel.lastIndexOf("node_modules/");
  if (i < 0) return null;
  const [a, b] = rel.slice(i + "node_modules/".length).split("/");
  const pkg = a.startsWith("@") ? `${a}/${b}` : a;
  // @types/react → react, @types/foo__bar → @foo/bar
  if (pkg.startsWith("@types/")) {
    const name = pkg.slice("@types/".length);
    return name.includes("__") ? `@${name.replace("__", "/")}` : name;
  }
  return pkg;
}

export function whyForbidden(rel: string): string | null {
  const pkg = packageOf(rel);
  if (pkg !== null) return FORBIDDEN_PACKAGES.has(pkg) ? `server/UI package "${pkg}"` : null;
  for (const [re, why] of FORBIDDEN_PATHS) if (re.test(rel)) return why;
  return null;
}

/** Every module a file names: import/export … from (incl. `export * as ns`,
 *  which ts.preProcessFile misses), `import("x")` types and dynamic import(). */
export function moduleSpecifiers(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      out.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function coreReport(root: string = process.cwd()): CoreReport {
  const cfg = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
  // types: [] — only what the core actually imports, not every @types package.
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false, types: [] };
  const program = ts.createProgram([path.join(root, CORE_ENTRY)], options);
  const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
  const sources = program.getSourceFiles().filter((sf) => !program.isSourceFileDefaultLibrary(sf));

  const imports = new Map<string, string[]>();
  for (const sf of sources) {
    const from = rel(sf.fileName);
    const to: string[] = [];
    for (const spec of moduleSpecifiers(sf)) {
      const hit = ts.resolveModuleName(spec, sf.fileName, options, ts.sys).resolvedModule;
      if (hit) to.push(rel(hit.resolvedFileName));
    }
    imports.set(from, to);
  }

  // Walk from the entry through clean files only, so each violation is the
  // first forbidden file on a path — the import edge to cut — not everything
  // behind it.
  const byFile = new Map<string, CoreViolation>();
  const seen = new Set<string>([CORE_ENTRY]);
  const queue = [CORE_ENTRY];
  while (queue.length) {
    const from = queue.shift()!;
    for (const to of imports.get(from) ?? []) {
      const why = whyForbidden(to);
      if (why) {
        const v = byFile.get(to) ?? { file: to, why, importedBy: [] };
        if (!v.importedBy.includes(from)) v.importedBy.push(from);
        byFile.set(to, v);
      } else if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  const files = [...seen].sort();
  const violations = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
  return { files, violations };
}

export function formatViolations(v: CoreViolation[]): string {
  return v.map((x) => `  ${x.file}  [${x.why}]\n    ← ${x.importedBy.join("\n    ← ")}`).join("\n");
}

export async function coreCheckChecks(ok: Ok) {
  const r = coreReport();
  ok(r.files.includes("src/lib/estimating-core/pricing.ts"), "core:check: the closure reaches estimating-core/pricing.ts");
  ok(r.files.includes("src/lib/estimating-core/types.ts"), "core:check: the closure reaches estimating-core/types.ts");
  ok(r.violations.length === 0, `core:check: estimating-core is browser-pure (${r.files.length} files)` +
    (r.violations.length ? `\n${formatViolations(r.violations)}` : ""));
  const probe = ts.createSourceFile("probe.ts", 'export * as ns from "a"; import type { T } from "b"; type U = import("c").U; export { x } from "d"; void import("e");', ts.ScriptTarget.ES2017);
  ok(moduleSpecifiers(probe).join(",") === "a,b,c,d,e", "core:check: moduleSpecifiers sees export * as, import type, import() types, re-exports and dynamic import()");
  ok(whyForbidden("src/lib/stores/quotes.ts") !== null && whyForbidden("node_modules/@types/react/index.d.ts") !== null &&
    whyForbidden("node_modules/zod/index.d.ts") === null && whyForbidden("src/lib/rack/rules.ts") === null,
    "core:check: the forbidden-path rules classify stores, @types/react, zod and a pure lib module correctly");
}

if (process.argv[1]?.endsWith("core-check.ts")) {
  const r = coreReport();
  if (r.violations.length) {
    console.error(`estimating-core is NOT browser-pure — ${r.violations.length} violation(s):\n${formatViolations(r.violations)}`);
    process.exit(1);
  }
  console.log(`estimating-core is browser-pure: ${r.files.length} files in its closure, 0 violations.`);
}
```

- [ ] **Step 2: Write the entry, `src/lib/estimating-core/index.ts`:**

```ts
/**
 * estimating-core — the Estimator's pricing domain as one browser-pure
 * library (estimator handoff, spec
 * docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md §3).
 *
 * Flat exports: the domain moved here from src/app/(app)/estimator/ (the old
 * paths re-export these files). Namespaced exports: pure src/lib modules that
 * stay where they are but belong to the core's closure, so `npm run
 * core:check` gates them too. Nothing reachable from this file may import a
 * store, the database, a route folder, a React component or a server package.
 */
export * from "./types";
export * from "./pricing";
export * from "./estimator-data";
export * from "./tier-reprice";
export * from "./labor-group";
export * from "./labor-defaults";
export * from "./track-bom";
export * from "./curtain-line";
export * from "./fixture-bom";
export * from "./freight-default";
export * from "./catalog-rank";
export * from "./copy-system";
export * from "./narrative";

// Pure src/lib modules in the core's closure (unchanged paths).
export * as curtainPricing from "@/lib/design/curtain-pricing";
export * as curtainGeom from "@/lib/curtain-geom";
export * as curtainMounts from "@/lib/curtain-mounts";
export * as curtainFabric from "@/lib/curtain-pricing";
export * as fixtureAssemblies from "@/lib/fixture-assemblies";
export * as fixtureRates from "@/lib/fixture-rates";
export * as freightRule from "@/lib/freight-rule";
export * as quoteLineMembers from "@/lib/quote-line-members";
export * as reviewLimits from "@/lib/review-limits";
export * as systemCategories from "@/lib/system-categories";
export * as tierPricing from "@/lib/tier-pricing";
export * as trackEngine from "@/lib/track-engine";
export * as trackSeries from "@/lib/track-series";
export * as estimateNumber from "@/lib/estimate-number";
export * as bonusCanonical from "@/lib/estimate-bonus/canonical";
export * as bonusFlags from "@/lib/estimate-bonus/flags";
export * as bonusRecord from "@/lib/estimate-bonus/record";
export * as bonusRules from "@/lib/estimate-bonus/rules";
export * as bonusCard from "@/lib/estimate-bonus/card";
export * as groups from "@/lib/estimate-groups/groups";
export * as lineMove from "@/lib/estimate-line-move/move";
export * as lineReid from "@/lib/estimate-line-move/reid";
export * as rackDefaults from "@/lib/rack/defaults";
export * as rackGeometry from "@/lib/rack/geometry";
export * as rackLayout from "@/lib/rack/layout";
export * as rackRules from "@/lib/rack/rules";
export * as rackSvg from "@/lib/rack/svg";
export * as rackTypes from "@/lib/rack/types";
export * as rackPartFacts from "@/lib/rack/part-facts";
export * as approvalSnapshot from "@/lib/approval-snapshot";
export * as servicePricing from "@/lib/service-pricing";
export * as rewardCreditLine from "@/lib/rewards/credit-line";
```

- [ ] **Step 3: Wire the harness and npm script.**
  - In `scripts/test-review-and-spec.ts`, after `import { goldenChecks } from "./estimating-golden";` add `import { coreCheckChecks } from "./core-check";`.
  - Change the chain line `  .then(() => goldenChecks(ok))` to `  .then(() => goldenChecks(ok)).then(() => coreCheckChecks(ok))`.
  - In `package.json` `"scripts"`, after the `core:golden` line, add `"core:check": "tsx scripts/core-check.ts",`.

- [ ] **Step 4: Run the gate to verify it fails.**

Run: `npm run core:check`
Expected: exit 1 with `estimating-core is NOT browser-pure — <n> violation(s):`. The frontier must include at least these files:
- `src/app/(app)/design/quick/engine.ts`, imported by the five `src/lib/design/*` files
- `src/app/(app)/estimator/types.ts` and `src/app/(app)/estimator/pricing.ts` (route shims), imported by `estimate-bonus/*`, `review-limits.ts`, `rewards/credit-line.ts`, `system-categories.ts` and the other closure modules
- `src/app/(app)/estimator/narrative.ts` and `labor-group.ts` (route shims), imported by `estimate-line-move/*`
- `src/lib/stores/catalog.ts`, imported by `src/lib/fixture-assemblies.ts`

The count and importer lists may vary; what matters is that it fails and names those files. Steps 5–6 cut exactly these edges.

- [ ] **Step 5: Write and run the repoint codemod**, `.data-golden/codemods/repoint.sh`:

```bash
#!/usr/bin/env bash
# Estimator handoff, PR 1 — point the src/lib modules inside the core's
# closure at estimating-core instead of the route-folder shims. Run from the
# repo root after move-core.sh. (Other importers keep using the shims.)
set -euo pipefail
FILES=(
  src/lib/curtain-cut-sheets/track-link.ts
  src/lib/estimate-bonus/canonical.ts src/lib/estimate-bonus/card.ts src/lib/estimate-bonus/record.ts src/lib/estimate-bonus/rules.ts
  src/lib/estimate-line-move/move.ts src/lib/estimate-line-move/reid.ts
  src/lib/estimate-output/fields.ts src/lib/package-doc/chips.ts
  src/lib/review-limits.ts src/lib/rewards/credit-line.ts src/lib/system-categories.ts
)
for f in "${FILES[@]}"; do
  sed -i '' -E 's#"@/app/\(app\)/estimator/(types|pricing|narrative|labor-group)"#"@/lib/estimating-core/\1"#g' "$f"
done
if grep -n -E '"@/app/' "${FILES[@]}"; then echo "route import left above" >&2; exit 1; fi
echo "repointed ${#FILES[@]} files"
```

Run: `bash .data-golden/codemods/repoint.sh`
Expected: `repointed 12 files`.

- [ ] **Step 6: Write and run the type-edge cuts**, `.data-golden/codemods/cut-type-edges.py`:

```python
#!/usr/bin/env python3
"""Estimator handoff, PR 1 — cut the three type-only edges that pull the app
into estimating-core's closure (found by `npm run core:check`):
  1. Quick Design's shared types live in a route file (design/quick/engine.ts)
     → src/lib/design/quick-types.ts; engine.ts re-exports them.
  2. fixture-assemblies.ts reads CatalogPart from the catalog store just to Pick
     five fields → a local structural type.
  3. estimate-bonus/record.ts reads ClientResponse from estimate-output/responses
     (which imports the customer document) → estimate-output/response-types.ts;
     responses.ts re-exports it.
Run from the repo root."""
import re

def rw(path, fn):
    s = open(path).read()
    t = fn(s)
    assert t != s, f"no change in {path}"
    open(path, "w").write(t)

# 1. Quick Design types
ENGINE = "src/app/(app)/design/quick/engine.ts"
QT = "src/lib/design/quick-types.ts"
QT_NAMES = ["SysKey", "VenueKind", "TierKey", "SizeKey", "DimField", "ViewKey", "VenueDef", "DrapeGeom", "BomItem", "SystemBlock"]
src = open(ENGINE).read()
start = src.index("export type SysKey =")
end = src.index("export type ComputeResult =")
block = src[start:end].rstrip("\n") + "\n"
assert [n for n in QT_NAMES if f"export type {n}" not in block] == []
open(QT, "w").write(
    "/**\n"
    " * Quick Design's shared vocabulary (system keys, tiers, BOM rows). Moved out\n"
    " * of the route file design/quick/engine.ts so pure src/lib modules (and\n"
    " * estimating-core's closure) never import a route folder; engine.ts\n"
    " * re-exports every name. Estimator handoff, spec 2026-10-20 §3.\n"
    " */\n\n" + block)
names = ", ".join(QT_NAMES)
src = src[:start] + f'export type {{ {names} }} from "@/lib/design/quick-types";\nimport type {{ {names} }} from "@/lib/design/quick-types";\n\n' + src[end:]
open(ENGINE, "w").write(src)
for f in ["src/lib/design/equipment-map.ts", "src/lib/design/equipment-vocab.ts", "src/lib/design/grid-scopes.ts",
          "src/lib/design/grid-virtual-parts.ts", "src/lib/design/wire-labor.ts"]:
    rw(f, lambda s: s.replace('from "@/app/(app)/design/quick/engine";', 'from "@/lib/design/quick-types";'))

# 2. fixture-assemblies: CatalogPart → local structural type
FA = "src/lib/fixture-assemblies.ts"
rw(FA, lambda s: s.replace(
    'import type { CatalogPart } from "@/lib/stores/catalog";\n',
    '/** The catalog fields fixture pricing reads — structural, so this pure\n'
    ' *  module never imports the catalog store (estimating-core purity). */\n'
    'type CatalogPart = { sku: string; desc: string; unit: string; cost: number; list: number };\n', 1))

# 3. ClientResponse → estimate-output/response-types.ts
RESP = "src/lib/estimate-output/responses.ts"
RT_FILE = "src/lib/estimate-output/response-types.ts"
r = open(RESP).read()
m = re.search(r'export type ClientResponseKind = [^\n]*\nexport type ClientResponse = \{\n[\s\S]*?\n\};\n', r)
assert m, "ClientResponse block not found"
open(RT_FILE, "w").write(
    "/** A customer's response on the package page (accept / question). Split out\n"
    " *  of responses.ts so pure modules can type it without importing the\n"
    " *  customer document. responses.ts re-exports both names. */\n" + m.group(0))
r = r.replace(m.group(0),
    'export type { ClientResponseKind, ClientResponse } from "./response-types";\n'
    'import type { ClientResponseKind, ClientResponse } from "./response-types";\n')
open(RESP, "w").write(r)
rw("src/lib/estimate-bonus/record.ts", lambda s: s.replace(
    'import type { ClientResponse } from "@/lib/estimate-output/responses";',
    'import type { ClientResponse } from "@/lib/estimate-output/response-types";'))
print("cut: quick-types, CatalogPart, ClientResponse")
```

Run: `python3 .data-golden/codemods/cut-type-edges.py`
Expected: `cut: quick-types, CatalogPart, ClientResponse`.

- [ ] **Step 7: Run the gate to verify it passes.**

Run: `npm run core:check`
Expected: `estimating-core is browser-pure: 82 files in its closure, 0 violations.` A file count within a few of 82 is fine if main moved; the violation count must be 0.

- [ ] **Step 8: Prove the gate still bites.** Temporarily reintroduce the store import, run the gate, then restore:

```bash
cp src/lib/fixture-assemblies.ts .data-golden/fa.bak
git show HEAD:src/lib/fixture-assemblies.ts > src/lib/fixture-assemblies.ts
npm run core:check; echo "exit $?"     # expect exit 1, one violation: src/lib/stores/catalog.ts ← src/lib/fixture-assemblies.ts
cp .data-golden/fa.bak src/lib/fixture-assemblies.ts
npm run core:check                     # 0 violations again
```

- [ ] **Step 9: Type-check, lint, golden, harness.**

```bash
npx tsc --noEmit -p tsconfig.json; echo "tsc exit $?"
npx eslint scripts/core-check.ts src/lib/estimating-core src/lib/design/quick-types.ts src/lib/estimate-output/response-types.ts src/lib/estimate-output/responses.ts src/lib/fixture-assemblies.ts src/lib/design "src/app/(app)/design/quick/engine.ts" src/lib/estimate-bonus src/lib/estimate-line-move src/lib/review-limits.ts src/lib/rewards/credit-line.ts src/lib/system-categories.ts src/lib/curtain-cut-sheets/track-link.ts src/lib/estimate-output/fields.ts src/lib/package-doc/chips.ts
npm run core:golden -- --in docs/estimating-core/golden-fixtures/export.json --check docs/estimating-core/golden
npm run test:specs 2>&1 | tail -5
```
Expected:
- `tsc exit 0`
- eslint 0 problems
- `all 3 quote(s) match`
- test:specs `N+8 PASS, 0 FAIL` (3 golden + 5 core-check)

- [ ] **Step 10: Commit.**

```bash
git add scripts/core-check.ts src/lib/estimating-core/index.ts src/lib/design/quick-types.ts src/lib/estimate-output/response-types.ts \
  src/lib/estimate-output/responses.ts src/lib/fixture-assemblies.ts src/lib/design "src/app/(app)/design/quick/engine.ts" \
  src/lib/estimate-bonus src/lib/estimate-line-move src/lib/review-limits.ts src/lib/rewards/credit-line.ts src/lib/system-categories.ts \
  src/lib/curtain-cut-sheets/track-link.ts src/lib/estimate-output/fields.ts src/lib/package-doc/chips.ts \
  scripts/test-review-and-spec.ts package.json
git status --short   # nothing left but untracked junk you recognise
git commit -m "feat(estimating-core): core:check purity gate + index; cut the type edges into stores and route folders

- scripts/core-check.ts walks the core's value+type closure from index.ts
  (TypeScript API, export * as included) and refuses db/stores/route/React/
  server packages, naming the edge to cut; runs in test:specs.
- Closure modules in src/lib now import estimating-core, not route shims.
- Quick Design types -> src/lib/design/quick-types.ts; fixture-assemblies
  types its catalog rows structurally; ClientResponse -> response-types.ts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Golden points at the core; full verification gate

**Files:**
- Modify: `scripts/estimating-golden.ts` (two import lines)

**Interfaces:**
- Consumes: `@/lib/estimating-core/pricing`, `@/lib/estimating-core/types`.

- [ ] **Step 1: Point the golden generator at the core.** In `scripts/estimating-golden.ts`, replace:

```ts
import { lineExtSellOf, systemSellTotal, totals, type QuoteTotals } from "@/app/(app)/estimator/pricing";
import type { SpecSection } from "@/app/(app)/estimator/types";
```
with:
```ts
import { lineExtSellOf, systemSellTotal, totals, type QuoteTotals } from "@/lib/estimating-core/pricing";
import type { SpecSection } from "@/lib/estimating-core/types";
```

- [ ] **Step 2: Real-data check against Task 1's "before".**

Run: `npm run core:golden -- --in .data-golden/local-export.json --check .data-golden/before`
Expected: `all K quote(s) match .data-golden/before`, the same K recorded in Task 1. Any mismatch is a behaviour change: STOP and investigate with superpowers:systematic-debugging. Don't regenerate.

- [ ] **Step 3: Run the full gate.** Run each command and record its real output.

```bash
npx tsc --noEmit -p tsconfig.json; echo "tsc exit $?"            # 0
npm run core:check                                                # 0 violations
npm run test:specs 2>&1 | tail -5                                 # N+8 PASS, 0 FAIL
ps aux | grep -E "next dev|next-server" | grep -v grep            # nothing before smoke
npm run test:smoke 2>&1 | tail -5                                 # all PASS, exit 0
npm run lint 2>&1 | tail -5                                       # errors/warnings no more than the Task 0 baseline
npx next build 2>&1 | tail -15                                    # exit 0. Use `npx next build`, NOT `npm run build` (that runs migrate + seed)
ps aux | grep -E "next dev|next-server|tsx " | grep -v grep       # nothing left running
```

- [ ] **Step 4: Commit.**

```bash
git add scripts/estimating-golden.ts
git commit -m "test(estimating-core): golden totals price through @/lib/estimating-core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs: decisions, punch item, phase entry

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

- [ ] **Step 1: Recompute the numbers against current main.**

```bash
git fetch -q origin
git show origin/main:DECISIONS.md | grep -o -E "^## D[0-9]+" | grep -o "[0-9]*" | sort -n | tail -1    # last D → next = +1
git show origin/main:PUNCHLIST.md | grep -o -E "^## [0-9]+\." | grep -o "[0-9]*" | sort -n | tail -1  # last # → next = +1
git show origin/main:AGENTS.md | grep -o -E "^[0-9]+\. " | sort -n | tail -1                         # last phase → next = +1
```
Use those numbers below in place of D1228–D1230, #359 and phase 66.

- [ ] **Step 2: Append three decisions to `DECISIONS.md`**, in the file's existing `## D<n>. Title` style:

```markdown
## D1228. The Estimator's pricing domain is a library: src/lib/estimating-core

The persisted spec types (SpecItem, SpecSection, configurator drafts) and twelve pure helpers (pricing, estimator-data, tier-reprice, labor-group, labor-defaults, track-bom, curtain-line, fixture-bom, freight-default, catalog-rank, copy-system, narrative) moved out of `src/app/(app)/estimator/` into `src/lib/estimating-core/`, with one entry `index.ts`. Every old path is a one-line `export *` shim, so the ~400 existing importers are unchanged. Only the `src/lib` modules inside the core's own closure were repointed. Re-pointing the rest is optional, later work. `systemPrintsInBody` moved into core pricing; `quote-document-view.ts` re-exports it. Why: the Estimator handoff (spec 2026-10-20) bundles the real engine into a browser prototype, and the domain no longer lives in a route folder.

## D1229. core:check: the core may not reach a store, the database, a route folder, React or a server package

`scripts/core-check.ts` builds a TypeScript program from `src/lib/estimating-core/index.ts` and walks value and type imports (including `export * as`, which `ts.preProcessFile` misses). It refuses `src/db`, `src/lib/stores`, `src/app`, `src/components`, `*-server.ts`, `.tsx`, and the server/UI packages listed in the file. It reports only the first forbidden file on each path, plus the clean file that imports it: the edge to cut. It runs in test:specs. Three type-only edges were cut to pass it:
- Quick Design types → `src/lib/design/quick-types.ts`
- `fixture-assemblies` types catalog rows structurally
- `ClientResponse` → `estimate-output/response-types.ts`

## D1230. Golden totals guard the Estimator's pricing

`npm run core:golden` prices every live system quote in a `db:export` file and writes one JSON per quote: per-system sell, per-line extended sell, and `totals()` at tax 0. Six synthetic fixture quotes (`docs/estimating-core/golden-fixtures/export.json`) and their committed goldens run in test:specs. The extraction was also checked against a copy of the local dev database: all K quotes were byte-identical before and after. Handoff PR 2 reuses the same files to prove the bundled prototype prices to the cent.
```
Replace `K` with Task 1's number.

- [ ] **Step 3: Add the punch item to `PUNCHLIST.md`**, appended after the last item, matching its `## <n>. Title, STATUS` layout:

```markdown
## 359. Estimator handoff, PR 1: estimating-core extraction, DONE

**Area:** `src/lib/estimating-core/`, `scripts/core-check.ts`, `scripts/estimating-golden.ts`, the 12 route shims under `src/app/(app)/estimator/`
**Reported:** 2026-10-20 (Jeff: share the estimator as HTML with the founder for their software)

Spec `docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md`; plan `docs/superpowers/plans/2026-10-20-estimating-core-extraction.md`. D1228–D1230. No behaviour change: golden totals identical on the fixtures and on all K local quotes; core:check 0 violations.

**Next:** PR 2 (slicer, prototype UI, spec docs, verification, zip), planned after this merges. It needs Jeff's production export (`DATABASE_URL=<prod> OUT=~/peak-prod-export.json npm run db:export`).
```

Also add one line under item **57** (multi-tenant), at the end of its body:

```markdown
**2026-10-20:** the Estimator handoff (#359) is a one-off package for the founder, not multi-tenancy. #57 stays NOT NOW.
```

- [ ] **Step 4: Add the phase entry to `AGENTS.md`**, after the last numbered phase entry:

```markdown
66. ✅ **Estimating-core extraction** (#359, D1228–D1230) — handoff PR 1. The Estimator's persisted
    domain types and twelve pure helpers live in `src/lib/estimating-core/` (entry `index.ts`:
    flat domain exports plus namespaced pure `src/lib` modules); each old route path is an
    `export *` shim. `npm run core:check` (TypeScript-API closure walk, in test:specs) keeps the
    core browser-pure; `npm run core:golden` prices export files into golden totals (fixtures
    in `docs/estimating-core/`). Quick Design types now live in `src/lib/design/quick-types.ts`.
    No behaviour change. Next: handoff PR 2, the HTML prototype package (needs Jeff's production
    export).
```

- [ ] **Step 5: Commit.**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs(estimating-core): D1228–D1230, punch #359, phase 66

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand back to Jeff.** Report the real gate numbers from Task 5. Don't push or open a PR without his go-ahead. Leave `.data-golden/` in place: it holds the before/after evidence and real data, it's git-ignored, and Jeff can delete it. Say that it's there and roughly how big it is (`du -sh .data-golden`).

---

## Facts for Plan 2 (found while planning; not tasks here)

- **`npm run db:export` does not export the relational tables** `companies`, `contacts`, `contact_emails`, `contact_phones` or `sites`. It exports only `DOC_TABLES`, `users`, `appSettings`, `blobs`, `notifPrefs`, `gmailConnections` and `geoCache`. The slicer's `customers.js` needs those tables, so Plan 2 must extend the export or add a dedicated estimating export **before** Jeff runs it on production.
- **`output/` is not git-ignored** (`git status` shows it untracked). The spec says the build lands in a git-ignored `output/peak-estimator-handoff/`, so Plan 2 adds the ignore rule.
- **`esbuild` is not a direct dependency.** It's only present transitively through `tsx`. Plan 2's bundler step should add it as a pinned `devDependency`.
- **The core's runtime closure uses no npm packages**, so the browser bundle needs no polyfills.
- **The quote's estimate number is `estNo: number`.** It's formatted with a prefix by `src/lib/estimate-number.ts`, which is in the core.
- **Left out of the core on purpose:**
  - `estimate-steps/readiness.ts`, which imports the customer document via `estimate-output/scopes`
  - `quote-document-view.ts`
  - `custom-part-edit.ts`, which is pure in-place-edit logic. Its only blocker was `narrative`, now in the core, so Plan 2 can move it the same way if the prototype needs it.

  For the first two, Plan 2 either cuts the edges the same way or gives the prototype slim copies.
- **Spec §3 named curtain / track / rack / bonus / groups / line-move / approval-snapshot / service-pricing / credit-line as modules to move.** They are already pure `src/lib` modules, so this plan leaves them in place. `index.ts` re-exports them by namespace, and `core:check` gates them exactly as if they had moved. Only route-folder code moves.
