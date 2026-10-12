import type { CatalogPart } from "@/lib/stores/catalog";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import type { PartLite } from "./grid-bom";
import { isFabricPart } from "@/lib/fabric-part";
import { partSearchHaystack } from "@/lib/catalog-rename/sku";
import { keywordScopeOf, typeKeyOfPart } from "./device-types";
import { isGridLayer, scopeOfPart } from "./grid-scopes";

/**
 * Grid notes #6 — the Product Library's "From the catalog" search. Pure and
 * client-safe (type-only store imports); the server side is
 * grid-catalog-search-server.ts, the UI workspace/product-library.tsx.
 *
 * The Grid library (`grid_catalog`) holds only what was seeded once plus what
 * Auto fill / the From-estimate tray pulled in, and production's ~37k-part
 * catalog is far too big to ship to the client. So the library searches the
 * full catalog on the server, the specs picker's way (#205): a SQL LIKE
 * pre-filter over the #304 search fields + category (every token ANDed,
 * projected to the light fields below), then the exact JS match (the #304
 * haystack — sku, description, maker, MFR P/N, Model #, former SKUs — plus the
 * category, as the Estimator's search matches it), the selected library node's
 * scope / device type, ranked the Estimator picker's way, capped.
 */

export const CATALOG_SEARCH_MIN = 2;
export const CATALOG_SEARCH_CAP = 40;
/** SQL candidates read per search before the exact match (the specs picker's cap). */
export const CATALOG_SEARCH_CANDIDATES = 2000;
export const CATALOG_SEARCH_DEBOUNCE_MS = 250;
const QUERY_MAX = 120;
/** The #304 search fields (the specs picker's prefilter list) plus the category. */
export const CATALOG_SEARCH_FIELDS = ["sku", "desc", "mfr", "manufacturerPartNumber", "manufacturerModelNumber", "formerSkus", "category"] as const;
/** What a candidate row is read as before the cap: enough to match, exclude,
 *  rank and resolve its device type + scope (gridPartsFrom: category, desc,
 *  discipline, trade, and the part's own type override). The ≤ 40 hits are then re-read in full. */
export const CATALOG_LIGHT_FIELDS = [
  "sku", "desc", "mfr", "category", "unit", "trade", "discipline",
  "manufacturerPartNumber", "manufacturerModelNumber", "formerSkus", "renamedTo",
  // Grid notes #2: a part's own device type decides its node like its category does.
  "deviceTypeKey",
] as const;
const MAX_TOKENS = 8;

/** The query a search runs: trimmed, length-capped; "" when shorter than CATALOG_SEARCH_MIN. */
export function catalogSearchQuery(raw: unknown): string {
  const q = String(raw ?? "").trim().slice(0, QUERY_MAX);
  return q.length >= CATALOG_SEARCH_MIN ? q : "";
}

/** The query's distinct lowercased tokens (at most 8) — every one must match,
 *  in the SQL pre-filter (ANDed) and in the exact JS match. */
export function catalogSearchTokens(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_TOKENS);
}

/** The exact match: every token in the #304 haystack or the category. */
export function catalogPartMatches(p: CatalogPart, q: string): boolean {
  const tokens = catalogSearchTokens(q);
  if (!tokens.length) return false;
  const hay = `${partSearchHaystack(p)} ${(p.category || "").toLowerCase()}`;
  return tokens.every((t) => hay.includes(t));
}

/** A catalog row the Grid library may hold — what ensureGridSymbolsFor admits
 *  (#264: never a fabric, never Labor), live (not a #304 rename tombstone). */
export function isLibraryCandidate(p: Pick<CatalogPart, "id" | "category" | "unit"> & { renamedTo?: string }): boolean {
  return !!p.id && !p.renamedTo && !isFabricPart(p) && (p.category || "").trim() !== "Labor";
}

/** The Estimator picker's ranking tiers (searchCatalog): an exact SKU / Model #
 *  / former SKU or description is 5, a prefix 4, a substring of those 2,
 *  anything else the haystack matched 1. */
export function catalogHitRank(p: CatalogPart, q: string): number {
  const s = q.trim().toLowerCase();
  const desc = (p.desc || "").toLowerCase();
  const names = [p.sku || "", p.manufacturerModelNumber || "", ...(p.formerSkus ?? [])].map((n) => n.toLowerCase()).filter(Boolean);
  if (names.includes(s) || desc === s) return 5;
  if (names.some((n) => n.startsWith(s)) || desc.startsWith(s)) return 4;
  if (desc.includes(s) || names.some((n) => n.includes(s))) return 2;
  return 1;
}

/** Candidates → the placeable library candidates that match, deduped by id (uncapped, unranked). */
export function matchCatalogCandidates(parts: readonly CatalogPart[], rawQuery: string): CatalogPart[] {
  const q = catalogSearchQuery(rawQuery);
  if (!q) return [];
  const seen = new Set<string>();
  return parts.filter((p) => {
    if (!isLibraryCandidate(p) || seen.has(p.id) || !catalogPartMatches(p, q)) return false;
    seen.add(p.id);
    return true;
  });
}

