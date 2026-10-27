// src/lib/design/room-shape/frame.ts
import { bounds, centroid, edgeLength, outlinePoints, sampleEdge } from "./geometry";
import type { RoomShape, ShapePt, ShapeRoom } from "./types";

export type FtBox = { minX: number; minY: number; maxX: number; maxY: number };
export type ShapeRoles = {
  stage: FtBox;
  house: FtBox;
  booth: FtBox;
  catwalk: FtBox | null;
  /** The House's open curved run facing the stage (proscenium lip), feet; null when none. */
  stageEdge: ShapePt[] | null;
  sameStageHouse: boolean;
  /** Arena: the stage room's centre, its along / depth (feet) and the unit direction it faces (stage → house centroid). */
  stageCentre: ShapePt;
  stageAlongFt: number;
  stageDepthFt: number;
  facing: ShapePt;
};

const boxOf = (r: ShapeRoom): FtBox => bounds(outlinePoints(r, 0.5, 32));

/** The House's open edges in a row, as sampled points; only its arcs / curves when it has any (the proscenium lip). */
function openRunFacing(house: ShapeRoom, toward: ShapePt): ShapePt[] | null {
  const n = house.pts.length;
  const open = house.edges.map((e, i) => (e.open ? i : -1)).filter((i) => i >= 0);
  if (!open.length) return null;
  const curved = open.filter((i) => house.edges[i].kind !== "line");
  const pick = curved.length ? curved : open;
  const d = (i: number) => {
    const m = sampleEdge(house.pts[i], house.pts[(i + 1) % n], house.edges[i], 0.5, 64);
    return Math.min(...m.map((p) => Math.hypot(p.x - toward.x, p.y - toward.y)));
  };
  const nearest = Math.min(...pick.map(d));
  const run = pick.filter((i) => d(i) <= nearest + 3).sort((x, y) => x - y);
  const pts = run.flatMap((i) => [...sampleEdge(house.pts[i], house.pts[(i + 1) % n], house.edges[i], 0.5, 64), house.pts[(i + 1) % n]]);
  return pts.length > 1 ? pts : null;
}

/** #370: the role rooms Auto fill lays out on, in feet. null when the shape has no Stage or House (sanitize refuses those). */
export function shapeRoleBoxes(shape: RoomShape): ShapeRoles | null {
  const byRole = (role: string) => shape.rooms.find((r) => (r.roles as string[]).includes(role)) ?? null;
  const stage = byRole("stage"), house = byRole("house");
  if (!stage || !house) return null;
  const hb = boxOf(house);
  const boothRoom = byRole("booth");
  // No Booth: an 8' × 6' box centred 6' in from the house's far end (the old FOH-mix stand-in).
  const cx = (hb.minX + hb.maxX) / 2;
  const booth: FtBox = boothRoom ? boxOf(boothRoom) : { minX: cx - 4, maxX: cx + 4, minY: hb.maxY - 9, maxY: hb.maxY - 3 };
  const catwalkRoom = byRole("catwalk");
  const sc = centroid(outlinePoints(stage, 0.5, 32)), hc = centroid(outlinePoints(house, 0.5, 32));
  const fl = Math.hypot(hc.x - sc.x, hc.y - sc.y);
  const facing = fl > 1e-6 ? { x: (hc.x - sc.x) / fl, y: (hc.y - sc.y) / fl } : { x: 0, y: 1 };
  const n = stage.pts.length;
  let along = 0;
  for (let i = 0; i < n; i++) along = Math.max(along, edgeLength(stage.pts[i], stage.pts[(i + 1) % n], stage.edges[i]));
  const sb = boxOf(stage);
  const depth = Math.max(0, Math.abs(facing.x) > Math.abs(facing.y) ? sb.maxX - sb.minX : sb.maxY - sb.minY);
  return {
    stage: sb,
    house: hb,
    booth,
    catwalk: catwalkRoom ? boxOf(catwalkRoom) : null,
    stageEdge: stage === house ? null : openRunFacing(house, sc),
    sameStageHouse: stage === house,
    stageCentre: sc,
    stageAlongFt: along,
    stageDepthFt: depth,
    facing,
  };
}
