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
