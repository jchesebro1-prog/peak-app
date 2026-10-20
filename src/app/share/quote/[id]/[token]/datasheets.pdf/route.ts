import { serveSharedBook } from "@/lib/part-docs/datasheet-book-download";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedPackage, SHARE_ZIP_PER_WINDOW, SHARE_ZIP_WINDOW_MS } from "@/lib/quote-share/links";
import { isPackageToken } from "@/lib/quote-share/token";

export const dynamic = "force-dynamic";
/** From route entry: reads by 45 s, the merge by 90 s (BOOK_DOWNLOAD_*_MS), the rest to stream. */
export const maxDuration = 120;

const notFound = () => new Response("Not found", { status: 404 });

/**
 * Grid notes #8 — "Download all datasheets" on the package page: the
 * PINNED revision's datasheet book (#329, with the job cover). package.zip's
 * rules: the SAME per-IP `share-zip:` rate-limit bucket (one download
 * budget), a package (v2, or a bidder's v3) token only, any visible state (it was sent), a uniform 404
 * for a bad link. Read-only except for the Blob cache of this revision's book.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string }> }) {
  // The time budget starts HERE (route entry), so the prelude counts against maxDuration.
  const startedAt = Date.now();
  const { id, token } = await ctx.params;
  if (!rateLimit("share-zip:" + (clientIp(req) || "unknown"), SHARE_ZIP_PER_WINDOW, SHARE_ZIP_WINDOW_MS).ok) return new Response("Too many requests", { status: 429 });
  if (!isPackageToken(token)) return notFound();
  let pkg: Awaited<ReturnType<typeof resolveSharedPackage>>;
  try {
    pkg = await resolveSharedPackage(id, token);
  } catch (e) {
    console.error("[datasheets] share link resolve failed", e);
    return notFound();
  }
  if (!pkg) return notFound();
  try {
    return await serveSharedBook(pkg, {}, startedAt);
  } catch (e) {
    console.error("[datasheets] share book failed", e);
    return new Response("The download couldn’t be built — try again.", { status: 500 });
  }
}
