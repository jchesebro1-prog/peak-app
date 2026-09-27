# Punch #227 — Fabric prices by a flat, editable $/sq ft

Date: 2026-09-26 · Branch `feat/punch-inbox-tasks` (Batch 2).

Jeff (2026-09-26): "We need fabric to price via sqft." Picks in chat: **an editable $/sq ft rate** on
fabric parts (catalog editor + Import hub), and **flat $/sq ft only** — drop the separate per-foot
making charge; the sq-ft rate carries everything.

## Recon
- Every curtain path already prices by area: `src/lib/design/curtain-pricing.ts` ~73-93
  `cost = sewnAreaSqft × fabricRate + sewnWidthFt × makingRate` (makingRate $9.53/ft pleated,
  $4.75/ft flat, ~46-53; rebuild spec 2026-07-24, Rose Brand calibration; D303). Mirrors:
  `src/lib/curtain-pricing.ts` (`fabricSellPerSqft`, `sellCoeffs`), `src/lib/curtain-geom.ts` ~80-86,
  `src/lib/design/equipment-pricing.ts` ~36-55, Estimator `estimator/pricing.ts` ~238-266
  (`computeCurtain`), portal estimate `portal/actions.ts` ~191-205, Quick Design `quick/engine.ts`
  ~528-545, Grid `grid-curtains.ts` ~44-72.
- Rate source: `curtainAreaRate ?? SEED_FABRIC_RATES[sku] ?? costPerSqft ?? 0`
  (Equipment map: `curtainAreaRate ?? costPerSqft`, no seed fallback). No UI edits
  `curtainAreaRate`/`costPerSqft`; the Import hub (`import/registry.ts` ~267-282) maps only
  unit/list/cost/mapPrice, so an imported fabric prices at $0. 5 of the 10 seed fabrics have no
  `curtainAreaRate`.

## Changes
1. **One rate, flat.** A fabric's price basis is `curtainAreaRate` = **cost per sq ft of sewn fabric,
   including making/sewing**. `cost = sewnAreaSqft × fabricRate` (sewn area = finished width ×
   (1 + fullness) × height, unchanged). The `makingRate` term is removed from the shared model and
   from every mirror listed above (keep `makingRateFor()` exported only if something else needs it;
   otherwise delete it and its constants). `vendorCostOverride` keeps working. Sell = cost ÷ (1 −
   margin) exactly as today.
2. **Fallback chain unchanged in order** (`curtainAreaRate ?? SEED ?? costPerSqft ?? 0`) and the
   Equipment map uses the same helper (single `fabricAreaRateOf(part)` pure function used by every
   path — no divergent chains).
3. **Catalog editor:** fabric parts (category Fabric) show a "$/sq ft sewn (includes making)" input
   (`curtainAreaRate`) with a small converter: enter $/linear yard + bolt width (in) → fills
   `$/lin-yd ÷ (3 × boltWidthIn / 12)`; or $/sq yd → ÷ 9. Saved through the existing part save path
   (`mergeUpsert` rules respected), `requireUser` like other part edits.
4. **Import hub:** the catalog/price-book import gains optional columns "Fabric $/sq ft" (→
   `curtainAreaRate`), "Bolt width (in)" (→ `boltWidthIn`); exact-header-only like the spec columns;
   a price-only import never resets them.
5. **Visibility:** curtain modal / swap search labels read "$X/sq ft sewn (incl. making)". A fabric with
   no rate shows "No $/sq ft set" and prices at $0 with the existing "needs a part"/warning paths.
6. Quote lines stay one line per drape (`1 ea`), description unchanged.

## Risk (must be logged in DECISIONS)
Dropping the making term lowers every curtain price until fabric rates are raised to include
sewing. The seed rates were fabric-only. The DECISIONS entry states this and the conversion; the
catalog editor's help text says the rate must include making.

## Testing
Pure: new cost formula (no width term) across flat and pleated; every mirror returns the same number
for the same inputs (parity assertion across curtain-pricing, curtain-geom, equipment-pricing,
estimator computeCurtain, grid priceGridCurtains); converter math (54″ velour: $/lin-yd ÷ 13.5);
fallback chain via the single helper. Import: columns map, price-only import preserves them. Update
existing curtain assertions whose totals change (list each). Four gates + `next build`.
