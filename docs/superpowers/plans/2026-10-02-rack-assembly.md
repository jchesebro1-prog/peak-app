# Rack Assembly (#296) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Equipment racks in the Assembly Builder — a new `rack` kind laid out in a rack-unit (RU) sidebar, priced and quoted like any assembly, with a submittal set (elevation, schedule, power/heat, datasheet package).

**Architecture:** Rack data is optional keys on the jsonb `CatalogPart` doc. A pure layout engine (`src/lib/rack/`) owns every placement rule, validation and total; one pure geometry function draws the elevation as `Shape[]`, serialized to one SVG string used by the sidebar AND the printed sheets. A rack is a `FixtureRecord` with `kind: "rack"`, `parts` (rack-level parts) and `rack: RackLayout` (placements); `fixtureLineParts` expands placements so every existing consumer (Estimator, Quick Design, Grid `asm:`, spec BOM, client-package datasheets) prices and lists them unchanged. Outputs render through a signed `/print/rack/[id]` route + headless Chrome, zipped on the fly.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, doc-store (jsonb, no SQL migrations), puppeteer-core + @sparticuz/chromium (existing), `pdf-lib` (NEW dependency, datasheet merge), `docx` ^9 (existing), `sharp` (existing, SVG→PNG for the .docx).

**Specs (authoritative for behavior):** `docs/superpowers/specs/2026-10-01-rack-*.md` (handoff `2026-10-01-rack-00-handoff.md`). Locked decisions RK-1..RK-4 there are not re-asked.

## Global Constraints

