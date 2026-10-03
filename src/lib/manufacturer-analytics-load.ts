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
import { manufacturerAnalytics, type AnalyticsPart, type AnalyticsResult } from "@/lib/manufacturer-analytics";

export type LoadedAnalytics = AnalyticsResult & { canonical: (key: string) => string };

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
  for (const p of parts) partsBySku.set(p.sku, { sku: p.sku, mfr: p.mfr, desc: p.desc });
  const canonical = canonicalKeyMap(records);
  return { ...manufacturerAnalytics(quotes, partsBySku, canonical, now), canonical };
}
