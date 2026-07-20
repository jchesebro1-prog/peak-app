import { curtainAreas, round2, type CurtainSpec, type SellCoeffs } from "./curtain-geom";

/**
 * Authoritative curtain pricing (IDEAS #48) — SERVER ONLY.
 *
 * This module holds the pricing secrets: the 38% target margin and the cost
 * coefficients. It must never be imported into a client component, or the
 * margin/cost basis would ship to the customer's browser. The customer's
 * live preview instead uses ./curtain-geom with sell numbers this module
 * precomputes (sellCoeffs) plus a per-fabric sell price/sq ft.
 *
 * The equations are an EXACT port of the team estimator's computeCurtain()
 * (src/app/(app)/estimator/pricing.ts) — margins price as sell = cost / (1 −
 * margin). If you change the estimator's curtain math, change it here too.
 */

export const CURTAIN_MARGIN = 0.38;
// (The old shared `M = 1 - CURTAIN_MARGIN` divisor moved into each function —
// margin is a parameter since customer tiers, item 11/D88.)

/** Sew labor per sq ft of sewn fabric. */
const SEW_COST_PER_SQFT = 0.6;
/** Bottom finish cost per ft of finished width. */
const BOTTOM_COST_PER_FT: Record<string, number> = { Chain: 2.5, Pocket: 1.8, None: 0 };
/** Hang hardware cost per ft of finished width. */
const HANG_COST_PER_FT: Record<string, number> = { Pipe: 3.0, Track: 12.0, Other: 5.0, None: 0 };

/** Non-fabric assembly cost (sew + bottom + hang). */
function assemblyCost(d: CurtainSpec): number {
  const { fabricArea, width } = curtainAreas(d);
  return (
    fabricArea * SEW_COST_PER_SQFT +
    width * (BOTTOM_COST_PER_FT[d.bottom] ?? 0) +
    width * (HANG_COST_PER_FT[d.hang] ?? 0)
  );
}

/**
 * AUTHORITATIVE — exact port of estimator computeCurtain(). Takes Peak's fabric
 * cost basis; returns cost + sell price for one curtain. Used on submit to
 * persist the draft quote, so what the team opens matches to the cent.
 */
export function curtainCost(
  d: CurtainSpec,
  costPerSqft: number,
  /** Margin-on-price fraction; the customer's tier seeds this (item 11,
   *  D88). Default stays the legacy CURTAIN_MARGIN. */
  margin: number = CURTAIN_MARGIN
): { costEach: number; priceEach: number } {
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  const { fabricArea } = curtainAreas(d);
  const costEach = fabricArea * (costPerSqft || 0) + assemblyCost(d);
  const priceEach = costEach > 0 ? costEach / m : 0;
  return { costEach: round2(costEach), priceEach: round2(priceEach) };
}

/**
 * The sell-side assembly coefficients handed to the client for its live
 * preview — each cost coefficient divided by (1 − margin). No margin or cost
 * value crosses to the browser, only these already-marked-up sell numbers.
 */
export function sellCoeffs(margin: number = CURTAIN_MARGIN): SellCoeffs {
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  return {
    sewPerSqft: SEW_COST_PER_SQFT / m,
    bottomPerFt: { Chain: 2.5 / m, Pocket: 1.8 / m, None: 0 },
    hangPerFt: { Pipe: 3.0 / m, Track: 12.0 / m, Other: 5.0 / m, None: 0 },
  };
}

/** A fabric's customer-facing sell price/sq ft (cost basis ÷ (1 − margin)). */
export function fabricSellPerSqft(
  costPerSqft: number,
  margin: number = CURTAIN_MARGIN
): number {
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  return (costPerSqft || 0) / m;
}
