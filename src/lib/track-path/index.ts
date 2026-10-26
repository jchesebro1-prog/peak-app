/**
 * Curved track paths (#369). Pure and client-safe. The track engine prices a
 * curved track from it, the track configurator draws its mini plan from it,
 * and the curtain cut sheets draw the layout sheet from it — one geometry, so
 * the BOM and the drawing always agree.
 *
 * A path walks from (0, 0) heading +x, in world feet with y up. An arc turns
 * left (counter-clockwise) or right about its center.
 */

export type TrackSegment =
  | { kind: "straight"; lengthFt: number }
  | { kind: "arc"; radiusFt: number; sweepDeg: number; turn: "left" | "right" };

export const MAX_TRACK_SEGMENTS = 12;
const RAD = Math.PI / 180;

/** Length overshoot (ft) forgiven when counting pieces, carriers and hanging points along a path — covers an angle shown to 4 decimals (≤ ~1e-3 ft at any sane radius). */
export const PATH_LEN_EPS_FT = 1e-3;
/** How many `unitFt` lengths cover `lengthFt`, forgiving PATH_LEN_EPS_FT of overshoot (never below 0). */
export function ceilAlong(lengthFt: number, unitFt: number): number {
  return Math.max(0, Math.ceil((lengthFt - PATH_LEN_EPS_FT) / unitFt));
}
const fmtFt = (n: number) => (Math.round(n * 100) / 100).toString() + "'";
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function segmentLengthFt(s: TrackSegment): number {
  return s.kind === "straight" ? s.lengthFt : s.radiusFt * s.sweepDeg * RAD;
}

export function pathLengthFt(path: readonly TrackSegment[]): number {
  return path.reduce((a, s) => a + segmentLengthFt(s), 0);
}

/** [0, l1, l1 + l2, …, L] — where each segment starts, then the end. */
export function segmentBounds(path: readonly TrackSegment[]): number[] {
  const out = [0];
  for (const s of path) out.push(out[out.length - 1] + segmentLengthFt(s));
  return out;
}

export type PathPoint = { x: number; y: number; headingDeg: number };
export type SegmentStart = PathPoint & { center?: { x: number; y: number } };

function arcCenter(p: PathPoint, s: Extract<TrackSegment, { kind: "arc" }>): { x: number; y: number } {
  const t = p.headingDeg * RAD;
  const side = s.turn === "left" ? 1 : -1;
  return { x: p.x - side * s.radiusFt * Math.sin(t), y: p.y + side * s.radiusFt * Math.cos(t) };
}

/** The point `d` ft into segment `s`, which starts at `p`. */
function advance(p: PathPoint, s: TrackSegment, d: number): PathPoint {
  const t = p.headingDeg * RAD;
  if (s.kind === "straight") return { x: p.x + d * Math.cos(t), y: p.y + d * Math.sin(t), headingDeg: p.headingDeg };
  const side = s.turn === "left" ? 1 : -1;
  const c = arcCenter(p, s);
  const t2 = t + (side * d) / s.radiusFt;
  return { x: c.x + side * s.radiusFt * Math.sin(t2), y: c.y - side * s.radiusFt * Math.cos(t2), headingDeg: t2 / RAD };
}

/** Each segment's start point and heading, plus an arc's center. */
export function segmentStarts(path: readonly TrackSegment[]): SegmentStart[] {
  const out: SegmentStart[] = [];
  let p: PathPoint = { x: 0, y: 0, headingDeg: 0 };
  for (const s of path) {
    out.push(s.kind === "arc" ? { ...p, center: arcCenter(p, s) } : { ...p });
    p = advance(p, s, segmentLengthFt(s));
  }
  return out;
}

/** The point `distFt` along the path (clamped to its ends). */
export function pointAt(path: readonly TrackSegment[], distFt: number): PathPoint {
  if (!path.length) return { x: 0, y: 0, headingDeg: 0 };
  const starts = segmentStarts(path);
  const b = segmentBounds(path);
  const d = Math.min(Math.max(distFt, 0), b[b.length - 1]);
  let i = path.length - 1;
  for (let k = 0; k < path.length; k++) {
    if (d <= b[k + 1]) {
      i = k;
      break;
    }
  }
  return advance(starts[i], path[i], d - b[i]);
}

