import Link from "next/link";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import { can } from "@/lib/team";
import { ensureDesignators, getProject, listSheets } from "@/lib/stores/grid-projects";
import { defaultOptionId, estimateLinkOf, resolveOptionId } from "@/lib/design/grid-options";
import { coverFromVenue } from "@/lib/design/grid-intake";
import { loadEstimateTray } from "@/lib/design/estimate-tray-server";
import { planCandidatesFor } from "@/lib/design/grid-plan-intake-server";
import { cleanIntakeNotices, publicPlanCandidates, type PlanCandidate } from "@/lib/design/grid-plan-intake";
import { get as getQuote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { quoteBuilderHref } from "@/lib/quote-links";
import { list as listCatalog } from "@/lib/stores/catalog";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { ownFiles } from "@/lib/part-docs/coverage";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { docLocId, sitesForCompany } from "@/lib/identity/sites";
import { all as allCustomers } from "@/lib/stores/customers";
import { allCompanies } from "@/lib/identity/companies";
import { intakeCustomersFrom } from "@/lib/intake-customer";
import { venueTypesFrom } from "@/lib/venue-types";
import { loadCurtainSewingPct, loadWireLaborRules } from "@/lib/stores/pricing";
import { getSettings } from "@/lib/settings";
import { listDesigns } from "@/lib/stores/studio-designs";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { fabricSellPerSqft } from "@/lib/curtain-pricing";
import { fabricAreaRateOf } from "@/lib/design/curtain-pricing";
import { resolveTier } from "@/lib/pricing-tiers";
import { isFabricRow } from "@/lib/design/grid-curtains";
import { symbolContext } from "@/lib/design/grid-icons";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { resolveWireTypes } from "@/lib/catalog-connect";
import type { FabricSell } from "@/lib/curtain-geom";
import { compute, tierDefsDefault } from "@/app/(app)/design/quick/engine";
import { tierSystems } from "@/lib/design/equipment-pricing";
import { buildEquipmentPriceTable } from "@/lib/design/equipment-map";
import { loadEquipPriceCtx } from "@/lib/stores/equipment-map";
import { scopeTargetsByTier } from "@/lib/design/scope-targets";
import { autoEstimateCards, autoTargets, priceOverrides, sellOnlyCards } from "@/lib/design/auto-estimate";
import { autoEstimateFor } from "@/lib/design/grid-auto-model";
import { virtualPartsFor } from "@/lib/design/grid-virtual-parts";
import { customItemBomLines, customItemsOf } from "@/lib/design/grid-custom-items";
import { getGridFavorites, getGridRecent, loadDeviceTypeContext } from "@/lib/stores/device-types";
import type { PartLite } from "@/lib/design/grid-bom";
import { buildGridQuote, type GridQuoteInputs } from "@/lib/design/grid-quote";
import { CanMapProvider } from "@/components/design/equipment-map-link";
import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";
import { allSpecRecords } from "@/lib/stores/spec-records";
import { systemMatchKeys } from "@/lib/specs/records";
import { scheduleForOption } from "@/lib/design/grid-schedule-server";
import GridEditor from "./editor";
import GridIntake from "./grid-intake";
import { cleanSymbolDisplay } from "@/lib/design/grid-symbol-display";
import { isBaseSheet } from "@/lib/design/sheet-adjust";
import { symbolUrlsFor } from "@/lib/design/object-symbols-server";

export const metadata = { title: "The Grid — Quartzite-6" };
export const dynamic = "force-dynamic";
/** #210: listFixtures() (via loadEquipPriceCtx) can run the one-time fixture
 *  conversion under its 15 s budget (FIXTURES_CONVERT_BUDGET_MS). #222: a
 *  quote from The Grid renders its saved PDF in `after()`, inside this budget
 *  — 120 s (fix wave 1). */
export const maxDuration = 120;

/**
 * The Grid editor route (D108) — full-width like the markup screen: laying
 * out a system needs the whole viewport.
 */
export default async function GridEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string; adjust?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { option: requestedOption, adjust: requestedAdjust } = await searchParams;
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
    // #244 — the intake picks the customer the way the quote intake does:
    // the same directory view-model, loaded only when the intake renders.
    const [customerDocs, intakeSettings] = await Promise.all([allCustomers(), getSettings()]);
    const customers = intakeCustomersFrom(customerDocs);
    const known = project.customerId ? customers.find((c) => c.id === project.customerId) : null;
    const knownSite = known && project.siteId ? (await sitesForCompany(known.id)).find((s) => s.id === project.siteId) : null;
    const knownLocId = knownSite ? docLocId(knownSite) : "";
    // #314: a design drawn from an estimate — the intake is short and
    // prefilled (customer, venue, title came from the quote at creation);
    // Auto is not offered. Its estimate number names the source.
    const link = estimateLinkOf(project);
    const linkedQuote = link ? await getQuote(link.quoteId) : null;
    const estimate = link
      ? { quoteId: link.quoteId, quoteNumber: linkedQuote ? displayQuoteNumber(linkedQuote) : link.quoteId, href: quoteBuilderHref({ id: link.quoteId, quoteType: linkedQuote?.quoteType ?? "system" }) }
      : null;
    // #314: the plan view — plans this job already has on file. Never fatal.
    const planCandidates: PlanCandidate[] = await planCandidatesFor({
      customerId: known ? known.id : null,
      siteLocId: knownSite ? knownLocId : null,
      quoteId: link?.quoteId ?? null,
    })
      .then(publicPlanCandidates)
      .catch((e: unknown) => {
        console.error("[grid] plan candidates failed:", e);
        return [];
      });
    const initialCover = knownSite && known
      ? coverFromVenue({ label: knownSite.name, locationName: knownSite.locationName, address: knownSite.address, city: knownSite.city, state: knownSite.state }, known.name)
      : undefined;
    return (
      <CanMapProvider canMap={can("manage_users", user.roles)}>
        <GridIntake
          projectId={project.id}
          projectName={project.name}
          initialAutoConfig={project.intake.autoConfig}
          customers={customers}
          venueTypes={venueTypesFrom(intakeSettings.venueTypes)}
          initialCustomer={{
            customerId: known ? known.id : "",
            locationId: known && known.locations.some((l) => l.id === knownLocId) ? knownLocId : "",
            contactName: known && known.contacts.some((c) => c.name === project.contactName) ? project.contactName || "" : "",
          }}
          estimate={estimate}
          initialCover={initialCover}
          planCandidates={planCandidates}
          blobUploads={blobEnabled()}
        />
      </CanMapProvider>
    );
  }

  const activeOptionId = resolveOptionId(project, requestedOption);

  const [sheets, catalog, gridSymbols, settings, linesetDesigns, wireLabor, sewingPct, companies, specRecords] = await Promise.all([
    listSheets(project.id),
    listCatalog(),
    listGridSymbols(),
    getSettings(),
    listDesigns({ kind: "lineset" }),
    loadWireLaborRules(),
    loadCurtainSewingPct(),
    allCompanies(),
    allSpecRecords(),
  ]);
  // #244 — the header's customer control: a lean list (id, name, type).
  const customerOptions = companies.map((c) => ({ id: c.id, name: c.name, ...(c.type ? { detail: c.type } : {}) }));
  // Beta group resolution (Task 6, punch #39) — server-side only; the
  // editor receives each part's already-resolved `group` and never sees
  // the map itself.
  const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);

  // #226: curated device types. Reading the map auto-applies confident
  // category matches (spec); every PartLite then carries its type + the
  // type's scope. Favorites/Recent are the signed-in user's own lists.
  const [deviceTypes, favorites, recent] = await Promise.all([
    loadDeviceTypeContext(catalog),
    getGridFavorites(user.id),
    getGridRecent(user.id),
  ]);

  // Admin-edited wire-type registry (Design → Grid Settings) — threaded into
  // the client-side canConnect() pre-check the same way the server action
  // (addRouteAction) re-derives it as the authority. Without this the editor
  // always fell back to DEFAULT_WIRE_TYPES and an admin's edits here were
  // invisible to the UX-only check (the server action was the same gap).
  const wireTypes = resolveWireTypes(settings.wireTypes);

  // Venue picker options (D113.6) — the customer's sites.
  const sites = project.customerId ? await sitesForCompany(project.customerId) : [];
  const venues = sites.map((s) => ({ id: s.id, name: s.name || "Unnamed venue" }));

  // The Equipment map price context (#211) — built from the catalog this
  // request already loaded (no second load). The map and its context stay
  // server-side: the editor gets scope-target sell numbers, plus one PartLite
  // per virtual assembly/allowance the design actually places — and those rows
  // carry `cost` exactly like the Grid-library PartLite rows already do
  // (PartLite.cost is part of the existing payload), nothing more.
  const equipLoaded = await loadEquipPriceCtx({ catalog });
  const { map: equipMap, ctx: equipCtx } = equipLoaded;
  const equipTable = buildEquipmentPriceTable(equipMap, equipCtx);
  const scopeTargets = project.scopeInputs
    ? scopeTargetsByTier(project.scopeInputs, (s, t) => tierSystems(compute(s), s, t, tierDefsDefault(), equipTable, {}, wireLabor))
    : null;

  // Auto designs (#211): the chosen cards, priced server-side; the editor
  // gets sell-only lines + targets. Adapted for D312 (not in the
  // original brief): autoEstimate is stored PER OPTION, so the active
  // option's choices are resolved with autoEstimateFor (a legacy
  // single-value doc reads as the first option's) rather than a bare
  // `project.autoEstimate`.
  const optionAutoEstimate = autoEstimateFor(project.autoEstimate, activeOptionId, defaultOptionId(project));
  const autoCards =
    optionAutoEstimate && project.scopeInputs
      ? autoEstimateCards(project.scopeInputs, optionAutoEstimate, equipTable, priceOverrides(optionAutoEstimate.overrides, equipCtx), wireLabor)
      : null;
  const auto =
    autoCards && optionAutoEstimate
      ? { estimate: optionAutoEstimate, cards: sellOnlyCards(autoCards), targets: autoTargets(autoCards) }
      : null;

  /** Client payload: sheets without re-serialization surprises + PartLite slice
   *  (the one builder the riser, drawing set and schedule use too — #209). */
  // #207: "has a datasheet" = a stored datasheet document of the part's own;
  // the editor's link goes through /api/part-datasheet/<sku>, which bridges
  // to the part-document viewer. loadPartDocsState runs the legacy backfill
  // first, so a legacy blob is a document by now — and a replaced or
  // detached legacy file no longer counts (final fix wave, I1).
  const { index: docIndex, documents: docRows, links: docLinks } = await loadPartDocsState(catalog);
  const hasDatasheetFile = (p: (typeof catalog)[number]) => ownFiles(docIndex, p.sku, "datasheet").length > 0;
  // #211: assemblies and allowances placed by Auto resolve live into PartLite rows.
  const parts: PartLite[] = [
    ...gridPartsFrom(gridSymbols, catalog, categoryMap, { hasDatasheet: hasDatasheetFile, deviceTypes }),
    ...virtualPartsFor((project.placements || []).map((pl) => pl.partId), equipMap, equipCtx),
  ];
  // #300 (D609): each part's object drawing URLs, resolved here so the client
  // never reads documents. A lookup failure must never break the editor — it
  // just draws the generic symbols. The documents and links loaded above are
  // reused, so the lookup queries nothing.
  const symbolUrls = await symbolUrlsFor(parts, deviceTypes.types, { docs: docRows, links: docLinks }).catch((e: unknown) => {
    console.error("[grid] object symbol lookup failed:", e);
    return {};
  });
  // #320: number every device that has no designator yet (a design drawn
  // before #320) — one write, none at all when nothing is missing, codes from
  // the parts this request already built. Never fatal.
  const designed = await ensureDesignators(project, { parts, deviceTypes }).catch((e: unknown) => {
    console.error("[grid] designators failed:", e);
    return project;
  });


  /**
   * Curtain drop-in (punch #49): the fabric list with its sell price/sq ft for
   * the editor's live price preview. These are SELL numbers only - the margin
   * and the cost basis stay on the server (lib/design/curtain-pricing is never
   * imported by the editor). The preview matches the quote to the cent because
   * both run the same flat $/sq ft model (#227) at the same tier margin, with
   * the sewing adder (#227 late) folded into the sell rate.
   */
  // #254: company + the design's contact — the tier buildGridQuote stamps.
  const tier = await resolveTier(project.customerId, project.contactName);
  const fabrics: FabricSell[] = catalog
    .filter(isFabricRow)
    .map((p) => ({
      sku: p.id,
      name: p.desc,
      pricePerSqft: fabricSellPerSqft({ fabricRate: fabricAreaRateOf(p), sewingPct }, tier.margin),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // #212: the active option's custom items, sell-priced at this customer's
  // tier margin exactly as buildGridQuote prices them. Sell numbers only —
  // the margin stays on the server (the curtain rule above).
  const customLines = customItemBomLines(
    customItemsOf(project.options?.find((o) => o.id === activeOptionId)?.customItems),
    tier.margin
  );
  // #232: the active option's labor lines, computed by the quote builder
  // itself over this request's reads — grouped by the same `parts` rows the
  // editor groups its BOM by — so each heading's labor line is exactly what
  // the draft quote will carry. Sell numbers only. A design that can't price
  // yet (empty, a seed placeholder, a dead Auto part) shows no labor until
  // it can.
  const quoteInputs: GridQuoteInputs = {
    catalog,
    symbols: gridSymbols,
    equip: equipLoaded,
    tierFor: () => Promise.resolve(tier),
    location: false,
    wireLabor,
    sewingPct,
    groupParts: parts,
  };
  // A pricing fault must not take the editor down with it — the quote
  // action reports it where the person can act on it.
  const built = await buildGridQuote(project, activeOptionId, quoteInputs).catch((e: unknown) => {
    console.error("Grid editor: labor lines unavailable", e);
    return null;
  });
  const laborLines = built?.ok ? built.build.labor : [];

  // #299: the Spreadsheet view — the active option's equipment schedule,
  // built by the /schedule page's own helper over this request's reads
  // (catalog fallback + virtual parts + riser view), so the two never differ.
  // A schedule fault must not take the editor down with it either — the view
  // says it couldn't be built and points at the printable page's own error.
  const schedule = await scheduleForOption(designed, activeOptionId, { catalog, gridSymbols, settings, deviceTypes, equip: equipLoaded }).catch(
    (e: unknown) => {
      console.error("[grid] schedule build failed:", e);
      return null;
    }
  );

  // #223 — each option's draft quote by its estimate number.
  const quoteNumbers = Object.fromEntries(await quoteNumbersFor((project.options || []).map((o) => o.quoteId)));

  // #314: a design drawn from an estimate — the quote button becomes "Open
  // estimate →" for every option, and the estimate-owned option gets the
  // From estimate tray, read LIVE from the quote's saved spec. Never fatal.
  const link = estimateLinkOf(project);
  const estimateLink = link
    ? { quoteId: link.quoteId, quoteNumber: quoteNumbers[link.quoteId] ?? link.quoteId, href: quoteBuilderHref({ id: link.quoteId, quoteType: "system" }) }
    : null;
  const estimateTray =
    link && link.optionId === activeOptionId
      ? await loadEstimateTray(
          link.quoteId,
          (project.placements || []).filter((pl) => pl.optionId === activeOptionId).map((pl) => pl.partId)
        ).catch((e: unknown) => {
          console.error("[grid] estimate tray failed:", e);
          return null;
        })
      : null;

  return (
    <CanMapProvider canMap={can("manage_users", user.roles)}>
    <GridEditor
      canCreate={can("create", user.roles)}
      quoteNumbers={quoteNumbers}
      activeOptionId={activeOptionId}
      project={{
        id: project.id,
        name: project.name,
        customer: project.customer,
        customerId: project.customerId || null,
        siteId: project.siteId || null,
        siteName: project.siteName || "",
        quoteId: project.quoteId,
        options: project.options || [],
        scopeInputs: project.scopeInputs || null,
        placements: designed.placements || [],
        calibrations: project.calibrations || [],
        spaces: project.spaces || [],
        routes: project.routes || [],
        revisions: project.revisions || [],
        linesetDesignId: project.linesetDesignId || null,
        riser: project.riser || {},
        symbolDisplay: cleanSymbolDisplay(project.symbolDisplay),
      }}
      sheets={sheets.map((s) => ({
        id: s.id,
        name: s.name,
        mime: s.mime,
        // Blob-stored sheets stream through the authenticated proxy (the
        // store is private, D116); in-database sheets pass their data-URL.
        dataUrl: s.blobPath ? `/api/grid-sheets/${encodeURIComponent(s.id)}` : s.dataUrl,
        // #318: how the sheet was derived (Adjust sheet) and whether it is the generated base sheet.
        adjust: s.adjust ?? null,
        base: isBaseSheet(s, project.intake),
      }))}
      parts={parts}
      fabrics={fabrics}
      // Spec records design §6: the curtain dialog's Spec options, as plain strings.
      specKeys={systemMatchKeys(specRecords)}
      scopeTargets={scopeTargets}
      auto={auto}
      venues={venues}
      customerOptions={customerOptions}
      symbolCtx={symbolContext(settings, deviceTypes.types)}
      wireTypes={wireTypes}
      linesetDesigns={linesetDesigns.map((d) => ({ id: d.id, name: d.name }))}
      customLines={customLines}
      laborLines={laborLines}
      schedule={schedule}
      deviceTypes={deviceTypes.types}
      symbolUrls={symbolUrls}
      favorites={favorites}
      recent={recent}
      estimateLink={estimateTray ? { quoteId: estimateTray.quoteId, quoteNumber: estimateTray.quoteNumber, href: estimateTray.href } : estimateLink}
      estimateTray={estimateTray}
      // #314 review: what the intake save left for the editor, and the plan view to open on.
      intakeNotices={cleanIntakeNotices(project.intake?.notices)}
      focusSheetId={project.intake?.planSheetId && (project.sheetIds || []).includes(project.intake.planSheetId) ? project.intake.planSheetId : null}
      blobUploads={blobEnabled()}
      adjustSheetId={requestedAdjust && (project.sheetIds || []).includes(requestedAdjust) ? requestedAdjust : null}
    />
    </CanMapProvider>
  );
}
