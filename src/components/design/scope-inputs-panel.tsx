"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import {
  DIMSCHEMA,
  LIM,
  SHORT,
  SIZES,
  SUBCFG,
  SYSCOLOR,
  SYSSUB,
  SYS_ORDER,
  VENUES,
  clamp,
  sizedDims,
  venueOf,
  type DimField,
  type QuickScopeInputs,
  type SysKey,
} from "@/app/(app)/design/quick/engine";

/**
 * Shared venue/size/dimensions/systems-to-include config panel
 * (D-manual-scope-targets). Extracted verbatim from Quick Design's inline
 * "Design inputs" block so it can be reused by both Quick Design (Auto,
 * all 8 systems) and the Grid sidebar (Manual, 5 catalog-trackable
 * systems) — same visuals, same interaction order, same style objects.
 *
 * Controlled component: caller owns `value`/`onChange`. The only internal
 * state is `sec`, the per-section collapse/expand UI toggle.
 */

const ACCENT = "var(--accent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #000)";
const MONO = "var(--font-mono)";
const UI = "var(--font-ui)";

const secLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".06em",
  textTransform: "uppercase",
};

const stepBtn: CSSProperties = {
  width: 26,
  height: 26,
  border: "1px solid #e4e7ec",
  background: "#fff",
  borderRadius: 7,
  color: "#5b616e",
  fontSize: 16,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
};

function chipStyle(sel: boolean): CSSProperties {
  return {
    flex: "1 1 auto",
    minWidth: 54,
    textAlign: "center",
    fontFamily: UI,
    fontSize: 11,
    fontWeight: 600,
    padding: "6px 6px",
    borderRadius: 7,
    cursor: "pointer",
    border: `1px solid ${sel ? ACCENT : "#e4e7ec"}`,
    background: sel ? ACCENT_SOFT : "#fff",
    color: sel ? ACCENT_INK : "#5b616e",
  };
}

