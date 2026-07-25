# Curtain Pricing Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two disagreeing placeholder curtain-pricing models with one shared two-term "make-it-ourselves" model that prices from the same `goods.ts` geometry the lineset weights use.

**Architecture:** A new pure `src/lib/design/curtain-pricing.ts` holds the two-term cost model (`cost = sewnArea × fabricRate + sewnWidth × makingRate`), seeded ~10% above Rose Brand, with a per-line vendor-cost override and a 30% margin. Per-fabric rates live on the catalog; a 2-D `[type][tier] → fabric` table in `goods.ts` drives both weight and price. The estimator quote (`computeCurtain`) and the Quick Design budget (`engine.ts` curtain block) both call the shared function.

**Tech Stack:** Next.js 15 App Router, TypeScript, React 19 client components, Drizzle + PGlite doc-store, `tsx` script assertions.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-24-curtain-pricing-rebuild-design.md` (approved 2026-07-24). Where this plan and the spec disagree, the spec wins.
- **All drape dimensions are FINISHED.** Fullness is applied exactly once, as `sewnWidth = finishedW × (1 + fullness)`. Never pre-fatten.
- **The calibration anchor is Rose Brand quote 423939** (2026-07-23). With the *Rose Brand* rates (Charisma area 3.313, Encore-22 area 2.582, making 8.661 — no +10%), the model MUST reproduce its three lines: border $1,395, main $2,080, legs $525, each within $2. This is the load-bearing test; if it fails, the model is wrong.
- **Make-it seed rates = Rose Brand rates × 1.10** (Charisma 3.64, Encore-22 2.84, making 9.53). Cyc making rate 4.75 (flat goods). All editable.
- **Flat 30% margin:** `price = cost / (1 − 0.30)`.
- **Track/pipe/install-labor/freight stay separate lines** — not part of the curtain.
- **Tests:** no framework. Assertions append to `scripts/test-review-and-spec.ts` via the existing `ok(condition, message)` helper, run with `npm run test:specs`. **Always insert new assertions ABOVE the final two lines** (`console.log(fail ? ...)` and `process.exit(...)`).
- **Never run `npm run build` with a dev server running** — PGlite is single-process. Use `npx tsc --noEmit` to typecheck.
- **The 2-D fabric table changes the shipped lineset weights** (fabric per type now, not per tier). This is intended; update the weight tests that pin fabric SKUs.

### Locked values (verbatim from the spec)

| | Value |
|---|---|
| Fabric table — mains (draw/mid/rear/border) | good Encore22 (RB-EN-22) · better Charisma25 (RB-CHAR-25) · best Memorable25 (RB-MV-MN) |
| Fabric table — legs | good Encore16 (RB-EN-16) · better Encore22 (RB-EN-22) · best Charisma25 (RB-CHAR-25) |
| Fabric table — cyc | Muslin (RB-MUS) all tiers |
| New catalog SKUs | RB-CHAR-25 (Charisma 25oz, oz 25), RB-EN-22 (Encore 22oz, oz 22) |
| Seed area rates $/ft² | RB-CHAR-25 3.64 · RB-EN-22 2.84 · RB-EN-16 2.10 · RB-MV-MN 3.64 · RB-MUS 0.90 |
| Making rates $/ft width | pleated 9.53 · flat cyc 4.75 |
| Margin | 0.30 |

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/design/curtain-pricing.ts` **(new)** | The two-term model, rates, override, margin, seed rate map. Pure — no React, no I/O. |
| `src/lib/stores/catalog.ts` | `CatalogPart` gains `curtainAreaRate`. |
| `src/db/seeds/catalog.ts` | Two new fabric SKUs; `curtainAreaRate` on the five used fabrics. |
| `src/lib/design/goods.ts` | `TIER_FABRIC` (per-tier) → `FABRIC_BY_TYPE_TIER` (2-D); `drapeRule` fabric lookup. |
| `src/app/(app)/estimator/types.ts` | `FabricOpt` gains `curtainAreaRate`; `CurtainDraft` gains `vendorCostOverride`, drops nothing (bottom/hang stay in the type, ignored). |
| `src/app/(app)/estimator/pricing.ts` | `computeCurtain` rebuilt on `curtainCost`/`curtainPrice`. |
| `src/app/(app)/estimator/page.tsx` | Fabric mapping carries `curtainAreaRate`. |
| `src/app/(app)/estimator/curtain-modal.tsx` | Remove Hang + Bottom; add Rose Brand cost override field. |
| `src/app/(app)/design/quick/engine.ts` | Curtain block rebuilt on `drapeRule` geometry + `curtainCost`. |
| `scripts/test-review-and-spec.ts` | Assertions for every task. |

---

### Task 1: The pricing core — `curtain-pricing.ts`

