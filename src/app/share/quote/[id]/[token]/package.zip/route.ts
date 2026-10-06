import { servePackageZip } from "@/lib/estimate-output/package-zip-server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedPackage, SHARE_ZIP_PER_WINDOW, SHARE_ZIP_WINDOW_MS } from "@/lib/quote-share/links";
import { isShareTokenV2 } from "@/lib/quote-share/token";

export const dynamic = "force-dynamic";
/** A 45 s build deadline plus the docx and the response (same ceiling as the rack submittal route). */
export const maxDuration = 120;

const notFound = () => new Response("Not found", { status: 404 });

/**
 * #301 slice C (D-l, R10) — "Download all (.zip)" on the package page.
 * 6 / 10 min / IP first; a v2 token only; any visible state (it was sent).
 * Read-only except for the Blob cache of the pinned revision's zip.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await ctx.params;
  if (!rateLimit("share-zip:" + (clientIp(req) || "unknown"), SHARE_ZIP_PER_WINDOW, SHARE_ZIP_WINDOW_MS).ok) return new Response("Too many requests", { status: 429 });
  if (!isShareTokenV2(token)) return notFound();
  let pkg: Awaited<ReturnType<typeof resolveSharedPackage>>;
  try {
    pkg = await resolveSharedPackage(id, token);
  } catch (e) {
    console.error("[package] zip link resolve failed", e);
    return notFound();
  }
  if (!pkg) return notFound();
  try {
    return await servePackageZip(pkg);
  } catch (e) {
    console.error("[package] zip build failed", e);
    return new Response("The download couldn’t be built — try again.", { status: 500 });
  }
}
