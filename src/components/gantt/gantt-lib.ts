/** Pure Gantt geometry (#145) — no React, no DOM, so the spec harness can
 *  pin the pixel↔date mapping that dragging depends on. */

export const DAY = 86400000;

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

/** Greedy overlap packing so bars sharing a row don't collide — moved here
 *  (review fix, #145) from gantt-grid.tsx, which had it copied verbatim
 *  from schedule/page.tsx's packTracks; this is pure, so it belongs beside
 *  the rest of the geometry rather than duplicated in the client component.
 *  Assigns each item the lowest track index whose previous occupant has
 *  already ended, tracks the running end of each track, and returns the
 *  max track count used (at least 1, even for an empty list). */
export function packTracks(items: Array<{ s: number; e: number; k: string }>): {
  map: Record<string, number>;
  n: number;
} {
  const sorted = items.slice().sort((a, b) => a.s - b.s);
  const ends: number[] = [];
  const map: Record<string, number> = {};
  sorted.forEach((it) => {
    let tk = ends.findIndex((en) => en < it.s);
    if (tk < 0) {
      tk = ends.length;
      ends.push(it.e);
    } else ends[tk] = it.e;
    map[it.k] = tk;
  });
  return { map, n: Math.max(1, ends.length) };
}
