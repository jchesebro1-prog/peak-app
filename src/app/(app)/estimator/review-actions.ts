"use server";

import {
  canAddComment, canDelete, canResolve, numberComments, REVIEW_COMMENT_COPY as COPY,
  type NumberedComment, type ReviewComment,
} from "@/lib/estimate-review/comments";
import { requireUser } from "@/lib/session";
import {
  addReviewComment, deleteReviewComment, get as getQuote, resolveReviewComment,
  type Quote, type ReviewCommentWrite,
} from "@/lib/stores/quotes";

/**
 * Estimator Phase 4 (spec §11.3) — the Customer review step's comment actions.
 * Thin: session + permission here (rules in src/lib/estimate-review/comments.ts),
 * the row-locked writes in the quotes store (the only writer of
 * `Quote.reviewComments`). Every result carries the fresh list so the client can
 * replace its copy: ALL comments (oldest first) plus the OPEN ones numbered 1…n
 * against the SAVED estimate's systems.
 */

export type ReviewCommentsView = { comments: ReviewComment[]; numbered: NumberedComment[] };
export type ReviewCommentsResult = ({ ok: true } & ReviewCommentsView) | { ok: false; error: string };

const sectionsOf = (q: Pick<Quote, "spec">): Array<{ id: string; name: string }> => {
  const raw = (q.spec as { sections?: Array<{ id?: unknown; name?: unknown }> } | null | undefined)?.sections;
  return Array.isArray(raw)
    ? raw.filter((s) => !!s && typeof s.id === "string").map((s) => ({ id: s.id as string, name: typeof s.name === "string" ? s.name : "" }))
    : [];
};

const viewOf = (q: Pick<Quote, "spec">, comments: ReviewComment[]): ReviewCommentsView => ({
  comments,
  numbered: numberComments(comments, sectionsOf(q)),
});

/** A write's outcome → the fresh list (re-read for the system names) or the refusal copy. */
async function finish(quoteId: string, r: ReviewCommentWrite): Promise<ReviewCommentsResult> {
  if (!r.ok) {
    const error = { gone: COPY.gone, invalid: COPY.empty, "no-system": COPY.noSystem, full: COPY.full, missing: COPY.missing, forbidden: COPY.cantDelete }[r.reason];
    return { ok: false, error };
  }
  const q = await getQuote(quoteId);
  return q ? { ok: true, ...viewOf(q, r.comments) } : { ok: false, error: COPY.gone };
}

/** The quote's review comments — any signed-in team member. */
export async function listReviewCommentsAction(quoteId: string): Promise<ReviewCommentsResult> {
  await requireUser();
  const q = await getQuote(String(quoteId || ""));
  if (!q) return { ok: false, error: COPY.gone };
  return { ok: true, ...viewOf(q, Array.isArray(q.reviewComments) ? q.reviewComments : []) };
}

/** Add a comment — create | send | approve. `sectionId` null = the whole estimate. */
export async function addReviewCommentAction(quoteId: string, sectionId: string | null, body: string): Promise<ReviewCommentsResult> {
  const user = await requireUser();
  if (!canAddComment(user.roles)) return { ok: false, error: COPY.needsPerm };
  const id = String(quoteId || "");
  const r = await addReviewComment(id, { sectionId: sectionId == null ? null : String(sectionId), body, by: user.name });
  return finish(id, r);
}

/** Resolve a comment — create (the estimator). */
export async function resolveReviewCommentAction(quoteId: string, commentId: string): Promise<ReviewCommentsResult> {
  const user = await requireUser();
  if (!canResolve(user.roles, {})) return { ok: false, error: COPY.needsPerm };
  const id = String(quoteId || "");
  return finish(id, await resolveReviewComment(id, String(commentId || ""), user.name));
}

/** Delete a comment — its author while unresolved, or an approver. */
export async function deleteReviewCommentAction(quoteId: string, commentId: string): Promise<ReviewCommentsResult> {
  const user = await requireUser();
  const id = String(quoteId || "");
  return finish(id, await deleteReviewComment(id, String(commentId || ""), (c) => canDelete(user.roles, c, user.name)));
}
