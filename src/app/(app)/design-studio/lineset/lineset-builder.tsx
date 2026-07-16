"use client";

import { useMemo, useState } from "react";
import {
  generateLineset,
  DEFAULT_LINESET_INPUTS,
  type LinesetInputs,
} from "@/lib/design/lineset";

const card: React.CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "16px 18px", boxShadow: "0 1px 2px rgba(0,0,0,.04)" };
const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4, display: "block" };
const field: React.CSSProperties = { width: "100%", border: "1px solid #dfe2e8", borderRadius: 8, padding: "8px 10px", fontSize: 13.5, boxSizing: "border-box", background: "#fff" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "#9aa0ab", padding: "6px 10px", borderBottom: "1px solid #eef0f3", position: "sticky", top: 0, background: "#fff" };
const td: React.CSSProperties = { fontSize: 13, padding: "7px 10px", borderBottom: "1px solid #f4f5f7" };

const TYPE_COLOR: Record<string, string> = {
  Electric: "#3155a8",
  Shell: "#1f7a52",
  Border: "#8a6d1f",
  Draw: "#7b3f8a",
  Legs: "#b4543a",
  CYC: "#2f6f8f",
  Rear: "#5b616e",
  "Midstage Draw": "#7b3f8a",
  "General Purpose": "#6b7079",
};

function NumF({ v, set, w }: { v: number; set: (n: number) => void; w?: number }) {
  return <input type="number" value={v} onChange={(e) => set(parseFloat(e.target.value) || 0)} style={{ ...field, ...(w ? { width: w } : {}) }} />;
}

export function LinesetBuilder() {
  const [inp, setInp] = useState<LinesetInputs>(DEFAULT_LINESET_INPUTS);
  const [showGrid, setShowGrid] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const set = <K extends keyof LinesetInputs>(k: K, v: LinesetInputs[K]) => setInp((s) => ({ ...s, [k]: v }));

  const out = useMemo(() => generateLineset(inp), [inp]);
  const view = showGrid ? out.slots : out.schedule;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      {/* inputs */}
      <div style={card}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Venue dimensions</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><span style={label}>Width (ft)</span><NumF v={inp.stageWidthFt} set={(n) => set("stageWidthFt", n)} /></div>
          <div><span style={label}>Width (in)</span><NumF v={inp.stageWidthIn} set={(n) => set("stageWidthIn", n)} /></div>
          <div><span style={label}>Depth (ft)</span><NumF v={inp.stageDepthFt} set={(n) => set("stageDepthFt", n)} /></div>
          <div><span style={label}>Depth (in)</span><NumF v={inp.stageDepthIn} set={(n) => set("stageDepthIn", n)} /></div>
        </div>

        <div style={{ fontSize: 13.5, fontWeight: 700, margin: "16px 0 8px" }}>Auto-layout</div>
        {([
          ["includeElectrics", "Regular electrics (every 10')"],
          ["includeShells", "Shell lines"],
          ["includeRearCyc", "Rear + CYC pair"],
          ["includeMidstage", "Midstage draw"],
        ] as [keyof LinesetInputs, string][]).map(([k, lbl]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={inp[k] as boolean} onChange={(e) => set(k, e.target.checked as never)} /> {lbl}
          </label>
        ))}
        <div style={{ marginTop: 8 }}><span style={label}>General-purpose lines</span><NumF v={inp.gpCount} set={(n) => set("gpCount", n)} /></div>

        <button onClick={() => setAdvanced((a) => !a)} style={{ marginTop: 14, background: "none", border: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
          {advanced ? "▾ Hide" : "▸ Advanced"} rule parameters
        </button>
        {advanced && (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><span style={label}>Slot spacing (in)</span><NumF v={inp.slotSpacingIn} set={(n) => set("slotSpacingIn", n)} /></div>
            <div><span style={label}>Electric interval (ft)</span><NumF v={inp.electricIntervalFt} set={(n) => set("electricIntervalFt", n)} /></div>
            <div><span style={label}>Electric offset (in)</span><NumF v={inp.electricOffsetIn} set={(n) => set("electricOffsetIn", n)} /></div>
            <div><span style={label}>Shell interval (ft)</span><NumF v={inp.shellIntervalFt} set={(n) => set("shellIntervalFt", n)} /></div>
            <div><span style={label}>Shell start (ft)</span><NumF v={inp.shellStartFt} set={(n) => set("shellStartFt", n)} /></div>
            <div><span style={label}>Clearance (in)</span><NumF v={inp.clearanceIn} set={(n) => set("clearanceIn", n)} /></div>
            <div><span style={label}>CYC off back wall (ft)</span><NumF v={inp.cycOffsetFt} set={(n) => set("cycOffsetFt", n)} /></div>
            <div><span style={label}>Max elec from CYC (ft)</span><NumF v={inp.maxElecFromCycFt} set={(n) => set("maxElecFromCycFt", n)} /></div>
          </div>
        )}
        <button onClick={() => setInp(DEFAULT_LINESET_INPUTS)} style={{ marginTop: 14, width: "100%", background: "#f6f7f9", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 600, color: "#5b616e", cursor: "pointer" }}>
          Reset to 80′ × 30′ defaults
        </button>
      </div>

      {/* schedule */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>
            {showGrid ? "8-inch grid" : "Final schedule"} · {view.length} {showGrid ? "slots" : "lines"}
          </div>
          <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#5b616e" }}>
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Show full grid
          </label>
        </div>
        <div style={{ fontSize: 12, color: "#6b7079", marginBottom: 10, background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 8, padding: "8px 11px" }}>
          {out.summary.activeSlotCount} active slots · CYC at slot {out.summary.targetCycSlot} · {out.summary.status}
        </div>
        <div style={{ maxHeight: 560, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
            <thead>
              <tr>
                {!showGrid && <th style={th}>#</th>}
                <th style={th}>Slot</th>
                <th style={th}>Downstage</th>
                <th style={th}>Type</th>
                <th style={th}>Name</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {view.map((s, i) => (
                <tr key={s.slot} style={showGrid && !s.type ? { opacity: 0.45 } : undefined}>
                  {!showGrid && <td style={{ ...td, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}>{i + 1}</td>}
                  <td style={{ ...td, fontFamily: "var(--font-mono)", color: "#9aa0ab" }}>{s.slot}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{s.dsPositionLabel || "—"}</td>
                  <td style={td}>
                    {s.type ? (
                      <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, color: "#fff", background: TYPE_COLOR[s.type] || "#6b7079" }}>
                        {s.type}
                      </span>
                    ) : (
                      <span style={{ color: "#c4c9d2", fontSize: 12 }}>open</span>
                    )}
                  </td>
                  <td style={{ ...td, fontWeight: 500 }}>{s.name}</td>
                  <td style={td}>{s.warning && <span title={s.warning} style={{ color: "#b4543a", fontSize: 12 }}>⚠</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 12, lineHeight: 1.5 }}>
          Auto-placement follows the built-in rules: fixed 0′ border + 8″ draw, electrics every {inp.electricIntervalFt}′
          (borders 16″ in front, legs matched), shells from ~{inp.shellStartFt}′ every ~{inp.shellIntervalFt}′, CYC ~
          {inp.cycOffsetFt}′ off the back wall with rear adjacent, midstage at center, and general-purpose lines spread
          across open gaps. ⚠ marks a clearance rule broken (not blocked). Reference layout — verify on site.
        </p>
      </div>
    </div>
  );
}
