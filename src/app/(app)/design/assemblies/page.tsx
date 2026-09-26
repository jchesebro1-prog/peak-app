import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { fixturePairs, memberCoverageFor } from "@/lib/part-docs/assembly-graph";
import FixtureBuilder from "./fixture-builder";
import type { PartHit } from "./fixture-form";

export const metadata = { title: "Assembly Builder — Quartzite-6" };
export const dynamic = "force-dynamic";

/** #FXB — one builder for fixtures and systems (spec
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
  const [settings, parts, fixtures] = await Promise.all([getSettings(), listCatalog(), listFixtures()]);
  // Part documents (#207): each saved line's datasheet coverage.
  const { index } = await loadPartDocsState(parts);
  const coverage = memberCoverageFor(index, fixtures.flatMap(fixturePairs));
  const hits: PartHit[] = parts.map((p) => ({
    sku: p.sku,
    desc: p.desc,
    category: p.category,
    mfr: p.mfr || "",
    unit: p.unit || "ea",
    list: Number(p.list) || 0,
    cost: Number(p.cost) || 0,
    ...(p.pricedAt ? { pricedAt: p.pricedAt } : {}),
  }));

  return (
    <div className="pk-content" style={{ maxWidth: 1080 }}>
      <Link href="/design" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Design</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Assembly Builder</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 700 }}>
        Fixtures and systems in one list. Everything prices from the live catalog — a price-list import re-prices them at once.
      </p>
      <FixtureBuilder initial={fixtures} parts={hits} priceListEffective={settings.priceListEffective || {}} coverage={coverage} />
    </div>
  );
}
