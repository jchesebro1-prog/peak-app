import { assemblyDescription, type ResolvedFixtureAssembly } from "@/lib/fixture-assemblies";
import type { FixtureDraft, SpecItem } from "./types";

/** The fixture configurator's BOM line (#210) — moved out of
 *  estimator-client.tsx unchanged so it is testable: included components at
 *  the draft's quantities, aggregate unit cost/sell, "Name — part; part"
 *  plus "(Pos … / Ckt …)". Pure. */
export type FixtureBomLine = {
  desc: string;
  cost: number;
  price: number;
  components: NonNullable<SpecItem["components"]>;
};

/** An optional (default qty 0) add-on's switch: on = qty 1, off = 0. */
export function optionalToggleQty(on: boolean): string {
  return on ? "1" : "0";
}

/** A component row at the draft's quantity (falling back to its default). Pure. */
function componentQtyOf(componentQty: Record<string, string>, sku: string, fallback: number): number {
  return Math.max(0, Number(componentQty[sku] ?? fallback) || 0);
}

/** The included components (qty > 0) and their aggregate unit cost/sell — the
 *  same math the fixture modal's header totals and `fixtureBomLine` both need.
 *  Shared so neither keeps its own copy of the qty/cost/sell formula. Pure. */
export function assemblyComponentTotals(
  assembly: ResolvedFixtureAssembly,
  componentQty: Record<string, string>
): { cost: number; price: number; components: NonNullable<SpecItem["components"]> } {
  const components = assembly.components.map((part) => ({
    sku: part.sku,
    label: part.label,
    role: part.role,
    qty: componentQtyOf(componentQty, part.sku, part.defaultQty),
    unit: part.unit,
    cost: part.cost,
    price: part.list,
  }));
  const included = components.filter((part) => part.qty > 0);
  const cost = included.reduce((sum, part) => sum + part.cost * part.qty, 0);
  const price = included.reduce((sum, part) => sum + part.price * part.qty, 0);
  return { cost, price, components };
}

export function fixtureBomLine(
  assembly: ResolvedFixtureAssembly,
  d: Pick<FixtureDraft, "componentQty" | "position" | "circuit">
): FixtureBomLine | null {
  const { cost, price, components } = assemblyComponentTotals(assembly, d.componentQty);
  if (price <= 0) return null;
  const pc: string[] = [];
  if ((d.position || "").trim()) pc.push("Pos " + d.position.trim());
  if ((d.circuit || "").trim()) pc.push("Ckt " + d.circuit.trim());
  let desc = assemblyDescription({
    ...assembly,
    components: assembly.components.map((part) => ({
      ...part,
      defaultQty: componentQtyOf(d.componentQty, part.sku, part.defaultQty),
    })),
  });
  if (pc.length) desc += " (" + pc.join(" / ") + ")";
  return { desc, cost, price, components };
}
