/**
 * Inbox organization (spec docs/superpowers/specs/2026-10-13-inbox-organization-design.md).
 * The three thread fields the pipeline writes (`filing`, `court`, `noise`) and
 * the saved sender rule. Pure types — no store imports, so client files may
 * import them.
 */

export type CourtOwner = "me" | "teammate" | "customer" | "nobody";

export type FilingSource = "rule" | "identity" | "number" | "noise-rule" | "ai";

/** `CommThread.filing` (spec §1 "Suggestion stored on the thread"). `work`
 *  is the same shape as a `CommLink`. */
export type Filing = {
  customerId: string | null;
  work: { type: "quote" | "lead" | "project" | "survey" | "inspection"; id: string; label?: string } | null;
  siteId?: string | null;
  noise: boolean;
  source: FilingSource;
  reason: string;
  strength: "strong" | "weak";
  needsReply: boolean;
  /** assist_runs id when source === "ai" */
  runId?: string;
  state: "suggested" | "filed" | "skipped" | "dismissed";
  at: number;
  filedBy?: "approved" | "reply" | "rule" | "teammate-reply";
  filedAt?: number;
  /** the AI step still has to look at this thread (resumes next sync) */
  pendingAi?: boolean;
  /** failed AI attempts on this basis; the pass gives up (clears
   *  `pendingAi`) at MAX_AI_ATTEMPTS. New mail starts over. */
  aiAttempts?: number;
  /** epoch-ms: an AI pass holds this thread until then (no second pass
   *  calls the model for it meanwhile) */
  aiLeaseUntil?: number;
  /** id of the thread's newest message when this filing was computed — "new
   *  mail since" is a different newest message (a late-imported message can
   *  carry an older Gmail date, so `at` alone can't tell). */
  basis?: string;
  /** What filing this thread changed (set when `state` becomes "filed"), so
   *  Undo puts back exactly that and nothing a person set by hand. */
  applied?: FilingApplied;
  /** archive-on-reply archived the thread without filing it (a weak or no
   *  suggestion) — it stays in To file while archived. Cleared when the
   *  thread is filed or un-archived. */
  archivedOnReply?: boolean;
};

/** The thread's link fields before a filing changed them. A part that is
 *  absent was left alone by the filing. */
export type FilingApplied = {
  /** the customer link (linkThread) — its previous identity fields */
  customer?: {
    customerId: string | null;
    customer: string;
    resolvedContactId: string | null;
    resolution: "linked" | "suggested" | "ambiguous" | "unknown" | null;
    suggestedCustomerId: string | null;
    candidates: Array<{ customerId: string; name: string }>;
    siteId: string | null;
  };
  /** the work link (setLink) — the link it replaced */
  link?: { prev: { type: string; id: string; label?: string } | null };
  /** the venue (setThreadSite) — the venue it replaced */
  site?: { prev: string | null };
  /** filing archived the thread */
  archived?: boolean;
  /** the suggestion was an archived-on-reply To file row (Undo puts that back) */
  archivedOnReply?: boolean;
};

/** How a person (or a reply) acted on a filing suggestion — the filing log's
 *  `action`, so the pilot report can compare sources. */
export type FilingAction =
  | "approved"
  | "changed"
  | "noise"
  | "rescued"
  | "skipped"
  | "undone"
  | "reply"
  | "teammate-reply"
  | "rule"
  | "court-override";

/** A promise read from a message (spec §7). `due` is epoch-ms (5 pm Chicago). */
export type Promise_ = { text: string; ownerUserId: string; due: number | null; taskId?: string; messageId: string };

/** `CommThread.court` (spec §3). */
export type Court = {
  owner: CourtOwner;
  teammateId?: string;
  reason: string;
  source: "rule" | "ai" | "override";
  at: number;
  promise?: Promise_;
  pendingAi?: boolean;
  /** see `Filing.aiAttempts` */
  aiAttempts?: number;
  /** see `Filing.aiLeaseUntil` */
  aiLeaseUntil?: number;
  /** the message id whose promises were already turned into tasks —
   *  written BEFORE the tasks are created, so a re-run (or a second pass)
   *  never makes them twice */
  promisesFor?: string;
  /** id of the thread's newest message when this court was set (see
   *  `Filing.basis`). An override / AI court sticks until it changes. */
  basis?: string;
};

/** `CommThread.noise`. `moved` = held out of the inbox (pilot users only);
 *  everyone else just sees the "Looks like noise" tag. */
export type NoiseFlag = { flagged: boolean; reason: string; moved: boolean; rescued?: boolean };

/** One saved rule in the `inbox_sender_rules` blob (spec §5). */
export type SenderRule = {
  id: string;
  scope: "user" | "company";
  userId?: string;
  match: { email?: string; domain?: string };
  action: { type: "file"; customerId: string; work?: Filing["work"] } | { type: "noise" } | { type: "never-noise" };
  createdBy: string;
  createdAt: number;
};
