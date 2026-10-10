# Conduit riser polish (#321 follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Close #321's deferred review findings and Jeff's two decisions from 2026-10-10: the riser fits whichever
sheet size the design uses (text capped near Bray's size), and the conduit riser page is fully read-only on a phone.

**Architecture:** Small, independent fixes on the shipped #321 code (`src/lib/design/conduit-riser/`,
`src/lib/design/conduit-riser-server.ts`, `src/lib/stores/grid-conduit-riser.ts`,
`src/app/(app)/design/grid/[id]/conduit-riser/`, the plan prompt, settings). No migration, no new data.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before routing/API changes), TypeScript, the spec
harness `scripts/test-review-and-spec.ts`.

## Global Constraints

- Worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/riser-polish`, branch `feat/321-polish`. Never `git stash`;
  never touch `.data/pglite`; never leave a dev server or `tsx` script running.
- Harness: one `async function riserPolish<N>Checks()` per task appended at the END of
  `scripts/test-review-and-spec.ts`, chained in the `.then` chain after the last existing entry; messages start
  "#321 polish".
- Gates per task, real numbers in the report: `node_modules/.bin/tsc --noEmit -p .` (0 errors); `npm run -s test:specs`
  (ALL PASSED, report PASS count vs the previous task's); `node_modules/.bin/eslint <changed source files>` (0 errors);
  Task 1 and Task 2 also `npm run -s test:smoke`; the last task also `npm run build`.
- Grid actions keep `await requireUser()`; admin settings keep `requirePerm("manage_users")`.
- Commit per task: `fix(grid): #321 polish — <task title>` with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Stage only source/test/doc files (never `.superpowers/`).

---

### Task 1: The riser fits the sheet; testable DXF route

**Files:** `src/lib/design/conduit-riser/drawing.ts` (`composeSheets`), `src/lib/design/conduit-riser-server.ts`
(page helper), `src/app/api/grid/[id]/conduit-riser/dxf/route.ts`, `src/app/(app)/design/grid/[id]/conduit-riser/page.tsx`.

- [ ] **Fit the page (Jeff, 2026-10-10).** Today `composeSheets` scales a detail by `min(1, availW/w, area.h/h)` —
  it shrinks to fit 11×17 but never grows on 24×36. Change to `min(MAX_SHEET_SCALE, availW/w, area.h/h)` with
  `export const MAX_SHEET_SCALE = 1.5` (Bray's TL1.5 tags measure ≈1.3–1.5× ours; the cap keeps a small job's tags
  from ballooning). When several details share a page, fit them together: compute one scale for the page so the
  packed shelves fill the available area without exceeding the cap (simplest correct approach: pack at scale 1,
  then scale the packed group up uniformly by `min(cap, availW/usedW, area.h/usedH)`; a page whose content is
  already too big keeps today's per-detail shrink). Tables and notes stay at scale 1. The PDF sheet and the DXF read
  the same pages (one helper), so both change together.
- [ ] Harness: a small detail on a `d`-size area scales up to exactly the cap (or to fit, whichever is smaller) and
  stays inside the area; on a `b`-size area a big detail still shrinks; tables never scale; two details on one page
  keep their relative positions.
- [ ] **Testable route.** Move the DXF route's logic after `requireUser()` into an exported function in
  `conduit-riser-server.ts` — `conduitRiserDxfResponse(projectId: string, query: URLSearchParams): Promise<Response>`
  — so the harness can call it. The route becomes `await requireUser(); return conduitRiserDxfResponse(...)`. Harness:
  behavioural checks (scratch DB fixture with one run) — bad page (`0`, `abc`, `1.5`, too large) → 404; unknown
  project → 404; good page → 200 with `content-type: application/dxf`, attachment disposition with the E-502 name,
  `cache-control: private, no-store`, a body that parses with the harness DXF reader (`readDxf321`).
- [ ] **Riser page lays out once.** `conduit-riser/page.tsx` computes the DXF link count through
  `conduitRiserPagesOf` (a second full layout). Compute the page count from the same pages the page already needs,
  or have the helper accept the already-built view/layouts. No behaviour change.
- [ ] Gates incl. `test:smoke`; commit.

### Task 2: Riser editor — phone read-only, keyboard, busy, prompt fixes

**Files:** `src/app/(app)/design/grid/[id]/conduit-riser/{conduit-riser-editor.tsx,panels.tsx,actions.ts}`,
`src/app/(app)/design/grid/[id]/workspace/riser-prompt.tsx`, `src/app/(app)/design/grid/[id]/use-grid-editor.ts`.

- [ ] **Phone = fully read-only (Jeff, 2026-10-10).** At phone width (use the breakpoint the editor already uses to
  disable dragging — grep it), hide every control that writes: the tool buttons (Connect, + Stub, Reset layout,
  Undo/Redo), Accept / Accept all / Dismiss, and every panel's inputs/buttons (Tag, Run, Detail, Levels, Power types,
  Always show, Defaults, Notes); panels render their values as read-only text. Keep: viewing, detail tabs, option
  picker, Download DXF, Show on plan, warnings. A harness pin per hidden group plus a pure helper test if you add one.
