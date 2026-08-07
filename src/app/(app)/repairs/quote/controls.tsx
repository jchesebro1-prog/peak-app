"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { venueTravelAction, type VenueTravel } from "../../quote-builder-travel";
import type { CSSProperties } from "react";
import { saveRepairQuote, approveRepairQuote } from "./actions";

/**
 * QuoteBuilder — the auto-priced repair estimator (repair twin of the
 * flame-test QuoteBuilder). Holds the ephemeral builder state (customer,
 * venue toggles, scope/parts/labor rows, margin/rate knobs) and previews
 * pricing live with the repair-engine math inlined below (the engine module
 * itself pulls in the server doc-store, so it can't be imported into a
 * client bundle — Save/Approve re-price server-side in actions.ts).
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
  laborRate: number;
  mileageRate: number;
  minCallout: number;
  partsMargin: number;
  margin: number;
  emergencyMult: number;
  travelRoundMin: number;
};
export type BuilderOption = { key: string; label: string };
export type BuilderPartRow = { name: string; qty: string; cost: string };
export type BuilderSource = {
  kind: string;
  refId?: string;
  logId?: number;
  label: string;
} | null;
export type BuilderInitial = {
  editingId: string | null;
  customerId: string;
  quoteName: string;
  venueSel: Record<string, { on: boolean }>;
  contactSel: string;
  contactManual: string;
  category: string;
  priority: string;
  scopeItems: string[];
  notes: string;
  parts: BuilderPartRow[];
  laborHours: string;
  crewSize: string;
  source: BuilderSource;
  saved: boolean;
  approved: boolean;
  savedId: string;
};

/* ---------- inlined pure pricing (port of repair-engine.ts) ---------- */

type Coords = { lat: number; lng: number } | null;
type VenueIn = {
  id: string;
  label: string;
  coords: Coords;
  oneWayMiles: number | null;
  oneWayMin: number | null;
};
type PartIn = { name: string; qty: number; cost: number };

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

