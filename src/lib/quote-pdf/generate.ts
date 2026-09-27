import { get as getQuote, setRevisionPdfPath, updateQuotePdf } from "@/lib/stores/quotes";
import { isAppOrigin, originFrom } from "./origin";
import { renderPrintRouteToPdf } from "./render";
import {
  canHavePdf,
  latestSentRevision,
  pdfIsCurrent,
  pdfKindForQuoteType,
  pdfStoragePath,
  printPathFor,
  revisionAwaitingPdf,
  settlePdf,
  type PdfOutcome,
  type QuotePdfState,
} from "./state";
import { pdfStorage } from "./storage";
import { signPrintToken } from "./token";

export { canHavePdf };

/**
 * Render → store → settle (#222). Runs inside `after()` (schedule.ts), so it
 * must never throw: every failure lands on the quote as `pdf.status = failed`
 * with a reason. `render` and `secret` are injectable for the spec harness.
 *
 * Supersede rule: a render may only settle the state it was started for — the
 * quote's `pdf` is still `pending` for this `savedAt`. The check runs inside
 * updateQuotePdf's locked re-read (compare-and-set), never against the copy
 * read before rendering, so a stale render can't overwrite a newer save, a
 * late failure can't overwrite a ready file, and a failure always keeps the
 * last good `blobPath`. A loser deletes its own file unless that file IS the
 * current one (the local store reuses the path for the same save).
 *
 * The origin must be the app's own shape (isAppOrigin) and, when
 * QUOTE_PDF_ORIGIN pins one, exactly that origin — the signed print URL is
 * never built on anything else. A quote type with no PDF kind that somehow
 * carries a pending state is settled failed, never left pending.
 */

export type GenerateInput = {
  quoteId: string;
  savedAt: number;
  origin: string;
  secret?: string;
  render?: (url: string) => Promise<Buffer>;
  /** Spec-harness seam for the settle write; defaults to updateQuotePdf. */
  updatePdf?: typeof updateQuotePdf;
  /**
   * Coalescing wait before Chrome launches (#222 Task 5). The Estimator
   * autosaves header fields on a ~500 ms debounce and every save schedules a
   * render, so a burst of typing would start one Chromium per keystroke pause.
   * The scheduled job (schedule.ts) passes PDF_COALESCE_MS: the render waits,
   * re-reads the quote, and exits without rendering when a newer save has
   * taken the pending state meanwhile. 0 / absent = no wait (direct callers).
   */
  coalesceMs?: number;
  /** Spec-harness seam for the coalescing wait; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * How long a scheduled render waits for a newer save before launching Chrome
 * (#222 Task 5). Budget (#222 T5 review): this + Chrome's worst case
 * (RENDER_WORST_CASE_MS: launch, navigation, fonts, print) + the upload
 * allowance stays inside the rendering pages' 120 s maxDuration.
 */
export const PDF_COALESCE_MS = 4_000;

/**
 * Time left in the 120 s budget for storing the file, the settle write and a
 * sent revision's copy (#222 T5 review). Not a cap — a quote PDF is well under
 * a megabyte and Blob's put has no timeout of ours — but the budget assertion
 * reserves it so a slower Chrome step can't silently eat the upload's share.
 */
export const PDF_UPLOAD_ALLOWANCE_MS = 20_000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The origin a render may print from, or why not. */
export function printOriginProblem(origin: unknown): string | null {
  if (!isAppOrigin(origin)) return "The print origin isn’t a valid app origin — the PDF wasn’t rendered.";
  const fixed = process.env.QUOTE_PDF_ORIGIN;
  if (fixed && origin !== originFrom(null, null, fixed)) return "The print origin isn’t this app’s QUOTE_PDF_ORIGIN — the PDF wasn’t rendered.";
  return null;
}

function reason(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300) || "The PDF couldn’t be rendered.";
}

function isPendingFor(cur: QuotePdfState | null | undefined, savedAt: number): cur is QuotePdfState {
  return !!cur && cur.status === "pending" && cur.savedAt === savedAt;
}

/** Settle only a state still pending for this save; anything else is superseded. */
function settleIfPending(cur: QuotePdfState | null, savedAt: number, outcome: PdfOutcome): QuotePdfState | undefined {
  return isPendingFor(cur, savedAt) ? settlePdf(cur, savedAt, outcome, Date.now()) : undefined;
}

