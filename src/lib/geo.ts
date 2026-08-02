import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { geoCache } from "@/db/schema";
import { getSettings, type Office } from "@/lib/settings";
import {
  TRAVEL_RATE_DEFAULTS,
  getTravelRates,
  type TravelRates,
} from "@/lib/stores/pricing";

/**
 * Geo — shared travel / distance estimation. Server port of app/geo.js
 * (window.Geo). Two tiers, same as the prototype:
 *
 * 1) LIVE: Nominatim geocodes a typed address -> precise coords; OSRM
 *    computes real driving distance + time. Both keyless/free. Results are
 *    cached — the prototype's localStorage route cache (rss_geo_routecache_v1)
 *    becomes the `geo_cache` table, same key scheme, so a routed number is
 *    available to estimate() once it's been fetched at least once.
 * 2) FALLBACK: a tiny built-in geocoder for the cities the app ships with,
 *    plus a straight-line (haversine) estimate x roadFactor -> minutes at
 *    mph. Those two knobs now live in Estimating Rules -> "Travel & mileage"
 *    (blob `travel_rates`, src/lib/stores/pricing.ts, TRAVEL_RATE_DEFAULTS);
 *    driveMiles()/driveMinutes()/minutesFromMiles() stay pure/synchronous
 *    and take an explicit `travel` param (defaulting to TRAVEL_RATE_DEFAULTS)
 *    so every existing caller keeps working unchanged, same pattern as
 *    flametest-engine.ts. estimate() reads the live values via
 *    getTravelRates() since it's already async/DB-backed.
 *
 * Priority in estimate(): manual override > cached live route > haversine
 * fallback > none — identical chain and math to the prototype (only the
 * roadFactor/mph knobs feeding the haversine tier are now live); estimate()
 * is async here only because the route cache lives in Postgres.
 *
 * Live fetches (search/route) use a 5s timeout and fail soft (null / [])
 * so callers always fall back to the offline tier.
 */

/* ---------------- types ---------------- */

export type LatLng = { lat: number; lng: number };

/** Loose lat/lng holder — the prototype tolerated '', null and strings. */
export type GeoPointLike = {
  lat?: number | string | null;
  lng?: number | string | null;
};

export type PlaceLike = GeoPointLike & {
  city?: string | null;
  state?: string | null;
};

/** estimate() target — a venue/location, possibly with manual overrides. */
export type EstimateTarget = PlaceLike & {
  travelMiles?: number | string | null;
  travelMin?: number | string | null;
};

export type RouteResult = { miles: number; minutes: number };

export type TravelSource = "manual" | "routed" | "auto" | "none";

export type TravelEstimate<T = GeoPointLike> = {
  miles: number | null;
  minutes: number | null;
  office: T | null;
  source: TravelSource;
};

/** Normalized Nominatim suggestion (prototype's normalizeHit shape). */
export type GeoSearchHit = {
  title: string;
  sub: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  display: string;
};

/* ---------------- constants + pure math ---------------- */

const FETCH_TIMEOUT_MS = 5000;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle miles between two {lat,lng}; null if either is missing coords. */
export function haversineMiles(
  a: GeoPointLike | null | undefined,
  b: GeoPointLike | null | undefined
): number | null {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null)
    return null;
  const R = 3958.8;
  const aLat = Number(a.lat);
  const aLng = Number(a.lng);
  const bLat = Number(b.lat);
  const bLng = Number(b.lng);
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Straight-line -> on-road distance, using the live (or default) road factor. */
export function driveMiles(
  a: GeoPointLike | null | undefined,
  b: GeoPointLike | null | undefined,
  travel: TravelRates = TRAVEL_RATE_DEFAULTS
): number | null {
  const m = haversineMiles(a, b);
  return m == null ? null : Math.round(m * travel.roadFactor);
}

/** Road minutes from the live (or default) assumed average speed. */
export function driveMinutes(
  a: GeoPointLike | null | undefined,
  b: GeoPointLike | null | undefined,
  travel: TravelRates = TRAVEL_RATE_DEFAULTS
): number | null {
  const mi = driveMiles(a, b, travel);
  return mi == null ? null : Math.round((mi / travel.mph) * 60);
}

export function minutesFromMiles(
  mi: number | null | undefined,
  travel: TravelRates = TRAVEL_RATE_DEFAULTS
): number | null {
  return mi == null || isNaN(mi) ? null : Math.round((mi / travel.mph) * 60);
}

export function fmtMiles(mi: number | null | undefined): string {
  return mi == null ? "—" : Math.round(mi).toLocaleString("en-US") + " mi";
}

export function fmtTime(min: number | null | undefined): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return m + "m";
  return m ? h + "h " + m + "m" : h + "h";
}

