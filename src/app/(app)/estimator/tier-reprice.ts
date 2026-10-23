import { syncLaborDraftMarkups } from "./labor-group";
import { round2 } from "./pricing";
import type { SpecItem, SpecSection } from "./types";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { normalCostOf } from "@/lib/project-discounts/rules";
import { DEFAULT_MARKUP, MARKUP_MAX, legacyTwinOf, sellAt } from "@/lib/markup";

/**
 * #254 (D87 amended) — a customer/contact change that moves the quote's
 * pricing tier re-prices the lines that are STILL at the previous tier's
 * markup; everything hand-priced is kept (#367: markup on cost).
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
 *   sell with sell = round2(cost × (1 + k)), k = the tier stamp or the 0.43
 *   fallback. One rule, `seedMarkupOf`.
 * - labor (addLabor → buildLaborItems) — also stored as cost + sell, but the
 *   markup went through the labor draft's WHOLE-PERCENT field (freshLabor:
 *   String(Math.round(k × 100)); computeLabor clamps to ≤ MARKUP_MAX), and the
 *   modal's single rounded total nudges the LAST line by its rounding drift
 *   (≤ 5¢ per line). So labor is re-seeded at `laborSeedMarkupOf` and matched
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

/** The client's fallback when no tier markup is stamped (addPart & co). #367: 30 % margin → 43 % markup. */
export const TIER_FALLBACK_MARKUP = DEFAULT_MARKUP;
/** A seeded sell matches its seed to the cent (rounding only). */
export const TIER_REPRICE_TOLERANCE = 0.01;
/** Labor's last line carries buildLaborItems' rounding-drift nudge (≤ 5¢). */
export const LABOR_REPRICE_TOLERANCE = 0.05;

/** A stamped tier markup, or null when it isn't one (0 < k ≤ MARKUP_MAX).
 *  Shared by Copy system (#266) and Load system (#293 slice 2). */
export const usableTierMarkup = (k: unknown): number | null =>
  typeof k === "number" && Number.isFinite(k) && k > 0 && k <= MARKUP_MAX ? k : null;

/** The markup a material line was seeded at — the stamp, else 0.43. */
export function seedMarkupOf(k: number | null | undefined): number {
  return usableTierMarkup(k) ?? TIER_FALLBACK_MARKUP;
}

/** The markup a labor line was seeded at — freshLabor's whole percent,
 *  clamped as computeLabor reads it. */
export function laborSeedMarkupOf(k: number | null | undefined): number {
  return Math.min(MARKUP_MAX, Math.max(0, Math.round(seedMarkupOf(k) * 100) / 100));
}

const sellAtR = (cost: number, markup: number) => round2(sellAt(cost, markup));

/** #302 (D635) / #367 — the flat markup the Custom part form seeds Unit sell
 *  at: 35 % margin → 54 % markup. Jeff's instruction: a fixed rate, NOT the
 *  customer's tier (`seedMarkupOf`) that the catalog picker uses. */
export const CUSTOM_PART_MARKUP = 0.54;

/** #302 — a custom part's seeded Unit sell: round2(cost × 1.54) ($100 →
 *  $154.00). 0 for a cost that isn't a finite number above zero. */
export function customPartSell(cost: number): number {
  return Number.isFinite(cost) && cost > 0 ? sellAtR(cost, CUSTOM_PART_MARKUP) : 0;
}

/** The unit sell a catalog part gets when it is added from the Estimator's
 *  catalog picker (addPart): its cost at the tier seed (`seedMarkupOf` — the
 *  stamp, else 0.43), or its catalog list price when it has no cost. The one
 *  rule addPart, the CSV import's catalog hits and the #274 track configurator
 *  (track-bom.ts) all price by. */
export function catalogAddPrice(cost: number, list: number, k: number | null | undefined): number {
  return cost > 0 ? sellAtR(cost, seedMarkupOf(k)) : list;
}

/** #274: a track line's parts at stamp `k`'s seed — the line itself is
 *  re-priced like any tier-seeded line; its `components` follow so the parts
 *  table and parts list agree with it. A part with no cost keeps its sell
 *  (it was priced at its list, which isn't tier-dependent). */
export function reseedTrackComponents(
  comps: NonNullable<SpecItem["components"]>,
  k: number | null | undefined
): NonNullable<SpecItem["components"]> {
  // #366: a part's seed is on its NORMAL cost (a project discount never moves sell).
  return comps.map((c) => (normalCostOf(c) > 0 ? { ...c, price: catalogAddPrice(normalCostOf(c), c.price, k) } : c));
}

