import { getBlob, setBlob } from "@/db/doc-store";
import {
  FLAMETEST_RATE_DEFAULTS,
  TRAVEL_RATE_DEFAULTS,
  getTravelRates,
  type TravelRates,
} from "@/lib/stores/pricing";

/**
 * FlameTest — auto-pricing engine for flame-test quotes. Server port of
 * app/flametest.js (localStorage key rss_flametest_rates_v1 → the
 * "flametest_rates" blob singleton).
 *
 * Pricing model (per Jeff, Jul 2026) — the formula is the spec:
 *   1. Travel — round-trip mileage + travel time from the office out to the
 *      venue(s) and back. Venues tested on ONE trip SHARE this expense: it
 *      is counted once for the whole route (office → v1 → … → vn → office),
 *      never per venue.
 *        - Mileage at `mileageRate` ($/mi — the federal IRS standard rate
 *          in effect at time of estimate, editable knob).
 *        - Travel time billed at the `laborRate` ($/hr), with total minutes
 *          rounded UP to the nearest `travelRoundMin` (15) first.
 *   2. Curtain labor — `curtainMinutes` (5) per curtain at `laborRate`.
 *   3. Base minimum — `baseFee` ($150) is a floor on the WHOLE job cost
 *      AFTER mileage + travel time + testing are summed:
 *        cost = max(baseFee, trip.total + testingSubtotal)
 *      It is not a per-venue or per-curtain charge.
 *   4. Margin — flat 30-point margin of the sell price on top:
 *        total = cost / (1 - margin)   (when 0 < margin < 1)
 *
 * Everything prices from an explicit rates object (pure functions);
 * getRates()/priceQuote() are the async wrappers that read the live,
 * office-editable rates blob merged over FLAMETEST_RATE_DEFAULTS.
 *
 * Travel legs use the prototype's offline geo tier inlined (haversine miles
 * x roadFactor, mph door-to-door, rounded per leg — geo.js constants,
 * defaulting to 1.25 / 50). These now live in Estimating Rules → "Travel &
 * mileage" (blob `travel_rates`, src/lib/stores/pricing.ts) — priceQuote()
 * reads the live values; compute()/tripTravel() stay pure and take an
 * explicit `travel` param (TRAVEL_RATE_DEFAULTS when omitted), same pattern
 * as the rates param. The prototype's live OSRM routing tier is a
 * client/network concern and is not duplicated here; when coords are
 * missing the same estimate fallback applies (one round trip to the
 * farthest venue's one-way numbers, themselves derived upstream from
 * geo.ts's estimate() — which DOES prefer a live/cached OSRM route).
 */

export type FlameTestRates = {
  /** $/mile — federal (IRS) standard mileage rate at time of estimate. */
  mileageRate: number;
  /** $/hour — testing & travel labor. */
  laborRate: number;
  /** Minutes to test one curtain. */
  curtainMinutes: number;
  /** $ minimum for the whole job (after mileage + travel + testing). */
  baseFee: number;
  /** Margin of the sell price (0.30 = 30 points). */
  margin: number;
  /** Round total travel time up to the nearest N minutes. */
  travelRoundMin: number;
};

const RATES_BLOB_ID = "flametest_rates";

/** Live rates: stored patch merged over FLAMETEST_RATE_DEFAULTS (port of getRates). */
export async function getRates(): Promise<FlameTestRates> {
  const defaults: FlameTestRates = { ...FLAMETEST_RATE_DEFAULTS };
  return getBlob<FlameTestRates>(RATES_BLOB_ID, defaults);
}

/** Merge a patch into the persisted rates; returns the merged rates (port of setRates). */
export async function setRates(
  patch: Partial<FlameTestRates> = {}
): Promise<FlameTestRates> {
  const next = { ...(await getRates()), ...patch };
  await setBlob(RATES_BLOB_ID, next);
  return next;
}

