/* Assessment reminders (Jeff 2026-10-15 #10) — the sweep. Reads every finding, venue profile and assessment (only the
   fields it needs), plans the reminders (src/lib/assessments/reminders.ts, pure) and creates each task at most once
   under its deterministic `T-asr-…` id (createTaskOnce → insertDocIfAbsent: a reminder someone deleted stays
   deleted). It also closes open reminders whose record's date moved or was cleared (#353 review M3 — the catch-all
   behind the save-path hook in reminder-close.ts). Runs from the daily drive cron (/api/drive/sync) inside a time
   budget, and lazily from the Assessments page at most once per process per 6 hours (never on a preview deploy). */
import { listFindings } from "@/lib/stores/findings";
import { listVenueProfiles } from "@/lib/stores/venue-profiles";
import { createTaskOnce } from "@/lib/stores/tasks";
import { getDocRows, listDocsFiltered } from "@/db/doc-store";
import { getCompanies } from "@/lib/identity/companies";
import { getAllSites, docLocId } from "@/lib/identity/sites";
import { activeUsers } from "@/lib/users";
import { planReminders, type ReminderAssessment } from "./reminders";
import { closeStaleReminderTasks, openReminderTaskIds } from "./reminder-close";

export const REMINDER_ACTOR = { id: "system", name: "Assessment reminders" } as const;

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });

export type SweepResult = { planned: number; created: number; existing: number; closed: number; stopped: boolean };

/** `p`, or null once `deadlineMs` passes first (the read keeps running; its result is dropped). */
async function beforeDeadline<T>(p: Promise<T>, deadlineMs: number | undefined): Promise<T | null> {
  if (!deadlineMs) return p;
  const left = deadlineMs - Date.now();
  if (left <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), left); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runAssessmentReminders(opts: { now?: number; deadlineMs?: number } = {}): Promise<SweepResult> {
  const now = opts.now ?? Date.now();
  const stopped = (planned = 0, created = 0, existing = 0, closed = 0): SweepResult => ({ planned, created, existing, closed, stopped: true });
  // #353 review M5: the reads run under the deadline too, and assessments come back as three fields, not whole docs.
  const reads = await beforeDeadline(
    Promise.all([
      listFindings({ includeVoided: true }),
      listVenueProfiles(),
      listDocsFiltered<{ id: string; siteId?: string; createdBy?: string; visitDate?: number }>("assessments", { fields: ["siteId", "createdBy", "visitDate"] }),
      activeUsers(),
      getAllSites(),
      openReminderTaskIds(),
    ]),
    opts.deadlineMs,
  );
  if (!reads) return stopped();
  const [findings, venues, assessmentRows, users, sites, openIds] = reads;
  const assessments: ReminderAssessment[] = assessmentRows.map((a) => ({ id: a.id, siteId: a.siteId || "", createdBy: a.createdBy || "", visitDate: Number(a.visitDate) || 0 }));
  const customerIds = [...new Set([...findings.map((f) => f.customerId), ...venues.map((v) => v.customerId)].filter(Boolean))];
  const companies = await beforeDeadline(getCompanies(customerIds), opts.deadlineMs);
  if (!companies) return stopped();
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const plans = planReminders({
    findings,
    venues,
    assessments,
    owners: new Map([...companies].map(([id, c]) => [id, c.ownerUserId ?? null])),
    activeUserIds: new Set(users.map((u) => u.id)),
    siteNames: new Map(sites.map((s) => [s.id, s.name || s.locationName || s.id])),
    // #353 review M8: no reminder for a finding (or venue) whose venue was deleted.
    liveSiteIds: new Set(sites.map((s) => s.id)),
    dayLabel,
    now,
  });

  // #353 review M3 (catch-all): close open reminders whose record's date moved, was cleared or was voided.
  let closed = 0;
  if (openIds.length) {
    const dueOf = new Map<string, number | null>();
    for (const f of findings) dueOf.set(`f:${f.key}`, f.voided ? null : f.nextDue ?? null);
    for (const v of venues) dueOf.set(`v:${v.siteId}`, v.nextAssessmentAt ?? null);
    for (const [k, due] of dueOf) {
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) return stopped(plans.length, 0, 0, closed);
      const [kind, ref] = [k[0] === "f" ? ("finding" as const) : ("venue" as const), k.slice(2)];
      closed += (await closeStaleReminderTasks(kind, ref, due, openIds)).length;
    }
  }

  // One batched read for every planned id (live or deleted: a deleted reminder is never re-created).
  const known = await beforeDeadline(getDocRows("tasks", plans.map((p) => p.id)), opts.deadlineMs);
  if (!known) return stopped(plans.length, 0, 0, closed);
  const exists = new Set(known.map((r) => r.id));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  let created = 0;
  let existing = 0;
  for (const p of plans) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) return stopped(plans.length, created, existing, closed);
    if (exists.has(p.id)) { existing++; continue; }
    const site = siteById.get(p.siteId);
    await createTaskOnce(
      {
        id: p.id,
        title: p.title,
        section: "",
        notes: p.notes,
        dueAt: p.dueAt,
        assigneeUserId: p.assigneeUserId,
        assigneeName: p.assigneeUserId ? nameOf.get(p.assigneeUserId) ?? "" : "",
        customerId: p.customerId || null,
        // a task's siteId is the venue as doc records store it (CustomerLocation.id)
        siteId: site ? docLocId(site) : null,
      },
      REMINDER_ACTOR,
    );
    created++;
  }
  return { planned: plans.length, created, existing, closed, stopped: false };
}

const LAZY_EVERY_MS = 6 * 3_600_000;
let lastLazy = 0;

/** The lazy trigger (the Assessments page's `after()`): at most once per process per 6 hours, never throws. */
export async function maybeRunAssessmentReminders(): Promise<void> {
  const t = Date.now();
  if (t - lastLazy < LAZY_EVERY_MS) return;
  lastLazy = t;
  try {
    await runAssessmentReminders({ deadlineMs: t + 10_000 });
  } catch (err) {
    console.error("[assessment-reminders] lazy run failed", err);
  }
}
