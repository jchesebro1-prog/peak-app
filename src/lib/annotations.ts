/* ------------------------------------------------------------------ *
 * Document markup (D95) — pure types + geometry helpers.
 * Design: docs/superpowers/specs/2026-07-19-review-markup-accountability-design.md
 *
 * Dependency-free on purpose (same rule as lib/consulting-review.ts): the
 * markup canvas is a client component and must not drag the doc-store, and
 * therefore PGlite, into the browser bundle.
 *
 * COORDINATES ARE NORMALIZED 0..1 against the page box. That single choice
 * is what makes zoom, window size, device pixel ratio, and PDF page
 * dimensions all irrelevant to storage — an annotation drawn at 50% zoom on
 * a laptop lands in exactly the same spot on a 4K monitor at 200%.
 * ------------------------------------------------------------------ */

export type AnnotationTool =
  | "rect"
  | "ellipse"
  | "arrow"
  | "freehand"
  | "cloud"
  | "text"
  | "highlight"
  /** Two-point dimension line, labelled with real-world length once the
   *  page is calibrated. */
  | "measure"
  /** Single-point tally marker, grouped by label and totalled in the
   *  sidebar — counting fixtures off a plan is the whole job some days. */
  | "count";

export type Point = { x: number; y: number };

export type Annotation = {
  id: string; // uid('an-')
  /** EngagementDoc id this markup belongs to. */
  docId: string;
  /** 1-based page; images are always page 1. */
  page: number;
  tool: AnnotationTool;
  color: string;
  /** Normalized 0..1. Two points for rect/ellipse/arrow/highlight (drag
   *  start + end); many for freehand and cloud; one for text. */
  points: Point[];
  /** Body for the text tool. */
  text: string;
  author: string;
  at: number;
  /** Review comment raised from this markup, when there is one — the link
   *  that makes markup part of the accountability trail rather than
   *  decoration sitting beside it. */
  commentId: string | null;
};

export const TOOL_LABEL: Record<AnnotationTool, string> = {
  rect: "Box",
  ellipse: "Ellipse",
  arrow: "Arrow",
  freehand: "Draw",
  cloud: "Revision cloud",
  text: "Text",
  highlight: "Highlight",
  measure: "Measure",
  count: "Count",
};

/** Compact glyphs for the sidebar buttons. */
export const TOOL_ICON: Record<AnnotationTool, string> = {
  rect: "▭",
  ellipse: "◯",
  arrow: "↗",
  freehand: "✎",
  cloud: "☁",
  text: "T",
  highlight: "▬",
  measure: "↔",
  count: "①",
};

/** Bluebeam-ish defaults: red reads as "change this" to every architect. */
export const ANNOTATION_COLORS = ["#d5342a", "#e08b1f", "#2e9e6b", "#3155a8", "#6b4fa1", "#16181d"];

export const DEFAULT_COLOR = ANNOTATION_COLORS[0];

/** Tools defined by a simple drag from corner to corner. */
export function isDragTool(t: AnnotationTool): boolean {
  return (
    t === "rect" || t === "ellipse" || t === "arrow" || t === "highlight" || t === "measure"
  );
}

/** Tools placed with a single click rather than a drag. */
export function isPointTool(t: AnnotationTool): boolean {
  return t === "text" || t === "count";
}

/* ------------------------- scale & measurement ------------------------- */

export const MEASURE_UNITS = ["ft", "in", "m", "mm"] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

/**
 * Real-world scale for one page of one document. `scale` is real units per
 * ONE PAGE WIDTH of normalized distance — see pageDistance() for why that
 * unit choice makes the whole thing zoom-independent.
 */
export type Calibration = {
  docId: string;
  page: number;
  scale: number;
  unit: MeasureUnit;
  /** The reference length the user typed, kept so the basis is auditable. */
  refLength: number;
  by: string;
  at: number;
};

