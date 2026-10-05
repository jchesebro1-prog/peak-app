import { requireUser } from "@/lib/session";
import { getBlobStream } from "@/lib/blob";
import { getDocument } from "@/lib/stores/part-documents";
import { contentDisposition, contentTypeForFileName } from "@/lib/part-docs/files";

/** #300 (D608) — a stored SVG (a symbol/riser drawing, always sanitized on
 *  the way in) is still served sandboxed: opened directly in a tab it can
 *  run nothing, load nothing but inline data: images, and style only
 *  itself. Served INLINE (like every part document here) so `<img>` and
 *  SVG `<image>` can draw it. */
const SVG_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/**
 * Part-document viewer (#207, spec §7): signed-in only. Streams the private
 * blob; a link-only document (no stored file yet) redirects to its source
 * URL instead. `?history=<n>` streams the n-th replaced file — nothing is
 * ever deleted, so every earlier version stays viewable.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params; // already decoded by Next's router
  const doc = await getDocument(id);
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
  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(blobKey);
  } catch {
    // A Blob read failure (network, BlobError, …) — never surface the
    // vendor's own error text to the browser.
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return new Response("File missing from storage", { status: 404 });
  const contentType = h === null ? doc.contentType || contentTypeForFileName(fileName) : contentTypeForFileName(fileName);
  return new Response(stream, {
    headers: {
      "content-type": contentType,
      "content-disposition": contentDisposition(fileName),
      // A replace writes a NEW blob and moves the old one to history, so the
      // bytes behind one (id, history) pair never change — but the current
      // file of an id does, so the cache stays short.
      "cache-control": h === null ? "private, max-age=300" : "private, max-age=86400",
      // #245 final review: a stored file's real bytes never got a magic-byte
      // check before some upload paths existed — this stops a browser from
      // sniffing a misdeclared content-type (e.g. treating an uploaded file
      // as HTML/script) instead of trusting the header above.
      "x-content-type-options": "nosniff",
      ...(contentType.startsWith("image/svg") ? { "content-security-policy": SVG_CSP } : {}),
    },
  });
}
