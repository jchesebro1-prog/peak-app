import { getBlob, setBlob } from "@/db/doc-store";
import { INSPECTION_RATE_DEFAULTS, getTravelRates } from "@/lib/stores/pricing";
import {
  tripTravel,
  type GeoAdapter,
  type TripTravel,
  type TripVenueInput,
} from "@/lib/repair-engine";
import {
  FLY_CREW_DEFAULTS,
  planTravel,
  withMode,
  type FlyRates,
  type TravelOverride,
  type TravelPlan,
  type TripMode,
} from "@/lib/travel-plan";

export { INSPECTION_RATE_DEFAULTS };
export type { GeoAdapter, TripTravel, TripVenueInput };

/**
 * InspectionEstimate — the auto-pricing engine for rigging-inspection quotes
 * (IDEAS #44; new — no prototype engine existed, shaped after the flame-test
 * and repair engines). Pure functions; rates live in the "inspection_rates"
 * blob (rss_inspection_rates_v1) with defaults from INSPECTION_RATE_DEFAULTS.
 *
 * Pricing model:
 *   1. Inspection time — baseHours per visit (setup, walkthrough, findings
 *      write-up) + lineSets × lineSetMinutes across all venues. A Level 2
 *      (5-year in-depth) inspection multiplies that time by level2Mult.
 *   2. Labor — inspection hours × labor rate.
 *   3. Travel — round-trip mileage + travel time from the nearest office,
 *      SHARED across venues visited on one trip (identical math to the
 *      repair engine — tripTravel is imported from it so the two can never
 *      drift).
 *   4. Total = (labor + travel) ÷ (1 − margin), floored at the minimum fee.
 *   5. Flights over drive (spec 2026-09-25, src/lib/travel-plan.ts) — a trip
 *      whose drive cost reaches the threshold prices as flights (default crew
 *      inspection_rates.flyCrew, nights from the inspection hours). Drive
 *      mode is unchanged.
 */

export type InspectionRates = {
  laborRate: number; // $/hour — rigging-inspection labor
  mileageRate: number; // $/mile — federal standard mileage rate
  lineSetMinutes: number; // minutes to inspect one line set (Level 1)
  baseHours: number; // fixed on-site hours per visit
  level2Mult: number; // inspection-time multiplier for a Level 2 inspection
  minFee: number; // $ minimum for the whole job
  margin: number; // points, margin of the sell price
  travelRoundMin: number; // round total travel time up to the nearest N minutes
  flyCrew?: number; // default crew when the trip flies (FLY_CREW_DEFAULTS.inspection when absent)
};

const RATES_BLOB_ID = "inspection_rates"; // rss_inspection_rates_v1

/** Typed copy of the shared defaults (single source: stores/pricing). */
export function rateDefaults(): InspectionRates {
  return { ...INSPECTION_RATE_DEFAULTS } as InspectionRates;
}

/** Effective rates = defaults overlaid with the saved blob. */
export async function getRates(): Promise<InspectionRates> {
  const saved = await getBlob<InspectionRates>(RATES_BLOB_ID, rateDefaults());
  return saved;
}

/** Merge a patch into the saved rates and return the effective result. */
export async function setRates(
  patch: Partial<InspectionRates>
): Promise<InspectionRates> {
  await setBlob(RATES_BLOB_ID, patch);
  return getRates();
}

/* ---------- pure pricing ---------- */

export type InspectionVenueInput = TripVenueInput & {
  id?: string | null;
  lineSets?: number | string | null;
};

export type InspectionEstimateOptions = {
  office?: { lat?: number | null; lng?: number | null } | null;
  venues?: InspectionVenueInput[];
  /** 1 = annual visual · 2 = five-year in-depth. */
  level?: number;
  /** Per-quote travel override (Auto · Drive · Fly, crew, nights, airfare). */
  travel?: TravelOverride | null;
  /** Optional routing service (prototype's window.Geo). */
  geo?: GeoAdapter | null;
};

export type InspectionEstimate = {
  rates: InspectionRates;
  level: number;
  lineSetsTotal: number;
  baseHours: number;
  inspectHoursRaw: number;
  inspectHours: number;
  levelMult: number;
  laborRate: number;
  laborCost: number;
  /** The drive numbers (trip.total is always the DRIVE cost) + mode/flight. */
  trip: TripTravel & TripMode;
  /** The travel plan — travel.total is the figure the quote prices. */
  travel: TravelPlan;
  cost: number;
  sellRaw: number;
  minFee: number;
  minApplied: boolean;
  margin: number;
  total: number;
  marginAmount: number;
};

/** Pure compute with the rates passed in explicitly. */
export function computeEstimate(
  opts: InspectionEstimateOptions,
  C: InspectionRates,
  travel?: Partial<FlyRates> | null
): InspectionEstimate {
  const venues = (opts.venues || []).slice();
  const level = opts.level === 2 ? 2 : 1;
  const levelMult = level === 2 ? C.level2Mult || 1 : 1;

  const lineSetsTotal = venues.reduce(
    (a, v) => a + Math.max(0, Number(v.lineSets) || 0),
    0
  );
  const inspectHoursRaw = C.baseHours + (lineSetsTotal * C.lineSetMinutes) / 60;
  const inspectHours = Math.round(inspectHoursRaw * levelMult * 10) / 10;
  const laborCost = inspectHours * C.laborRate;

  const drive = tripTravel(opts.office, venues, C, opts.geo);
  // Flights over drive: in drive mode plan.total IS drive.total (bit-for-bit).
  const plan = planTravel({
    drive,
    onSiteHours: inspectHours,
    laborRate: C.laborRate,
    crewDefault: C.flyCrew ?? FLY_CREW_DEFAULTS.inspection,
    rates: travel,
    override: opts.travel,
  });
  const trip = withMode(drive, plan);
  const cost = laborCost + plan.total;

  const margin = C.margin;
  const sellRaw = margin > 0 && margin < 1 ? cost / (1 - margin) : cost;
  const minApplied = sellRaw < C.minFee;
  const total = minApplied ? C.minFee : sellRaw;

  return {
    rates: C,
    level,
    lineSetsTotal,
    baseHours: C.baseHours,
    inspectHoursRaw,
    inspectHours,
    levelMult,
    laborRate: C.laborRate,
    laborCost,
    trip,
    travel: plan,
    cost,
    sellRaw,
    minFee: C.minFee,
    minApplied,
    margin,
    total,
    marginAmount: total - cost,
  };
}

/** Async compute — reads the saved rates, then prices. */
export async function compute(
  opts: InspectionEstimateOptions = {}
): Promise<InspectionEstimate> {
  return computeEstimate(opts, await getRates(), await getTravelRates());
}
