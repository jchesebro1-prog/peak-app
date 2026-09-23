/**
 * Geo backfill — give stored venues coordinates, then real driving routes.
 *
 * Why this exists (punch #147, D183/D184): `estimate()` resolves travel as
 * manual override → cached OSRM route → haversine-from-office → none. Every
 * tier but the manual override needs lat/lng ON THE VENUE. The Daylite import
 * could not supply any (the export carried City + State/Province and nothing
 * else), and the Import hub accepts address columns but has never geocoded,
 * so most of the book has no coordinates and therefore no travel time — which
 * is priced into quotes.
 *
 * Two bounded, resumable phases:
 *
 *   1. backfillVenueCoords() — geocode each venue that has an address (or at
 *      least a city) and stamp lat/lng.
 *   2. warmRoutes()          — fetch the real OSRM route from the quote origin
 *      to each venue, which populates `geo_cache`. WITHOUT this phase travel
 *      stays on the haversine tier (`source: "auto"`): correct coordinates,
 *      still-estimated miles. With it, travel reads `source: "routed"`.
 *
 * Both are idempotent — work already done is skipped — so a crashed or
 * interrupted run resumes by simply being run again. Both take a `limit` so a
 * server action can process a batch inside its timeout and report the
 * remainder, and both serialize their network calls: Nominatim's usage policy
 * is 1 request/second, and the public OSRM instance deserves the same
 * courtesy. Queries are deduplicated first, which matters a great deal —
 * hundreds of venues sharing "Madison, WI" collapse to one lookup.
 *
 * PRECISION IS REPORTED, NOT ASSUMED. A venue with a street address geocodes
 * to a building; one with only a city geocodes to the town centre. Both get
 * coordinates and both produce a travel number, but only the first is good
 * enough to price a quote from. The reports count them separately so the
 * difference is never invisible.
 */
import { and, eq, isNull, isNotNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { sites, type SiteRow } from "@/db/schema";
import {
  hasCoords,
  officesFromSettings,
  quoteOrigin,
  route,
  routeCached,
  routeKey,
  search,
  searchCity,
  stateAbbr,
} from "@/lib/geo";
import type { Office } from "@/lib/settings";

/** Nominatim asks for <= 1 request/second. 1100ms leaves headroom. */
export const GEOCODE_DELAY_MS = 1100;
/** The public OSRM demo instance is a courtesy service; pace it the same. */
export const ROUTE_DELAY_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type GeocodePrecision = "building" | "city";

export type GeocodeFailure = {
  siteId: string;
  companyId: string;
  query: string;
  reason: "no-hit" | "state-mismatch" | "city-mismatch";
  /** What the geocoder returned, when it returned something we rejected. */
  got?: string;
};

/**
 * Compare place names the way a human would. Lowercase, drop the
 * "City of" / "Town of" / "Village of" prefixes Nominatim sometimes prepends
 * to a perfectly good match, then strip everything that isn't a letter or a
 * digit — so "LaCrosse" == "La Crosse" and "St. Paul" == "St Paul".
 *
 * Deliberately an EXACT comparison after normalizing, never a prefix test:
 * "Portage County" starts with "Portage" and is 64 miles from the City of
 * Portage. That near-miss is the whole reason this gate exists.
 */
export function samePlace(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) =>
    (s || "")
      .trim()
      .toLowerCase()
      .replace(/^(city|town|village|township) of\s+/, "")
      // Expand the abbreviations place names are written with before the
      // punctuation is stripped, or "Mt. Horeb" never equals "Mount Horeb"
      // and "St. Cloud" never equals "Saint Cloud". The #147 run rejected
      // five perfectly good matches on exactly this.
      .replace(/\bmt\.?\s+/g, "mount ")
      .replace(/\bst\.?\s+/g, "saint ")
      .replace(/\bft\.?\s+/g, "fort ")
      .replace(/[^a-z0-9]/g, "");
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && x === y;
}

export type BackfillReport = {
  /** Venues considered: missing coordinates, and carrying something to geocode. */
  candidates: number;
  /** Venues that had no address AND no city — nothing to work with. */
  unaddressable: number;
  /** Distinct geocoder queries actually issued (after dedupe). */
  queriesIssued: number;
  geocoded: number;
  geocodedBuilding: number;
  geocodedCity: number;
  failures: GeocodeFailure[];
  /** True when `limit` cut the run short — call again to continue. */
  remaining: number;
  dryRun: boolean;
};

export type WarmReport = {
  officeName: string | null;
  /** Venues with coordinates, i.e. routable at all. */
  candidates: number;
  /** Distinct office→venue coordinate pairs (after dedupe). */
  distinctPairs: number;
  alreadyCached: number;
  warmed: number;
  failed: number;
  remaining: number;
  dryRun: boolean;
};

