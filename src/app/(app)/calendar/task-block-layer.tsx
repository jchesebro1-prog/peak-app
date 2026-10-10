"use client";

/**
 * Spec 2026-10-09 auto task calendar — the task blocks of one Week/Day
 * column, drawn lighter than visits, drive blocks and Google events and
 * UNDER them (calendar-client renders this before the agenda layer). 📌 =
 * pinned; the at-risk badge reads "At risk — due Tue". Dragging a block pins
 * it by hand at the drop (15-minute steps; whole days sideways in Week view);
 * a press without movement opens the block, and Enter/Space on the focused
 * block does too (the popover has a keyboard "Move to…"). Only blocks marked
 * draggable drag; nothing drags while any plan action is pending. Positions
 * use the browser's local hours, like the agenda blocks beside them.
 */
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { dragStartMs, layoutIntervals, type CalendarPlanBlock } from "@/lib/task-plan/calendar-view";
import { pinBlockAction } from "./plan-actions";

const RISK: CSSProperties = { display: "block", marginTop: 1, fontSize: 9.5, fontWeight: 700, color: "#b4543a" };
const DRAG_THRESHOLD_PX = 4;
type Drag = { key: string; x0: number; y0: number; dx: number; dy: number; colPx: number };

function minuteOf(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function TaskBlockLayer({
  blocks,
  hourStart,
  hourPx,
  dayCount,
  showOwner,
  onOpen,
  planBusy = false,
  onBusy,
}: {
  blocks: CalendarPlanBlock[];
  hourStart: number;
  hourPx: number;
  dayCount: number;
  showOwner: boolean;
  onOpen: (b: CalendarPlanBlock) => void;
  /** Another plan action (another column, the At risk panel) is in flight. */
  planBusy?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const layerRef = useRef<HTMLDivElement>(null);
  const pressed = useRef<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = pending || planBusy;

  useEffect(() => {
    onBusy?.(pending);
  }, [pending, onBusy]);

  function drop(b: CalendarPlanBlock, d: Drag) {
    const startMs = dragStartMs({ startMs: b.startMs, dyPx: d.dy, dxPx: d.dx, hourPx, colPx: d.colPx, dayCount });
    if (startMs === b.startMs) return;
    start(async () => {
      setError(null);
      let r: { ok: true } | { ok: false; error: string };
      try {
        r = await pinBlockAction({ kind: b.kind, id: b.id, fromStartMs: b.pinned ? b.startMs : null, startMs, minutes: Math.round((b.endMs - b.startMs) / 60_000) });
      } catch {
        r = { ok: false, error: "Couldn't save — try again." };
      }
      if (!r.ok) setError(r.error);
      // Success or refusal alike (e.g. "That block moved — refresh."), redraw from the stored plan so a stale block doesn't linger.
      router.refresh();
    });
  }

  // A drag's visual: snapped to the same 15-minute / whole-day steps the drop will use.
  const snapped = (d: Drag) => ({
    x: dayCount > 1 && d.colPx > 0 ? Math.round(d.dx / d.colPx) * d.colPx : 0,
    y: hourPx > 0 ? Math.round(((d.dy / hourPx) * 60) / 15) * (hourPx / 4) : 0,
  });

  return (
    <div ref={layerRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {error && (
        <div role="alert" style={{ position: "absolute", top: 2, left: 2, right: 2, zIndex: 6, pointerEvents: "auto", fontSize: 10.5, color: "#a03b2e", background: "#fbefe9", border: "1px solid #f1d6ca", borderRadius: 5, padding: "2px 5px" }}>
          {error}
        </div>
      )}
      {layoutIntervals(blocks).map(({ it: b, col, cols }) => {
        const startMin = minuteOf(b.startMs);
        const endMin = Math.max(startMin + 15, minuteOf(b.endMs) || 24 * 60);
        const top = ((startMin - hourStart * 60) / 60) * hourPx;
        const height = Math.max(16, ((endMin - startMin) / 60) * hourPx);
        const label = `${b.pinned ? "📌 " : ""}${showOwner && b.initials ? b.initials + " · " : ""}${b.title}`;
        const mine = drag?.key === b.key ? drag : null;
        const move = mine ? snapped(mine) : null;
        return (
          <button
            key={b.key}
            type="button"
            disabled={busy}
            aria-label={`${b.title}, ${clock(b.startMs)} to ${clock(b.endMs)}${b.pinned ? ", pinned" : ""}${b.atRiskLabel ? ", " + b.atRiskLabel : ""}${b.draggable ? ". Drag to move it, or press Enter to open it" : ". Press Enter to open it"}`}
            onClick={(e) => {
              e.stopPropagation();
              if (e.detail === 0) onOpen(b); // keyboard activation; a pointer press opens on pointer-up
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              pressed.current = b.key;
              if (!b.draggable) return;
              setError(null);
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ key: b.key, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, colPx: layerRef.current?.getBoundingClientRect().width ?? 0 });
            }}
            onPointerMove={(e) => {
              if (mine) setDrag({ ...mine, dx: e.clientX - mine.x0, dy: e.clientY - mine.y0 });
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              const d = mine;
              const wasPressed = pressed.current === b.key;
              pressed.current = null;
              setDrag(null);
              if (!wasPressed) return;
              if (!d || (Math.abs(d.dx) < DRAG_THRESHOLD_PX && Math.abs(d.dy) < DRAG_THRESHOLD_PX)) {
                onOpen(b);
                return;
              }
              drop(b, d);
            }}
            onPointerCancel={() => {
              pressed.current = null;
              setDrag(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && mine) {
                pressed.current = null;
                setDrag(null);
              }
            }}
            title={label + (b.atRiskLabel ? " · " + b.atRiskLabel : "") + (b.draggable ? " · drag to pin" : "")}
            style={{
              position: "absolute",
              top,
              height,
              left: `calc(${(col / cols) * 100}% + 2px)`,
              width: `calc(${100 / cols}% - 4px)`,
              transform: move ? `translate(${move.x}px, ${move.y}px)` : undefined,
              zIndex: mine ? 5 : undefined,
              boxShadow: mine ? "0 4px 12px rgba(22,24,29,.22)" : undefined,
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
              touchAction: b.draggable ? "none" : undefined,
              userSelect: "none",
              cursor: busy ? "default" : b.draggable ? (mine ? "grabbing" : "grab") : "pointer",
              opacity: busy && !mine ? 0.75 : undefined,
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
