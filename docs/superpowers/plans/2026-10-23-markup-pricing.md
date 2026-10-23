# Markup Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every pricing percentage in Quartzite becomes markup on cost (`sell = cost × (1 + markup)`). No saved quote changes its sell amount, and settings round to whole percents.

**Architecture:**
- **One converter module.** A pure `src/lib/markup/` module holds the conversion math and the `sellAt` formula.
- **The engines.** Every pricing engine and back-solve switches to it, file group by file group.
- **Saved docs.** The generic doc store converts any unstamped `quotes` / `projects` doc exactly on read (`pricingBasis: "markup"` marks a converted doc), and builders stamp new docs.
- **Settings.** Each rate blob converts itself once, rounded to a whole %, under a row lock.
- **Proof.** A price-parity harness built from margin-era outputs, captured before any engine changes, proves the dollars match.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle on Postgres / PGlite, `tsx` test scripts (`npm run test:specs`, `npm run test:smoke`).

**Spec:** `docs/superpowers/specs/2026-10-23-markup-pricing-design.md`

## Global Constraints

- Formula: `sell = cost × (1 + markup)`, `markup = (sell − cost) ÷ cost`. Conversion: `markup = margin ÷ (1 − margin)`, `margin = markup ÷ (1 + markup)`.
- **No saved quote changes its sell amount.** Line prices (`price`, `extSellOverride`, typed sells, `total`, `value`) are never rewritten by any conversion.
- Settings round to a whole %. Tiers 30/27/22/20/15/10/5 become 43/37/28/25/18/11/5. The flame, repair, inspection, repair-parts and catalog defaults become 0.43. `system.baseMargin` becomes 43.
- Code constants: curtain and every 0.30 fallback become **0.43** (`DEFAULT_MARKUP`). Custom part 0.35 becomes **0.54**. The Grid labor cost fallback becomes `sell ÷ 1.43`. `LOW_MARGIN_WARN` 0.10 becomes **0.11**. Line colours become **43 % / 22 %**. The labor clamp (0.95 margin) becomes **19** (1,900 % markup).
- Ranges: Estimator sliders **0–125**. Service knob **10–100** (server clamp **5–100**). Estimating Rules cap on a markup rate **150**.
- Copy: every pricing % is **"Markup"**, never "margin" or "pts".
- Stored field names (`margin`, `tierMargin`, `rates.margin`, `partsMargin`, `laborGroups[*].draft.margin`, `project.margin`) **keep their names** and hold markup once a doc is stamped. The doc stamp is `pricingBasis: "markup"`.
- **No rollback past the merge; fix forward.** **Never deploy a Vercel preview of this branch** (previews share the production Neon DB).
- The dev DB is single-process (AGENTS.md). Never leave a `tsx` script running, and check `ps aux | grep tsx` before starting the dev server.
- Work on branch `feat/markup-pricing`. Commit once per task, ending each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gate: `npx tsc --noEmit` · `npm run test:specs` · `npm run test:smoke` · `npx eslint <changed files>` · `npx next build`.

## Where this plan differs from the spec (tell Jeff)

1. **Only `quotes` and `projects` store margins.** Saved Quick Designs (`designs`) compute theirs fresh at promotion, so the converter covers two collections, not three. Grid projects and portal carts store none either.
2. **No temporary entry-point adapters.** Tasks 3–6 switch the engines; Task 7 switches the data and defaults. During Tasks 3–6, pure engine checks stay green. DB-backed checks that price from *stored or default* rates may be red, and each task lists them. `test:specs` must be fully green from Task 7 on.
3. **The "legacy twin" rule (new).** A line priced at an old exact markup (Base 42.857 %) still counts as "at the tier seed" against the rounded 43 % stamp. Without it, the first tier change after the switch would call every old line hand-priced. Renewal re-pricing uses the same rule, so it doesn't call every renewal's rate "changed".
4. **The service knob keeps exact points for saved quotes.** A saved service quote reopens at 42.857 (shown "42.9"), so re-saving it without touching the knob can't move its $25-rounded total.

## Test state policy (Tasks 3–6)

Each of Tasks 3–6 must:
- keep every check it rewrote green;
- run the full `npm run test:specs` and paste the names of any failing checks into its report;
- show that every failure prices through a *stored or default* rate or tier (a DB fixture, `getXRates()`, `resolveTier`), not through a pure function with explicit inputs.

Task 7 turns those green.

## File map

**New**
- `src/lib/markup/index.ts`: conversion math, `sellAt`, formatting, `legacyTwinOf`. No imports.
- `src/lib/markup/doc-basis.ts`: pure converters for unstamped `quotes` / `projects` docs.
- `src/lib/markup/settings.ts`: the pure settings-blob conversion patch, plus `withoutBasisKeys`.
- `scripts/test-markup.ts`: `markupPureChecks`, `markupDbChecks`, `markupParityChecks`.
- `scripts/markup-parity-cases.ts`: parity fixtures in margin terms, shared by the capture and the harness.
- `docs/markup/parity-baseline.json`: margin-era outputs (generated once in Task 2).

**Modified (by task)**
- Task 3, the Estimator:
  - `src/app/(app)/estimator/`: `pricing.ts`, `tier-reprice.ts`, `labor-group.ts`, `copy-system.ts`, `track-bom.ts`, `use-estimator-state.ts`, `vendor-quote-modal.tsx`, `catalog-picker.tsx`, `section-card.tsx`, `steps/build-step.tsx`, `estimator-header.tsx`, `review-cost-summary.tsx`, `actions.ts`.
  - `src/lib/pricing-tiers.ts` and its consumers (property renames).
  - `src/lib/system-categories.ts`, `src/lib/assist/features/suggestion.ts`, `src/lib/narrative/load-system.ts`, `src/app/(app)/estimator/library-actions.ts`.
- Task 4, the services: `src/lib/service-pricing.ts`, the three engines, `src/lib/travel-plan.ts`, `src/lib/tier-seed.ts`, `src/lib/renewal-outreach.ts`, `src/lib/portal-service-pricing.ts`, `src/components/service-total-field.tsx`, the three `quote/actions.ts` + `quote/controls.tsx`, and the three `letter/letter-view.tsx`.
- Task 5, curtains, Grid, Quick Design and the portal:
  - Curtains: `src/lib/curtain-pricing.ts`, `src/lib/design/curtain-pricing.ts`, `src/lib/design/grid-curtains.ts`.
  - Grid: `src/lib/tier-pricing.ts`, `src/lib/design/{grid-quote,grid-bom,grid-custom-items,equipment-map,equipment-map-view,grid-virtual-parts,equipment-pricing,auto-estimate}.ts`, `src/lib/stores/equipment-map.ts`, `src/app/(app)/design/grid/[id]/{actions.ts,page.tsx}`.
  - Quick Design: `src/app/(app)/design/quick/engine.ts`.
  - Portal: `src/lib/{portal-price-rules,portal-pricing,portal-part-detail}.ts`.
- Task 6, reports: `src/lib/dashboard/metrics.ts`, `src/app/(app)/_dashboard/widgets/{backward,installs}.tsx`, `src/lib/dashboard/registry.ts`, `src/lib/estimate-bonus/rules.ts` (comments only).
- Task 7, wiring: `src/db/doc-store.ts`, `src/lib/stores/{quotes,projects,pricing}.ts`, `src/app/api/sync/push/route.ts`, `src/db/seeds/{quotes,projects}.ts`.
- Task 9, screens and words: everything in §3 of the spec.
- Task 10, docs: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`, `OPEN-DECISIONS.md`, `MASTER-QUESTIONS.md`.

## Canonical names (every task uses exactly these)

| Old | New |
|---|---|
| `marginColor(m)` | `markupColor(k)` |
| `lineMarginOf` | `lineMarkupOf` |
| `repriceAtMargin` | `repriceAtMarkup` |
| `repricedAtLineMargin` | `repricedAtLineMarkup` |
| `systemMargin` | `systemMarkup` |
| `QuoteTotals.margin` | `QuoteTotals.markup` |
| `LaborCalc.margin` | `LaborCalc.markup` |
| `reconcileEstimatorValue → {value, margin, adjusted}` | `→ {value, markup, adjusted}` |
| `TIER_FALLBACK_MARGIN` | `TIER_FALLBACK_MARKUP` |
| `usableTierMargin` | `usableTierMarkup` |
| `seedMarginOf` | `seedMarkupOf` |
| `laborSeedMarginOf` | `laborSeedMarkupOf` |
| `CUSTOM_PART_MARGIN` | `CUSTOM_PART_MARKUP` |
| `tierSeedMarginFor` | `tierSeedMarkupFor` |
| `draftMargin` (labor-group) | `draftMarkup` |
| `syncLaborDraftMargins` | `syncLaborDraftMarkups` |
| `keepMarginOnNewCost` | `keepMarkupOnNewCost` |
| `setMarginAll` / `setSystemMargin` / `onSetMargin` | `setMarkupAll` / `setSystemMarkup` / `onSetMarkup` |
| `vendorFormMargin` | `vendorFormMarkup` |
| `ResolvedTier.margin`, `BuilderTier.margin` | `.markup` |
| `tierMargin()` / `tierMarginByCompany()` / `serviceMarginFor()` (pricing-tiers) | `tierMarkup()` / `tierMarkupByCompany()` / `serviceMarkupFor()` |
| `LOW_MARGIN_WARN` | `LOW_MARKUP_WARN` (0.11) |
| `MARGIN_SLIDER_MIN/MAX` | `MARKUP_SLIDER_MIN/MAX` (10/100) |
| `sellAtMargin` | `sellAtMarkup` |
| `effectiveMargin` (FinishedPrice, engine results) | `effectiveMarkup` |
| `serviceMargin` (repair finish/engine result) | `serviceMarkup` |
| `fmtPts` / `sliderPts` | `fmtPct` / `sliderPct` |
| PriceWarning kind `"low-margin"` | `"low-markup"` |
| `validMargin` / `knobPtsFrom` (tier-seed) | `validMarkup` / `knobPctFrom` |
| `savedMarginPts` / `stampedTierMargin` (tier-seed opts, builder props) | `savedMarkupPts` / `stampedTierMarkup` |
| `CURTAIN_MARGIN` (both modules) | `CURTAIN_MARKUP` |
| `LABOR_COST_FRAC_FALLBACK` | `LABOR_FALLBACK_MARKUP` |
| `bomTotals().margin`, `EquipmentPriceTable.margin`, `EquipPriceCtx.margin`, `PriceRuleOpts.margin`, portal ctx `margin` | `.markup` |
| dashboard `avgMargin`, `projectedProfit().margin` | `avgMarkup`, `.markup` |

Variables that hold the stored doc field keep the field's name (`tierMargin` in Estimator state, `quote.margin`). After Task 7 they hold markup.

---

### Task 1: The markup module

**Files:**
- Create: `src/lib/markup/index.ts`
- Create: `scripts/test-markup.ts`
- Modify: `scripts/test-review-and-spec.ts` (import and run the new checks)

**Interfaces:**
- Produces:
  - Constants: `PRICING_BASIS`, `MARKUP_MAX = 19`, `DEFAULT_MARKUP = 0.43`.
  - Conversion: `marginToMarkup(m)`, `markupToMargin(k)`.
  - Pricing: `sellAt(cost, k)`, `markupOf(cost, sell): number | null`, `costFromSell(sell, k)`.
  - Rounding and comparison: `roundMarkupPct(k)`, `sameWholeMarkup(a, b)`, `legacyTwinOf(k): number | null`.
  - Display: `fmtMarkupPct(k)`, `markupPctString(k)`.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/sm/Downloads/peak-app && git switch feat/markup-pricing
```

- [ ] **Step 2: Write the failing checks** in `scripts/test-markup.ts`:

```ts
/* Markup pricing (docs/superpowers/specs/2026-10-23-markup-pricing-design.md) — harness checks.
   `markupPureChecks` needs no database; `markupDbChecks` needs the test DB (test:specs runs both).
   Pure half alone: `npx tsx scripts/test-markup.ts`. */
import type { Ok } from "./test-inbox-org";
import {
  DEFAULT_MARKUP, MARKUP_MAX, PRICING_BASIS, costFromSell, fmtMarkupPct, legacyTwinOf, marginToMarkup,
  markupOf, markupPctString, markupToMargin, roundMarkupPct, sameWholeMarkup, sellAt,
} from "../src/lib/markup";

const near = (a: number | null | undefined, b: number, eps = 1e-9) => a != null && Math.abs(a - b) <= eps;

export async function markupPureChecks(ok: Ok) {
  ok(PRICING_BASIS === "markup" && MARKUP_MAX === 19 && DEFAULT_MARKUP === 0.43, "markup: constants");
  ok(near(marginToMarkup(0.3), 0.3 / 0.7) && near(marginToMarkup(0.2), 0.25) && near(marginToMarkup(0), 0), "markup: margin → markup (30 % = 42.857 %, 20 % = 25 %)");
  ok(marginToMarkup(0.95) === 19 && marginToMarkup(1) === 19 && marginToMarkup(Number.NaN) === 0, "markup: margin ≥ 0.95 clamps to 19, junk → 0");
  ok(near(marginToMarkup(-0.1), -0.1 / 1.1), "markup: a negative margin (priced below cost) stays negative");
  ok(near(markupToMargin(0.25), 0.2) && near(markupToMargin(marginToMarkup(0.37)), 0.37) && markupToMargin(Number.NaN) === 0, "markup: markup → margin round-trips");
  ok(Number.isFinite(markupToMargin(-5)), "markup: markupToMargin never returns a non-finite number");
  for (const m of [0.05, 0.1, 0.15, 0.2, 0.22, 0.27, 0.3, 0.35, 0.42]) {
    for (const cost of [0.01, 1, 9.99, 100, 1234.56, 99999.99]) {
      const a = Math.round((cost / (1 - m)) * 100) / 100;
      const b = Math.round(sellAt(cost, marginToMarkup(m)) * 100) / 100;
      if (a !== b) ok(false, `markup: sellAt parity at cost ${cost}, margin ${m}: ${a} vs ${b}`);
    }
  }
  ok(true, "markup: sellAt(cost, marginToMarkup(m)) rounds to the same cent as cost ÷ (1 − m) across the tier grid");
  ok(sellAt(100, 0.43) === 143 && sellAt(100, Number.NaN) === 100, "markup: sellAt = cost × (1 + k); junk markup sells at cost");
  ok(near(markupOf(100, 143), 0.43) && markupOf(0, 50) === null && markupOf(100, Number.NaN) === null, "markup: markupOf back-solves; no cost → null");
  ok(near(costFromSell(143, 0.43), 100) && costFromSell(50, -1) === 50, "markup: costFromSell is the inverse; 1 + k ≤ 0 → sell");
  ok(roundMarkupPct(0.428571) === 0.43 && roundMarkupPct(0.1111) === 0.11 && roundMarkupPct(0.0526) === 0.05, "markup: whole-% rounding");
  ok(sameWholeMarkup(0.428571, 0.43) && !sameWholeMarkup(0.42, 0.43), "markup: sameWholeMarkup compares whole percents");
  ok(near(legacyTwinOf(0.43), 0.3 / 0.7) && near(legacyTwinOf(0.37), 0.27 / 0.73) && near(legacyTwinOf(0.11), 0.1 / 0.9), "markup: a rounded tier's legacy twin is the exact markup it rounded from");
  ok(legacyTwinOf(0.25) === null && legacyTwinOf(0) === null && legacyTwinOf(Number.NaN) === null, "markup: an exact conversion (Gold 25 %) has no twin; 0 / junk → null");
  ok(fmtMarkupPct(0.428571) === "42.9%" && fmtMarkupPct(0.43) === "43%", "markup: one-decimal percent display");
  ok(markupPctString(0.3 / 0.7) === "42.8571" && markupPctString(0.43) === "43", "markup: labor-draft percent string (4 dp)");
}

export async function markupDbChecks(_ok: Ok) {
  /* Task 7 fills this in. */
}

if (require.main === module) {
  let fails = 0;
  const ok: Ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
  markupPureChecks(ok).then(() => { console.log(fails ? `${fails} FAIL` : "markup pure: ALL PASSED"); process.exit(fails ? 1 : 0); });
}
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx tsx scripts/test-markup.ts`
Expected: an error that `../src/lib/markup` can't be resolved.

