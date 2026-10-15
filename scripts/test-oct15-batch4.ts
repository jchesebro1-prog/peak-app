/* Jeff's 2026-10-15 decisions — Batch 4 (Grid, specs, catalog) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md items 32, 43, 45, 46, 47).
   `batch4PureChecks` needs no database; `batch4DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-oct15-batch4.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { effectivePriceDate, priceBooks } from "../src/lib/catalog-books";
import { pricesAsOf } from "../src/lib/fixture-assemblies";
import { catalogEffectiveAtFor } from "../src/lib/vendor-status";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const DAY = 86400000;

/* --- #32 partial price files: per-part priceDate --- */
function priceDateChecks(ok: Ok) {
  const now = Date.UTC(2026, 9, 15);
  const old = now - 400 * DAY;
  const fresh = now - 2 * DAY;
  const book = { priceListEffective: { acme: old } };
  ok(effectivePriceDate({ mfr: "Acme", priceDate: fresh }, book) === fresh, "#32: a part's own priceDate beats an older book date");
  ok(effectivePriceDate({ mfr: "Acme" }, book) === old, "#32: a part with no per-part date falls back to the manufacturer's book date");
  ok(effectivePriceDate({ mfr: "Acme", pricedAt: fresh, priceDate: old }, {}) === fresh, "#32: the latest of pricedAt and priceDate wins");
  ok(effectivePriceDate({ mfr: "Acme", priceDate: old }, { priceListEffective: { acme: fresh } }) === fresh, "#32: a later by-hand book date still confirms every line");
  ok(effectivePriceDate({ mfr: "Zed", priceDate: Number.NaN }, {}) === null, "#32: an invalid priceDate dates nothing");
  // A partial file dated only A; B keeps the old book date. Builders show the newest; the price book the oldest.
  const parts = [
    { sku: "A", mfr: "Acme", priceDate: fresh },
    { sku: "B", mfr: "Acme" },
  ];
  ok(pricesAsOf(["A", "B"], parts, book) === fresh, "#32 / item 33: a builder's 'prices as of' shows the newest per-part date");
  const [row] = priceBooks(parts, book, { now });
  ok(row.effectiveAt === old && row.count === 2, "#32: the price book's oldest date reads the per-part dates (B's old book date)");
  const [row2] = priceBooks([{ mfr: "Acme", priceDate: fresh }, { mfr: "Acme" }], {}, { now });
  ok(row2.effectiveAt === null && row2.unknown, "#32: a part no file listed and no book date covers keeps the book Unknown");
  ok(catalogEffectiveAtFor(parts, ["Acme"], book) === fresh, "#32: the vendor 'Catalog priced' date reads the newest per-part date");
  const imp = src("src/app/(app)/catalog/import.ts");
  ok(!imp.includes("setPriceListEffective"), "#32: the Catalog page importer no longer re-dates the manufacturer's book");
  ok(/priced \? \{ priceDate: input\.effectiveAt \}/.test(imp), "#32: …it stamps priceDate on each row of a priced file");
  const hub = src("src/app/(app)/import/catalog-commit.ts");
  ok(!hub.includes("setPriceListEffective"), "#32: the Import hub no longer re-dates the manufacturer's book");
  const reg = src("src/app/(app)/import/registry.ts");
  ok((reg.match(/ctx\.priced \? \{ priceDate: ctx\.effectiveAt \}/g) || []).length === 2, "#32: both hub catalog write paths (create, update) stamp priceDate");
}

async function priceDateDbChecks(ok: Ok) {
  const Catalog = await import("../src/lib/stores/catalog");
  const D1 = Date.UTC(2026, 0, 15, 18);
  const D2 = Date.UTC(2026, 5, 1, 17);
  const base = { desc: "Batch4 date part", category: "Test", unit: "ea", list: 10, cost: 5, mfr: "B4 Dating" };
  await Catalog.mergeUpsert("B4-PD-1", base, { pricedAt: D1, priceDate: D1 });
  ok((await Catalog.get("B4-PD-1"))?.priceDate === D1, "#32 store: an import write stamps priceDate");
  await Catalog.mergeUpsert("B4-PD-1", { desc: "renamed by hand" });
  ok((await Catalog.get("B4-PD-1"))?.priceDate === D1, "#32 store: a non-import write keeps the stored priceDate");
  const full = (await Catalog.get("B4-PD-1"))!;
  const { priceDate: _drop, ...noDate } = full;
  void _drop;
  await Catalog.upsert(noDate);
  ok((await Catalog.get("B4-PD-1"))?.priceDate === D1, "#32 store: a full replace that dropped priceDate gets it back");
  await Catalog.mergeUpsert("B4-PD-1", { list: 10 }, { pricedAt: D2, priceDate: D2 });
  const after = await Catalog.get("B4-PD-1");
  ok(after?.priceDate === D2 && after.pricedAt === D1, "#32 store: an unchanged price in a newer file moves priceDate, not pricedAt");
}

