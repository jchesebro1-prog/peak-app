/**
 * Address verification (spec 2026-10-09 address-verification-drive-time) —
 * shared types. Zero imports: client components import from here.
 */
export type LatLng = { lat: number; lng: number };

export type GeoStatus = "verified" | "needs_check" | "unresolved";
export const GEO_STATUSES: readonly GeoStatus[] = ["verified", "needs_check", "unresolved"];

/** Where a venue's coordinates came from: the geocoder, a hand-dropped pin,
 *  or a person supplying coordinates on a venue form / import. */
export type GeoSource = "geocode" | "pin" | "override";

/** What a Fix dialog edits: a venue row, or a place-book entry keyed by the
 *  exact normalized text (label = the text as the record holds it). */
export type FixTarget = { kind: "venue"; siteId: string } | { kind: "place"; key: string; label: string };

/** One address as the scheduler sees it. `point` is set ONLY when verified. */
export type AddressState = {
  status: GeoStatus;
  label: string;
  point: LatLng | null;
  /** "site:<siteId>" | "place:<key>" — the identity re-syncs match on. */
  pointKey: string | null;
  fix: FixTarget | null;
};

/** One place_book row (non-venue addresses). */
export type PlaceRow = {
  key: string;
  label: string;
  lat: number | null;
  lng: number | null;
  status: GeoStatus;
  source: "geocode" | "pin";
  verifiedBy: string | null;
  verifiedAt: number | null;
  updatedAt: number;
};
