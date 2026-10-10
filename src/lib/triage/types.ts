/**
 * Morning triage (spec docs/superpowers/specs/2026-10-09-morning-triage-design.md)
 * — shared shapes. Pure and CLIENT-SAFE: no store, db or session imports, so
 * the "use client" row list can import SOURCE_LABEL as a value.
 */

export const TRIAGE_SOURCES = ["email", "call", "task", "assignment", "lead", "visit", "quote", "renewal"] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];

/** The chip on each row. */
export const SOURCE_LABEL: Record<TriageSource, string> = {
  email: "Email",
  call: "Call",
  task: "Task",
  assignment: "Assigned",
  lead: "Lead",
  visit: "Site visit",
  quote: "Quote",
  renewal: "Renewal",
};

/** The feed's name in "<Feed> couldn't be read" (tasks + assignments are one feed). */
export const FEED_LABEL: Record<TriageSource, string> = {
  email: "Email",
  call: "Calls",
  task: "Tasks",
  assignment: "Tasks",
  lead: "Leads",
  visit: "Site visits",
  quote: "Quotes",
  renewal: "Renewals",
};

export function feedErrorMessage(source: TriageSource): string {
  return `${FEED_LABEL[source]} couldn't be read — list may be incomplete`;
}

/** One reason a row is on the list. Points live in rank.ts. */
export type TriageFact =
  | { kind: "lead_sla_breached" }
  | { kind: "visit_today"; startAt: number }
  | { kind: "task_overdue"; days: number }
  | { kind: "customer_waiting"; businessDays: number }
  | { kind: "quote_awaiting_approval" }
  | { kind: "lead_sla_due_soon"; minutes: number }
  | { kind: "task_due_today" }
  | { kind: "call_todo" }
  | { kind: "portal_quote_review" }
  | { kind: "quote_sent_back" }
  | { kind: "renewal_past_due"; days: number }
  | { kind: "lead_next_action_overdue" }
  | { kind: "task_at_risk" }
  | { kind: "linked_open_deal"; label: string }
  | { kind: "call_names_me" }
  | { kind: "visit_flag"; label: string }
  | { kind: "task_tier"; tier: "high" | "low" }
  | { kind: "renewal_window"; days: number }
  | { kind: "task_due_tomorrow" }
  | { kind: "customer_message_new"; hours: number }
  | { kind: "lead_stale"; days: number };

/** The transcript line shown under a call to-do (`found: false` = "Source line not found — open the meeting"). */
export type CallLine =
  | { found: true; speaker: string; text: string; start: number; href: string }
  | { found: false; href: string };

export type TriageCandidate = {
  key: string;
  source: TriageSource;
  title: string;
  sub: string;
  href: string;
  /** epoch-ms the item became actionable — the "older first" tie-break; 0 = unknown (sorts after known ages). */
  since: number;
  facts: TriageFact[];
  callLine?: CallLine;
  /** Call to-dos only: "<meeting title> (<date>)" — used by the duplicate collapse. */
  mention?: string;
  /** "Also mentioned in …" lines folded in from collapsed call to-dos. */
  also?: string[];
};

export type RankedCandidate = TriageCandidate & { score: number; reason: string };

/** One frozen row of a snapshot — everything the list needs to render. */
export type SnapshotRow = {
  key: string;
  source: TriageSource;
  title: string;
  sub: string;
  href: string;
  score: number;
  reason: string;
  callLine: CallLine | null;
  also: string[];
};

export type Slot = "morning" | "midday";

export type FeedError = { source: TriageSource; message: string };

export type TriageSnapshot = {
  id: string; // `<userId>:<YYYY-MM-DD>:<slot>`
  userId: string;
  userName: string;
  day: string;
  slot: Slot;
  builtAt: number;
  builtBy: "cron" | "lazy" | "live";
  rows: SnapshotRow[];
  errors: FeedError[];
};

export type MarkKind = "done" | "snooze" | "dismiss";

export type TriageMark = {
  id: string; // `<userId>:<itemKey>`
  userId: string;
  key: string;
  kind: MarkKind;
  at: number;
  /** done: the snapshot it was marked in (hidden only there). */
  snapshotId: string | null;
  /** snooze: slotOrdinal it comes back at. */
  until: string | null;
};

/** Whose list — a team member NAME is the app's ownership convention. */
export type TriageUser = { id: string; name: string; canApprove: boolean };
