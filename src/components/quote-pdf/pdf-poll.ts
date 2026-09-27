import type { QuotePdfView } from "@/lib/quote-pdf/state";

/**
 * The saved-PDF status poll (#222 T5 review) — pure, with its timers and the
 * status request injected so the spec harness drives it on a fake clock. A
 * chained timeout, not an interval: the next check is scheduled only after the
 * last one answered, so a slow server never has two status requests in flight
 * from one viewer. Hands the first view that differs from the pending state it
 * started on to `onSettled`, gives up once `limitMs` has passed
 * (`onTimedOut`), and a failed request just waits for the next tick. Returns
 * a cancel function.
 */
export function startPdfPoll(o: {
  pendingAt: number;
  intervalMs: number;
  limitMs: number;
  fetch: () => Promise<QuotePdfView | null>;
  onSettled: (v: QuotePdfView) => void;
  onTimedOut: () => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
}): () => void {
  const started = o.now();
  let live = true;
  let timer: unknown = null;
  const tick = async () => {
    timer = null;
    if (!live) return;
    if (o.now() - started > o.limitMs) {
      o.onTimedOut();
      return;
    }
    let next: QuotePdfView | null = null;
    try {
      next = await o.fetch();
    } catch {
      next = null;
    }
    if (!live) return;
    if (next && (next.status !== "pending" || next.at !== o.pendingAt)) {
      o.onSettled(next);
      return;
    }
    timer = o.setTimer(tick, o.intervalMs);
  };
  timer = o.setTimer(tick, o.intervalMs);
  return () => {
    live = false;
    if (timer != null) o.clearTimer(timer);
    timer = null;
  };
}
