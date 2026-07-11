"use client";

import { useState } from "react";
import type { CustomerVM, Opt } from "./types";
import { logInteractionAction } from "./actions";

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 6,
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "10px 12px",
  outline: "none",
  background: "#fff",
  boxSizing: "border-box",
};

type LogDraft = {
  channel: "call" | "meeting";
  direction: "in" | "out";
  customerId: string;
  contactName: string;
  contactEmail: string;
  subject: string;
  body: string;
  assignedTo: string;
};

export default function LogModal({
  customers,
  rosterOptions,
  onClose,
  onLogged,
}: {
  customers: CustomerVM[];
  rosterOptions: Opt[];
  onClose: () => void;
  onLogged: (id: string | null) => void;
}) {
  const [ld, setLd] = useState<LogDraft>({
    channel: "call",
    direction: "in",
    customerId: "",
    contactName: "",
    contactEmail: "",
    subject: "",
    body: "",
    assignedTo: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<LogDraft>) => setLd((d) => ({ ...d, ...patch }));

  const contacts = ld.customerId
    ? customers.find((c) => c.id === ld.customerId)?.contacts || []
    : [];
  const logReady = !!ld.customerId && !!(ld.subject.trim() || ld.body.trim());

  const doSave = async () => {
    if (!logReady || busy) return;
    setBusy(true);
    try {
      const res = await logInteractionAction(ld);
      if (res.ok) onLogged(res.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(16,22,30,.46)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        zIndex: 100,
        animation: "ib-scrim .16s ease both",
      }}
    >
      <div
        className="ib-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540,
          maxWidth: "100%",
          maxHeight: "90vh",
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
            padding: "16px 20px",
            borderBottom: "1px solid #f0f1f4",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 600 }}>Log a call or meeting</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2 }}>
              Record a touch so the whole team can see it.
            </div>
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
        <div className="ib-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
          <div
            style={{
              display: "flex",
              background: "#eceef1",
              borderRadius: 10,
              padding: 4,
              marginBottom: 15,
            }}
          >
            <Seg active={ld.channel === "call"} onClick={() => set({ channel: "call" })}>
              Phone call
            </Seg>
            <Seg active={ld.channel === "meeting"} onClick={() => set({ channel: "meeting" })}>
              Meeting
            </Seg>
          </div>
          <div
            style={{
              display: "flex",
              background: "#eceef1",
              borderRadius: 10,
              padding: 4,
              marginBottom: 15,
            }}
          >
            <Seg active={ld.direction === "in"} onClick={() => set({ direction: "in" })}>
              ← They contacted us
            </Seg>
            <Seg active={ld.direction === "out"} onClick={() => set({ direction: "out" })}>
              We reached out →
            </Seg>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
            <div>
              <label style={labelStyle}>Client</label>
              <select
                value={ld.customerId}
                onChange={(e) => {
                  const id = e.target.value;
                  const c = customers.find((x) => x.id === id);
                  set({
                    customerId: id,
                    contactName: c ? c.primaryName : "",
                    contactEmail: c ? c.primaryEmail : "",
                  });
                }}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="">Select client…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Contact</label>
              <select
                value={ld.contactName}
                onChange={(e) => {
                  const nm = e.target.value;
                  const ct = contacts.find((c) => c.name === nm);
                  set({ contactName: nm, contactEmail: ct ? ct.email || "" : "" });
                }}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="">
                  {ld.customerId
                    ? contacts.length
                      ? "Select contact…"
                      : "No saved contacts"
                    : "Pick a client first"}
                </option>
                {contacts.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name + (c.role ? " · " + c.role : "")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Subject</label>
            <input
              value={ld.subject}
              onChange={(e) => set({ subject: e.target.value })}
              placeholder="e.g. Scheduling the walk-through"
              style={inputStyle}
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>
              {ld.direction === "in" ? "What they said" : "What we discussed"}
            </label>
            <textarea
              value={ld.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="Summarize what was said…"
              style={{ ...inputStyle, height: 96, resize: "vertical", lineHeight: 1.5 }}
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Assign to</label>
            <select
              value={ld.assignedTo}
              onChange={(e) => set({ assignedTo: e.target.value })}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="">Unassigned</option>
              {rosterOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            padding: "14px 20px",
            borderTop: "1px solid #f0f1f4",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#5b616e",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "9px 12px",
              fontFamily: "var(--font-ui)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={doSave}
            disabled={!logReady || busy}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              border: "none",
              borderRadius: 9,
              padding: "10px 18px",
              cursor: logReady ? "pointer" : "default",
              opacity: logReady && !busy ? 1 : 0.5,
            }}
          >
            Log it
          </button>
        </div>
      </div>
    </div>
  );
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        fontWeight: 600,
        border: "none",
        borderRadius: 7,
        padding: 9,
        cursor: "pointer",
        ...(active
          ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.1)" }
          : { color: "#787d87", background: "transparent" }),
      }}
    >
      {children}
    </button>
  );
}
