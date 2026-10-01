"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PORTAL_QUOTE_NAME_MAX } from "@/lib/portal-quote-names";
import { renamePortalQuoteAction } from "./actions";

/**
 * ✎ Rename on a My quotes row (#288, spec §1.5). Shows the row's title
 * (`children`, rendered by the server row) plus a small Rename link; editing
 * swaps in an input with Save / Cancel. Every rule — session, tenant,
 * customer-built, not accepted, cleaning, the rate limit — is the server's
 * (`renamePortalQuote`); a refusal shows its text here.
 */

const LINK: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--accent)",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 7,
  padding: "6px 11px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export function RenameQuote({ quoteId, name, children }: { quoteId: string; name: string; children: ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</div>
        <button
          type="button"
          style={LINK}
          aria-label={`Rename ${name}`}
          onClick={() => {
            setDraft(name);
            setError("");
            setEditing(true);
          }}
        >
          ✎ Rename
        </button>
      </div>
    );
  }

  const save = () => {
    setError("");
    start(async () => {
      try {
        const r = await renamePortalQuoteAction(quoteId, draft);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setEditing(false);
        router.refresh();
      } catch {
        setError("Couldn't rename this quote — check your connection and try again.");
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <input
          type="text"
          value={draft}
          maxLength={PORTAL_QUOTE_NAME_MAX}
          autoFocus
          disabled={pending}
          aria-label="Quote name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          style={{
            flex: "1 1 220px",
            minWidth: 0,
            font: "500 13.5px var(--font-ui)",
            color: "#16181d",
            padding: "7px 10px",
            border: "1px solid #d6d9e0",
            borderRadius: 8,
          }}
        />
        <button type="button" disabled={pending} onClick={save} style={{ ...BTN, color: "#fff", background: "var(--accent)", border: "none" }}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setEditing(false)}
          style={{ ...BTN, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec" }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 12, fontWeight: 600, color: "#a33a2b" }}>
          {error}
        </div>
      )}
    </div>
  );
}
