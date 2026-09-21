# Manual mode scope targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Grid Manual mode the same venue/size/dimensions/systems basic-info intake Quick Design (Auto) already has, and turn its output into a live, revisable dollar target per trackable system that the Grid's Scope sidebar panel tracks placed-$-vs-target-$ against.

**Architecture:** Extract Quick Design's existing venue/size/dims/systems config UI out of `quick-design-client.tsx` into a shared client component (`ScopeInputsPanel`) that takes `value`/`onChange`/a systems allowlist. `GridProject` gains a `scopeInputs` field (same shape as `AState`'s basic-info fields, minus canvas/tier/persistence-only fields) that stays live-editable for the project's life — no separate frozen snapshot. A new Grid sidebar panel (`ScopePanel`) renders `ScopeInputsPanel` restricted to the 5 catalog-trackable systems (Lighting, Rigging, Curtains, Audio, Video), plus a Good/Better/Best lens toggle and one progress row per in-scope system: placed $ (from `bomBySpace`, reused with an empty spaces array to get a whole-project rollup) vs. target $ (from a new `scopeTargets()` helper that runs the same `compute()`/`tierSystems()` pipeline Quick Design already uses). Nothing is ever blocked — placement outside scope rolls into an "Untracked" row.

**Tech Stack:** Next.js App Router, React client components, TypeScript, existing `design/quick/engine.ts` pure compute engine, `doc-store` JSONB documents (Postgres/PGlite via Drizzle), existing `grid-bom.ts` rollup helpers.

## Global Constraints

- Port faithfully — the extracted UI must render pixel-identical to today's Quick Design "Design inputs" panel (same copy, same layout, same interaction order). No visual changes as part of this plan.
- No hard validation: placement outside scope is never blocked, scope inputs are never locked after creation, skipping the basic-info step at Manual-project creation is valid (`scopeInputs` stays `null`).
- Auto/Quick Design's engine, live-editing, and promote-to-quote flow are untouched by this plan.
- Manual mode's quote/promote flow (`createDraftQuoteAction`) is untouched.
- Only the code in this repo checkout — do not touch `design_handoff_claude_code/` (read-only spec reference).
- **Dev DB is single-process.** Only one `npm run dev` may run against `.data/pglite` at a time. Do not start a second dev server while one may still be running; check `ps aux | grep -i "next dev\|tsx "` first. Prefer `npx tsc --noEmit` for per-task verification and save the one browser/dev-server check for the final task.
- This plan deliberately does **not** change `createManualDesignAction`'s signature or add a creation-time wizard — Manual projects keep starting blank (`scopeInputs: null`), and the Scope panel's own inline inputs are the only way to set it, both at first use and on every later visit (see design spec §"Shared basic-info component"). This is a scope-reduction from the spec's suggested "createManualDesignAction changes signature" line, justified by the spec's own "skipping that step is still allowed" clause and YAGNI — flag if you believe a creation-time prompt is actually required.

---

### Task 1: Engine additions — `QuickScopeInputs` type, `SYS_ORDER`, `scopeTargets()`

**Files:**
- Modify: `src/app/(app)/design/quick/engine.ts`

