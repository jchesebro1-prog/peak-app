/* #369 — curved track layout + "Preliminary" cut sheets. Pure checks; run alone with
   `npx tsx scripts/test-curved-track.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";
import { sanitizeTrackSeries, type TrackSeries } from "../src/lib/track-series";
import { trackQuantities, type TrackConfig } from "../src/lib/track-engine";
import { collectCurtainTypes } from "../src/lib/curtain-cut-sheets/collect";
import { CUT_SHEET_STAMP, cutSheetModel, cutSheetPageCount, submittalSheetIndexes, type CutSheetContext } from "../src/lib/curtain-cut-sheets/model";
import { titleBlockData } from "../src/lib/design/grid-drawing-set";
import { cleanTrackConfig, freshTrackDraft, trackConfigFromDraft, trackDraftFromConfig, trackLineDesc } from "../src/app/(app)/estimator/track-bom";
import { angleAfterArcLengthEdit, angleFromArcLength, arcLengthText, blankSegment, pathToSegments, presetSegments, segmentsToPath, totalRunText, TRACK_PRESETS } from "../src/app/(app)/estimator/track-segment-draft";
import {
  audienceFrame, cleanPath, footprint, legHangingPoints, legPieces, legacyArc, pathErrors, pathLengthFt, pathSignature, pointAt,
  resolvePath, samplePath, segmentBounds, trackLegs, type TrackSegment,
} from "../src/lib/track-path";

import { CLIENT_LAYOUT_BOX, layoutView, MODAL_LAYOUT_BOX, SUBMITTAL_LAYOUT_BOX, trackLayoutSource } from "../src/lib/curtain-cut-sheets/layout";
import { ARCH_SCALES } from "../src/lib/curtain-cut-sheets/geometry";
import { textExtent, type Shape } from "../src/lib/curtain-cut-sheets/shapes";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 0, price: 0, ...extra }) as SpecItem;
const sec = (items: SpecItem[]): SpecSection => ({ id: "s1", name: "Stage", kind: "materials", mfr: "", freightPct: 0, items }) as SpecSection;
/** A curtain line read through curtainInputs (no catalog fabric needed). */
const curtain = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  line(id, {
    curtain: true,
    qty: 2,
    desc: "Main Drape",
    curtainInputs: { name: "Main Drape", fabricSku: "", fabricName: "Encore Velour 22 oz", qty: "2", width: "20", height: "18", fullness: "50" },
    ...extra,
  } as Partial<SpecItem>);
const collect = (items: SpecItem[], trackSeries: TrackSeries[] = []) =>
  collectCurtainTypes({ quote: { spec: { sections: [sec(items)], mobs: [] } }, fabrics: [], trackSeries, mounts: {}, partInfo: new Map(), grid: null });
const CTX: Omit<CutSheetContext, "style"> = {
  quote: { id: "Q-1", number: "EST-1042", name: "Main stage", customer: "Lakefront HS", venue: "Auditorium", revisions: [] },
  company: { name: "Peak Systems Group", logoDark: null, offices: [] },
  preparedBy: "Jeff Chesebro",
  index: 1,
  total: 1,
  now: 1,
};

export function stampChecks(ok: Ok) {
  ok(CUT_SHEET_STAMP === "PRELIMINARY — NOT FOR CONSTRUCTION", "#369 stamp: the exact words, em dash");
  const t = collect([curtain(1)]).types[0];
  ok(!!t, "#369 stamp: fixture collects one curtain type");
  const sub = cutSheetModel(t, { ...CTX, style: "submittal" });
  const cli = cutSheetModel(t, { ...CTX, style: "client" });
  ok(sub.titleBlock?.stamp === CUT_SHEET_STAMP, "#369 stamp: the Submittal title block carries the stamp");
  ok(cli.titleBlock === null, "#369 stamp: the Client style still has no title block");
  const drawingSet = titleBlockData({
    company: { name: "Peak" },
    project: { id: "G-1", name: "Gym", customer: "Lakefront HS", siteName: "Gym", intake: null, createdBy: "Jeff" },
    option: { name: "", quoteId: null },
    optionCount: 1,
    revisions: [],
    set: undefined,
    sheet: { number: "L-101", title: "Plan", scale: "NTS" },
    index: 1,
    total: 1,
    now: 1,
  } as Parameters<typeof titleBlockData>[0]);
  ok(!("stamp" in drawingSet), "#369 stamp: the Grid drawing set's title block has no stamp");
  const pages = src("src/components/cutsheets/cut-sheet-pages.tsx");
  ok((pages.match(/<Stamp \/>/g) || []).length >= 2, "#369 stamp: the Submittal and Client sheets both render <Stamp />");
  ok(src("src/components/drawing/title-block.tsx").includes("{data.stamp && <div className=\"pk-tb-stamp\">{data.stamp}</div>}"), "#369 stamp: the title block prints data.stamp only when set");
  const css = src("src/app/globals.css");
  ok(css.includes(".pk-cs-stamp {") && css.includes(".pk-cs-area {") && css.includes(".pk-tb-stamp {"), "#369 stamp: the banner, area and title-block styles exist");
}

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const S = (lengthFt: number): TrackSegment => ({ kind: "straight", lengthFt });
const A = (radiusFt: number, sweepDeg: number, turn: "left" | "right" = "left"): TrackSegment => ({ kind: "arc", radiusFt, sweepDeg, turn });
const FACTS = { name: "ADC 280", curvedSectionFt: 10, minRadiusFt: 5, hasSticks: true };

