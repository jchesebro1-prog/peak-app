import type { CategoryMap } from "@/lib/catalog-taxonomy";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import type { PartLite } from "./grid-bom";
import { gridSymbolEntry } from "./grid-icons";

/**
 * The ONE Grid-library → PartLite builder (#209): the plan editor, the riser,
 * the drawing set and the schedule all price, name and badge a device the
 * same way. Pure (type-only store imports); callers load the rows.
 *
 * `catalogFallback` appends pricing-catalog rows that are not Grid-library
 * entries, so a placement made before the library existed still resolves a
 * description (what the old riser page did inline).
 *
 * `hasDatasheet` decides the PartLite flag. The Grid editor passes the #207
 * part-documents check (a stored datasheet document of the part's own, via
 * loadPartDocsState + ownFiles) — a replaced or detached legacy file no
 * longer counts. The default is the legacy blob check, kept only for pure
 * callers that never render the datasheet link (riser, set, schedule).
 */
export function gridPartsFrom(
  symbols: GridSymbol[],
  catalog: CatalogPart[],
  categoryMap: CategoryMap,
  opts: { catalogFallback?: boolean; hasDatasheet?: (p: CatalogPart) => boolean } = {}
): PartLite[] {
  const hasDatasheet = opts.hasDatasheet ?? ((p: CatalogPart) => !!p.datasheetBlobKey);
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
  const parts: PartLite[] = symbols.map((s) => {
    const p = s.pricingPartId ? pricingById.get(s.pricingPartId) : undefined;
    // Prefer the LIVE catalog part's ports over the grid_catalog symbol's
    // seed-time snapshot (`s.ports`): grid-catalog.ts only ever copies
    // `ports` from the pricing catalog once, at first seed, and never
    // refreshes it. Fall back to the symbol's snapshot only when there's no
    // linked pricing part with its own ports.
    const ports = p?.ports?.length ? p.ports : s.ports;
    return {
      id: s.id,
      sku: s.modelNumber || s.id,
      desc: s.name,
      unit: p?.unit || "ea",
      list: p?.list || 0,
      cost: p?.cost || 0,
      ...(ports.length > 0 ? { ports } : {}),
      ...(p && hasDatasheet(p) ? { hasDatasheet: true } : {}),
      // Category, icon/colour/shape overrides, Grid scope and the pricing
      // part's group/trade (final fix wave #3).
      ...gridSymbolEntry(s, p, categoryMap),
      manufacturer: s.manufacturer,
      modelNumber: s.modelNumber,
      symbolWidth: s.width,
      symbolHeight: s.height,
      kind: s.kind || "device",
      assemblyMembers: s.members,
      pricingPartId: s.pricingPartId,
    };
  });
  if (!opts.catalogFallback) return parts;
  const seen = new Set(parts.map((p) => p.id));
  for (const p of catalog) {
    if (seen.has(p.id)) continue;
    parts.push({ id: p.id, sku: p.sku, desc: p.desc, category: p.category, unit: p.unit, list: p.list, cost: p.cost });
  }
  return parts;
}
