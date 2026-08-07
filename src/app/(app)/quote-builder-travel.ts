"use server";

import { requireUser } from "@/lib/session";
import { travelForCustomerVenues } from "@/lib/stores/customers";

/**
 * Venue travel for ONE customer, fetched when that customer is selected
 * (punch #90).
 *
 * The three service-quote builders (repairs, inspections, flame tests) used
 * to resolve travel for every venue of every customer in the directory while
 * rendering the page — `travelForId()` per customer per venue, inside nested
 * Promise.all maps. Each of those calls re-fetches the office list and hits
 * the geo cache on its own, so against the real directory (~1,700 companies)
 * it fired thousands of concurrent queries at a hosted Postgres from a
 * serverless function. That trades a slow page for connection-pool
 * exhaustion, which takes unrelated requests down with it.
 *
 * All three builders read travel for the SELECTED customer only — the venue
 * checklist labels, the trip-mileage math, and the venues copied onto the
 * quote all come off `customer.locations`. So the page now seeds just the
 * pre-selected customer and the client asks here for anything else.
 *
 * ONE shared action rather than a copy per builder: three near-identical
 * copies of one flow is exactly how #65's tier-stamp divergence and #75's
 * duplicate promote paths happened.
 */

export type VenueTravel = { miles: number | null; minutes: number | null };

export async function venueTravelAction(
  customerId: string
): Promise<Record<string, VenueTravel>> {
  await requireUser();
  const out: Record<string, VenueTravel> = {};
  if (!customerId) return out;
  const map = await travelForCustomerVenues(customerId);
  for (const [locId, est] of Object.entries(map)) {
    out[locId] = { miles: est?.miles ?? null, minutes: est?.minutes ?? null };
  }
  return out;
}
