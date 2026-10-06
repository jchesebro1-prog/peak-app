import { getBlobStream } from "@/lib/blob";
import { gridSetAssetTokenId } from "@/lib/design/grid-set-print";
import { contentTypeForFileName } from "@/lib/part-docs/files";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { getDocument } from "@/lib/stores/part-documents";

export const dynamic = "force-dynamic";

/** #300 (D608) — a stored SVG drawing is served sandboxed, as on /api/part-documents/[id]. */
const SVG_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
const notFound = () => new Response("Not found", { status: 404 });

/** #301 slice C (R8b) — one symbol / riser drawing for the signed Grid set
 *  print: its own asset token first, then a symbol or riser document with a
 *  stored file. Nothing else (no datasheet, no image) is ever served here. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await ctx.params;
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!verifyPrintToken(process.env.AUTH_SECRET || "", t, "grid-set", gridSetAssetTokenId(id, "doc", docId), Date.now())) return notFound();
  const doc = await getDocument(docId);
  if (!doc || (doc.kind !== "symbol" && doc.kind !== "riser") || !doc.blobKey) return notFound();
  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobKey);
  } catch {
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return notFound();
  const contentType = doc.contentType || contentTypeForFileName(doc.fileName);
  return new Response(stream, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
      ...(contentType.startsWith("image/svg") ? { "content-security-policy": SVG_CSP } : {}),
    },
  });
}
