"use client";

import { useState } from "react";
import { maxApplicableCredit } from "@/lib/rewards/credit-line";
import type { RewardCreditInfo } from "@/app/(app)/rewards/actions";
import { fmt } from "./pricing";

/**
 * #282 phase 2 — the Estimator's "Rewards credit" box (spec §5), in the
 * quote totals sidebar. Shows the customer's balance and what this quote may
 * still take (balance − credit on their OTHER open quotes), and applies up to
 * min(available, the quote's pre-credit total) as one credit line on the last
 * system. The save clamps again on the server. Hidden while the program is
 * off or no customer is picked; read-only once the quote is won or lost
 * (its redeem is on the ledger).
 */
export function RewardCreditPanel(p: {
  info: RewardCreditInfo | null;
  /** The credit currently on this quote. */
  applied: number;
  /** rev + freight + tax, before any credit. */
  preCreditTotal: number;
  /** draft/sent, and the user has `create`. */
  editable: boolean;
  hasSystems: boolean;
  onApply: (amount: number) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!p.info?.enabled) return null;
  const max = maxApplicableCredit(p.info.available, p.preCreditTotal);
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "#9aa0ab",
    letterSpacing: ".05em",
    textTransform: "uppercase",
    marginBottom: 10,
  };
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 7 };
  const apply = (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr("Enter an amount above $0.");
      return;
    }
    setErr(null);
    p.onApply(Math.min(amount, max));
    setDraft("");
  };
  return (
    <div
      data-testid="reward-credit-panel"
      style={{ margin: "6px 14px", padding: 13, background: "#f2faf6", borderRadius: 10, border: "1px solid #cfe9dc" }}
    >
      <div style={label}>Rewards credit</div>
      <div style={row}>
        <span style={{ color: "#5b616e" }}>Balance</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(p.info.balance)}</span>
      </div>
      <div style={row}>
        <span style={{ color: "#5b616e" }}>Available for this quote</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(Math.max(0, p.info.available))}</span>
      </div>
      {p.applied > 0 && (
        <div style={{ ...row, color: "#1f8a5b", fontWeight: 600 }}>
          <span>Applied</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>−{fmt(p.applied)}</span>
        </div>
      )}
      {p.editable && p.hasSystems && (
        <>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input
              aria-label="Credit to apply"
              className="est-input"
              inputMode="decimal"
              placeholder={max > 0 ? fmt(max) : "$0.00"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 12.5, padding: "5px 8px", border: "1px solid #d8dce3", borderRadius: 6 }}
            />
            <button
              type="button"
              disabled={!(max > 0)}
              onClick={() => apply(draft.trim() ? Number(draft.replace(/[$,\s]/g, "")) : max)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#fff",
                background: max > 0 ? "#1f8a5b" : "#9aa0ab",
                border: "none",
                borderRadius: 6,
                padding: "5px 10px",
                cursor: max > 0 ? "pointer" : "default",
              }}
            >
              Apply credit
            </button>
          </div>
          {p.applied > 0 && (
            <button
              type="button"
              onClick={p.onRemove}
              style={{ marginTop: 6, fontSize: 11.5, color: "#c0683a", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              Remove credit
            </button>
          )}
          <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 6, lineHeight: 1.45 }}>
            Up to {fmt(max)} — never more than this quote&apos;s total. Posted from the balance when the quote is won.
          </div>
        </>
      )}
      {err && <div style={{ fontSize: 11, color: "#c0683a", marginTop: 4 }}>{err}</div>}
    </div>
  );
}
