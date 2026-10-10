/**
 * Conduit riser (#321) — what the riser does to one option's BOM. The one
 * step both buildGridQuote (server, tier-priced parts) and the Grid editor's
 * live BOM (client) run, so the two can never disagree:
 *
 *  - wire inside a run whose wire pricing is off is "by others" — it leaves
 *    the priced wire lines and is listed, footage only, as "In conduit — by
 *    others" (never priced, never on the quote);
 *  - a run whose conduit is priced adds its conduit part by the foot (one
 *    line per part, rounded up once), under the BOM's Conduit heading;
 *  - anything that can't be priced is a refusal sentence — Add to Quotes
 *    refuses while any exist.
 *
 * An estimate-owned option (#314) prices nothing from the riser. Pure and
 * client-safe (the grid-bom rule).
 */

import { routeLengthFt, routeLines, type BomLine, type PartLite, type RouteLite } from "../grid-bom";
import { formatDesignator } from "../designators";
import type { Calibration } from "@/lib/annotations";
import type { ConduitRiserDoc, RunEnd } from "./model";
import { conduitDemand, wireByOthers, type ConduitSize } from "./pricing";

/** A conduit part's priced slice (a catalog row — tier-priced on the server). */
export type RiserBomPart = { desc: string; unit: string; list: number; cost: number };

/** One "In conduit — by others" row: a wire part's footage, never priced. */
export type ByOthersRow = { partId: string; desc: string; feet: number };

export type RiserBom<R, L> = {
  /** The routes and RiserLinks still priced as wire. */
  routes: R[];
  links: L[];
  /** routeLines over those — the BOM's wire lines. */
  wires: ReturnType<typeof routeLines>;
  byOthers: ByOthersRow[];
  /** Priced conduit, one line per part, qty = feet. */
  conduit: BomLine[];
  conduitValue: number;
  conduitCost: number;
  refusals: string[];
};

export function riserBom<R extends RouteLite, L extends { id: string; partId: string; lengthFt: number }>(input: {
  /** The option's conduit riser, normalized and pruned (liveConduitRiser); null = none. */
  doc: ConduitRiserDoc | null;
  estimateOwned: boolean;
  routes: readonly R[];
  links: readonly L[];
  cals: Calibration[];
  /** Wire parts, as routeLines prices them. */
  parts: PartLite[];
  /** Conduit parts by id — a size mapped to a part missing here counts as unmapped. */
  conduitParts: ReadonlyMap<string, RiserBomPart>;
  sizes: readonly ConduitSize[];
  /** The option's non-curtain device ids — a run to anything else prices nothing. */
  placementIds: ReadonlySet<string>;
  labelOf: (e: RunEnd) => string;
}): RiserBom<R, L> {
  const { doc, estimateOwned, cals, parts } = input;
  if (!doc || estimateOwned || !doc.runs.length) {
    const routes = [...input.routes];
    const links = [...input.links];
    return { routes, links, wires: routeLines(routes, parts, cals, links), byOthers: [], conduit: [], conduitValue: 0, conduitCost: 0, refusals: [] };
  }
  const off = wireByOthers(doc, false, input.placementIds);
  const routes = input.routes.filter((r) => !off.routeIds.has(r.id));
  const links = input.links.filter((l) => !off.linkIds.has(l.id));
  const offRoutes = input.routes.filter((r) => off.routeIds.has(r.id));
  const offLinks = input.links.filter((l) => off.linkIds.has(l.id));
  const byOthers = routeLines(offRoutes, parts, cals, offLinks).lines.map((l) => ({ partId: l.partId, desc: l.desc, feet: l.qty }));

  // The riser's own measure (riserWires): a route's calibrated length, a link's typed one.
  const wires = [
    ...input.routes.map((r) => ({ kind: "route" as const, id: r.id, lengthFt: routeLengthFt(r, cals) })),
    ...input.links.map((l) => ({ kind: "link" as const, id: l.id, lengthFt: l.lengthFt > 0 && Number.isFinite(l.lengthFt) ? l.lengthFt : null })),
  ];
  // A size mapped to a part that has left the catalog prices like an unmapped one.
  const sizes = input.sizes.map((s) => (s.partId && !input.conduitParts.has(s.partId) ? { size: s.size } : s));
  const demand = conduitDemand({ doc, estimateOwned: false, wires, sizes, labelOf: input.labelOf, placementIds: input.placementIds });
  let conduitValue = 0;
  let conduitCost = 0;
  const conduit: BomLine[] = demand.lines.map((d) => {
    const part = input.conduitParts.get(d.partId)!;
    const ext = d.feet * part.list;
    conduitValue += ext;
    conduitCost += d.feet * part.cost;
    return { partId: d.partId, desc: part.desc, unit: part.unit, qty: d.feet, list: part.list, ext };
  });
  return { routes, links, wires: routeLines(routes, parts, cals, links), byOthers, conduit, conduitValue, conduitCost, refusals: demand.refusals };
}

/**
 * A run end as the riser prints it: a stub's label; a device's designator
 * (a lot's range, #320), else its part's description.
 */
export function riserEndLabeler(
  doc: Pick<ConduitRiserDoc, "stubs">,
  placements: ReadonlyArray<{ id: string; partId: string; designator?: string | null; qty?: number | null }>,
  descOf: (partId: string) => string | undefined,
  digits: 1 | 2
): (e: RunEnd) => string {
  const byId = new Map(placements.map((pl) => [pl.id, pl]));
  return (e) => {
    if (e.kind === "stub") return doc.stubs.find((s) => s.id === e.stubId)?.label || "a stub";
    const pl = byId.get(e.placementId);
    if (!pl) return "a device";
    return formatDesignator(pl.designator, pl.qty, digits) || descOf(pl.partId) || pl.partId;
  };
}
