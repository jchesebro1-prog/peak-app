/**
 * Address verification rules — pure (no IO, no server imports). Client code
 * imports ./types instead.
 */
import { addressKey } from "./keys";
import type { AddressState, GeoSource, GeoStatus, LatLng, PlaceRow } from "./types";
import { GEO_STATUSES } from "./types";

export function isGeoStatus(v: unknown): v is GeoStatus {
  return typeof v === "string" && (GEO_STATUSES as readonly string[]).includes(v);
}
export function isGeoSource(v: unknown): v is GeoSource {
  return v === "geocode" || v === "pin" || v === "override";
}

/** A numbered-road lead token with its digits attached: "I-94", "US-14",
 *  "WI59", "CR12", "Hwy12", "Rte9", "CO-12", and the Wisconsin forms "STH59",
 *  "CTH12", "USH14", "SH-12", "IH-35", "CT12", "ST12". The digits name the
 *  road. Only the first token is tested and only when a digit follows the
 *  prefix, so "St" as a word and plain house numbers are untouched. */
const ROAD_PREFIX_RE = /^(i|us|wi|sr|cr|hwy|rte?|co|sth|cth|ush|sh|ih|ct|st)-?\d/i;
const ORDINAL_RE = /^\d+(st|nd|rd|th)$/i;

/**
 * True only when a street line leads with a house number. The first token
 * must contain a digit ("123", "123A", Waukesha-grid "N64W23760") and must
 * not be an ordinal ("5th Ave") or the start of a numbered road ("US Highway
 * 14", "Highway 12", "County Road 12", "CR 12", "State Route 59") — those
 * digits name the road, not a building. Matches GeoSearchHit.street, which is
 * `[house_number, road].join(" ")`.
 */
export function hasHouseNumber(street: string): boolean {
  const first = String(street ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || ROAD_PREFIX_RE.test(first) || ORDINAL_RE.test(first)) return false;
  return /\d/.test(first);
}

/** A geocoder fix is building-level only when BOTH the street we asked for
 *  and the street the geocoder actually returned lead with a house number
 *  (the address text alone is not proof it found the building) and the point
 *  is usable. A usable point without that is town/street level → needs_check;
 *  no usable point → unresolved. */
export function geocodedStatus(
  askedStreet: string | null | undefined,
  hit: { street?: string | null; lat: unknown; lng: unknown }
): GeoStatus {
  if (!pointOf(hit.lat, hit.lng)) return "unresolved";
  return hasHouseNumber(t(askedStreet)) && hasHouseNumber(t(hit.street)) ? "verified" : "needs_check";
}

/** Free text has no stated city to gate on: a hit verifies only when it
 *  resolved to a house number; any other hit is town/street level. */
export function statusOfFreeTextHit(hit: { street: string } | null | undefined): GeoStatus {
  if (!hit) return "unresolved";
  return hasHouseNumber(hit.street || "") ? "verified" : "needs_check";
}

export type VenueSpot = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: string | number | null;
  lng?: string | number | null;
};

const t = (v: unknown) => String(v ?? "").trim();

/** The one place a lat/lng pair becomes a point: finite, in range, and not
 *  exactly (0,0) (the classic "no data" sentinel). Anything else is no point. */
function pointOf(lat: unknown, lng: unknown): LatLng | null {
  const ls = t(lat);
  const gs = t(lng);
  if (!ls || !gs) return null;
  const a = Number(ls);
  const b = Number(gs);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lng: b };
}

function coordsOf(row: VenueSpot): LatLng | null {
  return pointOf(row.lat, row.lng);
}

/** The one-time backfill mapping (spec): lat/lng + a house number in the
 *  street field → verified; lat/lng without one → needs_check; no usable
 *  lat/lng → unresolved. precisionOf (geo-backfill) is deliberately not used:
 *  it calls ANY non-empty address "building", so a town-level geocode of
 *  "Madison HS" or "Main St" would backfill as verified. */
export function backfillStatus(row: VenueSpot): GeoStatus {
  if (!coordsOf(row)) return "unresolved";
  return hasHouseNumber(t(row.address)) ? "verified" : "needs_check";
}

/** Stored status, else the backfill rule (a row stamped before this feature
 *  shipped reads correctly before ensureVenueGeoStatus has run). */
export function venueGeoStatus(row: VenueSpot & { geoStatus?: string | null }): GeoStatus {
  return isGeoStatus(row.geoStatus) ? row.geoStatus : backfillStatus(row);
}

