import type { Calibration } from "@/lib/annotations";
import { spaceOf, type SpaceLite } from "./grid-geometry";
import { PLACEMENT_QTY_MAX, placementQty, routeLengthFt, type PartLite, type RouteLite } from "./grid-bom";

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

/** `qty` counts UNITS (a lot marker adds its qty). `lot` = at least one of
 *  the row's markers is a lot (#211) — the row editor then edits the lot's
 *  quantity rather than adding/removing markers, up to PLACEMENT_QTY_MAX. */
export type RiserGroup = { partId: string; desc: string; qty: number; category: string; shape: string | null; lot?: true };

/**
 * A riser row's qty edit (#211 fix wave 1, I1 / D311), pure. `devices`
 * are the row's markers OLDEST first; `target` is the new unit count.
 *  - No lot marker in the row: one marker per unit, as before — add
 *    `target − units` markers, or remove the newest ones.
 *  - A row with a lot marker never gains markers: an increase goes onto the
 *    NEWEST lot marker; a decrease shrinks lot markers newest-first (a lot
 *    never below 1 unit) and only then removes the newest markers.
 * `set` = marker id → its new unit count (1 = drop the lot qty). null when
 * the edit would push a lot past PLACEMENT_QTY_MAX.
 */
export function planRowQty(
  devices: ReadonlyArray<{ id: string; qty?: number | null }>,
  target: number
): { set: Map<string, number>; remove: string[]; add: number } | null {
  const set = new Map<string, number>();
  const units = devices.reduce((a, d) => a + placementQty(d), 0);
  const lots = devices.filter((d) => placementQty(d) > 1);
  if (!lots.length) {
    if (target >= units) return { set, remove: [], add: target - units };
    return { set, remove: devices.slice(target).map((d) => d.id), add: 0 };
  }
  if (target >= units) {
    const newest = lots[lots.length - 1];
    const next = placementQty(newest) + (target - units);
    if (next > PLACEMENT_QTY_MAX) return null;
    if (target > units) set.set(newest.id, next);
    return { set, remove: [], add: 0 };
  }
  let excess = units - target;
  for (let i = lots.length - 1; i >= 0 && excess > 0; i--) {
    const q = placementQty(lots[i]);
    const take = Math.min(excess, q - 1);
    set.set(lots[i].id, q - take);
    excess -= take;
  }
  // Every lot is down to one unit: the rest come off as whole markers, newest first.
  const remove = excess > 0 ? devices.slice(devices.length - excess).map((d) => d.id) : [];
  for (const id of remove) set.delete(id);
  return { set, remove, add: 0 };
}

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
  placements: Array<{
    sheetId: string;
    page: number;
    x: number;
    y: number;
    partId: string;
    /** User-defined placement category (punch #48) — the plan's own
     *  fallback for a seeded-but-unassigned placement with no linked part
     *  (#38); the riser now reads it the same way (final fix wave #3). */
    category?: string | null;
    /** Curtain drop-ins (punch #49) are goods, not signal devices - they have
     *  no ports and terminate no wire, so they are left off the one-line. */
    curtain?: unknown;
    qty?: number;
  }>,
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
    if (pl.curtain) continue; // goods, not a signal device
    const home = spaceOf(pl, spaces);
    const node = nodeById.get(home ? home.id : null)!;
    const part = partById.get(pl.partId);
    const g = node.groups.find((x) => x.partId === pl.partId);
    if (g) {
      g.qty += placementQty(pl);
      if (placementQty(pl) > 1) g.lot = true;
    } else {
      // No linked part (a seeded-but-unassigned placement, #38): fall back
      // to the placement's own category, the same as the plan does
      // (editor.tsx symbolLook({ category: pl.category }, …)).
      const category = part?.category || pl.category || "";
      node.groups.push({
        partId: pl.partId,
        desc: part?.desc || pl.partId,
        qty: placementQty(pl),
        category,
        shape: part?.shape ?? null,
        ...(placementQty(pl) > 1 ? { lot: true as const } : {}),
      });
    }
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
