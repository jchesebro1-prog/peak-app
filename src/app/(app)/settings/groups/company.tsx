"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  geocodeCityAction,
  removeOfficeAction,
  saveLogoAction,
  saveOfficeAction,
  saveSettingsAction,
  searchAddressAction,
  setDefaultQuoteOfficeAction,
} from "../actions";
import { ConfirmButton } from "@/components/confirm-button";
import DashboardLayoutEditor from "@/components/dashboard-layout-editor";
import type { GeoSearchHit } from "@/lib/geo";
import { accentContrast } from "@/lib/color";
import { GROUP_LINKS } from "../settings-sections";
import { inputStyle, labelStyle, LinkTiles, Toggle, type Run } from "./shared";
import type { CompanySettingsVM, OfficeVM } from "./types";

/**
 * Settings → Company (settings cleanup): the Rewards + Catalog shortcut row,
 * Branding & logos, Locations (+ the add/edit location modal), Federal
 * holidays and the company Dashboard defaults. Cards moved verbatim from the
 * old settings-client.tsx Company section.
 */

const ACCENTS = ["#b08d4a", "#7b3f8a", "#1f8a5b", "#3d4eb0", "#b4543a"];

type OfficeDraft = {
  type: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: string;
  lng: string;
  geoMiss: boolean;
};

const OFFICE_TYPES = ["Main Office", "Satellite", "Shop", "Temporary"];

export function CompanyGroup({
  settings,
  offices,
  run,
  setError,
}: {
  settings: CompanySettingsVM;
  offices: OfficeVM[];
  run: Run;
  setError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    phone: "",
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
      phone: o.phone || "",
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
        phone: officeDraft.phone,
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

  return (
    <>
      <LinkTiles screens={GROUP_LINKS.company} />

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
                      color: accentContrast(hex), // D117: adapts to swatch's own hex
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

        {/* logo uploads (IDEAS #32) */}
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 18,
            paddingTop: 16,
            borderTop: "1px solid #f0f1f4",
          }}
        >
          <LogoTile
            kind="logoLight"
            title="Logo — light version"
            desc="Shown on the dark nav bar. PNG/SVG with a transparent background works best."
            value={settings.logoLight}
            dark
            onError={setError}
            onSaved={() => router.refresh()}
          />
          <LogoTile
            kind="logoDark"
            title="Logo — dark version"
            desc="Heads letters and reports in place of the built-in letterhead image."
            value={settings.logoDark}
            onError={setError}
            onSaved={() => router.refresh()}
          />
        </div>
      </section>

      {/* ---- Locations ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Locations</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              The quote origin is where every quote and estimating rule
              measures travel from. Calendar travel blocks start from each
              person&rsquo;s &ldquo;Based out of&rdquo; location (Account
              page), falling back to the quote origin. After changing the
              quote origin, run Data &amp; Tools → Geocode addresses once to fetch
              driving routes from it.
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
          {(() => {
            const originId = (offices.find((o) => o.quoteDefault) || offices[0])?.id;
            const implicitOrigin = !offices.some((o) => o.quoteDefault);
            return offices.map((o) => {
            const hasCoords = o.lat != null && o.lng != null;
            const isOrigin = o.id === originId;
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
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
                    {isOrigin && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 9px",
                          borderRadius: 20,
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                          color: "#1f7a52",
                          background: "#e8f3ee",
                          border: "1px solid #cfe6db",
                        }}
                      >
                        {implicitOrigin ? "Quote origin (default — first listed)" : "Quote origin"}
                      </span>
                    )}
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
                {(!isOrigin || implicitOrigin) && (
                  <button
                    className="pk-btn-outline"
                    title="Measure all quote travel from this location"
                    onClick={() => run(() => setDefaultQuoteOfficeAction(o.id))}
                  >
                    Use for quotes
                  </button>
                )}
                <button
                  className="pk-btn-outline"
                  title="Edit office"
                  onClick={() => openEditOffice(o)}
                >
                  Edit
                </button>
              </div>
            );
            });
          })()}
          {offices.length === 0 && (
            <div style={{ fontSize: 12.5, color: "#9aa0ab", padding: "8px 2px" }}>
              No locations yet — add one to enable automatic travel estimates.
            </div>
          )}
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

      <DashboardLayoutEditor mode="company" initial={settings.dashboardDefaults} />

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

              <div style={{ marginBottom: 14 }}>
                <label style={{ ...labelStyle, marginBottom: 6 }}>
                  Phone (shown on service documents signed from this office)
                </label>
                <input
                  style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
                  placeholder="(414) 555-0100"
                  value={officeDraft.phone}
                  onChange={(e) => setOf({ phone: e.target.value })}
                />
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
                <ConfirmButton
                  label="Remove location"
                  confirmLabel="Confirm remove"
                  onConfirm={removeOffice}
                />
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
                    color: "var(--accent-contrast)", // D117: adapts to active accent
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
    </>
  );
}

/** Brand-mark upload tile (IDEAS #32) — reads the file client-side into a
 *  data URL (≤300 KB) and saves it through saveLogoAction. */
function LogoTile({
  kind,
  title,
  desc,
  value,
  dark,
  onError,
  onSaved,
}: {
  kind: "logoLight" | "logoDark";
  title: string;
  desc: string;
  value: string | null;
  dark?: boolean;
  onError: (msg: string | null) => void;
  onSaved: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function save(dataUrl: string | null) {
    setBusy(true);
    onError(null);
    try {
      const res = await saveLogoAction(kind, dataUrl);
      if (!res.ok) onError(res.error || "Couldn’t save the logo.");
      else onSaved();
    } catch {
      onError("Couldn’t save the logo.");
    } finally {
      setBusy(false);
    }
  }

  function pick(file: File | null) {
    if (!file) return;
    if (file.size > 300 * 1024) {
      onError("Logo is too large — keep it under 300 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => save(String(reader.result || "") || null);
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ flex: 1, minWidth: 250 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2, lineHeight: 1.5 }}>
        {desc}
      </div>
      <div
        style={{
          marginTop: 9,
          height: 74,
          borderRadius: 10,
          border: "1px solid " + (dark ? "#2f323a" : "#e4e7ec"),
          background: dark ? "#16181d" : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          padding: 10,
        }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={title}
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ fontSize: 11.5, color: dark ? "#5b616e" : "#c0c5cd" }}>
            No logo uploaded
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            pick(e.target.files?.[0] || null);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="pk-btn-outline"
          style={{ cursor: busy ? "wait" : "pointer" }}
        >
          {value ? "Replace…" : "Upload…"}
        </button>
        {value && (
          <button
            type="button"
            disabled={busy}
            onClick={() => save(null)}
            className="pk-btn-outline"
            style={{ color: "#b4543a", cursor: busy ? "wait" : "pointer" }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
