import { patchDoc } from "@/db/doc-store";
import { clamp01, type Point } from "@/lib/annotations";
import { spaceOf } from "@/lib/design/grid-geometry";
import { hasOption } from "@/lib/design/grid-options";
import {
  UNASSIGNED_KEY,
  applyRiserOp,
  isEndRef,
  marginPoints,
  nodeKeyOf,
  normalizeRiserDoc,
  pruneRisers,
  sameEnd,
  spreadInSpace,
  type EndRef,
  type RiserOp,
} from "@/lib/design/grid-riser-doc";
import type { GridPlacement, GridProject } from "./grid-projects";

/**
 * The riser editor's writes (#GDS, drawing set spec §4). Each function is ONE
 * patchDoc on the Grid project, computed from the doc read inside the patch,
 * so a device add, a qty edit and the riser document can never disagree.
 * Placements written here are ordinary GridPlacements — the plan, BOM,
 * spaces, revisions and quote treat them exactly like painted ones.
 * Callers (design/grid/[id]/riser/actions.ts) authenticate and validate parts.
 */

function rid(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const MAX_NODE_QTY = 200;
export const MAX_LINK_FT = 5000;

type Missing = "not-found" | "no-such-option";
type DropRefusal = "no-such-space" | "no-sheet";
type Drop = { sheetId: string; page: number; points: Point[] };

/** The option's placements the riser shows on `nodeKey` for `partId`, oldest first. */
function nodeDevices(p: GridProject, optionId: string, nodeKey: string, partId: string): GridPlacement[] {
  const spaces = p.spaces || [];
  return (p.placements || [])
    .filter(
      (pl) =>
        pl.optionId === optionId &&
        !pl.curtain &&
        pl.partId === partId &&
        nodeKeyOf(spaceOf(pl, spaces)?.id ?? null) === nodeKey
    )
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

function takenOn(p: GridProject, sheetId: string, page: number): Point[] {
  return (p.placements || []).filter((pl) => pl.sheetId === sheetId && pl.page === page).map((pl) => ({ x: pl.x, y: pl.y }));
}

/** Where new devices for a node land: spread inside the space, or along the
 *  first sheet's lower margin (outside every space) for Unassigned. */
function dropPoints(p: GridProject, nodeKey: string, n: number): Drop | DropRefusal {
  if (nodeKey !== UNASSIGNED_KEY) {
    const space = (p.spaces || []).find((s) => s.id === nodeKey);
    if (!space) return "no-such-space";
    return { sheetId: space.sheetId, page: space.page, points: spreadInSpace(space.points, n, takenOn(p, space.sheetId, space.page)) };
  }
  const sheetId = (p.sheetIds || [])[0];
  if (!sheetId) return "no-sheet";
  const blockers = (p.spaces || []).filter((s) => s.sheetId === sheetId && s.page === 1).map((s) => s.points);
  return { sheetId, page: 1, points: marginPoints(n, blockers, takenOn(p, sheetId, 1)) };
}

function newPlacements(drop: Drop, partId: string, optionId: string, by: string, at: number): GridPlacement[] {
  return drop.points.map((pt) => ({
    id: rid("gp-"),
    sheetId: drop.sheetId,
    page: drop.page,
    x: clamp01(pt.x),
    y: clamp01(pt.y),
    partId,
    optionId,
    by,
    at,
  }));
}

/** Layout / level / conduit / note / link-removal edits. */
export async function patchRiser(
  projectId: string,
  optionId: string,
  op: RiserOp
): Promise<{ ok: true } | { ok: false; reason: Missing | "invalid" }> {
  let refusal: Missing | "invalid" | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, optionId)) {
      refusal = "no-such-option";
      return;
    }
    const res = applyRiserOp(normalizeRiserDoc(p.riser?.[optionId]), op, (prefix) => rid(prefix));
    if (!res.changed) {
      refusal = "invalid";
      return;
    }
    p.riser = { ...(p.riser || {}), [optionId]: res.doc };
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "invalid" | null;
  return r ? { ok: false, reason: r } : { ok: true };
}

/** A typed-length cable run between two riser ends (Connect when the ends
 *  are not two devices on one calibrated page). Priced via routeLines. */
