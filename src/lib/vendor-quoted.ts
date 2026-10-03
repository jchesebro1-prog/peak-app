/**
 * The vendor page's "Quoted through this vendor" card (Manufacturer section
 * Part 3). Pure: a vendor's claimed manufacturer spellings → canonical keys →
 * one rollup plus one row per manufacturer. Plain data, so a server page can
 * hand it to the client overview tab.
 */
import { mfrKey } from "@/lib/catalog-books";
import { rollupMetrics, type ManufacturerMetrics, type MoneyPair } from "@/lib/manufacturer-analytics";

/** `linked`: the manufacturer has a page (a line's own manufacturer text with no catalog part and no record has none). */
export type VendorQuotedRow = { key: string; name: string; linked: boolean; quoted: MoneyPair; won: MoneyPair; open: MoneyPair };
export type VendorQuotedVM = {
  quoted: MoneyPair;
  won: MoneyPair;
  open: MoneyPair;
  forecast: MoneyPair;
  /** Pooled across the vendor's manufacturers; the shop's when none has a decision (then `usedShopRate`). */
  winRate: number | null;
  usedShopRate: boolean;
  quotes: number;
  /** Some counted Grid line priced at today's catalog cost. */
  includesCatalogCost: boolean;
  rows: VendorQuotedRow[];
};

export function vendorQuotedVM(
  claimed: readonly string[],
  byKey: ReadonlyMap<string, ManufacturerMetrics>,
  shopWinRate: number | null,
  canonical: (key: string) => string,
  hasPage: (key: string) => boolean = () => true,
): VendorQuotedVM | null {
  const seen = new Map<string, string>(); // canonical key → first claimed spelling
  for (const name of claimed) {
    const raw = mfrKey(name);
    if (!raw) continue;
    const key = canonical(raw);
    if (!seen.has(key)) seen.set(key, name);
  }
  const found: Array<{ m: ManufacturerMetrics; name: string }> = [];
  for (const [key, name] of seen) {
    const m = byKey.get(key);
    if (m) found.push({ m, name });
  }
  if (!found.length) return null;
  const roll = rollupMetrics(found.map((f) => f.m), shopWinRate);
  const rows = found
    .map(({ m, name }) => ({ key: m.key, name, linked: hasPage(m.key), quoted: m.quoted, won: m.won, open: m.open }))
    .sort((a, b) => b.quoted.cost - a.quoted.cost || a.name.localeCompare(b.name));
  return {
    quoted: roll.quoted,
    won: roll.won,
    open: roll.open,
    forecast: roll.forecast,
    winRate: roll.winRate ?? shopWinRate,
    usedShopRate: roll.winRate === null && shopWinRate !== null,
    quotes: roll.quotes,
    includesCatalogCost: roll.includesCatalogCost,
    rows,
  };
}
