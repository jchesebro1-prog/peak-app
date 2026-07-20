"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { saveConsultingQuote } from "./actions";
import { money } from "@/lib/format";

/**
 * Consulting quote form (D90) — deliberately lightweight (spec): scope text,
 * fixed fee OR milestone fee rows, terms, and the phase selection that seeds
 * the engagement on win. Pricing is whatever is typed — no engine, no tiers.
 */

export type BuilderCustomer = {
  id: string;
  name: string;
  locations: Array<{ id: string; label: string }>;
  contacts: Array<{ name: string; role: string; email: string; primary: boolean }>;
};

export type BuilderInitial = {
  id: string;
  name: string;
  customerId: string;
  locationId: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  scope: string;
  feeMode: "fixed" | "milestones";
  fees: Array<{ name: string; amount: number }>;
  terms: string;
  phases: string[];
  status: string;
};

type FeeRow = { name: string; amount: string };

const LBL: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  margin: "16px 0 6px",
};

const INPUT: React.CSSProperties = {
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

export function ConsultingQuoteBuilder({
  customers,
  phaseMenu,
  initial,
  preCustomerId,
  justSaved,
}: {
  customers: BuilderCustomer[];
  phaseMenu: string[];
  initial: BuilderInitial | null;
  preCustomerId: string;
  justSaved: boolean;
}) {
  const [customerId, setCustomerId] = useState(
    initial?.customerId || preCustomerId || ""
  );
  const cust = customers.find((c) => c.id === customerId) || null;

  const [quoteName, setQuoteName] = useState(initial?.name || "");
  const [locationId, setLocationId] = useState(initial?.locationId || "");
  const [contactName, setContactName] = useState(initial?.contactName || "");
  const [contactRole, setContactRole] = useState(initial?.contactRole || "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail || "");
  const [scope, setScope] = useState(initial?.scope || "");
  const [terms, setTerms] = useState(initial?.terms || "");
  const [feeMode, setFeeMode] = useState<"fixed" | "milestones">(
    initial?.feeMode || "fixed"
  );
  const [fixedFee, setFixedFee] = useState(
    initial && initial.feeMode === "fixed" && initial.fees[0]
      ? String(initial.fees[0].amount)
      : ""
  );
  const [rows, setRows] = useState<FeeRow[]>(
    initial && initial.feeMode === "milestones" && initial.fees.length
      ? initial.fees.map((f) => ({ name: f.name, amount: String(f.amount) }))
      : [{ name: "", amount: "" }]
  );
  // Phase menu + any custom phases already on the edited quote.
  const menu = useMemo(() => {
    const extra = (initial?.phases || []).filter((p) => !phaseMenu.includes(p));
    return [...phaseMenu, ...extra];
  }, [phaseMenu, initial]);
  const [phases, setPhases] = useState<string[]>(
    initial ? initial.phases : phaseMenu.slice()
  );

  const pickContact = (name: string) => {
    const ct = cust?.contacts.find((c) => c.name === name);
    setContactName(name);
    if (ct) {
      setContactRole(ct.role || "");
      setContactEmail(ct.email || "");
    }
  };

  const total =
    feeMode === "fixed"
      ? Math.round(Number(fixedFee) || 0)
      : rows.reduce((a, r) => a + (Math.round(Number(r.amount)) || 0), 0);

  const fees =
    feeMode === "fixed"
      ? [{ name: "Fixed fee", amount: Math.round(Number(fixedFee) || 0) }]
      : rows.map((r) => ({
          name: r.name.trim(),
          amount: Math.round(Number(r.amount)) || 0,
        }));

  const canSave = !!customerId && total > 0;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "26px 22px 60px", fontFamily: "var(--font-ui)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: "#16181d", margin: 0 }}>
          {initial ? `Consulting quote ${initial.id}` : "New consulting quote"}
        </h1>
        <span
          style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase",
            color: "#6b4fa1", background: "#f0ebf9", border: "1px solid #ddd2f0",
            padding: "2px 8px", borderRadius: 5,
          }}
        >
          Fee-based
        </span>
        {initial && (
          <Link href="/quotes" style={{ fontSize: 12.5, color: "var(--accent)" }}>
            Manage status &amp; review in Quotes →
          </Link>
        )}
      </div>
      {justSaved && (
        <div
          style={{
            marginTop: 12, background: "#eaf6ef", border: "1px solid #cce9da",
            borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#1f7a52",
          }}
        >
          Saved. Review, send and win this quote from the Quotes hub — winning it opens the engagement.
        </div>
      )}

      <form action={saveConsultingQuote}>
        {initial && <input type="hidden" name="editingId" value={initial.id} />}
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="feeMode" value={feeMode} />
        <input type="hidden" name="fees" value={JSON.stringify(fees)} />
        <input type="hidden" name="phases" value={JSON.stringify(phases)} />

        <label style={LBL}>Customer</label>
        <select
          value={customerId}
          onChange={(e) => {
            setCustomerId(e.target.value);
            setLocationId("");
          }}
          style={INPUT}
        >
          <option value="">Choose a customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {cust && cust.locations.length > 0 && (
          <>
            <label style={LBL}>Site</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={INPUT}>
              <option value="">— none —</option>
              {cust.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </>
        )}

        <label style={LBL}>Quote name</label>
        <input
          name="quoteName"
          value={quoteName}
          onChange={(e) => setQuoteName(e.target.value)}
          placeholder={cust ? cust.name + " — Consulting" : "Consulting engagement"}
          style={INPUT}
        />

        <label style={LBL}>Contact</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <input
            name="contactName"
            value={contactName}
            onChange={(e) => pickContact(e.target.value)}
            placeholder="Name"
            list="consulting-contacts"
            style={INPUT}
          />
          <datalist id="consulting-contacts">
            {(cust?.contacts || []).map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
          <input name="contactRole" value={contactRole} onChange={(e) => setContactRole(e.target.value)} placeholder="Role" style={INPUT} />
          <input name="contactEmail" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email" style={INPUT} />
        </div>

        <label style={LBL}>Scope of work</label>
        <textarea
          name="scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          rows={6}
          placeholder="What Peak is being engaged to design, assess, specify or oversee…"
          style={{ ...INPUT, resize: "vertical", lineHeight: 1.6 }}
        />

        <label style={LBL}>Fee</label>
        <div style={{ display: "flex", background: "#f1f2f5", borderRadius: 9, padding: 3, maxWidth: 340 }}>
          {(
            [
              ["fixed", "Fixed fee"],
              ["milestones", "Milestone schedule"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFeeMode(id)}
              style={{
                flex: 1, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600,
                padding: "8px 8px", borderRadius: 7, border: "none", cursor: "pointer",
                background: feeMode === id ? "#fff" : "transparent",
                color: feeMode === id ? "#16181d" : "#8c919c",
                boxShadow: feeMode === id ? "0 1px 2px rgba(0,0,0,.1)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {feeMode === "fixed" ? (
          <div style={{ marginTop: 10, maxWidth: 220 }}>
            <input
              value={fixedFee}
              onChange={(e) => setFixedFee(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="Fee ($)"
              inputMode="numeric"
              style={INPUT}
            />
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 140px 34px", gap: 8, marginBottom: 8 }}>
                <input
                  value={r.name}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                  placeholder={`Milestone ${i + 1} (e.g. Schematic design complete)`}
                  style={INPUT}
                />
                <input
                  value={r.amount}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d]/g, "") } : x)))
                  }
                  placeholder="$"
                  inputMode="numeric"
                  style={INPUT}
                />
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  title="Remove"
                  style={{ border: "1px solid #e4e7ec", borderRadius: 8, background: "#fff", color: "#8c919c", cursor: "pointer" }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows([...rows, { name: "", amount: "" }])}
              style={{
                fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "none",
                border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-ui)",
              }}
            >
              + Add milestone
            </button>
          </div>
        )}

        <label style={LBL}>Engagement phases (seeds the engagement on win)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {menu.map((p) => {
            const on = phases.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() =>
                  setPhases(on ? phases.filter((x) => x !== p) : [...phases, p])
                }
                style={{
                  fontSize: 12, fontWeight: 600, fontFamily: "var(--font-ui)",
                  padding: "6px 11px", borderRadius: 8, cursor: "pointer",
                  border: on ? "1px solid color-mix(in srgb, var(--accent) 35%, #fff)" : "1px solid #e4e7ec",
                  background: on ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "#fff",
                  color: on ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#8c919c",
                }}
              >
                {p}
              </button>
            );
          })}
        </div>

        <label style={LBL}>Terms &amp; assumptions</label>
        <textarea
          name="terms"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          rows={4}
          placeholder="Payment terms, exclusions, assumptions…"
          style={{ ...INPUT, resize: "vertical", lineHeight: 1.6 }}
        />

        <div
          style={{
            marginTop: 22, display: "flex", alignItems: "center", gap: 14,
            borderTop: "1px solid #eef0f3", paddingTop: 16,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: "#16181d" }}>
            Total {money(total)}
          </div>
          <button
            type="submit"
            disabled={!canSave}
            className="pk-btn-accent"
            style={{ opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "default" }}
          >
            {initial ? "Save changes" : "Save quote"}
          </button>
          {initial && (
            <Link
              href={`/design/engagements/letter?id=${encodeURIComponent(initial.id)}&kind=proposal`}
              style={{ fontSize: 12.5, color: "var(--accent)" }}
            >
              Proposal / agreement →
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
