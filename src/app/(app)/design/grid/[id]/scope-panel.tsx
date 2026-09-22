"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
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
 * Scope sidebar panel (D-manual-scope-targets) — Manual mode's placed-$
 * vs. target-$ tracker. Reuses Quick Design's venue/size/dims/systems
 * basic-info inputs (ScopeInputsPanel) to capture a QuickScopeInputs
 * snapshot on the project, then runs the SAME estimating engine
 * (scopeTargets) against it to produce a Good/Better/Best dollar target
 * per in-scope system, and lines that up against what's actually been
 * placed on the sheet (byScope, from bomBySpace) so a designer can see at
 * a glance whether Lighting is over or under budget.
 *
 * Only 5 of the 8 Quick Design systems are catalog-trackable in the Grid
 * (Jeff's five scopes in grid-scopes.ts — Lighting, Rigging, Curtains,
 * Audio, Video); Controls/Acoustical/Pit have no scope of their own and
 * are never toggleable here.
 */

const TRACKABLE_SYS_KEYS: SysKey[] = ["rigging", "curtains", "lighting", "audio", "video"];

/** Neutral empty-state fallback for a fresh project with no scope inputs
 *  saved yet. Deliberately NOT `defaultAState(0)`: that helper's `.sys`
 *  comes pre-toggled on (rigging/curtains/lighting/controls/acoustical/pit
 *  all `true`) which visually contradicts the "Toggle a system above to
 *  track placed $" empty state below (driven by `scopeInputs?.sys[k]`,
 *  which stays false-y until a real scopeInputs doc exists), and it also
 *  carries full `AState`-only fields (`tier`, `placements`, `mode`, …)
 *  that don't belong on a persisted `QuickScopeInputs` document. */
