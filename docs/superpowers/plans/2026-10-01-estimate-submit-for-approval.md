# Estimate Submit-for-Approval Implementation Plan (#284)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Estimator's hidden, collapsible review bar with one state-driven "next step" control (Submit for approval → Approve / Send back → Send to customer →), shared by the Estimator and the Quotes hub. Approvers self-approve their own quotes, approvals go stale when the price or lines change, and approvers and owners get in-app bell items that link straight to the quote.

**Architecture:** Pure rules live in client-safe `src/lib` modules: an approval fingerprint, self-approval in the existing `review-limits.ts` rules, and a `quoteNextStep()` view model. The store gate (`decideApprovalGate` in `src/lib/stores/quotes.ts`) consumes them. One server-only ops module guards every review mutation. One "use server" actions file serves a single client component, `QuoteNextStep`, that both screens render. Notifications are derived from quote state; there are no new tables or migrations.

**Tech Stack:** Next.js 16 App Router (server actions, client components), TypeScript, Drizzle doc-store (JSONB docs), the `scripts/test-review-and-spec.ts` harness (`ok(cond, msg)` → PASS/FAIL lines).

**Spec:** `docs/superpowers/specs/2026-10-01-estimate-submit-for-approval-design.md`

## Global Constraints

- **Worktree:** `/Users/sm/Downloads/peak-app/.claude/worktrees/estimate-approval`, branch `feat/284-estimate-approval`. It has no `node_modules`, so run `npm ci` once before any gate. Never symlink `node_modules`; Turbopack panics. Copy `.env.local` and `next-env.d.ts` from the main checkout if a gate needs them.
- **Never `git stash`.** The stash stack is shared with sibling worktrees, so commit WIP instead.
- **The dev DB is single-process.** Never open `.data/pglite` from this worktree. `npm run test:specs` already uses a throwaway `mktemp -d` datadir.
- **Client-safe modules** (`review-line.ts`, `review-limits.ts`, `approval-snapshot.ts`, `quote-next-step.ts`, `quote-links.ts`) must never import a store, `@/db`, settings, users or session. `tsc` can't catch a violation; only `next build` or loading the page does. Run `npx next build` in the final gate.
- **Copy.** Use these strings verbatim:
  - Buttons: "Submit for approval", "Resubmit for approval", "Approve", "Send back…", "Send to customer →", "Withdraw", "Attest approval…", "Assign to…", "Submit for approval anyway".
  - Modal: "Send back for changes".
  - Pills: "Not submitted", "In review · with Jeff" / "In review · any approver", "Changes requested · Jeff", "Approved · Jeff", "Attested · Nic", "Self-approved · Jeff", "Auto-approved", "Approval cleared".
- **The status model is unchanged.** Draft/Sent/Won/Lost and pipeline stage tag = status (D236). Leave the service builders' "Mark as approved" (`engine-owned-flow`) and the portal bypasses alone.
- **Harness conventions.** Append new sync checks and the new async function at the **end of `scripts/test-review-and-spec.ts`**. Imports go at the start of that block, aliased with an `a284` prefix (ESM hoists them; see the `r282d…` imports near line 39048). Fixture ids use `fixtureId(284, "<slug>")` from `./test-fixtures`. Register the async block on the promise chain right after `.then(() => rewards282LostAsyncChecks())` (around line 10685).
- **Existing source-text assertions.** The harness has checks that grep source strings: line ~30416 for `needsLimits`, ~30008 for `checkApprovalGate(cur` appearing 2×, ~30294 for the reviews page. When a task changes a pinned string, update that assertion in the same commit and say so in the commit message.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **The per-task gate:**
  - `npx tsc --noEmit -p .`: 0 errors.
  - `npm run test:specs 2>&1 | tail -3`: ends `ALL PASSED`.
  - `npx eslint <touched files>`: no new errors.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/approval-snapshot.ts` | **new**, pure | `approvalFingerprint(q)`, `approvalSnapshotMatches(q)`, `isStaleSnapshotApproval(q)` |
| `src/lib/review-limits.ts` | modify | `RosterEntry.canApprove`, `canSelfApprove()`, `approvalHolds()` respects snapshots, `ReviewLike.approvedAgainst` |
| `src/lib/review-limits-server.ts` | modify | roster carries `canApprove` |
| `src/lib/review-line.ts` | modify | `"self"` method wording, `staleApprovalLine()` |
| `src/lib/stores/quotes.ts` | modify | `ApprovalMethod` `"self"`, `QuoteReview.approvedAgainst`, stamps on approve/attest, `selfApprovedReview`, gate order, `checkApprovalGate(actor)`, `withdrawReview`, implicit claim in `requestChanges` |
| `src/lib/quote-review-ops.ts` | **new**, server-only | guarded submit/withdraw/approve/sendBack/attest/send → `{ok}\|{ok:false,error}` |
| `src/lib/quote-next-step.ts` | **new**, pure | `quoteNextStep(input)` → `QuoteNextStepView` |
| `src/lib/quote-next-step-server.ts` | **new**, server-only | `quoteNextStepFor(q, viewer)` |
| `src/app/(app)/quotes/review-actions.ts` | **new**, "use server" | the six client-callable actions returning `NextStepSync` |
| `src/components/quote-review/quote-next-step.tsx` | **new**, client | pill + primary + ⋯ menu + Send back / Attest modals |
| `src/app/(app)/estimator/estimator-client.tsx` | modify | toolbar control, strip, gate-banner action, phone approver, review bar removed |
| `src/app/(app)/estimator/actions.ts` | modify | old review actions delegate to ops; `gateRefused` on status/stage refusals |
| `src/app/(app)/estimator/page.tsx` | modify | passes initial `next` view |
| `src/app/(app)/quotes/page.tsx`, `quotes/actions.ts` | modify | hub panel renders `QuoteNextStep`; `submitQuoteForReview` delegates |
| `src/app/(app)/reviews/actions.ts`, `page.tsx`, `review-list.tsx` | modify | quotes go through ops; no Claim for quotes; My queue includes unassigned quotes |
| `src/lib/nav-counts.ts`, `src/app/(app)/layout.tsx`, `src/lib/stores/notif-prefs.ts` | modify | "Needs your approval" for all approvers, new "Back from review" group |
| `src/lib/queue.ts`, `src/lib/dashboard/home-metrics.ts`, `src/app/(app)/page.tsx`, `src/app/(app)/_dashboard/widgets/home-cards.tsx` | modify | to-do and Home alerts for approvers, linking to the quote |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | modify | D506–D509, #284, phase-status line |

---

### Task 1: Approval fingerprint + staleness

**Files:**
- Create: `src/lib/approval-snapshot.ts`
- Modify: `src/lib/review-limits.ts` (`ReviewLike`, `approvalHolds`)
- Modify: `src/lib/stores/quotes.ts` (`ApprovalMethod`, `QuoteReview`, `rv()`, `approve()`, `attestApproval()`, `requestChanges()`, `setStatus` `needsLimits`)
- Modify: `src/lib/review-line.ts` (`ApprovedReviewLike.method` union, `staleApprovalLine`)
- Test: `scripts/test-review-and-spec.ts` (EOF block + update the ~30416 `needsLimits` assertion)

**Interfaces:**
- Produces:
  - `type ApprovalSnapshot = { sell: number; linesKey: string }`
  - `approvalFingerprint(q: FingerprintInput): ApprovalSnapshot`
  - `approvalSnapshotMatches(q: FingerprintInput & { review?: { approvedAgainst?: ApprovalSnapshot | null } | null }): boolean`
  - `isStaleSnapshotApproval(q): boolean`
  - `QuoteReview.approvedAgainst?: ApprovalSnapshot | null`
  - `ApprovalMethod` now includes `"self"`
  - `staleApprovalLine(review: ApprovedReviewLike): string`

- [ ] **Step 1: Write the failing pure checks.** Append to EOF of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #284 — estimate submit-for-approval. Task 1: approval fingerprint.
   ====================================================================== */
import { approvalFingerprint as a284Fp, approvalSnapshotMatches as a284Matches, isStaleSnapshotApproval as a284Stale } from "@/lib/approval-snapshot";
import { approvalHolds as a284Holds, NO_REVIEW_LIMITS as a284NoLimits } from "@/lib/review-limits";
import { staleApprovalLine as a284StaleLine, approvedReviewLine as a284ApprovedLine } from "@/lib/review-line";
{
  const item = (o: Record<string, unknown> = {}) => ({ id: 1, sku: "A-1", desc: "Truss", qty: 2, unit: "ea", cost: 50, price: 100, ...o });
  const quote = (items: unknown[], value = 200, extra: Record<string, unknown> = {}) => ({
    quoteType: "system", value, spec: { sections: [{ id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 0, items }] }, ...extra,
  });
  const base = quote([item()]);
  const fp = a284Fp(base);
  ok(fp.sell === 200 && typeof fp.linesKey === "string" && fp.linesKey.length > 0, "#284 fp: fingerprint carries the gross sell and a non-empty lines key");
  ok(a284Fp(quote([item({ desc: "Truss — black" })])).linesKey === fp.linesKey, "#284 fp: a description-only edit keeps the lines key");
  ok(a284Fp(quote([item({ qty: 3 })], 300)).linesKey !== fp.linesKey, "#284 fp: a qty change changes the lines key");
  ok(a284Fp(quote([item({ sku: "B-2" })])).linesKey !== fp.linesKey, "#284 fp: swapping the part (same total) changes the lines key");
  ok(a284Fp(quote([item(), item({ id: 2, sku: "C-3", qty: 1, price: 0 })])).linesKey !== fp.linesKey, "#284 fp: adding a line changes the lines key");
  const twoA = quote([item(), item({ id: 2, sku: "C-3" })], 400);
  const twoB = quote([item({ id: 2, sku: "C-3" }), item()], 400);
  ok(a284Fp(twoA).linesKey === a284Fp(twoB).linesKey, "#284 fp: line order does not matter");
  ok(a284Fp({ quoteType: "flame_test", value: 1000, spec: null }).sell === 1000, "#284 fp: a service quote fingerprints on its sell alone");
  const approved = (q: Record<string, unknown>, snap: unknown, method = "in_app") =>
    ({ ...q, review: { state: "approved", method, decidedBy: "Jeff Chesebro", reviewer: "Jeff Chesebro", note: "", approvedAgainst: snap } });
  ok(a284Matches(approved(base, fp)), "#284 fp: an unchanged quote matches its snapshot");
  ok(a284Matches(approved(quote([item({ desc: "x" })]), fp)), "#284 fp: a wording edit still matches");
  ok(!a284Matches(approved(quote([item({ qty: 3 })], 300), fp)), "#284 fp: a priced change no longer matches");
  ok(!a284Matches(approved(quote([item()], 250), fp)), "#284 fp: a changed sell alone no longer matches");
  ok(a284Matches(approved(quote([item({ qty: 3 })], 300), null)), "#284 fp: a legacy approval (no snapshot) always matches");
  ok(a284Stale(approved(quote([item({ qty: 3 })], 300), fp)) && !a284Stale(approved(base, fp)), "#284 fp: isStaleSnapshotApproval is true only for a changed, snapshotted, non-auto approval");
  ok(!a284Stale(approved(quote([item({ qty: 3 })], 300), fp, "auto_limit")), "#284 fp: an auto_limit approval is never snapshot-stale (its own #242 rule governs)");
  ok(a284Holds(approved(base, fp) as never, a284NoLimits) && !a284Holds(approved(quote([item({ qty: 3 })], 300), fp) as never, a284NoLimits),
    "#284 fp: approvalHolds honours the snapshot for in-app approvals");
  ok(!a284Holds(approved(quote([item({ qty: 3 })], 300), fp, "attested") as never, a284NoLimits), "#284 fp: …and for attested approvals");
  ok(a284StaleLine({ method: "in_app", decidedBy: "Jeff Chesebro", reviewer: null, note: "" }) === "Approval cleared — the price or lines changed since Jeff approved it",
    "#284 fp: the stale-approval sentence");
  ok(a284ApprovedLine({ method: "self", decidedBy: "Jeff Chesebro", reviewer: null, note: "" }) === "Self-approved by Jeff", "#284 fp: the self-approval sentence");
}
```

