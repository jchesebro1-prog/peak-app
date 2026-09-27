import { useEffect, useRef, useState, useTransition } from "react";
import { quotePdfStatusAction, retryQuotePdfAction } from "@/app/(app)/quotes/pdf-actions";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { startPdfPoll } from "./pdf-poll";

/** Poll cadence and give-up point for a pending render (#222). */
export const PDF_POLL_MS = 2000;
export const PDF_POLL_LIMIT_MS = 60_000;

/**
 * Keeps a saved-PDF view fresh (#222): while it is `pending`, polls every 2 s
 * and hands each change to `onPdf`; after 60 s it stops and reports
 * `timedOut` (keyed to that pending state's `at` and the poll round, so no
 * synchronous setState runs in an effect). `retry` re-renders the PDF — or,
 * when the server says the render is still in flight (retryQuotePdfAction
 * leaves a live render alone), starts a fresh round of polling for it.
 * Imported only by client components.
 */
export function useQuotePdf(quoteId: string | null, pdf: QuotePdfView | null, onPdf: (v: QuotePdfView) => void) {
  const onPdfRef = useRef(onPdf);
  useEffect(() => {
    onPdfRef.current = onPdf;
  }, [onPdf]);
  const [round, setRound] = useState(0);
  const [timedOutKey, setTimedOutKey] = useState<string | null>(null);
  const [retrying, startRetry] = useTransition();
  const pendingAt = quoteId && pdf?.status === "pending" ? pdf.at : null;

  useEffect(() => {
    if (!quoteId || pendingAt == null) return;
    // A chained timeout (startPdfPoll): one status request in flight at a time.
    return startPdfPoll({
      pendingAt,
      intervalMs: PDF_POLL_MS,
      limitMs: PDF_POLL_LIMIT_MS,
      fetch: () => quotePdfStatusAction(quoteId),
      onSettled: (next) => onPdfRef.current(next),
      onTimedOut: () => setTimedOutKey(`${pendingAt}:${round}`),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    });
  }, [quoteId, pendingAt, round]);

  const retry = () => {
    if (!quoteId) return;
    startRetry(async () => {
      const next = await retryQuotePdfAction(quoteId).catch(() => null);
      if (next) onPdfRef.current(next);
      // A still-running render comes back unchanged: poll it again.
      setRound((r) => r + 1);
    });
  };

  return { timedOut: pendingAt != null && timedOutKey === `${pendingAt}:${round}`, retry, retrying };
}
