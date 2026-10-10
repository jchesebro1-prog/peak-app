import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { sites, type NewSiteRow, type SiteRow } from "@/db/schema";
import { geoStampForSave, sameVenueAddress } from "@/lib/address-verify/state";
import { compareVenueOrder } from "@/lib/venue-types";

/**
 * Sites — venues owned by a company (D85, spec §4.4). "What is this job
 * called? The Site." Carried from CustomerLocation, which already had
 * per-customer ids ('loc1', …) preserved here as legacyLocId.
 */

/** Primary first, then creation order — the one venue order (#216) the
 *  company modal numbers its cards in and the type-rename re-derive uses. */
function primaryFirst(rows: SiteRow[]): SiteRow[] {
  return rows.sort(compareVenueOrder);
}

export async function sitesForCompany(
  companyId: string | null | undefined
): Promise<SiteRow[]> {
  if (!companyId) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(sites)
    .where(and(eq(sites.companyId, companyId), eq(sites.deleted, false)));
  return primaryFirst(rows);
}

/** All non-deleted sites across every company (for the Venues directory). */
export async function getAllSites(): Promise<SiteRow[]> {
  const db = await getDb();
  return db.select().from(sites).where(eq(sites.deleted, false));
}

export async function sitesForCompanies(
  ids: string[]
): Promise<Map<string, SiteRow[]>> {
  const out = new Map<string, SiteRow[]>();
  if (!ids.length) return out;
  const db = await getDb();
  const rows = await db
    .select()
    .from(sites)
    .where(and(inArray(sites.companyId, ids), eq(sites.deleted, false)));
  for (const r of rows) {
    const list = out.get(r.companyId) ?? [];
    list.push(r);
    out.set(r.companyId, list);
  }
  for (const [k, v] of out) out.set(k, primaryFirst(v));
  return out;
}

export async function getSite(
  id: string | null | undefined
): Promise<SiteRow | null> {
  if (!id) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.deleted, false)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert one venue. Address verification (spec 2026-10-09): the geo stamp is
 * always computed here from the stored row — callers' geo fields are ignored
 * — so every write path (venue dialog, company modal, convert) resets
 * verification on an address edit and can never overwrite a pin. Keys the
 * caller omits (undefined) count as unchanged.
 */
export async function saveSite(
  row: Omit<NewSiteRow, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
  }
): Promise<void> {
  const db = await getDb();
  const t = Date.now();
  const [prev] = await db.select().from(sites).where(eq(sites.id, row.id)).limit(1);
  const given = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
  const merged = prev ? { ...prev, ...given } : row;
  // A caller that changes the address but omits lat/lng must not carry the
  // old point to the new address: merge them as null so it re-verifies.
  const moved = !!prev && !sameVenueAddress(prev, merged);
  const dropCoords = moved && given.lat === undefined && given.lng === undefined;
  if (dropCoords) Object.assign(merged, { lat: null, lng: null });
  const { stamp, keepPrevCoords } = geoStampForSave(prev ?? null, merged, t);
  const full = {
    ...row,
    ...(dropCoords ? { lat: null, lng: null } : {}),
    ...stamp,
    ...(keepPrevCoords && prev ? { lat: prev.lat, lng: prev.lng } : {}),
  };
  const rest: Partial<NewSiteRow> = { ...full };
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  await db
    .insert(sites)
    .values({ ...full, createdAt: row.createdAt ?? t, updatedAt: t })
    .onConflictDoUpdate({
      target: sites.id,
      set: { ...rest, deleted: rest.deleted ?? false, updatedAt: t },
    });
}

export async function softDeleteSite(id: string): Promise<void> {
  const db = await getDb();
  await db
    .update(sites)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(eq(sites.id, id));
}

/** #216 — live (non-deleted) venues per venue-type key; keys with none are
 *  absent. Settings → Venue types refuses to remove a type still in use. */
export async function countSitesByVenueKind(
  keys: readonly string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!keys.length) return out;
  const db = await getDb();
  const rows = await db
    .select({ venueKind: sites.venueKind })
    .from(sites)
    .where(and(eq(sites.deleted, false), inArray(sites.venueKind, [...keys])));
  for (const r of rows) out[r.venueKind] = (out[r.venueKind] || 0) + 1;
  return out;
}

/** #216 — flag (or unflag) venues as auto-named, addressed by the doc
 *  location ids forms carry (legacyLocId, else the site id). Company-scoped. */
export async function setNameAutoForLocIds(
  companyId: string,
  locIds: readonly string[],
  on: boolean
): Promise<void> {
  const ids = [...new Set(locIds.filter(Boolean))];
  if (!companyId || !ids.length) return;
  const db = await getDb();
  await db
    .update(sites)
    .set({ nameAuto: on, updatedAt: Date.now() })
    .where(
      and(
        eq(sites.companyId, companyId),
        eq(sites.deleted, false),
        or(inArray(sites.legacyLocId, ids), inArray(sites.id, ids))
      )
    );
}

/** #216 — every distinct venue-type key stored on a site, soft-deleted
 *  rows included. Settings → Venue types never mints one of these as a new
 *  type's key (a deleted venue can come back live and would change type). */
export async function storedSiteVenueKinds(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.selectDistinct({ venueKind: sites.venueKind }).from(sites);
  return rows.map((r) => r.venueKind).filter((k): k is string => typeof k === "string" && k !== "");
}

/** The id doc records store as `locationId` — legacy alias when present. */
export function docLocId(s: SiteRow): string {
  return s.legacyLocId ?? s.id;
}

/**
 * Reverse of docLocId: given the id a scheduled record carries as its own
 * `locationId` (a migrated venue's legacyLocId, or a native site's own id),
 * find the site row it names. Every doc-side "which venue is this?" lookup
 * (the venue-availability check, the company record's venue → calendar
 * link) needs this direction — `getSite` alone only resolves `sites.id`,
 * which a migrated venue's callers never have.
 */
export async function getSiteByDocLocId(
  locationId: string | null | undefined
): Promise<SiteRow | null> {
  if (!locationId) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(sites)
    .where(and(eq(sites.deleted, false), or(eq(sites.legacyLocId, locationId), eq(sites.id, locationId))))
    .limit(1);
  return rows[0] ?? null;
}
