import { resolvePortalViewer } from "@/lib/portal-viewer";
import { rateLimit } from "@/lib/rate-limit";
import { get as getQuote } from "@/lib/stores/quotes";
import { portalOnlineEstimateState } from "@/lib/quote-pdf/portal-access";
import { portalBidRowsFor, portalOwnerHasBidders } from "@/lib/parties/portal-bid-server";
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
  // #348 slice 6: a bidder company's photos come from its own addressed revision.
  const bids = q ? await portalBidRowsFor(q, session.customerId) : [];
  // Task 3 (Jeff 2026-10-15): the owner of a bid estimate sees a BOM with no photos — nothing here for it.
  const hasBidders = q ? await portalOwnerHasBidders(q, session.customerId) : false;
  const state = q ? portalOnlineEstimateState(q, session.customerId, bids, { hasBidders }) : null;
  if (!state || state.kind !== "ok" || state.bomOnly) return new Response("Not found", { status: 404 });
  return servePhotoForRevision(req, state.rev, docId);
}
