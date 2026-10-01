import Link from "next/link";
import { ledgerEntryLabel, type LedgerEntry } from "@/lib/rewards/ledger";
import { quoteBuilderHref } from "@/lib/quote-links";
import { yearAwareDate } from "@/lib/format";

/**
 * Customer Rewards — account-credit display pieces (#282 phase 2), shared by
 * the company record's Rewards card, /rewards and Settings → Rewards. Server
 * components — no state.
 */

/** $1,234.56 — credit is shown to the cent (spend rounds to the dollar). */
export function creditMoney(n: number): string {
  const v = Math.round((n || 0) * 100) / 100;
  const s = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? "−" + s : s;
}

/** +$12.50 / −$40.00 */
export function signedCredit(n: number): string {
  return (n > 0 ? "+" : n < 0 ? "−" : "") + creditMoney(Math.abs(n));
}

export function LedgerRow({ e, quoteRef }: { e: LedgerEntry; quoteRef?: string }) {
  const tone = e.amount > 0 ? "#1f8a5b" : e.amount < 0 ? "#b4543a" : "#5b616e";
  const body = (
    <>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
          {ledgerEntryLabel(e)}
          {e.quoteId ? ` · ${quoteRef || e.quoteId}` : ""}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
          {yearAwareDate(e.at)}
          {e.by ? ` · ${e.by}` : ""}
          {e.note ? ` · ${e.note}` : ""}
        </span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, color: tone, flexShrink: 0 }}>
        {signedCredit(e.amount)}
      </span>
    </>
  );
  const style = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 18px",
    borderBottom: "1px solid #f5f6f8",
    textDecoration: "none",
    color: "inherit",
  } as const;
  return e.quoteId ? (
    <Link href={quoteBuilderHref({ id: e.quoteId })} className="cu-d-row" style={style}>
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  );
}
