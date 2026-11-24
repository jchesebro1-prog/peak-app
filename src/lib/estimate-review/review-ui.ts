import type { StepBadge } from "@/lib/estimate-steps/readiness";
import { STEP_LABEL } from "@/lib/estimate-steps/steps";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import { sendBackNote, WHOLE_ESTIMATE, type NumberedComment } from "./comments";

/**
 * Estimator Phase 4 (spec §11) — the Internal review step's (#378; was
 * Customer review) pure view rules: the Review grid's copy, the sidebar copy, the
 * Labor crew line, the Package checklist rows and the approver's Send back
 * button. #379 removed the client's-eye tabs and their helpers. Client-safe (no server imports).
 */

export const REVIEW_UI_COPY = {
  saveFirst: "Save the estimate first.",
  internalOnly: "Internal only",
  labor: "Labor",
  checklist: "Package checklist",
  comments: "Comments",
  wholeEstimate: WHOLE_ESTIMATE,
  addComment: "Add comment",
  resolve: "Resolve",
  delete: "Delete",
  edited: "edited",
  noLabor: "No labor on this estimate.",
  looseLabor: "Hand-added labor (hr)",
  otherLabor: "Other labor lines",
  laborTotal: "Total",
  alternates: "Alternates (priced separately)",
  checklistClear: "Nothing missing.",
  checklistLoading: "Checking the package…",
  noComments: "No open comments.",
  resolved: "Resolved",
  commentPlaceholder: "What should change?",
  sendBackExtra: "Anything else? (optional)",
  sendBackConfirm: "Send back",
  sendBackSaveFirst: "Save first — the note numbers follow the saved estimate.",
  sendBackNoComments: "There are no open comments to send — add one or type a note.",
  cancel: "Cancel",
  docsError: "Couldn't load the package documents.",
  // #378: the Review tab — the Review spreadsheet on screen.
  gridHint: "Internal only — cost, sell and markup for every line, as on the Review spreadsheet.",
  gridAlternates: "Alternate systems aren't listed.",
  gridLoading: "Loading the review…",
  gridError: "Couldn't load the catalog details — reopen this step to try again.",
  gridStale: "Couldn't refresh the catalog details — manufacturer and item names may be out of date.",
  gridEmpty: "No parts or labor to review yet.",
  gridDownload: "Download spreadsheet",
} as const;

/** "Send back with 1 comment" / "Send back with 3 comments". */
export function sendBackLabel(n: number): string {
  return `Send back with ${n} comment${n === 1 ? "" : "s"}`;
}

/** The approver's Send back shows only while the quote is in review for an approver (QuoteNextStep offers sendBack). */
export function canSendBackFromReview(next: Pick<QuoteNextStepView, "approverMode" | "secondary"> | null | undefined): boolean {
  return !!next && next.approverMode && next.secondary.some((a) => a.action === "sendBack");
}

/** A send-back needs something to say: an open comment or typed text. */
export function sendBackEnabled(openCount: number, extra: string): boolean {
  return openCount > 0 || !!(extra || "").trim();
}

const num = (n: number) => String(Math.round((Number.isFinite(n) ? n : 0) * 100) / 100);

/** "Crew up to 4 · 6 days · 20 OT hrs". */
export function crewLine(crew: { maxCrew: number; days: number; otHours: number }): string {
  return `Crew up to ${num(crew.maxCrew)} · ${num(crew.days)} days · ${num(crew.otHours)} OT hrs`;
}

export type ChecklistRow = { text: string; ok: boolean };

/**
 * The Package checklist: the SAVED package's gap chips (reviewDocsAction —
 * datasheets, drawings, key-product text, client goals), then the LIVE
 * Build package badge. No gaps and a ready badge → one "Nothing missing." row.
 */
export function checklistRows(gaps: readonly string[] | null, pkg: Pick<StepBadge, "state" | "label">): ChecklistRow[] {
  const rows: ChecklistRow[] = (gaps || []).map((text) => ({ text, ok: false }));
  if (pkg.state !== "ok") rows.push({ text: `${STEP_LABEL.package}: ${pkg.label}`, ok: false });
  if (rows.length === 0 && gaps) rows.push({ text: REVIEW_UI_COPY.checklistClear, ok: true });
  return rows;
}

/** The comment target select: Whole estimate (value "") first, then every system in order. */
export function commentTargets(sections: ReadonlyArray<{ id: string; name?: string }>): Array<{ value: string; label: string }> {
  return [
    { value: "", label: WHOLE_ESTIMATE },
    ...(sections || []).map((s) => ({ value: s.id, label: (s.name || "").trim() || "Untitled system" })),
  ];
}

/** A comment's time, short ("Oct 7, 3:04 PM"), Chicago. */
export function commentTime(at: number): string {
  return new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

/**
 * The Review sidebar owns the comment-aware Send back, so the panel's own
 * modal "Send back…" (typed text only — it would drop the comments) is
 * removed from the view it renders. Returns a COPY; `next` is untouched.
 */
export function withoutSendBack<T extends Pick<QuoteNextStepView, "secondary">>(next: T): T {
  return { ...next, secondary: next.secondary.filter((a) => a.action !== "sendBack") };
}

/**
 * The send-back note from the SERVER's numbered list (open comments, numbered
 * against the saved estimate's systems): the same sendBackNote text, so the
 * numbers an approver reads on a pin are the numbers the estimator is sent.
 * Each numbered row keeps its position; systems are rebuilt from the rows in
 * order (first appearance), a row whose system is gone reads Whole estimate.
 */
export function sendBackNoteFromNumbered(numbered: ReadonlyArray<NumberedComment>, extra: string): string {
  const sections: Array<{ id: string; name: string }> = [];
  const comments = (numbered || []).map(({ comment, system }) => {
    const whole = comment.sectionId === null;
    if (whole) return { ...comment, sectionId: null };
    if (!sections.some((s) => s.id === comment.sectionId)) sections.push({ id: comment.sectionId as string, name: system });
    return comment;
  });
  return sendBackNote(comments, sections, extra);
}

/** "Resolve comment 2" / "Delete comment 2"; a resolved comment has no number → "Delete resolved comment". */
export function commentActionLabel(kind: "resolve" | "delete", n: number | null): string {
  const verb = kind === "resolve" ? "Resolve" : "Delete";
  return n == null ? `${verb} resolved comment` : `${verb} comment ${n}`;
}

/** #312 — one custom or curtain line on the review step's Specs card. */
export type SpecLineRow<I> = { system: string; item: I };

