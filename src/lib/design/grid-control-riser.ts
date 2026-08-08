/**
 * Control Riser — lighting/rigging CIRCUITING, derived from Grid instances
 * (punch #41).
 *
 * WHY THIS IS NOT grid-riser.ts. `riserGraph` (grid-riser.ts) is the AV
 * signal one-line: it groups devices BY SPACE and draws a wire run as a
 * connection between rooms — "what talks to what, and where". A control
 * riser answers a different question that a lighting/rigging package is
 * bid and installed against: WHICH CIRCUIT FEEDS WHAT — which dimmer/relay
 * circuit, which DMX universe, which motor-power run. Rooms are irrelevant
 * to it; connection type is everything. So the nodes here are CIRCUITS, not
 * spaces. Same `{ nodes, edges }` shape as `RiserGraph` for API consistency,
 * different grouping key.
 *
 * WHY THIS IS NOT quick/engine.ts's `buildRiser`. That one also calls itself
 * a control riser (the Quick estimator's "Control riser" tab), but it is the
 * PARAMETRIC path: it invents "Dimmer / Relay Racks ×N" from venue size and
 * system toggles. This module is the Grid-instance answer to the same
 * question — every node here exists because a real catalog device with real
 * declared ports was painted on a real plan. Nothing is assumed.
 *
 * A DEVICE APPEARS UNDER EVERY CIRCUIT IT TOUCHES. A moving light with a
 * powerCON inlet and a DMX inlet is one fixture but two home runs, and it is
 * listed under both nodes. That is the point of the drawing, not a bug — so
 * the node device counts deliberately do NOT sum to the device count, and
 * the page says so.
 *
 * SCOPE. Lighting and Rigging only. Audio/video devices are the AV riser's
 * job and are reported as skipped rather than mixed in. Curtains (fabric
 * drop-ins) have no ports and no circuit; a MOTORIZED track resolves to the
 * Rigging scope through its trade and does land here, which is correct — its
 * motor power is control circuiting.
 *
 * Pure and dependency-free like its grid-* siblings.
 */
import type { Port } from "@/lib/catalog-connect";
import { scopeOfPlacement, type ScopedPartLite } from "./grid-scopes";

/**
 * Which connection types are CONTROL circuiting, and what family each belongs
 * to. Sourced from `CONNECTION_TYPES` (catalog-connect.ts) — its own comments
 * already group the taxonomy this way; this table makes that grouping
 * machine-readable without changing the registry.
 *
 * Audio and video connection types are deliberately absent: they are signal,
 * not control, and belong on the AV riser.
 */
export const CONTROL_FAMILIES = ["power", "lighting data", "rigging"] as const;
export type ControlFamily = (typeof CONTROL_FAMILIES)[number] | "other";

const FAMILY_OF: Record<string, ControlFamily> = {
  // power
  "powerCON/True1": "power",
  Edison: "power",
  "stage pin": "power",
  Socapex: "power",
  "bare-end": "power",
  // lighting data
  "DMX512 (5-pin XLR)": "lighting data",
  "sACN/Art-Net (etherCON/Cat6)": "lighting data",
  RDM: "lighting data",
  "contact closure": "lighting data",
  // rigging
  "motor power": "rigging",
  "low-voltage pendant control": "rigging",
};

/** Fixed swatch per family — a family is a fixed vocabulary, like a scope. */
export const FAMILY_COLORS: Record<ControlFamily, string> = {
  power: "#c98a2b",
  "lighting data": "#e08b1f",
  rigging: "#6b4fa1",
  other: "#8c919c",
};

/**
 * Is this a control circuit at all? An UNRECOGNISED connection type declared
 * by a lighting/rigging device is family "other" and still gets a node — a
 * connector the taxonomy hasn't caught up with must be visible, not dropped
 * (the same rule that makes `Unscoped` a real, listed layer). Audio/video
 * types are the only ones excluded, and they are excluded by their device's
 * scope long before they reach here.
 */