- Imperial units only: inches, pounds, watts, BTU/hr. `1 RU = 1.75 in`. `btuHr = watts × 3.412`, rounded to whole BTU/hr.
- **Absent = unknown, never zero.** Zero means "measured, none". Totals with unknowns read "at least …" and list the parts lacking data.
- No SQL migrations, no legacy adapters (beta = sample data). Catalog fields are optional jsonb keys written only through `mergeUpsert`.
- Kind is fixed after creation (D299). Lines are catalog SKUs only; no nesting of assemblies in racks.
- Save actions for assemblies use `requireUser()` (existing rule). Rack-data CSV import uses `requirePerm("create")` (photo-sheet precedent).
- Client (`"use client"`) files must never VALUE-import from `@/lib/stores/*` or `@/db/*` (type imports are fine). Pure halves live in `src/lib/rack/*`.
- Do NOT invent manufacturer specs. No seed RU/watts values; ship the import template only.
- Portal: racks are NOT indexed (already true — `portal-catalog-index.ts:358` indexes `kind === "fixture"` only; keep it that way).
- Copy style: plain sentences, sentence case, no exclamation marks. Errors name the placement and the reason.
- Test harness: `scripts/test-review-and-spec.ts`; helper `ok(cond, msg)`; block banner `/* ===== #296 — <topic> ===== */`; messages prefixed `"#296 <area>: …"`; imports aliased `c296…` placed next to the block; DB checks as `async function rack296XxxAsyncChecks()` chained on the promise chain near `.then(() => curtain292AsyncChecks())`.
- Gates per task (run in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/rack`, `export PATH=$HOME/.local/node/bin:$PATH`): `npx tsc --noEmit` (0 errors), `npm run test:specs` (0 FAIL; report PASS count), `npx eslint` (0 errors; warnings ≤ baseline). Tasks touching `"use client"` files or routes also run `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build`. `npm run test:smoke` at tasks 2, 9, 11, 12 and at the end.
- Never `git stash` (shared across worktrees). Commit per task with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Punch number **#296**; decisions start at **D573** (re-check `origin/main` before writing docs).

## Decisions taken in this plan (log in DECISIONS.md at the end)

- **D573** Spec defaults adopted for the open questions: no nesting (racks hold SKUs only; template racks = duplicate a record); scope required, `SYSTEM_SCOPES`; schedule as PDF + CSV; 19 in only in the UI (23 in stored); whole-RU layout (catalog may hold 0.5, layout rounds up with a warning); 1–60 RU, default 42; heat rule 1500 W per 10 contiguous RU without a vent; CSI label "27 11 16 — Communications Racks, Frames and Enclosures" in the D94 section.
- **D574** Estimator components group placements by SKU: qty = included (non-optional) placements of that SKU; a SKU whose placements are all optional becomes a qty-0 add-on; per-placement `costOverride`s average into the component's unit cost (totals exact). A SKU may not be both placed and a rack-level part (save error).
- **D575** Shelves: a shelf occupies its own RU; devices on it (`shelfId`) take no RU of their own; when the tallest child exceeds the shelf height the difference extends the shelf's occupied span upward (must be free). A child with unknown height is a warning. A shelf with devices cannot be removed until they are.
- **D576** New optional catalog field `powerCapacityWatts` (PDU/UPS outlet capacity) beyond the spec's list, feeding the power page's capacity line. Blank/vent/shelf placements with unknown watts count as 0 W (passive) and are not flagged.
- **D577** `pdf-lib` added for the datasheet merge (no PDF merge existed). The .docx elevation image is rasterized with `sharp`; if rasterizing fails the section prints the schedule and a pointer to `racks/<name>/elevation.pdf`.
- **D578** A quote line built from a rack carries `rackId`; the submittal and client package read the rack record live (no frozen layout), same as Grid `asm:` parts.
- **D579** Default blank and vent SKUs live in one settings blob `rack_defaults` (`{ blankSku?, ventSku? }`), set from the sidebar's Rack hardware tray by anyone with `create`.

---

## File map

| File | New/Mod | Responsibility |
|---|---|---|
| `src/lib/rack/types.ts` | new | All rack types + constants (single source) |
| `src/lib/rack/part-facts.ts` | new | Catalog rack-field schema, `cleanRackFacts`, form reader, `rackFactsOf`, coverage report |
| `src/lib/rack/part-facts-sheet.ts` | new | Rack-data CSV: headers, parse rows, build export grid, additive patch |
| `src/lib/rack/layout.ts` | new | Engine core: lanes, spans, `canPlace`/`place`/`move`/`remove`/`resize`/`update`, `sanitizeRackLayout` |
| `src/lib/rack/rules.ts` | new | `firstFit`, `autoFillBlanks`, `validate`, `totals`, `ruLabel` |
| `src/lib/rack/history.ts` | new | Pure undo/redo stack |
| `src/lib/rack/geometry.ts` | new | `rackGeometry()` → `{ viewBox, shapes, slots }` |
| `src/lib/rack/svg.ts` | new | `shapesToSvg`, `renderRackElevationSvg` |
| `src/lib/rack/submittal.ts` | new | Pure submittal model: schedule rows, rack-level rows, power/heat, gaps, datasheet SKU order, CSV |
| `src/lib/rack/submittal-server.ts` | new | Server: load rack + catalog + docs, render PDFs, merge datasheets, build zip files |
| `src/lib/stores/catalog.ts` | mod | `CatalogPart` gains rack keys |
| `src/app/(app)/catalog/part-form.ts` | mod | `optionalPartFields` reads rack fields |
| `src/app/(app)/catalog/page.tsx` + `rack-data-field.tsx` (new) | mod/new | "Rack data" section in the part editor |
| `src/app/(app)/catalog/rack-data/{page.tsx,actions.ts,rack-data-client.tsx}`, `.../rack-data/export/route.ts` | new | Rack-data CSV export/import page |
| `src/app/(app)/estimator/actions.ts`, `estimator/types.ts`, `design/assemblies/{actions.ts,fixture-form.tsx}` | mod | Part search hits carry rack facts |
| `src/lib/fixture-assemblies.ts` | mod | `kind: "rack"`, `rack` block, sanitize, line expansion, groups |
| `src/lib/fixtures-convert.ts`, `src/lib/stores/fixtures.ts` | mod | Kind normalization + optional field list |
| `src/lib/stores/rack-defaults.ts` | new | `rack_defaults` blob get/save |
| `src/lib/design/grid-virtual-parts.ts`, `design/equipment-map-view.ts`, `grid/settings/equipment-map/equipment-map-client.tsx`, `design/auto-estimate.ts`, `grid/[id]/actions.ts` | mod | Kind switches |
| `src/app/(app)/estimator/fixture-bom.ts`, `estimator-client.tsx`, `estimator/types.ts` | mod | `rackId` on a rack's BOM line |
| `src/components/rack/{RackElevation.tsx,useRackEditor.ts,RackSidebar.tsx,PlacementMenu.tsx}` | new | Shared elevation + builder sidebar |
| `src/app/(app)/design/assemblies/{fixture-builder.tsx,fixture-form.tsx,page.tsx,actions.ts}` | mod | Racks tab, rack form, sidebar mount, defaults |
| `src/lib/quote-pdf/token.ts` | mod | Token kind `"rack"` |
| `src/components/rack/RackSheets.tsx` | new | Server-renderable elevation / schedule / power pages |
| `src/app/print/rack/[id]/page.tsx` | new | Signed print route |
| `src/app/(app)/design/assemblies/rack/[id]/page.tsx` | new | Staff preview of the submittal pages (PrintButton) |
| `src/app/api/racks/[id]/submittal/route.ts` | new | Builds + streams the zip |
| `next.config.ts` | mod | Chromium tracing for the zip route |
| `src/lib/client-package-server.ts`, `src/lib/bid-spec.ts`, `src/lib/bid-spec-docx.ts` | mod | Racks folder + Equipment Racks section |
| `scripts/test-review-and-spec.ts`, `scripts/smoke-routes.ts` | mod | Tests |

---

### Task 1: Catalog rack fields

**Files:**
- Create: `src/lib/rack/types.ts`, `src/lib/rack/part-facts.ts`
- Modify: `src/lib/stores/catalog.ts` (type `CatalogPart`, after `narrativeUpdatedBy`), `src/app/(app)/catalog/part-form.ts` (`optionalPartFields`), `src/app/(app)/catalog/page.tsx` (`PartFormModal`, after the fabric block ~:955), create `src/app/(app)/catalog/rack-data-field.tsx`, `src/app/(app)/estimator/types.ts` (`CatalogHit` :430), `src/app/(app)/estimator/actions.ts` (`searchCatalog` mapping ~:1403), `src/app/(app)/design/assemblies/actions.ts` (:40-48), `src/app/(app)/design/assemblies/fixture-form.tsx` (`PartHit` :29)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces — Produces** (`src/lib/rack/types.ts`, copy exactly; later tasks import from here):

```ts
/** #296 — equipment racks. Imperial: inches, pounds, watts. */
export const RU_IN = 1.75;
export const BTU_PER_WATT = 3.412;
export const RACK_RU_MIN = 1;
export const RACK_RU_MAX = 60;
export const RACK_RU_DEFAULT = 42;
export const RACK_MAX_PLACEMENTS = 300;
export const HEAT_WINDOW_RU = 10;
export const HEAT_WATTS_PER_WINDOW = 1500;
export const CIRCUIT_VOLTS = 120;

export const RACK_MOUNTS = ["rack", "shelf", "none"] as const;
export type RackMount = (typeof RACK_MOUNTS)[number];
export const RACK_WIDTHS = ["full", "half", "third", "23in"] as const;
export type RackWidthClass = (typeof RACK_WIDTHS)[number];
export const MOUNT_FACES = ["front", "rear", "both"] as const;
export type MountFace = (typeof MOUNT_FACES)[number];
export const AIRFLOWS = ["front-to-rear", "rear-to-front", "side", "passive"] as const;
export type Airflow = (typeof AIRFLOWS)[number];

/** Optional catalog-part rack data. Absent = unknown; 0 = measured none. */
export type RackPartFacts = {
  rackMount?: RackMount;
  ruHeight?: number;          // > 0, multiple of 0.5
  rackWidth?: RackWidthClass;
  depthIn?: number;           // ≥ 0
  weightLb?: number;          // ≥ 0
  powerWatts?: number;        // ≥ 0 typical draw
  maxPowerWatts?: number;     // ≥ 0 rated draw
  powerCapacityWatts?: number;// ≥ 0, PDU/UPS outlet capacity (D576)
  mountFace?: MountFace;
  airflow?: Airflow;
  rackNotes?: string;         // ≤ 200 chars
};
export const RACK_FACT_KEYS = ["rackMount", "ruHeight", "rackWidth", "depthIn", "weightLb", "powerWatts", "maxPowerWatts", "powerCapacityWatts", "mountFace", "airflow", "rackNotes"] as const;
export type RackFactKey = (typeof RACK_FACT_KEYS)[number];

/** A part as the rack engine sees it. `found: false` = SKU not in the catalog. */
export type RackPartInfo = RackPartFacts & { sku: string; desc: string; mfr?: string; found: boolean };
export type RackPartLookup = (sku: string) => RackPartInfo | undefined;

export type RackFace = "front" | "rear";
export type PlacementKind = "device" | "shelf" | "blank" | "vent" | "reserved";
export type RackConfig = { ruCount: number; widthIn: 19 | 23; depthIn?: number; numbering: "bottom-up" | "top-down" };
export type PlacementOverride = { ruHeight?: number; depthIn?: number; weightLb?: number; powerWatts?: number; rackWidth?: RackWidthClass };
export type RackPlacement = {
  id: string;                 // RP-<base36>
  kind: PlacementKind;
  sku?: string;               // required except for reserved
  label?: string;
  ruStart: number;            // lowest occupied RU (storage is always bottom-up, RU 1 = bottom). Shelf children: = shelf.ruStart (ignored)
  ruHeight: number;           // whole RU, ≥ 1 (resolved at placement: override > catalog ceil > 1)
  face: RackFace;
  lane?: 0 | 1 | 2;           // absent = 0
  laneCount?: 1 | 2 | 3;      // absent = 1 (full width)
  shelfId?: string;           // sits on this shelf; takes no RU of its own
  optional?: boolean;
  override?: PlacementOverride;
  costOverride?: number;
  notes?: string;             // ≤ 200 chars
};
export type RackLayout = { config: RackConfig; placements: RackPlacement[] };

export type RackIssue = { level: "error" | "warning"; code: string; placementIds: string[]; message: string };
export type RackDataField = "ruHeight" | "depthIn" | "weightLb" | "powerWatts";
export type RackMissing = { sku: string; label: string; fields: RackDataField[] };
export type RackTotals = {
  ruCount: number; ruUsed: number; ruReserved: number; ruFree: number;
  weightLb: number; watts: number; maxWatts: number; btuHr: number; amps: number;
  withOptions: { weightLb: number; watts: number; maxWatts: number; btuHr: number };
  capacityWatts: number | null;
  byFace: { front: number; rear: number };   // RU positions occupied per face
  missingData: RackMissing[];                 // one row per distinct SKU
};
export type RackEdit = { ok: true; layout: RackLayout } | { ok: false; reason: string };
```

**`src/lib/rack/part-facts.ts` exports:**
```ts
export function cleanRackFacts(input: Record<string, unknown>): { ok: true; patch: Partial<Record<RackFactKey, unknown>> } | { ok: false; error: string }
// Only keys PRESENT in input appear in patch. Blank string / null → undefined (clears). Numbers: finite, ≥ 0 (ruHeight > 0 and a multiple of 0.5); enums must match; rackNotes trimmed, capped 200.
// Error text: `Rack data: ${label} must be …` e.g. "Rack data: RU height must be a positive number in half-RU steps." / "Rack data: airflow must be one of front-to-rear, rear-to-front, side, passive."
export function rackFactsFromForm(fd: FormData): Record<string, unknown>   // reads only names present: rack_<key>
export function rackFactsOf(part: Partial<RackPartFacts> | null | undefined): RackPartFacts  // picks the keys, drops invalid
export function rackPartInfo(part: { sku: string; desc: string; mfr?: string } & Partial<RackPartFacts> | undefined, sku: string): RackPartInfo
export function rackDataCoverage(skus: readonly string[], lookup: RackPartLookup): { total: number; missing: Record<RackDataField, string[]> }
export const RACK_FACT_LABEL: Record<RackFactKey, string>
```

- [ ] **Step 1: Write failing tests** — add block `/* ===== #296 — catalog rack fields ===== */`:

```ts
import { cleanRackFacts as c296Clean, rackFactsOf as c296FactsOf, rackDataCoverage as c296Coverage, rackPartInfo as c296Info, rackFactsFromForm as c296FromForm } from "@/lib/rack/part-facts";
import { optionalPartFields as c296PartFields } from "@/app/(app)/catalog/part-form";
{
  const a = c296Clean({ ruHeight: "2", depthIn: "15.5", powerWatts: "0", airflow: "front-to-rear", rackWidth: "half" });
  ok(a.ok && a.patch.ruHeight === 2 && a.patch.depthIn === 15.5 && a.patch.powerWatts === 0 && a.patch.airflow === "front-to-rear" && a.patch.rackWidth === "half", "#296 catalog: rack facts parse, 0 W kept as measured");
  ok(a.ok && !("weightLb" in a.patch), "#296 catalog: an absent key stays out of the patch (never blanks)");
  const b = c296Clean({ weightLb: "" });
  ok(b.ok && "weightLb" in b.patch && b.patch.weightLb === undefined, "#296 catalog: a submitted blank clears the field");
  ok(!c296Clean({ ruHeight: "0" }).ok && !c296Clean({ ruHeight: "1.3" }).ok && c296Clean({ ruHeight: "0.5" }).ok, "#296 catalog: RU height > 0 in half-RU steps");
  ok(!c296Clean({ depthIn: "-1" }).ok && !c296Clean({ airflow: "up" }).ok && !c296Clean({ rackMount: "wall" }).ok, "#296 catalog: negatives and bad enums refused");
  const n = c296Clean({ rackNotes: "  needs 1U vent above " + "x".repeat(300) });
  ok(n.ok && typeof n.patch.rackNotes === "string" && (n.patch.rackNotes as string).length === 200 && (n.patch.rackNotes as string).startsWith("needs"), "#296 catalog: notes trimmed and capped at 200");
  ok(JSON.stringify(c296FactsOf({ ruHeight: 2, airflow: "up" as never, weightLb: -3 })) === JSON.stringify({ ruHeight: 2 }), "#296 catalog: rackFactsOf drops invalid stored values");
  const look = (s: string) => s === "A" ? c296Info({ sku: "A", desc: "Amp", ruHeight: 2, powerWatts: 300 }, "A") : s === "B" ? c296Info({ sku: "B", desc: "DSP" }, "B") : undefined;
  const cov = c296Coverage(["A", "B", "A"], look);
  ok(cov.total === 2 && cov.missing.ruHeight.join() === "B" && cov.missing.depthIn.join() === "A,B" && cov.missing.powerWatts.join() === "B", "#296 catalog: coverage lists distinct parts missing each field");
  ok(c296Info(undefined, "ZZ").found === false && c296Info(undefined, "ZZ").sku === "ZZ", "#296 catalog: unknown SKU resolves found:false");
  const fd = new FormData(); fd.set("rack_ruHeight", "1"); fd.set("rack_airflow", "side");
  const pf = c296PartFields(fd);
  ok(pf.ruHeight === 1 && pf.airflow === "side" && !("weightLb" in pf), "#296 catalog: part form carries only submitted rack fields");
  ok(Object.keys(c296FromForm(new FormData())).length === 0, "#296 catalog: an editor without the rack section submits nothing");
}
```
Plus source-text checks: `page.tsx` contains `<RackDataField`; `estimator/actions.ts` search mapping contains `rackFactsOf(`; `design/assemblies/actions.ts` contains `rackFactsOf(`.

- [ ] **Step 2:** Run `npm run test:specs 2>&1 | grep -E "#296|FAIL" | head` → FAIL (module missing).
- [ ] **Step 3: Implement.**
  - `types.ts` as above. `part-facts.ts` per the interface. Use `RACK_FACT_LABEL = { rackMount: "Rack mount", ruHeight: "RU height", rackWidth: "Rack width", depthIn: "Depth (in)", weightLb: "Weight (lb)", powerWatts: "Power (W)", maxPowerWatts: "Max power (W)", powerCapacityWatts: "Outlet capacity (W)", mountFace: "Mount face", airflow: "Airflow", rackNotes: "Rack notes" }`.
  - `CatalogPart`: add `/** #296 — rack data, optional; absent = unknown. Written only through mergeUpsert. */` and `& RackPartFacts`-equivalent keys (declare them inline as optional props, importing the enum types from `@/lib/rack/types`).
  - `optionalPartFields(fd)`: `const rack = cleanRackFacts(rackFactsFromForm(fd)); if (rack.ok) Object.assign(out, rack.patch);` Add a gate `rackFactsProblem(fd): string | null` returning `cleanRackFacts(...).error` so `upsertPart` redirects with `?partError=` like `fabricFactsProblem` (call it next to the existing gates in `catalog/actions.ts:97-100`).
  - `rack-data-field.tsx` (client): a `<details>` "Rack data" (open when any value set) with inputs named `rack_<key>`: selects for the 4 enums (first option "Unknown" value ""), number inputs (`step` 0.5 for ruHeight, 0.1 otherwise, min 0), text for notes (maxLength 200). Helper line: "Leave blank when unknown — blank is never read as zero." Rendered for every part (`editing && part`), after the fabric block.
  - Search hits: `CatalogHit` and `PartHit` gain `rack?: RackPartFacts`; both mappings add `rack: rackFactsOf(p)` (omit when empty object → `undefined`).
- [ ] **Step 4:** Run tests → all `#296 catalog` PASS. Run tsc, eslint, build.
- [ ] **Step 5: Commit** `feat(catalog): #296 optional rack data fields on catalog parts`.

---

### Task 2: Rack-data CSV export/import

**Files:**
- Create: `src/lib/rack/part-facts-sheet.ts`, `src/app/(app)/catalog/rack-data/page.tsx`, `.../rack-data/actions.ts`, `.../rack-data/rack-data-client.tsx`, `.../rack-data/export/route.ts`
- Modify: `src/app/(app)/catalog/documents/page.tsx` or the catalog page header — add a "Rack data sheet" link next to existing catalog tool links; `scripts/smoke-routes.ts` (add `/catalog/rack-data`, `/catalog/rack-data/export`)

**Interfaces — Produces:**
```ts
export const RACK_SHEET_HEADERS = ["SKU", "Manufacturer", "Description", "Rack mount", "RU height", "Rack width", "Depth (in)", "Weight (lb)", "Power (W)", "Max power (W)", "Outlet capacity (W)", "Mount face", "Airflow", "Rack notes"] as const;
export function rackSheetRows(grid: string[][]): { ok: true; rows: { line: number; sku: string; cells: Record<string, string> }[] } | { ok: false; error: string }
// header match: trim, lowercase, collapse spaces; SKU column required ("The sheet needs a SKU column."); unknown columns ignored; Manufacturer/Description are informational only (never written).
export function rackSheetPatch(cells: Record<string, string>): { ok: true; patch: Partial<RackPartFacts> } | { ok: false; error: string }
// ADDITIVE: blank cells are skipped (never clear); non-blank → cleanRackFacts. 
export function rackSheetExportGrid(parts: Array<{ sku: string; mfr?: string; desc: string } & Partial<RackPartFacts>>): string[][]
export type RackImportResult = { line: number; sku: string; status: "updated" | "unchanged" | "unknown-sku" | "invalid"; message?: string };
```
Server actions (`actions.ts`, `"use server"`, `requirePerm("create")`):
```ts
export async function previewRackDataAction(csvText: string): Promise<{ ok: true; results: RackImportResult[] } | { ok: false; error: string }>   // dry run, no writes
export async function applyRackDataAction(csvText: string): Promise<{ ok: true; results: RackImportResult[] } | { ok: false; error: string }>     // mergeUpsert(sku, patch) per changed row; revalidatePath("/catalog")
```
Cap 5,000 rows / 800 KB text ("The sheet is too large — split it into files of 5,000 rows or fewer."). Parse CSV with the import hub's `parseCsv` (find it under `src/app/(app)/import/parse.ts`; reuse, don't copy). Handle UTF-8 BOM (strip `﻿`).
Export route GET `requirePerm("create")`: `?scope=assemblies` (default) = every SKU referenced by any assembly record (`fixtureSkus` over `listFixtures()`) plus every part with any rack key set; `?scope=all` = whole catalog (category filter `?category=` optional). CSV, `content-disposition: attachment; filename="rack-data.csv"`, UTF-8 with BOM so Excel opens it.
Page: explains the flow (Download → fill → Upload → Preview → Import), file input reading text client-side, Preview table (status chips), Import button enabled after a clean preview, results summary ("12 updated · 3 unchanged · 1 unknown SKU"). Copy: "Blank cells never erase what's already saved."

- [ ] **Step 1: Failing tests** — block `#296 rack-data sheet`: headers round-trip (`rackSheetRows(rackSheetExportGrid([...]))` reproduces values), missing SKU column refused, blank cell skipped (patch has no key), invalid enum → `ok:false` with the field named, header aliases tolerate case/spacing (`"ru  height"`), BOM stripped. Async check `rack296SheetAsyncChecks()`: registerFixture a part, `mergeUpsert` it with `weightLb: 10`, run the pure plan + a direct apply helper (export `applyRackRows(rows, now)` from a server module `src/lib/rack/part-facts-sheet-server.ts` that the action wraps) with a row setting only `powerWatts` → stored part keeps `weightLb: 10` and gains `powerWatts`; unknown SKU reported `unknown-sku`; identical values report `unchanged`. Source checks: actions file contains `requirePerm("create")` twice.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests PASS; tsc/eslint/build; `npm run test:smoke` (new routes 200).
- [ ] **Step 5: Commit** `feat(catalog): #296 rack-data CSV export and additive import`.

---

### Task 3: Layout engine core

**Files:** Create `src/lib/rack/layout.ts`. Test in harness.

**Interfaces — Consumes:** types from Task 1. **Produces:**
```ts
export function laneCountOf(width: RackWidthClass | undefined): 1 | 2 | 3        // full/23in/undefined → 1, half → 2, third → 3
export function laneSpan(p: Pick<RackPlacement, "lane" | "laneCount">): [number, number]   // [lane/n, (lane+1)/n)
export function placementFacts(p: RackPlacement, lookup?: RackPartLookup): { depthIn?: number; weightLb?: number; powerWatts?: number; maxPowerWatts?: number; airflow?: Airflow; rackWidth: RackWidthClass; catalogRuHeight?: number }
// override > catalog > unknown. maxPowerWatts falls back to powerWatts when absent.
export function heightForPart(info: RackPartInfo | undefined, override?: number): number   // override ?? ceil(catalog ruHeight) ?? 1, min 1
export function childrenOf(layout: RackLayout, shelfId: string): RackPlacement[]
export function occupiedSpan(layout: RackLayout, p: RackPlacement): { lo: number; hi: number } | null  // null for shelf children; shelves extended by clearance (D575)
export function canPlace(layout: RackLayout, p: RackPlacement, opts?: { ignoreId?: string }): { ok: true } | { ok: false; reason: string }
export function place(layout: RackLayout, p: RackPlacement): RackEdit
export function move(layout: RackLayout, id: string, to: { ruStart?: number; face?: RackFace; lane?: 0 | 1 | 2 }): RackEdit   // moving a shelf moves its children (their ruStart follows)
export function remove(layout: RackLayout, id: string): RackEdit       // shelf with children → ok:false "Remove the 2 devices on this shelf first."
export function resize(layout: RackLayout, id: string, ruHeight: number): RackEdit
export function update(layout: RackLayout, id: string, patch: Partial<Pick<RackPlacement, "optional" | "override" | "costOverride" | "notes" | "label" | "lane" | "laneCount" | "face" | "sku">>): RackEdit
export function newPlacementId(now: number, seq: number): string        // "RP-" + now.toString(36).toUpperCase() + seq.toString(36).toUpperCase()
export function emptyRackLayout(ruCount?: number): RackLayout          // { config: { ruCount: 42, widthIn: 19, numbering: "bottom-up" }, placements: [] }
export function sanitizeRackLayout(input: unknown): { ok: true; value: RackLayout } | { ok: false; error: string }
```

**Rules for `canPlace` (each failure's `reason` text in quotes; `{ru}` = display RU range like "RU 12–13"):**
1. `ruHeight` integer ≥ 1 → else "Height must be a whole number of RU."
2. Top-level: `1 ≤ ruStart` and `ruStart + ruHeight − 1 ≤ ruCount` → "Doesn't fit — the rack has {ruCount} RU." 
3. `kind !== "reserved"` needs `sku` → "Pick a part for this slot."; reserved must have no sku.
4. Shelf child (`shelfId`): shelf must exist and be `kind: "shelf"` → "That shelf isn't in the rack."; a child cannot itself be a shelf or have children; lane intervals of children on the same shelf must not intersect → "Another device already sits there on the shelf."; clearance (child height − shelf height, if > 0) must be free on that face above the shelf → "Too tall for the shelf — {n} RU above it are taken." (computed via occupiedSpan of the shelf with the candidate included).
5. Overlap: for every other top-level placement on the same `face` whose occupiedSpan intersects the candidate's span AND whose lane intervals intersect → `"Overlaps ${label} at ${ru}."` (label = placement label ?? sku ?? "a reserved slot").
6. `lane < laneCount` → "That lane doesn't exist for this width."
All edits are immutable: clone arrays/objects, never mutate input (`structuredClone` is fine).

**`sanitizeRackLayout`:** shape-clean every field (unknown keys dropped; ids must match `/^RP-[A-Z0-9-]{1,40}$/` and be unique → "Two placements share the id RP-…"); `ruCount` 1–60 integer (else "A rack has 1–60 RU."); `widthIn` 19|23; `depthIn` optional > 0; `numbering` default bottom-up; max 300 placements ("A rack can hold at most 300 placements."); then re-check every placement with `canPlace(layoutWithoutIt, it)` and return the FIRST failure as `` `${label} (${ru}, ${face}): ${reason}` ``.

- [ ] **Step 1: Failing tests** — block `#296 rack layout core`, with a tiny builder `const P = (o: Partial<RackPlacement>): RackPlacement => ({ id: "RP-" + (o.id ?? "X"), kind: "device", sku: "S", ruStart: 1, ruHeight: 1, face: "front", ...o, id: "RP-" + (o.id ?? "X") })`. Cover: bounds (ruStart 0 → refuse; ruStart = ruCount fits 1U; 2U at top refuses), same face+lane overlap refused with label in reason, front vs rear same RU allowed, half-width pair (lane 0/1 of 2) allowed, full + half refused, half + third (lane 1 of 3 = [1/3,2/3) vs lane 0 of 2 = [0,1/2)) refused, reserved needs no SKU / device needs SKU, shelf child takes no RU (another device may sit at the shelf's RU+? only if clearance permits), child too tall when RU above occupied, remove shelf with children refused, move shelf moves children, `move` off the top refused, `update` laneCount change re-checked, `sanitizeRackLayout` rejects duplicate ids / 61 RU / overlap with the placement-named message / 301 placements, accepts a valid one byte-identically on a second pass (idempotent), and **immutability**: `const before = JSON.stringify(L); place(L, …); move(L, …); remove(L, …); ok(JSON.stringify(L) === before, …)`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + tsc/eslint.
- [ ] **Step 5: Commit** `feat(rack): #296 layout engine — placement rules and sanitize`.

---

### Task 4: Layout rules — firstFit, fill blanks, validate, totals, history

**Files:** Create `src/lib/rack/rules.ts`, `src/lib/rack/history.ts`.

**Produces:**
```ts
export function ruLabel(config: RackConfig, ru: number): number          // bottom-up → ru; top-down → ruCount − ru + 1
export function ruRangeLabel(config: RackConfig, lo: number, hi: number): string   // "RU 12" or "RU 12–13" (en dash), in display numbering, low→high display order
export function firstFit(layout: RackLayout, ruHeight: number, face: RackFace, width?: RackWidthClass): { ruStart: number; lane: 0 | 1 | 2 } | null   // lowest ruStart, then lowest lane
export function autoFillBlanks(layout: RackLayout, blankSku: string, newId: (i: number) => string): RackLayout
// one 1U blank (kind "blank", face "front", full width) in every RU where NO top-level placement's occupied span covers that RU on the front face (any lane) — reserved spans count as covered. Idempotent: a second call adds nothing.
export function validate(layout: RackLayout, lookup?: RackPartLookup): RackIssue[]
export function totals(layout: RackLayout, lookup: RackPartLookup, rackParts?: ReadonlyArray<{ sku: string; qty: number }>): RackTotals
```
`history.ts`:
```ts
export type RackHistory = { past: RackLayout[]; present: RackLayout; future: RackLayout[] };
export const HISTORY_CAP = 100;
export function historyOf(present: RackLayout): RackHistory
export function commit(h: RackHistory, next: RackLayout): RackHistory      // push present to past (cap), clear future; no-op if JSON-equal
export function undo(h: RackHistory): RackHistory
export function redo(h: RackHistory): RackHistory
```

**`validate` issues (code — level — message):**
- every `sanitizeRackLayout`-level geometry failure → `error` (reuse `canPlace` against the rest), code `overlap|bounds|shelf|sku`.
- `unknown-sku` — warning — `` `${sku} isn't in the catalog — it prices at $0 unless overridden.` `` (lookup given and `found === false`).
- `height-mismatch` — warning — when catalog ruHeight (ceil) ≠ placement ruHeight and no `override.ruHeight`: `` `${label}: the catalog says ${n} RU.` ``
- `half-ru` — warning — catalog ruHeight not whole: `` `${label} is ${x} RU — laid out as ${ceil} RU.` ``
- `width-23` — warning — `config.widthIn === 23` and any device: "19 in gear in a 23 in rack needs adapters." (once, all device ids)
- `depth` — warning — `config.depthIn` set: a placement deeper than the rack → `` `${label} is deeper (${d} in) than the rack (${D} in).` ``; front+rear placements whose spans intersect with depth sum > rack depth → `` `${a} and ${b} clash in depth at ${ru} (${sum} in of ${D} in).` ``
- `shelf-unknown-height` — warning — child with no catalog ruHeight and no override.
- `airflow` — warning — two vertically adjacent (spans touch: hi+1 === lo) front-face devices where one is front-to-rear and the other rear-to-front or side, with no vent/blank between → `` `${a} and ${b} move air in opposite directions with nothing between them.` ``
- `heat` — warning — any window of HEAT_WINDOW_RU contiguous RU with included device watts (spans intersecting the window, full watts counted once) > HEAT_WATTS_PER_WINDOW and no `vent` placement intersecting it → `` `${W} W in ${ruRange} with no vent panel.` `` (report each maximal run once, not every window).
- `optional-mixed` — warning — a SKU with both optional and included placements: `` `${sku}: the Estimator offers optional add-ons per part — ${n} optional of ${m} placed will not show as a separate add-on.` `` (D574)
Errors first, then warnings, stable order by RU.

**`totals`:** ruUsed = count of RU positions (1..ruCount) covered by any non-reserved top-level span on either face; ruReserved = positions covered only by reserved spans; ruFree = ruCount − ruUsed − ruReserved; byFace = positions covered per face (non-reserved). Weight/watts/maxWatts sum over placements with a sku (including shelf children) — `optional` excluded from the main numbers, included in `withOptions`; plus `rackParts` (qty × facts). Unknown values contribute 0 AND add the field to `missingData` for that SKU (blank/vent/shelf kinds: unknown watts treated as 0 and NOT flagged — D576; reserved: ignored). ruHeight/depthIn missing tracked for placements only. capacityWatts = Σ `powerCapacityWatts × qty` over rackParts and placements that have it, else `null`. amps = `round1(watts / 120)`. btuHr = `Math.round(watts × 3.412)`. Round weight to 0.1.

- [ ] **Step 1: Failing tests** `#296 rack rules`: firstFit lowest fit / null when full / honors face / half-width lands in lane 1 beside an existing half in lane 0; autoFillBlanks fills only empty RU, skips reserved and shelf clearance, idempotent, input unchanged; each validate code triggers on a minimal fixture and does NOT trigger on a near-miss (e.g. vent between devices clears airflow); totals: unknown watts not counted as zero (missingData lists the SKU with "powerWatts"), optional excluded by default but in withOptions, BTU = round(W × 3.412) (e.g. 1000 W → 3412), capacity from a PDU rack-level part, blanks never flagged, ruUsed/ruReserved/ruFree arithmetic with a 4U reserved; history commit/undo/redo/cap 100 and no-op commit on equal layout; ruLabel top-down maps 1 ↔ 42.
- [ ] **Step 2–4:** FAIL → implement → PASS, tsc/eslint.
- [ ] **Step 5: Commit** `feat(rack): #296 fill blanks, validation, totals, undo history`.

---

### Task 5: Elevation geometry + SVG

**Files:** Create `src/lib/rack/geometry.ts`, `src/lib/rack/svg.ts`. Reuse `Shape`/`ShapeLabel`/`textExtent` from `@/lib/curtain-cut-sheets/shapes` (type import + `textExtent`).

**Produces:**
```ts
export type RackSlot = { placementId: string; x: number; y: number; w: number; h: number; face: RackFace };
export type RackGeometryOpts = { face: RackFace; numbering?: RackConfig["numbering"]; ghostOppositeFace?: boolean; title?: string };
export function rackGeometry(layout: RackLayout, lookup: RackPartLookup, opts: RackGeometryOpts): { viewBox: { w: number; h: number }; shapes: Shape[]; slots: RackSlot[] }
export function shapesToSvg(shapes: readonly Shape[], viewBox: { w: number; h: number }, opts?: { title?: string; className?: string }): string
export function renderRackElevationSvg(layout: RackLayout, lookup: RackPartLookup, opts: RackGeometryOpts): string
export const RACK_GEOM = { railIn: 1.6, panelIn: 19, marginIn: 0.6, labelSize: 0.55, ruNumberSize: 0.45 } as const;
```
Drawing units = inches. Layout: left rail `[margin, margin+rail]`, panel `[margin+rail, margin+rail+19]`, right rail after; total w = 2·margin + 2·rail + 19. Height = 2·margin + ruCount·1.75 (+ title band 1.2 when `title`). RU 1 at the bottom: y of RU r top edge = margin + (ruCount − r)·1.75 (+ title band). RU numbers (display numbering) centered in both rails; every 5th RU number `bold`. Hairline (`thin`) between RU rows on the rails. Each top-level placement on `opts.face` → rect (x by lane interval inside the panel, inset 0.04), `stroke: "med"`, fill: device `none`, blank/vent `tone`, reserved `hatch`; `dash: true` when optional. Device label text centered: `label ?? desc` (truncate to fit width using `textExtent`, add "…"), plus a second smaller line with `mfr sku` when height ≥ 2 RU. Vent adds 3 short horizontal lines (tag "band"). Reserved text "Reserved — future". Shelf: rect + its children drawn as rects sitting on the shelf's top edge inside the shelf/clearance span, per lane. `ghostOppositeFace`: full-depth opposite-face placements drawn as `dash` rects with no fill/label (only when the facts' depthIn is unknown or > half the rack depth). Slots: one per drawn top-level placement and per shelf child. Deterministic: same input → same string (no random ids; number formatting via `+n.toFixed(3)`).
`shapesToSvg`: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H" …>` + escaped text (`& < > " '`), stroke widths via `vector-effect="non-scaling-stroke"` and `stroke-width` 0.6/1/1.6 px for thin/med/heavy, `currentColor` strokes, tone fill `#00000014`, hatch via a single `<defs><pattern id="rk-hatch">` (45° lines), solid `currentColor`. Text: `font-family="Arial, Helvetica, sans-serif"` `font-size` in user units.

- [ ] **Step 1: Failing tests** `#296 rack geometry`: snapshot-like structural checks (not full-string goldens, which are brittle): empty 42U → viewBox h = 2·0.6 + 42·1.75, 84 RU-number texts (42 per rail), RU "5"/"10" bold; a 2U device at RU 1 → its rect bottom edge = panel bottom; half-width pair → two rects each ≈ 9.5 in wide, side by side; optional → `dash: true`; reserved → `fill: "hatch"` and text "Reserved — future"; rear-face placement absent from front geometry and present in rear; top-down numbering flips the labels; `renderRackElevationSvg` deterministic (two calls equal), escapes `<b>&` in a label, contains `vector-effect="non-scaling-stroke"`; slots count = drawn placements.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(rack): #296 elevation geometry and SVG serializer`.

---

### Task 6: The `rack` assembly kind — model, sanitize, pricing, store

**Files:** Modify `src/lib/fixture-assemblies.ts`, `src/lib/fixtures-convert.ts` (:145-159), `src/lib/stores/fixtures.ts` (:74, :111), `src/app/(app)/design/assemblies/actions.ts` (:70 message).

**Changes (exact):**
- `export type FixtureKind = "fixture" | "system" | "hardware" | "rack";`
- `FixtureRecord`: add `/** #296 — rack only: the RU layout. Placed devices live here, never in \`parts\`. */ rack?: RackLayout;` `scope` comment now "System and rack".
- `FixtureResolvable`: add `"rack" | "scope"` to the Partial pick.
- `FixtureSlot` adds `"rack"`.
- `fixtureLineParts(r)`: for `kind === "rack"`, return `rackLines(r)` = rack-level `parts` lines (slot "parts") **followed by** placement groups (slot "rack"): group placements with a `sku` (any kind except reserved, including shelf children) by SKU in first-appearance RU order (sort placements by ruStart, then face front first, then lane); `qty` = count of non-optional; if 0 non-optional → qty 0 (optional add-on); `costOverride` = when any placement in the group has one, the mean over included placements of (override ?? undefined→catalog cost) — implement by carrying `costOverrides: (number|undefined)[]` and resolving in `resolveFixture` where catalog cost is known: unit cost = mean of (o ?? catalogCost) over included placements (over all when none included); `label` = first placement's label.
- `resolveFixture`: handles the rack slot via the above; nothing else changes (totals/pricesAsOf/missing generic).
- `sanitizeFixtureInput`: kind coercion `i.kind === "system" ? … : i.kind === "hardware" ? "hardware" : i.kind === "rack" ? "rack" : "fixture"`. New rack branch: label required; scope required (`"Pick a scope for the rack."`); `parts` cleaned like system (200-line cap, duplicate-SKU check, qty ≥ 0) but MAY be empty; `rack` via `sanitizeRackLayout` (error passes through, prefixed "Rack: "); must have ≥ 1 placement with a sku or ≥ 1 part → `"Add at least one device or rack-level part to the rack."`; a SKU both placed and in parts → `` `${sku} is placed in the rack — remove it from the rack-level parts.` ``. Returns `{ kind:"rack", label, description, scope, lightEngineSku:"", lensSku:null, lines: emptyBoxes, parts, rack }`. Placement SKUs are NOT subject to the one-SKU rule (D574).
- `CleanFixture` already Omit-derives; ensure `rack` survives.
- `ASSEMBLY_GROUPS` add `{ kind: "rack", label: "Racks" }` (after Hardware). `assemblyOptionLabel`: rack appends ` (Scope)` like system. `allAssembliesFrom`: rack rows carry `scope`. `groupAssemblies` unchanged otherwise.
- `toResolvedAssembly`: rack-slot parts map to role `"other"`; `SLOT_ROLE.rack = "other"`.
- `fixtures-convert.ts` `normalizeFixtureRow`: kind coercion includes rack; keep `parts` for non-fixture (already); keep `rack` when kind is rack (run it through `sanitizeRackLayout`; on failure keep the raw-cleaned layout and set `needsReview: true` — never drop a stored rack).
- `stores/fixtures.ts`: `OPTIONAL_FIXTURE_FIELDS` add `"rack"`.
- `actions.ts:70` message → `"An assembly can't change kind after it's created."`

- [ ] **Step 1: Failing tests** `#296 rack kind`: sanitize — missing label, missing scope, empty rack (no placements, no parts) refused; invalid placement refused naming the placement; 301 placements refused; duplicate SKU in `parts` refused; same SKU on 4 placements accepted; SKU both placed and in parts refused; kind "rack" round-trips (and an unknown kind still coerces to fixture — regression). Pricing via `resolveFixture` with a Map catalog: 4 × amp ($100 cost / $150 list) + 1 optional amp + 1 reserved + 1 blank ($5/$8) + rack-level frame qty 1 ($400/$600) → cost 4·100+5+400 = 805, sell 4·150+8+600 = 1208; a placement `costOverride: 80` on 1 of the 4 → cost drops by 20; missing SKU placement → $0 and listed in `missing`; all-optional SKU → part with qty 0, `included: false`. `allAssembliesFrom` lists the rack under its own group with scope; `assemblyOptionLabel` → "Name (Audio)". `toResolvedAssembly` components: amp `defaultQty 4`. `fixturesConvert` normalization keeps kind rack + layout. Regression: an existing fixture/system/hardware fixture resolves to the same totals as before (pick existing #210 test fixtures — run the whole harness, 0 FAIL). Source check: `fixture-builder.tsx`… (not yet) — skip. Async `rack296KindAsyncChecks()`: `createFixture` a rack → `getFixture` returns `kind: "rack"` with the layout; `updateFixture` with kind fixture keeps `kind: "rack"`.
- [ ] **Step 2–4:** FAIL → implement → PASS (full harness 0 FAIL), tsc (fix every `Record<FixtureKind, …>` compile error by adding a rack entry — e.g. `fixture-builder.tsx` `FILTER_LABEL`/`counts` get minimal `rack` entries now; the real UI lands in Task 9), eslint.
- [ ] **Step 5: Commit** `feat(assemblies): #296 rack kind — model, sanitize, pricing`.

---

### Task 7: Consumers — Grid, Equipment map, Auto swap, Estimator rackId

**Files:** Modify `src/lib/design/grid-virtual-parts.ts:104`, `src/lib/design/equipment-map-view.ts:105,154`, `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx:230,242`, `src/lib/design/auto-estimate.ts:272-279`, `src/app/(app)/design/grid/[id]/actions.ts:240`, `src/app/(app)/estimator/fixture-bom.ts`, `src/app/(app)/estimator/estimator-client.tsx:~2375`, `src/app/(app)/estimator/types.ts` (SpecItem).

**Changes:**
- Grid layer: `f?.kind === "system" || f?.kind === "rack" ? SYSTEM_SCOPE_LAYER[f.scope || ""] ?? UNSCOPED : …`. Dead rule unchanged (generic).
- Equipment map view detail: rack → `` `Rack · ${scope}` ``; `assemblyOptions` scope: rack → its scope or "Other". Client label: rack → "Rack"; picker caption "Assembly (fixture, system, hardware or rack)".
- `assemblySwapCandidates`: racks match by `f.scope === scopeLabel` (falls out of the existing else-branch once `scope` is set — verify and add a test).
- Grid swap hit description: map kind to a word (`fixture`/`system`/`hardware`/`rack`) — keep `(${f.kind})` but confirm rack reads "(rack)".
- `SpecItem` gains `/** #296 — the rack assembly this line was configured from (D578). */ rackId?: string;`. `FixtureBomLine` gains `rackId?: string`; `fixtureBomLine` sets `rackId: assembly.id` when `assembly.kind === "rack"`. In `estimator-client.tsx`, the code that builds the SpecItem from `line` spreads `...(line.rackId ? { rackId: line.rackId } : {})`. Check the save sanitizer for estimator items (grep `fixtureId` in the quote save/sanitize path, e.g. `src/lib/stores/quotes.ts` or `estimator/sanitize*.ts`) and whitelist `rackId` (string ≤ 40, `/^SA-/`) the same way `fixtureId` is kept.
- Estimator `parts-csv.ts`: verify components expand for racks (no code change expected; add a test).

- [ ] **Step 1: Failing tests** `#296 rack consumers`: `virtualPartsFor` puts an Audio rack on the Audio layer and a Controls rack on Unscoped; a rack with no priced parts is dead and named; `gridSpecBomRows` expands an `asm:` rack into its placements' SKUs (qty × count) + parts; `assemblySwapCandidates` offers an Audio rack on the Audio row only; equipment-map detail text "Rack · Audio"; `fixtureBomLine` on a rack returns `rackId`, on a fixture does not; quote item sanitize keeps a valid `rackId` and drops `"x"`; parts CSV of an estimate with a rack line lists the amp × 4.
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc/eslint/build (client file touched).
- [ ] **Step 5: Commit** `feat(assemblies): #296 racks in Grid, Equipment map, Auto swap and Estimator`.

---

### Task 8: Shared `RackElevation` + `useRackEditor`

**Files:** Create `src/components/rack/RackElevation.tsx` (`"use client"`), `src/components/rack/useRackEditor.ts`, `src/components/rack/PlacementMenu.tsx`.

**Interfaces:**
```ts
// RackElevation (controlled, no fetching/persistence — the Grid adopts this later)
export type RackElevationProps = {
  layout: RackLayout;
  lookup: RackPartLookup;
  face: RackFace | "both";
  mode: "edit" | "view";
  selection: string[];
  armed?: { sku: string; kind: PlacementKind; ruHeight: number; width: RackWidthClass; label?: string } | null;
  issues?: RackIssue[];
  onPlace?: (p: { ruStart: number; face: RackFace; lane: 0 | 1 | 2 }) => void;   // armed click / drop from picker
  onMove?: (id: string, to: { ruStart: number; face: RackFace; lane: 0 | 1 | 2 }, copy: boolean) => void;
  onSelect?: (ids: string[]) => void;
  onMenu?: (id: string, at: { x: number; y: number }) => void;
  onKey?: (e: React.KeyboardEvent) => void;
  scale?: number;           // px per inch, default 14
};
// useRackEditor
export function useRackEditor(initial: RackLayout, opts: { onChange: (l: RackLayout) => void; newId: () => string }): {
  layout: RackLayout; canUndo: boolean; canRedo: boolean; error: string | null;
  apply: (edit: (l: RackLayout) => RackEdit) => boolean;   // commits on ok, sets error on failure (cleared on next success)
  undo: () => void; redo: () => void; reset: (l: RackLayout) => void;
};
```
**Rendering:** each face panel = a `<div style="position:relative">` containing (1) the static SVG from `renderRackElevationSvg(layout, lookup, { face, ghostOppositeFace: face==="rear" })` via `dangerouslySetInnerHTML` (our own escaped serializer — add a one-line comment saying so) and (2) an overlay `<svg>` with the same viewBox holding: transparent hit rects per RU row × lane (for armed placement / drop targets), a ghost rect snapped to the hovered RU (green `--pk-ok`-style token or `var(--accent)` outline when `canPlace` ok, red dashed with the reason in a `<title>` and a small floating caption when not), selection outlines (accent, 2px) from `slots`, and focusable `<rect tabIndex={0} role="button" aria-label="RU 12–13, front: QSC CXD4.3">` per slot. `face="both"` renders front and rear side by side with captions "Front" / "Rear". Use CSS vars from `globals.css` (find existing `--pk-*` tokens; never hardcode the accent).
**Interactions (edit mode):** armed + hover → ghost; click → `onPlace`; `Escape` handled by parent (`onKey`). Drag-from-picker: accept HTML5 drop with `dataTransfer` type `application/x-rack-part` (JSON `{sku, ruHeight, width, kind, label}`) — parent arms on dragstart; drop calls `onPlace`. Placed device: pointerdown on slot → select (Shift adds/toggles); drag beyond 4px → ghost follows pointer snapped by RU; pointerup → `onMove(id, to, e.altKey)`. Right-click or a kebab button on the selected slot → `onMenu`. Keyboard on the focused panel: forwarded through `onKey` (parent maps ArrowUp/Down → move ±1 RU, Delete/Backspace → remove, Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z → redo, Escape → disarm/clear). Touch: tap = click (no hover dependence: on touch, a tap on a row with armed part places directly; long-press 500 ms on a slot → `onMenu`).
**PlacementMenu:** a small popover (portal to body, positioned at `at`) with: Face (Front/Rear), Width (Full/Half/Third + lane select), Override height/depth/weight/watts (number inputs, blank = use catalog), Optional (checkbox), Replace part (opens the parent's picker in "replace" mode — prop callback), Notes, Duplicate ×N (N input, uses `firstFit` per copy, reports how many fit), Remove. Each change calls a prop `onEdit(edit: (l) => RackEdit)`. Close on Escape / outside click; focus returns to the slot.

- [ ] **Step 1: Tests** (harness, source-text + pure): `RackElevation.tsx` has no value import from `@/lib/stores` or `@/db`; contains `renderRackElevationSvg(`; contains `aria-label`; `useRackEditor.ts` imports `commit`, `undo`, `redo` from `@/lib/rack/history`. Pure helper `slotAriaLabel(p, info, config)` exported from `src/lib/rack/geometry.ts` (add there) → `"RU 12–13, front: QSC CXD4.3"`; `ruFromPointer(yIn, config, ruHeight)` (in geometry.ts) maps a y coordinate in drawing inches to a snapped ruStart clamped to bounds — test both.
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc/eslint/build.
- [ ] **Step 5: Commit** `feat(rack): #296 shared rack elevation component and editor hook`.

---

### Task 9: Builder — Racks tab, rack form, sidebar, defaults

**Files:** Create `src/components/rack/RackSidebar.tsx`, `src/lib/stores/rack-defaults.ts`, pure `src/lib/rack/defaults.ts` (`sanitizeRackDefaults`). Modify `src/app/(app)/design/assemblies/{fixture-builder.tsx,fixture-form.tsx,page.tsx,actions.ts}`. Smoke: `/design/assemblies?tab=rack` if `?tab` is honored (it redirects — check `page.tsx:31`; otherwise just `/design/assemblies`).

**Behavior:**
- Tabs: All · Fixtures · Systems · Hardware · Racks (`FILTER_LABEL.rack = "Racks"`, counts). "+ New assembly" chooser gains "Rack" → `emptyDraft("rack")` with `rack: emptyRackLayout()` and `scope: ""`.
- List rows for racks: badge `Rack · ${scope}`; summary `` `${ruUsed}/${ruCount} RU · ${watts} W` `` (prefix "≥ " when `missingData` non-empty) computed with `totals()` over the page's catalog seed (extend the page's referenced-SKU read to include placement SKUs — it already uses `fixtureSkus` which now covers them; ensure the seed rows carry rack facts: build the lookup from catalog rows with `rackPartInfo`). The seed type passed to the client gains `rack?: RackPartFacts` per SKU.
- `Draft` gains `rack?: RackLayout`; `draftFromRecord`/`draftToInput`/`draftResolvable` carry it. `fixture-form.tsx` for `kind === "rack"`: noun "rack", help text "Lay out devices in the rack on the right. Rack-level parts (frame, rails, PDUs, casters, fans, cable management, labor) go in the parts list — they take no RU.", label placeholder "e.g. AV head-end rack", Scope select (required), rack size select (RU 1–60, default 42; shrinking below the highest occupied RU is refused with the engine's message), rack depth input (in, optional), numbering toggle (bottom-up/top-down), the single "Rack-level parts" `LineBox`. No light-engine fields (fix line :344 so only `kind === "fixture"` shows them).
- Layout: when `kind === "rack"` the form becomes a two-column grid (`lg:grid-cols-[1fr_auto]`); the right column is `<RackSidebar>` (collapsible; width + open state in localStorage key `pk-rack-sidebar`, try/catch).
- `RackSidebar` props: `{ layout, onChange, lookup, partSearch: (q) => Promise<PartHit[]>, defaults: { blankSku?: string; ventSku?: string }, onSaveDefaults, rackParts: {sku, qty}[] }`. Contents: header (rack label, `ruCount`U, face toggle Front/Rear/Both, numbering toggle), a compact part picker (reuses `usePartSearch` — move it to an exported hook in `fixture-form.tsx` or a tiny `src/app/(app)/design/assemblies/use-part-search.ts`) whose results are click-to-arm and draggable; "Rack hardware" tray with Blank / Vent / Shelf / Reserved buttons (Blank/Vent arm the default SKU; if unset, show "Set default blank…" which opens the picker in "set default" mode and calls `onSaveDefaults`); `RackElevation`; Undo/Redo buttons; "Fill blanks" (disabled without a default blank SKU; tooltip says why); totals footer (`RU used / free · reserved`, weight lb, W / max W, BTU/hr, amps @120 V, capacity when known, "at least … (n parts unknown)" with a details list of `missingData`), coverage chips ("3 parts missing RU height"), issues list (errors red, warnings amber; click selects `placementIds`). Placing an armed part: height = `heightForPart(info)`, width from facts (`rackWidth`, default full), face from `mountFace === "rear" ? "rear" : current face (front when "both")`, kind from armed tray type (device by default; a part whose `rackMount === "shelf"`… is still a device — shelves come only from the Shelf tray button, which arms a part search for the shelf SKU).
- Unsaved-changes guard: `beforeunload` while the draft differs from the saved record (rack kind only is fine, but apply to all kinds if trivial).
- Defaults: `rack-defaults.ts` (`getRackDefaults()`, `saveRackDefaults(input)` via `getBlob/setBlob("rack_defaults")`), action `saveRackDefaultsAction(input)` in assemblies `actions.ts` with `requireUser()` + `can("create", user.roles)` check returning `{ok:false,error:"Needs the Create permission."}`; page passes `defaults` down.
- Save: existing `saveFixtureAction` (rack passes through sanitize). Show the server's error text in the form.

- [ ] **Step 1: Tests:** `sanitizeRackDefaults` (keeps two trimmed SKUs ≤ 80 chars, drops others); async `rack296DefaultsAsyncChecks` save/get round-trip; source checks: `fixture-builder.tsx` contains `"rack"` in the tab list and `start("rack")`; `fixture-form.tsx` contains `RackSidebar` and the light-engine branch is guarded by `kind === "fixture"`; `RackSidebar.tsx` has no value import from stores/db; `actions.ts` `saveRackDefaultsAction` checks `can("create"`.
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc/eslint/build; smoke.
- [ ] **Step 5: Browser verification** (controller does this after the task, see "Verification" below).
- [ ] **Step 6: Commit** `feat(assemblies): #296 Racks tab, rack form and RU sidebar`.

---

### Task 10: Submittal model (pure)

**Files:** Create `src/lib/rack/submittal.ts`.

**Produces:**
```ts
export type ScheduleRow = { ru: string; face: "Front" | "Rear" | ""; qty: number; mfr: string; sku: string; desc: string; depthIn: number | null; weightLb: number | null; watts: number | null; notes: string; optional: boolean; reserved: boolean };
export type RackLevelRow = { qty: number; mfr: string; sku: string; desc: string; weightLb: number | null; watts: number | null };
export type RackSubmittal = {
  title: string; scope?: string; ruCount: number;
  schedule: ScheduleRow[];        // top→bottom by display order (highest RU first), front before rear at equal RU; reserved rows desc "Reserved — future"; shelf children listed right after their shelf with ru "on shelf RU n"
  rackLevel: RackLevelRow[];
  totals: RackTotals;
  issues: RackIssue[];            // from validate()
  power: { circuitAmps: number; capacityWatts: number | null; loadPct: number | null; lines: string[] };   // human lines, e.g. "At least 1,240 W typical (2 parts unknown)", "10.3 A at 120 V", "PDU capacity 1,800 W — 69% loaded"
  datasheetSkus: string[];        // distinct, RU order (top→bottom) then rack-level parts in list order; no reserved
  gaps: { sku: string; label: string; kind: "missing-data" | "missing-datasheet" | "missing-catalog"; detail: string }[];  // datasheet gaps added by the server step
};
export function rackSubmittal(rec: Pick<FixtureRecord, "label" | "scope" | "rack" | "parts">, lookup: RackPartLookup): RackSubmittal
export function scheduleCsv(s: RackSubmittal): string     // header: RU,Face,Qty,Manufacturer,Model/SKU,Description,Depth (in),Weight (lb),Watts,Notes ; then a blank line + "Rack-level parts" section; RFC-4180 quoting; "\r\n" line endings
export function formatWatts(n: number): string           // "1,240 W"
```
Identical placements are one row each (RU differs); `qty` is 1 per placement row; rack-level rows carry their qty. Unknown numbers → `null` (printed "—", never 0). Optional rows `notes` prefixed "Optional — ".

- [ ] **Step 1: Failing tests** `#296 rack submittal` — golden rows for a 10-device fixture rack (mix of 1U/2U, a shelf with two half-width items, 1 rear, 1 optional, 4U reserved, 1 part missing watts): row order, RU strings ("RU 12–13", "on shelf RU 5"), reserved row text, `power.lines[0]` starts "At least" and says "(1 part unknown)", `datasheetSkus` order and distinctness, `scheduleCsv` first line exact header and quoting of a comma-containing description, `formatWatts(1240) === "1,240 W"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(rack): #296 submittal model — schedule, power/heat, CSV`.

---

### Task 11: Printed sheets — print route + staff preview

**Files:** Modify `src/lib/quote-pdf/token.ts` (`PrintTokenKind` adds `"rack"`). Create `src/components/rack/RackSheets.tsx` (server-renderable, no `"use client"`), `src/app/print/rack/[id]/page.tsx`, `src/app/(app)/design/assemblies/rack/[id]/page.tsx`, `src/lib/rack/load.ts` (server: `loadRackForSheets(id) → { rec, lookup, submittal, dateLabel } | null` — `getFixture`, must be `kind === "rack"`, catalog `getMany(skus)` → `rackPartInfo` lookup).

**Behavior:**
- `RackSheets({ sheet: "elevation" | "schedule" | "power" | "all", data, logoUrl? })`:
  - Elevation: **Letter landscape** by default (`@page { size: 11in 8.5in; margin: 0 }`, reuse `.pk-drawing-sheet/.pk-drawing-frame/.pk-drawing-area` styles the cut-sheet submittal uses, `TitleBlock` with `titleBlockData({ project: rec.label, sheetTitle: "Rack elevation", sheetNo: "R-1", date, revision })` — read `titleBlockData`'s `TitleBlockInput` and fill what it requires). Front elevation (and rear, side by side, when any rear placement exists), each the `renderRackElevationSvg` string in a sized `<div>` (`dangerouslySetInnerHTML`), captions "Front" / "Rear", legend row: dashed = optional, hatched = reserved, tone = blank/vent; note "For submittal — not for construction."
  - Schedule: Letter landscape table (Arial 9pt) of `schedule` rows, then "Rack-level parts" table. Unknowns "—".
  - Power/heat: Letter portrait page: totals grid (RU used/free/reserved, weight, typical W, max W, BTU/hr, amps @120 V, capacity + % loaded), the `power.lines`, then "Warnings" list from `issues` (errors too), then "Parts missing data" list from `missingData`.
  - Peak letterhead/footer: reuse the logo/branding pattern the cut-sheet client pages use (find how `CutSheetPages` gets `photos`/logo; if a shared letterhead component exists use it; otherwise company name from settings in the footer). Font Arial for these pages.
- Print route: `force-dynamic`, `robots: noindex`, query `?sheet=elevation|schedule|power&t=…`; `verifyPrintToken(AUTH_SECRET, t, "rack", id, now)` before any read → `notFound()`; inline the `@page` CSS for the chosen sheet (each sheet rendered alone so each PDF has one page orientation).
- Staff preview `/design/assemblies/rack/[id]`: `requireUser()`; shows all three sheets stacked with `PrintButton` and a "Download submittal (.zip)" link to `/api/racks/[id]/submittal` (Task 12), plus "Schedule (.csv)" link to `/api/racks/[id]/submittal?part=csv`. Builder list row for a rack gains "Submittal" link → this page; the rack form header too (when saved).
- **Sidebar = print equality:** both call `renderRackElevationSvg` with the same options for the same face → identical string. Test it.

- [ ] **Step 1: Tests:** token sign/verify for kind `"rack"`; `print/rack/[id]/page.tsx` source contains `verifyPrintToken(` before `loadRackForSheets(` (index comparison) and `notFound()`; equality: `renderRackElevationSvg(L, look, {face:"front"})` called the way `RackSheets` calls it equals the way `RackElevation` calls it — export a shared `elevationSvgFor(layout, lookup, face)` from `src/lib/rack/svg.ts` and assert both files call `elevationSvgFor(` (source check) + one pure equality assert; smoke entry `/design/assemblies/rack/SA-NOPE` expecting 404-safe render (use the smoke harness's notFound convention — check how other `[id]` routes are listed; if smoke can't express it, skip and note).
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc/eslint/build; smoke.
- [ ] **Step 5: Commit** `feat(rack): #296 printed elevation, schedule and power/heat sheets`.

---

### Task 12: Datasheet package + zip download

**Files:** `npm install pdf-lib@^1.17.1` (exact pin in package.json like other deps; commit lockfile). Create `src/lib/rack/submittal-server.ts`, `src/app/api/racks/[id]/submittal/route.ts`. Modify `next.config.ts` (`outputFileTracingIncludes` add `"/api/racks/[id]/submittal": ["./node_modules/@sparticuz/chromium/bin/**"]` matching the existing entries' shape).

**Produces:**
```ts
export const RACK_SUBMITTAL_DEADLINE_MS = 90_000;
export async function rackSubmittalFiles(id: string, where: PrintWhere, opts: { deadline: number; render?: typeof renderPrintRouteToPdf; now?: () => number }): Promise<{ ok: true; folder: string; files: ZipFile[]; gaps: RackSubmittal["gaps"] } | { ok: false; error: string }>
// folder = safeName(rec.label); files (relative names, caller prefixes): elevation.pdf, schedule.pdf, power-heat.pdf, schedule.csv, datasheets.pdf
export async function mergeDatasheets(entries: { sku: string; label: string; bytes: Buffer | null; reason?: string }[], title: string): Promise<Buffer>
// cover page (pdf-lib StandardFonts.Helvetica, Letter): title "<rack> — datasheets", index table in order (SKU, part, page n), then "Not included" list of gaps (no datasheet / unreadable PDF); then each datasheet's pages appended (a PDF that fails to load → gap, skipped). Each distinct document once even if it covers several SKUs.
```
- Datasheets: `loadPartDocsState(parts)` + `resolvePackageDocs(index, datasheetSkus)` (datasheet slot only, `slotSatisfied` coverage), read bytes with the existing blob stream helper (`getBlobStream` — collect to Buffer, cap 25 MB each, 60 MB total → remaining become gaps "package size limit"). Missing doc → gap `missing-datasheet`; SKU not in catalog → `missing-catalog`; parts in `missingData` → `missing-data` gaps (detail lists the fields).
- PDFs: each sheet `signPrintToken("rack", id)` right before its render, URL `${origin}/print/rack/${id}?sheet=…&t=…`, sequential, `rejectAfter`/timeout pattern from `curtain-cut-sheets/package-sheets.ts` (import its helpers `renderTimeoutMs`/`rejectAfter` from `curtain-cut-sheets/deadline.ts` if exported; else reimplement minimal). A failed render → omitted file + a gap `{ kind: "missing-data", detail: "Elevation PDF could not be rendered — use the preview page's Print." }` (staff-facing zip, so the detail can be specific).
- Route GET `/api/racks/[id]/submittal`: `requireUser()`; `export const maxDuration = 120`; `?part=csv` → just `schedule.csv` (no Chrome); default → zip via `createStoredZip` of `${folder}/…` files + `${folder}/00-gaps.txt` (one line per gap) ; headers `content-type: application/zip`, `content-disposition: attachment; filename="<folder>-submittal.zip"` (RFC 5987 `filename*` for non-ASCII), `cache-control: private, no-store`. Origin via `printOriginFor(process.env, host, proto)`; on `{error}` → 503 text with the error.

- [ ] **Step 1: Tests:** `mergeDatasheets` with two tiny generated PDFs (build them with pdf-lib in the test) + one `null` entry → output loads in pdf-lib, page count = 1 cover + pages of both, cover text (extract via `PDFDocument` is hard — instead export `datasheetCoverLines(entries)` pure and assert it lists the gap); a corrupt bytes entry becomes a gap not a throw; source checks: route has `requireUser()` and `maxDuration = 120`; `next.config.ts` lists the route; async check with a fake `render` returning a fixed PDF buffer and a registered rack fixture → files list exactly `elevation.pdf, schedule.pdf, power-heat.pdf, schedule.csv, datasheets.pdf`, gaps include the missing datasheets.
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc/eslint/build; smoke (`/api/racks/SA-NOPE/submittal?part=csv` → 404 JSON/text, not 500 — add to smoke only if the harness supports non-200 expectations; otherwise curl it manually on the scratch dev server).
- [ ] **Step 5: Commit** `feat(rack): #296 submittal zip — sheets, schedule CSV, merged datasheets`.

---

### Task 13: Client package + D94 spec section

**Files:** Modify `src/lib/client-package-server.ts` (both `createClientPackage` and `createQuoteClientPackage`), `src/lib/bid-spec.ts` (`AssembledSpec` gains optional `racks?: RackSpecSection[]`), `src/lib/bid-spec-docx.ts`.

**Behavior:**
- Rack discovery: Grid project — every placed part id `asm:<id>` whose fixture is `kind === "rack"` (distinct); quote — every item with `rackId` (distinct), plus items whose `fixtureId` is a rack (portal never makes these, but harmless). Missing/deleted rack → gap `missing-cutsheet`-style? Use existing gap kind `"missing-spec"` with customer-safe text "Rack drawings available on request." (detail to `console.warn`).
- For each rack, call `rackSubmittalFiles` WITHOUT the datasheets file (the package's own `datasheets/` already covers members via `gridSpecBomRows`/quote BOM expansion — add an option `{ datasheets: false }`), and add files under `racks/<folder>/`. Share the package's existing deadline: give racks what's left after cut sheets minus `PACKAGE_FINISH_ALLOWANCE_MS`; a rack that doesn't fit becomes the on-request gap. `00-package-index.json` gains `racks: [{ name, files }]`.
- D94: `AssembledSpec.racks = [{ title, scope, schedule: ScheduleRow[], elevationPng?: Buffer }]` filled by the client-package code (and by the D94 spec route if it builds from a quote/grid — only wire client packages in v1; note the spec route as follow-up in DECISIONS). `buildSpecDocx` appends a heading "27 11 16 — Communications Racks, Frames and Enclosures" → per rack: subheading `<title>`, the elevation image (`ImageRun`, PNG from `sharp(Buffer.from(svg)).png({ density: 200 })`, width ≤ 6.5 in keeping aspect) and a docx `Table` (RU, Face, Qty, Manufacturer, Model/SKU, Description, Watts). Raster failure → paragraph "Elevation: see racks/<folder>/elevation.pdf in this package." (D577).
- Tracing: `/quotes` and `/design/grid/[id]` already include chromium. No change.

- [ ] **Step 1: Tests:** pure `racksInGrid(partIds, fixtureOf)` / `racksInQuote(items, fixtureOf)` helpers (export from `src/lib/rack/submittal.ts`) — distinct, rack-kind only; `buildSpecDocx` with a `racks` entry produces a docx whose `word/document.xml` (unzip with jszip in the test) contains "27 11 16" and the rack title and a `<w:tbl>`; with `elevationPng` present contains `<w:drawing>`; without, contains "see racks/"; `sharp` rasterize helper `svgToPng(svg)` returns a PNG buffer starting with the PNG signature (skip-with-PASS-note if sharp lacks SVG support at runtime — print which); async check: `createQuoteClientPackage` path is Blob-gated — test the composition helper `rackPackageEntries(racks, …)` with a fake render instead.
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc/eslint/build.
- [ ] **Step 5: Commit** `feat(rack): #296 racks in client packages and the D94 spec`.

---

### Task 14 (controller): docs, final review, merge

- Final whole-branch review (subagent) + fix rounds.
- Re-fetch `origin/main`, recompute #/D numbers, merge main, rerun all gates.
- DECISIONS D573–D579 (+ any taken during execution), PUNCHLIST `## 296.` entry with Jeff-gated follow-ups (supply RU/depth/watts via the Rack data sheet; set default blank/vent SKUs; confirm CSI 27 11 16; check the .docx elevation on a preview deploy; Grid enclosure adoption = wave 4), AGENTS.md phase entry + correct the stale `fixtureAssembliesFrom()` mention to `allAssembliesFrom()`, memory note.

## Verification (controller, after Tasks 9, 11, 12)

Boot `next dev` on a SCRATCH datadir in the worktree (memory `peak-exercising-post-routes-safely`, `peak-worktree-dev-server-browser-verification-traps`): never the main `.data/pglite`; don't click upload/import (real Blob token). Walk the spec's end-to-end acceptance: create "AV Head-End Rack" 42U Audio; rack-level frame/PDU/rails; place 10 devices (1U, 2U, shelf + two half-width, one rear); one optional; 4U reserved; fill blanks; see totals; resolve a warning; save; add to an Estimator quote (price matches builder), open the staff submittal preview, download the zip (CSV-only path at minimum if Chrome is unavailable locally). Screenshot the sidebar for Jeff.
