# Model-number SKUs (#304) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace order-number SKUs (Biamp/EAW/Meyer/Symetrix) with `Brand:Model` SKUs from a crosswalk sheet. The work rewrites every live reference, keeps old numbers searchable and resolvable, and has customer documents print the Model # only.

**Architecture:** Pure rules live in `src/lib/catalog-rename/`:

- `sku.ts`: the SKU rule, `partModel`, the search haystack
- `plan.ts`: the planner
- `rewrite.ts`: per-area reference rewriters
- `import-resolve.ts`: importer matching

A server engine (`apply.ts`) applies a plan in 45 s resumable batches. It writes new parts, retires old ones with `renamedTo`, logs to the `catalog_sku_renames` blob, and then runs one reference pass per area over the whole rename map. The catalog store's reads follow `renamedTo`, so frozen history still resolves. An admin page at `/catalog/model-numbers` drives it.

**Tech Stack:** Next.js 16 App Router (server actions), TypeScript, Drizzle doc-store over PGlite/Neon (JSONB docs), exceljs, the tsx spec harness `scripts/test-review-and-spec.ts`.

**Spec:** `docs/superpowers/specs/2026-10-07-model-number-skus-design.md`. Read it first.

## Global Constraints

- Worktree `/Users/sm/Downloads/peak-app-299`, branch `feat/302-model-sku`. **Never** touch `/Users/sm/Downloads/peak-app/.data` and never start `next dev` against it.
- **Never `git stash`.** Commit instead, because parallel worktrees share the stash.
- New SKU = `${mfr}:${model}`. The model is whitespace-collapsed, with `/ \ # ? %` and control characters → `-`. Max **60** chars, otherwise null.
- `formerSkus?: string[]` sits on the live part. `renamedTo?: string` goes **only** on the retired (soft-deleted) old doc.
- Rename log blob id: `catalog_sku_renames`, shape `{ renames: Array<{ from: string; to: string; model: string; at: number; by: string }> }`.
- Frozen data is never rewritten: quote `revisions`, Grid project `revisions`, `generated_specs`, `spec_record_revisions`, `settings.fixtureAssemblies`.
- Customer documents print `partModel(part)` = Model # → MFR P/N → SKU-after-`Brand:` → SKU. They never print the order # when a Model # exists.
- Admin page permission: `requirePerm("manage_users")`. Sheet caps: 800 KB, 5,000 rows, cell strings ≤ 2,048.
- Batch budget: `FETCH_ACTION_BUDGET_MS` (`src/lib/part-docs/types.ts`). Page `maxDuration = 60`.
- Checks go in `scripts/test-review-and-spec.ts`:
  - **sync checks:** `ok(cond, "#304 …")` placed before the async chain (search for `.then(() => estimateOutput301CAsyncChecks())`)
  - **DB checks:** an `async function modelSku304<Name>AsyncChecks()` added at EOF and chained with `.then(() => modelSku304<Name>AsyncChecks())` right after `estimateOutput301CAsyncChecks`
  - fixtures via `fixtureId(304, "slug")` + `registerFixture(coll, id)` (`scripts/test-fixtures.ts`)
  - every check message starts with `#304`
- Run tests: `cd /Users/sm/Downloads/peak-app-299 && npm run test:specs 2>&1 | grep -E "#304|FAILED|ALL PASSED|Error" | tail -40`. Baseline before this branch: ALL PASSED.
- Typecheck: `npx tsc --noEmit -p . 2>&1 | tail -20` → no output.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Match the surrounding code's comment density and idiom. Reference the punch number (`#304`) in comments the way neighbouring code does.

---

### Task 1: Pure core — SKU rule, partModel, haystack, crosswalk parse, planner

**Files:**
- Create: `src/lib/catalog-rename/sku.ts`, `src/lib/catalog-rename/plan.ts`
- Modify: `src/lib/stores/catalog.ts` (add `formerSkus?`, `renamedTo?` to `CatalogPart` with doc comments)
- Test: `scripts/test-review-and-spec.ts` (sync checks)

**Interfaces — Produces:**
```ts
// sku.ts (pure, client-safe: no store imports)
export const MODEL_SKU_MAX = 60;
export function cleanModel(model: string): string;            // trim + collapse whitespace
export function modelSku(mfr: string, model: string): string | null;
export type ModelPartLike = { sku: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string };
export function partModel(p: ModelPartLike): string;          // Model # → MFR P/N → sku after first ":" → sku
export type SearchPartLike = ModelPartLike & { desc?: string; mfr?: string; formerSkus?: string[] };
export function partSearchHaystack(p: SearchPartLike): string; // lowercased, space-joined
export function partMatchesQuery(p: SearchPartLike, q: string): boolean; // every whitespace token of q is in the haystack
export function staffPartLabel(p: ModelPartLike): { primary: string; secondary: string }; // secondary = MFR P/N when it differs (case-insens) from primary, else ""
// plan.ts (pure)
export type CrosswalkRow = { rowNumber: number; manufacturer: string; mfrPart: string; sku: string; model: string; notes: string };
export const CROSSWALK_MAX_ROWS = 5000;
export function crosswalkRowsFromGrid(grid: string[][]): { ok: true; rows: CrosswalkRow[] } | { ok: false; error: string };
export type RenameOutcome = "rename" | "already" | "skip:no-model" | "skip:not-found" | "skip:mfr-mismatch" | "skip:bad-model" | "skip:taken" | "skip:duplicate" | "skip:same";
export type PlannedRow = { row: CrosswalkRow; outcome: RenameOutcome; from: string; to: string | null; model: string; reason: string };
export type PlanPart = { sku: string; mfr?: string; formerSkus?: string[] };
export type RenamePlan = { rows: PlannedRow[]; counts: Record<RenameOutcome, number>; renames: Array<{ from: string; to: string; model: string }> };
export function planRenames(rows: CrosswalkRow[], live: PlanPart[], retired: Array<{ sku: string; renamedTo?: string }>): RenamePlan;
```

- [ ] **Step 1: Add the fields to `CatalogPart`** (`src/lib/stores/catalog.ts`, just after `manufacturerModelNumber`):
```ts
  /** #304 — every SKU this part has had (order numbers replaced by a
   *  `Brand:Model` SKU). Searched everywhere a part is searched; the
   *  importers match an incoming row on it. Written only by the rename tool. */
  formerSkus?: string[];
  /** #304 — set ONLY on a retired (soft-deleted) part: the SKU it was renamed
   *  to. get/getMany follow it so frozen history (sent revisions) resolves. */
  renamedTo?: string;
```