**Files:**
- Create: `src/lib/design/curtain-pricing.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type CurtainRates`, `type CurtainCostInput`, `type CurtainCost`, `CURTAIN_MARGIN`, `DEFAULT_MAKING_RATE`, `DEFAULT_CYC_MAKING_RATE`, `SEED_FABRIC_RATES`, `curtainCost(input, rates)`, `curtainPrice(costEach, margin?)`, `makingRateFor(fullnessPct)`.

- [ ] **Step 1: Write the failing test**

Add the import at the top of `scripts/test-review-and-spec.ts` with the other imports:

```ts
import { curtainCost, curtainPrice, makingRateFor, DEFAULT_MAKING_RATE, DEFAULT_CYC_MAKING_RATE } from "@/lib/design/curtain-pricing";
```

Insert above the final `console.log` line:

```ts
/* --- curtain pricing: reconcile Rose Brand quote 423939 (task 1) --- */
// Rose Brand rates (NOT the +10% make-it seeds): Charisma area 3.313, Encore-22 area 2.582, making 8.661.
const RB_CHAR = { fabricRate: 3.313, makingRate: 8.661 };
const RB_EN22 = { fabricRate: 2.582, makingRate: 8.661 };
const border = curtainCost({ finishedWidthFt: 50, finishedHeightFt: 3, fullnessPct: 50, qty: 1 }, RB_CHAR);
ok(Math.abs(border.costEach - 1395) < 2, `RB line 1 border ≈ $1,395 (got ${border.costEach.toFixed(2)})`);
const main = curtainCost({ finishedWidthFt: 23, finishedHeightFt: 15 + 7 / 12, fullnessPct: 50, qty: 1 }, RB_CHAR);
ok(Math.abs(main.costEach - 2080) < 2, `RB line 2 main ≈ $2,080 (got ${main.costEach.toFixed(2)})`);
const legs = curtainCost({ finishedWidthFt: 9.5, finishedHeightFt: 10 + 11 / 12, fullnessPct: 50, qty: 1 }, RB_EN22);
ok(Math.abs(legs.costEach - 525) < 2, `RB line 3 legs ≈ $525 (got ${legs.costEach.toFixed(2)})`);

// sewn geometry
ok(border.sewnWidthFt === 75 && Math.abs(border.sewnAreaSqft - 225) < 1e-6, "sewnWidth = W×(1+fullness); sewnArea = sewnWidth×H");
// qty multiplies the total, not the unit
ok(Math.abs(curtainCost({ finishedWidthFt: 9.5, finishedHeightFt: 10 + 11 / 12, fullnessPct: 50, qty: 4 }, RB_EN22).costTotal - legs.costEach * 4) < 1e-6, "costTotal = costEach × qty");

// vendor override replaces the make cost and flags the line
const ov = curtainCost({ finishedWidthFt: 23, finishedHeightFt: 15, fullnessPct: 50, qty: 2, vendorCostOverride: 2080 }, RB_CHAR);
ok(ov.costEach === 2080 && ov.overridden === true && ov.costTotal === 4160, "vendorCostOverride replaces make cost, flags overridden, ×qty");
ok(curtainCost({ finishedWidthFt: 10, finishedHeightFt: 10, fullnessPct: 50, qty: 1 }, RB_CHAR).overridden === false, "no override → overridden false");

// cyc flatness: 0% fullness → sewn area equals finished face
const cyc = curtainCost({ finishedWidthFt: 40, finishedHeightFt: 20, fullnessPct: 0, qty: 1 }, { fabricRate: 0.9, makingRate: DEFAULT_CYC_MAKING_RATE });
ok(cyc.sewnAreaSqft === 800 && cyc.sewnWidthFt === 40, "cyc at 0% fullness: sewn area = finished face, no 1.5× applied");

// making rate selector
ok(makingRateFor(50) === DEFAULT_MAKING_RATE && makingRateFor(0) === DEFAULT_CYC_MAKING_RATE, "flat goods use the lower cyc making rate");

// margin
ok(Math.abs(curtainPrice(700) - 1000) < 1e-6, "price = cost / (1 − 0.30)");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `Cannot find module '@/lib/design/curtain-pricing'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/design/curtain-pricing.ts`:

```ts
/**
 * Curtain pricing — one shared model for the budget (Quick Design) and the
 * quote (estimator), built from the same finished geometry the lineset weights
 * use (spec 2026-07-24-curtain-pricing-rebuild).
 *
 * "Make-it-ourselves" two-term cost, calibrated ~10% above Rose Brand so Peak
 * can quote fast/safe without waiting on a vendor quote; a per-line vendor cost
 * override drops in the real Rose Brand price when it arrives.
 *
 * Reconciled from Rose Brand quote 423939 (2026-07-23): a single per-ft² rate
 * does not fit real drapes — top webbing and bottom chain hem scale with WIDTH,
 * not area — so cost has two terms: area (fabric) + width (making).
 */

