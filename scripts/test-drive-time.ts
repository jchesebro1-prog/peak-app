/* Address verification + automatic drive time — spec checks
   (docs/superpowers/specs/2026-10-09-address-verification-drive-time-design.md).
   Chained from test-review-and-spec.ts. Pure rules only so far; later tasks
   add the DB-backed checks here. */
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "@/db";
import { blobs, companies, placeBook, sites } from "@/db/schema";
import { saveSite } from "@/lib/identity/sites";
import { ensureVenueGeoStatus } from "@/lib/address-verify/venue-geo";
import { locateVenue } from "@/lib/venue-locate";
import { getPlaces, placeStatesFor, writePlace, fixPlace } from "@/lib/address-verify/place-book";
import { addressStatesForVisits, matchVisitSite } from "@/lib/address-verify/targets";
import { cleanFixInput, cleanFixTarget, fixAddress, loadFixTarget } from "@/lib/address-verify/fix";
import { listAddressesToVerify } from "@/lib/address-verify/worklist";
import { unverifiedVisitFlags } from "@/lib/address-verify/triage-flags";
import { recheckBackfilledVenues } from "@/lib/address-verify/venue-recheck";
import { writeVisitCalendarEvent } from "@/lib/visit-invite";
import { createFixture, dropFixtures, fixtureId } from "./test-fixtures";
import { routeKey, searchOrThrow, type GeoSearchHit } from "@/lib/geo";
import {
  DRIVE_SYNC_LEASE_MS,
  acquireDriveSyncLease,
  bufferMinFor,
  cleanBufferMin,
  driveBufferFor,
  getDriveSyncState,
  getScheduleDefaults,
  getStayOvers,
  markDriveStale,
  releaseDriveSyncLease,
  renewDriveSyncLease,
  saveScheduleDefaults,
  saveUserSchedulePrefs,
  setDriveSyncState,
  setStayOver,
} from "@/lib/stores/schedule-prefs";
import { addDays, chicagoDayKey, chicagoDayStart, dayKeysBetween, isDayKey, isStayOverDay } from "@/lib/drive-plan/day";
import { isVisitIcsCopy, stopsForDay, visitPeople, type DriveStop, type StopSourceEvent, type StopSourceVisit } from "@/lib/drive-plan/stops";
import { dayDriveTotal, fmtDur, neededRoutes, pairKey, planDay, type PlanDayInput } from "@/lib/drive-plan/plan";
import type { AddressState } from "@/lib/address-verify/types";
import { addressKey, isPhysicalLocation } from "@/lib/address-verify/keys";
import {
  backfillStatus,
  geocodedStatus,
  hasHouseNumber,
  isBackfillVerified,
  isValidPoint,
  geoStampForSave,
  placeAddressState,
  placeRowFromHit,
  statusOfFreeTextHit,
  venueAddressState,
  venueGeoStatus,
} from "@/lib/address-verify/state";

import {
  daysFullyCovered,
  desiredFromLegs,
  diffDriveEvents,
  drivePrivateProps,
  existingFromCalendar,
  isLegacyTravelBlock,
  type DesiredDriveEvent,
  type ExistingDriveEvent,
} from "@/lib/drive-sync/diff";
import { deleteEventPath, eventWriteBody, readSyncPages, toCalendarEvents, type CalendarEvent, type EventPage, type SyncCalendarEvent } from "@/lib/google/calendar";
import { planDriveDays, routeMinutesFor, visitAddressInput, type DriveLoadDeps } from "@/lib/drive-plan/load";
import {
  LEGACY_LOOKAHEAD_MS,
  driveEventWrite,
  markStaleIfTriggerFailed,
  resyncForAddress,
  resyncForVisitChange,
  syncAllDrivers,
  syncDriveDays,
  syncDriveForUser,
  syncDriveIfStale,
  syncWindowDays,
  type DriveSyncDeps,
  type DriveSyncResult,
} from "@/lib/drive-sync/sync";
import { withoutAppDriveEvents } from "@/lib/agenda";
import { driveAgendaLayer, driveItemFromLeg } from "@/lib/drive-sync/agenda";
import type { DriveSyncState } from "@/lib/stores/schedule-prefs";
import type { SiteVisit } from "@/lib/stores/site-visits";
import type { Office } from "@/lib/settings";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
  ok(statusOfFreeTextHit("123 Main St, Madison", { street: "123 Main St" }) === "verified" && statusOfFreeTextHit("123 Main St, Madison", { street: "Main St" }) === "needs_check" &&
     statusOfFreeTextHit("123 Main St, Madison", { street: "" }) === "needs_check" && statusOfFreeTextHit("123 Main St, Madison", null) === "unresolved",
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
  ok(statusOfFreeTextHit("14 Main St", { street: "US Highway 14" }) === "needs_check" && statusOfFreeTextHit("45 5th Ave", { street: "5th Ave" }) === "needs_check" &&
     statusOfFreeTextHit("N64W23760 Main St, Sussex", { street: "N64W23760 Main St" }) === "verified",
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
  search, delayMs: 0, budgetMs: 60_000, now: () => 1_790_000_000_000, sleep: async () => {}, pacer: { nextAt: 0 },
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

    // The typed text must lead with a house number too (D714 as amended): the number comes first.
    const A = "1 TESTdrive School Rd, Hortonville WI";
    const B = "TESTdrive Main St, Hortonville WI";
    const C = "TESTdrive Down Server Rd";
    const cache = await placeStatesFor([A], "cache");
    ok(cache.get(addressKey(A))?.status === "unresolved" && (await getPlaces([addressKey(A)])).size === 0,
      "drive-time place book: cache mode never geocodes and never writes");

    let calls = 0;
    const search = async (q: string) => {
      calls++;
      if (q.includes("Down Server")) throw new Error("Nominatim 503");
      return q.includes("School") ? [hit("1 School Rd")] : [hit("Main St")];
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

    // A Retry/Pick weaker than verified never downgrades a hand pin; a new pin,
    // or a Retry/Pick that verifies, still replaces it.
    const K = "TESTdrive Pinned Gate, Hortonville WI";
    const kKey = addressKey(K);
    await fixPlace({ key: kKey, label: K, mode: "pin", lat: 44.5, lng: -88.5 }, "u1", fastDeps(search));
    const kRetryWeak = await fixPlace({ key: kKey, label: K, mode: "retry", text: "Gate Rd Hortonville" }, "u2", fastDeps(async () => [hit("Gate Rd", 44.9, -88.9)]));
    const kPickWeak = await fixPlace({ key: kKey, label: K, mode: "pick", street: "Gate Rd", lat: 44.9, lng: -88.9 }, "u2", fastDeps(search));
    const kHeld = (await getPlaces([kKey])).get(kKey);
    ok(!kRetryWeak.ok && kRetryWeak.reason === "kept-pin" && !kPickWeak.ok && kPickWeak.reason === "kept-pin" &&
       kHeld?.source === "pin" && kHeld.status === "verified" && kHeld.lat === 44.5 && kHeld.verifiedBy === "u1",
      "drive-time place book: a weaker Retry or Pick never replaces a verified hand pin (kept-pin, row untouched)");
    const kRetryOk = await fixPlace({ key: kKey, label: K, mode: "retry", text: "1 Gate Rd Hortonville" }, "u2", fastDeps(async () => [hit("1 Gate Rd", 44.6, -88.6)]));
    const kAfterRetry = (await getPlaces([kKey])).get(kKey);
    ok(kRetryOk.ok && kRetryOk.status === "verified" && kAfterRetry?.source === "geocode" && kAfterRetry.lat === 44.6 && kAfterRetry.verifiedBy === "u2",
      "drive-time place book: a Retry that verifies replaces a hand pin");
    await fixPlace({ key: kKey, label: K, mode: "pin", lat: 44.5, lng: -88.5 }, "u1", fastDeps(search));
    const kPickOk = await fixPlace({ key: kKey, label: K, mode: "pick", street: "2 Gate Rd", lat: 44.7, lng: -88.7 }, "u3", fastDeps(search));
    const kAfterPick = (await getPlaces([kKey])).get(kKey);
    ok(kPickOk.ok && kAfterPick?.source === "geocode" && kAfterPick.lat === 44.7, "drive-time place book: a house-numbered Pick replaces a hand pin");
    await fixPlace({ key: kKey, label: K, mode: "pin", lat: 44.5, lng: -88.5 }, "u1", fastDeps(search));
    const kRepin = await fixPlace({ key: kKey, label: K, mode: "pin", lat: 44.55, lng: -88.55 }, "u4", fastDeps(search));
    const kAfterRepin = (await getPlaces([kKey])).get(kKey);
    ok(kRepin.ok && kAfterRepin?.lat === 44.55 && kAfterRepin.verifiedBy === "u4", "drive-time place book: a new pin replaces a hand pin");

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
    let paceClock = 1_790_000_000_000;
    await placeStatesFor(P, "live", { ...fastDeps(pacingSearch), delayMs: 1100, now: () => paceClock, sleep: async (ms: number) => { slept.push(ms); paceClock += ms; } });
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
    await db.delete(placeBook).where(like(placeBook.key, "%testdrive%"));
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

    // A weaker Retry/Pick never downgrades a hand-pinned venue; one that verifies still replaces it.
    const kpPin = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 44.7, lng: -88.7 }, "u7");
    vrow = await venueRow();
    const keptAddress = vrow.address;
    const kpPick = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pick", address: "Elm St", city: "Hortonville", state: "WI", zip: "54944", lat: 44.8, lng: -88.8 }, "u8");
    stub = { road: "Oak St", city: "Hortonville", state: "Wisconsin", lat: 44.81, lng: -88.81 };
    const kpRetry = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "retry", address: "99 Oak St", city: "Hortonville", state: "WI", zip: "54944" }, "u8");
    stub = null;
    vrow = await venueRow();
    ok(kpPin.ok && !kpPick.ok && kpPick.reason === "kept-pin" && !kpRetry.ok && kpRetry.reason === "kept-pin" &&
       vrow.geoSource === "pin" && vrow.geoStatus === "verified" && vrow.lat === "44.7" && vrow.lng === "-88.7" && vrow.address === keptAddress && vrow.geoVerifiedBy === "u7",
      "drive-time fixAddress: a weaker venue Retry or Pick never replaces a verified hand pin (kept-pin, nothing written)");
    const kpPickOk = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pick", address: "16 Elm St", city: "Hortonville", state: "WI", zip: "54944", lat: 44.9, lng: -88.9 }, "u8");
    vrow = await venueRow();
    ok(kpPickOk.ok && kpPickOk.status === "verified" && vrow.geoSource === "geocode" && vrow.lat === "44.9",
      "drive-time fixAddress: a venue Pick that verifies replaces a hand pin");
    await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 44.7, lng: -88.7 }, "u7");
    stub = { house: "99", road: "Oak St", city: "Hortonville", state: "Wisconsin", lat: 44.82, lng: -88.82 };
    const kpRetryOk = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "retry", address: "99 Oak St", city: "Hortonville", state: "WI", zip: "54944" }, "u8");
    stub = null;
    vrow = await venueRow();
    ok(kpRetryOk.ok && kpRetryOk.status === "verified" && vrow.geoSource === "geocode" && vrow.lat === "44.82",
      "drive-time fixAddress: a venue Retry that verifies replaces a hand pin");
    const kpRepin = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 44.71, lng: -88.71 }, "u9");
    vrow = await venueRow();
    ok(kpRepin.ok && vrow.geoSource === "pin" && vrow.lat === "44.71", "drive-time fixAddress: a new venue pin replaces a hand pin");

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
  ok(!isDayKey("2026-02-31") && !isDayKey("2026-13-45") && !isDayKey("2026-02-29") && !isDayKey("2026-00-10") && isDayKey("2028-02-29") && isDayKey("2026-12-31"),
    "drive-time day: isDayKey rejects impossible calendar dates");
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
  ok(ub[2].fix?.kind === "place" && ub[2].fix.key === "bad", "drive-time planDay: the leg out of an unverified stop carries that stop's Fix target");
  const sNoFix = stop("g:nofix", at(12, 30), at(12, 45), { status: "unresolved", label: "x", point: null, pointKey: null, fix: null });
  const ub2 = planDay(input({ stops: [sBad, sNoFix], routeMinutes: full }));
  ok(ub2[1].flag?.kind === "unverified" && ub2[1].fix?.kind === "place" && ub2[1].fix.key === "bad",
    "drive-time planDay: an unverified end with no Fix target falls back to the other end's");
  ok(dayDriveTotal(ub) === 75 + 85, "drive-time dayDriveTotal: flagged legs count 0, only the legs with minutes add up");

  // Route unavailable
  const ru = planDay(input({ stops: [sA, sB], routeMinutes: routes([BASE, P1, 60]) }));
  ok(ru[1].flag?.text === "Drive time unavailable — retrying" && ru[1].startMs === null, "drive-time planDay: a missing OSRM route is flagged, never estimated");
  ok(neededRoutes(input({ stops: [sA, sB] })).length === 3, "drive-time neededRoutes: every verified pair is requested once");
  const sA3 = stop("sv:A3", at(15), at(16), okAddr(P1.lat, P1.lng, "A3"));
  const sB3 = stop("sv:B3", at(17), at(18), okAddr(P2.lat, P2.lng, "B3"));
  ok(neededRoutes(input({ stops: [sA, sB, sA3, sB3] })).length === 4, "drive-time neededRoutes: a pair that repeats during the day is returned once (legs: 5, pairs: 4)");
  ok(neededRoutes(input({ stops: [sA, sBad, sB] })).length === 2, "drive-time neededRoutes: a leg with an unverified end is excluded");

  // Tight
  const sC = stop("sv:C", at(10, 30), at(11), okAddr(P2.lat, P2.lng, "C"));
  const tight = planDay(input({ stops: [sA, sC], routeMinutes: routes([BASE, P1, 60], [P1, P2, 85], [P2, BASE, 70]) }));
  ok(tight[1].tight?.text === "Tight — needs 1h 40m, has 30m" && tight[1].endMs === at(10, 30),
    "drive-time planDay: a drive-to that would start before the previous stop ends is flagged Tight; nothing moves");

  // Tight boundary: exactly enough time is not tight; one minute short is; roomy has no tight at all.
  const gap = (startB: number) => planDay(input({ stops: [sA, stop("sv:G", startB, startB + 3_600_000, okAddr(P2.lat, P2.lng, "G"))], routeMinutes: full }))[1];
  ok(gap(at(10, 55)).tight === null && gap(at(12)).tight === null, "drive-time planDay: a gap exactly equal to the drive (route + buffer) is not tight, and a roomy one has tight === null");
  ok(gap(at(10, 54)).tight?.text === "Tight — needs 55m, has 54m", "drive-time planDay: one minute short of the needed time is Tight");

  // Overlapping stops: the drive back starts after the LATEST end, and Tight compares against the latest earlier end.
  const conf = stop("g:conf", at(9), at(17), okAddr(P1.lat, P1.lng, "conf"));
  const vis = stop("sv:V", at(10), at(11), okAddr(P2.lat, P2.lng, "V"));
  const ov = planDay(input({ stops: [vis, conf], routeMinutes: full }));
  ok(ov.length === 3 && ov[1].to.key === "sv:V" && ov[2].direction === "back" && ov[2].startMs === at(17) && ov[2].endMs === at(17) + 85 * 60_000,
    "drive-time planDay: with an 8h conference overlapping a visit, the drive back starts at 17:00 (the latest end)");
  const third = stop("sv:T", at(17, 30), at(18, 30), okAddr(P1.lat, P1.lng, "T"));
  const ov3 = planDay(input({ stops: [conf, vis, third], routeMinutes: routes([BASE, P1, 60], [P1, P2, 40], [P2, P1, 45], [P1, BASE, 60]) }));
  ok(ov3[2].to.key === "sv:T" && ov3[2].from.key === "sv:V" && ov3[2].tight?.text === "Tight — needs 1h 00m, has 30m",
    "drive-time planDay: a 17:30 stop needing 60 min is Tight against the 17:00 conference end, though the visit before it ended at 11:00");
  ok(ov3[3].direction === "back" && ov3[3].startMs === at(18, 30), "drive-time planDay: …and the drive back follows the latest end (18:30)");

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
  const nextNoBase = planDay(input({ dayKey: addDays(DAY, 1), base: null, stayOver: true, stops: [stop("sv:D", at(9) + 86_400_000, at(10) + 86_400_000, okAddr(P1.lat, P1.lng, "D"))], routeMinutes: routes([P2, P1, 40]), prevDay: { stayOver: true, lastStop: sB } }));
  ok(nextNoBase.length === 1 && nextNoBase[0].flag === null && nextNoBase[0].routeMin === 40,
    "drive-time planDay: a missing base doesn't flag a leg that starts from the previous night's stop");
  ok(planDay(input({ stops: [] })).length === 0, "drive-time planDay: a day with no stops has no legs");
}

