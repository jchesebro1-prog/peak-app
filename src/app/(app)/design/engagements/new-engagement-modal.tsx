"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CustomerCombobox } from "@/components/customer-combobox";
import EntityQuickAdd, { INPUT, LABEL, type QuickAddValues } from "@/components/entity-quick-add";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import type { ManualFee } from "@/lib/consulting-stages";
import type { CustomerLite } from "./data";
import { createManualEngagementAction } from "./actions";

/**
 * "+ New consulting project" (#135) — the hub's way to open an engagement
 * that never had a fee proposal. Customer pick (or quick-add), name,
 * architect, venue, optional fee (fixed or milestone rows). Same scrim +
 * card idiom as the Settings location modal; no window.confirm/prompt.
 */

type FeeMode = "none" | "fixed" | "milestones";
type MilestoneRow = { name: string; date: string; amount: string };

const SMALL_BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 11px",
  background: "#fff",
  color: "#3a3f4a",
  cursor: "pointer",
};

const SEG: React.CSSProperties = { ...SMALL_BTN, borderRadius: 7 };
const SEG_ON: React.CSSProperties = { ...SEG, background: "#16181d", color: "#fff", borderColor: "#16181d" };
const FIELD_ERR: React.CSSProperties = { marginTop: 6, fontSize: 11.5, color: "#b4543a" };

const blankRow = (): MilestoneRow => ({ name: "", date: "", amount: "" });

/** Matches `cleanFee`'s server-side cap (engagements/actions.ts): it keeps
 *  the first 20 milestone rows and drops the rest, so a longer list could
 *  pass this form's fee check on a row the server never sees and come back
 *  rejected. Capped here the way the Settings cards cap "+ Add field". */
const MAX_MILESTONES = 20;

