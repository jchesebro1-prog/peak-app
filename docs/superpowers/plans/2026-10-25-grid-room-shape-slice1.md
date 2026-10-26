# Grid Room Shape Editor — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Grid intake, let a person reshape the template plan — drag corners, split walls, curve them (true arc or free-form), turn wall stretches into openings — and have the base sheet, its Spaces, its calibration and Auto fill all drawn from that shape.

**Architecture:** A new pure module family `src/lib/design/room-shape/` holds the data model, geometry, a freeze step that converts the stretched venue template into a `RoomShape` (rooms + zones with line / arc / Bezier edges, walls detected from the drawing's double lines), validation, edit operations, snapping, the sheet SVG, Spaces and the Auto-fill frame. A client editor (`src/components/room-shape/`) edits a `RoomShape` held in the intake's state; `saveGridIntakeAction` sanitizes it and `generateBaseSheet` draws the base sheet from it and stamps it, the way it stamps the template today.

**Tech Stack:** Next.js 16 App Router (server actions), TypeScript, React client components, plain SVG, the repo's `tsx` harness (`scripts/test-*.ts` → `npm run test:specs`). No new dependencies, no migration.

**Spec:** `docs/superpowers/specs/2026-10-25-grid-room-shape-editor-design.md` — **Amendment A overrides §1–§4** where they disagree (open edges, zones from walled share, roles on the room).

## Global Constraints

- Coordinates are **feet**; origin = the template's centreline at its `origin` line (`stretchById(...).map({ x: keys.cx, y: keys.origin })`); **x right, y DOWN the sheet**. Template inches (y up) convert with `x = (X − O.x) / 12`, `y = (O.y − Y) / 12`.
- Walls are **6"** (`SHAPE_LIMITS.wallFt = 0.5`), drawn **outward** from the room's outline (the outline is the room's inside face).
- Caps: **40** rooms, **3–64** corners per room, |coord| ≤ **2,000 ft**, |bulge| ≤ **10**, name ≤ **60** chars. Corner glue = **0.5"** (`0.5 / 12` ft).
- Snap: **6"** grid (Shift = **1'**), directions at multiples of **45°** within **4°**, absolute or relative to the neighbouring wall.
- The server never trusts the client's shape: `sanitizeRoomShape` runs on every write; `by` / `frozenAt` are server-stamped.
- Roles in slice 1: `stage | house | booth | catwalk` only. Each role on at most one room; some room holds `stage` and some room `house` (may be the same room).
- Copy strings are exactly those in `src/lib/design/room-shape/copy.ts` (Task 1) — reuse the constants, never retype them.
- **No migration**, no new env var, no new dependency. Absent `intake.roomShape` = today's behaviour, byte-for-byte.
- **Dev DB safety (AGENTS.md):** never run a db script while `next dev` or another `tsx` holds `.data/pglite`; `npm run test:specs` uses its own `mktemp -d` PGlite and is safe.
- Verification gate before the final commit: `npx tsc --noEmit` (0 errors), `npm run test:specs` (ALL PASSED, report the PASS count), `npm run test:smoke` (ALL PASSED), `npx eslint` on changed `src/` files (0 errors), `npx next build` (passes — a client component importing a server store only breaks here).
- Work in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/room-shape` on branch `feat/370-room-shape`. Commit after every task with the message given, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/design/room-shape/types.ts` | `RoomShape` / `ShapeRoom` / `ShapeEdge` / `SheetFrame`, `ROOM_TYPES`, `ROOM_ROLES`, `SHAPE_LIMITS` |
| `src/lib/design/room-shape/copy.ts` | user-facing strings shared by client + server |
| `src/lib/design/room-shape/units.ts` | `parseFeet` / `fmtFeet` |
| `src/lib/design/room-shape/geometry.ts` | vector helpers, arc / Bezier math, sampling, split, area, self-crossing, wall bands |
| `src/lib/design/room-shape/fit.ts` | sampled outline → lines + arcs (`fitOutline`) |
| `src/lib/design/room-shape/walls.ts` | segment index, wall detection, `splitByWalls` |
| `src/lib/design/room-shape/freeze.ts` | `freezeFromTemplate` |
| `src/lib/design/room-shape/sanitize.ts` | `sanitizeRoomShape` |
| `src/lib/design/room-shape/edit.ts` | `applyEdit` + `EditOp` |
| `src/lib/design/room-shape/snap.ts` | `snapCorner` |
| `src/lib/design/room-shape/svg.ts` | `roomShapeSvg`, `pathD`, `labelPoint` |
| `src/lib/design/room-shape/spaces.ts` | feet ↔ sheet, `shapeSpaces`, `frameScale` |
| `src/lib/design/room-shape/frame.ts` | `shapeRoleBoxes` for Auto fill |
| `src/components/room-shape/length-input.tsx` | feet-and-inches text input |
| `src/components/room-shape/room-shape-editor.tsx` | the editor |
| `src/lib/stores/grid-projects.ts` | intake fields, `GridSpace.fromRoom`, `addSpace`, `generateBaseSheet` shape branch, `saveGridIntake` stamps |
| `src/app/(app)/design/grid/[id]/actions.ts` | `saveGridIntakeAction` sanitizes + passes the shape |
| `src/lib/design/grid-auto-layout.ts` | `venueFrame` / `fillGeometry` / `generateAutoLayout` shape branch |
| `src/lib/design/grid-auto-fill.ts` | passes the stamped shape |
| `src/app/(app)/design/grid/[id]/grid-intake.tsx` | the "Shape the room" step, locked fields, payload |
| `scripts/test-room-shape.ts` | `roomShapePureChecks` + `roomShapeDbChecks` |
| `scripts/room-shape-renders.ts` | writes `docs/room-shape/renders/*.svg` for review |
| `scripts/test-review-and-spec.ts` | wires the two check groups into `test:specs` |

---

### Task 1: Types, copy, units, geometry core + the harness file

**Files:**
- Create: `src/lib/design/room-shape/types.ts`, `src/lib/design/room-shape/copy.ts`, `src/lib/design/room-shape/units.ts`, `src/lib/design/room-shape/geometry.ts`, `scripts/test-room-shape.ts`
- Modify: `scripts/test-review-and-spec.ts` (import near line 11375, chain after line 11800)

**Interfaces:**
- Produces (types.ts): `ShapePt`, `ShapeEdge`, `RoomRole`, `ROOM_ROLES`, `RoomTypeKey`, `ROOM_TYPE_KEYS`, `ROOM_TYPES`, `ShapeRoom`, `RoomShape`, `SheetFrame`, `SHAPE_LIMITS`.
- Produces (units.ts): `parseFeet(text: string): number | null`, `fmtFeet(ft: number): string`.
- Produces (geometry.ts): `sub, add, mul, dot, dist, mid, lerp`, `leftNormal(a,b)`, `rotateAbout(p,c,t)`, `arcInfo(a,b,bulge): ArcInfo | null`, `bezierAt(a,c1,c2,b,t)`, `edgeAt(a,b,e,t)`, `edgeMid(a,b,e)`, `edgeLength(a,b,e)`, `sampleEdge(a,b,e,stepFt?,maxPts?)`, `outlinePoints(room,stepFt?,maxPerEdge?)`, `signedArea(pts)`, `centroid(pts)`, `bounds(pts)`, `selfCrosses(room)`, `bulgeForRadius(L,r,was)`, `bulgeForArcLength(L,s,was)`, `bulgeThrough(a,b,p)`, `splitEdge(a,b,e,t)`, `withOpen(e,open)`, `outwardNormalAt(room-area-sign, a, b, e, t)`, `wallBands(room,thickFt?)`.
- Produces (test file): `export async function roomShapePureChecks(ok: Ok): Promise<void>` and `export async function roomShapeDbChecks(ok: Ok): Promise<void>` (the DB group starts empty; Task 7 fills it).

- [ ] **Step 1: Prepare the worktree** (fresh worktrees lack `node_modules`, `.env.local` and `next-env.d.ts`)

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/room-shape
export PATH="$HOME/.local/node/bin:$PATH"
npm ci
cp /Users/sm/Downloads/peak-app/.env.local .env.local
cp /Users/sm/Downloads/peak-app/next-env.d.ts next-env.d.ts 2>/dev/null || true
npx tsc --noEmit -p . | tail -3
```
Expected: `npm ci` finishes; tsc prints nothing (0 errors). Do NOT symlink `node_modules`.

- [ ] **Step 2: Write `types.ts`**

```ts
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
```

- [ ] **Step 3: Write `copy.ts`**

```ts
// src/lib/design/room-shape/copy.ts
/** #370: the room shape's user-facing strings — one source for the intake, the editor and the server. */
export const SHAPE_STEP_TITLE = "Shape the room";
export const SHAPE_STEP_NOTE =
  "Click a room, then drag its corners — or click the dot in the middle of a wall to add a corner, curve it or make it an opening. Changing the plan redraws it from its rooms — stairs, seats and other drawing details are left off.";
export const SHAPE_FROZEN_NOTE = "Shape edited — dimensions come from the shape.";
export const SHAPE_STALE = "The venue's background changed after the room was shaped — reset the shape to continue.";
export const SHAPE_RESET_CONFIRM = "Reset to the template? Your changes to the room shape will be lost.";
export const SHAPE_UNREADABLE = "The room shape could not be read — reset it and try again.";
export const SHAPE_NEEDS_STAGE_HOUSE = "Every plan needs a Stage and a House.";
export const SHAPE_HINT = "Shift: 1' grid · Alt: move one corner only · scroll or pinch to zoom, drag the background to pan";
```

- [ ] **Step 4: Write `units.ts`**

```ts
// src/lib/design/room-shape/units.ts
/** #370: "42'-6\"", "42' 6\"", "42'", "42.5", "6\"" → feet, rounded to the inch; null for anything else or ≤ 0. */
export function parseFeet(text: string): number | null {
  const t = String(text ?? "").trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  let m: RegExpExecArray | null;
  let ft: number;
  if ((m = /^(\d+(?:\.\d+)?)\s*'?$/.exec(t))) ft = Number(m[1]);
  else if ((m = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"?$/.exec(t))) ft = Number(m[1]) + Number(m[2]) / 12;
  else if ((m = /^(\d+(?:\.\d+)?)\s*"$/.exec(t))) ft = Number(m[1]) / 12;
  else return null;
  const r = Math.round(ft * 12) / 12;
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Feet as 42'-6" (whole inches). */
export function fmtFeet(ft: number): string {
  const inches = Math.round(Math.abs(ft) * 12);
  return `${ft < 0 && inches > 0 ? "-" : ""}${Math.floor(inches / 12)}'-${inches % 12}"`;
}
```

- [ ] **Step 5: Write `geometry.ts`**

```ts
// src/lib/design/room-shape/geometry.ts
import { SHAPE_LIMITS, type ShapeEdge, type ShapePt, type ShapeRoom } from "./types";

/** #370: pure plane geometry for room shapes (feet). Every function is total: degenerate input returns a safe value. */
const EPS = 1e-9;
export const sub = (a: ShapePt, b: ShapePt): ShapePt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: ShapePt, b: ShapePt): ShapePt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: ShapePt, k: number): ShapePt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: ShapePt, b: ShapePt): number => a.x * b.x + a.y * b.y;
export const dist = (a: ShapePt, b: ShapePt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: ShapePt, b: ShapePt): ShapePt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: ShapePt, b: ShapePt, t: number): ShapePt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The unit left normal (−dy, dx) of a → b; zero for a zero-length edge. */
export function leftNormal(a: ShapePt, b: ShapePt): ShapePt {
  const d = sub(b, a), L = Math.hypot(d.x, d.y);
  return L < EPS ? { x: 0, y: 0 } : { x: -d.y / L, y: d.x / L };
}

/** p rotated by t radians about c (the standard rotation [[cos, −sin], [sin, cos]]). */
export function rotateAbout(p: ShapePt, c: ShapePt, t: number): ShapePt {
  const dx = p.x - c.x, dy = p.y - c.y, co = Math.cos(t), si = Math.sin(t);
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
}

export type ArcInfo = { centre: ShapePt; r: number; sweep: number; length: number };

/** An arc edge's circle. `sweep` is signed: rotating (a − centre) by it lands on b via the arc's midpoint. null when the chord is 0 or bulge ≈ 0. */
export function arcInfo(a: ShapePt, b: ShapePt, bulge: number): ArcInfo | null {
  const L = dist(a, b);
  if (L < EPS || !Number.isFinite(bulge) || Math.abs(bulge) < 1e-6) return null;
  const n = leftNormal(a, b), m = mid(a, b), s = (bulge * L) / 2;
  const r = (L * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const centre = add(m, mul(n, s - Math.sign(bulge) * r));
  const arcMid = add(m, mul(n, s));
  let sweep = 4 * Math.atan(Math.abs(bulge));
  if (dist(rotateAbout(a, centre, sweep / 2), arcMid) > 1e-6 * Math.max(1, r)) sweep = -sweep;
  return { centre, r, sweep, length: r * Math.abs(sweep) };
}

export function bezierAt(a: ShapePt, c1: ShapePt, c2: ShapePt, b: ShapePt, t: number): ShapePt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

/** The point at parameter t (0..1) along an edge (arc: by angle; curve: Bezier t; line: linear). */
export function edgeAt(a: ShapePt, b: ShapePt, e: ShapeEdge, t: number): ShapePt {
  if (e.kind === "arc") {
    const A = arcInfo(a, b, e.bulge);
    if (A) return rotateAbout(a, A.centre, A.sweep * t);
  }
  if (e.kind === "curve") return bezierAt(a, e.c1, e.c2, b, t);
  return lerp(a, b, t);
}
export const edgeMid = (a: ShapePt, b: ShapePt, e: ShapeEdge): ShapePt => edgeAt(a, b, e, 0.5);

export function edgeLength(a: ShapePt, b: ShapePt, e: ShapeEdge): number {
  if (e.kind === "arc") {
    const A = arcInfo(a, b, e.bulge);
    return A ? A.length : dist(a, b);
  }
  if (e.kind === "curve") {
    let L = 0, p = a;
    for (let i = 1; i <= 32; i++) {
      const q = bezierAt(a, e.c1, e.c2, b, i / 32);
      L += dist(p, q);
      p = q;
    }
    return L;
  }
  return dist(a, b);
}

/** Points along an edge from a (included) to b (excluded): a line gives [a]; a curve one point per stepFt, 2..maxPts. */
export function sampleEdge(a: ShapePt, b: ShapePt, e: ShapeEdge, stepFt = 0.5, maxPts = 64): ShapePt[] {
  if (e.kind === "line" || (e.kind === "arc" && !arcInfo(a, b, e.bulge))) return [a];
  const n = Math.max(2, Math.min(maxPts, Math.ceil(edgeLength(a, b, e) / stepFt)));
  return Array.from({ length: n }, (_, i) => edgeAt(a, b, e, i / n));
}

const LINE: ShapeEdge = { kind: "line" };
const edgeOf = (room: Pick<ShapeRoom, "edges">, i: number): ShapeEdge => room.edges[i] ?? LINE;

/** A room's closed outline as sampled points. */
export function outlinePoints(room: Pick<ShapeRoom, "pts" | "edges">, stepFt = 0.5, maxPerEdge = 64): ShapePt[] {
  const n = room.pts.length;
  return room.pts.flatMap((p, i) => sampleEdge(p, room.pts[(i + 1) % n], edgeOf(room, i), stepFt, maxPerEdge));
}

/** Shoelace area: > 0 when the interior is on the LEFT of each edge (pure algebra — independent of which way y points on screen). */
export function signedArea(pts: readonly ShapePt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function centroid(pts: readonly ShapePt[]): ShapePt {
  const A = signedArea(pts);
  if (Math.abs(A) < EPS) {
    const n = Math.max(1, pts.length);
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function bounds(pts: readonly ShapePt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Proper crossing of p1p2 and p3p4 (touching at an end does not count). */
function segsCross(p1: ShapePt, p2: ShapePt, p3: ShapePt, p4: ShapePt): boolean {
  const o = (a: ShapePt, b: ShapePt, c: ShapePt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/** Whether a room's outline crosses itself (sampled; neighbouring segments never count). */
export function selfCrosses(room: Pick<ShapeRoom, "pts" | "edges">): boolean {
  const p = outlinePoints(room, 0.5, 32);
  const n = p.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** The bulge giving radius r over chord L, keeping `was`'s side and minor / major-ness. null when r < L / 2. */
export function bulgeForRadius(L: number, r: number, was: number): number | null {
  if (!(L > 0) || !(r >= L / 2 - 1e-9)) return null;
  let sweep = 2 * Math.asin(Math.min(1, L / (2 * r)));
  if (Math.abs(was) > 1) sweep = 2 * Math.PI - sweep;
  const b = Math.tan(sweep / 4);
  return b > SHAPE_LIMITS.bulge ? null : (was < 0 ? -1 : 1) * b;
}

/** The bulge giving arc length s over chord L (s > L), `was`'s side. null when s ≤ L or past the bulge cap. */
export function bulgeForArcLength(L: number, s: number, was: number): number | null {
  if (!(L > 0) || !(s > L * (1 + 1e-9))) return null;
  // s / L = θ / (2 sin(θ / 2)), increasing on (0, 2π).
  let lo = 1e-9, hi = 2 * Math.PI - 1e-9;
  for (let k = 0; k < 80; k++) {
    const m = (lo + hi) / 2;
    if ((m / (2 * Math.sin(m / 2))) * L < s) lo = m;
    else hi = m;
  }
  const b = Math.tan((lo + hi) / 8);
  return b > SHAPE_LIMITS.bulge ? null : (was < 0 ? -1 : 1) * b;
}

/** The bulge whose arc passes through p's projection on the edge's left normal (the dragged midpoint): b = 2s / L. */
export function bulgeThrough(a: ShapePt, b: ShapePt, p: ShapePt): number {
  const L = dist(a, b);
  if (L < EPS) return 0;
  return clamp((2 * dot(sub(p, mid(a, b)), leftNormal(a, b))) / L, -SHAPE_LIMITS.bulge, SHAPE_LIMITS.bulge);
}

/** An edge with its `open` flag set or cleared. */
export function withOpen(e: ShapeEdge, open: boolean): ShapeEdge {
  const { open: _drop, ...rest } = e as ShapeEdge & { open?: true };
  void _drop;
  return (open ? { ...rest, open: true } : rest) as ShapeEdge;
}

/** Split an edge at t: the new point and the edges either side, the curve unchanged; `open` carries to both. */
export function splitEdge(a: ShapePt, b: ShapePt, e: ShapeEdge, t: number): { at: ShapePt; first: ShapeEdge; second: ShapeEdge } {
  const open = !!e.open;
  if (e.kind === "arc") {
    const A = arcInfo(a, b, e.bulge);
    if (A) {
      const s = e.bulge < 0 ? -1 : 1, sw = Math.abs(A.sweep);
      return {
        at: edgeAt(a, b, e, t),
        first: withOpen({ kind: "arc", bulge: s * Math.tan((sw * t) / 4) }, open),
        second: withOpen({ kind: "arc", bulge: s * Math.tan((sw * (1 - t)) / 4) }, open),
      };
    }
  }
  if (e.kind === "curve") {
    const p01 = lerp(a, e.c1, t), p12 = lerp(e.c1, e.c2, t), p23 = lerp(e.c2, b, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), at = lerp(p012, p123, t);
    return { at, first: withOpen({ kind: "curve", c1: p01, c2: p012 }, open), second: withOpen({ kind: "curve", c1: p123, c2: p23 }, open) };
  }
  return { at: lerp(a, b, t), first: withOpen({ kind: "line" }, open), second: withOpen({ kind: "line" }, open) };
}

/** The outward unit normal at parameter t of an edge of a loop whose signed area is `area` (tangent by finite difference). */
export function outwardNormalAt(area: number, a: ShapePt, b: ShapePt, e: ShapeEdge, t: number): ShapePt {
  const t0 = Math.max(0, t - 0.01), t1 = Math.min(1, t + 0.01);
  const n = leftNormal(edgeAt(a, b, e, t0), edgeAt(a, b, e, t1));
  return area > 0 ? mul(n, -1) : n;
}

/** The 6" wall along each non-open edge of a room, outward from its face: one closed polygon per walled edge (mitred corners, capped at 2× the thickness). A zone has none. */
export function wallBands(room: Pick<ShapeRoom, "pts" | "edges" | "kind">, thickFt: number = SHAPE_LIMITS.wallFt): ShapePt[][] {
  if (room.kind === "zone" || room.pts.length < 3) return [];
  const n = room.pts.length;
  const per = room.pts.map((p, i) => sampleEdge(p, room.pts[(i + 1) % n], edgeOf(room, i), 0.25, 64));
  const loop = per.flat();
  const L = loop.length;
  const dir = signedArea(loop) > 0 ? -1 : 1;
  const off = loop.map((p, k) => {
    const prev = loop[(k - 1 + L) % L], next = loop[(k + 1) % L];
    const n1 = mul(leftNormal(prev, p), dir), n2 = mul(leftNormal(p, next), dir);
    let m = add(n1, n2);
    const ml = Math.hypot(m.x, m.y);
    m = ml < 1e-6 ? n2 : mul(m, 1 / ml);
    const cos = dot(m, n2);
    return add(p, mul(m, cos > 0.5 ? thickFt / cos : thickFt * 2));
  });
  const bands: ShapePt[][] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const cnt = per[i].length;
    if (!edgeOf(room, i).open) {
      const idx = Array.from({ length: cnt + 1 }, (_, j) => (start + j) % L);
      bands.push([...idx.map((k) => loop[k]), ...[...idx].reverse().map((k) => off[k])]);
    }
    start += cnt;
  }
  return bands;
}
```

- [ ] **Step 6: Write the failing tests** — create `scripts/test-room-shape.ts`

```ts
// scripts/test-room-shape.ts
/* Grid room shape (#370) — harness checks. `roomShapePureChecks` is pure; `roomShapeDbChecks` needs the test DB.
   Run alone with `npx tsx scripts/test-room-shape.ts` (pure checks only). */
import type { Ok } from "./test-inbox-org";
import { parseFeet, fmtFeet } from "../src/lib/design/room-shape/units";
import {
  arcInfo, edgeAt, edgeLength, edgeMid, sampleEdge, outlinePoints, signedArea, selfCrosses, bulgeForRadius,
  bulgeForArcLength, bulgeThrough, splitEdge, wallBands, dist,
} from "../src/lib/design/room-shape/geometry";
import type { ShapeEdge, ShapePt, ShapeRoom } from "../src/lib/design/room-shape/types";

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearPt = (p: ShapePt, q: ShapePt, tol = 1e-6) => dist(p, q) <= tol;
export const rect = (x0: number, y0: number, w: number, h: number, over: Partial<ShapeRoom> = {}): ShapeRoom => ({
  id: "rm_00000001", type: "other", name: "Box", kind: "room", roles: [],
  pts: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }],
  edges: [{ kind: "line" }, { kind: "line" }, { kind: "line" }, { kind: "line" }],
  ...over,
});

export async function roomShapePureChecks(ok: Ok): Promise<void> {
  // units
  ok(parseFeet("42'-6\"") === 42.5 && parseFeet("42' 6\"") === 42.5 && parseFeet("42") === 42 && parseFeet("42.5") === 42.5 && parseFeet("6\"") === 0.5 && parseFeet("42'") === 42,
    "#370 units: parseFeet reads 42'-6\", 42' 6\", 42, 42.5, 6\" and 42'");
  ok(parseFeet("") === null && parseFeet("abc") === null && parseFeet("0") === null && parseFeet("-3") === null, "#370 units: parseFeet refuses blank, text, 0 and negatives");
  ok(fmtFeet(42.5) === "42'-6\"" && fmtFeet(0.5) === "0'-6\"" && fmtFeet(10) === "10'-0\"", "#370 units: fmtFeet prints whole inches");

  // arcs: a semicircle (bulge 1) over a 10' chord has r 5, sweep π, length 5π; its midpoint is 5' off the chord on the left normal
  const A = { x: 0, y: 0 }, B = { x: 10, y: 0 };
  const semi = arcInfo(A, B, 1)!;
  ok(near(semi.r, 5) && near(Math.abs(semi.sweep), Math.PI) && near(semi.length, 5 * Math.PI) && nearPt(semi.centre, { x: 5, y: 0 }),
    "#370 geometry: bulge 1 = a semicircle (r = chord / 2, sweep π, centre on the chord)");
  ok(nearPt(edgeMid(A, B, { kind: "arc", bulge: 1 }), { x: 5, y: 5 }) && nearPt(edgeMid(A, B, { kind: "arc", bulge: -1 }), { x: 5, y: -5 }),
    "#370 geometry: a positive bulge bows along the left normal (−dy, dx), a negative one the other way");
  ok(nearPt(edgeAt(A, B, { kind: "arc", bulge: 0.4 }, 0), A) && nearPt(edgeAt(A, B, { kind: "arc", bulge: 0.4 }, 1), B),
    "#370 geometry: an arc runs from a to b");
  ok(near(edgeLength(A, B, { kind: "line" }), 10) && sampleEdge(A, B, { kind: "line" }).length === 1, "#370 geometry: a line is its chord, sampled as its start");
  // radius / arc length round trips
  const bR = bulgeForRadius(10, 8, 0.3)!;
  ok(near(arcInfo(A, B, bR)!.r, 8, 1e-9) && bR > 0 && bulgeForRadius(10, 4, 0.3) === null, "#370 geometry: bulgeForRadius hits the radius, keeps the side, refuses r < chord / 2");
  ok(Math.abs(bulgeForRadius(10, 8, 2)!) > 1, "#370 geometry: bulgeForRadius keeps a major arc major");
  const bS = bulgeForArcLength(10, 12, -0.2)!;
  ok(near(arcInfo(A, B, bS)!.length, 12, 1e-6) && bS < 0 && bulgeForArcLength(10, 9, 0.2) === null, "#370 geometry: bulgeForArcLength hits the length, keeps the side, refuses s ≤ chord");
  ok(near(bulgeThrough(A, B, { x: 5, y: 2.5 }), 0.5) && near(bulgeThrough(A, B, { x: 5, y: -1 }), -0.2), "#370 geometry: bulgeThrough = 2 × offset ÷ chord");
  // split keeps the curve
  for (const e of [{ kind: "arc", bulge: 0.6 }, { kind: "curve", c1: { x: 2, y: 6 }, c2: { x: 8, y: -3 } }, { kind: "line", open: true }] as ShapeEdge[]) {
    const s = splitEdge(A, B, e, 0.3);
    const onFirst = edgeAt(A, s.at, s.first, 0.5), onSecond = edgeAt(s.at, B, s.second, 0.5);
    const full = (q: ShapePt) => Math.min(...Array.from({ length: 2001 }, (_, i) => dist(edgeAt(A, B, e, i / 2000), q)));
    ok(full(onFirst) < 1e-2 && full(onSecond) < 1e-2 && !!s.first.open === !!e.open && !!s.second.open === !!e.open,
      `#370 geometry: splitting a ${e.kind} keeps both halves on the original and carries open`);
  }
  // area, self-crossing
  const box = rect(0, 0, 10, 6);
  ok(near(Math.abs(signedArea(outlinePoints(box))), 60), "#370 geometry: a 10 × 6 box has area 60");
  const bow = { ...box, pts: [{ x: 0, y: 0 }, { x: 10, y: 6 }, { x: 10, y: 0 }, { x: 0, y: 6 }] };
  ok(selfCrosses(bow) && !selfCrosses(box), "#370 geometry: a bow-tie crosses itself, a box doesn't");
  // wall bands: one per walled edge, 6" thick, outward
  const bands = wallBands(box);
  ok(bands.length === 4 && near(Math.abs(signedArea(bands[0])), 10 * 0.5 + 0.25 * 0.5 * 2, 1e-6), "#370 geometry: a box has four 6\" wall bands, mitred");
  ok(wallBands({ ...box, edges: [{ kind: "line", open: true }, { kind: "line" }, { kind: "line" }, { kind: "line" }] }).length === 3 && wallBands({ ...box, kind: "zone" }).length === 0,
    "#370 geometry: an open edge has no wall, a zone has none");
  ok(bands[0].every((p) => p.y <= 1e-9) || bands[0].every((p) => p.y >= -1e-9), "#370 geometry: the top wall sits on one side of its face");
  ok(bands[0].some((p) => p.y < -0.49), "#370 geometry: the top wall of a box is outside it (y < 0)");
}

export async function roomShapeDbChecks(ok: Ok): Promise<void> {
  void ok;
}

if (process.argv[1] && /test-room-shape\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  (async () => {
    await roomShapePureChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall room-shape checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
```

Mitre arithmetic for the band area check: a 10' face, 6" thick, with 45° mitres at both ends is a trapezoid of area (10 + 11) / 2 × 0.5 = 5.25 = `10 * 0.5 + 0.25 * 0.5 * 2`.

- [ ] **Step 7: Run the tests**

Run: `npx tsx scripts/test-room-shape.ts`
Expected: every line PASS, last line `all room-shape checks passed`. If the mitre check fails, the band polygon is wrong — fix `wallBands`, not the test.

- [ ] **Step 8: Wire into `test:specs`.** In `scripts/test-review-and-spec.ts`, next to `import { vaNotesChecks, vaNotesDbChecks } from "./test-va-notes";` add:

```ts
import { roomShapePureChecks, roomShapeDbChecks } from "./test-room-shape";
```

and after the chain line `.then(() => etc368LoadSystemDbChecks(ok)).then(() => etc368RepriceDbChecks(ok)) // #368 estimator` add:

```ts
  .then(() => roomShapePureChecks(ok)).then(() => roomShapeDbChecks(ok)) // #370 room shape
```

- [ ] **Step 9: Run `npm run test:specs`** — Expected: `ALL PASSED`. Note the PASS count.

- [ ] **Step 10: Commit**

```bash
git add src/lib/design/room-shape scripts/test-room-shape.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): #370 room shape types, units and geometry core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Outline fitting + wall detection

**Files:**
- Create: `src/lib/design/room-shape/fit.ts`, `src/lib/design/room-shape/walls.ts`
- Test: `scripts/test-room-shape.ts`

**Interfaces:**
- Consumes: Task 1 geometry (`dist, sub, dot, mid, leftNormal, edgeAt, edgeLength, splitEdge, withOpen, outwardNormalAt, outlinePoints, signedArea`).
- Produces: `fitOutline(raw: ShapePt[], tol?: number): { pts: ShapePt[]; edges: ShapeEdge[] }`; `type Seg = [ShapePt, ShapePt]`; `class SegIndex { constructor(segs: Seg[], cellFt?: number); nearest(p: ShapePt, r: number): number }` (distance to the nearest segment within r, else Infinity); `type WallRule = "double" | "single"`; `wallAt(idx, p, n, rule): boolean`; `splitByWalls(pts, edges, idx, rule): { pts; edges }`; `walledShare(room): number`.

- [ ] **Step 1: Write the failing tests** — append inside `roomShapePureChecks` (add the imports at the top of the file):

```ts
import { fitOutline } from "../src/lib/design/room-shape/fit";
import { SegIndex, splitByWalls, walledShare, wallAt, type Seg } from "../src/lib/design/room-shape/walls";
```

```ts
  // fitOutline: a densified rectangle comes back as 4 lines at its corners
  const dense: ShapePt[] = [];
  for (let x = 0; x < 20; x += 0.25) dense.push({ x, y: 0 });
  for (let y = 0; y < 10; y += 0.25) dense.push({ x: 20, y });
  for (let x = 20; x > 0; x -= 0.25) dense.push({ x, y: 10 });
  for (let y = 10; y > 0; y -= 0.25) dense.push({ x: 0, y });
  const fr = fitOutline(dense);
  ok(fr.pts.length === 4 && fr.edges.every((e) => e.kind === "line") && fr.pts.some((p) => nearPt(p, { x: 0, y: 0 }, 1e-9)) && fr.pts.some((p) => nearPt(p, { x: 20, y: 10 }, 1e-9)),
    "#370 fit: a densified 20 × 10 rectangle fits as 4 lines on its corners");
  // a D shape: a line plus a sampled semicircle → one line and one arc of radius 5
  const d: ShapePt[] = [];
  for (let k = 0; k <= 90; k++) { const t = Math.PI - (k / 90) * Math.PI; d.push({ x: 5 + 5 * Math.cos(t), y: -5 * Math.sin(t) }); }
  for (let x = 9.75; x > 0.1; x -= 0.25) d.push({ x, y: 0 });
  const fd = fitOutline(d);
  const arcE = fd.edges.findIndex((e) => e.kind === "arc");
  ok(fd.edges.length === 2 && arcE >= 0 && near(arcInfo(fd.pts[arcE], fd.pts[(arcE + 1) % 2], (fd.edges[arcE] as { bulge: number }).bulge)!.r, 5, 0.05),
    "#370 fit: a sampled semicircle + chord fits as one arc (r ≈ 5) and one line");
  // walls: a double line (face + 6" out) reads as a wall; a single line doesn't under the double rule
  const segs: Seg[] = [[{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ x: 0, y: -0.5 }, { x: 20, y: -0.5 }], [{ x: 0, y: 10 }, { x: 20, y: 10 }]];
  const idx = new SegIndex(segs);
  ok(wallAt(idx, { x: 5, y: 0 }, { x: 0, y: -1 }, "double") && !wallAt(idx, { x: 5, y: 10 }, { x: 0, y: 1 }, "double") && wallAt(idx, { x: 5, y: 10 }, { x: 0, y: 1 }, "single"),
    "#370 walls: a face line with a parallel line 6\" outward is a wall; a lone face line is one only under the single rule");
  // splitByWalls: the top edge is walled only from x 0 → 8 → split into a walled and an open piece
  const segs2: Seg[] = [[{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ x: 0, y: -0.5 }, { x: 8, y: -0.5 }],
    [{ x: 20, y: 0 }, { x: 20, y: 10 }], [{ x: 20.5, y: 0 }, { x: 20.5, y: 10 }], [{ x: 20, y: 10 }, { x: 0, y: 10 }], [{ x: 20, y: 10.5 }, { x: 0, y: 10.5 }],
    [{ x: 0, y: 10 }, { x: 0, y: 0 }], [{ x: -0.5, y: 10 }, { x: -0.5, y: 0 }]];
  const sp = splitByWalls(fr.pts, fr.edges, new SegIndex(segs2), "double");
  const topOpen = sp.pts.map((p, i) => ({ p, q: sp.pts[(i + 1) % sp.pts.length], e: sp.edges[i] })).filter((x) => x.p.y === 0 && x.q.y === 0);
  ok(sp.pts.length === 5 && topOpen.length === 2 && topOpen.some((x) => x.e.open && Math.min(x.p.x, x.q.x) >= 7.9 && Math.min(x.p.x, x.q.x) <= 8.1) && topOpen.some((x) => !x.e.open),
    "#370 walls: an edge walled for 8' of 20' splits at the change, the rest open");
  ok(near(walledShare({ ...sp, kind: "room" }), 48 / 60, 0.02), "#370 walls: walledShare = walled length ÷ perimeter");
```

- [ ] **Step 2: Run to verify failure** — `npx tsx scripts/test-room-shape.ts` → FAIL (module not found).

- [ ] **Step 3: Write `fit.ts`**

```ts
// src/lib/design/room-shape/fit.ts
import { dist, dot, leftNormal, mid, sub } from "./geometry";
import { SHAPE_LIMITS, type ShapeEdge, type ShapePt } from "./types";

/** #370: the fitting tolerance — 1". */
export const FIT_TOL_FT = 1 / 12;

function distToSeg(p: ShapePt, a: ShapePt, b: ShapePt): number {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

/** The circle through three points, or null when they're (near) collinear. */
export function circle3(a: ShapePt, b: ShapePt, c: ShapePt): { centre: ShapePt; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const centre = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  return { centre, r: dist(a, centre) };
}

/** Consecutive points under 0.01 ft apart collapse; a closing point equal to the first drops. */
function dedupe(raw: readonly ShapePt[]): ShapePt[] {
  const out: ShapePt[] = [];
  for (const p of raw) if (!out.length || dist(out[out.length - 1], p) >= 0.01) out.push({ x: p.x, y: p.y });
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < 0.01) out.pop();
  return out;
}

/** The turn at b (0 = straight on, π = straight back). */
function turn(a: ShapePt, b: ShapePt, c: ShapePt): number {
  const u = sub(b, a), v = sub(c, b), lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
  if (lu < 1e-9 || lv < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (lu * lv))));
}

/** The bulge of an arc through P(i)..P(j) when every point is within tol of one circle, in order, bowing more than tol; else null. */
function arcFit(P: (k: number) => ShapePt, i: number, j: number, tol: number): number | null {
  const a = P(i), b = P(j), m = P(Math.floor((i + j) / 2));
  const c = circle3(a, m, b);
  if (!c || c.r > SHAPE_LIMITS.coordFt) return null;
  let total = 0, sign = 0, dev = 0;
  for (let k = i; k <= j; k++) {
    const p = P(k);
    if (Math.abs(dist(p, c.centre) - c.r) > tol) return null;
    dev = Math.max(dev, distToSeg(p, a, b));
    if (k > i) {
      const q = P(k - 1);
      let d = Math.atan2(p.y - c.centre.y, p.x - c.centre.x) - Math.atan2(q.y - c.centre.y, q.x - c.centre.x);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > Math.PI / 2) return null;
      const s = Math.sign(d);
      if (s !== 0) {
        if (sign !== 0 && s !== sign) return null;
        sign = s;
      }
      total += d;
    }
  }
  if (dev <= tol || dist(a, b) < 1e-6 || Math.abs(total) > 2 * Math.PI - 0.4) return null;
  const side = dot(sub(m, mid(a, b)), leftNormal(a, b));
  const bulge = Math.sign(side) * Math.tan(Math.abs(total) / 4);
  return Math.abs(bulge) > SHAPE_LIMITS.bulge ? null : bulge;
}

/**
 * #370: a sampled closed outline (feet) as few edges as fit within `tol`: straight runs become lines, runs of ≥ 5
 * points on one circle become arcs. Starts at the sharpest corner so no edge begins mid-curve. Greedy, longest first.
 */
export function fitOutline(raw: readonly ShapePt[], tol = FIT_TOL_FT): { pts: ShapePt[]; edges: ShapeEdge[] } {
  const pts = dedupe(raw);
  const n = pts.length;
  if (n < 3) return { pts, edges: pts.map(() => ({ kind: "line" as const })) };
  let start = 0, best = -1;
  for (let i = 0; i < n; i++) {
    const t = turn(pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n]);
    if (t > best) { best = t; start = i; }
  }
  const P = (k: number) => pts[(start + k) % n];
  const outPts: ShapePt[] = [], outEdges: ShapeEdge[] = [];
  let i = 0;
  while (i < n) {
    let jl = i + 1;
    for (let j = i + 2; j <= n; j++) {
      let fits = true;
      for (let k = i + 1; k < j; k++) if (distToSeg(P(k), P(i), P(j)) > tol) { fits = false; break; }
      if (!fits) break;
      jl = j;
    }
    let ja = -1, jb = 0;
    for (let j = i + 4; j <= n; j++) {
      const b = arcFit(P, i, j, tol);
      if (b === null) {
        if (ja > 0 || j >= i + 8) break;
        continue;
      }
      ja = j;
      jb = b;
    }
    outPts.push(P(i));
    if (ja > jl) { outEdges.push({ kind: "arc", bulge: jb }); i = ja; }
    else { outEdges.push({ kind: "line" }); i = jl; }
  }
  return { pts: outPts, edges: outEdges };
}
```

- [ ] **Step 4: Write `walls.ts`**

```ts
// src/lib/design/room-shape/walls.ts
import { dist, dot, edgeAt, edgeLength, outlinePoints, outwardNormalAt, signedArea, splitEdge, sub, withOpen } from "./geometry";
import type { ShapeEdge, ShapePt, ShapeRoom } from "./types";

/** #370: a drawn line segment of the template, feet. */
export type Seg = [ShapePt, ShapePt];
/** "double": a wall shows as a line on the face plus a parallel one 4"–9" out (Jeff's DWGs); "single": a line on the face is enough (the arena). */
export type WallRule = "double" | "single";

const FACE_FT = 1 / 12;
const OUT_STEPS_FT = [4, 5, 6, 7, 8, 9].map((i) => i / 12);
const SAMPLE_FT = 0.25;
const MIN_RUN_SAMPLES = 6; // 18"

function distToSeg(p: ShapePt, a: ShapePt, b: ShapePt): number {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

/** A grid of segments by cell, for "is any drawn line within r of p". */
export class SegIndex {
  private cells = new Map<string, Seg[]>();
  constructor(segs: readonly Seg[], private cellFt = 2) {
    for (const s of segs) {
      const x0 = Math.floor(Math.min(s[0].x, s[1].x) / cellFt), x1 = Math.floor(Math.max(s[0].x, s[1].x) / cellFt);
      const y0 = Math.floor(Math.min(s[0].y, s[1].y) / cellFt), y1 = Math.floor(Math.max(s[0].y, s[1].y) / cellFt);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const list = this.cells.get(k);
        if (list) list.push(s);
        else this.cells.set(k, [s]);
      }
    }
  }
  /** The distance from p to the nearest segment within r, else Infinity. */
  nearest(p: ShapePt, r: number): number {
    let best = Infinity;
    const c = this.cellFt;
    for (let x = Math.floor((p.x - r) / c); x <= Math.floor((p.x + r) / c); x++)
      for (let y = Math.floor((p.y - r) / c); y <= Math.floor((p.y + r) / c); y++)
        for (const s of this.cells.get(`${x},${y}`) ?? []) best = Math.min(best, distToSeg(p, s[0], s[1]));
    return best <= r ? best : Infinity;
  }
}

/** Whether the drawing shows a wall at face point p whose outward unit normal is n. */
export function wallAt(idx: SegIndex, p: ShapePt, n: ShapePt, rule: WallRule): boolean {
  if (idx.nearest(p, FACE_FT) === Infinity) return false;
  if (rule === "single") return true;
  return OUT_STEPS_FT.some((d) => idx.nearest({ x: p.x + n.x * d, y: p.y + n.y * d }, FACE_FT) !== Infinity);
}

/** Runs shorter than MIN_RUN_SAMPLES take their neighbour's value (the first run its successor's). */
function smooth(flags: boolean[]): boolean[] {
  const f = flags.slice();
  for (let pass = 0; pass < 3; pass++) {
    let k = 0;
    while (k < f.length) {
      let j = k;
      while (j < f.length && f[j] === f[k]) j++;
      if (j - k < MIN_RUN_SAMPLES && f.length > MIN_RUN_SAMPLES) {
        const v = k > 0 ? f[k - 1] : j < f.length ? f[j] : f[k];
        for (let q = k; q < j; q++) f[q] = v;
      }
      k = j;
    }
  }
  return f;
}

const r12 = (p: ShapePt): ShapePt => ({ x: Math.round(p.x * 12) / 12, y: Math.round(p.y * 12) / 12 });

/**
 * #370 (Amendment A): an outline's edges split wherever the drawing changes between wall and no wall along them
 * (samples every 3", runs under 18" follow their neighbours); edges with no wall carry `open: true`. Split points
 * round to the inch.
 */
export function splitByWalls(pts: readonly ShapePt[], edges: readonly ShapeEdge[], idx: SegIndex, rule: WallRule): { pts: ShapePt[]; edges: ShapeEdge[] } {
  const n = pts.length;
  const area = signedArea(outlinePoints({ pts: pts as ShapePt[], edges: edges as ShapeEdge[] }, 0.25, 64));
  const outPts: ShapePt[] = [], outEdges: ShapeEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], e = edges[i];
    const ns = Math.max(2, Math.ceil(edgeLength(a, b, e) / SAMPLE_FT));
    const flags = smooth(Array.from({ length: ns }, (_, k) => {
      const t = (k + 0.5) / ns;
      return wallAt(idx, edgeAt(a, b, e, t), outwardNormalAt(area, a, b, e, t), rule);
    }));
    let curA = a, curE = e, tPrev = 0;
    for (let k = 1; k < ns; k++) {
      if (flags[k] === flags[k - 1]) continue;
      const t = k / ns;
      const s = splitEdge(curA, b, curE, (t - tPrev) / (1 - tPrev));
      outPts.push(curA);
      outEdges.push(withOpen(s.first, !flags[k - 1]));
      curA = r12(s.at);
      curE = s.second;
      tPrev = t;
    }
    outPts.push(curA);
    outEdges.push(withOpen(curE, !flags[ns - 1]));
  }
  return { pts: outPts, edges: outEdges };
}

/** The share of a room's perimeter that is walled (0..1). */
export function walledShare(room: Pick<ShapeRoom, "pts" | "edges">): number {
  const n = room.pts.length;
  let all = 0, walled = 0;
  for (let i = 0; i < n; i++) {
    const L = edgeLength(room.pts[i], room.pts[(i + 1) % n], room.edges[i]);
    all += L;
    if (!room.edges[i].open) walled += L;
  }
  return all > 0 ? walled / all : 0;
}
```

- [ ] **Step 5: Run the tests** — `npx tsx scripts/test-room-shape.ts` → all PASS. If the D-shape check fails because the arc broke into pieces, print `fd.edges` and tune only `arcFit`'s early-break (`j >= i + 8`), never the tolerance.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/room-shape/fit.ts src/lib/design/room-shape/walls.ts scripts/test-room-shape.ts
git commit -m "feat(grid): #370 outline fitting and wall detection from the drawing's double lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Freeze the stretched template into a RoomShape

**Files:**
- Create: `src/lib/design/room-shape/freeze.ts`
- Test: `scripts/test-room-shape.ts`

**Interfaces:**
- Consumes: `fitOutline`, `SegIndex`, `splitByWalls`, `walledShare`, `withOpen`; `keysById`, `stretchById` (`src/lib/design/venue-templates/templates.ts`); `familyDims` (`house-dims.ts`); `numberedRegionLabels` (`movable-options.ts`); `templateEntry` (`venue-templates/index.ts`); `VENUES`, `AState` (`src/app/(app)/design/quick/engine.ts`).
- Produces: `freezeFromTemplate(a: AState, tplId: string, stamp: { by: string; at: number }): RoomShape`; `roomIdFor(tplId: string, regionId: string): string`; `fnv8(s: string): string`; `FREEZE_HINTS`.

- [ ] **Step 1: Write the failing tests** — add the imports and the two module-level helpers at the top of the file (below the imports — later tasks and the DB group use them), then append the checks to `roomShapePureChecks`:

```ts
import { freezeFromTemplate, roomIdFor } from "../src/lib/design/room-shape/freeze";
import { gridIntakeDefaults } from "../src/lib/design/grid-intake";
import { VENUES, sizedDims, type AState } from "../src/app/(app)/design/quick/engine";

/** Every template, with a venue whose kind draws it. */
export const CASES: Array<[string, string]> = [
  ["school", "proscenium@1"], ["gym", "gym-stage@1"], ["church", "church-traditional@1"], ["church", "church-contemporary@2"],
  ["blackbox", "blackbox@1"], ["concenter", "blackbox@1"], ["arena", "arena@1"],
];
export const stateFor = (key: string): AState => {
  const v = VENUES.find((x) => x.key === key)!;
  return { ...gridIntakeDefaults(), venue: v.key, sys: { ...v.sys }, ...sizedDims(v, "large") };
};
```

**Never import `src/lib/stores/*` statically in this file** — the stores open the database, and the standalone `npx tsx scripts/test-room-shape.ts` run has no `PGLITE_PATH`, so it would open the real dev DB. Store-backed checks go in `roomShapeDbChecks` with a dynamic `await import(...)` (it only runs inside `test:specs`, which sets a throwaway `PGLITE_PATH`).

```ts
  // freeze: every template
  for (const [key, tpl] of CASES) {
    const a = stateFor(key);
    const shape = freezeFromTemplate(a, tpl, { by: "T", at: 1 });
    ok(shape.rooms.some((r) => r.roles.includes("stage")) && shape.rooms.some((r) => r.roles.includes("house")), `#370 freeze ${key}/${tpl}: a room holds the stage and a room the house`);
    ok(shape.rooms.every((r) => r.pts.length >= 3 && r.pts.length === r.edges.length && !selfCrosses(r)), `#370 freeze ${key}/${tpl}: every room is a valid, non-crossing outline`);
    ok(new Set(shape.rooms.map((r) => r.id)).size === shape.rooms.length && shape.rooms.every((r) => /^rm_[0-9a-f]{8}$/.test(r.id)), `#370 freeze ${key}/${tpl}: room ids are unique rm_ + 8 hex`);
    ok(JSON.stringify(freezeFromTemplate(a, tpl, { by: "T", at: 1 })) === JSON.stringify(shape), `#370 freeze ${key}/${tpl}: deterministic`);
    ok(shape.rooms.every((r) => r.pts.length <= 64), `#370 freeze ${key}/${tpl}: no room over 64 corners`);
  }
  // proscenium specifics (defaults: pro 50, wing 10, depth 30)
  {
    const a = stateFor("school");
    const s = freezeFromTemplate({ ...a, width: 50, wing: 10, depth: 30 }, "proscenium@1", { by: "T", at: 1 });
    const room = (nm: string) => s.rooms.find((r) => r.name === nm)!;
    const stage = room("Stage"), house = room("House");
    const bx = (r: ShapeRoom) => { const p = outlinePoints(r); return { minX: Math.min(...p.map((q) => q.x)), maxX: Math.max(...p.map((q) => q.x)), minY: Math.min(...p.map((q) => q.y)), maxY: Math.max(...p.map((q) => q.y)) }; };
    ok(near(bx(stage).maxX - bx(stage).minX, 70, 0.1) && near(bx(stage).maxY, 0, 0.1) && near(bx(stage).minY, -30, 0.1), "#370 freeze proscenium: the Stage is pro + 2 wings (70') wide, plaster line at y 0, 30' deep");
    const openAt = (r: ShapeRoom, q: ShapePt) => r.pts.some((p, i) => r.edges[i].open && sampleEdge(p, r.pts[(i + 1) % r.pts.length], r.edges[i], 0.1, 999).concat([r.pts[(i + 1) % r.pts.length]]).some((x) => dist(x, q) < 0.6));
    ok(openAt(stage, { x: 0, y: 0 }) && !openAt(stage, { x: -35, y: -15 }), "#370 freeze proscenium: the opening is open, the side wall isn't");
    ok(house.edges.some((e) => e.kind === "arc" && e.open) && near(bx(house).minY, (9 + 81) / 12, 0.1), "#370 freeze proscenium: the stage lip arc is an open edge of the House, which starts 7'-6\" below the plaster line");
    ok(room("Catwalk").kind === "zone" && room("Center Aisle").kind === "zone" && room("Booth").kind === "room" && stage.kind === "room", "#370 freeze proscenium: Catwalk and Center Aisle are zones, Booth and Stage rooms");
    ok(stage.type === "stage" && house.type === "house" && room("Booth").type === "booth" && room("Electrical Room").type === "electrical" && room("Catwalk").type === "catwalk", "#370 freeze proscenium: types follow roles, then labels");
    ok(stage.id === roomIdFor("proscenium@1", "Stage"), "#370 freeze: a room's id comes from its template and region");
  }
  // blackbox: one room is both stage and house; conference adds a Platform zone with the stage
  {
    const bb = freezeFromTemplate(stateFor("blackbox"), "blackbox@1", { by: "T", at: 1 });
    const main = bb.rooms.find((r) => r.roles.includes("house"))!;
    ok(main.roles.includes("stage") && main.name === "Blackbox", "#370 freeze blackbox: the Blackbox room holds both stage and house");
    const cf = freezeFromTemplate(stateFor("concenter"), "blackbox@1", { by: "T", at: 1 });
    const cmain = cf.rooms.find((r) => r.roles.includes("house"))!, plat = cf.rooms.find((r) => r.name === "Platform")!;
    ok(cmain.name === "Conference Room" && !cmain.roles.includes("stage") && plat.kind === "zone" && plat.roles.join() === "stage", "#370 freeze conference: Conference Room is the house, a Platform zone holds the stage");
  }
  // arena: single-line walls; the floor and court are zones
  {
    const ar = freezeFromTemplate(stateFor("arena"), "arena@1", { by: "T", at: 1 });
    const r = (nm: string) => ar.rooms.find((x) => x.name === nm)!;
    ok(r("Arena Floor").kind === "zone" && r("Court").kind === "zone" && r("Booth").kind === "room", "#370 freeze arena: floor and court are zones, the booth a room");
  }
```

Note on the House check: the House's top-most point is at the lip's ends (drawing y −81 → 7.5' below the plaster line); `bx(house).minY` is that.

And replace the empty `roomShapeDbChecks` body with the starter-Space parity check (it needs `starterSpaces` from the store module — dynamic import):

```ts
export async function roomShapeDbChecks(ok: Ok): Promise<void> {
  const GP = await import("../src/lib/stores/grid-projects");
  // freeze: every template gives the same rooms (names, order) as today's starter Spaces
  for (const [key, tpl] of CASES) {
    const a = stateFor(key);
    const shape = freezeFromTemplate(a, tpl, { by: "T", at: 1 });
    const kind = VENUES.find((x) => x.key === key)!.kind;
    const starter = GP.starterSpaces(a, kind, "sh", tpl).map((s) => s.name);
    const names = shape.rooms.map((r) => r.name).filter((nm) => !(kind === "flat" && nm === "Platform"));
    ok(names.join("|") === starter.join("|"), `#370 freeze ${key}/${tpl}: the rooms are today's starter Spaces, in order (${names.join(", ")})`);
  }
}
```

Run this one through `npm run test:specs` (Step 4).

- [ ] **Step 2: Run to verify failure** — `npx tsx scripts/test-room-shape.ts` → FAIL (module not found).

- [ ] **Step 3: Write `freeze.ts`**

```ts
// src/lib/design/room-shape/freeze.ts
import { VENUES, type AState } from "@/app/(app)/design/quick/engine";
import { templateEntry } from "@/lib/design/venue-templates";
import { familyDims } from "@/lib/design/venue-templates/house-dims";
import { numberedRegionLabels } from "@/lib/design/venue-templates/movable-options";
import { keysById, stretchById } from "@/lib/design/venue-templates/templates";
import type { Pt } from "@/lib/design/venue-templates/types";
import { fitOutline } from "./fit";
import { bounds, outlinePoints, withOpen } from "./geometry";
import { ROOM_ROLES, type RoomRole, type RoomShape, type RoomTypeKey, type ShapeEdge, type ShapePt, type ShapeRoom } from "./types";
import { SegIndex, splitByWalls, walledShare, type Seg, type WallRule } from "./walls";

/** #370: per-template freeze hints — how walls are drawn, and regions that are always zones. */
export const FREEZE_HINTS: Readonly<Record<string, { wallRule: WallRule; zones?: readonly string[] }>> = {
  // Jeff's arena drawing is all single lines; its floor and court are areas, not rooms.
  "arena@1": { wallRule: "single", zones: ["Arena Floor", "Court", "Stage"] },
};

/** A room whose walled share is under this freezes as a zone (Amendment A: the Catwalk, the Center Aisle). */
const ZONE_BELOW = 0.25;

const LABEL_TYPES: ReadonlyArray<[RegExp, RoomTypeKey]> = [
  [/^pit\b/i, "pit"], [/catwalk/i, "catwalk"], [/booth/i, "booth"], [/electrical/i, "electrical"], [/green room/i, "green"],
  [/choir/i, "choir"], [/storage/i, "storage"], [/dressing/i, "dressing"], [/lobby|entry/i, "lobby"], [/hall|aisle/i, "hallway"],
  [/music/i, "music"], [/office/i, "office"],
];

function typeFor(name: string, roles: readonly RoomRole[]): RoomTypeKey {
  if (roles.includes("house")) return "house";
  if (roles.includes("stage")) return "stage";
  if (roles.includes("booth")) return "booth";
  if (roles.includes("catwalk")) return "catwalk";
  for (const [re, t] of LABEL_TYPES) if (re.test(name)) return t;
  return "other";
}

/** FNV-1a, 8 hex. */
export function fnv8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const roomIdFor = (tplId: string, regionId: string): string => `rm_${fnv8(`${tplId}:${regionId}`)}`;

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const stripOpen = (e: ShapeEdge): ShapeEdge => withOpen(e, false);

/** The Conference's code-drawn platform (blackboxGeom): 62 % of the room's width, at its stage end. */
function platformFor(house: ShapeRoom, a: AState, tplId: string): ShapeRoom {
  const b = bounds(outlinePoints(house));
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const pw = w * 0.62, pd = Math.min(Math.max(a.depth * 0.16, 6), h * 0.3);
  const x0 = b.minX + (w - pw) / 2, y0 = b.minY;
  const pts: ShapePt[] = [{ x: x0, y: y0 }, { x: x0 + pw, y: y0 }, { x: x0 + pw, y: y0 + pd }, { x: x0, y: y0 + pd }].map((p) => ({ x: r6(p.x), y: r6(p.y) }));
  return { id: roomIdFor(tplId, "platform"), type: "stage", name: "Platform", kind: "zone", roles: ["stage"], pts, edges: pts.map(() => ({ kind: "line" as const })) };
}

/**
 * #370: the stretched template as a RoomShape — one room per region in the keys' Space order (exactly today's
 * starter Spaces), outlines fitted to lines and arcs, each edge walled or open by the drawing's own linework
 * (Amendment A), roles copied from the keys. Pure and deterministic.
 */
export function freezeFromTemplate(a: AState, tplId: string, stamp: { by: string; at: number }): RoomShape {
  const keys = keysById(tplId);
  const plan = stretchById(tplId, familyDims(a, tplId));
  const O = plan.map({ x: keys.cx, y: keys.origin });
  const toFt = (p: Pt): ShapePt => ({ x: r6((p.x - O.x) / 12), y: r6((O.y - p.y) / 12) });
  const segs: Seg[] = plan.polylines.flatMap((l) => l.slice(1).map((q, i) => [toFt(l[i]), toFt(q)] as Seg));
  const idx = new SegIndex(segs);
  const hint = FREEZE_HINTS[tplId] ?? { wallRule: "double" as const };
  const names = numberedRegionLabels(plan.regionLabels, Object.keys(keys.regions));
  const flat = (VENUES.find((v) => v.key === a.venue) || VENUES[0]).kind === "flat" && templateEntry(tplId)?.family === "blackbox";
  const rooms: ShapeRoom[] = [];
  for (const rid of keys.spaces) {
    const raw = plan.regions[rid];
    if (!raw || raw.length < 3) continue;
    const fitted = fitOutline(raw.map(toFt));
    if (fitted.pts.length < 3) continue;
    const forcedZone = hint.zones?.includes(rid) ?? false;
    const geom = forcedZone ? fitted : splitByWalls(fitted.pts, fitted.edges, idx, hint.wallRule);
    const zone = forcedZone || walledShare(geom) < ZONE_BELOW;
    const roles = ROOM_ROLES.filter((r) => (keys.roles as Partial<Record<RoomRole, string>>)[r] === rid);
    const isHouse = rid === keys.roles.house;
    const name = flat && isHouse ? "Conference Room" : names[rid] ?? rid;
    rooms.push({
      id: roomIdFor(tplId, rid),
      type: typeFor(name, roles),
      name,
      kind: zone ? "zone" : "room",
      roles: flat ? roles.filter((r) => r !== "stage") : roles,
      pts: geom.pts.map((p) => ({ x: r6(p.x), y: r6(p.y) })),
      edges: zone ? geom.edges.map(stripOpen) : geom.edges,
    });
  }
  if (flat) {
    const house = rooms.find((r) => r.roles.includes("house"));
    if (house) rooms.push(platformFor(house, a, tplId));
  }
  return { v: 1, fromTemplate: tplId, rooms, frozenAt: stamp.at, by: stamp.by };
}
```

If a frozen room comes out with more than 64 corners (the cap), raise `FIT_TOL_FT`'s use for that room only: refit with `fitOutline(raw, 2 / 12)` before splitting. Add this guard after `fitOutline`:

```ts
    const fitted0 = fitOutline(raw.map(toFt));
    const fitted = fitted0.pts.length > 48 ? fitOutline(raw.map(toFt), 2 / 12) : fitted0;
```
(replacing the single `const fitted = …` line), so the split by walls stays under 64.

- [ ] **Step 4: Run the tests** — `npx tsx scripts/test-room-shape.ts` → all PASS, then `npm run test:specs` → ALL PASSED (the starter-Space parity runs there). If a starter-Space name check fails, print both lists: the freeze must use the same region order (`keys.spaces`) and names as `starterSpaces`; fix freeze, not the test. If the Catwalk is not a zone, print `walledShare` for it — Amendment A's threshold is 25 %; do not change it without logging a decision.

- [ ] **Step 5: Write the review renders script** — `scripts/room-shape-renders.ts` is added in Task 6 (it needs `roomShapeSvg`). Nothing here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/room-shape/freeze.ts scripts/test-room-shape.ts
git commit -m "feat(grid): #370 freeze a stretched venue template into a room shape

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server sanitize

**Files:**
- Create: `src/lib/design/room-shape/sanitize.ts`
- Test: `scripts/test-room-shape.ts`

**Interfaces:**
- Consumes: `SHAPE_LIMITS`, `ROOM_TYPES`, `ROOM_TYPE_KEYS`, `ROOM_ROLES`, `selfCrosses`, `dist`, copy constants.
- Produces: `type SanitizeResult = { ok: true; shape: RoomShape; notes: string[] } | { ok: false; error: string }`; `sanitizeRoomShape(raw: unknown, tpl: string | null, by: string, now: number): SanitizeResult | null` (null = no shape sent).

- [ ] **Step 1: Write the failing tests**

```ts
import { sanitizeRoomShape } from "../src/lib/design/room-shape/sanitize";
import { SHAPE_STALE, SHAPE_NEEDS_STAGE_HOUSE, SHAPE_UNREADABLE } from "../src/lib/design/room-shape/copy";
```

```ts
  {
    const good = freezeFromTemplate(stateFor("school"), "proscenium@1", { by: "client", at: 5 });
    const r = sanitizeRoomShape(JSON.parse(JSON.stringify(good)), "proscenium@1", "Server", 99)!;
    ok(r.ok && r.shape.rooms.length === good.rooms.length && r.shape.by === "Server" && r.shape.frozenAt === 99 && r.notes.length === 0,
      "#370 sanitize: a good shape passes whole, by / frozenAt stamped by the server");
    ok(sanitizeRoomShape(null, "proscenium@1", "S", 1) === null && sanitizeRoomShape(undefined, "proscenium@1", "S", 1) === null, "#370 sanitize: no shape → null");
    const stale = sanitizeRoomShape(good, "blackbox@1", "S", 1)!;
    ok(!stale.ok && stale.error === SHAPE_STALE, "#370 sanitize: a shape frozen from another template is refused");
    ok(!sanitizeRoomShape({ v: 2 }, "proscenium@1", "S", 1)!.ok && (sanitizeRoomShape("x", "proscenium@1", "S", 1) as { error: string }).error === SHAPE_UNREADABLE, "#370 sanitize: junk is refused as unreadable");
    const bad = JSON.parse(JSON.stringify(good));
    bad.rooms[2].pts[0].x = Number.NaN; // Pit or House — dropped either way
    bad.rooms.push({ ...bad.rooms[0] }); // a duplicate id (room 0 is the Stage, never the victim below)
    bad.rooms.push({ ...rect(0, 0, 4, 4), id: "rm_0000abcd", type: "nope" });
    bad.rooms.push({ ...rect(0, 0, 4, 4), id: "rm_0000abce", pts: [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }] });
    const rb = sanitizeRoomShape(bad, "proscenium@1", "S", 1)!;
    ok(rb.ok && rb.notes.length === 4 && rb.shape.rooms.length === good.rooms.length - 1 + 0, "#370 sanitize: a NaN, a duplicate id, an unknown type and a crossing room are each dropped with a note");
    const noStage = JSON.parse(JSON.stringify(good));
    noStage.rooms = noStage.rooms.filter((x: ShapeRoom) => !x.roles.includes("stage"));
    const rs = sanitizeRoomShape(noStage, "proscenium@1", "S", 1)!;
    ok(!rs.ok && rs.error === SHAPE_NEEDS_STAGE_HOUSE, "#370 sanitize: no Stage → refused");
    const twoBooths = JSON.parse(JSON.stringify(good));
    twoBooths.rooms.push({ ...rect(100, 100, 10, 10), id: "rm_0000abcf", roles: ["booth"], type: "booth" });
    const rt = sanitizeRoomShape(twoBooths, "proscenium@1", "S", 1)!;
    ok(rt.ok && rt.shape.rooms.filter((x) => x.roles.includes("booth")).length === 1 && rt.notes.length === 1, "#370 sanitize: a second Booth role is dropped with a note");
    const many = JSON.parse(JSON.stringify(good));
    for (let k = 0; k < 50; k++) many.rooms.push({ ...rect(200 + k * 20, 0, 10, 10), id: `rm_${(0x1000 + k).toString(16).padStart(8, "0")}` });
    const rm = sanitizeRoomShape(many, "proscenium@1", "S", 1)!;
    ok(rm.ok && rm.shape.rooms.length === 40, "#370 sanitize: at most 40 rooms");
    const longName = JSON.parse(JSON.stringify(good));
    longName.rooms[0].name = "x".repeat(200);
    longName.rooms[0].kind = "weird";
    longName.rooms[0].edges[0] = { kind: "arc", bulge: 0, open: "yes" };
    const rl = sanitizeRoomShape(longName, "proscenium@1", "S", 1)!;
    ok(rl.ok && rl.shape.rooms[0].name.length === 60 && rl.shape.rooms[0].kind === "room" && rl.shape.rooms[0].edges[0].kind === "line" && !rl.shape.rooms[0].edges[0].open,
      "#370 sanitize: names cap at 60, a bad kind takes the type's, a zero bulge is a line, open only when exactly true");
  }
```

The drop count in the `bad` case: room 2 (NaN) dropped, the duplicate-id copy dropped, the unknown type dropped, the crossing room dropped → 4 notes; rooms = original − 1. If room 2 holds the house role, the result is refused instead — check `good.rooms[2].roles` first and pick an index whose room holds no role (Pit is index 1 when the pit is on; use an index found with `good.rooms.findIndex((x) => !x.roles.length)`). Write it that way:

```ts
    const victim = good.rooms.findIndex((x) => !x.roles.length);
    bad.rooms[victim].pts[0].x = Number.NaN;
```

(replace the `bad.rooms[2]` line).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `sanitize.ts`**

```ts
// src/lib/design/room-shape/sanitize.ts
import { SHAPE_NEEDS_STAGE_HOUSE, SHAPE_STALE, SHAPE_UNREADABLE } from "./copy";
import { dist, selfCrosses } from "./geometry";
import { ROOM_ROLES, ROOM_TYPES, ROOM_TYPE_KEYS, SHAPE_LIMITS, type RoomRole, type RoomShape, type RoomTypeKey, type ShapeEdge, type ShapePt, type ShapeRoom } from "./types";

export type SanitizeResult = { ok: true; shape: RoomShape; notes: string[] } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, cap: number): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= cap ? v : null);
const pt = (v: unknown): ShapePt | null => {
  if (!isObj(v)) return null;
  const x = num(v.x, SHAPE_LIMITS.coordFt), y = num(v.y, SHAPE_LIMITS.coordFt);
  return x === null || y === null ? null : { x, y };
};

function edge(v: unknown): ShapeEdge | null {
  if (!isObj(v)) return null;
  const open = v.open === true ? { open: true as const } : {};
  if (v.kind === "line") return { kind: "line", ...open };
  if (v.kind === "arc") {
    const b = num(v.bulge, SHAPE_LIMITS.bulge);
    if (b === null) return null;
    return Math.abs(b) < 1e-6 ? { kind: "line", ...open } : { kind: "arc", bulge: b, ...open };
  }
  if (v.kind === "curve") {
    const c1 = pt(v.c1), c2 = pt(v.c2);
    return c1 && c2 ? { kind: "curve", c1, c2, ...open } : null;
  }
  return null;
}

/** Why a room can't be kept, or its clean form. */
function room(v: unknown): { room: ShapeRoom } | { reason: string; name: string } {
  if (!isObj(v)) return { reason: "it could not be read", name: "a room" };
  const type = typeof v.type === "string" && (ROOM_TYPE_KEYS as readonly string[]).includes(v.type) ? (v.type as RoomTypeKey) : null;
  const rawName = typeof v.name === "string" ? v.name.trim().slice(0, SHAPE_LIMITS.name) : "";
  const label = rawName || (type ? ROOM_TYPES[type].label : "a room");
  if (!type) return { reason: "it isn't a known room type", name: label };
  if (typeof v.id !== "string" || !/^rm_[0-9a-f]{8}$/.test(v.id)) return { reason: "its id could not be read", name: label };
  if (!Array.isArray(v.pts) || !Array.isArray(v.edges) || v.pts.length < SHAPE_LIMITS.minPts || v.pts.length > SHAPE_LIMITS.pts || v.edges.length !== v.pts.length)
    return { reason: `it needs ${SHAPE_LIMITS.minPts}–${SHAPE_LIMITS.pts} corners`, name: label };
  const pts = v.pts.map(pt), edges = v.edges.map(edge);
  if (pts.some((p) => !p) || edges.some((e) => !e)) return { reason: "a corner or wall could not be read", name: label };
  const P = pts as ShapePt[];
  if (P.some((p, i) => dist(p, P[(i + 1) % P.length]) < 0.01)) return { reason: "two corners are in the same place", name: label };
  const kind = v.kind === "room" || v.kind === "zone" ? v.kind : ROOM_TYPES[type].kind;
  const roles = Array.isArray(v.roles) ? [...new Set(v.roles.filter((r): r is RoomRole => (ROOM_ROLES as readonly string[]).includes(r as string)))] : [];
  const out: ShapeRoom = { id: v.id, type, name: label, kind, roles, pts: P, edges: edges as ShapeEdge[] };
  if (selfCrosses(out)) return { reason: "it crosses itself", name: label };
  return { room: out };
}

/**
 * #370: a client's room shape, never trusted. null when none was sent. Refused (with the user's sentence) when it
 * can't be read, was frozen from another template, or has no Stage / House; otherwise bad rooms are dropped and a
 * repeated role is cleared, each with a note.
 */
export function sanitizeRoomShape(raw: unknown, tpl: string | null, by: string, now: number): SanitizeResult | null {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw) || raw.v !== 1 || !Array.isArray(raw.rooms) || typeof raw.fromTemplate !== "string") return { ok: false, error: SHAPE_UNREADABLE };
  if (!tpl || raw.fromTemplate !== tpl) return { ok: false, error: SHAPE_STALE };
  const notes: string[] = [];
  const rooms: ShapeRoom[] = [];
  const ids = new Set<string>();
  const roleTaken = new Set<RoomRole>();
  for (const v of raw.rooms) {
    if (rooms.length >= SHAPE_LIMITS.rooms) break;
    const r = room(v);
    if ("reason" in r) { notes.push(`Left out "${r.name}": ${r.reason}.`); continue; }
    if (ids.has(r.room.id)) { notes.push(`Left out "${r.room.name}": it repeats another room.`); continue; }
    ids.add(r.room.id);
    const kept: RoomRole[] = [];
    for (const role of r.room.roles) {
      if (roleTaken.has(role)) notes.push(`"${r.room.name}" isn't the ${role} any more — another room is.`);
      else { roleTaken.add(role); kept.push(role); }
    }
    rooms.push({ ...r.room, roles: kept });
  }
  if (!roleTaken.has("stage") || !roleTaken.has("house")) return { ok: false, error: SHAPE_NEEDS_STAGE_HOUSE };
  return { ok: true, shape: { v: 1, fromTemplate: raw.fromTemplate, rooms, frozenAt: now, by }, notes };
}
```

- [ ] **Step 4: Run tests** → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/room-shape/sanitize.ts scripts/test-room-shape.ts
git commit -m "feat(grid): #370 server-side room shape sanitize

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Edit operations + snapping

**Files:**
- Create: `src/lib/design/room-shape/edit.ts`, `src/lib/design/room-shape/snap.ts`
- Test: `scripts/test-room-shape.ts`

**Interfaces:**
- Consumes: geometry (`add, sub, mul, dist, edgeAt, arcInfo, bulgeForRadius, bulgeForArcLength, splitEdge, withOpen, selfCrosses`), `fmtFeet`, `ROOM_TYPES`, `SHAPE_LIMITS`.
- Produces:

```ts
export type EditOp =
  | { op: "move"; room: string; i: number; to: ShapePt; glue: boolean }
  | { op: "addPoint"; room: string; edge: number }
  | { op: "setBulge"; room: string; edge: number; bulge: number }
  | { op: "toFreeform"; room: string; edge: number }
  | { op: "setHandles"; room: string; edge: number; c1: ShapePt; c2: ShapePt }
  | { op: "straighten"; room: string; edge: number }
  | { op: "setOpen"; room: string; edge: number; open: boolean }
  | { op: "setLength"; room: string; edge: number; ft: number; from: "far" | "near" }
  | { op: "setRadius"; room: string; edge: number; ft: number }
  | { op: "setArcLength"; room: string; edge: number; ft: number }
  | { op: "deletePoint"; room: string; i: number }
  | { op: "rename"; room: string; name: string }
  | { op: "retype"; room: string; type: RoomTypeKey }
  | { op: "deleteRoom"; room: string };
export type EditResult = { ok: true; shape: RoomShape } | { ok: false; reason: string };
export function applyEdit(shape: RoomShape, op: EditOp): EditResult;
export type Snapped = { pt: ShapePt; guide: [ShapePt, ShapePt] | null };
export function snapCorner(raw: ShapePt, neighbours: Array<{ at: ShapePt; wallDir: ShapePt | null }>, o: { gridFt: number; angles: boolean }): Snapped;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { applyEdit } from "../src/lib/design/room-shape/edit";
import { snapCorner } from "../src/lib/design/room-shape/snap";
import type { RoomShape } from "../src/lib/design/room-shape/types";
```

```ts
  {
    const S = (rooms: ShapeRoom[]): RoomShape => ({ v: 1, fromTemplate: "proscenium@1", rooms, frozenAt: 0, by: "" });
    const house = rect(0, 0, 20, 10, { id: "rm_00000001", roles: ["house", "stage"], type: "house", name: "House" });
    const booth = rect(20, 0, 5, 5, { id: "rm_00000002", name: "Booth", type: "booth" }); // shares the corner (20, 0)
    const base = S([house, booth]);
    const get = (r: { ok: boolean }) => (r as { shape: RoomShape }).shape;
    const mv = applyEdit(base, { op: "move", room: house.id, i: 1, to: { x: 22, y: 0 }, glue: true });
    ok(mv.ok && get(mv).rooms[1].pts[0].x === 22 && get(mv).rooms[0].pts[1].x === 22 && base.rooms[0].pts[1].x === 20, "#370 edit: a moved corner drags a glued corner of another room; the input is untouched");
    const mv2 = applyEdit(base, { op: "move", room: house.id, i: 1, to: { x: 22, y: 0 }, glue: false });
    ok(mv2.ok && get(mv2).rooms[1].pts[0].x === 20, "#370 edit: without glue only the one corner moves");
    const cross = applyEdit(base, { op: "move", room: house.id, i: 0, to: { x: 30, y: 5 }, glue: false }); // (0,10)→(30,5) crosses x = 20
    ok(!cross.ok && /cross itself/.test((cross as { reason: string }).reason), "#370 edit: a move that makes the outline cross itself is refused");
    const ap = applyEdit(base, { op: "addPoint", room: house.id, edge: 0 });
    ok(ap.ok && get(ap).rooms[0].pts.length === 5 && nearPt(get(ap).rooms[0].pts[1], { x: 10, y: 0 }), "#370 edit: Add point splits the wall at its middle");
    const cv = applyEdit(base, { op: "setBulge", room: house.id, edge: 0, bulge: -0.3 });
    ok(cv.ok && get(cv).rooms[0].edges[0].kind === "arc", "#370 edit: Curve makes the wall an arc");
    ok(get(applyEdit(get(cv), { op: "setBulge", room: house.id, edge: 0, bulge: 0 })).rooms[0].edges[0].kind === "line", "#370 edit: a zero bow is a straight wall again");
    const rr = applyEdit(get(cv), { op: "setRadius", room: house.id, edge: 0, ft: 30 });
    ok(rr.ok && near(arcInfo({ x: 0, y: 0 }, { x: 20, y: 0 }, (get(rr).rooms[0].edges[0] as { bulge: number }).bulge)!.r, 30, 1e-6), "#370 edit: typing a radius sets it");
    ok(!applyEdit(get(cv), { op: "setRadius", room: house.id, edge: 0, ft: 5 }).ok, "#370 edit: a radius under half the chord is refused");
    const al = applyEdit(get(cv), { op: "setArcLength", room: house.id, edge: 0, ft: 22 });
    ok(al.ok && near(arcInfo({ x: 0, y: 0 }, { x: 20, y: 0 }, (get(al).rooms[0].edges[0] as { bulge: number }).bulge)!.length, 22, 1e-4), "#370 edit: typing an arc length sets it");
    const ff = applyEdit(base, { op: "toFreeform", room: house.id, edge: 0 });
    ok(ff.ok && get(ff).rooms[0].edges[0].kind === "curve", "#370 edit: Free-form makes a Bezier");
    ok(get(applyEdit(get(ff), { op: "straighten", room: house.id, edge: 0 })).rooms[0].edges[0].kind === "line", "#370 edit: Straighten");
    const op = applyEdit(base, { op: "setOpen", room: house.id, edge: 2, open: true });
    ok(op.ok && get(op).rooms[0].edges[2].open === true && get(applyEdit(get(op), { op: "setOpen", room: house.id, edge: 2, open: false })).rooms[0].edges[2].open === undefined, "#370 edit: Wall / Open toggles");
    // 23', not 25': at 25 the glued Booth corner would land on the Booth's own (25, 0) corner and be refused
    const ln = applyEdit(base, { op: "setLength", room: house.id, edge: 0, ft: 23, from: "far" });
    ok(ln.ok && get(ln).rooms[0].pts[1].x === 23 && get(ln).rooms[1].pts[0].x === 23, "#370 edit: typing a length moves the far corner (glued corners follow)");
    const lnN = applyEdit(base, { op: "setLength", room: house.id, edge: 0, ft: 25, from: "near" });
    ok(lnN.ok && get(lnN).rooms[0].pts[0].x === -5, "#370 edit: Alt moves the near corner");
    const dp = applyEdit(get(ap), { op: "deletePoint", room: house.id, i: 1 });
    ok(dp.ok && get(dp).rooms[0].pts.length === 4 && !applyEdit(S([rect(0, 0, 3, 3, { pts: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 }], edges: [{ kind: "line" }, { kind: "line" }, { kind: "line" }] })]), { op: "deletePoint", room: "rm_00000001", i: 0 }).ok,
      "#370 edit: Delete point, refused below 3 corners");
    const rn = applyEdit(base, { op: "rename", room: booth.id, name: "  Control  " });
    ok(rn.ok && get(rn).rooms[1].name === "Control" && get(applyEdit(base, { op: "rename", room: booth.id, name: "" })).rooms[1].name === "Booth", "#370 edit: rename trims; blank = the type's label");
    ok(!applyEdit(base, { op: "deleteRoom", room: house.id }).ok && get(applyEdit(base, { op: "deleteRoom", room: booth.id })).rooms.length === 1, "#370 edit: the Stage / House room can't be deleted; others can");
    ok(get(applyEdit(base, { op: "retype", room: booth.id, type: "green" })).rooms[1].type === "green", "#370 edit: retype");
    ok(!applyEdit(base, { op: "move", room: "rm_ffffffff", i: 0, to: { x: 0, y: 0 }, glue: true }).ok, "#370 edit: an unknown room is refused, not thrown");
    // a curve's handles travel with a moved corner
    const ffMoved = applyEdit(get(ff), { op: "move", room: house.id, i: 0, to: { x: -2, y: 0 }, glue: false });
    const c0 = get(ff).rooms[0].edges[0] as { c1: ShapePt }, c1m = get(ffMoved).rooms[0].edges[0] as { c1: ShapePt };
    ok(ffMoved.ok && near(c1m.c1.x, c0.c1.x - 2), "#370 edit: a Bezier handle moves with its corner");
    // snapping
    const sn = snapCorner({ x: 10.1, y: 0.3 }, [{ at: { x: 0, y: 0 }, wallDir: null }], { gridFt: 0.5, angles: true });
    ok(near(sn.pt.y, 0) && near(sn.pt.x, 10) && !!sn.guide, "#370 snap: near-horizontal from a neighbour snaps onto the line, length to the 6\" grid");
    const s45 = snapCorner({ x: 7.2, y: 6.9 }, [{ at: { x: 0, y: 0 }, wallDir: null }], { gridFt: 0.5, angles: true });
    ok(near(s45.pt.x, s45.pt.y, 1e-9), "#370 snap: 45° snaps");
    const sg = snapCorner({ x: 3.3, y: 7.8 }, [{ at: { x: 0, y: 0 }, wallDir: null }], { gridFt: 1, angles: true });
    ok(sg.pt.x === 3 && sg.pt.y === 8 && sg.guide === null, "#370 snap: off every direction, the point rounds to the grid (1' with Shift)");
    const rel = snapCorner({ x: 10, y: 10.4 }, [{ at: { x: 10, y: 0 }, wallDir: { x: Math.cos(0.3), y: Math.sin(0.3) } }], { gridFt: 0.5, angles: true });
    ok(rel.guide !== null, "#370 snap: 90° relative to the neighbour's own wall counts");
  }
