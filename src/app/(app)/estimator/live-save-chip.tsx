"use client";

import { chipLabel, conflictMessage, LIVE_COPY } from "@/lib/estimate-live-save/copy";
import type { LiveSaveApi } from "./use-live-save";
import type { EstimateUndoApi } from "./use-estimate-undo";

const CHIP = { fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 8, padding: "9px 15px" } as const;

/** Replaces Save on a live-save estimate. Clicking it saves now, or retries a failed save. */
export function LiveSaveChip({ live }: { live: LiveSaveApi }) {
  const { status, refusal } = live;
  const bad = status === "failed" || status === "refused" || status === "conflict";
  const clickable = status === "dirty" || status === "failed";
  return (
    <button
      type="button"
      data-testid="live-save-chip"
      data-status={status}
      title={refusal ?? undefined}
      disabled={!clickable}
      onClick={() => (status === "failed" ? live.retryNow() : void live.flush())}
      style={{
        ...CHIP,
        cursor: clickable ? "pointer" : "default",
        ...(bad ? { background: "#3a2422", color: "#f0a59b" } : status === "saved" ? { background: "#22361f", color: "#5fd29a" } : { background: "#2b2e35", color: "#cfd3da" }),
      }}
    >
      {chipLabel(status)}
    </button>
  );
}

const ICON = { ...CHIP, padding: "9px 11px", background: "#2b2e35", color: "#cfd3da" } as const;

export function UndoRedoButtons({ undo }: { undo: EstimateUndoApi }) {
  return (
    <>
      <button
        type="button"
        data-testid="est-undo"
        aria-label="Undo"
        disabled={!undo.canUndo}
        onClick={undo.undo}
        title={undo.undoLabel ? `Undo: ${undo.undoLabel}` : LIVE_COPY.historyEmpty}
        style={{ ...ICON, opacity: undo.canUndo ? 1 : 0.45, cursor: undo.canUndo ? "pointer" : "not-allowed" }}
      >
        ↶
      </button>
      <button
        type="button"
        data-testid="est-redo"
        aria-label="Redo"
        disabled={!undo.canRedo}
        onClick={undo.redo}
        title={undo.redoLabel ? `Redo: ${undo.redoLabel}` : LIVE_COPY.redoEmpty}
        style={{ ...ICON, opacity: undo.canRedo ? 1 : 0.45, cursor: undo.canRedo ? "pointer" : "not-allowed" }}
      >
        ↷
      </button>
    </>
  );
}

export function LiveConflictBanner({ live }: { live: LiveSaveApi }) {
  if (!live.conflict) return null;
  return (
    <div role="alert" data-testid="live-conflict" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "9px 22px", background: "#fdecea", color: "#9a2f22", fontSize: 12.5, borderBottom: "1px solid #f3c8c2", flexShrink: 0 }}>
      <span style={{ flex: "1 1 280px", fontWeight: 600 }}>{conflictMessage(live.conflict)}</span>
      <button type="button" data-testid="live-conflict-reload" title={LIVE_COPY.reloadHint} onClick={live.reload} style={{ fontWeight: 600, cursor: "pointer" }}>{LIVE_COPY.reload}</button>
      <button type="button" data-testid="live-conflict-keep" title={LIVE_COPY.keepMineHint} onClick={live.keepMine} style={{ fontWeight: 600, cursor: "pointer" }}>{LIVE_COPY.keepMine}</button>
    </div>
  );
}
