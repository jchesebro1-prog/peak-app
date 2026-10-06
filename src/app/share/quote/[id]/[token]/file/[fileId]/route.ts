import { packageFileForRevision, servePackageFile } from "@/lib/estimate-output/package-files-server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedPackage, SHARE_FILE_PER_MIN } from "@/lib/quote-share/links";
import { isShareTokenV2 } from "@/lib/quote-share/token";

export const dynamic = "force-dynamic";

/** A fresh Response per call — a body can be read only once. */
const notFound = () => new Response("Not found", { status: 404 });

/**
 * #301 slice C (D-j, R12) — one drawing from the package page's Plans &
 * risers: 120/min/IP first, a v2 token only, a file the PINNED revision's
 * frozen list shows (an overridden Grid file is not served). Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string; fileId: string }> }) {
  const { id, token, fileId } = await ctx.params;
  if (!rateLimit("share-file:" + (clientIp(req) || "unknown"), SHARE_FILE_PER_MIN, 60_000).ok) return new Response("Too many requests", { status: 429 });
  if (!isShareTokenV2(token)) return notFound();
  let file: ReturnType<typeof packageFileForRevision> = null;
  try {
    const pkg = await resolveSharedPackage(id, token);
    if (!pkg) return notFound();
    file = packageFileForRevision(pkg.rev, fileId);
  } catch (e) {
    // A DB error is the same uniform 404 as a bad link — never a 500 that tells a prober the link is real.
    console.warn("[package] file lookup failed", e instanceof Error ? e.message : e);
    return notFound();
  }
  if (!file) return notFound();
  return servePackageFile(req, file);
}
