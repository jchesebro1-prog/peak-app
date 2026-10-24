/**
 * Estimator handoff — src/lib/quote-review-ops.ts ported: the ONE guarded path for every review mutation on a
 * quote (submit, withdraw, approve / approve-only, send back, attest, send to customer). Each op re-checks
 * ownership, permission and state, then calls one quote-repo writer that re-checks again under the per-quote
 * lock; a decision that didn't land is reported from the quote the writer returned. The copy is verbatim.
 *
 * The actor is whoever `ports.users` says is signed in (the shell's role switcher); the approver list is
 * `users.approvers()` and the review limits come from the settings (`reviewLimitContextNow`) — the prototype's
 * stand-ins for users.ts reviewers() and review-limits-server. Plan: PR 2 Task 6.
 */
import { can } from "@/lib/team";
import { approvalHolds, quoteOwnerName } from "@/lib/review-limits";
import { sameName } from "@/lib/quote-approval-rules";
import type { Quote } from "@/lib/stores/quotes";
import { clock, users } from "./ports";
import { reviewLimitContextNow } from "./readers";
import { canAttestApproval, statusFailureMessage, validateAttestationNote } from "./quote-model";
import { QuoteVersionChanged, type QuoteRepo } from "./quote-repo";

export type ReviewActor = { name: string; roles: string[] };
export type ReviewOpResult = { ok: true } | { ok: false; error: string };

export const REVIEW_OPS_COPY = {
  notFound: "Quote not found.",
  noLongerWaiting: "This quote is no longer waiting for approval — reload to see its current state.",
  changedSince: "This quote changed since you opened it — reload to review the current version.",
} as const;

const NOT_FOUND: { ok: false; error: string } = { ok: false, error: REVIEW_OPS_COPY.notFound };
const NO_LONGER_WAITING: { ok: false; error: string } = { ok: false, error: REVIEW_OPS_COPY.noLongerWaiting };
const CHANGED_SINCE: { ok: false; error: string } = { ok: false, error: REVIEW_OPS_COPY.changedSince };

/** One owner identity everywhere (owner, else preparedBy — quoteOwnerName). */
const isOwner = (q: Quote, a: ReviewActor) => {
  const o = quoteOwnerName(q).toLowerCase();
  return o !== "" && o === a.name.trim().toLowerCase();
};

/** A decision that didn't land is reported from the quote the writer returned. */
function outcome(q: Quote | null, want: "approved" | "changes" | "none", asOf?: number): ReviewOpResult {
  if (!q) return NOT_FOUND;
  if ((q.review?.state || "none") === want) return { ok: true };
  if (q.review?.state === "in_review" && typeof asOf === "number" && asOf > 0 && q.updatedAt !== asOf) return CHANGED_SINCE;
  return NO_LONGER_WAITING;
}

/** #287 Approve only: the decision landed only if it was stamped at or after `since`. */
function approveOnlyOutcome(q: Quote | null, since: number, from: string, asOf?: number): ReviewOpResult {
  if (!q) return NOT_FOUND;
  if (q.review?.state === "approved" && (q.review.decidedAt ?? 0) >= since) return { ok: true };
  if ((q.review?.state || "none") === from && typeof asOf === "number" && asOf > 0 && q.updatedAt !== asOf) return CHANGED_SINCE;
  return { ok: false, error: "This quote changed since you opened it — reload to see its current state." };
}

/** Approved on record but no longer counting (stale auto limit, or #284 snapshot). */
const approvalLapsed = (q: Quote): boolean => q.review?.state === "approved" && !approvalHolds(q, reviewLimitContextNow());

