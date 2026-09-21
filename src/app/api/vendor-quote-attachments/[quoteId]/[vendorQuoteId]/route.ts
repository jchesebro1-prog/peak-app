import { requireUser } from "@/lib/session";
import { dataUrlToBytes, getBlobStream, safeName } from "@/lib/blob";
import { get as getQuote } from "@/lib/stores/quotes";

type VendorQuoteAttachment = {
  name?: string;
  mime?: string;
  dataUrl?: string;
  blobPath?: string;
};

type VendorQuoteRecord = { id: string; attachment?: VendorQuoteAttachment };

/** Authenticated vendor-quote attachment proxy. Files stored in private Blob
 * storage are streamed here; local fallback data-URLs remain downloadable
 * after reload without changing the quote document shape. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ quoteId: string; vendorQuoteId: string }> }
) {
  await requireUser();
  const { quoteId, vendorQuoteId } = await ctx.params;
  const quote = await getQuote(decodeURIComponent(quoteId));
  const vendorQuotes = Array.isArray(quote?.vendorQuotes)
    ? (quote.vendorQuotes as VendorQuoteRecord[])
    : [];
  const vendorQuote = vendorQuotes.find((item) => item.id === decodeURIComponent(vendorQuoteId));
  const attachment = vendorQuote?.attachment;
  if (!attachment) return new Response("Not found", { status: 404 });

  const headers = {
    "content-type": attachment.mime || "application/octet-stream",
    "content-disposition": `attachment; filename="${safeName(attachment.name || "vendor-quote")}"`,
    "cache-control": "private, max-age=86400",
  };

  if (attachment.blobPath) {
    const stream = await getBlobStream(attachment.blobPath);
    if (!stream) return new Response("File missing from storage", { status: 404 });
    return new Response(stream, { headers });
  }

  if (attachment.dataUrl) {
    try {
      const { bytes, mime } = dataUrlToBytes(attachment.dataUrl);
      return new Response(bytes as unknown as BodyInit, {
        headers: { ...headers, "content-type": attachment.mime || mime },
      });
    } catch {
      return new Response("Attachment is unreadable", { status: 422 });
    }
  }

  return new Response("File not found", { status: 404 });
}
