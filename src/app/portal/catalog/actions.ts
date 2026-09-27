"use server";

import { portalSession } from "@/lib/portal";
import { searchPortalCatalogFor, type SearchPortalCatalogResult } from "@/lib/portal-catalog-browse";
import type { SearchQuery } from "@/lib/portal-search";

/**
 * Portal catalog search (#242 Task 10, spec §3.1). SECURITY: runs for
 * anonymous visitors — the customer comes from `portalSession()` (the grant
 * cookie) only, never from the client; results are sell-only `TileVM`s.
 * A team preview never reaches this action (actions carry no ?preview=).
 *
 * The browse page itself navigates by URL (the server renders each result
 * page); this action serves in-place lookups such as the part sidebar's
 * "Goes with" (Task 11).
 *
 * A session lookup that throws (no request scope, a failed grant read) fails
 * CLOSED to the expired-link refusal rather than surfacing an error.
 */
export async function searchPortalCatalog(q: SearchQuery): Promise<SearchPortalCatalogResult> {
  const session = await portalSession().catch(() => null);
  return searchPortalCatalogFor(session, q);
}
