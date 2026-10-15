import Link from "next/link";
import { listDocsByField } from "@/db/doc-store";
import type { Quote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { quoteBuilderHref } from "@/lib/quote-links";
import { leadEstimatesTotal } from "@/lib/parties/rules";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const STATUS: Record<string, string> = { draft: "Draft", sent: "Sent", won: "Won", lost: "Lost" };

/** #348 — every estimate on this lead/opportunity with the estimates total (draft + sent + won). Nothing when none. */
export async function LeadEstimates({ leadId }: { leadId: string }) {
  const quotes = (await listDocsByField<Quote>("quotes", "leadId", [leadId])).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!quotes.length) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>Estimates</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{money(leadEstimatesTotal(quotes))}</span>
      </div>
      {quotes.map((q) => (
        <Link key={q.id} href={quoteBuilderHref(q)} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "6px 0", borderTop: "1px solid #f3f4f7", color: "inherit", textDecoration: "none" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", flexShrink: 0 }}>{displayQuoteNumber(q)}</span>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{q.name}</span>
          <span style={{ fontSize: 11.5, color: q.status === "lost" ? "#9aa0ab" : "#5b616e" }}>{STATUS[q.status] ?? q.status}</span>
          <span style={{ fontSize: 12, fontWeight: 600, textDecoration: q.status === "lost" ? "line-through" : "none" }}>{money(q.value || 0)}</span>
        </Link>
      ))}
    </div>
  );
}
