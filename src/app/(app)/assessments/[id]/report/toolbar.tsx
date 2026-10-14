"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { emailAssessmentReportAction } from "./actions";

/** The report page's toolbar (#340 Task 10): back to the editor, Download PDF, Email report. */
export default function ReportToolbar({ id, canSend }: { id: string; canSend: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const email = () => {
    setError(null);
    start(async () => {
      try {
        const r = await emailAssessmentReportAction(id);
        // Success redirects to the Inbox composer; anything that comes back is a refusal.
        if (r && !r.ok) setError(r.error);
      } catch (e) {
        // A redirect is thrown through here by Next and handled by the router; only real failures land below.
        if (e && typeof e === "object" && "digest" in e && String((e as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
        setError("The report couldn't be emailed — try again.");
      }
    });
  };
  return (
    <div className="asr-toolbar">
      <Link href={`/assessments/${encodeURIComponent(id)}`} style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← {id}</Link>
      <span style={{ flex: 1 }} />
      {error && <span role="alert" style={{ fontSize: 12.5, color: "#8c3b26" }}>{error}</span>}
      <a className="pk-btn-outline" style={{ textDecoration: "none" }} href={`/api/assessments/${encodeURIComponent(id)}/report-pdf?download=1`}>Download PDF</a>
      {canSend && (
        <button type="button" className="pk-btn-accent" disabled={pending} onClick={email}>{pending ? "Preparing…" : "Email report"}</button>
      )}
    </div>
  );
}
