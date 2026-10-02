import { resolvePortalViewer } from "@/lib/portal-viewer";
import { rateLimit } from "@/lib/rate-limit";
import { get as getQuote } from "@/lib/stores/quotes";
import { portalOnlineEstimateState } from "@/lib/quote-pdf/portal-access";
import { servePhotoForRevision } from "@/lib/quote-share/photo-response";

export const dynamic = "force-dynamic";

/**
 * A key-product photo on the portal estimate page (#293 slice 3, spec §5.4).
 * Portal viewer only; the quote must pass portalOnlineEstimateState as ok,
 * and the doc must be one its latest SENT revision prints. Anything else is
 * a plain 404 — no hint whether the quote or the document exists. Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await ctx.params;
  const { session, preview } = await resolvePortalViewer(new URL(req.url).searchParams.get("preview") || "");
  if (!session) return new Response("Not found", { status: 404 });
  const rlKey = preview ? `portal-photo:preview:${session.customerId}` : `portal-photo:${session.grantId}`;
  if (!rateLimit(rlKey, 300, 60_000).ok) return new Response("Too many requests", { status: 429 });
  const q = await getQuote(id);
  const state = q ? portalOnlineEstimateState(q, session.customerId) : null;
  if (!state || state.kind !== "ok") return new Response("Not found", { status: 404 });
  return servePhotoForRevision(req, state.rev, docId);
}
