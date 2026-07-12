"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ROLES,
  ROLE_DESC,
  ROLE_PERMS,
  PERM_LABEL,
  type Role,
} from "@/lib/team";
import {
  addUserAction,
  geocodeCityAction,
  removeOfficeAction,
  removeUserAction,
  saveOfficeAction,
  saveSettingsAction,
  searchAddressAction,
  setActiveAction,
  setRolesAction,
} from "./actions";
import type { GeoSearchHit } from "@/lib/geo";

/**
 * Settings — admin surface, ported from Settings.dc.html
 * (spec: docs/specs/settings-team.json). Phase 1 ships Branding, Federal
 * holidays, Beta, and the full Team + Roles section; the Locations editor
 * (address search + geocoding) arrives with geo in Phase 5.
 */

const ACCENTS = ["#7b3f8a", "#1f8a5b", "#3d4eb0", "#b4543a"];
const ROLE_COLORS: Record<string, string> = {
  Admin: "#5b4b8a",
  Manager: "#3155a8",
  Estimator: "#5b616e",
  Reviewer: "#1f7a52",
};

type UserVM = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  color: string;
  initials: string;
  active: boolean;
};

type OfficeVM = {
  id: string;
  type: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
};

type OfficeDraft = {
  type: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: string;
  lng: string;
  geoMiss: boolean;
};

const OFFICE_TYPES = ["Main Office", "Satellite", "Shop", "Temporary"];

