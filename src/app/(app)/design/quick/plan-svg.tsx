/**
 * Generated groundplans — port of the buildPlan* functions from
 * app/Quick Design.dc.html (proscenium, church, conference/flat, gym,
 * black box, arena) plus the shared dimension-line / FOH-mix helpers,
 * the legend builder, and the interactive wall handles.
 *
 * The builders return primitive lists ({rects,lines,circles,texts,paths})
 * exactly like the prototype; <PlanSvg> renders them.
 */

import type * as React from "react";
import { LIM, SYSCOLOR, VENUES, type AState, type SysKey, type VenueKind } from "./engine";
import { churchDims, houseDims, houseSpecFor, houseWidthLim, prosceniumDims } from "@/lib/design/venue-templates/house-dims";
import { resolveBackground, templateEntry } from "@/lib/design/venue-templates";
import { keysById, stretchById } from "@/lib/design/venue-templates/templates";
import { boxOf, canvasOf, rowSpans, type Box } from "@/lib/design/venue-templates/canvas";

/* ------------------------------ primitive types ------------------------------ */

type Rect = { x: number; y: number; w: number; h: number; fill: string; stroke: string; sw: number; rx?: number; dash?: string };
type LineEl = { x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; dash?: string };
type CircleEl = { cx: number; cy: number; r: number; fill: string };
type TextEl = { x: number; y: number; t: string; fill: string; size: number; weight?: number; anchor: string; transform?: string };
type PathEl = { d: string; fill: string; stroke?: string; sw?: number; dash?: string };

export type PlanHandle = {
  type: "wall";
  side: "L" | "R" | "B";
  cx: number;
  cy: number;
  shape: "wall" | "backWall";
};

export type PlanData = {
  W: number;
  H: number;
  rects: Rect[];
  lines: LineEl[];
  circles: CircleEl[];
  texts: TextEl[];
  paths: PathEl[];
  handles?: PlanHandle[];
  legend?: Array<{ sw: React.CSSProperties; label: string }>;
  isHouse?: boolean;
  canSlideWalls?: boolean;
};

type L = { rects: Rect[]; lines: LineEl[]; circles: CircleEl[]; texts: TextEl[]; paths: PathEl[] };

const R = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ------------------------- shared drawing helpers ------------------------- */

function dimH(L: L, ax: number, bx: number, y: number, label: string, faint: boolean) {
  const sz = faint ? 11 : 14;
  const col = faint ? "#c4c9d2" : "#8c919c";
  const tcol = faint ? "#9aa0ab" : "#2f333a";
  const mid = (ax + bx) / 2;
  const half = label.length * sz * 0.32 + 4;
  const tick = (x: number) => L.lines.push({ x1: R(x - 4), y1: R(y + 4), x2: R(x + 4), y2: R(y - 4), stroke: "#8c919c", sw: 1.2, dash: "" });
  L.lines.push({ x1: R(ax), y1: R(y), x2: R(mid - half), y2: R(y), stroke: col, sw: faint ? 0.9 : 1, dash: "" });
  L.lines.push({ x1: R(mid + half), y1: R(y), x2: R(bx), y2: R(y), stroke: col, sw: faint ? 0.9 : 1, dash: "" });
  tick(ax);
  tick(bx);
  L.texts.push({ x: R(mid), y: R(y + sz * 0.35), t: label, fill: tcol, size: sz, weight: 600, anchor: "middle", transform: "" });
}

function dimV(L: L, ay: number, by: number, x: number, label: string) {
  const sz = 14;
  const mid = (ay + by) / 2;
  const half = label.length * sz * 0.32 + 4;
  const tx = x + sz * 0.35;
  const tick = (y: number) => L.lines.push({ x1: R(x - 4), y1: R(y + 4), x2: R(x + 4), y2: R(y - 4), stroke: "#8c919c", sw: 1.2, dash: "" });
  L.lines.push({ x1: R(x), y1: R(ay), x2: R(x), y2: R(mid - half), stroke: "#8c919c", sw: 1, dash: "" });
  L.lines.push({ x1: R(x), y1: R(mid + half), x2: R(x), y2: R(by), stroke: "#8c919c", sw: 1, dash: "" });
  tick(ay);
  tick(by);
  L.texts.push({ x: R(tx), y: R(mid), t: label, fill: "#2f333a", size: sz, weight: 600, anchor: "middle", transform: "rotate(-90 " + R(tx) + " " + R(mid) + ")" });
}

/** center FOH mix position — seats removed mid-house for the front-of-house console */
function mixPos(L: L, cx: number, yc: number, w: number, text = "FOH MIX") {
  const hw = w / 2;
  const hh = 9;
  const d = "M " + R(cx - hw) + " " + R(yc - hh) + " h " + R(w) + " v " + R(hh * 2) + " h " + R(-w) + " Z";
  L.paths.push({ d, fill: "#ffffff", stroke: "none", dash: "" });
  L.paths.push({ d, fill: "none", stroke: "#9aa0ab", sw: 1.2, dash: "4 3" });
  L.texts.push({ x: R(cx), y: R(yc + 3), t: text, fill: "#6b7280", size: 8, weight: 600, anchor: "middle", transform: "" });
}

/* ------------------------------- geometries ------------------------------- */

export type ProsGeom = ReturnType<typeof prosGeom>;

type XY = { x: number; y: number };

const planKindOf = (s: Pick<AState, "venue">): VenueKind => (VENUES.find((v) => v.key === s.venue) || VENUES[0]).kind || "proscenium";

/**
 * The template a plan draws — and its wall handles drag (#255): a known id as
 * named; none, null or an unknown id → the plan kind's default (null only for
 * a kind drawn by its built-in schematic). buildPlan, houseDragPatch and the
 * geometries all resolve through this, so the handles always drag what's drawn.
 */
export const planTemplate = (s: Pick<AState, "venue">, tpl: string | null | undefined): string | null =>
  tpl && templateEntry(tpl) ? tpl : resolveBackground([], null, planKindOf(s));

/** Approximate advance of the plan's 8-px semibold mono label glyphs (px per character). */
export const LABEL_CHAR_PX = 4.9;

/**
 * #255: the FOH mix box inside a booth room (px) — for a booth that moves (the Gym Stage Booth), wherever it
 * sits. The room's own label, the box (18 px tall, no wider than the room less 6 px, never over 86; reading
 * "FOH" when "FOH MIX" won't fit) and — when `consoleOn` — the CONSOLE mark under the box stack centred in
 * the room, the label centred over the box. A room too shallow for that stack (the Booth on the back wall of
 * a wide floor) keeps just the box (and mark), centred, and its label moves just under the room, centred.
 * `label` = the room's label index in `labels` and its new top-left anchor (labels draw their baseline at y + h).
 */
export function boothMix(
  poly: XY[],
  labels: Array<{ text: string; x: number; y: number; h: number }>,
  consoleOn: boolean
): { x: number; y: number; w: number; text: string; label: { i: number; x: number; y: number } | null } {
  const bb = boxOf(poly);
  const i = labels.findIndex((l) => l.x >= bb.x && l.x <= bb.x + bb.w && l.y >= bb.y && l.y <= bb.y + bb.h);
  const lab = i < 0 ? null : labels[i];
  const under = consoleOn ? 16 : 0;
  const w = R(Math.max(0, Math.min(bb.w - 6, 86)));
  const text = w >= 7 * LABEL_CHAR_PX + 4 ? "FOH MIX" : "FOH";
  const x = R(bb.x + bb.w / 2);
  const labX = lab ? R(x - (lab.text.length * LABEL_CHAR_PX) / 2) : 0;
  const stack = (lab ? 11 : 0) + 18 + under; // label (7 px glyphs + 4 px gap), box, console mark
  if (!lab || stack + 6 <= bb.h) {
    const top = bb.y + (bb.h - stack) / 2;
    return { x, y: R(top + (lab ? 11 : 0) + 9), w, text, label: lab ? { i, x: labX, y: R(top + 7 - lab.h) } : null };
  }
  return { x, y: R(Math.max(bb.y + 11, bb.y + (bb.h - under) / 2)), w, text, label: { i, x: labX, y: R(bb.y + bb.h + 10 - lab.h) } };
}