- [ ] **Step 2: Run the checks and confirm they fail.** `npm run test:specs 2>&1 | grep -E "#284|Cannot find|error" | head`. Expected: a module-not-found error for `@/lib/approval-snapshot`.

- [ ] **Step 3: Create `src/lib/approval-snapshot.ts`:**

```ts
/**
 * #284 — what an approval was granted against, and whether the quote still
 * matches it (spec §2). Approvals hold through wording edits (descriptions,
 * narrative, notes, terms) and go stale when the sell total or the priced
 * line set changes. Staleness is DERIVED, never stored — the same principle
 * as D92's approvalIsStale for consulting phases.
 *
 * Pure and CLIENT-SAFE: imports only the pure rewards credit-line helpers.
 * Rewards credit lines are excluded and the sell is the GROSS (pre-credit)
 * value, so a credit re-clamp on save (#282) never clears an approval.
 *
 * auto_limit approvals are deliberately NOT snapshot-checked here — #242's
 * own rule (autoSnapshotUnchanged / still fits the owner's limit) governs them.
 */
import { grossQuoteValue, isRewardCreditItem } from "@/lib/rewards/credit-line";

export type ApprovalSnapshot = { sell: number; linesKey: string };

export type FingerprintInput = {
  value?: unknown;
  spec?: unknown;
  quoteType?: unknown;
  flameTest?: unknown;
  inspection?: unknown;
  repair?: unknown;
};

type ReviewWithSnapshot = { state?: string; method?: string | null; approvedAgainst?: ApprovalSnapshot | null };

const n = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "");
const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const b = (v: unknown): string => (v ? "1" : "0");

/** FNV-1a 32-bit, hex — a stable short key; collisions only matter to an
 *  adversary editing their own quote, who could just resubmit anyway. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function linesKeyOf(spec: unknown): string {
  const rows: string[] = [];
  const sp = (spec && typeof spec === "object" ? spec : {}) as { sections?: unknown; lines?: unknown };
  if (Array.isArray(sp.sections)) {
    for (const sec of sp.sections as Array<Record<string, unknown>>) {
      if (!sec || typeof sec !== "object") continue;
      rows.push(["sec", s(sec.kind), n(sec.freightPct), n(sec.sellOverride)].join("|"));
      const items = Array.isArray(sec.items) ? (sec.items as Array<Record<string, unknown>>) : [];
      for (const it of items) {
        if (!it || typeof it !== "object" || isRewardCreditItem(it)) continue;
        rows.push(["it", s(it.sku), b(it.custom), n(it.qty), n(it.price), n(it.extSellOverride), b(it.option), b(it.labor)].join("|"));
      }
    }
  }
  if (Array.isArray(sp.lines)) {
    for (const l of sp.lines as Array<Record<string, unknown>>) {
      if (!l || typeof l !== "object") continue;
      rows.push(["ln", s(l.sku), n(l.qty), n(l.ext)].join("|"));
    }
  }
  rows.sort();
  return fnv1a(rows.join("\n"));
}

/** What an approval is granted against, right now. */
export function approvalFingerprint(q: FingerprintInput): ApprovalSnapshot {
  return { sell: grossQuoteValue(q as never), linesKey: linesKeyOf(q.spec) };
}

/** True when the quote still matches its approval snapshot. A review with no
 *  snapshot (legacy, or decided before #284) always matches. */
export function approvalSnapshotMatches(q: FingerprintInput & { review?: ReviewWithSnapshot | null }): boolean {
  const a = q.review?.approvedAgainst;
  if (!a) return true;
  const cur = approvalFingerprint(q);
  return Math.abs(cur.sell - a.sell) < 0.005 && cur.linesKey === a.linesKey;
}

/** An in-app / attested / self approval the quote has since moved away from. */
export function isStaleSnapshotApproval(q: FingerprintInput & { review?: ReviewWithSnapshot | null }): boolean {
  const r = q.review;
  return !!r && r.state === "approved" && r.method !== "auto_limit" && !approvalSnapshotMatches(q);
}
```

- [ ] **Step 4: Wire the snapshot into `review-limits.ts`.**
  - In `ReviewLike`, add `approvedAgainst?: { sell: number; linesKey: string } | null;`.
  - Add `import { approvalSnapshotMatches } from "@/lib/approval-snapshot";` next to the other imports.
  - In `approvalHolds`, replace `if (r.method !== "auto_limit") return true;` with:

```ts
  if (r.method !== "auto_limit") return approvalSnapshotMatches(q);
```

  Then update the doc comment above `approvalHolds`: "In-app, attested, self and legacy approvals: hold while the quote matches its #284 snapshot (approval-snapshot.ts); no snapshot = legacy, holds."

- [ ] **Step 5: Update the store types and stamps in `src/lib/stores/quotes.ts`.**
  - Add `import { approvalFingerprint, approvalSnapshotMatches, type ApprovalSnapshot } from "@/lib/approval-snapshot";`.
  - Change `export type ApprovalMethod = "in_app" | "attested" | "auto_limit";` to `"in_app" | "attested" | "auto_limit" | "self";` and add a doc bullet: `"self" — #284: the owner holds \`approve\` and moved their own quote to sent/won; stamped by the gate, like auto_limit.`
  - In `QuoteReview`, add:

```ts
  /** #284: what an in_app / attested / self approval was granted against
   *  (gross sell + priced-lines key). Null/absent on legacy approvals and on
   *  auto_limit (which keeps its own `auto` snapshot). */
  approvedAgainst?: ApprovalSnapshot | null;
```

  - In `rv()`, add `approvedAgainst: o.approvedAgainst ?? null,`.
  - In `approve()`, after `review.method = "in_app";`, add `review.approvedAgainst = approvalFingerprint(q);`.
  - In `attestApproval()`, after `review.method = "attested";`, add `review.approvedAgainst = approvalFingerprint(q);`.
  - In `requestChanges()`, after `review.auto = null;`, add `review.approvedAgainst = null;`.
  - In `autoApprovedReview()`'s returned object, add `approvedAgainst: null,`.
  - In `setStatus`, replace the `needsLimits` line with:

```ts
  const needsLimits =
    gated && !(hasApproval(q.review) && q.review?.method !== "auto_limit" && approvalSnapshotMatches(q));
```

    and extend the comment above it: "#284: a snapshot-stale approval also needs the context (the owner may self-approve)."

- [ ] **Step 6: Update `src/lib/review-line.ts`.**
  - Change `method?: "in_app" | "attested" | "auto_limit" | null;` to also include `"self"`.
  - In `approvedReviewLine`, add as the first line of the body (after the auto_limit branch):

```ts
  if (review.method === "self") return "Self-approved by " + firstName(review.decidedBy || "");
```

  - Append:

```ts
/** #284: an in-app / attested / self approval the quote has since moved away
 *  from (price or priced lines changed) — it no longer counts. */
export function staleApprovalLine(review: ApprovedReviewLike): string {
  return "Approval cleared — the price or lines changed since " + firstName(review.decidedBy || review.reviewer || "") + " approved it";
}
```

- [ ] **Step 7: Update the pinned `needsLimits` assertion.** Find it with `grep -n "const needsLimits = gated" scripts/test-review-and-spec.ts`. Change its `ss.includes('…')` string to the new two-line form, or to a regex that matches `const needsLimits =\s*gated && !\(hasApproval\(q\.review\) && q\.review\?\.method !== "auto_limit" && approvalSnapshotMatches\(q\)\);`. Keep its PASS message, and append " (#284: snapshot-aware)".

- [ ] **Step 8: Add DB checks for the stamps.** Append the async function at EOF and register it on the chain after `rewards282LostAsyncChecks()`:

```ts
async function approval284AsyncChecks(): Promise<void> {
  const { fixtureId, createFixture } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const id = (slug: string) => fixtureId(284, slug);
  const item = { id: 1, sku: "A-1", desc: "Truss", qty: 2, unit: "ea", cost: 50, price: 100 };
  const mk = (slug: string, owner: string, extra: Record<string, unknown> = {}) =>
    createFixture("quotes", {
      id: id(slug), name: `T284 ${slug}`, customer: "", customerId: null, status: "draft", source: "estimator", quoteType: "system",
      owner, preparedBy: owner, value: 200, margin: 0.5, history: [], createdAt: 1, updatedAt: 1,
      spec: { sections: [{ id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 0, items: [item] }], mobs: [] },
      review: { state: "in_review", reviewer: null, submittedBy: owner, submittedAt: 1, decidedBy: null, decidedAt: null, note: "", method: null },
      ...extra,
    } as never);

  // Task 1 — approve() stamps the snapshot; a priced edit makes the gate refuse.
  await mk("t1-approve", "T284 Nobody");
  const a = await Q.approve(id("t1-approve"), { by: "Jeff Chesebro" });
  ok(!!a?.review?.approvedAgainst && a.review.approvedAgainst.sell === 200, "#284 DB: approve() stamps approvedAgainst with the gross sell");
  await Q.patchQuote(id("t1-approve"), (d) => { (d.spec as { sections: { items: { qty: number }[] }[] }).sections[0].items[0].qty = 3; d.value = 300; });
  let refused = false;
  try { await Q.setStatus(id("t1-approve"), "sent", "T284 Nobody"); } catch (e) { refused = Q.isApprovalGateRefusal(e); }
  ok(refused, "#284 DB: after a priced edit the old approval no longer opens Send");
  await mk("t1-wording", "T284 Nobody");
  await Q.approve(id("t1-wording"), { by: "Jeff Chesebro" });
  await Q.patchQuote(id("t1-wording"), (d) => { (d.spec as { sections: { items: { desc: string }[] }[] }).sections[0].items[0].desc = "Truss, black"; d.scopeNarrative = "new words"; });
  const sent = await Q.setStatus(id("t1-wording"), "sent", "T284 Nobody");
  ok(sent?.status === "sent", "#284 DB: a wording-only edit keeps the approval — Send goes through");
}
```

  Check that `patchQuote` is exported from the store (`grep -n "export async function patchQuote" src/lib/stores/quotes.ts`). If it isn't, use `upsertDoc("quotes", {...await Q.get(id), …})` from `@/db/doc-store` instead.

- [ ] **Step 9: Run the gate.** `npx tsc --noEmit -p .` should show 0 errors, and `npm run test:specs 2>&1 | grep -E "^FAIL|#284|ALL PASSED|FAILED" | tail -30` should show every #284 line PASS and end `ALL PASSED`.

- [ ] **Step 10: Commit.**

