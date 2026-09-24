"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { saveConsultingQuote } from "./actions";
import { money } from "@/lib/format";
import { CustomerCombobox } from "@/components/customer-combobox";
import { ChangeTypeControl, useWonEditGuard } from "@/components/quote-flow-controls";

/**
 * Consulting proposal builder (#35 rebuild, spec §1). Structured scopes
 * (title + description + fee — the proposal total assembles from scope
 * fees), a tickable assumptions checklist seeded from the Settings-editable
 * library (ticked texts freeze onto the proposal at save), terms, and the
 * phase selection that seeds the engagement when the proposal is SENT
 * (spec §1 spawn model — no longer on win). Still deliberately fee-based:
 * no engine, no travel, and NO pricing tiers (pricingTier/tierMargin stay
 * unset).
 *
 * Pre-rebuild quotes (free-text scope + fixed/milestone fees) show their
 * old content read-only below the scope rows; saving always writes
 * structured scopes, so editing a legacy quote means carrying its content
 * into the rows (the revision trail keeps the original).
 */

export type BuilderCustomer = {
  id: string;
  name: string;
  locations: Array<{ id: string; label: string }>;
  contacts: Array<{ name: string; role: string; email: string; primary: boolean }>;
};

export type BuilderScope = { id: string; title: string; description: string; fee: number };

export type BuilderInitial = {
  id: string;
  name: string;
  customerId: string;
  venueCustomerId: string;
  locationId: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  /** #35 structured content (empty arrays on pre-rebuild quotes). */
  scopes: BuilderScope[];
  assumptions: string[];
  /** Pre-rebuild payload — rendered read-only when scopes is empty. */
  legacyScope: string;
  legacyFeeMode: "fixed" | "milestones";
  legacyFees: Array<{ name: string; amount: number }>;
  terms: string;
  phases: string[];
  /** #145 D165 — disciplines bought; seeds the engagement's `disciplines`
   *  the same way `phases` seeds its phases when the proposal is sent. */
  disciplines: string[];
  status: string;
};

/** Display label for a stored (lowercased) discipline — "av" -> "AV",
 *  everything else title-cased on its first letter only (the vocabulary is
 *  admin free-text and may not match any known acronym). */
function disciplineLabel(d: string): string {
  return d.length <= 2 ? d.toUpperCase() : d.charAt(0).toUpperCase() + d.slice(1);
}

