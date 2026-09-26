# Grid Drawing Set + Editable Riser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A printable, title-blocked drawing set for every Grid design (T-001 cover, one plan sheet per system, E-501 riser, E-60x schedules at 11×17 or 24×36) and a riser that is an editor: add devices (they land on the plan), connect, edit/delete, add spaces, level lines, conduit annotations and notes, with a saved layout.

**Architecture:** Two pure, client-safe modules own the new logic. `src/lib/design/grid-drawing-set.ts` holds the sheet sizes, the title-block data, revision letters, the per-system sheet list and set settings; `src/lib/design/grid-riser-doc.ts` holds the saved riser document (per option, on the Grid project), its reducer, the layout merge, device-drop geometry and the riser view. Plan-derived facts stay derived (placements, spaces, routes → `riserGraph`); the riser document stores only what the plan cannot know. The set page (`/design/grid/<id>/set`) is a server component that renders every sheet through one `DrawingSheet` + `TitleBlock`; the riser page becomes a client editor that writes through server actions → store functions → `patchDoc`. RiserLinks feed `routeLines` so they price exactly like wire routes; conduits never reach the BOM.

**Tech Stack:** Next.js 16 App Router (server components, server actions, `"use client"` components), TypeScript, the Drizzle doc-store (`grid_projects` JSON docs, `app_settings`), pdf.js (already used by `PdfCanvas`), tsx for the harnesses, headless Chrome (playwright-core in a scratch dir, never a dependency) for print verification.

**Spec:** `docs/superpowers/specs/2026-09-25-grid-drawing-set-and-riser-editor-design.md` (approved by Jeff with mockups, 2026-09-25). The sibling equipment-map spec is a different plan; nothing here depends on it.

## Global Constraints

Copied verbatim from the spec:

- **Title block = A · Architectural side strip**: full-height strip down the right edge — logo + company block, project (name, venue, address), option, **revision table**, drawn/checked/scale/date, sheet title + big sheet number + "n of N" + quote number.
- **Sheet size:** 11×17 (ANSI B landscape) default; per-set switch to 24×36 (ARCH D). Same title block scaled.
- **Sheet set:** T-001 Cover → one plan sheet **per system in scope** (L-101 Lighting, A-101 Audio, V-101 Video, R-101 Rigging & Drapery) → E-501 System riser → E-601 Equipment schedules. Levels (upper/lower) are **not now**.
- **Route:** `/design/grid/<id>/set?option=<id>&size=b|d` — a print view rendering every sheet as a page (`@page { size: 17in 11in }` or `36in 24in`, landscape), printed with the existing `PrintButton` → browser PDF. Same `?option=` resolution as riser/schedule.
- **Title block component** (`src/components/drawing/title-block.tsx`, pure presentational). Border frame + strip layout in one `pk-drawing-sheet` class in `globals.css`.
- **Revisions on sheets:** the revision table lists the project's revisions (D109) as `A, B, C…` in cut order with date and label (the revision's existing note; editable label if none). The set prints at the current state, marked with the latest revision letter; a project with no revisions shows "— Preliminary".
- **T-001 Cover:** project info block, **sheet index** (number + title of every sheet in the set), **symbol legend** (the Grid's stock-symbol legend, D265–D269, only symbols used), **general notes** (project-level notes, editable on the set page; defaults from a Grid Settings "Standard general notes" text).
- **Plan sheets per system:** for each system in scope that has placements, render the plan (base sheet image/PDF page + the placements of that system's groups + that system's wire routes + spaces outlines) fitted to the drawing area, with a scale note (from the sheet calibration; "NTS" when uncalibrated) and a north/stage orientation note. Numbering: L-101, A-101, V-101, R-101 (curtains live on R-101 with rigging).
- **E-601 Equipment schedules:** the existing schedule content (no prices), paginated across as many E-60x sheets as needed.
- **Set settings** (on the set page, saved on the project): size B/D, drawn by, checked by, include/exclude a sheet.
- **Saved riser document** on the Grid project, per option: `riser: { [optionId]: { nodes: Record<spaceId|"unassigned", { x, y, w, h }>, levels: [{ id, label, elevation?, y }], conduits: [{ id, from: EndRef, to: EndRef, label, points? }], notes: [{ id, n, text }], links: [RiserLink] } }` in normalized riser coordinates. On first open the auto layout (`riserGraph`, `grid-riser.ts`) seeds node positions; after that the saved positions win and new spaces get an auto slot.
- **Tools:** + Device, Connect, Conduit, Level line, Space, Note, Print. + Device creates normal `GridPlacement`s on the plan, inside that space (centroid, spread so multiples don't stack; "Unassigned": the plan's lower margin). Edit/delete a device row edits the underlying placements (qty change adds/removes placements in that space). Connect: if both ends are placements on the same sheet → a `GridRoute` (straight, both endpoints snapped) so it prices by measured length; otherwise → a `RiserLink { id, from, to, partId, lengthFt }` with a typed length that feeds the BOM/quote like a route. Riser edges show both kinds. Space: a small rectangular space on the plan's lower margin. Level line: horizontal dashed line with label + optional elevation; drag to move. **Conduit: dashed annotation, never priced, not in the BOM.** Note: numbered general notes block on the riser sheet.
- **Permissions:** same as editing the Grid project. Every write goes through the existing Grid project actions and `patchDoc` persistence; revisions snapshot the riser document with the rest of the option.
- Gates: tsc, eslint, test:specs, regressions, test:smoke, `next build`. Print: headless print-to-PDF of the set at B and D sizes has the right page count and page size.
- Out of scope: Levels (upper/lower plan sheets); details/elevations sheets; DWG export; the one-proposal-across-options document.

Project and environment rules (binding):

- Worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/grid-estimate-drawings`, branch `feat/grid-estimate-drawings`. Start every shell with `cd /Users/sm/Downloads/peak-app/.claude/worktrees/grid-estimate-drawings && export PATH=$HOME/.local/node/bin:$PATH`. Never `cd` to `/Users/sm/Downloads/peak-app` itself, never open any `.data/pglite`, never `git stash` (commit instead).
- `"use client"` files never import a VALUE from `@/lib/stores/*` or `@/db/*` (breaks `next build`; `import type` is fine). Anything a client file imports from `src/lib/design/*` must itself stay pure.
- Accent colour only through `var(--accent)` (CSS) or the settings `accent` handed to `PrintButton` — never hardcode accent-coloured UI. Use the `pk-*` classes. Timestamps are epoch-ms numbers.
- Destructive UI goes through `src/components/confirm-button.tsx` `ConfirmButton`; its `onConfirm` must throw when an action returns `{ ok: false }`.
- Grid writes go through Grid project server actions → store functions → `patchDoc`. Conduits are never priced.
- Placeholders: punch item `#209`, decisions `D287` … `D293`, harness labels `#209`. The lead renumbers at merge — do not invent real numbers.
- Commit with `git -c user.name="SM" commit`, message ending with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.
- Gates (every task): `npx tsc --noEmit` prints nothing; `npx eslint 2>&1 | tail -1` prints `✖ 111 problems (0 errors, 111 warnings)` (the baseline — a task may not add a warning); `npm run test:specs` ends `ALL PASSED`. Task 4 and Task 8 also run `D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH=$D npx tsx scripts/test-review-regressions.ts` (ends `review regression checks passed`). Tasks that touch a client component or anything a client component imports (4, 5, 6, 7, 8) also run `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build` (exit 0) and then `rm -rf .next`. `npm run test:smoke` runs in Tasks 7 and 8 (it boots its own server on a throwaway datadir). The only other server this plan starts is Task 8's scratch-datadir print server.

### Before Task 1 — worktree setup (once)

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/grid-estimate-drawings && export PATH=$HOME/.local/node/bin:$PATH
git status --short        # expect clean
[ -d node_modules ] || npm ci --no-audit --no-fund     # never symlink node_modules
[ -f next-env.d.ts ] || printf '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n' > next-env.d.ts
[ -f .env.local ] || printf 'AUTH_SECRET=%s\nAUTH_DEV_LOGIN=true\nAUTH_TRUST_HOST=true\n' "$(openssl rand -base64 32)" > .env.local
git check-ignore -q next-env.d.ts .env.local && echo "both ignored"   # both are gitignored; never commit them
npx tsc --noEmit && npx eslint 2>&1 | tail -1   # baseline: ✖ 111 problems (0 errors, 111 warnings)
```

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `src/lib/design/grid-scopes.ts` | Modify (T1) | `DRAWING_SYSTEMS` + `drawingSystemOf` — the system ↔ scope mapping, beside the Scope panel's taxonomy. |
| `src/lib/design/grid-drawing-set.ts` | Create (T1) | Pure: sheet sizes, CSS vars, `@page`, fit/scale notes, revision letters/rows, title-block data, set-settings cleaning, general notes, per-system plan grouping/filtering, the numbered sheet list. |
| `src/lib/design/grid-schedule.ts` | Create (T1) | Pure: the equipment-schedule builder (shared by `/schedule` and E-60x) + pagination. |
| `src/components/drawing/title-block.tsx` | Create (T2) | Pure presentational title strip. |
| `src/components/drawing/drawing-sheet.tsx` | Create (T2) | One sheet: size variables, border frame, drawing area, title strip. |
| `src/app/globals.css` | Modify (T2) | `pk-drawing-*`, `pk-title-strip`, `pk-tb-*`, `pk-dw-*`, `pk-plan-*`, `pk-riser-notes`, print rules. |
| `src/lib/design/grid-riser-doc.ts` | Create (T3) | Pure: riser document types, normalize, layout merge, reducer, device-drop geometry, connect rule, prune/copy, `buildRiserView`. |
| `src/lib/design/grid-bom.ts` | Modify (T3) | `routeLines(routes, parts, cals, links = [])` — RiserLink footage. |
| `src/lib/design/grid-options.ts` | Modify (T3) | `copyOptionMembers` also returns `idMap`. |
| `src/lib/stores/grid-projects.ts` | Modify (T4) | `riser` + `drawingSet` fields; revision snapshot/restore; option copy/remove; delete cascades; `setDrawingSet`. |
| `src/lib/stores/grid-riser.ts` | Create (T4) | Riser store: `patchRiser`, `addRiserLink`, `addDevicesToNode`, `setNodeDeviceQty`, `replaceNodeDevicePart`, `removeNodeDevices`. |
| `src/lib/design/grid-part-lookup.ts` | Create (T4) | Server-only `partForGrid` (moved out of `actions.ts` so the riser actions share it). |
| `src/app/(app)/design/grid/[id]/actions.ts` | Modify (T4) | Imports `partForGrid`. |
| `src/app/(app)/design/grid/[id]/riser/actions.ts` | Create (T4) | Riser server actions. |
| `src/app/(app)/design/grid/[id]/set/actions.ts` | Create (T4) | `saveDrawingSetAction`. |
| `src/app/(app)/design/grid/settings/actions.ts` | Modify (T4) | `saveStandardNotesAction`. |
| `src/lib/settings.ts` | Modify (T4) | `gridStandardNotes`. |
| `src/lib/design/grid-quote.ts` | Modify (T4) | RiserLinks into the quote's wire lines. |
| `src/app/(app)/design/grid/[id]/page.tsx`, `editor.tsx` | Modify (T4, T5, T7) | `riser` prop + BOM sidebar counts links (T4); `gridPartsFrom` (T5); "Drawing set →" link (T7). |
| `src/lib/design/grid-parts.ts` | Create (T5) | Pure `gridPartsFrom` — the one PartLite builder for plan, riser, set and schedule. |
| `src/lib/design/grid-riser-view.ts` | Create (T5) | Pure `riserViewForOption` (graph + saved doc + symbol looks). |
| `src/components/drawing/riser-canvas.tsx` | Create (T5) | Pure SVG riser renderer (+ `RiserNotes`), used by the editor and by E-501. |
| `src/app/(app)/design/grid/[id]/riser/page.tsx` | Rewrite (T5), modify (T6) | Server loader for the riser editor. |
| `src/app/(app)/design/grid/[id]/riser/riser-editor.tsx` | Create (T5), replace (T6) | Client riser editor. |
| `src/app/(app)/design/grid/[id]/riser/riser-panels.tsx` | Create (T5), extend (T6) | Client tool panels. |
| `src/components/design/sheet-aspect.ts` | Create (T6) | Browser helper: a sheet page's height ÷ width (image or PDF). |
| `src/app/(app)/design/grid/[id]/set/page.tsx` | Create (T7) | The drawing set. |
| `src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx` | Create (T7) | Client plan figure (image/PDF + overlay + scale caption). |
| `src/app/(app)/design/grid/[id]/set/set-settings-panel.tsx` | Create (T7) | Client set settings. |
| `src/app/(app)/design/grid/[id]/schedule/page.tsx` | Rewrite (T7) | Uses `buildSchedule` + the riser view (links included). |
| `src/app/(app)/design/grid/settings/standard-notes-card.tsx`, `page.tsx` | Create / Modify (T7) | "Standard general notes" card. |
| `scripts/smoke-routes.ts` | Modify (T7) | The set route at both sizes. |
| `scripts/fixture-grid-drawing-set.ts` | Create (T8) | Scratch-DB fixture for print verification. |
| `scripts/test-review-and-spec.ts` | Modify (T1–T7) | Pure `#209` blocks appended at EOF (+ one existing #206 check re-pointed in T5). |
| `scripts/test-review-regressions.ts` | Modify (T4) | DB-backed `#209` block. |
| `DECISIONS.md`, `PUNCHLIST.md` | Modify (T9) | `D287…D293`, `#209`. |

**Harness rules.** Append new `scripts/test-review-and-spec.ts` blocks at the very end of the file (after the closing `}` of `gridSymbolLookAsyncChecks`). Top-level `import` lines may sit anywhere (they hoist), but a binding may be imported only once in the whole file — a duplicate kills the suite. These are already imported and must be **reused, not re-imported**: `readFileSync`, `join`, `routeLines`, `riserGraph`, `copyOptionMembers`, `pointInPolygon`, `polygonArea`, `symbolContext`, `symbolLook`, `legendRows`, `symH` (React `createElement`), `symRender` (`renderToStaticMarkup`), `ok`. Every new binding in the imports below was checked absent on 2026-09-25. Blocks are wrapped in `{ … }` so their locals never collide. The DB-backed regressions harness gets its block inside `main()`, immediately before `console.log("review regression checks passed");`, using dynamic `await import(...)`.

---

### Task 1: Pure drawing-set model (sizes, revisions, title-block data, systems, sheet list, schedule)

**Files:**
- Modify: `src/lib/design/grid-scopes.ts` (append at end of file)
- Create: `src/lib/design/grid-drawing-set.ts`
- Create: `src/lib/design/grid-schedule.ts`
- Test: `scripts/test-review-and-spec.ts` (append block at EOF)

**Interfaces:**
- Consumes: `scopeOfPart`, `GridLayer`, `ScopedPartLite`, `UNSCOPED` (grid-scopes); `formatMeasure`, `MeasureUnit`, `Point` (`@/lib/annotations`); `spaceOf`, `SpaceLite` (grid-geometry); `curtainDesc`, `GridCurtain` (grid-bom).
- Produces (grid-scopes): `type DrawingSystemKey = "lighting" | "audio" | "video" | "rigging" | "general"`; `type DrawingSystem = { key; prefix; title; scopes: readonly GridLayer[] }`; `DRAWING_SYSTEMS: readonly DrawingSystem[]` (order L, A, V, R, G); `drawingSystemOf(scope: GridLayer): DrawingSystemKey`.
- Produces (grid-drawing-set):
  - `SHEET_SIZES: { b: {key,label,w:17,h:11,k:1,screenZoom}, d: {key,label,w:36,h:24,k:36/17,screenZoom} }`, `type SheetSizeKey = "b" | "d"`, `SHEET_MARGIN_IN`, `TITLE_STRIP_IN`, `AREA_PAD_IN`, `isSheetSize(v): v is SheetSizeKey`, `resolveSheetSize(requested?: string | null, saved?: SheetSizeKey | null): SheetSizeKey`, `drawingArea(size): { w: number; h: number }` (inches), `sheetCssVars(size): Record<string, string>`, `printPageCss(size): string`, `fitBox(areaW, areaH, aspect): { w; h }`, `scaleNote(cal: { scale: number; unit: MeasureUnit } | null | undefined, printedWidthIn: number): string`.
  - `revLetter(index: number): string`, `type RevisionLite = { rev; at; note; reason: "manual" | "quote" | "restore" }`, `type RevisionRow = { rev; letter; date; label }`, `revisionRows(revisions?: RevisionLite[], labels?: Record<string, string>): RevisionRow[]`, `revisionStatus(rows): string`, `REV_ROWS = 6`.
  - `type DrawingSetSettings = { size?; drawnBy?; checkedBy?; excluded?: string[]; generalNotes?: string; revisionLabels?: Record<string, string> }`, `cleanDrawingSet(raw: unknown): DrawingSetSettings`, `GENERAL_NOTES_MAX = 4000`, `cleanStandardNotes(raw: unknown): string | null`, `resolveGeneralNotes(set, standard): string[]`.
  - `type TitleBlockData` (see code), `titleBlockData(input: TitleBlockInput): TitleBlockData`.
  - `placementScope(pl, partById): GridLayer`, `placementSystem(...)`, `routeSystem(...)`, `type PlanGroup = { system; sheetId; page }`, `planSheetGroups({ sheetOrder, placements, routes, partById }): PlanGroup[]`, `planContent({ group, placements, routes, spaces, partById })`.
  - `type DrawingSheetDef = { key; kind: "cover" | "plan" | "riser" | "schedule"; number; title; system?; sheetId?; page?; schedulePage? }`, `sheetExclusionKey(d)`, `buildSheetList({ planGroups, sourceNames, schedulePages, excluded? }): { all; included }`, `toggleableSheets(all): Array<{ key; label }>`.
- Produces (grid-schedule): `type ScheduleRow`, `ScheduleSection`, `ScheduleWire = { id; partId; fromName; toName; lengthFt: number | null; unit }`, `ScheduleData = { sections; wires; deviceCount; wireFeet: Array<{ partId; ft; unit; unmeasured }> }`, `buildSchedule({ placements, spaces, descOf, wires }): ScheduleData`, `type ScheduleItem`, `type ScheduleGroup = { head; rows }`, `scheduleGroups(data): ScheduleGroup[]`, `paginateSchedule(groups, perColumn = 30, columns = 2): ScheduleItem[][][]` (pages → columns → items).

- [ ] **Step 1: Write the failing test** — append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* --- #209 grid drawing set — Task 1: sheet-set model --- */
import {
  SHEET_SIZES, REV_ROWS, drawingArea, resolveSheetSize, sheetCssVars, printPageCss, fitBox, scaleNote,
  revLetter, revisionRows, revisionStatus, titleBlockData, cleanDrawingSet, cleanStandardNotes, resolveGeneralNotes,
  placementScope, planSheetGroups, planContent, buildSheetList, toggleableSheets,
} from "@/lib/design/grid-drawing-set";
import { DRAWING_SYSTEMS, drawingSystemOf } from "@/lib/design/grid-scopes";
import { buildSchedule, scheduleGroups, paginateSchedule } from "@/lib/design/grid-schedule";

{
  // sizes
  ok(JSON.stringify(drawingArea("b")) === JSON.stringify({ w: 13.3, h: 9.8 }), "#209 sizes: the 11×17 drawing area is 13.3 × 9.8 in");
  ok(drawingArea("d").w > 2 * drawingArea("b").w && SHEET_SIZES.d.w === 36 && SHEET_SIZES.d.h === 24, "#209 sizes: 24×36 is the same layout scaled up");
  ok(resolveSheetSize("d", "b") === "d" && resolveSheetSize("x", "d") === "d" && resolveSheetSize(undefined, undefined) === "b", "#209 sizes: ?size= wins, then the saved size, then 11×17");
  ok(printPageCss("d").includes("size: 36in 24in") && printPageCss("b").includes("size: 17in 11in") && printPageCss("b").includes("margin: 0"), "#209 sizes: @page matches the sheet");
  ok(sheetCssVars("b")["--dw-strip"] === "2.5in" && sheetCssVars("d")["--dw-w"] === "36in" && sheetCssVars("d")["--dw-k"] === "2.118", "#209 sizes: CSS variables come from one table");
  ok(JSON.stringify(fitBox(13.3, 9.8, 0.5)) === JSON.stringify({ w: 13.3, h: 6.65 }) && JSON.stringify(fitBox(13.3, 9.8, 1)) === JSON.stringify({ w: 9.8, h: 9.8 }) && fitBox(10, 10, 0).w === 0, "#209 fit: a plan fits the drawing area by its limiting side");
  ok(scaleNote({ scale: 100, unit: "ft" }, 10) === `1" = 10'-0"` && scaleNote(null, 10) === "NTS" && scaleNote({ scale: 100, unit: "ft" }, 0) === "NTS", "#209 scale: from the calibration and the printed width, NTS when uncalibrated");

  // revisions
  ok([0, 25, 26, 27].map(revLetter).join() === "A,Z,AA,AB", "#209 revisions: letters run A…Z, AA…");
  const gdsRevs = [
    { rev: 2, at: 2000, note: "", reason: "quote" as const },
    { rev: 1, at: 1000, note: "Schematic", reason: "manual" as const },
    { rev: 3, at: 3000, note: "", reason: "manual" as const },
  ];
  const gdsRows = revisionRows(gdsRevs, { "3": "Owner comments" });
  ok(gdsRows.map((r) => `${r.letter}:${r.label}`).join("|") === "A:Schematic|B:Issued with quote|C:Owner comments", "#209 revisions: cut order; the note, else an editable label, else the reason");
  ok(revisionStatus(gdsRows) === "Rev C" && revisionStatus([]) === "— Preliminary", "#209 revisions: the set is marked with the latest letter, or Preliminary");

  // title-block data
  const tbBase = {
    company: {
      name: "Peak Systems Group",
      logoDark: null,
      offices: [
        { street: "1 A St", city: "Appleton", state: "WI", zip: "54911", phone: "920-555-0100" },
        { street: "9 B St", city: "Madison", state: "WI", zip: "53703", phone: "608-555-0100", quoteDefault: true },
      ],
    },
    project: { id: "GRD-5009", name: "Main Stage", customer: "Lakefront", siteName: "", intake: { venueName: "Lakefront PAC", address: "12 Shore Dr" }, createdBy: "Jeff" },
    option: { name: "Better", quoteId: "Q-2100" },
    optionCount: 1,
    revisions: [],
    set: undefined,
    sheet: { number: "L-101", title: "Lighting plan", scale: "AS NOTED" },
    index: 2,
    total: 5,
    now: 5000,
  };
  const tb0 = titleBlockData(tbBase);
  ok(tb0.status === "— Preliminary" && tb0.revisions.length === 0, "#209 title block: no revisions → Preliminary");
  ok(tb0.optionName === null && tb0.company.addressLines.join("|") === "9 B St|Madison, WI 53703" && tb0.company.phone === "608-555-0100", "#209 title block: one option hides the option row; the quote-default office supplies the address");
  ok(tb0.project.venue === "Lakefront PAC" && tb0.project.address === "12 Shore Dr" && tb0.drawnBy === "Jeff" && tb0.checkedBy === "" && tb0.sheet.index === 2 && tb0.sheet.total === 5 && tb0.quoteId === "Q-2100", "#209 title block: venue falls back to intake, drawn-by to the creator");
  const tbMany = revisionRows(Array.from({ length: 8 }, (_, i) => ({ rev: i + 1, at: i, note: `r${i + 1}`, reason: "manual" as const })));
  const tb1 = titleBlockData({ ...tbBase, optionCount: 2, revisions: tbMany, set: { drawnBy: "SM", checkedBy: "JC" } });
  ok(tb1.optionName === "Better" && tb1.revisions.length === REV_ROWS && tb1.revisions[0].letter === "H" && tb1.earlierRevisions === 2 && tb1.status === "Rev H", "#209 title block: newest revisions first, capped, with a count of earlier ones");
  ok(tb1.drawnBy === "SM" && tb1.checkedBy === "JC", "#209 title block: set settings override drawn/checked");

  // settings cleaning + notes
  const gdsClean = cleanDrawingSet({ size: "z", drawnBy: "  Jeff  ", excluded: ["riser", "riser", 3, ""], generalNotes: "", revisionLabels: { "2": " Bid ", x: "no", "3": "" } });
  ok(!("size" in gdsClean) && gdsClean.drawnBy === "Jeff" && JSON.stringify(gdsClean.excluded) === '["riser"]' && gdsClean.generalNotes === "" && JSON.stringify(gdsClean.revisionLabels) === '{"2":"Bid"}', "#209 set settings: cleaned, deduped, blank notes kept as an explicit empty");
  ok(cleanStandardNotes("  \n ") === null && cleanStandardNotes(" 1. Verify ") === "1. Verify", "#209 standard notes: blank clears to null");
  ok(resolveGeneralNotes(undefined, "1. Verify in field\n2) Coordinate with EC\n\n").join("|") === "Verify in field|Coordinate with EC" && resolveGeneralNotes({ generalNotes: "" }, "Std").length === 0, "#209 notes: the standard notes are the default, an explicit empty wins, numbering is stripped");

  // systems + plan grouping
  ok(DRAWING_SYSTEMS.map((s) => s.prefix).join("") === "LAVRG" && drawingSystemOf("Curtains") === "rigging" && drawingSystemOf("Unscoped") === "general", "#209 systems: L, A, V, R (rigging + curtains), G for unscoped");
  const gdsParts = new Map<string, { group?: string; trade?: string }>([["FIX", { group: "Fixtures" }], ["SPK", { group: "Speakers" }], ["TRK", { trade: "Rigging" }], ["MYST", {}], ["CBL", {}]]);
  ok(placementScope({ partId: "FIX", curtain: { name: "x" } }, gdsParts) === "Curtains", "#209 systems: a curtain is Curtains whatever its fabric part");
  const gdsPl = [
    { id: "p1", sheetId: "s1", page: 1, partId: "FIX" },
    { id: "p2", sheetId: "s2", page: 1, partId: "FIX" },
    { id: "p3", sheetId: "s1", page: 1, partId: "SPK" },
    { id: "p4", sheetId: "s1", page: 2, partId: "TRK" },
    { id: "p5", sheetId: "s1", page: 1, partId: "FAB", curtain: { name: "Main" } },
    { id: "p6", sheetId: "s1", page: 1, partId: "MYST" },
  ];
  const gdsRt = [
    { id: "r1", sheetId: "s1", page: 1, partId: "CBL", fromPlacementId: "p3" },
    { id: "r2", sheetId: "s1", page: 1, partId: "CBL" },
  ];
  const gdsGroups = planSheetGroups({ sheetOrder: ["s2", "s1"], placements: gdsPl, routes: gdsRt, partById: gdsParts });
  ok(gdsGroups.map((g) => `${g.system}:${g.sheetId}:${g.page}`).join("|") === "lighting:s2:1|lighting:s1:1|audio:s1:1|rigging:s1:1|rigging:s1:2|general:s1:1", "#209 plan sheets: one per system per source page, in sheet order");
  const gdsAudio = planContent({ group: { system: "audio", sheetId: "s1", page: 1 }, placements: gdsPl, routes: gdsRt, spaces: [{ id: "sp", sheetId: "s1", page: 1 }, { id: "sp2", sheetId: "s1", page: 2 }], partById: gdsParts });
  ok(gdsAudio.placements.map((p) => p.id).join() === "p3" && gdsAudio.routes.map((r) => r.id).join() === "r1" && gdsAudio.spaces.map((s) => s.id).join() === "sp", "#209 plan sheets: a system sheet shows its own devices, the wires they terminate, and that page's spaces");
  const gdsGeneral = planContent({ group: { system: "general", sheetId: "s1", page: 1 }, placements: gdsPl, routes: gdsRt, spaces: [], partById: gdsParts });
  ok(gdsGeneral.placements.map((p) => p.id).join() === "p6" && gdsGeneral.routes.map((r) => r.id).join() === "r2", "#209 plan sheets: unscoped devices and free unscoped wires go on the G sheet");

  // sheet list
  const gdsList = buildSheetList({ planGroups: gdsGroups, sourceNames: { s1: "Main floor", s2: "Balcony" }, schedulePages: 2, excluded: ["plan:lighting:s2:1", "schedule"] });
  ok(gdsList.all.map((d) => d.number).join() === "T-001,L-101,L-102,A-101,R-101,R-102,G-101,E-501,E-601,E-602", "#209 sheet list: numbering T → L/A/V/R/G → E-501 → E-60x");
  ok(gdsList.all[1].title === "Lighting plan — Balcony" && gdsList.all[3].title === "Audio plan" && gdsList.all[5].title === "Rigging & drapery plan — Main floor, p. 2", "#209 sheet list: titles name the source only when a system spans pages");
  ok(gdsList.included.map((d) => d.number).join() === "T-001,L-102,A-101,R-101,R-102,G-101,E-501", "#209 sheet list: excluded sheets drop out, numbers stay stable");
  const gdsToggles = toggleableSheets(gdsList.all);
  ok(gdsToggles.filter((t) => t.key === "schedule").length === 1 && gdsToggles.length === gdsList.all.length - 1, "#209 sheet list: the schedule pages toggle as one");

  // schedule
  const gdsSch = buildSchedule({
    placements: [
      { id: "q1", sheetId: "s1", page: 1, x: 0.1, y: 0.1, partId: "FIX" },
      { id: "q2", sheetId: "s1", page: 1, x: 0.2, y: 0.1, partId: "FIX" },
      { id: "q3", sheetId: "s1", page: 1, x: 0.9, y: 0.9, partId: "GONE" },
      { id: "q4", sheetId: "s1", page: 1, x: 0.3, y: 0.3, partId: "FAB", curtain: { type: "Draw", name: "Main", widthFt: 40, heightFt: 20, fullnessPct: 50, fabricSku: "FAB" } },
    ],
    spaces: [{ id: "sa", sheetId: "s1", page: 1, name: "Stage", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }] }],
    descOf: (id) => ({ FIX: "Fixture", FAB: "Velour" } as Record<string, string>)[id],
    wires: [
      { id: "w1", partId: "W", fromName: "Stage", toName: "Unassigned", lengthFt: 10.5, unit: "ft" },
      { id: "w2", partId: "W", fromName: "Stage", toName: "Stage", lengthFt: null, unit: "ft" },
    ],
  });
  ok(gdsSch.sections.map((s) => s.name).join() === "Stage,Unassigned" && gdsSch.sections[0].rows[0].qty === 2 && gdsSch.sections[0].rows[1].code === "CURTAIN", "#209 schedule: per-space rows, curtains one per drop");
  ok(gdsSch.sections[1].rows[0].desc === "(no longer in the catalog)" && gdsSch.deviceCount === 3, "#209 schedule: a missing part stays visible; curtains aren't counted as devices");
  ok(gdsSch.wireFeet.length === 1 && gdsSch.wireFeet[0].ft === 10.5 && gdsSch.wireFeet[0].unmeasured === 1, "#209 schedule: footage rolls up per wire part");
  ok(scheduleGroups(gdsSch).length === 3 && scheduleGroups(gdsSch)[2].head.kind === "wires", "#209 schedule: wire runs follow the spaces");
  const gdsBig = [{ head: { kind: "section" as const, name: "Big", cont: false }, rows: Array.from({ length: 60 }, (_, i) => ({ kind: "row" as const, qty: 1, code: `P${i}`, desc: "d" })) }];
  const gdsPages = paginateSchedule(gdsBig, 24, 2);
  const gdsTop = gdsPages[1][0][0];
  ok(gdsPages.length === 2 && gdsPages[0].length === 2 && gdsPages[1][0].length === 15 && gdsTop.kind === "section" && gdsTop.cont, "#209 schedule: rows paginate across E-60x sheets, repeating the section head");
  const gdsTight = paginateSchedule([
    { head: { kind: "section", name: "A", cont: false }, rows: Array.from({ length: 4 }, () => ({ kind: "row" as const, qty: 1, code: "a", desc: "a" })) },
    { head: { kind: "section", name: "B", cont: false }, rows: [{ kind: "row", qty: 1, code: "b", desc: "b" }] },
  ], 5, 2);
  ok(gdsTight.every((pg) => pg.every((col) => !col.length || col[col.length - 1].kind === "row")), "#209 schedule: a section head never ends a column");
  ok(paginateSchedule([], 24, 2).length === 1, "#209 schedule: an empty schedule is still one sheet");
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the harness aborts before any PASS line with `Cannot find module '@/lib/design/grid-drawing-set'` (or `DRAWING_SYSTEMS` not exported).

- [ ] **Step 3: Append the drawing systems to `src/lib/design/grid-scopes.ts`** (at the end of the file):

```ts
/* ---------------------------- drawing systems ---------------------------- */

/**
 * Drawing-set systems (drawing set spec 2026-09-25 §3, #209). One plan-sheet
 * family per system, keyed off the SAME scope taxonomy the Scope panel uses
 * (scopeOfPart above), so re-mapping a catalog category re-files its devices
 * on the drawings too. Curtains print with rigging on the R-sheets. `general`
 * is the catch-all for Unscoped devices (D288): the spec lists four
 * systems, but a device with no scope must never silently vanish from a set.
 */
export type DrawingSystemKey = "lighting" | "audio" | "video" | "rigging" | "general";

export type DrawingSystem = {
  key: DrawingSystemKey;
  /** Sheet-number prefix: L-101, A-101, V-101, R-101, G-101. */
  prefix: string;
  title: string;
  scopes: readonly GridLayer[];
};

/** Sheet order in the set. */
export const DRAWING_SYSTEMS: readonly DrawingSystem[] = [
  { key: "lighting", prefix: "L", title: "Lighting plan", scopes: ["Lighting"] },
  { key: "audio", prefix: "A", title: "Audio plan", scopes: ["Audio"] },
  { key: "video", prefix: "V", title: "Video plan", scopes: ["Video"] },
  { key: "rigging", prefix: "R", title: "Rigging & drapery plan", scopes: ["Rigging", "Curtains"] },
  { key: "general", prefix: "G", title: "General devices plan", scopes: [UNSCOPED] },
];

export function drawingSystemOf(scope: GridLayer): DrawingSystemKey {
  return DRAWING_SYSTEMS.find((s) => s.scopes.includes(scope))?.key ?? "general";
}
```

- [ ] **Step 4: Create `src/lib/design/grid-drawing-set.ts`**

```ts
/**
 * The Grid — drawing set model (drawing set spec 2026-09-25, #209).
 *
 * Pure and dependency-free (the grid-bom rule): the set page (server), the
 * title block, the plan-sheet figure (a client component) and the spec
 * harness all import it. No doc-store, no DB.
 *
 * One table (SHEET_SIZES + the three inch constants) is the single source of
 * truth for sheet geometry: DrawingSheet turns it into CSS variables, the
 * set page turns it into @page, and the plan figure fits the plan into the
 * same drawing area — so screen, print and PDF can never disagree.
 */

import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import {
  DRAWING_SYSTEMS,
  drawingSystemOf,
  scopeOfPart,
  type DrawingSystemKey,
  type GridLayer,
  type ScopedPartLite,
} from "./grid-scopes";

/* ------------------------------ sheet sizes ------------------------------ */

/** 11×17 (ANSI B) is the default; 24×36 (ARCH D) is the same layout scaled
 *  by k (the title strip, borders and type all multiply by k). */
export const SHEET_SIZES = {
  b: { key: "b", label: "11×17 (ANSI B)", w: 17, h: 11, k: 1, screenZoom: 0.6 },
  d: { key: "d", label: "24×36 (ARCH D)", w: 36, h: 24, k: 36 / 17, screenZoom: 0.28 },
} as const;

export type SheetSizeKey = keyof typeof SHEET_SIZES;

/** Paper edge → border frame, in inches at k = 1. */
export const SHEET_MARGIN_IN = 0.375;
/** Title strip width, in inches at k = 1. */
export const TITLE_STRIP_IN = 2.5;
/** Frame → drawing content padding, in inches at k = 1. */
export const AREA_PAD_IN = 0.2;
/** Border hairlines, so a fitted figure never spills a pixel past the frame. */
const BORDER_ALLOW_IN = 0.05;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function isSheetSize(v: unknown): v is SheetSizeKey {
  return v === "b" || v === "d";
}

/** `?size=` wins, then the project's saved size, then 11×17. */
export function resolveSheetSize(requested: string | null | undefined, saved: SheetSizeKey | null | undefined): SheetSizeKey {
  if (isSheetSize(requested)) return requested;
  if (isSheetSize(saved)) return saved;
  return "b";
}

/** The drawing area inside the frame and left of the strip, in inches. */
export function drawingArea(size: SheetSizeKey): { w: number; h: number } {
  const s = SHEET_SIZES[size];
  const m = SHEET_MARGIN_IN * s.k;
  const strip = TITLE_STRIP_IN * s.k;
  const pad = AREA_PAD_IN * s.k;
  const allow = BORDER_ALLOW_IN * s.k;
  return { w: r3(s.w - 2 * m - strip - 2 * pad - allow), h: r3(s.h - 2 * m - 2 * pad - allow) };
}

/** CSS custom properties DrawingSheet sets on `.pk-drawing-sheet`. */
export function sheetCssVars(size: SheetSizeKey): Record<string, string> {
  const s = SHEET_SIZES[size];
  return {
    "--dw-w": `${s.w}in`,
    "--dw-h": `${s.h}in`,
    "--dw-k": String(r3(s.k)),
    "--dw-m": `${r3(SHEET_MARGIN_IN * s.k)}in`,
    "--dw-strip": `${r3(TITLE_STRIP_IN * s.k)}in`,
    "--dw-pad": `${r3(AREA_PAD_IN * s.k)}in`,
  };
}

/** The set page's print rule: one sheet per page, edge to edge, landscape. */
export function printPageCss(size: SheetSizeKey): string {
  const s = SHEET_SIZES[size];
  return `@media print { @page { size: ${s.w}in ${s.h}in; margin: 0; } }`;
}

/** Largest box of the given aspect (height ÷ width) that fits the area. */
export function fitBox(areaW: number, areaH: number, aspect: number): { w: number; h: number } {
  if (!(aspect > 0) || !(areaW > 0) || !(areaH > 0)) return { w: 0, h: 0 };
  const w = Math.min(areaW, areaH / aspect);
  return { w: r3(w), h: r3(w * aspect) };
}

/**
 * Printed scale for a plan: the calibration says how many real units span the
 * full page width (lib/annotations calibrationScale), and the page prints
 * `printedWidthIn` wide — so one printed inch is scale ÷ printedWidthIn.
 * "NTS" whenever the page is uncalibrated (a scale must never be guessed).
 */
export function scaleNote(cal: { scale: number; unit: MeasureUnit } | null | undefined, printedWidthIn: number): string {
  if (!cal || !(cal.scale > 0) || !(printedWidthIn > 0)) return "NTS";
  return `1" = ${formatMeasure(cal.scale / printedWidthIn, cal.unit)}`;
}

