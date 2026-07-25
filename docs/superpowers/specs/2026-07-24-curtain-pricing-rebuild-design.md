# Curtain pricing rebuild — one geometry, make-it-ourselves cost, Rose Brand override (design)

Date: 2026-07-24
Status: draft — awaiting Jeff's review
Area: `src/lib/design/curtain-pricing.ts` (new), `src/lib/design/goods.ts`,
`src/lib/stores/catalog.ts`, `src/db/seeds/catalog.ts`,
`src/app/(app)/estimator/pricing.ts`, `src/app/(app)/estimator/estimator-client.tsx`,
`src/app/(app)/design/quick/engine.ts`

## Problem

The app has **two curtain pricing models and they disagree**, both labelled
placeholders in their own source:

- **Quick Design budgetary** (`quick/engine.ts` `compute()`): `cost = area × rate`
  with lump areas and **no fullness model at all** — draw `(2W+2)×PH @ $9`, leg
  `6×PH @ $7`, etc.
- **Estimator quote** (`estimator/pricing.ts` `computeCurtain`): a real cost
  build-up — `fabricArea × costPerSqft + sewLabor(0.6/ft²) + bottom + hang`, then
  `/(1−margin)`.

They differ **2.3× on the main drape** and even disagree on margin (Quick Design
30%, estimator 38%). Neither is Peak doctrine. Jeff: *"recreate the curtain
pricing structure."*

Meanwhile the just-shipped lineset auto-weights (`goods.ts`) already own the
finished drape geometry (W, H, fullness, qty, fabric per type). Pricing should
build from that **same geometry**, so a drape of a given fabric and size costs the
same whether budgeted or quoted.

## What a real order taught us

Jeff supplied Rose Brand quote **423939 (2026-07-23)** — three real drape lines:

| Line | Fabric | Finished | Full | Qty | $ each |
|---|---|---|---|---|---|
| 1 border | Charisma 25oz | 3′ h × 50′ w | 50% | 1 | $1,395 |
| 2 main | Charisma 25oz | 15′7″ h × 23′ w | 50% | 2 | $2,080 |
| 3 legs | Encore 22oz | 10′11″ h × 9′6″ w | 50% | 4 | $525 |

Reverse-engineering it produced two findings that shape this design:

**1. A single per-ft² rate does not fit.** The same fabric (Charisma) implies
$6.20/ft² on the wide-short border but $3.87/ft² on the tall main. A cost term
scales with **width**, not area — physically the top webbing and bottom chain hem,
which run the full sewn width regardless of height.

**2. The data discriminates between two candidate two-parameter models.** Fit to
the two Charisma lines, then tested against the Encore line:

- *area + fixed per-panel charge* → forces Encore's fabric rate **negative**.
  Refuted.
- *area + per-width making charge* → Encore's rate lands at a sensible
  **$2.58/ft²**, sharing one width rate. **Fits all three within a dollar.**

So the cost structure is **two terms: area (fabric) + width (making)**. Calibrated
from the quote (these are Rose Brand's rates *to Peak*):

| Fabric | area rate $/ft² sewn | making rate $/ft width |
|---|---|---|
| Charisma 25oz | 3.31 | 8.66 |
| Encore 22oz | 2.58 | 8.66 (shared) |

Reproduces all three lines: border $1,395, main $2,080, legs $525.

## Decisions (locked with Jeff)

1. **Make-it-ourselves cost model, not a Rose Brand lookup.** The estimator
   computes cost *as if Peak's own curtain shop built the drape*, tuned to land
   **~10% above** Rose Brand. This lets Peak quote instantly and safely without
   waiting on a Rose Brand quote. *(Jeff, "build the estimator as if we are making
   our curtains… estimating slightly higher than Rosebrand… turn and burn quotes.")*
2. **Two-term structure** — `cost = qty × (sewnArea × fabricRate + sewnWidth ×
   makingRate)`, where `sewnWidth = finishedW × (1 + fullness)` and `sewnArea =
   sewnWidth × finishedH`. This is exactly a curtain shop's cost shape (area =
   fabric, width = making), and it keeps the estimate a *consistent* ~10% above
   Rose Brand across every drape shape — unlike the old build-up, which ran +27%
   on the main and −14% on the border.
3. **Per-line Rose Brand cost override.** Any curtain line's computed cost can be
   replaced by a real Rose Brand price when quoted — better margin, or a sharper
   customer price.
4. **Flat 30% margin on price**: `price = cost / (1 − 0.30)`. *(Jeff.)* Quick
   Design already uses 30%; the estimator's 38% drops to 30% to agree.
5. **Fabric assigned per drape TYPE, with tier as a grade shifter.** A 2-D
   `[tier][type] → fabric` table. The **better** row is Peak's real spec (from the
   quote): mains/borders = Charisma 25oz, legs = Encore 22oz, cyc = muslin. Good
   and Best shift the whole job a grade down/up. Fabric drives **both** weight and
   price, so this supersedes the current per-tier-only fabric map in `goods.ts`
   and the lineset tier selector stays meaningful. *(Jeff.)*
