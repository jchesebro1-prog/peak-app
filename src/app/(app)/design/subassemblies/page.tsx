import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { list as listSubassemblies, type FixtureSubassembly } from "@/lib/stores/subassemblies";
import SubassembliesClient from "./subassemblies-client";

export const metadata = { title: "Subassemblies — Quartzite-6" };
export const dynamic = "force-dynamic";

export default async function SubassembliesPage() {
  await requireUser();
  const [parts, saved, settings] = await Promise.all([listCatalog(), listSubassemblies(), getSettings()]);
  return (
    <div className="pk-content" style={{ maxWidth: 1080, padding: "26px 30px 64px" }}>
      <Link href="/design" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Design</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Subassemblies</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 22px", maxWidth: 700 }}>Build reusable assemblies from catalog components. Fixtures are the first subassembly type.</p>
      <SubassembliesClient parts={parts} initial={saved as FixtureSubassembly[]} priceListEffective={settings.priceListEffective || {}} />
    </div>
  );
}
