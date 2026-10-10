// SERVER ONLY — reads device types, the type map, settings, Grid-library docs and catalog rows.
import { getDocRows } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { getMany as getCatalogParts } from "@/lib/stores/catalog";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import { getDeviceTypes, getTypeMap } from "@/lib/stores/device-types";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { gridPartsFrom } from "./grid-parts";
import { parseVirtualPartId } from "./grid-virtual-parts";
import { isSeedPlaceholder } from "./grid-seed";
import { designatorCodeOf, type CodePart } from "./designators";
import type { DeviceTypeContext } from "./device-types";

// Server-only (the `server-only` package isn't installed here): fail loudly
// if a client bundle ever pulls this store-backed helper in.
if (typeof window !== "undefined") throw new Error("designators-server is server-only");

/** What the editor page already built — passed so nothing loads twice. */
export type DesignatorPreload = { parts: ReadonlyArray<CodePart & { id: string }>; deviceTypes: DeviceTypeContext };

/**
 * #320: the code resolver a store writer needs BEFORE its patchDoc, so the
 * pure numbering (assignMissing) can run inside the patch against the doc it
 * read. Loads only the given part ids: their Grid-library docs (by id, never
 * the whole library), the catalog rows behind them, and virtual Auto parts —
 * then resolves each through gridPartsFrom, the one PartLite builder, so a
 * code here is the code the editor would compute.
 */
export async function designatorContext(
  partIds: Iterable<string>,
  preload?: DesignatorPreload
): Promise<{ codeOf: (pl: { partId: string; category?: string }) => string }> {
  if (preload) return { codeOf: designatorCodeOf(new Map(preload.parts.map((p) => [p.id, p])), preload.deviceTypes) };
  const ids = [...new Set(partIds)].filter(Boolean);
  if (!ids.length) return { codeOf: designatorCodeOf(new Map(), { types: [], map: {} }) };
  const virtualIds = ids.filter((id) => parseVirtualPartId(id));
  const realIds = ids.filter((id) => !parseVirtualPartId(id) && !isSeedPlaceholder(id));
  const [types, map, settings, symbolRows, virtual] = await Promise.all([
    getDeviceTypes(),
    getTypeMap(),
    getSettings(),
    getDocRows<GridSymbol>("grid_catalog", realIds),
    virtualIds.length ? loadVirtualParts(virtualIds) : Promise.resolve([]),
  ]);
  const symbols = symbolRows.filter((r) => !r.deleted).map((r) => r.doc);
  const pricingIds = [...new Set([...realIds, ...symbols.flatMap((s) => (s.pricingPartId ? [s.pricingPartId] : []))])];
  const catalog = pricingIds.length ? await getCatalogParts(pricingIds) : [];
  const deviceTypes = { types, map };
  const parts = [
    ...gridPartsFrom(symbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true, deviceTypes }),
    ...virtual,
  ];
  return { codeOf: designatorCodeOf(new Map(parts.map((p) => [p.id, p])), deviceTypes) };
}
