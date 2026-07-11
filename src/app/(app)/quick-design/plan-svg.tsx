/**
 * Generated groundplans — port of the buildPlan* functions from
 * app/Quick Design.dc.html (proscenium, church, conference/flat, gym,
 * black box, arena) plus the shared dimension-line / door / booth helpers,
 * the legend builder, and the interactive wall/door handles.
 *
 * The builders return primitive lists ({rects,lines,circles,texts,paths})
 * exactly like the prototype; <PlanSvg> renders them.
 */

import type * as React from "react";
import { SYSCOLOR, VENUES, type AState, type SysKey, type VenueKind } from "./engine";

/* ------------------------------ primitive types ------------------------------ */

type Rect = { x: number; y: number; w: number; h: number; fill: string; stroke: string; sw: number; rx?: number; dash?: string };
type LineEl = { x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; dash?: string };
type CircleEl = { cx: number; cy: number; r: number; fill: string };
type TextEl = { x: number; y: number; t: string; fill: string; size: number; weight?: number; anchor: string; transform?: string };
type PathEl = { d: string; fill: string; stroke?: string; sw?: number; dash?: string };

export type PlanHandle = {
  type: "wall" | "door";
  side?: "L" | "R";
  key?: "doorsL" | "doorsR" | "doorsBack";
  idx?: number;
  axis?: "x" | "y";
  cx: number;
  cy: number;
  rmX?: number;
  rmY?: number;
  shape: "wall" | "door";
  removable?: boolean;
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

/** sample doorway on a vertical wall at (x, yc); dir = +1 swings toward +x (into the room) */
function vDoor(L: L, x: number, yc: number, dir: number, len?: number, floor?: string) {
  len = len || 17;
  floor = floor || "#f6f7f9";
  const dTop = yc - len / 2;
  const dBot = yc + len / 2;
  L.lines.push({ x1: R(x), y1: R(dTop), x2: R(x), y2: R(dBot), stroke: floor, sw: 3, dash: "" });
  L.lines.push({ x1: R(x - 3), y1: R(dTop), x2: R(x + 3), y2: R(dTop), stroke: "#16181d", sw: 1.4, dash: "" });
  L.lines.push({ x1: R(x - 3), y1: R(dBot), x2: R(x + 3), y2: R(dBot), stroke: "#16181d", sw: 1.4, dash: "" });
  const lx = R(x + dir * len * 0.84);
  const ly = R(dBot - len * 0.52);
  L.lines.push({ x1: R(x), y1: R(dBot), x2: lx, y2: ly, stroke: "#9aa0ab", sw: 1.3, dash: "" });
  L.paths.push({ d: "M " + R(x + dir * len) + " " + R(dBot) + " A " + len + " " + len + " 0 0 " + (dir > 0 ? 0 : 1) + " " + lx + " " + ly, fill: "none", stroke: "#cdd1d9", sw: 0.8, dash: "3 3" });
}

/** sample doorway on a HORIZONTAL wall at (xc, y); dir = +1 swings toward +y, -1 toward -y */
function hDoor(L: L, xc: number, y: number, dir: number, len?: number, floor?: string) {
  len = len || 17;
  floor = floor || "#f6f7f9";
  const dL = xc - len / 2;
  const dR = xc + len / 2;
  L.lines.push({ x1: R(dL), y1: R(y), x2: R(dR), y2: R(y), stroke: floor, sw: 3, dash: "" });
  L.lines.push({ x1: R(dL), y1: R(y - 3), x2: R(dL), y2: R(y + 3), stroke: "#16181d", sw: 1.4, dash: "" });
  L.lines.push({ x1: R(dR), y1: R(y - 3), x2: R(dR), y2: R(y + 3), stroke: "#16181d", sw: 1.4, dash: "" });
  const lx = R(dL + len * 0.52);
  const ly = R(y + dir * len * 0.84);
  L.lines.push({ x1: R(dL), y1: R(y), x2: lx, y2: ly, stroke: "#9aa0ab", sw: 1.3, dash: "" });
  L.paths.push({ d: "M " + R(dL) + " " + R(y + dir * len) + " A " + len + " " + len + " 0 0 " + (dir > 0 ? 1 : 0) + " " + lx + " " + ly, fill: "none", stroke: "#cdd1d9", sw: 0.8, dash: "3 3" });
}

/** center FOH mix position — seats removed mid-house for the front-of-house console */
function mixPos(L: L, cx: number, yc: number, w: number) {
  const hw = w / 2;
  const hh = 9;
  const d = "M " + R(cx - hw) + " " + R(yc - hh) + " h " + R(w) + " v " + R(hh * 2) + " h " + R(-w) + " Z";
  L.paths.push({ d, fill: "#ffffff", stroke: "none", dash: "" });
  L.paths.push({ d, fill: "none", stroke: "#9aa0ab", sw: 1.2, dash: "4 3" });
  L.texts.push({ x: R(cx), y: R(yc + 3), t: "FOH MIX", fill: "#6b7280", size: 8, weight: 600, anchor: "middle", transform: "" });
}

/** rear control / projection booth straddling the back wall, window onto the stage */
function booth(L: L, cx: number, yTop: number, w: number, h: number, floor: string, showConsole: boolean) {
  floor = floor || "#f6f7f9";
  L.rects.push({ x: R(cx - w / 2), y: R(yTop), w: R(w), h: R(h), fill: floor, stroke: "#16181d", sw: 1.6, rx: 2, dash: "" });
  L.lines.push({ x1: R(cx - w / 2 + 2), y1: R(yTop), x2: R(cx + w / 2 - 2), y2: R(yTop), stroke: SYSCOLOR.controls, sw: 1.8, dash: "3 2" });
  if (showConsole) {
    const cw = Math.min(R(w * 0.38), 30);
    L.rects.push({ x: R(cx - cw / 2), y: R(yTop + 4), w: cw, h: 4.5, fill: SYSCOLOR.controls, stroke: "none", sw: 0, rx: 1.5, dash: "" });
    L.circles.push({ cx: R(cx), cy: R(yTop + 12), r: 1.8, fill: SYSCOLOR.controls });
    L.texts.push({ x: R(cx), y: R(yTop + h - 3), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
  } else {
    L.texts.push({ x: R(cx), y: R(yTop + h * 0.62), t: "CONTROL BOOTH", fill: "#6b7280", size: 7.5, weight: 600, anchor: "middle", transform: "" });
  }
}

/* ------------------------------- geometries ------------------------------- */

export type ProsGeom = ReturnType<typeof prosGeom>;

/** shared proscenium groundplan geometry (auto plan AND drag math) */
export function prosGeom(s: AState) {
  const W = 640, ML = 58, MR = 138, MT = 52;
  const wing = s.wing || 0;
  const houseWft = s.width + 2 * wing;
  const ppf = (W - ML - MR) / Math.max(houseWft, 1);
  const depthPx = Math.max(150, s.depth * ppf);
  const pitFt = s.sys.pit ? Math.min(Math.max(s.depth * 0.16, 6), 12) : 0;
  const pitPx = pitFt * ppf;
  const xHouseL = ML, xHouseR = W - MR, cx = (xHouseL + xHouseR) / 2;
  const yBack = MT, yPlaster = yBack + depthPx;
  const xProcL = cx - (s.width / 2) * ppf, xProcR = cx + (s.width / 2) * ppf, openW = xProcR - xProcL;
  const apronFt = 6, apronPx = apronFt * ppf, apronBulge = apronPx * 0.7;
  const yApron = yPlaster + apronPx, yApronFront = yApron + apronBulge;
  const defHalfFt = houseWft / 2;
  const minHalfFt = s.width / 2 + 1.5, maxHalfFt = Math.min(cx - 12, W - 12 - cx) / ppf;
  let halfFt = typeof s.houseHalfFt === "number" && s.houseHalfFt > 0 ? s.houseHalfFt : defHalfFt;
  halfFt = Math.max(minHalfFt, Math.min(halfFt, maxHalfFt));
  const halfPx = halfFt * ppf, xAudL = R(cx - halfPx), xAudR = R(cx + halfPx);
  const yHouseFront = R(yPlaster);
  const seatTop = R(yApronFront) + 16, seatRows = 4, seatGap = 13;
  const seatBottom = seatTop + seatRows * seatGap;
  const yBackWall = R(seatBottom + 16);
  const boothW = R(Math.min(openW * 0.5, halfPx * 1.05));
  const boothH = 24, yBoothBottom = R(yBackWall + boothH);
  const yMix = R(seatTop + (seatBottom - seatTop) * 0.6);
  const doorsL = Array.isArray(s.doorsL) ? s.doorsL : [0.34, 0.82];
  const doorsR = Array.isArray(s.doorsR) ? s.doorsR : [0.34, 0.82];
  const doorsBack = Array.isArray(s.doorsBack) ? s.doorsBack : [0.13, 0.87];
  const H = R(yBoothBottom + 22);
  return {
    W, H, ML, MR, MT, wing, houseWft, ppf, depthPx, apronFt, apronPx, apronBulge, pitFt, pitPx,
    yApron, yApronFront, xHouseL, xHouseR, cx, yBack, yPlaster, xProcL, xProcR, openW,
    halfFt, halfPx, minHalfFt, maxHalfFt, xAudL, xAudR, yHouseFront, seatTop, seatRows, seatGap,
    seatBottom, yBackWall, boothW, boothH, yBoothBottom, yMix, doorsL, doorsR, doorsBack,
    stage: { x: xProcL, y: yBack, w: openW, h: depthPx },
  };
}

export type ChurchGeom = ReturnType<typeof churchGeom>;

/** shared church groundplan geometry */
export function churchGeom(s: AState) {
  const Wpx = 640, ML = 62, MR = 40, MT = 54;
  const ppf = (Wpx - ML - MR) / Math.max(s.width, 1);
  const x0 = ML, x1 = Wpx - MR, y0 = MT, cx = (x0 + x1) / 2;
  const chancelPx = Math.min(s.depth * ppf, 270);
  const congPx = 150, depthPx = chancelPx + congPx, y1 = y0 + depthPx;
  const halfFront = (x1 - x0) / 2, halfBack = halfFront * 0.6, pBot = y0 + chancelPx;
  const seatBot = y1 - 16;
  const boothW = R((x1 - x0) * 0.42), boothH = 24, yBoothBottom = R(y1 + boothH);
  const H = R(yBoothBottom + 22);
  const dDef = [0.3, 0.74];
  const doorsL = Array.isArray(s.doorsL) ? s.doorsL : dDef;
  const doorsR = Array.isArray(s.doorsR) ? s.doorsR : dDef;
  const doorsBack = Array.isArray(s.doorsBack) ? s.doorsBack : [0.13, 0.87];
  return { W: Wpx, ML, MR, MT, ppf, x0, x1, y0, y1, cx, chancelPx, congPx, depthPx, halfFront, halfBack, pBot, seatBot, boothW, boothH, doorsL, doorsR, doorsBack, H, stage: { x: x0, y: y0, w: x1 - x0, h: chancelPx } };
}

/* -------------------------------- builders -------------------------------- */

function buildPlanProscenium(s: AState, lineSets: number, electrics: number, _accent: string): PlanData {
  void _accent; // proscenium symbols draw in system colors; the accent styles only the handles (rendered by <PlanSvg>)
  const G = prosGeom(s);
  const { W, H, wing, ppf, depthPx, apronPx, apronBulge, pitFt, yApron, yApronFront, xHouseL, xHouseR, cx, yBack, yPlaster, xProcL, xProcR, openW, xAudL, xAudR, yHouseFront, seatTop, seatRows, seatGap, seatBottom, yBackWall, boothW, boothH, yMix, doorsL, doorsR, doorsBack } = G;
  void apronPx; void apronBulge; void seatBottom;

  const rects: Rect[] = [], lines: LineEl[] = [], circles: CircleEl[] = [], texts: TextEl[] = [], paths: PathEl[] = [];
  const handles: PlanHandle[] = [];
  const yAt = (frac: number) => R(yBack + frac * depthPx);
  const tick = (x: number, y: number) => lines.push({ x1: R(x - 4), y1: R(y + 4), x2: R(x + 4), y2: R(y - 4), stroke: "#8c919c", sw: 1.2, dash: "" });

  // floors: wing house + playing area
  rects.push({ x: R(xHouseL), y: R(yBack), w: R(xHouseR - xHouseL), h: R(depthPx), fill: "#f6f7f9", stroke: "#dcdfe5", sw: 1.2, rx: 2, dash: "" });
  rects.push({ x: R(xProcL), y: R(yBack), w: R(openW), h: R(depthPx), fill: "#ffffff", stroke: "#e3e5ea", sw: 1, rx: 1, dash: "" });

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
  const labelX = xHouseR + 12;
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
    lines.push({ x1: R(xProcR), y1: y, x2: R(xHouseR + 6), y2: R(ly), stroke: "#d0d3da", sw: 0.8, dash: "" });
    texts.push({ x: R(labelX), y: R(ly + 3), t: it.label, fill: it.kind === "electric" ? cLight : cCurt, size: 8, anchor: "start", transform: "" });
  });

  // structure: back wall, side walls, proscenium walls + opening
  lines.push({ x1: R(xHouseL), y1: R(yBack), x2: R(xHouseR), y2: R(yBack), stroke: "#16181d", sw: 2.4, dash: "" });
  lines.push({ x1: R(xHouseL), y1: R(yBack), x2: R(xHouseL), y2: R(yPlaster), stroke: "#16181d", sw: 2, dash: "" });
  lines.push({ x1: R(xHouseR), y1: R(yBack), x2: R(xHouseR), y2: R(yPlaster), stroke: "#16181d", sw: 2, dash: "" });
  lines.push({ x1: R(xHouseL), y1: R(yPlaster), x2: R(xProcL), y2: R(yPlaster), stroke: "#16181d", sw: 3.4, dash: "" });
  lines.push({ x1: R(xProcR), y1: R(yPlaster), x2: R(xHouseR), y2: R(yPlaster), stroke: "#16181d", sw: 3.4, dash: "" });
  lines.push({ x1: R(xProcL), y1: R(yPlaster), x2: R(xProcR), y2: R(yPlaster), stroke: "#8c919c", sw: 1, dash: "2 3" });
  lines.push({ x1: R(xProcL), y1: R(yBack), x2: R(xProcL), y2: R(yPlaster), stroke: "#c4c9d2", sw: 1, dash: "4 4" });
  lines.push({ x1: R(xProcR), y1: R(yBack), x2: R(xProcR), y2: R(yPlaster), stroke: "#c4c9d2", sw: 1, dash: "4 4" });
  lines.push({ x1: R(cx), y1: R(yBack), x2: R(cx), y2: R(yBackWall), stroke: "#c4c9d2", sw: 1, dash: "3 4" });

  // apron / forestage
  paths.push({ d: "M " + R(xProcL) + " " + R(yPlaster) + " L " + R(xProcL) + " " + R(yApron) + " Q " + R(cx) + " " + R(yApronFront) + " " + R(xProcR) + " " + R(yApron) + " L " + R(xProcR) + " " + R(yPlaster) + " Z", fill: "#fcfcfd", stroke: "#e3e5ea", sw: 1, dash: "" });
  // orchestra pit
  if (pitFt) {
    const pw = openW * 0.5, pTop = R(yApron - 1);
    paths.push({ d: "M " + R(cx - pw / 2) + " " + pTop + " Q " + R(cx) + " " + R(yApronFront - 1) + " " + R(cx + pw / 2) + " " + pTop + " Z", fill: "#eceef1", stroke: SYSCOLOR.pit, sw: 1, dash: "" });
    texts.push({ x: R(cx), y: R((yApron + yApronFront) / 2 + 2), t: "PIT", fill: SYSCOLOR.pit, size: 8, anchor: "middle", transform: "" });
  }

  // auditorium (house) floor
  rects.push({ x: R(xAudL), y: R(yHouseFront), w: R(xAudR - xAudL), h: R(yBackWall - yHouseFront), fill: "#f9fafb", stroke: "none", sw: 0, rx: 2, dash: "" });

  // audience seating arcs
  for (let r = 0; r < seatRows; r++) {
    const yy = seatTop + r * seatGap, half = openW * 0.5 * (0.72 + r * 0.12);
    paths.push({ d: "M " + R(cx - half) + " " + R(yy) + " Q " + R(cx) + " " + R(yy + 9) + " " + R(cx + half) + " " + R(yy), fill: "none", stroke: "#dcdfe5", sw: 1, dash: "" });
  }

  const L: L = { rects, lines, circles, texts, paths };
  const floor = "#f9fafb", wallCol = "#16181d";
  const span = yBackWall - yHouseFront;
  lines.push({ x1: R(xHouseL), y1: R(yPlaster), x2: R(xAudL), y2: R(yPlaster), stroke: wallCol, sw: 2, dash: "" });
  lines.push({ x1: R(xHouseR), y1: R(yPlaster), x2: R(xAudR), y2: R(yPlaster), stroke: wallCol, sw: 2, dash: "" });
  lines.push({ x1: R(xAudL), y1: R(yHouseFront), x2: R(xAudL), y2: R(yBackWall), stroke: wallCol, sw: 2, dash: "" });
  lines.push({ x1: R(xAudR), y1: R(yHouseFront), x2: R(xAudR), y2: R(yBackWall), stroke: wallCol, sw: 2, dash: "" });
  lines.push({ x1: R(xAudL), y1: R(yBackWall), x2: R(cx - boothW / 2), y2: R(yBackWall), stroke: wallCol, sw: 2, dash: "" });
  lines.push({ x1: R(cx + boothW / 2), y1: R(yBackWall), x2: R(xAudR), y2: R(yBackWall), stroke: wallCol, sw: 2, dash: "" });
  doorsL.forEach((f) => vDoor(L, xAudL, yHouseFront + span * f, 1, 17, floor));
  doorsR.forEach((f) => vDoor(L, xAudR, yHouseFront + span * f, -1, 17, floor));
  doorsBack.forEach((f) => hDoor(L, xAudL + (xAudR - xAudL) * f, yBackWall, -1, 17, floor));
  mixPos(L, cx, yMix, Math.min(openW * 0.3, 86));
  const boothConsole = !!(s.sys && s.sys.controls && s.ctrl && s.ctrl.console);
  booth(L, cx, yBackWall, boothW, boothH, floor, boothConsole);

  // interactive handles — slide walls, drag/remove doors
  {
    const wy = R(yHouseFront + span * 0.52);
    handles.push({ type: "wall", side: "L", cx: xAudL, cy: wy, shape: "wall" });
    handles.push({ type: "wall", side: "R", cx: xAudR, cy: wy, shape: "wall" });
    doorsL.forEach((f, i) => {
      const dy = R(yHouseFront + span * f);
      handles.push({ type: "door", key: "doorsL", idx: i, axis: "y", cx: xAudL, cy: dy, rmX: R(xAudL - 13), rmY: R(dy - 12), shape: "door", removable: true });
    });
    doorsR.forEach((f, i) => {
      const dy = R(yHouseFront + span * f);
      handles.push({ type: "door", key: "doorsR", idx: i, axis: "y", cx: xAudR, cy: dy, rmX: R(xAudR + 13), rmY: R(dy - 12), shape: "door", removable: true });
    });
    doorsBack.forEach((f, i) => {
      const dx = R(xAudL + (xAudR - xAudL) * f);
      handles.push({ type: "door", key: "doorsBack", idx: i, axis: "x", cx: dx, cy: R(yBackWall), rmX: R(dx + 12), rmY: R(yBackWall + 13), shape: "door", removable: true });
    });
  }

  // dimension lines — proscenium width + wings (top)
  const yWid = yBack - 26;
  lines.push({ x1: R(xProcL), y1: R(yBack - 4), x2: R(xProcL), y2: R(yWid - 3), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xProcR), y1: R(yBack - 4), x2: R(xProcR), y2: R(yWid - 3), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xProcL), y1: R(yWid), x2: R(xProcR), y2: R(yWid), stroke: "#8c919c", sw: 1, dash: "" });
  tick(xProcL, yWid);
  tick(xProcR, yWid);
  texts.push({ x: R(cx), y: R(yWid - 6), t: s.width + "'-0\"", fill: "#8c919c", size: 11, anchor: "middle", transform: "" });
  if (wing > 0) {
    ([[xHouseL, xProcL], [xProcR, xHouseR]] as Array<[number, number]>).forEach((seg) => {
      const a = seg[0], b = seg[1];
      lines.push({ x1: R(a), y1: R(yWid), x2: R(b), y2: R(yWid), stroke: "#c4c9d2", sw: 0.9, dash: "" });
      tick(a, yWid);
      tick(b, yWid);
      texts.push({ x: R((a + b) / 2), y: R(yWid - 6), t: wing + "'", fill: "#8c919c", size: 11, anchor: "middle", transform: "" });
    });
  }
  // dimension line — depth (left)
  const xDep = xHouseL - 30, yMid = (yBack + yPlaster) / 2;
  lines.push({ x1: R(xHouseL - 4), y1: R(yBack), x2: R(xDep - 3), y2: R(yBack), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xHouseL - 4), y1: R(yPlaster), x2: R(xDep - 3), y2: R(yPlaster), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xDep), y1: R(yBack), x2: R(xDep), y2: R(yPlaster), stroke: "#8c919c", sw: 1, dash: "" });
  tick(xDep, yBack);
  tick(xDep, yPlaster);
  texts.push({ x: R(xDep - 7), y: R(yMid), t: s.depth + "'-0\"", fill: "#8c919c", size: 11, anchor: "middle", transform: "rotate(-90 " + R(xDep - 7) + " " + R(yMid) + ")" });

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

