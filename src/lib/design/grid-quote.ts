/**
 * Grid → quote pricing (Spec 1, Task 4). Lifted verbatim out of
 * createDraftQuoteAction so the same math prices ONE OPTION of a project
 * and can be exercised on a scratch database without a session. Every
 * comment about tier pricing, #63/#76 fallbacks and #49 curtains still
 * applies; labor is per system (#232) — one line per BOM heading, computed
 * here from that heading's tier-priced material, never sent by the client.
 */

import { getSite, docLocId } from "@/lib/identity/sites";
import { resolveTier } from "@/lib/pricing-tiers";
import { isTierPriced } from "@/lib/tier-pricing";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { loadEquipPriceCtx, loadVirtualParts } from "@/lib/stores/equipment-map";
import { parseVirtualPartId, virtualPartsFor } from "@/lib/design/grid-virtual-parts";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import type { GridProject } from "@/lib/stores/grid-projects";
import { bomLines, bomTotals, curtainLines, routeLines, type BomLine } from "@/lib/design/grid-bom";
import { isFabricRow, priceGridCurtains } from "@/lib/design/grid-curtains";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { defaultOptionId, ensureOptions, hasOption, optionSlice } from "@/lib/design/grid-options";
import { riserLinksOf } from "@/lib/design/grid-riser-doc";
import { customItemBomLines, customItemsCost, customItemsOf } from "@/lib/design/grid-custom-items";
import { accessoriesCost, accessoriesOf, accessoryBomLines } from "@/lib/design/grid-accessories";
import { autoEstimateFor } from "@/lib/design/grid-auto-model";
import { groupedBomLines, isBomGroupKey, type BomGroupKey, type GroupablePart } from "@/lib/design/grid-bom-groups";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { getSettings } from "@/lib/settings";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { loadCurtainSewingPct, loadWireLaborRules } from "@/lib/stores/pricing";
import { gridLaborLines, sanitizeLaborOverrides, type GridLaborLine, type LaborOverrides, type WireLaborRules } from "@/lib/design/wire-labor";
import type { TierKey } from "@/app/(app)/design/quick/engine";

/** Labor's cost share when the tier margin is unusable (negative or ≥ 95 %) — a 30 % margin. */
const LABOR_COST_FRAC_FALLBACK = 0.7;

export type GridQuoteSpecLine = {
  sku: string; desc: string; qty: number; unit: string; price: number; ext: number; tierFallback?: true; allowance?: true;
};

export type GridQuoteBuild = {
  lines: BomLine[];
  value: number;
  margin: number;
  fallbackLines: string[];
  spec: { kind: "grid"; gridProjectId: string; gridOptionId: string; lines: GridQuoteSpecLine[] };
  tier: { tier: string; margin: number };
  locationId: string | null;
  quoteName: string;
  /** #232: this option's labor lines (sell), one per BOM heading with
   *  material or a typed override — the editor prints them under their
   *  heading; lines with amount > 0 are on the quote. */
  labor: GridLaborLine[];
};

/** The grouping slice of a Grid part, keyed by id (groupedBomLines' `parts`). */
export type GridGroupPart = GroupablePart & { id: string };

/**
 * What buildGridQuote reads, loaded ONCE for a batch of projects (fix wave 3,
 * I3): the catalog, the Grid library, the Equipment-map price context (only
 * when some placement is an Auto asm:/allow: part — built over the loaded
 * catalog, so no second catalog read) and a per-customer tier memo. A design
 * list priced N Grid designs with N whole-catalog loads before this.
 * `location: false` skips the site lookup (a budget read has no use for it).
 */
export type GridQuoteInputs = {
  catalog: CatalogPart[];
  symbols: GridSymbol[];
  equip: Awaited<ReturnType<typeof loadEquipPriceCtx>> | null;
  tierFor: (customerId: string | null | undefined) => ReturnType<typeof resolveTier>;
  location: boolean;
  /** #231/#232 rules (loadWireLaborRules). */
  wireLabor: WireLaborRules;
  /** #227 late: the curtain sewing % (loadCurtainSewingPct). */
  sewingPct: number;
  /** #232: the Grid library's grouping slice — the SAME PartLite rows the
   *  editor groups its BOM by (gridPartsFrom with the category map and device
   *  types), so a line's labor heading is the heading it prints under. */
  groupParts: ReadonlyArray<GridGroupPart>;
};

