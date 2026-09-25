"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition, type CSSProperties } from "react";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import { CustomerCombobox } from "@/components/customer-combobox";
import EntityQuickAdd, { INPUT, LABEL, type QuickAddValues } from "@/components/entity-quick-add";
import { createQuoteIntakeAction } from "./actions";
import { replaceConfirmMessage, sameBuilder, type IntakeInitial, type IntakeReplacing } from "./handoff";
import { SERVICE_TYPES, type IntakeCustomer, type IntakeSubmit, type ServiceType } from "./types";

const ADD_NEW = "__add_new__";
const SKIP = "__skip__";

function locationLine(l: IntakeCustomer["locations"][number]): string {
  const where = [l.city, l.state].filter(Boolean).join(", ");
  return where ? `${l.label || "Venue"} — ${where}` : l.label || "Venue";
}

export default function QuoteIntakeForm({
  customers,
  initial,
  replacing,
  threadId,
}: {
  customers: IntakeCustomer[];
  initial: IntakeInitial;
  replacing: IntakeReplacing | null;
  /** #123 — set when opened from the Inbox's "+ New quote"; the intake
   *  mints the draft quote, links the thread and returns to the Inbox. */
  threadId?: string;
}) {
  const fromThread = !!threadId;
  const [type, setType] = useState<ServiceType>(initial.type);
  // #110: the user-named category behind the trailing "Custom category" card.
  const [category, setCategory] = useState(initial.category);
  // #160: optional quote name — blank lets the builder auto-name.
  const [name, setName] = useState(initial.name);

  const [customerMode, setCustomerMode] = useState<"pick" | "new">("pick");
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [newCustomer, setNewCustomer] = useState<QuickAddValues["customer"]>({
    name: "",
    type: CUSTOMER_TYPES[0] || "",
  });

  const [locationMode, setLocationMode] = useState<"pick" | "new" | "skip">(initial.locationId ? "pick" : "skip");
  const [locationId, setLocationId] = useState(initial.locationId);
  const [newLocation, setNewLocation] = useState<QuickAddValues["venue"]>({
    label: "",
    city: "",
    state: "",
  });

  const [contactMode, setContactMode] = useState<"pick" | "new" | "skip">(initial.contactName ? "pick" : "skip");
  const [contactName, setContactName] = useState(initial.contactName);
  const [newContact, setNewContact] = useState<QuickAddValues["contact"]>({
    name: "",
    role: "",
    email: "",
    phone: "",
  });

  const [error, setError] = useState("");
  // I4 review — the thread this intake was opened from already links
  // something else; offers "Open it" / an explicit "Create another" confirm
  // rather than silently overwriting that link.
  const [linkedElsewhere, setLinkedElsewhere] = useState<{ label: string; href: string } | null>(null);
  const [pending, startTransition] = useTransition();
  // #178 — window.confirm() silently returns false with no dialog in this
  // app's Capacitor shells, so the old `!window.confirm(...)` check just
  // silently swallowed the submit. Two-step inline confirm instead: the
  // first Continue click shows the notice below, a second click (its own
  // "Continue" button) actually submits.
  const [confirmReplace, setConfirmReplace] = useState(false);

  const selectedCustomer = customerMode === "pick" ? customers.find((c) => c.id === customerId) || null : null;
  const locations = selectedCustomer?.locations || [];
  const contacts = selectedCustomer?.contacts || [];
  // A customer is "in play" once one is picked or a new one is being named —
  // that's when the venue/contact steps make sense to show at all.
  const hasCustomerContext = customerMode === "new" || !!customerId;

  // #160: the shared typeahead replaces the search box + closed <select>
  // pair, which filtered options nobody could see. Venue city and contact
  // names are searchable too.
  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        detail:
          [c.type, c.locations.map((l) => l.label).filter(Boolean).slice(0, 3).join(" · ")].filter(Boolean).join(" — ") ||
          undefined,
        searchText: [
          ...c.locations.map((l) => `${l.label} ${l.city} ${l.state}`),
          ...c.contacts.map((ct) => ct.name),
        ].join(" "),
      })),
    [customers]
  );

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
    // D205: a different builder means a NEW quote; the old draft goes on its
    // first save. Same builder → the server just reopens the old quote.
    if (replacing && !sameBuilder(type, replacing.type) && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    doSubmit();
  }

  function doSubmit(confirmReplaceLink?: boolean) {
    setConfirmReplace(false);
    setError("");
    if (!confirmReplaceLink) setLinkedElsewhere(null);
    const payload: IntakeSubmit = {
      type,
      category: type === "custom" ? category.trim() : "",
      name: name.trim(),
      replaces: replacing?.id || "",
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
      threadId: threadId || undefined,
      confirmReplaceLink,
    };
    startTransition(async () => {
      const res = await createQuoteIntakeAction(payload);
      // A successful call redirect()s server-side and never returns here.
      if (res && !res.ok) {
        if ("linkedElsewhere" in res) setLinkedElsewhere({ label: res.linkedElsewhere.label, href: res.linkedElsewhere.href });
        else setError(res.error);
      }
    });
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "26px 22px 60px", fontFamily: "var(--font-ui)" }}>
      <Link href={replacing ? replacing.editPath : "/quotes"} style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
        {replacing ? `← Back to ${replacing.id}` : "← Quotes"}
      </Link>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: "#16181d", margin: "6px 0 3px" }}>
        {replacing ? "Change quote type" : "New quote"}
      </h1>
      <p style={{ fontSize: 13, color: "#8c919c", margin: "0 0 22px" }}>
        {replacing
          ? `Pick the new type for ${replacing.id}. It is replaced when the new quote is first saved.`
          : fromThread
            ? "Pick who this is for. A draft quote is created, linked to the email thread, and you land back on the thread."
            : "Pick who this is for, then jump straight into the builder."}
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
                onClick={() => {
                  setType(s.key);
                  setConfirmReplace(false);
                }}
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
      {customerMode === "pick" ? (
        <>
          <CustomerCombobox
            options={customerOptions}
            value={customerId}
            onChange={(id) => pickCustomer(id)}
            placeholder="Search customers, venues or contacts…"
            inputStyle={INPUT}
          />
          <button type="button" onClick={() => pickCustomer(ADD_NEW)} style={{ ...inlineLinkStyle, marginTop: 7 }}>
            + Add new customer…
          </button>
        </>
      ) : (
        <EntityQuickAdd
          kind="customer"
          value={newCustomer}
          onChange={setNewCustomer}
          onCancel={() => pickCustomer("")}
        />
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

      {/* ---- quote name (optional, #160) ---- */}
      <label style={LABEL}>Quote name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Optional — leave blank to name it automatically"
        style={INPUT}
      />

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

      {/* I4 review — the thread already links something that isn't an
          inbox-minted draft for this customer; never overwritten silently. */}
      {linkedElsewhere && (
        <div
          style={{
            marginTop: 18,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            background: "#fdf8ee",
            border: "1px solid #f0e2bd",
            borderRadius: 9,
            padding: "10px 13px",
            fontSize: 12.5,
            color: "#8a6d1f",
          }}
        >
          <span style={{ flex: 1, minWidth: 200 }}>
            This thread is already linked to <strong>{linkedElsewhere.label}</strong>.
          </span>
          <Link
            href={linkedElsewhere.href}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "#8a6d1f",
              textDecoration: "underline",
            }}
          >
            Open it
          </Link>
          <button
            type="button"
            onClick={() => doSubmit(true)}
            disabled={pending}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "#fff",
              background: "#b4863a",
              border: "none",
              borderRadius: 6,
              padding: "5px 11px",
              cursor: pending ? "default" : "pointer",
            }}
          >
            Create another
          </button>
        </div>
      )}

      {confirmReplace && replacing && (
        <div
          style={{
            marginTop: 18,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            background: "#fdf8ee",
            border: "1px solid #f0e2bd",
            borderRadius: 9,
            padding: "10px 13px",
            fontSize: 12.5,
            color: "#8a6d1f",
          }}
        >
          <span style={{ flex: 1, minWidth: 200 }}>
            {replaceConfirmMessage(replacing.id, replacing.lines)}
          </span>
          <button
            type="button"
            onClick={() => doSubmit()}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "#fff",
              background: "#b4863a",
              border: "none",
              borderRadius: 6,
              padding: "5px 11px",
              cursor: "pointer",
            }}
          >
            Continue
          </button>
          <button
            type="button"
            onClick={() => setConfirmReplace(false)}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "#8a6d1f",
              background: "none",
              border: "1px solid #f0e2bd",
              borderRadius: 6,
              padding: "5px 11px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
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
        {pending
          ? "Setting up…"
          : replacing && sameBuilder(type, replacing.type)
            ? `Back to ${replacing.id} →`
            : fromThread
              ? "Create quote & link thread"
              : "Continue to builder →"}
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
