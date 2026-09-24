/**
 * Drive distance (#170) — scenario on a SCRATCH PGlite, fetch stubbed.
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

  console.log("ALL PASSED");
}

main().then(() => process.exit(0), (e) => { console.error("FAIL", e); process.exit(1); });
