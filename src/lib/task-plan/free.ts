/**
 * Free time (spec Part 2 "Free time"): work hours (spec 2) minus visits,
 * drive blocks, accepted timed Google events and pins, on a 15-minute grid,
 * with at most 80 % of each day's free minutes fillable. Pure, client-safe.
 * Epoch quarter-hours are Chicago quarter-hours (whole-hour UTC offset).
 */
import { addDays, chicagoDayKey } from "@/lib/drive-plan/day";
import { workWindow } from "@/lib/visit-plan/hours";
import type { WorkHours } from "@/lib/visit-plan/settings";
import { FILL_RATIO, GRID_MIN, MIN_CHUNK_MIN, QUARTER_MS, type BusyInterval } from "./types";

export const floorQuarter = (ms: number): number => Math.floor(ms / QUARTER_MS) * QUARTER_MS;
export const ceilQuarter = (ms: number): number => Math.ceil(ms / QUARTER_MS) * QUARTER_MS;

export function mergeIntervals(list: readonly BusyInterval[]): BusyInterval[] {
  const sorted = list
    .filter((i) => Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs > i.startMs)
    .map((i) => ({ startMs: i.startMs, endMs: i.endMs }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: BusyInterval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.startMs <= last.endMs) last.endMs = Math.max(last.endMs, i.endMs);
    else out.push(i);
  }
  return out;
}

/** `win` minus already-merged busy intervals. */
export function subtractIntervals(win: BusyInterval, merged: readonly BusyInterval[]): BusyInterval[] {
  const out: BusyInterval[] = [];
  let cur = win.startMs;
  for (const b of merged) {
    if (b.endMs <= cur) continue;
    if (b.startMs >= win.endMs) break;
    if (b.startMs > cur) out.push({ startMs: cur, endMs: b.startMs });
    cur = Math.max(cur, b.endMs);
    if (cur >= win.endMs) break;
  }
  if (cur < win.endMs) out.push({ startMs: cur, endMs: win.endMs });
  return out;
}

export type FreeDay = { dayKey: string; free: BusyInterval[]; capMin: number };

/** One entry per Chicago day from `startMs`. Today's free time counts from
 *  `startMs`; gaps snap inward to the grid; cap = 80 % of the day's free
 *  minutes, floored to 15. */
export function freeDays(args: { startMs: number; days: number; hours: WorkHours; busy: readonly BusyInterval[]; fillRatio?: number }): FreeDay[] {
  const merged = mergeIntervals(args.busy);
  const ratio = args.fillRatio ?? FILL_RATIO;
  const out: FreeDay[] = [];
  let k = chicagoDayKey(args.startMs);
  for (let i = 0; i < args.days; i++, k = addDays(k, 1)) {
    const win = workWindow(k, args.hours);
    const from = win ? Math.max(win.startMs, args.startMs) : 0;
    if (!win || from >= win.endMs) {
      out.push({ dayKey: k, free: [], capMin: 0 });
      continue;
    }
    const free = subtractIntervals({ startMs: from, endMs: win.endMs }, merged)
      .map((g) => ({ startMs: ceilQuarter(g.startMs), endMs: floorQuarter(g.endMs) }))
      .filter((g) => g.endMs > g.startMs);
    const freeMin = free.reduce((s, g) => s + (g.endMs - g.startMs) / 60_000, 0);
    out.push({ dayKey: k, free, capMin: Math.floor((freeMin * ratio) / GRID_MIN) * GRID_MIN });
  }
  return out;
}

/** The biggest piece of `remainingMin` that fits `availMin` with every piece
 *  ≥ 30 min (a remainder under 30 is placed whole); 0 = doesn't fit here. */
export function chunkFor(remainingMin: number, availMin: number): number {
  if (availMin >= remainingMin) return remainingMin;
  const minChunk = Math.min(MIN_CHUNK_MIN, remainingMin);
  let c = Math.floor(availMin / GRID_MIN) * GRID_MIN;
  if (remainingMin - c < MIN_CHUNK_MIN) c = remainingMin - MIN_CHUNK_MIN;
  return c >= minChunk ? c : 0;
}
