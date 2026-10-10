/**
 * The instance-wide Nominatim turn queue (spec 2026-10-09; round 2). Every
 * live Nominatim request in one server instance — place-book passes and Fix
 * retries (place-book.ts), the venue Fix retry (venue-locate.ts), the
 * Settings address type-ahead and the venue re-check (venue-recheck.ts) —
 * takes a turn here, so together they stay at ≤ 1 request per
 * NOMINATIM_DELAY_MS. A turn is claimed synchronously (two callers can't take
 * the same slot); a caller whose turn would land later than its own
 * `maxWaitMs` gives up without a request.
 */
import { FETCH_TIMEOUT_MS, searchCityOrThrow, searchOrThrow, type GeoSearchHit } from "@/lib/geo";

/** Nominatim asks for <= 1 request/second. */
export const NOMINATIM_DELAY_MS = 1100;

/** When the next request may start. Shared by every caller in this instance. */
export const nominatimPacer = { nextAt: 0 };

export type PaceOpts = {
  /** Spacing after this turn (default NOMINATIM_DELAY_MS). */
  delayMs?: number;
  /** Give up (no request) when the turn would start later than this from now (default 15 s). */
  maxWaitMs?: number;
  pacer?: { nextAt: number };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** A 20 s caller budget less one request's timeout. */
const DEFAULT_MAX_WAIT_MS = 20_000 - FETCH_TIMEOUT_MS;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait for the next turn. False (and nothing claimed) when it is further off than maxWaitMs. */
export async function takeNominatimTurn(o: PaceOpts = {}): Promise<boolean> {
  const pacer = o.pacer ?? nominatimPacer;
  const now = (o.now ?? Date.now)();
  const slot = Math.max(now, pacer.nextAt);
  if (slot - now > (o.maxWaitMs ?? DEFAULT_MAX_WAIT_MS)) return false;
  pacer.nextAt = slot + (o.delayMs ?? NOMINATIM_DELAY_MS);
  if (slot > now) await (o.sleep ?? realSleep)(slot - now);
  return true;
}

/** Paced free-text search that THROWS on an outage or a full queue. */
export async function pacedSearchOrThrow(q: string, searchOpts?: { limit?: number }, o?: PaceOpts): Promise<GeoSearchHit[]> {
  if (String(q ?? "").trim().length < 3) return []; // searchOrThrow sends nothing for these
  if (!(await takeNominatimTurn(o))) throw new Error("Nominatim queue busy");
  return searchOrThrow(q, searchOpts);
}

/** Paced structured city search that THROWS on an outage or a full queue. */
export async function pacedSearchCityOrThrow(
  city: string | null | undefined,
  state: string | null | undefined,
  searchOpts?: { limit?: number },
  o?: PaceOpts
): Promise<GeoSearchHit[]> {
  if (String(city ?? "").trim().length < 2) return []; // searchCityOrThrow sends nothing for these
  if (!(await takeNominatimTurn(o))) throw new Error("Nominatim queue busy");
  return searchCityOrThrow(city, state, searchOpts);
}

/** Fail-soft paced free-text search: [] on an outage or a full queue. */
export async function pacedSearch(q: string, searchOpts?: { limit?: number }, o?: PaceOpts): Promise<GeoSearchHit[]> {
  try {
    return await pacedSearchOrThrow(q, searchOpts, o);
  } catch {
    return [];
  }
}

/** Fail-soft paced structured city search: [] on an outage or a full queue. */
export async function pacedSearchCity(
  city: string | null | undefined,
  state: string | null | undefined,
  searchOpts?: { limit?: number },
  o?: PaceOpts
): Promise<GeoSearchHit[]> {
  try {
    return await pacedSearchCityOrThrow(city, state, searchOpts, o);
  } catch {
    return [];
  }
}
