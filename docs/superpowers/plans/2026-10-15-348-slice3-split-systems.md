# #348 Slice 3 — Split systems into a new estimate (on the same lead) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Estimator's existing **Move system → New estimate** (`moveSystemToEstimateAction`, `src/app/(app)/estimator/actions.ts` ~811–1000) becomes the spec's "Split systems into a new estimate": the new estimate joins the **same lead/opportunity** (so it numbers `-2`, `-3` … on the lead's estimate number and appears in the lead's Estimates list) and starts with the source estimate's **companies** (owner, architect, consultant, vendor, other — never the bidders, which are per estimate). Moving a second system into that new estimate already works through "Move system → existing estimate", so multi-system splits need no new UI.

**Spec:** §4 Build — "Split systems into a new estimate…: tick systems → a new `-N` estimate on the same lead with the same header, tier, owner and non-bidder parties". Deviation (decision): single-system move, repeated, instead of a multi-select dialog — the existing Move flow (and its vendor-quote carry, bonus-line rules and re-pricing) stays the only code path.

## Global Constraints

- Worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/parties`, branch `feat/348-estimate-parties`. Never `git stash`; never `git add -A`. Trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Fixture slug prefix `g` (`TEST348:g…`).
- The source estimate is never written by the move (unchanged rule — removal from the source is client-side until its Save).
- The new estimate gets `leadId` = the source's `leadId` when set (the DB numbering assigns the `-N` suffix — read `src/lib/stores/quotes.ts` create + `src/lib/estimate-number.ts`; don't compute numbers yourself).
- Parties carry quote → quote: every role except rows with a non-null `bid` (bidders); copies start with `bid: null`; one-owner rule honoured (copyParties already does). Run the copy in `withSavepoint` + try/catch (a failure never fails the move).
- Moving into an EXISTING estimate copies nothing and changes no lead.

### Task 1: Carry the lead and the companies on "Move system → New estimate"

**Files:** `src/lib/parties/rules.ts` (`carriesTo` gains a `quote → quote` rule: `p.bid == null` — widen its parameter to `Pick<Party, "role"> & { bid?: unknown }`), `src/app/(app)/estimator/actions.ts` (the `kind: "new"` create path — pass `leadId` from the source quote, read server-side from `get(sourceId)` / the existing source context, never from the client; after create, `withSavepoint(() => copyParties({type:"quote",id:sourceId},{type:"quote",id:created.id}, user.id))`), `scripts/test-parties.ts` (pure: quote→quote carries owner/architect/vendor/other and plain gc/ec rows without bid, skips a gc row with bid; existing carry checks unchanged), `scripts/test-bids.ts` or `scripts/test-parties.ts` DB check (call the store-level pieces: create a source quote with leadId + an owner party + an architect party + a bidder (gc with bid) via the existing fixture helpers; then call `copyParties(quote→quote)` and assert owner + architect copied, bidder not; and a pure/text pin that the `kind: "new"` path passes `leadId` and calls `copyParties` inside `withSavepoint`).

Read `moveSystemToEstimateAction` fully first: find how it learns the source quote id/context (it may receive `sourceContext` from the client — if `leadId` isn't available server-side, add a server read of the source quote by id with the same auth the action already applies; never trust a client-sent leadId).

Steps: failing pure checks → implement → `npx tsx scripts/test-parties.ts` 0 FAIL → tsc → eslint → `npm run test:specs` (log to /tmp/claude-501/specs-348-s3.log) → `npm run build` → commit `feat(348): split a system into a new estimate on the same lead, with the job's companies`.

### Task 2: Docs + gates + browser pass

- DECISIONS (next free number from origin/main): the split reuses Move system (single system per move; move more into the new estimate); new estimate joins the lead (`-N`) and inherits non-bidder companies; moving into an existing estimate copies nothing.
- PUNCHLIST #348 status: slices 1–3 built; next 4 vendors.
- AGENTS phase 62: a slice-3 line.
- Gates: tsc, test:specs, eslint, build, smoke.
- Browser pass (controller): on an estimate with a lead and an owner + architect party, Move a system → New estimate → the new estimate's number is `<lead#>-2`, its Parties chip shows owner + architect, the lead drawer lists both estimates.
