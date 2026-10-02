import { get as getQuote } from "@/lib/stores/quotes";
import { copySectionForTarget } from "@/app/(app)/estimator/copy-system";
import { copyPricingFor } from "@/app/(app)/estimator/copy-pricing";
import { sanitizeSystemSell } from "@/app/(app)/estimator/pricing";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { LIBRARY_GONE, librarySectionForLoad, parseLibraryKey, type LoadLibrarySystemResult } from "./system-library";
import { invalidateSystemLibrary } from "./system-library-index";

const usableTier = (m: number | null): number | null => (typeof m === "number" && Number.isFinite(m) && m > 0 && m < 1 ? m : null);

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
  const q = k ? await getQuote(k.quoteId) : null;
  const picked = q && k ? librarySectionForLoad(q, k.sectionId) : null;
  if (!q || !picked) {
    invalidateSystemLibrary();
    return { ok: false, error: LIBRARY_GONE };
  }
  const { catalog, fixtures } = await copyPricingFor(picked.section.items);
  const copied = copySectionForTarget(sanitizeSystemSell(picked.section), {
    newSectionId: "sys" + Date.now(),
    catalog,
    fixtures,
    sourceTierMargin: picked.source.tierMargin,
    targetTierMargin: usableTier(targetTierMargin),
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
