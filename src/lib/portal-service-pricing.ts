import { get as getCustomer, type CustomerDoc } from "@/lib/stores/customers";
import { coordsOf } from "@/lib/geo";
import { resolveTier, serviceMarginFor } from "@/lib/pricing-tiers";
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
/** #248 final review (controller decision 2), verbatim copy — kept as
 *  literal prefix/suffix (rather than one whole-string constant) so the
 *  client form (service-form.tsx, which can't import a value out of this
 *  DB-touching module) can duplicate them and match a venue label back out
 *  of the returned error to build its "request a quote instead" link. */
export const TRAVEL_UNKNOWN_PREFIX = "We need to confirm travel for ";
export const TRAVEL_UNKNOWN_SUFFIX = " — request a quote instead.";
export function travelUnknownError(venueLabel: string): string {
  return `${TRAVEL_UNKNOWN_PREFIX}${venueLabel}${TRAVEL_UNKNOWN_SUFFIX}`;
}

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
  // #248 final review (controller decision 3): a request can't list more
  // venues than the customer actually has, or repeat one — either would
  // double-count that venue's trip leg in the shared-trip pricing (D423).
  // Neither condition has its own copy (spec's six standing error strings
  // don't cover it), and both make the whole request unpickable, so both
  // reuse "Pick at least one venue." (same D421 reasoning as a foreign id or
  // a bad inspection level).
  if (venues.length > venueIds.size) return PICK_VENUE_COPY;
  const rangeCopy = service.kind === "flame" ? CURTAINS_RANGE_COPY : LINE_SETS_RANGE_COPY;
  const max = service.kind === "flame" ? 200 : 300;
  const seen = new Set<string>();
  for (const v of venues) {
    if (!isPlainRecord(v)) return PICK_VENUE_COPY;
    if (typeof v.venueId !== "string" || !v.venueId || !venueIds.has(v.venueId)) return PICK_VENUE_COPY;
    if (seen.has(v.venueId)) return PICK_VENUE_COPY;
    seen.add(v.venueId);
    const count = v.count;
    if (typeof count !== "number" || !Number.isInteger(count)) return rangeCopy;
    if (count < 1 || count > max) return rangeCopy;
  }
  return null;
}

/**
 * #248 final review (controller decision 2) — the engine can only price a
 * venue's travel from coords (geocoded or explicit lat/lng) or a saved
 * fallback `travelMiles`; a venue with neither would otherwise price a
 * silent $0 travel share for that leg. Returns the FIRST such venue's label
 * (request order, not directory order) so the customer sees which venue to
 * fix, or null when every requested venue can be priced. `venueIds` in
 * `req.venues` are already proven to be this customer's own by
 * `serviceRequestProblem` before this runs.
 */
function firstUnlocatedVenueLabel(
  venues: Array<{ venueId: string }>,
  cust: CustomerDoc | null
): string | null {
  const locById = new Map((cust?.locations || []).map((l) => [l.id, l]));
  for (const v of venues) {
    const loc = v.venueId ? locById.get(v.venueId) : undefined;
    if (!loc) continue;
    if (coordsOf(loc) || loc.travelMiles != null) continue;
    return loc.label || loc.locationName || "this venue";
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
  session: { customerId: string; name: string; email?: string },
  req: ServiceRequest
): Promise<PriceServiceResult> {
  const cust = await getCustomer(session.customerId);
  if (!cust) return { ok: false, error: PICK_VENUE_COPY };
  const venueIds = new Set((cust.locations || []).map((l) => l.id).filter((id): id is string => !!id));
  const problem = serviceRequestProblem(req, venueIds);
  if (problem) return { ok: false, error: problem };
  // #248 final review (controller decision 2): refuse before pricing rather
  // than silently pricing a $0 travel leg for a venue the engine can't
  // locate.
  const unlocated = firstUnlocatedVenueLabel(req.venues, cust);
  if (unlocated) return { ok: false, error: travelUnknownError(unlocated) };

  const tier = await resolveTier(session.customerId, session.name);
  const office = await resolveQuoteOffice();
  const travelRates = await getTravelRates();
  // #248 final review (controller decision 5): thread the portal session's
  // email into the saved subdoc contact — previously always "", so a
  // portal-service quote's contact record carried no way to reach the
  // customer back. `session.email` is optional here only because
  // refreshServicePortalQuote (src/lib/portal-quotes.ts) rebuilds a
  // customerId/contactName-only session from the stored quote, not a live
  // portalSession() (D425 — refresh deliberately reprices at the quote's
  // OWN customer/tier, never the caller's session).
  const contact = { name: session.name, role: "", email: session.email || "" };
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
    // #254 follow-up: an untiered customer prices/stamps at flame testing's
    // own default margin, not tier Base's registry margin.
    const serviceMargin = serviceMarginFor(tier, baseRates.margin);
    const rates = { ...baseRates, margin: serviceMargin };
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
      tierMargin: serviceMargin,
    };
  }

  const level = req.service.level;
  const baseRates = await getInspectionRates();
  // #254 follow-up: an untiered customer prices/stamps at inspections' own
  // default margin, not tier Base's registry margin.
  const serviceMargin = serviceMarginFor(tier, baseRates.margin);
  const rates = { ...baseRates, margin: serviceMargin };
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
    tierMargin: serviceMargin,
  };
}
