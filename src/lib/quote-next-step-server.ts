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
    asOf: typeof q.updatedAt === "number" ? q.updatedAt : 0,
  });
}
