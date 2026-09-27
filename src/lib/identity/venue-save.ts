import { withTransaction } from "@/db";
import type { SiteRow } from "@/db/schema";
import { getCompany } from "@/lib/identity/companies";
import { mintId } from "@/lib/identity/ids";
import { docLocId, saveSite, sitesForCompany } from "@/lib/identity/sites";
import { getSettings } from "@/lib/settings";
import {
  deriveVenueName,
  venueTypeLabel,
  venueTypeOptions,
  venueTypesFrom,
  type SaveVenueInput,
  type SaveVenueResult,
  type VenueDialogInitial,
  type VenueType,
} from "@/lib/venue-types";

/**
 * #216 — save ONE venue of one company. Server-only (reads the DB and the
 * settings blob); client code reaches it through saveVenueAction.
 *
 * The name is never taken from the caller: it is derived "Location — Type"
 * against the company's OTHER venues (lib/venue-types deriveVenueName).
 * Siblings are never rewritten, except that making this venue primary clears
 * the old primary. Soft delete stays on the company edit modal.
 *
 * Coordinates: an edit that leaves the street/city/state unchanged and sends
 * no coordinates keeps the stored lat/lng; a changed address with no
 * coordinates clears them (the geocode runner re-locates it). Whenever the
 * venue moves (address or coordinates changed) its cached drive distance
 * (travelMiles/travelMin) is cleared — it priced the old spot. The zip
 * follows the same rule: kept while the address is unchanged (a sent zip
 * only fills a blank one), otherwise replaced by the sent zip or cleared.
 */

export async function loadVenueTypes(): Promise<VenueType[]> {
  return venueTypesFrom((await getSettings()).venueTypes);
}

const cap = (v: unknown, n: number): string => (typeof v === "string" ? v.trim().slice(0, n) : "");
const coord = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : null);
/** Stored coordinate text compared by value ("40.10" ≡ "40.1"; null ≡ ""). */
const sameCoord = (a: string | null, b: string | null): boolean => {
  const n = (v: string | null) => (v == null || v.trim() === "" ? null : Number(v));
  return n(a) === n(b);
};

export async function saveVenue(input: SaveVenueInput): Promise<SaveVenueResult> {
  const companyId = cap(input?.companyId, 200);
  const company = companyId ? await getCompany(companyId) : null;
  if (!company) return { ok: false, error: "Company not found." };
  const all = await sitesForCompany(company.id);
  // A forged non-string id must not silently turn an edit into a create.
  if (input.siteId != null && typeof input.siteId !== "string") {
    return { ok: false, error: "That venue isn't on this company any more — refresh and try again." };
  }
  const siteId = cap(input.siteId, 200);
  const existing = siteId ? (all.find((s) => s.id === siteId) ?? null) : null;
  if (siteId && !existing) {
    return { ok: false, error: "That venue isn't on this company any more — refresh and try again." };
  }
  const types = await loadVenueTypes();
  const venueKind = cap(input.venueKind, 80);
  if (!venueTypeOptions(types, existing?.venueKind).some((t) => t.key === venueKind)) {
    return { ok: false, error: "Pick a venue type." };
  }
  const siblings = all.filter((s) => s.id !== existing?.id);
  const locationName = cap(input.locationName, 120);
  const name = deriveVenueName(
    { locationName, companyName: company.name, typeLabel: venueTypeLabel(types, venueKind) },
    siblings.map((s) => s.name)
  );
  const address = cap(input.address, 300);
  const city = cap(input.city, 120);
  const state = cap(input.state, 60);
  const sameAddress =
    !!existing &&
    (existing.address ?? "").trim() === address &&
    (existing.city ?? "").trim() === city &&
    (existing.state ?? "").trim() === state;
  // A moved venue never keeps the old zip — the geocode backfill matches on
  // it (zip-only hits too) and would re-locate the venue near its old spot.
  const zipIn = cap(input.zip, 20) || null;
  const zip = sameAddress ? (existing?.zip || zipIn) : zipIn;
  let lat = coord(input.lat);
  let lng = coord(input.lng);
  if (lat == null || lng == null) {
    // No (complete) coordinates sent: keep the stored ones only when the
    // venue hasn't moved.
    lat = sameAddress ? (existing?.lat ?? null) : null;
    lng = sameAddress ? (existing?.lng ?? null) : null;
  }
  const moved = !!existing && (!sameAddress || !sameCoord(lat, existing.lat) || !sameCoord(lng, existing.lng));
  // The first venue is always primary; a primary venue stays primary until
  // another one is made primary (the modal's "Make primary" radio).
  const primary = siblings.length === 0 || !!input.primary || !!existing?.isPrimary;
  const id = existing?.id ?? mintId("st");
  // One transaction: a failed save can never leave the company with no primary.
  await withTransaction(async () => {
    if (primary) {
      for (const s of siblings) if (s.isPrimary) await saveSite({ ...s, isPrimary: false });
    }
    await saveSite({
      ...(existing ?? {}),
      id,
      companyId: company.id,
      name,
      locationName: locationName || null,
      legacyLocId: existing?.legacyLocId ?? null,
      isPrimary: primary,
      address: address || null,
      city: city || null,
      state: state || null,
      zip,
      lat,
      lng,
      ...(moved ? { travelMiles: null, travelMin: null } : {}),
      venueKind,
    });
  });
  return { ok: true, siteId: id, locId: existing ? docLocId(existing) : id, name };
}

/** A stored site → the venue dialog's starting values. */
export function venueDialogInitial(s: SiteRow): VenueDialogInitial {
  const num = (v: string | null): number | null =>
    v == null || v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  return {
    siteId: s.id,
    locationName: s.locationName ?? "",
    venueKind: s.venueKind || "proscenium",
    address: s.address ?? "",
    city: s.city ?? "",
    state: s.state ?? "",
    lat: num(s.lat),
    lng: num(s.lng),
    primary: s.isPrimary,
    currentName: s.name,
  };
}
