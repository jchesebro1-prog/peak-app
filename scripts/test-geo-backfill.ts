/**
 * Geo backfill — scenario on a SCRATCH PGlite with `fetch` stubbed, so no
 * request ever reaches Nominatim or OSRM. Run only via
 * `npm run test:geo-backfill` (which sets PGLITE_PATH to a mktemp dir).
 * Never point this at .data/pglite.
 *
 * Covers the three ways the Settings → Admin "Geocode addresses" runner left
 * prod at 3 of 1,480 venues located (2026-09-24):
 *   1. failed lookups stayed at the head of every batch, so once `limit` of
 *      them piled up the runner re-asked the same dead addresses forever;
 *   2. suite / STE / P.O. Box fragments made Nominatim miss real buildings;
 *   3. a building whose POSTAL city differs from its municipality (8301 Old
 *      Sauk Rd, Middleton → OSM says Madison) was rejected by the city gate.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, geoCache, sites } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed-data";
import { setSettings } from "@/lib/settings";
import {
  backfillVenueCoords,
  cleanCity,
  cleanStreet,
  fallbackStreet,
  geocodeVenue,
  newGeocodeCtx,
  warmRoutes,
} from "@/lib/geo-backfill";
import { listUnlocatedVenues, locateVenue } from "@/lib/venue-locate";

type Hit = { lat: number; lng: number; city: string; state: string; road?: string; zip?: string };

/** Nominatim answers keyed by a predicate on the decoded URL. */
const nominatim: Array<{ when: (u: URL) => boolean; hit: Hit }> = [];
/** OSRM destinations (lng,lat as sent) that should fail. */
const osrmDead = new Set<string>();
let calls = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const u = new URL(String(input));
  calls++;
  if (u.hostname === "nominatim.openstreetmap.org") {
    const m = nominatim.find((n) => n.when(u));
    const body = m
      ? [
          {
            lat: String(m.hit.lat),
            lon: String(m.hit.lng),
            category: "building",
            name: "",
            display_name: `${m.hit.city}, ${m.hit.state}`,
            address: {
              house_number: "1",
              road: m.hit.road || "Road",
              city: m.hit.city,
              state: m.hit.state,
              ...(m.hit.zip ? { postcode: m.hit.zip } : {}),
            },
          },
        ]
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  }
  if (u.hostname === "router.project-osrm.org") {
    const dest = decodeURIComponent(u.pathname).split(";")[1];
    if (osrmDead.has(dest)) return new Response("{}", { status: 502 });
    return new Response(JSON.stringify({ routes: [{ distance: 16093.4, duration: 900 }] }), { status: 200 });
  }
  return realFetch(input);
}) as typeof fetch;

const q = (u: URL) => (u.searchParams.get("q") || "").toLowerCase();
const cityParam = (u: URL) => (u.searchParams.get("city") || "").toLowerCase();

async function insertSite(id: string, fields: Partial<typeof sites.$inferInsert>) {
  const db = await getDb();
  const now = Date.now();
  await db.insert(sites).values({ id, companyId: "co-" + id, createdAt: now, updatedAt: now, ...fields });
}

async function coordsOf(id: string) {
  const db = await getDb();
  const [r] = await db.select().from(sites).where(eq(sites.id, id));
  return r?.lat && r?.lng ? { lat: Number(r.lat), lng: Number(r.lng) } : null;
}