/** Points about every `stepFt` along the path, both ends included, at most 1,200 intervals. */
export function samplePath(path: readonly TrackSegment[], stepFt: number): Array<PathPoint & { d: number }> {
  const L = pathLengthFt(path);
  if (!(L > 0)) return [];
  const n = Math.min(1200, Math.max(1, Math.ceil(L / Math.max(stepFt, 1e-6))));
  return Array.from({ length: n + 1 }, (_, k) => {
    const d = (L * k) / n;
    return { d, ...pointAt(path, d) };
  });
}

/**
 * World → drawing frame: start → end runs left to right along +x and the path
 * bulges toward +y (upstage), so its open, concave side faces the audience at
 * −y. A path that closes on itself keeps its own rotation.
 */
export function audienceFrame(path: readonly TrackSegment[]): (p: { x: number; y: number }) => { x: number; y: number } {
  const L = pathLengthFt(path);
  const end = pointAt(path, L);
  const a = Math.hypot(end.x, end.y) > 1e-6 * Math.max(L, 1) ? Math.atan2(end.y, end.x) : 0;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const rot = (p: { x: number; y: number }) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos });
  const pts = samplePath(path, L / 200).map(rot);
  const mean = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
  const flip = mean < 0;
  return (p) => {
    const r = rot(p);
    return { x: r.x, y: flip ? -r.y : r.y };
  };
}

