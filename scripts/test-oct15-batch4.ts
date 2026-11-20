/* Jeff's 2026-10-15 decisions — Batch 4 (Grid, specs, catalog) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md items 32, 43, 45, 46, 47).
   `batch4PureChecks` needs no database; `batch4DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-oct15-batch4.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./ok-type";
import { effectivePriceDate, priceBooks } from "../src/lib/catalog-books";
import { pricesAsOf } from "../src/lib/fixture-assemblies";
import { catalogEffectiveAtFor } from "../src/lib/vendor-status";
import { marginToMarkup as mk } from "../src/lib/markup";

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
  const stale = { markup: mk(0.3), staleCostMonths: 12, now };
  const oldPart = { mfr: "Acme", cost: 10, list: 20, pricedAt: now - 400 * DAY };
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
  // The Green Room / Electrical Room no longer narrow with a deeper nave.
  const roomW = (id: string, nd: number, r: string) => {
  };
  const e200 = roomW("church-contemporary@2", 200, "Electrical Room"), old90 = roomW("church-contemporary@1", 90, "Green Room");
  {
  }
  // The legal sweep, as #255 T8 fix ran it for @1: no fold, no room into the Platform / Nave, no outline crossing itself.
  const rooms = ["Backstage", "storage-1", "storage-2", "Green Room", "Electrical Room", "storage-3", "Control Booth", "storage-4", "Cry Room"];
  const bad: string[] = [];
  let cases = 0;
  for (const pw of [20, 30, 43, 80]) for (const sdWant of [14, 23, 35, 52]) for (const extra of [24, 78, 170]) for (const nd of [20, 30, 55, 120, 200]) {
    cases++;
    let fold = 0;
    for (let y = 405; y > -680; y -= 5) {
      let prev = -Infinity;
      for (let a = 0; a <= 745; a += 0.5) {
      }
    }
    for (const r of rooms) {
    }
  }
  ok(cases === 240 && bad.length === 0, `#46: over ${cases} legal Contemporary @2 sizes the map never folds, no room reaches into the Platform or Nave, no outline crosses itself (${bad.join("; ")})`);
  // The B/D wall still ends on its splay on @2 (the #255 T8 fix invariant).
  {
    const d = { proWidthFt: 43, stageDepthFt: 35, houseWidthFt: 121, houseDepthFt: 120, wingFt: 0, pit: false };
  }
  const line = (rowKey: string, qty: number) => ({ rowKey, scope: rowKey.split(":")[0], label: rowKey, unit: "ea", place: "each", eqQty: qty, qty, status: "part", ref: "B4-" + rowKey, unitCost: 1, unitSell: 1, total: qty, swapped: false });
  const sideCases: Array<[string, Record<string, number>]> = [
    ["church-traditional@1", { width: 51, depth: 26 }],
    ["church-traditional@1", { width: 20, depth: 14, houseWidthFt: 36, houseDepthFt: 30 }],
    ["church-traditional@1", { width: 50, depth: 40, houseWidthFt: 120, houseDepthFt: 55 }],
    ["church-contemporary@1", { width: 43, depth: 23 }],
    ["church-contemporary@2", { width: 43, depth: 23 }],
    ["church-contemporary@2", { width: 30, depth: 18, houseWidthFt: 80, houseDepthFt: 120 }],
  ];
  for (const [tpl, dims] of sideCases) {
  }
  for (const sz of ["small", "medium", "large"] as const) {
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
  const { ASSEMBLY_PART_PREFIX } = await import("../src/lib/quote-line-ids");
  const base = { sheetId: "s", page: 1, x: 0.5, y: 0.5 };
  const holder = { ...base, id: "h", partId: "MA-RACK" };
  const member = { ...base, id: "m", partId: "AMP", groupId: "h" };
  const linked = { ...holder, partId: "asm:r1", rackId: "r1", rackHolderPartId: "MA-RACK" };
  ok(ASSEMBLY_PART_PREFIX === "asm:", "#43: grid-rack-link's own asm: spelling matches grid-virtual-parts");
  // The rack's devices, read-only rows and the Unlink snapshot.
  const lines = [
    { slot: "parts", line: { sku: "ENCL", qty: 1 } },
    { slot: "rack", line: { sku: "AMP", label: "Amp", qty: 2 } },
    { slot: "rack", line: { sku: "OPT", qty: 0 } },
    { slot: "rack", line: { sku: "DSP", qty: 1 } },
  ];
}

async function rackLinkDbChecks(ok: Ok) {
  const { registerFixture } = await import("./test-fixtures");
  const by = "Test";
  {
  }
}

/* --- #47 Spec Library numbers follow Bray's TOC (script + plan; the map is Jeff's) --- */
async function brayChecks(ok: Ok) {
  const good = { source: "Test TOC", confirmed: true, sections: [{ from: "11 61 23", to: "11 06 10", title: "Stage Rigging and Curtains" }, { from: "26 09 61", to: "26 50 00" }] };
  const sections = [
    { id: "ss-r", number: "11 61 23", title: "Theatrical Rigging and Curtains" },
    { id: "ss-l", number: "26 09 61", title: "Theatrical Lighting" },
    { id: "ss-a", number: "27 41 00", title: "Audio-Video" },
  ];
  const records = [{ specId: "PS-116123-001", section: "11 61 23" }, { specId: "PS-116123-002", section: "11 61 23" }, { specId: "PS-260961-001", section: "26 09 61" }, { specId: "PS-274100-001", section: "27 41 00" }];
  const draftFile = JSON.parse(src("docs/specs-seed/bray-toc-map.draft-neenah-2021.json"));
  // Jeff (Oct 15): Fall Creek (Bray 3748) is the source. Its only Bray-issued section, 27 41 00, is already the library's.
  const fc = JSON.parse(src("docs/specs-seed/bray-toc-map.json"));
  const libSections = ["11 61 13", "11 61 14", "11 61 23", "11 61 33", "11 61 43", "26 09 23", "26 09 61", "26 55 61", "27 41 16", "27 41 00"].map((n, i) => ({ id: `s${i}`, number: n, title: n }));
}

async function brayDbChecks(ok: Ok) {
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
