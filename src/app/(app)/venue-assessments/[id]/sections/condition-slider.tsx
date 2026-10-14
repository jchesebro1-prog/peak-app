"use client";

import type { CSSProperties } from "react";
import { CONDITION_STEPS, isConditionLevel, type ConditionLevel } from "@/lib/field-lists";
import { labelStyle } from "./styles";

const linkBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 500,
  color: "#5b616e",
  background: "none",
  border: "none",
  padding: "8px 4px",
  minHeight: 40,
  cursor: "pointer",
  textDecoration: "underline",
};

/** Bad → New, stored as 0–4. Unset (undefined) shows a ghost "Not rated" track until touched. */
export function ConditionSlider({
  value,
  onChange,
  label,
  compact,
}: {
  value: ConditionLevel | undefined;
  onChange: (v: ConditionLevel | undefined) => void;
  label: string;
  compact?: boolean;
}) {
  const rated = isConditionLevel(value);
  const step = rated ? CONDITION_STEPS[value] : "Not rated";
  const colour = rated ? `var(--cond-${value})` : "#c5cad3";
  return (
    <div style={{ minWidth: 0 }}>
      {!compact && <span style={labelStyle}>{label}</span>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input
          type="range"
          min={0}
          max={4}
          step={1}
          value={rated ? value : 2}
          aria-label={label}
          aria-valuetext={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (isConditionLevel(n)) onChange(n);
          }}
          style={{
            flex: "1 1 140px",
            minWidth: 120,
            minHeight: 40,
            accentColor: colour,
            opacity: rated ? 1 : 0.45,
            cursor: "pointer",
          }}
        />
        <span
          style={{
            minWidth: 64,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            color: rated ? colour : "#9aa0ab",
          }}
        >
          {step}
        </span>
        {rated ? (
          <button type="button" style={linkBtn} onClick={() => onChange(undefined)}>
            Clear
          </button>
        ) : (
          <button type="button" style={linkBtn} onClick={() => onChange(2)}>
            Rate
          </button>
        )}
      </div>
    </div>
  );
}
