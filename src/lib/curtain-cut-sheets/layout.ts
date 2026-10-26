/**
 * Curtain cut sheets (#369) — the plan view of a curtain's curved track as
 * pure shapes in PAPER INCHES (like the elevation). The track configurator's
 * mini plan draws the same shapes. Hanging points come from the track path's
 * legHangingPoints — the function the track engine counts with — so the
 * caption always equals the hardware table. The open (concave) side of the
 * curve faces the audience, drawn at the bottom. A track too big for any
 * architectural scale shrinks to fit its box and reads "NTS" (not to scale).
 */
import { partsAtCenter, type TrackConfig } from "@/lib/track-engine";
import { hangerSpacingFor, type TrackSeries } from "@/lib/track-series";
import { audienceFrame, legHangingPoints, pathLengthFt, pointAt, resolvePath, samplePath, segmentBounds, segmentStarts, trackLegs, type TrackSegment } from "@/lib/track-path";
import { ARCH_SCALES, ELEV_TEXT_IN, ftIn } from "./geometry";
import { textExtent, type Shape } from "./shapes";

export type TrackOpening = "bipart" | "oneway" | "none";
export type TrackLayoutSource = {
  path: TrackSegment[];
  /** The bi-part lap at center, ft; 0 = one leg. */
  lapOverlapFt: number;
  opening: TrackOpening;
  mountLabel: "Batten clamps" | "Ceiling hangers";
  hangerSpacingFt: number;
  /** Identical tracks on the line — the caption says "per track" when > 1. */
  trackQty: number;
};

export const SUBMITTAL_LAYOUT_BOX = { wIn: 7.9, hIn: 5.6 } as const;
export const CLIENT_LAYOUT_BOX = { wIn: 2.6, hIn: 2.6 } as const;
export const MODAL_LAYOUT_BOX = { wIn: 5, hIn: 2.4 } as const;
/** Room kept around the drawn track for dimensions and labels, in. */
const MARGIN_IN = { submittal: 0.7, client: 0.4 } as const;

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const deg = (n: number) => String(Math.round(n * 10) / 10);
const pathD = (pts: ReadonlyArray<{ x: number; y: number }>) => "M" + pts.map((p) => `${r4(p.x)} ${r4(p.y)}`).join(" L");

/** The layout a track line describes; null for a straight track or a curve with no usable path. */
export function trackLayoutSource(
  config: TrackConfig,
  series: Pick<TrackSeries, "overlapFt" | "hangerSpacingFt" | "ceilingSpacingFt" | "battenSpacingFt">
): TrackLayoutSource | null {
  const path = resolvePath(config);
  if (!path || !path.length || !(pathLengthFt(path) > 0)) return null;
  const bipart = partsAtCenter(config);
  return {
    path,
    lapOverlapFt: bipart && series.overlapFt > 0 ? series.overlapFt : 0,
    opening: bipart ? "bipart" : config.operation === "walkalong" ? "none" : "oneway",
    mountLabel: config.mounting === "ceiling" ? "Ceiling hangers" : "Batten clamps",
    hangerSpacingFt: positive(config.hangerSpacingFt) ? config.hangerSpacingFt : hangerSpacingFor(series, config.mounting),
    trackQty: Number.isInteger(config.qty) && config.qty > 0 ? config.qty : 1,
  };
}

/** Every hanging point on ONE track, as path distances (both legs of a lapped bi-part). */
export function hangingPointsAlong(src: TrackLayoutSource): number[] {
  return trackLegs(pathLengthFt(src.path), src.lapOverlapFt).flatMap((leg) => legHangingPoints(src.path, leg, src.hangerSpacingFt));
}

