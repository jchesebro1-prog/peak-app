import type { GanttBar, GanttRow } from "@/components/gantt/gantt-grid";

/**
 * #145 (D172) — pure row-grouping for the /schedule "By person" portfolio
 * view: one lane per active person, plus an "Unassigned" lane, carrying
 * every CONSULTING task assigned to them across every engagement. This is
 * the view that answers "is anyone double-booked" and the reason the
 * assignee model exists in the first place.
 *
 * Zero imports beyond the Gantt row/bar TYPES (erased at compile time, no
 * runtime cost) — same discipline as consulting-schedule.ts/gantt-lib.ts, so
 * the spec harness (scripts/test-review-and-spec.ts) can exercise this with
 * plain fixture objects and no DB. Two things this module deliberately does
 * NOT do, left to its caller (page.tsx):
 *  - Sort `users` — rows are emitted in the given order ("in name order"
 *    means the CALLER passes a name-sorted list; the fixture this function
 *    is tested against intentionally does not sort alphabetically, so the
 *    contract this function itself upholds is "preserve input order").
 *  - Merge in install/service work — those come from a DB read (project
 *    crew bookings, flame/repair/inspection jobs) this module can't see.
 *    page.tsx merges those bars onto the rows this returns, by matching a
 *    booking's person name against a row's label (falling back to
 *    "Unassigned" for the exact same sentinel string this module uses, and
 *    to a synthesized extra row for a booked name with no matching user).
 */

export type PersonLite = { id: string; name: string };

/** The task fields this module actually reads — a structural subset of
 *  TaskRecord (src/lib/stores/tasks.ts), copied rather than imported so this
 *  file pulls in nothing beyond the two Gantt types above. */
export type PersonScheduleTask = {
  id: string;
  title: string;
  assigneeUserId: string | null;
  assigneeName: string;
  startAt: number | null;
  dueAt: number | null;
  engagementId: string | null;
};

export const UNASSIGNED_LABEL = "Unassigned";

/** Same 8-color cycle schedule/page.tsx's own project palette uses,
 *  redeclared (not imported) to keep this module at zero non-type imports. */
const PALETTE = ["#5b4b8a", "#2f6f4f", "#3155a8", "#9a5a1f", "#1f6a8a", "#b4543a", "#7b3f8a", "#3f7a6a"];

/**
 * groupByPerson(tasks, users) → one GanttRow per user (in the order given),
 * plus a trailing "Unassigned" row. Only tasks with both a startAt and a
 * dueAt produce a bar (spec: "a task with no startAt or dueAt is skipped —
 * it has no bar"); every user gets a row regardless — an EMPTY lane is the
 * answer to "who is free" (#145 D172).
 *
 * Every bar is `draggable: true` (this is the portfolio view's whole point:
 * dragging here calls the same moveTaskAction the engagement's own Schedule
 * tab uses) and toned by ENGAGEMENT — a stable palette assignment keyed by
 * sorted distinct engagementId, so one project reads as one colour
 * regardless of which person or lane its tasks land in.
 *
 * `overrun` is always false here: computing it would need each task's
 * engagement `endAt`, which this pure function is never handed (see file
 * header) — that flag is meaningful on the engagement's own Schedule tab,
 * which has it, not on this cross-engagement portfolio glance.
 */
export function groupByPerson(
  tasks: readonly PersonScheduleTask[],
  users: readonly PersonLite[]
): GanttRow[] {
  const engagementIds = Array.from(
    new Set(tasks.map((t) => t.engagementId).filter((id): id is string => !!id))
  ).sort();
  const toneFor = (engagementId: string | null): string => {
    if (!engagementId) return "gray";
    const i = engagementIds.indexOf(engagementId);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  };

  const scheduled = tasks.filter(
    (t): t is PersonScheduleTask & { startAt: number; dueAt: number } =>
      typeof t.startAt === "number" && typeof t.dueAt === "number"
  );

  const barFor = (t: PersonScheduleTask & { startAt: number; dueAt: number }): GanttBar => ({
    id: t.id,
    label: t.title,
    startAt: t.startAt,
    dueAt: t.dueAt,
    tone: toneFor(t.engagementId),
    draggable: true,
    overrun: false,
  });

  const rows: GanttRow[] = users.map((u) => ({
    id: u.id,
    label: u.name,
    group: "",
    bars: scheduled.filter((t) => t.assigneeUserId === u.id).map(barFor),
  }));

  // A task's assigneeUserId lands in Unassigned both when it's genuinely
  // unset AND when it names a user not present in `users` (e.g. deactivated
  // since the task was assigned) — either way there is no lane for it to
  // land in otherwise, and silently dropping it is exactly the invisible-
  // unassigned-work failure mode the Unassigned lane exists to prevent.
  const knownIds = new Set(users.map((u) => u.id));
  rows.push({
    id: "unassigned",
    label: UNASSIGNED_LABEL,
    group: "",
    bars: scheduled.filter((t) => !t.assigneeUserId || !knownIds.has(t.assigneeUserId)).map(barFor),
  });

  return rows;
}
