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
  // The first venue is always primary; a primary venue stays primary until
  // another one is made primary (the modal's "Make primary" radio).
  const primary = siblings.length === 0 || !!input.primary || !!existing?.isPrimary;
  if (primary) {
    for (const s of siblings) if (s.isPrimary) await saveSite({ ...s, isPrimary: false });
  }
  const id = existing?.id ?? mintId("st");
  await saveSite({
    ...(existing ?? {}),
    id,
    companyId: company.id,
    name,
    locationName: locationName || null,
    legacyLocId: existing?.legacyLocId ?? null,
    isPrimary: primary,
    address: cap(input.address, 300) || null,
    city: cap(input.city, 120) || null,
    state: cap(input.state, 60) || null,
    lat: coord(input.lat),
    lng: coord(input.lng),
    venueKind,
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
