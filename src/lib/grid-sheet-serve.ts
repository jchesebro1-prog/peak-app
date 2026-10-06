import { getBlobStream } from "@/lib/blob";
import { decodeDataUrl } from "@/lib/grid-sheet-file";
import type { GridSheet } from "@/lib/stores/grid-projects";

/**
 * One plan-sheet source's bytes (D116, #209 I6): Blob streamed straight
 * through, or an in-database sheet's data-URL decoded and served the same
 * way. Shared by the signed-in proxy (/api/grid-sheets/[id]) and the
 * signed Grid set print's asset route (#301 slice C). The caller has
 * already decided the requester may see this sheet.
 */
export async function serveGridSheet(sheet: GridSheet): Promise<Response> {
  if (!sheet.blobPath) {
    const decoded = decodeDataUrl(sheet.dataUrl);
    if (!decoded || !decoded.bytes.length) return new Response("Not found", { status: 404 });
    const mime = sheet.mime || decoded.mime;
    return new Response(decoded.bytes as unknown as BodyInit, { headers: sheetHeaders(mime) });
  }
  const stream = await getBlobStream(sheet.blobPath);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, { headers: sheetHeaders(sheet.mime || "application/octet-stream") });
}

export function sheetHeaders(mime: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": mime,
    // Private to the requester's browser; sheets are immutable once
    // uploaded, so a day of caching is safe and keeps pans/zooms snappy.
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
  };
  // Uploads refuse SVG, but generated base plans and legacy in-database
  // sheets can still be SVG. Opened top-level, a sandboxed, script-less CSP
  // keeps one from running in the app's origin; as an <img> it renders unchanged.
  if (/svg/i.test(mime)) h["content-security-policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  return h;
}
