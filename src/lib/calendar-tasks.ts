/**
 * #215 — tasks on the calendar. Pure: type-only imports, so the server
 * loader (calendar-tasks-load.ts) and the client calendar both use it.
 *
 * Placement rules (spec #215):
 *  - an open task due today or later sits on its due day (inside the range);
 *  - an open task with no due date floats on today, `carried`;
 *  - an open task due before today floats on today, `carried`, with
 *    `overdueDays` = whole days between its due day and today;
 *  - done items are never placed, and nothing is ever placed on a past day;
 *  - when today is outside the visible range, carried items are omitted.
 * Day keys are the browser's local calendar day — the same convention as
 * calendar-client.tsx's dayKeyOf for a timed item.
 */
import type { TaskRecord } from "@/lib/stores/tasks";
import type { Assignment } from "@/lib/stores/assignments";

export type CalendarTaskItem = {
  kind: "task" | "assignment";
  id: string;
  title: string;
  /** epoch-ms, null = no due date */
  dueAt: number | null;
  done: boolean;
  assigneeName: string;
  assigneeUserId?: string | null;
  assigneeInitials: string;
  /** the linked record ("" = not clickable) */
  href: string;
};

export type PlacedTask = {
  dayKey: string;
  item: CalendarTaskItem;
  carried: boolean;
  overdueDays: number;
};

export type RosterEntry = { id: string; name: string; initials?: string | null };

const pad2 = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local-time "YYYY-MM-DD" of an epoch-ms instant. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Whole days from day key `a` to day key `b` (b − a). UTC arithmetic on the
 *  keys themselves, so a DST change never adds or drops an hour. NaN for a
 *  malformed key. */
export function dayKeyDiff(a: string, b: string): number {
  const ma = KEY_RE.exec(a);
  const mb = KEY_RE.exec(b);
  if (!ma || !mb) return NaN;
  const ua = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const ub = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round((ub - ua) / DAY_MS);
}

/** 0 = overdue, 1 = undated carried, 2 = on its own day. */
function rank(p: PlacedTask): number {
  return p.overdueDays > 0 ? 0 : p.carried ? 1 : 2;
}

export function placeTasks(
  items: readonly CalendarTaskItem[],
  opts: { today: string; rangeStart: string; rangeEnd: string }
): PlacedTask[] {
  const { today, rangeStart, rangeEnd } = opts;
  const inRange = (k: string) => k >= rangeStart && k <= rangeEnd;
  const todayInRange = inRange(today);
  const out: PlacedTask[] = [];
  for (const item of items) {
    if (item.done) continue;
    const due = item.dueAt != null && Number.isFinite(item.dueAt) && item.dueAt > 0 ? item.dueAt : null;
    if (due == null) {
      if (todayInRange) out.push({ dayKey: today, item, carried: true, overdueDays: 0 });
      continue;
    }
    const dueKey = localDayKey(due);
    if (dueKey >= today) {
      if (inRange(dueKey)) out.push({ dayKey: dueKey, item, carried: false, overdueDays: 0 });
    } else if (todayInRange) {
      out.push({ dayKey: today, item, carried: true, overdueDays: dayKeyDiff(dueKey, today) });
    }
  }
  return out.sort(
    (a, b) =>
      a.dayKey.localeCompare(b.dayKey) ||
      rank(a) - rank(b) ||
      b.overdueDays - a.overdueDays ||
      (a.item.dueAt ?? 0) - (b.item.dueAt ?? 0) ||
      a.item.title.localeCompare(b.item.title) ||
      a.item.id.localeCompare(b.item.id)
  );
}

export function groupPlacedByDay(placed: readonly PlacedTask[]): Map<string, PlacedTask[]> {
  const map = new Map<string, PlacedTask[]>();
  for (const p of placed) {
    const list = map.get(p.dayKey);
    if (list) list.push(p);
    else map.set(p.dayKey, [p]);
  }
  return map;
}

export function initialsFor(name: string, roster: readonly RosterEntry[]): string {
  const hit = roster.find((r) => r.name === name);
  if (hit?.initials) return hit.initials;
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/** Where a task chip links: the thread first (email tasks), then the parent
 *  record, then the company; "" when the task links nothing. */
export function taskHref(
  t: Partial<Pick<TaskRecord, "threadId" | "projectId" | "quoteId" | "engagementId" | "designId" | "leadId" | "customerId">>
): string {
  const e = encodeURIComponent;
  if (t.threadId) return `/inbox?thread=${e(t.threadId)}`;
  if (t.projectId) return `/projects/${e(t.projectId)}`;
  if (t.quoteId) return `/quotes?id=${e(t.quoteId)}`;
  if (t.engagementId) return `/design/engagements/${e(t.engagementId)}?tab=schedule`;
  if (t.designId) return `/design/designs?id=${e(t.designId)}`;
  if (t.leadId) return `/leads?lead=${e(t.leadId)}`;
  if (t.customerId) return `/companies/${e(t.customerId)}`;
  return "";
}

export function calendarItemFromTask(t: TaskRecord, roster: readonly RosterEntry[]): CalendarTaskItem {
  return {
    kind: "task",
    id: t.id,
    title: t.title,
    dueAt: t.dueAt && t.dueAt > 0 ? t.dueAt : null,
    done: t.status === "done",
    assigneeName: t.assigneeName,
    assigneeUserId: t.assigneeUserId,
    assigneeInitials: initialsFor(t.assigneeName, roster),
    href: taskHref(t),
  };
}

export function calendarItemFromAssignment(a: Assignment, roster: readonly RosterEntry[]): CalendarTaskItem {
  return {
    kind: "assignment",
    id: a.id,
    title: a.title,
    dueAt: a.dueDate > 0 ? a.dueDate : null,
    done: !!a.done,
    assigneeName: a.assignee,
    assigneeUserId: roster.find((r) => r.name === a.assignee)?.id ?? null,
    assigneeInitials: initialsFor(a.assignee, roster),
    href: a.assignee ? `/queue?who=${encodeURIComponent(a.assignee)}` : "/queue",
  };
}

/** Mine = tasks assigned to my user id + assignments assigned to my name
 *  (how each store identifies "me"). Everyone = every assigned open item. */
export function selectCalendarTasks(
  tasks: readonly TaskRecord[],
  assignments: readonly Assignment[],
  opts: { me: { id: string; name: string }; everyone: boolean; roster: readonly RosterEntry[] }
): CalendarTaskItem[] {
  const { me, everyone, roster } = opts;
  const out: CalendarTaskItem[] = [];
  for (const t of tasks) {
    if (t.status === "done" || !t.assigneeUserId) continue;
    if (!everyone && t.assigneeUserId !== me.id) continue;
    out.push(calendarItemFromTask(t, roster));
  }
  for (const a of assignments) {
    if (a.done || !a.assignee) continue;
    if (!everyone && a.assignee !== me.name) continue;
    out.push(calendarItemFromAssignment(a, roster));
  }
  return out;
}
