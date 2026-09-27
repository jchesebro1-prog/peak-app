/**
 * Saved quote PDFs (#222) — the pure half: the state a quote's `pdf` field
 * moves through, the browser-facing view of it, and the path rules the team
 * and portal download routes share. No I/O and no store imports, so client
 * components (the Estimator preview, the service builders) import it freely.
 */

export type PdfKind = "quote" | "flame" | "repair" | "inspection";
export type QuotePdfStatus = "pending" | "ready" | "failed";

/**
 * Stored on the quote doc as `pdf`. `savedAt` names the save the file (or the
 * in-flight render) was made from — the supersede key. `blobPath` is the last
 * GOOD file and survives a pending re-render and a failure, so the preview
 * never goes blank. Server-written only; never accepted from a request.
 */
export type QuotePdfState = {
  status: QuotePdfStatus;
  at: number;
  savedAt: number;
  blobPath?: string;
  error?: string;
  /**
   * Set on a `pending` state that NO render is working on (#222 T4 re-review):
   * markQuotePdfStale's mark for a writer with no request to render in (the
   * CSV import, scripts). The browser sees it as out of date with Retry, and
   * Retry reschedules at once instead of waiting out a render that doesn't
   * exist. A real render's pendingPdf never carries it.
   */
  stale?: true;
};

/** What a browser sees: the state without the storage path. */
export type QuotePdfView = {
  status: QuotePdfStatus;
  at: number;
  savedAt: number;
  error: string | null;
  hasFile: boolean;
  /** A stale mark (QuotePdfState.stale): reported `failed` with PDF_OUT_OF_DATE. */
  outOfDate?: boolean;
};

export type PdfOutcome = { ok: true; blobPath: string } | { ok: false; error: string };

/** A render still "pending" this long after it started died with its function. */
export const PDF_PENDING_STALE_MS = 150_000;
export const PDF_STALE_ERROR = "The PDF didn’t finish rendering — try again.";
export const PDF_OUT_OF_DATE = "Out of date — the quote changed since this PDF was made.";
const ERROR_MAX = 300;

/** Which document a quote prints as — null for types with no saved PDF. */
export function pdfKindForQuoteType(quoteType: string | null | undefined): PdfKind | null {
  if (!quoteType || quoteType === "system") return "quote";
  if (quoteType === "flame_test") return "flame";
  if (quoteType === "repair") return "repair";
  if (quoteType === "inspection") return "inspection";
  return null;
}

/** Whether a quote of this type ever gets a saved PDF (#222). Callers check it
 *  before marking a PDF pending; consulting and rental quotes never do. */
export function canHavePdf(quoteType: string | null | undefined): boolean {
  return pdfKindForQuoteType(quoteType) !== null;
}

export function printPathFor(kind: PdfKind, id: string): string {
  const eid = encodeURIComponent(id);
  return kind === "quote" ? `/print/quote/${eid}` : `/print/letter/${kind}/${eid}`;
}

export function pdfStoragePath(quoteId: string, name: string): string {
  return `quote-pdfs/${quoteId.replace(/[^A-Za-z0-9_-]/g, "_")}/${name}.pdf`;
}

export function pendingPdf(cur: QuotePdfState | null | undefined, savedAt: number, now: number): QuotePdfState {
  return { status: "pending", at: now, savedAt, ...(cur?.blobPath ? { blobPath: cur.blobPath } : {}) };
}

/** Pending for a newer save with no render behind it (markQuotePdfStale). */
export function stalePdf(cur: QuotePdfState | null | undefined, savedAt: number, now: number): QuotePdfState {
  return { ...pendingPdf(cur, savedAt, now), stale: true };
}

export function failedPdf(cur: QuotePdfState | null | undefined, savedAt: number, error: string, now: number): QuotePdfState {
  return {
    status: "failed",
    at: now,
    savedAt,
    error: (error || "The PDF couldn’t be made.").slice(0, ERROR_MAX),
    ...(cur?.blobPath ? { blobPath: cur.blobPath } : {}),
  };
}

/** Settle a render. `undefined` means superseded: a newer save owns the state. */
export function settlePdf(
  cur: QuotePdfState | null | undefined,
  savedAt: number,
  outcome: PdfOutcome,
  now: number
): QuotePdfState | undefined {
  if (!cur || cur.savedAt !== savedAt) return undefined;
  if (outcome.ok) return { status: "ready", at: now, savedAt, blobPath: outcome.blobPath };
  return failedPdf(cur, savedAt, outcome.error, now);
}

export function pdfView(pdf: QuotePdfState | null | undefined, now: number): QuotePdfView | null {
  if (!pdf) return null;
  if (pdf.status === "pending" && pdf.stale) {
    return { status: "failed", at: pdf.at, savedAt: pdf.savedAt, error: PDF_OUT_OF_DATE, hasFile: !!pdf.blobPath, outOfDate: true };
  }
  const stale = pdf.status === "pending" && now - pdf.at > PDF_PENDING_STALE_MS;
  return {
    status: stale ? "failed" : pdf.status,
    at: pdf.at,
    savedAt: pdf.savedAt,
    error: stale ? PDF_STALE_ERROR : pdf.error ?? null,
    hasFile: !!pdf.blobPath,
  };
}

