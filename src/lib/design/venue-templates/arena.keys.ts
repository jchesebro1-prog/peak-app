import type { PathItem, TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Arena background (#255 — docs/venue-templates/source/arena.dwg
 * → arena.json). Single lines, no wall thickness. Centre (6, 0). The two
 * outlines are drawn from these keys as true rounded rectangles (the drawing's
 * spline corners are neither circular nor symmetric): the floor's corner
 * radius ARENA_CORNER_R, the bowl's the same + bowl depth, one centre per
 * corner, so the bowl is an even band. Inputs (arenaDims): floor width and
 * length (houseWidthFt / houseDepthFt), bowl depth (bowlDepthFt), the end
 * stage's width/depth (width / depth). The Court keeps its share of the floor;
 * the Booth and Electrical Room move along the bowl's straight sides; the end
 * stage (drawn by code) moves along the floor's straight edges.
 *
 * Corner tangency: each corner centre sits exactly on a span boundary (the end
 * of the absorb span) and the corner zones are covered on both axes by the same
 * drawn lengths with the same drives — fixed 156 (the floor's radius), then
 * wing 180 (the bowl) — so X(cx + r) − X(cx) = Y(cy + r) − Y(cy) for every
 * input and a keep-sweep quarter circle stays tangent to both straight runs.
 * The drawing carries no arcs on those centres (its curves are splines), so
 * the outer corner is never pinned concentric at the drawn 180" offset.
 */
const CX = 6;
export const ARENA_CORNER_R = 156;
export const ARENA_COURT_SHARE = { x: 300 / 540, y: 564 / 804 };
const TR = { x: 390, y: 648 }, BR = { x: 390, y: -648 }, BL = { x: -378, y: -648 }, TL = { x: -378, y: 648 };
const ring = (r: number): PathItem[] => [
  { x: TL.x, y: TL.y + r }, { x: TR.x, y: TR.y + r },
  { arc: { cx: TR.x, cy: TR.y, r, from: 90, to: 0 } },
  { x: TR.x + r, y: BR.y },
  { arc: { cx: BR.x, cy: BR.y, r, from: 0, to: -90 } },
  { x: BL.x, y: BL.y - r },
  { arc: { cx: BL.x, cy: BL.y, r, from: 270, to: 180 } },
  { x: TL.x - r, y: TL.y },
  { arc: { cx: TL.x, cy: TL.y, r, from: 180, to: 90 } },
];
const closedLine = (r: number): PathItem[] => [...ring(r), { x: TL.x, y: TL.y + r }];
const OUTER = ["bottom", "right", "top", "left"];
const FLOOR = ["floorTop", "floorRight", "floorBottom", "floorLeft"];

export const ARENA_SPACES = ["Seating Bowl", "Arena Floor", "Court", "Stage", "Booth", "Electrical Room"] as const;

export const ARENA_KEYS: TemplateKeys = {
  kind: "arena",
  cx: CX,
  // Across (from x = 6): the court's half (pro = court width / 2), the floor's straight run (absorb → the corner centre),
  // the corner radius (fixed), the bowl (wing = bowl depth).
  x: { kind: "spans", spans: [{ to: 300, drive: "pro" }, { to: 384, drive: "absorb" }, { to: 540, drive: "fixed" }, { to: 720, drive: "wing" }] },
  // Along, mirrored about y = 0 the same way (pro = court length / 2, house = the straight run's half).
  yMap: { cy: 0, spans: [{ to: 564, drive: "pro" }, { to: 648, drive: "absorb" }, { to: 804, drive: "fixed" }, { to: 984, drive: "wing" }] },
  ySpans: [],
  origin: 0,
  stageDepthTo: 0,
  houseDepthTo: 0,
  regions: {
    "Seating Bowl": ring(ARENA_CORNER_R + 180),
    "Arena Floor": ring(ARENA_CORNER_R),
    Court: [{ x: -294, y: 564 }, { x: 306, y: 564 }, { x: 306, y: -564 }, { x: -294, y: -564 }],
    Booth: [{ x: -834, y: 268 }, { x: -714, y: 268 }, { x: -714, y: -268 }, { x: -834, y: -268 }],
    "Electrical Room": [{ x: 726, y: 268 }, { x: 846, y: 268 }, { x: 846, y: -268 }, { x: 726, y: -268 }],
  },
  spaces: [...ARENA_SPACES],
  roles: { stage: "Stage", house: "Arena Floor", booth: "Booth" },
  lines: { inner: closedLine(ARENA_CORNER_R), outer: closedLine(ARENA_CORNER_R + 180) },
  drawn: ["inner", "outer"],
  points: { centre: { x: CX, y: 0 } },
  requiredLabels: ["Seating Bowl", "Arena Floor", "Court", "Booth", "Electrical Room"],
  // The drawing's own size in arenaDims terms: court 50' × 94', straight runs 64' × 108', bowl 15'.
  defaults: { proWidthFt: 50, wingFt: 15, stageDepthFt: 94, houseWidthFt: 64, houseDepthFt: 108 },
  trueArcs: [{ centres: [TR, BR, BL, TL] }],
  movableWalls: {
    bottom: { from: { x: BL.x, y: -984 }, to: { x: BR.x, y: -984 } },
    right: { from: { x: 726, y: BR.y }, to: { x: 726, y: TR.y } },
    top: { from: { x: TR.x, y: 984 }, to: { x: TL.x, y: 984 } },
    left: { from: { x: -714, y: TL.y }, to: { x: -714, y: BL.y } },
    // The floor's straight edges, listed clockwise so an element sits INSIDE the floor.
    floorTop: { from: { x: TL.x, y: 804 }, to: { x: TR.x, y: 804 } },
    floorRight: { from: { x: 546, y: TR.y }, to: { x: 546, y: BR.y } },
    floorBottom: { from: { x: BR.x, y: -804 }, to: { x: BL.x, y: -804 } },
    floorLeft: { from: { x: -534, y: BL.y }, to: { x: -534, y: TL.y } },
  },
  movableWallLabels: { bottom: "Bottom end", right: "Right side", top: "Top end", left: "Left side", floorTop: "Top end", floorRight: "Right side", floorBottom: "Bottom end", floorLeft: "Left side" },
  movables: [
    { id: "booth", region: "Booth", bbox: { minX: -835, maxX: -713.5, minY: -269, maxY: 269 }, home: { wall: "left", anchor: { x: -714, y: 0 } }, walls: OUTER },
    { id: "electrical", region: "Electrical Room", bbox: { minX: 725.5, maxX: 847, minY: -269, maxY: 269 }, home: { wall: "right", anchor: { x: 726, y: 0 } }, walls: OUTER },
    { id: "stage", region: "Stage", sized: true, home: { wall: "floorTop", anchor: { x: CX, y: 804 } }, walls: FLOOR },
  ],
  movableGap: 24,
};
