// SERVER ONLY — reads device types, the type map, settings, Grid-library docs and catalog rows.
import { getDocRows } from "@/db/doc-store";
import { designatorDigitsOf, getSettings } from "@/lib/settings";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { getMany as getCatalogParts } from "@/lib/stores/catalog";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import { getDeviceTypes, getTypeMap } from "@/lib/stores/device-types";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { gridPartsFrom } from "./grid-parts";
import { catalogForSchedule } from "./grid-schedule";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { CategoryMap } from "@/lib/catalog-taxonomy";
import { parseVirtualPartId } from "./grid-virtual-parts";
import { isSeedPlaceholder } from "./grid-seed";
import { designatorCodeOf, fillDesignators, readingCtxOf, type CodePart, type DesignatorPlacement } from "./designators";
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
): Promise<{ codeOf: (pl: { partId: string; category?: string }) => string; digits: 1 | 2 }> {
  if (preload) return { codeOf: designatorCodeOf(new Map(preload.parts.map((p) => [p.id, p])), preload.deviceTypes), digits: designatorDigitsOf(await getSettings()) };
  const ids = [...new Set(partIds)].filter(Boolean);
  if (!ids.length) return { codeOf: designatorCodeOf(new Map(), { types: [], map: {} }), digits: designatorDigitsOf(await getSettings()) };
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
  return { codeOf: designatorCodeOf(new Map(parts.map((p) => [p.id, p])), deviceTypes), digits: designatorDigitsOf(settings) };
}

/**
 * #321 polish: the placements as the riser editor names them — a device not
 * yet numbered gets the number the editor will give it (fillDesignators over
 * the project's reading order, the same code resolver), in memory only.
 * buildGridQuote names run ends in a refusal through this, so the quote and
 * the editor call the same device by the same label. With `preload` (parts the
 * caller already built + the device-type context) nothing is read; without it
 * the parts are loaded by id exactly as a store writer would (designatorContext).
 */
export async function fillDesignatorsInMemory<P extends DesignatorPlacement & { partId: string; category?: string }>(
  project: { sheetIds?: readonly string[]; spaces?: Parameters<typeof readingCtxOf>[0]["spaces"] },
  placements: readonly P[],
  digits: 1 | 2,
  preload?: DesignatorPreload
): Promise<P[]> {
  if (!placements.length) return [...placements];
  const codeOf = preload
    ? designatorCodeOf(new Map(preload.parts.map((p) => [p.id, p])), preload.deviceTypes)
    : (await designatorContext(placements.map((pl) => pl.partId))).codeOf;
  return fillDesignators(placements, codeOf, readingCtxOf(project, digits));
}

/**
 * The parts designatorContext would build for these placed ids, from rows the
 * caller already holds: the placed Grid-library symbols, the catalog fallback
 * for a raw catalog id (catalogForSchedule narrows it to what's placed), and
 * the already-resolved virtual (asm:/allow:) parts. No reads.
 */
export function labelPartsFrom(input: {
  placedIds: ReadonlySet<string>;
  symbols: readonly GridSymbol[];
  catalog: CatalogPart[];
  virtual: ReadonlyArray<CodePart & { id: string }>;
  categoryMap: CategoryMap;
  deviceTypes: DeviceTypeContext;
}): Array<CodePart & { id: string }> {
  const placedSymbols = input.symbols.filter((s) => input.placedIds.has(s.id));
  return [
    ...gridPartsFrom([...placedSymbols], catalogForSchedule(input.catalog, placedSymbols, input.placedIds), input.categoryMap, { catalogFallback: true, deviceTypes: input.deviceTypes }),
    ...input.virtual,
  ];
}
