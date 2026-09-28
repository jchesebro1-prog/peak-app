import { get as getCustomer } from "@/lib/stores/customers";
import { resolveTier } from "@/lib/pricing-tiers";
import { getTravelRates } from "@/lib/stores/pricing";
import { compute as computeFlame, getRates as getFlameRates } from "@/lib/flametest-engine";
import { computeEstimate as computeInspection, getRates as getInspectionRates } from "@/lib/inspection-engine";
import { flameVenueInputsFrom, inspectionVenueInputsFrom, resolveQuoteOffice } from "@/lib/service-quote-inputs";
import { savedTrip } from "@/lib/travel-plan";
import { travelLineShare } from "@/lib/service-pricing";
import type { PortalService } from "@/lib/portal-service-scope";

/**
 * Portal service quotes (#248 Task 1) — builder-identical pricing: the same
 * engine math the flame-test / inspection quote builders run
 * (src/app/(app)/flame-tests/quote/actions.ts,
 * src/app/(app)/inspections/quote/actions.ts persist()), reusing the shared
 * venue-input step (src/lib/service-quote-inputs.ts) so a portal price can
 * never diverge from what a staff save would produce for the same inputs.
 *
 * The customer never sees rates, hours, margin, tier, cost or the travel
 * breakdown — `ServiceCustomerView` is an explicit whitelist: one line per
 * venue (flame) or one summary line (inspection, which has no per-venue
 * breakdown), one "Travel" line, and the total. The travel line is the
 * engine's travel cost RECONCILED to the sell total via `travelLineShare`
 * (the same proportional-share helper the renewal letters use for their one
 * travel line, src/lib/service-pricing.ts) — separable, so it is never
 * folded to 0. Per-venue flame lines split the remainder (`rest`)
 * proportionally to each venue's share of the testing cost, with the last
 * line absorbing the rounding remainder so the lines + travel always sum to
 * exactly `total`.
 */

export type ServiceRequest = {
  service: PortalService;
  venues: Array<{ venueId: string; count: number }>;
};

export type ServiceCustomerView = {
  lines: Array<{ label: string; amount: number }>;
  travel: number;
  total: number;
};

export type PriceServiceResult =
  | {
      ok: true;
      view: ServiceCustomerView;
      subdoc: unknown;
      total: number;
      margin: number;
      tier: string;
      tierMargin: number;
    }
  | { ok: false; error: string };

export const PICK_VENUE_COPY = "Pick at least one venue.";
export const CURTAINS_RANGE_COPY = "Enter the number of curtains (1–200).";
export const LINE_SETS_RANGE_COPY = "Enter the number of line sets (1–300).";

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isValidService(s: unknown): s is PortalService {
  if (!isPlainRecord(s)) return false;
  if (s.kind === "flame") return true;
  if (s.kind === "inspection") return s.level === 1 || s.level === 2;
  return false;
}

/**
 * Pure validation, verbatim copy (#248 global constraints): an empty/foreign
 * venue list, or any listed venue id the caller doesn't own → "Pick at least
 * one venue."; an out-of-range or non-integer count → the service's exact
 * range copy. `venueIds` is the caller's own venues — callers pass the
 * customer's locations, so a foreign id can never sneak a count through.
 */
export function serviceRequestProblem(req: unknown, venueIds: Set<string>): string | null {
  if (!isPlainRecord(req)) return PICK_VENUE_COPY;
  if (!isValidService(req.service)) return PICK_VENUE_COPY;
  const service = req.service as PortalService;
  const venues = Array.isArray(req.venues) ? req.venues : null;
  if (!venues || !venues.length) return PICK_VENUE_COPY;
  const rangeCopy = service.kind === "flame" ? CURTAINS_RANGE_COPY : LINE_SETS_RANGE_COPY;
  const max = service.kind === "flame" ? 200 : 300;
  for (const v of venues) {
    if (!isPlainRecord(v)) return PICK_VENUE_COPY;
    if (typeof v.venueId !== "string" || !v.venueId || !venueIds.has(v.venueId)) return PICK_VENUE_COPY;
    const count = v.count;
    if (typeof count !== "number" || !Number.isInteger(count)) return rangeCopy;
    if (count < 1 || count > max) return rangeCopy;
  }
  return null;
}

/** Split `rest` dollars across `weights`' shares, summing to exactly `rest`
 *  (the last share absorbs the rounding remainder). An all-zero weight set
 *  splits evenly rather than dividing by zero. */
function splitProportional(rest: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let shares: number[];
  if (totalWeight > 0) {
    shares = weights.map((w) => Math.round((rest * w) / totalWeight));
  } else {
    const each = Math.floor(rest / n);
    shares = new Array(n).fill(each);
  }
  const diff = rest - shares.reduce((a, b) => a + b, 0);
  shares[n - 1] += diff;
  return shares;
}

