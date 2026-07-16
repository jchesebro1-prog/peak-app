"use client";

import { useMemo, useState } from "react";
import {
  computeSetWeight,
  DEFAULT_WEIGHTS,
  FABLIB,
  CHAINS,
  TRACKS,
  BATTENS,
  PRODIGY_HOISTS,
  fmt,
  type WeightDefaults,
  type WeightLine,
  type LinesetMode,
} from "@/lib/design/steel";
import { SaveBar, type SavedRef } from "../save-bar";
import { downloadCsv } from "../export";

const card: React.CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "16px 18px", boxShadow: "0 1px 2px rgba(0,0,0,.04)" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#5b616e", marginBottom: 3, display: "block" };
const field: React.CSSProperties = { width: "100%", border: "1px solid #dfe2e8", borderRadius: 7, padding: "6px 8px", fontSize: 12.5, boxSizing: "border-box", background: "#fff" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase", color: "#9aa0ab", padding: "5px 6px", borderBottom: "1px solid #eef0f3" };
const td: React.CSSProperties = { fontSize: 12.5, padding: "5px 6px", borderBottom: "1px solid #f4f5f7", verticalAlign: "middle" };
const kpi = (accent?: boolean): React.CSSProperties => ({ flex: "1 1 150px", background: accent ? "color-mix(in srgb, var(--accent) 8%, #fff)" : "#f7f8fa", border: `1px solid ${accent ? "color-mix(in srgb, var(--accent) 30%, #fff)" : "#eef0f3"}`, borderRadius: 10, padding: "11px 13px" });

const DEMO: WeightLine[] = [
  { name: "Grand Drape", fab: "Charisma Velour 25 oz", w: 42, h: 24, full: 50, qty: 1, chain: "Med chain ~0.16 lb/ft", mode: "motor", hoist: "P1400" },
  { name: "1st Border", fab: "Encore Velour 22 oz", w: 42, h: 8, full: 50, qty: 1, chain: "Jack chain ~0.14 lb/ft", mode: "motor", hoist: "P900" },
  { name: "1st Legs (pair)", fab: "Encore Velour 22 oz", w: 10, h: 24, full: 50, qty: 2, chain: "Jack chain ~0.14 lb/ft", mode: "motor", hoist: "P900" },
  { name: "1st Electric", fab: "— none —", w: 0, h: 0, gear: 900, pipe: "Ladder 1-1/2 Sch40 x2", mode: "motor", hoist: "P2000" },
  { name: "Mid Traveler", fab: "Charisma Velour 25 oz", w: 44, h: 24, full: 50, qty: 1, chain: "Med chain ~0.16 lb/ft", track: "Standard traveler track (~1.75 lb/ft)", mode: "motor", hoist: "P1400" },
  { name: "Cyclorama", fab: "Muslin, seamless (approx)", w: 44, h: 24, full: 0, qty: 1, chain: "None", batten: 46, mode: "dead" },
];

const MODE_LABEL: Record<LinesetMode, string> = { motor: "Motor", dead: "Dead-hung", cw: "Counterweight" };

export function WeightsTool({
  initial,
  customers = [],
  saved = [],
  loaded = null,
}: {
  initial?: { defaults: WeightDefaults; lines: WeightLine[] };
  customers?: { id: string; name: string }[];
  saved?: SavedRef[];
  loaded?: { id: string; name: string; customerId: string | null } | null;
}) {
  const [def, setDef] = useState<WeightDefaults>(initial?.defaults || DEFAULT_WEIGHTS);
  const [lines, setLines] = useState<WeightLine[]>(initial?.lines || DEMO);
  const [showSettings, setShowSettings] = useState(false);
  const setD = <K extends keyof WeightDefaults>(k: K, v: WeightDefaults[K]) => setDef((s) => ({ ...s, [k]: v }));
  const setL = (i: number, patch: Partial<WeightLine>) => setLines((a) => a.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const computed = useMemo(() => lines.map((l) => computeSetWeight(l, def)), [lines, def]);
  const totals = useMemo(() => {
    let onBatten = 0, setTotal = 0, cw = 0, beamMax = 0;
    computed.forEach((c) => {
      onBatten += c.onBatten;
      setTotal += c.setTotal;
      cw += c.cwLoad;
      beamMax = Math.max(beamMax, c.beamLoad);
    });
    return { onBatten, setTotal, cw, beamMax };
  }, [computed]);

  function exportCsv() {
    const header = ["Line", "Fabric", "Width(ft)", "Height(ft)", "Fullness%", "Qty", "Gear(lb)", "Mode", "Hoist", "Weight on batten(lb)", "Check"];
    const rows: (string | number)[][] = lines.map((l, i) => {
      const c = computed[i];
      const mode = l.mode || def.mode;
      const check = mode === "cw" ? `${c.combo.big}x25+${c.combo.small}x10 brick` : c.over ? "OVER LIMIT" : "OK";
      return [l.name, l.fab || "", l.w ?? 0, l.h ?? 0, l.full ?? def.full, l.qty ?? 1, l.gear ?? 0, MODE_LABEL[mode], mode === "motor" ? l.hoist || def.hoist : "", Math.round(c.onBatten), check];
    });
    rows.push(["TOTAL", "", "", "", "", "", "", "", "", Math.round(totals.onBatten), `${lines.length} lines · peak/beam ${Math.round(totals.beamMax)} lb`]);
    downloadCsv("lineset-weights", header, rows);
  }

  return (
    <div>
      <SaveBar kind="weights" getData={() => ({ defaults: def, lines })} customers={customers} saved={saved} loaded={loaded} loadBase="/design-studio/weights?design=" />
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Schedule defaults</div>
          <button onClick={() => setShowSettings((s) => !s)} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            {showSettings ? "▾ Hide" : "▸ Show"} defaults
          </button>
        </div>
        {showSettings && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10, marginTop: 10 }}>
            <div><span style={label}>Lift lines</span><input type="number" value={def.lines} onChange={(e) => setD("lines", parseFloat(e.target.value) || 1)} style={field} /></div>
            <div><span style={label}>Batten length (ft)</span><input type="number" value={def.battenlen} onChange={(e) => setD("battenlen", parseFloat(e.target.value) || 0)} style={field} /></div>
            <div><span style={label}>Default batten</span><select value={def.pipe} onChange={(e) => setD("pipe", e.target.value)} style={field}>{BATTENS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div>
            <div><span style={label}>Default hoist</span><select value={def.hoist} onChange={(e) => setD("hoist", e.target.value)} style={field}>{PRODIGY_HOISTS.map((h) => <option key={h.id} value={h.id}>{h.id}</option>)}</select></div>
            <div><span style={label}>Fullness %</span><input type="number" value={def.full} onChange={(e) => setD("full", parseFloat(e.target.value) || 0)} style={field} /></div>
            <div><span style={label}>Cut allow (in)</span><input type="number" value={def.cut} onChange={(e) => setD("cut", parseFloat(e.target.value) || 0)} style={field} /></div>
            <div><span style={label}>Hardware lb/ft</span><input type="number" value={def.hwPerFt} step="0.1" onChange={(e) => setD("hwPerFt", parseFloat(e.target.value) || 0)} style={field} /></div>
            <div><span style={label}>Deflection L/</span><input type="number" value={def.defl} onChange={(e) => setD("defl", parseFloat(e.target.value) || 1)} style={field} /></div>
            <div><span style={label}>Design factor</span><input type="number" value={def.df} onChange={(e) => setD("df", parseFloat(e.target.value) || 1)} style={field} /></div>
            <div><span style={label}>Per-line WLL (lb)</span><input type="number" value={def.wll} onChange={(e) => setD("wll", parseFloat(e.target.value) || 0)} style={field} /></div>
            <div><span style={label}>Beam spacing max (ft)</span><input type="number" value={def.beamspace} onChange={(e) => setD("beamspace", parseFloat(e.target.value) || 14)} style={field} /></div>
            <div><span style={label}>Cable mgmt</span><select value={def.cableMgmt ? "y" : "n"} onChange={(e) => setD("cableMgmt", e.target.value === "y")} style={field}><option value="n">No (8 lines)</option><option value="y">Yes (7 lines)</option></select></div>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th}>Line</th><th style={th}>Fabric</th><th style={{ ...th, textAlign: "right" }}>W</th><th style={{ ...th, textAlign: "right" }}>H</th>
                <th style={{ ...th, textAlign: "right" }}>Full</th><th style={{ ...th, textAlign: "right" }}>Qty</th><th style={{ ...th, textAlign: "right" }}>Gear</th>
                <th style={th}>Mode</th><th style={th}>Hoist</th><th style={{ ...th, textAlign: "right" }}>Weight</th><th style={th}>Check</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const c = computed[i];
                return (
                  <tr key={i}>
                    <td style={{ ...td, minWidth: 120 }}><input value={l.name} onChange={(e) => setL(i, { name: e.target.value })} style={field} /></td>
                    <td style={{ ...td, minWidth: 150 }}><select value={l.fab || "— none —"} onChange={(e) => setL(i, { fab: e.target.value })} style={field}><option>— none —</option>{FABLIB.map((f) => <option key={f.name}>{f.name}</option>)}</select></td>
                    <td style={td}><input type="number" value={l.w ?? 0} onChange={(e) => setL(i, { w: parseFloat(e.target.value) || 0 })} style={{ ...field, width: 52, textAlign: "right" }} /></td>
                    <td style={td}><input type="number" value={l.h ?? 0} onChange={(e) => setL(i, { h: parseFloat(e.target.value) || 0 })} style={{ ...field, width: 52, textAlign: "right" }} /></td>
                    <td style={td}><input type="number" value={l.full ?? def.full} onChange={(e) => setL(i, { full: parseFloat(e.target.value) || 0 })} style={{ ...field, width: 48, textAlign: "right" }} /></td>
                    <td style={td}><input type="number" value={l.qty ?? 1} onChange={(e) => setL(i, { qty: parseFloat(e.target.value) || 1 })} style={{ ...field, width: 44, textAlign: "right" }} /></td>
                    <td style={td}><input type="number" value={l.gear ?? 0} onChange={(e) => setL(i, { gear: parseFloat(e.target.value) || 0 })} style={{ ...field, width: 56, textAlign: "right" }} /></td>
                    <td style={td}><select value={l.mode || def.mode} onChange={(e) => setL(i, { mode: e.target.value as LinesetMode })} style={field}><option value="motor">Motor</option><option value="dead">Dead</option><option value="cw">CW</option></select></td>
                    <td style={td}>{(l.mode || def.mode) === "motor" ? <select value={l.hoist || def.hoist} onChange={(e) => setL(i, { hoist: e.target.value })} style={field}>{PRODIGY_HOISTS.map((h) => <option key={h.id} value={h.id}>{h.id}</option>)}</select> : <span style={{ color: "#c4c9d2" }}>—</span>}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmt(c.onBatten)} lb</td>
                    <td style={td}>
                      {(l.mode || def.mode) === "cw" ? (
                        <span title={`${c.combo.big}×25 + ${c.combo.small}×10 lb`} style={{ fontSize: 11.5, color: "#5b616e" }}>{c.combo.big}·{c.combo.small} brick</span>
                      ) : (
                        <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: c.over ? "#b4543a" : "#1f7a52" }} title={c.over ? "Over a limit" : "OK"} />
                      )}
                    </td>
                    <td style={td}><button onClick={() => setLines((a) => a.filter((_, j) => j !== i))} style={{ ...field, width: 28, cursor: "pointer", padding: 0 }}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button onClick={() => setLines((a) => [...a, { name: "New line", mode: def.mode }])} style={{ ...field, width: "auto", cursor: "pointer", fontWeight: 600, color: "var(--accent)", padding: "7px 12px" }}>+ add line</button>
          <button onClick={() => setLines(DEMO)} style={{ ...field, width: "auto", cursor: "pointer", fontWeight: 600, color: "#5b616e", padding: "7px 12px" }}>Load demo schedule</button>
          <button onClick={exportCsv} style={{ ...field, width: "auto", cursor: "pointer", fontWeight: 600, color: "var(--accent)", padding: "7px 12px", marginLeft: "auto" }}>⭳ Export CSV</button>
          <button onClick={() => { try { window.print(); } catch { /* no-op */ } }} className="pk-no-print" style={{ ...field, width: "auto", cursor: "pointer", fontWeight: 600, color: "#5b616e", padding: "7px 12px" }}>⎙ Print</button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <div style={kpi(true)}><div style={{ fontSize: 11, color: "#6b7079" }}>Total on batten</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.onBatten)} lb</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>{lines.length} lines</div></div>
          <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>Peak load / support beam</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.beamMax)} lb</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>across {def.lines} beams</div></div>
          <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>With powerheads</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.setTotal)} lb</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>structure sees</div></div>
          {totals.cw > 0 && <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>Counterweight (CW lines)</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.cw)} lb</div></div>}
        </div>
        <p style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 14, lineHeight: 1.5 }}>
          Goods = flat width (× fullness) × cut height × fabric weight + chain + hardware. Motor lines check hoist
          capacity, per-line 25–420 lb (P75 30–700), max 8 lines (7 w/ cable mgmt), and batten bending. CW lines pick a
          25/10 lb brick combo. Reference only — verify with a licensed PE for any life-safety rigging.
        </p>
      </div>
    </div>
  );
}