```bash
git add src/lib/approval-snapshot.ts src/lib/review-limits.ts src/lib/stores/quotes.ts src/lib/review-line.ts scripts/test-review-and-spec.ts
git commit -m "feat(review): approvals go stale when the price or lines change (#284 task 1)

approvedAgainst snapshot on in-app/attested approvals; approvalHolds and the
gate derive staleness; wording edits keep the approval. Updates the pinned
needsLimits source assertion.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Self-approval in the gate

**Files:**
- Modify: `src/lib/review-limits.ts` (`RosterEntry`, new `canSelfApprove`)
- Modify: `src/lib/review-limits-server.ts` (roster `canApprove`)
- Modify: `src/lib/stores/quotes.ts` (`selfApprovedReview`, `decideApprovalGate` order, `checkApprovalGate(q, status, actor)`)
- Modify: `src/app/(app)/estimator/actions.ts` (pass `user.name` to both `checkApprovalGate(cur, …)` calls)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `approvalFingerprint` (Task 1).
- Produces:
  - `RosterEntry.canApprove?: boolean`
  - `canSelfApprove(q: ReviewableQuote, ctx: ReviewLimitContext, actor: string | null): string | null`, which returns the owner name or null
  - `selfApprovedReview(owner: string, q: GateQuote, now: number): QuoteReview`
  - `checkApprovalGate(q: Quote | null, status: "sent" | "won", actor?: string | null)`

- [ ] **Step 1: Write the failing checks.** Append to the EOF sync block area (a new `{ … }` block after Task 1's):

```ts
import { canSelfApprove as a284CanSelf } from "@/lib/review-limits";
import { decideApprovalGate as a284Decide } from "@/lib/stores/quotes";
{
  const roster = [
    { id: "u1", name: "Jeff Chesebro", status: "active", canApprove: true },
    { id: "u2", name: "Nic Trapani", status: "active", canApprove: false },
  ];
  const ctx = { limits: {}, roster };
  const q = (owner: string, state = "none") => ({
    quoteType: "system", value: 500, owner, preparedBy: owner, spec: { sections: [] },
    review: { state, reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "", method: null },
  });
  ok(a284CanSelf(q("Jeff Chesebro") as never, ctx, "Jeff Chesebro") === "Jeff Chesebro", "#284 self: an approver owner moving their own quote self-approves");
  ok(a284CanSelf(q("Jeff Chesebro") as never, ctx, "Nic Trapani") === null, "#284 self: someone else moving an approver's quote does not");
  ok(a284CanSelf(q("Nic Trapani") as never, ctx, "Nic Trapani") === null, "#284 self: an owner without approve does not");
  ok(a284CanSelf(q("Jeff Chesebro", "changes") as never, ctx, "Jeff Chesebro") === null, "#284 self: changes requested blocks self-approval");
  const d = a284Decide("sent", q("Jeff Chesebro") as never, ctx, {}, 1000, "Jeff Chesebro");
  ok(d.ok && d.stamp?.method === "self" && d.stamp.decidedBy === "Jeff Chesebro" && !!d.stamp.approvedAgainst, "#284 self: the gate stamps a self approval with a snapshot");
  const d2 = a284Decide("sent", q("Nic Trapani") as never, ctx, {}, 1000, "Nic Trapani");
  ok(!d2.ok && d2.error.includes("needs an approval on record"), "#284 self: a non-approver with no limit is still refused");
  const lim = { limits: { u1: { system_plain: 10_000 } }, roster };
  const d3 = a284Decide("sent", q("Jeff Chesebro") as never, lim as never, {}, 1000, "Jeff Chesebro");
  ok(d3.ok && d3.stamp?.method === "self", "#284 self: self-approval wins over an auto_limit grant for an approver owner");
}
```

- [ ] **Step 2: Run the checks and confirm they fail.** `npm run test:specs 2>&1 | grep -E "#284 self|error" | head`. Expected: a type or import error for `canSelfApprove`.

- [ ] **Step 3: Add the roster flag and `canSelfApprove` to `review-limits.ts`.** Change `export type RosterEntry = { id: string; name: string; status: string };` to:

```ts
export type RosterEntry = {
  id: string;
  name: string;
  status: string;
  /** #284: the person holds the `approve` permission (live roster). */
  canApprove?: boolean;
};
```

Then add this after `canAutoApprove`:

```ts
/**
 * #284 — an approver's own quote approves itself at the gated transition
 * (Jeff 2026-10-01: "Approvers' own quotes are treated as approved"). Only
 * when the person MOVING the quote is its owner, the owner holds `approve` on
 * the live roster, and no reviewer asked for changes (same block as attest /
 * auto, #60). Returns the owner's name, or null.
 */
export function canSelfApprove(q: ReviewableQuote, ctx: ReviewLimitContext, actor: string | null): string | null {
  if (q.review?.state === "changes") return null;
  const owner = quoteOwnerName(q);
  const who = (actor || "").trim();
  if (!owner || !who || owner.toLowerCase() !== who.toLowerCase()) return null;
  const id = resolveOwnerId(owner, ctx.roster);
  if (!id) return null;
  return ctx.roster.find((u) => u.id === id)?.canApprove ? owner : null;
}
```

- [ ] **Step 4: Populate the flag in `review-limits-server.ts`.** Add `userCan` to the `@/lib/users` import and change the roster map to:

```ts
    roster: users.map((u) => ({ id: u.id, name: u.name, status: u.status, canApprove: userCan(u, "approve") })),
```

- [ ] **Step 5: Add the self stamp and the new gate order in `stores/quotes.ts`.**
  - Import `canSelfApprove` alongside the existing `canAutoApprove` import from `@/lib/review-limits`.
  - Add `"value" | "spec"` to `GateQuote` if they're missing; `quoteType`, `spec`, `flameTest`, `repair` and `inspection` are already there.
  - Add this after `autoApprovedReview`:

```ts
/** #284: the review record a self-approval writes (approver owner, own quote). */
export function selfApprovedReview(owner: string, q: GateQuote, now: number): QuoteReview {
  return {
    state: "approved",
    reviewer: null,
    submittedBy: owner,
    submittedAt: now,
    decidedBy: owner,
    decidedAt: now,
    note: "",
    method: "self",
    auto: null,
    approvedAgainst: approvalFingerprint(q),
  };
}
```

  - In `decideApprovalGate`, between the `approvalHolds` block and `const ev = canAutoApprove(q, ctx);`, insert:

```ts
  // #284: an approver's own quote, moved by its owner, approves itself.
  const selfOwner = canSelfApprove(q, ctx, actor);
  if (selfOwner) return { ok: true, stamp: selfApprovedReview(selfOwner, q, now) };
