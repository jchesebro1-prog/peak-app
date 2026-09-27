import { getBlobStream } from "@/lib/blob";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { getDocument } from "@/lib/stores/part-documents";

/**
 * Signed sibling of /print/part-thumb/[id] (#245) — streams the datasheet's
 * own PDF bytes to the client renderer. Same token, same kind, checked
 * before any read; no team session (this is what headless Chrome fetches).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params; // already decoded by Next's router
  const t = new URL(req.url).searchParams.get("t") || undefined;
  if (!t || !verifyPrintToken(process.env.AUTH_SECRET || "", t, "part-thumb", id, Date.now())) {
    return new Response("Not found", { status: 404 });
  }
  const doc = await getDocument(id);
  if (!doc || doc.kind !== "datasheet" || !doc.blobKey) return new Response("Not found", { status: 404 });

  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobKey);
  } catch {
    // A Blob read failure (network, BlobError, …) — never surface the
    // vendor's own error text to the browser.
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "private, max-age=60",
    },
  });
}
