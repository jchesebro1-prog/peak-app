import { getDocRows, insertDocIfAbsent, listDocsFiltered } from "@/db/doc-store";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { getSettings } from "@/lib/settings";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { parseVirtualPartId } from "./grid-virtual-parts";
import { isSeedPlaceholder } from "./grid-seed";
import { isPlaceablePartId } from "./grid-part-lookup";
import { gridPartsFrom } from "./grid-parts";
import type { PartLite } from "./grid-bom";
import {
  CATALOG_LIGHT_FIELDS,
  CATALOG_SEARCH_CANDIDATES,
  CATALOG_SEARCH_FIELDS,
  catalogSearchQuery,
  catalogSearchTokens,
  gridSymbolFromPart,
  inCatalogNode,
  isLibraryCandidate,
  matchCatalogCandidates,
  rankCatalogHits,
  type CatalogNode,
} from "./grid-catalog-search";

// Server-only (the `server-only` package isn't installed here).
if (typeof window !== "undefined") throw new Error("grid-catalog-search-server is server-only");

/**
 * Grid notes #6 — the server half of the Product Library's catalog search.
 *
 * `searchGridCatalog`: the specs picker's SQL pre-filter (#205: never reads the
 * whole ~37k-part book per keystroke), every token ANDed over the #304 fields +
 * category, each candidate projected to CATALOG_LIGHT_FIELDS (≤ 2,000 rows;
 * `truncated` when that cap is hit). matchCatalogCandidates runs the exact
 * match and the fabric/Labor/rename exclusions; under a scope / type node the
 * matches are built (gridPartsFrom, the page's device-type context) and kept
 * only when they sit under it — before the 40 cap; then the Estimator ranking,
 * cap 40, and those hits are re-read in full and built through the one PartLite
 * builder exactly like the library entry each turns into once placed.
 * Flagged `fromCatalog`.
 *
 * `adoptCatalogParts`: the ids among `ids` that are live, placeable catalog
 * parts with no Grid library row yet get one, inserted directly
 * (insert-if-absent, gridSymbolFromPart) — one batched read each for the
 * library rows and the catalog rows; it never lists (or seeds) the library.
 *
 * `placeDevicePartRefusal`: placeDeviceAction's gate — why `id` can't be
 * placed, or null.
 */

export type GridCatalogSearch = { parts: PartLite[]; truncated: boolean };

export async function searchGridCatalog(rawQuery: string, node: CatalogNode = { scope: "", typeKey: "" }): Promise<GridCatalogSearch> {
  const q = catalogSearchQuery(rawQuery);
  if (!q) return { parts: [], truncated: false };
  const rows = await listDocsFiltered<CatalogPart>("catalog_parts", {
    allText: catalogSearchTokens(q),
    textFields: CATALOG_SEARCH_FIELDS,
    limit: CATALOG_SEARCH_CANDIDATES,
    fields: CATALOG_LIGHT_FIELDS,
  });
  const truncated = rows.length >= CATALOG_SEARCH_CANDIDATES;
  const matched = matchCatalogCandidates(rows, q);
  if (!matched.length) return { parts: [], truncated };
  const [settings, deviceTypes] = await Promise.all([getSettings(), loadDeviceTypeContext(matched)]);
  const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);
  const now = Date.now();
  const build = (ps: CatalogPart[]) =>
    gridPartsFrom(
      ps.map((p) => gridSymbolFromPart(p, "catalog search", now)),
      ps,
      categoryMap,
      // The datasheet link is the library tile's; it appears once the part is placed.
      { hasDatasheet: () => false, deviceTypes }
    );
  let pool = matched;
  if (node.scope || node.typeKey) {
    const under = new Set(build(matched).filter((p) => inCatalogNode(p, node)).map((p) => p.id));
    pool = matched.filter((p) => under.has(p.id));
  }
  const top = rankCatalogHits(pool, q);
  if (!top.length) return { parts: [], truncated };
  const full = new Map(
    (await getDocRows<CatalogPart>("catalog_parts", top.map((p) => p.id)))
      .filter((r) => !r.deleted && isLibraryCandidate(r.doc))
      .map((r) => [r.id, r.doc])
  );
  const hits = top.map((p) => full.get(p.id)).filter((p): p is CatalogPart => !!p);
  return { parts: build(hits).map((p) => ({ ...p, fromCatalog: true as const })), truncated };
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
  let added = 0;
  const now = Date.now();
  for (const p of parts) if (await insertDocIfAbsent<GridSymbol>("grid_catalog", gridSymbolFromPart(p, by, now))) added += 1;
  return added;
}

export const PLACE_PART_INVALID = "That part can't be placed — reload and try again.";
export const PLACE_PART_NOT_PLACEABLE = "That part can't be placed on a plan (a fabric, Labor, or a part that was renamed or removed).";
const PLACE_PART_ID_MAX = 120; // = actions.ts PART_ID_MAX (paste / undo / Replace part)

/** placeDeviceAction's gate (Grid notes #6), mirroring Replace part's: a
 *  non-empty id ≤ 120 characters that isPlaceablePartId accepts (a catalog
 *  part, a Grid library entry, an Auto virtual or seed id) — and, when the id
 *  is a catalog row, a live one that isn't a fabric, Labor or renamed away
 *  (isPlaceablePartId follows a rename to its successor; a placement keeps
 *  the id it is given, so the retired id itself is refused). */
export async function placeDevicePartRefusal(id: unknown): Promise<string | null> {
  if (typeof id !== "string" || id === "" || id.length > PLACE_PART_ID_MAX) return PLACE_PART_INVALID;
  if (!(await isPlaceablePartId(id))) return "That part is not in the Grid library.";
  if (parseVirtualPartId(id) || isSeedPlaceholder(id)) return null;
  const [row] = await getDocRows<CatalogPart>("catalog_parts", [id]);
  if (row && (row.deleted || !isLibraryCandidate(row.doc))) return PLACE_PART_NOT_PLACEABLE;
  return null;
}