/**
 * Shared proscenium groundplan geometry (#249, #255): a proscenium-family
 * template (Jeff's Auditorium drawing by default) stretched to the room and
 * laid on the 640-px plan canvas, stage at the top. The auto plan, the Grid
 * base sheet, Quick Design's wall drag, starter Spaces and Auto fill all read
 * this, so they always agree.
 */
export function prosGeom(s: AState, tpl?: string | null) {
  const want = planTemplate(s, tpl);
  const id = want && templateEntry(want)?.family === "proscenium" ? want : "proscenium@1";
  const keys = keysById(id);
  const dims = prosceniumDims(s, id);
  const plan = stretchById(id, dims);
  const MT = 52, MB = 44, ML = 58, MR = 138;
  const C = canvasOf(plan, { W: 640, ML, MR, MT, MB });
  const { W, H, ppi, ppf, px, regions } = C;
  const pt = (name: string) => px(plan.points[name]);
  const xProcL = pt("proL").x, xProcR = pt("proR").x, openW = R(xProcR - xProcL);
  const yBack = pt("stageBack").y, yPlaster = pt("centre").y;
  const cx = pt("centre").x;
  const role = (r?: string): Box | null => (r && regions[r] ? boxOf(regions[r]) : null);
  // #255: a booth that moves (the Gym Stage Booth) takes the FOH mix with it (boothMix); otherwise the FOH mix
  // stands at the template's `mix` point in the house.
  const boothPoly = keys.roles.booth && (keys.movables ?? []).some((m) => m.region === keys.roles.booth) ? regions[keys.roles.booth] : undefined;
  const inBooth = boothPoly ? boothMix(boothPoly, C.labels, !!(s.sys && s.sys.controls && s.ctrl && s.ctrl.console)) : null;
  const mix = inBooth ? { x: inBooth.x, y: inBooth.y } : { x: cx, y: pt("mix").y };
  const mixW = inBooth ? inBooth.w : 86;
  const yMix = mix.y;
  const mixBox: Box = { x: R(mix.x - mixW / 2), y: R(yMix - 9), w: mixW, h: 18 };
  const moved = inBooth?.label;
  const labels = moved ? C.labels.map((l, i) => (i === moved.i ? { ...l, x: moved.x, y: moved.y } : l)) : C.labels;
  return {
    template: id, W, H, ML, MR, MT, MB, ppi, ppf, dims, warning: planKindOf(s) === "gym" ? null : houseDims(s, id).warning,
    mix, mixInBooth: !!boothPoly, mixBox, mixText: inBooth?.text ?? "FOH MIX",
    cx, xProcL, xProcR, openW, yBack, yPlaster, yTop: pt("top").y,
    stage: { x: xProcL, y: yBack, w: openW, h: R(yPlaster - yBack) },
    xStageL: pt("stageOuterL").x, xStageR: pt("stageOuterR").x, xWingL: pt("wingL").x, xWingR: pt("wingR").x,
    yBackWall: pt("backWall").y, xHouseL: pt("houseL").x, xHouseR: pt("houseR").x, yMix,
    house: boxOf(regions[keys.roles.house]),
    booth: role(keys.roles.booth) ?? mixBox,
    catwalk: role(keys.roles.catwalk),
    regions, regionLabels: plan.regionLabels, spaces: keys.spaces, roles: keys.roles,
    stageEdge: (plan.lines.stageEdge ?? []).map(px),
    polylines: C.polylines,
    labels,
    handles: { sideL: pt("handleL"), sideR: pt("handleR"), back: pt("backWall") },
    fromPx: C.fromPx,
    plan,
  };
}

export type ChurchGeom = ReturnType<typeof churchGeom>;

/**
 * Shared church groundplan geometry (#255): a church-family template (Jeff's
 * Church Traditional drawing by default) stretched to the platform and nave
 * and laid on the plan canvas, platform at the top. Pews are drawn by code
 * inside the Nave: straight rows every 3' from 6' behind the platform front to
 * 8' short of the back wall, 4' clear of the nave's walls, split by a 5'
 * centre aisle on the template's `aisle` point (the Entry).
 */
export function churchGeom(s: AState, tpl?: string | null) {
  const want = planTemplate(s, tpl);
  const id = want && templateEntry(want)?.family === "church" ? want : "church-traditional@1";
  const keys = keysById(id);
  const dims = churchDims(s, id);
  const plan = stretchById(id, dims);
  const ML = 62, MT = 54;
  const C = canvasOf(plan, { W: 640, ML, MR: 40, MT, MB: 44 });
  const { W, H, ppi, ppf, px, regions } = C;
  const pt = (name: string) => px(plan.points[name]);
  const centre = pt("centre"), aisle = pt("aisle");
  const yFront = centre.y, yBack = pt("platBack").y, yNaveBack = pt("naveBack").y;
  const naveL = pt("naveL"), naveR = pt("naveR");
  // A template with a booth room (Contemporary's Control Booth) puts the FOH mix in it: centred, 45% down its
  // box (above the room's own label, which sits low), clear of its bottom wall with the CONSOLE mark under it,
  // and no wider than the room at the box's top edge. Otherwise the FOH mix box stands at the template's `mix`
  // point in the Nave, and buildPlanChurch knocks it out of the pews (mixPos: w wide, 18 px tall).
  const consoleOn = !!(s.sys && s.sys.controls && s.ctrl && s.ctrl.console);
  const boothPoly = keys.roles.booth ? regions[keys.roles.booth] : undefined;
  const boothRoom = boothPoly ? boxOf(boothPoly) : null;
  const mix = boothRoom
    ? { x: R(boothRoom.x + boothRoom.w / 2), y: R(Math.min(boothRoom.y + boothRoom.h * 0.45, boothRoom.y + boothRoom.h - 12 - (consoleOn ? 16 : 0))) }
    : pt("mix");
  const room = boothPoly ? rowSpans(boothPoly, mix.y - 9).reduce((w, [l, r]) => (l <= mix.x && r >= mix.x ? Math.min(mix.x - l, r - mix.x) * 2 : w), 0) : 0;
  const mixW = boothRoom ? Math.max(0, Math.min(boothRoom.w * 0.45, 86, room - 6)) : Math.min((naveR.x - naveL.x) * 0.3, 86);
  const mixBox: Box = { x: R(mix.x - mixW / 2), y: R(mix.y - 9), w: R(mixW), h: 18 };
  const platform = boxOf(regions[keys.roles.stage]);
  const nave = boxOf(regions[keys.roles.house]);
  const booth = boothRoom ?? mixBox;
  // Auto fill's stage frame: the box under the platform's back wall, as wide as that wall, running down until the
  // Platform stops covering it — Traditional's chancel (its front step is wider), Contemporary's core above the
  // pointed front. Stage-rule devices spread across it never land in a side room.
  const platBackL = pt("platBackL"), platBackR = pt("platBackR");
  const covers = (y: number) => rowSpans(regions[keys.roles.stage], y).some(([l, r]) => l <= platBackL.x + 0.5 && r >= platBackR.x - 0.5);
  let yStage = yBack;
  for (let y = yBack + 0.5; y <= yFront - 0.5 && covers(y); y += 0.5) yStage = y;
  if (yStage >= yFront - 1) yStage = yFront;
  const stageBox: Box = { x: platBackL.x, y: yBack, w: platBackR.x - platBackL.x, h: yStage - yBack };
  // Where the loudspeakers stand, when the template says (else buildPlanChurch's Traditional notch rule).
  const speakers = keys.points.spkL && keys.points.spkR ? [pt("spkL"), pt("spkR")] : null;
  const pews: Array<{ x1: number; x2: number; y: number }> = [];
  const half = 2.5 * ppf;
  // The aisle-side ends round away from the aisle, so a 0.1-px rounding never narrows it.
  const down = (n: number) => Math.floor(n * 10 + 1e-9) / 10, up = (n: number) => Math.ceil(n * 10 - 1e-9) / 10;
  // Pews paint after the mix box's white knock-out, so a row crossing it stops 2 px short of each side — and,
  // when the CONSOLE mark is drawn under the booth (buildPlanChurch: 3–14 px below it), short of that too.
  const gap = 2, mixL = R(mixBox.x - gap), mixR = R(mixBox.x + mixBox.w + gap);
  const consoleMark = consoleOn && booth === mixBox;
  const clipBot = mixBox.y + mixBox.h + (consoleMark ? 16 : gap);
  const push = (x1: number, x2: number, y: number) => {
    const yy = R(y);
    const spans: Array<[number, number]> = yy >= mixBox.y - gap && yy <= clipBot && x1 < mixR && x2 > mixL ? [[x1, Math.min(x2, mixL)], [Math.max(x1, mixR), x2]] : [[x1, x2]];
    for (const [a, b] of spans) if (b - a > ppf) pews.push({ x1: a, x2: b, y: yy });
  };
  for (let y = yFront + 6 * ppf; y <= yNaveBack - 8 * ppf + 1e-6; y += 3 * ppf) {
    for (const [a, b] of rowSpans(regions[keys.roles.house], y)) {
      const l = a + 4 * ppf, r = b - 4 * ppf;
      if (Math.min(r, aisle.x - half) - l > ppf) push(R(l), down(Math.min(r, aisle.x - half)), y);
      if (r - Math.max(l, aisle.x + half) > ppf) push(up(Math.max(l, aisle.x + half)), R(r), y);
    }
  }
  return {
    template: id, W, H, ppi, ppf, dims, warning: houseDims(s, id).warning,
    cx: centre.x, yTop: MT, yBack, yFront, yNaveBack, xMin: ML,
    platBackL, platBackR, platFrontL: pt("platFrontL"), platFrontR: pt("platFrontR"),
    naveL, naveR, mix, mixBox, aisle, speakers,
    platform, nave, booth, stage: platform, stageBox, pews,
    regions, regionLabels: plan.regionLabels, spaces: keys.spaces, roles: keys.roles,
    polylines: C.polylines, labels: C.labels,
    handles: { sideL: pt("handleL"), sideR: pt("handleR"), back: pt("handleBack") },
    fromPx: C.fromPx,
    plan,
  };
}

