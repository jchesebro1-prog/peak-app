/**
 * Due dates (spec Part 1 "Due dates"). Pure and client-safe.
 *  - New tasks/assignments created without a due date get one +7 days.
 *  - Stored stamps are 5:00 pm Chicago on the due day: Google Tasks takes the
 *    UTC date of the stamp, and 5 pm Chicago is the same UTC date year-round,
 *    so the date reads the same everywhere.
 *  - The planner holds a due date until the END of its Chicago day.
 */
import { addDays, chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { chicagoWallMs, weekdayOf } from "@/lib/visit-plan/hours";
import { DEFAULT_WORK_HOURS, type WorkHours } from "@/lib/visit-plan/settings";
import { planItemKey, type PlanItemKind } from "./types";

export const AUTO_DUE_DAYS = 7;
export const DUE_STAMP_MIN = 17 * 60;

export function dueStampForDay(dayKey: string): number {
  return chicagoWallMs(dayKey, DUE_STAMP_MIN);
}

export function defaultDueAt(nowMs: number): number {
  return dueStampForDay(addDays(chicagoDayKey(nowMs), AUTO_DUE_DAYS));
}

/** The +7 rule as the create functions apply it: only an assigned item with no date. */
export function autoDueAt(dueAt: number | null | undefined, assigned: boolean, nowMs: number): number | null {
  if (typeof dueAt === "number" && Number.isFinite(dueAt) && dueAt > 0) return dueAt;
  return assigned ? defaultDueAt(nowMs) : null;
}

export function deadlineOf(dueMs: number): number {
  return chicagoDayStart(addDays(chicagoDayKey(dueMs), 1));
}

/** An undated item (pre-backfill, or never assigned a date) plans as due
 *  today + 7 days — a ROLLING date that moves with `nowMs`, never stored — so
 *  it is never overdue or At risk until it gets a real date (D801). */
export function effectiveDue(dueAt: number | null | undefined, nowMs: number): { dueMs: number; virtual: boolean } {
  if (typeof dueAt === "number" && Number.isFinite(dueAt) && dueAt > 0) return { dueMs: dueAt, virtual: false };
  return { dueMs: defaultDueAt(nowMs), virtual: true };
}

/* ---- the one-time backfill (pure half) ---- */

export const BACKFILL_WEEKS = 4;

export type BackfillItem = { kind: PlanItemKind; id: string; person: string; personName: string; createdAt: number };
export type BackfillUpdate = BackfillItem & { dayKey: string; dueAt: number };
export type BackfillPlan = {
  updates: BackfillUpdate[];
  perPerson: Array<{ person: string; name: string; count: number; firstDay: string; lastDay: string }>;
};

/** Work days in (fromDayKey, fromDayKey + calendarDays]. */
export function workDaysAfter(fromDayKey: string, calendarDays: number, hours: WorkHours): string[] {
  const out: string[] = [];
  for (let i = 1; i <= calendarDays; i++) {
    const k = addDays(fromDayKey, i);
    if (hours.days.includes(weekdayOf(k))) out.push(k);
  }
  return out;
}

/** Each person's undated items, oldest first, spread evenly over the next 4 weeks of their work days. */
export function planDueBackfill(args: {
  items: readonly BackfillItem[];
  hoursByPerson: ReadonlyMap<string, WorkHours>;
  nowMs: number;
  weeks?: number;
}): BackfillPlan {
  const today = chicagoDayKey(args.nowMs);
  const span = (args.weeks ?? BACKFILL_WEEKS) * 7;
  const byPerson = new Map<string, BackfillItem[]>();
  for (const it of args.items) {
    const list = byPerson.get(it.person);
    if (list) list.push(it);
    else byPerson.set(it.person, [it]);
  }
  const updates: BackfillUpdate[] = [];
  const perPerson: BackfillPlan["perPerson"] = [];
  for (const person of [...byPerson.keys()].sort()) {
    const list = byPerson
      .get(person)!
      .sort((a, b) => a.createdAt - b.createdAt || (planItemKey(a.kind, a.id) < planItemKey(b.kind, b.id) ? -1 : 1));
    let days = workDaysAfter(today, span, args.hoursByPerson.get(person) ?? DEFAULT_WORK_HOURS);
    if (!days.length) days = Array.from({ length: span }, (_, i) => addDays(today, i + 1));
    const mine = list.map((it, i) => {
      const dayKey = days[Math.floor((i * days.length) / list.length)];
      return { ...it, dayKey, dueAt: dueStampForDay(dayKey) };
    });
    updates.push(...mine);
    perPerson.push({ person, name: list[0].personName, count: list.length, firstDay: mine[0].dayKey, lastDay: mine[mine.length - 1].dayKey });
  }
  perPerson.sort((a, b) => a.name.localeCompare(b.name));
  return { updates, perPerson };
}
