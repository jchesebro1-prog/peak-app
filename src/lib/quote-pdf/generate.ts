import { get as getQuote, setRevisionPdfPath, updateQuotePdf, type Quote } from "@/lib/stores/quotes";
import { cleanPackageFiles, MAX_PACKAGE_FILE_BYTES, shownPackageFiles, type PackageFile } from "@/lib/estimate-output/package-files";
import { loadDatasheetLinkRows } from "@/lib/estimate-output/datasheet-links-server";
import { readBlobCapped } from "@/lib/narrative/photos";
import { ESTIMATE_EMAIL_ATTACH_MAX } from "@/lib/estimate-email/compose";
import { APPENDIX_COPY, appendixLeftOutNote, drawingSkipNote, drawingsBudget, pdfNotesOf, planDrawings, sizeMb } from "./appendix-plan";
import { mergeEstimateAppendices, prepareDrawings, type DrawingInput } from "./appendix-merge-server";
import { isAppOrigin, originFrom } from "./origin";
import { renderPrintRouteToPdf } from "./render";
import {
  canHavePdf,
  documentRevStamp,
  latestSentRevision,
  pdfIsCurrent,
  pdfKindForQuoteType,
  pdfStoragePath,
  printPathFor,
  revisionCopyPlan,
  settlePdf,
  type DocumentRevStamp,
  type PdfOutcome,
  type QuotePdfState,
} from "./state";
import { pdfStorage } from "./storage";
import { signPrintToken } from "./token";
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";

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
  /** Spec-harness seam for Chrome. `opts.signal` is passed only to the
   *  stamp re-render (#293 slice 3), which must stop at the budget's deadline. */
  render?: (url: string, opts?: { signal?: AbortSignal }) => Promise<Buffer>;
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
  /** Spec-harness seam for the budget clock (the stamp re-render's gate); defaults to Date.now. */
  now?: () => number;
  /** Spec-harness seam for the re-render's hard stop; defaults to AbortSignal.timeout. */
  deadlineSignal?: (ms: number) => AbortSignal;
  /** Spec 2026-10-16 §4–5 seam — the shown drawings and whether a datasheet links page prints (default loadAppendixSources). */
  appendix?: (q: Quote, origin: string) => Promise<AppendixSources>;
  /** Spec-harness seam — one drawing's bytes, null past `maxBytes` (default: its private Blob). */
  readDrawing?: (file: PackageFile, signal: AbortSignal, maxBytes: number) => Promise<Uint8Array | null>;
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

/** The rendering pages' maxDuration (#222): every page whose actions schedule a render sets 120 s. */
export const PDF_FUNCTION_BUDGET_MS = 120_000;

/**
 * #293 slice 3 — the least render time worth a stamp re-render (fix round 2b).
 * Two worst-case renders never fit (4 s coalesce + 2 × 90 s + 20 s upload =
 * 204 s > 120 s), and gating on a whole worst case would leave a 10 s window a
 * cold Chrome on Vercel rarely meets. So the re-render runs while at least
 * this much render time is left before the upload allowance, and is hard-
 * stopped at that point (stampRerenderDeadlineMs) — the budget holds whatever
 * Chrome does: coalesce + render 1 + render 2 (≤ the deadline) + upload ≤ 120 s.
 */
export const RERENDER_MIN_MS = 30_000;

/**
 * May a render whose stamp was lost to a mid-render write run Chrome once
 * more? Only while elapsed + RERENDER_MIN_MS + the upload allowance ≤ 120 s
 * (elapsed ≤ 120 − 20 − 30 = 70 s, coalescing wait included); otherwise the
 * stamp stays unrecorded and the online pages derive it. Elapsed is measured
 * from generateQuotePdf's start, like the #222 T5 budget.
 */
export function stampRerenderFits(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs + RERENDER_MIN_MS + PDF_UPLOAD_ALLOWANCE_MS <= PDF_FUNCTION_BUDGET_MS;
}

