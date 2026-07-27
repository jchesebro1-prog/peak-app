/**
 * The Grid - curtain pricing bridge (punch #49). SERVER ONLY.
 *
 * Jeff: "Curtains getting added: This should be treated as the usual types,
 * Borders, Draws, Fulls, Legs. Then when you drop it in you specify the Width,
 * Height, Fullness, Name, and Fabric Type. Similar to our curtain builder for
 * estimates." His answer on what a Grid curtain IS: a priced line, like the
 * estimator - so it reuses the pricing already in use rather than growing a
 * fourth one.
 *
 * This module imports @/lib/curtain-pricing, which holds the margin and the
 * cost basis, so it must never reach a client component. The editor's live
 * preview instead runs @/lib/curtain-geom over the sell numbers this file's
 * caller precomputes (fabricSellPerSqft + sellCoeffs), which match this
 * module's priceEach to the cent by construction.
 */

import { curtainCost as curtainSell } from "@/lib/curtain-pricing";
import { SEED_FABRIC_RATES } from "./curtain-pricing";
import { curtainSpecOf, type GridCurtain } from "./grid-bom";

/** The catalog slice a fabric row contributes. */
export type FabricRow = {
  id: string;
  sku: string;
  desc: string;
  category: string;
  curtainAreaRate?: number;
  costPerSqft?: number;
};

/** Rows the curtain picker offers - the estimator's rule, verbatim. */
export function isFabricRow(p: { category: string }): boolean {
  return p.category === "Fabric";
}

/**
 * Make-it area rate for one fabric, in the estimator's own precedence:
 * the catalog's editable curtainAreaRate, else the reconciled seed, else the
 * raw cost/sq ft. Identical to estimator/pricing.computeCurtain and to the
 * portal action, so all three price the same drape the same way.
 */
export function fabricAreaRate(fab: FabricRow | undefined): number {
  if (!fab) return 0;
  return fab.curtainAreaRate ?? SEED_FABRIC_RATES[fab.sku] ?? fab.costPerSqft ?? 0;
}

export type CurtainPrice = { costEach: number; priceEach: number };

/**
 * Authoritative price for every curtain placement in a design, keyed by
 * PLACEMENT id (each drop is its own line - two drapes of one fabric are
 * different goods the moment their dimensions differ).
 *
 * A curtain whose fabric has left the catalog is NOT dropped: it prices at a
 * zero area rate, which surfaces it as a $0 line the human has to deal with,
 * the same treatment bomLines gives a removed part.
 */
export function priceGridCurtains(
  placements: Array<{ id: string; curtain?: GridCurtain | null }>,
  catalog: FabricRow[],
  margin?: number
): Map<string, CurtainPrice> {
  const fabricById = new Map(catalog.filter(isFabricRow).map((p) => [p.id, p]));
  const out = new Map<string, CurtainPrice>();
  for (const pl of placements) {
    if (!pl.curtain) continue;
    const rate = fabricAreaRate(fabricById.get(pl.curtain.fabricSku));
    out.set(pl.id, curtainSell(curtainSpecOf(pl.curtain), rate, margin));
  }
  return out;
}
