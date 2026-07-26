/**
 * #21 Daylite-style date buckets — PURE, local-time. All boundaries are
 * computed from explicit LOCAL Date parts (never `ts - N*DAY` ms math), so
 * DST shifts can't skew a day edge and the spec harness can assert exact
 * bucket literals from Date-part-constructed timestamps in any timezone.
 * Weeks start Monday. Same-day future timestamps (clock skew) still read
 * "Today"; timestamps at/after tomorrow's local midnight bucket as
 * "Upcoming" (e.g. a scheduled site visit with a future startAt) — reviewer
 * fix so future-dated rows don't sit under "Today".
 */

function dayStart(ms: number, shiftDays = 0): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + shiftDays).getTime();
}

/** Monday 00:00 local of ms's week (optionally shifted by days). */
function weekStart(ms: number, shiftDays = 0): number {
  const d = new Date(ms);
  const mondayOffset = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset + shiftDays).getTime();
}

export function bucketFor(ts: number, now: number): string {
  if (ts >= dayStart(now, 1)) return "Upcoming";
  if (ts >= dayStart(now)) return "Today";
  if (ts >= dayStart(now, -1)) return "Yesterday";
  if (ts >= weekStart(now)) return "This week";
  if (ts >= weekStart(now, -7)) return "Last week";
  const d = new Date(now);
  if (ts >= new Date(d.getFullYear(), d.getMonth(), 1).getTime()) return "This month";
  return new Date(ts).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Group PRE-SORTED (ts desc) rows under their buckets, preserving order.
 * Adjacent-run grouping: bucket assignment is a monotone step function of
 * ts, so sorted input can never split a bucket into two groups. "Upcoming"
 * is the highest-ts bucket, so when present it naturally forms the FIRST
 * group — no special-casing needed here, ts-desc order already does the
 * work.
 */
export function groupRows<T extends { ts: number }>(
  rows: T[],
  now: number
): Array<{ bucket: string; rows: T[] }> {
  const out: Array<{ bucket: string; rows: T[] }> = [];
  for (const r of rows) {
    const b = bucketFor(r.ts, now);
    const last = out[out.length - 1];
    if (last && last.bucket === b) last.rows.push(r);
    else out.push({ bucket: b, rows: [r] });
  }
  return out;
}
