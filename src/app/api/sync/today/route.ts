import { NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/session";
import { mayPullFieldData } from "@/lib/sync/pull-collections";
import { todaysJobs, pagesToCache } from "@/lib/sync/today-jobs";
import { chicagoDayKey, chicagoDayStart, addDays } from "@/lib/drive-plan/day";
import { allVisits } from "@/lib/stores/site-visits";
import { getAll as allSurveys } from "@/lib/stores/surveys";
import { getAll as allInspections } from "@/lib/stores/inspections";
import { getAll as allFlame } from "@/lib/stores/flame-jobs";
import { getAll as allRepairs } from "@/lib/stores/repair-jobs";
import { listAssessments } from "@/lib/stores/assessments";
import { getAllProjects } from "@/lib/stores/projects";
import { loadPipelines } from "@/lib/pipelines-server";
import { isDone } from "@/lib/pipelines";

/**
 * Batch 6 / #65 — GET /api/sync/today: the signed-in tech's jobs for today
 * (lib/sync/today-jobs.ts) and the pages to keep for offline. The device then
 * pulls the records into its mirror (the ordinary /api/sync/pull) and asks
 * the service worker to keep each page.
 *
 * Same gate as the pull (Jeff 2026-10-15 #39 / #351): only `create` holders.
 * It names only the caller's own jobs (ids, titles, links) — no record body.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getOptionalUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!mayPullFieldData(me.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const now = Date.now();
  const key = chicagoDayKey(now);
  const start = chicagoDayStart(key);
  const end = chicagoDayStart(addDays(key, 1)) - 1;
  const [visits, surveys, inspections, flame, repairs, assessments, projects, pipes] = await Promise.all([
    allVisits(), allSurveys(), allInspections(), allFlame(), allRepairs(), listAssessments(), getAllProjects(), loadPipelines(),
  ]);
  const done = new Set(projects.filter((p) => isDone(p, pipes)).map((p) => p.id));
  const jobs = todaysJobs(
    { visits, surveys, inspections, flame, repairs, assessments, projects },
    { id: me.id, name: me.name },
    { key, start, end },
    chicagoDayKey,
    (id) => done.has(id),
  );
  return NextResponse.json({ day: key, jobs, pages: pagesToCache(jobs) }, { headers: { "cache-control": "no-store" } });
}