```

Note: in `rel`, the neighbour wall runs at 0.3 rad; its perpendicular is 0.3 + π/2 ≈ 107°, and (10,10.4) from (10,0) is at 90° — 17° away, so only the absolute 90° snaps; the check is just that a guide exists.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `edit.ts`**

```ts
// src/lib/design/room-shape/edit.ts
import { add, arcInfo, bulgeForArcLength, bulgeForRadius, dist, edgeAt, mul, selfCrosses, splitEdge, sub, withOpen } from "./geometry";
import { ROOM_TYPES, SHAPE_LIMITS, type RoomShape, type RoomTypeKey, type ShapeEdge, type ShapePt, type ShapeRoom } from "./types";
import { fmtFeet } from "./units";

export type EditOp =
  | { op: "move"; room: string; i: number; to: ShapePt; glue: boolean }
  | { op: "addPoint"; room: string; edge: number }
  | { op: "setBulge"; room: string; edge: number; bulge: number }
  | { op: "toFreeform"; room: string; edge: number }
  | { op: "setHandles"; room: string; edge: number; c1: ShapePt; c2: ShapePt }
  | { op: "straighten"; room: string; edge: number }
  | { op: "setOpen"; room: string; edge: number; open: boolean }
  | { op: "setLength"; room: string; edge: number; ft: number; from: "far" | "near" }
  | { op: "setRadius"; room: string; edge: number; ft: number }
  | { op: "setArcLength"; room: string; edge: number; ft: number }
  | { op: "deletePoint"; room: string; i: number }
  | { op: "rename"; room: string; name: string }
  | { op: "retype"; room: string; type: RoomTypeKey }
  | { op: "deleteRoom"; room: string };

