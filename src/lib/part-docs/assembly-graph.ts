import type { FixtureAssembly } from "@/lib/fixture-assemblies";
import type { FixtureSubassembly } from "@/lib/stores/subassemblies";
import { ownFiles, slotCoverage, type CoverageIndex, type SlotState } from "./coverage";
import type { AccessoryPair } from "./types";

/**
 * Assembly Builder ↔ accessory graph (#207, spec §3). Pure — the builders'
 * client components import it. Each assembly's light engine is the parent;
 * its lens and every option/accessory part are the parent's accessory links.
 * The two builders keep separate sourceRef namespaces so a save of one never
 * prunes the other's links.
 */

export const ASSEMBLY_REF_PREFIX = "assembly:";
export const SUBASSEMBLY_REF_PREFIX = "subassembly:";
export const assemblyRef = (id: string) => `${ASSEMBLY_REF_PREFIX}${id}`;
export const subassemblyRef = (id: string) => `${SUBASSEMBLY_REF_PREFIX}${id}`;

/** The fixture (light engine) of an Assemblies-tab assembly, if it has one. */
export function fixtureParentSku(a: Pick<FixtureAssembly, "components">): string | null {
  return a.components.find((c) => c.role === "fixture")?.sku || null;
}

/** Every non-fixture component is an accessory of the fixture. A default
 *  quantity above zero means it ships with the fixture ("included"). */
export function fixtureAssemblyPairs(a: Pick<FixtureAssembly, "components">): AccessoryPair[] {
  const parentSku = fixtureParentSku(a);
  if (!parentSku) return [];
  return a.components
    .filter((c) => c.role !== "fixture" && c.sku !== parentSku)
    .map((c) => ({ parentSku, accessorySku: c.sku, ...(c.defaultQty > 0 ? { maxQty: c.defaultQty, included: true } : {}) }));
}

/** A subassembly's lens and data/power/mounting/accessory options. */
export function subassemblyPairs(s: Pick<FixtureSubassembly, "lightEngineSku" | "lensSku" | "options">): AccessoryPair[] {
  const parentSku = s.lightEngineSku;
  if (!parentSku) return [];
  const out: AccessoryPair[] = [];
  if (s.lensSku) out.push({ parentSku, accessorySku: s.lensSku, maxQty: 1, included: true });
  for (const list of Object.values(s.options || {})) {
    for (const o of list || []) if (o?.sku) out.push({ parentSku, accessorySku: o.sku, maxQty: Math.max(1, o.qty || 1), included: true });
  }
  return out.filter((p) => p.accessorySku !== parentSku);
}

export type MemberCoverage = {
  /** The pair is in the stored graph (an unsaved member is not yet). */
  linked: boolean;
  /** "Has its own datasheet" is set on the pair. */
  own: boolean;
  parentHasDatasheet: boolean;
  /** The member's datasheet slot, no context. */
  state: SlotState;
};

/** Stable key for one parent → accessory pair in a props record. */
export function pairKey(parentSku: string, accessorySku: string): string {
  return `${parentSku}\u0001${accessorySku}`;
}

export function memberCoverageFor(index: CoverageIndex, pairs: readonly AccessoryPair[]): Record<string, MemberCoverage> {
  const out: Record<string, MemberCoverage> = {};
  for (const p of pairs) {
    const link = index.parentsOf.get(p.accessorySku)?.find((x) => x.parentSku === p.parentSku);
    out[pairKey(p.parentSku, p.accessorySku)] = {
      linked: !!link,
      own: !!link?.ownDatasheet,
      parentHasDatasheet: ownFiles(index, p.parentSku, "datasheet").length > 0,
      state: slotCoverage(index, p.accessorySku, "datasheet").state,
    };
  }
  return out;
}

export function memberCoverageLabel(c: MemberCoverage | undefined): string {
  if (!c || !c.linked) return "Save to link it to the fixture";
  if (c.own) return c.state === "own" ? "Has its own datasheet" : "Has its own datasheet — none attached yet";
  if (c.state === "own") return "Own datasheet attached";
  if (c.parentHasDatasheet) return "Covered by fixture datasheet";
  return "Fixture has no datasheet yet";
}
