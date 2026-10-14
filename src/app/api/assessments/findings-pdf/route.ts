import { attachmentDisposition } from "@/lib/document-files";
import { renderFindingsPdf } from "@/lib/assessments/report-pdf-server";
import { requireUser } from "@/lib/session";
import { zipStream } from "@/lib/zip";

/** One headless-Chrome render (no photos, no wait step). */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/**
 * #340 Task 10 — the findings-only PDF (spec §4) for staff: the open findings across visits for one venue or one
 * company. `?scope=site:<id>` | `?scope=company:<id>` (or `?site=<id>` / `?company=<id>`); `?download=1` downloads,
 * otherwise it opens inline. An unknown venue / company is a 404; no Chrome / no secret / no origin is a 503.
 */
export async function GET(request: Request) {
  await requireUser();
  const sp = new URL(request.url).searchParams;
  const scope = sp.get("scope") || (sp.get("site") ? `site:${sp.get("site")}` : sp.get("company") ? `company:${sp.get("company")}` : "");
  const h = request.headers;
  const r = await renderFindingsPdf(scope, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  if (!r.ok) return text(r.error, r.status);
  const disposition = attachmentDisposition(r.fileName);
  // Streamed (the rack submittal's shared chunker): a buffered function response is capped around 4.5 MB on Vercel.
  return new Response(zipStream(r.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": sp.get("download") === "1" ? disposition : "inline" + disposition.slice("attachment".length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