export async function generateQuotePdf(input: GenerateInput): Promise<QuotePdfState | null> {
  const { quoteId, savedAt } = input;
  const updatePdf = input.updatePdf ?? updateQuotePdf;
  const settleFailed = async (error: string): Promise<QuotePdfState | null> => {
    const res = await updatePdf(quoteId, (cur) => settleIfPending(cur, savedAt, { ok: false, error }));
    return res && res.changed ? res.after : null;
  };
  try {
    let q = await getQuote(quoteId);
    if (!q) return null;
    if (!isPendingFor(q.pdf, savedAt)) return null; // a newer save owns the state, or this one already settled
    const coalesceMs = input.coalesceMs ?? 0;
    if (coalesceMs > 0) {
      // Let a burst of saves settle: only the latest pending save renders.
      await (input.sleep ?? realSleep)(coalesceMs);
      q = await getQuote(quoteId);
      if (!q || !isPendingFor(q.pdf, savedAt)) return null;
    }
    const kind = pdfKindForQuoteType(q.quoteType);
    if (!kind) return await settleFailed("This kind of quote has no PDF.");
    const badOrigin = printOriginProblem(input.origin);
    if (badOrigin) return await settleFailed(badOrigin);
    const secret = input.secret ?? process.env.AUTH_SECRET ?? "";
    if (!secret) return await settleFailed("AUTH_SECRET is not set — the print page can’t be signed.");
    const store = pdfStorage();
    if ("unavailable" in store) return await settleFailed(store.unavailable);
    const token = signPrintToken(secret, kind, quoteId, Date.now());
    const url = `${input.origin}${printPathFor(kind, quoteId)}?t=${encodeURIComponent(token)}`;
    let bytes: Buffer;
    try {
      bytes = await (input.render ?? renderPrintRouteToPdf)(url);
    } catch (e) {
      return await settleFailed(reason(e));
    }
    const path = await store.put(pdfStoragePath(quoteId, String(savedAt)), bytes);
    let res: Awaited<ReturnType<typeof updateQuotePdf>>;
    try {
      res = await updatePdf(quoteId, (cur) => settleIfPending(cur, savedAt, { ok: true, blobPath: path }));
    } catch (e) {
      // The settle never committed, so nothing records this file — drop it
      // before recording the failure (the last good file stays current).
      await store.remove(path).catch(() => undefined);
      console.error("[quote-pdf] settle failed", quoteId, e);
      return await settleFailed(reason(e));
    }
    if (!res || !res.changed) {
      if (path !== res?.before?.blobPath) await store.remove(path).catch(() => undefined);
      return null;
    }
    const prev = res.before?.blobPath;
    if (prev && prev !== path) await store.remove(prev).catch(() => undefined);
    try {
      await copySentRevisionPdf(quoteId);
    } catch (e) {
      console.error("[quote-pdf] sent-revision copy failed", quoteId, e);
    }
    return res.after;
  } catch (e) {
    console.error("[quote-pdf] generate failed", quoteId, e);
    try {
      return await settleFailed(reason(e));
    } catch {
      return null;
    }
  }
}

/**
 * Copy the current READY file onto the latest sent revision when that revision
 * is still owed one (revisionAwaitingPdf). Called from setStatus after a send
 * commits, and by the generator when a render finishes after the send. The
 * stamp is once-only (setRevisionPdfPath); a copy that loses that race is
 * deleted unless it is the very file the revision now records.
 *
 * Only a CURRENT file is copied (#222 fix wave 1, pdfIsCurrent): one saved at
 * or after the quote's last content change. A file older than that change is
 * not the document that was sent — the revision waits for the render of the
 * newer save instead.
 */
export async function copySentRevisionPdf(quoteId: string): Promise<string | null> {
  const q = await getQuote(quoteId);
  const pdf = q?.pdf;
  if (!q || !pdf || !pdfIsCurrent(pdf, q.contentChangedAt) || !pdf.blobPath) return null;
  const rev = latestSentRevision(q.revisions);
  if (!rev || !revisionAwaitingPdf(rev, pdf.savedAt)) return null;
  const store = pdfStorage();
  if ("unavailable" in store) return null;
  const bytes = await store.read(pdf.blobPath);
  if (!bytes) return null;
  const path = await store.put(pdfStoragePath(quoteId, `rev-${rev.rev}`), bytes);
  if (!(await setRevisionPdfPath(quoteId, rev.rev, path))) {
    const now = await getQuote(quoteId);
    const kept = (now?.revisions || []).find((r) => r.rev === rev.rev)?.pdfBlobPath;
    if (kept !== path) await store.remove(path).catch(() => undefined);
    return null;
  }
  return path;
}
