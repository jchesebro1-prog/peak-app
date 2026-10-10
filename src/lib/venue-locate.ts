/**
 * Unlocated venues — the Settings → Admin worklist and its one-venue fix
 * (punch #175, D228). Spec: docs/superpowers/specs/2026-09-24-geo-fix-sidebar-design.md
 *
 * The worklist is a live query, not the batch run's memory: every venue that
 * has an address (or a city) but no coordinates and no manual travel
 * override. It survives reloads, has no cap, and shrinks as venues are fixed
 * from anywhere. locateVenue() fixes ONE venue three ways — retry an edited
 * address through the batch's own gates (geocodeVenue), take a search
 * suggestion a human picked, or take a pin a human dropped — then warms its
 * OSRM route so travel reads "routed" immediately.
 *
 * Writes are targeted UPDATEs of that one `sites` row (D181): never an
 * insert, never the company's mailing address, never travelMiles/travelMin —
 * the Companies "Route" button copies miles into those manual-override
 * fields and so freezes travel; here travel stays live via the route cache.
 */
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { companies, sites } from "@/db/schema";
import {
  estimate,
  hasCoords,
  officesFromSettings,
  quoteOrigin,
  route,
  type TravelSource,
} from "@/lib/geo";
import { geocodedStatus, hasHouseNumber, isValidPoint } from "@/lib/address-verify/state";
import type { GeoStatus } from "@/lib/address-verify/types";
import { geocodeVenue, newGeocodeCtx, type GeocodeFailure, type GeocodePrecision } from "@/lib/geo-backfill";
import { pacedSearch, pacedSearchCity } from "@/lib/address-verify/nominatim-pacer";

