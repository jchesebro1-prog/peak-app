/**
 * Task-plan loader (spec Part 2 "Free time"): builds planPerson input per
 * person and runs it. Read-only — new pins come back in each result and are
 * written by savePlanPins (pages: after the response; cron: inline). Google
 * is read ONCE per person over the 8-week horizon (spec 2's
 * readCalendarForBooking, bounded by a timeout); drive blocks come from spec
 * 1's planner in "cache" mode — no geocoding or OSRM on a view.
 *
 * FAILS CLOSED: if the roster, tasks, assignments, visits, work hours or a
 * person's pins can't be read, loadTaskPlans rejects — it never returns a
 * plan built on a partial item list, so savePlanPins can't drop live pins as
 * "stale" or prune them against items that merely failed to load. Only the
 * Google read (→ the calendar note) and the drive layer degrade softly.
 */
import { addDays, chicagoDayKey } from "@/lib/drive-plan/day";
import { planDriveDays, type DriveDayPlan } from "@/lib/drive-plan/load";
import type { CalendarEvent } from "@/lib/google/calendar";
import { allAssignments, type Assignment } from "@/lib/stores/assignments";
import { workHoursFor } from "@/lib/stores/schedule-prefs";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { addPins, getPins, removePinKeys, type PinCapContext } from "@/lib/stores/task-pins";
import { allTasks, type TaskRecord } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import { busyBlocks, toBusyVisit } from "@/lib/visit-plan/busy";
import type { CalendarRead } from "@/lib/visit-plan/check";
import { readCalendarForBooking } from "@/lib/visit-plan/load";
import type { WorkHours } from "@/lib/visit-plan/settings";
import { floorQuarter } from "./free";
import { planItemsByPerson } from "./items";
import { calendarNote } from "./labels";
import type { RosterPerson } from "./people";
import { planPerson } from "./plan";
import { PLAN_HORIZON_DAYS, type BusyInterval, type PlanItem, type PlanPin, type PlanResult } from "./types";

export const PLAN_CALENDAR_TIMEOUT_MS = 6_000;
const DAY_MS = 86_400_000;

export type PersonPlan = {
  userId: string;
  name: string;
  calendar: CalendarRead;
  note: string | null;
  result: PlanResult;
  /** Exactly the items this plan was computed from — savePlanPins hands them
   *  to the pin cap (addPins' prune of past pins the plan no longer needs). */
  items?: readonly PlanItem[];
};

export type TaskPlanDeps = {
  now(): number;
  roster(): Promise<RosterPerson[]>;
  tasks(): Promise<TaskRecord[]>;
  assignments(): Promise<Assignment[]>;
  visits(): Promise<SiteVisit[]>;
  workHours(userId: string): Promise<WorkHours>;
  pins(userId: string): Promise<PlanPin[]>;
  readEvents(userId: string, range: { timeMinMs: number; timeMaxMs: number }): Promise<{ status: CalendarRead; events: CalendarEvent[] }>;
  drive(args: { userId: string; dayKeys: string[]; events: CalendarEvent[] | null; visits: () => Promise<SiteVisit[]> }): Promise<DriveDayPlan[]>;
  calendarTimeoutMs: number;
};

function defaultDeps(): TaskPlanDeps {
  return {
    now: Date.now,
    roster: async () => (await activeUsers()).map((u) => ({ id: u.id, name: u.name })),
    tasks: allTasks,
    assignments: allAssignments,
    visits: allVisits,
    workHours: workHoursFor,
    pins: getPins,
    readEvents: readCalendarForBooking,
    drive: ({ userId, dayKeys, events, visits }) => planDriveDays({ userId, dayKeys, events, mode: "cache", deps: { visits } }),
    calendarTimeoutMs: PLAN_CALENDAR_TIMEOUT_MS,
  };
}

