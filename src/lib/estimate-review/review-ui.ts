import { previewPath, type PreviewTab, type ReviewDatasheetRow } from "@/lib/estimate-output/package-preview";
import type { StepBadge } from "@/lib/estimate-steps/readiness";
import { STEP_LABEL } from "@/lib/estimate-steps/steps";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import { sendBackNote, WHOLE_ESTIMATE, type NumberedComment } from "./comments";

/**
 * Estimator Phase 4 (spec §11) — the Customer review step's pure view rules:
 * the client's-eye tabs, the framed preview's src / width, the sidebar copy,
 * the Labor crew line, the Package checklist rows, the Datasheets cell states
 * and the approver's Send back button. Client-safe (no server imports).
 */

export const REVIEW_UI_COPY = {
  unsaved: "Unsaved changes — Save to refresh what the client sees.",
  saveFirst: "Save the estimate first.",
  save: "Save",
  desktop: "Desktop",
  phone: "Phone",
  internalOnly: "Internal only",
  labor: "Labor",
  checklist: "Package checklist",
  specs: "Specs",
  specsHint: "Pick the spec each custom or curtain line specs as.",
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
  noDatasheets: "No catalog parts print on this estimate.",
  noDrawings: "No drawings on this estimate.",
  docsError: "Couldn't load the package documents.",
  datasheetMissing: "Missing",
  notNeeded: "not needed",
} as const;

export const REVIEW_TABS = ["document", "package", "bom", "cutsheets", "datasheets", "drawings"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];
export const REVIEW_TAB_LABEL: Record<ReviewTab, string> = {
  document: "Document",
  package: "Package page",
  bom: "BOM",
  cutsheets: "Cut sheets",
  datasheets: "Datasheets",
  drawings: "Drawings",
};

export type ReviewDevice = "desktop" | "phone";
export const REVIEW_DEVICES: ReviewDevice[] = ["desktop", "phone"];
export const REVIEW_DEVICE_LABEL: Record<ReviewDevice, string> = { desktop: REVIEW_UI_COPY.desktop, phone: REVIEW_UI_COPY.phone };
/** A phone-width frame, so the client pages' own media queries apply. */
export const PHONE_FRAME_WIDTH = 390;

/** The staff preview tab a review tab frames, or null (Document / Datasheets / Drawings aren't framed). */
export function framedTab(tab: ReviewTab): PreviewTab | null {
  return tab === "package" || tab === "bom" || tab === "cutsheets" ? tab : null;
}

/** Whether a tab needs a saved quote (everything but the Document tab, which has its own Save). */
export function tabNeedsSave(tab: ReviewTab): boolean {
  return tab !== "document";
}

/** The framed tab's src — `/estimator-preview/<id>?tab=…`; null when unsaved or not a framed tab. */
export function frameSrc(quoteId: string | null | undefined, tab: ReviewTab): string | null {
  const t = framedTab(tab);
  return quoteId && t ? previewPath(quoteId, t) : null;
}

/** The frame's CSS width: full width on Desktop, 390 px on Phone. */
export function frameWidth(device: ReviewDevice): string {
  return device === "phone" ? `${PHONE_FRAME_WIDTH}px` : "100%";
}

/** The frame's React key — a Save (new pdf.savedAt) or a status change (new asOf) remounts it on the fresh saved quote. */
export function frameKey(tab: ReviewTab, savedAt: number | null | undefined, asOf: number | null | undefined): string {
  return `${tab}:${savedAt ?? 0}:${asOf ?? 0}`;
}

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

export type DatasheetCell = { kind: "link"; href: string; name: string } | { kind: "note"; text: string } | { kind: "missing"; text: string };

/** A Datasheets row's datasheet cell: its own document, "covered by …", "not needed", or Missing. */
export function datasheetCell(row: Pick<ReviewDatasheetRow, "datasheet" | "datasheetCoveredBy" | "datasheetOk">): DatasheetCell {
  if (row.datasheet) return { kind: "link", href: row.datasheet.href, name: row.datasheet.name };
  if (row.datasheetOk && row.datasheetCoveredBy.length) return { kind: "note", text: `covered by ${row.datasheetCoveredBy.join(", ")}` };
  if (row.datasheetOk) return { kind: "note", text: REVIEW_UI_COPY.notNeeded };
  return { kind: "missing", text: REVIEW_UI_COPY.datasheetMissing };
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

/** The tab strip's DOM ids (aria-controls / aria-labelledby). */
export const reviewTabId = (tab: ReviewTab) => `review-tab-${tab}`;
export const reviewPanelId = (tab: ReviewTab) => `review-panel-${tab}`;

/** Arrow-key navigation across the tabs: Left/Right wrap, Home/End jump; any other key → null. */
export function nextReviewTab(current: ReviewTab, key: string): ReviewTab | null {
  const i = REVIEW_TABS.indexOf(current);
  const n = REVIEW_TABS.length;
  if (key === "ArrowRight") return REVIEW_TABS[(i + 1) % n];
  if (key === "ArrowLeft") return REVIEW_TABS[(i - 1 + n) % n];
  if (key === "Home") return REVIEW_TABS[0];
  if (key === "End") return REVIEW_TABS[n - 1];
  return null;
}

/** "Resolve comment 2" / "Delete comment 2"; a resolved comment has no number → "Delete resolved comment". */
export function commentActionLabel(kind: "resolve" | "delete", n: number | null): string {
  const verb = kind === "resolve" ? "Resolve" : "Delete";
  return n == null ? `${verb} resolved comment` : `${verb} comment ${n}`;
}

/** #312 — one custom or curtain line on the review step's Specs card. */
export type SpecLineRow<I> = { system: string; item: I };

/**
 * #312 — every custom and curtain line, in system order then line order, with its system's name.
 * The Spec select moved here from the Build step; empty (no card) when there are none.
 */
export function specLineRows<I extends { custom?: boolean; curtain?: boolean }>(
  sections: ReadonlyArray<{ name: string; items: ReadonlyArray<I> }>,
): SpecLineRow<I>[] {
  const rows: SpecLineRow<I>[] = [];
  for (const sec of sections) {
    for (const item of sec.items) if (item.custom || item.curtain) rows.push({ system: sec.name || "System", item });
  }
  return rows;
}
