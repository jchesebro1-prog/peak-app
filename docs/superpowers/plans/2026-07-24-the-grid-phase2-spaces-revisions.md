# The Grid Phase 2 — Spaces + Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 of The Grid (roadmap in memory `projects/peak-system-designer.md`): draw **Spaces** (room polygons) on plan sheets with per-space BOM rollups, and add append-only **project revisions** with non-destructive restore.

**Architecture:** Spaces are polygons stored on the project doc (normalized 0..1 points, per sheet+page like calibrations). Placement→space assignment is **computed, never stored** — point-in-polygon at render time, smallest-area-wins for nested rooms — so redrawing a space instantly reassigns devices. Revisions copy the QuoteRevision idiom exactly (append-only, snapshot-first restore, auto-cut on quote mint). All geometry/rollup math is dependency-free client-safe libs, tested in test:specs.

**Tech Stack:** existing editor (pdf.js + SVG overlay), doc-store patchDoc, pure TS libs.

## Global Constraints

- Same as Phase 1 (D108): normalized 0..1 geometry, no window.prompt (inline entry only), epoch-ms, server-action-only writes, `revalidatePath` after mutations, port-faithful style.
- Spaces/revisions live INSIDE the `grid_projects` doc — no new collections, no migration.
- Existing docs lack the new fields: every reader defaults `p.spaces || []`, `p.revisions || []`.
- Branch: continue on `quartzite-the-grid` (worktree `/Users/sm/Downloads/peak-app-grid`); commit per task; DECISIONS.md entry D109.

---

### Task 1: Geometry lib (TDD)

**Files:**
- Create: `src/lib/design/grid-geometry.ts`
- Modify: `scripts/test-review-and-spec.ts` (append tests before the final PASS/FAIL block)

**Produces:**
```ts
export type SpaceLite = { id: string; sheetId: string; page: number; points: Point[] };  // Point from lib/annotations
export function pointInPolygon(p: Point, poly: Point[]): boolean;         // ray casting, ≥3 vertices else false
export function polygonArea(poly: Point[]): number;                        // shoelace, absolute value
export function polygonCentroid(poly: Point[]): Point;                     // label anchor; falls back to vertex mean for degenerate polys
export function spaceOf(pl: { sheetId: string; page: number; x: number; y: number }, spaces: SpaceLite[]): SpaceLite | null;
// candidates = same sheet+page AND pointInPolygon; SMALLEST polygonArea wins (booth inside a hall belongs to the booth)
```

**Steps:**
- [ ] Append tests: point in/out of a square; concave L-shape (point in the notch is OUT); nested squares → smallest wins; wrong sheet/page → null; <3 points → false; area of unit square ≈ 1; centroid of unit square ≈ (0.5, 0.5).
- [ ] Run `npm run test:specs` → FAIL (module missing).
- [ ] Implement; run → ALL PASSED.
- [ ] Commit: `The Grid: geometry lib — point-in-polygon, area, centroid, spaceOf (D109)`

### Task 2: Per-space BOM rollups (TDD)

**Files:**
- Modify: `src/lib/design/grid-bom.ts`, `scripts/test-review-and-spec.ts`

**Produces:**
```ts
export type SpaceRollup = { spaceId: string | null; name: string; count: number; value: number };
export function bomBySpace(
  placements: Array<{ sheetId: string; page: number; x: number; y: number; partId: string }>,
  parts: PartLite[],
  spaces: Array<SpaceLite & { name: string }>
): SpaceRollup[];
// one rollup per space that has devices (project order) + trailing { spaceId: null, name: "Unassigned" } when any
// placement falls in no space; value uses the same list-price basis as bomLines; unknown parts contribute 0.
```

**Steps:**
- [ ] Append tests: two spaces + stray placement → three rollups with correct counts/values; empty spaces list → single Unassigned rollup; space with no devices omitted.
- [ ] Run → FAIL; implement (uses `spaceOf`); run → ALL PASSED.
- [ ] Commit: `The Grid: per-space BOM rollups (D109)`

### Task 3: Store — spaces + revisions

**Files:**
- Modify: `src/lib/stores/grid-projects.ts`

