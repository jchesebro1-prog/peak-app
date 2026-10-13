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
};

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
