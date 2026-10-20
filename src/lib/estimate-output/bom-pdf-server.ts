import { displayQuoteNumber } from "@/lib/estimate-number";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { get as getQuote } from "@/lib/stores/quotes";
import { bomPdfFileName } from "./bom-pdf";

/**
 * BOM quote PDF (2026-10-20 spec) — one headless-Chrome render of a system
 * estimate's itemized BOM view, from the SAVED quote through the signed
 * /print/quote/[id]?view=bom route (the estimate's own print page and token
 * kind; `view` only re-lays-out what the token already authorizes). Mirrors
 * renderCoverPdf. Never stored, never attached to a send. Server-only.
 */

/** The render's own budget: it fails cleanly inside the route's maxDuration. */
export const BOM_RENDER_TIMEOUT_MS = 45_000;
/** Bounds the queue wait too. */
export const BOM_RENDER_DEADLINE_MS = 55_000;

export const BOM_RENDER_FAILED = "The BOM PDF couldn’t be rendered — try again.";
export const BOM_NO_SECRET = "BOM PDFs aren’t set up on this server (AUTH_SECRET is missing).";

/** `status` mirrors the route's answer: 404 not a system estimate / unknown,
 *  503 not set up here (secret, origin, Chrome), 500 the render failed. */
export type BomRender = { ok: true; pdf: Buffer; fileName: string } | { ok: false; status: 404 | 500 | 503; error: string };

/** `host` / `proto`: the request's (x-forwarded-)host and proto — printOriginFor decides the origin. */
export async function renderBomPdf(quoteId: string, host: string | null, proto: string | null): Promise<BomRender> {
  try {
    if (!quoteId || quoteId.length > 64) return { ok: false, status: 404, error: "Not found" };
    const q = await getQuote(quoteId);
    if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, status: 404, error: "Not found" };
    const secret = process.env.AUTH_SECRET || "";
    if (!secret) return { ok: false, status: 503, error: BOM_NO_SECRET };
    const where = printOriginFor(process.env, host, proto);
    if ("error" in where) return { ok: false, status: 503, error: where.error };
    const t = signPrintToken(secret, "quote", q.id, Date.now());
    const pdf = await renderPrintRouteToPdf(`${where.origin}/print/quote/${encodeURIComponent(q.id)}?t=${encodeURIComponent(t)}&view=bom`, {
      timeoutMs: BOM_RENDER_TIMEOUT_MS,
      signal: AbortSignal.timeout(BOM_RENDER_DEADLINE_MS),
    });
    return { ok: true, pdf, fileName: bomPdfFileName(displayQuoteNumber(q)) };
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return { ok: false, status: 503, error: e.message };
    console.error("[bom-pdf] BOM PDF render failed", e);
    return { ok: false, status: 500, error: BOM_RENDER_FAILED };
  }
}
