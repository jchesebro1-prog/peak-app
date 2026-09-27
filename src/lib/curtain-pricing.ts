import { round2, type CurtainSpec } from "./curtain-geom";
import { sewnAreaRate, type CurtainRates } from "./design/curtain-pricing";

/**
 * Authoritative curtain pricing (IDEAS #48) — SERVER ONLY.
 *
 * This module holds a pricing secret: the 30% default margin. It must never be
 * imported into a client component, or the margin would ship to the
 * customer's browser. The customer's live preview instead runs ./curtain-geom
 * over the per-fabric SELL price/sq ft this module precomputes
 * (fabricSellPerSqft).
 *
 * Same model as @/lib/design/curtain-pricing (#227, #227 late): cost = sewn
 * area × the fabric's $/sq ft × (1 + sewing %), through its sewnAreaRate.
 * The caller resolves the fabric rate with fabricAreaRateOf and the sewing %
 * with loadCurtainSewingPct.
 */

export const CURTAIN_MARGIN = 0.3;

/**
 * AUTHORITATIVE — cost + sell price for one curtain at a fabric's area rate
 * plus the sewing adder. Used on submit to persist the draft quote, so what
 * the team opens matches to the cent.
 */
export function curtainCost(
  d: CurtainSpec,
  rates: CurtainRates,
  /** Margin-on-price fraction; the customer's tier seeds this (item 11,
   *  D88). Default stays the legacy CURTAIN_MARGIN. */
  margin: number = CURTAIN_MARGIN
): { costEach: number; priceEach: number } {
  const w = parseFloat(d.width) || 0;
  const h = parseFloat(d.height) || 0;
  const fullness = parseFloat(d.fullness) || 0;
  const sewnWidth = w * (1 + fullness / 100);
  const sewnArea = sewnWidth * h;
  const rawCost = sewnArea * sewnAreaRate(rates.fabricRate, rates.sewingPct);
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  const costEach = round2(rawCost);
  const priceEach = rawCost > 0 ? round2(rawCost / m) : 0; // price from RAW cost, not rounded cost
  return { costEach, priceEach };
}

/** A fabric's customer-facing sell price per sq ft sewn, sewing included (sewn area rate ÷ (1 − margin)). */
export function fabricSellPerSqft(
  rates: CurtainRates,
  margin: number = CURTAIN_MARGIN
): number {
  const m = 1 - (margin > 0 && margin < 1 ? margin : CURTAIN_MARGIN);
  return sewnAreaRate(rates.fabricRate, rates.sewingPct) / m;
}
