import type { QuotePdfView } from "@/lib/quote-pdf/state";

/**
 * What the saved-PDF status line says and offers (#222 Task 5) — pure, shared
 * by the Estimator's viewer and the service builders' button, and asserted by
 * the spec harness. Retry is offered only when there is something to retry:
 * a failed render (including one the server reports stale — pdfView turns a
 * pending older than 150 s into failed), a render the client stopped polling
 * for (`timedOut`), or a saved quote with no PDF at all. Never while a render
 * is in flight and still being polled.
 */
export type PdfBannerTone = "info" | "warn" | "error";
export type PdfBannerNote = { tone: PdfBannerTone; text: string; action?: "Retry" | "Create PDF" };

export function pdfCanRetry(pdf: QuotePdfView | null, timedOut: boolean, retrying: boolean): boolean {
  if (retrying) return false;
  if (!pdf) return true;
  if (pdf.status === "failed") return true;
  return pdf.status === "pending" && timedOut;
}

export function pdfBanner(s: {
  quoteId: string | null;
  pdf: QuotePdfView | null;
  dirty: boolean;
  timedOut: boolean;
  retrying: boolean;
}): PdfBannerNote[] {
  const notes: PdfBannerNote[] = [];
  if (!s.quoteId) return [{ tone: "info", text: "Save this estimate to create its PDF." }];
  if (s.dirty) notes.push({ tone: "warn", text: "Unsaved changes — save to update the PDF." });
  const pending = s.pdf?.status === "pending";
  if (s.retrying || (pending && !s.timedOut)) notes.push({ tone: "info", text: "Updating PDF…" });
  else if (pending && s.timedOut) notes.push({ tone: "warn", text: "The PDF is taking longer than expected.", action: "Retry" });
  else if (s.pdf?.status === "failed")
    notes.push({ tone: s.pdf.outOfDate ? "warn" : "error", text: s.pdf.error || "The PDF couldn’t be made.", action: "Retry" });
  else if (!s.pdf && !s.dirty) notes.push({ tone: "warn", text: "No PDF yet for this quote.", action: "Create PDF" });
  return notes;
}

/**
 * The embedded viewer's cache-buster (#222 T5 review): which FILE the iframe
 * shows, so it reloads only when that file changes — never on each status or
 * `at` refresh (a save's pending → ready would otherwise flash twice). A ready
 * view names its file by `savedAt`; pending and failed keep serving the last
 * good file, so they keep the previous key. Opened mid-render (no previous
 * key), the key marks "the older file" so the finished one still reloads.
 */
export function pdfFileKey(prev: string | null, pdf: QuotePdfView | null): string | null {
  if (!pdf || !pdf.hasFile) return prev;
  if (pdf.status === "ready") return `f${pdf.savedAt}`;
  return prev ?? `p${pdf.savedAt}`;
}
