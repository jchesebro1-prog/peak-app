// src/lib/design/room-shape/walls.ts
import { dist, dot, edgeAt, edgeLength, outlinePoints, outwardNormalAt, signedArea, splitEdge, sub, withOpen } from "./geometry";
import type { ShapeEdge, ShapePt, ShapeRoom } from "./types";

/** #370: a drawn line segment of the template, feet. */
export type Seg = [ShapePt, ShapePt];
/** "double": a wall shows as a line on the face plus a parallel one 4"–9" out (Jeff's DWGs); "single": a line on the face is enough (the arena). */
export type WallRule = "double" | "single";

const FACE_FT = 1 / 12;
const OUT_STEPS_FT = [4, 5, 6, 7, 8, 9].map((i) => i / 12);
const SAMPLE_FT = 0.25;
const MIN_RUN_SAMPLES = 6; // 18"

function distToSeg(p: ShapePt, a: ShapePt, b: ShapePt): number {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

/** A grid of segments by cell, for "is any drawn line within r of p". */
export class SegIndex {
  private cells = new Map<string, Seg[]>();
  constructor(segs: readonly Seg[], private cellFt = 2) {
    for (const s of segs) {
      const x0 = Math.floor(Math.min(s[0].x, s[1].x) / cellFt), x1 = Math.floor(Math.max(s[0].x, s[1].x) / cellFt);
      const y0 = Math.floor(Math.min(s[0].y, s[1].y) / cellFt), y1 = Math.floor(Math.max(s[0].y, s[1].y) / cellFt);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const list = this.cells.get(k);
        if (list) list.push(s);
        else this.cells.set(k, [s]);
      }
    }
  }
  /** The distance from p to the nearest segment within r, else Infinity. */
  nearest(p: ShapePt, r: number): number {
    let best = Infinity;
    const c = this.cellFt;
    for (let x = Math.floor((p.x - r) / c); x <= Math.floor((p.x + r) / c); x++)
      for (let y = Math.floor((p.y - r) / c); y <= Math.floor((p.y + r) / c); y++)
        for (const s of this.cells.get(`${x},${y}`) ?? []) best = Math.min(best, distToSeg(p, s[0], s[1]));
    return best <= r ? best : Infinity;
  }
}

/** Whether the drawing shows a wall at face point p whose outward unit normal is n. */
export function wallAt(idx: SegIndex, p: ShapePt, n: ShapePt, rule: WallRule): boolean {
  if (idx.nearest(p, FACE_FT) === Infinity) return false;
  if (rule === "single") return true;
  return OUT_STEPS_FT.some((d) => idx.nearest({ x: p.x + n.x * d, y: p.y + n.y * d }, FACE_FT) !== Infinity);
}

/** Runs shorter than MIN_RUN_SAMPLES take their neighbour's value (the first run its successor's). */
function smooth(flags: boolean[]): boolean[] {
  const f = flags.slice();
  for (let pass = 0; pass < 3; pass++) {
    let k = 0;
    while (k < f.length) {
      let j = k;
      while (j < f.length && f[j] === f[k]) j++;
      if (j - k < MIN_RUN_SAMPLES && f.length > MIN_RUN_SAMPLES) {
        const v = k > 0 ? f[k - 1] : j < f.length ? f[j] : f[k];
        for (let q = k; q < j; q++) f[q] = v;
      }
      k = j;
    }
  }
  return f;
}

const r12 = (p: ShapePt): ShapePt => ({ x: Math.round(p.x * 12) / 12, y: Math.round(p.y * 12) / 12 });

/**
 * #370 (Amendment A): an outline's edges split wherever the drawing changes between wall and no wall along them
 * (samples every 3", runs under 18" follow their neighbours); edges with no wall carry `open: true`. Split points
 * round to the inch.
 */
export function splitByWalls(pts: readonly ShapePt[], edges: readonly ShapeEdge[], idx: SegIndex, rule: WallRule): { pts: ShapePt[]; edges: ShapeEdge[] } {
  const n = pts.length;
  const area = signedArea(outlinePoints({ pts: pts as ShapePt[], edges: edges as ShapeEdge[] }, 0.25, 64));
  const outPts: ShapePt[] = [], outEdges: ShapeEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], e = edges[i];
    const ns = Math.max(2, Math.ceil(edgeLength(a, b, e) / SAMPLE_FT));
    const flags = smooth(Array.from({ length: ns }, (_, k) => {
      const t = (k + 0.5) / ns;
      return wallAt(idx, edgeAt(a, b, e, t), outwardNormalAt(area, a, b, e, t), rule);
    }));
    let curA = a, curE = e, tPrev = 0;
    for (let k = 1; k < ns; k++) {
      if (flags[k] === flags[k - 1]) continue;
      const t = k / ns;
      const s = splitEdge(curA, b, curE, (t - tPrev) / (1 - tPrev));
      outPts.push(curA);
      outEdges.push(withOpen(s.first, !flags[k - 1]));
      curA = r12(s.at);
      curE = s.second;
      tPrev = t;
    }
    outPts.push(curA);
    outEdges.push(withOpen(curE, !flags[ns - 1]));
  }
  return { pts: outPts, edges: outEdges };
}

/** The share of a room's perimeter that is walled (0..1). */
export function walledShare(room: Pick<ShapeRoom, "pts" | "edges"> & Partial<Pick<ShapeRoom, "kind">>): number {
  const n = room.pts.length;
  let all = 0, walled = 0;
  for (let i = 0; i < n; i++) {
    const L = edgeLength(room.pts[i], room.pts[(i + 1) % n], room.edges[i]);
    all += L;
    if (!room.edges[i].open) walled += L;
  }
  return all > 0 ? walled / all : 0;
}