- [ ] **Step 4: Write `src/lib/markup/index.ts`**

```ts
/**
 * Markup pricing (spec docs/superpowers/specs/2026-10-23-markup-pricing-design.md):
 * every pricing percentage in Quartzite is markup on cost —
 *   sell = cost × (1 + markup)      markup = (sell − cost) ÷ cost
 * replacing the margin-on-price convention (D87, D413, D635). NO imports: the
 * doc store, "use client" builders, engines and the harness all share it.
 */

/** The stamp on a quote / project doc whose stored percentages are markup. */
export const PRICING_BASIS = "markup" as const;
export type PricingBasis = typeof PRICING_BASIS;

/** 1,900 % — the old 0.95 margin clamp (labor, sellFromCost guards), in markup. */
export const MARKUP_MAX = 19;

/** Peak's flat default: the old 30 % margin (42.857 %) rounded to a whole percent. */
export const DEFAULT_MARKUP = 0.43;

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Exact: m ÷ (1 − m). A margin ≥ 0.95 clamps to MARKUP_MAX; junk → 0. */
export function marginToMarkup(m: number): number {
  if (!fin(m)) return 0;
  if (m >= 0.95) return MARKUP_MAX;
  return m / (1 - m);
}

/** Exact: k ÷ (1 + k), with k floored at −0.99 so the result is always finite; junk → 0. */
export function markupToMargin(k: number): number {
  if (!fin(k)) return 0;
  const c = Math.max(k, -0.99);
  return c / (1 + c);
}

/** cost × (1 + markup). A non-finite markup sells at cost. Unrounded — callers round as before. */
export function sellAt(cost: number, markup: number): number {
  return fin(markup) ? cost * (1 + markup) : cost;
}

/** (sell − cost) ÷ cost; null when there is no positive cost or either number is junk. */
export function markupOf(cost: number, sell: number): number | null {
  if (!fin(cost) || !fin(sell) || !(cost > 0)) return null;
  return (sell - cost) / cost;
}

/** sell ÷ (1 + markup) — the cost behind a sell; sell itself when 1 + markup ≤ 0 or junk. */
export function costFromSell(sell: number, markup: number): number {
  return fin(markup) && 1 + markup > 0 ? sell / (1 + markup) : sell;
}

/** To a whole percent: 0.428571 → 0.43. */
export function roundMarkupPct(k: number): number {
  return fin(k) ? Math.round(k * 100) / 100 : 0;
}

/** Same whole percent (0.428571 and 0.43 are both 43 %). */
export function sameWholeMarkup(a: number, b: number): boolean {
  return fin(a) && fin(b) && Math.round(a * 100) === Math.round(b * 100);
}

/**
 * The exact legacy markup a rounded markup came from, else null. Every
 * pre-switch tier/default was a whole-percent MARGIN, so a converted setting
 * rounded to whole-% markup has one twin: 0.43 ← 0.428571 (30 %), 0.37 ←
 * 0.369863 (27 %). Lines priced before the switch sit at the twin; seed
 * checks accept either. Exact conversions (Gold 25 %) have no twin.
 */
export function legacyTwinOf(k: number): number | null {
  if (!fin(k) || !(k > 0)) return null;
  const wholeMargin = Math.round(markupToMargin(k) * 100) / 100;
  const twin = marginToMarkup(wholeMargin);
  return twin !== k && Math.abs(twin - k) < 0.005 ? twin : null;
}

/** "42.9%" / "43%" — one decimal at most. */
export function fmtMarkupPct(k: number): string {
  const v = Math.round((fin(k) ? k : 0) * 1000) / 10;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}

/** A labor draft's stored percent string: 0.428571… → "42.8571", 0.43 → "43". */
export function markupPctString(k: number): string {
  return String(Math.round((fin(k) ? k : 0) * 1e6) / 1e4);
}
```

- [ ] **Step 5: Run the checks and confirm they pass**

Run: `npx tsx scripts/test-markup.ts`
Expected: `markup pure: ALL PASSED`

If a `sellAt parity` line fails, that cost/margin pair is a float tie. Record the pair in the task report and change neither file; Task 8 lists it.

- [ ] **Step 6: Run the checks inside `test:specs`.** In `scripts/test-review-and-spec.ts`, add the import beside the other suite imports (the block near line 11356):

```ts
import { markupPureChecks, markupDbChecks } from "./test-markup";
```

Then chain them after the box-sale suite (line ~11778, `.then(() => boxSalePureChecks(ok)).then(() => boxSaleDbChecks(ok))`):

```ts
  .then(() => markupPureChecks(ok)).then(() => markupDbChecks(ok))
```

- [ ] **Step 7: Run the gate for this task**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | tail -5`
Expected: tsc prints nothing; `ALL PASSED` with the new `markup:` checks counted.

- [ ] **Step 8: Commit**

```bash
git add src/lib/markup/index.ts scripts/test-markup.ts scripts/test-review-and-spec.ts
git commit -m "feat(markup): #367 markup conversion module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Capture the margin-era parity baseline

This must run **before any engine changes**. It records today's prices so Task 8 can prove the markup engines produce the same dollars.

**Files:**
- Create: `scripts/markup-parity-cases.ts`
- Create: `scripts/markup-parity-capture.ts` (deleted again in Task 3, Step 1)
- Create: `docs/markup/parity-baseline.json` (generated)

**Interfaces:**
- Produces: `CASE_COSTS`, `CASE_MARGINS`, `FLAME_CASES`, `REPAIR_CASES`, `INSPECTION_CASES`, `LABOR_DRAFT`, `laborRate`, `CURTAIN_CASES`, `SECTIONS`, and the JSON shape `{ cases: Record<string, unknown> }` with the keys listed in Step 3.

- [ ] **Step 1: Write `scripts/markup-parity-cases.ts`.** All inputs are in MARGIN terms, and the fixtures are copied from the existing #208 checks (`scripts/test-review-and-spec.ts:10409-10460`).

```ts
/* Markup parity fixtures (#367) — inputs in MARGIN terms. The capture (Task 2) runs them through the margin-era
   engines; the harness (scripts/test-markup.ts markupParityChecks) converts each margin with marginToMarkup and runs
   the markup engines. Data only — no engine imports, so this file compiles before and after the switch. */
export const CASE_COSTS = [0.01, 1, 9.99, 100, 333.33, 1234.56, 99999.99] as const;
export const CASE_MARGINS = [0.05, 0.1, 0.15, 0.2, 0.22, 0.27, 0.3, 0.35] as const;

const flameRates = { mileageRate: 1, laborRate: 75, curtainMinutes: 5, baseFee: 150, margin: 0.3, travelRoundMin: 15 };
export const FLAME_CASES = [
  { id: "flame-near", opts: { venues: [{ id: "trv-near", label: "Near", curtains: 12, oneWayMiles: 100, oneWayMin: 120 }] }, rates: flameRates },
  { id: "flame-far", opts: { venues: [{ id: "trv-far", label: "Far", curtains: 120, oneWayMiles: 500, oneWayMin: 480 }] }, rates: flameRates },
  { id: "flame-gold", opts: { venues: [{ id: "trv-near", label: "Near", curtains: 40, oneWayMiles: 30, oneWayMin: 40 }] }, rates: { ...flameRates, margin: 0.2 } },
  { id: "flame-typed", opts: { venues: [{ id: "trv-near", label: "Near", curtains: 12, oneWayMiles: 100, oneWayMin: 120 }], priceOverride: 1000 }, rates: flameRates },
];

const repairRates = { laborRate: 75, mileageRate: 1, minCallout: 350, partsMargin: 0.3, margin: 0.3, emergencyMult: 1.5, travelRoundMin: 15 };
export const REPAIR_CASES = [
  { id: "repair-near", opts: { venues: [{ label: "Near", oneWayMiles: 60, oneWayMin: 70 }], laborHours: 4 }, rates: repairRates },
  { id: "repair-far", opts: { venues: [{ label: "Far", oneWayMiles: 500, oneWayMin: 480 }], laborHours: 24 }, rates: repairRates },
  { id: "repair-parts", opts: { venues: [{ label: "Near", oneWayMiles: 60, oneWayMin: 70 }], laborHours: 6, parts: [{ desc: "Cable", qty: 4, cost: 87.5 }] }, rates: { ...repairRates, partsMargin: 0.25 } },
  { id: "repair-lift", opts: { venues: [{ label: "Near", oneWayMiles: 60, oneWayMin: 70 }], laborHours: 4, lift: { count: 1, rate: 450 } }, rates: repairRates },
];

const inspRates = { laborRate: 75, mileageRate: 1, lineSetMinutes: 15, baseHours: 2, level2Mult: 1.75, minFee: 650, margin: 0.3, travelRoundMin: 15 };
export const INSPECTION_CASES = [
  { id: "insp-near", opts: { venues: [{ id: "trv-i1", label: "Near", lineSets: 20, oneWayMiles: 60, oneWayMin: 70 }] }, rates: inspRates },
  { id: "insp-far", opts: { venues: [{ id: "trv-i2", label: "Far", lineSets: 40, oneWayMiles: 500, oneWayMin: 480 }] }, rates: inspRates },
  { id: "insp-l2", opts: { level: 2, venues: [{ id: "trv-i1", label: "Near", lineSets: 20, oneWayMiles: 60, oneWayMin: 70 }] }, rates: { ...inspRates, margin: 0.15 } },
];

/** A labor draft with no mobilizations: cost = shop hrs × SHP-IN + misc. `margin` is a margin percent string. */
export const LABOR_DRAFT = { discipline: "RIG", margin: "30", mobs: [], pmHrs: "", pmAuto: true, shopHrs: "10", drfHrs: "", drfAuto: true, misc: "1000" };
export const laborRate = (sku: string) => (sku === "SHP-IN" ? 85 : sku === "SHP-PM" ? 95 : 70);

export const CURTAIN_CASES = [
  { id: "curtain-30", spec: { width: "40", height: "22", fullness: "50" }, rates: { fabricRate: 2.75, sewingPct: 10 }, margin: 0.3 },
  { id: "curtain-20", spec: { width: "12.5", height: "18", fullness: "100" }, rates: { fabricRate: 4.1, sewingPct: 10 }, margin: 0.2 },
];

/** Two systems priced at 30 % and 22 % margin, one with freight and a typed sell. */
export const SECTIONS = [
  { id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 3, items: [
    { id: 1, sku: "A", desc: "A", qty: 2, unit: "ea", cost: 100, price: 142.86 },
    { id: 2, sku: "B", desc: "B", qty: 5, unit: "ea", cost: 37.4, price: 53.43 },
  ] },
  { id: "s2", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, sellOverride: 5000, items: [
    { id: 3, sku: "C", desc: "C", qty: 10, unit: "ea", cost: 300, price: 384.62 },
  ] },
];
```

- [ ] **Step 2: Check the fixture keys against the engine option types.** `repair-parts` and `repair-lift` use `parts` and `lift`. Open `src/lib/repair-engine.ts` (`RepairEstimateOptions`) and rename those keys to whatever the option type calls them. Do the same for `priceOverride` on `FlameTestComputeOpts` (`src/lib/flametest-engine.ts`) and `level` on `InspectionEstimateOptions`. Change only key names, never values.

- [ ] **Step 3: Write `scripts/markup-parity-capture.ts`**