type RevisionPdfFields = { rev: number; at: number; reason: string; pdfBlobPath?: string };

/** A sent revision still owed a copy of the PDF made from a save at/before it. */
export function revisionAwaitingPdf(rev: RevisionPdfFields | null | undefined, pdfSavedAt: number): boolean {
  return !!rev && rev.reason === "sent" && !rev.pdfBlobPath && rev.at >= pdfSavedAt;
}

export function latestSentRevision<R extends RevisionPdfFields>(revisions: R[] | null | undefined): R | null {
  const revs = Array.isArray(revisions) ? revisions : [];
  for (let i = revs.length - 1; i >= 0; i--) if (revs[i]?.reason === "sent") return revs[i];
  return null;
}

/**
 * Whether the current file shows the quote as it stands now (#222 fix wave 1):
 * READY, and rendered from a save at or after the last change to anything the
 * document prints (`contentChangedAt`, stamped by the store's patchQuote). A
 * writer that changed the document without scheduling a render leaves an
 * older file — never one to stamp onto a sent revision.
 */
export function pdfIsCurrent(pdf: QuotePdfState | null | undefined, contentChangedAt: number | null | undefined): pdf is QuotePdfState {
  return !!pdf && pdf.status === "ready" && !!pdf.blobPath && pdf.savedAt >= (contentChangedAt ?? 0);
}

type PdfSourceFields = { pdf?: QuotePdfState | null; revisions?: RevisionPdfFields[] | null };

/**
 * What a customer may open (#222 fix wave 1). Once a quote has been sent, only
 * the exact document that went out: the latest sent revision's copy. When that
 * copy isn't there yet it is nothing (the route says "being prepared") — never
 * the current file, which may carry edits made after the send. A quote never
 * sent (the customer's own self-serve estimate, legacy won-without-send) may
 * open its current READY file.
 */
export function portalPdfSource(q: PdfSourceFields): { path: string; rev: number | null } | null {
  const sent = latestSentRevision(q.revisions);
  if (sent) return sent.pdfBlobPath ? { path: sent.pdfBlobPath, rev: sent.rev } : null;
  if (q.pdf?.status === "ready" && q.pdf.blobPath) return { path: q.pdf.blobPath, rev: null };
  return null;
}

/**
 * A sent quote whose sent copy can still arrive — the portal's "being
 * prepared" (#222 T4 re-review). The copy only ever comes from a PDF saved at
 * or before the send (revisionAwaitingPdf), so a revision sent before #222
 * with no PDF at all, or one whose document changed after the send (the PDF
 * now belongs to a newer save), will never get one: that is not "preparing"
 * but unavailable (portalPdfUnavailable). Nor is a render that FAILED (#222
 * final wave B): a failed state — or a pending one past the stale window,
 * which pdfView reports as failed — has nothing behind it that will ever
 * land, so "being prepared" would read forever; it is unavailable until the
 * team retries. The portal route and the portal list share this one predicate.
 */
export function portalPdfPreparing(q: PdfSourceFields, now: number = Date.now()): boolean {
  const sent = latestSentRevision(q.revisions);
  if (!sent || sent.pdfBlobPath || !q.pdf || !revisionAwaitingPdf(sent, q.pdf.savedAt)) return false;
  return pdfView(q.pdf, now)?.status !== "failed";
}

/** A sent quote whose sent copy is missing and never coming — "No PDF is available for this version". */
export function portalPdfUnavailable(q: PdfSourceFields, now: number = Date.now()): boolean {
  const sent = latestSentRevision(q.revisions);
  return !!sent && !sent.pdfBlobPath && !portalPdfPreparing(q, now);
}

/**
 * What the Retry button does (#222 fix wave 1). A stale MARK (no render behind
 * it — pdfView reports it failed/out of date) reschedules at once. A render
 * still in flight (not stale) is left alone — the view comes back as is. Otherwise re-render for
 * the newest of the file's save and the last content change: an unchanged
 * document keeps its `savedAt` (a send waiting on it still gets its copy), a
 * changed one renders as the newer save.
 */
export function pdfRetryPlan(
  q: { pdf?: QuotePdfState | null; contentChangedAt?: number | null; updatedAt?: number | null },
  now: number
): { wait: QuotePdfView } | { savedAt: number } {
  const view = pdfView(q.pdf, now);
  if (view?.status === "pending") return { wait: view };
  const savedAt = Math.max(q.pdf?.savedAt ?? 0, q.contentChangedAt ?? 0);
  return { savedAt: savedAt || q.updatedAt || now };
}

/** The team's file: revision `rev`'s copy, or the current file whatever its status. */
export function teamPdfPath(q: PdfSourceFields, rev: number | null): string | null {
  if (rev != null) return (Array.isArray(q.revisions) ? q.revisions : []).find((r) => r.rev === rev)?.pdfBlobPath ?? null;
  return q.pdf?.blobPath ?? null;
}

export function pdfFileName(quoteId: string, rev: number | null): string {
  return quoteId.replace(/[^A-Za-z0-9_-]/g, "_") + (rev != null ? `-rev${rev}` : "") + ".pdf";
}
