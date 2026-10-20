import { attachmentDisposition } from "@/lib/document-files";
import { renderBomPdf } from "@/lib/estimate-output/bom-pdf-server";
import { requireUser } from "@/lib/session";

/** One headless-Chrome render of the BOM view. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

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
  if (!r.ok) return text(r.error, r.status);
  const disposition = attachmentDisposition(r.fileName);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": download ? disposition : "inline" + disposition.slice("attachment".length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
