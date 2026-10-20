import { attachmentDisposition } from "@/lib/document-files";
import { renderBidderPdf } from "@/lib/quote-pdf/bidder-pdf-server";
import { bidderPdfRev } from "@/lib/parties/bid-send";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/**
 * #348 slice 2b-i — a system estimate addressed to one bidder, for staff: rendered on demand through the signed
 * /print/quote/[id]?bidder= variant. `?download=1` downloads; otherwise it opens inline. An unknown quote, a
 * service quote and a party that isn't a bidder on that quote all answer the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; partyId: string }> }) {
  // Outside the render: a signed-out request redirects to the login page.
  await requireUser();
  const { id, partyId } = await params;
  const h = request.headers;
  // Once the quote is sent this is the version that was sent (its latest sent revision); while a draft, the live document.
  const q = id && id.length <= 64 ? await getQuote(id) : null;
  if (!q) return text("Not found", 404);
  const r = await renderBidderPdf(id, partyId, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"), { rev: bidderPdfRev(q) });
  if (!r.ok) return text(r.error, r.status);
  const disposition = attachmentDisposition(r.fileName);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": download ? disposition : "inline" + disposition.slice("attachment".length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