- [ ] **Step 2: Write failing sync checks** (append near the other sync checks before the async chain; import with aliases `as cr304…` to avoid name clashes):
```ts
import { modelSku as cr304ModelSku, partModel as cr304PartModel, partMatchesQuery as cr304Match, staffPartLabel as cr304Label, cleanModel as cr304Clean } from "@/lib/catalog-rename/sku";
import { planRenames as cr304Plan, crosswalkRowsFromGrid as cr304Rows, type CrosswalkRow as Cr304Row } from "@/lib/catalog-rename/plan";
// ...
ok(cr304ModelSku("Symetrix", " Jupiter  4 ") === "Symetrix:Jupiter 4", "#304 sku: Brand:Model, whitespace collapsed");
ok(cr304ModelSku("Biamp", "A/B #1?") === "Biamp:A-B -1-", "#304 sku: / # ? become -");
ok(cr304ModelSku("", "X") === null && cr304ModelSku("Biamp", "  ") === null, "#304 sku: blank brand or model → null");
ok(cr304ModelSku("Symetrix", "x".repeat(60)) === null, "#304 sku: over 60 chars → null");
ok(cr304Clean("W3,  Black, US") === "W3, Black, US", "#304 cleanModel keeps commas");
ok(cr304PartModel({ sku: "Symetrix:Jupiter 4", manufacturerModelNumber: "Jupiter 4", manufacturerPartNumber: "80-0043" }) === "Jupiter 4", "#304 partModel: model first");
ok(cr304PartModel({ sku: "ETC:S4LED", manufacturerPartNumber: "7060A" }) === "7060A" && cr304PartModel({ sku: "ETC:S4LED" }) === "S4LED" && cr304PartModel({ sku: "PLAIN" }) === "PLAIN", "#304 partModel: P/N, then sku tail, then sku");
ok(cr304Match({ sku: "Symetrix:Jupiter 4", desc: "DSP", formerSkus: ["80-0043"] }, "80-0043") && cr304Match({ sku: "Symetrix:Jupiter 4", desc: "DSP" }, "jupiter dsp") && !cr304Match({ sku: "Symetrix:Jupiter 4", desc: "DSP" }, "edge"), "#304 search: former SKUs, model and multi-token");
ok(JSON.stringify(cr304Label({ sku: "Symetrix:Jupiter 4", manufacturerModelNumber: "Jupiter 4", manufacturerPartNumber: "80-0043" })) === JSON.stringify({ primary: "Jupiter 4", secondary: "80-0043" }) && cr304Label({ sku: "X", manufacturerPartNumber: "X" }).secondary === "", "#304 staff label: model · order #, no repeat");
{
  const g = [["Manufacturer", "MFR Part # (order number)", "SKU", "Description", "Category", "Model #", "Source URL", "Notes"],
    ["Symetrix", "80-0043", "80-0043", "Jupiter 4", "DSP", "Jupiter 4", "u", "confirmed"],
    ["Symetrix", "80-0042", "80-0042", "Jupiter 12", "DSP", "Jupiter 12", "", ""],
    ["Symetrix", "12-0002", "12-0002", "Rack ears", "", "", "", "accessory: no model name"],
    ["Symetrix", "80-0099", "80-0099", "Gone", "", "Ghost", "", ""],
    ["Biamp", "80-0001", "80-0001", "Wrong brand", "", "Thing", "", ""],
    ["Symetrix", "80-0056", "80-0056", "ARC White", "", "ARC-2e", "", ""],
    ["Symetrix", "80-0057", "80-0057", "ARC Black", "", "arc-2e", "", ""],
    ["Symetrix", "80-0060", "80-0060", "Taken", "", "Prism 4x4", "", ""],
    ["Symetrix", "80-0070", "80-0070", "Long", "", "y".repeat(70), "", ""],
    ["Symetrix", "80-0080", "80-0080", "Old", "", "Done", "", ""]];
  const r = cr304Rows(g);
  ok(r.ok && r.rows.length === 10 && r.rows[0].sku === "80-0043" && r.rows[0].model === "Jupiter 4" && r.rows[0].rowNumber === 2, "#304 crosswalk: header-matched rows, 1-based sheet row numbers");
  ok(!cr304Rows([["Manufacturer", "SKU"]]).ok, "#304 crosswalk: a sheet with no Model # column is refused");
  if (r.ok) {
    const live = [{ sku: "80-0043", mfr: "Symetrix" }, { sku: "80-0042", mfr: "Symetrix" }, { sku: "12-0002", mfr: "Symetrix" }, { sku: "80-0001", mfr: "Symetrix" },
      { sku: "80-0056", mfr: "Symetrix" }, { sku: "80-0057", mfr: "Symetrix" }, { sku: "80-0060", mfr: "Symetrix" }, { sku: "Symetrix:Prism 4x4", mfr: "Symetrix" },
      { sku: "80-0070", mfr: "Symetrix" }, { sku: "Symetrix:Done", mfr: "Symetrix", formerSkus: ["80-0080"] }];
    const p = cr304Plan(r.rows, live, [{ sku: "80-0080", renamedTo: "Symetrix:Done" }]);
    const o = (sku: string) => p.rows.find((x) => x.row.sku === sku)?.outcome;
    ok(o("80-0043") === "rename" && o("80-0042") === "rename" && o("12-0002") === "skip:no-model" && o("80-0099") === "skip:not-found" && o("80-0001") === "skip:mfr-mismatch", "#304 plan: rename / no-model / not-found / mfr-mismatch");
    ok(o("80-0056") === "skip:duplicate" && o("80-0057") === "skip:duplicate", "#304 plan: two rows → one SKU (case-insensitive) skips both");
    ok(o("80-0060") === "skip:taken" && o("80-0070") === "skip:bad-model" && o("80-0080") === "already", "#304 plan: taken / bad-model / already renamed");
    ok(p.renames.length === 2 && p.renames[0].to === "Symetrix:Jupiter 4" && p.counts.rename === 2 && p.counts["skip:duplicate"] === 2, "#304 plan: rename map + counts");
  }
}
```

- [ ] **Step 3: Run, expect a module-not-found failure**

Run: `npm run test:specs 2>&1 | tail -5`. Expected: an error that `@/lib/catalog-rename/sku` can't be resolved.

