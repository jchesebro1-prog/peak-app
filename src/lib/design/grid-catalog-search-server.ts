import { getDocRows, listDocsFiltered } from "@/db/doc-store";
import type { CatalogPart } from "@/lib/stores/catalog";
import { ensureGridSymbolsFor, type GridSymbol } from "@/lib/stores/grid-catalog";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { getSettings } from "@/lib/settings";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { parseVirtualPartId } from "./grid-virtual-parts";
import { isSeedPlaceholder } from "./grid-seed";
import { gridPartsFrom } from "./grid-parts";
import type { PartLite } from "./grid-bom";
import {
  CATALOG_SEARCH_CANDIDATES,
  CATALOG_SEARCH_FIELDS,
  catalogPrefilterText,
  catalogSearchQuery,
  filterCatalogHits,
  gridSymbolFromPart,
  isLibraryCandidate,
} from "./grid-catalog-search";

// Server-only (the `server-only` package isn't installed here).
if (typeof window !== "undefined") throw new Error("grid-catalog-search-server is server-only");

/**
 * Grid notes #6 — the server half of the Product Library's catalog search.
 *
 * `searchGridCatalog`: the specs picker's SQL pre-filter (#205: never reads the
 * whole ~37k-part book per keystroke) narrows candidates on the query's longest
 * token over the #304 fields, then filterCatalogHits runs the exact #304 match,
 * the fabric/Labor/rename exclusions and the Estimator ranking, capped at 40.
 * Each hit becomes the same GridSymbol the library would store for it
 * (gridSymbolFromPart) and goes through the one PartLite builder
 * (gridPartsFrom) with the page's device-type context and category map, so a
 * result's type, scope, icon, colour, ports and price match the library entry
 * it turns into once placed. Flagged `fromCatalog`.
 *
 * `adoptCatalogParts`: the part ids among `ids` that are live, placeable
 * catalog parts with no Grid library entry yet get one (ensureGridSymbolsFor,
 * insert-if-absent). Virtual (asm:/allow:) and seed ids are skipped; one
 * batched read each for the library rows and the catalog rows, so an id that is
 * already in the library costs nothing more.
 */

export async function searchGridCatalog(rawQuery: string): Promise<PartLite[]> {
  const q = catalogSearchQuery(rawQuery);
  if (!q) return [];
  const candidates = await listDocsFiltered<CatalogPart>("catalog_parts", {
    text: catalogPrefilterText(q),
    textFields: CATALOG_SEARCH_FIELDS,
    limit: CATALOG_SEARCH_CANDIDATES,
  });
  const hits = filterCatalogHits(candidates, q);
  if (!hits.length) return [];
  const [settings, deviceTypes] = await Promise.all([getSettings(), loadDeviceTypeContext(hits)]);
  const now = Date.now();
  const symbols = hits.map((p) => gridSymbolFromPart(p, "catalog search", now));
  return gridPartsFrom(symbols, hits, resolveCategoryMap(settings.catalogCategoryMap), {
    // The datasheet link is the library tile's; it appears once the part is placed.
    hasDatasheet: () => false,
    deviceTypes,
  }).map((p) => ({ ...p, fromCatalog: true as const }));
}

export async function adoptCatalogParts(ids: Iterable<string>, by: string): Promise<number> {
  const wanted = [...new Set(ids)].filter((id) => !!id && !parseVirtualPartId(id) && !isSeedPlaceholder(id));
  if (!wanted.length) return 0;
  const inLibrary = new Set((await getDocRows<GridSymbol>("grid_catalog", wanted)).map((r) => r.id));
  const missing = wanted.filter((id) => !inLibrary.has(id));
  if (!missing.length) return 0;
  // Exact ids only: a #304 tombstone is deleted (no live row), and a rename's
  // successor has a different id — the placement keeps the id it was given.
  const parts = (await getDocRows<CatalogPart>("catalog_parts", missing))
    .filter((r) => !r.deleted && isLibraryCandidate(r.doc))
    .map((r) => r.doc);
  return parts.length ? ensureGridSymbolsFor(parts, by) : 0;
}
