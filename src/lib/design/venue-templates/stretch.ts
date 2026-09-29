import type { Movable, PathItem, PlacedMovable, Pt, StretchDims, StretchedPlan, TemplateKeys, TemplateLabel, TrueArcGroup, VenueTemplate, WallPair, XSpan } from "./types";

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

/**
 * #255: a side-to-side (or mirrored front-to-back) map over half-distance a ≥ 0, given its targets in inches: the
 * pro half, the wing, the house half (see XSpan). `face` (a profile band's mapped face: drawn half-width → mapped
 * half-width) places "face" spans' ends.
 */
export function makeHalfMap(spans: XSpan[], halves: { pro: number; wing: number; house: number }, face?: (a: number) => number): (a: number) => number {
  const proHalf = halves.pro, wing = Math.max(0, halves.wing), houseHalf = halves.house;
  const xs = [0, ...spans.map((s) => s.to)];
  const len = (i: number) => xs[i + 1] - xs[i];
  const total = (drive: XSpan["drive"], upto = spans.length) =>
    spans.slice(0, upto).reduce((n, s, i) => n + (s.drive === drive ? len(i) : 0), 0);
  const proK = total("pro") > 0 ? proHalf / total("pro") : 1;
  const wingK = total("wing") > 0 ? wing / total("wing") : 1;
  const firstAbsorb = spans.findIndex((s) => s.drive === "absorb");
  if (spans.some((s, i) => s.drive === "face" && (!face || (firstAbsorb >= 0 && i > firstAbsorb))))
    throw new Error(`venue template: a "face" span needs a profile band's face and comes before any absorb span`);
  const ks = spans.map((s) => (s.drive === "pro" ? proK : s.drive === "wing" ? wingK : 1));
  // "face" spans end on the mapped face; every span before them is rigid, so their starts are known in order.
  for (let i = 0, at = 0; i < spans.length && spans[i].drive !== "absorb"; at += len(i) * ks[i], i++)
    if (spans[i].drive === "face") ks[i] = len(i) > 0 ? Math.max(0, face!(xs[i + 1]) - at) / len(i) : 1;
  const lastAbsorb = spans.map((s) => s.drive).lastIndexOf("absorb");
  const absorbLen = lastAbsorb < 0 ? 0 : total("absorb", lastAbsorb + 1);
  const rigid = spans.slice(0, lastAbsorb + 1).reduce((n, s, i) => n + (s.drive === "absorb" ? 0 : len(i) * ks[i]), 0);
  const absorbK = absorbLen > 0 ? Math.max(0, houseHalf - rigid) / absorbLen : 1;
  spans.forEach((s, i) => {
    if (s.drive === "absorb") ks[i] = absorbK;
  });
  const nx = [0];
  spans.forEach((s, i) => nx.push(nx[i] + len(i) * ks[i]));
  const last = xs.length - 1;
  return (a: number) => {
    if (a >= xs[last]) return nx[last] + (a - xs[last]);
    for (let i = 0; i < last; i++) if (a <= xs[i + 1]) return nx[i] + (a - xs[i]) * ks[i];
    return a;
  };
}

/** #255: a side-to-side map over half-distance a ≥ 0 (see XSpan and makeHalfMap). */
export function makeSpanMap(spans: XSpan[], d: StretchDims, face?: (a: number) => number): (a: number) => number {
  return makeHalfMap(spans, { pro: (d.proWidthFt * 12) / 2, wing: d.wingFt * 12, house: (d.houseWidthFt * 12) / 2 }, face);
}

/**
 * The front-to-back map: piecewise-linear through the key lines; the origin line never moves. #255: a `yMap`
 * replaces that with a span map mirrored about y = cy (see TemplateKeys.yMap).
 */