/** #266 — the markup a line kind seeds at under stamp `k` (labor through its
 *  whole-percent field, every other line through `seedMarkupOf`). */
export function tierSeedMarkupFor(it: Pick<SpecItem, "labor">, k: number | null | undefined): number {
  return it.labor ? laborSeedMarkupOf(k) : seedMarkupOf(k);
}

/** #266 — the sell a line seeds at on its cost under stamp `k`: the exact
 *  price `repriceForTier` writes. #366: on its NORMAL cost — a project
 *  discount lowers our cost, never the seed, so a discounted line still counts
 *  as at the seed and re-prices exactly as it would undiscounted. */
export function tierSeedPrice(it: Pick<SpecItem, "cost" | "labor" | "catalogCost">, k: number | null | undefined): number {
  return sellAtR(normalCostOf(it), tierSeedMarkupFor(it, k));
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

/** #266 — the line still sits at stamp `k`'s seed (within the line kind's
 *  tolerance), or at that seed's exact legacy twin (#367). Callers check
 *  `isTierPriceable` first. */
export function isAtTierSeed(it: Pick<SpecItem, "cost" | "price" | "labor" | "catalogCost">, k: number | null | undefined): boolean {
  const tol = it.labor ? LABOR_REPRICE_TOLERANCE : TIER_REPRICE_TOLERANCE;
  const at = (price: number) => Math.abs(it.price - price) <= tol + 1e-9;
  if (at(tierSeedPrice(it, k))) return true;
  // #367: a line priced before the switch sits at the exact legacy markup a rounded stamp came from.
  const twin = legacyTwinOf(tierSeedMarkupFor(it, k));
  return twin != null && at(sellAtR(normalCostOf(it), twin));
}

export type TierRepriceResult = {
  /** The same array (by reference) when nothing was re-priced and no stored
   *  labor draft's markup moved (#269). */
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
  if (isBonusItem(it)) return { kind: "skip" }; // Estimator bonuses: derived from the system, never tier-priced, never counted
  if (it.fixture) return { kind: "untouched" };
  if (it.extSellOverride != null && Number.isFinite(it.extSellOverride)) return { kind: "hand" };
  if (it.por) return { kind: "untouched" };
  if (!(it.cost > 0)) return { kind: "untouched" };
  if (it.labor && laborSeedMarkupOf(prev) === laborSeedMarkupOf(next)) return { kind: "skip" };
  return isAtTierSeed(it, prev) ? { kind: "reprice", price: tierSeedPrice(it, next) } : { kind: "hand" };
}

/**
 * Re-price every tier-seeded line from `prev` (the stamp in effect; null →
 * the 0.43 fallback) to `next` (the new stamp). Identical markups, or a
 * `next` that isn't a usable markup, change nothing.
 */
export function repriceForTier(
  sections: SpecSection[],
  prev: number | null | undefined,
  next: number | null | undefined
): TierRepriceResult {
  const nothing = { sections, repriced: 0, handPriced: 0, untouched: 0 };
  const nextK = usableTierMarkup(next);
  if (nextK == null) return nothing;
  const prevM = usableTierMarkup(prev);
  if (seedMarkupOf(prevM) === nextK) return nothing;
  let repriced = 0;
  let handPriced = 0;
  let untouched = 0;
  const out = sections.map((sec) => {
    let changed = false;
    const items = sec.items.map((it) => {
      const v = classify(it, prevM, nextK);
      if (v.kind === "hand") handPriced++;
      if (v.kind === "untouched") untouched++;
      if (v.kind !== "reprice") return it;
      repriced++;
      if (v.price === it.price) return it;
      changed = true;
      // #274: a track line's parts follow the line to the new seed.
      if (it.track && Array.isArray(it.components)) return { ...it, price: v.price, components: reseedTrackComponents(it.components, nextK) };
      return { ...it, price: v.price };
    });
    const base = changed ? { ...sec, items } : sec;
    // #269: a stored labor draft still at the previous labor seed follows to
    // the new one even when every line of its group was kept hand-priced.
    return syncLaborDraftMarkups(base, laborSeedMarkupOf(prevM), laborSeedMarkupOf(nextK));
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
  markup: number,
  unsaved = false
): string {
  const pct = Math.round(markup * 1000) / 10;
  const lines = (n: number) => n + (n === 1 ? " line" : " lines");
  let msg = "Re-priced " + lines(repriced) + " to " + tierLabel + " (" + pct + "%)";
  if (handPriced > 0) msg += " · kept " + handPriced + " hand-priced " + (handPriced === 1 ? "line" : "lines");
  if (unsaved) msg += " · Save to keep";
  return msg;
}
