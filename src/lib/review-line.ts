import { firstName } from "@/lib/team";

/**
 * The one place that phrases an APPROVED review for a human (punch #77).
 *
 * **This module must stay client-safe.** It is imported by
 * `estimator-client.tsx`, a `"use client"` component. It may therefore import
 * only things that never reach the database — `@/lib/team` qualifies. It must
 * NOT import from `@/lib/stores/quotes`, which pulls in the doc store and
 * through it drizzle and `postgres`: that exact mistake 500'd the whole
 * Estimator earlier on 2026-08-01 (see `src/lib/fixture-rates.ts` for the
 * other half of that lesson). `tsc` cannot catch it; only loading the page can.
 *
 * Hence the structural input type rather than importing `QuoteReview` — it
 * keeps this module free of any dependency on the store, and `QuoteReview`
 * satisfies it structurally.
 *
 * **Why it is shared rather than inlined.** The quotes list and the Estimator
 * both render this sentence. When they were separate copies, the list silently
 * dropped the attestation detail — showing "Approved by Jeff" for a review that
 * actually happened on a Teams call, losing the attribution that attestation
 * exists to provide. Two copies of one rule is also how #60 and #65 each went
 * wrong. Change the wording here and both surfaces move together.
 */
export type ApprovedReviewLike = {
  method?: "in_app" | "attested" | null;
  decidedBy: string | null;
  reviewer: string | null;
  note: string;
};

/**
 * - `method === "attested"` — an off-platform review recorded by the estimator
 *   themself (punch #60): shows WHO recorded it and, when present, the
 *   mandatory note naming who actually reviewed it and how.
 * - anything else, including legacy docs decided before punch #60 where
 *   `method` is absent/null — renders as a plain in-app approval, exactly as it
 *   did before `method` existed. Legacy approvals are still valid approvals;
 *   they must not read as attested and must not break.
 *
 * Caller is expected to only invoke this for `review.state === "approved"`.
 */
export function approvedReviewLine(review: ApprovedReviewLike): string {
  return review.method === "attested"
    ? "Attested by " +
        firstName(review.decidedBy || "") +
        (review.note ? " — “" + review.note + "”" : "") +
        " — ready to send to the customer"
    : "Approved by " +
        firstName(review.decidedBy || review.reviewer || "") +
        " — ready to send to the customer";
}
