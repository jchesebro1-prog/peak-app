/**
 * #284 — the Estimator / Quotes-hub "next step" control as a pure view model
 * (spec §1). The server evaluates `holds` (approvalHolds) and the limit chip;
 * this decides what the viewer sees. #286: a non-owner viewer gets actions
 * too — an approver sends or approves, a creator submits, a submitter
 * withdraws. Client-safe: imports only review-line, team and a type.
 */
import { firstName } from "@/lib/team";
import { approvedReviewLine, staleApprovalLine, staleAutoApprovalLine } from "@/lib/review-line";
import type { ReviewLimitChipData } from "@/lib/review-limits";

export type NextStepAction = "submit" | "send" | "approve" | "sendBack" | "withdraw" | "attest" | "assign";
export type NextStepTone = "draft" | "review" | "changes" | "approved" | "stale";
export type QuoteNextStepView = {
  pill: { label: string; tone: NextStepTone; title: string };
  strip: string | null;
  primary: { action: "submit" | "send" | "approve"; label: string } | null;
  secondary: Array<{ action: NextStepAction; label: string }>;
  reviewers: string[];
  approverMode: boolean;
  /** #286: the viewer owns the quote — a non-owner's Send carries `asOf`. */
  viewerIsOwner: boolean;
  /** The quote's `updatedAt` when this view was computed — Approve / Send back
   *  carry it so an approver never decides a version they didn't see. */
  asOf: number;
};
type ReviewIn = {
  state: string;
  reviewer: string | null;
  submittedBy: string | null;
  decidedBy: string | null;
  note: string;
  method?: "in_app" | "attested" | "auto_limit" | "self" | null;
  auto?: unknown;
};
export type NextStepInput = {
  status: string;
  review: ReviewIn | null;
  holds: boolean;
  chip: ReviewLimitChipData | null;
  owner: string;
  viewer: string;
  viewerCanApprove: boolean;
  /** #286: can("create") — anyone who can create quotes may submit one. */
  viewerCanCreate: boolean;
  /** #286: can("send") — sends an approved quote that isn't theirs. */
  viewerCanSend: boolean;
  submittedAgo: string;
  reviewers: string[];
  /** The quote's `updatedAt` (0 when unknown). */
  asOf?: number;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";

function approvedPill(r: ReviewIn): string {
  const who = firstName(r.decidedBy || r.reviewer || "");
  if (r.method === "attested") return "Attested · " + who;
  if (r.method === "self") return "Self-approved · " + who;
  if (r.method === "auto_limit") return "Auto-approved";
  return "Approved · " + who;
}

export function quoteNextStep(i: NextStepInput): QuoteNextStepView {
  const r: ReviewIn = i.review || { state: "none", reviewer: null, submittedBy: null, decidedBy: null, note: "" };
  const isOwner = same(i.owner, i.viewer);
  const closed = i.status === "won" || i.status === "lost";
  const sent = i.status === "sent";
  // An approval that no longer holds reads as cleared (stale auto limit or #284 snapshot).
  const stale = r.state === "approved" && !i.holds;
  const state = stale ? "stale" : r.state;
  const reviewers = i.reviewers.filter((n) => !same(n, i.owner) && !same(n, i.viewer));

  let pill: QuoteNextStepView["pill"];
  let strip: string | null = null;
  if (state === "in_review") {
    pill = {
      label: "In review · " + (r.reviewer ? "with " + firstName(r.reviewer) : "any approver"),
      tone: "review",
      title: "Submitted by " + firstName(r.submittedBy || i.owner) + (i.submittedAgo ? ", " + i.submittedAgo : ""),
    };
  } else if (state === "changes") {
    pill = { label: "Changes requested · " + firstName(r.decidedBy || ""), tone: "changes", title: "" };
    strip = r.note ? "“" + r.note + "” — " + firstName(r.decidedBy || "") : "Returned by " + firstName(r.decidedBy || "");
  } else if (state === "approved") {
    pill = { label: approvedPill(r), tone: "approved", title: "" };
    // A sent quote is past "ready to send"; a won/lost one has no strip at all.
    strip = closed || sent ? null : approvedReviewLine({ method: r.method ?? null, decidedBy: r.decidedBy, reviewer: r.reviewer, note: r.note, auto: (r.auto as never) ?? null });
  } else if (state === "stale") {
    pill = { label: "Approval cleared", tone: "stale", title: "" };
    strip = r.method === "auto_limit" ? staleAutoApprovalLine(i.chip?.text || "needs review") : staleApprovalLine({ method: r.method ?? null, decidedBy: r.decidedBy, reviewer: r.reviewer, note: r.note });
  } else {
    pill = { label: "Not submitted", tone: "draft", title: "" };
    strip = !closed && !sent && i.chip ? i.chip.text : null;
  }

  const view = (primary: QuoteNextStepView["primary"], secondary: QuoteNextStepView["secondary"] = [], approverMode = false): QuoteNextStepView =>
    ({ pill, strip, primary, secondary, reviewers, approverMode, viewerIsOwner: isOwner, asOf: i.asOf ?? 0 });

  if (closed) return { ...view(null), strip: null };

  const submit = { action: "submit" as const, label: state === "changes" || state === "stale" ? "Resubmit for approval" : "Submit for approval" };
  const assign = { action: "assign" as const, label: "Assign to…" };
  const attest = { action: "attest" as const, label: "Attest approval…" };

  // #286 (Jeff 2026-10-01): a non-owner approver sends or approves any draft;
  // anyone who can create quotes submits one; the submitter may withdraw.
  if (!isOwner) {
    const approveOnly = { action: "approve" as const, label: "Approve only (owner sends)" };
    const withdraw = state === "in_review" && same(r.submittedBy || "", i.viewer) ? [{ action: "withdraw" as const, label: "Withdraw" }] : [];
    // A sent quote whose approval lapsed: Won through the status menu stamps the approver.
    if (sent) return view(null);
    // In review (assigned or shared — the reviewer field is advisory).
    if (state === "in_review") {
      if (i.viewerCanApprove)
        return view({ action: "send", label: "Approve & send →" }, [{ action: "sendBack", label: "Send back…" }, approveOnly, ...withdraw], true);
      return view(null, withdraw);
    }
    if (state === "approved")
      return i.viewerCanApprove || i.viewerCanSend ? view({ action: "send", label: "Send to customer →" }) : view(null);
    // none, changes or stale, draft
    if (i.viewerCanApprove)
      return view({ action: "send", label: "Send to customer →" }, [approveOnly, { action: "submit", label: "Submit for approval" }, assign]);
    if (i.viewerCanCreate) return view(submit, [assign]);
    return view(null);
  }

  if (sent) {
    // #242 final carried forward: a lapsed approval on a sent quote can be resubmitted / attested so it can reach Won.
    return state === "stale" && !i.viewerCanApprove ? view(submit, [assign, attest]) : view(null);
  }
  if (state === "in_review") return view(null, [{ action: "withdraw", label: "Withdraw" }]);
  if (state === "changes") return view(submit, [assign]);
  if (state === "approved") return view({ action: "send", label: "Send to customer →" });
  // none or stale, draft
  if (i.viewerCanApprove || i.chip?.tone === "within")
    return view({ action: "send", label: "Send to customer →" }, [{ action: "submit", label: "Submit for approval anyway" }]);
  return view(submit, [assign, attest]);
}
