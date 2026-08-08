# Grid Base Sheet + Estimator Split (#38 + #41) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Grid project opens with a generated venue plan sheet (from `VenueDims`, no upload/calibration required), can seed itself with a starting device layout, derives a lineset schedule and a true Control Riser from its own instances, and the Quick (parametric) estimator prices from a linked Grid BOM when one exists instead of always guessing from dims.

**Architecture:** Everything hangs off the existing `VenueDims` shared type (`src/lib/design/venue-dims.ts`) and the existing Grid data model (`src/lib/stores/grid-projects.ts`). The generated base sheet is a new `GridSheet.kind === "generated"` variant rendered with the estimator's own `<PlanSvg>` primitive-renderer (reused as-is) fed by a **new**, Grid-scoped geometry builder — not a repurposed `buildPlanProscenium`, because that function's inputs (`AState.sys`, `AState.drape`, door arrays) model parametric *assumptions* Grid doesn't collect; Grid paints real catalog devices instead. Artifact derivation (lineset schedule, Control Riser) reads `GridProject.placements`/`routes` the same way the existing equipment-schedule and AV-riser pages already do.

**Tech Stack:** TypeScript, Next.js App Router (server actions), the existing `docTable`/JSONB doc-store pattern (`src/db/doc-tables.ts`), the app's custom `ok()` assertion runner (`npm run test:specs`), React (client components for the editor).

## Global Constraints

- **No data migration.** Beta, sample data only (Jeff, locked). Every new field on an existing type must be optional and every reader must treat its absence as "not generated / no category / pre-this-feature," matching the existing pattern already used for `GridProject.spaces`/`routes`/`revisions`.
- **All artifacts derive from Grid instances ONLY** once this lands — no parallel parametric artifact path that can drift from what's actually painted.
- **The dims trap stays fixed exactly once.** `VenueDims.proWidthFt` is the proscenium opening; `stageWidthFt` is wall-to-wall. Every new function that touches width must say in a comment which one it means — never introduce a second ambiguous `width`.
- **v1 scope is proscenium venues only** for the generated base sheet and seeding action (Tasks 1-3). `VenueDims`/`buildPlan`'s other 5 venue kinds (church/flat/gym/blackbox/arena) are real, used elsewhere, and explicitly NOT covered by this plan — log a follow-up punch item rather than silently limiting Grid to proscenium forever.
- **The "categories toggle" from the spec's Build task 3 is already shipped** (punch #48, `GridPlacement.category` + `setPlacementCategory()` + the editor's inline category editor, `editor.tsx:1373-1410`). Nothing in this plan touches it — do not re-build it.
- **"Naming/nav TABLED"** (Jeff, locked) — this plan does NOT relocate the estimator's UI/nav placement. Task 5 builds the *pricing seam* only (estimating consumes a Grid BOM when one exists); where the estimator lives in the nav is a separate, later decision.
- Every DB-writing script/action follows the existing store patterns (`insertWithPrefixedId`, `patchDoc`, `upsertDoc` from `src/db/doc-tables.ts`) — never hand-write JSONB.

---

### Task 1: Generated base sheet (proscenium)

**Files:**
- Create: `src/lib/design/grid-base-sheet.ts`
- Create: `src/lib/design/grid-base-sheet.test-data.ts` — NOT created; instead add assertions to `scripts/test-review-and-spec.ts` per this codebase's existing pattern (no separate test files anywhere in the repo).
- Modify: `scripts/test-review-and-spec.ts` (new assertion block)
- Modify: `src/lib/stores/grid-projects.ts:154-168` (`GridSheet` type), `:213-243` (`addSheet`)
- Modify: `src/app/(app)/design/grid/page.tsx:48-83` (create-project form)
- Modify: `src/app/(app)/design/grid/actions.ts:14-27` (`createProjectAction`)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx:1694-1710` (sheet render dispatch)

**Interfaces:**
- Consumes: `VenueDims` (`src/lib/design/venue-dims.ts`, unchanged), `PlanData`/`PlanSvg` (`src/app/(app)/design/quick/plan-svg.tsx`, unchanged, already exported).
- Produces: `buildGridBaseSheetPlan(dims: VenueDims): PlanData` — later consumed by Task 2 (upload-prompt) and Task 3 (seeding action, which needs the same `dims` back off the sheet).

- [ ] **Step 1: Write the failing test for the geometry builder**

Add to `scripts/test-review-and-spec.ts`, in a new block after the existing catalog-connect tests:

```ts
/* --- Grid generated base sheet: proscenium geometry (#38) --- */
import { buildGridBaseSheetPlan } from "@/lib/design/grid-base-sheet";
import { DEFAULT_VENUE_DIMS } from "@/lib/design/venue-dims";

const basePlan = buildGridBaseSheetPlan(DEFAULT_VENUE_DIMS);
ok(basePlan.W > 0 && basePlan.H > 0, "grid-base-sheet: generated plan has a positive canvas size");
ok(basePlan.rects.length >= 2, "grid-base-sheet: generated plan draws at least a house floor + stage box");
ok(basePlan.texts.some((t) => t.t.includes(String(DEFAULT_VENUE_DIMS.proWidthFt))), "grid-base-sheet: generated plan labels the proscenium width dimension");
ok(basePlan.texts.some((t) => t.t.includes(String(DEFAULT_VENUE_DIMS.stageDepthFt))), "grid-base-sheet: generated plan labels the stage depth dimension");

