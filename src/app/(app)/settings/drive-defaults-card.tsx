"use client";

import { useState, useTransition } from "react";
import { saveDriveDefaultsAction } from "./actions";

/** Spec 2026-10-09 — company default drive buffer (used until a rep sets their own in Account). */
export function DriveDefaultsCard({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial));
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Drive time</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
        Default buffer added to every drive leg. Each person can set their own in Account.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <input
          type="number"
          min={0}
          max={120}
          className="pk-input"
          style={{ width: 80, fontSize: 12.5 }}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
        />
        <span style={{ fontSize: 12, color: "#9aa0ab" }}>min</span>
        <button
          className="pk-btn-accent"
          style={{ fontSize: 12.5 }}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await saveDriveDefaultsAction({ driveBufferMin: value });
              if (r.ok) {
                setValue(String(r.driveBufferMin));
                setSaved(true);
              }
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ fontSize: 11, color: "#1f7a52" }}>Saved</span>}
      </div>
    </div>
  );
}
