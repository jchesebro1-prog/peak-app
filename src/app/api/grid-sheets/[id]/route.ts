import { requireUser } from "@/lib/session";
import { getDoc } from "@/db/doc-store";
import { getBlobStream } from "@/lib/blob";
import type { GridSheet } from "@/lib/stores/grid-projects";

/**
 * Authenticated plan-sheet proxy (D116). The Blob store is PRIVATE —
 * customer venue drawings never get world-readable URLs — so the browser
 * fetches sheets from here: signed-in session required, bytes streamed
 * straight through from Blob. Sheets still stored in-database never hit
 * this route (the editor gets their data-URL directly).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  await requireUser();
  const { id } = await ctx.params;
  const sheet = await getDoc<GridSheet>("grid_sheets", decodeURIComponent(id));
  if (!sheet || !sheet.blobPath) return new Response("Not found", { status: 404 });
  const stream = await getBlobStream(sheet.blobPath);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": sheet.mime || "application/octet-stream",
      // Private to the signed-in user's browser; sheets are immutable once
      // uploaded, so a day of caching is safe and keeps pans/zooms snappy.
      "cache-control": "private, max-age=86400",
    },
  });
}
