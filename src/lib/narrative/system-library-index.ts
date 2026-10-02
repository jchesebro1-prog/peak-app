import { getAll } from "@/lib/stores/quotes";
import { all as allCustomers } from "@/lib/stores/customers";
import { systemLibraryEntries, type SystemLibraryEntry } from "./system-library";

/**
 * #293 slice 2 — the system library, computed from every quote and cached
 * per process for 5 minutes (the portalIndex idiom, portal-catalog-index.ts).
 * Stale by up to the TTL is fine for a reference library; setStatus and
 * remove() invalidate on this instance (quotes.ts), the TTL covers the rest.
 * Server-only.
 */
const TTL_MS = 5 * 60 * 1000;

let cache: { at: number; entries: SystemLibraryEntry[] } | null = null;
let building: Promise<SystemLibraryEntry[]> | null = null;
/** Bumped by every invalidation, so a build that started before a write
 *  never lands in the cache after it. */
let generation = 0;

export function invalidateSystemLibrary(): void {
  cache = null;
  building = null;
  generation++;
}

async function build(): Promise<SystemLibraryEntry[]> {
  const [quotes, customers] = await Promise.all([getAll(), allCustomers()]);
  const names = new Map<string, string>(customers.map((c) => [c.id, c.name]));
  return systemLibraryEntries(quotes, names);
}

export async function systemLibraryIndex(): Promise<SystemLibraryEntry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.entries;
  if (building) return building;
  const gen = generation;
  const p = build().then((entries) => {
    if (gen === generation) cache = { at: Date.now(), entries };
    return entries;
  });
  building = p;
  try {
    return await p;
  } finally {
    if (building === p) building = null;
  }
}
