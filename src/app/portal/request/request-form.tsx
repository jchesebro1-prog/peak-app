"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { submitPortalRequest } from "../actions";

/**
 * Portal request form (IDEAS #47) — venue, service type, urgency, details.
 * The requester's identity comes from the portal grant server-side; the
 * read-only fields here are display only. Mirrors the SERVICES / URGENCIES
 * lists in ../actions.ts (server actions can't export constants).
 */

const SERVICES = [
  "Flame testing",
  "Rigging inspection",
  "Repair",
  "New system / renovation",
  "Something else",
];
const URGENCIES = ["Standard", "Urgent", "Emergency — out of service"];

const LABEL: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 7,
};
const FIELD: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "11px 13px",
  boxSizing: "border-box",
};

export function RequestForm({
  venues,
  requester,
  showDetailsError,
}: {
  venues: Array<{ id: string; label: string; place: string }>;
  requester: { name: string; email: string };
  showDetailsError: boolean;
}) {
  const [venue, setVenue] = useState(venues[0]?.id || "");
  const [service, setService] = useState(SERVICES[0]);
  const [urgency, setUrgency] = useState(URGENCIES[0]);
  const [phone, setPhone] = useState("");
  const [details, setDetails] = useState("");
  const [pending, startTransition] = useTransition();

  const canSend = details.trim().length > 0 && !pending;

  function send() {
    if (!canSend) return;
    const fd = new FormData();
    fd.set("venue", venue);
    fd.set("service", service);
    fd.set("urgency", urgency);
    fd.set("phone", phone);
    fd.set("details", details);
    startTransition(() => submitPortalRequest(fd));
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e4e7ec",
        borderRadius: 14,
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
        padding: "20px 22px",
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={LABEL}>Your name</label>
          <input value={requester.name} readOnly style={{ ...FIELD, background: "#f7f8fa", color: "#5b616e" }} />
        </div>
        <div>
          <label style={LABEL}>Your email</label>
          <input value={requester.email} readOnly style={{ ...FIELD, background: "#f7f8fa", color: "#5b616e" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={LABEL}>Venue</label>
          <select value={venue} onChange={(e) => setVenue(e.target.value)} style={{ ...FIELD, cursor: "pointer" }}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label + (v.place ? " — " + v.place : "")}
              </option>
            ))}
            <option value="">Another / new venue (describe below)</option>
          </select>
        </div>
        <div>
          <label style={LABEL}>Phone (optional)</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Best number for questions"
            style={FIELD}
          />
        </div>
      </div>

      <div>
        <label style={LABEL}>What do you need?</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SERVICES.map((s) => {
            const on = service === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setService(s)}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "9px 14px",
                  borderRadius: 20,
                  cursor: "pointer",
                  border: on ? "1px solid var(--accent)" : "1px solid #e4e7ec",
                  background: on ? "var(--accent)" : "#fff",
                  color: on ? "#fff" : "#5b616e",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label style={LABEL}>How urgent?</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {URGENCIES.map((u) => {
            const on = urgency === u;
            const hot = u.startsWith("Emergency");
            return (
              <button
                key={u}
                type="button"
                onClick={() => setUrgency(u)}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "9px 14px",
                  borderRadius: 20,
                  cursor: "pointer",
                  border: on
                    ? "1px solid " + (hot ? "#8a2f22" : "var(--accent)")
                    : "1px solid #e4e7ec",
                  background: on ? (hot ? "#8a2f22" : "var(--accent)") : "#fff",
                  color: on ? "#fff" : hot ? "#8a2f22" : "#5b616e",
                }}
              >
                {u}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label style={LABEL}>Tell us about it</label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={5}
          placeholder="What's happening, which system it involves, timing constraints — anything that helps us quote it right the first time."
          style={{ ...FIELD, resize: "vertical", lineHeight: 1.55 }}
        />
        {showDetailsError && !details.trim() && (
          <div style={{ fontSize: 11.5, color: "#b4543a", marginTop: 6 }}>
            Please describe what you need so we can route it to the right person.
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={send}
        disabled={!canSend}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 14,
          fontWeight: 600,
          color: "#fff",
          background: canSend ? "var(--accent)" : "#c8ccd3",
          border: "none",
          borderRadius: 10,
          padding: "13px 18px",
          cursor: canSend ? "pointer" : "not-allowed",
        }}
      >
        {pending ? "Sending…" : "Send request"}
      </button>
      <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.55, marginTop: -6 }}>
        Your request goes straight to the team's response queue with your name and venue already
        attached — no forms to re-fill, no account numbers to look up.
      </div>
    </div>
  );
}
