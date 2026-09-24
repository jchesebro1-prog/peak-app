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
import { sites } from "@/db/schema";
import { setSettings } from "@/lib/settings";
import { backfillVenueCoords, cleanStreet, warmRoutes } from "@/lib/geo-backfill";

type Hit = { lat: number; lng: number; city: string; state: string; road?: string };

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
            address: { house_number: "1", road: m.hit.road || "Road", city: m.hit.city, state: m.hit.state },
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

  console.log(`ALL PASSED (${calls} stubbed fetches)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("FAIL", e);
    process.exit(1);
  }
);
