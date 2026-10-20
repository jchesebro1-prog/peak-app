import { isImportedHistoryQuote, portalListsQuote, type Quote } from "@/lib/stores/quotes";
import { onlineEstimateState, type OnlineEstimateState } from "@/lib/quote-share/view";
import type { QuoteRevision } from "@/lib/stores/quotes";
import { portalBidState, type PortalBid, type PortalBidRow } from "@/lib/parties/portal-bid";
import { portalPdfPreparing, portalPdfSource, portalPdfUnavailable } from "./state";

/**
 * The customer portal's PDF rule (#222), one place for the route and the list:
 * the quote must be one the portal lists for this customer (published, or the
 * customer's own self-serve draft; never Daylite history), and it must have a
 * file a customer may see: once sent, only the latest sent revision's copy;
 * never sent, the current ready PDF (portalPdfSource).
 */
export function portalQuotePdfSource(q: Quote, customerId: string, opts: PortalOwnerOpts = {}): { path: string; rev: number | null } | null {
  if (!portalListsQuote(q, customerId)) return null;
  // #348 slice 6 Task 3 (Jeff 2026-10-15): a bid estimate's owner gets no PDF — nothing priced can leak.
  if (opts.hasBidders === true) return null;
  return portalPdfSource(q);
}

/** A quote this customer may open whose sent copy isn't stored yet but can still arrive (#222). */
export function portalQuotePdfPreparing(q: Quote, customerId: string): boolean {
  return portalListsQuote(q, customerId) && portalPdfPreparing(q);
}

/** A quote this customer may open whose sent copy is missing for good (#222 T4 re-review):
 *  sent before saved PDFs existed, or edited after the send. */
export function portalQuotePdfUnavailable(q: Quote, customerId: string): boolean {
  return portalListsQuote(q, customerId) && portalPdfUnavailable(q);
}

export type PortalOnlineState =
  | Exclude<OnlineEstimateState, { kind: "ok" }>
  | { kind: "ok"; rev: QuoteRevision; closed: boolean; bidder?: PortalBid; bomOnly?: true };

/** #348 slice 6 Task 3 — whether the owner's quote has bidders (portalOwnerHasBidders). Every portal route passes it explicitly;
 *  callers that pass nothing keep today's answer. */
export type PortalOwnerOpts = { hasBidders?: boolean };

/**
 * #293 slice 3 — the portal estimate page's rule (spec §5.2, decision 16):
 * the quote must be this customer's and not Daylite history; then the one
 * online rule decides. A staff quote recalled to draft after sending shows
 * the "being revised" card (no content) — portalListsQuote hides staff
 * drafts, so the list rule alone would call it unavailable. Content (ok)
 * still requires the portal's list rule.
 *
 * #348 slice 6 — any OTHER company is decided by the bidder rule over ITS bidder rows on this quote (`bids`, from
 * portalBidRowsFor). No rows → unavailable (fails closed).
 *
 * Task 3 (Jeff 2026-10-15) — the customer (owner) of a quote that has bidders (`opts.hasBidders`, from
 * portalOwnerHasBidders) sees it as a BOM with no prices: an ok state carries `bomOnly: true`, before and after the
 * award. The revision is unchanged (the owner's latest sent); revising and unavailable are unchanged.
 */
export function portalOnlineEstimateState(q: Quote, customerId: string, bids: readonly PortalBidRow[] = [], opts: PortalOwnerOpts = {}): PortalOnlineState {
  if (!customerId || isImportedHistoryQuote(q)) return { kind: "unavailable" };
  if (q.customerId === customerId) {
    const s = onlineEstimateState(q);
    if (s.kind === "ok" && !portalListsQuote(q, customerId)) return { kind: "unavailable" };
    if (s.kind === "ok" && opts.hasBidders === true) return { ...s, bomOnly: true };
    return s;
  }
  const b = portalBidState(q, customerId, bids);
  if (b.kind === "ok") return { kind: "ok", rev: b.bid.rev, closed: b.closed, bidder: b.bid };
  return b;
}

/** #348 slice 6 — the bidder's own PDF: its ok state's party + revision (closed included), else null. Never for the customer. */
export function portalBidPdfSource(q: Quote, cid: string, bids: readonly PortalBidRow[]): { partyId: string; rev: number; name: string } | null {
  const b = portalBidState(q, cid, bids);
  return b.kind === "ok" ? { partyId: b.bid.partyId, rev: b.bid.rev.rev, name: b.bid.rev.name || q.name } : null;
}