6. **Track, pipe, install labor, and freight stay separate lines** — the Rose
   Brand quote is drapes only; bottom chain is inside the drape (the making rate),
   track/pipe are rigging, labor is its own line, freight is the section freight %.
7. **Both tools consume one shared pricing function** (`curtain-pricing.ts`): the
   estimator quote prices the user's typed takeoff dimensions; Quick Design prices
   `goods.ts`-derived dimensions. One math, so budget and quote agree per drape.

## 1. The pricing function

New pure module `src/lib/design/curtain-pricing.ts`:

```ts
export type CurtainRates = {
  /** Make-it-ourselves area cost, $/ft² of SEWN fabric (finished × fullness). */
  fabricRate: number;
  /** Make-it-ourselves making cost, $/ft of SEWN width (webbing, chain hem,
   *  side hems, setup) — fabric-independent. Pleated velour uses the full rate;
   *  flat goods (a 0%-fullness cyc) use the lower cyc rate — see §1.1. */
  makingRate: number;
};

export type CurtainCostInput = {
  finishedWidthFt: number;
  finishedHeightFt: number;
  fullnessPct: number;   // 50 for velour, 0 for a flat cyc
  qty: number;
  /** When set, this real Rose Brand (or other vendor) price REPLACES the
   *  computed make-it cost for this line. */
  vendorCostOverride?: number | null;
};

export type CurtainCost = {
  sewnWidthFt: number;
  sewnAreaSqft: number;
  makeCostEach: number;   // computed make-it-ourselves unit cost
  costEach: number;       // vendorCostOverride ?? makeCostEach
  costTotal: number;      // costEach × qty
  overridden: boolean;
};

export const CURTAIN_MARGIN = 0.30;

/** Make-it-ourselves unit cost from the two-term model. Pure. */
export function curtainCost(input: CurtainCostInput, rates: CurtainRates): CurtainCost;

/** price = cost / (1 − margin). */
export function curtainPrice(costEach: number, margin?: number): number;
```

- `sewnWidthFt = finishedWidthFt × (1 + fullnessPct/100)`
- `sewnAreaSqft = sewnWidthFt × finishedHeightFt`
- `makeCostEach = sewnAreaSqft × fabricRate + sewnWidthFt × makingRate`
- `costEach = vendorCostOverride ?? makeCostEach`
- `costTotal = costEach × qty`

The cyc uses `fullnessPct: 0`, so its sewn area equals its finished face — it
hangs flat, exactly as the weights model already treats it.

### 1.1 Two making rates — pleated vs flat

A pleated velour drape and a flat muslin cyc are built differently, so the making
term takes one of two rates:

```ts
export const DEFAULT_MAKING_RATE = 9.53;     // $/ft sewn width — pleated velour (≈ RB 8.66 +10%)
export const DEFAULT_CYC_MAKING_RATE = 4.75; // $/ft — flat goods (cyc): no pleating setup
```

The caller supplies the right rate. The clean rule both consumers follow: **flat
goods (fullness 0) use `DEFAULT_CYC_MAKING_RATE`, everything else uses
`DEFAULT_MAKING_RATE`.** A tiny helper keeps this in one place:

