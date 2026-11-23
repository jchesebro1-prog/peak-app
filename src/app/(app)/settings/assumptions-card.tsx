"use client";

import { useState } from "react";
import { saveConsultingAssumptionsAction } from "./actions";
import { inputStyle, type Run } from "./groups/shared";

/**
 * Settings → Sales → Assumptions library: the standard assumptions the
 * Estimator offers as a checklist on an estimate. One per line; an empty
 * list falls back to the built-in defaults. (Moved here from the removed
 * Consulting group — the card and its stored key are unchanged.)
 */
export function AssumptionsCard({ assumptions, run }: { assumptions: string[]; run: Run }) {
  const [draft, setDraft] = useState(assumptions.join("\n"));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = () =>
    run(async () => {
      const res = await saveConsultingAssumptionsAction(
        draft
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (res.ok) {
        setDirty(false);
        setSaved(true);
      }
      return res;
    });
  return (
    <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Assumptions library</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
            The standard assumptions offered as a checklist on an estimate. One per line; the lines ticked on an
            estimate print on it.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {saved && !dirty && <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>}
          <button className="pk-btn-accent" onClick={save} disabled={!dirty} style={{ opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" }}>
            Save assumptions
          </button>
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
          setSaved(false);
        }}
        spellCheck={false}
        style={{ ...inputStyle, marginTop: 14, minHeight: 170, maxWidth: 640, resize: "vertical", lineHeight: 1.6, fontFamily: "var(--font-mono)", fontSize: 12.5 }}
      />
    </section>
  );
}
