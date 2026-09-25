"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setValueAction, resetItemAction } from "@/app/(app)/estimating-rules/actions";

/**
 * "Install labor per device" card (Grid Settings build) — the one editable
 * field for pricing.ts GROUPS' "grid" group (grid.laborHoursPerDevice).
 * Deliberately reuses Estimating Rules' own server actions
 * (setValueAction/resetItemAction) rather than a new store: this rate is
 * ALSO editable from /estimating-rules (it is a normal registered rate,
 * store: "general"), and the two screens must never drift onto separate
 * write paths for the same key.
 */

const RATE_ID = "grid.laborHoursPerDevice";

export function LaborHoursCard({ value, def }: { value: number; def: number }) {
  const router = useRouter();
  const [draft, setDraft] = useState(String(value));
  const [saved, setSaved] = useState(String(value));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 8;
  const dirty = draft.trim() !== saved;

  const onSave = () => {
    if (!valid) {
      setError("Enter a number of hours between 0 and 8.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setValueAction(RATE_ID, parsed);
      if (!res.ok) {
        setError("Save failed — please try again.");
        return;
      }
      setSaved(draft.trim());
      setJustSaved(true);
      router.refresh();
    });
  };

  const onReset = () => {
    setError(null);
    startTransition(async () => {
      const res = await resetItemAction(RATE_ID);
      if (!res.ok) {
        setError("Reset failed — please try again.");
        return;
      }
      setDraft(String(def));
      setSaved(String(def));
      setJustSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Install labor per device</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
          Hours of install labor The Grid suggests per placed device, before any per-part override.
          Also editable from Estimating Rules — same rate, same value everywhere.
        </div>
      </div>
      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="number"
            min={0}
            max={8}
            step={0.05}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setJustSaved(false);
              setError(null);
            }}
            aria-label="Install labor hours per device"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              border: "1px solid #e4e7ec",
              borderRadius: 8,
              padding: "7px 10px",
              width: 100,
            }}
          />
          <span style={{ color: "#5b616e" }}>hr / device</span>
        </label>
        <button type="button" className="pk-btn-accent" disabled={!dirty || !valid || pending} onClick={onSave}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="pk-btn-outline" disabled={pending} onClick={onReset}>
          Reset to default ({def} hr)
        </button>
        {justSaved && !dirty && <span style={{ fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</span>}
      </div>
      {error && (
        <div style={{ margin: "0 18px 14px", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          {error}
        </div>
      )}
    </div>
  );
}
