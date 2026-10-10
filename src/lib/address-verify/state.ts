/**
 * Address verification rules — pure (no IO), server-side (imports
 * precisionOf from geo-backfill). Client code imports ./types instead.
 */
import { precisionOf } from "@/lib/geo-backfill";
import { addressKey } from "./keys";
import type { AddressState, GeoSource, GeoStatus, LatLng, PlaceRow } from "./types";
import { GEO_STATUSES } from "./types";

export function isGeoStatus(v: unknown): v is GeoStatus {
  return typeof v === "string" && (GEO_STATUSES as readonly string[]).includes(v);
}
export function isGeoSource(v: unknown): v is GeoSource {
  return v === "geocode" || v === "pin" || v === "override";
}

export function statusFromPrecision(p: "building" | "city"): GeoStatus {
  return p === "building" ? "verified" : "needs_check";
}

/** Free text has no stated city to gate on: a hit verifies only when it
 *  resolved to a house number; any other hit is town/street level. */
export function statusOfFreeTextHit(hit: { street: string } | null | undefined): GeoStatus {
  if (!hit) return "unresolved";
  return /\d/.test(hit.street || "") ? "verified" : "needs_check";
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

function coordsOf(row: VenueSpot): LatLng | null {
  const lat = t(row.lat);
  const lng = t(row.lng);
  if (!lat || !lng) return null;
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null;
}

/** The one-time backfill mapping (spec): building-level lat/lng → verified,
 *  city-level → needs_check, none → unresolved. */
export function backfillStatus(row: VenueSpot): GeoStatus {
  if (!coordsOf(row)) return "unresolved";
  return statusFromPrecision(precisionOf({ address: row.address ?? null }));
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
  const status = venueGeoStatus(row);
  const c = coordsOf(row);
  return {
    status,
    label: formatVenueAddress(row),
    point: status === "verified" && c ? c : null,
    pointKey: "site:" + row.id,
    fix: { kind: "venue", siteId: row.id },
  };
}

export function placeAddressState(text: string, row: PlaceRow | null | undefined): AddressState {
  const label = t(text);
  const key = addressKey(label);
  if (!key) return { status: "unresolved", label, point: null, pointKey: null, fix: null };
  const status: GeoStatus = row ? row.status : "unresolved";
  const point = status === "verified" && row && row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null;
  return { status: point ? "verified" : status === "verified" ? "unresolved" : status, label, point, pointKey: "place:" + key, fix: { kind: "place", key, label } };
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
const sameNum = (a: LatLng | null, b: LatLng | null) =>
  (!a && !b) || (!!a && !!b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7);

/**
 * The stamp saveSite writes. Same address (street/city/state — zip edits
 * don't move a venue, matching venueMoveRule) keeps the stored stamp, and a
 * pin keeps its coordinates even when the caller sends different ones.
 * Any address change resets verification: no coordinates → unresolved,
 * caller-supplied coordinates → judged by the address's precision.
 */
export function geoStampForSave(
  prev: StampedSpot | null,
  next: VenueSpot,
  now: number
): { stamp: GeoStamp; keepPrevCoords: boolean } {
  const sameAddress =
    !!prev && lower(prev.address) === lower(next.address) && lower(prev.city) === lower(next.city) && lower(prev.state) === lower(next.state);
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
