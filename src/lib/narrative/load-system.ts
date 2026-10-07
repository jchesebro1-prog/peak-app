import { get as getQuote } from "@/lib/stores/quotes";
import { copySectionForTarget } from "@/app/(app)/estimator/copy-system";
import { copyPricingFor } from "@/app/(app)/estimator/copy-pricing";
import { sanitizeSystemSell } from "@/app/(app)/estimator/pricing";
import { TIER_FALLBACK_MARGIN, usableTierMargin } from "@/app/(app)/estimator/tier-reprice";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { LIBRARY_GONE, librarySectionForLoad, parseLibraryKey, type LoadLibrarySystemResult } from "./system-library";
import { invalidateSystemLibrary } from "./system-library-index";

/**
 * #293 slice 2 — Load system's core (the action is a requireUser wrapper).
 * Re-reads the source quote by the library key — client-supplied section data
 * is never trusted — picks the snapshot by the library rule, leaves vendor-quote
 * lines out, then re-prices exactly as Copy system does (#266): today's catalog,
 * the snapshot's tier → this estimate's. Persists nothing; the client places
 * the section and the normal Save writes it. Server-only.
 */
export async function loadLibrarySystem(key: string, targetTierMargin: number | null): Promise<LoadLibrarySystemResult> {
  const k = parseLibraryKey(key);
  // A malformed key was never an index entry — refuse it without touching the cache.
  if (!k) return { ok: false, error: LIBRARY_GONE };
  const q = await getQuote(k.quoteId);
  const picked = q ? librarySectionForLoad(q, k.sectionId) : null;
  if (!q || !picked) {
    // A real key whose quote or system is gone: the index is stale — rebuild it.
    invalidateSystemLibrary();
    return { ok: false, error: LIBRARY_GONE };
  }
  const { catalog, fixtures, renames } = await copyPricingFor(picked.section.items);
  const copied = copySectionForTarget(sanitizeSystemSell(picked.section), {
    newSectionId: "sys" + Date.now(),
    catalog,
    fixtures,
    sourceTierMargin: picked.source.tierMargin,
    // An estimate with no tier stamp prices at the Estimator's own fallback
    // seed (what addPart gives a new line), never at the source customer's tier.
    targetTierMargin: usableTierMargin(targetTierMargin) ?? TIER_FALLBACK_MARGIN,
    // #302: a sent revision keeps a renamed part's old SKU — the loaded copy takes the live one.
    renames,
  });
  return {
    ok: true,
    section: copied.section,
    systemName: picked.section.name || "",
    estNumber: displayQuoteNumber(q),
    costsUpdated: copied.costsUpdated,
    tierRepriced: copied.tierRepriced,
    vendorLinesDropped: picked.vendorLinesDropped,
  };
}
