import { coordsOf, quoteOrigin } from "@/lib/geo";
import { getSettings } from "@/lib/settings";
import { normalizeTestingOverride } from "@/lib/service-pricing";
import type { CustomerDoc } from "@/lib/stores/customers";
import type { FlameTestVenueInput } from "@/lib/flametest-engine";
import type { InspectionVenueInput } from "@/lib/inspection-engine";

/**
 * The "venue inputs + office → engine opts" step (#246 Task 1) — a port of
 * the mapping the flame-test and inspection quote builders' `persist()` run
 * inline (src/app/(app)/flame-tests/quote/actions.ts,
 * src/app/(app)/inspections/quote/actions.ts): resolve each posted venue's
 * coords from the customer directory (falling back to the venue's saved
 * travelMiles/travelMin), and resolve the quote's office from Settings.
 *
 * This was meant to be extracted INTO the builders (one shared code path),
 * but an existing #217 test (scripts/test-review-and-spec.ts, "each venue's
 * typed testing cost is validated, priced and saved on the venue") greps the
 * builder's own source text for this exact inline mapping, so replacing it
 * with a call out to a shared helper fails that test. Per the task brief's
 * fallback ("if extraction is risky, copy and add a parity test instead"):
 * the builders are UNCHANGED, and this module is a copy used only by
 * `src/lib/portal-service-pricing.ts` (the portal's builder-identical
 * pricing). A parity test (scripts/test-review-and-spec.ts,
 * portal246PricingAsyncChecks) pins this copy against the builders' own
 * computed totals so the two can't silently drift apart undetected.
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