/* -------------------------------- builders -------------------------------- */

function buildPlanProscenium(s: AState, lineSets: number, electrics: number, _accent: string, tpl?: string | null): PlanData {
  void _accent; // proscenium symbols draw in system colors; the accent styles only the handles (rendered by <PlanSvg>)
  const G = prosGeom(s, tpl);
  const { W, H, ML, cx, yTop, yBack, yPlaster, xProcL, xProcR, openW, xStageL, xStageR, xWingL, xWingR, yBackWall, xHouseL, xHouseR, ppf, dims } = G;
  const wing = dims.wingFt;
  const rects: Rect[] = [], lines: LineEl[] = [], circles: CircleEl[] = [], texts: TextEl[] = [], paths: PathEl[] = [];
  const handles: PlanHandle[] = [];
  // #255: a gym-kind design's width / depth are the floor; the stage's own sizes come from the drawing's proportions.
  const gymKind = planKindOf(s) === "gym";
  const ftIn = (ft: number) => {
    const inch = Math.round(ft * 12);
    return Math.floor(inch / 12) + "'-" + (inch % 12) + '"';
  };
  const openLabel = gymKind ? ftIn(dims.proWidthFt) : s.width + "'-0\"";
  const wingLabel = gymKind ? ftIn(wing) : wing + "'";
  const depthLabel = gymKind ? ftIn(dims.stageDepthFt) : s.depth + "'-0\"";
  const depthPx = yPlaster - yBack;
  const yAt = (frac: number) => R(yBack + frac * depthPx);
  const tick = (x: number, y: number) => lines.push({ x1: R(x - 4), y1: R(y + 4), x2: R(x + 4), y2: R(y - 4), stroke: "#8c919c", sw: 1.2, dash: "" });
  const trace = (pts: XY[]) => pts.map((p, i) => (i ? "L " : "M ") + p.x + " " + p.y).join(" ");

  // floors, the playing area, then the room itself — Jeff's template drawing, stretched (#249)
  paths.push({ d: trace(G.regions[G.roles.stage]) + " Z", fill: "#f6f7f9", stroke: "none" });
  paths.push({ d: trace(G.regions[G.roles.house]) + " Z", fill: "#f9fafb", stroke: "none" });
  paths.push({ d: "M " + R(xProcL) + " " + R(yBack) + " H " + R(xProcR) + " V " + R(yPlaster) + " H " + R(xProcL) + " Z", fill: "#ffffff", stroke: "#e3e5ea", sw: 1 });
  paths.push({ d: G.polylines.map(trace).join(" "), fill: "none", stroke: "#3a3f4a", sw: 0.9 });
  for (const l of G.labels) texts.push({ x: l.x, y: R(l.y + l.h), t: l.text, fill: "#737985", size: 8, weight: 600, anchor: "start", transform: "" }); // baseline sits on the drawing's own text baseline, so glyphs grow upward and stay clear of the wall Jeff drew them against

  // faded unrigged line sets (background grid)
  const n = Math.max(lineSets, 1);
  for (let i = 0; i < n; i++) {
    const y = yAt((i + 0.5) / n);
    lines.push({ x1: R(xProcL), y1: y, x2: R(xProcR), y2: y, stroke: "#e6e8ec", sw: 0.8, dash: "" });
  }

  // rigged elements (highlighted + labeled)
  const rigged: Array<{ frac: number; label: string; kind: string }> = [];
  const drape = s.drape || {};
  if (s.sys.curtains) {
    if (drape.draw) rigged.push({ frac: 0.95, label: "Grand drape", kind: "drape" });
    if (drape.fullstage) rigged.push({ frac: 0.5, label: "Mid traveler", kind: "drape" });
    if (drape.border) [0.74, 0.48, 0.22].forEach((f, i) => rigged.push({ frac: f, label: "Border " + (i + 1), kind: "border" }));
    if (drape.scenerytrack) rigged.push({ frac: 0.05, label: "Cyc / scenery", kind: "drape" });
    if (drape.legs) {
      const legW = Math.min(wing * ppf * 0.7, 30) || 20;
      [0.74, 0.48, 0.22].forEach((f) => {
        const y = yAt(f);
        lines.push({ x1: R(xProcL), y1: y, x2: R(xProcL - legW), y2: y, stroke: SYSCOLOR.curtains, sw: 3, dash: "" });
        lines.push({ x1: R(xProcR), y1: y, x2: R(xProcR + legW), y2: y, stroke: SYSCOLOR.curtains, sw: 3, dash: "" });
      });
    }
  }
  const ord = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
  if (s.sys.lighting && electrics > 0)
    for (let j = 0; j < electrics; j++) rigged.push({ frac: (electrics - j) / (electrics + 1), label: (ord[j] || j + 1 + "th") + " electric", kind: "electric" });

  rigged.sort((a, b) => a.frac - b.frac);
  // Right of everything drawn beside the stage (the Auditorium's stage wall; the Gym Stage's Electrical Room).
  const xRight = G.polylines.flat().reduce((m, p) => (p.y >= yTop - 0.5 && p.y <= yPlaster + 0.5 && p.x > m ? p.x : m), xStageR);
  const labelX = xRight + 12;
  let lastLy = -99;
  rigged.forEach((it) => {
    const y = yAt(it.frac);
    const cCurt = SYSCOLOR.curtains, cLight = SYSCOLOR.lighting;
    if (it.kind === "border") {
      lines.push({ x1: R(xProcL), y1: y, x2: R(xProcR), y2: y, stroke: cCurt, sw: 1.6, dash: "5 4" });
    } else if (it.kind === "electric") {
      lines.push({ x1: R(xProcL), y1: y, x2: R(xProcR), y2: y, stroke: "#9aa0ab", sw: 1, dash: "2 3" });
      const dn = Math.max(3, Math.round(openW / 42));
      for (let k = 0; k < dn; k++) circles.push({ cx: R(xProcL + ((k + 0.5) / dn) * openW), cy: y, r: 2.6, fill: cLight });
    } else {
      lines.push({ x1: R(xProcL), y1: y, x2: R(xProcR), y2: y, stroke: cCurt, sw: it.frac > 0.9 ? 3 : 2.6, dash: "" });
    }
    const ly = y < lastLy + 11 ? lastLy + 11 : y;
    lastLy = ly;
    lines.push({ x1: R(xProcR), y1: y, x2: R(xRight + 6), y2: R(ly), stroke: "#d0d3da", sw: 0.8, dash: "" });
    texts.push({ x: R(labelX), y: R(ly + 3), t: it.label, fill: it.kind === "electric" ? cLight : cCurt, size: 8, anchor: "start", transform: "" });
  });

  // reference lines: plaster line across the opening, the opening's edges, the centreline
  lines.push({ x1: R(xProcL), y1: R(yPlaster), x2: R(xProcR), y2: R(yPlaster), stroke: "#8c919c", sw: 1, dash: "2 3" });
  lines.push({ x1: R(xProcL), y1: R(yBack), x2: R(xProcL), y2: R(yPlaster), stroke: "#c4c9d2", sw: 1, dash: "4 4" });
  lines.push({ x1: R(xProcR), y1: R(yBack), x2: R(xProcR), y2: R(yPlaster), stroke: "#c4c9d2", sw: 1, dash: "4 4" });
  lines.push({ x1: R(cx), y1: R(yBack), x2: R(cx), y2: R(yBackWall), stroke: "#c4c9d2", sw: 1, dash: "3 4" });

  const L: L = { rects, lines, circles, texts, paths };
  mixPos(L, G.mix.x, G.yMix, G.mixInBooth ? G.mixBox.w : Math.min(openW * 0.3, 86), G.mixText);
  if (s.sys && s.sys.controls && s.ctrl && s.ctrl.console && G.mixInBooth) {
    // #255: under the FOH mix box, in the booth that carries it.
    const bx = G.mixBox, cw = Math.min(R(bx.w * 0.38), 30), bcx = bx.x + bx.w / 2;
    rects.push({ x: R(bcx - cw / 2), y: R(bx.y + bx.h + 3), w: cw, h: 4.5, fill: SYSCOLOR.controls, stroke: "none", sw: 0, rx: 1.5, dash: "" });
    texts.push({ x: R(bcx), y: R(bx.y + bx.h + 14), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
  } else if (s.sys && s.sys.controls && s.ctrl && s.ctrl.console) {
    const bx = G.booth, cw = Math.min(R(bx.w * 0.38), 30), bcx = bx.x + bx.w / 2;
    rects.push({ x: R(bcx - cw / 2), y: R(bx.y + 6), w: cw, h: 4.5, fill: SYSCOLOR.controls, stroke: "none", sw: 0, rx: 1.5, dash: "" });
    texts.push({ x: R(bcx), y: R(bx.y + bx.h - 6), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
  }

  // #249: drag handles — each side wall sets house width, the back wall house depth
  handles.push({ type: "wall", side: "L", cx: G.handles.sideL.x, cy: G.handles.sideL.y, shape: "wall" });
  handles.push({ type: "wall", side: "R", cx: G.handles.sideR.x, cy: G.handles.sideR.y, shape: "wall" });
  handles.push({ type: "wall", side: "B", cx: G.handles.back.x, cy: G.handles.back.y, shape: "backWall" });

  // dimension lines — proscenium width + wings (top)
  const yWid = yTop - 26;
  lines.push({ x1: R(xProcL), y1: R(yBack - 4), x2: R(xProcL), y2: R(yWid - 3), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xProcR), y1: R(yBack - 4), x2: R(xProcR), y2: R(yWid - 3), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xProcL), y1: R(yWid), x2: R(xProcR), y2: R(yWid), stroke: "#8c919c", sw: 1, dash: "" });
  tick(xProcL, yWid);
  tick(xProcR, yWid);
  texts.push({ x: R(cx), y: R(yWid - 6), t: openLabel, fill: "#8c919c", size: 11, anchor: "middle", transform: "" });
  if (wing > 0) {
    ([[xWingL, xProcL], [xProcR, xWingR]] as Array<[number, number]>).forEach(([a, b]) => {
      lines.push({ x1: R(a), y1: R(yWid), x2: R(b), y2: R(yWid), stroke: "#c4c9d2", sw: 0.9, dash: "" });
      tick(a, yWid);
      tick(b, yWid);
      texts.push({ x: R((a + b) / 2), y: R(yWid - 6), t: wingLabel, fill: "#8c919c", size: 11, anchor: "middle", transform: "" });
    });
  }
  // dimension lines — stage depth, then house depth (left, one chain)
  const xDep = ML - 30;
  const vDim = (ya: number, yb: number, label: string) => {
    lines.push({ x1: R(xDep), y1: R(ya), x2: R(xDep), y2: R(yb), stroke: "#8c919c", sw: 1, dash: "" });
    tick(xDep, ya);
    tick(xDep, yb);
    const ym = (ya + yb) / 2;
    texts.push({ x: R(xDep - 7), y: R(ym), t: label, fill: "#8c919c", size: 11, anchor: "middle", transform: "rotate(-90 " + R(xDep - 7) + " " + R(ym) + ")" });
  };
  lines.push({ x1: R(xStageL - 4), y1: R(yBack), x2: R(xDep - 3), y2: R(yBack), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xStageL - 4), y1: R(yPlaster), x2: R(xDep - 3), y2: R(yPlaster), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xHouseL - 4), y1: R(yBackWall), x2: R(xDep - 3), y2: R(yBackWall), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  vDim(yBack, yPlaster, depthLabel);
  vDim(yPlaster, yBackWall, Math.round(dims.houseDepthFt) + "'-0\"");
  // dimension line — house width (bottom)
  const yHW = H - 18;
  lines.push({ x1: R(xHouseL), y1: R(yHW), x2: R(xHouseR), y2: R(yHW), stroke: "#8c919c", sw: 1, dash: "" });
  tick(xHouseL, yHW);
  tick(xHouseR, yHW);
  texts.push({ x: R((xHouseL + xHouseR) / 2), y: R(yHW - 6), t: Math.round(dims.houseWidthFt) + "'-0\"", fill: "#8c919c", size: 11, anchor: "middle", transform: "" });

  texts.push({ x: R(cx), y: R(yPlaster - 6), t: "PLASTER LINE", fill: "#8c919c", size: 8, anchor: "middle", transform: "" });

  return { W, H, rects, lines, circles, texts, paths, handles };
}

/** Conference center — rectangular room, low platform at the front, seating grid facing it. */
function buildPlanFlat(s: AState, _lineSets: number, _electrics: number, accent: string): PlanData {
  const Wpx = 640, ML = 62, MR = 40, MT = 54;
  const ppf = (Wpx - ML - MR) / Math.max(s.width, 1);
  const depthPx = Math.max(180, Math.min(s.depth * ppf, 420));
  const x0 = ML, x1 = Wpx - MR, y0 = MT, y1 = y0 + depthPx, cx = (x0 + x1) / 2;
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  L.rects.push({ x: R(x0), y: R(y0), w: R(x1 - x0), h: R(depthPx), fill: "#f6f7f9", stroke: "#16181d", sw: 2, rx: 2, dash: "" });
  const platW = (x1 - x0) * 0.62, platH = Math.min(Math.max(s.depth * 0.16, 6) * ppf, depthPx * 0.3);
  const px0 = cx - platW / 2, px1 = cx + platW / 2, pBot = y0 + platH;
  L.rects.push({ x: R(px0), y: R(y0), w: R(platW), h: R(platH), fill: "#ffffff", stroke: accent, sw: 1.6, rx: 2, dash: "" });
  L.texts.push({ x: R(cx), y: R(y0 + platH / 2 + 3), t: "PLATFORM", fill: "#9aa0ab", size: 8, anchor: "middle", transform: "" });
  if (s.sys.video) {
    L.lines.push({ x1: R(cx - platW * 0.32), y1: R(y0 + 4), x2: R(cx + platW * 0.32), y2: R(y0 + 4), stroke: SYSCOLOR.video, sw: 3.4, dash: "" });
    L.texts.push({ x: R(cx), y: R(y0 + 15), t: "SCREEN", fill: SYSCOLOR.video, size: 7.5, anchor: "middle", transform: "" });
  }
  if (s.sys.audio) [px0 - 10, px1 + 10].forEach((x) => L.rects.push({ x: R(x - 5), y: R(y0 + 6), w: 10, h: 14, fill: "#eef0f3", stroke: "#3155a8", sw: 1.2, rx: 2, dash: "" }));
  if (s.sys.lighting) {
    const yBar = pBot + 22, dn = Math.max(4, Math.round(platW / 34));
    L.lines.push({ x1: R(px0), y1: R(yBar), x2: R(px1), y2: R(yBar), stroke: "#9aa0ab", sw: 1, dash: "2 3" });
    for (let k = 0; k < dn; k++) L.circles.push({ cx: R(px0 + ((k + 0.5) / dn) * platW), cy: R(yBar), r: 2.6, fill: SYSCOLOR.lighting });
    L.texts.push({ x: R(px1 + 6), y: R(yBar + 3), t: "FOH", fill: "#8c919c", size: 7.5, anchor: "start", transform: "" });
  }
  const seatTop = pBot + (s.sys.lighting ? 40 : 28), seatBot = y1 - 16;
  const rows = Math.max(3, Math.min(8, Math.round((seatBot - seatTop) / 15)));
  const cols = Math.max(6, Math.min(16, Math.round((x1 - x0) / 30)));
  const aisle = Math.floor(cols / 2);
  const gx = (x1 - x0 - 24) / cols, gy = (seatBot - seatTop) / Math.max(rows - 1, 1);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c === aisle) continue;
      const sx = x0 + 12 + (c + 0.5) * gx, sy = seatTop + r * gy;
      L.rects.push({ x: R(sx - 3.4), y: R(sy - 3), w: 6.8, h: 6, fill: "#e6e8ec", stroke: "#cdd1d9", sw: 0.6, rx: 1.5, dash: "" });
    }
  L.texts.push({ x: R(cx), y: R(seatBot + 12), t: "SEATING", fill: "#c4c9d2", size: 8, anchor: "middle", transform: "" });
  dimH(L, x0, x1, y0 - 26, s.width + "'-0\"", false);
  dimV(L, y0, y1, x0 - 32, s.depth + "'-0\"");
  return { W: Wpx, H: R(seatBot + 30), ...L };
}

