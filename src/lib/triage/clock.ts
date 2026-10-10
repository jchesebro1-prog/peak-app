import type { Slot } from "./types";

/**
 * Chicago calendar math for the triage list. Pure (Intl only), client-safe.
 * Business time = elapsed time on Chicago Mon–Fri days; weekends count zero.
 */

export const TRIAGE_TZ = "America/Chicago";
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TRIAGE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

export type ChicagoParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

export function chicagoParts(ms: number): ChicagoParts {
  const p: Record<string, string> = {};
  for (const x of PARTS_FMT.formatToParts(ms)) p[x.type] = x.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAY[p.weekday] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" — the Chicago calendar day `ms` falls on. */
export function dayKey(ms: number): string {
  const p = chicagoParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function utcOfDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function nextDayKey(day: string): string {
  return new Date(utcOfDay(day) + DAY).toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (both "YYYY-MM-DD"). */
export function dayDiff(a: string, b: string): number {
  return Math.round((utcOfDay(b) - utcOfDay(a)) / DAY);
}

/** epoch-ms of 00:00 Chicago on the day `ms` falls on. Chicago is UTC−5 or −6, and midnight never sits in a DST gap. */
export function chicagoMidnight(ms: number): number {
  const p = chicagoParts(ms);
  const base = Date.UTC(p.year, p.month - 1, p.day);
  for (const off of [5, 6]) {
    const g = base + off * HOUR;
    const q = chicagoParts(g);
    if (q.day === p.day && q.hour === 0 && q.minute === 0) return g;
  }
  return base + 6 * HOUR;
}

/** Milliseconds of [from, to) that fall on a Chicago Monday–Friday. Looks back at most 400 days. */
export function businessMsBetween(from: number, to: number): number {
  if (!(to > from)) return 0;
  let cursor = Math.max(from, to - 400 * DAY);
  let total = 0;
  while (cursor < to) {
    const start = chicagoMidnight(cursor);
    const next = chicagoMidnight(start + 26 * HOUR); // 23/24/25-hour days all land in the next day
    const end = Math.min(to, next);
    const wd = chicagoParts(cursor).weekday;
    if (wd >= 1 && wd <= 5) total += end - cursor;
    cursor = end;
  }
  return total;
}

export function businessDaysBetween(from: number, to: number): number {
  return Math.floor(businessMsBetween(from, to) / DAY);
}

/** Noon Chicago splits the morning list from the midday list. */
export const MIDDAY_HOUR = 12;

export function slotAt(ms: number): { day: string; slot: Slot } {
  return { day: dayKey(ms), slot: chicagoParts(ms).hour >= MIDDAY_HOUR ? "midday" : "morning" };
}

export function slotLabel(slot: Slot): string {
  return slot === "morning" ? "Morning list" : "Midday list";
}

export function snapshotId(userId: string, day: string, slot: Slot): string {
  return `${userId}:${day}:${slot}`;
}

/** Sortable position of a slot: "YYYY-MM-DD:0" (morning) < "YYYY-MM-DD:1" (midday) < next day. */
export function slotOrdinal(day: string, slot: Slot): string {
  return `${day}:${slot === "morning" ? 0 : 1}`;
}

export function nextMorning(day: string): { day: string; slot: Slot } {
  return { day: nextDayKey(day), slot: "morning" };
}

const plainSpace = (s: string) => s.replace(/[\u00A0\u202F]/g, " ");

/** "7:02 AM" in Chicago. */
export function chicagoTime(ms: number): string {
  return plainSpace(new Date(ms).toLocaleTimeString("en-US", { timeZone: TRIAGE_TZ, hour: "numeric", minute: "2-digit" }));
}

/** "Oct 7" in Chicago. */
export function chicagoShortDate(ms: number): string {
  return plainSpace(new Date(ms).toLocaleDateString("en-US", { timeZone: TRIAGE_TZ, month: "short", day: "numeric" }));
}