/** Prototype checked navigator.onLine; on the server this is always true. */
export function online(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/** Nearest origin (by straight-line) from a list of offices to a target. */
export function nearest<T extends GeoPointLike>(
  offices: readonly T[] | null | undefined,
  target: GeoPointLike | null | undefined
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  (offices || []).forEach((o) => {
    const d = haversineMiles(o, target);
    if (d != null && d < bestD) {
      bestD = d;
      best = o;
    }
  });
  return best;
}

/** Travel origins — the prototype read window.AppSettings.offices(). */
export async function officesFromSettings(): Promise<Office[]> {
  const s = await getSettings();
  return Array.isArray(s.offices) ? s.offices : [];
}

/* ---------------- live route cache (OSRM) ----------------
   Keyed by a rounded office|target coord pair so the same trip isn't
   re-fetched. Prototype: localStorage rss_geo_routecache_v1 (pruned to 400
   entries); here: the geo_cache table, same keys, same {miles,minutes,ts}
   value — no pruning needed at this scale. Reads/writes fail soft so a DB
   hiccup degrades to the haversine tier, never throws. */

function r4(n: number | string): string {
  return (Math.round(Number(n) * 1e4) / 1e4).toFixed(4);
}

function routeKey(
  a: { lat: number | string; lng: number | string },
  b: { lat: number | string; lng: number | string }
): string {
  return r4(a.lat) + "," + r4(a.lng) + "|" + r4(b.lat) + "," + r4(b.lng);
}

function hasCoords(
  p: GeoPointLike | null | undefined
): p is { lat: number | string; lng: number | string } {
  return !!p && p.lat != null && p.lng != null && p.lat !== "" && p.lng !== "";
}

async function cachePut(
  key: string,
  data: { miles: number; minutes: number; ts: number }
): Promise<void> {
  try {
    const db = await getDb();
    await db
      .insert(geoCache)
      .values({ key, data, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: geoCache.key,
        set: { data, updatedAt: Date.now() },
      });
  } catch {
    // cache is best-effort (prototype's saveCache swallowed quota errors)
  }
}

/** A previously-cached real route {miles, minutes}, or null. */
export async function routeCached(
  a: GeoPointLike | null | undefined,
  b: GeoPointLike | null | undefined
): Promise<RouteResult | null> {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(geoCache)
      .where(eq(geoCache.key, routeKey(a, b)))
      .limit(1);
    const hit = rows[0]?.data as { miles: number; minutes: number } | undefined;
    return hit ? { miles: hit.miles, minutes: hit.minutes } : null;
  } catch {
    return null;
  }
}

/**
 * Real driving route via OSRM (one-way). Caches + returns {miles, minutes};
 * null on failure/timeout so callers can fall back to the haversine estimate.
 */
export async function route(
  a: GeoPointLike | null | undefined,
  b: GeoPointLike | null | undefined
): Promise<RouteResult | null> {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  const cached = await routeCached(a, b);
  if (cached) return cached;
  if (!online()) return null;
  try {
    const url =
      "https://router.project-osrm.org/route/v1/driving/" +
      Number(a.lng) + "," + Number(a.lat) + ";" +
      Number(b.lng) + "," + Number(b.lat) + "?overview=false";
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const j = (await res.json()) as
      | { routes?: Array<{ distance: number; duration: number }> }
      | null;
    const rt = j && j.routes && j.routes[0];
    if (!rt) return null;
    const out = {
      miles: Math.round(rt.distance / 1609.34),
      minutes: Math.round(rt.duration / 60),
    };
    await cachePut(routeKey(a, b), { miles: out.miles, minutes: out.minutes, ts: Date.now() });
    return out;
  } catch {
    return null;
  }
}

/** Round-trip (to venue and back) from the cached route — pricing wants both legs. */
export async function roundTrip(
  a: GeoPointLike | null | undefined,
  b: GeoPointLike | null | undefined
): Promise<RouteResult | null> {
  const r = await routeCached(a, b);
  return r ? { miles: r.miles * 2, minutes: r.minutes * 2 } : null;
}

/* ---------------- address search (Nominatim) ---------------- */

const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

export function stateAbbr(name: string | null | undefined): string {
  if (!name) return "";
  const k = String(name).trim().toLowerCase();
  if (STATE_ABBR[k]) return STATE_ABBR[k];
  return name.length === 2 ? name.toUpperCase() : "";
}

type NominatimAddress = {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  suburb?: string;
  county?: string;
  state?: string;
  postcode?: string;
};

type NominatimHit = {
  lat?: string | number | null;
  lon?: string | number | null;
  name?: string;
  category?: string;
  display_name?: string;
  address?: NominatimAddress;
};

function normalizeHit(h: NominatimHit | null | undefined): GeoSearchHit | null {
  if (!h || h.lat == null || h.lon == null) return null;
  const a = h.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ").trim();
  const city =
    a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || "";
  const state = stateAbbr(a.state);
  const zip = a.postcode || "";
  // A short human title: prefer a named place (venue/POI) or the street; else the city.
  const named =
    h.category && h.category !== "boundary" && h.category !== "place" ? h.name || "" : "";
  const title = named || street || city || (h.display_name || "").split(",")[0];
  const sub = h.display_name || [street, city, state, zip].filter(Boolean).join(", ");
  return {
    title,
    sub,
    name: h.name || "",
    street,
    city,
    state,
    zip,
    lat: Number(h.lat),
    lng: Number(h.lon),
    display: h.display_name || "",
  };
}

