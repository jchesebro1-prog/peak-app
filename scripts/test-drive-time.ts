/* Address verification + automatic drive time — spec checks
   (docs/superpowers/specs/2026-10-09-address-verification-drive-time-design.md).
   Chained from test-review-and-spec.ts. Pure rules only so far; later tasks
   add the DB-backed checks here. */
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, placeBook, sites } from "@/db/schema";
import { saveSite } from "@/lib/identity/sites";
import { ensureVenueGeoStatus } from "@/lib/address-verify/venue-geo";
import { locateVenue } from "@/lib/venue-locate";
import { getPlaces, placeStatesFor, writePlace, fixPlace } from "@/lib/address-verify/place-book";
import { addressStatesForVisits, matchVisitSite } from "@/lib/address-verify/targets";
import { cleanFixInput, fixAddress, loadFixTarget } from "@/lib/address-verify/fix";
import { routeKey, searchOrThrow, type GeoSearchHit } from "@/lib/geo";
import { addDays, chicagoDayKey, chicagoDayStart, dayKeysBetween, isDayKey } from "@/lib/drive-plan/day";
import { isVisitIcsCopy, stopsForDay, visitPeople, type DriveStop, type StopSourceEvent, type StopSourceVisit } from "@/lib/drive-plan/stops";
import { dayDriveTotal, fmtDur, neededRoutes, pairKey, planDay, type PlanDayInput } from "@/lib/drive-plan/plan";
import type { AddressState } from "@/lib/address-verify/types";

import { addressKey, isPhysicalLocation } from "@/lib/address-verify/keys";
import {
  backfillStatus,
  geocodedStatus,
  hasHouseNumber,
  isValidPoint,
  geoStampForSave,
  placeAddressState,
  placeRowFromHit,
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
  ok(statusOfFreeTextHit({ street: "123 Main St" }) === "verified" && statusOfFreeTextHit({ street: "Main St" }) === "needs_check" &&
     statusOfFreeTextHit({ street: "" }) === "needs_check" && statusOfFreeTextHit(null) === "unresolved",
    "drive-time: a free-text hit verifies only with a house number; no hit → unresolved");

  ok(!hasHouseNumber("Highway 12") && !hasHouseNumber("US Highway 14") && !hasHouseNumber("5th Ave") && !hasHouseNumber("County Road 12") &&
     !hasHouseNumber("21st St") && !hasHouseNumber("State Route 59") && !hasHouseNumber("") && !hasHouseNumber("Main St"),
    "drive-time: road-only streets (numbered highways, ordinals, county/state roads) have no house number");
  ok(hasHouseNumber("123 Main St") && hasHouseNumber("N64W23760 Main St") && hasHouseNumber("123A Oak Rd") && hasHouseNumber("  45 5th Ave"),
    "drive-time: plain, lettered and Waukesha-grid house numbers count");
  ok(!hasHouseNumber("I-94") && !hasHouseNumber("US-14 Frontage Rd") && !hasHouseNumber("CR12") && !hasHouseNumber("Hwy12") && !hasHouseNumber("WI-59") && !hasHouseNumber("Rte9"),
    "drive-time: digit-bearing road lead tokens (I-94, US-14, CR12, Hwy12) are not house numbers");
  ok(!hasHouseNumber("STH59") && !hasHouseNumber("CTH12 W") && !hasHouseNumber("USH14") && !hasHouseNumber("SH-12") && !hasHouseNumber("IH-35") &&
     !hasHouseNumber("CT12") && !hasHouseNumber("STH-59 Frontage Rd") && hasHouseNumber("123 Main St") && hasHouseNumber("12 St Marys Rd") && hasHouseNumber("1 Ct St"),
    "drive-time: Wisconsin road lead tokens (STH59, CTH12, USH14, SH-12) are not house numbers; plain numbers and the word St still are");
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
  ok(geocodedStatus("605 Erie Ave", { street: "605 Erie Ave", lat: 43.7, lng: -87.7 }) === "verified" &&
     geocodedStatus("605 Erie Ave", { street: "Erie Ave", lat: 43.7, lng: -87.7 }) === "needs_check" &&
     geocodedStatus("605 Erie Ave", { street: "", lat: 43.7, lng: -87.7 }) === "needs_check" &&
     geocodedStatus("Madison HS", { street: "605 Erie Ave", lat: 43.7, lng: -87.7 }) === "needs_check" &&
     geocodedStatus("605 Erie Ave", { street: "605 Erie Ave", lat: 0, lng: 0 }) === "unresolved",
    "drive-time: a fresh geocode verifies only when the asked street AND the returned street have a house number and the point is usable");
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

export async function driveTimeVenueStampChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const ID = "TESTdrive:site-1";
  const CO = "TESTdrive:co";
  // locateVenue warms an OSRM route after a fix — keep the suite offline.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline in test");
  }) as typeof fetch;
  try {
    await saveSite({ id: ID, companyId: CO, name: "Stage", address: "605 Erie Ave", city: "Sheboygan", state: "WI", zip: "53081", lat: "43.75", lng: "-87.71", venueKind: "proscenium" });
    let [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.geoStatus === "verified" && r.geoSource === "override", "drive-time saveSite: a new building-level venue with form coords stamps verified");

    // Pin it through the Fix path, then re-save the same address with other coords.
    const pin = await locateVenue({ siteId: ID, mode: "pin", lat: 43.7512, lng: -87.7133 }, { by: "u1" });
    ok(pin.ok && pin.status === "verified", "drive-time locateVenue: a dropped pin reports verified");
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.geoSource === "pin" && r.geoVerifiedBy === "u1" && typeof r.geoVerifiedAt === "number", "drive-time locateVenue: pin stamps source/who/when");
    await saveSite({ ...r, lat: "43.1", lng: "-87.1" });
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.lat === "43.7512" && r.geoSource === "pin", "drive-time saveSite: the same address never overwrites a pin");

    // A save that omits lat/lng keys treats them as unchanged.
    await saveSite({ id: ID, companyId: CO, name: "Stage renamed", venueKind: "proscenium" });
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.geoSource === "pin" && r.lat === "43.7512", "drive-time saveSite: a partial save keeps the stamp and coords");

    // Editing the address resets verification.
    await saveSite({ ...r, address: "1 New St", lat: null, lng: null });
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.geoStatus === "unresolved" && r.geoSource === null, "drive-time saveSite: editing the address resets to unresolved");

    // A save that omits lat/lng while changing the address must not carry the
    // old point to the new address: coordinates reset, verification with them.
    await db.update(sites).set({ geoStatus: "verified", geoSource: "geocode", address: "605 Erie Ave", lat: "43.75", lng: "-87.71" }).where(eq(sites.id, ID));
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    const noCoords: Record<string, unknown> = { ...r, address: "1 New St" };
    delete noCoords.lat;
    delete noCoords.lng;
    await saveSite(noCoords as Parameters<typeof saveSite>[0]);
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.lat === null && r.lng === null && r.geoStatus === "unresolved" && r.geoSource === null,
      "drive-time saveSite: an address edit that omits lat/lng resets coordinates and verification (never verified at the old point)");

    // Backfill: only NULL rows, idempotent.
    await db.update(sites).set({ geoStatus: null, geoSource: null, address: "605 Erie Ave", lat: "43.75", lng: "-87.71" }).where(eq(sites.id, ID));
    const first = await ensureVenueGeoStatus();
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(first.stamped >= 1 && r.geoStatus === "verified" && r.geoSource === "geocode", "drive-time backfill: an unstamped building-level venue becomes verified");
    const second = await ensureVenueGeoStatus();
    ok(second.stamped === 0, "drive-time backfill: a second run stamps nothing");

    // Chunked: three unstamped rows, chunk of 2 → one call stamps all three.
    const extra = ["TESTdrive:site-b1", "TESTdrive:site-b2", "TESTdrive:site-b3"];
    try {
      for (const id of extra) {
        await saveSite({ id, companyId: CO, name: id, address: "9 Chunk St", city: "Sheboygan", state: "WI", lat: "43.75", lng: "-87.71", venueKind: "proscenium" });
        await db.update(sites).set({ geoStatus: null, geoSource: null }).where(eq(sites.id, id));
      }
      const chunked = await ensureVenueGeoStatus({ chunk: 2 });
      const left = await db.select().from(sites).where(inArray(sites.id, extra));
      ok(chunked.stamped >= 3 && left.length === 3 && left.every((x) => x.geoStatus === "verified"),
        "drive-time backfill: a call loops in chunks until the NULL rows are exhausted");
    } finally {
      await db.delete(sites).where(inArray(sites.id, extra));
    }
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(sites).where(eq(sites.id, ID));
  }
}

