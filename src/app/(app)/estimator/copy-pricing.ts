import { getMany as catalogGetMany } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { allAssembliesFrom, fixtureSkus, type FixtureRecord } from "@/lib/fixture-assemblies";
import type { CopyCatalogPart, CopyFixture } from "./copy-system";
import type { SpecItem } from "./types";

/**
 * #266 / #293 slice 2 — today's catalog and resolved fixtures for exactly the
 * SKUs these lines name: the data copySectionForTarget re-prices against.
 * Shared by Copy system (copySystemToEstimateAction) and Load system
 * (lib/narrative/load-system.ts). Server-only — reads the catalog and
 * fixtures stores.
 */
export async function copyPricingFor(
  items: readonly SpecItem[]
): Promise<{ catalog: Map<string, CopyCatalogPart>; fixtures: Map<string, CopyFixture> }> {
  /* Today's catalog, for only the SKUs this section names — plus, when a line
     is a catalog-backed fixture, the resolved fixture records (costOverride
     applied) and their own parts. */
  const skus = new Set<string>();
  const fixtureIds = new Set<string>();
  for (const it of items) {
    if (it?.sku) skus.add(it.sku);
    const comps = Array.isArray(it?.components) ? it.components : [];
    if (comps.length) {
      // #274: a track line's parts are plain catalog parts — no fixture record.
      if (!it.track) fixtureIds.add(it.fixtureId || it.sku);
      comps.forEach((c) => c?.sku && skus.add(c.sku));
    }
  }
  let fixtureRecords: FixtureRecord[] = [];
  if (fixtureIds.size) {
    fixtureRecords = (await listFixtures()).filter((r) => fixtureIds.has(r.id));
    fixtureRecords.forEach((r) => fixtureSkus(r).forEach((s) => skus.add(s)));
  }
  const parts = skus.size ? await catalogGetMany([...skus]) : [];
  const catalog = new Map<string, CopyCatalogPart>();
  for (const p of parts) {
    const cost = Number(p.cost);
    // A part with no real cost today is no basis for re-costing a line.
    if (!p.sku || !(Number.isFinite(cost) && cost > 0) || catalog.has(p.sku)) continue;
    catalog.set(p.sku, { sku: p.sku, cost, list: Number(p.list) || 0 });
  }
  const fixtures = new Map<string, CopyFixture>();
  if (fixtureRecords.length) {
    for (const a of allAssembliesFrom(fixtureRecords, parts)) {
      fixtures.set(a.id, {
        id: a.id,
        // A part missing from today's catalog falls back to the line's own
        // numbers rather than pricing at the resolver's 0.
        components: a.components
          .filter((c) => c.found && (c.cost > 0 || c.costOverride !== undefined))
          .map((c) => ({ sku: c.sku, cost: c.cost, list: c.list })),
      });
    }
  }
  return { catalog, fixtures };
}
