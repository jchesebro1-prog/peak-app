/**
 * Server loader for manufacturer analytics (Manufacturer section Part 3):
 * reads every quote, the catalog and the manufacturer records once, then runs
 * the pure engine. Call it once per request — never per row.
 */
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { list as listCatalog } from "@/lib/stores/catalog";
import type { CatalogPart } from "@/lib/stores/catalog";
import { listManufacturers, type Manufacturer } from "@/lib/stores/manufacturers";
import { canonicalKeyMap } from "@/lib/manufacturer-aliases";
import { mfrKey } from "@/lib/catalog-books";
import { manufacturerAnalytics, type AnalyticsPart, type AnalyticsResult } from "@/lib/manufacturer-analytics";

export type LoadedAnalytics = AnalyticsResult & {
  canonical: (key: string) => string;
  /** A canonical key whose manufacturer page exists (a non-Labor catalog part spells it, or it has its own record) — the page's 404 rule. */
  hasPage: (key: string) => boolean;
};

/** A page that already read the catalog / manufacturer records passes them in so they aren't read twice. */
export async function loadManufacturerAnalytics(
  now: number = Date.now(),
  preloaded: { parts?: readonly CatalogPart[]; records?: readonly Manufacturer[] } = {},
): Promise<LoadedAnalytics> {
  const [quotes, parts, records] = await Promise.all([
    allQuotes(),
    preloaded.parts ?? listCatalog(),
    preloaded.records ?? listManufacturers(),
  ]);
  const partsBySku = new Map<string, AnalyticsPart>();
  for (const p of parts) {
    const ap: AnalyticsPart = { sku: p.sku, mfr: p.mfr, desc: p.desc, cost: p.cost };
    partsBySku.set(p.sku, ap);
    // A Grid line's `sku` is the part's document id, which can differ from its sku.
    if (p.id && p.id !== p.sku && !partsBySku.has(p.id)) partsBySku.set(p.id, ap);
  }
  const canonical = canonicalKeyMap(records);
  const paged = new Set<string>();
  for (const r of records) if (canonical(r.key) === r.key) paged.add(r.key);
  for (const p of parts) {
    if (p.category === "Labor") continue;
    const k = mfrKey(String(p.mfr ?? "").trim());
    if (k) paged.add(canonical(k));
  }
  return { ...manufacturerAnalytics(quotes, partsBySku, canonical, now), canonical, hasPage: (key) => paged.has(key) };
}
