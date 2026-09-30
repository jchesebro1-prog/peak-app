"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { rewardCreditInfoAction, type RewardCreditInfo } from "@/app/(app)/rewards/actions";
import { netServiceTotal, normalizeServiceCredit } from "@/lib/rewards/service-credit";
import { fmtDollars } from "@/lib/service-pricing";

/**
 * #282 phase 3 — the "Rewards credit" control shared by the flame-test,
 * inspection and repair quote builders (spec §5), under the Total field.
 *
 * Shows the customer's balance and what this quote may still take (balance −
 * credit parked on their OTHER open quotes — phase 2's available rule), and
 * applies up to min(available, the engine total) in whole dollars. The credit
 * comes off AFTER the engine's total (after the $25 rounding, a typed total
 * and a lift), so the builder's Total field keeps showing the pre-credit
 * price and this box shows what the customer pays. The save clamps again on
 * the server.
 *
 * Shown only while the program is on and the customer has credit available
 * (or the quote already carries some); editable on a draft/sent quote for
 * anyone with `create`; read-only once won or lost (its redeem is on the
 * ledger). Never on a portal service quote (#248).
 */

const money2 = (n: number) =>
  "$" + (Math.round((n || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ServiceRewardCreditPanel(p: {
  customerId: string;
  /** The saved quote (null for a new one) — its own credit never holds against itself. */
  quoteId: string | null;
  status: string;
  /** A portal service quote — never carries a credit. */
  portal: boolean;
  /** The user has `create`. */
  canApply: boolean;
  /** The engine's final total (after rounding / typed total / lift); 0 = not priced yet. */
  total: number;
  /** The credit on this quote (whole dollars). */
  credit: number;
  onCredit: (credit: number) => void;
}) {
  const [info, setInfo] = useState<{ customerId: string; info: RewardCreditInfo } | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { customerId, quoteId, status } = p;

  useEffect(() => {
    let live = true;
    if (!customerId) return;
    rewardCreditInfoAction(customerId, quoteId)
      .then((i) => {
        if (live) setInfo({ customerId, info: i });
      })
      .catch(() => {
        if (live) setInfo(null);
      });
    return () => {
      live = false;
    };
  }, [customerId, quoteId, status]);

  if (p.portal || !customerId) return null;
  // Only the answer for the customer picked NOW (a stale one reads as none).
  const shownInfo = info && info.customerId === customerId ? info.info : null;
  const available = Math.max(0, shownInfo?.available ?? 0);
  if (!(p.credit > 0) && !(shownInfo?.enabled && available >= 1)) return null;

  const locked = status === "won" || status === "lost";
  const editable = !locked && p.canApply;
  const max = normalizeServiceCredit(Math.min(available, Math.max(0, p.total)));
  const applied = locked ? p.credit : Math.min(p.credit, Math.max(0, Math.round(p.total)));
  const net = netServiceTotal(p.total, applied);

  const row: CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 };
  const apply = () => {
    const typed = draft.trim();
    const amount = typed ? normalizeServiceCredit(typed) : max;
    if (!(amount > 0)) {
      setErr("Enter a whole-dollar amount above $0.");
      return;
    }
    setErr(null);
    p.onCredit(Math.min(amount, max));
    setDraft("");
  };

  return (
    <div
      data-testid="service-reward-credit"
      style={{ marginTop: 12, padding: 12, background: "#f2faf6", borderRadius: 10, border: "1px solid #cfe9dc" }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: "#5b8a72",
          letterSpacing: ".05em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Rewards credit
      </div>
      {shownInfo?.enabled && (
        <>
          <div style={row}>
            <span style={{ color: "#5b616e" }}>Balance</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{money2(shownInfo.balance)}</span>
          </div>
          <div style={row}>
            <span style={{ color: "#5b616e" }}>Available for this quote</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{money2(available)}</span>
          </div>
        </>
      )}
      {applied > 0 && (
        <>
          <div style={{ ...row, color: "#1f8a5b", fontWeight: 600 }}>
            <span>Rewards credit</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>−{fmtDollars(applied)}</span>
          </div>
          <div style={{ ...row, fontWeight: 700, fontSize: 13.5, marginBottom: 0 }}>
            <span>Customer pays</span>
            <span style={{ fontFamily: "var(--font-mono)" }} data-testid="service-reward-net">
              {fmtDollars(net)}
            </span>
          </div>
        </>
      )}
      {editable && (
        <>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input
              aria-label="Rewards credit to apply"
              inputMode="numeric"
              placeholder={max > 0 ? fmtDollars(max) : "$0"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                padding: "5px 8px",
                border: "1px solid #d8dce3",
                borderRadius: 6,
                background: "#fff",
              }}
            />
            <button
              type="button"
              disabled={!(max > 0)}
              onClick={apply}
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
          {p.credit > 0 && (
            <button
              type="button"
              onClick={() => p.onCredit(0)}
              style={{ marginTop: 6, fontSize: 11.5, color: "#c0683a", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              Remove credit
            </button>
          )}
          <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 6, lineHeight: 1.45 }}>
            Up to {fmtDollars(max)} in whole dollars — comes off after the total above, never below $0. Posted from the
            balance when the quote is won.
          </div>
        </>
      )}
      {locked && p.credit > 0 && (
        <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 6, lineHeight: 1.45 }}>
          Locked — this quote is {status}; the credit follows its status on the ledger.
        </div>
      )}
      {err && <div style={{ fontSize: 11, color: "#c0683a", marginTop: 4 }}>{err}</div>}
    </div>
  );
}
