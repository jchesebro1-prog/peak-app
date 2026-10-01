/**
 * #284 — the ONE guarded path for every review mutation on a quote. The
 * Estimator, the Quotes hub, the Reviews page and the next-step control all
 * call these; each re-checks ownership, permission and state on the server
 * (a hidden button is not access control — punch #60). Returns a typed
 * result whose `error` is written for the user.
 *
 * #286 (Jeff 2026-10-01): anyone who can create quotes submits one, the owner
 * or the submitter withdraws it, and an approver may approve ("Approve only
 * (owner sends)") or send any quote — the gate stamps the approver's own
 * approval (approverOnTransition).
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
  isQuoteVersionChanged,
  canAttestApproval,
  validateAttestationNote,
  statusFailureMessage,
  type Quote,
} from "@/lib/stores/quotes";
import { approvalHolds, quoteOwnerName } from "@/lib/review-limits";
import { sameName } from "@/lib/quote-approval-rules";
import { loadReviewLimitContext } from "@/lib/review-limits-server";
import { reviewers as approverRows } from "@/lib/users";

export type ReviewActor = { name: string; roles: string[] };
export type ReviewOpResult = { ok: true } | { ok: false; error: string };

const NOT_FOUND: { ok: false; error: string } = { ok: false, error: "Quote not found." };
const NO_LONGER_WAITING: { ok: false; error: string } = {
  ok: false,
  error: "This quote is no longer waiting for approval — reload to see its current state.",
};
const CHANGED_SINCE: { ok: false; error: string } = {
  ok: false,
  error: "This quote changed since you opened it — reload to review the current version.",
};
/** One owner identity everywhere (owner, else preparedBy — quoteOwnerName). */
const isOwner = (q: Quote, a: ReviewActor) => {
  const o = quoteOwnerName(q).toLowerCase();
  return o !== "" && o === a.name.trim().toLowerCase();
};

/** The store re-checks state (and version) under the row lock; a decision that
 *  didn't land is reported from the quote it returned. */
function outcome(q: Quote | null, want: "approved" | "changes" | "none", asOf?: number): ReviewOpResult {
  if (!q) return NOT_FOUND;
  if ((q.review?.state || "none") === want) return { ok: true };
  if (q.review?.state === "in_review" && typeof asOf === "number" && asOf > 0 && q.updatedAt !== asOf) return CHANGED_SINCE;
  return NO_LONGER_WAITING;
}

/** #286: Approve only on a quote that wasn't in review. It may already have
 *  been "approved" (a lapsed approval), so the state alone can't tell — the
 *  decision landed only if it was stamped at or after `since`. */
function approveOnlyOutcome(q: Quote | null, since: number, from: string, asOf?: number): ReviewOpResult {
  if (!q) return NOT_FOUND;
  if (q.review?.state === "approved" && (q.review.decidedAt ?? 0) >= since) return { ok: true };
  if ((q.review?.state || "none") === from && typeof asOf === "number" && asOf > 0 && q.updatedAt !== asOf) return CHANGED_SINCE;
  return { ok: false, error: "This quote changed since you opened it — reload to see its current state." };
}

/** Approved on record but no longer counting (stale auto limit, or #284 snapshot). */
async function approvalLapsed(q: Quote): Promise<boolean> {
  return q.review?.state === "approved" && !approvalHolds(q, await loadReviewLimitContext());
}

/** #286: the owner, or anyone who can create quotes, submits one; the actor is the submitter. */
export async function submitQuoteForApproval(id: string, actor: ReviewActor, reviewer: string | null): Promise<ReviewOpResult> {
  const q = id ? await get(id) : null;
  if (!q) return NOT_FOUND;
  if (!isOwner(q, actor) && !can("create", actor.roles))
    return { ok: false, error: "You need create permission to submit a quote for approval." };
  const state = q.review?.state || "none";
  const lapsed = await approvalLapsed(q);
  // #242 final carried forward: a lapsed approval on a SENT quote may be resubmitted so it can still reach Won.
  if (q.status !== "draft" && !(lapsed && q.status === "sent"))
    return { ok: false, error: "Only a draft quote can be submitted for approval." };
  if (state !== "none" && state !== "changes" && !lapsed)
    return { ok: false, error: state === "in_review" ? "This quote is already waiting for approval." : "This quote is already approved." };
  // "Assign to…" names an active approver from the list — never free text.
  let assignee: string | null = null;
  if (reviewer && reviewer.trim()) {
    const want = reviewer.trim().toLowerCase();
    const match = (await approverRows()).find((u) => u.name.trim().toLowerCase() === want);
    if (!match) return { ok: false, error: "Pick an approver from the list." };
    assignee = match.name;
  }
  await submitForReview(id, { by: actor.name, reviewer: assignee });
  return { ok: true };
}

