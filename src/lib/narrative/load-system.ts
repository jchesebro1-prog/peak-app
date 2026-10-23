import { get as getQuote } from "@/lib/stores/quotes";
import { copySectionForTarget } from "@/app/(app)/estimator/copy-system";
import { copyPricingFor } from "@/app/(app)/estimator/copy-pricing";
import { sanitizeSystemSell } from "@/app/(app)/estimator/pricing";
import { TIER_FALLBACK_MARGIN, usableTierMargin } from "@/app/(app)/estimator/tier-reprice";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { flagOldVendorLine, LIBRARY_GONE, librarySectionForLoad, parseLibraryKey, type LoadLibrarySystemResult } from "./system-library";
import { invalidateSystemLibrary } from "./system-library-index";
import { REVISE_FIRST } from "@/lib/estimate-reprice/lock";

/** #368 — the estimate a system was being loaded into is gone (or the id was junk). */
export const LOAD_TARGET_GONE = "That estimate could not be found — reload it and try again.";

/**
 * #293 slice 2 — Load system's core (the action is a requireUser wrapper).
 * Re-reads the source quote by the library key — client-supplied section data
 * is never trusted — picks the snapshot by the library rule, then re-prices
 * exactly as Copy system does (#266): today's catalog,
 * the snapshot's tier → this estimate's. Persists nothing; the client places
 * the section and the normal Save writes it. Server-only.
 *
 * #368 (review): `targetQuoteId` is REQUIRED — the saved estimate the system
 * will land in, or null only for an estimate that has never been saved. A
 * non-null id is looked up here: a missing estimate is refused, and one whose
 * stored status isn't draft keeps its prices and is refused (REVISE_FIRST),
 * before the library is read. Server-enforced: the client's id is the only
 * input, never its idea of the status.
 */
export async function loadLibrarySystem(key: string, targetTierMargin: number | null, targetQuoteId: string | null): Promise<LoadLibrarySystemResult> {
  if (targetQuoteId !== null) {
    const target = typeof targetQuoteId === "string" && targetQuoteId ? await getQuote(targetQuoteId) : null;
    if (!target) return { ok: false, error: LOAD_TARGET_GONE };
    if (target.status !== "draft") return { ok: false, error: REVISE_FIRST };
  }
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
    // #304: a sent revision keeps a renamed part's old SKU — the loaded copy takes the live one.
    renames,
  });
  // Jeff 2026-10-15 #21: a vendor-quoted line comes in at its last price, flagged "Old vendor price — re-quote".
  const originals = new Map(picked.section.items.filter((it) => !!it.vendorQuoteId).map((it) => [it.id, it] as const));
  const section = originals.size
    ? { ...copied.section, items: copied.section.items.map((it) => (originals.has(it.id) ? flagOldVendorLine(it, originals.get(it.id)!) : it)) }
    : copied.section;
  return {
    ok: true,
    section,
    systemName: picked.section.name || "",
    estNumber: displayQuoteNumber(q),
    costsUpdated: copied.costsUpdated,
    tierRepriced: copied.tierRepriced,
    vendorLinesFlagged: picked.vendorLines,
  };
}
