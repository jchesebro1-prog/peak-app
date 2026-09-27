"use client";

import { useState, type CSSProperties } from "react";
import { fmtDollars, typedPriceWarning } from "@/lib/service-pricing";

/**
 * #217 — the service quote builders' Total row as an input. It shows the auto
 * total (rounded to the nearest $25) until someone types a figure. A typed
 * figure is the quote's price exactly, the margin back-solves, and "Reset to
 * auto" clears it. A typed total below cost or under a 10% margin warns but
 * never blocks. Imports only the pure pricing module — safe in a client bundle.
 */
export function ServiceTotalField({
  total,
  autoTotal,
  cost,
  margin,
  overridden,
  text,
  onText,
  onReset,
  disabled,
  accent,
  style,
}: {
  total: number;
  autoTotal: number;
  cost: number;
  /** The margin the builder's slider shows (the service margin on repairs). */
  margin: number;
  overridden: boolean;
  /** The typed text ("" = auto). */
  text: string;
  onText: (text: string) => void;
  onReset: () => void;
  disabled?: boolean;
  accent: string;
  style?: CSSProperties;
}) {
  // While focused the field shows exactly what is being typed (even ""), so
  // clearing it to type a new figure doesn't snap back to the auto total.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (text !== "" ? text : String(Math.round(autoTotal)));
  const invalid = text.trim() !== "" && !overridden;
  const warning = overridden ? typedPriceWarning(total, cost, margin) : null;
  return (
    <div style={{ marginTop: 4, paddingTop: 9, borderTop: "1px solid #f0f1f4", ...style }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        <label htmlFor="svc-total-input">Total</label>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "#8c919c" }}>$</span>
          <input
            id="svc-total-input"
            inputMode="decimal"
            value={shown}
            disabled={disabled}
            aria-describedby="svc-total-note"
            onFocus={(e) => {
              setDraft(shown);
              e.currentTarget.select();
            }}
            onBlur={() => setDraft(null)}
            onChange={(e) => {
              setDraft(e.target.value);
              onText(e.target.value);
            }}
            style={{
              width: 118,
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              fontWeight: 700,
              textAlign: "right",
              color: "#16181d",
              background: overridden ? "#fffaf0" : "#fff",
              border: "1px solid " + (overridden ? accent : "#e4e7ec"),
              borderRadius: 8,
              padding: "6px 8px",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
      <div
        id="svc-total-note"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          fontSize: 10.5,
          color: "#9aa0ab",
          marginTop: 5,
          lineHeight: 1.45,
        }}
      >
        <span>
          {overridden
            ? `Typed total · auto is ${fmtDollars(autoTotal)}`
            : invalid
              ? "Not a dollar amount — using the auto total."
              : "Auto · rounded to the nearest $25"}
        </span>
        {(overridden || invalid) && (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              onReset();
            }}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 10.5,
              fontWeight: 600,
              color: accent,
              background: "none",
              border: 0,
              padding: 0,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Reset to auto
          </button>
        )}
      </div>
      {warning && (
        <div role="status" style={{ fontSize: 10.5, color: "#b4543a", marginTop: 5, lineHeight: 1.45 }}>
          {warning.text}
        </div>
      )}
    </div>
  );
}
