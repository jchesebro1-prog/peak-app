"use client";

import type { CSSProperties } from "react";
import { ESTIMATE_STEPS, STEP_LABEL, type EstimateStep } from "@/lib/estimate-steps/steps";
import type { StepBadge } from "@/lib/estimate-steps/readiness";

/** #305 — the four step tabs under the header; the line under each is its readiness. */
const BADGE_INK: Record<StepBadge["state"], string> = { ok: "#1f8a5b", gaps: "#b7791f", idle: "#8c919c" };

export function StepTabs({ step, badges, onStep }: { step: EstimateStep; badges: Record<EstimateStep, StepBadge>; onStep: (s: EstimateStep) => void }) {
  return (
    <nav aria-label="Estimate steps" className="est-steps" style={{ display: "flex", background: "#23262d", borderTop: "1px solid #2b2e35", flexShrink: 0 }}>
      {ESTIMATE_STEPS.map((k, i) => {
        const active = k === step;
        const b = badges[k];
        const style: CSSProperties = {
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          padding: "8px 16px",
          border: "none",
          borderRight: "1px solid #1d2026",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          background: active ? "#f7f8fa" : "transparent",
          color: active ? "#16181d" : "#9aa0ab",
        };
        return (
          <button key={k} type="button" aria-current={active ? "page" : undefined} onClick={() => onStep(k)} style={style}>
            <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {i + 1} · {STEP_LABEL[k]}
            </div>
            <div style={{ fontSize: 10.5, color: BADGE_INK[b.state], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</div>
          </button>
        );
      })}
    </nav>
  );
}