/**
 * Search an address string -> up to `limit` normalized suggestions.
 * Empty array on short query / failure / timeout (fail soft).
 */
export async function search(
  query: string | null | undefined,
  opts?: { limit?: number }
): Promise<GeoSearchHit[]> {
  const q = (query || "").trim();
  if (q.length < 3) return [];
  if (!online()) return [];
  const limit = (opts && opts.limit) || 5;
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=" +
      limit + "&q=" + encodeURIComponent(q);
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        // Nominatim usage policy asks server clients to identify themselves.
        "User-Agent": "peak-app/1.0 (Peak Systems Group travel estimates)",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as NominatimHit[] | null;
    return (j || []).map(normalizeHit).filter((x): x is GeoSearchHit => !!x);
  } catch {
    return [];
  }
}

/* ---------------- estimate ---------------- */

/**
 * Full travel estimate from a set of offices to a target location.
 * Honors manual overrides (target.travelMiles / target.travelMin), then a
 * cached REAL route (OSRM), then the haversine fallback — the prototype's
 * exact priority chain (async only because the route cache is in Postgres).
 * Returns { miles, minutes, office, source: 'manual'|'routed'|'auto'|'none' }.
 */
export async function estimate<T extends GeoPointLike>(
  offices: readonly T[] | null | undefined,
  target: EstimateTarget | null | undefined
): Promise<TravelEstimate<T>> {
  const office = nearest(offices, target);
  // Same manual > routed(OSRM) > haversine-auto > none chain as before; only
  // the roadFactor/mph knobs feeding the haversine tier now come live from
  // Estimating Rules instead of a hardcoded constant.
  const travel = await getTravelRates();
  if (target && target.travelMiles != null && target.travelMiles !== "") {
    const mi = Math.round(Number(target.travelMiles));
    const min =
      target.travelMin != null && target.travelMin !== ""
        ? Math.round(Number(target.travelMin))
        : minutesFromMiles(mi, travel);
    return { miles: mi, minutes: min, office, source: "manual" };
  }
  if (office) {
    const routed = await routeCached(office, target);
    if (routed)
      return { miles: routed.miles, minutes: routed.minutes, office, source: "routed" };
    const mi = driveMiles(office, target, travel);
    if (mi != null)
      return { miles: mi, minutes: minutesFromMiles(mi, travel), office, source: "auto" };
  }
  return { miles: null, minutes: null, office, source: "none" };
}

/* ---- tiny built-in geocoder: "city, st" (lowercased) -> {lat,lng} ----
   Offline fallback so travel math works with no network; anything unknown
   returns null and callers fall back to live search or manual entry. */

const CITIES: Record<string, LatLng> = {
  "milwaukee, wi": { lat: 43.039, lng: -87.906 },
  "madison, wi": { lat: 43.073, lng: -89.401 },
  "green bay, wi": { lat: 44.519, lng: -88.02 },
  "appleton, wi": { lat: 44.262, lng: -88.415 },
  "oshkosh, wi": { lat: 44.025, lng: -88.543 },
  "sheboygan, wi": { lat: 43.751, lng: -87.708 },
  "racine, wi": { lat: 42.726, lng: -87.783 },
  "kenosha, wi": { lat: 42.585, lng: -87.821 },
  "waukesha, wi": { lat: 43.012, lng: -88.231 },
  "west bend, wi": { lat: 43.425, lng: -88.184 },
  "fond du lac, wi": { lat: 43.775, lng: -88.439 },
  "manitowoc, wi": { lat: 44.089, lng: -87.657 },
  "janesville, wi": { lat: 42.683, lng: -89.019 },
  "beloit, wi": { lat: 42.508, lng: -89.032 },
  "stevens point, wi": { lat: 44.524, lng: -89.575 },
  "wausau, wi": { lat: 44.959, lng: -89.63 },
  "eau claire, wi": { lat: 44.812, lng: -91.499 },
  "la crosse, wi": { lat: 43.801, lng: -91.239 },
  "superior, wi": { lat: 46.72, lng: -92.104 },
};

export function geocode(
  city: string | null | undefined,
  state: string | null | undefined
): LatLng | null {
  if (!city) return null;
  const key = (String(city).trim() + ", " + String(state || "").trim()).toLowerCase();
  const hit = CITIES[key];
  return hit ? { lat: hit.lat, lng: hit.lng } : null;
}

/** Resolve a location object to coords: explicit lat/lng wins, else geocode(city, state). */
export function coordsOf(loc: PlaceLike | null | undefined): LatLng | null {
  if (!loc) return null;
  if (loc.lat != null && loc.lng != null && loc.lat !== "" && loc.lng !== "")
    return { lat: Number(loc.lat), lng: Number(loc.lng) };
  return geocode(loc.city, loc.state);
}

export function knownCities(): string[] {
  return Object.keys(CITIES);
}
