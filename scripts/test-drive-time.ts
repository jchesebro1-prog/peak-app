/* Address verification + automatic drive time — spec checks
   (docs/superpowers/specs/2026-10-09-address-verification-drive-time-design.md).
   Chained from test-review-and-spec.ts. Pure rules only so far; later tasks
   add the DB-backed checks here. */
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "@/db";
import { placeBook, sites } from "@/db/schema";
import { saveSite } from "@/lib/identity/sites";
import { ensureVenueGeoStatus } from "@/lib/address-verify/venue-geo";
import { locateVenue } from "@/lib/venue-locate";
import { getPlaces, placeStatesFor, writePlace, fixPlace } from "@/lib/address-verify/place-book";
import { addressStatesForVisits, matchVisitSite } from "@/lib/address-verify/targets";
import { cleanFixInput, fixAddress } from "@/lib/address-verify/fix";
import { searchOrThrow, type GeoSearchHit } from "@/lib/geo";
import { addressKey, isPhysicalLocation } from "@/lib/address-verify/keys";
import {
  backfillStatus,
  geocodedStatus,
  hasHouseNumber,
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
  globalThis.fetch = (async () => {
    throw new Error("offline in test");
  }) as typeof fetch;
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

    ok(cleanFixInput({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 44, lng: -88 }) !== null, "drive-time cleanFixInput: a well-formed pin passes");
    ok(cleanFixInput({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 200, lng: -88 }) === null &&
       cleanFixInput({ target: { kind: "place", key: "x" }, mode: "retry" }) === null &&
       cleanFixInput({ target: { kind: "bogus" }, mode: "pin", lat: 1, lng: 1 }) === null &&
       cleanFixInput("junk") === null,
      "drive-time cleanFixInput: out-of-range coords, missing fields and unknown kinds are refused");
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(sites).where(eq(sites.id, SITE));
    await db.delete(placeBook).where(like(placeBook.key, "testdrive%"));
  }
}