/**
 * Distance between two normalized points, expressed in page widths.
 *
 * x and y are independent fractions of width and height, so a naive hypot on
 * them is wrong on any non-square page — a 45° line would measure differently
 * than it should. Scaling y by the page's aspect ratio (height/width) puts
 * both axes in the same unit. Aspect is itself zoom-independent (it is a
 * property of the page, not the canvas), which is what lets a measurement
 * taken at 50% read identically at 300%.
 */
export function pageDistance(a: Point, b: Point, aspect: number): number {
  const dx = b.x - a.x;
  const dy = (b.y - a.y) * aspect;
  return Math.hypot(dx, dy);
}

/** Derive the scale factor from a drawn reference of known real length. */
export function calibrationScale(
  a: Point,
  b: Point,
  aspect: number,
  realLength: number
): number | null {
  const d = pageDistance(a, b, aspect);
  if (!(d > 0) || !(realLength > 0)) return null;
  return realLength / d;
}

/** Measured length of a two-point annotation, or null when uncalibrated. */
export function measureLength(
  points: Point[],
  aspect: number,
  cal: Calibration | null
): number | null {
  if (!cal || points.length < 2) return null;
  return pageDistance(points[0], points[points.length - 1], aspect) * cal.scale;
}

/** Feet render as 12'-6" — the form every drawing and shop order uses. */
export function formatMeasure(value: number, unit: MeasureUnit): string {
  if (!Number.isFinite(value)) return "";
  if (unit === "ft") {
    const whole = Math.floor(value);
    const inches = Math.round((value - whole) * 12);
    if (inches === 12) return `${whole + 1}'-0"`;
    return `${whole}'-${inches}"`;
  }
  const decimals = unit === "mm" ? 0 : 2;
  return `${value.toFixed(decimals)} ${unit}`;
}

export function findCalibration(
  cals: Calibration[],
  docId: string,
  page: number
): Calibration | null {
  return cals.find((c) => c.docId === docId && c.page === page) || null;
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Axis-aligned box around any point set — used for hit-testing and for
 *  placing the delete affordance. */
export function bounds(points: Point[]): { x: number; y: number; w: number; h: number } {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Generous hit box — markup strokes are thin, and a 2px target is unusable
 *  when you are clicking one of forty comments on a drawing. */
export function hitTest(a: Annotation, p: Point, pad = 0.012): boolean {
  const b = bounds(a.points);
  return (
    p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad
  );
}

/**
 * Revision-cloud path: scalloped arcs around the drawn box. Architects read
 * a cloud as "this changed", so it earns its own tool rather than being a
 * dashed rectangle.
 */
export function cloudPath(points: Point[], w: number, h: number): string {
  const b = bounds(points);
  const x = b.x * w;
  const y = b.y * h;
  const bw = b.w * w;
  const bh = b.h * h;
  if (bw < 4 || bh < 4) return "";
  // Arc radius scaled to the box so small clouds don't collapse into circles.
  const r = Math.max(6, Math.min(16, Math.min(bw, bh) / 6));
  const seg: string[] = [`M ${x} ${y}`];
  /** Walk one edge as a run of outward scallops. */
  const edge = (len: number, dx: number, dy: number) => {
    const n = Math.max(1, Math.round(len / (r * 1.6)));
    const step = len / n;
    for (let i = 0; i < n; i++) {
      seg.push(`a ${r} ${r} 0 0 1 ${(dx * step).toFixed(2)} ${(dy * step).toFixed(2)}`);
    }
  };
  edge(bw, 1, 0);
  edge(bh, 0, 1);
  edge(bw, -1, 0);
  edge(bh, 0, -1);
  seg.push("z");
  return seg.join(" ");
}

/** Polyline through freehand points, in pixel space. */
export function polyPath(points: Point[], w: number, h: number): string {
  if (!points.length) return "";
  return points.map((p, i) => `${i ? "L" : "M"} ${p.x * w} ${p.y * h}`).join(" ");
}
