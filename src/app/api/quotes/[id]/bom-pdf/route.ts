import { renderBomPdf } from "@/lib/estimate-output/bom-pdf-server";
import { signedPdfResponse } from "@/lib/quote-pdf/signed-print-pdf";
import { requireUser } from "@/lib/session";

/** One headless-Chrome render of the BOM view. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * BOM quote PDF (2026-10-20 spec) — a system estimate's itemized BOM view as a
 * PDF for staff, rendered on demand from the SAVED quote (renderBomPdf).
 * `?download=1` downloads; otherwise it opens inline. A service quote and an
 * unknown id answer the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Outside the render: a signed-out request redirects to the login page.
  await requireUser();
  const { id } = await params;
  const h = request.headers;
  const r = await renderBomPdf(id, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  const download = new URL(request.url).searchParams.get("download") === "1";
  return signedPdfResponse(r, download);
}
