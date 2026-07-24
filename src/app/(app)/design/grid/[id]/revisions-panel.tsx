"use client";

import { useState } from "react";
import type { GridRevision } from "@/lib/stores/grid-projects";
import { timeAgo } from "@/lib/format";
import { restoreRevisionAction, saveRevisionAction } from "./actions";

/**
 * Revisions sidebar panel (D109) — append-only history of the design.
 * Restore is non-destructive (the store snapshots first), so the only
 * confirmation needed is a two-step button, not a warning dialog.
 */

const BTN: React.CSSProperties = {
  border: "1px solid #dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const INPUT: React.CSSProperties = {
  border: "1px solid #dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
};

const REASON_LABEL: Record<GridRevision["reason"], string> = {
  manual: "saved",
  quote: "quote",
  restore: "restore",
};

export default function RevisionsPanel({
  projectId,
  revisions,
  busy,
  onChanged,
  onError,
}: {
  projectId: string;
  revisions: GridRevision[];
  busy: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [armRestore, setArmRestore] = useState<number | null>(null);
  const newestFirst = [...revisions].sort((a, b) => b.rev - a.rev);

  async function save() {
    setSaving(true);
    const r = await saveRevisionAction(projectId, note);
    setSaving(false);
    setNote("");
    if (!r.ok) onError(r.error);
    else onChanged();
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 7 }}>
        Revisions
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !saving) save(); }}
          placeholder="What changed? (optional)"
          style={INPUT}
        />
        <button style={{ ...BTN, padding: "4px 9px", fontSize: 11, whiteSpace: "nowrap" }} disabled={busy || saving} onClick={save}>
          Save
        </button>
      </div>
      {newestFirst.length === 0 ? (
        <div style={{ fontSize: 11, color: "#8c919c", marginTop: 6 }}>
          Snapshots of the whole layout — quoting cuts one automatically.
        </div>
      ) : (
        <div style={{ marginTop: 9, display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
          {newestFirst.map((r) => (
            <div key={r.rev} style={{ borderTop: "1px solid #edeff3", paddingTop: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5 }}>
                <strong style={{ color: "#16181d" }}>v{r.rev}</strong>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: ".04em",
                    color: r.reason === "quote" ? "#2e7d55" : "#9aa0ab",
                    background: r.reason === "quote" ? "#e8f4ee" : "#f2f3f6",
                    borderRadius: 4,
                    padding: "1px 5px",
                  }}
                >
                  {REASON_LABEL[r.reason]}
                </span>
                <span style={{ color: "#8c919c", fontSize: 11 }}>{r.by} · {timeAgo(r.at)}</span>
                <span style={{ flex: 1 }} />
                {armRestore === r.rev ? (
                  <button
                    style={{ ...BTN, padding: "2px 7px", fontSize: 10.5, background: "#16181d", color: "#fff", borderColor: "#16181d" }}
                    disabled={busy}
                    onClick={async () => {
                      setArmRestore(null);
                      const res = await restoreRevisionAction(projectId, r.rev);
                      if (!res.ok) onError(res.error);
                      else onChanged();
                    }}
                  >
                    Restore v{r.rev}?
                  </button>
                ) : (
                  <button style={{ ...BTN, padding: "2px 7px", fontSize: 10.5 }} onClick={() => setArmRestore(r.rev)}>
                    Restore
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#5b616e", marginTop: 1 }}>
                {r.note || `${r.placements.length} devices · ${r.spaces.length} spaces`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
