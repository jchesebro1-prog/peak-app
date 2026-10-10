/**
 * Address states for site visits (spec "Site visits"): linked to a venue →
 * the venue's state; otherwise its own address text through the place book.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { sites } from "@/db/schema";
import { addressKey } from "./keys";
import { placeStatesFor, type PlaceDeps } from "./place-book";
import { placeAddressState, venueAddressState } from "./state";
import type { AddressState } from "./types";

/** A visit's locationId is the company-scoped CustomerLocation id —
 *  sites.legacyLocId when present, else sites.id (D85). */
export function matchVisitSite<T extends { id: string; companyId: string; legacyLocId: string | null }>(
  v: { customerId: string | null; locationId: string | null },
  rows: T[]
): T | null {
  if (!v.locationId) return null;
  return (
    rows.find(
      (s) => (!v.customerId || s.companyId === v.customerId) && (s.legacyLocId === v.locationId || s.id === v.locationId)
    ) ?? null
  );
}

export type VisitAddressInput = { id: string; customerId: string | null; locationId: string | null; address: string };

export async function addressStatesForVisits(
  visits: VisitAddressInput[],
  mode: "cache" | "live",
  deps?: Partial<PlaceDeps>
): Promise<Map<string, AddressState>> {
  const out = new Map<string, AddressState>();
  if (!visits.length) return out;
  const companyIds = [...new Set(visits.filter((v) => v.locationId && v.customerId).map((v) => v.customerId as string))];
  const db = await getDb();
  const siteRows = companyIds.length
    ? await db.select().from(sites).where(and(inArray(sites.companyId, companyIds), eq(sites.deleted, false)))
    : [];
  const venueFor = new Map<string, (typeof siteRows)[number]>();
  const texts: string[] = [];
  for (const v of visits) {
    const site = matchVisitSite(v, siteRows);
    if (site) venueFor.set(v.id, site);
    else texts.push(v.address || "");
  }
  const places = await placeStatesFor(texts, mode, deps);
  for (const v of visits) {
    const site = venueFor.get(v.id);
    out.set(
      v.id,
      site ? venueAddressState(site) : places.get(addressKey(v.address)) ?? placeAddressState(v.address || "", null)
    );
  }
  return out;
}