export type EditResult = { ok: true; shape: RoomShape } | { ok: false; reason: string };

const bad = (reason: string): EditResult => ({ ok: false, reason });

/** Move corner k of a room to `to`, carrying the Bezier handles on either side by the same delta. */
function movePt(r: ShapeRoom, k: number, to: ShapePt): void {
  const n = r.pts.length, d = sub(to, r.pts[k]);
  r.pts[k] = { x: to.x, y: to.y };
  const out = r.edges[k];
  if (out.kind === "curve") r.edges[k] = { ...out, c1: add(out.c1, d) };
  const inn = r.edges[(k - 1 + n) % n];
  if (inn.kind === "curve") r.edges[(k - 1 + n) % n] = { ...inn, c2: add(inn.c2, d) };
}

/** Every room touched must still be a valid outline. */
function check(next: RoomShape, touched: readonly string[]): EditResult {
  for (const id of touched) {
    const r = next.rooms.find((x) => x.id === id);
    if (!r) continue;
    if (r.pts.length < SHAPE_LIMITS.minPts) return bad("A room needs at least 3 corners.");
    if (r.pts.some((p, i) => dist(p, r.pts[(i + 1) % r.pts.length]) < 0.01)) return bad("Two corners can't sit in the same place.");
    if (selfCrosses(r)) return bad(`That would make the ${r.name} cross itself.`);
  }
  return { ok: true, shape: next };
}

