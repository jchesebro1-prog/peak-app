/** Pure Gantt geometry (#145) — no React, no DOM, so the spec harness can
 *  pin the pixel↔date mapping that dragging depends on. */

const DAY = 86400000;

export function snapToDay(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

export function dayColumns(startAt: number, endAt: number): number[] {
  const out: number[] = [];
  const s = snapToDay(startAt);
  const e = snapToDay(endAt);
  for (let d = s; d <= e; d += DAY) out.push(d);
  return out;
}

/** Percentages of the visible range, clipped to it. A zero-length bar keeps
 *  a minimum width so a same-day task is still clickable. */
export function barRect(
  bar: { startAt: number; dueAt: number },
  startAt: number,
  endAt: number
): { leftPct: number; widthPct: number } {
  const span = Math.max(1, endAt - startAt);
  const s = Math.max(startAt, Math.min(endAt, bar.startAt));
  const e = Math.max(s, Math.min(endAt, bar.dueAt));
  const leftPct = ((s - startAt) / span) * 100;
  const widthPct = Math.max(0.6, ((e - s) / span) * 100);
  return { leftPct, widthPct };
}

export function dateFromX(x: number, width: number, startAt: number, endAt: number): number {
  if (width <= 0) return startAt;
  const ratio = Math.min(1, Math.max(0, x / width));
  return snapToDay(startAt + ratio * (endAt - startAt));
}
