import { isQuotePdfPath, pdfStorage } from "./storage";

/**
 * Stream a stored quote PDF (#222). Streaming (never buffering) keeps a large
 * file clear of the platform's non-streamed response ceiling. The path comes
 * from the quote doc (server-written), never from the request, and is checked
 * against isQuotePdfPath before any I/O.
 */
export async function pdfResponse(path: string | null, fileName: string, download: boolean): Promise<Response> {
  if (!path || !isQuotePdfPath(path)) return new Response("Not found", { status: 404 });
  const store = pdfStorage();
  if ("unavailable" in store) return new Response("Not found", { status: 404 });
  let stream: ReadableStream | null;
  try {
    stream = await store.stream(path);
  } catch {
    return new Response("Couldn't read the PDF — try again", { status: 502 });
  }
  if (!stream) return new Response("Not found", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