```ts
export function makingRateFor(fullnessPct: number): number {
  return fullnessPct <= 0 ? DEFAULT_CYC_MAKING_RATE : DEFAULT_MAKING_RATE;
}
```

Both rates are editable pricing knobs. The cyc rate is a seed (no cyc on the
reconciled quote) — flagged in §6.

## 2. Fabric rates on the catalog

Rates live per-fabric on the catalog Fabric rows so one fabric choice drives price
(here) and weight (via the existing `oz`/`fabricFromPart` join). Add to
`CatalogPart`:

```ts
  /** Curtain make-it-ourselves area cost, $/ft² of sewn fabric. Fabric rows
   *  only. Seeded ~10% above the Rose-Brand-reconciled rate; edit toward real
   *  shop cost when the curtain shop exists. */
  curtainAreaRate?: number;
```

`makingRate` is a global default (fabric-independent per the data), with the flat
cyc variant defined in §1.1. Both are editable pricing knobs.

### Seeds (make-it ≈ Rose Brand + 10%)

The catalog is **missing Charisma 25oz and Encore 22oz** — the fabrics Peak
actually uses. Add them, plus `curtainAreaRate` on every velour the fabric table
(§3) actually references. Only five fabrics are used; anchored fabrics come
straight from the quote × 1.10, the rest are weight-scaled seeds flagged for
calibration:

| SKU | Fabric | oz | curtainAreaRate | basis |
|---|---|---|---|---|
| RB-CHAR-25 *(new)* | Charisma 25oz | 25 | **3.64** | anchor (RB 3.31 ×1.10) |
| RB-EN-22 *(new)* | Encore 22oz | 22 | **2.84** | anchor (RB 2.58 ×1.10) |
| RB-EN-16 *(exists — add rate only)* | Encore 16oz | 16 | 2.10 | seed, flag |
| RB-MV-MN *(exists)* | Memorable 25oz | 25 | 3.64 | seed (25oz ≈ Charisma), flag |
| RB-MUS *(exists)* | Seamless Muslin | 6 | 0.90 | seed, flag |

Only **two new SKUs** are added (Charisma 25oz, Encore 22oz — the fabrics Peak
uses but the catalog lacks). The other three exist and gain a `curtainAreaRate`.
Marvel 21oz and Imperial 32oz are **not** used by the table, so they get no
curtain rate. The existing raw `costPerSqft` field is left untouched (other
consumers may use it); `curtainAreaRate` is the new, curtain-specific number.

## 3. The fabric-by-type-and-tier table (goods.ts)

