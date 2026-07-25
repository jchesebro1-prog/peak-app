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
