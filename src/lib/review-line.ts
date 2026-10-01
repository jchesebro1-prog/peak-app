import { firstName } from "@/lib/team";
import { reviewKindPhrase } from "@/lib/review-limits";
import { money } from "@/lib/format";

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
  method?: "in_app" | "attested" | "auto_limit" | "self" | null;
  decidedBy: string | null;
  reviewer: string | null;
  note: string;
  /** #242: an `auto_limit` approval's snapshot (kind, limit, value; who
   *  moved the quote and to what — absent on older snapshots). */
  auto?: { kind: string; limit: number | "none"; value: number; triggeredBy?: string; trigger?: "sent" | "won" } | null;
};

/**
 * - `method === "attested"` — an off-platform review recorded by the estimator
 *   themself (punch #60): shows WHO recorded it and, when present, the
 *   mandatory note naming who actually reviewed it and how.
 * - `method === "auto_limit"` — #242: autoApprovalLine (no "ready to send" suffix).
 * - anything else, including legacy docs decided before punch #60 where
 *   `method` is absent/null — renders as a plain in-app approval, exactly as it
 *   did before `method` existed. Legacy approvals are still valid approvals;
 *   they must not read as attested and must not break.
 *
 * Caller is expected to only invoke this for `review.state === "approved"`.
 */
export function approvedReviewLine(review: ApprovedReviewLike): string {
  if (review.method === "auto_limit") return autoApprovalLine(review);
  if (review.method === "self") return "Self-approved by " + firstName(review.decidedBy || "");
  return review.method === "attested"
    ? "Attested by " +
        firstName(review.decidedBy || "") +
        (review.note ? " — “" + review.note + "”" : "") +
        " — ready to send to the customer"
    : "Approved by " +
        firstName(review.decidedBy || review.reviewer || "") +
        " — ready to send to the customer";
}

/** #242: "Auto-approved — within Nic's $25,000 limit for system estimates
 *  without labor" (or "… Nic has no review limit for rentals"). #242 final:
 *  when someone other than the owner moved the quote, "… — sent by Jena" (or
 *  "— marked Won by Jena"). Snapshots written before `triggeredBy` render
 *  without the suffix. */
export function autoApprovalLine(review: ApprovedReviewLike): string {
  const who = firstName(review.decidedBy || "");
  const a = review.auto;
  if (!a) return "Auto-approved — within " + who + "'s review limit";
  const phrase = reviewKindPhrase(a.kind);
  const base =
    a.limit === "none"
      ? `Auto-approved — ${who} has no review limit for ${phrase}`
      : `Auto-approved — within ${who}'s ${money(a.limit)} limit for ${phrase}`;
  const by = (a.triggeredBy || "").trim();
  if (!by || by.toLowerCase() === (review.decidedBy || "").trim().toLowerCase()) return base;
  return `${base} — ${a.trigger === "won" ? "marked Won" : "sent"} by ${firstName(by)}`;
}

/** #242: the banner for an auto approval that no longer holds. */
export function staleAutoApprovalLine(chipText: string): string {
  const t = chipText || "needs review";
  return "Auto-approval no longer applies — " + t.charAt(0).toLowerCase() + t.slice(1);
}

/** #284: an in-app / attested / self approval the quote has since moved away
 *  from (price or priced lines changed) — it no longer counts. */
export function staleApprovalLine(review: ApprovedReviewLike): string {
  return "Approval cleared — the price or lines changed since " + firstName(review.decidedBy || review.reviewer || "") + " approved it";
}
