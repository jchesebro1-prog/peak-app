/* #348 slice 2b-ii — the pure bidder-send rules. Browser-safe: types only, no value imports. */
import type { BidderState } from "./rules";

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

export type SendRow = { id: string; bid: BidderState; email: string };

const sendable = (status: string) => status === "draft" || status === "sent";

export function bidderEmailNeed(q: { status: string } & Revs, row: SendRow): "send" | "revision" | "retry" | null {
  if (!sendable(q.status)) return null;
  const b = row.bid;
  if (b.result !== "pending" || b.submitVia !== "email" || !String(row.email || "").trim()) return null;
  if (q.status === "sent") {
    const L = latestSentRev(q);
    if (L != null && b.revSent != null && b.revSent >= L) return null;
  }
  if (b.failed) return "retry";
  return b.revSent == null ? "send" : "revision";
}

export function bidderSendPlan(q: { status: string } & Revs, rows: ReadonlyArray<SendRow>): { ids: string[]; label: string | null; noEmail: number } {
  const planned = rows.filter((r) => bidderEmailNeed(q, r) !== null && !r.bid.failed?.unknown);
  const noEmail = sendable(q.status)
    ? rows.filter((r) => r.bid.result === "pending" && r.bid.submitVia === "email" && !String(r.email || "").trim()).length
    : 0;
  const label = planned.length === 0 ? null : planned.some((r) => r.bid.revSent != null) ? "Send revision to bidders" : "Send to all bidders";
  return { ids: planned.map((r) => r.id), label, noEmail };
}

export function bidderAlreadyHas(q: { status: string } & Revs, bid: BidderState): boolean {
  const L = latestSentRev(q);
  return q.status === "sent" && L != null && bid.revSent != null && bid.revSent >= L;
}

type BidQ = { bid?: { addenda?: Array<{ no: number; receivedAt: number }> } | null } & Revs;

function missingFrom(live: Array<{ no: number }>, frozen: Array<{ no: number }>): number[] {
  const have = new Set(frozen.filter((a) => a && typeof a.no === "number").map((a) => a.no));
  return live.filter((a) => a && typeof a.no === "number" && !have.has(a.no)).map((a) => a.no).sort((a, b) => a - b);
}

export function addendaSinceRow(q: BidQ, bid: BidderState): number[] {
  if (bid.revSent == null) return [];
  const live = q.bid?.addenda || [];
  const revs = Array.isArray(q.revisions) ? (q.revisions as Rev[]) : [];
  const rev = revs.find((r) => r && typeof r === "object" && r.rev === bid.revSent);
  const frozen = rev?.docFields?.bid?.addenda;
  if (Array.isArray(frozen)) return missingFrom(live, frozen);
  const sentAt = bid.sentAt ?? 0;
  return live.filter((a) => a && typeof a.no === "number" && typeof a.receivedAt === "number" && a.receivedAt > sentAt).map((a) => a.no).sort((a, b) => a - b);
}

export function addendaAfterLatestSend(q: BidQ): number[] {
  const r = latestSentRevision(q);
  const frozen = r?.docFields?.bid?.addenda;
  if (!r || !Array.isArray(frozen)) return [];
  return missingFrom(q.bid?.addenda || [], frozen);
}

export function bidderSubject(base: string, estimateName: string, newAddenda: number[]): string {
  if (newAddenda.length === 0) return base;
  const text = newAddenda.length === 1
    ? `Revised bid — ${estimateName} (Addendum ${newAddenda[0]})`
    : `Revised bid — ${estimateName} (Addenda ${newAddenda.join(", ")})`;
  return text.slice(0, 300);
}

export function bidWalkSummary(s: { total: number; sent: number; failed: number; local: number; stoppedError?: string | null }): string {
  let out: string;
  if (s.stoppedError) out = `Stopped after ${s.sent} of ${s.total}: ${s.stoppedError}`;
  else if (s.failed === 0) out = `Sent to ${s.sent} bidder${s.sent === 1 ? "" : "s"}.`;
  else out = `Sent to ${s.sent} of ${s.total} bidders — ${s.failed} failed. Retry ${s.failed === 1 ? "it" : "them"} below.`;
  if (s.local > 0) out += " Saved locally — Gmail isn’t connected.";
  return out;
}

export const BID_SEND_COPY = {
  sendAll: "Send to all bidders",
  sendRevision: "Send revision to bidders",
  progress: (i: number, n: number) => `Sending ${i} of ${n}…`,
  stop: "Stop",
  rowSend: "Send",
  rowRevision: "Send revision",
  rowRetry: "Retry",
  copyLink: "Copy link",
  noEmailChip: "No email",
  noEmailTitle: "Add an email for this contact on the company page.",
  composeTitle: "Email bidders",
  recipients: (names: string[]) => `To: ${names.join(", ")} (${names.length} bidder${names.length === 1 ? "" : "s"})`,
  linkHint: "Keep {link} where each bidder’s own link should go.",
  revisedHint: (subject: string) => `Bidders who missed an addendum get “${subject}”.`,
  sendN: (n: number) => `Send to ${n} bidder${n === 1 ? "" : "s"}`,
  cancel: "Cancel",
  gone: "That bidder wasn't found.",
  notPending: "Only a pending bidder can be emailed.",
  website: "This bidder submits through their bid website — use Download PDF and Mark submitted.",
  noEmail: (who: string) => `${who} has no email address — add one on the company page.`,
  unknownRetry: "Gmail didn’t answer in time for this bidder — check your Gmail Sent folder, then Retry.",
  unknownConfirm: (co: string) => `Gmail didn’t answer in time when this went to ${co}. Check your Gmail Sent folder first — send it again anyway?`,
  tooLarge: "The bidder PDF is over 15 MB — too large to email.",
  recordFailed: "Sent — but the bidder row couldn’t be updated. Check Activity before sending again.",
  addendumHint: (nos: number[]) => `Addendum ${nos.join(", ")} came in after the last send — move the estimate back to Draft, then Send revision to bidders.`,
  linkCopied: "Link copied.",
} as const;
