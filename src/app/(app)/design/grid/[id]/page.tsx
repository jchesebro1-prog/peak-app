import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getProject, listSheets } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { allEngagements } from "@/lib/stores/engagements";
import { isOpenEngagement } from "@/lib/consulting-review";
import { sitesForCompany } from "@/lib/identity/sites";
import { frac } from "@/lib/stores/pricing";
import { getSettings } from "@/lib/settings";
import { groupOf, resolveCategoryMap, tradeOf } from "@/lib/catalog-taxonomy";
import { fabricSellPerSqft, sellCoeffs } from "@/lib/curtain-pricing";
import { resolveTier } from "@/lib/pricing-tiers";
import { fabricAreaRate, isFabricRow } from "@/lib/design/grid-curtains";
import { resolveCategoryShapes } from "@/lib/design/grid-symbols";
import type { FabricSell } from "@/lib/curtain-geom";
import type { FabricOption } from "@/app/(app)/design/quick/engine";
import type { PartLite } from "@/lib/design/grid-bom";
import type { LaborPartLite } from "@/lib/design/grid-labor";
import GridEditor from "./editor";
import GridIntake from "./grid-intake";

export const metadata = { title: "The Grid — Quartzite-6" };
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
  const user = await requireUser();
  const { id } = await params;
  const project = await getProject(decodeURIComponent(id));

  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/designs" style={{ color: "#3155a8" }}>
          ← Back to The Grid
        </Link>
      </div>
    );
  }

  if (project.intake && !project.intake.complete) {
    return <GridIntake projectId={project.id} projectName={project.name} initialAutoConfig={project.intake.autoConfig} />;
  }

  const [sheets, catalog, gridSymbols, engagements, laborHoursPerDevice, settings] = await Promise.all([
    listSheets(project.id),
    listCatalog(),
    listGridSymbols(),
    allEngagements(),
    // Install-hours-per-device knob (D114) — admin-tunable like every rate.
    frac("grid.laborHoursPerDevice", 0.5),
    getSettings(),
  ]);
  // Beta group resolution (Task 6, punch #39) — server-side only; the
  // editor receives each part's already-resolved `group` and never sees
  // the map itself.
  const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);

  // The D94 bid-spec generator is engagement-scoped; when the customer has a
  // live engagement, the editor links straight into it (the generator's
  // "Start from a quote" list matches this design's quote by customer).
  const eng = project.customerId
    ? engagements.find(
        (e) => e.companyId === project.customerId && isOpenEngagement(e)
      )
    : undefined;
  const specHref = eng ? `/design/engagements/spec?id=${encodeURIComponent(eng.id)}` : null;

  // Venue picker options (D113.6) — the customer's sites.
  const sites = project.customerId ? await sitesForCompany(project.customerId) : [];
  const venues = sites.map((s) => ({ id: s.id, name: s.name || "Unnamed venue" }));

  /** Client payload: sheets without re-serialization surprises + PartLite slice. */
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
  const parts: PartLite[] = gridSymbols.map((s) => {
    const p = s.pricingPartId ? pricingById.get(s.pricingPartId) : undefined;
    return {
      id: s.id,
      sku: s.modelNumber || s.id,
      desc: s.name,
      category: s.category || "Other",
      unit: p?.unit || "ea",
      list: p?.list || 0,
      cost: p?.cost || 0,
      ...(s.ports.length > 0 ? { ports: s.ports } : {}),
      ...(p?.datasheetBlobKey ? { hasDatasheet: true } : {}),
      ...(p ? { group: groupOf(p, categoryMap), trade: tradeOf(p, categoryMap) } : {}),
      manufacturer: s.manufacturer,
      modelNumber: s.modelNumber,
      gridScope: s.scope,
      symbolWidth: s.width,
      symbolHeight: s.height,
      kind: s.kind || "device",
      assemblyMembers: s.members,
      pricingPartId: s.pricingPartId,
      shape: s.shape ?? null, // #131 per-entry override; category defaults ride separately
    };
  });

  /**
   * Curtain drop-in (punch #49): the fabric list and the sell coefficients for
   * the editor's live price preview. These are SELL numbers only - the margin
   * and the cost basis stay on the server (lib/design/curtain-pricing is never
   * imported by the editor). The preview matches the quote to the cent because
   * both run the same two-term model at the same tier margin.
   */
  const tier = await resolveTier(project.customerId);
  const fabrics: FabricSell[] = catalog
    .filter(isFabricRow)
    .map((p) => ({
      sku: p.id,
      name: p.desc,
      pricePerSqft: fabricSellPerSqft(fabricAreaRate(p), tier.margin),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Cost-bearing fabric rows for the Scope panel's target $ math
  // (D-manual-scope-targets, engine.ts scopeTargets — see DECISIONS.md).
  const engineFabrics: FabricOption[] = catalog
    .filter((p) => p.category === "Fabric")
    .map((p) => ({ sku: p.sku, desc: p.desc, costPerSqft: p.costPerSqft ?? null }));

  const curtainCoeffs = sellCoeffs(tier.margin);
  const laborParts: LaborPartLite[] = catalog
    .filter((p) => (p.role || "").toLowerCase() === "labor")
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      desc: p.desc,
      category: p.category,
      unit: p.unit,
      list: p.list,
      cost: p.cost,
      role: p.role,
      discipline: p.discipline,
    }));

  return (
    <GridEditor
      canCreate={can("create", user.roles)}
      project={{
        id: project.id,
        name: project.name,
        customer: project.customer,
        siteId: project.siteId || null,
        siteName: project.siteName || "",
        quoteId: project.quoteId,
        scopeInputs: project.scopeInputs || null,
        placements: project.placements || [],
        calibrations: project.calibrations || [],
        spaces: project.spaces || [],
        routes: project.routes || [],
        revisions: project.revisions || [],
        autoConfig: project.intake?.autoConfig,
        measurementBased: !!project.intake?.measurementBased,
      }}
      sheets={sheets.map((s) => ({
        id: s.id,
        name: s.name,
        mime: s.mime,
        // Blob-stored sheets stream through the authenticated proxy (the
        // store is private, D116); in-database sheets pass their data-URL.
        dataUrl: s.blobPath ? `/api/grid-sheets/${encodeURIComponent(s.id)}` : s.dataUrl,
      }))}
      parts={parts}
      fabrics={fabrics}
      engineFabrics={engineFabrics}
      curtainCoeffs={curtainCoeffs}
      laborParts={laborParts}
      laborHoursPerDevice={laborHoursPerDevice}
      specHref={specHref}
      venues={venues}
      categoryShapes={resolveCategoryShapes(settings.gridCategoryShapes)}
    />
  );
}