/** Gym stage — gymnasium floor, raised proscenium stage across the top, bleachers. */
function buildPlanGym(s: AState, _lineSets: number, _electrics: number, accent: string): PlanData {
  const Wpx = 640, ML = 62, MR = 40, MT = 54;
  const ppf = (Wpx - ML - MR) / Math.max(s.width, 1);
  const depthPx = Math.max(200, Math.min(s.depth * ppf, 440));
  const x0 = ML, x1 = Wpx - MR, y0 = MT, y1 = y0 + depthPx, cx = (x0 + x1) / 2;
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  L.rects.push({ x: R(x0), y: R(y0), w: R(x1 - x0), h: R(depthPx), fill: "#f6f7f9", stroke: "#16181d", sw: 2, rx: 2, dash: "" });
  const stageW = (x1 - x0) * 0.6, stageH = Math.min(Math.max(s.depth * 0.18, 6) * ppf, depthPx * 0.3);
  const stx0 = cx - stageW / 2, stx1 = cx + stageW / 2, sBot = y0 + stageH;
  L.rects.push({ x: R(stx0), y: R(y0), w: R(stageW), h: R(stageH), fill: "#ffffff", stroke: accent, sw: 1.8, rx: 2, dash: "" });
  L.lines.push({ x1: R(stx0), y1: R(sBot), x2: R(stx1), y2: R(sBot), stroke: accent, sw: 2.4, dash: "" });
  L.texts.push({ x: R(cx), y: R(y0 + stageH / 2 + 3), t: "STAGE", fill: "#9aa0ab", size: 8.5, anchor: "middle", transform: "" });
  if (s.sys.curtains) L.lines.push({ x1: R(stx0 + 4), y1: R(y0 + 5), x2: R(stx1 - 4), y2: R(y0 + 5), stroke: SYSCOLOR.curtains, sw: 2.6, dash: "4 3" });
  if (s.sys.video) [stx0 - 14, stx1 + 14].forEach((x) => L.lines.push({ x1: R(x - 12), y1: R(y0 + 12), x2: R(x + 12), y2: R(y0 + 12), stroke: SYSCOLOR.video, sw: 3, dash: "" }));
  if (s.sys.audio) [stx0 - 8, stx1 + 8].forEach((x) => L.rects.push({ x: R(x - 5), y: R(y0 + 7), w: 10, h: 14, fill: "#eef0f3", stroke: "#3155a8", sw: 1.2, rx: 2, dash: "" }));
  if (s.sys.lighting) {
    const yBar = sBot + 20, dn = Math.max(4, Math.round(stageW / 34));
    L.lines.push({ x1: R(stx0), y1: R(yBar), x2: R(stx1), y2: R(yBar), stroke: "#9aa0ab", sw: 1, dash: "2 3" });
    for (let k = 0; k < dn; k++) L.circles.push({ cx: R(stx0 + ((k + 0.5) / dn) * stageW), cy: R(yBar), r: 2.6, fill: SYSCOLOR.lighting });
    L.texts.push({ x: R(stx1 + 6), y: R(yBar + 3), t: "FOH", fill: "#8c919c", size: 7.5, anchor: "start", transform: "" });
  }
  const flrTop = sBot + (s.sys.lighting ? 36 : 22), flrBot = y1 - 10, blW = Math.min(22, (x1 - x0) * 0.09);
  [x0, x1 - blW].forEach((rx) => {
    L.rects.push({ x: R(rx), y: R(flrTop), w: R(blW), h: R(flrBot - flrTop), fill: "#eceef1", stroke: "#cdd1d9", sw: 1, rx: 1, dash: "" });
    const tiers = Math.max(3, Math.round((flrBot - flrTop) / 18));
    for (let t = 1; t < tiers; t++) {
      const ty = flrTop + (t * (flrBot - flrTop)) / tiers;
      L.lines.push({ x1: R(rx), y1: R(ty), x2: R(rx + blW), y2: R(ty), stroke: "#d8dbe1", sw: 0.8, dash: "" });
    }
  });
  L.texts.push({ x: R(x0 + blW + 4), y: R(flrTop + 9), t: "BLEACHERS", fill: "#c4c9d2", size: 7, anchor: "start", transform: "" });
  const mid = (flrTop + flrBot) / 2;
  L.lines.push({ x1: R(x0 + blW + 8), y1: R(mid), x2: R(x1 - blW - 8), y2: R(mid), stroke: "#e2e5ea", sw: 1.4, dash: "" });
  L.texts.push({ x: R(cx), y: R(flrBot - 5), t: "GYM FLOOR", fill: "#c4c9d2", size: 8, anchor: "middle", transform: "" });
  dimH(L, x0, x1, y0 - 26, s.width + "'-0\"", false);
  dimV(L, y0, y1, x0 - 32, s.depth + "'-0\"");
  return { W: Wpx, H: R(y1 + 28), ...L };
}