/* ------------------------------- revisions ------------------------------- */

/** 0 → A … 25 → Z, 26 → AA, 27 → AB … */
export function revLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** The slice of GridRevision the title block needs. */
export type RevisionLite = { rev: number; at: number; note: string; reason: "manual" | "quote" | "restore" };

export type RevisionRow = { rev: number; letter: string; date: number; label: string };

const REASON_LABEL: Record<RevisionLite["reason"], string> = {
  manual: "Design saved",
  quote: "Issued with quote",
  restore: "Earlier revision recalled",
};

/** How many revision rows the title strip prints (newest first). */
export const REV_ROWS = 6;

/**
 * Every revision, lettered in cut order. Label = the revision's own note,
 * else the set's editable label for it, else a plain-English reason.
 */
export function revisionRows(revisions: RevisionLite[] | undefined, labels?: Record<string, string>): RevisionRow[] {
  return [...(revisions || [])]
    .sort((a, b) => a.rev - b.rev)
    .map((r, i) => ({
      rev: r.rev,
      letter: revLetter(i),
      date: r.at,
      label: (r.note || "").trim() || (labels?.[String(r.rev)] || "").trim() || REASON_LABEL[r.reason] || "Revision",
    }));
}

/** "Rev C" — or "— Preliminary" for a design never snapshotted. */
export function revisionStatus(rows: RevisionRow[]): string {
  return rows.length ? `Rev ${rows[rows.length - 1].letter}` : "— Preliminary";
}

/* ----------------------------- set settings ----------------------------- */

/** Saved on the Grid project (`drawingSet`). Every key optional. */
export type DrawingSetSettings = {
  size?: SheetSizeKey;
  drawnBy?: string;
  checkedBy?: string;
  /** Sheet exclusion keys (sheetExclusionKey). */
  excluded?: string[];
  /** Present (even "") = this set's own notes; absent = the standard notes. */
  generalNotes?: string;
  /** Labels for revisions that have no note, keyed by rev number. */
  revisionLabels?: Record<string, string>;
};

export const GENERAL_NOTES_MAX = 4000;

export function cleanDrawingSet(raw: unknown): DrawingSetSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: DrawingSetSettings = {};
  if (isSheetSize(r.size)) out.size = r.size;
  if (typeof r.drawnBy === "string") out.drawnBy = r.drawnBy.trim().slice(0, 60);
  if (typeof r.checkedBy === "string") out.checkedBy = r.checkedBy.trim().slice(0, 60);
  if (Array.isArray(r.excluded)) {
    const keys = r.excluded.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 160);
    out.excluded = Array.from(new Set(keys)).slice(0, 100);
  }
  if (typeof r.generalNotes === "string") out.generalNotes = r.generalNotes.replace(/\r\n/g, "\n").slice(0, GENERAL_NOTES_MAX);
  if (r.revisionLabels && typeof r.revisionLabels === "object" && !Array.isArray(r.revisionLabels)) {
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.revisionLabels as Record<string, unknown>)) {
      if (!/^\d{1,5}$/.test(k) || typeof v !== "string") continue;
      const t = v.trim().slice(0, 80);
      if (t) labels[k] = t;
    }
    out.revisionLabels = labels;
  }
  return out;
}

/** Grid Settings → "Standard general notes"; blank clears to null. */
export function cleanStandardNotes(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim().slice(0, GENERAL_NOTES_MAX) : "";
  return t || null;
}

/** One note per non-blank line; a typed leading "1." / "2)" is stripped
 *  because the sheet numbers them itself. */
export function resolveGeneralNotes(set: DrawingSetSettings | undefined, standard: string | null | undefined): string[] {
  const text = set && typeof set.generalNotes === "string" ? set.generalNotes : standard || "";
  return text
    .split("\n")
    .map((l) => l.trim().replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean);
}

/* ------------------------------ title block ------------------------------ */

export type TitleBlockData = {
  company: { name: string; addressLines: string[]; phone: string; logoDark: string | null };
  project: { id: string; name: string; customer: string; venue: string; address: string };
  /** null when the design has a single option. */
  optionName: string | null;
  quoteId: string | null;
  /** Newest first, at most REV_ROWS. */
  revisions: RevisionRow[];
  /** How many older rows didn't fit. */
  earlierRevisions: number;
  /** "Rev C" | "— Preliminary". */
  status: string;
  drawnBy: string;
  checkedBy: string;
  scale: string;
  /** Print date (epoch ms). */
  date: number;
  sheet: { number: string; title: string; index: number; total: number };
};

export type TitleBlockInput = {
  company: {
    name: string;
    logoDark?: string | null;
    offices?: Array<{ street?: string; city?: string; state?: string; zip?: string; phone?: string; quoteDefault?: boolean }>;
  };
  project: {
    id: string;
    name: string;
    customer: string;
    siteName?: string;
    intake?: { venueName?: string; address?: string } | null;
    createdBy: string;
  };
  option: { name: string; quoteId: string | null };
  optionCount: number;
  /** revisionRows(...) output, oldest first. */
  revisions: RevisionRow[];
  set: DrawingSetSettings | undefined;
  sheet: { number: string; title: string; scale: string };
  index: number;
  total: number;
  now: number;
};

export function titleBlockData(input: TitleBlockInput): TitleBlockData {
  const offices = input.company.offices || [];
  const office = offices.find((o) => o.quoteDefault) || offices[0];
  const stateZip = office ? [office.state, office.zip].filter((s) => (s || "").trim()).join(" ") : "";
  const cityLine = office ? [office.city || "", stateZip].map((s) => s.trim()).filter(Boolean).join(", ") : "";
  const addressLines = office ? [office.street || "", cityLine].map((s) => s.trim()).filter(Boolean) : [];
  const rows = input.revisions;
  return {
    company: {
      name: input.company.name || "",
      addressLines,
      phone: (office?.phone || "").trim(),
      logoDark: input.company.logoDark || null,
    },
    project: {
      id: input.project.id,
      name: input.project.name,
      customer: input.project.customer || "",
      venue: input.project.siteName || input.project.intake?.venueName || "",
      address: input.project.intake?.address || "",
    },
    optionName: input.optionCount > 1 ? input.option.name : null,
    quoteId: input.option.quoteId,
    revisions: [...rows].reverse().slice(0, REV_ROWS),
    earlierRevisions: Math.max(0, rows.length - REV_ROWS),
    status: revisionStatus(rows),
    drawnBy: input.set?.drawnBy ?? input.project.createdBy ?? "",
    checkedBy: input.set?.checkedBy ?? "",
    scale: input.sheet.scale,
    date: input.now,
    sheet: { number: input.sheet.number, title: input.sheet.title, index: input.index, total: input.total },
  };
}

/* ---------------------------- plan sheets ---------------------------- */

export type PlanPlacementLite = { id: string; sheetId: string; page: number; partId: string; curtain?: unknown };
export type PlanRouteLite = {
  id: string;
  sheetId: string;
  page: number;
  partId: string;
  fromPlacementId?: string;
  toPlacementId?: string;
};

/** A placement's Grid scope — curtains are Curtains whatever their fabric row
 *  (the bomBySpace rule). */
export function placementScope(
  pl: { partId: string; curtain?: unknown },
  partById: ReadonlyMap<string, ScopedPartLite>
): GridLayer {
  return pl.curtain ? "Curtains" : scopeOfPart(partById.get(pl.partId));
}

export function placementSystem(
  pl: { partId: string; curtain?: unknown },
  partById: ReadonlyMap<string, ScopedPartLite>
): DrawingSystemKey {
  return drawingSystemOf(placementScope(pl, partById));
}

/** A wire belongs to the system of the device it was drawn from (else to),
 *  and only a free wire falls back to its cable part's own scope — cable is
 *  usually Unscoped, which would strand every speaker run on the G sheet. */
export function routeSystem(
  r: PlanRouteLite,
  placementById: ReadonlyMap<string, PlanPlacementLite>,
  partById: ReadonlyMap<string, ScopedPartLite>
): DrawingSystemKey {
  const end =
    (r.fromPlacementId ? placementById.get(r.fromPlacementId) : undefined) ||
    (r.toPlacementId ? placementById.get(r.toPlacementId) : undefined);
  return end ? placementSystem(end, partById) : drawingSystemOf(scopeOfPart(partById.get(r.partId)));
}

export type PlanGroup = { system: DrawingSystemKey; sheetId: string; page: number };

/** One plan sheet per (system × source sheet page) that holds anything of
 *  that system, in system order, then sheet order, then page. */
export function planSheetGroups(input: {
  sheetOrder: string[];
  placements: PlanPlacementLite[];
  routes: PlanRouteLite[];
  partById: ReadonlyMap<string, ScopedPartLite>;
}): PlanGroup[] {
  const placementById = new Map(input.placements.map((p) => [p.id, p]));
  const seen = new Map<string, PlanGroup>();
  const add = (system: DrawingSystemKey, sheetId: string, page: number) => {
    const k = `${system}|${sheetId}|${page}`;
    if (!seen.has(k)) seen.set(k, { system, sheetId, page });
  };
  for (const pl of input.placements) add(placementSystem(pl, input.partById), pl.sheetId, pl.page);
  for (const r of input.routes) add(routeSystem(r, placementById, input.partById), r.sheetId, r.page);
  const sysIdx = (k: DrawingSystemKey) => DRAWING_SYSTEMS.findIndex((s) => s.key === k);
  const sheetIdx = (id: string) => input.sheetOrder.indexOf(id);
  return [...seen.values()]
    .filter((g) => sheetIdx(g.sheetId) >= 0)
    .sort((a, b) => sysIdx(a.system) - sysIdx(b.system) || sheetIdx(a.sheetId) - sheetIdx(b.sheetId) || a.page - b.page);
}

/** What one system's plan sheet draws. */
export function planContent<
  P extends PlanPlacementLite,
  R extends PlanRouteLite,
  S extends { sheetId: string; page: number },
>(input: {
  group: PlanGroup;
  placements: P[];
  routes: R[];
  spaces: S[];
  partById: ReadonlyMap<string, ScopedPartLite>;
}): { placements: P[]; routes: R[]; spaces: S[] } {
  const { group } = input;
  const placementById = new Map<string, PlanPlacementLite>(input.placements.map((p) => [p.id, p]));
  const here = (x: { sheetId: string; page: number }) => x.sheetId === group.sheetId && x.page === group.page;
  return {
    placements: input.placements.filter((p) => here(p) && placementSystem(p, input.partById) === group.system),
    routes: input.routes.filter((r) => here(r) && routeSystem(r, placementById, input.partById) === group.system),
    spaces: input.spaces.filter(here),
  };
}

/* ------------------------------ sheet list ------------------------------ */

export type DrawingSheetKind = "cover" | "plan" | "riser" | "schedule";

export type DrawingSheetDef = {
  /** Stable identity: "cover" | "plan:<system>:<sheetId>:<page>" | "riser" | "schedule" | "schedule:<n>". */
  key: string;
  kind: DrawingSheetKind;
  number: string;
  title: string;
  system?: DrawingSystemKey;
  sheetId?: string;
  page?: number;
  /** 0-based schedule page. */
  schedulePage?: number;
};

/** All schedule pages share one include/exclude switch. */
export function sheetExclusionKey(d: DrawingSheetDef): string {
  return d.kind === "schedule" ? "schedule" : d.key;
}

/**
 * The numbered set. Numbers are assigned BEFORE exclusion so excluding L-101
 * never renumbers L-102 (a sheet number is a reference people write down);
 * the index and "n of N" count only what is included.
 */
export function buildSheetList(input: {
  planGroups: PlanGroup[];
  sourceNames: Readonly<Record<string, string>>;
  schedulePages: number;
  excluded?: readonly string[];
}): { all: DrawingSheetDef[]; included: DrawingSheetDef[] } {
  const all: DrawingSheetDef[] = [{ key: "cover", kind: "cover", number: "T-001", title: "Cover sheet" }];
  for (const sys of DRAWING_SYSTEMS) {
    const mine = input.planGroups.filter((g) => g.system === sys.key);
    mine.forEach((g, i) => {
      const src = input.sourceNames[g.sheetId] || "Plan";
      all.push({
        key: `plan:${sys.key}:${g.sheetId}:${g.page}`,
        kind: "plan",
        number: `${sys.prefix}-${101 + i}`,
        title: mine.length > 1 ? `${sys.title} — ${src}${g.page > 1 ? `, p. ${g.page}` : ""}` : sys.title,
        system: sys.key,
        sheetId: g.sheetId,
        page: g.page,
      });
    });
  }
  all.push({ key: "riser", kind: "riser", number: "E-501", title: "System riser" });
  const n = Math.max(1, Math.floor(input.schedulePages) || 1);
  for (let i = 0; i < n; i++) {
    all.push({
      key: i === 0 ? "schedule" : `schedule:${i + 1}`,
      kind: "schedule",
      number: `E-${601 + i}`,
      title: n > 1 ? `Equipment schedules (${i + 1} of ${n})` : "Equipment schedules",
      schedulePage: i,
    });
  }
  const ex = new Set(input.excluded || []);
  return { all, included: all.filter((d) => !ex.has(sheetExclusionKey(d))) };
}

/** The set settings' include/exclude checklist. */
export function toggleableSheets(all: DrawingSheetDef[]): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  const scheduleCount = all.filter((d) => d.kind === "schedule").length;
  for (const d of all) {
    const key = sheetExclusionKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label:
        d.kind === "schedule"
          ? `${d.number}${scheduleCount > 1 ? `–E-${600 + scheduleCount}` : ""} Equipment schedules`
          : `${d.number} ${d.title}`,
    });
  }
  return out;
}
```

- [ ] **Step 5: Create `src/lib/design/grid-schedule.ts`**

```ts
/**
 * The Grid — equipment schedule (D113 item 3), shared by /schedule and the
 * drawing set's E-60x sheets (#209). Pure and dependency-free (the grid-bom
 * rule). Deliberately NO prices: this is the field document.
 */

import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import { spaceOf, type SpaceLite } from "./grid-geometry";
import { curtainDesc, type GridCurtain } from "./grid-bom";

/** `code` overrides the printed Part cell for rows with no SKU (curtains). */
export type ScheduleRow = { partId: string; code?: string; desc: string; qty: number };
export type ScheduleSection = { key: string; name: string; rows: ScheduleRow[] };
export type ScheduleWire = { id: string; partId: string; fromName: string; toName: string; lengthFt: number | null; unit: string };
export type ScheduleData = {
  sections: ScheduleSection[];
  wires: ScheduleWire[];
  deviceCount: number;
  wireFeet: Array<{ partId: string; ft: number; unit: string; unmeasured: number }>;
};

/**
 * Devices grouped per space (the same computed smallest-wins assignment as
 * everywhere else), spaces in drawing order, then Unassigned. Curtains never
 * group: each drop is its own made-to-size drape.
 */
export function buildSchedule(input: {
  placements: Array<{ id: string; sheetId: string; page: number; x: number; y: number; partId: string; curtain?: GridCurtain | null }>;
  spaces: Array<SpaceLite & { name: string }>;
  descOf: (partId: string) => string | undefined;
  wires: ScheduleWire[];
}): ScheduleData {
  const bySpace = new Map<string | null, ScheduleRow[]>();
  for (const pl of input.placements) {
    const home = spaceOf(pl, input.spaces);
    const key = home ? home.id : null;
    const rows = bySpace.get(key) || [];
    if (pl.curtain) {
      rows.push({ partId: pl.id, code: "CURTAIN", desc: curtainDesc(pl.curtain, input.descOf(pl.curtain.fabricSku)), qty: 1 });
    } else {
      const row = rows.find((r) => r.partId === pl.partId && !r.code);
      if (row) row.qty += 1;
      else rows.push({ partId: pl.partId, desc: input.descOf(pl.partId) || "(no longer in the catalog)", qty: 1 });
    }
    bySpace.set(key, rows);
  }
  const sections: ScheduleSection[] = [
    ...input.spaces.filter((s) => bySpace.has(s.id)).map((s) => ({ key: s.id, name: s.name, rows: bySpace.get(s.id)! })),
    ...(bySpace.has(null) ? [{ key: "un", name: "Unassigned", rows: bySpace.get(null)! }] : []),
  ];
  const feet = new Map<string, { partId: string; ft: number; unit: string; unmeasured: number }>();
  for (const w of input.wires) {
    const f = feet.get(w.partId) || { partId: w.partId, ft: 0, unit: w.unit, unmeasured: 0 };
    if (w.lengthFt === null) f.unmeasured += 1;
    else f.ft += w.lengthFt;
    feet.set(w.partId, f);
  }
  return {
    sections,
    wires: input.wires,
    deviceCount: input.placements.filter((pl) => !pl.curtain).length,
    wireFeet: [...feet.values()],
  };
}

export type ScheduleHead = { kind: "section"; name: string; cont: boolean } | { kind: "wires"; cont: boolean };
export type ScheduleItem =
  | ScheduleHead
  | { kind: "row"; qty: number; code: string; desc: string }
  | { kind: "wire"; partId: string; run: string; length: string };
export type ScheduleGroup = { head: ScheduleHead; rows: ScheduleItem[] };

export function scheduleGroups(d: ScheduleData): ScheduleGroup[] {
  const groups: ScheduleGroup[] = d.sections.map((s) => ({
    head: { kind: "section", name: s.name, cont: false },
    rows: s.rows.map((r) => ({ kind: "row" as const, qty: r.qty, code: r.code || r.partId, desc: r.desc })),
  }));
  if (d.wires.length) {
    groups.push({
      head: { kind: "wires", cont: false },
      rows: d.wires.map((w) => ({
        kind: "wire" as const,
        partId: w.partId,
        run: `${w.fromName} → ${w.toName}`,
        length: w.lengthFt !== null ? formatMeasure(w.lengthFt, w.unit as MeasureUnit) : "unmeasured",
      })),
    });
  }
  return groups;
}

/**
 * Pages → columns → items. A head never ends a column (it needs at least one
 * row under it), and a group that spills into a new column repeats its head
 * marked `cont`. An empty schedule is still one (empty) sheet.
 */
export function paginateSchedule(groups: ScheduleGroup[], perColumn = 30, columns = 2): ScheduleItem[][][] {
  const cap = Math.max(2, Math.floor(perColumn));
  const cols = Math.max(1, Math.floor(columns));
  const pages: ScheduleItem[][][] = [];
  let page: ScheduleItem[][] = [];
  let col: ScheduleItem[] = [];
  const pushCol = () => {
    page.push(col);
    col = [];
    if (page.length === cols) {
      pages.push(page);
      page = [];
    }
  };
  for (const g of groups) {
    if (col.length && col.length + 2 > cap) pushCol();
    col.push(g.head);
    for (const r of g.rows) {
      if (col.length >= cap) {
        pushCol();
        col.push({ ...g.head, cont: true });
      }
      col.push(r);
    }
  }
  if (col.length) pushCol();
  if (page.length) pages.push(page);
  if (!pages.length) pages.push([[]]);
  return pages;
}
```

- [ ] **Step 6: Run the harness to verify it passes**

Run: `npm run test:specs 2>&1 | grep -E "#209|FAIL|ALL PASSED|FAILED"`
Expected: every `#209 …` line starts with `PASS`, no `FAIL`, last line `ALL PASSED`.

- [ ] **Step 7: Gates**

Run: `npx tsc --noEmit && npx eslint 2>&1 | tail -1`
Expected: tsc prints nothing; eslint `✖ 111 problems (0 errors, 111 warnings)`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/grid-scopes.ts src/lib/design/grid-drawing-set.ts src/lib/design/grid-schedule.ts scripts/test-review-and-spec.ts
git -c user.name="SM" commit -m "feat(grid): drawing-set model — sheet sizes, title-block data, per-system sheet list, schedule (#209)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Title block + drawing sheet components + CSS

**Files:**
- Create: `src/components/drawing/title-block.tsx`
- Create: `src/components/drawing/drawing-sheet.tsx`
- Modify: `src/app/globals.css` (insert a block immediately before the line `/* Login */`)
- Test: `scripts/test-review-and-spec.ts` (append block at EOF)

**Interfaces:**
- Consumes: `TitleBlockData`, `SheetSizeKey`, `sheetCssVars` (Task 1).
- Produces: `TitleBlock({ data }: { data: TitleBlockData })`; `DrawingSheet({ size, titleBlock, children }: { size: SheetSizeKey; titleBlock: TitleBlockData; children: ReactNode })` rendering `<section class="pk-drawing-sheet" data-size data-sheet={number}>`. CSS classes used later: `pk-drawing-set` (wrapper, reads `--dw-screen-zoom`), `pk-drawing-sheet`, `pk-drawing-frame`, `pk-drawing-area`, `pk-title-strip`, `pk-tb-*`, `pk-dw-h`, `pk-dw-cols`, `pk-dw-table`, `pk-dw-sec`, `pk-dw-mono`, `pk-dw-ellip`, `pk-dw-notes`, `pk-dw-block`, `pk-dw-foot`, `pk-plan-fig`, `pk-plan-caption`, `pk-riser-notes`.

- [ ] **Step 1: Write the failing test** — append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #209 grid drawing set — Task 2: title block + sheet frame --- */
import { TitleBlock } from "@/components/drawing/title-block";
import { DrawingSheet } from "@/components/drawing/drawing-sheet";

