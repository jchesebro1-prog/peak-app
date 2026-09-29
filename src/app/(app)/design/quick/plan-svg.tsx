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
import { SYSCOLOR, VENUES, type AState, type SysKey, type VenueKind } from "./engine";
import { blackboxDims, churchDims, houseDims, houseSpecFor, houseWidthLim, prosceniumDims } from "@/lib/design/venue-templates/house-dims";
import { planKindAllows, resolveBackground, templateEntry } from "@/lib/design/venue-templates";
import { keysById, stretchById } from "@/lib/design/venue-templates/templates";
import { boxOf, canvasOf, distToPoly, inPoly, movablesPx, rowSpans, type Box } from "@/lib/design/venue-templates/canvas";
import { movablePatch } from "@/lib/design/venue-templates/movable-options";
import { snapMovable } from "@/lib/design/venue-templates/stretch";

/* ------------------------------ primitive types ------------------------------ */

type Rect = { x: number; y: number; w: number; h: number; fill: string; stroke: string; sw: number; rx?: number; dash?: string };
type LineEl = { x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; dash?: string };
type CircleEl = { cx: number; cy: number; r: number; fill: string };
type TextEl = { x: number; y: number; t: string; fill: string; size: number; weight?: number; anchor: string; transform?: string };
type PathEl = { d: string; fill: string; stroke?: string; sw?: number; dash?: string };

/** A drag handle on the auto plan: a wall (`side`) sizes the room; a movable room (`key` = its id, #255) slides along the walls it may use. */
export type PlanHandle =
  | { type: "wall"; side: "L" | "R" | "B"; cx: number; cy: number; shape: "wall" | "backWall" }
  | { type: "movable"; key: string; cx: number; cy: number; shape: "movable" };

/** #255: a movable room's handle sits on the middle of its outer face — off the wall it hangs on, clear of that wall's own handle. */
const movableHandles = (ms: Array<{ id: string; handle: XY }>): PlanHandle[] => ms.map((m) => ({ type: "movable", key: m.id, cx: m.handle.x, cy: m.handle.y, shape: "movable" }));

/** #255: the Quick Design plan toolbar — shown when the plan has anything to drag; its hint and Reset button fit what that is. */
export function planToolbar(p: Pick<PlanData, "isHouse" | "handles">): { hint: string; reset: string; resetTitle: string } | null {
  const rooms = (p.handles || []).some((h) => h.type === "movable");
  if (!p.isHouse && !rooms) return null;
  if (!p.isHouse) return { hint: "Drag a room along the walls", reset: "Reset rooms", resetTitle: "Put the rooms back where they were drawn" };
  return { hint: rooms ? "Drag the walls to size the room, or a room along the walls" : "Drag the side or back wall to size the room", reset: "Reset house", resetTitle: "Reset the room to its default size" };
}

/** #255: what Reset puts back — the house to its default size and every movable room where it was drawn. */
export const RESET_HOUSE_PATCH = { houseHalfFt: null, houseWidthFt: null, houseDepthFt: null, movables: null } as const satisfies Partial<AState>;

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
function mixPos(L: L, cx: number, yc: number, w: number, text = "FOH MIX", hh = 9) {
  const hw = w / 2;
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
 * #255 fix: a kind limited to one type's drawings (the gym) never draws another
 * (the Auditorium) — it gets its default instead.
 */
export const planTemplate = (s: Pick<AState, "venue">, tpl: string | null | undefined): string | null =>
  tpl && planKindAllows(planKindOf(s), tpl) ? tpl : resolveBackground([], null, planKindOf(s));

/** Approximate advance of the plan's 8-px semibold mono label glyphs (px per character). */
export const LABEL_CHAR_PX = 4.9;

/** A booth room's FOH mix layout (boothMix): the box (centre, size, text), the CONSOLE mark (bar's centre x and top y) and the room's label. */
export type BoothMix = {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** The CONSOLE mark: its bar's centre x and top y (the word 11 px under the bar's top); null = console off. */
  console: { x: number; y: number } | null;
  /** The room's label: its index in `labels` and its new top-left anchor (labels draw their baseline at y + h). */
  label: { i: number; x: number; y: number } | null;
};

