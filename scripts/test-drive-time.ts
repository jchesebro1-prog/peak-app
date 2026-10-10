/* Address verification + automatic drive time — spec checks
   (docs/superpowers/specs/2026-10-09-address-verification-drive-time-design.md).
   Chained from test-review-and-spec.ts. Pure rules only so far; later tasks
   add the DB-backed checks here. */
import { addressKey, isPhysicalLocation } from "@/lib/address-verify/keys";
import {
  backfillStatus,
  hasHouseNumber,
  geoStampForSave,
  placeAddressState,
  placeRowFromHit,
  statusFromPrecision,
  statusOfFreeTextHit,
  venueAddressState,
  venueGeoStatus,
} from "@/lib/address-verify/state";

export type Ok = (c: boolean, m: string) => void;

export async function driveTimeKeysChecks(ok: Ok): Promise<void> {
  ok(addressKey("  123 Main St.,  Madison, WI 53703 ") === "123 main st madison wi 53703",
    "drive-time: addressKey lowercases, strips punctuation, collapses whitespace");
  ok(addressKey("123 MAIN ST, MADISON WI 53703") === addressKey("123 main st madison, wi  53703"),
    "drive-time: two spellings differing only in case/punctuation/spacing share one key");
  ok(addressKey("123 Main St") !== addressKey("123 Main Street"), "drive-time: exact key only — no abbreviation folding");
  ok(addressKey(null) === "" && addressKey("  ,. ") === "", "drive-time: blank or punctuation-only text has no key");

  ok(isPhysicalLocation("123 Main St, Madison, WI"), "drive-time: a street address is a physical location");
  ok(isPhysicalLocation("Meeting House Rd 12, Verona WI"), "drive-time: 'Meeting' is not the word 'meet'");
  ok(!isPhysicalLocation(""), "drive-time: no location → not a stop");
  ok(!isPhysicalLocation("https://us02web.zoom.us/j/123"), "drive-time: a URL is not a stop");
  ok(!isPhysicalLocation("Zoom") && !isPhysicalLocation("Microsoft Teams Meeting") && !isPhysicalLocation("Google Meet") && !isPhysicalLocation("Webex"),
    "drive-time: Zoom/Teams/Meet/Webex mentions are not stops");
  ok(!isPhysicalLocation("meet.google.com/abc-defg-hij"), "drive-time: a bare meet.google link is not a stop");
  ok(!isPhysicalLocation("(608) 555-1212") && !isPhysicalLocation("+1 608-555-1212 x12"), "drive-time: a phone number is not a stop");
}

