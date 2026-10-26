// src/lib/design/room-shape/geometry.ts
import { SHAPE_LIMITS, type ShapeEdge, type ShapePt, type ShapeRoom } from "./types";

/** #370: pure plane geometry for room shapes (feet). Every function is total: degenerate input returns a safe value. */
const EPS = 1e-9;
export const sub = (a: ShapePt, b: ShapePt): ShapePt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: ShapePt, b: ShapePt): ShapePt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: ShapePt, k: number): ShapePt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: ShapePt, b: ShapePt): number => a.x * b.x + a.y * b.y;
export const dist = (a: ShapePt, b: ShapePt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: ShapePt, b: ShapePt): ShapePt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: ShapePt, b: ShapePt, t: number): ShapePt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The unit left normal (−dy, dx) of a → b; zero for a zero-length edge. */
export function leftNormal(a: ShapePt, b: ShapePt): ShapePt {
  const d = sub(b, a), L = Math.hypot(d.x, d.y);
  return L < EPS ? { x: 0, y: 0 } : { x: -d.y / L, y: d.x / L };
}

/** p rotated by t radians about c (the standard rotation [[cos, −sin], [sin, cos]]). */
export function rotateAbout(p: ShapePt, c: ShapePt, t: number): ShapePt {
  const dx = p.x - c.x, dy = p.y - c.y, co = Math.cos(t), si = Math.sin(t);
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
}

export type ArcInfo = { centre: ShapePt; r: number; sweep: number; length: number };

