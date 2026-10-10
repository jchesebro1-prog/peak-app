# Task 3 report — pure rules (render.ts, todos.ts)

- RED: added `meetings323RenderChecks` + imports; tsc failed TS2307 (`@/lib/meetings/render`, `todos` not found).
- GREEN: created `src/lib/meetings/render.ts` and `todos.ts` verbatim from the brief; chained `.then(() => meetings323RenderChecks(ok))` after VisibilityChecks.
- tsc --noEmit: 0 errors (lookbehind regex accepted). eslint src/lib/meetings scripts/test-meetings-323.ts: clean.
- test:specs: 14674 PASS, 0 FAIL, "ALL PASSED". All 14 new "#323" render/todo checks PASS (46 #323 checks total).
- Commit 3594ec8c.
- Note: another session (conduit-riser worktree) ran test:specs concurrently; I removed only my own temp datadir.

## Fix round 1

Changes (files: `src/lib/meetings/render.ts`, `src/lib/meetings/todos.ts`, `scripts/test-meetings-323.ts`):
1. Render check now seeds `m.todos` (assignee `Speaker_2`) and asserts `view.todos.length === 1 && assigneeDisplay === "Tom Ellis"` unconditionally.
2. `mergeAttendees`: an email-bearing person with no key hit adopts an existing email-less entry with the same normalized name (email set, rekeyed to the lowercased email, source unioned, removed/contactId/userId kept). New checks a3/a4.
3. `mergeAttendees`: names/emails trimmed, blank email = null; a nameless guest (name = email) is upgraded when a later source supplies a name (a2 asserts `name === "Amy"`).
4. `suggestTodoKind`: exact full-name match first (users, then contacts); then first-name match either direction; first name matching both a user and a contact returns "note". Checks: Tom -> note, Tom Ellis -> waiting, Tom Xu -> task, Jeff -> task, full label vs first-name-only contact -> waiting.
5. `mergeTodos`: decided orphans kept, undecided orphans dropped; comment and check updated.
6. `relabel`: single alternation regex (longest first, same space->`[ _]` rule and word guards), function replacer looking up the target; `$`-patterns literal. Checks: `A$AP`, `$&`/`$1`, chained pairs -> "Tom Ellis met Thomas Ellis".
7. `speakerIndexes`: numeric when both numeric, else `localeCompare` (new check with "10" and "abc").
8. resolveAttendees check: unmapped address with same name stays null, pre-resolved attendee not overwritten; refresh check uses a names stub returning null.

RED (before code change): `npm run test:specs` -> 8 FAILED (nameless guest upgrade, name-only+email merge, adopted state, one-pass relabel, speaker index sort, ambiguous first name, full label vs first-name contact, orphan to-do). #323 PASS lines 49.
GREEN: `export PATH=$HOME/.local/node/bin:$PATH; npm run test:specs 2>&1 | grep -E "#323|FAILED|ALL PASSED"` -> 57 `PASS #323` lines, no FAIL; suite tail: `[fixtures] teardown: 981 registered + 174 marked doc(s) removed` / `ALL PASSED`. tsc: 0 errors. eslint on `src/lib/meetings scripts/test-meetings-323.ts`: clean.