/**
 * The editor's grouping rows (#232): gridPartsFrom over the library with the
 * saved category map and the device-type context — exactly how the editor
 * page builds `parts`. Virtual (asm:/allow:) rows are added per build.
 */
export async function loadGridGroupParts(symbols: GridSymbol[], catalog: CatalogPart[]): Promise<GridGroupPart[]> {
  const [settings, deviceTypes] = await Promise.all([getSettings(), loadDeviceTypeContext(catalog)]);
  return gridPartsFrom(symbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { deviceTypes });
}

export async function loadGridQuoteInputs(
  projects: ReadonlyArray<GridProject>,
  opts: { location?: boolean } = {}
): Promise<GridQuoteInputs> {
  const anyVirtual = projects.some((p) => (p.placements || []).some((pl) => parseVirtualPartId(pl.partId) !== null));
  const [catalog, symbols, wireLabor, sewingPct] = await Promise.all([listCatalog(), listGridSymbols(), loadWireLaborRules(), loadCurtainSewingPct()]);
  const [equip, groupParts] = await Promise.all([
    anyVirtual ? loadEquipPriceCtx({ catalog }) : Promise.resolve(null),
    loadGridGroupParts(symbols, catalog),
  ]);
  const tiers = new Map<string, ReturnType<typeof resolveTier>>();
  const tierFor = (customerId: string | null | undefined) => {
    const k = customerId || "";
    if (!tiers.has(k)) tiers.set(k, resolveTier(customerId));
    return tiers.get(k)!;
  };
  return { catalog, symbols, equip, tierFor, location: opts.location ?? true, wireLabor, sewingPct, groupParts };
}