type ScopeRow = { id: string; title: string; description: string; fee: string };

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
  disciplineMenu,
  assumptionsMenu,
  initial,
  pre,
  justSaved,
}: {
  customers: BuilderCustomer[];
  phaseMenu: string[];
  /** #145 D165 — the discipline vocabulary (Settings-editable). */
  disciplineMenu: string[];
  /** Merged assumptions library (Settings-editable, DRAFT default seed). */
  assumptionsMenu: string[];
  initial: BuilderInitial | null;
  pre: { customerId: string; venueId: string; contactName: string; name: string; replaces: string };
  justSaved: boolean;
}) {
  const [customerId, setCustomerId] = useState(
    initial?.customerId || pre.customerId || ""
  );
  const architect = customers.find((c) => c.id === customerId) || null;
  const [venueCustomerId, setVenueCustomerId] = useState(
    initial?.venueCustomerId || initial?.customerId || pre.customerId || ""
  );
  const venueCustomer = customers.find((c) => c.id === venueCustomerId) || null;

  const preContact = !initial ? customers.find((c) => c.id === pre.customerId)?.contacts.find((c) => c.name === pre.contactName) : undefined;
  const [quoteName, setQuoteName] = useState(initial?.name || pre.name || "");
  const [quoteNameEdited, setQuoteNameEdited] = useState(!!initial?.name || !!pre.name);
  const [locationId, setLocationId] = useState(initial?.locationId || pre.venueId || "");
  const [contactName, setContactName] = useState(initial?.contactName || preContact?.name || "");
  const [contactRole, setContactRole] = useState(initial?.contactRole || preContact?.role || "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail || preContact?.email || "");
  const [terms, setTerms] = useState(initial?.terms || "");
  const guardWon = useWonEditGuard(initial?.status || "draft");

  /* ---- structured scopes (#35) ---- */
  const [scopeRows, setScopeRows] = useState<ScopeRow[]>(
    initial?.scopes.length
      ? initial.scopes.map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          fee: s.fee ? String(s.fee) : "",
        }))
      : [{ id: "", title: "", description: "", fee: "" }]
  );
  const setRow = (i: number, patch: Partial<ScopeRow>) =>
    setScopeRows(scopeRows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /* ---- assumptions checklist (#35): menu = library + any ticked texts an
     older save carried that the library no longer lists + one-off adds ---- */
  const [customAdds, setCustomAdds] = useState<string[]>([]);
  const menu = useMemo(() => {
    const extra = (initial?.assumptions || []).filter((a) => !assumptionsMenu.includes(a));
    const custom = customAdds.filter((a) => !assumptionsMenu.includes(a) && !extra.includes(a));
    return [...assumptionsMenu, ...extra, ...custom];
  }, [assumptionsMenu, initial, customAdds]);
  const [ticked, setTicked] = useState<string[]>(initial ? initial.assumptions : []);
  const [newAssumption, setNewAssumption] = useState("");
  const [assumptionEdits, setAssumptionEdits] = useState<Record<string, string>>({});
  const toggle = (a: string) =>
    setTicked(ticked.includes(a) ? ticked.filter((x) => x !== a) : [...ticked, a]);

  // Phase menu + any custom phases already on the edited quote.
  const phaseOptions = useMemo(() => {
    const extra = (initial?.phases || []).filter((p) => !phaseMenu.includes(p));
    return [...phaseMenu, ...extra];
  }, [phaseMenu, initial]);
  const [phases, setPhases] = useState<string[]>(
    initial ? initial.phases : phaseMenu.slice()
  );

  // Discipline menu + any custom disciplines already on the edited quote
  // (mirrors phaseOptions just above).
  const disciplineOptions = useMemo(() => {
    const extra = (initial?.disciplines || []).filter((d) => !disciplineMenu.includes(d));
    return [...disciplineMenu, ...extra];
  }, [disciplineMenu, initial]);
  const [disciplines, setDisciplines] = useState<string[]>(
    initial ? initial.disciplines : disciplineMenu.slice()
  );

  const pickContact = (name: string) => {
    const ct = architect?.contacts.find((c) => c.name === name);
    setContactName(name);
    if (ct) {
      setContactRole(ct.role || "");
      setContactEmail(ct.email || "");
    }
  };

  const scopes = scopeRows
    .map((r) => ({
      id: r.id,
      title: r.title.trim(),
      description: r.description.trim(),
      fee: Math.round(Number(r.fee) || 0),
    }))
    .filter((s) => s.title || s.description || s.fee > 0);
  const total = scopes.reduce((a, s) => a + s.fee, 0);
  /** The ticked texts, in menu order — frozen onto the proposal at save. */
  const assumptions = menu.filter((a) => ticked.includes(a)).map((a) => (assumptionEdits[a] ?? a).trim()).filter(Boolean);
  const canSave = !!customerId && !!venueCustomerId && total > 0;
  const legacy =
    initial && !initial.scopes.length && (initial.legacyScope || initial.legacyFees.length)
      ? initial
      : null;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "26px 22px 60px", fontFamily: "var(--font-ui)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: "#16181d", margin: 0 }}>
          {initial ? `Consulting proposal ${initial.id}` : "New consulting proposal"}
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
        {initial && <ChangeTypeControl quoteId={initial.id} status={initial.status} />}
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
          Saved. Review and send from the Quotes hub — sending opens the engagement at Proposal sent; winning advances it to Awarded.
        </div>
      )}

      <form action={saveConsultingQuote}>
        {initial && <input type="hidden" name="editingId" value={initial.id} />}
        {!initial && pre.replaces && <input type="hidden" name="replaces" value={pre.replaces} />}
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="venueCustomerId" value={venueCustomerId} />
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="scopes" value={JSON.stringify(scopes)} />
        <input type="hidden" name="assumptions" value={JSON.stringify(assumptions)} />
        <input type="hidden" name="phases" value={JSON.stringify(phases)} />
        <input type="hidden" name="disciplines" value={JSON.stringify(disciplines)} />

        <label style={LBL}>Customer (Architect / billed party)</label>
        <CustomerCombobox
          options={customers.map((c) => ({
            id: c.id,
            name: c.name,
            detail: c.contacts[0]?.name || "No primary contact",
            searchText: c.contacts.map((x) => `${x.name} ${x.email}`).join(" "),
          }))}
          value={customerId}
          canChange={() => guardWon("customer")}
          onChange={(id) => { setCustomerId(id); if (!quoteNameEdited) setQuoteName([customers.find((c) => c.id === id)?.name, venueCustomer?.locations.find((l) => l.id === locationId)?.label || venueCustomer?.name, "Consulting", String(new Date().getFullYear())].filter(Boolean).join(" - ")); }}
          placeholder="Search architect or billed customer…"
          inputStyle={INPUT}
        />

        <label style={LBL}>Venue (Location / venue owner)</label>
        <CustomerCombobox
          options={customers.map((c) => ({
            id: c.id,
            name: c.name,
            detail: c.locations.length ? c.locations.map((l) => l.label).slice(0, 3).join(" · ") : "No venues on file",
            searchText: c.locations.map((l) => l.label).join(" "),
          }))}
          value={venueCustomerId}
          canChange={() => guardWon("venue")}
          onChange={(id) => {
            setVenueCustomerId(id);
            setLocationId("");
            if (!quoteNameEdited) setQuoteName([architect?.name, customers.find((c) => c.id === id)?.name, "Consulting", String(new Date().getFullYear())].filter(Boolean).join(" - "));
          }}
          placeholder="Search venue company or location…"
          inputStyle={INPUT}
        />

        {venueCustomer && venueCustomer.locations.length > 0 && (
          <>
            <label style={LBL}>Venue site</label>
            <select value={locationId} onChange={(e) => { if (!guardWon("venue")) return; setLocationId(e.target.value); if (!quoteNameEdited) setQuoteName([architect?.name, venueCustomer.locations.find((l) => l.id === e.target.value)?.label || venueCustomer.name, "Consulting", String(new Date().getFullYear())].filter(Boolean).join(" - ")); }} style={INPUT}>
              <option value="">— none —</option>
              {venueCustomer.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </>
        )}

        <label style={LBL}>Quote name</label>
        <input
          name="quoteName"
          value={quoteName}
          onChange={(e) => { setQuoteName(e.target.value); setQuoteNameEdited(true); }}
          placeholder={venueCustomer ? venueCustomer.name + " — Consulting" : "Consulting engagement"}
          style={INPUT}
        />

        <label style={LBL}>Contact</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <input
            name="contactName"
            value={contactName}
            onChange={(e) => { if (!guardWon("contact")) return; pickContact(e.target.value); }}
            placeholder="Name"
            list="consulting-contacts"
            style={INPUT}
          />
          <datalist id="consulting-contacts">
            {(architect?.contacts || []).map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
          <input name="contactRole" value={contactRole} onChange={(e) => setContactRole(e.target.value)} placeholder="Role" style={INPUT} />
          <input name="contactEmail" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email" style={INPUT} />
        </div>

        <label style={LBL}>Scopes of work (title · description · fee)</label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 9 }}>
          {["Audio / Video", "Lighting", "Rigging / Curtains"].map((title) => (
            <button
              key={title}
              type="button"
              onClick={() => {
                if (scopeRows.some((r) => r.title === title)) return;
                const blank = scopeRows.length === 1 && !scopeRows[0].title && !scopeRows[0].description && !scopeRows[0].fee;
                const row = { id: "", title, description: "", fee: "" };
                setScopeRows(blank ? [row] : [...scopeRows, row]);
              }}
              style={{ fontSize: 12, fontWeight: 600, padding: "6px 10px", border: "1px solid #dfe2e8", borderRadius: 8, background: "#fff", cursor: "pointer", fontFamily: "var(--font-ui)" }}
            >
              + {title}
            </button>
          ))}
          <span style={{ alignSelf: "center", fontSize: 11, color: "#9aa0ab" }}>Fees intentionally left blank for the pricing session.</span>
        </div>
        {scopeRows.map((r, i) => (
          <div key={i} style={{ border: "1px solid #e4e7ec", borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: "#fbfbfc" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 34px", gap: 8 }}>
              <input
                value={r.title}
                onChange={(e) => setRow(i, { title: e.target.value })}
                placeholder={`Scope ${i + 1} (e.g. Theatrical rigging design)`}
                style={INPUT}
              />
              <input
                value={r.fee}
                onChange={(e) => setRow(i, { fee: e.target.value.replace(/[^\d]/g, "") })}
                placeholder="Fee ($)"
                inputMode="numeric"
                style={INPUT}
              />
              <button
                type="button"
                onClick={() => setScopeRows(scopeRows.filter((_, j) => j !== i))}
                title="Remove scope"
                style={{ border: "1px solid #e4e7ec", borderRadius: 8, background: "#fff", color: "#8c919c", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
            <textarea
              value={r.description}
              onChange={(e) => setRow(i, { description: e.target.value })}
              rows={2}
              placeholder="What this scope covers — drawings, specifications, meetings, site visits…"
              style={{ ...INPUT, marginTop: 8, resize: "vertical", lineHeight: 1.6 }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setScopeRows([...scopeRows, { id: "", title: "", description: "", fee: "" }])}
          style={{
            fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "none",
            border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-ui)",
          }}
        >
          + Add scope
        </button>

        {legacy && (
          <div style={{ marginTop: 14, background: "#fdf8ee", border: "1px solid #f0e2bd", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: "#8a6d1f" }}>
            <b>Pre-rebuild proposal content (read-only).</b> Carry what still
            applies into the scope rows above — saving writes structured
            scopes (the revision trail keeps this original).
            {legacy.legacyScope && (
              <div style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "#5b616e" }}>{legacy.legacyScope}</div>
            )}
            {legacy.legacyFees.length > 0 && (
              <div style={{ marginTop: 6, color: "#5b616e" }}>
                {legacy.legacyFeeMode === "fixed" ? "Fixed fee: " : "Milestones: "}
                {legacy.legacyFees.map((f) => `${f.name || "Fee"} ${money(f.amount)}`).join(" · ")}
              </div>
            )}
          </div>
        )}

        <label style={LBL}>Assumptions (ticked lines print on the proposal)</label>
        <div style={{ display: "grid", gap: 5 }}>
          {menu.map((a) => (
            <label key={a} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#3a3f4a", cursor: "pointer" }}>
              <input type="checkbox" checked={ticked.includes(a)} onChange={() => toggle(a)} style={{ marginTop: 2 }} />
              <input value={assumptionEdits[a] ?? a} onChange={(e) => setAssumptionEdits({ ...assumptionEdits, [a]: e.target.value })} style={{ ...INPUT, flex: 1, padding: "5px 8px", marginTop: -5 }} />
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, maxWidth: 560 }}>
          <input
            value={newAssumption}
            onChange={(e) => setNewAssumption(e.target.value)}
            placeholder="Add a one-off assumption…"
            style={{ ...INPUT, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => {
              const a = newAssumption.trim();
              if (!a) return;
              if (!menu.includes(a)) setCustomAdds([...customAdds, a]);
              if (!ticked.includes(a)) setTicked([...ticked, a]);
              setNewAssumption("");
            }}
            style={{
              fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "#fff",
              border: "1px solid #e4e7ec", borderRadius: 8, padding: "0 12px",
              cursor: "pointer", fontFamily: "var(--font-ui)",
            }}
          >
            Add
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 4 }}>
          Standard lines are managed in Settings → Consulting — assumptions library.
        </div>

        <label style={LBL}>Engagement phases (seed the engagement when the proposal is sent)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {phaseOptions.map((p) => {
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

        <label style={LBL}>Disciplines bought (gates which template tasks apply)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {disciplineOptions.map((d) => (
            <label key={d} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#3a3f4a", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={disciplines.includes(d)}
                onChange={() =>
                  setDisciplines(disciplines.includes(d) ? disciplines.filter((x) => x !== d) : [...disciplines, d])
                }
              />
              {disciplineLabel(d)}
            </label>
          ))}
        </div>

        <label style={LBL}>Terms</label>
        <textarea
          name="terms"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          rows={4}
          placeholder="Payment terms, exclusions… (assumptions live in the checklist above)"
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
            {initial ? "Save changes" : "Save proposal"}
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
