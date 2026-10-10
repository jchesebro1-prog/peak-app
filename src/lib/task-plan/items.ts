/** What is scheduled (spec Part 1): every open task and Queue assignment with
 *  an assignee, checklist and template tasks included — not a "Waiting on
 *  customer" task (#323, D800). Pure, client-safe. An undated item carries
 *  `dueVirtual` (dueMs 0); planPerson gives it the rolling today + 7 (D801). */
import { taskHref } from "@/lib/calendar-tasks";
import type { Assignment } from "@/lib/stores/assignments";
import type { TaskRecord } from "@/lib/stores/tasks";
import { isPlannedTask, personForAssignment, personForTask, type RosterPerson } from "./people";
import { cleanSize, cleanTier, DEFAULT_SIZE, DEFAULT_TIER, planItemKey, SIZE_MIN, type PlanItem } from "./types";

/** The stored due, or 0 + virtual (the planner dates it from its own clock). */
function storedDue(v: number | null | undefined): { dueMs: number; virtual: boolean } {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? { dueMs: v, virtual: false } : { dueMs: 0, virtual: true };
}

export function planItemsByPerson(
  tasks: readonly TaskRecord[],
  assignments: readonly Assignment[],
  roster: readonly RosterPerson[]
): Map<string, PlanItem[]> {
  const out = new Map<string, PlanItem[]>();
  const push = (uid: string, it: PlanItem) => {
    const list = out.get(uid);
    if (list) list.push(it);
    else out.set(uid, [it]);
  };
  for (const t of tasks) {
    if (!isPlannedTask(t)) continue;
    const p = personForTask(t, roster);
    if (!p) continue;
    const due = storedDue(t.dueAt);
    const size = cleanSize(t.size) ?? DEFAULT_SIZE;
    push(p.id, {
      key: planItemKey("task", t.id),
      kind: "task",
      id: t.id,
      userId: p.id,
      title: t.title,
      href: taskHref(t),
      tier: cleanTier(t.priority) ?? DEFAULT_TIER,
      size,
      sizeMin: SIZE_MIN[size],
      dueMs: due.dueMs,
      dueVirtual: due.virtual,
      earliestMs: typeof t.startAt === "number" && t.startAt > 0 ? t.startAt : null,
      createdAt: t.createdAt || 0,
      inProgress: t.status === "in_progress",
    });
  }
  for (const a of assignments) {
    if (a.done) continue;
    const p = personForAssignment(a, roster);
    if (!p) continue;
    const due = storedDue(a.dueDate);
    const size = cleanSize(a.size) ?? DEFAULT_SIZE;
    push(p.id, {
      key: planItemKey("assignment", a.id),
      kind: "assignment",
      id: a.id,
      userId: p.id,
      title: a.title,
      href: `/queue?who=${encodeURIComponent(a.assignee)}`,
      tier: cleanTier(a.priority) ?? DEFAULT_TIER,
      size,
      sizeMin: SIZE_MIN[size],
      dueMs: due.dueMs,
      dueVirtual: due.virtual,
      earliestMs: null,
      createdAt: a.createdAt || 0,
      inProgress: false,
    });
  }
  return out;
}
