/**
 * Venue ↔ document matching (D101) — dependency-free.
 *
 * The crux of the Venues feature. A `sites` row has `id` ('st-<co>-<n>') AND
 * `legacyLocId` (the old 'loc1'-style id). Documents store `locationId =
 * legacyLocId ?? id` (see docLocId in identity/sites.ts and the
 * CustomerLocation.id composition in stores/customers.ts). Matching a venue on
 * `sites.id` alone silently returns empty history for every migrated venue —
 * this module makes that mistake impossible by resolving through the same
 * doc-loc id the stores use, and the spec test pins it with a regression guard.
 *
 * Fully self-contained: this module has zero imports (not even `import type`)
 * and nothing from @/db, so it stays client-safe and testable.
 */

export type VenueHistoryKind =
  | "quote"
  | "project"
  | "engagement"
  | "flame"
  | "inspection"
  | "repair"
  | "survey"
  | "visit";

export type VenueHistoryRow = {
  id: string;
  kind: VenueHistoryKind;
  title: string;
  subtitle: string;
  ts: number; // epoch-ms, for reverse-chronological sort
  status: string; // display stage/status
  open: boolean; // not closed — pulled to "Open work"
  href: string; // deep link to the record
};

/** The id documents store as `locationId` — legacy alias when present. */
export function venueDocLocId(site: { legacyLocId: string | null; id: string }): string {
  return site.legacyLocId ?? site.id;
}

/** Most stores: a record belongs to a venue iff its company + docLocId match. */
export function docMatchesVenue(
  doc: { customerId?: string | null; locationId?: string | null },
  companyId: string,
  docLocId: string,
): boolean {
  return (doc.customerId ?? null) === companyId && (doc.locationId ?? null) === docLocId;
}

/** Engagements match by companyId + siteIds (siteIds hold legacy loc ids). */
export function engagementMatchesVenue(
  e: { companyId?: string | null; siteIds?: readonly string[] },
  companyId: string,
  docLocId: string,
): boolean {
  return (e.companyId ?? null) === companyId && !!e.siteIds?.includes(docLocId);
}

/** A quote edits in its type-specific builder (system quotes in the Estimator). */
export function quoteDeepLink(quoteType: string, id: string): string {
  const q = encodeURIComponent(id);
  switch (quoteType) {
    case "flame_test":
      return `/flame-tests/quote?id=${q}`;
    case "repair":
      return `/repairs/quote?id=${q}`;
    case "inspection":
      return `/inspections/quote?id=${q}`;
    case "consulting":
      return `/design/engagements/quote?id=${q}`;
    default:
      return `/estimator?id=${q}`;
  }
}

/** Open (not-closed) stage/status values per kind. Visits are time-based, handled by the caller. */
const OPEN_STAGES: Record<Exclude<VenueHistoryKind, "visit">, readonly string[]> = {
  quote: ["draft", "sent"],
  project: ["procurement", "delivery", "scheduled", "install", "training", "signoff"], // all but "complete"
  engagement: ["active", "bid_supported"],
  flame: ["approved", "scheduled"],
  inspection: ["requested", "scheduled", "onsite"],
  repair: ["approved", "scheduled"],
  survey: ["requested", "scheduled", "onsite"],
};

export function isOpenStage(kind: Exclude<VenueHistoryKind, "visit">, stage: string): boolean {
  return OPEN_STAGES[kind].includes(stage);
}

export function sortHistoryDesc(rows: VenueHistoryRow[]): VenueHistoryRow[] {
  return [...rows].sort((a, b) => b.ts - a.ts);
}
