"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveStandardNotesAction } from "./actions";

/** Grid Settings → "Standard general notes" (#209): printed on every drawing
 *  set's cover (T-001) unless that set has its own notes. One per line. */
export function StandardNotesCard({ value }: { value: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [pending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft.trim() !== saved.trim();

  const save = (text: string) =>
    startTransition(async () => {
      setError(null);
      try {
        const res = await saveStandardNotesAction(text);
        if (!res.ok) {
          setError("Save failed — please try again.");
          return;
        }
        setDraft(text.trim());
        setSaved(text.trim());
        setJustSaved(true);
        router.refresh();
      } catch {
        setError("Save failed — please try again.");
      }
    });

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Standard general notes</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
          Printed as the numbered General notes on every drawing set&apos;s cover sheet, unless a set has its own.
          One note per line.
        </div>
      </div>
      <div style={{ padding: "14px 18px" }}>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setJustSaved(false);
            setError(null);
          }}
          rows={7}
          aria-label="Standard general notes"
          placeholder={"Verify all dimensions in the field.\nConduit, boxes and power by the electrical contractor."}
          style={{ width: "100%", fontFamily: "var(--font-ui)", fontSize: 13, border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 10px" }}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
          <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={() => save(draft)}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="pk-btn-outline" disabled={pending || !saved} onClick={() => save("")}>
            Clear
          </button>
          {justSaved && !dirty && !error && <span style={{ fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</span>}
        </div>
        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