export function layoutView(
  src: TrackLayoutSource,
  opts: { box: { wIn: number; hIn: number }; detail: "submittal" | "client" }
): { scale: string; shapes: Shape[]; hangingCount: number } {
  const { box, detail } = opts;
  const sub = detail === "submittal";
  const M = MARGIN_IN[detail];
  const path = src.path;
  const L = pathLengthFt(path);
  const frame = audienceFrame(path);
  const samples = samplePath(path, L / 600);
  const framed = samples.map(frame);
  const minX = Math.min(...framed.map((p) => p.x));
  const maxX = Math.max(...framed.map((p) => p.x));
  const minY = Math.min(...framed.map((p) => p.y));
  const maxY = Math.max(...framed.map((p) => p.y));
  const widthFt = maxX - minX;
  const depthFt = maxY - minY;
  const availW = box.wIn - 2 * M;
  const availH = box.hIn - 2 * M;
  const fitted = ARCH_SCALES.find((a) => widthFt * a.inPerFt <= availW + 1e-9 && depthFt * a.inPerFt <= availH + 1e-9);
  // nothing architectural fits: shrink to the box (a zero dimension never divides)
  const s = fitted
    ? fitted.inPerFt
    : Math.min(...[widthFt > 0 ? availW / widthFt : Infinity, depthFt > 0 ? availH / depthFt : Infinity].filter(Number.isFinite), ARCH_SCALES[ARCH_SCALES.length - 1].inPerFt);
  const scaleLabel = fitted ? fitted.label : "NTS";
  const ox = M + (availW - widthFt * s) / 2;
  const oy = M + (availH - depthFt * s) / 2;
  /** World feet → paper inches (y down; upstage at the top). */
  const P = (q: { x: number; y: number }) => {
    const f = frame(q);
    return { x: ox + (f.x - minX) * s, y: oy + (maxY - f.y) * s };
  };
  const at = (d: number) => P(pointAt(path, d));
  const paper = samples.map(P);
  const cx = paper.reduce((a, p) => a + p.x, 0) / paper.length;
  const cy = paper.reduce((a, p) => a + p.y, 0) / paper.length;
  /** The unit normal at `d`, pointing away from the drawing's center (labels go outside the curve). */
  const normal = (d: number) => {
    const a = at(Math.max(0, d - 0.01));
    const b = at(Math.min(L, d + 0.01));
    const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / tl;
    let ny = (b.x - a.x) / tl;
    const p = at(d);
    if ((p.x - cx) * nx + (p.y - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { nx, ny };
  };
  const shapes: Shape[] = [{ kind: "path", tag: "panel", d: pathD(paper), stroke: "heavy" }];

  // each segment's dimension; an arc's radius back to its center (Submittal)
  const bounds = segmentBounds(path);
  const starts = segmentStarts(path);
  path.forEach((seg, i) => {
    const a = bounds[i];
    const z = bounds[i + 1];
    const mid = (a + z) / 2;
    const p = at(mid);
    const { nx, ny } = normal(mid);
    const text = seg.kind === "straight" ? ftIn(seg.lengthFt) : sub ? `R${ftIn(seg.radiusFt)} · ${deg(seg.sweepDeg)}° · ${ftIn(z - a)}` : `R${ftIn(seg.radiusFt)}`;
    const x = p.x + nx * 0.18;
    const y = p.y + ny * 0.18 + ELEV_TEXT_IN * 0.35;
    const ext = textExtent({ x, text, size: ELEV_TEXT_IN, anchor: "middle" });
    // a label far longer than its drawn segment is left off rather than overlapping its neighbours
    if (ext.x1 - ext.x0 <= (z - a) * s + 0.8 && ext.x0 >= 0 && ext.x1 <= box.wIn && y >= ELEV_TEXT_IN && y <= box.hIn)
      shapes.push({ kind: "text", x, y, text, size: ELEV_TEXT_IN, anchor: "middle" });
    const c = starts[i].center;
    if (sub && seg.kind === "arc" && c) {
      const pc = P(c);
      if (pc.x > 0.1 && pc.x < box.wIn - 0.1 && pc.y > 0.1 && pc.y < box.hIn - 0.1) {
        shapes.push(
          { kind: "line", tag: "dim", x1: p.x, y1: p.y, x2: pc.x, y2: pc.y, stroke: "thin", dash: true },
          { kind: "line", tag: "dim", x1: pc.x - 0.06, y1: pc.y, x2: pc.x + 0.06, y2: pc.y, stroke: "thin" },
          { kind: "line", tag: "dim", x1: pc.x, y1: pc.y - 0.06, x2: pc.x, y2: pc.y + 0.06, stroke: "thin" }
        );
      }
    }
  });

  // footprint: overall width above, depth to the right
  const top = oy;
  const bottom = oy + depthFt * s;
  const left = ox;
  const right = ox + widthFt * s;
  const wy = top - 0.28;
  shapes.push(
    { kind: "line", tag: "dim", x1: left, y1: wy, x2: right, y2: wy, stroke: "thin" },
    { kind: "line", tag: "dim", x1: left, y1: wy - 0.04, x2: left, y2: wy + 0.08, stroke: "thin" },
    { kind: "line", tag: "dim", x1: right, y1: wy - 0.04, x2: right, y2: wy + 0.08, stroke: "thin" },
    { kind: "text", x: (left + right) / 2, y: wy - 0.05, text: `${ftIn(widthFt)} overall`, size: ELEV_TEXT_IN, anchor: "middle" }
  );
  if (depthFt * s > 0.05) {
    // kept inside the box so the rotated label never runs off the right edge
    const dx = Math.min(right + 0.28, box.wIn - 0.2);
    shapes.push(
      { kind: "line", tag: "dim", x1: dx, y1: top, x2: dx, y2: bottom, stroke: "thin" },
      { kind: "line", tag: "dim", x1: dx - 0.08, y1: top, x2: dx + 0.04, y2: top, stroke: "thin" },
      { kind: "line", tag: "dim", x1: dx - 0.08, y1: bottom, x2: dx + 0.04, y2: bottom, stroke: "thin" },
      { kind: "text", x: Math.min(dx + 0.12, box.wIn - ELEV_TEXT_IN / 2 - 0.01), y: (top + bottom) / 2, text: `${ftIn(depthFt)} deep`, size: ELEV_TEXT_IN, anchor: "middle", rotate: -90 }
    );
  }

  if (sub && src.opening === "bipart") {
    // the center split, and the lap as a second line beside the track
    const mid = L / 2;
    const p = at(mid);
    const { nx, ny } = normal(mid);
    shapes.push({ kind: "line", tag: "mark", x1: p.x - nx * 0.12, y1: p.y - ny * 0.12, x2: p.x + nx * 0.12, y2: p.y + ny * 0.12, stroke: "med" });
    if (src.lapOverlapFt > 0) {
      const h = Math.min(src.lapOverlapFt, L) / 2;
      const lap = Array.from({ length: 13 }, (_, k) => mid - h + (2 * h * k) / 12).map((d) => {
        const q = at(d);
        const n = normal(d);
        return { x: q.x - n.nx * 0.05, y: q.y - n.ny * 0.05 };
      });
      shapes.push(
        { kind: "path", tag: "band", d: pathD(lap), stroke: "med" },
        { kind: "text", x: p.x - nx * 0.24, y: p.y - ny * 0.24 + ELEV_TEXT_IN * 0.35, text: `${ftIn(src.lapOverlapFt)} lap`, size: ELEV_TEXT_IN * 0.9, anchor: "middle" }
      );
    }
  }

  // which way each half travels as it opens (Submittal)
  const arrow = (d: number, dir: 1 | -1) => {
    const len = Math.min(0.3, (L * s) / 6);
    const { nx, ny } = normal(d);
    const off = (q: { x: number; y: number }) => ({ x: q.x - nx * 0.14, y: q.y - ny * 0.14 });
    const p0 = off(at(d));
    const p1 = off(at(Math.min(L, Math.max(0, d + (dir * len) / s))));
    const tl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const ux = (p1.x - p0.x) / tl;
    const uy = (p1.y - p0.y) / tl;
    const hd = 0.05;
    shapes.push(
      { kind: "line", tag: "dim", x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, stroke: "thin" },
      { kind: "path", tag: "dim", d: pathD([{ x: p1.x - ux * hd - uy * hd * 0.6, y: p1.y - uy * hd + ux * hd * 0.6 }, p1, { x: p1.x - ux * hd + uy * hd * 0.6, y: p1.y - uy * hd - ux * hd * 0.6 }]), stroke: "thin" }
    );
  };
  if (sub && src.opening === "bipart") {
    arrow(L * 0.4, -1);
    arrow(L * 0.6, 1);
  } else if (sub && src.opening === "oneway") arrow(L * 0.5, 1);

  const points = hangingPointsAlong(src);
  if (sub) {
    for (const d of points) {
      const p = at(d);
      const { nx, ny } = normal(d);
      shapes.push({ kind: "line", tag: "mark", x1: p.x - nx * 0.06, y1: p.y - ny * 0.06, x2: p.x + nx * 0.06, y2: p.y + ny * 0.06, stroke: "thin" });
    }
    shapes.push({ kind: "text", x: 0.15, y: box.hIn - 0.15, text: `${src.mountLabel} (${points.length}${src.trackQty > 1 ? " per track" : ""})`, size: ELEV_TEXT_IN, bold: true });
  }

  // the audience, below the open side of the curve
  const ax = box.wIn / 2;
  const ay = Math.min(bottom + 0.3, box.hIn - 0.3);
  shapes.push(
    { kind: "line", tag: "dim", x1: ax, y1: ay, x2: ax, y2: ay + 0.12, stroke: "thin" },
    { kind: "path", tag: "dim", d: pathD([{ x: ax - 0.04, y: ay + 0.08 }, { x: ax, y: ay + 0.12 }, { x: ax + 0.04, y: ay + 0.08 }]), stroke: "thin" },
    { kind: "text", x: ax, y: ay + 0.24, text: "AUDIENCE", size: ELEV_TEXT_IN, anchor: "middle", bold: true }
  );
  return { scale: scaleLabel, shapes, hangingCount: points.length };
}
