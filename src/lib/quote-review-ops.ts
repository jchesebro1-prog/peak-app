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

const NOT_FOUND: { ok: false; error: string } = { ok: false, error: "Quote not found." };
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