export default function SettingsClient({
  meId,
  meName,
  settings,
  offices,
  users,
}: {
  meId: string;
  meName: string;
  settings: {
    companyName: string;
    accent: string;
    federalHolidays: boolean;
    seedDemo: boolean;
    feedbackEmail: string;
  };
  offices: OfficeVM[];
  users: UserVM[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // modal: null | 'new' | userId
  const [modal, setModal] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; email: string; roles: string[] }>({
    name: "",
    email: "",
    roles: ["Estimator"],
  });
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error || "Something went wrong.");
      router.refresh();
    });

  const saveSetting = (patch: Parameters<typeof saveSettingsAction>[0]) =>
    run(() => saveSettingsAction(patch));

  // ---- Locations (offices) ----
  // officeModal: null | "__new__" | officeId
  const [officeModal, setOfficeModal] = useState<string | null>(null);
  const [officeDraft, setOfficeDraft] = useState<OfficeDraft | null>(null);
  const [ofSearch, setOfSearch] = useState<{
    open: boolean;
    loading: boolean;
    results: GeoSearchHit[];
  }>({ open: false, loading: false, results: [] });
  const ofSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ofBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emptyOfficeDraft = (): OfficeDraft => ({
    type: "Main Office",
    name: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    lat: "",
    lng: "",
    geoMiss: false,
  });

  const openAddOffice = () => {
    setOfficeDraft(emptyOfficeDraft());
    setOfSearch({ open: false, loading: false, results: [] });
    setOfficeModal("__new__");
  };
  const openEditOffice = (o: OfficeVM) => {
    setOfficeDraft({
      type: o.type || "Main Office",
      name: o.name,
      street: o.street,
      city: o.city,
      state: o.state,
      zip: o.zip,
      lat: o.lat == null ? "" : String(o.lat),
      lng: o.lng == null ? "" : String(o.lng),
      geoMiss: false,
    });
    setOfSearch({ open: false, loading: false, results: [] });
    setOfficeModal(o.id);
  };
  const closeOffice = () => {
    setOfficeModal(null);
    setOfficeDraft(null);
    if (ofSearchTimer.current) clearTimeout(ofSearchTimer.current);
    if (ofBlurTimer.current) clearTimeout(ofBlurTimer.current);
  };
  const setOf = (patch: Partial<OfficeDraft>) =>
    setOfficeDraft((d) => (d ? { ...d, ...patch } : d));

  const runAddressSearch = (q: string) => {
    if (ofSearchTimer.current) clearTimeout(ofSearchTimer.current);
    if (q.trim().length < 3) {
      setOfSearch((s) => ({ ...s, loading: false, results: [] }));
      return;
    }
    setOfSearch((s) => ({ ...s, open: true, loading: true }));
    ofSearchTimer.current = setTimeout(async () => {
      const results = await searchAddressAction(q);
      setOfSearch((s) => ({ ...s, loading: false, results }));
    }, 450);
  };
  const onStreetInput = (v: string) => {
    setOf({ street: v });
    setOfSearch((s) => ({ ...s, open: true }));
    runAddressSearch(v);
  };
  const pickAddress = (r: GeoSearchHit) => {
    setOf({
      street: r.street || r.title,
      city: r.city,
      state: r.state,
      zip: r.zip,
      lat: String(r.lat),
      lng: String(r.lng),
      geoMiss: false,
    });
    setOfSearch({ open: false, loading: false, results: [] });
  };
  const autoLocate = async () => {
    if (!officeDraft) return;
    const c = await geocodeCityAction(officeDraft.city, officeDraft.state);
    if (c) setOf({ lat: String(c.lat), lng: String(c.lng), geoMiss: false });
    else setOf({ geoMiss: true });
  };
  const saveOffice = () => {
    if (!officeDraft || !officeDraft.name.trim()) return; // silent no-op
    const isNewOffice = officeModal === "__new__";
    run(() =>
      saveOfficeAction({
        id: isNewOffice ? undefined : officeModal || undefined,
        type: officeDraft.type,
        name: officeDraft.name,
        street: officeDraft.street,
        city: officeDraft.city,
        state: officeDraft.state,
        zip: officeDraft.zip,
        lat: officeDraft.lat,
        lng: officeDraft.lng,
      })
    );
    closeOffice();
  };
  const removeOffice = () => {
    if (officeModal && officeModal !== "__new__")
      run(() => removeOfficeAction(officeModal));
    closeOffice();
  };
  const officeIsNew = officeModal === "__new__";

  const openNew = () => {
    setDraft({ name: "", email: "", roles: ["Estimator"] });
    setModal("new");
  };
  const openEdit = (u: UserVM) => {
    setDraft({ name: u.name, email: u.email, roles: u.roles.slice() });
    setModal(u.id);
  };
  const toggleDraftRole = (r: string) =>
    setDraft((d) => ({
      ...d,
      roles: d.roles.includes(r)
        ? d.roles.filter((x) => x !== r)
        : [...d.roles, r],
    }));

  const saveModal = () => {
    if (!draft.roles.length) return; // silent no-op, per prototype
    if (modal === "new") {
      if (!draft.name.trim()) return;
      run(() => addUserAction(draft));
    } else if (modal) {
      run(() => setRolesAction(modal, draft.roles));
    }
    setModal(null);
  };

  const isNew = modal === "new";
  const editingUser = modal && !isNew ? users.find((u) => u.id === modal) : null;
  const canDelete = !!editingUser && editingUser.name !== meName;

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "#9aa0ab",
    letterSpacing: ".04em",
    textTransform: "uppercase",
    marginBottom: 7,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid #e4e7ec",
    borderRadius: 9,
    padding: "11px 13px",
    fontSize: 14,
    fontFamily: "var(--font-ui)",
    outline: "none",
  };

  return (
    <div>
      {error && (
        <div
          style={{
            background: "#f9ece8",
            border: "1px solid #f0d6cd",
            color: "#b4543a",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* ---- Branding ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Branding</div>
        <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
          Company name and accent color — applied across every screen.
        </div>
        <div
          style={{
            display: "flex",
            gap: 26,
            flexWrap: "wrap",
            marginTop: 16,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={labelStyle}>Company name</label>
            <input
              style={inputStyle}
              defaultValue={settings.companyName}
              placeholder="Company name"
              onChange={(e) => {
                const v = e.target.value;
                if (nameTimer.current) clearTimeout(nameTimer.current);
                nameTimer.current = setTimeout(
                  () => saveSetting({ companyName: v }),
                  500
                );
              }}
            />
          </div>
          <div>
            <label style={labelStyle}>Accent color</label>
            <div style={{ display: "flex", gap: 13 }}>
              {ACCENTS.map((hex) => {
                const on = hex.toLowerCase() === settings.accent.toLowerCase();
                return (
                  <button
                    key={hex}
                    title={hex}
                    onClick={() => saveSetting({ accent: hex })}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      border: "none",
                      background: hex,
                      cursor: "pointer",
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 700,
                      lineHeight: 1,
                      boxShadow: on
                        ? `0 0 0 2px #fff, 0 0 0 4px ${hex}`
                        : "inset 0 0 0 1px rgba(0,0,0,.08)",
                    }}
                  >
                    {on ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Federal holidays ---- */}
      <section
        className="pk-card"
        style={{
          padding: "17px 18px",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Federal holidays</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
            Grey out the 8 U.S. federal holidays company-wide on the schedule,
            and flag crew booked over them.
          </div>
        </div>
        <Toggle
          on={settings.federalHolidays}
          onChange={(v) => saveSetting({ federalHolidays: v })}
        />
      </section>

      {/* ---- Locations ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Locations</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              Used as the travel origin when estimating a job — the nearest
              location to the site is picked automatically.
            </div>
          </div>
          <button
            className="pk-btn-accent"
            style={{ flexShrink: 0 }}
            onClick={openAddOffice}
          >
            + Add location
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {offices.map((o) => {
            const hasCoords = o.lat != null && o.lng != null;
            const addr =
              [
                o.street,
                [o.city, o.state].filter(Boolean).join(", "),
                o.zip,
              ]
                .filter(Boolean)
                .join("  ·  ") || "—";
            return (
              <div
                key={o.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  border: "1px solid #eef0f3",
                  borderRadius: 11,
                  padding: "12px 14px",
                  background: "#fafbfc",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: "var(--accent-soft)",
                    color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    flexShrink: 0,
                  }}
                >
                  📍
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{o.name}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 9px",
                        borderRadius: 20,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                        color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                        background: "var(--accent-soft)",
                        border: "1px solid color-mix(in srgb, var(--accent) 22%, #fff)",
                      }}
                    >
                      {o.type || "Main Office"}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "#8c919c",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {addr}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "2px 9px",
                    borderRadius: 20,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    color: hasCoords ? "#1f7a52" : "#a06a2b",
                    background: hasCoords ? "#e8f3ee" : "#f7efe2",
                    border: `1px solid ${hasCoords ? "#cfe6db" : "#ecdcc2"}`,
                  }}
                >
                  {hasCoords ? "Located" : "No coords"}
                </span>
                <button
                  className="pk-btn-outline"
                  title="Edit office"
                  onClick={() => openEditOffice(o)}
                >
                  Edit
                </button>
              </div>
            );
          })}
          {offices.length === 0 && (
            <div style={{ fontSize: 12.5, color: "#9aa0ab", padding: "8px 2px" }}>
              No locations yet — add one to enable automatic travel estimates.
            </div>
          )}
        </div>
      </section>

      {/* ---- Beta ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Beta</div>
        <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
          Development options while the rebuild is in progress.
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid #f3f4f7",
          }}
        >
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Demo data</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>
              Seed the data stores with the prototype’s demo records (takes
              effect as stores land in Phase 2).
            </div>
          </div>
          <Toggle on={settings.seedDemo} onChange={(v) => saveSetting({ seedDemo: v })} />
        </div>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7", maxWidth: 380 }}>
          <label style={labelStyle}>Feedback email</label>
          <input
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 13 }}
            defaultValue={settings.feedbackEmail}
            placeholder="feedback@peaksystemsgroup.com"
            onBlur={(e) => saveSetting({ feedbackEmail: e.target.value.trim() })}
          />
        </div>
      </section>

      {/* ---- Team + Roles ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 320px",
          gap: 20,
          alignItems: "start",
        }}
        className="st-grid"
      >
        <section className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "15px 18px",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Team members</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#9aa0ab" }}>
                {users.length}
              </span>
            </div>
            <button className="pk-btn-accent" onClick={openNew}>
              + Add user
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "36px minmax(0,1.4fr) minmax(0,1.6fr) 130px",
              gap: 12,
              padding: "10px 18px",
              fontSize: 10,
              fontWeight: 600,
              color: "#aab0bb",
              textTransform: "uppercase",
              letterSpacing: ".05em",
              background: "#fbfbfc",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            <span />
            <span>Name</span>
            <span>Roles</span>
            <span style={{ textAlign: "right" }}>Actions</span>
          </div>

          {users.map((u) => (
            <div
              key={u.id}
              style={{
                display: "grid",
                gridTemplateColumns: "36px minmax(0,1.4fr) minmax(0,1.6fr) 130px",
                gap: 12,
                padding: "13px 18px",
                alignItems: "center",
                borderBottom: "1px solid #f5f6f8",
                opacity: u.active ? 1 : 0.55,
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: u.color,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {u.initials}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13.5,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</span>
                  {u.id === meId && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--accent)",
                        background: "var(--accent-soft)",
                        padding: "1px 6px",
                        borderRadius: 5,
                        flexShrink: 0,
                      }}
                    >
                      You
                    </span>
                  )}
                </span>
                <span
                  className="st-email"
                  style={{
                    display: "block",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "#aab0bb",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {u.email}
                </span>
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {u.roles.map((r) => (
                  <RolePill key={r} role={r} />
                ))}
                {!u.active && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 20,
                      color: "#8c919c",
                      background: "#f1f2f5",
                      border: "1px solid #e4e7ec",
                    }}
                  >
                    Deactivated
                  </span>
                )}
              </span>
              <span style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                <button className="pk-btn-outline" title="Edit roles" onClick={() => openEdit(u)}>
                  Roles
                </button>
                <button
                  className="pk-btn-outline"
                  title={u.active ? "Deactivate" : "Reactivate"}
                  style={{ color: "#8c919c", padding: "6px 9px", fontSize: 13 }}
                  onClick={() => run(() => setActiveAction(u.id, !u.active))}
                >
                  {u.active ? "⏻" : "↺"}
                </button>
              </span>
            </div>
          ))}
        </section>

        <section className="pk-card" style={{ padding: "17px 18px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>
            Roles & permissions
          </div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 14 }}>
            Permissions are preset by role. A user can hold more than one.
          </div>
          {ROLES.map((r) => (
            <div key={r} style={{ padding: "11px 0", borderTop: "1px solid #f3f4f7" }}>
              <RolePill role={r} />
              <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 6, lineHeight: 1.45 }}>
                {ROLE_DESC[r as Role]}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                {ROLE_PERMS[r as Role].map((p) => (
                  <span
                    key={p}
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: "#5b616e",
                      background: "#f7f8fa",
                      border: "1px solid #eceef1",
                      padding: "2px 8px",
                      borderRadius: 5,
                    }}
                  >
                    {PERM_LABEL[p]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* ---- Add / edit location modal ---- */}
      {officeModal && officeDraft && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,22,30,.46)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            zIndex: 60,
          }}
          onClick={closeOffice}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 520,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 15,
              boxShadow: "0 24px 70px rgba(0,0,0,.32)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "17px 22px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {officeIsNew ? "Add location" : "Edit location"}
              </span>
              <button
                onClick={closeOffice}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "#f1f2f5",
                  color: "#5b616e",
                  fontSize: 17,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "20px 22px" }}>
              <label style={{ ...labelStyle, marginBottom: 6 }}>Location type</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {OFFICE_TYPES.map((t) => {
                  const on = officeDraft.type === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setOf({ type: t })}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        padding: "8px 13px",
                        borderRadius: 8,
                        cursor: "pointer",
                        border: on
                          ? "1px solid var(--accent)"
                          : "1px solid #e4e7ec",
                        background: on ? "var(--accent-soft)" : "#fff",
                        color: on
                          ? "color-mix(in srgb, var(--accent) 70%, #16181d)"
                          : "#5b616e",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <label style={{ ...labelStyle, marginBottom: 6 }}>Location name</label>
              <input
                style={{ ...inputStyle, marginBottom: 14 }}
                placeholder="e.g. Milwaukee Shop"
                value={officeDraft.name}
                onChange={(e) => setOf({ name: e.target.value })}
                autoFocus
              />

              <label style={{ ...labelStyle, marginBottom: 6 }}>Street address</label>
              <div style={{ position: "relative", marginBottom: 14 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    background: "#fff",
                    border: "1px solid #e4e7ec",
                    borderRadius: 9,
                    padding: "0 13px",
                  }}
                >
                  <input
                    value={officeDraft.street}
                    onChange={(e) => onStreetInput(e.target.value)}
                    onFocus={() => setOfSearch((s) => ({ ...s, open: true }))}
                    onBlur={() => {
                      if (ofBlurTimer.current) clearTimeout(ofBlurTimer.current);
                      ofBlurTimer.current = setTimeout(
                        () => setOfSearch((s) => ({ ...s, open: false })),
                        150
                      );
                    }}
                    placeholder="Search address — e.g. 2150 W Canal St, Milwaukee"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: "none",
                      background: "transparent",
                      padding: "11px 0",
                      fontSize: 14,
                      fontFamily: "var(--font-ui)",
                      color: "#16181d",
                      outline: "none",
                    }}
                  />
                  {ofSearch.loading && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "#9aa0ab",
                        fontFamily: "var(--font-mono)",
                        flexShrink: 0,
                        letterSpacing: 1,
                      }}
                    >
                      ···
                    </span>
                  )}
                </div>
                {ofSearch.open && (ofSearch.results.length > 0 || (!ofSearch.loading && officeDraft.street.trim().length >= 3)) && (
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
                      maxHeight: 232,
                      overflowY: "auto",
                    }}
                  >
                    {ofSearch.results.map((r, i) => (
                      <button
                        key={i}
                        onMouseDown={() => pickAddress(r)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          borderBottom: "1px solid #f5f6f8",
                          background: "#fff",
                          padding: "10px 13px",
                          cursor: "pointer",
                          fontFamily: "var(--font-ui)",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#16181d",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {r.title}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: 11.5,
                            color: "#9aa0ab",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            marginTop: 1,
                          }}
                        >
                          {r.sub}
                        </span>
                      </button>
                    ))}
                    {!ofSearch.loading && ofSearch.results.length === 0 && (
                      <div style={{ padding: "12px 13px", fontSize: 12, color: "#9aa0ab" }}>
                        No matches — type the address manually.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.7fr) 72px 104px",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>City</label>
                  <input
                    style={inputStyle}
                    placeholder="Milwaukee"
                    value={officeDraft.city}
                    onChange={(e) => setOf({ city: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>State</label>
                  <input
                    style={inputStyle}
                    placeholder="WI"
                    value={officeDraft.state}
                    onChange={(e) => setOf({ state: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>ZIP</label>
                  <input
                    style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
                    placeholder="53233"
                    value={officeDraft.zip}
                    onChange={(e) => setOf({ zip: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Latitude</label>
                  <input
                    style={{ ...inputStyle, fontSize: 13.5, fontFamily: "var(--font-mono)" }}
                    placeholder="43.032"
                    value={officeDraft.lat}
                    onChange={(e) => setOf({ lat: e.target.value })}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Longitude</label>
                  <input
                    style={{ ...inputStyle, fontSize: 13.5, fontFamily: "var(--font-mono)" }}
                    placeholder="-87.945"
                    value={officeDraft.lng}
                    onChange={(e) => setOf({ lng: e.target.value })}
                  />
                </div>
                <button
                  onClick={autoLocate}
                  title="Fill coordinates from the city"
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                    background: "var(--accent-soft)",
                    border: "1px solid var(--accent-soft)",
                    borderRadius: 9,
                    padding: "11px 14px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Auto-locate
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 9, lineHeight: 1.5 }}>
                Coordinates drive automatic travel-distance estimates.{" "}
                <b style={{ color: "#5b616e" }}>Search the address above</b> to pull
                them exactly, use <b style={{ color: "#5b616e" }}>Auto-locate</b> for
                city-level, or enter them by hand.
              </div>
              {officeDraft.geoMiss && (
                <div style={{ fontSize: 11.5, color: "#a0552b", marginTop: 7, lineHeight: 1.45 }}>
                  Couldn&apos;t locate that offline — search the full street address
                  above to pull exact coordinates, or enter them by hand.
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "14px 22px",
                borderTop: "1px solid #f0f1f4",
              }}
            >
              {!officeIsNew ? (
                <button className="pk-btn-danger" onClick={removeOffice}>
                  Remove location
                </button>
              ) : (
                <span />
              )}
              <div style={{ display: "flex", gap: 9 }}>
                <button
                  onClick={closeOffice}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#5b616e",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "10px 12px",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveOffice}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: 9,
                    padding: "10px 18px",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Save location
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Add / edit modal ---- */}
      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,22,30,.46)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            zIndex: 60,
          }}
          onClick={() => setModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 15,
              boxShadow: "0 24px 70px rgba(0,0,0,.32)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "17px 22px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {isNew ? "Add team member" : "Edit roles"}
              </span>
              <button
                onClick={() => setModal(null)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "#f1f2f5",
                  color: "#5b616e",
                  fontSize: 17,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "20px 22px" }}>
              {isNew && (
                <>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Full name</label>
                  <input
                    style={{ ...inputStyle, marginBottom: 14 }}
                    placeholder="e.g. Dana Reyes"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    autoFocus
                  />
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Email</label>
                  <input
                    style={{
                      ...inputStyle,
                      marginBottom: 16,
                      fontFamily: "var(--font-mono)",
                    }}
                    placeholder="name@peaksystemsgroup.com"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </>
              )}

              <label style={{ ...labelStyle, marginBottom: 6 }}>Roles</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ROLES.map((r) => {
                  const on = draft.roles.includes(r);
                  return (
                    <button
                      key={r}
                      onClick={() => toggleDraftRole(r)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "11px 13px",
                        borderRadius: 10,
                        background: on ? "var(--accent-soft)" : "#fff",
                        border: on
                          ? "1px solid color-mix(in srgb, var(--accent) 45%, #fff)"
                          : "1px solid #e8eaee",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: on ? "var(--accent)" : "#fff",
                            border: on
                              ? "1.5px solid var(--accent)"
                              : "1.5px solid #d6d9e0",
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {on ? "✓" : ""}
                        </span>
                        <span>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                            {r}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: "#8c919c",
                              lineHeight: 1.35,
                              marginTop: 1,
                            }}
                          >
                            {ROLE_DESC[r as Role]}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 22px",
                borderTop: "1px solid #f0f1f4",
              }}
            >
              {canDelete ? (
                <button
                  className="pk-btn-danger"
                  onClick={() => {
                    if (modal && modal !== "new") run(() => removeUserAction(modal));
                    setModal(null);
                  }}
                >
                  Remove user
                </button>
              ) : (
                <span />
              )}
              <span style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setModal(null)}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#5b616e",
                    padding: "10px 12px",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveModal}
                  style={{
                    color: "#fff",
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: 9,
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {isNew ? "Add user" : "Save roles"}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  const c = ROLE_COLORS[role] || "#5b616e";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 20,
        color: c,
        background: `color-mix(in srgb, ${c} 11%, #fff)`,
        border: `1px solid color-mix(in srgb, ${c} 26%, #fff)`,
      }}
    >
      {role}
    </span>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        border: "none",
        cursor: "pointer",
        background: on ? "var(--accent)" : "#cdd1d9",
        position: "relative",
        transition: "background .15s ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.3)",
          transition: "left .15s ease",
        }}
      />
    </button>
  );
}