export default function ScopeInputsPanel({
  value,
  onChange,
  systems,
  fixtureAssemblies: fixtureAssembliesProp,
  accentHex,
}: {
  value: QuickScopeInputs;
  onChange: (patch: Partial<QuickScopeInputs>) => void;
  /** Allowlist + display order — pass engine.ts's SYS_ORDER for Auto (all
   * 8), or the 5 catalog-trackable systems for Manual mode. */
  systems: SysKey[];
  /** Catalog-backed lighting assembly picker (Auto/Quick Design only) —
   * Manual-mode caller simply omits it and the sub-picker never renders. */
  fixtureAssemblies?: Array<{ id: string; name: string }>;
  accentHex: string;
}) {
  const [sec, setSec] = useState({ venue: true, size: true, dims: true, systems: true });
  const venue = venueOf(value);

  const update = (patch: Partial<QuickScopeInputs>) => onChange(patch);
  /** A fixture pick whose assembly is no longer offered (deleted) — fix wave
   *  3, I2: it prices needs-a-part, so the picker shows it and lets it be changed. */
  const fixtureAssemblies = fixtureAssembliesProp || [];
  const liveAssemblyIds = new Set(fixtureAssemblies.map((x) => x.id));
  const isDeadPick = (fxKey: string) => {
    const id = value.fixtureAssemblies?.[fxKey];
    return !!id && !liveAssemblyIds.has(id);
  };
  // Only where the picker is offered (Quick Design) — Manual mode omits it.
  const deadPicks = fixtureAssembliesProp ? Object.keys(value.fixtureAssemblies || {}).filter((k) => !!value.fixtures?.[k] && isDeadPick(k)) : [];
  const setVenue = (vk: string) => {
    const v = VENUES.find((x) => x.key === vk) || VENUES[0];
    const d = sizedDims(v, value.size);
    update({ venue: vk, sys: { ...v.sys }, ...d });
  };
  const stepDim = (field: DimField, dir: number) => {
    const l = LIM[field];
    update({ [field]: clamp(value[field] + dir * 2, l[0], l[1]) } as Partial<QuickScopeInputs>);
  };
  const setDimVal = (field: DimField, raw: string) => {
    const l = LIM[field];
    let v = parseInt(raw, 10);
    if (isNaN(v)) v = l[0];
    update({ [field]: clamp(v, l[0], l[1]) } as Partial<QuickScopeInputs>);
  };
  const toggleSys = (sk: SysKey) => update({ sys: { ...value.sys, [sk]: !value.sys[sk] } });
  const setSingle = (field: string, val: string) => update({ [field]: val } as Partial<QuickScopeInputs>);
  const toggleMulti = (field: string, opt: string) => {
    const o = (value as unknown as Record<string, Record<string, boolean>>)[field] || {};
    update({ [field]: { ...o, [opt]: !o[opt] } } as Partial<QuickScopeInputs>);
  };

  return (
    <>
      {/* venue type */}
      <button onClick={() => setSec({ ...sec, venue: !sec.venue })} title="Show/hide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>
        <span style={secLabel}>Venue type</span>
        <span style={{ display: "inline-block", fontSize: 14, color: "#aab0bb", lineHeight: 1, transition: "transform .15s", transform: sec.venue ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
      </button>
      {sec.venue && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 22 }}>
          {VENUES.map((v) => {
            const on = v.key === value.venue;
            return (
              <button key={v.key} onClick={() => setVenue(v.key)} style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left", padding: "11px 12px", borderRadius: 10, cursor: "pointer", background: on ? ACCENT_SOFT : "#fff", border: `1.5px solid ${on ? ACCENT : "#e8eaee"}` }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#16181d" }}>{v.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* size */}
      <button onClick={() => setSec({ ...sec, size: !sec.size })} title="Show/hide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>
        <span style={secLabel}>Size of venue</span>
        <span style={{ display: "inline-block", fontSize: 14, color: "#aab0bb", lineHeight: 1, transition: "transform .15s", transform: sec.size ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
      </button>
      {sec.size && (
        <div style={{ display: "flex", gap: 9, marginBottom: 22 }}>
          {SIZES.map(([key, label]) => {
            const on = key === value.size;
            return (
              <button key={key} onClick={() => update({ size: key })} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600, padding: "10px 8px", borderRadius: 10, cursor: "pointer", background: on ? ACCENT_SOFT : "#fff", border: `1.5px solid ${on ? ACCENT : "#e8eaee"}`, color: on ? ACCENT_INK : "#5b616e", fontFamily: UI }}>
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* dims */}
      <button onClick={() => setSec({ ...sec, dims: !sec.dims })} title="Show/hide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 11 }}>
        <span style={secLabel}>Stage dimensions</span>
        <span style={{ display: "inline-block", fontSize: 14, color: "#aab0bb", lineHeight: 1, transition: "transform .15s", transform: sec.dims ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
      </button>
      {sec.dims && (
        <div style={{ display: "flex", flexDirection: "column", gap: 15, marginBottom: 22 }}>
          {(DIMSCHEMA[venue.kind] || DIMSCHEMA.proscenium).map((d) => (
            <div key={d.field}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: "#aab0bb" }}>{d.note}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                  <button onClick={() => stepDim(d.field, -1)} style={stepBtn}>–</button>
                  <span style={{ fontFamily: MONO, fontSize: 14.5, fontWeight: 600, minWidth: 52, textAlign: "center" }}>{value[d.field]} ft</span>
                  <button onClick={() => stepDim(d.field, 1)} style={stepBtn}>+</button>
                </div>
              </div>
              <input type="range" min={LIM[d.field][0]} max={LIM[d.field][1]} step={2} value={value[d.field]} onChange={(e) => setDimVal(d.field, e.target.value)} style={{ width: "100%", accentColor: accentHex, cursor: "pointer" }} />
            </div>
          ))}
        </div>
      )}

      {/* systems */}
      <button onClick={() => setSec({ ...sec, systems: !sec.systems })} title="Show/hide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 11 }}>
        <span style={secLabel}>Systems to include</span>
        <span style={{ display: "inline-block", fontSize: 14, color: "#aab0bb", lineHeight: 1, transition: "transform .15s", transform: sec.systems ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
      </button>
      {sec.systems && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SYS_ORDER.filter((key) => systems.includes(key)).map((key) => {
            const on = value.sys[key];
            const dot = SYSCOLOR[key];
            const name = SHORT[key];
            const cfg = SUBCFG[key];
            let chips: Array<{ label: string; sel: boolean; onClick: () => void }> = [];
            let sub: string = SYSSUB[key];
            if (cfg) {
              if (cfg.mode === "single") {
                const cur = (value as unknown as Record<string, string>)[cfg.stateKey];
                chips = cfg.options.map(([v, l]) => ({ label: l, sel: cur === v, onClick: () => setSingle(cfg.stateKey, v) }));
                const f = cfg.options.find((o) => o[0] === cur);
                if (f) sub = f[1];
              } else {
                const obj = ((value as unknown as Record<string, Record<string, boolean>>)[cfg.stateKey] || {}) as Record<string, boolean>;
                chips = cfg.options.map(([v, l]) => ({ label: l, sel: !!obj[v], onClick: () => toggleMulti(cfg.stateKey, v) }));
                const picked = cfg.options.filter(([v]) => obj[v]).map(([, l]) => l);
                sub = picked.length ? picked.join(" · ") : "Select options";
              }
            }
            return (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button onClick={() => toggleSys(key)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", padding: "11px 13px", borderRadius: 10, cursor: "pointer", background: on ? "#fff" : "#f7f8fa", border: `1px solid ${on ? "#e8eaee" : "#eef0f3"}` }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: on ? dot : "#d6d9e0" }} />
                    <span style={{ textAlign: "left", minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#16181d" }}>{name}</span>
                      <span style={{ display: "block", fontSize: 11, color: "#9aa0ab" }}>{sub}</span>
                    </span>
                  </span>
                  <span style={{ position: "relative", width: 36, height: 20, borderRadius: 999, flexShrink: 0, transition: "background .15s", background: on ? ACCENT : "#d6d9e0" }}>
                    <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.25)", transition: "left .15s" }} />
                  </span>
                </button>
                {on && chips.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "1px 2px 3px" }}>
                    {chips.map((ch) => (
                      <button key={ch.label} onClick={ch.onClick} style={chipStyle(ch.sel)}>
                        {ch.label}
                      </button>
                    ))}
                  </div>
                )}
                {on && key === "lighting" && (fixtureAssemblies.length > 0 || deadPicks.length > 0) && (
                  <div style={{ display: "grid", gap: 6, padding: "4px 2px 6px" }}>
                    {([["par", "Par"], ["front", "Front"], ["cyc", "Cyc"], ["side", "Side light"], ["automated", "Automated"]] as Array<[string, string]>)
                      .filter(([fxKey]) => !!value.fixtures?.[fxKey])
                      .map(([fxKey, label]) => (
                        <label key={fxKey} style={{ display: "grid", gridTemplateColumns: "82px minmax(0,1fr)", gap: 8, alignItems: "center", fontSize: 11.5, color: "#777d88" }}>
                          <span>{label}</span>
                          <select
                            value={value.fixtureAssemblies?.[fxKey] || ""}
                            onChange={(event) => update({ fixtureAssemblies: { ...(value.fixtureAssemblies || {}), [fxKey]: event.target.value } })}
                            title={isDeadPick(fxKey) ? "This assembly was deleted — the row needs a part until you choose another" : undefined}
                            style={{ minWidth: 0, border: `1px solid ${isDeadPick(fxKey) ? "#d9a08f" : "#e4e7ec"}`, borderRadius: 7, padding: "6px 8px", background: isDeadPick(fxKey) ? "#fdf1ed" : "#fff", color: isDeadPick(fxKey) ? "#a0442b" : undefined, fontSize: 11.5 }}
                          >
                            {isDeadPick(fxKey) && <option value={value.fixtureAssemblies![fxKey]}>(deleted — choose another)</option>}
                            <option value="">Generic allowance</option>
                            {fixtureAssemblies.map((assembly) => (
                              <option key={assembly.id} value={assembly.id}>{assembly.name}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
