// SERVER ONLY — reads the customer, the venue's site row, the offices and the route cache. No "server-only" package
// in this repo (see src/lib/freight-rule-load.ts); comment-only convention.
/* #344 B5 — the Visit card's Travel time / Distance pre-fill: a one-way drive from the office to the venue, only when
   the venue's address is verified and the estimate is a real drive (manual or routed). A failed lookup returns null;
   it never breaks the page. */
import { get as getCustomer } from "@/lib/stores/customers";
import { getSiteByDocLocId } from "@/lib/identity/sites";
import { venueAddressState } from "@/lib/address-verify/state";
import { coordsOf, estimate, officesFromSettings } from "@/lib/geo";
import { acceptTravel } from "@/lib/field-lists";

export async function surveyTravelSuggestion(rec: {
  customerId?: string | null;
  locationId?: string | null;
}): Promise<{ min: number; miles: number } | null> {
  try {
    if (!rec.customerId || !rec.locationId) return null;
    const cust = await getCustomer(rec.customerId);
    const loc = (cust?.locations || []).find((l) => l.id === rec.locationId);
    if (!loc) return null;
    const site = await getSiteByDocLocId(rec.locationId);
    if (!site || venueAddressState(site).status !== "verified") return null;
    const est = await estimate(await officesFromSettings(), { ...loc, ...(coordsOf(loc) || {}) });
    return acceptTravel(est);
  } catch {
    return null;
  }
}