/**
 * #255 (fix): the FOH mix box for a booth room that moves (the Gym Stage Booth), wherever it sits (px). The room's
 * own label (7-px glyphs), the box (no wider than the room less 6 px, never over 86 nor under MIX_MIN_W; "FOH" where
 * "FOH MIX" won't fit) and, when `consoleOn`, the CONSOLE mark (bar + word, CONSOLE_SIDE_W wide, 11 px tall beside
 * the box or 16 px under it) take the first layout that fits inside the room, 3 px clear of its walls:
 *   1. label over the box, the mark under the box;  2. label over the box, the mark beside it;
 *   3. the box, the mark under it — label outside;  4. the box, the mark beside it — label outside;
 *   5. the box shrunk to the room's height (≥ 11 px), the mark beside it — label outside;
 *   6. the box shrunk to the room's height (≥ 10 px) alone inside, the label outside; the mark just outside the room —
 *      right of a room on the back wall, after the label for a room on a side wall;
 *   7. (a side-wall room narrower than the box) label, box and mark stacked just outside the room.
 * A label outside sits left of a room on the back wall (the floor's width dimension runs under it); outside a room on
 * a side wall things stack along the wall, under it — or over it when it sits too low on the wall for that. `house` = the floor the room is attached to: whatever leaves the room keeps to the room's
 * side of that floor's wall (a side-wall room's outside stack aligns to its outer edge). Every piece stays clear of
 * the others.
 */
export function boothMix(
  poly: XY[],
  labels: Array<{ text: string; x: number; y: number; h: number }>,
  consoleOn: boolean,
  house?: Box | null
): BoothMix {
  const bb = boxOf(poly);
  const i = labels.findIndex((l) => l.x >= bb.x && l.x <= bb.x + bb.w && l.y >= bb.y && l.y <= bb.y + bb.h);
  const lab = i < 0 ? null : labels[i];
  const labW = lab ? lab.text.length * LABEL_CHAR_PX : 0;
  const PAD = 3, LAB = 11, UNDER = 16, SIDE = CONSOLE_SIDE_W + 4;
  const iw = bb.w - 2 * PAD, ih = bb.h - 2 * PAD;
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  // -1: the room sits left of the floor (left wall), +1: right of it (right wall), 0: under it (back wall) or unknown.
  const away = !house ? 0 : bb.x + bb.w <= house.x + 1 ? -1 : bb.x >= house.x + house.w - 1 ? 1 : 0;
  const textFor = (w: number) => (w >= 7 * LABEL_CHAR_PX + 4 ? "FOH MIX" : "FOH");
  const labAt = (x: number, baseline: number) => (lab ? { i, x: R(x), y: R(baseline - lab.h) } : null);
  // Just under the room: centred when it fits under the room's width, else to its outer edge.
  const underX = (w: number) => (w <= iw || away === 0 ? cx - w / 2 : away < 0 ? bb.x + bb.w - PAD - w : bb.x + PAD);
  const out = (x: number, y: number, w: number, h: number, con: { x: number; y: number } | null, label: BoothMix["label"]): BoothMix => ({
    x: R(x), y: R(y), w: R(w), h, text: textFor(w), console: con && { x: R(con.x), y: R(con.y) }, label,
  });
  const labFits = !lab || labW <= iw;
  // Outside a side-wall room, things stack along the wall under it — over it only when the stack would run past the
  // plan's bottom margin (the room low on the wall); `outTop(h)` = the top of an h-px stack there. Back wall: under.
  const outTop = (h: number) => (away === 0 || !house || bb.y + bb.h + 3 + h <= house.y + house.h + 40 ? bb.y + bb.h + 3 : bb.y - 3 - h);
  // The label outside the room: beside it on the left for a room on the back wall (under it sits the floor's width
  // dimension), just under (or over) it for a room on a side wall.
  const labUnder = away === 0 ? labAt(bb.x - 4 - labW, cy + 3.5) : labAt(underX(labW), outTop(7) + 7);
  const conUnder = (x: number, yBox: number, h: number) => ({ x, y: yBox + h / 2 + 3 });
  // Box (w × h, the mark under it when consoleOn), stacked with the label over it when `labIn`, centred in the room.
  const stack = (labIn: boolean): BoothMix | null => {
    const w = Math.min(86, iw), tall = (labIn && lab ? LAB : 0) + 18 + (consoleOn ? UNDER : 0);
    if ((labIn && !labFits) || tall > ih || w < MIX_MIN_W || (consoleOn && iw < CONSOLE_SIDE_W)) return null;
    const top = cy - tall / 2, yBox = top + (labIn && lab ? LAB : 0) + 9;
    return out(cx, yBox, w, 18, consoleOn ? conUnder(cx, yBox, 18) : null, labIn ? labAt(cx - labW / 2, top + 7) : labUnder);
  };
  // Box h tall with the mark beside it (the row centred in the room, `room` px of height to fit in), the label over it when `labIn`.
  const row = (labIn: boolean, h: number, room = ih): BoothMix | null => {
    const w = Math.min(86, iw - SIDE), tall = (labIn && lab ? LAB : 0) + h;
    if (!consoleOn || (labIn && !labFits) || tall > room || w < MIX_MIN_W) return null;
    const top = cy - tall / 2, yBox = top + (labIn && lab ? LAB : 0) + h / 2, x = cx - SIDE / 2;
    return out(x, yBox, w, h, { x: x + w / 2 + 4 + CONSOLE_SIDE_W / 2, y: yBox - 5.5 }, labIn ? labAt(cx - labW / 2, top + 7) : labUnder);
  };
  // The box shrunk to the room's height (2 px clear of its walls), alone inside; the mark (if on) just outside the room.
  const hFit = R(Math.min(18, bb.h - 4));
  const alone = (): BoothMix | null => {
    const w = Math.min(86, iw), h = hFit;
    if (h < 10 || w < MIX_MIN_W) return null;
    if (!consoleOn) return out(cx, cy, w, h, null, labUnder);
    if (away === 0) return out(cx, cy, w, h, { x: bb.x + bb.w + 4 + CONSOLE_SIDE_W / 2, y: cy - 5.5 }, labUnder);
    // A side wall: the label, then the mark, stacked outside the room.
    const top = outTop((lab ? LAB : 0) + 14);
    return out(cx, cy, w, h, { x: underX(CONSOLE_SIDE_W) + CONSOLE_SIDE_W / 2, y: top + (lab ? LAB : 0) }, lab ? labAt(underX(labW), top + 7) : null);
  };
  const fit = stack(true) ?? row(true, 18) ?? stack(false) ?? row(false, 18) ?? (hFit >= 11 ? row(false, hFit, bb.h - 4) : null) ?? alone();
  if (fit) return fit;
  // 7: nothing fits inside (a side-wall room narrower than the box) — label, box and mark stacked just outside it.
  const w = MIX_MIN_W, top = outTop((lab ? LAB : 0) + 18 + (consoleOn ? UNDER : 0));
  const bx = underX(Math.max(w, labW)) + Math.max(w, labW) / 2;
  const yBox = top + (lab ? LAB : 0) + 9;
  return out(bx, yBox, w, 18, consoleOn ? { x: bx, y: yBox + 9 + 3 } : null, labAt(bx - labW / 2, top + 7));
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
  const inBooth = boothPoly ? boothMix(boothPoly, C.labels, !!(s.sys && s.sys.controls && s.ctrl && s.ctrl.console), boxOf(regions[keys.roles.house])) : null;
  const mix = inBooth ? { x: inBooth.x, y: inBooth.y } : { x: cx, y: pt("mix").y };
  const mixW = inBooth ? inBooth.w : 86, mixH = inBooth ? inBooth.h : 18;
  const yMix = mix.y;
  const mixBox: Box = { x: R(mix.x - mixW / 2), y: R(yMix - mixH / 2), w: mixW, h: mixH };
  const moved = inBooth?.label;
  const labels = moved ? C.labels.map((l, i) => (i === moved.i ? { ...l, x: moved.x, y: moved.y } : l)) : C.labels;
  return {
    template: id, W, H, ML, MR, MT, MB, ppi, ppf, dims, warning: houseDims(s, id).warning,
    mix, mixInBooth: !!boothPoly, mixBox, mixText: inBooth?.text ?? "FOH MIX", consoleAt: inBooth?.console ?? null,
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
    movables: movablesPx(plan, px),
    fromPx: C.fromPx,
    plan,
  };
}

