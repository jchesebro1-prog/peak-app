import { portalSession } from "@/lib/portal";
import { getBlobStream } from "@/lib/blob";
import { documentDownloadHeaders } from "@/lib/document-files";
import { portalCanSee } from "@/lib/document-rules";
import { getDocument } from "@/lib/stores/documents";

export const dynamic = "force-dynamic";

const NOT_FOUND = { status: 404, headers: { "cache-control": "private, no-store" } };

/**
 * Portal document download (#218). The portal session's company only, and
 * only a shared document or one the customer uploaded (portalCanSee — the
 * single rule). Every refusal is the same 404 — no session, unknown id,
 * another company's file, an internal file — so the route never confirms a
 * document exists. Always an attachment, never rendered. The team preview
 * (?preview=, resolvePortalViewer) links to the team route /api/documents/<id>
 * instead, so this route answers only to a real portal session.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await portalSession();
  const { id } = await ctx.params;
  const doc = session ? await getDocument(id) : null;
  if (!session || !doc || !portalCanSee(doc, session.customerId)) return new Response("Not found", NOT_FOUND);
  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobPath);
  } catch {
    return new Response("Couldn't read the file — try again", { status: 502, headers: { "cache-control": "private, no-store" } });
  }
  if (!stream) return new Response("Not found", NOT_FOUND);
  return new Response(stream, { headers: documentDownloadHeaders(doc.fileName) });
}
