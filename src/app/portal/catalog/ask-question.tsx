"use client";

import { useState, useTransition } from "react";
import { PART_QUESTION_MAX, PART_QUESTION_PHONE_MAX } from "@/lib/portal-leads";
import { askAboutPart } from "./actions";
import { PreviewHint } from "./panel-ui";

/**
 * "Ask a question about this part" (#245 Task 11, spec §3.2 item 7). Name and
 * email come from the grant (shown, not editable — the server uses the
 * session's, never these); the question lands in the Leads SLA queue.
 */
export function AskQuestion({
  itemKey,
  viewer,
  preview,
}: {
  itemKey: string;
  viewer: { name: string; email: string };
  preview: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="ps-ask-toggle" onClick={() => setOpen(true)} aria-expanded="false">
        Ask a question about this part
        <span aria-hidden="true" style={{ color: "#9aa0ab" }}>
          +
        </span>
      </button>
    );
  }

  if (sent) {
    return (
      <div className="ps-card">
        <div className="ps-added" role="status">
          <span className="ps-added-tick" aria-hidden="true">
            ✓
          </span>
          Sent — we&rsquo;ll get back to you.
        </div>
        <button
          type="button"
          className="ps-link"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            setSent(false);
            setMessage("");
          }}
        >
          Ask another question
        </button>
      </div>
    );
  }

  const trimmed = message.trim();
  const submit = () => {
    if (preview || !trimmed) return;
    setError("");
    start(async () => {
      try {
        const r = await askAboutPart({ sku: itemKey, message: trimmed, phone: phone.trim() });
        if (r.ok) setSent(true);
        else setError(r.error);
      } catch {
        setError("Couldn't send your question — check your connection and try again.");
      }
    });
  };

  return (
    <form
      className="ps-card"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>Ask a question about this part</div>
        <button type="button" className="ps-link" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {(viewer.name || viewer.email) && (
        <div className="ps-fine">
          From {viewer.name}
          {viewer.name && viewer.email ? " · " : ""}
          {viewer.email}
        </div>
      )}
      <label className="ps-field">
        <span className="ps-label">Your question</span>
        <textarea
          className="ps-input"
          value={message}
          maxLength={PART_QUESTION_MAX}
          disabled={preview || pending}
          placeholder="Lead times, compatibility, alternatives…"
          onChange={(e) => setMessage(e.target.value)}
        />
        {message.length > PART_QUESTION_MAX - 200 && (
          <span className="ps-fine" style={{ textAlign: "right" }}>
            {message.length.toLocaleString("en-US")} / {PART_QUESTION_MAX.toLocaleString("en-US")}
          </span>
        )}
      </label>
      <label className="ps-field">
        <span className="ps-label">
          Phone <span>· optional</span>
        </span>
        <input
          className="ps-input"
          type="tel"
          autoComplete="tel"
          value={phone}
          maxLength={PART_QUESTION_PHONE_MAX}
          disabled={preview || pending}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      {error && <div className="ps-err">{error}</div>}
      {preview ? (
        <PreviewHint />
      ) : (
        <button type="submit" className="ps-add" style={{ flex: "none" }} disabled={pending || !trimmed}>
          {pending ? "Sending…" : "Send question"}
        </button>
      )}
    </form>
  );
}
