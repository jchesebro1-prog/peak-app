// src/lib/design/room-shape/frame.ts
import { rowSpans } from "../venue-templates/canvas";
import { bounds, centroid, edgeLength, outlinePoints, sampleEdge } from "./geometry";
import type { RoomShape, ShapePt, ShapeRoom } from "./types";

export type FtBox = { minX: number; minY: number; maxX: number; maxY: number };
export type ShapeRoles = {
  stage: FtBox;
  house: FtBox;
  booth: FtBox;
  catwalk: FtBox | null;
  /** The House's open lip run facing the stage, clipped to the stage's opening (proscenium lip), feet; null when none. */
  stageEdge: ShapePt[] | null;
  sameStageHouse: boolean;
  /** Arena: the stage room's centre, its along / depth (feet) and the unit direction it faces (stage → house centroid). */
  stageCentre: ShapePt;
  stageAlongFt: number;
  stageDepthFt: number;
  facing: ShapePt;
};

const boxOf = (r: ShapeRoom): FtBox => bounds(outlinePoints(r, 0.5, 32));

/**
 * The House's open lip facing the stage, as sampled points: the whole run of consecutive open edges nearest the
 * stage centroid (a lip is often split across several arcs and lines, and the outer pieces are far from the
 * centroid). The stage's own open edges say where the opening ends, so the run is clipped to their x-span; the
 * House's open side walls beside the wings fall outside it. With no open stage edge the run is returned whole.
 */
function openRunFacing(house: ShapeRoom, stage: ShapeRoom, toward: ShapePt): ShapePt[] | null {
  const n = house.pts.length;
  const open = new Set(house.edges.map((e, i) => (e.open ? i : -1)).filter((i) => i >= 0));
  if (!open.size) return null;
  const samples = (i: number) => sampleEdge(house.pts[i], house.pts[(i + 1) % n], house.edges[i], 0.5, 64);
  const d = (i: number) => Math.min(...samples(i).map((p) => Math.hypot(p.x - toward.x, p.y - toward.y)));
  // runs of consecutive open edges (cyclic), each started at an edge whose predecessor isn't open
  const starts = [...open].filter((i) => !open.has((i + n - 1) % n));
  const runs = (starts.length ? starts : [Math.min(...open)]).map((s) => {
    const run = [s];
    for (let i = (s + 1) % n; open.has(i) && i !== s; i = (i + 1) % n) run.push(i);
    return run;
  });
  const near = (r: number[]) => Math.min(...r.map(d));
  const run = runs.reduce((best, r) => (near(r) < near(best) ? r : best));
  const pts = run.flatMap((i) => [...samples(i), house.pts[(i + 1) % n]]);
  const m = stage.pts.length;
  const span = stage.edges.flatMap((e, i) => (e.open ? sampleEdge(stage.pts[i], stage.pts[(i + 1) % m], e, 0.5, 64).concat(stage.pts[(i + 1) % m]) : [])).map((q) => q.x);
  const lo = Math.min(...span) - 0.05, hi = Math.max(...span) + 0.05;
  const clipped = span.length ? pts.filter((p) => p.x >= lo && p.x <= hi) : pts;
  return clipped.length > 1 ? clipped : null;
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
    stageEdge: stage === house ? null : openRunFacing(house, stage, sc),
    sameStageHouse: stage === house,
    stageCentre: sc,
    stageAlongFt: along,
    stageDepthFt: depth,
    facing,
  };
}

/**
 * #370: a church's Auto-fill frame on a shape (the template branch's churchGeom, in feet). `stage` is the Platform's CORE,
 * never its whole bounding box: the box under the platform's back wall (its top-most run), as wide as that wall, running
 * down while the Platform still covers it — Traditional's chancel (its front step is wider), Contemporary's core above the
 * pointed front. `mix` is the FOH mix box when no Booth room holds it: centred on the House, 62% of its depth down, as
 * wide as churchGeom's (30% of the House, at most 86 plan pixels) and 18 pixels tall, a pixel being 1 ÷ the plan's
 * 538-pixel scale across the rooms. null without a Stage or House room, or when one room is both.
 */
export function churchRoleBoxes(shape: RoomShape): { stage: FtBox; mix: FtBox | null } | null {
  const R = shapeRoleBoxes(shape);
  const stageRoom = shape.rooms.find((r) => (r.roles as string[]).includes("stage"));
  if (!R || !stageRoom || R.sameStageHouse) return null;
  const poly = outlinePoints(stageRoom, 0.5, 32);
  const sb = bounds(poly);
  const back = poly.filter((p) => p.y <= sb.minY + 0.05);
  const left = Math.min(...back.map((p) => p.x)), right = Math.max(...back.map((p) => p.x));
  const covers = (y: number) => rowSpans(poly, y).some(([l, r]) => l <= left + 0.15 && r >= right - 0.15);
  let yStage = sb.minY;
  for (let y = sb.minY + 0.1; y <= sb.maxY - 0.1 && covers(y); y += 0.1) yStage = y;
  if (yStage >= sb.maxY - 0.2) yStage = sb.maxY;
  let mix: FtBox | null = null;
  if (!shape.rooms.some((r) => (r.roles as string[]).includes("booth"))) {
    const all = bounds(shape.rooms.flatMap((r) => outlinePoints(r, 0.5, 32)));
    const px = Math.max(all.maxX - all.minX, 1) / 538;
    const w = Math.min((R.house.maxX - R.house.minX) * 0.3, 86 * px), h = 18 * px;
    const cx = (R.house.minX + R.house.maxX) / 2, cy = R.house.minY + 0.62 * (R.house.maxY - R.house.minY);
    mix = { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 };
  }
  return { stage: { minX: left, maxX: right, minY: sb.minY, maxY: yStage }, mix };
}