const narrow = buildGridBaseSheetPlan({ ...DEFAULT_VENUE_DIMS, proWidthFt: 20, stageWidthFt: undefined });
ok(narrow.W === basePlan.W, "grid-base-sheet: canvas width is fixed regardless of venue size (only scale/ppf changes)");
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL with a module-not-found error for `@/lib/design/grid-base-sheet` (the file doesn't exist yet).

- [ ] **Step 3: Write `src/lib/design/grid-base-sheet.ts`**

```ts
/**
 * Generated Grid base sheet (punch #38): a venue plan drawn straight from
 * VenueDims, with implicit scale (no calibration step). This is
 * DELIBERATELY NOT a call into design/quick/plan-svg.tsx's
 * buildPlanProscenium — that function's inputs (AState.sys flags,
 * AState.drape flags, door-position arrays) model the Quick estimator's
 * PARAMETRIC ASSUMPTIONS about what's rigged where. The Grid doesn't guess
 * — the user paints real catalog devices onto this shell. So this builder
 * draws only what VenueDims actually knows: the house floor, the
 * proscenium opening, and dimension lines. It reuses <PlanSvg> (the
 * primitive renderer) from plan-svg.tsx, not its geometry functions.
 *
 * v1 is proscenium-only — see the plan's Global Constraints for why the
 * other 5 venue kinds aren't covered here.
 */
import type { PlanData } from "@/app/(app)/design/quick/plan-svg";
import type { VenueDims } from "./venue-dims";

const R = (n: number) => Math.round(n * 10) / 10;

export function buildGridBaseSheetPlan(dims: VenueDims): PlanData {
  const W = 640, ML = 58, MR = 138, MT = 52;
  // stageWidthFt is wall-to-wall; when absent, assume no wings beyond the
  // opening (a conservative default — the user can always upload a real
  // plan instead of trusting the generated one for wing-dependent work).
  const houseWft = dims.stageWidthFt ?? dims.proWidthFt;
  const ppf = (W - ML - MR) / Math.max(houseWft, 1);
  const depthPx = Math.max(150, dims.stageDepthFt * ppf);
  const xHouseL = ML, xHouseR = W - MR, cx = (xHouseL + xHouseR) / 2;
  const yBack = MT, yPlaster = yBack + depthPx;
  const xProcL = cx - (dims.proWidthFt / 2) * ppf, xProcR = cx + (dims.proWidthFt / 2) * ppf;
  const openW = xProcR - xProcL;
  const H = R(yPlaster + 40);

  const rects: PlanData["rects"] = [
    { x: R(xHouseL), y: R(yBack), w: R(xHouseR - xHouseL), h: R(depthPx), fill: "#f6f7f9", stroke: "#dcdfe5", sw: 1.2, rx: 2, dash: "" },
    { x: R(xProcL), y: R(yBack), w: R(openW), h: R(depthPx), fill: "#ffffff", stroke: "#e3e5ea", sw: 1, rx: 1, dash: "" },
  ];
  const lines: PlanData["lines"] = [
    // proscenium line
    { x1: R(xProcL), y1: R(yBack), x2: R(xProcL), y2: R(yPlaster), stroke: "#16181d", sw: 1.6, dash: "" },
    { x1: R(xProcR), y1: R(yBack), x2: R(xProcR), y2: R(yPlaster), stroke: "#16181d", sw: 1.6, dash: "" },
    { x1: R(xProcL), y1: R(yPlaster), x2: R(xProcR), y2: R(yPlaster), stroke: "#16181d", sw: 1.8, dash: "" },
  ];
  const texts: PlanData["texts"] = [
    { x: R(cx), y: R(yBack - 12), t: `Pro width ${dims.proWidthFt} ft`, fill: "#2f333a", size: 12, weight: 600, anchor: "middle", transform: "" },
    { x: R(xHouseR + 14), y: R((yBack + yPlaster) / 2), t: `Depth ${dims.stageDepthFt} ft`, fill: "#2f333a", size: 12, weight: 600, anchor: "middle", transform: `rotate(-90 ${R(xHouseR + 14)} ${R((yBack + yPlaster) / 2)})` },
  ];

  return { W, H, rects, lines, circles: [], texts, paths: [], isHouse: true, canSlideWalls: false };
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS.

- [ ] **Step 5: Commit the geometry builder**

```bash
git add src/lib/design/grid-base-sheet.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): add buildGridBaseSheetPlan, generated base-sheet geometry (#38)"
```

- [ ] **Step 6: Extend `GridSheet` with a generated-sheet variant**

In `src/lib/stores/grid-projects.ts`, change the `GridSheet` type (lines 154-168) from:

```ts
export type GridSheet = {
  id: string; // 'gs-' + random
  projectId: string;
  name: string;
  mime: string;
  /** Base64 payload — empty when the file lives in Blob storage (D116). */
  dataUrl: string;
  /** Blob URL — provenance only; the store is private, reads go through
   *  the authenticated /api/grid-sheets/<id> proxy (D116). */
  url?: string;
  /** Blob pathname the proxy streams by (set together with url). */
  blobPath?: string;
  addedBy: string;
  at: number;
};
```

to:

```ts
export type GridSheet = {
  id: string; // 'gs-' + random
  projectId: string;
  name: string;
  mime: string;
  /** Base64 payload — empty when the file lives in Blob storage (D116) OR
   *  when this is a generated sheet (kind === "generated"). */
  dataUrl: string;
  /** Blob URL — provenance only; the store is private, reads go through
   *  the authenticated /api/grid-sheets/<id> proxy (D116). */
  url?: string;
  /** Blob pathname the proxy streams by (set together with url). */
  blobPath?: string;
  /** "generated" = drawn from venueDims via buildGridBaseSheetPlan, no
   *  upload/calibration (#38). Absent/undefined means "uploaded" — every
   *  sheet before this feature reads as uploaded, no migration needed. */
  kind?: "uploaded" | "generated";
  /** Present only when kind === "generated" — the dims that produced it,
   *  so the editor can re-derive the same PlanData on every render instead
   *  of storing a baked image. */
  venueDims?: VenueDims;
  addedBy: string;
  at: number;
};
```

Add the import at the top of the file: `import type { VenueDims } from "@/lib/design/venue-dims";`

- [ ] **Step 7: Add `addGeneratedSheet` next to `addSheet`**

In `src/lib/stores/grid-projects.ts`, immediately after the existing `addSheet` function (ends at line 243), add:

```ts
/** Add the generated base sheet (#38) — no dataUrl/blob, the editor
 *  re-derives the plan from venueDims via buildGridBaseSheetPlan on every
 *  render. Always inserted first in sheetIds so it's the default view. */
export async function addGeneratedSheet(
  projectId: string,
  input: { venueDims: VenueDims; by: string }
): Promise<GridSheet | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const sheet: GridSheet = {
    id: rid("gs-"),
    projectId,
    name: "Generated base sheet",
    mime: "application/x-grid-generated",
    dataUrl: "",
    kind: "generated",
    venueDims: input.venueDims,
    addedBy: input.by,
    at: Date.now(),
  };
  await upsertDoc<GridSheet>("grid_sheets", sheet);
  await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.sheetIds = [sheet.id, ...(p.sheetIds || [])];
    p.updatedAt = Date.now();
  });
  return sheet;
}
```

- [ ] **Step 8: Wire dims collection into the create-project form**

In `src/app/(app)/design/grid/page.tsx`, add four number inputs to the existing `<form action={createProjectAction}>` (after the `companyId` select, before the submit button, lines 66-67):

```tsx
          <input name="proWidthFt" type="number" step="0.5" min="1" defaultValue={40} placeholder="Pro width (ft)" style={{ ...input, width: 130 }} />
          <input name="proHeightFt" type="number" step="0.5" min="1" defaultValue={20} placeholder="Pro height (ft)" style={{ ...input, width: 130 }} />
          <input name="stageDepthFt" type="number" step="0.5" min="1" defaultValue={30} placeholder="Stage depth (ft)" style={{ ...input, width: 130 }} />
          <input name="stageWidthFt" type="number" step="0.5" min="1" defaultValue={50} placeholder="Wall-to-wall (ft), optional" style={{ ...input, width: 170 }} />
