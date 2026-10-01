/**
 * #284 — the ONE rule for "whose approval inbox is this quote in", shared by
 * the nav bell, the Home alerts and the My Queue list so they cannot drift.
 *
 * Pure and CLIENT-SAFE: no store, db, settings, users or session imports
 * (only the pure approval-snapshot helper and review-limits' quoteOwnerName).
 */
import { approvalSnapshotMatches, type FingerprintInput } from "@/lib/approval-snapshot";
import { quoteOwnerName } from "@/lib/review-limits";

type Review = {
  state?: string;
  reviewer?: string | null;
  method?: string | null;
  approvedAgainst?: { sell: number; linesKey: string } | null;
};

export type ApprovalRuleQuote = FingerprintInput & {
  owner?: string | null;
  /** The owner falls back to preparedBy (quoteOwnerName) — one identity with the ops. */
  preparedBy?: string | null;
  status?: string;
  review?: Review | null;
};

/** Trimmed, case-insensitive name match; a blank on either side never matches. */
export function sameName(a?: string | null, b?: string | null): boolean {
  const x = (a || "").trim().toLowerCase();
  const y = (b || "").trim().toLowerCase();
  return x !== "" && x === y;
}

/**
 * In review, not mine, and either I can approve (the reviewer field is
 * advisory — every approver sees every in-review quote) or it is assigned to
 * me by name.
 */
export function quoteAwaitsApprovalBy(q: ApprovalRuleQuote, me: string, canApprove: boolean): boolean {
  const r = q.review;
  return r?.state === "in_review" && !sameName(quoteOwnerName(q), me) && (canApprove || sameName(r.reviewer, me));
}

/**
 * Owner side: a draft that came back — sent back for changes, or approved and
 * still holding (in-app / attested / legacy; self and auto approvals happen at
 * send, and a stale snapshot no longer holds).
 */
export function quoteBackFromReview(q: ApprovalRuleQuote, me: string): "approved" | "changes" | null {
  if (!sameName(quoteOwnerName(q), me) || q.status !== "draft") return null;
  const r = q.review;
  if (r?.state === "changes") return "changes";
  if (r?.state === "approved" && (r.method === "in_app" || r.method === "attested" || !r.method) && approvalSnapshotMatches(q)) return "approved";
  return null;
}
