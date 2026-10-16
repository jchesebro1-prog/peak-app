/**
 * Batch 6 / #65 (Jeff 2026-10-15) — "Download today's jobs": the signed-in
 * tech's work for today (America/Chicago), so the device can pull it into
 * the offline mirror and the service worker can keep each job's page.
 *
 * Pure — the route hands in the records (type-only imports here, so this
 * stays out of the client/PGlite blast radius).
 *
 * Mine today:
 *  - site visit: I lead it (`assignedTo`) or attend it and it starts today,
 *    whatever its stage. A visit has no page of its own: its survey editor when it has
 *    one, else the company record (recordings/data.ts uses the same rule);
 *  - venue assessment (survey), inspection, flame test, repair: assigned to
 *    me (a repair's crew counts), scheduled today, not completed;
 *  - assessment (#340): I'm the assessor, its visit date is today, not
 *    completed;
 *  - install project: a crew booking of mine covers today and it isn't done.
 * Names are the app convention for `assignedTo` / crew (team-member NAME); an
 * assessment's assessor is a user id.
 */
import type { SurveyRecord } from "@/lib/stores/surveys";
import type { InspectionRecord } from "@/lib/stores/inspections";
import type { FlameJob } from "@/lib/stores/flame-jobs";
import type { RepairJobRecord } from "@/lib/stores/repair-jobs";
import type { SiteVisit } from "@/lib/stores/site-visits";
import type { Assessment } from "@/lib/stores/assessments";
import type { ProjectRecord } from "@/lib/stores/projects";

export type TodayJobKind = "site_visit" | "survey" | "inspection" | "flame_job" | "repair_job" | "assessment" | "project";

export type TodayJob = {
  kind: TodayJobKind;
  id: string;
  title: string;
  href: string;
  /** The offline field collection the record mirrors from, or null (a site visit is not mirrored — its page is). */
  collection: "surveys" | "inspections" | "flame_jobs" | "repair_jobs" | "assessments" | "projects" | null;
};

export const TODAY_KIND_LABEL: Record<TodayJobKind, string> = {
  site_visit: "Site visit",
  survey: "Venue assessment",
  inspection: "Inspection",
  flame_job: "Flame test",
  repair_job: "Repair",
  assessment: "Assessment",
  project: "Install",
};

export type TodayInput = {
  visits?: readonly Pick<SiteVisit, "id" | "startAt" | "assignedTo" | "attendees" | "stage" | "surveyId" | "customerId" | "customer" | "venue">[];
  surveys?: readonly Pick<SurveyRecord, "id" | "stage" | "assignedTo" | "scheduledDate" | "customer" | "venue">[];
  inspections?: readonly Pick<InspectionRecord, "id" | "stage" | "assignedTo" | "scheduledDate" | "customer" | "venue">[];
  flame?: readonly Pick<FlameJob, "id" | "stage" | "assignedTo" | "scheduledDate" | "customer" | "venue">[];
  repairs?: readonly Pick<RepairJobRecord, "id" | "stage" | "assignedTo" | "crew" | "scheduledDate" | "customer" | "venue">[];
  assessments?: readonly Pick<Assessment, "id" | "status" | "assessorId" | "visitDate">[];
  projects?: readonly Pick<ProjectRecord, "id" | "kind" | "name" | "customer" | "crew">[];
};

