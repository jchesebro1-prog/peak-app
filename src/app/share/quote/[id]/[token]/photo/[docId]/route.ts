import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedPackage, resolveSharedQuote, SHARE_PHOTO_PER_MIN } from "@/lib/quote-share/links";
import { servePackagePhotoForRevision, servePhotoForRevision } from "@/lib/quote-share/photo-response";
import { isShareTokenV2 } from "@/lib/quote-share/token";

export const dynamic = "force-dynamic";

/**
 * A key-product photo on the share page (#293 slice 3, spec §5.4). Per-IP
 * rate limit first (no client IP = one fixed "unknown" key). A v2 token
 * (#301 slice B) serves only its PINNED revision's package photo set,
 * whatever the page's state (ok, superseded, revising). A v1 token keeps
 * #293's check: the doc must be one the quote's latest SENT revision prints.
 * Anything else is a plain 404. Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string; docId: string }> }) {
  const { id, token, docId } = await ctx.params;
  if (!rateLimit("share-photo:" + (clientIp(req) || "unknown"), SHARE_PHOTO_PER_MIN, 60_000).ok) return new Response("Too many requests", { status: 429 });
  if (isShareTokenV2(token)) {
    const pkg = await resolveSharedPackage(id, token);
    if (!pkg) return new Response("Not found", { status: 404 });
    return servePackagePhotoForRevision(req, pkg.rev, docId);
  }
  const hit = await resolveSharedQuote(id, token);
  if (!hit || hit.state.kind !== "ok") return new Response("Not found", { status: 404 });
  return servePhotoForRevision(req, hit.state.rev, docId);
}
