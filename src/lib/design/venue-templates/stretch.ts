import type { PathItem, Pt, StretchDims, StretchedPlan, TemplateKeys, VenueTemplate } from "./types";

/**
 * The venue-template stretch (#249). Pure. Every point moves through a
 * front-to-back map (piecewise-linear through the key lines, the plaster line
 * fixed) and a side-to-side map about the centreline that depends on how far
 * downstage the point is. Straight lines are densified (≤ 12") and arcs
 * sampled (≤ 2°) first, so the result stays exact under a non-affine map.
 */

const DEG = Math.PI / 180;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Points every ≤ maxLen inches along a → b, both ends included. */
export function densifySegment(a: Pt, b: Pt, maxLen = 12): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxLen));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** Points every ≤ stepDeg along an arc from `from` to `to` degrees (either direction), both ends included. */
export function arcPoints(arc: { cx: number; cy: number; r: number }, from: number, to: number, stepDeg = 2): Pt[] {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / stepDeg));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (from + ((to - from) * i) / n) * DEG;
    return { x: arc.cx + arc.r * Math.cos(a), y: arc.cy + arc.r * Math.sin(a) };
  });
}

/** A region / line path as plain points: corners kept, arcs sampled. */
export function pathPoints(items: PathItem[]): Pt[] {
  const out: Pt[] = [];
  for (const it of items) {
    if ("arc" in it) out.push(...arcPoints(it.arc, it.arc.from, it.arc.to));
    else out.push({ x: it.x, y: it.y });
  }
  return out;
}

/** Densify a point path (closing it back to the start when `closed`), without repeating shared corners. */
function densifyPath(pts: Pt[], closed: boolean): Pt[] {
  const ring = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
  const out: Pt[] = [];
  for (let i = 1; i < ring.length; i++) {
    const seg = densifySegment(ring[i - 1], ring[i]);
    out.push(...(out.length ? seg.slice(1) : seg));
  }
  if (closed && out.length > 1) out.pop(); // the last point repeats the first
  return out.length ? out : pts.slice();
}

/** The front-to-back map: piecewise-linear through the key lines; the plaster line (origin) never moves. */
export function makeYMap(k: TemplateKeys, d: StretchDims): (y: number) => number {
  const spans = k.ySpans;
  const len = (s: { from: number; to: number }) => s.from - s.to;
  const open = spans.filter((s) => s.drive === "houseOpen").reduce((n, s) => n + len(s), 0);
  const fixedHouse = k.origin - k.houseDepthTo - open;
  const stageK = (d.stageDepthFt * 12) / (k.stageDepthTo - k.origin);
  const houseK = open > 0 ? Math.max(0, d.houseDepthFt * 12 - fixedHouse) / open : 1;
  const newLen = (s: (typeof spans)[number]) => len(s) * (s.drive === "stageDepth" ? stageK : s.drive === "houseOpen" ? houseK : 1);
  const ys = [spans[0].from, ...spans.map((s) => s.to)];
  const iO = ys.findIndex((y) => Math.abs(y - k.origin) < 1e-6);
  if (iO < 0) throw new Error(`venue template ${k.kind}: origin ${k.origin} is not a y key line`);
  const ny = ys.slice();
  for (let i = iO - 1; i >= 0; i--) ny[i] = ny[i + 1] + newLen(spans[i]);
  for (let i = iO + 1; i < ys.length; i++) ny[i] = ny[i - 1] - newLen(spans[i - 1]);
  const last = ys.length - 1;
  return (y: number) => {
    if (y >= ys[0]) return ny[0] + (y - ys[0]);
    if (y <= ys[last]) return ny[last] + (y - ys[last]);
    for (let i = 0; i < last; i++) {
      if (y <= ys[i] && y >= ys[i + 1]) {
        const span = ys[i] - ys[i + 1];
        return span === 0 ? ny[i] : ny[i] + ((ny[i + 1] - ny[i]) * (ys[i] - y)) / span;
      }
    }
    return y;
  };
}

/**
 * The side-to-side map about the centreline. Upstage of `blend.yStart` it is
 * the stage map (opening follows pro width, wings follow wing width); past
 * `blend.yEnd` the back-of-house map (a rigid centre — booth and vestibules —
 * and sides that follow house width); linearly blended between, so the two
 * meet without a seam. Points beyond the inner wall face move with it, so
 * walls keep their thickness.
 */
export function makeXMap(k: TemplateKeys, d: StretchDims): (x: number, y: number) => number {
  const proHalf = (d.proWidthFt * 12) / 2;
  const wing = Math.max(0, d.wingFt * 12);
  const stageInner = proHalf + wing;
  const houseHalf = (d.houseWidthFt * 12) / 2;
  const { proHalf: P, innerHalf: I } = k.stageX;
  const { rigidHalf: G, innerHalf: B } = k.backX;
  const stageA = (a: number) => (a <= P ? (a * proHalf) / P : a <= I ? proHalf + ((a - P) * wing) / (I - P) : stageInner + (a - I));
  const backA = (a: number) => (a <= G ? a : a <= B ? G + ((a - G) * (houseHalf - G)) / (B - G) : houseHalf + (a - B));
  const span = k.blend.yStart - k.blend.yEnd;
  return (x: number, y: number) => {
    const dx = x - k.cx;
    const a = Math.abs(dx);
    const t = clamp01((k.blend.yStart - y) / span);
    return k.cx + Math.sign(dx) * ((1 - t) * stageA(a) + t * backA(a));
  };
}

const inBox = (p: Pt, b: TemplateKeys["pit"]["bbox"]) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

export function stretchTemplate(t: VenueTemplate, k: TemplateKeys, d: StretchDims): StretchedPlan {
  const X = makeXMap(k, d);
  const Y = makeYMap(k, d);
  const map = (p: Pt): Pt => ({ x: X(p.x, p.y), y: Y(p.y) });
  const polylines: Pt[][] = [];
  for (const [x1, y1, x2, y2] of t.segments) {
    const a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
    if (!d.pit && inBox(a, k.pit.bbox) && inBox(b, k.pit.bbox)) continue;
    polylines.push(densifySegment(a, b).map(map));
  }
  for (const arc of t.arcs) polylines.push(arcPoints(arc, arc.a0, arc.a1).map(map));
  const labels = t.labels
    .filter((l) => d.pit || !k.pit.labels.includes(l.text))
    .map((l) => ({ text: l.text, h: l.h, ...map({ x: l.x, y: l.y }) }));
  const regions: Record<string, Pt[]> = {};
  for (const [name, items] of Object.entries(k.regions)) {
    if (name === k.pit.region && !d.pit) continue;
    regions[name] = densifyPath(pathPoints(items), true).map(map);
  }
  const lines: Record<string, Pt[]> = {};
  for (const [name, items] of Object.entries(k.lines)) lines[name] = densifyPath(pathPoints(items), false).map(map);
  const points: Record<string, Pt> = {};
  for (const [name, p] of Object.entries(k.points)) points[name] = map(p);
  const all = polylines.flat();
  const bounds = {
    minX: Math.min(...all.map((p) => p.x)),
    minY: Math.min(...all.map((p) => p.y)),
    maxX: Math.max(...all.map((p) => p.x)),
    maxY: Math.max(...all.map((p) => p.y)),
  };
  return { bounds, polylines, labels, regions, lines, points, map };
}
