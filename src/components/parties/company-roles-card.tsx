import type { CSSProperties } from "react";
import Link from "next/link";
import { getDoc } from "@/db/doc-store";
import { liveRecordsForCompany } from "@/lib/stores/parties";
import { getMany as getQuotes } from "@/lib/stores/quotes";
import { displayLeadNumber, displayQuoteNumber } from "@/lib/estimate-number";
import { quoteBuilderHref } from "@/lib/quote-links";
import { partyRoleText, type Party } from "@/lib/parties/rules";
import type { LeadRecord } from "@/lib/stores/leads";
import type { ProjectRecord } from "@/lib/stores/projects";
import { ShortList } from "@/components/short-list";

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 24, overflow: "hidden" };
const HEAD: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" };
const KIND: Record<Party["recordType"], string> = { lead: "Opportunity", quote: "Estimate", project: "Project" };

type Row = { key: string; kind: string; number: string; name: string; roles: string; href: string; sort: number };

/** #346 — every live lead / estimate / project this company is on, and in what role. Nothing when none. */
export async function CompanyRolesCard({ companyId, style, headStyle }: { companyId: string; style?: CSSProperties; headStyle?: CSSProperties }) {
  const records = await liveRecordsForCompany(companyId);
  if (!records.length) return null;
  const quotes = await getQuotes([...new Set(records.filter((r) => r.recordType === "quote").map((r) => r.recordId))]);
  const rows: Row[] = [];
  for (const { recordType, recordId, parties } of records) {
    const key = `${recordType}:${recordId}`;
    const roles = parties.map(partyRoleText).join(", ");
    if (recordType === "quote") {
      const q = quotes.get(recordId);
      if (!q) continue;
      rows.push({ key, kind: KIND.quote, number: displayQuoteNumber(q), name: q.name, roles, href: quoteBuilderHref(q), sort: q.updatedAt || 0 });
    } else if (recordType === "lead") {
      const l = await getDoc<LeadRecord>("leads", recordId);
      if (!l) continue;
      rows.push({ key, kind: KIND.lead, number: displayLeadNumber(l), name: l.org + (l.interest ? ` — ${l.interest}` : ""), roles, href: `/leads?lead=${encodeURIComponent(l.id)}`, sort: l.updatedAt || 0 });
    } else {
      const pr = await getDoc<ProjectRecord>("projects", recordId);
      if (!pr) continue;
      rows.push({ key, kind: KIND.project, number: pr.id, name: pr.name, roles, href: `/projects/${encodeURIComponent(pr.id)}`, sort: pr.updatedAt || 0 });
    }
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.sort - a.sort);
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ ...HEAD, ...headStyle }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>Bids &amp; roles</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{rows.length}</span>
      </div>
      <ShortList
        initial={8}
        searchPlaceholder="Search jobs…"
        searchText={rows.map((r) => `${r.number} ${r.name} ${r.roles}`)}
        items={rows.map((r) => (
          <Link key={r.key} href={r.href} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "10px 18px", borderBottom: "1px solid #f5f6f8", color: "inherit", textDecoration: "none" }}>
            <span style={{ fontSize: 11, color: "#9aa0ab", width: 76, flexShrink: 0 }}>{r.kind}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", flexShrink: 0 }}>{r.number}</span>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
            <span style={{ fontSize: 11.5, color: "#5b616e", flexShrink: 0 }}>{r.roles}</span>
          </Link>
        ))}
      />
    </div>
  );
}