```

    Add a bullet to the function's doc comment: "an approver owner moving their own quote → open, with a `self` approval to write (#284) — checked before the owner's review limit."
  - Change `checkApprovalGate` to take `actor: string | null = null` and pass it on: `decideApprovalGate(status, q, await loadReviewLimitContext(), {}, Date.now(), actor)`.

- [ ] **Step 6: Pass the actor from the Estimator actions.** In `src/app/(app)/estimator/actions.ts`, change both `checkApprovalGate(cur, status)` and `checkApprovalGate(cur, "sent")` to add `, user.name`. The harness pin at ~30008 counts `checkApprovalGate(cur` and still matches.

- [ ] **Step 7: Add DB checks.** Append inside `approval284AsyncChecks()` (Task 1). The test DB seeds Jeff Chesebro as Admin, so he can approve:

```ts
  // Task 2 — self-approval end to end through setStatus (seeded roster: Jeff = Admin).
  await mk("t2-self", "Jeff Chesebro", { review: { state: "none", reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "", method: null } });
  const s2 = await Q.setStatus(id("t2-self"), "sent", "Jeff Chesebro");
  ok(s2?.status === "sent" && s2.review?.method === "self" && s2.review.decidedBy === "Jeff Chesebro", "#284 DB: Jeff sending his own draft self-approves it");
  await mk("t2-other", "Jeff Chesebro", { review: { state: "none", reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "", method: null } });
  let r2 = false;
  try { await Q.setStatus(id("t2-other"), "sent", "T284 Somebody"); } catch (e) { r2 = Q.isApprovalGateRefusal(e); }
  ok(r2, "#284 DB: someone else sending Jeff's quote does not self-approve it");
```

- [ ] **Step 8: Run the gate** (tsc + test:specs) and confirm every `#284` line passes and the run ends `ALL PASSED`.

- [ ] **Step 9: Commit.**

```bash
git add src/lib/review-limits.ts src/lib/review-limits-server.ts src/lib/stores/quotes.ts "src/app/(app)/estimator/actions.ts" scripts/test-review-and-spec.ts
git commit -m "feat(review): approvers self-approve their own quotes at send/won (#284 task 2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Guarded review operations

**Files:**
- Create: `src/lib/quote-review-ops.ts`
- Modify: `src/lib/stores/quotes.ts` (new `withdrawReview`; `requestChanges` implicit claim)
- Modify: `src/app/(app)/estimator/actions.ts`: `submitReviewAction`, `approveReviewAction`, `requestChangesAction`, `attestApprovalAction` and `sendToCustomerAction` delegate to the ops. `claimReviewAction` stays, unused by the new UI.
- Modify: `src/app/(app)/quotes/actions.ts` (`submitQuoteForReview` delegates)
- Modify: `src/app/(app)/reviews/actions.ts` (Quote branches of approve / requestChanges delegate)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes:
  - `approvalHolds`, `loadReviewLimitContext`, `canAttestApproval`, `validateAttestationNote`, `checkApprovalGate(q, status, actor)` (Task 2)
- Produces (all `async`, all return `ReviewOpResult = { ok: true } | { ok: false; error: string }`):
  - `type ReviewActor = { name: string; roles: string[] }`
  - `submitQuoteForApproval(id: string, actor: ReviewActor, reviewer: string | null)`
  - `withdrawQuoteReview(id: string, actor: ReviewActor)`
  - `approveQuoteReview(id: string, actor: ReviewActor)`
  - `sendBackQuoteReview(id: string, actor: ReviewActor, note: string)`
  - `attestQuoteApproval(id: string, actor: ReviewActor, note: string)`
  - `sendQuoteToCustomer(id: string, actor: ReviewActor)`
  - Store: `withdrawReview(id: string): Promise<Quote | null>`

- [ ] **Step 1: Write the failing DB checks.** Append inside `approval284AsyncChecks()`:

```ts
  // Task 3 — guarded ops.
  const Ops = await import("@/lib/quote-review-ops");
  const NIC = { name: "T284 Owner", roles: ["Estimator"] };
  const JEFF = { name: "Jeff Chesebro", roles: ["Admin"] };
  const none = { state: "none", reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "", method: null };
  await mk("t3", "T284 Owner", { review: none });
  ok(!(await Ops.submitQuoteForApproval(id("t3"), JEFF, null)).ok, "#284 ops: a non-owner cannot submit someone else's quote");
  ok((await Ops.submitQuoteForApproval(id("t3"), NIC, null)).ok && (await Q.get(id("t3")))?.review?.state === "in_review", "#284 ops: the owner submits (shared queue)");
  ok(!(await Ops.submitQuoteForApproval(id("t3"), NIC, null)).ok, "#284 ops: submitting twice is refused");
  ok(!(await Ops.approveQuoteReview(id("t3"), NIC)).ok, "#284 ops: approve needs the approve permission");
  ok((await Ops.withdrawQuoteReview(id("t3"), NIC)).ok && (await Q.get(id("t3")))?.review?.state === "none", "#284 ops: the owner withdraws back to not submitted");
  ok(!(await Ops.withdrawQuoteReview(id("t3"), NIC)).ok, "#284 ops: withdraw only from in review");
  await Ops.submitQuoteForApproval(id("t3"), NIC, null);
  const sb = await Ops.sendBackQuoteReview(id("t3"), JEFF, "  ");
  ok(!sb.ok, "#284 ops: send back needs a note");
  ok((await Ops.sendBackQuoteReview(id("t3"), JEFF, "Fix the rigging math")).ok, "#284 ops: an approver sends it back");
  const back = await Q.get(id("t3"));
  ok(back?.review?.state === "changes" && back.review.reviewer === "Jeff Chesebro", "#284 ops: send back on an unassigned review records the approver as reviewer (implicit claim)");
  ok((await Ops.submitQuoteForApproval(id("t3"), NIC, null)).ok, "#284 ops: resubmit after changes");
  ok((await Ops.approveQuoteReview(id("t3"), JEFF)).ok, "#284 ops: an approver approves");
  const ap = await Q.get(id("t3"));
  ok(ap?.review?.state === "approved" && ap.review.method === "in_app" && ap.review.reviewer === "Jeff Chesebro", "#284 ops: approve claims implicitly");
  ok((await Ops.sendQuoteToCustomer(id("t3"), NIC)).ok && (await Q.get(id("t3")))?.status === "sent", "#284 ops: the owner sends an approved quote");
  await mk("t3-own", "Jeff Chesebro", { review: { ...none, state: "in_review", submittedBy: "Jeff Chesebro" } });
  ok(!(await Ops.approveQuoteReview(id("t3-own"), JEFF)).ok, "#284 ops: nobody approves their own submitted quote through the queue");
```

- [ ] **Step 2: Run the checks and confirm they fail.** Expected: a module-not-found error for `@/lib/quote-review-ops`.

- [ ] **Step 3: Add the store changes in `stores/quotes.ts`.** Add this after `submitForReview`:

```ts
/** #284: the owner pulls an in-review quote back to not submitted. */
export async function withdrawReview(id: string): Promise<Quote | null> {
  return patchQuote(id, (q) => {
    q.review = rv("none");
    q.updatedAt = Date.now();
  });
}
```

In `requestChanges`, add `review.reviewer = review.reviewer || review.decidedBy;` after `review.decidedBy = …`, matching what `approve()` already does.

- [ ] **Step 4: Create `src/lib/quote-review-ops.ts`.** Server-only; never import it from a client file.

```ts
/**
 * #284 — the ONE guarded path for every review mutation on a quote. The
 * Estimator, the Quotes hub, the Reviews page and the next-step control all
 * call these; each re-checks ownership, permission and state on the server
 * (a hidden button is not access control — punch #60). Returns a typed
 * result whose `error` is written for the user.
 */
import { can } from "@/lib/team";
import {
  get,
  submitForReview,
  withdrawReview,
  approve,
  requestChanges,
  attestApproval,
  setStatus,
  checkApprovalGate,
  canAttestApproval,
  validateAttestationNote,
  statusFailureMessage,
  type Quote,
} from "@/lib/stores/quotes";
import { approvalHolds } from "@/lib/review-limits";
import { loadReviewLimitContext } from "@/lib/review-limits-server";

export type ReviewActor = { name: string; roles: string[] };
export type ReviewOpResult = { ok: true } | { ok: false; error: string };

const NOT_FOUND: ReviewOpResult = { ok: false, error: "Quote not found." };
const isOwner = (q: Quote, a: ReviewActor) => (q.owner || "").trim().toLowerCase() === a.name.trim().toLowerCase();

/** Approved on record but no longer counting (stale auto limit, or #284 snapshot). */
async function approvalLapsed(q: Quote): Promise<boolean> {
  return q.review?.state === "approved" && !approvalHolds(q, await loadReviewLimitContext());
}

export async function submitQuoteForApproval(id: string, actor: ReviewActor, reviewer: string | null): Promise<ReviewOpResult> {
  const q = id ? await get(id) : null;
  if (!q) return NOT_FOUND;
  if (!isOwner(q, actor)) return { ok: false, error: "Only the quote's owner can submit it for approval." };
  const state = q.review?.state || "none";
  const lapsed = await approvalLapsed(q);
  // #242 final carried forward: a lapsed approval on a SENT quote may be resubmitted so it can still reach Won.
  if (q.status !== "draft" && !(lapsed && q.status === "sent"))
    return { ok: false, error: "Only a draft quote can be submitted for approval." };
  if (state !== "none" && state !== "changes" && !lapsed)
    return { ok: false, error: state === "in_review" ? "This quote is already waiting for approval." : "This quote is already approved." };
  await submitForReview(id, { by: actor.name, reviewer: reviewer || null });
  return { ok: true };
}

export async function withdrawQuoteReview(id: string, actor: ReviewActor): Promise<ReviewOpResult> {
  const q = id ? await get(id) : null;
  if (!q) return NOT_FOUND;
  if (!isOwner(q, actor)) return { ok: false, error: "Only the quote's owner can withdraw it." };
  if (q.review?.state !== "in_review") return { ok: false, error: "This quote isn't waiting for approval." };
  await withdrawReview(id);
  return { ok: true };
}

async function decidable(id: string, actor: ReviewActor): Promise<{ ok: true; q: Quote } | { ok: false; error: string }> {
  if (!can("approve", actor.roles)) return { ok: false, error: "You need approve permission to decide on a quote." };
  const q = id ? await get(id) : null;
  if (!q) return NOT_FOUND;
  if (q.review?.state !== "in_review") return { ok: false, error: "This quote isn't waiting for approval." };
  if (isOwner(q, actor))
    return { ok: false, error: "You can't approve your own quote here — send it to the customer and your approval is recorded." };
  return { ok: true, q };
}

export async function approveQuoteReview(id: string, actor: ReviewActor): Promise<ReviewOpResult> {
  const d = await decidable(id, actor);
  if (!d.ok) return d;
  await approve(id, { by: actor.name });
  return { ok: true };
}

export async function sendBackQuoteReview(id: string, actor: ReviewActor, note: string): Promise<ReviewOpResult> {
  const clean = (note || "").trim();
  if (!clean) return { ok: false, error: "Say what needs to change." };
  const d = await decidable(id, actor);
  if (!d.ok) return d;
  await requestChanges(id, { by: actor.name, note: clean });
  return { ok: true };
}

export async function attestQuoteApproval(id: string, actor: ReviewActor, note: string): Promise<ReviewOpResult> {
  const q = id ? await get(id) : null;
  if (!q) return NOT_FOUND;
  if (!isOwner(q, actor) && !can("approve", actor.roles)) return { ok: false, error: "Only the quote's owner can attest an approval on it." };
  const attestable = canAttestApproval(q.review ?? null);
  if (!attestable.ok) return attestable;
  const v = validateAttestationNote(note);
  if (!v.ok) return v;
  await attestApproval(id, { by: actor.name, note: v.note });
  return { ok: true };
}

export async function sendQuoteToCustomer(id: string, actor: ReviewActor): Promise<ReviewOpResult> {
  const q = id ? await get(id) : null;
  if (!q) return NOT_FOUND;
  if (q.status !== "draft") return { ok: false, error: "This quote has already been sent." };
  const gate = await checkApprovalGate(q, "sent", actor.name);
  if (!gate.ok) return gate;
  try {
    await setStatus(id, "sent", actor.name);
  } catch (e) {
    return { ok: false, error: statusFailureMessage(e, "quote-review-ops sendQuoteToCustomer: setStatus(sent) threw") };
  }
  return { ok: true };
}
```

   Before writing it, check that each imported name is exported from the store (`grep -n "export function canAttestApproval\|export function validateAttestationNote\|export function statusFailureMessage\|export async function checkApprovalGate" src/lib/stores/quotes.ts`). All four exist in the current code.

- [ ] **Step 5: Delegate the existing actions.**
  - In `estimator/actions.ts`:
    - Rewrite `submitReviewAction`, `approveReviewAction`, `requestChangesAction` and `sendToCustomerAction` as below.
    - Rewrite the body of `attestApprovalAction` the same way, removing its inline owner and `canAttestApproval` checks.
    - Keep each function's exported name and `ReviewSync` return.

```ts
export async function submitReviewAction(id: string, reviewer: string | null): Promise<ReviewSync> {
  const user = await requireUser();
  const r = await submitQuoteForApproval(id, user, reviewer);
  if (!r.ok) return { ...(await syncOf(id, user.name)), ok: false, error: r.error };
  refresh();
  return syncOf(id, user.name);
}
```

    The pattern is: call the op with `user` (`requireUser()` returns `{ name, roles, … }`); on `!r.ok`, return the current sync with `ok: false, error`; otherwise call `refresh()` and return `syncOf`. Add the imports from `@/lib/quote-review-ops`. Drop the now-unused store imports (`submitForReview`, `approve`, `requestChanges`, `attestApproval`, `canAttestApproval`, `validateAttestationNote`) only if nothing else in the file uses them; check with grep first.
  - In `quotes/actions.ts`, rewrite the body of `submitQuoteForReview` as:

```ts
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const reviewer = String(formData.get("reviewer") || "queue");
  await submitQuoteForApproval(id, user, reviewer !== "queue" ? reviewer : null);
  revalidatePath("/", "layout");
```

  - In `reviews/actions.ts`, in `approveReviewAction`, replace `if (kind === "Quote") await approve(id, { by: user.name });` with:

```ts
  if (kind === "Quote") {
    const r = await approveQuoteReview(id, user);
    if (!r.ok) return r;
  }
```

    and the matching `requestChanges` line in `requestChangesAction` with `sendBackQuoteReview(id, user, clean)` in the same shape.

- [ ] **Step 6: Run the gate** (tsc + test:specs) and confirm all `#284 ops` lines pass. If the `#60` attestation checks (around lines 3840–3900 and wherever `attestApprovalAction` is grepped) pin strings that moved, update them to read `src/lib/quote-review-ops.ts`, keeping their PASS messages.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/quote-review-ops.ts src/lib/stores/quotes.ts "src/app/(app)/estimator/actions.ts" "src/app/(app)/quotes/actions.ts" "src/app/(app)/reviews/actions.ts" scripts/test-review-and-spec.ts
git commit -m "feat(review): one guarded ops path for submit/withdraw/approve/send back/attest/send (#284 task 3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The next-step view model

**Files:**
- Create: `src/lib/quote-next-step.ts` (pure, client-safe)
- Create: `src/lib/quote-next-step-server.ts` (server-only)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `approvedReviewLine`, `autoApprovalLine`, `staleAutoApprovalLine`, `staleApprovalLine` (review-line); `firstName` (team); `ReviewLimitChipData` (type, review-limits).
- Produces:

```ts
export type NextStepAction = "submit" | "send" | "approve" | "sendBack" | "withdraw" | "attest" | "assign";
export type NextStepTone = "draft" | "review" | "changes" | "approved" | "stale";
export type QuoteNextStepView = {
  pill: { label: string; tone: NextStepTone; title: string };
  strip: string | null;
  primary: { action: "submit" | "send" | "approve"; label: string } | null;
  secondary: Array<{ action: NextStepAction; label: string }>;
  reviewers: string[];           // names for Assign to… (excludes owner + viewer)
  approverMode: boolean;         // viewer is the deciding approver right now
};
export type NextStepInput = {
  status: string;
  review: { state: string; reviewer: string | null; submittedBy: string | null; decidedBy: string | null; note: string;
            method?: "in_app" | "attested" | "auto_limit" | "self" | null; auto?: unknown } | null;
  holds: boolean;                // approvalHolds(q, ctx), server-evaluated
  chip: ReviewLimitChipData | null;
  owner: string; viewer: string; viewerCanApprove: boolean;
  submittedAgo: string;          // timeAgo(review.submittedAt)
  reviewers: string[];           // all approver names
};
export function quoteNextStep(i: NextStepInput): QuoteNextStepView;
// server:
export async function quoteNextStepFor(q: Quote, viewer: { name: string; roles: string[] }): Promise<QuoteNextStepView>;
```

- [ ] **Step 1: Write the failing table checks.** Append to EOF:

```ts
import { quoteNextStep as a284Next } from "@/lib/quote-next-step";
{
  const R = (state: string, o: Record<string, unknown> = {}) => ({ state, reviewer: null, submittedBy: "Nic Trapani", decidedBy: null, note: "", method: null, ...o });
  const base = { status: "draft", review: R("none"), holds: false, chip: null, owner: "Nic Trapani", viewer: "Nic Trapani", viewerCanApprove: false, submittedAgo: "2h ago", reviewers: ["Jeff Chesebro", "Chris Mittlesteadt"] };
  const v = (o: Record<string, unknown>) => a284Next({ ...base, ...o } as never);
  const acts = (x: ReturnType<typeof a284Next>) => x.secondary.map((s) => s.action).join(",");

  let x = v({});
  ok(x.primary?.action === "submit" && x.primary.label === "Submit for approval" && acts(x) === "assign,attest" && x.pill.label === "Not submitted",
    "#284 next: owner, draft, no route → Submit for approval · ⋯ Assign to…, Attest approval…");
  ok(x.reviewers.join(",") === "Jeff Chesebro,Chris Mittlesteadt", "#284 next: Assign to… lists approvers other than the owner");
  x = v({ chip: { tone: "within", text: "Within your limit — approves automatically", short: "Within limit", staleAuto: false } });
  ok(x.primary?.action === "send" && x.primary.label === "Send to customer →" && acts(x) === "submit" && x.secondary[0].label === "Submit for approval anyway"
    && x.strip === "Within your limit — approves automatically", "#284 next: within limit → Send to customer → · ⋯ Submit for approval anyway");
  x = v({ owner: "Jeff Chesebro", viewer: "Jeff Chesebro", viewerCanApprove: true });
  ok(x.primary?.action === "send" && !x.reviewers.includes("Jeff Chesebro"), "#284 next: an approver owner gets Send to customer → straight away");
  x = v({ review: R("in_review") });
  ok(x.primary === null && acts(x) === "withdraw" && x.pill.label === "In review · any approver" && x.pill.title === "Submitted by Nic, 2h ago",
    "#284 next: owner, in review → waiting pill + Withdraw");
  x = v({ review: R("in_review", { reviewer: "Jeff Chesebro" }), viewer: "Chris Mittlesteadt", viewerCanApprove: true });
  ok(x.primary?.action === "approve" && x.primary.label === "Approve" && acts(x) === "sendBack" && x.secondary[0].label === "Send back…" && x.approverMode && x.pill.label === "In review · with Jeff",
    "#284 next: any approver (even when assigned to someone else) gets Approve · Send back…");
  x = v({ review: R("in_review"), viewer: "Jena Tolksdorf", viewerCanApprove: false });
  ok(x.primary === null && x.secondary.length === 0 && !x.approverMode, "#284 next: a bystander sees the pill only");
  x = v({ review: R("changes", { decidedBy: "Jeff Chesebro", note: "Fix the rigging math" }) });
  ok(x.primary?.action === "submit" && x.primary.label === "Resubmit for approval" && acts(x) === "assign" && x.pill.label === "Changes requested · Jeff"
    && x.strip === "“Fix the rigging math” — Jeff", "#284 next: changes → Resubmit for approval, strip carries the note, no attest");
  x = v({ review: R("approved", { decidedBy: "Jeff Chesebro", method: "in_app" }), holds: true });
  ok(x.primary?.action === "send" && x.pill.label === "Approved · Jeff" && x.strip === "Approved by Jeff — ready to send to the customer", "#284 next: approved → Send to customer →");
  x = v({ review: R("approved", { decidedBy: "Nic Trapani", method: "attested", note: "Jeff on a call" }), holds: true });
  ok(x.pill.label === "Attested · Nic", "#284 next: attested pill");
  x = v({ review: R("approved", { decidedBy: "Jeff Chesebro", method: "in_app" }), holds: false });
  ok(x.primary?.action === "submit" && x.primary.label === "Resubmit for approval" && x.pill.label === "Approval cleared" && x.pill.tone === "stale"
    && x.strip === "Approval cleared — the price or lines changed since Jeff approved it", "#284 next: a stale approval reads as cleared → Resubmit");
  x = v({ status: "sent", review: R("approved", { decidedBy: "Nic Trapani", method: "self" }), holds: true });
  ok(x.primary === null && x.secondary.length === 0 && x.pill.label === "Self-approved · Nic", "#284 next: a sent quote has no next step");
  x = v({ status: "sent", review: R("approved", { decidedBy: "Jeff Chesebro", method: "in_app" }), holds: false });
  ok(x.primary?.action === "submit" && acts(x) === "assign,attest", "#284 next: a sent quote whose approval lapsed can be resubmitted (to reach Won)");
  x = v({ status: "won", review: R("approved", { method: "in_app", decidedBy: "Jeff Chesebro" }), holds: true });
  ok(x.primary === null && x.strip === null, "#284 next: won/lost show the pill only");
}
```

- [ ] **Step 2: Run the checks and confirm they fail.** Expected: a module-not-found error for `@/lib/quote-next-step`.

- [ ] **Step 3: Create `src/lib/quote-next-step.ts`:**

```ts
/**
 * #284 — the Estimator / Quotes-hub "next step" control as a pure view model
 * (spec §1). The server evaluates `holds` (approvalHolds) and the limit chip;
 * this decides what the viewer sees. Client-safe: imports only review-line,
 * team and a type.
 */
import { firstName } from "@/lib/team";
import { approvedReviewLine, staleApprovalLine, staleAutoApprovalLine } from "@/lib/review-line";
import type { ReviewLimitChipData } from "@/lib/review-limits";

export type NextStepAction = "submit" | "send" | "approve" | "sendBack" | "withdraw" | "attest" | "assign";
export type NextStepTone = "draft" | "review" | "changes" | "approved" | "stale";
export type QuoteNextStepView = {
  pill: { label: string; tone: NextStepTone; title: string };
  strip: string | null;
  primary: { action: "submit" | "send" | "approve"; label: string } | null;
  secondary: Array<{ action: NextStepAction; label: string }>;
  reviewers: string[];
  approverMode: boolean;
};
type ReviewIn = {
  state: string;
  reviewer: string | null;
  submittedBy: string | null;
  decidedBy: string | null;
  note: string;
  method?: "in_app" | "attested" | "auto_limit" | "self" | null;
  auto?: unknown;
};
export type NextStepInput = {
  status: string;
  review: ReviewIn | null;
  holds: boolean;
  chip: ReviewLimitChipData | null;
  owner: string;
  viewer: string;
  viewerCanApprove: boolean;
  submittedAgo: string;
  reviewers: string[];
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";

function approvedPill(r: ReviewIn): string {
  const who = firstName(r.decidedBy || r.reviewer || "");
  if (r.method === "attested") return "Attested · " + who;
  if (r.method === "self") return "Self-approved · " + who;
  if (r.method === "auto_limit") return "Auto-approved";
  return "Approved · " + who;
}

export function quoteNextStep(i: NextStepInput): QuoteNextStepView {
  const r: ReviewIn = i.review || { state: "none", reviewer: null, submittedBy: null, decidedBy: null, note: "" };
  const isOwner = same(i.owner, i.viewer);
  const closed = i.status === "won" || i.status === "lost";
  const sent = i.status === "sent";
  // An approval that no longer holds reads as cleared (stale auto limit or #284 snapshot).
  const stale = r.state === "approved" && !i.holds;
  const state = stale ? "stale" : r.state;
  const reviewers = i.reviewers.filter((n) => !same(n, i.owner) && !same(n, i.viewer));

  let pill: QuoteNextStepView["pill"];
  let strip: string | null = null;
  if (state === "in_review") {
    pill = {
      label: "In review · " + (r.reviewer ? "with " + firstName(r.reviewer) : "any approver"),
      tone: "review",
      title: "Submitted by " + firstName(r.submittedBy || i.owner) + (i.submittedAgo ? ", " + i.submittedAgo : ""),
    };
  } else if (state === "changes") {
    pill = { label: "Changes requested · " + firstName(r.decidedBy || ""), tone: "changes", title: "" };
    strip = r.note ? "“" + r.note + "” — " + firstName(r.decidedBy || "") : "Returned by " + firstName(r.decidedBy || "");
  } else if (state === "approved") {
    pill = { label: approvedPill(r), tone: "approved", title: "" };
    strip = closed ? null : approvedReviewLine({ method: r.method ?? null, decidedBy: r.decidedBy, reviewer: r.reviewer, note: r.note, auto: (r.auto as never) ?? null });
  } else if (state === "stale") {
    pill = { label: "Approval cleared", tone: "stale", title: "" };
    strip = r.method === "auto_limit" ? staleAutoApprovalLine(i.chip?.text || "needs review") : staleApprovalLine({ method: r.method ?? null, decidedBy: r.decidedBy, reviewer: r.reviewer, note: r.note });
  } else {
    pill = { label: "Not submitted", tone: "draft", title: "" };
    strip = !closed && !sent && i.chip ? i.chip.text : null;
  }

  const view = (primary: QuoteNextStepView["primary"], secondary: QuoteNextStepView["secondary"] = [], approverMode = false): QuoteNextStepView =>
    ({ pill, strip, primary, secondary, reviewers, approverMode });

  if (closed) return { ...view(null), strip: null };

  // A non-owner approver decides an in-review quote (assigned or shared — the reviewer field is advisory).
  if (!isOwner) {
    if (state === "in_review" && i.viewerCanApprove)
      return view({ action: "approve", label: "Approve" }, [{ action: "sendBack", label: "Send back…" }], true);
    return view(null);
  }

  const submit = { action: "submit" as const, label: state === "changes" || state === "stale" ? "Resubmit for approval" : "Submit for approval" };
  const assign = { action: "assign" as const, label: "Assign to…" };
  const attest = { action: "attest" as const, label: "Attest approval…" };

  if (sent) {
    // #242 final carried forward: a lapsed approval on a sent quote can be resubmitted / attested so it can reach Won.
    return state === "stale" && !i.viewerCanApprove ? view(submit, [assign, attest]) : view(null);
  }
  if (state === "in_review") return view(null, [{ action: "withdraw", label: "Withdraw" }]);
  if (state === "changes") return view(submit, [assign]);
  if (state === "approved") return view({ action: "send", label: "Send to customer →" });
  // none or stale, draft
  if (i.viewerCanApprove || i.chip?.tone === "within")
    return view({ action: "send", label: "Send to customer →" }, [{ action: "submit", label: "Submit for approval anyway" }]);
  return view(submit, [assign, attest]);
}
```

  Note: for an approver owner whose approval went stale on a draft, the last branch already returns Send. The self-approval re-stamps at send (Task 2).

- [ ] **Step 4: Create `src/lib/quote-next-step-server.ts`:**

```ts
/** #284 — evaluates the next-step view for one saved quote and one viewer. Server-only. */
import { can } from "@/lib/team";
import { reviewers as approverRows } from "@/lib/users";
import { timeAgo, type Quote } from "@/lib/stores/quotes";
import { approvalHolds, reviewLimitChip } from "@/lib/review-limits";
import { loadReviewLimitContext } from "@/lib/review-limits-server";
import { quoteNextStep, type QuoteNextStepView } from "@/lib/quote-next-step";

export async function quoteNextStepFor(q: Quote, viewer: { name: string; roles: string[] }): Promise<QuoteNextStepView> {
  const [ctx, approvers] = await Promise.all([loadReviewLimitContext(), approverRows()]);
  return quoteNextStep({
    status: q.status,
    review: q.review ?? null,
    holds: approvalHolds(q, ctx),
    chip: reviewLimitChip(q, ctx, viewer.name),
    owner: (q.owner || q.preparedBy || "").trim(),
    viewer: viewer.name,
    viewerCanApprove: can("approve", viewer.roles),
    submittedAgo: q.review?.submittedAt ? timeAgo(q.review.submittedAt) : "",
    reviewers: approvers.map((u) => u.name),
  });
}
```

- [ ] **Step 5: Run the gate** and confirm all `#284 next` lines pass.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/quote-next-step.ts src/lib/quote-next-step-server.ts scripts/test-review-and-spec.ts
git commit -m "feat(review): next-step view model for quotes (#284 task 4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The `QuoteNextStep` component, its actions, and Estimator wiring

**Files:**
- Create: `src/app/(app)/quotes/review-actions.ts` ("use server")
- Create: `src/components/quote-review/quote-next-step.tsx` ("use client")
- Modify: `src/app/(app)/estimator/actions.ts` (`ReviewSync.next`, `StageSync.next`, `gateRefused`, `syncOf`/`stageSyncOf` take the user)
- Modify: `src/app/(app)/estimator/page.tsx` (initial `next`)
- Modify: `src/app/(app)/estimator/estimator-client.tsx`
- Test: `scripts/test-review-and-spec.ts` (source-text wiring checks)

**Interfaces:**
- Consumes: the ops (Task 3); `quoteNextStepFor`, `QuoteNextStepView` (Task 4).
- Produces:
  - `type NextStepSync = { ok: boolean; error?: string; review: QuoteReview | null; status: QuoteStatus | null; reviewLimit?: ReviewLimitChipData | null; next: QuoteNextStepView | null }`
  - Actions: `nsSubmitAction(id, reviewer)`, `nsWithdrawAction(id)`, `nsApproveAction(id)`, `nsSendBackAction(id, note)`, `nsAttestAction(id, note)`, `nsSendAction(id)`, each returning `Promise<NextStepSync>`
  - The component `<QuoteNextStep quoteId view variant onSync? beforeAction? savedOnly? onError? />`

- [ ] **Step 1: Write the failing wiring checks.** Append to EOF:

```ts
{
  const fs284 = await import("node:fs");
  const ec = fs284.readFileSync("src/app/(app)/estimator/estimator-client.tsx", "utf8");
  const comp = fs284.existsSync("src/components/quote-review/quote-next-step.tsx") ? fs284.readFileSync("src/components/quote-review/quote-next-step.tsx", "utf8") : "";
  const ra = fs284.existsSync("src/app/(app)/quotes/review-actions.ts") ? fs284.readFileSync("src/app/(app)/quotes/review-actions.ts", "utf8") : "";
  ok(!ec.includes("reviewBarOpen") && !ec.includes("Show review status"), "#284 wiring: the collapsible review bar is gone from the Estimator");
  ok(ec.includes("<QuoteNextStep") && (ec.match(/<QuoteNextStep/g) || []).length >= 2, "#284 wiring: the Estimator renders QuoteNextStep (toolbar + phone approver)");
  ok(ec.includes("gateRefused"), "#284 wiring: the gate-refusal banner knows it was the gate");
  ok(comp.startsWith('"use client"') && comp.includes("Send back for changes") && comp.includes("Record approval"), "#284 wiring: the component owns the Send back and Attest modals");
  ok(!/from "@\/lib\/stores\//.test(comp) && !/from "@\/lib\/quote-review-ops"/.test(comp), "#284 wiring: the client component imports no store or server module");
  ok(ra.startsWith('"use server"') && ["nsSubmitAction", "nsWithdrawAction", "nsApproveAction", "nsSendBackAction", "nsAttestAction", "nsSendAction"].every((n) => ra.includes("export async function " + n)),
    "#284 wiring: the six next-step server actions exist");
}
```

  Top-level `await` is fine if the harness already uses it at top level (`grep -n "^const .* = await import" scripts/test-review-and-spec.ts | head -2`). If it doesn't, use a static `import { readFileSync as a284Read, existsSync as a284Exists } from "node:fs";` in the import list instead.

- [ ] **Step 2: Run the checks and confirm they fail.**

- [ ] **Step 3: Create `src/app/(app)/quotes/review-actions.ts`:**

```ts
"use server";
/**
 * #284 — the next-step control's server actions (Estimator + Quotes hub).
 * Each calls one guarded op (src/lib/quote-review-ops.ts) and returns the
 * quote's fresh review/status plus the re-evaluated next-step view.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get, type QuoteReview, type QuoteStatus } from "@/lib/stores/quotes";
import { reviewLimitChipFor } from "@/lib/review-limits-server";
import type { ReviewLimitChipData } from "@/lib/review-limits";
import { quoteNextStepFor } from "@/lib/quote-next-step-server";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import {
  submitQuoteForApproval,
  withdrawQuoteReview,
  approveQuoteReview,
  sendBackQuoteReview,
  attestQuoteApproval,
  sendQuoteToCustomer,
  type ReviewOpResult,
} from "@/lib/quote-review-ops";

export type NextStepSync = {
  ok: boolean;
  error?: string;
  review: QuoteReview | null;
  status: QuoteStatus | null;
  reviewLimit?: ReviewLimitChipData | null;
  next: QuoteNextStepView | null;
};

async function after(id: string, user: { name: string; roles: string[] }, r: ReviewOpResult): Promise<NextStepSync> {
  if (r.ok) revalidatePath("/", "layout");
  const q = id ? await get(id) : null;
  return {
    ok: r.ok,
    ...(r.ok ? {} : { error: r.error }),
    review: q?.review ?? null,
    status: q?.status ?? null,
    reviewLimit: q ? await reviewLimitChipFor(q, user.name) : null,
    next: q ? await quoteNextStepFor(q, user) : null,
  };
}

export async function nsSubmitAction(id: string, reviewer: string | null): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await submitQuoteForApproval(id, user, reviewer));
}
export async function nsWithdrawAction(id: string): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await withdrawQuoteReview(id, user));
}
export async function nsApproveAction(id: string): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await approveQuoteReview(id, user));
}
export async function nsSendBackAction(id: string, note: string): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await sendBackQuoteReview(id, user, note));
}
export async function nsAttestAction(id: string, note: string): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await attestQuoteApproval(id, user, note));
}
export async function nsSendAction(id: string): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await sendQuoteToCustomer(id, user));
}
```

   `revalidatePath("/", "layout")` makes the bell recount. If `requireUser()`'s return type isn't assignable to `{ name; roles }`, pass `{ name: user.name, roles: user.roles }`.

- [ ] **Step 4: Create `src/components/quote-review/quote-next-step.tsx`.** Requirements, all mandatory:
  - `"use client"`. Import only `react`, `next/navigation` (`useRouter`), the six actions from `@/app/(app)/quotes/review-actions`, and types from `@/lib/quote-next-step`.
  - Props:

```ts
type Props = {
  quoteId: string;
  view: QuoteNextStepView;
  /** "toolbar" = the Estimator's dark header; "panel" = light surfaces (hub, phone). */
  variant: "toolbar" | "panel";
  /** Show only the approver's Approve / Send back (the Estimator's phone preview). */
  approverOnly?: boolean;
  /** Called with every server result; default = router.refresh(). */
  onSync?: (r: NextStepSync) => void;
  /** Report a refusal; default = an inline red line under the control. */
  onError?: (msg: string) => void;
  /** Runs before any action (the Estimator saves unsaved edits first); return false to abort. */
  beforeAction?: () => Promise<boolean>;
  /** Pill suffix " · as last saved" while the form has unsaved edits. */
  savedOnly?: boolean;
};
```

  - Layout: one inline-flex row with `gap: 8`, containing:
    1. **Pill.** A rounded span using the tone colors from the existing `rbMeta` palette:
       - draft: bg `#f4f5f7`, ink `#5b616e`
       - review: `#eef3fc` / `#3155a8`
       - changes: `#fdf1ec` / `#b4543a`
       - approved: `#ecf6f0` / `#1f7a52`
       - stale: `#fbf3dd` / `#8a6d1f`

       Text `view.pill.label + (savedOnly ? " · as last saved" : "")`, `title={view.pill.title || undefined}`.
    2. **Primary button** (when `view.primary`). Blue `#3155a8` for submit, green `#1f7a52` for send and approve, white text, 13px/600, `padding 9px 15px`, `borderRadius 8` (matches the toolbar buttons).
    3. **⋯ menu button** (when `view.secondary.length`). `aria-haspopup="menu"`; a small absolute-positioned list of `view.secondary` labels; closes on outside click and on Escape. `sendBack` renders in the primary row as its own button (rust `#b4543a` on `#f9ece8`) rather than in the menu, because approvers need it visible.
  - When `approverOnly`, render nothing unless `view.approverMode`, then only Approve and Send back….
  - Action dispatch: `run(fn)` = `startTransition(async () => { if (beforeAction && !(await beforeAction())) return; const r = await fn(); if (!r.ok) report(r.error || "That didn't go through."); (onSync ?? (() => router.refresh()))(r); })`. Buttons are disabled while pending.
    - `submit` → `nsSubmitAction(quoteId, null)`
    - `send` → `nsSendAction(quoteId)`
    - `approve` → `nsApproveAction(quoteId)`
    - `withdraw` → `nsWithdrawAction(quoteId)`
    - `assign` → opens a small inline list of `view.reviewers`; picking a name runs `nsSubmitAction(quoteId, name)`. Show "No other approvers" when the list is empty.
    - `sendBack` → modal: title "Send back for changes", textarea with placeholder "e.g. Re-check the rigging load math…", buttons "Cancel" and "Send back for changes" (disabled until trimmed text). Calls `nsSendBackAction(quoteId, note)`.
    - `attest` → modal: title "Attest approval", textarea with placeholder `e.g. "Reviewed by Jeff on a Teams call, 2026-08-01"`, buttons "Cancel" and "Record approval" (disabled until trimmed text). Calls `nsAttestAction(quoteId, note)`. Copy the modal chrome (overlay, card, button styles) from the Estimator's existing attest modal (around `estimator-client.tsx:3561`) so it looks the same.
  - On the `"toolbar"` variant, the ⋯ button uses the toolbar's dark style (`background: "#2b2e35", color: "#cfd3da"`). On `"panel"` it uses `background: "#fff", border: "1px solid #e4e7ec", color: "#3a3f4a"`.

- [ ] **Step 5: Thread `next` through the Estimator actions** (`estimator/actions.ts`):
  - Add `next?: QuoteNextStepView | null;` and `gateRefused?: boolean;` to both `ReviewSync` and `StageSync`.
  - Change `syncOf(id, viewer: string)` to `syncOf(id, user: { name: string; roles: string[] })`. It now also returns `next: q ? await quoteNextStepFor(q, user) : null`. Do the same for `stageSyncOf`, then update every call site (`syncOf(id, user.name)` → `syncOf(id, user)`; use grep).
  - In `setStatusAction`, where `!gate.ok` returns `error: gate.error`, add `gateRefused: true`. In its catch and in `setQuoteStageAction`'s catch, add `gateRefused: isApprovalGateRefusal(e)` (import it from the store).

- [ ] **Step 6: Pass the initial view from `estimator/page.tsx`.** Next to `const reviewLimit = q ? await reviewLimitChipFor(q, user.name) : null;`, add `const next = q ? await quoteNextStepFor(q, user) : null;` and pass `next={next}` to `<EstimatorClient …>`. Add `next: QuoteNextStepView | null` to the client's props type.

- [ ] **Step 7: Wire the Estimator client** (`estimator-client.tsx`):
  1. Add state `const [next, setNext] = useState<QuoteNextStepView | null>(initialNext);` and `const [gateRefused, setGateRefused] = useState(false);`. In `applySync` and `applyStageSync`, add `if (r.next !== undefined) setNext(r.next ?? null);`.
  2. In `changeStatus` and `changeStage`, on `!r.ok`, add `setGateRefused(!!r.gateRefused);`. Wherever `setActionError(null)` runs, also `setGateRefused(false)`.
  3. **Make Save awaitable.** Extract the async body inside `doSave`'s `startTransition` into `const saveNow = async (): Promise<boolean> => { …same body…; return <true when the save succeeded, false on every error branch> }`. Then `doSave = () => startTransition(() => { void saveNow(); })`. Keep every existing branch and message unchanged; only add the boolean returns.
  4. **Toolbar.** Immediately after the Save button (before "Customer preview →"), render:

```tsx
{loadedId && next && (
  <QuoteNextStep
    quoteId={loadedId}
    view={next}
    variant="toolbar"
    savedOnly={pdfDirty}
    beforeAction={pdfDirty ? saveNow : undefined}
    onSync={(r) => applySync(r)}
    onError={(m) => { setActionError(m); setGateRefused(false); }}
  />
)}
```

     `NextStepSync` is structurally compatible with `ReviewSync`. If `tsc` objects, widen `applySync`'s parameter to `ReviewSync | NextStepSync`.
  5. **Delete the review bar.** Remove the whole `{/* review & approval banner */} {showReviewBar && (…)}` block, plus:
     - `reviewBarOpen` and its state
     - the review view-model block `/* ---------------- review banner view-model ---------------- */` up to `const showReviewBar = !!loadedId;`
     - `submitReview`, `claimReviewNow`, `approveNow`, `submitRc`, `submitAttest`, `sendCustomer`
     - the request-changes and attest modals, and their state (`rcOpen`, `rcNote`, `attestOpen`, `attestNote`, `reviewerSel`)
     - `rbMeta`, if it's now unused
     - the now-unused imports (`ReviewLimitChip`, `approvedReviewLine`, `staleAutoApprovalLine`, the old review actions)

     Keep `reviewLimit` state only if something else still reads it; otherwise remove it and the `initialReviewLimit` prop use. Run `npx tsc --noEmit -p .` and `npx eslint` on the file to catch leftovers.
  6. **Strip.** Where the review bar used to be, render:

```tsx
{loadedId && next?.strip && (
  <div style={{ padding: "7px 22px", fontSize: 12.5, color: "#5b616e", background: "#f8f9fb", borderBottom: "1px solid #e4e7ec", flexShrink: 0 }}>
    {next.strip}
  </div>
)}
```

  7. **Gate-banner action.** Inside the `actionError` banner, before "Dismiss", render this when `gateRefused && next?.primary && next.primary.action !== "approve"`:

```tsx
<QuoteNextStep quoteId={loadedId!} view={{ ...next, secondary: [], pill: { ...next.pill, label: "" } }} variant="panel"
  beforeAction={pdfDirty ? saveNow : undefined} onSync={(r) => { applySync(r); if (r.ok) { setActionError(null); setGateRefused(false); } }} onError={(m) => setActionError(m)} />
```

     The component must render no pill when `pill.label === ""`; add that guard in Step 4.
  8. **Phone approver.** Directly above `<PreviewDoc …>`, inside `{isPreview && (…)}`, wrap both in a fragment and add:

```tsx
{phone && loadedId && next?.approverMode && (
  <div style={{ padding: "10px 14px", borderBottom: "1px solid #e4e7ec", background: "#fff" }}>
    <QuoteNextStep quoteId={loadedId} view={next} variant="panel" approverOnly onSync={(r) => applySync(r)} onError={(m) => setActionError(m)} />
  </div>
)}
```

- [ ] **Step 8: Run the gate:** tsc, test:specs, `npx eslint "src/app/(app)/estimator" src/components/quote-review "src/app/(app)/quotes/review-actions.ts"`, then `npx next build 2>&1 | tail -15`, which must succeed. The build is what catches a client file pulling in a store. Some existing harness checks grep the Estimator for `rbCanSubmit`, `rbCanAttest`, `Show review status`, `claimReviewAction(id)` and similar (find them with `grep -n "rbCan\|reviewBar\|Claim review\|submitReviewAction" scripts/test-review-and-spec.ts`). Retarget each to the equivalent rule in `src/lib/quote-next-step.ts` or the component, keeping its intent. Don't delete a check unless its subject was removed on purpose (Claim from the Estimator), and then replace it with a check that the subject is gone.

- [ ] **Step 9: Commit.**

```bash
git add -A src scripts
git commit -m "feat(estimator): one next-step control replaces the collapsible review bar (#284 task 5)

Submit for approval / Approve · Send back… / Send to customer → in the toolbar,
an always-visible strip for notes, a Submit button on the gate-refusal banner,
and Approve from the phone preview.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Quotes hub panel + Reviews page

**Files:**
- Modify: `src/app/(app)/quotes/page.tsx` (detail panel, around lines 815–1040)
- Modify: `src/app/(app)/reviews/page.tsx`, `src/app/(app)/reviews/review-list.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `QuoteNextStep` (Task 5), `quoteNextStepFor` (Task 4).

- [ ] **Step 1: Write the failing wiring checks.** Append to EOF, reading files the same way as Task 5's block:
  - `quotes/page.tsx` includes `<QuoteNextStep` and `quoteNextStepFor(`, and no longer includes `action={submitQuoteForReview}` or `"Shared queue (any reviewer)"`.
  - `reviews/page.tsx`: the `canClaim:` line includes `kind !== "Quote"`, or the regex `/canClaim:[^\n]*Quote/` matches.
  - `reviews/page.tsx`'s `myQueue` definition includes unassigned quotes, e.g. it matches `/!x\.review\.reviewer/` within the `myQueue` filter.

- [ ] **Step 2: Run the checks and confirm they fail.**

- [ ] **Step 3: Hub panel.** In the expanded-row component (the function whose doc comment begins "Expanded actions for the ?id=-selected row"):
  - Add a prop `next: QuoteNextStepView | null`. The caller (around line 774) computes it with `await quoteNextStepFor(q, user)` for the selected row only, since only one row is expanded.
  - Replace the review & approval banner (`{/* review & approval banner (Estimator port) */}` through the end of its `<form action={submitQuoteForReview}>` and the "Send to customer →" form) with:

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "11px 16px", borderBottom: "1px solid #e4e7ec" }}>
  {next && <QuoteNextStep quoteId={q.id} view={next} variant="panel" />}
  {next?.strip && <span style={{ fontSize: 12.5, color: "#5b616e" }}>{next.strip}</span>}