{
  const tbSheet = titleBlockData({
    company: { name: "Peak Systems Group", logoDark: null, offices: [] },
    project: { id: "GRD-5009", name: "Main Stage", customer: "Lakefront", createdBy: "Jeff" },
    option: { name: "Design", quoteId: null },
    optionCount: 1,
    revisions: [],
    set: undefined,
    sheet: { number: "A-101", title: "Audio plan", scale: "AS NOTED" },
    index: 3,
    total: 7,
    now: Date.UTC(2026, 8, 25, 12),
  });
  const sheetHtml = symRender(symH(DrawingSheet, { size: "d", titleBlock: tbSheet, children: symH("p", null, "BODY") }));
  ok(sheetHtml.includes('class="pk-drawing-sheet"') && sheetHtml.includes('data-size="d"') && sheetHtml.includes("--dw-w:36in") && sheetHtml.includes("--dw-k:2.118"), "#209 sheet: the frame carries its size variables");
  ok(sheetHtml.includes("BODY") && sheetHtml.includes('class="pk-drawing-area"') && sheetHtml.includes('class="pk-title-strip"') && sheetHtml.includes('data-sheet="A-101"'), "#209 sheet: drawing area + right-side title strip");
  ok(sheetHtml.includes("3 of 7 · — Preliminary") && sheetHtml.includes("Peak Systems Group") && !sheetHtml.includes("<img"), "#209 title block: n of N, Preliminary, the company name when there is no logo");
  ok(!sheetHtml.includes(">Option<"), "#209 title block: no option row for a single-option design");
  const tbRev = titleBlockData({
    company: { name: "Peak", logoDark: "data:image/png;base64,AAAA", offices: [] },
    project: { id: "GRD-5009", name: "Main Stage", customer: "", createdBy: "Jeff" },
    option: { name: "Better", quoteId: "Q-2100" },
    optionCount: 2,
    revisions: revisionRows([{ rev: 1, at: 1000, note: "Bid set", reason: "manual" }, { rev: 2, at: 2000, note: "", reason: "quote" }]),
    set: undefined,
    sheet: { number: "T-001", title: "Cover sheet", scale: "NTS" },
    index: 1,
    total: 7,
    now: 3000,
  });
  const tbHtml = symRender(symH(TitleBlock, { data: tbRev }));
  ok(tbHtml.includes("<img") && tbHtml.includes("Bid set") && tbHtml.includes("Issued with quote") && tbHtml.includes("Rev B") && tbHtml.includes(">Option<") && tbHtml.includes("Q-2100"), "#209 title block: logo, revision table, latest letter, option row, quote number");
  const gdsCss = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  ok(gdsCss.includes(".pk-drawing-sheet {") && /\.pk-tb-accent\s*\{[^}]*var\(--accent\)/.test(gdsCss) && gdsCss.includes("print-color-adjust: exact") && gdsCss.includes(".pk-drawing-sheet:last-child"), "#209 CSS: sheet classes exist, the accent bar is var(--accent), sheets break one per page");
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | tail -3`
Expected: aborts with `Cannot find module '@/components/drawing/title-block'`.

- [ ] **Step 3: Create `src/components/drawing/title-block.tsx`**

```tsx
import type { TitleBlockData } from "@/lib/design/grid-drawing-set";

/**
 * The drawing-set title block (#209, spec 2026-09-25 §2.1 — "A · Architectural
 * side strip"): logo + company, project, option, revision table, drawn /
 * checked / scale / date, quote, and the sheet title + big sheet number.
 *
 * Pure presentational and server-renderable (no "use client"). All sizing
 * lives in globals.css (.pk-title-strip / .pk-tb-*), scaled by the --dw-k
 * variable DrawingSheet sets, so 24×36 is the same strip at 36/17 scale.
 * Text that a harness matches is built as ONE template string — React's
 * server renderer puts <!-- --> between adjacent text nodes.
 */

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export function TitleBlock({ data }: { data: TitleBlockData }) {
  const { company, project, sheet } = data;
  return (
    <aside className="pk-title-strip" aria-label="Title block">
      <div className="pk-tb-cell">
        {company.logoDark ? (
          // Data-URL brand mark from Settings → Branding; next/image adds nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="pk-tb-logo" src={company.logoDark} alt={company.name || "Company logo"} />
        ) : (
          <div className="pk-tb-strong">{company.name}</div>
        )}
        {company.addressLines.map((l) => (
          <div key={l}>{l}</div>
        ))}
        {company.phone && <div>{company.phone}</div>}
      </div>
      <div className="pk-tb-accent" />
      <div className="pk-tb-cell">
        <div className="pk-tb-label">Project</div>
        <div className="pk-tb-strong">{project.name}</div>
        {project.venue && <div>{project.venue}</div>}
        {project.address && <div>{project.address}</div>}
        {project.customer && <div>{`For ${project.customer}`}</div>}
        <div className="pk-tb-mono">{project.id}</div>
      </div>
      {data.optionName && (
        <div className="pk-tb-cell">
          <div className="pk-tb-label">Option</div>
          <div className="pk-tb-strong">{data.optionName}</div>
        </div>
      )}
      <div className="pk-tb-cell pk-tb-grow">
        <div className="pk-tb-label">Revisions</div>
        {data.revisions.length === 0 ? (
          <div>— Preliminary</div>
        ) : (
          <table className="pk-tb-revs">
            <thead>
              <tr>
                <th>Rev</th>
                <th>Date</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {data.revisions.map((r) => (
                <tr key={r.rev}>
                  <td className="pk-tb-mono">{r.letter}</td>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.earlierRevisions > 0 && <div className="pk-tb-note">{`+${data.earlierRevisions} earlier`}</div>}
      </div>
      <div className="pk-tb-cell pk-tb-grid">
        <div>
          <div className="pk-tb-label">Drawn</div>
          {data.drawnBy || "—"}
        </div>
        <div>
          <div className="pk-tb-label">Checked</div>
          {data.checkedBy || "—"}
        </div>
        <div>
          <div className="pk-tb-label">Scale</div>
          {data.scale}
        </div>
        <div>
          <div className="pk-tb-label">Date</div>
          {fmtDate(data.date)}
        </div>
      </div>
      <div className="pk-tb-cell">
        <div className="pk-tb-label">Quote</div>
        <div className="pk-tb-mono">{data.quoteId || "—"}</div>
      </div>
      <div className="pk-tb-cell">
        <div className="pk-tb-label">Sheet title</div>
        <div className="pk-tb-sheettitle">{sheet.title}</div>
        <div className="pk-tb-sheetno">{sheet.number}</div>
        <div className="pk-tb-mono">{`${sheet.index} of ${sheet.total} · ${data.status}`}</div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Create `src/components/drawing/drawing-sheet.tsx`**

```tsx
import type { CSSProperties, ReactNode } from "react";
import { sheetCssVars, type SheetSizeKey, type TitleBlockData } from "@/lib/design/grid-drawing-set";
import { TitleBlock } from "./title-block";

/**
 * One drawing-set sheet (#209): exact paper size (11×17 or 24×36), border
 * frame, drawing area on the left, title strip on the right. Geometry comes
 * from grid-drawing-set's size table via CSS variables, never literals here.
 * Server-renderable (no "use client").
 */
export function DrawingSheet({
  size,
  titleBlock,
  children,
}: {
  size: SheetSizeKey;
  titleBlock: TitleBlockData;
  children: ReactNode;
}) {
  return (
    <section
      className="pk-drawing-sheet"
      data-size={size}
      data-sheet={titleBlock.sheet.number}
      style={sheetCssVars(size) as CSSProperties}
    >
      <div className="pk-drawing-frame">
        <div className="pk-drawing-area">{children}</div>
        <TitleBlock data={titleBlock} />
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add the CSS** — in `src/app/globals.css`, insert immediately before the line `/* Login */`:

```css
/* Grid drawing set (#209). Sheet geometry arrives as CSS variables from
   DrawingSheet (lib/design/grid-drawing-set.ts is the one size table);
   --dw-k scales every border and type size so 24×36 is the 11×17 layout
   at 36/17. Accent only through var(--accent). */
.pk-drawing-set {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  padding-bottom: 40px;
}
@media screen {
  .pk-drawing-set {
    zoom: var(--dw-screen-zoom, 0.6);
  }
}
.pk-drawing-sheet {
  width: var(--dw-w);
  height: var(--dw-h);
  flex: none;
  position: relative;
  background: #fff;
  color: #16181d;
  font-family: var(--font-ui), system-ui, sans-serif;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.pk-drawing-frame {
  position: absolute;
  inset: var(--dw-m);
  border: calc(1.5pt * var(--dw-k)) solid #16181d;
  display: flex;
}
.pk-drawing-area {
  flex: 1;
  min-width: 0;
  position: relative;
  padding: var(--dw-pad);
  overflow: hidden;
  font-size: calc(9pt * var(--dw-k));
  line-height: 1.35;
}
.pk-title-strip {
  width: var(--dw-strip);
  flex: none;
  border-left: calc(1.5pt * var(--dw-k)) solid #16181d;
  display: flex;
  flex-direction: column;
  font-size: calc(7pt * var(--dw-k));
  line-height: 1.3;
  overflow: hidden;
}
.pk-tb-cell {
  border-bottom: calc(0.75pt * var(--dw-k)) solid #16181d;
  padding: calc(0.06in * var(--dw-k)) calc(0.08in * var(--dw-k));
}
.pk-tb-cell:last-child {
  border-bottom: none;
}
.pk-tb-grow {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.pk-tb-label {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: calc(5.5pt * var(--dw-k));
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #5b616e;
  margin-bottom: calc(1pt * var(--dw-k));
}
.pk-tb-strong {
  font-weight: 700;
  font-size: calc(8.5pt * var(--dw-k));
}
.pk-tb-mono {
  font-family: var(--font-mono), ui-monospace, monospace;
}
.pk-tb-note {
  color: #5b616e;
  font-size: calc(6pt * var(--dw-k));
  margin-top: calc(2pt * var(--dw-k));
}
.pk-tb-logo {
  display: block;
  max-width: 100%;
  max-height: calc(0.55in * var(--dw-k));
  object-fit: contain;
  margin-bottom: calc(3pt * var(--dw-k));
}
.pk-tb-accent {
  height: calc(3pt * var(--dw-k));
  background: var(--accent);
  flex: none;
}
.pk-tb-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: calc(3pt * var(--dw-k)) calc(6pt * var(--dw-k));
}
.pk-tb-revs {
  width: 100%;
  border-collapse: collapse;
  font-size: calc(6.5pt * var(--dw-k));
}
.pk-tb-revs th,
.pk-tb-revs td {
  text-align: left;
  vertical-align: top;
  padding: calc(1pt * var(--dw-k)) calc(3pt * var(--dw-k)) calc(1pt * var(--dw-k)) 0;
}
.pk-tb-revs th {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: calc(5.5pt * var(--dw-k));
  font-weight: 600;
  color: #5b616e;
}
.pk-tb-sheettitle {
  font-weight: 700;
  font-size: calc(9pt * var(--dw-k));
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.pk-tb-sheetno {
  font-size: calc(26pt * var(--dw-k));
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.05;
  margin: calc(2pt * var(--dw-k)) 0;
}
/* Drawing-area content (cover, schedules, riser notes). */
.pk-dw-h {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: calc(7pt * var(--dw-k));
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-bottom: calc(1pt * var(--dw-k)) solid #16181d;
  padding-bottom: calc(2pt * var(--dw-k));
  margin: 0 0 calc(5pt * var(--dw-k));
}
.pk-dw-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: calc(0.35in * var(--dw-k));
}
.pk-dw-block {
  margin-bottom: calc(12pt * var(--dw-k));
}
.pk-dw-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: calc(8pt * var(--dw-k));
}
.pk-dw-table th {
  text-align: left;
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: calc(6pt * var(--dw-k));
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #5b616e;
  border-bottom: calc(1pt * var(--dw-k)) solid #16181d;
  padding: calc(2pt * var(--dw-k)) calc(6pt * var(--dw-k)) calc(2pt * var(--dw-k)) 0;
}
.pk-dw-table td {
  border-bottom: calc(0.5pt * var(--dw-k)) solid #d7dae0;
  padding: calc(2.5pt * var(--dw-k)) calc(6pt * var(--dw-k)) calc(2.5pt * var(--dw-k)) 0;
  vertical-align: top;
}
.pk-dw-sec {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: calc(6pt * var(--dw-k)) !important;
  border-bottom: calc(1pt * var(--dw-k)) solid var(--accent) !important;
}
.pk-dw-mono {
  font-family: var(--font-mono), ui-monospace, monospace;
}
.pk-dw-ellip {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pk-dw-notes {
  margin: 0;
  padding-left: calc(14pt * var(--dw-k));
  line-height: 1.45;
}
.pk-dw-foot {
  border-top: calc(1pt * var(--dw-k)) solid #16181d;
  padding-top: calc(4pt * var(--dw-k));
  color: #3d424e;
}
.pk-plan-fig canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
.pk-plan-caption {
  display: flex;
  align-items: center;
  gap: calc(14pt * var(--dw-k));
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: calc(6.5pt * var(--dw-k));
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #3d424e;
}
.pk-riser-notes {
  margin: 0;
  padding-left: 1.4em;
  line-height: 1.45;
}
@media print {
  .pk-drawing-set {
    zoom: 1 !important;
    display: block !important;
    padding: 0 !important;
  }
  .pk-drawing-sheet {
    box-shadow: none !important;
    break-after: page;
    page-break-after: always;
  }
  .pk-drawing-sheet:last-child {
    break-after: auto;
    page-break-after: auto;
  }
}

```

- [ ] **Step 6: Run the harness to verify it passes**

Run: `npm run test:specs 2>&1 | grep -E "#209|FAIL|ALL PASSED|FAILED"`
Expected: all `#209` lines `PASS`, `ALL PASSED`.

- [ ] **Step 7: Gates**

Run: `npx tsc --noEmit && npx eslint 2>&1 | tail -1`
Expected: tsc silent; `✖ 111 problems (0 errors, 111 warnings)`.

- [ ] **Step 8: Commit**

```bash
git add src/components/drawing/title-block.tsx src/components/drawing/drawing-sheet.tsx src/app/globals.css scripts/test-review-and-spec.ts
git -c user.name="SM" commit -m "feat(grid): architectural title block + drawing sheet frame, 11×17 and 24×36 (#209)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Riser document model (pure) + RiserLink footage in `routeLines`

**Files:**
- Create: `src/lib/design/grid-riser-doc.ts`
- Modify: `src/lib/design/grid-bom.ts` (`routeLines`)
- Modify: `src/lib/design/grid-options.ts` (`copyOptionMembers` return)
- Test: `scripts/test-review-and-spec.ts` (append block at EOF)

**Interfaces:**
- Consumes: `pointInPolygon`, `polygonCentroid`, `spaceOf`, `SpaceLite` (grid-geometry); `RiserGraph`, `RiserGroup` (grid-riser, types only); `Point` (annotations, type only).
- Produces (grid-riser-doc):
  - Constants `RISER_W = 1000`, `RISER_H = 620`, `NODE_HEAD = 24`, `NODE_ROW = 16`, `UNASSIGNED_KEY = "unassigned"`, `RISER_OP_NAMES`.
  - Types `EndRef = { kind: "space"; spaceId: string | null } | { kind: "placement"; placementId: string }`, `RiserNodeBox = { x; y; w; h }`, `RiserLevel = { id; label; elevation?; y }`, `RiserConduit = { id; from; to; label; points? }`, `RiserNote = { id; n; text }`, `RiserLink = { id; from; to; partId; lengthFt; by; at }`, `RiserDoc = { nodes; levels; conduits; notes; links }`, `RiserOp` (union below), `RiserIdPrefix = "lv-" | "cd-" | "nt-" | "lk-"`, `EndAnchor = { key: string; partId: string | null }`, `RiserViewGroup`, `RiserViewNode = { key; spaceId; name; color; groups; box }`, `RiserViewEdge = { id; kind: "route" | "link"; partId; desc; from: EndAnchor; to: EndAnchor; lengthFt: number | null; unit }`, `RiserViewConduit = { id; from; to; label }`, `RiserView = { nodes; edges; conduits; levels; notes; height }`.
  - Functions `emptyRiserDoc()`, `isEndRef(v)`, `sameEnd(a, b)`, `normalizeRiserDoc(raw: unknown): RiserDoc`, `riserLinksOf(riser, optionId): RiserLink[]`, `nodeKeyOf(spaceId: string | null): string`, `nodeMinH(groupCount): number`, `autoBox(slot): RiserNodeBox`, `mergeLayout(keys, saved): Record<string, RiserNodeBox>`, `applyRiserOp(doc, op, makeId): { doc; changed }`, `spreadInSpace(poly, n, taken?, step?): Point[]`, `marginPoints(n, blockers, taken?): Point[]`, `marginSpaceRect(index): Point[]`, `connectKind(from, to, placements, cals): "route" | "link"`, `pruneRiserEnds(doc, gone)`, `pruneRisers(riser, gone)`, `copyRiserDoc(src, idMap, makeId, by, at)`, `buildRiserView({ graph, spaces, placements, routes, doc, look?, partDesc? }): RiserView`.
- Produces (grid-bom): `routeLines(routes, parts, cals, links: ReadonlyArray<{ partId: string; lengthFt: number }> = [])` — same return shape.
- Produces (grid-options): `copyOptionMembers(...)` returns `{ placements, routes, idMap: Map<string, string> }` (old placement id → new).

- [ ] **Step 1: Write the failing test** — append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #209 grid drawing set — Task 3: riser document model --- */
import {
  RISER_H, UNASSIGNED_KEY, applyRiserOp, autoBox, buildRiserView, connectKind, copyRiserDoc, emptyRiserDoc,
  marginPoints, marginSpaceRect, mergeLayout, nodeMinH, normalizeRiserDoc, pruneRiserEnds, riserLinksOf, spreadInSpace,
  type RiserDoc,
} from "@/lib/design/grid-riser-doc";

{
  // normalize
  ok(JSON.stringify(normalizeRiserDoc(undefined)) === JSON.stringify(emptyRiserDoc()), "#209 riser: an absent doc reads as empty");
  const rdBad = normalizeRiserDoc({
    nodes: { a: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }, b: { x: "no" } },
    links: [{ id: "lk-1", from: { kind: "space", spaceId: null }, to: { kind: "bogus" }, partId: "W", lengthFt: 3, by: "t", at: 1 }],
    notes: "x",
  });
  ok(Object.keys(rdBad.nodes).join() === "a" && rdBad.links.length === 0 && rdBad.notes.length === 0, "#209 riser: malformed nodes/links/notes are dropped, never thrown on");

  // layout merge
  const rdMerged = mergeLayout(["a", "b", "c"], { a: autoBox(0), zombie: autoBox(5) });
  ok(JSON.stringify(rdMerged.a) === JSON.stringify(autoBox(0)), "#209 layout: a saved position wins");
  ok(JSON.stringify(rdMerged.b) === JSON.stringify(autoBox(1)) && JSON.stringify(rdMerged.c) === JSON.stringify(autoBox(2)), "#209 layout: new nodes take the next free auto slots");
  ok(!("zombie" in rdMerged), "#209 layout: a saved box for a vanished node is ignored");
  ok(JSON.stringify(mergeLayout(["a", "b"], { b: autoBox(0) }).a) === JSON.stringify(autoBox(1)), "#209 layout: an auto slot already taken by a saved box is skipped");

  // reducer
  let rdSeq = 0;
  const rdMk = (p: string) => `${p}${++rdSeq}`;
  let rd: RiserDoc = emptyRiserDoc();
  let rdRes = applyRiserOp(rd, { op: "addLevel", label: "  Level 1 ", elevation: "EL 100", y: 0.9 }, rdMk);
  ok(rdRes.changed && rdRes.doc.levels[0].label === "Level 1" && rdRes.doc.levels[0].id === "lv-1", "#209 op: addLevel trims and mints an id");
  rd = rdRes.doc;
  ok(!applyRiserOp(rd, { op: "addLevel", label: "   ", y: 0.5 }, rdMk).changed, "#209 op: a blank level label is refused");
  rdRes = applyRiserOp(rd, { op: "updateLevel", id: rd.levels[0].id, y: 0.4, elevation: "" }, rdMk);
  ok(rdRes.doc.levels[0].y === 0.4 && !("elevation" in rdRes.doc.levels[0]), "#209 op: updateLevel moves the line and clears the elevation");
  rd = rdRes.doc;
  ok(!applyRiserOp(rd, { op: "addConduit", from: { kind: "space", spaceId: "sp-a" }, to: { kind: "space", spaceId: "sp-a" }, label: "EMT" }, rdMk).changed, "#209 op: a conduit from a node to itself is refused");
  rdRes = applyRiserOp(rd, { op: "addConduit", from: { kind: "space", spaceId: "sp-a" }, to: { kind: "space", spaceId: null }, label: "1in EMT by EC" }, rdMk);
  ok(rdRes.changed && rdRes.doc.conduits.length === 1, "#209 op: addConduit");
  rd = rdRes.doc;
  rd = applyRiserOp(rd, { op: "addNote", text: "First" }, rdMk).doc;
  rd = applyRiserOp(rd, { op: "addNote", text: "Second" }, rdMk).doc;
  rd = applyRiserOp(rd, { op: "removeNote", id: rd.notes[0].id }, rdMk).doc;
  ok(rd.notes.length === 1 && rd.notes[0].n === 1 && rd.notes[0].text === "Second", "#209 op: notes renumber after a removal");
  rdRes = applyRiserOp(rd, { op: "moveNode", key: "sp-a", box: { x: 1.5, y: -2, w: 0.01, h: 0.01 } }, rdMk);
  const rdBox = rdRes.doc.nodes["sp-a"];
  ok(rdRes.changed && rdBox.x + rdBox.w <= 1 && rdBox.y === 0 && rdBox.w >= 0.1, "#209 op: moveNode clamps into the canvas and to a minimum size");
  ok(!applyRiserOp(rd, { op: "removeLink", id: "nope" }, rdMk).changed, "#209 op: removing an unknown id reports no change");
  ok(rd.conduits.length === 1 && riserLinksOf({ o: rd }, "o").length === 0, "#209 op: conduits never become links (never priced)");

  // device drops
  const rdSq = [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.4 }, { x: 0.2, y: 0.4 }];
  const rdPts = spreadInSpace(rdSq, 7, [{ x: 0.3, y: 0.3 }]);
  ok(rdPts.length === 7 && rdPts.every((p) => pointInPolygon(p, rdSq)), "#209 +Device: every new device lands inside the space polygon");
  ok(new Set(rdPts.map((p) => `${p.x},${p.y}`)).size === 7 && !rdPts.some((p) => p.x === 0.3 && p.y === 0.3), "#209 +Device: multiples spread out and avoid taken spots");
  const rdBlock = [{ x: 0, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }];
  const rdMargin = marginPoints(3, [rdBlock], []);
  ok(rdMargin.length === 3 && rdMargin.every((p) => p.y > 0.85 && !pointInPolygon(p, rdBlock)), "#209 +Device: Unassigned devices land on the lower margin, outside every space");
  const rdRect = marginSpaceRect(2);
  ok(rdRect.length === 4 && polygonArea(rdRect) > 0.005 && rdRect.every((p) => p.y >= 0.86), "#209 Space: a new riser space is a small rectangle on the plan's lower margin");

  // connect rule
  const rdPls = [{ id: "a", sheetId: "s1", page: 1 }, { id: "b", sheetId: "s1", page: 1 }, { id: "c", sheetId: "s2", page: 1 }];
  const rdCals = [{ docId: "s1", page: 1 }];
  ok(connectKind({ kind: "placement", placementId: "a" }, { kind: "placement", placementId: "b" }, rdPls, rdCals) === "route", "#209 Connect: same calibrated sheet → a measured GridRoute");
  ok(connectKind({ kind: "placement", placementId: "a" }, { kind: "placement", placementId: "c" }, rdPls, rdCals) === "link", "#209 Connect: cross-sheet → a RiserLink");
  ok(connectKind({ kind: "placement", placementId: "a" }, { kind: "placement", placementId: "b" }, rdPls, []) === "link", "#209 Connect: an uncalibrated page falls back to a typed-length RiserLink");
  ok(connectKind({ kind: "space", spaceId: "x" }, { kind: "space", spaceId: "y" }, rdPls, rdCals) === "link", "#209 Connect: space → space is always a RiserLink");

  // prune + copy
  const rdWithLink: RiserDoc = {
    ...rd,
    nodes: { "sp-a": autoBox(0) },
    links: [{ id: "lk-9", from: { kind: "placement", placementId: "a" }, to: { kind: "space", spaceId: null }, partId: "W", lengthFt: 10, by: "t", at: 1 }],
  };
  const rdPruned = pruneRiserEnds(rdWithLink, { placementIds: new Set(["a"]), spaceIds: new Set(["sp-a"]) });
  ok(rdPruned.links.length === 0 && rdPruned.conduits.length === 0 && !("sp-a" in rdPruned.nodes), "#209 delete: removing a device/space prunes its links, conduits and saved box");
  const rdCopied = copyRiserDoc(rdWithLink, new Map([["a", "a2"]]), rdMk, "copier", 9);
  const rdCopiedFrom = rdCopied.links[0]?.from;
  ok(rdCopied.links.length === 1 && rdCopiedFrom?.kind === "placement" && rdCopiedFrom.placementId === "a2" && rdCopied.links[0].id !== "lk-9" && rdCopied.links[0].by === "copier", "#209 option copy: links are re-pointed at the copied devices with new ids");
  ok(copyRiserDoc(rdWithLink, new Map(), rdMk, "copier", 9).links.length === 0, "#209 option copy: a link whose device wasn't copied is dropped");

  // RiserLink footage in the BOM (routeLines 4th arg); conduits never reach it
  const rdLinkParts = [{ id: "W", sku: "W", desc: "Cable", category: "Wire", unit: "ft", list: 2, cost: 1 }];
  const rdBom = routeLines([], rdLinkParts, [], [{ partId: "W", lengthFt: 10.2 }, { partId: "W", lengthFt: 5 }, { partId: "W", lengthFt: Number.NaN }]);
  ok(rdBom.lines.length === 1 && rdBom.lines[0].qty === 16 && rdBom.lines[0].ext === 32 && rdBom.unmeasured === 1 && !rdBom.lines[0].connectionType, "#209 BOM: RiserLink lengths sum per part, round up, price like a route, never stamp a connectionType");
  ok(routeLines([], rdLinkParts, []).lines.length === 0, "#209 BOM: routeLines without links is unchanged");

  // copyOptionMembers exposes its id map
  const rdCm = copyOptionMembers({ placements: [{ id: "gp-1", optionId: "o1" }], routes: [], fromOptionId: "o1", toOptionId: "o2", makeId: (p) => `${p}x`, by: "t", at: 1 });
  ok(rdCm.idMap.get("gp-1") === "gp-x", "#209: copyOptionMembers returns its old → new placement id map");

  // the view
  const rdSpaces = [
    { id: "sp-a", sheetId: "s1", page: 1, name: "Stage", color: "#8a6d3b", points: rdSq },
    { id: "sp-b", sheetId: "s1", page: 1, name: "Empty room", color: "#3b7a8a", points: [{ x: 0.6, y: 0.6 }, { x: 0.8, y: 0.6 }, { x: 0.8, y: 0.8 }, { x: 0.6, y: 0.8 }] },
  ];
  const rdPl = [
    { id: "p1", sheetId: "s1", page: 1, x: 0.25, y: 0.25, partId: "FIX", at: 2 },
    { id: "p2", sheetId: "s1", page: 1, x: 0.3, y: 0.25, partId: "FIX", at: 1 },
  ];
  const rdParts = [{ id: "FIX", sku: "FIX", desc: "Fixture", category: "Fixtures", unit: "ea", list: 1, cost: 1 }, ...rdLinkParts];
  const rdGraph = riserGraph(rdPl, [], rdSpaces, rdParts, []);
  const rdDoc: RiserDoc = { ...emptyRiserDoc(), links: [{ id: "lk-1", from: { kind: "placement", placementId: "p1" }, to: { kind: "space", spaceId: null }, partId: "W", lengthFt: 25, by: "t", at: 1 }] };
  const rdView = buildRiserView({ graph: rdGraph, spaces: rdSpaces, placements: rdPl, routes: [], doc: rdDoc, partDesc: (id) => rdParts.find((p) => p.id === id)?.desc || id });
  ok(rdView.nodes.map((n) => n.key).join() === `sp-a,sp-b,${UNASSIGNED_KEY}`, "#209 riser view: every space is a node (empty ones too, so devices can be added), plus Unassigned when a link lands there");
  ok(rdView.nodes[0].groups[0].ids.join() === "p2,p1", "#209 riser view: a device row knows its placements, oldest first");
  const rdEdge = rdView.edges[0];
  ok(rdView.edges.length === 1 && rdEdge.kind === "link" && rdEdge.from.key === "sp-a" && rdEdge.from.partId === "FIX" && rdEdge.to.key === UNASSIGNED_KEY && rdEdge.desc === "Cable" && rdEdge.lengthFt === 25, "#209 riser view: a RiserLink is an edge anchored on its device row");
  ok(rdView.nodes.every((n) => n.box.h >= nodeMinH(n.groups.length) - 1e-9) && rdView.height >= RISER_H, "#209 riser view: boxes never clip their rows");
  const rdDangling = buildRiserView({ graph: rdGraph, spaces: rdSpaces, placements: rdPl, routes: [], doc: { ...rdDoc, links: [{ ...rdDoc.links[0], from: { kind: "placement", placementId: "gone" } }] } });
  ok(rdDangling.edges.length === 0 && !rdDangling.nodes.some((n) => n.key === UNASSIGNED_KEY), "#209 riser view: a link to a vanished device is not drawn");
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | tail -3`
Expected: aborts with `Cannot find module '@/lib/design/grid-riser-doc'`.

- [ ] **Step 3: Create `src/lib/design/grid-riser-doc.ts`**

```ts
/**
 * The Grid — editable riser document (drawing set spec 2026-09-25 §4, #209).
 *
 * Devices, spaces and wire runs stay DERIVED from the plan (riserGraph,
 * D112) — the riser can never drift from the layout. This document holds
 * only what the plan cannot know, per option: where each node sits, level
 * lines, conduit annotations (never priced), riser notes, and RiserLinks —
 * typed-length cable runs between things that are not on one calibrated
 * page, priced through routeLines exactly like a wire route.
 *
 * Coordinates are normalized 0..1 against a RISER_W × RISER_H canvas (y may
 * run past 1 when the riser grows downward). Pure and dependency-free (the
 * grid-bom rule): the store, the riser page, the client riser editor and the
 * harness all import it.
 */

import type { Point } from "@/lib/annotations";
import { pointInPolygon, polygonCentroid, spaceOf, type SpaceLite } from "./grid-geometry";
import type { RiserGraph, RiserGroup } from "./grid-riser";

export const RISER_W = 1000;
export const RISER_H = 620;
/** Node header and device-row heights, in canvas units. */
export const NODE_HEAD = 24;
export const NODE_ROW = 16;
/** The node key for devices and ends that sit in no space. */
export const UNASSIGNED_KEY = "unassigned";

export type EndRef = { kind: "space"; spaceId: string | null } | { kind: "placement"; placementId: string };
export type RiserNodeBox = { x: number; y: number; w: number; h: number };
export type RiserLevel = { id: string; label: string; elevation?: string; y: number };
export type RiserConduit = { id: string; from: EndRef; to: EndRef; label: string; points?: Point[] };
export type RiserNote = { id: string; n: number; text: string };
export type RiserLink = { id: string; from: EndRef; to: EndRef; partId: string; lengthFt: number; by: string; at: number };
export type RiserDoc = {
  /** Keyed by space id, or UNASSIGNED_KEY. */
  nodes: Record<string, RiserNodeBox>;
  levels: RiserLevel[];
  conduits: RiserConduit[];
  notes: RiserNote[];
  links: RiserLink[];
};

export type RiserIdPrefix = "lv-" | "cd-" | "nt-" | "lk-";

export const RISER_OP_NAMES = [
  "moveNode", "addLevel", "updateLevel", "removeLevel", "addConduit", "updateConduit", "removeConduit",
  "addNote", "updateNote", "removeNote", "removeLink",
] as const;

export type RiserOp =
  | { op: "moveNode"; key: string; box: RiserNodeBox }
  | { op: "addLevel"; label: string; elevation?: string; y: number }
  | { op: "updateLevel"; id: string; label?: string; elevation?: string; y?: number }
  | { op: "removeLevel"; id: string }
  | { op: "addConduit"; from: EndRef; to: EndRef; label: string }
  | { op: "updateConduit"; id: string; label: string }
  | { op: "removeConduit"; id: string }
  | { op: "addNote"; text: string }
  | { op: "updateNote"; id: string; text: string }
  | { op: "removeNote"; id: string }
  | { op: "removeLink"; id: string };

const LABEL_MAX = 60;
const ELEVATION_MAX = 30;
const NOTE_MAX = 500;
const MIN_W = 0.1;
const MIN_H = 0.06;
/** How far down a riser may grow, in canvas heights. */
const MAX_Y = 3;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function emptyRiserDoc(): RiserDoc {
  return { nodes: {}, levels: [], conduits: [], notes: [], links: [] };
}

export function isEndRef(v: unknown): v is EndRef {
  if (!v || typeof v !== "object") return false;
  const e = v as { kind?: unknown; spaceId?: unknown; placementId?: unknown };
  if (e.kind === "space") return e.spaceId === null || (typeof e.spaceId === "string" && e.spaceId.length > 0);
  if (e.kind === "placement") return typeof e.placementId === "string" && e.placementId.length > 0;
  return false;
}

export function sameEnd(a: EndRef, b: EndRef): boolean {
  if (a.kind === "space" && b.kind === "space") return a.spaceId === b.spaceId;
  if (a.kind === "placement" && b.kind === "placement") return a.placementId === b.placementId;
  return false;
}

function isBox(v: unknown): v is RiserNodeBox {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return [b.x, b.y, b.w, b.h].every((n) => typeof n === "number" && Number.isFinite(n));
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Defensive read of a stored (or absent) document — never throws. */
export function normalizeRiserDoc(raw: unknown): RiserDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
  const nodes: Record<string, RiserNodeBox> = {};
  if (r.nodes && typeof r.nodes === "object" && !Array.isArray(r.nodes)) {
    for (const [k, b] of Object.entries(r.nodes as Record<string, unknown>)) {
      if (isBox(b)) nodes[k] = { x: b.x, y: b.y, w: b.w, h: b.h };
    }
  }
  return {
    nodes,
    levels: arr(r.levels).filter((l) => isStr(l.id) && isStr(l.label) && isNum(l.y)) as unknown as RiserLevel[],
    conduits: arr(r.conduits).filter((c) => isStr(c.id) && isStr(c.label) && isEndRef(c.from) && isEndRef(c.to)) as unknown as RiserConduit[],
    notes: arr(r.notes).filter((n) => isStr(n.id) && isStr(n.text) && isNum(n.n)) as unknown as RiserNote[],
    links: arr(r.links).filter(
      (l) => isStr(l.id) && isStr(l.partId) && isNum(l.lengthFt) && isEndRef(l.from) && isEndRef(l.to)
    ) as unknown as RiserLink[],
  };
}

/** One option's RiserLinks — what routeLines prices beside the routes. */
export function riserLinksOf(riser: Record<string, unknown> | null | undefined, optionId: string): RiserLink[] {
  return normalizeRiserDoc(riser?.[optionId]).links;
}

export function nodeKeyOf(spaceId: string | null): string {
  return spaceId ?? UNASSIGNED_KEY;
}

/** Normalized height a node needs for its header + rows. */
export function nodeMinH(groupCount: number): number {
  return (NODE_HEAD + 6 + Math.max(1, groupCount) * NODE_ROW + 8) / RISER_H;
}

/* -------------------------------- layout -------------------------------- */

const COLS = 4;
const BOX_W = 0.2;
const GAP_X = (1 - COLS * BOX_W) / (COLS + 1);
const BOX_H = 0.24;
const ROW_STEP = 0.34;
const TOP = 0.08;

/** The auto layout's n-th slot: four columns, rows downward. */
export function autoBox(slot: number): RiserNodeBox {
  const c = slot % COLS;
  const row = Math.floor(slot / COLS);
  return { x: r3(GAP_X + c * (BOX_W + GAP_X)), y: r3(TOP + row * ROW_STEP), w: BOX_W, h: BOX_H };
}

function overlaps(a: RiserNodeBox, b: RiserNodeBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Saved positions win; every node without one takes the next auto slot that
 * no placed box overlaps. Saved boxes for nodes that no longer exist are
 * ignored (a deleted space leaves nothing behind on the canvas).
 */
export function mergeLayout(keys: string[], saved: Record<string, RiserNodeBox> | undefined): Record<string, RiserNodeBox> {
  const out: Record<string, RiserNodeBox> = {};
  const placed: RiserNodeBox[] = [];
  for (const k of keys) {
    const s = saved?.[k];
    if (s) {
      out[k] = s;
      placed.push(s);
    }
  }
  let slot = 0;
  keys.forEach((k, i) => {
    if (out[k]) return;
    let box: RiserNodeBox | null = null;
    for (let tries = 0; tries < 64; tries++) {
      const cand = autoBox(slot++);
      if (!placed.some((p) => overlaps(p, cand))) {
        box = cand;
        break;
      }
    }
    const b = box || autoBox(i);
    out[k] = b;
    placed.push(b);
  });
  return out;
}

/* ------------------------------- reducer ------------------------------- */

function renumber(notes: RiserNote[]): RiserNote[] {
  return notes.map((n, i) => ({ ...n, n: i + 1 }));
}

/**
 * Apply one edit. Returns `changed: false` (and the document untouched) for
 * anything invalid — a blank label, an unknown id, a self-loop conduit — so
 * the action can refuse it instead of writing a no-op.
 */
export function applyRiserOp(
  input: RiserDoc,
  op: RiserOp,
  makeId: (prefix: RiserIdPrefix) => string
): { doc: RiserDoc; changed: boolean } {
  const doc = normalizeRiserDoc(input);
  const same = { doc, changed: false };
  switch (op.op) {
    case "moveNode": {
      const b = op.box;
      if (!op.key || !isBox(b)) return same;
      const w = clamp(b.w, MIN_W, 1);
      const h = clamp(b.h, MIN_H, MAX_Y);
      const box = { x: r3(clamp(b.x, 0, 1 - w)), y: r3(clamp(b.y, 0, MAX_Y)), w: r3(w), h: r3(h) };
      return { doc: { ...doc, nodes: { ...doc.nodes, [op.key]: box } }, changed: true };
    }
    case "addLevel": {
      const label = text(op.label, LABEL_MAX);
      if (!label || !isNum(op.y)) return same;
      const elevation = text(op.elevation, ELEVATION_MAX);
      const level: RiserLevel = { id: makeId("lv-"), label, ...(elevation ? { elevation } : {}), y: r3(clamp(op.y, 0, MAX_Y)) };
      return { doc: { ...doc, levels: [...doc.levels, level] }, changed: true };
    }
    case "updateLevel": {
      const i = doc.levels.findIndex((l) => l.id === op.id);
      if (i < 0) return same;
      const next: RiserLevel = { ...doc.levels[i] };
      if (op.label !== undefined) {
        const l = text(op.label, LABEL_MAX);
        if (!l) return same;
        next.label = l;
      }
      if (op.elevation !== undefined) {
        const e = text(op.elevation, ELEVATION_MAX);
        if (e) next.elevation = e;
        else delete next.elevation;
      }
      if (op.y !== undefined) {
        if (!isNum(op.y)) return same;
        next.y = r3(clamp(op.y, 0, MAX_Y));
      }
      const levels = [...doc.levels];
      levels[i] = next;
      return { doc: { ...doc, levels }, changed: true };
    }
    case "removeLevel": {
      if (!doc.levels.some((l) => l.id === op.id)) return same;
      return { doc: { ...doc, levels: doc.levels.filter((l) => l.id !== op.id) }, changed: true };
    }
    case "addConduit": {
      if (!isEndRef(op.from) || !isEndRef(op.to) || sameEnd(op.from, op.to)) return same;
      const label = text(op.label, LABEL_MAX);
      if (!label) return same;
      return { doc: { ...doc, conduits: [...doc.conduits, { id: makeId("cd-"), from: op.from, to: op.to, label }] }, changed: true };
    }
    case "updateConduit": {
      const label = text(op.label, LABEL_MAX);
      if (!label || !doc.conduits.some((c) => c.id === op.id)) return same;
      return { doc: { ...doc, conduits: doc.conduits.map((c) => (c.id === op.id ? { ...c, label } : c)) }, changed: true };
    }
    case "removeConduit": {
      if (!doc.conduits.some((c) => c.id === op.id)) return same;
      return { doc: { ...doc, conduits: doc.conduits.filter((c) => c.id !== op.id) }, changed: true };
    }
    case "addNote": {
      const t = text(op.text, NOTE_MAX);
      if (!t) return same;
      return { doc: { ...doc, notes: renumber([...doc.notes, { id: makeId("nt-"), n: 0, text: t }]) }, changed: true };
    }
    case "updateNote": {
      const t = text(op.text, NOTE_MAX);
      if (!t || !doc.notes.some((n) => n.id === op.id)) return same;
      return { doc: { ...doc, notes: doc.notes.map((n) => (n.id === op.id ? { ...n, text: t } : n)) }, changed: true };
    }
    case "removeNote": {
      if (!doc.notes.some((n) => n.id === op.id)) return same;
      return { doc: { ...doc, notes: renumber(doc.notes.filter((n) => n.id !== op.id)) }, changed: true };
    }
    case "removeLink": {
      if (!doc.links.some((l) => l.id === op.id)) return same;
      return { doc: { ...doc, links: doc.links.filter((l) => l.id !== op.id) }, changed: true };
    }
  }
  return same;
}

/* ---------------------------- device drops ---------------------------- */

/**
 * `n` points inside a space polygon for "+ Device": a square spiral out from
 * the centroid on a `step` grid, skipping points outside the polygon or too
 * close to anything already there, so multiples never stack. A polygon too
 * small to hold them all falls back to the centroid for the rest.
 */
export function spreadInSpace(poly: Point[], n: number, taken: Point[] = [], step = 0.02): Point[] {
  const c = polygonCentroid(poly);
  const out: Point[] = [];
  const free = (p: Point) => [...taken, ...out].every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= step * 0.75);
  for (let ring = 0; ring <= 25 && out.length < n; ring++) {
    for (let dy = -ring; dy <= ring && out.length < n; dy++) {
      for (let dx = -ring; dx <= ring && out.length < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const p = { x: r4(c.x + dx * step), y: r4(c.y + dy * step) };
        if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
        if (pointInPolygon(p, poly) && free(p)) out.push(p);
      }
    }
  }
  while (out.length < n) out.push({ x: r4(c.x), y: r4(c.y) });
  return out;
}

/** `n` points along the plan's lower margin, outside every space on that
 *  page — where "+ Device" on the Unassigned node lands. */
export function marginPoints(n: number, blockers: Point[][], taken: Point[] = []): Point[] {
  const out: Point[] = [];
  const clear = (p: Point) =>
    !blockers.some((poly) => pointInPolygon(p, poly)) &&
    [...taken, ...out].every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= 0.02);
  for (const y of [0.965, 0.935, 0.905]) {
    for (let i = 0; i <= 30 && out.length < n; i++) {
      const p = { x: r4(0.04 + i * 0.03), y };
      if (clear(p)) out.push(p);
    }
    if (out.length >= n) break;
  }
  while (out.length < n) out.push({ x: 0.04, y: 0.965 });
  return out;
}

/** The "Space" tool's rectangle: small, on the plan's lower margin,
 *  staggered by how many spaces the page already has. */
export function marginSpaceRect(index: number): Point[] {
  const i = Math.max(0, Math.floor(index)) % 8;
  const x0 = r3(0.04 + i * 0.115);
  const y0 = 0.86;
  const w = 0.1;
  const h = 0.07;
  return [
    { x: x0, y: y0 },
    { x: r3(x0 + w), y: y0 },
    { x: r3(x0 + w), y: r3(y0 + h) },
    { x: x0, y: r3(y0 + h) },
  ];
}

/**
 * Connect's rule: two DIFFERENT placements on the same sheet + page, and that
 * page is calibrated → a real GridRoute, priced by its measured length.
 * Anything else (cross-sheet, a space end, an uncalibrated page) → a
 * RiserLink with a typed length.
 */
export function connectKind(
  from: EndRef,
  to: EndRef,
  placements: ReadonlyArray<{ id: string; sheetId: string; page: number }>,
  cals: ReadonlyArray<{ docId: string; page: number }>
): "route" | "link" {
  if (from.kind !== "placement" || to.kind !== "placement" || from.placementId === to.placementId) return "link";
  const a = placements.find((p) => p.id === from.placementId);
  const b = placements.find((p) => p.id === to.placementId);
  if (!a || !b || a.sheetId !== b.sheetId || a.page !== b.page) return "link";
  return cals.some((c) => c.docId === a.sheetId && c.page === a.page) ? "route" : "link";
}

/* ---------------------------- prune + copy ---------------------------- */

export type GoneRefs = { placementIds?: ReadonlySet<string>; spaceIds?: ReadonlySet<string> };

/** Drop links and conduits with an end on a removed device/space, and the
 *  saved boxes of removed spaces. */
export function pruneRiserEnds(doc: RiserDoc, gone: GoneRefs): RiserDoc {
  const dead = (e: EndRef) =>
    e.kind === "placement" ? Boolean(gone.placementIds?.has(e.placementId)) : Boolean(e.spaceId && gone.spaceIds?.has(e.spaceId));
  const nodes = { ...doc.nodes };
  for (const id of gone.spaceIds || []) delete nodes[id];
  return {
    ...doc,
    nodes,
    links: doc.links.filter((l) => !dead(l.from) && !dead(l.to)),
    conduits: doc.conduits.filter((c) => !dead(c.from) && !dead(c.to)),
  };
}

/** pruneRiserEnds over every option's document. */
export function pruneRisers(riser: Record<string, RiserDoc> | undefined, gone: GoneRefs): Record<string, RiserDoc> | undefined {
  if (!riser) return riser;
  const out: Record<string, RiserDoc> = {};
  for (const [k, d] of Object.entries(riser)) out[k] = pruneRiserEnds(normalizeRiserDoc(d), gone);
  return out;
}

/** An option copy's riser: same layout, new ids, device ends re-pointed at
 *  the copied placements (an end whose device wasn't copied drops out). */
export function copyRiserDoc(
  src: RiserDoc | undefined,
  idMap: ReadonlyMap<string, string>,
  makeId: (prefix: RiserIdPrefix) => string,
  by: string,
  at: number
): RiserDoc {
  const d = normalizeRiserDoc(src);
  const map = (e: EndRef): EndRef | null => {
    if (e.kind === "space") return { kind: "space", spaceId: e.spaceId };
    const next = idMap.get(e.placementId);
    return next ? { kind: "placement", placementId: next } : null;
  };
  const links: RiserLink[] = [];
  for (const l of d.links) {
    const from = map(l.from);
    const to = map(l.to);
    if (from && to) links.push({ ...l, id: makeId("lk-"), from, to, by, at });
  }
  const conduits: RiserConduit[] = [];
  for (const c of d.conduits) {
    const from = map(c.from);
    const to = map(c.to);
    if (from && to) conduits.push({ ...c, id: makeId("cd-"), from, to });
  }
  return {
    nodes: { ...d.nodes },
    levels: d.levels.map((l) => ({ ...l, id: makeId("lv-") })),
    conduits,
    notes: d.notes.map((n) => ({ ...n, id: makeId("nt-") })),
    links,
  };
}

/* --------------------------------- view --------------------------------- */

export type RiserViewGroup = RiserGroup & { ids: string[]; iconId: string; color: string };
export type RiserViewNode = {
  key: string;
  spaceId: string | null;
  name: string;
  color: string;
  groups: RiserViewGroup[];
  box: RiserNodeBox;
};
export type EndAnchor = { key: string; partId: string | null };
export type RiserViewEdge = {
  id: string;
  kind: "route" | "link";
  partId: string;
  desc: string;
  from: EndAnchor;
  to: EndAnchor;
  lengthFt: number | null;
  unit: string;
};
export type RiserViewConduit = { id: string; from: EndAnchor; to: EndAnchor; label: string };
export type RiserView = {
  nodes: RiserViewNode[];
  edges: RiserViewEdge[];
  conduits: RiserViewConduit[];
  levels: RiserLevel[];
  notes: RiserNote[];
  /** Canvas height in units (≥ RISER_H). */
  height: number;
};

/**
 * Everything the riser draws: EVERY space as a node (an empty room is still a
 * place to add devices), Unassigned when it holds devices or any end, the
 * derived device rows (with their placement ids, oldest first, for edit and
 * delete), route edges from the graph, RiserLink edges, conduits, levels and
 * notes. Ends that no longer resolve are simply not drawn.
 */
export function buildRiserView(input: {
  graph: RiserGraph;
  spaces: Array<SpaceLite & { name: string; color?: string }>;
  placements: Array<{ id: string; sheetId: string; page: number; x: number; y: number; partId: string; at: number; curtain?: unknown }>;
  routes: Array<{ id: string; fromPlacementId?: string; toPlacementId?: string }>;
  doc: RiserDoc | null | undefined;
  look?: (g: RiserGroup) => { iconId: string; color: string };
  partDesc?: (partId: string) => string;
}): RiserView {
  const doc = normalizeRiserDoc(input.doc);
  const look = input.look || (() => ({ iconId: "device", color: "#8c919c" }));
  const desc = input.partDesc || ((id: string) => id);
  const byId = new Map(input.placements.map((p) => [p.id, p]));
  const homeKey = (pl: { sheetId: string; page: number; x: number; y: number }) => nodeKeyOf(spaceOf(pl, input.spaces)?.id ?? null);

  const ids = new Map<string, string[]>();
  for (const pl of [...input.placements].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    if (pl.curtain) continue; // riserGraph leaves curtains off the one-line
    const k = `${homeKey(pl)}|${pl.partId}`;
    ids.set(k, [...(ids.get(k) || []), pl.id]);
  }

  const spaceIds = new Set(input.spaces.map((s) => s.id));
  const anchor = (e: EndRef): EndAnchor | null => {
    if (e.kind === "space") {
      if (e.spaceId && !spaceIds.has(e.spaceId)) return null;
      return { key: nodeKeyOf(e.spaceId), partId: null };
    }
    const pl = byId.get(e.placementId);
    return pl && !pl.curtain ? { key: homeKey(pl), partId: pl.partId } : null;
  };

  const routeById = new Map(input.routes.map((r) => [r.id, r]));
  const edges: RiserViewEdge[] = [];
  for (const e of input.graph.edges) {
    const r = routeById.get(e.routeId);
    const from = (r?.fromPlacementId ? anchor({ kind: "placement", placementId: r.fromPlacementId }) : null) || { key: nodeKeyOf(e.fromSpaceId), partId: null };
    const to = (r?.toPlacementId ? anchor({ kind: "placement", placementId: r.toPlacementId }) : null) || { key: nodeKeyOf(e.toSpaceId), partId: null };
    edges.push({ id: e.routeId, kind: "route", partId: e.partId, desc: desc(e.partId), from, to, lengthFt: e.lengthFt, unit: e.unit });
  }
  for (const l of doc.links) {
    const from = anchor(l.from);
    const to = anchor(l.to);
    if (from && to) edges.push({ id: l.id, kind: "link", partId: l.partId, desc: desc(l.partId), from, to, lengthFt: l.lengthFt, unit: "ft" });
  }
  const conduits: RiserViewConduit[] = [];
  for (const c of doc.conduits) {
    const from = anchor(c.from);
    const to = anchor(c.to);
    if (from && to) conduits.push({ id: c.id, from, to, label: c.label });
  }

  const graphNode = new Map(input.graph.nodes.map((n) => [nodeKeyOf(n.spaceId), n]));
  const used = new Set<string>([...edges, ...conduits].flatMap((x) => [x.from.key, x.to.key]));
  const keys = input.spaces.map((s) => s.id);
  const un = graphNode.get(UNASSIGNED_KEY);
  if ((un && un.groups.length > 0) || used.has(UNASSIGNED_KEY)) keys.push(UNASSIGNED_KEY);
  const boxes = mergeLayout(keys, doc.nodes);

  const nodes: RiserViewNode[] = keys.map((key) => {
    const space = input.spaces.find((s) => s.id === key);
    const g = graphNode.get(key);
    const groups: RiserViewGroup[] = (g?.groups || []).map((grp) => ({ ...grp, ids: ids.get(`${key}|${grp.partId}`) || [], ...look(grp) }));
    const b = boxes[key];
    return {
      key,
      spaceId: space ? space.id : null,
      name: space ? space.name : "Unassigned",
      color: space?.color || g?.color || "#9aa0ab",
      groups,
      box: { ...b, h: Math.max(b.h, r3(nodeMinH(groups.length))) },
    };
  });

  const bottom = Math.max(1, ...nodes.map((n) => n.box.y + n.box.h), ...doc.levels.map((l) => l.y));
  return { nodes, edges, conduits, levels: doc.levels, notes: doc.notes, height: Math.ceil(bottom * RISER_H + 24) };
}
```

- [ ] **Step 4: Extend `routeLines` in `src/lib/design/grid-bom.ts`** — replace the signature and the `for (const r of routes) { … }` loop's end so links are folded in. Replace:

```ts
export function routeLines(
  routes: RouteLite[],
  parts: PartLite[],
  cals: Calibration[]
): { lines: BomLine[]; value: number; cost: number; unmeasured: number } {
```

with:

```ts
export function routeLines(
  routes: RouteLite[],
  parts: PartLite[],
  cals: Calibration[],
  /** RiserLinks (#209) — typed-length cable runs from the riser. Summed with
   *  the measured routes of the same part BEFORE rounding up, so a part's
   *  footage is bought whole once. They carry no validated connectionType,
   *  so a line they touch is never annotated with one. */
  links: ReadonlyArray<{ partId: string; lengthFt: number }> = []
): { lines: BomLine[]; value: number; cost: number; unmeasured: number } {
```

and immediately after the closing `}` of the `for (const r of routes) { … }` loop (the line before `const lines: BomLine[] = [];`), insert:

```ts
  for (const l of links) {
    if (!(l.lengthFt > 0) || !Number.isFinite(l.lengthFt)) {
      unmeasured++;
      continue;
    }
    feet.set(l.partId, (feet.get(l.partId) || 0) + l.lengthFt);
    hasUnstamped.add(l.partId);
  }
```

- [ ] **Step 5: Return the id map from `copyOptionMembers`** in `src/lib/design/grid-options.ts` — change the return type line

```ts
}): { placements: P[]; routes: R[] } {
```

to

```ts
}): { placements: P[]; routes: R[]; idMap: Map<string, string> } {
```

and the final statement `return { placements, routes };` to

```ts
  // idMap (old placement id → copied id) lets the caller re-point anything
  // else that references devices — the riser document's links (#209).
  return { placements, routes, idMap };
```

- [ ] **Step 6: Run the harness to verify it passes**

Run: `npm run test:specs 2>&1 | grep -E "#209|FAIL|ALL PASSED|FAILED"`
Expected: all `#209` lines `PASS` (Tasks 1–3), `ALL PASSED`.

- [ ] **Step 7: Gates**

Run: `npx tsc --noEmit && npx eslint 2>&1 | tail -1`
Expected: tsc silent; `✖ 111 problems (0 errors, 111 warnings)`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/grid-riser-doc.ts src/lib/design/grid-bom.ts src/lib/design/grid-options.ts scripts/test-review-and-spec.ts
git -c user.name="SM" commit -m "feat(grid): riser document model — saved layout, levels, conduits, notes, RiserLinks priced like routes (#209)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Persistence — riser document + drawing-set settings on the Grid project, actions, BOM wiring

**Files:**
- Modify: `src/lib/stores/grid-projects.ts`
- Create: `src/lib/stores/grid-riser.ts`
- Create: `src/lib/design/grid-part-lookup.ts`
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (move `partForGrid` out)
- Create: `src/app/(app)/design/grid/[id]/riser/actions.ts`
- Create: `src/app/(app)/design/grid/[id]/set/actions.ts`
- Modify: `src/lib/settings.ts`, `src/app/(app)/design/grid/settings/actions.ts`
- Modify: `src/lib/design/grid-quote.ts`
- Modify: `src/app/(app)/design/grid/[id]/page.tsx`, `src/app/(app)/design/grid/[id]/editor.tsx`
- Test: `scripts/test-review-regressions.ts` (block inside `main()`), `scripts/test-review-and-spec.ts` (append block at EOF)

**Interfaces:**
- Consumes (Task 3): `applyRiserOp`, `normalizeRiserDoc`, `pruneRisers`, `copyRiserDoc`, `spreadInSpace`, `marginPoints`, `nodeKeyOf`, `isEndRef`, `sameEnd`, `riserLinksOf`, `UNASSIGNED_KEY`, `RISER_OP_NAMES`, types `RiserDoc`, `RiserOp`, `EndRef`; (Task 1) `cleanDrawingSet`, `cleanStandardNotes`, `DrawingSetSettings`; `copyOptionMembers(...).idMap`.
- Produces (store `grid-projects`): `GridProject.riser?: Record<string, RiserDoc>`, `GridProject.drawingSet?: DrawingSetSettings`, `GridRevision.riser?: Record<string, RiserDoc>`, `setDrawingSet(projectId, patch: DrawingSetSettings, opts?: { resetGeneralNotes?: boolean }): Promise<GridProject | null>`; re-exports `type RiserDoc`, `type DrawingSetSettings`.
- Produces (store `grid-riser`): `MAX_NODE_QTY = 200`, `MAX_LINK_FT = 5000`,
  `patchRiser(projectId, optionId, op: RiserOp): Promise<{ ok: true } | { ok: false; reason: "not-found" | "no-such-option" | "invalid" }>`,
  `addRiserLink(projectId, { optionId, from, to, partId, lengthFt, by }): Promise<{ ok: true; id: string } | { ok: false; reason: "not-found" | "no-such-option" | "bad-end" | "bad-length" }>`,
  `addDevicesToNode(projectId, { optionId, nodeKey, partId, qty, by }): Promise<{ ok: true; added: number } | { ok: false; reason: "not-found" | "no-such-option" | "no-such-space" | "no-sheet" | "bad-qty" }>`,
  `setNodeDeviceQty(projectId, { optionId, nodeKey, partId, qty, by }): Promise<{ ok: true; added: number; removed: number } | { ok: false; reason: … | "no-devices" }>`,
  `replaceNodeDevicePart(projectId, { optionId, nodeKey, fromPartId, toPartId }): Promise<{ ok: true; changed: number } | { ok: false; reason: "not-found" | "no-such-option" | "no-devices" }>`,
  `removeNodeDevices(projectId, { optionId, nodeKey, partId }): Promise<{ ok: true; removed: number } | { ok: false; reason: "not-found" | "no-such-option" | "no-devices" }>`.
- Produces (server-only): `partForGrid(id)` from `@/lib/design/grid-part-lookup`.
- Produces (actions, all `Promise<{ ok: true } | { ok: false; error: string }>` unless noted; all `requireUser()` like every Grid edit):
  riser/actions — `patchRiserAction(projectId, optionId, op: RiserOp)`, `addRiserLinkAction(projectId, { optionId, from, to, partId, lengthFt })`, `riserAddDevicesAction(projectId, { optionId, nodeKey, partId, qty })`, `riserSetQtyAction(projectId, { optionId, nodeKey, partId, qty })`, `riserReplacePartAction(projectId, { optionId, nodeKey, fromPartId, toPartId })`, `riserRemoveDevicesAction(projectId, { optionId, nodeKey, partId })`;
  set/actions — `saveDrawingSetAction(projectId, patch: DrawingSetSettings, opts?: { resetGeneralNotes?: boolean })`;
  settings/actions — `saveStandardNotesAction(text: string): Promise<{ ok: true }>` (`requirePerm("manage_users")`).
- Produces (settings): `AppSettingsData.gridStandardNotes?: string | null`.
- Produces (editor): `ProjectLite.riser: Record<string, RiserDoc>`.

- [ ] **Step 1: Write the failing DB test** — in `scripts/test-review-regressions.ts`, insert immediately before the line `  console.log("review regression checks passed");`:

```ts
  // #209 — riser document + drawing-set settings persistence (scratch DB).
  {
    const GP = await import("@/lib/stores/grid-projects");
    const GR = await import("@/lib/stores/grid-riser");
    const { pointInPolygon: inPoly } = await import("@/lib/design/grid-geometry");
    const by = "tester";
    const p0 = await GP.createProject({ name: "GDS riser", customer: "", customerId: null, by });
    const sheet = (await GP.addSheet(p0.id, {
      name: "Plan",
      mime: "image/svg+xml",
      dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
      by,
    }))!;
    const stagePoly = [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 }];
    await GP.addSpace(p0.id, { sheetId: sheet.id, page: 1, name: "Stage", points: stagePoly, by });
    await GP.addSpace(p0.id, { sheetId: sheet.id, page: 1, name: "Booth", points: [{ x: 0.6, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.3 }, { x: 0.6, y: 0.3 }], by });
    let p = (await GP.getProject(p0.id))!;
    const opt = p.options![0].id;
    const [stage, booth] = p.spaces!;
    const devA = () => p.placements.filter((pl) => pl.partId === "DEV-A");

    // + Device lands inside the space
    assert.deepEqual(await GR.addDevicesToNode(p0.id, { optionId: opt, nodeKey: stage.id, partId: "DEV-A", qty: 3, by }), { ok: true, added: 3 });
    p = (await GP.getProject(p0.id))!;
    assert.equal(devA().length, 3, "#209 +Device: three placements written");
    assert.ok(devA().every((pl) => pl.sheetId === sheet.id && pl.page === 1 && pl.optionId === opt && inPoly(pl, stagePoly)), "#209 +Device: every device lands inside the space, on its sheet/page, in the option");

    // qty edit adds / removes
    assert.deepEqual(await GR.setNodeDeviceQty(p0.id, { optionId: opt, nodeKey: stage.id, partId: "DEV-A", qty: 5, by }), { ok: true, added: 2, removed: 0 });
    assert.deepEqual(await GR.setNodeDeviceQty(p0.id, { optionId: opt, nodeKey: stage.id, partId: "DEV-A", qty: 2, by }), { ok: true, added: 0, removed: 3 });
    p = (await GP.getProject(p0.id))!;
    assert.equal(devA().length, 2, "#209 qty edit: lowering the qty removes placements");

    // Unassigned → lower margin; unknown space refused
    assert.deepEqual(await GR.addDevicesToNode(p0.id, { optionId: opt, nodeKey: "unassigned", partId: "DEV-U", qty: 1, by }), { ok: true, added: 1 });
    p = (await GP.getProject(p0.id))!;
    const u = p.placements.find((pl) => pl.partId === "DEV-U")!;
    assert.ok(u.y > 0.85 && !inPoly(u, stagePoly), "#209 +Device: Unassigned devices land on the plan's lower margin");
    assert.deepEqual(await GR.addDevicesToNode(p0.id, { optionId: opt, nodeKey: "sp-nope", partId: "DEV-A", qty: 1, by }), { ok: false, reason: "no-such-space" });

    // part swap
    assert.deepEqual(await GR.replaceNodeDevicePart(p0.id, { optionId: opt, nodeKey: booth.id, fromPartId: "DEV-A", toPartId: "DEV-B" }), { ok: false, reason: "no-devices" });
    await GR.addDevicesToNode(p0.id, { optionId: opt, nodeKey: booth.id, partId: "DEV-C", qty: 1, by });
    assert.deepEqual(await GR.replaceNodeDevicePart(p0.id, { optionId: opt, nodeKey: booth.id, fromPartId: "DEV-C", toPartId: "DEV-B" }), { ok: true, changed: 1 });

    // RiserLink + document ops
    p = (await GP.getProject(p0.id))!;
    const a1 = devA()[0];
    const link = await GR.addRiserLink(p0.id, { optionId: opt, from: { kind: "placement", placementId: a1.id }, to: { kind: "space", spaceId: booth.id }, partId: "WIRE-X", lengthFt: 42.26, by });
    assert.ok(link.ok, "#209 Connect: a RiserLink is stored");
    assert.deepEqual(await GR.addRiserLink(p0.id, { optionId: opt, from: { kind: "placement", placementId: "gp-gone" }, to: { kind: "space", spaceId: null }, partId: "WIRE-X", lengthFt: 5, by }), { ok: false, reason: "bad-end" });
    assert.deepEqual(await GR.addRiserLink(p0.id, { optionId: opt, from: { kind: "space", spaceId: null }, to: { kind: "space", spaceId: booth.id }, partId: "WIRE-X", lengthFt: 0, by }), { ok: false, reason: "bad-length" });
    assert.deepEqual(await GR.patchRiser(p0.id, opt, { op: "addConduit", from: { kind: "space", spaceId: stage.id }, to: { kind: "space", spaceId: booth.id }, label: "1in EMT by EC" }), { ok: true });
    assert.deepEqual(await GR.patchRiser(p0.id, opt, { op: "addNote", text: "Verify in field" }), { ok: true });
    assert.deepEqual(await GR.patchRiser(p0.id, opt, { op: "addLevel", label: "Level 1", y: 0.9 }), { ok: true });
    assert.deepEqual(await GR.patchRiser(p0.id, opt, { op: "moveNode", key: stage.id, box: { x: 0.5, y: 0.1, w: 0.2, h: 0.2 } }), { ok: true });
    assert.deepEqual(await GR.patchRiser(p0.id, opt, { op: "addNote", text: "   " }), { ok: false, reason: "invalid" });
    assert.deepEqual(await GR.patchRiser(p0.id, "opt-nope", { op: "addNote", text: "x" }), { ok: false, reason: "no-such-option" });
    p = (await GP.getProject(p0.id))!;
    const doc = p.riser![opt];
    assert.equal(doc.links[0].lengthFt, 42.3, "#209 a link length is kept to 0.1 ft");
    assert.ok(doc.conduits.length === 1 && doc.notes[0].n === 1 && doc.levels.length === 1 && doc.nodes[stage.id].x === 0.5, "#209 riser doc: conduit, note, level and saved node box persist");

    // revisions snapshot + restore the riser document
    const rev = await GP.addRevision(p0.id, { by, note: "with riser" });
    assert.equal(rev?.riser?.[opt]?.links.length, 1, "#209 revisions: the snapshot carries the riser document");
    await GR.patchRiser(p0.id, opt, { op: "removeLink", id: doc.links[0].id });
    assert.equal((await GP.getProject(p0.id))!.riser![opt].links.length, 0);
    await GP.restoreRevision(p0.id, rev!.rev, by);
    assert.equal((await GP.getProject(p0.id))!.riser![opt].links.length, 1, "#209 revisions: restore brings the riser document back");

    // option copy re-points; option removal drops
    const copy = await GP.addOption(p0.id, { name: "Alt", copyFromOptionId: opt, by });
    assert.ok(copy.ok, "#209 option copy succeeds");
    if (copy.ok) {
      p = (await GP.getProject(p0.id))!;
      const alt = p.riser![copy.option.id];
      const altFrom = alt.links[0].from;
      assert.ok(
        altFrom.kind === "placement" && altFrom.placementId !== a1.id && p.placements.some((pl) => pl.id === altFrom.placementId && pl.optionId === copy.option.id),
        "#209 option copy: the copied link points at the copied device"
      );
      assert.equal(alt.notes[0].text, "Verify in field");
      await GP.removeOption(p0.id, copy.option.id, by);
      p = (await GP.getProject(p0.id))!;
      assert.ok(!(copy.option.id in (p.riser || {})), "#209 option removal drops that option's riser document");
    }

    // delete cascades
    await GR.removeNodeDevices(p0.id, { optionId: opt, nodeKey: stage.id, partId: "DEV-A" });
    p = (await GP.getProject(p0.id))!;
    assert.equal(p.riser![opt].links.length, 0, "#209 delete: removing the devices prunes the links that ended on them");
    await GP.removeSpace(p0.id, stage.id);
    p = (await GP.getProject(p0.id))!;
    assert.ok(p.riser![opt].conduits.length === 0 && !(stage.id in p.riser![opt].nodes), "#209 delete: removing a space prunes its conduits and saved box");

    // drawing-set settings
    await GP.setDrawingSet(p0.id, { size: "d", drawnBy: "  JC ", excluded: ["riser", "riser"] });
    assert.deepEqual((await GP.getProject(p0.id))!.drawingSet, { size: "d", drawnBy: "JC", excluded: ["riser"] });
    await GP.setDrawingSet(p0.id, { generalNotes: "" });
    let ds = (await GP.getProject(p0.id))!.drawingSet!;
    assert.ok(ds.generalNotes === "" && ds.size === "d", "#209 set settings merge; an explicit empty notes text is kept");
    await GP.setDrawingSet(p0.id, {}, { resetGeneralNotes: true });
    ds = (await GP.getProject(p0.id))!.drawingSet!;
    assert.ok(!("generalNotes" in ds) && ds.size === "d", "#209 'Use standard notes' removes the set's own notes");
  }
```

- [ ] **Step 2: Write the failing source checks** — append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #209 grid drawing set — Task 4: RiserLinks reach the quote and the editor BOM --- */
{
  const gdsQuoteSrc = readFileSync(join(process.cwd(), "src/lib/design/grid-quote.ts"), "utf8");
  ok(gdsQuoteSrc.includes("const riserLinks = riserLinksOf(project.riser, optionId);") && gdsQuoteSrc.includes("routeLines(routes, tierCatalog, project.calibrations || [], riserLinks)"), "#209 quote: RiserLinks price as wire lines on the draft quote");
  const gdsEditorSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/editor.tsx"), "utf8");
  ok(gdsEditorSrc.includes("routeLines(routes || [], parts, project.calibrations, riserLinks)"), "#209 editor: the live BOM sidebar counts RiserLinks too");
  const gdsStoreSrc = readFileSync(join(process.cwd(), "src/lib/stores/grid-projects.ts"), "utf8");
  ok(gdsStoreSrc.includes("riser: p.riser ? (JSON.parse(JSON.stringify(p.riser))"), "#209 revisions: snapshotOf copies the riser document");
  const gdsActionsSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/riser/actions.ts"), "utf8");
  ok((gdsActionsSrc.match(/await requireUser\(\)/g) || []).length === 6, "#209 riser actions: every one is behind requireUser, the Grid editing gate");
}
```

- [ ] **Step 3: Run both harnesses to verify they fail**

Run: `D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH=$D npx tsx scripts/test-review-regressions.ts 2>&1 | tail -3`
Expected: fails with `Cannot find module '@/lib/stores/grid-riser'`.
Run: `npm run test:specs 2>&1 | grep -E "#209 quote|#209 editor|#209 revisions|#209 riser actions|FAILED" | head`
Expected: the harness aborts reading `riser/actions.ts` (`ENOENT`) or the quote/editor lines print `FAIL`.

- [ ] **Step 4: Store fields, revisions, cascades — `src/lib/stores/grid-projects.ts`**

(a) Imports — immediately after the line `export type { GridOption } from "@/lib/design/grid-options";` add:

```ts
import { copyRiserDoc, pruneRisers, type RiserDoc } from "@/lib/design/grid-riser-doc";
import { cleanDrawingSet, type DrawingSetSettings } from "@/lib/design/grid-drawing-set";
export type { RiserDoc } from "@/lib/design/grid-riser-doc";
export type { DrawingSetSettings } from "@/lib/design/grid-drawing-set";
```

(b) `GridRevision` — replace

```ts
  /** Option list at snapshot time (Spec 1). Absent on older snapshots —
   *  restore normalizes to a single default option. */
  options?: GridOption[];
};
```

with

```ts
  /** Option list at snapshot time (Spec 1). Absent on older snapshots —
   *  restore normalizes to a single default option. */
  options?: GridOption[];
  /** Riser documents at snapshot time (#209). Absent on older snapshots —
   *  restore then drops back to the auto layout. */
  riser?: Record<string, RiserDoc>;
};
```

(c) `GridProject` — replace

```ts
  scopeInputs?: QuickScopeInputs | null;
  createdBy: string;
```

with

```ts
  scopeInputs?: QuickScopeInputs | null;
  /** Saved riser document per option id (#209) — node layout, level lines,
   *  conduit annotations, riser notes and RiserLinks. Absent = auto layout. */
  riser?: Record<string, RiserDoc>;
  /** Drawing-set settings (#209) — size, drawn/checked by, excluded sheets,
   *  general notes, revision labels. Absent = defaults. */
  drawingSet?: DrawingSetSettings;
  createdBy: string;
```

(d) `removePlacement` — replace its patch body

```ts
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.placements = (p.placements || []).filter((pl) => pl.id !== placementId);
    p.updatedAt = Date.now();
  });
```

with

```ts
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.placements = (p.placements || []).filter((pl) => pl.id !== placementId);
    // A riser link or conduit that ended on this device goes with it (#209).
    if (p.riser) p.riser = pruneRisers(p.riser, { placementIds: new Set([placementId]) });
    p.updatedAt = Date.now();
  });
```

(e) `removeSpace` — replace

```ts
    p.spaces = (p.spaces || []).filter((s) => s.id !== spaceId);
    p.updatedAt = Date.now();
```

with

```ts
    p.spaces = (p.spaces || []).filter((s) => s.id !== spaceId);
    // Its riser box, and any link/conduit ending on it, go too (#209).
    if (p.riser) p.riser = pruneRisers(p.riser, { spaceIds: new Set([spaceId]) });
    p.updatedAt = Date.now();
```

(f) `addOption` — replace

```ts
      doc.placements = [...(doc.placements || []), ...copied.placements];
      doc.routes = [...(doc.routes || []), ...copied.routes];
    }
```

with

```ts
      doc.placements = [...(doc.placements || []), ...copied.placements];
      doc.routes = [...(doc.routes || []), ...copied.routes];
      // The copied option gets its own riser document, device ends re-pointed
      // at the copied placements (#209).
      const srcRiser = doc.riser?.[input.copyFromOptionId];
      if (srcRiser) {
        doc.riser = { ...doc.riser, [option.id]: copyRiserDoc(srcRiser, copied.idMap, (prefix) => rid(prefix), input.by, at) };
      }
    }
