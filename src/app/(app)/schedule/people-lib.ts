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
 * plain fixture objects and no DB.
 *
 * Two functions, two pure stages: `groupByPerson` builds the rows from
 * consulting tasks alone; `mergeBookingsIntoPersonRows` (below) merges in
 * install/service work afterward — that data comes from a DB read (project
 * crew bookings, flame/repair/inspection jobs) neither function can see
 * itself, so page.tsx reads it and passes it in as plain data.
 *
 * One thing `groupByPerson` deliberately does NOT do, left to its caller:
 * sort `users` — rows are emitted in the given order ("in name order" means
 * the CALLER passes a name-sorted list; the fixture this function is tested
 * against intentionally does not sort alphabetically, so the contract this
 * function itself upholds is "preserve input order").
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

/** The booking fields the merge below actually reads — a structural subset
 *  of page.tsx's own `Booking` type (project crew + flame/repair/inspection
 *  work), copied rather than imported for the same zero-import reason as
 *  `PersonScheduleTask` above. `person` carries the exact sentinel string
 *  `UNASSIGNED_LABEL` for unassigned service work (page.tsx's own
 *  `UNASSIGNED_LANE`, which MUST be this module's `UNASSIGNED_LABEL` and
 *  nothing else — see mergeBookingsIntoPersonRows' own doc comment). */
export type PersonBooking = {
  crewId: string;
  projectName: string;
  person: string;
  start: number;
  end: number;
  color: string;
};

/**
 * Merges install/service work (page.tsx's own `bookings` — project crew
 * plus flame/repair/inspection jobs, none of which this module can read
 * itself; see the file header) onto the rows `groupByPerson` already built
 * from consulting tasks. Every merged bar is non-draggable (D172 — install
 * tasks are not in this scheduling model) and matched to a row by exact
 * person-name equality against `personRows[].label`.
 *
 * Three things this exists specifically to get right (#145 review, D172):
 *  - A booking whose `person` is the UNASSIGNED_LABEL sentinel — not a
 *    per-row match at all — is added to the SAME Unassigned row
 *    `groupByPerson` already returned, identified by that exact constant
 *    (never a locally re-typed "Unassigned" string — two independently
 *    edited copies of that sentinel agreeing only by coincidence is
 *    exactly the bug this function is pinned against: a caller that
 *    renamed one copy would silently stop finding `unassignedBase` below,
 *    dropping every unassigned booking on the floor and misfiling the
 *    real Unassigned row as though no booking ever matched it).
 *  - A booking whose person matches no row at all (a name-only crew
 *    booking for someone not in the active-users list passed to
 *    `groupByPerson`) gets its own synthesized row instead of being
 *    dropped — same "an empty/extra lane beats invisible work" rule as
 *    everywhere else in this module.
 *  - `personRows` is never mutated — every row/bars array in the returned
 *    list is a fresh copy, including the Unassigned row (which otherwise
 *    all three merge cases above end up needing to append onto).
 *
 * Row order in the result: every input row first (in the order given),
 * then a synthesized extra row per unmatched booking person (in the order
 * first encountered), then the Unassigned row last — mirroring
 * groupByPerson's own "Unassigned is always last" contract.
 */
export function mergeBookingsIntoPersonRows(
  personRows: readonly GanttRow[],
  bookings: readonly PersonBooking[]
): GanttRow[] {
  const known = personRows
    .filter((r) => r.label !== UNASSIGNED_LABEL)
    .map((r) => ({ ...r, bars: r.bars.slice() }));
  const unassignedBase = personRows.find((r) => r.label === UNASSIGNED_LABEL);
  const unassignedBars: GanttBar[] = unassignedBase ? unassignedBase.bars.slice() : [];
  const byLabel = new Map(known.map((r) => [r.label, r]));
  const extras: GanttRow[] = [];

  bookings.forEach((b) => {
    const bar: GanttBar = {
      id: "install:" + b.crewId,
      label: b.projectName,
      startAt: b.start,
      dueAt: b.end,
      tone: b.color,
      draggable: false,
      overrun: false,
    };
    if (b.person === UNASSIGNED_LABEL) {
      unassignedBars.push(bar);
      return;
    }
    const row = byLabel.get(b.person);
    if (row) {
      row.bars.push(bar);
    } else {
      const extra: GanttRow = { id: "person:" + b.person, label: b.person, group: "", bars: [bar] };
      byLabel.set(b.person, extra);
      extras.push(extra);
    }
  });

  const merged = [...known, ...extras];
  if (unassignedBase) merged.push({ ...unassignedBase, bars: unassignedBars });
  return merged;
}
