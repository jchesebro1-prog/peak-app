/**
 * One-time paced re-check of backfill-derived venue verifications (D724).
 *
 * The backfill (ensureVenueGeoStatus) marks a venue verified from what it
 * already holds — stored coordinates plus a house number in the street line —
 * without asking the geocoder what those coordinates actually are. Those rows
 * are identifiable: verified + source geocode + no geoVerifiedAt
 * (isBackfillVerified). This re-geocodes each one through the venue path's
 * own gates (geocodeVenue: state, city, postal radius) at ≤ 1 request/second:
 *
 *   - the hit passes geocodedStatus (asked AND returned street lead with a
 *     house number) and lands within RECHECK_MAX_DRIFT_MI of the stored point
 *     → confirmed: geoVerifiedAt stamped (no longer backfill-derived);
 *   - anything else (no hit, a gate failure, a town/street-level hit, or a
 *     building hit somewhere else) → downgraded to needs_check, coordinates
 *     untouched (the rep confirms it once with Fix);
 *   - a geocoder outage → left as is for the next run.
 *
 * Never touches a pin or a human verification: the candidate query and every
 * UPDATE are conditioned on the backfill shape. Dry run unless `apply`.
 * Run by scripts/geo-recheck-venues.ts (`npm run geo:recheck-venues`).
 */
import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { sites } from "@/db/schema";
import { haversineMiles, searchOrThrow, type GeoSearchHit } from "@/lib/geo";
import { GEOCODE_DELAY_MS, geocodeVenue, newGeocodeCtx, type GeocodeOutcome } from "@/lib/geo-backfill";
import { nominatimPacer } from "./place-book";
import { geocodedStatus, isValidPoint } from "./state";

/** A fresh building-level hit farther than this from the stored point means
 *  the stored point was never confirmed: needs_check, never guessed. */
export const RECHECK_MAX_DRIFT_MI = 0.5;

export type RecheckRow = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: string | null;
  lng: string | null;
};

export type RecheckDeps = {
  /** geocodeVenue's outcome, or "outage" when Nominatim couldn't be reached. */
  geocode(row: RecheckRow): Promise<GeocodeOutcome | "outage">;
  now(): number;
};

export type RecheckChange = { id: string; address: string; to: "verified" | "needs_check"; reason: string };
export type RecheckReport = {
  apply: boolean;
  candidates: number;
  confirmed: number;
  downgraded: number;
  outage: number;
  /** Rows whose shape changed between the read and the write (a Fix ran meanwhile). */
  raced: number;
  changes: RecheckChange[];
};

/** The pure verdict for one backfill-derived venue. */
export function recheckVerdict(row: RecheckRow, out: GeocodeOutcome): { to: "verified" | "needs_check"; reason: string } {
  if (!out.ok) return { to: "needs_check", reason: out.reason + (out.got ? ` (${out.got})` : "") };
  if (geocodedStatus(row.address, out.hit) !== "verified") return { to: "needs_check", reason: `not building-level (hit "${out.hit.street || "—"}")` };
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!isValidPoint(lat, lng)) return { to: "needs_check", reason: "stored point unusable" };
  const drift = haversineMiles({ lat, lng }, { lat: out.lat, lng: out.lng });
  if (drift == null || !(drift <= RECHECK_MAX_DRIFT_MI)) return { to: "needs_check", reason: `geocoder places it ${(drift ?? NaN).toFixed(1)} mi from the stored point` };
  return { to: "verified", reason: "confirmed" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every Nominatim request through the shared pacer (≤ 1 per GEOCODE_DELAY_MS),
 *  throwing on an outage so the caller can tell it from a real miss. */
async function pacedSearchOrThrow(q: string, opts?: { limit?: number }): Promise<GeoSearchHit[]> {
  const now = Date.now();
  const slot = Math.max(now, nominatimPacer.nextAt);
  nominatimPacer.nextAt = slot + GEOCODE_DELAY_MS;
  if (slot > now) await sleep(slot - now);
  return searchOrThrow(q, opts);
}

function defaultDeps(): RecheckDeps {
  return {
    geocode: async (row) => {
      let outage = false;
      const ctx = {
        ...newGeocodeCtx(GEOCODE_DELAY_MS),
        search: async (q: string, o?: { limit?: number }) => {
          try {
            return await pacedSearchOrThrow(q, o);
          } catch {
            outage = true;
            return [];
          }
        },
      };
      const out = await geocodeVenue(row, ctx);
      return outage ? "outage" : out;
    },
    now: Date.now,
  };
}

/** The backfill shape, as SQL — the candidate filter AND every write's guard. */
function backfillShape(): SQL {
  return and(
    eq(sites.deleted, false),
    eq(sites.geoStatus, "verified"),
    eq(sites.geoSource, "geocode"),
    isNull(sites.geoVerifiedAt)
  ) as SQL;
}

export async function recheckBackfilledVenues(
  opts: { apply: boolean; ids?: string[]; limit?: number; onProgress?: (done: number, total: number) => void },
  deps?: Partial<RecheckDeps>
): Promise<RecheckReport> {
  const d = { ...defaultDeps(), ...deps };
  const db = await getDb();
  const where = opts.ids ? and(backfillShape(), inArray(sites.id, opts.ids.length ? opts.ids : ["\u0000"])) : backfillShape();
  let q = db
    .select({ id: sites.id, address: sites.address, city: sites.city, state: sites.state, zip: sites.zip, lat: sites.lat, lng: sites.lng })
    .from(sites)
    .where(where)
    .orderBy(asc(sites.id))
    .$dynamic();
  if (opts.limit && opts.limit > 0) q = q.limit(Math.floor(opts.limit));
  const rows = await q;
  const report: RecheckReport = { apply: opts.apply, candidates: rows.length, confirmed: 0, downgraded: 0, outage: 0, raced: 0, changes: [] };
  let done = 0;
  for (const row of rows) {
    const out = await d.geocode(row);
    done++;
    if (out === "outage") {
      report.outage++;
      opts.onProgress?.(done, rows.length);
      continue;
    }
    const v = recheckVerdict(row, out);
    if (opts.apply) {
      const set = v.to === "verified" ? { geoVerifiedAt: d.now() } : { geoStatus: "needs_check" as const };
      const wrote = await db
        .update(sites)
        .set(set)
        .where(and(eq(sites.id, row.id), backfillShape()))
        .returning({ id: sites.id });
      if (!wrote.length) {
        report.raced++;
        opts.onProgress?.(done, rows.length);
        continue;
      }
    }
    if (v.to === "verified") report.confirmed++;
    else report.downgraded++;
    report.changes.push({ id: row.id, address: [row.address, row.city, row.state].filter(Boolean).join(", "), to: v.to, reason: v.reason });
    opts.onProgress?.(done, rows.length);
  }
  return report;
}
