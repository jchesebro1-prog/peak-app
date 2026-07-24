# Quartzite Rename + The Grid (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the software suite to **Quartzite** and land the first slice of **The Grid** — the DaVinci-style system designer (plan sheet → scale → paint catalog devices → live BOM → draft quote) under the Design tab.

**Architecture:** The Grid extends the D95/D96 markup-canvas pattern (pdf.js + normalized-0..1 SVG overlay, per-page scale calibration from `lib/annotations`) rather than a new canvas engine (DEC-PSD-3). Projects are a new `grid_projects` doc collection; heavy sheet backgrounds live in a separate `grid_sheets` collection so placement patches never rewrite megabytes (the D95 data-URL amplification finding). BOM math is a dependency-free pure lib shared by the client sidebar and the server quote action.

**Tech Stack:** Next.js 16 App Router, Drizzle/PGlite doc-store, pdfjs-dist, existing `lib/annotations` geometry.

## Global Constraints

- Software name is **"Quartzite"** (Jeff, 2026-07-24). Company name **"Peak Systems Group"** is unchanged everywhere.
- The DaVinci-style module is named **"The Grid"** (Jeff, 2026-07-24), route `/design/grid`, nav child of Design.
- Scope = DEC-PSD-2 first slice only: plan layout + live BOM → draft quote. No wire routing, risers, submittals, DWG.
- PDF/image backgrounds only (DEC-PSD-4).
- All geometry normalized 0..1; reuse `Calibration`/`calibrationScale`/`findCalibration`/`measureLength` from `src/lib/annotations.ts` with `docId` = sheet id.
- Never `window.prompt`/`confirm` — inline entry UI only (markup viewer rule).
- One PGlite process at a time; never leave a tsx script running.
- Epoch-ms timestamps; port-faithful id conventions (`GRD-####` via `nextPrefixedId`, base 5001).
- New defaults get DECISIONS.md entries (D107 rename, D108 The Grid).
- Branch: `quartzite-the-grid` (worktree `/Users/sm/Downloads/peak-app-grid`), off `main`. Commit per task.

---

### Task 1: Rename the software to Quartzite

**Files:**
- Modify: every `src/**` metadata title `— Peak Backend` → `— Quartzite` (~60 files, sed)
- Modify: `src/app/layout.tsx:20,24`, `public/manifest.webmanifest`, `src/components/nav/Nav.tsx:601`, `README.md`, `AGENTS.md`, `DECISIONS.md`

**Steps:**
- [ ] `grep -rl " — Peak Backend" src | xargs sed -i '' 's/ — Peak Backend/ — Quartzite/g'`
- [ ] layout.tsx: `title: "Quartzite"`, `appleWebApp: { ... title: "Quartzite" ... }`; keep description's company name.
- [ ] manifest.webmanifest: `"name": "Quartzite"`, `"short_name": "Quartzite"`; keep description.
- [ ] Nav.tsx: `"Peak beta feedback"` → `"Quartzite beta feedback"`. Check `public/sw.js` cache name + any login/portal title surfaces (`grep -ri "peak backend\|\"Peak\"" src public` must return 0 software-name hits).
- [ ] README.md + AGENTS.md headings: product is Quartzite (repo still "peak-app"; company references stay).
- [ ] DECISIONS.md **D107**: rename decision, source Jeff 2026-07-24, company name untouched.
- [ ] Verify: `grep -rc "Peak Backend" src → 0`; `npm run test:specs` ALL PASSED.
- [ ] Commit: `Rename: the software is Quartzite (D107)`

### Task 2: The Grid data layer

**Files:**
- Modify: `src/db/doc-tables.ts` (add `gridProjects` = `docTable("grid_projects")`, `gridSheets` = `docTable("grid_sheets")` + `DOC_TABLES` entries)
- Create: migration via `npm run db:generate`
- Create: `src/lib/stores/grid-projects.ts`
- Create: `src/lib/design/grid-bom.ts` (dependency-free — client-safe like `lib/annotations`)
- Modify: `scripts/test-review-and-spec.ts` (grid-bom unit tests)