export function NewEngagementModal({
  customers,
  onClose,
}: {
  customers: CustomerLite[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState<QuickAddValues["customer"]>({ name: "", type: CUSTOMER_TYPES[0] });
  const [name, setName] = useState("");
  const [architectCompany, setArchitectCompany] = useState("");
  const [architectContact, setArchitectContact] = useState("");
  const [siteId, setSiteId] = useState("");
  const [contactName, setContactName] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>("none");
  const [fixedAmount, setFixedAmount] = useState("");
  const [rows, setRows] = useState<MilestoneRow[]>([blankRow()]);

  const customer = customers.find((c) => c.id === customerId) || null;
  const hasCustomer = newCustomerOpen ? !!newCustomer.name.trim() : !!customerId;

  // #135 review fix: "No fee yet" is an explicit, always-valid choice — the
  // other two modes must actually carry a fee before they can submit. A
  // blank/zero amount or an all-blank milestone list used to submit
  // silently with no fee and no error (manualMilestoneSeeds just drops it).
  const feeError =
    feeMode === "fixed" && !(Number(fixedAmount) > 0)
      ? "Enter the fee amount."
      : feeMode === "milestones" && !rows.some((r) => r.name.trim() && Number(r.amount) > 0)
        ? "Add at least one milestone with an amount."
        : null;

  const canSubmit = !pending && !!name.trim() && hasCustomer && !feeError;

  const fee = (): ManualFee | undefined => {
    if (feeMode === "fixed") return { mode: "fixed", amount: Number(fixedAmount) || 0 };
    if (feeMode === "milestones") {
      return {
        mode: "milestones",
        milestones: rows.map((r) => ({
          name: r.name.trim(),
          targetDate: r.date ? new Date(r.date + "T12:00:00").getTime() : 0,
          amount: Number(r.amount) || 0,
        })),
      };
    }
    return undefined;
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await createManualEngagementAction({
        customerId: newCustomerOpen ? "" : customerId,
        newCustomer: newCustomerOpen ? newCustomer : null,
        name,
        architect: { company: architectCompany, contact: architectContact },
        siteId: newCustomerOpen ? "" : siteId,
        contactName,
        fee: fee(),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      router.push(`/design/engagements/${encodeURIComponent(r.id)}`);
      router.refresh();
    });

  const patchRow = (i: number, p: Partial<MilestoneRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(16,22,30,.46)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, zIndex: 60 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="New consulting project"
        style={{ width: 560, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: 15, boxShadow: "0 24px 70px rgba(0,0,0,.32)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "17px 22px", borderBottom: "1px solid #f0f1f4" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>New consulting project</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...SMALL_BTN, padding: "4px 9px" }}>×</button>
        </div>

        <div style={{ padding: "4px 22px 18px" }}>
          <label style={LABEL}>Customer</label>
          {newCustomerOpen ? (
            <>
              <EntityQuickAdd kind="customer" value={newCustomer} onChange={setNewCustomer} />
              <button
                type="button"
                onClick={() => setNewCustomerOpen(false)}
                style={{ background: "none", border: "none", padding: 0, marginTop: 6, color: "#8c919c", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Pick an existing customer instead
              </button>
            </>
          ) : (
            <>
              <CustomerCombobox
                options={customers.map((c) => ({
                  id: c.id,
                  name: c.name,
                  detail: c.locations.length ? c.locations.map((l) => l.label).slice(0, 3).join(" · ") : "No venues on file",
                  searchText: [...c.locations.map((l) => l.label), ...c.contactNames].join(" "),
                }))}
                value={customerId}
                onChange={(id) => { setCustomerId(id); setSiteId(""); }}
                placeholder="Search customers…"
                inputStyle={INPUT}
              />
              <button
                type="button"
                onClick={() => setNewCustomerOpen(true)}
                style={{ background: "none", border: "none", padding: 0, marginTop: 6, color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                + Add a new customer
              </button>
            </>
          )}

          <label style={LABEL}>Project name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={customer ? `${customer.name} — Consulting` : "e.g. Auditorium renovation study"} style={INPUT} />

          {!newCustomerOpen && customer && customer.locations.length > 0 && (
            <>
              <label style={LABEL}>Venue</label>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={INPUT}>
                <option value="">— none —</option>
                {customer.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </>
          )}

          <label style={LABEL}>Architect</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input value={architectCompany} onChange={(e) => setArchitectCompany(e.target.value)} placeholder="Architecture firm" style={INPUT} />
            <input value={architectContact} onChange={(e) => setArchitectContact(e.target.value)} placeholder="Contact (name / email)" style={INPUT} />
          </div>

          <label style={LABEL}>Customer contact</label>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Name (optional)" style={INPUT} list="ne-contacts" />
          {customer && customer.contactNames.length > 0 && (
            <datalist id="ne-contacts">
              {customer.contactNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          )}

          <label style={LABEL}>Fee</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([["none", "No fee yet"], ["fixed", "Fixed fee"], ["milestones", "Milestones"]] as Array<[FeeMode, string]>).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFeeMode(k)} style={feeMode === k ? SEG_ON : SEG}>{l}</button>
            ))}
          </div>
          {feeMode === "fixed" && (
            <input
              value={fixedAmount}
              onChange={(e) => setFixedAmount(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="$ amount"
              inputMode="numeric"
              style={{ ...INPUT, marginTop: 8, maxWidth: 200 }}
            />
          )}
          {feeMode === "milestones" && (
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 150px 110px 30px", gap: 6, alignItems: "center" }}>
                  <input value={r.name} onChange={(e) => patchRow(i, { name: e.target.value })} placeholder="Milestone name" style={INPUT} />
                  <input type="date" value={r.date} onChange={(e) => patchRow(i, { date: e.target.value })} style={INPUT} />
                  <input value={r.amount} onChange={(e) => patchRow(i, { amount: e.target.value.replace(/[^\d]/g, "") })} placeholder="$" inputMode="numeric" style={INPUT} />
                  <button type="button" aria-label="Remove milestone" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} style={{ ...SMALL_BTN, padding: "6px 0", textAlign: "center" }}>×</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setRows((rs) => (rs.length >= MAX_MILESTONES ? rs : [...rs, blankRow()]))}
                disabled={rows.length >= MAX_MILESTONES}
                style={{
                  ...SMALL_BTN,
                  justifySelf: "start",
                  opacity: rows.length >= MAX_MILESTONES ? 0.5 : 1,
                  cursor: rows.length >= MAX_MILESTONES ? "default" : "pointer",
                }}
              >
                + Add milestone
              </button>
              {rows.length >= MAX_MILESTONES && (
                <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                  {MAX_MILESTONES} milestones is the maximum — remove a row to add another.
                </div>
              )}
            </div>
          )}
          {feeError && <div style={FIELD_ERR}>{feeError}</div>}
          <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 8 }}>
            A fee proposal can be attached later from the engagement page; the project opens at Awarded.
          </div>

          {error && (
            <div style={{ marginTop: 12, background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#b4543a" }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 22px", borderTop: "1px solid #f0f1f4" }}>
          <button type="button" onClick={onClose} style={SMALL_BTN}>Cancel</button>
          <button
            type="button"
            className="pk-btn-accent"
            disabled={!canSubmit}
            onClick={submit}
            style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}
          >
            {pending ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
