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
import type { GridProject } from "@/lib/stores/grid-projects";
import { bomLines, bomTotals, curtainLines, routeLines, type BomLine } from "@/lib/design/grid-bom";
import { isFabricRow, priceGridCurtains } from "@/lib/design/grid-curtains";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { ensureOptions, hasOption, optionSlice } from "@/lib/design/grid-options";
import { riserLinksOf } from "@/lib/design/grid-riser-doc";

export type GridQuoteSpecLine = {
  sku: string; desc: string; qty: number; unit: string; price: number; ext: number; tierFallback?: true;
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

export async function buildGridQuote(
  project: GridProject,
  optionId: string,
  laborLines?: Array<{ partId: string; hours: number }>
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

  const tier = await resolveTier(project.customerId);
  const catalog = await listCatalog();
  const symbols = await listGridSymbols();
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
  const gridCatalog = symbols.map((s) => {
    const p = s.pricingPartId ? pricingById.get(s.pricingPartId) : undefined;
    return p
      ? { ...p, id: s.id, sku: s.modelNumber || p.sku, desc: s.name }
      : { id: s.id, sku: s.modelNumber || s.id, desc: s.name, category: s.category, unit: "ea", list: 0, cost: 0, ports: s.ports };
  });
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

  const site = project.siteId ? await getSite(project.siteId) : null;
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
    })),
  };
  const manyOptions = ensureOptions(project).options.length > 1;
  const quoteName = `${project.name}${manyOptions ? ` · ${option.name}` : ""} — The Grid design`;

  return { ok: true, build: { lines, value, margin, fallbackLines, spec, tier: { tier: tier.tier, margin: tier.margin }, locationId, quoteName } };
}