/** An arc edge's circle. `sweep` is signed: rotating (a − centre) by it lands on b via the arc's midpoint. null when the chord is 0 or bulge ≈ 0. */
export function arcInfo(a: ShapePt, b: ShapePt, bulge: number): ArcInfo | null {
  const L = dist(a, b);
  if (L < EPS || !Number.isFinite(bulge) || Math.abs(bulge) < 1e-6) return null;
  const n = leftNormal(a, b), m = mid(a, b), s = (bulge * L) / 2;
  const r = (L * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const centre = add(m, mul(n, s - Math.sign(bulge) * r));
  const arcMid = add(m, mul(n, s));
  let sweep = 4 * Math.atan(Math.abs(bulge));
  if (dist(rotateAbout(a, centre, sweep / 2), arcMid) > 1e-6 * Math.max(1, r)) sweep = -sweep;
  return { centre, r, sweep, length: r * Math.abs(sweep) };
}

export function bezierAt(a: ShapePt, c1: ShapePt, c2: ShapePt, b: ShapePt, t: number): ShapePt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

/** The point at parameter t (0..1) along an edge (arc: by angle; curve: Bezier t; line: linear). */
export function edgeAt(a: ShapePt, b: ShapePt, e: ShapeEdge, t: number): ShapePt {
  if (e.kind === "arc") {
    const A = arcInfo(a, b, e.bulge);
    if (A) return rotateAbout(a, A.centre, A.sweep * t);
  }
  if (e.kind === "curve") return bezierAt(a, e.c1, e.c2, b, t);
  return lerp(a, b, t);
}
export const edgeMid = (a: ShapePt, b: ShapePt, e: ShapeEdge): ShapePt => edgeAt(a, b, e, 0.5);

export function edgeLength(a: ShapePt, b: ShapePt, e: ShapeEdge): number {
  if (e.kind === "arc") {
    const A = arcInfo(a, b, e.bulge);
    return A ? A.length : dist(a, b);
  }
  if (e.kind === "curve") {
    let L = 0, p = a;
    for (let i = 1; i <= 32; i++) {
      const q = bezierAt(a, e.c1, e.c2, b, i / 32);
      L += dist(p, q);
      p = q;
    }
    return L;
  }
  return dist(a, b);
}

/** Points along an edge from a (included) to b (excluded): a line gives [a]; a curve one point per stepFt, 2..maxPts. */
export function sampleEdge(a: ShapePt, b: ShapePt, e: ShapeEdge, stepFt = 0.5, maxPts = 64): ShapePt[] {
  if (e.kind === "line" || (e.kind === "arc" && !arcInfo(a, b, e.bulge))) return [a];
  const n = Math.max(2, Math.min(maxPts, Math.ceil(edgeLength(a, b, e) / stepFt)));
  return Array.from({ length: n }, (_, i) => edgeAt(a, b, e, i / n));
}

const LINE: ShapeEdge = { kind: "line" };
const edgeOf = (room: Pick<ShapeRoom, "edges">, i: number): ShapeEdge => room.edges[i] ?? LINE;

/** A room's closed outline as sampled points. */
export function outlinePoints(room: Pick<ShapeRoom, "pts" | "edges">, stepFt = 0.5, maxPerEdge = 64): ShapePt[] {
  const n = room.pts.length;
  return room.pts.flatMap((p, i) => sampleEdge(p, room.pts[(i + 1) % n], edgeOf(room, i), stepFt, maxPerEdge));
}

/** Shoelace area: > 0 when the interior is on the LEFT of each edge (pure algebra — independent of which way y points on screen). */
export function signedArea(pts: readonly ShapePt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function centroid(pts: readonly ShapePt[]): ShapePt {
  const A = signedArea(pts);
  if (Math.abs(A) < EPS) {
    const n = Math.max(1, pts.length);
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function bounds(pts: readonly ShapePt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Proper crossing of p1p2 and p3p4 (touching at an end does not count). */
function segsCross(p1: ShapePt, p2: ShapePt, p3: ShapePt, p4: ShapePt): boolean {
  const o = (a: ShapePt, b: ShapePt, c: ShapePt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/** Whether a room's outline crosses itself (sampled; neighbouring segments never count). */
export function selfCrosses(room: Pick<ShapeRoom, "pts" | "edges">): boolean {
  const p = outlinePoints(room, 0.5, 32);
  const n = p.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** The bulge giving radius r over chord L, keeping `was`'s side and minor / major-ness. null when r < L / 2. */
export function bulgeForRadius(L: number, r: number, was: number): number | null {
  if (!(L > 0) || !(r >= L / 2 - 1e-9)) return null;
  let sweep = 2 * Math.asin(Math.min(1, L / (2 * r)));
  if (Math.abs(was) > 1) sweep = 2 * Math.PI - sweep;
  const b = Math.tan(sweep / 4);
  return b > SHAPE_LIMITS.bulge ? null : (was < 0 ? -1 : 1) * b;
}

/** The bulge giving arc length s over chord L (s > L), `was`'s side. null when s ≤ L or past the bulge cap. */
export function bulgeForArcLength(L: number, s: number, was: number): number | null {
  if (!(L > 0) || !(s > L * (1 + 1e-9))) return null;
  // s / L = θ / (2 sin(θ / 2)), increasing on (0, 2π).
  let lo = 1e-9, hi = 2 * Math.PI - 1e-9;
  for (let k = 0; k < 80; k++) {
    const m = (lo + hi) / 2;
    if ((m / (2 * Math.sin(m / 2))) * L < s) lo = m;
    else hi = m;
  }
  const b = Math.tan((lo + hi) / 8);
  return b > SHAPE_LIMITS.bulge ? null : (was < 0 ? -1 : 1) * b;
}

/** The bulge whose arc passes through p's projection on the edge's left normal (the dragged midpoint): b = 2s / L. */
export function bulgeThrough(a: ShapePt, b: ShapePt, p: ShapePt): number {
  const L = dist(a, b);
  if (L < EPS) return 0;
  return clamp((2 * dot(sub(p, mid(a, b)), leftNormal(a, b))) / L, -SHAPE_LIMITS.bulge, SHAPE_LIMITS.bulge);
}

/** An edge with its `open` flag set or cleared. */
export function withOpen(e: ShapeEdge, open: boolean): ShapeEdge {
  const { open: _drop, ...rest } = e as ShapeEdge & { open?: true };
  void _drop;
  return (open ? { ...rest, open: true } : rest) as ShapeEdge;
}

/** Split an edge at t: the new point and the edges either side, the curve unchanged; `open` carries to both. */
export function splitEdge(a: ShapePt, b: ShapePt, e: ShapeEdge, t: number): { at: ShapePt; first: ShapeEdge; second: ShapeEdge } {
  const open = !!e.open;
  if (e.kind === "arc") {
    const A = arcInfo(a, b, e.bulge);
    if (A) {
      const s = e.bulge < 0 ? -1 : 1, sw = Math.abs(A.sweep);
      return {
        at: edgeAt(a, b, e, t),
        first: withOpen({ kind: "arc", bulge: s * Math.tan((sw * t) / 4) }, open),
        second: withOpen({ kind: "arc", bulge: s * Math.tan((sw * (1 - t)) / 4) }, open),
      };
    }
  }
  if (e.kind === "curve") {
    const p01 = lerp(a, e.c1, t), p12 = lerp(e.c1, e.c2, t), p23 = lerp(e.c2, b, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), at = lerp(p012, p123, t);
    return { at, first: withOpen({ kind: "curve", c1: p01, c2: p012 }, open), second: withOpen({ kind: "curve", c1: p123, c2: p23 }, open) };
  }
  return { at: lerp(a, b, t), first: withOpen({ kind: "line" }, open), second: withOpen({ kind: "line" }, open) };
}

/** The outward unit normal at parameter t of an edge of a loop whose signed area is `area` (tangent by finite difference). */
export function outwardNormalAt(area: number, a: ShapePt, b: ShapePt, e: ShapeEdge, t: number): ShapePt {
  const t0 = Math.max(0, t - 0.01), t1 = Math.min(1, t + 0.01);
  const n = leftNormal(edgeAt(a, b, e, t0), edgeAt(a, b, e, t1));
  return area > 0 ? mul(n, -1) : n;
}

/** The 6" wall along each non-open edge of a room, outward from its face: one closed polygon per walled edge (mitred corners, capped at 2× the thickness). A zone has none. */
export function wallBands(room: Pick<ShapeRoom, "pts" | "edges" | "kind">, thickFt: number = SHAPE_LIMITS.wallFt): ShapePt[][] {
  if (room.kind === "zone" || room.pts.length < 3) return [];
  const n = room.pts.length;
  const per = room.pts.map((p, i) => sampleEdge(p, room.pts[(i + 1) % n], edgeOf(room, i), 0.25, 64));
  const loop = per.flat();
  const L = loop.length;
  const dir = signedArea(loop) > 0 ? -1 : 1;
  const off = loop.map((p, k) => {
    const prev = loop[(k - 1 + L) % L], next = loop[(k + 1) % L];
    const n1 = mul(leftNormal(prev, p), dir), n2 = mul(leftNormal(p, next), dir);
    let m = add(n1, n2);
    const ml = Math.hypot(m.x, m.y);
    m = ml < 1e-6 ? n2 : mul(m, 1 / ml);
    const cos = dot(m, n2);
    return add(p, mul(m, cos > 0.5 ? thickFt / cos : thickFt * 2));
  });
  const bands: ShapePt[][] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const cnt = per[i].length;
    if (!edgeOf(room, i).open) {
      const idx = Array.from({ length: cnt + 1 }, (_, j) => (start + j) % L);
      bands.push([...idx.map((k) => loop[k]), ...[...idx].reverse().map((k) => off[k])]);
    }
    start += cnt;
  }
  return bands;
}
