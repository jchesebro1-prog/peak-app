import { attachmentDisposition } from "@/lib/document-files";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { signPrintToken, type PrintTokenKind } from "@/lib/quote-pdf/token";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";

/**
 * One headless-Chrome render of a system estimate's signed print route, shared
 * by the Cover PDF (#301) and the BOM quote PDF — a fix to the policy (id cap,
 * system quotes only, secret/origin checks, budgets, error mapping) lands once.
 * `signedPdfResponse` is the matching staff-route tail. Server-only.
 */

/** The render's own budget: it fails cleanly inside the route's maxDuration (a worst-case render is ~90 s plus the queue). */
export const SIGNED_PRINT_RENDER_TIMEOUT_MS = 45_000;
/** Bounds the queue wait too. */
export const SIGNED_PRINT_RENDER_DEADLINE_MS = 55_000;

/** `status` mirrors the route's answer: 404 not a system estimate / unknown,
 *  503 not set up here (secret, origin, Chrome), 500 the render failed. */
export type SignedPrintRender = { ok: true; pdf: Buffer; fileName: string } | { ok: false; status: 404 | 500 | 503; error: string };

export type SignedPrintRenderOptions = {
  quoteId: string;
  /** The request's (x-forwarded-)host and proto — printOriginFor decides the origin. */
  host: string | null;
  proto: string | null;
  /** The print token's kind (domain-separated per caller). */
  kind: PrintTokenKind;
  /** The print route's path + query for this quote and its signed token. */
  path: (id: string, token: string) => string;
  fileName: (q: Quote) => string;
  /** Answers for a server without AUTH_SECRET / for a failed render. */
  noSecret: string;
  failed: string;
  /** Console prefix for an unexpected failure. */
  logTag: string;
  /** A quote this render refuses (404, like a non-system quote) — the Cover PDF refuses a box goods sale. */
  refuse?: (q: Quote) => boolean;
};

export async function renderSignedQuotePrintPdf(opts: SignedPrintRenderOptions): Promise<SignedPrintRender> {
  try {
    const { quoteId } = opts;
    if (!quoteId || quoteId.length > 64) return { ok: false, status: 404, error: "Not found" };
    const q = await getQuote(quoteId);
    if (!q || pdfKindForQuoteType(q.quoteType) !== "quote" || opts.refuse?.(q)) return { ok: false, status: 404, error: "Not found" };
    const secret = process.env.AUTH_SECRET || "";
    if (!secret) return { ok: false, status: 503, error: opts.noSecret };
    const where = printOriginFor(process.env, opts.host, opts.proto);
    if ("error" in where) return { ok: false, status: 503, error: where.error };
    const t = signPrintToken(secret, opts.kind, q.id, Date.now());
    const pdf = await renderPrintRouteToPdf(`${where.origin}${opts.path(q.id, t)}`, {
      timeoutMs: SIGNED_PRINT_RENDER_TIMEOUT_MS,
      signal: AbortSignal.timeout(SIGNED_PRINT_RENDER_DEADLINE_MS),
    });
    return { ok: true, pdf, fileName: opts.fileName(q) };
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return { ok: false, status: 503, error: e.message };
    console.error(`[${opts.logTag}] PDF render failed`, e);
    return { ok: false, status: 500, error: opts.failed };
  }
}

/** The staff routes' shared tail: a failed render answers plain text; a good one the PDF, inline or (`download`) as an attachment. */
export function signedPdfResponse(r: SignedPrintRender, download: boolean): Response {
  if (!r.ok) {
    return new Response(r.error, { status: r.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  }
  const disposition = attachmentDisposition(r.fileName);
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": download ? disposition : "inline" + disposition.slice("attachment".length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
