"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { INPUT, LABEL } from "@/components/entity-quick-add";
import CustomerVenueContactPicker, {
  customerChoiceOf,
  customerReadyOf,
  initialCustomerVenueContact,
} from "@/components/customer-venue-contact-picker";
import type { VenueType } from "@/lib/venue-types";
import { createQuoteIntakeAction } from "./actions";
import { replaceConfirmMessage, sameBuilder, type IntakeInitial, type IntakeReplacing } from "./handoff";
import { SERVICE_TYPES, type IntakeCustomer, type IntakeSubmit, type ServiceType } from "./types";

export default function QuoteIntakeForm({
  customers,
  initial,
  replacing,
  threadId,
  venueTypes,
}: {
  customers: IntakeCustomer[];
  initial: IntakeInitial;
  replacing: IntakeReplacing | null;
  /** #123 — set when opened from the Inbox's "+ New quote"; the intake
   *  mints the draft quote, links the thread and returns to the Inbox. */
  threadId?: string;
  venueTypes: VenueType[];
}) {
  const fromThread = !!threadId;
  const [type, setType] = useState<ServiceType>(initial.type);
  // #110: the user-named category behind the trailing "Custom category" card.
  const [category, setCategory] = useState(initial.category);
  // #160: optional quote name — blank lets the builder auto-name.
  const [name, setName] = useState(initial.name);

  // #244 — customer / venue / contact live in the shared picker (the Grid
  // intake uses it too); one value, same opening state as before.
  const [pick, setPick] = useState(() =>
    initialCustomerVenueContact(
      { customerId: initial.customerId, locationId: initial.locationId, contactName: initial.contactName },
      venueTypes
    )
  );

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

  const customerReady = customerReadyOf(pick);
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
      ...customerChoiceOf(pick),
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
        {replacing ? `← Back to ${replacing.number}` : "← Quotes"}
      </Link>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: "#16181d", margin: "6px 0 3px" }}>
        {replacing ? "Change quote type" : "New quote"}
      </h1>
      <p style={{ fontSize: 13, color: "#8c919c", margin: "0 0 22px" }}>
        {replacing
          ? `Pick the new type for ${replacing.number}. It is replaced when the new quote is first saved.`
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

      <CustomerVenueContactPicker customers={customers} value={pick} onChange={setPick} venueTypes={venueTypes} />

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
            {replaceConfirmMessage(replacing.number, replacing.lines)}
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
            ? `Back to ${replacing.number} →`
            : fromThread
              ? "Create quote & link thread"
              : "Continue to builder →"}
      </button>
    </div>
  );
}
