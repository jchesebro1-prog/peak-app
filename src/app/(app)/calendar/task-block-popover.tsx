"use client";

/**
 * Spec 2026-10-09 auto task calendar — clicking a task block opens the task:
 * Done, In progress, Unpin, and the tier/size chips. Done and In progress
 * close the real record (same actions as the #215 chip), so the Queue, bell
 * and owning record agree. A draggable block also gets a keyboard "Move to…"
 * (the same pin as a drag). Focus moves into the dialog on open, Tab stays
 * inside it, and focus returns to the block that opened it on close.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TierSizeChips from "@/components/task-plan/tier-size-chips";
import { clockText, localInputToMs, msToLocalInput, pinArgs, type CalendarPlanBlock } from "@/lib/task-plan/calendar-view";
import { BLOCK_MOVED_ERROR, type TaskSize, type TaskTier } from "@/lib/task-plan/types";
import { completeCalendarTaskAction } from "./task-actions";
import { markInProgressAction, pinBlockAction, setTierSizeAction, unpinBlockAction } from "./plan-actions";

type Result = { ok: true } | { ok: false; error: string };

export default function TaskBlockPopover({ block, onClose }: { block: CalendarPlanBlock; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<TaskTier>(block.tier);
  const [size, setSize] = useState<TaskSize>(block.size);

  const [moveTo, setMoveTo] = useState(() => msToLocalInput(block.startMs));
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus into the dialog on open; hand it back to the opener on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      // Keep Tab inside the dialog.
      const tabbable = [...dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])")];
      if (!tabbable.length) return;
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const moveMs = localInputToMs(moveTo);

  const run = (fn: () => Promise<Result>, close: boolean, onFail?: () => void) =>
    start(async () => {
      setError(null);
      let r: Result;
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: "Couldn't save — try again." };
      }
      if (!r.ok) {
        // The block isn't where this popover thinks it is: nothing here can act on it any more, so close and redraw.
        if (r.error === BLOCK_MOVED_ERROR) {
          onClose();
          router.refresh();
          return;
        }
        setError(r.error);
        onFail?.();
        return;
      }
      if (close) onClose();
      router.refresh();
    });

  const ref = { kind: block.kind, id: block.id };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(22,24,29,.18)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={block.title} className="pk-card" onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", padding: "16px 18px", background: "#fff", outline: "none" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {block.pinned ? "📌 " : ""}
          {block.href ? <Link href={block.href}>{block.title}</Link> : block.title}
        </div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>
          {clockText(block.startMs)}–{clockText(block.endMs)} · {block.ownerName}
          {block.kind === "assignment" ? " · Queue" : ""}
          {block.inProgress ? " · In progress" : ""}
        </div>
        {block.atRiskLabel && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#b4543a" }}>{block.atRiskLabel}</div>}
        <div style={{ marginTop: 12 }}>
          <TierSizeChips
            tier={tier}
            size={size}
            disabled={pending}
            onTier={(t) => {
              const prev = tier;
              setTier(t);
              run(() => setTierSizeAction({ ...ref, priority: t }), false, () => setTier(prev));
            }}
            onSize={(s) => {
              const prev = size;
              setSize(s);
              run(() => setTierSizeAction({ ...ref, size: s }), false, () => setSize(prev));
            }}
          />
        </div>
        {block.draggable && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "#5b616e", display: "inline-flex", gap: 6, alignItems: "center" }}>
              Move to…
              <input type="datetime-local" step={900} value={moveTo} disabled={pending} onChange={(e) => setMoveTo(e.target.value)} style={{ fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 7, padding: "3px 6px" }} />
            </label>
            <button
              type="button"
              className="pk-btn-outline"
              style={{ fontSize: 11.5, padding: "4px 9px" }}
              disabled={pending || moveMs == null || moveMs === block.startMs}
              onClick={() =>
                moveMs != null &&
                run(() => pinBlockAction(pinArgs(block, moveMs)), true, () => router.refresh())
              }
            >
              Move
            </button>
          </div>
        )}
        {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "#a03b2e" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <button type="button" className="pk-btn-accent" disabled={pending} onClick={() => run(() => completeCalendarTaskAction(block.kind, block.id), true)}>
            Done
          </button>
          {block.kind === "task" && !block.inProgress && (
            <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => markInProgressAction(ref), true)}>
              In progress
            </button>
          )}
          {block.canUnpin && (
            <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => unpinBlockAction({ ...ref, startMs: block.startMs }), true)}>
              Unpin
            </button>
          )}
          <button type="button" className="pk-btn-outline" onClick={onClose} style={{ marginLeft: "auto" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
