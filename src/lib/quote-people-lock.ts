/**
 * Jeff 2026-10-15 #18 — Lead estimator (`owner`) and Prepared by
 * (`preparedBy`) lock at the quote's FIRST send: from then on only an approver
 * (`approve`) may change them; the server refuses anyone else
 * (setQuotePeopleAs), and the Estimator shows the selects read-only. Pure and
 * client-safe. (Everyone holds `approve` today, so this is latent until a
 * non-approver exists.)
 */

export const PEOPLE_LOCKED_AFTER_SEND = "Lead estimator and Prepared by are locked once the quote has been sent — ask an approver to change them.";

type SentFields = {
  status?: string | null;
  revisions?: ReadonlyArray<{ reason?: unknown } | null | undefined> | null;
  history?: ReadonlyArray<{ to?: unknown } | null | undefined> | null;
};

/** Has this quote ever been sent? A sent revision, a status move to sent, or a status at/after sent. */
export function quoteSentOnce(q: SentFields | null | undefined): boolean {
  if (!q) return false;
  if (q.status === "sent" || q.status === "won" || q.status === "lost") return true;
  if ((q.revisions || []).some((r) => !!r && r.reason === "sent")) return true;
  return (q.history || []).some((h) => !!h && h.to === "sent");
}

/** May this viewer change the quote's people? Unlocked before the first send; after it, approvers only. */
export function canChangeQuotePeople(q: SentFields | null | undefined, canApprove: boolean): boolean {
  return canApprove || !quoteSentOnce(q);
}
