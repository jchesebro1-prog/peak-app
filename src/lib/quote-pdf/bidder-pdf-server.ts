import { COVER_RENDER_DEADLINE_MS, COVER_RENDER_TIMEOUT_MS } from "@/lib/estimate-output/cover-pdf-server";
import { getCompany } from "@/lib/identity/companies";
import { bidderPdfFileName } from "@/lib/parties/addressee";
import { bidderPartyFor } from "@/lib/parties/addressee-server";
import { currentRev } from "@/lib/parties/bids";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { latestSentRevision, pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";

/** A sent revision keeps its own number; a live render of a quote that already has a sent revision is the NEXT one, named "(draft)". */
function liveBidderPdfName(q: Quote, bidderName: string, rev: number | null): string {
  if (rev != null) return bidderPdfFileName(q.name, bidderName, rev);
  const sent = latestSentRevision(q.revisions);
  return sent ? bidderPdfFileName(q.name, bidderName, sent.rev + 1, true) : bidderPdfFileName(q.name, bidderName, currentRev(q));
}

/**
 * #348 slice 2b-i — one headless-Chrome render of a system estimate addressed to ONE bidder, on demand, through
 * the signed /print/quote/[id]?bidder=… variant (the token's id is `${quoteId}~${partyId}` — plus `~r<rev>` for a sent revision — so a plain-id token
 * can't unlock it). Server-only. Every 404 path returns before any secret / origin check or render.
 */
export const BIDDER_PDF_FAILED = "The bidder PDF couldn’t be rendered — try again.";
export const BIDDER_PDF_NO_SECRET = "Bidder PDFs aren’t set up on this server (AUTH_SECRET is missing).";

export type BidderRender = { ok: true; pdf: Buffer; fileName: string } | { ok: false; status: 404 | 500 | 503; error: string };

export async function renderBidderPdf(
  quoteId: string,
  partyId: string,
  host: string | null,
  proto: string | null,
  opts: { rev?: number | null } = {}
): Promise<BidderRender> {
  try {
    if (!quoteId || quoteId.length > 64 || !partyId || partyId.length > 64) return { ok: false, status: 404, error: "Not found" };
    const q = await getQuote(quoteId);
    if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, status: 404, error: "Not found" };
    // 2b-ii: a rev must be one of the quote's SENT revisions — checked before the secret / origin and any render.
    const rev = opts.rev ?? null;
    if (rev != null && (!Number.isSafeInteger(rev) || rev < 1 || !(Array.isArray(q.revisions) ? q.revisions : []).some((r) => r.rev === rev && r.reason === "sent"))) {
      return { ok: false, status: 404, error: "Not found" };
    }
    const party = await bidderPartyFor(q.id, partyId);
    if (!party) return { ok: false, status: 404, error: "Not found" };
    const company = await getCompany(party.companyId);
    if (!company) return { ok: false, status: 404, error: "Not found" };
    const secret = process.env.AUTH_SECRET || "";
    if (!secret) return { ok: false, status: 503, error: BIDDER_PDF_NO_SECRET };
    const where = printOriginFor(process.env, host, proto);
    if ("error" in where) return { ok: false, status: 503, error: where.error };
    const t = signPrintToken(secret, "quote", rev != null ? `${q.id}~${party.id}~r${rev}` : `${q.id}~${party.id}`, Date.now());
    const pdf = await renderPrintRouteToPdf(
      `${where.origin}/print/quote/${encodeURIComponent(q.id)}?bidder=${encodeURIComponent(party.id)}${rev != null ? `&rev=${rev}` : ""}&t=${encodeURIComponent(t)}`,
      { timeoutMs: COVER_RENDER_TIMEOUT_MS, signal: AbortSignal.timeout(COVER_RENDER_DEADLINE_MS) }
    );
    return { ok: true, pdf, fileName: liveBidderPdfName(q, company.name, rev) };
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return { ok: false, status: 503, error: e.message };
    console.error("[bidder-pdf] render failed", e);
    return { ok: false, status: 500, error: BIDDER_PDF_FAILED };
  }
}
