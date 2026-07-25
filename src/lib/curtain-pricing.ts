import { round2, type CurtainSpec, type SellCoeffs } from "./curtain-geom";
import { makingRateFor, DEFAULT_MAKING_RATE, DEFAULT_CYC_MAKING_RATE } from "@/lib/design/curtain-pricing";

/**
 * Authoritative curtain pricing (IDEAS #48) — SERVER ONLY.
 *
 * This module holds the pricing secrets: the 30% target margin and the cost
 * coefficients. It must never be imported into a client component, or the
 * margin/cost basis would ship to the customer's browser. The customer's
 * live preview instead uses ./curtain-geom with sell numbers this module
 * precomputes (sellCoeffs) plus a per-fabric sell price/sq ft.
 *
 * This applies the SHARED two-term model (@/lib/design/curtain-pricing —
 * the same math the internal estimator and Quick Design use), at a 30%
 * default margin. If you change the shared model, this module picks it up
 * automatically; it no longer carries its own duplicate cost formula.
 */

export const CURTAIN_MARGIN = 0.3;
// (The old shared `M = 1 - CURTAIN_MARGIN` divisor moved into each function —
// margin is a parameter since customer tiers, item 11/D88.)

/**
 * AUTHORITATIVE — applies the shared two-term model. Takes the fabric's
 * curtainAreaRate (per-fabric, $/ft² of sewn fabric); returns cost + sell
 * price for one curtain. Used on submit to persist the draft quote, so what
 * the team opens matches to the cent.
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
  const rawCost = sewnArea * (fabricAreaRate || 0) + sewnWidth * makingRateFor(fullness);
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  const costEach = round2(rawCost);
  const priceEach = rawCost > 0 ? round2(rawCost / m) : 0; // price from RAW cost, not rounded cost
  return { costEach, priceEach };
}

/**
 * The sell-side making coefficients handed to the client for its live
 * preview — each making cost coefficient divided by (1 − margin). The
 * fabric sell rate is per-fabric, handled by fabricSellPerSqft. No margin or
 * cost value crosses to the browser, only these already-marked-up sell
 * numbers.
 */
export function sellCoeffs(margin: number = CURTAIN_MARGIN): SellCoeffs {
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  return { makingPerFt: DEFAULT_MAKING_RATE / m, cycMakingPerFt: DEFAULT_CYC_MAKING_RATE / m };
}

/** A fabric's customer-facing sell price/sq ft (curtainAreaRate ÷ (1 − margin)). */
export function fabricSellPerSqft(
  fabricAreaRate: number,
  margin: number = CURTAIN_MARGIN
): number {
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  return (fabricAreaRate || 0) / m;
}
