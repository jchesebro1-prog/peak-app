"use client";

import { useState } from "react";
import type { BonusRecord, BonusSplit } from "@/lib/estimate-bonus/record";
import { parseLeadPct, showSplitRow } from "@/lib/estimate-bonus/card";
import { fmt } from "../pricing";

const CARD = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: 16 } as const;
const CARD_LABEL = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 4 } as const;
const ROW = { fontSize: 12.5, color: "#16181d", marginTop: 8 } as const;

/**
 * Estimator bonuses — the Send & track card. Internal only: the 2% total, the
 * Lead / Prepared-by split, which alternates the customer took, and (once Won)
 * the recorded credits. Errors show inline, never in a dialog.
 */
export function BonusCard(props: {
  quoteId: string | null;
  canApprove: boolean;
  owner: string;
  preparedBy: string;
  split: BonusSplit;
  onSplit: (leadPct: number) => void;
  alternates: { id: string; name: string }[];
  taken: string[];
  onTaken: (ids: string[]) => void;
  estimatorBonus: number;
  record: BonusRecord | null;
  /** The estimate carries bonus lines — with Won and no record, the Won write failed. */
  hasBonusLines: boolean;
  status: string;
  error?: string | null;
}) {
  const { quoteId, canApprove, owner, preparedBy, split, onSplit, alternates, taken, onTaken, estimatorBonus, record, hasBonusLines, status, error } = props;
  // null = not being edited: the input shows the saved split.
  const [typed, setTyped] = useState<string | null>(null);
  const draft = typed ?? String(split.leadPct);
  const setDraft = (v: string) => setTyped(v);
  const commit = () => {
    const n = parseLeadPct(draft);
    setTyped(null);
    if (n != null && n !== split.leadPct) onSplit(n);
  };
  const lead = parseLeadPct(draft) ?? split.leadPct;
  const won = status === "won";
  const altDisabled = won ? !canApprove : false;
  // Spec: a Won whose record write failed says so to approvers; saving the
  // alternates (Record now, or ticking one) rebuilds the missing record.
  const notRecorded = won && !record && hasBonusLines && canApprove;
  return (
    <section aria-label="Estimator bonus" style={CARD}>
      <div style={CARD_LABEL}>Estimator bonus</div>
      <div style={{ fontSize: 11, color: "#9aa0ab" }}>Internal — never shown to the customer</div>
      <div style={ROW}>
        2% on this estimate: <strong>{fmt(estimatorBonus)}</strong>
      </div>
      {showSplitRow(owner, preparedBy) && (
        <div style={{ ...ROW, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>Lead {owner}</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={draft}
            disabled={!canApprove || !quoteId}
            aria-label="Lead estimator share, percent"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            style={{ width: 56, fontSize: 12.5, padding: "4px 6px", border: "1px solid #dfe2e8", borderRadius: 6 }}
          />
          <span>% · Prepared by {preparedBy} {100 - lead}%</span>
        </div>
      )}
      {alternates.length > 0 && (
        <div style={ROW}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Alternates the customer took</div>
          {alternates.map((a) => (
            <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              <input
                type="checkbox"
                checked={taken.includes(a.id)}
                disabled={altDisabled}
                onChange={(e) => onTaken(e.target.checked ? [...taken.filter((x) => x !== a.id), a.id] : taken.filter((x) => x !== a.id))}
              />
              <span>{a.name}</span>
            </label>
          ))}
        </div>
      )}
      {record && (
        <div style={{ ...ROW, borderTop: "1px solid #ececf0", paddingTop: 8 }}>
          <div>
            Recorded at Won {new Date(record.wonAt).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}: <strong>{fmt(record.estimatorBonus)}</strong>
          </div>
          {record.credits.map((c, i) => (
            <div key={`${c.role}-${i}`} style={{ marginTop: 2 }}>
              {c.name}
              {c.userId == null ? " (no matching team member)" : ""} ({c.role}) {c.pct}% — {fmt(c.amount)}
            </div>
          ))}
        </div>
      )}
      {notRecorded && (
        <div role="status" style={{ ...ROW, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "#b06a00" }}>
          <span>Bonus not recorded {"\u2014"} re-save Won</span>
          <button
            type="button"
            disabled={!quoteId}
            onClick={() => onTaken(taken)}
            style={{ fontSize: 11.5, padding: "3px 8px", border: "1px solid #dfe2e8", borderRadius: 6, background: "#fff", cursor: "pointer" }}
          >
            Record now
          </button>
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 11.5, color: "#c0392b" }}>
          {error}
        </div>
      )}
    </section>
  );
}
