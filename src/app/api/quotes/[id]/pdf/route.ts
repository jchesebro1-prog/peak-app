import { coverPdfFileName } from "@/lib/estimate-output/cover";
import { isCoverFileName } from "@/lib/estimate-email/compose";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { pdfResponse } from "@/lib/quote-pdf/http";
import { pdfFileName, pdfStoragePath, teamPdfPath } from "@/lib/quote-pdf/state";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";

/**
 * A quote's saved PDF for the team (#222): the current file, or `?rev=<n>` for
 * the exact document a sent revision carried. `?download=1` downloads instead
 * of opening inline. next.config.ts lets the app frame this route (SAMEORIGIN)
 * for the Estimator's embedded preview. The file is looked up by quote id —
 * no request parameter ever names a storage path.
 *
 * Estimator Phase 3 final review (M1): `?file=cover-<ms>[-<suffix>].pdf` serves
 * a cover stored for an estimate email — a bare file name only (no directory,
 * the `cover-` shape checked), always inside THIS quote's own folder.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const q = await getQuote(id);
  if (!q) return new Response("Not found", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const file = sp.get("file");
  if (file !== null) {
    if (!isCoverFileName(file)) return new Response("Not found", { status: 404 });
    const path = pdfStoragePath(q.id, file.slice(0, -".pdf".length));
    return pdfResponse(path, coverPdfFileName(displayQuoteNumber(q)), sp.get("download") === "1");
  }
  const revRaw = sp.get("rev");
  if (revRaw !== null && !/^\d{1,4}$/.test(revRaw)) return new Response("Not found", { status: 404 });
  const rev = revRaw === null ? null : Number(revRaw);
  return pdfResponse(teamPdfPath(q, rev), pdfFileName(displayQuoteNumber(q), rev), sp.get("download") === "1");
}