export type ChurchGeom = ReturnType<typeof churchGeom>;

/** #255 fix: the narrowest a FOH mix box in a booth room gets (px) — room for "FOH". */
export const MIX_MIN_W = 26;
/** #255 fix: the width (px) the CONSOLE mark takes beside a FOH mix box ("CONSOLE" at 6 px). */
const CONSOLE_SIDE_W = 26;
/** #255 fix: a loudspeaker glyph's centre stays this far (px) from the edges of the room it stands in — its half-diagonal plus 0.5. */
export const SPK_CLEAR = Math.hypot(5, 7) + 0.5;

/** The nearest point to `p` (rings every 0.5 px, 5° apart, out to 80 px) inside `poly` and `clear` px from its edges; `p` when none. */
function clearSpot(poly: XY[], p: XY, clear: number): XY {
  const ok = (q: XY) => inPoly(poly, q) && distToPoly(poly, q) >= clear;
  if (ok(p)) return p;
  for (let r = 0.5; r <= 80; r += 0.5)
    for (let k = 0; k < 72; k++) {
      const q = { x: R(p.x + r * Math.cos((k * 5 * Math.PI) / 180)), y: R(p.y + r * Math.sin((k * 5 * Math.PI) / 180)) };
      if (ok(q)) return q;
    }
  return p;
}

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
  const roomAt = (y: number) => (boothPoly ? rowSpans(boothPoly, y).reduce((w, [l, r]) => (l <= mix.x && r >= mix.x ? Math.min(mix.x - l, r - mix.x) * 2 : w), 0) : 0);
  let mixW = boothRoom ? Math.max(0, Math.min(boothRoom.w * 0.45, 86, roomAt(mix.y - 9) - 6)) : Math.min((naveR.x - naveL.x) * 0.3, 86);
  // The CONSOLE mark (when on): its bar's centre x and top y — under the box by default (bar 3 px below it, the word 11 px under the bar).
  let consoleSide = false, mixH = 18;
  // The booth room's own label (drawn low in the room), padded — the box and the CONSOLE mark keep off it.
  const lab = boothPoly ? C.labels.find((l) => inPoly(boothPoly, { x: l.x + (l.text.length * LABEL_CHAR_PX) / 2, y: l.y + l.h - 3 })) : undefined;
  const labBox = lab ? { x0: lab.x - 3, x1: lab.x + lab.text.length * LABEL_CHAR_PX + 3, y0: lab.y + lab.h - 7, y1: lab.y + lab.h + 2 } : null;
  const onLabel = (x0: number, x1: number, y0: number, y1: number) => !!labBox && x0 < labBox.x1 && x1 > labBox.x0 && y0 < labBox.y1 && y1 > labBox.y0;
  if (boothRoom && (mixW < MIX_MIN_W || onLabel(mix.x - Math.max(mixW, 30) / 2, mix.x + Math.max(mixW, 30) / 2, mix.y - 9, mix.y + 9 + (consoleOn ? 16 : 0)))) {
    // #255 fix: the booth is too narrow at that height, or the box would sit on the room's label (a short nave,
    // perhaps under a wide one: a flat, wide triangle). The box moves to the height where the room is widest for
    // it — centred in the room across the rows it spans, beside the label on the label's rows — never narrower
    // than MIX_MIN_W, trying in turn: 18 px tall with the CONSOLE mark under it; 18 px with the mark beside it
    // (CONSOLE_SIDE_W + 4 px more width); 12 px with the mark beside it. Nothing clear of the label: the usual
    // spot if it was wide enough; else the same tiers over the label, then 12 px alone with the mark under it and
    // past the room (a nave 20–30' deep). A booth too small even for that (a 20' nave ~170' wider than the
    // platform) keeps the minimum 12-px box at its roomiest height — the only case the box leaves the room.
    const want = Math.max(MIX_MIN_W, Math.min(boothRoom.w * 0.45, 86));
    const runAt = (y: number) => rowSpans(boothPoly!, y).reduce((b, r) => (r[1] - r[0] > b[1] - b[0] ? r : b), [0, 0]);
    const place = (hh: number, under: number, extra: number, avoid = true) => {
      let best = { x: mix.x, y: mix.y, w: -Infinity, hh, side: extra > 0 };
      for (let y = boothRoom.y + hh; y <= boothRoom.y + boothRoom.h - hh - under + 1e-9; y += 0.5) {
        const top = runAt(y - hh), bot = runAt(y + hh + under);
        let l = Math.max(top[0], bot[0]), r = Math.min(top[1], bot[1]);
        if (avoid && labBox && y - hh < labBox.y1 && y + hh + under > labBox.y0) {
          if (labBox.x0 - l >= r - labBox.x1) r = Math.min(r, labBox.x0);
          else l = Math.max(l, labBox.x1);
        }
        const w = Math.min(want, r - l - 6 - extra);
        if (w > best.w + 1e-9 || (Math.abs(w - best.w) <= 1e-9 && Math.abs(y - mix.y) < Math.abs(best.y - mix.y))) best = { ...best, x: (l + r) / 2, y, w };
      }
      return best;
    };
    const side = consoleOn ? CONSOLE_SIDE_W + 4 : 0;
    const tiers = (avoid: boolean) => (consoleOn ? [place(9, 16, 0, avoid), place(9, 0, side, avoid), place(6, 0, side, avoid)] : [place(9, 0, 0, avoid), place(6, 0, 0, avoid)]);
    const clear = tiers(true).find((t) => t.w >= MIX_MIN_W);
    const any = clear || mixW >= MIX_MIN_W ? [] : [...tiers(false), ...(consoleOn ? [place(6, 0, 0, false)] : [])];
    const best = clear ?? any.find((t) => t.w >= MIX_MIN_W) ?? any[any.length - 1];
    if (best) {
      if (best.w > -Infinity) Object.assign(mix, { x: R(best.x), y: R(best.y) });
      mixW = Math.max(MIX_MIN_W, best.w);
      mixH = 2 * best.hh;
      consoleSide = best.side;
      // Side by side: the row (box, 4 px, mark) centred in the room.
      if (consoleSide) mix.x = R(mix.x - side / 2);
    }
  }
  const mixBox: Box = { x: R(mix.x - mixW / 2), y: R(mix.y - mixH / 2), w: R(mixW), h: mixH };
  const mixText = boothRoom && mixW < 7 * LABEL_CHAR_PX + 4 ? "FOH" : "FOH MIX";
  const consoleAt = !consoleOn ? null : consoleSide ? { x: R(mixBox.x + mixBox.w + 4 + CONSOLE_SIDE_W / 2), y: R(mix.y - 5.5) } : { x: mixBox.x + mixBox.w / 2, y: mixBox.y + mixBox.h + 3 };
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
  // Where the loudspeakers stand, when the template says (else buildPlanChurch's Traditional notch rule). #255 fix:
  // the glyph (10 × 14 px) stays clear of the Nave's edges — the Platform's front and the splays — so a plan drawn
  // at a smaller scale moves the left one to the nearest spot that clears them, and mirrors it for the right.
  const speakers = keys.points.spkL && keys.points.spkR ? [clearSpot(regions[keys.roles.house], pt("spkL"), SPK_CLEAR)].flatMap((l) => [l, { x: R(2 * centre.x - l.x), y: l.y }]) : null;
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
    naveL, naveR, mix, mixBox, mixText, consoleAt, aisle, speakers,
    platform, nave, booth, stage: platform, stageBox, pews,
    regions, regionLabels: plan.regionLabels, spaces: keys.spaces, roles: keys.roles,
    polylines: C.polylines, labels: C.labels,
    handles: { sideL: pt("handleL"), sideR: pt("handleR"), back: pt("handleBack") },
    movables: movablesPx(plan, px),
    fromPx: C.fromPx,
    plan,
  };
}

