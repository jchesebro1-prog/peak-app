"use client";

import { useRef, type CSSProperties } from "react";
import { inpStyle } from "./styles";

/* The save sanitizer is the real limit (1,000 chars total); this only limits new typing. */
const MAX_GOALS = 20;


const iconBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 15,
  lineHeight: 1,
  color: "#5b616e",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  width: 40,
  height: 40,
  cursor: "pointer",
  flex: "none",
};

/** One goal per line. Empty lines stay while editing; the save sanitizer drops them. */
export function GoalsListEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAt = (i: number) => setTimeout(() => inputs.current[i]?.focus(), 0);

  const setAt = (i: number, text: string) => onChange(value.map((g, j) => (j === i ? text : g)));
  const removeAt = (i: number) => onChange(value.filter((_, j) => j !== i));
  const insertAfter = (i: number) => {
    if (value.length >= MAX_GOALS) return;
    const next = [...value];
    next.splice(i + 1, 0, "");
    onChange(next);
    focusAt(i + 1);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {value.map((goal, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            value={goal}
            maxLength={300}
            aria-label={`Goal ${i + 1}`}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                insertAfter(i);
              }
            }}
            style={{ ...inpStyle, flex: 1, minWidth: 0 }}
          />
          <button type="button" style={iconBtn} aria-label={`Move goal ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" style={iconBtn} aria-label={`Move goal ${i + 1} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          <button type="button" style={iconBtn} aria-label={`Remove goal ${i + 1}`} onClick={() => removeAt(i)}>
            ×
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          disabled={value.length >= MAX_GOALS}
          onClick={() => {
            onChange([...value, ""]);
            focusAt(value.length);
          }}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            fontWeight: 500,
            padding: "9px 13px",
            minHeight: 40,
            borderRadius: 20,
            border: "1px dashed #c5cad3",
            background: "#fff",
            color: "#5b616e",
            cursor: value.length >= MAX_GOALS ? "not-allowed" : "pointer",
            opacity: value.length >= MAX_GOALS ? 0.5 : 1,
          }}
        >
          + Add goal
        </button>
        {value.length >= MAX_GOALS && (
          <span style={{ marginLeft: 10, fontSize: 12, color: "#9aa0ab" }}>Up to {MAX_GOALS} goals.</span>
        )}
      </div>
    </div>
  );
}
