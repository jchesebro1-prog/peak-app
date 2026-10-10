/**
 * Place book (spec 2026-10-09) — every non-venue address, one row per EXACT
 * normalized key. Resolution order for free text: book (exact key) →
 * geocoder; every answer is written back with its status so the worklist can
 * show it; a geocoder OUTAGE writes nothing (the next live pass retries).
 * Geocode writes never overwrite a pin; a Fix (retry/pick/pin) is deliberate
 * and may.
 *
 * Status from a geocoder hit is judged on the street the geocoder RETURNED
 * (state.ts statusOfFreeTextHit: a real house number, not a numbered road) —
 * never on the typed text alone. A hand-dropped pin is the only path that
 * verifies without a house-numbered hit.
 */
import { inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { placeBook, type PlaceBookRow } from "@/db/schema";
import { FETCH_TIMEOUT_MS, searchOrThrow, type GeoSearchHit } from "@/lib/geo";
import { addressKey } from "./keys";
import { isGeoStatus, isValidPoint, placeAddressState, placeRowFromHit, statusOfFreeTextHit } from "./state";
import type { AddressState, GeoStatus, PlaceRow } from "./types";

/** Nominatim asks for <= 1 request/second. */
export const PLACE_DELAY_MS = 1100;

export type PlaceDeps = {
  search: (q: string) => Promise<GeoSearchHit[]>;
  delayMs: number;
  budgetMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

function defaultDeps(): PlaceDeps {
  return {
    search: (q) => searchOrThrow(q, { limit: 1 }),
    delayMs: PLACE_DELAY_MS,
    budgetMs: 20_000,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function toRow(r: PlaceBookRow): PlaceRow {
  return {
    key: r.key,
    label: r.label,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    status: isGeoStatus(r.status) ? r.status : "unresolved",
    source: r.source === "pin" ? "pin" : "geocode",
    verifiedBy: r.verifiedBy ?? null,
    verifiedAt: r.verifiedAt ?? null,
    updatedAt: r.updatedAt,
  };
}

export async function getPlaces(keys: string[]): Promise<Map<string, PlaceRow>> {
  const out = new Map<string, PlaceRow>();
  const uniq = [...new Set(keys.filter(Boolean))];
  if (!uniq.length) return out;
  const db = await getDb();
  for (let i = 0; i < uniq.length; i += 500) {
    const rows = await db.select().from(placeBook).where(inArray(placeBook.key, uniq.slice(i, i + 500)));
    for (const r of rows) out.set(r.key, toRow(r));
  }
  return out;
}

/** Upsert one row. The label is the text as FIRST seen — never replaced. */
export async function writePlace(row: PlaceRow, opts: { overwritePin: boolean }): Promise<void> {
  const db = await getDb();
  const set = {
    lat: row.lat,
    lng: row.lng,
    status: row.status,
    source: row.source,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    updatedAt: row.updatedAt,
  };
  await db
    .insert(placeBook)
    .values({ key: row.key, label: row.label, ...set })
    .onConflictDoUpdate({
      target: placeBook.key,
      set,
      ...(opts.overwritePin ? {} : { setWhere: sql`${placeBook.source} <> 'pin'` }),
    });
}

/**
 * Address states for free texts, keyed by addressKey(text). "cache" reads
 * the book only (page views); "live" geocodes unknown keys serially, paced
 * and budgeted (syncs, booking checks).
 */
export async function placeStatesFor(
  texts: string[],
  mode: "cache" | "live",
  deps?: Partial<PlaceDeps>
): Promise<Map<string, AddressState>> {
  const d = { ...defaultDeps(), ...deps };
  const byKey = new Map<string, string>();
  for (const raw of texts) {
    const label = String(raw ?? "").trim().slice(0, 300);
    const k = addressKey(label);
    if (k && !byKey.has(k)) byKey.set(k, label);
  }
  const known = await getPlaces([...byKey.keys()]);
  if (mode === "live") {
    const start = d.now();
    let n = 0;
    for (const [key, label] of byKey) {
      if (known.has(key)) continue;
      if (n > 0 && d.now() - start + d.delayMs + FETCH_TIMEOUT_MS > d.budgetMs) break;
      if (n > 0) await d.sleep(d.delayMs);
      n++;
      let hits: GeoSearchHit[];
      try {
        hits = await d.search(label);
      } catch {
        continue; // outage: write nothing, the next live pass retries
      }
      // placeRowFromHit drops a hit with unusable coordinates (stored unresolved, never verified).
      const row = placeRowFromHit(key, label, hits[0], d.now());
      await writePlace(row, { overwritePin: false });
      // Re-read: a pin dropped meanwhile wins over this geocode.
      known.set(key, (await getPlaces([key])).get(key) ?? row);
    }
  }
  const out = new Map<string, AddressState>();
  for (const [key, label] of byKey) out.set(key, placeAddressState(label, known.get(key)));
  return out;
}

export type PlaceFixInput =
  | { key: string; label: string; mode: "retry"; text: string }
  | { key: string; label: string; mode: "pick"; street: string; lat: number; lng: number }
  | { key: string; label: string; mode: "pin"; lat: number; lng: number };

export type FixResult =
  | { ok: true; status: GeoStatus; lat: number; lng: number }
  | { ok: false; reason: "no-hit" | "unavailable" | "invalid" };

/** A Fix on a place-book entry. Always written under the ORIGINAL key, so
 *  the record's own text never flags again (spec "Fixing an address"). */
export async function fixPlace(input: PlaceFixInput, by: string, deps?: Partial<PlaceDeps>): Promise<FixResult> {
  const d = { ...defaultDeps(), ...deps };
  const key = String(input.key ?? "");
  if (!key || addressKey(key) !== key) return { ok: false, reason: "invalid" };
  const label = String(input.label ?? "").trim().slice(0, 300) || key;
  const now = d.now();
  let lat: number;
  let lng: number;
  let status: GeoStatus;
  let source: "geocode" | "pin" = "geocode";
  if (input.mode === "retry") {
    const text = String(input.text ?? "").trim().slice(0, 300);
    if (text.length < 3) return { ok: false, reason: "invalid" };
    let hits: GeoSearchHit[];
    try {
      hits = await d.search(text);
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    // No hit, or a hit with no usable point, is a real "no match".
    if (!hits[0] || !isValidPoint(hits[0].lat, hits[0].lng)) return { ok: false, reason: "no-hit" };
    lat = hits[0].lat;
    lng = hits[0].lng;
    // Judged on the street the geocoder returned, not the typed text.
    status = statusOfFreeTextHit(hits[0]);
  } else if (input.mode === "pick" || input.mode === "pin") {
    if (!isValidPoint(input.lat, input.lng)) return { ok: false, reason: "invalid" };
    lat = input.lat;
    lng = input.lng;
    if (input.mode === "pin") {
      status = "verified";
      source = "pin";
    } else {
      // The picked suggestion's own street decides.
      status = statusOfFreeTextHit({ street: String(input.street ?? "") });
    }
  } else {
    return { ok: false, reason: "invalid" };
  }
  await writePlace(
    {
      key,
      label,
      lat,
      lng,
      status,
      source,
      verifiedBy: status === "verified" ? by : null,
      verifiedAt: status === "verified" ? now : null,
      updatedAt: now,
    },
    { overwritePin: true }
  );
  return { ok: true, status, lat, lng };
}
