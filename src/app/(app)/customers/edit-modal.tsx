"use client";

import type { CSSProperties } from "react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCustomerAction,
  routeLocationAction,
  saveCustomerAction,
  searchAddressAction,
} from "./actions";
import { CUSTOMER_TYPES, VENUE_KINDS } from "./lib";
import type { AddressHitVM, SaveCustomerInput } from "./types";

/**
 * New / Edit customer modal (Customers.dc.html edit sheet). Overlays the
 * directory (?edit=new) or a detail page (?edit=1). Locations & contacts are
 * dynamic rows; a location's address is filled from a live Nominatim search
 * and its travel can be routed on demand — persisted through saveCustomerAction.
 * Fields the ported store does not keep (since / notes / stage dims) are omitted.
 */

const ACCENT = "var(--accent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";

type LocRow = {
  id: string;
  label: string;
  primary: boolean;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  venueKind: string;
  travelMiles: string;
  travelMin: string;
  routing: boolean;
  officeHint: string;
};

type ContactRow = { name: string; role: string; email: string; primary: boolean };

const microLbl: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 6,
  display: "block",
};
const inStyle: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "10px 12px",
  outline: "none",
  background: "#fff",
};
const selStyle: CSSProperties = { ...inStyle, cursor: "pointer" };
const cardStyle: CSSProperties = {
  border: "1px solid #eef0f3",
  borderRadius: 11,
  padding: 13,
  marginBottom: 12,
  background: "#fafbfc",
};

const modalCss = `
.cu-m-in::placeholder { color: #aab0bb; }
.cu-m-in:focus { border-color: #c4c9d2; }
.cu-m-scroll::-webkit-scrollbar { width: 10px; }
.cu-m-scroll::-webkit-scrollbar-thumb { background: #d6d9e0; border-radius: 8px; border: 3px solid #fff; }
`;

let uid = 0;
function newLoc(primary: boolean): LocRow {
  uid += 1;
  return {
    id: "l" + Date.now() + "-" + uid,
    label: "",
    primary,
    city: "",
    state: "",
    lat: null,
    lng: null,
    venueKind: "proscenium",
    travelMiles: "",
    travelMin: "",
    routing: false,
    officeHint: "",
  };
}

