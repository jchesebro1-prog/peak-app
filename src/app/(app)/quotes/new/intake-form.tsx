"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition, type CSSProperties } from "react";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import EntityQuickAdd, { INPUT, LABEL, type QuickAddValues } from "@/components/entity-quick-add";
import { createQuoteIntakeAction } from "./actions";
import { SERVICE_TYPES, type IntakeCustomer, type IntakeSubmit, type ServiceType } from "./types";

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
  // #110: the user-named category behind the trailing "Custom category" card.
  const [category, setCategory] = useState("");

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerMode, setCustomerMode] = useState<"pick" | "new">("pick");
  const [customerId, setCustomerId] = useState("");
  const [newCustomer, setNewCustomer] = useState<QuickAddValues["customer"]>({
    name: "",
    type: CUSTOMER_TYPES[0] || "",
  });

  const [locationMode, setLocationMode] = useState<"pick" | "new" | "skip">("skip");
  const [locationId, setLocationId] = useState("");
  const [newLocation, setNewLocation] = useState<QuickAddValues["venue"]>({
    label: "",
    city: "",
    state: "",
  });

  const [contactMode, setContactMode] = useState<"pick" | "new" | "skip">("skip");
  const [contactName, setContactName] = useState("");
  const [newContact, setNewContact] = useState<QuickAddValues["contact"]>({
    name: "",
    role: "",
    email: "",
    phone: "",
  });

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

  const customerReady =
    (customerMode === "pick" && !!customerId) ||
    (customerMode === "new" && newCustomer.name.trim().length > 0);
  // A custom category needs its name before the builder can be seeded with it.
  const canSubmit = customerReady && (type !== "custom" || category.trim().length > 0);

  function submit() {
    if (!canSubmit || pending) return;
    setError("");
    const payload: IntakeSubmit = {
      type,
      category: type === "custom" ? category.trim() : "",
      name: "",
      replaces: "",
      customerMode,
      customerId,
      newCustomerName: newCustomer.name,
      newCustomerType: newCustomer.type,
      locationMode,
      locationId,
      newLocationLabel: newLocation.label,
      newLocationCity: newLocation.city,
      newLocationState: newLocation.state,
      contactMode,
      contactName,
      newContactName: newContact.name,
      newContactRole: newContact.role,
      newContactEmail: newContact.email,
      newContactPhone: newContact.phone,
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
      <label style={{ ...LABEL, margin: "0 0 8px" }}>Quote type</label>
      <div style={{ display: "grid", gap: 8 }}>
        {SERVICE_TYPES.map((s) => {
          const active = type === s.key;
          return (
            <Fragment key={s.key}>
              <button
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
              {s.key === "custom" && active && (
                <div>
                  <label style={{ ...LABEL, margin: "0 0 6px" }}>Category name</label>
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Acoustic treatment"
                    style={INPUT}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* ---- customer ---- */}
      <label style={LABEL}>Customer</label>
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
        <div style={{ marginTop: 8 }}>
          <EntityQuickAdd kind="customer" value={newCustomer} onChange={setNewCustomer} />
        </div>
      )}

      {/* ---- venue (skippable) ---- */}
      <label style={LABEL}>Venue</label>
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
        <div style={{ marginTop: locations.length > 0 ? 8 : 0 }}>
          <EntityQuickAdd
            kind="venue"
            value={newLocation}
            onChange={setNewLocation}
            onCancel={() => {
              setLocationMode("skip");
              setNewLocation({ label: "", city: "", state: "" });
            }}
          />
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
      <label style={LABEL}>Contact</label>
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
        <div style={{ marginTop: contacts.length > 0 ? 8 : 0 }}>
          <EntityQuickAdd
            kind="contact"
            value={newContact}
            onChange={setNewContact}
            onCancel={() => {
              setContactMode("skip");
              setNewContact({ name: "", role: "", email: "", phone: "" });
            }}
          />
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
