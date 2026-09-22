"use client";

import { useEffect, useRef, useState } from "react";
import { MONDAY_TONE } from "@/components/ui";
import { barRect, DAY, dateFromX, dayColumns, packTracks, snapToDay } from "./gantt-lib";

/**
 * Shared draggable Gantt grid (#145) — used standalone here against fixture
 * data, then by the engagement Schedule tab and the `/schedule` portfolio
 * view. Percentage-of-range positioned (no fixed day width / zoom), so it
 * scales to whatever container width its consumer gives it; the day/week/
 * weekend/today idioms below are a direct port of
 * `src/app/(app)/schedule/page.tsx`'s crew-board day grid (~line 268-302)
 * so the two grids read as one system.
 */

export type GanttBar = {
  id: string;
  label: string;
  startAt: number;
  dueAt: number;
  /** MONDAY_TONE key (falls back to a raw CSS color, same as StatusPill). */
  tone: string;
  draggable: boolean;
  /** Renders red regardless of `tone` (spec §5.2). */
  overrun: boolean;
};

/** A single point-in-time marker (milestone). `locked: true` (D167) means
 *  the date is fixed and not casually movable: it renders solid, with a
 *  "pointer" cursor and a title/aria-label that says clicking opens the
 *  reschedule dialog. `locked: false` renders as a hollow diamond with a
 *  "grab" cursor to look perceptibly different — this is a rendering cue
 *  only; there is no `onMarkerMove` callback, so no marker actually drags
 *  in this version. `onMarkerClick` fires for either. */
export type GanttMarker = { id: string; label: string; at: number; locked: boolean };

export type GanttRow = { id: string; label: string; group: string; bars: GanttBar[] };

type DragState = {
  barId: string;
  pointerId: number;
  duration: number;
  /** Pixel offset from the track's left edge to the point the user grabbed,
   *  so the bar doesn't jump to snap its left edge under the cursor. */
  grabOffsetPx: number;
  /** The bar's own startAt when the drag began, so a release with no net
   *  movement (a plain click) can skip firing onBarMove. */
  origStart: number;
  previewStart: number;
  previewDue: number;
};

function weekdayOf(ts: number): number {
  return new Date(ts).getDay(); // 0 = Sunday, matches schedule/page.tsx's sow()
}
function isWeekend(ts: number): boolean {
  const d = weekdayOf(ts);
  return d === 0 || d === 6;
}
/** "OCT 6" — same format/case as schedule/page.tsx's week-mark labels. */
function weekLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

const LABEL_W = 190;
/** schedule/page.tsx's own day-cell header height (HEADH), reused verbatim
 *  when this grid is dense enough to show per-day cells too. */
const DENSE_HEADER_H = 60;
/** Compact header height when only week-start labels fit. */
const SPARSE_HEADER_H = 34;
/** Below this many px per day, a stacked weekday-letter + day-number cell
 *  (schedule/page.tsx:735-779) starts to overlap its neighbors — that grid
 *  gets away with a similar floor (its narrowest zoom column is 19px)
 *  because it can be horizontally scrolled into view; this grid has no
 *  scroll escape hatch (it fills whatever width its container gives it),
 *  so it needs a slightly safer floor before it commits to per-day cells. */
const MIN_DAY_CELL_PX = 24;
/** #145 review fix: below this many px per week, the "OCT 4"-style label
 *  (9.5px mono, 600 weight, .04em tracking — the widest strings are
 *  6 characters, e.g. "SEP 30"/"NOV 22") starts overlapping the label
 *  after it, since every week start renders one unconditionally with no
 *  regard for how many weeks are actually in view. A long engagement (the
 *  live-verification round used ~8 months, 34 weeks) packed them
 *  tightly enough to turn the header into an unreadable jumble. Mirrors
 *  MIN_DAY_CELL_PX's own range-adaptive idiom: measure, then thin rather
 *  than render something illegible.  */
