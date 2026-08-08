import { requireUser } from "@/lib/session";
import { getBlobStream } from "@/lib/blob";

/**
 * Authenticated client-package zip download (#40), mirroring
 * /api/part-datasheet/[id]'s auth-then-stream pattern — the Blob store is
 * PRIVATE, so the browser only ever reaches the file through a signed-in
 * session, streamed server-side.
 *
 * Unlike part-datasheet/grid-sheets (whose [id] is a catalog SKU / doc id,
 * looked up in a store for its blobPath), a client-package zip has no
 * persisted record of its own — generateClientPackageAction's return value
 * (the blob's own pathname) IS the artifact, so the [id] segment here is
 * that blobPath directly, URL-encoded by the caller (same contract those
 * routes use for their own id segment).
 *
 * The blobPath is constrained to the client-packages/ prefix this route's
 * own generator writes under, rather than passing an arbitrary caller
 * string straight to getBlobStream — otherwise a signed-in user could use
 * this route as a generic proxy for any private blob in the store (part
 * datasheets, plan sheets, …), not just client packages.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  await requireUser();
  const { id } = await ctx.params;
  const blobPath = decodeURIComponent(id);
  if (!blobPath.startsWith("client-packages/")) {
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
