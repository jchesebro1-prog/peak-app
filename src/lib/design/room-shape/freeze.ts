// src/lib/design/room-shape/freeze.ts
import { VENUES, type AState } from "@/app/(app)/design/quick/engine";
import { templateEntry } from "@/lib/design/venue-templates";
import { familyDims } from "@/lib/design/venue-templates/house-dims";
import { numberedRegionLabels } from "@/lib/design/venue-templates/movable-options";
import { keysById, stretchById } from "@/lib/design/venue-templates/templates";
import type { Pt } from "@/lib/design/venue-templates/types";
import { fitOutline } from "./fit";
import { bounds, edgeLength, outlinePoints, splitEdge, withOpen } from "./geometry";
import { ROOM_ROLES, SHAPE_LIMITS, type RoomRole, type RoomShape, type RoomTypeKey, type ShapeEdge, type ShapePt, type ShapeRoom } from "./types";
import { SegIndex, splitByWalls, walledShare, type Seg, type WallRule } from "./walls";

/** #370: per-template freeze hints — how walls are drawn, and regions that are always zones. */
export const FREEZE_HINTS: Readonly<Record<string, { wallRule: WallRule; zones?: readonly string[] }>> = {
  // Jeff's arena drawing is all single lines; its floor and court are areas, not rooms.
  "arena@1": { wallRule: "single", zones: ["Arena Floor", "Court", "Stage"] },
};

/** A room whose walled share is under this freezes as a zone (Amendment A: the Catwalk, the Center Aisle). */
const ZONE_BELOW = 0.25;

const LABEL_TYPES: ReadonlyArray<[RegExp, RoomTypeKey]> = [
  [/^pit\b/i, "pit"], [/catwalk/i, "catwalk"], [/booth/i, "booth"], [/electrical/i, "electrical"], [/green room/i, "green"],
  [/choir/i, "choir"], [/storage/i, "storage"], [/dressing/i, "dressing"], [/lobby|entry/i, "lobby"], [/hall|aisle/i, "hallway"],
  [/music/i, "music"], [/office/i, "office"],
];

function typeFor(name: string, roles: readonly RoomRole[]): RoomTypeKey {
  if (roles.includes("house")) return "house";
  if (roles.includes("stage")) return "stage";
  if (roles.includes("booth")) return "booth";
  if (roles.includes("catwalk")) return "catwalk";
  for (const [re, t] of LABEL_TYPES) if (re.test(name)) return t;
  return "other";
}

/** FNV-1a, 8 hex. */
export function fnv8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const roomIdFor = (tplId: string, regionId: string): string => `rm_${fnv8(`${tplId}:${regionId}`)}`;

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const stripOpen = (e: ShapeEdge): ShapeEdge => withOpen(e, false);

/** The Conference's code-drawn platform (blackboxGeom): 62 % of the room's width, at its stage end. */
function platformFor(house: ShapeRoom, a: AState, tplId: string): ShapeRoom {
  const b = bounds(outlinePoints(house));
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const pw = w * 0.62, pd = Math.min(Math.max(a.depth * 0.16, 6), h * 0.3);
  const x0 = b.minX + (w - pw) / 2, y0 = b.minY;
  const pts: ShapePt[] = [{ x: x0, y: y0 }, { x: x0 + pw, y: y0 }, { x: x0 + pw, y: y0 + pd }, { x: x0, y: y0 + pd }].map((p) => ({ x: r6(p.x), y: r6(p.y) }));
  return { id: roomIdFor(tplId, "platform"), type: "stage", name: "Platform", kind: "zone", roles: ["stage"], pts, edges: pts.map(() => ({ kind: "line" as const })) };
}

