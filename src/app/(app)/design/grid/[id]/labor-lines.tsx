"use client";

import { useState, useTransition, type CSSProperties } from "react";
import type { GridLaborLine } from "@/lib/design/wire-labor";
import { setLaborOverrideAction } from "./actions";

/**
 * One Grid BOM labor line (#232), printed last under its heading: that
 * heading's material × labor % × the tier's multiplier, computed on the
 * server by buildGridQuote — the same line the draft quote carries. A typed
 * $ overrides it for THIS option ($0 leaves it off the quote but keeps the
 * row here so it can be reset); ↺ goes back to the calculation. Sell numbers
 * only.
 */

const INPUT: CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "2px 5px",
  fontSize: 11.5,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: 76,
  flex: "none",
  textAlign: "right",
};

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** "18% × 1.15" — the multiplier only when a tier moved it off 1. */
function rateLabel(l: GridLaborLine): string {
  return l.mult === 1 ? `${l.pct}%` : `${l.pct}% × ${l.mult}`;
}

export function LaborLineRow({
  projectId,
  optionId,
  line,
  onChanged,
  onError,
}: {
  projectId: string;
  optionId: string;
  line: GridLaborLine;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const shown = String(Math.round(line.amount * 100) / 100);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (amount: number | null) =>
    startTransition(async () => {
      try {
        const r = await setLaborOverrideAction(projectId, optionId, line.system, amount);
        if (!r.ok) onError(r.error);
        else onChanged();
      } catch {
        onError("Couldn't save the labor amount — try again.");
      }
      setDraft(null);
    });

  const commit = () => {
    if (draft === null || draft === shown) {
      setDraft(null);
      return;
    }
    const n = Number(draft.replace(/[$,\s]/g, ""));
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0) {
      setDraft(null);
      onError("Enter a labor amount of $0 or more.");
      return;
    }
    save(n);
  };

  const tip =
    `${money(line.material)} material × ${line.pct}%` +
    (line.mult === 1 ? "" : ` × ${line.mult} (${line.tier ?? "no tier"})`) +
    ` = ${money(line.computed)}` +
    (line.overridden ? ` — typed ${money(line.amount)}${line.amount === 0 ? " (left off the quote)" : ""}` : "");

  return (
    <div style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center" }}>
      <span
        style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        title={tip}
      >
        {line.desc}
        <span style={{ color: "#9aa0ab", fontSize: 10.5 }}> · {rateLabel(line)}</span>
      </span>
      {line.overridden ? (
        <button
          type="button"
          onClick={() => save(null)}
          disabled={pending}
          aria-label={`Reset ${line.desc} to the calculated ${money(line.computed)}`}
          title={`Back to the calculated ${money(line.computed)}`}
          style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 13, lineHeight: 1, cursor: "pointer", padding: 0 }}
        >
          ↺
        </button>
      ) : null}
      <span style={{ fontSize: 10.5, color: "#8c919c" }}>$</span>
      <input
        aria-label={`${line.desc} amount`}
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
        inputMode="decimal"
        disabled={pending}
        style={{ ...INPUT, borderColor: line.overridden ? "var(--accent)" : "#dfe2e8" }}
      />
    </div>
  );
}
