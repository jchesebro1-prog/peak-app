import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getMany as getCatalogParts } from "@/lib/stores/catalog";
import { fixtureSkus } from "@/lib/fixture-assemblies";
import { listFixtures } from "@/lib/stores/fixtures";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { fixturePairs, memberCoverageFor } from "@/lib/part-docs/assembly-graph";
import { rackFactsOrUndefined } from "@/lib/rack/part-facts";
import { getRackDefaults } from "@/lib/stores/rack-defaults";
import FixtureBuilder from "./fixture-builder";
import type { PartHit } from "./fixture-form";

export const metadata = { title: "Assembly Builder — Quartzite-6" };
export const dynamic = "force-dynamic";
/** #210: this page's first listFixtures() can run the one-time fixture
 *  conversion under its 15 s budget (FIXTURES_CONVERT_BUDGET_MS) — 60 s keeps
 *  that well inside the function limit, like the Datasheets page. */
export const maxDuration = 60;

/** #210 — one builder for fixtures and systems (spec
 *  2026-09-25-fixture-builder-merge-design.md). The #130 `?tab=` switch is
 *  gone; a stale `?tab=` link lands on the one list. Everything prices from
 *  the live catalog, loaded once here. */
export default async function AssemblyBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  if (sp.tab !== undefined) redirect("/design/assemblies");
  const [settings, fixtures, rackDefaults] = await Promise.all([getSettings(), listFixtures(), getRackDefaults()]);
  // #210 fix wave 1 (I1): only the parts saved fixtures actually reference —
  // never the whole ~37,400-part catalog. New lines are priced by the
  // pickers' own server search (searchAssemblyPartsAction), which merges its
  // hits into the client's bySku seed below.
  // #296: plus the rack tray's default blank / vent, so their height and name resolve.
  const defaultSkus = [rackDefaults.blankSku, rackDefaults.ventSku].filter((s): s is string => !!s);
  const skus = [...new Set([...fixtures.flatMap(fixtureSkus), ...defaultSkus])];
  const parts = await getCatalogParts(skus);
  // Part documents (#207): each saved line's datasheet coverage.
  const { index } = await loadPartDocsState(parts);
  const coverage = memberCoverageFor(index, fixtures.flatMap(fixturePairs));
  const hits: PartHit[] = parts.map((p) => {
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
      // #296: rack facts for every referenced SKU (rack placements included) — the sidebar and row totals read them.
      ...(rack ? { rack } : {}),
    };
  });

  // #289: the portal categories already in use — the builder's datalist.
  const portalCategories = [
    ...new Set(
      fixtures
        .filter((f) => f.kind === "fixture")
        .map((f) => f.portalCategory)
        .filter((c): c is string => !!c)
    ),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <div className="pk-content" style={{ maxWidth: 1080 }}>
      <Link href="/design" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Design</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Assembly Builder</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 700 }}>
        Fixtures, systems, hardware and racks in one list. Everything prices from the live catalog — a price-list import re-prices them at once.
      </p>
      <FixtureBuilder initial={fixtures} parts={hits} priceListEffective={settings.priceListEffective || {}} coverage={coverage} portalCategories={portalCategories} rackDefaults={rackDefaults} />
    </div>
  );
}
