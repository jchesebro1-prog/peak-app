# Estimate submit-for-approval — design (#284)

**Date:** 2026-10-01 · **Scope:** Estimator + Quotes hub panel (service, rental and
consulting builders adopt the shared component later — out of scope here).

## Problem

Jeff: "Estimates need to be able to submit for approval, there is no clear way to
do this right now and the workflow seems clunky."

The approval machinery exists (D84 review state machine, #60 attest, #242/D396 review
limits, the store-side `decideApprovalGate`) but the experience around it fails:

1. **Hidden.** "Submit for review" lives in the Estimator's review bar, collapsed by
   default behind a small "Show review status ⌄" toggle. The toolbar (Save · status
   select · Customer preview →) has no approval action.
2. **Discovered by error.** Picking Sent/Won without approval snaps the select back and
   shows "This quote needs an approval on record…" — which doesn't say how to get one.
3. **Reviewers aren't told.** The default submit target is "Shared queue (any
   reviewer)", yet the bell, Reviews badge, Home alert and "My queue" tab count only
   named assignments. The bell item links to `/quotes`, not the quote. Approving a
   shared-queue quote takes Reviews → Unclaimed → Claim → Approve.
4. **Submitters aren't told** when approved — they reopen, expand the bar, click Send.
5. **Approvers' own quotes** need a second approver or an attestation note.
6. **Approvals never go stale.** An in-app or attested approval survives later price
   edits (contradicting `hasApproval`'s own docstring).
7. **Two divergent copies** of the controls (Estimator bar, hub panel); the Estimator's
   `submitReviewAction` lacks the hub's server-side owner/state checks.

## Decisions (Jeff, 2026-10-01)

| Question | Answer |
|---|---|
| Scope | Estimator + Quotes hub first; shared component other builders adopt later |
| Routing | Submit goes to **everyone who can approve**; first to act takes it; optional "Assign to…" |
| Edits after approval | Approval **resets when the sell total or the line set changes**; wording/notes edits keep it |
| Notifications | **In-app only** — bell + to-do; no email |
| Approach | **A** — one state-driven next-step button + state pill; review bar retired |
| Approver owns the quote | **Self-approve** — "Send to customer →" directly, stamped "Self-approved by …" |

## Design

### 1. `QuoteNextStep` — one shared component

New `src/components/quote-review/` (client component + a pure `nextStep()` resolver in
`src/lib/quote-next-step.ts` so the rules are testable without React). Rendered in the
Estimator toolbar (right of Save) and in the Quotes hub detail panel, replacing both
copies of the review bar.

`nextStep(quote, viewer, limits)` returns the primary action, secondary actions, pill
text and an optional strip message:

| Quote state | Owner sees (primary · secondary) | Approver, not owner | Anyone else |
|---|---|---|---|
| Draft, review `none`, no approval route | **Submit for approval** · ⋯ Assign to…, Attest approval… | — | — |
| Draft, within owner's review limit **or** owner has `approve` | **Send to customer →** · ⋯ Submit for approval anyway | — | — |
| `in_review` | pill "Waiting for approval" · Withdraw | **Approve** · **Send back…** | pill only |
| `changes` | **Resubmit for approval** · strip shows reviewer's note | — | pill + strip |
| `approved` (any method) and still holds | **Send to customer →** | — | pill only |
| Approval went stale (§2) | **Resubmit for approval** · strip "Approval cleared — total changed since Jeff approved" | — | pill + strip |
| Sent / Won / Lost | pill only (status select owns these) | — | — |

- **Pill** — always visible beside the button: "Draft", "In review · Nic · 2h ago",
  "Changes requested · Jeff", "Approved · Jeff", "Self-approved · Jeff",
  "Auto-approved · within limit", "Attested · Nic".
- **Strip** — a slim, always-visible line under the toolbar only when there is a note
  (changes-requested note, attestation note, stale-approval explanation, auto-limit
  line from `review-line.ts`). Not collapsible. Nothing renders when there's nothing to say.
- **Retired:** the collapsible review bar (`reviewBarOpen`), the "Shared queue / name"
  reviewer `<select>` as a primary control (moves into ⋯ Assign to…), and **Claim**
  (approving or sending back an unclaimed review takes it implicitly). The Reviews
  page drops its Claim button too.
- **Send back…** reuses the existing request-changes modal ("Send back for changes").
  **Attest approval…** reuses the existing attest modal, now under ⋯.
- **Review-limit chip** folds into the pill/strip (the chip's text remains the source
  via `review-limits.ts`); the separate chip disappears from the Estimator and hub.
- **Gate banner gains an action.** When a status/stage move to Sent/Won is refused by
  `ApprovalGateRefused`, the banner keeps its message and adds the current
  `nextStep` primary as a button (e.g. **Submit for approval** or **Send to customer →**).
- **Phone.** The Estimator on a phone shows only the preview today. The preview
  header renders `QuoteNextStep` in approver mode only (Approve · Send back…), so an
  approver can act from a bell tap. Owners still build/submit on desktop.
- Unsaved edits: primary actions that depend on the saved quote (submit, send,
  approve) save first, as Send to customer does today; the pill appends
  " · as last saved" while dirty (existing `savedOnly` behavior).

### 2. Store rules (`src/lib/stores/quotes.ts`, server-enforced)

- **`ApprovalMethod` gains `"self"`.** When an owner who holds `approve` moves their
  own quote to sent/won with no live approval, `decideApprovalGate` stamps
  `state: "approved", method: "self", decidedBy: owner` — same shape and timing as
  `auto_limit` today (granted at the gated transition, not on save). Wording in
  `review-line.ts`: "Self-approved by Jeff". The owner's `approve` permission is read
  from the live team roster at transition time.
- **Approval snapshot + staleness.** Every approval (`in_app`, `attested`, `self`,
  `auto_limit`) records `approvedAgainst: { sell: number; linesKey: string }` where
  `sell` is the quote's sell total and `linesKey` is a stable fingerprint of the line
  set (part id/custom key, qty, unit sell — sorted, hashed). Narrative, notes, terms,
  customer-facing wording and section titles are excluded.
  `hasApproval()` becomes: state `approved` **and** (no snapshot — legacy, still valid
  **or** snapshot matches the quote's current sell + linesKey). `auto_limit` keeps its
  existing `approvalHolds()` check in addition (still fits the limit).
  Stale approvals are **derived, not stored** (same principle as D92's
  `approvalIsStale`); the review record is not rewritten on save. A stale approval
  reads as needing approval everywhere (gate, hub, Reviews, bell).
- **Submit guard parity.** `submitReviewAction` (Estimator) gets the same owner +
  state checks as the hub's `submitQuoteForReview`; both call one store helper.
- **Withdraw.** Owner can move `in_review` → `none` (new store fn `withdrawReview`).
- **Implicit claim.** `approve` / `requestChanges` on an unassigned review set
  `reviewer` to the actor (folding `claimReview` in); a review assigned to someone
  else can still be approved by any approver (today's behavior) — reviewer field is
  advisory, not a lock.

### 3. Notifications (derived — no new table)

In `src/lib/nav-counts.ts` / `queue.ts` / `home-metrics.ts`:

- **Approvers** (`can("approve")`): bell group **"Needs approval"** = every quote with
  live review state `in_review` (shared queue **and** assigned) excluding their own.
  Each item links to
  `/estimator?id=<quoteId>`. Feeds the Reviews nav badge and one to-do item per quote
  ("Approve estimate EST-1042 — Nic"). Assigned-to-me items sort first.
- **Owner/submitter:** bell group **"Ready to send"** (approved, holds, not yet sent,
  owner = me) and **"Sent back"** (state `changes`, owner = me), each linking to the
  quote. They clear naturally when the state moves on.
- Existing "Needs your review" group and its `/quotes` link are replaced by the above.

### 4. Unchanged

Status model and Daylite pipelines (stage tag = status, D236); the service/rental
builders' "Mark as approved" (customer acceptance, engine-owned bypass); portal
bypasses (`portal-firm`, D404); review-limit settings (D396); the Reviews page
(minus Claim; its Approve/Send back use the same store fns); Quick
Design / Grid design reviews.

### 5. Testing

Spec-harness checks (`npm run test:specs`):

- `nextStep()` table: each row of §1 for owner / approver / other / owner-with-approve.
- Self-approve: owner with `approve` sends → `method: "self"`; owner without → refused.
- Staleness: approve → change a line qty → `hasApproval` false, gate refuses send;
  approve → edit narrative/notes → still holds; legacy approval without snapshot holds.
- Shared-queue `in_review` quote appears in every approver's "Needs approval" bell
  and to-do, not the owner's; link targets `/estimator?id=`.
- Owner sees "Ready to send" after approve and "Sent back" after request-changes.
- Submit guard: non-owner submit refused in both actions; withdraw only by owner.
- Implicit claim: approving an unassigned review records the approver as reviewer.

Then the four gates (tsc, test:specs, test:smoke, eslint vs baseline) and a browser
walkthrough on a scratch datadir: Nic (Estimator) submits → Jeff sees bell → opens →
Approves → Nic sees "Ready to send" → Sends; plus Jeff building his own quote and
sending directly (self-approved); plus a post-approval price edit clearing approval.

## Decisions to log

D506 — next-step control replaces the review bar (Estimator + hub).
D507 — approvers self-approve their own quotes (`method: "self"`).
D508 — approvals go stale on sell-total / line-set change (derived snapshot).
D509 — submit routes to all approvers; implicit claim; in-app notifications only.
(Recompute numbers from origin/main immediately before writing DECISIONS.md.)
