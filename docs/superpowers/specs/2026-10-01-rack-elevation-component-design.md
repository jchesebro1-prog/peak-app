# Shared rack elevation component + builder sidebar

**Wave 2.** Authored off-mini 2026-10-01. Decision RK-4 (Jeff): ONE shared component, used by the
Assembly Builder and the Grid's Device Layouts / Enclosure editor. Depends on the layout-engine spec.

## Goal
A scaled front/rear rack elevation you can build in: pick a part, drop it on an RU, see RU used/free,
weight, watts and warnings live. In the Assembly Builder it lives in a **sidebar window** beside the part
picker.

## Task 0 — recon
- `fixture-builder.tsx` / `fixture-form.tsx` layout: where a right-hand panel can mount without
  fighting the existing tabs (All/Fixtures/Systems/Hardware) and live-pricing area.
- UI kit in use (Tailwind? component library?) and the drag-and-drop approach, if any, already in the
  repo (Grid canvas likely has pointer handling worth reusing).
- Grid Device Layouts / Enclosure editor: exists or only planned? Match its data shape if it exists.
- Existing responsive/mobile rules; the app is offline-first for field use (survey), though the builder is a desk tool.

## Architecture
- `src/components/rack/RackElevation.tsx` — **presentational**, controlled: props
  `{ layout, partLookup, selection, mode: 'edit'|'view', face: 'front'|'rear'|'both', onChange(layout), onSelect(ids) }`.
  No data fetching, no persistence. This is what the Grid adopts.
- `src/components/rack/useRackEditor.ts` — undo/redo stack, armed part, hover ghost; calls layout-engine functions.
- `src/components/rack/RackSidebar.tsx` — builder wrapper: header (rack name, RU count), elevation, totals
  footer, issues list, "Fill blanks", face toggle.
- `renderRackElevationSvg(layout, partLookup, opts)` in `src/lib/rack/svg.ts` — **same drawing code**
  server-side for outputs, so screen and submittal never diverge. The React component may render
  from the same geometry function.

## Interaction
1. **Arm and place:** click a part in the picker (it becomes "armed"); hover the rack shows a ghost snapped
   to RU — green if `canPlace`, red with reason if not; click to place. Esc disarms.
2. **Drag from picker** to a slot (same ghost). **Drag a placed device** to move it; Alt/Option-drag copies.
3. **Select:** click selects; Shift-click multi-selects; arrow Up/Down moves 1 RU; Delete removes;
   Cmd/Ctrl+Z / Shift+Z undo/redo.
4. **Right-click / kebab menu:** change face, set half/third width lane, override height/depth/weight/watts,
   mark optional, replace part, add note, duplicate N times (e.g. 4 identical amps).
5. **Add shelf/blank/vent/reserved** from a small "Rack hardware" tray (blanks and vents are catalog SKUs
   configured per builder: a default blank SKU and vent SKU setting).
6. **Fill blanks:** one action fills every empty RU with the default blank panel (idempotent, undoable).
7. **Touch:** tap part, tap slot; long-press for the menu. No hover dependence.

## Display
- RU numbers on both rails, bottom-up default with toggle to top-down; every 5th RU emphasized.
- Devices drawn to scale (1 RU = fixed px, zoomable); label = part label + model; manufacturer on hover.
- Half/third-width devices drawn in lanes; shelves with their children on top.
- Optional placements dashed; reserved slots hatched; blanks/vents low-contrast.
- Front/Rear/Both (side-by-side) view. Rear shows rear-mounted placements only plus a ghost of full-depth front gear.
- Footer: `RU used / free`, weight (lb), watts and max watts, BTU/hr, "at least ... (n unknown)" when data missing.
- Issues list from `validate()`; clicking an issue selects the placements involved.
- Accessible: rack slots are focusable; screen-reader text per placement ("RU 12–13, front: QSC CXD4.3");
  colors never the only signal; works in dark/light theme.

## Sidebar behavior in the builder
- Appears only for `rack` kind records. Collapsible; remembers width/open state per user (localStorage
  with try/catch, per-viewer convenience only).
- The record's `rack-level parts` (frame, rails, PDUs, casters) remain in the normal parts list; PDUs
  with a watts capacity feed a power-capacity line in totals.
- Edits write to the form's draft state; **Save** is the existing `saveFixtureAction` (see kind spec).
  Unsaved-changes guard on navigate.

## Grid adoption (follow-up, wave 4)
Render the same `RackElevation` in the Grid's Device Layouts/Enclosure view with `layout` derived from
devices assigned to an enclosure; "move products between units" = drag between racks. Scope only after
Task 0 confirms the Grid enclosure data shape. Do not block waves 1–3.

## Build tasks
0. Recon. 1. Geometry + `renderRackElevationSvg` (pure, snapshot-tested). 2. `RackElevation` view mode.
3. Edit interactions (arm/place/drag/select/keys). 4. `useRackEditor` undo/redo. 5. `RackSidebar` + builder
mount. 6. Context menu + overrides. 7. Fill blanks + totals + issues. 8. Touch + a11y pass.

## Open questions
- Default blank/vent SKUs: where configured (builder setting vs catalog flag `rackRole`)?
- Max rack height supported in UI (42U default; allow 1–60).
- Dragging across the builder's existing part picker: reuse `searchAssemblyPartsAction` as-is, yes.

## Acceptance
From an empty 42U rack, a user places 8 devices by click and drag, moves one with arrow keys, undoes it,
fills blanks, sees RU/weight/watts update, gets a depth-clash warning on a deep device, and the same
SVG is produced server-side for the identical layout.
