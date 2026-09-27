import { and, eq, inArray } from "drizzle-orm";
import { getDb, withTransaction } from "@/db";
import { sites, type SiteRow } from "@/db/schema";
import { getCompany } from "@/lib/identity/companies";
import { mintId } from "@/lib/identity/ids";
import { docLocId, saveSite, sitesForCompany } from "@/lib/identity/sites";
import { getSettings } from "@/lib/settings";
import {
  deriveVenueName,
  planVenueRenames,
  venueTypeLabel,
  venueTypeOptions,
  venueTypesFrom,
  venueMoveRule,
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
  // One move rule for the dialog and the company modal (lib/venue-types).
  const { zip, lat, lng, moved } = venueMoveRule(existing, {
    address,
    city,
    state,
    zip: cap(input.zip, 20) || null,
    lat: coord(input.lat),
    lng: coord(input.lng),
  });
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
      nameAuto: true,
    });
  });
  return { ok: true, siteId: id, locId: existing ? docLocId(existing) : id, name };
}

/** One venue card of a whole-company save (the company modal and quote
 *  intake → saveCustomerAction). Structural so this module needs no app type. */
export type CompanyVenueLoc = {
  id?: string;
  address: string;
  city: string;
  state: string;
  zip?: string | null;
  lat: number | null;
  lng: number | null;
  travelMiles: number | null;
  travelMin: number | null;
};

/**
 * #216 — the company modal's whole-company save applies the same move rule
 * as saveVenue (venueMoveRule). The modal sends coordinates only from a
 * picked hit or as the stored ones echoed back while the address is
 * untouched, and the picked hit's zip.
 *
 *  - Address unchanged: stored zip kept; stored lat/lng kept unless a
 *    picked hit sent new ones. Travel: what the form sent (its editable
 *    mi/min fields and Route button are the manual override), else stored.
 *  - Moved (address or coordinates changed): lat/lng/zip from the pick,
 *    else null; the drive distance is cleared — unless the form sent a
 *    distance that differs from the stored one (Route after the move), which
 *    was measured from the new spot.
 *
 * Cards are matched to stored sites like writeRecord does (legacyLocId,
 * then site id); an unmatched card is a new venue and keeps what it sent.
 * A cleared zip is returned as null (the store's explicit "clear" — blank
 * means preserve there).
 */
export async function applyVenueMoveRule<L extends CompanyVenueLoc>(
  companyId: string | null | undefined,
  locs: readonly L[]
): Promise<L[]> {
  const stored = await sitesForCompany(companyId);
  const byKey = new Map<string, SiteRow>();
  for (const s of stored) {
    if (s.legacyLocId) byKey.set(s.legacyLocId, s);
    byKey.set(s.id, s);
  }
  const numText = (v: unknown): string | null =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : null;
  const num = (v: string | null): number | null =>
    v == null || v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  return locs.map((l) => {
    const s = l.id ? byKey.get(l.id) : undefined;
    if (!s) return l;
    const r = venueMoveRule(s, {
      address: (l.address || "").trim(),
      city: (l.city || "").trim(),
      state: (l.state || "").trim(),
      zip: (l.zip || "").trim() || null,
      lat: numText(l.lat),
      lng: numText(l.lng),
    });
    const storedMiles = num(s.travelMiles);
    const storedMin = num(s.travelMin);
    const sentMiles = l.travelMiles === undefined ? storedMiles : l.travelMiles;
    const sentMin = l.travelMin === undefined ? storedMin : l.travelMin;
    const fresh = sentMiles !== storedMiles || sentMin !== storedMin;
    const keepTravel = !r.moved || fresh;
    return {
      ...l,
      // null only to clear a stored zip — undefined (preserve) otherwise, so
      // a no-op save still compares equal (D83).
      zip: r.zip ?? (s.zip ? null : undefined),
      lat: num(r.lat),
      lng: num(r.lng),
      travelMiles: keepTravel ? sentMiles : null,
      travelMin: keepTravel ? sentMin : null,
    };
  });
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

/** #216 — after Settings renames venue types: re-derive the names of every
 *  auto-named venue in each company that has one of those types (all of
 *  that company's auto-named venues, primary first then creation order, so
 *  numbering stays stable). Hand-kept names are never touched. Returns how
 *  many names changed. */
export async function rederiveVenueNamesForTypes(
  keys: readonly string[],
  types: readonly VenueType[]
): Promise<number> {
  if (!keys.length) return 0;
  const db = await getDb();
  const hit = await db
    .select({ companyId: sites.companyId })
    .from(sites)
    .where(and(eq(sites.deleted, false), eq(sites.nameAuto, true), inArray(sites.venueKind, [...keys])));
  let changed = 0;
  for (const companyId of [...new Set(hit.map((r) => r.companyId))]) {
    const company = await getCompany(companyId);
    if (!company) continue;
    const rows = await sitesForCompany(companyId);
    const plan = planVenueRenames(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        locationName: s.locationName,
        venueKind: s.venueKind,
        nameAuto: s.nameAuto,
        isPrimary: s.isPrimary,
        createdAt: s.createdAt,
      })),
      company.name,
      types
    );
    for (const p of plan) {
      // Still auto-named and live: a hand rename or delete since the read wins.
      const hitRows = await db
        .update(sites)
        .set({ name: p.name, updatedAt: Date.now() })
        .where(and(eq(sites.id, p.id), eq(sites.nameAuto, true), eq(sites.deleted, false)))
        .returning({ id: sites.id });
      changed += hitRows.length;
    }
  }
  return changed;
}
