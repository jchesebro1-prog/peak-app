"use client";

import { useState } from "react";

/** An exact-feet readout (#244): type any whole number; it clamps to [min, max] on Enter / blur. */
export default function FeetInput({ label, min, max, value, onCommit }: { label: string; min: number; max: number; value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = Math.round(Number(draft));
    const next = Number.isFinite(n) && draft.trim() !== "" ? Math.max(min, Math.min(max, n)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", color: "#737985" }}>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        aria-label={`${label} in feet`}
        style={{ width: 56, border: "1px solid #e4e7ec", borderRadius: 6, padding: "3px 6px", fontFamily: "var(--font-mono)", fontSize: 12, color: "#16181d", textAlign: "right", background: "#fff" }}
      />
      ft
    </span>
  );
}
