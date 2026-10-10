/**
 * The Fix dialog's server side (spec "Fixing an address"): (1) retype and
 * re-run the geocoder; (2) pick a suggestion; (3) drop a pin. A venue fix
 * writes the venue (locateVenue); anything else writes the place book.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, sites } from "@/db/schema";
import { locateVenue } from "@/lib/venue-locate";
import { addressKey } from "./keys";
import { fixPlace, getPlaces, type PlaceDeps } from "./place-book";
import { isValidPoint, venueGeoStatus } from "./state";
import type { FixTarget, GeoStatus } from "./types";

type VenueT = { kind: "venue"; siteId: string };
type PlaceT = { kind: "place"; key: string; label: string };

export type FixAddressInput =
  | { target: VenueT; mode: "retry"; address: string; city: string; state: string; zip: string }
  | { target: VenueT; mode: "pick"; address: string; city: string; state: string; zip: string; lat: number; lng: number }
  | { target: VenueT; mode: "pin"; lat: number; lng: number }
  | { target: PlaceT; mode: "retry"; text: string }
  | { target: PlaceT; mode: "pick"; street: string; lat: number; lng: number }
  | { target: PlaceT; mode: "pin"; lat: number; lng: number };

export type FixAddressResult = { ok: true; status: GeoStatus; pointKey: string } | { ok: false; reason: string; got?: string };

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : null);

/** Untrusted server-action input → a well-formed FixAddressInput, or null. */
export function cleanFixInput(raw: unknown): FixAddressInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const t = r.target as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object") return null;
  const mode = r.mode;
  if (t.kind === "venue") {
    const siteId = str(t.siteId, 200);
    if (!siteId) return null;
    const target: VenueT = { kind: "venue", siteId };
    if (mode === "pin") return isValidPoint(r.lat, r.lng) ? { target, mode, lat: r.lat as number, lng: r.lng as number } : null;
    const f = { address: str(r.address, 300), city: str(r.city, 120), state: str(r.state, 60), zip: str(r.zip, 20) };
    if (f.address == null || f.city == null || f.state == null || f.zip == null) return null;
    const fields = f as { address: string; city: string; state: string; zip: string };
    if (mode === "retry") return { target, mode, ...fields };
    if (mode === "pick") return isValidPoint(r.lat, r.lng) ? { target, mode, ...fields, lat: r.lat as number, lng: r.lng as number } : null;
    return null;
  }
  if (t.kind === "place") {
    const key = str(t.key, 300);
    const label = str(t.label, 300);
    if (!key || label == null) return null;
    const target: PlaceT = { kind: "place", key, label };
    if (mode === "pin") return isValidPoint(r.lat, r.lng) ? { target, mode, lat: r.lat as number, lng: r.lng as number } : null;
    if (mode === "retry") {
      const text = str(r.text, 300);
      return text ? { target, mode, text } : null;
    }
    if (mode === "pick") {
      const street = str(r.street, 300);
      return street != null && isValidPoint(r.lat, r.lng) ? { target, mode, street, lat: r.lat as number, lng: r.lng as number } : null;
    }
  }
  return null;
}

type VenueInput = Extract<FixAddressInput, { target: VenueT }>;
type PlaceInput = Extract<FixAddressInput, { target: PlaceT }>;

export async function fixAddress(input: FixAddressInput, by: string, deps?: Partial<PlaceDeps>): Promise<FixAddressResult> {
  if (input.target.kind === "venue") {
    const v = input as VenueInput;
    const siteId = v.target.siteId;
    const r =
      v.mode === "pin"
        ? await locateVenue({ siteId, mode: "pin", lat: v.lat, lng: v.lng }, { by })
        : v.mode === "pick"
          ? await locateVenue({ siteId, mode: "pick", address: v.address, city: v.city, state: v.state, zip: v.zip, lat: v.lat, lng: v.lng }, { by })
          : await locateVenue({ siteId, mode: "retry", address: v.address, city: v.city, state: v.state, zip: v.zip }, { by });
    return r.ok ? { ok: true, status: r.status, pointKey: "site:" + siteId } : { ok: false, reason: r.reason, ...(r.got ? { got: r.got } : {}) };
  }
  const p = input as PlaceInput;
  const { key, label } = p.target;
  const r =
    p.mode === "pin"
      ? await fixPlace({ key, label, mode: "pin", lat: p.lat, lng: p.lng }, by, deps)
      : p.mode === "pick"
        ? await fixPlace({ key, label, mode: "pick", street: p.street, lat: p.lat, lng: p.lng }, by, deps)
        : await fixPlace({ key, label, mode: "retry", text: p.text }, by, deps);
  return r.ok ? { ok: true, status: r.status, pointKey: "place:" + key } : { ok: false, reason: r.reason };
}

export type FixTargetDetails = {
  title: string;
  sub: string;
  href: string;
  status: GeoStatus;
  venue: { address: string; city: string; state: string; zip: string } | null;
  placeText: string | null;
};

export async function loadFixTarget(target: FixTarget): Promise<FixTargetDetails | null> {
  if (target.kind === "venue") {
    const db = await getDb();
    const [row] = await db
      .select({ site: sites, companyName: companies.name })
      .from(sites)
      .leftJoin(companies, eq(companies.id, sites.companyId))
      .where(and(eq(sites.id, target.siteId), eq(sites.deleted, false)))
      .limit(1);
    if (!row) return null;
    const s = row.site;
    return {
      title: row.companyName || "(unknown company)",
      sub: s.name || "Untitled venue",
      href: "/companies/" + encodeURIComponent(s.companyId),
      status: venueGeoStatus(s),
      venue: { address: s.address || "", city: s.city || "", state: s.state || "", zip: s.zip || "" },
      placeText: null,
    };
  }
  const key = addressKey(target.label);
  if (!key || key !== target.key) return null;
  const row = (await getPlaces([key])).get(key);
  return { title: target.label, sub: "Address", href: "", status: row?.status ?? "unresolved", venue: null, placeText: target.label };
}