- [ ] **Keyboard.** Hit targets for tags, stubs, runs and level lines get `tabIndex={0}`, `role="button"`, an
  `aria-label` (e.g. "Tag CRO-04", "Run ER-01 → CRO-04, 3/4\"", "Level Catwalk") and select on Enter/Space; Escape
  clears the selection. In Connect mode, Escape or a click on empty canvas cancels a half-picked first end.
- [ ] **Busy everywhere.** Every write path (incl. those using `mustOk`: Reset layout, Remove run, Remove stub, Delete
  detail, note delete) sets `busy` while in flight so drags and other edits are disabled. Fold the duplicated
  setBusy/setErr/setNotice/try/finally in `run`, `connectWithWire` and `acceptKeys` into the one `run` helper.
- [ ] **Undo can't resurrect.** The layout-undo stack is tied to a fingerprint of the layout; include a server
  version (the project's `updatedAt` passed from the page) so returning to an identical layout from elsewhere still
  clears the stack. Harness on the pure history helper.
- [ ] **Estimate-owned pricing refused server-side.** In `patchConduitRiserAction`, when the option is estimate-owned,
  strip `priceWire`/`priceConduit` from `updateRun` and `setDefaults` ops (an op left with nothing to do returns ok
  with no write). Harness on the action's pure helper (factor it out so it's testable without a session).
- [ ] **DetailPanel radios** share one `name` per detail.
- [ ] **Plan prompt:** (a) a late Add success hides the prompt only if it's still the same key (don't swallow a newer
  wire's prompt); (b) a failed Add shows its error through the editor's error slot (`setErr`/status-bar error), not
  "Last action"; (c) harness: accepting a "joins the existing run" prompt adds the new wire to that run.
- [ ] Gates incl. `test:smoke`; browser check on a SCRATCH datadir (never `.data/pglite`; free port; stop it after):
  phone width shows no edit controls; Tab reaches a tag and Enter opens its panel. Screenshots to
  `/private/tmp/claude-501/-Users-sm-Downloads-peak-app/93de6900-0583-4173-8278-57e4c02b32d0/scratchpad/risers/polish/`.
  If a browser check isn't feasible, say so. Commit.

### Task 3: Settings and data hygiene

**Files:** `src/lib/riser-box-types.ts`, `src/lib/stores/riser-box-types.ts`, the Box types card + action,
`src/lib/catalog-connect.ts` (`cleanWireTypes`), the conduit-sizes part search action/client,
`src/lib/design/grid-quote.ts` / `src/lib/design/conduit-riser/bom.ts` (run-end labels),
`src/lib/stores/grid-projects.ts` (`restoreRevision` sheetLevels), `src/lib/design/sheet-adjust.ts` (comment),
`scripts/test-review-and-spec.ts` (#320 store check).

- [ ] **Box types save is strict** like conduit sizes: `validateBoxTypeRows(rows)` returns per-row errors (blank code,
  invalid code, duplicate code, blank/too-long description); the action refuses the save with those errors and the
  card shows them by row. `sanitizeBoxTypes` stays as the read path.
- [ ] **`cleanWireTypes`**: `symbol`/`signal` are read only when `typeof === "string"` (no `String()` coercion of objects).
- [ ] **Conduit-part search** filters per-foot units in the query itself (before any result cap), so a broad query
  ("emt") still finds per-foot parts; the picker's count reflects per-foot matches. If the catalog search can't take
  a unit filter, page through results until the cap of per-foot matches is reached or the source is exhausted.
- [ ] **Run-end labels match the editor**: when `buildGridQuote` builds conduit refusal labels, use designators filled
  in memory the same way the editor/loader do (`fillDesignators` + `formatDesignator` with digits), so the quote's
  refusal names devices exactly as the editor does.
- [ ] **`restoreRevision`**: after merging `sheetLevels`, drop entries naming a level not in the restored `levels`.
- [ ] Tidy the `remapSheetRefs` doc comment.
- [ ] The #320 store checks that switch `designatorDigits` to 1 restore it in a `try/finally`.
- [ ] Harness for each behaviour change. Gates incl. `npm run build`; commit.

### Task 4: Docs

- [ ] Recompute the next free D number from `origin/main` (headings `## D…` and inline `**D…`) right before writing.
  Log: fit-the-page with the 1.5× cap (Jeff, 2026-10-10; page size stays a manual per-design choice); phone =
  read-only riser page (Jeff, 2026-10-10); estimate-owned price flags refused server-side; strict box-type save.
- [ ] PUNCHLIST #321: mark the 24×36 and phone items decided and done; note the polish shipped (commit range).
- [ ] Commit `docs: #321 polish (D…)`.