export type CurtainRates = {
  /** Make-it area cost, $/ft² of SEWN fabric (finished × fullness). */
  fabricRate: number;
  /** Make-it making cost, $/ft of SEWN width (webbing, chain hem, side hems,
   *  setup) — fabric-independent. Pleated velour uses DEFAULT_MAKING_RATE; a
   *  flat 0%-fullness cyc uses DEFAULT_CYC_MAKING_RATE (see makingRateFor). */
  makingRate: number;
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

/** $/ft sewn width — pleated velour (≈ Rose Brand 8.661 + 10%). */
export const DEFAULT_MAKING_RATE = 9.53;
/** $/ft sewn width — flat goods (a 0%-fullness cyc): no pleating setup. */
export const DEFAULT_CYC_MAKING_RATE = 4.75;

/** Flat goods (fullness 0) make cheaper — no pleating. */
export function makingRateFor(fullnessPct: number): number {
  return fullnessPct <= 0 ? DEFAULT_CYC_MAKING_RATE : DEFAULT_MAKING_RATE;
}

/**
 * Seed make-it area rates by fabric SKU (Rose-Brand-reconciled × 1.10). These
 * are the canonical defaults; the catalog's editable curtainAreaRate is seeded
 * from the same numbers. Only the five fabrics the drape table uses.
 */
export const SEED_FABRIC_RATES: Record<string, number> = {
  "RB-CHAR-25": 3.64, // Charisma 25oz (anchor: RB 3.313 ×1.10)
  "RB-EN-22": 2.84,   // Encore 22oz  (anchor: RB 2.582 ×1.10)
  "RB-EN-16": 2.1,    // Encore 16oz  (seed)
  "RB-MV-MN": 3.64,   // Memorable 25oz (seed ≈ Charisma)
  "RB-MUS": 0.9,      // Seamless Muslin (seed)
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Two-term make-it cost, with optional vendor override. Pure. */
export function curtainCost(input: CurtainCostInput, rates: CurtainRates): CurtainCost {
  const sewnWidthFt = input.finishedWidthFt * (1 + input.fullnessPct / 100);
  const sewnAreaSqft = sewnWidthFt * input.finishedHeightFt;
  const makeCostEach = round2(sewnAreaSqft * rates.fabricRate + sewnWidthFt * rates.makingRate);
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

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on all new lines, `ALL PASSED` overall.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/curtain-pricing.ts scripts/test-review-and-spec.ts
git commit -m "feat(design): two-term curtain pricing model, reconciled to RB quote 423939"
```

---

### Task 2: Catalog fabric rates + two new SKUs

**Files:**
- Modify: `src/lib/stores/catalog.ts` (the `CatalogPart` type)
- Modify: `src/db/seeds/catalog.ts` (Fabric rows)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `SEED_FABRIC_RATES` from task 1.
- Produces: `CatalogPart.curtainAreaRate`; catalog SKUs `RB-CHAR-25`, `RB-EN-22`; `curtainAreaRate` on the five used fabrics.

- [ ] **Step 1: Write the failing test**

**The test harness is PURE — it never reads the catalog DB** (existing fabric tests build inline `fabricFromPart({...})` objects). So this task's harness assertion guards the seed *constant*; the actual catalog rows are verified by reseed + a throwaway read in step 5.

Add the import at the top with the others:

```ts
import { SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
```

Insert above the final `console.log` line:

```ts
/* --- curtain seed rates cover exactly the five used fabrics (task 2) --- */
ok(SEED_FABRIC_RATES["RB-CHAR-25"] === 3.64 && SEED_FABRIC_RATES["RB-EN-22"] === 2.84, "anchor fabrics carry their reconciled +10% seed rates");
ok(SEED_FABRIC_RATES["RB-EN-16"] === 2.1 && SEED_FABRIC_RATES["RB-MV-MN"] === 3.64 && SEED_FABRIC_RATES["RB-MUS"] === 0.9, "the three seed fabrics carry their flagged rates");
ok(Object.keys(SEED_FABRIC_RATES).length === 5, "exactly five fabrics have curtain rates — no unused fabrics carry one");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `Object.keys(SEED_FABRIC_RATES).length === 5` may already pass (task 1 defined it), but the import will fail if task 1's `SEED_FABRIC_RATES` is absent. If task 1 is complete these assertions pass immediately; that is fine — this task's real work and gate are the catalog rows (steps 3–5). Treat a green run here as "seed constant confirmed" and proceed.

- [ ] **Step 3: Add the field to `CatalogPart`**

In `src/lib/stores/catalog.ts`, add inside `CatalogPart` immediately after the `boltWidthIn` field:

```ts
  /** Curtain make-it-ourselves area cost, $/ft² of sewn fabric. Fabric rows
   *  only. Seeded ~10% above the Rose-Brand-reconciled rate; edit toward real
   *  shop cost when the curtain shop exists. Distinct from raw costPerSqft. */
  curtainAreaRate?: number;
```

- [ ] **Step 4: Add the two SKUs and the rates to the seed**

In `src/db/seeds/catalog.ts`, in the Fabric block: add `curtainAreaRate` to the three existing used rows and insert the two new SKUs. The velours are 54″ lin-yd, oz as noted:

```ts
    { id: "RB-CHAR-25", sku: "RB-CHAR-25", desc: "25 oz Charisma Velour", category: "Fabric", unit: "sq ft", list: 6.40, cost: 4.20, mfr: "Rose Brand", costPerSqft: 4.20, oz: 25, ozBasis: "lin-yd", boltWidthIn: 54, curtainAreaRate: 3.64 },
    { id: "RB-EN-22", sku: "RB-EN-22", desc: "22 oz Encore Velour", category: "Fabric", unit: "sq ft", list: 4.60, cost: 3.05, mfr: "Rose Brand", costPerSqft: 3.05, oz: 22, ozBasis: "lin-yd", boltWidthIn: 54, curtainAreaRate: 2.84 },
```

Then add `curtainAreaRate` to the existing `RB-EN-16` (2.10), `RB-MV-MN` (3.64), and `RB-MUS` (0.90) rows, leaving their other fields untouched. Do NOT add a curtain rate to Marvel or any unused fabric.

- [ ] **Step 5: Verify the catalog rows landed (reseed + throwaway read)**

Confirm no dev server is running (`lsof -i :3000`; stop and report if one is — do not kill it). Then reseed and read the rows directly (the harness can't):

```bash
npm run db:reset-local && npx tsx -e '
import { list } from "./src/lib/stores/catalog";
const p = await list();
const b = Object.fromEntries(p.filter(x=>x.category==="Fabric").map(x=>[x.sku,x]));
console.log("CHAR-25", b["RB-CHAR-25"]?.oz, b["RB-CHAR-25"]?.curtainAreaRate);
console.log("EN-22", b["RB-EN-22"]?.oz, b["RB-EN-22"]?.curtainAreaRate);
console.log("EN-16", b["RB-EN-16"]?.curtainAreaRate, "MV-MN", b["RB-MV-MN"]?.curtainAreaRate, "MUS", b["RB-MUS"]?.curtainAreaRate);
'
```

Expected: `CHAR-25 25 3.64`, `EN-22 22 2.84`, `EN-16 2.1 MV-MN 3.64 MUS 0.9`. Report the actual output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/catalog.ts src/db/seeds/catalog.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): curtain area rates + Charisma 25oz / Encore 22oz SKUs"
```

---

### Task 3: 2-D fabric-by-type-and-tier table in `goods.ts`

**Files:**
- Modify: `src/lib/design/goods.ts` (`TIER_FABRIC` → `FABRIC_BY_TYPE_TIER`; `drapeRule` fabric lookup)
- Modify: `scripts/test-review-and-spec.ts` (update the weight tests that pin fabric SKUs)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `drapeRule(type, dims, tier)` now returns per-type-per-tier fabric (same signature, same return shape).

Background: the shipped lineset weights resolve fabric from a per-tier-only map. This makes fabric per-drape-type (mains ≠ legs), which changes the weights too — intended.

- [ ] **Step 1: Update the failing tests**

The existing `/* --- drape rule table (task 3) --- */` block (from the lineset plan) pins fabric SKUs at the "better" tier to `RB-MARVEL`. Those assertions must change to the new table. Update them in place:

```ts
// was RB-MARVEL — mains are now Charisma 25oz at the better tier
ok(drapeRule("Draw", DIMS36, "better")!.fabricSku === "RB-CHAR-25", "better draw = Charisma 25oz");
ok(drapeRule("Midstage Draw", DIMS36, "better")!.fabricSku === "RB-CHAR-25", "better midstage = Charisma 25oz");
ok(drapeRule("Rear", DIMS36, "better")!.fabricSku === "RB-CHAR-25", "better rear = Charisma 25oz");
ok(drapeRule("Border", DIMS36, "better")!.fabricSku === "RB-CHAR-25", "better border = Charisma 25oz");
ok(drapeRule("Legs", DIMS36, "better")!.fabricSku === "RB-EN-22", "better legs = Encore 22oz");
ok(drapeRule("Draw", DIMS36, "good")!.fabricSku === "RB-EN-22", "good mains = Encore 22oz");
ok(drapeRule("Draw", DIMS36, "best")!.fabricSku === "RB-MV-MN", "best mains = Memorable 25oz");
ok(drapeRule("Legs", DIMS36, "good")!.fabricSku === "RB-EN-16", "good legs = Encore 16oz");
ok(drapeRule("Legs", DIMS36, "best")!.fabricSku === "RB-CHAR-25", "best legs = Charisma 25oz");
ok(drapeRule("CYC", DIMS36, "good")!.fabricSku === "RB-MUS", "cyc is muslin at every tier");
ok(drapeRule("CYC", DIMS36, "best")!.fabricSku === "RB-MUS", "cyc is muslin at every tier");
```

Delete any prior "better …→ RB-MARVEL" and "best draw → RB-MV-MN via old map" assertions that now conflict. Search the block for `RB-MARVEL` and `RB-EN-16` and reconcile every drape-rule assertion to the table above. Leave the geometry assertions (w/h/fullness/qty/track/chain) unchanged — only fabric SKUs move.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — better draw still resolves to `RB-MARVEL` under the old map.

- [ ] **Step 3: Replace the fabric map**

In `src/lib/design/goods.ts`, replace the `TIER_FABRIC` constant with a 2-D table keyed by drape type then tier:

```ts
/** Fabric per drape TYPE, with the tier as a grade shifter. The `better` row is
 *  Peak's real spec (Rose Brand quote 423939). Drives both weight and price. */
const FABRIC_BY_TYPE_TIER: Record<string, Record<GoodsTier, string>> = {
  Draw: { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" },
  "Midstage Draw": { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" },
  Rear: { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" },
  Border: { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" },
  Legs: { good: "RB-EN-16", better: "RB-EN-22", best: "RB-CHAR-25" },
  CYC: { good: "RB-MUS", better: "RB-MUS", best: "RB-MUS" },
};
```

Then change `drapeRule` so its fabric lookup reads this table by the line type (not a per-tier role). Find where it currently does `TIER_FABRIC[tier][role]` and replace with a lookup keyed by the drape type it is handling, e.g. inside each `case`, use `FABRIC_BY_TYPE_TIER[lineType][tier]`. Keep the finished-geometry values (w, h, fullness, qty, track, chain) exactly as they are; only the `fabricSku` source changes. Read the current `drapeRule` before editing so the case structure is preserved.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS. The weight assertions (`goods > 0` etc.) still pass because Charisma/Encore-22 are now in the catalog with `oz` (task 2). If a weight assertion fails on a missing fabric, task 2's reseed did not run — rerun `npm run db:reset-local` with no dev server.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/goods.ts scripts/test-review-and-spec.ts
git commit -m "feat(design): fabric per drape type with tier as grade shifter"
```

---

### Task 4: Rebuild `computeCurtain` (estimator quote)

**Files:**
- Modify: `src/app/(app)/estimator/types.ts` (`FabricOpt`, `CurtainDraft`)
- Modify: `src/app/(app)/estimator/pricing.ts` (`computeCurtain`, `CurtainCalc`)
- Modify: `src/app/(app)/estimator/page.tsx` (fabric mapping)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `curtainCost`, `curtainPrice`, `makingRateFor` from task 1.
- Produces: `computeCurtain` returning `costEach`/`priceEach` from the two-term model; `FabricOpt.curtainAreaRate`; `CurtainDraft.vendorCostOverride`.

- [ ] **Step 1: Write the failing test**

Insert above the final `console.log` line:

```ts
/* --- computeCurtain rebuilt on the two-term model (task 4) --- */
import { computeCurtain as computeCurtainQuote } from "@/app/(app)/estimator/pricing";
{
  const fabrics = [{ sku: "RB-CHAR-25", name: "25 oz Charisma Velour", costPerSqft: 4.2, curtainAreaRate: 3.64 }];
  // main-ish drape at the make-it (seeded) rate
  const cc = computeCurtainQuote(
    { name: "Main", hang: "", fabric: "RB-CHAR-25", qty: "2", height: "19", width: "20", fullness: "50", bottom: "" } as any,
    fabrics as any,
    0.3
  );
  // make cost = sewnArea(30×19=570)×3.64 + sewnWidth(30)×9.53 = 2074.8 + 285.9 = 2360.7
  ok(Math.abs(cc.costEach - 2360.7) < 1, `computeCurtain uses the two-term make-it cost (got ${cc.costEach})`);
  ok(Math.abs(cc.priceEach - cc.costEach / 0.7) < 0.02, "price = cost / (1 − 0.30)");
  // Rose Brand override wins
  const ov = computeCurtainQuote(
    { name: "Main", hang: "", fabric: "RB-CHAR-25", qty: "2", height: "19", width: "20", fullness: "50", bottom: "", vendorCostOverride: "2080" } as any,
    fabrics as any,
    0.3
  );
  ok(ov.costEach === 2080, "a Rose Brand cost override replaces the make cost in the quote");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — old `computeCurtain` returns the fabric+labor+bottom+hang cost, not 2360.7.

- [ ] **Step 3: Extend the types**

In `src/app/(app)/estimator/types.ts`:

```ts
export type FabricOpt = { sku: string; name: string; costPerSqft: number; curtainAreaRate?: number };
```

and add to `CurtainDraft` after `bottom`:

```ts
  /** Real vendor (Rose Brand) unit cost; when set, overrides the make-it cost. */
  vendorCostOverride?: string;
```

`bottom` and `hang` remain in the type (old records load); they no longer affect price.

- [ ] **Step 4: Rebuild `computeCurtain`**

Replace the body of `computeCurtain` in `pricing.ts`. Import at the top:

```ts
import { curtainCost, curtainPrice, makingRateFor, SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
```

New body (keep the `CurtainCalc` shape; `fabricArea` becomes the sewn area):

```ts
export function computeCurtain(
  d: CurtainDraft,
  fabrics: FabricOpt[],
  margin: number = 0.3
): CurtainCalc {
  const fab =
    fabrics.find((f) => f.sku === d.fabric) ||
    fabrics[0] ||
    ({ sku: "", name: "", costPerSqft: 0 } as FabricOpt);
  const h = parseFloat(d.height) || 0;
  const w = parseFloat(d.width) || 0;
  const fullness = parseFloat(d.fullness) || 0;
  const fabricRate = fab.curtainAreaRate ?? SEED_FABRIC_RATES[fab.sku] ?? 0;
  const override = d.vendorCostOverride != null && d.vendorCostOverride !== "" ? parseFloat(d.vendorCostOverride) : null;
  const cc = curtainCost(
    { finishedWidthFt: w, finishedHeightFt: h, fullnessPct: fullness, qty: 1, vendorCostOverride: override },
    { fabricRate, makingRate: makingRateFor(fullness) }
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

The `margin` default changes from `0.38` to `0.3`. Delete the old `sewLabor`/`bottomCost`/`hangCost` locals.

- [ ] **Step 5: Carry `curtainAreaRate` through the fabric mapping**

In `src/app/(app)/estimator/page.tsx`, the fabric list is built around line 178 as `{ sku, name, costPerSqft }`. Add the rate:

```ts
      curtainAreaRate: p.curtainAreaRate,
```

to that mapped object, so the editable catalog rate reaches the quote.

- [ ] **Step 6: Run test to verify it passes + typecheck**

```bash
npm run test:specs && npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/pricing.ts" "src/app/(app)/estimator/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(estimator): rebuild computeCurtain on the shared two-term model + RB override"
```

---

### Task 5: Curtain modal — drop Hang/Bottom, add Rose Brand override

**Files:**
- Modify: `src/app/(app)/estimator/curtain-modal.tsx`
- Test: drive the app

**Interfaces:**
- Consumes: `CurtainDraft.vendorCostOverride` (task 4).
- Produces: no new exports.

- [ ] **Step 1: Remove the Hang and Bottom controls**

In `curtain-modal.tsx`, delete the `HANGS` and `BOTTOMS` consts, the entire `{/* hang type */}` block, and the entire `{/* bottom finish */}` block. Leave name, fabric, qty/width/height, and fullness.

- [ ] **Step 2: Add the Rose Brand cost override field**

After the fullness block, add:

```tsx
      {/* Rose Brand cost override */}
      <div style={{ marginBottom: 4 }}>
        <label style={LBL}>
          Rose Brand cost{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · optional — replaces the make-it cost
          </span>
        </label>
        <input
          className="est-input est-field"
          value={draft.vendorCostOverride ?? ""}
          onChange={(e) => onSet("vendorCostOverride", e.target.value)}
          placeholder="e.g. 2080"
          style={NUMFIELD}
        />
      </div>
```

`onSet`'s signature is `(field: keyof CurtainDraft, val: string)`; `vendorCostOverride` is now a `keyof CurtainDraft` (task 4), so this typechecks.

- [ ] **Step 3: Update the fabric dropdown label to show the curtain rate**

The fabric `<option>` currently shows `costPerSqft`. Change it to the make-it area rate so the configurator reflects what actually drives price:

```tsx
              {f.name + (f.curtainAreaRate ? "  ·  $" + f.curtainAreaRate.toFixed(2) + "/sq ft sewn" : "")}
```

- [ ] **Step 4: Verify in the app**

Start the dev server only if none is running (`lsof -i :3000`; do NOT run `npm run build`).

```bash
npm run dev
```

Open `/estimator`, add a curtain. Expected:
- No Hang or Bottom controls; fabric dropdown lists Charisma/Encore/etc. with a `$/sq ft sewn` rate.
- A blank main-ish drape (Charisma, 20×19, 50%, qty 2) shows Cost/ea ≈ $2,361 and a price ≈ $3,373.
- Typing a Rose Brand cost (e.g. 2080) drops Cost/ea to $2,080 and the price falls accordingly.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/estimator/curtain-modal.tsx"
git commit -m "feat(estimator): curtain modal — remove hang/bottom, add Rose Brand cost override"
```

---

### Task 6: Rebuild the Quick Design budget curtain block

**Files:**
- Modify: `src/app/(app)/design/quick/engine.ts` (the curtain block, ~lines 466-476)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `drapeRule` (task 3), `curtainCost` + `SEED_FABRIC_RATES` + `makingRateFor` (task 1), `venueDimsFromEstimator` (existing, from the lineset work).
- Produces: curtain items whose `cost` is the two-term make-it cost; the engine's existing 0.30 margin turns cost into price.

The engine's curtain system already applies `m: 0.3` (`price = it.cost / (1 - d.m)`), so this task only replaces each curtain's per-unit **cost**; the price falls out of the existing machinery. Track (`scenerytrack`) is NOT a soft-goods curtain — leave it exactly as-is.

- [ ] **Step 1: Write the failing test**

Insert above the final `console.log` line:

`engine.ts` is pure ("no React, no I/O") and exports both `compute` and `defaultAState`, so import them directly at the top of the test file — no `await import`:

```ts
import { compute as computeQuick, defaultAState } from "@/app/(app)/design/quick/engine";
import { drapeRule as drapeRuleQ } from "@/lib/design/goods";
import { curtainCost as curtainCostQ, SEED_FABRIC_RATES as RATES_Q, makingRateFor as makingForQ } from "@/lib/design/curtain-pricing";
```

Insert above the final `console.log` line:

```ts
/* --- Quick Design budget curtain block on the shared model (task 6) --- */
{
  const base = defaultAState(0);
  const s = { ...base, venue: "school", width: 40, ph: 20, depth: 30, tier: "better" as const, sys: { ...base.sys, curtains: true }, drape: { draw: true, legs: false, border: false, scenerytrack: false, fullstage: false } };
  const res = computeQuick(s);
  const curtains = res.systems.find((x) => x.key === "curtains")!;
  const drawItem = curtains.items.find((it) => it.desc === "Draw")!;
  // Expected unit cost = one Draw (a pair) priced through the shared model at the venue geometry.
  const dims = { proWidthFt: 40, proHeightFt: 20, stageWidthFt: 64, stageDepthFt: 30 };
  const rule = drapeRuleQ("Draw", dims, "better")!;
  const expected = curtainCostQ(
    { finishedWidthFt: rule.w, finishedHeightFt: rule.h, fullnessPct: rule.fullness, qty: rule.qty },
    { fabricRate: RATES_Q[rule.fabricSku], makingRate: makingForQ(rule.fullness) }
  ).costTotal;
  ok(Math.abs(drawItem.cost - Math.round(expected)) < 1, `Quick Design Draw cost = shared model make cost (got ${drawItem.cost}, expected ${Math.round(expected)})`);
}
```

Note `stageWidthFt: 64` in the expected `dims` — `venueDimsFromEstimator` derives stage width as `width + 2×wing`, and `defaultAState`'s school venue has `wing: 12`, so the engine will build `stageWidthFt = 40 + 24 = 64`. The Draw's fabric geometry keys off `proWidthFt` (40), not stage width, so the expected value matches regardless — but keep the `dims` here consistent with what the engine actually builds so the test mirrors reality.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — the old lump `(2W+2)×PH×9` cost, not the shared-model cost.

- [ ] **Step 3: Rebuild the curtain block**

In `engine.ts`, add imports at the top:

```ts
import { drapeRule } from "@/lib/design/goods";
import { curtainCost, SEED_FABRIC_RATES, makingRateFor } from "@/lib/design/curtain-pricing";
import { venueDimsFromEstimator } from "@/lib/design/venue-dims";
```

Replace the five `addCurtain(...)` fabric lines (keep `scenerytrack` as its own non-fabric line). Map each drape toggle to a `goods.ts` type and price it:

```ts
  const gdims = venueDimsFromEstimator(s);
  const priceDrape = (on: boolean | undefined, desc: string, type: string, count: number, fabricKey: string) => {
    if (!on || count <= 0) return;
    const rule = drapeRule(type, gdims, s.tier);
    if (!rule) return;
    const cc = curtainCost(
      { finishedWidthFt: rule.w, finishedHeightFt: rule.h, fullnessPct: rule.fullness, qty: rule.qty },
      { fabricRate: SEED_FABRIC_RATES[rule.fabricSku] ?? 0, makingRate: makingRateFor(rule.fullness) }
    );
    curtainItems.push({ desc, unit: "ea", qty: count, cost: Math.round(cc.costTotal), area: Math.round(cc.sewnAreaSqft), fabricKey });
  };
  priceDrape(drape.draw, "Draw", "Draw", dBlk * 1, "draw");
  priceDrape(drape.legs, "Leg", "Legs", dBlk * 2, "legs");
  priceDrape(drape.border, "Border", "Border", dBlk * 1, "border");
  priceDrape(drape.fullstage, "Full stage", "Rear", dBlk * 1, "fullstage");
  addCurtain(drape.scenerytrack, "Scenery track", dBlk * 1, W * 1, 3, null); // track hardware, not soft goods — unchanged
```

Keep the `addCurtain` helper for the scenery-track line only. Read the block first to preserve the `curtainItems` variable and the `dBlk` count expressions.

- [ ] **Step 4: Run test to verify it passes + typecheck**

```bash
npm run test:specs && npx tsc --noEmit
```

Expected: PASS, clean. Pre-existing engine assertions must still pass — the curtain *system* still produces items with `{desc, qty, cost}`, only the cost value changed.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/design/quick/engine.ts" scripts/test-review-and-spec.ts
git commit -m "feat(quick-design): budget curtains price through the shared two-term model"
```

---

### Task 7: Budget = quote integration test + live verify

**Files:**
- Test: `scripts/test-review-and-spec.ts`
- Verify: drive both tools

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the agreement test**

Insert above the final `console.log` line:

```ts
/* --- budget and quote agree on the same drape (task 7) --- */
{
  // A Draw at a 40×20 proscenium, better tier, priced both ways must match per unit.
  const dims = { proWidthFt: 40, proHeightFt: 20, stageWidthFt: 40, stageDepthFt: 30 };
  const rule = drapeRuleQ("Draw", dims as any, "better")!;
  const budget = curtainCostQ(
    { finishedWidthFt: rule.w, finishedHeightFt: rule.h, fullnessPct: rule.fullness, qty: rule.qty },
    { fabricRate: RATES_Q[rule.fabricSku], makingRate: makingForQ(rule.fullness) }
  ).costTotal;
  // Quote: same geometry typed into computeCurtain, one panel × qty summed.
  const fabrics = [{ sku: rule.fabricSku, name: "x", costPerSqft: 0, curtainAreaRate: RATES_Q[rule.fabricSku] }];
  const quotePanel = computeCurtainQuote(
    { name: "d", hang: "", fabric: rule.fabricSku, qty: String(rule.qty), height: String(rule.h), width: String(rule.w), fullness: String(rule.fullness), bottom: "" } as any,
    fabrics as any,
    0.3
  ).costEach;
  ok(Math.abs(budget - quotePanel * rule.qty) < 1, "budget and quote agree on the same drape's make cost");
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS. (This is a genuine cross-tool check: both call `curtainCost` over the same `drapeRule` geometry, so they must agree.)

- [ ] **Step 3: Live verify both tools**

With `npm run dev` running (no build):
- `/estimator`: add a Charisma main 20×19 @50% qty 2 → cost ≈ $2,361/ea; add a Rose Brand override 2080 → drops to $2,080.
- `/design` (Quick Design): a 40×20 proscenium with Draw on, better tier → the Draw curtain line shows a cost consistent with the estimator's make cost for the same geometry.
- Confirm the lineset builder still computes weights (the fabric table change): open `/design/lineset`, a better-tier main now weighs as Charisma 25oz. No "NOT SPECIFIED" regressions.

- [ ] **Step 4: Full suite + typecheck**

```bash
npm run test:specs && npx tsc --noEmit
```

Expected: `ALL PASSED`, clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-review-and-spec.ts
git commit -m "test(design): budget and quote agree on the same drape's cost"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 pricing function | 1 |
| §1.1 two making rates | 1 |
| §2 catalog rates + 2 SKUs | 2 |
| §3 fabric-by-type-tier table | 3 |
| §4 rebuild computeCurtain | 4, 5 |
| §4 rebuild Quick Design block | 6 |
| §5 not-in-scope (track/labor/freight untouched) | enforced — task 6 leaves scenerytrack + other systems alone |
| §7 testing: reconciliation, override, cyc, budget=quote, weights | 1, 4, 6, 7, 3 |

**Deliberate:** the spec's "refine non-anchor seed rates from future quotes" is a standing data item, not a task.

**Type consistency:** `CurtainCost`/`CurtainRates`/`CurtainCostInput` names are identical across tasks 1, 4, 6. `curtainAreaRate` is the field name in the catalog (task 2), `FabricOpt` (task 4), and read in tasks 4/6. `vendorCostOverride` is the field in `CurtainCostInput` (task 1), `CurtainDraft` (task 4), and read in the modal (task 5). `SEED_FABRIC_RATES` keys are the exact SKUs task 2 seeds and task 3's table references.

**Two risks worth naming:**
1. **Task 3 changes shipped weights.** A saved lineset design reopened after this will show different (Charisma-based) weights for its drapes than before. Intended per the spec, but the same "old saved totals move" caveat as the lineset feature — worth telling Jeff.
2. **Two rate sources by design.** The budget (engine, no DB) uses the static `SEED_FABRIC_RATES`; the quote (estimator, has catalog) uses the editable `curtainAreaRate`, which is seeded from the same numbers. They agree until someone edits a catalog rate, after which the budget stays on the seed. This is the intended budget-vs-quote split (rough budget vs editable quote), but the agreement test (task 7) only holds while the catalog rate equals the seed — note this so a later editable-budget request is a known follow-up, not a surprise.