</div>
```

    The default `onSync` calls `router.refresh()`, which re-renders this server page. Remove the props this makes unused (`reviewerNames`, `reviewLimit`, if nothing else uses them) and the `submitQuoteForReview` import if it's no longer referenced. Keep the `submitQuoteForReview` export in `quotes/actions.ts`; grep for other callers first.
  - Also, where the `?statusError=` banner renders (around line 893), when the error text includes "needs an approval on record" and `next?.primary`, render `<QuoteNextStep quoteId={q.id} view={{ ...next, secondary: [], pill: { ...next.pill, label: "" } }} variant="panel" />` beside the message.
  - Keep the hub-row pill chip (`<ReviewLimitChip … variant="pill" />` around line 693) unchanged.

- [ ] **Step 4: Reviews page.**
  - In `page.tsx`, for quote items, set `canClaim: canApprove && tab === "unclaimed" && !r.reviewer && !isMine && kind !== "Quote"` (use whatever the local variable for the item's kind is). Designs and engagements keep Claim.
  - Change `myQueue` so that for quotes it includes in-review items where `review.reviewer === me || !review.reviewer`, excluding the viewer's own. Designs and engagements keep their current rule.
  - In `review-list.tsx`, change the Quote "Open" link's `href` to `quoteBuilderHref({ id, quoteType })` if it isn't already (import it from `@/lib/quote-links`). The item must carry `quoteType`; add it in `page.tsx` if it's missing.
  - Update the pinned ~30294 assertion if its matched strings moved.

- [ ] **Step 5: Run the gate**, plus `npx next build`.

- [ ] **Step 6: Commit.**

```bash
git add -A src scripts
git commit -m "feat(quotes): hub panel uses the next-step control; Reviews drops Claim for quotes (#284 task 6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Notifications

