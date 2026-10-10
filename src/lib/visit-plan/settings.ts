/**
 * Site-visit scheduling settings (spec 2026-10-09 site-visit scheduling,
 * Part 1 "Settings"). Pure and client-safe: types, defaults, cleaning and
 * formatting. Stored in the schedule_defaults / schedule_prefs:<userId> blobs
 * by src/lib/stores/schedule-prefs.ts.
 */
export type WorkHours = {
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** minutes after Chicago midnight */
  startMin: number;
  /** minutes after Chicago midnight; 1440 = midnight at the end of the day */
  endMin: number;
};

export const DEFAULT_WORK_HOURS: WorkHours = { days: [1, 2, 3, 4, 5], startMin: 8 * 60, endMin: 17 * 60 };

export type SchedulingSettings = {
  workHours: WorkHours;
  /** a stop within this many drive minutes is "in the same area" */
  sameAreaMin: number;
  /** a day's total drive (buffer included) above this is flagged */
  dailyDriveLimitMin: number;
  /** how many days ahead Nearby days looks, from today */
  nearbyLookaheadDays: number;
};

export const DEFAULT_SCHEDULING: SchedulingSettings = {
  workHours: DEFAULT_WORK_HOURS,
  sameAreaMin: 45,
  dailyDriveLimitMin: 300,
  nearbyLookaheadDays: 21,
};

export const SCHEDULING_LIMITS = {
  sameAreaMin: [5, 180],
  dailyDriveLimitMin: [30, 960],
  nearbyLookaheadDays: [1, 60],
} as const;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** `strict` (saves): only a real, whole number in range — a string or a
 *  fractional value is refused. Lenient (reading stored data) tolerates
 *  numeric strings and rounds. */
function wholeIn(v: unknown, lo: number, hi: number, strict = false): number | null {
  if (strict) return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r < lo || r > hi ? null : r;
}

const validDay = (d: unknown): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6;

/** Lenient by default (reading stored data drops bad weekdays); `strict`
 *  (every save path) refuses an unknown weekday or a fractional minute. */
export function cleanWorkHours(v: unknown, strict = false): WorkHours | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (strict && (!Array.isArray(o.days) || !o.days.every(validDay))) return null;
  const days = Array.isArray(o.days) ? [...new Set(o.days.filter(validDay))].sort((a, b) => a - b) : [];
  const startMin = wholeIn(o.startMin, 0, 1439, strict);
  const endMin = wholeIn(o.endMin, 1, 1440, strict);
  if (!days.length || startMin == null || endMin == null || endMin <= startMin) return null;
  return { days, startMin, endMin };
}

/** Stored blob → settings; each bad or missing field falls back to its default. */
export function readSchedulingSettings(raw: Record<string, unknown>): SchedulingSettings {
  const [aLo, aHi] = SCHEDULING_LIMITS.sameAreaMin;
  const [lLo, lHi] = SCHEDULING_LIMITS.dailyDriveLimitMin;
  const [dLo, dHi] = SCHEDULING_LIMITS.nearbyLookaheadDays;
  return {
    workHours: cleanWorkHours(raw?.workHours) ?? DEFAULT_SCHEDULING.workHours,
    sameAreaMin: wholeIn(raw?.sameAreaMin, aLo, aHi) ?? DEFAULT_SCHEDULING.sameAreaMin,
    dailyDriveLimitMin: wholeIn(raw?.dailyDriveLimitMin, lLo, lHi) ?? DEFAULT_SCHEDULING.dailyDriveLimitMin,
    nearbyLookaheadDays: wholeIn(raw?.nearbyLookaheadDays, dLo, dHi) ?? DEFAULT_SCHEDULING.nearbyLookaheadDays,
  };
}

/** The admin save: refuses instead of storing a silent fallback. */
export function cleanSchedulingInput(input: unknown): { ok: true; value: SchedulingSettings } | { ok: false; error: string } {
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const workHours = cleanWorkHours(o.workHours, true);
  if (!workHours) return { ok: false, error: "Work hours need at least one day and an end after the start." };
  const sameAreaMin = wholeIn(o.sameAreaMin, ...SCHEDULING_LIMITS.sameAreaMin, true);
  if (sameAreaMin == null) return { ok: false, error: "Same-area drive time must be 5–180 minutes." };
  const dailyDriveLimitMin = wholeIn(o.dailyDriveLimitMin, ...SCHEDULING_LIMITS.dailyDriveLimitMin, true);
  if (dailyDriveLimitMin == null) return { ok: false, error: "Daily drive limit must be 30 minutes to 16 hours." };
  const nearbyLookaheadDays = wholeIn(o.nearbyLookaheadDays, ...SCHEDULING_LIMITS.nearbyLookaheadDays, true);
  if (nearbyLookaheadDays == null) return { ok: false, error: "Nearby days must look 1–60 days ahead." };
  return { ok: true, value: { workHours, sameAreaMin, dailyDriveLimitMin, nearbyLookaheadDays } };
}

/** "HH:MM" (24 h) → minutes, or null. "24:00" is the end of the day (1440). */
export function clockToMin(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s || "");
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h === 24) return mm === 0 ? 1440 : null;
  return h > 23 || mm > 59 ? null : h * 60 + mm;
}

/** minutes → "HH:MM" (1440 = "24:00", the end of the day — not valid for
 *  <input type="time">, so the editor handles it separately). */
export function minToClock(min: number): string {
  const v = Math.max(0, Math.min(1440, Math.round(min)));
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

/** 480 → "8:00", 1020 → "5:00" (12-hour, no am/pm — the spec's style);
 *  1440 → "12:00 AM (end of day)". */
export function fmtClock(min: number): string {
  if (Math.round(min) >= 1440) return "12:00 AM (end of day)";
  const h = Math.floor(min / 60) % 12 || 12;
  return `${h}:${String(Math.round(min) % 60).padStart(2, "0")}`;
}

function fmtDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  const contiguous = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  return contiguous ? `${DAY_SHORT[days[0]]}–${DAY_SHORT[days[days.length - 1]]}` : days.map((d) => DAY_SHORT[d]).join(", ");
}

export function fmtWorkHours(h: WorkHours): string {
  return `${fmtDays(h.days)} ${fmtClock(h.startMin)}–${fmtClock(h.endMin)}`;
}