export function makeYMap(k: TemplateKeys, d: StretchDims): (y: number) => number {
  if (k.yMap) {
    const { cy, spans } = k.yMap;
    const m = makeHalfMap(spans, { pro: (d.stageDepthFt * 12) / 2, wing: d.wingFt * 12, house: (d.houseDepthFt * 12) / 2 });
    return (y: number) => cy + Math.sign(y - cy) * m(Math.abs(y - cy));
  }
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

/** Linear interpolation over keys listed in DESCENDING order of `xs`, holding the end values beyond them. */
function lerpDesc(v: number, xs: number[], vs: number[]): number {
  const n = xs.length - 1;
  if (v >= xs[0]) return vs[0];
  if (v <= xs[n]) return vs[n];
  for (let i = 0; i < n; i++) {
    if (v <= xs[i] && v >= xs[i + 1]) {
      const s = xs[i] - xs[i + 1];
      return s === 0 ? vs[i] : vs[i] + ((vs[i + 1] - vs[i]) * (xs[i] - v)) / s;
    }
  }
  return vs[n];
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
  if (xm.kind === "profile") {
    const keys = xm.keys;
    if (keys.length < 2 || keys.some((q, i) => !(q.half > 0) || (i > 0 && !(q.y < keys[i - 1].y))))
      throw new Error(`venue template ${k.kind}: profile keys need ≥ 2 keys, y descending, every half > 0`);
    const Y = makeYMap(k, d);
    const proHalf = (d.proWidthFt * 12) / 2, houseHalf = (d.houseWidthFt * 12) / 2;
    const ys = keys.map((q) => q.y), my = ys.map(Y);
    const oldHalf = keys.map((q) => q.half);
    const newHalf = keys.map((q) => (q.drive === "pro" ? proHalf : houseHalf));
    // Per band (the rows from one key down to the next): its outside map — the key's own, else the shared one —
    // and where the band beside the face ends: the next fixed span's start, else the last span's end.
    const bands = keys.slice(0, -1).map((q, i) => {
      const spans = q.outside ?? xm.outside;
      const lo = keys[i + 1];
      // This band's face, drawn half-width → mapped half-width (for "face" spans): the drawn row where the face
      // reaches that half-width, mapped.
      const face = (a: number) => {
        if (q.half === lo.half || a < Math.min(q.half, lo.half) - 1e-9 || a > Math.max(q.half, lo.half) + 1e-9)
          throw new Error(`venue template ${k.kind}: a "face" span ends at ${a}, where the band from y ${q.y} never reaches`);
        return lerpDesc(Y(q.y + ((a - q.half) * (lo.y - q.y)) / (lo.half - q.half)), my, newHalf);
      };
      const ends = [0, ...spans.map((s) => s.to)];
      const anchors = [...spans.flatMap((s, j) => (s.drive === "fixed" ? [ends[j]] : [])), ends[ends.length - 1]].sort((p, r) => p - r);
      return { outside: makeSpanMap(spans, d, face), anchors };
    });
    // The rows at or above a key's lower neighbour belong to that key's band; below the last key, the last band.
    const bandAt = (y: number) => bands.find((_, i) => y >= ys[i + 1]) ?? bands[bands.length - 1];
    return (x: number, y: number) => {
      const dx = x - k.cx, a = Math.abs(dx);
      const ho = lerpDesc(y, ys, oldHalf);
      const N = lerpDesc(Y(y), my, newHalf); // the mapped face's half-width at this y
      const { outside, anchors } = bandAt(y);
      let a2: number;
      // 0.01" (the converter's rounding) counts as on the face.
      if (a <= ho + 0.01) a2 = (a * N) / ho;
      else {
        // The face is placed in mapped y; the outside map ignores y. Between the face and the anchor the band
        // blends linearly from the face to the outside map, so the two always meet; beyond it the outside map
        // alone (fixed walls and outer walls stay straight and keep their size).
        const b = anchors.find((v) => v > ho + 0.01);
        a2 = b == null ? outside(a) + (N - outside(ho)) : a >= b ? outside(a) : N + ((a - ho) * (outside(b) - N)) / (b - ho);
      }
      return k.cx + Math.sign(dx) * a2;
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

type Line = { p: Pt; u: Pt };
type Seg = [number, number, number, number];
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const unit = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const endsOf = (s: Seg): [Pt, Pt] => [{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }];
const same = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
const intersect = (l1: Line, l2: Line): Pt | null => {
  const den = cross(l1.u, l2.u);
  if (Math.abs(den) < 1e-9) return null;
  return add(l1.p, mul(l1.u, cross(sub(l2.p, l1.p), l2.u) / den));
};
const project = (p: Pt, l: Line): Pt => add(l.p, mul(l.u, dot(sub(p, l.p), l.u)));
/** p lies on segment s, within 0.01". */
function onSeg(p: Pt, s: Seg): boolean {
  const [a, b] = endsOf(s), ab = sub(b, a), len = Math.hypot(ab.x, ab.y);
  if (len < 1e-9) return same(p, a);
  const t = dot(sub(p, a), ab) / (len * len);
  return t >= -1e-6 && t <= 1 + 1e-6 && Math.abs(cross(sub(p, a), ab)) / len < 0.01;
}
const parallel = (s: Seg, q: Seg) => {
  const [a, b] = endsOf(s), [c, e] = endsOf(q);
  return Math.abs(cross(unit(sub(b, a)), unit(sub(e, c)))) < 1e-6;
};

/**
 * #255: redraw each wall's `faces` parallel to its mapped `ref` at the drawn
 * perpendicular distance. A face's ends meet the line of whatever it abutted
 * in the drawing (another redrawn face first, else that segment's mapped
 * direction there); a free end projects. A plain segment that ended on a face
 * slides along its own mapped direction onto the redrawn face — unless it
 * merely continues straight into another segment (a split outer wall); the
 * points it slides past are dropped, so it never doubles back. First, the
 * drawn segment a ref lies on is drawn straight along the mapped ref, its ends
 * projected onto it (a straight wall stays straight wherever the map bends).
 * Mutates `polys` (one entry per drawn segment, null = not drawn).
 *
 * Returns how other geometry follows the redrawn faces: `snap` sends a drawn
 * point where the redraw put that spot — a drawn segment end that moved goes
 * to its new end, a point mid-face to where the face meets whatever else
 * passes through it (by the same rule as a face end) — and `alongFace` says
 * whether two drawn points share a face, so an outline edge between them stays
 * on the redrawn face.
 */
type WallSnap = { snap: (p: Pt) => Pt | null; alongFace: (a: Pt, b: Pt) => boolean };
function redrawWalls(segs: Seg[], polys: Array<Pt[] | null>, walls: WallPair[], map: (p: Pt) => Pt): WallSnap {
  const face = new Map<number, Line>();
  const segOf = (f: [Pt, Pt]) =>
    segs.findIndex((s) => {
      const [a, b] = endsOf(s);
      return (same(a, f[0]) && same(b, f[1])) || (same(a, f[1]) && same(b, f[0]));
    });
  for (const w of walls) {
    const A = map(w.ref[0]), B = map(w.ref[1]);
    const u = unit(sub(B, A)), n = { x: -u.y, y: u.x };
    const v = unit(sub(w.ref[1], w.ref[0])), n0 = { x: -v.y, y: v.x };
    // The drawn segment the ref lies on (it may run past the ref's ends) is drawn straight along the mapped ref.
    const r = segs.findIndex((s, j) => polys[j] && onSeg(w.ref[0], s) && onSeg(w.ref[1], s));
    if (r >= 0) {
      const refLine = { p: A, u }, [e0, e1] = endsOf(segs[r]);
      polys[r] = densifySegment(project(map(e0), refLine), project(map(e1), refLine));
    }
    for (const f of w.faces) {
      const i = segOf(f);
      if (i < 0) throw new Error(`venue template: wall face ${JSON.stringify(f)} is not a drawn segment`);
      // 1e-4 ≈ 0.006°: the converter's 3-decimal rounding, never a real angle.
      if (Math.abs(cross(unit(sub(f[1], f[0])), v)) > 1e-4) throw new Error(`venue template: wall face ${JSON.stringify(f)} is not parallel to its ref`);
      face.set(i, { p: add(A, mul(n, dot(sub(f[0], w.ref[0]), n0))), u });
    }
  }
  const tangent = (j: number, E: Pt): Line | null => {
    const P = polys[j];
    if (!P || P.length < 2) return null;
    const [a, b] = endsOf(segs[j]), ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(E, a), ab) / (dot(ab, ab) || 1)));
    const k = Math.min(P.length - 2, Math.max(0, Math.floor(t * (P.length - 1))));
    return { p: P[k], u: unit(sub(P[k + 1], P[k])) };
  };
  const moved: Array<[Pt | null, Pt | null]> = segs.map(() => [null, null]);
  segs.forEach((s, i) => {
    if (!polys[i]) return;
    ([0, 1] as const).forEach((e) => {
      const E = endsOf(s)[e];
      const own = face.get(i);
      if (own) {
        const others = segs.map((_, j) => j).filter((j) => j !== i && polys[j] && onSeg(E, segs[j]) && !parallel(s, segs[j]));
        const j = others.find((jj) => face.has(jj)) ?? others[0];
        const line = j == null ? null : (face.get(j) ?? tangent(j, E));
        moved[i][e] = (line && intersect(own, line)) ?? project(map(E), own);
        return;
      }
      if (segs.some((q, j) => j !== i && (same(endsOf(q)[0], E) || same(endsOf(q)[1], E)) && parallel(s, q))) return;
      const j = segs.findIndex((q, jj) => jj !== i && face.has(jj) && onSeg(E, q) && !parallel(s, q));
      const tan = j < 0 ? null : tangent(i, E);
      if (j >= 0 && tan) moved[i][e] = intersect(tan, face.get(j)!);
    });
  });
  segs.forEach((_, i) => {
    const P = polys[i];
    if (!P) return;
    const [m0, m1] = moved[i];
    if (face.has(i) && m0 && m1) polys[i] = densifySegment(m0, m1);
    else if (m0 || m1) {
      // Slid ends: keep only the points still between the two ends (a slide longer than one piece would double back).
      const A = m0 ?? P[0], B = m1 ?? P[P.length - 1], ab = sub(B, A), L2 = dot(ab, ab);
      polys[i] = [A, ...P.slice(1, -1).filter((q) => {
        const s = dot(sub(q, A), ab);
        return s > 1e-9 && s < L2 - 1e-9;
      }), B];
    }
  });
  const facesThrough = (p: Pt) => [...face.keys()].filter((i) => polys[i] && onSeg(p, segs[i]));
  return {
    snap: (p) => {
      for (let j = 0; j < segs.length; j++) {
        const P = polys[j];
        if (!P) continue;
        const [a, b] = endsOf(segs[j]);
        if (moved[j][0] && same(a, p)) return P[0];
        if (moved[j][1] && same(b, p)) return P[P.length - 1];
      }
      const [i] = facesThrough(p);
      if (i == null) return null;
      const own = face.get(i)!;
      const others = segs.map((_, j) => j).filter((j) => j !== i && polys[j] && onSeg(p, segs[j]) && !parallel(segs[i], segs[j]));
      const j = others.find((jj) => face.has(jj)) ?? others[0];
      const line = j == null ? null : (face.get(j) ?? tangent(j, p));
      return (line && intersect(own, line)) ?? project(map(p), own);
    },
    alongFace: (a, b) => facesThrough(a).some((i) => onSeg(b, segs[i])),
  };
}

type Owned = Map<string, { segs: Array<[Pt, Pt]>; arcs: Pt[][]; labels: TemplateLabel[] }>;

/** #255: a template's movables must name real walls and regions, one id each, on walls of some length — else a named error. */
function checkMovables(k: TemplateKeys) {
  const who = `venue template ${k.kind}`;
  for (const [id, w] of Object.entries(k.movableWalls ?? {}))
    if (Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y) < 1e-9) throw new Error(`${who}: movable wall "${id}" has zero length`);
  const seen = new Set<string>();
  for (const m of k.movables ?? []) {
    if (seen.has(m.id)) throw new Error(`${who}: movable id "${m.id}" is used twice`);
    seen.add(m.id);
    for (const w of m.walls) if (!k.movableWalls?.[w]) throw new Error(`${who}: movable ${m.id} lists wall "${w}", which is not in movableWalls`);
    if (m.sized && m.bbox) throw new Error(`${who}: movable ${m.id} is code-sized and has a bbox — it can be one or the other`);
    if (!m.sized && !m.bbox) throw new Error(`${who}: movable ${m.id} has no bbox — a drawn movable needs one (or mark it sized)`);
    if (!m.sized && !k.regions[m.region]) throw new Error(`${who}: movable ${m.id} names region "${m.region}" — no such region`);
    if (m.sized && Object.hasOwn(k.regions, m.region)) throw new Error(`${who}: code-sized movable ${m.id} names region "${m.region}", which is also a drawn region — a sized room's region is created, never drawn`);
  }
}