/** Round minutes UP to the nearest step (default 15); 0 for null/NaN. */
export function roundUpTo(min: number | null | undefined, step?: number): number {
  if (min == null || isNaN(min)) return 0;
  const s = step || 15;
  return Math.ceil(min / s) * s;
}

/* ---------- inlined geo fallback (geo.js offline tier, exact constants) ---------- */

export type LatLng = { lat: number; lng: number };

type MaybeCoords = { lat?: number | null; lng?: number | null } | null | undefined;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle miles between two {lat,lng}; null if either is missing coords. */
function haversineMiles(a: MaybeCoords, b: MaybeCoords): number | null {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null)
    return null;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Straight-line → on-road distance, using the live (or default) road factor. */
function driveMiles(a: MaybeCoords, b: MaybeCoords, travel: TravelRates): number | null {
  const m = haversineMiles(a, b);
  return m == null ? null : Math.round(m * travel.roadFactor);
}

/** Road minutes from the live (or default) assumed average speed. */
function driveMinutes(a: MaybeCoords, b: MaybeCoords, travel: TravelRates): number | null {
  const mi = driveMiles(a, b, travel);
  return mi == null ? null : Math.round((mi / travel.mph) * 60);
}

/* ---------- inputs & outputs ---------- */

export type FlameTestOffice = {
  lat?: number | null;
  lng?: number | null;
  name?: string;
  id?: string;
};

export type FlameTestVenueInput = {
  id?: string | null;
  label?: string;
  curtains?: number | string | null;
  coords?: { lat?: number | null; lng?: number | null } | null;
  /** Fallback one-way estimates used when any venue lacks coords. */
  oneWayMiles?: number | string | null;
  oneWayMin?: number | string | null;
};

export type TripLeg = {
  from: string;
  to: string;
  miles: number | null;
  minutes: number | null;
};

export type TripTravel = {
  miles: number;
  /** Un-rounded route minutes (display). */
  minutesRaw: number;
  /** Billed minutes — rounded up to travelRoundMin. */
  minutes: number;
  mileageCost: number;
  timeCost: number;
  total: number;
  method: "route" | "estimate";
  legs: TripLeg[];
};

export type VenuePrice = {
  id: string | null;
  label: string;
  curtains: number;
  laborMin: number;
  laborCost: number;
  charge: number;
};

export type FlameTestComputeOpts = {
  office?: FlameTestOffice | null;
  venues?: FlameTestVenueInput[];
};

export type FlameTestPricing = {
  rates: FlameTestRates;
  perVenue: VenuePrice[];
  testingSubtotal: number;
  /** Alias of testingSubtotal (prototype exposed both). */
  venuesSubtotal: number;
  curtainsTotal: number;
  venueCount: number;
  trip: TripTravel;
  /** trip.total + testingSubtotal, before the base-fee floor. */
  rawCost: number;
  baseFee: number;
  /** True when the whole-job cost was floored at baseFee. */
  baseApplied: boolean;
  cost: number;
  margin: number;
  marginAmount: number;
  total: number;
};

/* ---------- pure pricing ---------- */

/** Per-venue curtain-testing labor: curtains x curtainMinutes at laborRate. */
export function priceVenue(
  v: FlameTestVenueInput,
  rates: FlameTestRates
): VenuePrice {
  const curtains = Math.max(0, Math.round(Number(v.curtains) || 0));
  const laborMin = curtains * rates.curtainMinutes;
  const laborCost = laborMin * (rates.laborRate / 60);
  return {
    id: v.id ?? null,
    label: v.label || "Venue",
    curtains,
    laborMin,
    laborCost,
    charge: laborCost,
  };
}

/**
 * Shared trip travel over the whole route: office → v1 → … → vn → office.
 * When office + every venue have coords the legs are summed individually
 * (inter-venue hops are ~0 for same-city clusters); otherwise falls back to
 * a single round trip to the farthest venue's one-way estimate so a number
 * still comes out.
 */
