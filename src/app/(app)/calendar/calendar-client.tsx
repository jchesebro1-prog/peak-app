"use client";

import { useMemo, useState, useSyncExternalStore, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AgendaItem } from "@/lib/agenda";
import EventModal, { type EventModalTarget } from "./event-modal";
import CalendarFilterRail from "./calendar-filter-rail";
import { setStayOverAction, type CalendarConnectionView } from "../calendar-actions";
import { fmtDur, FLAG_TEXT } from "@/lib/drive-plan/plan";
import { isStayOverDay } from "@/lib/drive-plan/day";
import AddressFlagBadge from "@/components/address-fix/address-flag";
import { groupPlacedByDay, placeTasks, type CalendarTaskItem, type PlacedTask } from "@/lib/calendar-tasks";
import TaskChip from "./task-chip";

/**
 * Full-page calendar (S13 / D81, extended to day/week in the S13
 * full-build). Month/week/day all share one merged-agenda feed (loadAgendaRange).
 * Day/hour placement is computed in the BROWSER'S timezone (rendered after
 * hydration, same pattern as the dashboard card); all-day items place by
 * their UTC calendar date. Clicking an empty day/slot opens the create
 * modal; clicking a Google-sourced item opens it for edit — Peak site-visit
 * items with no mirrored Google event (source "visit") keep linking out to
 * the customer record instead, since there's no Google event id to edit.
 */

const emptySubscribe = () => () => {};

const HOUR_START = 6; // 6am
const HOUR_END = 21; // 9pm
const HOUR_PX = 48;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dayKeyOf(it: AgendaItem): string {
  const d = new Date(it.startMs);
  const y = it.allDay ? d.getUTCFullYear() : d.getFullYear();
  const m = it.allDay ? d.getUTCMonth() : d.getMonth();
  const day = it.allDay ? d.getUTCDate() : d.getDate();
  return `${y}-${pad2(m + 1)}-${pad2(day)}`;
}