/**
 * #255: re-place each movable element against its wall (see Movable) — its drawn size kept, on the wall's right
 * (outside the room), turned with the wall — then resolve each wall: nobody past the run's ends, `movableGap`
 * between neighbours. A wall that can't take its elements warns and marks them `fits: false`. `map` places the
 * walls and home anchors (the stretch's own point map, redrawn wall faces included).
 */
function placeMovables(k: TemplateKeys, d: StretchDims, map: (p: Pt) => Pt, owned: Owned) {
  const out = { polylines: [] as Pt[][], labels: [] as TemplateLabel[], regions: {} as Record<string, Pt[]>, movables: {} as Record<string, PlacedMovable>, warnings: [] as string[] };
  const movs: Movable[] = k.movables ?? [];
  if (!movs.length) return out;
  checkMovables(k);
  const gap = k.movableGap ?? 24;
  const walls: Record<string, { from: Pt; u: Pt; n: Pt; len: number; to: Pt }> = {};
  for (const [id, w] of Object.entries(k.movableWalls ?? {})) {
    const f = map(w.from), e = map(w.to), u = unit(sub(e, f));
    walls[id] = { from: f, to: e, u, n: { x: u.y, y: -u.x }, len: Math.hypot(e.x - f.x, e.y - f.y) };
  }
  const els = movs.map((m) => {
    const hw = k.movableWalls?.[m.home.wall];
    if (!hw || !walls[m.home.wall]) throw new Error(`venue template ${k.kind}: movable ${m.id}'s home wall "${m.home.wall}" is not in movableWalls`);
    const u0 = unit(sub(hw.to, hw.from)), n0 = { x: u0.y, y: -u0.x };
    // Element-local coordinates: s along its home wall from the anchor, t out from the wall (outside the room).
    const local = (p: Pt) => ({ s: dot(sub(p, m.home.anchor), u0), t: dot(sub(p, m.home.anchor), n0) });
    const own = owned.get(m.id);
    // #255: a code-sized element is a rectangle in local coordinates — its typed size, centred along the wall, out to
    // its right. No size (or a junk one) = a zero-size rectangle at its anchor.
    const sz = m.sized ? d.movableSizes?.[m.id] : undefined;
    const ft = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
    const half = ft(sz?.alongFt) * 6, deep = ft(sz?.depthFt) * 12;
    const corners = m.sized ? [{ s: -half, t: 0 }, { s: half, t: 0 }, { s: half, t: deep }, { s: -half, t: deep }] : null;
    // checkMovables has made sure a drawn element's region exists.
    const pts = corners ?? [...(own?.segs ?? []).flat(), ...(own?.arcs ?? []).flat(), ...pathPoints(k.regions[m.region])].map(local);
    if (!pts.length) throw new Error(`venue template ${k.kind}: movable ${m.id} owns no drawn lines and has no region`);
    const sMin = Math.min(...pts.map((q) => q.s)), sMax = Math.max(...pts.map((q) => q.s));
    const tMin = Math.min(...pts.map((q) => q.t)), tMax = Math.max(...pts.map((q) => q.t));
    const req = d.movables?.[m.id];
    const wall = req && m.walls.includes(req.wall) && walls[req.wall] ? req.wall : m.home.wall;
    const W = walls[wall];
    const lo = -sMin, hi = W.len - sMax;
    let c: number;
    if (req && req.wall === wall && req.t != null && Number.isFinite(req.t)) c = lo + clamp01(req.t) * (hi - lo);
    else if (wall === m.home.wall) c = dot(sub(map(m.home.anchor), W.from), W.u);
    else c = (lo + hi) / 2;
    return { m, local, corners, sMin, sMax, tMin, tMax, wall, c, lo, hi, fits: true };
  });
  for (const wid of Object.keys(walls)) {
    const on = els.filter((e) => e.wall === wid).sort((a, b) => a.c - b.c);
    if (!on.length) continue;
    // Push forward off the start and apart; then back off the end and apart. Whatever still overlaps doesn't fit.
    on.forEach((e, i) => {
      e.c = Math.max(e.c, e.lo);
      if (i) e.c = Math.max(e.c, on[i - 1].c + on[i - 1].sMax - e.sMin + gap);
    });
    for (let i = on.length - 1; i >= 0; i--) {
      const e = on[i];
      e.c = Math.min(e.c, e.hi);
      if (i < on.length - 1) e.c = Math.min(e.c, on[i + 1].c - (e.sMax - on[i + 1].sMin) - gap);
    }
    const fine = on.every((e, i) => e.c >= e.lo - 1e-6 && e.c <= e.hi + 1e-6 && (i === 0 || e.c - on[i - 1].c >= on[i - 1].sMax - e.sMin + gap - 1e-6));
    if (!fine) {
      out.warnings.push(`Not everything fits on the ${k.movableWallLabels?.[wid] ?? wid} wall — move a room to another wall.`);
      // #255 T11 minors: one group — every room in order, `gap` apart — centred on the wall, so nothing overlaps and
      // the overhang splits evenly past both corners.
      const total = on.reduce((n, e) => n + e.sMax - e.sMin, 0) + gap * (on.length - 1);
      let at = (walls[wid].len - total) / 2;
      for (const e of on) {
        e.fits = false;
        e.c = at - e.sMin;
        at += e.sMax - e.sMin + gap;
      }
    }
  }
  for (const e of els) {
    const W = walls[e.wall], A = add(W.from, mul(W.u, e.c));
    const place = (p: Pt) => {
      const q = e.local(p);
      return add(A, add(mul(W.u, q.s), mul(W.n, q.t)));
    };
    for (const [a, b] of owned.get(e.m.id)?.segs ?? []) out.polylines.push(densifySegment(a, b).map(place));
    for (const arc of owned.get(e.m.id)?.arcs ?? []) out.polylines.push(arc.map(place));
    for (const l of owned.get(e.m.id)?.labels ?? []) out.labels.push({ text: l.text, h: l.h, ...place(l) });
    if (e.corners) out.regions[e.m.region] = densifyPath(e.corners.map((q) => add(A, add(mul(W.u, q.s), mul(W.n, q.t)))), true);
    else out.regions[e.m.region] = densifyPath(pathPoints(k.regions[e.m.region]), true).map(place);
    const sMid = (e.sMin + e.sMax) / 2;
    const runs: PlacedMovable["runs"] = {};
    for (const w of e.m.walls) if (walls[w]) runs[w] = { from: walls[w].from, to: walls[w].to, lo: -e.sMin, hi: walls[w].len - e.sMax, sMid };
    out.movables[e.m.id] = {
      wall: e.wall,
      t: e.hi > e.lo ? clamp01((e.c - e.lo) / (e.hi - e.lo)) : 0.5,
      centre: add(A, add(mul(W.u, sMid), mul(W.n, (e.tMin + e.tMax) / 2))),
      outer: add(A, add(mul(W.u, sMid), mul(W.n, e.tMax))),
      fits: e.fits,
      runs,
    };
  }
  return out;
}

