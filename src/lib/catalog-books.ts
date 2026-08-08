const DAY = 86400000;

function daysSince(ts: number): number {
  return Math.floor((Date.now() - ts) / DAY);
}

export type PriceBookRow = { mono: string; name: string; count: number; ageDays?: number };

/**
 * Price-book glance (PUNCHLIST #14): groups catalog parts by manufacturer for
 * the dashboard's Catalog card. Pulled out of page.tsx into its own pure
 * module so it's unit-testable without importing the whole home page tree.
 *
 * Age pill is the OLDEST `updatedAt` among a book's rows (decision A), and
 * ONLY once every row in the group has one — a single hand-edited SKU out of
 * a 2,000-row book must not make the whole book read as "today". Below full
 * coverage the pill is omitted entirely (honest "unknown", not a number
 * that's actually a fraction of the book).
 */
export function priceBooks(parts: { mfr?: string; updatedAt?: number }[]): PriceBookRow[] {
  const by = new Map<string, { count: number; withTimestamp: number; oldest?: number }>();
  for (const pt of parts) {
    const name = (pt.mfr || "").trim() || "Unbranded";
    const entry = by.get(name) || { count: 0, withTimestamp: 0, oldest: undefined };
    entry.count += 1;
    if (pt.updatedAt != null) {
      entry.withTimestamp += 1;
      entry.oldest = entry.oldest == null ? pt.updatedAt : Math.min(entry.oldest, pt.updatedAt);
    }
    by.set(name, entry);
  }
  return [...by.entries()]
    .map(([name, { count, withTimestamp, oldest }]) => ({
      mono: name
        .split(/\s+/)
        .map((w) => w[0] || "")
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      name,
      count,
      ageDays: withTimestamp === count && oldest != null ? daysSince(oldest) : undefined,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}
