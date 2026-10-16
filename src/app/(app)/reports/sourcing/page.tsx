import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { loadSourcingReport } from "@/lib/sourcing-report-load";
import { sortForNoCost, type SourcingMfrRow, type SourcingPartRow } from "@/lib/sourcing-report";

export const metadata = { title: "Most-quoted products — Quartzite-6" };
export const maxDuration = 60;

/**
 * Batch 6 / #66 — most-quoted products and projected sourcing across OPEN
 * estimates (draft or sent), weighted by win chance (lib/sourcing-report.ts).
 * Cost is shown only to staff holding `approve` — the same gate Reports puts
 * on its margin and profit widgets (lib/dashboard/registry.ts).
 */

const th: CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", padding: "9px 12px", whiteSpace: "nowrap" };
const td: CSSProperties = { fontSize: 12.5, color: "#3a3f4a", padding: "9px 12px", borderTop: "1px solid #f3f4f6", whiteSpace: "nowrap" };
const mono: CSSProperties = { fontFamily: "var(--font-mono)" };
const right: CSSProperties = { textAlign: "right" };
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const qtyFmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");
const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);

const LIMIT = 100;

export default async function SourcingReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, sp] = await Promise.all([requireUser(), searchParams]);
  const showCost = can("approve", me.roles);
  const showAll = sp.all === "1";
  const report = await loadSourcingReport();
  const parts: SourcingPartRow[] = showCost ? report.parts : sortForNoCost(report.parts, (r) => r.model || r.sku);
  const mfrs: SourcingMfrRow[] = showCost ? report.manufacturers : sortForNoCost(report.manufacturers, (r) => r.manufacturer);
  const shown = showAll ? parts : parts.slice(0, LIMIT);
  const totalCost = report.parts.reduce((s, r) => s + r.weightedCost, 0);

  return (
    <div className="pk-content" style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Most-quoted products</span>
          {showCost && <span style={{ ...mono, fontSize: 13, color: "#9aa0ab" }}>{money(totalCost)} weighted</span>}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Link href="/reports/sourcing/export" prefetch={false} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            Download CSV
          </Link>
          <Link href="/reports" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            ← Reports
          </Link>
        </div>
      </div>
      <div className="pk-page-sub" style={{ marginBottom: 16 }}>
        Parts on {report.openEstimates} open estimate{report.openEstimates === 1 ? "" : "s"} (draft or sent), weighted by the chance each is won —
        the manufacturer&rsquo;s own win rate, else the shop&rsquo;s ({pct(report.shopWinRate)}). Assemblies count their parts; labor, options,
        allowances and alternates are left out.
      </div>

      <div className="pk-card" style={{ padding: 0, marginBottom: 18 }}>
        <div style={{ padding: "12px 14px 4px", fontSize: 14, fontWeight: 600 }}>Manufacturers</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Manufacturer</th>
                <th style={{ ...th, ...right }}>Parts</th>
                <th style={{ ...th, ...right }}>Quoted qty</th>
                <th style={{ ...th, ...right }}>Weighted qty</th>
                {showCost && <th style={{ ...th, ...right }}>Weighted cost</th>}
                <th style={{ ...th, ...right }}>Estimates</th>
              </tr>
            </thead>
            <tbody>
              {mfrs.length === 0 ? (
                <tr><td colSpan={showCost ? 6 : 5} style={{ ...td, textAlign: "center", color: "#9aa0ab" }}>No catalog parts on an open estimate.</td></tr>
              ) : (
                mfrs.slice(0, 25).map((m) => (
                  <tr key={m.mfrKey || "—"}>
                    <td style={td}>{m.mfrKey ? <Link href={`/catalog/manufacturers/${encodeURIComponent(m.mfrKey)}`} style={{ color: "inherit" }}>{m.manufacturer}</Link> : "No manufacturer"}</td>
                    <td style={{ ...td, ...mono, ...right }}>{m.parts}</td>
                    <td style={{ ...td, ...mono, ...right }}>{qtyFmt(m.qty)}</td>
                    <td style={{ ...td, ...mono, ...right }}>{qtyFmt(m.weightedQty)}</td>
                    {showCost && <td style={{ ...td, ...mono, ...right }}>{money(m.weightedCost)}</td>}
                    <td style={{ ...td, ...mono, ...right }}>{m.estimates}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pk-card" style={{ padding: 0 }}>
        <div style={{ padding: "12px 14px 4px", fontSize: 14, fontWeight: 600 }}>Parts</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Part</th>
                <th style={th}>Manufacturer</th>
                <th style={{ ...th, ...right }}>Quoted qty</th>
                <th style={{ ...th, ...right }}>Weighted qty</th>
                {showCost && <th style={{ ...th, ...right }}>Weighted cost</th>}
                <th style={{ ...th, ...right }}>Estimates</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.sku}>
                  <td style={{ ...td, whiteSpace: "normal", minWidth: 220 }}>
                    <div style={{ ...mono, fontWeight: 600 }}>{r.model}</div>
                    {r.desc && <div style={{ fontSize: 11.5, color: "#8c919c" }}>{r.desc}</div>}
                  </td>
                  <td style={td}>{r.manufacturer || "—"}</td>
                  <td style={{ ...td, ...mono, ...right }}>{qtyFmt(r.qty)}</td>
                  <td style={{ ...td, ...mono, ...right }}>{qtyFmt(r.weightedQty)}</td>
                  {showCost && <td style={{ ...td, ...mono, ...right }}>{money(r.weightedCost)}</td>}
                  <td style={{ ...td, ...mono, ...right }}>{r.estimates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!showAll && parts.length > LIMIT && (
          <div style={{ padding: "10px 14px", fontSize: 12.5 }}>
            <Link href="/reports/sourcing?all=1" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
              Show all {parts.length} parts
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
