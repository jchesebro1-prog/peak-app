/* Assessment reminders (Jeff 2026-10-15 #10) — the sweep. Reads every live finding, venue profile and assessment,
   plans the reminders (src/lib/assessments/reminders.ts, pure) and creates each task at most once under its
   deterministic `T-asr-…` id (createTaskOnce → insertDocIfAbsent: a reminder someone deleted stays deleted). Runs
   from the daily drive cron (/api/drive/sync) inside a time budget, and lazily from the Assessments page at most
   once per process per 6 hours. */
import { listFindings } from "@/lib/stores/findings";
import { listAssessments } from "@/lib/stores/assessments";
import { listVenueProfiles } from "@/lib/stores/venue-profiles";
import { createTaskOnce } from "@/lib/stores/tasks";
import { getDocRows } from "@/db/doc-store";
import { getCompanies } from "@/lib/identity/companies";
import { getAllSites, docLocId } from "@/lib/identity/sites";
import { activeUsers } from "@/lib/users";
import { planReminders } from "./reminders";

export const REMINDER_ACTOR = { id: "system", name: "Assessment reminders" } as const;

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });

export async function runAssessmentReminders(opts: { now?: number; deadlineMs?: number } = {}): Promise<{ planned: number; created: number; existing: number; stopped: boolean }> {
  const now = opts.now ?? Date.now();
  const [findings, venues, assessments, users, sites] = await Promise.all([
    listFindings(),
    listVenueProfiles(),
    listAssessments(),
    activeUsers(),
    getAllSites(),
  ]);
  const customerIds = [...new Set([...findings.map((f) => f.customerId), ...venues.map((v) => v.customerId)].filter(Boolean))];
  const companies = await getCompanies(customerIds);
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const plans = planReminders({
    findings,
    venues,
    assessments,
    owners: new Map([...companies].map(([id, c]) => [id, c.ownerUserId ?? null])),
    activeUserIds: new Set(users.map((u) => u.id)),
    siteNames: new Map(sites.map((s) => [s.id, s.name || s.locationName || s.id])),
    dayLabel,
    now,
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  let created = 0;
  let existing = 0;
  for (const p of plans) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) return { planned: plans.length, created, existing, stopped: true };
    // Live or deleted: a reminder someone deleted is never re-created.
    if ((await getDocRows("tasks", [p.id])).length) { existing++; continue; }
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
  return { planned: plans.length, created, existing, stopped: false };
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