**Interfaces (produces):**
```ts
// stores/grid-projects.ts
export type GridPlacement = { id: string; sheetId: string; page: number; x: number; y: number; partId: string; by: string; at: number };
export type GridProject = { id: string; name: string; customer: string; customerId: string | null; sheetIds: string[]; placements: GridPlacement[]; calibrations: Calibration[]; quoteId: string | null; createdBy: string; createdAt: number; updatedAt: number };
export type GridSheet = { id: string; projectId: string; name: string; mime: string; dataUrl: string; addedBy: string; at: number };
listProjects(): Promise<GridProject[]>; getProject(id): Promise<GridProject | null>;
createProject({name, customer, customerId, by}): Promise<GridProject>;   // id = nextPrefixedId("grid_projects", "GRD", 5001)
addSheet(projectId, {name, mime, dataUrl, by}): Promise<GridSheet | null>;
listSheets(projectId): Promise<GridSheet[]>;                              // ordered by project.sheetIds
addPlacement(projectId, {sheetId, page, x, y, partId, by}): Promise<GridProject | null>;
removePlacement(projectId, placementId): Promise<GridProject | null>;
setSheetCalibration(projectId, cal: Calibration): Promise<GridProject | null>;  // replaces same docId+page
clearSheetCalibration(projectId, sheetId, page): Promise<GridProject | null>;
setQuote(projectId, quoteId): Promise<GridProject | null>;
removeProject(id): Promise<void>;                                         // soft-deletes project + its sheets

// design/grid-bom.ts (pure)
export type PartLite = { id: string; sku: string; desc: string; category: string; unit: string; list: number; cost: number };
export type BomLine = { partId: string; desc: string; unit: string; qty: number; list: number; ext: number };
export function bomLines(placements: {partId: string}[], parts: PartLite[]): BomLine[];  // grouped by partId, sorted by ext desc; unknown partIds → desc "(removed part)" at 0
export function bomTotals(placements, parts): { value: number; cost: number; margin: number };  // margin = (value-cost)/value, 0 when value 0
```

**Steps:**
- [ ] doc-tables.ts entries; `npm run db:generate`; commit drizzle output.
- [ ] Write grid-bom tests in test-review-and-spec.ts (grouping, unknown part, totals/margin, empty), run — FAIL (module missing).
- [ ] Implement grid-bom.ts; run — PASS.
- [ ] Implement stores/grid-projects.ts.
- [ ] `npm run test:specs` ALL PASSED; commit: `The Grid: grid_projects/grid_sheets collections, store, BOM lib (D108)`

### Task 3: Nav + index page

**Files:**
- Modify: `src/components/nav/nav-data.ts` (child `{ key: "grid", label: "The Grid", href: "/design/grid" }` after "designs"; check how `/design/*` children resolve active keys in `Nav.tsx` and mirror what steel/lineset do)
- Create: `src/app/(app)/design/grid/page.tsx` (list + create form), `src/app/(app)/design/grid/actions.ts` (createProjectAction, deleteProjectAction)
- Modify: `src/app/(app)/design/page.tsx` (The Grid card), `scripts/test-review-and-spec.ts` (Design child keys now include "grid")

**Steps:**
- [ ] Update spec-test child-key assertion first, run — FAIL.
- [ ] nav-data.ts + active-key wiring; index page: metadata `The Grid — Quartzite`, projects table (name, customer, sheets, devices, BOM value via bomTotals, updated, quote badge), inline create form (name + customer text), delete with inline confirm.
- [ ] Design overview card: recent grid projects + link.
- [ ] `npm run test:specs` PASS; commit: `The Grid: nav entry + project index (D108)`

### Task 4: Editor — sheets, scale, device painting

