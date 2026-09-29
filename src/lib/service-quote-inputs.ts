import { coordsOf, quoteOrigin } from "@/lib/geo";
import { getSettings } from "@/lib/settings";
import { LIFT_RATE_FALLBACK, LIFT_SKU, normalizeTestingOverride } from "@/lib/service-pricing";
import { getMany as getCatalogParts } from "@/lib/stores/catalog";
import type { CustomerDoc } from "@/lib/stores/customers";
import type { FlameTestVenueInput } from "@/lib/flametest-engine";
import type { InspectionVenueInput } from "@/lib/inspection-engine";

/**
 * Shared "venue inputs + office → engine opts" step (#248 Task 1, fix round
 * 1) — the flame-test and inspection quote builders' `persist()`
 * (src/app/(app)/flame-tests/quote/actions.ts,
 * src/app/(app)/inspections/quote/actions.ts) and the portal's
 * builder-identical pricing (`src/lib/portal-service-pricing.ts`) all call
 * these: resolve each posted venue's coords from the customer directory
 * (falling back to the venue's saved travelMiles/travelMin), and resolve the
 * quote's office from Settings. One code path — a builder save and a portal
 * price can never quietly drift apart.
 *
 * An earlier version of this extraction was reverted because an existing
 * #217 test greps the builder's own source text for this exact inline
 * mapping ("each venue's typed testing cost is validated, priced and saved
 * on the venue"). That test now asserts the builder calls
 * `flameVenueInputsFrom` AND that this file still carries the
 * `testingOverride: normalizeTestingOverride(v.testingOverride),` line —
 * so it keeps guarding the same invariant (per-venue testing overrides
 * flow through to the saved quote) without pinning the mapping to living
 * inline in the builder.
 */

type PostedFlameVenue = {
  id: string | null | undefined;
  label?: string | null;
  curtains: number | string | null | undefined;
  /** #217: the builder's typed Testing cell (null/absent = computed). */
  testingOverride?: number | string | null;
};

/** Port of the flame-test builder's `venues.map(...)` (persist()). */
export function flameVenueInputsFrom(
  venues: PostedFlameVenue[],
  cust: CustomerDoc | null
): FlameTestVenueInput[] {
  const locById = new Map((cust?.locations || []).map((l) => [l.id, l]));
  return venues.map((v) => {
    const loc = v.id ? locById.get(v.id) : undefined;
    const coords = loc ? coordsOf(loc) : null;
    return {
      id: v.id ?? null,
      label: v.label || loc?.label || "Venue",
      curtains: v.curtains,
      testingOverride: normalizeTestingOverride(v.testingOverride),
      coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
      oneWayMiles: loc?.travelMiles ?? null,
      oneWayMin: loc?.travelMin ?? null,
    };
  });
}

type PostedInspectionVenue = {
  id: string | null | undefined;
  label?: string | null;
  lineSets: number | string | null | undefined;
};

/** Port of the inspection builder's `venues.map(...)` (persist()). */
export function inspectionVenueInputsFrom(
  venues: PostedInspectionVenue[],
  cust: CustomerDoc | null
): Array<InspectionVenueInput & { id: string | null }> {
  const locById = new Map((cust?.locations || []).map((l) => [l.id, l]));
  return venues.map((v) => {
    const loc = v.id ? locById.get(v.id) : undefined;
    const coords = loc ? coordsOf(loc) : null;
    return {
      id: v.id || null,
      label: v.label || loc?.label || "Venue",
      lineSets: Math.max(0, Math.round(Number(v.lineSets) || 0)),
      coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
      oneWayMiles: loc?.travelMiles ?? null,
      oneWayMin: loc?.travelMin ?? null,
    };
  });
}

/** Port of both builders' `quoteOrigin(offices)` resolution. */
export async function resolveQuoteOffice() {
  const settings = await getSettings();
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  return quoteOrigin(offices);
}

/**
 * #275 — the default lift rental rate for a service quote: the live
 * `EQP-LIFT` catalog row's cost (the same row Estimator Labor prices its lift
 * from, so one edit in the Catalog moves both), else the $750 seed. A quote
 * can type its own rate; this is only the default and what renewals re-price
 * a carried lift at.
 */
export async function getLiftRate(): Promise<number> {
  const [row] = await getCatalogParts([LIFT_SKU]);
  const cost = row ? Number(row.cost) : NaN;
  return Number.isFinite(cost) && cost >= 0 ? Math.round(cost) : LIFT_RATE_FALLBACK;
}
