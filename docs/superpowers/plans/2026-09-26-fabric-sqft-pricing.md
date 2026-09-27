# Fabric Flat $/sq ft Pricing (#227) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every curtain prices as `sewn area × one flat $/sq ft` (making included), read through one pure helper `fabricAreaRateOf(part)`. The rate can be edited in the catalog part editor (with a $/lin-yd and $/sq-yd converter) and imported through the Import hub and the price-book importer. Labels read "$X/sq ft sewn (incl. making)" or "No $/sq ft set".

**Architecture:** `src/lib/design/curtain-pricing.ts` stays the one cost model. It loses the per-foot making term and gains `fabricAreaRateOf` (`curtainAreaRate ?? SEED_FABRIC_RATES[sku] ?? costPerSqft ?? 0`). Every mirror calls the model or the helper and keeps no chain of its own: the server portal module `src/lib/curtain-pricing.ts`, the client-safe `src/lib/curtain-geom.ts`, `equipment-pricing.ts`, `equipment-map.ts`, `grid-curtains.ts`, estimator `computeCurtain`, the portal action and page, the Grid page, and the swap search. The client-side "sell coefficients" (`SellCoeffs`/`sellCoeffs`) existed only to carry the making term, so they are deleted. `curtain-geom.ts` also holds the client-safe label constants and the converter.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle/PGlite doc-store (`catalog_parts` via `mergeUpsert`), harness `scripts/test-review-and-spec.ts` (tsx, `ok()` assertions, tag `#227`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-26-fabric-sqft-pricing-design.md`. Prior model: `docs/superpowers/specs/2026-07-24-curtain-pricing-rebuild-design.md`. D303: the Equipment map prices only from the map. The "No SEED_FABRIC_RATES fallback" note in `equipment-map.ts` is **reversed** by spec §2: the map now uses the same helper, seeds included.
- **Model:** `cost = round2(sewnAreaSqft × fabricRate)`, where `sewnWidthFt = W × (1 + fullness/100)` and `sewnAreaSqft = sewnWidthFt × H`. No width or making term anywhere. `vendorCostOverride` still replaces the cost. Sell is `cost ÷ (1 − margin)`, unchanged.
- **Delete** `makingRateFor`, `DEFAULT_MAKING_RATE`, `DEFAULT_CYC_MAKING_RATE`, `CurtainRates.makingRate`, `sellCoeffs`, `SellCoeffs`, and every `coeffs`/`curtainCoeffs` prop.
- **One chain:** outside `src/lib/design/curtain-pricing.ts`, no file may contain `curtainAreaRate ??` or `SEED_FABRIC_RATES[`. The Equipment map keeps its `category === "Fabric"` gate and puts the helper behind it.
- `SEED_FABRIC_RATES` keeps its five values (the harness pins them). They were fabric-only and now under-price. That risk goes into a DECISIONS entry that the **controller** writes after merge. This plan makes **no DECISIONS.md / PUNCHLIST.md edits**.
- Label text is exact: unit `sq ft sewn (incl. making)`, full label `$3.64/sq ft sewn (incl. making)`, no-rate `No $/sq ft set`. The catalog editor field label is `$/sq ft sewn (includes making)` (spec §3).
- Import columns are exact-header-only: Import hub `exactOnly: true`. The price-book parser matches aliases exactly by construction and gets no positional slot. A blank cell or an absent column never clears a stored value, so only a positive number is written.
- **Client components never import a store module** (`@/lib/stores/*`, `@/db*`) or a cost module (`@/lib/curtain-pricing`, `@/lib/design/curtain-pricing`), not even transitively. The one exception already in place: estimator `curtain-modal.tsx` → `./pricing` is an internal cost view.
- Shell: every command starts with `export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks`. Never run `npm run dev` or any `db:*` script, and never open `.data/pglite`. `npm run test:specs` makes its own throwaway PGlite dir.
- Gates per task: `npx tsc --noEmit` (0 errors), `npm run test:specs` (0 `FAIL`, report the PASS count), `npx eslint <changed files>` (0 errors). All three tasks touch UI files, so each one also runs `npx next build`, which must pass.
- Commit per task: `feat(pricing): <summary> (#227)` + blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Stage by explicit path, never `git add -A`/`.`.** If `.git/index.lock` exists, wait 2 s and retry. Never `git stash`.
- **Concurrent work:** another implementer is editing flame-test builder files **and `scripts/test-review-and-spec.ts`** in this worktree. Before each task, run `git status --short scripts/test-review-and-spec.ts`. If it shows changes you did not make, **stop and ask the controller**: committing the harness would sweep their hunks into your commit. Find every insertion point by the landmark text quoted in each step. Line numbers are hints from commit `909115c8`. Append new harness blocks at **EOF**. A test:specs FAIL outside curtain/fabric/#227 assertions belongs to them, not you. Report it and don't fix it.

## Before Task 1 (once)

- [ ] **Toolchain + baseline**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
ls node_modules/.bin/tsc node_modules/.bin/next || npm ci
ps aux | grep -E "tsx|next dev" | grep -v grep   # nothing may hold this worktree's .data
git status --short
npm run test:specs 2>&1 | tee /tmp/claude-227-baseline.txt | tail -3
grep -c '^PASS ' /tmp/claude-227-baseline.txt
```
Expected: `ALL PASSED`. Record the PASS count as `BASE`.

## File map

| File | Task | Change |
|---|---|---|
| `src/lib/design/curtain-pricing.ts` | 1 | Flat model; `fabricAreaRateOf`; making constants deleted |
| `src/lib/curtain-pricing.ts` | 1 | Portal server cost flat; `sellCoeffs` deleted |
| `src/lib/curtain-geom.ts` | 1, 2, 3 | `curtainPriceEach(d, pricePerSqft)` (1); converter + label constants (2); `fabricRateLabel` (3) |
| `src/lib/design/equipment-pricing.ts` | 1 | `drapeUnitCost` flat |
| `src/lib/design/equipment-map.ts` | 1, 3 | Rate via helper (1); split needs-part reasons (3) |
| `src/lib/design/grid-curtains.ts` | 1 | `fabricAreaRate` deleted → helper |
| `src/lib/design/auto-estimate.ts` | 1, 3 | `curtainSwapHits` via helper (1); unit label (3) |
| `src/app/(app)/design/grid/[id]/actions.ts` | 1 | Pass `costPerSqft` to swap hits |
| `src/app/(app)/design/grid/[id]/{page.tsx,editor.tsx,curtain-drop.tsx}` | 1, 3 | Coeffs removed, helper (1); fabric option label (3) |
| `src/app/(app)/estimator/{pricing.ts,page.tsx}` | 1 | Helper; page passes the resolved rate |
| `src/app/(app)/estimator/curtain-modal.tsx` | 3 | Option label |
| `src/app/portal/actions.ts`, `src/app/portal/estimate/{page.tsx,estimate-builder.tsx}` | 1 | Helper; coeffs removed |
| `src/app/(app)/design/quick/engine.ts` | 1 | Comment only |
| `src/lib/stores/catalog.ts` | 1 | Doc comment only |
| `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx` | 3 | Cell label |
| `src/app/(app)/catalog/fabric-rate-field.tsx` (new) | 2 | Client rate input + converter |
| `src/app/(app)/catalog/{page.tsx,part-form.ts}` | 2 | Render the field for Fabric parts; `optionalPartFields` carries it |
| `src/app/(app)/import/{types.ts,registry.ts}` | 2 | Two exact-only columns; `catalogPatch` + export |
| `src/app/(app)/catalog/{parse.ts,import.ts}` | 2 | Price-book columns + `fabricFieldsOf` |
| `scripts/test-review-and-spec.ts` | 1, 2, 3 | Updated expectations + `#227` blocks at EOF |

---

## Task 1: One flat rate through one helper, every mirror, parity

**Files:** Modify every Task-1 row in the file map. Test: `scripts/test-review-and-spec.ts`.

**Interfaces (produced):**
```ts
// src/lib/design/curtain-pricing.ts
export type CurtainRates = { fabricRate: number };
export type FabricRateSource = { sku?: string; curtainAreaRate?: number | null; costPerSqft?: number | null };
export function fabricAreaRateOf(part: FabricRateSource | null | undefined): number;
export function curtainCost(input: CurtainCostInput, rates: CurtainRates): CurtainCost; // flat
// src/lib/curtain-pricing.ts
export function curtainCost(d: CurtainSpec, fabricAreaRate: number, margin?: number): { costEach: number; priceEach: number };
export function fabricSellPerSqft(fabricAreaRate: number, margin?: number): number;
// src/lib/curtain-geom.ts
export function curtainPriceEach(d: CurtainSpec, pricePerSqft: number): number;
```

### Step 1: Update existing harness expectations (these fail until the code changes)

- [ ] **1a.** Line 62. Replace
```ts
import { curtainCost, curtainPrice, makingRateFor, DEFAULT_MAKING_RATE, DEFAULT_CYC_MAKING_RATE, SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
```
with
```ts
import { curtainCost, curtainPrice, fabricAreaRateOf, SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
```

- [ ] **1b.** About lines 2721–2758. Replace everything from the line `/* --- curtain pricing: reconcile Rose Brand quote 423939 (task 1) --- */` through the line starting `ok(DEFAULT_CYC_MAKING_RATE === 4.75` (inclusive; Read the range first) with:
```ts
/* --- curtain pricing: flat $/sq ft sewn, making included (#227) ---
 * Replaces the two-term Rose Brand 423939 reconciliation (spec 2026-07-24):
 * a fabric's rate now carries making, so cost = sewn area × rate, no width term. */
const border = curtainCost({ finishedWidthFt: 50, finishedHeightFt: 3, fullnessPct: 50, qty: 1 }, { fabricRate: 3.64 });
ok(border.costEach === 819, `#227 flat: a 50×3 border at 50% = sewn area 225 × 3.64 = 819, no width term (got ${border.costEach})`);
const legs = curtainCost({ finishedWidthFt: 9.5, finishedHeightFt: 10 + 11 / 12, fullnessPct: 50, qty: 1 }, { fabricRate: 2.84 });
ok(Math.abs(legs.costEach - 441.8) < 0.01, `#227 flat: legs = sewn area 155.5625 × 2.84 ≈ 441.80 (got ${legs.costEach.toFixed(2)})`);

// sewn geometry
ok(border.sewnWidthFt === 75 && Math.abs(border.sewnAreaSqft - 225) < 1e-6, "sewnWidth = W×(1+fullness); sewnArea = sewnWidth×H");
// qty multiplies the total, not the unit
ok(Math.abs(curtainCost({ finishedWidthFt: 9.5, finishedHeightFt: 10 + 11 / 12, fullnessPct: 50, qty: 4 }, { fabricRate: 2.84 }).costTotal - legs.costEach * 4) < 1e-6, "costTotal = costEach × qty");

// vendor override replaces the make cost and flags the line
const ov = curtainCost({ finishedWidthFt: 23, finishedHeightFt: 15, fullnessPct: 50, qty: 2, vendorCostOverride: 2080 }, { fabricRate: 3.64 });
ok(ov.costEach === 2080 && ov.overridden === true && ov.costTotal === 4160, "vendorCostOverride replaces make cost, flags overridden, ×qty");
ok(curtainCost({ finishedWidthFt: 10, finishedHeightFt: 10, fullnessPct: 50, qty: 1 }, { fabricRate: 3.64 }).overridden === false, "no override → overridden false");

// cyc flatness: 0% fullness → sewn area equals finished face, same one rate
const cyc = curtainCost({ finishedWidthFt: 40, finishedHeightFt: 20, fullnessPct: 0, qty: 1 }, { fabricRate: 0.9 });
ok(cyc.sewnAreaSqft === 800 && cyc.sewnWidthFt === 40, "cyc at 0% fullness: sewn area = finished face, no 1.5× applied");
ok(cyc.costEach === 720, `#227 flat: flat goods price at the same one rate — 800 × 0.9 = 720, no cyc making charge (got ${cyc.costEach})`);

// margin
ok(Math.abs(curtainPrice(700) - 1000) < 1e-6, "price = cost / (1 − 0.30)");
```
Leave the `SEED_FABRIC_RATES` pin lines that follow exactly as they are.

- [ ] **1c.** About lines 2772–2778. Replace everything from the comment `// seed-rate analog of the RB reconciliation above: exercises the make-it` through the line `ok(seedBorder.costEach === 1533.75, …);` (inclusive) with:
```ts
// seed-rate analog, end to end through curtainCost and the one helper (#227).
const seedBorder = curtainCost({ finishedWidthFt: 50, finishedHeightFt: 3, fullnessPct: 50, qty: 1 }, { fabricRate: SEED_FABRIC_RATES["RB-CHAR-25"] });
ok(seedBorder.costEach === 819, `#227 seed-rate border = sewnArea(225)×3.64 = 819 (got ${seedBorder.costEach})`);
ok(fabricAreaRateOf({ sku: "RB-CHAR-25" }) === 3.64, "#227: fabricAreaRateOf reads the seed rate for a seeded SKU");
```

- [ ] **1d.** In the `computeCurtain rebuilt on the two-term model (task 4)` block, replace
```ts
  // make cost = sewnArea(30×19=570)×3.64 + sewnWidth(30)×9.53 = 2074.8 + 285.9 = 2360.7
  ok(Math.abs(cc.costEach - 2360.7) < 1, `computeCurtain uses the two-term make-it cost (got ${cc.costEach})`);
```
with
```ts
  // #227 flat: make cost = sewnArea(30×19=570) × 3.64 = 2074.8 (making is in the rate)
  ok(Math.abs(cc.costEach - 2074.8) < 0.01, `computeCurtain uses the flat $/sq ft cost (got ${cc.costEach})`);
```

- [ ] **1e.** Replace
```ts
import { curtainCost as curtainCostQ, SEED_FABRIC_RATES as RATES_Q, makingRateFor as makingForQ } from "@/lib/design/curtain-pricing";
```
with
```ts
import { curtainCost as curtainCostQ, SEED_FABRIC_RATES as RATES_Q } from "@/lib/design/curtain-pricing";
```
and in the `budget and quote agree on the same drape (task 7)` block replace
```ts
    { fabricRate: RATES_Q[rule.fabricSku], makingRate: makingForQ(rule.fullness) }
```
with
```ts
    { fabricRate: RATES_Q[rule.fabricSku] }
```

- [ ] **1f.** In the `an unrated curtain fabric falls back to costPerSqft` block, replace
```ts
  // fabricRate falls back to costPerSqft 3.45: sewnArea 40×1.5×20=1200, making 60×9.53=571.8 → 1200×3.45+571.8=4711.8
  ok(Math.abs(cc.costEach - 4711.8) < 1, `unrated fabric prices via costPerSqft, not $0 (got ${cc.costEach})`);
```
with
```ts
  // fabricRate falls back to costPerSqft 3.45 through fabricAreaRateOf (#227): sewnArea 40×1.5×20=1200 → 1200×3.45=4140
  ok(Math.abs(cc.costEach - 4140) < 0.01, `unrated fabric prices via costPerSqft, not $0 (got ${cc.costEach})`);
```

- [ ] **1g.** Replace the whole portal block. It starts at `import { curtainCost as portalCurtainCost, sellCoeffs as portalSellCoeffs, fabricSellPerSqft as portalFabricSell } from "@/lib/curtain-pricing";` and runs through the closing `}` right after the `flat cyc: client == server` assertion. Replace it with:
```ts
import { curtainCost as portalCurtainCost, fabricSellPerSqft as portalFabricSell } from "@/lib/curtain-pricing";
import { curtainPriceEach as portalPriceEach } from "@/lib/curtain-geom";
/* --- portal curtain pricing on the shared flat $/sq ft model (#227) + cent-match invariant --- */
{
  const spec = (fab: string, w: string, h: string, full: string) => ({ name: "d", hang: "Pipe", fabric: fab, qty: "1", width: w, height: h, fullness: full, bottom: "Chain" });
  const AREA_RATE = 3.64; // Charisma
  const margin = 0.30;
  // server flat cost: sewnW = 20×1.5=30, sewnA=30×19=570, cost=570×3.64=2074.8
  const sv = portalCurtainCost(spec("RB-CHAR-25", "20", "19", "50"), AREA_RATE, margin);
  ok(Math.abs(sv.costEach - 2074.8) < 0.01, `portal server cost = flat $/sq ft cost (got ${sv.costEach})`);
  ok(Math.abs(sv.priceEach - 2074.8 / 0.7) < 0.02, "portal price = cost / (1 − 0.30)");
  // CENT-MATCH: client preview equals server priceEach exactly
  const px = portalFabricSell(AREA_RATE, margin);
  const clientPrice = portalPriceEach(spec("RB-CHAR-25", "20", "19", "50"), px);
  ok(Math.abs(clientPrice - sv.priceEach) < 0.01, `client preview == server price to the cent (client ${clientPrice}, server ${sv.priceEach})`);
  // flat cyc: the same one rate on both sides
  const svFlat = portalCurtainCost(spec("RB-MUS", "40", "20", "0"), 0.9, margin);
  const clientFlat = portalPriceEach(spec("RB-MUS", "40", "20", "0"), portalFabricSell(0.9, margin));
  ok(Math.abs(clientFlat - svFlat.priceEach) < 0.01 && svFlat.costEach === 720, "flat cyc: client == server, 800 sq ft × 0.9 = 720 (no cyc making charge)");
}
```

- [ ] **1h.** `#211 T2` block (about line 17674). Replace the message string
`"#211 T2: a rateless or non-fabric part on a fabric row is needs-a-part (no seed-rate fallback)"`
with
`"#211 T2 / #227: a rateless non-seed fabric or a non-fabric part on a fabric row is needs-a-part"`.

- [ ] **1i.** `#211 T5` block (about line 17801). Replace
```ts
import { curtainCost as gemCurtainCost5, makingRateFor as gemMaking5 } from "@/lib/design/curtain-pricing";
```
with
```ts
import { curtainCost as gemCurtainCost5 } from "@/lib/design/curtain-pricing";
```
and replace
```ts
  const expected = Math.round(gemCurtainCost5({ finishedWidthFt: rule.w, finishedHeightFt: rule.h, fullnessPct: rule.fullness, qty: rule.qty }, { fabricRate: 3.5, makingRate: gemMaking5(rule.fullness) }).costTotal);
  ok(d.cost === expected && d.cost === gemDrape5(draw.drape!, 3.5) && d.price === Math.round((expected / 0.7) * 100) / 100, `#211 T5: a drape costs the shared two-term model at the mapped fabric's area rate (got ${d.cost}, expected ${expected})`);
```
with
```ts
  const expected = Math.round(gemCurtainCost5({ finishedWidthFt: rule.w, finishedHeightFt: rule.h, fullnessPct: rule.fullness, qty: rule.qty }, { fabricRate: 3.5 }).costTotal);
  ok(d.cost === expected && d.cost === gemDrape5(draw.drape!, 3.5) && d.price === Math.round((expected / 0.7) * 100) / 100, `#211 T5 / #227: a drape costs the shared flat $/sq ft model at the mapped fabric's area rate (got ${d.cost}, expected ${expected})`);
```

### Step 2: Append the #227 parity block at EOF

- [ ] Append to the **end** of `scripts/test-review-and-spec.ts`:
```ts

/* ====== #227 T1: one flat $/sq ft, one helper, every mirror agrees ====== */
import { curtainCost as fab227Cost, curtainPrice as fab227Price, fabricAreaRateOf as fab227RateOf, SEED_FABRIC_RATES as fab227Seeds } from "@/lib/design/curtain-pricing";
import { curtainCost as fab227PortalCost, fabricSellPerSqft as fab227Sell } from "@/lib/curtain-pricing";
import { curtainPriceEach as fab227PriceEach } from "@/lib/curtain-geom";
import { drapeUnitCost as fab227Drape } from "@/lib/design/equipment-pricing";
import { computeCurtain as fab227Compute } from "@/app/(app)/estimator/pricing";
import { priceGridCurtains as fab227Grid } from "@/lib/design/grid-curtains";
import { priceCell as fab227PriceCell, type PricingPart as Fab227Part } from "@/lib/design/equipment-map";
import { EQUIPMENT_ROW_BY_KEY as fab227Rows } from "@/lib/design/equipment-vocab";
import { curtainSwapHits as fab227SwapHits } from "@/lib/design/auto-estimate";
{
  // The formula: sewn area × rate, pleated and flat alike.
  const pleated = fab227Cost({ finishedWidthFt: 20, finishedHeightFt: 19, fullnessPct: 50, qty: 1 }, { fabricRate: 3.64 });
  ok(pleated.sewnAreaSqft === 570 && pleated.costEach === 2074.8, `#227: pleated cost = sewn area 570 × 3.64 = 2074.8, no width term (got ${pleated.costEach})`);
  const flat = fab227Cost({ finishedWidthFt: 40, finishedHeightFt: 20, fullnessPct: 0, qty: 1 }, { fabricRate: 0.9 });
  ok(flat.sewnAreaSqft === 800 && flat.costEach === 720, `#227: flat goods cost = 800 × 0.9 = 720 (got ${flat.costEach})`);
  ok(fab227Price(pleated.costEach, 0.3) === Math.round((2074.8 / 0.7) * 100) / 100, "#227: sell = cost ÷ (1 − margin), unchanged");

  // The one fallback chain.
  ok(fab227RateOf({ sku: "RB-EN-16", curtainAreaRate: 5, costPerSqft: 1 }) === 5, "#227 chain: the catalog's curtainAreaRate wins");
  ok(fab227RateOf({ sku: "RB-EN-16", costPerSqft: 2.6 }) === fab227Seeds["RB-EN-16"], "#227 chain: then the seed rate for that SKU");
  ok(fab227RateOf({ sku: "RB-EN-16", curtainAreaRate: null, costPerSqft: 2.6 }) === 2.1, "#227 chain: a null curtainAreaRate falls through like an absent one");
  ok(fab227RateOf({ sku: "FAB227-X", costPerSqft: 1.1 }) === 1.1, "#227 chain: then the raw costPerSqft");
  ok(fab227RateOf({ sku: "FAB227-X" }) === 0 && fab227RateOf(null) === 0 && fab227RateOf(undefined) === 0, "#227 chain: else 0 (No $/sq ft set)");
  ok(fab227RateOf({ sku: "toString" }) === 0 && fab227RateOf({ sku: "FAB227-X", curtainAreaRate: -2 }) === 0, "#227 chain: a prototype key is never a seed, and a negative rate is 0");

  // Parity: every mirror returns the same number for the same drape.
  const cases = [
    { w: 20, h: 19, full: 50, rate: 3.64 },
    { w: 40, h: 20, full: 0, rate: 0.9 },
    { w: 9.5, h: 10 + 11 / 12, full: 100, rate: 2.84 },
    { w: 50, h: 3, full: 75, rate: 4.37 },
  ];
  for (const c of cases) {
    const tag = `${c.w}×${c.h.toFixed(2)} @${c.full}% $${c.rate}`;
    const shared = fab227Cost({ finishedWidthFt: c.w, finishedHeightFt: c.h, fullnessPct: c.full, qty: 1 }, { fabricRate: c.rate }).costEach;
    const spec = { name: "d", hang: "", fabric: "FAB227", qty: "1", width: String(c.w), height: String(c.h), fullness: String(c.full), bottom: "" };
    const portal = fab227PortalCost(spec, c.rate, 0.3);
    const est = fab227Compute({ ...spec, vendorCostOverride: "" }, [{ sku: "FAB227", name: "x", costPerSqft: 0, curtainAreaRate: c.rate }], 0.3);
    const grid = fab227Grid(
      [{ id: "pl1", curtain: { type: "Draw", name: "d", widthFt: c.w, heightFt: c.h, fullnessPct: c.full, fabricSku: "FAB227" } }],
      [{ id: "FAB227", sku: "FAB227", desc: "x", category: "Fabric", curtainAreaRate: c.rate }],
      0.3
    ).get("pl1")!;
    const drape = fab227Drape({ w: c.w, h: c.h, fullness: c.full, qty: 1 }, c.rate);
    const client = fab227PriceEach(spec, fab227Sell(c.rate, 0.3));
    ok(portal.costEach === shared && est.costEach === shared && grid.costEach === shared, `#227 parity ${tag}: portal, estimator and Grid cost = shared model ${shared} (got ${portal.costEach} / ${est.costEach} / ${grid.costEach})`);
    ok(drape === Math.round(shared), `#227 parity ${tag}: the Equipment map drape cost is the shared cost, dollar-rounded (got ${drape})`);
    ok(grid.priceEach === portal.priceEach && Math.abs(client - portal.priceEach) < 0.011, `#227 parity ${tag}: Grid + client preview sell = portal sell (client ${client}, server ${portal.priceEach})`);
    ok(Math.abs(est.priceEach - portal.priceEach) <= 0.011, `#227 parity ${tag}: estimator sell within a cent of the portal sell`);
  }

  // The Equipment map and the swap search read the same helper.
  const drawDef = fab227Rows.get("curtains:draw")!;
  const ctxOf = (p: Fab227Part) => ({ parts: new Map<string, Fab227Part>([[p.sku, p]]), fixtures: new Map(), margin: 0.3 });
  const seeded = fab227PriceCell({ kind: "part", sku: "RB-EN-16" }, drawDef, ctxOf({ sku: "RB-EN-16", desc: "Encore 16", unit: "sq ft", cost: 0, list: 0, category: "Fabric" }));
  ok(seeded.status === "part" && seeded.areaRate === 2.1, "#227: the Equipment map resolves a fabric through fabricAreaRateOf — seed rates included (spec §2)");
  const cps = fab227PriceCell({ kind: "part", sku: "FAB227-CPS" }, drawDef, ctxOf({ sku: "FAB227-CPS", desc: "Muslin", unit: "sq ft", cost: 0, list: 0, category: "Fabric", costPerSqft: 1.4 }));
  ok(cps.status === "part" && cps.areaRate === 1.4, "#227: …and falls back to the fabric's cost per sq ft");
  const hits = fab227SwapHits([{ sku: "FAB227-CPS", desc: "cost/sq ft only", costPerSqft: 1.4 }, { sku: "FAB227-NONE", desc: "no rate" }], 0.3);
  ok(hits.length === 1 && hits[0].ref === "FAB227-CPS" && hits[0].unitSell === 2, "#227: the swap search finds a fabric priced only by cost per sq ft (the one helper), sold through the margin");

  // No making term and no private rate chain survives in any mirror.
  const mirrors227 = [
    "src/lib/design/curtain-pricing.ts", "src/lib/curtain-pricing.ts", "src/lib/curtain-geom.ts",
    "src/lib/design/equipment-pricing.ts", "src/lib/design/equipment-map.ts", "src/lib/design/grid-curtains.ts",
    "src/lib/design/auto-estimate.ts", "src/app/(app)/estimator/pricing.ts", "src/app/(app)/estimator/page.tsx",
    "src/app/portal/actions.ts", "src/app/portal/estimate/page.tsx", "src/app/portal/estimate/estimate-builder.tsx",
    "src/app/(app)/design/grid/[id]/page.tsx", "src/app/(app)/design/grid/[id]/editor.tsx", "src/app/(app)/design/grid/[id]/curtain-drop.tsx",
  ];
  for (const f of mirrors227) {
    const s = readFileSync(join(process.cwd(), f), "utf8");
    ok(!/makingRate|MAKING_RATE|sellCoeffs|SellCoeffs|makingPerFt|curtainCoeffs/.test(s), `#227: ${f} carries no making term or sell coefficients`);
    if (f !== "src/lib/design/curtain-pricing.ts") ok(!/curtainAreaRate\s*\?\?|SEED_FABRIC_RATES\[/.test(s), `#227: ${f} resolves a fabric rate only through fabricAreaRateOf`);
  }
}
```

- [ ] **Step 3: Run it and watch it fail**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: errors (`fabricAreaRateOf` not exported; `curtainPriceEach` called with 2 args where 3 are required). Don't commit anything yet.

### Step 4: The shared model

- [ ] Replace the whole of `src/lib/design/curtain-pricing.ts` with:
```ts
/**
 * Curtain pricing — one shared model for the budget (Quick Design, the Grid
 * Equipment map) and the quote (estimator, Grid, portal), built from the same
 * finished geometry the lineset weights use (spec 2026-07-24-curtain-pricing-
 * rebuild).
 *
 * #227 (2026-09-26, Jeff: "We need fabric to price via sqft"): ONE flat rate.
 * A fabric's `curtainAreaRate` is its cost per sq ft of SEWN fabric INCLUDING
 * making / sewing, so cost = sewn area × rate. The two-term model's separate
 * per-foot making charge (the Rose Brand 423939 calibration) is gone — the
 * rate carries it. A per-line vendor cost override still replaces the
 * computed cost when a real Rose Brand price arrives.
 */

export type CurtainRates = {
  /** $/ft² of SEWN fabric (finished width × (1 + fullness) × height), making included. */
  fabricRate: number;
};

export type CurtainCostInput = {
  finishedWidthFt: number;
  finishedHeightFt: number;
  fullnessPct: number;
  qty: number;
  /** When set, this real vendor price REPLACES the computed make-it cost. */
  vendorCostOverride?: number | null;
};

export type CurtainCost = {
  sewnWidthFt: number;
  sewnAreaSqft: number;
  makeCostEach: number;
  costEach: number;
  costTotal: number;
  overridden: boolean;
};

/** Peak's flat curtain margin on price. */
export const CURTAIN_MARGIN = 0.3;

/**
 * Seed area rates by fabric SKU — the fallback when a catalog fabric has no
 * `curtainAreaRate` of its own. Calibrated FABRIC-ONLY (Rose-Brand-reconciled
 * × 1.10) before #227 folded making into the rate, so they under-price a sewn
 * drape until they are raised to include making (see DECISIONS).
 */
export const SEED_FABRIC_RATES: Record<string, number> = {
  "RB-CHAR-25": 3.64, // Charisma 25oz (anchor: RB 3.313 ×1.10)
  "RB-EN-22": 2.84,   // Encore 22oz  (anchor: RB 2.582 ×1.10)
  "RB-EN-16": 2.1,    // Encore 16oz  (seed)
  "RB-MV-MN": 4.37,   // Memorable 25oz — Rose Brand's PREMIUM velour; ~20% over Charisma so best-main ≠ better-main. Weight is correctly equal (both 25oz). PLACEHOLDER premium — refine from a real Memorable quote.
  "RB-MUS": 0.9,      // Seamless Muslin (seed)
};

/** The catalog fields a fabric's area rate is read from. */
export type FabricRateSource = {
  sku?: string;
  curtainAreaRate?: number | null;
  costPerSqft?: number | null;
};

/**
 * THE fabric area rate (#227) — every curtain path reads it here, so no path
 * can drift: the catalog's editable `curtainAreaRate`, else the seed rate for
 * that SKU, else the raw `costPerSqft`, else 0 ("No $/sq ft set" — the drape
 * prices at $0). A non-finite or non-positive result is 0. Pure.
 */
export function fabricAreaRateOf(part: FabricRateSource | null | undefined): number {
  if (!part) return 0;
  const sku = part.sku ?? "";
  const seed = Object.prototype.hasOwnProperty.call(SEED_FABRIC_RATES, sku) ? SEED_FABRIC_RATES[sku] : undefined;
  const rate = Number(part.curtainAreaRate ?? seed ?? part.costPerSqft ?? 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Flat make-it cost (sewn area × rate), with optional vendor override. Pure. */
export function curtainCost(input: CurtainCostInput, rates: CurtainRates): CurtainCost {
  const sewnWidthFt = input.finishedWidthFt * (1 + input.fullnessPct / 100);
  const sewnAreaSqft = sewnWidthFt * input.finishedHeightFt;
  const makeCostEach = round2(sewnAreaSqft * (rates.fabricRate || 0));
  const overridden = input.vendorCostOverride != null && input.vendorCostOverride > 0;
  const costEach = overridden ? round2(input.vendorCostOverride as number) : makeCostEach;
  return {
    sewnWidthFt,
    sewnAreaSqft,
    makeCostEach,
    costEach,
    costTotal: round2(costEach * Math.max(1, input.qty)),
    overridden,
  };
}

/** price = cost / (1 − margin). */
export function curtainPrice(costEach: number, margin: number = CURTAIN_MARGIN): number {
  const m = margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN;
  return costEach > 0 ? round2(costEach / (1 - m)) : 0;
}
```

### Step 5: The portal server module and the client-safe mirror

- [ ] Replace the whole of `src/lib/curtain-pricing.ts` with:
```ts
import { round2, type CurtainSpec } from "./curtain-geom";

/**
 * Authoritative curtain pricing (IDEAS #48) — SERVER ONLY.
 *
 * This module holds a pricing secret: the 30% default margin. It must never be
 * imported into a client component, or the margin would ship to the
 * customer's browser. The customer's live preview instead runs ./curtain-geom
 * over the per-fabric SELL price/sq ft this module precomputes
 * (fabricSellPerSqft).
 *
 * Same flat model as @/lib/design/curtain-pricing (#227): cost = sewn area ×
 * the fabric's $/sq ft sewn, making included. The caller resolves that rate
 * with fabricAreaRateOf.
 */

export const CURTAIN_MARGIN = 0.3;

/**
 * AUTHORITATIVE — cost + sell price for one curtain at a fabric's flat area
 * rate. Used on submit to persist the draft quote, so what the team opens
 * matches to the cent.
 */
export function curtainCost(
  d: CurtainSpec,
  fabricAreaRate: number,
  /** Margin-on-price fraction; the customer's tier seeds this (item 11,
   *  D88). Default stays the legacy CURTAIN_MARGIN. */
  margin: number = CURTAIN_MARGIN
): { costEach: number; priceEach: number } {
  const w = parseFloat(d.width) || 0;
  const h = parseFloat(d.height) || 0;
  const fullness = parseFloat(d.fullness) || 0;
  const sewnWidth = w * (1 + fullness / 100);
  const sewnArea = sewnWidth * h;
  const rawCost = sewnArea * (fabricAreaRate || 0);
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  const costEach = round2(rawCost);
  const priceEach = rawCost > 0 ? round2(rawCost / m) : 0; // price from RAW cost, not rounded cost
  return { costEach, priceEach };
}

/** A fabric's customer-facing sell price/sq ft (area rate ÷ (1 − margin)). */
export function fabricSellPerSqft(
  fabricAreaRate: number,
  margin: number = CURTAIN_MARGIN
): number {
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  return (fabricAreaRate || 0) / m;
}
```

- [ ] Replace the whole of `src/lib/curtain-geom.ts` with:
```ts
/**
 * Curtain geometry + client-safe pricing (IDEAS #48).
 *
 * This module is imported by the CUSTOMER's browser bundle, so it contains NO
 * pricing secrets — no margin, no cost basis. It knows only how to turn
 * dimensions into area, and how to price a curtain from an already-computed
 * SELL price/sq ft per fabric. That sell number is produced server-side from
 * the authoritative math in ./curtain-pricing (which stays on the server).
 *
 * Because a customer never receives the margin or the cost basis, they can't
 * work backwards from these sell numbers to Peak's cost.
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The customer-editable shape of one curtain (all fields are raw strings). */
export type CurtainSpec = {
  name: string;
  hang: string;
  fabric: string; // fabric sku
  qty: string;
  width: string;
  height: string;
  fullness: string; // "0" | "50" | "75" | "100"
  bottom: string;
};

/** A fabric option as the customer sees it — a SELL price/sq ft, never cost. */
export type FabricSell = { sku: string; name: string; pricePerSqft: number };

/** Finished face + sewn fabric area (sq ft) and finished width (ft). */
export function curtainAreas(d: CurtainSpec): {
  faceArea: number;
  fabricArea: number;
  width: number;
} {
  const h = parseFloat(d.height) || 0;
  const w = parseFloat(d.width) || 0;
  const fullness = (parseFloat(d.fullness) || 0) / 100;
  const faceArea = h * w;
  const fabricArea = faceArea * (1 + fullness);
  return { faceArea, fabricArea, width: w };
}

/** Positive integer quantity (min 1). */
export function curtainQty(d: CurtainSpec): number {
  return Math.max(1, parseInt(d.qty, 10) || 0);
}

/**
 * Customer-facing price for ONE curtain, from its fabric's SELL price/sq ft
 * only (#227 flat model: making is inside the rate). Equals the server's
 * authoritative curtainCost().priceEach when `pricePerSqft` is passed at full
 * precision (it is — see the estimate page):
 *
 *   sewnArea × (rate ÷ (1 − m)) = (sewnArea × rate) ÷ (1 − m) = rawCost ÷ (1 − m)
 *
 * rounded once. That is the cent-match.
 */
export function curtainPriceEach(d: CurtainSpec, pricePerSqft: number): number {
  const h = parseFloat(d.height) || 0;
  const w = parseFloat(d.width) || 0;
  const fullness = parseFloat(d.fullness) || 0;
  const sewnWidth = w * (1 + fullness / 100);
  const sewnArea = sewnWidth * h;
  if (sewnArea <= 0) return 0;
  return round2(sewnArea * (pricePerSqft || 0));
}
```

### Step 6: Budget-side mirrors

- [ ] `src/lib/design/equipment-pricing.ts`. Replace line 8
```ts
 * Cost-bearing (unit costs, curtain making rates): server code and the Quick
```
with
```ts
 * Cost-bearing (unit costs, curtain area rates): server code and the Quick
```
replace
```ts
import { curtainCost, makingRateFor } from "./curtain-pricing";
```
with
```ts
import { curtainCost } from "./curtain-pricing";
```
and replace
```ts
/** One drape's make-it cost at a fabric's area rate — the shared two-term model (curtain-pricing.ts). */
export function drapeUnitCost(drape: DrapeGeom, areaRate: number): number {
  return Math.round(
    curtainCost(
      { finishedWidthFt: drape.w, finishedHeightFt: drape.h, fullnessPct: drape.fullness, qty: drape.qty },
      { fabricRate: areaRate, makingRate: makingRateFor(drape.fullness) }
    ).costTotal
  );
}
```
with
```ts
/** One drape's make-it cost at a fabric's flat $/sq ft sewn (making included, #227) — the shared model (curtain-pricing.ts). */
export function drapeUnitCost(drape: DrapeGeom, areaRate: number): number {
  return Math.round(
    curtainCost(
      { finishedWidthFt: drape.w, finishedHeightFt: drape.h, fullnessPct: drape.fullness, qty: drape.qty },
      { fabricRate: areaRate }
    ).costTotal
  );
}
```

- [ ] `src/lib/design/equipment-map.ts`. Replace the header lines
```ts
 *  - fabric rows (curtains) → the mapped Fabric part's area rate
 *                (curtainAreaRate, else costPerSqft) — the per-drape cost is
 *                computed from the venue geometry in equipment-pricing.ts.
 *                No SEED_FABRIC_RATES fallback.
```
with
```ts
 *  - fabric rows (curtains) → the mapped Fabric part's flat $/sq ft sewn
 *                (making included), read through fabricAreaRateOf — the one
 *                chain every curtain path uses, seed rates included (#227,
 *                reverses the #211 no-seed rule). The per-drape cost is
 *                computed from the venue geometry in equipment-pricing.ts.
```
add after `import { fixtureSkus, resolveFixture, type FixtureCatalogPart, type FixtureRecord } from "@/lib/fixture-assemblies";`
```ts
import { fabricAreaRateOf } from "./curtain-pricing";
```
and replace (about line 219)
```ts
      const rate = p.category === "Fabric" ? Number(p.curtainAreaRate ?? p.costPerSqft ?? 0) : 0;
```
with
```ts
      const rate = p.category === "Fabric" ? fabricAreaRateOf(p) : 0;
```

- [ ] `src/lib/design/grid-curtains.ts`. Replace the whole file with:
```ts
/**
 * The Grid - curtain pricing bridge (punch #49). SERVER ONLY.
 *
 * Jeff: "Curtains getting added: This should be treated as the usual types,
 * Borders, Draws, Fulls, Legs. Then when you drop it in you specify the Width,
 * Height, Fullness, Name, and Fabric Type. Similar to our curtain builder for
 * estimates." His answer on what a Grid curtain IS: a priced line, like the
 * estimator - so it reuses the pricing already in use rather than growing a
 * fourth one.
 *
 * This module imports @/lib/curtain-pricing, which holds the margin, so it
 * must never reach a client component. The editor's live preview instead runs
 * @/lib/curtain-geom over the sell price/sq ft this file's caller precomputes
 * (fabricSellPerSqft), which matches this module's priceEach to the cent by
 * construction.
 */

import { curtainCost as curtainSell } from "@/lib/curtain-pricing";
import { fabricAreaRateOf } from "./curtain-pricing";
import { curtainSpecOf, type GridCurtain } from "./grid-bom";

/** The catalog slice a fabric row contributes. */
export type FabricRow = {
  id: string;
  sku: string;
  desc: string;
  category: string;
  curtainAreaRate?: number;
  costPerSqft?: number;
};

/** Rows the curtain picker offers - the estimator's rule, verbatim. */
export function isFabricRow(p: { category: string }): boolean {
  return p.category === "Fabric";
}

export type CurtainPrice = { costEach: number; priceEach: number };

/**
 * Authoritative price for every curtain placement in a design, keyed by
 * PLACEMENT id (each drop is its own line - two drapes of one fabric are
 * different goods the moment their dimensions differ). The fabric's rate comes
 * from fabricAreaRateOf (#227), the chain the estimator and portal also use.
 *
 * A curtain whose fabric has left the catalog is NOT dropped: it prices at a
 * zero area rate, which surfaces it as a $0 line the human has to deal with,
 * the same treatment bomLines gives a removed part.
 */
export function priceGridCurtains(
  placements: Array<{ id: string; curtain?: GridCurtain | null }>,
  catalog: FabricRow[],
  margin?: number
): Map<string, CurtainPrice> {
  const fabricById = new Map(catalog.filter(isFabricRow).map((p) => [p.id, p]));
  const out = new Map<string, CurtainPrice>();
  for (const pl of placements) {
    if (!pl.curtain) continue;
    const rate = fabricAreaRateOf(fabricById.get(pl.curtain.fabricSku));
    out.set(pl.id, curtainSell(curtainSpecOf(pl.curtain), rate, margin));
  }
  return out;
}
```

- [ ] `src/lib/design/auto-estimate.ts`. Add after `import { applyEquipment } from "./equipment-pricing";`:
```ts
import { fabricAreaRateOf } from "./curtain-pricing";
```
and replace the whole `curtainSwapHits` doc comment and function (the comment starting `* A curtain row's swap candidates (I2): a Fabric part is a candidate only`) with:
```ts
/**
 * A curtain row's swap candidates (I2): a Fabric part is a candidate only
 * when fabricAreaRateOf (#227 — the catalog rate, a seed, or cost per sq ft)
 * gives it a positive rate. A list-less, cost-less fabric priced only by area
 * rate (the normal case) is still findable, and nothing here is ever an
 * assembly (a curtain row maps to a Fabric part, never a System). The area
 * rate is a COST basis, so it is shown as a per-sq-ft SELL through the
 * catalog margin (the same list-less rule the Equipment map prices a fabric
 * row with) — the client never sees the raw cost rate.
 */
export function curtainSwapHits(
  parts: ReadonlyArray<{ sku: string; desc: string; curtainAreaRate?: number; costPerSqft?: number }>,
  margin: number
): AutoEquipHit[] {
  return parts.flatMap((p): AutoEquipHit[] => {
    const rate = fabricAreaRateOf(p);
    return rate > 0 ? [{ kind: "part", ref: p.sku, desc: p.desc, unit: "sq ft", unitSell: sellFromCost(rate, margin) }] : [];
  });
}
```

- [ ] `src/app/(app)/design/grid/[id]/actions.ts` (about line 195). Replace
```ts
    return { hits: curtainSwapHits(hits.map((h) => ({ sku: h.sku, desc: h.desc, curtainAreaRate: bySku.get(h.sku)?.curtainAreaRate })), rates.defaultMargin) };
```
with
```ts
    return { hits: curtainSwapHits(hits.map((h) => ({ sku: h.sku, desc: h.desc, curtainAreaRate: bySku.get(h.sku)?.curtainAreaRate, costPerSqft: bySku.get(h.sku)?.costPerSqft })), rates.defaultMargin) };
```

- [ ] `src/app/(app)/design/quick/engine.ts` (about line 529). Replace
```ts
  // (finished width/height, fullness, panels) so equipment-pricing.ts costs
  // each one from the mapped fabric's area rate + making; qty per depth block.
```
with
```ts
  // (finished width/height, fullness, panels) so equipment-pricing.ts costs
  // each one from the mapped fabric's flat $/sq ft sewn (#227); qty per depth block.
```

- [ ] `src/lib/stores/catalog.ts` (about lines 89–92). Replace
```ts
  /** Curtain make-it-ourselves area cost, $/ft² of sewn fabric. Fabric rows
   *  only. Seeded ~10% above the Rose-Brand-reconciled rate; edit toward real
   *  shop cost when the curtain shop exists. Distinct from raw costPerSqft. */
```
with
```ts
  /** Curtain cost, $/ft² of SEWN fabric INCLUDING making/sewing (#227 — the
   *  one flat rate; no separate making charge). Fabric rows only. Edited in
   *  the catalog part editor or imported as "Fabric $/sq ft"; read only
   *  through fabricAreaRateOf. Distinct from raw costPerSqft. */
```

### Step 7: Quote-side mirrors

- [ ] `src/app/(app)/estimator/pricing.ts`. Replace line 1
```ts
import { curtainCost, curtainPrice, makingRateFor, SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
```
with
```ts
import { curtainCost, curtainPrice, fabricAreaRateOf } from "@/lib/design/curtain-pricing";
```
Then replace the block from `/**\n * CURTAIN PRICING — two-term make-it model` through the end of `computeCurtain` (about lines 229–264, ending `    priceEach: curtainPrice(cc.costEach, margin),\n  };\n}`) with:
```ts
/**
 * CURTAIN PRICING — flat $/sq ft of sewn fabric, making included (#227),
 * shared with the budget side (src/lib/design/curtain-pricing.ts). The rate
 * comes from fabricAreaRateOf, the one chain every curtain path reads. A
 * per-line Rose Brand vendor cost overrides the computed make-it cost when set.
 */
export function computeCurtain(
  d: CurtainDraft,
  fabrics: FabricOpt[],
  /** Margin-on-price fraction; the customer tier stamp seeds this (item 11,
   *  D87) — 0.30 is Peak's flat curtain margin, the no-tier default. */
  margin: number = 0.3
): CurtainCalc {
  const fab =
    fabrics.find((f) => f.sku === d.fabric) ||
    fabrics[0] ||
    ({ sku: "", name: "", costPerSqft: 0 } as FabricOpt);
  const h = parseFloat(d.height) || 0; // finished height (ft)
  const w = parseFloat(d.width) || 0; // finished width (ft)
  const fullness = parseFloat(d.fullness) || 0; // percent, e.g. 50
  const override =
    d.vendorCostOverride != null && d.vendorCostOverride !== "" ? parseFloat(d.vendorCostOverride) : null;
  const cc = curtainCost(
    { finishedWidthFt: w, finishedHeightFt: h, fullnessPct: fullness, qty: 1, vendorCostOverride: override },
    { fabricRate: fabricAreaRateOf(fab) }
  );
  return {
    fab,
    faceArea: h * w,
    fabricArea: cc.sewnAreaSqft,
    costEach: cc.costEach,
    priceEach: curtainPrice(cc.costEach, margin),
  };
}
```

- [ ] `src/app/(app)/estimator/page.tsx`. Add after `import { listFixtures } from "@/lib/stores/fixtures";`:
```ts
import { fabricAreaRateOf } from "@/lib/design/curtain-pricing";
```
and replace
```ts
  // Only catalog fabrics with a real per-sq-ft basis feed the curtain
  // configurator — imported vendor fabric rows (priced per unit, no costPerSqft)
  // would otherwise show up as $0/sq ft options.
  const fabrics = fabricRows
    .filter((p) => (p.costPerSqft ?? 0) > 0)
    .map((p) => ({
      sku: p.sku,
      name: p.desc,
      costPerSqft: p.costPerSqft ?? 0,
      curtainAreaRate: p.curtainAreaRate,
    }));
```
with
```ts
  // Only catalog fabrics with a $/sq ft rate feed the curtain configurator
  // (#227: fabricAreaRateOf — the catalog rate, a seed, or cost per sq ft).
  // Imported per-unit fabric rows with no rate would otherwise show up as
  // $0/sq ft options. curtainAreaRate carries the RESOLVED rate, so the
  // modal's label and computeCurtain read the same number.
  const fabrics = fabricRows
    .map((p) => ({
      sku: p.sku,
      name: p.desc,
      costPerSqft: p.costPerSqft ?? 0,
      curtainAreaRate: fabricAreaRateOf(p),
    }))
    .filter((f) => f.curtainAreaRate > 0);
```

- [ ] `src/app/portal/actions.ts`. Replace
```ts
import { SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
```
with
```ts
import { fabricAreaRateOf } from "@/lib/design/curtain-pricing";
```
replace `  // Fabric cost basis — server-side only. Map sku → { costPerSqft, desc }.` with `  // Fabric cost basis — server-side only. Map sku → catalog row; its rate comes from fabricAreaRateOf (#227).`, and replace
```ts
    const rate = fab.curtainAreaRate ?? SEED_FABRIC_RATES[fab.sku] ?? fab.costPerSqft ?? 0;
```
with
```ts
    const rate = fabricAreaRateOf(fab);
```

- [ ] `src/app/portal/estimate/page.tsx`. Replace
```ts
import { fabricSellPerSqft, sellCoeffs } from "@/lib/curtain-pricing";
import { SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
```
with
```ts
import { fabricSellPerSqft } from "@/lib/curtain-pricing";
import { fabricAreaRateOf } from "@/lib/design/curtain-pricing";
```
replace ` * (costPerSqft ÷ (1 − margin)). Peak's cost basis and margin never leave the` with ` * (the fabric's $/sq ft ÷ (1 − margin)). Peak's cost basis and margin never leave the`, then replace
```ts
  // Cost basis → customer sell price/sq ft. costPerSqft NEVER leaves the server;
  // sell numbers ship at full precision so the preview equals the stored quote.
  // Only fabrics with a real per-sq-ft basis are offered — imported vendor
  // fabric rows (per-unit pricing, no costPerSqft) are excluded so the customer
  // never sees a $0/sq ft option.
  const fabrics: FabricSell[] = fabricRows
    .filter((p) => (p.costPerSqft ?? 0) > 0)
    .map((p) => ({
      sku: p.sku,
      name: p.desc,
      pricePerSqft: fabricSellPerSqft(p.curtainAreaRate ?? SEED_FABRIC_RATES[p.sku] ?? p.costPerSqft ?? 0, tier.margin),
    }));
  const coeffs = sellCoeffs(tier.margin);
```
with
```ts
  // Cost basis → customer sell price/sq ft. The cost rate NEVER leaves the
  // server; sell numbers ship at full precision so the preview equals the
  // stored quote. Only fabrics with a $/sq ft rate (fabricAreaRateOf, #227)
  // are offered, so the customer never sees a $0/sq ft option.
  const fabrics: FabricSell[] = fabricRows
    .map((p) => ({ p, rate: fabricAreaRateOf(p) }))
    .filter((x) => x.rate > 0)
    .map(({ p, rate }) => ({
      sku: p.sku,
      name: p.desc,
      pricePerSqft: fabricSellPerSqft(rate, tier.margin),
    }));
```
and delete the line `        coeffs={coeffs}` from the `<EstimateBuilder … />` props.

- [ ] `src/app/portal/estimate/estimate-builder.tsx`. Replace
```ts
import {
  curtainPriceEach,
  curtainQty,
  type CurtainSpec,
  type FabricSell,
  type SellCoeffs,
} from "@/lib/curtain-geom";
```
with
```ts
import {
  curtainPriceEach,
  curtainQty,
  type CurtainSpec,
  type FabricSell,
} from "@/lib/curtain-geom";
```
replace `  companyName, venues, fabrics, coeffs, equipment, initialTab = "drapery",` with `  companyName, venues, fabrics, equipment, initialTab = "drapery",`, delete the line `  coeffs: SellCoeffs;`, and replace
```ts
  const priceEach = (l: CurtainSpec) => curtainPriceEach(l, priceOf(l.fabric), coeffs);
```
with
```ts
  const priceEach = (l: CurtainSpec) => curtainPriceEach(l, priceOf(l.fabric));
```

- [ ] `src/app/(app)/design/grid/[id]/page.tsx`. Replace
```ts
import { fabricSellPerSqft, sellCoeffs } from "@/lib/curtain-pricing";
```
with
```ts
import { fabricSellPerSqft } from "@/lib/curtain-pricing";
import { fabricAreaRateOf } from "@/lib/design/curtain-pricing";
```
replace `import { fabricAreaRate, isFabricRow } from "@/lib/design/grid-curtains";` with `import { isFabricRow } from "@/lib/design/grid-curtains";`. In the curtain comment block, replace `   * the editor's live price preview. These are SELL numbers only - the margin` through `   * both run the same two-term model at the same tier margin.` with:
```ts
   * the editor's live price preview. These are SELL numbers only - the margin
   * and the cost basis stay on the server (lib/design/curtain-pricing is never
   * imported by the editor). The preview matches the quote to the cent because
   * both run the same flat $/sq ft model (#227) at the same tier margin.
```
(Read the block first and keep its first line, `   * Curtain drop-in (punch #49): the fabric list and the sell coefficients for`, but change that line to `   * Curtain drop-in (punch #49): the fabric list with its sell price/sq ft for`.) Replace `      pricePerSqft: fabricSellPerSqft(fabricAreaRate(p), tier.margin),` with `      pricePerSqft: fabricSellPerSqft(fabricAreaRateOf(p), tier.margin),`. Delete the line `  const curtainCoeffs = sellCoeffs(tier.margin);` and the blank line before it. Delete the prop line `      curtainCoeffs={curtainCoeffs}`.

- [ ] `src/app/(app)/design/grid/[id]/editor.tsx`. Make these edits:
  - `import { curtainPriceEach, type FabricSell, type SellCoeffs } from "@/lib/curtain-geom";` → `import { curtainPriceEach, type FabricSell } from "@/lib/curtain-geom";`
  - In the props destructuring, delete the line `  curtainCoeffs,` (landmark: it sits between `  auto,` and `  laborParts,`).
  - In the props type, delete these two lines:
    ```ts
      /** Sell-side making coefficients for the live curtain price (punch #49). */
      curtainCoeffs: SellCoeffs;
    ```
  - `        curtainPriceEach(curtainSpecOf(pl.curtain), fabric?.pricePerSqft || 0, curtainCoeffs)` → `        curtainPriceEach(curtainSpecOf(pl.curtain), fabric?.pricePerSqft || 0)`
  - `  }, [placements, fabricBySku, curtainCoeffs]);` → `  }, [placements, fabricBySku]);`
  - Delete the JSX prop line `                    coeffs={curtainCoeffs}` inside `<CurtainDrop`.

- [ ] `src/app/(app)/design/grid/[id]/curtain-drop.tsx`. Make these edits:
  - `import { curtainPriceEach, type FabricSell, type SellCoeffs } from "@/lib/curtain-geom";` → `import { curtainPriceEach, type FabricSell } from "@/lib/curtain-geom";`
  - ` * the two agree to the cent because they run the same two-term model.` → ` * the two agree to the cent because they run the same flat $/sq ft model (#227).`
  - In the destructuring, delete `  coeffs,` (between `  fabrics,` and `  busy,`). In the prop type, delete `  coeffs: SellCoeffs;`.
  - `  const price = curtainPriceEach(curtainSpecOf(draft), fabric?.pricePerSqft || 0, coeffs);` → `  const price = curtainPriceEach(curtainSpecOf(draft), fabric?.pricePerSqft || 0);`

- [ ] **Step 8: Check nothing still references the removed symbols**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
grep -rn -E "makingRate|MAKING_RATE|sellCoeffs|SellCoeffs|curtainCoeffs|makingPerFt|fabricAreaRate\(" src scripts/test-review-and-spec.ts
grep -rn -E "curtainAreaRate \?\?|SEED_FABRIC_RATES\[" src | grep -v "src/lib/design/curtain-pricing.ts"
```
Expected: no output from either. (`src/lib/design/equipment-legacy-hints.ts` says "plus making" in *historic* "was …" hint text. That is intentionally left alone.)

- [ ] **Step 9: Gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npx tsc --noEmit 2>&1 | grep -c "error TS"          # 0
npm run test:specs 2>&1 | tee /tmp/claude-227-t1.txt | grep -E '^FAIL|ALL PASSED|FAILED'
grep -c '^PASS ' /tmp/claude-227-t1.txt
npx eslint src/lib/design/curtain-pricing.ts src/lib/curtain-pricing.ts src/lib/curtain-geom.ts src/lib/design/equipment-pricing.ts src/lib/design/equipment-map.ts src/lib/design/grid-curtains.ts src/lib/design/auto-estimate.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/curtain-drop.tsx" "src/app/(app)/design/quick/engine.ts" src/lib/stores/catalog.ts "src/app/(app)/estimator/pricing.ts" "src/app/(app)/estimator/page.tsx" src/app/portal/actions.ts src/app/portal/estimate/page.tsx src/app/portal/estimate/estimate-builder.tsx scripts/test-review-and-spec.ts
npx next build 2>&1 | tail -15
```
Expected: 0 tsc errors; `ALL PASSED`; the PASS count should be about `BASE` − 2 (1b: 12 old checks → 9 new; 1c: 1 → 2) + 57 (EOF block: 3 formula + 6 chain + 16 parity + 3 map/swap + 29 source guards over 15 files, the chain guard skipping the shared module), so roughly `BASE + 55`. Report the real number. eslint: 0 errors. next build: `✓ Compiled`, no type errors.

- [ ] **Step 10: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
git status --short scripts/test-review-and-spec.ts   # only your hunks — else stop and ask
git add src/lib/design/curtain-pricing.ts src/lib/curtain-pricing.ts src/lib/curtain-geom.ts src/lib/design/equipment-pricing.ts src/lib/design/equipment-map.ts src/lib/design/grid-curtains.ts src/lib/design/auto-estimate.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/curtain-drop.tsx" "src/app/(app)/design/quick/engine.ts" src/lib/stores/catalog.ts "src/app/(app)/estimator/pricing.ts" "src/app/(app)/estimator/page.tsx" src/app/portal/actions.ts src/app/portal/estimate/page.tsx src/app/portal/estimate/estimate-builder.tsx scripts/test-review-and-spec.ts
git commit -m "feat(pricing): fabric prices by one flat \$/sq ft sewn through fabricAreaRateOf (#227)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Catalog editor $/sq ft field + converter; Import hub and price-book columns

**Files:** Create `src/app/(app)/catalog/fabric-rate-field.tsx`. Modify `src/lib/curtain-geom.ts`, `src/app/(app)/catalog/{page.tsx,part-form.ts,parse.ts,import.ts}`, `src/app/(app)/import/{types.ts,registry.ts}`, `scripts/test-review-and-spec.ts`.

**Interfaces (produced):**
```ts
// src/lib/curtain-geom.ts (client-safe)
export const FABRIC_RATE_UNIT = "sq ft sewn (incl. making)";
export const NO_FABRIC_RATE = "No $/sq ft set";
export function sqftRateFromLinearYard(perLinYd: number, boltWidthIn: number): number; // ÷ (3 × in ÷ 12), 0 when missing
export function sqftRateFromSquareYard(perSqYd: number): number;                       // ÷ 9
// src/app/(app)/catalog/part-form.ts
export type OptionalPartFields = { manufacturerPartNumber?: string; manufacturerModelNumber?: string; mapPrice?: number; curtainAreaRate?: number; boltWidthIn?: number };
// src/app/(app)/catalog/parse.ts
export function fabricFieldsOf(r: Pick<CatalogRow, "curtainAreaRate" | "boltWidthIn">): { curtainAreaRate?: number; boltWidthIn?: number };
```

- [ ] **Step 1: Write the failing tests.** Append to the **end** of `scripts/test-review-and-spec.ts`:
```ts

/* ====== #227 T2: fabric $/sq ft — part form, converter, Import hub + price-book columns ====== */
import { fabricFieldsOf as fab227Fields, parseCatalog as fab227ParseBook } from "@/app/(app)/catalog/parse";
import { sqftRateFromLinearYard as fab227FromLinYd, sqftRateFromSquareYard as fab227FromSqYd } from "@/lib/curtain-geom";
{
  // Converter: a 54″ velour yard is 3 ft × 4.5 ft = 13.5 sq ft.
  ok(fab227FromLinYd(40.5, 54) === 3, "#227 converter: $40.50/lin-yd of 54″ velour → $3/sq ft (÷ 13.5)");
  ok(fab227FromLinYd(27, 54) === 2 && fab227FromLinYd(30, 120) === 1, "#227 converter: $/lin-yd ÷ (3 × bolt in ÷ 12) at any bolt width");
  ok(fab227FromLinYd(40.5, 0) === 0 && fab227FromLinYd(0, 54) === 0 && fab227FromLinYd(Number.NaN, 54) === 0, "#227 converter: a missing price or bolt width converts to 0, never NaN/Infinity");
  ok(fab227FromSqYd(9) === 1 && fab227FromSqYd(13.5) === 1.5 && fab227FromSqYd(0) === 0, "#227 converter: $/sq yd ÷ 9");

  // Part form: submitted-only, blank clears.
  const fd = new FormData();
  fd.set("sku", "FAB227");
  const none = optionalPartFields(fd);
  ok(!("curtainAreaRate" in none) && !("boltWidthIn" in none), "#227 part form: a form without the fabric fields leaves the stored rate alone");
  fd.set("curtainAreaRate", " $4.85 ");
  fd.set("boltWidthIn", "54");
  const set = optionalPartFields(fd);
  ok(set.curtainAreaRate === 4.85 && set.boltWidthIn === 54, "#227 part form: a typed $/sq ft and bolt width save");
  fd.set("curtainAreaRate", "");
  fd.set("boltWidthIn", "-3");
  const cleared = optionalPartFields(fd);
  ok("curtainAreaRate" in cleared && cleared.curtainAreaRate === undefined && "boltWidthIn" in cleared && cleared.boltWidthIn === undefined, "#227 part form: a blanked or non-positive value clears it (the part falls back to seed / cost per sq ft)");

  // Import hub: exact-header-only number columns; price-only rows carry no fabric key.
  const hubCat = getTypeMeta("catalog")!;
  const rateField = hubCat.fields.find((f) => f.key === "curtainAreaRate");
  const boltField = hubCat.fields.find((f) => f.key === "boltWidthIn");
  ok(rateField?.header === "Fabric $/sq ft" && rateField.kind === "number" && rateField.exactOnly === true && boltField?.header === "Bolt width (in)" && boltField.kind === "number" && boltField.exactOnly === true, "#227 Import hub: Fabric $/sq ft and Bolt width (in) are exact-header-only number columns");
  const hubValues = (headers: string[], row: string[]) => prepareRows([row], autoMap(headers, hubCat.fields), hubCat.fields).rows[0].values;
  const withRate = hubValues(["SKU", "Description", "Manufacturer", "Fabric $/sq ft", "Bolt width (in)"], ["FAB227-V", "Velour", "Rose Brand", "4.85", "54"]);
  const created = catalogPatch(withRate, null, "FAB227-V");
  ok(created.curtainAreaRate === 4.85 && created.boltWidthIn === 54, "#227 Import hub: the fabric columns land on curtainAreaRate / boltWidthIn");
  const stored227 = { sku: "FAB227-V", desc: "Velour", category: "Fabric", unit: "sq ft", list: 0, cost: 0, mfr: "Rose Brand", curtainAreaRate: 4.85, boltWidthIn: 54 };
  const priceOnly = catalogPatch(hubValues(["SKU", "Description", "Manufacturer", "List Price"], ["FAB227-V", "Velour", "Rose Brand", "12"]), stored227, "FAB227-V");
  ok(!("curtainAreaRate" in priceOnly) && !("boltWidthIn" in priceOnly), "#227 Import hub: a price-only row carries no fabric key, so mergeUpsert keeps the stored rate");
  const blankRate = catalogPatch(hubValues(["SKU", "Description", "Manufacturer", "Fabric $/sq ft"], ["FAB227-V", "Velour", "Rose Brand", ""]), stored227, "FAB227-V");
  ok(!("curtainAreaRate" in blankRate), "#227 Import hub: a blank Fabric $/sq ft cell never clears the stored rate");
  const lookalike = autoMap(["SKU", "Description", "Price per sq ft", "Width"], hubCat.fields);
  ok(lookalike.curtainAreaRate === -1 && lookalike.boltWidthIn === -1, "#227 Import hub: a vendor's look-alike columns never map to the fabric fields");
  ok(importTemplateCsv("catalog").split("\n")[0].includes("Fabric $/sq ft,Bolt width (in)"), "#227 Import hub: the catalog template advertises both columns");

  // Price-book importer: header-only columns, only positive values written.
  const book = fab227ParseBook("SKU,Description,Fabric $/sq ft,Bolt width (in)\nFAB227-V,Velour,4.85,54\n");
  ok(book.ok && book.rows[0].curtainAreaRate === 4.85 && book.rows[0].boltWidthIn === 54, "#227 price book: the fabric headers parse");
  const wrote = fab227Fields(book.rows[0]);
  ok(wrote.curtainAreaRate === 4.85 && wrote.boltWidthIn === 54, "#227 price book: a carried rate and bolt width are written");
  ok(Object.keys(fab227Fields(fab227ParseBook("SKU,Description,List Price\nFAB227-V,Velour,12\n").rows[0])).length === 0, "#227 price book: a price-only file writes no fabric key — the stored rate survives the re-import");
  ok(Object.keys(fab227Fields(fab227ParseBook("FAB227-V,Velour,Fabric,sq ft,12,8,Rose Brand,,,,,,,,,,,,4.85,54\n").rows[0])).length === 0, "#227 price book: the fabric columns are header-only — no positional slot");
  const importSrc227 = readFileSync(join(process.cwd(), "src/app/(app)/catalog/import.ts"), "utf8");
  ok(importSrc227.includes("...fabricFieldsOf(r),"), "#227 price book: runCatalogImport spreads fabricFieldsOf into the mergeUpsert patch");

  // Catalog editor: client field, Fabric parts only, no store/cost import.
  const frf = readFileSync(join(process.cwd(), "src/app/(app)/catalog/fabric-rate-field.tsx"), "utf8");
  ok(frf.startsWith('"use client"') && !/from "@\/lib\/stores\/|from "@\/db|curtain-pricing"/.test(frf), "#227 catalog editor: the rate field is a client component importing no store or cost module");
  ok(frf.includes('name="curtainAreaRate"') && frf.includes('name="boltWidthIn"') && frf.includes("$/sq ft sewn (includes making)"), "#227 catalog editor: it posts curtainAreaRate + boltWidthIn under the spec's label");
  const catPage227 = readFileSync(join(process.cwd(), "src/app/(app)/catalog/page.tsx"), "utf8");
  ok(catPage227.includes('part?.category === "Fabric" && (') && catPage227.includes("<FabricRateField"), "#227 catalog editor: only Fabric parts show the $/sq ft field");
}
```

- [ ] **Step 2: Run tsc and watch it fail**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npx tsc --noEmit 2>&1 | grep "error TS" | head
```
Expected: `fabricFieldsOf`, `sqftRateFromLinearYard`, `sqftRateFromSquareYard` are missing, and `curtainAreaRate` is not on the part-form return type.

- [ ] **Step 3: Converter + label constants.** Append to `src/lib/curtain-geom.ts`:
```ts

/* ---------- #227: fabric rate labels + converter (client-safe, no cost basis) ---------- */

/** The unit a fabric's flat rate is quoted in — making is inside it. */
export const FABRIC_RATE_UNIT = "sq ft sewn (incl. making)";
/** What a fabric with no rate shows; it prices curtains at $0. */
export const NO_FABRIC_RATE = "No $/sq ft set";

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * $/linear yard at a bolt width (inches) → $/sq ft. A linear yard of an N″
 * bolt is 3 ft × N/12 ft, so a 54″ velour yard is 13.5 sq ft. 0 when either
 * input is missing, zero or not a number.
 */
export function sqftRateFromLinearYard(perLinYd: number, boltWidthIn: number): number {
  if (!(perLinYd > 0) || !(boltWidthIn > 0)) return 0;
  return round4(perLinYd / ((3 * boltWidthIn) / 12));
}

/** $/sq yard → $/sq ft (÷ 9). 0 when missing. */
export function sqftRateFromSquareYard(perSqYd: number): number {
  return perSqYd > 0 ? round4(perSqYd / 9) : 0;
}
```

- [ ] **Step 4: Part form.** In `src/app/(app)/catalog/part-form.ts`, replace the whole `optionalPartFields` doc comment and function (from `/**\n * Fields the part modal may or may not render.` through its closing `}`) with:
```ts
/** A positive, finite number, else undefined — a blank, zero, negative or junk
 *  value clears the field (#227). */
function positive(v: FormDataEntryValue | null): number | undefined {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export type OptionalPartFields = {
  manufacturerPartNumber?: string;
  manufacturerModelNumber?: string;
  mapPrice?: number;
  /** #227 — Fabric parts only: $/sq ft of sewn fabric, making included. */
  curtainAreaRate?: number;
  /** #227 — Fabric parts only: bolt width in inches. */
  boltWidthIn?: number;
};

/**
 * Fields the part modal may or may not render. A key the form did NOT submit
 * stays out of the patch, so mergeUpsert keeps the stored value; a submitted
 * blank clears it (an explicit undefined wins in mergeUpsert). Same rule
 * upsertPart already applies to `ports`. The two fabric fields render only on
 * a Fabric part (#227), so any other part's save never touches them.
 */
export function optionalPartFields(fd: FormData): OptionalPartFields {
  const text = (k: string) => String(fd.get(k) || "").trim() || undefined;
  const out: OptionalPartFields = {};
  if (fd.has("manufacturerPartNumber")) out.manufacturerPartNumber = text("manufacturerPartNumber");
  if (fd.has("manufacturerModelNumber")) out.manufacturerModelNumber = text("manufacturerModelNumber");
  if (fd.has("mapPrice")) out.mapPrice = num(fd.get("mapPrice"));
  if (fd.has("curtainAreaRate")) out.curtainAreaRate = positive(fd.get("curtainAreaRate"));
  if (fd.has("boltWidthIn")) out.boltWidthIn = positive(fd.get("boltWidthIn"));
  return out;
}
```
(`upsertPart` in `actions.ts` already spreads `...optionalPartFields(formData)` into `mergeUpsert` behind `requireUser()`, so it needs no change.)

- [ ] **Step 5: The client field.** Create `src/app/(app)/catalog/fabric-rate-field.tsx`:
```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { FABRIC_RATE_UNIT, NO_FABRIC_RATE, sqftRateFromLinearYard, sqftRateFromSquareYard } from "@/lib/curtain-geom";

/**
 * #227 — a Fabric part's one curtain rate: cost per sq ft of SEWN fabric,
 * making / sewing included (no separate making charge anywhere). Lives inside
 * `<form action={upsertPart}>`: only the two named inputs (curtainAreaRate,
 * boltWidthIn) post with the form. The converter inputs carry no `name` and
 * its buttons are type="button", so nothing else reaches upsertPart.
 */

const LBL: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".05em",
  marginBottom: 5,
};
const HELP: CSSProperties = { fontSize: 11, color: "#aab0bb", marginTop: 4 };
const BTN: CSSProperties = {
  fontSize: 12,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e4e7ec",
  background: "#f7f8fa",
  color: "#16181d",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function asText(n: number | null): string {
  return n != null && n > 0 ? String(n) : "";
}

export default function FabricRateField({
  initialRate,
  initialBoltWidthIn,
  fallbackRate,
  inputStyle,
}: {
  /** The part's own curtainAreaRate, or null. */
  initialRate: number | null;
  initialBoltWidthIn: number | null;
  /** What the part prices at with the field blank (seed, else cost per sq ft); 0 = none. */
  fallbackRate: number;
  inputStyle: CSSProperties;
}) {
  const [rate, setRate] = useState(asText(initialRate));
  const [bolt, setBolt] = useState(asText(initialBoltWidthIn));
  const [perLinYd, setPerLinYd] = useState("");
  const [perSqYd, setPerSqYd] = useState("");
  const linYdRate = sqftRateFromLinearYard(parseFloat(perLinYd), parseFloat(bolt));
  const sqYdRate = sqftRateFromSquareYard(parseFloat(perSqYd));
  const typed = parseFloat(rate);
  const status =
    typed > 0
      ? null
      : fallbackRate > 0
        ? `Blank — prices at $${fallbackRate.toFixed(2)}/${FABRIC_RATE_UNIT} (seed / cost per sq ft).`
        : `${NO_FABRIC_RATE} — curtains in this fabric price at $0.`;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={LBL}>$/sq ft sewn (includes making)</div>
          <input
            name="curtainAreaRate"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            placeholder={fallbackRate > 0 ? fallbackRate.toFixed(2) : "4.85"}
            style={inputStyle}
          />
        </div>
        <div>
          <div style={LBL}>Bolt width (in)</div>
          <input
            name="boltWidthIn"
            value={bolt}
            onChange={(e) => setBolt(e.target.value)}
            inputMode="decimal"
            placeholder="54"
            style={inputStyle}
          />
        </div>
      </div>
      <div style={HELP}>
        Cost per sq ft of sewn fabric (finished width × (1 + fullness) × height), including making and sewing —
        there is no separate making charge. Sell = cost ÷ (1 − margin).
      </div>
      {status && <div style={{ ...HELP, color: "#8a6d1f" }}>{status}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 10, alignItems: "center" }}>
        <input
          value={perLinYd}
          onChange={(e) => setPerLinYd(e.target.value)}
          inputMode="decimal"
          placeholder="$ per linear yard"
          aria-label="Price per linear yard"
          style={inputStyle}
        />
        <button type="button" disabled={!(linYdRate > 0)} onClick={() => setRate(String(linYdRate))} style={BTN}>
          {linYdRate > 0 ? `Use $${linYdRate.toFixed(2)}/sq ft` : "Use"}
        </button>
        <input
          value={perSqYd}
          onChange={(e) => setPerSqYd(e.target.value)}
          inputMode="decimal"
          placeholder="$ per square yard"
          aria-label="Price per square yard"
          style={inputStyle}
        />
        <button type="button" disabled={!(sqYdRate > 0)} onClick={() => setRate(String(sqYdRate))} style={BTN}>
          {sqYdRate > 0 ? `Use $${sqYdRate.toFixed(2)}/sq ft` : "Use"}
        </button>
      </div>
      <div style={HELP}>
        Converter: $/linear yard ÷ (3 × bolt width ÷ 12) — a 54″ bolt is 13.5 sq ft per yard; $/sq yard ÷ 9. A
        converted fabric price is fabric only — add making before saving.
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Render it for Fabric parts.** In `src/app/(app)/catalog/page.tsx`, add after `import PartDocumentsSection from "./part-documents-section";`:
```ts
import FabricRateField from "./fabric-rate-field";
import { fabricAreaRateOf } from "@/lib/design/curtain-pricing";
```
Then insert, between the closing `</div>` of the MFR P/N / MFR M/N grid (landmark: right after the `name="manufacturerModelNumber"` input's `</div>\n            </div>`) and the `<div style={{ marginTop: 13, marginBottom: 4 }}>` that holds `{label("Note")}`:
```tsx
            {part?.category === "Fabric" && (
              <div style={{ marginTop: 13, marginBottom: 4 }}>
                <FabricRateField
                  initialRate={part.curtainAreaRate ?? null}
                  initialBoltWidthIn={part.boltWidthIn ?? null}
                  fallbackRate={fabricAreaRateOf({ sku: part.sku, costPerSqft: part.costPerSqft })}
                  inputStyle={inputStyle}
                />
              </div>
            )}
```

- [ ] **Step 7: Import hub columns.** In `src/app/(app)/import/types.ts`, catalog type: append two fields after the `specSource` field line (`{ key: "specSource", header: "Spec Source", … example: "skill:2026-09-22" },`):
```ts
      { key: "curtainAreaRate", header: "Fabric $/sq ft", label: "Fabric $/sq ft sewn (incl. making)", kind: "number", exactOnly: true, aliases: ["fabric $/sq ft", "fabric per sq ft", "fabric $/sq ft sewn"], example: "4.85" },
      { key: "boltWidthIn", header: "Bolt width (in)", label: "Bolt width (in)", kind: "number", exactOnly: true, aliases: ["bolt width (in)", "bolt width"], example: "54" },
```
In the same type's `blurb`, replace the last string piece
```ts
      "Spec Body is multi-line — a quoted cell keeps its indentation. A row that changes spec text lands as a draft, never printed until reviewed; a blank spec cell never clears stored text (clear it in the part editor).",
```
with
```ts
      "Spec Body is multi-line — a quoted cell keeps its indentation. A row that changes spec text lands as a draft, never printed until reviewed; a blank spec cell never clears stored text (clear it in the part editor). " +
      "Fabric $/sq ft (a fabric's cost per sq ft of sewn fabric, making included) and Bolt width (in) also match only on their exact header; a blank cell or a price-only sheet never clears them.",
```
In `src/app/(app)/import/registry.ts` `catalogPatch`, add right after the line `    ...(num(v.mapPrice) ? { mapPrice: num(v.mapPrice) } : {}),`:
```ts
    // #227 — a fabric's flat $/sq ft (making included) and bolt width. Same
    // preserve-when-absent rule as MAP: coerce() turns an absent column or a
    // blank cell into 0, so only a positive value is written and a price-only
    // sheet never resets them.
    ...(num(v.curtainAreaRate) > 0 ? { curtainAreaRate: num(v.curtainAreaRate) } : {}),
    ...(num(v.boltWidthIn) > 0 ? { boltWidthIn: num(v.boltWidthIn) } : {}),
```
and in the catalog writer's `exportObjects`, add after `        specSource: p.specSource || "",`:
```ts
        curtainAreaRate: p.curtainAreaRate ?? "",
        boltWidthIn: p.boltWidthIn ?? "",
```

- [ ] **Step 8: Price-book columns.** In `src/app/(app)/catalog/parse.ts`:
  - In `CatalogRow`, add after `  sourceDocumentDate: string;`:
    ```ts
      /** #227 — header-only: a fabric's $/sq ft sewn (making included); 0 when absent/blank. */
      curtainAreaRate: number;
      /** #227 — header-only: bolt width in inches; 0 when absent/blank. */
      boltWidthIn: number;
    ```
  - In `ALIASES`, add after `  sourceDocumentDate: ["source date", "source document date"],`:
    ```ts
      curtainAreaRate: ["fabric $/sq ft", "fabric $/sq ft sewn", "fabric per sq ft"],
      boltWidthIn: ["bolt width (in)", "bolt width"],
    ```
  - In the positional `map`, add after `    sourceDocumentDate: 17,`:
    ```ts
        // #227 — header-only: no positional slot, so a headerless paste never
        // reads a stray 19th/20th cell as a fabric rate.
        curtainAreaRate: -1,
        boltWidthIn: -1,
    ```
  - In the row mapper, add after `    const sourceDocumentDate = at(map.sourceDocumentDate).trim();`:
    ```ts
        const curtainAreaRate = toNum(at(map.curtainAreaRate));
        const boltWidthIn = toNum(at(map.boltWidthIn));
    ```
    and add `      curtainAreaRate,` and `      boltWidthIn,` to the returned object right after `      sourceDocumentDate,`.
  - Append at the end of the file:
    ```ts

    /**
     * #227 — the fabric fields a price-book row writes: only a positive value,
     * so a sheet without the column (or with a blank cell) never resets a stored
     * rate. Pure; runCatalogImport spreads it into the mergeUpsert patch.
     */
    export function fabricFieldsOf(
      r: Pick<CatalogRow, "curtainAreaRate" | "boltWidthIn">
    ): { curtainAreaRate?: number; boltWidthIn?: number } {
      return {
        ...(r.curtainAreaRate > 0 ? { curtainAreaRate: r.curtainAreaRate } : {}),
        ...(r.boltWidthIn > 0 ? { boltWidthIn: r.boltWidthIn } : {}),
      };
    }
    ```
  In `src/app/(app)/catalog/import.ts`, replace `import { parseCatalog } from "./parse";` with `import { fabricFieldsOf, parseCatalog } from "./parse";`, and add right after `        ...(parsed.hasMap || isNew ? { mapPrice: r.mapPrice || null } : {}),`:
```ts
        // #227 — only a carried, positive rate/bolt width is written.
        ...fabricFieldsOf(r),
```

- [ ] **Step 9: Gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npx tsc --noEmit 2>&1 | grep -c "error TS"          # 0
npm run test:specs 2>&1 | tee /tmp/claude-227-t2.txt | grep -E '^FAIL|ALL PASSED|FAILED'
grep -c '^PASS ' /tmp/claude-227-t2.txt              # Task 1 count + 21
npx eslint src/lib/curtain-geom.ts "src/app/(app)/catalog/fabric-rate-field.tsx" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/part-form.ts" "src/app/(app)/catalog/parse.ts" "src/app/(app)/catalog/import.ts" "src/app/(app)/import/types.ts" "src/app/(app)/import/registry.ts" scripts/test-review-and-spec.ts
npx next build 2>&1 | tail -15
```

- [ ] **Step 10: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
git status --short scripts/test-review-and-spec.ts
git add src/lib/curtain-geom.ts "src/app/(app)/catalog/fabric-rate-field.tsx" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/part-form.ts" "src/app/(app)/catalog/parse.ts" "src/app/(app)/catalog/import.ts" "src/app/(app)/import/types.ts" "src/app/(app)/import/registry.ts" scripts/test-review-and-spec.ts
git commit -m "feat(pricing): edit and import a fabric's \$/sq ft sewn, with a lin-yd/sq-yd converter (#227)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Labels — "$X/sq ft sewn (incl. making)" / "No $/sq ft set"

**Files:** Modify `src/lib/curtain-geom.ts`, `src/app/(app)/estimator/curtain-modal.tsx`, `src/app/(app)/design/grid/[id]/curtain-drop.tsx`, `src/lib/design/auto-estimate.ts`, `src/lib/design/equipment-map.ts`, `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx`, `scripts/test-review-and-spec.ts`.

**Interfaces (produced):** `export function fabricRateLabel(rate: number | null | undefined): string` in `src/lib/curtain-geom.ts`.

- [ ] **Step 1: Failing tests.** In the `#211 T8` block (about line 18282) replace `      fabricHits9[0].unit === "sq ft" &&` with `      fabricHits9[0].unit === "sq ft sewn (incl. making)" &&`. Then append at **EOF**:
```ts

/* ====== #227 T3: labels — $X/sq ft sewn (incl. making) / No $/sq ft set ====== */
import { fabricRateLabel as fab227Label, FABRIC_RATE_UNIT as fab227Unit, NO_FABRIC_RATE as fab227NoRate } from "@/lib/curtain-geom";
import { priceCell as fab227PriceCell3, type PricingPart as Fab227Part3 } from "@/lib/design/equipment-map";
import { EQUIPMENT_ROW_BY_KEY as fab227Rows3 } from "@/lib/design/equipment-vocab";
import { curtainSwapHits as fab227Swap3 } from "@/lib/design/auto-estimate";
{
  ok(fab227Unit === "sq ft sewn (incl. making)" && fab227NoRate === "No $/sq ft set", "#227 labels: the unit and the no-rate text are the spec's words");
  ok(fab227Label(3.64) === "$3.64/sq ft sewn (incl. making)", `#227 labels: a rate reads $X/sq ft sewn (incl. making) (got ${fab227Label(3.64)})`);
  ok(fab227Label(0) === fab227NoRate && fab227Label(undefined) === fab227NoRate && fab227Label(null) === fab227NoRate && fab227Label(Number.NaN) === fab227NoRate, "#227 labels: no rate reads No $/sq ft set");

  const hits = fab227Swap3([{ sku: "FAB227-S", desc: "velour", curtainAreaRate: 3.5 }], 0.3);
  ok(hits.length === 1 && hits[0].unit === fab227Unit, "#227 labels: the swap search shows a fabric per sq ft sewn (incl. making)");

  const drawDef = fab227Rows3.get("curtains:draw")!;
  const ctxOf = (p: Fab227Part3) => ({ parts: new Map<string, Fab227Part3>([[p.sku, p]]), fixtures: new Map(), margin: 0.3 });
  const bare = fab227PriceCell3({ kind: "part", sku: "FAB227-BARE" }, drawDef, ctxOf({ sku: "FAB227-BARE", desc: "Bare", unit: "sq ft", cost: 0, list: 0, category: "Fabric" }));
  ok(bare.status === "needs-part" && bare.reason === "FAB227-BARE: No $/sq ft set", "#227 labels: a rateless fabric on a curtain row is needs-a-part with No $/sq ft set");
  const notFabric = fab227PriceCell3({ kind: "part", sku: "FAB227-HB" }, drawDef, ctxOf({ sku: "FAB227-HB", desc: "Headblock", unit: "ea", cost: 500, list: 700, category: "Rigging Hardware" }));
  ok(notFabric.status === "needs-part" && notFabric.reason === "FAB227-HB is not a Fabric part", "#227 labels: a non-fabric part on a curtain row says so");

  const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const modal = src("src/app/(app)/estimator/curtain-modal.tsx");
  ok(modal.includes("fabricRateLabel(f.curtainAreaRate)") && !modal.includes('"/sq ft sewn"'), "#227 labels: the estimator curtain modal labels each fabric with fabricRateLabel");
  ok(src("src/app/(app)/design/grid/[id]/curtain-drop.tsx").includes("fabricRateLabel(f.pricePerSqft)"), "#227 labels: the Grid curtain drop-in labels each fabric (No $/sq ft set when unrated)");
  const emc227 = src("src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx");
  ok(emc227.includes("FABRIC_RATE_UNIT") && !emc227.includes("+ making"), "#227 labels: the Equipment map cell reads per sq ft sewn (incl. making), not + making");
}
```

- [ ] **Step 2: Watch it fail.** Run `npx tsc --noEmit 2>&1 | grep "error TS" | head`. Expected: `fabricRateLabel` is not exported.

- [ ] **Step 3: Label helper.** Append to `src/lib/curtain-geom.ts`, after `sqftRateFromSquareYard`:
```ts

/** "$3.64/sq ft sewn (incl. making)", or "No $/sq ft set" for a missing/zero rate. */
export function fabricRateLabel(rate: number | null | undefined): string {
  const r = Number(rate);
  return Number.isFinite(r) && r > 0 ? `$${r.toFixed(2)}/${FABRIC_RATE_UNIT}` : NO_FABRIC_RATE;
}
```

- [ ] **Step 4: Estimator curtain modal.** In `src/app/(app)/estimator/curtain-modal.tsx`, add after `import type { CurtainDraft, FabricOpt } from "./types";`:
```ts
import { fabricRateLabel } from "@/lib/curtain-geom";
```
and replace
```tsx
              {f.name + (f.curtainAreaRate ? "  ·  $" + f.curtainAreaRate.toFixed(2) + "/sq ft sewn" : "")}
```
with
```tsx
              {f.name + "  ·  " + fabricRateLabel(f.curtainAreaRate)}
```
(`estimator/page.tsx` passes the resolved rate as `curtainAreaRate` since Task 1.)

- [ ] **Step 5: Grid curtain drop-in.** In `src/app/(app)/design/grid/[id]/curtain-drop.tsx`, replace `import { curtainPriceEach, type FabricSell } from "@/lib/curtain-geom";` with `import { curtainPriceEach, fabricRateLabel, type FabricSell } from "@/lib/curtain-geom";` and replace
```tsx
              <option key={f.sku} value={f.sku}>
                {f.name}
              </option>
```
with
```tsx
              <option key={f.sku} value={f.sku}>
                {f.name + "  ·  " + fabricRateLabel(f.pricePerSqft)}
              </option>
```

- [ ] **Step 6: Swap search unit.** In `src/lib/design/auto-estimate.ts`, add after `import { fabricAreaRateOf } from "./curtain-pricing";`:
```ts
import { FABRIC_RATE_UNIT } from "@/lib/curtain-geom";
```
and in `curtainSwapHits` replace `unit: "sq ft", unitSell: sellFromCost(rate, margin)` with `unit: FABRIC_RATE_UNIT, unitSell: sellFromCost(rate, margin)`. (`equipment-card.tsx` already prints `{unitMoney(h.unitSell)}/{h.unit}`, so it now reads "$5.00/sq ft sewn (incl. making)".)

- [ ] **Step 7: Equipment map reasons + cell label.** In `src/lib/design/equipment-map.ts`, add after `import { fabricAreaRateOf } from "./curtain-pricing";`:
```ts
import { NO_FABRIC_RATE } from "@/lib/curtain-geom";
```
and replace
```ts
      const rate = p.category === "Fabric" ? fabricAreaRateOf(p) : 0;
      if (!(rate > 0)) return needs(`${p.sku} is not a fabric with an area rate`);
```
with
```ts
      if (p.category !== "Fabric") return needs(`${p.sku} is not a Fabric part`);
      const rate = fabricAreaRateOf(p);
      if (!(rate > 0)) return needs(`${p.sku}: ${NO_FABRIC_RATE}`);
```
In `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx`, add after `import type { AssemblyOption, EquipCellVM, EquipRowVM } from "@/lib/design/equipment-map-view";`:
```ts
import { FABRIC_RATE_UNIT } from "@/lib/curtain-geom";
```
and replace
```tsx
          {cell.perSqft ? `${money(cell.unitCost)} / sq ft + making` : `cost ${money(cell.unitCost)} · sell ${money(cell.unitSell)}`}
```
with
```tsx
          {cell.perSqft ? `${money(cell.unitCost)}/${FABRIC_RATE_UNIT}` : `cost ${money(cell.unitCost)} · sell ${money(cell.unitSell)}`}
```

- [ ] **Step 8: Gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npx tsc --noEmit 2>&1 | grep -c "error TS"          # 0
npm run test:specs 2>&1 | tee /tmp/claude-227-t3.txt | grep -E '^FAIL|ALL PASSED|FAILED'
grep -c '^PASS ' /tmp/claude-227-t3.txt              # Task 2 count + 9
npx eslint src/lib/curtain-geom.ts "src/app/(app)/estimator/curtain-modal.tsx" "src/app/(app)/design/grid/[id]/curtain-drop.tsx" src/lib/design/auto-estimate.ts src/lib/design/equipment-map.ts "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx" scripts/test-review-and-spec.ts
npx next build 2>&1 | tail -15
```
The existing `#211 T3` guard (the map client imports no store/DB/hint value) and the `#211 T5` Grid-client guard (no `curtain-pricing` import) must still PASS. `curtain-geom` is allowed.

- [ ] **Step 9: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
git status --short scripts/test-review-and-spec.ts
git add src/lib/curtain-geom.ts "src/app/(app)/estimator/curtain-modal.tsx" "src/app/(app)/design/grid/[id]/curtain-drop.tsx" src/lib/design/auto-estimate.ts src/lib/design/equipment-map.ts "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(pricing): label fabric rates per sq ft sewn (incl. making); No \$/sq ft set when unrated (#227)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Hand-off (controller, not a task)

- Write the DECISIONS entry the spec requires. It should say: the making term is dropped; the rate must now include making; the five `SEED_FABRIC_RATES` and every existing `curtainAreaRate` are fabric-only and under-price until raised; the Equipment map now takes seeds (reversing the #211 no-seed note); rates convert via $/lin-yd ÷ (3 × in ÷ 12) or $/sq yd ÷ 9.
- **Which prices change.** Stored quote lines keep their numbers: estimator curtain lines are frozen when added, Grid quotes are priced when they are built, and portal drafts are priced on submit. Only these reprice under the new model:
  - estimator curtain adds and edits;
  - Grid curtain previews, and any Grid re-quote;
  - portal self-serve previews and submits;
  - Quick Design and Designs dashboard budgets, Grid Scope targets and Auto cards, wherever a curtain row is mapped in the Equipment map (prod's map may still be empty).

  At seed rates the drop is: 50×3 border at 50% $1,533.75 → $819 (−47%); 20×19 main $2,360.70 → $2,074.80 (−12%); 40×20 flat muslin cyc $910 → $720 (−21%). Short, wide drapes fall the most.
