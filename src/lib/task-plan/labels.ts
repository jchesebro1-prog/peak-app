/** Copy for the task plan (spec Part 3). Pure, client-safe. */
import { chicagoDayKey, DRIVE_TZ } from "@/lib/drive-plan/day";
import type { CalendarRead } from "@/lib/visit-plan/check";
import { chicagoMinuteOfDay, fmtDayLabel } from "@/lib/visit-plan/hours";
import { fmtClock } from "@/lib/visit-plan/settings";
import { daysLeft } from "./urgency";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: DRIVE_TZ, weekday: "short" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { timeZone: DRIVE_TZ, month: "short", day: "numeric" });

/** "Tue" within 6 days either way, else "Nov 3". */
export function dueDayLabel(dueMs: number, nowMs: number): string {
  const d = daysLeft(dueMs, nowMs);
  return d >= -6 && d <= 6 ? WEEKDAY.format(dueMs) : MONTH_DAY.format(dueMs);
}

export function atRiskLabel(dueMs: number, nowMs: number): string {
  return `At risk — due ${dueDayLabel(dueMs, nowMs)}`;
}

export const GOOGLE_NOTE_ME = "Planned without your Google calendar — may overlap meetings";

/** null when the calendar was read; otherwise the spec's failure note. */
export function calendarNote(status: CalendarRead, name: string, isMe: boolean): string | null {
  if (status === "ok") return null;
  return isMe ? GOOGLE_NOTE_ME : `Planned without ${name}'s Google calendar — may overlap meetings`;
}

/** "8:00–9:00" (Chicago, the spec-2 clock style). */
export function fmtBlockTime(startMs: number, endMs: number): string {
  return `${fmtClock(chicagoMinuteOfDay(startMs))}–${fmtClock(chicagoMinuteOfDay(endMs))}`;
}

export const NOT_PLACED_TEXT = "Doesn't fit in the next 8 weeks";

export function finishText(finishMs: number | null): string {
  return finishMs == null ? NOT_PLACED_TEXT : `Plan finishes ${fmtDayLabel(chicagoDayKey(finishMs - 1))}`;
}