/** Church — Jeff's template (#255): the drawing, the platform's systems, pews in the Nave, FOH mix, dimension chains. */
function buildPlanChurch(s: AState, _lineSets: number, _electrics: number, accent: string, tpl?: string | null): PlanData {
  const G = churchGeom(s, tpl);
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  const handles: PlanHandle[] = [];
  const trace = (pts: XY[]) => pts.map((p, i) => (i ? "L " : "M ") + p.x + " " + p.y).join(" ");
  L.paths.push({ d: trace(G.regions[G.roles.house]) + " Z", fill: "#f6f7f9", stroke: "none" });
  L.paths.push({ d: trace(G.regions[G.roles.stage]) + " Z", fill: "#ffffff", stroke: accent, sw: 1.6 });
  L.paths.push({ d: G.polylines.map(trace).join(" "), fill: "none", stroke: "#3a3f4a", sw: 0.9 });
  for (const l of G.labels) L.texts.push({ x: l.x, y: R(l.y + l.h), t: l.text, fill: "#737985", size: 8, weight: 600, anchor: "start", transform: "" });

  const platW = G.platBackR.x - G.platBackL.x;
  const depthPx = G.yFront - G.yBack;
  if (s.sys.curtains) L.lines.push({ x1: R(G.platBackL.x + 4), y1: R(G.yBack + 4), x2: R(G.platBackR.x - 4), y2: R(G.yBack + 4), stroke: SYSCOLOR.curtains, sw: 2.6, dash: "4 3" });
  if (s.sys.video) [G.cx - platW * 0.23, G.cx + platW * 0.23].forEach((x) => L.lines.push({ x1: R(x - 13), y1: R(G.yBack + 11), x2: R(x + 13), y2: R(G.yBack + 11), stroke: SYSCOLOR.video, sw: 3, dash: "" }));
  if (s.sys.lighting)
    [0.42, 0.8].forEach((f) => {
      const y = G.yBack + depthPx * f;
      for (const [a, b] of rowSpans(G.regions[G.roles.stage], y)) {
        const x1 = a + 6, x2 = b - 6, dn = Math.max(3, Math.round((x2 - x1) / 34));
        L.lines.push({ x1: R(x1), y1: R(y), x2: R(x2), y2: R(y), stroke: "#9aa0ab", sw: 1, dash: "2 3" });
        for (let k = 0; k < dn; k++) L.circles.push({ cx: R(x1 + ((k + 0.5) / dn) * (x2 - x1)), cy: R(y), r: 2.4, fill: SYSCOLOR.lighting });
      }
    });
  // Marks over the Nave's fill are paths, not rects: rects paint before paths, i.e. under the fill.
  const box = (x: number, y: number, w: number, h: number) => "M " + R(x) + " " + R(y) + " h " + w + " v " + h + " h " + -w + " Z";
  // …with the rect's rx: 2 corners, as arcs.
  const rbox = (x: number, y: number, w: number, h: number, r: number) =>
    "M " + R(x + r) + " " + R(y) + " h " + (w - 2 * r) + " a " + r + " " + r + " 0 0 1 " + r + " " + r + " v " + (h - 2 * r) + " a " + r + " " + r + " 0 0 1 " + -r + " " + r +
    " h " + -(w - 2 * r) + " a " + r + " " + r + " 0 0 1 " + -r + " " + -r + " v " + -(h - 2 * r) + " a " + r + " " + r + " 0 0 1 " + r + " " + -r + " Z";
  // Loudspeakers stand in the Nave beside the platform: centred on the template's spkL / spkR points, else (Traditional)
  // centred in the platform step's 4' notch, 2' upstage of the front edge.
  const spk = G.speakers ?? [G.platFrontL, G.platFrontR].map((p, i) => ({ x: p.x + (i ? 13 : -13), y: p.y - 2 * G.ppf }));
  if (s.sys.audio) spk.forEach((p) => L.paths.push({ d: rbox(p.x - 5, p.y - 7, 10, 14, 2), fill: "#eef0f3", stroke: "#3155a8", sw: 1.2 }));
  for (const p of G.pews) L.lines.push({ x1: p.x1, y1: p.y, x2: p.x2, y2: p.y, stroke: "#cdd1d9", sw: 1.4, dash: "" });
  mixPos(L, G.mix.x, G.mix.y, G.mixBox.w);
  if (s.sys && s.sys.controls && s.ctrl && s.ctrl.console) {
    // Under the FOH mix box — in the Nave, or in the booth room when the template has one.
    const bx = G.mixBox, cw = Math.min(R(bx.w * 0.38), 30), bcx = bx.x + bx.w / 2;
    L.paths.push({ d: box(bcx - cw / 2, bx.y + bx.h + 3, cw, 4.5), fill: SYSCOLOR.controls, stroke: "none" });
    L.texts.push({ x: R(bcx), y: R(bx.y + bx.h + 14), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
  }
  // #255: drag handles — each side wall sets nave width, the back wall nave depth
  handles.push({ type: "wall", side: "L", cx: G.handles.sideL.x, cy: G.handles.sideL.y, shape: "wall" });
  handles.push({ type: "wall", side: "R", cx: G.handles.sideR.x, cy: G.handles.sideR.y, shape: "wall" });
  handles.push({ type: "wall", side: "B", cx: G.handles.back.x, cy: G.handles.back.y, shape: "backWall" });
  dimH(L, G.platBackL.x, G.platBackR.x, G.yTop - 26, s.width + "'-0\"", false);
  dimV(L, G.yBack, G.yFront, G.xMin - 32, s.depth + "'-0\"");
  dimV(L, G.yFront, G.yNaveBack, G.xMin - 32, Math.round(G.dims.houseDepthFt) + "'-0\"");
  dimH(L, G.naveL.x, G.naveR.x, G.H - 18, Math.round(G.dims.houseWidthFt) + "'-0\"", false);
  return { W: G.W, H: G.H, ...L, handles };
}

/** Black box — open square room, tension grid, perimeter masking, riser blocks. */
function buildPlanBlackbox(s: AState, _lineSets: number, _electrics: number, accent: string): PlanData {
  const Wpx = 640, ML = 62, MR = 40, MT = 54;
  const ppf = (Wpx - ML - MR) / Math.max(s.width, 1);
  const depthPx = Math.max(180, Math.min(s.depth * ppf, 420));
  const x0 = ML, x1 = Wpx - MR, y0 = MT, y1 = y0 + depthPx, cx = (x0 + x1) / 2;
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  L.rects.push({ x: R(x0), y: R(y0), w: R(x1 - x0), h: R(depthPx), fill: "#f6f7f9", stroke: "#16181d", sw: 2, rx: 2, dash: "" });
  const stepPx = Math.max(18, 8 * ppf);
  for (let x = x0 + stepPx; x < x1 - 2; x += stepPx) L.lines.push({ x1: R(x), y1: R(y0), x2: R(x), y2: R(y1), stroke: "#eceef1", sw: 0.8, dash: "" });
  for (let y = y0 + stepPx; y < y1 - 2; y += stepPx) L.lines.push({ x1: R(x0), y1: R(y), x2: R(x1), y2: R(y), stroke: "#eceef1", sw: 0.8, dash: "" });
  L.texts.push({ x: R(x1 - 6), y: R(y0 + 13), t: "TENSION GRID", fill: "#c4c9d2", size: 7.5, anchor: "end", transform: "" });
  if (s.sys.curtains) L.rects.push({ x: R(x0 + 10), y: R(y0 + 10), w: R(x1 - x0 - 20), h: R(depthPx - 20), fill: "none", stroke: SYSCOLOR.curtains, sw: 1.6, rx: 1, dash: "5 4" });
  const bW = (x1 - x0) * 0.5, bH = depthPx * 0.26, bx0 = cx - bW / 2, by0 = y0 + depthPx * 0.15, cellW = bW / 4, cellH = bH / 2;
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++)
      L.rects.push({ x: R(bx0 + c * cellW + 1), y: R(by0 + r * cellH + 1), w: R(cellW - 2), h: R(cellH - 2), fill: "#ffffff", stroke: accent, sw: 1.2, rx: 2, dash: "" });
  L.texts.push({ x: R(cx), y: R(by0 + bH / 2 + 3), t: "RISER BLOCKS", fill: "#9aa0ab", size: 8, anchor: "middle", transform: "" });
  if (s.sys.lighting)
    [0.6, 0.8].forEach((f) => {
      const y = y0 + depthPx * f, dn = Math.max(4, Math.round((x1 - x0) / 36));
      L.lines.push({ x1: R(x0 + 16), y1: R(y), x2: R(x1 - 16), y2: R(y), stroke: "#9aa0ab", sw: 1, dash: "2 3" });
      for (let k = 0; k < dn; k++) L.circles.push({ cx: R(x0 + 16 + ((k + 0.5) / dn) * (x1 - x0 - 32)), cy: R(y), r: 2.4, fill: SYSCOLOR.lighting });
    });
  const seatTop = by0 + bH + 30, seatBot = y1 - 18;
  if (seatBot > seatTop + 8) {
    const rows = Math.max(2, Math.min(5, Math.round((seatBot - seatTop) / 15)));
    const cols = Math.max(6, Math.min(14, Math.round((x1 - x0) / 32)));
    const gx = (x1 - x0 - 32) / cols, gy = (seatBot - seatTop) / Math.max(rows - 1, 1);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const sx = x0 + 16 + (c + 0.5) * gx, sy = seatTop + r * gy;
        L.rects.push({ x: R(sx - 3.2), y: R(sy - 3), w: 6.4, h: 6, fill: "#e6e8ec", stroke: "#cdd1d9", sw: 0.6, rx: 1.5, dash: "" });
      }
  }
  dimH(L, x0, x1, y0 - 26, s.width + "'-0\"", false);
  dimV(L, y0, y1, x0 - 32, s.depth + "'-0\"");
  return { W: Wpx, H: R(y1 + 28), ...L };
}

