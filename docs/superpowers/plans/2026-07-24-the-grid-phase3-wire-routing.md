# The Grid Phase 3 — Wire Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 of The Grid: draw wire routes on plan sheets, measure them with the page's stored scale calibration, and roll wire lengths into the BOM and the draft quote as per-foot catalog lines.

**Architecture:** A route is a polyline (normalized points) on one sheet+page carrying a per-length catalog part and the page's aspect ratio (stored at draw time — a property of the page, so length is recomputable anywhere: `polylineLength(points, aspect) × cal.scale`). Routes on uncalibrated pages are refused at draw time — an unmeasurable wire is a lie in a BOM. Wire math lives in the same dependency-free libs (client sidebar = server quote, always equal).

**Tech Stack:** existing editor + `lib/annotations` calibrations; pure TS libs; doc-store.

## Global Constraints

- Same as D108/D109: normalized geometry, inline entry only, epoch-ms, server-action writes, no new collections (`routes?: GridRoute[]` on the project doc, pre-existing docs read `|| []`).
- **Routing requires calibration** on that sheet+page (refused otherwise, clear message).
- Wire parts = catalog parts with a per-length unit (`ft`, `lin ft`, `linear ft`, `'/ft'` variants) — Peak-native multi-brand rule (DEC-PSD-1): no special wire table, the catalog is the library.
- Routes ride in revisions (snapshot + restore) like placements/spaces.
- Branch `quartzite-the-grid`; commit per task; decision log entry D110.

---

### Task 1: Geometry + wire BOM math (TDD)

**Files:** `src/lib/design/grid-geometry.ts`, `src/lib/design/grid-bom.ts`, `scripts/test-review-and-spec.ts`

**Produces:**
```ts
// grid-geometry
export function polylineLength(points: Point[], aspect: number): number;       // Σ pageDistance(segment) — in page-widths
export function distToPolyline(p: Point, points: Point[], aspect: number): number; // min point-to-segment distance (aspect-corrected) — route hit-testing
// grid-bom
export function isPerLengthUnit(unit: string): boolean;                        // ft / lin ft / linear ft / '/ft' (case/space-insensitive)
export type RouteLite = { id: string; sheetId: string; page: number; points: Point[]; aspect: number; partId: string };
export function routeLengthFt(route: RouteLite, cals: Calibration[]): number | null;  // null when the page has no calibration; unit follows the calibration's unit — v1 assumes ft-calibrated pages (the app default)
export function routeLines(routes: RouteLite[], parts: PartLite[], cals: Calibration[]): { lines: BomLine[]; value: number; cost: number; unmeasured: number };
// qty per part = ceil(Σ measured ft); ext = qty × list; cost = qty × part.cost; routes with null length → unmeasured count (excluded from lines)
```

**Steps:**
- [ ] Tests: 2-segment polyline length with aspect ≠ 1; distToPolyline on/near/far; routeLengthFt with a scale-10 calibration; null when uncalibrated; routeLines groups two routes of one part with ceil; unmeasured counted. Run → FAIL.
- [ ] Implement both libs. Run → ALL PASSED. Commit.

### Task 2: Store + actions

**Files:** `src/lib/stores/grid-projects.ts`, `src/app/(app)/design/grid/[id]/actions.ts`

**Produces:**
```ts
export type GridRoute = { id: string; sheetId: string; page: number; partId: string; points: Point[]; aspect: number; by: string; at: number };  // id rid("wr-")
// GridProject.routes?: GridRoute[]; snapshotOf/restore include routes (old revisions → []).
addRoute(projectId, {...}): Promise<GridProject | null>;
removeRoute(projectId, routeId): Promise<GridProject | null>;
// actions: addRouteAction validates ≥2 points, finite aspect > 0, part exists AND isPerLengthUnit(part.unit), page calibrated; removeRouteAction.
// createDraftQuoteAction: lines = device lines + routeLines(...).lines; value/margin include wire value+cost; spec gains routes' lines; refuses nothing new (unmeasured routes simply excluded — but with calibration enforced at draw time, unmeasured only appears if a calibration was cleared afterwards; surface count in the BOM panel).
```

**Steps:**
- [ ] Implement store + actions + quote integration; tsc clean. Commit.

### Task 3: Editor — Wires panel + drawing + rendering

**Files:** `src/app/(app)/design/grid/[id]/editor.tsx`, create `wires-panel.tsx`, `page.tsx` (pass routes)

**Behavior:**
- **Wires panel**: picker listing per-length catalog parts (or "none in the catalog — add one under Catalog with unit 'ft'"); "Draw wire" arms wiring mode (mutually exclusive with paint/calibrate/space modes; requires calibration — button disabled with hint otherwise); waypoint clicks build `wireDraft`; **click the last waypoint again to finish** (≥2 points) → `addRouteAction` immediately (no popover; part was pre-picked); Escape-equivalent = panel button toggles cancel.
- Route list on the active page: part sku · measured length (`formatMeasure`) · select/delete (two-step).
- **Canvas**: routes as polylines in the part's category color (distinct dash), waypoint dots, length chip at the midpoint segment; draft polyline while drawing; click near a route (distToPolyline < 0.012) selects when nothing else hit (markers → spaces → routes precedence... routes BEFORE spaces: a wire is a finer target than a room).
- BOM panel: wire lines appended under a thin divider, included in the total; "N unmeasured wires" warning line when > 0.

**Steps:**
- [ ] Implement; tsc + scoped eslint clean. Commit.

### Task 4: Verify live + docs + capture

**Steps:**
- [ ] Add 2 wire parts through the Catalog screen UI (e.g. WIRE-12/3 SO cable $2.10/ft, DMX-CAB $0.85/ft).
- [ ] On GRD-5002 (calibrated 60' page): draw an SO-cable route Stage→House with a bend, a DMX run; verify measured lengths look proportional (the 60' dimension line spans ~0.857 page width → sanity-check the chip); BOM gains wire lines; quote update includes them; revision snapshot carries routes (restore round-trip).
- [ ] `npm run test:specs` + `npm run build` green; screenshot proof.
- [ ] DECISIONS.md **D110** (aspect-stored-on-route rationale, calibration-required rule, per-length unit predicate, ceil-per-part aggregation); AGENTS.md item 10; memory capture.
