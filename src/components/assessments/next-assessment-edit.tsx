"use client";

/* Jeff 2026-10-15 #10 — a venue's next assessment date, on the venue page's Assessments card. The account rep gets a
   reminder task 30 days before it (src/lib/assessments/reminders.ts). Read-only without `create`. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setNextAssessmentAction } from "@/app/(app)/assessments/reminder-actions";

const toInput = (ms: number | null): string => {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fromInput = (s: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const ms = new Date(y, m - 1, d, 12).getTime();
  return Number.isFinite(ms) ? ms : null;
};

export default function NextAssessmentEdit({ siteId, at, canEdit }: { siteId: string; at: number | null; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(toInput(at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (next: string) => {
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      const r = await setNextAssessmentAction(siteId, fromInput(next));
      if (!r.ok) setError(r.error);
      else router.refresh();
    } catch {
      setError("Saving needs a connection.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span data-testid="next-assessment" style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap", fontSize: 12, color: "#8c919c" }}>
      <label htmlFor={`next-assess-${siteId}`}>Next assessment</label>
      {canEdit ? (
        <input
          id={`next-assess-${siteId}`}
          type="date"
          className="pk-input"
          value={value}
          disabled={busy}
          onChange={(e) => void save(e.target.value)}
          title="The account rep gets a reminder 30 days before"
          style={{ fontSize: 12, padding: "3px 6px", width: "auto" }}
        />
      ) : (
        <span style={{ fontFamily: "var(--font-mono)", color: "#3a3f4a" }}>{value || "not set"}</span>
      )}
      {error && <span style={{ color: "#b4543a" }}>{error}</span>}
    </span>
  );
}
