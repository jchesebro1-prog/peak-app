"use client";

// Merged Lineset Builder + Weights (PUNCHLIST #6, D78). The Builder's
// generated schedule supplies the ROWS; weight data are per-row fields hung
// off a STABLE LINE KEY (`type#ordinal`, e.g. "Electric#2"), so regenerating
// the schedule (P1) reattaches hand-entered loads by what a line IS, not
// which slot it landed on. Three field classes render distinctly (generated /
// hand-entered / calculated); unspecified lines are excluded from totals and
// flagged rather than silently counted as 0 lb (P2).
import { Fragment, useMemo, useState } from "react";
import {
  generateLineset,
  DEFAULT_LINESET_INPUTS,
  type LinesetInputs,
  type LinesetSlot,
} from "@/lib/design/lineset";
import {
  computeSetWeight,
  DEFAULT_WEIGHTS,
  FABLIB,
  CHAINS,
  TRACKS,
  PRODIGY_HOISTS,
  BATTENS,
  fmt,
  type WeightDefaults,
  type WeightLine,
  type LinesetMode,
} from "@/lib/design/steel";
import {
  DEFAULT_GEAR,
  drapeRule,
  electricCounts,
  electricGearLb,
  shellGearLb,
  ruleToWeightLine,
  mergeLineFabric,
  type GoodsTier,
  type GearDefaults,
  type GoodsFabric,
} from "@/lib/design/goods";
import { SaveBar, type SavedRef } from "../save-bar";
import { downloadCsv } from "../export";

/* ---- saved-design data model (P3) ---------------------------------------- */

/** Hand-entered load fields for one generated line (everything optional —
 *  presence of the record is what marks the line "specified"). */
export type LineLoad = Partial<Omit<WeightLine, "name">> & {
  nameOverride?: string;
};

/** v3 combined save format. Adds the PRO dimensions (carried inside `inputs`),
 *  the goods tier and the gear defaults. Legacy shapes (v2, bare LinesetInputs
 *  from the old Builder, {defaults,lines} from the old Weights tool) are
 *  adapted on load by the route page — see resolveInitial() in page.tsx. */
export type CombinedLinesetData = {
  v: 3;
  inputs: LinesetInputs;
  defaults: WeightDefaults;
  loads: Record<string, LineLoad>;
  extras: (WeightLine & { xid: string })[];
  tier: GoodsTier;
  gear: GearDefaults;
};

export type CombinedInitial = {
  inputs?: LinesetInputs;
  defaults?: WeightDefaults;
  loads?: Record<string, LineLoad>;
  extras?: (WeightLine & { xid: string })[];
  tier?: GoodsTier;
  gear?: GearDefaults;
  /** set when the opened design was a legacy Weights record — saving creates
   *  a new combined design instead of overwriting the old one */
  legacyWeights?: boolean;
};

/* ---- styles --------------------------------------------------------------- */

