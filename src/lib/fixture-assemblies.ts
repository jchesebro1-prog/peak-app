import type { CatalogPart } from "@/lib/stores/catalog";

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
