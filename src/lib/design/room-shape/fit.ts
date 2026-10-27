// src/lib/design/room-shape/fit.ts
import { dist, dot, leftNormal, mid, sub } from "./geometry";
import { SHAPE_LIMITS, type ShapeEdge, type ShapePt } from "./types";

/** #370: the fitting tolerance — 1". */
export const FIT_TOL_FT = 1 / 12;

function distToSeg(p: ShapePt, a: ShapePt, b: ShapePt): number {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

/** The circle through three points, or null when they're (near) collinear. */
export function circle3(a: ShapePt, b: ShapePt, c: ShapePt): { centre: ShapePt; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const centre = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  return { centre, r: dist(a, centre) };
}

/** Consecutive points under 0.01 ft apart collapse; a closing point equal to the first drops. */
function dedupe(raw: readonly ShapePt[]): ShapePt[] {
  const out: ShapePt[] = [];
  for (const p of raw) if (!out.length || dist(out[out.length - 1], p) >= 0.01) out.push({ x: p.x, y: p.y });
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < 0.01) out.pop();
  return out;
}

/** The turn at b (0 = straight on, π = straight back). */
function turn(a: ShapePt, b: ShapePt, c: ShapePt): number {
  const u = sub(b, a), v = sub(c, b), lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
  if (lu < 1e-9 || lv < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (lu * lv))));
}

/** The bulge of an arc through P(i)..P(j) when every point is within tol of one circle, in order, bowing more than tol; "flat" when they fit a circle but don't bow past tol yet (a longer run may); else null. */
function arcFit(P: (k: number) => ShapePt, i: number, j: number, tol: number): number | "flat" | null {
  const a = P(i), b = P(j), m = P(Math.floor((i + j) / 2));
  const c = circle3(a, m, b);
  if (!c || c.r > SHAPE_LIMITS.coordFt) return null;
  let total = 0, sign = 0, dev = 0;
  for (let k = i; k <= j; k++) {
    const p = P(k);
    if (Math.abs(dist(p, c.centre) - c.r) > tol) return null;
    dev = Math.max(dev, distToSeg(p, a, b));
    if (k > i) {
      const q = P(k - 1);
      let d = Math.atan2(p.y - c.centre.y, p.x - c.centre.x) - Math.atan2(q.y - c.centre.y, q.x - c.centre.x);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > Math.PI / 2) return null;
      const s = Math.sign(d);
      if (s !== 0) {
        if (sign !== 0 && s !== sign) return null;
        sign = s;
      }
      total += d;
    }
  }
  if (dist(a, b) < 1e-6 || Math.abs(total) > 2 * Math.PI - 0.4) return null;
  if (dev <= tol) return "flat";
  const side = dot(sub(m, mid(a, b)), leftNormal(a, b));
  const bulge = Math.sign(side) * Math.tan(Math.abs(total) / 4);
  return Math.abs(bulge) > SHAPE_LIMITS.bulge ? null : bulge;
}

/**
 * #370: a sampled closed outline (feet) as few edges as fit within `tol`: straight runs become lines, runs of ≥ 5
 * points on one circle become arcs. Starts at the sharpest corner so no edge begins mid-curve. Greedy, longest first.
 */
export function fitOutline(raw: readonly ShapePt[], tol = FIT_TOL_FT): { pts: ShapePt[]; edges: ShapeEdge[] } {
  const pts = dedupe(raw);
  const n = pts.length;
  if (n < 3) return { pts, edges: pts.map(() => ({ kind: "line" as const })) };
  let start = 0, best = -1;
  for (let i = 0; i < n; i++) {
    const t = turn(pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n]);
    if (t > best) { best = t; start = i; }
  }
  const P = (k: number) => pts[(start + k) % n];
  const outPts: ShapePt[] = [], outEdges: ShapeEdge[] = [];
  let i = 0;
  while (i < n) {
    let jl = i + 1;
    for (let j = i + 2; j <= n; j++) {
      let fits = true;
      for (let k = i + 1; k < j; k++) if (distToSeg(P(k), P(i), P(j)) > tol) { fits = false; break; }
      if (!fits) break;
      jl = j;
    }
    let ja = -1, jb = 0;
    for (let j = i + 4; j <= n; j++) {
      const b = arcFit(P, i, j, tol);
      if (b === "flat") continue; // finely sampled: still on one circle, not yet bowing past tol
      if (b === null) {
        if (ja > 0 || j >= i + 8) break;
        continue;
      }
      ja = j;
      jb = b;
    }
    outPts.push(P(i));
    if (ja > jl) { outEdges.push({ kind: "arc", bulge: jb }); i = ja; }
    else { outEdges.push({ kind: "line" }); i = jl; }
  }
  return { pts: outPts, edges: outEdges };
}