const card: React.CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "16px 18px", boxShadow: "0 1px 2px rgba(0,0,0,.04)" };
const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4, display: "block" };
const field: React.CSSProperties = { width: "100%", border: "1px solid #dfe2e8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, boxSizing: "border-box", background: "#fff" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "#9aa0ab", padding: "6px 10px", borderBottom: "1px solid #eef0f3", position: "sticky", top: 0, background: "#fff", zIndex: 1 };
const td: React.CSSProperties = { fontSize: 13, padding: "6px 10px", borderBottom: "1px solid #f4f5f7", verticalAlign: "middle" };
const kpi = (accent?: boolean): React.CSSProperties => ({ flex: "1 1 150px", background: accent ? "color-mix(in srgb, var(--accent) 8%, #fff)" : "#f7f8fa", border: `1px solid ${accent ? "color-mix(in srgb, var(--accent) 30%, #fff)" : "#eef0f3"}`, borderRadius: 10, padding: "11px 13px" });

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

const MODE_LABEL: Record<LinesetMode, string> = { motor: "Motor", dead: "Dead-hung", cw: "Counterweight" };

function NumF({ v, set, w, style }: { v: number; set: (n: number) => void; w?: number; style?: React.CSSProperties }) {
  return <input type="number" value={v} onChange={(e) => set(parseFloat(e.target.value) || 0)} style={{ ...field, ...(w ? { width: w } : {}), ...style }} />;
}

/** Stable identity for a generated line: its type + ordinal within the type
 *  ("Electric#2" = the second electric, wherever it lands). Survives slot
 *  shifts when dimensions change (P1). */
function lineKeys(schedule: LinesetSlot[]): string[] {
  const seen: Record<string, number> = {};
  return schedule.map((s) => {
    const t = s.type || "Open";
    seen[t] = (seen[t] || 0) + 1;
    return `${t}#${seen[t]}`;
  });
}

let extraSeq = 0;

export function LinesetBuilder({
  initial,
  customers = [],
  saved = [],
  loaded = null,
  fabrics = [],
}: {
  initial?: CombinedInitial;
  customers?: { id: string; name: string }[];
  saved?: SavedRef[];
  loaded?: { id: string; name: string; customerId: string | null } | null;
  fabrics?: GoodsFabric[];
} = {}) {
  const [inp, setInp] = useState<LinesetInputs>(initial?.inputs || DEFAULT_LINESET_INPUTS);
  const [def, setDef] = useState<WeightDefaults>(initial?.defaults || DEFAULT_WEIGHTS);
  const [loads, setLoads] = useState<Record<string, LineLoad>>(initial?.loads || {});
  const [extras, setExtras] = useState<(WeightLine & { xid: string })[]>(initial?.extras || []);
  // No editor for these yet (a later task wires controls) — carried through so
  // opening and re-saving a design round-trips its tier/gear instead of
  // silently resetting them to the defaults below.
  const [tier, setTier] = useState<GoodsTier>(initial?.tier || "better");
  const [gear, setGear] = useState<GearDefaults>(initial?.gear || DEFAULT_GEAR);
  const [showGrid, setShowGrid] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const set = <K extends keyof LinesetInputs>(k: K, v: LinesetInputs[K]) => setInp((s) => ({ ...s, [k]: v }));
  const setD = <K extends keyof WeightDefaults>(k: K, v: WeightDefaults[K]) => setDef((s) => ({ ...s, [k]: v }));
  const patchLoad = (key: string, patch: LineLoad) =>
    setLoads((m) => ({ ...m, [key]: { ...(m[key] || {}), ...patch } }));
  const clearLoad = (key: string) =>
    setLoads((m) => {
      const n = { ...m };
      delete n[key];
      return n;
    });
  const patchExtra = (xid: string, patch: Partial<WeightLine>) =>
    setExtras((a) => a.map((x) => (x.xid === xid ? { ...x, ...patch } : x)));

  /** True when `field` was hand-typed for line `key` (present in loads[key]),
   *  as opposed to arriving from the drape rule / gear default (P6/P7). */
  const isOverride = (key: string, field: keyof WeightLine) =>
    loads[key] !== undefined && loads[key]![field as keyof LineLoad] !== undefined;

  const out = useMemo(() => generateLineset(inp), [inp]);
  const keys = useMemo(() => lineKeys(out.schedule), [out.schedule]);

  const dims = useMemo(
    () => ({
      proWidthFt: inp.proWidthFt,
      proHeightFt: inp.proHeightFt,
      stageWidthFt: inp.stageWidthFt,
      stageDepthFt: inp.stageDepthFt,
    }),
    [inp.proWidthFt, inp.proHeightFt, inp.stageWidthFt, inp.stageDepthFt]
  );

  /* merged rows: generated line + its rule + any hand-entered override.
     Ordering matters — the rule supplies defaults, `...load` spreads AFTER so
     anything Jeff typed wins. */
  const rows = useMemo(
    () =>
      out.schedule.map((s, i) => {
        const key = keys[i];
        const load = loads[key];
        const rule = drapeRule(s.type, dims, tier);
        const battenLen = load?.batten ?? def.battenlen;

        let base: Partial<WeightLine> = {};
        if (rule) {
          base = ruleToWeightLine(rule, fabrics);
        } else if (s.type === "Electric") {
          const kind = s.name === "CYC Electric" ? "cyc" : "regular";
          base = { gear: electricGearLb(electricCounts(dims, "medium", kind), battenLen, gear) };
        } else if (s.type === "Shell") {
          base = { gear: shellGearLb(dims, inp.shellIntervalFt, gear) };
        }

        const ruled = !!rule || s.type === "Electric" || s.type === "Shell";

        // F1 fix: `fab`/`fabResolved` need to travel together (computeSetWeight
        // prefers fabResolved over a fab name lookup — steel.ts), so their
        // merge is pulled out into mergeLineFabric() (goods.ts) rather than
        // left to a plain `{...base, ...load}` spread, which would let a
        // rule-derived line's catalog fabResolved silently outlive a fab
        // override. Shared with scripts/test-review-and-spec.ts so the
        // regression guard exercises this exact function, not a copy of it.
        const line: WeightLine = {
          name: load?.nameOverride || s.name,
          ...base,
          ...load,
          ...mergeLineFabric(base, load, rule, fabrics),
        };

        const specified = ruled || !!load;
        const c = specified ? computeSetWeight(line, def) : null;
        return { s, key, load, rule, ruled, specified, line, c };
      }),
    [out.schedule, keys, loads, def, dims, tier, gear, fabrics, inp.shellIntervalFt]
  );
  const extraRows = useMemo(
    () => extras.map((x) => ({ x, c: computeSetWeight(x, def) })),
    [extras, def]
  );

  const totals = useMemo(() => {
    let onBatten = 0, setTotal = 0, cw = 0, beamMax = 0, specified = 0;
    rows.forEach((r) => {
      if (!r.c) return;
      specified += 1;
      onBatten += r.c.onBatten;
      setTotal += r.c.setTotal;
      cw += r.c.cwLoad;
      beamMax = Math.max(beamMax, r.c.beamLoad);
    });
    extraRows.forEach(({ c }) => {
      onBatten += c.onBatten;
      setTotal += c.setTotal;
      cw += c.cwLoad;
      beamMax = Math.max(beamMax, c.beamLoad);
    });
    return { onBatten, setTotal, cw, beamMax, specified, generated: rows.length };
  }, [rows, extraRows]);

  /** loads whose key no longer matches the current schedule (P1's "visible
   *  answer for orphaned data") — they reattach automatically if the layout
   *  produces that line again. */
  const orphanKeys = useMemo(() => {
    const live = new Set(keys);
    return Object.keys(loads).filter((k) => !live.has(k));
  }, [keys, loads]);

  const unspecified = totals.generated - totals.specified;

  function exportCsv() {
    const header = ["#", "Slot", "Downstage", "Type", "Name", "Fabric", "W(ft)", "H(ft)", "Full%", "Qty", "Gear(lb)", "Mode", "Hoist", "Weight on batten(lb)", "Check", "Source"];
    const csvRows: (string | number)[][] = rows.map((r, i) => {
      const mode = r.line.mode || def.mode;
      const check = !r.c ? "NOT SPECIFIED" : mode === "cw" ? `${r.c.combo.big}x25+${r.c.combo.small}x10 brick` : r.c.over ? "OVER LIMIT" : "OK";
      const source = r.load ? "overridden" : r.ruled ? "rule" : "manual";
      return [
        i + 1, r.s.slot, r.s.dsPositionLabel, r.s.type, r.line.name,
        r.line.fab || "", r.line.w ?? "", r.line.h ?? "", r.line.full ?? def.full, r.line.qty ?? 1, r.line.gear ?? "",
        r.c ? MODE_LABEL[mode] : "", r.c && mode === "motor" ? r.line.hoist || def.hoist : "",
        r.c ? Math.round(r.c.onBatten) : "", check, source,
      ];
    });
    extraRows.forEach(({ x, c }, i) => {
      const mode = x.mode || def.mode;
      csvRows.push([
        rows.length + i + 1, "", "custom", "Custom", x.name, x.fab || "", x.w ?? "", x.h ?? "", x.full ?? def.full, x.qty ?? 1, x.gear ?? "",
        MODE_LABEL[mode], mode === "motor" ? x.hoist || def.hoist : "", Math.round(c.onBatten),
        mode === "cw" ? `${c.combo.big}x25+${c.combo.small}x10 brick` : c.over ? "OVER LIMIT" : "OK",
        "overridden",
      ]);
    });
    csvRows.push(["", "", "", "", "TOTAL", "", "", "", "", "", "", "", "", Math.round(totals.onBatten), unspecified ? `${unspecified} lines not specified — excluded` : `peak/beam ${Math.round(totals.beamMax)} lb`, ""]);
    downloadCsv(`lineset-${inp.stageWidthFt}x${inp.stageDepthFt}`, header, csvRows);
  }

  const getData = (): CombinedLinesetData => ({ v: 3, inputs: inp, defaults: def, loads, extras, tier, gear });

  /* ---- the per-line load editor (expands under the selected row, P5) ----
   *  A fourth field class lives here alongside generated / hand-entered /
   *  calculated (see file header): rule-derived. `lineKey` (schedule rows
   *  only — extras have no rule) drives isOverride() so a field the rule
   *  filled in renders muted until Jeff actually types over it (P7). */
  function LoadEditor({ value, onChange, onClear, isExtra, onRemove, lineKey }: {
    value: LineLoad & { name?: string };
    onChange: (patch: LineLoad & Partial<WeightLine>) => void;
    onClear?: () => void;
    isExtra?: boolean;
    onRemove?: () => void;
    lineKey?: string;
  }) {
    const mode = value.mode || def.mode;
    const genStyle = (f: keyof WeightLine): React.CSSProperties | undefined =>
      lineKey && !isOverride(lineKey, f) ? { color: "#9aa0ab", background: "#fafbfc" } : undefined;
    const genLabel = (f: keyof WeightLine): React.CSSProperties =>
      lineKey && !isOverride(lineKey, f) ? { ...label, color: "#9aa0ab" } : label;
    // Rule-derived drape lines carry a CATALOG fabric (their `fab` is a
    // catalog `desc`, e.g. "21 oz Marvel Velour"), which never matches a
    // FABLIB name — listing FABLIB here made the select fall back to
    // "— none —" even though the line weighs correctly via fabResolved (F2).
    // List the catalog instead so the real fabric shows selected, and an
    // override lands as a `desc` the rows memo above can re-resolve (F1).
    // Extras and non-rule lines (Electric/Shell/General Purpose) have no
    // catalog rule behind them and keep picking from FABLIB, unchanged.
    const catalogRule = lineKey ? rows.find((r) => r.key === lineKey)?.rule : undefined;
    return (
      <div style={{ background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 10, padding: "12px 14px", margin: "2px 0 6px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
          {isExtra && (
            <div style={{ gridColumn: "1 / -1" }}><span style={label}>Line name</span>
              <input value={value.name || ""} onChange={(e) => onChange({ name: e.target.value } as Partial<WeightLine>)} style={field} /></div>
          )}
          <div style={{ gridColumn: "span 2" }}><span style={genLabel("fab")}>Fabric / goods</span>
            <select value={value.fab || "— none —"} onChange={(e) => onChange({ fab: e.target.value })} style={{ ...field, ...genStyle("fab") }}>
              <option>— none —</option>
              {catalogRule
                ? fabrics.map((f) => <option key={f.sku} value={f.desc}>{f.desc}</option>)
                : FABLIB.map((f) => <option key={f.name}>{f.name}</option>)}
            </select></div>
          <div><span style={genLabel("w")}>Width (ft)</span><NumF v={value.w ?? 0} set={(n) => onChange({ w: n })} style={genStyle("w")} /></div>
          <div><span style={genLabel("h")}>Height (ft)</span><NumF v={value.h ?? 0} set={(n) => onChange({ h: n })} style={genStyle("h")} /></div>
          <div><span style={genLabel("full")}>Fullness %</span><NumF v={value.full ?? def.full} set={(n) => onChange({ full: n })} style={genStyle("full")} /></div>
          <div><span style={genLabel("qty")}>Qty</span><NumF v={value.qty ?? 1} set={(n) => onChange({ qty: n })} style={genStyle("qty")} /></div>
          <div><span style={genLabel("gear")}>Gear (lb)</span><NumF v={value.gear ?? 0} set={(n) => onChange({ gear: n })} style={genStyle("gear")} /></div>
          <div><span style={genLabel("chain")}>Chain</span>
            <select value={value.chain || "None"} onChange={(e) => onChange({ chain: e.target.value })} style={{ ...field, ...genStyle("chain") }}>
              {CHAINS.map((c) => <option key={c.name}>{c.name}</option>)}
            </select></div>
          <div><span style={genLabel("track")}>Track</span>
            <select value={value.track || "None"} onChange={(e) => onChange({ track: e.target.value })} style={{ ...field, ...genStyle("track") }}>
              {TRACKS.map((t) => <option key={t.name}>{t.name}</option>)}
            </select></div>
          <div><span style={genLabel("mode")}>Mode</span>
            <select value={mode} onChange={(e) => onChange({ mode: e.target.value as LinesetMode })} style={{ ...field, ...genStyle("mode") }}>
              <option value="motor">Motor</option><option value="dead">Dead-hung</option><option value="cw">Counterweight</option>
            </select></div>
          {mode === "motor" && (
            <div><span style={genLabel("hoist")}>Hoist</span>
              <select value={value.hoist || def.hoist} onChange={(e) => onChange({ hoist: e.target.value })} style={{ ...field, ...genStyle("hoist") }}>
                {PRODIGY_HOISTS.map((h) => <option key={h.id} value={h.id}>{h.id}</option>)}
              </select></div>
          )}
        </div>
        {lineKey && loads[lineKey] && rows.find((r) => r.key === lineKey)?.rule && (
          <button
            type="button"
            onClick={() => clearLoad(lineKey)}
            style={{
              marginTop: 8, fontSize: 11.5, fontWeight: 600, color: "#5b616e",
              background: "#fff", border: "1px solid #d5d8de", borderRadius: 5,
              padding: "4px 9px", cursor: "pointer",
            }}
          >
            ↺ Reset to rule
          </button>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {onClear && (
            <button onClick={onClear} style={{ ...field, width: "auto", cursor: "pointer", fontSize: 12, color: "#b4543a", padding: "5px 10px" }}>
              Clear entry (back to not-specified)
            </button>
          )}
          {onRemove && (
            <button onClick={onRemove} style={{ ...field, width: "auto", cursor: "pointer", fontSize: 12, color: "#b4543a", padding: "5px 10px" }}>
              Remove custom line
            </button>
          )}
          <button onClick={() => setOpenKey(null)} style={{ ...field, width: "auto", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#5b616e", padding: "5px 10px", marginLeft: "auto" }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const weightCell = (specified: boolean, c: ReturnType<typeof computeSetWeight> | null) =>
    specified && c ? (
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmt(c.onBatten)} lb</span>
    ) : (
      <span style={{ color: "#c4c9d2" }}>—</span>
    );

  const checkCell = (specified: boolean, c: ReturnType<typeof computeSetWeight> | null, mode: LinesetMode) => {
    if (!specified || !c)
      return <span title="Weights not entered yet — excluded from totals" style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "#d9a62a" }} />;
    if (mode === "cw")
      return <span title={`${c.combo.big}×25 + ${c.combo.small}×10 lb`} style={{ fontSize: 11.5, color: "#5b616e" }}>{c.combo.big}·{c.combo.small} brick</span>;
    return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: c.over ? "#b4543a" : "#1f7a52" }} title={c.over ? "Over a limit" : "OK"} />;
  };

  return (
    <div>
      <SaveBar kind="lineset" getData={getData} customers={customers} saved={saved} loaded={loaded} loadBase="/design/lineset?design=" />
      {initial?.legacyWeights && (
        <div style={{ background: "#fbf3dd", border: "1px solid #eadfc0", borderRadius: 10, padding: "9px 13px", fontSize: 12.5, color: "#7a6420", marginBottom: 14 }}>
          Opened from the old Lineset Weights tool — its rows came in as custom lines below.
          Saving creates a combined design; the old record stays until you delete it.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        {/* ---- input rail ---- */}
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Venue dimensions</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><span style={label}>Width (ft)</span><NumF v={inp.stageWidthFt} set={(n) => set("stageWidthFt", n)} /></div>
            <div><span style={label}>Width (in)</span><NumF v={inp.stageWidthIn} set={(n) => set("stageWidthIn", n)} /></div>
            <div><span style={label}>Depth (ft)</span><NumF v={inp.stageDepthFt} set={(n) => set("stageDepthFt", n)} /></div>
            <div><span style={label}>Depth (in)</span><NumF v={inp.stageDepthIn} set={(n) => set("stageDepthIn", n)} /></div>
            <div><span style={label}>PRO width (ft)</span><NumF v={inp.proWidthFt} set={(n) => set("proWidthFt", n)} /></div>
            <div><span style={label}>PRO height (ft)</span><NumF v={inp.proHeightFt} set={(n) => set("proHeightFt", n)} /></div>
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

          {/* single settings drawer (P4): layout rules + weight defaults */}
          <button onClick={() => setSettingsOpen((a) => !a)} style={{ marginTop: 14, background: "none", border: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
            {settingsOpen ? "▾ Hide " : "▸ Show "}rule &amp; weight settings
          </button>
          {settingsOpen && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", margin: "12px 0 6px" }}>Layout rules</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><span style={label}>Slot spacing (in)</span><NumF v={inp.slotSpacingIn} set={(n) => set("slotSpacingIn", n)} /></div>
                <div><span style={label}>Electric interval (ft)</span><NumF v={inp.electricIntervalFt} set={(n) => set("electricIntervalFt", n)} /></div>
                <div><span style={label}>Electric offset (in)</span><NumF v={inp.electricOffsetIn} set={(n) => set("electricOffsetIn", n)} /></div>
                <div><span style={label}>Shell interval (ft)</span><NumF v={inp.shellIntervalFt} set={(n) => set("shellIntervalFt", n)} /></div>
                <div><span style={label}>Shell start (ft)</span><NumF v={inp.shellStartFt} set={(n) => set("shellStartFt", n)} /></div>
                <div><span style={label}>Clearance (in)</span><NumF v={inp.clearanceIn} set={(n) => set("clearanceIn", n)} /></div>
                <div><span style={label}>CYC off back wall (ft)</span><NumF v={inp.cycOffsetFt} set={(n) => set("cycOffsetFt", n)} /></div>
                <div><span style={label}>Max elec from CYC (ft)</span><NumF v={inp.maxElecFromCycFt} set={(n) => set("maxElecFromCycFt", n)} /></div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", margin: "14px 0 6px" }}>Weight defaults</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><span style={label}>Lift lines</span><NumF v={def.lines} set={(n) => setD("lines", n || 1)} /></div>
                <div><span style={label}>Batten length (ft)</span><NumF v={def.battenlen} set={(n) => setD("battenlen", n)} /></div>
                <div style={{ gridColumn: "1 / -1" }}><span style={label}>Default batten</span>
                  <select value={def.pipe} onChange={(e) => setD("pipe", e.target.value)} style={field}>{BATTENS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div>
                <div><span style={label}>Default hoist</span>
                  <select value={def.hoist} onChange={(e) => setD("hoist", e.target.value)} style={field}>{PRODIGY_HOISTS.map((h) => <option key={h.id} value={h.id}>{h.id}</option>)}</select></div>
                <div><span style={label}>Default mode</span>
                  <select value={def.mode} onChange={(e) => setD("mode", e.target.value as LinesetMode)} style={field}>
                    <option value="motor">Motor</option><option value="dead">Dead-hung</option><option value="cw">Counterweight</option>
                  </select></div>
                <div><span style={label}>Fullness %</span><NumF v={def.full} set={(n) => setD("full", n)} /></div>
                <div><span style={label}>Cut allow (in)</span><NumF v={def.cut} set={(n) => setD("cut", n)} /></div>
                <div><span style={label}>Hardware lb/ft</span><NumF v={def.hwPerFt} set={(n) => setD("hwPerFt", n)} /></div>
                <div><span style={label}>Deflection L/</span><NumF v={def.defl} set={(n) => setD("defl", n || 1)} /></div>
                <div><span style={label}>Design factor</span><NumF v={def.df} set={(n) => setD("df", n || 1)} /></div>
                <div><span style={label}>Per-line WLL (lb)</span><NumF v={def.wll} set={(n) => setD("wll", n)} /></div>
                <div><span style={label}>Beam spacing max (ft)</span><NumF v={def.beamspace} set={(n) => setD("beamspace", n || 14)} /></div>
                <div><span style={label}>Cable mgmt</span>
                  <select value={def.cableMgmt ? "y" : "n"} onChange={(e) => setD("cableMgmt", e.target.value === "y")} style={field}>
                    <option value="n">No (8 lines)</option><option value="y">Yes (7 lines)</option>
                  </select></div>
              </div>
            </>
          )}
          <button onClick={() => setInp(DEFAULT_LINESET_INPUTS)} style={{ marginTop: 14, width: "100%", background: "#f6f7f9", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 600, color: "#5b616e", cursor: "pointer" }}>
            Reset layout to 50′ × 30′ defaults
          </button>
        </div>

        {/* ---- schedule + weights ---- */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>
              {showGrid ? "8-inch grid" : "Lineset schedule & weights"} · {showGrid ? out.slots.length : rows.length} {showGrid ? "slots" : "lines"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#5b616e" }}>
                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Show full grid
              </label>
              <button onClick={exportCsv} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 11px", cursor: "pointer" }}>⭳ CSV</button>
              <button onClick={() => { try { window.print(); } catch { /* no-op */ } }} className="pk-no-print" style={{ fontSize: 12.5, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 11px", cursor: "pointer" }}>⎙ Print</button>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "#6b7079", marginBottom: 10, background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 8, padding: "8px 11px" }}>
            {out.summary.activeSlotCount} active slots · CYC at slot {out.summary.targetCycSlot} · {out.summary.status}
            {unspecified > 0 && !showGrid && (
              <span style={{ color: "#9a7d1f", fontWeight: 600 }}>
                {" "}· {unspecified} line{unspecified === 1 ? "" : "s"} without weights — click a row to enter them
              </span>
            )}
            {orphanKeys.length > 0 && (
              <span style={{ color: "#9a7d1f" }}>
                {" "}· {orphanKeys.length} saved weight entr{orphanKeys.length === 1 ? "y" : "ies"} no longer match{orphanKeys.length === 1 ? "es" : ""} the layout
                (they reattach if the layout brings those lines back{" "}
                <button onClick={() => setLoads((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !orphanKeys.includes(k))))} style={{ background: "none", border: "none", color: "#b4543a", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                  clear them
                </button>)
              </span>
            )}
          </div>

          {showGrid ? (
            <div style={{ maxHeight: 560, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                <thead>
                  <tr><th style={th}>Slot</th><th style={th}>Downstage</th><th style={th}>Type</th><th style={th}>Name</th><th style={th}></th></tr>
                </thead>
                <tbody>
                  {out.slots.map((s) => (
                    <tr key={s.slot} style={!s.type ? { opacity: 0.45 } : undefined}>
                      <td style={{ ...td, fontFamily: "var(--font-mono)", color: "#9aa0ab" }}>{s.slot}</td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{s.dsPositionLabel || "—"}</td>
                      <td style={td}>{s.type ? <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, color: "#fff", background: TYPE_COLOR[s.type] || "#6b7079" }}>{s.type}</span> : <span style={{ color: "#c4c9d2", fontSize: 12 }}>open</span>}</td>
                      <td style={{ ...td, fontWeight: 500 }}>{s.name}</td>
                      <td style={td}>{s.warning && <span title={s.warning} style={{ color: "#b4543a", fontSize: 12 }}>⚠</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ maxHeight: 560, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={th}>#</th><th style={th}>Slot</th><th style={th}>Downstage</th><th style={th}>Type</th><th style={th}>Name</th>
                    <th style={{ ...th, textAlign: "right" }}>Weight</th><th style={th}>Check</th><th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <Fragment key={r.key}>
                      <tr onClick={() => setOpenKey(openKey === r.key ? null : r.key)} style={{ cursor: "pointer", background: openKey === r.key ? "color-mix(in srgb, var(--accent) 5%, #fff)" : undefined }}>
                        <td style={{ ...td, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}>{i + 1}</td>
                        <td style={{ ...td, fontFamily: "var(--font-mono)", color: "#9aa0ab" }}>{r.s.slot}</td>
                        <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{r.s.dsPositionLabel || "—"}</td>
                        <td style={td}><span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, color: "#fff", background: TYPE_COLOR[r.s.type] || "#6b7079" }}>{r.s.type}</span></td>
                        <td style={{ ...td, fontWeight: 500 }}>
                          {r.line.name}
                          {r.s.warning && <span title={r.s.warning} style={{ color: "#b4543a", fontSize: 12, marginLeft: 6 }}>⚠</span>}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>{weightCell(r.specified, r.c)}</td>
                        <td style={td}>{checkCell(r.specified, r.c, r.line.mode || def.mode)}</td>
                        <td style={{ ...td, color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>{openKey === r.key ? "▾" : "edit"}</td>
                      </tr>
                      {openKey === r.key && (
                        <tr>
                          <td colSpan={8} style={{ padding: "0 6px", borderBottom: "1px solid #f4f5f7" }}>
                            <LoadEditor
                              value={{ ...r.line }}
                              onChange={(patch) => patchLoad(r.key, patch)}
                              onClear={r.specified ? () => { clearLoad(r.key); setOpenKey(null); } : undefined}
                              lineKey={r.key}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {extraRows.map(({ x, c }, i) => (
                    <Fragment key={x.xid}>
                      <tr onClick={() => setOpenKey(openKey === x.xid ? null : x.xid)} style={{ cursor: "pointer", background: openKey === x.xid ? "color-mix(in srgb, var(--accent) 5%, #fff)" : undefined }}>
                        <td style={{ ...td, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}>{rows.length + i + 1}</td>
                        <td style={{ ...td, color: "#c4c9d2" }}>—</td>
                        <td style={{ ...td, color: "#c4c9d2", fontSize: 12 }}>custom</td>
                        <td style={td}><span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, color: "#5b616e", background: "#eef0f3" }}>Custom</span></td>
                        <td style={{ ...td, fontWeight: 500 }}>{x.name}</td>
                        <td style={{ ...td, textAlign: "right" }}>{weightCell(true, c)}</td>
                        <td style={td}>{checkCell(true, c, x.mode || def.mode)}</td>
                        <td style={{ ...td, color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>{openKey === x.xid ? "▾" : "edit"}</td>
                      </tr>
                      {openKey === x.xid && (
                        <tr>
                          <td colSpan={8} style={{ padding: "0 6px", borderBottom: "1px solid #f4f5f7" }}>
                            <LoadEditor
                              value={x}
                              isExtra
                              onChange={(patch) => patchExtra(x.xid, patch)}
                              onRemove={() => { setExtras((a) => a.filter((e) => e.xid !== x.xid)); setOpenKey(null); }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!showGrid && (
            <>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    extraSeq += 1;
                    const xid = "x" + extraSeq;
                    setExtras((a) => [...a, { xid, name: "Custom line", mode: def.mode }]);
                    setOpenKey(xid);
                  }}
                  style={{ ...field, width: "auto", cursor: "pointer", fontWeight: 600, color: "var(--accent)", padding: "7px 12px" }}
                >
                  + add custom line
                </button>
              </div>

              {/* show-wide rollup — refuses to look complete while lines are unspecified (P2) */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <div style={kpi(true)}>
                  <div style={{ fontSize: 11, color: "#6b7079" }}>Total on batten</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.onBatten)} lb</div>
                  <div style={{ fontSize: 11, color: unspecified ? "#9a7d1f" : "#9aa0ab", fontWeight: unspecified ? 600 : 400 }}>
                    {unspecified ? `${totals.specified} of ${totals.generated} lines specified — partial total` : `${totals.generated + extraRows.length} lines`}
                  </div>
                </div>
                <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>Peak load / support beam</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.beamMax)} lb</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>across {def.lines} beams</div></div>
                <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>With powerheads</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.setTotal)} lb</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>structure sees</div></div>
                {totals.cw > 0 && <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>Counterweight (CW lines)</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.cw)} lb</div></div>}
              </div>
            </>
          )}

          <p style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 12, lineHeight: 1.5 }}>
            Slots, positions, types and default names are generated by the layout rules — change the venue inputs and
            they regenerate; weight entries follow their line (1st Electric stays 1st Electric). Fabric, dimensions and
            rigging are hand-entered per line; weight, checks and brick combos are calculated. Goods = flat width
            (× fullness) × cut height × fabric weight + chain + hardware. Motor lines check hoist capacity and batten
            bending; CW lines pick a 25/10 lb brick combo. Reference only — verify with a licensed PE for any
            life-safety rigging.
          </p>
        </div>
      </div>
    </div>
  );
}
