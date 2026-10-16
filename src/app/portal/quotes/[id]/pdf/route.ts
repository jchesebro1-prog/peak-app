import { resolvePortalViewer } from "@/lib/portal-viewer";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { pdfResponse } from "@/lib/quote-pdf/http";
import { portalBidPdfSource, portalQuotePdfPreparing, portalQuotePdfSource, portalQuotePdfUnavailable } from "@/lib/quote-pdf/portal-access";
import { portalBidPdfResponse, portalBidRowsFor, portalOwnerHasBidders } from "@/lib/parties/portal-bid-server";
import { pdfFileName } from "@/lib/quote-pdf/state";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";
// #348 slice 6: a bidder's PDF renders on demand (headless Chrome).
export const maxDuration = 60;

/**
 * A quote's PDF for the customer portal (#222). The customer comes from the
 * portal session (or a team preview) only; the quote must be this customer's
 * and pass the portal's list rule. A sent quote serves only the latest sent
 * revision's copy — while that copy is still being made it is a 404 saying
 * so, never the current file (which may carry edits made after the send);
 * when it can never arrive (sent before saved PDFs, or edited after the send)
 * the 404 says to contact the rep. A
 * quote never sent serves its current READY file (portalQuotePdfSource), so
 * an unsent draft's PDF is only ever the customer's own self-serve estimate.
 * Anything else is a plain 404 — no hint whether the quote exists.
 *
 * #348 slice 6 — a GC/EC bidder company gets its OWN addressed revision,
 * rendered on demand (portalBidPdfResponse: 6 a minute per grant), never the
 * customer's file. The customer code below it is unchanged.
 *
 * Task 3 (Jeff 2026-10-15) — the owner of a quote that has bidders gets no PDF
 * at all (its portal is a BOM with no prices): a plain 404, before the
 * being-prepared / unavailable answers.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { session, preview } = await resolvePortalViewer(new URL(req.url).searchParams.get("preview") || "");
  if (!session) return new Response("Not found", { status: 404 });
  const q = await getQuote(id);
  const bids = q ? await portalBidRowsFor(q, session.customerId) : [];
  const bid = q ? portalBidPdfSource(q, session.customerId, bids) : null;
  if (q && bid) {
    return portalBidPdfResponse(req, bid, {
      quoteId: q.id,
      rlKey: preview ? `portal-bidpdf:preview:${session.customerId}` : `portal-bidpdf:${session.grantId}`,
    });
  }
  // Task 3: the owner of a bid estimate — one indexed read, only for the quote's own customer.
  const hasBidders = q ? await portalOwnerHasBidders(q, session.customerId) : false;
  if (q && hasBidders) return new Response("Not found", { status: 404 });
  const src = q ? portalQuotePdfSource(q, session.customerId, { hasBidders }) : null;
  if (q && !src && portalQuotePdfPreparing(q, session.customerId)) {
    return new Response("This quote’s PDF is being prepared — try again in a minute.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
    });
  }
  if (q && !src && portalQuotePdfUnavailable(q, session.customerId)) {
    return new Response("No PDF is available for this version — please contact your rep.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
    });
  }
  if (!q || !src) return new Response("Not found", { status: 404 });
  return pdfResponse(src.path, pdfFileName(displayQuoteNumber(q), src.rev), false);
}
