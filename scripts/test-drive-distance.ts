/**
 * Drive distance (#176) — scenario on a SCRATCH PGlite, fetch stubbed.
 * Run only via `npm run test:drive-distance`. Never point at .data/pglite.
 */
import assert from "node:assert/strict";
import { getDb } from "@/db";
import { seedIfEmpty } from "@/db/seed-data";
import { geoCache } from "@/db/schema";
import { setSettings } from "@/lib/settings";
import { routeKey } from "@/lib/geo";
import { compareDrive, driveTitle, fmtDrive, parseDriveSort, type Drive } from "@/lib/drive-format";
import { travelForPoints } from "@/lib/travel-bulk";
import { baseOffice, originOptions, resolveTravelOrigin } from "@/lib/travel-origin";

globalThis.fetch = (async () => new Response("[]", { status: 200 })) as typeof fetch;

async function main() {
  if (!process.env.PGLITE_PATH) throw new Error("Refusing to run without PGLITE_PATH (scratch db).");
  const db = await getDb();
  await seedIfEmpty(db);

  /* ---- fmtDrive / driveTitle ---- */
  assert.equal(fmtDrive({ miles: 62, minutes: 68, source: "routed" }), "62 mi · 1h 8m");
  assert.equal(fmtDrive({ miles: 62, minutes: 68, source: "auto" }), "~62 mi · 1h 8m");
  assert.equal(fmtDrive({ miles: 40, minutes: 45, source: "manual" }), "40 mi · 45m");
  assert.equal(fmtDrive({ miles: 120, minutes: 120, source: "routed" }), "120 mi · 2h");
  assert.equal(fmtDrive({ miles: null, minutes: null, source: "none" }), "—");
  assert.equal(fmtDrive(null), "—");
  assert.equal(fmtDrive({ miles: 1300, minutes: 1200, source: "routed" }), "1,300 mi · 20h");
  assert.match(driveTitle({ miles: 1, minutes: 1, source: "auto" }), /Estimated/);
  assert.match(driveTitle({ miles: 1, minutes: 1, source: "manual" }), /Manual/);
  assert.match(driveTitle(null), /Not located/);
  // #176 fix 5 — hasOrigin === false overrides the wording even for a
  // located cell's shape; every other case (including hasOrigin omitted /
  // true) keeps today's messages.
  assert.match(driveTitle(null, false), /Set a quote origin \(with coordinates\) in Settings → Locations/);
  assert.match(
    driveTitle({ miles: null, minutes: null, source: "none" }, false),
    /Set a quote origin \(with coordinates\) in Settings → Locations/
  );
  assert.match(driveTitle(null, true), /Not located/);
  assert.match(driveTitle({ miles: 1, minutes: 1, source: "manual" }, false), /Manual/, "a located cell keeps its own message even with hasOrigin false");
  console.log("PASS drive: fmtDrive + driveTitle");

  /* ---- parseDriveSort / compareDrive ---- */
  assert.equal(parseDriveSort("near"), "near");
  assert.equal(parseDriveSort("far"), "far");
  assert.equal(parseDriveSort("x"), "");
  assert.equal(parseDriveSort(undefined), "");
  const A: Drive = { miles: 10, minutes: 15, source: "routed" };
  const B: Drive = { miles: 50, minutes: 60, source: "auto" };
  const N: Drive = { miles: null, minutes: null, source: "none" };
  const list = [N, B, A, null];
  assert.deepEqual([...list].sort((x, y) => compareDrive(x, y, "near")).slice(0, 2), [A, B]);
  assert.deepEqual([...list].sort((x, y) => compareDrive(x, y, "far")).slice(0, 2), [B, A]);
  for (const dir of ["near", "far"] as const) {
    const s = [...list].sort((x, y) => compareDrive(x, y, dir));
    assert.ok(s.slice(2).every((d) => !d || d.source === "none"), `unlocated last (${dir})`);
  }
  assert.equal(compareDrive({ miles: 9, minutes: 15, source: "routed" }, A, "near") < 0, true, "tie on minutes → miles");
  assert.equal(compareDrive(A, { ...A }, "near"), 0, "full tie → 0 so the caller can break by name");
  console.log("PASS drive: parseDriveSort + compareDrive");

  /* ---- travelForPoints ---- */
  await setSettings({ offices: [] } as never);
  const none = await travelForPoints([{ id: "p1", lat: 43, lng: -89 }]);
  assert.equal(none.originName, null);
  assert.equal(none.byId.get("p1")?.source, "none", "no origin → none");
  // #176 fix 4 — no quote origin means every cell is "—", even a manual override.
  const noneManual = await travelForPoints([{ id: "p2", lat: 43, lng: -89, travelMiles: 12 }]);
  assert.deepEqual(
    noneManual.byId.get("p2"),
    { miles: null, minutes: null, source: "none" },
    "no origin → manual override still none"
  );

  const madison = { id: "o-mad", name: "Madison Office", street: "", city: "Madison", state: "WI", zip: "", lat: 43.0731, lng: -89.4012, quoteDefault: true };
  const milw = { id: "o-mil", name: "Milwaukee Remote", street: "", city: "Milwaukee", state: "WI", zip: "", lat: 43.0389, lng: -87.9065 };
  await setSettings({ offices: [milw, madison] } as never);
  // A cached real route for point "routed" only.
  const routedTarget = { lat: 43.5, lng: -89.0 };
  await db.delete(geoCache);
  await db.insert(geoCache).values({
    key: routeKey(madison, routedTarget),
    data: { miles: 38, minutes: 44, ts: Date.now() },
    updatedAt: Date.now(),
  });
  const r = await travelForPoints([
    { id: "routed", ...routedTarget },
    { id: "dup", ...routedTarget },
    { id: "auto", lat: 44.0, lng: -89.5 },
    { id: "manual", lat: 44.0, lng: -89.5, travelMiles: 12, travelMin: 20 },
    { id: "city-table", city: "Green Bay", state: "WI" },
    { id: "nowhere", city: "Nowhereville", state: "WI" },
  ]);
  assert.equal(r.originName, "Madison Office", "the quote origin, not the first-listed office");
  assert.deepEqual(r.byId.get("routed"), { miles: 38, minutes: 44, source: "routed" });
  assert.deepEqual(r.byId.get("dup"), { miles: 38, minutes: 44, source: "routed" }, "shared key reused");
  assert.equal(r.byId.get("auto")?.source, "auto");
  assert.ok((r.byId.get("auto")?.miles ?? 0) > 0);
  assert.deepEqual(r.byId.get("manual"), { miles: 12, minutes: 20, source: "manual" });
  assert.equal(r.byId.get("city-table")?.source, "auto", "19-city fallback via coordsOf, same as elsewhere");
  assert.equal(r.byId.get("nowhere")?.source, "none");
  assert.equal((await travelForPoints([])).byId.size, 0);
  console.log("PASS drive: travelForPoints");

  /* ---- resolveTravelOrigin ---- */
  {
    const offs = [
      { id: "o-mil", name: "Milwaukee Remote", lat: 43.0389, lng: -87.9065 },
      { id: "o-mad", name: "Madison Office", lat: 43.0731, lng: -89.4012, quoteDefault: true },
      { id: "o-nocoords", name: "Pop-up", lat: null, lng: null },
    ];
    const hit = async (q: string) => (q.includes("Baraboo") ? [{ lat: 43.47, lng: -89.74 }] : []);
    assert.equal(baseOffice(offs, null)?.id, "o-mad", "no based-out-of → quote origin");
    assert.equal(baseOffice(offs, "o-mil")?.id, "o-mil", "based-out-of wins");
    assert.equal(baseOffice(offs, "o-gone")?.id, "o-mad", "unknown based-out-of → quote origin");

    // #176 fix 3 — travelOriginOptionsAction must only list offices with coordinates.
    const opts = originOptions(offs, null);
    assert.equal(opts.base?.id, "o-mad", "base unchanged");
    assert.equal(opts.offices.length, 2, "the no-coords office is excluded");
    assert.ok(!opts.offices.some((o) => o.id === "o-nocoords"), "null lat/lng office excluded");

    const typed = await resolveTravelOrigin({ address: "  123 Oak St, Baraboo, WI " }, { offices: offs, search: hit });
    assert.deepEqual(typed, { origin: { name: "123 Oak St, Baraboo, WI", lat: 43.47, lng: -89.74 } });

    const miss = await resolveTravelOrigin({ address: "Nowhere Rd" }, { offices: offs, baseOfficeId: "o-mil", search: hit });
    assert.equal(miss.origin?.name, "Milwaukee Remote");
    assert.equal(miss.note, "Couldn’t find “Nowhere Rd”, so this is measured from Milwaukee Remote.");

    const office = await resolveTravelOrigin({ officeId: "o-mil" }, { offices: offs, search: hit });
    assert.equal(office.origin?.name, "Milwaukee Remote");
    const noCoords = await resolveTravelOrigin({ officeId: "o-nocoords" }, { offices: offs, search: hit });
    assert.equal(noCoords.origin?.name, "Madison Office", "office without coords → base");
    const blank = await resolveTravelOrigin({ address: "   " }, { offices: offs, search: hit });
    assert.equal(blank.origin?.name, "Madison Office");
    assert.equal(blank.note, undefined);
    assert.deepEqual(await resolveTravelOrigin(undefined, { offices: [], search: hit }), { origin: null });

    // #176 fix 6 — test gaps: no offices at all, and a rejecting search.
    const typedHitNoOffices = await resolveTravelOrigin(
      { address: "123 Oak St, Baraboo, WI" },
      { offices: [], search: hit }
    );
    assert.deepEqual(typedHitNoOffices, {
      origin: { name: "123 Oak St, Baraboo, WI", lat: 43.47, lng: -89.74 },
    });

    const typedMissNoOffices = await resolveTravelOrigin(
      { address: "Nowhere Rd" },
      { offices: [], search: hit }
    );
    assert.deepEqual(typedMissNoOffices, { origin: null });

    const rejects = async (): Promise<Array<{ lat: number; lng: number }>> => {
      throw new Error("search unavailable");
    };
    const rejected = await resolveTravelOrigin(
      { address: "123 Oak St, Baraboo, WI" },
      { offices: offs, baseOfficeId: "o-mil", search: rejects }
    );
    assert.equal(rejected.origin?.name, "Milwaukee Remote", "rejecting search falls back to base");
    assert.equal(
      rejected.note,
      "Couldn’t find “123 Oak St, Baraboo, WI”, so this is measured from Milwaukee Remote."
    );
    console.log("PASS drive: resolveTravelOrigin");
  }

  console.log("ALL PASSED");
}

main().then(() => process.exit(0), (e) => { console.error("FAIL", e); process.exit(1); });
