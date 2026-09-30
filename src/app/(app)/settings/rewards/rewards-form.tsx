"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  REWARD_LEVELS,
  REWARD_LEVEL_LABEL,
  THRESHOLD_LEVELS,
  rewardsProgramErrors,
  type RewardLevel,
  type RewardsProgram,
  type ThresholdLevel,
} from "@/lib/rewards/program";
import { saveRewardsProgramAction } from "./actions";

/**
 * Settings → Rewards form (#282 Phase 1). Whole-program save; a save resets
 * the form to what the server stored (sanitized). Inputs stay strings while
 * typing — the server sanitizes and validates.
 */

type Draft = {
  enabled: boolean;
  thresholds: Record<ThresholdLevel, string>;
  earnPct: Record<RewardLevel, string>;
  ratePct: string;
  cap: string;
};

function draftOf(p: RewardsProgram): Draft {
  return {
    enabled: p.enabled,
    thresholds: Object.fromEntries(THRESHOLD_LEVELS.map((l) => [l, String(p.thresholds[l])])) as Draft["thresholds"],
    earnPct: Object.fromEntries(REWARD_LEVELS.map((l) => [l, String(p.earnPct[l])])) as Draft["earnPct"],
    ratePct: String(p.retro.ratePct),
    cap: String(p.retro.capPerCustomer),
  };
}

const n = (s: string) => Number(String(s).replace(/[$,\s]/g, ""));

function inputOf(d: Draft) {
  return {
    enabled: d.enabled,
    thresholds: Object.fromEntries(THRESHOLD_LEVELS.map((l) => [l, n(d.thresholds[l])])) as Record<ThresholdLevel, number>,
    earnPct: Object.fromEntries(REWARD_LEVELS.map((l) => [l, n(d.earnPct[l])])) as Record<RewardLevel, number>,
    retro: { ratePct: n(d.ratePct), capPerCustomer: n(d.cap) },
  };
}

const field: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "7px 9px",
  background: "#fff",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
const lbl: CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 5 };
const section: CSSProperties = { padding: "16px 18px", borderBottom: "1px solid #f0f1f4" };
const head: CSSProperties = { fontSize: 13.5, fontWeight: 600, marginBottom: 4 };
const sub: CSSProperties = { fontSize: 12, color: "#8c919c", marginBottom: 12, lineHeight: 1.5 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12 };

export function RewardsProgramForm({ program }: { program: RewardsProgram }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => draftOf(program));
  const [d, setD] = useState<Draft>(() => draftOf(program));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);

  const edit = (patch: Partial<Draft>) => {
    setJustSaved(false);
    setError(null);
    setD((cur) => ({ ...cur, ...patch }));
  };

  const onSave = () => {
    const input = inputOf(d);
    const errs = rewardsProgramErrors(input);
    if (errs.length) {
      setError(errs.join(" "));
      return;
    }
    startTransition(async () => {
      const res = await saveRewardsProgramAction(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const next = draftOf(res.program);
      setSaved(next);
      setD(next);
      setJustSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ ...section, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div>
          <div style={head}>Program</div>
          <div style={{ ...sub, marginBottom: 0 }}>
            {program.launchedAt
              ? `First turned on ${new Date(program.launchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`
              : "Never turned on yet."}{" "}
            While off, nothing shows on company records and no suggestion can be approved.
          </div>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={d.enabled}
            onChange={(e) => edit({ enabled: e.target.checked })}
            aria-label="Rewards program on"
          />
          {d.enabled ? "On" : "Off"}
        </label>
      </div>

      <div style={section}>
        <div style={head}>Levels</div>
        <div style={sub}>Lifetime purchases needed to earn each level. Each must be more than the one before it.</div>
        <div style={grid}>
          {THRESHOLD_LEVELS.map((l) => (
            <label key={l}>
              <span style={lbl}>{REWARD_LEVEL_LABEL[l]} ($)</span>
              <input
                style={field}
                inputMode="decimal"
                value={d.thresholds[l]}
                onChange={(e) => edit({ thresholds: { ...d.thresholds, [l]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      </div>

      <div style={section}>
        <div style={head}>Credit earned</div>
        <div style={sub}>
          Percent of each won quote a customer earns as account credit, by their level at the time of the win (0–20 %).
          Posted when a quote is won (reversed if it leaves Won); staff spend it with Apply credit in the Estimator.
        </div>
        <div style={grid}>
          {REWARD_LEVELS.map((l) => (
            <label key={l}>
              <span style={lbl}>{REWARD_LEVEL_LABEL[l]} (%)</span>
              <input
                style={field}
                inputMode="decimal"
                value={d.earnPct[l]}
                onChange={(e) => edit({ earnPct: { ...d.earnPct, [l]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      </div>

      <div style={section}>
        <div style={head}>Starting credit</div>
        <div style={sub}>A one-time credit from purchases before launch: this percent of that history, up to the cap per customer.</div>
        <div style={grid}>
          <label>
            <span style={lbl}>Rate (%)</span>
            <input style={field} inputMode="decimal" value={d.ratePct} onChange={(e) => edit({ ratePct: e.target.value })} />
          </label>
          <label>
            <span style={lbl}>Cap per customer ($)</span>
            <input style={field} inputMode="decimal" value={d.cap} onChange={(e) => edit({ cap: e.target.value })} />
          </label>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", flexWrap: "wrap" }}>
        <button
          type="button"
          className="pk-btn-accent"
          disabled={!dirty || pending}
          onClick={onSave}
          style={{ opacity: !dirty || pending ? 0.55 : 1 }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {dirty && !pending && (
          <button type="button" className="pk-btn-outline" onClick={() => edit(saved)}>
            Reset
          </button>
        )}
        {justSaved && !dirty && <span style={{ fontSize: 12, color: "#1f7a52" }}>Saved.</span>}
        {error && <span style={{ fontSize: 12, color: "#b4543a" }}>{error}</span>}
      </div>
    </div>
  );
}
