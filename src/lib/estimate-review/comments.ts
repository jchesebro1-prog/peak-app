import { can } from "@/lib/team";

/**
 * Estimator Phase 4 (spec §11.3) — review comments pinned to systems. PURE
 * rules shared by the store, the server actions and the Customer review step.
 * The data lives on `Quote.reviewComments` (store-owned, see quotes.ts).
 */

export type ReviewComment = {
  id: string;
  /** The system (SpecSection.id) it is pinned to; null = the whole estimate. */
  sectionId: string | null;
  body: string;
  /** The author's display name (same convention as Quote.owner / history). */
  by: string;
  at: number;
  resolvedAt?: number;
  resolvedBy?: string;
};

export const REVIEW_COMMENTS_MAX = 200;
export const COMMENT_BODY_MAX = 2000;
export const WHOLE_ESTIMATE = "Whole estimate";

/** Refusal copy for the review-comment actions. */
export const REVIEW_COMMENT_COPY = {
  gone: "That estimate no longer exists.",
  needsPerm: "You don't have permission to do that.",
  empty: "Write a comment first (up to 2,000 characters).",
  noSystem: "That system is no longer on the estimate — save the estimate and try again.",
  full: "This estimate has 200 open comments — resolve some before adding more.",
  missing: "That comment is already gone.",
  cantDelete: "Only the author or an approver can delete a comment.",
} as const;

/** Trim; null when not a string, empty, or longer than COMMENT_BODY_MAX. */
export function sanitizeComment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return body.length >= 1 && body.length <= COMMENT_BODY_MAX ? body : null;
}

export type NumberedComment = {
  /** 1…n among the OPEN comments. */
  n: number;
  comment: ReviewComment;
  /** The system's name, or "Whole estimate". */
  system: string;
};

/**
 * Open comments only, numbered 1…n: whole-estimate comments first, then by
 * system order (the `sections` array order), each group by `at` (id breaks a
 * tie). A comment whose system no longer exists reads as a whole-estimate one.
 */
export function numberComments(
  comments: ReadonlyArray<ReviewComment> | null | undefined,
  sections: ReadonlyArray<{ id: string; name?: string }>
): NumberedComment[] {
  const order = new Map<string, number>();
  const names = new Map<string, string>();
  (sections || []).forEach((s, i) => {
    order.set(s.id, i);
    names.set(s.id, (s.name || "").trim() || "Untitled system");
  });
  const rank = (c: ReviewComment) => (c.sectionId !== null && order.has(c.sectionId) ? order.get(c.sectionId)! : -1);
  return (comments || [])
    .filter((c) => !!c && c.resolvedAt == null)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((comment, i) => ({
      n: i + 1,
      comment,
      system: comment.sectionId !== null && names.has(comment.sectionId) ? names.get(comment.sectionId)! : WHOLE_ESTIMATE,
    }));
}

/**
 * Group the numbered OPEN comments for the Build pins: `whole` = whole-estimate
 * comments (and any whose system is gone), `bySection` = per existing system id.
 * Keeps the numbering order inside each group.
 */
export function commentsBySection(
  numbered: ReadonlyArray<NumberedComment>,
  sectionIds: ReadonlyArray<string>
): { whole: NumberedComment[]; bySection: Record<string, NumberedComment[]> } {
  const known = new Set(sectionIds);
  const whole: NumberedComment[] = [];
  const bySection: Record<string, NumberedComment[]> = {};
  for (const r of numbered || []) {
    const id = r.comment.sectionId;
    if (id !== null && known.has(id)) (bySection[id] ||= []).push(r);
    else whole.push(r);
  }
  return { whole, bySection };
}

/**
 * The approver's send-back note:
 *   `<n> comment(s) to address:` then `N. <System | Whole estimate> — <body>`
 *   per open comment, then a blank line and the approver's own text. With no
 *   open comments it is just the approver's text.
 */
export function sendBackNote(
  comments: ReadonlyArray<ReviewComment> | null | undefined,
  sections: ReadonlyArray<{ id: string; name?: string }>,
  extra: string
): string {
  const rows = numberComments(comments, sections);
  const typed = (extra || "").trim();
  if (rows.length === 0) return typed;
  const head = `${rows.length} comment${rows.length === 1 ? "" : "s"} to address:`;
  const lines = rows.map((r) => `${r.n}. ${r.system} — ${r.comment.body.replace(/\s*\n\s*/g, " ").trim()}`);
  return [head, ...lines].join("\n") + (typed ? `\n\n${typed}` : "");
}

/** Anyone who can create, send or approve may comment. */
export function canAddComment(roles: string[] | null | undefined): boolean {
  return can("create", roles) || can("send", roles) || can("approve", roles);
}

/** The estimator (anyone with `create`) resolves an open comment. */
export function canResolve(roles: string[] | null | undefined, comment: Pick<ReviewComment, "resolvedAt">): boolean {
  return comment.resolvedAt == null && can("create", roles);
}

const sameName = (a: string, b: string) => !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The author may delete their own UNRESOLVED comment; an approver may delete any. */
export function canDelete(
  roles: string[] | null | undefined,
  comment: Pick<ReviewComment, "by" | "resolvedAt">,
  me: string
): boolean {
  if (can("approve", roles)) return true;
  return comment.resolvedAt == null && sameName(comment.by, me);
}
