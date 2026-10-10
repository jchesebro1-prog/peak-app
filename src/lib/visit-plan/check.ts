/**
 * Conflict checks for a visit on one person's day (spec 2026-10-09 site-visit
 * scheduling, Part 2 "checkVisit"). Pure and client-safe. Conflicts are
 * flagged, never resolved, and never block booking.
 */
import { dayDriveTotal, fmtDur, type DriveLeg } from "@/lib/drive-plan/plan";
import type { DriveStop } from "@/lib/drive-plan/stops";
import { fmtBusyRange, type BusyBlock } from "./busy";
import { WEEKDAY_NAMES, weekdayOf, workWindow } from "./hours";
import { fmtClock, fmtEndClock, type WorkHours } from "./settings";

export type ConflictKind = "double_booked" | "tight_drive" | "outside_hours" | "too_much_driving";
export type Conflict = { kind: ConflictKind; text: string };

export const CONFLICT_LABEL: Record<ConflictKind, string> = {
  double_booked: "Double-booked",
  tight_drive: "Tight drive",
  outside_hours: "Outside work hours",
  too_much_driving: "Too much driving",
};
export const CHECKED_WITHOUT_DRIVE = "Checked without drive time";

/** Strict: a block ending exactly when the next starts is not an overlap. */
export function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/** 300 → "5h", 330 → "5h 30m". */
export function fmtLimit(min: number): string {
  return min % 60 === 0 ? `${min / 60}h` : fmtDur(min);
}

export type StopCheckInput = {
  /** the visit's stop key on this day, "sv:<id>" */
  stopKey: string;
  dayKey: string;
  /** planDay's stops + legs for this person's day, the visit included */
  stops: DriveStop[];
  legs: DriveLeg[];
  /** everything else this person is busy with (the visit itself excluded) */
  busy: BusyBlock[];
  hours: WorkHours;
  dailyDriveLimitMin: number;
};

/** Each drive leg is trusted on its own: a flagged leg out of this stop never
 *  switches off the checks on the drive there, and vice versa. `driveChecked`
 *  is true when the stop's own address and its drive-to leg resolved (the
 *  "Checked without drive time" note is shown otherwise). */
export function stopConflicts(i: StopCheckInput): { conflicts: Conflict[]; driveChecked: boolean } {
  const stop = i.stops.find((s) => s.key === i.stopKey);
  if (!stop) return { conflicts: [], driveChecked: false };
  const driveTo = i.legs.find((l) => l.to.key === i.stopKey && l.direction === "to_stop") ?? null;
  const driveFrom = i.legs.find((l) => l.from.key === i.stopKey) ?? null;
  const verified = stop.address.status === "verified";
  const toOk = verified && !driveTo?.flag;
  const fromOk = verified && !driveFrom?.flag;
  const conflicts: Conflict[] = [];

  // Double-booked: the visit, or its drive-to block, overlaps something.
  const toBlock = toOk && driveTo && driveTo.startMs != null && driveTo.endMs != null ? { s: driveTo.startMs, e: driveTo.endMs } : null;
  const tightTo = toOk && driveTo?.tight ? driveTo.tight : null;
  for (const b of i.busy) {
    if (overlaps(stop.startMs, stop.endMs, b.startMs, b.endMs))
      conflicts.push({ kind: "double_booked", text: `Double-booked — overlaps ${b.label} (${fmtBusyRange(b)})` });
    else if (toBlock && overlaps(toBlock.s, toBlock.e, b.startMs, b.endMs)) {
      // A tight leg already says "the stop before this one runs into the drive".
      if (tightTo && b.key === driveTo?.from.key) continue;
      conflicts.push({ kind: "double_booked", text: `Double-booked — the drive there overlaps ${b.label} (${fmtBusyRange(b)})` });
    }
  }

  // Tight drive (spec 1's leg flag), into or out of this visit.
  if (tightTo) conflicts.push({ kind: "tight_drive", text: tightTo.text });
  if (fromOk && driveFrom?.tight) conflicts.push({ kind: "tight_drive", text: driveFrom.tight.text });

  // Outside work hours: the visit plus its drive there, plus the drive home
  // when this visit is the day's last stop.
  const win = workWindow(i.dayKey, i.hours);
  if (!win) {
    conflicts.push({ kind: "outside_hours", text: `Outside work hours — ${WEEKDAY_NAMES[weekdayOf(i.dayKey)]} isn't a work day` });
  } else {
    const spanStart = toBlock ? Math.min(toBlock.s, stop.startMs) : stop.startMs;
    const back = fromOk && driveFrom?.direction === "back" && driveFrom.endMs != null ? driveFrom.endMs : null;
    const spanEnd = Math.max(stop.endMs, back ?? stop.endMs);
    if (spanStart < win.startMs || spanEnd > win.endMs)
      conflicts.push({ kind: "outside_hours", text: `Outside work hours (${fmtClock(i.hours.startMin)}–${fmtEndClock(i.hours.endMin)})` });
  }

  // Too much driving: the day's total with this visit, buffer included.
  // Flagged legs count 0, so an over-limit total is still a true floor.
  if (verified) {
    const total = dayDriveTotal(i.legs);
    if (total > i.dailyDriveLimitMin) conflicts.push({ kind: "too_much_driving", text: `Too much driving — ${fmtDur(total)} of ${fmtLimit(i.dailyDriveLimitMin)}` });
  }
  return { conflicts, driveChecked: toOk };
}

export type CalendarRead = "ok" | "no-calendar" | "failed";

export function calendarNote(person: string, calendar: CalendarRead): string | null {
  if (calendar === "failed") return `Couldn't check ${person}'s calendar`;
  if (calendar === "no-calendar") return `${person} has no connected calendar — checked visits only`;
  return null;
}

export type AttendeeDay = {
  person: string;
  dayKey: string;
  stops: DriveStop[];
  legs: DriveLeg[];
  busy: BusyBlock[];
  hours: WorkHours;
  calendar: CalendarRead;
};
export type PersonCheck = { person: string; conflicts: Conflict[]; notes: string[]; calendar: CalendarRead };

export function checkVisit(candidate: { key: string }, days: AttendeeDay[], opts: { dailyDriveLimitMin: number }): PersonCheck[] {
  return days.map((d) => {
    const r = stopConflicts({ stopKey: candidate.key, dayKey: d.dayKey, stops: d.stops, legs: d.legs, busy: d.busy, hours: d.hours, dailyDriveLimitMin: opts.dailyDriveLimitMin });
    const notes: string[] = [];
    if (!r.driveChecked) notes.push(CHECKED_WITHOUT_DRIVE);
    const cal = calendarNote(d.person, d.calendar);
    if (cal) notes.push(cal);
    return { person: d.person, conflicts: r.conflicts, notes, calendar: d.calendar };
  });
}