export async function buildGridQuote(
  project: GridProject,
  optionId: string,
  /** Preloaded reads shared across a batch (loadGridQuoteInputs). */
  inputs?: GridQuoteInputs
): Promise<{ ok: true; build: GridQuoteBuild } | { ok: false; error: string }> {
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const option = ensureOptions(project).options.find((o) => o.id === optionId)!;
  const { placements, routes } = optionSlice(project, optionId);
  // Typed-length riser connections (#209) price exactly like wire routes.
  const riserLinks = riserLinksOf(project.riser, optionId);
  // Per-design custom items (#212) — a design may be nothing but these.
  const customItems = customItemsOf(option.customItems);
  // BOM accessories (#230) — an option may be nothing but these, too.
  const accessories = accessoriesOf(option.accessories);
  if (!placements.length && !routes.length && !riserLinks.length && !customItems.length && !accessories.length)
    return { ok: false, error: "Place a device or route a wire first." };

  // Unresolved seed placeholders (D147) must not silently price at $0 (#64 idiom).
  const unresolvedSeeds = placements.filter((p) => isSeedPlaceholder(p.partId));
  if (unresolvedSeeds.length) {
    const names = Array.from(new Set(unresolvedSeeds.map((p) => p.category || p.partId))).sort();
    return {
      ok: false,
      error:
        `${unresolvedSeeds.length} seeded device${unresolvedSeeds.length === 1 ? "" : "s"} ` +
        `still need${unresolvedSeeds.length === 1 ? "s" : ""} a real catalog part before this can ` +
        `price: ${names.join(", ")}. Delete and re-drop each from the catalog, then try again.`,
    };
  }

  const tier = inputs ? await inputs.tierFor(project.customerId) : await resolveTier(project.customerId);
  const catalog = inputs ? inputs.catalog : await listCatalog();
  const symbols = inputs ? inputs.symbols : await listGridSymbols();
  // #211: Auto's assemblies and allowances (asm:/allow:) price live, with their real cost.
  // They are then tier-priced like every other Grid part (D314): a quoted
  // assembly's own sell is replaced by cost ÷ (1 − the customer's tier margin).
  // Only THIS option's virtual parts (a shared ctx must not let another
  // design's dead part refuse this one).
  const virtual = inputs?.equip
    ? virtualPartsFor(
        [...new Set(placements.map((p) => p.partId))].filter((id) => parseVirtualPartId(id) !== null),
        inputs.equip.map,
        inputs.equip.ctx
      )
    : await loadVirtualParts(placements.map((p) => p.partId), catalog);
  // A dead virtual part (deleted assembly, assembly with no priced member,
  // allowance no longer confirmed) must not price at $0 or at "list" — the
  // #64 seed-placeholder refusal, by name (D313).
  const deadIds = new Set(virtual.filter((v) => v.virtualDead).map((v) => v.id));
  if (deadIds.size) {
    const dead = placements.filter((p) => deadIds.has(p.partId));
    const names = Array.from(new Set(virtual.filter((v) => v.virtualDead).map((v) => v.desc))).sort();
    return {
      ok: false,
      error:
        `${dead.length} device${dead.length === 1 ? "" : "s"} need${dead.length === 1 ? "s" : ""} a part — ` +
        `replace or re-fill ${dead.length === 1 ? "it" : "them"} before this can price: ${names.join(", ")}.`,
    };
  }
  const allowanceIds = new Set(virtual.filter((v) => v.allowance).map((v) => v.id));
  const virtualRows = virtual.map((v) => ({
    id: v.id, sku: v.sku, desc: v.desc, category: v.category, unit: v.unit, list: v.list, cost: v.cost, role: undefined as string | undefined,
  }));
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
  const symbolRows = symbols.map((s) => {
    const p = s.pricingPartId ? pricingById.get(s.pricingPartId) : undefined;
    return p
      ? { ...p, id: s.id, sku: s.modelNumber || p.sku, desc: s.name }
      : { id: s.id, sku: s.modelNumber || s.id, desc: s.name, category: s.category, unit: "ea", list: 0, cost: 0, ports: s.ports };
  });
  const gridCatalog = [...symbolRows, ...virtualRows];
  const tierCatalog = gridCatalog.map((p) => ({
    ...p,
    list: isTierPriced(p.cost, tier.margin) ? Math.round((p.cost / (1 - tier.margin)) * 100) / 100 : p.list,
  }));
  const fallbackKeys = new Set(
    gridCatalog.filter((p) => !isTierPriced(p.cost, tier.margin)).flatMap((p) => [p.id, p.sku])
  );
  const isFallbackLine = (l: Pick<BomLine, "partId" | "kind">) => l.kind !== "curtain" && fallbackKeys.has(l.partId);

  const devLines = bomLines(placements, tierCatalog);
  const devTotals = bomTotals(placements, tierCatalog);
  const wires = routeLines(routes, tierCatalog, project.calibrations || [], riserLinks);

  // #227 late: curtains carry the sewing adder on top of the fabric rate.
  const sewingPct = inputs ? inputs.sewingPct : await loadCurtainSewingPct();
  const curtainPrices = priceGridCurtains(placements, catalog, { sewingPct }, tier.margin);
  const fabricNames = new Map(catalog.filter(isFabricRow).map((p) => [p.id, p.desc] as const));
  const curtains = curtainLines(placements, new Map([...curtainPrices].map(([id, v]) => [id, v.priceEach])), fabricNames);
  const curtainValue = curtains.reduce((a, l) => a + l.ext, 0);
  const curtainCostTotal = [...curtainPrices.values()].reduce((a, v) => a + v.costEach, 0);

  // Custom items (#212) price exactly like an Equipment-map allowance: sell =
  // unit cost ÷ (1 − the customer's tier margin). Always priced, so they never
  // make a design "Incomplete" or refuse the quote.
  const custom = customItemBomLines(customItems, tier.margin);
  const customValue = custom.reduce((a, l) => a + l.ext, 0);
  const customCost = customItemsCost(customItems);

  // BOM accessories (#230) price from the SAME tier catalog rows as a placed
  // part of that partId — tier sell, #76 list fallback and all.
  const acc = accessoryBomLines(accessories, tierCatalog);
  const accValue = acc.reduce((a, l) => a + l.ext, 0);
  const accCost = accessoriesCost(accessories, tierCatalog);

  // #232: labor is one line per BOM heading — that heading's tier-priced
  // material on this quote × labor % × the tier's multiplier, or the typed $
  // the option carries. "Material" is every non-labor line the editor prints
  // under the heading: placed devices (Auto lots, wire-pull lots included),
  // accessories, measured wire runs + RiserLinks, curtains and custom items —
  // partitioned by groupedBomLines over the same grouping rows the editor
  // uses, so the two can never disagree about which line counts where. The
  // tier is the option's Auto choice for that scope, else the option's own
  // tier, else none (×1.0); General always takes the option's tier. Labor
  // carries the customer's tier margin like every Grid line.
  const wireLabor = inputs ? inputs.wireLabor : await loadWireLaborRules();
  const groupParts = inputs ? inputs.groupParts : await loadGridGroupParts(symbols, catalog);
  const grouped = groupedBomLines({
    devices: devLines,
    wires: wires.lines,
    curtains,
    custom,
    customItems,
    accessories: acc,
    parts: [...groupParts, ...virtual],
    placements,
  });
  const material: Partial<Record<BomGroupKey, number>> = {};
  for (const l of grouped) if (l.ext > 0) material[l.group] = (material[l.group] ?? 0) + l.ext;
  const est = autoEstimateFor(project.autoEstimate, optionId, defaultOptionId(project));
  const laborTier = (sys: string): TierKey | null =>
    (sys !== "general" ? est?.tierByScope[sys as keyof typeof est.tierByScope] : undefined) ?? option.tier ?? null;
  // Only BOM headings take an override (setLaborOverride's rule), whatever an older doc holds.
  const overrides: LaborOverrides = {};
  for (const [k, v] of Object.entries(sanitizeLaborOverrides(option.laborOverrides))) if (isBomGroupKey(k)) overrides[k] = v;
  const laborLines = gridLaborLines(material, laborTier, wireLabor, overrides);
  const laborCostFrac = tier.margin >= 0 && tier.margin < 0.95 ? 1 - tier.margin : LABOR_COST_FRAC_FALLBACK;
  const labor = laborLines
    .filter((l) => l.amount > 0)
    .map((l) => ({ sku: l.sku, desc: l.desc, qty: 1, unit: "lot", price: l.amount, ext: l.amount, cost: Math.round(l.amount * laborCostFrac * 100) / 100 }));

  const lines: BomLine[] = [
    ...devLines,
    ...acc,
    ...wires.lines,
    ...curtains,
    ...custom,
    ...labor.map((l) => ({ partId: l.sku, desc: l.desc, unit: l.unit, qty: l.qty, list: l.price, ext: l.ext })),
  ];
  const value = devTotals.value + accValue + wires.value + curtainValue + customValue + labor.reduce((a, l) => a + l.ext, 0);
  const cost = devTotals.cost + accCost + wires.cost + curtainCostTotal + customCost + labor.reduce((a, l) => a + l.cost, 0);
  const margin = value > 0 ? (value - cost) / value : 0;
  const fallbackLines = lines.filter(isFallbackLine).map((l) => l.desc);

  const site = project.siteId && (inputs?.location ?? true) ? await getSite(project.siteId) : null;
  const locationId = site ? docLocId(site) : null;
  const spec = {
    kind: "grid" as const,
    gridProjectId: project.id,
    gridOptionId: optionId,
    lines: lines.map((l) => ({
      sku: l.kind === "curtain" ? "CURTAIN" : l.partId,
      desc: l.desc,
      qty: l.qty,
      unit: l.unit,
      price: l.list,
      ext: l.ext,
      ...(isFallbackLine(l) ? { tierFallback: true as const } : {}),
      ...(allowanceIds.has(l.partId) || l.allowance ? { allowance: true as const } : {}),
    })),
  };
  const manyOptions = ensureOptions(project).options.length > 1;
  const quoteName = `${project.name}${manyOptions ? ` · ${option.name}` : ""} — The Grid design`;

  return { ok: true, build: { lines, value, margin, fallbackLines, spec, tier: { tier: tier.tier, margin: tier.margin }, locationId, quoteName, labor: laborLines } };
}
