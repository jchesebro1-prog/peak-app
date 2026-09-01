"use client";
/* eslint-disable react-hooks/static-components -- LoadEditor intentionally closes over this builder's live rules, fabrics, and save state. */

// Merged Lineset Builder + Weights (PUNCHLIST #6, D78). The Builder's
// generated schedule supplies the ROWS; weight data are per-row fields hung
// off a STABLE LINE KEY (`type#ordinal`, e.g. "Electric#2"), so regenerating
// the schedule (P1) reattaches hand-entered loads by what a line IS, not
// which slot it landed on. Three field classes render distinctly (generated /
// hand-entered / calculated); unspecified lines are excluded from totals and
// flagged rather than silently counted as 0 lb (P2).
import { useMemo, useState } from "react";
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
  battenById,
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
  fixtureLoadWeight,
  shellGearLb,
  ruleToWeightLine,
  mergeLineFabric,
  lineFabricIssue,
  FAB_NONE,
  type GoodsTier,
  type GearDefaults,
  type GoodsFabric,
  type ElectricFixtureLoad,
  type FabricIssue,
} from "@/lib/design/goods";
import { battenLenFt, BATTEN_OVERHANG_FT } from "@/lib/design/venue-dims";
import { SaveBar, type SavedRef } from "../save-bar";
import { downloadCsv } from "../export";
import { RIGGING_LIMITATION_NOTICE } from "@/lib/compliance-notices";
import { resolvedLinesetMode, type CategoryModeRules } from "@/lib/design/lineset-mode-rules";

/* ---- saved-design data model (P3) ---------------------------------------- */

/** Hand-entered load fields for one generated line (everything optional —
 *  presence of the record is what marks the line "specified"). */
export type LineLoad = Partial<Omit<WeightLine, "name">> & {
  nameOverride?: string;
  /** Explicit fixtures on an Electric. Defined (even []) replaces the
   * generated fixture allowance; cable/distribution weight still remains. */
  fixtureLoads?: ElectricFixtureLoad[];
};

/** Category defaults are deliberately separate from a hand override on one
 * line. A rule applies to every generated line of its type (including all
 * curtain types); an individual `LineLoad.mode` always wins. */
/** v3 combined save format. Adds the PRO dimensions (carried inside `inputs`),
 *  the goods tier and the gear defaults. Legacy shapes (v2, bare LinesetInputs
 *  from the old Builder, {defaults,lines} from the old Weights tool) are
 *  adapted on load by the route page — see resolveInitial() in page.tsx. */
export type CombinedLinesetData = {
  v: 4;
  inputs: LinesetInputs;
  defaults: WeightDefaults;
  loads: Record<string, LineLoad>;
  extras: (WeightLine & { xid: string })[];
  tier: GoodsTier;
  gear: GearDefaults;
  categoryModes: CategoryModeRules;
};

