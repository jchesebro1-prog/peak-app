"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDesignatorDigitsAction } from "./actions";

/** Grid Settings → "Designator numbers" (#321): whether a device's number
 *  prints with two digits (CRO-01, Bray's drawings) or one (CRO-1). Applies to
 *  numbers issued from now on; existing designators are left as they are. */
export function DesignatorDigitsCard({ value }: { value: 1 | 2 }) {
  const router = useRouter();
  const [saved, setSaved] = useState<1 | 2>(value);
  const [draft, setDraft] = useState<1 | 2>(value);
  const [pending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== saved;

  const save = () =>
    startTransition(async () => {
      setError(null);
      try {
        const res = await saveDesignatorDigitsAction(draft);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setSaved(draft);
        setJustSaved(true);
        router.refresh();
      } catch {
        setError("Save failed — please try again.");
      }
    });

  const option = (n: 1 | 2, label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
      <input
        type="radio"
        name="designatorDigits"
        checked={draft === n}
        onChange={() => {
          setDraft(n);
          setJustSaved(false);
          setError(null);
        }}
      />
      {label}
    </label>
  );

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Designator numbers</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
          How many digits the number in a device&apos;s designator prints with.
        </div>
      </div>
      <div style={{ padding: "14px 18px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {option(2, "Two digits (CRO-01)")}
          {option(1, "One digit (CRO-1)")}
        </div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 10, lineHeight: 1.45 }}>
          Changing this never rewrites existing designators — use Renumber in the Devices tab.
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
          <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={save}>
            {pending ? "Saving…" : "Save"}
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
