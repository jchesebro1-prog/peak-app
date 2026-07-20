# AI layer removal — design

- **Date:** 2026-07-19
- **Decided by:** Jeff (brainstorming session; follows the note filed under D87)
- **Status:** approved design, awaiting implementation plan
- **Supersedes:** PUNCHLIST item 4's "revisit when rules hit their ceiling" posture and
  the D87-era "the four AI features stay reachable for now" note. Jeff's calls in this
  session: none of the four jobs are needed day-to-day → strip them all out → full
  removal (not hide-only).

## Intent

Peak becomes a fully deterministic app: zero model calls, no `ANTHROPIC_API_KEY` ever
needed, no AI wording anywhere in docs or env setup. The four remaining model-backed
functions — thread summary, customer summary, import extraction, assistant Q&A — are
deleted, along with the whole `src/lib/ai/` layer. Punch item 4 closes permanently.

Rationale: all four features have been inert since birth (no key was ever set), so the
team has never used them; the app is maintained by a non-developer, and a dead
subsystem is a liability; the two jobs that actually mattered were already replaced by
rules (renewal outreach D75, estimate-scope assembly D86) and that pattern won. Git
history keeps everything recoverable; a future return of "ask about my business data"
would be a fresh build, not a re-enable — accepted trade.

## Removal worklist (verified against the tree, 2026-07-19)

**Delete outright:**
- `src/app/(app)/assistant/` — all four files (`page.tsx`, `assistant-client.tsx`,
  `actions.ts`, `snapshot.ts`).
- `src/lib/ai/` — all three files (`client.ts`, `config.ts`, `features.ts`).

**Edit — nav:**
- `src/components/nav/nav-data.ts` — remove the Assistant entry (`key: "assistant"`,
  `href: "/assistant"`, ~line 80), the `"/assistant"` route-key mapping (~line 98), and
  delete `navEntries()` entirely (~lines 85-86) — its only job was inserting the
  Assistant entry when enabled; callers use the exported `NAV` directly.
- `src/components/nav/Nav.tsx` — drop the `aiEnabled` prop (~lines 53, 64, 68).
- `src/app/(app)/layout.tsx` — drop the `aiEnabled` import + prop pass (~lines 7, 48).

**Edit — inbox (summaries):**
- `src/app/(app)/inbox/actions.ts` — delete `summarizeThreadAction` (~line 331) and
  `summarizeCustomerAction` (~line 361).
- `src/app/(app)/inbox/thread-reader.tsx` — delete the summary sidebar block
  (`aiEnabled &&` section, ~lines 565-617+), both action imports, the `aiEnabled` prop.
- `src/app/(app)/inbox/inbox-shell.tsx` — drop the `aiEnabled` prop threading
  (~lines 65, 80, 575, 615).
- `src/app/(app)/inbox/page.tsx` — drop the `aiEnabled` import + pass (~lines 52, 629).

**Edit — import (extraction):**
- `src/app/(app)/import/actions.ts` — delete `extractRowsAction` (~line 51);
  `importRecords` (the CSV path) is untouched.
- `src/app/(app)/import/controls.tsx` — delete the paste-extract affordance
  (`aiEnabled &&` block ~line 124, the `extractRowsAction` call ~line 44, the prop).
- `src/app/(app)/import/page.tsx` — drop the `aiEnabled` import / `aiOn` / prop pass
  (~lines 7, 523, 663).

**Edit — estimator (type rescue, no behavior change):**
- `DraftedLine` is imported `type`-only from `@/lib/ai/features` in three files
  (`ai-scope-modal.tsx:3`, `estimator-client.tsx:19`, `actions.ts:20`). Define
  `DraftedLine` in `ai-scope-modal.tsx` (its primary consumer) and repoint the other
  two imports there; only if that creates an import-direction problem, fall back to a
  tiny `estimator/types.ts`. The D86 rules-based scope flow must behave identically.
  Renaming the modal file is optional and NOT in scope (it would churn imports for
  cosmetics); if touched anyway, keep the diff mechanical.

**Edit — docs:**
- `MASTER-HOWTO.md` §AI (~lines 200-215: key setup, `ANTHROPIC_MODEL`, `AI_DISABLED`)
  — replace the section with a two-line note: removed 2026-07-19 per this spec /
  decision D-next; recover via git history.
- `PUNCHLIST.md` item 4 — status closes: RESOLVED by removal (this spec).
- `DECISIONS.md` — new D entry recording the removal (next free number at build time).
- Sweep `README.md` / `DEPLOY.md` / `CLAUDE.md` / `MASTER-QUESTIONS.md` for stray
  `ANTHROPIC` / AI-feature mentions; update or annotate as historical.

## Deliberately untouched

- Renewal outreach (D75): `lib/renewal-outreach.ts` + `/templates` wording.
- Estimate-scope assembly (D86): the deterministic `draftQuoteScopeAction` path.
- All `/templates` content.
- The DB: the AI layer never persisted anything — no schema or data work anywhere.

## Verification

1. `tsc` and `next build` clean.
2. Greps return zero hits in `src/`: `lib/ai`, `aiEnabled`, `ANTHROPIC`,
   `summarizeThread`, `summarizeCustomer`, `extractRows`, `askAction`.
3. Browser pass: Inbox thread reader (no summary UI, reader otherwise intact), Import
   (CSV flow intact, no paste-extract), estimator scope modal (D86 flow identical),
   nav (no Assistant entry, no dead link), `/assistant` 404s.

## Risk & rollback

Near zero: UI + server-action deletions only, no data writes involved. Rollback is a
single `git revert` of the removal commit.