async function main() {
  if (!process.env.PGLITE_PATH) throw new Error("Refusing to run without PGLITE_PATH (scratch db).");
  const db = await getDb();
  await seedIfEmpty(db);
  await db.delete(sites);

  /* ---- cleanStreet: suite / unit / PO-box fragments are noise to a geocoder ---- */
  assert.equal(cleanStreet("558 Eisenhower Dr., STE G"), "558 Eisenhower Dr.");
  assert.equal(cleanStreet("605 Erie Avenue Suite 101"), "605 Erie Avenue");
  assert.equal(cleanStreet("10859 W. Bluemound Road, Suite 200"), "10859 W. Bluemound Road");
  assert.equal(cleanStreet("124 Monroe Street P.O. Box 55"), "124 Monroe Street");
  assert.equal(cleanStreet("1309 Norplex Road, Suite 2"), "1309 Norplex Road");
  assert.equal(cleanStreet("3128 Graydon Ave,"), "3128 Graydon Ave");
  assert.equal(cleanStreet("P.O. Box 615"), "", "a PO box alone is not a building");
  assert.equal(cleanStreet("PO Box 12"), "");
  assert.equal(cleanStreet("100 Main St #4"), "100 Main St");
  assert.equal(cleanStreet("100 Main St, Apt 3B"), "100 Main St");
  assert.equal(cleanStreet("2211 Parmenter Street"), "2211 Parmenter Street", "clean addresses pass untouched");
  assert.equal(cleanStreet("W185 S8750 Racine Ave."), "W185 S8750 Racine Ave.", "Wisconsin grid addresses are not suites");
  assert.equal(cleanStreet("1 Stewart Street"), "1 Stewart Street", "'Ste' only matches as its own word");
  // A designator word followed by a street-type word is a street NAME, not a
  // unit — a unit id has a digit or is a single letter (STE G, Apt 3B).
  assert.equal(cleanStreet("300 Room Rd"), "300 Room Rd");
  assert.equal(cleanStreet("12 Floor St"), "12 Floor St");
  assert.equal(cleanStreet("200 Unity Dr"), "200 Unity Dr");
  assert.equal(cleanStreet("100 Floral Ave"), "100 Floral Ave");
  assert.equal(cleanStreet("200 Main St Suite A"), "200 Main St");
  assert.equal(cleanStreet("Hwy 12 #3"), "Hwy 12");
  console.log("PASS geo-backfill: cleanStreet");

  /* ---- #185: fallbackStreet / cleanCity — only used by the fallback lookup ---- */
  // Moved from cleanStreet (fix round 1, item 2): attempt 1's query must stay
  // byte-identical to before #185, so parenthesised asides, a pasted label
  // before a colon, and bare box/mail-drop/building numbers are cleaned up
  // only in the fallback street, never in cleanStreet itself.
  assert.equal(
    fallbackStreet("120 East Lake Park Place, (see const. site address under comments)", "X"),
    "120 East Lake Park Place"
  );
  assert.equal(fallbackStreet("1142 Pine Street (Across From Pizza Ranch On Hwy 12)", "X"), "1142 Pine Street");
  assert.equal(fallbackStreet("Blaines home address:, 1523 Harvest Lane", "Reedsburg"), "1523 Harvest Lane");
  assert.equal(fallbackStreet("110 Main St.  Box 231", "X"), "110 Main St.");
  assert.equal(fallbackStreet("600 Highland Ave.  Mail Drop 3248", "X"), "600 Highland Ave.");
  assert.equal(fallbackStreet("500 E Veterans, Building 401", "X"), "500 E Veterans");
  // The tightened colon rule (item 2): cut at the last colon only when the
  // text after it has a digit and the text before it does not; otherwise
  // remove only the colon character, so the suite rule still gets a shot.
  assert.equal(fallbackStreet("100 Main St, Suite: 4", "X"), "100 Main St");
  assert.ok(
    fallbackStreet("100 Main St Loading Dock: Rear", "X").includes("100 Main St"),
    "a colon with no digit after it must not eat the real street"
  );
  assert.equal(
    fallbackStreet("New Heights Lutheran Parish (NEW NAME), 1705 Center Street", "Black Earth"),
    "1705 Center Street"
  );
  assert.equal(
    fallbackStreet("TSL Clark Street Campus (Grades 5 to 8) 303 Clark Street", "Watertown"),
    "303 Clark Street"
  );
  assert.equal(
    fallbackStreet("3317 Business Park Drive Stevens Point, WI 54482", "Stevens Point"),
    "3317 Business Park Drive"
  );
  assert.equal(fallbackStreet("7 S Dewey St  Eau Claire, WI 54701", "Eau Claire"), "7 S Dewey St");
  assert.equal(fallbackStreet("Highway 51 North", "X"), "Highway 51 North", "road word — untouched");
  assert.equal(fallbackStreet("Old Highway 51", "X"), "Old Highway 51", "no street word after the number — untouched");
  assert.equal(fallbackStreet("W185 S8750 Racine Ave.", "Muskego"), "W185 S8750 Racine Ave.");
  assert.equal(fallbackStreet("2302 International Drive", "Madison"), "2302 International Drive");
  // Minors (item 6): a trailing-city strip must not eat a place name that's
  // merely a SUBSTRING of the street's last word ("Jerome" ends in "rome").
  assert.equal(fallbackStreet("100 Jerome", "Rome"), "100 Jerome", "'Rome' inside 'Jerome' is not a city match");
  // Minors (item 6): the trailing state+zip strip needs a word boundary, or
  // "Stre" + "et 53703" reads as a fake two-letter state code.
  assert.equal(
    fallbackStreet("100 Main Street 53703", "X"),
    "100 Main Street 53703",
    "no state+zip in this string — must not chew into 'Street'"
  );
  // Minors (item 6): WI county/state trunk highway abbreviations are road
  // words too, same as "highway"/"county"/"road".
  assert.equal(fallbackStreet("CTH 100 Lakeview", "X"), "CTH 100 Lakeview", "cth — road word, untouched");
  assert.equal(fallbackStreet("Sth 51 South", "X"), "Sth 51 South", "sth — road word, untouched");
  assert.equal(fallbackStreet("Ush 12 East", "X"), "Ush 12 East", "ush — road word, untouched");
  assert.equal(fallbackStreet("Trunk 51 North", "X"), "Trunk 51 North", "trunk — road word, untouched");
  assert.equal(fallbackStreet("Cr 20 Valley", "X"), "Cr 20 Valley", "cr — road word, untouched");
  assert.equal(fallbackStreet("Sr 33 Ridge", "X"), "Sr 33 Ridge", "sr — road word, untouched");
  assert.equal(cleanCity("Rome (Sullivan)"), "Rome");
  assert.equal(cleanCity("Wisc. Dells"), "Wisconsin Dells");
  assert.equal(cleanCity("Stevens Point,"), "Stevens Point");
  assert.equal(cleanCity("Madison"), "Madison");
  console.log("PASS geo-backfill: fallbackStreet / cleanCity");

  /* ---- 1. the runner must get PAST failures, not re-ask them forever ---- */
  // Twelve dead addresses first (more than one batch), then five good ones.
  for (let i = 0; i < 12; i++)
    await insertSite(`st-dead-${String(i).padStart(2, "0")}`, { address: `${i + 1} Nowhere Ln`, city: "Deadville", state: "WI" });
  for (let i = 0; i < 5; i++)
    await insertSite(`st-good-${i}`, { address: `${i + 1} Good St`, city: "Goodtown", state: "WI" });
  nominatim.push({
    when: (u) => q(u).includes("good st"),
    hit: { lat: 43.1, lng: -89.4, city: "Goodtown", state: "Wisconsin" },
  });

  // Drive it exactly the way the Settings runner does: bounded batches, each
  // told which queries already failed this run, until nothing remains.
  const skip: string[] = [];
  let batches = 0;
  for (; batches < 20; batches++) {
    const r = await backfillVenueCoords({ limit: 10, dryRun: false, delayMs: 0, skipQueries: skip });
    for (const f of r.failures) if (!skip.includes(f.query)) skip.push(f.query);
    if (!r.remaining) break;
  }
  assert.ok(batches < 20, `runner must terminate (ran ${batches} batches)`);
  for (let i = 0; i < 5; i++)
    assert.ok(await coordsOf(`st-good-${i}`), `st-good-${i} is geocoded even though 12 failures sorted ahead of it`);
  assert.equal(skip.length, 12, "every dead address is reported exactly once");
  console.log("PASS geo-backfill: runner gets past failed lookups");

  /* ---- 2. suite fragments are stripped before the lookup ---- */
  await insertSite("st-suite", { address: "605 Erie Avenue Suite 101", city: "Sheboygan", state: "WI" });
  nominatim.push({
    when: (u) => q(u) === "605 erie avenue, sheboygan, wi",
    hit: { lat: 43.75, lng: -87.71, city: "Sheboygan", state: "Wisconsin" },
  });
  // A PO box alone resolves at city level through the structured query.
  await insertSite("st-pobox", { address: "P.O. Box 615", city: "Reedsburg", state: "WI" });
  nominatim.push({
    when: (u) => cityParam(u) === "reedsburg",
    hit: { lat: 43.532, lng: -90.003, city: "Reedsburg", state: "Wisconsin" },
  });
  const r2 = await backfillVenueCoords({ limit: 50, dryRun: false, delayMs: 0, skipQueries: skip });
  assert.ok(await coordsOf("st-suite"), "suite address geocodes once the suite is dropped");
  assert.ok(await coordsOf("st-pobox"), "PO-box-only venue geocodes to its town");
  assert.equal(r2.geocodedCity, 1, "the PO-box venue is counted as city precision, not building");
  console.log("PASS geo-backfill: street cleanup + PO box precision");

  /* ---- 3. postal city ≠ municipality: accept a nearby building, reject a far one ---- */
  // Middleton town centre, and a building OSM files under Madison 2 miles away.
  nominatim.push({
    when: (u) => cityParam(u) === "middleton",
    hit: { lat: 43.0972, lng: -89.5043, city: "Middleton", state: "Wisconsin" },
  });
  await insertSite("st-postal", { address: "8301 Old Sauk Road", city: "Middleton", state: "WI" });
  nominatim.push({
    when: (u) => q(u).startsWith("8301 old sauk road"),
    hit: { lat: 43.0712, lng: -89.4906, city: "Madison", state: "Wisconsin" },
  });
  // Same street name, wrong town: a "Main St" 60+ miles from Portage.
  nominatim.push({
    when: (u) => cityParam(u) === "portage",
    hit: { lat: 43.5391, lng: -89.4626, city: "Portage", state: "Wisconsin" },
  });
  await insertSite("st-far", { address: "100 Main St", city: "Portage", state: "WI" });
  nominatim.push({
    when: (u) => q(u).startsWith("100 main st, portage"),
    hit: { lat: 44.5236, lng: -89.5746, city: "Stevens Point", state: "Wisconsin" },
  });
  const r3 = await backfillVenueCoords({ limit: 50, dryRun: false, delayMs: 0, skipQueries: skip });
  assert.ok(await coordsOf("st-postal"), "a building 2 mi from its stated town is accepted despite the postal city");
  assert.equal(await coordsOf("st-far"), null, "a same-named street 68 mi away is still rejected");
  assert.ok(
    r3.failures.some((f) => f.siteId === "st-far" && f.reason === "city-mismatch"),
    "the far match is reported as a city mismatch"
  );
  console.log("PASS geo-backfill: postal-city distance gate");

  /* ---- 4. warmRoutes must also get past failed routes ---- */
  await setSettings({
    offices: [{ id: "o1", name: "Reedsburg", city: "Reedsburg", state: "WI", lat: 43.532, lng: -90.003, quoteDefault: true }],
  } as never);
  // Make the first twelve distinct venue coordinates unroutable.
  await db.delete(sites);
  for (let i = 0; i < 12; i++) {
    const lat = (43 + i / 100).toFixed(4);
    await insertSite(`st-r-dead-${String(i).padStart(2, "0")}`, { city: "X", state: "WI", lat, lng: "-89.0000" });
    osrmDead.add(`-89,${Number(lat)}`);
  }
  for (let i = 0; i < 3; i++)
    await insertSite(`st-r-good-${i}`, { city: "X", state: "WI", lat: (44 + i / 100).toFixed(4), lng: "-89.0000" });
  const skipKeys: string[] = [];
  let rb = 0;
  let warmed = 0;
  for (; rb < 20; rb++) {
    const r = await warmRoutes({ limit: 10, dryRun: false, delayMs: 0, skipKeys });
    warmed += r.warmed;
    for (const k of r.failedKeys) if (!skipKeys.includes(k)) skipKeys.push(k);
    if (!r.remaining) break;
  }
  assert.ok(rb < 20, `route runner must terminate (ran ${rb} batches)`);
  assert.equal(warmed, 3, "the three routable venues are warmed despite twelve failures ahead of them");
  assert.equal(skipKeys.length, 12);
  console.log("PASS geo-backfill: route runner gets past failed routes");

  /* ---- 5. geocodeVenue: the one-venue path the sidebar's Retry uses ---- */
  {
    const ctx = newGeocodeCtx(0);
    const ok = await geocodeVenue({ address: "605 Erie Avenue Suite 101", city: "Sheboygan", state: "WI" }, ctx);
    assert.ok(ok.ok && ok.precision === "building", "suite address resolves at building precision");
    const miss = await geocodeVenue({ address: "9 Nowhere Ln", city: "Deadville", state: "WI" }, ctx);
    assert.deepEqual(miss, { ok: false, reason: "no-hit" });
    nominatim.push({
      when: (u) => q(u).startsWith("1 wrongstate rd"),
      hit: { lat: 41.9, lng: -87.6, city: "Chicago", state: "Illinois" },
    });
    const st = await geocodeVenue({ address: "1 Wrongstate Rd", city: "Madison", state: "WI" }, ctx);
    assert.ok(!st.ok && st.reason === "state-mismatch" && st.got === "Chicago, IL");
    const far = await geocodeVenue({ address: "100 Main St", city: "Portage", state: "WI" }, ctx);
    assert.ok(!far.ok && far.reason === "city-mismatch", "far same-name street still rejected");
    const town = await geocodeVenue({ address: "P.O. Box 615", city: "Reedsburg", state: "WI" }, ctx);
    assert.ok(town.ok && town.precision === "city");
    console.log("PASS geo-backfill: geocodeVenue single-venue outcomes");
  }

  /* ---- 5b. geocodeVenue: fallback chain for messy addresses (#185, D235) ---- */
  {
    // Attempt 1 gets no hit; the no-city fallback ("<street>, WI <zip>")
    // finds it. The stated city ("Madison") happens to match the hit anyway.
    const ctxA = newGeocodeCtx(0);
    const callsBeforeA = calls;
    nominatim.push({
      when: (u) => q(u) === "6911 mangrove lane, wi 53713",
      hit: { lat: 43.05, lng: -89.4, city: "Madison", state: "Wisconsin", zip: "53713" },
    });
    const a = await geocodeVenue({ address: "6911 Mangrove Lane", city: "Madison", state: "WI", zip: "53713" }, ctxA);
    assert.ok(a.ok && a.precision === "building", "no-city fallback finds the building");
    assert.equal(calls - callsBeforeA, 2, "attempt 1 (miss) + attempt 3 (no-city hit); attempt 2 is identical to attempt 1 and skipped");

    // Typo city ("Sun Prarie" vs OSM's "Sun Prairie"): attempt 1 misses,
    // attempt 3's hit disagrees on city text but the zip gate accepts it.
    const ctxB = newGeocodeCtx(0);
    nominatim.push({
      when: (u) => q(u) === "3467 capitol dr., wi 53590",
      hit: { lat: 43.18, lng: -89.21, city: "Sun Prairie", state: "Wisconsin", zip: "53590" },
    });
    const b = await geocodeVenue(
      { address: "3467 Capitol Dr.", city: "Sun Prarie", state: "WI", zip: "53590" },
      ctxB
    );
    assert.ok(b.ok, "typo city accepted via the zip gate");

    // The zip gate does not over-accept: attempt 1 itself hits the wrong
    // town (city-mismatch), and the no-city fallback's hit is in yet another
    // town with a different zip — still rejected, and the reported reason is
    // attempt 1's own ("reports stay meaningful").
    const ctxC = newGeocodeCtx(0);
    nominatim.push({
      when: (u) => q(u) === "1 typo trail, sun prarie, wi 53591",
      hit: { lat: 45.0, lng: -91.0, city: "FarAway", state: "Wisconsin", zip: "53001" },
    });
    nominatim.push({
      when: (u) => q(u) === "1 typo trail, wi 53591",
      hit: { lat: 44.0, lng: -90.0, city: "Elsewhere", state: "Wisconsin", zip: "53000" },
    });
    const c = await geocodeVenue({ address: "1 Typo Trail", city: "Sun Prarie", state: "WI", zip: "53591" }, ctxC);
    assert.ok(
      !c.ok && c.reason === "city-mismatch" && c.got === "FarAway, WI",
      "every attempt fails; attempt 1's own city-mismatch is reported"
    );

    // A label address: attempt 1 (full street text) misses; attempt 2 (the
    // label stripped by fallbackStreet, city included) hits.
    const ctxD = newGeocodeCtx(0);
    const callsBeforeD = calls;
    nominatim.push({
      when: (u) => q(u) === "303 clark street, watertown, wi 53094",
      hit: { lat: 43.19, lng: -88.72, city: "Watertown", state: "Wisconsin", zip: "53094" },
    });
    const d = await geocodeVenue(
      { address: "TSL Clark Street Campus (Grades 5 to 8) 303 Clark Street", city: "Watertown", state: "WI", zip: "53094" },
      ctxD
    );
    assert.ok(d.ok, "label stripped by attempt 2 finds the building");
    assert.equal(calls - callsBeforeD, 2, "attempt 1 (miss) + attempt 2 (hit); attempt 3 never runs");

    // City-precision rows are untouched by the fallback chain: a stubbed
    // miss still reports no-hit and costs exactly one request.
    const ctxE = newGeocodeCtx(0);
    const callsBeforeE = calls;
    const e = await geocodeVenue({ address: "", city: "Nowheretown", state: "WI", zip: "53000" }, ctxE);
    assert.deepEqual(e, { ok: false, reason: "no-hit" });
    assert.equal(calls - callsBeforeE, 1, "city precision makes exactly one request, no fallback");

    // #185 item 3: a degenerate fallback street (empty, or after cleanup has
    // no digit / no real street-name text) must skip the fallbacks entirely
    // rather than burn two more requests on a query that can't improve on
    // attempt 1 — here the "address" field is really just the city restated,
    // so fallbackStreet strips it down to "".
    const ctxH = newGeocodeCtx(0);
    const callsBeforeH = calls;
    const h = await geocodeVenue(
      { address: "Stevens Point, WI 54481", city: "Stevens Point", state: "WI", zip: "54481" },
      ctxH
    );
    assert.ok(!h.ok, "a degenerate fallback street is not geocoded via fallback");
    assert.equal(calls - callsBeforeH, 1, "only attempt 1's request is made; fallbacks are skipped");

    // #185 item 4: the zip gate must not wave through a hit that's merely in
    // the same zip as the row but nowhere near the stated town. "Middleton"
    // resolves to a real centre (registered above); the no-city fallback's
    // hit shares the row's zip but sits 100+ miles away in "FarTown" — reject.
    const ctxM = newGeocodeCtx(0);
    nominatim.push({
      when: (u) => q(u) === "500 far zip dr, wi 53562",
      hit: { lat: 44.5, lng: -91.0, city: "FarTown", state: "Wisconsin", zip: "53562" },
    });
    const m = await geocodeVenue(
      { address: "500 Far Zip Dr", city: "Middleton", state: "WI", zip: "53562" },
      ctxM
    );
    assert.ok(!m.ok, "a same-zip hit far from the resolvable stated-town centre is rejected");

    // #185 item 5: with nothing to compare a city against (the stated city
    // cleans to ""), a fallback attempt must fall back to the zip alone —
    // never accept unconditionally just because there's no city text.
    const ctxI = newGeocodeCtx(0);
    nominatim.push({
      when: (u) => q(u) === "42 blank city rd, wi 53020",
      hit: { lat: 45.5, lng: -92.5, city: "SomeTown", state: "Wisconsin", zip: "53099" },
    });
    const i1 = await geocodeVenue(
      { address: "42 Blank City Rd", city: "(Unknown)", state: "WI", zip: "53020" },
      ctxI
    );
    assert.deepEqual(i1, { ok: false, reason: "no-hit" }, "no city to gate on and a mismatched zip is rejected");

    const ctxJ = newGeocodeCtx(0);
    nominatim.push({
      when: (u) => q(u) === "43 blank city rd, wi 53021",
      hit: { lat: 45.5, lng: -92.5, city: "SomeTown", state: "Wisconsin", zip: "53021" },
    });
    const j1 = await geocodeVenue(
      { address: "43 Blank City Rd", city: "(Unknown)", state: "WI", zip: "53021" },
      ctxJ
    );
    assert.ok(j1.ok, "no city to gate on but a matching zip is accepted");

    console.log("PASS geo-backfill: geocodeVenue fallback chain");
  }

  /* ---- 6. worklist query ---- */
  await db.delete(sites);
  await db.delete(companies);
  const now = Date.now();
  await db.insert(companies).values([
    { id: "co-a", name: "Acme Theatre", createdAt: now, updatedAt: now },
    { id: "co-b", name: "Beta School", createdAt: now, updatedAt: now },
  ]);
  const site = (id: string, companyId: string, f: Partial<typeof sites.$inferInsert>) =>
    db.insert(sites).values({ id, companyId, createdAt: now, updatedAt: now, ...f });
  await site("st-w1", "co-b", { name: "Gym", address: "1302 South Broadway", city: "DePere", state: "WI" });
  await site("st-w2", "co-a", { name: "", address: "", city: "Muskego", state: "WI", lat: "" });
  await site("st-located", "co-a", { address: "1 A St", city: "X", state: "WI", lat: "43", lng: "-89" });
  await site("st-deleted", "co-a", { address: "2 A St", city: "X", state: "WI", deleted: true });
  await site("st-manual", "co-a", { address: "3 A St", city: "X", state: "WI", travelMiles: "40" });
  await site("st-noaddr", "co-a", { address: "", city: "" });
  const wl = await listUnlocatedVenues({});
  assert.deepEqual(wl.rows.map((r) => r.siteId), ["st-w2", "st-w1"], "ordered by company then venue; only fixable rows");
  assert.equal(wl.total, 2);
  assert.equal(wl.noAddress, 1, "the address-less venue is counted, not listed");
  assert.equal(wl.rows[1].companyName, "Beta School");
  assert.deepEqual((await listUnlocatedVenues({ q: "broadway" })).rows.map((r) => r.siteId), ["st-w1"]);
  assert.deepEqual((await listUnlocatedVenues({ q: "acme" })).rows.map((r) => r.siteId), ["st-w2"]);
  assert.deepEqual((await listUnlocatedVenues({ offset: 1, limit: 1 })).rows.map((r) => r.siteId), ["st-w1"]);
  console.log("PASS geo-backfill: unlocated worklist query");

  // #175 D228 item 4: estimateFromParts() only treats travelMiles as a manual
  // override (src/lib/geo.ts) — travelMin alone is not one, so the worklist
  // must not exclude a venue just because travelMin is set.
  await site("st-travelmin-only", "co-a", { address: "9 TravelMin St", city: "X", state: "WI", travelMin: "45" });
  assert.deepEqual(
    (await listUnlocatedVenues({ q: "travelmin" })).rows.map((r) => r.siteId),
    ["st-travelmin-only"],
    "a venue with only travelMin set and no coordinates is still listed"
  );
  console.log("PASS geo-backfill: travelMin-only override does not hide the worklist row");

  // #175 item 7: a literal % or _ in the search box must not act as a SQL
  // wildcard against unrelated rows.
  assert.equal((await listUnlocatedVenues({ q: "%" })).rows.length, 0, "a literal % matches nothing here");
  assert.equal((await listUnlocatedVenues({ q: "_" })).rows.length, 0, "a literal _ matches nothing here");
  console.log("PASS geo-backfill: search % and _ are escaped, not wildcards");
  // Test-only row for item 4/7 above — remove it so later "worklist is empty"
  // assertions aren't thrown off by it.
  await db.delete(sites).where(eq(sites.id, "st-travelmin-only"));

  /* ---- 7. locateVenue: retry / pick / pin, and nothing else changes ---- */
  const snapshot = async () =>
    JSON.stringify({
      s: (await db.select().from(sites)).sort((a, b) => a.id.localeCompare(b.id)),
      c: (await db.select().from(companies)).sort((a, b) => a.id.localeCompare(b.id)),
    });
  const others = async (exceptId: string) =>
    JSON.stringify({
      s: (await db.select().from(sites)).filter((r) => r.id !== exceptId).sort((a, b) => a.id.localeCompare(b.id)),
      c: (await db.select().from(companies)).sort((a, b) => a.id.localeCompare(b.id)),
    });

  // retry failure writes NOTHING
  const before = await snapshot();
  const rf = await locateVenue(
    { siteId: "st-w1", mode: "retry", address: "1302 South Broadway", city: "DePere", state: "WI", zip: "" },
    { delayMs: 0 }
  );
  assert.deepEqual(rf, { ok: false, reason: "no-hit" });
  assert.equal(await snapshot(), before, "a failed retry writes nothing");

  // retry success writes the corrected address + coordinates, routes, touches nothing else
  nominatim.push({
    when: (u) => q(u).startsWith("1302 south broadway, de pere"),
    hit: { lat: 44.4486, lng: -88.0604, city: "De Pere", state: "Wisconsin" },
  });
  const othersBefore = await others("st-w1");
  const rs = await locateVenue(
    { siteId: "st-w1", mode: "retry", address: "1302 South Broadway", city: "De Pere", state: "WI", zip: "54115" },
    { delayMs: 0 }
  );
  assert.ok(rs.ok && rs.source === "routed" && rs.officeName === "Reedsburg", JSON.stringify(rs));
  const [w1] = await db.select().from(sites).where(eq(sites.id, "st-w1"));
  assert.equal(w1.city, "De Pere");
  assert.equal(w1.zip, "54115");
  assert.equal(w1.lat, "44.4486");
  assert.equal(w1.travelMiles, null, "manual override untouched");
  assert.equal(await others("st-w1"), othersBefore, "no other venue and no company changed");
  const cached = await db.select().from(geoCache);
  assert.ok(cached.some((r) => r.key.endsWith("|44.4486,-88.0604")), "route warmed for the new coordinates");

  // a venue soft-deleted between the SELECT and the UPDATE (retry mode makes
  // paced network calls in between) must be reported gone, not located
  {
    await insertSite("st-vanish", { address: "77 Vanish St", city: "Vanishton", state: "WI" });
    nominatim.push({
      when: (u) => q(u).startsWith("77 vanish st"),
      hit: { lat: 45.0, lng: -89.9, city: "Vanishton", state: "Wisconsin" },
    });
    const stubbedFetch = globalThis.fetch;
    let armed = true;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (armed) {
        armed = false;
        // The lookup that would otherwise resolve this venue races a delete
        // that lands on the DB before the geocoder's answer comes back.
        await db.update(sites).set({ deleted: true }).where(eq(sites.id, "st-vanish"));
      }
      return stubbedFetch(input);
    }) as typeof fetch;
    try {
      const vanished = await locateVenue(
        { siteId: "st-vanish", mode: "retry", address: "77 Vanish St", city: "Vanishton", state: "WI", zip: "" },
        { delayMs: 0 }
      );
      assert.deepEqual(vanished, { ok: false, reason: "gone" });
    } finally {
      globalThis.fetch = stubbedFetch;
    }
    const [vRow] = await db.select().from(sites).where(eq(sites.id, "st-vanish"));
    assert.equal(vRow.lat, null, "lat is still null — the vanished venue was never written");
    console.log("PASS geo-backfill: locateVenue reports gone when the venue vanishes mid-call");
  }

  // pin writes ONLY lat/lng
  const [w2Before] = await db.select().from(sites).where(eq(sites.id, "st-w2"));
  const w2OthersBeforePin = await others("st-w2");
  const pinned = await locateVenue({ siteId: "st-w2", mode: "pin", lat: 42.9, lng: -88.13 });
  assert.ok(pinned.ok);
  assert.equal(await others("st-w2"), w2OthersBeforePin, "pin touches no other row");
  const [w2] = await db.select().from(sites).where(eq(sites.id, "st-w2"));
  assert.equal(w2.lat, "42.9");
  assert.equal(w2.city, "Muskego", "pin leaves the address text alone");
  assert.equal(w2.address, w2Before.address, "pin leaves address unchanged");
  assert.equal(w2.state, w2Before.state, "pin leaves state unchanged");
  assert.equal(w2.zip, w2Before.zip, "pin leaves zip unchanged");
  assert.equal(w2.name, w2Before.name, "pin leaves name unchanged");

  // pick writes every field
  const w2OthersBeforePick = await others("st-w2");
  const pick = await locateVenue({
    siteId: "st-w2", mode: "pick", address: "W185 S8750 Racine Ave", city: "Muskego", state: "WI",
    zip: "53150", lat: 42.8923, lng: -88.1301,
  });
  assert.ok(pick.ok);
  assert.equal(await others("st-w2"), w2OthersBeforePick, "pick touches no other row");
  const [w2b] = await db.select().from(sites).where(eq(sites.id, "st-w2"));
  assert.equal(w2b.address, "W185 S8750 Racine Ave");
  assert.equal(w2b.zip, "53150");
  assert.equal(w2b.lng, "-88.1301");

  // validation
  assert.deepEqual(await locateVenue({ siteId: "st-w2", mode: "pin", lat: 91, lng: 0 }), { ok: false, reason: "invalid" });
  assert.deepEqual(await locateVenue({ siteId: "st-w2", mode: "pin", lat: NaN, lng: 0 }), { ok: false, reason: "invalid" });
  assert.deepEqual(await locateVenue({ siteId: "st-deleted", mode: "pin", lat: 43, lng: -89 }), { ok: false, reason: "gone" });
  assert.deepEqual(await locateVenue({ siteId: "nope", mode: "pin", lat: 43, lng: -89 }), { ok: false, reason: "gone" });
  assert.equal((await listUnlocatedVenues({})).total, 0, "both fixed venues left the worklist");
  console.log("PASS geo-backfill: locateVenue retry / pick / pin");

  /* ---- 8. pick() protects existing address parts (#175 D228 item 2) ---- */
  {
    // A picked suggestion with a blank street (a town-level hit) must not
    // wipe the venue's real street address.
    await insertSite("st-pick-blank-street", {
      address: "100 Original St", city: "Origtown", state: "WI", zip: "12345",
    });
    const p1 = await locateVenue({
      siteId: "st-pick-blank-street", mode: "pick",
      address: "", city: "Newtown", state: "WI", zip: "99999", lat: 43.1, lng: -89.1,
    });
    assert.ok(p1.ok, JSON.stringify(p1));
    const [r1] = await db.select().from(sites).where(eq(sites.id, "st-pick-blank-street"));
    assert.equal(r1.address, "100 Original St", "a blank picked street leaves the stored street alone");
    assert.equal(r1.city, "Newtown", "a non-blank picked city still overwrites");
    assert.equal(r1.zip, "99999");

    // A picked suggestion without a house number (town/area match) must not
    // truncate a real street address either.
    await insertSite("st-pick-no-digit-street", {
      address: "200 Original Ave", city: "Origtown", state: "WI", zip: "12345",
    });
    const p2 = await locateVenue({
      siteId: "st-pick-no-digit-street", mode: "pick",
      address: "South Broadway", city: "De Pere", state: "WI", zip: "54115", lat: 44.4, lng: -88.0,
    });
    assert.ok(p2.ok, JSON.stringify(p2));
    const [r2b] = await db.select().from(sites).where(eq(sites.id, "st-pick-no-digit-street"));
    assert.equal(
      r2b.address,
      "200 Original Ave",
      "a street suggestion with no house number leaves the stored street alone"
    );
    assert.equal(r2b.city, "De Pere");

    // A blank picked zip must not clear a stored zip.
    await insertSite("st-pick-blank-zip", {
      address: "300 Original Blvd", city: "Origtown", state: "WI", zip: "54115",
    });
    const p3 = await locateVenue({
      siteId: "st-pick-blank-zip", mode: "pick",
      address: "1302 South Broadway", city: "De Pere", state: "WI", zip: "", lat: 44.4, lng: -88.0,
    });
    assert.ok(p3.ok, JSON.stringify(p3));
    const [r3b] = await db.select().from(sites).where(eq(sites.id, "st-pick-blank-zip"));
    assert.equal(r3b.address, "1302 South Broadway", "a real house-numbered street still overwrites");
    assert.equal(r3b.zip, "54115", "a blank picked zip leaves the stored zip alone");

    console.log("PASS geo-backfill: pick() never blanks a real street or zip");
  }

  /* ---- 9. precision reported on the result (#175 D228 item 5) ---- */
  {
    // retry: a city-only match reports "city" precision.
    await insertSite("st-precision-city", { address: "", city: "Reedsburg", state: "WI" });
    const rc = await locateVenue(
      { siteId: "st-precision-city", mode: "retry", address: "", city: "Reedsburg", state: "WI", zip: "" },
      { delayMs: 0 }
    );
    assert.ok(rc.ok && rc.precision === "city", "a city-only retry reports city precision");

    // pick: a house-numbered street reports building precision.
    await insertSite("st-precision-pick-building", { address: "", city: "X", state: "WI" });
    const pb = await locateVenue({
      siteId: "st-precision-pick-building", mode: "pick",
      address: "1302 South Broadway", city: "De Pere", state: "WI", zip: "54115", lat: 44.4, lng: -88.0,
    });
    assert.ok(pb.ok && pb.precision === "building", "a house-numbered pick reports building precision");

    // pick: a town-level suggestion (no house number, existing street blank
    // too) reports city precision.
    await insertSite("st-precision-pick-city", { address: "", city: "X", state: "WI" });
    const pc = await locateVenue({
      siteId: "st-precision-pick-city", mode: "pick",
      address: "", city: "De Pere", state: "WI", zip: "54115", lat: 44.4, lng: -88.0,
    });
    assert.ok(pc.ok && pc.precision === "city", "a town-level pick with no stored street reports city precision");

    // pin: always building precision — a human placed the exact point.
    await insertSite("st-precision-pin", { address: "", city: "X", state: "WI" });
    const pp = await locateVenue({ siteId: "st-precision-pin", mode: "pin", lat: 44.4, lng: -88.0 });
    assert.ok(pp.ok && pp.precision === "building", "a pin always reports building precision");

    console.log("PASS geo-backfill: precision reported on retry/pick/pin");
  }

  console.log(`ALL PASSED (${calls} stubbed fetches)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("FAIL", e);
    process.exit(1);
  }
);
