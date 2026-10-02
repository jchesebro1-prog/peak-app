"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { MAX_INTRO } from "./narrative";
import { MAX_INTRO_TITLE, type SystemIntro } from "@/lib/narrative/intros";
import { deleteSystemIntroAction, upsertSystemIntroAction } from "./narrative-actions";

/** #293 — Manage intros: edit or delete library intros. Inline two-step
 *  delete (the browser's confirm dialog is a silent "no" in the Capacitor
 *  shells). Writes need Create. */
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" };
const FIELD: CSSProperties = { width: "100%", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px" };
const FAILED = "Could not reach the server. Try again.";

export default function NarrativeIntrosModal({
  intros,
  canWrite,
  onIntros,
  onClose,
}: {
  intros: SystemIntro[];
  canWrite: boolean;
  onIntros: (list: SystemIntro[]) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<{ id: string; title: string; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  // A thrown action inside startTransition reaches the error boundary and
  // would unmount the Estimator — every await is caught and surfaced here.
  const save = () => {
    if (!editing) return;
    const input = editing;
    start(async () => {
      setErr("");
      try {
        const r = await upsertSystemIntroAction(input);
        if (!r.ok) return setErr(r.error);
        onIntros(r.intros);
        setEditing(null);
      } catch {
        setErr(FAILED);
      }
    });
  };
  const del = (id: string) =>
    start(async () => {
      setErr("");
      try {
        const r = await deleteSystemIntroAction(id);
        if (!r.ok) return setErr(r.error);
        onIntros(r.intros);
        setConfirmDel(null);
      } catch {
        setErr(FAILED);
      }
    });

  return (
    <div role="dialog" aria-modal="true" aria-label="Manage intros" style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(22,24,29,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "min(560px, 100%)", maxHeight: "85vh", overflowY: "auto", background: "#fff", borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>System intros</div>
          <button type="button" style={BTN} onClick={onClose}>Done</button>
        </div>
        {!intros.length && <div style={{ fontSize: 12.5, color: "#8c919c" }}>No intros yet — write a system&apos;s intro, then ⋯ → Save as intro…</div>}
        {intros.map((i) =>
          editing?.id === i.id ? (
            <div key={i.id} style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid #ececf0", borderRadius: 8, padding: 10 }}>
              <input aria-label="Intro title" style={FIELD} maxLength={MAX_INTRO_TITLE} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              <textarea aria-label="Intro text" style={{ ...FIELD, minHeight: 140, resize: "vertical" }} maxLength={MAX_INTRO} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={BTN} disabled={pending} onClick={save}>Save</button>
                <button type="button" style={BTN} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div key={i.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid #f0f1f4", padding: "8px 0" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</div>
                <div style={{ fontSize: 11.5, color: "#8c919c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.text.split("\n")[0]}</div>
              </div>
              {confirmDel === i.id ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                  Delete “{i.title}”?
                  <button type="button" style={{ ...BTN, color: "#b4543a" }} disabled={pending} onClick={() => del(i.id)}>Delete</button>
                  <button type="button" style={BTN} onClick={() => setConfirmDel(null)}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" style={BTN} disabled={!canWrite} title={canWrite ? "" : "Needs the Create permission"} onClick={() => setEditing({ id: i.id, title: i.title, text: i.text })}>Edit</button>
                  <button type="button" style={{ ...BTN, color: "#b4543a" }} disabled={!canWrite} title={canWrite ? "" : "Needs the Create permission"} onClick={() => setConfirmDel(i.id)}>Delete</button>
                </div>
              )}
            </div>
          )
        )}
        {err && <div style={{ fontSize: 12, color: "#b4543a" }}>{err}</div>}
      </div>
    </div>
  );
}
