import { requireUser } from "@/lib/session";
import { getBlobStream } from "@/lib/blob";
import { getDocument } from "@/lib/stores/part-documents";
import { contentDisposition, contentTypeForFileName } from "@/lib/part-docs/files";

/**
 * Part-document viewer (#DOC, spec §7): signed-in only. Streams the private
 * blob; a link-only document (no stored file yet) redirects to its source
 * URL instead. `?history=<n>` streams the n-th replaced file — nothing is
 * ever deleted, so every earlier version stays viewable.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const doc = await getDocument(decodeURIComponent(id));
  if (!doc) return new Response("Not found", { status: 404 });

  let blobKey = doc.blobKey;
  let fileName = doc.fileName;
  const h = new URL(req.url).searchParams.get("history");
  if (h !== null) {
    const entry = /^\d+$/.test(h) ? doc.history?.[Number(h)] : undefined;
    if (!entry) return new Response("Not found", { status: 404 });
    blobKey = entry.blobKey;
    fileName = entry.fileName;
  }

  if (!blobKey) {
    if (h === null && doc.sourceUrl && /^https?:\/\//i.test(doc.sourceUrl)) return Response.redirect(doc.sourceUrl, 302);
    return new Response("Not found", { status: 404 });
  }
  const stream = await getBlobStream(blobKey);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": h === null ? doc.contentType || contentTypeForFileName(fileName) : contentTypeForFileName(fileName),
      "content-disposition": contentDisposition(fileName),
      // A replace writes a NEW blob and moves the old one to history, so the
      // bytes behind one (id, history) pair never change — but the current
      // file of an id does, so the cache stays short.
      "cache-control": h === null ? "private, max-age=300" : "private, max-age=86400",
    },
  });
}