const MIN_WEEK_LABEL_PX = 46;
const MARKER_STRIP_H = 24;
const GROUP_HEADER_H = 24;
const BAR_H = 28;
const GAP_T = 4;
const PAD_T = 6;

export function GanttGrid({
  rows,
  markers,
  startAt,
  endAt,
  onBarMove,
  onMarkerClick,
  now,
}: {
  rows: GanttRow[];
  markers: GanttMarker[];
  startAt: number;
  endAt: number;
  onBarMove: (barId: string, startAt: number, dueAt: number) => void;
  onMarkerClick?: (markerId: string) => void;
  /** Epoch ms "now" for the today line — the caller's clock, not read here,
   *  so this component stays a pure function of its props (deterministic
   *  for the fixture harness and safe to server-render). Omit to hide it. */
  now?: number;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  /* Range-adaptive day cells (review fix, #145): measure the track's real
   * rendered width so the decision reflects whatever container this
   * component actually ends up in, rather than guessing from the date
   * range alone. Starts unmeasured (server-render / first paint) — that
   * conservatively falls back to week-only labels until the effect runs,
   * never to unreadably squeezed day cells. */
  const [trackWidthPx, setTrackWidthPx] = useState<number | null>(null);
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setTrackWidthPx(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(1, endAt - startAt);
  const pct = (t: number) => ((t - startAt) / span) * 100;
  const dayPct = (DAY / span) * 100;

  const days = dayColumns(startAt, endAt);
  const weekStarts = days.filter((d) => weekdayOf(d) === 0);
  const hasToday = typeof now === "number" && now >= startAt && now <= endAt;
  const todayStart = hasToday ? snapToDay(now as number) : 0;

  const dayWidthPx = trackWidthPx != null ? trackWidthPx / Math.max(1, days.length) : 0;
  const showDayCells = dayWidthPx >= MIN_DAY_CELL_PX;
  const headerH = showDayCells ? DENSE_HEADER_H : SPARSE_HEADER_H;

  /* #145 review fix: thin the week-start LABELS (not the divider lines —
   * those stay one per week regardless, they're 1px with no text to
   * overlap) once there isn't enough width per week to print one without
   * colliding with its neighbor. Unmeasured (trackWidthPx null) falls
   * back to showing every label — the same "never guess, wait for the
   * real measurement" posture MIN_DAY_CELL_PX already takes, and on the
   * very first frame there's nothing yet to overlap. */
  const weekWidthPx = trackWidthPx != null && weekStarts.length > 0 ? trackWidthPx / weekStarts.length : 0;
  const weekLabelStride = weekWidthPx > 0 ? Math.max(1, Math.ceil(MIN_WEEK_LABEL_PX / weekWidthPx)) : 1;
  const visibleWeekStarts = weekStarts.filter((_, i) => i % weekLabelStride === 0);

  /* per-row track packing + cumulative layout, with an optional group
     header strip inserted whenever a row's `group` differs from the row
     before it (rows are assumed pre-sorted by the caller — same contract
     as the crew board's roster ordering). Built as two pure passes (no
     reassigned accumulator) so it stays render-safe under react-compiler's
     immutability check. */
  const rowMeta = rows.map((row, i) => {
    const pk = packTracks(row.bars.map((b) => ({ s: b.startAt, e: b.dueAt, k: b.id })));
    const rowH = PAD_T * 2 + pk.n * BAR_H + (pk.n - 1) * GAP_T;
    const hasGroupHeader = !!row.group && (i === 0 || rows[i - 1].group !== row.group);
    const groupH = hasGroupHeader ? GROUP_HEADER_H : 0;
    return { row, pk, rowH, hasGroupHeader, groupH, blockH: groupH + rowH };
  });
  const laidOut = rowMeta.map((m, i) => ({
    ...m,
    blockTop: rowMeta.slice(0, i).reduce((sum, r) => sum + r.blockH, 0),
  }));
  const bodyHeight = rowMeta.reduce((sum, r) => sum + r.blockH, 0);

  function beginDrag(bar: GanttBar, e: React.PointerEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const barLeftPx = (barRect(bar, startAt, endAt).leftPct / 100) * rect.width;
    const pointerPx = e.clientX - rect.left;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({
      barId: bar.id,
      pointerId: e.pointerId,
      duration: bar.dueAt - bar.startAt,
      grabOffsetPx: pointerPx - barLeftPx,
      origStart: bar.startAt,
      previewStart: bar.startAt,
      previewDue: bar.dueAt,
    });
  }

  function onDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pointerPx = e.clientX - rect.left;
    const newStart = dateFromX(pointerPx - drag.grabOffsetPx, rect.width, startAt, endAt);
    setDrag((prev) => (prev ? { ...prev, previewStart: newStart, previewDue: newStart + prev.duration } : prev));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    // A plain click (pointerdown+up with no movement) leaves previewStart
    // equal to where the drag began — skip the callback so a click doesn't
    // cost a persist + revalidate + refresh once this is wired to a server
    // action (Task 6/12).
    if (drag.previewStart !== drag.origStart) {
      onBarMove(drag.barId, drag.previewStart, drag.previewDue);
    }
    setDrag(null);
  }

  function cancelDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    setDrag(null);
  }

  return (
    <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
      {/* day/week header — port of schedule/page.tsx's week-mark idiom, plus
          its per-day cell idiom (weekday letter + date, today as an accent
          circle) once the measured track is wide enough per day; see
          MIN_DAY_CELL_PX. */}
      <div style={{ display: "flex", borderBottom: "1px solid #e7e9ee" }}>
        <div style={{ width: LABEL_W, flexShrink: 0, borderRight: "1px solid #e7e9ee", background: "#fff" }} />
        <div style={{ position: "relative", flex: 1, height: headerH }}>
          {visibleWeekStarts.map((w) => (
            <div
              key={"wl" + w}
              style={{
                position: "absolute",
                top: 5,
                left: `calc(${pct(w)}% + 6px)`,
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: ".04em",
                color: "#aab0bb",
                whiteSpace: "nowrap",
              }}
            >
              {weekLabel(w)}
            </div>
          ))}
          {showDayCells &&
            days.map((d) => {
              const isToday = hasToday && d === todayStart;
              return (
                <div
                  key={"dc" + d}
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${pct(d)}%`,
                    width: `${dayPct}%`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    borderLeft: `1px solid ${weekdayOf(d) === 0 ? "#e4e7ec" : "#f1f2f5"}`,
                    background: isWeekend(d) ? "#fafbfc" : undefined,
                  }}
                >
                  <span style={{ fontSize: 9.5, color: "#aab0bb", fontWeight: 600 }}>
                    {["S", "M", "T", "W", "T", "F", "S"][weekdayOf(d)]}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: 1.4,
                      ...(isToday
                        ? {
                            color: "#fff",
                            background: "var(--accent)",
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }
                        : { color: "#5b616e" }),
                    }}
                  >
                    {new Date(d).getDate()}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {/* marker strip — diamonds on their own row, never mixed into the bars */}
      {markers.length > 0 && (
        <div
          style={{
            position: "relative",
            height: MARKER_STRIP_H,
            borderBottom: "1px solid #f1f2f5",
            background: "#fbfbfc",
          }}
        >
          <div style={{ position: "absolute", left: LABEL_W, right: 0, top: 0, bottom: 0 }}>
            {markers.map((m) => (
              <div
                key={m.id}
                role={onMarkerClick ? "button" : undefined}
                tabIndex={onMarkerClick ? 0 : undefined}
                title={m.locked ? `${m.label} — date is fixed; opens a dialog to reschedule` : m.label}
                aria-label={m.locked ? `${m.label} — date is fixed; opens a dialog to reschedule` : m.label}
                onClick={() => onMarkerClick?.(m.id)}
                onKeyDown={(e) => {
                  if (!onMarkerClick) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onMarkerClick(m.id);
                  }
                }}
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${pct(m.at)}%`,
                  width: 11,
                  height: 11,
                  marginTop: -5.5,
                  marginLeft: -5.5,
                  background: m.locked ? "var(--accent)" : "#fff",
                  border: m.locked ? "none" : "2px solid var(--accent)",
                  boxSizing: "border-box",
                  transform: "rotate(45deg)",
                  borderRadius: 3,
                  // Not literally draggable (no onMarkerMove exists) — "grab"
                  // is a rendering cue only, so a hollow (unlocked) marker
                  // reads as "editable" against a locked one's solid fill.
                  cursor: m.locked ? "pointer" : "grab",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* rows */}
      <div style={{ position: "relative", height: bodyHeight }}>
        {/* background shading — weekends, today, week lines */}
        <div
          ref={trackRef}
          style={{ position: "absolute", top: 0, left: LABEL_W, right: 0, height: bodyHeight, pointerEvents: "none" }}
        >
          {days
            .filter((d) => isWeekend(d))
            .map((d) => (
              <div
                key={"we" + d}
                style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(d)}%`, width: `${dayPct}%`, background: "#fafbfc" }}
              />
            ))}
          {hasToday && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${pct(todayStart)}%`,
                width: `${dayPct}%`,
                background: "var(--accent-soft)",
                borderLeft: "1.5px solid var(--accent)",
              }}
            />
          )}
          {weekStarts.map((w) => (
            <div key={"ws" + w} style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(w)}%`, width: 1, background: "#e4e7ec" }} />
          ))}
        </div>

        {laidOut.map(({ row, pk, rowH, hasGroupHeader, groupH, blockTop }) => (
          <div key={row.id} style={{ position: "absolute", left: 0, right: 0, top: blockTop, height: groupH + rowH }}>
            {hasGroupHeader && (
              <div
                style={{
                  height: groupH,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 12,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".05em",
                  textTransform: "uppercase",
                  color: "#9aa0ab",
                  background: "#fbfbfc",
                  borderBottom: "1px solid #f1f2f5",
                }}
              >
                {row.group}
              </div>
            )}
            <div style={{ display: "flex", height: rowH, borderBottom: "1px solid #f1f2f5" }}>
              <div
                style={{
                  width: LABEL_W,
                  flexShrink: 0,
                  borderRight: "1px solid #e7e9ee",
                  background: "#fff",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                }}
              >
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#16181d",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {row.label}
                </span>
              </div>
              <div style={{ position: "relative", flex: 1 }}>
                {row.bars.map((bar) => {
                  const isDragging = drag?.barId === bar.id;
                  const rect =
                    isDragging && drag
                      ? barRect({ startAt: drag.previewStart, dueAt: drag.previewDue }, startAt, endAt)
                      : barRect(bar, startAt, endAt);
                  const fill = bar.overrun ? MONDAY_TONE.red : MONDAY_TONE[bar.tone] || bar.tone;
                  const trackTop = PAD_T + (pk.map[bar.id] || 0) * (BAR_H + GAP_T);
                  const dragProps = bar.draggable
                    ? {
                        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => beginDrag(bar, e),
                        onPointerMove: onDragMove,
                        onPointerUp: endDrag,
                        onPointerCancel: cancelDrag,
                      }
                    : {};
                  return (
                    <div
                      key={bar.id}
                      title={bar.label}
                      {...dragProps}
                      style={{
                        position: "absolute",
                        top: trackTop,
                        left: `${rect.leftPct}%`,
                        width: `${rect.widthPct}%`,
                        height: BAR_H,
                        background: fill,
                        borderRadius: 6,
                        padding: "0 8px",
                        display: "flex",
                        alignItems: "center",
                        overflow: "hidden",
                        boxShadow: "0 1px 2px rgba(0,0,0,.18)",
                        cursor: bar.draggable ? (isDragging ? "grabbing" : "grab") : "default",
                        zIndex: isDragging ? 3 : 2,
                        userSelect: "none",
                        touchAction: bar.draggable ? "none" : undefined,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: "#fff",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {bar.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
