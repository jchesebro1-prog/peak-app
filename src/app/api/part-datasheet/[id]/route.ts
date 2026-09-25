import { requireUser } from "@/lib/session";
import { get as getPart } from "@/lib/stores/catalog";
import { getBlobStream } from "@/lib/blob";
import { allDocumentLinks, allDocuments } from "@/lib/stores/part-documents";

/**
 * Authenticated part-datasheet proxy (D116, punch #39 Task 5) — kept as a
 * bridge for the older readers that still link here by SKU (the Grid
 * editor, the pre-v1 Displays route, bookmarks). Part documents (#207):
 * a part still carrying the legacy `datasheetBlobKey` streams it exactly as
 * before; otherwise this redirects to the part's own datasheet document in
 * the new viewer (`/api/part-documents/<id>`) — a stored file first, else a
 * link-only one (which the viewer sends on to its source URL).
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
  if (part.datasheetBlobKey) {
    const stream = await getBlobStream(part.datasheetBlobKey);
    if (!stream) return new Response("File missing from storage", { status: 404 });
    return new Response(stream, {
      headers: { "content-type": "application/pdf", "cache-control": "private, max-age=86400" },
    });
  }
  const linked = new Set((await allDocumentLinks()).filter((l) => l.partSku === sku && l.kind === "datasheet").map((l) => l.documentId));
  const docs = (await allDocuments()).filter((d) => linked.has(d.id));
  const best = docs.find((d) => d.blobKey) ?? docs.find((d) => d.sourceUrl);
  if (!best) return new Response("Not found", { status: 404 });
  return Response.redirect(new URL(`/api/part-documents/${encodeURIComponent(best.id)}`, req.url), 302);
}
