# Quote-spawn hardening — the delta against main Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix five real defects in the spawn-on-win work already on `main`, and restore the healing path its own change removed.

**Why this plan exists:** an earlier branch (`keep/engineering-batch-full`) built this whole area independently, not knowing `main` had shipped a parallel implementation in `cfc00ad`. That branch is abandoned. This plan ports **only what main lacks and genuinely needs** — every item below is a defect in main's code, verified against it, not a stylistic preference. Deliberately **not** ported: an `ActionForm`/`useActionState` take on #85 (main's `?err=` redirect idiom works), and a second `safeSweep` (main has `src/lib/safe-sweep.ts`).

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle over PGlite (dev) / Neon (prod).

**Decisions to log:** D225–D227. **Punch items to raise:** #169–#174.

## Global Constraints

- **Never open `.data/pglite`** while anything else may hold it — single-process, and opening it runs `migrate()`, a write. Use `PGLITE_PATH=$(mktemp -d)` or a copy. `npm run test:specs` makes its own.
- **Never run `git stash`** — one stash is shared across every worktree here and has destroyed other agents' work.
- **Never `pkill -f "next dev"`** — several other worktrees are active and a pattern kill takes down their servers. Kill by PID, only after checking that PID's `cwd` is this checkout.
- **Never set `DATABASE_URL`.** Preview and production share one live Neon database.
- **Never await external I/O inside a transaction** (Gmail, Drive, geocoding, PDF, blob). On PGlite an open unit holds the process's only connection.
- Node is at `~/.local/node/bin`.
- Tests are bare `ok(condition, message)` in `scripts/test-review-and-spec.ts`. No jest/vitest. **Top-level `await` is not legal there** — chain onto an existing `…Checks()`. Fixtures use a `TEST169:` prefix and a `finally` teardown.
- **Baselines: measure them first on this branch** — it is freshly cut from main and the numbers from the abandoned branch do not apply.

**The four gates, every task, real numbers:** `npx tsc --noEmit` · `npm run test:specs` · `npm run test:smoke` · `npx eslint <touched files>`.

---

### Task 1: `spawnFromQuote` correctness — three defects (#169, #170, #171, D225)

**File:** `src/lib/stores/quote-spawn.ts` (31 lines today — read it first), plus tests.

