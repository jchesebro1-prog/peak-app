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
import { unitPriceFor } from "../src/lib/portal-price-rules";

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
  ok(/priced && \(\(parsed\.hasList && r\.list > 0\) \|\| \(parsed\.hasCost && r\.cost > 0\)\) \? \{ priceDate: input\.effectiveAt \}/.test(imp), "#32: …it stamps priceDate on each row of a priced file that carries a price");
  // #354 review M6: the portal's stale-cost rule reads the part's own latest date, so a re-confirmed price un-stales.
  const stale = { margin: 0.3, staleCostMonths: 12, now };
  const oldPart = { mfr: "Acme", cost: 10, list: 20, pricedAt: now - 400 * DAY };
  ok(unitPriceFor({ ...oldPart, pricedAt: effectivePriceDate(oldPart) }, stale).porReason === "stale-cost" &&
     !unitPriceFor({ ...oldPart, pricedAt: effectivePriceDate({ ...oldPart, priceDate: fresh }) }, stale).por,
    "#354 review: a price a recent file re-confirmed (priceDate) is not stale on the portal; an unconfirmed old one still is");
  ok((src("src/lib/portal-catalog-index.ts").match(/pricedAt: effectivePriceDate\(p\)/g) || []).length === 2, "#354 review: the portal index reads effectivePriceDate for both its part rows");
  const hub = src("src/app/(app)/import/catalog-commit.ts");
  ok(!hub.includes("setPriceListEffective"), "#32: the Import hub no longer re-dates the manufacturer's book");
  const reg = src("src/app/(app)/import/registry.ts");
  ok((reg.match(/rowDatesPrice\(ctx, v\) \? \{ priceDate: ctx\.effectiveAt \}/g) || []).length === 2 && /!!ctx\.priced && \(num\(v\.list\) > 0 \|\| num\(v\.cost\) > 0\)/.test(reg), "#32: both hub catalog write paths (create, update) stamp priceDate on a priced row of a priced file");
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

  // #354 review I1: a blank-price row in a priced file dates nothing — both importers.
  const { runCatalogImport } = await import("../src/app/(app)/catalog/import");
  const csv = "SKU,Description,Category,Unit,List,Cost\nB4-BL-1,Priced row,Test,ea,100,60\nB4-BL-2,Blank price row,Test,ea,,\n";
  const imp = await runCatalogImport({ mfr: "B4 Blank Co", text: csv, bytes: Buffer.byteLength(csv), effectiveAt: D1, defaultCategory: "" });
  ok(imp.ok && (await Catalog.get("B4-BL-1"))?.priceDate === D1 && (await Catalog.get("B4-BL-2"))?.priceDate === undefined,
    "#354 review: the Catalog importer dates a priced row but not a blank-price row in the same file");
  const { commitImport } = await import("../src/app/(app)/import/registry");
  const { parseCsv, autoMap, prepareRows } = await import("../src/app/(app)/import/parse");
  const { getTypeMeta } = await import("../src/app/(app)/import/types");
  const t = getTypeMeta("catalog")!;
  const p = parseCsv("SKU,Description,List Price,Cost,Manufacturer\nB4-HB-1,Hub priced,50,30,B4 Hub Blank\nB4-HB-2,Hub blank,,,B4 Hub Blank\n");
  await commitImport("catalog", prepareRows(p.rows, autoMap(p.headers, t.fields), t.fields).rows, "update", { effectiveAt: D2, priced: true });
  ok((await Catalog.get("B4-HB-1"))?.priceDate === D2 && (await Catalog.get("B4-HB-2"))?.priceDate === undefined,
    "#354 review: the Import hub dates a priced row but not a blank-price row in a priced file");
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

