/**
 * Venue templates (#247) — a background drawing converted from Jeff's DWG
 * (scripts/venue-template-convert.py) plus its hand-written key lines. All
 * template coordinates are drawing inches, x right, y UP (CAD convention).
 */
export type Pt = { x: number; y: number };
export type TemplateArc = { cx: number; cy: number; r: number; a0: number; a1: number };
export type TemplateLabel = { text: string; x: number; y: number; h: number };

/** The converter's output (<kind>.json). Labels are anchored at their top-left corner. */
export type VenueTemplate = {
  kind: string;
  source: string;
  units: "in";
  extents: { minX: number; minY: number; maxX: number; maxY: number };
  segments: Array<[number, number, number, number]>;
  arcs: TemplateArc[];
  labels: TemplateLabel[];
};

/** A region outline or named line: corner points and arc runs (sampled `from` → `to` degrees, either direction). */
export type PathItem = Pt | { arc: { cx: number; cy: number; r: number; from: number; to: number } };

export type YDrive = "fixed" | "stageDepth" | "houseOpen";

export type TemplateKeys = {
  kind: string;
  /** Centreline x — everything maps symmetrically about it. */
  cx: number;
  /** Across the stage: |dx| ≤ proHalf follows pro width, proHalf → innerHalf (inner wall face) follows wing width, beyond rides along. */
  stageX: { proHalf: number; innerHalf: number };
  /** Across the back of the house: |dx| ≤ rigidHalf keeps its size, rigidHalf → innerHalf follows house width, beyond rides along. */
  backX: { rigidHalf: number; innerHalf: number };
  /** The stage map holds at y ≥ yStart, the back-of-house map at y ≤ yEnd, blended linearly between. */
  blend: { yStart: number; yEnd: number };
  /** Contiguous spans, top → bottom, each fixed or driven by an input. */
  ySpans: Array<{ from: number; to: number; drive: YDrive }>;
  /** The plaster line — a y key line that never moves. */
  origin: number;
  /** Stage depth runs origin → stageDepthTo; house depth runs origin → houseDepthTo. */
  stageDepthTo: number;
  houseDepthTo: number;
  /** Pit geometry: segments wholly inside `bbox` and labels in `labels` hide when the pit is off, and so does `region`. */
  pit: { region: string; bbox: { minX: number; maxX: number; minY: number; maxY: number }; labels: string[] };
  regions: Record<string, PathItem[]>;
  lines: Record<string, PathItem[]>;
  points: Record<string, Pt>;
  requiredLabels: string[];
  /** The drawing's own size — the stretch is the identity here. */
  defaults: { proWidthFt: number; wingFt: number; stageDepthFt: number; houseWidthFt: number; houseDepthFt: number };
};

export type StretchDims = { proWidthFt: number; wingFt: number; stageDepthFt: number; houseWidthFt: number; houseDepthFt: number; pit: boolean };

export type StretchedPlan = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  polylines: Pt[][];
  labels: TemplateLabel[];
  regions: Record<string, Pt[]>;
  lines: Record<string, Pt[]>;
  points: Record<string, Pt>;
  map: (p: Pt) => Pt;
};