export type BlackboxGeom = ReturnType<typeof blackboxGeom>;
/** A blackbox plan label: Jeff's (top-left anchor, "start"), or re-laid — `anchor: "middle"` puts x, y at its centre and baseline, `rotate` turns it −90° about that point. */
type BlackboxLabel = { text: string; x: number; y: number; h: number; anchor?: "middle"; rotate?: XY };

/**
 * Blackbox-family geometry (#255): Jeff's Blackbox drawing stretched to the
 * room's width/depth, its four rooms where the design put them. The
 * Conference kind shares it and adds a low platform across the front. The
 * FOH mix goes in the Booth room wherever it sits (boothMix, as the Gym Stage's).
 */
export function blackboxGeom(s: AState, tpl?: string | null) {
  const want = planTemplate(s, tpl);
  const id = want && templateEntry(want)?.family === "blackbox" ? want : "blackbox@1";
  const keys = keysById(id);
  const dims = blackboxDims(s);
  const plan = stretchById(id, dims);
  const C = canvasOf(plan, { W: 640, ML: 62, MR: 40, MT: 54, MB: 44 });
  const room = boxOf(C.regions[keys.roles.house]);
  const platW = room.w * 0.62, platH = Math.min(Math.max(s.depth * 0.16, 6) * C.ppf, room.h * 0.3);
  const platform: Box = { x: R(room.x + (room.w - platW) / 2), y: room.y, w: R(platW), h: R(platH) };
  const boothPoly = keys.roles.booth ? C.regions[keys.roles.booth] : undefined;
  const booth = boothPoly ? boxOf(boothPoly) : room;
  const mix = boothPoly ? boothMix(boothPoly, C.labels, !!(s.sys && s.sys.controls && s.ctrl && s.ctrl.console), room) : null;
  const moved = mix?.label;
  // Labels keep Jeff's top-left anchor ("start") unless re-laid: every other room's label centred in its room — turned
  // to read along the room when the room is too narrow for it across (a Storage on a side wall) — and the main room's
  // label (houseLabel) placed by each builder clear of what it draws.
  const labels: BlackboxLabel[] = C.labels.map((l, i) => (moved && i === moved.i ? { ...l, x: moved.x, y: moved.y } : { ...l }));
  const inBox = (b: Box, l: { x: number; y: number }) => l.x >= b.x - 0.5 && l.x <= b.x + b.w + 0.5 && l.y >= b.y - 0.5 && l.y <= b.y + b.h + 0.5;
  for (const m of keys.movables ?? []) {
    if (m.region === keys.roles.booth || !C.regions[m.region]) continue;
    const b = boxOf(C.regions[m.region]);
    const i = C.labels.findIndex((l) => inBox(b, l));
    if (i < 0) continue;
    const w = labels[i].text.length * LABEL_CHAR_PX, cx = R(b.x + b.w / 2), cy = R(b.y + b.h / 2);
    const turn = w > b.w - 8 && b.h > b.w;
    labels[i] = { ...labels[i], x: cx, y: R(cy + 3), anchor: "middle", ...(turn ? { rotate: { x: cx, y: cy } } : {}) };
  }
  const houseLabel = C.labels.findIndex((l) => l.text === plan.regionLabels[keys.roles.house] && inBox(room, l));
  return {
    template: id, W: C.W, H: C.H, ppi: C.ppi, ppf: C.ppf, dims, room, platform, booth, mix,
    regions: C.regions, regionLabels: plan.regionLabels, spaces: keys.spaces, roles: keys.roles,
    polylines: C.polylines, labels, houseLabel, movables: movablesPx(plan, C.px), fromPx: C.fromPx, plan,
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
  if (G.mixInBooth) mixPos(L, G.mix.x, G.yMix, G.mixBox.w, G.mixText, G.mixBox.h / 2);
  else mixPos(L, G.mix.x, G.yMix, Math.min(openW * 0.3, 86), G.mixText);
  if (G.mixInBooth) {
    // #255: in (or by) the booth that carries the FOH mix — under the box, or beside it (boothMix).
    const c = G.consoleAt, cw = Math.min(R(G.mixBox.w * 0.38), 22);
    if (c) rects.push({ x: R(c.x - cw / 2), y: R(c.y), w: cw, h: 4.5, fill: SYSCOLOR.controls, stroke: "none", sw: 0, rx: 1.5, dash: "" });
    if (c) texts.push({ x: R(c.x), y: R(c.y + 11), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
  } else if (s.sys && s.sys.controls && s.ctrl && s.ctrl.console) {
    const bx = G.booth, cw = Math.min(R(bx.w * 0.38), 30), bcx = bx.x + bx.w / 2;
    rects.push({ x: R(bcx - cw / 2), y: R(bx.y + 6), w: cw, h: 4.5, fill: SYSCOLOR.controls, stroke: "none", sw: 0, rx: 1.5, dash: "" });
    texts.push({ x: R(bcx), y: R(bx.y + bx.h - 6), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
  }

  // #255: each movable room (the Gym Stage Booth) drags along the walls it may use — listed first, so the wall
  // handles (drawn after, on top) win wherever the two overlap.
  handles.push(...movableHandles(G.movables));
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
  texts.push({ x: R(cx), y: R(yWid - 6), t: s.width + "'-0\"", fill: "#8c919c", size: 11, anchor: "middle", transform: "" });
  if (wing > 0) {
    ([[xWingL, xProcL], [xProcR, xWingR]] as Array<[number, number]>).forEach(([a, b]) => {
      lines.push({ x1: R(a), y1: R(yWid), x2: R(b), y2: R(yWid), stroke: "#c4c9d2", sw: 0.9, dash: "" });
      tick(a, yWid);
      tick(b, yWid);
      texts.push({ x: R((a + b) / 2), y: R(yWid - 6), t: wing + "'", fill: "#8c919c", size: 11, anchor: "middle", transform: "" });
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
  vDim(yBack, yPlaster, s.depth + "'-0\"");
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

/** Conference center (#255): the Blackbox drawing (Jeff: Blackbox and Convention Center share) with the low platform at the front, seating facing it. */
function buildPlanFlat(s: AState, _lineSets: number, _electrics: number, accent: string, tpl?: string | null): PlanData {
  const G = blackboxGeom(s, tpl);
  const x0 = G.room.x, x1 = G.room.x + G.room.w, y0 = G.room.y, y1 = G.room.y + G.room.h, cx = (x0 + x1) / 2;
  const P = G.platform, platW = P.w, px0 = P.x, px1 = P.x + P.w, pBot = P.y + P.h;
  // The room's label: centred just above the seats (under the FOH lighting bar when there is one).
  const { L, handles } = blackboxBase(G, s, { x: cx, y: pBot + (s.sys.lighting ? 34 : 18) });
  L.rects.push({ x: P.x, y: P.y, w: P.w, h: P.h, fill: "#ffffff", stroke: accent, sw: 1.6, rx: 2, dash: "" });
  L.texts.push({ x: R(cx), y: R(P.y + P.h / 2 + 3), t: "PLATFORM", fill: "#9aa0ab", size: 8, anchor: "middle", transform: "" });
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
  dimH(L, x0, x1, 54 - 26, s.width + "'-0\"", false);
  dimV(L, y0, y1, 62 - 32, s.depth + "'-0\"");
  return { W: G.W, H: G.H, ...L, handles };
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
  mixPos(L, G.mix.x, G.mix.y, G.mixBox.w, G.mixText, G.mixBox.h / 2);
  if (G.consoleAt) {
    // Under the FOH mix box — in the Nave, or in the booth room when the template has one (#255 fix: beside it in a booth too shallow for both).
    const cw = Math.min(R(G.mixBox.w * 0.38), 30), c = G.consoleAt;
    L.paths.push({ d: box(c.x - cw / 2, c.y, cw, 4.5), fill: SYSCOLOR.controls, stroke: "none" });
    L.texts.push({ x: R(c.x), y: R(c.y + 11), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
  }
  // #255: each movable room drags along the walls it may use — listed before the wall handles, so the walls win overlaps.
  handles.push(...movableHandles(G.movables));
  // #255: drag handles — each side wall sets nave width, the back wall nave depth
  handles.push({ type: "wall", side: "L", cx: G.handles.sideL.x, cy: G.handles.sideL.y, shape: "wall" });
  handles.push({ type: "wall", side: "R", cx: G.handles.sideR.x, cy: G.handles.sideR.y, shape: "wall" });
  handles.push({ type: "wall", side: "B", cx: G.handles.back.x, cy: G.handles.back.y, shape: "backWall" });
  dimH(L, G.platBackL.x, G.platBackR.x, G.yTop - 26, s.width + "'-0\"", false);
  // #255 fix: a platform the drawing shortened (Contemporary's depth limit) prints the depth it draws.
  const platDepth = G.dims.stageDepthFt < s.depth ? Math.floor(Math.round(G.dims.stageDepthFt * 12) / 12) + "'-" + (Math.round(G.dims.stageDepthFt * 12) % 12) + '"' : s.depth + "'-0\"";
  dimV(L, G.yBack, G.yFront, G.xMin - 32, platDepth);
  dimV(L, G.yFront, G.yNaveBack, G.xMin - 32, Math.round(G.dims.houseDepthFt) + "'-0\"");
  dimH(L, G.naveL.x, G.naveR.x, G.H - 18, Math.round(G.dims.houseWidthFt) + "'-0\"", false);
  return { W: G.W, H: G.H, ...L, handles };
}

/**
 * The drawing itself under a blackbox-family plan: the room's floor (the first rect, so the marks drawn as rects
 * paint over it), the lines, labels, the FOH mix in the Booth room and the rooms' drag handles.
 */
function blackboxBase(G: BlackboxGeom, s: AState, houseLabelAt: XY): { L: L; handles: PlanHandle[] } {
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  const trace = (pts: XY[]) => pts.map((p, i) => (i ? "L " : "M ") + p.x + " " + p.y).join(" ");
  L.rects.push({ x: R(G.room.x), y: R(G.room.y), w: R(G.room.w), h: R(G.room.h), fill: "#f6f7f9", stroke: "none", sw: 0, dash: "" });
  L.paths.push({ d: G.polylines.map(trace).join(" "), fill: "none", stroke: "#3a3f4a", sw: 0.9 });
  G.labels.forEach((l, i) => {
    const t = { t: l.text, fill: "#737985", size: 8, weight: 600 };
    if (i === G.houseLabel) L.texts.push({ ...t, x: R(houseLabelAt.x), y: R(houseLabelAt.y), anchor: "middle", transform: "" });
    else if (l.anchor === "middle") L.texts.push({ ...t, x: l.x, y: l.y, anchor: "middle", transform: l.rotate ? "rotate(-90 " + l.rotate.x + " " + l.rotate.y + ")" : "" });
    else L.texts.push({ ...t, x: l.x, y: R(l.y + l.h), anchor: "start", transform: "" });
  });
  if (G.mix) {
    mixPos(L, G.mix.x, G.mix.y, G.mix.w, G.mix.text, G.mix.h / 2);
    const c = G.mix.console, cw = Math.min(R(G.mix.w * 0.38), 22);
    if (c && s.sys) {
      L.rects.push({ x: R(c.x - cw / 2), y: R(c.y), w: cw, h: 4.5, fill: SYSCOLOR.controls, stroke: "none", sw: 0, rx: 1.5, dash: "" });
      L.texts.push({ x: R(c.x), y: R(c.y + 11), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
    }
  }
  return { L, handles: movableHandles(G.movables) };
}

/** Black box (#255): Jeff's Blackbox drawing; tension grid, perimeter masking, riser blocks, lighting, movable seating inside the room. */
function buildPlanBlackbox(s: AState, _lineSets: number, _electrics: number, accent: string, tpl?: string | null): PlanData {
  const G = blackboxGeom(s, tpl);
  const x0 = G.room.x, x1 = G.room.x + G.room.w, y0 = G.room.y, depthPx = G.room.h, y1 = y0 + depthPx, cx = (x0 + x1) / 2, ppf = G.ppf;
  const bW = (x1 - x0) * 0.5, bH = depthPx * 0.26, bx0 = cx - bW / 2, by0 = y0 + depthPx * 0.15, cellW = bW / 4, cellH = bH / 2;
  // The room's label: centred in the 30-px band between the riser blocks and the seats.
  const { L, handles } = blackboxBase(G, s, { x: cx, y: by0 + bH + 18 });
  const stepPx = Math.max(18, 8 * ppf);
  for (let x = x0 + stepPx; x < x1 - 2; x += stepPx) L.lines.push({ x1: R(x), y1: R(y0), x2: R(x), y2: R(y1), stroke: "#eceef1", sw: 0.8, dash: "" });
  for (let y = y0 + stepPx; y < y1 - 2; y += stepPx) L.lines.push({ x1: R(x0), y1: R(y), x2: R(x1), y2: R(y), stroke: "#eceef1", sw: 0.8, dash: "" });
  L.texts.push({ x: R(x1 - 6), y: R(y0 + 13), t: "TENSION GRID", fill: "#c4c9d2", size: 7.5, anchor: "end", transform: "" });
  if (s.sys.curtains) L.rects.push({ x: R(x0 + 10), y: R(y0 + 10), w: R(x1 - x0 - 20), h: R(depthPx - 20), fill: "none", stroke: SYSCOLOR.curtains, sw: 1.6, rx: 1, dash: "5 4" });
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
  dimH(L, x0, x1, 54 - 26, s.width + "'-0\"", false);
  dimV(L, y0, y1, 62 - 32, s.depth + "'-0\"");
  return { W: G.W, H: G.H, ...L, handles };
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
  // Proscenium, church, blackbox and flat kinds always resolve a template (planTemplate), so every kind below draws its built-in schematic.
  const id = planTemplate(s, tpl);
  const family = templateEntry(id)?.family;
  let p: PlanData;
  if (family === "church") p = buildPlanChurch(s, lineSets, electrics, accent, id);
  else if (family === "proscenium") p = buildPlanProscenium(s, lineSets, electrics, accent, id);
  else if (family === "blackbox") p = kind === "flat" ? buildPlanFlat(s, lineSets, electrics, accent, id) : buildPlanBlackbox(s, lineSets, electrics, accent, id);
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
              style={{ cursor: hd.shape === "movable" ? "move" : hd.shape === "wall" ? "ew-resize" : "ns-resize", touchAction: "none", pointerEvents: "auto" }}
              onPointerDown={(e) => onHandleDown && onHandleDown(hd, e)}
            >
              <circle cx={hd.cx} cy={hd.cy} r={13} fill="transparent" />
              {hd.shape === "movable" ? (
                <>
                  <rect x={hd.cx - 8} y={hd.cy - 8} width={16} height={16} rx={4} fill={accent} stroke="#fff" strokeWidth={1.6} />
                  <line x1={hd.cx - 4} y1={hd.cy} x2={hd.cx + 4} y2={hd.cy} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                  <line x1={hd.cx} y1={hd.cy - 4} x2={hd.cx} y2={hd.cy + 4} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                </>
              ) : hd.shape === "wall" ? (
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
 * the typed fields. A movable room's handle (#255) moves that room: the
 * dropped centre snaps to the nearest wall it may use, whole feet along it.
 */
export function houseDragPatch(s: AState, hd: PlanHandle, pos: DragPos, tpl?: string | null): Partial<AState> | null {
  if (hd.type !== "wall" && hd.type !== "movable") return null;
  const id = planTemplate(s, tpl);
  const family = templateEntry(id)?.family;
  if (family !== "proscenium" && family !== "church" && family !== "blackbox") return null;
  const G = family === "church" ? churchGeom(s, id) : family === "blackbox" ? blackboxGeom(s, id) : prosGeom(s, id);
  if (hd.type === "movable") {
    // #255: a room follows the pointer (relative drag, drag-start scale) and snaps to the nearest wall it may use, whole
    // feet. The handle sits on the room's outer face; the room's centre is what moves by the drag.
    const m = G.movables.find((x) => x.id === hd.key);
    if (!m) return null;
    const snap = snapMovable(G.plan, hd.key, G.fromPx({ x: m.centre.x + pos.dx, y: m.centre.y + pos.dy }));
    return snap ? movablePatch(s, hd.key, snap) : null;
  }
  // A blackbox-family plan has no wall handles (width/depth are the room's own fields).
  if (family === "blackbox") return null;
  if (hd.side === "B") {
    const [lo, hi] = houseSpecFor(G.template).depthLim;
    return { houseDepthFt: Math.round(clamp(G.dims.houseDepthFt + pos.dy / G.ppf, lo, hi)) };
  }
  const [lo, hi] = houseWidthLim(s, G.template);
  const dir = hd.side === "L" ? -1 : 1;
  return { houseWidthFt: Math.round(clamp(G.dims.houseWidthFt + (2 * dir * pos.dx) / G.ppf, lo, hi)) };
}

export type { SysKey };
