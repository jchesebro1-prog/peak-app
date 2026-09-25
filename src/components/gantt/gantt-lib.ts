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

/**
 * Local NOON of the calendar day containing `ms` (#154, D232) — the anchor
 * every date this app writes already uses (`new Date(v + "T12:00:00")` in
 * every `<input type="date">` handler). Noon matters because a window
 * computed on the server is *serialized* and then re-floored in the
 * browser by `snapToDay`/`dayColumns`, which are local-calendar-day based
 * by design (D166): a boundary at local MIDNIGHT on a UTC server is 7pm of
 * the PREVIOUS day in America/Chicago, so the whole grid shifts a full
 * calendar day on hydration. A boundary at noon has ±12h of slack, which
 * covers every US zone (UTC-4 … UTC-10) against a UTC deployment.
 */
export function localNoon(ms: number): number {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/** Shift by whole LOCAL calendar days (`setDate`), never by adding raw
 *  86400000ms — a DST transition makes a local day 23 or 25 hours long, and
 *  `dayColumns` below already walks this way for exactly that reason. */
function addLocalDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Local noon of the Sunday that starts the week containing `ms`. */
function noonOfWeekStart(ms: number): number {
  const d = new Date(localNoon(ms));
  d.setDate(d.getDate() - d.getDay()); // week starts Sunday
  return d.getTime();
}

/** One visible window shared by every section of a timeline: the date range
 *  plus the px-per-day scale the sections lay out at (`0` = "no fixed
 *  scale", for a grid that simply fills its container). */
export type GanttWindow = { start: number; end: number; dayWidth: number };

/**
 * A sensible visible window for a bar set (#145 D172, reworked for #157 /
 * #154 under D232): the full extent of the given bars padded to whole
 * weeks, unioned with `nowTs` so an all-past, all-future or empty bar set
 * still shows a window containing today rather than a degenerate range.
 *
 * Callers that stack more than one section on a page pass the UNION of
 * every section's bars and hand the one result to all of them — that is
 * what makes a given x-position mean the same date in each (#157). Both
 * boundaries land on local noon (#154, see `localNoon`), and the padding
 * moves by whole local days so a window spanning a DST transition doesn't
 * drift an hour and floor onto the wrong day.
 */
export function ganttWindow(
  bars: Array<{ startAt: number; dueAt: number }>,
  nowTs: number,
  dayWidth = 0
): GanttWindow {
  const anchor = localNoon(nowTs);
  let lo = anchor,
    hi = anchor;
  bars.forEach((b) => {
    lo = Math.min(lo, b.startAt);
    hi = Math.max(hi, b.dueAt);
  });
  return {
    start: noonOfWeekStart(addLocalDays(lo, -3)),
    end: addLocalDays(noonOfWeekStart(addLocalDays(hi, 10)), 7),
    dayWidth,
  };
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
  // Overrun semantics are calendar-day based everywhere else in the
  // scheduling stack. Keep geometry on the same contract: a bar that starts
  // later on the visible end day is still on that day, not fully past it.
  if (snapToDay(bar.startAt) > snapToDay(endAt)) {
    const widthPct = Math.min(100, Math.max(0.6, ((bar.dueAt - bar.startAt) / span) * 100));
    return { leftPct: Math.max(0, 100 - widthPct), widthPct };
  }
  const s = Math.max(startAt, Math.min(endAt, bar.startAt));
  const e = Math.max(s, Math.min(endAt, bar.dueAt));
  const widthPct = Math.max(0.6, ((e - s) / span) * 100);
  const leftPct = Math.min(100 - widthPct, ((s - startAt) / span) * 100);
  return { leftPct, widthPct };
}

export function dateFromX(x: number, width: number, startAt: number, endAt: number): number {
  if (width <= 0) return startAt;
  const ratio = Math.min(1, Math.max(0, x / width));
  return snapToDay(startAt + ratio * (endAt - startAt));
}

/** Duration used by a day-snapped drag: preserve calendar days, not clock
 * milliseconds from a generated timestamp. */
export function calendarDuration(startAt: number, dueAt: number): number {
  return Math.max(0, snapToDay(dueAt) - snapToDay(startAt));
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
