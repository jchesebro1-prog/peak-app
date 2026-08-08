import { requireUser } from "@/lib/session";
import { getBlobStream, isBlobPathUnderPrefix } from "@/lib/blob";

/**
 * Authenticated client-package zip download (#40), mirroring
 * /api/part-datasheet/[id]'s auth-then-stream pattern — the Blob store is
 * PRIVATE, so the browser only ever reaches the file through a signed-in
 * session, streamed server-side.
 *
 * Unlike part-datasheet/grid-sheets (whose [id] is a catalog SKU / doc id,
 * looked up in a store for its blobPath), a client-package zip has no
 * persisted record of its own — generateClientPackageAction's return value
 * (the blob's own pathname) IS the artifact. That pathname contains slashes
 * (`client-packages/<projectId>/<epochMs>.zip`), so it's carried as a
 * `?path=` query param rather than a `[id]` dynamic segment: a slash-bearing
 * value double-encoded into a single path segment is fragile against
 * edge/proxy normalization of `%2F` (a review finding on the first cut of
 * this route, which used `/api/client-package/[id]` with `decodeURIComponent`
 * — switched to a query param, per the original brief's own suggestion).
 *
 * The blobPath is constrained to the client-packages/ prefix this route's
 * own generator writes under, rather than passing an arbitrary caller
 * string straight to getBlobStream — otherwise a signed-in user could use
 * this route as a generic proxy for any private blob in the store (part
 * datasheets, plan sheets, …), not just client packages.
 *
 * The prefix check is done via isBlobPathUnderPrefix (src/lib/blob.ts),
 * which also rejects "..": @vercel/blob's get() builds its fetch URL by
 * string interpolation, and the fetch/URL parser collapses dot-segments
 * during normalization. A bare startsWith would let
 * "client-packages/../part-datasheets/x.pdf" pass (it does start with
 * "client-packages/") even though it resolves to "part-datasheets/x.pdf"
 * once normalized — defeating the prefix guarantee this comment claims.
 */
export async function GET(req: Request) {
  await requireUser();
  const { searchParams } = new URL(req.url);
  const blobPath = searchParams.get("path") || "";
  if (!isBlobPathUnderPrefix(blobPath, "client-packages/")) {
    return new Response("Not found", { status: 404 });
  }
  const stream = await getBlobStream(blobPath);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="client-package.zip"',
      // Each generate click mints a brand-new blob path (Date.now()-suffixed),
      // so this response is immutable and safe to cache — but private, never
      // shared/CDN cached, same as every other blob proxy in this codebase.
      "cache-control": "private, max-age=86400",
    },
  });
}
