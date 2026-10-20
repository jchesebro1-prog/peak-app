import Link from "next/link";
import type { WidgetRenderer } from "@/lib/dashboard/context";
import { periodBounds } from "@/lib/dashboard/metrics";
import { bidsByBidder, BID_REPORT_COPY } from "@/lib/parties/bid-report";
import { ROLE_SHORT } from "@/lib/parties/rules";
import { chicagoShortDate } from "@/lib/triage/clock";

/** #348 slice 6 — Reports › "Bids by GC/EC". Period = ?range (history contract), anchored on each bid's due date
 *  (else its last send; a future due date counts as now, so in-flight bids show). Staff-only by being on the team Reports page; the loader reads delivered bidder rows only. */

const COLS = "minmax(160px,1fr) 44px 48px 48px 72px 76px 80px 84px 66px";
const MONO = { fontFamily: "var(--font-mono)", textAlign: "right" } as const;
const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
const day = (ms: number | null) => (ms === null ? "—" : chicagoShortDate(ms));

export const BIDS_RENDERERS = {
  "bids-by-bidder": async (ctx) => {
    const { inputs, names, truncated } = await ctx.data.bidReport();
    const { start, end } = periodBounds(ctx.range, ctx.now);
    const { rows, total } = bidsByBidder(inputs, names, { start, end, now: ctx.now });

    const numbers = (r: { sent: number; open: number; decided: number; awarded: number; out: number; rate: number | null; lastSentAt: number | null }) => (
      <>
        <span style={{ ...MONO, fontWeight: 600 }}>{r.sent}</span>
        <span style={{ ...MONO, color: "#8c919c" }}>{r.open}</span>
        <span style={MONO}>{r.decided}</span>
        <span style={{ ...MONO, color: "#1f7a52" }}>{r.awarded}</span>
        <span style={{ ...MONO, color: "#8c919c" }}>{r.out}</span>
        <span data-cell="rate" style={{ ...MONO, color: "#5b616e" }}>{pct(r.rate)}</span>
        <span style={{ ...MONO, color: "#8c919c" }}>{day(r.lastSentAt)}</span>
      </>
    );

    return (
      <div className="pk-card" style={{ overflow: "hidden", marginTop: 18 }}>
        <div style={{ padding: "16px 20px 13px", borderBottom: "1px solid #f0f1f4" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{BID_REPORT_COPY.title}</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3 }}>{BID_REPORT_COPY.sub}</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: COLS,
                gap: 8,
                padding: "9px 20px",
                fontSize: 9.5,
                fontWeight: 600,
                color: "#aab0bb",
                textTransform: "uppercase",
                letterSpacing: ".04em",
                borderBottom: "1px solid #f3f4f7",
                alignItems: "end",
              }}
            >
              {BID_REPORT_COPY.cols.map((c, i) => (
                <span key={c} style={i < 2 ? undefined : { textAlign: "right" }}>
                  {c}
                </span>
              ))}
            </div>
            {rows.map((r) => (
              <div
                key={`${r.companyId}:${r.role}`}
                data-bidder={`${r.companyId}:${r.role}`}
                style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "11px 20px", fontSize: 12.5, alignItems: "center", borderBottom: "1px solid #f5f6f8" }}
              >
                <Link
                  href={`/companies/${encodeURIComponent(r.companyId)}`}
                  style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "inherit", minWidth: 0 }}
                >
                  {r.name}
                </Link>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#5b616e" }}>{ROLE_SHORT[r.role]}</span>
                {numbers(r)}
              </div>
            ))}
            {rows.length === 0 ? (
              <div style={{ padding: "22px 20px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>{BID_REPORT_COPY.empty}</div>
            ) : (
              <div
                data-bidder="total"
                style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "11px 20px", fontSize: 12.5, alignItems: "center", fontWeight: 700, background: "#fafbfc" }}
              >
                <span style={{ minWidth: 0 }}>
                  {total.name}
                  <span style={{ fontWeight: 400, color: "#8c919c", fontSize: 11.5 }}>
                    {" "}· {total.companies} {total.companies === 1 ? "company" : "companies"}
                  </span>
                </span>
                <span />
                {numbers(total)}
              </div>
            )}
          </div>
        </div>
        {truncated && (
          <div style={{ padding: "9px 20px 12px", fontSize: 11.5, color: "#9aa0ab", borderTop: "1px solid #f3f4f7" }}>
            Showing the first 5,000 bids.
          </div>
        )}
      </div>
    );
  },
} satisfies Record<string, WidgetRenderer>;
