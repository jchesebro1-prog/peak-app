import type { CSSProperties } from "react";
import Link from "next/link";
import { quotesReceivedFor } from "@/lib/stores/vendor-quotes";
import { VENDOR_COPY } from "@/lib/vendor-quotes/rules";
import { dateYear, money } from "@/lib/format";
import { ShortList } from "@/components/short-list";

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 24, overflow: "hidden" };
const HEAD: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" };
const CHIP: CSSProperties = { fontSize: 10.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", background: "#f1f2f5", color: "#5b616e", whiteSpace: "nowrap", flexShrink: 0 };

/** #348 slice 4 — the vendor quotes this company has given us, one row per quote, newest first. Nothing when none. */
export async function QuotesReceivedCard({ companyId, style, headStyle }: { companyId: string; style?: CSSProperties; headStyle?: CSSProperties }) {
  const rows = await quotesReceivedFor(companyId);
  if (!rows.length) return null;
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ ...HEAD, ...headStyle }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{VENDOR_COPY.receivedTitle}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{rows.length}</span>
      </div>
      <ShortList
        initial={8}
        searchPlaceholder="Search estimates…"
        searchText={rows.map((r) => `${r.estimate} ${r.job} ${r.vendorQuoteNumber}`)}
        items={rows.map((r) => (
          <Link key={r.key} href={r.href} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "10px 18px", borderBottom: "1px solid #f5f6f8", color: "inherit", textDecoration: "none" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", flexShrink: 0 }}>{r.estimate}</span>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.job}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", flexShrink: 0 }}>{r.vendorQuoteNumber || "—"}</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>{money(r.total, { cents: true })}</span>
            <span style={{ fontSize: 11.5, color: "#5b616e", flexShrink: 0 }}>{r.addedAt != null ? dateYear(r.addedAt) : "—"}</span>
            {r.status && <span style={CHIP}>{r.status}</span>}
          </Link>
        ))}
      />
    </div>
  );
}
