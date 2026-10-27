// src/lib/design/room-shape/types.ts
/**
 * #370: the Grid room shape — a design's plan as rooms and zones whose outlines are edited by hand. Feet; origin =
 * the template's centreline at its `origin` line (the plaster line / platform front); x right, y DOWN the sheet.
 * Spec docs/superpowers/specs/2026-10-25-grid-room-shape-editor-design.md (Amendment A overrides §1–§4).
 */
export type ShapePt = { x: number; y: number };

/** One edge, from pts[i] to pts[(i + 1) % n]. `open` = no wall drawn along it (an opening, a stage lip). */
export type ShapeEdge =
  | { kind: "line"; open?: true }
  /** A true arc. bulge = tan(sweep / 4); the arc's midpoint sits bulge × chord / 2 off the chord's middle along the edge's left normal (−dy, dx). */
  | { kind: "arc"; bulge: number; open?: true }
  /** A free-form cubic Bezier; c1 / c2 are absolute handles, feet. */
  | { kind: "curve"; c1: ShapePt; c2: ShapePt; open?: true };

/** Slice 1's roles (slice 2 adds mix / electrical). Each sits on at most one room. */
export const ROOM_ROLES = ["stage", "house", "booth", "catwalk"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

export const ROOM_TYPE_KEYS = [
  "stage", "house", "pit", "catwalk", "mix", "followspot", "camera", "booth", "electrical", "hallway", "lobby",
  "music", "choir", "green", "dressing", "storage", "office", "other",
] as const;
export type RoomTypeKey = (typeof ROOM_TYPE_KEYS)[number];
export type RoomTypeDef = { label: string; kind: "room" | "zone"; sizeFt: [number, number] | null };

/** The fixed room list (spec §3). `sizeFt` (width × depth) is the drop size slice 2 uses; null = template-only. */
export const ROOM_TYPES: Record<RoomTypeKey, RoomTypeDef> = {
  stage: { label: "Stage", kind: "room", sizeFt: null },
  house: { label: "House", kind: "room", sizeFt: null },
  pit: { label: "Pit", kind: "room", sizeFt: null },
  catwalk: { label: "Catwalk", kind: "zone", sizeFt: null },
  mix: { label: "Center mix position", kind: "zone", sizeFt: [8, 6] },
  followspot: { label: "Followspot position", kind: "zone", sizeFt: [6, 4] },
  camera: { label: "Camera position", kind: "zone", sizeFt: [6, 6] },
  booth: { label: "Booth", kind: "room", sizeFt: [12, 10] },
  electrical: { label: "Electrical room", kind: "room", sizeFt: [10, 12] },
  hallway: { label: "Hallway", kind: "room", sizeFt: [6, 30] },
  lobby: { label: "Lobby", kind: "room", sizeFt: [30, 20] },
  music: { label: "Music room", kind: "room", sizeFt: [30, 25] },
  choir: { label: "Choir room", kind: "room", sizeFt: [30, 25] },
  green: { label: "Green room", kind: "room", sizeFt: [15, 20] },
  dressing: { label: "Dressing room", kind: "room", sizeFt: [12, 15] },
  storage: { label: "Storage", kind: "room", sizeFt: [10, 10] },
  office: { label: "Office", kind: "room", sizeFt: [10, 10] },
  other: { label: "Other", kind: "room", sizeFt: [10, 10] },
};

export type ShapeRoom = {
  /** "rm_" + 8 hex, stable for the room's life. */
  id: string;
  type: RoomTypeKey;
  name: string;
  /** room = walled (its non-open edges); zone = dashed outline, no walls. */
  kind: "room" | "zone";
  roles: RoomRole[];
  /** ≥ 3, ≤ 64, closed. */
  pts: ShapePt[];
  /** edges[i] runs pts[i] → pts[(i + 1) % n]; edges.length === pts.length. */
  edges: ShapeEdge[];
};

export type RoomShape = { v: 1; fromTemplate: string; rooms: ShapeRoom[]; frozenAt: number; by: string };

/** Where a shape-drawn sheet sits in feet: normalized u = (x − minX) / wFt, v = (y − minY) / hFt. */
export type SheetFrame = { minX: number; minY: number; wFt: number; hFt: number };

export const SHAPE_LIMITS = { rooms: 40, minPts: 3, pts: 64, coordFt: 2000, bulge: 10, name: 60, glueFt: 0.5 / 12, wallFt: 0.5 } as const;
