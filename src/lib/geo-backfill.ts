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
  haversineMiles,
  hasCoords,
  officesFromSettings,
  quoteOrigin,
  route,
  routeCachedBulk,
  routeKey,
  search,
  searchCity,
  stateAbbr,
  type GeoSearchHit,
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
  /** Route-cache keys that failed this batch — pass back as `skipKeys`. */
  failedKeys: string[];
  remaining: number;
  dryRun: boolean;
};

/** A venue is worth geocoding if it has a street address or at least a city. */
function addressableRows(rows: SiteRow[]): SiteRow[] {
  return rows.filter((r) => (r.address || "").trim() || (r.city || "").trim());
}

/**
 * Strip what a mailing address carries that a geocoder cannot use: suite /
 * unit / floor designators and P.O. boxes. Nominatim matches buildings, not
 * suites, and returns NOTHING for "605 Erie Avenue Suite 101" while finding
 * "605 Erie Avenue" — measured against the real book on 2026-09-24, five of
 * eight street-level misses were exactly this. A P.O. box alone is not a
 * place at all, so it cleans to "" and the venue falls to city precision.
 *
 * Designators only match as whole words ("Ste" never eats "Stewart"), and
 * only when followed by a real unit id — one containing a digit, or a single
 * letter ("STE G") — so a street NAMED "Room Rd" or "Floor St" survives.
 * Wisconsin grid addresses ("W185 S8750 Racine Ave.") pass through untouched.
 */