Replace the current per-tier-only `TIER_FABRIC` with a 2-D table. Confirmed with
Jeff 2026-07-24 (the **better** row is Peak's real spec from the quote):

| Drape type | good | **better (real)** | best |
|---|---|---|---|
| Draw / Midstage Draw / Rear | Encore 22oz | **Charisma 25oz** | Memorable 25oz |
| Border | Encore 22oz | **Charisma 25oz** | Memorable 25oz |
| Legs | Encore 16oz | **Encore 22oz** | Charisma 25oz |
| CYC | Muslin | **Muslin** | Muslin |

Note the fabrics overlap across tiers by design — Encore 22oz is both good-mains
and better-legs; Charisma 25oz is both better-mains and best-legs. Five distinct
fabrics total (Encore 16/22, Charisma 25, Memorable 25, Muslin).

`drapeRule(type, dims, tier)` keeps its signature and return shape; only the
fabric lookup changes from `TIER_FABRIC[tier][role]` to
`FABRIC_BY_TYPE_TIER[type][tier]`. Because fabric drives weight too, **the weights
recompute** on the real fabrics — more correct, and the weights tests that pin
specific SKUs (e.g. "better draw resolves to RB-MARVEL") update to the new
values (better draw → RB-CHAR-25).

## 4. Rebuilding the two consumers

### Estimator quote — `computeCurtain` (pricing.ts)

Rebuild to the two-term model. The configurator today collects fabric, W, H,
fullness, **bottom**, and **hang**. Under the new model bottom (chain) is inside
the making rate and hang (track) is a separate rigging line, so **both dropdowns
are removed** (Jeff, 2026-07-24) — the configurator becomes fabric + finished W +
H + fullness + qty, plus a **"Rose Brand cost"** override field per line.
`curtainCost` + `curtainPrice` produce the numbers, using `makingRateFor(fullness)`
so a flat cyc gets the lower making rate. Existing curtain records (which stored
bottom/hang) still load; the dropped fields are simply ignored.

### Quick Design budget — curtain block (engine.ts)

Replace the five lump `addCurtain(area × rate)` calls. For each toggled drape,
derive finished geometry from `drapeRule` at the venue's PW/PH and the selected
tier, then price via `curtainCost`/`curtainPrice`. Quantity stays Quick Design's
own depth-block heuristic (the estimate's job), but the per-drape recipe and math
are now identical to the quote — so budget and quote agree per drape. The Quick
Design margin was already 30%; no margin change there.

## 5. What is explicitly NOT in scope

- **No track/pipe/labor/freight repricing.** Those lines are untouched; only the
  curtain (soft goods) line changes.
- **No auto-import of Rose Brand quotes.** The override is a manual per-line cost
  entry. Parsing a Rose Brand PDF into line overrides is a possible later feature.
- **No curtain-shop cost model.** The make-it rates are seeded at RB+10% and
  edited by hand; a real shop cost breakdown (raw fabric + measured labor) is
  future work when the shop exists.
- **No change to how the lineset builder prices** — the lineset builder shows
  weight, not price, and that stays. (It *could* show a $ later; out of scope.)

## 6. Open questions

All resolved with Jeff 2026-07-24 except the standing calibration item:

- ✅ **Fabric grades (§3)** — confirmed (mains Encore22/Charisma25/Memorable25;
  legs Encore16/Encore22/Charisma25; cyc muslin all tiers).
- ✅ **Encore 15 vs 16** — use the existing catalog Encore 16oz (RB-EN-16); no
  new 15oz SKU. Rose Brand's real Encore is 16oz IFR.
- ✅ **Cyc making rate** — a lower flat-goods rate (`DEFAULT_CYC_MAKING_RATE`,
  seeded $4.75/ft), applied whenever fullness is 0 (§1.1).
- ✅ **Configurator bottom/hang** — removed from the estimator curtain
  configurator (§4).

**Standing calibration item (not blocking):** the three non-anchor
`curtainAreaRate`s (Encore 16oz, Memorable 25oz, Muslin) and the cyc making rate
are weight-scaled seeds. Refine them as more real Rose Brand quotes come in —
particularly a **cyc** line and a **Memorable 25oz** line, which the reconciled
quote 423939 did not contain. The anchors (Charisma 25oz, Encore 22oz, pleated
making rate) are grounded in real data.

## 7. Testing

- **Reconciliation (the calibration anchor):** with the Rose-Brand rates
  (Charisma 3.31/8.66, Encore-22 2.58/8.66, no +10%), `curtainCost` reproduces all
  three quote lines within $1 — border $1,395, main $2,080, legs $525. This test
  pins the model to reality; if it drifts, the model is wrong.
- **10% cushion:** with the seeded make-it rates, each line lands 8–12% above the
  Rose Brand price.
- **Override precedence:** a `vendorCostOverride` replaces the make cost and flags
  the line `overridden`; `costTotal = override × qty`.
- **Cyc flatness:** a 0%-fullness cyc's sewn area equals its finished face (no
  1.5× fullness applied).
- **Budget = quote:** the same drape (fabric, W, H, fullness) priced through the
  Quick Design path and the estimator path yields the same per-unit cost and
  price.
- **Weights unchanged-in-shape, changed-in-fabric:** after the fabric-table swap,
  a better-tier main resolves to Charisma 25oz for both its weight and its price;
  the weight recomputes but the pipeline is intact.
- **Margin:** `curtainPrice(cost)` = `cost / 0.70` at the 30% default.
