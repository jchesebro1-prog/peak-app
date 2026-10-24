/**
 * Estimator handoff — browser implementations of src/app/(app)/estimator/library-actions.ts (the system
 * library: search, one entry, Load system), type-enforced against the originals.
 *
 * The pure library (src/lib/narrative/system-library.ts) is imported; the store reads are ported:
 *
 *   system-library-index build()  quotes getAll() + customers all() → quoteRepo(store).all() + ports.customers.all().
 *                                 The app caches the index per process for 5 minutes; the prototype's book
 *                                 is small, so it is rebuilt on every call (never stale).
 *   load-system loadLibrarySystem quotes get() → quoteRepo(store).get; copyPricingFor → place-system.ts's
 *                                 port (the store's catalog + fixtures, renames followed). Writes nothing.
 *
 * Plan: PR 2 Task 5.
 */
import type * as Original from "@/app/(app)/estimator/library-actions";
import { copySectionForTarget } from "@/app/(app)/estimator/copy-system";
import { sanitizeSystemSell } from "@/app/(app)/estimator/pricing";
import { TIER_FALLBACK_MARKUP, usableTierMarkup } from "@/app/(app)/estimator/tier-reprice";
import { displayQuoteNumber } from "@/lib/estimate-number";
import {
  flagOldVendorLine, LIBRARY_GONE, LIBRARY_QUERY_MAX, LIBRARY_SEARCH_LIMIT, librarySectionForLoad, parseLibraryKey, searchSystemLibrary,
  systemLibraryEntries, toLibraryHit, type LoadLibrarySystemResult, type SystemLibraryEntry,
} from "@/lib/narrative/system-library";
import type { HandoffStore } from "../store";
import { customers } from "../ports";
import { quoteRepo } from "../quote-repo";
import { copyPricingFor } from "./place-system";
import type { Impl as ImplOf } from "./util";

export const LIBRARY_ACTIONS_KEY = "src/app/(app)/estimator/library-actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;

/** system-library-index systemLibraryIndex() over the store: sent / won systems of every live quote. */
export async function systemLibraryIndexLocal(store: HandoffStore): Promise<SystemLibraryEntry[]> {
  const quotes = await quoteRepo(store).all();
  const names = new Map<string, string>(customers.all().map((c) => [c.id, c.name]));
  return systemLibraryEntries(quotes, names);
}

/** load-system.ts loadLibrarySystem over the store. */
export async function loadLibrarySystemLocal(store: HandoffStore, key: string, targetTierMargin: number | null): Promise<LoadLibrarySystemResult> {
  const k = parseLibraryKey(key);
  if (!k) return { ok: false, error: LIBRARY_GONE };
  const q = await quoteRepo(store).get(k.quoteId);
  const picked = q ? librarySectionForLoad(q, k.sectionId) : null;
  if (!q || !picked) return { ok: false, error: LIBRARY_GONE };
  const { catalog, fixtures, renames } = await copyPricingFor(store, picked.section.items);
  const copied = copySectionForTarget(sanitizeSystemSell(picked.section), {
    newSectionId: "sys" + Date.now(),
    catalog,
    fixtures,
    sourceTierMargin: picked.source.tierMargin,
    // An estimate with no tier stamp prices at the Estimator's own fallback seed, never the source customer's tier.
    targetTierMargin: usableTierMarkup(targetTierMargin) ?? TIER_FALLBACK_MARKUP,
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

export function libraryActions(store: HandoffStore): { [K in keyof A]: Impl<K> } {
  const searchSystemLibraryAction: Impl<"searchSystemLibraryAction"> = async (query, opts) =>
    searchSystemLibrary(await systemLibraryIndexLocal(store), String(query ?? "").slice(0, LIBRARY_QUERY_MAX), {
      hasNarrative: !!opts?.hasNarrative,
      limit: LIBRARY_SEARCH_LIMIT,
    }).map(toLibraryHit);

  const getSystemLibraryEntryAction: Impl<"getSystemLibraryEntryAction"> = async (key) => {
    const k = String(key ?? "");
    return (await systemLibraryIndexLocal(store)).find((e) => e.key === k) ?? null;
  };

  const loadLibrarySystemAction: Impl<"loadLibrarySystemAction"> = async (key, ctx) => {
    const tm = ctx && typeof ctx.tierMargin === "number" ? ctx.tierMargin : null;
    return loadLibrarySystemLocal(store, String(key ?? ""), tm);
  };

  return { searchSystemLibraryAction, getSystemLibraryEntryAction, loadLibrarySystemAction };
}
