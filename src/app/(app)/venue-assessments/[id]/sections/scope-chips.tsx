"use client";

import type { CSSProperties } from "react";
import { ACCENT_INK, ACCENT_SOFT, labelStyle, taStyle } from "./styles";

const chipStyle = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 500,
  padding: "9px 13px",
  borderRadius: 20,
  cursor: "pointer",
  minHeight: 40,
  border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`,
  background: active ? ACCENT_SOFT : "#fff",
  color: active ? ACCENT_INK : "#5b616e",
});

/** Scope-of-interest chips; picking "Other" opens an explain box bound to `other`. */
export function ScopeChips({
  label,
  options,
  value,
  other,
  onChange,
  onOther,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  other: string;
  onChange: (v: string[]) => void;
  onOther: (t: string) => void;
}) {
  const toggle = (option: string) =>
    onChange(value.includes(option) ? value.filter((o) => o !== option) : [...value, option]);
  return (
    <div>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => (
          <button type="button" key={option} aria-pressed={value.includes(option)} onClick={() => toggle(option)} style={chipStyle(value.includes(option))}>
            {option}
          </button>
        ))}
      </div>
      {value.includes("Other") && (
        <div style={{ marginTop: 12 }}>
          <span style={labelStyle}>Explain the scope</span>
          <textarea value={other} maxLength={500} onChange={(e) => onOther(e.target.value)} style={taStyle} />
        </div>
      )}
    </div>
  );
}