**Defect 1 (#169) — a deleted project comes back.** The `default:` branch calls `createProjectFromQuote` unconditionally. Deleting a project created from a won quote adds that quote to a dismissed list (`projects.ts` — `DISMISSED_BLOB_ID`, `dismissedQuoteIds()`, written by `removeProject()`), and the page-load sweep honours it. The per-quote creator never has. So any later re-save of that quote's `won` status silently recreates the project the user deleted.
→ Consult the dismissed list before the project branch. `dismissedQuoteIds()` may be module-private; export it rather than duplicating the blob id.

**Defect 2 (#170) — re-approving an already-won quote now spawns nothing.** `if (quote.status !== "won" || prevStatus === "won") return;` skips the spawn whenever the quote was already won. That was survivable when the four builder approve actions each called `createFromQuote` themselves — but `cfc00ad` deleted all four. So approving a quote that is already `won` (a real path: the approve actions set `won` then act) now creates nothing at all.
→ Let an unchanged-status call still attempt the spawn. Every creator is idempotent on `quoteId`, so the cost is one read when the record exists. Check whether `setStatus` even reaches the router on an unchanged status — it early-returns on `q.status === status` — and fix at whichever layer actually gates it.

**Defect 3 (#171) — consulting `lost` runs a full-collection sweep inside the transaction.** The `lost` branch calls `syncEngagementsFromQuotes()`, which lists every engagement and every quote and patches **every** engagement whose rule fires — other quotes' records, inside this user's unit. One malformed row elsewhere blocks the status change the user asked for; a rollback discards legitimate repairs made for others. On PGlite it also holds the only connection across two full scans.
→ Scope it to this quote. The per-quote rule already exists as a pure function, `engagementSyncAction(quoteStatus, current)` (`src/lib/consulting-stages.ts`). Apply it to this quote's engagement only. If the "Proposal lost" decision copy lives inside the sweep's loop, lift it to a shared helper rather than duplicating the string.

- [ ] **Step 1:** Read `quote-spawn.ts`, `projects.ts`'s dismissed helpers, `engagements.ts`'s sweep body, `consulting-stages.ts`, and `setStatus`. Record the eslint baseline.
- [ ] **Step 2:** Write failing tests for all three: a deleted project is not recreated by a later win; approving an already-won quote of each spawning type still creates its record exactly once; closing quote A's engagement does not modify unrelated quote B's.
- [ ] **Step 3:** Run them and watch all three fail.
- [ ] **Step 4:** Implement. An unrecognised `quoteType` must stay a no-op, never a throw.
- [ ] **Step 5:** Gates, then commit.

---

### Task 2: detached work must not ride the caller's transaction (#172, D226)

**Files:** `src/db/index.ts`, `src/lib/stores/comms.ts`, `src/lib/gmail/label-sync.ts`, plus tests.

Main has `withTransaction` and an ambient `getDb()`. It does **not** have an escape hatch, and there is a live path that needs one: work *started* inside a unit but resolving after it commits still reads the dying `tx` from `getDb()`, and its write throws "Transaction is closed" — into a `.catch(() => {})`. `queuePeakLabelSync` (`comms.ts`) → `label-sync.ts` is exactly that shape, and `setStatus` is now transactional, so a comms flow that reaches a quote status change arms it. The symptom is a Gmail label that silently never syncs.

- [ ] **Step 1:** Add `outsideTransaction<T>(fn: () => T): T` beside `withTransaction`, running `fn` with the ALS context exited (`AsyncLocalStorage.exit`). Document that it is for detached/background work and **not** for sneaking a write past a rollback.
- [ ] **Step 2:** Wrap the detached kickoffs in `comms.ts` and `label-sync.ts`. Wrap inside `queueLabelSync` rather than only at the call site, so the other hook sites are covered too.
- [ ] **Step 3:** Test that a promise started inside a unit and resolving after commit sees the **pooled** handle, not the transaction.
- [ ] **Step 4:** Gates, then commit.

---

### Task 3: restore the healing path `cfc00ad` removed (#173, D227)

**Files:** the four service stores' sweeps and their owning pages, plus tests.

`cfc00ad` deleted `syncFromQuotes()` / `createFromQuote()` from the four builder approve actions. New wins are fine — they are transactional. But wins that happened **before** that commit through the Estimator, Inbox or Home never swept, and the book-wide heal that used to run on any "Won" click is gone. `system` and `consulting` orphans still self-heal on page load; **the four service types now have no repair path at all**, and `syncFromQuotes` in flame-jobs, repair-jobs, inspections and equipment-bookings has zero callers.

- [ ] **Step 1:** Attach each of the four through main's `safeSweep` (`src/lib/safe-sweep.ts`) on the page that owns that record type — **and on its scheduling page**. The scheduler matters: a healed flame job is born `stage: "approved"`, which is precisely what the scheduling screen lists as awaiting a date, so the screen a dispatcher would check is otherwise the one that cannot create it. Verify each page choice by reading which screens call that store's list-all, and report your reasoning.
- [ ] **Step 2 — required by Step 1, do not skip:** make each sweep's coverage map **tombstone-aware**. These sweeps build "already covered" from `listDocs`, which excludes soft-deleted rows. Once a sweep runs on a page that a delete redirects to, deleting a record recreates it — destructive *and* ineffective. `listDocs` takes `{ includeDeleted }`; note it does not merge the `deleted` column, so collect a `Set` of quote ids rather than handing back docs that look live. Apply to the per-quote creators too.
- [ ] **Step 3:** This reverses a documented intent — `flame-jobs.ts` says re-creation after removal is deliberate prototype parity. That was written when the sweep ran on a win, not on every dashboard load. Update the comment and say so in D227.
- [ ] **Step 4:** Tests per store, both directions: a soft-deleted record is **not** recreated; a won quote that never had one still gets one.
- [ ] **Step 5:** Gates, then commit.

---

### Task 4: distinguish a refusal from a defect (#174), then documentation

**Files:** `src/lib/stores/quotes.ts` and the `setStatus` callers, `PUNCHLIST.md`, `DECISIONS.md`.

`setStatus` now throws for two very different reasons: the approval gate refusing a transition, and any defect in the spawn graph. Callers render both as a refusal, so a `TypeError` from a spawner is indistinguishable from a governance decision.

- [ ] **Step 1:** Make the gate's error identifiable (a typed error or a marker property with an exported predicate — match this codebase's existing idiom). Callers render the gate's message verbatim; anything else gets a generic user-facing line **and** a `console.error` with the real error. Do not swallow.
- [ ] **Step 2:** Factor the shared sentence into one exported helper rather than copying it into each caller.
- [ ] **Step 3:** Log D225–D227 and raise #169–#174 in `PUNCHLIST.md`, each stating the defect, how it was verified against main, and the fix.
- [ ] **Step 4:** Gates, then commit.
