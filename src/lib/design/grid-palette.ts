import type { PartLite } from "./grid-bom";
import { isFabricPart } from "@/lib/fabric-part";
import { scopeOfPart, type GridLayer } from "./grid-scopes";
import { ALLOWANCE_TYPE, ASSEMBLY_TYPE, UNMAPPED_TYPE, typeKeyOfPart, typeLabel, type DeviceType } from "./device-types";

/**
 * The Grid device palette's filter (#226, spec §Screens 2). Pure and
 * client-safe; device-palette.tsx renders what this returns.
 *
 * Favorites / Recent: the user's stored order, parts no longer in the
 * library skipped, the search applied. All: scope chip → type chips for
 * that scope → manufacturer → search. Without a search an unmapped part
 * (no device type; assemblies and allowances never count as unmapped) is
 * hidden and counted; with a search every part matches. Virtual parts and
 * Fabric/Labor rows are never placeable here (curtains arrive through the
 * curtain drop-in).
 */

export type PaletteTab = "favorites" | "recent" | "all";
export const PALETTE_ROW_CAP = 60;
export type PaletteQuery = { tab: PaletteTab; search: string; scope: GridLayer | ""; typeKey: string; mfr: string };
export type PaletteChip = { key: string; label: string; count: number };
export type PaletteView = {
  rows: PartLite[];
  hiddenUnmapped: number;
  scopeCounts: Record<string, number>;
  typeChips: PaletteChip[];
  manufacturers: string[];
};

// #264: a fabric (isFabricPart — incl. Soft Goods sold per sq ft) is never a device.
const placeable = (p: PartLite) => !p.virtual && !isFabricPart(p) && p.category !== "Labor";
const matches = (p: PartLite, q: string) => (p.desc + " " + (p.modelNumber || p.sku) + " " + (p.manufacturer || "")).toLowerCase().includes(q);
const byName = (a: PartLite, b: PartLite) => a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku);

export function isMapped(p: PartLite): boolean {
  return typeKeyOfPart(p) !== UNMAPPED_TYPE;
}

export function paletteView(
  parts: readonly PartLite[],
  query: PaletteQuery,
  types: readonly DeviceType[],
  favorites: readonly string[],
  recent: readonly string[]
): PaletteView {
  const base = parts.filter(placeable);
  const q = query.search.trim().toLowerCase();

  if (query.tab !== "all") {
    const byId = new Map(base.map((p) => [p.id, p]));
    const rows = (query.tab === "favorites" ? favorites : recent)
      .map((id) => byId.get(id))
      .filter((p): p is PartLite => !!p && (!q || matches(p, q)));
    return { rows, hiddenUnmapped: 0, scopeCounts: {}, typeChips: [], manufacturers: [] };
  }

  const visible = (p: PartLite) => (q ? matches(p, q) : isMapped(p));
  const scopeCounts: Record<string, number> = { "": 0 };
  for (const p of base) {
    if (!visible(p)) continue;
    const s = scopeOfPart(p);
    scopeCounts[s] = (scopeCounts[s] || 0) + 1;
    scopeCounts[""] += 1;
  }

  const inScope = query.scope ? base.filter((p) => scopeOfPart(p) === query.scope) : base;
  const typeCount = new Map<string, number>();
  if (query.scope) {
    for (const p of inScope) {
      if (!visible(p)) continue;
      const k = typeKeyOfPart(p);
      typeCount.set(k, (typeCount.get(k) || 0) + 1);
    }
  }
  const order = new Map(types.map((t, i) => [t.key, i]));
  const rank = (k: string) => (k === UNMAPPED_TYPE ? 3e6 : k === ALLOWANCE_TYPE ? 2e6 + 1 : k === ASSEMBLY_TYPE ? 2e6 : order.get(k) ?? 1e6);
  const typeChips = [...typeCount.entries()]
    .map(([key, count]) => ({ key, label: typeLabel(key, types), count }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));

  const inType = query.scope && query.typeKey ? inScope.filter((p) => typeKeyOfPart(p) === query.typeKey) : inScope;
  const manufacturers = [...new Set(inType.filter(visible).map((p) => (p.manufacturer || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const inMfr = query.mfr ? inType.filter((p) => (p.manufacturer || "").trim() === query.mfr) : inType;
  const rows = inMfr.filter(visible).sort(byName);
  const hiddenUnmapped = q ? 0 : inMfr.filter((p) => !isMapped(p)).length;
  return { rows, hiddenUnmapped, scopeCounts, typeChips, manufacturers };
}