function keyFor(y: number, m0: number, d: number): string {
  const dt = new Date(y, m0, d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function dateParam(y: number, m0: number, d: number): string {
  const dt = new Date(y, m0, d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function monthParam(y: number, m0: number): string {
  const d = new Date(y, m0, 1);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}

function timeLabel(it: AgendaItem): string {
  if (it.allDay) return "";
  return new Date(it.startMs)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(" ", "")
    .toLowerCase();
}

function isGoogle(it: AgendaItem): boolean {
  return it.source === "google";
}

/** D148 — an "external" item (a subscribed calendar on an additional Google
 *  account) renders in its own connection/calendar color rather than the
 *  two hardcoded google/visit colors below, and is read-only here (no edit
 *  modal — the app never writes to these accounts); clicking it opens
 *  Google's own event page in a new tab when a link is available. */
function isExternal(it: AgendaItem): boolean {
  return it.source === "external";
}

const isDrive = (it: AgendaItem) => it.source === "drive";
const isDriveFlag = (it: AgendaItem) => it.source === "drive" && !!it.drive?.flag;
/** Spec 2026-10-09 — total drive minutes (buffer included) per Chicago day.
 *  Keyed by the leg's own `drive.dayKey`, not the browser-local date, so a
 *  day's total is exactly one Chicago day however the browser is zoned. */
function driveTotalsByChicagoDay(items: AgendaItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) {
    if (!isDrive(it) || !it.drive || it.drive.flag) continue;
    out.set(it.drive.dayKey, (out.get(it.drive.dayKey) ?? 0) + (it.drive.minutes ?? 0));
  }
  return out;
}
/** A leg flag's short form for the month grid (verbatim stays in title + aria-label). */
function compactLegFlag(text: string): string {
  return text === FLAG_TEXT.route_unavailable ? "Drive unavailable" : text === FLAG_TEXT.long_route ? "Over 6 h" : text;
}
function blockColors(it: AgendaItem, tint: (hex: string, a: number) => string): { bg: string; bd: string; ink: string } {
  if (isExternal(it)) { const c = it.external!.color; return { bg: tint(c, 0.14), bd: tint(c, 0.4), ink: c }; }
  if (isDrive(it)) return it.drive?.tight ? { bg: "#fdf3e7", bd: "#f0d3a8", ink: "#8a5a1a" } : { bg: "#f1f2f5", bd: "#d9dce2", ink: "#5b616e" };
  if (it.source === "visit") return { bg: "#e8f3ee", bd: "#cfe6db", ink: "#1f7a52" };
  return { bg: "#e9eefb", bd: "#d4ddf3", ink: "#3155a8" };
}

/** Greedy interval-overlap column assignment, per connected cluster, so
 *  concurrent events in a day column sit side-by-side instead of stacking. */
function layoutTimed(items: AgendaItem[]): Array<{ it: AgendaItem; col: number; cols: number }> {
  const timed = items.filter((i) => !i.allDay).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: Array<{ it: AgendaItem; col: number; cols: number }> = [];
  let i = 0;
  while (i < timed.length) {
    let clusterEnd = timed[i].endMs;
    let j = i + 1;
    while (j < timed.length && timed[j].startMs < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, timed[j].endMs);
      j++;
    }
    const cluster = timed.slice(i, j);
    const active: Array<{ endMs: number; col: number }> = [];
    const assigned: Array<{ it: AgendaItem; col: number }> = [];
    let maxCol = 0;
    for (const it of cluster) {
      for (let a = active.length - 1; a >= 0; a--) if (active[a].endMs <= it.startMs) active.splice(a, 1);
      const used = new Set(active.map((a) => a.col));
      let col = 0;
      while (used.has(col)) col++;
      active.push({ endMs: it.endMs, col });
      assigned.push({ it, col });
      maxCol = Math.max(maxCol, col + 1);
    }
    for (const a of assigned) out.push({ it: a.it, col: a.col, cols: maxCol });
    i = j;
  }
  return out;
}

export default function CalendarClient({
  view,
  year,
  month,
  dateY,
  dateM,
  dateD,
  items,
  calendarOn,
  gmailOn,
  calendarConnections,
  canConnectCalendar,
  tasks,
  tasksEveryone,
  stayOvers,
}: {
  view: "month" | "week" | "day";
  year: number;
  month: number; // 0-based
  dateY: number;
  dateM: number;
  dateD: number; // 0-based-free — a local day, week/day view anchor
  items: AgendaItem[];
  calendarOn: boolean;
  gmailOn: boolean;
  /** D148 — the signed-in user's additional connected Google accounts +
   *  their per-calendar visibility/color prefs, for the filter rail. */
  calendarConnections: CalendarConnectionView[];
  /** Whether "Connect an account" can be offered at all (googleConfigured()
   *  server-side) — independent of gmailOn, see calendar-actions.ts. */
  canConnectCalendar: boolean;
  /** #215 — open tasks + My Queue assignments (mine, or everyone's with ?tasks=all). */
  tasks: CalendarTaskItem[];
  tasksEveryone: boolean;
  /** Spec 2026-10-09 — this rep's "Staying near last stop" days (YYYY-MM-DD → true). */
  stayOvers: Record<string, boolean>;
}) {
  const router = useRouter();
  const [stayPending, startStay] = useTransition();
  // Optimistic stay-over state (until the refreshed prop catches up) + the
  // last refusal per day, shown inline under the toggle.
  // Tied to the `stayOvers` object it was set against: a refresh hands in a new one and retires it.
  const [stayOptRaw, setStayOptRaw] = useState<{ src: Record<string, boolean>; map: Record<string, boolean> }>({ src: stayOvers, map: {} });
  const stayOpt = stayOptRaw.src === stayOvers ? stayOptRaw.map : {};
  const setStayOpt = (f: (o: Record<string, boolean>) => Record<string, boolean>) =>
    setStayOptRaw((cur) => ({ src: stayOvers, map: f(cur.src === stayOvers ? cur.map : {}) }));
  const [stayErr, setStayErr] = useState<Record<string, string>>({});
  const isStay = (k: string) => stayOpt[k] ?? !!stayOvers[k];
  function toggleStay(k: string) {
    const want = !isStay(k);
    setStayErr((e) => ({ ...e, [k]: "" }));
    setStayOpt((o) => ({ ...o, [k]: want }));
    startStay(async () => {
      let res: Awaited<ReturnType<typeof setStayOverAction>>;
      try {
        res = await setStayOverAction(k, want);
      } catch {
        res = { ok: false, error: "Couldn't save — try again" };
      }
      if (!res.ok) {
        setStayOpt((o) => Object.fromEntries(Object.entries(o).filter(([d]) => d !== k)));
        setStayErr((e) => ({ ...e, [k]: res.error }));
        return;
      }
      router.refresh();
    });
  }
  // compact = month chips (short form); otherwise the flag prints verbatim
  // (all-day strip). Either way the verbatim text is in title + aria-label.
  function renderDriveFlag(it: AgendaItem, compact: boolean) {
    const text = it.drive?.flag || "";
    return (
      <div key={it.key} onClick={(e) => e.stopPropagation()} style={{ fontSize: 10.5, lineHeight: 1.35, marginBottom: 3, padding: "2px 6px", borderRadius: 5, background: "#fbf0ee", border: "1px dashed #e8c9c0" }}>
        {it.drive?.fix ? (
          <AddressFlagBadge flag={{ text, fix: it.drive.fix }} compact={compact} />
        ) : (
          <span role="img" style={{ fontWeight: 600, color: "#8a3a2a" }} title={text} aria-label={text}>⚠ {compact ? compactLegFlag(text) : text}</span>
        )}
      </div>
    );
  }
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [modalTarget, setModalTarget] = useState<EventModalTarget | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const it of items) {
      const k = dayKeyOf(it);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    for (const list of map.values())
      list.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.startMs - b.startMs));
    return map;
  }, [items]);
  const driveTotals = useMemo(() => driveTotalsByChicagoDay(items), [items]);

  const weeks = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const out: Date[][] = [];
    const cur = new Date(start);
    do {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
      }
      out.push(week);
    } while (cur.getMonth() === month);
    return out;
  }, [year, month]);

  const weekDays = useMemo(() => {
    const anchor = new Date(dateY, dateM, dateD);
    const start = new Date(dateY, dateM, dateD - anchor.getDay());
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    return out;
  }, [dateY, dateM, dateD]);

  const dayDate = useMemo(() => new Date(dateY, dateM, dateD), [dateY, dateM, dateD]);

  const todayKey = (() => {
    const t = new Date();
    return keyFor(t.getFullYear(), t.getMonth(), t.getDate());
  })();

  // #215 — the visible day range. Tasks are placed in the browser's timezone
  // (dayKeyOf's convention); the month grid and the task strip only render
  // them once mounted, so SSR never disagrees about "today".
  const keyOfDate = (d: Date) => keyFor(d.getFullYear(), d.getMonth(), d.getDate());
  const rangeStart =
    view === "month" ? keyOfDate(weeks[0][0]) : view === "week" ? keyOfDate(weekDays[0]) : keyOfDate(dayDate);
  const rangeEnd =
    view === "month"
      ? keyOfDate(weeks[weeks.length - 1][6])
      : view === "week"
        ? keyOfDate(weekDays[6])
        : keyOfDate(dayDate);
  const tasksByDay = useMemo(
    () => groupPlacedByDay(placeTasks(tasks, { today: todayKey, rangeStart, rangeEnd })),
    [tasks, todayKey, rangeStart, rangeEnd]
  );
  const tasksQs = tasksEveryone ? "&tasks=all" : "";

  function dayViewHref(k: string): string {
    return `/calendar?view=day&date=${k}${tasksQs}`;
  }

  function renderTasks(k: string, cap: number) {
    const list: PlacedTask[] = tasksByDay.get(k) || [];
    if (!list.length) return null;
    return (
      <>
        {list.slice(0, cap).map((p) => (
          <TaskChip key={`${p.item.kind}:${p.item.id}`} placed={p} showAssignee={tasksEveryone} />
        ))}
        {list.length > cap && (
          <Link
            href={dayViewHref(k)}
            onClick={(e) => e.stopPropagation()}
            style={{ display: "block", fontSize: 10, color: "#5b3a8a", fontWeight: 600, textDecoration: "none", marginBottom: 3 }}
          >
            +{list.length - cap} more task{list.length - cap === 1 ? "" : "s"}
          </Link>
        )}
      </>
    );
  }

  function openCreateAt(y: number, m0: number, d: number, hour: number | null) {
    if (!calendarOn) return;
    const startAt =
      hour == null ? new Date(y, m0, d).getTime() : new Date(y, m0, d, hour).getTime();
    const endAt = hour == null ? startAt : startAt + 60 * 60_000;
    setModalTarget({ mode: "create", startMs: startAt, endMs: endAt, allDay: hour == null });
  }

  function openItem(it: AgendaItem) {
    if (!isGoogle(it)) return; // visits/external items have nothing to edit here
    setModalTarget({ mode: "edit", eventId: it.id });
  }

  /** #rrggbb → rgba(...) at the given alpha, for a light chip background
   *  derived from an external calendar's own color (D148). Falls back to a
   *  neutral tint if the color isn't a plain hex string (Google's
   *  backgroundColor always is, but a hand-set colorOverride is validated
   *  only to be one of the rail's own swatches, also always hex). */
  function tint(hex: string, alpha: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return `rgba(107,114,128,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function chipStyle(it: AgendaItem): CSSProperties {
    const c = blockColors(it, tint);
    return {
      fontSize: 10.5,
      lineHeight: 1.35,
      fontWeight: 600,
      color: c.ink,
      background: c.bg,
      border: `1px solid ${c.bd}`,
      borderRadius: 5,
      padding: "2px 6px",
      marginBottom: 3,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      cursor: isGoogle(it) || it.href ? "pointer" : "default",
    };
  }

  // The Fix button sits beside the chip, never inside its link (a button
  // can't nest in an anchor).
  function renderMonthChip(it: AgendaItem) {
    if (isDriveFlag(it)) return renderDriveFlag(it, true);
    if (!it.addressFlag) return renderMonthChipBody(it);
    return (
      <div key={it.key}>
        {renderMonthChipBody(it)}
        <div style={{ marginBottom: 3 }}>
          <AddressFlagBadge flag={it.addressFlag} compact />
        </div>
      </div>
    );
  }

  function renderMonthChipBody(it: AgendaItem) {
    const chip = (
      <div
        style={chipStyle(it)}
        title={(it.allDay ? "All day" : timeLabel(it)) + " · " + it.title + (it.location ? " · " + it.location : "")}
      >
        {it.allDay ? "" : timeLabel(it) + " "}
        {it.title}
      </div>
    );
    if (isGoogle(it)) {
      return (
        <div key={it.key} onClick={(e) => { e.stopPropagation(); openItem(it); }}>
          {chip}
        </div>
      );
    }
    if (isExternal(it)) {
      // Read-only, and on a different Google account than this app writes
      // to — clicking opens Google's own event page in a new tab instead of
      // any in-app edit affordance.
      return it.href ? (
        <a
          key={it.key}
          href={it.href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ display: "block", textDecoration: "none" }}
        >
          {chip}
        </a>
      ) : (
        <div key={it.key}>{chip}</div>
      );
    }
    return it.href ? (
      <Link key={it.key} href={it.href} onClick={(e) => e.stopPropagation()} style={{ display: "block", textDecoration: "none" }}>
        {chip}
      </Link>
    ) : (
      <div key={it.key}>{chip}</div>
    );
  }

  // ---- header nav ----

  const headerTitle =
    view === "month"
      ? new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : view === "week"
        ? `${weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : dayDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  function switchViewHref(v: "month" | "week" | "day"): string {
    const base = view === "month" ? new Date(year, month, 1) : new Date(dateY, dateM, dateD);
    if (v === "month") return `/calendar?view=month&month=${monthParam(base.getFullYear(), base.getMonth())}${tasksQs}`;
    return `/calendar?view=${v}&date=${dateParam(base.getFullYear(), base.getMonth(), base.getDate())}${tasksQs}`;
  }

  function prevHref(): string {
    if (view === "month") return `/calendar?view=month&month=${monthParam(year, month - 1)}${tasksQs}`;
    const step = view === "week" ? 7 : 1;
    const d = new Date(dateY, dateM, dateD - step);
    return `/calendar?view=${view}&date=${dateParam(d.getFullYear(), d.getMonth(), d.getDate())}${tasksQs}`;
  }

  function nextHref(): string {
    if (view === "month") return `/calendar?view=month&month=${monthParam(year, month + 1)}${tasksQs}`;
    const step = view === "week" ? 7 : 1;
    const d = new Date(dateY, dateM, dateD + step);
    return `/calendar?view=${view}&date=${dateParam(d.getFullYear(), d.getMonth(), d.getDate())}${tasksQs}`;
  }

  const todayHref = `/calendar?view=${view}${tasksQs}`;

  // #215 — the current page without the tasks choice; the toggle adds it back.
  const hereHref =
    view === "month"
      ? `/calendar?view=month&month=${monthParam(year, month)}`
      : `/calendar?view=${view}&date=${dateParam(dateY, dateM, dateD)}`;

  const hourLabels = useMemo(() => {
    const out: string[] = [];
    for (let h = HOUR_START; h < HOUR_END; h++) {
      out.push(new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" }));
    }
    return out;
  }, []);

  function renderTimeGrid(days: Date[]) {
    const colWidth = days.length > 1 ? `${100 / days.length}%` : "100%";
    return (
      <div className="pk-card" style={{ overflow: "hidden" }}>
        {/* day headers */}
        <div style={{ display: "flex", borderBottom: "1px solid #eef0f3" }}>
          <div style={{ width: 52 }} />
          {days.map((d) => {
            const k = keyFor(d.getFullYear(), d.getMonth(), d.getDate());
            const isToday = k === todayKey;
            return (
              <div key={k} style={{ width: colWidth, padding: "8px 6px", textAlign: "center" }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "#9aa0ab" }}>
                  {d.toLocaleDateString("en-US", { weekday: "short" })}
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 24,
                    height: 24,
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 700,
                    marginTop: 2,
                    color: isToday ? "#fff" : "#16181d",
                    background: isToday ? "var(--accent)" : "transparent",
                  }}
                >
                  {d.getDate()}
                </div>
                {/* The column key k is a date label; drive totals and the stay-over
                    toggle treat it as the Chicago day it names (the leg's drive.dayKey). */}
                {(driveTotals.get(k) ?? 0) > 0 && (
                  <div style={{ fontSize: 10, color: "#5b616e", fontWeight: 600, marginTop: 2 }}>Drive {fmtDur(driveTotals.get(k) ?? 0)}</div>
                )}
                {mounted && isStayOverDay(k, Date.now()) && (
                  <>
                    <button
                      type="button"
                      disabled={stayPending}
                      onClick={() => toggleStay(k)}
                      title="No drive back to base today; tomorrow starts from your last stop"
                      style={{ marginTop: 3, fontSize: 9.5, fontWeight: 600, padding: "1px 6px", borderRadius: 10, border: "1px solid #e4e7ec", background: isStay(k) ? "var(--accent)" : "#fff", color: isStay(k) ? "#fff" : "#9aa0ab", cursor: "pointer" }}
                    >
                      {isStay(k) ? "✓ Staying near last stop" : "Staying near last stop"}
                    </button>
                    {stayErr[k] && <div role="alert" style={{ marginTop: 2, fontSize: 10, color: "#a03b2e" }}>{stayErr[k]}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* #215 task strip — tasks float above the all-day row */}
        <div style={{ display: "flex", borderBottom: "1px solid #eef0f3", minHeight: 26 }}>
          <div style={{ width: 52, fontSize: 9.5, color: "#c4c9d2", textAlign: "right", padding: "4px 6px 0 0" }}>tasks</div>
          {days.map((d) => {
            const k = keyFor(d.getFullYear(), d.getMonth(), d.getDate());
            return (
              <div key={k} style={{ width: colWidth, padding: "3px 4px", minWidth: 0 }}>
                {mounted ? renderTasks(k, Number.POSITIVE_INFINITY) : null}
              </div>
            );
          })}
        </div>

        {/* all-day strip */}
        <div style={{ display: "flex", borderBottom: "1px solid #eef0f3", minHeight: 26 }}>
          <div style={{ width: 52, fontSize: 9.5, color: "#c4c9d2", textAlign: "right", padding: "4px 6px 0 0" }}>all-day</div>
          {days.map((d) => {
            const k = keyFor(d.getFullYear(), d.getMonth(), d.getDate());
            const allDayItems = (byDay.get(k) || []).filter((it) => it.allDay);
            return (
              <div
                key={k}
                style={{ width: colWidth, padding: "3px 4px", cursor: calendarOn ? "pointer" : "default" }}
                onClick={() => openCreateAt(d.getFullYear(), d.getMonth(), d.getDate(), null)}
              >
                {allDayItems.map((it) => (
                  <div
                    key={it.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isExternal(it)) {
                        if (it.href) window.open(it.href, "_blank", "noreferrer");
                      } else {
                        openItem(it);
                      }
                    }}
                  >
                    <div style={chipStyle(it)} title={it.title}>{it.title}</div>
                  </div>
                ))}
                {(byDay.get(k) || []).filter(isDriveFlag).map((it) => renderDriveFlag(it, false))}
              </div>
            );
          })}
        </div>

        {/* hourly grid */}
        {!mounted ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#c4c9d2", fontSize: 12.5 }}>Loading…</div>
        ) : (
          <div style={{ display: "flex" }}>
            <div style={{ width: 52 }}>
              {hourLabels.map((lbl) => (
                <div key={lbl} style={{ height: HOUR_PX, fontSize: 10, color: "#c4c9d2", textAlign: "right", paddingRight: 6, borderTop: "1px solid #f4f5f7", boxSizing: "border-box" }}>
                  {lbl}
                </div>
              ))}
            </div>
            {days.map((d) => {
              const k = keyFor(d.getFullYear(), d.getMonth(), d.getDate());
              const timed = (byDay.get(k) || []).filter((it) => !it.allDay && !isDriveFlag(it));
              const positioned = layoutTimed(timed);
              return (
                <div key={k} style={{ width: colWidth, position: "relative", borderLeft: "1px solid #f4f5f7" }}>
                  {hourLabels.map((_, hi) => (
                    <div
                      key={hi}
                      style={{ height: HOUR_PX, borderTop: "1px solid #f4f5f7", boxSizing: "border-box", cursor: calendarOn ? "pointer" : "default" }}
                      onClick={() => openCreateAt(d.getFullYear(), d.getMonth(), d.getDate(), HOUR_START + hi)}
                    />
                  ))}
                  <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                    {positioned.map(({ it, col, cols }) => {
                      const startMin = new Date(it.startMs).getHours() * 60 + new Date(it.startMs).getMinutes();
                      const endMin = Math.max(startMin + 15, new Date(it.endMs).getHours() * 60 + new Date(it.endMs).getMinutes());
                      const top = ((startMin - HOUR_START * 60) / 60) * HOUR_PX;
                      const h = ((endMin - startMin) / 60) * HOUR_PX;
                      const c = blockColors(it, tint);
                      return (
                        <div
                          key={it.key}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isExternal(it)) {
                              if (it.href) window.open(it.href, "_blank", "noreferrer");
                            } else {
                              openItem(it);
                            }
                          }}
                          title={timeLabel(it) + " · " + it.title + (it.location ? " · " + it.location : "") + (it.drive?.tight ? " · " + it.drive.tight : "")}
                          style={{
                            position: "absolute",
                            top,
                            height: Math.max(16, h),
                            left: `calc(${(col / cols) * 100}% + 2px)`,
                            width: `calc(${100 / cols}% - 4px)`,
                            background: c.bg,
                            border: `1px ${isDrive(it) ? "dashed" : "solid"} ${c.bd}`,
                            color: c.ink,
                            borderRadius: 5,
                            padding: "2px 5px",
                            fontSize: 10.5,
                            fontWeight: 600,
                            overflow: "hidden",
                            pointerEvents: "auto",
                            cursor: isGoogle(it) || (isExternal(it) && it.href) ? "pointer" : "default",
                          }}
                        >
                          {timeLabel(it)} {it.title}
                          {isDrive(it) && it.drive?.minutes != null ? ` · ${fmtDur(it.drive.minutes)}` : ""}
                          {it.drive?.tight && <div style={{ fontWeight: 700 }}>{it.drive.tight}</div>}
                          {it.addressFlag && <div><AddressFlagBadge flag={it.addressFlag} compact /></div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>Calendar</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>
            {calendarOn
              ? "Your Google Calendar + your Peak site visits. Drive time between stops is added automatically."
              : gmailOn
                ? "Showing your Peak site visits — Enable calendar on your mailbox (Account settings) to see Google Calendar here. Drive time between stops is added automatically."
                : "Showing your Peak site visits. Google Calendar arrives once Gmail is connected. Drive time between stops is added automatically."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}>
            {(["month", "week", "day"] as const).map((v) => (
              <Link
                key={v}
                href={switchViewHref(v)}
                className={view === v ? "pk-btn-accent" : "pk-btn-outline"}
                style={{ textDecoration: "none", fontSize: 12, padding: "5px 11px", border: "none", borderRadius: 0, textTransform: "capitalize" }}
              >
                {v}
              </Link>
            ))}
          </div>
          <Link href={prevHref()} className="pk-btn-outline" style={{ textDecoration: "none", fontSize: 13 }}>
            ‹
          </Link>
          <span style={{ fontSize: 15, fontWeight: 700, minWidth: 150, textAlign: "center" }}>{headerTitle}</span>
          <Link href={nextHref()} className="pk-btn-outline" style={{ textDecoration: "none", fontSize: 13 }}>
            ›
          </Link>
          <Link href={todayHref} className="pk-btn-outline" style={{ textDecoration: "none", fontSize: 12.5 }}>
            Today
          </Link>
          {calendarOn && (
            <button
              className="pk-btn-accent"
              style={{ fontSize: 12.5 }}
              onClick={() => openCreateAt(dateY, dateM, dateD, 9)}
            >
              + Add event
            </button>
          )}
          {/* D148 — opens the filter rail: connect additional Google
              accounts and toggle/color their calendars. Shows a count badge
              once at least one is connected so the affordance isn't hidden
              behind a plain label. */}
          <button
            className="pk-btn-outline"
            style={{ fontSize: 12.5 }}
            onClick={() => setRailOpen(true)}
          >
            Calendars{calendarConnections.length > 0 ? ` (${calendarConnections.length})` : ""}
          </button>
          {/* #215 — whose tasks float on the calendar */}
          <div
            title="Whose tasks show on the calendar"
            style={{ display: "flex", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}
          >
            <Link
              href={hereHref}
              className={!tasksEveryone ? "pk-btn-accent" : "pk-btn-outline"}
              style={{ textDecoration: "none", fontSize: 12, padding: "5px 11px", border: "none", borderRadius: 0 }}
            >
              My tasks
            </Link>
            <Link
              href={`${hereHref}&tasks=all`}
              className={tasksEveryone ? "pk-btn-accent" : "pk-btn-outline"}
              style={{ textDecoration: "none", fontSize: 12, padding: "5px 11px", border: "none", borderRadius: 0 }}
            >
              Everyone
            </Link>
          </div>
        </div>
      </div>

      {modalTarget && <EventModal target={modalTarget} onClose={() => setModalTarget(null)} />}
      <CalendarFilterRail
        open={railOpen}
        onClose={() => setRailOpen(false)}
        connections={calendarConnections}
        canConnect={canConnectCalendar}
        connectHref="/api/gmail/connect?purpose=calendar-connect"
      />

      {view === "month" ? (
        <div className="pk-card" style={{ overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid #eef0f3" }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} style={{ padding: "8px 10px", fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", textAlign: "center" }}>
                {d}
              </div>
            ))}
          </div>
          {!mounted ? (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "#c4c9d2", fontSize: 12.5 }}>Loading…</div>
          ) : (
            weeks.map((week, wi) => (
              <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: wi < weeks.length - 1 ? "1px solid #f4f5f7" : "none" }}>
                {week.map((day) => {
                  const k = keyFor(day.getFullYear(), day.getMonth(), day.getDate());
                  const inMonth = day.getMonth() === month;
                  const isToday = k === todayKey;
                  const list = byDay.get(k) || [];
                  return (
                    <div
                      key={k}
                      onClick={() => openCreateAt(day.getFullYear(), day.getMonth(), day.getDate(), 9)}
                      style={{
                        minHeight: 96,
                        padding: "6px 7px",
                        borderRight: "1px solid #f4f5f7",
                        background: inMonth ? "#fff" : "#fafbfc",
                        cursor: calendarOn ? "pointer" : "default",
                        overflow: "hidden",
                      }}
                      title={calendarOn ? "Click to add an event on this day" : undefined}
                    >
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: isToday ? 700 : 500,
                          color: isToday ? "#fff" : inMonth ? "#5b616e" : "#c4c9d2",
                          background: isToday ? "var(--accent)" : "transparent",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: 20,
                          height: 20,
                          borderRadius: 10,
                          padding: "0 4px",
                          marginBottom: 3,
                        }}
                      >
                        {day.getDate()}
                      </div>
                      {renderTasks(k, 3)}
                      {(driveTotals.get(k) ?? 0) > 0 && (
                        <div style={{ fontSize: 10, color: "#5b616e", fontWeight: 600, marginBottom: 2 }}>Drive {fmtDur(driveTotals.get(k) ?? 0)}</div>
                      )}
                      {(() => {
                        const shownList = list.filter((it) => !isDrive(it) || isDriveFlag(it));
                        return (
                          <>
                            {shownList.slice(0, 3).map(renderMonthChip)}
                            {shownList.length > 3 && (
                              <div style={{ fontSize: 10, color: "#9aa0ab", fontWeight: 600 }}>+{shownList.length - 3} more</div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : view === "week" ? (
        renderTimeGrid(weekDays)
      ) : (
        renderTimeGrid([dayDate])
      )}
    </div>
  );
}
