"use client";

import type { SpecSection } from "./types";
import { isEstimatorBonusItem, isPackageBonusItem } from "@/lib/estimate-bonus/flags";
import { fmt, lineExtSellOf, systemFreight, systemItemsCost, systemMargin, systemSellTotal, type QuoteTotals } from "./pricing";

/**
 * #305 — Customer review's internal numbers (never on a customer document): cost, sell and margin per system.
 * Phase 2b: In-total systems sit above the Total (their rows add up to it); alternate systems are listed
 * below it under "Alternates (not in total)".
 */
export function ReviewCostSummary({ sections, totals }: { sections: SpecSection[]; totals: QuoteTotals }) {
  const cell = { padding: "4px 6px", fontSize: 12, borderBottom: "1px solid #ececf0" } as const;
  const num = { ...cell, textAlign: "right" as const, fontFamily: "var(--font-mono)" };
  const inTotal = sections.filter((sec) => sec.alternate !== true);
  const alternates = sections.filter((sec) => sec.alternate === true);
  // Estimator bonuses: the two automatic lines, summed over In-total systems
  // only. The 5% shows as its payout (the package line's COST — its sell
  // carries the system's markup); the 2% line's cost equals its sell.
  const bonusSum = (pick: (it: SpecSection["items"][number]) => boolean, amount: (it: SpecSection["items"][number]) => number) =>
    inTotal.reduce((a, sec) => a + sec.items.filter(pick).reduce((b, it) => b + amount(it), 0), 0);
  const pkgBonus = bonusSum(isPackageBonusItem, (it) => it.qty * it.cost);
  const estBonus = bonusSum(isEstimatorBonusItem, lineExtSellOf);
  const row = (sec: SpecSection) => (
    <tr key={sec.id}>
      <td style={cell}>{sec.name || "Untitled"}</td>
      <td style={num}>{fmt(systemItemsCost(sec) + systemFreight(sec))}</td>
      <td style={num}>{fmt(systemSellTotal(sec))}</td>
      <td style={num}>{(systemMargin(sec) * 100).toFixed(1)}%</td>
    </tr>
  );
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Internal only</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#8c919c" }}>
            <th style={{ ...cell, textAlign: "left", fontWeight: 500 }}>System</th>
            <th style={{ ...num, fontWeight: 500 }}>Cost</th>
            <th style={{ ...num, fontWeight: 500 }}>Sell</th>
            <th style={{ ...num, fontWeight: 500 }}>Margin (excl. freight)</th>
          </tr>
        </thead>
        <tbody>
          {inTotal.map(row)}
          <tr style={{ fontWeight: 600 }}>
            <td style={cell}>Total</td>
            <td style={num}>{fmt(totals.cost + totals.fr)}</td>
            <td style={num}>{fmt(totals.rev + totals.fr)}</td>
            <td style={num}>{(totals.margin * 100).toFixed(1)}%</td>
          </tr>
          {(totals.credit || 0) > 0 && (
            <>
              <tr>
                <td style={cell}>Rewards credit</td>
                <td style={num} />
                <td style={num}>−{fmt(totals.credit || 0)}</td>
                <td style={num} />
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td style={cell}>Customer total</td>
                <td style={num} />
                <td style={num}>{fmt(totals.grand)}</td>
                <td style={num} />
              </tr>
            </>
          )}
          {alternates.length > 0 && (
            <>
              <tr>
                <td colSpan={4} style={{ ...cell, paddingTop: 12, fontSize: 11, fontWeight: 600, color: "#8c919c", textTransform: "uppercase", letterSpacing: ".04em" }}>
                  Alternates (not in total)
                </td>
              </tr>
              {alternates.map(row)}
            </>
          )}
        </tbody>
      </table>
      <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 6 }}>
        Material {fmt(totals.mat)} · Labor {fmt(totals.lab)} · Freight {fmt(totals.fr)}
      </div>
      {(pkgBonus > 0 || estBonus > 0) && (
        <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 2 }}>
          5% package bonus (payout) {fmt(pkgBonus)} · 2% estimator bonus {fmt(estBonus)}
        </div>
      )}
    </div>
  );
}