/** Overall width (left → right in the audience frame) and depth, ft. */
export function footprint(path: readonly TrackSegment[]): { widthFt: number; depthFt: number } {
  const f = audienceFrame(path);
  const pts = samplePath(path, pathLengthFt(path) / 400).map(f);
  if (!pts.length) return { widthFt: 0, depthFt: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { widthFt: Math.max(...xs) - Math.min(...xs), depthFt: Math.max(...ys) - Math.min(...ys) };
}

export type PathSeriesFacts = { name: string; curvedSectionFt?: number; minRadiusFt?: number; hasSticks: boolean };

/** Everything wrong with a path for this series, in reading order; [] = priceable. */
export function pathErrors(path: readonly TrackSegment[], series: PathSeriesFacts, maxRunFt: number): string[] {
  if (!path.length) return ["Add a segment to the curve."];
  const name = series.name || "This series";
  const errors: string[] = [];
  if (path.length > MAX_TRACK_SEGMENTS) errors.push(`A curved track has at most ${MAX_TRACK_SEGMENTS} segments.`);
  path.forEach((s, i) => {
    const at = `Segment ${i + 1}`;
    if (s.kind === "straight") {
      if (!positive(s.lengthFt)) errors.push(`${at}: enter the length.`);
      return;
    }
    if (!positive(s.radiusFt)) errors.push(`${at}: enter the radius.`);
    else if (series.minRadiusFt && s.radiusFt < series.minRadiusFt)
      errors.push(`${at}: ${fmtFt(s.radiusFt)} is tighter than the ${name}'s ${fmtFt(series.minRadiusFt)} minimum.`);
    if (!(positive(s.sweepDeg) && s.sweepDeg <= 360)) errors.push(`${at}: the angle is more than 0° and at most 360°.`);
    if (s.turn !== "left" && s.turn !== "right") errors.push(`${at}: pick Left or Right.`);
  });
  if (!path.some((s) => s.kind === "arc")) errors.push("A curved track needs at least one arc — make it Straight instead.");
  else if (!positive(series.curvedSectionFt)) errors.push(`${name} has no curved track.`);
  if (path.some((s) => s.kind === "straight") && !series.hasSticks) errors.push(`${name} has no stick length — set it in Estimating Rules → Track series.`);
  if (!errors.length && pathLengthFt(path) > maxRunFt) errors.push(`A run is at most ${maxRunFt}'.`);
  return errors;
}

/** A curved track saved before #369 (no path): the one left arc it always was; [] when its run or radius is unusable. */
export function legacyArc(runFt: number, radiusFt: number | undefined): TrackSegment[] {
  if (!positive(runFt) || !positive(radiusFt)) return [];
  return [{ kind: "arc", radiusFt, sweepDeg: runFt / radiusFt / RAD, turn: "left" }];
}

/** A track config's path: its own (even empty) when it has one, else the legacy arc; null for a straight track. */
export function resolvePath(c: { curved: boolean; path?: readonly TrackSegment[]; runFt: number; radiusFt?: number }): TrackSegment[] | null {
  if (!c.curved) return null;
  return Array.isArray(c.path) ? cleanPath(c.path) : legacyArc(c.runFt, c.radiusFt);
}

/** Path distances one leg of track covers. */
export type LegSpan = { startFt: number; endFt: number };

/** One leg, or a lapped bi-part's two legs of (run + overlap) / 2 that overlap at center. */
export function trackLegs(totalFt: number, lapOverlapFt: number): LegSpan[] {
  if (!(lapOverlapFt > 0)) return [{ startFt: 0, endFt: totalFt }];
  const mid = totalFt / 2;
  const half = Math.min(lapOverlapFt, totalFt) / 2;
  return [
    { startFt: 0, endFt: mid + half },
    { startFt: mid - half, endFt: totalFt },
  ];
}

export type LegPiece = { kind: "straight" | "arc"; lengthFt: number; segmentIndex: number };

/**
 * Shared tolerance (ft) for legPieces and legHangingPoints: a piece or joint
 * closer than this to a leg end is the end itself (sweeps typed to a few
 * decimals leave ~1e-9 ft of slack).
 */
// Smaller than PATH_LEN_EPS_FT: joints compare position to position on one path (float slack only); lengths absorb 4-decimal angle drift.
const JOINT_EPS_FT = 1e-6;

/** The part of each segment a leg covers, in path order. */
export function legPieces(path: readonly TrackSegment[], leg: LegSpan): LegPiece[] {
  const b = segmentBounds(path);
  const out: LegPiece[] = [];
  path.forEach((s, i) => {
    const a = Math.max(b[i], leg.startFt);
    const z = Math.min(b[i + 1], leg.endFt);
    if (z - a > JOINT_EPS_FT) out.push({ kind: s.kind, lengthFt: z - a, segmentIndex: i });
  });
  return out;
}

/**
 * Hanging points on one leg, as path distances: both ends, every segment
 * joint inside the leg (#369 — each joint is supported), and evenly spaced
 * fill so no gap exceeds `spacingFt`. One segment gives ceil(L ÷ spacing) + 1,
 * the engine's rule before #369.
 */
export function legHangingPoints(path: readonly TrackSegment[], leg: LegSpan, spacingFt: number): number[] {
  const joints = segmentBounds(path).filter((d) => d > leg.startFt + JOINT_EPS_FT && d < leg.endFt - JOINT_EPS_FT);
  const stops = [leg.startFt, ...joints, leg.endFt];
  const pts = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const z = stops[i];
    const n = Math.min(2000, Math.max(1, ceilAlong(z - a, spacingFt)));
    for (let k = 1; k <= n; k++) pts.push(a + ((z - a) * k) / n);
  }
  return pts;
}

/** Only the segment fields, so a stored config never carries stray keys. */
export function cleanPath(path: readonly TrackSegment[]): TrackSegment[] {
  return path.map((s) =>
    s.kind === "straight" ? { kind: "straight", lengthFt: s.lengthFt } : { kind: "arc", radiusFt: s.radiusFt, sweepDeg: s.sweepDeg, turn: s.turn === "right" ? "right" : "left" }
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "s12|a6:90:L|s12" — groups curtains on the same layout into one cut-sheet type. */
export function pathSignature(path: readonly TrackSegment[]): string {
  return path.map((s) => (s.kind === "straight" ? `s${r2(s.lengthFt)}` : `a${r2(s.radiusFt)}:${r2(s.sweepDeg)}:${s.turn === "right" ? "R" : "L"}`)).join("|");
}
