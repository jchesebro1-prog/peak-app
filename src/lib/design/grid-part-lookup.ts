import { get as getPart } from "@/lib/stores/catalog";
import { getGridSymbol } from "@/lib/stores/grid-catalog";

/**
 * A part id as the Grid stores it: a pricing-catalog row first, else a
 * Grid-library entry (unit "ea", sku = model number). Server-only. Moved
 * verbatim out of design/grid/[id]/actions.ts (#GDS) so the riser actions
 * validate parts through the same lookup.
 */
export async function partForGrid(id: string) {
  const priced = await getPart(id);
  if (priced) return priced;
  const symbol = await getGridSymbol(id);
  return symbol ? { ...symbol, sku: symbol.modelNumber || symbol.id, unit: "ea" } : null;
}