function familyOf(connectionType: string): ControlFamily {
  return FAMILY_OF[connectionType] || "other";
}

export type ControlRiserDevice = { partId: string; desc: string; qty: number };

export type ControlRiserNode = {
  /** The circuit this node IS. Never null — a device with no circuit is
   *  reported in `skipped`, not parked on an "unassigned" node, because an
   *  uncircuited node is not a thing a control riser can draw. */
  connectionType: string;
  name: string;
  family: ControlFamily;
  color: string;
  devices: ControlRiserDevice[];
  /** Total device instances on this circuit (sum of device qty). */
  deviceCount: number;
};

export type ControlRiserEdge = {
  routeId: string;
  /** The cable part the run carries. */
  partId: string;
  /** The circuit the run belongs to, or null when it can't be pinned down. */
  connectionType: string | null;
  fromPlacementId: string | null;
  toPlacementId: string | null;
  /** Plain-English note when the circuit had to be inferred or couldn't be. */
  note?: string;
};

export type ControlRiserSkip = {
  kind: "device" | "route";
  /** Placement id, or route id for a route skip. */
  id: string;
  partId: string;
  reason: string;
};

export type ControlRiserGraph = {
  nodes: ControlRiserNode[];
  edges: ControlRiserEdge[];
  /** Nothing silently skipped: every device and route left off, with why. */
  skipped: ControlRiserSkip[];
};

/** Unread GridPlacement/GridRoute fields are declared optional so a real
 *  instance passes without a cast — see grid-lineset-schedule.ts's note. */
export type ControlPlacementLite = {
  id: string;
  partId: string;
  category?: string;
  curtain?: unknown;
  sheetId?: string;
  page?: number;
  x?: number;
  y?: number;
  by?: string;
  at?: number;
};

/** PartLite satisfies this; its priced/inventory fields are accepted and
 *  ignored (a control riser has no prices on it). */
export type ControlPartLite = ScopedPartLite & {
  id: string;
  desc?: string;
  category?: string;
  ports?: Port[];
  sku?: string;
  unit?: string;
  list?: number;
  cost?: number;
  hasDatasheet?: boolean;
};

export type ControlRouteLite = {
  id: string;
  partId: string;
  fromPlacementId?: string;
  toPlacementId?: string;
  connectionType?: string;
  sheetId?: string;
  page?: number;
  points?: Array<{ x: number; y: number }>;
  aspect?: number;
  by?: string;
  at?: number;
};

/** Scopes whose devices belong on a lighting/rigging control riser. */
function isControlScope(scope: string): boolean {
  return scope === "Lighting" || scope === "Rigging";
}

