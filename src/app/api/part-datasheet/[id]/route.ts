import { requireUser } from "@/lib/session";
import { get as getPart } from "@/lib/stores/catalog";
import { getBlobStream } from "@/lib/blob";

/**
 * Authenticated part-datasheet proxy (D116, punch #39 Task 5) — same shape
 * as /api/grid-sheets/[id]: the Blob store is PRIVATE, so the browser only
 * ever reaches the file through a signed-in session, streamed server-side.
 *
 * The [id] segment is the part's SKU (== its catalog doc id, see
 * lib/stores/catalog.ts). SKUs can contain colons (e.g. "Brand:Model"), so
 * every link into this route URL-encodes the segment (encodeURIComponent)
 * and this handler decodes it before lookup — the same contract
 * /api/grid-sheets/[id] uses for its id.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  await requireUser();
  const { id } = await ctx.params;
  const sku = decodeURIComponent(id);
  const part = await getPart(sku);
  if (!part || !part.datasheetBlobKey) return new Response("Not found", { status: 404 });
  const stream = await getBlobStream(part.datasheetBlobKey);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": "application/pdf",
      // Private to the signed-in user's browser; datasheets are immutable
      // once uploaded (a replace mints a new blob), so a day of caching is
      // safe and keeps re-opens from re-fetching the whole file.
      "cache-control": "private, max-age=86400",
    },
  });
}