/** Arena — large open floor, end-stage platform, concentric bowl-seating arcs. */
function buildPlanArena(s: AState, _lineSets: number, _electrics: number, accent: string): PlanData {
  const Wpx = 640, ML = 56, MR = 56, MT = 54;
  const ppf = (Wpx - ML - MR) / Math.max(s.width, 1);
  const depthPx = Math.max(200, Math.min(s.depth * ppf, 440));
  const x0 = ML, x1 = Wpx - MR, y0 = MT, y1 = y0 + depthPx, cx = (x0 + x1) / 2;
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  L.rects.push({ x: R(x0), y: R(y0), w: R(x1 - x0), h: R(depthPx), fill: "#f6f7f9", stroke: "#16181d", sw: 2, rx: 2, dash: "" });
  const platW = (x1 - x0) * 0.5, platH = depthPx * 0.17, px0 = cx - platW / 2;
  L.rects.push({ x: R(px0), y: R(y0 + 6), w: R(platW), h: R(platH), fill: "#ffffff", stroke: accent, sw: 1.6, rx: 2, dash: "" });
  L.texts.push({ x: R(cx), y: R(y0 + 6 + platH / 2 + 3), t: "STAGE", fill: "#9aa0ab", size: 8, anchor: "middle", transform: "" });
  const rn = Math.max(4, Math.round(platW / 30));
  for (let k = 0; k < rn; k++) L.circles.push({ cx: R(px0 + ((k + 0.5) / rn) * platW), cy: R(y0 + 6 + platH + 8), r: 2.4, fill: SYSCOLOR.rigging });
  if (s.sys.audio)
    [px0 - 14, px0 + platW + 14].forEach((x) => {
      for (let i = 0; i < 3; i++) L.rects.push({ x: R(x - 4), y: R(y0 + 10 + i * 9), w: 8, h: 7, fill: "#eef0f3", stroke: "#3155a8", sw: 1, rx: 1, dash: "" });
    });
  const arcTop = y0 + 6 + platH + 26, arcBot = y1 - 14;
  const arcs = Math.max(4, Math.min(9, Math.round((arcBot - arcTop) / 16)));
  for (let r = 0; r < arcs; r++) {
    const yy = arcTop + (r * (arcBot - arcTop)) / Math.max(arcs - 1, 1), half = (x1 - x0) * 0.5 * (0.46 + r * 0.07);
    L.paths.push({ d: "M " + R(cx - half) + " " + R(yy) + " Q " + R(cx) + " " + R(yy + 12) + " " + R(cx + half) + " " + R(yy), fill: "none", stroke: "#d0d3da", sw: 1.3, dash: "" });
  }
  L.texts.push({ x: R(cx), y: R(arcBot + 12), t: "BOWL SEATING", fill: "#c4c9d2", size: 8, anchor: "middle", transform: "" });
  dimH(L, x0, x1, y0 - 26, s.width + "'-0\"", false);
  dimV(L, y0, y1, x0 - 30, s.depth + "'-0\"");
  return { W: Wpx, H: R(y1 + 26), ...L };
}

