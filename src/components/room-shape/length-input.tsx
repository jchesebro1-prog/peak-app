"use client";

import { useEffect, useRef, useState } from "react";
import { fmtFeet } from "@/lib/design/room-shape/units";
import { decideLengthCommit } from "@/lib/design/room-shape/field-edit";

/**
 * #370: a feet-and-inches box (42'-6", 42.5, 6"); Enter or blur commits an edit, Alt+Enter passes alt, Escape reverts.
 * Only a changed draft commits. `onCommit` returns false when the edit was refused, which puts the box back on the value.
 */
export default function LengthInput({ label, value, onCommit }: { label: string; value: number; onCommit: (ft: number, alt: boolean) => boolean | void }) {
  const [draft, setDraft] = useState(fmtFeet(value));
  const [synced, setSynced] = useState(value);
  const [bad, setBad] = useState(false);
  if (value !== synced) {
    setSynced(value);
    setDraft(fmtFeet(value));
    setBad(false);
  }
  // a box that's being removed (a deselect, a parent swap) must never commit a draft the user didn't confirm
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const commit = (alt: boolean) => {
    if (!mounted.current) return;
    const d = decideLengthCommit(draft, value);
    if (d.kind === "none") return setBad(false);
    if (d.kind === "bad") return setBad(true);
    setBad(false);
    setDraft(fmtFeet(d.ft));
    if (d.kind === "commit" && onCommit(d.ft, alt) === false) setDraft(fmtFeet(value));
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
          if (e.key === "Escape") { e.stopPropagation(); setDraft(fmtFeet(value)); setBad(false); }
        }}
        style={{ width: 86, fontFamily: "var(--font-mono), IBM Plex Mono, monospace", fontSize: 12, padding: "5px 7px", border: `1px solid ${bad ? "#b4543a" : "#e4e7ec"}`, borderRadius: 6 }}
      />
    </label>
  );
}
