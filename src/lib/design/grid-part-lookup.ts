import { get as getPart } from "@/lib/stores/catalog";
import { getGridSymbol } from "@/lib/stores/grid-catalog";
import { parseVirtualPartId } from "@/lib/design/grid-virtual-parts";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";

// Server-only (the `server-only` package isn't installed here): fail loudly
// if a client bundle ever pulls this store-backed lookup in.
if (typeof window !== "undefined") throw new Error("grid-part-lookup is server-only");

/**
 * A part id as the Grid stores it: a pricing-catalog row first, else a
 * Grid-library entry (unit "ea", sku = model number). Server-only. Moved
 * verbatim out of design/grid/[id]/actions.ts (#209) so the riser actions
 * validate parts through the same lookup.
 */
export async function partForGrid(id: string) {
  const priced = await getPart(id);
  if (priced) return priced;
  const symbol = await getGridSymbol(id);
  return symbol ? { ...symbol, sku: symbol.modelNumber || symbol.id, unit: "ea" } : null;
}

/**
 * #299: the part ids a Grid placement may carry, beyond partForGrid's
 * catalog rows + Grid-library symbols:
 *  - Auto fill's virtual ids — `asm:<fixtureId>` / `allow:<rowKey>:<tier>` —
 *    accepted whenever parseVirtualPartId reads them as well-formed. A dead
 *    virtual (deleted assembly, allowance no longer confirmed) still places;
 *    it refuses at quote time by name (#211, D313), same as an Auto fill;
 *  - seed placeholders (`grid-seed:…`, D186), which never resolve.
 * Paste and Replace part (and its undo) check through this, so a copy or an
 * undo of an Auto/seed device is never refused for its own part. Server-only.
 */
export async function isPlaceablePartId(id: string): Promise<boolean> {
  if (!id) return false;
  if (parseVirtualPartId(id) || isSeedPlaceholder(id)) return true;
  return !!(await partForGrid(id));
}

/** The placeable ids among `ids` (deduped), resolved in one parallel pass. */
export async function placeablePartIds(ids: Iterable<string>): Promise<Set<string>> {
  const distinct = [...new Set(ids)];
  const ok = await Promise.all(distinct.map((id) => isPlaceablePartId(id)));
  return new Set(distinct.filter((_, i) => ok[i]));
}