const hit = (street: string, lat = 44.3, lng = -88.6): GeoSearchHit => ({
  title: street, sub: street, name: "", street, city: "Hortonville", state: "WI", zip: "54944", lat, lng, display: street,
});
const fastDeps = (search: (q: string) => Promise<GeoSearchHit[]>) => ({
  search, delayMs: 0, budgetMs: 60_000, now: () => 1_790_000_000_000, sleep: async () => {},
});

export async function driveTimePlaceBookChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const realFetch = globalThis.fetch;
  try {
    // searchOrThrow: an outage throws; a real empty answer is [].
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    let threw503 = false;
    try { await searchOrThrow("TESTdrive 1 School Rd"); } catch { threw503 = true; }
    globalThis.fetch = (async () => { throw new Error("offline in test"); }) as typeof fetch;
    let threwNet = false;
    try { await searchOrThrow("TESTdrive 1 School Rd"); } catch { threwNet = true; }
    globalThis.fetch = (async () => new Response("[]", { status: 200 })) as typeof fetch;
    const empty = await searchOrThrow("TESTdrive 1 School Rd");
    globalThis.fetch = realFetch;
    ok(threw503 && threwNet && Array.isArray(empty) && empty.length === 0,
      "drive-time geo: searchOrThrow throws on an outage/error status and returns [] only for a real empty answer");

    const A = "TESTdrive 1 School Rd, Hortonville WI";
    const B = "TESTdrive Main St, Hortonville WI";
    const C = "TESTdrive Down Server Rd";
    const cache = await placeStatesFor([A], "cache");
    ok(cache.get(addressKey(A))?.status === "unresolved" && (await getPlaces([addressKey(A)])).size === 0,
      "drive-time place book: cache mode never geocodes and never writes");

    let calls = 0;
    const search = async (q: string) => {
      calls++;
      if (q.includes("Down Server")) throw new Error("Nominatim 503");
      return q.includes("1 School") ? [hit("1 School Rd")] : [hit("Main St")];
    };
    const live = await placeStatesFor([A, B, C, "  " + A.toUpperCase() + "  "], "live", fastDeps(search));
    ok(calls === 3, "drive-time place book: duplicate spellings of one key geocode once");
    ok(live.get(addressKey(A))?.status === "verified" && live.get(addressKey(A))?.point?.lat === 44.3,
      "drive-time place book: a building-level hit writes back verified");
    ok(live.get(addressKey(B))?.status === "needs_check", "drive-time place book: a street-only hit is stored needs_check");
    const rows = await getPlaces([addressKey(A), addressKey(B), addressKey(C)]);
    ok(rows.get(addressKey(B))?.status === "needs_check" && !rows.has(addressKey(C)) && live.get(addressKey(C))?.status === "unresolved",
      "drive-time place book: a geocoder outage writes nothing (unresolved for now, retried next sync)");
    calls = 0;
    await placeStatesFor([A, B], "live", fastDeps(search));
    ok(calls === 0, "drive-time place book: known keys are read from the book, not re-geocoded");

    // A typed house number is not proof: the hit's own street decides.
    const E = "TESTdrive 55 Highway Rd, Hortonville WI";
    const F = "TESTdrive 7 Frontage Rd, Hortonville WI";
    const judged = await placeStatesFor([E, F], "live", fastDeps(async (q) => (q.includes("55 Highway") ? [hit("Main St")] : [hit("US Highway 14")])));
    ok(judged.get(addressKey(E))?.status === "needs_check" && judged.get(addressKey(F))?.status === "needs_check" &&
       judged.get(addressKey(E))?.point === null,
      "drive-time place book: a hit with no real house number (street-only or a numbered road) is needs_check even when the typed text has a number");
    // A real empty answer is stored unresolved (a real "no match", not an outage).
    const G = "TESTdrive Nowhere Land";
    await placeStatesFor([G], "live", fastDeps(async () => []));
    ok((await getPlaces([addressKey(G)])).get(addressKey(G))?.status === "unresolved",
      "drive-time place book: a real empty answer is stored unresolved");

    // Pin, then a geocode write must not overwrite it.
    const pin = await fixPlace({ key: addressKey(B), label: B, mode: "pin", lat: 44.31, lng: -88.61 }, "u1", fastDeps(search));
    ok(pin.ok && pin.status === "verified", "drive-time place book: a dropped pin verifies");
    await writePlace({ ...rows.get(addressKey(B))!, lat: 1, lng: 1, status: "needs_check", source: "geocode" }, { overwritePin: false });
    const afterPin = (await getPlaces([addressKey(B)])).get(addressKey(B));
    ok(afterPin?.source === "pin" && afterPin.lat === 44.31 && afterPin.verifiedBy === "u1",
      "drive-time place book: a geocode write never overwrites a pin");
    await placeStatesFor([B], "live", fastDeps(search));
    ok((await getPlaces([addressKey(B)])).get(addressKey(B))?.source === "pin", "drive-time place book: a live pass leaves a pinned key alone");

    // Retype under the ORIGINAL key — the same text never flags again.
    const D = "TESTdrive Lone Pine School";
    const fixed = await fixPlace({ key: addressKey(D), label: D, mode: "retry", text: "1 School Rd, Hortonville WI" }, "u2", fastDeps(search));
    const dRow = (await getPlaces([addressKey(D)])).get(addressKey(D));
    ok(fixed.ok && dRow?.status === "verified" && dRow.label === D && dRow.verifiedBy === "u2",
      "drive-time place book: a retyped fix is stored under the original text's key");
    const none = await fixPlace({ key: addressKey(D), label: D, mode: "retry", text: "TESTdrive Down Server Rd" }, "u2", fastDeps(search));
    ok(!none.ok && none.reason === "unavailable" && (await getPlaces([addressKey(D)])).get(addressKey(D))?.status === "verified",
      "drive-time place book: a failed retry leaves the stored row alone");
    const noHit = await fixPlace({ key: addressKey(D), label: D, mode: "retry", text: "TESTdrive nothing here" }, "u2", fastDeps(async () => []));
    ok(!noHit.ok && noHit.reason === "no-hit", "drive-time place book: a retry with no match reports no-hit and writes nothing");
    const H = "TESTdrive Retry Street Only";
    const streetOnly = await fixPlace({ key: addressKey(H), label: H, mode: "retry", text: "12 Elm St Hortonville" }, "u2", fastDeps(async () => [hit("Elm St")]));
    const hRow = (await getPlaces([addressKey(H)])).get(addressKey(H));
    ok(streetOnly.ok && streetOnly.status === "needs_check" && hRow?.status === "needs_check" && hRow.verifiedBy === null,
      "drive-time place book: a retry judges the geocoder's returned street, not the typed text");
    const pickTown = await fixPlace({ key: addressKey(H), label: H, mode: "pick", street: "Elm St", lat: 44.2, lng: -88.5 }, "u3", fastDeps(search));
    ok(pickTown.ok && pickTown.status === "needs_check", "drive-time place book: a picked suggestion without a house number stays needs_check");
    const pickNum = await fixPlace({ key: addressKey(H), label: H, mode: "pick", street: "12 Elm St", lat: 44.2, lng: -88.5 }, "u3", fastDeps(search));
    const hRow2 = (await getPlaces([addressKey(H)])).get(addressKey(H));
    ok(pickNum.ok && pickNum.status === "verified" && hRow2?.source === "geocode" && hRow2.verifiedBy === "u3",
      "drive-time place book: a picked house-numbered suggestion verifies, credited to the picker");
    const bad = await fixPlace({ key: "Not A Key!", label: D, mode: "pin", lat: 44, lng: -88 }, "u2", fastDeps(search));
    ok(!bad.ok && bad.reason === "invalid", "drive-time place book: a key that isn't its own normalized form is refused");
    const badCoord = await fixPlace({ key: addressKey(D), label: D, mode: "pin", lat: 99, lng: -88 }, "u2", fastDeps(search));
    ok(!badCoord.ok && badCoord.reason === "invalid", "drive-time place book: an out-of-range pin is refused");
    const zeroPin = await fixPlace({ key: addressKey(D), label: D, mode: "pin", lat: 0, lng: 0 }, "u2", fastDeps(search));
    const zeroPick = await fixPlace({ key: addressKey(D), label: D, mode: "pick", street: "1 School Rd", lat: 0, lng: 0 }, "u2", fastDeps(search));
    const zeroRetry = await fixPlace({ key: addressKey(D), label: D, mode: "retry", text: "1 School Rd, Hortonville WI" }, "u2", fastDeps(async () => [hit("1 School Rd", 0, 0)]));
    const dAfterZero = (await getPlaces([addressKey(D)])).get(addressKey(D));
    ok(!zeroPin.ok && zeroPin.reason === "invalid" && !zeroPick.ok && zeroPick.reason === "invalid" && !zeroRetry.ok && zeroRetry.reason === "no-hit" &&
       dAfterZero?.lat === 44.3,
      "drive-time place book: a (0,0) pin/pick/retry point is refused and never stored");
    ok(isValidPoint(44.3, -88.6) && isValidPoint(-90, 180) && !isValidPoint(0, 0) && !isValidPoint(91, 0) && !isValidPoint(0, -181) &&
       !isValidPoint(NaN, 1) && !isValidPoint(Infinity, 1) && !isValidPoint("44", "-88") && !isValidPoint(null, null) && !isValidPoint(undefined, 1) &&
       isValidPoint(0, 1) && isValidPoint(1, 0),
      "drive-time state: isValidPoint accepts finite in-range numbers, rejects (0,0), out-of-range, NaN, strings and nulls");

    // A live hit with no usable coordinates is a hit with no point: nothing verified.
    const Z1 = "TESTdrive 3 Zero Island Rd";
    const Z2 = "TESTdrive 4 Nan Rd";
    const zs = await placeStatesFor([Z1, Z2], "live", fastDeps(async (q) => (q.includes("Zero") ? [hit("3 Zero Island Rd", 0, 0)] : [hit("4 Nan Rd", NaN, NaN)])));
    const zRows = await getPlaces([addressKey(Z1), addressKey(Z2)]);
    ok(zs.get(addressKey(Z1))?.status === "unresolved" && zs.get(addressKey(Z1))?.point === null &&
       zs.get(addressKey(Z2))?.status === "unresolved" && zs.get(addressKey(Z2))?.point === null &&
       [Z1, Z2].every((z) => { const r = zRows.get(addressKey(z)); return !r || (r.status === "unresolved" && r.lat === null && r.lng === null && r.verifiedBy === null); }),
      "drive-time place book: a live hit with unusable coordinates is never stored verified (unresolved, no point)");

    // Live pacing + budget.
    const P = ["TESTdrive Pace 1 Rd", "TESTdrive Pace 2 Rd", "TESTdrive Pace 3 Rd"];
    let slept: number[] = [];
    let searched = 0;
    const pacingSearch = async () => { searched++; return [hit("1 Pace Rd")]; };
    await placeStatesFor(P, "live", { ...fastDeps(pacingSearch), delayMs: 1100, sleep: async (ms: number) => { slept.push(ms); } });
    ok(searched === 3 && slept.length === 2 && slept.every((ms) => ms === 1100),
      "drive-time place book: a live pass sleeps the delay between geocodes (not before the first)");
    await db.delete(placeBook).where(like(placeBook.key, "testdrive pace%"));
    slept = [];
    searched = 0;
    const budgeted = await placeStatesFor(P, "live", { ...fastDeps(pacingSearch), delayMs: 1100, budgetMs: 100, sleep: async (ms: number) => { slept.push(ms); } });
    const paceRows = await getPlaces(P.map(addressKey));
    ok(searched === 1 && slept.length === 0 && paceRows.size === 1 && paceRows.has(addressKey(P[0])) &&
       budgeted.get(addressKey(P[1]))?.status === "unresolved" && budgeted.get(addressKey(P[2]))?.status === "unresolved",
      "drive-time place book: a spent budget stops the pass after the first geocode — unreached keys stay unwritten");
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(placeBook).where(like(placeBook.key, "testdrive%"));
  }
}

