import type { SpecSection } from "@/app/(app)/estimator/types";
import { rewriteQuoteSpec } from "@/lib/catalog-rename/rewrite";
import type { BonusRates } from "@/lib/estimate-bonus/flags";
import { getManyBySku } from "@/lib/stores/catalog";
import { liveRenameRefs } from "@/lib/stores/catalog-renames";
import { loadBonusRates } from "@/lib/stores/pricing";
import { repriceSkus, type RepriceCatalogPart } from "./rules";

export type RepriceInputs = {
  /** Today's catalog for every SKU the specs' plain lines name, keyed by that SKU. */
  catalog: Map<string, RepriceCatalogPart>;
  /** Estimating Rules' bonus rates — a revised draft's bonus lines take them (as a save would). */
  bonusRates: BonusRates;
  /** The live spec moved onto renamed parts (#304) — what a save's quoteSpecFollowingRenames does; the same object when nothing moved. */
  followRenames: (spec: unknown) => unknown;
};

/**
 * #368 — everything a Revise re-price reads, loaded before setStatus's
 * synchronous write: the rename log, then today's catalog for the SKUs the
 * given specs name once renames are followed (getManyBySku follows a retired
 * SKU to its live part; missing / deleted parts are absent), and the bonus
 * rates. `specs` are every version the write might re-price (the live spec,
 * and the won version a reopen puts back). Server-only.
 */
export async function loadRepriceInputs(specs: unknown[]): Promise<RepriceInputs> {
  const renames = await liveRenameRefs();
  const followRenames = (spec: unknown): unknown => (spec && renames.m.size ? rewriteQuoteSpec(spec, renames.m, renames.models) ?? spec : spec);
  const skus = new Set<string>();
  for (const spec of specs) {
    const secs = (followRenames(spec) as { sections?: unknown } | null | undefined)?.sections;
    if (Array.isArray(secs)) repriceSkus(secs as SpecSection[]).forEach((s) => skus.add(s));
  }
  const [found, bonusRates] = await Promise.all([skus.size ? getManyBySku([...skus]) : Promise.resolve(new Map()), loadBonusRates()]);
  const catalog = new Map<string, RepriceCatalogPart>();
  for (const [sku, p] of found) {
    if (!p || typeof p.sku !== "string") continue;
    catalog.set(sku, { sku: p.sku, cost: Number(p.cost), category: typeof p.category === "string" ? p.category : null });
  }
  return { catalog, bonusRates, followRenames };
}
