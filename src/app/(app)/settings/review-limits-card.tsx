"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  REVIEW_KINDS,
  applyLimitCells,
  formatLimitInput,
  reviewKindColumn,
  type ReviewKind,
  type ReviewLimits,
} from "@/lib/review-limits";
import { saveReviewLimitsAction } from "./actions";

/**
 * Settings → Admin → Review limits (#242). One row per active teammate, one
 * column per review kind. A cell is blank (always needs review — the
 * default), a dollar amount (the owner's own quote approves itself at or
 * under it), or No limit. The DocumentCategoriesCard idiom: seeded from the
 * server-resolved map, whole-map save, the parent re-keys the card on the
 * saved map so a save remounts it.
 */

type Person = { id: string; name: string };
type Cells = Record<string, Partial<Record<ReviewKind, string>>>;

const thS: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#5b616e",
  textAlign: "left",
  padding: "9px 8px",
  borderBottom: "1px solid #ececf0",
  verticalAlign: "bottom",
  whiteSpace: "nowrap",
};
const tdS: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f5f6f8" };
const cellS: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "6px 8px",
  background: "#fff",
  outline: "none",
  width: 96,
};

function cellsFrom(people: Person[], limits: ReviewLimits): Cells {
  const out: Cells = {};
  for (const p of people) {
    const row: Partial<Record<ReviewKind, string>> = {};
    for (const k of REVIEW_KINDS) row[k.key] = formatLimitInput(limits[p.id]?.[k.key]);
    out[p.id] = row;
  }
  return out;
}

export function ReviewLimitsCard({ people, limits }: { people: Person[]; limits: ReviewLimits }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Cells>(() => cellsFrom(people, limits));
  const [cells, setCells] = useState<Cells>(() => cellsFrom(people, limits));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(cells) !== JSON.stringify(saved);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name || id;

  const edit = (uid: string, kind: ReviewKind, v: string) => {
    setJustSaved(false);
    setError(null);
    setCells((c) => ({ ...c, [uid]: { ...c[uid], [kind]: v } }));
  };

  const onSave = () => {
    const res = applyLimitCells(limits, cells, nameOf);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await saveReviewLimitsAction(res.limits);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(cells);
      setJustSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Review limits</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 4, lineHeight: 1.5 }}>
          A quote approves itself when its owner has a limit for its kind and the total is at or under it. Leave a
          cell blank to always require review, type a dollar amount, or type No limit. Over the limit, any approver
          reviews it as today.
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 1180, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...thS, paddingLeft: 18 }}>Person</th>
              {REVIEW_KINDS.map((k) => (
                <th key={k.key} style={thS}>
                  {k.group}
                  {k.sub && <span style={{ display: "block", fontWeight: 500, color: "#9aa0ab" }}>{k.sub}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td style={{ ...tdS, paddingLeft: 18, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{p.name}</td>
                {REVIEW_KINDS.map((k) => (
                  <td key={k.key} style={tdS}>
                    <input
                      style={cellS}
                      value={cells[p.id]?.[k.key] ?? ""}
                      list="review-limit-presets"
                      placeholder="Review"
                      aria-label={`${p.name} — ${reviewKindColumn(k.key)}`}
                      onChange={(e) => edit(p.id, k.key, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="review-limit-presets">
        <option value="No limit" />
      </datalist>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={onSave}>
          {pending ? "Saving…" : "Save limits"}
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "#b03a2e" }}>
            {error}
          </span>
        )}
        {justSaved && !dirty && <span style={{ fontSize: 12, color: "#1f7a52" }}>Saved.</span>}
      </div>
    </div>
  );
}
