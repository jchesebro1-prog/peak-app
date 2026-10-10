"use client";

/**
 * Spec 2026-10-09 auto task calendar — clicking a task block opens the task:
 * Done, In progress, Unpin, and the tier/size chips. Done and In progress
 * close the real record (same actions as the #215 chip), so the Queue, bell
 * and owning record agree.
 */
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TierSizeChips from "@/components/task-plan/tier-size-chips";
import type { CalendarPlanBlock } from "@/lib/task-plan/calendar-view";
import type { TaskSize, TaskTier } from "@/lib/task-plan/types";
import { completeCalendarTaskAction } from "./task-actions";
import { markInProgressAction, setTierSizeAction, unpinBlockAction } from "./plan-actions";

type Result = { ok: true } | { ok: false; error: string };
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function TaskBlockPopover({ block, onClose }: { block: CalendarPlanBlock; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<TaskTier>(block.tier);
  const [size, setSize] = useState<TaskSize>(block.size);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      <div role="dialog" aria-modal="true" aria-label={block.title} className="pk-card" onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", padding: "16px 18px", background: "#fff" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {block.pinned ? "📌 " : ""}
          {block.href ? <Link href={block.href}>{block.title}</Link> : block.title}
        </div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>
          {clock(block.startMs)}–{clock(block.endMs)} · {block.ownerName}
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
