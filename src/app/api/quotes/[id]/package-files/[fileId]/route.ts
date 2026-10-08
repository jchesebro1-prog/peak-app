import { staffPackageFile } from "@/lib/estimate-output/package-preview";
import { servePackageFile } from "@/lib/estimate-output/package-files-server";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";

/** A fresh Response per call — a body can be read only once. */
const notFound = () => new Response("Not found", { status: 404 });

/**
 * Estimator Phase 4 (spec §11.1) — one of a system estimate's package drawings
 * for staff (the Customer review step's Drawings tab and the package-page
 * preview): signed-in only, a file on THIS quote's own list that the client
 * would see (staffPackageFile), served by the share route's own
 * servePackageFile (stored type, nosniff, locked-down CSP). An unknown quote,
 * a service quote, another quote's file and a hidden Grid file are the same 404.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  // Outside any read: a signed-out request redirects to the login page.
  await requireUser();
  const { id, fileId } = await ctx.params;
  const q = await getQuote(String(id || ""));
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return notFound();
  const file = staffPackageFile(q.packageFiles, fileId);
  if (!file) return notFound();
  return servePackageFile(req, file);
}
