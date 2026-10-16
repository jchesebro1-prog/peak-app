import Link from "next/link";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { PORTAL_BID_COPY, portalBidChip, type PortalBid } from "@/lib/parties/portal-bid";
import type { Quote } from "@/lib/stores/quotes";
import { onlineHeaderLine } from "@/lib/quote-share/view";
import { Chip, money, type ChipStyle } from "./quote-row";

const BID_BADGE: ChipStyle = { label: PORTAL_BID_COPY.badge, ink: "var(--accent)", soft: "#fff", bd: "var(--accent)" };
const BID_CHIP: ChipStyle = { label: "", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" };
const BID_CHIP_AWARDED: ChipStyle = { label: "", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" };
const BID_CHIP_CLOSED: ChipStyle = { label: "", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" };

/**
 * #348 slice 6 Task 4 — one row of Home's Bids card, for a bidder company (a GC / EC the estimate was sent to; never the
 * quote's own customer). Read-only: the revision this company was sent — its frozen name and value, never the live
 * q.name — a Bid badge, the status chip (due date / Bid submitted / Awarded / Closed) and the company's own PDF. No
 * Accept, Refresh pricing, Rename, Copy to new quote, Quote again or decline note: the bidder rule gives a company
 * nothing to act on. A server component with no store reads — the bid arrives already decided (portalBidList).
 */
export function PortalBidRow({ q, bid, closed, preview, cid }: { q: Quote; bid: PortalBid; closed: boolean; preview: boolean; cid: string }) {
  const suffix = preview ? `?preview=${encodeURIComponent(cid)}` : "";
  const onlineHref = `/portal/quotes/${encodeURIComponent(q.id)}` + suffix;
  const pdfHref = `/portal/quotes/${encodeURIComponent(q.id)}/pdf` + suffix;
  const label = portalBidChip(q.status, bid);
  const chip: ChipStyle = { ...(closed || label === PORTAL_BID_COPY.closed ? BID_CHIP_CLOSED : bid.result === "awarded" ? BID_CHIP_AWARDED : BID_CHIP), label };
  return (
    <div style={{ borderBottom: "1px solid #f5f6f8" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 96px auto", gap: 12, alignItems: "center", padding: "13px 20px 12px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <Link href={onlineHref} prefetch={false} style={{ color: "inherit", textDecoration: "none" }}>
              {bid.rev.name || displayQuoteNumber(q)}
            </Link>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>{onlineHeaderLine(q, bid.rev)}</div>
          <div style={{ fontSize: 11.5, marginTop: 3 }}>
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
              Open PDF ↗
            </a>
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, textAlign: "right" }}>{money(bid.rev.value)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
          <Chip c={BID_BADGE} />
          <Chip c={chip} />
        </div>
      </div>
    </div>
  );
}
