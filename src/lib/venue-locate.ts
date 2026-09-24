/**
 * Unlocated venues — the Settings → Admin worklist and its one-venue fix
 * (punch #169, D225). Spec: docs/superpowers/specs/2026-09-24-geo-fix-sidebar-design.md
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
import { geocodeVenue, newGeocodeCtx, type GeocodeFailure } from "@/lib/geo-backfill";

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
    blank(sites.travelMiles),
    blank(sites.travelMin)
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
    .orderBy(asc(sql`coalesce(${companies.name}, '')`), asc(sites.name), asc(sites.id))
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
      miles: number | null;
      minutes: number | null;
      source: TravelSource;
      officeName: string | null;
    }
  | { ok: false; reason: GeocodeFailure["reason"] | "gone" | "invalid"; got?: string };

const clip = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
const orNull = (s: string) => (s ? s : null);
const validCoord = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

export async function locateVenue(
  input: LocateInput,
  opts?: { delayMs?: number }
): Promise<LocateResult> {
  const db = await getDb();
  const siteId = clip(input?.siteId, 120);
  const [row] = siteId
    ? await db.select().from(sites).where(and(eq(sites.id, siteId), eq(sites.deleted, false))).limit(1)
    : [];
  if (!row) return { ok: false, reason: "gone" };

  let lat: number;
  let lng: number;
  const set: Partial<typeof sites.$inferInsert> = { updatedAt: Date.now() };

  if (input.mode === "retry") {
    const fields = {
      address: clip(input.address),
      city: clip(input.city, 100),
      state: clip(input.state, 40),
      zip: clip(input.zip, 20),
    };
    const out = await geocodeVenue(fields, newGeocodeCtx(opts?.delayMs));
    if (!out.ok) return { ok: false, reason: out.reason, ...(out.got ? { got: out.got } : {}) };
    lat = out.lat;
    lng = out.lng;
    Object.assign(set, {
      address: orNull(fields.address),
      city: orNull(fields.city),
      state: orNull(fields.state),
      zip: orNull(fields.zip),
    });
  } else if (input.mode === "pick" || input.mode === "pin") {
    if (!validCoord(input.lat, input.lng)) return { ok: false, reason: "invalid" };
    lat = input.lat;
    lng = input.lng;
    if (input.mode === "pick")
      Object.assign(set, {
        address: orNull(clip(input.address)),
        city: orNull(clip(input.city, 100)),
        state: orNull(clip(input.state, 40)),
        zip: orNull(clip(input.zip, 20)),
      });
  } else {
    return { ok: false, reason: "invalid" };
  }

  set.lat = String(lat);
  set.lng = String(lng);
  await db.update(sites).set(set).where(and(eq(sites.id, row.id), eq(sites.deleted, false)));

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
    miles: est.miles,
    minutes: est.minutes,
    source: est.source,
    officeName: office && hasCoords(office) ? office.name || "the quote origin" : null,
  };
}
