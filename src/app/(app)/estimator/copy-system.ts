import { rewriteQuoteSpec, type RenameMap } from "@/lib/catalog-rename/rewrite";
import { withoutGroupMeta } from "@/lib/estimate-groups/groups";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { remapCurtainTrackKeys } from "@/lib/curtain-cut-sheets/track-link";
import { syncLaborDraftMarkups } from "./labor-group";
import { lineMarkupOf, round2 } from "./pricing";
import {
  catalogAddPrice,
  isAtTierSeed,
  isTierPriceable,
  laborSeedMarkupOf,
  seedMarkupOf,
  tierSeedMarkupFor,
  tierSeedPrice,
  usableTierMarkup,
} from "./tier-reprice";
import { sameWholeMarkup, sellAt } from "@/lib/markup";
import type { SpecItem, SpecSection } from "./types";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { applyProjectDiscounts } from "@/lib/project-discounts/rules";

/**
 * #266 — Copy a system (SpecSection) to a new estimate, an existing one, or
 * within the same estimate, RE-PRICED for where it lands. Pure: the server
 * action (copySystemToEstimateAction) hands in today's catalog and resolved
 * fixtures; the source section is never touched.
 *
 * Two steps, in order:
 * 1. Cost refresh — a plain catalog line (and every catalog-backed fixture
 *    or #274 track component) takes TODAY's catalog cost; a track line's
 *    cost is its parts' sum, and its parts re-seed at the landing tier. Custom, curtain, allowance,
 *    vendor-quote, labor, POR and portal-confirm lines keep their cost.
 * 2. Tier — a line still at the SOURCE tier's seed (judged on its ORIGINAL
 *    cost and sell, #254's rule) lands at exactly the TARGET tier's seed on
 *    its (possibly new) cost. A hand-priced line keeps its own markup on the
 *    new cost. Fixtures are never tier-priced (as in #254).
 */

export type CopyCatalogPart = { sku: string; cost: number; list: number };
export type CopyFixture = { id: string; components: Array<{ sku: string; cost: number; list: number }> };

export type CopySectionResult = {
  section: SpecSection;
  /** Lines whose cost moved to today's catalog (plain or fixture). */
  costsUpdated: number;
  /** Lines moved from the source tier's seed to the target tier's. */
  tierRepriced: number;
  /** When the tier moved: tier-priced lines kept as hand-priced (#254's
   *  banner count — an ext-sell override, or a sell off the source seed). */
  handPriced: number;
};

/** A cost difference below half a cent is no change. */
const COST_EPSILON = 0.005;

/** Lines whose cost is not a catalog part's (kept as-is on a copy). */
function keepsOwnCost(it: SpecItem): boolean {
  return !!(
    it.labor ||
    it.laborOverhead ||
    it.laborTravel ||
    it.vendorQuoteId ||
    it.custom ||
    it.curtain ||
    it.allowance ||
    it.por ||
    it.portalConfirm ||
    it.fixture
  );
}

/**
 * The line's sell carried onto `newCost` at the markup it already holds: an
 * ext-sell override scales at the line's extended markup, otherwise the unit
 * sell at lineMarkupOf. A line with no usable markup keeps its sell.
 */
function keepMarkupOnNewCost(it: SpecItem, oldCost: number, newCost: number): Pick<SpecItem, "price" | "extSellOverride"> {
  const ext = it.extSellOverride;
  if (ext != null && Number.isFinite(ext) && ext > 0) {
    const qty = it.qty;
    if (!(qty > 0) || !(oldCost > 0)) return { price: it.price, extSellOverride: ext };
    const k = (ext - oldCost * qty) / (oldCost * qty);
    if (!Number.isFinite(k)) return { price: it.price, extSellOverride: ext };
    return { price: it.price, extSellOverride: round2(sellAt(newCost * qty, k)) };
  }
  const k = lineMarkupOf(oldCost, it.price);
  return k != null ? { price: round2(sellAt(newCost, k)), extSellOverride: ext } : { price: it.price, extSellOverride: ext };
}