/**
 * Builder-identical pricing for a portal service request: resolves the
 * customer's tier margin exactly like the builders' `persist()` (no
 * overrides of any kind — #248 controller decision), builds engine inputs
 * through the shared service-quote-inputs helpers, prices with the live
 * engine + rates, and returns a sell-only customer view alongside the
 * subdoc a builder save would write (owned by later tasks — this task
 * returns it as `unknown`, unsaved).
 */
export async function priceServiceRequest(
  session: { customerId: string; name: string },
  req: ServiceRequest
): Promise<PriceServiceResult> {
  const cust = await getCustomer(session.customerId);
  if (!cust) return { ok: false, error: PICK_VENUE_COPY };
  const venueIds = new Set((cust.locations || []).map((l) => l.id).filter((id): id is string => !!id));
  const problem = serviceRequestProblem(req, venueIds);
  if (problem) return { ok: false, error: problem };

  const tier = await resolveTier(session.customerId, session.name);
  const office = await resolveQuoteOffice();
  const travelRates = await getTravelRates();
  const contact = { name: session.name, role: "", email: "" };
  const origin = office
    ? {
        name: office.name || "",
        street: office.street || "",
        city: office.city || "",
        state: office.state || "",
        zip: office.zip || "",
      }
    : null;

  if (req.service.kind === "flame") {
    const baseRates = await getFlameRates();
    const rates = { ...baseRates, margin: tier.margin };
    const venueInputs = flameVenueInputsFrom(
      req.venues.map((v) => ({ id: v.venueId, curtains: v.count })),
      cust
    );
    const r = computeFlame({ office: office || undefined, venues: venueInputs }, rates, travelRates);

    const { travel, rest } = travelLineShare({
      flightTotal: r.travel.total,
      total: r.total,
      cost: r.cost,
      margin: r.effectiveMargin,
    });
    const shares = splitProportional(rest, r.perVenue.map((v) => v.laborCost));
    const lines = r.perVenue.map((v, i) => ({
      label: `Flame test — ${v.label} (${v.curtains} curtain${v.curtains === 1 ? "" : "s"})`,
      amount: shares[i] ?? 0,
    }));

    const subdoc = {
      rates: r.rates,
      office: office ? office.name || office.id || "" : "",
      origin,
      venues: r.perVenue.map((v) => ({
        id: v.id,
        label: v.label,
        curtains: v.curtains,
        testingCost: Math.round(v.laborCost),
      })),
      curtainsTotal: r.curtainsTotal,
      trip: savedTrip(r.trip),
      rawCost: Math.round(r.rawCost),
      baseFee: Math.round(r.baseFee),
      baseApplied: r.baseApplied,
      cost: Math.round(r.cost),
      marginAmount: Math.round(r.marginAmount),
      autoTotal: Math.round(r.autoTotal),
      total: Math.round(r.total),
      contact,
    };

    return {
      ok: true,
      view: { lines, travel, total: Math.round(r.total) },
      subdoc,
      total: Math.round(r.total),
      margin: r.effectiveMargin,
      tier: tier.tier,
      tierMargin: tier.margin,
    };
  }

  const level = req.service.level;
  const baseRates = await getInspectionRates();
  const rates = { ...baseRates, margin: tier.margin };
  const venueInputs = inspectionVenueInputsFrom(
    req.venues.map((v) => ({ id: v.venueId, lineSets: v.count })),
    cust
  );
  const r = computeInspection(
    { office: office || undefined, venues: venueInputs, level },
    rates,
    travelRates
  );

  const { travel, rest } = travelLineShare({
    flightTotal: r.travel.total,
    total: r.total,
    cost: r.cost,
    margin: r.effectiveMargin,
  });
  const levelWord = level === 2 ? "Five-year" : "Annual";
  const venueCount = req.venues.length;
  const lines = [
    {
      label: `${levelWord} rigging inspection — ${r.lineSetsTotal} line set${r.lineSetsTotal === 1 ? "" : "s"} across ${venueCount} venue${venueCount === 1 ? "" : "s"}`,
      amount: rest,
    },
  ];

  const subdoc = {
    rates: r.rates,
    office: office ? office.name || office.id || "" : "",
    level,
    scope: "",
    venues: venueInputs.map((v) => ({ id: v.id, label: v.label, lineSets: v.lineSets })),
    lineSetsTotal: r.lineSetsTotal,
    inspectHours: r.inspectHours,
    baseHours: r.baseHours,
    levelMult: r.levelMult,
    trip: savedTrip(r.trip),
    laborCost: Math.round(r.laborCost),
    cost: Math.round(r.cost),
    minFee: r.minFee,
    minApplied: r.minApplied,
    marginAmount: Math.round(r.marginAmount),
    autoTotal: Math.round(r.autoTotal),
    total: Math.round(r.total),
    contact,
  };

  return {
    ok: true,
    view: { lines, travel, total: Math.round(r.total) },
    subdoc,
    total: Math.round(r.total),
    margin: r.effectiveMargin,
    tier: tier.tier,
    tierMargin: tier.margin,
  };
}