/**
 * #370: one edit to a room shape — pure; the input is never mutated. A refusal names why in the user's words.
 * Glue (move / setLength): every other corner within 0.5" of the moved corner's old spot moves with it.
 */
export function applyEdit(shape: RoomShape, op: EditOp): EditResult {
  const next: RoomShape = structuredClone(shape);
  const r = next.rooms.find((x) => x.id === op.room);
  if (!r) return bad("That room is gone — try again.");
  const n = r.pts.length;
  const edgeIdx = "edge" in op ? op.edge : -1;
  if ("edge" in op && !(edgeIdx >= 0 && edgeIdx < n)) return bad("That wall is gone — try again.");
  const a = edgeIdx >= 0 ? r.pts[edgeIdx] : null, b = edgeIdx >= 0 ? r.pts[(edgeIdx + 1) % n] : null;
  const e: ShapeEdge | null = edgeIdx >= 0 ? r.edges[edgeIdx] : null;

  const moveGlued = (k: number, to: ShapePt, glue: boolean): string[] => {
    const from = r.pts[k], d = sub(to, from);
    const touched = [r.id];
    if (glue)
      for (const o of next.rooms)
        for (let q = 0; q < o.pts.length; q++)
          if (!(o === r && q === k) && dist(o.pts[q], from) <= SHAPE_LIMITS.glueFt) {
            movePt(o, q, add(o.pts[q], d));
            if (!touched.includes(o.id)) touched.push(o.id);
          }
    movePt(r, k, to);
    return touched;
  };

  switch (op.op) {
    case "move": {
      if (!(op.i >= 0 && op.i < n)) return bad("That corner is gone — try again.");
      if (![op.to.x, op.to.y].every((v) => Number.isFinite(v) && Math.abs(v) <= SHAPE_LIMITS.coordFt)) return bad("That's off the plan.");
      return check(next, moveGlued(op.i, op.to, op.glue));
    }
    case "addPoint": {
      if (n >= SHAPE_LIMITS.pts) return bad(`A room can have at most ${SHAPE_LIMITS.pts} corners.`);
      const s = splitEdge(a!, b!, e!, 0.5);
      r.pts.splice(edgeIdx + 1, 0, s.at);
      r.edges.splice(edgeIdx, 1, s.first, s.second);
      return check(next, [r.id]);
    }
    case "setBulge": {
      if (!Number.isFinite(op.bulge)) return bad("That curve can't be drawn.");
      const bl = Math.max(-SHAPE_LIMITS.bulge, Math.min(SHAPE_LIMITS.bulge, op.bulge));
      r.edges[edgeIdx] = withOpen(Math.abs(bl) < 1e-3 ? { kind: "line" } : { kind: "arc", bulge: bl }, !!e!.open);
      return check(next, [r.id]);
    }
    case "toFreeform": {
      r.edges[edgeIdx] = withOpen({ kind: "curve", c1: edgeAt(a!, b!, e!, 1 / 3), c2: edgeAt(a!, b!, e!, 2 / 3) }, !!e!.open);
      return check(next, [r.id]);
    }
    case "setHandles": {
      if (e!.kind !== "curve") return bad("That wall isn't free-form.");
      r.edges[edgeIdx] = { ...e!, c1: op.c1, c2: op.c2 };
      return check(next, [r.id]);
    }
    case "straighten":
      r.edges[edgeIdx] = withOpen({ kind: "line" }, !!e!.open);
      return check(next, [r.id]);
    case "setOpen":
      r.edges[edgeIdx] = withOpen(e!, op.open);
      return { ok: true, shape: next };
    case "setLength": {
      if (e!.kind !== "line") return bad("Only a straight wall takes a length — use Radius or Arc length for a curve.");
      if (!(op.ft > 0)) return bad("The length must be more than 0.");
      const L = dist(a!, b!);
      if (L < 1e-9) return bad("That wall has no direction to grow along.");
      const u = mul(sub(b!, a!), 1 / L);
      const touched = op.from === "far" ? moveGlued((edgeIdx + 1) % n, add(a!, mul(u, op.ft)), true) : moveGlued(edgeIdx, sub(b!, mul(u, op.ft)), true);
      return check(next, touched);
    }
    case "setRadius": {
      if (e!.kind !== "arc") return bad("Only a curved wall has a radius.");
      const L = dist(a!, b!);
      const bl = bulgeForRadius(L, op.ft, e!.bulge);
      if (bl === null) return bad(`The radius must be at least ${fmtFeet(L / 2)} — half the wall's straight length.`);
      r.edges[edgeIdx] = withOpen({ kind: "arc", bulge: bl }, !!e!.open);
      return check(next, [r.id]);
    }
    case "setArcLength": {
      if (e!.kind !== "arc") return bad("Only a curved wall has an arc length.");
      const L = dist(a!, b!);
      const bl = bulgeForArcLength(L, op.ft, e!.bulge);
      if (bl === null) return bad(`The arc must be longer than the straight distance (${fmtFeet(L)}).`);
      r.edges[edgeIdx] = withOpen({ kind: "arc", bulge: bl }, !!e!.open);
      return check(next, [r.id]);
    }
    case "deletePoint": {
      if (!(op.i >= 0 && op.i < n)) return bad("That corner is gone — try again.");
      if (n <= SHAPE_LIMITS.minPts) return bad("A room needs at least 3 corners.");
      const prev = (op.i - 1 + n) % n;
      const open = !!r.edges[prev].open && !!r.edges[op.i].open;
      r.pts.splice(op.i, 1);
      r.edges.splice(op.i, 1);
      r.edges[op.i === 0 ? r.edges.length - 1 : op.i - 1] = withOpen({ kind: "line" }, open);
      return check(next, [r.id]);
    }
    case "rename":
      r.name = op.name.trim().slice(0, SHAPE_LIMITS.name) || ROOM_TYPES[r.type].label;
      return { ok: true, shape: next };
    case "retype":
      if (!ROOM_TYPES[op.type]) return bad("That isn't a room type.");
      r.type = op.type;
      return { ok: true, shape: next };
    case "deleteRoom":
      if (r.roles.includes("stage") || r.roles.includes("house")) return bad("The Stage and the House can't be deleted.");
      next.rooms = next.rooms.filter((x) => x.id !== r.id);
      return { ok: true, shape: next };
  }
}

