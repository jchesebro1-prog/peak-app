"use client";

/* ============================================================
 * Customer & venue section. Lifted out of controls.tsx verbatim — the
 * customer linkage state and its setters arrive as props.
 * ============================================================ */

import { AUDITORIUM_SIZES } from "@/lib/stores/survey-intake";
import type { Draft, EditorCustomer } from "./types";
import { ACCENT, inpStyle, labelStyle, selStyle } from "./styles";

export interface CustVenueProps {
  draft: Draft;
  patchDraft: (patch: Partial<Draft>) => void;
  setField: <K extends keyof Draft>(key: K, val: Draft[K]) => void;
  customers: EditorCustomer[];
  venueTypes: string[];
  linkedCust: EditorCustomer | null;
  custLocs: EditorCustomer["locations"];
  venueHasLocs: boolean;
  custNew: boolean;
  setCustNew: (v: boolean) => void;
  venueOther: boolean;
  setCustomerSel: (val: string) => void;
  setVenueSel: (val: string) => void;
}

export function CustVenueSection({
  draft,
  patchDraft,
  setField,
  customers,
  venueTypes,
  linkedCust,
  custLocs,
  venueHasLocs,
  custNew,
  setCustNew,
  venueOther,
  setCustomerSel,
  setVenueSel,
}: CustVenueProps) {
  let customerOptions = customers.map((c) => ({ value: c.id, label: c.name }));
  if (draft.customerId && !linkedCust) customerOptions = customerOptions.concat([{ value: draft.customerId, label: draft.customer || draft.customerId }]);
  const custMetaSuffix = linkedCust ? " · " + [linkedCust.type, linkedCust.location].filter(Boolean).join(" · ") : "";
  const venuePickMode = venueHasLocs && !venueOther;
  return (
    <>
      <div style={{ marginBottom: 13 }}>
        <label style={labelStyle}>Customer</label>
        <select value={draft.customerId ? draft.customerId : custNew ? "__new__" : ""} onChange={(e) => setCustomerSel(e.target.value)} style={selStyle}>
          <option value="">— Select customer —</option>
          {customerOptions.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
          <option value="__new__">+ New customer (not in directory)</option>
        </select>
        {linkedCust && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, fontSize: 11.5, color: "#8c919c" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: ACCENT, flexShrink: 0 }} />
            <span>Linked to directory{custMetaSuffix}</span>
          </div>
        )}
        {custNew && (
          <input value={draft.customer} onChange={(e) => { setCustNew(true); patchDraft({ customer: e.target.value, customerId: null }); }} placeholder="New customer name — e.g. Harbor Repertory Theatre" style={{ ...inpStyle, marginTop: 9 }} />
        )}
      </div>
      <div className="sv-grid">
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Venue</label>
          {venuePickMode ? (
            <select value={draft.locationId ? draft.locationId : venueOther ? "__other__" : ""} onChange={(e) => setVenueSel(e.target.value)} style={selStyle}>
              <option value="">— Select venue —</option>
              {custLocs.map((l) => (
                <option key={l.id} value={l.id}>{l.label + (l.city ? " · " + l.city : "")}</option>
              ))}
              <option value="__other__">Other venue…</option>
            </select>
          ) : (
            <input value={draft.venue} onChange={(e) => patchDraft({ venue: e.target.value, locationId: null })} placeholder={linkedCust ? "e.g. Main Hall" : "e.g. Main Auditorium"} style={inpStyle} />
          )}
        </div>
        <div>
          <label style={labelStyle}>Venue type</label>
          <select value={draft.venueType} onChange={(e) => setField("venueType", e.target.value)} style={selStyle}>
            {venueTypes.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Site address</label>
          <input value={draft.address} onChange={(e) => setField("address", e.target.value)} placeholder="Street, City, State" style={inpStyle} />
        </div>
        <div>
          <label style={labelStyle}>On-site contact</label>
          <input value={draft.contact} onChange={(e) => setField("contact", e.target.value)} placeholder="Name" style={inpStyle} />
        </div>
        <div>
          <label style={labelStyle}>Contact phone</label>
          <input type="tel" value={draft.contactPhone} onChange={(e) => setField("contactPhone", e.target.value)} placeholder="(000) 000-0000" style={inpStyle} />
        </div>
        <div>
          <label style={labelStyle}>Contact email</label>
          <input type="email" value={draft.contactEmail} onChange={(e) => setField("contactEmail", e.target.value)} placeholder="name@venue.org" style={inpStyle} />
        </div>
        <div>
          <label style={labelStyle}>Auditorium size</label>
          <select value={draft.auditoriumSize} onChange={(e) => setField("auditoriumSize", e.target.value)} style={selStyle}>
            <option value="">— Select —</option>
            {AUDITORIUM_SIZES.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Built year</label>
          <input inputMode="numeric" value={draft.yearBuilt} onChange={(e) => setField("yearBuilt", e.target.value)} placeholder="e.g. 1998" style={inpStyle} />
        </div>
      </div>
    </>
  );
}
