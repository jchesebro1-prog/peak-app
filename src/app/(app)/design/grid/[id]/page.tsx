import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getProject, listSheets } from "@/lib/stores/grid-projects";
import { resolveOptionId } from "@/lib/design/grid-options";
import { list as listCatalog } from "@/lib/stores/catalog";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { ownFiles } from "@/lib/part-docs/coverage";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { allEngagements } from "@/lib/stores/engagements";
import { isOpenEngagement } from "@/lib/consulting-review";
import { sitesForCompany } from "@/lib/identity/sites";
import { num } from "@/lib/stores/pricing";
import { getSettings } from "@/lib/settings";
import { listDesigns } from "@/lib/stores/studio-designs";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { fabricSellPerSqft, sellCoeffs } from "@/lib/curtain-pricing";
import { resolveTier } from "@/lib/pricing-tiers";
import { fabricAreaRate, isFabricRow } from "@/lib/design/grid-curtains";
import { symbolContext } from "@/lib/design/grid-icons";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { resolveWireTypes } from "@/lib/catalog-connect";
import type { FabricSell } from "@/lib/curtain-geom";
import { compute, tierDefsDefault, tierSystems } from "@/app/(app)/design/quick/engine";
import { scopeTargetsByTier } from "@/lib/design/scope-targets";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { option: requestedOption } = await searchParams;
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

  const activeOptionId = resolveOptionId(project, requestedOption);

  const [sheets, catalog, gridSymbols, engagements, laborHoursPerDevice, settings, linesetDesigns] = await Promise.all([
    listSheets(project.id),
    listCatalog(),
    listGridSymbols(),
    allEngagements(),
    // Install-hours-per-device knob (D114) — admin-tunable, now registered in
    // pricing.ts GROUPS (key "grid") and editable from Design → Grid Settings
    // as well as Estimating Rules. num() (not frac()) because this is a raw
    // hours figure, not a percent rate.
    num("grid.laborHoursPerDevice", 0.5),
    getSettings(),
    listDesigns({ kind: "lineset" }),
  ]);
  // Beta group resolution (Task 6, punch #39) — server-side only; the
  // editor receives each part's already-resolved `group` and never sees
  // the map itself.
  const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);

  // Admin-edited wire-type registry (Design → Grid Settings) — threaded into
  // the client-side canConnect() pre-check the same way the server action
  // (addRouteAction) re-derives it as the authority. Without this the editor
  // always fell back to DEFAULT_WIRE_TYPES and an admin's edits here were
  // invisible to the UX-only check (the server action was the same gap).
  const wireTypes = resolveWireTypes(settings.wireTypes);

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

  /** Client payload: sheets without re-serialization surprises + PartLite slice
   *  (the one builder the riser, drawing set and schedule use too — #209). */
  // #207: "has a datasheet" = a stored datasheet document of the part's own;
  // the editor's link goes through /api/part-datasheet/<sku>, which bridges
  // to the part-document viewer. loadPartDocsState runs the legacy backfill
  // first, so a legacy blob is a document by now — and a replaced or
  // detached legacy file no longer counts (final fix wave, I1).
  const { index: docIndex } = await loadPartDocsState(catalog);
  const hasDatasheetFile = (p: (typeof catalog)[number]) => ownFiles(docIndex, p.sku, "datasheet").length > 0;
  const parts: PartLite[] = gridPartsFrom(gridSymbols, catalog, categoryMap, { hasDatasheet: hasDatasheetFile });

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

  // Scope targets (#GEM, D-GEM-5) — computed HERE; only sell numbers reach the
  // editor. The cost-bearing fabric rows below never leave the server.
  const engineFabrics: FabricOption[] = catalog
    .filter((p) => p.category === "Fabric")
    .map((p) => ({ sku: p.sku, desc: p.desc, costPerSqft: p.costPerSqft ?? null }));
  const scopeTargets = project.scopeInputs
    ? scopeTargetsByTier(project.scopeInputs, (s, t) => tierSystems(compute(s), s, t, tierDefsDefault(), engineFabrics))
    : null;

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
      activeOptionId={activeOptionId}
      project={{
        id: project.id,
        name: project.name,
        customer: project.customer,
        siteId: project.siteId || null,
        siteName: project.siteName || "",
        quoteId: project.quoteId,
        options: project.options || [],
        scopeInputs: project.scopeInputs || null,
        placements: project.placements || [],
        calibrations: project.calibrations || [],
        spaces: project.spaces || [],
        routes: project.routes || [],
        revisions: project.revisions || [],
        linesetDesignId: project.linesetDesignId || null,
        riser: project.riser || {},
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
      scopeTargets={scopeTargets}
      curtainCoeffs={curtainCoeffs}
      laborParts={laborParts}
      laborHoursPerDevice={laborHoursPerDevice}
      specHref={specHref}
      venues={venues}
      symbolCtx={symbolContext(settings)}
      wireTypes={wireTypes}
      linesetDesigns={linesetDesigns.map((d) => ({ id: d.id, name: d.name }))}
    />
  );
}