export function trackPathChecks(ok: Ok) {
  const quarter = [A(10, 90)];
  ok(near(pathLengthFt(quarter), 5 * Math.PI), "#369 path: a 90° R10 arc is 5π ft long");
  const e = pointAt(quarter, pathLengthFt(quarter));
  ok(near(e.x, 10) && near(e.y, 10) && near(e.headingDeg, 90), "#369 path: a left quarter arc from heading +x ends at (R, R) heading 90°");
  const r = pointAt([A(10, 90, "right")], 5 * Math.PI);
  ok(near(r.x, 10) && near(r.y, -10) && near(r.headingDeg, -90), "#369 path: a right quarter arc ends at (R, −R) heading −90°");
  const full = pointAt([A(7, 360)], 14 * Math.PI);
  ok(near(full.x, 0) && near(full.y, 0), "#369 path: a 360° arc closes on its start");
  const legs = [S(12), A(6, 90), S(12)];
  ok(segmentBounds(legs).map((n) => Math.round(n * 1000) / 1000).join() === "0,12,21.425,33.425", "#369 path: segment bounds are cumulative lengths");
  const sl = pointAt(legs, 33.4247779);
  ok(near(sl.x, 18, 1e-4) && near(sl.y, 18, 1e-4), "#369 path: straight · 90° · straight ends where the geometry says");
  ok(samplePath(legs, 1).length >= 34 && samplePath([], 1).length === 0, "#369 path: sampling covers the path; an empty path samples nothing");

  // orientation: the bulge goes to +y (upstage) so the concave side faces the audience (−y)
  for (const [name, p] of [["semicircle", [A(10, 180)]], ["U wrap", [S(10), A(2, 90), S(10), A(2, 90), S(10)]], ["right arc", [A(10, 120, "right")]]] as const) {
    const f = audienceFrame(p as readonly TrackSegment[]);
    const pts = samplePath(p as readonly TrackSegment[], 0.5).map(f);
    const s0 = pts[0], s1 = pts[pts.length - 1];
    const mean = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    ok(near(s0.y, s1.y, 1e-6) && s1.x > s0.x && mean > 0, `#369 path: ${name} — start→end runs left to right and the bulge is upstage`);
  }
  const fp = footprint([A(10, 180)]);
  ok(near(fp.widthFt, 20, 1e-3) && near(fp.depthFt, 10, 1e-2), "#369 path: a semicircle R10 is 20' wide and 10' deep");

  // validation
  ok(pathErrors([], FACTS, 1000).join() === "Add a segment to the curve.", "#369 path: an empty path asks for a segment");
  ok(pathErrors([S(10), A(3, 90)], FACTS, 1000).includes("Segment 2: 3' is tighter than the ADC 280's 5' minimum."), "#369 path: a too-tight arc names its segment and the series minimum");
  ok(pathErrors([S(10), S(5)], FACTS, 1000).includes("A curved track needs at least one arc — make it Straight instead."), "#369 path: all straights is refused");
  ok(pathErrors([A(10, 90)], { ...FACTS, curvedSectionFt: undefined }, 1000).includes("ADC 280 has no curved track."), "#369 path: a series with no curved section refuses any arc");
  ok(pathErrors([A(10, 400)], FACTS, 1000).includes("Segment 1: the angle is more than 0° and at most 360°."), "#369 path: angle over 360° is refused");
  ok(pathErrors([S(NaN), A(NaN, 90)], FACTS, 1000).join("|") === "Segment 1: enter the length.|Segment 2: enter the radius.", "#369 path: blank numbers name their segment");
  ok(pathErrors(Array.from({ length: 13 }, () => A(10, 10)), FACTS, 1000).includes("A curved track has at most 12 segments."), "#369 path: at most 12 segments");
  ok(pathErrors([S(10), A(6, 90)], { ...FACTS, hasSticks: false }, 1000).includes("ADC 280 has no stick length — set it in Estimating Rules → Track series."), "#369 path: a straight segment needs sticks");
  ok(pathErrors([S(990), A(10, 180)], FACTS, 1000).includes("A run is at most 1000'."), "#369 path: the total run is capped");
  ok(pathErrors([{ ...A(10, 90), turn: "up" } as unknown as TrackSegment], FACTS, 1000).includes("Segment 1: pick Left or Right."), "#369 path: a bad turn names its segment");
  ok(pathErrors(legs, FACTS, 1000).length === 0, "#369 path: a good path has no errors");

  // legacy + resolve
  const legacy = legacyArc(40, 30);
  ok(legacy.length === 1 && legacy[0].kind === "arc" && near(pathLengthFt(legacy), 40, 1e-9), "#369 path: a legacy curved track is one arc of its run");
  ok(resolvePath({ curved: false, runFt: 40 }) === null, "#369 path: a straight track has no path");
  ok(resolvePath({ curved: true, runFt: 40, radiusFt: 30 })!.length === 1 && resolvePath({ curved: true, runFt: 40, path: [] })!.length === 0, "#369 path: legacy arcs resolve; an explicit (even empty) path wins");
  ok(legacyArc(40, undefined).length === 0, "#369 path: a legacy curve with no radius resolves to nothing");

  // legs, pieces, hanging points
  ok(JSON.stringify(trackLegs(40, 0)) === JSON.stringify([{ startFt: 0, endFt: 40 }]), "#369 path: no lap = one leg");
  const lap = trackLegs(40, 2);
  ok(near(lap[0].endFt - lap[0].startFt, 21) && near(lap[1].endFt - lap[1].startFt, 21) && near(lap[1].startFt, 19), "#369 path: a lapped bi-part is two legs of (run + overlap) / 2 meeting at center");
  const pcs = legPieces(legs, { startFt: 0, endFt: pathLengthFt(legs) });
  ok(pcs.map((p) => `${p.kind}:${Math.round(p.lengthFt * 100) / 100}`).join() === "straight:12,arc:9.42,straight:12", "#369 path: a leg's pieces follow its segments");
  const half = legPieces(legs, { startFt: 0, endFt: 16 });
  ok(half.length === 2 && near(half[1].lengthFt, 4), "#369 path: a leg ending mid-segment keeps only its share");
  ok(legHangingPoints([A(30, 76.39437268)], { startFt: 0, endFt: 40 }, 7).length === 7, "#369 path: one segment = ceil(L / spacing) + 1 points (today's rule)");
  const hp = legHangingPoints(legs, { startFt: 0, endFt: pathLengthFt(legs) }, 7);
  ok(hp.length === 7 && hp.some((d) => near(d, 12)) && hp.some((d) => near(d, 21.4247779, 1e-6)), "#369 path: every segment joint gets a hanging point");

  ok(pathSignature(legs) === "s12|a6:90:L|s12", "#369 path: a stable signature");
  ok(JSON.stringify(cleanPath([{ kind: "arc", radiusFt: 6, sweepDeg: 90, turn: "left", junk: 1 } as unknown as TrackSegment])) === JSON.stringify([A(6, 90)]), "#369 path: cleanPath keeps only segment fields");
}

