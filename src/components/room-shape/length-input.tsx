"use client";

import { useState } from "react";
import { fmtFeet, parseFeet } from "@/lib/design/room-shape/units";

/** #370: a feet-and-inches box (42'-6", 42.5, 6"); Enter or blur commits, Alt+Enter passes alt, Escape reverts. */
export default function LengthInput({ label, value, onCommit }: { label: string; value: number; onCommit: (ft: number, alt: boolean) => void }) {
  const [draft, setDraft] = useState(fmtFeet(value));
  const [synced, setSynced] = useState(value);
  const [bad, setBad] = useState(false);
  if (value !== synced) {
    setSynced(value);
    setDraft(fmtFeet(value));
    setBad(false);
  }
  const commit = (alt: boolean) => {
    const ft = parseFeet(draft);
    if (ft === null) return setBad(true);
    setBad(false);
    setDraft(fmtFeet(ft));
    if (Math.abs(ft - value) > 1e-6) onCommit(ft, alt);
  };
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 }}>
      {label}
      <input
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(e.altKey); }
          if (e.key === "Escape") { setDraft(fmtFeet(value)); setBad(false); }
        }}
        style={{ width: 86, fontFamily: "var(--font-mono), IBM Plex Mono, monospace", fontSize: 12, padding: "5px 7px", border: `1px solid ${bad ? "#b4543a" : "#e4e7ec"}`, borderRadius: 6 }}
      />
    </label>
  );
}