- [ ] **Step 4: Implement `sku.ts`**
```ts
/**
 * #304 — model-number SKUs. Pure, client-safe rules: the `Brand:Model` SKU a
 * rename writes, the model a customer document prints (`partModel`), and the
 * one search haystack every part search uses (old order numbers included).
 */

export const MODEL_SKU_MAX = 60;

export function cleanModel(model: string): string {
  return String(model ?? "").replace(/\s+/g, " ").trim();
}

export function modelSku(mfr: string, model: string): string | null {
  const brand = cleanModel(mfr);
  // eslint-disable-next-line no-control-regex
  const m = cleanModel(model).replace(/[/\\#?%\u0000-\u001f\u007f]/g, "-");
  if (!brand || !m) return null;
  const sku = `${brand}:${m}`;
  return sku.length > MODEL_SKU_MAX ? null : sku;
}

export type ModelPartLike = { sku: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string };

/** What a customer document prints for a part: Model # → MFR P/N → the SKU
 *  after any `Brand:` prefix → the SKU. Never the order # when a model exists. */
export function partModel(p: ModelPartLike): string {
  const model = p.manufacturerModelNumber?.trim();
  if (model) return model;
  const pn = p.manufacturerPartNumber?.trim();
  if (pn) return pn;
  const sku = String(p.sku ?? "");
  const i = sku.indexOf(":");
  return (i >= 0 ? sku.slice(i + 1).trim() : "") || sku;
}

export type SearchPartLike = ModelPartLike & { desc?: string; mfr?: string; formerSkus?: string[] };

export function partSearchHaystack(p: SearchPartLike): string {
  return [p.sku, p.desc, p.mfr, p.manufacturerPartNumber, p.manufacturerModelNumber, ...(p.formerSkus ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function partMatchesQuery(p: SearchPartLike, q: string): boolean {
  const tokens = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = partSearchHaystack(p);
  return tokens.every((t) => hay.includes(t));
}

/** Staff rows: "Jupiter 4 · 80-0043" — the model first, the order # beside it. */
export function staffPartLabel(p: ModelPartLike): { primary: string; secondary: string } {
  const primary = partModel(p);
  const pn = p.manufacturerPartNumber?.trim() || "";
  return { primary, secondary: pn && pn.toLowerCase() !== primary.toLowerCase() ? pn : "" };
}
```

- [ ] **Step 5: Implement `plan.ts`**
```ts
import { mfrKey } from "@/lib/catalog-books";
import { cleanModel, modelSku } from "./sku";

/**
 * #304 — plan a model-number rename from a crosswalk sheet (ChatGPT's
 * "Peak model number crosswalk … filled" workbooks). Pure: every row gets
 * exactly one outcome; only `rename` rows are ever applied.
 */

export type CrosswalkRow = { rowNumber: number; manufacturer: string; mfrPart: string; sku: string; model: string; notes: string };
export const CROSSWALK_MAX_ROWS = 5000;
const CELL_MAX = 2048;

const HEADERS: Record<keyof Omit<CrosswalkRow, "rowNumber">, string[]> = {
  manufacturer: ["manufacturer", "mfr"],
  mfrPart: ["mfr part # (order number)", "mfr part #", "mfr p/n", "mfr pn", "order number"],
  sku: ["sku"],
  model: ["model #", "model number", "mfr m/n", "model"],
  notes: ["notes", "note"],
};

export function crosswalkRowsFromGrid(grid: string[][]): { ok: true; rows: CrosswalkRow[] } | { ok: false; error: string } {
  const head = (grid[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  const col = (k: keyof typeof HEADERS) => head.findIndex((h) => HEADERS[k].includes(h));
  const at = { manufacturer: col("manufacturer"), mfrPart: col("mfrPart"), sku: col("sku"), model: col("model"), notes: col("notes") };
  if (at.sku < 0 || at.model < 0 || at.manufacturer < 0) return { ok: false, error: "The sheet needs Manufacturer, SKU and Model # columns (the crosswalk's own headers)." };
  const body = grid.slice(1);
  if (body.length > CROSSWALK_MAX_ROWS) return { ok: false, error: `The sheet has more than ${CROSSWALK_MAX_ROWS.toLocaleString()} rows.` };
  const rows: CrosswalkRow[] = [];
  body.forEach((cells, i) => {
    const v = (c: number) => (c < 0 ? "" : String(cells?.[c] ?? "").trim().slice(0, CELL_MAX));
    if (!v(at.sku) && !v(at.model)) return;
    rows.push({ rowNumber: i + 2, manufacturer: v(at.manufacturer), mfrPart: v(at.mfrPart), sku: v(at.sku), model: v(at.model), notes: v(at.notes) });
  });
  return { ok: true, rows };
}

export type RenameOutcome = "rename" | "already" | "skip:no-model" | "skip:not-found" | "skip:mfr-mismatch" | "skip:bad-model" | "skip:taken" | "skip:duplicate" | "skip:same";
export type PlannedRow = { row: CrosswalkRow; outcome: RenameOutcome; from: string; to: string | null; model: string; reason: string };
export type PlanPart = { sku: string; mfr?: string; formerSkus?: string[] };
export type RenamePlan = { rows: PlannedRow[]; counts: Record<RenameOutcome, number>; renames: Array<{ from: string; to: string; model: string }> };

const REASON: Record<RenameOutcome, string> = {
  rename: "",
  already: "Already renamed.",
  "skip:no-model": "No Model # on this row.",
  "skip:not-found": "No catalog part has this SKU.",
  "skip:mfr-mismatch": "The part's manufacturer doesn't match this row.",
  "skip:bad-model": "The model can't make a SKU (blank brand or over 60 characters).",
  "skip:taken": "Another part already has this SKU.",
  "skip:duplicate": "Another row gives the same SKU — give each variant its own model.",
  "skip:same": "The SKU already is the model.",
};

export function planRenames(rows: CrosswalkRow[], live: PlanPart[], retired: Array<{ sku: string; renamedTo?: string }>): RenamePlan {
  const liveBy = new Map(live.map((p) => [p.sku, p]));
  const liveUpper = new Map(live.map((p) => [p.sku.toUpperCase(), p]));
  const formerUpper = new Set(live.flatMap((p) => (p.formerSkus ?? []).map((s) => s.toUpperCase())));
  const retiredBy = new Map(retired.map((r) => [r.sku, r.renamedTo]));
  const first: PlannedRow[] = rows.map((row) => {
    const model = cleanModel(row.model);
    const mk = (outcome: RenameOutcome, to: string | null = null): PlannedRow => ({ row, outcome, from: row.sku, to, model, reason: REASON[outcome] });
    if (!model) return mk("skip:no-model");
    const part = liveBy.get(row.sku);
    const brand = part?.mfr || row.manufacturer;
    const to = modelSku(brand, model);
    if (!part) {
      const target = retiredBy.get(row.sku);
      if (target && to && target === to) return mk("already", to);
      const owner = to ? liveUpper.get(to.toUpperCase()) : undefined;
      if (owner && (owner.formerSkus ?? []).includes(row.sku)) return mk("already", owner.sku);
      return mk("skip:not-found");
    }
    if (mfrKey(part.mfr) !== mfrKey(row.manufacturer)) return mk("skip:mfr-mismatch");
    if (!to) return mk("skip:bad-model");
    if (to === part.sku) return mk("skip:same", to);
    const owner = liveUpper.get(to.toUpperCase());
    if ((owner && owner.sku !== part.sku) || formerUpper.has(to.toUpperCase())) return mk("skip:taken", to);
    return mk("rename", to);
  });
  const byTo = new Map<string, number>();
  const byFrom = new Map<string, number>();
  for (const r of first) if (r.outcome === "rename" && r.to) {
    byTo.set(r.to.toUpperCase(), (byTo.get(r.to.toUpperCase()) ?? 0) + 1);
    byFrom.set(r.from, (byFrom.get(r.from) ?? 0) + 1);
  }
  const dup = (r: PlannedRow) => r.outcome === "rename" && !!r.to && ((byTo.get(r.to.toUpperCase()) ?? 0) > 1 || (byFrom.get(r.from) ?? 0) > 1);
  const out = first.map((r) => (dup(r) ? { ...r, outcome: "skip:duplicate" as const, reason: REASON["skip:duplicate"] } : r));
  const counts = Object.fromEntries(Object.keys(REASON).map((k) => [k, 0])) as Record<RenameOutcome, number>;
  for (const r of out) counts[r.outcome]++;
  const renames = out.filter((r) => r.outcome === "rename" && r.to).map((r) => ({ from: r.from, to: r.to!, model: r.model }));
  return { rows: out, counts, renames };
}
```
Also add a check: two sheet rows with the same `SKU` but different models → both `skip:duplicate`.

