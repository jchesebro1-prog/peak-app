import { assemblyDescription, type ResolvedFixtureAssembly } from "@/lib/fixture-assemblies";
import type { FixtureDraft, SpecItem, SpecSection } from "./types";

/** The assembly configurator's BOM line (#210) — moved out of
 *  estimator-client.tsx unchanged so it is testable: included components at
 *  the draft's quantities, aggregate unit cost/sell, "Name — part; part"
 *  plus "(Pos … / Ckt …)" — a fixture's only (#246: a system or hardware
 *  assembly has no hang position / circuit, so a stale draft value is
 *  ignored). Pure. */
export type FixtureBomLine = {
  desc: string;
  cost: number;
  price: number;
  components: NonNullable<SpecItem["components"]>;
  /** #296 (D578) — set when the assembly is a rack. */
  rackId?: string;
};

/** #246 — only a fixture has a hang position / circuit. An assembly with no
 *  `kind` (a legacy row) is a fixture. */
export function hasHangPosition(assembly: Pick<ResolvedFixtureAssembly, "kind">): boolean {
  return (assembly.kind ?? "fixture") === "fixture";
}

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
  if (hasHangPosition(assembly) && (d.position || "").trim()) pc.push("Pos " + d.position.trim());
  if (hasHangPosition(assembly) && (d.circuit || "").trim()) pc.push("Ckt " + d.circuit.trim());
  let desc = assemblyDescription({
    ...assembly,
    components: assembly.components.map((part) => ({
      ...part,
      defaultQty: componentQtyOf(d.componentQty, part.sku, part.defaultQty),
    })),
  });
  if (pc.length) desc += " (" + pc.join(" / ") + ")";
  return { desc, cost, price, components, ...(assembly.kind === "rack" ? { rackId: assembly.id } : {}) };
}

/** Edit assembly — a line added through "+ Add assembly" (a fixture, system,
 *  hardware or rack assembly) reopens that configurator, as track / curtain /
 *  labor lines reopen theirs. A portal fixture line (`fixtureId`: its sku is
 *  the light engine's, not an assembly id) and a price request (`por`) don't. */
export function isAssemblyLineEditable(it: Pick<SpecItem, "fixture" | "fixtureId" | "por">): boolean {
  return !!it.fixture && !it.fixtureId && !it.por;
}

/** The "(Pos … / Ckt …)" suffix fixtureBomLine writes, read back off a stored
 *  description — the line keeps no other copy of the hang position / circuit.
 *  Blank when the description has no such suffix. Pure. */
export function hangFromDesc(desc: string): { position: string; circuit: string } {
  const out = { position: "", circuit: "" };
  const m = /\s\(([^()]*)\)$/.exec(desc || "");
  if (!m) return out;
  const parts = m[1].split(" / ");
  if (!parts.every((part) => part.startsWith("Pos ") || part.startsWith("Ckt "))) return out;
  for (const part of parts) {
    if (part.startsWith("Pos ")) out.position = part.slice(4);
    else out.circuit = part.slice(4);
  }
  return out;
}

/** The configurator's draft, filled from a stored assembly line: its quantity,
 *  each component at the quantity quoted (a part added to the assembly since
 *  the line was built starts at 0 — Update never adds a part silently) and
 *  its hang position / circuit. Pure. */
export function fixtureDraftFromLine(
  it: Pick<SpecItem, "qty" | "desc" | "components">,
  assembly: ResolvedFixtureAssembly
): FixtureDraft {
  const quoted = new Map((it.components || []).map((part) => [part.sku, part.qty]));
  const hang = hasHangPosition(assembly) ? hangFromDesc(it.desc) : { position: "", circuit: "" };
  return {
    assemblyId: assembly.id,
    qty: String(Math.max(1, it.qty || 1)),
    componentQty: Object.fromEntries(assembly.components.map((part) => [part.sku, String(quoted.get(part.sku) ?? 0)])),
    position: hang.position,
    circuit: hang.circuit,
  };
}

/** Update assembly: the line `lineId` replaced IN PLACE by `item` (re-priced
 *  from today's catalog, like Update track). Kept from the old line: id,
 *  lineOrder, customer comment, internal note, optional flag, spec key. A line
 *  no longer there is appended instead. Pure. */
export function replaceAssemblyLine(sec: SpecSection, lineId: number, item: Omit<SpecItem, "id">): SpecSection {
  const at = sec.items.findIndex((it) => it.id === lineId);
  if (at < 0) return { ...sec, items: [...sec.items, { ...item, id: lineId }] };
  const old = sec.items[at];
  const next: SpecItem = { ...item, id: old.id };
  if (typeof old.lineOrder === "number") next.lineOrder = old.lineOrder;
  if (old.comment) next.comment = old.comment;
  if (old.internalNote) next.internalNote = old.internalNote;
  if (old.option) next.option = old.option;
  if (old.specKey) next.specKey = old.specKey;
  const items = sec.items.slice();
  items[at] = next;
  return { ...sec, items };
}