**Produces:**
```ts
export type GridSpace = { id: string; sheetId: string; page: number; name: string; color: string; points: Point[]; by: string; at: number };
export type GridRevision = {
  rev: number; at: number; by: string; reason: "manual" | "quote" | "restore"; note: string;
  name: string; sheetIds: string[]; placements: GridPlacement[]; calibrations: Calibration[]; spaces: GridSpace[];
};
// GridProject gains: spaces: GridSpace[]; revisions?: GridRevision[];  (createProject seeds spaces: [])
export const SPACE_COLORS: string[];  // 6 hues, distinct from MARK_COLORS usage
addSpace(projectId, { sheetId, page, name, points, by }): Promise<GridProject | null>;   // id rid("sp-"), color by index
renameSpace(projectId, spaceId, name): Promise<GridProject | null>;
removeSpace(projectId, spaceId): Promise<GridProject | null>;
addRevision(projectId, { by, reason, note }): Promise<GridRevision | null>;              // snapshot current, rev = len+1
restoreRevision(projectId, rev, by): Promise<{ ok: false; reason: "not-found" | "no-such-rev" } | { ok: true }>;
// restore is NON-DESTRUCTIVE (quotes idiom): push snapshot "Auto-saved before recalling v<rev>", apply target's
// name/placements/calibrations/spaces (sheetIds NOT applied — sheets are never deleted by restore), push "Recalled v<rev>".
```

**Steps:**
- [ ] Implement types + functions (snapshot helper is pure; both revision writers go through it).
- [ ] `npx tsc --noEmit` — only the pre-existing letterhead errors.
- [ ] Commit: `The Grid: spaces + revisions in the project store (D109)`

### Task 4: Actions + editor — draw, select, rename, delete spaces; rollup panel

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` — add `addSpaceAction(projectId, {sheetId,page,name,points})` (validate ≥3 points; name required, trimmed), `renameSpaceAction`, `removeSpaceAction`; all Result-typed + revalidate.
- Create: `src/app/(app)/design/grid/[id]/spaces-panel.tsx` — sidebar panel client component (props: spaces-with-rollups, selected id, callbacks; owns rename entry + two-step delete).
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` — space tool, polygon draft, SVG rendering, selection, panel wiring.
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` — pass `spaces` through in the project payload.

**Editor behavior:**
- New mode: **Draw space** button in the Spaces panel arms `spacing`; disarms painting/calibrating (all three are mutually exclusive).
- Click adds a vertex to `spaceDraft: Point[]`; the draft renders as an open polyline + vertex dots; **click within 0.015 of the first vertex OR double-click** closes the polygon (needs ≥3 points), opening the inline name entry at the last vertex (same popover pattern as calibration; Escape cancels, Enter confirms → `addSpaceAction`).
- Spaces render UNDER markers: `<polygon>` fill space.color opacity 0.14, stroke 1.5 opacity 0.5; name label chip at `polygonCentroid`.
- Selection: click inside a space (when not painting/calibrating/drawing, and no marker hit) selects the smallest containing space → Spaces panel highlights it (rename + delete live there); clicking empty canvas clears.
- Spaces panel lists every space on the ACTIVE sheet+page with its rollup (count · value) from `bomBySpace`, plus a whole-project "By space" summary (all sheets) and Unassigned line. Marker hit-test precedes space hit-test.

**Steps:**
- [ ] Actions; panel component; editor wiring per above.
- [ ] `npx tsc --noEmit` clean (modulo letterhead); dev-server smoke: draw two spaces over painted devices, rollups show correct counts/values; rename + delete work.
- [ ] Commit: `The Grid: Spaces — draw, name, per-space BOM rollups (D109)`

### Task 5: Revisions — panel, auto-cut on quote, restore

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` — `saveRevisionAction(projectId, note)`, `restoreRevisionAction(projectId, rev)`; `createDraftQuoteAction` cuts a `reason: "quote"` revision (note: "Quoted as <Q-id>") after a successful mint/update.
- Create: `src/app/(app)/design/grid/[id]/revisions-panel.tsx` — list newest-first (v<rev> · by · timeAgo · note/reason badge), inline note entry + "Save revision", per-row two-step "Restore".
- Modify: `editor.tsx` (mount panel), `page.tsx` (pass `revisions` through).

**Steps:**
- [ ] Implement; smoke: save a revision, move/delete devices, restore → placements return AND a "Recalled v1" revision appears on top of an auto-save entry; create quote → "quote" revision appears.
- [ ] `npm run test:specs` ALL PASSED.
- [ ] Commit: `The Grid: project revisions — save, auto-cut on quote, non-destructive restore (D109)`

### Task 6: Verify, document, capture

**Steps:**
- [ ] Browser end-to-end on GRD-5002: draw "Stage" + "House" spaces around the existing markers → rollups 3×EQP-LIFT / 2×LIG-SUP; save revision; mutate; restore; update draft quote Q-2043 (auto-revision); screenshot proof.
- [ ] `npm run test:specs` + `npm run build` green.
- [ ] DECISIONS.md **D109** (computed-not-stored assignment + smallest-area rule, no-new-collections, revision idiom + why sheets are excluded from restore); AGENTS.md item 10 updated (Phase 2 shipped).
- [ ] Commit; memory capture (project file status, session summary, ACTIVE_PROJECTS, MEMORY.md pointer).