- [ ] **Step 6: Run the checks.** Expected: all `#304` checks pass, ALL PASSED. Then run `npx tsc --noEmit -p .` and expect a clean result.

- [ ] **Step 7: Commit** `feat(catalog): #304 model-number SKU rule, partModel, search haystack, crosswalk planner`

---

### Task 2: Store — redirect, getManyBySku, renamePart, rename log, blob listing

**Files:**
- Modify: `src/lib/stores/catalog.ts` (get / getMany / getManyAnyCase redirect, `getManyBySku`, `renamePartDocs`)
- Create: `src/lib/stores/catalog-renames.ts`
- Modify: `src/db/doc-store.ts` (add `listBlobIds(prefix)`)
- Test: DB checks `modelSku304StoreAsyncChecks`

**Interfaces — Produces:**
```ts
// catalog.ts
export async function get(sku: string): Promise<CatalogPart | null>;          // follows renamedTo (≤ 8 hops)
export async function getMany(skus: readonly string[]): Promise<CatalogPart[]>; // misses follow renamedTo; result deduped by sku
export async function getManyAnyCase(skus: readonly string[]): Promise<CatalogPart[]>; // same
export async function getManyBySku(skus: readonly string[]): Promise<Map<string, CatalogPart>>; // key = REQUESTED sku
/** Write the renamed copy and retire the old doc. Idempotent: if `from` is already retired → `to`, returns the live part. Refuses (null) when `to` is a live part other than a previous rename of `from`. */
export async function renamePartDocs(from: string, to: string, model: string): Promise<CatalogPart | null>;
// catalog-renames.ts
export type SkuRename = { from: string; to: string; model: string; at: number; by: string };
export const SKU_RENAMES_BLOB = "catalog_sku_renames";
export async function allSkuRenames(): Promise<SkuRename[]>;
export async function appendSkuRenames(entries: SkuRename[]): Promise<void>; // dedupe by from (last wins)
export function renameMapOf(entries: SkuRename[]): Map<string, string>; // pure; collapses chains a→b→c into a→c, b→c
// doc-store.ts
export async function listBlobIds(prefix: string): Promise<string[]>;
```

- [ ] **Step 1: Failing DB checks.** Create a part `fixtureId(304,"p1")` with mfr `Symetrix`, `manufacturerPartNumber` unset, `pricedAt: 111`, and `narrativeText: "x"`. Then `renamePartDocs(p1, "Symetrix:Fixture 304 A", "Fixture 304 A")` and assert:
  - The new part has sku/id = to, `manufacturerModelNumber` = model, `manufacturerPartNumber` = old sku, `formerSkus` = [old], `pricedAt` 111 and the narrative carried.
  - `get(old)` returns the new part.
  - `getMany([old])` returns [new].
  - `getManyBySku([old]).get(old).sku === to`.
  - `listDocs` no longer has old.
  - The deleted old doc has `renamedTo`.
  - A second identical call returns the same part without a duplicate.
  - Renaming another part to the same `to` returns null.
  - `renameMapOf([{a→b},{b→c}])` maps a→c.
  - `appendSkuRenames` twice with the same `from` keeps one entry.
  - `listBlobIds("gridFavorites:")` finds a blob set with `setBlob("gridFavorites:" + fixtureId(304,"u"), { ids: [] })`.

  Register every created doc with `registerFixture("catalog_parts", id)`, the new SKU included. Clean up blobs at the end of the check (`setBlob` to empty, or delete if a helper exists).
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.**
  - `get`: `const d = await getDoc(...)`. If found, return it. Otherwise read the raw row including deleted (`getDocRows("catalog_parts",[sku])`), and while `row.deleted && row.doc.renamedTo && hops < 8 && !seen.has(next)`, follow it.
  - `getMany`: read rows. For deleted rows with `renamedTo`, collect targets, then read targets (loop ≤ 8). Return live docs deduped by sku.
  - `getManyAnyCase`: keep the existing logic, but resolve redirects on the exact-read misses first.
  - `getManyBySku`: build requested → live part via the same walk.
  - `renamePartDocs`: read the old raw row.
    - If it's deleted with `renamedTo === to`, return `get(to)`.
    - If it's missing or deleted otherwise, return null.
    - If a live `to` exists, return null unless its `formerSkus` contains `from`; then retire `from` if it's still live and return `to`.
    - Otherwise build `{ ...old, id: to, sku: to, manufacturerModelNumber: model, manufacturerPartNumber: old.manufacturerPartNumber || from, formerSkus: dedupe([...(old.formerSkus ?? []), from]), updatedAt: Date.now() }`. Delete `renamedTo` from the copy and write it with **`upsertDoc`** (not `writePart`, so `pricedAt` stays).
    - Then `patchDoc` old `{ renamedTo: to }` followed by `softDeleteDoc`.
  - `listBlobIds`: `select id from blobs where id like prefix%`. Escape `%` and `_` in the prefix.