export default function EditCustomerModal({
  mode,
  initial,
  closeHref,
}: {
  mode: "new" | "edit";
  initial: SaveCustomerInput | null;
  closeHref: string;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [name, setName] = useState(initial?.name || "");
  const [type, setType] = useState(initial?.type || "Performing arts");
  const [locations, setLocations] = useState<LocRow[]>(() => {
    const src = initial?.locations || [];
    if (!src.length) return [newLoc(true)];
    return src.map((l, i) => ({
      id: l.id || "l" + i,
      label: l.label || "",
      primary: i === 0 ? l.primary || !src.some((x) => x.primary) : l.primary,
      city: l.city || "",
      state: l.state || "",
      lat: l.lat ?? null,
      lng: l.lng ?? null,
      venueKind: l.venueKind || "proscenium",
      travelMiles: l.travelMiles == null ? "" : String(l.travelMiles),
      travelMin: l.travelMin == null ? "" : String(l.travelMin),
      routing: false,
      officeHint: "",
    }));
  });
  const [contacts, setContacts] = useState<ContactRow[]>(() => {
    const src = initial?.contacts || [];
    if (!src.length) return [{ name: "", role: "", email: "", primary: true }];
    return src.map((c) => ({
      name: c.name || "",
      role: c.role || "",
      email: c.email || "",
      primary: !!c.primary,
    }));
  });

  // per-location address search dropdown
  const [search, setSearch] = useState<{
    idx: number | null;
    hits: AddressHitVM[];
    loading: boolean;
    msg: string;
  }>({ idx: null, hits: [], loading: false, msg: "" });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => router.push(closeHref);

  const setLoc = (i: number, patch: Partial<LocRow>) =>
    setLocations((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const makePrimaryLoc = (i: number) =>
    setLocations((rows) => rows.map((r, idx) => ({ ...r, primary: idx === i })));
  const addLoc = () => setLocations((rows) => [...rows, newLoc(rows.length === 0)]);
  const removeLoc = (i: number) =>
    setLocations((rows) => {
      const next = rows.filter((_, idx) => idx !== i);
      if (next.length && !next.some((r) => r.primary)) next[0].primary = true;
      return next;
    });

  const setContact = (i: number, patch: Partial<ContactRow>) =>
    setContacts((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const makePrimaryContact = (i: number) =>
    setContacts((rows) => rows.map((r, idx) => ({ ...r, primary: idx === i })));
  const addContact = () =>
    setContacts((rows) => [...rows, { name: "", role: "", email: "", primary: rows.length === 0 }]);
  const removeContact = (i: number) =>
    setContacts((rows) => {
      const next = rows.filter((_, idx) => idx !== i);
      if (next.length && !next.some((r) => r.primary)) next[0].primary = true;
      return next;
    });

  const onAddressInput = (i: number, value: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = value.trim();
    if (q.length < 3) {
      setSearch({ idx: i, hits: [], loading: false, msg: "Keep typing to search…" });
      return;
    }
    setSearch((s) => ({ idx: i, hits: s.idx === i ? s.hits : [], loading: true, msg: "" }));
    searchTimer.current = setTimeout(() => {
      startTransition(async () => {
        const hits = await searchAddressAction(q);
        setSearch({ idx: i, hits, loading: false, msg: hits.length ? "" : "No matches — enter the city / state below." });
      });
    }, 400);
  };

  const pickAddress = (i: number, h: AddressHitVM) => {
    setLoc(i, { city: h.city, state: h.state, lat: h.lat, lng: h.lng });
    setSearch({ idx: null, hits: [], loading: false, msg: "" });
  };

  const runRoute = (i: number) => {
    const r = locations[i];
    setLoc(i, { routing: true });
    startTransition(async () => {
      const res = await routeLocationAction({
        id: r.id,
        label: r.label,
        primary: r.primary,
        city: r.city,
        state: r.state,
        lat: r.lat,
        lng: r.lng,
        venueKind: r.venueKind,
        travelMiles: null,
        travelMin: null,
      });
      setLoc(i, {
        routing: false,
        officeHint: res.officeName,
        travelMiles: res.miles != null ? String(res.miles) : r.travelMiles,
        travelMin: res.minutes != null ? String(res.minutes) : r.travelMin,
      });
    });
  };

  const save = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      const res = await saveCustomerAction({
        id: initial?.id,
        name: name.trim(),
        type,
        locations: locations.map((l) => ({
          id: l.id,
          label: l.label,
          primary: l.primary,
          city: l.city,
          state: l.state,
          lat: l.lat,
          lng: l.lng,
          venueKind: l.venueKind,
          travelMiles: l.travelMiles === "" ? null : Number(l.travelMiles),
          travelMin: l.travelMin === "" ? null : Number(l.travelMin),
        })),
        contacts: contacts.map((c) => ({
          name: c.name,
          role: c.role,
          email: c.email,
          primary: c.primary,
        })),
      });
      if (res.ok) {
        router.push(`/customers/${encodeURIComponent(res.id)}`);
        router.refresh();
      }
    });
  };

  const doDelete = () => {
    if (!initial?.id) return;
    startTransition(async () => {
      await deleteCustomerAction(initial.id!);
      router.push("/customers");
      router.refresh();
    });
  };

  const primaryPill = (on: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: "nowrap",
    borderRadius: 7,
    padding: "7px 11px",
    cursor: "pointer",
    flexShrink: 0,
    border: `1px solid ${on ? "var(--accent)" : "#e4e7ec"}`,
    background: on ? ACCENT_SOFT : "#fff",
    color: on ? ACCENT_INK : "#8c919c",
  });

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(16,22,30,.46)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        zIndex: 60,
        fontFamily: "var(--font-ui)",
        color: "#16181d",
      }}
    >
      <style>{modalCss}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 600,
          maxWidth: "100%",
          maxHeight: "88vh",
          background: "#fff",
          borderRadius: 15,
          boxShadow: "0 24px 70px rgba(0,0,0,.32)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "17px 22px",
            borderBottom: "1px solid #f0f1f4",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 16.5, fontWeight: 600 }}>
              {mode === "new" ? "New customer" : "Edit customer"}
            </div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2 }}>
              {mode === "new"
                ? "Add a customer your quotes can reference"
                : "Update details across every quote that references this customer"}
            </div>
          </div>
          <button
            onClick={close}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "#f1f2f5",
              color: "#5b616e",
              border: "none",
              cursor: "pointer",
              fontSize: 17,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* body */}
        <div className="cu-m-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
          <label style={microLbl}>Company name</label>
          <input
            className="cu-m-in"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lakefront Performing Arts Center"
            style={inStyle}
          />

          <div style={{ marginTop: 15 }}>
            <label style={microLbl}>Type</label>
            <select
              className="cu-m-in"
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={selStyle}
            >
              {CUSTOMER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* locations */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              margin: "22px 0 9px",
            }}
          >
            <span style={{ ...microLbl, marginBottom: 0 }}>Locations &amp; venues</span>
            <button
              onClick={addLoc}
              style={{ fontSize: 12, fontWeight: 600, color: ACCENT, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
            >
              + Add location
            </button>
          </div>

          {locations.map((l, i) => (
            <div key={l.id} style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
                <input
                  className="cu-m-in"
                  value={l.label}
                  onChange={(e) => setLoc(i, { label: e.target.value })}
                  placeholder="Venue label (e.g. Main Hall)"
                  style={{ ...inStyle, flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13, padding: "8px 11px", borderRadius: 8 }}
                />
                <button onClick={() => makePrimaryLoc(i)} style={primaryPill(l.primary)}>
                  {l.primary ? "✓ Primary" : "Make primary"}
                </button>
                {locations.length > 1 && (
                  <button
                    onClick={() => removeLoc(i)}
                    title="Remove location"
                    style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: "#c4c9d2", fontSize: 15, cursor: "pointer", flexShrink: 0 }}
                  >
                    ×
                  </button>
                )}
              </div>

              <label style={{ ...microLbl, fontSize: 9.5, marginBottom: 5 }}>Venue type</label>
              <select
                className="cu-m-in"
                value={l.venueKind}
                onChange={(e) => setLoc(i, { venueKind: e.target.value })}
                style={{ ...selStyle, fontSize: 12.5, padding: "8px 10px", borderRadius: 8, marginBottom: 9 }}
              >
                {VENUE_KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>

              {/* address search */}
              <div style={{ position: "relative", marginBottom: 9 }}>
                <label style={{ ...microLbl, fontSize: 9.5, marginBottom: 5 }}>Find address</label>
                <input
                  className="cu-m-in"
                  onChange={(e) => onAddressInput(i, e.target.value)}
                  onFocus={() => search.idx !== i && setSearch({ idx: i, hits: [], loading: false, msg: "" })}
                  placeholder="Search — e.g. 929 N Water St, Milwaukee"
                  style={{ ...inStyle, fontSize: 12.5, padding: "8px 11px", borderRadius: 8 }}
                />
                {search.idx === i && (search.loading || search.hits.length > 0 || search.msg) && (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: "calc(100% + 4px)",
                      zIndex: 20,
                      background: "#fff",
                      border: "1px solid #e4e7ec",
                      borderRadius: 10,
                      boxShadow: "0 12px 32px rgba(16,22,30,.16)",
                      maxHeight: 228,
                      overflowY: "auto",
                    }}
                  >
                    {search.loading && (
                      <div style={{ padding: "11px 12px", fontSize: 11.5, color: "#9aa0ab" }}>Searching…</div>
                    )}
                    {!search.loading &&
                      search.hits.map((h, hi) => (
                        <button
                          key={hi}
                          onClick={() => pickAddress(i, h)}
                          style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #f5f6f8", background: "#fff", padding: "9px 12px", cursor: "pointer" }}
                        >
                          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {h.title}
                          </span>
                          <span style={{ display: "block", fontSize: 11, color: "#9aa0ab", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>
                            {h.sub}
                          </span>
                        </button>
                      ))}
                    {!search.loading && search.hits.length === 0 && search.msg && (
                      <div style={{ padding: "11px 12px", fontSize: 11.5, color: "#9aa0ab" }}>{search.msg}</div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) 86px", gap: 8, marginBottom: 10 }}>
                <input
                  className="cu-m-in"
                  value={l.city}
                  onChange={(e) => setLoc(i, { city: e.target.value })}
                  placeholder="City"
                  style={{ ...inStyle, fontSize: 12.5, padding: "8px 11px", borderRadius: 8 }}
                />
                <input
                  className="cu-m-in"
                  value={l.state}
                  onChange={(e) => setLoc(i, { state: e.target.value })}
                  placeholder="ST"
                  style={{ ...inStyle, fontSize: 12.5, padding: "8px 9px", borderRadius: 8, textAlign: "center" }}
                />
              </div>

              {/* travel */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#fff",
                  border: "1px solid #eef0f3",
                  borderRadius: 9,
                  padding: "9px 11px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em" }}>
                    Travel · {l.officeHint || "nearest office"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {l.routing ? "Finding driving route…" : "Search an address, then Route for live driving distance"}
                  </div>
                </div>
                <input
                  className="cu-m-in"
                  value={l.travelMiles}
                  onChange={(e) => setLoc(i, { travelMiles: e.target.value })}
                  placeholder="mi"
                  title="Miles — leave blank to use the auto estimate"
                  style={{ ...inStyle, width: 58, fontFamily: "var(--font-mono)", fontSize: 12, padding: "7px 8px", borderRadius: 7, textAlign: "center" }}
                />
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>mi</span>
                <input
                  className="cu-m-in"
                  value={l.travelMin}
                  onChange={(e) => setLoc(i, { travelMin: e.target.value })}
                  placeholder="min"
                  title="Minutes — leave blank to use the auto estimate"
                  style={{ ...inStyle, width: 54, fontFamily: "var(--font-mono)", fontSize: 12, padding: "7px 8px", borderRadius: 7, textAlign: "center" }}
                />
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>min</span>
                <button
                  onClick={() => runRoute(i)}
                  disabled={busy || l.routing}
                  title="Fetch real driving distance & time"
                  style={{ fontSize: 11.5, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: "none", borderRadius: 7, padding: "7px 11px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  Route
                </button>
              </div>
            </div>
          ))}

          {/* contacts */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              margin: "22px 0 9px",
            }}
          >
            <span style={{ ...microLbl, marginBottom: 0 }}>Contacts</span>
            <button
              onClick={addContact}
              style={{ fontSize: 12, fontWeight: 600, color: ACCENT, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
            >
              + Add contact
            </button>
          </div>

          {contacts.map((c, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
                <input
                  className="cu-m-in"
                  value={c.name}
                  onChange={(e) => setContact(i, { name: e.target.value })}
                  placeholder="Full name"
                  style={{ ...inStyle, flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13, padding: "8px 11px", borderRadius: 8 }}
                />
                <button onClick={() => makePrimaryContact(i)} style={primaryPill(c.primary)}>
                  {c.primary ? "✓ Primary" : "Make primary"}
                </button>
                {contacts.length > 1 && (
                  <button
                    onClick={() => removeContact(i)}
                    title="Remove"
                    style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: "#c4c9d2", fontSize: 15, cursor: "pointer", flexShrink: 0 }}
                  >
                    ×
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 9 }}>
                <input
                  className="cu-m-in"
                  value={c.role}
                  onChange={(e) => setContact(i, { role: e.target.value })}
                  placeholder="Role / title"
                  style={{ ...inStyle, fontSize: 12.5, padding: "8px 11px", borderRadius: 8 }}
                />
                <input
                  className="cu-m-in"
                  value={c.email}
                  onChange={(e) => setContact(i, { email: e.target.value })}
                  placeholder="email@company.com"
                  style={{ ...inStyle, fontFamily: "var(--font-mono)", fontSize: 12, padding: "8px 11px", borderRadius: 8 }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "14px 22px",
            borderTop: "1px solid #f0f1f4",
            flexShrink: 0,
          }}
        >
          <div>
            {mode === "edit" && (
              <button
                onClick={doDelete}
                disabled={busy}
                style={{ fontSize: 13, fontWeight: 600, color: "#b4543a", background: "#f8ece7", border: "1px solid #eccfc4", borderRadius: 9, padding: "10px 14px", cursor: "pointer" }}
              >
                Delete
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={close}
              style={{ fontSize: 13, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer", padding: "9px 12px" }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || !name.trim()}
              style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 9, padding: "10px 18px", cursor: "pointer", opacity: name.trim() ? 1 : 0.5 }}
            >
              {mode === "new" ? "Create customer" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