/* ------------------------------ legend builder ------------------------------ */

function sw(kind: string, accent: string): React.CSSProperties {
  switch (kind) {
    case "line":
      return { display: "inline-block", width: 14, height: 2.6, borderRadius: 2, background: accent };
    case "dash":
      return { display: "inline-block", width: 14, height: 0, borderTop: `1.6px dashed ${accent}` };
    case "dot":
      return { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: accent };
    case "faint":
      return { display: "inline-block", width: 14, height: 1.4, background: "#cdd1d9" };
    case "box":
      return { display: "inline-block", width: 12, height: 8, border: "1px solid #c4c9d2", borderRadius: 2, background: "#fff" };
    case "seat":
      return { display: "inline-block", width: 8, height: 7, border: "1px solid #cdd1d9", borderRadius: 2, background: "#e6e8ec" };
    case "spk":
      return { display: "inline-block", width: 8, height: 10, border: "1px solid #3155a8", borderRadius: 2, background: "#eef0f3" };
    default:
      return { display: "inline-block", width: 10, height: 10, background: accent };
  }
}

/** legend entries matching the symbols actually drawn for each venue kind */
function legendFor(kind: VenueKind, s: AState, electrics: number, accent: string): Array<{ sw: React.CSSProperties; label: string }> {
  const C = SYSCOLOR;
  const mk = (k: string, col?: string) => sw(k, col || accent);
  const it: Array<{ sw: React.CSSProperties; label: string }> = [];
  const sys = s.sys;
  if (kind === "proscenium") {
    if (sys.curtains) {
      it.push({ sw: mk("line", C.curtains), label: "Drape / curtain" }, { sw: mk("dash", C.curtains), label: "Border" });
    }
    it.push({ sw: mk("faint"), label: "Line set" });
    if (sys.lighting && electrics > 0) it.push({ sw: mk("dot", C.lighting), label: "Powered electric" });
    if (sys.pit) it.push({ sw: mk("box"), label: "Orchestra pit" });
  } else if (kind === "church") {
    it.push({ sw: mk("box"), label: "Platform" });
    if (sys.curtains) it.push({ sw: mk("dash", C.curtains), label: "Backdrop curtain" });
    if (sys.lighting) it.push({ sw: mk("dot", C.lighting), label: "Lighting position" });
    if (sys.video) it.push({ sw: mk("line", C.video), label: "Screen" });
    it.push({ sw: mk("faint"), label: "Pews" });
  } else if (kind === "flat") {
    it.push({ sw: mk("box"), label: "Platform" });
    if (sys.video) it.push({ sw: mk("line", C.video), label: "Screen" });
    if (sys.lighting) it.push({ sw: mk("dot", C.lighting), label: "FOH lighting" });
    if (sys.audio) it.push({ sw: mk("spk"), label: "Loudspeaker" });
    it.push({ sw: mk("seat"), label: "Seating" });
  } else if (kind === "blackbox") {
    it.push({ sw: mk("faint"), label: "Tension grid" });
    if (sys.curtains) it.push({ sw: mk("dash", C.curtains), label: "Perimeter masking" });
    it.push({ sw: mk("box"), label: "Riser blocks" });
    if (sys.lighting) it.push({ sw: mk("dot", C.lighting), label: "Lighting position" });
    it.push({ sw: mk("seat"), label: "Movable seating" });
  } else if (kind === "arena") {
    it.push({ sw: mk("box"), label: "End stage" });
    it.push({ sw: mk("dot", C.rigging), label: "Rigging point" });
    if (sys.audio) it.push({ sw: mk("spk"), label: "Line array" });
    it.push({ sw: mk("faint"), label: "Bowl seating" });
  }
  return it;
}

