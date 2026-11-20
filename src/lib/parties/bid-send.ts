/* #348 slice 2b-ii — the pure bidder-send rules. Browser-safe: types only, no value imports. */

type Revs = { revisions?: unknown[] | null };
type Rev = { rev?: unknown; reason?: unknown; docFields?: { bid?: { addenda?: Array<{ no: number; receivedAt: number }> } | null } | null };

export const isPartyId = (v: unknown): v is string => typeof v === "string" && /^pty_[0-9a-f]{16}$/.test(v);

function latestSentRevision(q: Revs): Rev | null {
  const revs = Array.isArray(q.revisions) ? q.revisions : [];
  for (let i = revs.length - 1; i >= 0; i--) {
    const r = revs[i] as Rev | null;
    if (r && typeof r === "object" && r.reason === "sent" && typeof r.rev === "number" && Number.isSafeInteger(r.rev)) return r;
  }
  return null;
}

export function latestSentRev(q: Revs): number | null {
  const r = latestSentRevision(q);
  return r ? (r.rev as number) : null;
}

export function bidderPdfRev(q: { status: string } & Revs): number | null {
  return q.status === "draft" ? null : latestSentRev(q);
}

export const BID_SEND_COPY = {
  copyLink: "Copy link",
  gone: "That bidder wasn't found.",
  linkCopied: "Link copied.",
  /** #348 follow-up (Jeff 2026-10-15): read-only, sticky — the Bidders card line and the Bid chip's dialog line. */
  scopeOnlyNote: "The owner sees this estimate as Scope only in the portal — a parts list with no prices, no PDF and no Accept. This stays on even if bidders are removed.",
  scopeOnlyChip: "Owner portal: Scope only",
} as const;
