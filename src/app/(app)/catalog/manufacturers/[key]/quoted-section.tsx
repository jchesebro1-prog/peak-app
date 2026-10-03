import Link from "next/link";
import type { CSSProperties } from "react";
import { money } from "@/lib/format";
import type { ManufacturerMetrics } from "@/lib/manufacturer-analytics";
import { MoneyTile, RateTile, TileRow } from "@/components/manufacturer-metrics";

/**
 * The Quoted section of a manufacturer's page (Manufacturer section Part 3).
 * Server-rendered; the metrics are the last 12 calendar months (Chicago).
 */

const card: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 18, overflow: "hidden" };
const th: CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", padding: "6px 8px" };
const td: CSSProperties = { padding: "8px", borderTop: "1px solid #f0f1f4", fontSize: 12.5, verticalAlign: "top" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthLabel = (ym: string): string => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const monthTitle = (ym: string): string => `${monthLabel(ym)} ${ym.slice(0, 4)}`;

export default function QuotedSection({ metrics, shopWinRate }: { metrics: ManufacturerMetrics | null; shopWinRate: number | null }) {
  const m = metrics;
  const empty =
    !m ||
    (m.quoted.cost === 0 && m.quoted.sell === 0 && m.won.cost === 0 && m.lost.cost === 0 && m.open.cost === 0 && m.open.sell === 0 && m.draft.cost === 0 && m.draft.sell === 0 && !m.topParts.length);
  const rate = m ? (m.winRate ?? shopWinRate) : null;
  const maxWon = m ? Math.max(0, ...m.monthlyWon.map((e) => e.cost)) : 0;
  return (
    <section style={card} aria-label="Quoted">
      <div style={{ padding: "13px 18px 11px", borderBottom: "1px solid #f0f1f4", fontSize: 14, fontWeight: 600 }}>
        Quoted <span style={{ fontSize: 12, fontWeight: 500, color: "#8c919c", marginLeft: 6 }}>Last 12 months · cost, with sell beneath</span>
      </div>
      <div style={{ padding: "14px 18px" }}>
        {empty || !m ? (
          <div style={{ color: "#8c919c", fontSize: 12.5 }}>No quotes for this manufacturer in the last 12 months.</div>
        ) : (
          <>
            <TileRow>
              <MoneyTile label="Quoted" value={m.quoted} caption={`${m.quotes} quote${m.quotes === 1 ? "" : "s"} · last 12 months`} />
              <MoneyTile label="Won" value={m.won} caption="Last 12 months" />
              <MoneyTile label="Lost" value={m.lost} caption="Last 12 months" />
              <RateTile label="Win rate" rate={rate} shopRate={m.usedShopRate} caption="Won ÷ won + lost, by cost" />
            </TileRow>
            <div style={{ height: 10 }} />
            <TileRow>
              <MoneyTile label="Open" value={m.open} caption="Sent, awaiting a decision" />
              <MoneyTile label="In draft" value={m.draft} caption="Not yet sent" />
              <MoneyTile label="Forecast" value={m.forecast} emphasis caption={rate === null ? "No decided quotes yet." : undefined} />
            </TileRow>
            <div style={{ fontSize: 11.5, color: "#8c919c", margin: "8px 0 0" }}>
              Open quotes × win rate — this manufacturer&apos;s, or the shop&apos;s when it has no decided quotes in the last 12 months.
            </div>

            <div style={{ marginTop: 18, fontSize: 12.5, fontWeight: 600 }}>Won by month <span style={{ fontWeight: 500, color: "#8c919c" }}>(cost)</span></div>
            <div role="img" aria-label={`Won cost by month: ${m.monthlyWon.map((e) => `${monthTitle(e.month)} ${money(e.cost)}`).join(", ")}`} style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 110, marginTop: 8 }}>
              {m.monthlyWon.map((e) => (
                <div key={e.month} title={`${monthTitle(e.month)} — ${money(e.cost)} cost, ${money(e.sell)} sell`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }}>
                  <div style={{ width: "100%", maxWidth: 38, height: maxWon > 0 ? `${Math.max(e.cost > 0 ? 3 : 0, Math.round((e.cost / maxWon) * 86))}px` : 0, background: "var(--accent)", borderRadius: "4px 4px 0 0", opacity: e.cost > 0 ? 1 : 0.15 }} />
                  <div style={{ fontSize: 10, color: "#8c919c", marginTop: 4 }}>{monthLabel(e.month)}</div>
                </div>
              ))}
            </div>

            {m.topParts.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Top parts <span style={{ fontWeight: 500, color: "#8c919c" }}>(by quoted cost)</span></div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                    <thead><tr><th style={th}>SKU</th><th style={th}>Description</th><th style={{ ...th, textAlign: "right" }}>Qty</th><th style={{ ...th, textAlign: "right" }}>Quoted cost</th></tr></thead>
                    <tbody>
                      {m.topParts.map((p) => (
                        <tr key={p.sku || p.desc}>
                          <td style={{ ...td, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                            {p.sku ? <Link href={`/catalog?q=${encodeURIComponent(p.sku)}`} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>{p.sku}</Link> : "—"}
                          </td>
                          <td style={td}>{p.desc || "—"}</td>
                          <td style={{ ...td, textAlign: "right" }}>{p.qty}</td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(p.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
