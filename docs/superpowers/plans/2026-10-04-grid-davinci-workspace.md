# The Grid — DaVinci-style workspace (#299) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn The Grid editor (`/design/grid/[id]`) into a full-window, DaVinci-style docked workspace — icon toolbar,
Property Editor + System Status + Targets (left), canvas with sheet tabs and Plan/Spreadsheet views (center), Browser
tree + tabs (right), Product Library tiles (bottom), status bar — and add multi-select, align/distribute, snap to grid,
copy/cut/paste/duplicate and undo/redo.

**Architecture:** `editor.tsx` (≈2,500 lines) is split into a `useGridEditor()` state hook, a `PlanCanvas` component
and pane components inside a fixed CSS-grid `GridWorkspace`. Every rule worth testing lives in a pure, DB-free module in
`src/lib/design/` (layout, tools, selection, align, snap, clipboard, undo, browser tree, system status, library tree).
New batched store functions + server actions apply list edits in one `patchDoc` each, all-or-nothing.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before using any Next API you are unsure
of), React client components with inline styles (the Grid's existing idiom — `BTN`, `PANEL`, `PANEL_LABEL` style
objects), Drizzle doc-store (`patchDoc`) on PGlite (dev) / Neon (prod), `tsx` test harness.

**Spec:** `docs/superpowers/specs/2026-10-04-grid-davinci-workspace-design.md` — read it first.

## Global Constraints

- Worktree: `/Users/sm/Downloads/peak-app-299`, branch `feat/299-grid-workspace`. Node: `export PATH=~/.local/node/bin:$PATH`.
- **Never open `.data/pglite`** from this worktree. `npm run test:specs` uses a `mktemp -d` datadir — fine. Never run
  `next dev` against the real dev DB; browser checks use a scratch datadir (Task 22).
- Keep **every existing server action and its signature** working (riser, intake, other callers use them). New
  behaviour goes in new functions; the only signature change allowed is `placeDeviceAction` / `placeCurtainAction`
  returning the new placement in their success result (additive).
- Unchanged behaviour: intake (Auto/Blank), venue-template base sheets, Auto fill, Change equipment (`RefillDialog`),
  pricing, `createDraftQuoteAction` path, riser/schedule/set/lineset pages.
- Placement geometry is stored as **fractions of page width/height (0..1)**; `aspect = size.h / size.w`. Any circular
  tolerance divides the y tolerance by aspect.
- Hand edits clear the `auto` tag via `withoutAuto` (grid-auto-model.ts). Every new mutation that changes a placement's
  position, part or category must call it. Pasted placements never carry `auto`/`autoOrigin`/`seededFrom`.
- The harness `scripts/test-review-and-spec.ts` has **22 source-text checks reading `editor.tsx`** (lines 1017, 5073,
  5458, 5546, 5557, 17587, 18069, 18390, 18814, 19296, 19742, 22679, 23318, 23363, 23459, 23716, 23969, 26425, 27327,
  33715, 33727, 46932 at the time of writing). When code moves, **repoint each check at the file that now holds the
  string — same string, never weakened or deleted.** Run `grep -n 'grid/\[id\]/editor.tsx' scripts/test-review-and-spec.ts`
  to find them.
- Inline styles + the existing palette (`#16181d` dark, `#dfe2e8` borders, `#9aa0ab` labels, `#8c919c` muted). Accent
  colours come from `var(--accent)` — never hardcode an accent hue.
- Copy: sentence case; no "successfully"; errors say what happened + what to do.
- `localStorage` reads/writes are wrapped in try/catch; render correctly with defaults when storage is unavailable;
  mount-time effect applies stored values (hydration-safe, the `src/lib/inbox-layout.ts` pattern).
- Gates for every task that touches code: `npx tsc --noEmit -p .` clean; `npm run test:specs` → `ALL PASSED` with the
  PASS count = previous count + this task's new checks; `npx eslint <touched files>` no new errors vs. the baseline
  recorded in Task 0. Tasks that move client components also run `npx next build` (the client→server-import trap).
- Commit after every task (`git add <files>` explicitly; never `git add -A`; **never `git stash`** — sibling worktrees
  share the stash). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File structure

**New pure modules (`src/lib/design/`)** — DB-free, imported by both client and harness:

| File | Responsibility |
|---|---|
| `grid-workspace-layout.ts` | Pane size keys, defaults, clamps, parse of stored values |
| `grid-tools.ts` | Tool ids, `activeTool(modes)`, `fitZoom(...)`, shortcut map |
| `grid-selection.ts` | Marquee rect, ids-in-rect, toggle, select-all |
| `grid-align.ts` | Align / distribute over `{id,x,y}` |
| `grid-snap.ts` | Snap grid from calibration + spacing; `snapPoint` |
| `grid-clipboard.ts` | Copy selection → clipboard; paste layout (positions, anchor, clamp) |
| `grid-undo.ts` | Undo stack reducer (`pushUndo`/`takeUndo`/`takeRedo`, cap 100) + `GridCommand` type |
| `grid-browser-tree.ts` | Design → sheet → space → device tree |
| `grid-system-status.ts` | Aggregated warning list |
| `grid-library.ts` | Product Library category tree + selection → `PaletteQuery` |

**Store / server:**

| File | Change |
|---|---|
| `src/lib/design/grid-riser-doc.ts` | + `riserRemovedBetween`, `restoreRiserItems` (pure) |
| `src/lib/stores/grid-projects.ts` | + `movePlacements`, `removePlacements`, `setPlacementsCategory`, `setPlacementsPart`, `pastePlacements`, `restoreItems`; `addPlacement`/`addCurtainPlacement` unchanged |
| `src/lib/design/grid-curtain-input.ts` | Curtain validation extracted from `placeCurtainAction` (server-only: imports `getPart`) |
| `src/app/(app)/design/grid/[id]/actions.ts` | + six batched actions; `placeDeviceAction`/`placeCurtainAction` return `placement` |

**Editor (`src/app/(app)/design/grid/[id]/`):**

| File | Responsibility |
|---|---|
| `editor.tsx` | Thin: `const ed = useGridEditor(props); return <GridWorkspace ed={ed} …/>` |
| `use-grid-editor.ts` | All editor state, memos, handlers (moved from editor.tsx) |
| `plan-canvas.tsx` | The canvas region (sheet render + SVG overlay + popovers), moved from editor.tsx |
| `workspace/grid-workspace.tsx` | CSS grid shell, pane resize/collapse |
| `workspace/pane.tsx` | Collapsible pane frame + resize handle |
| `workspace/toolbar.tsx` | Icon toolbar, Design ▾, Outputs ▾ |
| `workspace/menu.tsx` | Small dropdown menu primitive used by the toolbar |
| `workspace/sheet-tabs.tsx` | Sheet tabs, `+`, per-tab ⋯ (delete sheet); page ‹ › for PDFs |
| `workspace/status-bar.tsx` | Footer |
| `workspace/property-editor.tsx` | Key/value rows by selection |
| `workspace/system-status.tsx` | Warning list |
| `workspace/right-pane.tsx` | Tabs: Browser · Layers · Spaces · Wires · BOM · Revisions |
| `workspace/bom-panel.tsx` | The BOM card content, moved from editor.tsx |
| `workspace/browser-tree.tsx` | Renders `browserTree()` |
| `workspace/product-library.tsx` | Category tree + tiles |
| `workspace/spreadsheet-view.tsx` | Inline schedule table |

---

## Task 0: Baseline

**Files:** none (records numbers in the task log only).

- [ ] **Step 1: Record gate baselines**

```bash
cd /Users/sm/Downloads/peak-app-299 && export PATH=~/.local/node/bin:$PATH
df -h . | tail -1                                   # need > 10 GB free (temp PGlite dirs fill disks)
npx tsc --noEmit -p . 2>&1 | tail -3                # expect no output
npm run test:specs 2>&1 | tail -3                   # expect "ALL PASSED"
npm run test:specs 2>&1 | grep -c "^PASS\|✓" || true   # record the PASS count (see the harness's ok() output format)
npx eslint "src/app/(app)/design/grid/[id]" src/lib/design src/lib/stores/grid-projects.ts 2>&1 | tail -3
```

Record: PASS count, eslint error/warning counts. Look at `ok()` (`scripts/test-review-and-spec.ts:339`) to see what it
prints for a pass and count that token.

- [ ] **Step 2: Clean temp datadirs left by the run**

```bash
ls -d ${TMPDIR:-/tmp}/tmp.* 2>/dev/null | wc -l   # remove stale ones older than this session with rm -rf if many
```

---

# Slice 1 — Shell

## Task 1: Pane layout rules (pure)

**Files:**
- Create: `src/lib/design/grid-workspace-layout.ts`
- Test: `scripts/test-review-and-spec.ts` (append a `{ … }` block at end of file)

**Interfaces — Produces:**
```ts
export type PaneKey = "left" | "right" | "bottom";
export const PANE_DEFAULTS: Record<PaneKey, number>;          // px: left 280, right 280, bottom 220
export const PANE_LIMITS: Record<PaneKey, { min: number; max: number }>; // left/right 200–520, bottom 120–480
export const PANE_SIZE_KEY: (k: PaneKey) => string;           // `pk.grid.pane.${k}.v1`
export const PANE_COLLAPSED_KEY: (k: PaneKey) => string;      // `pk.grid.pane.${k}.collapsed.v1`
export const NARROW_WIDTH = 1100;
export function clampPane(k: PaneKey, px: number | null | undefined): number;
export function parsePaneSize(k: PaneKey, raw: string | null | undefined): number;
export function parseCollapsed(raw: string | null | undefined, fallback: boolean): boolean;
export function defaultCollapsed(k: PaneKey, viewportWidth: number): boolean; // side panes collapse below NARROW_WIDTH; bottom never
```

