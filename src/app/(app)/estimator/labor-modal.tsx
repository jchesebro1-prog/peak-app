"use client";

import type { CSSProperties } from "react";
import { MOB_TYPES } from "./estimator-data";
import { computeLabor, fmt, fmtTime, round2, type RateFn, type RateSource } from "./pricing";
import type { LaborDraft, MobDraft, TravelLite } from "./types";
import { ACCENT_INK, ACCENT_SOFT, addBtnStyle, ConfigModal, LBL, LBL5, segBtn, Stat } from "./est-ui";

/**
 * Labor configurator — discipline scope (rate set from catalog category
 * 'Labor'), one line per mobilization (crew/days/OT, local vs travel with
 * mileage/lodging/per-diem, supervisor, lift), shop & engineering hours with
 * auto PM/drafting defaults, misc allowance and margin.
 */

const MOBFIELD: CSSProperties = {
  width: "100%",
  textAlign: "right",
  fontSize: 13,
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "8px 10px",
  background: "#fff",
};

const TXTAREA: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "7px 9px",
  background: "#fff",
  resize: "vertical",
  lineHeight: 1.4,
};

const DISC_OPTIONS: [string, string][] = [
  ["RIG", "Rigging"],
  ["LIG", "Lighting"],
  ["AUD", "Audio"],
  ["VID", "Video"],
];

/** $50/hr · $52.50/hr — cents only when they exist (fmt()'s always-2 is noise here). */
function perHr(n: number): string {
  const v = round2(n);
  return "$" + (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2)) + "/hr";
}

const CHIP_WARN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "#9a7d1f",
  background: "#fffdf6",
  border: "1px solid #efe4c4",
  borderRadius: 5,
  padding: "2px 5px",
  whiteSpace: "nowrap",
};

/**
 * Resolved $/hr for one rate sku, with its provenance made visible — a live
 * catalog row shows the number alone; a hardcoded LABOR_RATES_FALLBACK value
 * gets a "default" chip (item 54: a missing/renamed catalog row must not look
 * like a real rate).
 */
function RateChip({ sku, label, rate }: { sku: string; label: string; rate: RateFn }) {
  const src: RateSource = rate.source ? rate.source(sku) : "catalog";
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
      title={
        sku +
        (src === "catalog"
          ? " · live catalog rate (Catalog › Labor)"
          : src === "fallback"
            ? " · built-in default — no catalog row with this SKU"
            : " · no rate found — priced at $0")
      }
    >
      <span style={{ fontSize: 10.5, color: "#aab0bb" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          fontWeight: 700,
          color: src === "none" ? "#c0683a" : "#16181d",
        }}
      >
        {perHr(rate(sku))}
      </span>
      {src !== "catalog" && (
        <span style={CHIP_WARN}>{src === "none" ? "no rate" : "default"}</span>
      )}
    </span>
  );
}

