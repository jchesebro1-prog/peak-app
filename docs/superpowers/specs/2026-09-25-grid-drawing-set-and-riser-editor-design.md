# Grid — professional drawing set (title blocks) + editable riser

**Date:** 2026-09-25 · **Status:** approved by Jeff (brainstorm with mockups, 2026-09-25) · **Sequenced after:** the
Equipment map + Auto/Blank intake spec (`2026-09-25-grid-equipment-map-and-auto-intake-design.md`).

## 1. Goal

Jeff: "talk through making the outputs look more professional … adding title blocks, and adding the ability to add via
the riser." Today the riser (`/design/grid/<id>/riser`, D112) is read-only and auto-laid-out; the schedule has a light
header band; the plan sheet itself has no print view; nothing carries a title block, border, sheet number, revision
table or logo.

## 2. Decisions (with mockups)

1. **Title block = A · Architectural side strip**: full-height strip down the right edge — logo + company block,
   project (name, venue, address), option, **revision table**, drawn/checked/scale/date, sheet title + big sheet
   number + "n of N" + quote number.
2. **Sheet size:** 11×17 (ANSI B landscape) default; per-set switch to 24×36 (ARCH D). Same title block scaled.
3. **Sheet set:** T-001 Cover → one plan sheet **per system in scope** (L-101 Lighting, A-101 Audio, V-101 Video,
   R-101 Rigging & Drapery) → E-501 System riser → E-601 Equipment schedules. Levels (upper/lower) are **not now**.
4. **Riser becomes an editor:** add device (**auto-drops on the plan** in that space), connect devices, edit/delete
   devices, add spaces, **level lines**, **conduit (annotation only)**, **general notes**; the layout is saved.

## 3. Drawing set

**Route:** `/design/grid/<id>/set?option=<id>&size=b|d` — a print view rendering every sheet as a page
(`@page { size: 17in 11in }` or `36in 24in`, landscape), printed with the existing `PrintButton` → browser PDF.
Same `?option=` resolution as riser/schedule.

**Title block component** (`src/components/drawing/title-block.tsx`, pure presentational): props = company
(name, address, phone/web, `logoDark` from Settings → Branding, accent colour), project (name, venue, address,
customer), option name (when >1 option), revision rows, drawn by / checked / scale / date, sheet title, sheet number,
index/total, quote number. Border frame + strip layout in one `pk-drawing-sheet` class in `globals.css`.

**Revisions on sheets:** the revision table lists the project's revisions (D109) as `A, B, C…` in cut order with date
and label (the revision's existing note; editable label if none). The set prints at the current state, marked with the
latest revision letter; a project with no revisions shows "— Preliminary".

**Sheets:**
- **T-001 Cover:** project info block, **sheet index** (number + title of every sheet in the set), **symbol legend**
  (the Grid's stock-symbol legend, D265–D269, only symbols used), **general notes** (project-level notes, editable on
  the set page; defaults from a Grid Settings "Standard general notes" text).
- **Plan sheets per system:** for each system in scope that has placements, render the plan (base sheet image/PDF page
  + the placements of that system's groups + that system's wire routes + spaces outlines) fitted to the drawing area,
  with a scale note (from the sheet calibration; "NTS" when uncalibrated) and a north/stage orientation note.
  Numbering: L-101, A-101, V-101, R-101 (curtains live on R-101 with rigging). System ↔ groups mapping lives with the
  Grid scope mapping already used by the Scope panel.
- **E-501 Riser:** the editable riser's saved layout (§4), print-styled.
- **E-601 Equipment schedules:** the existing schedule content (no prices), paginated across as many E-60x sheets as
  needed.

**Set settings** (on the set page, saved on the project): size B/D, drawn by, checked by, include/exclude a sheet.

## 4. Editable riser

**Saved riser document** on the Grid project, per option: `riser: { [optionId]: { nodes: Record<spaceId|"unassigned",
{ x, y, w, h }>, levels: [{ id, label, elevation?, y }], conduits: [{ id, from: EndRef, to: EndRef, label, points? }],
notes: [{ id, n, text }], links: [RiserLink] } }` in normalized riser coordinates. On first open the auto layout
(`riserGraph`, `grid-riser.ts`) seeds node positions; after that the saved positions win and new spaces get an auto
slot.

**Tools** (toolbar, as in the mockup): **+ Device**, **Connect**, **Conduit**, **Level line**, **Space**, **Note**,
Print.
- **+ Device** on a space node: pick catalog part or assembly + qty → creates normal `GridPlacement`s **on the plan,
  inside that space** (centroid, spread in a small grid so multiples don't stack; on the space's sheet/page). For the
  "Unassigned" node: at the plan's lower margin. The riser re-derives and shows them.
- **Edit / delete** a device row on a node: change part/qty or delete → edits the underlying placements (qty change adds
  /removes placements in that space).
- **Connect** device→device or space→space, choose a cable part: if both ends are placements on the same sheet → create
  a `GridRoute` (straight, both endpoints snapped — existing device-wire endpoint fields) so it prices by measured
  length; otherwise → a `RiserLink { id, from, to, partId, lengthFt }` with a typed length that feeds the BOM/quote like
  a route. Riser edges show both kinds.
- **Space**: add a node → creates a small rectangular space on the plan's lower margin (reshape later on the plan).
- **Level line**: horizontal dashed line with label + optional elevation; drag to move; nodes are free to sit between.
- **Conduit**: dashed annotation between nodes/devices with a label (e.g. `1" EMT (by EC)`); **never priced**, not in
  the BOM.
- **Note**: numbered general notes block on the riser sheet (separate from the cover's project notes).

**Permissions:** same as editing the Grid project. Every write goes through the existing Grid project actions and
`patchDoc` persistence; revisions snapshot the riser document with the rest of the option.

## 5. Testing

Pure: title-block data assembly (company/project/option/revisions → props; "Preliminary" when none); sheet list
(systems in scope with placements → numbered sheets; index matches); per-system plan filtering; riser saved layout
merge (saved wins, new spaces slotted); + Device writes placements inside the space polygon; qty edit adds/removes;
Connect same-sheet → route, cross-sheet → RiserLink; RiserLink length in BOM; conduit excluded from BOM; revision
snapshot/restore includes riser. Print: headless print-to-PDF of the set at B and D sizes has the right page count and
page size (see the print/PDF verification harness). Gates: tsc, eslint, test:specs, regressions, test:smoke,
`next build`.

## 6. Out of scope

Levels (upper/lower plan sheets); details/elevations sheets; DWG export; the one-proposal-across-options document.