```ts
/* ONE-SHOT (#367 Task 2): records margin-era prices into docs/markup/parity-baseline.json. Run once on the
   untouched engines, commit the JSON; Task 3 deletes this script (the names it imports are renamed there). */
import { mkdirSync, writeFileSync } from "node:fs";
import { catalogAddPrice, customPartSell, repriceForTier } from "../src/app/(app)/estimator/tier-reprice";
import { buildLaborItems, computeLabor, repriceAtMargin, systemMargin, totals } from "../src/app/(app)/estimator/pricing";
import type { LaborDraft, SpecSection } from "../src/app/(app)/estimator/types";
import { compute as flame } from "../src/lib/flametest-engine";
import { computeEstimate as repair } from "../src/lib/repair-engine";
import { computeEstimate as inspection } from "../src/lib/inspection-engine";
import { curtainCost, fabricSellPerSqft } from "../src/lib/curtain-pricing";
import { curtainPrice } from "../src/lib/design/curtain-pricing";
import { sellFromCost } from "../src/lib/design/equipment-map";
import { unitPriceFor } from "../src/lib/portal-price-rules";
import { travelLineAmount } from "../src/lib/travel-plan";
import { printedLift, travelLineShare } from "../src/lib/service-pricing";
import { CASE_COSTS, CASE_MARGINS, CURTAIN_CASES, FLAME_CASES, INSPECTION_CASES, LABOR_DRAFT, REPAIR_CASES, SECTIONS, laborRate } from "./markup-parity-cases";

const cases: Record<string, unknown> = {};
const grid = (f: (c: number, m: number) => unknown) => CASE_COSTS.map((c) => CASE_MARGINS.map((m) => f(c, m)));

cases.catalogAddPrice = grid((c, m) => catalogAddPrice(c, 0, m));
cases.customPartSell = CASE_COSTS.map((c) => customPartSell(c));
cases.repriceAt = grid((c, m) => repriceAtMargin(c, m).price);
cases.sellFromCost = grid((c, m) => sellFromCost(c, m));
cases.portalUnit = grid((c, m) => unitPriceFor({ cost: c, list: 0 }, { margin: m, staleCostMonths: 0, now: 0 }).unitPrice);
cases.curtainPrice = grid((c, m) => curtainPrice(c, m));
cases.travelLine = grid((c, m) => travelLineAmount(c * 10, m));
cases.travelShareLegacy = grid((c, m) => travelLineShare({ flightTotal: c * 10, total: c * 30, margin: m }));
cases.printedLift = CASE_MARGINS.map((m) => printedLift({ lift: { count: 2, rate: 450 } }, m));
cases.curtains = CURTAIN_CASES.map((k) => ({ id: k.id, cost: curtainCost(k.spec as never, k.rates, k.margin), perSqft: fabricSellPerSqft(k.rates, k.margin) }));
const pick = (r: Record<string, unknown>) => ({ totalRaw: r.totalRaw, autoTotal: r.autoTotal, total: r.total, cost: r.cost, marginAmount: r.marginAmount, effectiveMargin: r.effectiveMargin, serviceMargin: r.serviceMargin, partsSell: r.partsSell, liftSell: r.liftSell, liftLine: r.liftLine });
cases.flame = FLAME_CASES.map((k) => ({ id: k.id, ...pick(flame(k.opts as never, k.rates) as never) }));
cases.repair = REPAIR_CASES.map((k) => ({ id: k.id, ...pick(repair(k.opts as never, k.rates) as never) }));
cases.inspection = INSPECTION_CASES.map((k) => ({ id: k.id, ...pick(inspection(k.opts as never, k.rates) as never) }));
const labor = computeLabor(LABOR_DRAFT as unknown as LaborDraft, laborRate);
let n = 100;
cases.labor = { totalPrice: labor.totalPrice, items: buildLaborItems(labor, "Rigging", () => n++).map((it) => ({ cost: it.cost, price: it.price })) };
const secs = SECTIONS as unknown as SpecSection[];
cases.totals = totals(secs, 0);
cases.systemMargin = secs.map((s) => systemMargin(s));
cases.tierReprice = repriceForTier(secs, 0.3, 0.2).sections.map((s) => s.items.map((it) => it.price));

mkdirSync("docs/markup", { recursive: true });
writeFileSync("docs/markup/parity-baseline.json", JSON.stringify({ capturedAt: new Date().toISOString(), commit: process.env.CAPTURE_COMMIT || "", cases }, null, 2) + "\n");
console.log("wrote docs/markup/parity-baseline.json", Object.keys(cases).length, "case groups");
```

If `computeLabor` returns its price under a name other than `totalPrice`, use the `LaborCalc` field that holds `totalCost / (1 − margin)` (`src/app/(app)/estimator/pricing.ts:735`).

- [ ] **Step 4: Run the capture**

Run: `CAPTURE_COMMIT=$(git rev-parse --short HEAD) npx tsx scripts/markup-parity-capture.ts`
Expected: `wrote docs/markup/parity-baseline.json 17 case groups`. Then `ps aux | grep tsx` should show no stray `tsx`.

- [ ] **Step 5: Sanity-check the baseline.** Open the JSON. `cases.flame[0].total` should be `825` and `cases.repair[0].total` should be `875`; those match the existing #208 checks. If either is different, a fixture key in Step 2 was renamed wrongly: fix it and re-run Step 4.

- [ ] **Step 6: Commit**