export function cleanStreet(street: string | null | undefined): string {
  return (street || "")
    .replace(/,?\s*\b(p\.?\s*o\.?|post\s+office)\s*box\s*[\w-]*/gi, "")
    .replace(
      /,?\s*\b(suite|ste|apt|apartment|unit|floor|fl|room|rm|bldg)\b\.?\s*#?\s*(?:[\w-]*\d[\w-]*|[a-z])\b/gi,
      ""
    )
    .replace(/,?\s*#\s*[\w-]+/g, "")
    .replace(/[\s,]+$/, "")
    .trim();
}

/** "<street>, <city>, <ST> <zip>" — whatever parts exist, in postal order. */
export function geocodeQuery(row: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const street = cleanStreet(row.address);
  const city = (row.city || "").trim();
  const state = (row.state || "").trim();
  const zip = (row.zip || "").trim();
  const tail = [state, zip].filter(Boolean).join(" ");
  return [street, city, tail].filter(Boolean).join(", ");
}

export function precisionOf(row: { address?: string | null }): GeocodePrecision {
  return cleanStreet(row.address) ? "building" : "city";
}

/**
 * How far a building may sit from its stated town's centre and still count as
 * that town. US mailing cities are postal, not municipal: 8301 Old Sauk Road
 * is mailed as Middleton but OSM files it under Madison, 2 miles from
 * Middleton's centre. The #147 same-name hazard (Portage → Portage County) was
 * 64 miles out, so a 10-mile radius separates the two cleanly.
 */
export const POSTAL_CITY_RADIUS_MI = 10;

/**
 * Is a street-level hit within POSTAL_CITY_RADIUS_MI of the venue's stated
 * town centre? The centre is looked up once per town per run (cached in
 * `centres`), paced like every other Nominatim call, and must itself pass the
 * exact city gate — an unresolvable or mismatched town means "no".
 */
async function nearStatedTown(
  hit: GeoSearchHit,
  row: { city?: string | null; state?: string | null },
  centres: Map<string, GeoSearchHit | null>,
  delayMs: number
): Promise<boolean> {
  const key = `${(row.city || "").trim().toLowerCase()}|${(row.state || "").trim().toLowerCase()}`;
  if (!centres.has(key)) {
    await sleep(delayMs);
    const [c] = await searchCity(row.city, row.state, { limit: 1 });
    centres.set(key, c && samePlace(row.city, c.city) ? c : null);
  }
  const centre = centres.get(key);
  const d = centre ? haversineMiles(hit, centre) : null;
  return d != null && d <= POSTAL_CITY_RADIUS_MI;
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

/** Per-run state for geocodeVenue(): pacing + the stated-town centre cache. */
export type GeocodeCtx = { delayMs: number; townCentres: Map<string, GeoSearchHit | null> };

export function newGeocodeCtx(delayMs: number = GEOCODE_DELAY_MS): GeocodeCtx {
  return { delayMs, townCentres: new Map() };
}

export type GeocodeOutcome =
  | { ok: true; lat: number; lng: number; precision: GeocodePrecision; hit: GeoSearchHit }
  | { ok: false; reason: GeocodeFailure["reason"]; got?: string };

/**
 * Geocode ONE venue's address through exactly the checks the batch applies —
 * query choice, the state gate, the city gate and its postal-city radius.
 * Shared by backfillVenueCoords() and the Settings sidebar's Retry (#175) so
 * the two can never disagree about what a good match is. Writes nothing.
 */
export async function geocodeVenue(
  row: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null },
  ctx: GeocodeCtx
): Promise<GeocodeOutcome> {
  const q = geocodeQuery(row);
  if (!q) return { ok: false, reason: "no-hit" };
  const precision = precisionOf(row);
  // A venue with a street address wants a free-text lookup — that is how you
  // resolve a building. A venue with only a city wants Nominatim's
  // STRUCTURED form, because free text quietly returns the wrong place: the
  // #147 fixture run got "Portage County" (64 mi out) for "Portage, WI" and
  // "Town of Baraboo" (80 mi out) for "LaCrosse, WI". Structured resolves
  // Portage correctly and returns nothing for LaCrosse — a reported miss
  // beats a confident wrong answer that misprices every quote on that venue.
  const hits =
    precision === "building"
      ? await search(q, { limit: 1 })
      : await searchCity(row.city, row.state, { limit: 1 });
  const hit = hits[0];
  if (!hit) return { ok: false, reason: "no-hit" };

  // Sanity gate: a hit in the wrong state is a bad match, and a bad match
  // silently misprices a quote. Rows with no stated state can't be checked.
  const want = stateAbbr(row.state) || (row.state || "").trim().toUpperCase();
  if (want && hit.state && hit.state !== want)
    return { ok: false, reason: "state-mismatch", got: `${hit.city}, ${hit.state}` };

  // Second gate: the right state is not the right place ("Portage" -> Portage
  // County, "LaCrosse" -> Town of Baraboo, both in Wisconsin). Require the
  // resolved city to BE the stated city — except a street-level hit within
  // POSTAL_CITY_RADIUS_MI of the stated town's centre, because a mailing city
  // is postal, not municipal (Old Sauk Rd, Middleton is filed under Madison).
  if (
    (row.city || "").trim() &&
    !samePlace(row.city, hit.city) &&
    !(precision === "building" && (await nearStatedTown(hit, row, ctx.townCentres, ctx.delayMs)))
  )
    return { ok: false, reason: "city-mismatch", got: `${hit.city}, ${hit.state}` };

  return { ok: true, lat: hit.lat, lng: hit.lng, precision, hit };
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
  /**
   * Queries that already failed earlier in this run. A failed venue keeps no
   * coordinates, so it stays a candidate and — without this — sorts back to
   * the head of every batch: once `limit` failures pile up there, a batched
   * caller re-asks the same dead addresses forever and never reaches the
   * rest of the book. That is how prod sat at 3 of 1,480 located.
   */
  skipQueries?: readonly string[];
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

  const skip = new Set(opts?.skipQueries ?? []);
  const queries = [...byQuery.keys()].filter((q) => !skip.has(q));
  const budget = opts?.limit ?? queries.length;
  // Stated-town centres, looked up only when a building's city disagrees.
  const ctx: GeocodeCtx = { delayMs, townCentres: new Map() };
  const toRun = queries.slice(0, budget);
  report.remaining = queries.length - toRun.length;

  let done = 0;
  for (const q of toRun) {
    const rows = byQuery.get(q)!;
    if (done > 0) await sleep(delayMs);
    report.queriesIssued++;
    const out = await geocodeVenue(rows[0], ctx);
    done++;
    opts?.onProgress?.(done, toRun.length);

    if (!out.ok) {
      for (const r of rows)
        report.failures.push({
          siteId: r.id,
          companyId: r.companyId,
          query: q,
          reason: out.reason,
          ...(out.got ? { got: out.got } : {}),
        });
      continue;
    }

    for (const r of rows) {
      if (!dryRun) {
        await db
          .update(sites)
          .set({ lat: String(out.lat), lng: String(out.lng), updatedAt: Date.now() })
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
  /** Keys that already failed this run — same head-of-queue hazard as
   *  backfillVenueCoords' `skipQueries`. */
  skipKeys?: readonly string[];
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
    failedKeys: [],
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

  const report: WarmReport = { ...empty, failedKeys: [], officeName: office.name || "(unnamed office)" };
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

  // One cache query for every pair, not one per venue — a batched caller
  // repeats this read every 10 routes, and ~1,250 round-trips per batch is
  // what would push the Settings runner past its server-action timeout.
  const skip = new Set(opts?.skipKeys ?? []);
  const cached = await routeCachedBulk([...pairs.keys()]);
  const todo: Array<{ lat: string; lng: string }> = [];
  for (const [key, target] of pairs) {
    if (skip.has(key)) continue;
    if (cached.has(key)) report.alreadyCached++;
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
    else {
      report.failed++;
      report.failedKeys.push(routeKey(office, target));
    }
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
