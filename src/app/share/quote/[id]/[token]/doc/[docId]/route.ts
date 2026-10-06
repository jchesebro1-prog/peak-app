import { getBlobStream } from "@/lib/blob";
import { attachmentDisposition } from "@/lib/document-files";
import { packageDocForRevision } from "@/lib/estimate-output/package-docs-server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedPackage, SHARE_DOC_PER_MIN } from "@/lib/quote-share/links";
import { isShareTokenV2 } from "@/lib/quote-share/token";

export const dynamic = "force-dynamic";

/** A fresh Response per call — a body can be read only once. */
const notFound = () => new Response("Not found", { status: 404 });

/**
 * #301 slice C (spec §6) — one datasheet or spec sheet from the package
 * page. Per-IP rate limit first; a v2 token only; the document must be a
 * blob-backed datasheet / spec sheet the PINNED revision's package lists
 * (any visible state — it was sent). Attachment, nosniff. Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string; docId: string }> }) {
  const { id, token, docId } = await ctx.params;
  if (!rateLimit("share-doc:" + (clientIp(req) || "unknown"), SHARE_DOC_PER_MIN, 60_000).ok) return new Response("Too many requests", { status: 429 });
  if (!isShareTokenV2(token)) return notFound();
  let doc: Awaited<ReturnType<typeof packageDocForRevision>> = null;
  try {
    const pkg = await resolveSharedPackage(id, token);
    if (!pkg) return notFound();
    doc = await packageDocForRevision(pkg.rev, docId);
  } catch (e) {
    // A DB error is the same uniform 404 as a bad link — never a 500 that tells a prober the link is real.
    console.warn("[package] doc lookup failed", e instanceof Error ? e.message : e);
    return notFound();
  }
  if (!doc || !doc.blobKey) return notFound();
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
      "content-type": doc.contentType || "application/octet-stream",
      "content-disposition": attachmentDisposition(doc.fileName),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
    },
  });
}
