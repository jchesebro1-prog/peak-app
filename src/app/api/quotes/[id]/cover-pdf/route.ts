import { renderCoverPdf } from "@/lib/estimate-output/cover-pdf-server";
import { signedPdfResponse } from "@/lib/quote-pdf/signed-print-pdf";
import { requireUser } from "@/lib/session";

/** R7: one headless-Chrome render of a 1–2 page cover. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * #301 slice A — a system estimate's cover PDF for staff (D-p, R7): rendered
 * on demand from the live quote through the signed /print/cover/[id] route
 * (renderCoverPdf — the Estimator's send action attaches the same render).
 * `?download=1` downloads; otherwise it opens inline. A service quote and an
 * unknown id answer the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Outside the render: a signed-out request redirects to the login page.
  await requireUser();
  const { id } = await params;
  const h = request.headers;
  const r = await renderCoverPdf(id, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  const download = new URL(request.url).searchParams.get("download") === "1";
  return signedPdfResponse(r, download);
}
