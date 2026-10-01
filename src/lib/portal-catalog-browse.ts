// SERVER ONLY — reads the portal catalog index (whose parts carry cost) and
// prices through portal-pricing.ts. Never import into a client component;
// it hands the browser `TileVM`s only (sell-only, see portal-catalog-view.ts).
import type { PortalSession } from "@/lib/portal";
import { portalIndex, type PortalIndex } from "@/lib/portal-catalog-index";
import { cleanDeptId, cleanSearchQuery, quotedBeforeSkus, toTileVM, type TileVM } from "@/lib/portal-catalog-view";
import { departmentFilterFor, departmentTiles, packagesTile, resolveDept, type DeptTileVM } from "@/lib/portal-departments";
import { priceFixture, priceSku, pricingContextFor, type PortalPricingContext } from "@/lib/portal-pricing";
import { searchCatalog, type Facet, type SearchEntry, type SearchGroups, type SearchQuery } from "@/lib/portal-search";
import { rateLimit } from "@/lib/rate-limit";
import { getAll as getAllQuotes, portalListsQuote } from "@/lib/stores/quotes";
import { getDepartments } from "@/lib/stores/portal-departments";

/**
 * Portal catalog browse (#245 Task 10, spec §3.1). The page renders first
 * paint through `browseCatalog`; the `searchPortalCatalog` server action
 * (src/app/portal/catalog/actions.ts) goes through `searchPortalCatalogFor`,
 * which is the action's whole body minus reading the cookie — so the
 * harness can exercise every refusal without a request scope.
 */

/** Verbatim (global constraints). */
export const PORTAL_EXPIRED_COPY = "Your access link has expired — open the link we sent you again.";
export const PORTAL_SEARCH_RATE_COPY = "Too many searches at once — wait a moment and try again.";
const SEARCH_LIMIT = 120;
const SEARCH_WINDOW_MS = 60_000;

/** The page path's own limit (#245 Task 11): every /portal/catalog render
 *  (browse, a search, an open sidebar) counts once per grant — or per
 *  previewed customer for a team preview. */
export const PORTAL_BROWSE_RATE_COPY = "Too many requests — try again in a minute.";
const BROWSE_LIMIT = 240;
const BROWSE_WINDOW_MS = 60_000;

/** The rate-limit key for a viewer (a team preview is keyed by the
 *  previewed customer, since every preview shares grantId "preview"). */
export function portalBrowseKey(session: Pick<PortalSession, "grantId" | "customerId">, preview: boolean): string {
  return preview ? "portal-browse:preview:" + session.customerId : "portal-browse:" + session.grantId;
}

/** Records one catalog page render; false once the viewer passes 240 a minute. */
export function portalBrowseAllowed(session: Pick<PortalSession, "grantId" | "customerId">, preview: boolean): boolean {
  return rateLimit(portalBrowseKey(session, preview), BROWSE_LIMIT, BROWSE_WINDOW_MS).ok;
}

export type CatalogResult = {
  entries: TileVM[];
  total: number;
  page: number;
  pages: number;
  mfrFacets: Facet[];
  catFacets: Facet[];
  /** #289: hits by kind — Packages & Assemblies (fixtures) head the
   *  results, Parts follow; counted over every page. */
  groups: SearchGroups;
  /** The active department (#252), resolved — null when none is selected
   *  or the `?dept=` id doesn't resolve to a real department/"other"/
   *  "packages" (#289, which resolves with or without departments). */
  dept: { id: string; name: string } | null;
  /** Landing tiles for the true landing page only (no q/mfr/cat, page 1,
   *  no dept), [] otherwise: Packages & Assemblies first when any fixture is
   *  browsable (#289, departments or not), then the department tiles ([]
   *  when no departments are configured). */
  tiles: DeptTileVM[];
};

export type SearchPortalCatalogResult = { ok: true; result: CatalogResult } | { ok: false; error: string };

