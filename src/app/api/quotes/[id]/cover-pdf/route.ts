import { attachmentDisposition } from "@/lib/document-files";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { coverPdfFileName } from "@/lib/estimate-output/cover";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

/** R7: one headless-Chrome render of a 1–2 page cover. */
export const maxDuration = 60;
/** The render's own budget: it fails cleanly inside maxDuration (a worst-case render is ~90 s plus the queue). */
const COVER_RENDER_TIMEOUT_MS = 45_000;
const COVER_RENDER_DEADLINE_MS = 55_000;
export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/**
 * #301 slice A — a system estimate's cover PDF for staff (D-p, R7): rendered
 * on demand from the live quote through the signed /print/cover/[id] route.
 * `?download=1` downloads; otherwise it opens inline. A service quote and an
 * unknown id answer the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Outside the try: a signed-out request redirects to the login page.
  await requireUser();
  try {
    const { id } = await params;
    if (!id || id.length > 64) return text("Not found", 404);
    const q = await getQuote(id);
    if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return text("Not found", 404);
    const secret = process.env.AUTH_SECRET || "";
    if (!secret) return text("Cover PDFs aren’t set up on this server (AUTH_SECRET is missing).", 503);
    const h = request.headers;
    const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
    if ("error" in where) return text(where.error, 503);
    const t = signPrintToken(secret, "cover", q.id, Date.now());
    const pdf = await renderPrintRouteToPdf(`${where.origin}/print/cover/${encodeURIComponent(q.id)}?t=${encodeURIComponent(t)}`, {
      timeoutMs: COVER_RENDER_TIMEOUT_MS,
      // Bounds the queue wait too.
      signal: AbortSignal.timeout(COVER_RENDER_DEADLINE_MS),
    });
    const disposition = attachmentDisposition(coverPdfFileName(displayQuoteNumber(q)));
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": download ? disposition : "inline" + disposition.slice("attachment".length),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return text(e.message, 503);
    console.error("[cover] cover PDF render failed", e);
    return text("The cover PDF couldn’t be rendered — try again.", 500);
  }
}
