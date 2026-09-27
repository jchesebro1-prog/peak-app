/**
 * Pure helpers behind ShortList (src/components/short-list.tsx) — punch
 * #224 "short lists on companies". Every card on a company record (plus
 * the Companies/Venues directories) was an unbounded `.map()` over the
 * full collection; Jeff's ask was a short list + "Show all" toggle, and
 * a filter box once a list is long enough to need one. Kept here, pure
 * and store-free, so the client component (and this harness) can test the
 * logic without touching React or a DB.
 */

/**
 * Parses a directory's `?n=` "Show more" page size (#224). Falls back to
 * `page` for anything not a positive finite integer, and clamps the top
 * end at `max` so an arbitrary `?n=999999` can't force an unbounded query
 * — shared by the Companies and Venues directories, which previously each
 * carried their own copy with no ceiling.
 */
export function parsePageSize(raw: string, page = 50, max = 500): number {
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v) || v <= 0) return page;
  return Math.min(v, max);
}

/** How many of `total` rows to render right now: `initial` while
 *  collapsed, every row once `expanded`. Clamped so a caller never gets a
 *  negative count or more rows than exist. */
export function visibleRows(total: number, initial: number, expanded: boolean): number {
  const t = Math.max(0, total);
  if (expanded) return t;
  return Math.min(t, Math.max(0, initial));
}

/** Case-insensitive substring filter over each row's own search text.
 *  The query is trimmed first; an empty query (after trim) returns every
 *  row, in its original order — a no-op, not an empty result. One pass
 *  over `rows` (bounded: O(rows), no re-scans). */
export function filterRows<T>(rows: readonly T[], query: string, textOf: (row: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows.slice();
  const out: T[] = [];
  for (const row of rows) {
    if (textOf(row).toLowerCase().includes(q)) out.push(row);
  }
  return out;
}

/**
 * Activity's date-group headers ride along with row-level paging/filtering
 * ("keep date-group headers with their rows — a group header shows only if
 * at least one of its rows is visible"). `groupSizes` are each group's
 * POST-FILTER row count, in the same order the groups render; `visibleCount`
 * is `visibleRows(...)` applied to the flattened, filtered row list (i.e.
 * the sum of `groupSizes` is the `total` that was passed to `visibleRows`).
 * Returns one flag per group — true when that group has at least one row
 * within the first `visibleCount` of the flattened, filtered list. */
export function visibleGroupFlags(groupSizes: readonly number[], visibleCount: number): boolean[] {
  const flags: boolean[] = [];
  let seen = 0;
  for (const size of groupSizes) {
    flags.push(size > 0 && seen < visibleCount);
    seen += size;
  }
  return flags;
}