```bash
git add scripts/markup-parity-cases.ts scripts/markup-parity-capture.ts docs/markup/parity-baseline.json
git commit -m "test(markup): #367 margin-era parity baseline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Estimator engine and the tier names

**Files:**
- Delete: `scripts/markup-parity-capture.ts`
- Modify:
  - `src/app/(app)/estimator/`: `pricing.ts`, `tier-reprice.ts`, `labor-group.ts`, `copy-system.ts`, `track-bom.ts`, `use-estimator-state.ts`, `vendor-quote-modal.tsx`, `catalog-picker.tsx`, `section-card.tsx`, `steps/build-step.tsx`, `estimator-header.tsx`, `review-cost-summary.tsx`, `actions.ts`, `library-actions.ts`.
  - `src/lib/pricing-tiers.ts`, `src/lib/system-categories.ts`, `src/lib/assist/features/suggestion.ts`, `src/lib/narrative/load-system.ts`.
  - Every consumer tsc flags after the `pricing-tiers` renames.
- Test: `scripts/test-review-and-spec.ts` and the other `scripts/test-*.ts` files that call these functions.

**Interfaces:**
- Consumes: `sellAt`, `markupOf`, `legacyTwinOf`, `markupPctString`, `MARKUP_MAX`, `DEFAULT_MARKUP` (Task 1).
- Produces: every Estimator and tier name in the canonical table. `ResolvedTier = { tier, markup, source }`.

- [ ] **Step 1: Delete the capture script** (it imports names this task renames).

```bash
git rm -q scripts/markup-parity-capture.ts
```

- [ ] **Step 2: `pricing.ts`, the formulas.** Add `import { MARKUP_MAX, DEFAULT_MARKUP, sellAt } from "@/lib/markup";` and replace:

```ts
// line 28 header
 * markups price as sell = cost × (1 + markup) (#367; margin-on-price before).

/** Markup readout color: ≥43% green, ≥22% amber, else red-brown (#367: the old 30/18 margin bands). */
export function markupColor(k: number): string {
  return k >= 0.43 ? "#1f8a5b" : k >= 0.22 ? "#9a7d1f" : "#c0683a";
}

/**
 * The markup a priced line is ALREADY carrying, or null when it has none
 * that can be rescaled (#144, D163; #367 markup). A sell of 0 has nothing to
 * read and a $0 cost has no markup. A negative markup — a line hand-priced
 * below its cost — is real and is kept.
 */
export function lineMarkupOf(cost: number, price: number): number | null {
  if (!(price > 0) || !(cost > 0)) return null;
  const k = (price - cost) / cost;
  return Number.isFinite(k) ? k : null;
}

export function repriceAtMarkup(cost: number, markup: number): Pick<SpecItem, "price" | "extSellOverride"> {
  return { price: round2(sellAt(cost, markup)), extSellOverride: undefined };
}

export function repricedAtLineMarkup(
  cost: number,
  price: number,
  newCost: number,
  seedMarkup: number
): number {
  if (newCost === cost) return price;
  const k = lineMarkupOf(cost, price);
  const use = k != null ? k : seedMarkup > 0 && seedMarkup <= MARKUP_MAX ? seedMarkup : DEFAULT_MARKUP;
  return round2(sellAt(newCost, use));
}
```

Keep each function's existing JSDoc paragraph and change "margin" to "markup" in it.

- [ ] **Step 3: `pricing.ts`, the back-solves**

```ts
/** #267: the system's markup at its actual price — (items sell + adjustment
 *  − items cost) ÷ items cost, freight left out as before (#367). */
export function systemMarkup(sec: SpecSection): number {
  const rev = systemItemsRev(sec) + systemSellAdjustment(sec);
  const cost = systemItemsCost(sec);
  return cost > 0 ? (rev - cost) / cost : 0;
}

export function systemSellWarning(sec: SpecSection): PriceWarning {
  if (!hasSellOverride(sec)) return null;
  return typedPriceWarning(systemSellTotal(sec), systemItemsCost(sec) + systemFreight(sec), systemMarkup(sec));
}
```

In `QuoteTotals`, rename the field `margin: number` to `markup: number`. In `totals()`, replace `margin: rev > 0 ? (rev - cost) / rev : 0,` with:

```ts
    markup: cost > 0 ? (rev - cost) / cost : 0,
```

In `reconcileEstimatorValue`, change the return type to `{ value: number; markup: number; adjusted: boolean }`. Rename the parameter `posted.margin` to `posted.markup`, and replace every `t.margin` with `t.markup` and `margin:` with `markup:` in its two returns. In `src/app/(app)/estimator/actions.ts`, at the call site, post `markup` from the client and store `margin: rec.markup` (the persisted field name stays `margin`).

- [ ] **Step 4: `pricing.ts`, curtain and labor**

```ts
// computeCurtain signature
  /** Markup fraction; the customer tier stamp seeds this (item 11, D87; #367) — DEFAULT_MARKUP is the no-tier default. */
  markup: number = DEFAULT_MARKUP
// …and its return line
    priceEach: curtainPrice(cc.costEach, markup),
```

In `LaborCalc`, rename `margin: number` to `markup: number`. In `computeLabor`, replace lines 734–735 with:

```ts
  const markup = Math.min(MARKUP_MAX, Math.max(0, (parseFloat(draft.margin) || 0) / 100));
  const totalPrice = sellAt(totalCost, markup);
```

Then return `markup` where it returned `margin`. In `buildLaborItems`, replace line 847 with:

```ts
  const price = (c: number) => round2(sellAt(c, r.markup));
```

- [ ] **Step 5: `tier-reprice.ts`** (replace lines 42–86, plus the functions below them)

```ts
import { DEFAULT_MARKUP, MARKUP_MAX, legacyTwinOf, sellAt } from "@/lib/markup";

/** The client's fallback when no tier markup is stamped (addPart & co). #367: 30 % margin → 43 % markup. */
export const TIER_FALLBACK_MARKUP = DEFAULT_MARKUP;
export const TIER_REPRICE_TOLERANCE = 0.01;
export const LABOR_REPRICE_TOLERANCE = 0.05;

/** A stamped tier markup, or null when it isn't one (0 < k ≤ MARKUP_MAX). */
export const usableTierMarkup = (k: unknown): number | null =>
  typeof k === "number" && Number.isFinite(k) && k > 0 && k <= MARKUP_MAX ? k : null;

/** The markup a material line was seeded at — the stamp, else 0.43. */
export function seedMarkupOf(k: number | null | undefined): number {
  return usableTierMarkup(k) ?? TIER_FALLBACK_MARKUP;
}

/** The markup a labor line was seeded at — freshLabor's whole percent, clamped as computeLabor reads it. */
export function laborSeedMarkupOf(k: number | null | undefined): number {
  return Math.min(MARKUP_MAX, Math.max(0, Math.round(seedMarkupOf(k) * 100) / 100));
}

const sellAtR = (cost: number, markup: number) => round2(sellAt(cost, markup));

/** #302 (D635) / #367 — the flat markup the Custom part form seeds Unit sell at: 35 % margin → 54 % markup. */
export const CUSTOM_PART_MARKUP = 0.54;

/** #302 — a custom part's seeded Unit sell: round2(cost × 1.54) ($100 → $154.00). 0 for a cost that isn't above 0. */
export function customPartSell(cost: number): number {
  return Number.isFinite(cost) && cost > 0 ? sellAtR(cost, CUSTOM_PART_MARKUP) : 0;
}

export function catalogAddPrice(cost: number, list: number, k: number | null | undefined): number {
  return cost > 0 ? sellAtR(cost, seedMarkupOf(k)) : list;
}
```

Then, below those:
- In `reseedTrackComponents`, just rename the parameter.
- `tierSeedMarginFor` becomes `tierSeedMarkupFor`, with the body `it.labor ? laborSeedMarkupOf(k) : seedMarkupOf(k)`.
- `tierSeedPrice` becomes `sellAtR(normalCostOf(it), tierSeedMarkupFor(it, k))`.
- `isAtTierSeed` gets the legacy-twin rule:

```ts
export function isAtTierSeed(it: Pick<SpecItem, "cost" | "price" | "labor" | "catalogCost">, k: number | null | undefined): boolean {
  const tol = it.labor ? LABOR_REPRICE_TOLERANCE : TIER_REPRICE_TOLERANCE;
  const at = (price: number) => Math.abs(it.price - price) <= tol + 1e-9;
  if (at(tierSeedPrice(it, k))) return true;
  // #367: a line priced before the switch sits at the exact legacy markup a rounded stamp came from.
  const twin = legacyTwinOf(tierSeedMarkupFor(it, k));
  return twin != null && at(sellAtR(normalCostOf(it), twin));
}
```

In `classify` and `repriceForTier`, replace every `laborSeedMarginOf` with `laborSeedMarkupOf` and every `seedMarginOf` with `seedMarkupOf`. Change the guards `next > 0 && next < 1` and `prev > 0 && prev < 1` to `usableTierMarkup(next)` / `usableTierMarkup(prev)`:

```ts
  const nextK = usableTierMarkup(next);
  if (nextK == null) return nothing;
  const prevM = usableTierMarkup(prev);
  if (seedMarkupOf(prevM) === nextK) return nothing;
```

Use `nextK` where the function used `next`. In `tierRepriceMessage`, rename the `margin` parameter to `markup`; the text format is unchanged ("to Gold (25%)").

- [ ] **Step 6: `labor-group.ts`**

```ts
import { MARKUP_MAX, sellAt } from "@/lib/markup";

/** The labor draft's markup fraction, read exactly as computeLabor reads it. */
function draftMarkup(d: LaborDraft): number {
  return Math.min(MARKUP_MAX, Math.max(0, (parseFloat(d.margin) || 0) / 100));
}
// line 127
    const seed = round2(sellAt(it.cost, m));
```

Rename `syncLaborDraftMargins(sec, prevMargin, nextMargin)` to `syncLaborDraftMarkups(sec, prevMarkup, nextMarkup)`. The body is the same with `draftMarkup`. Update the caller in `tier-reprice.ts`.

- [ ] **Step 7: `copy-system.ts`**

```ts
function keepMarkupOnNewCost(it: SpecItem, oldCost: number, newCost: number): Pick<SpecItem, "price" | "extSellOverride"> {
  const ext = it.extSellOverride;
  if (ext != null && Number.isFinite(ext) && ext > 0) {
    const qty = it.qty;
    if (!(qty > 0) || !(oldCost > 0)) return { price: it.price, extSellOverride: ext };
    const k = (ext - oldCost * qty) / (oldCost * qty);
    if (!Number.isFinite(k)) return { price: it.price, extSellOverride: ext };
    return { price: it.price, extSellOverride: round2(sellAt(newCost * qty, k)) };
  }
  const k = lineMarkupOf(oldCost, it.price);
  return k != null ? { price: round2(sellAt(newCost, k)), extSellOverride: ext } : { price: it.price, extSellOverride: ext };
}
```

In `copySectionForTarget`, `validMargin` becomes `usableTierMarkup` and `seedMarginOf` becomes `seedMarkupOf`.

- [ ] **Step 8: `track-bom.ts:92,115`**

```ts
  const k = seedMarkupOf(tierMargin);
  …
  const price = errors.length ? 0 : round2(sellAt(costed, k) + listed);
```

- [ ] **Step 9: `use-estimator-state.ts`**

```ts
// freshLabor (≈202)
  margin: String(Math.round(seedMarkupOf(tierMargin) * 100)),
// setMarginAll / setSystemMargin (≈1881) → setMarkupAll / setSystemMarkup, each:
    const k = parseInt(v, 10) / 100;   // (setSystemMarkup: parseFloat)
    … repriceAtMarkup(it.cost, k)
// addCustomPart (≈2913, 2925)
    const markup = seedMarkupOf(tierMargin);
    … ? round2(sellAt(cost, markup))
// vendor add (≈3110, 3205)
    const seedMarkup = seedMarkupOf(tierMargin);
    … price: round2(sellAt(total, seedMarkup)),
// vendor edit (≈3185)
              price: repricedAtLineMarkup(it.cost, it.price, total, seedMarkup),
// vendorFormMargin (≈3496) → vendorFormMarkup
    const seed = seedMarkupOf(tierMargin);
    …
    const k = line ? lineMarkupOf(line.cost, line.price) : null;
    return k != null ? k : seed;
```

The returned keys `setMarginAll`, `setSystemMargin` and `vendorFormMargin` follow the rename. Fix every consumer tsc flags (`build-step.tsx`, `section-card.tsx` prop `onSetMargin` → `onSetMarkup`, `vendor-quote-modal.tsx` prop `margin` → `markup`).

- [ ] **Step 10: The screens that read the renamed math** (math only; the labels change in Task 9):
  - `vendor-quote-modal.tsx:198`: `const sell = total > 0 ? round2(sellAt(total, markup)) : total;`. Line 394 becomes `"Sell at " + Math.round(markup * 100) + "%"`.
  - `catalog-picker.tsx:157`: `const markup = h.cost > 0 && h.list > 0 ? (h.list - h.cost) / h.cost : 0;`. Lines 203–204 become `markupColor(markup)` and `{Math.round(markup * 100)}%`.
  - `section-card.tsx`:
    - line 351: `const sysMarkup = Math.round(systemMarkup(sec) * 100);`
    - line 1093: `const lineMarkup = it.qty * it.cost > 0 ? (ext - it.qty * it.cost) / (it.qty * it.cost) : 0;`
    - line 362: `const cdMarkup = cdCost > 0 ? (cdPrice - cdCost) / cdCost : 0;`
    - `marginColor` becomes `markupColor`, and each `sysMargin` / `lineMargin` / `cdMargin` reference is renamed.
  - `steps/build-step.tsx`, `estimator-header.tsx`, `review-cost-summary.tsx`: `t.margin` / `totals.margin` become `.markup`, and `systemMargin` becomes `systemMarkup`.

- [ ] **Step 11: `src/lib/pricing-tiers.ts`, the names**

```ts
export type ResolvedTier = {
  tier: PricingTier;
  /** Markup fraction (0.43 = 43 %), #367. */
  markup: number;
  source: "contact" | "company" | "default";
};
export async function tierMarkup(tier: PricingTier): Promise<number> {
  return frac(`tiers.${tier}`, TIER_DEFAULTS[tier]);
}
export function serviceMarkupFor(tier: ResolvedTier, serviceDefault: number): number {
  return tier.source === "default" ? serviceDefault : tier.markup;
}
```

Then:
- In `resolveTier`, `builderTiers` and `BuilderTier`, rename `margin` to `markup`, `tierMargin(` to `tierMarkup(` and `marginFor`/`marginCache` to `markupFor`/`markupCache`.
- `tierMarginByCompany` becomes `tierMarkupByCompany`.
- Update the header comment: "defaults: base 43 · copper 37 · silver 28 · gold 25 · platinum 18 · reseller 11 · employee 5 (percent, markup on cost: sell = cost × (1 + k))".
- **Leave the `TIER_DEFAULTS` values alone in this task** (Task 7 changes them).
- Run `npx tsc --noEmit` and fix every consumer mechanically (`tier.margin` → `tier.markup`, `r.margin` → `r.markup` on a `ResolvedTier`, `serviceMarginFor` → `serviceMarkupFor`). Consumers whose *formulas* belong to Tasks 4–5 get the property rename only.

- [ ] **Step 12: The other Estimator-seeded paths.**
  - `src/lib/narrative/load-system.ts:37`: `targetTierMargin: usableTierMarkup(targetTierMargin) ?? TIER_FALLBACK_MARKUP,`.
  - `library-actions.ts`, `system-categories.ts:264` and `assist/features/suggestion.ts:162-175` call `ctx.price(cost, list, tierMargin)`, which is `catalogAddPrice`. Rename imports only.

- [ ] **Step 13: Rewrite the tests that call these functions.** Search with `grep -nE "lineMarginOf|repriceAtMargin|repricedAtLineMargin|systemMargin|seedMarginOf|laborSeedMarginOf|TIER_FALLBACK_MARGIN|CUSTOM_PART_MARGIN|usableTierMargin|tierSeedMarginFor|syncLaborDraftMargins|catalogAddPrice|customPartSell|repriceForTier|isAtTierSeed|marginColor|\.margin\b" scripts/*.ts`. Apply one rule: **a margin input becomes `mk(x)` and the expected dollars don't change.** Define once near the top of each file that needs it:

```ts
import { marginToMarkup as mk } from "../src/lib/markup";
```

Examples:
- `catalogAddPrice(100, 0, 0.4) === 166.67` becomes `catalogAddPrice(100, 0, mk(0.4)) === 166.67`.
- `lineMarginOf(60, 100) === 0.4` becomes `near(lineMarkupOf(60, 100), 40 / 60)`.
- `customPartSell(100) === 153.85` becomes `customPartSell(100) === 154` (constant rounding, spec §5.3).
- A message saying "margin" says "markup".
- Source-text pins that assert a pricing string (e.g. `/\/ \(1 - margin\)/`) are rewritten to assert the new form (`sellAt(`).

Add these new checks to `markupPureChecks` in `scripts/test-markup.ts`:

```ts
  // Task 3 — legacy twin keeps old lines at the seed after the 43 % rounding.
  const old = { cost: 100, price: 142.86, labor: false } as never;
  ok(isAtTierSeed(old, 0.43) && isAtTierSeed(old, 0.3 / 0.7) && !isAtTierSeed({ cost: 100, price: 150, labor: false } as never, 0.43),
    "markup: a line priced at the old 30 % margin is still 'at the seed' for a 43 % stamp (legacy twin)");
  ok(customPartSell(100) === 154 && catalogAddPrice(100, 0, null) === 143 && catalogAddPrice(0, 75, 0.25) === 75,
    "markup: custom part 54 %, no-stamp fallback 43 %, list-only part keeps its list");
```

(Import `isAtTierSeed`, `customPartSell`, `catalogAddPrice` from `../src/app/(app)/estimator/tier-reprice`.)

- [ ] **Step 14: Run the gate**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "FAIL|PASSED" | head -60`
Expected: tsc is clean; every rewritten check passes. Follow the test state policy for any red check.

- [ ] **Step 15: Commit**

```bash
git add -A src scripts
git commit -m "feat(markup): #367 Estimator engine and tier names price on markup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The service engines

**Files:**
- Modify: `src/lib/service-pricing.ts`, `src/lib/flametest-engine.ts`, `src/lib/repair-engine.ts`, `src/lib/inspection-engine.ts`, `src/lib/travel-plan.ts`, `src/lib/tier-seed.ts`, `src/lib/renewal-outreach.ts`, `src/lib/portal-service-pricing.ts`, `src/components/service-total-field.tsx`, `src/components/tier-seed-prompt.tsx`, the three `src/app/(app)/{flame-tests,repairs,inspections}/quote/{actions.ts,controls.tsx,page.tsx}`, and the three `…/letter/letter-view.tsx`.
- Test: `scripts/test-review-and-spec.ts` (#208, #217, #254, #275 and D457 clusters), `scripts/test-markup.ts`.

**Interfaces:**
- Consumes: `sellAt`, `fmtMarkupPct`, `sameWholeMarkup`, `MARKUP_MAX` (Task 1), `serviceMarkupFor` (Task 3).
- Produces: `sellAtMarkup`, `FinishedPrice.effectiveMarkup`, repair `serviceMarkup`, `fmtPct`, `sliderPct`, `LOW_MARKUP_WARN = 0.11`, `MARKUP_SLIDER_MIN = 10`, `MARKUP_SLIDER_MAX = 100`, `travelLineAmount(flightTotal, markup)`, `knobPctFrom`, `validMarkup`.

- [ ] **Step 1: `service-pricing.ts`, the constants and helpers**

```ts
import { sellAt } from "@/lib/markup";

/** A typed total under this markup (or under cost) warns — it never blocks. #367: 10 % margin → 11 % markup. */
export const LOW_MARKUP_WARN = 0.11;
export const MARKUP_SLIDER_MIN = 10;
export const MARKUP_SLIDER_MAX = 100;

/** cost × (1 + markup) when markup > 0, else cost. */
export function sellAtMarkup(cost: number, markup: number): number {
  return Number.isFinite(markup) && markup > 0 ? sellAt(cost, markup) : cost;
}
```

In `FinishedPrice`, `effectiveMargin` becomes `effectiveMarkup` with the doc comment "(total − cost) ÷ cost (0 when cost is 0)". In `finishPrice`:

```ts
    effectiveMarkup: cost > 0 ? (total - cost) / cost : 0,
```

Update the module header (lines 15–17) to "markup amount = total − cost; the effective markup = (total − cost) ÷ cost".

- [ ] **Step 2: `service-pricing.ts`, the finishes.** Rename the `margin` parameter to `markup` in `liftFinish`, `printedLift`, `finishFlame`, `finishInspection` and `finishRepair` (the input objects' field stays `margin`, because it's `rates.margin`). Replace every `sellAtMargin(` with `sellAtMarkup(`. In `finishRepair`, replace lines 397–409 with:

```ts
  // #217 fix wave 2 / #367: the service-only markup, (serviceSell − serviceCost) ÷ serviceCost; an overridden or
  // zero service sell reports the whole-job effectiveMarkup instead.
  const serviceMarkup =
    fin.overridden || serviceSell <= 0 || !(i.serviceCost > 0) ? fin.effectiveMarkup : (serviceSell - i.serviceCost) / i.serviceCost;
```

Return `serviceMarkup` where it returned `serviceMargin`.

- [ ] **Step 3: `service-pricing.ts`, the display and warnings**

```ts
/** A markup fraction as a percent with one decimal: 0.428571 → "42.9". */
export function fmtPct(markup: number): string {
  const v = Math.round((Number.isFinite(markup) ? markup : 0) * 1000) / 10;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** The builder's 10–100 slider position for a (back-solved) markup. */
export function sliderPct(markup: number): number {
  const pts = Math.round(markup * 100);
  if (!Number.isFinite(pts)) return MARKUP_SLIDER_MIN;
  return Math.max(MARKUP_SLIDER_MIN, Math.min(MARKUP_SLIDER_MAX, pts));
}

export type PriceWarning = {
  kind: "below-cost" | "low-markup" | "below parts price";
  text: string;
} | null;
// typedPriceWarning(total, cost, markup, partsSell): the third branch becomes
  if (markup < LOW_MARKUP_WARN)
    return {
      kind: "low-markup",
      text: `Low markup — ${fmtPct(markup)}% at this total, under ${Math.round(LOW_MARKUP_WARN * 100)}%.`,
    };
// travelLineShare legacy branch
      : Math.round(sellAtMarkup(flight, i.margin ?? 0));
```

- [ ] **Step 4: The engines.** In `flametest-engine.ts`, `inspection-engine.ts` and `repair-engine.ts`:
  - The rate field `margin` (and repair `partsMargin`) keeps its name. Change its comment to "markup on cost (0.43 = 43 %)".
  - Update the header formulas from `÷ (1 − margin)` to `× (1 + markup)`.
  - Rename the result fields `effectiveMargin` → `effectiveMarkup` and `serviceMargin` → `serviceMarkup` (repair-engine lines 263–266 and 352–354).

- [ ] **Step 5: `travel-plan.ts:288-290`**

```ts
/** The printed travel line at the quote's markup — flight × (1 + markup), whole dollars. */
export function travelLineAmount(flightTotal: number, markup: number): number {
  return Number.isFinite(markup) && markup > 0 ? Math.round(sellAt(flightTotal, markup)) : Math.round(flightTotal);
}
```

- [ ] **Step 6: The service save actions (×3).** In each `src/app/(app)/{flame-tests,repairs,inspections}/quote/actions.ts`:

```ts
  const markupPts = Number(formData.get("markup"));
  const serviceMarkup = serviceMarkupFor(tier, baseRates.margin);
  const quoteMarkup = Number.isFinite(markupPts)
    ? Math.max(5, Math.min(100, markupPts)) / 100
    : serviceMarkup;
  const rates = { ...baseRates, margin: quoteMarkup };
```

The stored fields become `margin: r.effectiveMarkup` (repairs: `margin: r.serviceMarkup`) and `tierMargin: serviceMarkup`. Update the "5–50 clamp" comments to "5–100".

- [ ] **Step 7: `tier-seed.ts`**

```ts
import { MARKUP_MAX, fmtMarkupPct } from "@/lib/markup";

const validMarkup = (k: number | null | undefined): k is number =>
  typeof k === "number" && Number.isFinite(k) && k > 0 && k <= MARKUP_MAX;

/** A markup fraction as knob points — EXACT (#367): a saved quote at 42.857 reopens there, so a save that never
 *  touched the knob can't move its $25-rounded total. Null when it isn't a usable markup. */
export function knobPctFrom(k: number | null | undefined): number | null {
  return validMarkup(k) ? k * 100 : null;
}
```

In `seedFor`, use `knobPctFrom(ct.tierMargin)!` / `knobPctFrom(customer.tierMargin)!` (inside the `validMarkup` guards) and `knobPctFrom(serviceDefault) ?? 0`. In `initialTierSeed`, rename `savedMarginPts` → `savedMarkupPts` and `stampedTierMargin` → `stampedTierMarkup`. In `tierPromptText`:

```ts
    text: `Kept your ${fmtMarkupPct(p.keptPts / 100)} markup — ${who} ${fmtMarkupPct(p.seed.pts / 100)}`,
    action: p.seed.label ? `Use ${p.seed.label}` : `Use ${fmtMarkupPct(p.seed.pts / 100)}`,
```

- [ ] **Step 8: The builder controls (×3)** (math only; labels change in Task 9):
  - Rename `marginPts`/`setMarginPts` to `markupPts`/`setMarkupPts`.
  - `fd.set("margin", …)` becomes `fd.set("markup", String(markupPts))`.
  - `rates.margin: markupPts / 100`.
  - `sliderPts(r.effectiveMargin)` becomes `sliderPct(r.effectiveMarkup)`, and `fmtPts` becomes `fmtPct`.
  - The range input uses `min={MARKUP_SLIDER_MIN} max={MARKUP_SLIDER_MAX}`.
  - `margin={r?.effectiveMargin ?? 0}` becomes `margin={r?.effectiveMarkup ?? 0}`.
  - The page files' `knobPtsFrom` calls become `knobPctFrom`, and their props are renamed to match Step 7.
  - In `repairs/quote/controls.tsx:677`, `partsPts` becomes `Math.round(baseRates.partsMargin * 100)` (unchanged math; the value is markup now).

- [ ] **Step 9: Renewals and letters.**
  - `renewal-outreach.ts:280` and `:661`: replace `old.margin != null && old.margin !== cur.margin` with:

```ts
    if (old.margin != null && !sameWholeMarkup(old.margin, cur.margin)) generic = true;
```

  - Lines 524/557/916/948 already pass `ft.rates.margin`, which is markup after Task 7. Rename the local `margin` variables to `markup`.
  - The three `letter-view.tsx` files rename `travelMargin` to `travelMarkup`; the call sites are unchanged.
  - `portal-service-pricing.ts:218-219, 278-279`: rename to `serviceMarkupFor`. The result fields `margin`/`tierMargin` keep their names (persisted).
  - `service-total-field.tsx`: the prop that carries the markup is renamed `markup`.

- [ ] **Step 10: Rewrite the tests.** Same rule as Task 3, Step 13. Service rate fixtures `margin: 0.3` become `margin: mk(0.3)` (and `partsMargin`), and the expected dollars stay. `near(fd.totalRaw, 575 / (1 - 0.3))` stays as written. Rename `effectiveMargin`/`serviceMargin` reads. `"low-margin"` becomes `"low-markup"`, and the warning text expectations become `Low markup — 9.1% at this total, under 11%.` (match whatever the fixture yields). Add to `markupPureChecks`:

```ts
  ok(typedPriceWarning(1090, 1000, 0.09)?.kind === "low-markup" && typedPriceWarning(1200, 1000, 0.2) === null,
    "markup: a typed service total under 11 % markup warns");
  ok(sliderPct(0.428571) === 43 && sliderPct(2) === 100 && sliderPct(0.01) === 10, "markup: service slider clamps 10–100");
  ok(knobPctFrom(0.3 / 0.7) === (0.3 / 0.7) * 100 && knobPctFrom(0) === null, "markup: the knob keeps a saved quote's exact points");
```

- [ ] **Step 11: Gate and commit**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "FAIL|PASSED" | head -60` (test state policy applies)

```bash
git add -A src scripts
git commit -m "feat(markup): #367 service engines price on markup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Curtains, the Grid, Quick Design and the portal

**Files:**
- Curtains: `src/lib/curtain-pricing.ts`, `src/lib/design/curtain-pricing.ts`, `src/lib/design/grid-curtains.ts`.
- Grid:
  - `src/lib/tier-pricing.ts`.
  - `src/lib/design/`: `grid-quote.ts`, `grid-bom.ts`, `grid-custom-items.ts`, `equipment-map.ts`, `equipment-map-view.ts`, `grid-virtual-parts.ts`, `equipment-pricing.ts`, `auto-estimate.ts`.
  - `src/lib/stores/equipment-map.ts`.
  - `src/app/(app)/design/grid/[id]/actions.ts` and `page.tsx`.
- Quick Design: `src/app/(app)/design/quick/engine.ts`.
- Portal: `src/lib/portal-price-rules.ts`, `src/lib/portal-pricing.ts`, `src/lib/portal-part-detail.ts`.
- Test: `scripts/test-review-and-spec.ts`, `scripts/test-oct15-batch4.ts`, `scripts/test-review-regressions.ts`, `scripts/test-markup.ts`.

**Interfaces:**
- Consumes: `sellAt`, `costFromSell`, `DEFAULT_MARKUP`, `MARKUP_MAX` (Task 1), and `ResolvedTier.markup` (Task 3).
- Produces: `CURTAIN_MARKUP`, `curtainPrice(costEach, markup)`, `curtainCost(spec, rates, markup)`, `fabricSellPerSqft(rates, markup)`, `sellFromCost(cost, markup)`, `isTierPriced(cost, markup)`, `bomTotals().markup`, `PriceRuleOpts.markup`.

- [ ] **Step 1: `src/lib/curtain-pricing.ts`**

```ts
import { DEFAULT_MARKUP, MARKUP_MAX, sellAt } from "@/lib/markup";

/** #367: Peak's flat curtain markup (the old 30 % margin, rounded). */
export const CURTAIN_MARKUP = DEFAULT_MARKUP;
const usable = (k: number) => (Number.isFinite(k) && k > 0 && k <= MARKUP_MAX ? k : CURTAIN_MARKUP);

export function curtainCost(d: CurtainSpec, rates: CurtainRates, markup: number = CURTAIN_MARKUP): { costEach: number; priceEach: number } {
  // …unchanged down to rawCost…
  const costEach = round2(rawCost);
  const priceEach = rawCost > 0 ? round2(sellAt(rawCost, usable(markup))) : 0; // price from RAW cost, not rounded cost
  return { costEach, priceEach };
}

export function fabricSellPerSqft(rates: CurtainRates, markup: number = CURTAIN_MARKUP): number {
  return sellAt(sewnAreaRate(rates.fabricRate, rates.sewingPct), usable(markup));
}
```

- [ ] **Step 2: `src/lib/design/curtain-pricing.ts:77-78, 141-145`**

```ts
/** Peak's flat curtain markup (#367: was 30 % margin). */
export const CURTAIN_MARKUP = DEFAULT_MARKUP;

/** price = cost × (1 + markup). */
export function curtainPrice(costEach: number, markup: number = CURTAIN_MARKUP): number {
  const k = Number.isFinite(markup) && markup > 0 && markup <= MARKUP_MAX ? markup : CURTAIN_MARKUP;
  return costEach > 0 ? round2(sellAt(costEach, k)) : 0;
}
```

In `grid-curtains.ts`, rename `margin` to `markup` in `priceGridCurtains` and `curtainSell`. Fix every `CURTAIN_MARGIN` importer tsc flags.

- [ ] **Step 3: `src/lib/tier-pricing.ts`**

```ts
/** … a markup that is a finite number above 0 (#367; was a margin inside (0, 1)). */
export function isTierPriced(cost: number, markup: number): boolean {
  return typeof cost === "number" && cost > 0 && Number.isFinite(markup) && markup > 0;
}
```

- [ ] **Step 4: `src/lib/design/grid-quote.ts`**

```ts
import { DEFAULT_MARKUP, MARKUP_MAX, costFromSell, sellAt } from "@/lib/markup";

/** Labor's markup when the tier markup is unusable (negative or ≥ MARKUP_MAX) — #367: the old 30 % margin, rounded. */
const LABOR_FALLBACK_MARKUP = DEFAULT_MARKUP;
// 225 and 253
    list: isTierPriced(p.cost, tier.markup) ? Math.round(sellAt(p.cost, tier.markup) * 100) / 100 : p.list,
    conduitParts.set(p.id, { desc: p.desc, unit: p.unit, cost: p.cost, list: tiered ? Math.round(sellAt(p.cost, tier.markup) * 100) / 100 : p.list });
// 290, 299
  const curtainPrices = priceGridCurtains(placements, catalog, { sewingPct }, tier.markup);
  const custom = customItemBomLines(customItems, tier.markup);
// 342-344
  const laborMarkup = tier.markup >= 0 && tier.markup < MARKUP_MAX ? tier.markup : LABOR_FALLBACK_MARKUP;
  …cost: Math.round(costFromSell(l.amount, laborMarkup) * 100) / 100 }));
// 358
  const markup = cost > 0 ? (value - cost) / cost : 0;
```

Wherever the function used the old `margin` variable, use `markup`. The quote partial it builds keeps the persisted field: `margin: markup`. Update the comments at 187 and 297 to "× (1 + the customer's tier markup)".

- [ ] **Step 5: The Grid helpers**
  - `grid-bom.ts:546-562`: the return becomes `{ value: number; cost: number; markup: number }` with `markup: cost > 0 ? (value - cost) / cost : 0`. Fix consumers.
  - `grid-custom-items.ts:131-132`: `customItemBomLines(items, markup)` uses `sellFromCost(it.unitCost, markup)`, and the comment becomes "sell = cost × (1 + markup)".
  - `equipment-map.ts:222-226`:

```ts
/** cost × (1 + markup), cents-rounded. The markup is a rate (catalog_rates), never a dollar. */
export function sellFromCost(cost: number, markup: number): number {
  const k = markup >= 0 && markup < MARKUP_MAX ? markup : DEFAULT_MARKUP;
  return round2(sellAt(cost, k));
}
```

  - `EquipmentPriceTable.margin` and `EquipPriceCtx.margin` become `.markup`. Update `equipment-map-view.ts:155`, `grid-virtual-parts.ts:103,130`, `equipment-pricing.ts:50-76`, `auto-estimate.ts:241-261`, `stores/equipment-map.ts:89` (`markup: rates.defaultMargin`), `design/grid/[id]/actions.ts:274-295` (`const k = rates.defaultMargin;`), and `design/grid/[id]/page.tsx:294,302` (`fabricSellPerSqft(…, tier.markup)`).

- [ ] **Step 6: Quick Design, `src/app/(app)/design/quick/engine.ts`**:
  - Line 103: the result type field `margin` becomes `markup`.
  - Line 740: `markup: matCost > 0 ? (matRev - matCost) / matCost : 0,`.
  - In `src/lib/stores/designs.ts`, the promotion partial keeps `margin:` (persisted) and assigns the engine's `markup`.
  - `quick/page.tsx:68`: the comment changes to "cost × (1 + markup)".

- [ ] **Step 7: The portal**

```ts
// src/lib/portal-price-rules.ts
export type PriceRuleOpts = { markup: number; staleCostMonths: number; now: number };
…
  const k = Number.isFinite(o.markup) && o.markup > 0 ? o.markup : 0;
  return { unitPrice: cost ? cents(sellAt(cost, k)) : cents(list), por: false };
```

In `portal-pricing.ts`:
- The ctx `margin` becomes `markup` at lines 36/50/94/334.
- Keep the persisted `tierMargin: t.markup` field name at 38/52.
- `curtainPrice(cc.costEach, ctx.markup)`.

In `portal-part-detail.ts:51`: `{ markup: ctx.markup, … }`.

- [ ] **Step 8: Rewrite the tests.** Same rule as before: margin inputs become `mk(x)` and the dollars stay. `scripts/test-oct15-batch4.ts:43` becomes `{ markup: mk(0.3), … }`, and `scripts/test-review-regressions.ts:4185-4198` asserts a list-less fixture sells at `cost × (1 + mk(m))`. Add to `markupPureChecks`:

```ts
  ok(sellFromCost(100, 0.43) === 143 && sellFromCost(100, 25) === 143 && curtainPrice(100, 0.25) === 125,
    "markup: sellFromCost guard falls back to 43 %; curtains price at their markup");
  ok(unitPriceFor({ cost: 100, list: 0 }, { markup: 0.25, staleCostMonths: 0, now: 0 }).unitPrice === 125, "markup: portal unit price");
```

- [ ] **Step 9: Gate and commit** (test state policy applies)

```bash
git add -A src scripts
git commit -m "feat(markup): #367 curtains, Grid, Quick Design and portal price on markup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dashboard and report math

**Files:**
- Modify: `src/lib/dashboard/metrics.ts`, `src/app/(app)/_dashboard/widgets/backward.tsx`, `src/app/(app)/_dashboard/widgets/installs.tsx`, `src/lib/dashboard/registry.ts`, `src/lib/estimate-bonus/rules.ts` (comments), `src/lib/fixture-rates.ts` / `stores/pricing.ts` help text for `customCostFactor`.
- Test: `scripts/test-review-and-spec.ts` (dashboard clusters), `scripts/test-markup.ts`.

**Interfaces:**
- Produces: `QuoteMetrics.avgMarkup` (value-weighted on cost), `projectedProfit(): { value, profit, markup, unknownCount }`, the forecast `blended` (now markup).

- [ ] **Step 1: `metrics.ts:69-87`.** Each quote's profit is `value × k ÷ (1 + k)` and its cost is `value ÷ (1 + k)`:

```ts
  /** cost-weighted quote markup over quotes created in [a, b): Σ profit ÷ Σ cost (#367). */
  avgMarkup: number;
…
  const profitOf = (v: number, k: number) => (v * k) / (1 + k);
  const profit = created.reduce((s, q) => s + profitOf(q.value || 0, q.margin || 0), 0);
  const costSum = created.reduce((s, q) => s + (q.value || 0) - profitOf(q.value || 0, q.margin || 0), 0);
…
    avgMarkup: costSum > 0 ? profit / costSum : 0,
```

- [ ] **Step 2: `metrics.ts:104-112`**

```ts
export function projectedProfit(projects: ProjectRecord[]): { value: number; profit: number; markup: number; unknownCount: number } {
  …
  const profit = book.reduce((s, p) => s + (knownValue(p) * (p.margin || 0)) / (1 + (p.margin || 0)), 0);
  return { value, profit, markup: value - profit > 0 ? profit / (value - profit) : 0, unknownCount: unknownCount(book) };
}
```

- [ ] **Step 3: `metrics.ts:213-214`**

```ts
  const cost = Math.round(book.reduce((a, p) => a + knownValue(p) / (1 + (p.margin || 0)), 0));
  const blended = cost > 0 ? (totalValue - cost) / cost : 0;
```

Keep the field name `blended`; it now holds markup.

- [ ] **Step 4: The widgets.**
  - `backward.tsx:45`: `cur.avgMargin` becomes `cur.avgMarkup`, and the "pt vs. prior" delta now compares markups.
  - `backward.tsx:50`: `pp.margin` becomes `pp.markup`.
  - `installs.tsx` reads `f.blended` (now markup).
  - The labels change in Task 9.

- [ ] **Step 5: Comment-only updates.**
  - `estimate-bonus/rules.ts:53-55` already multiplies by `sell / cost` (a markup ratio). Change "blended margin" to "blended markup" in the comments and in `stores/pricing.ts`'s bonus help text.
  - The `fixture.customCostFactor` help gets "(0.66 ≈ 52 % markup)".

- [ ] **Step 6: Tests.** Rewrite the dashboard checks that assert `avgMargin` / `projectedProfit().margin` with margin inputs: inputs become `mk(x)`, and the expected profit dollars stay. For example, value 1000 at margin 0.3 still gives profit 300: with `mk(0.3)`, `1000 × 0.428571 ÷ 1.428571 = 300`. Add:

```ts
  ok(Math.abs(projectedProfit([{ value: 1000, margin: 0.25, status: "active" } as never]).profit - 200) < 1e-9,
    "markup: projected profit = value × k ÷ (1 + k)");
```

Check `isDone` in `metrics.ts` and use a status it counts as open.

- [ ] **Step 7: Gate and commit** (test state policy applies)

```bash
git add -A src scripts
git commit -m "feat(markup): #367 dashboard profit and averages on markup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wiring — saved docs, settings, defaults

From this task on, `test:specs` must be fully green.

**Files:**
- Create: `src/lib/markup/doc-basis.ts`, `src/lib/markup/settings.ts`
- Modify: `src/db/doc-store.ts`, `src/lib/stores/quotes.ts`, `src/lib/stores/projects.ts`, `src/lib/stores/pricing.ts`, `src/lib/pricing-tiers.ts`, `src/app/api/sync/push/route.ts`, `src/db/seeds/quotes.ts`, `src/db/seeds/projects.ts`
- Test: `scripts/test-markup.ts` (`markupDbChecks`), plus every DB check the test state policy listed.

**Interfaces:**
- Consumes: `marginToMarkup`, `markupPctString`, `roundMarkupPct`, `PRICING_BASIS` (Task 1).
- Produces: `BASIS_KEY = "pricingBasis"`, `convertQuoteDoc(doc)`, `convertProjectDoc(doc)`, `hydrateDoc(coll, doc)`, `BASIS_STAMP = "_pricingBasis"`, `MARGIN_BACKUP = "_marginBackup"`, `markupSettingsPatch(current, keys, pct)`, `withoutBasisKeys(blob)`, `ensureMarkupSettings()`.

- [ ] **Step 1: Write the failing pure checks** (append to `markupPureChecks`):

```ts
  // Task 7 — doc conversion
  const legacy = {
    id: "Q-1", margin: 0.3, tierMargin: 0.2, value: 1000,
    spec: { sections: [{ id: "s", items: [{ id: 1, cost: 70, price: 100 }], laborGroups: { g1: { lines: 1, draft: { margin: "30" } } } }] },
    flameTest: { rates: { margin: 0.3 }, total: 825 },
    repair: { rates: { margin: 0.3, partsMargin: 0.25 }, partsMargin: 0.25, total: 875 },
    revisions: [{ rev: 1, margin: 0.3, tierMargin: 0.3, value: 900, flameTest: { rates: { margin: 0.3 } } }],
  };
  const q = convertQuoteDoc(legacy) as typeof legacy & { pricingBasis: string };
  ok(q.pricingBasis === "markup" && near(q.margin, 0.3 / 0.7) && near(q.tierMargin, 0.25), "markup: a legacy quote converts margin + tierMargin exactly and is stamped");
  ok(q.spec.sections[0].laborGroups.g1.draft.margin === "42.8571" && near(q.flameTest.rates.margin, 0.3 / 0.7) && near(q.repair.rates.partsMargin, 1 / 3) && near(q.repair.partsMargin, 1 / 3),
    "markup: labor drafts, service rates and repair parts markup convert");
  ok(near(q.revisions[0].margin, 0.3 / 0.7) && near(q.revisions[0].flameTest.rates.margin, 0.3 / 0.7), "markup: frozen revisions convert too");
  ok(q.value === 1000 && q.spec.sections[0].items[0].price === 100 && q.flameTest.total === 825 && q.revisions[0].value === 900, "markup: no sell amount moves");
  ok(legacy.margin === 0.3, "markup: conversion never mutates its input");
  ok(convertQuoteDoc(q) === q, "markup: a stamped doc is returned as-is (never converted twice)");
  ok(near((convertProjectDoc({ id: "P-1", margin: 0.36 }) as { margin: number }).margin, 0.36 / 0.64), "markup: a legacy project converts its margin");
  ok(hydrateDoc("leads", { id: "L-1", margin: 0.3 }).margin === 0.3, "markup: other collections are untouched");
  const inPlace = { id: "Q-2", margin: 0.2 };
  ok(hydrateDoc("quotes", inPlace) === inPlace && near(inPlace.margin, 0.25), "markup: the doc-store hook converts in place (no per-read clone)");
  // Task 7 — settings conversion
  const p1 = markupSettingsPatch({ "tiers.base": 30, "tiers.gold": 20, "system.freightPct": 5 }, ["tiers.base", "tiers.gold", "tiers.copper"], true);
  ok(!!p1 && p1["tiers.base"] === 43 && p1["tiers.gold"] === 25 && !("tiers.copper" in p1) && !("system.freightPct" in p1) && p1._pricingBasis === "markup",
    "markup: a whole-percent rules blob converts and rounds only the stored margin keys");
  ok(JSON.stringify((p1 as Record<string, unknown>)._marginBackup) === JSON.stringify({ "tiers.base": 30, "tiers.gold": 20 }), "markup: the old values are kept as a backup");
  const p2 = markupSettingsPatch({ margin: 0.3, partsMargin: 0.27, laborRate: 75 }, ["margin", "partsMargin"], false);
  ok(!!p2 && p2.margin === 0.43 && p2.partsMargin === 0.37 && !("laborRate" in p2), "markup: a fraction blob converts and rounds");
  ok(markupSettingsPatch({ _pricingBasis: "markup", margin: 0.43 }, ["margin"], false) === null, "markup: a stamped blob is left alone");
  const p3 = markupSettingsPatch({}, ["margin"], false);
  ok(!!p3 && Object.keys(p3).join() === "_pricingBasis", "markup: an empty blob still gets the stamp (so a later admin edit is never re-converted)");
  ok(JSON.stringify(withoutBasisKeys({ margin: 0.43, _pricingBasis: "markup", _marginBackup: { margin: 0.3 } })) === JSON.stringify({ margin: 0.43 }), "markup: getters strip the stamp + backup");
```

(Import `convertQuoteDoc`, `convertProjectDoc`, `hydrateDoc` from `../src/lib/markup/doc-basis`, and `markupSettingsPatch`, `withoutBasisKeys` from `../src/lib/markup/settings`.)

Run: `npx tsx scripts/test-markup.ts`. Expected: it can't resolve the new modules.

- [ ] **Step 2: Write `src/lib/markup/doc-basis.ts`**

```ts
/**
 * Convert-on-read (#367, spec §5.1): a `quotes` / `projects` doc without the
 * `pricingBasis: "markup"` stamp stores margins. Every stored pricing fraction
 * converts EXACTLY to markup; line prices, totals and values are never touched
 * (no sell amount moves). Pure; used by src/db/doc-store.ts on every read.
 */
import { PRICING_BASIS, marginToMarkup, markupPctString } from "./index";

export const BASIS_KEY = "pricingBasis";
/** The only collections that store pricing percentages (designs compute theirs at promotion). */
export const BASIS_COLLECTIONS: ReadonlySet<string> = new Set(["quotes", "projects"]);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const conv = (o: Rec, key: string) => {
  const v = o[key];
  if (typeof v === "number" && Number.isFinite(v)) o[key] = marginToMarkup(v);
};

function convService(sub: unknown): void {
  if (!isRec(sub)) return;
  if (isRec(sub.rates)) {
    conv(sub.rates, "margin");
    conv(sub.rates, "partsMargin");
  }
  conv(sub, "partsMargin");
}

function convSpec(spec: unknown): void {
  if (!isRec(spec) || !Array.isArray(spec.sections)) return;
  for (const sec of spec.sections) {
    if (!isRec(sec) || !isRec(sec.laborGroups)) continue;
    for (const rec of Object.values(sec.laborGroups)) {
      if (!isRec(rec) || !isRec(rec.draft) || typeof rec.draft.margin !== "string" || !rec.draft.margin.trim()) continue;
      const pct = parseFloat(rec.draft.margin);
      if (Number.isFinite(pct)) rec.draft.margin = markupPctString(marginToMarkup(pct / 100));
    }
  }
}

function convPayload(o: Rec): void {
  conv(o, "margin");
  conv(o, "tierMargin");
  convSpec(o.spec);
  convService(o.flameTest);
  convService(o.repair);
  convService(o.inspection);
}

function quoteInPlace(out: Rec): void {
  convPayload(out);
  if (Array.isArray(out.revisions)) for (const r of out.revisions) if (isRec(r)) convPayload(r);
  out[BASIS_KEY] = PRICING_BASIS;
}

function projectInPlace(out: Rec): void {
  conv(out, "margin");
  out[BASIS_KEY] = PRICING_BASIS;
}

/** Pure: a converted COPY (the input is never touched); a stamped doc comes back as-is. */
export function convertQuoteDoc<T extends Rec>(doc: T): T {
  if (doc[BASIS_KEY] === PRICING_BASIS) return doc;
  const out = structuredClone(doc) as Rec;
  quoteInPlace(out);
  return out as T;
}

export function convertProjectDoc<T extends Rec>(doc: T): T {
  if (doc[BASIS_KEY] === PRICING_BASIS) return doc;
  const out = structuredClone(doc) as Rec;
  projectInPlace(out);
  return out as T;
}

/**
 * The doc store's one read hook. Converts IN PLACE: every row the store hands
 * it is freshly parsed JSON nobody else holds, and a legacy quote that is never
 * re-saved (Daylite history) is converted on every read — cloning thousands of
 * specs per list read would be the slow part, not the arithmetic.
 */
export function hydrateDoc<T extends Rec>(coll: string, doc: T): T {
  if (doc[BASIS_KEY] === PRICING_BASIS) return doc;
  if (coll === "quotes") quoteInPlace(doc);
  else if (coll === "projects") projectInPlace(doc);
  return doc;
}
```

- [ ] **Step 3: Write `src/lib/markup/settings.ts`**

```ts
/** Settings conversion (#367, spec §5.2) — pure. stores/pricing.ts runs it once per blob under a row lock. */
import { PRICING_BASIS, marginToMarkup, roundMarkupPct } from "./index";

export const BASIS_STAMP = "_pricingBasis";
export const MARGIN_BACKUP = "_marginBackup";

/** The patch that converts one stored rate blob (round to a whole %), or null when it is already stamped.
 *  `pct` = the blob stores whole percents (pricing_rules: 30) rather than fractions (0.30). */
export function markupSettingsPatch(current: Record<string, unknown>, keys: readonly string[], pct: boolean): Record<string, unknown> | null {
  if (current[BASIS_STAMP] === PRICING_BASIS) return null;
  const patch: Record<string, unknown> = { [BASIS_STAMP]: PRICING_BASIS };
  const backup: Record<string, number> = {};
  for (const k of keys) {
    const v = current[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    backup[k] = v;
    const r = roundMarkupPct(marginToMarkup(pct ? v / 100 : v));
    patch[k] = pct ? Math.round(r * 100) : r;
  }
  if (Object.keys(backup).length) patch[MARGIN_BACKUP] = backup;
  return patch;
}

/** A rate blob without the stamp and backup keys — what the getters hand to engines (never saved into a quote). */
export function withoutBasisKeys<T extends Record<string, unknown>>(blob: T): T {
  const { [BASIS_STAMP]: _s, [MARGIN_BACKUP]: _b, ...rest } = blob as Record<string, unknown>;
  return rest as T;
}
```

Run: `npx tsx scripts/test-markup.ts`. Expected: `markup pure: ALL PASSED`.

- [ ] **Step 4: Wire `hydrateDoc` into `src/db/doc-store.ts`.** Add `import { BASIS_COLLECTIONS, BASIS_KEY, hydrateDoc } from "@/lib/markup/doc-basis";` and one helper next to `table()`:

```ts
/** #367: every doc read leaves the store through here — an unstamped quote / project converts margin → markup. */
function fromRow<T extends Doc>(coll: CollectionName, doc: unknown, id: string): T {
  return hydrateDoc(coll, { ...(doc as T), id });
}
```

Replace each of the 11 row-mapping sites (lines 64, 73, 189, 263, 283, 310, 348, 363, 411, 466, 848) with `fromRow<T>(coll, r.doc, r.id)` (getDoc: `rows[0].doc, rows[0].id`; getDocRows: `doc: fromRow<T>(coll, r.doc, r.id)`; listSince: `doc: fromRow(coll, r.doc, r.id)`). In `listDocsFiltered`, make sure a projection always carries the stamp:

```ts
  const fields = opts.fields?.length && BASIS_COLLECTIONS.has(coll) && !opts.fields.includes(BASIS_KEY)
    ? [...opts.fields, BASIS_KEY]
    : opts.fields;
```

Use `fields` in place of `opts.fields` in the projection SQL below it. `patchDoc` reads through `getDoc`, so mutators get a converted doc and write it back stamped. **Do not stamp in `upsertDoc` / `insertDocIfAbsent`.** A raw writer's doc is legacy margin until a builder stamps it (Step 5).

- [ ] **Step 5: Builders stamp new docs**
  - `src/lib/stores/quotes.ts`, in `buildQuote` (≈line 917): add `pricingBasis: "markup",` to the built doc. Add `pricingBasis?: "markup";` to `Quote`, with the comment "#367 — present once this doc's percentages are markup (doc-basis.ts)". In `update`, add `delete clean.pricingBasis;` beside the other server-owned keys.
  - `src/lib/stores/projects.ts`: add `pricingBasis: "markup",` in the three builders (≈lines 443, 750, 890) and `pricingBasis?: "markup";` to `ProjectRecord`.
  - `src/app/api/sync/push/route.ts:146`: before `sanitizePushedDoc` for `projects`, run `pushDoc = hydrateDoc(coll, { ...pushDoc, id: rec.id })`. A device's pre-switch cached copy then lands converted and stamped.

- [ ] **Step 6: Settings conversion in `src/lib/stores/pricing.ts`**

```ts
import { updateBlob } from "@/db/doc-store";
import { markupSettingsPatch, withoutBasisKeys } from "@/lib/markup/settings";

/** #367: the margin keys each rate blob held before the markup switch. */
const MARGIN_KEYS: ReadonlyArray<[blob: string, keys: readonly string[], pct: boolean]> = [
  [PRICING_RULES_BLOB, ["tiers.base", "tiers.copper", "tiers.silver", "tiers.gold", "tiers.platinum", "tiers.reseller", "tiers.employee", "system.baseMargin"], true],
  [FLAMETEST_RATES_BLOB, ["margin"], false],
  [REPAIR_RATES_BLOB, ["margin", "partsMargin"], false],
  [INSPECTION_RATES_BLOB, ["margin"], false],
  [CATALOG_RATES_BLOB, ["defaultMargin"], false],
];

let markupReady: Promise<void> | null = null;
/** #367: convert every rate blob from margin to rounded markup ONCE (stamped, under updateBlob's row lock, so
 *  concurrent instances converge); memoized per process, retried after a failure. Every rate read awaits it. */
export function ensureMarkupSettings(): Promise<void> {
  if (!markupReady)
    markupReady = (async () => {
      for (const [blob, keys, pct] of MARGIN_KEYS) await updateBlob(blob, (cur) => markupSettingsPatch(cur, keys, pct));
    })().catch((e) => {
      markupReady = null;
      throw e;
    });
  return markupReady;
}
```

Start every getter and setter (`getFlametestRates`, `setFlametestRates`, … `getFixtureRates`, `engineGet`, `engineSet`, `value`, `setValue`, `resetValue`, `resetAll`, `loadWireLaborRules`, `loadCurtainSewingPct`, `loadBonusRates`) with `await ensureMarkupSettings();`. Wrap each engine getter's result: `return withoutBasisKeys(await getBlob(...))`, and do the same in `engineGet`. Then check: `grep -rn "getBlob(\"\(flametest\|repair\|inspection\|catalog\)_rates\|getBlob(\"pricing_rules\|PRICING_RULES_BLOB\|_RATES_BLOB" src --include='*.ts' | grep -v stores/pricing.ts`. That must print nothing. If it prints a direct reader, route it through the store's getter.

- [ ] **Step 7: Defaults and the registry**
  - `stores/pricing.ts`: `FLAMETEST_RATE_DEFAULTS.margin`, `REPAIR_RATE_DEFAULTS.margin`, `.partsMargin`, `INSPECTION_RATE_DEFAULTS.margin` and `CATALOG_RATE_DEFAULTS.defaultMargin` become `0.43`. Their type comments say "markup on cost (0.43 = 43 %)".
  - Registry rows, `def` and `max`:
    - `system.baseMargin`: 43 / 150.
    - `tiers.*`: 43/37/28/25/18/11/5, max 150.
    - flame `margin`, `repair.partsMargin`, `repair.margin`, `inspection.margin`, `catalog.defaultMargin`: 43 / 150.
  - Labels and formula text change in Task 9.
  - `src/lib/pricing-tiers.ts` `TIER_DEFAULTS`: `{ base: 0.43, copper: 0.37, silver: 0.28, gold: 0.25, platinum: 0.18, reseller: 0.11, employee: 0.05 }`.
  - `src/db/seeds/quotes.ts:122-129` and `src/db/seeds/projects.ts`: wrap each `margin:` value as `marginToMarkup(x)` and add `pricingBasis: "markup"` to each seeded doc.

- [ ] **Step 8: Write `markupDbChecks`** (replace the Task 1 placeholder):

```ts
export async function markupDbChecks(ok: Ok) {
  const { getDb } = await import("../src/db");
  const { DOC_TABLES } = await import("../src/db/doc-tables");
  const { getDoc, patchDoc, listDocsFiltered } = await import("../src/db/doc-store");
  const quotes = await import("../src/lib/stores/quotes");
  const { getFlametestRates, value } = await import("../src/lib/stores/pricing");
  const { resolveTier } = await import("../src/lib/pricing-tiers");
  const db = await getDb();
  const t = DOC_TABLES.quotes;
  const id = "Q-TESTmarkup-1";
  const now = Date.now();
  // A margin-era row written raw (bypassing every store), exactly as production holds it.
  await db.insert(t).values({ id, doc: { id, name: "markup legacy", status: "sent", value: 1000, margin: 0.3, tierMargin: 0.2,
    spec: { sections: [{ id: "s", items: [{ id: 1, cost: 70, price: 100, qty: 10 }] }] } }, rev: 1, updatedAt: now, receivedAt: now, review: { state: "new" }, deleted: false })
    .onConflictDoNothing();
  const read = await quotes.get(id);
  ok(!!read && read.pricingBasis === "markup" && Math.abs(read.margin - 0.3 / 0.7) < 1e-12 && read.value === 1000, "markup db: a raw margin-era quote reads as markup, sell unchanged");
  const raw1 = (await db.select().from(t).where((await import("drizzle-orm")).eq(t.id, id)))[0].doc as Record<string, unknown>;
  ok(raw1.margin === 0.3 && !("pricingBasis" in raw1), "markup db: a read alone writes nothing");
  await patchDoc("quotes", id, (d: Record<string, unknown>) => { d.name = "markup legacy (touched)"; });
  const raw2 = (await db.select().from(t).where((await import("drizzle-orm")).eq(t.id, id)))[0].doc as Record<string, unknown>;
  ok(raw2.pricingBasis === "markup" && Math.abs((raw2.margin as number) - 0.3 / 0.7) < 1e-12 && raw2.value === 1000, "markup db: the next write stores it stamped, converted once");
  const again = await getDoc<Record<string, unknown> & { id: string }>("quotes", id);
  ok(Math.abs((again!.margin as number) - 0.3 / 0.7) < 1e-12, "markup db: a stamped doc is never converted twice");
  const proj = await listDocsFiltered<Record<string, unknown> & { id: string }>("quotes", { fields: ["margin"] });
  ok(proj.some((r) => r.id === id && Math.abs((r.margin as number) - 0.3 / 0.7) < 1e-12), "markup db: a field projection carries the stamp (no double conversion)");
  const fresh = await quotes.create({ name: "markup new", margin: 0.43 });
  ok(fresh.pricingBasis === "markup" && (await quotes.get(fresh.id))!.margin === 0.43, "markup db: a new quote is born stamped");
  const fr = await getFlametestRates();
  ok(fr.margin === 0.43 && !("_pricingBasis" in fr), "markup db: flame default is 43 % markup and the getter strips the stamp");
  ok((await value("tiers.gold")) === 25 && (await resolveTier(null)).markup === 0.43, "markup db: tier defaults are markup");
  await db.delete(t).where((await import("drizzle-orm")).inArray(t.id, [id, fresh.id]));
}
```

Add one more check for an already-converted settings blob. Write `{ margin: 0.3 }` raw into `flametest_rates` before the first read in a **fresh** PGlite datadir, then assert `getFlametestRates().margin === 0.43` and that the blob carries `_marginBackup.margin === 0.3`. The settings memo runs once per process, so put this in a separate script `scripts/test-markup-settings.ts` with its own `npm run test:markup-settings` entry in `package.json`, matching the `test:settings-race` line:

```json
"test:markup-settings": "TEST_DB=$(mktemp -d) && PGLITE_PATH=\"$TEST_DB\" tsx scripts/test-markup-settings.ts; s=$?; rm -rf \"$TEST_DB\"; exit $s",
```

- [ ] **Step 9: Make the whole suite green.** Run `npm run test:specs 2>&1 | grep FAIL`. Every remaining failure is one of three kinds:
  - a DB fixture written raw with margin values and read back: assert the converted value, or stamp the fixture;
  - a check expecting default-rate dollars at 30 % margin: they're now at 43 % markup, so recompute the expected dollars (e.g. `825` may become `825` or `850`) and **say which in the commit message**;
  - a source pin on a string this task changed: update the pin.
  
  Fix every one. Then run `npm run test:markup-settings`.

- [ ] **Step 10: The full gate**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | tail -3 && npm run test:markup-settings && npm run test:smoke 2>&1 | tail -3 && npx next build 2>&1 | tail -5`
Expected: tsc is clean; `ALL PASSED`; smoke `0 FAIL`; the build completes.

- [ ] **Step 11: Commit**

```bash
git add -A src scripts package.json
git commit -m "feat(markup): #367 saved quotes and projects convert on read; settings convert once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The price-parity harness

**Files:**
- Modify: `scripts/test-markup.ts` (add `markupParityChecks`), `scripts/test-review-and-spec.ts` (chain it)

**Interfaces:**
- Consumes: `docs/markup/parity-baseline.json` (Task 2), `scripts/markup-parity-cases.ts`, and every engine under its new name.

- [ ] **Step 1: Write `markupParityChecks`.** It runs every Task 2 case group with each margin input converted, and demands the same outputs to the cent:

```ts
import baseline from "../docs/markup/parity-baseline.json";
import { CASE_COSTS, CASE_MARGINS, CURTAIN_CASES, FLAME_CASES, INSPECTION_CASES, LABOR_DRAFT, REPAIR_CASES, SECTIONS, laborRate } from "./markup-parity-cases";

export async function markupParityChecks(ok: Ok) {
  const B = baseline.cases as Record<string, unknown>;
  const { catalogAddPrice, customPartSell, repriceForTier } = await import("../src/app/(app)/estimator/tier-reprice");
  const { repriceAtMarkup, computeLabor, buildLaborItems, totals, systemMarkup } = await import("../src/app/(app)/estimator/pricing");
  const { compute: flame } = await import("../src/lib/flametest-engine");
  const { computeEstimate: repair } = await import("../src/lib/repair-engine");
  const { computeEstimate: inspection } = await import("../src/lib/inspection-engine");
  const { curtainCost, fabricSellPerSqft } = await import("../src/lib/curtain-pricing");
  const { curtainPrice } = await import("../src/lib/design/curtain-pricing");
  const { sellFromCost } = await import("../src/lib/design/equipment-map");
  const { unitPriceFor } = await import("../src/lib/portal-price-rules");
  const { travelLineAmount } = await import("../src/lib/travel-plan");
  const { printedLift, travelLineShare } = await import("../src/lib/service-pricing");
  const mk = marginToMarkup;
  const cent = (a: unknown, b: unknown) => typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.005 : JSON.stringify(a) === JSON.stringify(b);
  const drift: string[] = [];
  const same = (name: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) return;
    const deep = (x: unknown, y: unknown): boolean => typeof x === "object" && x && typeof y === "object" && y
      ? Object.keys(y as object).every((k) => deep((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k])) : cent(x, y) || (x == null && y == null);
    if (!deep(got, want)) drift.push(`${name}: got ${g} want ${w}`);
  };
  const grid = (f: (c: number, k: number) => unknown) => CASE_COSTS.map((c) => CASE_MARGINS.map((m) => f(c, mk(m))));
  same("catalogAddPrice", grid((c, k) => catalogAddPrice(c, 0, k)), B.catalogAddPrice);
  same("repriceAt", grid((c, k) => repriceAtMarkup(c, k).price), B.repriceAt);
  same("sellFromCost", grid((c, k) => sellFromCost(c, k)), B.sellFromCost);
  same("portalUnit", grid((c, k) => unitPriceFor({ cost: c, list: 0 }, { markup: k, staleCostMonths: 0, now: 0 }).unitPrice), B.portalUnit);
  same("curtainPrice", grid((c, k) => curtainPrice(c, k)), B.curtainPrice);
  same("travelLine", grid((c, k) => travelLineAmount(c * 10, k)), B.travelLine);
  same("travelShareLegacy", grid((c, k) => travelLineShare({ flightTotal: c * 10, total: c * 30, margin: k })), B.travelShareLegacy);
  same("printedLift", CASE_MARGINS.map((m) => printedLift({ lift: { count: 2, rate: 450 } }, mk(m))), B.printedLift);
  same("curtains", CURTAIN_CASES.map((k) => ({ id: k.id, cost: curtainCost(k.spec as never, k.rates, mk(k.margin)), perSqft: fabricSellPerSqft(k.rates, mk(k.margin)) })), B.curtains);
  const svcRates = (r: Record<string, number>) => ({ ...r, margin: mk(r.margin), ...(r.partsMargin != null ? { partsMargin: mk(r.partsMargin) } : {}) });
  const dollars = (r: Record<string, unknown>) => ({ totalRaw: r.totalRaw, autoTotal: r.autoTotal, total: r.total, cost: r.cost, marginAmount: r.marginAmount, partsSell: r.partsSell, liftSell: r.liftSell, liftLine: r.liftLine });
  const wantDollars = (rows: Array<Record<string, unknown>>) => rows.map(({ effectiveMargin: _e, serviceMargin: _s, ...rest }) => rest);
  same("flame", FLAME_CASES.map((k) => ({ id: k.id, ...dollars(flame(k.opts as never, svcRates(k.rates)) as never) })), wantDollars(B.flame as never));
  same("repair", REPAIR_CASES.map((k) => ({ id: k.id, ...dollars(repair(k.opts as never, svcRates(k.rates) as never) as never) })), wantDollars(B.repair as never));
  same("inspection", INSPECTION_CASES.map((k) => ({ id: k.id, ...dollars(inspection(k.opts as never, svcRates(k.rates) as never) as never) })), wantDollars(B.inspection as never));
  for (const [grp, run] of [["flame", (k: (typeof FLAME_CASES)[number]) => flame(k.opts as never, svcRates(k.rates))]] as const) {
    (B[grp] as Array<{ effectiveMargin: number }>).forEach((b, i) => {
      const got = (run(FLAME_CASES[i]) as unknown as { effectiveMarkup: number }).effectiveMarkup;
      if (Math.abs(got - mk(b.effectiveMargin)) > 1e-9) drift.push(`${grp}[${i}] effectiveMarkup ${got} vs ${mk(b.effectiveMargin)}`);
    });
  }
  const labor = computeLabor({ ...LABOR_DRAFT, margin: String(mk(0.3) * 100) } as never, laborRate);
  let n = 100;
  same("labor", { totalPrice: labor.totalPrice, items: buildLaborItems(labor, "Rigging", () => n++).map((it) => ({ cost: it.cost, price: it.price })) }, B.labor);
  const secs = SECTIONS as never;
  const t = totals(secs, 0) as unknown as Record<string, number>;
  const bt = B.totals as Record<string, number>;
  same("totals$", { mat: t.mat, lab: t.lab, fr: t.fr, rev: t.rev, cost: t.cost, grand: t.grand }, { mat: bt.mat, lab: bt.lab, fr: bt.fr, rev: bt.rev, cost: bt.cost, grand: bt.grand });
  if (Math.abs(t.markup - mk(bt.margin)) > 1e-9) drift.push(`totals markup ${t.markup} vs ${mk(bt.margin)}`);
  (B.systemMargin as number[]).forEach((m, i) => { const k = systemMarkup((SECTIONS as never[])[i]); if (Math.abs(k - mk(m)) > 1e-9) drift.push(`systemMarkup[${i}] ${k} vs ${mk(m)}`); });
  same("tierReprice", repriceForTier(secs, mk(0.3), mk(0.2)).sections.map((s: { items: Array<{ price: number }> }) => s.items.map((it) => it.price)), B.tierReprice);
  ok(drift.length === 0, `markup parity: every margin-era price reproduces to the cent under markup${drift.length ? " — " + drift.slice(0, 8).join(" | ") : ""}`);

  // Expected, listed (never asserted equal): what new pricing does at the ROUNDED settings.
  const listed = [
    `Base $1,000 cost: ${Math.round((1000 / 0.7) * 100) / 100} → ${catalogAddPrice(1000, 0, 0.43)}`,
    `Custom part $100: 153.85 → ${customPartSell(100)}`,
  ];
  console.log("markup parity — expected rounding moves:\n  " + listed.join("\n  "));
}
```

If Task 1 recorded a float-tie cost/margin pair, add `if (name === "…" ) continue`-style tolerance for that exact entry only, and log it under "expected rounding moves".

- [ ] **Step 2: Chain it** in `scripts/test-review-and-spec.ts`. First widen Task 1's import to `import { markupPureChecks, markupDbChecks, markupParityChecks } from "./test-markup";`, then change Task 1's chain line to:

```ts
  .then(() => markupPureChecks(ok)).then(() => markupDbChecks(ok)).then(() => markupParityChecks(ok))
```

- [ ] **Step 3: Run it**

Run: `npm run test:specs 2>&1 | grep -E "markup parity|ALL PASSED|FAIL"`
Expected: `markup parity — expected rounding moves:` with its two lines, then `ALL PASSED`. If parity fails, the drift list names the function. Fix that engine (never the baseline) and re-run.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-markup.ts scripts/test-review-and-spec.ts
git commit -m "test(markup): #367 price-parity harness against the margin-era baseline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Screens and words

**Files:**
- Estimator: `src/app/(app)/estimator/`: `section-card.tsx`, `steps/build-step.tsx`, `estimator-header.tsx`, `review-cost-summary.tsx`, `labor-modal.tsx`, `vendor-quote-modal.tsx`, `catalog-picker.tsx`, `parts-csv.ts`, `review-sheet-xlsx.ts`, `header-more-menu.tsx`.
- Service builders: the three `quote/controls.tsx`, `src/components/service-total-field.tsx`.
- Lists and dashboards: `src/app/(app)/quotes/page.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/home-stage-sheet.tsx`, `src/app/(app)/projects/view.tsx`, `src/app/(app)/_dashboard/widgets/{backward,installs}.tsx`, `src/lib/dashboard/registry.ts`.
- Edit modals: `src/app/(app)/companies/edit-modal.tsx:561` and `people/edit-modal.tsx:267` (titles).
- Formula text: `src/app/(app)/catalog/fabric-rate-field.tsx:123`, `src/app/(app)/design/grid/[id]/custom-items.tsx:218`.
- Estimating Rules: `src/lib/stores/pricing.ts` (registry labels, help, formulas).
- Test: `scripts/test-review-and-spec.ts` (source pins on copy), `scripts/test-markup.ts`.

**Interfaces:**
- Consumes: everything above. **No math changes here.** If a step seems to need one, it belongs to Tasks 3–7.

- [ ] **Step 1: The Estimator**

| Where | Now | New |
|---|---|---|
| `section-card.tsx:356` | `sysMargin + "% margin"` | `sysMarkup + "% markup"` |
| `section-card.tsx:~643` label | `Margin` | `Markup` |
| `section-card.tsx:~647` range | `max={55}` | `max={125}` |
| `section-card.tsx:685` title | `…and the margin follows` | `…and the markup follows` |
| `section-card.tsx:1556` title | `Line margin` | `Line markup` |
| `section-card.tsx:~1987` label | `Margin` | `Markup` |
| `build-step.tsx:331` | `Margin · all systems` | `Markup · all systems` |
| `build-step.tsx:~347` range | `max={55}` | `max={125}` |
| `estimator-header.tsx:238` | `Blended margin` | `Blended markup` |
| `review-cost-summary.tsx:41` | `Margin (excl. freight)` | `Markup (excl. freight)` |
| `labor-modal.tsx:821` | `Margin (%)`, placeholder `30` | `Markup (%)`, placeholder `43` |
| `vendor-quote-modal.tsx:20` comment | `marked up by the section margin` | `marked up by the line's markup` |
| `header-more-menu.tsx:49` title | `…cost, sell, margin, markup and links…` | `…cost, sell, markup and links…` |

- [ ] **Step 2: Exports** (markup only, spec §3):
  - `parts-csv.ts:62-63`: the headers become `"Line markup"`, `"Effective markup"`.
  - `marginPct` becomes:

```ts
/** A markup as a one-decimal percent — "" when the cost is zero or not finite; negative when below cost; never "-0.0%". */
function markupPct(sell: number, cost: number): string {
  if (!Number.isFinite(sell) || !Number.isFinite(cost) || Math.abs(cost) < 1e-9) return "";
  const v = Math.round(((sell - cost) / cost) * 1000) / 10;
  return (v === 0 ? 0 : v).toFixed(1) + "%";
}
```

  The two calls at 389–390 change to `markupPct`.

  In `review-sheet-xlsx.ts`, drop the `"Line margin"` column (line 26) and its cell (line 109); "Markup" stays the only % column. Shift the later column numbers down by one (`put(13, …)` → `put(12, …)` and so on), update the `COL` map, and fix the `System markup` row formula column. Then confirm the existing review-sheet checks (#363 cluster) pass with the new column count.

- [ ] **Step 3: The service builders (×3)**
  - `Margin · {…} pts` becomes `Markup · {r?.overridden ? fmtPct(r.effectiveMarkup) : fmtPct(markupPts / 100)}%`.
  - `{marginPts}-pt margin on top` becomes `{fmtPct(markupPts / 100)}% markup on top`.
  - Repair: `Parts markup · N pts` becomes `Parts markup · N%`, and `marked up N pts on cost` becomes `marked up N% on cost`.
  - `service-total-field.tsx:116`: `Typed total · Reset keeps this markup`.

- [ ] **Step 4: Lists, home, projects and the dashboard**
  - `quotes/page.tsx:959,1027`: `markupPct` / `% markup`.
  - `page.tsx:129` and `home-stage-sheet.tsx`: `% markup`.
  - `projects/view.tsx:1357`: `% markup`.
  - `backward.tsx:45`: `Avg. markup`; line 50 reads `pp.markup`.
  - `installs.tsx:82`: `Avg. markup`; `centerSub="markup"`; the legend reads `Projected profit`.
  - `registry.ts:77`: `"Value times markup ÷ (1 + markup) across the open book."`.
  - `companies/edit-modal.tsx:561`: `Seeds markups for this company's quotes … Markups live in Estimating Rules.`. Update the people modal title the same way.

- [ ] **Step 5: Formula text**
  - `fabric-rate-field.tsx:123`: `sell = cost × (1 + markup).`
  - `custom-items.tsx:218`: `Priced like an allowance: unit cost × (1 + this customer's tier markup).`

- [ ] **Step 6: Estimating Rules (`stores/pricing.ts` registry)**
  - System design:
    - `system.baseMargin` label `Base markup`, help `Baseline markup baked into catalog list vs cost.  sell = cost × (1 + markup)`.
    - Formulas `system.sell` → `sell = cost × (1 + markup)` and `system.margin` → label `Blended markup`, `markup = (materialsRevenue − materialsCost) ÷ materialsCost`.
    - `system.estline` → `per-section markup 0–125%`.
    - The group note says "base markup".
  - Customer tiers:
    - `sub` becomes `Per-customer markup — punch item 11 (D87; markup since #367). Tier lives on the PERSON, company is fallback.`; the note says "markup".
    - Each tier label `<Name> margin` becomes `<Name> markup`, and `tiers.base` help ends `sell = cost × (1 + markup)`.
  - Flame / repair / inspection:
    - Labels `Flame-test markup`, `Parts markup` (help `partsSell = partsCost × (1 + partsMarkup)`), `Repair markup (labor + travel)`, `Inspection markup`.
    - Each `…total` formula changes `÷ (1 − margin)` to `× (1 + markup)` and `parts ÷ (1 − partsMargin)` to `parts × (1 + parts markup)`.
  - Catalog:
    - Group label `Catalog markup`, row label `Default part markup`, formula `list = cost × (1 + markup)`.
    - Fix the stale note (spec inventory): it is consumed by the Equipment map, Grid swap search, virtual parts and Quick Design / Grid price table, so drop "no pricing path consumes it yet", set `live: true`, and drop `ref: true` on the row.
  - Curtains formula: `sell = cost × (1 + markup)`.
  - Bonus help: `marked up at the system's blended markup`.

- [ ] **Step 7: Check that no pricing "margin" or "pts" copy is left**

Run:

```bash
grep -rnE "[\"'\`>][^\"'\`<]*\b([Mm]argin|pts)\b[^\"'\`<]*[\"'\`<]" src --include='*.tsx' --include='*.ts' | grep -vE "margin(Top|Bottom|Left|Right|Inline|Block)?\s*:|style=|@page|margin: ?[0-9\"'\`]|scrollMargin|marginSpaceRect|marginIn|riser-editor|rack/geometry|-margin|margin-"
```

Expected: only lines that name the persisted field (`"margin"` keys in code, `QuoteRevision` picks), plus `riser-editor.tsx:70` ("plan's lower margin", a drawing margin). Move anything else into this task's edits.

- [ ] **Step 8: Update the source pins.** Run `npm run test:specs 2>&1 | grep FAIL`, then update every pin that asserted the old copy (for example "Low margin —", "Blended margin", "Line margin") to the new copy.

- [ ] **Step 9: Browser check** on a scratch PGlite dev server (memory: worktree dev-server traps, preview_start reads the main checkout's launch.json). Open an Estimator quote and check:
  - the Markup · all systems slider runs 0–125;
  - a line shows "N%" in markup colours;
  - the labor modal says "Markup (%)".

  Open a flame-test quote and check:
  - the knob runs 10–100 and reads "Markup · 43%";
  - a typed total under 11 % warns "Low markup".

  Open Estimating Rules and check that the tiers read 43/37/28/25/18/11/5. Take one screenshot of each.

- [ ] **Step 10: Gate and commit**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | tail -3 && npm run test:smoke 2>&1 | tail -3 && npx eslint <changed files>`

```bash
git add -A src scripts
git commit -m "feat(markup): #367 every pricing screen, report and export says markup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs and the final gate

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`, `OPEN-DECISIONS.md`, `MASTER-QUESTIONS.md`, `src/lib/pricing-tiers.ts` and `src/app/(app)/estimator/pricing.ts` header comments (if not already done).

- [ ] **Step 1: Recompute the numbers right before writing** (memory: two sessions on main):

```bash
git fetch origin && git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | tail -1 && git show origin/main:PUNCHLIST.md | grep -oE "^## [0-9]+" | tail -1
```

Use the next free D-numbers and confirm the punch number (#367 if free).

- [ ] **Step 2: `DECISIONS.md`.** Add one entry per decision in spec §2, plus the plan's four deviations: designs not converted; no adapters; legacy twin; exact service knob. Add a "Superseded by D<new> (#367)" line to D87, D88, D135, D163, D283, D303, D314, D319, D333, D364, D413, D457, D476, D482, D484, D501, D635, D1231 and D1250.

- [ ] **Step 3: `PUNCHLIST.md` #367.** Add what shipped, the gates with real numbers, and the Jeff-gated remainder:
  - `npm run db:export` before the merge deploy;
  - deploy at a quiet time (old instances read converted settings as margins until they drain);
  - after the deploy, open Estimating Rules and check the tiers read 43/37/28/25/18/11/5;
  - open one sent and one draft quote of each type and confirm the totals are unchanged;
  - re-save one draft service quote without touching the knob and confirm its total holds;
  - decide whether to set cleaner tier values;
  - **no rollback past this merge; never preview-deploy the branch.**

- [ ] **Step 4: `AGENTS.md` phase 67**, in the style of the phase list. Also edit OPEN-DECISIONS "Cost + margin" and the MASTER-QUESTIONS tier lines to say markup.

- [ ] **Step 5: The final gate**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | tail -3 && npm run test:markup-settings && npm run test:smoke 2>&1 | tail -3 && npx eslint $(git diff --name-only main -- 'src/**/*.ts' 'src/**/*.tsx') && npx next build 2>&1 | tail -5`
Expected: all clean. Record the real PASS counts in PUNCHLIST.

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md OPEN-DECISIONS.md MASTER-QUESTIONS.md src
git commit -m "docs: #367 markup pricing — decisions, punch, phase note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
