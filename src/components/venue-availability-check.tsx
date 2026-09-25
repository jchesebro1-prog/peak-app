"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getVenueAvailabilityAction, type VenueAvailabilityResult } from "@/app/(app)/venue-calendar-actions";
import { DAY_MS, type AvailWindow } from "@/lib/venue-availability";

/**
 * "Pops up their calendar" (Jeff's ask) — a debounced, non-blocking panel
 * that answers "does the venue's own calendar show this time open?" as
 * soon as a scheduler's date field has a value. It only ever WARNS: nothing
 * here disables the Save/Schedule button, so a venue with no calendar on
 * file (the common case, at least until PMs start filling these in) never
 * gets in anyone's way.
 *
 * Every scheduling popover that knows its venue's locationId renders this
 * the same way: flame tests, inspections, repairs, the crew board booking
 * popover, and the site-visit modal.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseLocalInput(v: string): number | null {
  if (!v) return null;
  const d = new Date(DATE_ONLY.test(v) ? v + "T00:00:00" : v);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** A date-only start with no end covers the whole local day (the flame/
 *  inspections/repairs/crew schedulers all pass exactly this); a bare
 *  datetime with no end defaults to a 1-hour window. */
function computeRange(start: string, end?: string): { start: number; end: number } | null {
  const s = parseLocalInput(start);
  if (s == null) return null;
  if (end) {
    const e = parseLocalInput(end);
    if (e == null || e <= s) return null;
    return { start: s, end: e };
  }
  return { start: s, end: s + (DATE_ONLY.test(start) ? DAY_MS : 3600000) };
}

function fmtTime(ms: number, allDay: boolean): string {
  if (allDay) return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtRange(w: { start: number; end: number; allDay: boolean }): string {
  const start = fmtTime(w.start, w.allDay);
  const end = fmtTime(w.allDay ? w.end - DAY_MS : w.end, w.allDay);
  return start === end ? start : `${start}–${end}`;
}

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

function weekStartOf(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

function WeekStrip({ pickedStart, windows }: { pickedStart: number; windows: AvailWindow[] }) {
  const weekStart = weekStartOf(pickedStart);
  const pickedDay = new Date(pickedStart).setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => weekStart + i * DAY_MS);
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
      {days.map((dayStart) => {
        const dayEnd = dayStart + DAY_MS;
        const hits = windows.filter((w) => w.start < dayEnd && w.end > dayStart);
        const blocked = hits.some((w) => w.kind === "blocked");
        const open = hits.some((w) => w.kind === "open");
        const isPicked = dayStart === pickedDay;
        const bg = blocked ? "#f8ece7" : open ? "#e7f4ee" : "#f4f5f7";
        const bd = blocked ? "#eccfc4" : open ? "#cfe6db" : "#e4e7ec";
        const dot = blocked ? "#b4543a" : open ? "#1f7a52" : "transparent";
        return (
          <div
            key={dayStart}
            title={new Date(dayStart).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "5px 2px 6px",
              borderRadius: 7,
              background: bg,
              border: `1px solid ${isPicked ? "var(--accent)" : bd}`,
              boxShadow: isPicked ? "0 0 0 1px var(--accent) inset" : "none",
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 700, color: "#9aa0ab" }}>{WEEKDAY[new Date(dayStart).getDay()]}</div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "#5b616e", marginTop: 1 }}>{new Date(dayStart).getDate()}</div>
            <div style={{ width: 5, height: 5, borderRadius: 5, background: dot, margin: "3px auto 0" }} />
          </div>
        );
      })}
    </div>
  );
}

export function VenueAvailabilityCheck({
  locationId,
  start,
  end,
  compact,
}: {
  locationId: string | null;
  start: string;
  end?: string;
  compact?: boolean;
}) {
  const [result, setResult] = useState<VenueAvailabilityResult | null>(null);
  const [pickedStart, setPickedStart] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // No synchronous setState in the effect body (react-hooks/set-state-in-
  // effect) — same discipline as the venue-locate-drawer's own debounced
  // type-ahead (src/app/(app)/settings/venue-locate-drawer.tsx): every
  // state write happens inside the debounce timer's callback, gated by a
  // `live` flag plus the request-id ref (so a fast-changing date field
  // never lets a stale response overwrite a newer one).
  useEffect(() => {
    const range = locationId ? computeRange(start, end) : null;
    // No fetch to make (no venue, or the field isn't a full date/datetime
    // yet) — nothing external to synchronize with, so this effect simply
    // does nothing rather than resetting state on its own; the render
    // below already treats "no current range" as "show nothing",
    // regardless of whatever an earlier valid range last fetched.
    if (!range) return;
    const id = ++reqId.current;
    let live = true;
    const timer = setTimeout(() => {
      if (!live) return;
      setLoading(true);
      getVenueAvailabilityAction(locationId, range.start, range.end)
        .then((r) => {
          if (!live || reqId.current !== id) return; // a newer request landed first
          setResult(r);
          setPickedStart(range.start);
          setLoading(false);
        })
        .catch(() => {
          if (!live || reqId.current !== id) return;
          setResult(null);
          setLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [locationId, start, end]);

  if (!locationId) return null;
  if (!computeRange(start, end)) return null;
  if (!result) {
    return loading ? (
      <div style={{ marginTop: 8, fontSize: 11.5, color: "#aab0bb" }}>Checking venue calendar…</div>
    ) : null;
  }

  let line: string;
  let tone: "ok" | "warn" | "muted" = "muted";
  if (!result.hasCalendar) {
    tone = "muted";
    line = "No venue calendar on file";
  } else if (result.check.status === "conflict") {
    tone = "warn";
    const c = result.check.conflicts[0];
    line = `Venue is blocked: ${c.label || "Busy"} (${fmtRange(c)})`;
  } else if (result.check.status === "outside-open") {
    tone = "warn";
    line = "Outside the venue's open times";
  } else if (result.check.status === "available") {
    tone = "ok";
    line = "Venue calendar shows this time open";
  } else {
    tone = "muted";
    line = "Venue calendar has no data for this date";
  }

  const color = tone === "warn" ? "#b4543a" : tone === "ok" ? "#1f7a52" : "#9aa0ab";
  const icon = tone === "warn" ? "⚠" : tone === "ok" ? "✓" : "";

  return (
    <div style={{ marginTop: compact ? 6 : 10, fontSize: compact ? 11.5 : 12.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color, fontWeight: 600 }}>
        {icon && <span aria-hidden>{icon}</span>}
        <span>{line}</span>
        {!result.hasCalendar && result.venueHref && (
          <Link href={result.venueHref} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
            · Add one
          </Link>
        )}
      </div>
      {!compact && result.hasCalendar && pickedStart != null && (
        <WeekStrip pickedStart={pickedStart} windows={result.windows} />
      )}
    </div>
  );
}
