import { getBlob, setBlob } from "@/db/doc-store";
import { REPAIR_RATE_DEFAULTS } from "@/lib/stores/pricing";

export { REPAIR_RATE_DEFAULTS };

/**
 * RepairEstimate — server port of app/repair.js, the auto-pricing engine for
 * repair quotes. Pure functions; rates live in the "repair_rates" blob
 * (rss_repair_rates_v1) with defaults from REPAIR_RATE_DEFAULTS.
 *
 * Pricing model (mirrors the flame-test engine's shape):
 *   1. Labor — laborHours × labor rate. Emergency / after-hours work
 *      multiplies the labor rate by the emergency multiplier.
 *   2. Travel — round-trip mileage + travel time from the nearest office out
 *      to the venue(s) and back, SHARED across venues visited on one trip
 *      (counted once for the whole route). Mileage at the mileage rate;
 *      travel time at the labor rate, rounded up to the nearest N minutes.
 *   3. Service sell — (labor + travel) marked up to the service margin:
 *      serviceSell = serviceCost ÷ (1 − margin). A minimum call-out is a
 *      FLOOR on the service sell (showing up costs at least the call-out,
 *      before parts).
 *   4. Parts — Σ(qty × cost), marked up to the parts margin:
 *      partsSell = partsCost ÷ (1 − partsMargin).
 *   5. Total = serviceSell + partsSell.
 *
 * The prototype's window.Geo routing is injected via an optional GeoAdapter;
 * without one, tripTravel uses the prototype's estimate fallback
 * (max one-way miles/minutes × 2).
 */

export type RepairRates = {
  laborRate: number; // $/hour — skilled rigging / repair labor
  mileageRate: number; // $/mile — federal standard mileage rate
  minCallout: number; // $ minimum service call (floor on the service sell, before parts)
  partsMargin: number; // points on parts (sell = cost / (1 - partsMargin))
  margin: number; // points on labor + travel
  emergencyMult: number; // labor-rate multiplier for emergency / after-hours work
  travelRoundMin: number; // round total travel time up to the nearest N minutes
};

const RATES_BLOB_ID = "repair_rates"; // rss_repair_rates_v1

/** Typed copy of the shared defaults (single source: stores/pricing). */
export function rateDefaults(): RepairRates {
  return { ...REPAIR_RATE_DEFAULTS } as RepairRates;
}

/** Effective rates = defaults overlaid with the saved blob (port of getRates). */
export async function getRates(): Promise<RepairRates> {
  return getBlob<RepairRates>(RATES_BLOB_ID, rateDefaults());
}

/** Merge a patch into the saved rates and return the effective result (port of setRates). */
export async function setRates(patch: Partial<RepairRates>): Promise<RepairRates> {
  await setBlob(RATES_BLOB_ID, patch);
  return getRates();
}

/* ---------- pure pricing ---------- */

export type LatLng = { lat: number; lng: number };

/** Injectable stand-in for the prototype's window.Geo. */
export type GeoAdapter = {
  driveMiles(a: LatLng, b: LatLng): number | null;
  driveMinutes(a: LatLng, b: LatLng): number | null;
};

export type TripVenueInput = {
  label?: string;
  coords?: LatLng | null;
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
  minutesRaw: number;
  minutes: number;
  mileageCost: number;
  timeCost: number;
  total: number;
  method: "route" | "estimate";
  legs: TripLeg[];
};

export function roundUpTo(min: number | null | undefined, step?: number): number {
  if (min == null || isNaN(min)) return 0;
  step = step || 15;
  return Math.ceil(min / step) * step;
}

/**
 * Shared trip travel over the whole route: office -> v1 -> ... -> vn -> office.
 * Same approach as the flame-test engine so both price travel identically.
 */