/** The re-render's hard stop: what is left of the budget before the upload allowance (≥ RERENDER_MIN_MS when it fits). */
export function stampRerenderDeadlineMs(elapsedMs: number): number {
  return Math.max(1, PDF_FUNCTION_BUDGET_MS - PDF_UPLOAD_ALLOWANCE_MS - elapsedMs);
}

/**
 * Spec 2026-10-16 §4–5 — the least time worth starting the drawings appendix (the links render, the drawing
 * reads and the merge). Like the stamp re-render it is opportunistic: it starts only while elapsed + this +
 * the upload allowance fit the 120 s budget (elapsed ≤ 85 s) and is hard-stopped at stampRerenderDeadlineMs.
 */
export const APPENDIX_MIN_MS = 15_000;

export function appendixFits(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs + APPENDIX_MIN_MS + PDF_UPLOAD_ALLOWANCE_MS <= PDF_FUNCTION_BUDGET_MS;
}

export type AppendixSources = { drawings: PackageFile[]; hasLinks: boolean };

/** The drawings the client is shown (Client package → Drawings off = none) and — only when there are drawings to
 *  put before them — whether the links page has rows. With no drawings the links print in the one render. */
export async function loadAppendixSources(q: Quote, origin: string): Promise<AppendixSources> {
  // Box goods sale (spec 2026-10-21): no drawings and no datasheet-links page — one plain render of the BOM layout.
  if (boxSaleOf(q)) return { drawings: [], hasLinks: false };
  const drawings = shownPackageFiles(cleanPackageFiles(q.packageFiles), q.packageSelection);
  if (!drawings.length) return { drawings, hasLinks: false };
  return { drawings, hasLinks: (await loadDatasheetLinkRows(q, origin)).length > 0 };
}

const readDrawingFromBlob = (file: PackageFile, signal: AbortSignal, maxBytes: number) => readBlobCapped(file.blobPath, maxBytes, signal);

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

/**
 * #293 slice 3 — the Rev N and date the file just rendered printed: the
 * print route's own rule (documentRevStamp, via quoteDocumentDataFor) over the
 * quote it read mid-render. Read before and after the render; both values
 * never go down — Rev is the send number (D1125: a revise moves it to the next
 * send's, a send keeps it, so a send landing mid-render prints the same Rev
 * either side) and updatedAt only moves forward — so equal readings mean the
 * print route printed exactly them. A write that landed during
 * the render → `stamp: null` (nothing is recorded rather than a guess), with
 * the quote as re-read (`after`) so the caller can render once more against it.
 */
async function printedStamp(
  quoteId: string,
  before: Parameters<typeof documentRevStamp>[0]
): Promise<{ stamp: DocumentRevStamp | null; after: Awaited<ReturnType<typeof getQuote>> }> {
  const after = await getQuote(quoteId).catch(() => null);
  if (!after) return { stamp: null, after: null };
  const a = documentRevStamp(before);
  const b = documentRevStamp(after);
  return { stamp: a.revNum === b.revNum && a.revDateMs === b.revDateMs ? a : null, after };
}

/** Settle only a state still pending for this save; anything else is superseded. */
function settleIfPending(cur: QuotePdfState | null, savedAt: number, outcome: PdfOutcome): QuotePdfState | undefined {
  return isPendingFor(cur, savedAt) ? settlePdf(cur, savedAt, outcome, Date.now()) : undefined;
}

