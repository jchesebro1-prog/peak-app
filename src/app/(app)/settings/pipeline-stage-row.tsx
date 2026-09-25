"use client";

import type { PipelineStage } from "@/lib/pipelines";

/**
 * One stage row inside a Settings → Pipelines pipeline block (Task 7) — split
 * out of pipelines-card.tsx to keep that file under the review size guide.
 * Generic over the stage's tag type so the same row renders both project
 * stages (ProjectTag, with the advance-on-delivered checkbox) and quote
 * stages (QuoteTag, without it).
 */

const inS: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  background: "#fff",
  outline: "none",
  width: "100%",
};

const iconBtnS: React.CSSProperties = {
  width: 26,
  height: 26,
  border: "1px solid #e4e7ec",
  background: "#fff",
  borderRadius: 7,
  color: "#5b616e",
  fontSize: 12,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

export function PipelineStageRow<T extends string>({
  stage,
  tags,
  tagLabel,
  isProject,
  usageCount,
  canMoveUp,
  canMoveDown,
  onPatch,
  onMoveUp,
  onMoveDown,
  onRemove,
  onRequestMove,
  moverPanel,
}: {
  stage: PipelineStage<T>;
  tags: readonly T[];
  tagLabel: (t: T) => string;
  isProject: boolean;
  usageCount: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPatch: (patch: Partial<PipelineStage<T>>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onRequestMove: () => void;
  /** Rendered under the row when this stage's "Move records…" panel is open. */
  moverPanel?: React.ReactNode;
}) {
  const inUse = usageCount > 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isProject ? "1fr 130px 168px auto auto" : "1fr 130px auto auto",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          value={stage.label}
          onChange={(e) => onPatch({ label: e.target.value } as Partial<PipelineStage<T>>)}
          placeholder="Stage name"
          aria-label="Stage name"
          style={{ ...inS, fontWeight: 600 }}
        />
        <select
          value={stage.tag}
          onChange={(e) => onPatch({ tag: e.target.value as T } as Partial<PipelineStage<T>>)}
          aria-label="Status"
          style={{ ...inS, cursor: "pointer" }}
        >
          {tags.map((t) => (
            <option key={t} value={t}>
              {tagLabel(t)}
            </option>
          ))}
        </select>
        {isProject && (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 10.5, lineHeight: 1.25, color: "#5b616e", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!stage.advanceOnDelivered}
              onChange={(e) => onPatch({ advanceOnDelivered: e.target.checked } as Partial<PipelineStage<T>>)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            Advance when all deliveries arrive
          </label>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" disabled={!canMoveUp} onClick={onMoveUp} aria-label="Move stage up" style={{ ...iconBtnS, opacity: canMoveUp ? 1 : 0.35, cursor: canMoveUp ? "pointer" : "not-allowed" }}>
            ↑
          </button>
          <button type="button" disabled={!canMoveDown} onClick={onMoveDown} aria-label="Move stage down" style={{ ...iconBtnS, opacity: canMoveDown ? 1 : 0.35, cursor: canMoveDown ? "pointer" : "not-allowed" }}>
            ↓
          </button>
        </div>
        {inUse ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              disabled
              title={`${usageCount} record${usageCount === 1 ? "" : "s"} still on this stage — move them first`}
              aria-label="Remove stage (blocked — records still on this stage)"
              style={{ ...iconBtnS, width: 30, height: 30, color: "#c4c9d2", fontSize: 15, cursor: "not-allowed", opacity: 0.5 }}
            >
              ×
            </button>
            <button
              type="button"
              onClick={onRequestMove}
              title="Move the records on this stage to another stage of this pipeline"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 7, padding: "5px 8px", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {usageCount} record{usageCount === 1 ? "" : "s"}
            </button>
          </div>
        ) : (
          <button type="button" onClick={onRemove} title="Remove stage" aria-label="Remove stage" style={{ ...iconBtnS, width: 30, height: 30, color: "#c4c9d2", fontSize: 15 }}>
            ×
          </button>
        )}
      </div>
      {moverPanel}
    </div>
  );
}