- [ ] **Step 4: Run → PASS; tsc clean.**
- [ ] **Step 5: Commit** `feat(catalog): #304 rename store — renamedTo redirect, getManyBySku, rename log`

---

### Task 3: Pure reference rewriters

**Files:**
- Create: `src/lib/catalog-rename/rewrite.ts`
- Test: sync checks

**Interfaces — Produces** (every function is pure and returns `null` when nothing changed, otherwise a NEW value; never mutate the input; `m: ReadonlyMap<string, string>` old → new; `models: ReadonlyMap<string, string>` new sku → model):
```ts
export type RenameMap = ReadonlyMap<string, string>;
export function rewriteSkuKeyed(rec: Record<string, number>, m: RenameMap): Record<string, number> | null; // keys "slot:sku"
export function rewriteSpecItems<T extends { sku?: string; manufacturerModelNumber?: string; components?: Array<{ sku: string }>; fixtureOptions?: Record<string, number>; curtainInputs?: { fabricSku?: string } }>(items: T[], m: RenameMap, models: RenameMap): T[] | null; // also sets manufacturerModelNumber on a renamed line
export function rewriteQuoteSpec(spec: unknown, m: RenameMap, models: RenameMap): unknown | null; // sections[].items + sections[].keyProducts[].sku
export function rewriteCartLines(lines: unknown, m: RenameMap): unknown | null;
export function rewriteProcurement(rows: unknown, m: RenameMap): unknown | null;
export function rewriteSpecDocProducts(products: unknown, m: RenameMap): unknown | null;
export function rewriteSubassembly(doc: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null; // fixture: lightEngineSku, lensSku, lines.*[].sku, parts[].sku; rack: placements[].sku
export function rewriteGridProjectLive(doc: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null; // placements[].partId, placements[].curtain.fabricSku, routes[].partId, riser[*].links[].partId, options[].accessories[].partId, autoEstimate[*].overrides[*].sku — NEVER revisions
export function rewriteGridSymbolMembers(doc: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null; // members[].symbolId
export function rewriteEquipmentMap(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null;
export function rewriteTrackSeries(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null;
export function rewriteCurtainMounts(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null;
export function rewriteRackDefaults(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null;
export function rewriteIdList(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null; // { ids: string[] } favorites/recent, deduped after rewrite
export function rewriteDrivePhotoSync(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null; // files[id].skus[]
export function rewriteWireTypes(wireTypes: unknown, m: RenameMap): unknown | null; // [].cableSku
export function rewritePartRefs(part: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null; // specSameAs, productMetadata.accessories[].sku
```

The implementer **must read the real shapes** before writing each rewriter (paths from the impact survey):

| Area | Shape location |
|---|---|
| quote items / keyProducts | `src/app/(app)/estimator/types.ts:45,103,125,131,217,258` |
| cart lines | `src/lib/portal-cart-types.ts:31-39` |
| procurement | `src/lib/stores/projects.ts:116,236` |
| spec doc products | `src/lib/specs/spec-document.ts:19-29` |
| fixtures | `src/lib/fixture-assemblies.ts:237,256-257` |
| rack placements | `src/lib/rack/types.ts:54` |
| grid placements / routes | `src/lib/stores/grid-projects.ts:104,218` |
| riser links | `src/lib/design/grid-riser-doc.ts:44` |
| accessories | `src/lib/design/grid-accessories.ts:33` |
| curtain fabricSku | `src/lib/design/grid-bom.ts:131` |
| auto overrides | `src/lib/design/grid-auto-model.ts:23` |
| grid symbols members | `src/lib/stores/grid-catalog.ts:14` |
| equipment map | `src/lib/design/equipment-map.ts:33-38` |
| track series | `src/lib/track-series.ts:31,56` |
| curtain mounts | `src/lib/curtain-mounts.ts:19` |
| rack defaults | `src/lib/rack/defaults.ts:9` |
| drive photo sync | `src/lib/part-docs/drive-photo-sync.ts:52` |
| wire types | `src/lib/catalog-connect.ts:29` |
| part refs | `src/lib/stores/catalog.ts` (`specSameAs`, `productMetadata.accessories`) |

Walk only these fields. Never deep-replace arbitrary strings.

- [ ] **Step 1: Failing checks.** One `ok()` per rewriter with a realistic fixture, built from the real type:
  - the renamed SKU moves
  - an unrelated SKU stays
  - nothing to change → `null`
  - the input object is unchanged (`JSON.stringify` before/after)

  Add these specific checks:
  - `rewriteSpecItems` sets `manufacturerModelNumber` on the moved line.
  - `rewriteSkuKeyed({"opt:80-0043":2}, m)` gives `{"opt:Symetrix:Jupiter 4":2}`. Split on the **first** `:` only, because new SKUs contain `:`.
  - `rewriteGridProjectLive` leaves `revisions` byte-identical.
  - `rewriteIdList` dedupes when the old and new IDs were both present.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** with a small internal `const sw = (s: string | undefined) => (s && m.has(s) ? m.get(s)! : s)` and a `changed` flag per function. Use `structuredClone` only on the branch that changes.
- [ ] **Step 4: PASS, tsc clean.**
- [ ] **Step 5: Commit** `feat(catalog): #304 pure reference rewriters`

---

### Task 4: Apply engine (server, batched, resumable)

**Files:**
- Create: `src/lib/catalog-rename/apply.ts` (SERVER ONLY, header comment says so)
- Test: DB checks `modelSku304ApplyAsyncChecks`

