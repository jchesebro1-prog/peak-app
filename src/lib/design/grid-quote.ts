/**
 * Grid → quote pricing (Spec 1, Task 4). Lifted verbatim out of
 * createDraftQuoteAction so the same math prices ONE OPTION of a project
 * and can be exercised on a scratch database without a session. Every
 * comment about tier pricing, #63/#76 fallbacks, #49 curtains and D114
 * labor still applies — the logic is unchanged, only the input slice is.
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
import { ensureOptions, hasOption, optionSlice } from "@/lib/design/grid-options";
import { riserLinksOf } from "@/lib/design/grid-riser-doc";

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
};

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
};

export async function loadGridQuoteInputs(
  projects: ReadonlyArray<GridProject>,
  opts: { location?: boolean } = {}
): Promise<GridQuoteInputs> {
  const anyVirtual = projects.some((p) => (p.placements || []).some((pl) => parseVirtualPartId(pl.partId) !== null));
  const [catalog, symbols] = await Promise.all([listCatalog(), listGridSymbols()]);
  const equip = anyVirtual ? await loadEquipPriceCtx({ catalog }) : null;
  const tiers = new Map<string, ReturnType<typeof resolveTier>>();
  const tierFor = (customerId: string | null | undefined) => {
    const k = customerId || "";
    if (!tiers.has(k)) tiers.set(k, resolveTier(customerId));
    return tiers.get(k)!;
  };
  return { catalog, symbols, equip, tierFor, location: opts.location ?? true };
}

export async function buildGridQuote(
  project: GridProject,
  optionId: string,
  laborLines?: Array<{ partId: string; hours: number }>,
  /** Preloaded reads shared across a batch (loadGridQuoteInputs). */
  inputs?: GridQuoteInputs
): Promise<{ ok: true; build: GridQuoteBuild } | { ok: false; error: string }> {
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const option = ensureOptions(project).options.find((o) => o.id === optionId)!;
  const { placements, routes } = optionSlice(project, optionId);
  // Typed-length riser connections (#209) price exactly like wire routes.
  const riserLinks = riserLinksOf(project.riser, optionId);
  if (!placements.length && !routes.length && !riserLinks.length)
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
  // #GEM: Auto's assemblies and allowances (asm:/allow:) price live, with their real cost.
  // They are then tier-priced like every other Grid part (D-GEM-14): a quoted
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
  // #64 seed-placeholder refusal, by name (D-GEM-13).
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
  const tierSource = [...gridCatalog, ...catalog.filter((p) => (p.role || "").toLowerCase() === "labor")];
  const tierCatalog = tierSource.map((p) => ({
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

  const curtainPrices = priceGridCurtains(placements, catalog, tier.margin);
  const fabricNames = new Map(catalog.filter(isFabricRow).map((p) => [p.id, p.desc] as const));
  const curtains = curtainLines(placements, new Map([...curtainPrices].map(([id, v]) => [id, v.priceEach])), fabricNames);
  const curtainValue = curtains.reduce((a, l) => a + l.ext, 0);
  const curtainCostTotal = [...curtainPrices.values()].reduce((a, v) => a + v.costEach, 0);

  const labor: Array<{ sku: string; desc: string; qty: number; unit: string; price: number; ext: number; cost: number }> = [];
  for (const l of laborLines || []) {
    const part = tierCatalog.find((p) => p.id === l.partId);
    const hours = Number(l.hours);
    if (!part || (part.role || "").toLowerCase() !== "labor") continue;
    if (!(hours > 0) || hours > 10000) continue;
    labor.push({ sku: part.sku, desc: part.desc, qty: hours, unit: part.unit || "hr", price: part.list, ext: hours * part.list, cost: hours * part.cost });
  }

  const lines: BomLine[] = [
    ...devLines,
    ...wires.lines,
    ...curtains,
    ...labor.map((l) => ({ partId: l.sku, desc: l.desc, unit: l.unit, qty: l.qty, list: l.price, ext: l.ext })),
  ];
  const value = devTotals.value + wires.value + curtainValue + labor.reduce((a, l) => a + l.ext, 0);
  const cost = devTotals.cost + wires.cost + curtainCostTotal + labor.reduce((a, l) => a + l.cost, 0);
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
      ...(allowanceIds.has(l.partId) ? { allowance: true as const } : {}),
    })),
  };
  const manyOptions = ensureOptions(project).options.length > 1;
  const quoteName = `${project.name}${manyOptions ? ` · ${option.name}` : ""} — The Grid design`;

  return { ok: true, build: { lines, value, margin, fallbackLines, spec, tier: { tier: tier.tier, margin: tier.margin }, locationId, quoteName } };
}