/** Arc info for the UI (radius / arc length boxes) — re-exported so the editor imports edits from one place. */
export { arcInfo };
```

Check the `deletePoint` index arithmetic: removing corner i removes edges[i] (i → i+1); the edge that ran prev → i now runs prev → i+1 and sits at index `prev` (or the last index when i was 0). The line above sets exactly that.

- [ ] **Step 4: Write `snap.ts`**

```ts
// src/lib/design/room-shape/snap.ts
import type { ShapePt } from "./types";

export type Snapped = { pt: ShapePt; guide: [ShapePt, ShapePt] | null };
const TOL = (4 * Math.PI) / 180;

/**
 * #370: a dragged corner snapped. Along a 45° direction from a neighbouring corner when within 4° of one (absolute,
 * or relative to that neighbour's other wall), its distance there rounded to the grid; otherwise to the grid.
 */
export function snapCorner(raw: ShapePt, neighbours: ReadonlyArray<{ at: ShapePt; wallDir: ShapePt | null }>, o: { gridFt: number; angles: boolean }): Snapped {
  const g = o.gridFt > 0 ? o.gridFt : 0.5;
  let best: { pt: ShapePt; d: number; from: ShapePt } | null = null;
  if (o.angles) {
    for (const nb of neighbours) {
      const v = { x: raw.x - nb.at.x, y: raw.y - nb.at.y }, len = Math.hypot(v.x, v.y);
      if (len < g) continue;
      const ang = Math.atan2(v.y, v.x);
      const cands = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
      if (nb.wallDir && Math.hypot(nb.wallDir.x, nb.wallDir.y) > 1e-9) {
        const w = Math.atan2(nb.wallDir.y, nb.wallDir.x);
        for (let k = 0; k < 8; k++) cands.push(w + (k * Math.PI) / 4);
      }
      for (const c of cands) {
        let diff = ang - c;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        if (Math.abs(diff) > TOL) continue;
        const L = Math.round((len * Math.cos(diff)) / g) * g;
        const pt = { x: nb.at.x + L * Math.cos(c), y: nb.at.y + L * Math.sin(c) };
        const d = Math.hypot(pt.x - raw.x, pt.y - raw.y);
        if (!best || d < best.d) best = { pt, d, from: nb.at };
      }
    }
  }
  if (best) return { pt: best.pt, guide: [best.from, best.pt] };
  return { pt: { x: Math.round(raw.x / g) * g, y: Math.round(raw.y / g) * g }, guide: null };
}
```

Floating point: `near(s45.pt.x, s45.pt.y, 1e-9)` holds because cos(π/4) = sin(π/4) in IEEE for the same L; if it flakes, compare within 1e-9 already allowed.

- [ ] **Step 5: Run tests** → all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/room-shape/edit.ts src/lib/design/room-shape/snap.ts scripts/test-room-shape.ts
git commit -m "feat(grid): #370 room shape edit operations and corner snapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The shape sheet SVG, Spaces, frame + review renders

**Files:**
- Create: `src/lib/design/room-shape/svg.ts`, `src/lib/design/room-shape/spaces.ts`, `scripts/room-shape-renders.ts`, `docs/room-shape/renders/*.svg` (generated)
- Test: `scripts/test-room-shape.ts`

**Interfaces:**
- Consumes: geometry, `fmtFeet`, `rowSpans` / `inPoly` from `src/lib/design/venue-templates/canvas.ts`, `clamp01` + `Point` from `src/lib/annotations.ts`.
- Produces: `pathD(pts: ShapePt[]): string`; `labelPoint(room: ShapeRoom): ShapePt`; `type ShapeSheet = { markup: string; frame: SheetFrame; widthPx: number; heightPx: number }`; `roomShapeSvg(shape: RoomShape, opts?: { extraPts?: ShapePt[] }): ShapeSheet`; `toSheet(p: ShapePt, f: SheetFrame): Point`; `fromSheet(p: Point, f: SheetFrame): ShapePt`; `frameScale(f: SheetFrame): number`; `shapeSpaces(shape: RoomShape, frame: SheetFrame, sheetId: string): Array<{ sheetId: string; page: 1; name: string; points: Point[]; fromRoom: string }>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { roomShapeSvg, labelPoint } from "../src/lib/design/room-shape/svg";
import { shapeSpaces, toSheet, fromSheet, frameScale } from "../src/lib/design/room-shape/spaces";
import { calibrationScale } from "../src/lib/annotations";
```

```ts
  {
    const shape = freezeFromTemplate(stateFor("school"), "proscenium@1", { by: "T", at: 1 });
    const sheet = roomShapeSvg(shape);
    const f = sheet.frame;
    ok(sheet.markup.startsWith("<svg") && sheet.markup.includes(`viewBox="${f.minX} ${f.minY} ${f.wFt} ${f.hFt}"`) && sheet.widthPx === 1200 && sheet.heightPx === Math.round((1200 * f.hFt) / f.wFt),
      "#370 svg: an SVG in feet, 1200 px wide at the frame's aspect");
    const walls = (sheet.markup.match(/data-k="wall"/g) || []).length;
    const expected = shape.rooms.filter((r) => r.kind === "room").reduce((s, r) => s + r.edges.filter((e) => !e.open).length, 0);
    ok(walls === expected, `#370 svg: one wall band per walled edge (${walls})`);
    ok((sheet.markup.match(/data-k="zone"/g) || []).length === shape.rooms.filter((r) => r.kind === "zone").length, "#370 svg: one dashed outline per zone");
    ok(shape.rooms.every((r) => sheet.markup.includes(`>${r.name.replace(/&/g, "&amp;")}</text>`)), "#370 svg: every room is named");
    ok(sheet.markup === roomShapeSvg(shape).markup, "#370 svg: deterministic");
    const all = shape.rooms.flatMap((r) => outlinePoints(r));
    ok(all.every((p) => p.x > f.minX && p.y > f.minY && p.x < f.minX + f.wFt && p.y < f.minY + f.hFt), "#370 svg: every outline sits inside the frame");
    const ex = roomShapeSvg(shape, { extraPts: [{ x: 500, y: 500 }] }).frame;
    ok(ex.minX + ex.wFt > 500 && ex.minY + ex.hFt > 500, "#370 svg: extra points (placed devices) grow the frame");
    const p = { x: 12.25, y: -7.5 };
    ok(nearPt(fromSheet(toSheet(p, f), f), p, 1e-9), "#370 spaces: feet → sheet → feet round-trips");
    ok(near(frameScale(f), calibrationScale({ x: 0, y: 0 }, { x: 1, y: 0 }, f.hFt / f.wFt, f.wFt)!), "#370 spaces: the calibration is the frame's width in feet");
    const sp = shapeSpaces(shape, f, "sh1");
    ok(sp.length === shape.rooms.length && sp.every((s, i) => s.name === shape.rooms[i].name && s.fromRoom === shape.rooms[i].id && s.sheetId === "sh1" && s.page === 1 && s.points.length >= 3 && s.points.every((q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1)),
      "#370 spaces: one Space per room, same names, tagged fromRoom, normalized");
    const lp = labelPoint(shape.rooms.find((r) => r.name === "House")!);
    ok(lp.y > 0, "#370 svg: the House's name sits inside the house (below the plaster line)");
  }
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `svg.ts`**

```ts
// src/lib/design/room-shape/svg.ts
import { inPoly, rowSpans } from "@/lib/design/venue-templates/canvas";
import { arcInfo, bounds, centroid, dist, edgeLength, edgeMid, outlinePoints, outwardNormalAt, sampleEdge, signedArea, wallBands } from "./geometry";
import type { RoomShape, SheetFrame, ShapePt, ShapeRoom } from "./types";
import { fmtFeet } from "./units";

const n3 = (v: number) => String(Math.round(v * 1000) / 1000);
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A closed path through sampled points. */
export function pathD(pts: readonly ShapePt[]): string {
  return pts.length ? `M${pts.map((p) => `${n3(p.x)} ${n3(p.y)}`).join("L")}Z` : "";
}

/** Where a room's name goes: its centroid when inside, else the middle of the widest span across its centroid's row. */
export function labelPoint(room: Pick<ShapeRoom, "pts" | "edges">): ShapePt {
  const poly = outlinePoints(room, 1, 16);
  const c = centroid(poly);
  if (inPoly(poly, c)) return c;
  const spans = rowSpans(poly, c.y);
  if (!spans.length) return c;
  const [x0, x1] = spans.reduce((w, s) => (s[1] - s[0] > w[1] - w[0] ? s : w));
  return { x: (x0 + x1) / 2, y: c.y };
}

export type ShapeSheet = { markup: string; frame: SheetFrame; widthPx: number; heightPx: number };

const MARGIN_FT = 8;
const W_PX = 1200;
const WALL = "#3a3f4a", ROOM_FILL = "#f4f5f7", ZONE = "#6b7280", OPEN = "#9aa0ab", DIM = "#737985";
const FONT = "IBM Plex Mono, monospace";

/**
 * #370: the base sheet drawn from a room shape — rooms (light fill, 6" walls on walled edges, a fine dashed line on
 * openings), zones (dashed), names, and a dimension on each walled edge of 4' or more. viewBox in feet; the frame
 * (with an 8' margin, grown to `extraPts`) is what every feet ↔ sheet conversion uses.
 */
