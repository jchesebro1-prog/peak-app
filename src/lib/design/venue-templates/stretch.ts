import type { PathItem, Pt, StretchDims, StretchedPlan, TemplateKeys, TrueArcGroup, VenueTemplate, XSpan } from "./types";

/**
 * The venue-template stretch (#249, #255). Pure. Every point moves through a
 * front-to-back map (piecewise-linear through the key lines, the origin line
 * fixed) and a side-to-side map about the centreline (span lists, one or two
 * zones). Straight lines are densified (≤ 12") and arcs sampled (≤ 2°) first,
 * so the result stays exact under a non-affine map. Arcs listed in
 * `trueArcs` stay true circles instead of following the map point by point.
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

/** #255: a side-to-side map over half-distance a ≥ 0 (see XSpan). */
export function makeSpanMap(spans: XSpan[], d: StretchDims): (a: number) => number {
  const proHalf = (d.proWidthFt * 12) / 2;
  const wing = Math.max(0, d.wingFt * 12);
  const houseHalf = (d.houseWidthFt * 12) / 2;
  const xs = [0, ...spans.map((s) => s.to)];
  const len = (i: number) => xs[i + 1] - xs[i];
  const total = (drive: XSpan["drive"], upto = spans.length) =>
    spans.slice(0, upto).reduce((n, s, i) => n + (s.drive === drive ? len(i) : 0), 0);
  const proK = total("pro") > 0 ? proHalf / total("pro") : 1;
  const wingK = total("wing") > 0 ? wing / total("wing") : 1;
  const lastAbsorb = spans.map((s) => s.drive).lastIndexOf("absorb");
  const absorbLen = lastAbsorb < 0 ? 0 : total("absorb", lastAbsorb + 1);
  const rigid = spans
    .slice(0, lastAbsorb + 1)
    .reduce((n, s, i) => n + (s.drive === "pro" ? len(i) * proK : s.drive === "wing" ? len(i) * wingK : s.drive === "fixed" ? len(i) : 0), 0);
  const absorbK = absorbLen > 0 ? Math.max(0, houseHalf - rigid) / absorbLen : 1;
  const k = (s: XSpan) => (s.drive === "pro" ? proK : s.drive === "wing" ? wingK : s.drive === "absorb" ? absorbK : 1);
  const nx = [0];
  spans.forEach((s, i) => nx.push(nx[i] + len(i) * k(s)));
  const last = xs.length - 1;
  return (a: number) => {
    if (a >= xs[last]) return nx[last] + (a - xs[last]);
    for (let i = 0; i < last; i++) if (a <= xs[i + 1]) return nx[i] + (a - xs[i]) * k(spans[i]);
    return a;
  };
}

