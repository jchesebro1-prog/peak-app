import { displayQuoteNumber } from "@/lib/estimate-number";
import { renderSignedQuotePrintPdf, SIGNED_PRINT_RENDER_DEADLINE_MS, SIGNED_PRINT_RENDER_TIMEOUT_MS, type SignedPrintRender } from "@/lib/quote-pdf/signed-print-pdf";
import { coverPdfFileName } from "./cover";

/**
 * #301 slice A (R7) — one headless-Chrome render of a system estimate's 1–2
 * page cover, from the LIVE quote through the signed /print/cover/[id] route.
 * Shared by the staff cover-pdf route and the Estimator's Phase 3 send action
 * (which attaches it) — neither calls the other over HTTP. The render itself is the shared renderSignedQuotePrintPdf. Server-only.
 */

/** The shared render's budgets (see signed-print-pdf.ts). */
export const COVER_RENDER_TIMEOUT_MS = SIGNED_PRINT_RENDER_TIMEOUT_MS;
export const COVER_RENDER_DEADLINE_MS = SIGNED_PRINT_RENDER_DEADLINE_MS;

export const COVER_RENDER_FAILED = "The cover PDF couldn’t be rendered — try again.";
export const COVER_NO_SECRET = "Cover PDFs aren’t set up on this server (AUTH_SECRET is missing).";

/** `status` mirrors the route's answer: 404 not a system estimate / unknown,
 *  503 not set up here (secret, origin, Chrome), 500 the render failed. */
export type CoverRender = SignedPrintRender;

/** `host` / `proto`: the request's (x-forwarded-)host and proto — printOriginFor decides the origin. */
export function renderCoverPdf(quoteId: string, host: string | null, proto: string | null): Promise<CoverRender> {
  return renderSignedQuotePrintPdf({
    quoteId,
    host,
    proto,
    kind: "cover",
    path: (id, t) => `/print/cover/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`,
    fileName: (q) => coverPdfFileName(displayQuoteNumber(q)),
    noSecret: COVER_NO_SECRET,
    failed: COVER_RENDER_FAILED,
    logTag: "cover",
  });
}
