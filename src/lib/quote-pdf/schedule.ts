import { after } from "next/server";
import { headers } from "next/headers";
import { get as getQuote, updateQuotePdf } from "@/lib/stores/quotes";
import { generateQuotePdf } from "./generate";
import { originFrom } from "./origin";
import { canHavePdf, failedPdf, pdfView, pendingPdf, type QuotePdfView } from "./state";

/**
 * Mark a just-saved quote's PDF pending and render it after the response
 * (#222). Call from a server action AFTER the quote write and BEFORE any
 * status change in the same save (a send then waits for this render; the
 * generator copies it onto the sent revision). Never throws: a save must not
 * fail because its PDF can't be scheduled. The render's time budget is the
 * calling page's `maxDuration` (after.md) — every page whose actions call this
 * sets one.
 *
 * The state moves only through updateQuotePdf (a locked compare-and-set), and
 * a quote type with no PDF (consulting, rentals) is never marked pending.
 * Production pins the print origin with QUOTE_PDF_ORIGIN (DEPLOY.md); without
 * it the request's own host is used.
 */
export async function scheduleQuotePdf(quoteId: string, opts: { savedAt?: number } = {}): Promise<QuotePdfView | null> {
  try {
    const q = await getQuote(quoteId);
    if (!q || !canHavePdf(q.quoteType)) return null;
    const savedAt = opts.savedAt ?? Date.now();
    const h = await headers();
    const origin = originFrom(h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"), process.env.QUOTE_PDF_ORIGIN);
    if (!origin) {
      const res = await updateQuotePdf(quoteId, (cur) => failedPdf(cur, savedAt, "Couldn’t work out this server’s address to print from (set QUOTE_PDF_ORIGIN).", Date.now()));
      return pdfView(res?.after, Date.now());
    }
    const res = await updateQuotePdf(quoteId, (cur) => pendingPdf(cur, savedAt, Date.now()));
    if (!res || res.after?.status !== "pending" || res.after.savedAt !== savedAt) return pdfView(res?.after, Date.now());
    after(async () => {
      await generateQuotePdf({ quoteId, savedAt, origin });
    });
    return pdfView(res.after, Date.now());
  } catch (e) {
    console.error("[quote-pdf] scheduling failed", quoteId, e);
    return null;
  }
}
