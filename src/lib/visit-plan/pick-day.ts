/**
 * The clock times a "nearby day" pick leaves on the scheduler (spec 2026-10-09
 * site-visit scheduling). Pure and client-safe. HH:MM in, HH:MM out; blank or
 * malformed input counts as blank. The rep's times are kept when they form a
 * valid pair; otherwise 9:00 / an hour after the start / an hour before the
 * end. The end is always after the start on the same day (latest 23:59).
 */
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const LAST = 23 * 60 + 59;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function pickDayTimes(start: string, end: string): { start: string; end: string } {
  const s = HM.test(start) ? start : "";
  const e = HM.test(end) ? end : "";
  // The start stops at 23:58 so a later end always exists the same day. With
  // only an end, start an hour before it.
  const startMin = Math.min(LAST - 1, s ? mins(s) : e ? Math.max(0, mins(e) - 60) : 9 * 60);
  // Keep the rep's end when it is after the start; otherwise start + 1 h.
  const endMin = Math.min(LAST, e && mins(e) > startMin ? mins(e) : startMin + 60);
  return { start: clock(startMin), end: clock(endMin) };
}
