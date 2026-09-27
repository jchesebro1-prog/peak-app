/**
 * Curtain pricing — one shared model for the budget (Quick Design, the Grid
 * Equipment map) and the quote (estimator, Grid, portal), built from the same
 * finished geometry the lineset weights use (spec 2026-07-24-curtain-pricing-
 * rebuild).
 *
 * #227 (2026-09-26, Jeff: "We need fabric to price via sqft"): ONE flat
 * area rate — the two-term model's per-foot making charge (the Rose Brand
 * 423939 calibration) is gone.
 *
 * #227 late (2026-09-27, Jeff: "a 10% adder to the fabric pricing for sewing
 * labor … built into the estimators not on the fabric cost"): a fabric's
 * `curtainAreaRate` is its FABRIC cost per sq ft only; every curtain estimate
 * adds the sewing rule on top, here and nowhere else:
 *
 *   cost = sewn area × fabric rate × (1 + sewing % ÷ 100)
 *
 * The sewing % is one Estimating Rule (SEWING_PCT_ID, default 10). A per-line
 * vendor cost override is the FULL cost — it replaces the computed cost, with
 * no sewing on top.
 */

/** #227 late — the Estimating Rules id of the sewing-labor adder (a percent number, 10 = 10 %). */
export const SEWING_PCT_ID = "curtains.sewingPct";
export const DEFAULT_SEWING_PCT = 10;
export const SEWING_PCT_MAX = 100;

/**
 * The sewing % from a stored value: missing (undefined/null), non-number,
 * negative or non-finite → 10; above 100 → 100; a stored 0 stays 0.
 */
export function sewingPctFrom(raw: unknown): number {
  if (raw === null || raw === undefined) return DEFAULT_SEWING_PCT;
  const v = typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(v) && v >= 0 ? Math.min(v, SEWING_PCT_MAX) : DEFAULT_SEWING_PCT;
}

/** The sewing rule every curtain estimate prices with — handed to client code as data. */
export type CurtainSewing = { sewingPct: number };

export type CurtainRates = CurtainSewing & {
  /** FABRIC cost per ft² of sewn fabric area (finished width × (1 + fullness) × height) — no sewing in it. */
  fabricRate: number;
};

/**
 * THE sewn area rate: fabric $/sq ft × (1 + sewing %). Every mirror (portal,
 * Grid, the client preview's sell rate) multiplies sewn area by this, so they
 * agree to the cent. A non-positive or non-finite fabric rate is 0.
 */
export function sewnAreaRate(fabricRate: number, sewingPct: number): number {
  const r = Number(fabricRate);
  if (!(Number.isFinite(r) && r > 0)) return 0;
  return r * (1 + sewingPctFrom(sewingPct) / 100);
}

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
 * `curtainAreaRate` of its own. FABRIC-ONLY (Rose-Brand-reconciled × 1.10);
 * the sewing adder is applied on top like any fabric rate (#227 late).
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

/** Make-it cost (sewn area × fabric rate × (1 + sewing %)), with optional vendor override (the full cost). Pure. */
export function curtainCost(input: CurtainCostInput, rates: CurtainRates): CurtainCost {
  const sewnWidthFt = input.finishedWidthFt * (1 + input.fullnessPct / 100);
  const sewnAreaSqft = sewnWidthFt * input.finishedHeightFt;
  const makeCostEach = round2(sewnAreaSqft * sewnAreaRate(rates.fabricRate, rates.sewingPct));
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
