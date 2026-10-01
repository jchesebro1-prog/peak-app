# #286 — Approvers send any quote; Lead estimator + Prepared by

> Numbering note: first drafted as #285 / D521–D522; another session shipped #285 (Settings menu) and D521–D522 first, so this is #286 / D523–D524. Branch, test fixture ids (`T285`, `fixtureId(285, …)`) and `#285` harness labels keep the old number.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Jeff (2026-10-01), on the #284 control:** "I still don't like that on the estimator I can't submit it for review or
progress the process using the review progress button. Xavier MS Fixtures is a prime example where Jena created it but I
edited and I want to review and send it." He followed up with: "Also we need to add lead estimator and prepared by on the
quotes to assist."

**Decisions Jeff picked:**
- (1) An approver viewing any draft quote sees **Send to customer →**. Sending records "Approved · <approver>". The ⋯
  menu adds **Approve only (owner sends)** and **Submit for approval**. When the quote is already in review, the approver
  sees **Approve & send →**, plus **Send back…** and ⋯ **Approve only**.
- (2) **Anyone who can create quotes** may Submit for approval, not only the owner.
- (3) Push to main once verified.

**Interpretation of the new request (controller's call, logged as a decision):**
- **Lead estimator** = the quote's existing `owner`. It already drives the hub owner filter and avatar, review limits,
  self-approval and "Back from review". Rename it in the UI and make it editable.
- **Prepared by** = the existing `preparedBy` field. It is stored today but never shown or edited, and the customer
  document prints `owner` under "Prepared by". Make it editable and print it.
- **Escalation guard:** auto-approval uses the owner's review limit. So anyone with `create` may set the lead estimator
  to **themselves** (take over), but only someone with `approve` may set it to **another** person. Prepared by may be
  any active team member.

## Global Constraints
- **Base:** worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/approver-send`, branch
  `feat/285-approver-send-lead-estimator`, cut from origin/main 805e813e.
- **Setup:** run `npm ci` before any gate; never symlink. Copy `.env.local` and `next-env.d.ts` from the main checkout.
  Never `git stash`. Never open `.data/pglite`.
- **Client-safe modules** (`quote-next-step.ts`, `quote-approval-rules.ts`, `review-limits.ts`, `review-line.ts`,
  `approval-snapshot.ts`) never import a store, db, users, session or settings. The `next build` gate proves it.
- **Harness:** `scripts/test-review-and-spec.ts`. Add new blocks at EOF with an `a286` import prefix and
  `fixtureId(286, …)`. Register a new `async function approval286AsyncChecks()` on the promise chain right after
  `approval284AsyncChecks()`.
- **Existing #284 checks:** they encode the old owner-only rules. Retarget each to the new rule, keeping its intent and
  PASS message where still true. Never delete a check silently.
- **Gate per task:**
  - `npx tsc --noEmit -p .`: 0 errors
  - `npm run test:specs`: ends ALL PASSED
  - `node --stack-size=20000 node_modules/eslint/bin/eslint.js <touched files>`: no new errors
  - `npx next build`: succeeds
  - Delete only the `tmp.*` dirs your own runs created.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Copy (verbatim):**
  - "Send to customer →", "Approve & send →", "Approve only (owner sends)", "Submit for approval", "Send back…"
  - Field labels "Lead estimator" and "Prepared by"
  - Errors: "Only an approver can make someone else the lead estimator." and "Pick someone on the team."

---

### Task A: Approvers can send any quote; anyone can submit

**Files:**
- `src/lib/review-limits.ts`: replace `canSelfApprove` with `approverOnTransition`
- `src/lib/stores/quotes.ts`: `decideApprovalGate` and a stamp builder
- `src/lib/quote-review-ops.ts`
- `src/lib/quote-next-step.ts`
- `src/lib/quote-next-step-server.ts`
- `src/app/(app)/quotes/review-actions.ts`
- `src/components/quote-review/quote-next-step.tsx`
- harness

**Rules:**
1. **Gate stamp for an approver actor.** Replace `canSelfApprove(q, ctx, actor)` with
   `approverOnTransition(q, ctx, actor): { by: string; method: "self" | "in_app" } | null`.
   - It returns non-null when the **actor** (not the owner) resolves to an active roster entry with `canApprove`.
   - `method` is `"self"` when the actor is the owner (`sameName` via `quoteOwnerName`), else `"in_app"`.
   - A review in `changes` blocks only the `"self"` case. A non-owner approver deciding to send is a fresh approver
     decision and may override another approver's send-back.
   - `decideApprovalGate` keeps the order: holds → approver actor → auto limit → refusal.
   - The stamp: `state "approved"`, `decidedBy: actor`, `reviewer: actor`, `method`, and `approvedAgainst` set to the
     fingerprint.
     - For `"self"`, keep today's `submittedBy`/`submittedAt` = owner/now.
     - For `"in_app"`, keep any existing `submittedBy`/`submittedAt` from the in-review record, otherwise null.
   - Update D518's wording in Task C.
2. **Submit.** `submitQuoteForApproval` allows any actor with `can("create")`, not only the owner. The state rules are
   unchanged. `submittedBy` is the actor.
3. **Withdraw.** `withdrawQuoteReview` allows the owner OR the review's `submittedBy`.
4. **Approve only.** `approveQuoteReview(id, actor, asOf)` now also accepts state `none`, `changes`, or a lapsed
   approval on a **draft**, when the actor is a non-owner approver. The store `approve()` takes an option
   `{ allowUnsubmitted: true }` that relaxes its under-lock `in_review` check to `in_review | none | changes | approved`.
   The `asOf` check still applies under the lock. In-review behaviour is unchanged.
5. **Approve & send.** `sendQuoteToCustomer(id, actor, asOf?)`: when `asOf` is given and differs from
   `q.updatedAt`, refuse with "This quote changed since you opened it — reload to review the current version." The
   gate stamps the approval through rule 1. `nsSendAction(id, asOf?)` passes it through.
   - Sending is allowed for any actor whose gate passes, i.e. an approver, an approved quote, or within the owner's
     limit.
   - Additionally require `can("send")` OR `can("approve")`. Pure Reviewers lack `send` but may approve-and-send.
6. **`quoteNextStep` input** gains `viewerCanCreate` and `viewerCanSend`; the server helper fills them from `can()`.
   New view rules for a **non-owner** viewer:

   | Quote state (draft unless noted) | Viewer | Primary | Secondary |
   |---|---|---|---|
   | none / changes / stale | `viewerCanApprove` | send "Send to customer →" | ⋯ `approve` "Approve only (owner sends)", `submit` "Submit for approval", `assign` "Assign to…" |
   | in_review | `viewerCanApprove` | send "Approve & send →" | visible `sendBack` "Send back…", ⋯ `approve` "Approve only (owner sends)"; `approverMode: true` |
   | approved and holds | `viewerCanApprove` or `viewerCanSend` | send "Send to customer →" | — |
   | none / changes / stale | `viewerCanCreate`, not approver | submit "Submit for approval" / "Resubmit for approval" | ⋯ `assign` |
   | in_review, viewer is `submittedBy` | — | — | ⋯ `withdraw` "Withdraw" |
   | sent quote with a lapsed approval | non-owner approver | none (Won via the status menu stamps them) | — |

   - The owner rules are unchanged, with one exception: an owner who is also an approver and is in `changes` keeps
     Resubmit.
   - The phone `approverOnly` mode shows the in-review approver actions: Approve & send, Send back, Approve only.
7. **Component.**
   - `primary.action === "send"` passes `view.asOf` when `view.approverMode` (Approve & send) or when the viewer isn't
     the owner.
   - The `approve` secondary calls `nsApproveAction(id, asOf)`.
   - When `primary.action` is send and `approverMode` is set, skip `beforeAction`, matching Approve's behaviour.
8. **Notifications.** No change, except the "Back from review" bell: include `method: "in_app"` approvals stamped by a
   non-owner approver only while the quote is still a draft (Approve only). A send moves the quote out of draft, so
   that is already covered by status draft.

**Tests:**
- Pure:
  - `approverOnTransition` for owner-approver, non-owner approver, non-approver, and `changes` (self blocked,
    non-owner allowed).
  - A `decideApprovalGate` stamp has `method "in_app"`, `decidedBy` = actor.
  - Every new `quoteNextStep` table row above, including "Jeff views Jena's draft → Send to customer → · Approve only ·
    Submit".
- DB, with seeded Jeff (Admin) and owner "T285 Jena", not on the roster:
  - Jeff `sendQuoteToCustomer` on Jena's unsubmitted draft → sent, review `in_app` by Jeff.
  - A non-approver non-owner submit → ok, `submittedBy` = actor.
  - The submitter withdraws.
  - Approve only on an unsubmitted draft → approved, still draft.
  - Approve & send with a stale `asOf` → refused, nothing written.
  - A pure Reviewer without `send` can approve & send. Use a roles option on the actor; the ops take `{name, roles}`.

### Task B: Lead estimator + Prepared by

**Files:**
- `src/app/(app)/estimator/actions.ts`: new `setQuotePeopleAction`
- `src/app/(app)/estimator/estimator-client.tsx`: the Quote details panel, near the "Prepared for" context fields
  (around the `CTX_LABEL` "Prepared for" block, ~line 2778)
- `src/app/(app)/estimator/page.tsx`: pass `team` (active user names) and the initial `preparedBy`
- `src/app/(app)/estimator/quote-document.tsx`: "Prepared by" prints `preparedBy || owner`; "Questions? Reach out to …"
  stays the lead estimator (`owner`)
- `src/app/(app)/quotes/page.tsx`: the hub row sub-line, currently `EST-1015 · Nic Trapani`, becomes
  `EST-1015 · Nic Trapani · prepared by Jena` when `preparedBy` differs from `owner`
- the store helper `setQuotePeople` in `src/lib/stores/quotes.ts`
- harness

**Rules:**
- **`setQuotePeopleAction(id, { owner?: string; preparedBy?: string }) → { ok, error?, owner, preparedBy, next }`**:
  - Requires `can("create")`.
  - Each name must exactly match an active user, compared trimmed and case-insensitive and stored with the roster
    spelling. Otherwise return "Pick someone on the team."
  - Changing `owner` to someone other than the actor requires `can("approve")`. Otherwise return "Only an approver can
    make someone else the lead estimator."
  - Setting `owner` to the actor themselves is always allowed with `create`.
  - The store `setQuotePeople` patches only these two fields plus `updatedAt`, appends a history note if the quote
    carries one (check `history` entry shapes; skip if it's status-only), then `revalidatePath`.
  - The result returns the fresh next-step view (`quoteNextStepFor`), because changing the owner changes the
    buttons.
- **Estimator UI.** Two selects in Quote details labelled "Lead estimator" and "Prepared by", listing active team
  names.
  - The Lead estimator select disables the other names when the viewer isn't an approver, with the title "Only an
    approver can hand a quote to someone else". The viewer's own name stays enabled.
  - Changing either select saves immediately through the action. It is not part of Save, because Save's allowlist
    deliberately excludes `owner`.
  - On success, update local `owner`/`preparedBy` state and `setNext(r.next)`. On error, use the `actionError`
    banner.
  - The Estimator's `owner` currently comes from `initial.owner`. Make it state so the document preview's
    `ownerName` and "Prepared by" update live.
- **New quotes.** `preparedBy` defaults to the creator, as it already does in `buildQuote`. Nothing changes for imports
  or the portal.

**Tests:**
- DB:
  - A non-approver sets themselves as lead → ok.
  - A non-approver sets another person → refused with the exact message.
  - An approver sets another person → ok.
  - An unknown name → "Pick someone on the team."
  - `preparedBy` is set to any active member.
  - Case-insensitive input is stored with the roster spelling.
- Source pins:
  - The document prints `preparedBy` with an owner fallback.
  - The hub row shows "prepared by" when it differs.
  - Save's allowlist still excludes `owner`.

### Task C: Docs + gates + browser + ship
- **DECISIONS** (recompute numbers from origin/main first; last is D522):
  - D523: approvers send any quote, with Approve & send and Approve only; anyone with create may submit; the submitter
    may withdraw. This amends D517/D518.
  - D524: Lead estimator = owner and Prepared by = preparedBy, with the take-over-vs-hand-off guard.
- **PUNCHLIST:** #286 with Jeff's two quotes verbatim, DONE. **AGENTS:** a phase-status line amending item 27.
- **Gates:** the four gates with real numbers (smoke included), plus `next build`.
- **Browser walkthrough** on a scratch PGlite (per the #284 recipe: temporary `verify-285` entry in the MAIN checkout's
  `.claude/launch.json`, restored afterwards; dev-login via `/api/auth/callback/dev-login`; port 3285):
  - As Jeff on a draft owned by Jena: Send to customer → sends and the pill reads "Approved · Jeff". Then Approve
    only on another draft. Then Approve & send on an in-review quote.
  - As Nic (Estimator-only) on Jena's draft: Submit for approval works. Lead estimator → Nic works; → Jena is
    disabled or refused.
  - Prepared by → Jena prints on the customer preview.
- **Ship:** fast-forward origin/main, confirm the Vercel production deploy is Ready, remove the worktree.
