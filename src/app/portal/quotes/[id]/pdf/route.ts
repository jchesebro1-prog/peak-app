import { resolvePortalViewer } from "@/lib/portal-viewer";
import { pdfResponse } from "@/lib/quote-pdf/http";
import { portalQuotePdfPreparing, portalQuotePdfSource } from "@/lib/quote-pdf/portal-access";
import { pdfFileName } from "@/lib/quote-pdf/state";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";

/**
 * A quote's PDF for the customer portal (#222). The customer comes from the
 * portal session (or a team preview) only; the quote must be this customer's
 * and pass the portal's list rule. A sent quote serves only the latest sent
 * revision's copy — while that copy is still being made it is a 404 saying
 * so, never the current file (which may carry edits made after the send). A
 * quote never sent serves its current READY file (portalQuotePdfSource), so
 * an unsent draft's PDF is only ever the customer's own self-serve estimate.
 * Anything else is a plain 404 — no hint whether the quote exists.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { session } = await resolvePortalViewer(new URL(req.url).searchParams.get("preview") || "");
  if (!session) return new Response("Not found", { status: 404 });
  const q = await getQuote(id);
  const src = q ? portalQuotePdfSource(q, session.customerId) : null;
  if (q && !src && portalQuotePdfPreparing(q, session.customerId)) {
    return new Response("This quote’s PDF is being prepared — try again in a minute.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
    });
  }
  if (!q || !src) return new Response("Not found", { status: 404 });
  return pdfResponse(src.path, pdfFileName(q.id, src.rev), false);
}