/** The front-to-back map: piecewise-linear through the key lines; the origin line never moves. */
export function makeYMap(k: TemplateKeys, d: StretchDims): (y: number) => number {
  const spans = k.ySpans;
  const len = (s: { from: number; to: number }) => s.from - s.to;
  const openOf = (drive: string) => spans.filter((s) => s.drive === drive).reduce((n, s) => n + len(s), 0);
  const openStage = openOf("stageDepth");
  const open = openOf("houseOpen");
  // #255: the stage/platform depth range may hold fixed spans too (a church's front step); only its open spans stretch.
  const fixedStage = Math.abs(k.stageDepthTo - k.origin) - openStage;
  const fixedHouse = k.origin - k.houseDepthTo - open;
  const stageK = openStage > 0 ? Math.max(0, d.stageDepthFt * 12 - fixedStage) / openStage : 1;
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

/** The side-to-side map about the centreline (see XMap). */
export function makeXMap(k: TemplateKeys, d: StretchDims): (x: number, y: number) => number {
  const xm = k.x;
  if (xm.kind === "spans") {
    const m = makeSpanMap(xm.spans, d);
    return (x: number) => {
      const dx = x - k.cx;
      return k.cx + Math.sign(dx) * m(Math.abs(dx));
    };
  }
  const up = makeSpanMap(xm.upper, d);
  const lo = makeSpanMap(xm.lower, d);
  const span = xm.yStart - xm.yEnd;
  return (x: number, y: number) => {
    const dx = x - k.cx;
    const a = Math.abs(dx);
    const t = span > 0 ? clamp01((xm.yStart - y) / span) : y > xm.yStart ? 0 : 1;
    return k.cx + Math.sign(dx) * ((1 - t) * up(a) + t * lo(a));
  };
}

const inBox = (p: Pt, b: { minX: number; maxX: number; minY: number; maxY: number }) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

export function stretchTemplate(t: VenueTemplate, k: TemplateKeys, d: StretchDims): StretchedPlan {
  const X = makeXMap(k, d);
  const Y = makeYMap(k, d);
  const map = (p: Pt): Pt => ({ x: X(p.x, p.y), y: Y(p.y) });
  const groups = k.trueArcs ?? [];
  const near = (c: Pt, a: { cx: number; cy: number }) => Math.abs(c.x - a.cx) < 0.01 && Math.abs(c.y - a.cy) < 0.01;
  const groupOf = (a: { cx: number; cy: number }) => groups.find((g) => g.centres.some((c) => near(c, a)));
  const scaleOf = (g: TrueArcGroup) => (X(k.cx + g.scaleHalf, g.atY) - X(k.cx, g.atY)) / g.scaleHalf;

  /** A true arc: the circle through where the map sends its ends, radius × k, centre on the drawn side of the chord. */
  const trueArc = (arc: { cx: number; cy: number; r: number }, from: number, to: number, g: TrueArcGroup) => {
    const e0 = { x: arc.cx + arc.r * Math.cos(from * DEG), y: arc.cy + arc.r * Math.sin(from * DEG) };
    const e1 = { x: arc.cx + arc.r * Math.cos(to * DEG), y: arc.cy + arc.r * Math.sin(to * DEG) };
    const m0 = map(e0), m1 = map(e1);
    const half = Math.hypot(m1.x - m0.x, m1.y - m0.y) / 2;
    // Never smaller than the chord needs; a semicircle (chord = diameter) keeps its centre on the chord exactly.
    const r = Math.max(arc.r * scaleOf(g), half);
    const side = Math.sign((e1.x - e0.x) * (arc.cy - e0.y) - (e1.y - e0.y) * (arc.cx - e0.x)) || 1;
    const ux = (m1.x - m0.x) / (2 * half), uy = (m1.y - m0.y) / (2 * half);
    const h = Math.sqrt(Math.max(0, (r - half) * (r + half)));
    const c = { x: (m0.x + m1.x) / 2 - uy * h * side, y: (m0.y + m1.y) / 2 + ux * h * side };
    const t0 = Math.atan2(m0.y - c.y, m0.x - c.x) / DEG;
    let t1 = Math.atan2(m1.y - c.y, m1.x - c.x) / DEG;
    if (to >= from) while (t1 <= t0) t1 += 360;
    else while (t1 >= t0) t1 -= 360;
    return { pts: arcPoints({ cx: c.x, cy: c.y, r }, t0, t1), c, r };
  };

  /** A region / line path mapped: true-arc items keep their circle; everything else follows the map. */
  const mapPath = (items: PathItem[], closed: boolean): Pt[] => {
    if (!items.some((it) => "arc" in it && groupOf(it.arc))) return densifyPath(pathPoints(items), closed).map(map);
    const pieces = items.map((it) => {
      if ("arc" in it) {
        const raw = arcPoints(it.arc, it.arc.from, it.arc.to);
        const g = groupOf(it.arc);
        return { start: raw[0], end: raw[raw.length - 1], mapped: g ? trueArc(it.arc, it.arc.from, it.arc.to, g).pts : raw.map(map) };
      }
      return { start: it, end: it, mapped: [map(it)] };
    });
    const out: Pt[] = [];
    pieces.forEach((p, i) => {
      out.push(...p.mapped);
      const next = i + 1 < pieces.length ? pieces[i + 1] : closed ? pieces[0] : null;
      if (next) out.push(...densifySegment(p.end, next.start).slice(1, -1).map(map));
    });
    return out;
  };

  /** A label or point inside a true arc's zone moves with the arc. */
  const zoneMap = (p: Pt): Pt | null => {
    for (const g of groups) {
      if (g.zoneMinY == null || p.y <= g.zoneMinY) continue;
      const ref = t.arcs.filter((a) => near(g.centres[0], a)).sort((a, b) => a.r - b.r)[0];
      if (!ref || Math.hypot(p.x - ref.cx, p.y - ref.cy) >= ref.r) continue;
      const m = trueArc(ref, ref.a0, ref.a1, g);
      return { x: m.c.x + ((p.x - ref.cx) * m.r) / ref.r, y: m.c.y + ((p.y - ref.cy) * m.r) / ref.r };
    }
    return null;
  };

  const polylines: Pt[][] = [];
  for (const [x1, y1, x2, y2] of t.segments) {
    const a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
    if (!d.pit && k.pit && inBox(a, k.pit.bbox) && inBox(b, k.pit.bbox)) continue;
    polylines.push(densifySegment(a, b).map(map));
  }
  for (const arc of t.arcs) {
    const g = groupOf(arc);
    polylines.push(g ? trueArc(arc, arc.a0, arc.a1, g).pts : arcPoints(arc, arc.a0, arc.a1).map(map));
  }
  const labels = t.labels
    .filter((l) => d.pit || !k.pit || !k.pit.labels.includes(l.text))
    .map((l) => ({ text: l.text, h: l.h, ...(zoneMap(l) ?? map(l)) }));
  const regions: Record<string, Pt[]> = {};
  const regionLabels: Record<string, string> = {};
  for (const [name, items] of Object.entries(k.regions)) {
    if (k.pit && name === k.pit.region && !d.pit) continue;
    regions[name] = mapPath(items, true);
    regionLabels[name] = k.regionLabels?.[name] ?? name;
  }
  const lines: Record<string, Pt[]> = {};
  for (const [name, items] of Object.entries(k.lines)) lines[name] = mapPath(items, false);
  const points: Record<string, Pt> = {};
  for (const [name, p] of Object.entries(k.points)) points[name] = zoneMap(p) ?? map(p);
  const all = polylines.flat();
  const bounds = {
    minX: Math.min(...all.map((p) => p.x)),
    minY: Math.min(...all.map((p) => p.y)),
    maxX: Math.max(...all.map((p) => p.x)),
    maxY: Math.max(...all.map((p) => p.y)),
  };
  return { bounds, polylines, labels, regions, regionLabels, lines, points, map };
}
