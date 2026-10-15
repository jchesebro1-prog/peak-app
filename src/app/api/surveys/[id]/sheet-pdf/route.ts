import { attachmentDisposition } from "@/lib/document-files";
import { renderSurveySheetPdf } from "@/lib/survey-sheet-pdf-server";
import { requireUser } from "@/lib/session";
import { zipStream } from "@/lib/zip";

/** Loads the sheet's photos and sketches from storage, then one in-process PDF render. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** The editor's draft patch is text; photos are read from the stored record, so a real one is far smaller than this. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/**
 * #344 C7 — a venue assessment's field sheet as a PDF, for staff. The body is the editor's unsaved draft patch (an object,
 * ≤ 2 MB); the saved record plus that patch is what prints. Streamed with the shared chunker: a buffered function response
 * is capped around 4.5 MB on Vercel, which a sheet with ~10 photos exceeds. Opens inline; `?download=1` downloads.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return text("Request too large", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return text("Request too large", 413);
  let patch: unknown;
  try {
    patch = raw ? JSON.parse(raw) : {};
  } catch {
    return text("Body must be JSON", 400);
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return text("Body must be a JSON object", 400);
  const r = await renderSurveySheetPdf(id, patch);
  if (!r.ok) return text(r.error, r.status);
  const disposition = attachmentDisposition(r.fileName);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(zipStream(r.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": download ? disposition : "inline" + disposition.slice("attachment".length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