const EMPTY_SCOPE_INPUTS: QuickScopeInputs = {
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

/** SysKey -> the GridLayer (grid-scopes.ts) it corresponds to — the only
 *  correct key for looking a system up in `byScope` (bomBySpace's rollup,
 *  keyed by GridLayer strings like "Lighting"/"Rigging", NOT by SHORT's
 *  display labels like "Fixtures"/"Pit Filler"). */
const SYS_TO_GRID_SCOPE: Partial<Record<SysKey, string>> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  audio: "Audio",
  video: "Video",
};

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
  defaultTier,
  onChanged,
  onError,
}: {
  projectId: string;
  scopeInputs: QuickScopeInputs | null;
  /** Whole-project placed $/count per scope, from bomBySpace(placements,
   *  parts, []) — computed once in editor.tsx. */
  byScope: RollupSlice[];
  engineFabrics: FabricOption[];
  /** Active option's tier (Spec 1) — the lens' initial value, never a gate. */
  defaultTier?: TierKey;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [tierKey, setTierKey] = useState<TierKey>(defaultTier ?? "better");
  const [pending, startTransition] = useTransition();
  const accentHex = useSyncExternalStore(subscribeAccent, getAccentHex, getAccentHexServer);
  const tierDefs = useSyncExternalStore(subscribeTierDefs, getTierDefs, getTierDefsServer);

  // Local optimistic draft (D-manual-scope-targets fix): range-slider
  // dimension fields fire onChange on every drag step, and since the
  // panel's rendered `value` came straight from the server `scopeInputs`
  // prop, the thumb visibly snapped back to the stale server value
  // between each round-trip. `draft` renders immediately; writes to the
  // server are debounced so a fast drag only persists its final value.
  const [draft, setDraft] = useState<QuickScopeInputs | null>(scopeInputs);
  const [prevScopeInputs, setPrevScopeInputs] = useState<QuickScopeInputs | null>(scopeInputs);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True from the moment an edit is made until its debounced write has
  // actually resolved (success or failure). While true, an incoming
  // `scopeInputs` prop change (e.g. from one of the ~17 unrelated
  // `router.refresh()` call sites in editor.tsx) must NOT reset `draft` —
  // that would snap the just-edited control back to the stale
  // pre-edit value even though the debounced write is still in flight
  // and will land correctly a moment later. Plain state (not a ref)
  // because it's read during render, below.
  const [dirty, setDirty] = useState(false);
  // The most recently drafted value that hasn't been sent to the server
  // yet. Cleared once its write actually fires (normal debounce timeout
  // or the unmount flush below) so unmount only re-sends a write that
  // never got a chance to go out. A ref (not state) because it's only
  // ever read from the unmount effect's cleanup, which needs the latest
  // value regardless of when that effect instance was set up.
  const pendingWriteRef = useRef<QuickScopeInputs | null>(null);

  // Reset the draft when the server's scopeInputs changes (derived-state
  // reset during render — avoids the set-state-in-effect cascade), but
  // only when there's no in-flight/unconfirmed edit to protect.
  if (prevScopeInputs !== scopeInputs && !dirty) {
    setPrevScopeInputs(scopeInputs);
    setDraft(scopeInputs);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Flush any edit that was drafted but never made it to the server
      // because the component unmounted inside the debounce window.
      // Best-effort: unmounted, so don't touch component state
      // (onChanged/onError) — just fire-and-forget the write.
      if (pendingWriteRef.current) {
        setScopeInputsAction(projectId, pendingWriteRef.current).catch(() => {});
        pendingWriteRef.current = null;
      }
    };
  }, [projectId]);

  const save = (patch: Partial<QuickScopeInputs>) => {
    const base: QuickScopeInputs = draft ?? EMPTY_SCOPE_INPUTS;
    const next = { ...base, ...patch };
    setDraft(next);
    setDirty(true);
    pendingWriteRef.current = next;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pendingWriteRef.current = null;
      startTransition(async () => {
        try {
          const r = await setScopeInputsAction(projectId, next);
          if (!r.ok) onError(r.error);
          else onChanged();
        } catch (e) {
          onError(e instanceof Error ? e.message : "Save failed — please try again.");
        } finally {
          setDirty(false);
        }
      });
    }, 400);
  };

  const targets = useMemo(() => {
    if (!scopeInputs) return {};
    return scopeTargets(scopeInputs, tierKey, tierDefs, engineFabrics);
  }, [scopeInputs, tierKey, tierDefs, engineFabrics]);

  const placedByKey = new Map(byScope.map((s) => [s.key, s]));
  const trackedKeys = SYS_ORDER.filter((k) => TRACKABLE_SYS_KEYS.includes(k) && scopeInputs?.sys[k]);
  const trackedLabels = new Set(trackedKeys.map((k) => SYS_TO_GRID_SCOPE[k]!));
  const untracked = byScope.filter((s) => !trackedLabels.has(s.key)).reduce((sum, s) => sum + s.value, 0);

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
              style={{
                ...BTN,
                padding: "3px 8px",
                fontSize: 10.5,
                background: tierKey === t.key ? "#16181d" : "#fff",
                color: tierKey === t.key ? "#fff" : "#3d424e",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <ScopeInputsPanel
        value={draft ?? EMPTY_SCOPE_INPUTS}
        onChange={save}
        systems={TRACKABLE_SYS_KEYS}
        accentHex={accentHex}
      />

      <div style={{ marginTop: 11, borderTop: "1px solid #edeff3", paddingTop: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 8 }}>
          Placed vs. target
        </div>
        {trackedKeys.length === 0 ? (
          <div style={{ fontSize: 11, color: "#8c919c" }}>
            Toggle a system above to track placed $ against a target.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {trackedKeys.map((k) => {
              const scopeKey = SYS_TO_GRID_SCOPE[k]!;
              const placed = placedByKey.get(scopeKey)?.value || 0;
              return (
                <ProgressRow key={k} label={SHORT[k]} color={scopeColor(scopeKey)} placed={placed} target={targets[k] || 0} />
              );
            })}
          </div>
        )}

        {untracked > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#8c919c", marginTop: 8 }}>
            <span>Untracked</span>
            <span>{moneyFmt(untracked)}</span>
          </div>
        )}
      </div>

      {pending && <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 6 }}>Saving…</div>}
    </div>
  );
}
