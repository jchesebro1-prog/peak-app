/** #323 — pure America/Chicago day math for the match index (surveys carry a
 *  date, not a time, so a survey covers its whole Chicago day). */

const TZ = "America/Chicago";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Chicago wall clock − UTC at instant `at`, in ms (−5 h in CDT, −6 h in CST). */
function chicagoOffsetMs(at: number): number {
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value])) as Record<string, string>;
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return wallAsUtc - Math.floor(at / 1000) * 1000;
}

/** Epoch ms of 00:00 America/Chicago on the given calendar date. Two passes:
 *  the offset at the first guess can sit on the far side of a DST change. */
function chicagoMidnight(y: number, m: number, d: number): number {
  const wall = Date.UTC(y, m - 1, d);
  let t = wall - chicagoOffsetMs(wall);
  t = wall - chicagoOffsetMs(t);
  return t;
}

/** "YYYY-MM-DD" → [start, end) of that day in America/Chicago (23 h or 25 h on
 *  DST days); anything that isn't a real date → null. */
export function chicagoDayRange(ymd: string | null | undefined): [number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return [chicagoMidnight(y, mo, d), chicagoMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())];
}