```

(g) `removeOption` — replace

```ts
    doc.options = doc.options.filter((o) => o.id !== optionId);
    syncQuoteMirror(doc);
```

with

```ts
    doc.options = doc.options.filter((o) => o.id !== optionId);
    if (doc.riser && optionId in doc.riser) {
      const riser = { ...doc.riser };
      delete riser[optionId];
      doc.riser = riser;
    }
    syncQuoteMirror(doc);
```

(h) `snapshotOf` — replace

```ts
    routes: [...(p.routes || [])],
    options: ensureOptions({
```

with

```ts
    routes: [...(p.routes || [])],
    // Deep copy: the riser document is nested and patched in place later.
    riser: p.riser ? (JSON.parse(JSON.stringify(p.riser)) as Record<string, RiserDoc>) : {},
    options: ensureOptions({
```

(i) `restoreRevision` — replace

```ts
    doc.routes = [...(target.routes || [])];
```

with

```ts
    doc.routes = [...(target.routes || [])];
    // The riser document is design state like placements (#209): restored
    // wholesale. A pre-#209 snapshot has none → back to the auto layout.
    if (target.riser) doc.riser = JSON.parse(JSON.stringify(target.riser)) as Record<string, RiserDoc>;
    else delete doc.riser;
```

(j) Immediately after the closing `}` of `setScopeInputs`, add:

```ts
/** Merge drawing-set settings (#209). `resetGeneralNotes` drops the set's own
 *  notes so the cover falls back to Grid Settings' standard notes. */
export async function setDrawingSet(
  projectId: string,
  patch: DrawingSetSettings,
  opts: { resetGeneralNotes?: boolean } = {}
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const next = cleanDrawingSet({ ...(p.drawingSet || {}), ...cleanDrawingSet(patch) });
    if (opts.resetGeneralNotes) delete next.generalNotes;
    p.drawingSet = next;
    p.updatedAt = Date.now();
  });
}
```

- [ ] **Step 5: Create `src/lib/stores/grid-riser.ts`**

```ts
import { patchDoc } from "@/db/doc-store";
import { clamp01, type Point } from "@/lib/annotations";
import { spaceOf } from "@/lib/design/grid-geometry";
import { hasOption } from "@/lib/design/grid-options";
import {
  UNASSIGNED_KEY,
  applyRiserOp,
  isEndRef,
  marginPoints,
  nodeKeyOf,
  normalizeRiserDoc,
  pruneRisers,
  sameEnd,
  spreadInSpace,
  type EndRef,
  type RiserOp,
} from "@/lib/design/grid-riser-doc";
import type { GridPlacement, GridProject } from "./grid-projects";

/**
 * The riser editor's writes (#209, drawing set spec §4). Each function is ONE
 * patchDoc on the Grid project, computed from the doc read inside the patch,
 * so a device add, a qty edit and the riser document can never disagree.
 * Placements written here are ordinary GridPlacements — the plan, BOM,
 * spaces, revisions and quote treat them exactly like painted ones.
 * Callers (design/grid/[id]/riser/actions.ts) authenticate and validate parts.
 */

function rid(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const MAX_NODE_QTY = 200;
export const MAX_LINK_FT = 5000;

type Missing = "not-found" | "no-such-option";
type DropRefusal = "no-such-space" | "no-sheet";
type Drop = { sheetId: string; page: number; points: Point[] };

/** The option's placements the riser shows on `nodeKey` for `partId`, oldest first. */
function nodeDevices(p: GridProject, optionId: string, nodeKey: string, partId: string): GridPlacement[] {
  const spaces = p.spaces || [];
  return (p.placements || [])
    .filter(
      (pl) =>
        pl.optionId === optionId &&
        !pl.curtain &&
        pl.partId === partId &&
        nodeKeyOf(spaceOf(pl, spaces)?.id ?? null) === nodeKey
    )
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

function takenOn(p: GridProject, sheetId: string, page: number): Point[] {
  return (p.placements || []).filter((pl) => pl.sheetId === sheetId && pl.page === page).map((pl) => ({ x: pl.x, y: pl.y }));
}

/** Where new devices for a node land: spread inside the space, or along the
 *  first sheet's lower margin (outside every space) for Unassigned. */
function dropPoints(p: GridProject, nodeKey: string, n: number): Drop | DropRefusal {
  if (nodeKey !== UNASSIGNED_KEY) {
    const space = (p.spaces || []).find((s) => s.id === nodeKey);
    if (!space) return "no-such-space";
    return { sheetId: space.sheetId, page: space.page, points: spreadInSpace(space.points, n, takenOn(p, space.sheetId, space.page)) };
  }
  const sheetId = (p.sheetIds || [])[0];
  if (!sheetId) return "no-sheet";
  const blockers = (p.spaces || []).filter((s) => s.sheetId === sheetId && s.page === 1).map((s) => s.points);
  return { sheetId, page: 1, points: marginPoints(n, blockers, takenOn(p, sheetId, 1)) };
}

function newPlacements(drop: Drop, partId: string, optionId: string, by: string, at: number): GridPlacement[] {
  return drop.points.map((pt) => ({
    id: rid("gp-"),
    sheetId: drop.sheetId,
    page: drop.page,
    x: clamp01(pt.x),
    y: clamp01(pt.y),
    partId,
    optionId,
    by,
    at,
  }));
}

/** Layout / level / conduit / note / link-removal edits. */
export async function patchRiser(
  projectId: string,
  optionId: string,
  op: RiserOp
): Promise<{ ok: true } | { ok: false; reason: Missing | "invalid" }> {
  let refusal: Missing | "invalid" | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, optionId)) {
      refusal = "no-such-option";
      return;
    }
    const res = applyRiserOp(normalizeRiserDoc(p.riser?.[optionId]), op, (prefix) => rid(prefix));
    if (!res.changed) {
      refusal = "invalid";
      return;
    }
    p.riser = { ...(p.riser || {}), [optionId]: res.doc };
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "invalid" | null;
  return r ? { ok: false, reason: r } : { ok: true };
}

/** A typed-length cable run between two riser ends (Connect when the ends
 *  are not two devices on one calibrated page). Priced via routeLines. */
export async function addRiserLink(
  projectId: string,
  input: { optionId: string; from: EndRef; to: EndRef; partId: string; lengthFt: number; by: string }
): Promise<{ ok: true; id: string } | { ok: false; reason: Missing | "bad-end" | "bad-length" }> {
  if (!Number.isFinite(input.lengthFt) || !(input.lengthFt > 0) || input.lengthFt > MAX_LINK_FT) return { ok: false, reason: "bad-length" };
  if (!isEndRef(input.from) || !isEndRef(input.to) || sameEnd(input.from, input.to)) return { ok: false, reason: "bad-end" };
  const id = rid("lk-");
  let refusal: Missing | "bad-end" | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const live = (e: EndRef) =>
      e.kind === "space"
        ? e.spaceId === null || (p.spaces || []).some((s) => s.id === e.spaceId)
        : (p.placements || []).some((pl) => pl.id === e.placementId && pl.optionId === input.optionId);
    if (!live(input.from) || !live(input.to)) {
      refusal = "bad-end";
      return;
    }
    const doc = normalizeRiserDoc(p.riser?.[input.optionId]);
    doc.links = [
      ...doc.links,
      { id, from: input.from, to: input.to, partId: input.partId, lengthFt: Math.round(input.lengthFt * 10) / 10, by: input.by, at: Date.now() },
    ];
    p.riser = { ...(p.riser || {}), [input.optionId]: doc };
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "bad-end" | null;
  return r ? { ok: false, reason: r } : { ok: true, id };
}

/** "+ Device": `qty` new placements of `partId` on the plan, inside the node's space. */
export async function addDevicesToNode(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string; qty: number; by: string }
): Promise<{ ok: true; added: number } | { ok: false; reason: Missing | DropRefusal | "bad-qty" }> {
  const qty = Math.floor(input.qty);
  if (!(qty >= 1 && qty <= MAX_NODE_QTY)) return { ok: false, reason: "bad-qty" };
  let refusal: Missing | DropRefusal | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const drop = dropPoints(p, input.nodeKey, qty);
    if (typeof drop === "string") {
      refusal = drop;
      return;
    }
    const at = Date.now();
    p.placements = [...(p.placements || []), ...newPlacements(drop, input.partId, input.optionId, input.by, at)];
    p.updatedAt = at;
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | DropRefusal | null;
  return r ? { ok: false, reason: r } : { ok: true, added: qty };
}

/** Edit a device row's qty: add placements inside the space, or remove the
 *  newest ones (their riser links/conduits go with them). */
export async function setNodeDeviceQty(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string; qty: number; by: string }
): Promise<{ ok: true; added: number; removed: number } | { ok: false; reason: Missing | DropRefusal | "bad-qty" | "no-devices" }> {
  const qty = Math.floor(input.qty);
  if (!(qty >= 1 && qty <= MAX_NODE_QTY)) return { ok: false, reason: "bad-qty" };
  let refusal: Missing | DropRefusal | "no-devices" | null = null;
  let added = 0;
  let removed = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const cur = nodeDevices(p, input.optionId, input.nodeKey, input.partId);
    if (!cur.length) {
      refusal = "no-devices";
      return;
    }
    if (qty > cur.length) {
      const drop = dropPoints(p, input.nodeKey, qty - cur.length);
      if (typeof drop === "string") {
        refusal = drop;
        return;
      }
      p.placements = [...(p.placements || []), ...newPlacements(drop, input.partId, input.optionId, input.by, Date.now())];
      added = qty - cur.length;
    } else if (qty < cur.length) {
      const gone = new Set(cur.slice(qty).map((pl) => pl.id));
      p.placements = (p.placements || []).filter((pl) => !gone.has(pl.id));
      if (p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
      removed = gone.size;
    }
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | DropRefusal | "no-devices" | null;
  return r ? { ok: false, reason: r } : { ok: true, added, removed };
}

/** Swap the catalog part on every placement of a device row. */
export async function replaceNodeDevicePart(
  projectId: string,
  input: { optionId: string; nodeKey: string; fromPartId: string; toPartId: string }
): Promise<{ ok: true; changed: number } | { ok: false; reason: Missing | "no-devices" }> {
  let refusal: Missing | "no-devices" | null = null;
  let changed = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const ids = new Set(nodeDevices(p, input.optionId, input.nodeKey, input.fromPartId).map((pl) => pl.id));
    if (!ids.size) {
      refusal = "no-devices";
      return;
    }
    p.placements = (p.placements || []).map((pl) => (ids.has(pl.id) ? { ...pl, partId: input.toPartId } : pl));
    changed = ids.size;
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "no-devices" | null;
  return r ? { ok: false, reason: r } : { ok: true, changed };
}

/** Delete a device row: every placement of it in that node, with their riser ends. */
export async function removeNodeDevices(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string }
): Promise<{ ok: true; removed: number } | { ok: false; reason: Missing | "no-devices" }> {
  let refusal: Missing | "no-devices" | null = null;
  let removed = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const gone = new Set(nodeDevices(p, input.optionId, input.nodeKey, input.partId).map((pl) => pl.id));
    if (!gone.size) {
      refusal = "no-devices";
      return;
    }
    p.placements = (p.placements || []).filter((pl) => !gone.has(pl.id));
    if (p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
    removed = gone.size;
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "no-devices" | null;
  return r ? { ok: false, reason: r } : { ok: true, removed };
}
```

- [ ] **Step 6: Move `partForGrid`** — create `src/lib/design/grid-part-lookup.ts`:

```ts
import { get as getPart } from "@/lib/stores/catalog";
import { getGridSymbol } from "@/lib/stores/grid-catalog";

/**
 * A part id as the Grid stores it: a pricing-catalog row first, else a
 * Grid-library entry (unit "ea", sku = model number). Server-only. Moved
 * verbatim out of design/grid/[id]/actions.ts (#209) so the riser actions
 * validate parts through the same lookup.
 */
export async function partForGrid(id: string) {
  const priced = await getPart(id);
  if (priced) return priced;
  const symbol = await getGridSymbol(id);
  return symbol ? { ...symbol, sku: symbol.modelNumber || symbol.id, unit: "ea" } : null;
}
```

In `src/app/(app)/design/grid/[id]/actions.ts`: replace

```ts
import { createGridAssembly, getGridSymbol, removeGridAssembly, setGridSymbolLook } from "@/lib/stores/grid-catalog";
```

with

```ts
import { createGridAssembly, removeGridAssembly, setGridSymbolLook } from "@/lib/stores/grid-catalog";
import { partForGrid } from "@/lib/design/grid-part-lookup";
```

and delete the local function (keep the `get as getPart` import — `placeCurtainAction` still uses it):

```ts
async function partForGrid(id: string) {
  const priced = await getPart(id);
  if (priced) return priced;
  const symbol = await getGridSymbol(id);
  return symbol ? { ...symbol, sku: symbol.modelNumber || symbol.id, unit: "ea" } : null;
}
```

- [ ] **Step 7: Create `src/app/(app)/design/grid/[id]/riser/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { isPerLengthUnit } from "@/lib/design/grid-bom";
import { partForGrid } from "@/lib/design/grid-part-lookup";
import { RISER_OP_NAMES, isEndRef, type EndRef, type RiserOp } from "@/lib/design/grid-riser-doc";
import {
  addDevicesToNode,
  addRiserLink,
  patchRiser,
  removeNodeDevices,
  replaceNodeDevicePart,
  setNodeDeviceQty,
} from "@/lib/stores/grid-riser";

/**
 * Riser editor actions (#209). Same gate as every Grid edit (requireUser);
 * parts are validated here, geometry and the document live in the store.
 */

type Result = { ok: true } | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  "not-found": "Design not found.",
  "no-such-option": "That option was removed — refresh the page.",
  invalid: "That edit isn't valid — check the label and try again.",
  "no-such-space": "That space was removed — refresh the page.",
  "no-sheet": "Upload or generate a plan sheet first — devices need a plan to land on.",
  "bad-qty": "Quantity must be a whole number from 1 to 200.",
  "no-devices": "Those devices are no longer in this space — refresh the page.",
  "bad-end": "One end of that connection is no longer on the design — refresh the page.",
  "bad-length": "Type the cable length in feet (up to 5,000).",
};