export async function driveTimePrefsChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const U = "TESTdrive:u1";
  try {
    ok(cleanBufferMin("20") === 20 && cleanBufferMin(-5) === 0 && cleanBufferMin(500) === 120 && cleanBufferMin("") === null && cleanBufferMin("x") === null,
      "drive-time prefs: buffer minutes are whole, clamped 0–120, blank = unset");
    ok(bufferMinFor({ driveBufferMin: 15 }, { driveBufferMin: null }) === 15 && bufferMinFor({ driveBufferMin: 15 }, { driveBufferMin: 0 }) === 0,
      "drive-time prefs: the company default applies until the rep sets their own (0 is a real choice)");
    const before = await getScheduleDefaults();
    ok(before.driveBufferMin >= 0, "drive-time prefs: company default reads (15 when never set)");
    await saveUserSchedulePrefs(U, { driveBufferMin: 25 });
    ok((await driveBufferFor(U)) === 25, "drive-time prefs: a rep's own buffer wins");
    await saveUserSchedulePrefs(U, { driveBufferMin: null });
    ok((await driveBufferFor(U)) === before.driveBufferMin, "drive-time prefs: clearing it falls back to the company default");

    ok(await setStayOver(U, "2026-10-14", true), "drive-time prefs: a stay-over saves");
    await setStayOver(U, "2026-10-15", true);
    await setStayOver(U, "2026-10-15", false);
    ok(!(await setStayOver(U, "Oct 14", true)), "drive-time prefs: a malformed day key is refused");
    const stays = await getStayOvers(U);
    ok(stays["2026-10-14"] === true && !("2026-10-15" in stays), "drive-time prefs: stay-overs are per date; turning one off removes it");

    await setDriveSyncState(U, { lastSyncAt: 123, legacyCleanedAt: 99 });
    await setDriveSyncState("TESTdrive:u2", { lastSyncAt: 456 });
    const markedFrom = Date.now();
    await markDriveStale([U]);
    const st = await getDriveSyncState(U);
    ok(st.lastSyncAt === 0 && st.legacyCleanedAt === 99, "drive-time prefs: markDriveStale zeroes lastSyncAt and keeps the legacy-cleanup stamp");
    ok((st.staleAt ?? 0) >= markedFrom, "drive-time prefs: markDriveStale stamps when it marked, so a sync already running can't erase it");
    const other = await getDriveSyncState("TESTdrive:u2");
    ok(other.lastSyncAt === 456 && !other.staleAt, "drive-time prefs: markDriveStale touches only the reps it names");
    await saveScheduleDefaults({ driveBufferMin: 33 });
    const bad = await saveScheduleDefaults({ driveBufferMin: "abc" });
    const blank = await saveScheduleDefaults({ driveBufferMin: "" });
    const afterRefused = (await getScheduleDefaults()).driveBufferMin;
    const good = await saveScheduleDefaults({ driveBufferMin: before.driveBufferMin });
    ok(!bad.ok && !blank.ok && afterRefused === 33 && good.ok && good.driveBufferMin === before.driveBufferMin && (await getScheduleDefaults()).driveBufferMin === before.driveBufferMin,
      "drive-time prefs: the company default refuses blank / non-numeric input with an error and keeps the stored value");

    // The per-rep sync lease: one conditional statement on the drive_sync blob row.
    const L = "TESTdrive:lease";
    const T0 = 1_000_000;
    const first = await acquireDriveSyncLease(L, T0); // no row yet → insert path
    const second = await acquireDriveSyncLease(L, T0 + 1_000);
    ok(first === T0 + DRIVE_SYNC_LEASE_MS && second === null && DRIVE_SYNC_LEASE_MS === 90_000,
      "drive-time lease: the first acquire holds the rep for 90 s; a second acquire while it's held gets nothing");
    const race = await Promise.all([acquireDriveSyncLease("TESTdrive:race", T0), acquireDriveSyncLease("TESTdrive:race", T0)]);
    ok(race.filter((t) => t !== null).length === 1, "drive-time lease: two concurrent acquires — exactly one wins");
    await setDriveSyncState(L, { lastSyncAt: 777 });
    const expired = await acquireDriveSyncLease(L, T0 + DRIVE_SYNC_LEASE_MS + 1);
    ok(expired === T0 + 2 * DRIVE_SYNC_LEASE_MS + 1 && (await getDriveSyncState(L)).lastSyncAt === 777,
      "drive-time lease: an expired lease is re-acquirable, and the lease never disturbs the sync state");
    await releaseDriveSyncLease(L, first as number); // stale token: someone else's lease now
    ok((await acquireDriveSyncLease(L, T0 + DRIVE_SYNC_LEASE_MS + 2)) === null, "drive-time lease: releasing with an old token leaves the current holder's lease alone");
    const renewed = await renewDriveSyncLease(L, expired as number, T0 + 2 * DRIVE_SYNC_LEASE_MS - 10_000);
    ok(renewed === T0 + 3 * DRIVE_SYNC_LEASE_MS - 10_000 && (await acquireDriveSyncLease(L, T0 + 2 * DRIVE_SYNC_LEASE_MS + 5_000)) === null,
      "drive-time lease: the holder renews its lease (a new token, a fresh 90 s); the rep stays held");
    ok((await renewDriveSyncLease(L, expired as number, T0 + 2 * DRIVE_SYNC_LEASE_MS)) === null,
      "drive-time lease: renewing with the old token after a renewal is refused (only the current token renews)");
    ok((await renewDriveSyncLease("TESTdrive:norow", 5, T0)) === null, "drive-time lease: renewing a lease nobody holds does nothing");
    await releaseDriveSyncLease(L, expired as number); // the old token — must not free the renewed lease
    ok((await acquireDriveSyncLease(L, T0 + 2 * DRIVE_SYNC_LEASE_MS + 6_000)) === null, "drive-time lease: releasing with the pre-renewal token leaves the renewed lease held");
    await releaseDriveSyncLease(L, renewed as number);
    ok((await acquireDriveSyncLease(L, T0 + DRIVE_SYNC_LEASE_MS + 3)) !== null, "drive-time lease: the holder's release frees the rep at once");
  } finally {
    await db.delete(blobs).where(like(blobs.id, "%TESTdrive:%"));
  }
}

export async function driveTimeDiffChecks(ok: Ok): Promise<void> {
  const sA = stop("sv:A", at(9), at(10), okAddr(P1.lat, P1.lng, "A"));
  const legs = planDay(input({ stops: [sA, stop("g:bad", at(11), at(12), badAddr("bad"))], routeMinutes: routes([BASE, P1, 60]) }));
  const desired = desiredFromLegs(legs);
  ok(desired.length === 1 && desired[0].title === "Drive to sv:A" && desired[0].endMs === at(9) && desired[0].description.includes("60 min drive + 15 min buffer"),
    "drive-time diff: only unflagged legs become Google events");

  const d = (key: string, day: string, s: number, e: number, title = "Drive to X"): DesiredDriveEvent => ({ key, dayKey: day, title, description: "", startMs: s, endMs: e });
  const x = (id: string, key: string, day: string, s: number, e: number, title = "Drive to X"): ExistingDriveEvent => ({ id, key, dayKey: day, title, startMs: s, endMs: e });
  const want = [d("k1", DAY, 1, 2), d("k2", DAY, 3, 4), d("k3", DAY, 5, 6)];
  const have = [x("e1", "k1", DAY, 1, 2), x("e2", "k2", DAY, 3, 9), x("e3", "gone", DAY, 7, 8), x("e4", "other", "2026-10-20", 1, 2), x("e5", "k1", DAY, 1, 2)];
  const diff = diffDriveEvents(want, have, new Set([DAY]));
  ok(diff.insert.map((i) => i.key).join() === "k3" && diff.update.map((u) => u.id).join() === "e2" &&
     diff.remove.map((r) => r.id).sort().join() === "e3,e5",
    "drive-time diff: insert new, update moved, delete orphans + duplicates; unchanged left alone");
  ok(!diff.remove.some((r) => r.id === "e4"), "drive-time diff: tagged events on days outside this sync are never touched");

  const cal = existingFromCalendar([
    { id: "a", title: "Drive to X", startMs: 1, endMs: 2, peakDriveKey: "u1|k", peakDriveDay: DAY },
    { id: "b", title: "Drive to X", startMs: 1, endMs: 2, peakDriveKey: "", peakDriveDay: "" },
  ], "u1");
  ok(cal.length === 1 && cal[0].id === "a", "drive-time diff: only tagged (peakDrive) events count as ours");

  const now = 1_000_000;
  const legacy = { title: "Drive to Board meeting (auto)", description: "Auto-added travel time \u2014 safe to delete or edit. Estimated 40 min from Madison.", startMs: now + 1, peakDriveKey: "" };
  ok(isLegacyTravelBlock(legacy, now), "drive-time D144: an upcoming exact-shape auto block matches");
  ok(!isLegacyTravelBlock({ ...legacy, startMs: now - 1 }, now), "drive-time D144: past blocks are left");
  ok(!isLegacyTravelBlock({ ...legacy, description: "My own note" }, now) && !isLegacyTravelBlock({ ...legacy, title: "Drive to Board meeting" }, now),
    "drive-time D144: the title AND the description prefix must both match");
  ok(!isLegacyTravelBlock({ ...legacy, peakDriveKey: "k" }, now), "drive-time D144: one of our own tagged events is never a legacy block");

  const mapped = toCalendarEvents([
    { id: "g1", summary: "Site walk", start: { dateTime: "2026-10-14T14:00:00Z" }, end: { dateTime: "2026-10-14T15:00:00Z" }, attendees: [{ email: "me@x.com", self: true, responseStatus: "declined" }] },
    { id: "g2", summary: "Drive to X", start: { dateTime: "2026-10-14T13:00:00Z" }, end: { dateTime: "2026-10-14T14:00:00Z" }, extendedProperties: { private: { peakDrive: "1", peakDriveKey: "k9", peakDriveDay: DAY } } },
    { id: "g3", summary: "Spoof", start: { dateTime: "2026-10-14T13:00:00Z" }, end: { dateTime: "2026-10-14T14:00:00Z" }, extendedProperties: { private: { peakDriveKey: "k9" } } },
  ]);
  ok(mapped[0].selfDeclined && mapped[0].peakDriveKey === "" && mapped[1].peakDriveKey === "k9" && mapped[1].peakDriveDay === DAY && mapped[2].peakDriveKey === "",
    "drive-time calendar: declined-by-me and our private drive tag are read; a key without peakDrive=1 isn't ours");
  const body = eventWriteBody({ title: "Drive to X", startMs: 1, endMs: 2, privateProps: drivePrivateProps(d("k1", DAY, 1, 2)) }) as { extendedProperties?: { private?: Record<string, string> } };
  ok(body.extendedProperties?.private?.peakDrive === "1" && body.extendedProperties.private.peakDriveKey === "k1" && body.extendedProperties.private.peakDriveDay === DAY,
    "drive-time calendar: app-written drive events carry peakDrive + leg key + day");
  ok((eventWriteBody({ title: "Mine", startMs: 1, endMs: 2 }) as { extendedProperties?: unknown }).extendedProperties === undefined,
    "drive-time calendar: ordinary event writes carry no extended properties");

  // Paged sync read: a capped read reports how far it got.
  const evItem = (id: string, hour: number) => ({ id, summary: id, description: "d-" + id, start: { dateTime: new Date(at(hour)).toISOString() }, end: { dateTime: new Date(at(hour) + 3_600_000).toISOString() } });
  const stub = (pages: number): { fetch: (t?: string) => Promise<EventPage>; calls: () => number } => {
    let n = 0;
    return {
      calls: () => n,
      fetch: async (t?: string) => {
        const i = t ? Number(t) : 0;
        n++;
        return { items: [evItem("p" + i, 1 + i)], nextPageToken: i + 1 < pages ? String(i + 1) : undefined };
      },
    };
  };
  const winMin = at(0), winMax = at(0) + 10 * 86_400_000;
  const cut = stub(5);
  const truncated = await readSyncPages(cut.fetch, { timeMinMs: winMin, timeMaxMs: winMax, maxPages: 4 });
  ok(cut.calls() === 4 && truncated.events.length === 4 && truncated.coveredThroughMs === at(4) && truncated.events[3].description === "d-p3",
    "drive-time sync read: hitting the page cap reports coveredThroughMs = start of the last event read");
  const whole = await readSyncPages(stub(2).fetch, { timeMinMs: winMin, timeMaxMs: winMax, maxPages: 4 });
  ok(whole.events.length === 2 && whole.coveredThroughMs === winMax, "drive-time sync read: a complete read covers the whole requested window");
  const exact = await readSyncPages(stub(4).fetch, { timeMinMs: winMin, timeMaxMs: winMax, maxPages: 4 });
  ok(exact.events.length === 4 && exact.coveredThroughMs === winMax, "drive-time sync read: finishing exactly on the cap is still complete");

  const d1 = DAY, d2 = addDays(DAY, 1), d3 = addDays(DAY, 2);
  ok(daysFullyCovered([d1, d2, d3], chicagoDayStart(d3)).join() === `${d1},${d2}` && daysFullyCovered([d1, d2], chicagoDayStart(d2) + 3_600_000).join() === d1 &&
     daysFullyCovered([d1, d2], chicagoDayStart(d1)).length === 0 && daysFullyCovered([d1, d2, d3], Number.MAX_SAFE_INTEGER).length === 3,
    "drive-time sync: a day is synced only when its Chicago day ends at or before the read's coverage");
}

const visit = (id: string, over: Partial<SiteVisit>): SiteVisit => ({
  id, customerId: null, customer: "Cust " + id, locationId: null, venue: "Venue " + id, address: "addr " + id, contactName: "", contactEmail: "", contactPhone: "",
  reason: "Site survey / measure", startAt: at(9), endAt: at(10), notes: "", assignedTo: "Dana", createdBy: "x", createdAt: 1, updatedAt: 1,
  stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "", ...over,
}) as SiteVisit;
const office: Office = { id: "o1", name: "Madison Office", street: "", city: "Madison", state: "WI", zip: "", lat: BASE.lat, lng: BASE.lng, quoteDefault: true };
const gEv = (id: string, over: Partial<CalendarEvent>): CalendarEvent => ({
  id, iCalUID: id + "@google.com", title: id, startMs: at(13), endMs: at(14), allDay: false, location: "1 Elm St, Appleton WI", htmlLink: "", meetingUrl: "",
  selfDeclined: false, peakDriveKey: "", peakDriveDay: "", ...over,
});
function loadDeps(over: Partial<DriveLoadDeps> = {}): Partial<DriveLoadDeps> {
  return {
    getUser: async (id) => (id === "u1" ? { id: "u1", name: "Dana", officeId: null } : null),
    offices: async () => [office],
    visits: async () => [visit("SV-1", {}), visit("SV-OTHER", { assignedTo: "Jeff" })],
    bufferMin: async () => 15,
    stayOvers: async () => ({}),
    visitStates: async (vs) => new Map(vs.map((v) => [v.id, okAddr(P1.lat, P1.lng, v.id)])),
    placeStates: async (texts) => new Map(texts.map((t) => [addressKey(t), okAddr(P2.lat, P2.lng, t)])),
    routes: async (pairs) => new Map(pairs.map((p) => [pairKey(p.from, p.to), 30])),
    ...over,
  };
}