type Trip = {
  miles: number;
  minutes: number;
  mileageCost: number;
  timeCost: number;
  total: number;
};
type Pricing = {
  laborHours: number;
  laborRate: number;
  laborCost: number;
  emergency: boolean;
  trip: Trip;
  serviceCost: number;
  serviceSellRaw: number;
  serviceSell: number;
  calloutApplied: boolean;
  parts: Array<PartIn & { extCost: number }>;
  partsCost: number;
  partsSell: number;
  cost: number;
  total: number;
  marginAmount: number;
};

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
function computePricing(
  office: BuilderOffice | null,
  venues: VenueIn[],
  laborHours: number,
  parts: PartIn[],
  emergency: boolean,
  rates: BuilderRates
): Pricing {
  const hours = Math.max(0, Number(laborHours) || 0);
  const laborRate = rates.laborRate * (emergency ? rates.emergencyMult || 1 : 1);
  const laborCost = hours * laborRate;
  const trip = tripTravel(office, venues, rates);
  const serviceCost = laborCost + trip.total;
  const margin = rates.margin;
  const serviceSellRaw =
    margin > 0 && margin < 1 ? serviceCost / (1 - margin) : serviceCost;
  const calloutApplied = serviceSellRaw < rates.minCallout;
  const serviceSell = calloutApplied ? rates.minCallout : serviceSellRaw;
  const priced = parts.map((p) => {
    const qty = Math.max(0, Number(p.qty) || 0);
    const cost = Math.max(0, Number(p.cost) || 0);
    return { name: p.name || "Part", qty, cost, extCost: qty * cost };
  });
  const partsCost = priced.reduce((a, p) => a + p.extCost, 0);
  const pMargin = rates.partsMargin;
  const partsSell =
    pMargin > 0 && pMargin < 1 ? partsCost / (1 - pMargin) : partsCost;
  const total = serviceSell + partsSell;
  const cost = serviceCost + partsCost;
  return {
    laborHours: hours,
    laborRate,
    laborCost,
    emergency,
    trip,
    serviceCost,
    serviceSellRaw,
    serviceSell,
    calloutApplied,
    parts: priced,
    partsCost,
    partsSell,
    cost,
    total,
    marginAmount: total - cost,
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
function fmtHours(h: number): string {
  return (Math.round(h * 100) / 100).toString() + "h";
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
const ROWBTN: CSSProperties = {
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  lineHeight: 1,
  color: "#8c919c",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};
const PGRID = "minmax(0,1fr) 64px 100px 26px";

const CSS = `
  select.rpq-sel { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238c919c' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 34px !important; }
  @media (max-width: 900px) {
    .rpq-grid { grid-template-columns: 1fr !important; }
    .rpq-side { position: static !important; }
    .rpq-two { grid-template-columns: 1fr !important; }
  }
`;

export function QuoteBuilder({
  customers,
  offices,
  rates: baseRates,
  categories,
  priorities,
  initial,
  me,
  accent,
}: {
  customers: BuilderCustomer[];
  offices: BuilderOffice[];
  rates: BuilderRates;
  categories: BuilderOption[];
  priorities: BuilderOption[];
  initial: BuilderInitial;
  me: string;
  accent: string;
}) {
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [quoteName, setQuoteName] = useState(initial.quoteName);
  const [venueSel, setVenueSel] = useState(initial.venueSel);
  const [contactSel, setContactSel] = useState(initial.contactSel);
  const [contactManual, setContactManual] = useState(initial.contactManual);
  const [category, setCategory] = useState(initial.category);
  const [priority, setPriority] = useState(initial.priority);
  const [scopeItems, setScopeItems] = useState(initial.scopeItems);
  const [notes, setNotes] = useState(initial.notes);
  const [parts, setParts] = useState(initial.parts);
  const [laborHours, setLaborHours] = useState(initial.laborHours);
  const [crewSize, setCrewSize] = useState(initial.crewSize);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [marginPts, setMarginPts] = useState(Math.round(baseRates.margin * 100));
  const [mileageRate, setMileageRate] = useState(baseRates.mileageRate.toFixed(2));
  const [laborRate, setLaborRate] = useState(String(Math.round(baseRates.laborRate)));
  const [savedFlag, setSavedFlag] = useState(initial.saved || initial.approved);
  const [pending, startTransition] = useTransition();

  const editingId = initial.editingId;
  const savedId = initial.savedId;
  const isApproved = initial.approved;
  const source = initial.source;
  const letterHref = savedId ? "/repairs/letter?id=" + encodeURIComponent(savedId) : "";

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
    const sel: Record<string, { on: boolean }> = {};
    locs.forEach((l) => {
      sel[l.id] = { on: !!l.primary || locs.length === 1 };
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
    setQuoteName(c ? c.name + " — Repair" : "");
    setContactSel(primary ? primary.name : "");
    setContactManual("");
    setSavedFlag(false);
  }
  function toggleVenue(locId: string) {
    setVenueSel((prev) => {
      const cur = prev[locId] || { on: false };
      return { ...prev, [locId]: { on: !cur.on } };
    });
    dirty();
  }
  function setScopeItem(i: number, val: string) {
    setScopeItems((prev) => prev.map((s, j) => (j === i ? val : s)));
    dirty();
  }
  function removeScopeItem(i: number) {
    setScopeItems((prev) => prev.filter((_, j) => j !== i));
    dirty();
  }
  function setPart(i: number, patch: Partial<BuilderPartRow>) {
    setParts((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    dirty();
  }
  function removePart(i: number) {
    setParts((prev) => prev.filter((_, j) => j !== i));
    dirty();
  }

  /* ---- live pricing ---- */
  const liveRates: BuilderRates = {
    ...baseRates,
    mileageRate: parseFloat(mileageRate) || baseRates.mileageRate,
    laborRate: parseFloat(laborRate) || baseRates.laborRate,
    margin: marginPts / 100,
  };
  const selectedVenues: VenueIn[] = locations
    .filter((l) => venueSel[l.id]?.on)
    .map((l) => ({
      id: l.id,
      label: l.label,
      coords: l.coords,
      oneWayMiles: l.oneWayMiles,
      oneWayMin: l.oneWayMin,
    }));
  const hasCustomer = !!customer;
  const firstCoords = selectedVenues.map((v) => v.coords).find((c) => c && c.lat != null) || null;
  const office = (firstCoords ? nearestOffice(offices, firstCoords) : null) || offices[0] || null;
  const emergency = priority === "emergency";
  const crew = Math.max(1, Math.round(parseFloat(crewSize) || 1));
  const crewHours = (parseFloat(laborHours) || 0) * crew;
  const partsIn: PartIn[] = parts
    .filter((p) => p.name.trim() !== "" || p.qty !== "" || p.cost !== "")
    .map((p) => ({ name: p.name.trim(), qty: +p.qty || 0, cost: +p.cost || 0 }));
  const r =
    hasCustomer && selectedVenues.length
      ? computePricing(office, selectedVenues, crewHours, partsIn, emergency, liveRates)
      : null;

  const canSave = hasCustomer && selectedVenues.length > 0;
  const showApprove = canSave && !isApproved;

  /* ---- selected contact ---- */
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
    fd.set("category", category);
    fd.set("priority", priority);
    fd.set("notes", notes);
    fd.set("laborHours", laborHours);
    fd.set("crewSize", String(crew));
    fd.set("margin", String(marginPts));
    fd.set("mileageRate", mileageRate);
    fd.set("laborRate", laborRate);
    fd.set(
      "venues",
      JSON.stringify(selectedVenues.map((v) => ({ id: v.id, label: v.label })))
    );
    fd.set(
      "items",
      JSON.stringify(scopeItems.map((s) => s.trim()).filter(Boolean))
    );
    fd.set("parts", JSON.stringify(partsIn));
    fd.set("sourceKind", source?.kind || "");
    fd.set("sourceRef", source?.refId || "");
    fd.set("sourceLog", source?.logId != null ? String(source.logId) : "");
    fd.set("sourceLabel", source?.label || "");
    return fd;
  }
  function doSave() {
    if (!canSave || pending) return;
    startTransition(() => saveRepairQuote(buildForm()));
  }
  function doApprove() {
    if (!canSave || pending) return;
    startTransition(() => approveRepairQuote(buildForm()));
  }

  /* ---- derived breakdown labels ---- */
  const trip = r?.trip || { miles: 0, minutes: 0, mileageCost: 0, timeCost: 0, total: 0 };
  const laborDetail = crewHours
    ? fmtHours(crewHours) +
      " × $" +
      Math.round(r?.laborRate || liveRates.laborRate) +
      "/hr" +
      (emergency ? " · emergency ×" + baseRates.emergencyMult : "")
    : "no hours entered";
  const mileageDetail = trip.miles
    ? Math.round(trip.miles).toLocaleString("en-US") +
      " mi rt × $" +
      liveRates.mileageRate.toFixed(2)
    : "round trip";
  const timeDetail = trip.minutes
    ? fmtTime(trip.minutes) + " rt × $" + Math.round(liveRates.laborRate) + "/hr"
    : "rounded to " + baseRates.travelRoundMin + " min";
  const venueCount = selectedVenues.length;
  const pricedParts = (r?.parts || []).filter((p) => p.extCost > 0);
  const total = r?.total || 0;
  const totalSub = venueCount
    ? venueCount +
      " venue" +
      (venueCount === 1 ? "" : "s") +
      " · " +
      (crewHours ? fmtHours(crewHours) + " crew" : "no labor") +
      " · " +
      pricedParts.length +
      " part" +
      (pricedParts.length === 1 ? "" : "s")
    : "No venues selected";
  const partsPts = Math.round(baseRates.partsMargin * 100);

  return (
    <div className="pk-content" style={{ fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <style>{CSS}</style>

      <Link
        href="/repairs"
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
        ← Repairs
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
              Repair quote
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
            Auto-priced from labor hours, shared trip travel, and marked-up parts — never below
            the minimum call-out. Adjust rates below before saving.
          </div>
          {source && (
            <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 6 }}>
              {source.label}
              {source.kind === "inspection" && source.refId && (
                <>
                  {" · "}
                  <Link
                    href={"/inspections?id=" + encodeURIComponent(source.refId)}
                    style={{ color: "#8c919c" }}
                  >
                    open inspection ›
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className="rpq-grid"
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
              <select
                className="rpq-sel"
                value={customerId}
                onChange={(e) => pickCustomer(e.target.value)}
                style={{ ...FIELD, fontWeight: 600, cursor: "pointer" }}
              >
                <option value="">Select a customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={LABEL}>Quote name</label>
              <input
                value={quoteName}
                onChange={(e) => {
                  setQuoteName(e.target.value);
                  dirty();
                }}
                placeholder="e.g. Lakefront PAC — Rope lock replacement"
                style={FIELD}
              />
            </div>
            <div
              className="rpq-two"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
            >
              <div>
                <label style={LABEL}>Category</label>
                <select
                  className="rpq-sel"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    dirty();
                  }}
                  style={{ ...FIELD, cursor: "pointer" }}
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={LABEL}>Priority</label>
                <select
                  className="rpq-sel"
                  value={priority}
                  onChange={(e) => {
                    setPriority(e.target.value);
                    dirty();
                  }}
                  style={{ ...FIELD, cursor: "pointer" }}
                >
                  {priorities.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label +
                        (p.key === "emergency" ? " — labor ×" + baseRates.emergencyMult : "")}
                    </option>
                  ))}
                </select>
                {emergency && (
                  <div style={{ fontSize: 11, color: "#8a2f22", marginTop: 6 }}>
                    After-hours / out-of-service — labor billed at ×{baseRates.emergencyMult}.
                  </div>
                )}
              </div>
            </div>
            <div>
              <label style={LABEL}>
                Contact{" "}
                <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "#c0c5cd" }}>
                  · who approves the work
                </span>
              </label>
              <select
                className="rpq-sel"
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
            <>
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
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>Venues on this trip</div>
                  <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                    Toggle each venue the crew must visit
                  </div>
                </div>
                {locations.map((l) => {
                  const on = !!venueSel[l.id]?.on;
                  const cityBit = [l.city, l.state].filter(Boolean).join(", ");
                  const miBit =
                    l.oneWayMiles != null ? " · ~" + Math.round(l.oneWayMiles) + " mi one-way" : "";
                  return (
                    <div
                      key={l.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "34px minmax(0,1fr)",
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
                  Travel is charged once for the whole trip and shared across venues — mileage
                  plus drive time at the labor rate, rounded up to {baseRates.travelRoundMin} min.
                </div>
              </div>

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
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>Scope of work</div>
                  <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                    What the crew will do on site
                  </div>
                </div>
                {scopeItems.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <input
                      value={s}
                      onChange={(e) => setScopeItem(i, e.target.value)}
                      placeholder="e.g. Replace worn rope locks on line sets 4–9"
                      style={FIELD}
                    />
                    <button
                      type="button"
                      onClick={() => removeScopeItem(i)}
                      title="Remove this item"
                      style={ROWBTN}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setScopeItems((prev) => [...prev, ""]);
                    dirty();
                  }}
                  style={{
                    justifySelf: "start",
                    fontFamily: "var(--font-ui)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: accent,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  + Add scope item
                </button>
                <div>
                  <label style={LABEL}>Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      dirty();
                    }}
                    rows={3}
                    placeholder="Findings, access constraints, recommended approach…"
                    style={{ ...FIELD, resize: "vertical", lineHeight: 1.5 }}
                  />
                </div>
              </div>

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
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Labor &amp; parts</div>
                <div
                  className="rpq-two"
                  style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
                >
                  <div>
                    <label style={LABEL}>Labor hours · per tech</label>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={laborHours}
                      onChange={(e) => {
                        setLaborHours(e.target.value);
                        dirty();
                      }}
                      placeholder="0"
                      style={{ ...FIELD, fontFamily: "var(--font-mono)" }}
                    />
                  </div>
                  <div>
                    <label style={LABEL}>Crew size</label>
                    <input
                      type="number"
                      min={1}
                      step="1"
                      value={crewSize}
                      onChange={(e) => {
                        setCrewSize(e.target.value);
                        dirty();
                      }}
                      placeholder="1"
                      style={{ ...FIELD, fontFamily: "var(--font-mono)" }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: PGRID,
                    gap: 9,
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#aab0bb",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  <span>Part</span>
                  <span style={{ textAlign: "center" }}>Qty</span>
                  <span style={{ textAlign: "right" }}>Unit cost</span>
                  <span />
                </div>
                {parts.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: PGRID,
                      gap: 9,
                      alignItems: "center",
                    }}
                  >
                    <input
                      value={p.name}
                      onChange={(e) => setPart(i, { name: e.target.value })}
                      placeholder="e.g. Rope lock, 3/4”"
                      style={FIELD}
                    />
                    <input
                      type="number"
                      min={0}
                      value={p.qty}
                      onChange={(e) => setPart(i, { qty: e.target.value })}
                      placeholder="0"
                      style={{ ...FIELD, fontFamily: "var(--font-mono)", textAlign: "center", padding: "11px 8px" }}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={p.cost}
                      onChange={(e) => setPart(i, { cost: e.target.value })}
                      placeholder="0.00"
                      style={{ ...FIELD, fontFamily: "var(--font-mono)", textAlign: "right", padding: "11px 10px" }}
                    />
                    <button
                      type="button"
                      onClick={() => removePart(i)}
                      title="Remove this part"
                      style={ROWBTN}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setParts((prev) => [...prev, { name: "", qty: "1", cost: "" }]);
                    dirty();
                  }}
                  style={{
                    justifySelf: "start",
                    fontFamily: "var(--font-ui)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: accent,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  + Add part
                </button>
                <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.55 }}>
                  Parts are marked up {partsPts} pts on cost; labor and travel carry the service
                  margin, floored at the {money(baseRates.minCallout)} minimum call-out.
                </div>
              </div>
            </>
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
              Pick a customer to load its venues and auto-price the repair.
            </div>
          )}
        </div>

        {/* ===== BREAKDOWN SIDEBAR ===== */}
        <div className="rpq-side" style={{ position: "sticky", top: 16 }}>
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
              <SubHead>Labor</SubHead>
              <BreakRow label={"Repair labor · " + laborDetail} value={money(r?.laborCost)} last />

              <SubHead style={{ marginTop: 16 }}>
                Trip travel{" "}
                <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#c0c5cd" }}>
                  · shared once
                </span>
              </SubHead>
              <BreakRow label={"Mileage · " + mileageDetail} value={money(trip.mileageCost)} />
              <BreakRow label={"Travel time · " + timeDetail} value={money(trip.timeCost)} last />

              <div style={{ borderTop: "1px solid #eceef1", marginTop: 13, paddingTop: 12 }}>
                <BreakRow label="Service subtotal" value={money(r?.serviceCost || 0)} />
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
                    +{money((r?.serviceSell || 0) - (r?.serviceCost || 0))}
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
                <BreakRow label="Service sell" value={money(r?.serviceSell || 0)} last />
                {r?.calloutApplied && (
                  <div style={{ fontSize: 10.5, color: "#b4543a", margin: "6px 0 0", lineHeight: 1.45 }}>
                    Raised to the {money(baseRates.minCallout)} minimum call-out — labor + travel
                    sold for {money(r.serviceSellRaw)}.
                  </div>
                )}
              </div>

              <SubHead style={{ marginTop: 16 }}>
                Parts · {pricedParts.length}
              </SubHead>
              {pricedParts.map((p, i) => (
                <BreakRow
                  key={i}
                  label={p.name + " · " + p.qty + " × $" + p.cost.toFixed(2)}
                  value={money(p.extCost)}
                  ellipsis
                />
              ))}
              <BreakRow
                label={"Parts markup · " + partsPts + " pts"}
                value={"+" + money((r?.partsSell || 0) - (r?.partsCost || 0))}
                last
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  fontSize: 14,
                  fontWeight: 700,
                  marginTop: 13,
                  paddingTop: 12,
                  borderTop: "1px solid #eceef1",
                }}
              >
                <span>Total</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{money(total)}</span>
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
                    {money(baseRates.minCallout)} minimum call-out · parts marked up {partsPts} pts
                    · travel time rounded up to {baseRates.travelRoundMin} min · emergency labor ×
                    {baseRates.emergencyMult}. Multiple venues on one quote share a single round
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
                    Accepted — now an approved repair job, ready to schedule.
                  </div>
                  <Link
                    href="/repairs/scheduling"
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
                    Schedule this repair →
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