function fail(reason: string): { ok: false; error: string } {
  return { ok: false, error: MESSAGES[reason] || "That change couldn't be saved." };
}

function revalidateGrid(projectId: string) {
  const base = `/design/grid/${encodeURIComponent(projectId)}`;
  revalidatePath(base);
  revalidatePath(`${base}/riser`);
  revalidatePath(`${base}/set`);
  revalidatePath(`${base}/schedule`);
}

async function devicePart(partId: string): Promise<string | null> {
  const part = await partForGrid(partId);
  if (!part) return "Pick a device from the Grid library.";
  if (isPerLengthUnit(part.unit)) return `${part.sku} is a per-length cable — use Connect for cable.`;
  return null;
}

/** Node layout, level lines, conduits, notes, link removal. */
export async function patchRiserAction(projectId: string, optionId: string, op: RiserOp): Promise<Result> {
  await requireUser();
  if (!op || !(RISER_OP_NAMES as readonly string[]).includes(op.op)) return { ok: false, error: "Unknown riser edit." };
  const r = await patchRiser(projectId, optionId, op);
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

/** Connect → a typed-length RiserLink (the client routes same-page device
 *  pairs through addRouteAction instead). */
export async function addRiserLinkAction(
  projectId: string,
  input: { optionId: string; from: EndRef; to: EndRef; partId: string; lengthFt: number }
): Promise<Result> {
  const user = await requireUser();
  if (!isEndRef(input.from) || !isEndRef(input.to)) return fail("bad-end");
  const part = await partForGrid(input.partId);
  if (!part) return { ok: false, error: "Pick a cable from the Grid library." };
  if (!isPerLengthUnit(part.unit))
    return { ok: false, error: `${part.sku} is priced per ${part.unit}, not per length — connections need a per-foot cable.` };
  const r = await addRiserLink(projectId, { ...input, lengthFt: Number(input.lengthFt), by: user.name });
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

export async function riserAddDevicesAction(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string; qty: number }
): Promise<Result> {
  const user = await requireUser();
  const bad = await devicePart(input.partId);
  if (bad) return { ok: false, error: bad };
  const r = await addDevicesToNode(projectId, { ...input, qty: Number(input.qty), by: user.name });
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

export async function riserSetQtyAction(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string; qty: number }
): Promise<Result> {
  const user = await requireUser();
  const r = await setNodeDeviceQty(projectId, { ...input, qty: Number(input.qty), by: user.name });
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

export async function riserReplacePartAction(
  projectId: string,
  input: { optionId: string; nodeKey: string; fromPartId: string; toPartId: string }
): Promise<Result> {
  await requireUser();
  const bad = await devicePart(input.toPartId);
  if (bad) return { ok: false, error: bad };
  const r = await replaceNodeDevicePart(projectId, input);
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

export async function riserRemoveDevicesAction(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string }
): Promise<Result> {
  await requireUser();
  const r = await removeNodeDevices(projectId, input);
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}
```

Note: `requireUser()` appears exactly six times as `await requireUser()` — five as `const user = await requireUser()` / `await requireUser()`; the Step 2 check counts the substring `await requireUser()`, which all six calls contain.

- [ ] **Step 8: Create `src/app/(app)/design/grid/[id]/set/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setDrawingSet } from "@/lib/stores/grid-projects";
import type { DrawingSetSettings } from "@/lib/design/grid-drawing-set";

/** Save the drawing set's settings on the project (#209). Same gate as any
 *  Grid edit; the store cleans every field. */
export async function saveDrawingSetAction(
  projectId: string,
  patch: DrawingSetSettings,
  opts: { resetGeneralNotes?: boolean } = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const p = await setDrawingSet(projectId, patch, { resetGeneralNotes: Boolean(opts.resetGeneralNotes) });
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(`/design/grid/${encodeURIComponent(projectId)}/set`);
  return { ok: true };
}
```

- [ ] **Step 9: Standard general notes setting**

In `src/lib/settings.ts`, immediately after the line `  gridSymbolColors?: Record<string, string> | null;` add:

```ts
  /** Drawing set (#209) — the "Standard general notes" printed on every
   *  set's cover (T-001) unless that set has its own. One note per line;
   *  null/absent = none. Edited in Design → Grid Settings. */
  gridStandardNotes?: string | null;
```

In `src/app/(app)/design/grid/settings/actions.ts`, replace

```ts
import { cleanCategoryIcons, cleanSymbolColors } from "@/lib/design/grid-icons";
```

with

```ts
import { cleanCategoryIcons, cleanSymbolColors } from "@/lib/design/grid-icons";
import { cleanStandardNotes } from "@/lib/design/grid-drawing-set";
```

and append at the end of the file:

```ts
/** Standard general notes for drawing-set covers (#209). Blank clears the
 *  key (null) so covers print no default notes. */
export async function saveStandardNotesAction(text: string) {
  await requirePerm("manage_users");
  await setSettings({ gridStandardNotes: cleanStandardNotes(text) });
  revalidatePath("/design/grid/settings");
  revalidatePath("/", "layout");
  return { ok: true as const };
}
```

- [ ] **Step 10: RiserLinks into the quote** — in `src/lib/design/grid-quote.ts` replace

```ts
import { ensureOptions, hasOption, optionSlice } from "@/lib/design/grid-options";
```

with

```ts
import { ensureOptions, hasOption, optionSlice } from "@/lib/design/grid-options";
import { riserLinksOf } from "@/lib/design/grid-riser-doc";
```

replace

```ts
  const { placements, routes } = optionSlice(project, optionId);
  if (!placements.length && !routes.length)
    return { ok: false, error: "Place a device or route a wire first." };
```

with

```ts
  const { placements, routes } = optionSlice(project, optionId);
  // Typed-length riser connections (#209) price exactly like wire routes.
  const riserLinks = riserLinksOf(project.riser, optionId);
  if (!placements.length && !routes.length && !riserLinks.length)
    return { ok: false, error: "Place a device or route a wire first." };
```

and replace

```ts
  const wires = routeLines(routes, tierCatalog, project.calibrations || []);
```

with

```ts
  const wires = routeLines(routes, tierCatalog, project.calibrations || [], riserLinks);
```

- [ ] **Step 11: RiserLinks into the editor's live BOM**

In `src/app/(app)/design/grid/[id]/editor.tsx`: replace

```ts
import { optionSlice } from "@/lib/design/grid-options";
```

with

```ts
import { optionSlice } from "@/lib/design/grid-options";
import { riserLinksOf, type RiserDoc } from "@/lib/design/grid-riser-doc";
```

replace (in `ProjectLite`)

```ts
  scopeInputs: QuickScopeInputs | null;
  linesetDesignId: string | null;
};
```

with

```ts
  scopeInputs: QuickScopeInputs | null;
  linesetDesignId: string | null;
  /** Riser documents per option (#209) — the sidebar BOM counts RiserLinks. */
  riser: Record<string, RiserDoc>;
};
```

and replace

```ts
  const wires = useMemo(
    () => routeLines(routes || [], parts, project.calibrations),
    [routes, parts, project.calibrations]
  );
```

with

```ts
  const riserLinks = useMemo(() => riserLinksOf(project.riser, activeOptionId), [project.riser, activeOptionId]);
  const wires = useMemo(
    () => routeLines(routes || [], parts, project.calibrations, riserLinks),
    [routes, parts, project.calibrations, riserLinks]
  );
```

In `src/app/(app)/design/grid/[id]/page.tsx` replace

```ts
        linesetDesignId: project.linesetDesignId || null,
```

with

```ts
        linesetDesignId: project.linesetDesignId || null,
        riser: project.riser || {},
```

- [ ] **Step 12: Run both harnesses to verify they pass**

Run: `D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH=$D npx tsx scripts/test-review-regressions.ts 2>&1 | tail -2`
Expected: `review regression checks passed`.
Run: `npm run test:specs 2>&1 | grep -E "#209|FAIL|ALL PASSED|FAILED"`
Expected: every `#209` line `PASS`, `ALL PASSED`.

- [ ] **Step 13: Gates**

Run: `npx tsc --noEmit && npx eslint 2>&1 | tail -1`
Expected: tsc silent; `✖ 111 problems (0 errors, 111 warnings)`.
Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5; echo "exit $?"; rm -rf .next`
Expected: build completes (exit 0). The editor (client) now imports `grid-riser-doc` — it must stay pure.

- [ ] **Step 14: Commit**

```bash
git add src/lib/stores/grid-projects.ts src/lib/stores/grid-riser.ts src/lib/design/grid-part-lookup.ts \
  "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/riser/actions.ts" \
  "src/app/(app)/design/grid/[id]/set/actions.ts" src/lib/settings.ts "src/app/(app)/design/grid/settings/actions.ts" \
  src/lib/design/grid-quote.ts "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/page.tsx" \
  scripts/test-review-regressions.ts scripts/test-review-and-spec.ts
git -c user.name="SM" commit -m "feat(grid): persist riser document + drawing-set settings; riser actions; RiserLinks priced on the quote (#209)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Riser editor I — shared parts builder, riser view, canvas, drag layout, + Device, edit/delete rows, Space

**Files:**
- Create: `src/lib/design/grid-parts.ts`
- Create: `src/lib/design/grid-riser-view.ts`
- Create: `src/components/drawing/riser-canvas.tsx`
- Create: `src/app/(app)/design/grid/[id]/riser/riser-panels.tsx`
- Create: `src/app/(app)/design/grid/[id]/riser/riser-editor.tsx`
- Rewrite: `src/app/(app)/design/grid/[id]/riser/page.tsx`
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (use `gridPartsFrom`)
- Test: `scripts/test-review-and-spec.ts` (append block at EOF; re-point one #206 check)

**Interfaces:**
- Consumes: Task 3 (`buildRiserView`, `marginSpaceRect`, `RISER_W`, `RISER_H`, `NODE_HEAD`, `NODE_ROW`, view types), Task 4 actions (`patchRiserAction`, `riserAddDevicesAction`, `riserSetQtyAction`, `riserReplacePartAction`, `riserRemoveDevicesAction`), existing `addSpaceAction(projectId, { sheetId, page, name, points })`, `riserGraph`, `symbolLook`, `gridSymbolEntry`, `legendRows`, `optionSlice`.
- Produces:
  - `gridPartsFrom(symbols: GridSymbol[], catalog: CatalogPart[], categoryMap: CategoryMap, opts?: { catalogFallback?: boolean }): PartLite[]` — the exact builder `page.tsx` used; `catalogFallback` appends catalog rows that are not Grid-library entries (what the old riser page did, for pre-library placements).
  - `type RiserProjectLite`, `riserViewForOption({ project, optionId, parts, symCtx }): RiserView`.
  - `RiserCanvas({ view, boxes?, levelYs?, svgRef?, handlers?, selected?, fill? })`, `RiserNotes({ notes })`, `type RiserCanvasHandlers = { onNodeDown?, onRowClick?, onEdgeClick?, onConduitClick?, onLevelDown?, onBackgroundDown?, onMove?, onUp? }`, `type RiserSelection`.
  - `riser-panels.tsx`: `type RiserPartOption = { id; label }`, `PANEL`, `INPUT`, `FIELD` styles, `PartPicker`, `DevicePanel`, `RowPanel`, `SpacePanel`.
  - `riser-editor.tsx` default export `RiserEditor({ projectId, optionId, view, devices, sheets, spaces })`, `type RiserSheetLite = { id; name; mime; src }`.

- [ ] **Step 1: Write the failing test** — append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #209 grid drawing set — Task 5: parts builder, riser view, riser canvas --- */
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { riserViewForOption, type RiserProjectLite } from "@/lib/design/grid-riser-view";
import { RiserCanvas, RiserNotes } from "@/components/drawing/riser-canvas";

{
  const gpSym = { id: "GS-1", name: "Wash light", manufacturer: "ETC", modelNumber: "W1", scope: "Lighting", category: "Fixtures", width: 48, height: 34, ports: [], pricingPartId: "CAT-1", createdBy: "t", createdAt: 1, updatedAt: 1 };
  const gpCat = [
    { id: "CAT-1", sku: "W1", desc: "Wash", category: "Fixtures", unit: "ea", list: 900, cost: 500 },
    { id: "CAT-2", sku: "C2", desc: "Cable", category: "Wire", unit: "ft", list: 2, cost: 1 },
  ];
  const gpLib = gridPartsFrom([gpSym] as never, gpCat as never, {});
  ok(gpLib.length === 1 && gpLib[0].id === "GS-1" && gpLib[0].list === 900 && gpLib[0].desc === "Wash light" && gpLib[0].symbolWidth === 48, "#209 parts: a Grid-library entry prices from its linked catalog row");
  const gpAll = gridPartsFrom([gpSym] as never, gpCat as never, {}, { catalogFallback: true });
  ok(gpAll.map((p) => p.id).join() === "GS-1,CAT-1,CAT-2", "#209 parts: the catalog fallback resolves pre-library placements");

  const gpProj: RiserProjectLite = {
    placements: [{ id: "v1", sheetId: "s1", page: 1, x: 0.3, y: 0.3, partId: "GS-1", optionId: "opt-base", by: "t", at: 1 }],
    routes: [],
    spaces: [{ id: "sp-v", sheetId: "s1", page: 1, name: "Stage", color: "#8a6d3b", points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.4 }, { x: 0.2, y: 0.4 }], by: "t", at: 1 }],
    calibrations: [],
    options: [{ id: "opt-base", name: "Design", quoteId: null, createdAt: 1 }],
    riser: {
      "opt-base": {
        nodes: {},
        levels: [{ id: "lv-1", label: "Level 1", elevation: "EL 100", y: 0.9 }],
        conduits: [{ id: "cd-1", from: { kind: "space", spaceId: "sp-v" }, to: { kind: "space", spaceId: null }, label: "EMT by EC" }],
        notes: [{ id: "nt-1", n: 1, text: "Verify in field" }],
        links: [{ id: "lk-1", from: { kind: "placement", placementId: "v1" }, to: { kind: "space", spaceId: null }, partId: "CAT-2", lengthFt: 40, by: "t", at: 1 }],
      },
    },
  };
  const gpView = riserViewForOption({ project: gpProj, optionId: "opt-base", parts: gpAll, symCtx: symbolContext(null) });
  ok(gpView.nodes.map((n) => n.key).join() === "sp-v,unassigned" && gpView.nodes[0].groups[0].qty === 1 && gpView.nodes[0].groups[0].ids.join() === "v1", "#209 riser view: spaces + Unassigned (linked), groups carry their placement ids");
  ok(gpView.edges.length === 1 && gpView.edges[0].kind === "link" && gpView.edges[0].from.partId === "GS-1" && gpView.edges[0].desc === "Cable", "#209 riser view: RiserLinks become edges anchored on the device row");
  const gpHtml = symRender(symH(RiserCanvas, { view: gpView }));
  ok(gpHtml.includes("Stage") && gpHtml.includes("1× Wash light") && gpHtml.includes("Unassigned"), "#209 canvas: nodes and device rows");
  ok(gpHtml.includes("Level 1 · EL 100") && gpHtml.includes("EMT by EC") && gpHtml.includes('data-edge="link"') && gpHtml.includes("(typed)"), "#209 canvas: level line, conduit annotation, typed-length link");
  ok(!gpHtml.includes("cursor"), "#209 canvas: the print render has no interactive affordances");
  const gpNotes = symRender(symH(RiserNotes, { notes: gpView.notes }));
  ok(gpNotes.includes("<ol") && gpNotes.includes("Verify in field"), "#209 canvas: numbered riser notes");
}
```

Also re-point the existing #206 check (it asserted the builder text lives in both pages; after this task it lives in `grid-parts.ts`). In `scripts/test-review-and-spec.ts` replace:

```ts
  const gridPlanPageSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/page.tsx"), "utf8");
  const gridRiserPageSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/riser/page.tsx"), "utf8");
  ok(gridPlanPageSrc.includes("gridSymbolEntry(s, p, categoryMap)") && gridRiserPageSrc.includes("gridSymbolEntry(s, p, categoryMap)"),
    "#206 final fix wave: the plan and the riser both build a Grid-symbol's SymbolEntry fields through gridSymbolEntry");
```

with:

```ts
  const gridPlanPageSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/page.tsx"), "utf8");
  const gridRiserPageSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/riser/page.tsx"), "utf8");
  const gridPartsSrc = readFileSync(join(process.cwd(), "src/lib/design/grid-parts.ts"), "utf8");
  ok(gridPartsSrc.includes("gridSymbolEntry(s, p, categoryMap)") && gridPlanPageSrc.includes("gridPartsFrom(") && gridRiserPageSrc.includes("gridPartsFrom("),
    "#206 final fix wave (moved by #209): the plan and the riser both build a Grid-symbol's SymbolEntry fields through gridSymbolEntry, via the shared gridPartsFrom");
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | tail -3`
Expected: aborts with `Cannot find module '@/lib/design/grid-parts'`.

- [ ] **Step 3: Create `src/lib/design/grid-parts.ts`**

```ts
import type { CategoryMap } from "@/lib/catalog-taxonomy";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import type { PartLite } from "./grid-bom";
import { gridSymbolEntry } from "./grid-icons";

/**
 * The ONE Grid-library → PartLite builder (#209): the plan editor, the riser,
 * the drawing set and the schedule all price, name and badge a device the
 * same way. Pure (type-only store imports); callers load the rows.
 *
 * `catalogFallback` appends pricing-catalog rows that are not Grid-library
 * entries, so a placement made before the library existed still resolves a
 * description (what the old riser page did inline).
 */
export function gridPartsFrom(
  symbols: GridSymbol[],
  catalog: CatalogPart[],
  categoryMap: CategoryMap,
  opts: { catalogFallback?: boolean } = {}
): PartLite[] {
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
  const parts: PartLite[] = symbols.map((s) => {
    const p = s.pricingPartId ? pricingById.get(s.pricingPartId) : undefined;
    // Prefer the LIVE catalog part's ports over the grid_catalog symbol's
    // seed-time snapshot (`s.ports`): grid-catalog.ts only ever copies
    // `ports` from the pricing catalog once, at first seed, and never
    // refreshes it. Fall back to the symbol's snapshot only when there's no
    // linked pricing part with its own ports.
    const ports = p?.ports?.length ? p.ports : s.ports;
    return {
      id: s.id,
      sku: s.modelNumber || s.id,
      desc: s.name,
      unit: p?.unit || "ea",
      list: p?.list || 0,
      cost: p?.cost || 0,
      ...(ports.length > 0 ? { ports } : {}),
      ...(p?.datasheetBlobKey ? { hasDatasheet: true } : {}),
      // Category, icon/colour/shape overrides, Grid scope and the pricing
      // part's group/trade (final fix wave #3).
      ...gridSymbolEntry(s, p, categoryMap),
      manufacturer: s.manufacturer,
      modelNumber: s.modelNumber,
      symbolWidth: s.width,
      symbolHeight: s.height,
      kind: s.kind || "device",
      assemblyMembers: s.members,
      pricingPartId: s.pricingPartId,
    };
  });
  if (!opts.catalogFallback) return parts;
  const seen = new Set(parts.map((p) => p.id));
  for (const p of catalog) {
    if (seen.has(p.id)) continue;
    parts.push({ id: p.id, sku: p.sku, desc: p.desc, category: p.category, unit: p.unit, list: p.list, cost: p.cost });
  }
  return parts;
}
```

In `src/app/(app)/design/grid/[id]/page.tsx`: replace

```ts
import { gridSymbolEntry, symbolContext } from "@/lib/design/grid-icons";
```

with

```ts
import { symbolContext } from "@/lib/design/grid-icons";
import { gridPartsFrom } from "@/lib/design/grid-parts";
```

and replace the whole block that starts at `  /** Client payload: sheets without re-serialization surprises + PartLite slice. */` and ends at the `  });` closing `gridSymbols.map((s) => { … })` (currently lines 102–136: the `pricingById` line, the `const parts: PartLite[] = gridSymbols.map((s) => {` body with its ports comment, `return { id: s.id, … pricingPartId: s.pricingPartId, };` and `});`) with:

```ts
  /** Client payload: sheets without re-serialization surprises + PartLite slice
   *  (the one builder the riser, drawing set and schedule use too — #209). */
  const parts: PartLite[] = gridPartsFrom(gridSymbols, catalog, categoryMap);
```

- [ ] **Step 4: Create `src/lib/design/grid-riser-view.ts`**

```ts
import type { Calibration } from "@/lib/annotations";
import type { GridPlacement, GridRoute, GridSpace } from "@/lib/stores/grid-projects";
import type { PartLite } from "./grid-bom";
import { symbolLook, type SymbolContext, type SymbolEntry } from "./grid-icons";
import { optionSlice, type GridOption } from "./grid-options";
import { riserGraph, type RiserGroup } from "./grid-riser";
import { buildRiserView, type RiserDoc, type RiserView } from "./grid-riser-doc";

/**
 * One option's riser, ready to draw (#209): the derived graph (riserGraph,
 * D112) + the saved riser document + each device row's stock-symbol look
 * (the same symbolLook the plan uses). Shared by the riser editor page, the
 * drawing set's E-501 and the schedule's wire runs. Pure.
 */
export type RiserProjectLite = {
  placements?: GridPlacement[];
  routes?: GridRoute[];
  spaces?: GridSpace[];
  calibrations?: Calibration[];
  options?: GridOption[];
  quoteId?: string | null;
  createdAt?: number;
  riser?: Record<string, RiserDoc>;
};

export function riserViewForOption(input: {
  project: RiserProjectLite;
  optionId: string;
  parts: PartLite[];
  symCtx: SymbolContext;
}): RiserView {
  const { project, optionId, parts, symCtx } = input;
  const slice = optionSlice(project, optionId);
  const spaces = project.spaces || [];
  const graph = riserGraph(slice.placements, slice.routes, spaces, parts, project.calibrations || []);
  const partById = new Map(parts.map((p) => [p.id, p]));
  const entryOf = (g: RiserGroup): SymbolEntry => partById.get(g.partId) || { category: g.category, shape: g.shape };
  return buildRiserView({
    graph,
    spaces,
    placements: slice.placements,
    routes: slice.routes,
    doc: project.riser?.[optionId],
    look: (g) => {
      const l = symbolLook(entryOf(g), symCtx);
      return { iconId: l.iconId, color: l.color };
    },
    partDesc: (id) => partById.get(id)?.desc || id,
  });
}
```

- [ ] **Step 5: Create `src/components/drawing/riser-canvas.tsx`**

```tsx
import type { PointerEvent as ReactPointerEvent, Ref } from "react";
import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import { SymbolShape } from "@/components/design/symbol-shape";
import {
  NODE_HEAD,
  NODE_ROW,
  RISER_H,
  RISER_W,
  type EndAnchor,
  type RiserNodeBox,
  type RiserNote,
  type RiserView,
  type RiserViewNode,
} from "@/lib/design/grid-riser-doc";

/**
 * The riser, drawn (#209). One pure SVG renderer for the riser editor
 * (client, with handlers) and the drawing set's E-501 (server, no handlers):
 * nodes with device rows, wire routes (solid), RiserLinks (dash-dot, marked
 * "typed"), conduits (grey dashed annotation, never priced) and level lines.
 * No "use client" — without handlers nothing on it is interactive.
 */

export type RiserCanvasHandlers = {
  onNodeDown?: (key: string, e: ReactPointerEvent<SVGGElement>) => void;
  onRowClick?: (key: string, partId: string) => void;
  onEdgeClick?: (id: string, kind: "route" | "link") => void;
  onConduitClick?: (id: string) => void;
  onLevelDown?: (id: string, e: ReactPointerEvent<SVGGElement>) => void;
  onBackgroundDown?: (e: ReactPointerEvent<SVGRectElement>) => void;
  onMove?: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onUp?: (e: ReactPointerEvent<SVGSVGElement>) => void;
};

export type RiserSelection = {
  nodeKey?: string;
  row?: { key: string; partId: string };
  edgeId?: string;
  conduitId?: string;
  levelId?: string;
} | null;

type Pt = { x: number; y: number };
type Anchor = { p: Pt; row: boolean };

const r1 = (v: number) => Math.round(v * 10) / 10;
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);
const pxBox = (b: RiserNodeBox) => ({ x: b.x * RISER_W, y: b.y * RISER_H, w: b.w * RISER_W, h: b.h * RISER_H });
const rowCenterY = (top: number, i: number) => top + NODE_HEAD + 6 + i * NODE_ROW + NODE_ROW / 2;

/** A device end sits on its row's left/right edge (whichever faces the other
 *  end); a space end sits on the node's bottom centre. */
function anchorAt(a: EndAnchor, node: RiserViewNode, box: RiserNodeBox, towardX: number): Anchor {
  const b = pxBox(box);
  if (a.partId) {
    const i = node.groups.findIndex((g) => g.partId === a.partId);
    if (i >= 0) return { p: { x: towardX >= b.x + b.w / 2 ? b.x + b.w : b.x, y: rowCenterY(b.y, i) }, row: true };
  }
  return { p: { x: b.x + b.w / 2, y: b.y + b.h }, row: false };
}

function curve(a: Anchor, b: Anchor): { d: string; mid: Pt } {
  const A = a.p;
  const B = b.p;
  const span = Math.max(40, Math.abs(B.x - A.x) / 2);
  const sameSide = Math.abs(A.x - B.x) < 1;
  let c1: Pt = a.row ? { x: A.x + (sameSide || B.x >= A.x ? span : -span), y: A.y } : { x: A.x, y: A.y + 50 };
  let c2: Pt = b.row ? { x: B.x + (sameSide || A.x > B.x ? span : -span), y: B.y } : { x: B.x, y: B.y + 50 };
  if (sameSide && Math.abs(A.y - B.y) < 1) {
    c1 = { x: A.x + 40, y: A.y - 24 };
    c2 = { x: A.x + 40, y: A.y + 24 };
  }
  const mid = {
    x: 0.125 * A.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * B.x,
    y: 0.125 * A.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * B.y,
  };
  return { d: `M ${r1(A.x)} ${r1(A.y)} C ${r1(c1.x)} ${r1(c1.y)}, ${r1(c2.x)} ${r1(c2.y)}, ${r1(B.x)} ${r1(B.y)}`, mid };
}

function Chip({ x, y, label, color, italic = false }: { x: number; y: number; label: string; color: string; italic?: boolean }) {
  const w = label.length * 5.6 + 12;
  return (
    <g>
      <rect x={r1(x - w / 2)} y={r1(y - 8)} width={r1(w)} height={16} rx={4} fill="#fff" stroke="#c4c9d2" strokeWidth={0.8} />
      <text x={r1(x)} y={r1(y + 3.5)} fontSize={10} fontWeight={600} fill={color} textAnchor="middle" fontStyle={italic ? "italic" : undefined}>
        {label}
      </text>
    </g>
  );
}

