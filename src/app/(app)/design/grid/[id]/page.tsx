import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject, listSheets } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { allEngagements } from "@/lib/stores/engagements";
import type { PartLite } from "@/lib/design/grid-bom";
import GridEditor from "./editor";

export const metadata = { title: "The Grid — Quartzite" };
export const dynamic = "force-dynamic";

/**
 * The Grid editor route (D108) — full-width like the markup screen: laying
 * out a system needs the whole viewport.
 */
export default async function GridEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const project = await getProject(decodeURIComponent(id));

  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/grid" style={{ color: "#3155a8" }}>
          ← Back to The Grid
        </Link>
      </div>
    );
  }

  const [sheets, catalog, engagements] = await Promise.all([
    listSheets(project.id),
    listCatalog(),
    allEngagements(),
  ]);

  // The D94 bid-spec generator is engagement-scoped; when the customer has a
  // live engagement, the editor links straight into it (the generator's
  // "Start from a quote" list matches this design's quote by customer).
  const eng = project.customerId
    ? engagements.find(
        (e) => e.companyId === project.customerId && e.status !== "oversight_complete"
      )
    : undefined;
  const specHref = eng ? `/design/engagements/spec?id=${encodeURIComponent(eng.id)}` : null;

  /** Client payload: sheets without re-serialization surprises + PartLite slice. */
  const parts: PartLite[] = catalog.map((p) => ({
    id: p.id,
    sku: p.sku,
    desc: p.desc,
    category: p.category,
    unit: p.unit,
    list: p.list,
    cost: p.cost,
  }));

  return (
    <GridEditor
      project={{
        id: project.id,
        name: project.name,
        customer: project.customer,
        quoteId: project.quoteId,
        placements: project.placements || [],
        calibrations: project.calibrations || [],
        spaces: project.spaces || [],
        routes: project.routes || [],
        revisions: project.revisions || [],
      }}
      sheets={sheets.map((s) => ({ id: s.id, name: s.name, mime: s.mime, dataUrl: s.dataUrl }))}
      parts={parts}
      specHref={specHref}
    />
  );
}