export async function driveTimeLoaderChecks(ok: Ok): Promise<void> {
  const plans = await planDriveDays({ userId: "u1", dayKeys: [DAY], events: [gEv("meet", {}), gEv("zoom", { location: "Zoom" })], mode: "cache", deps: loadDeps() });
  ok(plans.length === 1 && plans[0].stops.map((s) => s.key).join() === "sv:SV-1,g:meet",
    "drive-time loader: the rep's own visit + their physical Google event are the stops");
  ok(plans[0].legs.length === 3 && plans[0].legs.every((l) => l.minutes === 45) && plans[0].totalMin === 135,
    "drive-time loader: base → visit → event → base, route + buffer each");
  const noOffice = await planDriveDays({ userId: "u1", dayKeys: [DAY], events: [], mode: "cache", deps: loadDeps({ offices: async () => [] }) });
  ok(noOffice[0].legs[0].flag?.text === "No base set", "drive-time loader: no office anywhere → No base set");
  const noRoutes = await planDriveDays({ userId: "u1", dayKeys: [DAY], events: [], mode: "cache", deps: loadDeps({ routes: async () => new Map() }) });
  ok(noRoutes[0].legs.every((l) => l.flag?.kind === "route_unavailable"), "drive-time loader: no cached route → 'retrying' flag, never a guess");
  let seenMode = "";
  const stays = await planDriveDays({
    userId: "u1", dayKeys: [addDays(DAY, 1)], events: [], mode: "live",
    deps: loadDeps({
      stayOvers: async () => ({ [DAY]: true }),
      visits: async () => [visit("SV-1", {}), visit("SV-2", { startAt: at(9) + 86_400_000, endAt: at(10) + 86_400_000 })],
      // Different points, or the same-place rule would drop the leg.
      visitStates: async (vs) => new Map(vs.map((v) => [v.id, v.id === "SV-1" ? okAddr(P2.lat, P2.lng, v.id) : okAddr(P1.lat, P1.lng, v.id)])),
      routes: async (pairs, mode) => { seenMode = mode; return new Map(pairs.map((p) => [pairKey(p.from, p.to), 30])); },
    }),
  });
  ok(stays[0].legs[0].from.kind === "prev_stop" && stays[0].legs[0].from.key === "sv:SV-1" && seenMode === "live",
    "drive-time loader: the previous day's stay-over + last stop are loaded; the mode reaches the route lookup");
  ok((await planDriveDays({ userId: "nobody", dayKeys: [DAY], events: null, mode: "cache", deps: loadDeps() })).length === 0,
    "drive-time loader: an unknown rep has no plan");

  // routeMinutesFor: cache only vs live
  let liveCalls = 0;
  const rdeps = {
    cached: async (keys: string[]) => new Map(keys.filter((k) => k === pairKey(BASE, P1)).map((k) => [k, { miles: 50, minutes: 60 }])),
    live: async (a: { lat: number; lng: number }) => { liveCalls++; return a.lat === P1.lat ? { miles: 30, minutes: 40 } : null; },
    delayMs: 0, budgetMs: 60_000, now: () => 0, sleep: async () => {}, pacer: { nextAt: 0 },
  };
  const pairs = [{ from: BASE, to: P1 }, { from: P1, to: P2 }, { from: P2, to: BASE }];
  const cachedOnly = await routeMinutesFor(pairs, "cache", rdeps);
  ok(cachedOnly.size === 1 && liveCalls === 0, "drive-time routes: cache mode never calls OSRM");
  const live = await routeMinutesFor(pairs, "live", rdeps);
  ok(live.get(pairKey(P1, P2)) === 40 && !live.has(pairKey(P2, BASE)) && liveCalls === 2,
    "drive-time routes: live mode routes the misses; an OSRM failure stays missing");

  // Pacing is shared: two loaders running at once never exceed 1 OSRM request / second combined.
  // Virtual time: sleeps queue timers; the driver fires the earliest once every promise has settled.
  let t = 0;
  const callTimes: number[] = [];
  const pacer = { nextAt: 0 };
  const timers: Array<{ at: number; fire: () => void }> = [];
  const paced = {
    cached: async () => new Map(),
    live: async () => { callTimes.push(t); return { miles: 1, minutes: 1 }; },
    delayMs: 1_000, budgetMs: 60_000, now: () => t,
    sleep: (ms: number) => new Promise<void>((fire) => { timers.push({ at: t + ms, fire }); }),
    pacer,
  };
  async function virtually<T>(p: Promise<T>): Promise<T> {
    let done = false;
    const run = p.finally(() => { done = true; });
    for (let guard = 0; !done && guard < 1_000; guard++) {
      await new Promise((r) => setImmediate(r));
      if (done) break;
      timers.sort((a, b) => a.at - b.at);
      const next = timers.shift();
      if (next) { t = Math.max(t, next.at); next.fire(); }
    }
    return run;
  }
  const pt = (n: number) => ({ lat: 40 + n / 100, lng: -90 });
  const pairsA = [0, 1, 2].map((n) => ({ from: pt(n), to: pt(n + 10) }));
  const pairsB = [3, 4, 5].map((n) => ({ from: pt(n), to: pt(n + 10) }));
  const [ra, rb] = await virtually(Promise.all([routeMinutesFor(pairsA, "live", paced), routeMinutesFor(pairsB, "live", paced)]));
  const sortedCalls = [...callTimes].sort((a, b) => a - b);
  ok(ra.size === 3 && rb.size === 3 && sortedCalls.length === 6 && sortedCalls.every((c, i) => i === 0 || c - sortedCalls[i - 1] >= 1_000),
    "drive-time routes: concurrent live loaders share one pace — never two OSRM requests within a second" + (sortedCalls.length ? " (" + sortedCalls.join(",") + ")" : ""));
  t = 0;
  callTimes.length = 0;
  pacer.nextAt = 50_000; // the shared queue is already 50 s deep
  const budgeted = await virtually(routeMinutesFor(pairsA, "live", { ...paced, budgetMs: 20_000 }));
  ok(budgeted.size === 0 && callTimes.length === 0 && pacer.nextAt === 50_000,
    "drive-time routes: a loader whose turn would land past its own budget skips OSRM (and doesn't take a turn)");
}

