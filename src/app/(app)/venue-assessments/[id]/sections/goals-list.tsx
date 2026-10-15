"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { goalMaxLength, goalsBudgetLeft } from "@/lib/estimate-output/goals";
import { inpStyle } from "./styles";

/* The save keeps at most 1,000 characters in all (lines joined with "\n"); the editor enforces the same total so
   nothing is cut silently on save (#344 B-final). */
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

type Pending = { kind: "input" | "up" | "down" | "add"; index: number };

/** One goal per line. Empty lines stay while editing; the save sanitizer drops them. */
export function GoalsListEditor({
  value,
  onChange,
  label = "Client goals",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  label?: string;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const ups = useRef<(HTMLButtonElement | null)[]>([]);
  const downs = useRef<(HTMLButtonElement | null)[]>([]);
  const addBtn = useRef<HTMLButtonElement | null>(null);
  const pending = useRef<Pending | null>(null);

  /* Focus lands after the parent has re-rendered with the new list. */
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    if (p.kind === "add") addBtn.current?.focus();
    else if (p.kind === "input") inputs.current[p.index]?.focus();
    else {
      const first = p.kind === "up" ? ups.current[p.index] : downs.current[p.index];
      const other = p.kind === "up" ? downs.current[p.index] : ups.current[p.index];
      /* A button that is now disabled (the goal reached an end) hands focus to its sibling. */
      if (first && !first.disabled) first.focus();
      else other?.focus();
    }
  }, [value]);

  const left = goalsBudgetLeft(value);
  /* a new goal needs at least its "\n" join and one character */
  const canAdd = value.length < MAX_GOALS && left >= 2;
  const setAt = (i: number, text: string) => onChange(value.map((g, j) => (j === i ? text : g)));
  const removeAt = (i: number) => {
    const next = value.filter((_, j) => j !== i);
    /* Next row slides into index i; the last row's removal falls back to the previous one. */
    pending.current = next.length === 0 ? { kind: "add", index: 0 } : { kind: "input", index: Math.min(i, next.length - 1) };
    onChange(next);
  };
  const insertAfter = (i: number) => {
    if (!canAdd) return;
    const next = [...value];
    next.splice(i + 1, 0, "");
    pending.current = { kind: "input", index: i + 1 };
    onChange(next);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    pending.current = { kind: d === -1 ? "up" : "down", index: j };
    onChange(next);
  };

  return (
    <div role="group" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {value.map((goal, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            value={goal}
            maxLength={goalMaxLength(value, i)}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                insertAfter(i);
              }
            }}
            style={{ ...inpStyle, flex: 1, minWidth: 0 }}
          />
          <button
            type="button"
            ref={(el) => {
              ups.current[i] = el;
            }}
            style={iconBtn}
            aria-label={`Move goal ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button
            type="button"
            ref={(el) => {
              downs.current[i] = el;
            }}
            style={iconBtn}
            aria-label={`Move goal ${i + 1} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
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
          ref={addBtn}
          disabled={!canAdd}
          onClick={() => {
            if (!canAdd) return;
            pending.current = { kind: "input", index: value.length };
            onChange([...value, ""]);
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
            cursor: canAdd ? "pointer" : "not-allowed",
            opacity: canAdd ? 1 : 0.5,
          }}
        >
          + Add goal
        </button>
        {value.length >= MAX_GOALS && (
          <span style={{ marginLeft: 10, fontSize: 12, color: "#9aa0ab" }}>Up to {MAX_GOALS} goals.</span>
        )}
        <span aria-live="polite" style={{ marginLeft: 10, fontSize: 12, color: left < 50 ? "#b4543a" : "#9aa0ab" }}>
          {left === 1 ? "1 character left" : `${left.toLocaleString("en-US")} characters left`}
        </span>
      </div>
    </div>
  );
}
