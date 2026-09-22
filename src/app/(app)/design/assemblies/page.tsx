import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { list as listSubassemblies, type FixtureSubassembly } from "@/lib/stores/subassemblies";
import { pricesAsOf, sanitizeFixtureAssemblies } from "@/lib/fixture-assemblies";
import AssemblyBuilder from "./assembly-builder";
import AssembliesTabs from "./tabs";
import SubassembliesClient from "../subassemblies/subassemblies-client";

export const metadata = { title: "Assembly Builder — Quartzite-6" };
export const dynamic = "force-dynamic";

/** #130 — Assemblies and Subassemblies on one screen, switched by ?tab=. Only
 *  the active builder renders (the subassembly picker takes the whole
 *  catalog as props). Both price from the live catalog (#129). */
export default async function AssemblyBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = tabRaw === "subassemblies" ? "subassemblies" : "assemblies";
  const [settings, parts, saved] = await Promise.all([getSettings(), listCatalog(), listSubassemblies()]);
  const priceDates = Object.fromEntries(
    sanitizeFixtureAssemblies(settings.fixtureAssemblies).map((a) => [a.id, pricesAsOf(a.components.map((c) => c.sku), parts, settings)])
  );

  return (
    <div className="pk-content" style={{ maxWidth: 1080 }}>
      <Link href="/design" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Design</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Assembly Builder</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 700 }}>
        Assemblies and fixture subassemblies both price from the live catalog — a price-list import re-prices them at once.
      </p>
      <AssembliesTabs active={tab} />
      {tab === "assemblies" ? (
        <AssemblyBuilder initial={settings.fixtureAssemblies || []} priceDates={priceDates} />
      ) : (
        <SubassembliesClient parts={parts} initial={saved as FixtureSubassembly[]} priceListEffective={settings.priceListEffective || {}} />
      )}
    </div>
  );
}