**Interfaces:**
- Consumes: Tasks 1–3, `listDocs/patchDoc/upsertDocs/softDeleteDocs/getBlob/setBlob/listBlobIds` from `@/db/doc-store`, `allDocumentLinks`/`documentLinkId` (`@/lib/stores/part-documents`), `allAccessoryLinks`/`accessoryLinkId` (`@/lib/stores/part-accessory-links`).
- Produces:
```ts
export const REF_STEPS = ["parts-refs", "doc-links", "accessory-links", "quotes", "projects", "portal-carts", "spec-documents", "subassemblies", "grid-symbols", "grid-projects", "blobs"] as const;
export type RenameStep = "parts" | (typeof REF_STEPS)[number] | "done";
export type RenameBatchInput = { rows: CrosswalkRow[]; step: RenameStep; refsOnly?: boolean };
export type RenameBatchResult = { ok: true; step: RenameStep; complete: boolean; renamed: number; changed: number; plan: RenamePlan | null } | { ok: false; error: string };
export async function loadPlanContext(): Promise<{ live: PlanPart[]; retired: Array<{ sku: string; renamedTo?: string }> }>;
export async function runRenameBatch(input: RenameBatchInput, by: string, budgetMs: number): Promise<RenameBatchResult>;
```

**Behaviour:**
- **Step `parts`** (skipped when `refsOnly`):
  - Re-plan server-side from `rows` with `loadPlanContext()`. `retired` = `listDeletedDocs("catalog_parts")` filtered to those with `renamedTo`.
  - For each `rename`, call `renamePartDocs` and `appendSkuRenames` in chunks of 50.
  - Stop when the budget is spent and return `{ step: "parts", complete: false }`. The client calls again; already-done rows plan as `already`.
  - When finished, return `step: REF_STEPS[0]`.
- **Each ref step:**
  - `m = renameMapOf(await allSkuRenames())` and `models` = to → model.
  - Iterate the collection with `listDocs` (live only). For each doc whose rewriter returns non-null, write it with `patchDoc` (re-run the rewriter inside `mutate` on the fresh doc).
  - `quotes`: rewrite only `spec` and `vendorQuotes`, **never** `revisions`. Same pattern for `grid-projects`.
  - `doc-links`: for each live link whose `partSku` is in `m`, `upsertDocs` a copy with `id: documentLinkId(new, documentId)`, `partSku: new` (keep `sort`/`hidden`/`kind`/`createdAt`/`createdBy`). Skip it if that id already exists live. Then `softDeleteDocs` the old ids. `accessory-links`: same, with `accessoryLinkId(source, scopeRef, parent', accessory')`.
  - `grid-symbols`: a symbol whose `id` or `pricingPartId` is in `m` → `upsertDoc` the copy `{ ...sym, id: m.get(id) ?? id, pricingPartId: m.get(pricingPartId) ?? pricingPartId, modelNumber: models.get(newId) ?? sym.modelNumber }` and soft-delete the old id. Then rewrite `members[].symbolId` on every symbol.
  - `blobs`: `grid_equipment_map`, `track_series`, `curtain_mounts`, `rack_defaults`, `drive_photo_sync`, plus every `listBlobIds("gridFavorites:")` and `listBlobIds("gridRecent:")`. Write the whole rewritten value back with `setBlob(id, rewritten)`. These blobs are whole-object values merged at the top level, so pass every top-level key the rewriter returns. `app_settings.wireTypes`: use the settings store's own getter/setter (find it in `src/lib/settings.ts`).
  - Advance to the next step and return. Each call does at most one step, or stops mid-step on budget and resumes. Steps are idempotent, so resuming re-scans the collection.
- **Final:** `{ step: "done", complete: true }`. `revalidatePath` is the action's job, not the engine's.

- [ ] **Step 1: Failing DB checks** (`modelSku304ApplyAsyncChecks`). Fixtures:
  - catalog parts A (`80-0043`-style fixture SKU, mfr Symetrix) and B (unrelated)
  - an image document link on A (create a `part_documents` row and a link via `attachDocument`)
  - an accessory link A→B (`syncAccessoryLinks` or a direct upsert)
  - a fixture subassembly using A
  - a quote with `spec.sections[0].items=[{sku:A…}]` **and** a revision holding A (`Q.addQuoteRevision`)
  - a Grid project placement `partId: A`
  - a `gridFavorites:<fixture user>` blob `{ ids:[A] }`

  Then call `runRenameBatch` with one crosswalk row repeatedly until `complete`. Assert:
  - every live reference now says the new SKU
  - the quote revision still says A
  - the image link is reachable by the new SKU (`documentLinksForParts([new])`) and in the same `sort`
  - `get(A)` resolves to new
  - a second full run changes nothing (`changed === 0` on every step)
  - `refsOnly` runs skip `parts`

  Restore the equipment map / track series blobs touched (snapshot before, restore after) so no other check is disturbed.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: PASS, tsc clean.**
- [ ] **Step 5: Commit** `feat(catalog): #304 rename engine — parts + reference passes, resumable`

---

### Task 5: Importers match renamed parts (no duplicates, no revive)

**Files:**
- Create: `src/lib/catalog-rename/import-resolve.ts` (pure)
- Modify: `src/app/(app)/catalog/import.ts` (~57-127), `src/app/(app)/import/registry.ts` (~1154-1182, catalog `find`/`create`), `src/lib/catalog-import-guard.ts` (61-123: an overlap counts resolved rows)
- Test: sync + DB checks

**Interfaces — Produces:**
```ts
export type ResolvablePart = { sku: string; mfr?: string; manufacturerPartNumber?: string; formerSkus?: string[] };
export function buildImportResolver(live: ResolvablePart[], renames: ReadonlyMap<string, string>): (row: { sku: string; mfr?: string; manufacturerPartNumber?: string }) => string | null;
```
Resolution order:
1. exact live SKU
2. a live part whose `formerSkus` contains the row SKU (punctuation-insensitive via `mfrKey`-style normalize: lowercase alnum)
3. `renames` chain → a live SKU
4. the **unique** live part with the same `mfrKey(mfr)` whose normalized MFR P/N equals the normalized row SKU or row MFR P/N

Otherwise `null` (new part).

- [ ] **Step 1: Failing checks.**
  - **Pure:** each branch; ambiguity (two parts with the same P/N) → null; a different manufacturer → null.
  - **DB:** after a rename, import a CSV/row keyed by the old order number with a new list price through each importer's server entry point:
    - the catalog page path is in `import.ts`. Find the exported function the catalog action calls.
    - the Import hub path is `registry.ts`'s catalog type `create`.

    Assert the renamed part's price changed, no part exists at the old SKU (`get` resolves to new, and `listDocs` has no live old), and the import guard didn't refuse the file.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.** Build the resolver once per import from `list()` + `renameMapOf(allSkuRenames())`.
  - `catalog/import.ts`: replace the `existing`/`bySku` lookup and the `mergeUpsert(r.sku, …)` key with the resolved SKU (`resolved ?? r.sku`).
  - `registry.ts`: `find` uses the resolver, and `create` merges into the resolved SKU.
  - Import guard: when computing overlap, count a row as matching if the resolver finds a part.