const STICKS = [12, 14, 16, 18, 20, 22, 24].map((l) => ({ lengthFt: l, sku: `S-${l}` }));
const ROLES = ["splice", "carrier", "masterCarrier", "endStop", "battenClamp", "ceilingHanger", "livePulley", "deadPulley", "floorBlock", "operatingLine", "curved"];
export function series(over: Partial<TrackSeries> = {}): TrackSeries {
  return sanitizeTrackSeries({
    id: "adc-280", name: "ADC 280", manufacturer: "ADC", sticks: STICKS, carrierSpacingIn: 12, hangerSpacingFt: 7, overlapFt: 2,
    curvedSectionFt: 10, minRadiusFt: 5, parts: Object.fromEntries(ROLES.map((r) => [r, { sku: `P-${r}` }])), active: true, ...over,
  })!;
}
export const cfg = (over: Partial<TrackConfig> = {}): TrackConfig => ({ seriesId: "adc-280", operation: "oneway", runFt: 40, curved: false, mounting: "batten", qty: 1, ...over });
/** role → qty, sticks as "track:S-12" → qty. */
function qtys(c: TrackConfig, s = series()): Record<string, number> & { errors?: string } {
  const r = trackQuantities(c, s);
  const out: Record<string, number> & { errors?: string } = {};
  if (r.errors.length) out.errors = r.errors.join("|");
  for (const row of r.rows) out[row.role === "track" ? `track:${row.sku}` : row.role] = (out[row.role === "track" ? `track:${row.sku}` : row.role] ?? 0) + row.qty;
  return out;
}

