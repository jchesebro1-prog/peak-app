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
