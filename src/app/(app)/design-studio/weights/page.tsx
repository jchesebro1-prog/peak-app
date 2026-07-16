import Link from "next/link";
import { requireUser } from "@/lib/session";
import { all as allCustomers } from "@/lib/stores/customers";
import { listDesigns, getDesign } from "@/lib/stores/studio-designs";
import type { WeightDefaults, WeightLine } from "@/lib/design/steel";
import { WeightsTool } from "./weights-tool";

export const metadata = { title: "Lineset Weights — Peak Backend" };

export default async function WeightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, custs, saved] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    listDesigns({ kind: "weights" }),
  ]);
  const customers = custs.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  const designId = Array.isArray(sp.design) ? sp.design[0] : sp.design;
  const design = designId ? await getDesign(designId) : null;
  const initial = design && design.kind === "weights" ? (design.data as { defaults: WeightDefaults; lines: WeightLine[] }) : undefined;
  const loaded = design && design.kind === "weights" ? { id: design.id, name: design.name, customerId: design.customerId } : null;

  return (
    <div className="pk-content" style={{ maxWidth: 1060 }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/design-studio" style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}>
          ← Design Studio
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Lineset Weights &amp; Counterweight</h1>
        <p style={{ color: "#6b7079", fontSize: 13.5, marginTop: 3 }}>
          Build a line schedule → goods weight, per-line &amp; hoist checks, counterweight bricks, and load per support beam.
        </p>
      </div>
      <WeightsTool initial={initial} customers={customers} saved={saved.map((d) => ({ id: d.id, name: d.name, customer: d.customer }))} loaded={loaded} />
    </div>
  );
}
