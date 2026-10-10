/**
 * Place book (spec 2026-10-09) — every non-venue address, one row per EXACT
 * normalized key. Resolution order for free text: book (exact key) →
 * geocoder; every answer is written back with its status so the worklist can
 * show it; a geocoder OUTAGE writes nothing (the next live pass retries).
 * Geocode writes never overwrite a pin; a Fix (retry/pick/pin) is deliberate
 * and may.
 *
 * Status from a geocoder hit is judged on BOTH the typed text's street part
 * and the street the geocoder RETURNED (state.ts statusOfFreeTextHit: each
 * must lead with a real house number, not a numbered road). A name
 * ("Starbucks") is needs_check whatever the hit. A hand-dropped pin is the
 * only path that verifies without that.
 *
 * Every live Nominatim request here (live passes and Fix retries) takes a
 * turn on one module-level pacer (nominatimPacer), so concurrent syncs,
 * booking checks and Fix dialogs in one instance stay at ≤ 1 request per
 * PLACE_DELAY_MS combined; each call keeps its own budget.
 */
import { inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { placeBook, type PlaceBookRow } from "@/db/schema";
import { FETCH_TIMEOUT_MS, searchOrThrow, type GeoSearchHit } from "@/lib/geo";
import { addressKey } from "./keys";
import { NOMINATIM_DELAY_MS, nominatimPacer } from "./nominatim-pacer";
import { isGeoStatus, isValidPoint, placeAddressState, placeRowFromHit, statusOfFreeTextHit, statusOfPickedStreet } from "./state";
import type { AddressState, GeoStatus, PlaceRow } from "./types";

/** Nominatim asks for <= 1 request/second. */
export const PLACE_DELAY_MS = NOMINATIM_DELAY_MS;

/** The instance-wide Nominatim turn queue (./nominatim-pacer), shared by
 *  every live place-book pass and Fix retry, the venue Fix retry, the
 *  Settings type-ahead and the venue re-check. */
export { nominatimPacer };

export type PlaceDeps = {
  search: (q: string) => Promise<GeoSearchHit[]>;
  delayMs: number;
  budgetMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** When the next request may go out (the module default is shared; tests inject their own). */
  pacer: { nextAt: number };
};

function defaultDeps(): PlaceDeps {
  return {
    search: (q) => searchOrThrow(q, { limit: 1 }),
    delayMs: PLACE_DELAY_MS,
    budgetMs: 20_000,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    pacer: nominatimPacer,
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

/** The label as stored: the text as first seen, capped at 300 characters. */
export function storedLabel(text: string): string {
  return String(text ?? "").trim().slice(0, 300);
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
  return (await placeStatesWithRows(texts, mode, deps)).states;
}

/** placeStatesFor plus the place-book rows it read (keyed by addressKey), so
 *  a caller that also needs "was this ever looked up?" reads the book once. */
export async function placeStatesWithRows(
  texts: string[],
  mode: "cache" | "live",
  deps?: Partial<PlaceDeps>
): Promise<{ states: Map<string, AddressState>; rows: Map<string, PlaceRow> }> {
  const d = { ...defaultDeps(), ...deps };
  // Keyed on the FULL text — the same key every reader computes
  // (addressKey(e.location), addressKey(v.address)); only the stored label
  // is truncated (storedLabel).
  const byKey = new Map<string, string>();
  for (const raw of texts) {
    const text = String(raw ?? "").trim();
    const k = addressKey(text);
    if (k && !byKey.has(k)) byKey.set(k, text);
  }
  const known = await getPlaces([...byKey.keys()]);
  if (mode === "live") {
    const start = d.now();
    let n = 0;
    for (const [key, label] of byKey) {
      if (known.has(key)) continue;
      // Take the next shared turn — synchronously, so two passes can't take
      // the same one — unless it would land past this call's own budget.
      const now = d.now();
      const slot = Math.max(now, d.pacer.nextAt);
      if ((n > 0 || slot > now) && slot - start + FETCH_TIMEOUT_MS > d.budgetMs) break;
      d.pacer.nextAt = slot + d.delayMs;
      if (slot > now) await d.sleep(slot - now);
      n++;
      let hits: GeoSearchHit[];
      try {
        hits = await d.search(label);
      } catch {
        continue; // outage: write nothing, the next live pass retries
      }
      // placeRowFromHit drops a hit with unusable coordinates (stored unresolved, never verified).
      const row = placeRowFromHit(key, storedLabel(label), hits[0], d.now());
      await writePlace(row, { overwritePin: false });
      // Re-read: a pin dropped meanwhile wins over this geocode.
      known.set(key, (await getPlaces([key])).get(key) ?? row);
    }
  }
  const out = new Map<string, AddressState>();
  for (const [key, label] of byKey) out.set(key, placeAddressState(label, known.get(key)));
  return { states: out, rows: known };
}

export type PlaceFixInput =
  | { key: string; label: string; mode: "retry"; text: string }
  | { key: string; label: string; mode: "pick"; street: string; lat: number; lng: number }
  | { key: string; label: string; mode: "pin"; lat: number; lng: number };

export type FixResult =
  | { ok: true; status: GeoStatus; lat: number; lng: number }
  | { ok: false; reason: "no-hit" | "unavailable" | "invalid" | "kept-pin" };

/** A Fix on a place-book entry. Always written under the ORIGINAL key, so
 *  the record's own text never flags again (spec "Fixing an address").
 *  A Retry or Pick weaker than verified never replaces a verified hand pin
 *  ("kept-pin"); a new pin, or a Retry/Pick that verifies, does. */
export async function fixPlace(input: PlaceFixInput, by: string, deps?: Partial<PlaceDeps>): Promise<FixResult> {
  const d = { ...defaultDeps(), ...deps };
  const key = String(input.key ?? "");
  if (!key || addressKey(key) !== key) return { ok: false, reason: "invalid" };
  // The label must be the key's own text (like loadFixTarget), so a fix is
  // never written under one record's key with another record's text. Checked
  // on the UNTRUNCATED label — a >300-char location keys on its full text —
  // and truncated only for storage.
  const fullLabel = String(input.label ?? "").trim();
  if (addressKey(fullLabel || key) !== key) return { ok: false, reason: "invalid" };
  const label = storedLabel(fullLabel) || key;
  const now = d.now();
  let lat: number;
  let lng: number;
  let status: GeoStatus;
  let source: "geocode" | "pin" = "geocode";
  if (input.mode === "retry") {
    const text = String(input.text ?? "").trim().slice(0, 300);
    if (text.length < 3) return { ok: false, reason: "invalid" };
    // Take a turn on the shared pacer; a queue longer than this call's
    // budget answers "unavailable" (try again) instead of hanging the dialog.
    const asked = d.now();
    const slot = Math.max(asked, d.pacer.nextAt);
    if (slot - asked + FETCH_TIMEOUT_MS > d.budgetMs) return { ok: false, reason: "unavailable" };
    d.pacer.nextAt = slot + d.delayMs;
    if (slot > asked) await d.sleep(slot - asked);
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
    // Judged on the retyped text's street AND the street the geocoder returned.
    status = statusOfFreeTextHit(text, hits[0]);
  } else if (input.mode === "pick" || input.mode === "pin") {
    if (!isValidPoint(input.lat, input.lng)) return { ok: false, reason: "invalid" };
    lat = input.lat;
    lng = input.lng;
    if (input.mode === "pin") {
      status = "verified";
      source = "pin";
    } else {
      // The picked suggestion's own street decides: the human chose that
      // exact suggestion, so it is both the asked and the returned street.
      status = statusOfPickedStreet(String(input.street ?? ""));
    }
  } else {
    return { ok: false, reason: "invalid" };
  }
  // Only something that verifies may replace a hand pin. Checked up front
  // for the result, and enforced again by the write's own source guard so a
  // pin dropped while a Retry was in flight survives too.
  const mayReplacePin = source === "pin" || status === "verified";
  if (!mayReplacePin) {
    const existing = (await getPlaces([key])).get(key);
    if (existing?.source === "pin" && existing.status === "verified") return { ok: false, reason: "kept-pin" };
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
    { overwritePin: mayReplacePin }
  );
  return { ok: true, status, lat, lng };
}
