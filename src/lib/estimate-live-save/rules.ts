/** Estimator live save — which estimates, and what a live save writes (pure, client-safe). */
type LiveQuoteFields = { status?: string | null; source?: string | null; quoteType?: string | null };

export function liveSaveEligible(q: LiveQuoteFields): boolean {
  if (q.status !== "draft") return false;
  if (q.source === "portal-catalog" || q.source === "portal-service") return false;
  return !q.quoteType || q.quoteType === "system";
}

export const LIVE_REFUSED = "This estimate no longer saves itself — press Save to keep your changes.";

/** The server's own check on the STORED quote; a non-null reason writes nothing. */
export function liveSaveRefusal(q: LiveQuoteFields): string | null {
  return liveSaveEligible(q) ? null : LIVE_REFUSED;
}

/** What a live save writes on an existing quote. The header stays with the header autosave, so a stale window can't overwrite it. */
export const LIVE_PATCH_FIELDS = ["spec", "value", "margin", "pdfOptions", "paymentTerms", "boxSale", "pricingTier", "tierMargin", "source"] as const;

export function limitToLivePatch<T extends object>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of LIVE_PATCH_FIELDS) if (k in patch) out[k] = (patch as Record<string, unknown>)[k];
  return out as Partial<T>;
}