/** Church — trapezoidal chancel platform, curved pew rows, booth + doors. */
function buildPlanChurch(s: AState, _lineSets: number, _electrics: number, accent: string): PlanData {
  const G = churchGeom(s);
  const { W: Wpx, x0, x1, y0, y1, cx, chancelPx, depthPx, halfFront, halfBack, pBot, seatBot, boothW, boothH, doorsL, doorsR, doorsBack, H } = G;
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  const handles: PlanHandle[] = [];
  L.rects.push({ x: R(x0), y: R(y0), w: R(x1 - x0), h: R(depthPx), fill: "#f6f7f9", stroke: "#16181d", sw: 2, rx: 2, dash: "" });
  L.paths.push({ d: "M " + R(cx - halfBack) + " " + R(y0) + " L " + R(cx + halfBack) + " " + R(y0) + " L " + R(cx + halfFront) + " " + R(pBot) + " L " + R(cx - halfFront) + " " + R(pBot) + " Z", fill: "#ffffff", stroke: accent, sw: 1.6, dash: "" });
  L.texts.push({ x: R(cx), y: R(y0 + chancelPx * 0.5), t: "CHANCEL", fill: "#9aa0ab", size: 8, anchor: "middle", transform: "" });
  if (s.sys.curtains) L.lines.push({ x1: R(cx - halfBack), y1: R(y0 + 4), x2: R(cx + halfBack), y2: R(y0 + 4), stroke: SYSCOLOR.curtains, sw: 2.6, dash: "4 3" });
  if (s.sys.video) [cx - halfFront * 0.46, cx + halfFront * 0.46].forEach((x) => L.lines.push({ x1: R(x - 13), y1: R(y0 + 11), x2: R(x + 13), y2: R(y0 + 11), stroke: SYSCOLOR.video, sw: 3, dash: "" }));
  if (s.sys.lighting)
    [0.42, 0.8].forEach((f) => {
      const y = y0 + chancelPx * f, half = halfBack + (halfFront - halfBack) * f, dn = Math.max(3, Math.round((half * 2) / 34));
      L.lines.push({ x1: R(cx - half), y1: R(y), x2: R(cx + half), y2: R(y), stroke: "#9aa0ab", sw: 1, dash: "2 3" });
      for (let k = 0; k < dn; k++) L.circles.push({ cx: R(cx - half + ((k + 0.5) / dn) * half * 2), cy: R(y), r: 2.4, fill: SYSCOLOR.lighting });
    });
  if (s.sys.audio) [cx - halfFront - 8, cx + halfFront + 8].forEach((x) => L.rects.push({ x: R(x - 5), y: R(y0 + 8), w: 10, h: 14, fill: "#eef0f3", stroke: "#3155a8", sw: 1.2, rx: 2, dash: "" }));
  const seatTop = pBot + 26;
  const rows = Math.max(3, Math.min(7, Math.round((seatBot - seatTop) / 16)));
  for (let r = 0; r < rows; r++) {
    const yy = seatTop + (r * (seatBot - seatTop)) / Math.max(rows - 1, 1), half = (x1 - x0) * 0.5 * (0.5 + r * 0.08);
    L.paths.push({ d: "M " + R(cx - half) + " " + R(yy) + " Q " + R(cx) + " " + R(yy + 10) + " " + R(cx + half) + " " + R(yy), fill: "none", stroke: "#cdd1d9", sw: 1.4, dash: "" });
  }
  L.lines.push({ x1: R(cx), y1: R(seatTop - 4), x2: R(cx), y2: R(seatBot + 6), stroke: "#e6e8ec", sw: 6, dash: "" });
  L.texts.push({ x: R(cx), y: R(seatBot + 13), t: "CONGREGATION", fill: "#c4c9d2", size: 8, anchor: "middle", transform: "" });
  const floor = "#f6f7f9", cspan = seatBot - seatTop;
  doorsL.forEach((f) => vDoor(L, x0, seatTop + cspan * f, 1, 17, floor));
  doorsR.forEach((f) => vDoor(L, x1, seatTop + cspan * f, -1, 17, floor));
  doorsBack.forEach((f) => hDoor(L, x0 + (x1 - x0) * f, y1, -1, 17, floor));
  mixPos(L, cx, R(seatTop + cspan * 0.62), Math.min((x1 - x0) * 0.3, 86));
  L.lines.push({ x1: R(cx - boothW / 2), y1: R(y1), x2: R(cx + boothW / 2), y2: R(y1), stroke: floor, sw: 3, dash: "" });
  const boothConsole = !!(s.sys && s.sys.controls && s.ctrl && s.ctrl.console);
  booth(L, cx, y1, boothW, boothH, floor, boothConsole);
  doorsL.forEach((f, i) => {
    const dy = R(seatTop + cspan * f);
    handles.push({ type: "door", key: "doorsL", idx: i, axis: "y", cx: R(x0), cy: dy, rmX: R(x0 - 13), rmY: R(dy - 12), shape: "door", removable: true });
  });
  doorsR.forEach((f, i) => {
    const dy = R(seatTop + cspan * f);
    handles.push({ type: "door", key: "doorsR", idx: i, axis: "y", cx: R(x1), cy: dy, rmX: R(x1 + 13), rmY: R(dy - 12), shape: "door", removable: true });
  });
  doorsBack.forEach((f, i) => {
    const dx = R(x0 + (x1 - x0) * f);
    handles.push({ type: "door", key: "doorsBack", idx: i, axis: "x", cx: dx, cy: R(y1), rmX: R(dx + 12), rmY: R(y1 + 13), shape: "door", removable: true });
  });
  dimH(L, x0, x1, y0 - 26, s.width + "'-0\"", false);
  dimV(L, y0, pBot, x0 - 32, s.depth + "'-0\"");
  return { W: Wpx, H, ...L, handles };
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
    it.push({ sw: mk("box"), label: "Chancel platform" });
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
  } else if (kind === "gym") {
    it.push({ sw: mk("box"), label: "Stage platform" });
    if (sys.curtains) it.push({ sw: mk("dash", C.curtains), label: "Main curtain" });
    if (sys.lighting) it.push({ sw: mk("dot", C.lighting), label: "FOH lighting" });
    if (sys.audio) it.push({ sw: mk("spk"), label: "Loudspeaker" });
    it.push({ sw: mk("seat"), label: "Bleachers" });
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

export function buildPlan(s: AState, lineSets: number, electrics: number, accent: string): PlanData {
  const venue = VENUES.find((v) => v.key === s.venue) || VENUES[0];
  const kind: VenueKind = venue.kind || "proscenium";
  let p: PlanData;
  if (kind === "church") p = buildPlanChurch(s, lineSets, electrics, accent);
  else if (kind === "flat") p = buildPlanFlat(s, lineSets, electrics, accent);
  else if (kind === "blackbox") p = buildPlanBlackbox(s, lineSets, electrics, accent);
  else if (kind === "gym") p = buildPlanGym(s, lineSets, electrics, accent);
  else if (kind === "arena") p = buildPlanArena(s, lineSets, electrics, accent);
  else p = buildPlanProscenium(s, lineSets, electrics, accent);
  p.legend = legendFor(kind, s, electrics, accent);
  p.isHouse = kind === "proscenium" || kind === "church";
  p.canSlideWalls = kind === "proscenium";
  return p;
}

/* --------------------------------- render --------------------------------- */

const MONO = "var(--font-mono), IBM Plex Mono, monospace";

export function PlanSvg({
  plan,
  accent,
  interactive = false,
  onHandleDown,
  onRemoveDoor,
  svgId,
}: {
  plan: PlanData;
  accent: string;
  /** render + wire the wall/door handles (Quick Design auto plan) */
  interactive?: boolean;
  onHandleDown?: (h: PlanHandle, e: React.PointerEvent<SVGGElement>) => void;
  onRemoveDoor?: (key: "doorsL" | "doorsR" | "doorsBack", idx: number) => void;
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
                  <circle cx={hd.cx} cy={hd.cy} r={7.5} fill={accent} stroke="#fff" strokeWidth={1.6} />
                  <line x1={hd.cx} y1={hd.cy - 3.4} x2={hd.cx} y2={hd.cy + 3.4} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                </>
              )}
            </g>
            {hd.removable && hd.rmX != null && hd.rmY != null && (
              <g
                style={{ cursor: "pointer", touchAction: "none", pointerEvents: "auto" }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onRemoveDoor && hd.key && hd.idx != null) onRemoveDoor(hd.key, hd.idx);
                }}
              >
                <circle cx={hd.rmX} cy={hd.rmY} r={6} fill="#fff" stroke="#c4554a" strokeWidth={1.3} />
                <line x1={hd.rmX - 2.4} y1={hd.rmY - 2.4} x2={hd.rmX + 2.4} y2={hd.rmY + 2.4} stroke="#c4554a" strokeWidth={1.4} strokeLinecap="round" />
                <line x1={hd.rmX + 2.4} y1={hd.rmY - 2.4} x2={hd.rmX - 2.4} y2={hd.rmY + 2.4} stroke="#c4554a" strokeWidth={1.4} strokeLinecap="round" />
              </g>
            )}
          </g>
        ))}
    </svg>
  );
}