export function curvedEngineChecks(ok: Ok) {
  // straight tracks are untouched
  const st = qtys(cfg());
  ok(st["track:S-20"] === 2 && st.splice === 1 && st.battenClamp === 7 && st.carrier === 39, "#369 engine: a straight 40' track prices as before");

  // legacy curved (no path) — today's numbers
  const lg = qtys(cfg({ curved: true, radiusFt: 30 }));
  ok(lg.curved === 4 && lg.splice === 3 && lg.battenClamp === 7 && !lg.errors, "#369 engine: a legacy curved 40' run is 4 sections, 3 splices, 7 clamps");
  const lgBi = qtys(cfg({ curved: true, radiusFt: 30, operation: "biparting" }));
  ok(lgBi.curved === 6 && lgBi.splice === 4 && lgBi.battenClamp === 8 && lgBi.masterCarrier === 2, "#369 engine: a legacy curved lapped bi-part is two legs of 21'");
  const sameAsPath = (c: TrackConfig) => JSON.stringify(trackQuantities(c, series())) === JSON.stringify(trackQuantities({ ...c, path: resolvePath(c)! }, series()));
  ok(sameAsPath(cfg({ curved: true, radiusFt: 30 })) && sameAsPath(cfg({ curved: true, radiusFt: 30, operation: "biparting" })) && sameAsPath(cfg({ curved: true, radiusFt: 25, runFt: 63.5, mounting: "ceiling", qty: 3 })),
    "#369 engine: a legacy curve and the same curve as an explicit one-arc path price identically");
  ok(qtys(cfg({ curved: true })).errors === "Enter the curve radius.", "#369 engine: a legacy curve with no radius keeps today's error");

  // mixed one-way: straight 12 · R6 90° · straight 12 (run 33.42')
  const mixed = [S(12), A(6, 90), S(12)];
  const mx = qtys(cfg({ curved: true, path: mixed, runFt: pathLengthFt(mixed) }));
  ok(mx["track:S-12"] === 2 && mx.curved === 1 && mx.splice === 2 && mx.battenClamp === 7 && mx.carrier === 33 && mx.endStop === 2 && !mx.errors,
    "#369 engine: straights buy sticks, the arc buys a section, a splice per joint, a clamp at every joint");
  // the engine reads the run from the path, not the stored runFt
  ok(JSON.stringify(qtys(cfg({ curved: true, path: mixed, runFt: 999 }))) === JSON.stringify(mx), "#369 engine: a segmented track's run is its path length");

  // mixed lapped bi-part: straight 10 · R8 180° · straight 10, overlap 2
  const bi = [S(10), A(8, 180), S(10)];
  const bx = qtys(cfg({ curved: true, path: bi, runFt: pathLengthFt(bi), operation: "biparting" }));
  ok(bx["track:S-12"] === 2 && bx.curved === 4 && bx.splice === 4 && bx.battenClamp === 10 && bx.masterCarrier === 2,
    "#369 engine: a lapped bi-part splits at center — each leg buys its own straight, arc share, splices and clamps");
  const two = qtys(cfg({ curved: true, path: bi, runFt: pathLengthFt(bi), operation: "biparting", qty: 2 }));
  ok(two.curved === 8 && two.battenClamp === 20 && two["track:S-12"] === 4, "#369 engine: qty multiplies every row");

  // errors
  ok(qtys(cfg({ curved: true, path: [S(10), A(3, 90)], runFt: 0 })).errors === "Segment 2: 3' is tighter than the ADC 280's 5' minimum.", "#369 engine: a too-tight arc refuses the track by segment");
  ok(qtys(cfg({ curved: true, path: [], runFt: 0 })).errors === "Add a segment to the curve.", "#369 engine: an empty path asks for a segment (no run-length error)");
  ok((qtys(cfg({ curved: true, path: mixed, runFt: 0 }), series({ curvedSectionFt: undefined })).errors || "").includes("ADC 280 has no curved track."), "#369 engine: no curved section, no curve");
}