export async function driveTimeSyncChecks(ok: Ok): Promise<void> {
  const NOW = at(6); // 06:00 on DAY
  const DAY_MS = 86_400_000;
  const calls: string[] = [];
  let state: DriveSyncState = { lastSyncAt: 0, legacyCleanedAt: null };
  const tagged = (id: string, key: string, s: number, e: number, title: string, day = DAY): SyncCalendarEvent =>
    ({ ...gEv(id, { title, startMs: s, endMs: e, location: "", peakDriveKey: key, peakDriveDay: day }), description: "Drive time added by Quartzite" });
  const legKeep = `u1|${DAY}|base|sv:SV-1`;
  const events: SyncCalendarEvent[] = [
    tagged("keep", legKeep, at(9) - 45 * 60_000, at(9), "Drive to Venue SV-1"),
    tagged("orphan", `u1|${DAY}|base|sv:GONE`, at(7), at(8), "Drive to Gone"),
    tagged("far", `u1|2026-11-30|base|sv:X`, 1, 2, "Drive to X", "2026-11-30"),
    { ...gEv("mine", { title: "Lunch", location: "" }), description: "" },
    { ...gEv("legacy", { title: "Drive to Board (auto)", startMs: NOW + 3_600_000, location: "" }), description: "Auto-added travel time — safe to delete or edit." },
    { ...gEv("legacy-past", { title: "Drive to Old (auto)", startMs: NOW - 3_600_000, location: "" }), description: "Auto-added travel time — old" },
  ];
  // In-memory stand-in for the drive_sync lease (the real one is a conditional SQL update, tested in the prefs checks).
  let leaseUntil = 0;
  const fullRead = (evs: SyncCalendarEvent[]) => async (_k: string, range: { timeMinMs: number; timeMaxMs: number }) => ({ events: evs, coveredThroughMs: range.timeMaxMs });
  const deps = (over: Partial<DriveSyncDeps> = {}): Partial<DriveSyncDeps> => ({
    now: () => NOW,
    calendarKeyFor: async () => "personal:u1",
    listEvents: fullRead(events),
    insertEvent: async (_k, ev) => { calls.push("insert:" + ev.title + ":" + ev.privateProps?.peakDriveKey); return { id: "new" }; },
    updateEvent: async (_k, id) => { calls.push("update:" + id); return {}; },
    deleteEvent: async (_k, id) => { calls.push("delete:" + id); },
    plan: (a) => planDriveDays({ ...a, deps: loadDeps({ visits: async () => [visit("SV-1", {})] }) }),
    getState: async () => state,
    setState: async (_u, p) => { state = { ...state, ...p }; },
    users: async () => [{ id: "u1", name: "Dana", status: "active" }],
    visits: async () => [visit("SV-1", {})],
    visitStates: async (vs) => new Map(vs.map((v) => [v.id, okAddr(P1.lat, P1.lng, v.id)])),
    acquireLease: async (_u, nowMs) => { if (leaseUntil > nowMs) return null; leaseUntil = nowMs + 90_000; return leaseUntil; },
    renewLease: async (_u, token, nowMs) => { if (leaseUntil !== token) return null; leaseUntil = Math.max(nowMs + 90_000, token + 1); return leaseUntil; },
    releaseLease: async (_u, token) => { if (leaseUntil === token) leaseUntil = 0; },
    log: () => {},
    ...over,
  });

  ok(syncWindowDays(NOW).length === 15 && syncWindowDays(NOW)[0] === DAY && syncWindowDays(NOW)[14] === addDays(DAY, 14), "drive-time sync: window is today → +14");

  const r = await syncDriveDays("u1", [DAY], deps());
  ok(r.google === "written" && calls.includes("delete:orphan") && !calls.some((c) => c.endsWith(":far") || c === "delete:far" || c === "delete:mine" || c === "update:keep"),
    "drive-time sync: orphans deleted; untagged, unchanged and out-of-scope events untouched");
  ok(calls.filter((c) => c.startsWith("insert:")).length === 1 && calls.some((c) => c.startsWith("insert:Drive back to Madison Office:")),
    "drive-time sync: the missing drive-back leg is inserted with its leg key");
  ok(calls.includes("delete:legacy") && !calls.includes("delete:legacy-past") && r.legacyRemoved === 1 && typeof state.legacyCleanedAt === "number",
    "drive-time sync: first sync deletes upcoming D144 blocks only, then remembers it did");
  ok(calls.indexOf("delete:legacy") > calls.indexOf("delete:orphan") && calls.indexOf("delete:legacy") > calls.findIndex((c) => c.startsWith("insert:")),
    "drive-time sync: the one-time D144 scan runs after the drive writes, never between the drive read and its writes");
  ok(leaseUntil === 0, "drive-time sync: the lease is released when the sync finishes");
  calls.length = 0;
  await syncDriveDays("u1", [DAY], deps());
  ok(!calls.includes("delete:legacy"), "drive-time sync: the D144 cleanup runs once per rep");

  calls.length = 0;
  const ro = await syncDriveDays("u1", [DAY], deps({ listEvents: async () => { throw new Error("401"); } }));
  ok(ro.google === "read-failed" && calls.length === 0, "drive-time sync: a calendar read failure writes nothing");
  const app = await syncDriveDays("u1", [DAY], deps({ calendarKeyFor: async () => null }));
  ok(app.google === "no-calendar" && calls.length === 0, "drive-time sync: no connected calendar → app-only");
  const wf = await syncDriveDays("u1", [DAY], deps({ insertEvent: async () => { throw new Error("quota"); } }));
  ok(wf.errors.length >= 1 && wf.google === "written", "drive-time sync: a Google write failure is logged and counted, never thrown");
  const past = await syncDriveDays("u1", [addDays(DAY, -1), addDays(DAY, 30)], deps());
  ok(past.days.length === 0, "drive-time sync: past days and days beyond +14 are never written");

  // (a) The read window is whole Chicago days; a truncated read syncs only the days it fully saw.
  const D2 = addDays(DAY, 1);
  const ranges: Array<{ timeMinMs: number; timeMaxMs: number }> = [];
  calls.length = 0;
  const twoDays = await syncDriveDays("u1", [DAY, D2], deps({
    listEvents: async (_k, range) => {
      ranges.push(range);
      return {
        events: [tagged("orphanA", `u1|${DAY}|base|sv:GONE`, at(7), at(8), "Drive to Gone"), tagged("orphanB", `u1|${D2}|base|sv:GONE`, at(7) + DAY_MS, at(8) + DAY_MS, "Drive to Gone", D2)],
        coveredThroughMs: chicagoDayStart(D2) + 3_600_000, // cut off one hour into D2
      };
    },
    plan: (a) => planDriveDays({ ...a, deps: loadDeps({ visits: async () => [visit("SV-1", {}), visit("SV-2", { startAt: at(9) + DAY_MS, endAt: at(10) + DAY_MS })] }) }),
  }));
  ok(ranges.length === 2 && ranges.every((x) => x.timeMinMs === chicagoDayStart(addDays(DAY, -1)) && x.timeMaxMs === chicagoDayStart(addDays(D2, 1))),
    "drive-time sync: the Google read window runs from a Chicago day start (the day before, for stay-over origins) to the start of the day after the last synced day");
  ok(calls.includes("delete:orphanA") && calls.some((c) => c.includes(`|${DAY}|`)) && !calls.includes("delete:orphanB") && !calls.some((c) => c.includes(`|${D2}|`)) &&
     twoDays.errors.some((e) => e.includes("truncated")),
    "drive-time sync: a truncated read syncs only the fully covered days — no insert or delete on a day it cut off");

  // (b) A transient route failure keeps the existing event; a genuinely flagged leg loses it.
  const withLoad = (over: Partial<DriveLoadDeps>) => deps({ plan: (a) => planDriveDays({ ...a, deps: loadDeps({ visits: async () => [visit("SV-1", {})], ...over }) }) });
  calls.length = 0;
  const ru = await syncDriveDays("u1", [DAY], withLoad({ routes: async () => new Map() }));
  ok(ru.flagged === 2 && !calls.includes("delete:keep") && !calls.some((c) => c.startsWith("insert:") || c.startsWith("update:")) && calls.includes("delete:orphan"),
    "drive-time sync: a leg flagged 'retrying' (OSRM down) keeps its Google event; a leg that's gone still loses its event");
  calls.length = 0;
  await syncDriveDays("u1", [DAY], withLoad({ visitStates: async (vs) => new Map(vs.map((v) => [v.id, badAddr(v.id)])) }));
  ok(calls.includes("delete:keep"), "drive-time sync: a leg flagged unverified loses its Google event");
  calls.length = 0;
  await syncDriveDays("u1", [DAY], withLoad({ offices: async () => [] }));
  ok(calls.includes("delete:keep"), "drive-time sync: a leg flagged No base set loses its Google event");
  calls.length = 0;
  await syncDriveDays("u1", [DAY], withLoad({ visits: async () => [] }));
  ok(calls.includes("delete:keep") && calls.includes("delete:orphan"), "drive-time sync: a removed stop's legs lose their events");

  // (c) D144 cleanup reads past the 14-day window with the paged reader and stamps only after a complete read.
  const farLegacy: SyncCalendarEvent = { ...gEv("legacy-far", { title: "Drive to Expo (auto)", startMs: NOW + 120 * DAY_MS, location: "" }), description: "Auto-added travel time — x" };
  const legacyRanges: Array<{ timeMinMs: number; timeMaxMs: number }> = [];
  // The sync names its D144 scan reads explicitly (listEvents' third argument), so the fakes never guess from the range.
  const isLegacyRead = (purpose?: string) => purpose === "legacy";
  state = { lastSyncAt: 0, legacyCleanedAt: null };
  calls.length = 0;
  const paged = await syncDriveDays("u1", [DAY], deps({
    listEvents: async (_k, range, purpose) => {
      if (!isLegacyRead(purpose)) return { events, coveredThroughMs: range.timeMaxMs };
      legacyRanges.push(range);
      if (legacyRanges.length === 1) return { events: [events[4]], coveredThroughMs: NOW + 60 * DAY_MS };
      return { events: [events[4], farLegacy], coveredThroughMs: range.timeMaxMs }; // overlap re-reads "legacy"
    },
  }));
  const end180 = chicagoDayStart(addDays(DAY, LEGACY_LOOKAHEAD_MS / DAY_MS));
  ok(legacyRanges.length === 2 && legacyRanges[0].timeMinMs === chicagoDayStart(DAY) && legacyRanges[0].timeMaxMs === end180 &&
     legacyRanges[1].timeMinMs === NOW + 60 * DAY_MS && legacyRanges[1].timeMaxMs === end180,
    "drive-time sync: the D144 scan covers today → +180 days, continuing a truncated read where it stopped");
  ok(calls.filter((c) => c === "delete:legacy").length === 1 && calls.includes("delete:legacy-far") && paged.legacyRemoved === 2 && typeof state.legacyCleanedAt === "number",
    "drive-time sync: far-out D144 blocks are removed once each, then the cleanup is stamped");
  state = { lastSyncAt: 0, legacyCleanedAt: null };
  const stuck = await syncDriveDays("u1", [DAY], deps({
    listEvents: async (_k, range, purpose) => (isLegacyRead(purpose) ? { events: [], coveredThroughMs: range.timeMinMs } : { events, coveredThroughMs: range.timeMaxMs }),
  }));
  ok(state.legacyCleanedAt === null && stuck.google === "written", "drive-time sync: a D144 scan that can't finish is not stamped (retried next sync); the drive sync still runs");
  const legacyFails = await syncDriveDays("u1", [DAY], deps({
    listEvents: async (_k, range, purpose) => { if (isLegacyRead(purpose)) throw new Error("500"); return { events, coveredThroughMs: range.timeMaxMs }; },
  }));
  ok(state.legacyCleanedAt === null && legacyFails.google === "written" && legacyFails.errors.length >= 1, "drive-time sync: a failed D144 read is logged, not stamped, and blocks nothing");

  // A persistently failing D144 delete: stamped after the complete read, retried on later drive syncs, no re-scan.
  state = { lastSyncAt: 0, legacyCleanedAt: null };
  const scanRanges: Array<{ timeMinMs: number; timeMaxMs: number }> = [];
  let legacyDeleteTries = 0;
  const failingDel = deps({
    listEvents: async (_k, range, purpose) => { if (isLegacyRead(purpose)) scanRanges.push(range); return { events, coveredThroughMs: range.timeMaxMs }; },
    deleteEvent: async (_k, id) => { if (id === "legacy") { legacyDeleteTries++; throw new Error("403"); } calls.push("delete:" + id); },
  });
  const f1 = await syncDriveDays("u1", [DAY], failingDel);
  ok(typeof state.legacyCleanedAt === "number" && scanRanges.length === 1 && legacyDeleteTries === 1 && f1.errors.some((e) => e.startsWith("legacy legacy")) && !!state.legacyRetry?.legacy,
    "drive-time sync: a D144 scan that read the whole range is stamped even when a delete failed; the failed id is remembered");
  await syncDriveDays("u1", [DAY], failingDel);
  await syncDriveDays("u1", [DAY], failingDel);
  ok(scanRanges.length === 1 && legacyDeleteTries === 3 && state.legacyRetry?.legacy?.tries === 3,
    "drive-time sync: later drive syncs retry the failed D144 delete without re-running the 180-day scan");
  for (let i = 0; i < 4; i++) await syncDriveDays("u1", [DAY], failingDel);
  ok(scanRanges.length === 1 && legacyDeleteTries === 5 && !state.legacyRetry?.legacy,
    "drive-time sync: a D144 delete that keeps failing is given up after 5 tries (logged), never retried forever");
  state = { ...state, legacyRetry: { gone: { startMs: NOW + 3_600_000, tries: 1 }, old: { startMs: NOW - 1, tries: 1 } } };
  calls.length = 0;
  const retried = await syncDriveDays("u1", [DAY], deps());
  ok(calls.includes("delete:gone") && !calls.includes("delete:old") && retried.legacyRemoved === 1 && Object.keys(state.legacyRetry ?? {}).length === 0,
    "drive-time sync: a retried D144 delete that succeeds is cleared; one that has since passed is dropped, not deleted");

  // A D144 scan that hits its read cap resumes from where it stopped on the next sync.
  state = { lastSyncAt: 0, legacyCleanedAt: null };
  const capRanges: Array<{ timeMinMs: number; timeMaxMs: number }> = [];
  const crawl = deps({
    listEvents: async (_k, range, purpose) => {
      if (!isLegacyRead(purpose)) return { events, coveredThroughMs: range.timeMaxMs };
      capRanges.push(range);
      return { events: [], coveredThroughMs: range.timeMinMs + DAY_MS };
    },
  });
  await syncDriveDays("u1", [DAY], crawl);
  const cursorAfter = state.legacyCursorMs;
  await syncDriveDays("u1", [DAY], crawl);
  ok(state.legacyCleanedAt === null && capRanges.length === 20 && cursorAfter === chicagoDayStart(DAY) + 10 * DAY_MS && capRanges[10].timeMinMs === cursorAfter,
    "drive-time sync: a D144 scan cut off by its read cap is resumed from its cursor next sync, not restarted");

  // Concurrent syncs for one rep (cron + page load + visit change) never double-insert a leg.
  const cal: SyncCalendarEvent[] = [];
  const inserted: string[] = [];
  let nextId = 0;
  const calDeps = (over: Partial<DriveSyncDeps> = {}) => deps({
    listEvents: async (_k, range) => ({ events: [...cal], coveredThroughMs: range.timeMaxMs }),
    insertEvent: async (_k, ev) => {
      const id = "ins" + ++nextId;
      const key = ev.privateProps?.peakDriveKey ?? "";
      cal.push(tagged(id, key, ev.startMs, ev.endMs, ev.title, ev.privateProps?.peakDriveDay ?? DAY));
      inserted.push(key);
      return { id };
    },
    deleteEvent: async (_k, id) => { const i = cal.findIndex((e) => e.id === id); if (i >= 0) cal.splice(i, 1); },
    ...over,
  });
  const perKey = () => new Set(inserted).size === inserted.length && inserted.length === 2;
  const realPlan = (a: Parameters<DriveSyncDeps["plan"]>[0]) => planDriveDays({ ...a, deps: loadDeps({ visits: async () => [visit("SV-1", {})] }) });
  // (1a) No lease at all: the re-list right before diffing sees the other sync's inserts.
  state = { lastSyncAt: 0, legacyCleanedAt: 1 };
  const noLease = { acquireLease: async (_u: string, n: number) => n + 90_000, renewLease: async (_u: string, t: number) => t, releaseLease: async () => {} };
  let started = false;
  await syncDriveDays("u1", [DAY], calDeps({
    ...noLease,
    plan: async (a) => { if (!started) { started = true; await syncDriveDays("u1", [DAY], calDeps(noLease)); } return realPlan(a); },
  }));
  ok(perKey(), "drive-time sync: two interleaved syncs sharing one calendar insert each leg exactly once (re-list before diffing)" + " — " + inserted.join(" "));
  // (1b) With the lease: the second sync skips and leaves the rep stale; the first inserts once.
  cal.length = 0;
  inserted.length = 0;
  leaseUntil = 0;
  state = { lastSyncAt: 0, legacyCleanedAt: 1 };
  let inner: Awaited<ReturnType<typeof syncDriveDays>> | null = null;
  let innerReads = 0;
  started = false;
  await syncDriveForUser("u1", calDeps({
    plan: async (a) => {
      if (!started) {
        started = true;
        inner = await syncDriveDays("u1", [DAY], calDeps({ listEvents: async (_k, range) => { innerReads++; return { events: [...cal], coveredThroughMs: range.timeMaxMs }; } }));
      }
      return realPlan(a);
    },
  }));
  const innerRes = inner as Awaited<ReturnType<typeof syncDriveDays>> | null;
  ok(perKey() && innerRes?.google === "busy" && innerReads === 0, "drive-time sync: a second sync while the rep's lease is held skips before reading Google");
  ok(state.lastSyncAt === 0 && (state.staleAt ?? 0) >= NOW && leaseUntil === 0,
    "drive-time sync: the skipped sync leaves the rep stale (the holder can't stamp it fresh), and the holder releases the lease");
  leaseUntil = NOW + 20 * 60_000;
  state = { lastSyncAt: NOW, legacyCleanedAt: 1 };
  const held = await syncDriveIfStale("u1", deps({ now: () => NOW + 11 * 60_000 }));
  ok(held?.google === "busy" && state.lastSyncAt === 0, "drive-time sync: a stale-on-load sync that finds the lease held skips and stays stale");
  leaseUntil = NOW - 1; // expired
  calls.length = 0;
  const reAcq = await syncDriveDays("u1", [DAY], deps());
  ok(reAcq.google === "written" && calls.includes("delete:orphan") && leaseUntil === 0, "drive-time sync: an expired lease is taken over");
  leaseUntil = NOW + 10_000;
  const visitSeen: string[][] = [];
  await resyncForVisitChange(null, { startAt: at(9), assignedTo: "Dana" }, deps({ plan: async (a) => { visitSeen.push(a.dayKeys); return []; } }));
  ok(visitSeen.length === 0, "drive-time sync: a visit-change resync respects a held lease too");
  leaseUntil = 0;

  // A first read cut off mid-window plans without the later days' stops; even if the re-read got further,
  // nothing may be written for the days the FIRST read didn't cover.
  const cutDay = addDays(DAY, 1);
  const lateDay = addDays(DAY, 2);
  const cutMs = chicagoDayStart(cutDay);
  const lateTag = tagged("late", `u1|${lateDay}|base|sv:LATER`, chicagoDayStart(lateDay) + 7 * 3_600_000, chicagoDayStart(lateDay) + 8 * 3_600_000, "Drive to Later", lateDay);
  const midTag = tagged("mid", `u1|${cutDay}|base|sv:MID`, chicagoDayStart(cutDay) + 7 * 3_600_000, chicagoDayStart(cutDay) + 8 * 3_600_000, "Drive to Mid", cutDay);
  let reads = 0;
  calls.length = 0;
  leaseUntil = 0;
  state = { lastSyncAt: 0, legacyCleanedAt: 1 };
  const truncFirst = await syncDriveDays("u1", [DAY, cutDay, lateDay], deps({
    listEvents: async (_k, range) => {
      reads++;
      const evs = [midTag, lateTag];
      return reads === 1 ? { events: [], coveredThroughMs: cutMs } : { events: evs, coveredThroughMs: range.timeMaxMs };
    },
  }));
  ok(reads === 2 && truncFirst.google === "written" && !calls.some((c) => c === "delete:late" || c === "delete:mid") &&
     !calls.some((c) => c.includes(`|${cutDay}|`) || c.includes(`|${lateDay}|`)) && truncFirst.errors.some((e) => e.includes("truncated")),
    "drive-time sync: a first read cut off at day 2 and a complete re-read writes nothing on day 2 or later (the planner never saw those stops)" + " — " + calls.join(" "));
  // Positive control: the day both reads DID cover still gets its inserts, so the assertion above isn't passing because nothing is written at all.
  ok(calls.some((c) => c.startsWith("insert:") && c.includes(`|${DAY}|`)),
    "drive-time sync: the day a cut-off first read did cover still gets its drive events inserted" + " — " + calls.join(" "));

  // The legacy phase needs lease time left: renew when < 30 s remain; skip the phase if renewal fails.
  // Slow Google writes: the first insert eats `advance` ms of the lease (after the pre-write renewal), then runs `then`.
  const slowInsert = (clockRef: { t: number }, advance: number, then?: () => void): Partial<DriveSyncDeps> => {
    let slowed = false;
    return { insertEvent: async (_k, ev) => { if (!slowed) { slowed = true; clockRef.t += advance; then?.(); } calls.push("insert:" + ev.title + ":" + ev.privateProps?.peakDriveKey); return { id: "new" }; } };
  };
  const clk = { t: NOW };
  leaseUntil = 0;
  state = { lastSyncAt: 0, legacyCleanedAt: null };
  calls.length = 0;
  let renewals = 0;
  const renewing = await syncDriveDays("u1", [DAY], deps({
    now: () => clk.t,
    ...slowInsert(clk, 70_000),
    renewLease: async (u, t, n) => { renewals++; return (await deps().renewLease!(u, t, n)); },
  }));
  ok(renewals === 2 && renewing.legacyRemoved === 1 && typeof state.legacyCleanedAt === "number" && leaseUntil === 0,
    "drive-time sync: with under 30 s of lease left after the writes the sync renews again before the D144 phase, runs the phase, and releases the renewed lease");
  clk.t = NOW;
  leaseUntil = 0;
  state = { lastSyncAt: 0, legacyCleanedAt: null };
  calls.length = 0;
  renewals = 0;
  await syncDriveDays("u1", [DAY], deps({ now: () => clk.t, renewLease: async (u, t, n) => { renewals++; return (await deps().renewLease!(u, t, n)); } }));
  ok(renewals === 1 && calls.includes("delete:legacy"), "drive-time sync: a lease with plenty of time left is renewed once (before the writes), not again before the D144 phase");
  clk.t = NOW;
  leaseUntil = 0;
  state = { lastSyncAt: 0, legacyCleanedAt: null };
  calls.length = 0;
  let takeRenewals = 0;
  const takenOver = await syncDriveDays("u1", [DAY], deps({
    now: () => clk.t,
    ...slowInsert(clk, 70_000),
    // The pre-write renewal succeeds; by the D144 phase another sync has taken the rep over (our lease ran out), so that renewal fails.
    renewLease: async (u, t, n) => (++takeRenewals === 1 ? deps().renewLease!(u, t, n) : null),
  }));
  ok(!calls.includes("delete:legacy") && takenOver.legacyRemoved === 0 && state.legacyCleanedAt === null && takenOver.google === "written" && takenOver.errors.some((e) => e.includes("lease")),
    "drive-time sync: when the lease can't be renewed (another sync took over) the D144 phase is skipped this run and left to resume");
  clk.t = NOW;
  leaseUntil = 0;
  state = { lastSyncAt: 0, legacyCleanedAt: null };
  calls.length = 0;
  await syncDriveDays("u1", [DAY], deps({
    now: () => clk.t,
    ...slowInsert(clk, 70_000, () => { leaseUntil = clk.t + 90_000; /* a newer sync now holds it */ }),
  }));
  ok(!calls.includes("delete:legacy") && leaseUntil !== 0, "drive-time sync: a takeover is respected end to end — the D144 phase is skipped and the new holder's lease is not released by us");
  leaseUntil = 0;

  // The lease is verified right before the first Google write: lost → no writes at all, the rep stays stale.
  clk.t = NOW;
  state = { lastSyncAt: 0, legacyCleanedAt: null };
  calls.length = 0;
  // (renewLease refusing = another sync has taken the rep over since we acquired it)
  const lostBefore = await syncDriveDays("u1", [DAY], deps({ renewLease: async () => null }));
  ok(calls.length === 0 && lostBefore.google === "busy" && lostBefore.inserted === 0 && lostBefore.removed === 0 && state.legacyCleanedAt === null &&
     state.lastSyncAt === 0 && (state.staleAt ?? 0) >= NOW && lostBefore.errors.some((e) => e.includes("lease")),
    "drive-time sync: a lease lost between the plan and the first write skips every write (and the D144 phase) and leaves the rep stale" + " — " + calls.join(" "));
  const winWindow = await syncDriveForUser("u1", deps({ renewLease: async () => null }));
  ok(winWindow.google === "busy" && state.lastSyncAt === 0, "drive-time sync: a full sync that lost its lease is not stamped fresh");
  leaseUntil = 0;
  calls.length = 0;
  let writeRenewals = 0;
  const renewedBefore = await syncDriveDays("u1", [DAY], deps({ renewLease: async (u, t, n) => { writeRenewals++; calls.push("renew"); return deps().renewLease!(u, t, n); } }));
  ok(renewedBefore.google === "written" && writeRenewals >= 1 && calls[0] === "renew" && calls.findIndex((c) => c.startsWith("insert:")) > 0,
    "drive-time sync: the lease is renewed before the first insert / update / delete");
  leaseUntil = 0;

  state = { lastSyncAt: NOW - 60_000, legacyCleanedAt: 1 };
  ok((await syncDriveIfStale("u1", deps())) === null, "drive-time sync: a sync under 10 min old is not repeated");
  state = { lastSyncAt: NOW - 11 * 60_000, legacyCleanedAt: 1 };
  const stale = await syncDriveIfStale("u1", deps());
  ok(!!stale && stale.days.length === 15 && state.lastSyncAt === NOW, "drive-time sync: a stale rep re-syncs the whole window and is stamped");

  // (e) A stale mark made while a sync runs survives that sync's lastSyncAt write.
  let clock = NOW;
  const markDuring = (over: Partial<DriveSyncDeps> = {}) => deps({
    now: () => clock,
    plan: async () => { clock += 5_000; state = { ...state, lastSyncAt: 0, staleAt: clock }; return []; },
    ...over,
  });
  state = { lastSyncAt: 0, legacyCleanedAt: 1 };
  await syncDriveForUser("u1", markDuring());
  ok(state.lastSyncAt === 0, "drive-time sync: a stale mark made during a full sync keeps the rep stale");
  clock = NOW;
  state = { lastSyncAt: NOW - 11 * 60_000, legacyCleanedAt: 1 };
  await syncDriveIfStale("u1", markDuring());
  ok(state.lastSyncAt === 0, "drive-time sync: a stale mark made during a stale-on-load sync survives the claim + stamp");
  clock = NOW;
  state = { lastSyncAt: 0, legacyCleanedAt: 1, staleAt: NOW - 1_000 };
  await syncDriveForUser("u1", deps({ now: () => clock }));
  ok(state.lastSyncAt === NOW, "drive-time sync: a stale mark from before the sync started is cleared by it");

  const seen: string[][] = [];
  await resyncForVisitChange(
    { startAt: at(9), assignedTo: "Dana" },
    { startAt: at(9) + 2 * DAY_MS, assignedTo: "Dana", attendees: ["Ghost"] },
    deps({ plan: async (a) => { seen.push(a.dayKeys); return []; } })
  );
  ok(seen.length === 1 && seen[0].join() === [DAY, addDays(DAY, 1), addDays(DAY, 2), addDays(DAY, 3)].join(),
    "drive-time sync: a moved visit re-syncs the old and new days (+ the day after each, for stay-overs) for each person on it");

  const addrSeen: string[][] = [];
  state = { lastSyncAt: NOW, legacyCleanedAt: 1 };
  await resyncForAddress("place:SV-1", deps({ plan: async (a) => { addrSeen.push(a.dayKeys); return []; } }));
  ok(addrSeen.length === 1 && addrSeen[0].join() === [DAY, addDays(DAY, 1)].join() && state.lastSyncAt === 0 && state.staleAt === NOW,
    "drive-time sync: a verified address re-syncs the upcoming visits on it and marks every rep stale (place keys can be Google locations)");

  // A trigger sync that fails for a non-busy reason leaves the rep stale so the next view retries.
  const visitMove = { startAt: at(9), assignedTo: "Dana" };
  state = { lastSyncAt: NOW, legacyCleanedAt: 1 };
  await resyncForVisitChange(null, visitMove, deps({ plan: async () => [] }));
  ok(state.lastSyncAt === NOW, "drive-time trigger: a trigger sync that succeeds leaves the rep fresh");
  state = { lastSyncAt: NOW, legacyCleanedAt: 1 };
  await resyncForVisitChange(null, visitMove, deps({ listEvents: async () => { throw new Error("401"); } }));
  ok(state.lastSyncAt === 0 && state.staleAt === NOW, "drive-time trigger: a visit re-sync whose calendar read failed marks the rep stale");
  state = { lastSyncAt: NOW, legacyCleanedAt: 1 };
  await resyncForVisitChange(null, visitMove, deps({ plan: async () => { throw new Error("boom"); } }));
  ok(state.lastSyncAt === 0 && state.staleAt === NOW && leaseUntil === 0, "drive-time trigger: a visit re-sync that throws marks the rep stale (lease still released)");
  state = { lastSyncAt: NOW, legacyCleanedAt: 1 };
  await resyncForAddress("site:SV-1", deps({ visitStates: async (vs) => new Map(vs.map((v) => [v.id, { ...okAddr(P1.lat, P1.lng, v.id), pointKey: "site:SV-1" }])), insertEvent: async () => { throw new Error("quota"); } }));
  ok(state.lastSyncAt === 0 && state.staleAt === NOW, "drive-time trigger: an address re-sync whose Google write failed marks the rep stale");
  const res = (over: Partial<DriveSyncResult>): DriveSyncResult =>
    ({ userId: "u1", days: [DAY], google: "written", inserted: 0, updated: 0, removed: 0, legacyRemoved: 0, flagged: 0, errors: [], ...over });
  const markDeps = () => deps({ now: () => NOW + 5 });
  state = { lastSyncAt: NOW, legacyCleanedAt: 1 };
  await markStaleIfTriggerFailed("u1", res({}), undefined, markDeps());
  await markStaleIfTriggerFailed("u1", res({ errors: ["legacy: 403"] }), undefined, markDeps());
  await markStaleIfTriggerFailed("u1", res({ google: "busy", errors: ["sync lease lost"] }), undefined, markDeps());
  ok(state.lastSyncAt === NOW, "drive-time trigger: a clean result, a D144-cleanup-only error, or busy (already stale) does not re-mark the rep");
  await markStaleIfTriggerFailed("u1", res({ google: "read-failed" }), undefined, markDeps());
  ok(state.lastSyncAt === 0 && state.staleAt === NOW + 5, "drive-time trigger: an event/stay-over sync whose read failed marks the rep stale");
  state = { lastSyncAt: NOW, legacyCleanedAt: 1 };
  await markStaleIfTriggerFailed("u1", null, new Error("boom"), markDeps());
  ok(state.lastSyncAt === 0, "drive-time trigger: an event/stay-over sync that threw marks the rep stale");
  let threw = false;
  await markStaleIfTriggerFailed("u1", null, new Error("boom"), deps({ setState: async () => { throw new Error("db down"); } })).catch(() => { threw = true; });
  ok(!threw, "drive-time trigger: marking stale never throws out of an after() callback");

  const synced: string[] = [];
  const all = await syncAllDrivers({ budgetMs: 60_000 }, deps({
    users: async () => [{ id: "u1", name: "Dana", status: "active" }, { id: "u2", name: "Old", status: "archived" }, { id: "u3", name: "NoCal", status: "active" }],
    calendarKeyFor: async (id) => (id === "u3" ? null : "personal:" + id),
    plan: async (a) => { synced.push(a.userId); return []; },
  }));
  ok(all.synced === 1 && synced.join() === "u1" && all.errors.length === 0, "drive-time sync: the cron rider syncs active reps with a connected calendar only");
  let tick = NOW;
  const over = await syncAllDrivers({ budgetMs: 1_000 }, deps({ now: () => (tick += 2_000), plan: async () => [] }));
  ok(over.synced === 0 && over.skipped === 1 && over.busy === 0, "drive-time sync: no new rep starts after the cron budget");
  const mixed = await syncAllDrivers({ budgetMs: 60_000 }, deps({
    users: async () => [{ id: "u1", name: "Dana", status: "active" }, { id: "u2", name: "Eli", status: "active" }],
    calendarKeyFor: async (id) => "personal:" + id,
    acquireLease: async (u, n) => (u === "u2" ? null : n + 90_000),
    renewLease: async (_u, t) => t,
    releaseLease: async () => {},
    plan: async () => [],
  }));
  ok(mixed.synced === 1 && mixed.busy === 1 && mixed.errors.length === 0, "drive-time sync: the cron rider reports a rep whose lease was held as busy, not synced");
  const failedRead = await syncAllDrivers({ budgetMs: 60_000 }, deps({
    users: async () => [{ id: "u1", name: "Dana", status: "active" }, { id: "u2", name: "Eli", status: "active" }],
    calendarKeyFor: async (id) => "personal:" + id,
    listEvents: async (key) => { if (key === "personal:u2") throw new Error("401"); return { events: [], coveredThroughMs: Number.MAX_SAFE_INTEGER }; },
    acquireLease: async (_u, n) => n + 90_000,
    renewLease: async (_u, t) => t,
    releaseLease: async () => {},
    plan: async () => [],
  }));
  ok(failedRead.synced === 1 && failedRead.readFailed === 1 && failedRead.busy === 0 && failedRead.errors.length === 0,
    "drive-time sync: the cron rider counts a rep whose calendar read failed separately, not as synced");
  // A deadline stops new reps from starting when too little time is left for one more (a rep can take ~20 s).
  const deadlined = await syncAllDrivers({ budgetMs: 60_000, deadlineMs: NOW + 10_000 }, deps({ plan: async () => [] }));
  ok(deadlined.synced === 0 && deadlined.skipped === 1, "drive-time sync: no rep starts when under 20 s remain before the cron deadline");
  const roomy = await syncAllDrivers({ budgetMs: 60_000, deadlineMs: NOW + 40_000 }, deps({ plan: async () => [] }));
  ok(roomy.synced === 1 && roomy.skipped === 0, "drive-time sync: a rep starts when the cron deadline leaves room for it");
}

