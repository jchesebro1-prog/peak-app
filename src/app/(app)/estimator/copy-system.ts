import { syncLaborDraftMargins } from "./labor-group";
import { lineMarginOf, round2 } from "./pricing";
import {
  catalogAddPrice,
  isAtTierSeed,
  isTierPriceable,
  laborSeedMarginOf,
  seedMarginOf,
  tierSeedMarginFor,
  tierSeedPrice,
} from "./tier-reprice";
import type { SpecItem, SpecSection } from "./types";

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
 *    its (possibly new) cost. A hand-priced line keeps its own margin on the
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

const validMargin = (m: number | null | undefined): number | null =>
  m != null && Number.isFinite(m) && m > 0 && m < 1 ? m : null;

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
 * The line's sell carried onto `newCost` at the margin it already holds: an
 * ext-sell override scales at the line's extended margin, otherwise the unit
 * sell at lineMarginOf. A line with no usable margin keeps its sell.
 */
function keepMarginOnNewCost(it: SpecItem, oldCost: number, newCost: number): Pick<SpecItem, "price" | "extSellOverride"> {
  const ext = it.extSellOverride;
  if (ext != null && Number.isFinite(ext) && ext > 0) {
    const qty = it.qty;
    if (!(qty > 0)) return { price: it.price, extSellOverride: ext };
    const m = 1 - (oldCost * qty) / ext;
    if (!Number.isFinite(m) || !(m < 1)) return { price: it.price, extSellOverride: ext };
    return { price: it.price, extSellOverride: round2((newCost * qty) / (1 - m)) };
  }
  const m = lineMarginOf(oldCost, it.price);
  return m != null ? { price: round2(newCost / (1 - m)), extSellOverride: ext } : { price: it.price, extSellOverride: ext };
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
  }
): CopySectionResult {
  const src = validMargin(opts.sourceTierMargin);
  // An unusable target means no tier move: every line stays on the source's seed.
  const tgt = validMargin(opts.targetTierMargin) ?? src;
  const tierMoves = seedMarginOf(src) !== seedMarginOf(tgt);
  let costsUpdated = 0;
  let tierRepriced = 0;
  let handPriced = 0;

  const items = (section.items || []).map((it): SpecItem => {
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
      else if (costChanged) sell = keepMarginOnNewCost(it, it.cost, newCost);
      else sell = { price: it.price, extSellOverride: it.extSellOverride };
      return { ...withSell(it, sell), cost: costChanged ? newCost : it.cost, components };
    }

    /* ---- tier verdict on the ORIGINAL line against the source tier ---- */
    const priceable = isTierPriceable(it);
    const atSeed = priceable && isAtTierSeed(it, src);
    const laborSkip = !!it.labor && laborSeedMarginOf(src) === laborSeedMarginOf(tgt);
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
      const seedMoved = tierSeedMarginFor(it, src) !== tierSeedMarginFor(it, tgt);
      if (seedMoved) tierRepriced++;
      // Unchanged cost and seed: keep the sell verbatim (labor's drift nudge,
      // a cent of rounding) rather than round-trip it through the formula.
      if (!costChanged && !seedMoved) return withParts({ ...it });
      return withParts({ ...it, cost, price: tierSeedPrice({ cost, labor: it.labor }, tgt) });
    }
    if (!costChanged) return withParts({ ...it });
    return withParts({ ...withSell(it, keepMarginOnNewCost(it, it.cost, cost)), cost });
  });

  // #267: a typed system sell was the source's price for the source's costs —
  // the copy is re-priced, so it drops it (auto again); priceRound carries.
  // #269: labor group drafts carry (the lines keep their laborGroup); a
  // draft still at the source tier's labor seed follows to the target's,
  // hand-priced lines or not.
  const copied: SpecSection = syncLaborDraftMargins(
    { ...section, id: opts.newSectionId, items },
    laborSeedMarginOf(src),
    laborSeedMarginOf(tgt)
  );
  delete copied.sellOverride;
  return { section: copied, costsUpdated, tierRepriced, handPriced };
}