/** `p`, or `fallback` once `ms` pass or if `p` rejects. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/** Plans for `userIds` ("everyone" = each roster person with planned work),
 *  the viewer first, then by name. Rejects when any item source or pin read
 *  fails (see the header). */
export async function loadTaskPlans(args: {
  userIds: readonly string[] | "everyone";
  meId?: string;
  deps?: Partial<TaskPlanDeps>;
}): Promise<PersonPlan[]> {
  const d: TaskPlanDeps = { ...defaultDeps(), ...args.deps };
  const now = d.now();
  const [roster, tasks, assignments] = await Promise.all([d.roster(), d.tasks(), d.assignments()]);
  const byPerson = planItemsByPerson(tasks, assignments, roster);
  const ids = args.userIds === "everyone" ? roster.filter((u) => byPerson.has(u.id)).map((u) => u.id) : [...new Set(args.userIds)];
  let visitsOnce: Promise<SiteVisit[]> | null = null;
  const visits = () => (visitsOnce ??= d.visits());
  const start = floorQuarter(now);
  const range = { timeMinMs: start, timeMaxMs: start + PLAN_HORIZON_DAYS * DAY_MS };
  const dayKeys: string[] = [];
  for (let k = chicagoDayKey(start), i = 0; i < PLAN_HORIZON_DAYS; i++, k = addDays(k, 1)) dayKeys.push(k);

  const plans = await Promise.all(
    ids.map(async (userId): Promise<PersonPlan | null> => {
      const person = roster.find((u) => u.id === userId);
      if (!person) return null;
      const [hours, pins, cal, allV] = await Promise.all([
        d.workHours(userId),
        d.pins(userId),
        withTimeout(d.readEvents(userId, range), d.calendarTimeoutMs, { status: "failed" as CalendarRead, events: [] as CalendarEvent[] }),
        visits(),
      ]);
      const events = cal.status === "ok" ? cal.events : null;
      const busy: BusyInterval[] = busyBlocks({ person: person.name, visits: allV.map(toBusyVisit), events }).map((b) => ({ startMs: b.startMs, endMs: b.endMs }));
      try {
        for (const p of await d.drive({ userId, dayKeys, events, visits })) {
          for (const l of p.legs) if (!l.flag && l.startMs != null && l.endMs != null) busy.push({ startMs: l.startMs, endMs: l.endMs });
        }
      } catch (err) {
        console.error("[task-plan] drive layer failed:", userId, err);
      }
      const items = byPerson.get(userId) ?? [];
      const result = planPerson({ userId, nowMs: now, hours, busy, pins, items });
      return { userId, name: person.name, calendar: cal.status, note: calendarNote(cal.status, person.name, userId === args.meId), result, items };
    })
  );
  return plans
    .filter((p): p is PersonPlan => !!p)
    .sort((a, b) => (a.userId === args.meId ? -1 : b.userId === args.meId ? 1 : a.name.localeCompare(b.name)));
}

export type PinStore = {
  add(userId: string, pins: readonly PlanPin[], cap?: PinCapContext): Promise<void>;
  remove(userId: string, keys: readonly string[]): Promise<void>;
};
const defaultStore: PinStore = {
  add: (userId, pins, cap) => addPins(userId, pins, cap),
  remove: removePinKeys,
};

/** Persist what a compute decided: new started pins (with the cap given the
 *  plan's own items), and stale keys dropped. Adds merge atomically and
 *  removals are by key, so two tabs computing at once are safe. Never throws. */
export async function savePlanPins(plans: readonly PersonPlan[], store: PinStore = defaultStore): Promise<void> {
  for (const p of plans) {
    try {
      if (p.result.newPins.length) await store.add(p.userId, p.result.newPins, p.items ? { items: p.items, nowMs: p.result.nowMs } : undefined);
      if (p.result.staleKeys.length) await store.remove(p.userId, p.result.staleKeys);
    } catch (err) {
      console.error("[task-plan] pin save failed:", p.userId, err);
    }
  }
}
