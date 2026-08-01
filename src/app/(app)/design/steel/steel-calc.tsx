"use client";

import { useMemo, useState } from "react";
import {
  SHAPES,
  familiesPresent,
  FAM_LABEL,
  shapeById,
  beamCapacity,
  battenReactions,
  twoLegBridle,
  fmt,
  type SteelShape,
  type LoadType,
  type BattenPoint,
} from "@/lib/design/steel";
import { RIGGING_LIMITATION_NOTICE } from "@/lib/compliance-notices";

/* ---------------- shared styles ---------------- */
const card: React.CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "16px 18px", boxShadow: "0 1px 2px rgba(0,0,0,.04)" };
const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4, display: "block" };
const field: React.CSSProperties = { width: "100%", border: "1px solid #dfe2e8", borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontFamily: "inherit", background: "#fff", boxSizing: "border-box" };
const grid = (min = 130): React.CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 12 });
const btn: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 9, padding: "9px 16px", cursor: "pointer" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "#9aa0ab", padding: "6px 10px", borderBottom: "1px solid #eef0f3" };
const td: React.CSSProperties = { fontSize: 13, padding: "7px 10px", borderBottom: "1px solid #f4f5f7" };
const tag = (ok: boolean): React.CSSProperties => ({ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, color: ok ? "#1f7a52" : "#b4543a", background: ok ? "#eaf6ef" : "#f7e9e5" });
const kpi = (accent?: boolean): React.CSSProperties => ({ flex: "1 1 160px", background: accent ? "color-mix(in srgb, var(--accent) 8%, #fff)" : "#f7f8fa", border: `1px solid ${accent ? "color-mix(in srgb, var(--accent) 30%, #fff)" : "#eef0f3"}`, borderRadius: 10, padding: "12px 14px" });

function Num({ v, set, step, w }: { v: number | string; set: (n: string) => void; step?: string; w?: number }) {
  return <input type="number" value={v} step={step} onChange={(e) => set(e.target.value)} style={{ ...field, ...(w ? { width: w } : {}) }} />;
}

const TABS = [
  { k: "cap", label: "Capacity Check" },
  { k: "size", label: "Member Sizing" },
  { k: "rig", label: "Rigging Loads" },
  { k: "db", label: "Section Database" },
] as const;

export function SteelCalculator() {
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("cap");
  return (
    <div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 16, borderBottom: "1px solid #ececf0", paddingBottom: 2 }}>
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{ fontSize: 13, fontWeight: 600, padding: "8px 14px", border: "none", background: "none", cursor: "pointer", color: tab === t.k ? "var(--accent)" : "#6b7079", borderBottom: `2px solid ${tab === t.k ? "var(--accent)" : "transparent"}`, marginBottom: -3 }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "cap" && <Capacity />}
      {tab === "size" && <Sizing />}
      {tab === "rig" && <Rigging />}
      {tab === "db" && <Database />}
      <p style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 18, lineHeight: 1.5 }}>
        AISC 360 ASD (Ω<sub>b</sub>=1.67 flexure). Rigging WLL divides the plastic/shear strength by
        your design factor.
      </p>
      {/* Limitation notice (punch #73). Wording lives in ONE place
          (src/lib/compliance-notices.ts) — see the DRAFT WORDING comment
          there; not yet reviewed by counsel or signed off by product. */}
      <p style={{ fontSize: 11.5, color: "#6b7079", marginTop: 8, lineHeight: 1.5, borderTop: "1px solid #eef0f3", paddingTop: 10 }}>
        {RIGGING_LIMITATION_NOTICE}
      </p>
    </div>
  );
}

