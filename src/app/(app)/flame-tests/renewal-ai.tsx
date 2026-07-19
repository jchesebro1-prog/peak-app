"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { draftRenewalEmailAction } from "./renewal-ai-actions";

/**
 * D1 client control — the "AI draft" affordance in the Renewals-due card. Calls
 * the server action, which drafts personalized copy with AI and lands it on
 * the SAME renewal draft the ✉ one-click flow uses (IDEAS #36: quote minted at
 * last year's price, proposal PDF attached). Shows a spinner while it runs,
 * then a link that opens the draft in the composer — or the error text on
 * failure. Rendered only when AI is enabled (the parent gates on aiEnabled()).
 */
export function RenewalDraftButton({ jobId }: { jobId: string }) {
  const [pending, startTransition] = useTransition();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  function onClick() {
    if (pending) return;
    setError("");
    setThreadId(null);
    startTransition(async () => {
      const res = await draftRenewalEmailAction(jobId);
      if (res.ok) {
        setThreadId(res.threadId);
      } else {
        setError(res.error);
      }
    });
  }

  if (threadId) {
    return (
      <Link
        href={"/inbox?box=sales&folder=drafts&draft=" + encodeURIComponent(threadId)}
        title="Open the draft in the Inbox composer to review and send"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 12,
          fontWeight: 600,
          color: "var(--accent)",
          background: "#f4f1fb",
          border: "1px solid #e2daf5",
          borderRadius: 9,
          padding: "8px 11px",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Draft ready — review in Inbox ›
      </Link>
    );
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title="Draft a personalized renewal email with AI — lands on the renewal draft (quote PDF attached) for review"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--accent)",
          background: "#fff",
          border: "1px solid #e2daf5",
          borderRadius: 9,
          padding: "9px 12px",
          cursor: pending ? "wait" : "pointer",
          whiteSpace: "nowrap",
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? "Drafting…" : "AI draft"}
      </button>
      {error && (
        <span
          style={{
            fontSize: 10.5,
            color: "#b4543a",
            maxWidth: 180,
            textAlign: "right",
            lineHeight: 1.35,
          }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
