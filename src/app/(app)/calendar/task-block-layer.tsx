"use client";

/**
 * Spec 2026-10-09 auto task calendar — the task blocks of one Week/Day
 * column, drawn lighter than visits, drive blocks and Google events and
 * UNDER them (calendar-client renders this before the agenda layer). 📌 =
 * pinned; the at-risk badge reads "At risk — due Tue". Positions use the
 * browser's local hours, like the agenda blocks beside them.
 */
import type { CSSProperties } from "react";
import { layoutIntervals, type CalendarPlanBlock } from "@/lib/task-plan/calendar-view";

const RISK: CSSProperties = { display: "block", marginTop: 1, fontSize: 9.5, fontWeight: 700, color: "#b4543a" };

function minuteOf(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

export default function TaskBlockLayer({
  blocks,
  hourStart,
  hourPx,
  dayCount,
  showOwner,
  onOpen,
}: {
  blocks: CalendarPlanBlock[];
  hourStart: number;
  hourPx: number;
  dayCount: number;
  showOwner: boolean;
  onOpen: (b: CalendarPlanBlock) => void;
}) {
  void dayCount; // used by drag (Task 10)
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {layoutIntervals(blocks).map(({ it: b, col, cols }) => {
        const startMin = minuteOf(b.startMs);
        const endMin = Math.max(startMin + 15, minuteOf(b.endMs) || 24 * 60);
        const top = ((startMin - hourStart * 60) / 60) * hourPx;
        const height = Math.max(16, ((endMin - startMin) / 60) * hourPx);
        const label = `${b.pinned ? "📌 " : ""}${showOwner && b.initials ? b.initials + " · " : ""}${b.title}`;
        return (
          <button
            key={b.key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(b);
            }}
            title={label + (b.atRiskLabel ? " · " + b.atRiskLabel : "")}
            style={{
              position: "absolute",
              top,
              height,
              left: `calc(${(col / cols) * 100}% + 2px)`,
              width: `calc(${100 / cols}% - 4px)`,
              textAlign: "left",
              background: "color-mix(in srgb, var(--accent) 9%, #fff)",
              border: `1px dashed ${b.atRiskLabel ? "#e0b2a3" : "color-mix(in srgb, var(--accent) 40%, #fff)"}`,
              color: "#3a3f4a",
              borderRadius: 5,
              padding: "2px 5px",
              fontFamily: "var(--font-ui)",
              fontSize: 10.5,
              fontWeight: 600,
              overflow: "hidden",
              pointerEvents: "auto",
              cursor: "pointer",
            }}
          >
            {label}
            {b.atRiskLabel && <span style={RISK}>{b.atRiskLabel}</span>}
          </button>
        );
      })}
    </div>
  );
}