/** #255: where a dragged movable lands — the nearest allowed wall it fits on, whole feet along it. `p` = its dropped centre, stretched inches. */
export function snapMovable(plan: StretchedPlan, id: string, p: Pt): { wall: string; t: number } | null {
  const m = plan.movables[id];
  if (!m) return null;
  let best: { wall: string; t: number; dist: number } | null = null;
  for (const [wall, r] of Object.entries(m.runs)) {
    if (r.hi < r.lo) continue;
    const u = unit(sub(r.to, r.from));
    const c = Math.max(r.lo, Math.min(r.hi, dot(sub(p, r.from), u) - r.sMid));
    const foot = add(r.from, mul(u, c + r.sMid));
    const dist = Math.hypot(p.x - foot.x, p.y - foot.y);
    const cFt = Math.min(r.hi, r.lo + Math.round((c - r.lo) / 12) * 12);
    // #255 T11: rounded only to shed float noise — t × the run in feet must stay a whole foot (1e-6 drifted 2e-6 ft on a 28'-6" run).
    const t = r.hi > r.lo ? Math.round(((cFt - r.lo) / (r.hi - r.lo)) * 1e12) / 1e12 : 0.5;
    if (!best || dist < best.dist - 1e-9) best = { wall, t, dist };
  }
  return best && { wall: best.wall, t: best.t };
}

