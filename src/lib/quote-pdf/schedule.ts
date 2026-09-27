import { after } from "next/server";
import { headers } from "next/headers";
import { get as getQuote, updateQuotePdf } from "@/lib/stores/quotes";
import { generateQuotePdf, PDF_COALESCE_MS } from "./generate";
import { printOriginFor } from "./origin";
import { canHavePdf, failedPdf, pdfView, pendingPdf, stalePdf, type QuotePdfView } from "./state";

/**
 * Mark a just-saved quote's PDF pending and render it after the response
 * (#222). Call from a server action AFTER the quote write and BEFORE any
 * status change in the same save (a send then waits for this render; the
 * generator copies it onto the sent revision). Every writer that changes what
 * the document shows calls this — saves, Grid / Quick Design promotes, the
 * renewal re-price, a revision recall. Never throws: a save must not fail
 * because its PDF can't be scheduled. The render's time budget is the calling
 * page's `maxDuration` (after.md) — every page whose actions call this sets
 * one (120 s).
 *
 * The state moves only through updateQuotePdf (a locked compare-and-set), and
 * a quote type with no PDF (consulting, rentals) is never marked pending.
 * The print origin comes from printOriginFor: QUOTE_PDF_ORIGIN when set, the
 * request's own host on Vercel or in development, and a failed PDF with the
 * reason on a production server off Vercel without it.
 *
 * Outside a request (no headers(), so no after() either) nothing can render:
 * the PDF is only marked stale — pending for this newer save — so the
 * sent-revision copy never takes the older file (copySentRevisionPdf also
 * checks the quote's contentChangedAt) and the preview offers a retry.
 */
export async function scheduleQuotePdf(quoteId: string, opts: { savedAt?: number } = {}): Promise<QuotePdfView | null> {
  try {
    const q = await getQuote(quoteId);
    if (!q || !canHavePdf(q.quoteType)) return null;
    const savedAt = opts.savedAt ?? Date.now();
    let h: Awaited<ReturnType<typeof headers>> | null = null;
    try {
      h = await headers();
    } catch {
      h = null;
    }
    if (!h) return await markQuotePdfStale(quoteId, savedAt);
    const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
    if ("error" in where) {
      const res = await updateQuotePdf(quoteId, (cur) => failedPdf(cur, savedAt, where.error, Date.now()));
      return pdfView(res?.after, Date.now());
    }
    const origin = where.origin;
    const res = await updateQuotePdf(quoteId, (cur) => pendingPdf(cur, savedAt, Date.now()));
    if (!res || res.after?.status !== "pending" || res.after.savedAt !== savedAt) return pdfView(res?.after, Date.now());
    after(async () => {
      await generateQuotePdf({ quoteId, savedAt, origin, coalesceMs: PDF_COALESCE_MS });
    });
    return pdfView(res.after, Date.now());
  } catch (e) {
    console.error("[quote-pdf] scheduling failed", quoteId, e);
    return null;
  }
}

/**
 * Mark an existing PDF stale for a newer save without rendering (#222 fix
 * wave 1): pending for `savedAt`, keeping the last good file for the preview,
 * and marked `stale` — nothing renders it, so the preview reads "Out of date"
 * with Retry, and Retry reschedules at once (pdfRetryPlan).
 * For writers with no request to render in (scripts) or that change many
 * quotes at once (the CSV import). A quote with no PDF yet, or whose PDF
 * state is already for this save or a newer one, is left alone. Never throws.
 */
export async function markQuotePdfStale(quoteId: string, savedAt: number = Date.now()): Promise<QuotePdfView | null> {
  try {
    const res = await updateQuotePdf(quoteId, (cur) => (cur && cur.savedAt < savedAt ? stalePdf(cur, savedAt, Date.now()) : undefined));
    return pdfView(res?.after, Date.now());
  } catch (e) {
    console.error("[quote-pdf] marking stale failed", quoteId, e);
    return null;
  }
}