export async function generateQuotePdf(input: GenerateInput): Promise<QuotePdfState | null> {
  const { quoteId, savedAt } = input;
  const updatePdf = input.updatePdf ?? updateQuotePdf;
  const clock = input.now ?? Date.now;
  const startedAt = clock();
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
    const render = input.render ?? renderPrintRouteToPdf;
    // Spec 2026-10-16 §4–5: the customer PDF's drawings (+ links after them). Never fails the PDF.
    let appendix: AppendixSources = { drawings: [], hasLinks: false };
    if (kind === "quote") {
      try {
        appendix = await (input.appendix ?? loadAppendixSources)(q, input.origin);
      } catch (e) {
        console.warn("[quote-pdf] drawings unavailable — printing without them", quoteId, reason(e));
      }
    }
    // No drawings → exactly the one render as before (no part, no pdf-lib); the links print at its end.
    const split = appendix.drawings.length > 0;
    const printUrl = (part?: "main" | "tail") =>
      `${input.origin}${printPathFor(kind, quoteId)}?t=${encodeURIComponent(signPrintToken(secret, kind, quoteId, Date.now()))}${part ? "&part=" + part : ""}`;
    const mainPart = split ? ("main" as const) : undefined;
    let bytes: Buffer;
    try {
      bytes = await render(printUrl(mainPart));
    } catch (e) {
      return await settleFailed(reason(e));
    }
    let printed: DocumentRevStamp | null = null;
    if (kind === "quote") {
      const first = await printedStamp(quoteId, q);
      printed = first.stamp;
      // #293 slice 3 fix round 2: the writer most likely to move the quote
      // mid-render is the Send click itself (a send never waits for the PDF),
      // and an unstamped copy makes the online pages guess the Rev. So when
      // the quote moved (and this save still owns the pending state), render
      // once more against the quote as it is now — only while RERENDER_MIN_MS
      // of render time is left before the upload allowance (stampRerenderFits,
      // elapsed ≤ 70 s), hard-stopped at that allowance (stampRerenderDeadlineMs)
      // so the 120 s budget holds whatever Chrome does. Settle/supersede is unchanged: the settle below
      // still compares-and-sets on this savedAt. A second move, a failed or
      // stopped re-render → render 1's file, no stamp (the pages derive).
      const elapsed = clock() - startedAt;
      if (!printed && first.after && isPendingFor(first.after.pdf, savedAt) && stampRerenderFits(elapsed)) {
        const signal = (input.deadlineSignal ?? ((ms: number) => AbortSignal.timeout(ms)))(stampRerenderDeadlineMs(elapsed));
        try {
          const again = await render(printUrl(mainPart), { signal });
          const second = await printedStamp(quoteId, first.after);
          bytes = again;
          printed = second.stamp;
        } catch (e) {
          console.warn("[quote-pdf] stamp re-render failed — keeping the first file, unstamped", quoteId, reason(e));
        }
      }
    }
    // PDF-level notes first, then one per skipped drawing — so only drawings ever fold into "…and N more".
    const notes: string[] = [];
    const drawingNotes: string[] = [];
    if (split) {
      // Opportunistic, like the stamp re-render: only while APPENDIX_MIN_MS fits, hard-stopped before the upload allowance.
      const elapsed = clock() - startedAt;
      if (!appendixFits(elapsed)) notes.push(appendixLeftOutNote("late", appendix.hasLinks));
      else {
        const ms = stampRerenderDeadlineMs(elapsed);
        const signal = (input.deadlineSignal ?? ((m: number) => AbortSignal.timeout(m)))(ms);
        const deadline = clock() + ms;
        // The links page renders only when it has rows (an empty tail would be a blank page; the print route 404s one).
        let tail: Buffer | null = null;
        if (appendix.hasLinks) {
          try {
            tail = await render(printUrl("tail"), { signal });
          } catch (e) {
            console.warn("[quote-pdf] datasheet links render failed", quoteId, reason(e));
          }
        }
        // A1: drawings take what is left of the 14 MB ceiling after the estimate and links pages, in list order.
        const read = input.readDrawing ?? readDrawingFromBlob;
        const caps = { perFile: MAX_PACKAGE_FILE_BYTES, total: drawingsBudget(bytes.length, tail?.length ?? 0) };
        // Each read stops at min(25 MB, what is left of the budget) — a stored size that lied never pulls in more.
        let left = caps.total;
        const drawings: DrawingInput[] = [];
        for (const { file, skip } of planDrawings(appendix.drawings, caps)) {
          if (skip) drawings.push({ name: file.name, contentType: file.contentType, bytes: null, skip });
          else if (signal.aborted) drawings.push({ name: file.name, contentType: file.contentType, bytes: null, skip: "late" });
          else {
            try {
              const got = await read(file, signal, Math.min(MAX_PACKAGE_FILE_BYTES, left));
              left -= got?.byteLength ?? 0;
              drawings.push({ name: file.name, contentType: file.contentType, bytes: got });
            } catch {
              drawings.push({ name: file.name, contentType: file.contentType, bytes: null, skip: signal.aborted ? "late" : "unreadable" });
            }
          }
        }
        // Images converted ONCE here (sharp), so the merge's size-guard retries reuse the small bytes.
        const prepared = await prepareDrawings(drawings, { deadline, now: clock });
        const merged = await mergeEstimateAppendices({ main: bytes, drawings: prepared, tail, deadline, now: clock });
        bytes = merged.bytes;
        if (merged.fallback) notes.push(appendixLeftOutNote(merged.fallback, appendix.hasLinks));
        else {
          if (appendix.hasLinks && !merged.tailAdded) notes.push(APPENDIX_COPY.linksMissing);
          drawingNotes.push(...merged.skipped.map(drawingSkipNote));
        }
      }
    }
    // Defensive (A1 keeps drawings under the limit): an estimate too large to attach on its own says so.
    if (kind === "quote" && bytes.length > ESTIMATE_EMAIL_ATTACH_MAX) notes.push(APPENDIX_COPY.tooLargeToEmail(sizeMb(bytes.length)));
    notes.push(...drawingNotes);
    const path = await store.put(pdfStoragePath(quoteId, String(savedAt)), bytes);
    let res: Awaited<ReturnType<typeof updateQuotePdf>>;
    try {
      res = await updatePdf(quoteId, (cur) => settleIfPending(cur, savedAt, { ok: true, blobPath: path, printed, notes: pdfNotesOf(notes) }));
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
    // The previous file goes only when it is no longer the one the quote
    // records (#222 final wave B): never delete a path equal to the stored
    // blobPath the settle just committed — the local store reuses a path for
    // the same save, and a delete there would orphan the ready state.
    const prev = res.before?.blobPath;
    if (prev && prev !== path && prev !== res.after?.blobPath) await store.remove(prev).catch(() => undefined);
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
 * is still owed one (revisionCopyPlan — #352 review I1: only a file that printed
 * the revision's stamped Rev; a stale-Rev file schedules a re-render instead).
 * Called from setStatus after a send
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
  // #352 review I1: never copy a file that printed another Rev than the send stamped — re-render it instead.
  const plan = revisionCopyPlan(rev, pdf, q.contentChangedAt);
  if (plan === "rerender") {
    const { scheduleQuotePdf } = await import("./schedule");
    await scheduleQuotePdf(quoteId);
    return null;
  }
  if (!rev || plan !== "copy") return null;
  const store = pdfStorage();
  if ("unavailable" in store) return null;
  const bytes = await store.read(pdf.blobPath);
  if (!bytes) return null;
  const path = await store.put(pdfStoragePath(quoteId, `rev-${rev.rev}`), bytes);
  // #293 slice 3: the copy carries what the file printed (Rev N + date) onto
  // the revision, so the online pages print exactly the customer's PDF.
  if (!(await setRevisionPdfPath(quoteId, rev.rev, path, { savedAt: pdf.savedAt, printed: pdf.printed ?? null }))) {
    const now = await getQuote(quoteId);
    const kept = (now?.revisions || []).find((r) => r.rev === rev.rev)?.pdfBlobPath;
    if (kept !== path) await store.remove(path).catch(() => undefined);
    return null;
  }
  return path;
}
