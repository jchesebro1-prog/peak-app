// src/lib/design/room-shape/frame.ts
import { CHURCH_PLAN_W_PX, rowSpans } from "../venue-templates/canvas";
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
 * #370: a church core narrower or shallower than this share of the Platform's bounding box is degenerate; the whole box
 * stands in. The unedited templates' cores are at least 0.42 wide and 0.55 deep across the 36-size sweep (Contemporary's
 * pointed front is the narrowest); an edit that broke the old flat-back scan gave 0.0 to 0.03.
 */
export const CHURCH_CORE_MIN_FRAC = 0.3;
/** The core scan's row budget: at most this many `rowSpans` calls per scan, however tall the Platform. */
const CORE_ROWS = 400;

/**
 * The Platform's core, in feet: the box under its back wall, as wide as that wall, running down while the Platform still
 * covers it, and always inside the Platform. A flat back wall (the templates') is its topmost run: the box starts there,
 * exact. A slanted, arced or free-form one, or one with extra points, has no such run, so the wall's width is read at the
 * widest row in a band just under the top (the rows' outer ends, so an arc dipping into the Platform still counts) and the
 * box starts at the first row that one run covers, so a lowered or dipping corner moves the box's top down with it.
 * null when neither is a sensible core (under CHURCH_CORE_MIN_FRAC of the bounding box either way).
 */
function churchCore(poly: ShapePt[], sb: FtBox): FtBox | null {
  const W = sb.maxX - sb.minX, H = sb.maxY - sb.minY;
  const step = Math.max(0.1, H / CORE_ROWS);
  const sensible = (b: FtBox) => b.maxX - b.minX >= CHURCH_CORE_MIN_FRAC * W && b.maxY - b.minY >= CHURCH_CORE_MIN_FRAC * H;
  // The rows from the first that one run covers [left, right] to the last of that unbroken stretch.
  const run = (left: number, right: number): FtBox => {
    const covers = (y: number) => rowSpans(poly, y).some(([l, r]) => l <= left + 0.15 && r >= right - 0.15);
    let first: number | null = null, last = sb.minY;
    for (let y = sb.minY + step; y <= sb.maxY - step; y += step) {
      if (covers(y)) { first ??= y; last = y; } else if (first !== null) break;
    }
    const top = first === null || first <= sb.minY + 1.5 * step ? sb.minY : first;
    return { minX: left, maxX: right, minY: top, maxY: first === null ? top : last >= sb.maxY - Math.max(0.2, 2 * step) ? sb.maxY : last };
  };
  // Flat back wall: every sample on the topmost row.
  const back = poly.filter((p) => p.y <= sb.minY + 0.05);
  const flat = run(Math.min(...back.map((p) => p.x)), Math.max(...back.map((p) => p.x)));
  if (sensible(flat)) return flat;
  // Otherwise: the widest row in the band just under the top.
  const band = Math.min(Math.max(0.12 * H, 0.5), 8);
  let widest: [number, number] | null = null;
  for (let y = sb.minY + step; y <= Math.min(sb.minY + band, sb.maxY - step); y += step) {
    const sp = rowSpans(poly, y);
    if (!sp.length) continue;
    const l = Math.min(...sp.map((q) => q[0])), r = Math.max(...sp.map((q) => q[1]));
    if (!widest || r - l > widest[1] - widest[0]) widest = [l, r];
  }
  const core = widest ? run(widest[0], widest[1]) : null;
  return core && sensible(core) ? core : null;
}

/**
 * #370: a church's Auto-fill frame on a shape (the template branch's churchGeom, in feet). `stage` is the Platform's CORE
 * (churchCore), never its whole bounding box on an unedited shape: Traditional's chancel (its front step is wider),
 * Contemporary's core above the pointed front. An edit that leaves no sensible core (a back wall slanted or arced so far
 * that it is under CHURCH_CORE_MIN_FRAC of the box) falls back to the Platform's bounding box, as before the core existed.
 * `mix` is the FOH mix box when no Booth room holds it: centred on the House, 62% of its depth down, as wide as
 * churchGeom's (30% of the House, at most 86 plan pixels) and 18 pixels tall (at most a quarter of the House), a pixel being the
 * plan's width ÷ CHURCH_PLAN_W_PX across the rooms; approximate once the shape is edited (the plan's width is then
 * whatever the rooms span). null without a Stage or House room, with one room both, or a Platform with no area.
 */
export function churchRoleBoxes(shape: RoomShape): { stage: FtBox; mix: FtBox | null } | null {
  const R = shapeRoleBoxes(shape);
  const stageRoom = shape.rooms.find((r) => (r.roles as string[]).includes("stage"));
  if (!R || !stageRoom || R.sameStageHouse) return null;
  const poly = outlinePoints(stageRoom, 0.5, 32);
  const sb = bounds(poly);
  if (![sb.minX, sb.minY, sb.maxX, sb.maxY].every(Number.isFinite) || sb.maxX - sb.minX <= 0 || sb.maxY - sb.minY <= 0) return null;
  let mix: FtBox | null = null;
  if (!shape.rooms.some((r) => (r.roles as string[]).includes("booth"))) {
    const all = bounds(shape.rooms.flatMap((r) => outlinePoints(r, 0.5, 32)));
    const px = Math.max(all.maxX - all.minX, 1) / CHURCH_PLAN_W_PX;
    const hh = R.house.maxY - R.house.minY;
    const w = Math.min((R.house.maxX - R.house.minX) * 0.3, 86 * px), h = Math.min(18 * px, 0.25 * hh);
    const cx = (R.house.minX + R.house.maxX) / 2, cy = R.house.minY + 0.62 * hh;
    mix = { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 };
  }
  return { stage: churchCore(poly, sb) ?? sb, mix };
}