export type UnlocatedVenue = {
  siteId: string;
  companyId: string;
  companyName: string;
  venueName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

const blank = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') = ''`;
const present = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') <> ''`;

/** No usable coordinates — NULL and "" both count as missing (see venuesMissingCoords). */
const noCoords = or(isNull(sites.lat), eq(sites.lat, ""), isNull(sites.lng), eq(sites.lng, ""))!;

export async function listUnlocatedVenues(opts?: {
  q?: string;
  offset?: number;
  limit?: number;
}): Promise<{ rows: UnlocatedVenue[]; total: number; noAddress: number }> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(200, Math.floor(Number(opts?.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(opts?.offset) || 0));
  const q = (opts?.q || "").trim().slice(0, 100);

  const fixable = and(
    eq(sites.deleted, false),
    noCoords,
    or(present(sites.address), present(sites.city)),
    // A manual override already gives estimate() a travel number.
    // estimateFromParts() (src/lib/geo.ts) only treats travelMiles as the
    // override — travelMin alone is not one, so it must not exclude a row.
    blank(sites.travelMiles)
  )!;
  const like = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  const where = q
    ? and(
        fixable,
        or(
          ilike(companies.name, like),
          ilike(sites.name, like),
          ilike(sites.address, like),
          ilike(sites.city, like)
        )
      )!
    : fixable;

  const rows = await db
    .select({
      siteId: sites.id,
      companyId: sites.companyId,
      companyName: companies.name,
      venueName: sites.name,
      address: sites.address,
      city: sites.city,
      state: sites.state,
      zip: sites.zip,
    })
    .from(sites)
    .leftJoin(companies, eq(companies.id, sites.companyId))
    .where(where)
    .orderBy(
      asc(sql`lower(coalesce(${companies.name}, ''))`),
      asc(sql`lower(coalesce(${sites.name}, ''))`),
      asc(sites.id)
    )
    .limit(limit)
    .offset(offset);

  const [{ n: total }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sites)
    .leftJoin(companies, eq(companies.id, sites.companyId))
    .where(where);
  const [{ n: noAddress }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sites)
    .where(and(eq(sites.deleted, false), noCoords, blank(sites.address), blank(sites.city)));

  return {
    rows: rows.map((r) => ({
      siteId: r.siteId,
      companyId: r.companyId,
      companyName: r.companyName || "(unknown company)",
      venueName: r.venueName || "",
      address: r.address || "",
      city: r.city || "",
      state: r.state || "",
      zip: r.zip || "",
    })),
    total: Number(total) || 0,
    noAddress: Number(noAddress) || 0,
  };
}

export type LocateInput =
  | { siteId: string; mode: "retry"; address: string; city: string; state: string; zip: string }
  | {
      siteId: string;
      mode: "pick";
      address: string;
      city: string;
      state: string;
      zip: string;
      lat: number;
      lng: number;
    }
  | { siteId: string; mode: "pin"; lat: number; lng: number };

export type LocateResult =
  | {
      ok: true;
      lat: number;
      lng: number;
      precision: GeocodePrecision;
      /** Address verification (spec 2026-10-09) status this fix stamped. */
      status: GeoStatus;
      miles: number | null;
      minutes: number | null;
      source: TravelSource;
      officeName: string | null;
    }
  | { ok: false; reason: GeocodeFailure["reason"] | "gone" | "invalid" | "kept-pin"; got?: string };

const clip = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
const orNull = (s: string) => (s ? s : null);

export async function locateVenue(
  input: LocateInput,
  opts?: { delayMs?: number; by?: string | null }
): Promise<LocateResult> {
  const db = await getDb();
  const siteId = clip(input?.siteId, 120);
  const [row] = siteId
    ? await db.select().from(sites).where(and(eq(sites.id, siteId), eq(sites.deleted, false))).limit(1)
    : [];
  if (!row) return { ok: false, reason: "gone" };

  let lat: number;
  let lng: number;
  let precision: GeocodePrecision;
  // The street the resulting fix is judged on (see geocodedStatus).
  let askedStreet = "";
  let hitStreet = "";
  const set: Partial<typeof sites.$inferInsert> = { updatedAt: Date.now() };

  if (input.mode === "retry") {
    const fields = {
      address: clip(input.address),
      city: clip(input.city, 100),
      state: clip(input.state, 40),
      zip: clip(input.zip, 20),
    };
    // Every lookup (free text + the town-centre check) takes a turn on the
    // instance-wide Nominatim pacer, fail-soft; the pacer does the spacing.
    const pace = opts?.delayMs != null ? { delayMs: opts.delayMs } : undefined;
    const out = await geocodeVenue(fields, {
      ...newGeocodeCtx(0),
      search: (q, o) => pacedSearch(q, o, pace),
      searchCity: (city, state, o) => pacedSearchCity(city, state, o, pace),
    });
    if (!out.ok) return { ok: false, reason: out.reason, ...(out.got ? { got: out.got } : {}) };
    lat = out.lat;
    lng = out.lng;
    precision = out.precision;
    askedStreet = fields.address;
    hitStreet = out.hit.street || "";
    Object.assign(set, {
      address: orNull(fields.address),
      city: orNull(fields.city),
      state: orNull(fields.state),
      zip: orNull(fields.zip),
    });
  } else if (input.mode === "pick" || input.mode === "pin") {
    if (!isValidPoint(input.lat, input.lng)) return { ok: false, reason: "invalid" };
    lat = input.lat;
    lng = input.lng;
    if (input.mode === "pick") {
      // A picked suggestion's street/city/state/zip only overwrites what's
      // stored when it actually says something. A town-level hit (blank
      // street) or a street with no house number (#175 D228 item 2 — a
      // human picked the PLACE, not necessarily a corrected address) must
      // not wipe a real stored value down to NULL or truncate it.
      const pickedStreet = clip(input.address);
      Object.assign(set, {
        address: /\d/.test(pickedStreet) ? pickedStreet : row.address,
        city: clip(input.city, 100) || row.city,
        state: clip(input.state, 40) || row.state,
        zip: clip(input.zip, 20) || row.zip,
      });
      // Judged on the PICKED suggestion, never the stored address: a
      // town-level pick on a venue that already has a street is not a
      // building fix.
      askedStreet = pickedStreet;
      hitStreet = pickedStreet;
      precision = hasHouseNumber(pickedStreet) ? "building" : "city";
    } else {
      // pin: a human placed the exact point on the map.
      precision = "building";
    }
  } else {
    return { ok: false, reason: "invalid" };
  }

  // Address verification (spec 2026-10-09). A Fix is deliberate, so it may
  // replace a pin; a dropped pin is always verified. retry/pick verify only
  // when the street asked for AND the street the geocoder (or the human's
  // pick) returned both lead with a house number, and are credited to the
  // person who ran them when they verify.
  const status: GeoStatus =
    input.mode === "pin" ? "verified" : geocodedStatus(askedStreet, { street: hitStreet, lat, lng });
  Object.assign(set, {
    geoStatus: status,
    geoSource: input.mode === "pin" ? "pin" : "geocode",
    geoVerifiedBy: status === "verified" ? (opts?.by ?? null) : null,
    geoVerifiedAt: status === "verified" ? Date.now() : null,
  });
  set.lat = String(lat);
  set.lng = String(lng);
  // A Retry or Pick weaker than verified never replaces a verified hand pin:
  // nothing is written (not even the retyped address) and the person is told.
  // The guard is in the UPDATE too, so a pin dropped while a Retry was in
  // flight survives as well.
  const keepsPin = input.mode !== "pin" && status !== "verified";
  if (keepsPin && row.geoSource === "pin" && row.geoStatus === "verified") return { ok: false, reason: "kept-pin" };
  const updated = await db
    .update(sites)
    .set(set)
    .where(
      and(
        eq(sites.id, row.id),
        eq(sites.deleted, false),
        ...(keepsPin ? [sql`not (coalesce(${sites.geoSource}, '') = 'pin' and coalesce(${sites.geoStatus}, '') = 'verified')`] : [])
      )
    )
    .returning({ id: sites.id });
  if (updated.length === 0) {
    // Soft-deleted between the SELECT above and this UPDATE (retry mode makes
    // paced network calls in between) must not be reported located; else the
    // pin guard stopped it.
    const [still] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, row.id), eq(sites.deleted, false))).limit(1);
    return { ok: false, reason: still ? "kept-pin" : "gone" };
  }

  // Warm the real route now so travel reads "routed", not the haversine tier.
  // route() fails soft to null; estimate() then falls back on its own.
  const offices = await officesFromSettings();
  const office = quoteOrigin(offices);
  const target = { lat, lng };
  if (office && hasCoords(office)) await route(office, target);
  const est = await estimate(offices, { ...target, travelMiles: row.travelMiles, travelMin: row.travelMin });
  return {
    ok: true,
    lat,
    lng,
    precision,
    status,
    miles: est.miles,
    minutes: est.minutes,
    source: est.source,
    officeName: office && hasCoords(office) ? office.name || "the quote origin" : null,
  };
}