export type CombinedInitial = {
  inputs?: LinesetInputs;
  defaults?: WeightDefaults;
  loads?: Record<string, LineLoad>;
  extras?: (WeightLine & { xid: string })[];
  tier?: GoodsTier;
  gear?: GearDefaults;
  categoryModes?: CategoryModeRules;
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
const CURTAIN_TYPES = new Set(["Border", "Draw", "Legs", "CYC", "Rear", "Midstage Draw"]);

function NumF({ v, set, w, style }: { v: number; set: (n: number) => void; w?: number; style?: React.CSSProperties }) {
  return <input type="number" value={v} onChange={(e) => set(parseFloat(e.target.value) || 0)} style={{ ...field, ...(w ? { width: w } : {}), ...style }} />;
}

/** A number field that can be EMPTY, blank sends `undefined`, which is how a
 *  per-line value goes back to inheriting the schedule default. NumF can't do
 *  this: it coerces every keystroke to a number, so 0 would be the only "unset". */
function OptNumF({ v, placeholder, set, style }: { v: number | null | undefined; placeholder: number; set: (n: number | undefined) => void; style?: React.CSSProperties }) {
  return (
    <input
      type="number"
      value={v ?? ""}
      placeholder={String(placeholder)}
      onChange={(e) => set(e.target.value === "" ? undefined : parseFloat(e.target.value) || 0)}
      style={{ ...field, ...style }}
    />
  );
}

/** Select-layer only: deliberately NOT a TRACKS entry (see the Track field in
 *  LoadEditor). */
const TRACK_NONE = "None";

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
  // Editable via the "Soft goods" / "Gear weights" subsections of the settings
  // drawer below. Falling back to these defaults (rather than something else)
  // is what makes opening and re-saving a design round-trip its tier/gear
  // instead of silently resetting them.
  const [tier, setTier] = useState<GoodsTier>(initial?.tier || "better");
  const [gear, setGear] = useState<GearDefaults>(initial?.gear || DEFAULT_GEAR);
  const [categoryModes, setCategoryModes] = useState<CategoryModeRules>(initial?.categoryModes || {});
  const [showGrid, setShowGrid] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const set = <K extends keyof LinesetInputs>(k: K, v: LinesetInputs[K]) => setInp((s) => ({ ...s, [k]: v }));
  const setD = <K extends keyof WeightDefaults>(k: K, v: WeightDefaults[K]) => setDef((s) => ({ ...s, [k]: v }));
  const setFix = (k: keyof GearDefaults["fixtureLb"], n: number) =>
    setGear((g) => ({ ...g, fixtureLb: { ...g.fixtureLb, [k]: n } }));
  const setGearTop = <K extends "distributionLbPerFt" | "shellPsf">(k: K, n: number) =>
    setGear((g) => ({ ...g, [k]: n }));
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
  const setCategoryMode = (type: string, mode: LinesetMode | "") =>
    setCategoryModes((current) => {
      const next = { ...current };
      if (mode) next[type] = mode;
      else delete next[type];
      return next;
    });

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
      stageDepthFt: inp.stageDepthFt,
    }),
    [inp.proWidthFt, inp.proHeightFt, inp.stageDepthFt]
  );

  /**
   * The schedule defaults ACTUALLY used for weights. Identical to `def` except
   * that `battenlen` is derived from the proscenium width rather than typed in
   * (punch #50, Jeff: pro width plus 2 ft each side). Everything downstream
   * reads `wdef`, so there is no second definition of the pipe length here.
   * A per-line `batten` value still overrides it, in computeSetWeight().
   */
  const derivedBattenLen = battenLenFt(inp.proWidthFt);
  const wdef = useMemo<WeightDefaults>(
    () => ({ ...def, battenlen: derivedBattenLen }),
    [def, derivedBattenLen]
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
        const battenLen = load?.batten ?? wdef.battenlen;

        let base: Partial<WeightLine> = {};
        if (rule) {
          base = ruleToWeightLine(rule, fabrics);
        } else if (s.type === "Electric") {
          const kind = s.name === "CYC Electric" ? "cyc" : "regular";
          const distribution = electricGearLb({}, battenLen, gear);
          base = {
            gear: load?.fixtureLoads !== undefined
              ? distribution + fixtureLoadWeight(load.fixtureLoads)
              : electricGearLb(electricCounts(dims, "medium", kind), battenLen, gear),
          };
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
        const mode = resolvedLinesetMode(s.type, load?.mode, categoryModes, def.mode);

        const specified = ruled || !!load;
        const c = specified ? computeSetWeight(line, wdef) : null;
        // Why this line's fabric didn't resolve, if it didn't. computeSetWeight
        // hard-fails (goods/track/onBatten -> null, `fabricUnresolved: true`)
        // when it can't find a Fabric rather than reporting a plausible-looking
        // 0 (#64) — an unresolved row is otherwise indistinguishable from "not
        // filled in yet", so the cause gets surfaced on the row and in the
        // banner instead (#50).
        const issue = specified ? lineFabricIssue(line, rule, fabrics) : null;
        return { s, key, load, rule, ruled, specified, line, c, mode, issue };
      }),
    [out.schedule, keys, loads, wdef, dims, tier, gear, fabrics, inp.shellIntervalFt, categoryModes, def.mode]
  );
  const categoryTypes = useMemo(
    () => [...new Set(out.schedule.map((s) => s.type))],
    [out.schedule]
  );
  const extraRows = useMemo(
    () => extras.map((x) => ({ x, c: computeSetWeight(x, wdef), issue: lineFabricIssue(x, null, fabrics) })),
    [extras, wdef, fabrics]
  );

  /**
   * F1 hard-fail (punch #64): a resolvable-but-summed total was the bug —
   * excluding just the unresolved LINE and quietly summing the rest is the
   * SAME bug in miniature (still a plausible-looking low number). So the
   * moment any specified line comes back `fabricUnresolved`, every total
   * field goes to `null` — `fmt()` renders that as "—" — and the offending
   * line names ride along so the KPI can say why instead of just going blank.
   */
  const totals = useMemo(() => {
    let onBatten = 0, setTotal = 0, cw = 0, beamMax = 0, specified = 0;
    const unresolvedLines: string[] = [];
    rows.forEach((r) => {
      if (!r.c) return;
      specified += 1;
      if (r.c.fabricUnresolved) {
        unresolvedLines.push(r.line.name);
        return;
      }
      onBatten += r.c.onBatten ?? 0;
      setTotal += r.c.setTotal ?? 0;
      cw += r.c.cwLoad ?? 0;
      beamMax = Math.max(beamMax, r.c.beamLoad ?? 0);
    });
    extraRows.forEach(({ x, c }) => {
      if (c.fabricUnresolved) {
        unresolvedLines.push(x.name);
        return;
      }
      onBatten += c.onBatten ?? 0;
      setTotal += c.setTotal ?? 0;
      cw += c.cwLoad ?? 0;
      beamMax = Math.max(beamMax, c.beamLoad ?? 0);
    });
    const unresolved = unresolvedLines.length > 0;
    return {
      onBatten: unresolved ? null : onBatten,
      setTotal: unresolved ? null : setTotal,
      cw: unresolved ? null : cw,
      beamMax: unresolved ? null : beamMax,
      specified,
      generated: rows.length,
      unresolvedLines,
    };
  }, [rows, extraRows]);
  const weightsUnavailable = totals.unresolvedLines.length > 0;

  /** loads whose key no longer matches the current schedule (P1's "visible
   *  answer for orphaned data") — they reattach automatically if the layout
   *  produces that line again. */
  const orphanKeys = useMemo(() => {
    const live = new Set(keys);
    return Object.keys(loads).filter((k) => !live.has(k));
  }, [keys, loads]);

  const unspecified = totals.generated - totals.specified;

  /** Fabric failures grouped by CAUSE, one banner entry per distinct problem,
   *  listing the lines it hits. Two lines missing the same catalog part are one
   *  fix; a missing part and a part with no oz are two different fixes, so they
   *  never collapse together (#50). */
  const fabricProblems = useMemo(() => {
    const byMessage = new Map<string, { issue: FabricIssue; lines: string[] }>();
    const add = (issue: FabricIssue | null, name: string) => {
      if (!issue) return;
      const g = byMessage.get(issue.message);
      if (g) g.lines.push(name);
      else byMessage.set(issue.message, { issue, lines: [name] });
    };
    rows.forEach((r) => add(r.issue, r.line.name));
    extraRows.forEach(({ x, issue }) => add(issue, x.name));
    return [...byMessage.values()];
  }, [rows, extraRows]);
  const fabricProblemCount = fabricProblems.reduce((n, g) => n + g.lines.length, 0);

  function exportCsv() {
    // Batten + the fabric warning ride along: an exported schedule that hides
    // an unresolved-weight line is the same silent failure as the screen used
    // to be (#50). Hard-fail (#64): the Weight column reads blank, never a
    // wrong 0, and the Check column says UNAVAILABLE, never a brick combo or
    // an OK/OVER LIMIT verdict computed off an unresolved figure.
    const header = ["#", "Slot", "Downstage", "Type", "Name", "Fabric", "W(ft)", "H(ft)", "Full%", "Qty", "Gear(lb)", "Track", "Batten", "Batten len(ft)", "Mode", "Hoist", "Weight on batten(lb)", "Check", "Source"];
    const flag = (issue: FabricIssue | null | undefined) => (issue ? `FABRIC UNRESOLVED (${issue.short}), weight unavailable; ` : "");
    const checkFor = (c: ReturnType<typeof computeSetWeight> | null, mode: LinesetMode) =>
      !c ? "NOT SPECIFIED" : c.fabricUnresolved ? "UNAVAILABLE" : mode === "cw" ? `${c.combo!.big}x25+${c.combo!.small}x10 brick` : c.over ? "OVER LIMIT" : "OK";
    const csvRows: (string | number)[][] = rows.map((r, i) => {
      const mode = r.mode;
      const source = r.load ? "overridden" : r.ruled ? "rule" : "manual";
      return [
        i + 1, r.s.slot, r.s.dsPositionLabel, r.s.type, r.line.name,
        r.line.fab || "", r.line.w ?? "", r.line.h ?? "", r.line.full ?? wdef.full, r.line.qty ?? 1, r.line.gear ?? "",
        r.line.track || "None", battenById(r.line.pipe || wdef.pipe).label, r.line.batten ?? wdef.battenlen,
        r.c ? MODE_LABEL[mode] : "", r.c && mode === "motor" ? r.line.hoist || wdef.hoist : "",
        r.c && r.c.onBatten != null ? Math.round(r.c.onBatten) : "", flag(r.issue) + checkFor(r.c, mode), source,
      ];
    });
    extraRows.forEach(({ x, c, issue }, i) => {
      const mode = x.mode || wdef.mode;
      csvRows.push([
        rows.length + i + 1, "", "custom", "Custom", x.name, x.fab || "", x.w ?? "", x.h ?? "", x.full ?? wdef.full, x.qty ?? 1, x.gear ?? "",
        x.track || "None", battenById(x.pipe || wdef.pipe).label, x.batten ?? wdef.battenlen,
        MODE_LABEL[mode], mode === "motor" ? x.hoist || wdef.hoist : "", c.onBatten != null ? Math.round(c.onBatten) : "",
        flag(issue) + checkFor(c, mode),
        "overridden",
      ]);
    });
    csvRows.push([
      "", "", "", "", "TOTAL", "", "", "", "", "", "", "", "", "", "", "",
      totals.onBatten != null ? Math.round(totals.onBatten) : "",
      weightsUnavailable
        ? `WEIGHT UNAVAILABLE — fabric unresolved on: ${totals.unresolvedLines.join(", ")}`
        : unspecified
        ? `${unspecified} lines not specified, excluded`
        : `peak/beam ${Math.round(totals.beamMax ?? 0)} lb`,
      "",
    ]);
    // Filename names the OPENING now, not the retired wall-to-wall width (#50).
    downloadCsv(`lineset-pro${inp.proWidthFt}x${inp.stageDepthFt}deep`, header, csvRows);
  }

  // `wdef`, not `def`: the saved record carries the batten length the schedule
  // was actually calculated with. Reopening re-derives it from proWidthFt
  // anyway, so the two can never drift.
  const getData = (): CombinedLinesetData => ({ v: 4, inputs: inp, defaults: wdef, loads, extras, tier, gear, categoryModes });

  /* ---- the per-line load editor (expands under the selected row, P5) ----
   *  A fourth field class lives here alongside generated / hand-entered /
   *  calculated (see file header): rule-derived. `lineKey` (schedule rows
   *  only — extras have no rule) drives isOverride() so a field the rule
   *  filled in renders muted until Jeff actually types over it (P7). */
  function LoadEditor({ value, onChange, onClear, isExtra, onRemove, lineKey, isElectric = false, resolvedMode, categoryMode }: {
    value: LineLoad & { name?: string };
    onChange: (patch: LineLoad & Partial<WeightLine>) => void;
    onClear?: () => void;
    isExtra?: boolean;
    onRemove?: () => void;
    lineKey?: string;
    isElectric?: boolean;
    resolvedMode?: LinesetMode;
    categoryMode?: LinesetMode;
  }) {
    const [tab, setTab] = useState<"load" | "fixtures">("load");
    const mode = resolvedMode || value.mode || def.mode;
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
    const issue = lineFabricIssue(value, catalogRule || null, fabrics);
    const fixtureLoads = value.fixtureLoads || [];
    const addFixture = () =>
      onChange({
        fixtureLoads: [
          ...fixtureLoads,
          { id: `fx-${Date.now()}-${fixtureLoads.length}`, name: "Fixture", qty: 1, weightLb: gear.fixtureLb.par },
        ],
      });
    const patchFixture = (id: string, patch: Partial<ElectricFixtureLoad>) =>
      onChange({ fixtureLoads: fixtureLoads.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
    return (
      <div style={{ background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 10, padding: "12px 14px", margin: "2px 0 6px" }}>
        {isElectric && (
          <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid #e4e7ec" }}>
            {(["load", "fixtures"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                style={{ border: "none", borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent", background: "transparent", color: tab === key ? "#16181d" : "#6b7079", padding: "5px 9px 7px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 12 }}
              >
                {key === "load" ? "Load & rigging" : `Fixtures${fixtureLoads.length ? ` (${fixtureLoads.length})` : ""}`}
              </button>
            ))}
          </div>
        )}
        {tab === "fixtures" && isElectric ? (
          <div>
            <div style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.45, marginBottom: 10 }}>
              List the fixtures actually hanging on this electric. Their total replaces the automatic fixture allowance; the distribution allowance remains included.
            </div>
            {fixtureLoads.length === 0 ? (
              <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 10 }}>No manual fixtures yet — this electric is using its calculated fixture allowance.</div>
            ) : (
              <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                {fixtureLoads.map((f) => (
                  <div key={f.id} style={{ display: "grid", gridTemplateColumns: "minmax(130px, 1fr) 76px 92px auto", gap: 6, alignItems: "end" }}>
                    <input value={f.name} onChange={(e) => patchFixture(f.id, { name: e.target.value })} aria-label="Fixture name" style={field} />
                    <div><span style={label}>Qty</span><NumF v={f.qty} set={(qty) => patchFixture(f.id, { qty })} /></div>
                    <div><span style={label}>lb each</span><NumF v={f.weightLb} set={(weightLb) => patchFixture(f.id, { weightLb })} /></div>
                    <button type="button" onClick={() => onChange({ fixtureLoads: fixtureLoads.filter((item) => item.id !== f.id) })} style={{ ...field, width: "auto", padding: "7px 9px", color: "#b4543a", cursor: "pointer" }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={addFixture} style={{ ...field, width: "auto", padding: "6px 10px", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>+ Add fixture</button>
              {value.fixtureLoads !== undefined && (
                <button type="button" onClick={() => onChange({ fixtureLoads: undefined })} style={{ ...field, width: "auto", padding: "6px 10px", color: "#5b616e", cursor: "pointer" }}>Use calculated allowance</button>
              )}
              <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "#3d424e" }}>{fixtureLoadWeight(fixtureLoads).toFixed(1)} lb fixtures</span>
            </div>
          </div>
        ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
          {isExtra && (
            <div style={{ gridColumn: "1 / -1" }}><span style={label}>Line name</span>
              <input value={value.name || ""} onChange={(e) => onChange({ name: e.target.value } as Partial<WeightLine>)} style={field} /></div>
          )}
          <div style={{ gridColumn: "span 2" }}><span style={genLabel("fab")}>Fabric / goods</span>
            <select value={value.fab || FAB_NONE} onChange={(e) => onChange({ fab: e.target.value, fabResolved: undefined })} style={{ ...field, ...genStyle("fab"), ...(issue ? { borderColor: "#b4543a" } : {}) }}>
              <option>{FAB_NONE}</option>
              {catalogRule
                ? fabrics.map((f) => <option key={f.sku} value={f.desc}>{f.desc}</option>)
                : FABLIB.map((f) => <option key={f.name}>{f.name}</option>)}
            </select>
            {/* The fabric drives BOTH goods and track weight, when it doesn't
                resolve the row reads as a blank, not as a failure (#50). */}
            {issue && (
              <div style={{ fontSize: 11.5, color: "#b4543a", marginTop: 4, lineHeight: 1.45 }}>⚠ {issue.message}</div>
            )}</div>
          <div>
            <span style={label}>Fabric weight (oz)</span>
            <OptNumF
              v={value.fabResolved?.oz}
              placeholder={value.fabResolved?.oz || 0}
              set={(oz) =>
                onChange({
                  fabResolved: oz && oz > 0
                    ? {
                        name: value.fab || "Manual fabric",
                        oz,
                        basis: value.fabResolved?.basis || "lin-yd",
                        width: value.fabResolved?.width || 54,
                      }
                    : undefined,
                })
              }
            />
            <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 3, lineHeight: 1.35 }}>
              Optional row override; blank uses the selected fabric&apos;s catalog weight.
            </div>
          </div>
          <div><span style={genLabel("w")}>Width (ft)</span><NumF v={value.w ?? 0} set={(n) => onChange({ w: n })} style={genStyle("w")} /></div>
          <div><span style={genLabel("h")}>Height (ft)</span><NumF v={value.h ?? 0} set={(n) => onChange({ h: n })} style={genStyle("h")} /></div>
          <div><span style={genLabel("full")}>Fullness %</span><NumF v={value.full ?? def.full} set={(n) => onChange({ full: n })} style={genStyle("full")} /></div>
          <div><span style={genLabel("qty")}>Qty</span><NumF v={value.qty ?? 1} set={(n) => onChange({ qty: n })} style={genStyle("qty")} /></div>
          <div><span style={genLabel("gear")}>Gear (lb)</span><NumF v={value.gear ?? 0} set={(n) => onChange({ gear: n })} style={genStyle("gear")} /></div>
          <div><span style={genLabel("chain")}>Chain</span>
            <select value={value.chain || "None"} onChange={(e) => onChange({ chain: e.target.value })} style={{ ...field, ...genStyle("chain") }}>
              {CHAINS.map((c) => <option key={c.name}>{c.name}</option>)}
            </select></div>
          {/* "None" is a select-layer option, NOT a TRACKS entry: TRACKS is
              exported from steel.ts and a zero-weight row there would leak into
              anything else that lists tracks. Clearing stores "" (a real, saved
              value that reads as an override) rather than undefined, so
              trackByName("") misses and the track weighs 0, which is exactly
              what a no-track line (Legs/Border/CYC) means. Before this, the
              select showed the FIRST track on every no-track line while storing
              nothing, and a set track could never be cleared (#50). */}
          <div><span style={genLabel("track")}>Track</span>
            <select value={value.track || TRACK_NONE} onChange={(e) => onChange({ track: e.target.value === TRACK_NONE ? "" : e.target.value })} style={{ ...field, ...genStyle("track") }}>
              <option value={TRACK_NONE}>None: no track</option>
              {TRACKS.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select></div>
          {/* Per-line batten: blank = the schedule default (the pipe choice
              comes from the settings drawer, the LENGTH is derived from PRO
              width, #50), matching how every other blank per-line field
              inherits. Typing a number here still overrides the rule. */}
          <div style={{ gridColumn: "span 2" }}><span style={genLabel("pipe")}>Batten (pipe)</span>
            <select value={value.pipe || ""} onChange={(e) => onChange({ pipe: e.target.value })} style={{ ...field, ...genStyle("pipe") }}>
              <option value="">Default: {battenById(def.pipe).label}</option>
              {BATTENS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select></div>
          <div><span style={genLabel("batten")}>Batten len (ft)</span>
            <OptNumF v={value.batten} placeholder={wdef.battenlen} set={(n) => onChange({ batten: n })} style={genStyle("batten")} /></div>
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
        )}
        {lineKey && !isOverride(lineKey, "mode") && categoryMode && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: "#5b616e" }}>
            Using the <b>{MODE_LABEL[categoryMode]}</b> rule for all {rows.find((r) => r.key === lineKey)?.s.type} lines.
          </div>
        )}
        {lineKey && isOverride(lineKey, "mode") && (
          <button
            type="button"
            onClick={() => onChange({ mode: undefined })}
            style={{ marginTop: 8, background: "none", border: "none", color: "var(--accent)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", padding: 0 }}
          >
            Use category / global mode
          </button>
        )}
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
    specified && c && !c.fabricUnresolved ? (
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmt(c.onBatten)} lb</span>
    ) : specified && c && c.fabricUnresolved ? (
      <span title="Fabric unresolved — weight can't be calculated, not zero" style={{ color: "#b4543a", fontWeight: 600, fontSize: 12 }}>unavailable</span>
    ) : (
      <span style={{ color: "#c4c9d2" }}>—</span>
    );

  // F1 hard-fail (punch #64): an unresolved-fabric line gets its OWN dot color
  // — never the green "OK" (nothing was verified) and never folded into the
  // yellow "not entered yet" dot (this line WAS entered, it just can't weigh).
  const checkCell = (specified: boolean, c: ReturnType<typeof computeSetWeight> | null, mode: LinesetMode) => {
    if (!specified || !c)
      return <span title="Weights not entered yet — excluded from totals" style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "#d9a62a" }} />;
    if (c.fabricUnresolved)
      return <span title="Fabric unresolved — weight unavailable, excluded from totals" style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "#8c3a26" }} />;
    if (mode === "cw" && c.combo)
      return <span title={`${c.combo.big}×25 + ${c.combo.small}×10 lb`} style={{ fontSize: 11.5, color: "#5b616e" }}>{c.combo.big}·{c.combo.small} brick</span>;
    return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: c.over ? "#b4543a" : "#1f7a52" }} title={c.over ? "Over a limit" : "OK"} />;
  };
  const selectedRow = openKey ? rows.find((row) => row.key === openKey) : undefined;
  const selectedExtra = openKey ? extraRows.find(({ x }) => x.xid === openKey) : undefined;

  return (
    <div>
      <SaveBar kind="lineset" getData={getData} customers={customers} saved={saved} loaded={loaded} loadBase="/design/lineset?design=" />
      {initial?.legacyWeights && (
        <div style={{ background: "#fbf3dd", border: "1px solid #eadfc0", borderRadius: 10, padding: "9px 13px", fontSize: 12.5, color: "#7a6420", marginBottom: 14 }}>
          Opened from the old Lineset Weights tool — its rows came in as custom lines below.
          Saving creates a combined design; the old record stays until you delete it.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: openKey ? "minmax(250px, 300px) minmax(420px, 1fr) minmax(300px, 350px)" : "minmax(0, 300px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        {/* ---- input rail ---- */}
        <div style={card}>
          {/* Three venue dimensions, and only three (#50): PRO width, PRO
              height, stage depth. Wall-to-wall stage width is gone, it never
              reached the placement math. Depth keeps an inches field because
              the 8-inch grid is depth-driven and 4 inches moves a slot. */}
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Venue dimensions</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><span style={label}>PRO width (ft)</span><NumF v={inp.proWidthFt} set={(n) => set("proWidthFt", n)} /></div>
            <div><span style={label}>PRO height (ft)</span><NumF v={inp.proHeightFt} set={(n) => set("proHeightFt", n)} /></div>
            <div><span style={label}>Stage depth (ft)</span><NumF v={inp.stageDepthFt} set={(n) => set("stageDepthFt", n)} /></div>
            <div><span style={label}>Stage depth (in)</span><NumF v={inp.stageDepthIn} set={(n) => set("stageDepthIn", n)} /></div>
          </div>
          <div style={{ fontSize: 11.5, color: "#6b7079", marginTop: 8, lineHeight: 1.45 }}>
            Battens are <b>{derivedBattenLen} ft</b>: PRO width plus {BATTEN_OVERHANG_FT} ft of
            overhang each side. Override a single line from its row.
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

          <div style={{ fontSize: 13.5, fontWeight: 700, margin: "18px 0 5px" }}>Category rigging rules</div>
          <div style={{ fontSize: 11.5, color: "#6b7079", lineHeight: 1.45, marginBottom: 9 }}>
            Set the default mode for every line in a category. Individual line edits override these rules.
          </div>
          {([false, true] as const).map((curtains) => {
            const types = categoryTypes.filter((type) => CURTAIN_TYPES.has(type) === curtains);
            if (!types.length) return null;
            return (
              <div key={String(curtains)} style={{ marginTop: curtains ? 12 : 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
                  {curtains ? "Curtains & soft goods" : "Rigging & utility"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {types.map((type) => (
                    <div key={type}>
                      <span style={label}>{type}</span>
                      <select value={categoryModes[type] || ""} onChange={(e) => setCategoryMode(type, e.target.value as LinesetMode | "")} style={field}>
                        <option value="">Use global ({MODE_LABEL[def.mode]})</option>
                        <option value="motor">Motor</option>
                        <option value="dead">Dead-hung</option>
                        <option value="cw">Counterweight</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

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
                {/* Batten length is no longer typed in here: it is PRO width +
                    4 ft, derived (#50). Shown read-only so the number driving
                    batten, track and distribution weight is still visible. */}
                <div><span style={label}>Batten length (ft)</span>
                  <div style={{ ...field, background: "#f6f7f9", color: "#5b616e" }}>
                    {derivedBattenLen} <span style={{ fontSize: 11, color: "#9aa0ab" }}>= PRO {inp.proWidthFt} + {2 * BATTEN_OVERHANG_FT}</span>
                  </div></div>
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
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", margin: "14px 0 6px" }}>Soft goods</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {/* Labels track FABRIC_BY_TYPE_TIER (goods.ts), the drape row
                    first, then legs, which sit one grade down at every tier.
                    The old labels named 16 oz Encore and 21 oz Marvel, neither
                    of which any tier selects for a draw curtain (#50). */}
                <div style={{ gridColumn: "1 / -1" }}><span style={label}>Fabric tier</span>
                  <select value={tier} onChange={(e) => setTier(e.target.value as GoodsTier)} style={field}>
                    <option value="good">Good: 22 oz Encore (16 oz legs)</option>
                    <option value="better">Better: 25 oz Charisma (22 oz legs)</option>
                    <option value="best">Best: 25 oz Memorable (25 oz Charisma legs)</option>
                  </select>
                  <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 4 }}>The CYC is seamless muslin at every tier.</div>
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", margin: "14px 0 6px" }}>Gear weights (lb)</div>
              {/* `front` (FOH fixtures) is intentionally not editable here: electricGearLb()
                  (goods.ts) never reads fixtureLb.front — front-of-house fixtures hang on a
                  house position, not a lineset batten — so an editable Front field here would
                  change nothing. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><span style={label}>Par</span><NumF v={gear.fixtureLb.par} set={(n) => setFix("par", n)} /></div>
                <div><span style={label}>Cyc</span><NumF v={gear.fixtureLb.cyc} set={(n) => setFix("cyc", n)} /></div>
                <div><span style={label}>Side</span><NumF v={gear.fixtureLb.side} set={(n) => setFix("side", n)} /></div>
                <div><span style={label}>Automated</span><NumF v={gear.fixtureLb.automated} set={(n) => setFix("automated", n)} /></div>
                <div><span style={label}>Distribution lb/ft</span><NumF v={gear.distributionLbPerFt} set={(n) => setGearTop("distributionLbPerFt", n)} /></div>
                <div><span style={label}>Shell lb/ft²</span><NumF v={gear.shellPsf} set={(n) => setGearTop("shellPsf", n)} /></div>
              </div>
            </>
          )}
          <button onClick={() => setInp(DEFAULT_LINESET_INPUTS)} style={{ marginTop: 14, width: "100%", background: "#f6f7f9", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 600, color: "#5b616e", cursor: "pointer" }}>
            Reset layout to a 40′ × 20′ opening, 30′ deep
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

          {/* Fabric failures, grouped by cause (#50/#64). computeSetWeight now
              HARD-FAILS when the fabric doesn't resolve — goods and track
              weight come back null, not 0, and the line is excluded from
              every total (never silently summed in as a plausible-looking
              low number). No fallback weight is invented: the gap is named,
              not papered over. */}
          {fabricProblems.length > 0 && !showGrid && (
            <div style={{ background: "#fbeceb", border: "1px solid #eccdc7", borderRadius: 10, padding: "9px 13px", fontSize: 12.5, color: "#8c3a26", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {/* One template literal, not adjacent JSX children: an empty-string
                    child between two text nodes swallowed the space before "can't". */}
                {`⚠ ${fabricProblemCount} line${fabricProblemCount === 1 ? "" : "s"} can't be weighed — the fabric didn't resolve, so weight is UNAVAILABLE (not zero) and excluded from every total below`}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                {fabricProblems.map((g) => (
                  <li key={g.issue.message}>
                    <strong>{g.lines.join(", ")}:</strong> {g.issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

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
                      <tr key={r.key} onClick={() => setOpenKey(openKey === r.key ? null : r.key)} style={{ cursor: "pointer", background: openKey === r.key ? "color-mix(in srgb, var(--accent) 5%, #fff)" : undefined }}>
                        <td style={{ ...td, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}>{i + 1}</td>
                        <td style={{ ...td, fontFamily: "var(--font-mono)", color: "#9aa0ab" }}>{r.s.slot}</td>
                        <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{r.s.dsPositionLabel || "—"}</td>
                        <td style={td}><span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, color: "#fff", background: TYPE_COLOR[r.s.type] || "#6b7079" }}>{r.s.type}</span></td>
                        <td style={{ ...td, fontWeight: 500 }}>
                          {r.line.name}
                          {r.s.warning && <span title={r.s.warning} style={{ color: "#b4543a", fontSize: 12, marginLeft: 6 }}>⚠</span>}
                          {r.issue && (
                            <div title={r.issue.message} style={{ fontSize: 11, fontWeight: 600, color: "#b4543a", marginTop: 2 }}>
                              ⚠ {r.issue.short}: weight unavailable
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>{weightCell(r.specified, r.c)}</td>
                        <td style={td}>{checkCell(r.specified, r.c, r.mode)}</td>
                        <td style={{ ...td, color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>{openKey === r.key ? "open →" : "edit →"}</td>
                      </tr>
                  ))}
                  {extraRows.map(({ x, c, issue }, i) => (
                      <tr key={x.xid} onClick={() => setOpenKey(openKey === x.xid ? null : x.xid)} style={{ cursor: "pointer", background: openKey === x.xid ? "color-mix(in srgb, var(--accent) 5%, #fff)" : undefined }}>
                        <td style={{ ...td, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}>{rows.length + i + 1}</td>
                        <td style={{ ...td, color: "#c4c9d2" }}>—</td>
                        <td style={{ ...td, color: "#c4c9d2", fontSize: 12 }}>custom</td>
                        <td style={td}><span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, color: "#5b616e", background: "#eef0f3" }}>Custom</span></td>
                        <td style={{ ...td, fontWeight: 500 }}>
                          {x.name}
                          {issue && (
                            <div title={issue.message} style={{ fontSize: 11, fontWeight: 600, color: "#b4543a", marginTop: 2 }}>
                              ⚠ {issue.short}: weight unavailable
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>{weightCell(true, c)}</td>
                        <td style={td}>{checkCell(true, c, x.mode || def.mode)}</td>
                        <td style={{ ...td, color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>{openKey === x.xid ? "open →" : "edit →"}</td>
                      </tr>
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

              {/* show-wide rollup — refuses to look complete while lines are
                  unspecified (P2) OR while any specified line's fabric hasn't
                  resolved (#64): a "Total on batten" number is safety-relevant
                  (feeds hoist selection and batten capacity), so it goes
                  UNAVAILABLE rather than quietly summing the resolvable lines
                  into a plausible-but-low figure. */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <div style={kpi(true)}>
                  <div style={{ fontSize: 11, color: "#6b7079" }}>Total on batten</div>
                  {weightsUnavailable ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#8c3a26" }}>Unavailable</div>
                      <div style={{ fontSize: 11, color: "#8c3a26", fontWeight: 600 }}>
                        fabric unresolved on {totals.unresolvedLines.length} line{totals.unresolvedLines.length === 1 ? "" : "s"}:{" "}
                        {totals.unresolvedLines.slice(0, 3).join(", ")}
                        {totals.unresolvedLines.length > 3 ? ` +${totals.unresolvedLines.length - 3} more` : ""}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.onBatten)} lb</div>
                      <div style={{ fontSize: 11, color: unspecified ? "#9a7d1f" : "#9aa0ab", fontWeight: unspecified ? 600 : 400 }}>
                        {unspecified ? `${totals.specified} of ${totals.generated} lines specified — partial total` : `${totals.generated + extraRows.length} lines`}
                      </div>
                    </>
                  )}
                </div>
                <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>Peak load / support beam</div><div style={{ fontSize: 20, fontWeight: 700 }}>{totals.beamMax == null ? "—" : `${fmt(totals.beamMax)} lb`}</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>across {def.lines} beams</div></div>
                <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>With powerheads</div><div style={{ fontSize: 20, fontWeight: 700 }}>{totals.setTotal == null ? "—" : `${fmt(totals.setTotal)} lb`}</div><div style={{ fontSize: 11, color: "#9aa0ab" }}>structure sees</div></div>
                {(totals.cw ?? 0) > 0 && <div style={kpi()}><div style={{ fontSize: 11, color: "#6b7079" }}>Counterweight (CW lines)</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totals.cw)} lb</div></div>}
              </div>
            </>
          )}

          <p style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 12, lineHeight: 1.5 }}>
            Slots, positions, types and default names are generated by the layout rules — change the venue inputs and
            they regenerate; weight entries follow their line (1st Electric stays 1st Electric). Fabric, dimensions and
            rigging are hand-entered per line; weight, checks and brick combos are calculated. Goods = flat width
            (× fullness) × cut height × fabric weight + chain + hardware. Motor lines check hoist capacity and batten
            bending; CW lines pick a 25/10 lb brick combo.
          </p>
          {/* Limitation notice (punch #73) — kept out of pk-no-print so it
              also shows on the printed schedule. Wording lives in ONE place
              (src/lib/compliance-notices.ts) — see the DRAFT WORDING comment
              there; not yet reviewed by counsel or signed off by product. */}
          <p style={{ fontSize: 11.5, color: "#6b7079", marginTop: 10, lineHeight: 1.5, borderTop: "1px solid #eef0f3", paddingTop: 10 }}>
            {RIGGING_LIMITATION_NOTICE}
          </p>
        </div>

        {openKey && (
          <aside style={{ ...card, position: "sticky", top: 14, maxHeight: "calc(100vh - 28px)", overflow: "auto", padding: 14 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8c919c", letterSpacing: ".05em", textTransform: "uppercase" }}>Line inspector</div>
                <div style={{ marginTop: 3, fontSize: 14, fontWeight: 700 }}>{selectedRow?.line.name || selectedExtra?.x.name || "Line"}</div>
                {selectedRow && <div style={{ marginTop: 2, fontSize: 11.5, color: "#6b7079" }}>{selectedRow.s.type} · slot {selectedRow.s.slot}</div>}
                {selectedExtra && <div style={{ marginTop: 2, fontSize: 11.5, color: "#6b7079" }}>Custom line</div>}
              </div>
              <button type="button" onClick={() => setOpenKey(null)} aria-label="Close line inspector" style={{ border: "none", background: "transparent", color: "#6b7079", fontSize: 18, lineHeight: 1, cursor: "pointer", padding: 3 }}>×</button>
            </div>
            {selectedRow && (
              <LoadEditor
                value={{ ...selectedRow.line }}
                onChange={(patch) => patchLoad(selectedRow.key, patch)}
                onClear={selectedRow.specified ? () => { clearLoad(selectedRow.key); setOpenKey(null); } : undefined}
                lineKey={selectedRow.key}
                isElectric={selectedRow.s.type === "Electric"}
                resolvedMode={selectedRow.mode}
                categoryMode={categoryModes[selectedRow.s.type]}
              />
            )}
            {selectedExtra && (
              <LoadEditor
                value={selectedExtra.x}
                isExtra
                onChange={(patch) => patchExtra(selectedExtra.x.xid, patch)}
                onRemove={() => { setExtras((a) => a.filter((entry) => entry.xid !== selectedExtra.x.xid)); setOpenKey(null); }}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
