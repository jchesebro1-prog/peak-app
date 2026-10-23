"use server";

import { requireUser } from "@/lib/session";
import { systemLibraryIndex } from "@/lib/narrative/system-library-index";
import { LOAD_TARGET_GONE, loadLibrarySystem } from "@/lib/narrative/load-system";
import {
  LIBRARY_QUERY_MAX,
  LIBRARY_SEARCH_LIMIT,
  searchSystemLibrary,
  toLibraryHit,
  type LoadLibrarySystemResult,
  type SystemLibraryEntry,
  type SystemLibraryHit,
} from "@/lib/narrative/system-library";

/**
 * #293 slice 2 — the system library's server actions. Any signed-in team
 * member may search and load (like searchQuotesAction); Load writes nothing —
 * the client places the re-priced system and the normal Save persists it.
 */

/** Ranked hits — never intro or block text bodies (spec §4.1). The limit is
 *  the fixed default, never client-supplied: a NaN limit would answer []. */
export async function searchSystemLibraryAction(query: string, opts?: { hasNarrative?: boolean }): Promise<SystemLibraryHit[]> {
  await requireUser();
  const entries = await systemLibraryIndex();
  return searchSystemLibrary(entries, String(query ?? "").slice(0, LIBRARY_QUERY_MAX), {
    hasNarrative: !!opts?.hasNarrative,
    limit: LIBRARY_SEARCH_LIMIT,
  }).map(toLibraryHit);
}

/** One full entry, for the detail pane and the Merge preview. */
export async function getSystemLibraryEntryAction(key: string): Promise<SystemLibraryEntry | null> {
  await requireUser();
  const k = String(key ?? "");
  return (await systemLibraryIndex()).find((e) => e.key === k) ?? null;
}

/** Load system: re-read, vendor lines left out, re-priced at today's catalog
 *  and this estimate's tier. #368 (review): `quoteId` is required — the saved
 *  estimate the system lands in, or null only for one never saved. The core
 *  reads that estimate's stored status and refuses anything but a draft
 *  (server-enforced). A missing / non-string argument is refused outright, so a
 *  caller that forgets the target can't slip past the lock. */
export async function loadLibrarySystemAction(key: string, quoteId: string | null, ctx: { tierMargin: number | null }): Promise<LoadLibrarySystemResult> {
  await requireUser();
  if (quoteId !== null && (typeof quoteId !== "string" || !quoteId)) return { ok: false, error: LOAD_TARGET_GONE };
  const tm = ctx && typeof ctx.tierMargin === "number" ? ctx.tierMargin : null;
  return loadLibrarySystem(String(key ?? ""), tm, quoteId);
}