/* --- #45 ADC track extras --- */
async function trackChecks(ok: Ok) {
  const { trackQuantities } = await import("../src/lib/track-engine");
  const { sanitizeTrackSeries, OPTIONAL_ROLES, activationProblems, hangerSpacingFor } = await import("../src/lib/track-series");
  const TB = await import("../src/app/(app)/estimator/track-bom");
  type Series = import("../src/lib/track-series").TrackSeries;
  type Cfg = import("../src/lib/track-engine").TrackConfig;
  const base = ["track", "splice", "carrier", "masterCarrier", "endStop", "battenClamp", "ceilingHanger", "livePulley", "deadPulley", "floorBlock", "operatingLine", "lapClamp"] as const;
  const series = (over: Partial<Series> = {}, extra: string[] = []): Series => ({
    id: "t45", name: "T45", manufacturer: "ADC", stickLengthFt: 20, carrierSpacingIn: 12, hangerSpacingFt: 5, overlapFt: 2,
    parts: Object.fromEntries([...base, ...extra].map((r) => [r, { sku: `P-${r}` }])), active: true, ...over,
  });
  const cfg = (over: Partial<Cfg> = {}): Cfg => ({ seriesId: "t45", operation: "walkalong", runFt: 40, curved: false, mounting: "batten", qty: 1, ...over });
  const map = (c: Cfg, s: Series) => Object.fromEntries(trackQuantities(c, s).rows.map((r) => [r.role, r.qty])) as Record<string, number>;

  ok(OPTIONAL_ROLES.includes("walkAlongEndStop") && OPTIONAL_ROLES.includes("centerPipeSupport"), "#45: walk-along end stop and center pipe support are optional roles");
  ok(activationProblems(series()).length === 0, "#45: neither new role is required for Active");
  // Walk-along end stops.
  const wa0 = map(cfg(), series());
  ok(wa0.endStop === 2 && !wa0.walkAlongEndStop && wa0.masterCarrier === 1, "#45: walk-along with the role unmapped keeps 2 ordinary end stops (unchanged)");
  const wa1 = map(cfg(), series({}, ["walkAlongEndStop"]));
  ok(wa1.walkAlongEndStop === 2 && !wa1.endStop, "#45: walk-along with the role mapped prices 2 walk-along end stops instead");
  const waBp = map(cfg({ walkAlongBipart: true }), series({}, ["walkAlongEndStop"]));
  ok(waBp.walkAlongEndStop === 4 && !waBp.endStop && waBp.masterCarrier === 2 && waBp.lapClamp === 2 && waBp.track === 4 && waBp.splice === 2 && !waBp.livePulley && !waBp.operatingLine,
    "#45: a walk-along bi-part has 4 end stops, 2 masters, two lapped legs with lap clamps, and no cord");
  ok(map(cfg({ walkAlongBipart: true }), series()).endStop === 4, "#45: …4 ordinary end stops when the walk-along role is unmapped");
  const bp = map(cfg({ operation: "biparting", walkAlongBipart: true }), series({}, ["walkAlongEndStop"]));
  ok(bp.endStop === 2 && !bp.walkAlongEndStop, "#45: cord-operated tracks never use walk-along end stops (and ignore the walk-along flag)");
  // Center pipe supports.
  ok(!map(cfg({ operation: "biparting" }), series({}, ["centerPipeSupport"])).centerPipeSupport, "#45: center supports need the series' 'every' number (default off)");
  ok(!map(cfg({ operation: "biparting" }), series({ centerSupportEveryFt: 20 })).centerPipeSupport, "#45: …and the role mapped");
  ok(map(cfg({ operation: "biparting" }), series({ centerSupportEveryFt: 20 }, ["centerPipeSupport"])).centerPipeSupport === 2, "#45: a 42' bi-parting track (40' + 2' overlap) supported every 20' takes 2 center supports");
  ok(map(cfg({ operation: "oneway", runFt: 40 }), series({ centerSupportEveryFt: 40 }, ["centerPipeSupport"])).centerPipeSupport === undefined, "#45: a track no longer than the span takes none");
  ok(!map(cfg({ operation: "biparting", mounting: "ceiling" }), series({ centerSupportEveryFt: 20 }, ["centerPipeSupport"])).centerPipeSupport, "#45: center pipe supports are batten-only");
  // Separate ceiling vs batten spacing.
  const sp = series({ ceilingSpacingFt: 8, battenSpacingFt: 4 });
  ok(map(cfg({ operation: "oneway" }), sp).battenClamp === 11 && map(cfg({ operation: "oneway", mounting: "ceiling" }), sp).ceilingHanger === 6, "#45: batten clamps use the batten spacing (40'/4' + 1), ceiling hangers the ceiling spacing (40'/8' + 1)");
  ok(map(cfg({ operation: "oneway" }), series()).battenClamp === 9 && map(cfg({ operation: "oneway", mounting: "ceiling" }), series()).ceilingHanger === 9, "#45: both fall back to the shared spacing (unchanged series price the same)");
  ok(map(cfg({ operation: "oneway", hangerSpacingFt: 10 }), sp).battenClamp === 5, "#45: a line's own spacing override still wins");
  ok(hangerSpacingFor(sp, "ceiling") === 8 && hangerSpacingFor(series(), "ceiling") === 5, "#45: hangerSpacingFor reads the mounting's own spacing, else the shared one");
  // Sanitize.
  const s1 = sanitizeTrackSeries({ ...series(), ceilingSpacingFt: "7", battenSpacingFt: -1, centerSupportEveryFt: 1e9 })!;
  ok(s1.ceilingSpacingFt === 7 && s1.battenSpacingFt === undefined && s1.centerSupportEveryFt === 100, "#45: sanitize keeps a valid spacing, drops a bad one, clamps center-support spacing to 100'");
  const s2 = sanitizeTrackSeries({ ...series({}, ["walkAlongEndStop", "centerPipeSupport"]) })!;
  ok(s2.parts.walkAlongEndStop?.sku === "P-walkAlongEndStop" && s2.parts.centerPipeSupport?.sku === "P-centerPipeSupport", "#45: sanitize keeps the new role mappings");
  // The form and the line.
  const c = cfg({ walkAlongBipart: true, label: "Main" });
  ok(JSON.stringify(TB.trackConfigFromDraft(TB.trackDraftFromConfig(c))) === JSON.stringify(TB.cleanTrackConfig(c)), "#45 form: a walk-along bi-part round-trips through the form");
  ok(TB.cleanTrackConfig(cfg({ operation: "oneway", walkAlongBipart: true })).walkAlongBipart === undefined, "#45 form: the flag is dropped off walk-along");
  ok(TB.trackLineDesc(c, { name: "ADC 280" }) === "Main — ADC 280 walk-along bi-parting track, 40' run", "#45 line: the description says walk-along bi-parting");
  ok(TB.spacingDefaults(sp, "ceiling").hanger === "8" && TB.spacingDefaults(sp, "batten").hanger === "4" && TB.spacingDefaults(series(), "ceiling").hanger === "5", "#45 form: the collapsed spacing shows the mounting's own default");
  ok(TB.freshTrackDraft([]).walkAlongBipart === false, "#45 form: a new track starts as one half");
  // #354 review M8: cut sheets say "two-half walk-along".
  const { plainDescription } = await import("../src/lib/curtain-cut-sheets/model");
  const { curtainTypeKey } = await import("../src/lib/curtain-cut-sheets/estimator-curtains");
  const curtain = (two: boolean) => ({
    name: "Main", fabric: null, fabricText: "IFR velour", fabricRef: null, widthFt: 40, heightFt: 20, fullnessPct: 50, qty: 1, topFinish: "grommets", bottomFinish: "chain", warnings: [],
    mount: { key: "track-batten", source: "track", track: { line: {}, seriesId: "adc-280", seriesName: "ADC 280", seriesGone: false, operation: "walkalong", carrierSpacingIn: 12, ...(two ? { twoHalfWalkAlong: true } : {}) } },
  });
  const typeOf = (two: boolean) => ({ title: "Main", totalQty: 1, sizes: [{ widthFt: 40, heightFt: 20 }], markSpacingIn: 12, curtains: [curtain(two)] }) as never;
  ok(/hung from carriers on a two-half walk-along ADC 280 track/.test(plainDescription(typeOf(true))) && !/two-half/.test(plainDescription(typeOf(false))),
    "#354 review: the client cut sheet says a two-half walk-along track (and only then)");
  ok(curtainTypeKey(curtain(true) as never) !== curtainTypeKey(curtain(false) as never), "#354 review: a two-half walk-along curtain never merges into a one-half type's sheet");
  ok(/cfg\.operation === "walkalong" && cfg\.walkAlongBipart === true \? \{ twoHalfWalkAlong: true \}/.test(src("src/lib/curtain-cut-sheets/estimator-curtains.ts")), "#354 review: the Estimator curtain read passes the two-half flag from the track line");
}