export function tripTravel(
  office: { lat?: number | null; lng?: number | null } | null | undefined,
  venues: TripVenueInput[],
  C: RepairRates,
  geo?: GeoAdapter | null
): TripTravel {
  const legs: TripLeg[] = [];
  let miles = 0;
  let minutes = 0;
  let method: "route" | "estimate" = "route";
  const haveGeo = !!geo;
  const coordVenues = venues.filter(
    (v) => v.coords && v.coords.lat != null && v.coords.lng != null
  );

  if (
    haveGeo &&
    geo &&
    office &&
    office.lat != null &&
    coordVenues.length === venues.length &&
    venues.length
  ) {
    const seq: LatLng[] = ([office as LatLng] as LatLng[])
      .concat(venues.map((v) => v.coords as LatLng))
      .concat([office as LatLng]);
    const labels = ["Office"]
      .concat(venues.map((v) => v.label || "Venue"))
      .concat(["Office"]);
    for (let i = 0; i < seq.length - 1; i++) {
      const m = geo.driveMiles(seq[i], seq[i + 1]);
      const t = geo.driveMinutes(seq[i], seq[i + 1]);
      if (m != null) miles += m;
      if (t != null) minutes += t;
      legs.push({ from: labels[i], to: labels[i + 1], miles: m, minutes: t });
    }
  } else {
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

  const minutesBilled = roundUpTo(minutes, C.travelRoundMin);
  const mileageCost = miles * C.mileageRate;
  const timeCost = (minutesBilled / 60) * C.laborRate;
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

export type RepairPartInput = {
  name?: string;
  qty?: number | string | null;
  cost?: number | string | null;
};

export type RepairEstimatePart = {
  name: string;
  qty: number;
  cost: number;
  extCost: number;
};

export type RepairEstimateOptions = {
  office?: { lat?: number | null; lng?: number | null } | null;
  venues?: TripVenueInput[];
  laborHours?: number | string | null;
  parts?: RepairPartInput[];
  emergency?: boolean;
  /** Optional routing service (prototype's window.Geo). */
  geo?: GeoAdapter | null;
};

export type RepairEstimate = {
  rates: RepairRates;
  laborHours: number;
  laborRate: number;
  laborCost: number;
  emergency: boolean;
  trip: TripTravel;
  serviceCost: number;
  serviceSellRaw: number;
  serviceSell: number;
  minCallout: number;
  calloutApplied: boolean;
  parts: RepairEstimatePart[];
  partsCost: number;
  partsSell: number;
  margin: number;
  partsMargin: number;
  cost: number;
  total: number;
  marginAmount: number;
};

/** Pure port of compute(opts) with the rates passed in explicitly. */
export function computeEstimate(
  opts: RepairEstimateOptions,
  C: RepairRates
): RepairEstimate {
  const venues = (opts.venues || []).slice();

  const laborHours = Math.max(0, Number(opts.laborHours) || 0);
  const laborRate = C.laborRate * (opts.emergency ? C.emergencyMult || 1 : 1);
  const laborCost = laborHours * laborRate;

  const trip = tripTravel(opts.office, venues, C, opts.geo);
  const serviceCost = laborCost + trip.total;

  const margin = C.margin;
  const serviceSellRaw =
    margin > 0 && margin < 1 ? serviceCost / (1 - margin) : serviceCost;
  const calloutApplied = serviceSellRaw < C.minCallout;
  const serviceSell = calloutApplied ? C.minCallout : serviceSellRaw;

  const parts: RepairEstimatePart[] = (opts.parts || []).map((p) => {
    const qty = Math.max(0, Number(p.qty) || 0);
    const cost = Math.max(0, Number(p.cost) || 0);
    return { name: p.name || "Part", qty, cost, extCost: qty * cost };
  });
  const partsCost = parts.reduce((a, p) => a + p.extCost, 0);
  const pMargin = C.partsMargin;
  const partsSell =
    pMargin > 0 && pMargin < 1 ? partsCost / (1 - pMargin) : partsCost;

  const total = serviceSell + partsSell;
  const cost = serviceCost + partsCost;

  return {
    rates: C,
    laborHours,
    laborRate,
    laborCost,
    emergency: !!opts.emergency,
    trip,
    serviceCost,
    serviceSellRaw,
    serviceSell,
    minCallout: C.minCallout,
    calloutApplied,
    parts,
    partsCost,
    partsSell,
    margin,
    partsMargin: pMargin,
    cost,
    total,
    marginAmount: total - cost,
  };
}

/** Async port of RepairEstimate.compute — reads the saved rates, then prices. */
export async function compute(
  opts: RepairEstimateOptions = {}
): Promise<RepairEstimate> {
  return computeEstimate(opts, await getRates());
}