export async function driveTimeStateChecks(ok: Ok): Promise<void> {
  ok(statusFromPrecision("building") === "verified" && statusFromPrecision("city") === "needs_check",
    "drive-time: building-level geocode verifies; city/zip → needs_check");
  ok(statusOfFreeTextHit({ street: "123 Main St" }) === "verified" && statusOfFreeTextHit({ street: "Main St" }) === "needs_check" &&
     statusOfFreeTextHit({ street: "" }) === "needs_check" && statusOfFreeTextHit(null) === "unresolved",
    "drive-time: a free-text hit verifies only with a house number; no hit → unresolved");

  ok(!hasHouseNumber("Highway 12") && !hasHouseNumber("US Highway 14") && !hasHouseNumber("5th Ave") && !hasHouseNumber("County Road 12") &&
     !hasHouseNumber("21st St") && !hasHouseNumber("State Route 59") && !hasHouseNumber("") && !hasHouseNumber("Main St"),
    "drive-time: road-only streets (numbered highways, ordinals, county/state roads) have no house number");
  ok(hasHouseNumber("123 Main St") && hasHouseNumber("N64W23760 Main St") && hasHouseNumber("123A Oak Rd") && hasHouseNumber("  45 5th Ave"),
    "drive-time: plain, lettered and Waukesha-grid house numbers count");
  ok(statusOfFreeTextHit({ street: "US Highway 14" }) === "needs_check" && statusOfFreeTextHit({ street: "5th Ave" }) === "needs_check" &&
     statusOfFreeTextHit({ street: "N64W23760 Main St" }) === "verified",
    "drive-time: a road-only free-text hit is needs_check, not verified");

  // One-time venue backfill mapping.
  ok(backfillStatus({ address: "605 Erie Ave", lat: "43.7", lng: "-87.7" }) === "verified", "drive-time backfill: building-level lat/lng → verified");
  ok(backfillStatus({ address: "", city: "Madison", lat: "43.07", lng: "-89.4" }) === "needs_check", "drive-time backfill: city-level lat/lng → needs_check");
  ok(backfillStatus({ address: "605 Erie Ave", lat: null, lng: null }) === "unresolved" && backfillStatus({ address: "605 Erie Ave", lat: "", lng: "" }) === "unresolved",
    "drive-time backfill: null or blank lat/lng → unresolved");
  ok(backfillStatus({ address: "Madison HS", city: "Madison", lat: "43.07", lng: "-89.4" }) === "needs_check" &&
     backfillStatus({ address: "Main St", lat: "43.07", lng: "-89.4" }) === "needs_check",
    "drive-time backfill: a non-empty address with no house number is town-level → needs_check (not building)");
  ok(backfillStatus({ address: "605 Erie Ave", lat: "999", lng: "-87.7" }) === "unresolved" && backfillStatus({ address: "605 Erie Ave", lat: "43.7", lng: "-181" }) === "unresolved" &&
     backfillStatus({ address: "605 Erie Ave", lat: "0", lng: "0" }) === "unresolved" && backfillStatus({ address: "605 Erie Ave", lat: 0, lng: -87.7 }) === "verified",
    "drive-time backfill: out-of-range or exactly (0,0) coordinates are no point; a lone 0 is fine");
  ok(venueGeoStatus({ address: "605 Erie Ave", lat: "43.7", lng: "-87.7", geoStatus: "needs_check" }) === "needs_check" &&
     venueGeoStatus({ address: "605 Erie Ave", lat: "43.7", lng: "-87.7", geoStatus: null }) === "verified",
    "drive-time: a stored status wins; an unstamped row reads through the backfill rule");

  const v = venueAddressState({ id: "st-1", address: "605 Erie Ave", city: "Sheboygan", state: "WI", zip: "53081", lat: "43.75", lng: "-87.71", geoStatus: "verified" });
  ok(v.status === "verified" && v.point?.lat === 43.75 && v.pointKey === "site:st-1" && v.fix?.kind === "venue" && v.label === "605 Erie Ave, Sheboygan, WI 53081",
    "drive-time: a verified venue state carries its point, site key and venue fix target");
  const vn = venueAddressState({ id: "st-2", address: "", city: "Madison", state: "WI", lat: "43.07", lng: "-89.4", geoStatus: "needs_check" });
  ok(vn.status === "needs_check" && vn.point === null, "drive-time: only a verified state carries a point");

  const noPt = venueAddressState({ id: "st-3", address: "605 Erie Ave", city: "Sheboygan", state: "WI", lat: "", lng: "", geoStatus: "verified" });
  ok(noPt.status === "unresolved" && noPt.point === null, "drive-time: a stored-verified venue with blank coordinates downgrades to unresolved");
  const badPt = venueAddressState({ id: "st-4", address: "605 Erie Ave", lat: "999", lng: "0", geoStatus: "verified" });
  ok(badPt.status === "unresolved" && badPt.point === null, "drive-time: a stored-verified venue with out-of-range coordinates downgrades to unresolved");
  const nullPlace = placeAddressState("1 Main St X", { key: "1 main st x", label: "1 Main St X", lat: null, lng: null, status: "verified", source: "geocode", verifiedBy: null, verifiedAt: 1, updatedAt: 1 });
  ok(nullPlace.status === "unresolved" && nullPlace.point === null, "drive-time: a stored-verified place with no coordinates downgrades to unresolved");
  const zeroPlace = placeAddressState("1 Main St X", { key: "1 main st x", label: "1 Main St X", lat: 0, lng: 0, status: "verified", source: "geocode", verifiedBy: null, verifiedAt: 1, updatedAt: 1 });
  ok(zeroPlace.status === "unresolved" && zeroPlace.point === null, "drive-time: a place at exactly (0,0) is no point");
  const stampBad = geoStampForSave(null, { address: "605 Erie Ave", lat: "999", lng: "10" }, 99);
  ok(stampBad.stamp.geoStatus === "unresolved" && stampBad.stamp.geoSource === null, "drive-time: a save carrying out-of-range coordinates stamps unresolved");

  const row = placeRowFromHit("1 main st x", "1 Main St X", { street: "1 Main St", lat: 43, lng: -89 }, 1000);
  ok(row.status === "verified" && row.source === "geocode" && row.lat === 43 && row.verifiedAt === 1000 && row.verifiedBy === null,
    "drive-time: a building-level free-text hit writes back as verified (source geocode)");
  const miss = placeRowFromHit("nowhere", "Nowhere", null, 1000);
  ok(miss.status === "unresolved" && miss.lat === null && miss.verifiedAt === null, "drive-time: no hit is stored as unresolved, no coordinates");
  const ps = placeAddressState("1 Main St X", row);
  ok(ps.status === "verified" && ps.pointKey === "place:1 main st x" && ps.fix?.kind === "place" && ps.point?.lng === -89,
    "drive-time: a place state keys on the normalized text");
  ok(placeAddressState("1 Main St X", undefined).status === "unresolved" && placeAddressState("", undefined).fix === null,
    "drive-time: an unknown place is unresolved; no text → nothing to fix");

  // geoStampForSave — editing an address resets verification; a pin is never overwritten.
  const pinned = { address: "605 Erie Ave", city: "Sheboygan", state: "WI", lat: "43.7501", lng: "-87.7102", geoStatus: "verified", geoSource: "pin", geoVerifiedBy: "u1", geoVerifiedAt: 5 };
  const sameAddrNewCoords = geoStampForSave(pinned, { ...pinned, lat: "43.70", lng: "-87.70" }, 99);
  ok(sameAddrNewCoords.keepPrevCoords && sameAddrNewCoords.stamp.geoSource === "pin" && sameAddrNewCoords.stamp.geoVerifiedBy === "u1",
    "drive-time: a save with the same address never overwrites a pin's coordinates or stamp");
  const moved = geoStampForSave(pinned, { address: "1 New St", city: "Sheboygan", state: "WI", lat: null, lng: null }, 99);
  ok(!moved.keepPrevCoords && moved.stamp.geoStatus === "unresolved" && moved.stamp.geoSource === null,
    "drive-time: editing the address resets verification (no coordinates → unresolved)");
  const movedWithCoords = geoStampForSave(pinned, { address: "1 New St", city: "Sheboygan", state: "WI", lat: "43.1", lng: "-87.1" }, 99);
  ok(movedWithCoords.stamp.geoStatus === "verified" && movedWithCoords.stamp.geoSource === "override" && movedWithCoords.stamp.geoVerifiedAt === 99,
    "drive-time: a new address arriving with form coordinates is re-judged by precision (source override)");
  const untouched = geoStampForSave({ ...pinned, geoSource: "geocode" }, { ...pinned }, 99);
  ok(untouched.stamp.geoSource === "geocode" && untouched.stamp.geoVerifiedAt === 5 && !untouched.keepPrevCoords,
    "drive-time: an unchanged save keeps the stored stamp");
  const legacy = geoStampForSave({ address: "605 Erie Ave", lat: "43.7", lng: "-87.7" }, { address: "605 Erie Ave", lat: 43.7, lng: -87.7 }, 99);
  ok(legacy.stamp.geoStatus === "verified" && legacy.stamp.geoSource === "geocode",
    "drive-time: an unstamped row saved unchanged gets its backfill stamp (numeric vs text coords compare equal)");
  const fresh = geoStampForSave(null, { address: "", city: "Madison", lat: "43.07", lng: "-89.4" }, 99);
  ok(fresh.stamp.geoStatus === "needs_check" && fresh.stamp.geoVerifiedAt === null, "drive-time: a new city-level venue starts needs_check");
}