/* ======================= Capacity Check ======================= */
function Capacity() {
  const fams = familiesPresent();
  const [fam, setFam] = useState(fams.includes("W") ? "W" : fams[0]);
  const secs = useMemo(() => SHAPES.filter((s) => s.type === fam), [fam]);
  const [secId, setSecId] = useState(secs[0]?.id || "");
  const [fy, setFy] = useState("");
  const [span, setSpan] = useState("20");
  const [lb, setLb] = useState("20");
  const [load, setLoad] = useState<LoadType>("uniform");
  const [cb, setCb] = useState("1");
  const [df, setDf] = useState("5");
  const [defl, setDefl] = useState("240");
  const [applied, setApplied] = useState("");

  function onFam(f: string) {
    setFam(f);
    const first = SHAPES.find((s) => s.type === f);
    if (first) setSecId(first.id);
  }

  const base = shapeById(secId);
  const s: SteelShape | undefined = base ? { ...base, Fy: parseFloat(fy) || base.Fy } : undefined;
  const out = useMemo(() => {
    if (!s) return null;
    return beamCapacity(s, parseFloat(span) || 1, load, parseFloat(cb) || 1, parseFloat(df) || 5, parseFloat(defl) || 240, parseFloat(lb) || parseFloat(span) || 1);
  }, [s, span, lb, load, cb, df, defl]);
  const isU = load === "uniform";
  const unit = isU ? "lb total" : "lb";
  const app = parseFloat(applied);

  return (
    <div style={card}>
      <div style={grid(140)}>
        <div><span style={label}>Family</span><select value={fam} onChange={(e) => onFam(e.target.value)} style={field}>{fams.map((f) => <option key={f} value={f}>{FAM_LABEL[f]}</option>)}</select></div>
        <div style={{ gridColumn: "span 2" }}><span style={label}>Section</span><select value={secId} onChange={(e) => setSecId(e.target.value)} style={field}>{secs.map((x) => <option key={x.id} value={x.id}>{x.id} ({fmt(x.wt, 1)} lb/ft)</option>)}</select></div>
        <div><span style={label}>Fy (ksi)</span><input value={fy} placeholder={String(base?.Fy ?? "")} onChange={(e) => setFy(e.target.value)} style={field} /></div>
        <div><span style={label}>Span (ft)</span><Num v={span} set={setSpan} /></div>
        <div><span style={label}>Unbraced Lb (ft)</span><Num v={lb} set={setLb} /></div>
        <div><span style={label}>Load type</span><select value={load} onChange={(e) => setLoad(e.target.value as LoadType)} style={field}><option value="uniform">Uniform</option><option value="point">Midspan point</option></select></div>
        <div><span style={label}>Cb</span><Num v={cb} set={setCb} step="0.1" /></div>
        <div><span style={label}>Design factor</span><Num v={df} set={setDf} /></div>
        <div><span style={label}>Deflection L/</span><Num v={defl} set={setDefl} /></div>
        <div><span style={label}>Applied load ({unit})</span><Num v={applied} set={setApplied} /></div>
      </div>

      {out && s && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{s.id} · {s.grade} · Fy={s.Fy} ksi</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2 }}>{span} ft span · {isU ? "uniform" : "midspan point"} · Zx={fmt(s.Zx, 1)}, Sx={fmt(s.Sx, 1)} in³, Ix={fmt(s.Ix, 0)} in⁴</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0" }}>
            <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>ASD allowable</div><div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(out.asd.gov)} <span style={{ fontSize: 12, color: "#9aa0ab" }}>{unit}</span></div><div style={{ fontSize: 11, color: "#9aa0ab" }}>gov: {out.asd.govBy}{isU ? ` (${fmt(out.asd.gov / (parseFloat(span) || 1))} lb/ft)` : ""}</div></div>
            <div style={kpi(true)}><div style={{ fontSize: 11, color: "#6b7079" }}>Rigging WLL · DF {df}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(out.rig.gov)} <span style={{ fontSize: 12, color: "#9aa0ab" }}>{unit}</span></div><div style={{ fontSize: 11, color: "#9aa0ab" }}>gov: {out.rig.govBy}</div></div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Limit state</th><th style={{ ...th, textAlign: "right" }}>AISC ASD</th><th style={{ ...th, textAlign: "right" }}>Rigging (DF {df})</th></tr></thead>
            <tbody>
              <tr><td style={td}>Bending</td><td style={{ ...td, textAlign: "right" }}>{fmt(out.asd.bend)}</td><td style={{ ...td, textAlign: "right" }}>{fmt(out.rig.bend)}</td></tr>
              <tr><td style={td}>Shear</td><td style={{ ...td, textAlign: "right" }}>{fmt(out.asd.shear)}</td><td style={{ ...td, textAlign: "right" }}>{fmt(out.rig.shear)}</td></tr>
              <tr><td style={td}>Deflection (L/{defl})</td><td style={{ ...td, textAlign: "right" }}>{fmt(out.asd.defl)}</td><td style={{ ...td, textAlign: "right", color: "#9aa0ab" }}>n/a</td></tr>
              <tr><td style={{ ...td, fontWeight: 700 }}>Governing</td><td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmt(out.asd.gov)}</td><td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmt(out.rig.gov)}</td></tr>
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: "#6b7079", marginTop: 8, background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 8, padding: "9px 11px" }}>
            {out.fx.Lp != null ? <>LTB: Lp={fmt(out.fx.Lp / 12, 2)} ft, Lr={fmt(out.fx.Lr! / 12, 2)} ft, Lb={fmt(parseFloat(lb), 2)} ft → <b>{out.fx.mode}</b>. Mn={fmt(out.fx.Mn / 12, 1)} kip-ft (Mp={fmt(out.Mp / 12, 1)}).</> : <>{out.fx.mode}. Mn=Mp={fmt(out.Mp / 12, 1)} kip-ft.</>}
          </div>
          {app > 0 && (() => {
            const utilA = app / out.asd.gov, utilR = app / out.rig.gov, dfl = out.deflAt(app);
            const spanIn = (parseFloat(span) || 1) * 12;
            return (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
                <thead><tr><th style={th}>Check: {fmt(app)} {unit}</th><th style={{ ...th, textAlign: "right" }}>Allowable</th><th style={{ ...th, textAlign: "right" }}>Util</th><th style={{ ...th, textAlign: "right" }}>Result</th></tr></thead>
                <tbody>
                  <tr><td style={td}>AISC ASD</td><td style={{ ...td, textAlign: "right" }}>{fmt(out.asd.gov)} lb</td><td style={{ ...td, textAlign: "right" }}>{fmt(utilA * 100)}%</td><td style={{ ...td, textAlign: "right" }}><span style={tag(utilA <= 1)}>{utilA <= 1 ? "PASS" : "FAIL"}</span></td></tr>
                  <tr><td style={td}>Rigging WLL (DF {df})</td><td style={{ ...td, textAlign: "right" }}>{fmt(out.rig.gov)} lb</td><td style={{ ...td, textAlign: "right" }}>{fmt(utilR * 100)}%</td><td style={{ ...td, textAlign: "right" }}><span style={tag(utilR <= 1)}>{utilR <= 1 ? "PASS" : "FAIL"}</span></td></tr>
                  <tr><td style={td}>Deflection at load</td><td style={{ ...td, textAlign: "right" }}>L/{fmt(spanIn / dfl)}</td><td style={{ ...td, textAlign: "right" }}>{fmt(dfl, 3)} in</td><td style={{ ...td, textAlign: "right" }}><span style={tag(spanIn / dfl >= (parseFloat(defl) || 240))}>{spanIn / dfl >= (parseFloat(defl) || 240) ? "within" : "exceeds"} L/{defl}</span></td></tr>
                </tbody>
              </table>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/* ======================= Member Sizing ======================= */
function Sizing() {
  const fams = familiesPresent();
  const [span, setSpan] = useState("20");
  const [lb, setLb] = useState("20");
  const [load, setLoad] = useState<LoadType>("uniform");
  const [applied, setApplied] = useState("2000");
  const [defl, setDefl] = useState("240");
  const [cb, setCb] = useState("1");
  const [df, setDf] = useState("5");
  const [basis, setBasis] = useState<"asd" | "rig" | "both">("both");
  const [checked, setChecked] = useState<Record<string, boolean>>(Object.fromEntries(fams.map((f) => [f, f === "W" || f === "HSS" || f === "PIPE"])));

  const winners = useMemo(() => {
    const app = parseFloat(applied);
    const activeFams = fams.filter((f) => checked[f]);
    const w: { s: SteelShape; gA: number; gR: number; govBy: string }[] = [];
    activeFams.forEach((f) => {
      const cands = SHAPES.filter((s) => s.type === f).slice().sort((a, b) => a.wt - b.wt);
      for (const s of cands) {
        const c = beamCapacity(s, parseFloat(span) || 1, load, parseFloat(cb) || 1, parseFloat(df) || 5, parseFloat(defl) || 240, parseFloat(lb) || parseFloat(span) || 1);
        const okA = app <= c.asd.gov, okR = app <= c.rig.gov;
        const pass = basis === "asd" ? okA : basis === "rig" ? okR : okA && okR;
        if (pass) { w.push({ s, gA: c.asd.gov, gR: c.rig.gov, govBy: c.asd.govBy }); break; }
      }
    });
    return w.sort((a, b) => a.s.wt - b.s.wt);
  }, [span, lb, load, applied, defl, cb, df, basis, checked]);

  const app = parseFloat(applied);

  return (
    <div style={card}>
      <div style={grid(130)}>
        <div><span style={label}>Applied load (lb)</span><Num v={applied} set={setApplied} /></div>
        <div><span style={label}>Span (ft)</span><Num v={span} set={setSpan} /></div>
        <div><span style={label}>Unbraced Lb (ft)</span><Num v={lb} set={setLb} /></div>
        <div><span style={label}>Load type</span><select value={load} onChange={(e) => setLoad(e.target.value as LoadType)} style={field}><option value="uniform">Uniform</option><option value="point">Midspan point</option></select></div>
        <div><span style={label}>Deflection L/</span><Num v={defl} set={setDefl} /></div>
        <div><span style={label}>Cb</span><Num v={cb} set={setCb} step="0.1" /></div>
        <div><span style={label}>Design factor</span><Num v={df} set={setDf} /></div>
        <div><span style={label}>Basis</span><select value={basis} onChange={(e) => setBasis(e.target.value as "asd" | "rig" | "both")} style={field}><option value="both">ASD &amp; rigging</option><option value="asd">ASD only</option><option value="rig">Rigging only</option></select></div>
      </div>
      <div style={{ marginTop: 12 }}>
        <span style={label}>Families to search</span>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {fams.map((f) => (
            <label key={f} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={!!checked[f]} onChange={(e) => setChecked((c) => ({ ...c, [f]: e.target.checked }))} /> {f}
            </label>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        {!winners.length ? (
          <div style={{ fontSize: 13, color: "#6b7079" }}>No section in the selected families carries {fmt(app)} lb at {span} ft. Try a deeper family, relax the deflection limit, or lower the design factor.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}><div style={kpi(true)}><div style={{ fontSize: 11, color: "#6b7079" }}>Recommended (lightest)</div><div style={{ fontSize: 20, fontWeight: 700 }}>{winners[0].s.id}</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>{fmt(winners[0].s.wt, 1)} lb/ft · {winners[0].s.grade}</div></div></div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Section</th><th style={{ ...th, textAlign: "right" }}>lb/ft</th><th style={{ ...th, textAlign: "right" }}>ASD allow</th><th style={{ ...th, textAlign: "right" }}>Rig WLL</th><th style={th}>Gov</th><th style={{ ...th, textAlign: "right" }}>Util</th></tr></thead>
              <tbody>
                {winners.map((w) => {
                  const util = Math.max(app / w.gA, basis === "asd" ? 0 : app / w.gR);
                  return <tr key={w.s.id}><td style={{ ...td, fontWeight: 600 }}>{w.s.id}</td><td style={{ ...td, textAlign: "right" }}>{fmt(w.s.wt, 1)}</td><td style={{ ...td, textAlign: "right" }}>{fmt(w.gA)}</td><td style={{ ...td, textAlign: "right" }}>{fmt(w.gR)}</td><td style={td}>{w.govBy}</td><td style={{ ...td, textAlign: "right" }}>{fmt(util * 100)}%</td></tr>;
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

/* ======================= Rigging Loads ======================= */
function Rigging() {
  // batten reactions
  const [len, setLen] = useState("40");
  const [self, setSelf] = useState("2.72");
  const [x1, setX1] = useState("8");
  const [x2, setX2] = useState("32");
  const [pts, setPts] = useState<BattenPoint[]>([{ x: 20, w: 300 }]);
  const bt = useMemo(() => battenReactions(parseFloat(len) || 1, parseFloat(self) || 0, parseFloat(x1) || 0, parseFloat(x2) || 0, pts), [len, self, x1, x2, pts]);

  // two-leg bridle
  const [W, setW] = useState("1000");
  const [aRun, setARun] = useState("6");
  const [aRise, setARise] = useState("8");
  const [bRun, setBRun] = useState("6");
  const [bRise, setBRise] = useState("8");
  const [wll, setWll] = useState("");
  const br = useMemo(() => twoLegBridle(parseFloat(W) || 0, parseFloat(aRun) || 0, parseFloat(aRise) || 0, parseFloat(bRun) || 0, parseFloat(bRise) || 0), [W, aRun, aRise, bRun, bRise]);
  const wllN = parseFloat(wll);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Batten / beam reactions</div>
        <div style={grid(110)}>
          <div><span style={label}>Length (ft)</span><Num v={len} set={setLen} /></div>
          <div><span style={label}>Self (lb/ft)</span><Num v={self} set={setSelf} step="0.01" /></div>
          <div><span style={label}>Pickup 1 (ft)</span><Num v={x1} set={setX1} /></div>
          <div><span style={label}>Pickup 2 (ft)</span><Num v={x2} set={setX2} /></div>
        </div>
        <div style={{ margin: "12px 0 6px", fontSize: 12, fontWeight: 600, color: "#5b616e" }}>Point loads (fixtures, motors, etc.)</div>
        {pts.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <input type="number" value={p.x} onChange={(e) => setPts((a) => a.map((q, j) => (j === i ? { ...q, x: parseFloat(e.target.value) || 0 } : q)))} style={{ ...field, flex: 1 }} placeholder="ft" />
            <input type="number" value={p.w} onChange={(e) => setPts((a) => a.map((q, j) => (j === i ? { ...q, w: parseFloat(e.target.value) || 0 } : q)))} style={{ ...field, flex: 1 }} placeholder="lb" />
            <button onClick={() => setPts((a) => a.filter((_, j) => j !== i))} style={{ ...field, width: 34, cursor: "pointer", padding: 0 }}>✕</button>
          </div>
        ))}
        <button onClick={() => setPts((a) => [...a, { x: 20, w: 0 }])} style={{ ...field, cursor: "pointer", fontWeight: 600, color: "var(--accent)", width: "auto", padding: "7px 12px" }}>+ add point load</button>
        {bt ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>Total load</div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(bt.Wtot)} lb</div></div>
              <div style={kpi(true)}><div style={{ fontSize: 11, color: "#6b7079" }}>Pickup 1 ({x1} ft)</div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(bt.R1)} lb</div></div>
              <div style={kpi(true)}><div style={{ fontSize: 11, color: "#6b7079" }}>Pickup 2 ({x2} ft)</div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(bt.R2)} lb</div></div>
            </div>
            <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 10 }}>Max lift-line: <b>{fmt(bt.maxLine)} lb</b> · CG {fmt(bt.cg, 2)} ft · peak moment {fmt(bt.maxM)} lb·ft ({fmt(Math.abs(bt.maxM) * 12 / 1000, 1)} kip·in) at {fmt(bt.maxMx, 1)} ft. Feed the peak moment into a capacity check to size the batten.</div>
          </div>
        ) : <div style={{ marginTop: 12, ...tag(false) }}>Pickup 2 must be right of pickup 1.</div>}
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Two-leg bridle</div>
        <div style={grid(110)}>
          <div><span style={label}>Load W (lb)</span><Num v={W} set={setW} /></div>
          <div><span style={label}>Leg A run (ft)</span><Num v={aRun} set={setARun} /></div>
          <div><span style={label}>Leg A rise (ft)</span><Num v={aRise} set={setARise} /></div>
          <div><span style={label}>Leg B run (ft)</span><Num v={bRun} set={setBRun} /></div>
          <div><span style={label}>Leg B rise (ft)</span><Num v={bRise} set={setBRise} /></div>
          <div><span style={label}>Hardware WLL (lb)</span><Num v={wll} set={setWll} /></div>
        </div>
        {br ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={kpi(true)}><div style={{ fontSize: 11, color: "#6b7079" }}>Leg A tension</div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(br.T_A)} lb</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>{fmt(br.degA)}° · {fmt(br.lenA, 1)} ft</div></div>
              <div style={kpi(true)}><div style={{ fontSize: 11, color: "#6b7079" }}>Leg B tension</div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(br.T_B)} lb</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>{fmt(br.degB)}° · {fmt(br.lenB, 1)} ft</div></div>
            </div>
            <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 10 }}>
              Horizontal thrust: {fmt(br.hThrustA)} lb (A) · {fmt(br.hThrustB)} lb (B).
              {wllN > 0 && <> Leg A {fmt(br.T_A / wllN * 100)}% <span style={tag(br.T_A <= wllN)}>{br.T_A <= wllN ? "OK" : "OVER"}</span>, Leg B {fmt(br.T_B / wllN * 100)}% <span style={tag(br.T_B <= wllN)}>{br.T_B <= wllN ? "OK" : "OVER"}</span>.</>}
              {" "}Keep bridle legs ≥ 45° from horizontal where possible — flatter legs sharply raise tension.
            </div>
          </div>
        ) : <div style={{ marginTop: 12, ...tag(false) }}>Each leg needs a positive vertical rise.</div>}
      </div>
    </div>
  );
}