/* --- #46 venue drawing fixes --- */
type P = { x: number; y: number };
const inPolyXY = (poly: P[], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (poly[i].y > y !== poly[j].y > y && x < ((poly[j].x - poly[i].x) * (y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
  return c;
};
const selfCrosses = (poly: P[]) => {
  const cr = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < poly.length; i++)
    for (let j = i + 2; j < poly.length; j++) {
      if (i === 0 && j === poly.length - 1) continue;
      const p1 = poly[i], p2 = poly[i + 1], p3 = poly[j], p4 = poly[(j + 1) % poly.length];
      const d1 = cr(p3, p4, p1), d2 = cr(p3, p4, p2), d3 = cr(p1, p2, p3), d4 = cr(p1, p2, p4);
      if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) return true;
    }
  return false;
};

async function venueChecks(ok: Ok) {
  const { CHURCH_CONTEMPORARY_KEYS: V1, CHURCH_CONTEMPORARY_V2_KEYS: V2 } = await import("../src/lib/design/venue-templates/church-contemporary.keys");
  const { stretchById, TEMPLATE_IDS } = await import("../src/lib/design/venue-templates/templates");
  const { makeXMap } = await import("../src/lib/design/venue-templates/stretch");
  const { inPoly, distToPoly } = await import("../src/lib/design/venue-templates/canvas");
  const R = await import("../src/lib/design/venue-templates/index");
  const { HOUSE_SPECS, stageDepthFor } = await import("../src/lib/design/venue-templates/house-dims");
  const { VENUES, defaultAState, sizedDims } = await import("../src/app/(app)/design/quick/engine");
  const { churchGeom, arenaGeom } = await import("../src/app/(app)/design/quick/plan-svg");
  const { generateAutoLayout } = await import("../src/lib/design/grid-auto-layout");

  // Contemporary: @2 registered beside @1; @1 retired (still draws), @2 offered.
  ok(TEMPLATE_IDS.includes("church-contemporary@1") && TEMPLATE_IDS.includes("church-contemporary@2"), "#46: church-contemporary@2 is registered and @1 still draws");
  ok(HOUSE_SPECS["church-contemporary@2"] === HOUSE_SPECS["church-contemporary@1"], "#46: @2 keeps @1's nave fields and limits");
  const churchList = R.templatesFor("church");
  ok(R.pickerTemplates(churchList, null).map((t) => t.id).join("|") === "church-traditional@1|church-contemporary@2", "#46: pickers offer Traditional and the new Contemporary");
  ok(R.pickerTemplates(churchList, "church-contemporary@1").some((t) => t.id === "church-contemporary@1"), "#46: …and keep the earlier Contemporary listed while it is the current value");
  ok(R.sanitizeTemplateId("church", "church-contemporary@1") === "church-contemporary@1" && R.sanitizeBackground("church", "church", "church-contemporary@1") === "church-contemporary@1", "#46: a design or venue type set to @1 keeps drawing @1 (nothing moves)");
  ok(R.defaultBackground("church", "church") === "church-traditional@1", "#46: the church default stays Traditional");
  // Identity at the drawing's size (both versions draw the same plan there).
  const D0 = { proWidthFt: V1.defaults.proWidthFt, wingFt: 0, stageDepthFt: V1.defaults.stageDepthFt, houseWidthFt: V1.defaults.houseWidthFt, houseDepthFt: V1.defaults.houseDepthFt, pit: false };
  const p1 = stretchById("church-contemporary@1", D0), p2 = stretchById("church-contemporary@2", D0);
  const same = Object.keys(p1.regions).every((r) => p1.regions[r].every((q, i) => Math.abs(q.x - p2.regions[r][i].x) < 1e-6 && Math.abs(q.y - p2.regions[r][i].y) < 1e-6));
  ok(same, "#46: at the drawing's own size @2 draws exactly what @1 draws");
  // The Green Room / Electrical Room no longer narrow with a deeper nave.
  const roomW = (id: string, nd: number, r: string) => {
    const pl = stretchById(id, { ...D0, houseDepthFt: nd });
    const xs = pl.regions[r].map((q) => q.x);
    return Math.max(...xs) - Math.min(...xs);
  };
  const g55 = roomW("church-contemporary@2", V1.defaults.houseDepthFt, "Green Room"), g90 = roomW("church-contemporary@2", 90, "Green Room"), g200 = roomW("church-contemporary@2", 200, "Green Room");
  const e200 = roomW("church-contemporary@2", 200, "Electrical Room"), old90 = roomW("church-contemporary@1", 90, "Green Room");
  ok(Math.abs(g90 - g55) < 0.01 && Math.abs(g200 - g55) < 0.01 && Math.abs(e200 - g55) < 0.01, `#46: on @2 the Green Room and Electrical Room keep their drawn width however deep the nave (${(g55 / 12).toFixed(1)}' at the drawn 55.4', ${(g200 / 12).toFixed(1)}' at 200')`);
  {
    const s1 = stretchById("church-contemporary@1", { ...D0, houseDepthFt: 30 }), s2 = stretchById("church-contemporary@2", { ...D0, houseDepthFt: 30 });
    const eq = Object.keys(s1.regions).every((r) => s1.regions[r].every((q, i) => Math.abs(q.x - s2.regions[r][i].x) < 1e-6 && Math.abs(q.y - s2.regions[r][i].y) < 1e-6));
    ok(eq, "#46: a nave shallower than drawn draws exactly as on @1 (both parts of the nave shrink together)");
  }
  ok(old90 < g90 - 12,`#46: (on @1 a 90' nave squeezed the Green Room to ${(old90 / 12).toFixed(1)}' — unchanged there, so stamped sheets keep their frame)`);
  // The legal sweep, as #255 T8 fix ran it for @1: no fold, no room into the Platform / Nave, no outline crossing itself.
  const rooms = ["Backstage", "storage-1", "storage-2", "Green Room", "Electrical Room", "storage-3", "Control Booth", "storage-4", "Cry Room"];
  const bad: string[] = [];
  let cases = 0;
  for (const pw of [20, 30, 43, 80]) for (const sdWant of [14, 23, 35, 52]) for (const extra of [24, 78, 170]) for (const nd of [20, 30, 55, 120, 200]) {
    const nw = Math.min(250, pw + extra), sd = stageDepthFor({ width: pw, wing: 0, depth: sdWant }, "church-contemporary@2").depthFt;
    const d = { proWidthFt: pw, stageDepthFt: sd, houseWidthFt: nw, houseDepthFt: nd, wingFt: 0, pit: false };
    const X = makeXMap(V2, d), plan = stretchById("church-contemporary@2", d), tag = `${pw}/${sd.toFixed(1)}/${nw}/${nd}`;
    cases++;
    let fold = 0;
    for (let y = 405; y > -680; y -= 5) {
      let prev = -Infinity;
      for (let a = 0; a <= 745; a += 0.5) {
        const m = X(V2.cx + a, y) - V2.cx;
        if (m < prev - 1e-9) fold = Math.max(fold, prev - m);
        else prev = m;
      }
    }
    if (fold > 1e-6) bad.push(`${tag} folds ${fold.toFixed(3)}"`);
    for (const r of rooms) {
      const into = plan.regions[r].filter((q) => (inPoly(plan.regions.Platform, q) || inPoly(plan.regions.Nave, q)) && Math.min(distToPoly(plan.regions.Platform, q), distToPoly(plan.regions.Nave, q)) > 0.01);
      if (into.length) bad.push(`${tag} ${r} reaches into the Platform/Nave`);
    }
    for (const [r, poly] of Object.entries(plan.regions)) if (selfCrosses(poly)) bad.push(`${tag} ${r} crosses itself`);
  }
  ok(cases === 240 && bad.length === 0, `#46: over ${cases} legal Contemporary @2 sizes the map never folds, no room reaches into the Platform or Nave, no outline crosses itself (${bad.join("; ")})`);
  // The B/D wall still ends on its splay on @2 (the #255 T8 fix invariant).
  {
    const d = { proWidthFt: 43, stageDepthFt: 35, houseWidthFt: 121, houseDepthFt: 120, wingFt: 0, pit: false };
    const plan = stretchById("church-contemporary@2", d), X = makeXMap(V2, d);
    const A = plan.map(V2.walls![0].ref[0]), B = plan.map(V2.walls![0].ref[1]);
    const wallX = X(V2.cx - 480.137, 200), yOnSplay = A.y + ((B.y - A.y) * (wallX - A.x)) / (B.x - A.x);
    ok(Math.abs(plan.map({ x: V2.cx - 480.137, y: 51.936 }).y - yOnSplay) < 1e-6, "#46: on @2 the B/D wall still ends where it meets its splay");
  }

  // Traditional (and every church): side lights stay on the Platform, never in a side room.
  const base = defaultAState(0);
  const line = (rowKey: string, qty: number) => ({ rowKey, scope: rowKey.split(":")[0], label: rowKey, unit: "ea", place: "each", eqQty: qty, qty, status: "part", ref: "B4-" + rowKey, unitCost: 1, unitSell: 1, total: qty, swapped: false });
  const cards = [{ scope: "lighting", tier: "better", lines: [line("lighting:side", 8)] }] as unknown as Parameters<typeof generateAutoLayout>[1];
  const sideCases: Array<[string, Record<string, number>]> = [
    ["church-traditional@1", { width: 51, depth: 26 }],
    ["church-traditional@1", { width: 20, depth: 14, houseWidthFt: 36, houseDepthFt: 30 }],
    ["church-traditional@1", { width: 50, depth: 40, houseWidthFt: 120, houseDepthFt: 55 }],
    ["church-contemporary@1", { width: 43, depth: 23 }],
    ["church-contemporary@2", { width: 43, depth: 23 }],
    ["church-contemporary@2", { width: 30, depth: 18, houseWidthFt: 80, houseDepthFt: 120 }],
  ];
  for (const [tpl, dims] of sideCases) {
    const a = { ...base, venue: "church", templateId: tpl, ...dims, sys: { ...base.sys, lighting: true } };
    const G = churchGeom(a, tpl);
    const plat = G.regions[G.roles.stage];
    const sideRooms = Object.keys(G.regions).filter((r) => r !== G.roles.stage && r !== G.roles.house);
    const pts = generateAutoLayout(a, cards, { electrics: 2, sets: 6, template: tpl });
    const offPlat = pts.filter((s) => !inPolyXY(plat, s.x * G.W, s.y * G.H));
    const inRoom = pts.filter((s) => sideRooms.some((r) => inPolyXY(G.regions[r], s.x * G.W, s.y * G.H)));
    ok(pts.length === 8 && offPlat.length === 0 && inRoom.length === 0, `#46 ${tpl} ${JSON.stringify(dims)}: all 8 side lights hang on the Platform, none in a side room (${offPlat.length} off, ${inRoom.length} in a room)`);
  }
  const src46 = src("src/lib/design/grid-auto-layout.ts");
  ok(/sideInside: true/.test(src46), "#46: only the church family's frame hangs side lights inside the stage frame");

  // Gym Stage: the default stage is 30' deep.
  const gym = VENUES.find((v) => v.key === "gym")!;
  ok(gym.d === 30 && sizedDims(gym, "medium").depth === 30, "#46: the Gym Stage default stage depth is 30'");
  // Arena: the default end stage stays off the court at every size preset.
  const arena = VENUES.find((v) => v.key === "arena")!;
  for (const sz of ["small", "medium", "large"] as const) {
    const a = { ...base, venue: "arena", ...sizedDims(arena, sz), templateId: null, houseWidthFt: null, houseDepthFt: null, movables: null };
    const G = arenaGeom(a as never, "arena@1");
    const court = G.regions.Court;
    const courtTop = Math.min(...court.map((q: P) => q.y));
    const stageBottom = G.stageCentre.y + G.stageDepth / 2;
    ok(stageBottom <= courtTop + 0.5, `#46 arena ${sz}: the default end stage (${sizedDims(arena, sz).depth}') ends at or before the court (overlap ${((stageBottom - courtTop) / G.ppf).toFixed(1)}')`);
  }
}

export async function batch4PureChecks(ok: Ok) {
  priceDateChecks(ok);
  await venueChecks(ok);
}

export async function batch4DbChecks(ok: Ok) {
  await priceDateDbChecks(ok);
}

if (process.argv[1]?.endsWith("test-oct15-batch4.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  batch4PureChecks(okf)
    .then(() => (db ? batch4DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