export function stretchTemplate(t: VenueTemplate, k: TemplateKeys, d: StretchDims): StretchedPlan {
  const X = makeXMap(k, d);
  const Y = makeYMap(k, d);
  const map = (p: Pt): Pt => ({ x: X(p.x, p.y), y: Y(p.y) });
  const groups = k.trueArcs ?? [];
  for (const g of groups)
    if (g.scaleHalf != null && g.atY == null) throw new Error(`venue template ${k.kind}: a true-arc group with scaleHalf needs atY (the y its half-width is measured at)`);
  const near = (c: Pt, a: { cx: number; cy: number }) => Math.abs(c.x - a.cx) < 0.01 && Math.abs(c.y - a.cy) < 0.01;
  const groupOf = (a: { cx: number; cy: number }) => groups.find((g) => g.centres.some((c) => near(c, a)));
  const scaleOf = (g: TrueArcGroup) => (X(k.cx + g.scaleHalf!, g.atY!) - X(k.cx, g.atY!)) / g.scaleHalf!;

  type Circle = { cx: number; cy: number; r: number };
  /** #255: a circle with no chord to follow (full, or a collapsed sweep): scaled by the group's k, or — keep-sweep — its drawn radius. */
  const noChordR = (arc: Circle, g: TrueArcGroup) => (g.scaleHalf != null ? arc.r * scaleOf(g) : arc.r);
  const isFull = (from: number, to: number) => Math.abs(to - from) >= 360 - 1e-9;
  const drawnEnd = (arc: Circle, deg: number): Pt => ({ x: arc.cx + arc.r * Math.cos(deg * DEG), y: arc.cy + arc.r * Math.sin(deg * DEG) });
  /** The sweep t0 → t1 in the drawn arc's direction. */
  const sweep = (t0: number, t1: number, from: number, to: number) => {
    if (to >= from) while (t1 <= t0) t1 += 360;
    else while (t1 >= t0) t1 -= 360;
    return t1;
  };
  /** A drawn arc's concentric reference: the smallest partial drawn arc on its centre (full circles never set a centre). */
  const innermostAt = (a: { cx: number; cy: number }) =>
    t.arcs.filter((b) => near({ x: b.cx, y: b.cy }, a) && !isFull(b.a0, b.a1)).sort((p, q) => p.r - q.r)[0];

  /** The innermost arc's circle: through where the map sends its ends, radius × k, centre on the drawn side of the chord. */
  const chordArc = (arc: Circle, from: number, to: number, g: TrueArcGroup) => {
    const e0 = drawnEnd(arc, from), e1 = drawnEnd(arc, to);
    const m0 = map(e0), m1 = map(e1);
    const half = Math.hypot(m1.x - m0.x, m1.y - m0.y) / 2;
    if (half < 1e-9) {
      // No chord (a full circle, or a zero sweep): a similarity about the mapped centre.
      const c = map({ x: arc.cx, y: arc.cy }), r = noChordR(arc, g);
      return { pts: arcPoints({ cx: c.x, cy: c.y, r }, from, to), c, r };
    }
    // Never smaller than the chord needs; a semicircle (chord = diameter) keeps its centre on the chord exactly.
    // #255: without scaleHalf the arc keeps its sweep — the radius that sweeps it over the mapped chord.
    const r = g.scaleHalf != null ? Math.max(arc.r * scaleOf(g), half) : half / Math.sin((Math.abs(to - from) * DEG) / 2);
    const side = Math.sign((e1.x - e0.x) * (arc.cy - e0.y) - (e1.y - e0.y) * (arc.cx - e0.x)) || 1;
    const ux = (m1.x - m0.x) / (2 * half), uy = (m1.y - m0.y) / (2 * half);
    const h = Math.sqrt(Math.max(0, (r - half) * (r + half)));
    const c = { x: (m0.x + m1.x) / 2 - uy * h * side, y: (m0.y + m1.y) / 2 + ux * h * side };
    const t0 = Math.atan2(m0.y - c.y, m0.x - c.x) / DEG;
    const t1 = sweep(t0, Math.atan2(m1.y - c.y, m1.x - c.x) / DEG, from, to);
    return { pts: arcPoints({ cx: c.x, cy: c.y, r }, t0, t1), c, r };
  };

  /**
   * A true arc. Arcs drawn on one centre stay concentric: the innermost sets the
   * mapped centre and radius, every other keeps its drawn offset from it (a 6"
   * wall stays 6"), and its ends land where its circle crosses the mapped wall
   * line (y) its drawn ends map to. A full circle is a similarity about its centre.
   */
  const trueArc = (arc: Circle, from: number, to: number, g: TrueArcGroup) => {
    if (isFull(from, to)) {
      const c = map({ x: arc.cx, y: arc.cy }), r = noChordR(arc, g);
      return { pts: arcPoints({ cx: c.x, cy: c.y, r }, from, to), c, r };
    }
    const ref = innermostAt(arc);
    const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    const isRef = !ref || (eq(arc.r, ref.r) && ((eq(from, ref.a0) && eq(to, ref.a1)) || (eq(from, ref.a1) && eq(to, ref.a0))));
    if (isRef) return chordArc(arc, from, to, g);
    const inner = chordArc(ref, ref.a0, ref.a1, g);
    const c = inner.c, r = inner.r + (arc.r - ref.r);
    if (r <= 0) return chordArc(arc, from, to, g);
    const endAngle = (deg: number) => {
      const m = map(drawnEnd(arc, deg));
      const dy = m.y - c.y;
      if (Math.abs(dy) > r) return Math.atan2(dy, m.x - c.x) / DEG; // the wall line misses the circle: aim at the mapped end
      const dx = Math.sqrt(r * r - dy * dy);
      const x = Math.abs(c.x + dx - m.x) <= Math.abs(c.x - dx - m.x) ? c.x + dx : c.x - dx;
      return Math.atan2(dy, x - c.x) / DEG;
    };
    const t0 = endAngle(from);
    const t1 = sweep(t0, endAngle(to), from, to);
    return { pts: arcPoints({ cx: c.x, cy: c.y, r }, t0, t1), c, r };
  };

  // #255: movable elements' lines, labels and regions are lifted out of the stretch and placed after it.
  const movs = k.movables ?? [];
  // Only a drawn movable (one with a bbox) owns drawing; a code-sized one owns nothing.
  const ownerOf = (a: Pt, b: Pt = a) => movs.find((m) => m.bbox && inBox(a, m.bbox) && inBox(b, m.bbox));
  const owned: Owned = new Map(movs.map((m) => [m.id, { segs: [], arcs: [], labels: [] }]));
  const movableRegions = new Set(movs.map((m) => m.region));

  const segPolys: Array<Pt[] | null> = t.segments.map(([x1, y1, x2, y2]) => {
    const a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
    if (!d.pit && k.pit && inBox(a, k.pit.bbox) && inBox(b, k.pit.bbox)) return null;
    const m = ownerOf(a, b);
    if (m) {
      owned.get(m.id)!.segs.push([a, b]);
      return null;
    }
    return densifySegment(a, b).map(map);
  });
  const walls = k.walls?.length ? redrawWalls(t.segments, segPolys, k.walls, map) : null;
  /** A drawn point on a redrawn wall face goes where the redraw put it; anything else follows the map. */
  const mapPt = (p: Pt): Pt => walls?.snap(p) ?? map(p);

  /**
   * A region / line path mapped: true-arc items keep their circle; corners on a redrawn wall face stay on it
   * (an edge along a face runs straight between them); everything else follows the map.
   */
  const mapPath = (items: PathItem[], closed: boolean): Pt[] => {
    if (!walls && !items.some((it) => "arc" in it && groupOf(it.arc))) return densifyPath(pathPoints(items), closed).map(map);
    const pieces = items.map((it) => {
      if ("arc" in it) {
        const raw = arcPoints(it.arc, it.arc.from, it.arc.to);
        const g = groupOf(it.arc);
        return { start: raw[0], end: raw[raw.length - 1], mapped: g ? trueArc(it.arc, it.arc.from, it.arc.to, g).pts : raw.map(map) };
      }
      return { start: it, end: it, mapped: [mapPt(it)] };
    });
    const out: Pt[] = [];
    pieces.forEach((p, i) => {
      out.push(...p.mapped);
      const next = i + 1 < pieces.length ? pieces[i + 1] : closed ? pieces[0] : null;
      if (!next) return;
      if (walls?.alongFace(p.end, next.start)) out.push(...densifySegment(p.mapped[p.mapped.length - 1], next.mapped[0]).slice(1, -1));
      else out.push(...densifySegment(p.end, next.start).slice(1, -1).map(map));
    });
    return out;
  };

  /** A label or point inside a true arc's zone moves with the arc. */
  const zoneMap = (p: Pt): Pt | null => {
    for (const g of groups) {
      if (g.zoneMinY == null || p.y <= g.zoneMinY) continue;
      // The group's smallest drawn circle; a full 360° circle is never the zone's reference.
      const ref = t.arcs.filter((a) => g.centres.some((c) => near(c, a)) && !isFull(a.a0, a.a1)).sort((a, b) => a.r - b.r)[0];
      if (!ref || Math.hypot(p.x - ref.cx, p.y - ref.cy) >= ref.r) continue;
      const m = chordArc(ref, ref.a0, ref.a1, g);
      return { x: m.c.x + ((p.x - ref.cx) * m.r) / ref.r, y: m.c.y + ((p.y - ref.cy) * m.r) / ref.r };
    }
    return null;
  };

  const polylines: Pt[][] = segPolys.filter((p): p is Pt[] => !!p);
  for (const arc of t.arcs) {
    // #255 T11 minors: an arc wholly inside a movable's box is lifted with it, like its lines.
    const raw = arcPoints(arc, arc.a0, arc.a1);
    const m = movs.find((mv) => mv.bbox && raw.every((p) => inBox(p, mv.bbox!)));
    if (m) {
      owned.get(m.id)!.arcs.push(raw);
      continue;
    }
    const g = groupOf(arc);
    polylines.push(g ? trueArc(arc, arc.a0, arc.a1, g).pts : arcPoints(arc, arc.a0, arc.a1).map(map));
  }
  const labels = t.labels
    .filter((l) => d.pit || !k.pit || !k.pit.labels.includes(l.text))
    .filter((l) => {
      const m = ownerOf(l);
      if (m) owned.get(m.id)!.labels.push(l);
      return !m;
    })
    .map((l) => ({ text: l.text, h: l.h, ...(zoneMap(l) ?? map(l)) }));
  const regions: Record<string, Pt[]> = {};
  const regionLabels: Record<string, string> = {};
  for (const [name, items] of Object.entries(k.regions)) {
    if (k.pit && name === k.pit.region && !d.pit) continue;
    if (movableRegions.has(name)) continue;
    regions[name] = mapPath(items, true);
    regionLabels[name] = k.regionLabels?.[name] ?? name;
  }
  const lines: Record<string, Pt[]> = {};
  for (const [name, items] of Object.entries(k.lines)) lines[name] = mapPath(items, false);
  // #255: key lines that are part of the drawing (curves the DWG only carries as splines).
  for (const id of k.drawn ?? []) {
    if (!lines[id]) throw new Error(`venue template ${k.kind}: drawn line "${id}" is not in lines`);
    polylines.push(lines[id].slice());
  }
  const points: Record<string, Pt> = {};
  for (const [name, p] of Object.entries(k.points)) points[name] = zoneMap(p) ?? mapPt(p);
  const placed = placeMovables(k, d, mapPt, owned);
  polylines.push(...placed.polylines);
  labels.push(...placed.labels);
  for (const [name, pts] of Object.entries(placed.regions)) {
    regions[name] = pts;
    regionLabels[name] = k.regionLabels?.[name] ?? name;
  }
  const all = polylines.flat();
  const bounds = {
    minX: Math.min(...all.map((p) => p.x)),
    minY: Math.min(...all.map((p) => p.y)),
    maxX: Math.max(...all.map((p) => p.x)),
    maxY: Math.max(...all.map((p) => p.y)),
  };
  return { bounds, polylines, labels, regions, regionLabels, lines, points, map, movables: placed.movables, warnings: placed.warnings };
}
