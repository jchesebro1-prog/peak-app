"use client";

/* Jeff 2026-10-15 #10 — a venue's next assessment date, on the venue page's Assessments card. The account rep gets a
   reminder task 30 days before it (src/lib/assessments/reminders.ts). Read-only without `create`.
   #353 review I1: saves on blur or Enter (never per keystroke — a typed year passes through "0002", "0020"…), ignores a
   year before 1900, stays enabled while it saves, and says "Saved" or the error inline. */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setNextAssessmentAction } from "@/app/(app)/assessments/reminder-actions";
import { nextAssessmentInputValue, parseNextAssessmentInput } from "@/lib/assessments/next-assessment-input";

export default function NextAssessmentEdit({ siteId, at, canEdit }: { siteId: string; at: number | null; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(nextAssessmentInputValue(at));
  const [status, setStatus] = useState<{ kind: "saving" | "saved" | "error"; text: string } | null>(null);
  /** the last value the server has (so blur without a change saves nothing) */
  const saved = useRef(nextAssessmentInputValue(at));
  const seq = useRef(0);

  const commit = async () => {
    const parsed = parseNextAssessmentInput(value);
    if (parsed === "ignore") {
      if (value.trim()) setStatus({ kind: "error", text: "Enter a full date (year 1900 or later)." });
      return;
    }
    if (value === saved.current) return;
    const mine = ++seq.current;
    setStatus({ kind: "saving", text: "Saving…" });
    try {
      const r = await setNextAssessmentAction(siteId, parsed.at);
      if (mine !== seq.current) return; // a newer save owns the status line
      if (!r.ok) {
        setStatus({ kind: "error", text: r.error });
        return;
      }
      saved.current = value;
      setStatus({ kind: "saved", text: "Saved" });
      router.refresh();
    } catch {
      if (mine === seq.current) setStatus({ kind: "error", text: "Saving needs a connection." });
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
          min="1900-01-01"
          onChange={(e) => {
            setValue(e.target.value);
            setStatus(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            }
          }}
          title="The account rep gets a reminder 30 days before"
          style={{ fontSize: 12, padding: "3px 6px", width: "auto" }}
        />
      ) : (
        <span style={{ fontFamily: "var(--font-mono)", color: "#3a3f4a" }}>{value || "not set"}</span>
      )}
      {status && (
        <span role="status" style={{ color: status.kind === "error" ? "#b4543a" : "#8c919c" }}>
          {status.text}
        </span>
      )}
    </span>
  );
}
