import { resolvePortalViewer } from "@/lib/portal-viewer";
import { rateLimit } from "@/lib/rate-limit";
import { portalIndex } from "@/lib/portal-catalog-index";
import { getDocument } from "@/lib/stores/part-documents";
import { getBlobStream } from "@/lib/blob";
import { contentDisposition, contentTypeForFileName } from "@/lib/part-docs/files";

const NOT_FOUND = new Response("Not found", { status: 404 });

/** Never serve SVG (#242 spec §7) — images are PNG/JPEG/WebP by
 *  construction (src/lib/part-docs/files.ts ALLOWED_TYPES); anything else
 *  on an image-kind document 404s rather than streaming an unknown type. */
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Portal customer document route (#242 Task 9, spec §7): a part document
 * (image, datasheet, or spec sheet) is served ONLY when it's linked (not
 * hidden) to a part the customer can quote, or — datasheets/spec sheets
 * only, never images — covers such a part through the accessory graph.
 * That rule is precomputed once per index build as `servableDocIds`
 * (portal-catalog-index.ts); see src/lib/portal-doc-access.ts for the same
 * rule stated standalone and pure.
 *
 * Auth is self-contained (middleware exempts every /portal* path):
 * `resolvePortalViewer` resolves either a real portal grant or, for a
 * signed-in team member on `?preview=<customerId>`, that customer's view —
 * no session in either sense → 404, same as an unknown/unlinked document,
 * so this route never confirms a document id exists to an unauthenticated
 * caller. Mirrors /api/part-documents/[id]'s serving body (blob stream, or
 * a 302 to sourceUrl when there's no stored file yet).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const { session, preview } = await resolvePortalViewer(url.searchParams.get("preview") || "");
  if (!session) return NOT_FOUND;

  const rlKey = preview ? `portal-doc:preview:${session.customerId}` : `portal-doc:${session.grantId}`;
  if (!rateLimit(rlKey, 300, 60_000).ok) return new Response("Too many requests", { status: 429 });

  const index = await portalIndex();
  if (!index.servableDocIds.has(id)) return NOT_FOUND;

  const doc = await getDocument(id);
  if (!doc) return NOT_FOUND;

  const contentType = doc.contentType || contentTypeForFileName(doc.fileName);
  if (doc.kind === "image" && !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) return NOT_FOUND;

  const etag = `"${doc.id}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });

  if (!doc.blobKey) {
    if (doc.sourceUrl && /^https?:\/\//i.test(doc.sourceUrl)) return Response.redirect(doc.sourceUrl, 302);
    return NOT_FOUND;
  }

  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobKey);
  } catch {
    // Never surface the vendor's own error text to the browser.
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return NOT_FOUND;

  return new Response(stream, {
    headers: {
      "content-type": contentType,
      "content-disposition": contentDisposition(doc.fileName),
      "cache-control": "private, max-age=86400",
      etag,
      "x-content-type-options": "nosniff",
    },
  });
}