export function formatVenueAddress(row: VenueSpot): string {
  return [t(row.address), t(row.city), [t(row.state), t(row.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function venueAddressState(row: VenueSpot & { id: string; geoStatus?: string | null }): AddressState {
  const stored = venueGeoStatus(row);
  const c = coordsOf(row);
  const point = stored === "verified" && c ? c : null;
  // Verified with no usable point can't be driven to: flag it, never guess.
  const effectiveStatus: GeoStatus = stored === "verified" && !point ? "unresolved" : stored;
  return {
    status: effectiveStatus,
    label: formatVenueAddress(row),
    point,
    pointKey: "site:" + row.id,
    fix: { kind: "venue", siteId: row.id },
  };
}

export function placeAddressState(text: string, row: PlaceRow | null | undefined): AddressState {
  const label = t(text);
  const key = addressKey(label);
  if (!key) return { status: "unresolved", label, point: null, pointKey: null, fix: null };
  const status: GeoStatus = row ? row.status : "unresolved";
  const point = status === "verified" && row ? pointOf(row.lat, row.lng) : null;
  const effectiveStatus: GeoStatus = status === "verified" && !point ? "unresolved" : status;
  return { status: effectiveStatus, label, point, pointKey: "place:" + key, fix: { kind: "place", key, label } };
}

export function placeRowFromHit(
  key: string,
  label: string,
  hit: { street: string; lat: number; lng: number } | null | undefined,
  now: number
): PlaceRow {
  const status = statusOfFreeTextHit(hit);
  return {
    key,
    label,
    lat: hit ? hit.lat : null,
    lng: hit ? hit.lng : null,
    status,
    source: "geocode",
    verifiedBy: null,
    verifiedAt: status === "verified" ? now : null,
    updatedAt: now,
  };
}

export type GeoStamp = {
  geoStatus: GeoStatus;
  geoSource: GeoSource | null;
  geoVerifiedBy: string | null;
  geoVerifiedAt: number | null;
};
export type StampedSpot = VenueSpot & {
  geoStatus?: string | null;
  geoSource?: string | null;
  geoVerifiedBy?: string | null;
  geoVerifiedAt?: number | null;
};

const lower = (v: unknown) => t(v).toLowerCase();

/** Same street/city/state (case-insensitive, trimmed; zip edits don't move a
 *  venue). The one comparison saveSite and geoStampForSave both use. */
export function sameVenueAddress(a: VenueSpot, b: VenueSpot): boolean {
  return lower(a.address) === lower(b.address) && lower(a.city) === lower(b.city) && lower(a.state) === lower(b.state);
}
const sameNum = (a: LatLng | null, b: LatLng | null) =>
  (!a && !b) || (!!a && !!b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7);

/**
 * The stamp saveSite writes. Same address (street/city/state compared
 * case-insensitively and trimmed; zip edits don't move a venue — note
 * venueMoveRule in venue-types.ts is case-sensitive, this is deliberately
 * not) keeps the stored stamp, and a pin keeps its coordinates even when
 * the caller sends different ones. Any address change resets verification:
 * no usable coordinates → unresolved, caller-supplied coordinates → judged
 * by whether the street line has a house number.
 */
export function geoStampForSave(
  prev: StampedSpot | null,
  next: VenueSpot,
  now: number
): { stamp: GeoStamp; keepPrevCoords: boolean } {
  const sameAddress = !!prev && sameVenueAddress(prev, next);
  const pc = prev ? coordsOf(prev) : null;
  const nc = coordsOf(next);
  const prevStamp: GeoStamp | null =
    prev && isGeoStatus(prev.geoStatus)
      ? {
          geoStatus: prev.geoStatus,
          geoSource: isGeoSource(prev.geoSource) ? prev.geoSource : null,
          geoVerifiedBy: prev.geoVerifiedBy ?? null,
          geoVerifiedAt: prev.geoVerifiedAt ?? null,
        }
      : null;
  if (prev && sameAddress && prevStamp?.geoSource === "pin" && pc) {
    return { stamp: prevStamp, keepPrevCoords: !sameNum(pc, nc) };
  }
  if (prev && sameAddress && sameNum(pc, nc)) {
    return {
      stamp: prevStamp ?? { geoStatus: backfillStatus(prev), geoSource: pc ? "geocode" : null, geoVerifiedBy: null, geoVerifiedAt: null },
      keepPrevCoords: false,
    };
  }
  if (!nc) return { stamp: { geoStatus: "unresolved", geoSource: null, geoVerifiedBy: null, geoVerifiedAt: null }, keepPrevCoords: false };
  const status = backfillStatus(next);
  return {
    stamp: { geoStatus: status, geoSource: "override", geoVerifiedBy: null, geoVerifiedAt: status === "verified" ? now : null },
    keepPrevCoords: false,
  };
}
