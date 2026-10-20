import { displayQuoteNumber } from "@/lib/estimate-number";
import { renderSignedQuotePrintPdf, SIGNED_PRINT_RENDER_DEADLINE_MS, SIGNED_PRINT_RENDER_TIMEOUT_MS, type SignedPrintRender } from "@/lib/quote-pdf/signed-print-pdf";
import { bomPdfFileName } from "./bom-pdf";

/**
 * BOM quote PDF (2026-10-20 spec) — one headless-Chrome render of a system
 * estimate's itemized BOM view, from the SAVED quote through the signed
 * /print/quote/[id]?view=bom route (the estimate's own print page and token
 * kind; `view` only re-lays-out what the token already authorizes). The render is the
 * one shared with renderCoverPdf (renderSignedQuotePrintPdf). Never stored, never attached to a send. Server-only.
 */

/** The shared render's budgets (see signed-print-pdf.ts). */
export const BOM_RENDER_TIMEOUT_MS = SIGNED_PRINT_RENDER_TIMEOUT_MS;
export const BOM_RENDER_DEADLINE_MS = SIGNED_PRINT_RENDER_DEADLINE_MS;

export const BOM_RENDER_FAILED = "The BOM PDF couldn’t be rendered — try again.";
export const BOM_NO_SECRET = "BOM PDFs aren’t set up on this server (AUTH_SECRET is missing).";

/** `status` mirrors the route's answer: 404 not a system estimate / unknown,
 *  503 not set up here (secret, origin, Chrome), 500 the render failed. */
export type BomRender = SignedPrintRender;

/** `host` / `proto`: the request's (x-forwarded-)host and proto — printOriginFor decides the origin. */
export function renderBomPdf(quoteId: string, host: string | null, proto: string | null): Promise<BomRender> {
  return renderSignedQuotePrintPdf({
    quoteId,
    host,
    proto,
    kind: "quote",
    path: (id, t) => `/print/quote/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}&view=bom`,
    fileName: (q) => bomPdfFileName(displayQuoteNumber(q)),
    noSecret: BOM_NO_SECRET,
    failed: BOM_RENDER_FAILED,
    logTag: "bom-pdf",
  });
}