/* ======================= Section Database + Takeoff ======================= */
function Database() {
  const fams = familiesPresent();
  const [q, setQ] = useState("");
  const [fam, setFam] = useState("all");
  const [takeoff, setTakeoff] = useState<{ id: string; len: number; qty: number }[]>([]);

  const rows = useMemo(() => {
    const qq = q.trim().toUpperCase();
    return SHAPES.filter((s) => (fam === "all" || s.type === fam) && (!qq || s.id.toUpperCase().includes(qq))).slice(0, 200);
  }, [q, fam]);

  const totWt = takeoff.reduce((a, t) => { const s = shapeById(t.id); return a + (s ? s.wt * t.len * t.qty : 0); }, 0);
  const totLen = takeoff.reduce((a, t) => a + t.len * t.qty, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Section property database</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search e.g. W12X26" style={{ ...field, flex: 2 }} />
          <select value={fam} onChange={(e) => setFam(e.target.value)} style={{ ...field, flex: 1 }}><option value="all">All families</option>{fams.map((f) => <option key={f} value={f}>{f}</option>)}</select>
        </div>
        <div style={{ maxHeight: 460, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
            <thead><tr><th style={th}>Section</th><th style={{ ...th, textAlign: "right" }}>lb/ft</th><th style={{ ...th, textAlign: "right" }}>d</th><th style={{ ...th, textAlign: "right" }}>Sx</th><th style={{ ...th, textAlign: "right" }}>Ix</th><th style={th}></th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{s.id}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt(s.wt, 1)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt(s.d, 1)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt(s.Sx, 1)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt(s.Ix, 0)}</td>
                  <td style={{ ...td, textAlign: "right" }}><button onClick={() => setTakeoff((t) => [...t, { id: s.id, len: 20, qty: 1 }])} style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>+ add</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Steel takeoff / weight</div>
        {!takeoff.length && <div style={{ fontSize: 13, color: "#9aa0ab" }}>Add members from the database to total the steel weight of a design.</div>}
        {takeoff.map((t, i) => {
          const s = shapeById(t.id);
          return (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{t.id}</span>
              <input type="number" value={t.len} onChange={(e) => setTakeoff((a) => a.map((q2, j) => (j === i ? { ...q2, len: parseFloat(e.target.value) || 0 } : q2)))} style={{ ...field, width: 60, padding: "6px 8px" }} title="length ft" />
              <input type="number" value={t.qty} onChange={(e) => setTakeoff((a) => a.map((q2, j) => (j === i ? { ...q2, qty: parseFloat(e.target.value) || 0 } : q2)))} style={{ ...field, width: 48, padding: "6px 8px" }} title="qty" />
              <span style={{ fontSize: 12, width: 62, textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(s ? s.wt * t.len * t.qty : 0)}</span>
              <button onClick={() => setTakeoff((a) => a.filter((_, j) => j !== i))} style={{ ...field, width: 30, cursor: "pointer", padding: 0 }}>✕</button>
            </div>
          );
        })}
        {takeoff.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <div style={kpi(true)}><div style={{ fontSize: 11, color: "#6b7079" }}>Total weight</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totWt)} lb</div></div>
            <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>Total length</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totLen)} ft</div></div>
          </div>
        )}
      </div>
    </div>
  );
}