export function roomShapeSvg(shape: RoomShape, opts: { extraPts?: readonly ShapePt[] } = {}): ShapeSheet {
  const rooms = [...shape.rooms].sort((a, b) => Math.abs(signedArea(outlinePoints(b, 2, 8))) - Math.abs(signedArea(outlinePoints(a, 2, 8))));
  const bands = rooms.flatMap((r) => wallBands(r));
  const b = bounds([...rooms.flatMap((r) => outlinePoints(r, 1, 32)), ...bands.flat(), ...(opts.extraPts ?? [])]);
  const minX = Math.floor(b.minX - MARGIN_FT), minY = Math.floor(b.minY - MARGIN_FT);
  const wFt = Math.ceil(b.maxX + MARGIN_FT) - minX, hFt = Math.ceil(b.maxY + MARGIN_FT) - minY;
  const frame: SheetFrame = { minX, minY, wFt, hFt };
  const heightPx = Math.round((W_PX * hFt) / wFt);
  const parts: string[] = [`<rect x="${minX}" y="${minY}" width="${wFt}" height="${hFt}" fill="#fff"/>`];
  for (const r of rooms) {
    const d = pathD(outlinePoints(r));
    parts.push(r.kind === "zone"
      ? `<path data-k="zone" d="${d}" fill="none" stroke="${ZONE}" stroke-width="0.15" stroke-dasharray="1 0.6"/>`
      : `<path data-k="room" d="${d}" fill="${ROOM_FILL}"/>`);
  }
  for (const r of rooms) {
    if (r.kind === "zone") continue;
    for (const band of wallBands(r)) parts.push(`<path data-k="wall" d="${pathD(band)}" fill="${WALL}"/>`);
    const n = r.pts.length;
    for (let i = 0; i < n; i++) {
      if (!r.edges[i].open) continue;
      const pts = [...sampleEdge(r.pts[i], r.pts[(i + 1) % n], r.edges[i], 0.5, 64), r.pts[(i + 1) % n]];
      parts.push(`<path data-k="open" d="M${pts.map((p) => `${n3(p.x)} ${n3(p.y)}`).join("L")}" fill="none" stroke="${OPEN}" stroke-width="0.06" stroke-dasharray="0.5 0.4"/>`);
    }
  }
  for (const r of rooms) {
    if (r.kind === "zone") continue;
    const n = r.pts.length, area = signedArea(outlinePoints(r, 0.5, 32));
    for (let i = 0; i < n; i++) {
      const a = r.pts[i], q = r.pts[(i + 1) % n], e = r.edges[i];
      if (e.open || dist(a, q) < 4) continue;
      const m = edgeMid(a, q, e), nn = outwardNormalAt(area, a, q, e, 0.5);
      const at = { x: m.x + nn.x * 1.6, y: m.y + nn.y * 1.6 };
      let deg = (Math.atan2(q.y - a.y, q.x - a.x) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      const A = e.kind === "arc" ? arcInfo(a, q, e.bulge) : null;
      const text = A ? `R ${fmtFeet(A.r)}` : fmtFeet(edgeLength(a, q, e));
      parts.push(`<text data-k="dim" x="${n3(at.x)}" y="${n3(at.y)}" transform="rotate(${n3(deg)} ${n3(at.x)} ${n3(at.y)})" text-anchor="middle" dominant-baseline="middle" font-size="0.8" fill="${DIM}" font-family="${FONT}">${esc(text)}</text>`);
    }
  }
  for (const r of rooms) {
    const p = labelPoint(r);
    parts.push(`<text data-k="name" x="${n3(p.x)}" y="${n3(p.y)}" text-anchor="middle" dominant-baseline="middle" font-size="1.1" font-weight="600" fill="${WALL}" font-family="${FONT}">${esc(r.name)}</text>`);
  }
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${W_PX}" height="${heightPx}" viewBox="${minX} ${minY} ${wFt} ${hFt}" preserveAspectRatio="xMidYMid meet">${parts.join("")}</svg>`;
  return { markup, frame, widthPx: W_PX, heightPx };
}
```

- [ ] **Step 4: Write `spaces.ts`**

```ts
// src/lib/design/room-shape/spaces.ts
import { clamp01, type Point } from "@/lib/annotations";
import { outlinePoints } from "./geometry";
import type { RoomShape, SheetFrame, ShapePt } from "./types";

/** #370: feet → the sheet's normalized 0..1 (clamped), and back. */
export const toSheet = (p: ShapePt, f: SheetFrame): Point => ({ x: clamp01((p.x - f.minX) / f.wFt), y: clamp01((p.y - f.minY) / f.hFt) });
export const fromSheet = (p: Point, f: SheetFrame): ShapePt => ({ x: f.minX + p.x * f.wFt, y: f.minY + p.y * f.hFt });

/** The sheet's calibration scale (feet per normalized sheet width — calibrationScale over (0,0)–(1,0)). */
export const frameScale = (f: SheetFrame): number => f.wFt;

/** #370: one Space per room and zone, in shape order, named as on the plan and tagged with its room. */
export function shapeSpaces(shape: RoomShape, frame: SheetFrame, sheetId: string): Array<{ sheetId: string; page: 1; name: string; points: Point[]; fromRoom: string }> {
  return shape.rooms.map((r) => ({ sheetId, page: 1 as const, name: r.name, points: outlinePoints(r, 0.5, 64).map((p) => toSheet(p, frame)), fromRoom: r.id }));
}
```

- [ ] **Step 5: Run tests** → all PASS.

- [ ] **Step 6: Write the review renders script**

```ts
// scripts/room-shape-renders.ts
/* #370: frozen-shape renders of every template at its intake defaults, for Jeff's review (and ours) —
   `npx tsx scripts/room-shape-renders.ts` writes docs/room-shape/renders/<venue>-<template>.svg. Pure; no DB. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freezeFromTemplate } from "../src/lib/design/room-shape/freeze";
import { roomShapeSvg } from "../src/lib/design/room-shape/svg";
import { gridIntakeDefaults } from "../src/lib/design/grid-intake";
import { VENUES, sizedDims } from "../src/app/(app)/design/quick/engine";

const CASES: Array<[string, string]> = [
  ["school", "proscenium@1"], ["gym", "gym-stage@1"], ["church", "church-traditional@1"], ["church", "church-contemporary@2"],
  ["blackbox", "blackbox@1"], ["concenter", "blackbox@1"], ["arena", "arena@1"],
];
const out = join(process.cwd(), "docs/room-shape/renders");
mkdirSync(out, { recursive: true });
for (const [key, tpl] of CASES) {
  const v = VENUES.find((x) => x.key === key)!;
  const shape = freezeFromTemplate({ ...gridIntakeDefaults(), venue: v.key, sys: { ...v.sys }, ...sizedDims(v, "large") }, tpl, { by: "renders", at: 0 });
  const file = join(out, `${key}-${tpl.replace("@", "-")}.svg`);
  writeFileSync(file, roomShapeSvg(shape).markup);
  console.log(file, shape.rooms.map((r) => `${r.name}:${r.kind}`).join(", "));
}
```

Run: `npx tsx scripts/room-shape-renders.ts` → seven files. **Look at every one** (open each in the browser pane: `mcp__Claude_Browser__navigate` to `file:///Users/sm/Downloads/peak-app/.claude/worktrees/room-shape/docs/room-shape/renders/<file>.svg`, then screenshot). Check: the stage opening and stage lip have no wall; outer walls are continuous; zones are dashed; names sit inside their rooms. A wrong opening means wall detection is off for that template — fix `walls.ts` or add a `FREEZE_HINTS` entry, re-run Task 3's tests, re-render. Record what you saw in the commit body.

- [ ] **Step 7: Commit**

```bash
git add src/lib/design/room-shape/svg.ts src/lib/design/room-shape/spaces.ts scripts/room-shape-renders.ts docs/room-shape/renders scripts/test-room-shape.ts
git commit -m "feat(grid): #370 base sheet SVG and Spaces drawn from a room shape, review renders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Store + intake save wiring

**Files:**
- Modify: `src/lib/stores/grid-projects.ts` (intake type ~line 354–381; `GridSpace` ~259; `starterSpaces` ~543; `generateBaseSheet` ~571; `saveGridIntake` ~663; `addSpace` ~2490)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`saveGridIntakeAction` ~315–500)
- Test: `scripts/test-room-shape.ts` (`roomShapeDbChecks`)

**Interfaces:**
- Consumes: `RoomShape`, `SheetFrame` (types), `roomShapeSvg`, `shapeSpaces`, `frameScale`, `sanitizeRoomShape`.
- Produces: `GridProject["intake"]` gains `roomShape?: RoomShape; baseSheetShape?: RoomShape; baseSheetFrame?: SheetFrame`; `GridSpace.fromRoom?: string`; `addSpace` input gains `fromRoom?: string`; `generateBaseSheet(projectId, a, accent, by, tpl?, shape?: RoomShape | null)`; `saveGridIntakeAction` input gains `roomShape?: unknown`.

- [ ] **Step 1: Write the failing DB test** — append to the end of `roomShapeDbChecks` (after Task 3's starter-Space loop; `GP` is already imported there):

```ts
  const { setScopeInputs, setAutoEstimate } = GP;
  const { resolveOptionId } = await import("../src/lib/design/grid-options");
  const { intakeScopeInputs } = await import("../src/lib/design/grid-intake");
  const { fillAutoScopes } = await import("../src/lib/design/grid-auto-fill");
  const by = "Test Harness";
  const v = VENUES.find((x) => x.key === "school")!;
  const a: AState = { ...gridIntakeDefaults(), venue: v.key, sys: { ...v.sys }, ...sizedDims(v, "large") };
  const shape = freezeFromTemplate(a, "proscenium@1", { by, at: 1 });
  const p0 = await GP.createProject({ name: "RS370 shape", customer: "", customerId: null, by });
  await GP.saveGridIntake(p0.id, { complete: true, measurementBased: true, mode: "auto", venueName: "Main", locationName: "HS", address: "", notes: "", autoConfig: a, roomShape: shape });
  await GP.generateBaseSheet(p0.id, a, "#3a3f4a", by, "proscenium@1", shape);
  const p = (await GP.getProject(p0.id))!;
  const it = p.intake!;
  ok(JSON.stringify(it.roomShape) === JSON.stringify(shape) && JSON.stringify(it.baseSheetShape) === JSON.stringify(shape) && it.baseSheetTemplate === "proscenium@1" && !!it.baseSheetFrame && it.baseSheetId === p.sheetIds[0],
    "#370 db: the intake keeps the shape, and the base sheet stamps its shape, frame and template");
  const cal = p.calibrations.find((c) => c.docId === it.baseSheetId);
  ok(!!cal && Math.abs(cal.scale - it.baseSheetFrame!.wFt) < 1e-9 && cal.unit === "ft", "#370 db: the base sheet is calibrated from the frame");
  ok((p.spaces || []).length === shape.rooms.length && (p.spaces || []).every((s, i) => s.fromRoom === shape.rooms[i].id && s.name === shape.rooms[i].name), "#370 db: one Space per room, tagged fromRoom");
  const sheets = await GP.listSheets(p0.id);
  ok(sheets[0]?.mime === "image/svg+xml", "#370 db: the base sheet is an SVG");
  // a re-save keeps the stamps
  await GP.saveGridIntake(p0.id, { complete: true, measurementBased: true, mode: "auto", venueName: "Main 2", locationName: "HS", address: "", notes: "", autoConfig: a, roomShape: shape });
  const p2 = (await GP.getProject(p0.id))!;
  ok(JSON.stringify(p2.intake!.baseSheetShape) === JSON.stringify(shape) && !!p2.intake!.baseSheetFrame, "#370 db: a re-save keeps the base sheet's shape stamp");
  // no shape = today's sheet, unchanged path
  const q0 = await GP.createProject({ name: "RS370 plain", customer: "", customerId: null, by });
  await GP.saveGridIntake(q0.id, { complete: true, measurementBased: true, mode: "auto", venueName: "Main", locationName: "HS", address: "", notes: "", autoConfig: a });
  await GP.generateBaseSheet(q0.id, a, "#3a3f4a", by, "proscenium@1");
  const q = (await GP.getProject(q0.id))!;
  ok(!q.intake!.baseSheetShape && !q.intake!.baseSheetFrame && (q.spaces || []).every((s) => !s.fromRoom), "#370 db: without a shape nothing new is stamped");
  // Auto fill on a shaped sheet runs and keeps every placement on the sheet (Task 8 makes it use the shape's frame)
  const opt = resolveOptionId(p, null);
  await setScopeInputs(p0.id, intakeScopeInputs(a));
  await setAutoEstimate(p0.id, opt, { tierByScope: { lighting: "better", audio: "better" }, overrides: {} });
  const res = await fillAutoScopes(p0.id, opt, ["lighting", "audio"], by);
  const filled = (await GP.getProject(p0.id))!;
  ok(res.ok && filled.placements.every((pl) => pl.x >= 0 && pl.x <= 1 && pl.y >= 0 && pl.y <= 1), `#370 db: Auto fill runs on a shaped sheet (${res.ok ? "ok" : res.error})`);
```

(the closing `}` of `roomShapeDbChecks` stays after it). Before writing it, confirm the names: `listSheets` exists in `grid-projects.ts` (`grep -n "export async function listSheets" src/lib/stores/grid-projects.ts`), `resolveOptionId` is exported from `src/lib/design/grid-options.ts` (`grep -n "export function resolveOptionId" -r src/lib`), and placements carry `x` / `y` (normalized). Adjust the import paths to where `grep` finds them.

- [ ] **Step 2: Run** `npm run test:specs` → FAIL (type errors / missing stamps). tsx doesn't type-check, so also run `npx tsc --noEmit` and expect errors naming `roomShape`.

- [ ] **Step 3: Edit `grid-projects.ts` — imports.** Add next to the other `@/lib/design/...` imports:

```ts
import type { RoomShape, SheetFrame } from "@/lib/design/room-shape/types";
import { roomShapeSvg } from "@/lib/design/room-shape/svg";
import { frameScale, shapeSpaces } from "@/lib/design/room-shape/spaces";
```

- [ ] **Step 4: Edit `grid-projects.ts` — types.** In `GridSpace`, after `levelId?: string;` add:

```ts
  /** #370: the room-shape room this Space was drawn from (a shape-drawn base sheet); absent = drawn by hand or from a template. */
  fromRoom?: string;
```

In `GridProject["intake"]`, after `baseSheetMovables?: …;` add:

```ts
    /** #370: the room shape being edited in the intake (Amendment A); absent = the template as stretched. */
    roomShape?: RoomShape;
    /** #370: the shape the base sheet was drawn from, and where it sits in feet — Auto fill and later edits read these, never the live `roomShape`. */
    baseSheetShape?: RoomShape;
    baseSheetFrame?: SheetFrame;
```

- [ ] **Step 5: Edit `addSpace`** — input type gains `fromRoom?: string`, and the pushed object gains it:

```ts
  input: { sheetId: string; page: number; name: string; points: Point[]; by: string; fromRoom?: string }
```
```ts
        points: input.points,
        ...(input.fromRoom ? { fromRoom: input.fromRoom } : {}),
        by: input.by,
```

- [ ] **Step 6: Edit `generateBaseSheet`** — add the parameter and an early branch; add the helper right above it:

```ts
/**
 * #370: a base sheet drawn from a room shape — the SVG, an exact calibration from its frame, one Space per room
 * (tagged fromRoom), and the shape + frame stamped beside the template id, so Auto fill and later edits read the
 * shape the sheet was drawn from.
 */
async function generateShapeSheet(projectId: string, shape: RoomShape, by: string): Promise<GridSheet | null> {
  const drawn = roomShapeSvg(shape);
  const sheet = await addSheet(projectId, {
    name: "Generated base plan",
    mime: "image/svg+xml",
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.markup)}`,
    by,
  });
  if (!sheet) return null;
  await setSheetCalibration(projectId, { docId: sheet.id, page: 1, scale: frameScale(drawn.frame), unit: "ft", refLength: drawn.frame.wFt, by, at: Date.now() });
  for (const sp of shapeSpaces(shape, drawn.frame, sheet.id)) await addSpace(projectId, { ...sp, by });
  await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!p.intake) return;
    p.intake.baseSheetId = sheet.id;
    p.intake.baseSheetTemplate = shape.fromTemplate;
    p.intake.baseSheetShape = shape;
    p.intake.baseSheetFrame = drawn.frame;
  });
  return sheet;
}
```

Signature + first line of `generateBaseSheet`:

```ts
export async function generateBaseSheet(
  projectId: string,
  a: AState,
  accent: string,
  by: string,
  tpl?: string | null,
  shape?: RoomShape | null
): Promise<GridSheet | null> {
  if (shape) return generateShapeSheet(projectId, shape, by);
```

- [ ] **Step 7: Edit `saveGridIntake`** — keep the stamps across re-saves; after `baseSheetMovables: input.baseSheetMovables ?? p.intake?.baseSheetMovables,` add:

```ts
      ...(input.baseSheetShape ?? p.intake?.baseSheetShape ? { baseSheetShape: input.baseSheetShape ?? p.intake?.baseSheetShape } : {}),
      ...(input.baseSheetFrame ?? p.intake?.baseSheetFrame ? { baseSheetFrame: input.baseSheetFrame ?? p.intake?.baseSheetFrame } : {}),
```

(`roomShape` comes in with `...input` as written by the caller.)

- [ ] **Step 8: Edit `saveGridIntakeAction`** in `src/app/(app)/design/grid/[id]/actions.ts`.
  1. Import: `import { sanitizeRoomShape } from "@/lib/design/room-shape/sanitize";`
  2. Input type: after `planCandidateId?: string | null;` add
     ```ts
       /** #370: the shaped room (the intake's editor) — never trusted, sanitized against the effective template. */
       roomShape?: unknown;
     ```
  3. Right after the `const autoConfig: AState = cleanMovables(…)` line add:
     ```ts
       // #370: the room shape, sanitized against the effective template before any write.
       const shaped = sanitizeRoomShape(input.roomShape ?? null, tpl, user.name, Date.now());
       if (shaped && !shaped.ok) return { ok: false, error: shaped.error };
       const roomShape = shaped?.ok ? shaped.shape : undefined;
       const shapeNote = shaped?.ok && shaped.notes.length ? `Some of the room shape was left out: ${shaped.notes.join(" ")}` : undefined;
     ```
  4. In the `saveGridIntake(input.projectId, { … autoConfig, })` call add `...(roomShape ? { roomShape } : {}),` after `autoConfig,`.
  5. Change `await generateBaseSheet(input.projectId, autoConfig, "#3a3f4a", user.name, tpl);` to
     ```ts
         await generateBaseSheet(input.projectId, autoConfig, "#3a3f4a", user.name, tpl, roomShape ?? null);
     ```
  6. Notices: after `if (warning) notices.push(…);` add
     ```ts
       if (shapeNote) notices.push({ id: newNoticeId(), message: shapeNote, at });
     ```
     and change `const allWarnings = [warning, planWarning].filter(Boolean).join(" ");` to `const allWarnings = [shapeNote, warning, planWarning].filter(Boolean).join(" ");`.

- [ ] **Step 9: Add a source pin** (the action can't run without a session). Append to `roomShapePureChecks`:

```ts
  {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/design/grid/[id]/actions.ts", "utf8");
    const body = src.slice(src.indexOf("export async function saveGridIntakeAction"));
    ok(body.indexOf("sanitizeRoomShape(") > 0 && body.indexOf("sanitizeRoomShape(") < body.indexOf("saveGridIntake(input.projectId") && body.includes("generateBaseSheet(input.projectId, autoConfig, \"#3a3f4a\", user.name, tpl, roomShape ?? null)"),
      "#370 pin: the intake save sanitizes the shape before any write and draws the base sheet from it");
  }
```

- [ ] **Step 10: Run** `npx tsc --noEmit` (0 errors) and `npm run test:specs` → ALL PASSED (the Auto-fill check passes on bounds alone here; Task 8 adds the frame checks). If the existing `#244` source-order pin (`saveGridIntake(input.projectId` before `generateBaseSheet(`) fails, the edit moved a call — put it back in order.

- [ ] **Step 11: Commit**

```bash
git add src/lib/stores/grid-projects.ts "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-room-shape.ts
git commit -m "feat(grid): #370 intake saves a sanitized room shape; base sheet, Spaces and calibration drawn from it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Auto fill reads the stamped shape

**Files:**
- Create: `src/lib/design/room-shape/frame.ts`
- Modify: `src/lib/design/grid-auto-layout.ts` (`venueFrame` ~65, `fillGeometry` ~178, `generateAutoLayout` ~343), `src/lib/design/grid-auto-fill.ts` (~39, ~73)
- Test: `scripts/test-room-shape.ts`

**Interfaces:**
- Consumes: `RoomShape`, `SheetFrame`, `outlinePoints`, `bounds`, `centroid`, `sampleEdge`, `edgeLength`, `toSheet`, `ARENA_CORNER_R` (`src/lib/design/venue-templates/arena.keys.ts`, inches).
- Produces:

```ts
// frame.ts
export type FtBox = { minX: number; minY: number; maxX: number; maxY: number };
export type ShapeRoles = {
  stage: FtBox; house: FtBox; booth: FtBox; catwalk: FtBox | null;
  /** The House's open curved run facing the stage (proscenium lip), feet; null when none. */
  stageEdge: ShapePt[] | null;
  sameStageHouse: boolean;
  /** Arena: the stage room's centre, its along / depth (feet) and the unit direction it faces (stage → house centroid). */
  stageCentre: ShapePt; stageAlongFt: number; stageDepthFt: number; facing: ShapePt;
};
export function shapeRoleBoxes(shape: RoomShape): ShapeRoles | null;
// grid-auto-layout.ts
export function venueFrame(a: AState, opts?: { legacy?: boolean; template?: string | null; shape?: { shape: RoomShape; frame: SheetFrame } }): VenueFrame;
export function fillGeometry(intake): { a: AState | undefined; stamp: string | undefined; shape?: { shape: RoomShape; frame: SheetFrame } };
// generateAutoLayout opts gain `shape?: { shape: RoomShape; frame: SheetFrame }`
```

- [ ] **Step 1: Write the failing tests**

```ts
import { shapeRoleBoxes } from "../src/lib/design/room-shape/frame";
import { venueFrame, fillGeometry } from "../src/lib/design/grid-auto-layout";
```

```ts
  {
    const a = { ...stateFor("school"), width: 50, wing: 10, depth: 30 };
    const shape = freezeFromTemplate(a, "proscenium@1", { by: "T", at: 1 });
    const R = shapeRoleBoxes(shape)!;
    ok(near(R.stage.maxX - R.stage.minX, 70, 0.1) && near(R.booth.maxX - R.booth.minX, 20, 0.1) && !!R.catwalk && !R.sameStageHouse, "#370 frame: stage 70' wide, booth 20', a catwalk, separate stage and house");
    ok(!!R.stageEdge && near(Math.max(...R.stageEdge.map((p) => p.y)), (9 + 171.833) / 12, 0.2), "#370 frame: the stage edge is the House's open lip arc, lowest ≈ 15'");
    const frame = roomShapeSvg(shape).frame;
    const f = venueFrame(a, { template: "proscenium@1", shape: { shape, frame } });
    const inUnit = (r: { x: number; y: number; w: number; h: number }) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1 && r.w > 0 && r.h > 0;
    ok(inUnit(f.stage) && inUnit(f.audience) && inUnit(f.booth) && !!f.catwalk && (f.stageEdge?.length ?? 0) > 1, "#370 frame: venueFrame's shape branch gives normalized stage / audience / booth / catwalk / stage edge");
    ok(near(f.stage.w * frame.wFt, 70, 0.1), "#370 frame: normalized against the shape sheet's frame");
    const bb = freezeFromTemplate(stateFor("blackbox"), "blackbox@1", { by: "T", at: 1 });
    const fb = venueFrame(stateFor("blackbox"), { template: "blackbox@1", shape: { shape: bb, frame: roomShapeSvg(bb).frame } });
    ok(!!fb.room && fb.stage.w < fb.room.w, "#370 frame: a blackbox (stage = house) insets its stage inside the room, as today");
    const ch = freezeFromTemplate(stateFor("church"), "church-traditional@1", { by: "T", at: 1 });
    ok(venueFrame(stateFor("church"), { template: "church-traditional@1", shape: { shape: ch, frame: roomShapeSvg(ch).frame } }).sideInside === true, "#370 frame: a church keeps side lights inside its platform walls");
    const ar = freezeFromTemplate(stateFor("arena"), "arena@1", { by: "T", at: 1 });
    const fa = venueFrame(stateFor("arena"), { template: "arena@1", shape: { shape: ar, frame: roomShapeSvg(ar).frame } });
    ok(!!fa.lotBox && inUnit(fa.lotBox), "#370 frame: an arena gets a lot box inside its floor");
    const g = fillGeometry({ autoConfig: a, baseSheetTemplate: "proscenium@1", baseSheetShape: shape, baseSheetFrame: frame });
    ok(g.shape?.shape === shape && g.stamp === "proscenium@1", "#370 frame: fillGeometry hands Auto fill the stamped shape");
    ok(!fillGeometry({ autoConfig: a, baseSheetTemplate: "proscenium@1" }).shape, "#370 frame: no stamped shape, none handed on");
  }
```

And extend the Task 7 DB check: after the fill, `const booth = venueFrame(a, { template: "proscenium@1", shape: { shape, frame: filled.intake!.baseSheetFrame! } }).booth;` and assert every `audio:mixerDsp` auto placement (`pl.auto?.rowKey === "audio:mixerDsp"`) lies inside `booth` (x within [booth.x, booth.x + booth.w], y likewise, 0.01 slack) — "#370 db: Auto fill puts the mixer in the shape's Booth". Log how many there were; the test DB's Equipment map may leave the mixer unplaced (a needs-a-part line), so don't require one — but if the count is 0, say so in the task report.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `frame.ts`**

```ts
// src/lib/design/room-shape/frame.ts
import { bounds, centroid, edgeLength, outlinePoints, sampleEdge } from "./geometry";
import type { RoomShape, ShapePt, ShapeRoom } from "./types";

export type FtBox = { minX: number; minY: number; maxX: number; maxY: number };
export type ShapeRoles = {
  stage: FtBox;
  house: FtBox;
  booth: FtBox;
  catwalk: FtBox | null;
  stageEdge: ShapePt[] | null;
  sameStageHouse: boolean;
  stageCentre: ShapePt;
  stageAlongFt: number;
  stageDepthFt: number;
  facing: ShapePt;
};

const boxOf = (r: ShapeRoom): FtBox => bounds(outlinePoints(r, 0.5, 32));

/** The House's open edges in a row, as sampled points; only its arcs / curves when it has any (the proscenium lip). */
function openRunFacing(house: ShapeRoom, toward: ShapePt): ShapePt[] | null {
  const n = house.pts.length;
  const open = house.edges.map((e, i) => (e.open ? i : -1)).filter((i) => i >= 0);
  if (!open.length) return null;
  const curved = open.filter((i) => house.edges[i].kind !== "line");
  const pick = curved.length ? curved : open;
  const d = (i: number) => {
    const m = sampleEdge(house.pts[i], house.pts[(i + 1) % n], house.edges[i], 0.5, 64);
    return Math.min(...m.map((p) => Math.hypot(p.x - toward.x, p.y - toward.y)));
  };
  const nearest = Math.min(...pick.map(d));
  const run = pick.filter((i) => d(i) <= nearest + 3).sort((x, y) => x - y);
  const pts = run.flatMap((i) => [...sampleEdge(house.pts[i], house.pts[(i + 1) % n], house.edges[i], 0.5, 64), house.pts[(i + 1) % n]]);
  return pts.length > 1 ? pts : null;
}

/** #370: the role rooms Auto fill lays out on, in feet. null when the shape has no Stage or House (sanitize refuses those). */
export function shapeRoleBoxes(shape: RoomShape): ShapeRoles | null {
  const byRole = (role: string) => shape.rooms.find((r) => (r.roles as string[]).includes(role)) ?? null;
  const stage = byRole("stage"), house = byRole("house");
  if (!stage || !house) return null;
  const hb = boxOf(house);
  const boothRoom = byRole("booth");
  // No Booth: an 8' × 6' box centred 6' in from the house's far end (the old FOH-mix stand-in).
  const cx = (hb.minX + hb.maxX) / 2;
  const booth: FtBox = boothRoom ? boxOf(boothRoom) : { minX: cx - 4, maxX: cx + 4, minY: hb.maxY - 9, maxY: hb.maxY - 3 };
  const catwalkRoom = byRole("catwalk");
  const sc = centroid(outlinePoints(stage, 0.5, 32)), hc = centroid(outlinePoints(house, 0.5, 32));
  const fl = Math.hypot(hc.x - sc.x, hc.y - sc.y);
  const facing = fl > 1e-6 ? { x: (hc.x - sc.x) / fl, y: (hc.y - sc.y) / fl } : { x: 0, y: 1 };
  const n = stage.pts.length;
  let along = 0;
  for (let i = 0; i < n; i++) along = Math.max(along, edgeLength(stage.pts[i], stage.pts[(i + 1) % n], stage.edges[i]));
  const sb = boxOf(stage);
  const depth = Math.max(0, Math.abs(facing.x) > Math.abs(facing.y) ? sb.maxX - sb.minX : sb.maxY - sb.minY);
  return {
    stage: sb,
    house: hb,
    booth,
    catwalk: catwalkRoom ? boxOf(catwalkRoom) : null,
    stageEdge: stage === house ? null : openRunFacing(house, sc),
    sameStageHouse: stage === house,
    stageCentre: sc,
    stageAlongFt: along,
    stageDepthFt: depth,
    facing,
  };
}
```

- [ ] **Step 4: Edit `grid-auto-layout.ts`.**
  1. Imports:
     ```ts
     import type { RoomShape, SheetFrame } from "@/lib/design/room-shape/types";
     import { shapeRoleBoxes, type FtBox } from "@/lib/design/room-shape/frame";
     import { toSheet } from "@/lib/design/room-shape/spaces";
     ```
     (`ARENA_CORNER_R` and `templateEntry` are already imported there — confirm with `grep -n "ARENA_CORNER_R\|templateEntry" src/lib/design/grid-auto-layout.ts`; add them if not.)
  2. Above `venueFrame`, add:
     ```ts
     /** #370: the frame of a shape-drawn base sheet — the role rooms' boxes, normalized by the sheet's own frame. */
     function shapeFrame(shape: RoomShape, fr: SheetFrame): VenueFrame | null {
       const R = shapeRoleBoxes(shape);
       if (!R) return null;
       const n = (b: FtBox): Rect => {
         const p = toSheet({ x: b.minX, y: b.minY }, fr), q = toSheet({ x: b.maxX, y: b.maxY }, fr);
         return { x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y };
       };
       const family = templateEntry(shape.fromTemplate)?.family;
       const audience = n(R.house);
       const base: VenueFrame = { stage: n(R.stage), audience, booth: n(R.booth), ...(R.catwalk ? { catwalk: n(R.catwalk) } : {}) };
       if (family === "proscenium" && R.stageEdge) base.stageEdge = R.stageEdge.map((p) => toSheet(p, fr));
       if (family === "church") base.sideInside = true;
       if (family === "blackbox") {
         base.room = audience;
         if (R.sameStageHouse) base.stage = blackboxStage(audience);
       }
       if (family === "arena") {
         // As the template branch: the stage laid out as if at the top end about its centre, turned into place.
         const c = toSheet(R.stageCentre, fr);
         base.stage = { x: c.x - R.stageAlongFt / fr.wFt / 2, y: c.y - R.stageDepthFt / fr.hFt / 2, w: R.stageAlongFt / fr.wFt, h: R.stageDepthFt / fr.hFt };
         const angle = Math.atan2(-R.facing.x, R.facing.y);
         if (Math.abs(angle) > 1e-9) { base.stageAngle = angle; base.aspect = fr.hFt / fr.wFt; }
         const cut = Math.min((0.3 * ARENA_CORNER_R) / 12, (R.house.maxX - R.house.minX) / 2, (R.house.maxY - R.house.minY) / 2);
         base.lotBox = n({ minX: R.house.minX + cut, minY: R.house.minY + cut, maxX: R.house.maxX - cut, maxY: R.house.maxY - cut });
       }
       return base;
     }
     ```
  3. `venueFrame` signature and first line:
     ```ts
     export function venueFrame(a: AState, opts: { legacy?: boolean; template?: string | null; shape?: { shape: RoomShape; frame: SheetFrame } } = {}): VenueFrame {
       if (opts.shape) {
         const f = shapeFrame(opts.shape.shape, opts.shape.frame);
         if (f) return f;
       }
     ```
  4. `fillGeometry`:
     ```ts
     export function fillGeometry(
       intake: { autoConfig?: AState; baseSheetTemplate?: string; baseSheetMovables?: Record<string, { wall: string; t: number }>; baseSheetShape?: RoomShape; baseSheetFrame?: SheetFrame } | undefined
     ): { a: AState | undefined; stamp: string | undefined; shape?: { shape: RoomShape; frame: SheetFrame } } {
       const a0 = intake?.autoConfig;
       const stamp = intake?.baseSheetTemplate;
       const shape = intake?.baseSheetShape && intake.baseSheetFrame ? { shape: intake.baseSheetShape, frame: intake.baseSheetFrame } : undefined;
       return { a: a0 && stamp ? { ...a0, movables: intake?.baseSheetMovables ?? null } : a0, stamp, ...(shape ? { shape } : {}) };
     }
     ```
  5. `generateAutoLayout`: opts type gains `shape?: { shape: RoomShape; frame: SheetFrame }`, and the first line becomes
     ```ts
       const f = venueFrame(a, { legacy: opts.legacy, template: opts.template, shape: opts.shape });
     ```
  6. Is `blackboxStage` declared below `venueFrame`? It's a function declaration, so it's hoisted — fine.

- [ ] **Step 5: Edit `grid-auto-fill.ts`.** `const { a, stamp } = fillGeometry(project.intake);` → `const { a, stamp, shape } = fillGeometry(project.intake);`, and the `generateAutoLayout(...)` call's options gain `shape`:

```ts
  const items = generateAutoLayout(a, cards, { electrics: C.electrics, sets: C.rigSets, kept, legacy: !stamp, template: stamp ?? null, shape });
```

- [ ] **Step 6: Run** `npx tsc --noEmit` and `npm run test:specs` → ALL PASSED. Existing `#249`/`#255` Auto-fill checks must still pass unchanged (no shape = the old branch).

- [ ] **Step 7: Commit**

```bash
git add src/lib/design/room-shape/frame.ts src/lib/design/grid-auto-layout.ts src/lib/design/grid-auto-fill.ts scripts/test-room-shape.ts
git commit -m "feat(grid): #370 Auto fill lays out on the stamped room shape

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The editor component

**Files:**
- Create: `src/components/room-shape/length-input.tsx`, `src/components/room-shape/room-shape-editor.tsx`
- Test: a render pin in `scripts/test-room-shape.ts` (server-render the editor to markup)

**Interfaces:**
- Consumes: `applyEdit`, `EditOp`, `snapCorner`, geometry, `pathD`, `labelPoint`, `fmtFeet`, `parseFeet`, `ROOM_TYPES`, `ROOM_TYPE_KEYS`, copy constants.
- Produces: `export default function LengthInput({ label, value, onCommit }: { label: string; value: number; onCommit: (ft: number, alt: boolean) => void })`; `export default function RoomShapeEditor({ shape, onChange }: { shape: RoomShape; onChange: (next: RoomShape) => void })`.

- [ ] **Step 1: Write the failing render pin**

```ts
  {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const Editor = (await import("../src/components/room-shape/room-shape-editor")).default;
    const shape = freezeFromTemplate(stateFor("school"), "proscenium@1", { by: "T", at: 1 });
    const html = renderToStaticMarkup(React.createElement(Editor, { shape, onChange: () => {} }));
    ok(html.includes('data-testid="room-shape-editor"') && (html.match(/data-k="wall"/g) || []).length > 0 && html.includes("Undo") && html.includes(SHAPE_HINT),
      "#370 editor: renders the plan with walls, the toolbar and the hint");
  }
```
(import `SHAPE_HINT` from copy.ts at the top.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `length-input.tsx`**

```tsx
"use client";

import { useState } from "react";
import { fmtFeet, parseFeet } from "@/lib/design/room-shape/units";

/** #370: a feet-and-inches box (42'-6", 42.5, 6"); Enter or blur commits, Alt+Enter passes alt, Escape reverts. */
export default function LengthInput({ label, value, onCommit }: { label: string; value: number; onCommit: (ft: number, alt: boolean) => void }) {
  const [draft, setDraft] = useState(fmtFeet(value));
  const [synced, setSynced] = useState(value);
  const [bad, setBad] = useState(false);
  if (value !== synced) {
    setSynced(value);
    setDraft(fmtFeet(value));
    setBad(false);
  }
  const commit = (alt: boolean) => {
    const ft = parseFeet(draft);
    if (ft === null) return setBad(true);
    setBad(false);
    setDraft(fmtFeet(ft));
    if (Math.abs(ft - value) > 1e-6) onCommit(ft, alt);
  };
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 }}>
      {label}
      <input
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(e.altKey); }
          if (e.key === "Escape") { setDraft(fmtFeet(value)); setBad(false); }
        }}
        style={{ width: 86, fontFamily: "var(--font-mono), IBM Plex Mono, monospace", fontSize: 12, padding: "5px 7px", border: `1px solid ${bad ? "#b4543a" : "#e4e7ec"}`, borderRadius: 6 }}
      />
    </label>
  );
}
```

- [ ] **Step 4: Write `room-shape-editor.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { ROOM_TYPES, ROOM_TYPE_KEYS, type RoomShape, type RoomTypeKey, type ShapePt, type ShapeRoom } from "@/lib/design/room-shape/types";
import { arcInfo, bounds, bulgeThrough, dist, edgeMid, outlinePoints, sampleEdge, signedArea, sub, wallBands } from "@/lib/design/room-shape/geometry";
import { applyEdit, type EditOp } from "@/lib/design/room-shape/edit";
import { snapCorner } from "@/lib/design/room-shape/snap";
import { labelPoint, pathD } from "@/lib/design/room-shape/svg";
import { SHAPE_HINT } from "@/lib/design/room-shape/copy";
import LengthInput from "./length-input";

