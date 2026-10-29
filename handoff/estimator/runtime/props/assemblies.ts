/**
 * Estimator handoff — the Assembly Builder's props: src/app/(app)/design/assemblies/page.tsx (AssemblyBuilderPage)
 * ported prop by prop onto the HandoffStore. Every store / settings read the page makes becomes a read of the overlay
 * over the slice (stores and @/db never reach the browser bundle):
 *
 *   initial            listFixtures()                       → readers.listFixtures (soft-delete markers skipped)
 *   parts              getCatalogParts(fixture + default SKUs) → readers.getManyLocal (renames followed), as PartHit
 *   priceListEffective getSettings().priceListEffective      → ports.settingsView()
 *   coverage           loadPartDocsState + memberCoverageFor → buildCoverageIndex over NO documents (part documents are
 *                      not in the slice) and the accessory links the saved fixtures imply — exactly what the app's
 *                      saveFixtureAction writes with syncAccessoryLinks (source "assembly", scope fixture:<id>). A
 *                      DaVinci / manual link is not sliced, so it is not here.
 *   portalCategories   the fixtures' portal categories, sorted + unique (the page's own code)
 *   rackDefaults       getRackDefaults()                     → the `rack_defaults` blob's `defaults`, sanitized ({} when absent)
 *
 * The page's `?tab=` redirect has no counterpart (the route has no query). Plan: PR 2 Task 9.
 */
import type { PartHit } from "@/app/(app)/design/assemblies/fixture-form";
import { fixtureSkus, type FixtureRecord } from "@/lib/fixture-assemblies";
import { buildCoverageIndex } from "@/lib/part-docs/coverage";
import { fixturePairs, fixtureRef, memberCoverageFor, type MemberCoverage } from "@/lib/part-docs/assembly-graph";
import type { PartAccessoryLink } from "@/lib/part-docs/types";
import { rackFactsOrUndefined } from "@/lib/rack/part-facts";
import { RACK_DEFAULTS_BLOB, sanitizeRackDefaults, type RackDefaults } from "@/lib/rack/defaults";
import type { HandoffStore } from "../store";
import { blobData, refreshPortsFromStore, settingsView } from "../ports";
import { getManyLocal, listFixtures, type LivePart } from "../readers";

/** The props FixtureBuilder takes (fixture-builder.tsx), as the page builds them. */
export type AssemblyBuilderProps = {
  initial: FixtureRecord[];
  parts: PartHit[];
  priceListEffective: Record<string, number>;
  coverage: Record<string, MemberCoverage>;
  portalCategories: string[];
  rackDefaults: RackDefaults;
};

/** stores/rack-defaults getRackDefaults: the blob's `defaults`, sanitized. */
export function rackDefaultsNow(): RackDefaults {
  return sanitizeRackDefaults(blobData(RACK_DEFAULTS_BLOB).defaults);
}

/** The page's catalog row → PartHit mapping (rack facts for every referenced SKU). */
export function partHitOf(p: LivePart): PartHit {
  const rack = rackFactsOrUndefined(p);
  return {
    sku: p.sku,
    desc: p.desc,
    category: p.category,
    mfr: p.mfr || "",
    unit: p.unit || "ea",
    list: Number(p.list) || 0,
    cost: Number(p.cost) || 0,
    ...(p.pricedAt ? { pricedAt: p.pricedAt } : {}),
    ...(p.priceDate ? { priceDate: p.priceDate } : {}),
    ...(rack ? { rack } : {}),
  };
}

/** The accessory links saveFixtureAction's syncAccessoryLinks keeps for these fixtures (scope fixture:<id>). Pure. */
export function assemblyAccessoryLinks(fixtures: readonly FixtureRecord[]): PartAccessoryLink[] {
  return fixtures.flatMap((f) =>
    fixturePairs(f).map((p, i) => ({
      id: `${fixtureRef(f.id)}#${i}`,
      parentSku: p.parentSku,
      accessorySku: p.accessorySku,
      ...(p.maxQty !== undefined ? { maxQty: p.maxQty } : {}),
      ...(p.included !== undefined ? { included: p.included } : {}),
      source: "assembly" as const,
      sourceRef: fixtureRef(f.id),
    })),
  );
}

/** Props for <FixtureBuilder> — the prototype's AssemblyBuilderPage. */
export async function buildAssemblyBuilderProps(store: HandoffStore): Promise<AssemblyBuilderProps> {
  await refreshPortsFromStore(store);
  const settings = settingsView();
  const fixtures = await listFixtures(store, settings);
  const rackDefaults = rackDefaultsNow();
  const defaultSkus = [rackDefaults.blankSku, rackDefaults.ventSku].filter((s): s is string => !!s);
  const skus = [...new Set([...fixtures.flatMap(fixtureSkus), ...defaultSkus])];
  const parts = await getManyLocal(store, skus);
  const index = buildCoverageIndex({ documents: [], links: [], accessoryLinks: assemblyAccessoryLinks(fixtures), parts });
  const coverage = memberCoverageFor(index, fixtures.flatMap(fixturePairs));
  const portalCategories = [
    ...new Set(
      fixtures
        .filter((f) => f.kind === "fixture")
        .map((f) => f.portalCategory)
        .filter((c): c is string => !!c),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return {
    initial: fixtures,
    parts: parts.map(partHitOf),
    priceListEffective: (settings.priceListEffective as Record<string, number> | undefined) || {},
    coverage,
    portalCategories,
    rackDefaults,
  };
}