/** #286: the owner, or whoever submitted it. */
export async function withdrawQuoteReview(id: string, actor: ReviewActor): Promise<ReviewOpResult> {
  const q = id ? await get(id) : null;
  if (!q) return NOT_FOUND;
  if (!isOwner(q, actor) && !sameName(q.review?.submittedBy, actor.name))
    return { ok: false, error: "Only the quote's owner or the person who submitted it can withdraw it." };
  if (q.review?.state !== "in_review") return { ok: false, error: "This quote isn't waiting for approval." };
  return outcome(await withdrawReview(id), "none");
}

async function decidable(
  id: string,
  actor: ReviewActor,
  approveOnly = false
): Promise<{ ok: true; q: Quote } | { ok: false; error: string }> {
  if (!can("approve", actor.roles)) return { ok: false, error: "You need approve permission to decide on a quote." };
  const q = id ? await get(id) : null;
  if (!q) return NOT_FOUND;
  // #286: Approve only also takes a draft that was never submitted, came back, or whose approval lapsed.
  const state = q.review?.state || "none";
  const unsubmitted = approveOnly && q.status === "draft" && (state === "none" || state === "changes" || state === "approved");
  if (state !== "in_review" && !unsubmitted) return { ok: false, error: "This quote isn't waiting for approval." };
  if (isOwner(q, actor))
    return { ok: false, error: "You can't approve your own quote here — send it to the customer and your approval is recorded." };
  if (state === "approved" && !(await approvalLapsed(q))) return { ok: false, error: "This quote is already approved." };
  return { ok: true, q };
}

/**
 * `asOf` is the quote's `updatedAt` when the approver's view was computed
 * (QuoteNextStepView.asOf / the Reviews row): the owner can keep saving while
 * a quote is in review, so a decision applies only to the version shown.
 * Omitted (or 0) skips the version check.
 */
export async function approveQuoteReview(id: string, actor: ReviewActor, asOf?: number): Promise<ReviewOpResult> {
  const d = await decidable(id, actor, true);
  if (!d.ok) return d;
  const v = asOf && asOf > 0 ? asOf : undefined;
  const from = d.q.review?.state || "none";
  if (from === "in_review") return outcome(await approve(id, { by: actor.name, expectUpdatedAt: v }), "approved", v);
  // #286: Approve only (owner sends) — a non-owner approver on a draft outside review; the owner sends it.
  // The store re-checks draft-only and lapsed-only under the row lock, against the same limits.
  const since = Date.now();
  const holdsCtx = await loadReviewLimitContext();
  return approveOnlyOutcome(await approve(id, { by: actor.name, expectUpdatedAt: v, allowUnsubmitted: true, holdsCtx }), since, from, v);
}

export async function sendBackQuoteReview(id: string, actor: ReviewActor, note: string, asOf?: number): Promise<ReviewOpResult> {
  const clean = (note || "").trim();
  if (!clean) return { ok: false, error: "Say what needs to change." };
  const d = await decidable(id, actor);
  if (!d.ok) return d;
  const v = asOf && asOf > 0 ? asOf : undefined;
  return outcome(await requestChanges(id, { by: actor.name, note: clean, expectUpdatedAt: v }), "changes", v);
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

/**
 * Send to customer → / Approve & send →. Anyone whose gate passes may send:
 * an approval that holds, an approver moving it (#286: their approval is
 * stamped in the same write — approverOnTransition), or the owner's limit.
 * Needs `send` or `approve` — a pure Reviewer lacks `send` but may approve
 * and send. `asOf` (the view's updatedAt): refuse a version the sender wasn't
 * shown.
 */
export async function sendQuoteToCustomer(id: string, actor: ReviewActor, asOf?: number): Promise<ReviewOpResult> {
  if (!can("send", actor.roles) && !can("approve", actor.roles))
    return { ok: false, error: "You need send or approve permission to send a quote." };
  const q = id ? await get(id) : null;
  if (!q) return NOT_FOUND;
  if (q.status !== "draft") return { ok: false, error: "This quote has already been sent." };
  if (typeof asOf === "number" && asOf > 0 && q.updatedAt !== asOf) return CHANGED_SINCE;
  const gate = await checkApprovalGate(q, "sent", actor.name);
  if (!gate.ok) return gate;
  try {
    // #286: the version check again under the row lock (an edit between the read above and the write).
    await setStatus(id, "sent", actor.name, typeof asOf === "number" && asOf > 0 ? { expectUpdatedAt: asOf } : {});
  } catch (e) {
    if (isQuoteVersionChanged(e)) return CHANGED_SINCE;
    return { ok: false, error: statusFailureMessage(e, "quote-review-ops sendQuoteToCustomer: setStatus(sent) threw") };
  }
  return { ok: true };
}
