# Task 4 report: sanitizeRoomShape

Status: DONE. Created src/lib/design/room-shape/sanitize.ts (verbatim from brief); added 9 checks + imports to scripts/test-room-shape.ts (roomShapePureChecks).
RED: tsx failed MODULE_NOT_FOUND on ../sanitize before implementation. GREEN: 9 new sanitize PASS; room-shape file 86 PASS, 0 FAIL.
Gates: tsc --noEmit 0 errors; npm run test:specs ALL PASSED (25,761 PASS, 0 FAIL).
Test changes: none beyond the brief (used the `victim` form; duplicate-id room is a copy of rooms[0]).
Concerns: none.

## Fix 1: bound sanitize cost

Changes
- geometry.ts `selfCrosses`: uniform-grid broad phase (about sqrt(n) cells a side over the outline's bounding box; a segment sits in every cell its padded bbox overlaps; pairs deduped with a per-segment stamp; adjacent and first/last wrap pairs still skipped). Same answers as the all-pairs scan.
- sanitize.ts: `room()` split into `head()` (object, type, id, name with ASCII controls U+0000-001F/007F stripped before trim/cap) and `body()` (corners/edges/roles). The duplicate-id check now runs between them, before any geometry. Reading stops after 40 kept rooms with `Left out N more rooms: a plan holds at most 40.` A running sampled-point budget (`SHAPE_SAMPLE_BUDGET = 8192`, exported) is checked via `outlinePoints(room, 0.5, 32).length` before `selfCrosses`; an over-budget room gets `Left out "<name>": the plan is too detailed.` and reading stops, with `Left out N more rooms: the plan is too detailed.` for the rest. Notes cap at 10 (10th = `…and N more.`). All other note texts unchanged.
- Tests (roomShapePureChecks, 20 new PASS lines): broad phase vs a test-local brute-force copy on 157 rooms (box, bow-tie, concave L, 64-arc scallop/star/big-bulge, frozen proscenium House, 150 seeded random rooms covering crossing and not); 40-room note; worst case (40 rooms x 64 arc edges bulge 0.4 + 200 junk rooms); detail-budget notes; `__proto__` on shape and room; 65-corner room; pts not an array; coordinate 2001; bulge 11; tpl null -> SHAPE_STALE; notes cap; control chars in names; duplicate id caught before its geometry.

Worst-case time (40 x 64-arc rings + 200 junk, same payload): before 1507 ms (all 40 rooms fully scanned; the reviewer's 18.5 s payload is heavier/other machine), after 22-33 ms (18 rooms kept before the detail budget, 2 notes).

Commands
- `npx tsx scripts/test-room-shape.ts` -> all room-shape checks passed (0 FAIL)
- `npx tsc --noEmit` -> 0 errors; `npx eslint src/lib/design/room-shape scripts/test-room-shape.ts` -> clean
- `npm run test:specs` -> ALL PASSED (25,777 PASS, 0 FAIL)
