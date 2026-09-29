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
  /** #255: closed splines that are axis-aligned rounded rectangles (corner extents rx/ry), kept for reference — a template draws its curves from key lines. */
  roundRects?: Array<{ minX: number; minY: number; maxX: number; maxY: number; rx: number; ry: number }>;
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
 * point rides along, so outer walls keep 6". "face" spans (a profile's
 * per-band `outside` only) end where that band's inside face reaches the same
 * drawn half-width: the span's end maps to the mapped face there, so a wall
 * drawn meeting the face still meets it at any size. A "face" span follows
 * only pro / wing / fixed / face spans.
 */
export type XDrive = "pro" | "wing" | "fixed" | "absorb" | "face";
export type XSpan = { to: number; drive: XDrive };

export type XMap =
  /** One side-to-side map at every y. */
  | { kind: "spans"; spans: XSpan[] }
  /** `upper` at y ≥ yStart, `lower` at y ≤ yEnd, blended linearly between. yStart === yEnd switches hard: y > yStart is upper, the line itself is lower. */
  | { kind: "blend"; upper: XSpan[]; lower: XSpan[]; yStart: number; yEnd: number }
  /**
   * #255: a room whose inside face is a y-profile (splayed walls). Keys run top → bottom; between them the drawn
   * half-width is linear in y. A point inside the face scales by new ÷ drawn half-width — the new half-width
   * interpolated in MAPPED y, so a splayed wall stays straight whatever the front-to-back map does. Beyond the
   * face the `outside` span map applies (the rooms behind a splay, the outer walls) — or, for the rows from a key
   * down to the next, that key's own `outside` when it has one (#255 fix: a band's rooms follow its own face).
   */
  | { kind: "profile"; keys: Array<{ y: number; half: number; drive: "pro" | "house"; outside?: XSpan[] }>; outside: XSpan[] };

/**
 * #255: arcs that must stay true circles (an apse, a pointed stage front).
 * The innermost (smallest partial) arc on each drawn centre keeps its circle:
 * its two ends go wherever the map sends them and its radius scales by k — the
 * mapped ÷ drawn length of the half-width `scaleHalf`, measured at y = `atY`.
 * Other arcs on that centre stay concentric with it: same mapped centre, their
 * drawn radius offset kept (a 6" wall stays 6"), ends where the circle crosses
 * the mapped y of their drawn ends. A full 360° circle is a similarity about
 * its mapped centre (radius × k). Arcs that are not concentric (a mirrored
 * pointed front) belong in separate groups.
 *
 * Without scaleHalf an arc keeps its sweep: its radius follows its mapped chord (a quarter-circle corner stays a
 * tangent quarter circle). A full circle (no chord) then keeps its drawn radius about its mapped centre.
 */
export type TrueArcGroup = {
  centres: Pt[];
  scaleHalf?: number;
  atY?: number;
  /** Labels above this y and inside the group's smallest drawn circle move with it (a similarity about its centre). */
  zoneMinY?: number;
};

/**
 * #255: a diagonal wall. `ref` is the face on the key lines — it follows the map. Each `faces` segment is redrawn
 * parallel to the mapped ref at its drawn perpendicular distance (a 45° wall stays 6" whatever angle it takes), and
 * every drawn segment that ended on a face is moved along itself onto the redrawn face.
 */
export type WallPair = { ref: [Pt, Pt]; faces: Array<[Pt, Pt]> };

/**
 * #255: a wall a movable element can sit against — listed so the room lies on its LEFT; the element sits on its
 * right. Only its two ends are mapped and the element is laid along the straight line between them, so the wall
 * must map straight: every point along it must land on that line at any size (one straight face, not across a
 * blend's switch, a profile's bend or a redrawn diagonal's corner). Its drawn length must not be zero.
 */
export type MovableWall = { from: Pt; to: Pt };