export function RiserCanvas({
  view,
  boxes,
  levelYs,
  svgRef,
  handlers,
  selected = null,
  fill = false,
}: {
  view: RiserView;
  /** Live (dragging) node boxes that override the view's. */
  boxes?: Record<string, RiserNodeBox>;
  /** Live (dragging) level positions. */
  levelYs?: Record<string, number>;
  svgRef?: Ref<SVGSVGElement>;
  handlers?: RiserCanvasHandlers;
  selected?: RiserSelection;
  /** Fill the parent's height too (the E-501 drawing area). */
  fill?: boolean;
}) {
  const h: RiserCanvasHandlers = handlers || {};
  const interactive = Boolean(handlers);
  const pointer = interactive ? { cursor: "pointer" } : undefined;
  const nodeMap = new Map(view.nodes.map((n) => [n.key, n]));
  const boxOf = (n: RiserViewNode) => boxes?.[n.key] || n.box;
  const levelY = (id: string, y: number) => (levelYs?.[id] ?? y) * RISER_H;
  const bottom = Math.max(
    view.height - 24,
    ...view.nodes.map((n) => {
      const b = boxOf(n);
      return (b.y + b.h) * RISER_H;
    }),
    ...view.levels.map((l) => levelY(l.id, l.y))
  );
  const H = Math.max(RISER_H, Math.ceil(bottom + 24));
  const connect = (from: EndAnchor, to: EndAnchor) => {
    const nf = nodeMap.get(from.key);
    const nt = nodeMap.get(to.key);
    if (!nf || !nt) return null;
    const bf = pxBox(boxOf(nf));
    const bt = pxBox(boxOf(nt));
    return curve(anchorAt(from, nf, boxOf(nf), bt.x + bt.w / 2), anchorAt(to, nt, boxOf(nt), bf.x + bf.w / 2));
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${RISER_W} ${H}`}
      width="100%"
      height={fill ? "100%" : undefined}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", touchAction: interactive ? "none" : undefined, userSelect: "none", fontFamily: "inherit" }}
      onPointerMove={h.onMove}
      onPointerUp={h.onUp}
      data-riser-canvas=""
    >
      <rect x={0} y={0} width={RISER_W} height={H} fill="#fff" onPointerDown={h.onBackgroundDown} />

      {view.levels.map((l) => {
        const y = levelY(l.id, l.y);
        const on = selected?.levelId === l.id;
        return (
          <g
            key={l.id}
            data-level={l.id}
            onPointerDown={h.onLevelDown ? (e) => h.onLevelDown?.(l.id, e) : undefined}
            style={interactive ? { cursor: "ns-resize" } : undefined}
          >
            {interactive && <rect x={0} y={r1(y - 7)} width={RISER_W} height={14} fill="transparent" />}
            <line x1={0} x2={RISER_W} y1={r1(y)} y2={r1(y)} stroke={on ? "#16181d" : "#5b616e"} strokeWidth={on ? 1.8 : 1.2} strokeDasharray="14 6" />
            <text x={6} y={r1(y - 5)} fontSize={10.5} fontWeight={700} fill="#5b616e">
              {`${l.label}${l.elevation ? ` · ${l.elevation}` : ""}`}
            </text>
          </g>
        );
      })}

      {view.nodes.map((n) => {
        const b = pxBox(boxOf(n));
        const on = selected?.nodeKey === n.key;
        const maxChars = Math.max(6, Math.floor((b.w - 34) / 6));
        return (
          <g key={n.key} data-node={n.key}>
            <rect x={r1(b.x)} y={r1(b.y)} width={r1(b.w)} height={r1(b.h)} rx={8} fill="#fff" stroke={n.color} strokeWidth={on ? 2.6 : 1.5} />
            <g onPointerDown={h.onNodeDown ? (e) => h.onNodeDown?.(n.key, e) : undefined} style={interactive ? { cursor: "grab" } : undefined}>
              <rect x={r1(b.x)} y={r1(b.y)} width={r1(b.w)} height={NODE_HEAD} rx={8} fill={n.color} opacity={0.16} />
              <text x={r1(b.x + 10)} y={r1(b.y + 16)} fontSize={12} fontWeight={700} fill="#16181d">
                {fit(n.name, maxChars + 4)}
              </text>
            </g>
            {n.groups.length === 0 ? (
              <text x={r1(b.x + 12)} y={r1(rowCenterY(b.y, 0) + 4)} fontSize={10.5} fill="#9aa0ab">
                no devices
              </text>
            ) : (
              n.groups.map((g, i) => {
                const cy = rowCenterY(b.y, i);
                const rowOn = selected?.row?.key === n.key && selected.row.partId === g.partId;
                return (
                  <g key={g.partId} data-row={g.partId} onClick={h.onRowClick ? () => h.onRowClick?.(n.key, g.partId) : undefined} style={pointer}>
                    <rect x={r1(b.x + 4)} y={r1(cy - NODE_ROW / 2)} width={r1(b.w - 8)} height={NODE_ROW} rx={3} fill={rowOn ? "#eef3ff" : "transparent"} />
                    <SymbolShape iconId={g.iconId} x={r1(b.x + 16)} y={r1(cy)} w={12} h={12} color={g.color} />
                    <text x={r1(b.x + 28)} y={r1(cy + 4)} fontSize={11} fill="#3d424e">
                      {fit(`${g.qty}× ${g.desc}`, maxChars)}
                    </text>
                  </g>
                );
              })
            )}
          </g>
        );
      })}

      {view.conduits.map((c) => {
        const k = connect(c.from, c.to);
        if (!k) return null;
        const on = selected?.conduitId === c.id;
        return (
          <g key={c.id} data-conduit={c.id} onClick={h.onConduitClick ? () => h.onConduitClick?.(c.id) : undefined} style={pointer}>
            {interactive && <path d={k.d} fill="none" stroke="transparent" strokeWidth={12} />}
            <path d={k.d} fill="none" stroke="#8c919c" strokeWidth={on ? 2.4 : 1.5} strokeDasharray="8 5" />
            <Chip x={k.mid.x} y={k.mid.y} label={fit(c.label, 40)} color="#5b616e" italic />
          </g>
        );
      })}

      {view.edges.map((e) => {
        const k = connect(e.from, e.to);
        if (!k) return null;
        const on = selected?.edgeId === e.id;
        const len = e.lengthFt !== null ? formatMeasure(e.lengthFt, e.unit as MeasureUnit) : "unmeasured";
        const label = `${fit(e.desc, 26)} · ${len}${e.kind === "link" ? " (typed)" : ""}`;
        return (
          <g key={e.id} data-edge={e.kind} onClick={h.onEdgeClick ? () => h.onEdgeClick?.(e.id, e.kind) : undefined} style={pointer}>
            {interactive && <path d={k.d} fill="none" stroke="transparent" strokeWidth={12} />}
            <path d={k.d} fill="none" stroke="#3155a8" strokeWidth={on ? 2.8 : 1.8} strokeDasharray={e.kind === "link" ? "10 3 2 3" : undefined} />
            <Chip x={k.mid.x} y={k.mid.y + 10} label={label} color="#3155a8" />
          </g>
        );
      })}
    </svg>
  );
}

/** The numbered riser notes block (E-501 and the riser page's print). */
export function RiserNotes({ notes }: { notes: RiserNote[] }) {
  if (!notes.length) return null;
  return (
    <ol className="pk-riser-notes">
      {notes.map((n) => (
        <li key={n.id} value={n.n}>
          {n.text}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 6: Create `src/app/(app)/design/grid/[id]/riser/riser-panels.tsx`**

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { ConfirmButton } from "@/components/confirm-button";

/** Riser editor tool panels (#209). Plain controlled forms; the editor owns
 *  every server call and passes busy/callbacks in. */

export type RiserPartOption = { id: string; label: string };

export const PANEL: CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  padding: "12px 14px",
  marginBottom: 12,
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  alignItems: "flex-end",
  fontSize: 12.5,
};

export const INPUT: CSSProperties = {
  border: "1px solid #dfe2e8",
  borderRadius: 7,
  padding: "6px 8px",
  fontSize: 12.5,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
};

export const FIELD: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 600, color: "#5b616e" };
const TITLE: CSSProperties = { width: "100%", fontWeight: 700, fontSize: 13, color: "#16181d" };
const HINT: CSSProperties = { width: "100%", fontSize: 11.5, color: "#8c919c" };

/** Filterable select — the library can hold thousands of parts. */
export function PartPicker({ label, options, value, onChange }: { label: string; options: RiserPartOption[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = (needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options).slice(0, 200);
  const current = options.find((o) => o.id === value);
  const list = current && !shown.some((o) => o.id === current.id) ? [current, ...shown] : shown;
  return (
    <label style={FIELD}>
      {label}
      <input style={{ ...INPUT, width: 240 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`${label} filter`} />
      <select style={{ ...INPUT, width: 320 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Choose…</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DevicePanel({
  nodeName,
  devices,
  busy,
  onAdd,
  onCancel,
}: {
  nodeName: string;
  devices: RiserPartOption[];
  busy: boolean;
  onAdd: (partId: string, qty: number) => void;
  onCancel: () => void;
}) {
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("1");
  const n = Math.floor(Number(qty));
  const valid = Boolean(partId) && n >= 1 && n <= 200;
  return (
    <div style={PANEL}>
      <div style={TITLE}>{`Add devices to ${nodeName}`}</div>
      <PartPicker label="Device" options={devices} value={partId} onChange={setPartId} />
      <label style={FIELD}>
        Qty
        <input style={{ ...INPUT, width: 72 }} type="number" min={1} max={200} value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <button type="button" className="pk-btn-accent" disabled={!valid || busy} onClick={() => onAdd(partId, n)}>
        {busy ? "Adding…" : "Add to plan"}
      </button>
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <div style={HINT}>They land on the plan inside this space (the lower margin for Unassigned), spread so multiples don&apos;t stack.</div>
    </div>
  );
}

export function RowPanel({
  nodeName,
  partId: currentPart,
  desc,
  qty: currentQty,
  devices,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  nodeName: string;
  partId: string;
  desc: string;
  qty: number;
  devices: RiserPartOption[];
  busy: boolean;
  onSave: (partId: string, qty: number) => void;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [partId, setPartId] = useState(currentPart);
  const [qty, setQty] = useState(String(currentQty));
  const n = Math.floor(Number(qty));
  const valid = Boolean(partId) && n >= 1 && n <= 200;
  const dirty = partId !== currentPart || n !== currentQty;
  return (
    <div style={PANEL}>
      <div style={TITLE}>{`${currentQty}× ${desc} — ${nodeName}`}</div>
      <PartPicker label="Part" options={devices} value={partId} onChange={setPartId} />
      <label style={FIELD}>
        Qty
        <input style={{ ...INPUT, width: 72 }} type="number" min={1} max={200} value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <button type="button" className="pk-btn-accent" disabled={!valid || !dirty || busy} onClick={() => onSave(partId, n)}>
        Save
      </button>
      <ConfirmButton label="Delete devices" confirmLabel={`Delete ${currentQty}`} disabled={busy} onConfirm={onDelete} />
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Close
      </button>
      <div style={HINT}>Edits the placements on the plan — a lower qty removes the newest ones in this space.</div>
    </div>
  );
}

export function SpacePanel({
  sheets,
  busy,
  onAdd,
  onCancel,
}: {
  sheets: Array<{ id: string; name: string }>;
  busy: boolean;
  onAdd: (name: string, sheetId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [sheetId, setSheetId] = useState(sheets[0]?.id || "");
  if (!sheets.length) {
    return (
      <div style={PANEL}>
        <div style={TITLE}>Upload or generate a plan sheet first — a space lives on a plan.</div>
        <button type="button" className="pk-btn-outline" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }
  return (
    <div style={PANEL}>
      <div style={TITLE}>New space</div>
      <label style={FIELD}>
        Name
        <input style={{ ...INPUT, width: 220 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Amp room, Catwalk…" />
      </label>
      {sheets.length > 1 && (
        <label style={FIELD}>
          Sheet
          <select style={{ ...INPUT, width: 220 }} value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="pk-btn-accent" disabled={!name.trim() || !sheetId || busy} onClick={() => onAdd(name.trim(), sheetId)}>
        Add space
      </button>
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <div style={HINT}>A small rectangle on the plan&apos;s lower margin — open the plan to reshape it around the real room.</div>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/app/(app)/design/grid/[id]/riser/riser-editor.tsx`** (version 1 — Task 6 replaces this file with the full tool set)

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RiserCanvas, RiserNotes, type RiserCanvasHandlers, type RiserSelection } from "@/components/drawing/riser-canvas";
import { RISER_H, RISER_W, marginSpaceRect, type RiserNodeBox, type RiserView } from "@/lib/design/grid-riser-doc";
import { addSpaceAction } from "../actions";
import { patchRiserAction, riserAddDevicesAction, riserRemoveDevicesAction, riserReplacePartAction, riserSetQtyAction } from "./actions";
import { DevicePanel, RowPanel, SpacePanel, type RiserPartOption } from "./riser-panels";

/**
 * The editable riser (#209, spec §4). The graph is derived server-side and
 * arrives as `view`; every edit goes through a server action, then
 * router.refresh() re-derives it. Only in-flight drag positions live here.
 */

export type RiserSheetLite = { id: string; name: string; mime: string; src: string };

type Tool = "select" | "device" | "space";
type Res = { ok: true } | { ok: false; error: string };
type Panel = { kind: "device"; nodeKey: string } | { kind: "row"; nodeKey: string; partId: string } | { kind: "space" } | null;
type Drag = { key: string; dx: number; dy: number; box: RiserNodeBox };

const TOOLS: Array<{ key: Tool; label: string; hint: string }> = [
  { key: "select", label: "Select", hint: "Drag a node by its header to move it; click a device row to edit or delete it." },
  { key: "device", label: "+ Device", hint: "Click a node to add devices — they land on the plan inside that space." },
  { key: "space", label: "Space", hint: "Adds a small room on the plan's lower margin — reshape it on the plan." },
];

export default function RiserEditor({
  projectId,
  optionId,
  view,
  devices,
  sheets,
  spaces,
}: {
  projectId: string;
  optionId: string;
  view: RiserView;
  devices: RiserPartOption[];
  sheets: RiserSheetLite[];
  spaces: Array<{ sheetId: string; page: number }>;
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [panel, setPanel] = useState<Panel>(null);
  const [liveBoxes, setLiveBoxes] = useState<Record<string, RiserNodeBox>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nodeByKey = new Map(view.nodes.map((n) => [n.key, n]));

  async function run(fn: () => Promise<Res>): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setErr(r.error);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setErr("Something went wrong — please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** For ConfirmButton: throws on { ok: false } so the button shows the error. */
  async function mustOk(fn: () => Promise<Res>): Promise<void> {
    const r = await fn();
    if (!r.ok) throw new Error(r.error);
    router.refresh();
  }

  function toUnit(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x / RISER_W, y: p.y / RISER_H };
  }

  function choose(t: Tool) {
    setTool(t);
    setPanel(t === "space" ? { kind: "space" } : null);
    setErr(null);
  }

  function dropLive(key: string) {
    setLiveBoxes((b) => {
      const next = { ...b };
      delete next[key];
      return next;
    });
  }

  async function saveRow(nodeKey: string, fromPartId: string, fromQty: number, partId: string, qty: number) {
    if (partId !== fromPartId && !(await run(() => riserReplacePartAction(projectId, { optionId, nodeKey, fromPartId, toPartId: partId })))) return;
    if (qty !== fromQty && !(await run(() => riserSetQtyAction(projectId, { optionId, nodeKey, partId, qty })))) return;
    setPanel(null);
  }

  async function addSpace(name: string, sheetId: string) {
    const count = spaces.filter((s) => s.sheetId === sheetId && s.page === 1).length;
    if (await run(() => addSpaceAction(projectId, { sheetId, page: 1, name, points: marginSpaceRect(count) }))) choose("select");
  }

  const handlers: RiserCanvasHandlers = {
    onNodeDown: (key, e) => {
      if (busy) return;
      if (tool === "device") {
        setPanel({ kind: "device", nodeKey: key });
        return;
      }
      if (tool !== "select") return;
      const n = nodeByKey.get(key);
      const p = toUnit(e);
      if (!n || !p) return;
      const box = liveBoxes[key] || n.box;
      drag.current = { key, dx: p.x - box.x, dy: p.y - box.y, box };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onRowClick: (key, partId) => {
      if (tool === "device") setPanel({ kind: "device", nodeKey: key });
      else if (tool === "select") setPanel({ kind: "row", nodeKey: key, partId });
    },
    onMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const p = toUnit(e);
      if (!p) return;
      setLiveBoxes((b) => ({
        ...b,
        [d.key]: { ...d.box, x: Math.max(0, Math.min(1 - d.box.w, p.x - d.dx)), y: Math.max(0, p.y - d.dy) },
      }));
    },
    onUp: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const box = liveBoxes[d.key];
      if (!box) return;
      void run(() => patchRiserAction(projectId, optionId, { op: "moveNode", key: d.key, box })).then((ok) => {
        if (!ok) dropLive(d.key);
      });
    },
  };

  const rowGroup = panel?.kind === "row" ? nodeByKey.get(panel.nodeKey)?.groups.find((g) => g.partId === panel.partId) : undefined;
  const selected: RiserSelection =
    panel?.kind === "row" ? { row: { key: panel.nodeKey, partId: panel.partId } } : panel?.kind === "device" ? { nodeKey: panel.nodeKey } : null;

  return (
    <div>
      <div className="pk-no-print" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {TOOLS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tool === t.key ? "pk-btn-accent" : "pk-btn-outline"}
            style={{ fontSize: 12 }}
            aria-pressed={tool === t.key}
            onClick={() => choose(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="pk-no-print" style={{ fontSize: 12, color: "#8c919c", marginBottom: 10 }}>
        {TOOLS.find((t) => t.key === tool)?.hint}
      </div>
      {err && (
        <div className="pk-no-print" role="alert" style={{ fontSize: 12.5, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          {err}
        </div>
      )}
      <div className="pk-no-print">
        {panel?.kind === "device" && (
          <DevicePanel
            key={`dev-${panel.nodeKey}`}
            nodeName={nodeByKey.get(panel.nodeKey)?.name || "Unassigned"}
            devices={devices}
            busy={busy}
            onCancel={() => setPanel(null)}
            onAdd={async (partId, qty) => {
              if (await run(() => riserAddDevicesAction(projectId, { optionId, nodeKey: panel.nodeKey, partId, qty }))) setPanel(null);
            }}
          />
        )}
        {panel?.kind === "row" && rowGroup && (
          <RowPanel
            key={`row-${panel.nodeKey}-${rowGroup.partId}-${rowGroup.qty}`}
            nodeName={nodeByKey.get(panel.nodeKey)?.name || "Unassigned"}
            partId={rowGroup.partId}
            desc={rowGroup.desc}
            qty={rowGroup.qty}
            devices={devices}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={(partId, qty) => void saveRow(panel.nodeKey, rowGroup.partId, rowGroup.qty, partId, qty)}
            onDelete={() =>
              mustOk(() => riserRemoveDevicesAction(projectId, { optionId, nodeKey: panel.nodeKey, partId: rowGroup.partId })).then(() => setPanel(null))
            }
          />
        )}
        {panel?.kind === "space" && (
          <SpacePanel sheets={sheets} busy={busy} onCancel={() => choose("select")} onAdd={(name, sheetId) => void addSpace(name, sheetId)} />
        )}
      </div>
      <div className="pk-card grid-riser-card" style={{ padding: 12 }}>
        {view.nodes.length === 0 && (
          <div className="pk-no-print" style={{ fontSize: 13, color: "#8c919c", marginBottom: 8 }}>
            No spaces yet — use Space to add one, or draw rooms on the plan.
          </div>
        )}
        <RiserCanvas view={view} boxes={liveBoxes} svgRef={svgRef} handlers={handlers} selected={selected} />
      </div>
      {view.notes.length > 0 && (
        <div className="pk-card" style={{ padding: "12px 16px", marginTop: 12, fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Riser notes</div>
          <RiserNotes notes={view.notes} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Rewrite `src/app/(app)/design/grid/[id]/riser/page.tsx`**

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject, listSheets } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getSettings } from "@/lib/settings";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { isPerLengthUnit, type PartLite } from "@/lib/design/grid-bom";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { riserViewForOption } from "@/lib/design/grid-riser-view";
import { legendRows, symbolContext, type SymbolEntry } from "@/lib/design/grid-icons";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { PrintButton } from "@/components/letter/print-button";
import RiserEditor from "./riser-editor";

export const metadata = { title: "Riser — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * The riser (D112 → editable, #209). Devices, spaces and wire runs are still
 * DERIVED from the plan on every load; the saved riser document adds node
 * positions, level lines, conduits, notes and typed-length links. Every tool
 * writes through the Grid project's actions, so the plan, BOM and quote see
 * the same devices the riser shows.
 */
export default async function RiserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { option: requestedOption } = await searchParams;
  const project = await getProject(decodeURIComponent(id));
  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/designs" style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      </div>
    );
  }

  const optionId = resolveOptionId(project, requestedOption);
  const option = project.options!.find((o) => o.id === optionId)!;
  const slice = optionSlice(project, optionId);
  const base = `/design/grid/${encodeURIComponent(project.id)}`;
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;

  const [sheets, catalog, gridSymbols, settings] = await Promise.all([listSheets(project.id), listCatalog(), listGridSymbols(), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);
  const symCtx = symbolContext(settings);
  // `library` = what can be placed; `parts` also resolves pre-library placements.
  const library = gridPartsFrom(gridSymbols, catalog, categoryMap);
  const parts = gridPartsFrom(gridSymbols, catalog, categoryMap, { catalogFallback: true });
  const view = riserViewForOption({ project, optionId, parts, symCtx });

  // Legend (#206 rule): one row per icon+colour actually drawn.
  const partById = new Map(parts.map((p) => [p.id, p]));
  const legend = legendRows(
    slice.placements
      .filter((pl) => !pl.curtain)
      .map((pl): SymbolEntry & { id?: string; desc?: string } => partById.get(pl.partId) || { category: pl.category || "", desc: pl.category || pl.partId }),
    symCtx
  );

  const label = (p: PartLite) => (p.sku && p.sku !== p.desc ? `${p.desc} · ${p.sku}` : p.desc);
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  const devices = library.filter((p) => !isPerLengthUnit(p.unit)).map((p) => ({ id: p.id, label: label(p) })).sort(byLabel);

  return (
    <div className="pk-content" style={{ maxWidth: 1240, padding: "26px 30px 64px" }}>
      {/* print (D113.7): chrome hides via .pk-doc-toolbar/.pk-no-print rules */}
      <style>{`@media print { .grid-riser-card { border: none !important; box-shadow: none !important; padding: 0 !important; } }`}</style>
      <div className="pk-doc-toolbar" style={{ maxWidth: "none", justifyContent: "flex-start" }}>
        <Link
          href={`${base}${optionQuery}`}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none", marginRight: "auto" }}
        >
          ← {project.name}
        </Link>
        <PrintButton accent={accent} />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Riser</h1>
        <span style={{ color: "#8c919c", fontSize: 13 }}>
          {project.name}
          {project.options!.length > 1 ? ` · ${option.name}` : ""}
          {project.customer ? ` · ${project.customer}` : ""} · {project.id}
        </span>
      </div>
      <p className="pk-no-print" style={{ color: "#8c919c", fontSize: 13, marginBottom: 16 }}>
        Devices, rooms and wire runs come live from the plan; the layout, level lines, conduit notes and typed
        cable links are saved here. Anything you add on the riser lands on the plan too.
      </p>
      <RiserEditor
        projectId={project.id}
        optionId={optionId}
        view={view}
        devices={devices}
        sheets={sheets.map((s) => ({
          id: s.id,
          name: s.name,
          mime: s.mime,
          // Blob-stored sheets stream through the authenticated proxy (D116).
          src: s.blobPath ? `/api/grid-sheets/${encodeURIComponent(s.id)}` : s.dataUrl,
        }))}
        spaces={(project.spaces || []).map((s) => ({ sheetId: s.sheetId, page: s.page }))}
      />
      {legend.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12, fontSize: 11.5, color: "#5b616e" }}>
          <span style={{ fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", fontSize: 10, color: "#9aa0ab", alignSelf: "center" }}>Legend</span>
          {legend.map((l) => (
            <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <SymbolIcon iconId={l.iconId} color={l.color} size={14} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Run the harness to verify it passes**

Run: `npm run test:specs 2>&1 | grep -E "#209|#206 final fix wave \(moved|FAIL|ALL PASSED|FAILED"`
Expected: all `PASS`, `ALL PASSED`.

- [ ] **Step 10: Gates**

Run: `npx tsc --noEmit && npx eslint 2>&1 | tail -1`
Expected: tsc silent; `✖ 111 problems (0 errors, 111 warnings)`.
Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5; echo "exit $?"; rm -rf .next`
Expected: exit 0 (the riser editor and panels are client components; they import only pure modules and server actions).

- [ ] **Step 11: Commit**

```bash
git add src/lib/design/grid-parts.ts src/lib/design/grid-riser-view.ts src/components/drawing/riser-canvas.tsx \
  "src/app/(app)/design/grid/[id]/riser/riser-panels.tsx" "src/app/(app)/design/grid/[id]/riser/riser-editor.tsx" \
  "src/app/(app)/design/grid/[id]/riser/page.tsx" "src/app/(app)/design/grid/[id]/page.tsx" scripts/test-review-and-spec.ts
git -c user.name="SM" commit -m "feat(grid): editable riser — saved layout, + Device onto the plan, edit/delete rows, add spaces (#209)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Riser editor II — Connect (route or RiserLink), Conduit, Level line, Note

**Files:**
- Create: `src/components/design/sheet-aspect.ts`
- Modify: `src/app/(app)/design/grid/[id]/riser/riser-panels.tsx` (import line + append panels)
- Replace: `src/app/(app)/design/grid/[id]/riser/riser-editor.tsx` (full file below)
- Modify: `src/app/(app)/design/grid/[id]/riser/page.tsx` (pass cables, placements, calibrations)
- Test: `scripts/test-review-and-spec.ts` (append block at EOF)

**Interfaces:**
- Consumes: `connectKind`, `UNASSIGNED_KEY`, `RISER_W`, `RISER_H`, `EndRef`, `RiserNote` (Task 3); `patchRiserAction`, `addRiserLinkAction` (Task 4); existing `addRouteAction(projectId, { sheetId, page, partId, points, aspect, optionId, fromPlacementId?, toPlacementId? })` and `removeRouteAction(projectId, routeId)` from `../actions`; Task 5's canvas, panels and page.
- Produces: `measureSheetAspect(sheet: { name: string; mime: string; src: string }, page?: number): Promise<number>` (page height ÷ width, browser-only); panels `PairPanel`, `LevelPanel`, `EdgePanel`, `ConduitPanel`, `NotesPanel`; `RiserEditor` gains props `cables: RiserPartOption[]`, `placements: Array<{ id; sheetId; page; x; y }>`, `calibrations: Array<{ docId; page }>`.

- [ ] **Step 1: Write the failing test** — append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #209 grid drawing set — Task 6: riser tools wiring --- */
{
  const reSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/riser/riser-editor.tsx"), "utf8");
  ok(reSrc.includes("connectKind(from, to, placements, calibrations)") && reSrc.includes("addRouteAction(") && reSrc.includes("addRiserLinkAction(") && reSrc.includes("measureSheetAspect("),
    "#209 Connect: two devices on one calibrated page draw a measured GridRoute; anything else stores a typed RiserLink");
  ok(['op: "addConduit"', 'op: "addLevel"', 'op: "updateLevel"', 'op: "addNote"', 'op: "removeLink"'].every((s) => reSrc.includes(s)),
    "#209 tools: conduit, level line, note and link removal all write through patchRiserAction");
  const aspectSrc = readFileSync(join(process.cwd(), "src/components/design/sheet-aspect.ts"), "utf8");
  ok(aspectSrc.includes('import("pdfjs-dist")') && aspectSrc.includes("naturalHeight / img.naturalWidth"), "#209 Connect: the sheet aspect is measured the way the editor measures it (image natural size, PDF viewport)");
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#209 Connect|#209 tools|ENOENT" | head -5`
Expected: `FAIL #209 Connect …` / `FAIL #209 tools …`, or an `ENOENT` for `sheet-aspect.ts`.

- [ ] **Step 3: Create `src/components/design/sheet-aspect.ts`**

```ts
/**
 * A plan sheet page's height ÷ width, measured in the browser the same way
 * the Grid editor does (image natural size; PDF page viewport) — the aspect
 * a GridRoute stamps so its length is recomputable anywhere (D110). Used by
 * the riser's Connect tool (#209), which draws a route without the plan open.
 * Browser-only: call it from event handlers, never during render.
 */

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number } }>;
};

export async function measureSheetAspect(sheet: { name: string; mime: string; src: string }, page = 1): Promise<number> {
  const isPdf = sheet.mime === "application/pdf" || sheet.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return new Promise<number>((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        img.naturalWidth > 0 ? resolve(img.naturalHeight / img.naturalWidth) : reject(new Error("The plan sheet has no size."));
      img.onerror = () => reject(new Error("Could not load the plan sheet."));
      img.src = sheet.src;
    });
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const src = sheet.src.startsWith("data:")
    ? { data: Uint8Array.from(atob(sheet.src.split(",")[1] || ""), (c) => c.charCodeAt(0)) }
    : { url: sheet.src };
  const doc = (await pdfjs.getDocument({ ...src, disableFontFace: true, useSystemFonts: false }).promise) as unknown as PdfDoc;
  const pg = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
  const vp = pg.getViewport({ scale: 1 });
  if (!(vp.width > 0)) throw new Error("The plan sheet has no size.");
  return vp.height / vp.width;
}
```

- [ ] **Step 4: Extend `riser-panels.tsx`** — replace its import lines

```tsx
import { useState, type CSSProperties } from "react";
import { ConfirmButton } from "@/components/confirm-button";
```

with

```tsx
import { useState, type CSSProperties, type RefObject } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import type { RiserNote } from "@/lib/design/grid-riser-doc";
```

and append at the end of the file:

```tsx
/** Connect / Conduit, after both ends are picked. */
export function PairPanel({
  tool,
  kind,
  fromLabel,
  toLabel,
  cables,
  busy,
  onConnect,
  onConduit,
  onCancel,
}: {
  tool: "connect" | "conduit";
  kind: "route" | "link";
  fromLabel: string;
  toLabel: string;
  cables: RiserPartOption[];
  busy: boolean;
  onConnect: (partId: string, lengthFt: number | null) => void;
  onConduit: (label: string) => void;
  onCancel: () => void;
}) {
  const [partId, setPartId] = useState("");
  const [len, setLen] = useState("");
  const [label, setLabel] = useState('1" EMT (by EC)');
  const ft = Number(len);
  if (tool === "conduit") {
    return (
      <div style={PANEL}>
        <div style={TITLE}>{`Conduit: ${fromLabel} → ${toLabel}`}</div>
        <label style={FIELD}>
          Label
          <input style={{ ...INPUT, width: 240 }} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </label>
        <button type="button" className="pk-btn-accent" disabled={!label.trim() || busy} onClick={() => onConduit(label.trim())}>
          Add conduit
        </button>
        <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <div style={HINT}>An annotation only — conduit is never priced and never on the BOM.</div>
      </div>
    );
  }
  const valid = Boolean(partId) && (kind === "route" || (ft > 0 && ft <= 5000));
  return (
    <div style={PANEL}>
      <div style={TITLE}>{`Connect: ${fromLabel} → ${toLabel}`}</div>
      <PartPicker label="Cable" options={cables} value={partId} onChange={setPartId} />
      {kind === "link" && (
        <label style={FIELD}>
          Length (ft)
          <input style={{ ...INPUT, width: 96 }} type="number" min={1} max={5000} step={1} value={len} onChange={(e) => setLen(e.target.value)} />
        </label>
      )}
      <button type="button" className="pk-btn-accent" disabled={!valid || busy} onClick={() => onConnect(partId, kind === "link" ? ft : null)}>
        {kind === "route" ? "Draw wire on the plan" : "Add link"}
      </button>
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <div style={HINT}>
        {kind === "route"
          ? "Both devices sit on the same calibrated page: this draws a straight wire run on the plan, priced by its measured length."
          : "The ends aren't two devices on one calibrated page: this records a riser link whose typed length prices like a wire run."}
      </div>
    </div>
  );
}

/** New level line, or edit an existing one. */
export function LevelPanel({
  title,
  initialLabel = "",
  initialElevation = "",
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  title: string;
  initialLabel?: string;
  initialElevation?: string;
  busy: boolean;
  onSave: (label: string, elevation: string) => void;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [elevation, setElevation] = useState(initialElevation);
  return (
    <div style={PANEL}>
      <div style={TITLE}>{title}</div>
      <label style={FIELD}>
        Label
        <input style={{ ...INPUT, width: 200 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Stage level" maxLength={60} />
      </label>
      <label style={FIELD}>
        Elevation (optional)
        <input style={{ ...INPUT, width: 140 }} value={elevation} onChange={(e) => setElevation(e.target.value)} placeholder={`EL 100'-0"`} maxLength={30} />
      </label>
      <button type="button" className="pk-btn-accent" disabled={!label.trim() || busy} onClick={() => onSave(label.trim(), elevation.trim())}>
        Save
      </button>
      {onDelete && <ConfirmButton label="Delete line" confirmLabel="Delete" disabled={busy} onConfirm={onDelete} />}
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Close
      </button>
    </div>
  );
}

/** A selected wire run or riser link. */
export function EdgePanel({ title, detail, busy, onDelete, onCancel }: { title: string; detail: string; busy: boolean; onDelete: () => Promise<void>; onCancel: () => void }) {
  return (
    <div style={PANEL}>
      <div style={TITLE}>{title}</div>
      <div style={HINT}>{detail}</div>
      <ConfirmButton label="Delete connection" confirmLabel="Delete" disabled={busy} onConfirm={onDelete} />
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Close
      </button>
    </div>
  );
}

/** A selected conduit annotation. */
export function ConduitPanel({
  label: initial,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  label: string;
  busy: boolean;
  onSave: (label: string) => void;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial);
  return (
    <div style={PANEL}>
      <div style={TITLE}>Conduit</div>
      <label style={FIELD}>
        Label
        <input style={{ ...INPUT, width: 240 }} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      </label>
      <button type="button" className="pk-btn-accent" disabled={!label.trim() || label.trim() === initial || busy} onClick={() => onSave(label.trim())}>
        Save
      </button>
      <ConfirmButton label="Delete conduit" confirmLabel="Delete" disabled={busy} onConfirm={onDelete} />
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Close
      </button>
    </div>
  );
}

/** Numbered riser notes: add, edit, delete (they print on E-501). */
export function NotesPanel({
  notes,
  busy,
  inputRef,
  onAdd,
  onSave,
  onDelete,
}: {
  notes: RiserNote[];
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onAdd: (text: string) => Promise<boolean>;
  onSave: (id: string, text: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  return (
    <div className="pk-card pk-no-print" style={{ padding: "12px 16px", marginTop: 12, fontSize: 12.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Riser notes</div>
      {notes.map((n) =>
        editing?.id === n.id ? (
          <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ width: 22, color: "#8c919c" }}>{`${n.n}.`}</span>
            <input style={{ ...INPUT, flex: 1 }} value={editing.text} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} maxLength={500} />
            <button
              type="button"
              className="pk-btn-accent"
              disabled={!editing.text.trim() || busy}
              onClick={() => {
                onSave(n.id, editing.text.trim());
                setEditing(null);
              }}
            >
              Save
            </button>
            <button type="button" className="pk-btn-outline" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ width: 22, color: "#8c919c" }}>{`${n.n}.`}</span>
            <span style={{ flex: 1 }}>{n.text}</span>
            <button type="button" className="pk-btn-outline" style={{ fontSize: 11.5 }} disabled={busy} onClick={() => setEditing({ id: n.id, text: n.text })}>
              Edit
            </button>
            <ConfirmButton label="Delete" confirmLabel="Delete note" disabled={busy} onConfirm={() => onDelete(n.id)} />
          </div>
        )
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          ref={inputRef}
          style={{ ...INPUT, flex: 1 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a numbered note — e.g. Conduit and boxes by electrical contractor."
          maxLength={500}
        />
        <button
          type="button"
          className="pk-btn-accent"
          disabled={!text.trim() || busy}
          onClick={async () => {
            if (await onAdd(text.trim())) setText("");
          }}
        >
          Add note
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace `src/app/(app)/design/grid/[id]/riser/riser-editor.tsx`** with the full tool set:

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RiserCanvas, RiserNotes, type RiserCanvasHandlers, type RiserSelection } from "@/components/drawing/riser-canvas";
import { measureSheetAspect } from "@/components/design/sheet-aspect";
import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import {
  RISER_H,
  RISER_W,
  UNASSIGNED_KEY,
  connectKind,
  marginSpaceRect,
  type EndRef,
  type RiserNodeBox,
  type RiserOp,
  type RiserView,
} from "@/lib/design/grid-riser-doc";
import { addRouteAction, addSpaceAction, removeRouteAction } from "../actions";
import {
  addRiserLinkAction,
  patchRiserAction,
  riserAddDevicesAction,
  riserRemoveDevicesAction,
  riserReplacePartAction,
  riserSetQtyAction,
} from "./actions";
import {
  ConduitPanel,
  DevicePanel,
  EdgePanel,
  LevelPanel,
  NotesPanel,
  PairPanel,
  RowPanel,
  SpacePanel,
  type RiserPartOption,
} from "./riser-panels";

/**
 * The editable riser (#209, spec §4). The graph is derived server-side and
 * arrives as `view`; every edit goes through a server action, then
 * router.refresh() re-derives it. Only in-flight drags and the half-picked
 * Connect/Conduit end live here.
 */

export type RiserSheetLite = { id: string; name: string; mime: string; src: string };

type Tool = "select" | "device" | "connect" | "conduit" | "level" | "space" | "note";
type Res = { ok: true } | { ok: false; error: string };
type End = { ref: EndRef; label: string };
type Panel =
  | { kind: "device"; nodeKey: string }
  | { kind: "row"; nodeKey: string; partId: string }
  | { kind: "space" }
  | { kind: "pair"; tool: "connect" | "conduit"; from: EndRef; to: EndRef; fromLabel: string; toLabel: string }
  | { kind: "level"; y: number }
  | { kind: "levelEdit"; id: string }
  | { kind: "edge"; id: string; edgeKind: "route" | "link" }
  | { kind: "conduit"; id: string }
  | null;
type Drag = { kind: "node"; key: string; dx: number; dy: number; box: RiserNodeBox } | { kind: "level"; id: string };

const TOOLS: Array<{ key: Tool; label: string; hint: string }> = [
  { key: "select", label: "Select", hint: "Drag a node by its header or a level line to move it; click a device row, connection or conduit to edit it." },
  { key: "device", label: "+ Device", hint: "Click a node to add devices — they land on the plan inside that space." },
  { key: "connect", label: "Connect", hint: "Click a device row or a node header, then the other end, then pick the cable." },
  { key: "conduit", label: "Conduit", hint: "Click two ends to draw a conduit annotation — never priced." },
  { key: "level", label: "Level line", hint: "Click the canvas where the level line goes." },
  { key: "space", label: "Space", hint: "Adds a small room on the plan's lower margin — reshape it on the plan." },
  { key: "note", label: "Note", hint: "Type a numbered note below — notes print on the riser sheet." },
];

export default function RiserEditor({
  projectId,
  optionId,
  view,
  devices,
  cables,
  sheets,
  spaces,
  placements,
  calibrations,
}: {
  projectId: string;
  optionId: string;
  view: RiserView;
  devices: RiserPartOption[];
  cables: RiserPartOption[];
  sheets: RiserSheetLite[];
  spaces: Array<{ sheetId: string; page: number }>;
  placements: Array<{ id: string; sheetId: string; page: number; x: number; y: number }>;
  calibrations: Array<{ docId: string; page: number }>;
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [panel, setPanel] = useState<Panel>(null);
  const [first, setFirst] = useState<End | null>(null);
  const [liveBoxes, setLiveBoxes] = useState<Record<string, RiserNodeBox>>({});
  const [liveLevels, setLiveLevels] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nodeByKey = new Map(view.nodes.map((n) => [n.key, n]));

  async function run(fn: () => Promise<Res>): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setErr(r.error);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setErr("Something went wrong — please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** For ConfirmButton: throws on { ok: false } so the button shows the error. */
  async function mustOk(fn: () => Promise<Res>): Promise<void> {
    const r = await fn();
    if (!r.ok) throw new Error(r.error);
    router.refresh();
  }

  const patch = (op: RiserOp) => run(() => patchRiserAction(projectId, optionId, op));

  function toUnit(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x / RISER_W, y: p.y / RISER_H };
  }

  function choose(t: Tool) {
    setTool(t);
    setPanel(t === "space" ? { kind: "space" } : null);
    setFirst(null);
    setErr(null);
    if (t === "note") noteRef.current?.focus();
  }

  function dropLive(key: string) {
    setLiveBoxes((b) => {
      const next = { ...b };
      delete next[key];
      return next;
    });
  }

  /** A device row → its oldest placement (a representative device end); a
   *  node header → the space itself. */
  function endOf(nodeKey: string, partId: string | null): End | null {
    const n = nodeByKey.get(nodeKey);
    if (!n) return null;
    if (!partId) return { ref: { kind: "space", spaceId: nodeKey === UNASSIGNED_KEY ? null : nodeKey }, label: n.name };
    const g = n.groups.find((x) => x.partId === partId);
    const id = g?.ids[0];
    return g && id ? { ref: { kind: "placement", placementId: id }, label: `${g.desc} (${n.name})` } : null;
  }

  function pick(nodeKey: string, partId: string | null) {
    const end = endOf(nodeKey, partId);
    if (!end) {
      setErr("That row has no device to connect.");
      return;
    }
    if (!first) {
      setFirst(end);
      return;
    }
    setPanel({ kind: "pair", tool: tool === "conduit" ? "conduit" : "connect", from: first.ref, to: end.ref, fromLabel: first.label, toLabel: end.label });
    setFirst(null);
  }

  async function saveRow(nodeKey: string, fromPartId: string, fromQty: number, partId: string, qty: number) {
    if (partId !== fromPartId && !(await run(() => riserReplacePartAction(projectId, { optionId, nodeKey, fromPartId, toPartId: partId })))) return;
    if (qty !== fromQty && !(await run(() => riserSetQtyAction(projectId, { optionId, nodeKey, partId, qty })))) return;
    setPanel(null);
  }

  async function addSpace(name: string, sheetId: string) {
    const count = spaces.filter((s) => s.sheetId === sheetId && s.page === 1).length;
    if (await run(() => addSpaceAction(projectId, { sheetId, page: 1, name, points: marginSpaceRect(count) }))) choose("select");
  }

  async function connect(from: EndRef, to: EndRef, partId: string, lengthFt: number | null) {
    if (connectKind(from, to, placements, calibrations) === "route" && from.kind === "placement" && to.kind === "placement") {
      const fromId = from.placementId;
      const toId = to.placementId;
      const a = placements.find((p) => p.id === fromId);
      const b = placements.find((p) => p.id === toId);
      const sheet = sheets.find((s) => s.id === a?.sheetId);
      if (!a || !b || !sheet) {
        setErr("Those devices are no longer on the plan — refresh the page.");
        return;
      }
      let aspect: number;
      try {
        aspect = await measureSheetAspect(sheet, a.page);
      } catch {
        setErr("Couldn't open the plan sheet to measure this run — try again.");
        return;
      }
      const ok = await run(() =>
        addRouteAction(projectId, {
          sheetId: a.sheetId,
          page: a.page,
          partId,
          points: [
            { x: a.x, y: a.y },
            { x: b.x, y: b.y },
          ],
          aspect,
          optionId,
          fromPlacementId: a.id,
          toPlacementId: b.id,
        })
      );
      if (ok) setPanel(null);
      return;
    }
    if (lengthFt === null) return;
    if (await run(() => addRiserLinkAction(projectId, { optionId, from, to, partId, lengthFt }))) setPanel(null);
  }

  const handlers: RiserCanvasHandlers = {
    onNodeDown: (key, e) => {
      if (busy) return;
      if (tool === "device") {
        setPanel({ kind: "device", nodeKey: key });
        return;
      }
      if (tool === "connect" || tool === "conduit") {
        pick(key, null);
        return;
      }
      if (tool !== "select") return;
      const n = nodeByKey.get(key);
      const p = toUnit(e);
      if (!n || !p) return;
      const box = liveBoxes[key] || n.box;
      drag.current = { kind: "node", key, dx: p.x - box.x, dy: p.y - box.y, box };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onRowClick: (key, partId) => {
      if (tool === "connect" || tool === "conduit") pick(key, partId);
      else if (tool === "device") setPanel({ kind: "device", nodeKey: key });
      else if (tool === "select") setPanel({ kind: "row", nodeKey: key, partId });
    },
    onEdgeClick: (id, kind) => {
      if (tool === "select") setPanel({ kind: "edge", id, edgeKind: kind });
    },
    onConduitClick: (id) => {
      if (tool === "select") setPanel({ kind: "conduit", id });
    },
    onLevelDown: (id, e) => {
      if (tool !== "select" || busy) return;
      setPanel({ kind: "levelEdit", id });
      drag.current = { kind: "level", id };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onBackgroundDown: (e) => {
      if (tool !== "level") return;
      const p = toUnit(e);
      if (p) setPanel({ kind: "level", y: p.y });
    },
    onMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const p = toUnit(e);
      if (!p) return;
      if (d.kind === "node") {
        setLiveBoxes((b) => ({
          ...b,
          [d.key]: { ...d.box, x: Math.max(0, Math.min(1 - d.box.w, p.x - d.dx)), y: Math.max(0, p.y - d.dy) },
        }));
      } else {
        setLiveLevels((l) => ({ ...l, [d.id]: Math.max(0, p.y) }));
      }
    },
    onUp: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.kind === "node") {
        const box = liveBoxes[d.key];
        if (!box) return;
        void patch({ op: "moveNode", key: d.key, box }).then((ok) => {
          if (!ok) dropLive(d.key);
        });
        return;
      }
      const y = liveLevels[d.id];
      if (y === undefined) return;
      void patch({ op: "updateLevel", id: d.id, y });
    },
  };

  const rowGroup = panel?.kind === "row" ? nodeByKey.get(panel.nodeKey)?.groups.find((g) => g.partId === panel.partId) : undefined;
  const edge = panel?.kind === "edge" ? view.edges.find((e) => e.id === panel.id) : undefined;
  const conduit = panel?.kind === "conduit" ? view.conduits.find((c) => c.id === panel.id) : undefined;
  const level = panel?.kind === "levelEdit" ? view.levels.find((l) => l.id === panel.id) : undefined;
  const selected: RiserSelection =
    panel?.kind === "row"
      ? { row: { key: panel.nodeKey, partId: panel.partId } }
      : panel?.kind === "device"
        ? { nodeKey: panel.nodeKey }
        : panel?.kind === "edge"
          ? { edgeId: panel.id }
          : panel?.kind === "conduit"
            ? { conduitId: panel.id }
            : panel?.kind === "levelEdit"
              ? { levelId: panel.id }
              : first && first.ref.kind === "space"
                ? { nodeKey: first.ref.spaceId ?? UNASSIGNED_KEY }
                : null;

  return (
    <div>
      <div className="pk-no-print" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {TOOLS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tool === t.key ? "pk-btn-accent" : "pk-btn-outline"}
            style={{ fontSize: 12 }}
            aria-pressed={tool === t.key}
            onClick={() => choose(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="pk-no-print" style={{ fontSize: 12, color: "#8c919c", marginBottom: 10 }}>
        {TOOLS.find((t) => t.key === tool)?.hint}
        {first ? ` — from ${first.label}; now click the other end.` : ""}
      </div>
      {err && (
        <div className="pk-no-print" role="alert" style={{ fontSize: 12.5, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          {err}
        </div>
      )}
      <div className="pk-no-print">
        {panel?.kind === "device" && (
          <DevicePanel
            key={`dev-${panel.nodeKey}`}
            nodeName={nodeByKey.get(panel.nodeKey)?.name || "Unassigned"}
            devices={devices}
            busy={busy}
            onCancel={() => setPanel(null)}
            onAdd={async (partId, qty) => {
              if (await run(() => riserAddDevicesAction(projectId, { optionId, nodeKey: panel.nodeKey, partId, qty }))) setPanel(null);
            }}
          />
        )}
        {panel?.kind === "row" && rowGroup && (
          <RowPanel
            key={`row-${panel.nodeKey}-${rowGroup.partId}-${rowGroup.qty}`}
            nodeName={nodeByKey.get(panel.nodeKey)?.name || "Unassigned"}
            partId={rowGroup.partId}
            desc={rowGroup.desc}
            qty={rowGroup.qty}
            devices={devices}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={(partId, qty) => void saveRow(panel.nodeKey, rowGroup.partId, rowGroup.qty, partId, qty)}
            onDelete={() =>
              mustOk(() => riserRemoveDevicesAction(projectId, { optionId, nodeKey: panel.nodeKey, partId: rowGroup.partId })).then(() => setPanel(null))
            }
          />
        )}
        {panel?.kind === "space" && (
          <SpacePanel sheets={sheets} busy={busy} onCancel={() => choose("select")} onAdd={(name, sheetId) => void addSpace(name, sheetId)} />
        )}
        {panel?.kind === "pair" && (
          <PairPanel
            key={`pair-${JSON.stringify(panel.from)}-${JSON.stringify(panel.to)}`}
            tool={panel.tool}
            kind={connectKind(panel.from, panel.to, placements, calibrations)}
            fromLabel={panel.fromLabel}
            toLabel={panel.toLabel}
            cables={cables}
            busy={busy}
            onCancel={() => setPanel(null)}
            onConnect={(partId, lengthFt) => void connect(panel.from, panel.to, partId, lengthFt)}
            onConduit={async (label) => {
              if (await patch({ op: "addConduit", from: panel.from, to: panel.to, label })) setPanel(null);
            }}
          />
        )}
        {panel?.kind === "level" && (
          <LevelPanel
            key={`lvl-${panel.y}`}
            title="New level line"
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={async (label, elevation) => {
              if (await patch({ op: "addLevel", label, elevation, y: panel.y })) setPanel(null);
            }}
          />
        )}
        {panel?.kind === "levelEdit" && level && (
          <LevelPanel
            key={`lvle-${level.id}-${level.label}-${level.elevation || ""}`}
            title="Level line"
            initialLabel={level.label}
            initialElevation={level.elevation || ""}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={(label, elevation) => void patch({ op: "updateLevel", id: level.id, label, elevation })}
            onDelete={() => mustOk(() => patchRiserAction(projectId, optionId, { op: "removeLevel", id: level.id })).then(() => setPanel(null))}
          />
        )}
        {panel?.kind === "edge" && edge && (
          <EdgePanel
            title={`${edge.desc} · ${edge.lengthFt !== null ? formatMeasure(edge.lengthFt, edge.unit as MeasureUnit) : "unmeasured"}`}
            detail={
              edge.kind === "route"
                ? "A wire run drawn on the plan — deleting it removes it from the plan and the BOM."
                : "A typed-length riser link — deleting it removes its footage from the BOM."
            }
            busy={busy}
            onCancel={() => setPanel(null)}
            onDelete={() =>
              mustOk(() => (edge.kind === "route" ? removeRouteAction(projectId, edge.id) : patchRiserAction(projectId, optionId, { op: "removeLink", id: edge.id }))).then(() =>
                setPanel(null)
              )
            }
          />
        )}
        {panel?.kind === "conduit" && conduit && (
          <ConduitPanel
            key={`cd-${conduit.id}-${conduit.label}`}
            label={conduit.label}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={(label) => void patch({ op: "updateConduit", id: conduit.id, label })}
            onDelete={() => mustOk(() => patchRiserAction(projectId, optionId, { op: "removeConduit", id: conduit.id })).then(() => setPanel(null))}
          />
        )}
      </div>
      <div className="pk-card grid-riser-card" style={{ padding: 12 }}>
        {view.nodes.length === 0 && (
          <div className="pk-no-print" style={{ fontSize: 13, color: "#8c919c", marginBottom: 8 }}>
            No spaces yet — use Space to add one, or draw rooms on the plan.
          </div>
        )}
        <RiserCanvas view={view} boxes={liveBoxes} levelYs={liveLevels} svgRef={svgRef} handlers={handlers} selected={selected} />
      </div>
      <NotesPanel
        notes={view.notes}
        busy={busy}
        inputRef={noteRef}
        onAdd={(text) => patch({ op: "addNote", text })}
        onSave={(id, text) => void patch({ op: "updateNote", id, text })}
        onDelete={(id) => mustOk(() => patchRiserAction(projectId, optionId, { op: "removeNote", id }))}
      />
      {/* The notes print under the riser; the editable panel above does not. */}
      <style>{`.grid-riser-print-notes { display: none; } @media print { .grid-riser-print-notes { display: block; margin-top: 12px; font-size: 11pt; } }`}</style>
      <div className="grid-riser-print-notes">
        <RiserNotes notes={view.notes} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Pass the new props from the riser page** — in `src/app/(app)/design/grid/[id]/riser/page.tsx` replace

```tsx
  const devices = library.filter((p) => !isPerLengthUnit(p.unit)).map((p) => ({ id: p.id, label: label(p) })).sort(byLabel);
```

with

```tsx
  const devices = library.filter((p) => !isPerLengthUnit(p.unit)).map((p) => ({ id: p.id, label: label(p) })).sort(byLabel);
  const cables = library.filter((p) => isPerLengthUnit(p.unit)).map((p) => ({ id: p.id, label: label(p) })).sort(byLabel);
```

and replace

```tsx
        spaces={(project.spaces || []).map((s) => ({ sheetId: s.sheetId, page: s.page }))}
      />
```

with

```tsx
        spaces={(project.spaces || []).map((s) => ({ sheetId: s.sheetId, page: s.page }))}
        cables={cables}
        placements={slice.placements.map((pl) => ({ id: pl.id, sheetId: pl.sheetId, page: pl.page, x: pl.x, y: pl.y }))}
        calibrations={(project.calibrations || []).map((c) => ({ docId: c.docId, page: c.page }))}
      />
```

- [ ] **Step 7: Run the harness to verify it passes**

Run: `npm run test:specs 2>&1 | grep -E "#209|FAIL|ALL PASSED|FAILED"`
Expected: all `PASS`, `ALL PASSED`.

- [ ] **Step 8: Gates**

Run: `npx tsc --noEmit && npx eslint 2>&1 | tail -1`
Expected: tsc silent; `✖ 111 problems (0 errors, 111 warnings)`.
Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5; echo "exit $?"; rm -rf .next`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/components/design/sheet-aspect.ts "src/app/(app)/design/grid/[id]/riser/riser-panels.tsx" \
  "src/app/(app)/design/grid/[id]/riser/riser-editor.tsx" "src/app/(app)/design/grid/[id]/riser/page.tsx" scripts/test-review-and-spec.ts
git -c user.name="SM" commit -m "feat(grid): riser Connect (route or typed link), conduit annotations, level lines, numbered notes (#209)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The drawing set route — T-001 cover, per-system plan sheets, E-501 riser, E-60x schedules, set settings, standard notes

**Files:**
- Create: `src/app/(app)/design/grid/[id]/set/page.tsx`
- Create: `src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx`
- Create: `src/app/(app)/design/grid/[id]/set/set-settings-panel.tsx`
- Rewrite: `src/app/(app)/design/grid/[id]/schedule/page.tsx`
- Create: `src/app/(app)/design/grid/settings/standard-notes-card.tsx`
- Modify: `src/app/(app)/design/grid/settings/page.tsx`
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (toolbar link), `src/app/(app)/design/grid/[id]/riser/page.tsx` (toolbar link)
- Modify: `scripts/smoke-routes.ts`
- Test: `scripts/test-review-and-spec.ts` (append block at EOF)

**Interfaces:**
- Consumes: everything from Tasks 1–6 (`buildSheetList`, `planSheetGroups`, `planContent`, `titleBlockData`, `revisionRows`, `resolveGeneralNotes`, `resolveSheetSize`, `drawingArea`, `printPageCss`, `toggleableSheets`, `SHEET_SIZES`, `fitBox`, `scaleNote`, `buildSchedule`, `scheduleGroups`, `paginateSchedule`, `DrawingSheet`, `RiserCanvas`, `RiserNotes`, `riserViewForOption`, `gridPartsFrom`, `saveDrawingSetAction`, `saveStandardNotesAction`, `settings.gridStandardNotes`, `project.drawingSet`); existing `listSheets`, `findCalibration`, `legendRows`, `symbolLook`, `markerColor`, `isSeedPlaceholder`, `PrintButton`, `SymbolIcon`, `SymbolShape`, `PdfCanvas`, `polygonCentroid`.
- Produces: route `/design/grid/<id>/set?option=<id>&size=b|d`; `PlanSheetFigure` (client, renders `[data-plan-figure][data-ready="1"]` once the plan has its aspect — Task 8's print harness waits on it); `SetSettingsPanel` (client); `StandardNotesCard` (client); `/schedule` now built by `buildSchedule` and lists RiserLinks with the wire runs.

- [ ] **Step 1: Write the failing test** — append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #209 grid drawing set — Task 7: the set route --- */
{
  const gdsClientFiles = [
    "src/app/(app)/design/grid/[id]/riser/riser-editor.tsx",
    "src/app/(app)/design/grid/[id]/riser/riser-panels.tsx",
    "src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx",
    "src/app/(app)/design/grid/[id]/set/set-settings-panel.tsx",
    "src/app/(app)/design/grid/settings/standard-notes-card.tsx",
    "src/components/drawing/riser-canvas.tsx",
    "src/components/drawing/title-block.tsx",
    "src/components/drawing/drawing-sheet.tsx",
    "src/components/design/sheet-aspect.ts",
    "src/lib/design/grid-drawing-set.ts",
    "src/lib/design/grid-riser-doc.ts",
    "src/lib/design/grid-schedule.ts",
  ];
  for (const rel of gdsClientFiles) {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*?from\s+"@\/(?:lib\/stores|db)[^"]*";/gm) || [];
    ok(valueImports.length === 0, `#209 client boundary: ${rel} imports no VALUE from @/lib/stores or @/db`);
  }
  const gdsSetSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/set/page.tsx"), "utf8");
  ok(gdsSetSrc.includes("printPageCss(size)") && gdsSetSrc.includes("buildSheetList(") && gdsSetSrc.includes("riserViewForOption(") && gdsSetSrc.includes("resolveOptionId(project, requestedOption)"),
    "#209 set page: one sheet list, @page from the size table, the saved riser, the same ?option= resolution as riser/schedule");
  ok(gdsSetSrc.includes("<PrintButton") && !gdsSetSrc.includes("#b08d4a\"}") && gdsSetSrc.includes("resolveGeneralNotes(set, settings.gridStandardNotes)"),
    "#209 set page: printed with the existing PrintButton; general notes default to Grid Settings' standard notes");
  const gdsSchedSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/schedule/page.tsx"), "utf8");
  ok(gdsSchedSrc.includes("buildSchedule(") && gdsSchedSrc.includes("riserViewForOption("), "#209 schedule page: shares the set's schedule builder and lists RiserLinks");
  const gdsSmokeSrc = readFileSync(join(process.cwd(), "scripts/smoke-routes.ts"), "utf8");
  ok(gdsSmokeSrc.includes('"/design/grid/GRD-5001/set"') && gdsSmokeSrc.includes('"/design/grid/GRD-5001/set?size=d"'), "#209 smoke: the set route is covered at both sizes");
  const gdsFigSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx"), "utf8");
  ok(gdsFigSrc.includes("data-plan-figure") && gdsFigSrc.includes("scaleNote(cal") && gdsFigSrc.includes("fitBox("), "#209 plan figure: fitted to the drawing area, scale note from the calibration, ready flag for print");
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "ENOENT|FAIL #209" | head -5`
Expected: an `ENOENT` for `set/plan-sheet-figure.tsx` (or `FAIL #209 …` lines).

- [ ] **Step 3: Create `src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { MeasureUnit, Point } from "@/lib/annotations";
import { SymbolShape } from "@/components/design/symbol-shape";
import { polygonCentroid } from "@/lib/design/grid-geometry";
import { fitBox, scaleNote } from "@/lib/design/grid-drawing-set";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

export type FigurePlacement = { id: string; x: number; y: number; iconId: string; color: string; label: string; w: number; h: number; curtain: boolean };
export type FigureRoute = { id: string; points: Point[]; color: string };
export type FigureSpace = { id: string; points: Point[]; name: string; color: string };

/** Overlay units across the page width. The editor draws markers on a
 *  900 px-wide page, so marker sizes scale by U / 900 to keep the plan's
 *  proportions on paper. */
const U = 1000;
const K = U / 900;

/**
 * One system's plan on a drawing-set sheet (#209): the base sheet (image or
 * PDF page) fitted to the drawing area, that system's devices, wires and the
 * page's space outlines on top, and a caption with the printed scale (from
 * the calibration — "NTS" when uncalibrated) and orientation. `data-ready`
 * flips to "1" once the plan's aspect is known; the print check waits on it.
 */
export default function PlanSheetFigure({
  sheet,
  page,
  areaW,
  areaH,
  captionH,
  spaces,
  placements,
  routes,
  cal,
}: {
  sheet: { name: string; mime: string; src: string };
  page: number;
  /** Drawing-area size, inches (grid-drawing-set drawingArea). */
  areaW: number;
  areaH: number;
  /** Caption strip height, inches (scaled with the sheet). */
  captionH: number;
  spaces: FigureSpace[];
  placements: FigurePlacement[];
  routes: FigureRoute[];
  cal: { scale: number; unit: MeasureUnit } | null;
}) {
  const [aspect, setAspect] = useState<number | null>(null);
  const isPdf = sheet.mime === "application/pdf" || sheet.name.toLowerCase().endsWith(".pdf");
  const fit = aspect ? fitBox(areaW, areaH - captionH, aspect) : null;
  const H = aspect ? U * aspect : 0;
  // The functional update returns the same value when nothing changed — the
  // img ref callback runs on every commit (the editor's own idiom).
  const onAspect = (w: number, h: number) => {
    if (!(w > 0) || !(h > 0)) return;
    const next = h / w;
    setAspect((a) => (a !== null && Math.abs(a - next) < 1e-6 ? a : next));
  };
  const pts = (ps: Point[]) => ps.map((p) => `${Math.round(p.x * U * 10) / 10},${Math.round(p.y * H * 10) / 10}`).join(" ");

  return (
    <div data-plan-figure="" data-ready={aspect ? "1" : "0"} style={{ width: `${areaW}in`, height: `${areaH}in`, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <div className="pk-plan-fig" style={{ position: "relative", width: fit ? `${fit.w}in` : "100%", height: fit ? `${fit.h}in` : "100%" }}>
          {isPdf ? (
            <PdfCanvas dataUrl={sheet.src} page={page} zoom={2} onLoaded={() => {}} onSize={onAspect} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sheet.src}
              alt={sheet.name}
              ref={(el) => {
                if (el && el.complete && el.naturalWidth) onAspect(el.naturalWidth, el.naturalHeight);
              }}
              onLoad={(e) => onAspect(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              style={{ display: "block", width: "100%", height: fit ? "100%" : "auto", objectFit: "contain" }}
            />
          )}
          {aspect && (
            <svg viewBox={`0 0 ${U} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
              {spaces.map((s) => {
                const c = polygonCentroid(s.points);
                return (
                  <g key={s.id}>
                    <polygon points={pts(s.points)} fill={s.color} fillOpacity={0.07} stroke={s.color} strokeOpacity={0.6} strokeWidth={1.4 * K} strokeDasharray={`${8 * K} ${5 * K}`} />
                    <text x={c.x * U} y={c.y * H} fontSize={12 * K} fontWeight={700} fill={s.color} textAnchor="middle">
                      {s.name.toUpperCase()}
                    </text>
                  </g>
                );
              })}
              {routes.map((r) => (
                <polyline key={r.id} points={pts(r.points)} fill="none" stroke={r.color} strokeWidth={2 * K} strokeDasharray={`${7 * K} ${4 * K}`} />
              ))}
              {placements.map((pl) => {
                const x = pl.x * U;
                const y = pl.y * H;
                return (
                  <g key={pl.id}>
                    {pl.curtain ? (
                      <rect x={x - 11 * K} y={y - 8 * K} width={22 * K} height={16 * K} rx={2 * K} fill={pl.color} />
                    ) : (
                      <SymbolShape iconId={pl.iconId} x={x} y={y} w={pl.w * K} h={pl.h * K} color={pl.color} />
                    )}
                    <text x={x + (pl.curtain ? 14 : pl.w / 2 + 4) * K} y={y + 3.5 * K} fontSize={9.5 * K} fontWeight={600} fill="#16181d">
                      {pl.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
      <div className="pk-plan-caption" style={{ height: `${captionH}in` }}>
        <span>{`Scale: ${scaleNote(cal, fit?.w ?? 0)}`}</span>
        <span aria-hidden>↑ N</span>
        <span>Plan north / stage as drawn on the source sheet</span>
        <span>{`Source: ${sheet.name}${page > 1 ? `, p. ${page}` : ""}`}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/(app)/design/grid/[id]/set/set-settings-panel.tsx`**

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { SHEET_SIZES, type DrawingSetSettings, type SheetSizeKey } from "@/lib/design/grid-drawing-set";
import { saveDrawingSetAction } from "./actions";

/**
 * Set settings (#209 spec §3), saved on the project: size, drawn/checked by,
 * which sheets print, the set's own general notes (or the standard ones),
 * and labels for revisions that have no note. Never prints.
 */

const INPUT: CSSProperties = {
  border: "1px solid #dfe2e8",
  borderRadius: 7,
  padding: "6px 8px",
  fontSize: 12.5,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
};
const FIELD: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 600, color: "#5b616e" };
const SECTION: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab", margin: "14px 0 6px" };

export default function SetSettingsPanel({
  projectId,
  optionId,
  size,
  set,
  defaultDrawnBy,
  toggles,
  revisions,
  standardNotes,
}: {
  projectId: string;
  optionId: string;
  size: SheetSizeKey;
  set: DrawingSetSettings;
  defaultDrawnBy: string;
  toggles: Array<{ key: string; label: string }>;
  revisions: Array<{ rev: number; letter: string; note: string }>;
  standardNotes: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [drawnBy, setDrawnBy] = useState(set.drawnBy ?? defaultDrawnBy);
  const [checkedBy, setCheckedBy] = useState(set.checkedBy ?? "");
  const [excluded, setExcluded] = useState<string[]>(set.excluded ?? []);
  const [ownNotes, setOwnNotes] = useState(typeof set.generalNotes === "string");
  const [notes, setNotes] = useState(set.generalNotes ?? standardNotes);
  const [labels, setLabels] = useState<Record<string, string>>(set.revisionLabels ?? {});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const base = `/design/grid/${encodeURIComponent(projectId)}/set?option=${encodeURIComponent(optionId)}`;
  const unlabeled = revisions.filter((r) => !r.note.trim()).slice(-12);

  async function save(patch: DrawingSetSettings, opts?: { resetGeneralNotes?: boolean }): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveDrawingSetAction(projectId, patch, opts);
      if (!r.ok) {
        setMsg({ ok: false, text: r.error });
        return false;
      }
      setMsg({ ok: true, text: "Saved" });
      return true;
    } catch {
      setMsg({ ok: false, text: "Couldn't save — please try again." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function chooseSize(next: SheetSizeKey) {
    // Save it on the project, then drop any ?size= so the saved size applies.
    if (await save({ size: next })) {
      router.push(base);
      router.refresh();
    }
  }

  async function saveAll() {
    if (await save({ drawnBy, checkedBy, excluded, revisionLabels: labels, ...(ownNotes ? { generalNotes: notes } : {}) })) router.refresh();
  }

  async function useStandard() {
    if (await save({}, { resetGeneralNotes: true })) {
      setOwnNotes(false);
      setNotes(standardNotes);
      router.refresh();
    }
  }

  return (
    <div className="pk-card pk-no-print" style={{ padding: "12px 16px", marginBottom: 18, maxWidth: 980, marginInline: "auto" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", color: "#16181d" }}
      >
        {`Set settings ${open ? "▾" : "▸"}`}
      </button>
      {open && (
        <div style={{ fontSize: 12.5 }}>
          <div style={SECTION}>Sheet size</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(Object.keys(SHEET_SIZES) as SheetSizeKey[]).map((k) => (
              <button key={k} type="button" className={k === size ? "pk-btn-accent" : "pk-btn-outline"} disabled={busy} onClick={() => void chooseSize(k)}>
                {SHEET_SIZES[k].label}
              </button>
            ))}
          </div>

          <div style={SECTION}>Title block</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={FIELD}>
              Drawn by
              <input style={{ ...INPUT, width: 180 }} value={drawnBy} onChange={(e) => setDrawnBy(e.target.value)} maxLength={60} />
            </label>
            <label style={FIELD}>
              Checked by
              <input style={{ ...INPUT, width: 180 }} value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} maxLength={60} />
            </label>
          </div>

          <div style={SECTION}>Sheets in this set</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "4px 14px" }}>
            {toggles.map((t) => (
              <label key={t.key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!excluded.includes(t.key)}
                  onChange={(e) => setExcluded((x) => (e.target.checked ? x.filter((k) => k !== t.key) : [...x, t.key]))}
                />
                {t.label}
              </label>
            ))}
          </div>

          <div style={SECTION}>General notes (cover sheet)</div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
            <input type="checkbox" checked={ownNotes} onChange={(e) => setOwnNotes(e.target.checked)} />
            This set has its own notes (otherwise the standard notes from Grid Settings print)
          </label>
          <textarea
            style={{ ...INPUT, width: "100%", minHeight: 110 }}
            value={notes}
            disabled={!ownNotes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="One note per line."
          />
          {ownNotes && (
            <button type="button" className="pk-btn-outline" style={{ marginTop: 6 }} disabled={busy} onClick={() => void useStandard()}>
              Use the standard notes
            </button>
          )}

          {unlabeled.length > 0 && (
            <>
              <div style={SECTION}>Revision labels (revisions saved without a note)</div>
              <div style={{ display: "grid", gap: 6 }}>
                {unlabeled.map((r) => (
                  <label key={r.rev} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ width: 48, fontFamily: "var(--font-mono)" }}>{`Rev ${r.letter}`}</span>
                    <input
                      style={{ ...INPUT, flex: 1 }}
                      value={labels[String(r.rev)] || ""}
                      onChange={(e) => setLabels((l) => ({ ...l, [String(r.rev)]: e.target.value }))}
                      maxLength={80}
                      placeholder="Issued for bid, Owner comments…"
                    />
                  </label>
                ))}
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
            <button type="button" className="pk-btn-accent" disabled={busy} onClick={() => void saveAll()}>
              {busy ? "Saving…" : "Save set settings"}
            </button>
            {msg && <span style={{ fontSize: 12, color: msg.ok ? "#1f7a52" : "#b4543a", fontWeight: 600 }}>{msg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/app/(app)/design/grid/[id]/set/page.tsx`**

```tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject, listSheets, type GridPlacement } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getSettings } from "@/lib/settings";
import { findCalibration } from "@/lib/annotations";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { legendRows, symbolContext, symbolLook, type SymbolEntry } from "@/lib/design/grid-icons";
import { markerColor } from "@/lib/design/grid-symbols";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { riserViewForOption } from "@/lib/design/grid-riser-view";
import { buildSchedule, paginateSchedule, scheduleGroups, type ScheduleItem } from "@/lib/design/grid-schedule";
import {
  SHEET_SIZES,
  buildSheetList,
  drawingArea,
  planContent,
  planSheetGroups,
  printPageCss,
  resolveGeneralNotes,
  resolveSheetSize,
  revisionRows,
  titleBlockData,
  toggleableSheets,
  type DrawingSheetDef,
} from "@/lib/design/grid-drawing-set";
import { DrawingSheet } from "@/components/drawing/drawing-sheet";
import { RiserCanvas, RiserNotes } from "@/components/drawing/riser-canvas";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { PrintButton } from "@/components/letter/print-button";
import PlanSheetFigure, { type FigurePlacement } from "./plan-sheet-figure";
import SetSettingsPanel from "./set-settings-panel";

export const metadata = { title: "Drawing set — Quartzite-6" };
export const dynamic = "force-dynamic";

/** Schedule rows per column; two columns per E-60x sheet (the whole sheet,
 *  type included, scales with the size, so this holds at 24×36 too). */
const SCHEDULE_ROWS_PER_COLUMN = 30;

function scheduleRow(it: ScheduleItem, key: number) {
  if (it.kind === "section")
    return (
      <tr key={key}>
        <td colSpan={3} className="pk-dw-sec">{`${it.name}${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  if (it.kind === "wires")
    return (
      <tr key={key}>
        <td colSpan={3} className="pk-dw-sec">{`Wire runs${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  if (it.kind === "row")
    return (
      <tr key={key}>
        <td>{it.qty}</td>
        <td className="pk-dw-mono pk-dw-ellip">{it.code}</td>
        <td className="pk-dw-ellip">{it.desc}</td>
      </tr>
    );
  return (
    <tr key={key}>
      <td className="pk-dw-ellip">{it.length}</td>
      <td className="pk-dw-mono pk-dw-ellip">{it.partId}</td>
      <td className="pk-dw-ellip">{it.run}</td>
    </tr>
  );
}

/**
 * The drawing set (#209, spec 2026-09-25 §3): every sheet is one printed
 * page with the architectural title strip — T-001 cover (project, sheet
 * index, symbol legend, general notes), one plan sheet per system per source
 * page, E-501 riser (the saved riser layout), E-60x equipment schedules (no
 * prices). `?size=b|d` overrides the saved size; `?option=` resolves like
 * the riser and schedule. Printed with the shared PrintButton.
 */
export default async function DrawingSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string; size?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { option: requestedOption, size: requestedSize } = await searchParams;
  const project = await getProject(decodeURIComponent(id));
  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/designs" style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      </div>
    );
  }

  const optionId = resolveOptionId(project, requestedOption);
  const options = project.options!;
  const option = options.find((o) => o.id === optionId)!;
  const slice = optionSlice(project, optionId);
  const spaces = project.spaces || [];
  const cals = project.calibrations || [];
  const base = `/design/grid/${encodeURIComponent(project.id)}`;
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;

  const [sheets, catalog, gridSymbols, settings] = await Promise.all([listSheets(project.id), listCatalog(), listGridSymbols(), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  const symCtx = symbolContext(settings);
  const parts = gridPartsFrom(gridSymbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true });
  const partById = new Map(parts.map((p) => [p.id, p]));
  const set = project.drawingSet || {};
  const size = resolveSheetSize(requestedSize, set.size);
  const k = SHEET_SIZES[size].k;
  const area = drawingArea(size);
  const now = Date.now();

  // E-501 + E-60x
  const view = riserViewForOption({ project, optionId, parts, symCtx });
  const nodeName = new Map(view.nodes.map((n) => [n.key, n.name]));
  const schedule = buildSchedule({
    placements: slice.placements,
    spaces,
    descOf: (pid) => partById.get(pid)?.desc,
    wires: view.edges.map((e) => ({
      id: e.id,
      partId: e.partId,
      fromName: nodeName.get(e.from.key) || "Unassigned",
      toName: nodeName.get(e.to.key) || "Unassigned",
      lengthFt: e.lengthFt,
      unit: e.unit,
    })),
  });
  const schedulePages = paginateSchedule(scheduleGroups(schedule), SCHEDULE_ROWS_PER_COLUMN, 2);

  // The set
  const groups = planSheetGroups({ sheetOrder: project.sheetIds || [], placements: slice.placements, routes: slice.routes, partById });
  const sourceNames = Object.fromEntries(sheets.map((s) => [s.id, s.name]));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const { all, included } = buildSheetList({ planGroups: groups, sourceNames, schedulePages: schedulePages.length, excluded: set.excluded });
  const revRows = revisionRows(project.revisions, set.revisionLabels);
  const notes = resolveGeneralNotes(set, settings.gridStandardNotes);
  const legend = legendRows(
    slice.placements
      .filter((pl) => !pl.curtain)
      .map((pl): SymbolEntry & { id?: string; desc?: string } => partById.get(pl.partId) || { category: pl.category || "", desc: pl.category || pl.partId }),
    symCtx
  );

  const tb = (d: DrawingSheetDef, i: number) =>
    titleBlockData({
      company: { name: settings.companyName, logoDark: settings.logoDark, offices: settings.offices },
      project: { id: project.id, name: project.name, customer: project.customer, siteName: project.siteName, intake: project.intake, createdBy: project.createdBy },
      option: { name: option.name, quoteId: option.quoteId },
      optionCount: options.length,
      revisions: revRows,
      set,
      sheet: { number: d.number, title: d.title, scale: d.kind === "plan" ? "AS NOTED" : "NTS" },
      index: i + 1,
      total: included.length,
      now,
    });

  const figPlacement = (pl: GridPlacement): FigurePlacement => {
    const part = partById.get(pl.partId);
    const look = part ? symbolLook(part, symCtx) : symbolLook({ category: pl.category }, symCtx);
    return {
      id: pl.id,
      x: pl.x,
      y: pl.y,
      iconId: look.iconId,
      color: pl.curtain ? symCtx.colors.Curtains : look.color,
      label: pl.curtain ? pl.curtain.name : part?.desc || part?.sku || (isSeedPlaceholder(pl.partId) ? pl.category || pl.partId : pl.partId),
      w: part?.symbolWidth || 44,
      h: part?.symbolHeight || 30,
      curtain: Boolean(pl.curtain),
    };
  };

  const cover = (
    <div className="pk-dw-cols" style={{ height: "100%" }}>
      <div>
        <div className="pk-dw-block">
          <div style={{ fontSize: `calc(20pt * var(--dw-k))`, fontWeight: 700, lineHeight: 1.15 }}>{project.name}</div>
          {options.length > 1 && <div style={{ fontWeight: 600, marginTop: 4 }}>{`Option: ${option.name}`}</div>}
          {project.customer && <div style={{ marginTop: 4 }}>{project.customer}</div>}
          {(project.siteName || project.intake?.venueName) && <div>{project.siteName || project.intake?.venueName}</div>}
          {project.intake?.address && <div>{project.intake.address}</div>}
          <div className="pk-dw-mono" style={{ marginTop: 4 }}>{`${project.id}${option.quoteId ? ` · ${option.quoteId}` : ""}`}</div>
        </div>
        <div className="pk-dw-block">
          <h2 className="pk-dw-h">General notes</h2>
          {notes.length ? (
            <ol className="pk-dw-notes">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ol>
          ) : (
            <p style={{ margin: 0, color: "#5b616e" }}>—</p>
          )}
        </div>
      </div>
      <div>
        <div className="pk-dw-block">
          <h2 className="pk-dw-h">Sheet index</h2>
          <table className="pk-dw-table">
            <colgroup>
              <col style={{ width: "22%" }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Title</th>
              </tr>
            </thead>
            <tbody>
              {included.map((d) => (
                <tr key={d.key}>
                  <td className="pk-dw-mono">{d.number}</td>
                  <td>{d.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {legend.length > 0 && (
          <div className="pk-dw-block">
            <h2 className="pk-dw-h">Symbol legend</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `calc(4pt * var(--dw-k)) calc(10pt * var(--dw-k))` }}>
              {legend.map((l) => (
                <span key={l.key} style={{ display: "flex", alignItems: "center", gap: `calc(5pt * var(--dw-k))` }}>
                  <SymbolIcon iconId={l.iconId} color={l.color} size={Math.round(14 * k)} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const body = (d: DrawingSheetDef) => {
    if (d.kind === "cover") return cover;
    if (d.kind === "plan" && d.system && d.sheetId && d.page) {
      const src = sheetById.get(d.sheetId);
      if (!src) return <p>That plan sheet is no longer on this design.</p>;
      const c = planContent({ group: { system: d.system, sheetId: d.sheetId, page: d.page }, placements: slice.placements, routes: slice.routes, spaces, partById });
      const cal = findCalibration(cals, d.sheetId, d.page);
      return (
        <PlanSheetFigure
          sheet={{ name: src.name, mime: src.mime, src: src.blobPath ? `/api/grid-sheets/${encodeURIComponent(src.id)}` : src.dataUrl }}
          page={d.page}
          areaW={area.w}
          areaH={area.h}
          captionH={Math.round(0.35 * k * 1000) / 1000}
          spaces={c.spaces.map((s) => ({ id: s.id, points: s.points, name: s.name, color: s.color }))}
          routes={c.routes.map((r) => ({ id: r.id, points: r.points, color: markerColor(partById.get(r.partId)?.category || "Wire") }))}
          placements={c.placements.map(figPlacement)}
          cal={cal ? { scale: cal.scale, unit: cal.unit } : null}
        />
      );
    }
    if (d.kind === "riser") {
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: `calc(8pt * var(--dw-k))` }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            {view.nodes.length ? <RiserCanvas view={view} fill /> : <p style={{ margin: 0, color: "#5b616e" }}>Nothing on the riser yet — add spaces and devices first.</p>}
          </div>
          {view.notes.length > 0 && (
            <div>
              <h2 className="pk-dw-h">Riser notes</h2>
              <RiserNotes notes={view.notes} />
            </div>
          )}
        </div>
      );
    }
    const pageIdx = d.schedulePage ?? 0;
    const cols = schedulePages[pageIdx] || [[]];
    const last = pageIdx === schedulePages.length - 1;
    const empty = schedule.sections.length === 0 && schedule.wires.length === 0;
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {empty ? (
          <p style={{ margin: 0, color: "#5b616e" }}>Nothing on the plans yet.</p>
        ) : (
          <div className="pk-dw-cols" style={{ flex: 1, minHeight: 0, alignItems: "start" }}>
            {[0, 1].map((ci) => (
              <table key={ci} className="pk-dw-table">
                <colgroup>
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "27%" }} />
                  <col />
                </colgroup>
                <tbody>{(cols[ci] || []).map((it, ri) => scheduleRow(it, ri))}</tbody>
              </table>
            ))}
          </div>
        )}
        {last && !empty && (
          <div className="pk-dw-foot">
            {`${schedule.deviceCount} device${schedule.deviceCount === 1 ? "" : "s"} across ${schedule.sections.length} area${schedule.sections.length === 1 ? "" : "s"}`}
            {schedule.wireFeet.map((w) => ` · ${Math.ceil(w.ft)} ${w.unit} ${w.partId}${w.unmeasured ? ` (+${w.unmeasured} unmeasured)` : ""}`).join("")}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pk-content" style={{ maxWidth: "none", padding: "22px 24px 64px" }}>
      <style>{printPageCss(size)}</style>
      <div className="pk-doc-toolbar" style={{ maxWidth: "none", justifyContent: "flex-start", flexWrap: "wrap" }}>
        <Link href={`${base}${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
          ← {project.name}
        </Link>
        <Link href={`${base}/riser${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none", marginLeft: 14 }}>
          Riser editor →
        </Link>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "#8c919c", fontFamily: "var(--font-ui)" }}>
          {`${SHEET_SIZES[size].label} · ${included.length} sheet${included.length === 1 ? "" : "s"}${options.length > 1 ? ` · ${option.name}` : ""}`}
        </span>
        <PrintButton accent={accent} />
      </div>
      <SetSettingsPanel
        projectId={project.id}
        optionId={optionId}
        size={size}
        set={set}
        defaultDrawnBy={project.createdBy}
        toggles={toggleableSheets(all)}
        revisions={revRows.map((r) => ({ rev: r.rev, letter: r.letter, note: (project.revisions || []).find((x) => x.rev === r.rev)?.note || "" }))}
        standardNotes={settings.gridStandardNotes || ""}
      />
      <div className="pk-drawing-set" data-size={size} style={{ "--dw-screen-zoom": String(SHEET_SIZES[size].screenZoom) } as CSSProperties}>
        {included.map((d, i) => (
          <DrawingSheet key={d.key} size={size} titleBlock={tb(d, i)}>
            {body(d)}
          </DrawingSheet>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Rewrite `src/app/(app)/design/grid/[id]/schedule/page.tsx`** (same content and layout; now built by the shared `buildSchedule`, names parts through `gridPartsFrom`, and lists RiserLinks with the wire runs)

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getSettings } from "@/lib/settings";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { symbolContext } from "@/lib/design/grid-icons";
import { riserViewForOption } from "@/lib/design/grid-riser-view";
import { buildSchedule } from "@/lib/design/grid-schedule";
import { PrintButton } from "@/components/letter/print-button";

export const metadata = { title: "Equipment schedule — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Per-space equipment schedule (D113 item 3) — the field document: what
 * hangs in which room, plus the wire runs (routes and typed riser links,
 * #209) between rooms. Deliberately NO prices. Built by the same
 * buildSchedule the drawing set's E-60x sheets use, so the two never differ.
 */
export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { option: requestedOption } = await searchParams;
  const project = await getProject(decodeURIComponent(id));
  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/designs" style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      </div>
    );
  }

  const optionId = resolveOptionId(project, requestedOption);
  const option = project.options!.find((o) => o.id === optionId)!;
  const slice = optionSlice(project, optionId);
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;

  const [catalog, gridSymbols, settings] = await Promise.all([listCatalog(), listGridSymbols(), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  const parts = gridPartsFrom(gridSymbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true });
  const partById = new Map(parts.map((p) => [p.id, p]));
  const spaces = project.spaces || [];
  const view = riserViewForOption({ project, optionId, parts, symCtx: symbolContext(settings) });
  const nodeName = new Map(view.nodes.map((n) => [n.key, n.name]));
  const { sections, wires, deviceCount, wireFeet } = buildSchedule({
    placements: slice.placements,
    spaces,
    descOf: (pid) => partById.get(pid)?.desc,
    wires: view.edges.map((e) => ({
      id: e.id,
      partId: e.partId,
      fromName: nodeName.get(e.from.key) || "Unassigned",
      toName: nodeName.get(e.to.key) || "Unassigned",
      lengthFt: e.lengthFt,
      unit: e.unit,
    })),
  });

  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: "9pt",
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "#666",
    borderBottom: "1.5px solid #1a1a1a",
    padding: "3px 8px 5px 0",
    fontFamily: "var(--font-ui), sans-serif",
  };
  const td: React.CSSProperties = {
    padding: "5px 8px 5px 0",
    borderBottom: "1px solid #e2e2e6",
    fontSize: "11.5pt",
    verticalAlign: "top",
  };
  const sectionHead: React.CSSProperties = {
    fontFamily: "var(--font-ui), sans-serif",
    fontSize: "10.5pt",
    fontWeight: 700,
    letterSpacing: ".04em",
    textTransform: "uppercase",
    color: "#1a1a1a",
    borderBottom: `2px solid ${accent}`,
    display: "inline-block",
    paddingBottom: 1,
    marginBottom: 6,
  };

  return (
    <div className="pk-content" style={{ padding: "26px 30px 64px" }}>
      <div className="pk-doc-toolbar">
        <Link
          href={`/design/grid/${encodeURIComponent(project.id)}${optionQuery}`}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", marginRight: "auto", textDecoration: "none" }}
        >
          ← {project.name}
        </Link>
        <PrintButton accent={accent} />
      </div>

      <div className="pk-doc-page">
        <div style={{ borderBottom: `3px solid ${accent}`, paddingBottom: 10, marginBottom: 18 }}>
          <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "8pt", letterSpacing: ".14em", textTransform: "uppercase", color: "#666" }}>
            {settings.companyName || "Peak Systems Group"} · Equipment schedule
          </div>
          <div style={{ fontSize: "17pt", fontWeight: 700, marginTop: 2 }}>{project.name}{project.options!.length > 1 ? ` · ${option.name}` : ""}</div>
          <div style={{ fontSize: "11pt", color: "#444", marginTop: 1 }}>
            {project.customer || "—"}
            {" · "}
            {new Date(project.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            {" · "}
            {(project.sheetIds || []).length} sheet{(project.sheetIds || []).length === 1 ? "" : "s"} · {project.id}
          </div>
        </div>

        {sections.length === 0 && wires.length === 0 ? (
          <p style={{ color: "#666" }}>Nothing on the plans yet.</p>
        ) : (
          <>
            {sections.map((sec) => (
              <div key={sec.key} style={{ marginBottom: 16 }}>
                <div style={sectionHead}>{sec.name}</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 54 }}>Qty</th>
                      <th style={{ ...th, width: 150 }}>Part</th>
                      <th style={th}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((r) => (
                      <tr key={r.partId}>
                        <td style={td}>{r.qty}</td>
                        <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{r.code || r.partId}</td>
                        <td style={td}>{r.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {wires.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={sectionHead}>Wire runs</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 150 }}>Wire</th>
                      <th style={th}>Run</th>
                      <th style={{ ...th, width: 110 }}>Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wires.map((e) => (
                      <tr key={e.id}>
                        <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{e.partId}</td>
                        <td style={td}>{e.fromName} → {e.toName}</td>
                        <td style={td}>{e.lengthFt !== null ? formatMeasure(e.lengthFt, e.unit as MeasureUnit) : "unmeasured"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ borderTop: "1.5px solid #1a1a1a", marginTop: 20, paddingTop: 8, fontSize: "10.5pt", color: "#444" }}>
              <strong>{deviceCount}</strong> device{deviceCount === 1 ? "" : "s"} across{" "}
              <strong>{sections.length}</strong> area{sections.length === 1 ? "" : "s"}
              {wireFeet.map((w) => (
                <span key={w.partId}>
                  {" · "}
                  <strong>{Math.ceil(w.ft)} {w.unit}</strong> {w.partId}
                  {w.unmeasured > 0 ? ` (+${w.unmeasured} unmeasured)` : ""}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Standard notes card** — create `src/app/(app)/design/grid/settings/standard-notes-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveStandardNotesAction } from "./actions";

/** Grid Settings → "Standard general notes" (#209): printed on every drawing
 *  set's cover (T-001) unless that set has its own notes. One per line. */
export function StandardNotesCard({ value }: { value: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [pending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);
  const dirty = draft.trim() !== saved.trim();

  const save = (text: string) =>
    startTransition(async () => {
      await saveStandardNotesAction(text);
      setDraft(text.trim());
      setSaved(text.trim());
      setJustSaved(true);
      router.refresh();
    });

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Standard general notes</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
          Printed as the numbered General notes on every drawing set&apos;s cover sheet, unless a set has its own.
          One note per line.
        </div>
      </div>
      <div style={{ padding: "14px 18px" }}>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setJustSaved(false);
          }}
          rows={7}
          aria-label="Standard general notes"
          placeholder={"Verify all dimensions in the field.\nConduit, boxes and power by the electrical contractor."}
          style={{ width: "100%", fontFamily: "var(--font-ui)", fontSize: 13, border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 10px" }}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
          <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={() => save(draft)}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="pk-btn-outline" disabled={pending || !saved} onClick={() => save("")}>
            Clear
          </button>
          {justSaved && !dirty && <span style={{ fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}
```

In `src/app/(app)/design/grid/settings/page.tsx`: replace

```tsx
import { LaborHoursCard } from "./labor-hours-card";
```

with

```tsx
import { LaborHoursCard } from "./labor-hours-card";
import { StandardNotesCard } from "./standard-notes-card";
```

and replace

```tsx
      <LaborHoursCard value={laborValue} def={laborDef} />
```

with

```tsx
      <LaborHoursCard value={laborValue} def={laborDef} />

      <StandardNotesCard key={settings.gridStandardNotes ?? ""} value={settings.gridStandardNotes ?? ""} />
```

- [ ] **Step 8: Toolbar links**

In `src/app/(app)/design/grid/[id]/editor.tsx` replace

```tsx
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/schedule?option=${encodeURIComponent(activeOptionId)}`} style={{ ...BTN, textDecoration: "none" }}>
          Schedule →
        </Link>
```

with

```tsx
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/schedule?option=${encodeURIComponent(activeOptionId)}`} style={{ ...BTN, textDecoration: "none" }}>
          Schedule →
        </Link>
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/set?option=${encodeURIComponent(activeOptionId)}`} style={{ ...BTN, textDecoration: "none" }}>
          Drawing set →
        </Link>
```

In `src/app/(app)/design/grid/[id]/riser/page.tsx` replace

```tsx
          ← {project.name}
        </Link>
        <PrintButton accent={accent} />
```

with

```tsx
          ← {project.name}
        </Link>
        <Link href={`${base}/set${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
          Drawing set →
        </Link>
        <PrintButton accent={accent} />
```

- [ ] **Step 9: Smoke routes** — in `scripts/smoke-routes.ts` replace

```ts
  { route: "/design/grid/GRD-5001/schedule?option=opt-does-not-exist", reject: "no longer exists" },
];
```

with

```ts
  { route: "/design/grid/GRD-5001/schedule?option=opt-does-not-exist", reject: "no longer exists" },
  /* The drawing set (#209) at both sheet sizes, and an unknown option. */
  { route: "/design/grid/GRD-5001/set", reject: "no longer exists" },
  { route: "/design/grid/GRD-5001/set?size=d", reject: "no longer exists" },
  { route: "/design/grid/GRD-5001/set?option=opt-does-not-exist&size=b", reject: "no longer exists" },
];
```

- [ ] **Step 10: Run the harness to verify it passes**

Run: `npm run test:specs 2>&1 | grep -E "#209|FAIL|ALL PASSED|FAILED"`
Expected: all `PASS` (including every `#209 client boundary:` line), `ALL PASSED`.

- [ ] **Step 11: Gates**

Run: `npx tsc --noEmit && npx eslint 2>&1 | tail -1`
Expected: tsc silent; `✖ 111 problems (0 errors, 111 warnings)`.
Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5; echo "exit $?"; rm -rf .next`
Expected: exit 0.
Run: `lsof -iTCP -sTCP:LISTEN -n -P | grep -E ":(3000|3111)\b" ; npm run test:smoke 2>&1 | tail -6`
Expected: smoke ends with every route OK including the three `/design/grid/GRD-5001/set…` lines (it boots its own server on a throwaway datadir; if a port is held by another session, stop — don't kill someone else's server).

- [ ] **Step 12: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/set" "src/app/(app)/design/grid/[id]/schedule/page.tsx" \
  "src/app/(app)/design/grid/settings/standard-notes-card.tsx" "src/app/(app)/design/grid/settings/page.tsx" \
  "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/riser/page.tsx" \
  scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git -c user.name="SM" commit -m "feat(grid): drawing set — T-001 cover, per-system plan sheets, E-501 riser, E-60x schedules, title-blocked at 11x17/24x36 (#209)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Print verification (headless print-to-PDF at 11×17 and 24×36) + full gates

**Files:**
- Create: `scripts/fixture-grid-drawing-set.ts` (committed — a reusable scratch-DB fixture)
- Scratch only (never committed): `$GDS/print/print-set.mjs`, `$GDS/print/check.py`, where `GDS=$(mktemp -d)`

**Interfaces:**
- Consumes: `createProject`, `saveGridIntake`, `addSheet`, `setSheetCalibration`, `addSpace`, `addPlacements`, `addRoute`, `addRevision`, `setDrawingSet`, `getProject` (grid-projects); `addRiserLink`, `patchRiser` (grid-riser); `listGridSymbols`; `list as listCatalog`; `isPerLengthUnit`; `seedIfEmpty`, `getDb`. The set page's `.pk-drawing-sheet[data-sheet]` and `[data-plan-figure][data-ready]` attributes (Tasks 2, 7).
- Produces: a printed PDF per size whose page count equals the number of `.pk-drawing-sheet` elements and whose every page is exactly 17×11 in (1224×792 pt) or 36×24 in (2592×1728 pt), each page carrying its sheet number.

This is the one task that runs a dev server, and only on a scratch datadir (memory: "Exercising POST routes safely", "Worktree dev-server browser traps"): `env -u DATABASE_URL`, `PGLITE_PATH` in a `mktemp -d` dir, `localhost` (never `127.0.0.1`), service workers blocked, and the server is stopped before `test:smoke`. The fixture script must exit before the server starts — PGlite is single-process.

- [ ] **Step 1: Create `scripts/fixture-grid-drawing-set.ts`**

```ts
/**
 * Drawing-set print fixture (#209). Seeds ONE demo Grid project — a plan
 * sheet, two spaces, devices in several systems, a wire route, a RiserLink,
 * a level line, a conduit, riser notes, two revisions and set settings —
 * into a SCRATCH PGlite, prints the project id, and exits.
 *
 *   D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH=$D/pglite npx tsx scripts/fixture-grid-drawing-set.ts
 *
 * Refuses to run without PGLITE_PATH, or against any .data/ directory (the
 * real dev book lives there). PGlite is single-process: this must exit
 * before a dev server opens the same datadir.
 */
import { getDb } from "@/db";
import { seedIfEmpty } from "@/db/seed-data";
import { isPerLengthUnit } from "@/lib/design/grid-bom";
import type { RiserOp } from "@/lib/design/grid-riser-doc";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import {
  addPlacements,
  addRevision,
  addRoute,
  addSheet,
  addSpace,
  createProject,
  getProject,
  saveGridIntake,
  setDrawingSet,
  setSheetCalibration,
} from "@/lib/stores/grid-projects";
import { addRiserLink, patchRiser } from "@/lib/stores/grid-riser";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1700" height="1100" viewBox="0 0 1700 1100">' +
  '<rect x="40" y="40" width="1620" height="1020" fill="#fff" stroke="#222" stroke-width="4"/>' +
  '<rect x="300" y="120" width="1100" height="380" fill="none" stroke="#555" stroke-width="3"/>' +
  '<text x="850" y="320" font-size="48" text-anchor="middle" fill="#777">STAGE</text>' +
  '<rect x="200" y="560" width="1300" height="440" fill="none" stroke="#555" stroke-width="3"/>' +
  '<text x="850" y="800" font-size="48" text-anchor="middle" fill="#777">HOUSE</text></svg>';

async function main() {
  const dir = process.env.PGLITE_PATH || "";
  if (!dir || /(^|\/)\.data(\/|$)/.test(dir)) throw new Error("Refusing to run: set PGLITE_PATH to a scratch directory (never .data/).");
  await seedIfEmpty(await getDb());

  const by = "Fixture";
  const symbols = (await listGridSymbols(by)).filter((s) => s.kind !== "assembly");
  const catalog = await listCatalog();
  const scoped = (scope: string) => symbols.find((s) => s.scope === scope);
  const light = scoped("Lighting") || symbols[0];
  const audio = scoped("Audio") || symbols[1] || symbols[0];
  const video = scoped("Video") || audio;
  if (!light || !audio || !video) throw new Error("The seeded Grid library is empty.");
  // Grid-library ids equal their pricing row's id (grid-catalog fromPricing).
  const cableId = catalog.find((p) => isPerLengthUnit(p.unit))?.id || "FIXTURE-CABLE";

  const p0 = await createProject({ name: "Drawing set fixture", customer: "Lakefront Performing Arts Center", customerId: null, by });
  await saveGridIntake(p0.id, {
    complete: true,
    measurementBased: false,
    mode: "manual",
    venueName: "Main Stage",
    locationName: "",
    address: "12 Shore Dr, Appleton, WI",
    notes: "",
  });
  const sheet = await addSheet(p0.id, { name: "Main floor", mime: "image/svg+xml", dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`, by });
  if (!sheet) throw new Error("addSheet failed");
  await setSheetCalibration(p0.id, { docId: sheet.id, page: 1, scale: 85, unit: "ft", refLength: 85, by, at: Date.now() });
  await addSpace(p0.id, { sheetId: sheet.id, page: 1, name: "Stage", points: [{ x: 0.176, y: 0.109 }, { x: 0.824, y: 0.109 }, { x: 0.824, y: 0.455 }, { x: 0.176, y: 0.455 }], by });
  await addSpace(p0.id, { sheetId: sheet.id, page: 1, name: "House", points: [{ x: 0.118, y: 0.509 }, { x: 0.882, y: 0.509 }, { x: 0.882, y: 0.909 }, { x: 0.118, y: 0.909 }], by });

  let p = await getProject(p0.id);
  if (!p) throw new Error("project vanished");
  const opt = p.options![0].id;
  await addPlacements(p0.id, {
    sheetId: sheet.id,
    page: 1,
    optionId: opt,
    by,
    items: [
      { x: 0.3, y: 0.2, partId: light.id },
      { x: 0.5, y: 0.2, partId: light.id },
      { x: 0.7, y: 0.2, partId: light.id },
      { x: 0.25, y: 0.6, partId: audio.id },
      { x: 0.75, y: 0.6, partId: audio.id },
      { x: 0.5, y: 0.85, partId: video.id },
    ],
  });
  p = (await getProject(p0.id))!;
  const [l1, l2, , a1, , v1] = p.placements;
  await addRoute(p0.id, {
    sheetId: sheet.id,
    page: 1,
    partId: cableId,
    points: [{ x: l1.x, y: l1.y }, { x: l2.x, y: l2.y }],
    aspect: 1100 / 1700,
    optionId: opt,
    by,
    fromPlacementId: l1.id,
    toPlacementId: l2.id,
  });
  const link = await addRiserLink(p0.id, { optionId: opt, from: { kind: "placement", placementId: a1.id }, to: { kind: "placement", placementId: v1.id }, partId: cableId, lengthFt: 120, by });
  if (!link.ok) throw new Error(`addRiserLink: ${link.reason}`);
  const ops: RiserOp[] = [
    { op: "addLevel", label: "Stage level", elevation: "EL 100", y: 0.72 },
    { op: "addConduit", from: { kind: "space", spaceId: p.spaces![0].id }, to: { kind: "space", spaceId: p.spaces![1].id }, label: '1" EMT (by EC)' },
    { op: "addNote", text: "Verify all dimensions in the field." },
    { op: "addNote", text: "Conduit and back boxes by the electrical contractor." },
  ];
  for (const op of ops) {
    const r = await patchRiser(p0.id, opt, op);
    if (!r.ok) throw new Error(`patchRiser ${op.op}: ${r.reason}`);
  }
  await addRevision(p0.id, { by, note: "Schematic design" });
  await addRevision(p0.id, { by, reason: "quote", note: "" });
  await setDrawingSet(p0.id, { drawnBy: "SM", checkedBy: "JC", generalNotes: "Verify in field.\nAll work per NEC." });
  console.log(p0.id);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Seed the scratch DB (the script must exit before anything else opens it)**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/grid-estimate-drawings && export PATH=$HOME/.local/node/bin:$PATH
export GDS=$(mktemp -d) && echo "$GDS"
GID=$(env -u DATABASE_URL PGLITE_PATH=$GDS/pglite npx tsx scripts/fixture-grid-drawing-set.ts | tail -1) && echo "$GID"
ps aux | grep -c "[f]ixture-grid-drawing-set"    # must print 0
```

Expected: a `GRD-5xxx` id; the process count is `0`.

- [ ] **Step 3: Start the scratch print server** (port 3127; check nobody owns it first)

```bash
lsof -iTCP:3127 -sTCP:LISTEN -n -P    # must print nothing — pick another port if it does
env -u DATABASE_URL PGLITE_PATH=$GDS/pglite NEXT_TELEMETRY_DISABLED=1 node node_modules/.bin/next dev -p 3127 > $GDS/dev.log 2>&1 &
node -e 'const t=Date.now();(async function w(){try{const r=await fetch("http://localhost:3127/login");if(r.status<500){console.log("up");process.exit(0)}}catch{}if(Date.now()-t>240000){console.log("timeout");process.exit(1)}setTimeout(w,2000)})()'
```

Expected: `up`.

- [ ] **Step 4: Write the print harness** — `mkdir -p $GDS/print && cd $GDS/print && npm init -y >/dev/null && npm i playwright-core@1 --no-audit --no-fund` (scratch dir only — never a project dependency), then create `$GDS/print/print-set.mjs`:

```js
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const [base, id, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const ctx = await browser.newContext({ serviceWorkers: "block" });
const { csrfToken } = await (await ctx.request.get(`${base}/api/auth/csrf`)).json();
await ctx.request.post(`${base}/api/auth/callback/dev-login`, { form: { csrfToken, userId: "u1" } });
const page = await ctx.newPage();
const out = {};
for (const size of ["b", "d"]) {
  await page.goto(`${base}/design/grid/${encodeURIComponent(id)}/set?size=${size}`, { waitUntil: "networkidle", timeout: 240000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll("[data-plan-figure]")].every((f) => f.getAttribute("data-ready") === "1"),
    null,
    { timeout: 120000 }
  );
  const numbers = await page.$$eval(".pk-drawing-sheet", (els) => els.map((e) => e.getAttribute("data-sheet")));
  const figures = await page.locator("[data-plan-figure]").count();
  await page.emulateMedia({ media: "print" });
  writeFileSync(`${outDir}/set-${size}.pdf`, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  await page.emulateMedia({ media: "screen" });
  out[size] = { numbers, figures };
}
writeFileSync(`${outDir}/sheets.json`, JSON.stringify(out));
console.log(JSON.stringify(out));
await browser.close();
```

and `$GDS/print/check.py`:

```python
import json, sys
from pypdf import PdfReader

out = sys.argv[1]
sheets = json.load(open(f"{out}/sheets.json"))
want = {"b": (1224, 792), "d": (2592, 1728)}
bad = 0
for size, info in sheets.items():
    r = PdfReader(f"{out}/set-{size}.pdf")
    nums = info["numbers"]
    print(f"{size}: {len(r.pages)} pages, {len(nums)} sheets {nums}, {info['figures']} plan figures")
    if len(r.pages) != len(nums):
        print("  FAIL page count != sheet count"); bad += 1
    if len(nums) < 5 or nums[0] != "T-001" or "E-501" not in nums or not any(n.startswith("E-60") for n in nums):
        print("  FAIL expected T-001, ≥1 plan sheet, E-501 and E-60x"); bad += 1
    for i, pg in enumerate(r.pages):
        w, h = float(pg.mediabox.width), float(pg.mediabox.height)
        if abs(w - want[size][0]) > 1 or abs(h - want[size][1]) > 1:
            print(f"  FAIL page {i + 1} is {w:.0f}x{h:.0f} pt"); bad += 1
        text = pg.extract_text() or ""
        if i < len(nums) and nums[i] not in text:
            print(f"  FAIL page {i + 1} does not carry sheet number {nums[i]}"); bad += 1
print("PRINT OK" if not bad else f"PRINT FAILED ({bad})")
sys.exit(1 if bad else 0)
```

- [ ] **Step 5: Print and check both sizes**

```bash
cd $GDS/print && node print-set.mjs http://localhost:3127 "$GID" "$GDS/print"
uv run --with pypdf python check.py "$GDS/print"
```

Expected: `b: N pages, N sheets [...]` and `d: N pages, N sheets [...]` with the same N (≥ 5: T-001, the plan sheets, E-501, E-601), then `PRINT OK`. Open `$GDS/print/set-b.pdf` with the Read tool (whole file) and eyeball: title strip on the right of every page, the plan fitted with a scale caption (`1" = …`), the riser with level line, conduit and link, the schedule table. If a page count is off by one, a sheet overflowed its page — fix the CSS (`.pk-drawing-sheet` height/overflow, `break-after`) rather than the check.

- [ ] **Step 6: Stop the print server and confirm it is gone**

```bash
pkill -f "next dev -p 3127"; lsof -iTCP:3127 -sTCP:LISTEN -n -P    # must print nothing
```

- [ ] **Step 7: Full gates**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/grid-estimate-drawings
npx tsc --noEmit
npx eslint 2>&1 | tail -1                     # ✖ 111 problems (0 errors, 111 warnings)
npm run test:specs 2>&1 | tail -1             # ALL PASSED
D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH=$D npx tsx scripts/test-review-regressions.ts 2>&1 | tail -1   # review regression checks passed
npm run test:smoke 2>&1 | tail -4             # every route OK, incl. the three /set routes
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -3; rm -rf .next
git status --short                            # only the fixture script is new; next-env.d.ts/.env.local stay ignored
```

- [ ] **Step 8: Commit**

```bash
git add scripts/fixture-grid-drawing-set.ts
git -c user.name="SM" commit -m "test(grid): drawing-set print fixture — verified 11x17 and 24x36 page count and size (#209)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Report the real numbers (pages per size, sheet list, gate outputs) in the task summary.

---

### Task 9: Docs — DECISIONS (D287…D293) and PUNCHLIST (#209)

**Files:**
- Modify: `DECISIONS.md` (append at end)
- Modify: `PUNCHLIST.md` (append at end)

**Interfaces:** none (placeholders `#209`, `D287…D293`; the lead renumbers at merge).

- [ ] **Step 1: Append to `DECISIONS.md`**

```markdown

## D287. The drawing set is a browser-print page with one size table (#209, 2026-09-25)

`/design/grid/<id>/set` renders every sheet as an exact-size `.pk-drawing-sheet` (11×17 ANSI B default, 24×36 ARCH D
per set) and prints through the shared `PrintButton`. `lib/design/grid-drawing-set.ts` is the only place sheet
geometry lives: `DrawingSheet` turns it into CSS variables, the page turns it into `@page`, and the plan figure fits
the plan to the same drawing area. 24×36 is the 11×17 layout scaled by 36/17 (borders, strip and type); the paper
aspect differs slightly, so the drawing area absorbs it. `?size=` beats the saved size, which beats 11×17.

## D288. Plan sheets: one per system per source page, plus G-101 for unscoped devices (#209, 2026-09-25)

Systems map onto the Scope panel's own taxonomy (`DRAWING_SYSTEMS` in grid-scopes.ts): L = Lighting, A = Audio,
V = Video, R = Rigging + Curtains. A system gets a sheet only where it has devices or wires. A wire belongs to the
system of the device it was drawn from (else to); only a free wire falls back to its cable's own scope. Two
additions the spec didn't list: devices and free wires with no scope print on a **G-101 General devices plan**
rather than vanishing, and a system that spans several plan sheets/pages gets L-101, L-102 … titled with the source
sheet. Sheet numbers are assigned before exclusions, so excluding L-101 never renumbers L-102; the cover index and
"n of N" count only included sheets; all E-60x pages toggle together. "In scope" means "has placements" — the Scope
panel's system toggles do not hide placed equipment from the drawings.

## D289. Revision table, labels and the printed date (#209, 2026-09-25)

Every Grid revision is lettered A, B, C … (then AA …) in cut order, including quote and restore bookkeeping
revisions — they are real snapshots. The label is the revision's note, else a per-set label typed on the set page,
else a plain reason ("Issued with quote"). The strip prints the newest six with "+n earlier". The title-block date is
the print date; "drawn by" defaults to the project's creator, "checked by" to blank. The company block uses the
quote-default office's address and phone; Settings has no website field, so none prints.

## D290. The riser document is per option, layout-only for derived things (#209, 2026-09-25)

`GridProject.riser[optionId]` stores node boxes, level lines, conduits, notes and RiserLinks; devices, spaces and
routes stay derived (D112). Nothing is written on first open — the auto layout is recomputed and saved positions win
(`mergeLayout`); a new space takes the next free slot. Every space is a node, even an empty one, so devices can be
added to it. Revisions snapshot and restore the whole riser map; option copy re-points device ends at the copied
placements; option removal drops that option's document; deleting a device or space prunes the links/conduits that
ended on it (and a space's saved box).

## D291. + Device, qty edits and Space write ordinary plan geometry (#209, 2026-09-25)

+ Device spreads new placements on a 0.02 grid spiralling out from the space centroid, inside the polygon and clear
of existing devices; Unassigned devices go along the first sheet's lower margin outside every space. Lowering a
row's qty removes the newest placements in that space; raising it adds more the same way; the part swap re-points
every placement in the row. The Space tool adds a 0.10 × 0.07 rectangle on the first-chosen sheet's lower margin
through the existing `addSpaceAction`; reshaping happens on the plan.

## D292. Connect: a measured route when possible, else a typed RiserLink; conduit is never priced (#209, 2026-09-25)

Two different devices on the same sheet and page, with that page calibrated → a straight `GridRoute` through the
existing `addRouteAction` (port validation, calibration gate, measured length; the page aspect is measured in the
browser the way the editor does). Anything else — cross-sheet, a space end, or an uncalibrated page — stores a
`RiserLink` with a typed length (≤ 5,000 ft, kept to 0.1 ft). A device row's end is its oldest placement. RiserLink
footage is summed with routes of the same part before rounding up (`routeLines` 4th argument) on both the editor's
live BOM and the draft quote, and never carries a connectionType. Conduits are annotations only and never reach
the BOM.

## D293. One PartLite builder and one schedule builder (#209, 2026-09-25)

`gridPartsFrom` (lib/design/grid-parts.ts) replaces the inline builders in the plan page and the riser page; the
riser, set and schedule use its catalog fallback so pre-library placements still resolve. `/schedule` and the E-60x
sheets share `buildSchedule`; as a side effect `/schedule` now names Grid-library parts (it used to look up the
pricing catalog only and printed "(no longer in the catalog)" for them) and lists RiserLinks with the wire runs.
E-60x paginate at 30 rows per column, two columns per sheet, repeating a section head marked "(cont.)".
```

- [ ] **Step 2: Append to `PUNCHLIST.md`**

```markdown

## 209. The Grid — professional drawing set (title blocks) + editable riser — DONE 2026-09-25 (D287…D293)

**Reported:** 2026-09-25 (Jeff, brainstorm with mockups): "talk through making the outputs look more professional …
adding title blocks, and adding the ability to add via the riser." Spec:
`docs/superpowers/specs/2026-09-25-grid-drawing-set-and-riser-editor-design.md`; plan:
`docs/superpowers/plans/2026-09-25-grid-drawing-set-and-riser.md`.

**Done.**
- **Drawing set** at `/design/grid/<id>/set` (editor and riser toolbars link to it): T-001 cover (project, sheet
  index, symbol legend, general notes), one plan sheet per system per source page (L/A/V/R, plus G for unscoped
  devices) with a scale note from the calibration, E-501 riser, E-60x equipment schedules — every sheet with the
  architectural right-side title strip (logo, company, project, option, revision table, drawn/checked/scale/date,
  quote, sheet title + number + n of N). 11×17 default, 24×36 per set; set settings (size, drawn/checked, include/
  exclude sheets, general notes, revision labels) saved on the project; "Standard general notes" in Grid Settings.
- **Editable riser**: saved layout (drag nodes), + Device (lands on the plan inside the space), edit/delete device
  rows (edits the placements), Space, Connect (a measured wire route on the plan, or a typed-length RiserLink that
  prices like a route), Conduit (annotation, never priced), Level lines (drag), numbered notes. Revisions and option
  copies carry the riser document.
- Verified: headless print-to-PDF at both sizes — page count equals sheet count, every page exactly 17×11 / 36×24 in.

**Still open.** Levels (upper/lower plan sheets), details/elevations sheets and DWG export stay out of scope. A
real-project browser check on a scratch DB copy is the lead's call (never against `.data/pglite`).
```

- [ ] **Step 3: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md
git -c user.name="SM" commit -m "docs: drawing set + editable riser (#209, D287…D293)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (run against the spec, 2026-09-25)

**Spec coverage.**
- §2.1 title block A → Task 2 (`TitleBlock`, CSS) + Task 1 (`titleBlockData`). §2.2 sizes → Task 1 (`SHEET_SIZES`, `drawingArea`, `printPageCss`) + Task 7 (size switch) + Task 8 (PDF sizes). §2.3 sheet set → Task 1 (`buildSheetList`) + Task 7. §2.4 riser editor → Tasks 3–6.
- §3 route/`?option=`/`PrintButton` → Task 7. Revisions on sheets (letters, labels, latest letter, Preliminary) → Task 1 + Task 7 panel labels. T-001 cover (index, legend of used symbols, general notes + Grid Settings default) → Task 7 (+ `saveStandardNotesAction` Task 4). Plan sheets per system with scale/NTS + orientation note → Task 1 (`planSheetGroups`, `planContent`, `scaleNote`) + Task 7 (`PlanSheetFigure`). E-501 → Task 7 (`RiserCanvas fill`). E-60x paginated → Task 1 (`paginateSchedule`) + Task 7. Set settings → Task 4 (store/action) + Task 7 (panel).
- §4 saved riser document shape → Task 3 types + Task 4 persistence. Auto layout seeds, saved wins, new spaces slotted → `mergeLayout` (Task 3). + Device inside the space / Unassigned margin → Task 3 geometry, Task 4 store, Task 5 UI. Edit/delete rows → Task 4 store + Task 5 UI. Connect route vs RiserLink, both edge kinds drawn, link in BOM/quote → Tasks 3, 4, 6. Space → Task 5. Level line + drag → Task 6. Conduit never priced → Task 3 test + Task 6. Note → Task 6. Print → riser page `PrintButton` (Task 5) + E-501. Permissions + patchDoc + revisions snapshot riser → Task 4.
- §5 tests: title-block data + Preliminary (T1), sheet list/index (T1), per-system filtering (T1), layout merge (T3), + Device inside polygon (T3 pure, T4 DB), qty add/remove (T4), Connect route vs link (T3), RiserLink in BOM (T3), conduit excluded (T3), revision snapshot/restore incl. riser (T4), print at B and D (T8), gates (every task, full in T8).

**Placeholder scan.** No TBD/TODO; every code step carries complete code; `#209` / `D287…D293` are the mandated numbering placeholders.

**Type consistency.** Checked across tasks: `RiserDoc`/`RiserOp`/`EndRef`/`RiserLink` (T3) used unchanged by T4–T8; `routeLines(routes, parts, cals, links)` (T3) matches T4 callers; `copyOptionMembers(...).idMap` (T3) matches T4 `addOption`; `titleBlockData`/`TitleBlockData` (T1) match T2/T7; `buildSchedule`/`scheduleGroups`/`paginateSchedule` (T1) match T7 and the schedule page; `riserViewForOption` (T5) matches T7; `RiserEditor` props grow in T6 and the page passes them; `saveDrawingSetAction(projectId, patch, opts)` (T4) matches T7's panel; `setDrawingSet(projectId, patch, { resetGeneralNotes })` (T4) matches T8's fixture.
