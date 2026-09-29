/**
 * Venue templates (#249, #255) — background drawings converted from Jeff's
 * DWGs (scripts/venue-template-convert.py) plus hand-written key lines. All
 * template coordinates are drawing inches, x right, y UP (CAD convention).
 */
export type Pt = { x: number; y: number };
export type TemplateArc = { cx: number; cy: number; r: number; a0: number; a1: number };
/** A label drawn in the DWG, or placed by Claude from source/<kind>.labels.json (`added`, #255). Anchored at its top-left corner. */
export type TemplateLabel = { text: string; x: number; y: number; h: number; added?: boolean };

/** The converter's output (<kind>.json). */
export type VenueTemplate = {
  kind: string;
  source: string;
  /** #255: drawing inches the converter subtracted from every coordinate (a drawing far from its own origin). */
  origin?: [number, number];
  units: "in";
  extents: { minX: number; minY: number; maxX: number; maxY: number };
  segments: Array<[number, number, number, number]>;
  arcs: TemplateArc[];
  labels: TemplateLabel[];
};

/** A region outline or named line: corner points and arc runs (sampled `from` → `to` degrees, either direction). */
export type PathItem = Pt | { arc: { cx: number; cy: number; r: number; from: number; to: number } };

export type YDrive = "fixed" | "stageDepth" | "houseOpen";

/**
 * #255: one span of a side-to-side map, from the previous span's end (0 = the
 * centreline) out to half-distance `to` (drawing inches). "pro" spans share the
 * pro / platform half-width, "wing" spans the wing width, "fixed" spans keep
 * their size, "absorb" spans share whatever is left to reach the house
 * half-width at the end of the last absorb span. Past the last span every
 * point rides along, so outer walls keep 6".
 */
export type XDrive = "pro" | "wing" | "fixed" | "absorb";
export type XSpan = { to: number; drive: XDrive };

export type XMap =
  /** One side-to-side map at every y. */
  | { kind: "spans"; spans: XSpan[] }
  /** `upper` at y ≥ yStart, `lower` at y ≤ yEnd, blended linearly between. yStart === yEnd switches hard: y > yStart is upper, the line itself is lower. */
  | { kind: "blend"; upper: XSpan[]; lower: XSpan[]; yStart: number; yEnd: number };

/**
 * #255: arcs that must stay true circles (an apse, a pointed stage front).
 * Each arc of the group keeps its circle: its two ends go wherever the map
 * sends them and its radius scales by k — the mapped ÷ drawn length of the
 * half-width `scaleHalf`, measured at y = `atY`.
 */
export type TrueArcGroup = {
  centres: Pt[];
  scaleHalf: number;
  atY: number;
  /** Labels above this y and inside the group's smallest drawn circle move with it (a similarity about its centre). */
  zoneMinY?: number;
};

export type TemplateKeys = {
  kind: string;
  /** Centreline x — everything maps symmetrically about it. */
  cx: number;
  /** Side-to-side map (#255: span lists; #249's stage/back blend is one of them). */
  x: XMap;
  /** Contiguous spans, top → bottom, each fixed or driven by an input. */
  ySpans: Array<{ from: number; to: number; drive: YDrive }>;
  /** A y key line that never moves (proscenium: the plaster line; church: the platform front). */
  origin: number;
  /** Stage / platform depth runs origin → stageDepthTo; house / nave depth runs origin → houseDepthTo. */
  stageDepthTo: number;
  houseDepthTo: number;
  /** Pit geometry (proscenium only): segments wholly inside `bbox` and labels in `labels` hide when the pit is off, and so does `region`. */
  pit?: { region: string; bbox: { minX: number; maxX: number; minY: number; maxY: number }; labels: string[] };
  /** Region id → outline. The id is also the display label unless `regionLabels` renames it. */
  regions: Record<string, PathItem[]>;
  /** #255: display text for region ids that differ from it — duplicate labels ("storage-1" → "Storage"). */
  regionLabels?: Record<string, string>;
  /** #255: region ids in starter-Space order. */
  spaces: string[];
  /** #255: the region ids that play each part for plans, Spaces and Auto fill. */
  roles: { stage: string; house: string; booth?: string; catwalk?: string };
  lines: Record<string, PathItem[]>;
  points: Record<string, Pt>;
  /** Display texts the drawing must carry; a text listed n times must appear n times. */
  requiredLabels: string[];
  /** The drawing's own size — the stretch is the identity here. */
  defaults: { proWidthFt: number; wingFt: number; stageDepthFt: number; houseWidthFt: number; houseDepthFt: number };
  trueArcs?: TrueArcGroup[];
};

export type StretchDims = { proWidthFt: number; wingFt: number; stageDepthFt: number; houseWidthFt: number; houseDepthFt: number; pit: boolean };

export type StretchedPlan = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  polylines: Pt[][];
  labels: TemplateLabel[];
  regions: Record<string, Pt[]>;
  /** Region id → display text, for every region in `regions`. */
  regionLabels: Record<string, string>;
  lines: Record<string, Pt[]>;
  points: Record<string, Pt>;
  map: (p: Pt) => Pt;
};
