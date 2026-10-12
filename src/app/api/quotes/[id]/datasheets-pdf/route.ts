import { requireUser } from "@/lib/session";
import { bookPdfResponse, bookTextResponse, quoteBookPdf } from "@/lib/part-docs/datasheet-book-download";

/** From route entry: reads by 45 s, the merge by 90 s (BOOK_DOWNLOAD_*_MS), the rest to stream. */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Grid notes #8 — staff "Download all datasheets" on the estimate's Build
 * package step: the LIVE estimate's datasheet book (#329, with the job
 * cover), built on demand and streamed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // The time budget starts HERE (route entry), so the prelude counts against maxDuration.
  const startedAt = Date.now();
  // Outside the build: a signed-out request redirects to the login page.
  await requireUser();
  const { id } = await params;
  try {
    const r = await quoteBookPdf(decodeURIComponent(id), { startedAt });
    if (!r.ok) return bookTextResponse(r.error, r.status);
    return bookPdfResponse(r.pdf, r.fileName);
  } catch (e) {
    console.error("[datasheets] estimate book failed", e);
    return bookTextResponse("The datasheet PDF couldn’t be built — try again.", 500);
  }
}