**Interfaces:**
- Produces: `QuickScopeInputs` type, `SYS_ORDER: SysKey[]` const, `scopeTargets(inputs, tierKey, tierDefs, fabrics, assemblyOptions?) => Partial<Record<SysKey, number>>` function — all three consumed by Task 2 (`ScopeInputsPanel`), Task 4 (`GridProject.scopeInputs`), and Task 7 (`ScopePanel`'s target column).

This file already exports `AState`, `compute`, `tierSystems`, `TierKey`, `TierDefs`, `FabricOption`, `SysKey`, `SHORT`, `SYSCOLOR`, `defaultAState` (all read in the earlier research pass — see `compute()` at engine.ts:431, `tierSystems()` at engine.ts:788, `defaultAState()` at engine.ts:845).

- [ ] **Step 1: Add `QuickScopeInputs`, right after the `AState` type definition (after engine.ts's closing `};` of `AState`, before the `/* -------------------------------- constants -------------------------------- */` comment)**

```ts
/**
 * The basic-info slice of AState shared by Quick Design's inline config
 * panel and Grid Manual mode's Scope panel (D-manual-scope-targets):
 * venue/size/dimensions plus the systems-in-scope toggles and their
 * sub-config (rig type, drape/fixture/control/shell picks, pit type).
 * Deliberately excludes the fields that only make sense for Quick Design's
 * own canvas/persistence: `view` (which tab is open), `tier` (Manual's
 * Scope panel treats tier as a lens, not stored input — see scopeTargets),
 * `contingency`/`qtyOverrides` (tier-total-only, not per-system), `mode`/
 * `placements` (Auto's own sandbox canvas state), and the plan-image/door
 * fields (Auto-canvas-only).
 */
export type QuickScopeInputs = Omit<
  AState,
  | "view"
  | "tier"
  | "contingency"
  | "qtyOverrides"
  | "mode"
  | "placements"
  | "houseHalfFt"
  | "doorsL"
  | "doorsR"
  | "doorsBack"
  | "planImage"
  | "planName"
  | "showGen"
>;
```

- [ ] **Step 2: Add `SYS_ORDER`, right after the `SYSCOLOR` const (engine.ts, immediately below the `SYSCOLOR` object's closing `};`, before the `SUBCFG` const)**

```ts
/**
 * Display order for the "systems to include" toggle list. Mirrors
 * compute()'s `defs` array order (rigging, curtains, lighting, controls,
 * acoustical, pit, audio, video) — NOT Object.keys(SHORT)'s declaration
 * order, which has audio/video before acoustical/pit. Kept as its own
 * const so ScopeInputsPanel can render the list without running compute().
 */
export const SYS_ORDER: SysKey[] = [
  "rigging",
  "curtains",
  "lighting",
  "controls",
  "acoustical",
  "pit",
  "audio",
  "video",
];
```

- [ ] **Step 3: Add `scopeTargets()`, right after `tierSystems()` (engine.ts, after the closing `}` of `tierSystems`, before the `/** same pipeline without overrides` comment for `tierSystemsBase`)**

```ts
/**
 * Good/Better/Best dollar target per in-scope system, for a QuickScopeInputs
 * basic-info snapshot — the Grid Manual mode Scope panel's goalpost math
 * (D-manual-scope-targets). Runs the SAME compute()/tierSystems() pipeline
 * Quick Design's own estimate uses, merged onto defaultAState so every field
 * compute() reads (rigType/drape/fixtures/ctrl/shell/pitType/tier) is
 * present even though QuickScopeInputs omits `tier` — the tier comes in as
 * a parameter here because the Scope panel's tier toggle is a LENS applied
 * on read, never stored on the project.
 *
 * Returns each on-system's `rev` (sell revenue, the same $ basis
 * bomBySpace/bomLines use for placed $) keyed by SysKey — only keys present
 * in `inputs.sys` with a truthy value are included.
 */
export function scopeTargets(
  inputs: QuickScopeInputs,
  tierKey: TierKey,
  tierDefs: TierDefs,
  fabrics: FabricOption[],
  assemblyOptions: Record<string, { name: string; cost: number }> = {}
): Partial<Record<SysKey, number>> {
  const merged: AState = { ...defaultAState(0), ...inputs, tier: tierKey };
  const C = compute(merged, assemblyOptions);
  const systems = tierSystems(C, merged, tierKey, tierDefs, fabrics);
  const out: Partial<Record<SysKey, number>> = {};
  for (const sys of systems) {
    if (sys.on) out[sys.key] = sys.rev;
  }
  return out;
}
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
```

Expect no new errors referencing `engine.ts`. (`QuickScopeInputs`/`SYS_ORDER`/`scopeTargets` are unused exports at this point — fine, later tasks consume them.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/design/quick/engine.ts"
git commit -m "feat(design): add QuickScopeInputs, SYS_ORDER, scopeTargets to the estimate engine"
```

---

### Task 2: Shared `ScopeInputsPanel` component

**Files:**
- Create: `src/components/design/scope-inputs-panel.tsx`

**Interfaces:**
- Consumes: `QuickScopeInputs`, `SYS_ORDER`, `SysKey`, `TierKey`-independent statics `DIMSCHEMA`, `LIM`, `SIZES`, `SUBCFG`, `SYSSUB`, `SHORT`, `SYSCOLOR`, `VENUES`, `venueOf`, `sizedDims`, `clamp` — all from `../../app/(app)/design/quick/engine` (this file lives at `src/components/design/`, so the relative path back to `src/app/(app)/design/quick/engine.ts` is `../../app/(app)/design/quick/engine`; the `@/` alias also works: `@/app/(app)/design/quick/engine`, prefer the alias for readability).
- Produces: default export `ScopeInputsPanel(props)` — consumed by Task 3 (Quick Design) and Task 7 (Grid's `ScopePanel`).

This is a verbatim extraction of the "venue type" / "size" / "dims" / "systems to include" sections currently inline in `quick-design-client.tsx` (lines 639–770 today), generalized so both callers can use it. Read `src/app/(app)/design/quick/quick-design-client.tsx` once before starting this task so the extracted JSX below is fresh in context — it must match byte-for-byte except for the `a`→`value`, `updA`→`onChange`, and local-handler renames called out below.

- [ ] **Step 1: Write the new file**

```tsx
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
  type AState,
  type DimField,
  type QuickScopeInputs,
  type SysKey,
} from "@/app/(app)/design/quick/engine";

/**
 * Shared venue/size/dimensions/systems-in-scope intake panel
 * (D-manual-scope-targets) — extracted verbatim from Quick Design's inline
 * "Design inputs" panel so both Auto (Quick Design, all 8 systems) and
 * Manual (Grid's Scope sidebar panel, 5 catalog-trackable systems) drive the
 * SAME basic-info UI. Fully controlled: `value`/`onChange` own the data,
 * this component owns only its collapse/expand UI state.
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
  fixtureAssemblies = [],
  accentHex,
}: {
  value: QuickScopeInputs;
  onChange: (patch: Partial<QuickScopeInputs>) => void;
  /** Allowlist + display order — pass engine.ts's SYS_ORDER for Auto (all
   *  8), or the 5 catalog-trackable systems for Manual mode. */
  systems: SysKey[];
  /** Catalog-backed lighting assembly picker (Auto/Quick Design only) — a
   *  Manual-mode caller simply omits this and the sub-picker never renders. */
  fixtureAssemblies?: Array<{ id: string; name: string; cost: number }>;
  accentHex: string;
}) {
  const [sec, setSec] = useState({ venue: true, size: true, dims: true, systems: true });
  const venue = venueOf(value);

  const update = (patch: Partial<QuickScopeInputs>) => onChange(patch);
  const setVenue = (vk: string) => {
    const v = VENUES.find((x) => x.key === vk) || VENUES[0];
    const d = sizedDims(v, value.size);
    update({ venue: vk, sys: { ...v.sys }, ...d });
  };
  const stepDim = (field: DimField, dir: number) => {
    const l = LIM[field];
    update({ [field]: clamp(value[field], l[0], l[1]) + dir * 2 } as Partial<QuickScopeInputs>);
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
                {on && key === "lighting" && fixtureAssemblies.length > 0 && (
                  <div style={{ display: "grid", gap: 6, padding: "4px 2px 6px" }}>
                    {([["par", "Par"], ["front", "Front"], ["cyc", "Cyc"], ["side", "Side light"], ["automated", "Automated"]] as Array<[string, string]>)
                      .filter(([k]) => !!value.fixtures?.[k])
                      .map(([k, label]) => (
                        <label key={k} style={{ display: "grid", gridTemplateColumns: "82px minmax(0,1fr)", gap: 8, alignItems: "center", fontSize: 11.5, color: "#777d88" }}>
                          <span>{label}</span>
                          <select
                            value={value.fixtureAssemblies?.[k] || ""}
                            onChange={(event) => update({ fixtureAssemblies: { ...(value.fixtureAssemblies || {}), [k]: event.target.value } })}
                            style={{ minWidth: 0, border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 8px", background: "#fff", fontSize: 11.5 }}
                          >
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
```

Notes on the two deliberate deviations from a pure copy-paste:
- `stepDim` reads `clamp(value[field], l[0], l[1]) + dir * 2` instead of the original `clamp(a[field] + dir * 2, l[0], l[1])` — **do not make this change**, keep the original `clamp(value[field] + dir * 2, l[0], l[1])` form exactly (listed differently above only because it was transcribed from memory; verify against the live file in Step 1 below and match it verbatim).
- The component returns a React fragment (`<>...</>`), not a wrapping `<div>` — the two callers (Task 3, Task 7) each provide their own outer container/scroll div exactly as the original `qd-inputs` div did, so no visual change.

- [ ] **Step 2: Before writing, re-read the live source to catch any drift**

```bash
sed -n '639,770p' "src/app/(app)/design/quick/quick-design-client.tsx"
```

Diff this against the JSX block in Step 1 above field-by-field (style objects, copy strings, conditional order). Fix the file you just wrote in Step 1 if anything differs — the live file is the source of truth, this plan is a snapshot taken during research.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Expect no errors in `src/components/design/scope-inputs-panel.tsx` (the component isn't imported anywhere yet, so no "unused" errors from callers — but it must type-check standalone).

- [ ] **Step 4: Commit**

```bash
git add src/components/design/scope-inputs-panel.tsx
git commit -m "feat(design): extract shared ScopeInputsPanel from Quick Design's inline config panel"
```

---

### Task 3: Wire `ScopeInputsPanel` into Quick Design, delete dead code

**Files:**
- Modify: `src/app/(app)/design/quick/quick-design-client.tsx`

**Interfaces:**
- Consumes: `ScopeInputsPanel` (Task 2), `SYS_ORDER` (Task 1).

- [ ] **Step 1: Replace the extracted JSX block**

Read the current file first (`sed -n '625,775p' "src/app/(app)/design/quick/quick-design-client.tsx"` — line numbers will have drifted slightly if Task 2's Step 2 diff found anything, so locate the block by its `{/* venue type */}` opening comment and the `{sec.systems && (...)}`'s closing `)}` rather than trusting exact line numbers). Replace everything from the `{/* venue type */}` comment through the matching closing `)}` of the systems section (today: lines 639–770) with:

```tsx
            <ScopeInputsPanel
              value={a}
              onChange={updA}
              systems={SYS_ORDER}
              fixtureAssemblies={fixtureAssemblies}
              accentHex={accentHex}
            />
```

The surrounding `qd-inputs` div, its header (`Design inputs` + collapse button), and the closing `</div>` / siderail-collapsed branch stay exactly as they are today — only the inner venue/size/dims/systems block is replaced.

- [ ] **Step 2: Add the import**

In the imports block (top of file, after the `./engine` import closes around line 40), add:

```tsx
import ScopeInputsPanel from "@/components/design/scope-inputs-panel";
```

- [ ] **Step 3: Trim the now-unused imports from `./engine`**

In the `from "./engine"` import (quick-design-client.tsx:9–40), remove `DIMSCHEMA`, `LIM`, `SIZES`, `SUBCFG`, `SYSSUB` (all now only used inside `scope-inputs-panel.tsx`) and add `SYS_ORDER`. Keep `VENUES` only if it's still referenced elsewhere in the file — check with:

```bash
grep -n "VENUES\." "src/app/(app)/design/quick/quick-design-client.tsx"
```

If the only remaining hits are inside the block you just deleted, remove `VENUES` from the import too. Keep `venueOf` — it's still used at `const venue = venueOf(a);` (quick-design-client.tsx:224) for the preview header (`{venue.label} · {a.width}' × {a.depth}' × {a.grid}'`), which is outside the extracted block.

- [ ] **Step 4: Delete the now-dead local state and handlers**

Remove:
- `const [sec, setSec] = useState({ venue: true, size: true, dims: true, systems: true });` (quick-design-client.tsx:149)
- `const setVenue = (vk: string) => { ... };` (quick-design-client.tsx:383–387)
- `const stepDim = (field: DimField, dir: number) => { ... };` (quick-design-client.tsx:388–391)
- `const setDimVal = (field: DimField, raw: string) => { ... };` (quick-design-client.tsx:392–397)
- `const toggleSys = (sk: SysKey) => updA({ sys: { ...a.sys, [sk]: !a.sys[sk] } });` (quick-design-client.tsx:398)
- `const setSingle = (field: string, val: string) => updA({ [field]: val } as Partial<AState>);` (quick-design-client.tsx:399)
- `const toggleMulti = (field: string, opt: string) => { ... };` (quick-design-client.tsx:400–403)
- `const chipStyle = (sel: boolean): CSSProperties => ({ ... });` (quick-design-client.tsx:553)
- `const stepBtn: CSSProperties = { ... };` (quick-design-client.tsx:555)

Before deleting each, confirm with a grep that it has no other call site outside the block you just removed:

```bash
grep -n "\bsetVenue(\|\bstepDim(\|\bsetDimVal(\|\btoggleSys(\|\bsetSingle(\|\btoggleMulti(\|chipStyle(\|stepBtn\b" "src/app/(app)/design/quick/quick-design-client.tsx"
```

Expect every remaining hit to be inside `updA`'s own definition or otherwise unrelated (e.g. a different `stepBtn`-named local in an unrelated section) — if any handler is still referenced elsewhere, keep it and note why in your task summary instead of deleting it.

Do **not** delete `DimField` or `SysKey` type imports if they're still used elsewhere in the file (check with `grep -n "DimField\|SysKey" "src/app/(app)/design/quick/quick-design-client.tsx"` — likely still used in unrelated BOM/qty-override code further down).

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npm run lint
```

Expect zero errors. An unused-import lint error means Step 3/4 missed something — remove it.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/design/quick/quick-design-client.tsx"
git commit -m "refactor(design): wire ScopeInputsPanel into Quick Design, drop the now-shared inline handlers"
```

---

### Task 4: `GridProject.scopeInputs` field + `setScopeInputs` mutator

**Files:**
- Modify: `src/lib/stores/grid-projects.ts`

**Interfaces:**
- Consumes: `QuickScopeInputs` (Task 1, `@/app/(app)/design/quick/engine`).
- Produces: `GridProject.scopeInputs: QuickScopeInputs | null`, `setScopeInputs(projectId, scopeInputs): Promise<GridProject | null>` — consumed by Task 5 (server action) and Task 8 (editor prop threading).

- [ ] **Step 1: Add the import**

At the top of `src/lib/stores/grid-projects.ts`, alongside the existing `import type { GridCurtain } from "@/lib/design/grid-bom";`:

```ts
import type { QuickScopeInputs } from "@/app/(app)/design/quick/engine";
```

- [ ] **Step 2: Add the field to `GridProject`**

In the `GridProject` type (grid-projects.ts:129–152), add after the `quoteId` field:

```ts
  /** Live-revisable basic-info snapshot (D-manual-scope-targets) — venue,
   *  size, dimensions, systems-in-scope. `null` until the Scope panel's
   *  inputs are filled in at least once; never a one-time creation step, it
   *  stays editable for the project's life and target $ is always computed
   *  fresh from whatever this currently holds. Absent on pre-D-manual-scope
   *  docs, read as null. */
  scopeInputs: QuickScopeInputs | null;
```

- [ ] **Step 3: Default it to `null` in `createProject`**

In `createProject` (grid-projects.ts:186–208), add `scopeInputs: null,` to the returned object, next to `quoteId: null,`.

- [ ] **Step 4: Add the mutator, right after `setVenue`**

```ts
export async function setScopeInputs(
  projectId: string,
  scopeInputs: QuickScopeInputs | null
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.scopeInputs = scopeInputs;
    p.updatedAt = Date.now();
  });
}
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
```

Expect a new error surface in `src/app/(app)/design/grid/[id]/page.tsx` (the `ProjectLite` object literal built there doesn't include `scopeInputs` yet) and/or in `editor.tsx`'s `ProjectLite` type — this is expected and gets fixed in Task 8. If `tsc` reports errors ONLY in those two files (and nowhere else), that confirms Steps 1–4 are correct; do not fix them yet.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/grid-projects.ts
git commit -m "feat(grid): add scopeInputs field to GridProject"
```

---

### Task 5: `setScopeInputsAction` server action

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/actions.ts`

**Interfaces:**
- Consumes: `setScopeInputs` (Task 4), `QuickScopeInputs` (Task 1).
- Produces: `setScopeInputsAction(projectId, scopeInputs): Promise<Result>` — consumed by Task 7 (`ScopePanel`).

- [ ] **Step 1: Add the import**

In the `from "@/lib/stores/grid-projects"` import block (actions.ts:6–24), add `setScopeInputs` alphabetically (between `setQuote` and `setSheetCalibration`... actually alphabetically it's `setScopeInputs` before `setSheetCalibration` and after `setQuote`; the existing list isn't strictly alphabetical — just add it next to `setVenue` to match the visual grouping of the other "set the project's basic fields" mutators):

```ts
  setQuote,
  setScopeInputs,
  setSheetCalibration,
  setVenue,
```

Also add, alongside the other type-only imports at the top of the file:

```ts
import type { QuickScopeInputs } from "@/app/(app)/design/quick/engine";
```

- [ ] **Step 2: Add the action, right after `setVenueAction`**

```ts
/** Live-revisable basic-info snapshot for the Scope panel
 *  (D-manual-scope-targets) — no validation: any well-typed payload is
 *  accepted, including partial toggles the caller has already merged. */
export async function setScopeInputsAction(
  projectId: string,
  scopeInputs: QuickScopeInputs
): Promise<Result> {
  await requireUser();
  const p = await setScopeInputs(projectId, scopeInputs);
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Expect the same two pre-existing errors from Task 4 Step 5 (unchanged) and no new ones.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/actions.ts"
git commit -m "feat(grid): add setScopeInputsAction"
```

---

### Task 6: Load cost-bearing fabrics for the engine + thread `scopeInputs` through `page.tsx`

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/page.tsx`
- Modify: `DECISIONS.md`

**Interfaces:**
- Consumes: `FabricOption` type (`@/app/(app)/design/quick/engine`).
- Produces: `GridEditor`'s new `fabrics` prop is `FabricOption[]` — wait, **naming collision**: `GridEditor` already has a `fabrics: FabricSell[]` prop (sell-only curtain-drop pricing, editor.tsx:221/232). Name the new one `engineFabrics: FabricOption[]` to keep the two straight — consumed by Task 8 (passed into `ScopePanel`, which passes it to `scopeTargets()`).

This task deliberately crosses a boundary the Grid editor's `page.tsx` doc comment currently protects: "These are SELL numbers only - the margin and the cost basis stay on the server (lib/design/curtain-pricing is never imported by the editor)" (page.tsx:94–97). `engine.ts`'s `compute()`/`tierSystems()` pipeline (which `scopeTargets()` — Task 1 — calls) imports `curtain-pricing.ts` and bakes in `SEED_FABRIC_RATES`/`TIER_SKUS` cost data at module scope, same as it already does for Quick Design's client bundle. Shipping `engine.ts` into the Grid editor's client bundle (via `ScopeInputsPanel`/`ScopePanel`, Tasks 2 and 7) means that cost data now also ships in the Grid bundle. This is a deliberate, scoped exception — not a new class of exposure, since anyone who can reach Manual mode can already reach `/design/quick` and get the same data today — but it must be logged per this repo's convention (AGENTS.md: "Deviations get DECISIONS.md entry").

- [ ] **Step 1: Add the `FabricOption` import**

In `src/app/(app)/design/grid/[id]/page.tsx`, alongside the existing `import type { FabricSell } from "@/lib/curtain-geom";`:

```ts
import type { FabricOption } from "@/app/(app)/design/quick/engine";
```

- [ ] **Step 2: Derive `engineFabrics` from the already-loaded `catalog`**

Right after the existing `fabrics` (`FabricSell[]`) derivation (page.tsx:100–107), add:

```ts
  // Cost-bearing fabric rows for the Scope panel's target $ math
  // (D-manual-scope-targets, engine.ts scopeTargets — see DECISIONS.md).
  const engineFabrics: FabricOption[] = catalog
    .filter((p) => p.category === "Fabric")
    .map((p) => ({ sku: p.sku, desc: p.desc, costPerSqft: p.costPerSqft ?? null }));
```

- [ ] **Step 3: Pass `scopeInputs` through `ProjectLite` and `engineFabrics` as a new prop**

In the `<GridEditor project={{ ... }} ... />` call (page.tsx:124–153):
- Add `scopeInputs: project.scopeInputs,` to the `project={{ ... }}` object literal, next to `quoteId: project.quoteId,`.
- Add `engineFabrics={engineFabrics}` as a new prop on `<GridEditor>`, next to the existing `fabrics={fabrics}`.

- [ ] **Step 4: Log the decision**

Append to `DECISIONS.md` (find the current highest `## D1NN` heading first — as of this plan it's D138, so this is D139; re-check with `grep -n "^## D1" DECISIONS.md | tail -3` in case another task landed since):

```markdown

## D139. Grid Manual mode's Scope panel reuses Quick Design's cost-bearing estimate engine (2026-09-20)

Manual mode's new Scope panel (D-manual-scope-targets spec) computes its
Good/Better/Best $ targets by running the SAME `compute()`/`tierSystems()`
pipeline Quick Design's Auto estimate already uses, per the design spec's
explicit direction ("Both Auto and Manual... run that input through the
same compute()/tierSystems() engine"). `engine.ts` bakes in cost data
(`SEED_FABRIC_RATES`, `TIER_SKUS`) at module scope for Quick Design's own
client bundle already; pulling `ScopeInputsPanel`/`ScopePanel` into the
Grid editor now ships that same cost data in the Grid bundle too — crossing
the sell-only boundary `grid/[id]/page.tsx` otherwise deliberately protects
("SELL numbers only - the margin and the cost basis stay on the server").

Accepted as-is rather than building a parallel sell-safe target engine:
anyone who can reach Manual mode can already reach `/design/quick` and see
the same numbers today, so this doesn't create a new exposure, only a
second place the existing one shows up. Revisit if Manual mode ever gets a
permission boundary Quick Design doesn't have.
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
```

Expect the same pre-existing `ProjectLite`/editor errors from Task 4 (now including a missing `engineFabrics` prop error on `<GridEditor>` too, since `GridEditor`'s props type doesn't accept it yet) — fixed in Task 8.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/page.tsx" DECISIONS.md
git commit -m "feat(grid): load cost-bearing fabrics for the Scope panel's target math; log D139"
```

---

### Task 7: `ScopePanel` — Grid sidebar component

**Files:**
- Create: `src/app/(app)/design/grid/[id]/scope-panel.tsx`

**Interfaces:**
- Consumes: `ScopeInputsPanel` (Task 2), `scopeTargets` (Task 1), `QuickScopeInputs`/`TierKey`/`TierDefs`/`FabricOption`/`SysKey`/`TIERS`/`defaultAState` (`@/app/(app)/design/quick/engine`), `getAccentHex`/`getAccentHexServer`/`getTierDefs`/`getTierDefsServer`/`subscribeAccent`/`subscribeTierDefs` (`@/app/(app)/design/quick/tierdefs-store`), `setScopeInputsAction` (Task 5), `RollupSlice` (`@/lib/design/grid-bom`), `SCOPE_COLORS`/`scopeColor`/`GRID_LAYERS` (`@/lib/design/grid-scopes`).
- Produces: default export `ScopePanel(props)` — consumed by Task 8 (`editor.tsx`).

This mirrors `spaces-panel.tsx`'s shape (client component, own `BTN`/local styles, calls a server action, `onChanged`/`onError` callbacks) — read `src/app/(app)/design/grid/[id]/spaces-panel.tsx` once before writing this file for the panel-chrome conventions (the `PANEL`/`PANEL_LABEL` style constants actually live in `editor.tsx`, not `spaces-panel.tsx` — `spaces-panel.tsx` defines its own inline `background/border/borderRadius/padding` wrapper div instead of importing them; follow that same self-contained pattern here).

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import {
  SHORT,
  SYS_ORDER,
  TIERS,
  scopeTargets,
  type FabricOption,
  type QuickScopeInputs,
  type SysKey,
  type TierKey,
} from "@/app/(app)/design/quick/engine";
import {
  getAccentHex,
  getAccentHexServer,
  getTierDefs,
  getTierDefsServer,
  subscribeAccent,
  subscribeTierDefs,
} from "@/app/(app)/design/quick/tierdefs-store";
import ScopeInputsPanel from "@/components/design/scope-inputs-panel";
import type { RollupSlice } from "@/lib/design/grid-bom";
import { scopeColor } from "@/lib/design/grid-scopes";
import { setScopeInputsAction } from "./actions";

/**
 * Grid Manual mode's Scope panel (D-manual-scope-targets) — the same
 * venue/size/dims/systems basic-info intake Quick Design uses, restricted
 * to the 5 catalog-trackable systems, plus a Good/Better/Best lens and one
 * placed-$-vs-target-$ progress row per in-scope system. A goalpost, never a
 * gate: nothing here blocks placement, and everything recomputes live from
 * whatever `scopeInputs` currently holds.
 */

/** GRID_SCOPES (grid-scopes.ts), in Quick Design's SysKey vocabulary — the
 *  only 5 systems Manual mode can track placement against, because
 *  scopeOfPart (grid-scopes.ts) only ever resolves to one of these 5 or
 *  Unscoped. Quick Design keeps all 8 of its own systems unchanged. */
const TRACKABLE_SYS_KEYS: SysKey[] = ["lighting", "rigging", "curtains", "audio", "video"];

const BTN: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function ProgressRow({ label, color, placed, target }: { label: string; color: string; placed: number; target: number }) {
  const pct = target > 0 ? Math.min(1, placed / target) : placed > 0 ? 1 : 0;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "#3d424e" }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "0 0 auto" }} />
          {label}
        </span>
        <span style={{ color: "#8c919c" }}>
          {moneyFmt(placed)} {target > 0 ? `/ ${moneyFmt(target)}` : "· no target"}
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "#edeff3", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct * 100}%`, background: color, transition: "width .2s" }} />
      </div>
    </div>
  );
}

export default function ScopePanel({
  projectId,
  scopeInputs,
  byScope,
  engineFabrics,
  onChanged,
  onError,
}: {
  projectId: string;
  scopeInputs: QuickScopeInputs | null;
  /** Whole-project placed $/count per scope, from bomBySpace(placements,
   *  parts, [], curtainPrices) — see editor.tsx. */
  byScope: RollupSlice[];
  engineFabrics: FabricOption[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [tierKey, setTierKey] = useState<TierKey>("better");
  const tierDefs = useSyncExternalStore(subscribeTierDefs, getTierDefs, getTierDefsServer);
  const accentHex = useSyncExternalStore(subscribeAccent, getAccentHex, getAccentHexServer);

  const save = (patch: Partial<QuickScopeInputs>) => {
    const base: QuickScopeInputs = scopeInputs ?? {
      venue: "concenter",
      size: "large",
      width: 50,
      depth: 30,
      grid: 50,
      wing: 10,
      ph: 20,
      sys: { rigging: false, curtains: false, lighting: false, controls: false, audio: false, video: false, acoustical: false, pit: false },
      rigType: "motorized",
      drape: {},
      fixtures: {},
      fixtureAssemblies: {},
      ctrl: {},
      shell: {},
      pitType: "clearspan",
    };
    const next = { ...base, ...patch };
    startTransition(async () => {
      const r = await setScopeInputsAction(projectId, next);
      if (!r.ok) onError(r.error);
      else onChanged();
    });
  };

  const targets = useMemo(() => {
    if (!scopeInputs) return {};
    return scopeTargets(scopeInputs, tierKey, tierDefs, engineFabrics);
  }, [scopeInputs, tierKey, tierDefs, engineFabrics]);

  const placedByKey = new Map(byScope.map((s) => [s.key, s]));
  const trackedKeys = SYS_ORDER.filter((k) => TRACKABLE_SYS_KEYS.includes(k) && scopeInputs?.sys[k]);
  const untracked = byScope
    .filter((s) => !trackedKeys.some((k) => SHORT[k] === s.key || s.key === scopeColor.name))
    .reduce((sum, s) => sum + s.value, 0);

  return (
    <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab" }}>
          Scope
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {TIERS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTierKey(t.key)}
              style={{ ...BTN, padding: "3px 8px", fontSize: 10.5, background: tierKey === t.key ? "#16181d" : "#fff", color: tierKey === t.key ? "#fff" : "#3d424e", borderColor: tierKey === t.key ? "#16181d" : "#dfe2e8" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <ScopeInputsPanel
        value={
          scopeInputs ?? {
            venue: "concenter",
            size: "large",
            width: 50,
            depth: 30,
            grid: 50,
            wing: 10,
            ph: 20,
            sys: { rigging: false, curtains: false, lighting: false, controls: false, audio: false, video: false, acoustical: false, pit: false },
            rigType: "motorized",
            drape: {},
            fixtures: {},
            fixtureAssemblies: {},
            ctrl: {},
            shell: {},
            pitType: "clearspan",
          }
        }
        onChange={save}
        systems={TRACKABLE_SYS_KEYS}
        accentHex={accentHex}
      />

      {!scopeInputs && (
        <div style={{ fontSize: 11, color: "#8c919c", marginTop: 6 }}>
          No target set yet — fill in the basics above to see placed-vs-target per system.
        </div>
      )}

      {trackedKeys.length > 0 && (
        <div style={{ marginTop: 14, display: "grid", gap: 10, borderTop: "1px solid #edeff3", paddingTop: 10 }}>
          {trackedKeys.map((k) => {
            const placed = placedByKey.get(SHORT[k])?.value || 0;
            return <ProgressRow key={k} label={SHORT[k]} color={placedByKey.get(SHORT[k]) ? "#3d424e" : "#8c919c"} placed={placed} target={targets[k] || 0} />;
          })}
        </div>
      )}

      {untracked > 0 && (
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#8c919c", borderTop: "1px solid #edeff3", paddingTop: 8 }}>
          <span>Untracked</span>
          <span>{moneyFmt(untracked)}</span>
        </div>
      )}

      {pending && <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 6 }}>Saving…</div>}
    </div>
  );
}
```

**A bug to fix during Step 1, not paper over:** the `untracked` calculation above (`!trackedKeys.some((k) => SHORT[k] === s.key || s.key === scopeColor.name)`) is wrong — `scopeColor` is a function, `scopeColor.name` is the JS function's `.name` property (`"scopeColor"`), not a scope name. Fix it to: everything in `byScope` whose `key` does NOT match one of `trackedKeys`' `SHORT[k]` labels rolls into Untracked (this correctly captures both (a) a trackable scope that isn't currently toggled on, and (b) `"Unscoped"`, since `"Unscoped"` never equals any `SHORT[k]` value):

```ts
  const trackedLabels = new Set(trackedKeys.map((k) => SHORT[k]));
  const untracked = byScope.filter((s) => !trackedLabels.has(s.key)).reduce((sum, s) => sum + s.value, 0);
```

Replace the `placedByKey`/`untracked` block in Step 1's code with this corrected version before saving the file (delete the `const untracked = byScope.filter(...scopeColor.name...)` line entirely and use the two lines above instead; `placedByKey` stays as written).

Also delete the now-unused `scopeColor` import if nothing else in the file uses it after this fix (check: the `ProgressRow` component takes `color` as a plain prop, and `ScopePanel` passes a hardcoded `"#3d424e"`/`"#8c919c"` today rather than `scopeColor(...)` — **improve this** while fixing the bug: pass `SCOPE_COLORS[SHORT[k] as GridLayer]`-style real per-scope colors instead of the flat gray/dark-gray placeholder, using `scopeColor` from `grid-scopes.ts` (already imported) keyed by the GRID_SCOPES label, e.g. `scopeColor(SHORT[k])`. Since `SHORT[k]` for the 5 trackable keys (`"Rigging"`, `"Curtains"`, `"Fixtures"`, `"Audio"`, `"Video"`) does **not** match `GRID_SCOPES`' labels 1:1 (`SHORT.lighting === "Fixtures"` but `GRID_SCOPES` uses `"Lighting"`), build a small local map instead:

```ts
const SYS_TO_GRID_SCOPE: Partial<Record<SysKey, string>> = {
  lighting: "Lighting",
  rigging: "Rigging",
  curtains: "Curtains",
  audio: "Audio",
  video: "Video",
};
```

and use `scopeColor(SYS_TO_GRID_SCOPE[k]!)` for `ProgressRow`'s `color` prop, and `placedByKey.get(SYS_TO_GRID_SCOPE[k]!)` instead of `placedByKey.get(SHORT[k])` (since `byScope`'s `key`s are `GridLayer` values — `"Lighting"`/`"Rigging"`/etc., from `scopeOfPart`/`bomBySpace`, NOT `SHORT`'s `"Fixtures"` label). This also means the `trackedLabels`/`untracked` fix above must key off `SYS_TO_GRID_SCOPE[k]`, not `SHORT[k]`:

```ts
  const trackedLabels = new Set(trackedKeys.map((k) => SYS_TO_GRID_SCOPE[k]!));
  const untracked = byScope.filter((s) => !trackedLabels.has(s.key)).reduce((sum, s) => sum + s.value, 0);
```

Go back through the full Step 1 file body and apply this `SYS_TO_GRID_SCOPE`-keyed lookup consistently everywhere `SHORT[k]` was used as a `byScope` key (the `placedByKey.get(...)` call inside the `trackedKeys.map(...)` render, and the `untracked` calc) — `SHORT[k]` stays correct only for the row **label** text itself (`<ProgressRow label={SHORT[k]} ...>`), since that's the human-readable system name, not a scope lookup key.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expect no new errors in `scope-panel.tsx` itself. (It isn't imported by `editor.tsx` yet — that's Task 8 — so `GridEditor`'s pre-existing Task 4/6 errors remain, unchanged.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/scope-panel.tsx"
git commit -m "feat(grid): add ScopePanel — Scope sidebar with placed-vs-target tracking"
```

---

### Task 8: Wire `ScopePanel` into the Grid editor

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx`

**Interfaces:**
- Consumes: `ScopePanel` (Task 7), `bomBySpace` (already imported), `GridEditor`'s new `engineFabrics: FabricOption[]` prop (Task 6).

- [ ] **Step 1: Add the import**

Alongside the other panel imports (editor.tsx:61–65):

```tsx
import ScopePanel from "./scope-panel";
```

And add the `FabricOption` type import alongside the other `@/app/(app)/design/quick/engine`... actually there is no existing import from `engine.ts` in `editor.tsx` — add a new import line near the top, after the `grid-scopes` import (editor.tsx:32–41):

```tsx
import type { FabricOption } from "@/app/(app)/design/quick/engine";
```

- [ ] **Step 2: Extend `ProjectLite` and the component's props type**

In `ProjectLite` (editor.tsx:198–210), add:

```ts
  scopeInputs: QuickScopeInputs | null;
```

This needs `QuickScopeInputs` imported too — add it to the same new import line from Step 1:

```tsx
import type { FabricOption, QuickScopeInputs } from "@/app/(app)/design/quick/engine";
```

In the `GridEditor` component's props destructure and type (editor.tsx:217–243), add a new `engineFabrics` prop:

```ts
export default function GridEditor({
  project,
  sheets,
  parts,
  fabrics,
  engineFabrics,
  curtainCoeffs,
  laborParts,
  laborHoursPerDevice,
  specHref,
  venues,
}: {
  project: ProjectLite;
  sheets: SheetLite[];
  parts: PartLite[];
  /** Catalog fabric rows with SELL price/sq ft (punch #49) - never cost. */
  fabrics: FabricSell[];
  /** Cost-bearing fabric rows for the Scope panel's target $ math only
   *  (D-manual-scope-targets, see DECISIONS.md D139). */
  engineFabrics: FabricOption[];
  /** Sell-side making coefficients for the live curtain price (punch #49). */
  curtainCoeffs: SellCoeffs;
  /** Catalog labor rows (role "labor") for the auto-suggest (D114). */
  laborParts: LaborPartLite[];
  /** Install-hours-per-device knob from the pricing rules. */
  laborHoursPerDevice: number;
  /** D94 bid-spec generator for this customer's engagement, when one exists. */
  specHref: string | null;
  /** The customer's venues, for the picker (D113.6). */
  venues: Array<{ id: string; name: string }>;
}) {
```

- [ ] **Step 3: Compute the whole-project scope rollup**

Right after the existing `spaceRollups` useMemo (editor.tsx, in the block around what the earlier research read as lines 525–528: `bomBySpace(project.placements, parts, project.spaces || [], curtainPrices)`), add:

```ts
  /** Whole-project placed $/count by scope (D-manual-scope-targets) — the
   *  Scope panel's "placed" column. Reuses bomBySpace with an EMPTY spaces
   *  array: every placement then falls into the single "Unassigned" bucket
   *  bomBySpace already produces for placements outside any space, which is
   *  exactly the whole-project total when there are no spaces to filter by.
   *  Cheap: same inputs spaceRollups already recomputes on, one more pass. */
  const projectScopeRollup = useMemo(
    () => bomBySpace(project.placements, parts, [], curtainPrices)[0] ?? null,
    [project.placements, parts, curtainPrices]
  );
```

- [ ] **Step 4: Render `ScopePanel` in the sidebar**

In the sidebar panel stack (editor.tsx, right before `<LayersPanel ... />` at the earlier research's line 1262), add:

```tsx
          {/* scope targets (D-manual-scope-targets) */}
          <ScopePanel
            projectId={project.id}
            scopeInputs={project.scopeInputs}
            byScope={projectScopeRollup?.byScope || []}
            engineFabrics={engineFabrics}
            onChanged={() => router.refresh()}
            onError={(m) => setErr(m)}
          />

```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
```

Expect zero errors anywhere in the project now — this closes out the pre-existing `ProjectLite`/`GridEditor` prop errors from Tasks 4 and 6.

```bash
npm run lint
```

Expect zero errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/editor.tsx"
git commit -m "feat(grid): render ScopePanel in the Grid editor sidebar"
```

---

### Task 9: Manual verification + smoke test

**Files:** none (verification only).

- [ ] **Step 1: Confirm no stray dev/seed processes are already holding the PGlite datadir**

```bash
ps aux | grep -i "next dev\|tsx scripts" | grep -v grep
```

If anything is running against this worktree's `.data/`, stop before continuing (per AGENTS.md's single-process PGlite rule) — do not start a second `npm run dev`.

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

Wait for `✓ Ready in ...ms`.

- [ ] **Step 3: Manually exercise Quick Design (Auto) — confirm no regression**

Open `http://localhost:3000/design/quick` in a browser. Confirm:
- The "Design inputs" panel renders identically to before this plan (venue grid, size row, dimension sliders, systems toggle list with sub-config chips and the lighting fixture-assembly dropdown when a fixture-assemblies system exists).
- Toggling a venue, size, dimension, and a system (e.g. Lighting on/off, then a chip like "Par") updates the live estimate/BOM exactly as before.
- Collapsing/expanding each of the 4 sub-sections (venue/size/dims/systems) still works.

- [ ] **Step 4: Manually exercise Grid Manual mode — new Scope panel**

From `/design/designs`, start a new "Manual layout · The Grid" design (or open an existing Grid project at `/design/grid/<id>`). Confirm:
- A "Scope" panel appears in the sidebar, above Layers, showing the "No target set yet" message and the basic-info inputs (restricted to Lighting/Rigging/Curtains/Audio/Video — Controls/Acoustical/Pit must NOT appear in this list).
- Setting a venue/size/dimensions and toggling a system on persists after a page refresh (confirms `setScopeInputsAction`/`patchDoc` round-trips).
- With at least one trackable system toggled on, a progress row appears for it showing `$0 / $<target>` (no placements yet).
- Place a catalog device belonging to that system's scope (e.g. a Lighting-group part) on the plan; the progress row's placed $ increases and the bar fills proportionally.
- Place a device whose scope is NOT currently toggled on (or an Unscoped part); confirm it shows up in the "Untracked" row instead, with no error and no placement blocked.
- Toggle the Good/Better/Best lens at the top of the panel; confirm every row's target $ changes while placed $ stays fixed.
- Confirm nothing about existing placement, Spaces, Wires, or Revisions functionality broke (spot-check one action from each of those panels).

- [ ] **Step 5: Run the smoke test suite**

```bash
npm run test:smoke
```

Expect all routes to still return healthy status codes, including `/design/quick` and `/design/grid/<id>` for a seeded project id (check the script's output for which ids it exercises).

- [ ] **Step 6: Stop the dev server**

Stop the process you started in Step 2 before ending the session (per AGENTS.md: "Never leave a `tsx`/dev script running").

- [ ] **Step 7: Final commit (if Step 4's manual pass surfaced fixes)**

If manual testing in Step 4 required any code fixes, commit them now with a message describing what was wrong and fixed. If no fixes were needed, this task has no commit of its own — Task 8's commit is the last one.

---

## Self-Review Notes

- **Spec coverage:** "Data model" → Task 4 (`scopeInputs` field, live-editable, no frozen snapshot). "Trackable systems" → Task 7's `TRACKABLE_SYS_KEYS` allowlist. "Shared basic-info component" → Tasks 2/3 (Auto keeps all systems) and Task 7 (Manual gets 5, same panel used at creation-skip and every later visit — no separate wizard). "Scope panel — tracking UI" → Task 7 (progress bars, tier lens, Untracked row). "What does not change" → explicitly preserved: Auto/Quick Design untouched by Tasks 4–9, `createDraftQuoteAction` untouched, no validation/locking added anywhere in this plan.
- **Deliberate spec deviation, called out explicitly:** this plan does not change `createManualDesignAction`'s signature (Global Constraints section explains why — YAGNI given "skipping is allowed" and no creation-wizard requirement). Flag this to the user/reviewer if a creation-time prompt turns out to be wanted after all; it's a small follow-up (thread an optional `scopeInputs` param through `createManualDesignAction` → `createProject`, both already accept exactly this shape via Task 4).
- **Cost/sell boundary deviation:** logged as DECISIONS.md D139 in Task 6, per AGENTS.md convention — not swept under the rug.