export async function driveTimeFixChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const SITE = "TESTdrive:site-fix";
  const CO = "TESTdrive:co-fix";
  const realFetch = globalThis.fetch;
  // Never the real Nominatim: it answers `stub` (or nothing); anything else is offline.
  let stub: { house?: string; road: string; city: string; state: string; lat: number; lng: number } | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    if (u.hostname !== "nominatim.openstreetmap.org") throw new Error("offline in test");
    const body = stub
      ? [{ lat: String(stub.lat), lon: String(stub.lng), category: "building", name: "", display_name: `${stub.city}, ${stub.state}`,
           address: { ...(stub.house ? { house_number: stub.house } : {}), road: stub.road, city: stub.city, state: stub.state } }]
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const COMPANY = "TESTdrive:co-named";
  const SITE_GONE = "TESTdrive:site-gone";
  try {
    await saveSite({ id: SITE, companyId: CO, legacyLocId: "loc7", name: "Gym", address: "", city: "Hortonville", state: "WI", lat: "44.33", lng: "-88.63", venueKind: "proscenium" });
    ok(matchVisitSite({ customerId: CO, locationId: "loc7" }, [{ id: SITE, companyId: CO, legacyLocId: "loc7" }])?.id === SITE &&
       matchVisitSite({ customerId: "other", locationId: "loc7" }, [{ id: SITE, companyId: CO, legacyLocId: "loc7" }]) === null,
      "drive-time: a visit's venue matches by legacyLocId or id, within its own company");
    const states = await addressStatesForVisits(
      [
        { id: "SV-T1", customerId: CO, locationId: "loc7", address: "ignored" },
        { id: "SV-T2", customerId: null, locationId: null, address: "TESTdrive 9 Elm St" },
        { id: "SV-T3", customerId: null, locationId: null, address: "" },
      ],
      "cache"
    );
    ok(states.get("SV-T1")?.status === "needs_check" && states.get("SV-T1")?.fix?.kind === "venue",
      "drive-time: a venue-linked visit takes the venue's state (city-level → needs_check)");
    ok(states.get("SV-T2")?.fix?.kind === "place" && states.get("SV-T2")?.status === "unresolved",
      "drive-time: a visit without a venue goes through the place book");
    ok(states.get("SV-T3")?.status === "unresolved" && states.get("SV-T3")?.fix === null, "drive-time: a visit with no address has nothing to fix");

    const r = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 44.3301, lng: -88.6302 }, "u1");
    const [row] = await db.select().from(sites).where(eq(sites.id, SITE));
    ok(r.ok && r.status === "verified" && r.pointKey === "site:" + SITE && row.geoSource === "pin",
      "drive-time fixAddress: a venue pin writes the venue (verified, source pin)");

    const pr = await fixAddress({ target: { kind: "place", key: addressKey("TESTdrive 9 Elm St"), label: "TESTdrive 9 Elm St" }, mode: "pin", lat: 44.4, lng: -88.7 }, "u1");
    const placed = (await getPlaces([addressKey("TESTdrive 9 Elm St")])).get(addressKey("TESTdrive 9 Elm St"));
    ok(pr.ok && pr.status === "verified" && pr.pointKey === "place:" + addressKey("TESTdrive 9 Elm St") && placed?.source === "pin",
      "drive-time fixAddress: a place pin writes the place book (pointKey place:<key>)");
    const afterFix = await addressStatesForVisits([{ id: "SV-T2", customerId: null, locationId: null, address: "TESTdrive 9 Elm St" }], "cache");
    ok(afterFix.get("SV-T2")?.status === "verified" && afterFix.get("SV-T2")?.point?.lat === 44.4,
      "drive-time: a fixed free-text visit address reads verified from the book");

    // ---- venue retry / pick through fixAddress (stubbed geocoder) ----
    const venueRow = async () => (await db.select().from(sites).where(eq(sites.id, SITE)))[0];
    stub = { house: "12", road: "Oak St", city: "Hortonville", state: "Wisconsin", lat: 44.35, lng: -88.64 };
    const vr = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "retry", address: "12 Oak St", city: "Hortonville", state: "WI", zip: "54944" }, "u5");
    let vrow = await venueRow();
    ok(vr.ok && vr.status === "verified" && vr.pointKey === "site:" + SITE && vrow.geoStatus === "verified" && vrow.geoSource === "geocode" &&
       vrow.geoVerifiedBy === "u5" && vrow.address === "12 Oak St" && vrow.lat === "44.35",
      "drive-time fixAddress: a venue retry that finds a house-numbered hit stores it verified (geocode, credited to the runner)");
    stub = { road: "Oak St", city: "Hortonville", state: "Wisconsin", lat: 44.36, lng: -88.65 };
    const vrStreet = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "retry", address: "12 Oak St", city: "Hortonville", state: "WI", zip: "54944" }, "u5");
    vrow = await venueRow();
    ok(vrStreet.ok && vrStreet.status === "needs_check" && vrow.geoStatus === "needs_check" && vrow.geoSource === "geocode" && vrow.geoVerifiedBy === null,
      "drive-time fixAddress: a venue retry whose hit has no house number is needs_check, credited to no one");
    stub = { house: "12", road: "Oak St", city: "Hortonville", state: "Illinois", lat: 40.1, lng: -89.1 };
    const vrWrong = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "retry", address: "12 Oak St", city: "Hortonville", state: "WI", zip: "54944" }, "u5");
    vrow = await venueRow();
    ok(!vrWrong.ok && vrWrong.reason === "state-mismatch" && vrWrong.got === "Hortonville, IL" && vrow.geoStatus === "needs_check" && vrow.lat === "44.36",
      "drive-time fixAddress: a rejected venue retry passes the reason and the returned place (got) through and writes nothing");
    stub = null;
    const vrNone = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "retry", address: "12 Oak St", city: "Hortonville", state: "WI", zip: "54944" }, "u5");
    ok(!vrNone.ok && vrNone.reason === "no-hit" && !("got" in vrNone), "drive-time fixAddress: a venue retry with no match reports no-hit with no got");

    const vp = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pick", address: "14 Elm St", city: "Hortonville", state: "WI", zip: "54944", lat: 44.5, lng: -88.5 }, "u6");
    vrow = await venueRow();
    ok(vp.ok && vp.status === "verified" && vrow.geoStatus === "verified" && vrow.geoSource === "geocode" && vrow.geoVerifiedBy === "u6" &&
       vrow.address === "14 Elm St" && vrow.lat === "44.5" && vrow.lng === "-88.5",
      "drive-time fixAddress: a venue pick of a house-numbered suggestion verifies, credited to the picker");
    const vpTown = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pick", address: "Elm St", city: "Hortonville", state: "WI", zip: "54944", lat: 44.6, lng: -88.6 }, "u7");
    vrow = await venueRow();
    ok(vpTown.ok && vpTown.status === "needs_check" && vrow.geoStatus === "needs_check" && vrow.geoVerifiedBy === null && vrow.address === "14 Elm St" && vrow.lat === "44.6",
      "drive-time fixAddress: a venue pick without a house number is needs_check and keeps the stored street");
    const vpZero = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 0, lng: 0 }, "u7");
    vrow = await venueRow();
    ok(!vpZero.ok && vpZero.reason === "invalid" && vrow.lat === "44.6", "drive-time fixAddress: a (0,0) venue pin is refused and the venue is untouched");

    // ---- place retry / pick through fixAddress ----
    const PL = "TESTdrive Lone Pine School";
    const plKey = addressKey(PL);
    const pr1 = await fixAddress({ target: { kind: "place", key: plKey, label: PL }, mode: "retry", text: "1 School Rd, Hortonville WI" }, "u8",
      fastDeps(async () => [hit("1 School Rd", 44.41, -88.71)]));
    let plRow = (await getPlaces([plKey])).get(plKey);
    ok(pr1.ok && pr1.status === "verified" && pr1.pointKey === "place:" + plKey && plRow?.source === "geocode" && plRow.verifiedBy === "u8" && plRow.label === PL && plRow.lat === 44.41,
      "drive-time fixAddress: a place retry stores under the original key, verified, credited");
    const pr2 = await fixAddress({ target: { kind: "place", key: plKey, label: PL }, mode: "pick", street: "Elm St", lat: 44.42, lng: -88.72 }, "u9", fastDeps(async () => []));
    plRow = (await getPlaces([plKey])).get(plKey);
    ok(pr2.ok && pr2.status === "needs_check" && plRow?.status === "needs_check" && plRow.source === "geocode" && plRow.verifiedBy === null && plRow.lat === 44.42,
      "drive-time fixAddress: a place pick without a house number is needs_check, credited to no one");
    const pr3 = await fixAddress({ target: { kind: "place", key: plKey, label: PL }, mode: "pick", street: "9 Elm St", lat: 44.43, lng: -88.73 }, "u9", fastDeps(async () => []));
    plRow = (await getPlaces([plKey])).get(plKey);
    ok(pr3.ok && pr3.status === "verified" && plRow?.verifiedBy === "u9" && plRow.source === "geocode",
      "drive-time fixAddress: a place pick with a house number verifies, credited to the picker");
    const prMiss = await fixAddress({ target: { kind: "place", key: plKey, label: PL }, mode: "retry", text: "nowhere at all" }, "u9", fastDeps(async () => []));
    const prDown = await fixAddress({ target: { kind: "place", key: plKey, label: PL }, mode: "retry", text: "somewhere" }, "u9", fastDeps(async () => { throw new Error("503"); }));
    ok(!prMiss.ok && prMiss.reason === "no-hit" && !prDown.ok && prDown.reason === "unavailable" && (await getPlaces([plKey])).get(plKey)?.lat === 44.43,
      "drive-time fixAddress: a place retry with no match / an outage reports why and leaves the row alone");
    const prZero = await fixAddress({ target: { kind: "place", key: plKey, label: PL }, mode: "pin", lat: 0, lng: 0 }, "u9", fastDeps(async () => []));
    ok(!prZero.ok && prZero.reason === "invalid" && (await getPlaces([plKey])).get(plKey)?.source === "geocode",
      "drive-time fixAddress: a (0,0) place pin is refused at input, not stored verified");

    // ---- loadFixTarget ----
    await db.insert(companies).values({ id: COMPANY, name: "TESTdrive Named Co", createdAt: 1, updatedAt: 1 }).onConflictDoNothing();
    await saveSite({ id: "TESTdrive:site-named", companyId: COMPANY, name: "Main Gym", address: "5 Gym Rd", city: "Hortonville", state: "WI", zip: "54944", lat: "44.3", lng: "-88.6", venueKind: "proscenium" });
    const named = await loadFixTarget({ kind: "venue", siteId: "TESTdrive:site-named" });
    ok(named?.title === "TESTdrive Named Co" && named.sub === "Main Gym" && named.href === "/companies/" + encodeURIComponent(COMPANY) &&
       named.status === "verified" && named.placeText === null &&
       named.venue?.address === "5 Gym Rd" && named.venue.city === "Hortonville" && named.venue.state === "WI" && named.venue.zip === "54944",
      "drive-time loadFixTarget: a venue shows its company, name, link, status and address fields");
    await saveSite({ id: SITE_GONE, companyId: "TESTdrive:co-nonexistent", name: "", address: "", city: "", state: "", lat: null, lng: null, venueKind: "proscenium" });
    const bare = await loadFixTarget({ kind: "venue", siteId: SITE_GONE });
    ok(bare?.title === "(unknown company)" && bare.sub === "Untitled venue" && bare.status === "unresolved" &&
       bare.venue?.address === "" && bare.venue.city === "" && bare.venue.state === "" && bare.venue.zip === "",
      "drive-time loadFixTarget: a venue with no company row or name falls back to '(unknown company)' / 'Untitled venue'");
    await db.update(sites).set({ deleted: true }).where(eq(sites.id, SITE_GONE));
    ok((await loadFixTarget({ kind: "venue", siteId: SITE_GONE })) === null && (await loadFixTarget({ kind: "venue", siteId: "TESTdrive:nope" })) === null,
      "drive-time loadFixTarget: a deleted or missing venue is null");
    const placeT = await loadFixTarget({ kind: "place", key: plKey, label: PL });
    ok(placeT?.title === PL && placeT.sub === "Address" && placeT.href === "" && placeT.venue === null && placeT.placeText === PL && placeT.status === "verified",
      "drive-time loadFixTarget: a place shows its pinned/stored row status and its text");
    const placeNew = await loadFixTarget({ kind: "place", key: addressKey("TESTdrive Never Seen"), label: "TESTdrive Never Seen" });
    ok(placeNew?.status === "unresolved", "drive-time loadFixTarget: a place with no book row reads unresolved");
    ok((await loadFixTarget({ kind: "place", key: "wrong key", label: PL })) === null && (await loadFixTarget({ kind: "place", key: "", label: "" })) === null,
      "drive-time loadFixTarget: a place key that isn't addressKey(label) is null");

    // ---- cleanFixInput ----
    const V = { kind: "venue", siteId: SITE };
    const vf = { address: "12 Oak St", city: "Hortonville", state: "WI", zip: "54944" };
    const cVr = cleanFixInput({ target: V, mode: "retry", ...vf });
    ok(cVr?.mode === "retry" && cVr.target.kind === "venue" && "address" in cVr && cVr.address === "12 Oak St" && cVr.zip === "54944",
      "drive-time cleanFixInput: a venue retry passes");
    const cVp = cleanFixInput({ target: V, mode: "pick", ...vf, lat: 44.5, lng: -88.5 });
    ok(cVp?.mode === "pick" && "lat" in cVp && cVp.lat === 44.5 && "address" in cVp && cVp.city === "Hortonville", "drive-time cleanFixInput: a venue pick passes");
    const cPr = cleanFixInput({ target: { kind: "place", key: "k", label: "L" }, mode: "retry", text: "1 School Rd" });
    ok(cPr?.mode === "retry" && cPr.target.kind === "place" && "text" in cPr && cPr.text === "1 School Rd", "drive-time cleanFixInput: a place retry passes");
    const cPp = cleanFixInput({ target: { kind: "place", key: "k", label: "L" }, mode: "pick", street: "1 School Rd", lat: 44.5, lng: -88.5 });
    ok(cPp?.mode === "pick" && "street" in cPp && cPp.street === "1 School Rd" && "lng" in cPp && cPp.lng === -88.5, "drive-time cleanFixInput: a place pick passes");
    const cTrim = cleanFixInput({ target: { kind: "venue", siteId: "  " + SITE + "  " }, mode: "retry", address: "  " + "x".repeat(400) + "  ", city: "c".repeat(200), state: "s".repeat(100), zip: "z".repeat(50) });
    ok(cTrim?.target.kind === "venue" && cTrim.target.siteId === SITE && cTrim.mode === "retry" && "address" in cTrim &&
       cTrim.address.length === 300 && cTrim.city.length === 120 && cTrim.state.length === 60 && cTrim.zip.length === 20,
      "drive-time cleanFixInput: ids are trimmed and every field is truncated to its cap");
    const cEmpty = cleanFixInput({ target: V, mode: "retry", address: "", city: "", state: "", zip: "" });
    ok(cEmpty !== null && "address" in cEmpty && cEmpty.address === "", "drive-time cleanFixInput: blank venue fields are allowed (the retry decides)");
    const cPlTrim = cleanFixInput({ target: { kind: "place", key: "k".repeat(400), label: "  L  " }, mode: "retry", text: "  " + "t".repeat(400) });
    ok(cPlTrim?.target.kind === "place" && cPlTrim.target.key.length === 300 && cPlTrim.target.label === "L" && "text" in cPlTrim && cPlTrim.text.length === 300,
      "drive-time cleanFixInput: place key/label/text are trimmed and capped");
    ok(cleanFixInput({ target: V, mode: "retry", address: "a", city: "c", state: "s" }) === null &&
       cleanFixInput({ target: V, mode: "retry", address: 1, city: "c", state: "s", zip: "z" }) === null &&
       cleanFixInput({ target: { kind: "venue", siteId: "   " }, mode: "pin", lat: 1, lng: 1 }) === null &&
       cleanFixInput({ target: { kind: "place", key: "k", label: "L" }, mode: "retry", text: "   " }) === null &&
       cleanFixInput({ target: { kind: "place", key: "k", label: "L" }, mode: "pick", lat: 1, lng: 1 }) === null &&
       cleanFixInput({ target: { kind: "place", key: "", label: "L" }, mode: "pin", lat: 1, lng: 1 }) === null &&
       cleanFixInput({ target: V, mode: "pick", ...vf, lat: "44", lng: "-88" }) === null &&
       cleanFixInput({ target: V, mode: "bogus" }) === null &&
       cleanFixInput({ mode: "pin", lat: 1, lng: 1 }) === null,
      "drive-time cleanFixInput: missing/blank/mistyped fields and an unknown mode are refused");
    ok(cleanFixInput({ target: V, mode: "pin", lat: 0, lng: 0 }) === null &&
       cleanFixInput({ target: V, mode: "pick", ...vf, lat: 0, lng: 0 }) === null &&
       cleanFixInput({ target: { kind: "place", key: "k", label: "L" }, mode: "pin", lat: 0, lng: 0 }) === null &&
       cleanFixInput({ target: { kind: "place", key: "k", label: "L" }, mode: "pick", street: "s", lat: 0, lng: 0 }) === null,
      "drive-time cleanFixInput: a (0,0) point is refused in every mode");

    ok(cleanFixInput({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 44, lng: -88 }) !== null, "drive-time cleanFixInput: a well-formed pin passes");
    ok(cleanFixInput({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 200, lng: -88 }) === null &&
       cleanFixInput({ target: { kind: "place", key: "x" }, mode: "retry" }) === null &&
       cleanFixInput({ target: { kind: "bogus" }, mode: "pin", lat: 1, lng: 1 }) === null &&
       cleanFixInput("junk") === null,
      "drive-time cleanFixInput: out-of-range coords, missing fields and unknown kinds are refused");
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(sites).where(inArray(sites.id, [SITE, SITE_GONE, "TESTdrive:site-named"]));
    await db.delete(companies).where(eq(companies.id, COMPANY));
    await db.delete(placeBook).where(like(placeBook.key, "testdrive%"));
  }
}