export async function driveTimeNoStraightLinePins(ok: Ok): Promise<void> {
  const dirs = ["src/lib/drive-plan", "src/lib/drive-sync"];
  const banned = /\b(estimate|estimateFromParts|driveMinutes|driveMiles|haversineMiles|minutesFromMiles)\b\s*\(/;
  const offenders: string[] = [];
  for (const dir of dirs) for (const f of readdirSync(dir)) if (banned.test(readFileSync(join(dir, f), "utf8"))) offenders.push(join(dir, f));
  ok(offenders.length === 0, "drive-time pin: nothing on the drive path calls a straight-line estimate" + (offenders.length ? " — " + offenders.join(", ") : ""));
  ok(readdirSync("src/lib/drive-plan").includes("load.ts") && readdirSync("src/lib/drive-sync").includes("sync.ts"),
    "drive-time pin: the loader and the sync engine are inside the pinned directories");
  const loadSrc = readFileSync("src/lib/drive-plan/load.ts", "utf8");
  const syncSrc = readFileSync("src/lib/drive-sync/sync.ts", "utf8");
  const v = visitAddressInput({ id: "SV-9", customerId: "c", locationId: "l", address: "a", venue: "x" } as unknown as SiteVisit);
  ok(JSON.stringify(v) === JSON.stringify({ id: "SV-9", customerId: "c", locationId: "l", address: "a" }) &&
     /\.map\(visitAddressInput\)/.test(loadSrc) && /\.map\(visitAddressInput\)/.test(syncSrc),
    "drive-time pin: one visitAddressInput helper builds the address input in both the loader and the sync");
}

export async function driveTimeAgendaChecks(ok: Ok): Promise<void> {
  const kept = withoutAppDriveEvents([gEv("mine", {}), gEv("ours", { peakDriveKey: `u1|${DAY}|base|sv:SV-1`, peakDriveDay: DAY })]);
  ok(kept.length === 1 && kept[0].id === "mine", "drive-time agenda: the app's own tagged drive events are hidden from the Google feed (the app draws its own)");
  const src = readFileSync("src/lib/agenda.ts", "utf8");
  ok((src.match(/withoutAppDriveEvents\(\s*await listUpcomingEvents\(/g) ?? []).length === 1 &&
     (src.match(/withoutAppDriveEvents\(\s*await listEventsForExternalCalendar\(/g) ?? []).length === 1,
    "drive-time agenda: both Google sources in loadAgendaRange go through the filter");
  const layer = await driveAgendaLayer({
    userId: "u1",
    minMs: at(0),
    maxMs: at(23),
    googleEvents: [gEv("ics1", { iCalUID: "sv-SV-1@peak-app", startMs: at(9), endMs: at(10) }), gEv("meet", {})],
    deps: loadDeps({ visitStates: async (vs) => new Map(vs.map((v) => [v.id, badAddr(v.id)])) }),
  });
  const flags = layer.items.filter((i) => i.drive?.flag);
  ok(layer.items.every((i) => i.source === "drive") && flags.length === 2 && flags.every((i) => i.drive?.flag === "Address not verified — no drive time" && i.drive?.fix?.kind === "place"),
    "drive-time agenda: legs into/out of an unverified visit render as flags with its Fix target");
  ok(layer.addressFlags.get("v-SV-1")?.fix?.kind === "place" && layer.addressFlags.get("g-ics1")?.text === "Address not verified — no drive time" && !layer.addressFlags.has("g-meet"),
    "drive-time agenda: the visit and its Google .ics copy both carry the address flag; verified stops don't");
  const okLayer = await driveAgendaLayer({ userId: "u1", minMs: at(0), maxMs: at(23), googleEvents: null, deps: loadDeps() });
  const blocks = okLayer.items.filter((i) => !i.drive?.flag);
  ok(blocks.length === 2 && blocks[0].title === "Drive to Venue SV-1" && blocks[0].endMs === at(9) && blocks[0].drive?.minutes === 45 && blocks[1].title === "Drive back to Madison Office",
    "drive-time agenda: verified legs render as timed drive blocks (no calendar connected → visits only)");
  const flagged = driveItemFromLeg(planDay(input({ stops: [stop("sv:Z", at(9), at(10), badAddr("z"))] }))[0]);
  ok(flagged.startMs === at(9) && flagged.endMs === at(9) && flagged.drive?.minutes === null, "drive-time agenda: a flag sits at its anchor with no minutes");
  // Window trimming: Home must not list finished drive blocks or flags for earlier visits.
  const badDeps = (over: Partial<DriveLoadDeps> = {}) => loadDeps({ visitStates: async (vs) => new Map(vs.map((v) => [v.id, badAddr(v.id)])), ...over });
  const late = await driveAgendaLayer({ userId: "u1", minMs: at(12), maxMs: at(23), googleEvents: null, deps: badDeps() });
  ok(late.items.every((i) => i.endMs >= at(12)) && !late.items.some((i) => i.drive?.flag) && !late.addressFlags.has("v-SV-1"),
    "drive-time agenda: a window that starts after the visit drops its flags and its address flag");
  const lateOk = await driveAgendaLayer({ userId: "u1", minMs: at(10, 15), maxMs: at(23), googleEvents: null, deps: loadDeps() });
  ok(lateOk.items.length === 1 && lateOk.items[0].title === "Drive back to Madison Office",
    "drive-time agenda: already-finished drive blocks (ended before the window) are left out; the later one stays");
  const early = await driveAgendaLayer({ userId: "u1", minMs: at(0), maxMs: at(9), googleEvents: null, deps: loadDeps() });
  ok(early.items.length === 1 && early.items[0].title === "Drive to Venue SV-1", "drive-time agenda: a leg that starts after the window is left out too");
  // googleEventId path: a visit pushed straight to Google shows as that event; one visits read in all.
  let visitReads = 0;
  const pushed = await driveAgendaLayer({
    userId: "u1",
    minMs: at(0),
    maxMs: at(23),
    googleEvents: [gEv("gx1", { iCalUID: "gx1@google.com", startMs: at(9), endMs: at(10) }), gEv("meet", {})],
    deps: badDeps({ visits: async () => { visitReads++; return [visit("SV-1", { googleEventId: "gx1" })]; } }),
  });
  ok(pushed.addressFlags.get("g-gx1")?.fix?.kind === "place" && pushed.addressFlags.get("v-SV-1") !== undefined && !pushed.addressFlags.has("g-meet"),
    "drive-time agenda: a visit mirrored by googleEventId hands its address flag to that Google event");
  ok(visitReads === 1, "drive-time agenda: the drive layer reads site_visits once (the googleEventId lookup reuses the planner's read)");
  const agendaSrc = readFileSync("src/lib/agenda.ts", "utf8");
  ok((agendaSrc.match(/await allVisits\(\)/g) ?? []).length === 1 && /deps:\s*\{\s*visits:\s*async \(\) => allV/.test(agendaSrc),
    "drive-time agenda: loadAgendaRange reads site_visits once and hands that list to the drive layer");
  const client = readFileSync("src/app/(app)/calendar/calendar-client.tsx", "utf8");
  ok(client.includes("Staying near last stop") && client.includes("fmtDur(") && client.includes("AddressFlagBadge"),
    "drive-time calendar: stay-over toggle, day drive totals and Fix flags are on /calendar");
  ok(/isStayOverDay\(k, Date\.now\(\)\)/.test(client) && /res\.ok/.test(client) && /stayErr/.test(client),
    "drive-time calendar: the stay-over toggle shows only on days the server accepts and surfaces a refusal");
  ok(/drive\??\.dayKey/.test(client) && !/driveTotal\(byDay/.test(client) && !/driveTotal\(list\)/.test(client),
    "drive-time calendar: day drive totals bucket by the leg's Chicago day, not the browser-local date");
  ok(/renderDriveFlag\(it, true\)/.test(client) && /renderDriveFlag\(it, false\)/.test(client),
    "drive-time calendar: the all-day strip prints leg flags verbatim; month chips keep the compact form");
  const flagBadge = readFileSync("src/components/address-fix/address-flag.tsx", "utf8");
  ok(/aria-label=\{flag\.text\}/.test(flagBadge) && /title=\{flag\.text\}/.test(flagBadge), "drive-time flags: the compact badge carries the verbatim text in title and aria-label");
  ok(readFileSync("src/app/(app)/home-calendar.tsx", "utf8").includes('source === "drive"'), "drive-time agenda: the Home card renders drive rows");
}

/** One exported function's source: from its `export async function` line up
 *  to the next top-level `export` — so a pin can't be satisfied by a
 *  neighbouring function's code. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

/** True when the function's first `await` is `call` (the session check runs before anything else). */
function firstAwait(body: string, call: string): boolean {
  const i = body.indexOf("await ");
  return i >= 0 && body.startsWith("await " + call, i);
}

export async function driveTimeTriggerPins(ok: Ok): Promise<void> {
  const read = (p: string) => readFileSync(p, "utf8");
  const cal = read("src/app/(app)/calendar-actions.ts");
  ok(!cal.includes("addTravelBlock") && !cal.includes("Auto-added travel time") && !cal.includes("travelOriginOptionsAction"),
    "drive-time D144: the create flow no longer adds a guessed travel block");
  ok(!cal.includes("looksLikePhysicalAddress") && !cal.includes("travelFrom") && !cal.includes("TravelFrom"),
    "drive-time D144: the calendar actions carry no travel-origin plumbing any more");
  const stay = fnBody(cal, "setStayOverAction");
  ok(firstAwait(stay, "requireUser()") && stay.includes("syncDriveDays"),
    "drive-time: the stay-over toggle is signed-in only (its first await) and re-syncs that day and the next");
  ok(/isStayOverDay\(dayKey, Date\.now\(\)\)[\s\S]*?setStayOver\(/.test(stay) && !/isDayKey\(dayKey\)/.test(stay),
    "drive-time: the stay-over toggle refuses a day outside yesterday … today + 14 before storing anything");
  const T = Date.UTC(2026, 9, 14, 15); // 10:00 Chicago, 2026-10-14
  ok(isStayOverDay("2026-10-13", T) && isStayOverDay("2026-10-14", T) && isStayOverDay("2026-10-28", T) &&
     !isStayOverDay("2026-10-12", T) && !isStayOverDay("2026-10-29", T) && !isStayOverDay("2026-02-31", T) && !isStayOverDay(20261014, T),
    "drive-time: stay-over days run from yesterday to today + 14 (Chicago), real dates only");
  ok((cal.match(/syncDriveForUser\(syncUser\)/g) ?? []).length === 2,
    "drive-time: editing or deleting a calendar event re-syncs the rep's chain after the response");
  ok((cal.match(/after\(async \(\) => \{\s*const \{ (syncDriveDays|syncDriveForUser), markStaleIfTriggerFailed \} = await import\("@\/lib\/drive-sync\/sync"\);\s*await \1\([^;]*?\)\s*\.then\(\(r\) => markStaleIfTriggerFailed\([^;]*?\)\)\s*\.catch\(\(err\) => markStaleIfTriggerFailed\(/g) ?? []).length === 4,
    "drive-time: all four calendar triggers (add, edit, delete, stay-over) run in after() and mark the rep stale when the sync fails");
  ok(!read("src/app/(app)/calendar/event-modal.tsx").includes("Traveling from") && !read("src/app/(app)/calendar/event-modal.tsx").includes("travelOriginOptionsAction"),
    "drive-time D144: the 'Traveling from' picker is gone");
  const va = read("src/app/(app)/venue-assessments/visit-actions.ts");
  const inbox = read("src/app/(app)/inbox/site-visit-actions.ts");
  const inAfter = /after\(async \(\) => \{\s*const \{ resyncForVisitChange \} = await import\("@\/lib\/drive-sync\/sync"\);\s*await resyncForVisitChange\([^;]*?\)\.catch\(/g;
  ok((va.match(inAfter) ?? []).length === 2 && (va.match(/resyncForVisitChange\(/g) ?? []).length === 2,
    "drive-time: scheduling and deleting a visit re-sync the affected days, each inside after() with a .catch");
  ok((inbox.match(inAfter) ?? []).length === 1 && inbox.includes("resyncForVisitChange(null, rec)"), "drive-time: creating a visit from the Inbox re-syncs its day inside after() with a .catch");
  const sched = fnBody(va, "scheduleVisitAction");
  const createInbox = fnBody(inbox, "createSiteVisitAction");
  ok(sched.indexOf("after(") > 0 && sched.indexOf("after(") < sched.indexOf("await dispatchVisitInvite(") &&
     createInbox.indexOf("after(") > 0 && createInbox.indexOf("after(") < createInbox.indexOf("await dispatchVisitInvite("),
    "drive-time: the visit re-sync is registered before the invite dispatch, so an invite error can't drop it");
  for (const [file, src] of [["visit-actions", va], ["calendar-actions", cal]] as const) {
    for (const m of src.matchAll(/export async function (\w+)\(/g)) {
      const body = fnBody(src, m[1]);
      if (/syncDrive|resyncFor/.test(body))
        ok(firstAwait(body, "requireUser()") || firstAwait(body, "requireCalendarGrant()"), `drive-time pin: ${file} ${m[1]} checks the session (its first await) before it triggers a sync`);
    }
  }
  const cron = read("src/app/api/drive/sync/route.ts");
  ok(/cronAuthFailure\(/.test(cron) && /maxDuration = 60/.test(cron) && cron.includes("ensureVenueGeoStatus()") && cron.indexOf("ensureVenueGeoStatus()") < cron.indexOf("syncAllDrivers("),
    "drive-time: /api/drive/sync authenticates with CRON_SECRET, stamps venue status, then re-syncs every rep");
  ok(/syncAllDrivers\(\{[^}]*deadlineMs: started \+ 50_000/.test(cron) && /try \{[\s\S]*syncAllDrivers[\s\S]*\} catch[\s\S]*\{ error: [\s\S]*status: 500/.test(cron),
    "drive-time: the drive cron stops starting reps 50 s in and answers a failure with JSON { error } and status 500");
  const gmailCron = read("src/app/api/gmail/sync/route.ts");
  ok(!gmailCron.includes("syncAllDrivers") && !gmailCron.includes("ensureVenueGeoStatus"), "drive-time: the drive pass is off the shared Gmail/triage cron budget");
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  ok(vercel.crons.some((c) => c.path === "/api/drive/sync" && c.schedule === "0 11 * * *"), "drive-time: vercel.json runs /api/drive/sync once a day at 11:00 UTC (Hobby-safe)");
  const mw = read("src/middleware.ts");
  const mm = mw.match(/matcher:\s*\[\s*"([^"]+)"/);
  const mre = new RegExp("^" + (mm ? mm[1].replace(/\\\\/g, "\\") : "$^") + "$");
  ok(!!mm && !mre.test("/api/drive/sync") && mre.test("/calendar"), "drive-time: /api/drive/sync skips the login gate (CRON_SECRET is its auth); /calendar does not");
  const calPage = read("src/app/(app)/calendar/page.tsx");
  const home = read("src/app/(app)/page.tsx");
  ok(calPage.includes("syncDriveIfStale") && home.includes("syncDriveIfStale"),
    "drive-time: /calendar and Home re-sync a rep whose last sync is over 10 min old");
  ok(/after\(async \(\) => \{\s*const \{ syncDriveIfStale \}/.test(calPage) && /after\(async \(\) => \{\s*const \{ syncDriveIfStale \}/.test(home),
    "drive-time: the stale-on-load sync runs inside after(), never on the render path");
  ok(!read("src/lib/travel-origin.ts").includes("choices for the New event form"), "drive-time: travel-origin no longer documents the retired 'Traveling from' picker");
}

export async function driveTimeWorklistChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const SITE = "TESTdrive:site-wl";
  // Relative to the real clock: a visit's stored stage is derived against
  // Date.now() (a past "scheduled" visit reads "done"), so a fixed date
  // would start failing once the wall clock passed it.
  const NOW = Date.now();
  const visitText = "TESTdrive 12 Pine St, Appleton WI";
  try {
    await saveSite({ id: SITE, companyId: "TESTdrive:co-wl", name: "TESTdrive Hall", address: "", city: "Appleton", state: "WI", lat: "44.26", lng: "-88.41", venueKind: "proscenium" });
    await createFixture("site_visits", {
      id: fixtureId("drive", "sv-wl"), customerId: null, customer: "TESTdrive Cust", locationId: null, venue: "", address: visitText,
      contactName: "", contactEmail: "", contactPhone: "", reason: "Sales call", startAt: NOW + 86_400_000, endAt: NOW + 90_000_000,
      notes: "", assignedTo: "Dana", createdBy: "x", createdAt: 1, updatedAt: 1, stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "",
    });
    await createFixture("site_visits", {
      id: fixtureId("drive", "sv-old"), customerId: null, customer: "TESTdrive Old", locationId: null, venue: "", address: "TESTdrive 1 Gone Rd",
      contactName: "", contactEmail: "", contactPhone: "", reason: "Sales call", startAt: NOW - 3 * 86_400_000, endAt: NOW - 3 * 86_400_000 + 3_600_000,
      notes: "", assignedTo: "Dana", createdBy: "x", createdAt: 1, updatedAt: 1, stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "",
    });
    await createFixture("leads", { id: fixtureId("drive", "lead-wl"), org: "TESTdrive Org", contact: "", email: "", phone: "", address: "TESTdrive 9 Oak St", city: "Appleton", state: "WI", stage: "new", createdAt: 1, updatedAt: 1 });

    const all = await listAddressesToVerify({ q: "testdrive", now: NOW });
    const kinds = all.rows.map((r) => r.kind).join(",");
    ok(kinds === "visit,lead,venue" && all.counts.visit === 1 && all.counts.lead === 1 && all.counts.venue === 1,
      "drive-time worklist: upcoming visits, open leads and venues in one list (visits first); past visits left out");
    const venueRow = all.rows.find((r) => r.kind === "venue")!;
    ok(venueRow.status === "needs_check" && venueRow.fix.kind === "venue", "drive-time worklist: a city-level venue shows needs_check with a venue fix");
    const visitRow = all.rows.find((r) => r.kind === "visit")!;
    ok(visitRow.status === "unresolved" && !visitRow.checked && visitRow.fix.kind === "place", "drive-time worklist: an unchecked visit address shows unresolved, not yet looked up");
    ok((await listAddressesToVerify({ q: "testdrive", kind: "lead", now: NOW })).rows.every((r) => r.kind === "lead"), "drive-time worklist: kind filter");
    ok((await listAddressesToVerify({ q: "testdrive", status: "needs_check", now: NOW })).rows.map((r) => r.kind).join() === "venue", "drive-time worklist: status filter");
    const paged = await listAddressesToVerify({ q: "testdrive", offset: 1, limit: 1, now: NOW });
    ok(paged.rows.length === 1 && paged.rows[0].kind === "lead" && paged.total === 3, "drive-time worklist: offset/limit page the list, total counts every match");

    // The worklist reads the place book ONCE per call (states + "checked" together).
    const wlSrc = readFileSync("src/lib/address-verify/worklist.ts", "utf8");
    ok(!/\bgetPlaces\b/.test(wlSrc) && (wlSrc.match(/placeStatesWithRows\(/g) || []).length === 1 && !/\.orderBy\(/.test(wlSrc),
      "drive-time worklist: one place-book read per call (no second getPlaces) and no redundant SQL orderBy");

    // Verifying the visit's text drops it from the list.
    await fixPlace({ key: addressKey(visitText), label: visitText, mode: "pin", lat: 44.27, lng: -88.42 }, "u1");
    ok(!(await listAddressesToVerify({ q: "testdrive", now: NOW })).rows.some((r) => r.kind === "visit"), "drive-time worklist: a verified address leaves the worklist");

    ok(cleanFixTarget({ kind: "venue", siteId: "st-1" })?.kind === "venue" && cleanFixTarget({ kind: "place", key: "a b", label: "A B" })?.kind === "place" &&
       cleanFixTarget({ kind: "place", key: "a" }) === null && cleanFixTarget(null) === null && cleanFixTarget({ kind: "venue", siteId: 7 }) === null &&
       cleanFixTarget({ kind: "other", siteId: "x" }) === null,
      "drive-time cleanFixTarget validates untrusted targets");
  } finally {
    await db.delete(sites).where(eq(sites.id, SITE));
    await db.delete(placeBook).where(like(placeBook.key, "testdrive%"));
    await dropFixtures("drive");
  }
}

export async function driveTimeFixUiPins(ok: Ok): Promise<void> {
  const read = (p: string) => readFileSync(p, "utf8");
  const actions = read("src/app/(app)/address-actions.ts");
  ok(actions.startsWith('"use server";'), "drive-time pin: address-actions is a server-action file");
  for (const fn of ["fixAddressAction", "loadFixTargetAction", "searchAddressAction", "townCentreForFixAction", "addressStatusAction"]) {
    ok(firstAwait(fnBody(actions, fn), "requireUser()"), `drive-time pin: ${fn} is signed-in only (its first await)`);
  }
  ok(firstAwait(fnBody(actions, "listAddressesToVerifyAction"), 'requirePerm("manage_users")'), "drive-time pin: the worklist is admin-only");
  const fix = fnBody(actions, "fixAddressAction");
  ok(/after\(async \(\) => \{[\s\S]*?await resyncForAddress\(pointKey\)\.catch\(/.test(fix) && fix.indexOf("after(") < fix.indexOf("return r;"),
    "drive-time pin: verifying an address re-syncs the legs touching it, inside after() with a .catch");
  const drawer = read("src/components/address-fix/address-fix-drawer.tsx");
  ok(drawer.includes("LeafletMap") && drawer.includes("onPick") && drawer.includes("createPortal") && /dynamic\(\(\) => import\("@\/components\/map\/LeafletMap"\), \{\s*ssr: false/.test(drawer),
    "drive-time pin: the Fix dialog drops/drags a pin on the shared Leaflet map, loaded client-only");
  ok(/\{compact && flag\.fix \? \(flag\.text === FLAG_TEXT\.long_route \? "Over 6 h" : "Not verified"\) : flag\.text\}/.test(read("src/components/address-fix/address-flag.tsx")),
    "drive-time pin: the flag badge renders the flag's own text (compact address flags say 'Not verified', a long route 'Over 6 h')");
  const verifyList = read("src/app/(app)/settings/addresses-to-verify.tsx");
  ok(/rows\.filter\(\(r\) => fixKey\(r\) === k\)/.test(verifyList) && !/removeRow/.test(verifyList),
    "drive-time pin: a verified address leaves every worklist row that shares its fix target");
  const drawerSrc = read("src/components/address-fix/address-fix-drawer.tsx");
  ok(/searchAddressAction\(d\.placeText, 1\)/.test(drawerSrc) && drawerSrc.includes("Kept your pin — the search found only a town-level match"),
    "drive-time pin: a place Fix opens centred on its text, and kept-pin has its own wording");
  ok(read("src/app/(app)/settings/groups/data.tsx").includes("AddressesToVerify"), "drive-time pin: Settings → Data shows Addresses to verify");
  // Client components never import a module that reaches @/db (next build breaks).
  const clientFiles = ["src/components/address-fix/address-fix-drawer.tsx", "src/components/address-fix/address-flag.tsx", "src/app/(app)/settings/addresses-to-verify.tsx"];
  const allowed = /^(react|react-dom|next\/(dynamic|navigation)|@\/lib\/address-verify\/types|@\/lib\/drive-plan\/plan|@\/app\/\(app\)\/address-actions|\.\.\/address-actions|\.\/address-fix-drawer|@\/components\/address-fix\/address-fix-drawer|@\/components\/map\/LeafletMap)$/;
  const bad: string[] = [];
  for (const f of clientFiles) {
    const src = read(f);
    if (!src.startsWith('"use client";')) bad.push(f + " (not a client component)");
    for (const m of src.matchAll(/(?:from|import\()\s*"([^"]+)"/g)) if (!allowed.test(m[1])) bad.push(f + " → " + m[1]);
  }
  ok(bad.length === 0, "drive-time pin: the Fix UI imports only pure types and server actions" + (bad.length ? " — " + bad.join(", ") : ""));
  ok(!existsSync("src/app/(app)/settings/unlocated-venues.tsx") && !existsSync("src/app/(app)/settings/venue-locate-drawer.tsx") &&
     !/locateVenueAction|searchVenueAddressAction|townCentreAction|listUnlocatedVenuesAction/.test(read("src/app/(app)/settings/actions.ts")),
    "drive-time: the old venue-only locate drawer, worklist and actions are gone");
}

export async function driveTimeBookingPins(ok: Ok): Promise<void> {
  const read = (p: string) => readFileSync(p, "utf8");
  const vr = read("src/app/(app)/venue-assessments/visit-requests.tsx");
  ok(vr.includes("addressFlag: AddressFlagVM | null") && vr.includes("<AddressFlagBadge"), "drive-time booking: the visit-requests scheduler shows the address flag with Fix");
  ok(read("src/app/(app)/venue-assessments/page.tsx").includes("addressStatesForVisits"), "drive-time booking: visit rows get their address state server-side");
  const modal = read("src/app/(app)/inbox/site-visit-modal.tsx");
  ok(modal.includes("addressStatusAction") && modal.includes("You can still schedule it"), "drive-time booking: the Inbox scheduler warns about an unverified address but never blocks");
  ok(read("src/app/(app)/companies/[id]/page.tsx").includes("addressStatesForVisits"), "drive-time booking: the company record's visit list flags unverified addresses");
  // The live check writes a place-book row per distinct text: debounced, never per keystroke, never gating Save.
  ok(/setTimeout\([\s\S]{0,900}?,\s*(6\d\d|[7-9]\d\d|\d{4,})\)/.test(modal) && modal.includes("clearTimeout"), "drive-time booking: the Inbox scheduler's address check is debounced (>= 600 ms), not per keystroke");
  ok(!/disabled=\{[^}]*addr/.test(modal), "drive-time booking: the address warning never disables Save");
  ok(modal.includes("Address not verified — no drive time"), "drive-time booking: the Inbox warning uses the verbatim flag copy");
  // Task 11 fix round: the Fix drawer opens above the booking dialog, and stale lookups never render.
  const flagSrc = read("src/components/address-fix/address-flag.tsx");
  const drawerSrc11 = read("src/components/address-fix/address-fix-drawer.tsx");
  ok(/drawerZIndex\?: number/.test(flagSrc) && /zIndex=\{drawerZIndex\}/.test(flagSrc) && /zIndex = 60,/.test(drawerSrc11) && /inset: 0, zIndex, fontFamily/.test(drawerSrc11),
    "drive-time booking: the Fix drawer takes a zIndex (default 60) that AddressFlagBadge threads through");
  const modalOverlay = Number(/zIndex: (\d+),\s*display: "flex"/.exec(modal)?.[1]);
  const modalDrawerZ = Number(/drawerZIndex=\{(\d+)\}/.exec(modal)?.[1]);
  ok(modalOverlay > 0 && modalDrawerZ > modalOverlay && /<div onClick=\{\(e\) => e\.stopPropagation\(\)\} style=\{\{ position: "fixed", inset: 0, zIndex,/.test(drawerSrc11),
    "drive-time booking: the Inbox Schedule modal opens the Fix drawer above its own overlay, and drawer clicks never reach the overlay's close");
  ok(/addr && addr\.forVenue === venueId && addr\.status !== "verified"/.test(modal) && /if \(live\) setAddr\(/.test(modal),
    "drive-time booking: a lookup for a previously selected venue is never shown (forVenue === venueId, superseded results dropped)");
  // Task 10 review add-ons.
  const home = read("src/app/(app)/home-calendar.tsx");
  ok(/<AddressFlagBadge flag=\{it\.addressFlag\} \/>/.test(home) && !/<AddressFlagBadge flag=\{it\.addressFlag\} compact/.test(home), "drive-time booking: Home agenda rows show the full address flag (not compact)");
  ok(/<span role="img"[^>]*aria-label=\{text\}/.test(read("src/app/(app)/calendar/calendar-client.tsx")), "drive-time booking: the calendar's plain flag span carries a role with its aria-label");
}

export async function driveTimeTriageFlagChecks(ok: Ok): Promise<void> {
  const visit = (id: string, address: string) => ({ id, customerId: null, locationId: null, address }) as unknown as SiteVisit;
  const verified: AddressState = { status: "verified", label: "1 Main St", point: { lat: 43, lng: -89 }, pointKey: "place:1 main st", fix: null };
  const needs: AddressState = { status: "needs_check", label: "Rural Rd", point: { lat: 43, lng: -89 }, pointKey: "place:rural rd", fix: null };
  const asked: string[][] = [];
  const flags = await unverifiedVisitFlags(["SV-a", "SV-b", "SV-c", "SV-a", "SV-gone"], 0, {
    getVisits: async (ids) => {
      asked.push([...ids]);
      return ids.filter((id) => id !== "SV-gone").map((id) => visit(id, id));
    },
    states: async () => new Map([["SV-a", verified], ["SV-b", needs]]),
  });
  ok(!flags.has("SV-a") && JSON.stringify(flags.get("SV-b")) === JSON.stringify(["Address not verified — no drive time"]) && flags.has("SV-c") && !flags.has("SV-gone"),
    "drive-time triage: today's visits whose address isn't verified (or has no state) carry the verbatim flag; verified and missing visits don't");
  ok(asked.length === 1 && asked[0].join() === "SV-a,SV-b,SV-c,SV-gone", "drive-time triage: visit ids are de-duplicated before one lookup");
  ok((await unverifiedVisitFlags([], 0, { getVisits: async () => { throw new Error("never"); } })).size === 0, "drive-time triage: no visits → no lookup");
  const failed = await unverifiedVisitFlags(["SV-a"], 0, { getVisits: async () => [visit("SV-a", "x")], states: async () => { throw new Error("db down"); } });
  ok(failed.size === 0, "drive-time triage: a lookup failure drops the flags, never throws (the visit feed keeps today's visits)");
  const real = await unverifiedVisitFlags(["TESTdrive:SV-unchecked"], 0, { getVisits: async () => [visit("TESTdrive:SV-unchecked", "TESTdrive 999 Nowhere Rd, Nowhere WI")] });
  ok(real.has("TESTdrive:SV-unchecked"), "drive-time triage: an address no one has checked reads as not verified in cache mode (never geocoded)");
  const hooks = readFileSync("src/lib/triage/hooks.ts", "utf8");
  ok(/TRIAGE_HOOKS: TriageHooks = \{ \.\.\.NO_HOOKS, visitFlags: unverifiedVisitFlags \}/.test(hooks), "drive-time triage: the app's TRIAGE_HOOKS runs the unverified-address visit flag");
}

/* ============ Final-review fix round ============ */
export async function driveTimeFinalFixChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const read = (p: string) => readFileSync(p, "utf8");
  // One group's throw must not hide the others' results.
  const group = async (name: string, fn: () => Promise<void> | void) => {
    try { await fn(); } catch (err) { ok(false, `drive-time final: ${name} threw: ${(err as Error).message}`); }
  };

  // ---- 1a. Free text verifies only when the TYPED text leads with a house number too ----
  await group("typed house number", async () => {
    ok(statusOfFreeTextHit("Starbucks", { street: "123 Main St" }) === "needs_check" &&
       statusOfFreeTextHit("Holiday Inn Express", { street: "4800 Hotel Dr" }) === "needs_check" &&
       statusOfFreeTextHit("North HS", { street: "1 School Rd" }) === "needs_check",
      "drive-time final: a names-only free text ('Starbucks') with a house-numbered POI hit is needs_check, never verified");
    ok(statusOfFreeTextHit("123 Main St, Town", { street: "123 Main St" }) === "verified" &&
       statusOfFreeTextHit("123 Main St, Town", { street: "Main St" }) === "needs_check" &&
       statusOfFreeTextHit("123 Main St, Town", null) === "unresolved" &&
       statusOfFreeTextHit("Starbucks, 123 Main St", { street: "123 Main St" }) === "needs_check",
      "drive-time final: '123 Main St, Town' with a house-numbered hit verifies; the typed first line decides");
    const poi = placeRowFromHit("starbucks testdrive", "Starbucks TESTdrive", { street: "123 Main St", lat: 30.2, lng: -97.7 }, 1000);
    ok(poi.status === "needs_check" && poi.verifiedAt === null && poi.lat === 30.2, "drive-time final: a names-only place-book write-back is needs_check (point kept for the Fix map)");
    const S = "Starbucks TESTdrive";
    const T = "12 TESTdrive Main St, Hortonville WI";
    const live = await placeStatesFor([S, T], "live", fastDeps(async () => [hit("123 Main St", 30.2, -97.7)]));
    ok(live.get(addressKey(S))?.status === "needs_check" && live.get(addressKey(S))?.point === null && live.get(addressKey(T))?.status === "verified",
      "drive-time final: the live place-book path flags 'Starbucks' (no drive time) and verifies a typed street address");
    const retry = await fixPlace({ key: addressKey("Holiday TESTdrive"), label: "Holiday TESTdrive", mode: "retry", text: "Holiday Inn Express" }, "u1", fastDeps(async () => [hit("4800 Hotel Dr")]));
    ok(retry.ok && retry.status === "needs_check", "drive-time final: a Fix retry typed without a house number stays needs_check");
    const pin = await fixPlace({ key: addressKey(S), label: S, mode: "pin", lat: 44.2, lng: -88.4 }, "u1", fastDeps(async () => []));
    ok(pin.ok && pin.status === "verified", "drive-time final: a hand pin on a names-only place still verifies");
  });

  // ---- 1b. Over 6 h of driving is flagged, never placed ----
  await group("long route", () => {
    const farFix = { kind: "place" as const, key: "far", label: "far" };
    const far: AddressState = { ...okAddr(P2.lat, P2.lng, "far"), fix: farFix };
    const legs = planDay(input({ stops: [stop("sv:far", at(10), at(11), far)], routeMinutes: routes([BASE, P2, 400], [P2, BASE, 400]) }));
    ok(legs.length === 2 && legs.every((l) => l.flag?.kind === "long_route" && l.flag.text === "Over 6 h — check the address" && l.minutes === null && l.startMs === null && l.endMs === null),
      "drive-time final: a 400-minute route is flagged 'Over 6 h — check the address' with no minutes and no block");
    ok(legs[0].fix?.kind === "place" && legs[0].fix.key === "far" && legs[1].fix?.kind === "place", "drive-time final: the long-route flag offers the stop's Fix");
    ok(desiredFromLegs(legs).length === 0 && dayDriveTotal(legs) === 0, "drive-time final: a long-route leg gets no Google event and counts 0 toward the day");
    const at360 = planDay(input({ stops: [stop("sv:ok", at(10), at(11), okAddr(P2.lat, P2.lng, "ok"))], routeMinutes: routes([BASE, P2, 360], [P2, BASE, 360]) }));
    ok(at360.every((l) => !l.flag && l.minutes === 375), "drive-time final: exactly 360 route minutes is still a normal leg");
    ok(neededRoutes(input({ stops: [stop("sv:far", at(10), at(11), far)] })).length === 2, "drive-time final: neededRoutes still asks for the pairs (long_route is decided once minutes exist)");
    ok(read("src/app/(app)/calendar/calendar-client.tsx").includes("FLAG_TEXT.long_route"), "drive-time final: the month grid has a short form for the long-route flag");
    ok(read("src/components/address-fix/address-flag.tsx").includes("FLAG_TEXT.long_route"), "drive-time final: the compact Fix badge doesn't call a long route 'Not verified'");
  });

  // ---- 5d. Near-zero legs are skipped ----
  await group("near-zero legs", () => {
    const near = planDay(input({ stops: [stop("sv:n", at(10), at(11), okAddr(P1.lat, P1.lng, "n"))], routeMinutes: routes([BASE, P1, 2], [P1, BASE, 2.9]) }));
    ok(near.length === 0, "drive-time final: a leg under 3 route minutes (before buffer) is skipped — no leg, no block");
    const three = planDay(input({ stops: [stop("sv:n", at(10), at(11), okAddr(P1.lat, P1.lng, "n"))], routeMinutes: routes([BASE, P1, 3], [P1, BASE, 3]) }));
    ok(three.length === 2 && three.every((l) => l.minutes === 18), "drive-time final: a 3-minute route is a leg (3 + 15 buffer)");
  });

  // ---- 2. One Nominatim pacer across concurrent callers ----
  await group("nominatim pacer", async () => {
    let clock = 5_000_000;
    const starts: number[] = [];
    const pacer = { nextAt: 0 };
    const deps = {
      search: async () => { starts.push(clock); return [hit("1 Pace Rd")]; },
      delayMs: 1100, budgetMs: 60_000, now: () => clock, pacer,
      sleep: async (ms: number) => { const target = clock + ms; await Promise.resolve(); clock = Math.max(clock, target); },
    };
    await Promise.all([
      placeStatesFor(["1 TESTdrive Pacer A1", "1 TESTdrive Pacer A2"], "live", deps),
      placeStatesFor(["1 TESTdrive Pacer B1", "1 TESTdrive Pacer B2"], "live", deps),
    ]);
    const sorted = [...starts].sort((a, b) => a - b);
    ok(starts.length === 4 && sorted.every((s, i) => i === 0 || s - sorted[i - 1] >= 1100),
      "drive-time final: two concurrent place-book passes share one pacer — request starts are ≥ 1.1 s apart");
    const before = pacer.nextAt;
    const fx = await fixPlace({ key: addressKey("1 TESTdrive Pacer Fix"), label: "1 TESTdrive Pacer Fix", mode: "retry", text: "1 Pace Rd, Hortonville" }, "u1", deps);
    ok(fx.ok && starts[starts.length - 1] >= before && pacer.nextAt >= before + 1100, "drive-time final: a Fix retry takes its turn on the same pacer");
    ok(/nominatimPacer/.test(read("src/lib/address-verify/place-book.ts")), "drive-time final: the place book's default deps use the module-level Nominatim pacer");
  });

  // ---- 5e. fixPlace refuses a label that isn't the key's own text ----
  await group("fixPlace label", async () => {
    const r = await fixPlace({ key: addressKey("1 TESTdrive Label A"), label: "1 TESTdrive Label B", mode: "pin", lat: 44.1, lng: -88.1 }, "u1", fastDeps(async () => []));
    ok(!r.ok && r.reason === "invalid" && !(await getPlaces([addressKey("1 TESTdrive Label A")])).size,
      "drive-time final: fixPlace refuses when addressKey(label) !== key (like loadFixTarget) and writes nothing");
  });

  // ---- 3. Backfill verifications are identifiable and re-checkable ----
  await group("backfill recheck", async () => {
    ok(isBackfillVerified({ geoStatus: "verified", geoSource: "geocode", geoVerifiedAt: null }) &&
       !isBackfillVerified({ geoStatus: "verified", geoSource: "geocode", geoVerifiedAt: 5 }) &&
       !isBackfillVerified({ geoStatus: "verified", geoSource: "pin", geoVerifiedAt: null }) &&
       !isBackfillVerified({ geoStatus: "needs_check", geoSource: "geocode", geoVerifiedAt: null }),
      "drive-time final: a backfill-derived verification is verified + geocode + no verified-at");
    const CO = "TESTdrive:co-recheck";
    const ids = { good: "TESTdrive:rc-good", poi: "TESTdrive:rc-poi", drift: "TESTdrive:rc-drift", out: "TESTdrive:rc-out", pin: "TESTdrive:rc-pin", human: "TESTdrive:rc-human" };
    const base = { companyId: CO, name: "Gym", city: "Hortonville", state: "WI", zip: "54944", venueKind: "proscenium" as const, lat: "44.3300", lng: "-88.6300" };
    try {
      for (const id of Object.values(ids)) await saveSite({ id, ...base, address: "12 Oak St" });
      await db.update(sites).set({ geoStatus: "verified", geoSource: "geocode", geoVerifiedAt: null, geoVerifiedBy: null }).where(inArray(sites.id, Object.values(ids)));
      await db.update(sites).set({ geoSource: "pin", geoVerifiedBy: "u1", geoVerifiedAt: 7 }).where(eq(sites.id, ids.pin));
      await db.update(sites).set({ geoVerifiedBy: "u2", geoVerifiedAt: 9 }).where(eq(sites.id, ids.human));
      const asked: string[] = [];
      const geocode = async (row: { id: string }) => {
        asked.push(row.id);
        if (row.id === ids.out) return "outage" as const;
        if (row.id === ids.poi) return { ok: true as const, lat: 44.33, lng: -88.63, precision: "building" as const, hit: hit("Oak St", 44.33, -88.63) };
        if (row.id === ids.drift) return { ok: true as const, lat: 45.5, lng: -88.63, precision: "building" as const, hit: hit("12 Oak St", 45.5, -88.63) };
        return { ok: true as const, lat: 44.3301, lng: -88.6301, precision: "building" as const, hit: hit("12 Oak St", 44.3301, -88.6301) };
      };
      const dry = await recheckBackfilledVenues({ apply: false, ids: Object.values(ids) }, { geocode, now: () => 1234 });
      const stillVerified = await db.select().from(sites).where(inArray(sites.id, Object.values(ids)));
      ok(dry.candidates === 4 && dry.downgraded === 2 && dry.confirmed === 1 && dry.outage === 1 && !asked.includes(ids.pin) && !asked.includes(ids.human) &&
         stillVerified.every((s) => s.geoStatus === "verified"),
        "drive-time final: the re-check dry run judges only backfill-derived venues (never pins or human verifications) and writes nothing");
      asked.length = 0;
      const applied = await recheckBackfilledVenues({ apply: true, ids: Object.values(ids) }, { geocode, now: () => 1234 });
      const rows = new Map((await db.select().from(sites).where(inArray(sites.id, Object.values(ids)))).map((s) => [s.id, s]));
      ok(applied.downgraded === 2 && rows.get(ids.poi)?.geoStatus === "needs_check" && rows.get(ids.drift)?.geoStatus === "needs_check" &&
         rows.get(ids.poi)?.lat === "44.3300",
        "drive-time final: --apply downgrades a hit that fails geocodedStatus (and one far from the stored point) to needs_check, coordinates untouched");
      ok(rows.get(ids.good)?.geoStatus === "verified" && rows.get(ids.good)?.geoVerifiedAt === 1234 && rows.get(ids.out)?.geoStatus === "verified" && rows.get(ids.out)?.geoVerifiedAt === null,
        "drive-time final: a confirmed venue is stamped verified-at (no longer backfill-derived); an outage leaves the row for the next run");
      ok(rows.get(ids.pin)?.geoSource === "pin" && rows.get(ids.pin)?.geoVerifiedAt === 7 && rows.get(ids.human)?.geoVerifiedAt === 9,
        "drive-time final: the re-check never touches a pin or a human verification");
      asked.length = 0;
      await recheckBackfilledVenues({ apply: true, ids: Object.values(ids) }, { geocode, now: () => 5678 });
      ok(asked.length === 1 && asked[0] === ids.out, "drive-time final: a second run only re-tries what is still backfill-derived");
      const script = read("scripts/geo-recheck-venues.ts");
      ok(/DATABASE_URL/.test(script) && /PGLITE_PATH/.test(script) && /--apply/.test(script) && /requireHostedConfirmation/.test(script) &&
         JSON.parse(read("package.json")).scripts["geo:recheck-venues"] === "tsx scripts/geo-recheck-venues.ts",
        "drive-time final: npm run geo:recheck-venues is a dry run by default, needs an explicit DB target, --apply to write and --yes for hosted");
    } finally {
      await db.delete(sites).where(inArray(sites.id, Object.values(ids)));
    }
  });

  // ---- 4. The live planner and the sync respect the cron deadline ----
  await group("deadline", async () => {
    const budgets: Array<{ what: string; mode: string; budget: number | undefined }> = [];
    let clock = at(6);
    const deadlineDeps = loadDeps({
      visitStates: async (vs, mode, budget) => { budgets.push({ what: "visits", mode, budget }); return new Map(vs.map((v) => [v.id, okAddr(P1.lat, P1.lng, v.id)])); },
      placeStates: async (texts, mode, budget) => { budgets.push({ what: "places", mode, budget }); return new Map(); },
      routes: async (pairs, mode, budget) => { budgets.push({ what: "routes", mode, budget }); return new Map(pairs.map((p) => [pairKey(p.from, p.to), 30])); },
    });
    await planDriveDays({ userId: "u1", dayKeys: [DAY], events: [], mode: "live", deps: deadlineDeps, deadlineMs: clock + 60_000, now: () => clock });
    ok(budgets.filter((b) => b.what !== "places").every((b) => b.mode === "live" && b.budget === 20_000), "drive-time final: with time to spare, each live lookup keeps its 20 s budget");
    budgets.length = 0;
    await planDriveDays({ userId: "u1", dayKeys: [DAY], events: [], mode: "live", deps: deadlineDeps, deadlineMs: clock + 18_000, now: () => clock });
    ok(budgets.filter((b) => b.what !== "places").every((b) => b.mode === "live" && b.budget === 13_000), "drive-time final: near the deadline a live lookup's budget is deadline − now − 5 s");
    budgets.length = 0;
    await planDriveDays({ userId: "u1", dayKeys: [DAY], events: [], mode: "live", deps: deadlineDeps, deadlineMs: clock + 8_000, now: () => clock });
    ok(budgets.length > 0 && budgets.every((b) => b.mode === "cache"), "drive-time final: with too little time left for one request, lookups fall back to cache mode (no network)");

    // The sync passes the deadline to the planner and skips the D144 phase late.
    const seen: Array<number | undefined> = [];
    let legacyReads = 0;
    let st: DriveSyncState = { lastSyncAt: 0, legacyCleanedAt: null };
    let leaseUntil = 0;
    const sdeps = (over: Partial<DriveSyncDeps> = {}): Partial<DriveSyncDeps> => ({
      now: () => clock,
      calendarKeyFor: async () => "personal:u1",
      listEvents: async (_k, range, purpose) => { if (purpose === "legacy") legacyReads++; return { events: [], coveredThroughMs: range.timeMaxMs }; },
      insertEvent: async () => ({ id: "n" }), updateEvent: async () => ({}), deleteEvent: async () => {},
      plan: async (a) => { seen.push(a.deadlineMs); clock += 1_000; return []; },
      getState: async () => st, setState: async (_u, p) => { st = { ...st, ...p }; },
      users: async () => [{ id: "u1", name: "Dana", status: "active" }],
      visits: async () => [], visitStates: async () => new Map(),
      acquireLease: async (_u, n) => { if (leaseUntil > n) return null; leaseUntil = n + 90_000; return leaseUntil; },
      renewLease: async (_u, t, n) => (leaseUntil === t ? (leaseUntil = Math.max(n + 90_000, t + 1)) : null),
      releaseLease: async (_u, t) => { if (leaseUntil === t) leaseUntil = 0; },
      log: () => {},
      ...over,
    });
    clock = at(6);
    await syncDriveDays("u1", [DAY], sdeps(), { deadlineMs: clock + 8_000 });
    ok(seen[0] === at(6) + 8_000 && legacyReads === 0 && !st.legacyCleanedAt, "drive-time final: the sync hands its deadline to the planner and skips the D144 phase with under 10 s left");
    clock = at(6);
    await syncDriveDays("u1", [DAY], sdeps(), { deadlineMs: clock + 40_000 });
    ok(legacyReads > 0, "drive-time final: with time left the D144 phase still runs");
    seen.length = 0;
    clock = at(6);
    await syncAllDrivers({ budgetMs: 50_000, deadlineMs: clock + 50_000 }, sdeps());
    ok(seen.length === 1 && seen[0] === at(6) + 50_000, "drive-time final: the cron's deadline reaches each rep's planner");
  });

  // ---- 5a. A D144-only error doesn't mark the rep stale ----
  await group("legacy errors", async () => {
    const marks: number[] = [];
    const sd = { now: () => 42, setState: async () => { marks.push(1); }, log: () => {} } as Partial<DriveSyncDeps>;
    const res = (errors: string[]): DriveSyncResult => ({ userId: "u1", days: [DAY], google: "written", inserted: 0, updated: 0, removed: 0, legacyRemoved: 0, flagged: 0, errors });
    await markStaleIfTriggerFailed("u1", res(["legacy list: 503"]), undefined, sd);
    await markStaleIfTriggerFailed("u1", res(["legacy evt123: 500", "legacy evt9: giving up after 5 tries: x", "legacy: sync lease lost — D144 cleanup skipped this run"]), undefined, sd);
    ok(marks.length === 0, "drive-time final: D144 cleanup errors ('legacy list: …', 'legacy <id>: …') never mark the rep stale");
    await markStaleIfTriggerFailed("u1", res(["legacy list: 503", "insert k: quota"]), undefined, sd);
    ok(marks.length === 1, "drive-time final: a drive write error still marks the rep stale");
  });

  // ---- 5b. Only the rep's own legs are diffed ----
  await group("own legs", async () => {
    const mk = (id: string, key: string) => ({ id, title: "Drive to X", startMs: at(8), endMs: at(9), peakDriveKey: key, peakDriveDay: DAY });
    const own = existingFromCalendar([mk("a", `u1|${DAY}|base|sv:A`), mk("b", `u2|${DAY}|base|sv:B`), mk("c", `u10|${DAY}|base|sv:C`)], "u1");
    ok(own.length === 1 && own[0].id === "a", "drive-time final: existingFromCalendar keeps only keys starting with '<userId>|'");
    const deleted: string[] = [];
    let st: DriveSyncState = { lastSyncAt: 0, legacyCleanedAt: 1 };
    let leaseUntil = 0;
    const r = await syncDriveDays("u1", [DAY], {
      now: () => at(6),
      calendarKeyFor: async () => "personal:u1",
      listEvents: async (_k, range) => ({ events: [{ ...gEv("other", { title: "Drive to B", startMs: at(8), endMs: at(9), location: "", peakDriveKey: `u2|${DAY}|base|sv:B`, peakDriveDay: DAY }), description: "" }], coveredThroughMs: range.timeMaxMs }),
      insertEvent: async () => ({ id: "n" }), updateEvent: async () => ({}), deleteEvent: async (_k, id) => { deleted.push(id); },
      plan: async () => [],
      getState: async () => st, setState: async (_u, p) => { st = { ...st, ...p }; },
      acquireLease: async (_u, n) => { leaseUntil = n + 90_000; return leaseUntil; },
      renewLease: async (_u, t, n) => (leaseUntil === t ? (leaseUntil = n + 90_000) : null),
      releaseLease: async () => {}, log: () => {},
    });
    ok(r.google === "written" && deleted.length === 0, "drive-time final: a delegated/shared calendar's other-rep drive event is never deleted by this rep's sync");
  });

  // ---- 1b (sync). A long-route leg loses its existing event (not kept like a transient retry) ----
  await group("long route sync", async () => {
    const deleted: string[] = [];
    let st: DriveSyncState = { lastSyncAt: 0, legacyCleanedAt: 1 };
    let leaseUntil = 0;
    const key = `u1|${DAY}|base|sv:far`;
    const legs = planDay(input({ stops: [stop("sv:far", at(10), at(11), okAddr(P2.lat, P2.lng, "far"))], routeMinutes: routes([BASE, P2, 400], [P2, BASE, 400]) }));
    await syncDriveDays("u1", [DAY], {
      now: () => at(6),
      calendarKeyFor: async () => "personal:u1",
      listEvents: async (_k, range) => ({ events: [{ ...gEv("was", { title: "Drive to far", startMs: at(9), endMs: at(10), location: "", peakDriveKey: key, peakDriveDay: DAY }), description: "" }], coveredThroughMs: range.timeMaxMs }),
      insertEvent: async () => ({ id: "n" }), updateEvent: async () => ({}), deleteEvent: async (_k, id) => { deleted.push(id); },
      plan: async () => [{ dayKey: DAY, stops: [], legs, totalMin: 0 }],
      getState: async () => st, setState: async (_u, p) => { st = { ...st, ...p }; },
      acquireLease: async (_u, n) => { leaseUntil = n + 90_000; return leaseUntil; },
      renewLease: async (_u, t, n) => (leaseUntil === t ? (leaseUntil = n + 90_000) : null),
      releaseLease: async () => {}, log: () => {},
    });
    ok(legs[0].key === key && deleted.includes("was"), "drive-time final: a long-route leg's existing Google event is removed (non-transient, unlike 'retrying')");
  });

  // ---- 5c. Drive events: no reminders, busy; drive + legacy deletes send no updates ----
  await group("event write body", () => {
    const ev: DesiredDriveEvent = { key: `u1|${DAY}|base|sv:A`, dayKey: DAY, title: "Drive to A", description: "d", startMs: at(8), endMs: at(9) };
    const body = eventWriteBody(driveEventWrite(ev)) as Record<string, unknown>;
    ok(JSON.stringify(body.reminders) === JSON.stringify({ useDefault: false, overrides: [] }) && body.transparency === "opaque" &&
       (body.extendedProperties as { private: Record<string, string> }).private.peakDrive === "1",
      "drive-time final: a drive event is written with no reminders and as busy (opaque)");
    const plain = eventWriteBody({ title: "Lunch", startMs: at(12), endMs: at(13) }) as Record<string, unknown>;
    ok(plain.reminders === undefined && plain.transparency === undefined, "drive-time final: other event writes are unchanged (no reminders/transparency sent)");
    ok(deleteEventPath("ev 1", "none") === "/calendars/primary/events/ev%201?sendUpdates=none" && deleteEventPath("ev1") === "/calendars/primary/events/ev1?sendUpdates=all",
      "drive-time final: deleteEvent takes a sendUpdates parameter (default all, unchanged for other callers)");
    ok(/deleteEvent:\s*\(key, id\) => deleteEvent\(key, id, \{ sendUpdates: "none" \}\)/.test(read("src/lib/drive-sync/sync.ts")),
      "drive-time final: the drive sync's deletes (drive + D144) send no updates");
  });

  // ---- 5f. The company page ----
  await group("company page", () => {
    const src = read("src/app/(app)/companies/[id]/page.tsx");
    const lastImport = src.lastIndexOf("\nimport ");
    const md = src.indexOf("export const maxDuration");
    ok(md > lastImport && md > 0, "drive-time final: the company page's maxDuration sits below every import");
    ok(/try \{\s*visitAddr = await addressStatesForVisits\(/.test(src), "drive-time final: the company page's address lookup is guarded (a failure → no flags, page still renders)");
  });

  // ---- 5g. Rescheduling a visit moves its Google copy instead of adding another ----
  await group("visit reschedule", async () => {
    const calls: string[] = [];
    const cal = {
      insertEvent: async (_k: string, ev: { title: string }) => { calls.push("insert:" + ev.title); return { id: "g-new", htmlLink: "" }; },
      updateEvent: async (_k: string, id: string) => { calls.push("update:" + id); return { id, htmlLink: "" }; },
      deleteEvent: async (_k: string, id: string) => { calls.push("delete:" + id); },
    };
    const ev = { title: "Gym — Survey", startMs: at(9), endMs: at(10) };
    const moved = await writeVisitCalendarEvent("personal:u1", "g-old", ev, cal);
    ok(moved.id === "g-old" && calls.join() === "update:g-old", "drive-time final: a reschedule updates the visit's existing Google event (no second copy)");
    calls.length = 0;
    const first = await writeVisitCalendarEvent("personal:u1", null, ev, cal);
    ok(first.id === "g-new" && calls.join() === "insert:Gym — Survey", "drive-time final: a first schedule inserts as before");
    calls.length = 0;
    const gone = await writeVisitCalendarEvent("personal:u1", "g-old", ev, { ...cal, updateEvent: async (_k: string, id: string) => { calls.push("update:" + id); throw new Error("404"); } });
    ok(gone.id === "g-new" && calls.join() === "update:g-old,delete:g-old,insert:Gym — Survey", "drive-time final: an update that fails removes the old copy, then inserts");
    ok(/writeVisitCalendarEvent\(akey, rec\.googleEventId/.test(read("src/lib/visit-invite.ts")), "drive-time final: dispatchVisitInvite writes through writeVisitCalendarEvent with the visit's googleEventId");
  });

  await db.delete(placeBook).where(like(placeBook.key, "%testdrive%"));
}