/** Best rank first (then description, SKU), capped at CATALOG_SEARCH_CAP at most. */
export function rankCatalogHits(parts: readonly CatalogPart[], rawQuery: string, cap = CATALOG_SEARCH_CAP): CatalogPart[] {
  const q = catalogSearchQuery(rawQuery);
  return parts
    .map((p) => ({ p, r: catalogHitRank(p, q) }))
    .sort((a, b) => b.r - a.r || (a.p.desc || "").localeCompare(b.p.desc || "") || (a.p.sku || "").localeCompare(b.p.sku || ""))
    .slice(0, Math.max(0, Math.min(cap, CATALOG_SEARCH_CAP)))
    .map(({ p }) => p);
}

/** Candidates → the hits a search returns (match, then rank + cap). */
export function filterCatalogHits(parts: readonly CatalogPart[], rawQuery: string, cap = CATALOG_SEARCH_CAP): CatalogPart[] {
  return rankCatalogHits(matchCatalogCandidates(parts, rawQuery), rawQuery, cap);
}

/** The selected library node a catalog search honours: a scope (a valid
 *  GridLayer) and, under it, a device type; "" = no filter (All). */
export type CatalogNode = { scope: string; typeKey: string };

export function cleanCatalogNode(raw: unknown): CatalogNode {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const scope = typeof o.scope === "string" && isGridLayer(o.scope) ? o.scope : "";
  const typeKey = scope && typeof o.typeKey === "string" ? o.typeKey.trim().slice(0, 80) : "";
  return { scope, typeKey };
}

/** Does a built result sit under the node — the palette's own rules (scopeOfPart, typeKeyOfPart)? */
export function inCatalogNode(p: PartLite, node: CatalogNode): boolean {
  if (node.scope && scopeOfPart(p) !== node.scope) return false;
  if (node.typeKey && typeKeyOfPart(p) !== node.typeKey) return false;
  return true;
}

/** The node a library selection searches the catalog under. */
export function catalogNodeOf(sel: { kind: string; scope?: string; typeKey?: string }): CatalogNode {
  return {
    scope: sel.kind === "scope" || sel.kind === "type" ? sel.scope || "" : "",
    typeKey: sel.kind === "type" ? sel.typeKey || "" : "",
  };
}

/** The truncation note the library shows when the candidate read hit its cap. */
export const CATALOG_TRUNCATED_NOTE = "Showing the first matches — add a word to narrow your search.";

function dimensionsFor(p: CatalogPart): { width: number; height: number } {
  const text = `${p.category} ${p.desc}`.toLowerCase();
  if (text.includes("speaker") || text.includes("fixture")) return { width: 48, height: 34 };
  if (text.includes("rack") || text.includes("control")) return { width: 54, height: 38 };
  return { width: 44, height: 30 };
}

/** The Grid library entry a pricing part becomes — the first-use seed and
 *  ensureGridSymbolsFor write exactly this (moved verbatim out of
 *  stores/grid-catalog.ts so a catalog search result is built the same way).
 *  #226: the scope is the keyword fallback; device types override it at read time. */
export function gridSymbolFromPart(p: CatalogPart, by: string, now = Date.now()): GridSymbol {
  const d = dimensionsFor(p);
  return {
    id: p.id,
    name: p.desc,
    manufacturer: p.mfr || "",
    modelNumber: p.sku,
    scope: keywordScopeOf(p),
    category: p.category || "Other",
    width: d.width,
    height: d.height,
    ports: p.ports || [],
    pricingPartId: p.id,
    kind: "device",
    createdBy: by,
    createdAt: now,
    updatedAt: now,
  };
}

/** The catalog results the library shows under its own tiles: not already in
 *  the library (by id), the manufacturer filter applied when one is set. */
export function catalogResultsToShow(results: readonly PartLite[], libraryIds: ReadonlySet<string>, mfr: string): PartLite[] {
  const m = mfr.trim();
  return results.filter((p) => !libraryIds.has(p.id) && (!m || (p.manufacturer || "").trim() === m));
}

/** Library nodes that offer the catalog section: All, a scope, a type — never
 *  Favorites / Recent / Assemblies / Curtains (or the From estimate tray). */
export function offersCatalogSearch(selKind: string, trayShown: boolean): boolean {
  return !trayShown && (selKind === "all" || selKind === "scope" || selKind === "type");
}

/** A stale-response guard: each request takes the next number; only the
 *  latest may land. */
export function makeRequestSeq(): { next: () => number; isLatest: (n: number) => boolean } {
  let latest = 0;
  return { next: () => ++latest, isLatest: (n) => n === latest };
}

/** How many catalog results the editor keeps known for lookups (oldest dropped). */
export const CATALOG_LOOKUP_MAX = 400;

/** Merge newly shown results into the editor's remembered catalog parts:
 *  newest win by id, capped at CATALOG_LOOKUP_MAX (oldest dropped). */
export function mergeCatalogLookups(prev: readonly PartLite[], found: readonly PartLite[]): PartLite[] {
  const ids = new Set(found.map((p) => p.id));
  return [...prev.filter((p) => !ids.has(p.id)), ...found].slice(-CATALOG_LOOKUP_MAX);
}

/** The editor's lookup list: the library parts, then remembered catalog
 *  results that aren't library parts (a library entry always wins). */
export function withCatalogLookups(parts: readonly PartLite[], catalog: readonly PartLite[]): readonly PartLite[] {
  if (!catalog.length) return parts;
  const have = new Set(parts.map((p) => p.id));
  const extra = catalog.filter((p) => !have.has(p.id));
  return extra.length ? [...parts, ...extra] : parts;
}