function withSell(it: SpecItem, sell: Pick<SpecItem, "price" | "extSellOverride">): SpecItem {
  const out: SpecItem = { ...it, price: sell.price };
  if (sell.extSellOverride !== undefined) out.extSellOverride = sell.extSellOverride;
  return out;
}

export function copySectionForTarget(
  section: SpecSection,
  opts: {
    newSectionId: string;
    catalog: ReadonlyMap<string, CopyCatalogPart>;
    fixtures: ReadonlyMap<string, CopyFixture>;
    sourceTierMargin: number | null;
    targetTierMargin: number | null;
    /** #304: the rename log (old SKU → live SKU, live SKU → model). A
     *  section copied from a sent revision keeps a renamed part's old SKU;
     *  the copy lands on the live estimate under the live SKU. */
    renames?: { m: RenameMap; models: RenameMap };
  }
): CopySectionResult {
  const src = usableTierMarkup(opts.sourceTierMargin);
  // An unusable target means no tier move: every line stays on the source's seed.
  const tgt = usableTierMarkup(opts.targetTierMargin) ?? src;
  const tierMoves = !sameWholeMarkup(seedMarkupOf(src), seedMarkupOf(tgt));
  let costsUpdated = 0;
  let tierRepriced = 0;
  let handPriced = 0;

  // #366: the copy starts from NORMAL cost — the source's project discounts are its own (the landing estimate
  // re-applies its map), and a stale discounted cost would read as a catalog cost change and move the sell.
  const [undiscounted] = applyProjectDiscounts([section], {});
  // #282 phase 2: the Rewards credit is the source quote's — a copy never carries it.
  const items = (undiscounted.items || []).filter((it) => !isRewardCreditItem(it) && !isBonusItem(it)).map((it): SpecItem => {
    const comps = Array.isArray(it.components) ? it.components : [];

    /* #274: a track line is a tier-seeded line whose "catalog cost" is its
       parts' — refreshed below with the plain lines, not here. */
    const track = !!it.track && comps.length > 0;

    /* ---- fixture line: refresh components, never tier-priced ---- */
    if (comps.length && !track) {
      const fixture = opts.fixtures.get(it.fixtureId || it.sku);
      const byFixtureSku = new Map<string, { cost: number; list: number }>();
      for (const c of fixture?.components || []) if (!byFixtureSku.has(c.sku)) byFixtureSku.set(c.sku, c);
      let oldList = 0;
      let newCostSum = 0;
      let newListSum = 0;
      const components = comps.map((c) => {
        const f = byFixtureSku.get(c.sku);
        const cat = opts.catalog.get(c.sku);
        const cost = f?.cost ?? cat?.cost ?? c.cost;
        const price = f?.list ?? cat?.list ?? c.price;
        if (c.qty > 0) {
          oldList += c.price * c.qty;
          newCostSum += cost * c.qty;
          newListSum += price * c.qty;
        }
        return { ...c, cost, price };
      });
      const newCost = round2(newCostSum);
      const costChanged = Math.abs(newCost - it.cost) >= COST_EPSILON;
      if (costChanged) costsUpdated++;
      const hasExt = it.extSellOverride != null && Number.isFinite(it.extSellOverride);
      const atDefaultSell = !hasExt && Math.abs(it.price - oldList) < 0.01;
      let sell: Pick<SpecItem, "price" | "extSellOverride">;
      if (atDefaultSell) sell = { price: round2(newListSum), extSellOverride: it.extSellOverride };
      else if (costChanged) sell = keepMarkupOnNewCost(it, it.cost, newCost);
      else sell = { price: it.price, extSellOverride: it.extSellOverride };
      return { ...withSell(it, sell), cost: costChanged ? newCost : it.cost, components };
    }

    /* ---- tier verdict on the ORIGINAL line against the source tier ---- */
    const priceable = isTierPriceable(it);
    const atSeed = priceable && isAtTierSeed(it, src);
    const laborSkip = !!it.labor && laborSeedMarkupOf(src) === laborSeedMarkupOf(tgt);
    if (tierMoves) {
      const hand = (it.extSellOverride != null && Number.isFinite(it.extSellOverride) && !it.fixture) || (priceable && !atSeed && !laborSkip);
      if (hand) handPriced++;
    }

    /* ---- cost refresh (plain catalog lines, and a track line's parts) ---- */
    let cost = it.cost;
    let parts: SpecItem["components"] | undefined;
    if (track) {
      // #274: each part takes today's catalog cost (a part gone from the
      // catalog, or with no cost today, keeps its own) and its sell at the
      // landing tier's seed; the line's cost is their sum.
      let sum = 0;
      parts = comps.map((c) => {
        const cat = opts.catalog.get(c.sku);
        const partCost = cat ? cat.cost : c.cost;
        if (c.qty > 0) sum += partCost * c.qty;
        return { ...c, cost: partCost, price: partCost > 0 ? catalogAddPrice(partCost, c.price, tgt) : c.price };
      });
      if (Math.abs(sum - it.cost) >= COST_EPSILON) {
        cost = sum;
        costsUpdated++;
      }
    } else {
      const part = !keepsOwnCost(it) && it.sku ? opts.catalog.get(it.sku) : undefined;
      if (part && Number.isFinite(part.cost) && Math.abs(part.cost - it.cost) >= COST_EPSILON) {
        cost = part.cost;
        costsUpdated++;
      }
    }
    const costChanged = cost !== it.cost;
    const withParts = (line: SpecItem): SpecItem => (parts ? { ...line, components: parts } : line);

    if (atSeed) {
      const seedMoved = !sameWholeMarkup(tierSeedMarkupFor(it, src), tierSeedMarkupFor(it, tgt));
      if (seedMoved) tierRepriced++;
      // Unchanged cost and seed: keep the sell verbatim (labor's drift nudge,
      // a cent of rounding) rather than round-trip it through the formula.
      if (!costChanged && !seedMoved) return withParts({ ...it });
      return withParts({ ...it, cost, price: tierSeedPrice({ cost, labor: it.labor }, tgt) });
    }
    if (!costChanged) return withParts({ ...it });
    return withParts({ ...withSell(it, keepMarkupOnNewCost(it, it.cost, cost)), cost });
  });

  // #267: a typed system sell was the source's price for the source's costs —
  // the copy is re-priced, so it drops it (auto again); priceRound carries.
  // #269: labor group drafts carry (the lines keep their laborGroup); a
  // draft still at the source tier's labor seed follows to the target's,
  // hand-priced lines or not.
  // #292: the copy's curtain/track pairs get fresh shared keys, so a copy in
  // the same estimate never shares a key with its source.
  const copied: SpecSection = syncLaborDraftMarkups(
    { ...section, id: opts.newSectionId, items: remapCurtainTrackKeys(items) },
    laborSeedMarkupOf(src),
    laborSeedMarkupOf(tgt)
  );
  delete copied.sellOverride;
  // Phase 2a: a copy lands ungrouped and unbuilt; copying within one estimate sets its group in the hook.
  const ungrouped = withoutGroupMeta(copied);
  // #304: priced above under the SKU the source names (the catalog map is
  // keyed by it); the copy is LIVE data, so its lines and key products then
  // move to the live SKU, and a moved line prints its new model.
  const live = opts.renames?.m.size
    ? (rewriteQuoteSpec({ sections: [ungrouped] }, opts.renames.m, opts.renames.models) as { sections: SpecSection[] } | null)
    : null;
  return { section: live ? live.sections[0] : ungrouped, costsUpdated, tierRepriced, handPriced };
}
