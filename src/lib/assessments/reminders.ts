/* Assessment reminders (Jeff 2026-10-15 #10) — pure. 30 days before a due date, a task goes to the venue's account
   rep: one per finding with a next-due date (the brief: "a finding is verified → close it, and set the next-due date
   on the related log"; any status, so a still-open finding with a date counts too) and one per venue with a next
   assessment date (venue_profiles.nextAssessmentAt). The rep is the company's owner (`companies.owner_user_id`, the
   Companies directory's Owner) when that user is active; else the creator of the assessment behind it (for a venue,
   its most recent assessment). Task ids are deterministic (`T-asr-…`, keyed by the record and the due day), so the
   daily sweep is idempotent: a reminder is created once, a deleted one never comes back, and a moved date gets its
   own reminder. No db / next imports. */

export const REMINDER_LEAD_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ReminderFinding {
  key: string;
  printedId: string | null;
  customerId: string;
  siteId: string;
  assessmentId: string;
  category: string;
  description: string;
  nextDue?: number;
  voided?: unknown;
}
export interface ReminderVenue { siteId: string; customerId: string; nextAssessmentAt?: number | null }
export interface ReminderAssessment { id: string; siteId: string; createdBy: string; visitDate: number }

export interface ReminderPlan {
  id: string;
  kind: "finding" | "venue";
  /** the finding key or the venue's site id */
  ref: string;
  title: string;
  notes: string;
  dueAt: number;
  customerId: string;
  siteId: string;
  assigneeUserId: string | null;
}

/** `20261114` — the due day (UTC) in a reminder id. */
function dayStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Only id-safe characters (doc ids are free text, but keep the task id predictable). */
const safe = (s: string) => s.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120);

export function reminderTaskId(kind: "finding" | "venue", ref: string, dueAt: number): string {
  return `T-asr-${kind === "finding" ? "f" : "v"}-${safe(ref)}-${dayStamp(dueAt)}`;
}

/** Due in the next 30 days (inclusive), and not yet past. A date already past gets no reminder. */
export function inReminderWindow(dueAt: number | null | undefined, now: number): dueAt is number {
  return typeof dueAt === "number" && Number.isFinite(dueAt) && dueAt > 0 && now <= dueAt && dueAt - now <= REMINDER_LEAD_DAYS * DAY_MS;
}

export interface PlanInput {
  findings: readonly ReminderFinding[];
  venues: readonly ReminderVenue[];
  assessments: readonly ReminderAssessment[];
  /** company id → its owner's user id (only ACTIVE owners — the caller drops the rest) */
  owners: ReadonlyMap<string, string | null>;
  /** active user ids — a creator who has left gets no reminder (the task goes unassigned) */
  activeUserIds: ReadonlySet<string>;
  siteNames: ReadonlyMap<string, string>;
  dayLabel: (ms: number) => string;
  now: number;
}

export function planReminders(p: PlanInput): ReminderPlan[] {
  const byId = new Map(p.assessments.map((a) => [a.id, a]));
  const latestBySite = new Map<string, ReminderAssessment>();
  for (const a of p.assessments) {
    const cur = latestBySite.get(a.siteId);
    if (!cur || a.visitDate > cur.visitDate) latestBySite.set(a.siteId, a);
  }
  const active = (u: string | null | undefined) => (u && p.activeUserIds.has(u) ? u : null);
  const rep = (customerId: string, fallback: string | null | undefined) => active(p.owners.get(customerId)) ?? active(fallback);
  const venueName = (siteId: string) => p.siteNames.get(siteId) || "the venue";
  const out: ReminderPlan[] = [];
  for (const f of p.findings) {
    if (f.voided || !inReminderWindow(f.nextDue, p.now)) continue;
    const label = f.printedId || f.key;
    out.push({
      id: reminderTaskId("finding", f.key, f.nextDue),
      kind: "finding",
      ref: f.key,
      title: `Due ${p.dayLabel(f.nextDue)}: ${label} at ${venueName(f.siteId)}`,
      notes: `Assessment reminder, 30 days ahead. Finding ${label} (${f.category}): ${f.description}`.slice(0, 2000),
      dueAt: f.nextDue,
      customerId: f.customerId,
      siteId: f.siteId,
      assigneeUserId: rep(f.customerId, byId.get(f.assessmentId)?.createdBy),
    });
  }
  for (const v of p.venues) {
    if (!inReminderWindow(v.nextAssessmentAt, p.now)) continue;
    out.push({
      id: reminderTaskId("venue", v.siteId, v.nextAssessmentAt),
      kind: "venue",
      ref: v.siteId,
      title: `Assessment due ${p.dayLabel(v.nextAssessmentAt)}: ${venueName(v.siteId)}`,
      notes: "Assessment reminder, 30 days ahead: schedule the venue's next assessment.",
      dueAt: v.nextAssessmentAt,
      customerId: v.customerId,
      siteId: v.siteId,
      assigneeUserId: rep(v.customerId, latestBySite.get(v.siteId)?.createdBy),
    });
  }
  return out;
}
