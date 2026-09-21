"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import { createQuoteIntakeAction } from "./actions";
import { SERVICE_TYPES, type IntakeCustomer, type IntakeSubmit, type ServiceType } from "./types";

const LBL: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  margin: "16px 0 6px",
};

const INPUT: CSSProperties = {
  width: "100%",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: 13,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  background: "#fff",
  outline: "none",
};

const ADD_NEW = "__add_new__";
const SKIP = "__skip__";

function locationLine(l: IntakeCustomer["locations"][number]): string {
  const where = [l.city, l.state].filter(Boolean).join(", ");
  return where ? `${l.label || "Venue"} — ${where}` : l.label || "Venue";
}

export default function QuoteIntakeForm({
  customers,
  initialType,
}: {
  customers: IntakeCustomer[];
  initialType: ServiceType;
}) {
  const [type, setType] = useState<ServiceType>(initialType);

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerMode, setCustomerMode] = useState<"pick" | "new">("pick");
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerType, setNewCustomerType] = useState<string>(CUSTOMER_TYPES[0] || "");

  const [locationMode, setLocationMode] = useState<"pick" | "new" | "skip">("skip");
  const [locationId, setLocationId] = useState("");
  const [newLocationLabel, setNewLocationLabel] = useState("");
  const [newLocationCity, setNewLocationCity] = useState("");
  const [newLocationState, setNewLocationState] = useState("");

  const [contactMode, setContactMode] = useState<"pick" | "new" | "skip">("skip");
  const [contactName, setContactName] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactRole, setNewContactRole] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");

  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const selectedCustomer = customerMode === "pick" ? customers.find((c) => c.id === customerId) || null : null;
  const locations = selectedCustomer?.locations || [];
  const contacts = selectedCustomer?.contacts || [];
  // A customer is "in play" once one is picked or a new one is being named —
  // that's when the venue/contact steps make sense to show at all.
  const hasCustomerContext = customerMode === "new" || !!customerId;

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    const base = !q ? customers : customers.filter((c) => c.name.toLowerCase().includes(q));
    // Keep the currently-picked customer in the list even if a later search
    // filters it out, so the <select>'s value never goes stale.
    if (customerId && !base.some((c) => c.id === customerId)) {
      const sel = customers.find((c) => c.id === customerId);
      if (sel) return [sel, ...base];
    }
    return base;
  }, [customers, customerQuery, customerId]);

  function pickCustomer(id: string) {
    if (id === ADD_NEW) {
      setCustomerMode("new");
      setCustomerId("");
    } else {
      setCustomerMode("pick");
      setCustomerId(id);
    }
    // switching customers invalidates whatever venue/contact was picked off
    // the previous one — reset back to skippable, not silently pointed at
    // the wrong record.
    setLocationMode("skip");
    setLocationId("");
    setContactMode("skip");
    setContactName("");
  }

  function pickLocation(v: string) {
    if (v === ADD_NEW) setLocationMode("new");
    else if (v === SKIP) setLocationMode("skip");
    else {
      setLocationMode("pick");
      setLocationId(v);
    }
  }

  function pickContact(v: string) {
    if (v === ADD_NEW) setContactMode("new");
    else if (v === SKIP) setContactMode("skip");
    else {
      setContactMode("pick");
      setContactName(v);
    }
  }

  const canSubmit =
    (customerMode === "pick" && !!customerId) ||
    (customerMode === "new" && newCustomerName.trim().length > 0);

  function submit() {
    if (!canSubmit || pending) return;
    setError("");
    const payload: IntakeSubmit = {
      type,
      customerMode,
      customerId,
      newCustomerName,
      newCustomerType,
      locationMode,
      locationId,
      newLocationLabel,
      newLocationCity,
      newLocationState,
      contactMode,
      contactName,
      newContactName,
      newContactRole,
      newContactEmail,
      newContactPhone,
    };
    startTransition(async () => {
      const res = await createQuoteIntakeAction(payload);
      // A successful call redirect()s server-side and never returns here.
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "26px 22px 60px", fontFamily: "var(--font-ui)" }}>
      <Link href="/quotes" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
        ← Quotes
      </Link>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: "#16181d", margin: "6px 0 3px" }}>
        New quote
      </h1>
      <p style={{ fontSize: 13, color: "#8c919c", margin: "0 0 22px" }}>
        Pick who this is for, then jump straight into the builder.
      </p>

      {/* ---- service category ---- */}
      <label style={{ ...LBL, margin: "0 0 8px" }}>Quote type</label>
      <div style={{ display: "grid", gap: 8 }}>
        {SERVICE_TYPES.map((s) => {
          const active = type === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setType(s.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                background: "#fff",
                border: `1.5px solid ${active ? "var(--accent)" : "#ececf0"}`,
                borderRadius: 11,
                padding: "11px 13px",
                cursor: "pointer",
              }}
            >
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#16181d" }}>{s.label}</span>
                  {s.badge && (
                    <span
                      style={{
                        fontSize: 8.5,
                        fontWeight: 700,
                        letterSpacing: ".04em",
                        textTransform: "uppercase",
                        color: s.badgeInk,
                        background: s.badgeSoft,
                        border: `1px solid ${s.badgeBd}`,
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {s.badge}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11.5, color: "#9aa0ab", display: "block", marginTop: 2 }}>
                  {s.sub}
                </span>
              </span>
              <span
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: "50%",
                  border: `1.7px solid ${active ? "var(--accent)" : "#cfd4dd"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {active && (
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---- customer ---- */}
      <label style={LBL}>Customer</label>
      <input
        value={customerQuery}
        onChange={(e) => setCustomerQuery(e.target.value)}
        placeholder="Search customers…"
        style={{ ...INPUT, marginBottom: 8 }}
      />
      <select
        value={customerMode === "new" ? ADD_NEW : customerId}
        onChange={(e) => pickCustomer(e.target.value)}
        style={INPUT}
      >
        <option value="">— Choose a customer —</option>
        {filteredCustomers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value={ADD_NEW}>+ Add new customer…</option>
      </select>
      {customerQuery.trim() && filteredCustomers.length === 0 && customerMode === "pick" && (
        <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 6 }}>
          No matches for “{customerQuery.trim()}” — add a new customer below.
        </div>
      )}
      {customerMode === "new" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <input
            value={newCustomerName}
            onChange={(e) => setNewCustomerName(e.target.value)}
            placeholder="Customer name"
            style={INPUT}
          />
          <select value={newCustomerType} onChange={(e) => setNewCustomerType(e.target.value)} style={INPUT}>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ---- venue (skippable) ---- */}
      <label style={LBL}>Venue</label>
      {!hasCustomerContext && (
        <div style={{ fontSize: 12, color: "#9aa0ab" }}>Pick a customer above first.</div>
      )}
      {hasCustomerContext && locations.length > 0 && (
        <select value={locationMode === "new" ? ADD_NEW : locationMode === "skip" ? SKIP : locationId} onChange={(e) => pickLocation(e.target.value)} style={INPUT}>
          <option value={SKIP}>Skip for now — no venue yet</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {locationLine(l)}
            </option>
          ))}
          <option value={ADD_NEW}>+ Add new venue…</option>
        </select>
      )}
      {hasCustomerContext && locationMode === "new" && (
        <div style={{ display: "grid", gap: 8, marginTop: locations.length > 0 ? 8 : 0 }}>
          <input
            value={newLocationLabel}
            onChange={(e) => setNewLocationLabel(e.target.value)}
            placeholder="Venue name (e.g. Main auditorium)"
            style={INPUT}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              value={newLocationCity}
              onChange={(e) => setNewLocationCity(e.target.value)}
              placeholder="City"
              style={INPUT}
            />
            <input
              value={newLocationState}
              onChange={(e) => setNewLocationState(e.target.value)}
              placeholder="State"
              style={INPUT}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setLocationMode("skip");
              setNewLocationLabel("");
              setNewLocationCity("");
              setNewLocationState("");
            }}
            style={skipLinkStyle}
          >
            Skip for now
          </button>
        </div>
      )}
      {hasCustomerContext && locationMode === "skip" && locations.length === 0 && (
        <div style={{ fontSize: 12, color: "#9aa0ab" }}>
          No venue yet —{" "}
          <button type="button" onClick={() => setLocationMode("new")} style={inlineLinkStyle}>
            add one now
          </button>
          .
        </div>
      )}

      {/* ---- contact (skippable) ---- */}
      <label style={LBL}>Contact</label>
      {!hasCustomerContext && (
        <div style={{ fontSize: 12, color: "#9aa0ab" }}>Pick a customer above first.</div>
      )}
      {hasCustomerContext && contacts.length > 0 && (
        <select value={contactMode === "new" ? ADD_NEW : contactMode === "skip" ? SKIP : contactName} onChange={(e) => pickContact(e.target.value)} style={INPUT}>
          <option value={SKIP}>Skip for now — no contact yet</option>
          {contacts.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
              {c.role ? ` — ${c.role}` : ""}
            </option>
          ))}
          <option value={ADD_NEW}>+ Add new contact…</option>
        </select>
      )}
      {hasCustomerContext && contactMode === "new" && (
        <div style={{ display: "grid", gap: 8, marginTop: contacts.length > 0 ? 8 : 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              placeholder="Name"
              style={INPUT}
            />
            <input
              value={newContactRole}
              onChange={(e) => setNewContactRole(e.target.value)}
              placeholder="Role (optional)"
              style={INPUT}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              value={newContactEmail}
              onChange={(e) => setNewContactEmail(e.target.value)}
              placeholder="Email (optional)"
              style={INPUT}
            />
            <input
              value={newContactPhone}
              onChange={(e) => setNewContactPhone(e.target.value)}
              placeholder="Phone (optional)"
              style={INPUT}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setContactMode("skip");
              setNewContactName("");
              setNewContactRole("");
              setNewContactEmail("");
              setNewContactPhone("");
            }}
            style={skipLinkStyle}
          >
            Skip for now
          </button>
        </div>
      )}
      {hasCustomerContext && contactMode === "skip" && contacts.length === 0 && (
        <div style={{ fontSize: 12, color: "#9aa0ab" }}>
          No contact yet —{" "}
          <button type="button" onClick={() => setContactMode("new")} style={inlineLinkStyle}>
            add one now
          </button>
          .
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 18,
            background: "#f9ece8",
            border: "1px solid #f0d6cd",
            borderRadius: 9,
            padding: "10px 13px",
            fontSize: 12.5,
            color: "#b4543a",
          }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit || pending}
        className="pk-btn-accent"
        style={{
          marginTop: 22,
          padding: "11px 18px",
          fontSize: 13.5,
          opacity: !canSubmit || pending ? 0.55 : 1,
          cursor: !canSubmit || pending ? "default" : "pointer",
        }}
      >
        {pending ? "Setting up…" : "Continue to builder →"}
      </button>
    </div>
  );
}

const inlineLinkStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--accent)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "underline",
};

const skipLinkStyle: CSSProperties = {
  justifySelf: "start",
  background: "none",
  border: "none",
  padding: 0,
  color: "#8c919c",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
