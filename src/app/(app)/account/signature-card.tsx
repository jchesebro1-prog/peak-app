"use client";

import { useState, useTransition } from "react";
import { saveSignatureAction } from "./actions";
import { SIGNATURE_MAX, signatureBlock } from "@/lib/inbox-signature";

/**
 * #127 — Account → "Email signature". Plain text, saved per user; the
 * preview is exactly what the composer appends (signatureBlock, minus the
 * leading blank lines it puts before the "-- " separator).
 */
export default function SignatureCard({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = text !== saved;

  const save = () =>
    start(async () => {
      const r = await saveSignatureAction(text);
      if (r.ok) {
        setSaved(r.signature);
        setText(r.signature);
        setMsg({ ok: true, text: "Saved" });
      } else {
        setMsg({ ok: false, text: r.error });
      }
    });

  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Email signature</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
        Added below a &quot;-- &quot; line on every reply and new email you write in the Inbox.
        Plain text only; you can remove it from any message before sending.
      </div>
      <textarea
        value={text}
        maxLength={SIGNATURE_MAX}
        rows={5}
        onChange={(e) => {
          setText(e.target.value);
          setMsg(null);
        }}
        placeholder={"Jeff Chesebro\nPeak Systems Group\n(218) 555-0100"}
        style={{
          width: "100%",
          marginTop: 12,
          resize: "vertical",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          lineHeight: 1.55,
          color: "#16181d",
          border: "1px solid #e4e7ec",
          borderRadius: 9,
          padding: "10px 12px",
          outline: "none",
          background: "#fff",
          boxSizing: "border-box",
          display: "block",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
          {text.length} / {SIGNATURE_MAX}
        </span>
        <span style={{ flex: 1 }} />
        {msg && !pending && (
          <span style={{ fontSize: 11, color: msg.ok ? "#1f7a52" : "#b4543a" }}>{msg.text}</span>
        )}
        <button
          type="button"
          className="pk-btn-accent"
          disabled={!dirty || pending}
          onClick={save}
          style={{
            padding: "8px 14px",
            fontSize: 12.5,
            opacity: !dirty || pending ? 0.55 : 1,
            cursor: !dirty || pending ? "default" : "pointer",
          }}
        >
          {pending ? "Saving…" : "Save signature"}
        </button>
      </div>
      {saved.trim() && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".05em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Preview — exactly what gets sent
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              background: "#fafbfc",
              border: "1px solid #eef0f3",
              borderRadius: 9,
              padding: "10px 12px",
              color: "#3a3f4a",
            }}
          >
            {signatureBlock(saved).replace(/^\n+/, "")}
          </pre>
        </div>
      )}
    </div>
  );
}