/** The ops over one quote repo. */
export function reviewOps(repo: QuoteRepo) {
  async function decidable(id: string, actor: ReviewActor, approveOnly = false): Promise<{ ok: true; q: Quote } | { ok: false; error: string }> {
    if (!can("approve", actor.roles)) return { ok: false, error: "You need approve permission to decide on a quote." };
    const q = id ? await repo.get(id) : null;
    if (!q) return NOT_FOUND;
    const state = q.review?.state || "none";
    const unsubmitted = approveOnly && q.status === "draft" && (state === "none" || state === "changes" || state === "approved");
    if (state !== "in_review" && !unsubmitted) return { ok: false, error: "This quote isn't waiting for approval." };
    if (isOwner(q, actor))
      return { ok: false, error: "You can't approve your own quote here — send it to the customer and your approval is recorded." };
    if (state === "approved" && !approvalLapsed(q)) return { ok: false, error: "This quote is already approved." };
    return { ok: true, q };
  }

  return {
    /** #287: the owner, or anyone who can create quotes, submits one; the actor is the submitter. */
    async submitQuoteForApproval(id: string, actor: ReviewActor, reviewer: string | null): Promise<ReviewOpResult> {
      const q = id ? await repo.get(id) : null;
      if (!q) return NOT_FOUND;
      if (!isOwner(q, actor) && !can("create", actor.roles)) return { ok: false, error: "You need create permission to submit a quote for approval." };
      const state = q.review?.state || "none";
      const lapsed = approvalLapsed(q);
      if (q.status !== "draft" && !(lapsed && q.status === "sent")) return { ok: false, error: "Only a draft quote can be submitted for approval." };
      if (state !== "none" && state !== "changes" && !lapsed)
        return { ok: false, error: state === "in_review" ? "This quote is already waiting for approval." : "This quote is already approved." };
      let assignee: string | null = null;
      if (reviewer && reviewer.trim()) {
        const want = reviewer.trim().toLowerCase();
        const match = users.approvers().find((u) => u.name.trim().toLowerCase() === want);
        if (!match) return { ok: false, error: "Pick an approver from the list." };
        assignee = match.name;
      }
      await repo.submitForReview(id, { by: actor.name, reviewer: assignee });
      return { ok: true };
    },

    /** #287: the owner, or whoever submitted it. */
    async withdrawQuoteReview(id: string, actor: ReviewActor): Promise<ReviewOpResult> {
      const q = id ? await repo.get(id) : null;
      if (!q) return NOT_FOUND;
      if (!isOwner(q, actor) && !sameName(q.review?.submittedBy, actor.name))
        return { ok: false, error: "Only the quote's owner or the person who submitted it can withdraw it." };
      if (q.review?.state !== "in_review") return { ok: false, error: "This quote isn't waiting for approval." };
      return outcome(await repo.withdrawReview(id), "none");
    },

    /** `asOf` = the view's updatedAt: a decision applies only to the version shown. */
    async approveQuoteReview(id: string, actor: ReviewActor, asOf?: number): Promise<ReviewOpResult> {
      const d = await decidable(id, actor, true);
      if (!d.ok) return d;
      const v = asOf && asOf > 0 ? asOf : undefined;
      const from = d.q.review?.state || "none";
      if (from === "in_review") return outcome(await repo.approve(id, { by: actor.name, expectUpdatedAt: v }), "approved", v);
      // #287: Approve only (owner sends) — a non-owner approver on a draft outside review.
      const since = clock.now();
      return approveOnlyOutcome(await repo.approve(id, { by: actor.name, expectUpdatedAt: v, allowUnsubmitted: true, holdsCtx: reviewLimitContextNow() }), since, from, v);
    },

    async sendBackQuoteReview(id: string, actor: ReviewActor, note: string, asOf?: number): Promise<ReviewOpResult> {
      const clean = (note || "").trim();
      if (!clean) return { ok: false, error: "Say what needs to change." };
      const d = await decidable(id, actor);
      if (!d.ok) return d;
      const v = asOf && asOf > 0 ? asOf : undefined;
      return outcome(await repo.requestChanges(id, { by: actor.name, note: clean, expectUpdatedAt: v }), "changes", v);
    },

    async attestQuoteApproval(id: string, actor: ReviewActor, note: string): Promise<ReviewOpResult> {
      const q = id ? await repo.get(id) : null;
      if (!q) return NOT_FOUND;
      if (!isOwner(q, actor) && !can("approve", actor.roles)) return { ok: false, error: "Only the quote's owner can attest an approval on it." };
      const attestable = canAttestApproval(q.review ?? null);
      if (!attestable.ok) return attestable;
      const v = validateAttestationNote(note);
      if (!v.ok) return v;
      await repo.attestApproval(id, { by: actor.name, note: v.note });
      return { ok: true };
    },

    /**
     * Send to customer → / Approve & send →: anyone whose gate passes (an approval that holds, an approver moving
     * it — their approval stamped in the same write — or the owner's limit). Needs `send` or `approve`.
     */
    async sendQuoteToCustomer(id: string, actor: ReviewActor, asOf?: number): Promise<ReviewOpResult> {
      if (!can("send", actor.roles) && !can("approve", actor.roles)) return { ok: false, error: "You need send or approve permission to send a quote." };
      const q = id ? await repo.get(id) : null;
      if (!q) return NOT_FOUND;
      if (q.status !== "draft") return { ok: false, error: "This quote has already been sent." };
      if (typeof asOf === "number" && asOf > 0 && q.updatedAt !== asOf) return CHANGED_SINCE;
      const gate = await repo.checkApprovalGate(q, "sent", actor.name);
      if (!gate.ok) return gate;
      try {
        await repo.setStatus(id, "sent", actor.name, typeof asOf === "number" && asOf > 0 ? { expectUpdatedAt: asOf } : {});
      } catch (e) {
        if (e instanceof QuoteVersionChanged) return CHANGED_SINCE;
        return { ok: false, error: statusFailureMessage(e, "review-ops sendQuoteToCustomer: setStatus(sent) threw") };
      }
      return { ok: true };
    },
  };
}

export type ReviewOps = ReturnType<typeof reviewOps>;