**Files:**
- Modify: `src/lib/nav-counts.ts`, `src/app/(app)/layout.tsx`, `src/lib/stores/notif-prefs.ts`
- Modify: `src/lib/queue.ts`
- Modify: `src/lib/dashboard/home-metrics.ts`, `src/app/(app)/page.tsx`, `src/app/(app)/_dashboard/widgets/home-cards.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces:
  - `navData(me: string, canApprove = false)`
  - Pure, exported from nav-counts: `quoteApprovalBell(quotes: Quote[], me: string, canApprove: boolean): { needs: BellItem[]; back: BellItem[] }`
  - `homeAlerts(…, sheetHref, canApprove = false)`
  - New notif pref key `"reviewBack"`

- [ ] **Step 1: Write the failing checks.** Append inside `approval284AsyncChecks()`. They're pure, but nav-counts imports stores, so they live in the async block and use a dynamic import:

```ts
  // Task 7 — bell groups.
  const NC = await import("@/lib/nav-counts");
  const qq = (slug: string, owner: string, review: Record<string, unknown>, status = "draft") =>
    ({ id: id(slug), name: "T284 " + slug, customer: "Acme", owner, status, quoteType: "system", value: 200, spec: { sections: [] }, review } as never);
  const shared = qq("b1", "Nic Trapani", { state: "in_review", reviewer: null, submittedBy: "Nic Trapani", submittedAt: 1 });
  const toChris = qq("b2", "Nic Trapani", { state: "in_review", reviewer: "Chris Mittlesteadt", submittedBy: "Nic Trapani", submittedAt: 2 });
  const approvedNic = qq("b3", "Nic Trapani", { state: "approved", method: "in_app", decidedBy: "Jeff Chesebro", reviewer: "Jeff Chesebro", note: "" });
  const backNic = qq("b4", "Nic Trapani", { state: "changes", decidedBy: "Jeff Chesebro", note: "Fix it" });
  const all = [shared, toChris, approvedNic, backNic];
  const jeff = NC.quoteApprovalBell(all, "Jeff Chesebro", true);
  ok(jeff.needs.length === 2 && jeff.needs.every((b) => b.href.startsWith("/estimator?id=")), "#284 bell: every approver sees shared AND assigned in-review quotes, linking to the quote");
  const chris = NC.quoteApprovalBell(all, "Chris Mittlesteadt", true);
  ok(chris.needs[0].id === id("b2"), "#284 bell: a quote assigned to me sorts first");
  ok(NC.quoteApprovalBell(all, "Jena Tolksdorf", false).needs.length === 0, "#284 bell: a non-approver gets no approval items");
  ok(NC.quoteApprovalBell(all, "Nic Trapani", true).needs.length === 0, "#284 bell: nobody is asked to approve their own quote");
  const nic = NC.quoteApprovalBell(all, "Nic Trapani", false);
  ok(nic.back.length === 2 && nic.back.some((b) => b.sub.includes("Approved — ready to send")) && nic.back.some((b) => b.sub.includes("Sent back")),
    "#284 bell: the owner sees Approved — ready to send and Sent back items");
  const sentNic = qq("b5", "Nic Trapani", { state: "approved", method: "in_app", decidedBy: "Jeff Chesebro", reviewer: "Jeff Chesebro", note: "" }, "sent");
  ok(NC.quoteApprovalBell([sentNic], "Nic Trapani", false).back.length === 0, "#284 bell: a sent quote leaves the owner's list");