export function segmentDraftChecks(ok: Ok) {
  const mixed = [S(12), A(6, 90), S(12)];
  ok(JSON.stringify(segmentsToPath(pathToSegments(mixed))) === JSON.stringify(mixed), "#369 draft: path → segments → path round-trips");
  ok(arcLengthText({ kind: "arc", length: "", radius: "6", angle: "90", turn: "left" }) === "9.42", "#369 draft: an arc row shows its arc length");
  ok(angleFromArcLength("10", "6") === "95.493", "#369 draft: typing an arc length back-solves the angle");
  ok(arcLengthText({ kind: "arc", length: "", radius: "", angle: "90", turn: "left" }) === "" && angleFromArcLength("10", "") === "", "#369 draft: no radius, no arc math");
  ok(totalRunText(pathToSegments(mixed)) === "33.42" && totalRunText([]) === "", "#369 draft: the total run reads the segments");

  const fresh = freshTrackDraft([series()]);
  ok(Array.isArray(fresh.segments) && fresh.segments.length === 0, "#369 draft: a new track starts with no segments");
  // fresh drafts default to bi-parting; the description checks below expect one-way
  const d = { ...fresh, operation: "oneway" as const, curved: true, segments: pathToSegments(mixed) };
  const c = trackConfigFromDraft(d);
  ok(JSON.stringify(c.path) === JSON.stringify(mixed) && Math.abs(c.runFt - 33.4248) < 1e-3 && c.radiusFt === 6, "#369 draft: a curved draft saves its path, the run = its length, radiusFt = its tightest arc");
  ok(JSON.stringify(trackConfigFromDraft({ ...fresh, curved: true }).path) === "[]", "#369 draft: curved with no rows saves an empty path (the engine asks for a segment)");
  ok(trackConfigFromDraft({ ...d, curved: false }).path === undefined, "#369 draft: a straight draft saves no path");

  // a legacy curve reopens as one arc and re-saves to the same BOM
  const legacy = cfg({ curved: true, radiusFt: 30 });
  const reopened = trackDraftFromConfig(legacy);
  ok(reopened.segments?.length === 1 && reopened.segments[0].radius === "30" && reopened.segments[0].angle === "76.3944", "#369 draft: a legacy curve reopens as one arc row");
  ok(JSON.stringify(trackQuantities(trackConfigFromDraft(reopened), series()).rows) === JSON.stringify(trackQuantities(legacy, series()).rows), "#369 draft: re-saving a reopened legacy curve keeps its parts");
  ok(trackDraftFromConfig(cfg()).segments?.length === 0, "#369 draft: a straight track reopens with no rows");

  // reopen parity at exact hanger multiples: the saved 4-decimal sweep overshoots by ~1e-5 ft and must not buy a clamp
  const reopenCases: [string, TrackConfig][] = [
    ["R30 40' @5' hangers", cfg({ curved: true, radiusFt: 30, hangerSpacingFt: 5 })],
    ["R30 40' @4' hangers", cfg({ curved: true, radiusFt: 30, hangerSpacingFt: 4 })],
    ["R30 40' @8' hangers", cfg({ curved: true, radiusFt: 30, hangerSpacingFt: 8 })],
    ["R30 40' @10' hangers", cfg({ curved: true, radiusFt: 30, hangerSpacingFt: 10 })],
    ["R20 30' @5' hangers", cfg({ curved: true, radiusFt: 20, runFt: 30, hangerSpacingFt: 5 })],
    ["R30 38' bi-part @5' hangers", cfg({ curved: true, radiusFt: 30, runFt: 38, operation: "biparting", hangerSpacingFt: 5 })],
    ["R25 50' @5' hangers", cfg({ curved: true, radiusFt: 25, runFt: 50, hangerSpacingFt: 5 })],
  ];
  for (const [name, legacyCfg] of reopenCases) {
    ok(
      JSON.stringify(trackQuantities(trackConfigFromDraft(trackDraftFromConfig(legacyCfg)), series()).rows) === JSON.stringify(trackQuantities(legacyCfg, series()).rows),
      `#369 draft: re-saving a reopened legacy curve keeps its parts — ${name}`
    );
  }
  // unticking Curved on a reopened curve prices as a strict straight 40', not a drifted 40.0000143'
  {
    const reopenedCurve = trackDraftFromConfig(trackConfigFromDraft(trackDraftFromConfig(cfg({ curved: true, radiusFt: 30, hangerSpacingFt: 5 }))));
    const unticked = trackConfigFromDraft({ ...reopenedCurve, curved: false });
    ok(
      JSON.stringify(trackQuantities(unticked, series()).rows) === JSON.stringify(trackQuantities(cfg({ hangerSpacingFt: 5 }), series()).rows),
      "#369 draft: unticking Curved on a reopened 40' R30' curve prices as a straight 40'"
    );
    ok(trackConfigFromDraft(trackDraftFromConfig(cfg({ curved: true, radiusFt: 30 }))).runFt === 40, "#369 draft: a re-saved legacy 40' R30' curve stores a run of exactly 40");
  }
  const typed = { ...freshTrackDraft([series()]), operation: "oneway" as const, curved: true, hangerSpacing: "5", segments: [{ kind: "arc" as const, length: "40", radius: "30", angle: angleFromArcLength("40", "30"), turn: "left" as const }] };
  const typedQ = trackQuantities(trackConfigFromDraft(typed), series()).rows;
  const legacyQ = trackQuantities(cfg({ curved: true, radiusFt: 30, hangerSpacingFt: 5 }), series()).rows;
  const pick = (rows: typeof typedQ) => JSON.stringify(rows.filter((r) => r.role === "curved" || r.role === "carrier" || r.role === "battenClamp"));
  ok(pick(typedQ) === pick(legacyQ) && pick(typedQ).includes("battenClamp"), "#369 draft: a new arc typed as 40' length at R30 prices the same curved, carrier and clamp counts as the legacy curve");

  const cleaned = cleanTrackConfig({ ...c, path: [...mixed, { kind: "arc", radiusFt: 9, sweepDeg: 45, turn: "right", junk: 1 } as unknown as TrackSegment] });
  ok(cleaned.path?.length === 4 && !JSON.stringify(cleaned).includes("junk"), "#369 draft: cleanTrackConfig keeps a curved track's path, segment fields only");
  ok(cleanTrackConfig({ ...c, curved: false }).path === undefined, "#369 draft: cleanTrackConfig drops a path off a straight track");

  const s = { name: "ADC 280" };
  ok(trackLineDesc(c, s) === "Track — ADC 280 one-way track, 33.42' run, curved: 3 segments (R6')", "#369 draft: a multi-segment curve says how many segments and its radii");
  ok(trackLineDesc({ ...c, path: [S(10), A(12, 30), S(4), A(2, 90, "right")] }, s).endsWith("curved: 4 segments (R12', R2')"), "#369 draft: distinct radii in path order");
  ok(trackLineDesc(legacy, s) === "Track — ADC 280 one-way track, 40' run, curved R30'", "#369 draft: a single arc keeps today's wording");

  ok(TRACK_PRESETS.map((p) => p.id).join() === "single,legs,u,serpentine", "#369 presets: four shapes");
  for (const p of TRACK_PRESETS) {
    const path = segmentsToPath(presetSegments(p.id, 40, 2));
    ok(pathErrors(path, { ...FACTS, minRadiusFt: 2 }, 1000).length === 0 && Math.abs(pathLengthFt(path) - 40) < 0.6, `#369 presets: ${p.label} is a valid ~40' path`);
  }
  ok(segmentsToPath(presetSegments("single", NaN)).length === 1, "#369 presets: a blank run still makes a preset (40')");
  ok(segmentsToPath(presetSegments("u", 40, 2)).filter((x) => x.kind === "arc").every((x) => x.kind === "arc" && x.sweepDeg === 90 && x.radiusFt === 2), "#369 presets: U wrap has two 90° corners at the series minimum");
}

