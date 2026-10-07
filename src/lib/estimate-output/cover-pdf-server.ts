import { displayQuoteNumber } from "@/lib/estimate-number";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { get as getQuote } from "@/lib/stores/quotes";
import { coverPdfFileName } from "./cover";

/**
 * #301 slice A (R7) — one headless-Chrome render of a system estimate's 1–2
 * page cover, from the LIVE quote through the signed /print/cover/[id] route.
 * Shared by the staff cover-pdf route and the Estimator's Phase 3 send action
 * (which attaches it) — neither calls the other over HTTP. Server-only.
 */

/** The render's own budget: it fails cleanly inside the route's maxDuration (a worst-case render is ~90 s plus the queue). */
export const COVER_RENDER_TIMEOUT_MS = 45_000;
/** Bounds the queue wait too. */
export const COVER_RENDER_DEADLINE_MS = 55_000;

export const COVER_RENDER_FAILED = "The cover PDF couldn’t be rendered — try again.";
export const COVER_NO_SECRET = "Cover PDFs aren’t set up on this server (AUTH_SECRET is missing).";

/** `status` mirrors the route's answer: 404 not a system estimate / unknown,
 *  503 not set up here (secret, origin, Chrome), 500 the render failed. */
export type CoverRender = { ok: true; pdf: Buffer; fileName: string } | { ok: false; status: 404 | 500 | 503; error: string };

/** `host` / `proto`: the request's (x-forwarded-)host and proto — printOriginFor decides the origin. */
export async function renderCoverPdf(quoteId: string, host: string | null, proto: string | null): Promise<CoverRender> {
  try {
    if (!quoteId || quoteId.length > 64) return { ok: false, status: 404, error: "Not found" };
    const q = await getQuote(quoteId);
    if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, status: 404, error: "Not found" };
    const secret = process.env.AUTH_SECRET || "";
    if (!secret) return { ok: false, status: 503, error: COVER_NO_SECRET };
    const where = printOriginFor(process.env, host, proto);
    if ("error" in where) return { ok: false, status: 503, error: where.error };
    const t = signPrintToken(secret, "cover", q.id, Date.now());
    const pdf = await renderPrintRouteToPdf(`${where.origin}/print/cover/${encodeURIComponent(q.id)}?t=${encodeURIComponent(t)}`, {
      timeoutMs: COVER_RENDER_TIMEOUT_MS,
      signal: AbortSignal.timeout(COVER_RENDER_DEADLINE_MS),
    });
    return { ok: true, pdf, fileName: coverPdfFileName(displayQuoteNumber(q)) };
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return { ok: false, status: 503, error: e.message };
    console.error("[cover] cover PDF render failed", e);
    return { ok: false, status: 500, error: COVER_RENDER_FAILED };
  }
}
