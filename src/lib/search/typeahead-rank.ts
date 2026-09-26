/**
 * #121 — pure filter/rank helpers behind the shared Typeahead. No imports:
 * the spec harness runs this DB-free, and the Typeahead is a client
 * component that must not drag anything heavier into the browser bundle.
 */

/** Filter, optionally rank (ascending, stable), then cap. `q` is trimmed. */
export function typeaheadMatches<T>(
  q: string,
  items: readonly T[],
  filter: (q: string, item: T) => boolean,
  rank?: (q: string, item: T) => number,
  max = 8
): T[] {
  const query = q.trim();
  const hits = items.filter((item) => filter(query, item));
  if (!rank) return hits.slice(0, max);
  return hits
    .map((item, i) => ({ item, i, r: rank(query, item) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, max)
    .map((x) => x.item);
}

/** The slice of a catalog part the catalog pickers search over. */
export type CatalogLike = {
  sku: string;
  desc: string;
  mfr?: string | null;
  category?: string | null;
};

function haystack(p: CatalogLike): string {
  return `${p.sku} ${p.desc} ${p.mfr || ""} ${p.category || ""}`.toLowerCase();
}

/** Every whitespace-separated token must appear somewhere in
 *  sku/desc/mfr/category (the Subassemblies picker's rule, kept). Empty → all. */
export function catalogFilter(q: string, p: CatalogLike): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = haystack(p);
  return tokens.every((t) => hay.includes(t));
}

/** 0 = the SKU starts with the query, 1 = the description contains it,
 *  2 = it matched somewhere else (manufacturer / category / tokens). */
export function catalogRank(q: string, p: CatalogLike): number {
  const s = q.trim().toLowerCase();
  if (!s) return 2;
  if (p.sku.toLowerCase().startsWith(s)) return 0;
  if (p.desc.toLowerCase().includes(s)) return 1;
  return 2;
}

export function catalogMatches<T extends CatalogLike>(
  q: string,
  parts: readonly T[],
  max = 8
): T[] {
  return typeaheadMatches(q, parts, catalogFilter, catalogRank, max);
}

/**
 * Pass-through filter/rank for a Typeahead whose `items` are already a
 * server-searched, pre-capped result set (e.g. a debounced catalog search
 * action) rather than a static in-memory list to filter here: every item is
 * shown, in the order given. Module-level so identity is stable (see the
 * Typeahead usage note above).
 */
export const passAllFilter = (): boolean => true;
export const stableRank = (): number => 0;
