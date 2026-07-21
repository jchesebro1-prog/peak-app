/**
 * Operations work normalization (D100) — dependency-free.
 *
 * Imported by the server assembler (operations-work-server.ts) and by the spec
 * test. It imports store record types with `import type` ONLY (erased at build)
 * and imports NO store value and nothing from @/db, so it stays out of the
 * client/PGlite blast radius (same contract as queue-types.ts).
 *
 * The strict `msOf` below is ported verbatim from flame-jobs/repair-jobs. Do
 * NOT use inspections' parseISO/msOf — its non-ISO fallback (`new Date(s)`) is
 * UTC-prone and shifts dates a day west of UTC.
 */
import type { FlameJob } from "@/lib/stores/flame-jobs";
import type { InspectionRecord } from "@/lib/stores/inspections";
import type { RepairJobRecord } from "@/lib/stores/repair-jobs";

export type WorkType = "project" | "flame" | "inspection" | "repair";

export const WORK_TYPE_META: Record<WorkType, { label: string; color: string; soft: string }> = {
  project: { label: "Project", color: "#5b4b8a", soft: "#efecf6" },
  flame: { label: "Flame test", color: "#b4543a", soft: "#f7ece8" },
  inspection: { label: "Inspection", color: "#3155a8", soft: "#e9eefb" },
  repair: { label: "Repair", color: "#1f6a8a", soft: "#e6f0f4" },
};

/** 'YYYY-MM-DD' -> epoch ms at LOCAL midnight; '' / null / malformed -> null. */
export function msOf(iso: string | null | undefined): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}

/** Truncate an epoch-ms to local midnight. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A single scheduled unit of work, normalized across all four sources. */
export type WorkItem = {
  id: string;
  type: WorkType;
  title: string; // customer / project name
  subtitle: string; // venue (service) or customer (project)
  assignee: string; // team-member NAME, or "" for unassigned
  startMs: number; // scheduled day at local midnight
  endMs: number; // inclusive end; single-day service item: === startMs
  href: string;
  stage: string;
};

/** The minimal shape shared by FlameJob, InspectionRecord, RepairJobRecord. */
type ServiceLike = {
  id: string;
  customer: string;
  venue: string;
  assignedTo: string;
  scheduledDate: string;
  stage: string;
};

/**
 * Normalize a service store's records into single-day WorkItems.
 * Keeps only live (`stage !== "completed"`) jobs with a parseable scheduledDate;
 * an unset date ('') is excluded (never epoch 0). Unassigned jobs (assignedTo '')
 * are KEPT — they belong in the unassigned lane. One item per record, keyed by
 * `assignedTo` (repairs' `crew` is intentionally NOT fanned out — see D100).
 */
export function serviceToWorkItems<T extends ServiceLike>(
  recs: readonly T[],
  type: WorkType,
  hrefFor: (id: string) => string,
): WorkItem[] {
  const out: WorkItem[] = [];
  for (const r of recs) {
    if (r.stage === "completed") continue;
    const startMs = msOf(r.scheduledDate);
    if (startMs == null) continue;
    out.push({
      id: r.id,
      type,
      title: r.customer,
      subtitle: r.venue,
      assignee: r.assignedTo,
      startMs,
      endMs: startMs, // single day, inclusive
      href: hrefFor(r.id),
      stage: r.stage,
    });
  }
  return out;
}

// Type-only re-exports so callers can name the source records without importing
// the store values. (FlameJob/InspectionRecord/RepairJobRecord all satisfy
// ServiceLike structurally, so serviceToWorkItems accepts each directly.)
export type { FlameJob, InspectionRecord, RepairJobRecord };
