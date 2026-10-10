"use client";

/**
 * Spec 2026-10-09 auto task calendar — the two optional chip rows every task
 * form gets: High / Normal / Low and S / M / L (blank = Normal, M).
 */
import type { CSSProperties } from "react";
import { SIZE_HINT, SIZE_LABEL, TASK_SIZES, TASK_TIERS, TIER_LABEL, type TaskSize, type TaskTier } from "@/lib/task-plan/types";

const chip = (on: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 8px",
  border: "none",
  borderLeft: "1px solid #e4e7ec",
  background: on ? "var(--accent)" : "#fff",
  color: on ? "#fff" : "#5b616e",
  cursor: "pointer",
});
const group: CSSProperties = { display: "inline-flex", border: "1px solid #e4e7ec", borderRadius: 7, overflow: "hidden" };

export default function TierSizeChips({
  tier,
  size,
  onTier,
  onSize,
  disabled = false,
}: {
  tier: TaskTier;
  size: TaskSize;
  onTier: (t: TaskTier) => void;
  onSize: (s: TaskSize) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <div role="group" aria-label="Priority" style={group}>
        {TASK_TIERS.map((t, i) => (
          <button key={t} type="button" aria-pressed={tier === t} disabled={disabled} onClick={() => onTier(t)} style={{ ...chip(tier === t), borderLeft: i ? chip(false).borderLeft : "none" }}>
            {TIER_LABEL[t]}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Size" style={group}>
        {TASK_SIZES.map((s, i) => (
          <button key={s} type="button" aria-pressed={size === s} disabled={disabled} title={SIZE_HINT[s]} onClick={() => onSize(s)} style={{ ...chip(size === s), borderLeft: i ? chip(false).borderLeft : "none" }}>
            {SIZE_LABEL[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
