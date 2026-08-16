"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { venueTravelAction, type VenueTravel } from "../../quote-builder-travel";
import type { CSSProperties } from "react";
import { saveFlameQuote, approveFlameQuote } from "./actions";
import { SearchableSelect } from "@/components/searchable-select";

/**
 * QuoteBuilder — the auto-priced flame-test quote estimator (client port of
 * Flame Test Quote.dc.html). Holds the ephemeral builder state (customer,
 * venue toggles, curtain counts, margin/rate knobs) and previews pricing live
 * with the flametest-engine math inlined below (the engine module itself pulls
 * in the server doc-store, so it can't be imported into a client bundle —
 * Save/Approve re-price server-side in actions.ts).
 */

/* ---------- serializable props from the server page ---------- */

export type BuilderLocation = {
  id: string;
  label: string;
  city: string;
  state: string;
  primary: boolean;
  coords: { lat: number; lng: number } | null;
  oneWayMiles: number | null;
  oneWayMin: number | null;
};
export type BuilderContact = { name: string; role: string; email: string; primary: boolean   /** Personal tier margin when the contact has their own tier (item 11). */
  tierMargin?: number | null;
};
export type BuilderCustomer = {
  id: string;
  name: string;
  locations: BuilderLocation[];
  contacts: BuilderContact[];
  /** Company-level tier margin fraction (item 11, D88); null → Base/global. */
  tierMargin?: number | null;
};
export type BuilderOffice = { name: string; lat: number | null; lng: number | null };
export type BuilderRates = {
  mileageRate: number;
  laborRate: number;
  curtainMinutes: number;
  baseFee: number;
  margin: number;
  travelRoundMin: number;
};
export type BuilderInitial = {
  editingId: string | null;
  customerId: string;
  quoteName: string;
  venueSel: Record<string, { on: boolean; curtains: string }>;
  contactSel: string;
  contactManual: string;
  saved: boolean;
  approved: boolean;
  savedId: string;
};

/* ---------- inlined pure pricing (port of flametest-engine.ts) ---------- */

type Coords = { lat: number; lng: number } | null;
type VenueIn = {
  id: string;
  label: string;
  curtains: number;
  coords: Coords;
  oneWayMiles: number | null;
  oneWayMin: number | null;
};

