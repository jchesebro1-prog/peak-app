import { round2 } from "./pricing";
import type { SpecItem, SpecSection } from "./types";

/**
 * #254 (D87 amended) — a customer/contact change that moves the quote's
 * pricing tier re-prices the lines that are STILL at the previous tier's
 * margin; everything hand-priced is kept.
 *
 * Pure: the Estimator applies the result to its sections state and the
 * normal Save persists it (the server recomputes value, #242). Nothing here
 * ever reaches the customer document — tiers are internal (D87).
 *
 * How each line kind was seeded, and so how it is recognised:
 * - catalog part (addPart), CSV-imported catalog hit with no stated sell
 *   (importMaterials), vendor-quote line (commitVendorQuote), custom
 *   allowance with no typed sell (addCustomPart), curtain (computeCurtain →
 *   curtainPrice), and any of those flagged `option` — all stored as cost +
 *   sell with sell = round2(cost ÷ (1 − m)), m = the tier stamp or the 0.30
 *   fallback. One rule, `seedMarginOf`.
 * - labor (addLabor → buildLaborItems) — also stored as cost + sell, but the
 *   margin went through the labor draft's WHOLE-PERCENT field (freshLabor:
 *   String(Math.round(m × 100)); computeLabor clamps to ≤ 95 %), and the
 *   modal's single rounded total nudges the LAST line by its rounding drift
 *   (≤ 5¢ per line). So labor is re-seeded at `laborSeedMarginOf` and matched
 *   within LABOR_REPRICE_TOLERANCE.
 * - fixture (addFixture → fixtureBomLine) — sell is the assembly's own
 *   component list prices, never the tier; left alone and not counted.
 * - kept as hand-priced: an ext-sell override, a POR line, a line with no
 *   cost, or a sell that doesn't match the previous tier's seed.
 */

/** The client's fallback when no tier margin is stamped (addPart & co). */
export const TIER_FALLBACK_MARGIN = 0.3;
/** A seeded sell matches its seed to the cent (rounding only). */
export const TIER_REPRICE_TOLERANCE = 0.01;
/** Labor's last line carries buildLaborItems' rounding-drift nudge (≤ 5¢). */
export const LABOR_REPRICE_TOLERANCE = 0.05;

/** The margin a material line was seeded at — the stamp, else 0.30. */
export function seedMarginOf(m: number | null | undefined): number {
  return m != null && Number.isFinite(m) && m > 0 && m < 1 ? m : TIER_FALLBACK_MARGIN;
}

/** The margin a labor line was seeded at — freshLabor's whole percent,
 *  clamped the way computeLabor reads it. */
export function laborSeedMarginOf(m: number | null | undefined): number {
  return Math.min(0.95, Math.max(0, Math.round(seedMarginOf(m) * 100) / 100));
}

const sellAt = (cost: number, margin: number) => round2(cost / (1 - margin));

export type TierRepriceResult = {
  /** The same array (by reference) when nothing was re-priced. */
  sections: SpecSection[];
  repriced: number;
  kept: number;
};

type Verdict = { kind: "reprice"; price: number } | { kind: "kept" } | { kind: "skip" };

function classify(it: SpecItem, prev: number | null, next: number): Verdict {
  if (it.fixture) return { kind: "skip" };
  if (it.extSellOverride != null && Number.isFinite(it.extSellOverride)) return { kind: "kept" };
  if (it.por) return { kind: "kept" };
  if (!(it.cost > 0)) return { kind: "kept" };
  if (it.labor) {
    const from = laborSeedMarginOf(prev);
    const to = laborSeedMarginOf(next);
    if (from === to) return { kind: "skip" };
    return Math.abs(it.price - sellAt(it.cost, from)) <= LABOR_REPRICE_TOLERANCE + 1e-9
      ? { kind: "reprice", price: sellAt(it.cost, to) }
      : { kind: "kept" };
  }
  const from = seedMarginOf(prev);
  return Math.abs(it.price - sellAt(it.cost, from)) <= TIER_REPRICE_TOLERANCE + 1e-9
    ? { kind: "reprice", price: sellAt(it.cost, next) }
    : { kind: "kept" };
}

/**
 * Re-price every tier-seeded line from `prev` (the stamp in effect; null →
 * the 0.30 fallback) to `next` (the new stamp). Identical margins, or a
 * `next` that isn't a usable margin, change nothing.
 */
export function repriceForTier(
  sections: SpecSection[],
  prev: number | null | undefined,
  next: number | null | undefined
): TierRepriceResult {
  if (next == null || !Number.isFinite(next) || !(next > 0 && next < 1)) return { sections, repriced: 0, kept: 0 };
  const prevM = prev != null && Number.isFinite(prev) && prev > 0 && prev < 1 ? prev : null;
  if (seedMarginOf(prevM) === next) return { sections, repriced: 0, kept: 0 };
  let repriced = 0;
  let kept = 0;
  const out = sections.map((sec) => {
    let changed = false;
    const items = sec.items.map((it) => {
      const v = classify(it, prevM, next);
      if (v.kind === "kept") kept++;
      if (v.kind !== "reprice") return it;
      repriced++;
      if (v.price === it.price) return it;
      changed = true;
      return { ...it, price: v.price };
    });
    return changed ? { ...sec, items } : sec;
  });
  return { sections: repriced ? out : sections, repriced, kept };
}

/** "Re-priced 14 lines to Gold (20%) · kept 2 hand-priced lines" — the
 *  banner's text (the Undo button follows it). Internal only. */
export function tierRepriceMessage(repriced: number, kept: number, tierLabel: string, margin: number): string {
  const pct = Math.round(margin * 1000) / 10;
  const lines = (n: number) => n + (n === 1 ? " line" : " lines");
  const head = "Re-priced " + lines(repriced) + " to " + tierLabel + " (" + pct + "%)";
  return kept > 0 ? head + " · kept " + kept + " hand-priced " + (kept === 1 ? "line" : "lines") : head;
}
