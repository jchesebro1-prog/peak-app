import type { Calibration } from "@/lib/annotations";
import { spaceOf, type SpaceLite } from "./grid-geometry";
import { routeLengthFt, type PartLite, type RouteLite } from "./grid-bom";

/* ------------------------------------------------------------------ *
 * The Grid — riser sketch derivation (D112). Pure and dependency-free
 * like its siblings: the one-line diagram is DERIVED, never drawn.
 *
 * DaVinci builds its riser from an explicit device+route graph with a
 * full auto-layout engine. This v1 deliberately works from what the
 * plan already knows: devices belong to spaces (smallest-wins), and a
 * wire run connects the space its first waypoint sits in to the space
 * its last waypoint sits in. Devices and endpoints outside every space
 * share one "Unassigned" node, so nothing silently disappears.
 * ------------------------------------------------------------------ */

export type RiserGroup = { partId: string; desc: string; qty: number };

export type RiserNode = {
  /** null = the Unassigned node. */
  spaceId: string | null;
  name: string;
  color: string;
  groups: RiserGroup[];
};

export type RiserEdge = {
  routeId: string;
  partId: string;
  /** null endpoints mean the Unassigned node. */
  fromSpaceId: string | null;
  fromName: string;
  toSpaceId: string | null;
  toName: string;
  /** Measured length, or null when the page's calibration is gone. */
  lengthFt: number | null;
  unit: string;
};

export type RiserGraph = { nodes: RiserNode[]; edges: RiserEdge[] };

const UNASSIGNED = "Unassigned";

/**
 * Derive the one-line graph. Node order = space order (the drawing order,
 * which is the room order the designer thinks in) + Unassigned last, and
 * only nodes that hold devices or terminate a wire appear.
 */
export function riserGraph(
  placements: Array<{ sheetId: string; page: number; x: number; y: number; partId: string }>,
  routes: RouteLite[],
  spaces: Array<SpaceLite & { name: string; color?: string }>,
  parts: PartLite[],
  cals: Calibration[]
): RiserGraph {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const nodeById = new Map<string | null, RiserNode>();
  for (const s of spaces) {
    nodeById.set(s.id, { spaceId: s.id, name: s.name, color: s.color || "#8a6d3b", groups: [] });
  }
  const unassigned: RiserNode = { spaceId: null, name: UNASSIGNED, color: "#9aa0ab", groups: [] };
  nodeById.set(null, unassigned);

  // Devices → grouped part counts per node.
  for (const pl of placements) {
    const home = spaceOf(pl, spaces);
    const node = nodeById.get(home ? home.id : null)!;
    const part = partById.get(pl.partId);
    const g = node.groups.find((x) => x.partId === pl.partId);
    if (g) g.qty += 1;
    else node.groups.push({ partId: pl.partId, desc: part?.desc || pl.partId, qty: 1 });
  }

  // Wires → edges between the spaces their endpoints land in.
  const touched = new Set<string | null>();
  const edges: RiserEdge[] = [];
  for (const r of routes) {
    if (r.points.length < 2) continue;
    const a = r.points[0];
    const b = r.points[r.points.length - 1];
    const from = spaceOf({ sheetId: r.sheetId, page: r.page, x: a.x, y: a.y }, spaces);
    const to = spaceOf({ sheetId: r.sheetId, page: r.page, x: b.x, y: b.y }, spaces);
    const cal = cals.find((c) => c.docId === r.sheetId && c.page === r.page) || null;
    edges.push({
      routeId: r.id,
      partId: r.partId,
      fromSpaceId: from ? from.id : null,
      fromName: from ? from.name : UNASSIGNED,
      toSpaceId: to ? to.id : null,
      toName: to ? to.name : UNASSIGNED,
      lengthFt: routeLengthFt(r, cals),
      unit: cal?.unit || "ft",
    });
    touched.add(from ? from.id : null);
    touched.add(to ? to.id : null);
  }

  const nodes = [...nodeById.values()].filter(
    (n) => n.groups.length > 0 || touched.has(n.spaceId)
  );
  return { nodes, edges };
}