/** A venue is worth geocoding if it has a street address or at least a city. */
function addressableRows(rows: SiteRow[]): SiteRow[] {
  return rows.filter((r) => (r.address || "").trim() || (r.city || "").trim());
}

/** "<street>, <city>, <ST> <zip>" — whatever parts exist, in postal order. */
export function geocodeQuery(row: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const street = (row.address || "").trim();
  const city = (row.city || "").trim();
  const state = (row.state || "").trim();
  const zip = (row.zip || "").trim();
  const tail = [state, zip].filter(Boolean).join(" ");
  return [street, city, tail].filter(Boolean).join(", ");
}

export function precisionOf(row: { address?: string | null }): GeocodePrecision {
  return (row.address || "").trim() ? "building" : "city";
}

/**
 * Venues missing coordinates. `lat`/`lng` are text columns whose "absent"
 * spellings include NULL and "" (the doc shape tolerated both), so both count
 * as missing — a venue stored with lat="" is exactly as unroutable as NULL.
 */
async function venuesMissingCoords(): Promise<SiteRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(sites)
    .where(
      and(
        eq(sites.deleted, false),
        or(isNull(sites.lat), eq(sites.lat, ""), isNull(sites.lng), eq(sites.lng, ""))
      )
    );
}

/**
 * Phase 1 — geocode venues that have an address but no coordinates.
 *
 * Writes lat/lng and nothing else, with a targeted UPDATE: a venue that has
 * vanished between the read and the write is a no-op, never an insert.
 * Manual travel overrides are not read and not touched — they outrank
 * coordinates in estimate()'s chain regardless.
 */