- [ ] **Step 1: Write the failing checks** (append to the harness, after the last existing `{ … }` block, before nothing — the file's top-level chain runs first; pure blocks run at load)

```ts
/* ======================================================================
   #299 Grid workspace — pane layout rules (Task 1)
   ====================================================================== */
import * as GWL from "@/lib/design/grid-workspace-layout";
{
  ok(GWL.clampPane("left", 50) === 200 && GWL.clampPane("left", 9999) === 520, "#299 layout: side panes clamp to 200–520");
  ok(GWL.clampPane("bottom", 50) === 120 && GWL.clampPane("bottom", 9999) === 480, "#299 layout: bottom pane clamps to 120–480");
  ok(GWL.clampPane("right", NaN) === 280 && GWL.clampPane("right", null) === 280, "#299 layout: unusable width → default");
  ok(GWL.clampPane("left", 301.6) === 302, "#299 layout: whole pixels");
  ok(GWL.parsePaneSize("left", "abc") === 280 && GWL.parsePaneSize("left", "330") === 330, "#299 layout: parse stored size");
  ok(GWL.parseCollapsed("1", false) === true && GWL.parseCollapsed("0", true) === false && GWL.parseCollapsed(null, true) === true, "#299 layout: collapsed flag parse with fallback");
  ok(GWL.defaultCollapsed("left", 1000) && GWL.defaultCollapsed("right", 1000) && !GWL.defaultCollapsed("bottom", 1000), "#299 layout: narrow window collapses side panes only");
  ok(!GWL.defaultCollapsed("left", 1600), "#299 layout: wide window keeps panes open");
  ok(GWL.PANE_SIZE_KEY("left") === "pk.grid.pane.left.v1" && GWL.PANE_COLLAPSED_KEY("bottom") === "pk.grid.pane.bottom.collapsed.v1", "#299 layout: storage keys");
}
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test:specs 2>&1 | tail -5` — Expected: module-not-found / tsx error for `grid-workspace-layout`.

- [ ] **Step 3: Implement**

```ts
/**
 * #299 — The Grid workspace's pane sizes and collapse state, per browser
 * (localStorage), hydration-safe: the shell renders these defaults, then a
 * mount-time effect applies whatever was stored (the inbox-layout pattern).
 * DB-free so test:specs can pin the rules.
 */
export type PaneKey = "left" | "right" | "bottom";

export const PANE_DEFAULTS: Record<PaneKey, number> = { left: 280, right: 280, bottom: 220 };
export const PANE_LIMITS: Record<PaneKey, { min: number; max: number }> = {
  left: { min: 200, max: 520 },
  right: { min: 200, max: 520 },
  bottom: { min: 120, max: 480 },
};
export const NARROW_WIDTH = 1100;

export const PANE_SIZE_KEY = (k: PaneKey) => `pk.grid.pane.${k}.v1`;
export const PANE_COLLAPSED_KEY = (k: PaneKey) => `pk.grid.pane.${k}.collapsed.v1`;

export function clampPane(k: PaneKey, px: number | null | undefined): number {
  if (typeof px !== "number" || !Number.isFinite(px)) return PANE_DEFAULTS[k];
  const { min, max } = PANE_LIMITS[k];
  return Math.min(max, Math.max(min, Math.round(px)));
}

export function parsePaneSize(k: PaneKey, raw: string | null | undefined): number {
  if (!raw) return PANE_DEFAULTS[k];
  const n = Number(raw);
  return Number.isFinite(n) ? clampPane(k, n) : PANE_DEFAULTS[k];
}

export function parseCollapsed(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

/** Side panes start collapsed on a narrow window; the Library never does. */
export function defaultCollapsed(k: PaneKey, viewportWidth: number): boolean {
  return k !== "bottom" && viewportWidth < NARROW_WIDTH;
}
```

- [ ] **Step 4: Run, verify pass** — `npm run test:specs 2>&1 | tail -3` → `ALL PASSED`, PASS count +9.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/grid-workspace-layout.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): workspace pane layout rules (#299)"
```

## Task 2: Extract `useGridEditor` + one tool model

Mechanical move of state/logic out of `editor.tsx`, plus one behaviour fix: entering any tool clears every other mode
(today `armPart` leaves `calibrating`/`pending`/`curtainAt` on — D-entry "one tool at a time").

**Files:**
- Create: `src/lib/design/grid-tools.ts`, `src/app/(app)/design/grid/[id]/use-grid-editor.ts`
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx`
- Test: harness (new block + repointed source-text checks)

**Interfaces — Produces (`grid-tools.ts`):**
```ts
export type GridTool = "select" | "place" | "curtain" | "wire" | "space" | "calibrate" | "pan";
export type ModeFlags = { armedPartId: string | null; armedCurtainType: string | null; wireDrawing: boolean; spaceDrawing: boolean; calibrating: boolean; panning: boolean };
export function activeTool(m: ModeFlags): GridTool;   // priority: calibrate > space > wire > curtain > place > pan > select
export const TOOL_KEYS: Record<string, GridTool>;     // { v:"select", p:"place", w:"wire", s:"space", h:"pan" }
export function fitZoom(container: { w: number; h: number }, sheetPx: { w: number; h: number }, zoom: number): number;
  // natural = sheetPx / zoom; fit = min(container.w / natural.w, container.h / natural.h) * 0.96, snapped down to 0.05, clamped [0.25, 4]
export const ZOOM_MIN = 0.25; export const ZOOM_MAX = 4;
```

**Produces (`use-grid-editor.ts`):**
```ts
export type GridEditorProps = /* exactly the props type currently declared inline at editor.tsx:265-328 — move it here and export it */;
export function useGridEditor(props: GridEditorProps): GridEditor;
export type GridEditor = ReturnType<typeof useGridEditorImpl>; // implement as `function useGridEditorImpl(props)` and `export const useGridEditor = useGridEditorImpl`
// The returned object exposes every value the JSX in editor.tsx reads today (state + setters, memos, handlers) PLUS:
//   tool: GridTool;
//   enterTool(t: GridTool, opts?: { partId?: string; curtainType?: string }): void;  // clears all other modes first
//   panning: boolean; setPanning(b: boolean): void;
```

- [ ] **Step 1: Failing checks for `grid-tools`**

```ts
/* #299 Grid workspace — tool model (Task 2) */
import * as GT from "@/lib/design/grid-tools";
{
  const none = { armedPartId: null, armedCurtainType: null, wireDrawing: false, spaceDrawing: false, calibrating: false, panning: false };
  ok(GT.activeTool(none) === "select", "#299 tools: nothing on → select");
  ok(GT.activeTool({ ...none, armedPartId: "p1" }) === "place", "#299 tools: armed part → place");
  ok(GT.activeTool({ ...none, armedCurtainType: "Border" }) === "curtain", "#299 tools: armed curtain → curtain");
  ok(GT.activeTool({ ...none, armedPartId: "p1", calibrating: true }) === "calibrate", "#299 tools: calibrate wins over a stale armed part");
  ok(GT.activeTool({ ...none, panning: true }) === "pan", "#299 tools: pan");
  ok(GT.TOOL_KEYS.v === "select" && GT.TOOL_KEYS.w === "wire" && GT.TOOL_KEYS.s === "space" && GT.TOOL_KEYS.h === "pan", "#299 tools: shortcuts");
  // 900px-wide natural sheet at zoom 1.25 → 1125px rendered; a 1000×800 box fits 1000/900*0.96 = 1.0666 → 1.05
  ok(GT.fitZoom({ w: 1000, h: 800 }, { w: 1125, h: 562.5 }, 1.25) === 1.05, "#299 tools: fit zoom by width");
  ok(GT.fitZoom({ w: 1000, h: 200 }, { w: 900, h: 900 }, 1) === 0.25, "#299 tools: fit zoom clamps to min");
  ok(GT.fitZoom({ w: 0, h: 0 }, { w: 900, h: 900 }, 1.5) === 1.5, "#299 tools: unknown box keeps zoom");
}
```

- [ ] **Step 2: Run — expect fail (module missing).**

- [ ] **Step 3: Implement `grid-tools.ts`**

```ts
/** #299 — The Grid toolbar's tool model. The editor still keeps its separate
 *  mode flags (armed part, drawing modes…); this derives the one active tool
 *  from them, in a fixed priority, so the toolbar can never show two. */
export type GridTool = "select" | "place" | "curtain" | "wire" | "space" | "calibrate" | "pan";
export type ModeFlags = {
  armedPartId: string | null;
  armedCurtainType: string | null;
  wireDrawing: boolean;
  spaceDrawing: boolean;
  calibrating: boolean;
  panning: boolean;
};

export function activeTool(m: ModeFlags): GridTool {
  if (m.calibrating) return "calibrate";
  if (m.spaceDrawing) return "space";
  if (m.wireDrawing) return "wire";
  if (m.armedCurtainType) return "curtain";
  if (m.armedPartId) return "place";
  if (m.panning) return "pan";
  return "select";
}

export const TOOL_KEYS: Record<string, GridTool> = { v: "select", p: "place", w: "wire", s: "space", h: "pan" };

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export function fitZoom(container: { w: number; h: number }, sheetPx: { w: number; h: number }, zoom: number): number {
  if (!(container.w > 0) || !(container.h > 0) || !(sheetPx.w > 0) || !(sheetPx.h > 0) || !(zoom > 0)) return zoom;
  const nw = sheetPx.w / zoom;
  const nh = sheetPx.h / zoom;
  const fit = Math.min(container.w / nw, container.h / nh) * 0.96;
  const snapped = Math.floor(fit / 0.05) * 0.05;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(snapped * 100) / 100));
}
```

Note: today zoom steps are 0.5–4 by 0.25 (`editor.tsx:1551,1555`). Change the −/+ handlers to step 0.25 within
`[ZOOM_MIN, ZOOM_MAX]` and round to 2 decimals so a Fit value like 1.05 steps cleanly.

- [ ] **Step 4: Run — expect the 9 new checks pass.**

- [ ] **Step 5: Create `use-grid-editor.ts` by moving code**

1. `"use client";` at top. Move the props type (editor.tsx:265-328) here as `export type GridEditorProps`, and the
   `ProjectLite`/`SheetLite` types (editor.tsx:238-258) — export them.
2. Move **everything inside the `GridEditor` function body from line 329 up to (not including) the `return (` at
   ≈1358** into `function useGridEditorImpl(props: GridEditorProps)`. Destructure props at the top exactly as the
   component does today. Module-level helpers/constants the moved code uses (`DEVICE_HIT_RADIUS`, `NUDGE*`,
   `snappedPlacement`, `MarkerDrag`, `MoveOverride`, `Pending`, …) move to the hook file if only the hook uses them;
   if JSX also uses them, export them from the hook file and import in editor.tsx.
3. Add the tool model inside the hook:

```ts
const [panning, setPanning] = useState(false);
const tool = activeTool({ armedPartId, armedCurtainType, wireDrawing, spaceDrawing, calibrating, panning });

/** One tool at a time (#299): every entry point clears every other mode. */
const clearModes = useCallback(() => {
  setArmedPartId(null);
  setArmedCurtainType(null);
  setCurtainAt(null);
  setWireDrawing(false);
  setWireDraft([]);
  setSpaceDrawing(false);
  setSpaceDraft([]);
  setCalibrating(false);
  setCalDraft(null);
  setPending(null);
  setPanning(false);
}, []);

const enterTool = useCallback((t: GridTool, opts?: { partId?: string; curtainType?: string }) => {
  clearModes();
  if (t !== "select" && t !== "pan") { setSelected(null); setSelectedSpaceId(null); setSelectedRouteId(null); }
  if (t === "place" && opts?.partId) setArmedPartId(opts.partId);
  if (t === "curtain" && opts?.curtainType) setArmedCurtainType(opts.curtainType);
  if (t === "wire") setWireDrawing(true);
  if (t === "space") setSpaceDrawing(true);
  if (t === "calibrate") setCalibrating(true);
  if (t === "pan") setPanning(true);
}, [clearModes]);
```

   Use the exact setter names and the exact reset values the existing code uses (check each `useState` initial value —
   e.g. if `wireDraft` initialises to `[]` reset to `[]`; if `calDraft` is `null`, `null`). Then rewrite `armPart`
   (≈1338), the Calibrate buttons' onClick (≈1603, 1626), the Curtain type buttons (≈1651-1664) and the Spaces/Wires
   `onStartDraw` callbacks (≈1717, 1757) to call `enterTool(...)`. Keep `armPart`'s Recent/other side effects if any.
   The Wires tool still needs a picked wire part: `enterTool("wire")` when `wirePartId` is empty sets `err` to
   "Pick a wire type in the Wires tab first." and stays in select (do this check inside `enterTool`).
4. `return { ...every name the JSX reads..., tool, enterTool, panning, setPanning };` — build the list by compiling:
   leave editor.tsx JSX untouched, write `const ed = useGridEditor(props);` then `const { a, b, c, … } = ed;` and let
   `tsc` tell you which names are missing until it compiles.
5. editor.tsx keeps `export default function GridEditor(props: GridEditorProps)` with the JSX unchanged.

- [ ] **Step 6: Repoint harness source-text checks**

```bash
grep -n 'grid/\[id\]/editor.tsx' scripts/test-review-and-spec.ts
```

For each check, find which file now contains its asserted string(s) (`grep -n "<string>" "src/app/(app)/design/grid/[id]/"*.ts*`).
If the strings now live in `use-grid-editor.ts`, read that file instead (or read both and concatenate when a check's
strings straddle files: `const src = read(editor) + read(hook)` — keep the asserted literals byte-identical). Do not
delete or loosen any assertion.

- [ ] **Step 7: Gates** — tsc clean; `npm run test:specs` ALL PASSED (count = Task 1 count + 9); eslint on the two files
  no new errors; `npx next build` succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/grid-tools.ts "src/app/(app)/design/grid/[id]/use-grid-editor.ts" "src/app/(app)/design/grid/[id]/editor.tsx" scripts/test-review-and-spec.ts
git commit -m "refactor(grid): extract useGridEditor + one-tool-at-a-time model (#299)"
```

## Task 3: Extract `PlanCanvas` + Pan + Fit + drop target

**Files:**
- Create: `src/app/(app)/design/grid/[id]/plan-canvas.tsx`
- Modify: `editor.tsx`, `use-grid-editor.ts`, harness checks that read canvas strings

**Interfaces — Produces:**
```ts
export default function PlanCanvas(props: { ed: GridEditor; onDropPart?: (partId: string, at: Point) => void }): JSX.Element;
// hook additions:
//   scrollRef: RefObject<HTMLDivElement>   — the scrolling canvas box (was the inline style div at ≈2095)
//   fit(): void                             — setZoom(fitZoom(box, size, zoom))
//   cursorAt: Point | null                  — last pointer position over the plan in plan coords (null when off-plan); updated in onMove
```

- [ ] **Step 1:** Move the canvas region JSX (editor.tsx ≈2095-2491: the grey scrolling box, upload prompt, `wrapRef`
  wrapper, `PdfCanvas`/`<img>`, the SVG overlay, `PlanLegend`, `CurtainDrop`, calibrate/space entry popover) into
  `plan-canvas.tsx` verbatim, reading values from `ed`. editor.tsx renders `<PlanCanvas ed={ed} />` in the same spot.
- [ ] **Step 2: Pan.** In `plan-canvas.tsx`, when `ed.tool === "pan"` **or the Space key is held** (track `spaceHeld`
  with keydown/keyup listeners on window that ignore inputs/textareas/contenteditable, `e.code === "Space"`,
  `preventDefault` only while over the canvas), pointerdown on the scroll box starts a pan: record
  `{x: e.clientX, y: e.clientY, left: scrollLeft, top: scrollTop}`, pointermove sets `scrollLeft/Top` to
  `start.left - (e.clientX - start.x)` etc., pointerup ends. While panning, `onDown` (the plan dispatcher) must not
  run — check `if (ed.tool === "pan" || spaceHeld) return;` at its top (in the hook, pass `spaceHeld` via a ref). Cursor
  `grab` / `grabbing`.
- [ ] **Step 3: Fit.** `fit()` in the hook reads `scrollRef.current.clientWidth/clientHeight` (minus 24px padding) and
  `size`, calls `fitZoom`. Fit runs once automatically the first time a sheet's `size` becomes known for a given
  `activeSheetId` (track with a ref of fitted sheet ids) — so a design opens fitted instead of at 125%.
- [ ] **Step 4: cursorAt.** In `onMove`, set `cursorAt = toNorm(e)`; on pointerleave of the wrapper set `null`.
  Throttle with `requestAnimationFrame` (store pending point in a ref; one setState per frame).
- [ ] **Step 5: Drop target.** On the `wrapRef` element add `onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-grid-part")) e.preventDefault(); }}`
  and `onDrop={(e) => { const id = e.dataTransfer.getData("application/x-grid-part"); const p = toNorm(e); if (id && p) props.onDropPart?.(id, p); }}`.
  `toNorm` must accept `{clientX, clientY}` (DragEvent has both). In the hook add
  `placeAt(partId: string, at: Point)` that runs the same code path as the armed-part branch of `onDown`
  (refactor that branch into `placeAt` and call it from both).
- [ ] **Step 6:** Repoint any harness check whose strings moved into `plan-canvas.tsx` (same rule as Task 2 Step 6).
- [ ] **Step 7: Gates** (tsc, specs, eslint, next build).
- [ ] **Step 8: Commit** — `refactor(grid): PlanCanvas + pan, fit and drop target (#299)`.

## Task 4: The docked shell — workspace, panes, toolbar, sheet tabs, status bar

No new rules to unit-test beyond Task 1; this task is UI. Move today's header row out; keep every control reachable.

**Files:**
- Create: `workspace/grid-workspace.tsx`, `workspace/pane.tsx`, `workspace/toolbar.tsx`, `workspace/menu.tsx`,
  `workspace/sheet-tabs.tsx`, `workspace/status-bar.tsx`
- Modify: `editor.tsx`, `use-grid-editor.ts`

**Interfaces — Produces:**
```ts
// pane.tsx
export function Pane(props: { k: PaneKey; title: string; side: "left" | "right" | "bottom"; size: number; collapsed: boolean;
  onResize: (px: number) => void; onToggle: () => void; children: React.ReactNode; tabs?: React.ReactNode }): JSX.Element;
// grid-workspace.tsx
export default function GridWorkspace(props: { ed: GridEditor; left: React.ReactNode; right: React.ReactNode; bottom: React.ReactNode;
  center: React.ReactNode; toolbar: React.ReactNode; status: React.ReactNode }): JSX.Element;
// hook additions:
//   lastAction: string | null; noteAction(text: string): void   — every successful mutation handler calls noteAction("Placed S4 LED") etc.
```

- [ ] **Step 1: `menu.tsx`** — a button that toggles an absolutely positioned list; closes on outside pointerdown and
  Escape; items `{ label, onSelect, href?, danger?, disabled? }`; `href` items render `next/link`. Keyboard: ArrowUp/Down
  moves focus, Enter selects. Mark the menu root `data-no-nudge` so arrow keys don't nudge the device.
- [ ] **Step 2: `pane.tsx`** — renders a header (`PANEL_LABEL` style title, optional `tabs`, a collapse chevron
  button with `aria-label="Collapse <title>"`/`"Expand <title>"`), a scrolling body (`overflow: auto; min-height: 0`),
  and a 6px resize handle on the inner edge (right edge for left pane, left edge for right pane, top edge for bottom).
  Resize uses pointer capture: pointerdown records start size + client pos; pointermove calls
  `onResize(clampPane(k, start ± delta))`; double-click the handle resets to `PANE_DEFAULTS[k]`. Collapsed renders a
  28px strip with the title written vertically (side) or a 28px bar (bottom) that expands on click.
- [ ] **Step 3: `grid-workspace.tsx`** — owns pane state:

```tsx
const [sizes, setSizes] = useState<Record<PaneKey, number>>({ ...PANE_DEFAULTS });
const [collapsed, setCollapsed] = useState<Record<PaneKey, boolean>>({ left: false, right: false, bottom: false });
useEffect(() => {           // mount: apply stored values (hydration-safe)
  const vw = window.innerWidth;
  const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
  setSizes({ left: parsePaneSize("left", read(PANE_SIZE_KEY("left"))), right: parsePaneSize("right", read(PANE_SIZE_KEY("right"))), bottom: parsePaneSize("bottom", read(PANE_SIZE_KEY("bottom"))) });
  setCollapsed({ left: parseCollapsed(read(PANE_COLLAPSED_KEY("left")), defaultCollapsed("left", vw)), right: parseCollapsed(read(PANE_COLLAPSED_KEY("right")), defaultCollapsed("right", vw)), bottom: parseCollapsed(read(PANE_COLLAPSED_KEY("bottom")), defaultCollapsed("bottom", vw)) });
}, []);
const save = (key: string, v: string) => { try { window.localStorage.setItem(key, v); } catch { /* per-viewer convenience only */ } };
```

  Layout (root `style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto auto", overflow: "hidden" }}`):
  row 1 toolbar; row 2 a 3-column grid `${left}px minmax(0,1fr) ${right}px` (28px for a collapsed side); row 3 the
  bottom pane (`${bottom}px` or 28px); row 4 status bar. The editor page must stop page-scrolling: verify `.pk-main`
  (globals.css:66, `flex:1; overflow-y:auto`) gives the root a definite height; if `height: 100%` does not resolve in
  the browser check (Task 5), use `height: "calc(100dvh - var(--pk-nav-h, 56px))"` after reading the nav's real height
  from `.pk-nav` in globals.css. Remove the editor's old outer padding/gap.
- [ ] **Step 4: `toolbar.tsx`** — one row, 34px tall, icon buttons 28×28 with `title` tooltips incl. shortcut
  ("Select (V)"). Icons: use the inline SVG icon set the app already has — search `src/components` for an icon
  component (`grep -rln "function Icon\|export function .*Icon" src/components | head`) and reuse it; if none fits,
  use short text glyphs (↖ select, ✋ pan, ⤢ fit). Groups separated by 1px dividers:
  - Tools: Select, Place (enabled only when a part is armed — else tooltip "Pick a part in the Library"), Wire, Space,
    Calibrate, Pan. Active tool = `ed.tool` (dark fill).
  - Edit (slice 6 wires these; render disabled with tooltip "Coming in this release" **only until Task 21**, then
    enable): Undo, Redo, Cut, Copy, Paste, Duplicate; Delete (enabled when something is selected → same handler as the
    selected-device Remove button today).
  - Arrange (slice 5 wires these; same temporary disabled state until Task 16).
  - View: −, `<input>` showing `Math.round(zoom*100)%` (Enter applies `clamp(value/100)`), +, Fit.
  - Right side: Auto fill / Change equipment button (opens the existing `RefillDialog` flow the ScopePanel uses —
    lift `refill` open state into the hook so both the ScopePanel and the toolbar open the same dialog; for a Blank
    design with no `auto` the button reads "Auto fill…" and opens the same dialog for the first scope with targets;
    if there are no scope targets it is hidden), **Design ▾** menu (the `OptionSwitcher` content: list options with
    counts + check on active → `switchOption`; then "+ Option…", "Rename option…", "Delete option…" invoking the
    switcher's existing add/rename/delete flows — render `<OptionSwitcher>` inside the menu panel if simpler), the
    `DesignIdentity` name/customer (left end of the toolbar, compact), venue select (inside Design ▾ as "Venue…"),
    **Outputs ▾** menu (Riser, Schedule, Drawing set links with `?option=`; Lineset link/select; Client package
    (runs `buildClientPackage`, shows its Download link + gap/unreadable notes in a popover); Delete design (the
    existing armDelete two-step)), and **Add to quotes** (the existing quote button → `runQuote(false)`, same
    `disabled={busy || bomEmpty}` rule — keep that literal string where it lives for the harness).
  - Keyboard (in the hook, a new window keydown effect, same input/dialog/`data-no-nudge` guards as the nudge
    handler, no meta/ctrl/alt): `TOOL_KEYS[e.key.toLowerCase()]` → `enterTool` (for `p`, only when a part is armed);
    Escape → `enterTool("select")` and clear selection; Delete/Backspace with a selection → remove (same as Remove).
- [ ] **Step 5: `sheet-tabs.tsx`** — tabs for `sheets` (name, active = `activeSheetId`), click = the existing sheet
  `<select>` onChange logic (≈1399-1412: move that into a hook function `switchSheet(id)`), a `+` tab = the existing
  upload button (`fileRef.current?.click()`), each tab's ⋯ menu: "Delete sheet" (existing `removeSheetAction`
  ConfirmButton flow). PDF page ‹ n/N › sits at the right end of the tab strip. Below the canvas: two tabs
  **Plan view** / **Spreadsheet view** (`view` state in the hook, `"plan" | "sheet"`; Spreadsheet is filled in Task 12 —
  until then render "Spreadsheet view arrives with the Browser tree." placeholder text).
- [ ] **Step 6: `status-bar.tsx`** — 24px, muted 11.5px text: `Last action: …` · `Devices: <this sheet> / <design>`
  (counts from `sheetPlacements.length` and `placements.length` incl. lot `placementQty`) · `Scale: <cal label or
  "not calibrated">` · (slice 5: `Snap: off|6"`) · right end: the `err` text in red when set, else nothing (the app nav
  already shows Synced).
- [ ] **Step 7: editor.tsx composition (slice 1 state)** —

```tsx
export default function GridEditor(props: GridEditorProps) {
  const ed = useGridEditor(props);
  return (
    <GridWorkspace
      ed={ed}
      toolbar={<Toolbar ed={ed} />}
      left={<LegacyLeftColumn ed={ed} />}   // today's left-column cards, unchanged, in a scrolling pane (replaced in slices 2–3)
      right={null}                          // slice 3
      bottom={null}                         // slice 2
      center={<><SheetTabs ed={ed} /><PlanCanvas ed={ed} onDropPart={ed.placeAt} /></>}
      status={<StatusBar ed={ed} />}
    />
  );
}
```

  `LegacyLeftColumn` is the current left-sidebar JSX (≈1573-2093) moved into a local component in editor.tsx (or
  `workspace/legacy-left.tsx`). Panes passed `null` are not rendered (no strip). The old header row is deleted — every
  control it held is now in the toolbar, menus or sheet tabs (check the list at editor.tsx ≈1361-1563 one by one).
- [ ] **Step 8:** Repoint harness checks for moved strings. Gates incl. `next build`.
- [ ] **Step 9: Commit** — `feat(grid): docked workspace shell, toolbar, sheet tabs, status bar (#299 slice 1)`.

## Task 5: Slice 1 browser check

- [ ] Run the browser check procedure from Task 22 (scratch datadir) on: open a design → page does not scroll, panes
  resize/collapse and survive reload, every Outputs/Design menu item works, sheet tabs switch, Fit, pan with H and with
  Space held, tool shortcuts, Escape. Screenshot at 1600×1000 and 1000×800. Fix and commit anything found.

---

# Slice 2 — Product Library

## Task 6: Library tree rules (pure)

**Files:** Create `src/lib/design/grid-library.ts`; test in harness.

**Interfaces — Consumes:** `PaletteQuery`, `PaletteView`, `PaletteTab` from `grid-palette.ts`; `GridLayer`,
`GRID_LAYERS` from `grid-scopes.ts`; `PartLite` from `grid-bom.ts`.
**Produces:**
```ts
export type LibrarySel =
  | { kind: "favorites" } | { kind: "recent" } | { kind: "all" }
  | { kind: "scope"; scope: GridLayer } | { kind: "type"; scope: GridLayer; typeKey: string }
  | { kind: "assemblies" } | { kind: "curtains" };
export type LibraryNode = { key: string; label: string; count?: number; sel: LibrarySel; children?: LibraryNode[] };
export function libraryQuery(sel: LibrarySel, search: string, mfr: string): PaletteQuery | null; // null for assemblies/curtains
export function libraryTree(input: { scopeCounts: Record<string, number>; favorites: number; recent: number;
  assemblies: number; open: LibrarySel; typeChips: { key: string; label: string; count: number }[] }): LibraryNode[];
export function selKey(sel: LibrarySel): string;   // "favorites" | "recent" | "all" | "scope:Lighting" | "type:Lighting:par" | "assemblies" | "curtains"
export function assemblyParts(parts: PartLite[], search: string): PartLite[]; // kind === "assembly", search on desc/model/mfr, sorted by desc
```

Rules: tree order = Favorites, Recent, All, then one node per `GRID_LAYERS` entry with `scopeCounts[scope] > 0`
(label = scope, count), then Assemblies (if `assemblies > 0`), then Curtains (always). Type children appear only under
the scope that `open` points at (`open.kind === "scope" | "type"`), from `typeChips`, each `sel: {kind:"type", scope, typeKey}`.
`libraryQuery`: favorites → `{tab:"favorites", search, scope:"", typeKey:"", mfr}`; recent → tab "recent"; all → tab
"all"; scope → tab "all" + scope; type → tab "all" + scope + typeKey.

- [ ] **Step 1: Failing checks**

```ts
/* #299 Grid workspace — Product Library tree (Task 6) */
import * as GLIB from "@/lib/design/grid-library";
{
  const q = GLIB.libraryQuery({ kind: "type", scope: "Lighting", typeKey: "par" }, "s4", "ETC");
  ok(q !== null && q.tab === "all" && q.scope === "Lighting" && q.typeKey === "par" && q.search === "s4" && q.mfr === "ETC", "#299 library: type node → palette query");
  ok(GLIB.libraryQuery({ kind: "favorites" }, "", "")?.tab === "favorites", "#299 library: favorites → favorites tab");
  ok(GLIB.libraryQuery({ kind: "curtains" }, "", "") === null && GLIB.libraryQuery({ kind: "assemblies" }, "", "") === null, "#299 library: curtains/assemblies are not palette queries");
  const tree = GLIB.libraryTree({ scopeCounts: { Lighting: 62, Rigging: 0, Audio: 3 }, favorites: 2, recent: 0, assemblies: 1,
    open: { kind: "scope", scope: "Lighting" }, typeChips: [{ key: "par", label: "PAR", count: 10 }] });
  ok(tree.map((n) => n.key).join(",") === "favorites,recent,all,scope:Lighting,scope:Audio,assemblies,curtains", "#299 library: node order, empty scopes hidden");
  const light = tree.find((n) => n.key === "scope:Lighting")!;
  ok(light.count === 62 && light.children?.[0].key === "type:Lighting:par", "#299 library: open scope lists its types");
  ok(!tree.find((n) => n.key === "scope:Audio")!.children, "#299 library: closed scopes have no children");
  ok(!GLIB.libraryTree({ scopeCounts: {}, favorites: 0, recent: 0, assemblies: 0, open: { kind: "all" }, typeChips: [] }).some((n) => n.key === "assemblies"), "#299 library: no assemblies node when there are none");
  const parts = [{ id: "a", sku: "A", desc: "Zeta rack", category: "", unit: "ea", list: 1, cost: 1, kind: "assembly" as const },
    { id: "b", sku: "B", desc: "Alpha pkg", category: "", unit: "ea", list: 1, cost: 1, kind: "assembly" as const },
    { id: "c", sku: "C", desc: "Plain", category: "", unit: "ea", list: 1, cost: 1 }];
  ok(GLIB.assemblyParts(parts, "").map((p) => p.id).join(",") === "b,a" && GLIB.assemblyParts(parts, "zeta").length === 1, "#299 library: assemblies filter + sort");
}
```

- [ ] **Step 2:** Run → fail. **Step 3:** Implement exactly per the rules above (`selKey` builds the keys used in the
  tests). **Step 4:** Run → pass (+8). **Step 5: Commit** `feat(grid): Product Library tree rules (#299)`.

## Task 7: Product Library pane

**Files:** Create `workspace/product-library.tsx`; Modify `editor.tsx` (bottom pane), `use-grid-editor.ts`.

**Interfaces — Consumes:** `paletteView`, `PALETTE_ROW_CAP` (grid-palette), Task 6 exports, `SymbolIcon`
(`@/components/design/symbol-shape`, used by device-palette.tsx), `toggleGridFavoriteAction`, `ed.enterTool`,
`ed.armedPartId`, `ed.lookOf`, `ed.partLayerHidden`, the curtain types list the inline Curtains panel uses today
(editor.tsx ≈1635-1681 — find its constant, likely `GRID_CURTAIN_TYPES`), `AssembliesPanel`.

- [ ] **Step 1:** Layout: `display: grid; gridTemplateColumns: "180px minmax(0,1fr)"`. Left: the tree from
  `libraryTree` (indent 12px per level, count right-aligned muted, selected row = light accent background via
  `color-mix(in srgb, var(--accent) 12%, transparent)`, chevron toggles open scope). Right: a filter row (search input
  `placeholder="Search parts or MFR #"`, manufacturer `<select>` from `view.manufacturers`, and when the device
  palette showed it, the "N unmapped parts hidden — map them" note), then the tile grid
  `gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))"`, gap 8.
- [ ] **Step 2: Tiles.** Each tile: number badge (index+1, IBM Plex Mono 10.5px, top-left), the symbol
  (`<SymbolIcon>` at 34px using `ed.lookOf(part)` exactly as device-palette.tsx renders rows), name (2-line clamp,
  12px), price muted (`$` + `Math.round(list)`), star toggle (top-right, same favorite action/state logic as
  device-palette.tsx:78-85 — move that state into the library). `title` = `${desc} — ${manufacturer} ${modelNumber||sku}`.
  Armed tile = 2px `var(--accent)` border. Click → `ed.enterTool("place", { partId })` (click again on the armed tile →
  `enterTool("select")`). `draggable` → `onDragStart={(e) => e.dataTransfer.setData("application/x-grid-part", part.id)}`.
  Cap rows at `PALETTE_ROW_CAP` with the existing "refine your search" note pattern. Keep the "armed part's layer is
  hidden" warning (device-palette.tsx:176-180) as a strip above the tiles.
- [ ] **Step 3: Curtains category** renders one tile per curtain type (Border, Draw, Full, Leg) → click =
  `ed.enterTool("curtain", { curtainType })`, plus the no-fabric note when `fabrics.length === 0` (move the inline
  Curtains panel's note). **Assemblies category** renders `assemblyParts` tiles (arm like parts) and a
  "+ Build assembly" button that toggles the existing `AssembliesPanel` (its create form) in a 360px popover anchored
  to the button.
- [ ] **Step 4:** In editor.tsx pass `bottom={<ProductLibrary ed={ed} />}` with pane title "Product library", and
  remove `DevicePalette`, `AssembliesPanel` and the inline Curtains card from `LegacyLeftColumn`. Keep
  `device-palette.tsx` file only if something else imports it (`grep -rn "device-palette" src`); otherwise delete it
  and repoint any harness check reading it at `product-library.tsx` (same strings — move the strings' code with it).
- [ ] **Step 5:** Gates incl. `next build`. Browser: arm by click, place by click, drag a tile onto the plan, star,
  curtains, build an assembly. **Commit** `feat(grid): Product Library drawer with symbol tiles (#299 slice 2)`.

---

# Slice 3 — Left pane + right tabs

## Task 8: System Status rules (pure)

**Files:** Create `src/lib/design/grid-system-status.ts`; test in harness.

**Produces:**
```ts
export type StatusLevel = "error" | "warn" | "info";
export type StatusFix = "calibrate" | "map" | "upload" | null;
export type StatusItem = { key: string; level: StatusLevel; text: string; fix: StatusFix };
export function systemStatus(i: {
  err: string | null; hasSheet: boolean; calibrated: boolean; page: number;
  needsPart: number;          // BOM lines whose part is virtualDead (the "Needs a part" pills) + incompleteQuote count if any
  hiddenUnmapped: number;     // paletteView(...).hiddenUnmapped for the unfiltered "all" query
  tierFallback: string[];     // tierFallbackLines
  unmeasuredWires: number;    // wires.unmeasured
  hasWires: boolean;
}): StatusItem[];
```

Order and copy (exact):
1. `err` → `{key:"err", level:"error", text: err, fix:null}`
2. `!hasSheet` → `{key:"sheet", level:"warn", text:"Upload a plan sheet to start.", fix:"upload"}` (and nothing about calibration)
3. `hasSheet && !calibrated` → `{key:"cal", level: hasWires ? "warn" : "info", text:`Page ${page} isn't calibrated — wire lengths and snap need a scale.`, fix:"calibrate"}`
4. `needsPart > 0` → `{key:"needs", level:"warn", text:`Incomplete — ${needsPart} item${needsPart===1?"":"s"} need${needsPart===1?"s":""} a part.`, fix:"map"}`
5. `unmeasuredWires > 0` → `{key:"wires", level:"warn", text:`${n} wire run${s} can't be measured (page scale removed).`, fix:"calibrate"}`
6. `tierFallback.length` → `{key:"tier", level:"info", text:`${n} line${s} quoted at list price (no usable cost).`, fix:null}`
7. `hiddenUnmapped > 0` → `{key:"unmapped", level:"info", text:`${n} unmapped part${s} hidden from the Library.`, fix:"map"}`

- [ ] **Step 1: Failing checks**

```ts
/* #299 Grid workspace — System Status (Task 8) */
import { systemStatus } from "@/lib/design/grid-system-status";
{
  const base = { err: null, hasSheet: true, calibrated: true, page: 1, needsPart: 0, hiddenUnmapped: 0, tierFallback: [], unmeasuredWires: 0, hasWires: false };
  ok(systemStatus(base).length === 0, "#299 status: a clean design has no rows");
  ok(systemStatus({ ...base, hasSheet: false, calibrated: false }).map((s) => s.key).join(",") === "sheet", "#299 status: no sheet → only the upload row");
  const all = systemStatus({ ...base, err: "Boom.", calibrated: false, needsPart: 1, hiddenUnmapped: 3, tierFallback: ["a", "b"], unmeasuredWires: 2, hasWires: true });
  ok(all.map((s) => s.key).join(",") === "err,cal,needs,wires,tier,unmapped", "#299 status: fixed order");
  ok(all.find((s) => s.key === "needs")!.text === "Incomplete — 1 item needs a part." && all.find((s) => s.key === "cal")!.level === "warn", "#299 status: copy + calibration is a warning once wires exist");
  ok(systemStatus({ ...base, calibrated: false }).find((s) => s.key === "cal")!.level === "info", "#299 status: calibration is info with no wires");
  ok(systemStatus({ ...base, needsPart: 4 })[0].text === "Incomplete — 4 items need a part.", "#299 status: plural");
}
```

- [ ] **Steps 2–5:** fail → implement → pass (+6) → commit `feat(grid): System Status rules (#299)`.

## Task 9: Property Editor, System Status pane, Targets

**Files:** Create `workspace/property-editor.tsx`, `workspace/system-status.tsx`; Modify `editor.tsx`,
`use-grid-editor.ts`.

**Interfaces — Consumes:** Task 8; from the hook: `selectedPlacement`, `selectedPart`, `selectedSpaceId`,
`selectedRouteId`, `cal`, `project`, `active` option, handlers `saveCategory`, `saveSymbolLook`, `clearCalAction`
flow, `enterTool("calibrate")`, the selected-device panel JSX (editor.tsx ≈1784-1936).

- [ ] **Step 1: `PropRow` primitive** in property-editor.tsx: a two-column row (`gridTemplateColumns: "42% 58%"`,
  11.5px, 1px `#f0f1f4` bottom border, label muted, value `#16181d`; value may be text or an input). Section header rows
  use the `PANEL_LABEL` style on a `#f7f8fa` band (DaVinci's grouped look).
- [ ] **Step 2: Modes** (one component, switch on selection):
  - **Nothing selected → "Design"**: Name (DesignIdentity inline rename), Customer (its combobox), Venue (existing
    venue select + `setVenueAction`), Option (name + tier), Sheet (name, page n/N), **Scale**: calibrated → label +
    "Recalibrate" (enterTool calibrate) + "Clear" (existing `clearCalAction` flow); not → "Not calibrated" +
    "Calibrate this page" button. This replaces the inline Scale card (≈1590-1632).
  - **One device / curtain**: move the selected-device panel content (≈1784-1936) here as rows: Part (desc), MFR #,
    Manufacturer, Scope (read-only, `scopeOfPlacement`), Type, Space (read-only, `spaceOf(...)?.name ?? "—"`),
    Qty (lot qty or 1), Sell, Spec key, Category (the existing category editor + datalist), Auto (`auto ? "Auto ·
    tier" : "Hand-placed"`), Placed by, Position (x/y %), Ports list, Symbol look (`SymbolLookPanel`), and the Remove
    button. Curtains show their curtain rows the same way the panel does today. Keep every literal string the harness
    asserts (move them, don't rewrite).
  - **One space**: the SpacesPanel's selected-space rename/delete block moved here (name input, rollup $, Delete).
  - **One wire**: route part, length (calibrated) and Delete (WiresPanel's selected-route block).
  - **Several** (slice 5 fills this; for now unreachable).
- [ ] **Step 3: `system-status.tsx`** renders `systemStatus(...)` rows (icon by level: ⚠ warn `#8a6d1f`, ✕ error
  `#a0442b`, ⓘ info `#8c919c`), each with a fix button: `calibrate` → `enterTool("calibrate")`, `upload` →
  `fileRef.current?.click()`, `map` → the existing `EquipmentMapLink` (only for users who can map — it already gates
  itself). Header shows the count. The incomplete-quote banner with "Quote anyway"/Cancel (≈2023-2038) and the
  tier-fallback banner (≈2044-2065) **stay in the BOM panel** (they are part of the quote flow); System Status also
  lists them as rows.
- [ ] **Step 4: Targets** = `<ScopePanel …/>` moved unchanged into the left pane under System Status, in a
  collapsible section (default open; state in localStorage key `pk.grid.targets.open.v1`, try/catch).
- [ ] **Step 5:** editor.tsx `left={<><PropertyEditor ed={ed}/><SystemStatus ed={ed}/><Targets ed={ed}/></>}`,
  left pane title "Properties". Delete `LegacyLeftColumn`'s Scale card, selected-device panel and ScopePanel.
- [ ] **Step 6:** Gates incl. next build; repoint harness strings. **Commit** `feat(grid): Property Editor, System Status and Targets (#299)`.

## Task 10: Right pane tabs + BOM panel

**Files:** Create `workspace/right-pane.tsx`, `workspace/bom-panel.tsx`; Modify `editor.tsx`.

- [ ] **Step 1:** Move the BOM card (editor.tsx ≈1939-2082 incl. `renderBomLine` ≈742-855 and the accessory picker
  state `addingTo`) into `bom-panel.tsx` as `export default function BomPanel({ ed })`. Keep all strings
  (`"+ Add accessory"`, `"<AccessoryPicker"`, `"<LaborLineRow"`, `"<CustomItemsSection"`, `"Quote anyway"`,
  `"runQuote(true)"`, `"disabled={busy || bomEmpty}"`, `"bomGroups("`, the quoteNumbers literal…) byte-identical.
  The toolbar's Add to quotes calls the same `runQuote`; the BOM panel keeps its own quote button too.
- [ ] **Step 2:** `right-pane.tsx`: tab strip (Browser · Layers · Spaces · Wires · BOM · Revisions; 11.5px; active =
  dark underline). Active tab persists in localStorage `pk.grid.rightTab.v1` (try/catch). Tab bodies: Browser
  (Task 11 — placeholder until then: "Browser tree arrives in the next step."), `LayersPanel`, `SpacesPanel`,
  `WiresPanel`, `BomPanel`, `RevisionsPanel` — each with the exact props they get today. When the user selects a
  space on the plan, switch to… nothing (selection shows in the Property Editor; tabs never auto-switch).
- [ ] **Step 3:** editor.tsx `right={<RightPane ed={ed}/>}` (pane title "Browser"); `LegacyLeftColumn` is now empty —
  delete it.
- [ ] **Step 4:** Gates incl. next build. Browser check: every tab works, quote from BOM and toolbar, accessories,
  custom items, labor, revisions restore. **Commit** `feat(grid): right pane tabs + BOM panel (#299 slice 3)`.

---

# Slice 4 — Browser tree + Spreadsheet view

## Task 11: Browser tree

**Files:** Create `src/lib/design/grid-browser-tree.ts`, `workspace/browser-tree.tsx`; test in harness.

**Interfaces — Consumes:** `spaceOf` (grid-geometry.ts:124, `(pl, spaces) => space | null`, smallest area wins),
`GridPlacement`, `GridSpace`, `GridRoute` types (grid-projects.ts), `placementQty` (grid-bom.ts:161).
**Produces:**
```ts
export type TreeKind = "design" | "sheet" | "page" | "space" | "group" | "device" | "wires" | "wire";
export type TreeNode = { key: string; kind: TreeKind; label: string; count?: number; sheetId?: string; page?: number;
  placementIds?: string[]; routeId?: string; spaceId?: string; children?: TreeNode[] };
export function browserTree(i: {
  designName: string;
  sheets: { id: string; name: string }[];
  placements: GridPlacement[];          // already option-sliced
  spaces: GridSpace[];
  routes: GridRoute[];                  // already option-sliced
  nameOf: (pl: GridPlacement) => string; // part desc, or curtain.name
  membersOf: (pl: GridPlacement) => string[]; // assembly member descs ([] for plain parts)
}): TreeNode;
export function nodeForPlacement(tree: TreeNode, placementId: string): string[]; // keys of the path to expand (root → device)
```

Rules: root `{kind:"design", key:"design"}` → one child per sheet that has placements, spaces or routes (in `sheets`
order) → if that sheet has items on more than one page, a `page` level (`Page n`), else skip it → spaces on that
page sorted by name, then a final `"No space"` node (`spaceId` undefined, key suffix `:none`) only if non-empty →
inside each: placements grouped by `nameOf` (sorted by label): a group with one placement is a `device` node directly;
a group with n>1 is `group` `${name} ×${sumQty}` whose children are `device` nodes `${name}` (+ ` ×${qty}` when lot).
A device whose `membersOf` is non-empty gets leaf children (kind "device", label = member desc, no placementIds — they
select their parent). Each sheet/page also gets a `wires` node `Wires (n)` listing `wire` nodes (label = part desc via a
`wireName` field — add `wireName: (r: GridRoute) => string` to the input) when n > 0. Keys: `sheet:<id>`,
`page:<id>:<n>`, `space:<id>`, `none:<sheet>:<page>`, `group:<container key>:<name>`, `pl:<id>`, `member:<pl id>:<i>`,
`wires:<sheet>:<page>`, `wr:<id>`. `count` on sheet/page/space/group = sum of `placementQty` under it.

- [ ] **Step 1: Failing checks**

```ts
/* #299 Grid workspace — Browser tree (Task 11) */
import { browserTree, nodeForPlacement } from "@/lib/design/grid-browser-tree";
{
  const pl = (id: string, partId: string, x: number, extra: Record<string, unknown> = {}) =>
    ({ id, sheetId: "s1", page: 1, x, y: 0.5, partId, by: "t", at: 1, ...extra });
  const sq = (id: string, name: string, x0: number, x1: number) =>
    ({ id, sheetId: "s1", page: 1, name, color: "#000", points: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 1 }, { x: x0, y: 1 }], by: "t", at: 1 });
  const t = browserTree({
    designName: "Lincoln", sheets: [{ id: "s1", name: "Base" }, { id: "s2", name: "Empty" }],
    placements: [pl("a", "S4", 0.1), pl("b", "S4", 0.2, { qty: 3 }), pl("c", "Rack", 0.7), pl("d", "S4", 0.95)] as never,
    spaces: [sq("sp1", "Stage", 0, 0.5), sq("sp2", "House", 0.5, 0.9)] as never,
    routes: [{ id: "w1", sheetId: "s1", page: 1, partId: "cat6", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], aspect: 1, by: "t", at: 1 }] as never,
    nameOf: (p) => ({ S4: "S4 LED", Rack: "12U rack" } as Record<string, string>)[p.partId],
    membersOf: (p) => (p.partId === "Rack" ? ["ERn2", "P-ACP"] : []),
    wireName: () => "Cat6",
  });
  const sheet = t.children!;
  ok(sheet.length === 1 && sheet[0].key === "sheet:s1" && sheet[0].count === 6, "#299 tree: only non-empty sheets; count sums lot qty");
  const kids = sheet[0].children!.map((n) => n.key);
  ok(kids.join(",") === "space:sp2,space:sp1,none:s1:1,wires:s1:1", "#299 tree: spaces by name, then No space, then wires (single page → no page level)");
  const stage = sheet[0].children!.find((n) => n.key === "space:sp1")!;
  ok(stage.children!.length === 1 && stage.children![0].kind === "group" && stage.children![0].label === "S4 LED ×4", "#299 tree: identical parts group with summed qty");
  const house = sheet[0].children!.find((n) => n.key === "space:sp2")!;
  ok(house.children![0].kind === "device" && house.children![0].children!.map((m) => m.label).join(",") === "ERn2,P-ACP", "#299 tree: assembly members as leaves");
  ok(nodeForPlacement(t, "b").join(">") === "design>sheet:s1>space:sp1>group:space:sp1:S4 LED>pl:b", "#299 tree: path to a device");
}
```

- [ ] **Steps 2–4:** fail → implement → pass (+5).
- [ ] **Step 5: `browser-tree.tsx`** — renders the tree (expand state `Set<string>` in component state; default
  expanded: design, sheets, the active sheet's page/spaces). Row = chevron + label + muted count. Click a node with
  `placementIds` (device: `[id]`; group: all) → `ed.switchSheet(sheetId)` (+ page) if needed, then select (`setSelected`
  for one; for a group, select the first until slice 5 makes it a multi-select). Click a wire → `setSelectedRouteId`.
  Click a space → `setSelectedSpaceId`. When `ed.selected` changes, expand `nodeForPlacement(...)` and
  `scrollIntoView({block:"nearest"})` the row; highlight selected rows with the accent wash. `nameOf` = part desc
  (via `partById`) or `curtain.name`; `membersOf` = `assemblyMembers` mapped through `lookById` symbol labels or part
  descs (use whatever the canvas uses to draw assembly children — editor's assembly child rendering).
- [ ] **Step 6:** Plug into the Browser tab. Gates. **Commit** `feat(grid): Browser tree (#299)`.

## Task 12: Spreadsheet view

**Files:** Modify `src/app/(app)/design/grid/[id]/page.tsx`, `use-grid-editor.ts` (prop), create
`workspace/spreadsheet-view.tsx`; extract shared builder.

- [ ] **Step 1:** In `[id]/schedule/page.tsx` the schedule is built at ≈57-70 (`gridPartsFrom(..., {catalogFallback:
  true, deviceTypes})` + `loadVirtualParts` + `riserViewForOption` + `buildSchedule`). Extract those lines into
  `export async function scheduleForOption(project, optionId, …deps)` in a new server module
  `src/lib/design/grid-schedule-server.ts` (no `"use client"`; it may import stores), returning the `buildSchedule`
  result. Make the schedule page call it (behaviour identical).
- [ ] **Step 2:** `page.tsx` (editor) calls `scheduleForOption(project, activeOptionId, …)` and passes
  `schedule={…}` to `GridEditor`; add `schedule: ScheduleResult` (the `buildSchedule` return type — export it from
  grid-schedule.ts if not exported) to `GridEditorProps`.
- [ ] **Step 3:** `spreadsheet-view.tsx` renders the same table the schedule page renders (sections with Code · Desc ·
  Qty, then Wires: From · To · Part · Length) — reuse the schedule page's table JSX by extracting it into
  `src/app/(app)/design/grid/[id]/schedule/schedule-table.tsx` (server-safe, no hooks) and importing it from both.
  Above it: "Open printable schedule →" link to `/schedule?option=`.
- [ ] **Step 4:** Center pane shows `view === "sheet" ? <SpreadsheetView/> : <PlanCanvas/>` (keep PlanCanvas mounted
  but `display:none` when hidden so PDF render state survives — PlanCanvas is not streamed content, this is fine).
- [ ] **Step 5:** Gates incl. next build; `npm run test:smoke` (schedule route still 200 — stop any dev server first).
  **Commit** `feat(grid): Spreadsheet view (#299 slice 4)`.

---

# Slice 5 — Bulk editing

## Task 13: Selection, align and snap rules (pure)

**Files:** Create `src/lib/design/grid-selection.ts`, `grid-align.ts`, `grid-snap.ts`; test in harness.

**Produces:**
```ts
// grid-selection.ts
import type { Point } from "@/lib/annotations";
export type Rect = { x0: number; y0: number; x1: number; y1: number };
export function normRect(a: Point, b: Point): Rect;                 // x0<=x1, y0<=y1
export function idsInRect(items: { id: string; x: number; y: number }[], r: Rect): string[]; // inclusive edges, input order
export function toggleId(sel: readonly string[], id: string): string[];   // add at end or remove
export function marqueeSelection(base: readonly string[], hits: string[], additive: boolean): string[]; // additive → union (base order then new hits); else hits

// grid-align.ts
export type Pos = { id: string; x: number; y: number };
export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export function alignPositions(items: Pos[], mode: AlignMode): Pos[];
export function distributePositions(items: Pos[], axis: "x" | "y"): Pos[];
export function changedMoves(before: Pos[], after: Pos[]): Pos[];  // entries of `after` whose x or y differs by > 1e-9

// grid-snap.ts
import type { MeasureUnit, Point } from "@/lib/annotations";
export const SNAP_SPACINGS_FT = [0.5, 1, 2, 5] as const;
export const SNAP_PLAN_STEP = 0.01;
export const SNAP_ON_KEY = "pk.grid.snap.on.v1"; export const SNAP_FT_KEY = "pk.grid.snap.ft.v1";
export type SnapGrid = { stepX: number; stepY: number; label: string };
export function snapGrid(cal: { scale: number; unit: MeasureUnit } | null | undefined, spacingFt: number, aspect: number): SnapGrid | null;
export function snapPoint(p: Point, g: SnapGrid | null): Point;
export function snapDelta(anchor: Point, to: Point, g: SnapGrid | null): { dx: number; dy: number }; // move so the anchor lands on the grid
export function feetLabel(ft: number): string;   // 0.5 → `6"`, 1 → `1'`, 2 → `2'`, 5 → `5'`
```

Snap rules: calibrated (`scale > 0`, finite) → page width in feet = `scale × FEET[unit]` with
`FEET = { ft: 1, in: 1/12, m: 3.280839895, mm: 0.003280839895 }`; `stepX = spacingFt / pageWidthFt`; if
`stepX < 0.001 || stepX > 0.5` → `null` (too dense or too coarse to be useful); `stepY = stepX / aspect` (aspect ≤ 0
or non-finite → 1); label `feetLabel(spacingFt)`. Uncalibrated → `{ stepX: SNAP_PLAN_STEP, stepY: SNAP_PLAN_STEP /
aspect, label: "1% of sheet" }`. `snapPoint` rounds each axis to the nearest step and clamps to [0,1]; `null` grid →
returns `p` unchanged. `snapDelta` = `snapPoint(to) - anchor` when the grid exists, else `to - anchor`.

- [ ] **Step 1: Failing checks**

```ts
/* #299 Grid workspace — selection, align, snap (Task 13) */
import * as GSEL from "@/lib/design/grid-selection";
import * as GAL from "@/lib/design/grid-align";
import * as GSNAP from "@/lib/design/grid-snap";
{
  const r = GSEL.normRect({ x: 0.6, y: 0.4 }, { x: 0.2, y: 0.1 });
  ok(r.x0 === 0.2 && r.x1 === 0.6 && r.y0 === 0.1 && r.y1 === 0.4, "#299 select: normalized rect");
  ok(GSEL.idsInRect([{ id: "a", x: 0.2, y: 0.1 }, { id: "b", x: 0.7, y: 0.2 }, { id: "c", x: 0.5, y: 0.3 }], r).join(",") === "a,c", "#299 select: inclusive hits");
  ok(GSEL.toggleId(["a", "b"], "a").join(",") === "b" && GSEL.toggleId(["b"], "c").join(",") === "b,c", "#299 select: toggle");
  ok(GSEL.marqueeSelection(["a"], ["b", "a"], true).join(",") === "a,b" && GSEL.marqueeSelection(["a"], ["b"], false).join(",") === "b", "#299 select: additive marquee");

  const pts = [{ id: "a", x: 0.1, y: 0.5 }, { id: "b", x: 0.5, y: 0.2 }, { id: "c", x: 0.3, y: 0.9 }];
  ok(GAL.alignPositions(pts, "left").every((p) => p.x === 0.1), "#299 align: left");
  ok(GAL.alignPositions(pts, "center").every((p) => Math.abs(p.x - 0.3) < 1e-12), "#299 align: center = midpoint of extremes");
  ok(GAL.alignPositions(pts, "bottom").every((p) => p.y === 0.9) && GAL.alignPositions(pts, "bottom")[0].x === 0.1, "#299 align: bottom keeps x");
  const d = GAL.distributePositions(pts, "x");
  ok(d.find((p) => p.id === "c")!.x === 0.3 && d.find((p) => p.id === "a")!.x === 0.1 && d.find((p) => p.id === "b")!.x === 0.5, "#299 align: distribute keeps ends, spaces the middle");
  const d2 = GAL.distributePositions([{ id: "a", x: 0, y: 0 }, { id: "b", x: 0.9, y: 0 }, { id: "c", x: 0.1, y: 0 }], "x");
  ok(Math.abs(d2.find((p) => p.id === "c")!.x - 0.45) < 1e-12, "#299 align: distribute moves the middle item");
  ok(GAL.alignPositions(pts.slice(0, 1), "left")[0].x === 0.1 && GAL.distributePositions(pts.slice(0, 2), "x").length === 2, "#299 align: too few items → unchanged");
  ok(GAL.changedMoves(pts, GAL.alignPositions(pts, "left")).map((p) => p.id).join(",") === "b,c", "#299 align: only changed moves are sent");

  // 1 page width = 100 ft; 1' spacing → 0.01; aspect 0.5 → stepY 0.02
  const g = GSNAP.snapGrid({ scale: 100, unit: "ft" }, 1, 0.5)!;
  ok(Math.abs(g.stepX - 0.01) < 1e-12 && Math.abs(g.stepY - 0.02) < 1e-12 && g.label === "1'", "#299 snap: calibrated step");
  ok(Math.abs(GSNAP.snapGrid({ scale: 1200, unit: "in" }, 1, 1)!.stepX - 0.01) < 1e-12, "#299 snap: inches calibration");
  ok(GSNAP.snapGrid({ scale: 100000, unit: "ft" }, 0.5, 1) === null && GSNAP.snapGrid({ scale: 5, unit: "ft" }, 5, 1) === null, "#299 snap: too dense / too coarse → off");
  ok(GSNAP.snapGrid(null, 1, 2)!.stepY === 0.005 && GSNAP.snapGrid(null, 1, 2)!.label === "1% of sheet", "#299 snap: uncalibrated plan step");
  const sp = GSNAP.snapPoint({ x: 0.0149, y: 0.031 }, g);
  ok(Math.abs(sp.x - 0.01) < 1e-12 && Math.abs(sp.y - 0.04) < 1e-12, "#299 snap: rounds to nearest step");
  ok(GSNAP.snapPoint({ x: 0.999, y: 1 }, g).x <= 1, "#299 snap: clamps");
  const dl = GSNAP.snapDelta({ x: 0.1, y: 0.1 }, { x: 0.1149, y: 0.1 }, g);
  ok(Math.abs(dl.dx - 0.01) < 1e-12 && Math.abs(dl.dy - 0) < 1e-12, "#299 snap: group delta snaps the anchor");
  ok(GSNAP.feetLabel(0.5) === `6"` && GSNAP.feetLabel(5) === `5'`, "#299 snap: labels");
}
```

- [ ] **Steps 2–4:** fail → implement exactly per the rules → pass (+19).
  `distributePositions`: sort a copy by `axis` then id; ends keep their values; item i gets
  `first + (last-first) * i/(n-1)`; return in input order. `alignPositions`: horizontal modes set x to
  min/max/midpoint of extremes; vertical set y; fewer than 2 items → copies unchanged. `distributePositions` with < 3 →
  copies unchanged.
- [ ] **Step 5: Commit** `feat(grid): selection, align and snap rules (#299)`.

## Task 14: Batched move / remove / category / part — store + actions

**Files:** Modify `src/lib/design/grid-riser-doc.ts`, `src/lib/stores/grid-projects.ts`,
`src/app/(app)/design/grid/[id]/actions.ts`; test in harness (pure + scratch-PGlite async suite).

**Produces (riser, pure):**
```ts
export type RiserRemoved = Record<string, { links: RiserLink[]; conduits: RiserConduit[] }>; // keyed by option id (riser map key)
export function riserRemovedBetween(before: Record<string, RiserDoc> | undefined, after: Record<string, RiserDoc> | undefined): RiserRemoved;
  // per key: links/conduits whose id is in before but not after; keys with nothing removed are omitted
export function restoreRiserItems(current: Record<string, RiserDoc> | undefined, removed: RiserRemoved, liveIds: { placementIds: Set<string>; spaceIds: Set<string> }): Record<string, RiserDoc> | undefined;
  // re-adds each removed link/conduit to its key's doc (normalizeRiserDoc first) when its id is absent AND both ends resolve
  // (placement end → id in placementIds; space end → spaceId null or in spaceIds); missing key → creates normalizeRiserDoc(undefined) then adds
```

**Produces (store):**
```ts
export type RemovedBundle = { placements: GridPlacement[]; riser: RiserRemoved };
export type BatchResult<T> = { ok: true; project: GridProject; value: T } | { ok: false; error: string };
export async function movePlacements(projectId: string, moves: { id: string; x: number; y: number }[]): Promise<BatchResult<{ id: string; x: number; y: number }[]>>;
  // value = the PREVIOUS positions (for undo). Clamp01; withoutAuto; route endpoints translate per placement exactly as movePlacement does (same sheet/page rule)
export async function removePlacements(projectId: string, ids: string[]): Promise<BatchResult<RemovedBundle>>;
  // value = removed placement records (as stored, in stored order) + riserRemovedBetween(before, after)
export async function setPlacementsCategory(projectId: string, items: { id: string; category: string }[]): Promise<BatchResult<{ id: string; category: string }[]>>;
  // same trim/40-char/empty-deletes rule as setPlacementCategory; withoutAuto; value = previous categories ("" when none)
export async function setPlacementsPart(projectId: string, items: { id: string; partId: string }[]): Promise<BatchResult<{ id: string; partId: string }[]>>;
  // refuses curtain placements ("Curtains can't change part — edit the curtain instead."); withoutAuto; drops `qty` only if the new part is not the same part; value = previous partIds
```

All four: one `patchDoc`; inside the mutate, first check every id exists (dedupe ids first; empty list → `{ok:false,
error:"Nothing selected."}`); if any is missing, set a `refusal` string `"<n> item(s) are no longer on this design —
reload and try again."` and return without mutating (do not touch `updatedAt`); the function returns
`{ok:false, error: refusal}`. Cap: more than 2,000 ids → refuse "Select fewer than 2,000 items.". Compute the
returned `value` inside the mutate from the pre-mutation state (that is the authoritative "before").

**Produces (actions, `"use server"` file):**
```ts
export async function movePlacementsAction(projectId: string, moves: { id: string; x: number; y: number }[]): Promise<{ ok: true; previous: { id: string; x: number; y: number }[] } | { ok: false; error: string }>;
export async function removePlacementsAction(projectId: string, ids: string[]): Promise<{ ok: true; removed: RemovedBundle } | { ok: false; error: string }>;
export async function setPlacementsCategoryAction(projectId: string, items: { id: string; category: string }[]): Promise<{ ok: true; previous: { id: string; category: string }[] } | { ok: false; error: string }>;
export async function replacePlacementsPartAction(projectId: string, items: { id: string; partId: string }[]): Promise<{ ok: true; previous: { id: string; partId: string }[] } | { ok: false; error: string }>;
```
Each: `await requireUser()`; validate input shape (arrays, strings, finite numbers — reject with "That edit isn't
valid — reload and try again."); for replace, every distinct new partId must resolve via the same `partForGrid` the
route action uses (refuse "That part is not in the Grid library."); call the store; `revalidatePath(editorPath(projectId))`
(+ riser path for remove/replace, as `removePlacementAction`'s sibling actions do).

- [ ] **Step 1: Failing pure checks (riser)**

```ts
/* #299 Grid workspace — riser removed/restore (Task 14) */
import { riserRemovedBetween, restoreRiserItems, normalizeRiserDoc } from "@/lib/design/grid-riser-doc";
{
  const end = (placementId: string) => ({ kind: "placement" as const, placementId });
  const lk = (id: string, a: string, b: string) => ({ id, from: end(a), to: end(b), partId: "cat6", lengthFt: 10, by: "t", at: 1 });
  const before = { "opt-base": { ...normalizeRiserDoc(undefined), links: [lk("lk-1", "gp-a", "gp-b"), lk("lk-2", "gp-c", "gp-d")] } };
  const after = { "opt-base": { ...normalizeRiserDoc(undefined), links: [lk("lk-2", "gp-c", "gp-d")] } };
  const removed = riserRemovedBetween(before, after);
  ok(removed["opt-base"].links.map((l) => l.id).join(",") === "lk-1" && removed["opt-base"].conduits.length === 0, "#299 riser: removed links found");
  ok(Object.keys(riserRemovedBetween(after, after)).length === 0, "#299 riser: nothing removed → empty");
  const live = { placementIds: new Set(["gp-a", "gp-b", "gp-c", "gp-d"]), spaceIds: new Set<string>() };
  const back = restoreRiserItems(after, removed, live)!;
  ok(back["opt-base"].links.map((l) => l.id).sort().join(",") === "lk-1,lk-2", "#299 riser: restore re-adds the link");
  ok(restoreRiserItems(back, removed, live)!["opt-base"].links.length === 2, "#299 riser: restore is idempotent by id");
  const half = { placementIds: new Set(["gp-a"]), spaceIds: new Set<string>() };
  ok(restoreRiserItems(after, removed, half)!["opt-base"].links.length === 1, "#299 riser: a link whose end is gone stays out");
}
```

Run → fail; implement in grid-riser-doc.ts; run → pass (+5).

- [ ] **Step 2: Failing store checks** — new async suite (follow `gridAccessoriesAsyncChecks230` at harness ≈23622
  for imports, `fixtureId`, `registerFixture`, `GP.createProject`). Wire it into the chain after the last
  `.then(() => mfrAnalyticsLoadAsyncChecks())` line: `.then(() => gridBatchAsyncChecks299())`.

```ts
async function gridBatchAsyncChecks299(): Promise<void> {
  const GP = await import("../src/lib/stores/grid-projects");
  const { fixtureId, registerFixture } = await import("./test-fixtures");
  const { DEFAULT_OPTION_ID } = await import("../src/lib/design/grid-options");
  // Create a project the same way gridAccessoriesAsyncChecks230 does (copy its createProject call + registerFixture).
  const gp = await GP.createProject({ /* copy the minimal input used at ≈23622 */ } as never);
  registerFixture("grid_projects", gp.id);
  const sheetId = "gs-fixture299";
  const add = async (x: number, y: number) => (await GP.addPlacement(gp.id, { sheetId, page: 1, x, y, partId: fixtureId(299, "part"), optionId: DEFAULT_OPTION_ID, by: "t" } as never))!;
  await add(0.1, 0.1); await add(0.2, 0.2); await add(0.3, 0.3);
  let p = (await GP.getProject(gp.id))!;
  const [a, b, c] = p.placements.slice(-3);

  const mv = await GP.movePlacements(gp.id, [{ id: a.id, x: 0.5, y: 0.5 }, { id: b.id, x: 1.4, y: -1 }]);
  p = (await GP.getProject(gp.id))!;
  const pa = p.placements.find((x) => x.id === a.id)!, pb = p.placements.find((x) => x.id === b.id)!;
  ok(mv.ok && pa.x === 0.5 && pb.x === 1 && pb.y === 0, "#299 batch: move applies + clamps");
  ok(mv.ok && mv.value.find((m) => m.id === a.id)!.x === 0.1, "#299 batch: move returns previous positions");

  const bad = await GP.movePlacements(gp.id, [{ id: a.id, x: 0.9, y: 0.9 }, { id: "gp-nope", x: 0, y: 0 }]);
  ok(!bad.ok && (await GP.getProject(gp.id))!.placements.find((x) => x.id === a.id)!.x === 0.5, "#299 batch: a missing id refuses the whole move");

  const cat = await GP.setPlacementsCategory(gp.id, [{ id: a.id, category: "  FOH  " }, { id: b.id, category: "" }]);
  p = (await GP.getProject(gp.id))!;
  ok(cat.ok && p.placements.find((x) => x.id === a.id)!.category === "FOH" && !("category" in p.placements.find((x) => x.id === b.id)!), "#299 batch: category trim + clear");

  const rm = await GP.removePlacements(gp.id, [a.id, c.id]);
  p = (await GP.getProject(gp.id))!;
  ok(rm.ok && rm.value.placements.map((x) => x.id).join(",") === [a.id, c.id].join(",") && !p.placements.some((x) => x.id === a.id || x.id === c.id), "#299 batch: remove returns the records it removed");
  ok(!(await GP.removePlacements(gp.id, [])).ok, "#299 batch: empty selection refused");
}
```

  Run → fail; implement the four store functions; run → pass (+7).
- [ ] **Step 3:** Implement the four actions. Add a source-text check that each action calls `requireUser()` and
  `revalidatePath(` (read actions.ts, slice each function body by `indexOf("export async function <name>")` up to the
  next `"export async function"`):

```ts
{
  const src = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/actions.ts"), "utf8");
  const body = (name: string) => { const i = src.indexOf(`export async function ${name}(`); const j = src.indexOf("export async function", i + 10); return src.slice(i, j < 0 ? undefined : j); };
  for (const n of ["movePlacementsAction", "removePlacementsAction", "setPlacementsCategoryAction", "replacePlacementsPartAction"])
    ok(body(n).includes("requireUser()") && body(n).includes("revalidatePath("), `#299 actions: ${n} is authed and revalidates`);
}
```

  (+4). (`readFileSync`/`join` are already imported at the harness top — check; if not, use the import the other
  source-text checks use.)
- [ ] **Step 4:** Gates. **Commit** `feat(grid): batched move/remove/category/part actions (#299)`.

## Task 15: Multi-select on the canvas

**Files:** Modify `use-grid-editor.ts`, `plan-canvas.tsx`, `workspace/browser-tree.tsx`, `workspace/status-bar.tsx`.

**Interfaces — hook changes:**
```ts
selectedIds: string[]; setSelectedIds(ids: string[]): void;
// `selected` (string | null) stays as a DERIVED value: selectedIds.length === 1 ? selectedIds[0] : null
// keep a `setSelected(id: string | null)` wrapper → setSelectedIds(id ? [id] : []) so existing call sites compile
selectedPlacements: GridPlacement[];   // visible placements in selectedIds, in selectedIds order
marquee: Rect | null;
```

- [ ] **Step 1:** Replace `useState<string|null>` selection with `selectedIds`; derive `selected`; update
  `selectedPlacement` to use the derived `selected`.
- [ ] **Step 2: Marquee.** In `onDown` (select tool, no armed part/curtain/drawing): if the hit-test finds no marker
  and no route, and the click is not inside a space's selection hit (keep the existing "select the space under the
  point" behaviour **only for a click without drag**): start `marquee` at `p` (store start in a ref). `onMove`: when
  the pointer has moved ≥ `DRAG_PX` screen px, update `marquee = normRect(start, p)`. `onUp`: if a marquee was drawn,
  `setSelectedIds(marqueeSelection(selectedIds, idsInRect(visible sheetPlacements (positions via shownAt), marquee),
  e.shiftKey))` and clear space/route selection; if it never grew past DRAG_PX, fall back to today's click behaviour
  (select space under point / clear selection). Render the marquee in the SVG overlay as a rect with
  `fill: color-mix(in srgb, var(--accent) 10%, transparent)`, `stroke: var(--accent)`, `strokeDasharray: "4 3"`.
- [ ] **Step 3: Shift-click** a marker → `toggleId(selectedIds, id)` (no drag starts on a shift-click). Plain click on
  an unselected marker → `[id]`; plain click on an already-selected marker keeps the whole selection (so a group drag
  can start).
- [ ] **Step 4: Group drag.** `MarkerDrag` gains `ids: string[]` (the selection when the drag started, or `[id]`).
  The live offset for every id in `ids` is the dragged marker's delta (in `placementOffsets` apply `drag.dx/dy` to all
  `ids`). On release with movement: build `moves` for all ids (`shownAt(pl) + delta`, clamp01) and call a new hook
  function `commitMoves(moves)` → optimistic `movedLocal` for all, then `movePlacementsAction`; on failure roll back
  all entries and set `err`; on success `router.refresh()` and return `previous` (slice 6 records it for undo). Keep
  single-item drags going through `commitMoves` too (one code path), but leave `commitMove` + `movePlacementAction`
  in place if other code calls them (grep); harness strings that mention `movePlacementAction` stay true.
- [ ] **Step 5: Nudge** moves every selected placement (same debounce; one `commitMoves` call).
- [ ] **Step 6: ⌘A / Ctrl+A** (canvas focused — i.e., the keydown guard passes and the target is not an input) →
  `setSelectedIds(visiblePlacements on this sheet/page).map(id)`; prevent default. Escape clears.
- [ ] **Step 7: Selection ring** for every selected id (the dashed ring at plan-canvas ≈2377 rendered for all
  `selectedIds`). Status bar shows `Selected: n` when n > 1. Browser tree: a group click selects all its
  `placementIds`; rows of all selected ids highlight; Shift-click a device row toggles it.
- [ ] **Step 8:** Gates incl. next build. Browser: marquee, shift marquee, shift click, group drag, nudge group,
  ⌘A, Esc, tree group select. **Commit** `feat(grid): multi-select, marquee and group move (#299)`.

## Task 16: Bulk actions, align/distribute toolbar, bulk Property Editor

**Files:** Modify `workspace/property-editor.tsx`, `workspace/toolbar.tsx`, `use-grid-editor.ts`.

**Hook additions:**
```ts
removeSelected(): Promise<RemovedBundle | null>;          // removePlacementsAction(selectedIds) → clear selection, refresh, noteAction
alignSelected(mode: AlignMode): Promise<void>;           // positions via shownAt; changedMoves(before, alignPositions(...)) → commitMoves
distributeSelected(axis: "x" | "y"): Promise<void>;
setCategoryForSelected(category: string): Promise<void>;
replacePartForSelected(partId: string): Promise<void>;   // non-curtain selections only
```
Each returns early with no call when nothing changes. Single-device Remove/Delete key now route through
`removeSelected` (one code path). Keep `removePlacementAction` exported for other callers.

- [ ] **Step 1:** Property Editor "Several" mode: header `"<n> devices"` (or `"<n> items"` when curtains are mixed in),
  rows: Parts (`same` → the desc, else `"<k> different"`), Scope (same/mixed), Space (same/mixed via `spaceOf`), Sell
  total, Category (input with datalist of existing categories; Apply → `setCategoryForSelected`), **Replace part…**
  (opens a compact search popover reusing `paletteView` with tab "all" and the selection's scope pre-filled; pick →
  confirm "Replace <n> devices with <desc>?" inline → `replacePartForSelected`; hidden when any curtain is selected),
  **Delete <n>** (ConfirmButton-style two-step).
- [ ] **Step 2:** Toolbar Arrange group enabled: align ×6 when `selectedIds.length >= 2`, distribute ×2 when `>= 3`
  (tooltip otherwise "Select 2 or more devices" / "Select 3 or more devices"). Delete button → `removeSelected`.
- [ ] **Step 3:** Gates. Browser: align left/center/…; distribute; set category on 5; replace part on 3; delete 4.
  **Commit** `feat(grid): bulk delete, category, replace part and align/distribute (#299)`.

## Task 17: Snap to grid option

**Files:** Modify `use-grid-editor.ts`, `workspace/toolbar.tsx`, `plan-canvas.tsx`, `workspace/status-bar.tsx`.

- [ ] **Step 1:** Hook state `snapOn` (default false), `snapFt` (default 1), applied from localStorage on mount
  (`SNAP_ON_KEY` "1"/"0", `SNAP_FT_KEY` one of `SNAP_SPACINGS_FT` else 1; try/catch), saved on change.
  `snap = snapOn ? snapGrid(cal, snapFt, aspect) : null`.
- [ ] **Step 2:** Apply: `placeAt` → `snapPoint(at, snap)`; curtain drop point → snapped; group drag release and live
  preview → `snapDelta(anchorStart, anchorNow, snap)` applied to all; nudge with snap on → step = `snap.stepX` /
  `snap.stepY` instead of NUDGE (Shift = 5 steps); paste (Task 20) → `snapDelta` on the anchor.
- [ ] **Step 3:** Toolbar: a toggle button "Snap" (pressed state) + a compact `<select>` of spacings labelled with
  `feetLabel` (disabled with tooltip "Calibrate the page to snap in feet" when uncalibrated — the toggle still works
  with the plan step). When `snapOn && snapGrid(...) === null` for a calibrated page (too dense/coarse), show the
  status bar text `Snap: too fine at this scale` and treat as off.
- [ ] **Step 4:** Dot grid: when snap is on, the plan wrapper gets a CSS background dot pattern sized to the step:
  `backgroundImage: "radial-gradient(rgba(0,0,0,.28) 1px, transparent 1.2px)"`, `backgroundSize: \`${snap.stepX*W}px ${snap.stepY*H}px\``
  where W/H are the rendered plan box pixel size (from the wrapper's `getBoundingClientRect`, updated on zoom/size);
  skip the pattern when a step renders under 6px (too dense to read). Draw it on an absolutely positioned div above
  the sheet image and below the SVG overlay, `pointerEvents: "none"`.
- [ ] **Step 5:** Status bar `Snap: off` / `Snap: 1'` / `Snap: 1% of sheet`.
- [ ] **Step 6:** Gates. Browser: snap on uncalibrated + calibrated, place/drag/nudge land on dots, reload keeps
  setting. **Commit** `feat(grid): snap to grid option (#299 slice 5)`.

---

# Slice 6 — Clipboard + undo

## Task 18: Undo stack + clipboard rules (pure)

**Files:** Create `src/lib/design/grid-undo.ts`, `src/lib/design/grid-clipboard.ts`; test in harness.

**Produces (`grid-undo.ts`):**
```ts
import type { RemovedBundle } from "@/lib/stores/grid-projects"; // type-only import is fine for a pure module
export type GridCommand =
  | { kind: "move"; moves: { id: string; x: number; y: number }[] }
  | { kind: "remove"; ids: string[] }
  | { kind: "restore"; bundle: RemovedBundle }
  | { kind: "category"; items: { id: string; category: string }[] }
  | { kind: "part"; items: { id: string; partId: string }[] };
export type UndoEntry = { label: string; forward: GridCommand; inverse: GridCommand };
export type UndoState = { past: UndoEntry[]; future: UndoEntry[] };
export const UNDO_CAP = 100;
export const emptyUndo: () => UndoState;
export function pushUndo(s: UndoState, e: UndoEntry): UndoState;        // append; drop oldest past UNDO_CAP; clear future
export function takeUndo(s: UndoState): { entry: UndoEntry; next: UndoState } | null;   // pops past → future (front)
export function takeRedo(s: UndoState): { entry: UndoEntry; next: UndoState } | null;   // pops future front → past
export function withRefreshedRestore(e: UndoEntry, bundle: RemovedBundle, side: "forward" | "inverse"): UndoEntry;
  // after redoing a delete, the server returns a fresh bundle — store it on the given side so the next undo restores the latest records
```
(Note: a "remove" command's ids are the ids to remove; its result bundle replaces the paired "restore" bundle via
`withRefreshedRestore`.)

**Produces (`grid-clipboard.ts`):**
```ts
import type { Point } from "@/lib/annotations";
import type { GridPlacement, GridRoute } from "@/lib/stores/grid-projects";
export type ClipItem = { srcId: string; dx: number; dy: number; partId: string; category?: string; curtain?: GridPlacement["curtain"]; qty?: number };
export type Clipboard = { items: ClipItem[]; routeIds: string[]; sourceProjectId: string; sourceSheetId: string; sourcePage: number };
export const PASTE_OFFSET = 0.015;
export function copySelection(projectId: string, placements: GridPlacement[], routes: GridRoute[], ids: string[]): Clipboard | null;
  // null when no id resolves; dx/dy relative to the bbox top-left of the copied set; routeIds = routes whose fromPlacementId AND toPlacementId are both copied
  // auto/autoOrigin/seededFrom/optionId/by/at never copied
export function pasteLayout(clip: Clipboard, at: Point | null, last: Point | null): { anchor: Point; items: (ClipItem & { x: number; y: number })[] };
  // anchor = at ?? (last ? last + PASTE_OFFSET : bbox origin + PASTE_OFFSET is not known — use { x: 0.5 - w/2, y: 0.5 - h/2 } when both null)
  // then shift the anchor so every item stays within [0,1] (group width/height = max dx/dy); x = anchor.x + dx, y = anchor.y + dy
```

- [ ] **Step 1: Failing checks**

```ts
/* #299 Grid workspace — undo + clipboard (Task 18) */
import * as GU from "@/lib/design/grid-undo";
import * as GCLIP from "@/lib/design/grid-clipboard";
{
  const e = (n: number): GU.UndoEntry => ({ label: `e${n}`, forward: { kind: "remove", ids: [`x${n}`] }, inverse: { kind: "remove", ids: [`y${n}`] } });
  let s = GU.emptyUndo();
  s = GU.pushUndo(s, e(1)); s = GU.pushUndo(s, e(2));
  const u = GU.takeUndo(s)!;
  ok(u.entry.label === "e2" && u.next.past.length === 1 && u.next.future[0].label === "e2", "#299 undo: undo moves the last entry to redo");
  const r = GU.takeRedo(u.next)!;
  ok(r.entry.label === "e2" && r.next.past.length === 2 && r.next.future.length === 0, "#299 undo: redo moves it back");
  ok(GU.pushUndo(u.next, e(3)).future.length === 0, "#299 undo: a new edit clears redo");
  let big = GU.emptyUndo(); for (let i = 0; i < 105; i++) big = GU.pushUndo(big, e(i));
  ok(big.past.length === GU.UNDO_CAP && big.past[0].label === "e5", "#299 undo: capped at 100, oldest dropped");
  ok(GU.takeUndo(GU.emptyUndo()) === null && GU.takeRedo(GU.emptyUndo()) === null, "#299 undo: empty stacks");
  const bundle = { placements: [], riser: {} };
  ok(GU.withRefreshedRestore({ label: "d", forward: { kind: "remove", ids: ["a"] }, inverse: { kind: "restore", bundle: { placements: [{ id: "old" }] as never, riser: {} } } }, bundle, "inverse").inverse.kind === "restore", "#299 undo: refreshed restore bundle");

  const P = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, sheetId: "s", page: 1, x, y, partId: "p", by: "t", at: 1, ...extra });
  const pls = [P("a", 0.2, 0.2, { auto: { scope: "Lighting", rowKey: "k", tier: "good" }, category: "FOH" }), P("b", 0.3, 0.25, { qty: 4 }), P("c", 0.9, 0.9)] as never;
  const routes = [{ id: "w1", fromPlacementId: "a", toPlacementId: "b" }, { id: "w2", fromPlacementId: "a", toPlacementId: "c" }] as never;
  const clip = GCLIP.copySelection("GRD-1", pls, routes, ["a", "b", "zz"])!;
  ok(clip.items.length === 2 && clip.routeIds.join(",") === "w1", "#299 clip: copies the set and only wires with both ends inside");
  const ia = clip.items.find((i) => i.srcId === "a")!;
  ok(ia.dx === 0 && ia.dy === 0 && Math.abs(clip.items.find((i) => i.srcId === "b")!.dx - 0.1) < 1e-12 && ia.category === "FOH" && !("auto" in ia), "#299 clip: relative offsets, no auto tag");
  ok(clip.items.find((i) => i.srcId === "b")!.qty === 4, "#299 clip: lot qty kept");
  ok(GCLIP.copySelection("GRD-1", pls, routes, ["zz"]) === null, "#299 clip: nothing resolvable → null");
  const at = GCLIP.pasteLayout(clip, { x: 0.5, y: 0.5 }, null);
  ok(Math.abs(at.items.find((i) => i.srcId === "b")!.x - 0.6) < 1e-12, "#299 clip: paste at cursor keeps layout");
  const edge = GCLIP.pasteLayout(clip, { x: 0.97, y: 0.99 }, null);
  ok(edge.items.every((i) => i.x <= 1 && i.y <= 1) && Math.abs(edge.anchor.x - 0.9) < 1e-12, "#299 clip: shifted to stay on the sheet");
  const again = GCLIP.pasteLayout(clip, null, { x: 0.2, y: 0.2 });
  ok(Math.abs(again.anchor.x - 0.215) < 1e-12, "#299 clip: off-plan paste offsets from the last paste");
}
```

- [ ] **Steps 2–4:** fail → implement → pass (+13). **Step 5: Commit** `feat(grid): undo stack and clipboard rules (#299)`.

## Task 19: Paste + restore — store, actions, curtain helper, place returns id

**Files:** Create `src/lib/design/grid-curtain-input.ts`; Modify `grid-projects.ts`, `actions.ts`; harness.

**Produces:**
```ts
// grid-curtain-input.ts (server-only; NOT "use server" — it's a helper module)
export type CurtainInput = { type: string; name: string; widthFt: number; heightFt: number; fullnessPct: number; fabricSku: string; color?: string; specKey?: string; topFinish?: string; bottomFinish?: string; mountType?: string };
export async function checkCurtainInput(c: CurtainInput): Promise<{ ok: true; curtain: GridCurtain } | { ok: false; error: string }>;
  // EXACTLY the checks + normalisation now inline in placeCurtainAction (actions.ts ≈539-571, incl. MAX_CURTAIN_FT, GRID_FULLNESS,
  // getPart/isFabricRow, cleanCurtainFinishes); placeCurtainAction is rewritten to call it — behaviour identical.

// grid-projects.ts
export async function pastePlacements(projectId: string, input: {
  sheetId: string; page: number; optionId: string; by: string;
  items: { srcId: string; x: number; y: number; partId: string; category?: string; curtain?: GridCurtain; qty?: number }[];
  routeIds: string[];  // copied from the stored routes by id; skipped unless both ends were pasted AND target page calibrated
}): Promise<BatchResult<{ placements: GridPlacement[]; routes: GridRoute[]; skippedWires: number }>>;
  // new ids via rid("gp-")/rid("wr-"); clamp01; category trimmed ≤40; lotAndTag(qty, undefined); never auto/autoOrigin/seededFrom;
  // route copy: same partId/connectionType/aspect, new optionId, from/to remapped srcId→new id, points translated by the
  // delta of its FROM endpoint device (new x/y − source x/y; source = the stored placement or, if gone (cut), the clip's
  // relative layout can't be used — then skip that wire and count it in skippedWires), sheetId/page = target.
  // refuse when the option doesn't exist (OPTION_GONE copy) or items is empty or > 2,000.
export async function restoreItems(projectId: string, bundle: RemovedBundle): Promise<BatchResult<{ ids: string[] }>>;
  // refuse if ANY placement id already exists ("Couldn't undo — the design changed."), or its option no longer exists;
  // else append the records as-is (they were server-sanitized when stored), then p.riser = restoreRiserItems(p.riser, bundle.riser, live ids)
```

Actions:
```ts
export async function pastePlacementsAction(projectId: string, input: { sheetId: string; page: number; optionId: string;
  items: { srcId: string; x: number; y: number; partId: string; category?: string; curtain?: CurtainInput; qty?: number }[]; routeIds: string[] }):
  Promise<{ ok: true; placements: GridPlacement[]; skippedWires: number } | { ok: false; error: string }>;
  // validates shapes; every non-curtain partId resolves via partForGrid; every curtain via checkCurtainInput; then the store
export async function restoreItemsAction(projectId: string, bundle: RemovedBundle): Promise<{ ok: true } | { ok: false; error: string }>;
  // restore is ONLY for undo: re-validate each record's shape (id matches /^gp-[0-9a-f]{12}$/, finite x/y, page int ≥1,
  // sheetId string, partId string ≤ 120, curtain via checkCurtainInput when present) — a tampered bundle must not plant arbitrary data
```
Also: `placeDeviceAction` and `placeCurtainAction` success results gain `placement: GridPlacement` (the record
`addPlacement` / `addCurtainPlacement` returned — read it from the returned project as the last placement with the
matching id; change those store functions to also return the new id if needed **without changing their existing
return type for other callers**: add sibling functions or read `p.placements.at(-1)`). Update the `Result` usage only
for these two actions (`{ ok: true; placement: GridPlacement } | { ok: false; error }`) and fix their call sites.

- [ ] **Step 1: Failing checks** — extend `gridBatchAsyncChecks299` (or a sibling `gridPasteAsyncChecks299` chained
  right after it):

```ts
async function gridPasteAsyncChecks299(): Promise<void> {
  const GP = await import("../src/lib/stores/grid-projects");
  const { fixtureId, registerFixture } = await import("./test-fixtures");
  const { DEFAULT_OPTION_ID } = await import("../src/lib/design/grid-options");
  const gp = await GP.createProject({ /* same minimal input as gridBatchAsyncChecks299 */ } as never);
  registerFixture("grid_projects", gp.id);
  const sheetId = "gs-fixture299p";
  await GP.addPlacement(gp.id, { sheetId, page: 1, x: 0.1, y: 0.1, partId: fixtureId(299, "part"), optionId: DEFAULT_OPTION_ID, by: "t" } as never);
  const src = (await GP.getProject(gp.id))!.placements.at(-1)!;

  const pasted = await GP.pastePlacements(gp.id, { sheetId, page: 1, optionId: DEFAULT_OPTION_ID, by: "t",
    items: [{ srcId: src.id, x: 0.4, y: 0.4, partId: src.partId, category: " Pasted ", qty: 3 }], routeIds: [] });
  ok(pasted.ok && pasted.value.placements.length === 1 && pasted.value.placements[0].id !== src.id && pasted.value.placements[0].category === "Pasted" && pasted.value.placements[0].qty === 3, "#299 paste: new id, trimmed category, lot qty");
  ok(pasted.ok && !("auto" in pasted.value.placements[0]), "#299 paste: never auto-tagged");

  const rm = await GP.removePlacements(gp.id, [src.id]);
  ok(rm.ok, "#299 restore: setup removed");
  const back = await GP.restoreItems(gp.id, rm.ok ? rm.value : { placements: [], riser: {} });
  const after = (await GP.getProject(gp.id))!;
  ok(back.ok && after.placements.some((p) => p.id === src.id && p.x === 0.1), "#299 restore: record back with its original id");
  ok(!(await GP.restoreItems(gp.id, rm.ok ? rm.value : { placements: [], riser: {} })).ok, "#299 restore: refuses when the id already exists");
}
```

  Chain `.then(() => gridPasteAsyncChecks299())`. Also a riser round-trip check: create a riser link between two
  placements (use the store's riser op function — grep `applyRiserOp\|saveRiser` in grid-projects.ts — or set
  `p.riser` via `patchDoc` in the test), remove one placement with `removePlacements`, `restoreItems` the bundle, and
  assert the link is back (+1). Plus a source-text check that `restoreItemsAction` and `pastePlacementsAction` call
  `requireUser()` and that `placeCurtainAction` calls `checkCurtainInput(` (+3).
- [ ] **Step 2–4:** fail → implement → pass (+8 total). Existing curtain checks in the harness must still pass
  (`placeCurtainAction` behaviour identical).
- [ ] **Step 5: Commit** `feat(grid): paste and restore actions, shared curtain validation (#299)`.

## Task 20: Clipboard UI

**Files:** Modify `use-grid-editor.ts`, `workspace/toolbar.tsx`.

**Hook additions:**
```ts
clipboard: Clipboard | null;          // useRef-backed state; survives option/sheet switches within the tab
lastPaste: Point | null;
copySelected(): void;                 // copySelection(project.id, placements (option slice), routes, selectedIds); noteAction("Copied n")
cutSelected(): Promise<void>;         // copySelected() then removeSelected() (undo entry labelled "Cut n")
paste(): Promise<void>;               // pasteLayout(clip, cursorAt, lastPaste) → snapDelta on anchor when snap on → pastePlacementsAction(
                                      //   { sheetId: active sheet, page, optionId: activeOptionId, items, routeIds: same sheet/page as source ? clip.routeIds : [] })
                                      // → select the new ids; lastPaste = anchor; note "Pasted n" (+ " · k wires skipped" when skippedWires)
duplicate(): Promise<void>;           // copySelected() + paste() with at = null and last = current selection bbox origin
```
Keyboard (same guards; with meta OR ctrl): `c` copy, `x` cut, `v` paste, `d` duplicate (preventDefault — browser
bookmark). Toolbar Cut/Copy/Paste/Duplicate enabled accordingly (Paste enabled when `clipboard` set). Curtains in the
clip send their full curtain fields as `CurtainInput`.

- [ ] Gates incl. next build. Browser: copy 3 → paste at cursor, paste again (offset), paste onto another sheet,
  paste into another option, duplicate, cut+paste, wires copied when both ends selected. **Commit**
  `feat(grid): copy, cut, paste and duplicate (#299)`.

## Task 21: Undo / redo

**Files:** Modify `use-grid-editor.ts`, `workspace/toolbar.tsx`, `workspace/status-bar.tsx`.

**Hook additions:**
```ts
undoState: UndoState; canUndo: boolean; canRedo: boolean;
undo(): Promise<void>; redo(): Promise<void>;
record(e: UndoEntry): void;   // pushUndo
runCommand(c: GridCommand): Promise<{ ok: true; bundle?: RemovedBundle } | { ok: false; error: string }>;
  // move → movePlacementsAction; remove → removePlacementsAction (returns bundle); restore → restoreItemsAction;
  // category → setPlacementsCategoryAction; part → replacePlacementsPartAction; then router.refresh()
```

Recording (exact):
- `commitMoves` success → `record({label:"Move n", forward:{kind:"move", moves}, inverse:{kind:"move", moves: previous}})`
  (align/distribute/nudge/drag all flow through `commitMoves`; label "Align n" / "Distribute n" / "Nudge n" via a
  label argument).
- `placeAt` success (single place) and curtain drop → `{label:"Place <desc>", forward:{kind:"restore", bundle:{placements:[placement], riser:{}}}, inverse:{kind:"remove", ids:[placement.id]}}`.
- `paste`/`duplicate` → same shape with all pasted placements (routes created by paste are not undone in v1 — they
  stay; document in DECISIONS).
- `removeSelected`/`cut` → `{label:"Delete n", forward:{kind:"remove", ids}, inverse:{kind:"restore", bundle}}`.
- category/part → previous values as inverse.

Undo: `takeUndo` → `runCommand(entry.inverse)`; ok → commit `next` (if the command returned a bundle, use
`withRefreshedRestore`); fail → set `err` "Couldn't undo — the design changed." and **clear the stack**
(`emptyUndo()`). Redo symmetric with `entry.forward` (a redo of a delete returns a fresh bundle → refresh the
inverse). Busy guard: ignore undo/redo while `busy`. Keyboard ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redo
(same input guards — inside an input, the browser's own text undo wins). Toolbar Undo/Redo tooltips name the step
("Undo Move 3"). Not-undoable actions (Auto fill / Change equipment / sheet upload+delete / calibration / option
add+delete / space+wire edits / revision restore) **clear the stack** when they succeed (their effects can collide
with recorded ids) and their buttons' tooltips end with " — not undoable; use Revisions" where they live in the toolbar
/ menus. Switching option does not clear the stack.

- [ ] Gates incl. next build. Browser: place → undo → redo; drag group → undo; align → undo; delete 3 → undo (ids
  back, riser link back) → redo; paste → undo; category → undo; replace part → undo; Auto fill clears the stack; a
  stale undo (delete a device in a second tab, then undo a move of it here) shows the message and clears. **Commit**
  `feat(grid): undo and redo (#299 slice 6)`.

---

# Wrap-up

## Task 22: Docs, full gates, browser verification

**Files:** Modify `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (Phase status), plan/spec status lines.

- [ ] **Step 1: Renumber check.** `git fetch -q origin && git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | tail -1`
  and the last `## <n>.` in PUNCHLIST.md — if origin/main moved past D594 / #298, renumber everything in this branch
  (spec, plan, harness labels say "#299" — change if needed).
- [ ] **Step 2: DECISIONS.md** — append (format: `## Dnnn. Title (#299, 2026-10-04)` + short paragraphs, matching
  D594's style):
  - D595 Fixed docked shell, not a docking library (spec Approach A; why).
  - D596 One tool at a time (`enterTool` clears every mode; fixes armPart leaving calibrate on).
  - D597 Bulk edits are Set category / Replace part — layer and space are computed, never stored.
  - D598 Batched actions are all-or-nothing in one patchDoc; ids missing → refuse; 2,000-item cap.
  - D599 Undo is client-side per tab (cap 100); conflict clears the stack; not-undoable actions clear it; undoing a
    move doesn't restore the auto tag; pasted wires aren't removed by undoing the paste.
  - D600 Snap to grid is a viewer option (off by default), applied client-side; storage unchanged; too-fine/coarse
    grids switch off.
  - D601 Paste re-validates curtains with the shared `checkCurtainInput`; wires copy only when both ends are pasted on
    the same sheet/page and the target page is calibrated; restore validates the bundle's shape.
  - D602 Spreadsheet view is server-built with the schedule page's own inputs (`scheduleForOption`).
- [ ] **Step 3: PUNCHLIST.md** — append `## 299. Design — The Grid as a DaVinci-style workspace (docked panes, Product
  Library, Property Editor, Browser tree, multi-select, snap, copy/paste, undo) — DONE 2026-10-04 (D595–D602)` with
  Ask / What shipped / Rollback (safe: no migration, no schema change; new actions unused by old code; the
  `placeDeviceAction` result gained a field — old clients ignore it) / Jeff-gated: none.
- [ ] **Step 4: AGENTS.md** — add phase-status item `38. ✅ **The Grid workspace** (#299, D595–D602) — …` (2–4
  lines, same voice as items 35–37).
- [ ] **Step 5: Full gates** — tsc; `npm run test:specs` (record PASS count = baseline + all new checks: 9+9+8+6+5+19+
  5+7+4+13+8 = 93, plus any repointed checks unchanged); eslint vs. baseline; `npx next build`; `npm run test:smoke`
  (no dev server running). Clean temp datadirs afterwards (`df -h .`).
- [ ] **Step 6: Browser verification on a scratch datadir.** Per memory, `preview_start` reads the **main checkout's**
  `.claude/launch.json` — add a temporary entry there:
  `{ "name": "grid-299", "runtimeExecutable": "bash", "runtimeArgs": ["-lc", "cd /Users/sm/Downloads/peak-app-299 && PGLITE_PATH=$(mktemp -d) PORT=3299 npx next dev -p 3299"], "port": 3299 }`
  — check `src/db/index.ts` for the env var name the dev DB path honours (`PGLITE_PATH` is what test:specs uses) and
  confirm it seeds a fresh datadir. Use `http://localhost:3299` (never 127.0.0.1), sign in with the dev login,
  unregister the service worker on first load (`navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister()))`).
  Create a design (intake → Blank), then walk the whole spec: every pane, menu, tool, shortcut, selection, align, snap,
  clipboard, undo. Screenshots at 1600×1000 and 1000×800 for the report. **Do not click any upload/import that writes
  Blob** (the dev server loads the real Blob token) — the generated base sheet is enough. Stop the server
  (`preview_stop` + `pkill -f "next dev -p 3299"`), remove the temp launch.json entry.
- [ ] **Step 7: Commit** `docs: The Grid workspace (#299)`.
- [ ] **Step 8: Integrate.** Use superpowers:finishing-a-development-branch. Rebase/merge onto the latest origin/main
  (watch for two-session collisions on DECISIONS/PUNCHLIST numbering), re-run tsc + test:specs after the merge, then
  report to Jeff before pushing to origin/main (push = production deploy).