```

- [ ] **Step 2: Run the checks and confirm they fail.**

- [ ] **Step 3: Update `nav-counts.ts`.**
  - Import `quoteBuilderHref` from `@/lib/quote-links` and `approvalSnapshotMatches` from `@/lib/approval-snapshot`.
  - Add this exported pure function:

```ts
/**
 * #284 — the quote half of the approval bell. Approvers see EVERY in-review
 * quote that isn't theirs (shared queue and assigned alike — the reviewer
 * field is advisory), assigned-to-me first; anyone also sees a quote assigned
 * to them by name. Owners see their drafts that came back: approved and still
 * holding (in-app/attested — self and auto approvals happen at send), or sent
 * back for changes. Every item opens the quote itself.
 */
export function quoteApprovalBell(quotes: Quote[], me: string, canApprove: boolean): { needs: BellItem[]; back: BellItem[] } {
  const mine = (n?: string | null) => (n || "").trim().toLowerCase() === me.trim().toLowerCase();
  const needs = quotes
    .filter((q) => q.review?.state === "in_review" && !mine(q.owner) && (canApprove || mine(q.review.reviewer)))
    .sort((a, b) => Number(mine(b.review?.reviewer)) - Number(mine(a.review?.reviewer)) || (a.review?.submittedAt || 0) - (b.review?.submittedAt || 0))
    .map((q) => ({
      id: q.id,
      title: q.name,
      sub: `${q.customer || ""} · from ${firstName(q.review?.submittedBy || q.owner || "")}${mine(q.review?.reviewer) ? " · assigned to you" : ""}`,
      href: quoteBuilderHref(q),
      letter: "Q",
      color: "var(--accent)",
    }));
  const back = quotes
    .filter((q) => mine(q.owner) && q.status === "draft")
    .filter((q) =>
      q.review?.state === "changes" ||
      (q.review?.state === "approved" && (q.review.method === "in_app" || q.review.method === "attested" || !q.review.method) && approvalSnapshotMatches(q))
    )
    .map((q) => ({
      id: q.id,
      title: q.name,
      sub: q.review?.state === "changes"
        ? `Sent back by ${firstName(q.review.decidedBy || "")}${q.review.note ? ` — “${q.review.note}”` : ""}`
        : `Approved — ready to send · ${firstName(q.review?.decidedBy || "")}`,
      href: quoteBuilderHref(q),
      letter: q.review?.state === "changes" ? "!" : "✓",
      color: q.review?.state === "changes" ? "#b4543a" : "#1f7a52",
    }));
  return { needs, back };
}
```

    Import `firstName` from `@/lib/team` and the `Quote` type from the quotes store.
  - Change `navData(me: string)` to `navData(me: string, canApprove = false)`. Replace `reviewQuotes` with `const approvalBell = quoteApprovalBell(quotes, me, canApprove);`. Set `counts.reviews = approvalBell.needs.length + reviewDesigns.length`.
  - In the `"reviews"` push, use the label `"Needs your approval"` and the items `[...approvalBell.needs, ...reviewDesigns.map(…unchanged…)]`. Right after it, add `push("reviewBack", "Back from review", approvalBell.back);`.
- [ ] **Step 4: Pass the permission from the layout.** In `src/app/(app)/layout.tsx`, call `navData(user.name, can("approve", user.roles))`, importing `can` from `@/lib/team` if it isn't already.
- [ ] **Step 5: Update `notif-prefs.ts` `CATEGORIES`.** Change the `reviews` entry's label to `"Needs your approval"` and desc to `"Quotes waiting for any approver (and designs assigned to you)."`. Insert after it: `{ key: "reviewBack", label: "Back from review", desc: "Your quotes that were approved and are ready to send, or sent back for changes." },`. If a harness check pins the category list or count, update it.
- [ ] **Step 6: Update `queue.ts`.** In the `/* --- quote reviews waiting on me --- */` loop:
  - Load the approver names once at the top of `loadQueue`: `const approvers = new Set((await reviewers()).map((u) => u.name));` (import `reviewers` from `@/lib/users`), then `const meApproves = approvers.has(me);`.
  - Skip quotes whose `owner === me`. Skip when `r.reviewer && r.reviewer !== me && !meApproves`, and when `!r.reviewer && !meApproves`.
  - Set the title to `` `Approve estimate ${displayQuoteNumber(q)}` `` and the context to `` `${q.customer || q.name || ""} · from ${firstName(r.submittedBy || q.owner || "")}` ``.
  - Set `href: quoteBuilderHref(q)`.
- [ ] **Step 7: Update `home-metrics.ts`.** Add a `canApprove = false` last parameter to `homeAlerts`. Change the quote branch's condition to `r?.state === "in_review" && q.owner !== me && (r.reviewer === me || (!r.reviewer && canApprove))` and its `href` to `quoteBuilderHref(q)`. In `src/app/(app)/page.tsx` and `src/app/(app)/_dashboard/widgets/home-cards.tsx`, pass `can("approve", <user>.roles)` as the new argument; find the user object in scope in each file.
- [ ] **Step 8: Run the gate**, plus `npx next build`.
- [ ] **Step 9: Commit.**

```bash
git add -A src scripts
git commit -m "feat(review): approvers' bell lists every quote awaiting approval; owners hear back (#284 task 7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, full gates, browser walkthrough

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`, `docs/superpowers/specs/2026-10-01-estimate-submit-for-approval-design.md`

- [ ] **Step 1: Recompute the numbers.** Run `git fetch -q origin && git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | tail -1` and `git show origin/main:PUNCHLIST.md | grep -oE "#2[0-9]{2}" | sort -u | tail -3`. If D506 or #284 is taken, shift every number in this task, in the commit message and in the spec's "Decisions to log".
- [ ] **Step 2: Add the decisions to `DECISIONS.md`.** Append four entries in the house style (`## D506. <title> (#284, 2026-10-01)` + a paragraph):
  - **D506:** one next-step control replaces the collapsible review bar in the Estimator and the Quotes hub. It also covers the gate-banner action, approving from the phone preview, and dropping Claim for quotes.
  - **D507:** approvers self-approve their own quotes when they move them to sent or won, stamped `method: "self"`. It's checked before the review limit, and changes-requested blocks it. Flag for Jeff: the seed roster gives everyone but Jeff all four roles, so on any environment where Nic and others hold `approve`, they also skip review. Settings → Team is the control.
  - **D508:** approvals go stale when the gross sell or the priced line set changes. Staleness is derived from an `approvedAgainst` fingerprint; wording edits keep the approval; rewards credit is excluded; auto_limit keeps its #242 rule.
  - **D509:** a submission goes to every approver. The reviewer field is advisory, and approving or sending back claims implicitly. Notifications are in-app only: "Needs your approval" and "Back from review" bell items, to-dos, and Home alerts, all linking to the quote.
