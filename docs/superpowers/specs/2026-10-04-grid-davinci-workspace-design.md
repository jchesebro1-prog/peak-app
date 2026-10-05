# The Grid — DaVinci-style workspace (#299) — design

**Status:** Shipped 2026-10-04 (D595–D604).

**Date:** 2026-10-04 · **Punch:** #299 · **Decisions:** D595–D604 · **Approved by:** Jeff (2026-10-04, in session)

## Ask

Jeff shared a screenshot of ETC DaVinci System Designer and asked: "How do we make The Grid look closer to this?"
Choices Jeff made in the design session:

| Question | Answer |
|---|---|
| What to borrow | **All four**: full-window docked layout, Product Library tiles, Property Editor + Browser tree, icon toolbar + status bar |
| What to keep | **Our canvas and its logic** — the intake (Auto / Blank), venue-template base sheets (Blank opens on them too), Auto fill, Change equipment |
| Approach | **A — a fixed docked shell** around the existing components (not a floating docking library, not a restyle only) |
| Placed vs. target | **Left pane**, under System Status |
| Editing features | **In this project**: multi-select, copy/paste/duplicate, align/distribute, undo/redo |
| Snap to grid | **An option** (toolbar toggle, off by default) |

## Today

- `/design/grid/[id]` is a normal scrolling page: app nav, two rows of text buttons (option switcher, Rename, Delete,
  + Additional sheet, Riser →, Schedule →, Drawing set →, Lineset, Client package, Delete), then a `252px 1fr` grid —
  a sticky left column of 11 stacked cards (Devices, Assemblies, Scale, Curtains, Scope, Placed vs. target, Layers,
  Spaces, Wires, Bill of materials, Revisions) beside the plan canvas on a dark surround. The selected device shows as
  one more card. Sheets switch from a `<select>`.
- `editor.tsx` is ~2,500 lines of inline-styled JSX holding all state, the SVG canvas, pointer logic and panels. Most
  panels are already separate components in the same folder.
- Editing is one item at a time; each change is its own server action (`placeDeviceAction`, `movePlacementAction`,
  `removePlacementAction`, …) followed by `revalidatePath`. Arrow-key nudge and Delete work on the one selected device.
  No multi-select, clipboard, align, snap, or undo.