export default function LaborModal({
  secName,
  draft,
  rate,
  travel,
  onSet,
  onSetAutoHrs,
  onResetAutoHrs,
  onAddMob,
  onRemoveMob,
  onSetMob,
  onSetMobNameSelect,
  onUseMobNameList,
  onSetTripLocal,
  onApplyTravelTrip,
  onToggleMobFlag,
  onApplyAutoMiles,
  onAdd,
  onClose,
}: {
  secName: string;
  draft: LaborDraft;
  rate: RateFn;
  travel: TravelLite | null;
  onSet: (field: "discipline" | "margin" | "shopHrs" | "misc", val: string) => void;
  onSetAutoHrs: (field: "pmHrs" | "drfHrs", flag: "pmAuto" | "drfAuto", val: string) => void;
  onResetAutoHrs: (field: "pmHrs" | "drfHrs", flag: "pmAuto" | "drfAuto") => void;
  onAddMob: () => void;
  onRemoveMob: (i: number) => void;
  onSetMob: (i: number, field: keyof MobDraft, val: string) => void;
  onSetMobNameSelect: (i: number, val: string) => void;
  onUseMobNameList: (i: number) => void;
  onSetTripLocal: (i: number) => void;
  onApplyTravelTrip: (i: number) => void;
  onToggleMobFlag: (i: number, field: "sup" | "lift") => void;
  onApplyAutoMiles: (i: number) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const lr = computeLabor(draft, rate);
  const valid = lr.totalCost > 0;
  const pctLabel = Math.round(lr.pct * 100) + "%";

  // rate readout (item 54) — base installer rate always; OT / supervisor only
  // when the current mobilization toggles actually bill them
  const anyOt = lr.mobs.some((m) => (parseFloat(m.raw.otHrs) || 0) > 0);
  const anySup = lr.mobs.some((m) => m.supHrs > 0);

  // travel-derived hints (round-trip mileage + >1h auto trip type, E3/E4)
  const autoRT = travel && travel.miles != null ? Math.round(travel.miles * 2) : null;
  const autoOffice = travel?.officeName ?? null;
  const oneWayMin = travel && travel.minutes != null ? travel.minutes : null;
  const farTravel = oneWayMin != null && oneWayMin > 60;
  const oneWayLabel = oneWayMin != null ? fmtTime(oneWayMin) : "";

  const pillFar: CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontSize: 10.5,
    fontWeight: 600,
    color: ACCENT_INK,
    background: ACCENT_SOFT,
    borderRadius: 6,
    padding: "4px 8px",
    whiteSpace: "nowrap",
  };
  const pillMuted: CSSProperties = { fontSize: 10.5, color: "#aab0bb", whiteSpace: "nowrap" };

  return (
    <ConfigModal
      width={660}
      icon="⏱"
      iconSize={15}
      title="Configure labor"
      sub={<>Adds to {secName} · one line per mobilization</>}
      onClose={onClose}
      footerLeft={
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Stat label="Cost" value={fmt(lr.totalCost)} color="#8c919c" />
          <Stat
            label="Price · ext"
            value={lr.totalPrice > 0 ? fmt(lr.totalPrice) : "—"}
            size={14}
            weight={700}
          />
        </div>
      }
      footerRight={
        <button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>
          Add labor
        </button>
      }
    >
      {/* discipline */}
      <div style={{ marginBottom: 18 }}>
        <label style={LBL}>
          Scope{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · picks the rate set from the catalog
          </span>
        </label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {DISC_OPTIONS.map(([v, l]) => (
            <button
              type="button"
              key={v}
              onClick={() => onSet("discipline", v)}
              style={segBtn(draft.discipline === v)}
            >
              {l}
            </button>
          ))}
        </div>
        {/* resolved $/hr for the selected scope — shows whether each rate is a
            live catalog row or the built-in default (item 54) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 10,
            padding: "8px 11px",
            border: "1px solid #eef0f3",
            borderRadius: 9,
            background: "#fafbfc",
          }}
        >
          <RateChip sku={lr.disc + "-LBR"} label="Installer" rate={rate} />
          {anyOt && <RateChip sku={lr.disc + "-OT"} label="Overtime" rate={rate} />}
          {anySup && <RateChip sku={lr.disc + "-SUP"} label="Supervisor" rate={rate} />}
        </div>
      </div>

      {/* mobilizations */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <label
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "#aab0bb",
            textTransform: "uppercase",
            letterSpacing: ".04em",
          }}
        >
          Mobilizations
        </label>
        <button
          type="button"
          onClick={onAddMob}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--accent)",
            background: ACCENT_SOFT,
            border: "none",
            borderRadius: 7,
            padding: "6px 11px",
            cursor: "pointer",
          }}
        >
          + Add mobilization
        </button>
      </div>

      {lr.mobs.map((m, i) => {
        const raw = m.raw;
        const nameAsCustom = !!(raw.nameCustom === true || (raw.name && MOB_TYPES.indexOf(raw.name) < 0));
        const nameSelectVal = raw.name && MOB_TYPES.indexOf(raw.name) >= 0 ? raw.name : "";
        const crewHint = m.reg > 0 ? m.reg + " reg hr" + (m.supHrs ? " + " + m.supHrs + " sup" : "") : "—";
        const travHint = m.travel
          ? m.vehicles + " veh · " + m.days + " nt lodging · per diem"
          : raw.milesRT
            ? "daily mileage"
            : "no travel";
        const tripHintShow = oneWayMin != null;
        const tripAutoFar = farTravel && raw.tripAuto !== false;
        const tripHintLabel =
          oneWayMin == null
            ? ""
            : tripAutoFar
              ? "Auto-set to Travel · " + oneWayLabel + " each way"
              : oneWayLabel + " each way";
        const autoMilesShow = autoRT != null && String(raw.milesRT || "") !== String(autoRT);

        return (
          <div
            key={i}
            style={{
              border: "1px solid #eef0f3",
              borderRadius: 11,
              padding: 14,
              marginBottom: 11,
              background: "#fafbfc",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#9aa0ab",
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                Mobilization {i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {!nameAsCustom ? (
                  <select
                    className="est-field"
                    value={nameSelectVal}
                    onChange={(e) => onSetMobNameSelect(i, e.target.value)}
                    style={{
                      width: "100%",
                      fontFamily: "var(--font-ui)",
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: "#16181d",
                      border: "1px solid #e4e7ec",
                      borderRadius: 7,
                      padding: "7px 9px",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <option value="">Select type…</option>
                    {MOB_TYPES.map((mt) => (
                      <option key={mt} value={mt}>
                        {mt}
                      </option>
                    ))}
                    <option value="__custom__">+ Custom…</option>
                  </select>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      className="est-field"
                      value={raw.name}
                      onChange={(e) => onSetMob(i, "name", e.target.value)}
                      placeholder="Custom label…"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        color: "#16181d",
                        border: "1px solid #e4e7ec",
                        borderRadius: 7,
                        padding: "7px 9px",
                        background: "#fff",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => onUseMobNameList(i)}
                      title="Pick from the list instead"
                      style={{
                        flexShrink: 0,
                        fontFamily: "var(--font-ui)",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#8c919c",
                        background: "#f1f2f5",
                        border: "none",
                        borderRadius: 7,
                        padding: "7px 9px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ↩ List
                    </button>
                  </div>
                )}
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#16181d",
                  whiteSpace: "nowrap",
                }}
              >
                {fmt(m.cost)}
              </span>
              {lr.mobs.length > 1 && (
                <button
                  type="button"
                  className="est-x"
                  onClick={() => onRemoveMob(i)}
                  title="Remove mobilization"
                  style={{
                    width: 24,
                    height: 24,
                    border: "none",
                    background: "#f1f2f5",
                    borderRadius: 7,
                    color: "#8c919c",
                    fontSize: 15,
                    lineHeight: 1,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {/* trip type */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginBottom: 11,
                flexWrap: "wrap",
              }}
            >
              <button type="button" onClick={() => onSetTripLocal(i)} style={segBtn(raw.tripType === "local")}>
                Local
              </button>
              <button
                type="button"
                onClick={() => onApplyTravelTrip(i)}
                style={segBtn(raw.tripType === "travel")}
              >
                Travel
              </button>
              {tripHintShow && <span style={tripAutoFar ? pillFar : pillMuted}>{tripHintLabel}</span>}
            </div>

            {/* people / days / OT */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10,
                marginBottom: 11,
              }}
            >
              <div>
                <label style={{ ...LBL, marginBottom: 5 }}>Crew</label>
                <input
                  className="est-input est-field"
                  value={raw.people}
                  onChange={(e) => onSetMob(i, "people", e.target.value)}
                  placeholder="4"
                  style={MOBFIELD}
                />
              </div>
              <div>
                <label style={{ ...LBL, marginBottom: 5 }}>Days</label>
                <input
                  className="est-input est-field"
                  value={raw.days}
                  onChange={(e) => onSetMob(i, "days", e.target.value)}
                  placeholder="5"
                  style={MOBFIELD}
                />
              </div>
              <div>
                <label style={{ ...LBL, marginBottom: 5 }}>OT hrs</label>
                <input
                  className="est-input est-field"
                  value={raw.otHrs}
                  onChange={(e) => onSetMob(i, "otHrs", e.target.value)}
                  placeholder="0"
                  style={MOBFIELD}
                />
              </div>
            </div>

            {/* miles / toggles */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                gap: 10,
                alignItems: "end",
              }}
            >
              <div>
                <label style={{ ...LBL, marginBottom: 5 }}>Round-trip miles / vehicle</label>
                <input
                  className="est-input est-field"
                  value={raw.milesRT}
                  onChange={(e) => onSetMob(i, "milesRT", e.target.value)}
                  placeholder="0"
                  style={MOBFIELD}
                />
              </div>
              <button type="button" onClick={() => onToggleMobFlag(i, "sup")} style={segBtn(raw.sup)}>
                Supervisor
              </button>
              <button type="button" onClick={() => onToggleMobFlag(i, "lift")} style={segBtn(raw.lift)}>
                Site lift
              </button>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginTop: 9,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 10.5, color: "#aab0bb", lineHeight: 1.4 }}>
                {crewHint} · {travHint}
              </div>
              {autoMilesShow && (
                <button
                  type="button"
                  onClick={() => onApplyAutoMiles(i)}
                  title="Auto-fill round-trip miles from the customer's location"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: ACCENT_SOFT,
                    border: "none",
                    borderRadius: 6,
                    padding: "5px 9px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  ↺ Use {autoRT!.toLocaleString()} mi RT{autoOffice ? " · " + autoOffice : ""}
                </button>
              )}
            </div>

            {/* per-mobilization notes */}
            <div
              style={{
                marginTop: 11,
                paddingTop: 11,
                borderTop: "1px solid #eef0f3",
                display: "grid",
                gap: 10,
              }}
            >
              <div>
                <label style={LBL5}>
                  Additional comments{" "}
                  <span
                    style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "#c4c9d2" }}
                  >
                    · shows on the estimate line item
                  </span>
                </label>
                <textarea
                  className="est-field"
                  value={raw.comments}
                  onChange={(e) => onSetMob(i, "comments", e.target.value)}
                  rows={2}
                  placeholder="Appears on the customer-facing line item for this mobilization…"
                  style={TXTAREA}
                />
              </div>
              <div>
                <label style={{ ...LBL5, color: "#9a7d1f" }}>
                  Internal notes{" "}
                  <span
                    style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "#c4b173" }}
                  >
                    · internal only · stays with the mobilization into the project
                  </span>
                </label>
                <textarea
                  className="est-warm"
                  value={raw.internalNote}
                  onChange={(e) => onSetMob(i, "internalNote", e.target.value)}
                  rows={2}
                  placeholder="Crew / PM notes — never shown to the customer…"
                  style={{ ...TXTAREA, border: "1px solid #efe4c4", background: "#fffdf6" }}
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* shop & engineering */}
      <div style={{ marginTop: 16, padding: 14, border: "1px solid #eef0f3", borderRadius: 11 }}>
        <label style={{ ...LBL, marginBottom: 9 }}>
          Shop &amp; engineering{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · in-house hours (added once)
          </span>
        </label>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 11,
          }}
        >
          <RateChip sku="SHP-PM" label="PM" rate={rate} />
          <RateChip sku="SHP-IN" label="In-house" rate={rate} />
          <RateChip sku="DRF-SUB" label="Drafting" rate={rate} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <label style={LBL5}>PM hrs</label>
            <input
              className="est-input est-field"
              value={lr.pmAuto ? String(lr.pmHrs) : draft.pmHrs}
              onChange={(e) => onSetAutoHrs("pmHrs", "pmAuto", e.target.value)}
              placeholder="0"
              style={MOBFIELD}
            />
            <div style={{ marginTop: 4, minHeight: 13, lineHeight: 1, textAlign: "right" }}>
              {lr.pmAuto ? (
                <span style={{ fontSize: 9, color: "#aab0bb" }}>Auto · {pctLabel} of reg</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onResetAutoHrs("pmHrs", "pmAuto")}
                  title="Reset to the scope default"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 9,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  ↺ Auto · {pctLabel}
                </button>
              )}
            </div>
          </div>
          <div>
            <label style={LBL5}>In-house hrs</label>
            <input
              className="est-input est-field"
              value={draft.shopHrs}
              onChange={(e) => onSet("shopHrs", e.target.value)}
              placeholder="0"
              style={MOBFIELD}
            />
          </div>
          <div>
            <label style={LBL5}>Drafting hrs</label>
            <input
              className="est-input est-field"
              value={lr.drfAuto ? String(lr.drfHrs) : draft.drfHrs}
              onChange={(e) => onSetAutoHrs("drfHrs", "drfAuto", e.target.value)}
              placeholder="0"
              style={MOBFIELD}
            />
            <div style={{ marginTop: 4, minHeight: 13, lineHeight: 1, textAlign: "right" }}>
              {lr.drfAuto ? (
                <span style={{ fontSize: 9, color: "#aab0bb" }}>Auto · {pctLabel} of reg</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onResetAutoHrs("drfHrs", "drfAuto")}
                  title="Reset to the scope default"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 9,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  ↺ Auto · {pctLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* misc + margin */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 11 }}>
        <div>
          <label style={LBL5}>Misc / allowance ($)</label>
          <input
            className="est-input est-field"
            value={draft.misc}
            onChange={(e) => onSet("misc", e.target.value)}
            placeholder="0"
            style={MOBFIELD}
          />
        </div>
        <div>
          <label style={LBL5}>Margin (%)</label>
          <input
            className="est-input est-field"
            value={draft.margin}
            onChange={(e) => onSet("margin", e.target.value)}
            placeholder="30"
            style={MOBFIELD}
          />
        </div>
      </div>
    </ConfigModal>
  );
}