function roundUpTo(min: number, step: number): number {
  if (min == null || isNaN(min)) return 0;
  const s = step || 15;
  return Math.ceil(min / s) * s;
}
function toRad(d: number): number {
  return (d * Math.PI) / 180;
}
function haversine(a: Coords | BuilderOffice, b: Coords | BuilderOffice): number | null {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function driveMiles(a: Coords | BuilderOffice, b: Coords | BuilderOffice): number | null {
  const m = haversine(a, b);
  return m == null ? null : Math.round(m * 1.25);
}
function driveMinutes(a: Coords | BuilderOffice, b: Coords | BuilderOffice): number | null {
  const mi = driveMiles(a, b);
  return mi == null ? null : Math.round((mi / 50) * 60);
}
function nearestOffice(offices: BuilderOffice[], target: Coords): BuilderOffice | null {
  let best: BuilderOffice | null = null;
  let bestD = Infinity;
  offices.forEach((o) => {
    const d = haversine(o, target);
    if (d != null && d < bestD) {
      bestD = d;
      best = o;
    }
  });
  return best;
}

type PerVenue = { id: string; label: string; curtains: number; laborCost: number };
type Trip = {
  miles: number;
  minutes: number;
  mileageCost: number;
  timeCost: number;
  total: number;
};
type Pricing = {
  perVenue: PerVenue[];
  curtainsTotal: number;
  venueCount: number;
  trip: Trip;
  cost: number;
  rawCost: number;
  baseApplied: boolean;
  margin: number;
  marginAmount: number;
  total: number;
};

function priceVenue(v: VenueIn, rates: BuilderRates): PerVenue {
  const curtains = Math.max(0, Math.round(Number(v.curtains) || 0));
  const laborMin = curtains * rates.curtainMinutes;
  const laborCost = laborMin * (rates.laborRate / 60);
  return { id: v.id, label: v.label || "Venue", curtains, laborCost };
}
function tripTravel(office: BuilderOffice | null, venues: VenueIn[], rates: BuilderRates): Trip {
  let miles = 0;
  let minutes = 0;
  const coordVenues = venues.filter((v) => v.coords && v.coords.lat != null);
  if (office && office.lat != null && coordVenues.length === venues.length && venues.length > 0) {
    const seq: (Coords | BuilderOffice)[] = [office, ...venues.map((v) => v.coords), office];
    for (let i = 0; i < seq.length - 1; i++) {
      const m = driveMiles(seq[i], seq[i + 1]);
      const t = driveMinutes(seq[i], seq[i + 1]);
      if (m != null) miles += m;
      if (t != null) minutes += t;
    }
  } else {
    let maxMi = 0;
    let maxMin = 0;
    venues.forEach((v) => {
      const mi = Number(v.oneWayMiles) || 0;
      if (mi > maxMi) {
        maxMi = mi;
        maxMin = Number(v.oneWayMin) || 0;
      }
    });
    miles = maxMi * 2;
    minutes = maxMin * 2;
  }
  const minutesBilled = roundUpTo(minutes, rates.travelRoundMin);
  const mileageCost = miles * rates.mileageRate;
  const timeCost = (minutesBilled / 60) * rates.laborRate;
  return {
    miles: Math.round(miles),
    minutes: minutesBilled,
    mileageCost,
    timeCost,
    total: mileageCost + timeCost,
  };
}
function computePricing(office: BuilderOffice | null, venues: VenueIn[], rates: BuilderRates): Pricing {
  const perVenue = venues.map((v) => priceVenue(v, rates));
  const testingSubtotal = perVenue.reduce((a, v) => a + v.laborCost, 0);
  const curtainsTotal = perVenue.reduce((a, v) => a + v.curtains, 0);
  const trip = tripTravel(office, venues, rates);
  const rawCost = trip.total + testingSubtotal;
  const baseApplied = rawCost < rates.baseFee;
  const cost = baseApplied ? rates.baseFee : rawCost;
  const margin = rates.margin;
  const total = margin > 0 && margin < 1 ? cost / (1 - margin) : cost;
  return {
    perVenue,
    curtainsTotal,
    venueCount: venues.length,
    trip,
    cost,
    rawCost,
    baseApplied,
    margin,
    marginAmount: total - cost,
    total,
  };
}

/* ---------- display helpers ---------- */
function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}
function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return m + "m";
  return h + "h" + (m ? " " + m + "m" : "");
}

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
const VGRID = "34px minmax(0,1fr) 118px 92px";

const CSS = `
  select.ftq-sel { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238c919c' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 34px !important; }
  @media (max-width: 900px) {
    .ftq-grid { grid-template-columns: 1fr !important; }
    .ftq-side { position: static !important; }
  }
`;