- [ ] **Step 3: Update `PUNCHLIST.md`.** Add a `#284` entry in the file's existing format: Jeff's request verbatim ("Estimates need to be able to submit for approval, there is no clear way to do this right now and the workflow seems clunky"), DONE 2026-10-01, links to the spec and plan, and D506–D509. Add a Jeff-gated follow-up: review who holds `approve` in Settings → Team, since that now decides who skips review. Add a deferred follow-up: service, rental and consulting builders adopt `QuoteNextStep`.
- [ ] **Step 4: Update `AGENTS.md`.** Under "## Phase status", add item `26. ✅ **Estimate submit-for-approval** (#284, D506–D509) — …` in two or three sentences, matching the neighbouring items.
- [ ] **Step 5: Fix the spec.** In the spec, change §2's "Every approval (`in_app`, `attested`, `self`, `auto_limit`) records…" to "In-app, attested and self approvals record…; `auto_limit` keeps its #242 snapshot rule unchanged". Change §1's "save first, as Send to customer does today" to "the Estimator saves unsaved edits first (saveNow)".
- [ ] **Step 6: Run the four gates with real numbers.** Take the baseline on `origin/main` in a scratch checkout, or with `git worktree add`, never stash. Report:
  - `npx tsc --noEmit -p .`: 0 errors
  - `npm run test:specs 2>&1 | tail -2`: PASS count = base + new, `ALL PASSED`
  - `npm run test:smoke`: stop any dev server first and check `df -h .` (temp PGlite dirs)
  - `npx eslint src scripts`: error count ≤ baseline
  - `npx next build`: succeeds
- [ ] **Step 7: Browser walkthrough** on a scratch datadir. Use the memory "Exercising POST routes safely" and "Worktree dev-server browser traps": same `AUTH_SECRET` as main, `localhost` not `127.0.0.1`, unregister the service worker on first compile, and `lsof` the port first. Use the dev sign-in picker:
  1. As a user without `approve` (temporarily set Nic to roles `["Estimator"]` in the scratch DB through Settings → Team): open a draft estimate. The toolbar shows "Submit for approval" with no expand toggle. Click it; the pill reads "In review · any approver".
  2. Pick Sent in the status menu on another unapproved draft. The red banner shows a "Submit for approval" button.
  3. Sign in as Jeff. The bell shows "Needs your approval" with Nic's quote, and the item opens `/estimator?id=…`. Toolbar: Approve · Send back…. Click Approve.
  4. Back as Nic: the bell shows "Back from review · Approved — ready to send". The toolbar shows "Send to customer →"; click it, and the status is Sent.
  5. As Nic, on a new draft: get it approved, then change a line qty and save. The pill reads "Approval cleared", the strip explains why, and the button reads "Resubmit for approval".
  6. As Jeff, on his own draft: the toolbar shows "Send to customer →"; after sending, the pill reads "Self-approved · Jeff".
  7. Resize to mobile, open Nic's in-review quote as Jeff: the preview shows Approve and Send back….

  Screenshot steps 1, 3 and 7 for the report. Stop the dev server afterwards and confirm with `ps aux | grep "next dev"`.
- [ ] **Step 8: Commit the docs.**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md docs/superpowers/specs/2026-10-01-estimate-submit-for-approval-design.md
git commit -m "docs: #284 done — estimate submit-for-approval (D506–D509)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Hand off.** Push the branch and report back to Jeff with the gate numbers and screenshots. Don't merge to main without Jeff's go (superpowers:finishing-a-development-branch).
