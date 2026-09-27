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
};

/** What a browser sees: the state without the storage path. */
export type QuotePdfView = {
  status: QuotePdfStatus;
  at: number;
  savedAt: number;
  error: string | null;
  hasFile: boolean;
};

export type PdfOutcome = { ok: true; blobPath: string } | { ok: false; error: string };

/** A render still "pending" this long after it started died with its function. */
export const PDF_PENDING_STALE_MS = 150_000;
export const PDF_STALE_ERROR = "The PDF didn’t finish rendering — try again.";
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

type PdfSourceFields = { pdf?: QuotePdfState | null; revisions?: RevisionPdfFields[] | null };

/** What a customer may open: the latest sent revision's copy, else the current READY file. */
export function portalPdfSource(q: PdfSourceFields): { path: string; rev: number | null } | null {
  const sent = latestSentRevision(q.revisions);
  if (sent?.pdfBlobPath) return { path: sent.pdfBlobPath, rev: sent.rev };
  if (q.pdf?.status === "ready" && q.pdf.blobPath) return { path: q.pdf.blobPath, rev: null };
  return null;
}

/** The team's file: revision `rev`'s copy, or the current file whatever its status. */
export function teamPdfPath(q: PdfSourceFields, rev: number | null): string | null {
  if (rev != null) return (Array.isArray(q.revisions) ? q.revisions : []).find((r) => r.rev === rev)?.pdfBlobPath ?? null;
  return q.pdf?.blobPath ?? null;
}

export function pdfFileName(quoteId: string, rev: number | null): string {
  return quoteId.replace(/[^A-Za-z0-9_-]/g, "_") + (rev != null ? `-rev${rev}` : "") + ".pdf";
}