/* ============ Task 4: the pure drive engine ============ */
const DAY = "2026-10-14"; // a Wednesday, CDT (UTC-5)
const at = (hh: number, mm = 0) => Date.UTC(2026, 9, 14, hh + 5, mm);
const okAddr = (lat: number, lng: number, key: string): AddressState => ({ status: "verified", label: key, point: { lat, lng }, pointKey: "place:" + key, fix: null });
const badAddr = (key: string): AddressState => ({ status: "needs_check", label: key, point: null, pointKey: "place:" + key, fix: { kind: "place", key, label: key } });
const stop = (key: string, start: number, end: number, address: AddressState): DriveStop => ({ key, kind: "visit", label: key, startMs: start, endMs: end, address });
const BASE = { name: "Madison Office", lat: 43.0731, lng: -89.4012 };
const P1 = { lat: 44.0, lng: -88.0 };
const P2 = { lat: 44.5, lng: -88.5 };
function routes(...pairs: Array<[{ lat: number; lng: number }, { lat: number; lng: number }, number]>) {
  return new Map(pairs.map(([a, b, m]) => [pairKey(a, b), m]));
}
function input(over: Partial<PlanDayInput>): PlanDayInput {
  return { userId: "u1", dayKey: DAY, stops: [], base: BASE, bufferMin: 15, routeMinutes: new Map(), prevDay: { stayOver: false, lastStop: null }, stayOver: false, ...over };
}

