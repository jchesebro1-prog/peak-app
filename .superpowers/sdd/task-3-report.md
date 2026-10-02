# Task 3 report — curtain-mount rules + collector (#292)

**Status:** DONE
**Commit:** 4e0335ae `feat(cutsheets): #292 curtain-mount rules + collector (adapters, types, hardware, weight)`

## Files
- Created `src/lib/curtain-mounts.ts`: verbatim from the brief.
- Created `src/lib/curtain-cut-sheets/estimator-curtains.ts`: verbatim from the brief, with one change (see Deviations 2). The destructuring assignment compiled, so the brief's fallback note was not needed.
- Created `src/lib/curtain-cut-sheets/collect.ts`: verbatim from the brief.
- Appended to `scripts/test-review-and-spec.ts`: the brief's Step 1 block under `// ---- #292 task 3: curtain-mount rules + collector ----` at the end of the file. It uses the Task 1 helpers already in scope (`C292Item`, `C292Section`, `C292_TRACK`, `c292Sec`, `c292CurtainDesc`).

## TDD
- RED: `tsc` reported `Cannot find module '@/lib/curtain-mounts'` (and the other two modules).
- First GREEN run: 10,461 PASS, 1 FAIL. The failing check was "Grid placements of the quote's option become types…": `live.types.length` came back 3, not 2.

## Deviations
1. **Fixture fix in the Grid check.** The brief's project placed `p3` in `optionId: "opt-b"`, but `opt-b` was not in `options`. `ensureOptions` (grid-options.ts) moves any placement whose option is unknown into the first option. So `p3` joined `opt-a` and showed up as a third type. That is the app's real behaviour, and the Grid BOM reads placements the same way. I added `{ id: "opt-b", name: "Alt", … }` to the fixture's `options` so the check tests what it was meant to test. The assertions themselves are unchanged.
2. **No mutation of the caller's project.** `hasOption` and `optionSlice` call `ensureOptions`, which changes the doc in place. The brief's `gridCurtains` passed the caller's project straight in, which would quietly retag the loaded project's placements. `gridCurtains` now reads a shallow copy (`options` array and placements cloned). There are no identity concerns here: identity only matters on the Estimator path (`linkCurtainTracks`), and that path is untouched. It still uses the original `SpecItem` objects.
3. **One extra check** (31 instead of 30): an orphan placement reads as the first option, and the caller's `placement.optionId` is left unchanged.

## Gates
- `npx tsc --noEmit`: 0 errors
- `npm run test:specs`: **10,463 PASS** (10,432 + 31), 0 FAIL, exit 0
- `npx eslint` on the 3 new src files: 0

## Notes for later tasks
- Client code must never import `collect.ts`, because it pulls in `steel.ts`. The preview uses `countCutSheetTypes` from `estimator-curtains.ts`.
- `CutSheetMount.track.line` is the original `SpecItem` that `linkCurtainTracks` returned. `trackHardware` de-dupes on that object, so a curtain with qty 2 on one track counts the track's components once.
- In the Grid live path, mounts come only from picked values or defaults (`source` is never `"track"`). The Grid defaults put a Draw curtain at `track-batten`, so its hardware comes from the mount rules for `track-batten`. While the blob is empty it carries the "No hardware listed for Track — batten mount" warning.
- If a curtain links to a track line whose `seriesId` is an empty string, its type key matches a picked curtain with the same mount key and no track. In that case the group's hardware path follows the first member. This is an edge case and is not handled.

## Fix round 1

- `curtainTypeKey` last element is now `track:<seriesId>:<carrierSpacingIn>` for a track-backed mount, "" otherwise: every type has one hardware source and one spacing; `countCutSheetTypes` shares the key. (Picked vs assumed mounts of the same mount key still merge — both use the mount-rules path; the check asserts one hardware source + spacing per type.)
- qty ≤ 0 lines (Estimator and Grid quoted lines) are left out via `skippedOptional`; fractional qty > 0 rounds, never below 1; non-numeric qty stays 1.
- `CurtainType.weightNote?: "Bottom pipe not included"` set when bottomFinish is pipe-pocket (no number invented).
- Removed unused `GridProjectLite.routes`; fixed the `countCutSheetTypes` docstring.
- Seven new `#292 collect fix:` checks.

Commands + output:
- `npx tsc --noEmit` -> 0 errors
- `npm run test:specs > $TMPDIR/specs292.log` -> exit 0; `grep -c '^PASS '` = 10470 (was 10463, +7); `grep '^FAIL '` empty
- `npx eslint src/lib/curtain-cut-sheets/estimator-curtains.ts src/lib/curtain-cut-sheets/collect.ts` -> 0
