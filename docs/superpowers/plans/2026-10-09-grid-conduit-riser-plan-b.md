# Grid conduit riser — Plan B (wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the #321 conduit riser engine (Plan A, `src/lib/design/conduit-riser/`) in front of Jeff: Bray IDs, riser tag fields, levels, settings, the riser editor page, the plan prompt, pricing, the E-502 sheet and DXF download.

**Architecture:** The engine is pure and done. This plan adds data fields (catalog part, placement, project), stores and server actions that call the engine's pure ops inside one `patchDoc`, one server loader that turns a Grid project into the engine's plain input (`input.ts`), and UI on top. Nothing in the engine changes except where a task says so.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching routing), TypeScript, doc-store JSONB documents (`patchDoc`, `getBlob`/`setBlob`), the spec harness `scripts/test-review-and-spec.ts`.

**Spec:** `docs/superpowers/specs/2026-10-09-grid-conduit-riser-design.md` (read it whole, including "Deviations found while building the engine"). Engine: `src/lib/design/conduit-riser/*.ts` (read `input.ts`, `model.ts`, `suggest.ts`, `derive.ts`, `pricing.ts` before any task).

## Global Constraints

- Worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/conduit-riser`, branch `feat/321-conduit-riser`. Never `git stash`; commit instead. Never touch `.data/pglite` (the dev DB) — the harness makes its own temp DB.
- No migration: every new field lives in an existing JSONB document or a settings blob.
- Grid actions gate with `await requireUser()` (the Grid's convention); admin settings with `requirePerm("manage_users")`.
- Timestamps epoch-ms. Ids: conduit runs `cr-`, details `dt-`, stubs `st-`, notes `nt-`, levels `lvl-` — 12 hex chars from `crypto.randomUUID()`.
- Curtain placements never get riser tag fields (refuse on write, ignore on read).
- An estimate-owned option (`option.estimateOwned === true`, #314) prices nothing from the riser and hides the pricing controls.
- Every task: add harness checks to the `#321` area at the END of `scripts/test-review-and-spec.ts` (a new `async function conduitRiser321B<N>Checks()` per task, chained after `conduitRiser321Checks()` in the `.then` chain near line 11530), then run the four gates and report real numbers:
  1. `node_modules/.bin/tsc --noEmit -p .` → 0 errors
  2. `npm run -s test:specs` → `ALL PASSED`; PASS count = previous count + this task's new checks (baseline after the main merge: **14,665**)
  3. `node_modules/.bin/eslint <changed files>` → 0 errors (don't run `npm run lint` — it crashes on the harness)
  4. `npm run -s test:smoke` only in Task 6 and Task 9 (routes added); start no dev server against `.data/pglite`.
- Commit per task with message `feat(grid): #321 <task title>` and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Customer-facing copy: plain sentences, no jargon. Match surrounding code style (comment density, naming).

## File map

| Area | Files |
|---|---|
| Bray IDs | `src/lib/stores/catalog.ts` (CatalogPart), `src/app/(app)/catalog/part-form.ts`, `src/app/(app)/catalog/page.tsx` (part editor), `src/lib/design/grid-parts.ts`, `src/lib/design/grid-bom.ts` (PartLite), `src/lib/design/designators.ts`, `src/lib/design/designators-server.ts`, `src/lib/settings.ts`, `src/app/(app)/design/grid/settings/*` |
| Tag fields | `src/lib/stores/grid-projects.ts`, `src/app/(app)/design/grid/[id]/actions.ts`, `src/lib/design/grid-undo.ts`, `src/app/(app)/design/grid/[id]/use-grid-editor.ts`, `src/lib/design/grid-device-rows.ts`, `workspace/devices-table.tsx`, `workspace/property-editor.tsx`, `src/app/(app)/catalog/tag-defaults-field.tsx` (new) |
| Levels | `grid-projects.ts`, `actions.ts`, `spaces-panel.tsx`, `workspace/sheet-tabs.tsx` |
| Settings | `src/lib/catalog-connect.ts`, `design/grid/settings/wire-types-card.tsx`, `src/lib/riser-box-types.ts` + `src/lib/stores/riser-box-types.ts` (new), `src/lib/conduit-sizes.ts` + `src/lib/stores/conduit-sizes.ts` (new), `src/app/(app)/estimating-rules/conduit-sizes/*` (new), `src/lib/catalog-rename/rewrite.ts` |
| Riser store + loader | `src/lib/stores/grid-conduit-riser.ts` (new), `src/lib/design/conduit-riser-server.ts` (new), `grid-projects.ts`, `src/lib/design/grid-options.ts`, `src/lib/design/grid-riser-doc.ts` |
| Page + editor | `src/app/(app)/design/grid/[id]/conduit-riser/{page.tsx,actions.ts,conduit-riser-editor.tsx,panels.tsx}` (new), `workspace/outputs-menu.tsx` |
| Plan prompt | `use-grid-editor.ts`, `actions.ts` (`addRouteAction` returns the route id), `workspace/riser-prompt.tsx` (new) |
| Pricing | `src/lib/design/grid-quote.ts`, `src/lib/design/grid-bom-groups.ts`, `use-grid-editor.ts`, `workspace/bom-panel.tsx` |
| Sheet + DXF | `src/lib/design/grid-drawing-set.ts`, `src/lib/design/drawing-set-data.ts`, `src/components/drawing/drawing-set-sheets.tsx`, `src/app/api/grid/[id]/conduit-riser/dxf/route.ts` (new) |

---

### Task 1: Bray IDs — per-part designator code + two-digit numbering

**Files:** modify `src/lib/stores/catalog.ts`, `src/app/(app)/catalog/part-form.ts`, `src/app/(app)/catalog/page.tsx`, `src/lib/design/grid-bom.ts`, `src/lib/design/grid-parts.ts`, `src/lib/design/designators.ts`, `src/lib/design/designators-server.ts`, `src/lib/settings.ts`, `src/app/(app)/design/grid/settings/{page.tsx,actions.ts}` + a new `designator-digits-card.tsx`; every caller of `assignMissing`/`renumber`/`designatorList`/`formatDesignator` that needs digits.

**Interfaces:**
- Produces: `CatalogPart.designatorCode?: string`; `PartLite.designatorCode?: string`; `CodePart.designatorCode?: string`; `AppSettingsData.designatorDigits?: 1 | 2`; `designatorDigitsOf(settings): 1 | 2` (default **2**); `formatDesignatorNumber(n: number, digits: 1 | 2): string` (`7 → "07"`, `123 → "123"`); `ReadingCtx` gains `digits?: 1 | 2` (absent = 1, so pure callers that don't pass it keep today's output).
- Consumes: `cleanTypeCode` (`device-types.ts:141`) to clean the part code.

Steps:
- [ ] Add `designatorCode?: string` to `CatalogPart` (written only through `mergeUpsert`); parse it in `optionalPartFields` (`part-form.ts:47`) with `cleanTypeCode` (blank clears it); add a "Designator code" text input (placeholder "From device type") to the part editor next to the existing optional fields (`page.tsx` ~1008), `maxLength={6}`.
- [ ] Copy it through `gridPartsFrom` in BOTH branches (symbol branch `grid-parts.ts:47–82`, catalog-fallback `:88–103`) and add it to `PartLite` and `CodePart`.
- [ ] `codeOfPlacement` (`designators.ts:319`): `cleanTypeCode(part?.designatorCode)` wins first, then the existing chain.
- [ ] Digits: add `digits?: 1 | 2` to `ReadingCtx`; route every `` `${code}-${n}` `` (assignMissing :166, renumber :214, designatorList :289, formatDesignator range :96) through `formatDesignatorNumber`. `formatDesignator(stored, qty, digits?)` pads the range end the same way (`LX-01–24`).
- [ ] `designatorDigits` in `AppSettingsData` (`settings.ts`), `designatorDigitsOf(s)` returns `s.designatorDigits === 1 ? 1 : 2`. Every server builder of a `ReadingCtx` (`readingCtxOf` and the store call sites listed in `designators-server.ts` / `grid-projects.ts`) sets `digits` from settings — `designatorContext` already loads settings; expose `digits` on its return and pass it into `stampNewDesignators`/`stampDesignators`/`renumber`.
- [ ] Grid Settings card "Designator numbers": radio "Two digits (CRO-01)" / "One digit (CRO-1)", saved by `saveDesignatorDigitsAction` (`requirePerm("manage_users")`, `setSettings`, `revalidatePath("/design/grid", "layout")`). Copy under it: "Changing this never rewrites existing designators — use Renumber in the Devices tab."
- [ ] Harness `conduitRiser321B1Checks`: part code beats device-type code (`codeOfPlacement`); blank/invalid part code falls through; `formatDesignatorNumber(7,2)==="07"`, `(123,2)==="123"`, `(7,1)==="7"`; `assignMissing` with `digits:2` issues `CRO-01, CRO-02`; a lot of 24 reads `LX-01–24`; `parseDesignator("CRO-01")` → n 1 and `CRO-1`/`CRO-01` are duplicates; `optionalPartFields` cleans `" cro "` → `"CRO"`; `gridPartsFrom` carries `designatorCode` in both branches.
- [ ] Gates; commit `feat(grid): #321 Bray IDs — per-part designator code, two-digit numbers`.

### Task 2: Riser tag fields on parts and devices

**Files:** `src/lib/stores/catalog.ts`, `part-form.ts`, `catalog/page.tsx`, new `src/app/(app)/catalog/tag-defaults-field.tsx`, `grid-parts.ts`, `grid-bom.ts` (PartLite), `src/lib/stores/grid-projects.ts`, `design/grid/[id]/actions.ts` (incl. `cleanRestoredPlacement`), `src/lib/design/grid-undo.ts`, `use-grid-editor.ts`, `src/lib/design/grid-device-rows.ts`, `workspace/devices-table.tsx`, `workspace/property-editor.tsx`, the clipboard (`src/lib/design/grid-clipboard.ts`).

**Interfaces:**
- Consumes: `cleanTagFields`, `cleanPlacementTag`, `effectiveTag`, `TagFields`, `PlacementTag`, `TAG_LIMITS` from `conduit-riser/tags.ts`.
- Produces: `CatalogPart.tagDefaults?: TagFields`; `PartLite.tagDefaults?: TagFields`; `GridPlacement.tag?: PlacementTag`; store `setPlacementsTag(projectId, items: { id: string; tag: PlacementTag | null }[]): Promise<BatchResult<{ previous: { id: string; tag: PlacementTag | null }[] }>>` (via `batchEdit`, all-or-nothing, refuses curtains, `null` clears, a hand edit clears `auto` like category edits do); action `setTagFieldsAction(projectId, items)` → `{ ok: true; previous } | { ok: false; error }`; `GridCommand` kind `"tag"` `{ kind: "tag"; items: { id; tag: PlacementTag | null }[] }`; hook `saveTags(items)` records undo with `inverse: previous`.

Steps:
- [ ] Part side: `tagDefaults` parsed in `optionalPartFields` from inputs `tag_box`, `tag_face`, `tag_mount`, `tag_height`, `tag_pd` (only when the form submitted them; all blank → `undefined`); `TagDefaultsField` component (five small inputs + a P/D select: blank, P, D, P/D) under a "Riser tag defaults" heading in the part editor, `key={part.sku}`; copy `tagDefaults` through `gridPartsFrom` both branches.
- [ ] Placement side: `tag?: PlacementTag` on `GridPlacement`; `setPlacementsTag` as above; whitelist `tag` (through `cleanPlacementTag`) in `cleanRestoredPlacement`; the clipboard carries `tag` (paste keeps tag fields, gets a fresh designator).
- [ ] Devices tab: add columns `box`, `face`, `mount`, `height`, `pd`, `location`, `power`, `contents` to `DEVICE_COLUMNS` (all editable, narrow widths, mono for box/face/mount/height/pd/power); `DeviceRow` gets the effective values (placeholder text shows the part default in muted style when the placement has no override) — the row builder needs `tagDefaults` and the space name. Generalize `EditCol`, `nextCell` (Tab order follows the editable columns in table order) and the editable-cell check in `devices-table.tsx:280` to a column flag instead of hard-coded keys; `commit()` routes tag columns to `saveTags([{ id, tag: { ...current, [field]: value } }])`. Input `maxLength` from `TAG_LIMITS`; P/D cell accepts `P`, `D`, `P/D` or blank (invalid → revert with the existing error path). Empty input for a tag column removes that override (falls back to the part default).
- [ ] Property Editor: single device → a "Riser tag" `PropSection` with the eight rows (same click-to-edit pattern as `DesignatorRow`), each showing the effective value and "(from part)" when inherited; several selected → the eight rows with `same()`/"Mixed" and bulk set (copy the bulk Category row) — bulk sets one field on all, keeping each device's other fields.
- [ ] Undo/redo `case "tag"` in the hook's command runner.
- [ ] Harness `conduitRiser321B2Checks`: `optionalPartFields` round-trip for tag fields; store `setPlacementsTag` sets, clears with `null`, refuses a curtain (whole batch), clears `auto`, returns `previous`; `cleanRestoredPlacement` keeps a cleaned tag and drops junk; paste keeps `tag` and issues a new designator; `deviceRows` shows part defaults when no override; `nextCell` walks editable columns in order.
- [ ] Gates; commit `feat(grid): #321 riser tag fields on parts and devices`.

### Task 3: Levels on spaces and sheets

**Files:** `grid-projects.ts`, `design/grid/[id]/actions.ts`, `spaces-panel.tsx`, `workspace/sheet-tabs.tsx`, `src/lib/design/grid-levels.ts` (new, pure).

**Interfaces:**
- Produces (pure `grid-levels.ts`): `type GridLevel = { id: string; label: string; elevation?: string; order: number }`; `cleanLevels(raw): GridLevel[]` (≤ 30, label ≤ 40 required, elevation ≤ 20, ids `lvl-`, orders renumbered 0..n−1 in array order); `levelOfPlacement(pl, spaceOf, project): string | null` = the containing space's `levelId` ?? `project.sheetLevels?.[pl.sheetId]` ?? null (only ids present in `project.levels`).
- Data: `GridProject.levels?: GridLevel[]`; `GridSpace.levelId?: string`; `GridProject.sheetLevels?: Record<sheetId, levelId>` (**deviation from the spec's `GridSheet.defaultLevelId`**: sheets are separate documents; one map on the project keeps a level edit to one `patchDoc` — log it in Task 10).
- Store: `setLevels(projectId, levels)` (replaces the list; drops `levelId`/`sheetLevels` entries naming a removed level), `setSpaceLevel(projectId, spaceId, levelId | null)`, `setSheetLevel(projectId, sheetId, levelId | null)`; actions `saveLevelsAction`, `setSpaceLevelAction`, `setSheetLevelAction` (`requireUser`, revalidate the editor + riser paths).
- Revisions: `levels` and `sheetLevels` join `GridRevision`, `snapshotOf`, `restoreRevision` (absent on older snapshots → leave the current values alone).

Steps:
- [ ] Pure module + store functions + actions as above.
- [ ] Space editor (`spaces-panel.tsx` `SpaceEditor`): a "Level" `<select>` (— none —, then levels by order); hidden when the project has no levels, with a "Levels are set on the conduit riser page" hint.
- [ ] Sheet tab ⋯ menu: "Default level" `<select>` child, same options.
- [ ] Harness `conduitRiser321B3Checks`: `cleanLevels` caps/renumbers/drops blank; `levelOfPlacement` precedence (space > sheet > none; unknown ids ignored); `setLevels` removing a level clears it from spaces and `sheetLevels`; snapshot/restore round-trips levels; an older snapshot without levels leaves them.
- [ ] Gates; commit `feat(grid): #321 levels on spaces and sheets`.

### Task 4: Settings — wire-type symbols, box types, conduit sizes

**Files:** `src/lib/catalog-connect.ts`, `design/grid/settings/wire-types-card.tsx` (+ page/actions if needed), new `src/lib/riser-box-types.ts`, `src/lib/stores/riser-box-types.ts`, a Grid Settings card `box-types-card.tsx`, new `src/lib/conduit-sizes.ts`, `src/lib/stores/conduit-sizes.ts`, `src/app/(app)/estimating-rules/conduit-sizes/{page.tsx,actions.ts,conduit-sizes-client.tsx}`, `src/app/(app)/estimating-rules/page.tsx` (tile), `src/lib/catalog-rename/rewrite.ts`.

**Interfaces:**
- `WireType.symbol?: string` (1–3 chars, uppercased) and `WireType.signal?: string` (≤ 30); `cleanWireTypes` keeps them like `cableSku` (only when non-empty).
- `RISER_BOX_TYPES_BLOB = "riser_box_types"`; `sanitizeBoxTypes(raw): CRBoxType[]` (≤ 40 rows, code 1–4 `[A-Z0-9]` unique uppercased, description ≤ 60 required); `getRiserBoxTypes()` returns the stored list, else `BRAY_BOX_TYPES` (from `conduit-riser/tables.ts`) when nothing is stored; `saveRiserBoxTypes(list)` (`setBlob(BLOB, { types: clean })`).
- `CONDUIT_SIZES_BLOB = "conduit_sizes"`; `ConduitSize` from `conduit-riser/pricing.ts`; `sanitizeConduitSizes(raw)` (≤ 20 rows, size ≤ 12 unique, partId optional); seed when nothing stored: `1/2"`, `3/4"`, `1"`, `1-1/4"`, `1-1/2"`, `2"` with no parts; `saveConduitSizes(list)` refuses a `partId` not in the catalog or not per-length (`isPerLengthUnit`), per-row error like `curtain-mounts.ts`.
- `rewrite.ts`: the SKU-rename sweep rewrites `conduit_sizes` `partId`s like it does `curtain_mount_hardware`.

Steps:
- [ ] Wire types: two new inputs per row in the card ("Symbol", "Signal"), round-tripped through `rowOf`/`rowsToWireTypes`; `cleanWireTypes` keeps them.
- [ ] Box types: pure + store + a Grid Settings card (rows: code, description; Add row; Reset to Bray's list); action `saveRiserBoxTypesAction` (`requirePerm("manage_users")`).
- [ ] Conduit sizes: pure + store + Estimating Rules page (copy `curtain-mounts/page.tsx` shape; rows: size, part picker search by SKU/model limited to per-length units, Remove; Add size) + a tile on `estimating-rules/page.tsx` ("Conduit sizes — what a priced conduit run buys, by size").
- [ ] Harness `conduitRiser321B4Checks`: `cleanWireTypes` keeps/cleans symbol+signal and drops blanks; `sanitizeBoxTypes` dedupes/uppercases/caps; empty store → Bray list; `sanitizeConduitSizes` dedupes and keeps order; `saveConduitSizes` refuses an unknown or non-per-length part (scratch DB); rename sweep rewrites a `conduit_sizes` partId.
- [ ] Gates; commit `feat(grid): #321 wire-type symbols, box types, conduit sizes`.

### Task 5: Conduit riser store and server loader

**Files:** new `src/lib/stores/grid-conduit-riser.ts`, new `src/lib/design/conduit-riser-server.ts`, `src/lib/stores/grid-projects.ts`, `src/lib/design/grid-options.ts`, `src/lib/design/grid-riser-doc.ts`, `src/lib/design/conduit-riser/model.ts` (add `copyConduitRiserDoc`).

**Interfaces:**
- `GridProject.conduitRiser?: Record<optionId, ConduitRiserDoc>`; `GridRevision.conduitRiser?` (snapshot/restore exactly like `riser`; restore filters to live option ids).
- Pure `copyConduitRiserDoc(src, idMap, makeId): ConduitRiserDoc` in `model.ts`: re-points placement ends and pinned `tags` keys through `idMap` (placements **and** routes — extend `copyOptionMembers` to also `idMap.set(oldRouteId, newRouteId)`; make `copyRiserDoc` also record `oldLinkId → newLinkId` into a caller-supplied map so `linkIds` re-point), drops anything unmapped, new ids for runs/stubs/notes/details (remap stub ends and tag `detailId`s).
- Store (each one `patchDoc`, refusal via a closure reason like `grid-riser.ts`): `patchConduitRiser(projectId, optionId, op: CROp)`; `acceptSuggestions(projectId, optionId, keys: string[] | "all")` — re-derives suggestions **server-side** from the live wires (never trusts a client suggestion object), accepts the ones whose key is listed; `dismissSuggestion(projectId, optionId, key)`. All return `{ ok: true } | { ok: false; reason: "not-found" | "no-such-option" | "invalid" }`. Inside: `normalizeConduitRiserDoc(p.conduitRiser?.[optionId])`, then `pruneConduitRiser` with live ids from the option (placements, routes, the old riser doc's links, spaces, levels, `wireEnds`), then the pure op with `placementIds`, then re-normalize and write.
- Pruning hooks in `grid-projects.ts`: wherever `pruneRisers` runs (dropSheetInPatch, replaceAutoPlacements, removePlacement, removePlacements, removeSpace) also prune `conduitRiser` for every option; **also** `removeRoute` (it doesn't prune today). Option removal deletes `conduitRiser[optionId]`; option copy calls `copyConduitRiserDoc`.
- Loader `src/lib/design/conduit-riser-server.ts` (server-only): `loadConduitRiser(project, optionId, deps?) → Promise<{ doc; input: DeriveInput; view: CRView; suggestions: SuggestResult; tables: TableModel[]; boxTypes; sizes; wireTypes; estimateOwned: boolean; placementIds: Set<string> }>`. Builds, for the option slice:
  - parts/partById exactly like `drawing-set-data.ts:78–82`; device types context; settings (wire types, digits).
  - `CRDevice` per non-curtain placement: `label = formatDesignator(filled designator, placementQty, digits)` (fill missing in memory like `grid-schedule-server.ts:62`), `desc`, `model` (`partModel`), `typeKey` (device-type key of the part), `inSystem = placementSystem(pl, partById) === "lighting"`, `spaceId`/`spaceName` via `spaceOf` (smallest-wins), `levelId = levelOfPlacement(...)`, `tag = effectiveTag(pl.tag, part.tagDefaults, spaceName)`, `rack` for a rack assembly (`asm:` part of kind `rack`: its placements grouped by part desc with qty).
  - `CRWire` per route (`lengthFt = routeLengthFt`, `inSystem = routeSystem(...) === "lighting"`) and per old-riser RiserLink between two placements (`lengthFt` typed, `inSystem` = either end in lighting); `cable` = part model else desc; `signal` = wire type found by `cableSku` (exact sku or former sku) else the route's `connectionType` → first wire type listing it — only when that type has a `symbol`.
  - `levels` from `project.levels` (as `CRLevel`), `wireTypes` with symbols, box types, conduit sizes.
  - `view = deriveView`, `suggestions = suggestions(doc, wires)`, `tables = riserTables(...)`.
- [ ] Harness `conduitRiser321B5Checks` (scratch PGlite, `G = await import("@/lib/stores/grid-projects")` like the #318 store checks): build a project with a rack, a dimmer, two DMX outputs on a calibrated page, routes between them; `loadConduitRiser` returns suggestions for the device pairs; `acceptSuggestions("all")` makes runs; accepting again changes nothing; a forged key is ignored; `removeRoute` empties the run (kept); `removePlacement` drops its runs and pinned tag; option copy re-points runs to the copied devices and routes; revision restore brings the doc back; option removal drops it; `estimateOwned` reads true on an estimate-linked option; signals resolve through `cableSku`.
- [ ] Gates; commit `feat(grid): #321 conduit riser store and loader`.

### Task 6: The conduit riser page and editor

**Files:** new `src/app/(app)/design/grid/[id]/conduit-riser/{page.tsx,actions.ts,conduit-riser-editor.tsx,panels.tsx}`, `workspace/outputs-menu.tsx`.

**Interfaces:**
- Actions (`"use server"`, `requireUser`, op names whitelisted against `CR_OP_NAMES`, `revalidatePath` of the riser page, the editor and `/set`): `patchConduitRiserAction(projectId, optionId, op)`, `acceptSuggestionsAction(projectId, optionId, keys | "all")`, `dismissSuggestionAction(projectId, optionId, key)`, `saveLevelsAction` (from Task 3), `setTagFieldsAction` (from Task 2), and for Connect-with-wire the existing `addRouteAction`/`addRiserLinkAction` followed by `acceptSuggestionsAction([pairKey])`.
- Page: `requireUser`; `getProject`; `resolveOptionId`; `loadConduitRiser`; per detail `layoutDetail` + `detailGeometry`; passes the geometry, layouts (for hit boxes), view, suggestions, doc, levels, power types, notes, box types, device types (for "Always show"), wire types and `estimateOwned` to the client editor. `dynamic = "force-dynamic"`, `maxDuration = 60`. Option picker and detail tabs as search params (`?option=&detail=`).

Steps:
- [ ] Rendering: a React component that maps `Geo[]` to SVG elements (reuse `BLOCKS` from `drawing.ts`; the same primitives as `svg.ts`, but as JSX so items are clickable) inside a pannable/zoomable `<svg viewBox>` sized to the detail; transparent hit rects from `DetailLayout.items` (tags/stubs) and from run paths (a wide invisible stroke) and level lines.
- [ ] Interactions (pointer capture + `getScreenCTM().inverse()` like `riser-editor.tsx`): drag a tag → `moveTag` (pinned), drag a stub → `updateStub {x,y}`, drag a level line → `moveLevel`, drag a run's vertical lane → `updateRun {laneX}`; optimistic local state committed on pointer-up; `router.refresh()` after each write. Toolbar: Select · Connect · + Stub · Re-layout (unpins nothing; refreshes) · Reset layout (`resetLayout` with the detail's run ids from the view) · Undo · Redo (client stack of the layout ops above, inverse = the previous value; cleared on refresh from another source).
- [ ] Connect tool: click two tags (or a tag and a stub) → a small chooser: "Conduit only" (`addConduitRun`) or "With wire…" (pick a per-length cable part; same calibrated page → `addRouteAction`, else typed length → `addRiserLinkAction`; then accept that pair).
- [ ] Panels (`panels.tsx`):
  - **From the plan**: "N new" list (pair labels, signal letters, "joins run" badge) with Accept / Dismiss per row and Accept all; "Not connected to two devices" list with Show on plan links (`/design/grid/<id>?option=…&select=<routeId>` — use the editor's existing select-by-query param if present, else just the editor link).
  - **Tag** (selected tag): designator (read-only, links to Show on plan), the eight tag fields (writes `setTagFieldsAction`), power type select from the power-types list.
  - **Run**: size (free text + datalist of Conduit sizes), Conduit / Cable management, Price wire and Price conduit as Default / Yes / No selects (hidden when `estimateOwned`), length (ft, blank = measured), member wires with signal letters and footage, display-only signals for a stub run (wire-type checkboxes), Remove from riser; an "empty conduit" note when it has no wires.
  - **Detail**: name, number, All spaces / pick spaces; + Detail; delete (not the last).
  - **Levels** (project-wide, via `saveLevelsAction`): label, elevation, ↑↓, add, remove.
  - **Power types**: rows + "Start from Bray's A–E" when empty.
  - **Always show**: device-type checkboxes (lighting scope types).
  - **Defaults**: conduit size; Price wire in conduit; Price conduit (hidden when `estimateOwned`).
  - **Notes**: numbered list with add/edit/remove.
  - **Warnings**: `view.warnings` as a list.
  - Phone width: panels stack, canvas view-only (no drag), as the existing riser page does.
- [ ] Outputs menu: add `{ label: "Lighting control riser →", href: \`/design/grid/${id}/conduit-riser?option=${opt}\` }` under the existing "Riser →" (rename that one "System riser →").
- [ ] Harness `conduitRiser321B6Checks`: source pins — the page calls `loadConduitRiser`; every action calls `requireUser` and whitelists ops against `CR_OP_NAMES`; `acceptSuggestionsAction` passes keys, not suggestion objects; outputs menu links both risers. `npm run -s test:smoke` passes with the new route listed in `scripts/smoke-routes.ts` (add it the way neighbouring Grid routes are listed).
- [ ] Browser check (dev server on a **scratch** datadir per memory "Exercising POST routes safely"; never `.data/pglite`): make a design, place a rack + three lighting control devices, wire them on a calibrated page, open the riser, Accept all, drag a tag, change a run's size, add a stub, Reset layout. Screenshot.
- [ ] Gates; commit `feat(grid): #321 conduit riser page and editor`.

### Task 7: "Add to lighting control riser?" in the plan

**Files:** `design/grid/[id]/actions.ts` (`addRouteAction` returns `{ ok: true; routeId }`), `use-grid-editor.ts` (~1635–1651), new `workspace/riser-prompt.tsx`, the workspace layout that renders `intake-notices.tsx` (mount the prompt beside it).

**Interfaces:** `riserPromptForRouteAction(projectId, optionId, routeId) → { show: false } | { show: true; key: string; label: string /* "ER-01 → CRO-04" */; joins: boolean }` (server: `loadConduitRiser` → is there a suggestion whose route ids include `routeId`?). Accept calls `acceptSuggestionsAction(projectId, optionId, [key])`.

Steps:
- [ ] Return the new route id from `addRouteAction` (store `addRoute` already returns the project; find the route by the id the store minted — have `addRoute` return it).
- [ ] After a successful device-to-device route (`fromPlacementId && toPlacementId`), call `riserPromptForRouteAction`; when `show`, render `RiserPrompt` (copy the `intake-notices.tsx` strip: `role="status"`, "Add ER-01 → CRO-04 to the lighting control riser?" (or "…joins the existing run"), buttons **Add** · **Later**). It hides on Later, on Add success (status bar "Last action: Added to the riser"), or on the next drawing action. Never blocks drawing.
- [ ] Harness `conduitRiser321B7Checks`: `riserPromptForRouteAction` shows for a lighting device pair, not for an audio pair, not for a loose route, and says `joins` when the pair has a run; source pin that `addRouteAction` returns `routeId`.
- [ ] Gates; commit `feat(grid): #321 add-to-riser prompt in the plan`.

### Task 8: Pricing — wire by others, priced conduit, refusals

**Files:** `src/lib/design/grid-quote.ts`, `src/lib/design/grid-bom-groups.ts`, `use-grid-editor.ts` (~1049–1120), `workspace/bom-panel.tsx`, `page.tsx` of the Grid editor (pass the conduit riser doc + sizes to the client).

**Interfaces:** consumes `wireByOthers`, `conduitDemand`, `ConduitSize`; adds a BOM group key `"conduit"` titled "Conduit" to `BOM_GROUPS` and a `BomSource` `"conduit"`; labor (`grid-quote.ts:239–262`) skips the conduit group.

Steps:
- [ ] `buildGridQuote`: unless the option is estimate-owned, drop `wireByOthers(doc, false, placementIds)` routes/links before `routeLines`; add `conduitDemand(...)` lines (part desc/unit/list/cost from `partById`, qty = feet) under the conduit group; any `refusals` → `{ ok: false, error: refusals.join(" ") }` (blocks every promote path — `createDraftQuoteAction`, Designs dashboard, Home).
- [ ] Live editor BOM (`use-grid-editor.ts:1065`): same filtering and conduit lines on the client from the doc + sizes the page passes; `bom-panel.tsx` shows an **"In conduit — by others"** info list (wire part, footage; never priced) and the refusal sentences next to the unmeasured-wire notice.
- [ ] Harness `conduitRiser321B8Checks` (scratch DB): with defaults off, a routed DMX wire inside a run disappears from the quote's wire lines and the remaining wire lines are unchanged; turning `priceWire` on for the run brings it back; `priceConduit` with a mapped 3/4" EMT part adds a Conduit line = ceil(longest member ft); an unmapped size refuses with the exact sentence; a cable-management run never adds conduit; an estimate-owned option ignores all of it; labor rows never include the conduit group.
- [ ] Gates; commit `feat(grid): #321 riser pricing — wire by others, priced conduit`.

### Task 9: E-502 in the drawing set + DXF download

**Files:** `src/lib/design/grid-drawing-set.ts` (`buildSheetList`, `DrawingSheetKind`, `sheetExclusionKey`, `toggleableSheets`), `src/lib/design/drawing-set-data.ts`, `src/components/drawing/drawing-set-sheets.tsx`, new `src/app/api/grid/[id]/conduit-riser/dxf/route.ts`, the riser page (Download DXF button), the set page (a Download DXF link per conduit-riser sheet).

**Interfaces:** `DrawingSheetKind` gains `"conduitRiser"`; `buildSheetList` takes `conduitRiserPages: number` (0 = none) and numbers them `E-502`, `E-503`… after E-501, title "Lighting control riser" (continuation pages "Lighting control riser (cont.)"); exclusion key `conduit-riser`.

Steps:
- [ ] `drawing-set-data.ts`: when the option's conduit riser has ≥ 1 run, `loadConduitRiser` → `composeSheets({ details, tables, notes, area: drawingArea(size) })` → pages; pass the page count to `buildSheetList`.
- [ ] `drawing-set-sheets.tsx` `body(d)`: for `conduitRiser` render page `n`'s geometry with the same JSX renderer as Task 6 (move it to `src/components/drawing/conduit-riser-figure.tsx` so both use it), filling the drawing area; scale label "NTS".
- [ ] DXF route: `GET /api/grid/[id]/conduit-riser/dxf?option=&size=b|d&page=1` — `await requireUser()` outside the try (like `api/racks/[id]/submittal/route.ts`); `getProject(decodeURIComponent(id))` 404 JSON when missing; `geometryToDxf(page.geo, page)`; `content-type: application/dxf`, `content-disposition: attachmentDisposition("<project name>-E-50<n>-lighting-control-riser.dxf")`, `cache-control: private, no-store`; `dynamic = "force-dynamic"`.
- [ ] Buttons: riser page "Download DXF" (one per page when several); set page link under each conduit-riser sheet (screen only, not printed).
- [ ] Harness `conduitRiser321B9Checks`: `buildSheetList` adds E-502/E-503 after E-501 only when pages > 0 and numbering of later sheets is unchanged; exclusion toggles it; the route file awaits `requireUser` before `getProject` and sets attachment + no-store (source pins); a DXF built through the loader for the B5 fixture parses with the harness DXF reader from `conduitRiser321Checks` (extract that reader to a shared const in the harness). `npm run -s test:smoke` with the route listed.
- [ ] Browser check: the set page shows E-502 at 11×17 and 24×36; Download DXF saves a file; `~/.venvs/venue-templates/bin/python -I scripts/dxf-audit.py <file>` → 0 errors.
- [ ] Gates; commit `feat(grid): #321 E-502 lighting control riser sheet + DXF download`.

### Task 10: Docs and final verification

**Files:** `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`, `QUESTIONS.md` (if a question for Jeff remains), the spec (mark Plan B done).

Steps:
- [ ] Recompute the next free D number from `origin/main` right before writing (memory: numbers collide within the hour). Decisions to log: R12 DXF; `laneX`; bubbles at the device end; conduit length rule; `allSpaces`; cable management never prices conduit; rewired wires leave their run; `sheetLevels` on the project instead of `GridSheet.defaultLevelId`; two-digit default and "setting never rewrites"; per-part designator code wins over the device type; tag fields part-default + device-override; box types / conduit sizes blobs; E-502 numbering; the plan prompt.
- [ ] PUNCHLIST `## 321. Grid conduit riser (Bray format, lighting control) — DONE <date> (D…)` with the Jeff-gated follow-ups: fill Conduit sizes, set wire-type symbols, set part tag defaults and designator codes for the lighting control parts, open the DXF in AutoCAD/Vectorworks.
- [ ] AGENTS.md phase list entry (#321), in the style of the neighbours.
- [ ] Full gates from a clean tree; report numbers.
- [ ] Commit `docs: #321 Grid conduit riser (D…)`.

## Self-review

- Spec coverage: IDs (T1), tag fields (T2), levels (T3), wire symbols/box types/conduit sizes (T4), document + carry + prune + loader (T5), editor incl. details/stubs/notes/power types/always-show/defaults/undo/phone (T6), plan prompt (T7), pricing incl. estimate-owned (T8), E-502 + six tables + DXF route (T9), docs (T10).
- Known deviation added here: `sheetLevels` on the project (T3).
- Type names used across tasks: `PlacementTag`, `TagFields`, `CROp`, `CR_OP_NAMES`, `ConduitRiserDoc`, `ConduitSize`, `CRBoxType`, `GridLevel`, `loadConduitRiser`, `setTagFieldsAction`, `acceptSuggestionsAction` — consistent.
