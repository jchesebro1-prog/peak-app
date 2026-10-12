import { requireUser } from "@/lib/session";
import { bookPdfResponse, bookTextResponse, gridBookPdf, parsePeakHeaderParam } from "@/lib/part-docs/datasheet-book-download";

/** From route entry: reads by 45 s, the merge by 90 s (BOOK_DOWNLOAD_*_MS), the rest to stream. */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Grid notes #8 — staff "Download all datasheets" on the Grid's Outputs
 * menu: one design option's datasheet book (#329, with the job cover) —
 * `?option=`, default the first option — the same documents its client
 * package carries, and `?header=1|0` — the menu's "Include Peak header"
 * (absent = the company default; anything else is refused).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // The time budget starts HERE (route entry), so the prelude counts against maxDuration.
  const startedAt = Date.now();
  const user = await requireUser();
  const { id } = await params;
  const sp = new URL(request.url).searchParams;
  const option = sp.get("option");
  // The Outputs menu's "Include Peak header" for this download: "1" / "0" only; absent = the company default.
  const header = parsePeakHeaderParam(sp.get("header"));
  if (header === "bad") return bookTextResponse("Choose on or off for the Peak header.", 400);
  try {
    const r = await gridBookPdf(decodeURIComponent(id), option, user.name, { startedAt, peakHeader: header });
    if (!r.ok) return bookTextResponse(r.error, r.status);
    return bookPdfResponse(r.pdf, r.fileName);
  } catch (e) {
    console.error("[datasheets] design book failed", e);
    return bookTextResponse("The datasheet PDF couldn’t be built — try again.", 500);
  }
}
