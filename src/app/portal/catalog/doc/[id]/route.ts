import { createHash } from "node:crypto";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { rateLimit } from "@/lib/rate-limit";
import { portalIndex } from "@/lib/portal-catalog-index";
import { getDocument } from "@/lib/stores/part-documents";
import { getBlobStream } from "@/lib/blob";
import { contentDisposition } from "@/lib/part-docs/files";

/** A fresh Response per call (#242 Task 9 fix round 1, CRITICAL 1) — a
 *  Response body can be read only once, so a single module-level instance
 *  reused across every deny path would fail every 404 after the first on a
 *  warm serverless instance. */
const notFound = () => new Response("Not found", { status: 404 });

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
 * (`servableDocIdsFrom` in portal-catalog-index.ts, tested pure against
 * buildCoverageIndex/buildImageIndex fixtures).
 *
 * Auth is self-contained (middleware exempts every /portal* path):
 * `resolvePortalViewer` resolves either a real portal grant or, for a
 * signed-in team member on `?preview=<customerId>`, that customer's view —
 * no session in either sense → 404, same as an unknown/unlinked document,
 * so this route never confirms a document id exists to an unauthenticated
 * caller. `servableDocIds` only ever holds documents with a stored file
 * (`ownFiles` requires `blobKey`), so — unlike /api/part-documents/[id] —
 * there's no link-only/sourceUrl case to redirect here; the null-blobKey
 * check below is a defensive 404 only, for the rare case a stale cached
 * index (5-minute TTL) still lists a document whose file was since removed.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const { session, preview } = await resolvePortalViewer(url.searchParams.get("preview") || "");
  if (!session) return notFound();

  const rlKey = preview ? `portal-doc:preview:${session.customerId}` : `portal-doc:${session.grantId}`;
  if (!rateLimit(rlKey, 300, 60_000).ok) return new Response("Too many requests", { status: 429 });

  const index = await portalIndex();
  if (!index.servableDocIds.has(id)) return notFound();

  const doc = await getDocument(id);
  if (!doc || !doc.blobKey) return notFound();

  const contentType = doc.contentType || "application/octet-stream";
  if (doc.kind === "image" && !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) return notFound();

  // The blobKey changes on every replace (putBlob's addRandomSuffix), so a
  // hash of it — not just doc.id — moves the ETag when the file does
  // (controller decision, #242 Task 9 fix round 1).
  const fileTag = createHash("sha1").update(doc.blobKey).digest("hex").slice(0, 16);
  const etag = `"${doc.id}-${fileTag}"`;
  // Datasheets/spec sheets churn far less than a gallery image gets
  // reordered/replaced, but customers still shouldn't wait a full day to
  // see a just-fixed spec sheet — images get the long TTL, documents a
  // short one (controller decision, #242 Task 9 fix round 1).
  const cacheControl = doc.kind === "image" ? "private, max-age=86400" : "private, max-age=300";

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": cacheControl } });
  }

  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobKey);
  } catch {
    // Never surface the vendor's own error text to the browser.
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return notFound();

  return new Response(stream, {
    headers: {
      "content-type": contentType,
      "content-disposition": contentDisposition(doc.fileName),
      "cache-control": cacheControl,
      etag,
      "x-content-type-options": "nosniff",
    },
  });
}
