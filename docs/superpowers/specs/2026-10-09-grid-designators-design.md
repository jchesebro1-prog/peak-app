# Grid: device designators (#320)

Date: 2026-10-09 · Requested by Jeff · Approved in session ("Yes, write and then
implement — I trust you to prep it and push it").

## Asks

Jeff, looking at a Grid plan where every device is labelled with its full catalog
description ("ULTRA-X22 US UL STD N 3 XLR…", "ProX 12U, 19" Deep Deluxe Vertical
Rack with Casters"):

> "How do we get it so the labels are not so long … Maybe a device name or
> designator? … Can the designators be on the plan and then they show up in
> schedules and are edited via the spreadsheet view. Those designators should
> also show up on the riser when we get to that point. Ultimately there is going
> to be a lot of information coming with the devices."

This is **slice 1 of per-device data**: every placed device gets a stable,
editable designator (`MIC-1`, `RCV-2`, `LX-1–24`). The riser and further device
fields are later slices.

## Decisions (Jeff picked each in session)

1. **Format: device-type code + number.** Each device type carries a short
   code (Microphones → `MIC`), editable in Catalog → Device types. Designators
   number per code within a design option: `MIC-1`, `MIC-2`…
2. **Lots take a range.** A lot marker of qty N reserves N consecutive numbers
   and reads `LX-1–24`; the next device continues at `LX-25`.
3. **Stable + Renumber.** A device keeps its designator for life; deleting one
   leaves a gap; a new device takes the next free number. **Renumber…** (whole
   option, one code, or the selection) closes gaps in reading order. Hand-typed
   duplicates are allowed and flagged amber. Each design option numbers on its own.
4. **Spreadsheet = Devices + Schedule tabs.** Devices: one row per placement,
   designator and category editable inline. Schedule: today's grouped table plus
   a Designators column.
5. **Drawing set: designators replace type marks** on plan sheets; the device
   key lists each part's designators.

## Data

- `GridPlacement.designator?: string` (`src/lib/stores/grid-projects.ts`).
  Stored text as typed/assigned, trimmed, ≤ 24 chars, no control chars. For a
  lot the stored value is its **first** designator (`LX-1`); the range is
  derived from `placementQty` at display time. Absent = not yet assigned.
  **Curtains never get one** (they keep their names); the field is ignored and
  stripped on curtain placements.
- `DeviceType.code?: string` (`src/lib/design/device-types.ts`). 1–6 chars,
  `[A-Z0-9]`, uppercased on save. Kept by `cleanType` / `cleanDeviceTypesInput`.
  When absent the **effective code** is `DEFAULT_TYPE_CODES[key]` for the 25
  seeded keys, else derived from the label (first letters of up to three words,
  or the first three letters of a one-word label, uppercased).

  | key | code | key | code | key | code |
  |---|---|---|---|---|---|
  | fixtures | LX | drapery | DR | displays-projectors | DSP |
  | dimming-power | DIM | tracks-hardware | TRK | screens-lifts | SCR |
  | control-networking | LCN | speakers | SPK | cameras | CAM |
  | lighting-accessories | LA | microphones | MIC | switching-distribution | SW |
  | hoists-motors | HST | mixing-processing | MIX | cable-connectors | CBL |
  | truss-pipe | TR | amplifiers | AMP | racks-cases | RACK |
  | rigging-hardware | RH | assistive-listening | ALS | power-distribution | PD |
  | rigging-control | RC | intercom | COM | networking | NET |
  | | | | | parts-consumables | PRT |

- A placement whose part has **no device type** (unmapped, assembly, allowance,
  seeded placeholder with no mappable category) uses its **system letter** —
  the drawing set's `DRAWING_SYSTEMS` letter for the placement's Grid scope
  (A / L / V / R, `G` when unscoped).
- No migration: placements live in the `grid_projects` JSONB document.
  Revisions (`snapshotOf`/`restoreRevision`) and option copies
  (`copyOptionMembers`) already carry every placement field; a copied option
  keeps the same designators, which is correct because numbering is per option.

## Rules — one pure module

`src/lib/design/designators.ts` (client-safe, no DB — the grid-bom rule):

- `cleanDesignator(raw): string | null` — trim, collapse spaces, cap 24, strip
  control chars; `""` → `null`.
- `parseDesignator(s): { code: string; n: number } | null` — `^(.+?)-(\d{1,6})$`
  (case-insensitive code, kept as written); anything else (e.g. `FOH-AMP`) is a
  **custom** designator: valid, displayed as typed, never renumbered, never
  counted for next-free.
- `formatDesignator(stored, qty)` — `qty > 1` and parseable → `CODE-n–m`
  (en dash, `m = n + qty − 1`); otherwise the stored text.
- `occupied(placements)` — per code (case-insensitive), the set of numbers held,
  a lot holding its whole block.
- `nextFree(occupiedForCode, qty)` — the lowest `n ≥ 1` such that
  `n … n+qty−1` are all free.
- `readingOrder(placements, ctx)` — sheet order (`sheetIds`), page, then space
  (spaces in project order by the placement's containing space, unscoped last,
  `pointInPolygon` as the drawing set uses), then top-to-bottom in row bands of
  0.02 (normalized y), then left-to-right.
- `assignMissing(placements, codeOf, ctx)` — gives every non-curtain placement
  without a designator the next free number for its code, in reading order;
  returns a map id → designator. Never touches one that has a designator.
- `renumber(placements, codeOf, ctx, target)` — `target` = `{ all }`,
  `{ code }` or `{ ids }`. Re-issues parseable designators of the targeted
  placements for each affected code from 1 in reading order. With `{ ids }`
  the targeted set takes the lowest numbers not held by **untargeted**
  placements of that code. Custom designators are left alone. Returns the
  id → designator changes only.
- `duplicates(placements)` — ids whose (parsed code, number block) overlaps
  another's, or whose custom text equals another's (case-insensitive).
- `designatorList(items)` — compresses a part's designators for a schedule
  cell: sorted per code, consecutive runs as ranges (`MIC-1–4, MIC-7`),
  custom ones after, in text order.

The code resolver is `codeOfPlacement(pl, part, typeCtx)` in the same module:
part → `typeKeyOfPart` → effective type code; else placement category →
`typeOfCategory`; else system letter.

## Assignment — inside the store, every create path

All placements of an option are numbered against the option's own placements.

- Server helper `src/lib/design/designators-server.ts`:
  `designatorContext(partIds)` loads device types, the type map and the catalog
  parts needed (only the given ids) and returns a `codeOf(pl)` closure plus the
  space/sheet reading-order context. Called **before** `patchDoc`; the pure
  `assignMissing` runs **inside** the `patchDoc` callback against the doc it
  read, so concurrent writes can't hand out the same number twice.
- Wired into every creator: `addPlacement`, `addPlacements`,
  `replaceAutoPlacements` (Auto fill), `pastePlacements` (paste + duplicate —
  the clipboard never carries a designator, so pastes get fresh numbers),
  `setPlacementsPart` (Replace part: a device that changes type and whose
  designator's code is the **old type's** code gets a fresh number in the new
  code; a custom or hand-renamed designator is kept), riser `newPlacements`
  (`src/lib/stores/grid-riser.ts`), and `restoreItems` (undo restore keeps its
  designator — `cleanRestoredPlacement` in `actions.ts` must whitelist it).
  `addCurtainPlacement` assigns nothing.
- **Existing designs** — `ensureDesignators(projectId)` assigns any missing
  ones for every option in one `patchDoc`; a no-op (no write) when none are
  missing. Called from the Grid editor page's server load.
- Lot qty changes (riser qty edits grow/shrink a lot) keep the stored first
  number; a grown block that now overlaps another device is flagged as a
  duplicate, not silently renumbered.

## Editing

- `setDesignatorsAction(projectId, edits: { id, designator }[])` — one batched
  all-or-nothing write through the existing `batchEdit`; `cleanDesignator`; an
  empty value re-issues the next free number; curtains refused. Returns the
  previous values so the client undo stack (`grid-undo.ts`) records one step.
  Editing a designator is a hand edit: it clears `auto` like any other edit.
- `renumberDesignatorsAction(projectId, optionId, target)` — runs `renumber`
  inside one `patchDoc`; one undo step.
- Both `requirePerm` the same permission the Grid's other placement edits use.

## Where designators show

- **Plan (editor):** the label next to each device is `formatDesignator`
  (`MIC-1`, `LX-1–24`) — no `×N` suffix on a lot (the range says it). Curtains
  keep their name. An SVG `<title>` shows `designator · model · description`
  on hover. A duplicate's label is drawn amber. Label width follows the
  shorter text.
- **Property Editor:** an editable **Designator** row (same row pattern as
  Category), with a duplicate warning. Several selected → **Renumber
  selection**.
- **Browser tree:** leaves read `MIC-1 · SM57` instead of the description.
- **Spreadsheet view** (`workspace/spreadsheet-view.tsx`) gains two tabs:
  - **Devices** (default): one row per non-curtain placement on the current
    option — Designator (editable inline), Type, Model, Description, Space,
    Sheet, Qty, Category (editable inline). Enter / Tab commit and move down /
    right; Esc reverts. Filters: type, space, sheet; click a header to sort
    (default reading order). Clicking a row selects that placement (and its
    sheet) on the plan. Amber cell + tooltip on a duplicate. **Renumber…**
    menu: All · this type (current filter) · Selected rows. Built as a column
    list so later slices add device fields as columns.
  - **Schedule**: today's grouped table plus a **Designators** column
    (`designatorList`).
- **/schedule** page and **E-60x** schedule sheets: the same Designators column.
- **Drawing set plan sheets:** each symbol prints its `formatDesignator` where
  the type mark sat (`placeLabels` collision pass unchanged, sized to the new
  text). The device key becomes one row per part: designators
  (`designatorList`) · qty · description. Curtains keep their current mark.

## Out of scope

The riser (next slice — it will show designators on node rows), further device
fields, customer documents, quotes and BOM (unchanged), and per-designator
splitting of lots (a lot stays one row).

## Testing

- Spec harness (`scripts/test-review-and-spec.ts`): parse/format/occupied/
  nextFree/assignMissing/renumber/duplicates/designatorList/reading order and
  the effective-code rules, plus `cleanType` keeping `code`.
- Store tests in the harness (scratch PGlite): every create path above assigns;
  paste gets fresh numbers; restore keeps; Replace part re-codes only
  auto-coded designators; `ensureDesignators` is idempotent (second call writes
  nothing); concurrent adds don't collide.
- The four gates (tsc, test:specs, test:smoke, eslint vs baseline) and a
  browser check on a design with lots, two options and a duplicate.