/** Distinct connection types a part declares, in declared order. */
function circuitsOf(part: ControlPartLite): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of part.ports || []) {
    const t = (p.connectionType || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Derive the control riser. Node order is family order (power, then lighting
 * data, then rigging, then anything unrecognised) and, inside a family, first
 * appearance — a one-line reads top-down from the service, and power is what
 * the service lands on first.
 */
export function controlRiserGraph(
  placements: ControlPlacementLite[],
  routes: ControlRouteLite[],
  parts: ControlPartLite[]
): ControlRiserGraph {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const nodeByType = new Map<string, ControlRiserNode>();
  const skipped: ControlRiserSkip[] = [];
  /** placement id -> the circuits its device sits on, for route endpoints. */
  const circuitsByPlacement = new Map<string, string[]>();

  for (const pl of placements) {
    const part = partById.get(pl.partId) || null;
    const { scope } = scopeOfPlacement(pl, part);
    if (!isControlScope(scope)) {
      skipped.push({
        kind: "device",
        id: pl.id,
        partId: pl.partId,
        reason:
          scope === "Unscoped"
            ? part
              ? "no group or trade maps this part to a scope — map its category in the Catalog screen"
              : "not in the catalog — no ports, no circuit"
            : `${scope} scope — ${scope === "Curtains" ? "goods, not a circuited device" : "belongs on the AV riser, not the control riser"}`,
      });
      continue;
    }
    if (!part) {
      skipped.push({ kind: "device", id: pl.id, partId: pl.partId, reason: "not in the catalog — no ports to circuit" });
      continue;
    }
    const circuits = circuitsOf(part);
    if (circuits.length === 0) {
      // The catalog is not fully migrated to ports (catalog-connect.ts's own
      // caveat). An un-migrated device must be NAMED, never dropped.
      skipped.push({
        kind: "device",
        id: pl.id,
        partId: pl.partId,
        reason: "the catalog part declares no ports — add its connectors to circuit it",
      });
      continue;
    }
    circuitsByPlacement.set(pl.id, circuits);
    for (const conn of circuits) {
      let node = nodeByType.get(conn);
      if (!node) {
        const family = familyOf(conn);
        node = {
          connectionType: conn,
          name: conn,
          family,
          color: FAMILY_COLORS[family],
          devices: [],
          deviceCount: 0,
        };
        nodeByType.set(conn, node);
      }
      const row = node.devices.find((d) => d.partId === pl.partId);
      if (row) row.qty += 1;
      else node.devices.push({ partId: pl.partId, desc: part.desc || pl.partId, qty: 1 });
      node.deviceCount += 1;
    }
  }

  const edges: ControlRiserEdge[] = [];
  for (const r of routes) {
    const from = r.fromPlacementId ? circuitsByPlacement.get(r.fromPlacementId) : undefined;
    const to = r.toPlacementId ? circuitsByPlacement.get(r.toPlacementId) : undefined;

    // A validated connectionType was stamped at draw time (grid-projects
    // GridRoute) and is authoritative. Otherwise: a shared circuit between
    // the two endpoint devices, but ONLY when it is unambiguous — a run
    // between two devices that share both power and DMX could be either, and
    // the drawing must not pick one for the designer.
    let connectionType: string | null = r.connectionType || null;
    let note: string | undefined;
    if (!connectionType) {
      const shared = (from || []).filter((c) => (to || []).includes(c));
      if (shared.length === 1) {
        connectionType = shared[0];
        note = "circuit inferred from the two devices' shared connector";
      } else if (shared.length > 1) {
        note = `endpoints share ${shared.length} connectors (${shared.join(", ")}) — draw the run again to record which`;
      } else if (!r.fromPlacementId || !r.toPlacementId) {
        note = "free route — not snapped to devices, so it carries no circuit";
      } else {
        note = "endpoint devices share no connector — not a control run";
      }
    }

    if (!connectionType) {
      skipped.push({ kind: "route", id: r.id, partId: r.partId, reason: note || "no circuit" });
      continue;
    }
    // A run on a circuit no device landed on (e.g. both endpoints are AV) is
    // not part of this drawing.
    if (!nodeByType.has(connectionType)) {
      skipped.push({
        kind: "route",
        id: r.id,
        partId: r.partId,
        reason: `${connectionType} is not a lighting/rigging control circuit on this plan`,
      });
      continue;
    }
    edges.push({
      routeId: r.id,
      partId: r.partId,
      connectionType,
      fromPlacementId: r.fromPlacementId ?? null,
      toPlacementId: r.toPlacementId ?? null,
      ...(note ? { note } : {}),
    });
  }

  const familyRank = (f: ControlFamily) => {
    const i = (CONTROL_FAMILIES as readonly string[]).indexOf(f);
    return i < 0 ? CONTROL_FAMILIES.length : i;
  };
  const nodes = [...nodeByType.values()];
  const order = new Map(nodes.map((n, i) => [n.connectionType, i]));
  nodes.sort(
    (a, b) =>
      familyRank(a.family) - familyRank(b.family) ||
      (order.get(a.connectionType) || 0) - (order.get(b.connectionType) || 0)
  );

  return { nodes, edges, skipped };
}