/* --- #43 Grid rack group ↔ rack RU elevation --- */
async function rackLinkChecks(ok: Ok) {
  const L = await import("../src/lib/design/grid-rack-link");
  const Gg = await import("../src/lib/design/grid-groups");
  const { ASSEMBLY_PART_PREFIX } = await import("../src/lib/design/grid-virtual-parts");
  const base = { sheetId: "s", page: 1, x: 0.5, y: 0.5 };
  const holder = { ...base, id: "h", partId: "MA-RACK" };
  const member = { ...base, id: "m", partId: "AMP", groupId: "h" };
  ok(L.rackLinkRefusal(holder, [holder]) === null, "#43: a plain device holding nothing can link to a rack");
  ok(L.rackLinkRefusal(holder, [holder, member]) === L.rackLinkHasMembers(1), "#43: …not while it holds devices of its own (they'd price on top of the rack)");
  ok(L.rackLinkHasMembers(2) === "Remove the 2 devices inside first — the rack supplies them.", "#354 review: the refusal says to remove the devices (the rack supplies them)");
  ok(L.rackLinkRefusal(holder, [holder, member], { removeMembers: true }) === null && L.rackLinkMemberCount(holder, [holder, member]) === 1, "#354 review: …while the one-step Link and remove its N devices is allowed");
  ok(L.rackLinkRefusal({ ...holder, qty: 3 }, [holder]) === L.RACK_LINK_QTY && L.rackLinkRefusal({ ...holder, qty: 1 }, [holder]) === null, "#354 review: a lot marker (qty > 1) can't link — set its quantity to 1 first");
  ok(L.rackLinkRefusal({ ...holder, partId: ASSEMBLY_PART_PREFIX + "r1" }, []) === L.RACK_LINK_ASSEMBLY && L.rackLinkRefusal({ ...holder, partId: "allow:lighting:par:good" }, []) === L.RACK_LINK_ASSEMBLY, "#43: …nor an assembly or allowance already");
  ok(L.rackLinkRefusal({ ...holder, curtain: {} }, []) === L.RACK_LINK_CURTAIN && L.rackLinkRefusal(member, [member]) === Gg.GROUP_HOLDER_IS_MEMBER && L.rackLinkRefusal({ ...holder, rackId: "r1" }, []) === L.RACK_LINK_ALREADY, "#43: …nor a curtain, a member or a device already linked");
  const linked = { ...holder, partId: "asm:r1", rackId: "r1", rackHolderPartId: "MA-RACK" };
  ok(L.isRackLinked(linked) && !L.isRackLinked({ ...linked, partId: "MA-RACK" }) && L.rackIdOf("asm:r1", (id) => id === "r1") === "r1" && L.rackIdOf("asm:f1", () => false) === null && L.rackIdOf("MA-RACK", () => true) === null,
    "#43: a link holds only while the device draws as that rack; rackIdOf reads asm:<rack> ids only");
  ok(ASSEMBLY_PART_PREFIX === "asm:", "#43: grid-rack-link's own asm: spelling matches grid-virtual-parts");
  // Linked holders take no members — every write's check and the repair rule.
  ok(Gg.holdRefusal(linked) === Gg.GROUP_RACK_LINKED && Gg.groupRefusal([linked, { ...base, id: "x" }], "h", ["x"], "o") === Gg.GROUP_RACK_LINKED, "#43: a rack-linked holder refuses Move into / Place inside");
  const settled = Gg.settleGroups<import("../src/lib/design/grid-groups").GroupLite>([linked, { ...member, x: 0.1 }], "o");
  ok(settled[1].groupId === undefined && settled[1].x === 0.1, "#43: the repair rule releases any member a linked holder somehow has, where it stands");
  // The rack's devices, read-only rows and the Unlink snapshot.
  const lines = [
    { slot: "parts", line: { sku: "ENCL", qty: 1 } },
    { slot: "rack", line: { sku: "AMP", label: "Amp", qty: 2 } },
    { slot: "rack", line: { sku: "OPT", qty: 0 } },
    { slot: "rack", line: { sku: "DSP", qty: 1 } },
  ];
  const dev = L.rackDeviceLines(lines);
  ok(L.rackLevelLines(lines).map((l) => `${l.sku}×${l.qty}`).join() === "ENCL×1" && L.snapshotUnits([...dev, ...L.rackLevelLines(lines)])!.join() === "AMP,AMP,DSP,ENCL",
    "#354 review: Unlink copies the rack-level parts too (devices first), so the BOM drops nothing");
  ok(dev.map((l) => `${l.sku}×${l.qty}`).join() === "AMP×2,DSP×1", "#43: the group is the rack's RU devices (rack-level parts and optional add-ons left out)");
  ok(JSON.stringify(L.rackDeviceRows(dev, (s) => (s === "DSP" ? "Signal processor" : undefined))) === JSON.stringify([{ sku: "AMP", desc: "Amp", qty: 2 }, { sku: "DSP", desc: "Signal processor", qty: 1 }]), "#43: rows read the catalog description, else the rack's label");
  ok(L.snapshotUnits(dev)!.join() === "AMP,AMP,DSP" && L.snapshotUnits([{ sku: "X", qty: Gg.MAX_GROUP_MEMBERS + 1 }]) === null, "#43: Unlink copies one device per unit, refused past the 200-device group cap");
  ok(L.rackHref("rk 1") === "/design/assemblies/rack/rk%201", "#43: Open rack → the Assembly Builder rack page");
  // Wiring pins.
  const act0 = src("src/app/(app)/design/grid/[id]/actions.ts");
  ok(/async function rackEstimateRefusal[\s\S]{0,400}estimateLinkOf\(project\)/.test(act0) && (act0.match(/await rackEstimateRefusal\(project,/g) || []).length === 2,
    "#354 review: link and unlink both refuse on an estimate-owned option (#314)");
  ok((act0.match(/await rackHolderRefusal\(projectId,/g) || []).length === 2 && /\(await getFixture\(id\)\)\?\.kind === "rack"\) return RACK_HOLDS_NOTHING/.test(act0),
    "#354 review: Place inside and Move into refuse any rack-assembly holder, linked or placed from the library");
  ok(/rackLevelLines\(all\)/.test(act0), "#354 review: unlinkRackAction copies rack-level parts");
  const act = src("src/app/(app)/design/grid/[id]/actions.ts");
  ok(/export async function linkRackAction[\s\S]{0,400}await requireUser\(\)[\s\S]{0,1200}rack\.kind !== "rack"/.test(act) && /export async function unlinkRackAction[\s\S]{0,300}await requireUser\(\)/.test(act), "#43: both actions are signed-in only and the link checks the rack is a rack");
  const page = src("src/app/(app)/design/grid/[id]/page.tsx");
  ok(/rackDevices=\{rackDevices\}/.test(page) && /racks=\{racks\}/.test(page), "#43: the editor gets the rack list and each placed rack's devices from the server");
  const pe = src("src/app/(app)/design/grid/[id]/workspace/property-editor.tsx");
  ok(/Open rack →/.test(pe) && /Link to rack…/.test(pe) && /Unlink/.test(pe), "#43: the Property Editor shows the rack group read-only with Open rack →, Link to rack… and Unlink");
}

async function rackLinkDbChecks(ok: Ok) {
  const G = await import("../src/lib/stores/grid-projects");
  const { ensureOptions } = await import("../src/lib/design/grid-options");
  const { registerFixture } = await import("./test-fixtures");
  const { GROUP_RACK_LINKED } = await import("../src/lib/design/grid-groups");
  const by = "Test";
  {
    const project = await G.createProject({ name: "Batch 4 rack link", customer: "Spec fixture", customerId: null, by });
    registerFixture("grid_projects", project.id);
    const sh = (await G.addSheet(project.id, { name: "Plan", mime: "image/svg+xml", dataUrl: "data:image/svg+xml,<svg/>", by }))!;
    registerFixture("grid_sheets", sh.id);
    const opt = ensureOptions((await G.getProject(project.id))!).options[0].id;
    const get = async (id: string) => (await G.getProject(project.id))!.placements!.find((x) => x.id === id);
    const put = async (x: number, partId: string) => (await G.addPlacement(project.id, { sheetId: sh.id, page: 1, x, y: 0.5, partId, optionId: opt, by }))!.placements!.at(-1)!;
    const encl = await put(0.5, "B4-ENCL");
    const amp = await put(0.2, "B4-AMP");
    // Refused while it holds a device of its own.
    await G.setPlacementsGroup(project.id, [{ id: amp.id, groupId: encl.id }]);
    const refused = await G.linkPlacementRack(project.id, { placementId: encl.id, rackId: "b4-rack" });
    ok(!refused.ok && /Remove the 1 device inside first — the rack supplies them/.test(refused.error), "#43 store: Link is refused while the device holds one of its own");
    await G.setPlacementsGroup(project.id, [{ id: amp.id, groupId: null }]);
    const lk = await G.linkPlacementRack(project.id, { placementId: encl.id, rackId: "b4-rack" });
    const e1 = await get(encl.id);
    ok(lk.ok && e1?.partId === "asm:b4-rack" && e1.rackId === "b4-rack" && e1.rackHolderPartId === "B4-ENCL", "#43 store: Link makes the device the rack assembly (priced as the rack) and remembers its own part");
    const inside = await G.addPlacementInside(project.id, { holderId: encl.id, partId: "B4-AMP", by });
    const moveIn = await G.setPlacementsGroup(project.id, [{ id: amp.id, groupId: encl.id }]);
    ok(!inside.ok && inside.error === GROUP_RACK_LINKED && !moveIn.ok, "#43 store: a linked rack takes no members (Place inside / Move into refused)");
    const un = await G.unlinkPlacementRack(project.id, { placementId: encl.id, skus: ["B4-AMP", "B4-AMP", "B4-DSP"], by });
    const after = (await G.getProject(project.id))!.placements!;
    const e2 = after.find((x) => x.id === encl.id)!;
    const members = after.filter((x) => x.groupId === encl.id);
    ok(un.ok && un.added === 3 && e2.partId === "B4-ENCL" && e2.rackId === undefined && e2.rackHolderPartId === undefined, "#43 store: Unlink puts the device's own part back and ends the link");
    ok(members.map((m) => m.partId).join() === "B4-AMP,B4-AMP,B4-DSP" && members.every((m) => m.x === e2.x && m.optionId === opt && !!m.designator), "#43 store: …and copies the rack's devices in as an ordinary, numbered group at the device");
    ok(!(await G.unlinkPlacementRack(project.id, { placementId: encl.id, skus: [], by })).ok, "#43 store: Unlink on a device that isn't linked is refused");
    // #354 review: Link and remove its N devices — one write.
    const box = await put(0.6, "B4-ENCL");
    const in1 = await put(0.61, "B4-AMP");
    const in2 = await put(0.62, "B4-DSP");
    await G.setPlacementsGroup(project.id, [{ id: in1.id, groupId: box.id }, { id: in2.id, groupId: box.id }]);
    const v0 = (await G.getProject(project.id))!.updatedAt;
    const lr = await G.linkPlacementRack(project.id, { placementId: box.id, rackId: "b4-rack", removeMembers: true });
    const after2 = (await G.getProject(project.id))!;
    ok(lr.ok && lr.value.removed === 2 && !after2.placements!.some((x) => x.id === in1.id || x.id === in2.id) && after2.placements!.find((x) => x.id === box.id)?.rackId === "b4-rack" && lr.landed?.before === v0,
      "#354 review: Link and remove deletes the devices inside and links, in one write");
    const lot = (await G.addPlacement(project.id, { sheetId: sh.id, page: 1, x: 0.7, y: 0.5, partId: "B4-ENCL", optionId: opt, by }))!.placements!.at(-1)!;
    await G.setPlacementsPart(project.id, [{ id: lot.id, partId: "B4-ENCL2", qty: 4 }]);
    const lotLink = await G.linkPlacementRack(project.id, { placementId: lot.id, rackId: "b4-rack" });
    ok(!lotLink.ok && /set its quantity to 1 first/.test(lotLink.error), "#354 review: the store refuses to link a lot marker");
    // A part swap ends a link.
    const solo = await put(0.8, "B4-ENCL");
    await G.linkPlacementRack(project.id, { placementId: solo.id, rackId: "b4-rack" });
    await G.setPlacementsPart(project.id, [{ id: solo.id, partId: "B4-OTHER" }]);
    const s2 = await get(solo.id);
    ok(s2?.partId === "B4-OTHER" && s2.rackId === undefined && s2.rackHolderPartId === undefined, "#43 store: Replace part on a linked device ends the link");
  }
}

/* --- #47 Spec Library numbers follow Bray's TOC (script + plan; the map is Jeff's) --- */
async function brayChecks(ok: Ok) {
  const B = await import("../src/lib/specs/bray-renumber");
  const good = { source: "Test TOC", confirmed: true, sections: [{ from: "11 61 23", to: "11 06 10", title: "Stage Rigging and Curtains" }, { from: "26 09 61", to: "26 50 00" }] };
  const p = B.parseBrayMap(good);
  ok(p.ok && p.map.entries.length === 2, "#47: a confirmed map with CSI numbers parses");
  const draft = B.parseBrayMap({ ...good, confirmed: false });
  ok(!draft.ok && draft.errors.some((e) => /confirmed/.test(e)), "#47: an unconfirmed (draft) map is refused");
  const bad = B.parseBrayMap({ source: "x", confirmed: true, sections: [{ from: "116123", to: "11 06 10" }, { from: "11 61 23", to: "11 06 10" }, { from: "26 09 61", to: "11 06 10" }, { from: "26 09 61", to: "26 50 00" }] });
  ok(!bad.ok && bad.errors.length === 3, "#47: malformed numbers, two sections onto one number and a number listed twice are all named");
  const swap = B.parseBrayMap({ source: "x", confirmed: true, sections: [{ from: "11 61 23", to: "26 09 61" }, { from: "26 09 61", to: "11 61 23" }] });
  const chain = B.parseBrayMap({ source: "x", confirmed: true, sections: [{ from: "11 61 13", to: "11 61 14" }, { from: "11 61 14", to: "11 61 25" }] });
  ok(!swap.ok && swap.errors.length === 2 && !chain.ok && chain.errors.length === 1 && /swaps and chains/.test(chain.errors[0]), "#354 review: a map whose target is another entry's source (a swap or a chain) is refused");
  ok(B.parseBrayMap({ source: "x", confirmed: true, sections: [{ from: "27 41 00", to: "27 41 00" }, { from: "11 61 23", to: "11 06 10" }] }).ok, "#354 review: …an entry mapping a number to itself is not a chain");
  const sections = [
    { id: "ss-r", number: "11 61 23", title: "Theatrical Rigging and Curtains" },
    { id: "ss-l", number: "26 09 61", title: "Theatrical Lighting" },
    { id: "ss-a", number: "27 41 00", title: "Audio-Video" },
  ];
  const records = [{ specId: "PS-116123-001", section: "11 61 23" }, { specId: "PS-116123-002", section: "11 61 23" }, { specId: "PS-260961-001", section: "26 09 61" }, { specId: "PS-274100-001", section: "27 41 00" }];
  const plan = B.planRenumber(p.ok ? p.map : { source: "", entries: [] }, sections, records);
  ok(plan.ok && plan.plan.sections.map((s) => `${s.id}:${s.to}:${s.titleTo}`).join("|") === "ss-r:11 06 10:Stage Rigging and Curtains|ss-l:26 50 00:Theatrical Lighting" &&
     plan.plan.records.map((r) => `${r.specId}→${r.to}`).join() === "PS-116123-001→11 06 10,PS-116123-002→11 06 10,PS-260961-001→26 50 00",
    "#47: the plan renumbers each mapped section (title when given) and every record in it; unmapped sections stay");
  const after = B.planRenumber(p.ok ? p.map : { source: "", entries: [] }, [{ ...sections[0], number: "11 06 10", title: "Stage Rigging and Curtains" }, { ...sections[1], number: "26 50 00" }, sections[2]], records.map((r) => ({ ...r, section: r.section === "11 61 23" ? "11 06 10" : r.section === "26 09 61" ? "26 50 00" : r.section })));
  ok(after.ok && after.plan.sections.length === 0 && after.plan.records.length === 0 && after.plan.already.length === 2, "#47: a second run plans nothing (idempotent)");
  const clash = B.planRenumber({ source: "x", entries: [{ from: "11 61 23", to: "27 41 00" }] }, sections, records);
  ok(!clash.ok && /27 41 00 is already section "Audio-Video"/.test(clash.errors[0]), "#47: a target number held by a section that stays put refuses the whole map");
  ok(B.renumberWhy("11 61 23", "Fall Creek TOC") === "Renumbered from 11 61 23 to follow Bray's TOC (Fall Creek TOC).", "#47: each record's new revision says why");
  const draftFile = JSON.parse(src("docs/specs-seed/bray-toc-map.draft-neenah-2021.json"));
  const dp = B.parseBrayMap(draftFile);
  ok(!dp.ok && draftFile.confirmed === false, "#47: the committed Neenah 2021 draft map is unconfirmed, so the script refuses it as-is");
  ok(B.parseBrayMap({ ...draftFile, confirmed: true }).ok, "#47: …and is otherwise well-formed (Jeff confirms, then it runs)");
  // Jeff (Oct 15): Fall Creek (Bray 3748) is the source. Its only Bray-issued section, 27 41 00, is already the library's.
  const fc = JSON.parse(src("docs/specs-seed/bray-toc-map.json"));
  const fcp = B.parseBrayMap(fc);
  ok(fcp.ok && fc.confirmed === true && /Fall Creek/.test(fc.source) && /3748/.test(fc.source), "#47: the confirmed map cites Fall Creek (Bray 3748) as its source");
  const libSections = ["11 61 13", "11 61 14", "11 61 23", "11 61 33", "11 61 43", "26 09 23", "26 09 61", "26 55 61", "27 41 16", "27 41 00"].map((n, i) => ({ id: `s${i}`, number: n, title: n }));
  const fcPlan = fcp.ok ? B.planRenumber(fcp.map, libSections, [{ specId: "PS-274100-001", section: "27 41 00" }, { specId: "PS-116123-001", section: "11 61 23" }]) : null;
  ok(!!fcPlan && fcPlan.ok && fcPlan.plan.sections.length === 0 && fcPlan.plan.records.length === 0, "#47: against the library's numbers the Fall Creek map changes nothing (27 41 00 already matches)");
  const script = src("scripts/specs-renumber-bray.ts");
  ok(/resolveExplicitDbTarget/.test(script) && /requireHostedConfirmation/.test(script) && /saveSpecRecord\(/.test(script) && /docs\/specs-seed\/bray-toc-map\.json/.test(script) && /--apply/.test(script),
    "#47: the script is dry-run by default, needs an explicit target (--yes for hosted) and writes records through saveSpecRecord");
  ok(/"specs:renumber-bray": "tsx scripts\/specs-renumber-bray\.ts"/.test(src("package.json")), "#47: npm run specs:renumber-bray");
}

async function brayDbChecks(ok: Ok) {
  const S = await import("../src/lib/stores/spec-records");
  const { normalizeSpecRecord } = await import("../src/lib/specs/records");
  const base = normalizeSpecRecord({ specId: "PS-B4TEST-001", kind: "companion", status: "ready", section: "11 61 23", article: "2.1", title: "Batch 4", specText: "Text.", mfrNumbers: [], includeWith: [] })!;
  await S.saveSpecRecord(base, "Test", "seed");
  const r = await S.saveSpecRecord({ ...base, section: "11 06 10" }, "specs:renumber-bray", "Renumbered from 11 61 23 to follow Bray's TOC (Test).");
  const revs = await S.specRecordRevisions("PS-B4TEST-001");
  ok(r.outcome === "updated" && r.record.section === "11 06 10" && revs.length === 1 && revs[0].record.section === "11 61 23" && /Bray's TOC/.test(revs[0].why),
    "#47 store: a renumbered record keeps its old number as a revision (history never rewritten)");
  const again = await S.saveSpecRecord({ ...r.record }, "specs:renumber-bray", "again");
  ok(again.outcome === "unchanged", "#47 store: re-saving the same number is a no-op (no extra revision)");
}

export async function batch4PureChecks(ok: Ok) {
  priceDateChecks(ok);
  await venueChecks(ok);
  await trackChecks(ok);
  await rackLinkChecks(ok);
  await brayChecks(ok);
}

export async function batch4DbChecks(ok: Ok) {
  await priceDateDbChecks(ok);
  await rackLinkDbChecks(ok);
  await brayDbChecks(ok);
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
