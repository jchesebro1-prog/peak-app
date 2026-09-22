import type { CatalogPart } from "@/lib/stores/catalog";
import type { FixtureOptionCategory } from "@/lib/stores/subassemblies";
import { effectivePriceDate, type PriceDateSettings } from "./catalog-books";

export const ASSEMBLY_ROLES = [
  "fixture", "lens", "mount", "accessory", "cable", "power", "data", "lamp", "other",
] as const;
export type AssemblyRole = (typeof ASSEMBLY_ROLES)[number];

export type FixtureAssemblyComponent = {
  sku: string;
  /** User-facing label used in the Estimator/BOM, independent of vendor copy. */
  label: string;
  role: AssemblyRole;
  /** Zero keeps the component available but does not add it by default. */
  defaultQty: number;
};

export type FixtureAssembly = {
  id: string;
  name: string;
  components: FixtureAssemblyComponent[];
};

export type ResolvedAssemblyComponent = FixtureAssemblyComponent & {
  desc: string;
  unit: string;
  cost: number;
  list: number;
  found: boolean;
};
export type ResolvedFixtureAssembly = Omit<FixtureAssembly, "components"> & {
  components: ResolvedAssemblyComponent[];
};

export function sanitizeFixtureAssemblies(value: unknown): FixtureAssembly[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): FixtureAssembly[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Partial<FixtureAssembly>;
    const id = String(item.id || "").trim().slice(0, 80);
    const name = String(item.name || "").trim().slice(0, 160);
    if (!id || !name || !Array.isArray(item.components)) return [];
    const components = item.components.flatMap((part): FixtureAssemblyComponent[] => {
      if (!part || typeof part !== "object") return [];
      const p = part as Partial<FixtureAssemblyComponent>;
      const sku = String(p.sku || "").trim().slice(0, 160);
      if (!sku) return [];
      const role = ASSEMBLY_ROLES.includes(p.role as AssemblyRole) ? p.role as AssemblyRole : "other";
      const qty = Number(p.defaultQty);
      return [{
        sku,
        label: String(p.label || sku).trim().slice(0, 160) || sku,
        role,
        defaultQty: Number.isFinite(qty) ? Math.max(0, Math.round(qty * 100) / 100) : 0,
      }];
    });
    return components.length ? [{ id, name, components }] : [];
  });
}

export function resolveFixtureAssemblies(
  stored: unknown,
  catalog: Array<Pick<CatalogPart, "sku" | "desc" | "unit" | "cost" | "list">>
): ResolvedFixtureAssembly[] {
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  return sanitizeFixtureAssemblies(stored).map((assembly) => ({
    ...assembly,
    components: assembly.components.map((component) => {
      const part = bySku.get(component.sku);
      return {
        ...component,
        desc: part?.desc || "Catalog part not found",
        unit: part?.unit || "ea",
        cost: Number(part?.cost) || 0,
        list: Number(part?.list) || 0,
        found: !!part,
      };
    }),
  }));
}

export function assemblyUnitTotals(assembly: ResolvedFixtureAssembly): { cost: number; sell: number } {
  return assembly.components.reduce(
    (totals, component) => ({
      cost: totals.cost + component.cost * component.defaultQty,
      sell: totals.sell + component.list * component.defaultQty,
    }),
    { cost: 0, sell: 0 }
  );
}

export function assemblyDescription(assembly: ResolvedFixtureAssembly): string {
  const included = assembly.components
    .filter((component) => component.defaultQty > 0)
    .map((component) => component.defaultQty === 1 ? component.label : `${component.label} ×${component.defaultQty}`);
  return included.length ? `${assembly.name} — ${included.join("; ")}` : assembly.name;
}

/* ---- #129 — subassemblies resolve live, like assemblies ------------------ */

export const FIXTURE_OPTION_CATEGORIES: readonly FixtureOptionCategory[] = ["data", "power", "mounting", "accessories"];

/** "Prices as of": the NEWEST effective price date among the given SKUs
 *  (own pricedAt or the manufacturer's book date), null when none is dated. */
export function pricesAsOf(
  skus: string[],
  catalog: Array<{ sku: string; mfr?: string; pricedAt?: number }>,
  settings: PriceDateSettings = {}
): number | null {
  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  let newest: number | null = null;
  for (const sku of skus) {
    const part = bySku.get(sku);
    if (!part) continue;
    const at = effectivePriceDate(part, settings);
    if (at != null && (newest == null || at > newest)) newest = at;
  }
  return newest;
}

export type SubassemblyInput = {
  lightEngineSku: string;
  lensSku: string;
  /** Categories may be absent on older records and on the builder's draft. */
  options?: Partial<Record<FixtureOptionCategory, Array<{ sku: string; qty: number }>>>;
};

export type ResolvedSubassemblyPart = { sku: string; name: string; cost: number; found: boolean };
export type ResolvedSubassemblyOption = ResolvedSubassemblyPart & { qty: number };

export type ResolvedSubassembly = {
  lightEngine: ResolvedSubassemblyPart;
  lens: ResolvedSubassemblyPart;
  options: Record<FixtureOptionCategory, ResolvedSubassemblyOption[]>;
  optionsCost: number;
  cost: number;
  /** Equals cost — the legacy save-time formula priced fixtures at cost. */
  price: number;
  /** SKUs no longer in the catalog (priced at 0 above). */
  missing: string[];
  pricesAsOf: number | null;
};

/**
 * Price a fixture subassembly from the CURRENT catalog — exactly the formula
 * saveFixtureAction used to freeze at save time (engine cost + lens cost +
 * Σ option cost × qty), so a price-list import re-prices every fixture at
 * once. The saved record keeps its build-time numbers as `snapshot`.
 */
export function resolveSubassembly(
  sub: SubassemblyInput,
  catalog: Array<Pick<CatalogPart, "sku" | "desc" | "cost"> & { mfr?: string; pricedAt?: number }>,
  settings: PriceDateSettings = {}
): ResolvedSubassembly {
  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  const missing: string[] = [];
  const partOf = (sku: string): ResolvedSubassemblyPart => {
    const p = bySku.get(sku);
    if (!p) {
      if (sku) missing.push(sku);
      return { sku, name: sku || "—", cost: 0, found: false };
    }
    return { sku: p.sku, name: p.desc, cost: Number(p.cost) || 0, found: true };
  };
  const lightEngine = partOf(sub.lightEngineSku);
  const lens = partOf(sub.lensSku);
  const options = { data: [], power: [], mounting: [], accessories: [] } as Record<FixtureOptionCategory, ResolvedSubassemblyOption[]>;
  let optionsCost = 0;
  const skus = [sub.lightEngineSku, sub.lensSku];
  for (const category of FIXTURE_OPTION_CATEGORIES) {
    for (const o of sub.options?.[category] || []) {
      const qty = Math.max(1, Math.round(Number(o.qty) || 1));
      const part = partOf(o.sku);
      options[category].push({ ...part, qty });
      optionsCost += part.cost * qty;
      skus.push(o.sku);
    }
  }
  const cost = lightEngine.cost + lens.cost + optionsCost;
  return { lightEngine, lens, options, optionsCost, cost, price: cost, missing, pricesAsOf: pricesAsOf(skus, catalog, settings) };
}
