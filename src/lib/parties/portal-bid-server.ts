/* #348 slice 6 — the ONLY portal code that reads `record_parties`. Portal routes and pages import this module, never
   stores/parties, stores/bids or addressee-server (pinned). The rule itself is pure (portal-bid.ts, composed by
   quote-pdf/portal-access.ts); this module loads the rows it decides over and serves the bidder's own PDF. */
import { attachmentDisposition } from "@/lib/document-files";
import { getCompany } from "@/lib/identity/companies";
import { bidderPdfFileName } from "@/lib/parties/addressee";
import { bidderPartyFor } from "@/lib/parties/addressee-server";
import { catalogFor } from "@/lib/estimate-output/package-loader";
import { PORTAL_BID_COPY, quoteHasBidders, type PortalBidRow } from "@/lib/parties/portal-bid";
import { ownerBom, ownerBomSkus, type OwnerBom } from "@/lib/parties/portal-owner-bom";
import type { Party } from "@/lib/parties/rules";
import { renderBidderPdf } from "@/lib/quote-pdf/bidder-pdf-server";
import { rateLimit } from "@/lib/rate-limit";
import { listFor, listForCompany, listForRecords } from "@/lib/stores/parties";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";

/** Only the fields the rule reads — the portal never holds a party's contact, author or timestamps. */
function toRow(p: Party): PortalBidRow {
  return { id: p.id, recordType: p.recordType, recordId: p.recordId, companyId: p.companyId, role: p.role, bid: p.bid };
}

/** A live GC/EC quote bidder row of this company (the pure rule re-checks every one of these). */
function isCompanyBidRow(p: Party, cid: string): boolean {
  return !!p && !!p.id && p.recordType === "quote" && p.companyId === cid && (p.role === "gc" || p.role === "ec") && !!p.bid;
}

/** This company's bidder rows on one quote — [] without a read when cid is the quote's customer (or empty). */
export async function portalBidRowsFor(q: Pick<Quote, "id" | "customerId">, cid: string): Promise<PortalBidRow[]> {
  if (!cid || !q?.id || q.customerId === cid) return [];
  const rows = await listFor("quote", q.id);
  return rows.filter((p) => p.recordId === q.id && isCompanyBidRow(p, cid)).map(toRow);
}

/** Every quote bidder row of this company (listForCompany — indexed), for Home. */
export async function portalBidRowsForCompany(cid: string): Promise<PortalBidRow[]> {
  if (!cid) return [];
  return (await listForCompany(cid)).filter((p) => isCompanyBidRow(p, cid)).map(toRow);
}

/** Task 3 (Jeff 2026-10-15) — whether this quote has bidders (quoteHasBidders over one indexed listFor read). Takes no
 *  company: the caller decides it is the owner (q.customerId === cid); a bidder company is the bidder rule's call. */
export async function portalQuoteHasBidders(q: Pick<Quote, "id">): Promise<boolean> {
  if (!q?.id) return false;
  return quoteHasBidders(q.id, (await listFor("quote", q.id)).map(toRow));
}

/** Task 3 — Home: which of these quotes have bidders, in one read bounded to those ids (listForRecords, chunked). */
export async function portalBidderQuoteIds(quoteIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(quoteIds.filter((id) => typeof id === "string" && !!id))];
  if (!ids.length) return out;
  for (const [id, rows] of await listForRecords("quote", ids)) {
    if (quoteHasBidders(id, rows.map(toRow))) out.add(id);
  }
  return out;
}

/** Task 3 — the owner's BOM-only view of a bid estimate's sent revision: the pure ownerBom over the package page's
 *  catalog read (catalogFor never fails the page — a read error leaves Manufacturer / Model blank). */
export async function portalOwnerBom(q: Quote, rev: QuoteRevision, preparedFor: string): Promise<OwnerBom> {
  return ownerBom(q, rev, await catalogFor(ownerBomSkus(rev)), preparedFor);
}

export const PORTAL_BID_PDF_PER_MIN = 6;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

async function bidderCompanyName(partyId: string, quoteId: string): Promise<string> {
  const party = await bidderPartyFor(quoteId, partyId);
  return party ? ((await getCompany(party.companyId))?.name ?? "") : "";
}

/** The bidder's PDF response: rate limit (key by grant, or `preview:<cid>`) → render(q.id, partyId, host, proto, { rev })
 *  → inline application/pdf, nosniff, private no-store, file name bidderPdfFileName(src.name, companyName, src.rev)
 *  (the revision's name — never a later one). 404 → "Not found"; 503/500 → PORTAL_BID_COPY.pdfUnavailable with the same
 *  status (controller decision: the render's own text can name server env vars, so it is logged, never shown). */
export async function portalBidPdfResponse(
  req: Request,
  src: { partyId: string; rev: number; name: string },
  ctx: { quoteId: string; rlKey: string },
  deps: { render?: typeof renderBidderPdf; companyName?: (partyId: string) => Promise<string> } = {}
): Promise<Response> {
  if (!rateLimit(ctx.rlKey, PORTAL_BID_PDF_PER_MIN, 60_000).ok) return text("Too many requests", 429);
  const h = req.headers;
  const render = deps.render ?? renderBidderPdf;
  const r = await render(ctx.quoteId, src.partyId, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"), { rev: src.rev });
  if (!r.ok) {
    if (r.status === 404) return text("Not found", 404);
    console.error(`[portal-bid-pdf] ${ctx.quoteId}: render failed (${r.status})`, r.error);
    return text(PORTAL_BID_COPY.pdfUnavailable, r.status);
  }
  const companyName = deps.companyName ? await deps.companyName(src.partyId) : await bidderCompanyName(src.partyId, ctx.quoteId);
  // The revision's own name and number — the render's file name follows the live quote, so it is never used here.
  const disposition = attachmentDisposition(bidderPdfFileName(src.name, companyName, src.rev));
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": "inline" + disposition.slice("attachment".length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