/** A fit that takes the first of 1", 2", 4", 8" tolerances giving ≤ 64 corners (the last is kept regardless), then splits walls, then pads a 2-corner outline up to 3 corners. */
const FIT_TOLS_FT = [1 / 12, 2 / 12, 4 / 12, 8 / 12] as const;
function fitRoom(raw: ShapePt[], idx: SegIndex, rule: WallRule, forcedZone: boolean): { pts: ShapePt[]; edges: ShapeEdge[] } | null {
  let geom: { pts: ShapePt[]; edges: ShapeEdge[] } | null = null;
  for (const tol of FIT_TOLS_FT) {
    const fitted = fitOutline(raw, tol);
    if (fitted.pts.length < 2) return null;
    geom = forcedZone ? fitted : splitByWalls(fitted.pts, fitted.edges, idx, rule);
    if (geom.pts.length <= SHAPE_LIMITS.pts) break;
  }
  if (!geom) return null;
  let pts = geom.pts.slice(), edges = geom.edges.slice();
  // a full circle fits as two arcs; a room needs at least three corners
  while (pts.length < SHAPE_LIMITS.minPts && pts.length >= 2) {
    let k = 0, best = -1;
    for (let i = 0; i < pts.length; i++) {
      const L = edgeLength(pts[i], pts[(i + 1) % pts.length], edges[i]);
      if (L > best) { best = L; k = i; }
    }
    const s = splitEdge(pts[k], pts[(k + 1) % pts.length], edges[k], 0.5);
    pts = [...pts.slice(0, k + 1), s.at, ...pts.slice(k + 1)];
    edges = [...edges.slice(0, k), s.first, s.second, ...edges.slice(k + 1)];
  }
  return pts.length >= SHAPE_LIMITS.minPts ? { pts, edges } : null;
}

/**
 * #370: the stretched template as a RoomShape — one room per region in the keys' Space order (exactly today's
 * starter Spaces), outlines fitted to lines and arcs, each edge walled or open by the drawing's own linework
 * (Amendment A), roles copied from the keys. Pure and deterministic.
 */
export function freezeFromTemplate(a: AState, tplId: string, stamp: { by: string; at: number }): RoomShape {
  const keys = keysById(tplId);
  const plan = stretchById(tplId, familyDims(a, tplId));
  const O = plan.map({ x: keys.cx, y: keys.origin });
  const toFt = (p: Pt): ShapePt => ({ x: r6((p.x - O.x) / 12), y: r6((O.y - p.y) / 12) });
  const segs: Seg[] = plan.polylines.flatMap((l) => l.slice(1).map((q, i) => [toFt(l[i]), toFt(q)] as Seg));
  const idx = new SegIndex(segs);
  const hint = FREEZE_HINTS[tplId] ?? { wallRule: "double" as const };
  const names = numberedRegionLabels(plan.regionLabels, Object.keys(keys.regions));
  const flat = (VENUES.find((v) => v.key === a.venue) || VENUES[0]).kind === "flat" && templateEntry(tplId)?.family === "blackbox";
  const rooms: ShapeRoom[] = [];
  for (const rid of keys.spaces) {
    const raw = plan.regions[rid];
    if (!raw || raw.length < 3) continue;
    const forcedZone = hint.zones?.includes(rid) ?? false;
    const geom = fitRoom(raw.map(toFt), idx, hint.wallRule, forcedZone);
    if (!geom) continue;
    const zone = forcedZone || walledShare(geom) < ZONE_BELOW;
    const roles = ROOM_ROLES.filter((r) => (keys.roles as Partial<Record<RoomRole, string>>)[r] === rid);
    const isHouse = rid === keys.roles.house;
    const name = flat && isHouse ? "Conference Room" : names[rid] ?? rid;
    rooms.push({
      id: roomIdFor(tplId, rid),
      type: typeFor(name, roles),
      name,
      kind: zone ? "zone" : "room",
      roles: flat ? roles.filter((r) => r !== "stage") : roles,
      pts: geom.pts.map((p) => ({ x: r6(p.x), y: r6(p.y) })),
      edges: zone ? geom.edges.map(stripOpen) : geom.edges,
    });
  }
  if (flat) {
    const house = rooms.find((r) => r.roles.includes("house"));
    if (house) rooms.push(platformFor(house, a, tplId));
  }
  return { v: 1, fromTemplate: tplId, rooms, frozenAt: stamp.at, by: stamp.by };
}
