import { round2, type CurtainSpec } from "./curtain-geom";
import { DEFAULT_MARKUP, MARKUP_MAX, sellAt } from "@/lib/markup";
import { sewnAreaRate, type CurtainRates } from "./design/curtain-pricing";

/**
 * Authoritative curtain pricing (IDEAS #48) — SERVER ONLY.
 *
 * This module holds a pricing secret: the 43% default markup. It must never be
 * imported into a client component, or the markup would ship to the
 * customer's browser. The customer's live preview instead runs ./curtain-geom
 * over the per-fabric SELL price/sq ft this module precomputes
 * (fabricSellPerSqft).
 *
 * Same model as @/lib/design/curtain-pricing (#227, #227 late): cost = sewn
 * area × the fabric's $/sq ft × (1 + sewing %), through its sewnAreaRate.
 * The caller resolves the fabric rate with fabricAreaRateOf and the sewing %
 * with loadCurtainSewingPct.
 */

/** #367: Peak's flat curtain markup (the old 30 % margin, rounded). */
export const CURTAIN_MARKUP = DEFAULT_MARKUP;
const usable = (k: number) => (Number.isFinite(k) && k > 0 && k <= MARKUP_MAX ? k : CURTAIN_MARKUP);

/**
 * AUTHORITATIVE — cost + sell price for one curtain at a fabric's area rate
 * plus the sewing adder. Used on submit to persist the draft quote, so what
 * the team opens matches to the cent.
 */
export function curtainCost(
  d: CurtainSpec,
  rates: CurtainRates,
  /** Markup on cost (#367); the customer's tier seeds this (item 11,
   *  D88). Default is CURTAIN_MARKUP. */
  markup: number = CURTAIN_MARKUP
): { costEach: number; priceEach: number } {
  const w = parseFloat(d.width) || 0;
  const h = parseFloat(d.height) || 0;
  const fullness = parseFloat(d.fullness) || 0;
  const sewnWidth = w * (1 + fullness / 100);
  const sewnArea = sewnWidth * h;
  const rawCost = sewnArea * sewnAreaRate(rates.fabricRate, rates.sewingPct);
  const costEach = round2(rawCost);
  const priceEach = rawCost > 0 ? round2(sellAt(rawCost, usable(markup))) : 0; // price from RAW cost, not rounded cost
  return { costEach, priceEach };
}

/** A fabric's customer-facing sell price per sq ft sewn, sewing included (sewn area rate × (1 + markup)). */
export function fabricSellPerSqft(
  rates: CurtainRates,
  markup: number = CURTAIN_MARKUP
): number {
  return sellAt(sewnAreaRate(rates.fabricRate, rates.sewingPct), usable(markup));
}