- [ ] **Step 4: PASS, tsc clean.**
- [ ] **Step 5: Commit** `feat(import): #304 importers match renamed parts by former SKU / order #`

---

### Task 6: Search everywhere uses the haystack

**Files (modify; each currently filters on sku/desc/mfr/category only):**
- `src/app/api/search/route.ts:~253` (⌘K)
- `src/app/(app)/catalog/page.tsx:~145-156`
- `src/app/(app)/estimator/actions.ts:~1389` (add-part picker)
- `src/app/(app)/design/grid/settings/` part picker (`:~157`; find the exact file with `grep -rn "toLowerCase().includes" "src/app/(app)/design/grid/settings"`)
- `src/app/(app)/design/assemblies/` picker (`:~39`)
- `src/lib/portal-search.ts:27-54`
- `src/app/(app)/catalog/documents/actions.ts:379`
- `src/lib/design/grid-library.ts:~100`

**Interfaces:** consumes `partMatchesQuery` / `partSearchHaystack` from `@/lib/catalog-rename/sku`.

- [ ] **Step 1: Failing checks.**
  - **Source pins** (`readFileSync` of each file): it imports `partMatchesQuery` or `partSearchHaystack` from `@/lib/catalog-rename/sku`.
  - **Behaviour:** where the filter is an exported pure function (portal-search, grid-library), call it with a part whose only match is a `formerSkus` entry or Model #.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.**
  - Replace each ad-hoc text test with `partMatchesQuery(p, q)` or `partSearchHaystack(p).includes(q)`, whichever preserves that site's existing semantics (multi-token AND vs substring). Keep the category term where the site matched category: append it to the haystack locally.
  - For SQL prefilters (`searchDocs` on `doc::text ILIKE`), no change is needed: `formerSkus` and the model are in the JSON. Only the JS post-filter changes.
  - For the portal index, add the model and former SKUs to its index entry if the entry type lacks them (`src/lib/portal-catalog-index.ts:~314,361` already carries `model`).
- [ ] **Step 4: PASS, tsc clean.**
- [ ] **Step 5: Commit** `feat(search): #304 every part search matches Model # and former SKUs`

---

### Task 7: Customer documents print the model only; staff rows lead with it

**Files:** the output list comes from the display survey (see "Display survey" below). Each customer printer switches to `partModel(...)`. Staff list rows switch to `staffPartLabel(...)`.

- [ ] **Step 1: Failing checks.**
  - **Pure:** each pure builder in the survey (e.g. `estimate-output/bom.ts`, `parts-csv.ts` model column, `specs/assemble-section.ts` model) is given a part / line with `manufacturerModelNumber: "Jupiter 4"`, `manufacturerPartNumber: "80-0043"`, `sku: "Symetrix:Jupiter 4"`. The printed identity must equal `"Jupiter 4"` and the output must not contain `"80-0043"`.
  - **Source pins** for the React printers: they import `partModel`.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement**, per the survey table.
- [ ] **Step 4: PASS, tsc clean.**
- [ ] **Step 5: Commit** `feat(docs): #304 customer documents print the Model # only`

---

### Task 8: Frozen-history readers resolve old SKUs

**Files:** sent-revision readers that build `Map<sku, part>` from `getMany(...)` / `list()` and then look up by a revision's SKU:
- `src/lib/estimate-output/package-loader.ts:48`
- `src/lib/narrative/photos.ts:51`
- the share `doc/[docId]` and photo routes under `src/app/share/quote/[id]/[token]/`
- `/portal/quotes/[id]` loaders
- cut sheets loader (`src/lib/curtain-cut-sheets/`)
- `src/app/api/v1/displays/catalog/[sku]`, `src/app/api/part-datasheet/[sku]`
- the catalog `?edit=` lookup in `src/app/(app)/catalog/page.tsx`

Find each with `grep -rn "getMany(\|getManyAnyCase(" src | grep -v stores/catalog.ts` and keep only those fed by revision/quote/cart SKUs.

