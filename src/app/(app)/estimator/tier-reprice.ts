import { syncLaborDraftMargins } from "./labor-group";
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
 * - track (#274, track-bom.ts) — each part priced as addPart would price
 *   it, the line selling for their sum, which is the seed on the line's cost
 *   when every part has a cost: an ordinary seeded line (its parts re-seed
 *   with it, `reseedTrackComponents`).
 * - fixture (addFixture → fixtureBomLine) — sell is the assembly's own
 *   component list prices, never the tier; left alone and not counted.
 * - kept, hand-priced: an ext-sell override, or a sell that doesn't match
 *   the previous tier's seed. The banner names these.
 * - kept, untouched: a POR line, a line with no cost, or a fixture — never
 *   tier-priced in the first place, so the banner doesn't count them as
 *   hand-priced (#254 review).
 */

/** The client's fallback when no tier margin is stamped (addPart & co). */
export const TIER_FALLBACK_MARGIN = 0.3;
/** A seeded sell matches its seed to the cent (rounding only). */
export const TIER_REPRICE_TOLERANCE = 0.01;
/** Labor's last line carries buildLaborItems' rounding-drift nudge (≤ 5¢). */
export const LABOR_REPRICE_TOLERANCE = 0.05;

/** A stamped tier margin, or null when it isn't one (0 < m < 1). Shared by
 *  Copy system (#266) and Load system (#293 slice 2). */
export const usableTierMargin = (m: unknown): number | null =>
  typeof m === "number" && Number.isFinite(m) && m > 0 && m < 1 ? m : null;

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

/** The unit sell a catalog part gets when it is added from the Estimator's
 *  catalog picker (addPart): its cost at the tier seed (`seedMarginOf` — the
 *  stamp, else 0.30), or its catalog list price when it has no cost. The one
 *  rule addPart, the CSV import's catalog hits and the #274 track configurator
 *  (track-bom.ts) all price by. */
export function catalogAddPrice(cost: number, list: number, m: number | null | undefined): number {
  return cost > 0 ? sellAt(cost, seedMarginOf(m)) : list;
}

/** #274: a track line's parts at stamp `m`'s seed — the line itself is
 *  re-priced like any tier-seeded line; its `components` follow so the parts
 *  table and parts list agree with it. A part with no cost keeps its sell
 *  (it was priced at its list, which isn't tier-dependent). */
export function reseedTrackComponents(
  comps: NonNullable<SpecItem["components"]>,
  m: number | null | undefined
): NonNullable<SpecItem["components"]> {
  return comps.map((c) => (c.cost > 0 ? { ...c, price: catalogAddPrice(c.cost, c.price, m) } : c));
}

/** #266 — the margin a line kind seeds at under stamp `m` (labor through its
 *  whole-percent field, every other line through `seedMarginOf`). */
export function tierSeedMarginFor(it: Pick<SpecItem, "labor">, m: number | null | undefined): number {
  return it.labor ? laborSeedMarginOf(m) : seedMarginOf(m);
}

/** #266 — the sell a line seeds at on its cost under stamp `m`: the exact
 *  price `repriceForTier` writes. */
export function tierSeedPrice(it: Pick<SpecItem, "cost" | "labor">, m: number | null | undefined): number {
  return sellAt(it.cost, tierSeedMarginFor(it, m));
}

/** #266 — a line the tier prices at all (not a fixture, ext-sell override,
 *  POR, or no-cost line — `classify`'s hand/untouched gates). */
export function isTierPriceable(it: Pick<SpecItem, "fixture" | "extSellOverride" | "por" | "cost" | "rewardCredit">): boolean {
  if (it.fixture) return false;
  // #282 phase 2: the Rewards credit is never a tier-priced line.
  if (it.rewardCredit) return false;
  if (it.extSellOverride != null && Number.isFinite(it.extSellOverride)) return false;
  if (it.por) return false;
  return it.cost > 0;
}

/** #266 — the line still sits at stamp `m`'s seed (within the line kind's
 *  tolerance). Callers check `isTierPriceable` first. */
export function isAtTierSeed(it: Pick<SpecItem, "cost" | "price" | "labor">, m: number | null | undefined): boolean {
  const tol = it.labor ? LABOR_REPRICE_TOLERANCE : TIER_REPRICE_TOLERANCE;
  return Math.abs(it.price - tierSeedPrice(it, m)) <= tol + 1e-9;
}

export type TierRepriceResult = {
  /** The same array (by reference) when nothing was re-priced and no stored
   *  labor draft's margin moved (#269). */
  sections: SpecSection[];
  repriced: number;
  /** Lines someone priced by hand (an ext-sell override, or a sell off the
   *  previous seed) — the banner's "kept N hand-priced lines". */
  handPriced: number;
  /** Lines the tier never priced (POR, no cost, fixtures) — not in the banner. */
  untouched: number;
};

type Verdict = { kind: "reprice"; price: number } | { kind: "hand" } | { kind: "untouched" } | { kind: "skip" };

function classify(it: SpecItem, prev: number | null, next: number): Verdict {
  if (it.rewardCredit) return { kind: "skip" }; // #282 phase 2: never tier-priced, never counted
  if (it.fixture) return { kind: "untouched" };
  if (it.extSellOverride != null && Number.isFinite(it.extSellOverride)) return { kind: "hand" };
  if (it.por) return { kind: "untouched" };
  if (!(it.cost > 0)) return { kind: "untouched" };
  if (it.labor && laborSeedMarginOf(prev) === laborSeedMarginOf(next)) return { kind: "skip" };
  return isAtTierSeed(it, prev) ? { kind: "reprice", price: tierSeedPrice(it, next) } : { kind: "hand" };
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
  const nothing = { sections, repriced: 0, handPriced: 0, untouched: 0 };
  if (next == null || !Number.isFinite(next) || !(next > 0 && next < 1)) return nothing;
  const prevM = prev != null && Number.isFinite(prev) && prev > 0 && prev < 1 ? prev : null;
  if (seedMarginOf(prevM) === next) return nothing;
  let repriced = 0;
  let handPriced = 0;
  let untouched = 0;
  const out = sections.map((sec) => {
    let changed = false;
    const items = sec.items.map((it) => {
      const v = classify(it, prevM, next);
      if (v.kind === "hand") handPriced++;
      if (v.kind === "untouched") untouched++;
      if (v.kind !== "reprice") return it;
      repriced++;
      if (v.price === it.price) return it;
      changed = true;
      // #274: a track line's parts follow the line to the new seed.
      if (it.track && Array.isArray(it.components)) return { ...it, price: v.price, components: reseedTrackComponents(it.components, next) };
      return { ...it, price: v.price };
    });
    const base = changed ? { ...sec, items } : sec;
    // #269: a stored labor draft still at the previous labor seed follows to
    // the new one even when every line of its group was kept hand-priced.
    return syncLaborDraftMargins(base, laborSeedMarginOf(prevM), laborSeedMarginOf(next));
  });
  // A draft-only change (nothing re-priced) must still land.
  const draftsMoved = out.some((sec, i) => sec !== sections[i]);
  return { sections: repriced || draftsMoved ? out : sections, repriced, handPriced, untouched };
}

/** "Re-priced 14 lines to Gold (20%) · kept 2 hand-priced lines · Save to
 *  keep" — the banner's text (the Undo button follows it). Only hand-priced
 *  lines are named; "Save to keep" shows until a Save persists the re-price
 *  (the tier stamp is saved only with the lines). Internal only. */
export function tierRepriceMessage(
  repriced: number,
  handPriced: number,
  tierLabel: string,
  margin: number,
  unsaved = false
): string {
  const pct = Math.round(margin * 1000) / 10;
  const lines = (n: number) => n + (n === 1 ? " line" : " lines");
  let msg = "Re-priced " + lines(repriced) + " to " + tierLabel + " (" + pct + "%)";
  if (handPriced > 0) msg += " · kept " + handPriced + " hand-priced " + (handPriced === 1 ? "line" : "lines");
  if (unsaved) msg += " · Save to keep";
  return msg;
}
