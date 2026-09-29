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
 * This module imports @/lib/curtain-pricing, which holds the margin, so it
 * must never reach a client component. The editor's live preview instead runs
 * @/lib/curtain-geom over the sell price/sq ft this file's caller precomputes
 * (fabricSellPerSqft), which matches this module's priceEach to the cent by
 * construction.
 */

import { curtainCost as curtainSell } from "@/lib/curtain-pricing";
import { fabricAreaRateOf, type CurtainSewing } from "./curtain-pricing";
import { curtainSpecOf, type GridCurtain } from "./grid-bom";
import { isFabricPart } from "@/lib/fabric-part";

/** The catalog slice a fabric row contributes. */
export type FabricRow = {
  id: string;
  sku: string;
  desc: string;
  category: string;
  /** #264 — sq-ft Soft Goods count as fabric, and price at `cost` when no rate is set. */
  unit?: string;
  cost?: number;
  curtainAreaRate?: number;
  costPerSqft?: number;
};

/** Rows the curtain picker offers - the estimator's rule (#264: isFabricPart). */
export function isFabricRow(p: { category: string; unit?: string | null }): boolean {
  return isFabricPart(p);
}

export type CurtainPrice = { costEach: number; priceEach: number };

/**
 * Authoritative price for every curtain placement in a design, keyed by
 * PLACEMENT id (each drop is its own line - two drapes of one fabric are
 * different goods the moment their dimensions differ). The fabric's rate comes
 * from fabricAreaRateOf (#227), the chain the estimator and portal also use,
 * and the sewing rule (#227 late, loadCurtainSewingPct) is added on top.
 *
 * A curtain whose fabric has left the catalog is NOT dropped: it prices at a
 * zero area rate, which surfaces it as a $0 line the human has to deal with,
 * the same treatment bomLines gives a removed part.
 */
export function priceGridCurtains(
  placements: Array<{ id: string; curtain?: GridCurtain | null }>,
  catalog: FabricRow[],
  sewing: CurtainSewing,
  margin?: number
): Map<string, CurtainPrice> {
  const fabricById = new Map(catalog.filter(isFabricRow).map((p) => [p.id, p]));
  const out = new Map<string, CurtainPrice>();
  for (const pl of placements) {
    if (!pl.curtain) continue;
    const rate = fabricAreaRateOf(fabricById.get(pl.curtain.fabricSku));
    out.set(pl.id, curtainSell(curtainSpecOf(pl.curtain), { fabricRate: rate, sewingPct: sewing.sewingPct }, margin));
  }
  return out;
}