export async function driveTimePlanChecks(ok: Ok): Promise<void> {
  // Chicago days
  ok(chicagoDayKey(Date.UTC(2026, 9, 15, 4, 30)) === "2026-10-14", "drive-time day: 23:30 CDT is still that Chicago day");
  ok(chicagoDayStart("2026-10-14") === Date.UTC(2026, 9, 14, 5) && chicagoDayStart("2026-12-01") === Date.UTC(2026, 11, 1, 6) &&
     chicagoDayStart("2026-11-01") === Date.UTC(2026, 10, 1, 5),
    "drive-time day: midnight Chicago in CDT, CST and on the fall-back day");
  ok(addDays("2026-10-31", 1) === "2026-11-01" && addDays("2026-01-01", -1) === "2025-12-31", "drive-time day: addDays crosses months and years");
  ok(dayKeysBetween(at(9), at(9) + 2 * 86_400_000).join(",") === "2026-10-14,2026-10-15,2026-10-16", "drive-time day: dayKeysBetween is inclusive");
  ok(isDayKey("2026-10-14") && !isDayKey("2026-1-4") && !isDayKey(20261014) && !isDayKey(null), "drive-time day: isDayKey accepts only YYYY-MM-DD strings");
  // DST days: the fall-back day is 25h, the spring-forward day 23h, and neither is skipped or doubled.
  ok(chicagoDayStart("2026-11-02") - chicagoDayStart("2026-11-01") === 25 * 3_600_000 &&
     chicagoDayStart("2026-03-09") - chicagoDayStart("2026-03-08") === 23 * 3_600_000 &&
     chicagoDayStart("2026-03-08") === Date.UTC(2026, 2, 8, 6) && chicagoDayStart("2026-03-09") === Date.UTC(2026, 2, 9, 5),
    "drive-time day: the fall-back day is 25h and the spring-forward day 23h");
  ok(chicagoDayKey(chicagoDayStart("2026-11-01")) === "2026-11-01" && chicagoDayKey(chicagoDayStart("2026-11-02") - 1) === "2026-11-01" &&
     chicagoDayKey(chicagoDayStart("2026-03-08")) === "2026-03-08" && chicagoDayKey(chicagoDayStart("2026-03-09") - 1) === "2026-03-08",
    "drive-time day: day start and the ms before the next start land on the right Chicago day across DST");
  ok(dayKeysBetween(Date.UTC(2026, 10, 1, 5), Date.UTC(2026, 10, 3, 18)).join(",") === "2026-11-01,2026-11-02,2026-11-03" &&
     dayKeysBetween(Date.UTC(2026, 2, 7, 20), Date.UTC(2026, 2, 9, 20)).join(",") === "2026-03-07,2026-03-08,2026-03-09" &&
     dayKeysBetween(10, 5).length === 0,
    "drive-time day: dayKeysBetween lists every day exactly once across both DST changes");
  ok(pairKey(P1, BASE) === routeKey(P1, BASE), "drive-time: pairKey is byte-identical to the geo_cache routeKey");
  ok(fmtDur(100) === "1h 40m" && fmtDur(65) === "1h 05m" && fmtDur(42) === "42m" && fmtDur(60) === "1h 00m", "drive-time: durations print as the spec's examples");

  // Stops
  ok(visitPeople({ assignedTo: "Dana", attendees: ["Jeff", "Dana", " "] }).join("|") === "Dana|Jeff" && visitPeople({ assignedTo: "" }).length === 0,
    "drive-time: visitPeople = lead + attendees, deduped (the spec-2 seam)");
  const visits: StopSourceVisit[] = [
    { id: "SV-1", label: "Lone Pine", startAt: at(9), endAt: at(10), stage: "scheduled", people: ["Dana"], address: okAddr(P1.lat, P1.lng, "a") },
    { id: "SV-2", label: "Past one", startAt: at(7), endAt: at(8), stage: "done", people: ["Dana"], address: okAddr(P2.lat, P2.lng, "b") },
    { id: "SV-3", label: "Unscheduled", startAt: null, endAt: null, stage: "claimed", people: ["Dana"], address: okAddr(1, 1, "c") },
    { id: "SV-4", label: "Someone else", startAt: at(11), endAt: at(12), stage: "scheduled", people: ["Jeff"], address: okAddr(1, 1, "d") },
    { id: "SV-5", label: "Requested w/ time", startAt: at(13), endAt: at(14), stage: "requested", people: ["Dana"], address: okAddr(1, 1, "e") },
  ];
  const ev = (id: string, over: Partial<StopSourceEvent>): StopSourceEvent => ({
    id, iCalUID: id + "@google.com", title: id, startMs: at(15), endMs: at(16), allDay: false, location: "123 Main St, Madison WI", selfDeclined: false, peakDriveKey: "", address: okAddr(43.1, -89.3, id), ...over,
  });
  const events = [
    ev("meet", {}),
    ev("allday", { allDay: true }),
    ev("noloc", { location: "" }),
    ev("zoom", { location: "https://zoom.us/j/1" }),
    ev("declined", { selfDeclined: true }),
    ev("drive", { peakDriveKey: "u1|x|a|b" }),
    ev("ics", { iCalUID: "sv-SV-1@peak-app", startMs: at(9), endMs: at(10) }),
  ];
  ok(isVisitIcsCopy({ id: "x", iCalUID: "sv-SV-1@peak-app" }, visits) && isVisitIcsCopy({ id: "g9", iCalUID: "" }, [{ id: "SV-9", googleEventId: "g9" }]) &&
     !isVisitIcsCopy({ id: "x", iCalUID: "other" }, visits), "drive-time: a visit's .ics copy (or mirrored event) is recognised");
  const stops = stopsForDay({ person: "Dana", dayKey: DAY, visits, events });
  ok(stops.map((s) => s.key).join(",") === "sv:SV-2,sv:SV-1,g:meet",
    "drive-time stops: own scheduled/done visits + timed physical events; all-day, no-location, video, declined, drive and .ics copies skipped");
  // A late-evening stop belongs to its Chicago day, not the UTC day; and a stop on another day is left out.
  const late = stopsForDay({ person: "Dana", dayKey: DAY, visits: [{ ...visits[0], id: "SV-L", startAt: at(23, 30), endAt: at(23, 59) }, { ...visits[0], id: "SV-N", startAt: at(25), endAt: at(26) }], events: [] });
  ok(late.map((s) => s.key).join(",") === "sv:SV-L", "drive-time stops: a stop is placed by its Chicago day");

  // planDay — chaining, buffer, placement
  const sA = stop("sv:A", at(9), at(10), okAddr(P1.lat, P1.lng, "A"));
  const sB = stop("sv:B", at(13), at(14), okAddr(P2.lat, P2.lng, "B"));
  const full = routes([BASE, P1, 60], [P1, P2, 40], [P2, BASE, 70]);
  const legs = planDay(input({ stops: [sB, sA], routeMinutes: full }));
  ok(legs.length === 3 && legs[0].from.kind === "base" && legs[0].to.key === "sv:A" && legs[1].to.key === "sv:B" && legs[2].to.kind === "base",
    "drive-time planDay: base → first stop → next stop → base, sorted by start");
  ok(legs[0].minutes === 75 && legs[0].endMs === at(9) && legs[0].startMs === at(9) - 75 * 60_000,
    "drive-time planDay: minutes = route + buffer; a drive-to block ends at the stop's start");
  ok(legs[2].startMs === at(14) && legs[2].endMs === at(14) + 85 * 60_000 && legs[2].direction === "back",
    "drive-time planDay: the drive-back block starts at the last stop's end");
  ok(legs[0].key === `u1|${DAY}|base|sv:A` && dayDriveTotal(legs) === 75 + 55 + 85, "drive-time planDay: leg keys + day total (buffer included)");

  // No base
  const nb = planDay(input({ stops: [sA, sB], base: null, routeMinutes: full }));
  ok(nb[0].flag?.text === "No base set" && nb[2].flag?.text === "No base set" && nb[0].minutes === null && nb[1].flag === null,
    "drive-time planDay: no base → first and last legs flagged 'No base set'");

  // Unverified end breaks the chain into and out of it
  const sBad = stop("g:bad", at(11), at(12), badAddr("bad"));
  const ub = planDay(input({ stops: [sA, sBad, sB], routeMinutes: full }));
  ok(ub[1].flag?.text === "Address not verified — no drive time" && ub[2].flag?.kind === "unverified" && ub[1].minutes === null &&
     ub[1].fix?.kind === "place" && ub[0].flag === null && ub[3].flag === null,
    "drive-time planDay: an unverified stop flags the legs into and out of it, with its Fix target");

  // Route unavailable
  const ru = planDay(input({ stops: [sA, sB], routeMinutes: routes([BASE, P1, 60]) }));
  ok(ru[1].flag?.text === "Drive time unavailable — retrying" && ru[1].startMs === null, "drive-time planDay: a missing OSRM route is flagged, never estimated");
  ok(neededRoutes(input({ stops: [sA, sB] })).length === 3, "drive-time neededRoutes: every verified pair is requested once");

  // Tight
  const sC = stop("sv:C", at(10, 30), at(11), okAddr(P2.lat, P2.lng, "C"));
  const tight = planDay(input({ stops: [sA, sC], routeMinutes: routes([BASE, P1, 60], [P1, P2, 85], [P2, BASE, 70]) }));
  ok(tight[1].tight?.text === "Tight — needs 1h 40m, has 30m" && tight[1].endMs === at(10, 30),
    "drive-time planDay: a drive-to that would start before the previous stop ends is flagged Tight; nothing moves");

  // Same location back-to-back → no leg
  const sA2 = stop("sv:A2", at(10, 15), at(11), okAddr(P1.lat, P1.lng, "A2"));
  ok(planDay(input({ stops: [sA, sA2], routeMinutes: full })).length === 2, "drive-time planDay: consecutive stops at the same point have no leg between them");

  // Stay-over, both days
  const stay = planDay(input({ stops: [sA, sB], routeMinutes: full, stayOver: true }));
  ok(stay.length === 2 && stay.every((l) => l.direction === "to_stop"), "drive-time planDay: a stay-over day has no drive-back leg");
  const next = planDay(input({ dayKey: addDays(DAY, 1), stops: [stop("sv:D", at(9) + 86_400_000, at(10) + 86_400_000, okAddr(P1.lat, P1.lng, "D"))], routeMinutes: routes([P2, P1, 40], [P1, BASE, 65]), prevDay: { stayOver: true, lastStop: sB } }));
  ok(next[0].from.kind === "prev_stop" && next[0].from.key === "sv:B" && next[0].routeMin === 40,
    "drive-time planDay: the day after a stay-over starts from that day's last stop");
  const nextBad = planDay(input({ dayKey: addDays(DAY, 1), stops: [sA], routeMinutes: full, prevDay: { stayOver: true, lastStop: sBad } }));
  ok(nextBad[0].flag?.kind === "unverified", "drive-time planDay: …and is flagged when that stop isn't verified");
  ok(planDay(input({ stops: [] })).length === 0, "drive-time planDay: a day with no stops has no legs");
}