- [ ] **Step 1: Failing DB check.**
  - **Fixture:** a renamed part with an image link, and a quote whose sent revision references the OLD SKU.
  - Through the package loader / narrative photo resolver, the old SKU finds the part's photo and model.
  - A Displays API handler call (import the route's `GET` and call it with a `Request`) for the old SKU returns the new part.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.** Use `getManyBySku` and look photos/documents up by the **resolved** SKU (`map.get(oldSku)?.sku`). Single-SKU routes already resolve through `get` after Task 2. Where they compare `p.sku === requested`, compare against the resolved SKU instead.
- [ ] **Step 4: PASS, tsc clean.**
- [ ] **Step 5: Commit** `fix(catalog): #304 frozen revisions resolve renamed SKUs`

---

### Task 9: Admin page — Catalog → Model numbers

**Files:**
- Create: `src/app/(app)/catalog/model-numbers/page.tsx`, `actions.ts`, `model-numbers-client.tsx`
- Modify: `src/app/(app)/catalog/page.tsx` (admin link next to the other admin tools, e.g. Manufacturers / Departments links; admin-only like them)
- Modify: `scripts/smoke-routes.ts` (add `/catalog/model-numbers` to the GET route list the way neighbours are listed)

**Interfaces:**
- Consumes: `readSheetFile` (`@/lib/part-docs/photo-sheet-io`, which reads xlsx/csv to a grid; the exceljs path uses `PHOTO_SHEET_NAME` first, else sheet 1. Generalize it by adding an optional `sheetName` param defaulting to `PHOTO_SHEET_NAME`, and pass `"Crosswalk"`), `crosswalkRowsFromGrid`, `planRenames`, `loadPlanContext`, `runRenameBatch`, `MAX_SHEET_BYTES`/`SHEET_TOO_BIG` (`@/lib/part-docs/photo-sheet`).
- Produces: server actions
  - `planModelNumbersAction(form: FormData)` → `{ ok, rows, plan }`
  - `runModelNumbersBatchAction(input: RenameBatchInput)` → `RenameBatchResult`. Calls `revalidatePath("/catalog")` when complete.

  Both run `await requirePerm("manage_users")`. The batch action re-cleans `rows` (cap 5,000, strings ≤ 2,048) and validates `step` against the allowed list.

**UI** (plain `pk-*` classes / inline styles like `photos/page.tsx`; accent via CSS vars only):
- Title "Model numbers". Intro copy:

  > Replace order-number SKUs with `Brand:Model`. Upload a filled crosswalk sheet. Quotes, assemblies, Grid designs, documents and photos move to the new SKU; sent quotes keep theirs and still open. The old number stays searchable. Back up production first: `npm run db:export`.
- File input → **Preview**: count chips per outcome, a table of `rename` rows (old SKU → new SKU, Model #), and a collapsible list of skipped rows with their reason and sheet row number.
- **Apply N renames**: loops `runRenameBatchAction` until `complete`, showing the step name and running totals, and catches a thrown action with "Could not reach the server. Try again." (resumable: pressing again continues).
- **Fix references**: `refsOnly: true`, starting at `REF_STEPS[0]`.

- [ ] **Step 1: Failing checks** (source pins + pure):
  - `page.tsx` and `actions.ts` contain `requirePerm("manage_users")`.
  - The client catches the action await.
  - `smoke-routes.ts` lists `/catalog/model-numbers`.
  - `readSheetFile` honours `sheetName` (build a two-sheet workbook with exceljs in the check, Crosswalk second).
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: PASS, tsc clean, `npx eslint src/app/(app)/catalog/model-numbers src/lib/catalog-rename`** clean.
- [ ] **Step 5: Commit** `feat(catalog): #304 Catalog → Model numbers (upload crosswalk, preview, apply)`

---

### Task 10: Docs, gates, local dry run, merge, push

- [ ] **Step 1: Docs** (recompute numbers from `origin/main` right before writing):
  - `DECISIONS.md` gets D635+ for:
    - the SKU rule (`Brand:Model`, 60 cap, sanitized)
    - real rename + `renamedTo` redirect vs alias
    - frozen history untouched
    - importer resolution order
    - customer docs print the model only
    - admin-only tool
  - `PUNCHLIST.md` gets #304 with Jeff-gated steps: run `db:export`, upload the Symetrix sheet, then Biamp/EAW/Meyer when ChatGPT's sheets arrive.
  - `AGENTS.md` gets phase entry 41.
- [ ] **Step 2: Gates** (memory: peak-verification-gate-protocol). Run `npx tsc --noEmit -p .`, `npm run test:specs`, eslint vs a baseline (`git diff --name-only origin/main | xargs npx eslint`), and `npx next build` (in the worktree; it gives each worker a throwaway datadir). Then `npm run test:smoke` against a scratch-datadir dev server (memory: peak-exercising-post-routes-safely / worktree traps). Report real numbers.
- [ ] **Step 3: Local dry run on a COPY of the real book.** Stop nothing in the main checkout. `cp -R /Users/sm/Downloads/peak-app/.data/pglite <scratch>/pglite-302` only if no process holds it (`lsof +D`). Run a tsx script with `PGLITE_PATH=<scratch>/pglite-302` that plans and applies the Symetrix filled sheet, then prints counts and a sample of rewritten refs. Delete the scratch copy afterwards.
- [ ] **Step 4: Final whole-branch review** (superpowers:requesting-code-review), fix findings.
- [ ] **Step 5: Merge to main + push.** Fast-forward or merge `feat/302-model-sku` into `origin/main` from the worktree (`git fetch && git rebase origin/main`, gates again if main moved, `git push origin HEAD:main`). Check the Vercel deploy status.

---

## Display survey (input to Task 7)

**Customer-facing: switch to `partModel(...)`.** Read each site first; where it has a line with its own `manufacturerModelNumber` (quote items carry one), prefer the line's copy, then the catalog part's.

| Site | Prints today | Change |
|---|---|---|
| `src/lib/estimate-output/bom.ts:62-63` | `manufacturerPartNumber` | `part` column = line model → `partModel(catalog part)`; never the order # when a model exists. `BomCatalogPart` gains `manufacturerModelNumber`, and `package-loader.ts:48` loads it. |
| `src/components/estimate-output/package-view.tsx:158-159` | `r.part` | Fine once bom.ts changes; rename the header to "Model" if it says "Part". |
| `src/app/portal/catalog/part-sidebar.tsx:96,100,360` | `mpn` / `sku` | Show `model` (index already carries it, `portal-catalog-index.ts:314,361`), falling back to mpn, then the sku tail. The accessory row at :360 shows mfr · model. |
| `src/app/portal/catalog/catalog-client.tsx:186` | `sku` | Model (the tile's index entry has `model`/`mpn`). Add `model` to the tile entry type if it's missing. |
| `src/app/portal/catalog/fixture-config.tsx:81,102` | `sku` | Model. Add a `model` field to the fixture add-on row data built server-side. |
| `src/app/portal/catalog/quote/cart-client.tsx:125,144` | `sku` | Model. Add a `model` to the cart line view the server builds. |
| `src/components/cutsheets/cut-sheet-pages.tsx:88` | `h.sku` | Model. The hardware row builder in `src/lib/curtain-cut-sheets/` adds `model: partModel(part)`. |
| `src/components/rack/RackSheets.tsx:189` | `r.sku` | Model. The schedule row builder in `src/lib/rack/` adds `model`. |
| `src/lib/specs/assemble-section.ts:442` | already model-first | Replace the inline expression with `partModel(c.part)`. Behaviour is identical; it's the single rule. |
| `src/app/(app)/estimator/parts-csv.ts:59,102,189` | already model-first | Use `partModel` for the info fallback. Leave the vendor-line column as is (it has no catalog part). |
| `src/components/drawing/drawing-set-sheets.tsx:45` | `it.code` (partId) | Show `partModel(parts.get(partId))` when the part resolves; keep "CURTAIN" and the unresolved fallback. |

Already clean, no change: the estimate PDF (`quote-document.tsx` prints desc only), the cover PDF, narrative, riser, and service letters.

**Staff-facing: switch to `staffPartLabel(...)`.** Render as `<primary>` plus a muted ` · <secondary>` when present:
- the catalog page list rows (`src/app/(app)/catalog/page.tsx`, the SKU cell)
- the ⌘K result rows (`src/app/api/search/route.ts:256` subtitle)
- the Estimator add-part picker rows (`src/app/(app)/estimator/` picker, ~`:183-189`)
- the Datasheets list (`documents-client.tsx:212`, already `r.model`; confirm `views.ts:173` uses `partModel`)

Keep the SKU visible in the catalog list (it's the key staff edit by). The label sits beside it, it doesn't replace it.
