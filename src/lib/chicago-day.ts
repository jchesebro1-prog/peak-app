/** Chicago calendar-day helpers. Pure and client-safe. */
export const DRIVE_TZ = "America/Chicago";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDayKey(v: unknown): v is string {
  return typeof v === "string" && DAY_RE.test(v) && addDays(v, 0) === v; // round-trip rejects 2026-02-31 etc.
}

const WALL_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: DRIVE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function wallParts(ms: number): Record<string, string> {
  const parts = WALL_FMT.formatToParts(ms);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

export function chicagoDayKey(ms: number): string {
  const p = wallParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Epoch-ms of 00:00 Chicago on `dayKey`. The offset is read at 06:00 UTC,
 *  which is 00:00–01:00 local — before the 02:00 DST switch either way. */
export function chicagoDayStart(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  const probe = Date.UTC(y, m - 1, d, 6);
  const p = wallParts(probe);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Date.UTC(y, m - 1, d) - (wall - probe);
}

export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Every Chicago day touched by [minMs, maxMs], inclusive. */
export function dayKeysBetween(minMs: number, maxMs: number): string[] {
  const out: string[] = [];
  if (!(minMs <= maxMs)) return out; // reversed or NaN range: no days
  const last = chicagoDayKey(maxMs);
  for (let k = chicagoDayKey(minMs); k <= last && out.length < 400; k = addDays(k, 1)) out.push(k);
  return out;
}

const DAY_MS = 86_400_000;
const utcOfDay = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** "YYYY-MM-DD" — the Chicago calendar day `ms` falls on. */
export const dayKey = chicagoDayKey;

/** Whole calendar days from `a` to `b` (both "YYYY-MM-DD"). */
export function dayDiff(a: string, b: string): number {
  return Math.round((utcOfDay(b) - utcOfDay(a)) / DAY_MS);
}

const plainSpace = (s: string) => s.replace(/[\u00A0\u202F]/g, " ");

/** "7:02 AM" in Chicago. */
export function chicagoTime(ms: number): string {
  return plainSpace(new Date(ms).toLocaleTimeString("en-US", { timeZone: DRIVE_TZ, hour: "numeric", minute: "2-digit" }));
}

/** "Oct 7" in Chicago. */
export function chicagoShortDate(ms: number): string {
  return plainSpace(new Date(ms).toLocaleDateString("en-US", { timeZone: DRIVE_TZ, month: "short", day: "numeric" }));
}