/* --------------------- house drag math (auto plan) --------------------- */

/**
 * Port of the prototype's _onPtrMove 'house' branch: converts a pointer
 * position (in SVG viewBox coords) into a state patch for the dragged
 * wall / door handle.
 */
export function houseDragPatch(
  s: AState,
  hd: PlanHandle,
  sx: number,
  sy: number
): Partial<AState> | null {
  const venue = VENUES.find((v) => v.key === s.venue) || VENUES[0];
  const kind = venue.kind || "proscenium";
  if (kind !== "proscenium" && kind !== "church") return null;
  if (hd.type === "wall") {
    if (kind !== "proscenium") return null;
    const G = prosGeom(s);
    const halfFt = clamp(Math.abs(G.cx - sx) / G.ppf, G.minHalfFt, G.maxHalfFt);
    return { houseHalfFt: +halfFt.toFixed(2) };
  }
  if (hd.type === "door" && hd.key && hd.idx != null) {
    const key = hd.key;
    if (kind === "church") {
      const G = churchGeom(s);
      const arr = (Array.isArray(s[key]) ? (s[key] as number[]) : G[key] || []).slice();
      if (hd.axis === "x") {
        const lX = G.x0, rX = G.x1;
        let frac = (sx - lX) / (rX - lX);
        const fbl = (G.cx - G.boothW / 2 - lX) / (rX - lX) - 0.02;
        const fbr = (G.cx + G.boothW / 2 - lX) / (rX - lX) + 0.02;
        if (frac > fbl && frac < fbr) frac = sx < G.cx ? fbl : fbr;
        arr[hd.idx] = +clamp(frac, 0.04, 0.96).toFixed(3);
      } else {
        const top = G.pBot + 26;
        const bot = G.seatBot;
        arr[hd.idx] = +clamp((sy - top) / (bot - top), 0.06, 0.94).toFixed(3);
      }
      return { [key]: arr } as Partial<AState>;
    }
    const G = prosGeom(s);
    const arr = (Array.isArray(s[key]) ? (s[key] as number[]) : G[key] || []).slice();
    if (hd.axis === "x") {
      const lX = G.xAudL, rX = G.xAudR;
      let frac = (sx - lX) / (rX - lX);
      const fbl = (G.cx - G.boothW / 2 - lX) / (rX - lX) - 0.02;
      const fbr = (G.cx + G.boothW / 2 - lX) / (rX - lX) + 0.02;
      if (frac > fbl && frac < fbr) frac = sx < G.cx ? fbl : fbr;
      arr[hd.idx] = +clamp(frac, 0.04, 0.96).toFixed(3);
    } else {
      const top = G.yHouseFront;
      const bot = G.yBackWall;
      arr[hd.idx] = +clamp((sy - top) / (bot - top), 0.06, 0.94).toFixed(3);
    }
    return { [key]: arr } as Partial<AState>;
  }
  return null;
}

/** default door arrays for the current venue kind (used by add/remove door) */
export function currentDoors(s: AState): { doorsL: number[]; doorsR: number[]; doorsBack: number[] } {
  const venue = VENUES.find((v) => v.key === s.venue) || VENUES[0];
  const kind = venue.kind || "proscenium";
  const G = kind === "church" ? churchGeom(s) : prosGeom(s);
  return { doorsL: G.doorsL.slice(), doorsR: G.doorsR.slice(), doorsBack: G.doorsBack.slice() };
}

export type { SysKey };