- `removePlacement` (store) also prunes riser links / conduits that ended on the device (#209). It does **not**
  touch routes: a wire keeps its `fromPlacementId`/`toPlacementId` (unchanged by this work).
- `patchDoc` has no version check (last write wins); `movePlacement` clears the `auto` tag (`withoutAuto`).
- 22 checks in `scripts/test-review-and-spec.ts` read `editor.tsx` as source text and assert literal strings.

## Design

### 1. The shell

- A new **`GridWorkspace`** (`src/app/(app)/design/grid/[id]/workspace/`) lays the editor out as a CSS grid sized to
  the viewport under the app nav (`height: calc(100dvh - <nav>)`), so the page no longer scrolls; each pane scrolls on
  its own:

  ```
  ┌──────────────────────── Toolbar ────────────────────────┐
  │ Left            │ Center                  │ Right       │
  │ Property Editor │ Sheet tabs              │ Browser     │
  │ System Status   │ Plan canvas (unchanged) │ Layers ·    │
  │ Targets         │ Plan view │ Spreadsheet │ Spaces · …  │
  ├─────────────────┴─────────────────────────┴─────────────┤
  │ Product Library (category tree + numbered tiles)        │
  ├──────────────────────── Status bar ─────────────────────┤
  ```

- Left, right and bottom panes are **resizable** (drag handle) and **collapsible** (to a thin labelled strip). Each
  viewer's sizes and collapsed state persist in `localStorage` (try/catch; defaults when unavailable). Below ~1100px
  wide the side panes start collapsed. The Grid is not a phone tool and this does not change that.
- **`editor.tsx` is split**: a **`useGridEditor()`** hook owns all editor state (selection, armed part/curtain, drawing
  modes, zoom, active sheet/page, optimistic moves) and the handlers that call server actions; **`PlanCanvas`** is the
  existing SVG + pointer logic moved out unchanged; panes read the hook. Existing panel components (`LayersPanel`,
  `SpacesPanel`, `WiresPanel`, `RevisionsPanel`, `ScopePanel`, `DevicePalette`'s filter logic, `AssembliesPanel`, …)
  are rehomed and restyled, not rewritten.
- **Unchanged:** the intake, Auto fill, Change equipment, venue-template base sheets, pricing, the quote path, the
  riser / schedule / set / lineset pages, and every existing server action.

### 2. Where everything goes

| Today | New home |
|---|---|
| Devices palette, Assemblies, Curtains | **Product Library** (bottom). Curtain types are a category of their own |
| Selected-device card, Scale | **Property Editor** (left). Nothing selected → design properties incl. scale/calibration |
| Scope / Placed vs. target | **Targets** box (left, collapsible, under System Status) |
| Layers, Spaces, Wires, Bill of materials, Revisions | **Right pane tabs**: Browser · Layers · Spaces · Wires · BOM · Revisions |
| Riser →, Schedule →, Drawing set →, Lineset, Client package, Delete design | **Outputs ▾** toolbar menu |
| Option switcher, + Option, Rename/Delete option | **Design ▾** toolbar menu |
| Sheet `<select>`, + Additional sheet, Delete sheet | **Sheet tabs** above the canvas (`+` tab; tab ⋯ menu for delete) |
| Add to quotes | Stays the one primary button in the toolbar |
| Warning banners (incomplete, tier fallback, uncalibrated, unmapped, errors) | **System Status** (left), also echoed in the status bar |

### 3. Toolbar

One icon row (icons with tooltips + keyboard shortcuts):

- **Tools:** Select (V), Place (P — armed from the Library), Wire (W), Space (S), Calibrate, Pan (H; or hold Space).
  These map onto the drawing modes the editor already has; exactly one is active.
- **Edit:** Undo (⌘Z), Redo (⇧⌘Z), Cut / Copy / Paste / Duplicate, Delete.
- **Arrange:** Align left / center / right / top / middle / bottom, Distribute horizontally / vertically (enabled with
  ≥2 / ≥3 selected).
- **View:** zoom out / % field / zoom in / Fit sheet; Snap to grid toggle + spacing.
- **Right side:** Auto fill / Change equipment, Design ▾, Outputs ▾, Add to quotes.

### 4. Panes

- **Property Editor** — DaVinci-style key/value rows, by selection:
  - nothing → the design (name, customer, venue, tier, sheet, scale/calibration with Calibrate);
  - one device → part, MFR #, layer/scope, space (computed), qty, sell, auto tag, by; Replace part…, Delete;
  - one curtain → its curtain fields (existing curtain editing);
  - one space / one wire → what `SpacesPanel` / `WiresPanel` edit today;
  - several → shared fields ("3 devices · Lighting · Space: mixed") and bulk actions **Delete**, **Set category**,
    **Replace part…**. (Layer/scope comes from the part and space from position — both computed, never stored — so
    neither is a bulk "move to"; Set category is the user-category layer.)
- **System Status** — one list aggregating the warnings already computed (needs-a-part count, uncalibrated sheet,
  unmapped parts hidden, tier-fallback lines, last server error). Rows with a fix link to it.
- **Targets** — the existing Scope / Placed vs. target content, collapsible.
- **Browser** — a tree: Design → Sheet → Space → devices (identical parts grouped "S4 LED ×3", expandable), with
  racks / assemblies expandable to members and a Wires node. Clicking a row selects it on the plan (switching sheet
  if needed); the plan selection highlights its row.
- **Product Library** — left: a category tree (Favorites, Recent, then scope → device type, plus Assemblies and
  Curtains); right: search + manufacturer filter and **numbered symbol tiles** (the part's Grid symbol, name, price on
  hover). Click a tile = arm Place (painter mode, like picking a part today); drag a tile onto the plan = place once.
  Filtering stays in `lib/design/grid-palette` (`paletteView`).
- **Sheet tabs + Plan view / Spreadsheet view** — Spreadsheet view renders the schedule table (today's
  `/schedule` content) inline for the active option; the `/schedule` page stays. `page.tsx` builds it server-side
  with the schedule page's own inputs (`catalogFallback`, `loadVirtualParts`, `buildSchedule`) and passes it as a
  prop, so both views read identically; edits refresh it through the usual `router.refresh()`.
- **Status bar** — last action · device count (this sheet / design) · scale · snap state · sync state.

### 5. Editing features

1. **Multi-select.** Select tool: drag on empty plan = marquee; Shift-click adds/removes; ⌘A = all on visible layers
   of this sheet; Esc clears. Selection holds devices and curtains (spaces and wires stay single-select). Dragging
   any selected item moves the group; arrow-key nudge moves the group.
2. **Copy / cut / paste / duplicate** (⌘C/⌘X/⌘V/⌘D). In-memory clipboard for the tab — works across sheets and design
   options. Paste lands at the cursor (or +12px offset when the cursor is off the plan), relative positions kept;
   new ids, `auto` tag cleared (any hand edit clears it). A wire is copied only when both its ends are in the set.
3. **Align / distribute** — pure functions in `src/lib/design/grid-align.ts` over the selection's positions.
4. **Snap to grid** — toolbar toggle, **off by default**. Spacing in real units (6", 1', 2', 5') on a calibrated
   sheet; a plan-relative step on an uncalibrated one. The canvas dot grid draws at the snap spacing. Applies to
   place, drag, paste and nudge; positions are rounded client-side before the server call — storage unchanged.
   On/off + spacing persist per viewer (`localStorage`).
5. **Undo / redo** (⌘Z / ⇧⌘Z) — a client-side, per-tab stack (cap 100). Each entry holds a forward and an inverse
   server call:
   - move (incl. align/distribute/nudge) ↔ move back to the previous positions;
   - place / paste / duplicate ↔ remove those ids;
   - delete / cut ↔ **`restoreItemsAction`** re-inserting exactly what the server reported removing (the placement
     records as they were, incl. any `auto` tag, and the riser links/conduits pruned with them), original ids kept.
     Wires are not removed by a delete today, so there is nothing to restore for them.
   - Undoing a move restores positions only; the `auto` tag the move cleared stays cleared (a hand edit is a hand
     edit).
   If the server refuses a step (an id is gone or already exists — another person edited), show "Couldn't undo — the
   design changed" and clear the stack. **Not undoable** (tooltip says "use Revisions"): Auto fill, Change equipment,
   sheet upload/delete, calibration, option add/delete.
6. **Batched server actions** — `movePlacementsAction`, `removePlacementsAction`, `pastePlacementsAction`,
   `restoreItemsAction`, `setPlacementsCategoryAction`, `replacePlacementsPartAction`. Paste re-validates every
   pasted curtain with the same rules `placeCurtainAction` uses (shared helper). Each
   validates and applies a list in **one `patchDoc`** with one revalidate, all-or-nothing
   (a missing id refuses the whole batch and names it). `placeDeviceAction` / `placeCurtainAction` also return the
   new placement id so a single place can be undone. Sanitized server-side like the single-item actions, which
   stay for their other callers.

### 6. Errors

- A failed action rolls back optimistic state (positions, selection) and shows the server's message in System Status
  and the status bar — the same pattern single moves use today.
- Undo conflicts clear the stack (above). No partial batches.

## Delivery — six slices

Each slice ships to main on its own with the editor working:

1. **Shell** — split `editor.tsx` (`useGridEditor` + `PlanCanvas`), docked panes, toolbar (existing tools, zoom/Fit,
   Design ▾, Outputs ▾), sheet tabs, status bar. No behaviour change. The harness's source-text checks on
   `editor.tsx` are repointed at whichever new file now holds each string — same strings, not weakened.
2. **Product Library** — bottom drawer, category tree, numbered tiles, click-to-arm, drag-to-place; Assemblies and
   Curtains folded in.
3. **Left pane + right tabs** — Property Editor, System Status, Targets; Layers/Spaces/Wires/BOM/Revisions tabs.
4. **Browser tree + Spreadsheet view.**
5. **Bulk editing** — multi-select, group move, bulk delete / layer / space / replace, align/distribute, snap to grid,
   batched move/remove actions.
6. **Clipboard + undo** — copy/cut/paste/duplicate, undo/redo, `restoreItemsAction`.

## Testing

- **`test:specs` pure units:** align/distribute; snap math (calibrated + uncalibrated); the undo-stack reducer;
  clipboard remap (new ids, `auto` cleared, wires only when both ends copied); Browser tree builder; System Status
  aggregation.
- **Store-level specs** on a scratch PGlite datadir: batched move / remove / paste / restore, including riser-link
  restore after delete, and all-or-nothing refusal.
- **Gates per slice:** tsc, test:specs, test:smoke, eslint vs. a baseline, and `next build` (client/server import
  trap).
- **Browser check per slice** in the preview on a scratch datadir: screenshots at 1600×1000 and at narrow width.

## Out of scope

Floating / re-dockable panes; persistent (cross-session) undo; grid snap stored in the data; a phone layout; changes
to the riser, set, schedule or lineset pages beyond the inline Spreadsheet view.