/* ------------------------------- entry point ------------------------------- */

export function buildPlan(s: AState, lineSets: number, electrics: number, accent: string, tpl?: string | null): PlanData {
  const kind = planKindOf(s);
  // Proscenium and church kinds always resolve a template (planTemplate), so every kind below draws its built-in schematic.
  const id = planTemplate(s, tpl);
  const family = templateEntry(id)?.family;
  let p: PlanData;
  if (family === "church") p = buildPlanChurch(s, lineSets, electrics, accent, id);
  else if (family === "proscenium") p = buildPlanProscenium(s, lineSets, electrics, accent, id);
  else if (kind === "flat") p = buildPlanFlat(s, lineSets, electrics, accent);
  else if (kind === "blackbox") p = buildPlanBlackbox(s, lineSets, electrics, accent);
  else p = buildPlanArena(s, lineSets, electrics, accent);
  // #255: a template plan's legend is its family's (Quick Design's Gym Stage draws the proscenium-family gym drawing).
  p.legend = legendFor(family === "proscenium" ? "proscenium" : kind, s, electrics, accent);
  p.isHouse = family === "proscenium" || family === "church";
  p.canSlideWalls = p.isHouse;
  return p;
}

/* --------------------------------- render --------------------------------- */

const MONO = "var(--font-mono), IBM Plex Mono, monospace";
/** `renderPlanSvgMarkup`'s own font stack (Grid base sheet, Task 1, #38) —
 *  `var(--font-mono)` above resolves against the APP's own document, which
 *  an <img src="data:image/svg+xml…"> never joins (a data-URL image paints
 *  in its own isolated context with no access to the host page's CSS custom
 *  properties), so the static markup falls straight back to the named font. */
const STATIC_MONO = "IBM Plex Mono, monospace";

