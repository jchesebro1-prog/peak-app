/**
 * Batch 6 / #66 — server loader for the sourcing report: every quote, the
 * catalog, the manufacturer records and the fixtures read once, the win rate
 * from the manufacturer analytics (#298), then the pure engine.
 */
import { loadManufacturerAnalytics } from "@/lib/manufacturer-analytics-load";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listManufacturers } from "@/lib/stores/manufacturers";
import { listFixtures } from "@/lib/stores/fixtures";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { sourcingReport, type SourcingPart, type SourcingReport } from "@/lib/sourcing-report";

export async function loadSourcingReport(now: number = Date.now()): Promise<SourcingReport & { shopWinRate: number | null }> {
  const [parts, records, fixtures, quotes] = await Promise.all([listCatalog(), listManufacturers(), listFixtures(), allQuotes()]);
  // #356 review — one read of every quote, shared with the analytics
  const analytics = await loadManufacturerAnalytics(now, { parts, records, quotes });
  const partsBySku = new Map<string, SourcingPart>();
  for (const p of parts) {
    const sp: SourcingPart = {
      sku: p.sku, mfr: p.mfr, desc: p.desc, cost: p.cost,
      manufacturerModelNumber: p.manufacturerModelNumber, manufacturerPartNumber: p.manufacturerPartNumber,
    };
    partsBySku.set(p.sku, sp);
    // A Grid line's `sku` is the part's document id, which can differ from its sku.
    if (p.id && p.id !== p.sku && !partsBySku.has(p.id)) partsBySku.set(p.id, sp);
  }
  const fixtureById = new Map(fixtures.map((f) => [f.id, f] as const));
  const report = sourcingReport(quotes, partsBySku, {
    canonical: analytics.canonical,
    rateFor: (k) => analytics.byKey.get(k)?.winRate ?? analytics.shopWinRate ?? 0,
    fixtureOf: (id) => fixtureById.get(id),
    now,
  });
  return { ...report, shopWinRate: analytics.shopWinRate };
}