/** "YYYY-MM-DD" from an ISO date string ('' / malformed → ""). */
export function isoDay(s: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

const same = (a: string | null | undefined, b: string) => !!b && String(a || "").trim().toLowerCase() === b.trim().toLowerCase();
const titleOf = (customer: string | null | undefined, venue: string | null | undefined) =>
  [String(customer || "").trim(), String(venue || "").trim()].filter(Boolean).join(" — ") || "Untitled";
const enc = encodeURIComponent;

/**
 * Today's jobs for `me`. `dayKeyOf` maps epoch-ms to a Chicago "YYYY-MM-DD";
 * `projectDone` says whether an install is finished (pipelines); a project
 * booking covers today when its span [start, end] meets [dayStart, dayEnd].
 */
export function todaysJobs(
  input: TodayInput,
  me: { id: string; name: string },
  today: { key: string; start: number; end: number },
  dayKeyOf: (ms: number) => string,
  projectDone: (id: string) => boolean = () => false,
): TodayJob[] {
  const out: TodayJob[] = [];
  const seen = new Set<string>();
  const push = (j: TodayJob) => {
    const k = `${j.kind}:${j.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(j);
  };
  for (const v of input.visits || []) {
    if (typeof v.startAt !== "number" || dayKeyOf(v.startAt) !== today.key) continue;
    if (!same(v.assignedTo, me.name) && !(v.attendees || []).some((a) => same(a, me.name))) continue;
    const href = v.surveyId ? `/venue-assessments/${enc(v.surveyId)}` : v.customerId ? `/companies/${enc(v.customerId)}` : "/venue-assessments";
    push({ kind: "site_visit", id: v.id, title: titleOf(v.customer, v.venue), href, collection: null });
  }
  const service = <T extends { id: string; stage: string; assignedTo: string; scheduledDate: string; customer: string; venue: string; crew?: string[] }>(
    rows: readonly T[] | undefined, kind: TodayJobKind, collection: TodayJob["collection"], href: (id: string) => string,
  ) => {
    for (const r of rows || []) {
      if (r.stage === "completed" || isoDay(r.scheduledDate) !== today.key) continue;
      if (!same(r.assignedTo, me.name) && !(r.crew || []).some((c) => same(c, me.name))) continue;
      push({ kind, id: r.id, title: titleOf(r.customer, r.venue), href: href(r.id), collection });
    }
  };
  service(input.surveys, "survey", "surveys", (id) => `/venue-assessments/${enc(id)}`);
  service(input.inspections, "inspection", "inspections", (id) => `/inspections/${enc(id)}`);
  service(input.flame, "flame_job", "flame_jobs", (id) => `/flame-tests/results?job=${enc(id)}`);
  service(input.repairs, "repair_job", "repair_jobs", (id) => `/repairs/results?job=${enc(id)}`);
  for (const a of input.assessments || []) {
    if (a.status === "completed" || !me.id || a.assessorId !== me.id) continue;
    if (typeof a.visitDate !== "number" || dayKeyOf(a.visitDate) !== today.key) continue;
    push({ kind: "assessment", id: a.id, title: a.id, href: `/assessments/${enc(a.id)}`, collection: "assessments" });
  }
  for (const p of input.projects || []) {
    if (p.kind !== "project" || projectDone(p.id)) continue;
    const mine = (p.crew || []).some((c) => same(c.person, me.name) && c.start <= today.end && c.end >= today.start);
    if (!mine) continue;
    push({ kind: "project", id: p.id, title: titleOf(p.name, p.customer), href: `/field-work?id=${enc(p.id)}`, collection: "projects" });
  }
  return out;
}

/** The pages to keep for offline: the Field Work day list first, then each job's page once. */
export function pagesToCache(jobs: readonly TodayJob[]): string[] {
  return [...new Set(["/field-work", ...jobs.map((j) => j.href)])];
}

/** "Ready offline: N jobs" — the result line. */
export function readyLine(ready: number, total: number): string {
  if (total === 0) return "No jobs for you today.";
  const base = `Ready offline: ${ready} job${ready === 1 ? "" : "s"}`;
  return ready === total ? base : `${base} (${total - ready} couldn’t be saved — try again with a connection)`;
}

/** How many jobs are ready offline: the job's page is kept and, for a mirrored record, the record is on the device
 *  (`mirrored` holds "<collection>:<id>"). */
export function readyCount(jobs: readonly TodayJob[], cachedPages: ReadonlySet<string>, mirrored: ReadonlySet<string>): number {
  return jobs.filter((j) => cachedPages.has(j.href) && (!j.collection || mirrored.has(`${j.collection}:${j.id}`))).length;
}
