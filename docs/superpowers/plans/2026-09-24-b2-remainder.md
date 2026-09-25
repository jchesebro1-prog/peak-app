# B2 remainder — the four-and-a-half carried minors main hasn't built

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** close the carried minors from the #122/#145 reviews that are genuinely still open.

**Why this plan is a fifth the size of the one it replaces.** The original B2 plan covered thirteen items (#138–#141, #149–#157), all marked OPEN in `PUNCHLIST.md`. Verified against main's code on 2026-09-24, **nine are already built** and were never closed out:

| Done on main | Evidence |
|---|---|
| #138 | `reconcilePeakLabelsForMailbox` (`src/lib/gmail/label-sync.ts:109`), called from `bridge.ts` |
| #139 | all four `COMPANY_TYPES` spellings in `PARTNER_TYPES` |
| #140 | `no-claims` in `VENDOR_STATUS_KEYS` + `VENDOR_STATUS_META` |
| #141 | the `key={profile.updatedAt}` remount is gone |
| #150 | route reshaped to `[engagementId]/[noteId]/[attachmentIndex]` — exactly the ask |
| #151 | `ttRowWarnings` now runs in the preview path, not only at commit |
| #152 | `barRect` compares `snapToDay(bar.startAt) > snapToDay(endAt)` |
| #153 | drag uses `calendarDuration` = `snapToDay(due) − snapToDay(start)` |
| #155 (half) | the `" (removed)"` label exists at `quote/controls.tsx:468` |

**The punch statuses are stale, not the code.** Closing them out is part of this plan.

**Decisions to log:** D231–D233.

## Global Constraints

- **Never open `.data/pglite`** — single-process, and opening it runs `migrate()`, a write. `npm run test:specs` makes its own scratch datadir.
- **Never run `git stash`** — one stash is shared across every worktree here and has destroyed other agents' work.
- **Never `pkill -f "next dev"`** — several other worktrees are active. Kill by PID, only after checking that PID's `cwd` is this checkout.
- **Never set `DATABASE_URL`.** Preview and production share one live Neon database.
- Node is at `~/.local/node/bin`.
- Tests are bare `ok(condition, message)` in `scripts/test-review-and-spec.ts`. **Top-level `await` is not legal there** — chain onto an existing `…Checks()`. Fixtures carry a distinctive prefix and a `finally` teardown.
- If `tsc` reports a missing `.next/types/validator.ts`, that is a stale artifact: `rm -rf .next/types .next/dev/types`.
- **Known ~1% flake:** `redeem: tampered code -> not ok` (punch #179, random IV). Pre-existing. Re-run once to confirm; do not fix.
- **Baselines: measure first.** As of the merge commit: `tsc` clean · `test:specs` **2136 PASS / 0 FAIL** · `test:smoke` ALL PASSED · eslint 0 errors.

**The four gates, every task, real numbers:** `npx tsc --noEmit` · `npm run test:specs` · `npm run test:smoke` · `npx eslint <touched files>`.

---

### Task 1: a removed discipline is kept on save, not silently dropped (#155, D231)

**Files:** `src/app/(app)/design/engagements/quote/actions.ts` (~:117-122), plus tests.

The label landed; the behaviour did not — and that combination is worse than before. `controls.tsx:468` now renders a discipline that is on the quote but gone from Settings as `<Name> (removed)`, which reads as "untick this to remove it." But the action still does `.filter((d) => liveDisciplines.has(d))`, so it is dropped on the next save **whether or not the box is ticked**. The label made a silent behaviour visible without making it true.

D219 in the original spec: a discipline already on the quote is **kept** unless the user unticks it.

- [ ] **Step 1:** Read the action and `controls.tsx`'s checkbox rendering. Record the eslint baseline.
- [ ] **Step 2:** Extract the save-side rule into a pure exported helper — `resolveDisciplines(posted, live, existing)` — so it is testable without a DOM, and write the failing tests:
  - a removed discipline still on the quote and still ticked **survives** a save;
  - unticking it by hand **does** remove it;
  - a value in neither `live` nor `existing` is still refused (that intersection exists to stop a forged POST — do not open that hole);
  - a live discipline ticked for the first time is added.
- [ ] **Step 3:** Run them and watch the first fail.
- [ ] **Step 4:** Implement: keep a posted value if `live.includes(v) || existing.includes(v)`; drop anything else. Call it from the action in place of the current intersection.
- [ ] **Step 5:** Gates, then commit.

---

### Task 2: `/schedule?view=timeline` gets one window and one ruler (#157, #154, D232)

**Files:** `src/app/(app)/schedule/page.tsx`, `src/components/gantt/gantt-lib.ts`, plus tests.

**#157** — the page stacks two separately-built grids. The Consulting section renders `GanttGrid` over `consultingRange` (percentage-of-range, no fixed day width, ~:499). The Installs timeline computes its own `tlStart`/`tlDays`/`tlDayW`/`tlGridW` (~:427-448) at a fixed pixel-per-day. Both windows are padded the same way but from **different bar sets**, so the same x-position is, in general, two different dates — and nothing on screen says so.

**#154** — the same function is the timezone problem. `ganttRange(bars, nowTs)` seeds `lo`/`hi` from `nowTs` (`Date.now()`, not noon-anchored) and then floors with `sow()`. Under a UTC server and a US-timezone browser that floor lands on a **different calendar day**, so the hydrated grid shifts by a full day.

Both are one fix: one shared window, noon-anchored.

- [ ] **Step 1:** Read both sections and `ganttRange`/`sow`/`snapToDay`. Note that the spec and the punch entry disagree on whether #154 needs fixing at all — the punch says React self-heals a style-only mismatch, the spec says the columns must match. **The spec wins** (it is the later decision), and anchoring to noon is a two-line change, not the rendering-strategy rewrite the punch feared. Say which you followed in your report.
- [ ] **Step 2:** Write the failing tests: a shared window spans the earliest start and latest end of **both** bar sets; the per-section windows genuinely differed before (a control, so the test proves something); and the anchor is noon, so flooring gives the same calendar day under UTC and under a US offset.
- [ ] **Step 3:** Implement. Compute one `{ start, end, dayWidth }` from the union of both sections' bars and pass it to both. Pick **one** layout strategy — percentage-of-range, matching `GanttGrid`, is the smaller change than converting `GanttGrid` to fixed pixels. Render one ruler above both sections. Anchor the range to local noon rather than `Date.now()`, the convention every other date in this app uses.
- [ ] **Step 4 — look at it.** This is an alignment bug; the gates cannot see alignment. Start a dev server against a **copy** of the dev DB on a scratch `PGLITE_PATH`, load `/schedule?view=timeline`, and confirm a given x-position means the same date in both sections. Screenshot it. Stop the server and delete the copy before finishing.
- [ ] **Step 5:** Gates, then commit.

---

### Task 3: prove phase casing survives a round trip (#156)

**Files:** `scripts/test-review-and-spec.ts` only, unless the test finds a real defect.

The item's own ask: *confirm by inspection that `normalizeLine`'s phase handling is case-preserving and close this as a non-issue, or add the assertion.* Inspection says it is — `task-templates.ts:111` is `phase: String(l.phase || "").trim()` with no `.toLowerCase()`, unlike `discipline` on the next line. But nothing proves it stays that way.

- [ ] **Step 1:** Write a five-cycle round trip — export → import → export … — asserting a phase like `"Schematic Design"` is byte-identical after each cycle. Five because the concern was drift that only appears after more than one pass. Build it from the real export and import entry points, not a hand-rolled approximation.
- [ ] **Step 2:** Run it. **If it passes, that is the deliverable** — say so plainly in your report and change no source. If it fails, that is a real defect: fix `normalizeLine` to preserve casing and say what you found.
- [ ] **Step 3:** Gates, then commit.

---

### Task 4: a fixture-marker convention for the spec harness (#149, D233)

**Files:** `scripts/test-review-and-spec.ts`, new `scripts/sweep-test-fixtures.ts`, `package.json`.

The ask is a **convention**, not another hand-rolled `try`/`finally`. Several tests have been fixed individually; the next author still has to remember.

- [ ] **Step 1:** Read how fixtures are created and torn down today. Note the prefixes already in use (`TEST169:`, `TEST172:`, `TEST173:`, older `TEST:` forms) and pick one canonical shape.
- [ ] **Step 2:** Add a single exported marker constant and a helper that registers a fixture for teardown when it is created, so cleanup is the default rather than a thing to remember. Run teardown in a `finally` at suite level as well as per-test, so a mid-suite throw still cleans up. Convert the pre-existing `#13` fake-quote idiom to it.
- [ ] **Step 3:** `scripts/sweep-test-fixtures.ts` finds every doc whose id carries the marker and soft-deletes it. It **must** follow the repo's two-flag convention via `scripts/db-target.ts`: dry run by default, `--commit` to write, and `--yes` additionally required for a hosted target. Wire it as `npm run test:sweep-fixtures`.
- [ ] **Step 4:** Prove teardown actually happens — run `test:specs` **twice against the same scratch datadir** and assert the second run finds no live doc carrying the marker. A fresh datadir each time would prove nothing.
- [ ] **Step 5:** Gates, then commit.

---

### Task 5: close the stale statuses and log the decisions

- [ ] **Step 1:** Mark #138, #139, #140, #141, #150, #151, #152, #153 **DONE** in `PUNCHLIST.md`, each citing the evidence in this plan's table — they were built on main and never closed. Mark #149, #154, #155, #156, #157 done by this branch.
- [ ] **Step 2:** For #156, if the test passed, say plainly "closed as a non-issue, now proven by a five-cycle test" rather than implying a fix.
- [ ] **Step 3:** Append D231–D233. D232 must record the spec-vs-punch contradiction on #154 and which governed.
- [ ] **Step 4:** Commit.
