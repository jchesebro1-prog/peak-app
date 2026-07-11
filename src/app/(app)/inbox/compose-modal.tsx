"use client";

import { useState } from "react";
import type { ComposeInit, CustomerVM, Opt } from "./types";
import { composeSendAction, saveDraftAction } from "./actions";
import { PaperclipIcon, SendIcon } from "./icons";

export default function ComposeModal({
  init,
  fromOptions,
  customers,
  contactEmails,
  onClose,
  onSaved,
  onSent,
}: {
  init: ComposeInit;
  fromOptions: Opt[];
  customers: CustomerVM[];
  contactEmails: Opt[];
  onClose: () => void;
  onSaved: (mailbox: string) => void;
  onSent: (mailbox: string, id: string | null) => void;
}) {
  const [cd, setCd] = useState<ComposeInit & { attach: string }>({ ...init, attach: "" });
  const [busy, setBusy] = useState<false | "save" | "send">(false);
  const set = (patch: Partial<ComposeInit & { attach: string }>) =>
    setCd((c) => ({ ...c, ...patch }));

  const composeReady =
    !!cd.to.trim() && !!(cd.subject.trim() || cd.body.trim());

  const payload = () => ({
    id: cd.id,
    mailbox: cd.mailbox,
    to: cd.to,
    cc: cd.cc,
    subject: cd.subject,
    body: cd.body,
    customerId: cd.customerId,
    contactName: cd.contactName,
  });

  const doSaveDraft = async () => {
    if (busy) return;
    setBusy("save");
    try {
      await saveDraftAction(payload());
      onSaved(cd.mailbox);
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    if (!composeReady || busy) return;
    setBusy("send");
    try {
      const res = await composeSendAction(payload());
      if (res.ok) onSent(cd.mailbox, res.id);
    } finally {
      setBusy(false);
    }
  };

  const onCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    set({
      customerId: id,
      contactName: c ? c.primaryName : "",
      to: c && c.primaryEmail ? c.primaryEmail : cd.to,
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(16,22,30,.46)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "36px 24px",
        zIndex: 100,
        animation: "ib-scrim .16s ease both",
        overflowY: "auto",
      }}
    >
      <div
        className="ib-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: "100%",
          background: "#fff",
          borderRadius: 15,
          boxShadow: "0 24px 70px rgba(0,0,0,.32)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "var(--font-ui)",
          color: "#16181d",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "15px 20px",
            borderBottom: "1px solid #f0f1f4",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 15.5, fontWeight: 600 }}>
            {cd.id ? "Edit draft" : "New message"}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "#f1f2f5",
              color: "#5b616e",
              border: "none",
              cursor: "pointer",
              fontSize: 17,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "4px 20px 0" }}>
          {/* From */}
          <Row label="From">
            <select
              value={cd.mailbox}
              onChange={(e) => set({ mailbox: e.target.value })}
              style={{
                flex: 1,
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                fontWeight: 600,
                color: "#16181d",
                border: "none",
                background: "transparent",
                outline: "none",
                cursor: "pointer",
              }}
            >
              {fromOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
          {/* Customer link */}
          <Row label="Client">
            <select
              value={cd.customerId}
              onChange={(e) => onCustomer(e.target.value)}
              style={{
                flex: 1,
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                color: "#16181d",
                border: "none",
                background: "transparent",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="">Not linked to a client</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          {/* To */}
          <Row label="To">
            <input
              value={cd.to}
              onChange={(e) => set({ to: e.target.value })}
              list="ib-contacts"
              placeholder="name@email.com"
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                background: "transparent",
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: "#16181d",
                outline: "none",
              }}
            />
            <button
              onClick={() => set({ showCc: !cd.showCc })}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "#5b616e",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                flexShrink: 0,
                fontFamily: "var(--font-ui)",
              }}
            >
              {cd.showCc ? "Hide Cc" : "+ Cc"}
            </button>
          </Row>
          <datalist id="ib-contacts">
            {contactEmails.map((e, i) => (
              <option key={`${e.value}-${i}`} value={e.value}>
                {e.label}
              </option>
            ))}
          </datalist>
          {/* Cc */}
          {cd.showCc && (
            <Row label="Cc">
              <input
                value={cd.cc}
                onChange={(e) => set({ cc: e.target.value })}
                placeholder="cc@email.com"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  background: "transparent",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  color: "#16181d",
                  outline: "none",
                }}
              />
            </Row>
          )}
          {/* Subject */}
          <Row label="Subject">
            <input
              value={cd.subject}
              onChange={(e) => set({ subject: e.target.value })}
              placeholder="Subject"
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                background: "transparent",
                fontSize: 13.5,
                fontWeight: 600,
                color: "#16181d",
                outline: "none",
                fontFamily: "var(--font-ui)",
              }}
            />
          </Row>
        </div>

        <textarea
          value={cd.body}
          onChange={(e) => set({ body: e.target.value })}
          placeholder="Write your message…"
          style={{
            margin: "6px 20px 0",
            height: 210,
            resize: "vertical",
            fontFamily: "var(--font-ui)",
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "#16181d",
            border: "none",
            outline: "none",
            background: "#fff",
          }}
        />

        {cd.attach && (
          <div style={{ padding: "6px 20px 0" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                color: "#5b616e",
                background: "#f4f5f7",
                border: "1px solid #e8eaee",
                borderRadius: 7,
                padding: "5px 9px",
              }}
            >
              📎 {cd.attach}{" "}
              <span onClick={() => set({ attach: "" })} style={{ cursor: "pointer", color: "#aab0bb" }}>
                ×
              </span>
            </span>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 20px",
            borderTop: "1px solid #f0f1f4",
            marginTop: 14,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => set({ attach: cd.attach ? "" : "quote-Q-2041.pdf" })}
            title="Attach (demo)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "#5b616e",
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 9,
              padding: "9px 11px",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
            }}
          >
            <PaperclipIcon size={14} />
            Attach
          </button>
          <button
            onClick={onClose}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#8c919c",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "9px 6px",
              fontFamily: "var(--font-ui)",
            }}
          >
            Discard
          </button>
          <span style={{ flex: 1 }} />
          <button
            onClick={doSaveDraft}
            disabled={!!busy}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#3a3f4a",
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 9,
              padding: "9px 15px",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Save draft
          </button>
          <button
            onClick={doSend}
            disabled={!composeReady || !!busy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              fontFamily: "var(--font-ui)",
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fff",
              border: "none",
              borderRadius: 9,
              padding: "9px 17px",
              cursor: composeReady ? "pointer" : "default",
              background: "var(--accent)",
              opacity: composeReady && !busy ? 1 : 0.45,
            }}
          >
            <SendIcon size={14} />
            {busy === "send" ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 2px",
        borderBottom: "1px solid #f4f5f7",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", width: 52 }}>{label}</span>
      {children}
    </div>
  );
}