export function PlanSvg({
  plan,
  accent,
  interactive = false,
  onHandleDown,
  svgId,
}: {
  plan: PlanData;
  accent: string;
  /** render + wire the wall handles (Quick Design auto plan) */
  interactive?: boolean;
  onHandleDown?: (h: PlanHandle, e: React.PointerEvent<SVGGElement>) => void;
  svgId?: string;
}) {
  const p = plan;
  return (
    <svg
      id={svgId}
      viewBox={`0 0 ${p.W} ${p.H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
    >
      {(p.rects || []).map((r, i) => (
        <rect key={"r" + i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} stroke={r.stroke} strokeWidth={r.sw} rx={r.rx} strokeDasharray={r.dash || undefined} />
      ))}
      {(p.paths || []).map((q, i) => (
        <path key={"p" + i} d={q.d} fill={q.fill} stroke={q.stroke} strokeWidth={q.sw} strokeDasharray={q.dash || undefined} />
      ))}
      {(p.lines || []).map((l, i) => (
        <line key={"l" + i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.stroke} strokeWidth={l.sw} strokeDasharray={l.dash || undefined} strokeLinecap="round" />
      ))}
      {(p.circles || []).map((c, i) => (
        <circle key={"c" + i} cx={c.cx} cy={c.cy} r={c.r} fill={c.fill} />
      ))}
      {(p.texts || []).map((t, i) => (
        <text key={"t" + i} x={t.x} y={t.y} textAnchor={t.anchor as "start" | "middle" | "end"} transform={t.transform || undefined} fontSize={t.size} fontWeight={t.weight || 400} fill={t.fill} style={{ fontFamily: MONO }}>
          {t.t}
        </text>
      ))}
      {interactive &&
        (p.handles || []).map((hd, i) => (
          <g key={"h" + i}>
            <g
              style={{ cursor: hd.shape === "wall" ? "ew-resize" : "ns-resize", touchAction: "none", pointerEvents: "auto" }}
              onPointerDown={(e) => onHandleDown && onHandleDown(hd, e)}
            >
              <circle cx={hd.cx} cy={hd.cy} r={13} fill="transparent" />
              {hd.shape === "wall" ? (
                <>
                  <rect x={hd.cx - 5.5} y={hd.cy - 15} width={11} height={30} rx={4} fill={accent} stroke="#fff" strokeWidth={1.6} />
                  <line x1={hd.cx - 2} y1={hd.cy - 4} x2={hd.cx - 2} y2={hd.cy + 4} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                  <line x1={hd.cx + 2} y1={hd.cy - 4} x2={hd.cx + 2} y2={hd.cy + 4} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                </>
              ) : (
                <>
                  <rect x={hd.cx - 15} y={hd.cy - 5.5} width={30} height={11} rx={4} fill={accent} stroke="#fff" strokeWidth={1.6} />
                  <line x1={hd.cx - 4} y1={hd.cy - 2} x2={hd.cx + 4} y2={hd.cy - 2} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                  <line x1={hd.cx - 4} y1={hd.cy + 2} x2={hd.cx + 4} y2={hd.cy + 2} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                </>
              )}
            </g>
          </g>
        ))}
    </svg>
  );
}

/**
 * Static string-builder twin of `<PlanSvg>` (Task 1, #38 — generated base
 * sheet). A Grid base sheet is stored as a plain `data:image/svg+xml…`
 * `GridSheet.dataUrl` and painted through an `<img>` tag (editor.tsx), never
 * mounted as React — so it needs raw markup, not a component, and NOT
 * `react-dom/server` either: this file is imported from `grid-projects.ts`,
 * a doc-store module with no request/render context to renderToString into,
 * called at intake-save time from a plain server action. A small manual
 * serializer over the same five primitive arrays `<PlanSvg>` already walks
 * is the entire cost of avoiding that dependency.
 *
 * Deliberately excludes `handles` — Quick Design's own interactive wall
 * drag affordances. A generated Grid base sheet is a static background
 * image, like an uploaded plan; nothing on it drags.
 *
 * `accent` is accepted only to keep this a drop-in twin of `buildPlan`'s own
 * signature — every primitive already carries its resolved color from
 * `buildPlan`, the same way `buildPlanProscenium`'s own `_accent` parameter
 * goes unused once its symbols are drawn in fixed system colors.
 */
export function renderPlanSvgMarkup(plan: PlanData, accent: string): string {
  void accent;
  const p = plan;
  const esc = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const attr = (name: string, value: string | number | undefined | null) =>
    value === undefined || value === null || value === "" ? "" : ` ${name}="${esc(String(value))}"`;

  const rects = (p.rects || [])
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${esc(r.fill)}" stroke="${esc(r.stroke)}" stroke-width="${r.sw}"${attr("rx", r.rx)}${attr("stroke-dasharray", r.dash)} />`
    )
    .join("");
  const paths = (p.paths || [])
    .map(
      (q) =>
        `<path d="${esc(q.d)}" fill="${esc(q.fill)}"${attr("stroke", q.stroke)}${attr("stroke-width", q.sw)}${attr("stroke-dasharray", q.dash)} />`
    )
    .join("");
  const lines = (p.lines || [])
    .map(
      (l) =>
        `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${esc(l.stroke)}" stroke-width="${l.sw}"${attr("stroke-dasharray", l.dash)} stroke-linecap="round" />`
    )
    .join("");
  const circles = (p.circles || [])
    .map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="${esc(c.fill)}" />`)
    .join("");
  const texts = (p.texts || [])
    .map(
      (t) =>
        `<text x="${t.x}" y="${t.y}" text-anchor="${esc(t.anchor)}"${attr("transform", t.transform)} font-size="${t.size}" font-weight="${t.weight || 400}" fill="${esc(t.fill)}" font-family="${esc(STATIC_MONO)}">${esc(t.t)}</text>`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p.W}" height="${p.H}" viewBox="0 0 ${p.W} ${p.H}" preserveAspectRatio="xMidYMid meet">${rects}${paths}${lines}${circles}${texts}</svg>`;
}

/* --------------------- house drag math (auto plan) --------------------- */

/** A drag's pointer: absolute viewBox position, and the viewBox delta since the drag began. */
export type DragPos = { sx: number; sy: number; dx: number; dy: number };

/**
 * Converts a wall drag into a state patch (#249, #255): the side walls set
 * house / nave width (symmetric) and the back wall house / nave depth, from
 * the drag's DELTA at the drag-start scale — the canvas rescales as the room
 * grows, so an absolute position would chase itself. Whole feet, clamped like
 * the typed fields.
 */
export function houseDragPatch(s: AState, hd: PlanHandle, pos: DragPos, tpl?: string | null): Partial<AState> | null {
  if (hd.type !== "wall") return null;
  const id = planTemplate(s, tpl);
  const family = templateEntry(id)?.family;
  if (family !== "proscenium" && family !== "church") return null;
  const G = family === "church" ? churchGeom(s, id) : prosGeom(s, id);
  if (family === "proscenium" && (VENUES.find((v) => v.key === s.venue) || VENUES[0]).kind === "gym") {
    // #255: a gym-kind design's walls are its own width (floor) and depth fields.
    if (hd.side === "B") return { depth: Math.round(clamp(G.dims.houseDepthFt + pos.dy / G.ppf, LIM.depth[0], LIM.depth[1])) };
    return { width: Math.round(clamp(G.dims.houseWidthFt + (2 * (hd.side === "L" ? -1 : 1) * pos.dx) / G.ppf, LIM.width[0], LIM.width[1])) };
  }
  if (hd.side === "B") {
    const [lo, hi] = houseSpecFor(G.template).depthLim;
    return { houseDepthFt: Math.round(clamp(G.dims.houseDepthFt + pos.dy / G.ppf, lo, hi)) };
  }
  const [lo, hi] = houseWidthLim(s, G.template);
  const dir = hd.side === "L" ? -1 : 1;
  return { houseWidthFt: Math.round(clamp(G.dims.houseWidthFt + (2 * dir * pos.dx) / G.ppf, lo, hi)) };
}

export type { SysKey };
