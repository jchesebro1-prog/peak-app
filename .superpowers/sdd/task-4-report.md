# Task 4 report — Spreadsheet Devices + Schedule tabs

Commit: 3294682b

## Implemented
- `src/lib/design/grid-device-rows.ts` (pure, client-safe): DeviceRow, DEVICE_COLUMNS, NO_SPACE, deviceRows, filterDeviceRows, sortDeviceRows (null = reading order), cellText, nextCell. Only a type import from the store.
- `workspace/devices-table.tsx`: inline-editable Designator + Category (Enter/Tab save and move, Shift back, Esc discards, a refused save keeps the cell open), type/space/sheet filters, header sort, row click selects on the plan via `focusPlacements` (Shift/Cmd/Ctrl adds), Renumber… menu (All / This type / Selected rows) via the hook's `renumberDesignators`. Edits go through the hook's `saveDesignators` / `saveCategory`, so each is one undo step. Duplicates use DESIGNATOR_DUPLICATE_COLOR; accent not used in the table.
- `workspace/spreadsheet-view.tsx`: Devices (default) / Schedule tabs; the Schedule tab keeps today's ScheduleTable and the printable-schedule link.
- Used the brief's code verbatim; it matched the real hook API (signatures verified in use-grid-editor.ts: saveDesignators, renumberDesignators, focusPlacements, saveCategory, designatorDupes, categoryCounts).

## Tests
- TDD: test appended + chained first; run failed with ERR_MODULE_NOT_FOUND (grid-device-rows) before implementation.
- After: 8 new #320 assertions PASS; `npm run test:specs` 14448 PASS / 0 FAIL (baseline 14440 + 8). tsc 0 errors; eslint (3 touched source files) clean.
- Grep: no `@/lib/stores/*` value import or designators-server in client files.

## Files
src/lib/design/grid-device-rows.ts (new), workspace/devices-table.tsx (new), workspace/spreadsheet-view.tsx, scripts/test-review-and-spec.ts.

## Concerns
- No `next build` run (instructed not to); the brief's Step 7 build is left to the controller.
- Not exercised in a browser (no dev server). Global key handlers skip `[data-no-nudge]`, so typing in the cells won't trigger shortcuts.
- Devices rows use `project.spaces` unfiltered by option (spaces aren't option-scoped in the schema).

## Fix round 1

Changes:
1. `devices-table.tsx`: each sortable header is a `<button type="button">` (inherits font/colour, no border/background, full width, left-aligned, default focus ring kept) inside the `<th>`; `aria-sort` stays on the `<th>`.
2. `use-grid-editor.ts`: `saveCategory` now returns `Promise<boolean>` (false on a failed nudge flush, a thrown action or `!r.ok`; true on success). Only other caller is `property-editor.tsx` (fire-and-forget; unchanged). `devices-table.tsx` `commit` returns (cell stays open, text kept) on false, like the designator path.
3. Renumber "This type": no type filter keeps "pick a type filter first"; a filter with no code (Unmapped / Assemblies / Allowances key) shows "This type — no code for this type", disabled.
4. Doc comment now says there is no blur handler: clicking away leaves the cell open; Esc discards.
5. `grid-device-rows.ts` `sortDeviceRows`: blank text cells (designator, category, ...) sort last in both directions; numeric sort unchanged. New #320 assertion "a blank designator sorts last in both directions" in `scripts/test-review-and-spec.ts`.

Commands:
- `npx tsc --noEmit`: 0 errors.
- `npx eslint --ignore-pattern scripts/test-review-and-spec.ts <3 source files>`: clean.
- `npm run test:specs`: ALL PASSED (new assertion present, no FAIL lines).
