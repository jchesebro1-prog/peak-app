/** Pure Gantt geometry (#145) — no React, no DOM, so the spec harness can
 *  pin the pixel↔date mapping that dragging depends on. */

export const DAY = 86400000;

/**
 * Floor to the start of the LOCAL calendar day containing `ms` (#145
 * review fix, live-verification round). Previously floored to the
 * UTC-epoch day (`Math.floor(ms/DAY)*DAY`), which disagrees with every
 * date this app actually writes: every `<input type="date">` in this
 * codebase (schedule-tab.tsx, new-engagement-modal.tsx, the Milestones
 * tab, …) anchors a day at LOCAL NOON (`new Date(v+"T12:00:00")`). West
 * of UTC, a UTC-midnight floor lands in the EVENING of the previous
 * local day — so dragging a bar onto the same calendar day as a
 * committed `endAt` could snap to a value numerically past that
 * local-noon `endAt` and register a false overrun. This is exactly what
 * a live drag-and-drop test surfaced (see DECISIONS.md).
 * `overrunsEnd` (consulting-schedule.ts) floors the same way, duplicated
 * rather than imported — that file is zero-import by design.
 */
export function snapToDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayColumns(startAt: number, endAt: number): number[] {
  const out: number[] = [];
  const s = snapToDay(startAt);
  const e = snapToDay(endAt);
  // #145 review fix: walk by LOCAL calendar day (`setDate`), not by adding
  // a raw `DAY` (86400000ms) each step. Found live, not in review: an
  // 8-month span crosses two US DST transitions, and a 23- or 25-hour
  // local day among 24-hour ones drifted every later "day" out of
  // alignment with true local midnight by an hour per transition —
  // visibly, two of the week-thinned header labels ended up only ~14
  // real days apart instead of 21, close enough to overlap. `snapToDay`
  // already switched to local-day semantics (see above); this makes the
  // walk agree with it instead of silently reintroducing a UTC-shaped
  // assumption one line later.
  const cursor = new Date(s);
  while (cursor.getTime() <= e) {
    out.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
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
  // #145 review fix: a bar ENTIRELY past the visible end used to clamp
  // both its edges to `endAt`, collapsing to the same ~0.6%-wide sliver
  // as a same-day zero-length bar — sitting right at the container's
  // edge, easy to miss entirely. That is exactly the case a person most
  // needs to see (a task that has slipped past the committed date is
  // information, not noise — spec §5.2), so anchor it to the right edge
  // instead, sized by its OWN real duration relative to the visible
  // span, capped at the full width. It stays a legible bar rather than a
  // hairline, and reads as "pinned against the boundary it blew past."
  if (bar.startAt >= endAt) {
    const widthPct = Math.min(100, Math.max(0.6, ((bar.dueAt - bar.startAt) / span) * 100));
    return { leftPct: Math.max(0, 100 - widthPct), widthPct };
  }
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