export async function addRiserLink(
  projectId: string,
  input: { optionId: string; from: EndRef; to: EndRef; partId: string; lengthFt: number; by: string }
): Promise<{ ok: true; id: string } | { ok: false; reason: Missing | "bad-end" | "bad-length" }> {
  if (!Number.isFinite(input.lengthFt) || !(input.lengthFt > 0) || input.lengthFt > MAX_LINK_FT) return { ok: false, reason: "bad-length" };
  if (!isEndRef(input.from) || !isEndRef(input.to) || sameEnd(input.from, input.to)) return { ok: false, reason: "bad-end" };
  const id = rid("lk-");
  let refusal: Missing | "bad-end" | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const live = (e: EndRef) =>
      e.kind === "space"
        ? e.spaceId === null || (p.spaces || []).some((s) => s.id === e.spaceId)
        : (p.placements || []).some((pl) => pl.id === e.placementId && pl.optionId === input.optionId);
    if (!live(input.from) || !live(input.to)) {
      refusal = "bad-end";
      return;
    }
    const doc = normalizeRiserDoc(p.riser?.[input.optionId]);
    doc.links = [
      ...doc.links,
      { id, from: input.from, to: input.to, partId: input.partId, lengthFt: Math.round(input.lengthFt * 10) / 10, by: input.by, at: Date.now() },
    ];
    p.riser = { ...(p.riser || {}), [input.optionId]: doc };
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "bad-end" | null;
  return r ? { ok: false, reason: r } : { ok: true, id };
}

/** "+ Device": `qty` new placements of `partId` on the plan, inside the node's space. */
export async function addDevicesToNode(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string; qty: number; by: string }
): Promise<{ ok: true; added: number } | { ok: false; reason: Missing | DropRefusal | "bad-qty" }> {
  const qty = Math.floor(input.qty);
  if (!(qty >= 1 && qty <= MAX_NODE_QTY)) return { ok: false, reason: "bad-qty" };
  let refusal: Missing | DropRefusal | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const drop = dropPoints(p, input.nodeKey, qty);
    if (typeof drop === "string") {
      refusal = drop;
      return;
    }
    const at = Date.now();
    p.placements = [...(p.placements || []), ...newPlacements(drop, input.partId, input.optionId, input.by, at)];
    p.updatedAt = at;
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | DropRefusal | null;
  return r ? { ok: false, reason: r } : { ok: true, added: qty };
}

/** Edit a device row's qty: add placements inside the space, or remove the
 *  newest ones (their riser links/conduits go with them). */
export async function setNodeDeviceQty(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string; qty: number; by: string }
): Promise<{ ok: true; added: number; removed: number } | { ok: false; reason: Missing | DropRefusal | "bad-qty" | "no-devices" }> {
  const qty = Math.floor(input.qty);
  if (!(qty >= 1 && qty <= MAX_NODE_QTY)) return { ok: false, reason: "bad-qty" };
  let refusal: Missing | DropRefusal | "no-devices" | null = null;
  let added = 0;
  let removed = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const cur = nodeDevices(p, input.optionId, input.nodeKey, input.partId);
    if (!cur.length) {
      refusal = "no-devices";
      return;
    }
    if (qty > cur.length) {
      const drop = dropPoints(p, input.nodeKey, qty - cur.length);
      if (typeof drop === "string") {
        refusal = drop;
        return;
      }
      p.placements = [...(p.placements || []), ...newPlacements(drop, input.partId, input.optionId, input.by, Date.now())];
      added = qty - cur.length;
    } else if (qty < cur.length) {
      const gone = new Set(cur.slice(qty).map((pl) => pl.id));
      p.placements = (p.placements || []).filter((pl) => !gone.has(pl.id));
      if (p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
      removed = gone.size;
    }
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | DropRefusal | "no-devices" | null;
  return r ? { ok: false, reason: r } : { ok: true, added, removed };
}

/** Swap the catalog part on every placement of a device row. */
export async function replaceNodeDevicePart(
  projectId: string,
  input: { optionId: string; nodeKey: string; fromPartId: string; toPartId: string }
): Promise<{ ok: true; changed: number } | { ok: false; reason: Missing | "no-devices" }> {
  let refusal: Missing | "no-devices" | null = null;
  let changed = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const ids = new Set(nodeDevices(p, input.optionId, input.nodeKey, input.fromPartId).map((pl) => pl.id));
    if (!ids.size) {
      refusal = "no-devices";
      return;
    }
    p.placements = (p.placements || []).map((pl) => (ids.has(pl.id) ? { ...pl, partId: input.toPartId } : pl));
    changed = ids.size;
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "no-devices" | null;
  return r ? { ok: false, reason: r } : { ok: true, changed };
}

/** Delete a device row: every placement of it in that node, with their riser ends. */
export async function removeNodeDevices(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string }
): Promise<{ ok: true; removed: number } | { ok: false; reason: Missing | "no-devices" }> {
  let refusal: Missing | "no-devices" | null = null;
  let removed = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    const gone = new Set(nodeDevices(p, input.optionId, input.nodeKey, input.partId).map((pl) => pl.id));
    if (!gone.size) {
      refusal = "no-devices";
      return;
    }
    p.placements = (p.placements || []).filter((pl) => !gone.has(pl.id));
    if (p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
    removed = gone.size;
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "no-devices" | null;
  return r ? { ok: false, reason: r } : { ok: true, removed };
}