**Files:**
- Move: `src/app/(app)/design/engagements/markup/pdf-canvas.tsx` → `src/components/design/pdf-canvas.tsx` (update import in markup viewer)
- Create: `src/app/(app)/design/grid/[id]/page.tsx` (server: project + sheets + catalog→PartLite), `src/app/(app)/design/grid/[id]/actions.ts`, `src/app/(app)/design/grid/[id]/editor.tsx` (client)

**Interfaces (produces):** actions all `requireUser()`, return `{ok: true, ...} | {ok: false, error}` and `revalidatePath("/design/grid/[id]", "page")`:
`addSheetAction(projectId, {name, mime, dataUrl})` (reject >8 MB dataUrl), `placeDeviceAction(projectId, {sheetId, page, x, y, partId})`, `removePlacementAction(projectId, placementId)`, `calibrateAction(projectId, {sheetId, page, scale, unit, refLength})`, `clearCalAction(projectId, sheetId, page)`.

**Editor behavior:** header (back, name, sheet select, upload → FileReader dataUrl, zoom ±, PDF page controls) · left sidebar panels: **Devices** (search + category filter over PartLite[], click to arm; armed part shown), **Scale** (markup-style calibrate flow: draw reference two-pointer, inline length+unit entry), **BOM** (Task 5) · canvas: PdfCanvas or `<img>` + SVG overlay; armed part + click → `placeDeviceAction` at normalized point; markers = colored circle + SKU chip (like count tool); click marker selects → sidebar Selected panel (part desc + Delete). Placements filtered to active sheet+page. Calibrated measure readout not required this slice (calibration is stored for BOM-later wire lengths and correctness of future phases).

**Steps:**
- [ ] Move pdf-canvas + fix import; `npm run test:specs` PASS.
- [ ] Server page + actions + editor per above.
- [ ] Manual verify (dev server, task 6 does full proof).
- [ ] Commit: `The Grid: editor — sheets, scale calibration, device painting (D108)`

### Task 5: Live BOM → draft quote

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (BOM panel: `bomLines(placements, parts)` whole-project, qty × list, total, button), `src/app/(app)/design/grid/[id]/actions.ts` (`createDraftQuoteAction(projectId)`)

**Behavior:** action recomputes lines server-side from live catalog; if `project.quoteId` and that quote exists and is still `draft` → `quotes.update` value/margin/spec/name; else `quotes.create({ name: `${project.name} — The Grid design`, customer, customerId, value: totals.value, margin: totals.margin, source: "grid", quoteType: "system", owner: user.name, spec: { kind: "grid", gridProjectId, lines } })` + `setQuote`. Button label flips "Create draft quote" / "Update draft quote Q-####"; link to `/quotes`.

**Steps:**
- [ ] BOM panel + action + button.
- [ ] Verify: place devices → BOM sums correctly against catalog list prices; create → quote appears in /quotes as Draft; second run updates same quote.
- [ ] Commit: `The Grid: live BOM sidebar → draft quote (D108)`

### Task 6: Verify, document, capture

**Steps:**
- [ ] `npm run test:specs` ALL PASSED; `npm run build` green (worktree, no stray tsx).
- [ ] Dev server + browser: screenshot of The Grid editor with placed devices + BOM; nav shows The Grid; title shows Quartzite.
- [ ] DECISIONS.md **D108**: The Grid naming (Jeff; note naming-doc had proposed "The Grid" for the lineset builder — Jeff's assignment wins), slice scope, grid_sheets separation rationale, GRD- ids, quote idempotence.
- [ ] AGENTS.md phase status: add item 10 (The Grid slice 1 on branch).
- [ ] Commit: `The Grid: D108 decision log + docs`
- [ ] Memory capture (Dropbox tree): update `projects/peak-system-designer.md` (names decided, slice built, branch), `ACTIVE_PROJECTS.md`, naming-candidates note (outcome), fix stale "no repo access" claim, session summary + MEMORY.md pointer.