export function QuoteBuilder({
  customers,
  offices,
  rates: baseRates,
  initial,
  me,
  accent,
}: {
  customers: BuilderCustomer[];
  offices: BuilderOffice[];
  rates: BuilderRates;
  initial: BuilderInitial;
  me: string;
  accent: string;
}) {
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [quoteName, setQuoteName] = useState(initial.quoteName);
  const [venueSel, setVenueSel] = useState(initial.venueSel);
  const [contactSel, setContactSel] = useState(initial.contactSel);
  const [contactManual, setContactManual] = useState(initial.contactManual);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [marginPts, setMarginPts] = useState(Math.round(baseRates.margin * 100));
  const [mileageRate, setMileageRate] = useState(baseRates.mileageRate.toFixed(2));
  const [laborRate, setLaborRate] = useState(String(Math.round(baseRates.laborRate)));
  const [savedFlag, setSavedFlag] = useState(initial.saved || initial.approved);
  const [pending, startTransition] = useTransition();

  const editingId = initial.editingId;
  const savedId = initial.savedId;
  const isApproved = initial.approved;

  const dirty = () => setSavedFlag(false);

  const customer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId]
  );
  /* Venue travel arrives for the OPENED customer only (punch #90); every other
     customer resolves when it is picked. Merged over the directory copy here
     so `locations` stays the single source the venue list, the trip-mileage
     math and the saved venues all read. */
  const [venueTravel, setVenueTravel] = useState<
    Record<string, Record<string, VenueTravel>>
  >({});
  const locations = useMemo(() => {
    const base = customer?.locations || [];
    const fetched = customer ? venueTravel[customer.id] : undefined;
    if (!fetched) return base;
    return base.map((l) => ({
      ...l,
      oneWayMiles: fetched[l.id]?.miles ?? l.oneWayMiles,
      oneWayMin: fetched[l.id]?.minutes ?? l.oneWayMin,
    }));
  }, [customer, venueTravel]);
  /** Fetch a customer's venue travel once, the first time it is selected. */
  const ensureVenueTravel = (id: string) => {
    if (!id || venueTravel[id]) return;
    const already = customer?.id === id && (customer.locations || []).some((l) => l.oneWayMiles != null);
    if (already) return; // server already seeded the opened customer
    startTransition(async () => {
      const t = await venueTravelAction(id);
      setVenueTravel((m) => (m[id] ? m : { ...m, [id]: t }));
    });
  };
  const contacts = customer?.contacts || [];

  function pickCustomer(id: string) {
    ensureVenueTravel(id);
    const c = customers.find((x) => x.id === id) || null;
    const locs = c?.locations || [];
    const sel: Record<string, { on: boolean; curtains: string }> = {};
    locs.forEach((l) => {
      sel[l.id] = { on: !!l.primary || locs.length === 1, curtains: "" };
    });
    if (locs.length && !locs.some((l) => sel[l.id].on)) sel[locs[0].id].on = true;
    const primary = c?.contacts.find((x) => x.primary) || c?.contacts[0] || null;
    setCustomerId(id);
    // Seed the margin knob from the customer's tier (contact's own tier
    // wins; item 11, D88). Still just a seed — the knob stays editable.
    {
      const seeded = primary?.tierMargin ?? c?.tierMargin;
      if (seeded != null && seeded > 0 && seeded < 1)
        setMarginPts(Math.round(seeded * 100));
    }
    setVenueSel(sel);
    setQuoteName(c ? c.name + " — Flame test" : "");
    setContactSel(primary ? primary.name : "");
    setContactManual("");
    setSavedFlag(false);
  }
  function toggleVenue(locId: string) {
    setVenueSel((prev) => {
      const cur = prev[locId] || { on: false, curtains: "" };
      return { ...prev, [locId]: { ...cur, on: !cur.on } };
    });
    dirty();
  }
  function setCurtains(locId: string, val: string) {
    const clean = val === "" ? "" : String(Math.max(0, Math.floor(+val || 0)));
    setVenueSel((prev) => {
      const cur = prev[locId] || { on: true, curtains: "" };
      return { ...prev, [locId]: { ...cur, curtains: clean, on: true } };
    });
    dirty();
  }

  /* ---- live pricing ---- */
  const liveRates: BuilderRates = {
    mileageRate: parseFloat(mileageRate) || baseRates.mileageRate,
    laborRate: parseFloat(laborRate) || baseRates.laborRate,
    curtainMinutes: baseRates.curtainMinutes,
    baseFee: baseRates.baseFee,
    margin: marginPts / 100,
    travelRoundMin: baseRates.travelRoundMin,
  };
  const selectedVenues: VenueIn[] = locations
    .filter((l) => venueSel[l.id]?.on)
    .map((l) => ({
      id: l.id,
      label: l.label,
      curtains: +(venueSel[l.id]?.curtains || 0) || 0,
      coords: l.coords,
      oneWayMiles: l.oneWayMiles,
      oneWayMin: l.oneWayMin,
    }));
  const hasCustomer = !!customer;
  const firstCoords = selectedVenues.map((v) => v.coords).find((c) => c && c.lat != null) || null;
  const office = (firstCoords ? nearestOffice(offices, firstCoords) : null) || offices[0] || null;
  const r =
    hasCustomer && selectedVenues.length
      ? computePricing(office, selectedVenues, liveRates)
      : null;
  const chargeById = new Map((r?.perVenue || []).map((p) => [p.id, p]));

  const canSave = hasCustomer && selectedVenues.length > 0;
  const showApprove = canSave && !isApproved;

  /* ---- selected contact (recipient of the letter) ---- */
  function selectedContact(): { name: string; role: string; email: string } | null {
    if (contactSel === "__other__") {
      const n = contactManual.trim();
      return n ? { name: n, role: "", email: "" } : null;
    }
    if (!contactSel) return null;
    const c = contacts.find((x) => x.name === contactSel);
    return c
      ? { name: c.name, role: c.role || "", email: c.email || "" }
      : { name: contactSel, role: "", email: "" };
  }
  const contactMeta = selectedContact()?.email || "";

  /* ---- submit ---- */
  function buildForm(): FormData {
    const fd = new FormData();
    fd.set("editingId", editingId || "");
    fd.set("customerId", customerId);
    fd.set("quoteName", quoteName);
    const c = selectedContact();
    fd.set("contactName", c?.name || "");
    fd.set("contactRole", c?.role || "");
    fd.set("contactEmail", c?.email || "");
    fd.set("margin", String(marginPts));
    fd.set("mileageRate", mileageRate);
    fd.set("laborRate", laborRate);
    fd.set(
      "venues",
      JSON.stringify(selectedVenues.map((v) => ({ id: v.id, label: v.label, curtains: v.curtains })))
    );
    return fd;
  }
  function doSave() {
    if (!canSave || pending) return;
    startTransition(() => saveFlameQuote(buildForm()));
  }
  function doApprove() {
    if (!canSave || pending) return;
    startTransition(() => approveFlameQuote(buildForm()));
  }

  /* ---- derived breakdown labels ---- */
  const trip = r?.trip || { miles: 0, minutes: 0, mileageCost: 0, timeCost: 0, total: 0 };
  const mileageDetail = trip.miles
    ? Math.round(trip.miles).toLocaleString("en-US") +
      " mi rt × $" +
      liveRates.mileageRate.toFixed(2)
    : "round trip";
  const timeDetail = trip.minutes
    ? fmtTime(trip.minutes) + " rt × $" + Math.round(liveRates.laborRate) + "/hr"
    : "rounded to 15 min";
  const venueCount = r?.venueCount || 0;
  const curtainsTotal = r?.curtainsTotal || 0;
  const total = r?.total || 0;
  const totalSub = venueCount
    ? venueCount +
      " venue" +
      (venueCount === 1 ? "" : "s") +
      " · " +
      curtainsTotal +
      " curtain" +
      (curtainsTotal === 1 ? "" : "s")
    : "No venues selected";
  const letterHref = savedId ? "/flame-tests/letter?id=" + encodeURIComponent(savedId) : "";

  return (
    <div className="pk-content" style={{ fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <style>{CSS}</style>

      <Link
        href="/quotes"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          fontWeight: 600,
          color: "#8c919c",
          textDecoration: "none",
          marginBottom: 14,
        }}
      >
        ← Quotes
      </Link>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>
              Flame test quote
            </div>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".05em",
                textTransform: "uppercase",
                color: "#b4543a",
                background: "#f7e9e5",
                border: "1px solid #f0d6cd",
                padding: "3px 8px",
                borderRadius: 5,
              }}
            >
              Auto-priced
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>
            Auto-priced from travel distance, curtain count, and multi-venue bundling. Adjust rates
            below before saving.
          </div>
        </div>
      </div>

      <div
        className="ftq-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 358px",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ===== MAIN ===== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              padding: "18px 20px",
              display: "grid",
              gap: 14,
            }}
          >
            <div>
              <label style={LABEL}>Customer</label>
              <SearchableSelect className="ftq-sel" value={customerId} onValueChange={pickCustomer}
                options={customers.map((c) => ({ value: c.id, label: c.name, keywords: c.locations.map((l) => `${l.label} ${l.city}`).join(" ") }))}
                placeholder="Select a customer…" searchPlaceholder="Search customers…" buttonStyle={{ ...FIELD, fontWeight: 600 }} />
            </div>
            <div>
              <label style={LABEL}>Quote name</label>
              <input
                value={quoteName}
                onChange={(e) => {
                  setQuoteName(e.target.value);
                  dirty();
                }}
                placeholder="e.g. Lakefront PAC — Annual flame test"
                style={FIELD}
              />
            </div>
            <div>
              <label style={LABEL}>
                Contact{" "}
                <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "#c0c5cd" }}>
                  · addressed to on the letter
                </span>
              </label>
              <select
                className="ftq-sel"
                value={contactSel}
                onChange={(e) => {
                  setContactSel(e.target.value);
                  dirty();
                }}
                style={{ ...FIELD, cursor: "pointer" }}
              >
                <option value="">No contact — TBD</option>
                {contacts.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name + (c.role ? " — " + c.role : "")}
                  </option>
                ))}
                <option value="__other__">Other — enter name…</option>
              </select>
              {contactSel === "__other__" && (
                <input
                  value={contactManual}
                  onChange={(e) => {
                    setContactManual(e.target.value);
                    dirty();
                  }}
                  placeholder="Contact name"
                  style={{ ...FIELD, marginTop: 9 }}
                />
              )}
              {contactMeta && (
                <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 6 }}>{contactMeta}</div>
              )}
            </div>
          </div>

          {hasCustomer ? (
            <div
              style={{
                background: "#fff",
                border: "1px solid #ececf0",
                borderRadius: 13,
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "15px 20px 12px",
                }}
              >
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Venues to test</div>
                <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                  Toggle a venue on and enter its curtain count
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: VGRID,
                  gap: 12,
                  padding: "0 20px 8px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#aab0bb",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                <span />
                <span>Venue</span>
                <span style={{ textAlign: "center" }}>Curtains</span>
                <span style={{ textAlign: "right" }}>Testing</span>
              </div>
              {locations.map((l) => {
                const st = venueSel[l.id] || { on: false, curtains: "" };
                const on = !!st.on;
                const pc = chargeById.get(l.id);
                const cityBit = [l.city, l.state].filter(Boolean).join(", ");
                const miBit =
                  l.oneWayMiles != null ? " · ~" + Math.round(l.oneWayMiles) + " mi one-way" : "";
                return (
                  <div
                    key={l.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: VGRID,
                      gap: 12,
                      alignItems: "center",
                      padding: "12px 20px",
                      borderTop: "1px solid #f3f4f7",
                      background: on ? "#fff" : "#fcfcfd",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleVenue(l.id)}
                      title="Include this venue"
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        fontWeight: 700,
                        lineHeight: 1,
                        cursor: "pointer",
                        padding: 0,
                        color: "#fff",
                        border: "1.5px solid " + (on ? accent : "#cfd3da"),
                        background: on ? accent : "#fff",
                      }}
                    >
                      {on ? "✓" : ""}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          lineHeight: 1.25,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          color: on ? "#16181d" : "#9aa0ab",
                        }}
                      >
                        {l.label}
                      </div>
                      <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 2 }}>
                        {(cityBit || "Location") + miBit}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={st.curtains}
                      onChange={(e) => setCurtains(l.id, e.target.value)}
                      disabled={!on}
                      placeholder="0"
                      style={{
                        width: "100%",
                        fontFamily: "var(--font-mono)",
                        fontSize: 14,
                        textAlign: "center",
                        color: on ? "#16181d" : "#c0c5cd",
                        background: on ? "#fff" : "#f7f8fa",
                        border: "1px solid #e4e7ec",
                        borderRadius: 8,
                        padding: "9px 8px",
                        boxSizing: "border-box",
                      }}
                    />
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13.5,
                        fontWeight: 600,
                        textAlign: "right",
                        color: on ? "#16181d" : "#c0c5cd",
                      }}
                    >
                      {on && pc ? money(pc.laborCost) : "—"}
                    </div>
                  </div>
                );
              })}
              <div
                style={{
                  padding: "12px 20px 16px",
                  borderTop: "1px solid #f3f4f7",
                  fontSize: 11.5,
                  color: "#9aa0ab",
                  lineHeight: 1.55,
                }}
              >
                Travel is charged once for the whole trip and shared across venues; curtain testing
                is {baseRates.curtainMinutes} min each. A {money(baseRates.baseFee)} base minimum
                applies to the whole quote once mileage, travel time, and testing are totaled.
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "#fff",
                border: "1px dashed #d9dce2",
                borderRadius: 13,
                padding: "40px 20px",
                textAlign: "center",
                color: "#9aa0ab",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Pick a customer to load its venues and auto-price the flame test.
            </div>
          )}
        </div>

        {/* ===== BREAKDOWN SIDEBAR ===== */}
        <div className="ftq-side" style={{ position: "sticky", top: 16 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 3px rgba(0,0,0,.06)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 18px 14px", background: "#16181d", color: "#fff" }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "#9aa0ab",
                }}
              >
                Quote total
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 32,
                  fontWeight: 600,
                  letterSpacing: "-.01em",
                  marginTop: 4,
                }}
              >
                {money(total)}
              </div>
              <div style={{ fontSize: 11.5, color: "#aab0bb", marginTop: 3 }}>{totalSub}</div>
            </div>

            <div style={{ padding: "15px 18px" }}>
              <SubHead>
                Trip travel{" "}
                <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#c0c5cd" }}>
                  · shared once
                </span>
              </SubHead>
              <BreakRow label={"Mileage · " + mileageDetail} value={money(trip.mileageCost)} />
              <BreakRow label={"Travel time · " + timeDetail} value={money(trip.timeCost)} last />

              <SubHead style={{ marginTop: 16 }}>
                Testing · {venueCount} venue{venueCount === 1 ? "" : "s"}
              </SubHead>
              {(r?.perVenue || []).map((p) => (
                <BreakRow
                  key={p.id}
                  label={p.label + " · " + p.curtains + " curtain" + (p.curtains === 1 ? "" : "s")}
                  value={money(p.laborCost)}
                  ellipsis
                />
              ))}

              <div style={{ borderTop: "1px solid #eceef1", marginTop: 13, paddingTop: 12 }}>
                <BreakRow label="Cost subtotal" value={money(r?.cost || 0)} />
                {r?.baseApplied && (
                  <div style={{ fontSize: 10.5, color: "#b4543a", margin: "-2px 0 8px", lineHeight: 1.45 }}>
                    Raised to the {money(baseRates.baseFee)} base minimum — travel + testing came to{" "}
                    {money(r.rawCost)}.
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    fontSize: 12.5,
                    marginBottom: 5,
                  }}
                >
                  <span style={{ color: "#5b616e" }}>Margin · {marginPts} pts</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#1f7a52" }}>
                    +{money(r?.marginAmount || 0)}
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={1}
                  value={marginPts}
                  onChange={(e) => {
                    setMarginPts(Math.round(+e.target.value));
                    dirty();
                  }}
                  style={{ width: "100%", accentColor: accent, cursor: "pointer", margin: "2px 0 0" }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 9.5,
                    color: "#c0c5cd",
                    margin: "-2px 0 9px",
                  }}
                >
                  <span>10 pts</span>
                  <span>50 pts</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    fontSize: 14,
                    fontWeight: 700,
                    marginTop: 4,
                    paddingTop: 9,
                    borderTop: "1px solid #f0f1f4",
                  }}
                >
                  <span>Total</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{money(total)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setRatesOpen((v) => !v)}
                style={{
                  marginTop: 14,
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontFamily: "var(--font-ui)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#8c919c",
                  background: "#f7f8fa",
                  border: "1px solid #eef0f3",
                  borderRadius: 9,
                  padding: "9px 12px",
                  cursor: "pointer",
                }}
              >
                <span>Rates &amp; assumptions</span>
                <span
                  style={{
                    fontSize: 11,
                    transition: "transform .15s ease",
                    transform: ratesOpen ? "rotate(180deg)" : "none",
                  }}
                >
                  ▾
                </span>
              </button>
              {ratesOpen && (
                <div
                  style={{
                    marginTop: 10,
                    border: "1px solid #eef0f3",
                    borderRadius: 10,
                    padding: "12px 13px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 11,
                  }}
                >
                  <div>
                    <label style={{ ...LABEL, fontSize: 10, letterSpacing: ".04em", marginBottom: 5 }}>
                      Federal mileage rate ($/mi)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={mileageRate}
                      onChange={(e) => {
                        setMileageRate(e.target.value);
                        dirty();
                      }}
                      style={{ ...FIELD, fontFamily: "var(--font-mono)", fontSize: 13, padding: "8px 10px" }}
                    />
                    <div style={{ fontSize: 10, color: "#aab0bb", marginTop: 4, lineHeight: 1.4 }}>
                      IRS standard rate in effect at time of estimate.
                    </div>
                  </div>
                  <div>
                    <label style={{ ...LABEL, fontSize: 10, letterSpacing: ".04em", marginBottom: 5 }}>
                      Labor rate ($/hr)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min={0}
                      value={laborRate}
                      onChange={(e) => {
                        setLaborRate(e.target.value);
                        dirty();
                      }}
                      style={{ ...FIELD, fontFamily: "var(--font-mono)", fontSize: 13, padding: "8px 10px" }}
                    />
                  </div>
                  <div style={{ fontSize: 10.5, color: "#9aa0ab", lineHeight: 1.5 }}>
                    {baseRates.curtainMinutes} min/curtain · travel time rounded up to{" "}
                    {baseRates.travelRoundMin} min · {money(baseRates.baseFee)} job minimum ·{" "}
                    {marginPts}-pt margin on top. Multiple venues on one quote share a single round
                    trip.
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={doSave}
                disabled={!canSave || pending}
                style={{
                  marginTop: 14,
                  width: "100%",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: 12,
                  cursor: canSave && !pending ? "pointer" : "not-allowed",
                  background: canSave ? accent : "#c8ccd3",
                  boxSizing: "border-box",
                }}
              >
                {savedFlag ? "Saved ✓" : editingId ? "Update quote" : "Save quote"}
              </button>

              {showApprove && (
                <button
                  type="button"
                  onClick={doApprove}
                  disabled={pending}
                  style={{
                    marginTop: 9,
                    width: "100%",
                    fontFamily: "var(--font-ui)",
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "#1f7a52",
                    background: "#eaf6ef",
                    border: "1px solid #cce9da",
                    borderRadius: 10,
                    padding: 11,
                    cursor: pending ? "not-allowed" : "pointer",
                    boxSizing: "border-box",
                  }}
                >
                  Mark as approved
                </button>
              )}

              {isApproved && (
                <div
                  style={{
                    marginTop: 9,
                    border: "1px solid #cce9da",
                    background: "#eaf6ef",
                    borderRadius: 10,
                    padding: "12px 13px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#1f7a52",
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "#1f7a52",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </span>
                    Approved
                  </div>
                  <div style={{ fontSize: 11.5, color: "#3a6650", marginTop: 6, lineHeight: 1.5 }}>
                    Accepted — now an approved flame-test job, ready to schedule.
                  </div>
                  <Link
                    href="/flame-tests/scheduling"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      marginTop: 9,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#1f7a52",
                      textDecoration: "none",
                    }}
                  >
                    Schedule this test →
                  </Link>
                </div>
              )}

              {letterHref && (
                <Link
                  href={letterHref}
                  style={{
                    marginTop: 9,
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    fontSize: 13,
                    fontWeight: 600,
                    color: accent,
                    background: "#fff",
                    border: "1px solid #e4e7ec",
                    borderRadius: 10,
                    padding: 11,
                    textDecoration: "none",
                    boxSizing: "border-box",
                  }}
                >
                  Preview quote letter →
                </Link>
              )}

              {savedFlag && savedId && (
                <div style={{ marginTop: 10, textAlign: "center", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>
                  Saved {savedId} ·{" "}
                  <Link href="/quotes" style={{ color: "#8c919c" }}>
                    Back to Quotes
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubHead({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color: "#9aa0ab",
        letterSpacing: ".05em",
        textTransform: "uppercase",
        marginBottom: 9,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function BreakRow({
  label,
  value,
  last,
  ellipsis,
}: {
  label: string;
  value: string;
  last?: boolean;
  ellipsis?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        fontSize: 12.5,
        marginBottom: last ? 0 : 7,
      }}
    >
      <span
        style={{
          color: "#5b616e",
          minWidth: 0,
          ...(ellipsis
            ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 8 }
            : {}),
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, flexShrink: 0 }}>{value}</span>
    </div>
  );
}
