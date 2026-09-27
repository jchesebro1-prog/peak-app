import { requireUser } from "@/lib/session";
import { getBlobStream, isBlobNotFound } from "@/lib/blob";
import { documentDownloadHeaders } from "@/lib/document-files";
import { getDocument, markSeen } from "@/lib/stores/documents";

/**
 * Team document download (#218). Signed-in only. Streams the private blob
 * as `application/octet-stream` + `attachment` + `nosniff` + `no-store` —
 * never rendered by the browser, whatever the file really is. Opening a
 * customer upload marks it seen (it leaves the to-do bell).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params; // already decoded by Next's router
  const doc = await getDocument(id);
  if (!doc) return new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  const missing = () => new Response("File missing", { status: 404, headers: { "cache-control": "private, no-store" } });
  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobPath);
  } catch (e) {
    // A blob that's gone is a missing file (404), not a storage outage.
    if (isBlobNotFound(e)) return missing();
    // Never surface the Blob vendor's own error text.
    return new Response("Couldn't read the file — try again", { status: 502, headers: { "cache-control": "private, no-store" } });
  }
  if (!stream) return missing();
  if (doc.source === "customer" && doc.seenByTeamAt == null) {
    try {
      await markSeen([doc.id]);
    } catch {
      /* the download matters more than the bell — it stays unseen */
    }
  }
  return new Response(stream, { headers: documentDownloadHeaders(doc.fileName) });
}
