import { requireUser } from "@/lib/session";
import { get as getPart } from "@/lib/stores/catalog";
import { getBlobStream } from "@/lib/blob";
import { resolvePartDatasheet } from "@/lib/part-docs/datasheet-bridge";

/**
 * Authenticated part-datasheet proxy (D116, punch #39 Task 5) — kept as a
 * bridge for the older readers that still link here by SKU (the Grid
 * editor, the pre-v1 Displays route, bookmarks). Part documents (#207): the
 * part's own live datasheet document wins — this redirects to it in the new
 * viewer (`/api/part-documents/<id>`), a stored file first, else a link-only
 * one (which the viewer sends on to its source URL). The legacy
 * `datasheetBlobKey` streams only while the backfill has not reached the
 * part (src/lib/part-docs/datasheet-bridge.ts), so a replaced or detached
 * legacy file never resurfaces here.
 *
 * The [id] segment is the part's SKU (== its catalog doc id). SKUs can
 * contain colons, so every link into this route URL-encodes the segment.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const sku = decodeURIComponent(id);
  const part = await getPart(sku);
  if (!part) return new Response("Not found", { status: 404 });
  const target = await resolvePartDatasheet(part);
  if (!target) return new Response("Not found", { status: 404 });
  if (target.kind === "document") {
    return Response.redirect(new URL(`/api/part-documents/${encodeURIComponent(target.documentId)}`, req.url), 302);
  }
  const stream = await getBlobStream(target.blobKey);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, {
    headers: { "content-type": "application/pdf", "cache-control": "private, max-age=86400" },
  });
}
