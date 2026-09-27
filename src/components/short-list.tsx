"use client";

import { useMemo, useState, type ReactNode } from "react";
import { filterRows, visibleGroupFlags, visibleRows } from "@/lib/short-list";

/** Above this many rows, a filter box appears (spec: "when the row count
 *  > 10 and searchText is given"). Below it, endless-scroll was never the
 *  problem Jeff flagged — just the toggle is enough. */
const SEARCH_THRESHOLD = 10;

export interface ShortListGroup {
  /** Rendered only when at least one row in this group is visible. */
  header: ReactNode;
  /** How many of the flattened `items` (in order) belong to this group. */
  count: number;
}

/**
 * A server-rendered card body that starts collapsed to `initial` rows with
 * a "Show all N" / "Show fewer" toggle, and — once there are enough rows to
 * bother — a client-side filter box that searches across every row (not
 * just the visible ones). Rows themselves are rendered on the server and
 * handed in as `items`; this component only decides which ones show.
 *
 * Optional `groups` lets a caller (Activity's date buckets) keep a header
 * riding along with its rows: the header shows only while at least one of
 * its rows survives filtering + paging (see `visibleGroupFlags`).
 */
export function ShortList({
  items,
  searchText,
  initial = 5,
  searchPlaceholder = "Search…",
  groups,
}: {
  items: ReactNode[];
  searchText?: string[];
  initial?: number;
  searchPlaceholder?: string;
  groups?: ShortListGroup[];
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const total = items.length;
  const canSearch = total > SEARCH_THRESHOLD && !!searchText;

  const indices = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);
  const matched = useMemo(
    () => (canSearch && query.trim() ? filterRows(indices, query, (i) => searchText![i] ?? "") : indices),
    [indices, canSearch, query, searchText]
  );

  const visibleCount = visibleRows(matched.length, initial, expanded);
  const shownSet = useMemo(() => new Set(matched.slice(0, visibleCount)), [matched, visibleCount]);
  const showToggle = matched.length > initial;
  const showNoMatches = matched.length === 0 && total > 0;

  let body: ReactNode;
  if (groups && groups.length) {
    const matchedSet = new Set(matched);
    let cursor = 0;
    const groupRowIdx = groups.map((g) => {
      const idx: number[] = [];
      for (let n = 0; n < g.count; n++) idx.push(cursor + n);
      cursor += g.count;
      return idx;
    });
    const groupSizes = groupRowIdx.map((idx) => idx.filter((i) => matchedSet.has(i)).length);
    const flags = visibleGroupFlags(groupSizes, visibleCount);
    body = groups.map((g, gi) => {
      const rows = groupRowIdx[gi].filter((i) => shownSet.has(i));
      if (rows.length === 0) return null;
      return (
        <div key={gi}>
          {flags[gi] && g.header}
          {rows.map((i) => (
            <div key={i}>{items[i]}</div>
          ))}
        </div>
      );
    });
  } else {
    body = matched.slice(0, visibleCount).map((i) => <div key={i}>{items[i]}</div>);
  }

  return (
    <div>
      {canSearch && (
        <div style={{ padding: "10px 18px", borderBottom: "1px solid #f0f1f4" }}>
          <input
            className="pk-input"
            style={{ width: "100%", fontSize: 12.5 }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {body}
      {showNoMatches && (
        <div style={{ padding: "20px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          No matches for “{query.trim()}”.
        </div>
      )}
      {showToggle && (
        <button
          type="button"
          className="pk-btn-outline"
          style={{ margin: "10px 18px", fontSize: 12 }}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show fewer" : `Show all ${matched.length}`}
        </button>
      )}
    </div>
  );
}
