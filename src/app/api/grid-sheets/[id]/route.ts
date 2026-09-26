import { requireUser } from "@/lib/session";
import { getDoc } from "@/db/doc-store";
import { getBlobStream } from "@/lib/blob";
import type { GridSheet } from "@/lib/stores/grid-projects";
import { decodeDataUrl } from "@/lib/grid-sheet-file";

/**
 * Authenticated plan-sheet proxy (D116). The Blob store is PRIVATE —
 * customer venue drawings never get world-readable URLs — so the browser
 * fetches sheets from here: signed-in session required, bytes streamed
 * straight through from Blob. Sheets still stored in-database are decoded
 * from their data-URL and served the same way (the drawing set loads every
 * sheet through here; the editor still gets their data-URL directly).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  await requireUser();
  const { id } = await ctx.params;
  const sheet = await getDoc<GridSheet>("grid_sheets", decodeURIComponent(id));
  if (!sheet) return new Response("Not found", { status: 404 });
  if (!sheet.blobPath) {
    // An in-database sheet (dev, and pre-D116 uploads): decode its data-URL
    // and serve the bytes, so the drawing set can fetch every sheet by URL
    // once instead of inlining it into each plan page (#209 I6).
    const decoded = decodeDataUrl(sheet.dataUrl);
    if (!decoded || !decoded.bytes.length) return new Response("Not found", { status: 404 });
    const mime = sheet.mime || decoded.mime;
    return new Response(decoded.bytes as unknown as BodyInit, { headers: sheetHeaders(mime) });
  }
  const stream = await getBlobStream(sheet.blobPath);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, { headers: sheetHeaders(sheet.mime || "application/octet-stream") });
}

function sheetHeaders(mime: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": mime,
    // Private to the signed-in user's browser; sheets are immutable once
    // uploaded, so a day of caching is safe and keeps pans/zooms snappy.
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
  };
  // Uploads refuse SVG (grid-sheet-file sheetMimeVerdict), but generated
  // base plans and legacy in-database sheets can still be SVG. Opened
  // top-level, a sandboxed, script-less CSP keeps one from running in the
  // app's origin; as an <img> it renders unchanged.
  if (/svg/i.test(mime)) h["content-security-policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  return h;
}