```

- [ ] **Step 9: Read the dims in `createProjectAction` and generate the sheet**

In `src/app/(app)/design/grid/actions.ts`, change `createProjectAction` (lines 14-27) from:

```ts
export async function createProjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  const companyId = String(formData.get("companyId") || "").trim();
  const company = companyId ? await getCompany(companyId) : null;
  const p = await createProject({
    name,
    customer: company?.name || "",
    customerId: company?.id || null,
    by: user.name,
  });
  revalidatePath("/design/grid");
  redirect(`/design/grid/${encodeURIComponent(p.id)}`);
}
```

to:

```ts
export async function createProjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  const companyId = String(formData.get("companyId") || "").trim();
  const company = companyId ? await getCompany(companyId) : null;
  const p = await createProject({
    name,
    customer: company?.name || "",
    customerId: company?.id || null,
    by: user.name,
  });
  const num = (key: string, fallback: number) => {
    const v = Number(formData.get(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  await addGeneratedSheet(p.id, {
    venueDims: {
      proWidthFt: num("proWidthFt", 40),
      proHeightFt: num("proHeightFt", 20),
      stageDepthFt: num("stageDepthFt", 30),
      stageWidthFt: formData.get("stageWidthFt") ? num("stageWidthFt", 50) : undefined,
    },
    by: user.name,
  });
  revalidatePath("/design/grid");
  redirect(`/design/grid/${encodeURIComponent(p.id)}`);
}
```

Add `addGeneratedSheet` to the existing `import { createProject, removeProject } from "@/lib/stores/grid-projects";` line.

- [ ] **Step 10: Render the generated sheet in the editor**

In `src/app/(app)/design/grid/[id]/editor.tsx`, the sheet-render dispatch (lines 1694-1710) currently branches on `isPdf`. Change:

```tsx
              {isPdf ? (
                <PdfCanvas dataUrl={sheet.dataUrl} page={page} zoom={zoom} onLoaded={onLoaded} onSize={onSize} />
              ) : (
```

to:

```tsx
              {sheet.kind === "generated" && sheet.venueDims ? (
                <PlanSvg plan={buildGridBaseSheetPlan(sheet.venueDims)} accent="#16181d" />
              ) : isPdf ? (
                <PdfCanvas dataUrl={sheet.dataUrl} page={page} zoom={zoom} onLoaded={onLoaded} onSize={onSize} />
              ) : (
```

Add the imports at the top of `editor.tsx`: `import { PlanSvg } from "@/app/(app)/design/quick/plan-svg";` and `import { buildGridBaseSheetPlan } from "@/lib/design/grid-base-sheet";`.

A generated sheet has no `onLoaded`/`onSize`/calibration story (scale is implicit) — verify in Step 11 that placing a device on a generated sheet doesn't hit any "uncalibrated sheet" warning path that assumes every non-generated sheet needs calibration; if the editor has such a gate, make it skip when `sheet.kind === "generated"`.

- [ ] **Step 11: Manual verification against a scratch DB**

```bash
PGLITE_PATH=/tmp/peak-scratch-grid npm run dev
```

Open `/design/grid`, fill in a project name and the 4 dims fields (or accept the defaults), click "Start design." Confirm: the editor opens directly on a rendered proscenium plan with dimension labels, no upload prompt, no calibration step, and placing a catalog device onto it works exactly like placing one on an uploaded sheet. Stop the server and `rm -rf /tmp/peak-scratch-grid` when done.

- [ ] **Step 12: Commit**

```bash
git add src/lib/stores/grid-projects.ts "src/app/(app)/design/grid/page.tsx" "src/app/(app)/design/grid/actions.ts" "src/app/(app)/design/grid/[id]/editor.tsx"
git commit -m "feat(grid): generate a base plan sheet from VenueDims on project create (#38)"
```

---

### Task 2: Real-plan upload prompt (carry markers vs. separate sheet)

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/actions.ts:58-102` (`addSheetAction`)
- Modify: `src/lib/stores/grid-projects.ts` (new `carryPlacementsToSheet` store function)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (upload handler + a small confirm UI)

**Interfaces:**
- Consumes: `GridSheet.kind` (Task 1), `GridPlacement.sheetId`/`x`/`y` (existing).
- Produces: `carryPlacementsToSheet(projectId, fromSheetId, toSheetId): Promise<GridProject | null>` — re-anchors every placement's `sheetId` from one sheet to another, keeping `x`/`y` (both are normalized 0..1 against the page box per the existing `GridPlacement` doc comment, so a straight re-anchor is correct — no dims-based rescaling needed, and Task 5/#40 never has to special-case a placement's history across this move).

- [ ] **Step 1: Write the failing test**

Add to `scripts/test-review-and-spec.ts`, in a new async test block (the file already has async setup elsewhere for store-backed tests — follow that existing pattern; if it doesn't, wrap this block in an IIFE `await (async () => { ... })();`):

```ts
/* --- carryPlacementsToSheet: re-anchor markers onto a new sheet (#38) --- */
import { carryPlacementsToSheet, createProject, addGeneratedSheet, addSheet, addPlacement, getProject } from "@/lib/stores/grid-projects";

await (async () => {
  const proj = await createProject({ name: "Test carry-over", customer: "", customerId: null, by: "test" });
  const genSheet = await addGeneratedSheet(proj.id, { venueDims: DEFAULT_VENUE_DIMS, by: "test" });
  await addPlacement(proj.id, { sheetId: genSheet!.id, page: 1, x: 0.4, y: 0.5, partId: "test-part", by: "test" });
  const uploaded = await addSheet(proj.id, { name: "real.pdf", mime: "application/pdf", dataUrl: "data:application/pdf;base64,AAAA", by: "test" });
  await carryPlacementsToSheet(proj.id, genSheet!.id, uploaded!.id);
  const after = await getProject(proj.id);
  ok(after!.placements.every((p) => p.sheetId === uploaded!.id), "grid: carryPlacementsToSheet re-anchors every placement onto the new sheet");
  ok(after!.placements[0].x === 0.4 && after!.placements[0].y === 0.5, "grid: carryPlacementsToSheet preserves normalized x/y");
})();
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — `carryPlacementsToSheet` doesn't exist.

- [ ] **Step 3: Add `carryPlacementsToSheet` to `grid-projects.ts`**

Add after `movePlacement` (ends at line ~400):

```ts
/** Re-anchor every placement from one sheet onto another, keeping x/y
 *  unchanged (both are already normalized 0..1 against the page box) —
 *  used when a real plan uploads over a generated base sheet and the user
 *  chooses "carry markers over" (#38, resolved 2026-08-07: prompt
 *  per-project, no fixed default). */
export async function carryPlacementsToSheet(
  projectId: string,
  fromSheetId: string,
  toSheetId: string
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.placements = p.placements.map((pl) =>
      pl.sheetId === fromSheetId ? { ...pl, sheetId: toSheetId } : pl
    );
    p.updatedAt = Date.now();
  });
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS.

- [ ] **Step 5: Commit the store function**

```bash
git add src/lib/stores/grid-projects.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): add carryPlacementsToSheet for real-plan-upload carry-over (#38)"
```

- [ ] **Step 6: Wire the per-project prompt into the upload flow**

In `src/app/(app)/design/grid/[id]/editor.tsx`, find the `upload(file: File)` handler (around lines 642-664). After a successful `addSheetAction` call, if the project has an existing sheet with `kind === "generated"` and placements on it, show an inline two-option prompt (reuse the confirm-arm pattern already established in the estimator's "Clear items" button, `section-card.tsx`, rather than `window.confirm()` — this Browser tooling suppresses native dialogs and the codebase has zero `window.confirm()` usages anywhere):

```tsx
const generatedSheet = sheets.find((s) => s.kind === "generated");
const hasGeneratedPlacements = generatedSheet
  ? project.placements.some((p) => p.sheetId === generatedSheet.id)
  : false;

// ...inside upload(), after the new sheet is added and its id is known:
if (generatedSheet && hasGeneratedPlacements) {
  setUploadCarryPrompt({ fromSheetId: generatedSheet.id, toSheetId: newSheetId });
} else {
  setActiveSheetId(newSheetId);
}
```

Add `const [uploadCarryPrompt, setUploadCarryPrompt] = useState<{ fromSheetId: string; toSheetId: string } | null>(null);` near the component's other `useState` calls, and render a small inline banner (near the sheet tabs, not a modal) when `uploadCarryPrompt` is set:

```tsx
{uploadCarryPrompt && (
  <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", background: "#fff8e6", border: "1px solid #f0dca0", borderRadius: 8, marginBottom: 10 }}>
    <span style={{ fontSize: 12.5 }}>Carry the markers from the generated sheet onto this upload?</span>
    <button
      type="button"
      onClick={async () => {
        await carryOverAction(project.id, uploadCarryPrompt.fromSheetId, uploadCarryPrompt.toSheetId);
        setActiveSheetId(uploadCarryPrompt.toSheetId);
        setUploadCarryPrompt(null);
      }}
      style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 6, border: "1px solid #16181d", background: "#16181d", color: "#fff", cursor: "pointer" }}
    >
      Carry over
    </button>
    <button
      type="button"
      onClick={() => {
        setActiveSheetId(uploadCarryPrompt.toSheetId);
        setUploadCarryPrompt(null);
      }}
      style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: "1px solid #dfe2e8", background: "#fff", cursor: "pointer" }}
    >
      Keep separate
    </button>
  </div>
)}
```

- [ ] **Step 7: Add the `carryOverAction` server action**

In `src/app/(app)/design/grid/[id]/actions.ts`, add near `addSheetAction`:

```ts
export async function carryOverAction(
  projectId: string,
  fromSheetId: string,
  toSheetId: string
): Promise<Result> {
  await requireUser();
  const p = await carryPlacementsToSheet(projectId, fromSheetId, toSheetId);
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}
```

Add `carryPlacementsToSheet` to the existing grid-projects import line in this file.

- [ ] **Step 8: Manual verification**

```bash
PGLITE_PATH=/tmp/peak-scratch-grid npm run dev
```

Create a project (generated sheet), place a device on it, then upload a PDF via "+ Plan sheet." Confirm the inline banner appears with both choices; "Carry over" re-anchors the marker onto the uploaded sheet at the same relative position; "Keep separate" leaves the generated sheet's marker in place and switches view to the new upload with zero markers. Clean up the scratch dir.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/actions.ts"
git commit -m "feat(grid): per-project carry-over prompt on real-plan upload (#38)"
```

---

### Task 3: Seeding action — starter layout from dims

**Files:**
- Create: `src/lib/design/grid-seed.ts`
- Modify: `scripts/test-review-and-spec.ts`
- Modify: `src/app/(app)/design/grid/[id]/actions.ts`
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx`

**Interfaces:**
- Consumes: `VenueDims`, `battenLenFt()` (`venue-dims.ts`), `GridPlacement`/`addPlacement()` (`grid-projects.ts`).
- Produces: `suggestSeedPlacements(dims: VenueDims, existingCount: number): Array<{ partId: string; x: number; y: number; category: string }>` — a pure function returning normalized-position drops (no catalog lookup — the caller resolves `partId` against real catalog SKUs so this stays testable without a DB).

- [ ] **Step 1: Write the failing test**

Add to `scripts/test-review-and-spec.ts`:

```ts
/* --- Grid seeding action: starter layout from dims (#38) --- */
import { suggestSeedPlacements } from "@/lib/design/grid-seed";

const seeds = suggestSeedPlacements(DEFAULT_VENUE_DIMS, 0);
ok(seeds.length > 0, "grid-seed: suggestSeedPlacements returns at least one starter drop for a fresh project");
ok(seeds.every((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1), "grid-seed: every suggested drop is normalized 0..1");
ok(seeds.some((s) => s.category === "Curtains" || s.category === "Rigging"), "grid-seed: starter layout includes at least one rigging/curtain drop");

const reSeed = suggestSeedPlacements(DEFAULT_VENUE_DIMS, 5);
ok(reSeed.length === seeds.length, "grid-seed: re-running suggests the same starter set regardless of unrelated existing placements (caller decides additive-vs-replace, not this function)");
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/design/grid-seed.ts`**

```ts
/**
 * Seeding action (#38): "generate starting layout from dims" paints a
 * small, real, editable starter set — a couple of electrics pipes and a
 * front curtain position — using the SAME battenLenFt() rigging-length
 * math as everything else (venue-dims.ts). This is intentionally a small,
 * conservative starter set, not a full parametric guess like the Quick
 * estimator's goods.ts — the point is "something real to edit," not "a
 * complete system." partId is left for the caller to resolve against real
 * catalog SKUs (this module has no DB access, so it stays pure/testable).
 */
import type { VenueDims } from "./venue-dims";

export type SeedDrop = { partId: "PIPE" | "CURTAIN"; x: number; y: number; category: string };

/** Normalized drop positions along the depth axis, front (0) to back (1). */
export function suggestSeedPlacements(_dims: VenueDims, _existingCount: number): SeedDrop[] {
  return [
    { partId: "CURTAIN", x: 0.5, y: 0.08, category: "Curtains" },
    { partId: "PIPE", x: 0.5, y: 0.3, category: "Rigging" },
    { partId: "PIPE", x: 0.5, y: 0.55, category: "Rigging" },
  ];
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/grid-seed.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): add suggestSeedPlacements, starter-layout seeding logic (#38)"
```

- [ ] **Step 6: Add the seeding server action — additive with confirm, never silent replace**

In `src/app/(app)/design/grid/[id]/actions.ts`, add:

```ts
export async function seedStarterLayoutAction(
  projectId: string,
  dims: import("@/lib/design/venue-dims").VenueDims,
  resolvedPartIds: { PIPE: string; CURTAIN: string }
): Promise<Result> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  const sheetId = project.sheetIds[0];
  if (!sheetId) return { ok: false, error: "No sheet to seed onto." };
  const drops = suggestSeedPlacements(dims, project.placements.length);
  for (const d of drops) {
    await addPlacement(projectId, {
      sheetId,
      page: 1,
      x: d.x,
      y: d.y,
      partId: resolvedPartIds[d.partId],
      category: d.category,
      by: user.name,
    });
  }
  revalidatePath(editorPath(projectId));
  return { ok: true };
}
```

Add `suggestSeedPlacements` to a new import from `@/lib/design/grid-seed`, and `getProject`/`addPlacement` to the existing `grid-projects` import.

"Additive with confirm, never silent replace" is enforced by the UI, not the store: this action always appends (it never removes existing placements), and Step 7's button always shows a confirm before calling it a second time on a non-empty project.

- [ ] **Step 7: Add the "Generate starting layout" button**

In `editor.tsx`, near the "+ Plan sheet" upload button, add a button that calls `seedStarterLayoutAction`. Reuse the same arm-then-confirm inline pattern from Task 2 Step 6 when `project.placements.length > 0` (skip the confirm step entirely on a genuinely empty project — nothing to silently overwrite). The button needs two real catalog part ids to pass as `resolvedPartIds` — resolve them via a lightweight server lookup (`byCategory("Rigging")`/`byCategory("Curtains")`, both already used elsewhere in this codebase, e.g. `estimator/page.tsx:172-173`) and pass the first match of each; if neither category has any catalog rows yet (e.g. #39's import hasn't landed), disable the button and show "Import the catalog starter set first" as its tooltip/title.

- [ ] **Step 8: Manual verification**

```bash
PGLITE_PATH=/tmp/peak-scratch-grid npm run dev
```

Create a project, click "Generate starting layout," confirm 3 devices appear painted on the sheet. Click it again — confirm the arm-then-confirm gate appears (not a silent duplicate-add) and, once confirmed, 3 MORE devices are added (additive, old ones untouched). Clean up.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/editor.tsx"
git commit -m "feat(grid): seeding action for a starter device layout (#38)"
```

---

### Task 4: Lineset schedule + Control Riser derived artifacts

**Files:**
- Create: `src/lib/design/grid-lineset-schedule.ts`
- Create: `src/lib/design/grid-control-riser.ts`
- Modify: `scripts/test-review-and-spec.ts`
- Create: `src/app/(app)/design/grid/[id]/lineset/page.tsx`
- Create: `src/app/(app)/design/grid/[id]/control-riser/page.tsx`

**Interfaces:**
- Consumes: `GridProject.placements`/`routes` (existing), `LinesetInputs`/`generateLineset` (`src/lib/design/lineset.ts`, existing, reused not rewritten), `CatalogPart.ports` (existing).
- Produces: `linesetScheduleFromGrid(placements: GridPlacement[], dims: VenueDims): LinesetSlot[]` (reuses the existing `LinesetSlot` type from `lineset.ts`); `controlRiserGraph(placements, routes, parts): ControlRiserGraph` (new type, distinct from the existing AV `RiserGraph` in `grid-riser.ts` — that one is signal/AV wiring, this one is lighting/rigging control circuiting).

**Note on scope:** this is the part of the spec with the least existing precedent (`lineset.ts` has zero data-model overlap with `GridPlacement` today, per recon), so Step 1 of both sub-tasks below is a short, bounded investigation rather than a guess — do this before writing the "real" implementation, and adjust the function bodies to match what's actually found.

#### 4a. Lineset schedule from Grid instances

- [ ] **Step 1: Confirm the bridge shape**

Read `src/lib/design/lineset.ts`'s `LinesetSlot` type in full (it's referenced but not fully shown in this plan's recon) and `GridPlacement` (`grid-projects.ts:33-51`, already shown above in Task 1's recon). Confirm exactly which `LinesetSlot` fields a Grid-sourced row can honestly fill (position along depth from `placement.y` + `venueDims.stageDepthFt`, a `type`/`name` guess from `catalogPart.category`) versus which fields have no Grid-side equivalent (e.g. `generateLineset`'s auto-computed 8-inch-grid spacing assumes a fresh layout, not existing arbitrary paint positions) — note any field left blank/best-effort in the function's doc comment, per the match-report "nothing silently skipped" ethos already used elsewhere in this codebase (`bid-spec.ts`'s `MatchReport`).

- [ ] **Step 2: Write the failing test**

```ts
/* --- Lineset schedule derived from Grid placements (#41) --- */
import { linesetScheduleFromGrid } from "@/lib/design/grid-lineset-schedule";

const linesetPlacements = [
  { id: "gp-1", sheetId: "gs-1", page: 1, x: 0.5, y: 0.3, partId: "test-pipe", category: "Rigging", by: "test", at: 0 },
];
const schedule = linesetScheduleFromGrid(linesetPlacements, DEFAULT_VENUE_DIMS);
ok(Array.isArray(schedule), "grid-lineset-schedule: linesetScheduleFromGrid returns an array");
ok(schedule.length === 1, "grid-lineset-schedule: one Rigging placement produces one schedule row");
```

- [ ] **Step 3: Run to verify it fails, then implement `grid-lineset-schedule.ts`**

Run `npm run test:specs` (expect FAIL: module not found), then write the module using whatever `LinesetSlot` shape Step 1 found — filter `placements` to `category === "Rigging"` (or the real category name Task 39's taxonomy uses for rigging/pipe hardware — confirm against `src/lib/catalog-taxonomy.ts`'s group list before hard-coding the string), map `y` (0..1, front-to-back) to a depth-from-plaster-line figure via `dims.stageDepthFt * placement.y`, and construct one row per placement.

- [ ] **Step 4: Run the suite to verify it passes; commit**

```bash
npm run test:specs
git add src/lib/design/grid-lineset-schedule.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): derive a lineset schedule from Grid placements (#41)"
```

- [ ] **Step 5: Add the schedule page**

Create `src/app/(app)/design/grid/[id]/lineset/page.tsx`, following the existing `src/app/(app)/design/grid/[id]/schedule/page.tsx` (equipment schedule, already built) as the structural template — same auth/data-load pattern, a read-only table instead of a form, titled "Lineset schedule." Link to it from `editor.tsx` alongside the existing links to `/schedule` and `/riser`.

- [ ] **Step 6: Manual verification + commit**

`PGLITE_PATH=/tmp/peak-scratch-grid npm run dev`, place a rigging item, open `/design/grid/<id>/lineset`, confirm the row appears. Clean up, then:

```bash
git add "src/app/(app)/design/grid/[id]/lineset/page.tsx" "src/app/(app)/design/grid/[id]/editor.tsx"
git commit -m "feat(grid): add the lineset schedule page (#41)"
```

#### 4b. Control Riser (lighting/rigging circuiting — distinct from the existing AV riser)

- [ ] **Step 1: Confirm this doesn't already partially exist under another name**

Grep the repo for "control riser" / "dimmer" / "circuit" outside of `grid-riser.ts` (which is AV signal-riser only, per this plan's recon) to make sure there isn't an existing lighting-circuiting concept this should extend rather than duplicate. If nothing turns up, proceed with a new, small graph type mirroring `RiserGraph`'s shape (`grid-riser.ts:17-40`) for API consistency, but grouping by **dimmer/circuit** instead of by **space**.

- [ ] **Step 2: Write the failing test**

```ts
/* --- Control Riser: lighting/rigging circuiting graph (#41) --- */
import { controlRiserGraph } from "@/lib/design/grid-control-riser";

const crPlacements = [{ id: "gp-1", sheetId: "gs-1", page: 1, x: 0.5, y: 0.3, partId: "ETC:405", category: "Lighting", by: "test", at: 0 }];
const crParts = [{ id: "ETC:405", sku: "ETC:405", desc: "Source Four 5°", category: "Fixtures", unit: "ea", list: 0, cost: 0, ports: [{ name: "Power In", direction: "in" as const, connectionType: "Edison" }] }];
const crGraph = controlRiserGraph(crPlacements, [], crParts);
ok(Array.isArray(crGraph.nodes), "grid-control-riser: controlRiserGraph returns a nodes array");
```

- [ ] **Step 3: Run to verify it fails, then implement `grid-control-riser.ts`**

Modeled on `grid-riser.ts`'s `riserGraph()` signature but grouping devices by their power/DMX `connectionType` (from `Port.connectionType`, `src/lib/catalog-connect.ts`) rather than by space, since a lighting Control Riser's job is to show which dimmer/DMX universe feeds which fixtures, not which room they're in.

- [ ] **Step 4: Run the suite to verify it passes; commit**

```bash
npm run test:specs
git add src/lib/design/grid-control-riser.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): add controlRiserGraph, lighting/rigging circuiting graph (#41)"
```

- [ ] **Step 5: Add the Control Riser page**

Create `src/app/(app)/design/grid/[id]/control-riser/page.tsx`, following `src/app/(app)/design/grid/[id]/riser/page.tsx` (the existing AV riser page) as the structural template — inline SVG one-line diagram, same render approach, titled "Control Riser" to distinguish it from the existing "Riser sketch" (AV) link.

- [ ] **Step 6: Manual verification + commit**

```bash
git add "src/app/(app)/design/grid/[id]/control-riser/page.tsx" "src/app/(app)/design/grid/[id]/editor.tsx"
git commit -m "feat(grid): add the Control Riser page (#41)"
```

---

### Task 5: "Use Grid BOM if present" pricing seam

**Files:**
- Modify: `src/lib/stores/grid-projects.ts` (new `getProjectByQuoteId`)
- Modify: `scripts/test-review-and-spec.ts`
- Create: `src/lib/design/quick-grid-seam.ts`

**Interfaces:**
- Consumes: `bomTotals()` (`src/lib/design/grid-bom.ts`, existing), `routeLines()` (existing), `GridProject.quoteId` (existing, forward link Grid → quote).
- Produces: `getProjectByQuoteId(quoteId: string): Promise<GridProject | null>` (new reverse lookup — no schema change, no migration, just a filter over `listProjects()`); `priceFromGridOrParametric(quoteId, parametricFallback: () => number): Promise<{ source: "grid" | "parametric"; value: number }>`.

**Note on scope:** this task builds the seam function and proves it with a test; wiring it into the Quick estimator's actual render/save path (`src/app/(app)/design/quick/engine.ts` and wherever its budget total is displayed) is real UI work whose exact call site depends on how that estimator currently structures its total — treat Step 5 below as a recon-then-wire step, same pattern as Task 4.

- [ ] **Step 1: Write the failing test**

```ts
/* --- Quick estimator: use a linked Grid BOM when one exists (#41) --- */
import { getProjectByQuoteId } from "@/lib/stores/grid-projects";
import { priceFromGridOrParametric } from "@/lib/design/quick-grid-seam";

await (async () => {
  const withLink = await createProject({ name: "Linked", customer: "", customerId: null, by: "test" });
  await setQuote(withLink.id, "Q-TEST-SEAM");
  const found = await getProjectByQuoteId("Q-TEST-SEAM");
  ok(found?.id === withLink.id, "quick-grid-seam: getProjectByQuoteId finds the project a quote is linked from");

  const notFound = await getProjectByQuoteId("Q-DOES-NOT-EXIST");
  ok(notFound === null, "quick-grid-seam: getProjectByQuoteId returns null for an unlinked quote");

  const emptyGridResult = await priceFromGridOrParametric("Q-TEST-SEAM", () => 999);
  ok(emptyGridResult.source === "grid", "quick-grid-seam: prices from the Grid BOM when a linked project exists, even an empty one (0, not a fallback to parametric)");

  const fallbackResult = await priceFromGridOrParametric("Q-DOES-NOT-EXIST", () => 999);
  ok(fallbackResult.source === "parametric" && fallbackResult.value === 999, "quick-grid-seam: falls back to the parametric calculator when no Grid project is linked");
})();
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — neither function exists yet.

- [ ] **Step 3: Add `getProjectByQuoteId` to `grid-projects.ts`**

```ts
/** Reverse lookup for the Grid->quote link (GridProject.quoteId is the only
 *  direction stored — beta scale, a filter over listProjects() is fine; add
 *  an index if this ever needs to run somewhere hot). */
export async function getProjectByQuoteId(quoteId: string): Promise<GridProject | null> {
  const all = await listProjects();
  return all.find((p) => p.quoteId === quoteId) || null;
}
```

- [ ] **Step 4: Write `src/lib/design/quick-grid-seam.ts`**

```ts
/**
 * "Estimating consumes a Grid BOM when one exists, else prices
 * parametrically" (#41, Jeff-confirmed). This is the seam: given the quote
 * id the Quick estimator is pricing, look for a linked Grid project; if
 * one exists, its BOM is authoritative (even an empty BOM — an empty,
 * real system is not the same claim as "no system exists yet, guess from
 * dims"). Falls back to the caller's own parametric calculation only when
 * no Grid project links to this quote at all.
 */
import { getProjectByQuoteId } from "@/lib/stores/grid-projects";
import { bomTotals, routeLines } from "@/lib/design/grid-bom";
import { list as listCatalogParts } from "@/lib/stores/catalog";

export async function priceFromGridOrParametric(
  quoteId: string,
  parametricFallback: () => number
): Promise<{ source: "grid" | "parametric"; value: number }> {
  const project = await getProjectByQuoteId(quoteId);
  if (!project) return { source: "parametric", value: parametricFallback() };
  const parts = await listCatalogParts();
  const totals = bomTotals(project.placements || [], parts);
  const wire = routeLines(project.routes || [], parts, project.calibrations || []);
  return { source: "grid", value: totals.value + wire.value };
}
```

- [ ] **Step 5: Run the suite to verify it passes; commit**

```bash
npm run test:specs
git add src/lib/stores/grid-projects.ts src/lib/design/quick-grid-seam.ts scripts/test-review-and-spec.ts
git commit -m "feat(estimating): add priceFromGridOrParametric, the Grid-BOM-if-present seam (#41)"
```

- [ ] **Step 6 (recon-then-wire): call the seam from the Quick estimator**

Read `src/app/(app)/design/quick/engine.ts` to find exactly where the current parametric total is computed and where/if the record already carries a linked `quoteId` (the Quick estimator may not always have one — a design can exist without a quote minted yet; in that case there's nothing to look up and the parametric path is simply always used, which is correct existing behavior, not a bug to fix here). Wire `priceFromGridOrParametric(quoteId, () => <existing parametric total>)` in as a drop-in replacement at that call site, and surface `source` in the UI (a small "Priced from linked Grid design" vs. no badge when parametric) so a user isn't confused about which number they're looking at.

- [ ] **Step 7: Manual verification**

`PGLITE_PATH=/tmp/peak-scratch-grid npm run dev` — open a Quick estimate with no linked Grid project, confirm parametric pricing unchanged; open one with a linked Grid project that has real placements, confirm the total now reflects `bomTotals`/`routeLines` instead of the parametric guess, and the "Priced from linked Grid design" indicator shows.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/design/quick/engine.ts"
git commit -m "feat(estimating): wire the Grid-BOM-if-present seam into the Quick estimator (#41)"
```

---

## Explicitly deferred (not part of this plan)

- **Estimator nav/UI relocation** — "Naming/nav TABLED" (Jeff, locked); the tabs/UI rebuild that would give the estimation-only path its own nav slot is a separate initiative. Task 5 ships the pricing seam without moving anything in the nav.
- **Retiring estimator-side drawing outputs** — the spec's Build task 6 ("once Grid artifacts reach parity"). Parity checklist, for whoever picks this up next: generated base sheet (Task 1 ✓), equipment schedule (already existed pre-this-plan), lineset schedule (Task 4a ✓), Control Riser (Task 4b ✓ — note this is a NEW artifact, not parity with anything the estimator drew before), Quick-estimator pricing seam (Task 5 ✓). Once all of those are live and used in practice for a real job, retiring the old estimator-side plan/schedule renderers is a follow-up punch item — don't do it as part of landing this plan; give it a beta-testing window first.
- **Venue kinds beyond proscenium** (church/flat/gym/blackbox/arena) for the generated base sheet and seeding action — noted in Global Constraints; log as a follow-up punch item once proscenium ships and Jeff has used it.

## Self-Review Notes

- **Spec coverage:** Build tasks 1 (base sheet), 2 (seeding), 4 (artifact derivation), 5 (estimation seam) → Tasks 1, 3, 4, 5 above. Build task 3 (categories toggle) → already shipped (#48), explicitly called out, not re-planned. Build task 6 (retire old outputs) → explicitly deferred above with its parity checklist filled in, not silently dropped. Both spec open-question resolutions (per-project upload prompt; lineset merges into Grid) → Task 2 and Task 4a.
- **Type consistency:** `VenueDims` used identically across Tasks 1/2/3/4a/5 (no second `width` field introduced anywhere, per the Global Constraints rule). `GridSheet.kind`/`venueDims` (Task 1) is the only new field on an existing persisted type in this plan, and it's optional everywhere it's read.
- **Sequencing:** This plan should run after the catalog starter-set import plan lands (Task 3's seeding action and Task 3 Step 7's part-resolution both degrade gracefully — button disabled — if the catalog is still empty, but are much more useful with real parts in place) and before the client-package-generator plan (#40), which the punchlist locks as depending on this plan's artifact relocation.
