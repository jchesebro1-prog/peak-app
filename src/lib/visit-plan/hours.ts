/** Chicago wall-clock helpers for work hours (spec 2026-10-09 site-visit
 *  scheduling). Pure and client-safe; DST-safe. */
import { addDays, chicagoDayStart, DRIVE_TZ } from "@/lib/drive-plan/day";
import type { WorkHours } from "./settings";

const HM_FMT = new Intl.DateTimeFormat("en-US", { timeZone: DRIVE_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function chicagoMinuteOfDay(ms: number): number {
  const p = Object.fromEntries(HM_FMT.formatToParts(ms).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

/** Epoch-ms of `minuteOfDay` Chicago wall time on `dayKey`. 1440 (or more) is
 *  the next Chicago midnight, so a 23h or 25h DST day still ends on the dot. */
export function chicagoWallMs(dayKey: string, minuteOfDay: number): number {
  if (minuteOfDay >= 1440) return chicagoDayStart(addDays(dayKey, 1));
  const guess = chicagoDayStart(dayKey) + minuteOfDay * 60_000;
  let diff = chicagoMinuteOfDay(guess) - minuteOfDay; // the DST shift since midnight, if any
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return guess - diff * 60_000;
}

export function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The day's work window, or null on a non-work day. */
export function workWindow(dayKey: string, hours: WorkHours): { startMs: number; endMs: number } | null {
  if (!hours.days.includes(weekdayOf(dayKey))) return null;
  return { startMs: chicagoWallMs(dayKey, hours.startMin), endMs: chicagoWallMs(dayKey, hours.endMin) };
}

/** "Wed Oct 15" */
export function fmtDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).replace(",", "");
}

/** 540 → "9", 690 → "11:30" (the spec's "busy 9–11:30"). */
export function fmtClockShort(min: number): string {
  const h = Math.floor(min / 60) % 12 || 12;
  const m = Math.round(min) % 60;
  return m ? `${h}:${String(m).padStart(2, "0")}` : `${h}`;
}
