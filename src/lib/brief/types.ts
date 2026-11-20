/**
 * Stored shapes left behind by the AI daily brief (removed with Morning
 * triage). `CommThread.preDraft` and `Quote.assistNudge` may still sit on
 * stored documents; nothing writes or reads them any more.
 */
/** `CommThread.preDraft` (§2) — a pre-made reply + task suggestions. Fresh while
 *  `basis` is the thread's newest inbound message id. */
export type PreDraft = {
  /** "" = no reply drafted (reply off, or it failed — see `replyError`). */
  body: string;
  runId: string | null;
  /** null = no suggestions made (tasks off, or it failed — see `tasksError`). */
  taskSuggestions: unknown[] | null;
  taskRunId: string | null;
  basis: string;
  at: number;
  /** The user id the draft was made for. A thread reassigned since reads as
   *  stale: the new owner never sees (or reuses) it, and the queue redrafts. */
  ownerId: string;
  /** The model ran but gave nothing usable; the queue retries after DRAFT_RETRY_MS. */
  replyError?: string;
  tasksError?: string;
};

/** `Quote.assistNudge` (§2) — a follow-up note + nudge email for a quiet quote.
 *  Fresh while `basis` is the quote's current sent time. */
export type AssistNudge = {
  note: string;
  emailSubject: string;
  emailBody: string;
  runId: string | null;
  basis: number;
  at: number;
  /** The user id the nudge was made for. A quote handed to someone else since
   *  reads as stale: the new owner never gets it, and the queue redrafts. */
  ownerId: string;
  /** The model ran but gave nothing usable (note/subject/body are ""); the queue retries after DRAFT_RETRY_MS. */
  error?: string;
};
