import { get as getQuote, setRevisionPdfPath, updateQuotePdf } from "@/lib/stores/quotes";
import { renderPrintRouteToPdf } from "./render";
import {
  latestSentRevision,
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
 */

export type GenerateInput = {
  quoteId: string;
  savedAt: number;
  origin: string;
  secret?: string;
  render?: (url: string) => Promise<Buffer>;
};

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
  const settleFailed = async (error: string): Promise<QuotePdfState | null> => {
    const res = await updateQuotePdf(quoteId, (cur) => settleIfPending(cur, savedAt, { ok: false, error }));
    return res && res.changed ? res.after : null;
  };
  try {
    const q = await getQuote(quoteId);
    const kind = q ? pdfKindForQuoteType(q.quoteType) : null;
    if (!q || !kind) return null;
    if (!isPendingFor(q.pdf, savedAt)) return null; // a newer save owns the state, or this one already settled
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
    const res = await updateQuotePdf(quoteId, (cur) => settleIfPending(cur, savedAt, { ok: true, blobPath: path }));
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
 */
export async function copySentRevisionPdf(quoteId: string): Promise<string | null> {
  const q = await getQuote(quoteId);
  const pdf = q?.pdf;
  if (!q || !pdf || pdf.status !== "ready" || !pdf.blobPath) return null;
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