export function tripTravel(
  office: FlameTestOffice | null | undefined,
  venues: FlameTestVenueInput[],
  rates: FlameTestRates,
  travel: TravelRates = TRAVEL_RATE_DEFAULTS
): TripTravel {
  const legs: TripLeg[] = [];
  let miles = 0;
  let minutes = 0;
  let method: "route" | "estimate" = "route";
  const coordVenues = venues.filter(
    (v) => v.coords && v.coords.lat != null && v.coords.lng != null
  );

  if (
    office &&
    office.lat != null &&
    coordVenues.length === venues.length &&
    venues.length > 0
  ) {
    const seq: MaybeCoords[] = [office, ...venues.map((v) => v.coords), office];
    const labels = ["Office", ...venues.map((v) => v.label || "Venue"), "Office"];
    for (let i = 0; i < seq.length - 1; i++) {
      const m = driveMiles(seq[i], seq[i + 1], travel);
      const t = driveMinutes(seq[i], seq[i + 1], travel);
      if (m != null) miles += m;
      if (t != null) minutes += t;
      legs.push({ from: labels[i], to: labels[i + 1], miles: m, minutes: t });
    }
  } else {
    // fallback: one round trip to the farthest venue by one-way estimate
    method = "estimate";
    let maxMi = 0;
    let maxMin = 0;
    venues.forEach((v) => {
      const mi = Number(v.oneWayMiles) || 0;
      if (mi > maxMi) {
        maxMi = mi;
        maxMin = Number(v.oneWayMin) || 0;
      }
    });
    miles = maxMi * 2;
    minutes = maxMin * 2;
  }

  const minutesBilled = roundUpTo(minutes, rates.travelRoundMin);
  const mileageCost = miles * rates.mileageRate;
  const timeCost = (minutesBilled / 60) * rates.laborRate;
  return {
    miles: Math.round(miles),
    minutesRaw: Math.round(minutes),
    minutes: minutesBilled,
    mileageCost,
    timeCost,
    total: mileageCost + timeCost,
    method,
    legs,
  };
}

/**
 * Price a whole flame-test quote from an explicit rates object (pure port
 * of FlameTest.compute):
 *
 *   rawCost = trip.total + testingSubtotal
 *   cost    = max(baseFee, rawCost)          — base fee floors the whole job
 *   total   = cost / (1 - margin)            — when 0 < margin < 1, else cost
 */
export function compute(
  opts: FlameTestComputeOpts = {},
  rates: FlameTestRates,
  travel: TravelRates = TRAVEL_RATE_DEFAULTS
): FlameTestPricing {
  const C = rates;
  const venues = (opts.venues || []).slice();

  const perVenue = venues.map((v) => priceVenue(v, C));
  const testingSubtotal = perVenue.reduce((a, v) => a + v.laborCost, 0);
  const curtainsTotal = perVenue.reduce((a, v) => a + v.curtains, 0);

  const trip = tripTravel(opts.office, venues, C, travel);
  // Base $150 is a floor on the WHOLE job cost (mileage + travel + testing),
  // not a per-venue charge. Margin is applied on top of the floored cost.
  const rawCost = trip.total + testingSubtotal;
  const baseFee = C.baseFee;
  const baseApplied = rawCost < baseFee;
  const cost = baseApplied ? baseFee : rawCost;
  const margin = C.margin;
  const total = margin > 0 && margin < 1 ? cost / (1 - margin) : cost;
  const marginAmount = total - cost;

  return {
    rates: C,
    perVenue,
    testingSubtotal,
    venuesSubtotal: testingSubtotal,
    curtainsTotal,
    venueCount: venues.length,
    trip,
    rawCost,
    baseFee,
    baseApplied,
    cost,
    margin,
    marginAmount,
    total,
  };
}

/** compute() against the live persisted rates (async wrapper). */
export async function priceQuote(
  opts: FlameTestComputeOpts = {}
): Promise<FlameTestPricing> {
  const [rates, travel] = await Promise.all([getRates(), getTravelRates()]);
  return compute(opts, rates, travel);
}