/** Every coordinate a shape draws at (path data parsed for its numbers). */
function coords(shapes: readonly Shape[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const s of shapes) {
    if (s.kind === "line") out.push([s.x1, s.y1], [s.x2, s.y2]);
    else if (s.kind === "text") out.push([s.x, s.y]);
    else if (s.kind === "path") {
      const n = (s.d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
      for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
    }
  }
  return out;
}
/** Every shape lands inside the box: lines and paths by coordinate, text by its estimated extent (rotated text swaps the axes). */
function fits(shapes: readonly Shape[], box: { wIn: number; hIn: number }): boolean {
  const inBox = (x: number, y: number) => x >= 0 && y >= 0 && x <= box.wIn && y <= box.hIn;
  return shapes.every((s) => {
    if (s.kind !== "text") return coords([s]).every(([x, y]) => inBox(x, y));
    if (s.rotate) {
      const w = textExtent({ x: 0, text: s.text, size: s.size, anchor: "middle" }).x1;
      return s.y - w / 2 >= 0 && s.y + w / 2 <= box.hIn && s.x - s.size / 2 >= 0 && s.x + s.size / 2 <= box.wIn;
    }
    const e = textExtent({ x: s.x, text: s.text, size: s.size, anchor: s.anchor });
    return e.x0 >= 0 && e.x1 <= box.wIn && s.y - s.size * 0.75 >= 0 && s.y <= box.hIn;
  });
}
const texts = (shapes: readonly Shape[]) => shapes.flatMap((s) => (s.kind === "text" ? [s.text] : []));

export function layoutViewChecks(ok: Ok) {
  const s = series();
  ok(trackLayoutSource(cfg(), s) === null, "#369 layout: a straight track has no layout");
  const bi = [S(10), A(8, 180), S(10)];
  const biCfg = cfg({ curved: true, path: bi, runFt: pathLengthFt(bi), operation: "biparting", qty: 2 });
  const src = trackLayoutSource(biCfg, s)!;
  ok(src.opening === "bipart" && src.lapOverlapFt === 2 && src.mountLabel === "Batten clamps" && src.hangerSpacingFt === 7 && src.trackQty === 2, "#369 layout: the source reads the track and series");
  ok(trackLayoutSource({ ...biCfg, mounting: "ceiling", operation: "oneway" }, s)!.mountLabel === "Ceiling hangers" && trackLayoutSource({ ...biCfg, operation: "oneway" }, s)!.opening === "oneway",
    "#369 layout: ceiling mounting → hangers; one-way opens one way");
  ok(trackLayoutSource({ ...biCfg, operation: "walkalong" }, s)!.opening === "none" && trackLayoutSource({ ...biCfg, operation: "walkalong", walkAlongBipart: true }, s)!.opening === "bipart",
    "#369 layout: a walk-along has no travel arrow unless it is a two-half bi-part");
  ok(trackLayoutSource(cfg({ curved: true, path: [A(NaN, 90)], runFt: NaN }), s) === null, "#369 layout: an unfinished path has no layout");

  const sub = layoutView(src, { box: SUBMITTAL_LAYOUT_BOX, detail: "submittal" });
  const engineClamps = trackQuantities(biCfg, s).rows.find((r) => r.role === "battenClamp")!.qty;
  ok(sub.hangingCount * 2 === engineClamps, "#369 layout: the drawn hanging points × tracks equal the engine's clamp count");
  ok(texts(sub.shapes).includes(`Batten clamps (${sub.hangingCount} per track)`), "#369 layout: the caption counts per track when the line has several");
  ok(ARCH_SCALES.some((a) => a.label === sub.scale), "#369 layout: an architectural scale");
  ok(fits(sub.shapes, SUBMITTAL_LAYOUT_BOX), "#369 layout: every Submittal shape lands on the sheet");
  ok(texts(sub.shapes).some((t) => t.startsWith(`R8'-0" · 180° · `)) && texts(sub.shapes).includes(`10'-0"`), "#369 layout: arcs print radius · angle · arc length; straights their length");
  ok(texts(sub.shapes).includes("AUDIENCE") && texts(sub.shapes).includes(`2'-0" lap`), "#369 layout: the audience and the bi-part lap are labelled");
  ok(sub.shapes.some((x) => x.tag === "mark"), "#369 layout: the Submittal draws hanging-point and split marks");

  const semi = trackLayoutSource(cfg({ curved: true, path: [A(10, 180)], runFt: 10 * Math.PI }), s)!;
  const semiView = layoutView(semi, { box: SUBMITTAL_LAYOUT_BOX, detail: "submittal" });
  ok(texts(semiView.shapes).includes(`20'-0" overall`) && texts(semiView.shapes).includes(`10'-0" deep`), "#369 layout: the footprint prints overall width and depth");

  const cli = layoutView(src, { box: CLIENT_LAYOUT_BOX, detail: "client" });
  ok(!cli.shapes.some((x) => x.tag === "mark") && !texts(cli.shapes).some((t) => t.includes("clamps")) && !texts(cli.shapes).some((t) => t.includes("°")),
    "#369 layout: the Client view has no hanging points, no angles");
  ok(texts(cli.shapes).includes("AUDIENCE") && texts(cli.shapes).includes(`R8'-0"`), "#369 layout: the Client view keeps the radius and the audience");
  ok(fits(cli.shapes, CLIENT_LAYOUT_BOX), "#369 layout: every Client shape lands in its box");
  const u = trackLayoutSource(cfg({ curved: true, path: segmentsToPath(presetSegments("u", 40, 2)), runFt: 40 }), series({ minRadiusFt: 2 }))!;
  ok(fits(layoutView(u, { box: SUBMITTAL_LAYOUT_BOX, detail: "submittal" }).shapes, SUBMITTAL_LAYOUT_BOX), "#369 layout: a U wrap fits the sheet");

  // oversized tracks shrink to fit their box and read NTS; labels stay on the sheet
  const boxes = [["Submittal", SUBMITTAL_LAYOUT_BOX, "submittal"], ["Client", CLIENT_LAYOUT_BOX, "client"], ["Modal", MODAL_LAYOUT_BOX, "client"]] as const;
  const semi50 = trackLayoutSource(cfg({ curved: true, path: [A(25, 180)], runFt: 25 * Math.PI, operation: "biparting" }), s)!;
  const wideU = segmentsToPath(presetSegments("u", 120, 2));
  const u70 = trackLayoutSource(cfg({ curved: true, path: wideU, runFt: pathLengthFt(wideU), operation: "biparting" }), series({ minRadiusFt: 2 }))!;
  for (const [name, box, detail] of boxes) {
    ok(fits(layoutView(semi50, { box, detail }).shapes, box), `#369 layout: a 50' semicircle fits the ${name} box`);
    ok(fits(layoutView(u70, { box, detail }).shapes, box), `#369 layout: a 70'+ wide U fits the ${name} box`);
  }
  ok(layoutView(semi50, { box: CLIENT_LAYOUT_BOX, detail: "client" }).scale === "NTS", "#369 layout: a 50' semicircle in the Client box reads NTS");
  ok(ARCH_SCALES.some((a) => a.label === layoutView(src, { box: SUBMITTAL_LAYOUT_BOX, detail: "submittal" }).scale), "#369 layout: a small Submittal track keeps an architectural scale");
  ok(fits(layoutView(src, { box: MODAL_LAYOUT_BOX, detail: "client" }).shapes, MODAL_LAYOUT_BOX), "#369 layout: the mixed bi-part path fits the modal box");
}

export function configuratorChecks(ok: Ok) {
  const modal = src("src/app/(app)/estimator/track-modal.tsx");
  const editor = src("src/app/(app)/estimator/track-segments.tsx");
  ok(modal.includes('import { TrackSegmentsEditor } from "./track-segments";') && /\{draft\.curved && <TrackSegmentsEditor /.test(modal), "#369 UI: the track fields show the segment editor on a curved track");
  ok(/draft\.curved \? !\(draft\.segments \|\| \[\]\)\.length : !draft\.run\.trim\(\)/.test(modal), "#369 UI: an untouched curved form (no rows) shows no errors; a straight one keys off the run");
  ok(editor.includes("TRACK_PRESETS.map") && editor.includes("+ Add segment") && editor.includes("Total run"), "#369 UI: presets, + Add segment and the total run");
  ok(editor.includes("layoutView(") && editor.includes("MODAL_LAYOUT_BOX") && editor.includes("<ShapeSvg"), "#369 UI: the live mini plan uses the cut sheet's layout shapes");
  ok(editor.includes("MAX_TRACK_SEGMENTS") && editor.includes("angleAfterArcLengthEdit("), "#369 UI: the 12-segment cap and the arc-length back-solve");
  ok(!/@\/lib\/stores\/|@\/db/.test(editor), "#369 UI: the segment editor imports no store or db");
  const arcSeg = { ...blankSegment("arc"), radius: "6", angle: "90" };
  ok(angleAfterArcLengthEdit("9.", arcSeg) === angleFromArcLength("9", "6"), "#369 UI: a half-typed \"9.\" back-solves the angle for 9");
  ok(angleAfterArcLengthEdit("9.5", arcSeg) === angleFromArcLength("9.5", "6"), "#369 UI: \"9.5\" back-solves the angle for 9.5");
  ok(["0", "0.", ""].every((t) => angleAfterArcLengthEdit(t, arcSeg) === "90"), "#369 UI: \"0\", \"0.\" and an empty box leave the angle unchanged");
  ok(angleAfterArcLengthEdit("10", { ...blankSegment("arc"), radius: "", angle: "45" }) === "45", "#369 UI: with no radius a typed length leaves the angle unchanged");
  ok(editor.includes("useState<string | null>(null)") && editor.includes("angleAfterArcLengthEdit("), "#369 UI: the Arc ft box keeps what is typed while focused");
}

/** A track line built the way the Estimator builds one: components from the engine's rows. */
function trackItem(id: number, c: TrackConfig, s: TrackSeries, key: string): SpecItem {
  const rows = trackQuantities(c, s).rows;
  return line(id, {
    sku: "TRK-ADC-280", desc: "Main track", unit: "lot", track: c, curtainTrackKey: key,
    components: rows.map((r) => ({ sku: r.sku || s.parts[r.role]?.sku || r.role, label: r.role, role: ["battenClamp", "ceilingHanger"].includes(r.role) ? "mount" : "other", qty: r.qty, unit: "ea", cost: 1, price: 2 })),
  } as Partial<SpecItem>);
}

export function curvedCutSheetChecks(ok: Ok) {
  const s = series();
  const bi = [S(10), A(8, 180), S(10)];
  const curvedCfg = cfg({ curved: true, path: bi, runFt: pathLengthFt(bi), operation: "biparting" });
  const r = collect([curtain(1, { curtainTrackKey: "ct-1-a" }), trackItem(2, curvedCfg, s, "ct-1-a")], [s]);
  const t = r.types[0];
  ok(r.types.length === 1 && !!t.curtains[0].mount.track?.layout, "#369 sheets: a curtain on a curved track carries its layout");
  ok(cutSheetPageCount(t) === 2, "#369 sheets: a curved type prints two Submittal pages");
  const sub = cutSheetModel(t, { ...CTX, index: 1, total: 2, style: "submittal" });
  ok(sub.layout?.sheetNo === "CS-1.1" && sub.layout.titleBlock?.sheet.number === "CS-1.1" && sub.layout.titleBlock.sheet.title === "Layout — Main Drape",
    "#369 sheets: the layout sheet is CS-n.1, titled Layout — <title>");
  ok(sub.layout?.titleBlock?.sheet.index === 2 && sub.layout.titleBlock.sheet.total === 2 && sub.layout.titleBlock.stamp === CUT_SHEET_STAMP && sub.layout.titleBlock.scale === `Plan ${sub.layout.scale}`,
    "#369 sheets: the layout sheet is the next sheet in the set, stamped, at its plan scale");
  const clamps = t.hardware.find((h) => h.sku === "P-battenClamp")!.qty;
  ok(sub.layout!.hangingCount === clamps, "#369 sheets: the layout's hanging points equal the hardware table");
  ok(sub.elevation.shapes.some((x) => x.kind === "text" && x.text === `20'-0" along track`), "#369 sheets: a curved curtain's elevation width reads along the track");
  const cli = cutSheetModel(t, { ...CTX, style: "client" });
  ok(cli.layout !== null && cli.layout.titleBlock === null && !cli.layout.shapes.some((x) => x.tag === "mark"), "#369 sheets: the Client layout is the simple drawing, no title block");
  ok(!/"sku"/.test(JSON.stringify(cli)), "#369 sheets: the Client model still carries no SKU");

  // types split by layout; straight work is unchanged
  const other = [S(6), A(8, 180), S(6)];
  const two = collect([
    curtain(1, { curtainTrackKey: "ct-1-a" }), trackItem(2, curvedCfg, s, "ct-1-a"),
    curtain(3, { curtainTrackKey: "ct-3-b" }), trackItem(4, cfg({ curved: true, path: other, runFt: pathLengthFt(other), operation: "biparting" }), s, "ct-3-b"),
  ], [s]);
  ok(two.types.length === 2, "#369 sheets: curtains on different layouts are separate types");
  const straight = collect([curtain(1, { curtainTrackKey: "ct-1-a" }), trackItem(2, cfg({ operation: "biparting" }), s, "ct-1-a")], [s]).types[0];
  ok(cutSheetPageCount(straight) === 1 && cutSheetModel(straight, { ...CTX, style: "submittal" }).layout === null && !straight.curtains[0].mount.track?.layout,
    "#369 sheets: a straight track prints one sheet and no layout");
  ok(!straight.key.includes(":path:"), "#369 sheets: a straight track's type key is unchanged");
  const idx = submittalSheetIndexes([t, straight, t]);
  ok(idx.starts.join() === "1,3,4" && idx.total === 5, "#369 sheets: Submittal sheet numbers count layout sheets");

  // two identical curtains on their own track lines merge; the caption counts both tracks
  const lineCfg = (hs?: number) => cfg({ curved: true, path: bi, runFt: pathLengthFt(bi), operation: "biparting", ...(hs ? { hangerSpacingFt: hs } : {}) });
  const pair = (hs2?: number) => collect([
    curtain(1, { curtainTrackKey: "ct-1-a" }), trackItem(2, lineCfg(), s, "ct-1-a"),
    curtain(3, { curtainTrackKey: "ct-3-b" }), trackItem(4, lineCfg(hs2), s, "ct-3-b"),
  ], [s]);
  const merged = pair();
  ok(merged.types.length === 1, "#369 sheets: two identical curved curtains on two track lines are one type");
  const mt = merged.types[0];
  const msub = cutSheetModel(mt, { ...CTX, index: 1, total: 2, style: "submittal" });
  const mClamps = mt.hardware.find((h) => h.sku === "P-battenClamp")!.qty;
  ok(msub.layout!.hangingCount * 2 === mClamps, "#369 sheets: a merged type's hanging points x its tracks equal the hardware table");
  ok(texts(msub.layout!.shapes).includes(`Batten clamps (${msub.layout!.hangingCount} per track)`), "#369 sheets: a merged type's caption reads per track");
  ok(pair(5).types.length === 2, "#369 sheets: different hanger spacings are separate types");

  const pages = src("src/components/cutsheets/cut-sheet-pages.tsx");
  ok(pages.includes("function LayoutSheet") && /\{m\.layout && <LayoutSheet m=\{m\} \/>\}/.test(pages) && pages.includes("Track layout"), "#369 sheets: the Submittal set prints the layout sheet; the Client sheet the Track layout");
  ok((pages.match(/<Stamp \/>/g) || []).length >= 3, "#369 sheets: the layout sheet is stamped too");
  ok(src("src/lib/curtain-cut-sheets/load.ts").includes("submittalSheetIndexes(result.types)"), "#369 sheets: load numbers the Submittal sheets with submittalSheetIndexes");
}

export async function curvedTrackChecks(ok: Ok) {
  stampChecks(ok);
  trackPathChecks(ok);
  curvedEngineChecks(ok);
  segmentDraftChecks(ok);
  layoutViewChecks(ok);
  configuratorChecks(ok);
  curvedCutSheetChecks(ok);
}

if (process.argv[1]?.endsWith("test-curved-track.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  curvedTrackChecks(okf).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
