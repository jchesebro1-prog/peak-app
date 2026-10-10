/**
 * Conduit riser (#321) — pricing. Both design defaults start OFF; a run can
 * override either one. Wire inside a run whose wire pricing is off is "by
 * others": the caller drops it from routeLines and lists it in the BOM's
 * "In conduit — by others" group. Priced conduit is per-foot catalog parts
 * mapped by size (Estimating Rules → Conduit sizes), footage summed per part
 * and rounded up once. An estimate-owned option (#314) prices nothing here.
 * Pure.
 */

import type { ConduitRiserDefaults, ConduitRiserDoc, ConduitRun, RunEnd } from "./model";
import type { CRWire } from "./input";

export type ConduitSize = { size: string; partId?: string };

export function effectivePricing(run: ConduitRun, defaults: ConduitRiserDefaults): { wire: boolean; conduit: boolean } {
  return { wire: run.priceWire ?? defaults.priceWire, conduit: run.priceConduit ?? defaults.priceConduit };
}

/** A run whose device ends still exist (callers normally pass a pruned doc;
 *  this keeps an unpruned one from pricing a ghost). */
const runLive = (r: ConduitRun, placementIds?: ReadonlySet<string>) =>
  !placementIds || [r.a, r.b].every((e) => e.kind === "stub" || placementIds.has(e.placementId));

/** Wire ids (routes and links) that are by others — excluded from priced footage. */
export function wireByOthers(
  doc: ConduitRiserDoc,
  estimateOwned: boolean,
  placementIds?: ReadonlySet<string>
): { routeIds: Set<string>; linkIds: Set<string> } {
  const routeIds = new Set<string>();
  const linkIds = new Set<string>();
  if (estimateOwned) return { routeIds, linkIds };
  for (const r of doc.runs) {
    if (!runLive(r, placementIds) || effectivePricing(r, doc.defaults).wire) continue;
    r.routeIds.forEach((id) => routeIds.add(id));
    r.linkIds.forEach((id) => linkIds.add(id));
  }
  return { routeIds, linkIds };
}

/** A run's conduit length: typed, else its longest member wire; null = unknown. */
export function conduitLengthFt(run: ConduitRun, wireByKey: ReadonlyMap<string, Pick<CRWire, "lengthFt">>): number | null {
  if (run.lengthFt && run.lengthFt > 0) return run.lengthFt;
  let best: number | null = null;
  for (const key of [...run.routeIds.map((id) => `route:${id}`), ...run.linkIds.map((id) => `link:${id}`)]) {
    const ft = wireByKey.get(key)?.lengthFt;
    if (ft !== null && ft !== undefined && ft > 0 && (best === null || ft > best)) best = ft;
  }
  return best;
}

export type ConduitDemand = {
  /** One line per conduit part: feet rounded up once. */
  lines: { partId: string; size: string; feet: number }[];
  /** Plain sentences — Add to Quotes refuses while any exist. */
  refusals: string[];
};

export function conduitDemand(input: {
  doc: ConduitRiserDoc;
  estimateOwned: boolean;
  /** Only a wire's kind, id and length are read (bom.ts builds these from plain routes and links). */
  wires: readonly Pick<CRWire, "id" | "kind" | "lengthFt">[];
  sizes: readonly ConduitSize[];
  labelOf: (e: RunEnd) => string;
  placementIds?: ReadonlySet<string>;
}): ConduitDemand {
  if (input.estimateOwned) return { lines: [], refusals: [] };
  const wireByKey = new Map(input.wires.map((w) => [`${w.kind}:${w.id}`, w]));
  const partBySize = new Map(input.sizes.filter((s) => s.partId).map((s) => [s.size, s.partId!]));
  const feet = new Map<string, { size: string; ft: number }>();
  const unmapped = new Set<string>();
  const refusals: string[] = [];
  for (const run of input.doc.runs) {
    // Cable management is provided by others — never conduit on our quote.
    if (run.style === "cableMgmt" || !runLive(run, input.placementIds) || !effectivePricing(run, input.doc.defaults).conduit) continue;
    const partId = partBySize.get(run.size);
    if (!partId) {
      unmapped.add(run.size);
      continue;
    }
    const ft = conduitLengthFt(run, wireByKey);
    if (ft === null) {
      refusals.push(`${input.labelOf(run.a)} → ${input.labelOf(run.b)} needs a length`);
      continue;
    }
    const cur = feet.get(partId) || { size: run.size, ft: 0 };
    cur.ft += ft;
    feet.set(partId, cur);
  }
  const sizeRefusals = [...unmapped].sort().map((size) => `Conduit ${size} has no part — set it in Estimating Rules → Conduit sizes`);
  const lines = [...feet.entries()]
    .map(([partId, v]) => ({ partId, size: v.size, feet: Math.ceil(v.ft - 1e-9) }))
    .sort((a, b) => a.partId.localeCompare(b.partId));
  return { lines, refusals: [...sizeRefusals, ...refusals] };
}
