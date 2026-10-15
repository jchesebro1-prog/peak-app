import { attachmentDisposition } from "@/lib/document-files";
import { renderBidderPdf } from "@/lib/quote-pdf/bidder-pdf-server";
import { requireUser } from "@/lib/session";

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
  const r = await renderBidderPdf(id, partyId, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
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
