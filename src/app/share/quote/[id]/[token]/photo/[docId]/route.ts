import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedQuote, SHARE_PHOTO_PER_MIN } from "@/lib/quote-share/links";
import { servePhotoForRevision } from "@/lib/quote-share/photo-response";

export const dynamic = "force-dynamic";

/**
 * A key-product photo on the share page (#293 slice 3, spec §5.4). Per-IP
 * rate limit first (no client IP = one fixed "unknown" key), then the same
 * token check as the page; the doc must be one the quote's latest SENT
 * revision prints. Anything else is a plain 404. Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string; docId: string }> }) {
  const { id, token, docId } = await ctx.params;
  const rlKey = ("share-photo:" + clientIp(req)).replace(/^share-photo:$/, "share-photo:unknown");
  if (!rateLimit(rlKey, SHARE_PHOTO_PER_MIN, 60_000).ok) return new Response("Too many requests", { status: 429 });
  const hit = await resolveSharedQuote(id, token);
  if (!hit || hit.state.kind !== "ok") return new Response("Not found", { status: 404 });
  return servePhotoForRevision(req, hit.state.rev, docId);
}