type View = { x: number; y: number; w: number; h: number };
type Sel = null | { room: string; edge?: number; corner?: number };
type Drag =
  | { kind: "corner"; room: string; i: number; base: RoomShape }
  | { kind: "bulge"; room: string; edge: number; base: RoomShape }
  | { kind: "handle"; room: string; edge: number; which: "c1" | "c2"; base: RoomShape }
  | { kind: "pan"; from: { x: number; y: number }; view: View; moved: boolean };

const HEIGHT = 520;
const HANDLE_PX = 11;
const ACCENT = "var(--accent)";
const btn: React.CSSProperties = { border: "1px solid #e4e7ec", background: "#fff", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" };

function fitView(shape: RoomShape, aspect: number): View {
  const b = bounds(shape.rooms.flatMap((r) => outlinePoints(r, 1, 16)));
  let w = b.maxX - b.minX + 12, h = b.maxY - b.minY + 12;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  return { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w, h };
}

/**
 * #370: the room shape editor — click a room for its corners (squares) and wall midpoints (dots); drag corners
 * (snapped), drag a curved wall's midpoint to bow it, drag a free-form wall's handles; the toolbar does the rest.
 * Every change goes through applyEdit; the parent owns the shape, this keeps undo / redo.
 */
export default function RoomShapeEditor({ shape, onChange }: { shape: RoomShape; onChange: (next: RoomShape) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [boxW, setBoxW] = useState(900);
  const [view, setView] = useState<View>(() => fitView(shape, 900 / HEIGHT));
  const [sel, setSel] = useState<Sel>(null);
  const [live, setLive] = useState<RoomShape | null>(null);
  const liveRef = useRef<RoomShape | null>(null);
  const [guide, setGuide] = useState<[ShapePt, ShapePt] | null>(null);
  const [note, setNote] = useState("");
  const [undo, setUndo] = useState<RoomShape[]>([]);
  const [redo, setRedo] = useState<RoomShape[]>([]);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; view: View; mid: ShapePt } | null>(null);
  const shown = live ?? shape;
  const pxPerFt = Math.min(boxW / view.w, HEIGHT / view.h);
  const hFt = HANDLE_PX / pxPerFt;

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0) {
        setBoxW(w);
        setView((v) => ({ ...v, h: v.w * (HEIGHT / w) }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const m = el.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
      const k = Math.exp(ev.deltaY * 0.0015);
      setView((v) => {
        const w = Math.min(4000, Math.max(5, v.w * k)), s = w / v.w;
        return { x: p.x - (p.x - v.x) * s, y: p.y - (p.y - v.y) * s, w, h: v.h * s };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const flash = (m: string) => {
    setNote(m);
    window.setTimeout(() => setNote((cur) => (cur === m ? "" : cur)), 4000);
  };
  const commit = (next: RoomShape) => {
    setUndo((u) => [...u.slice(-99), shape]);
    setRedo([]);
    onChange(next);
  };
  const run = (op: EditOp) => {
    const r = applyEdit(shape, op);
    if (!r.ok) return flash(r.reason);
    commit(r.shape);
  };
  const doUndo = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    setUndo(undo.slice(0, -1));
    setRedo([...redo, shape]);
    onChange(prev);
  };
  const doRedo = () => {
    const nx = redo[redo.length - 1];
    if (!nx) return;
    setRedo(redo.slice(0, -1));
    setUndo([...undo, shape]);
    onChange(nx);
  };

  const toFt = (e: { clientX: number; clientY: number }): ShapePt => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    drag.current = d;
  };

  const onBgDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svgRef.current?.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()];
      drag.current = null;
      pinch.current = { d0: Math.hypot(p.x - q.x, p.y - q.y) || 1, view, mid: toFt({ clientX: (p.x + q.x) / 2, clientY: (p.y + q.y) / 2 }) };
      return;
    }
    drag.current = { kind: "pan", from: { x: e.clientX, y: e.clientY }, view, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()];
      const s = pinch.current.d0 / (Math.hypot(p.x - q.x, p.y - q.y) || 1);
      const v0 = pinch.current.view, m = pinch.current.mid;
      const w = Math.min(4000, Math.max(5, v0.w * s)), k = w / v0.w;
      setView({ x: m.x - (m.x - v0.x) * k, y: m.y - (m.y - v0.y) * k, w, h: v0.h * k });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const k = d.view.w / boxW;
      const dx = e.clientX - d.from.x, dy = e.clientY - d.from.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView({ ...d.view, x: d.view.x - dx * k, y: d.view.y - dy * k });
      return;
    }
    const p = toFt(e);
    const room = d.base.rooms.find((r) => r.id === d.room);
    if (!room) return;
    const n = room.pts.length, at = (k: number) => room.pts[((k % n) + n) % n];
    let op: EditOp;
    if (d.kind === "corner") {
      const s = snapCorner(p, [{ at: at(d.i - 1), wallDir: sub(at(d.i - 1), at(d.i - 2)) }, { at: at(d.i + 1), wallDir: sub(at(d.i + 1), at(d.i + 2)) }], { gridFt: e.shiftKey ? 1 : 0.5, angles: true });
      setGuide(s.guide);
      op = { op: "move", room: d.room, i: d.i, to: s.pt, glue: !e.altKey };
    } else if (d.kind === "bulge") {
      op = { op: "setBulge", room: d.room, edge: d.edge, bulge: bulgeThrough(at(d.edge), at(d.edge + 1), p) };
    } else {
      const e0 = room.edges[d.edge];
      if (e0.kind !== "curve") return;
      op = { op: "setHandles", room: d.room, edge: d.edge, c1: d.which === "c1" ? p : e0.c1, c2: d.which === "c2" ? p : e0.c2 };
    }
    const r = applyEdit(d.base, op);
    if (r.ok) {
      liveRef.current = r.shape;
      setLive(r.shape);
      setNote("");
    } else setNote(r.reason);
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    setGuide(null);
    if (d?.kind === "pan" && !d.moved) setSel(null);
    if (d && d.kind !== "pan" && liveRef.current) commit(liveRef.current);
    liveRef.current = null;
    setLive(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? doRedo() : doUndo();
    }
    if (e.key === "Escape") return setSel(null);
    if ((e.key === "Delete" || e.key === "Backspace") && sel?.corner !== undefined && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      run({ op: "deletePoint", room: sel.room, i: sel.corner });
      setSel({ room: sel.room });
    }
  };

  const ordered = useMemo(
    () => [...shown.rooms].sort((a, b) => Math.abs(signedArea(outlinePoints(b, 2, 8))) - Math.abs(signedArea(outlinePoints(a, 2, 8)))),
    [shown]
  );
  const selRoom: ShapeRoom | null = sel ? shown.rooms.find((r) => r.id === sel.room) ?? null : null;
  const nSel = selRoom?.pts.length ?? 0;
  const selEdge = selRoom && sel?.edge !== undefined && sel.edge < nSel ? sel.edge : undefined;
  const selCorner = selRoom && sel?.corner !== undefined && sel.corner < nSel ? sel.corner : undefined;

  return (
    <div data-testid="room-shape-editor" tabIndex={0} onKeyDown={onKey} style={{ outline: "none" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8, minHeight: 32 }}>
        <button type="button" style={btn} onClick={doUndo} disabled={!undo.length}>Undo</button>
        <button type="button" style={btn} onClick={doRedo} disabled={!redo.length}>Redo</button>
        <button type="button" style={btn} onClick={() => setView(fitView(shape, boxW / HEIGHT))}>Fit</button>
        <span style={{ width: 1, height: 22, background: "#e4e7ec" }} />
        {selRoom && selEdge !== undefined && (() => {
          const i = selEdge, a = selRoom.pts[i], b = selRoom.pts[(i + 1) % nSel], e = selRoom.edges[i];
          const A = e.kind === "arc" ? arcInfo(a, b, e.bulge) : null;
          return (
            <>
              <button type="button" style={btn} onClick={() => run({ op: "addPoint", room: selRoom.id, edge: i })}>Add point</button>
              {e.kind !== "arc" && <button type="button" style={btn} onClick={() => run({ op: "setBulge", room: selRoom.id, edge: i, bulge: 0.25 })}>Curve</button>}
              {e.kind !== "curve" && <button type="button" style={btn} onClick={() => run({ op: "toFreeform", room: selRoom.id, edge: i })}>Free-form</button>}
              {e.kind !== "line" && <button type="button" style={btn} onClick={() => run({ op: "straighten", room: selRoom.id, edge: i })}>Straighten</button>}
              {selRoom.kind === "room" && (
                <button type="button" style={btn} onClick={() => run({ op: "setOpen", room: selRoom.id, edge: i, open: !e.open })}>{e.open ? "Opening → Wall" : "Wall → Opening"}</button>
              )}
              {e.kind === "line" && <LengthInput label="Length" value={dist(a, b)} onCommit={(ft, alt) => run({ op: "setLength", room: selRoom.id, edge: i, ft, from: alt ? "near" : "far" })} />}
              {A && <LengthInput label="Radius" value={A.r} onCommit={(ft) => run({ op: "setRadius", room: selRoom.id, edge: i, ft })} />}
              {A && <LengthInput label="Arc length" value={A.length} onCommit={(ft) => run({ op: "setArcLength", room: selRoom.id, edge: i, ft })} />}
            </>
          );
        })()}
        {selRoom && selCorner !== undefined && (
          <button type="button" style={btn} onClick={() => { run({ op: "deletePoint", room: selRoom.id, i: selCorner }); setSel({ room: selRoom.id }); }}>Delete point</button>
        )}
        {selRoom && selEdge === undefined && selCorner === undefined && (
          <>
            <input
              key={selRoom.id}
              aria-label="Room name"
              defaultValue={selRoom.name}
              onBlur={(e) => e.target.value !== selRoom.name && run({ op: "rename", room: selRoom.id, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #e4e7ec", borderRadius: 6, width: 170 }}
            />
            <select aria-label="Room type" value={selRoom.type} onChange={(e) => run({ op: "retype", room: selRoom.id, type: e.target.value as RoomTypeKey })} style={{ fontSize: 12, padding: "5px 6px", border: "1px solid #e4e7ec", borderRadius: 6 }}>
              {ROOM_TYPE_KEYS.map((k) => <option key={k} value={k}>{ROOM_TYPES[k].label}</option>)}
            </select>
            <span style={{ fontSize: 12, color: "#737985" }}>{Math.round(Math.abs(signedArea(outlinePoints(selRoom))))} sq ft · {selRoom.kind === "zone" ? "zone" : "room"}</span>
            <button type="button" style={btn} onClick={() => { run({ op: "deleteRoom", room: selRoom.id }); setSel(null); }}>Delete room</button>
          </>
        )}
      </div>
      <svg
        ref={svgRef}
        width="100%"
        height={HEIGHT}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ display: "block", background: "#fafbfc", border: "1px solid #ececf0", borderRadius: 10, touchAction: "none", userSelect: "none" }}
      >
        {ordered.map((r) => (
          <path
            key={`f-${r.id}`}
            data-k={r.kind === "zone" ? "zone" : "room"}
            d={pathD(outlinePoints(r))}
            fill={r.kind === "zone" ? "rgba(107,114,128,0.06)" : "#f1f2f5"}
            stroke={r.kind === "zone" ? "#6b7280" : sel?.room === r.id ? ACCENT : "none"}
            strokeWidth={r.kind === "zone" ? 0.15 : 0.12}
            strokeDasharray={r.kind === "zone" ? "1 0.6" : undefined}
            onPointerDown={(e) => { e.stopPropagation(); setSel({ room: r.id }); }}
            style={{ cursor: "pointer" }}
          />
        ))}
        {ordered.flatMap((r) => wallBands(r).map((band, k) => <path key={`w-${r.id}-${k}`} data-k="wall" d={pathD(band)} fill="#3a3f4a" pointerEvents="none" />))}
        {ordered.map((r) => {
          const p = labelPoint(r);
          return <text key={`t-${r.id}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={1.1} fontWeight={600} fill="#3a3f4a" fontFamily="IBM Plex Mono, monospace" pointerEvents="none">{r.name}</text>;
        })}
        {selRoom && selEdge !== undefined && (() => {
          const a = selRoom.pts[selEdge], b = selRoom.pts[(selEdge + 1) % nSel], e = selRoom.edges[selEdge];
          const pts = [...sampleEdge(a, b, e, 0.25, 64), b];
          return <path d={`M${pts.map((q) => `${q.x} ${q.y}`).join("L")}`} fill="none" stroke={ACCENT} strokeWidth={hFt * 0.35} pointerEvents="none" />;
        })()}
        {selRoom && selEdge !== undefined && selRoom.edges[selEdge].kind === "curve" && (() => {
          const e = selRoom.edges[selEdge] as { c1: ShapePt; c2: ShapePt };
          const a = selRoom.pts[selEdge], b = selRoom.pts[(selEdge + 1) % nSel];
          return (
            <>
              <line x1={a.x} y1={a.y} x2={e.c1.x} y2={e.c1.y} stroke={ACCENT} strokeWidth={hFt * 0.12} />
              <line x1={b.x} y1={b.y} x2={e.c2.x} y2={e.c2.y} stroke={ACCENT} strokeWidth={hFt * 0.12} />
              {(["c1", "c2"] as const).map((w) => (
                <circle key={w} cx={e[w].x} cy={e[w].y} r={hFt * 0.45} fill={ACCENT} onPointerDown={(ev) => begin(ev, { kind: "handle", room: selRoom.id, edge: selEdge, which: w, base: shape })} style={{ cursor: "grab" }} />
              ))}
            </>
          );
        })()}
        {selRoom && selRoom.pts.map((p, i) => {
          const m = edgeMid(p, selRoom.pts[(i + 1) % nSel], selRoom.edges[i]);
          return (
            <circle
              key={`m-${i}`}
              data-k="mid"
              cx={m.x}
              cy={m.y}
              r={hFt * 0.42}
              fill={selEdge === i ? ACCENT : "#fff"}
              stroke={ACCENT}
              strokeWidth={hFt * 0.14}
              onPointerDown={(ev) => {
                setSel({ room: selRoom.id, edge: i });
                if (selRoom.edges[i].kind === "arc") begin(ev, { kind: "bulge", room: selRoom.id, edge: i, base: shape });
                else ev.stopPropagation();
              }}
              style={{ cursor: "pointer" }}
            />
          );
        })}
        {selRoom && selRoom.pts.map((p, i) => (
          <rect
            key={`c-${i}`}
            data-k="corner"
            x={p.x - hFt / 2}
            y={p.y - hFt / 2}
            width={hFt}
            height={hFt}
            fill={selCorner === i ? ACCENT : "#fff"}
            stroke={ACCENT}
            strokeWidth={hFt * 0.14}
            onPointerDown={(ev) => { setSel({ room: selRoom.id, corner: i }); begin(ev, { kind: "corner", room: selRoom.id, i, base: shape }); }}
            style={{ cursor: "move" }}
          />
        ))}
        {guide && <line x1={guide[0].x} y1={guide[0].y} x2={guide[1].x} y2={guide[1].y} stroke={ACCENT} strokeWidth={hFt * 0.1} strokeDasharray={`${hFt * 0.5} ${hFt * 0.4}`} pointerEvents="none" />}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6, fontSize: 11.5, color: "#9aa0ab" }}>
        <span>{SHAPE_HINT}</span>
        {note && <span role="status" style={{ color: "#b4543a" }}>{note}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run** `npx tsc --noEmit`, `npx eslint src/components/room-shape`, and `npx tsx scripts/test-room-shape.ts` → 0 errors, PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/room-shape scripts/test-room-shape.ts
git commit -m "feat(grid): #370 room shape editor component

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The intake's "Shape the room" step

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/grid-intake.tsx`
- Test: source pins in `scripts/test-room-shape.ts`; a real browser pass

**Interfaces:**
- Consumes: `RoomShapeEditor`, `freezeFromTemplate`, `RoomShape`, copy constants, existing `tplId`, `templateEntry`, `save`, `preview`, `setStep`.
- Produces: the intake sends `roomShape` to `saveGridIntakeAction`.

- [ ] **Step 1: Write the failing source pins**

```ts
  {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/design/grid/[id]/grid-intake.tsx", "utf8");
    ok(src.includes('useState<"setup" | "shape" | "equipment">') && src.includes("<RoomShapeEditor") && src.includes("roomShape: shape"), "#370 pin: the intake has a shape step that sends the shape");
    ok(src.includes("disabled={!!shape}") && src.includes("SHAPE_FROZEN_NOTE") && src.includes("SHAPE_RESET_CONFIRM") && src.includes("SHAPE_STALE"), "#370 pin: a shaped intake locks its dimensions, offers Reset and blocks a stale shape");
  }
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Edit `grid-intake.tsx`.**
  1. Imports: `import { useMemo, useRef, useState, useTransition } from "react";` and add
     ```tsx
     import RoomShapeEditor from "@/components/room-shape/room-shape-editor";
     import { freezeFromTemplate } from "@/lib/design/room-shape/freeze";
     import type { RoomShape } from "@/lib/design/room-shape/types";
     import { SHAPE_FROZEN_NOTE, SHAPE_RESET_CONFIRM, SHAPE_STALE, SHAPE_STEP_NOTE, SHAPE_STEP_TITLE } from "@/lib/design/room-shape/copy";
     ```
  2. Add a fieldset style constant beside `input`:
     ```tsx
     const fieldset = (locked: boolean) => ({ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: locked ? 0.55 : 1 }) as const;
     ```
  3. Step state: `useState<"setup" | "equipment">("setup")` → `useState<"setup" | "shape" | "equipment">("setup")`.
  4. After `const tplId = effectiveTemplateFor(…);` add:
     ```tsx
       // #370: a templated plan can be shaped by hand before equipment; the shape freezes the dimensions.
       const canShape = !!tplId && !!templateEntry(tplId)?.family;
       const [shape, setShape] = useState<RoomShape | null>(null);
       const [shapeKey, setShapeKey] = useState(0);
       const shapeStale = !!shape && shape.fromTemplate !== tplId;
       const shapePreview = useMemo(() => (step === "shape" && canShape && tplId && !shape ? freezeFromTemplate(a, tplId, { by: "", at: 0 }) : null), [step, canShape, tplId, shape, a]);
       const resetShape = () => {
         if (!window.confirm(SHAPE_RESET_CONFIRM)) return;
         setShape(null);
         setShapeKey((k) => k + 1);
       };
     ```
     (Hooks must sit before any early return — this component has none above here; keep them in this block.)
  5. Split `next`: rename its tail into `afterShape` and route through the shape step:
     ```tsx
       const afterShape = () => {
         setError("");
         if (shapeStale) return setError(SHAPE_STALE);
         if (start === "blank") return save();
         if (!chosen.length) return setError("Pick at least one scope for Auto to fill.");
         const est: AutoEstimate = {
           tierByScope: Object.fromEntries(chosen.map((k) => [k, estimate.tierByScope[k] ?? "better"])),
           overrides: estimate.overrides,
         };
         setEstimate(est);
         preview.run(scopeInputs, est);
         setStep("equipment");
       };
       const next = () => {
         setError("");
         if (!customerReadyOf(pick))
           return setError(pick.customerMode === "new" ? "Enter a name for the new customer." : "Pick a customer, or add a new one.");
         if (!start) return setError("Choose Auto or Blank.");
         if (!cover.venueName.trim() && !cover.locationName.trim() && !venueChosen) return setError("Add a venue or location to continue.");
         if (start === "auto" && !chosen.length) return setError("Pick at least one scope for Auto to fill.");
         if (canShape) return setStep("shape");
         afterShape();
       };
     ```
     (This replaces the whole existing `next` function.)
  6. `save()` payload: after `planCandidateId: candidateId,` add `...(shape ? { roomShape: shape } : {}),`.
  7. Subtitle: change the `subtitle` expression to
     ```tsx
       const subtitle =
         step === "setup"
           ? "Who it's for, then start from the equations (Auto) or a blank plan — the venue drops down once you choose. Either way you end up on the canvas, free to move, edit and delete anything."
           : step === "shape"
             ? SHAPE_STEP_NOTE
             : "Pick Good / Better / Best per scope. Swap any part for a catalog part or an assembly, and adjust quantities.";
     ```
  8. Step counter in the eyebrow: replace `{start === "auto" ? \` · Step ${step === "setup" ? 1 : 2} of 2\` : ""}` with
     ```tsx
     {(() => {
       const total = 1 + (canShape ? 1 : 0) + (start === "auto" ? 1 : 0);
       const at = step === "setup" ? 1 : step === "shape" ? 2 : total;
       return start && total > 1 ? ` · Step ${at} of ${total}` : "";
     })()}
     ```
  9. Locked fields: inside `{start && (<div style={section}> …`, put the banner first and wrap the two geometry blocks:
     ```tsx
       {shape && (
         <div data-testid="shape-frozen-banner" style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 12px", borderRadius: 9, background: "#f4f5f7", fontSize: 12.5, marginBottom: 14 }}>
           <span style={{ flex: 1 }}>{shapeStale ? SHAPE_STALE : SHAPE_FROZEN_NOTE}</span>
           <button type="button" onClick={resetShape} style={ghost}>Reset to template</button>
         </div>
       )}
     ```
     Wrap the "Venue type" label + its grid and the whole "Size of venue" section in `<fieldset disabled={!!shape} style={fieldset(!!shape)}> … </fieldset>` (the "Scopes" section stays outside it). Wrap the right column's `<div style={{ display: "grid", gap: 13 }}> … </div>` (Stage dimensions, Background, house fields, MovableFields) in `<fieldset disabled={!!shape} style={fieldset(!!shape)}> … </fieldset>`.
  10. The shape step itself — add after the `{step === "setup" && (…)}` block and before `{step === "equipment" && (…)}`:
     ```tsx
          {step === "shape" && (
            <>
              <div style={{ ...label, marginBottom: 10 }}>{SHAPE_STEP_TITLE}</div>
              {shapeStale && <div style={{ color: "#b4543a", fontSize: 12, marginBottom: 10 }}>{SHAPE_STALE}</div>}
              {(shape ?? shapePreview) && <RoomShapeEditor key={shapeKey} shape={(shape ?? shapePreview) as RoomShape} onChange={setShape} />}
              {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                <button type="button" onClick={() => { setError(""); setStep("setup"); }} disabled={busy} style={ghost}>← Back</button>
                {shape && <button type="button" onClick={resetShape} disabled={busy} style={ghost}>Reset to template</button>}
                <button type="button" onClick={afterShape} disabled={busy || shapeStale} style={{ ...primary(busy), flex: 1 }}>
                  {start === "auto" ? "Next: equipment →" : busy ? "Setting up your plan…" : "Continue to The Grid →"}
                </button>
              </div>
            </>
          )}
     ```
  11. Equipment "← Back": `onClick={() => { setError(""); setStep("setup"); }}` → `onClick={() => { setError(""); setStep(canShape ? "shape" : "setup"); }}`.
  12. The setup button label: when `canShape`, the setup step's primary button reads "Next: shape the room →". Change its label expression to
     ```tsx
     {canShape ? "Next: shape the room →" : start === "auto" ? "Next: equipment →" : busy ? "Setting up your plan…" : "Continue to The Grid →"}
     ```

- [ ] **Step 4: Run** `npx tsc --noEmit`, `npx eslint "src/app/(app)/design/grid/[id]/grid-intake.tsx" src/components/room-shape src/lib/design/room-shape`, `npm run test:specs` → 0 / 0 / ALL PASSED.

- [ ] **Step 5: Browser pass** (scratch datadir — never the real `.data/pglite`; see memory "Exercising POST routes safely" and "Worktree dev-server browser traps"). Check `ps aux | grep -E "next dev|tsx" | grep -v grep` first; stop nothing that isn't yours — pick a free port.

```bash
export PATH="$HOME/.local/node/bin:$PATH"
SCR=$(mktemp -d) && echo $SCR
PGLITE_PATH="$SCR" AUTH_DEV_LOGIN=true npx next dev -p 3370
```
(run it in the background). Then in the browser pane: sign in through the dev picker at `http://localhost:3370/login`, create a new Grid design (Design → New system design), pick a customer, choose **Blank**, Auditorium. Verify, with screenshots:
  1. "Next: shape the room →" opens the editor with the redrawn plan: the stage opening and lip have no wall, Catwalk / Center Aisle dashed.
  2. Click the House → corners and midpoints appear. Drag a side-wall corner with Shift → it snaps to whole feet along the wall.
  3. Click a wall's midpoint → **Curve** → drag the midpoint → it bows; type **Radius** `60'` → the dimension updates.
  4. **Free-form** shows two handles that drag. **Wall → Opening** removes that wall band.
  5. Make a move that crosses the outline → refused, the note shows.
  6. **← Back** → the dimension fields are disabled with the "Shape edited" banner; **Reset to template** asks, then clears it.
  7. Shape again, **Continue to The Grid →** → the editor opens on a base sheet that matches the shape, Spaces panel lists one Space per room.
  8. Undo / Redo (⌘Z / ⇧⌘Z) and pinch / wheel zoom work.
Read the console (`read_console_messages`, errors only) — none. Then stop the dev server and `rm -rf "$SCR"`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/grid-intake.tsx" scripts/test-room-shape.ts
git commit -m "feat(grid): #370 Shape the room step in the Grid intake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs + the full verification gate

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

- [ ] **Step 1: DECISIONS.md** — append (numbers follow the last entry on this branch; renumber at merge if the curved-track branch #369 lands first):

```markdown
## D1304. The room shape is an intake document frozen from the template (#370, 2026-10-25)

Jeff (brainstorm Oct 25): hand edits freeze the layout. `GridProject.intake.roomShape` holds rooms and zones in feet (origin = the template's centreline at its origin line, y down), each edge a line, a true arc (bulge) or a Bezier. The first edit in the intake's Shape the room step freezes the stretched template (`freezeFromTemplate`); the dimension fields then lock; Reset to template deletes the shape. The base sheet stamps the shape it was drawn from (`baseSheetShape`) and its frame (`baseSheetFrame`); Auto fill reads the stamps, never the live shape. Spec `docs/superpowers/specs/2026-10-25-grid-room-shape-editor-design.md`; slice 1 plan `docs/superpowers/plans/2026-10-25-grid-room-shape-slice1.md`.

## D1305. Walls and openings come from the drawing's own lines (#370, 2026-10-25)

Plan-time finding (spec Amendment A): drawing a wall on every room edge closes the proscenium opening and the stage lip. An edge is walled where the template shows a double line (a line on the room's face and a parallel one 4"–9" out), sampled every 3", runs under 18" smoothed away, and split at every change; the rest carry `open: true`. The arena drawing is single lines, so `FREEZE_HINTS` gives it the single-line rule and makes its floor, court and stage zones. The editor's Wall → Opening toggles it.

## D1306. Zones and roles (#370, 2026-10-25)

A frozen room with under 25 % of its perimeter walled is a zone (the Catwalk and Center Aisle lie inside the House). `kind` is per room (the type gives a new room's default). Roles sit on the room (`roles: RoomRole[]`), one room may hold several (the Blackbox is stage and house), each role on at most one room, and a shape without a Stage and a House is refused. A Conference adds a Platform zone holding the stage.

## D1307. The shape sheet (#370, 2026-10-25)

`roomShapeSvg` draws rooms, 6" walls on walled edges, a fine dashed line on openings, dashed zones, names and a dimension on each walled edge of 4' or more — no line-set or electric symbols (those were part of the template's detail linework). Calibration = the frame's width in feet. One Space per room, tagged `fromRoom`.

## D1308. Auto fill on a shape (#370, 2026-10-25)

`venueFrame` gains a shape branch: stage / house / booth / catwalk = the boxes of the rooms holding those roles (no Booth: an 8' × 6' box 6' inside the house's far end); a proscenium's stage edge = the House's open curved run facing the stage; blackbox, church and arena keep their family rules (inset stage, side lights inside, turned stage + lot box).

## D1309. Corner glue is 0.5" in slice 1 (#370, 2026-10-25)

Dragging a corner moves other rooms' corners within 0.5" of it. Frozen rooms sit a wall's thickness apart, so a room behind a wall does not follow it yet; slice 2 (drop + snap flush) revisits this.
```

- [ ] **Step 2: PUNCHLIST.md** — append:

```markdown
## 370. Grid room shape editor — slice 1 DONE 2026-10-25 on `feat/370-room-shape` (D1304–D1309)

Jeff, Oct 25: reshape the Grid plan in the intake — points on every corner and halfway along every wall, curve a wall or add points, then add rooms. Spec `docs/superpowers/specs/2026-10-25-grid-room-shape-editor-design.md` (Amendment A); plan `docs/superpowers/plans/2026-10-25-grid-room-shape-slice1.md`.

**Built (slice 1):** the Shape the room step; freeze from all seven templates with walls / openings read from the drawing; corner drag with 6" / 1' and 45° snapping and glue; Add point, Curve (radius / arc length), Free-form, Straighten, Wall ↔ Opening, typed lengths; rename / retype / delete; undo / redo; locked dimensions + Reset; base sheet, Spaces, calibration and Auto fill drawn from the shape. Renders for review: `docs/room-shape/renders/`.

**Gates:** (fill in real numbers) tsc · test:specs · test:smoke · eslint · next build · browser pass.

**Open for Jeff:** review the renders (openings, zones); the shape sheet drops the template's line-set / electric symbols — OK?; the room sizes in spec §3; whether other equipment should follow the Electrical room / mix (slice 2).

**Next:** slice 2 (+ Add room, drop + snap flush, mix / electrical roles), slice 3 (reopen after Create, DXF).

**Rollback:** safe — no migration; the new intake fields are ignored by an older build (a shaped design's sheet is an ordinary SVG sheet).
```

- [ ] **Step 3: AGENTS.md** — append a phase entry after item 68:

```markdown
69. 🚧 **Grid room shape editor — slice 1** (#370, D1304–D1309) — the Grid intake gains a Shape the room step: the stretched template freezes into a `RoomShape` (`src/lib/design/room-shape/`: rooms and zones in feet, line / arc / Bezier edges, walls vs. openings read from the drawing's double lines, roles on rooms) edited in `src/components/room-shape/room-shape-editor.tsx` (corner drag + snap + glue, Add point, Curve, Free-form, Wall ↔ Opening, typed lengths / radius / arc length, undo / redo); a shaped intake locks its dimensions until Reset to template. `saveGridIntakeAction` sanitizes it (`sanitizeRoomShape`), `generateBaseSheet` draws the base sheet, Spaces (`fromRoom`) and calibration from it and stamps `baseSheetShape` / `baseSheetFrame`, and Auto fill lays out on the stamp (`venueFrame` shape branch). No migration. Remaining: slices 2 (rooms + zones, roles) and 3 (reopen after Create, DXF); Jeff reviews `docs/room-shape/renders/`.
```

- [ ] **Step 4: Full gate** — run each and record the real numbers in PUNCHLIST's Gates line:

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npm run test:smoke 2>&1 | tail -5
npx eslint src/lib/design/room-shape src/components/room-shape "src/app/(app)/design/grid/[id]/grid-intake.tsx" "src/app/(app)/design/grid/[id]/actions.ts" src/lib/stores/grid-projects.ts src/lib/design/grid-auto-layout.ts src/lib/design/grid-auto-fill.ts
npx next build 2>&1 | tail -5
```
Expected: 0 errors; ALL PASSED (PASS count up by this item's checks); smoke ALL PASSED (authenticated); eslint 0 errors; build succeeds. Any failure: fix, re-run the whole gate.

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs: #370 room shape editor slice 1 — decisions, punch, phase note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Do not push or merge — the user decides that (finishing-a-development-branch).
