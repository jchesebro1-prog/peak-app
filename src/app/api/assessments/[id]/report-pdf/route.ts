import { attachmentDisposition } from "@/lib/document-files";
import { renderAssessmentPdf } from "@/lib/assessments/report-pdf-server";
import { requireUser } from "@/lib/session";
import { zipStream } from "@/lib/zip";

/** One headless-Chrome render, with a wait for the inlined photos to decode (REPORT_RENDER_STEP_MS). */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/**
 * #340 Task 10 — a venue assessment report as a PDF, for staff: rendered on demand through the signed
 * /print/assessment/[id] route (renderAssessmentPdf — Email report attaches the same render). `?download=1` downloads;
 * otherwise it opens inline. An unknown id is a 404; no Chrome / no secret / no origin is a 503.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Outside the render: a signed-out request redirects to the login page.
  await requireUser();
  const { id } = await params;
  const h = request.headers;
  const r = await renderAssessmentPdf(id, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  if (!r.ok) return text(r.error, r.status);
  const disposition = attachmentDisposition(r.fileName);
  const download = new URL(request.url).searchParams.get("download") === "1";
  // Streamed (the rack submittal's shared chunker): a buffered function response is capped around 4.5 MB on Vercel.
  return new Response(zipStream(r.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": download ? disposition : "inline" + disposition.slice("attachment".length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