/**
 * #255: a movable element — a room drawn against a wall (the Gym Stage Booth, the Blackbox rooms). Every drawn
 * segment with both ends in `bbox`, every drawn arc wholly inside it, every label anchored in it and the region
 * `region` (which must exist) are lifted out of the stretch and re-placed afterwards against the chosen wall,
 * keeping their drawn size, turned to face in. Only those travel: key `points` and key `lines` inside `bbox` are
 * NOT lifted — they stay where the stretch maps them — so a template keeps them outside its movables. `id`s are
 * unique and every wall in `walls` names a `movableWalls` entry (a template breaking either throws, named).
 * A `sized` element has no bbox and no drawn lines: see `sized`.
 */
export type Movable = {
  id: string;
  region: string;
  bbox?: { minX: number; maxX: number; minY: number; maxY: number };
  /**
   * #255: a code-drawn rectangle sized by StretchDims.movableSizes[id] (no drawn lines, no bbox): `alongFt` along its
   * wall centred on the attachment point, `depthFt` out to the wall's right (list an inner wall clockwise to put it
   * inside the room). Its region (`region`, created — not drawn in `regions`) is that rectangle. No size = a
   * zero-size rectangle at its anchor.
   */
  sized?: true;
  home: { wall: string; anchor: Pt };
  walls: string[];
};

export type PlacedMovable = {
  wall: string;
  /** 0..1 along the wall's usable run. */
  t: number;
  /** The element's centre, stretched inches. */
  centre: Pt;
  /** The middle of its outer face (the side farthest from the wall), stretched inches — where its drag handle sits, clear of the wall's own. */
  outer: Pt;
  fits: boolean;
  /** Per allowed wall: its mapped ends and the usable range of the attachment point along it (lo…hi), sMid = the centre's offset. */
  runs: Record<string, { from: Pt; to: Pt; lo: number; hi: number; sMid: number }>;
};

export type TemplateKeys = {
  kind: string;
  /** Centreline x — everything maps symmetrically about it. */
  cx: number;
  /** Side-to-side map (#255: span lists; #249's stage/back blend is one of them). */
  x: XMap;
  /** Contiguous spans, top → bottom, each fixed or driven by an input. */
  ySpans: Array<{ from: number; to: number; drive: YDrive }>;
  /** #255: a front-to-back map mirrored about y = cy (pro = stage depth / 2, wing = wing, house = house depth / 2); replaces ySpans. */
  yMap?: { cy: number; spans: XSpan[] };
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
  /** #255: ids of `lines` that are part of the drawing. */
  drawn?: string[];
  points: Record<string, Pt>;
  /** Display texts the drawing must carry; a text listed n times must appear n times. */
  requiredLabels: string[];
  /** The drawing's own size — the stretch is the identity here. */
  defaults: { proWidthFt: number; wingFt: number; stageDepthFt: number; houseWidthFt: number; houseDepthFt: number };
  trueArcs?: TrueArcGroup[];
  walls?: WallPair[];
  movableWalls?: Record<string, MovableWall>;
  /** Display names for the walls ("Back", "Left side"…) — the fit warning names a wall by it; default = the id as written. */
  movableWallLabels?: Record<string, string>;
  movables?: Movable[];
  /** Clearance between two elements on one wall, inches (default 24). */
  movableGap?: number;
};

export type StretchDims = {
  proWidthFt: number;
  wingFt: number;
  stageDepthFt: number;
  houseWidthFt: number;
  houseDepthFt: number;
  pit: boolean;
  /** #255: where each movable element sits — `t` 0..1 along the wall's usable run; absent / null = home, or the middle of another wall. */
  movables?: Record<string, { wall: string; t: number | null }>;
  /** #255: each code-sized movable's size (see Movable.sized), feet. */
  movableSizes?: Record<string, { alongFt: number; depthFt: number }>;
};

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
  /** #255: every movable element as placed (empty when the template has none). */
  movables: Record<string, PlacedMovable>;
  /** #255: plan-level notes for the user ("Not everything fits on the … wall"). */
  warnings: string[];
};