/** Sell-only tiles for the given search entries, priced for `ctx`'s customer. */
export async function tilesFor(entries: readonly SearchEntry[], ix: PortalIndex, ctx: PortalPricingContext): Promise<TileVM[]> {
  return Promise.all(
    entries.map(async (e) => {
      if (e.kind === "fixture") {
        const fx = ix.fixtures.get(e.key.slice("fixture:".length));
        const engine = fx ? ix.parts.get(fx.lightEngineSku) : undefined;
        const price = fx ? await priceFixture(fx.id, {}, ctx) : null;
        return toTileVM(e, engine, price, fx);
      }
      return toTileVM(e, ix.parts.get(e.sku), await priceSku(e.sku, ctx));
    })
  );
}

/** One page of results + both facet lists, as tiles. */
export async function browseCatalog(query: unknown, ctx: PortalPricingContext): Promise<CatalogResult> {
  const [ix, departments] = await Promise.all([portalIndex(), getDepartments()]);
  const sq = cleanSearchQuery(query);
  const deptId = cleanDeptId(query);
  const dept = resolveDept(departments, deptId);
  const filter = departmentFilterFor(departments, deptId);
  const q: SearchQuery = filter ? { ...sq, dept: filter } : sq;
  const r = searchCatalog(ix.entries, q);
  const landing = !sq.q && !sq.mfr.length && !sq.cat.length && sq.page === 1 && !dept;
  // A part's thumbnail is its first image; a package's is its light engine's.
  const imageIdOf = (key: string) => {
    const sku = key.startsWith("fixture:") ? ix.fixtures.get(key.slice("fixture:".length))?.lightEngineSku : key;
    return (sku && ix.parts.get(sku)?.imageIds[0]) || null;
  };
  const pkgTile = landing ? packagesTile(ix.entries, imageIdOf) : null;
  const tiles = landing ? [...(pkgTile ? [pkgTile] : []), ...departmentTiles(departments, ix.entries, imageIdOf)] : [];
  return {
    entries: await tilesFor(r.entries, ix, ctx),
    total: r.total,
    page: r.page,
    pages: r.pages,
    mfrFacets: r.mfrFacets,
    catFacets: r.catFacets,
    groups: r.groups,
    dept,
    tiles,
  };
}

/** "Parts you've quoted before" for the context's customer — their own
 *  listed, app-era quotes only (`portalListsQuote` drops other companies,
 *  internal drafts and Daylite history), quotable SKUs, newest first, ≤ 12. */
export async function quotedBeforeShelf(ctx: PortalPricingContext): Promise<TileVM[]> {
  const [ix, quotes] = await Promise.all([portalIndex(), getAllQuotes()]);
  const mine = quotes.filter((q) => portalListsQuote(q, ctx.customerId));
  const skus = quotedBeforeSkus(mine, (sku) => ix.parts.has(sku));
  const entries: SearchEntry[] = [];
  for (const sku of skus) {
    const p = ix.parts.get(sku);
    if (!p) continue;
    entries.push({ key: p.sku, kind: "part", title: p.desc || p.sku, sku: p.sku, mfr: p.mfr, category: p.category, haystack: "", browsable: true, rank: 0 });
  }
  return tilesFor(entries, ix, ctx);
}

/**
 * The `searchPortalCatalog` action's body. `session` MUST come from
 * `portalSession()` — the customer (and so the price tier) is never taken
 * from the client. Rate-limited per grant; page size clamped to 48.
 */
export async function searchPortalCatalogFor(session: PortalSession | null, query: unknown): Promise<SearchPortalCatalogResult> {
  if (!session) return { ok: false, error: PORTAL_EXPIRED_COPY };
  if (!rateLimit("portal-search:" + session.grantId, SEARCH_LIMIT, SEARCH_WINDOW_MS).ok) {
    return { ok: false, error: PORTAL_SEARCH_RATE_COPY };
  }
  const ctx = await pricingContextFor(session);
  return { ok: true, result: await browseCatalog(query, ctx) };
}
