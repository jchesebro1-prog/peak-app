/**
 * #292 — time caps for cut-sheet work that rides inside another request.
 * Pure (no stores, no Chrome): safe for the harness to drive with fakes.
 */

/** The estimate print route waits this long for the appended cut sheets, then prints the estimate without them. */
export const CUT_SHEET_APPEND_LOAD_MS = 8_000;

/** Resolves to `p`'s value, or null when it rejects or hasn't settled within `ms`. Never rejects. */
export function settleWithin<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms));
  });
  return Promise.race([p.catch(() => null), cap]).finally(() => clearTimeout(timer));
}

export class CutSheetDeadlineError extends Error {
  constructor() {
    super("Cut sheet render passed the package deadline.");
    this.name = "CutSheetDeadlineError";
  }
}

/** Resolves to `p`'s value, or rejects with CutSheetDeadlineError once `ms` passes. `p` keeps running on its own caps. */
export function rejectAfter<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CutSheetDeadlineError()), Math.max(0, ms));
  });
  return Promise.race([p, cap]).finally(() => clearTimeout(timer));
}
