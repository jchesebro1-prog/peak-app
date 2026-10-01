"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { PERK_POINTS_ONLY, REWARD_LEVELS, REWARD_LEVEL_LABEL, type Perk } from "@/lib/rewards/program";
import { PERK_FREQUENCY_LABEL, perkDraftErrors, type PerkDraft } from "@/lib/rewards/perks";
import { savePerksAction } from "./actions";

/**
 * Settings → Rewards → Perks (#282 phase 4, spec §6). Add / edit / remove /
 * reorder, one Save for the whole list. New rows carry a temporary `new:<n>`
 * id — the server mints the real one (never a removed perk's). Removing a
 * perk keeps it server-side as a tombstone so past uses keep their name.
 */

type Row = PerkDraft & { key: string };

function rowsOf(perks: Perk[]): Row[] {
  return perks
    .filter((p) => !p.removed)
    .map((p) => ({
      key: p.id,
      id: p.id,
      name: p.name,
      description: p.description,
      level: p.level ?? PERK_POINTS_ONLY,
      frequency: p.frequency,
      active: p.active,
      pointCost: p.pointCost != null ? String(p.pointCost) : "",
    }));
}

const strip = (rows: Row[]): PerkDraft[] =>
  rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    level: r.level,
    frequency: r.frequency,
    active: r.active,
    pointCost: r.pointCost == null ? "" : String(r.pointCost).trim(),
  }));

const field: CSSProperties = {
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "7px 9px",
  background: "#fff",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const lbl: CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 5 };
const tiny: CSSProperties = { fontSize: 11.5, padding: "4px 9px" };

let seq = 0;

export function PerksEditor({ perks }: { perks: Perk[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Row[]>(() => rowsOf(perks));
  const [rows, setRows] = useState<Row[]>(() => rowsOf(perks));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(strip(rows)) !== JSON.stringify(strip(saved));
  const removedCount = perks.filter((p) => p.removed).length;

  const touch = () => {
    setJustSaved(false);
    setError(null);
  };
  const patch = (key: string, p: Partial<Row>) => {
    touch();
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));
  };
  const move = (i: number, d: -1 | 1) => {
    touch();
    setRows((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const remove = (key: string) => {
    touch();
    setRows((cur) => cur.filter((r) => r.key !== key));
  };
  const add = () => {
    touch();
    seq += 1;
    const key = `new:${Date.now().toString(36)}${seq}`;
    setRows((cur) => [...cur, { key, id: key, name: "", description: "", level: "base", frequency: "once", active: true, pointCost: "" }]);
  };

  const onSave = () => {
    const drafts = strip(rows);
    const errs = perkDraftErrors(drafts);
    if (errs.length) {
      setError(errs.join(" "));
      return;
    }
    startTransition(async () => {
      const res = await savePerksAction(drafts);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const next = rowsOf(res.program.perks);
      setSaved(next);
      setRows(next);
      setJustSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ padding: 0, overflow: "hidden" }} id="perks">
      <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Perks</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3, lineHeight: 1.5 }}>
          Benefits a customer unlocks at a reward level (Base = every customer) — free once the level is reached. Give a
          perk a point price and customers below that level (or every customer, for a points-only perk) can buy it with
          their rewards points (1 point = $1 of credit). Customers redeem perks in the portal; staff Redeem or Mark used on
          the company record. A once perk is then gone, a yearly perk comes back 365 days after its last use.
          {removedCount > 0 && ` ${removedCount} removed ${removedCount === 1 ? "perk is" : "perks are"} kept for past uses.`}
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "20px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>No perks yet.</div>
      ) : (
        rows.map((r, i) => (
          <div key={r.key} data-testid="perk-row" style={{ padding: "14px 18px", borderBottom: "1px solid #f0f1f4", opacity: r.active ? 1 : 0.7 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,0.8fr)", gap: 12 }}>
              <label>
                <span style={lbl}>Name</span>
                <input
                  style={field}
                  value={r.name}
                  maxLength={120}
                  placeholder="e.g. Free annual rigging inspection"
                  aria-label={`Perk ${i + 1} name`}
                  onChange={(e) => patch(r.key, { name: e.target.value })}
                />
              </label>
              <label>
                <span style={lbl}>Unlocks at</span>
                <select
                  style={field}
                  value={r.level}
                  aria-label={`Perk ${i + 1} level`}
                  onChange={(e) => patch(r.key, { level: e.target.value })}
                >
                  {REWARD_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l === "base" ? "Base (everyone)" : REWARD_LEVEL_LABEL[l]}
                    </option>
                  ))}
                  <option value={PERK_POINTS_ONLY}>Never free (points only)</option>
                </select>
              </label>
              <label>
                <span style={lbl}>How often</span>
                <select
                  style={field}
                  value={r.frequency}
                  aria-label={`Perk ${i + 1} frequency`}
                  onChange={(e) => patch(r.key, { frequency: e.target.value })}
                >
                  <option value="once">{PERK_FREQUENCY_LABEL.once}</option>
                  <option value="yearly">{PERK_FREQUENCY_LABEL.yearly}</option>
                </select>
              </label>
              <label>
                <span style={lbl}>Point price</span>
                <input
                  style={{ ...field, fontFamily: "var(--font-mono)" }}
                  value={r.pointCost == null ? "" : String(r.pointCost)}
                  inputMode="numeric"
                  placeholder="Not for sale"
                  aria-label={`Perk ${i + 1} point price`}
                  onChange={(e) => patch(r.key, { pointCost: e.target.value })}
                />
              </label>
            </div>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={lbl}>Description (the customer sees this)</span>
              <textarea
                style={{ ...field, minHeight: 52, resize: "vertical" }}
                value={r.description}
                maxLength={1000}
                aria-label={`Perk ${i + 1} description`}
                onChange={(e) => patch(r.key, { description: e.target.value })}
              />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={r.active}
                  aria-label={`Perk ${i + 1} active`}
                  onChange={(e) => patch(r.key, { active: e.target.checked })}
                />
                Active
              </label>
              <span style={{ flex: 1 }} />
              <button type="button" className="pk-btn-outline" style={tiny} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move perk ${i + 1} up`}>
                ↑
              </button>
              <button
                type="button"
                className="pk-btn-outline"
                style={tiny}
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Move perk ${i + 1} down`}
              >
                ↓
              </button>
              <button type="button" className="pk-btn-outline" style={{ ...tiny, color: "#b4543a" }} onClick={() => remove(r.key)}>
                Remove
              </button>
            </div>
          </div>
        ))
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-outline" onClick={add}>
          + Add perk
        </button>
        <button
          type="button"
          className="pk-btn-accent"
          disabled={!dirty || pending}
          onClick={onSave}
          style={{ opacity: !dirty || pending ? 0.55 : 1 }}
        >
          {pending ? "Saving…" : "Save perks"}
        </button>
        {dirty && !pending && (
          <button
            type="button"
            className="pk-btn-outline"
            onClick={() => {
              touch();
              setRows(saved);
            }}
          >
            Reset
          </button>
        )}
        {justSaved && !dirty && <span style={{ fontSize: 12, color: "#1f7a52" }}>Saved.</span>}
        {error && <span style={{ fontSize: 12, color: "#b4543a" }}>{error}</span>}
      </div>
    </div>
  );
}
