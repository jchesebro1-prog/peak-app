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

type SaveModeName = "auto" | "manual" | "force";

/**
 * Whether a save on this estimate goes as a live save (the limited patch, status left alone). A status picked before the
 * estimate had an id has nothing to move it, so the next manual Save carries it through the ordinary Save path. An
 * optimistic pick from a status move in flight isn't that: its own action is moving it.
 */
export function saveGoesLive(a: { mode: SaveModeName; liveMode: boolean; status: string; baseStatus: string; statusChanging: boolean }): boolean {
  if (!a.liveMode) return false;
  return !(a.mode === "manual" && a.status !== a.baseStatus && !a.statusChanging);
}

/** Whether a save's reply overwrites the status on screen. A live save moved nothing, so unless the server reports a new status, a pick on screen stays. */
export function saveAdoptsStatus(a: { mode: SaveModeName; isLive: boolean; resStatus: string | null | undefined; baseStatus: string }): boolean {
  return a.mode === "manual" || !a.isLive || a.resStatus !== a.baseStatus;
}