export async function backfillVenueCoords(opts?: {
  limit?: number;
  dryRun?: boolean;
  delayMs?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<BackfillReport> {
  const dryRun = opts?.dryRun ?? true;
  const delayMs = opts?.delayMs ?? GEOCODE_DELAY_MS;
  const db = await getDb();

  const missing = await venuesMissingCoords();
  const candidates = addressableRows(missing);
  const report: BackfillReport = {
    candidates: candidates.length,
    unaddressable: missing.length - candidates.length,
    queriesIssued: 0,
    geocoded: 0,
    geocodedBuilding: 0,
    geocodedCity: 0,
    failures: [],
    remaining: 0,
    dryRun,
  };

  // Dedupe: every venue sharing a query string shares its answer. Hundreds of
  // city-only venues in the same town collapse to a single lookup, which is
  // the difference between a half-hour run and a six-minute one.
  const byQuery = new Map<string, SiteRow[]>();
  for (const row of candidates) {
    const q = geocodeQuery(row);
    if (!q) continue;
    const list = byQuery.get(q);
    if (list) list.push(row);
    else byQuery.set(q, [row]);
  }

  const queries = [...byQuery.keys()];
  const budget = opts?.limit ?? queries.length;
  const toRun = queries.slice(0, budget);
  report.remaining = queries.length - toRun.length;

  let done = 0;
  for (const q of toRun) {
    const rows = byQuery.get(q)!;
    if (done > 0) await sleep(delayMs);
    report.queriesIssued++;
    // A venue with a street address wants a free-text lookup — that is how you
    // resolve a building. A venue with only a city wants Nominatim's
    // STRUCTURED form, because free text quietly returns the wrong place: the
    // #147 fixture run got "Portage County" (64 mi out) for "Portage, WI" and
    // "Town of Baraboo" (80 mi out) for "LaCrosse, WI". Structured resolves
    // Portage correctly and returns nothing for LaCrosse — a reported miss
    // beats a confident wrong answer that misprices every quote on that venue.
    const seed = rows[0];
    const hits =
      precisionOf(seed) === "building"
        ? await search(q, { limit: 1 })
        : await searchCity(seed.city, seed.state, { limit: 1 });
    const hit = hits[0];
    done++;
    opts?.onProgress?.(done, toRun.length);

    if (!hit) {
      for (const r of rows)
        report.failures.push({
          siteId: r.id,
          companyId: r.companyId,
          query: q,
          reason: "no-hit",
        });
      continue;
    }

    // Sanity gate: a hit in the wrong state is a bad match, and a bad match
    // silently misprices a quote. Reject loudly instead of storing it. Rows
    // with no stated state can't be checked, so they pass.
    const want = stateAbbr(rows[0].state) || (rows[0].state || "").trim().toUpperCase();
    if (want && hit.state && hit.state !== want) {
      for (const r of rows)
        report.failures.push({
          siteId: r.id,
          companyId: r.companyId,
          query: q,
          reason: "state-mismatch",
          got: `${hit.city}, ${hit.state}`,
        });
      continue;
    }

    // Second gate: the right state is not the right place. Both of the bad
    // matches in the #147 fixture run were in Wisconsin and sailed through the
    // state check — "Portage" -> Portage County, "LaCrosse" -> Town of
    // Baraboo. Require the resolved city to BE the stated city. A venue whose
    // stated city is blank has nothing to check against and passes.
    if ((seed.city || "").trim() && !samePlace(seed.city, hit.city)) {
      for (const r of rows)
        report.failures.push({
          siteId: r.id,
          companyId: r.companyId,
          query: q,
          reason: "city-mismatch",
          got: `${hit.city}, ${hit.state}`,
        });
      continue;
    }

    for (const r of rows) {
      if (!dryRun) {
        await db
          .update(sites)
          .set({ lat: String(hit.lat), lng: String(hit.lng), updatedAt: Date.now() })
          .where(eq(sites.id, r.id));
      }
      report.geocoded++;
      if (precisionOf(r) === "building") report.geocodedBuilding++;
      else report.geocodedCity++;
    }
  }

  return report;
}

/**
 * Phase 2 — fetch the real driving route from the quote origin to each venue,
 * which is what populates `geo_cache` and lifts travel off the haversine tier.
 *
 * Returns early with `officeName: null` when Settings → Locations has no
 * office carrying coordinates: quoteOrigin() would return nothing, every
 * lookup would be a no-op, and an hour would be spent achieving that.
 */
export async function warmRoutes(opts?: {
  limit?: number;
  dryRun?: boolean;
  delayMs?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<WarmReport> {
  const dryRun = opts?.dryRun ?? true;
  const delayMs = opts?.delayMs ?? ROUTE_DELAY_MS;

  const offices = await officesFromSettings();
  const office: Office | null = quoteOrigin(offices);
  const empty: WarmReport = {
    officeName: null,
    candidates: 0,
    distinctPairs: 0,
    alreadyCached: 0,
    warmed: 0,
    failed: 0,
    remaining: 0,
    dryRun,
  };
  if (!office || !hasCoords(office)) return empty;

  const db = await getDb();
  const rows = await db
    .select()
    .from(sites)
    .where(
      and(
        eq(sites.deleted, false),
        isNotNull(sites.lat),
        ne(sites.lat, ""),
        isNotNull(sites.lng),
        ne(sites.lng, "")
      )
    );

  const report: WarmReport = { ...empty, officeName: office.name || "(unnamed office)" };
  report.candidates = rows.length;

  // Venues rounding to the same coordinate pair share one route — the cache
  // is keyed on 4dp, so re-fetching them would be re-fetching the same key.
  const pairs = new Map<string, { lat: string; lng: string }>();
  for (const r of rows) {
    if (!hasCoords(r)) continue;
    const key = routeKey(office, { lat: r.lat!, lng: r.lng! });
    if (!pairs.has(key)) pairs.set(key, { lat: r.lat!, lng: r.lng! });
  }
  report.distinctPairs = pairs.size;

  const todo: Array<{ lat: string; lng: string }> = [];
  for (const target of pairs.values()) {
    if (await routeCached(office, target)) report.alreadyCached++;
    else todo.push(target);
  }

  const budget = opts?.limit ?? todo.length;
  const slice = todo.slice(0, budget);
  report.remaining = todo.length - slice.length;

  let done = 0;
  for (const target of slice) {
    if (done > 0) await sleep(delayMs);
    done++;
    opts?.onProgress?.(done, slice.length);
    if (dryRun) continue;
    // route() writes through to geo_cache on success and fails soft to null.
    const r = await route(office, target);
    if (r) report.warmed++;
    else report.failed++;
  }
  if (dryRun) report.warmed = slice.length; // what a commit run would attempt

  return report;
}

/**
 * How the book currently looks: how many venues can produce a travel number at
 * all, and how many of those are good enough to price from. Read-only; used by
 * the CLI's status output and worth surfacing in the admin UI.
 */
export async function travelCoverage(): Promise<{
  venues: number;
  withCoords: number;
  withStreetAddress: number;
  cityOnly: number;
  noAddress: number;
  manualOverride: number;
}> {
  const db = await getDb();
  const rows = await db.select().from(sites).where(eq(sites.deleted, false));
  const has = (v: string | null) => !!(v || "").trim();
  return {
    venues: rows.length,
    withCoords: rows.filter((r) => has(r.lat) && has(r.lng)).length,
    withStreetAddress: rows.filter((r) => has(r.address)).length,
    cityOnly: rows.filter((r) => !has(r.address) && has(r.city)).length,
    noAddress: rows.filter((r) => !has(r.address) && !has(r.city)).length,
    manualOverride: rows.filter((r) => has(r.travelMiles) || has(r.travelMin)).length,
  };
}

/** Kept so a future caller can count rows without pulling them all. */
export async function venueCount(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sites)
    .where(eq(sites.deleted, false));
  return row?.n ?? 0;
}
