"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCustomerNoteAction } from "../actions";

/**
 * #21 — the Activity card's note composer. Imports ONLY the server-action
 * stub (client-bundle rule: no store value-imports in "use client" files).
 * Inline error on { ok: false }; router.refresh() re-renders the server
 * page so the new note lands in the feed.
 */
export default function ActivityComposer({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const t = text.trim();
    if (!t) {
      setErr("Write a note first.");
      return;
    }
    setErr("");
    startTransition(async () => {
      const res = await addCustomerNoteAction(customerId, t);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setText("");
      router.refresh();
    });
  };

  return (
    <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4", background: "#fafbfc" }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note — visible to the whole team…"
        rows={2}
        style={{
          width: "100%",
          fontFamily: "var(--font-ui)",
          fontSize: 12.5,
          color: "#16181d",
          background: "#fff",
          border: "1px solid #dfe2e8",
          borderRadius: 8,
          padding: "8px 10px",
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
        <button
          onClick={submit}
          disabled={isPending}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#fff",
            background: "var(--accent)",
            border: "none",
            padding: "7px 13px",
            borderRadius: 7,
            cursor: "pointer",
          }}
        >
          Add note
        </button>
        {err && <span style={{ fontSize: 11.5, color: "#b4543a", fontWeight: 600 }}>{err}</span>}
      </div>
    </div>
  );
}
