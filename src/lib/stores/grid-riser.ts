import { patchDoc } from "@/db/doc-store";
import { clamp01, type Point } from "@/lib/annotations";
import { spaceOf } from "@/lib/design/grid-geometry";
import { hasOption } from "@/lib/design/grid-options";
import {
  UNASSIGNED_KEY,
  applyRiserOp,
  MAX_CONDUITS,
  MAX_LEVELS,
  MAX_LINKS,
  MAX_NOTES,
  marginPoints,
  nodeKeyOf,
  normalizeRiserDoc,
  pruneRisers,
  sameEnd,
  spreadInSpace,
  toEndRef,
  type EndRef,
  type RiserOp,
} from "@/lib/design/grid-riser-doc";
import { planRowQty } from "@/lib/design/grid-riser";
import { AUTO_QTY_MAX, sanitizeAutoOrigin, withoutAuto } from "@/lib/design/grid-auto-model";
import type { GridPlacement, GridProject } from "./grid-projects";

/**
 * The riser editor's writes (#209, drawing set spec §4). Each function is ONE
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

/** Whether an end reference actually resolves in this project/option — a
 *  space that exists (or the unassigned `null`), or a placement that exists
 *  AND belongs to this option. Shared by `addRiserLink` and `patchRiser`'s
 *  `addConduit`, so a forged or cross-option end is refused the same way
 *  wherever it's written (review I1). */
function liveEnd(p: GridProject, optionId: string, e: EndRef): boolean {
  return e.kind === "space"
    ? e.spaceId === null || (p.spaces || []).some((s) => s.id === e.spaceId)
    : (p.placements || []).some((pl) => pl.id === e.placementId && pl.optionId === optionId);
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
): Promise<{ ok: true } | { ok: false; reason: Missing | "invalid" | "cap" }> {
  let refusal: Missing | "invalid" | "cap" | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, optionId)) {
      refusal = "no-such-option";
      return;
    }
    const current = normalizeRiserDoc(p.riser?.[optionId]);
    // The pure reducer (applyRiserOp) has no project to check an end or a
    // moveNode key against — that live check happens here, against the
    // same rules addRiserLink uses (review I1, M1).
    if (op.op === "addConduit") {
      const from = toEndRef(op.from);
      const to = toEndRef(op.to);
      if (!from || !to || !liveEnd(p, optionId, from) || !liveEnd(p, optionId, to)) {
        refusal = "invalid";
        return;
      }
    }
    if (op.op === "moveNode" && op.key !== UNASSIGNED_KEY && !(p.spaces || []).some((s) => s.id === op.key)) {
      refusal = "invalid";
      return;
    }
    // Per-option document caps (review M3) — refused here with a specific
    // reason rather than falling through to applyRiserOp's generic
    // changed:false (which still guards the same caps defensively).
    if (
      (op.op === "addLevel" && current.levels.length >= MAX_LEVELS) ||
      (op.op === "addConduit" && current.conduits.length >= MAX_CONDUITS) ||
      (op.op === "addNote" && current.notes.length >= MAX_NOTES)
    ) {
      refusal = "cap";
      return;
    }
    const res = applyRiserOp(current, op, (prefix) => rid(prefix));
    if (!res.changed) {
      refusal = "invalid";
      return;
    }
    p.riser = { ...(p.riser || {}), [optionId]: res.doc };
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "invalid" | "cap" | null;
  return r ? { ok: false, reason: r } : { ok: true };
}

/** A typed-length cable run between two riser ends (Connect when the ends
 *  are not two devices on one calibrated page). Priced via routeLines. */
export async function addRiserLink(
  projectId: string,
  input: { optionId: string; from: EndRef; to: EndRef; partId: string; lengthFt: number; by: string }
): Promise<{ ok: true; id: string } | { ok: false; reason: Missing | "bad-end" | "bad-length" | "cap" }> {
  // Validate the ROUNDED length (review M2) — a raw value that rounds down
  // to 0 ft (e.g. 0.04) must be refused, not stored as a zero-length cable.
  const lengthFt = Math.round(Number(input.lengthFt) * 10) / 10;
  if (!(lengthFt > 0) || lengthFt > MAX_LINK_FT) return { ok: false, reason: "bad-length" };
  // Canonicalize both ends into fresh objects (review I1) — never the raw
  // client value, which may carry extra properties.
  const from = toEndRef(input.from);
  const to = toEndRef(input.to);
  if (!from || !to || sameEnd(from, to)) return { ok: false, reason: "bad-end" };
  const id = rid("lk-");
  let refusal: Missing | "bad-end" | "cap" | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refusal = "no-such-option";
      return;
    }
    if (!liveEnd(p, input.optionId, from) || !liveEnd(p, input.optionId, to)) {
      refusal = "bad-end";
      return;
    }
    const doc = normalizeRiserDoc(p.riser?.[input.optionId]);
    if (doc.links.length >= MAX_LINKS) {
      refusal = "cap";
      return;
    }
    doc.links = [...doc.links, { id, from, to, partId: input.partId, lengthFt, by: input.by, at: Date.now() }];
    p.riser = { ...(p.riser || {}), [input.optionId]: doc };
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | "bad-end" | "cap" | null;
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

/**
 * Edit a device row's qty — the row's UNIT count, lot markers included
 * (#GEM fix wave 1, I1 / D-GEM-11; the rule is planRowQty): a plain row
 * adds placements inside the space or removes the newest ones (their riser
 * links/conduits go with them); a row holding a lot marker edits the lot's
 * qty instead and never gains markers. A plain row stays capped at
 * MAX_NODE_QTY markers; a lot row may go to AUTO_QTY_MAX units. A real
 * change is a hand edit: every placement left in the row loses its `auto`
 * tag, so a later per-scope re-fill keeps the edited row.
 */
export async function setNodeDeviceQty(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string; qty: number; by: string }
): Promise<{ ok: true; added: number; removed: number } | { ok: false; reason: Missing | DropRefusal | "bad-qty" | "no-devices" }> {
  const qty = Math.floor(Number(input.qty));
  if (!(Number.isFinite(qty) && qty >= 1 && qty <= AUTO_QTY_MAX)) return { ok: false, reason: "bad-qty" };
  let refusal: Missing | DropRefusal | "bad-qty" | "no-devices" | null = null;
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
    const plan = planRowQty(cur, qty);
    if (!plan) {
      refusal = "bad-qty";
      return;
    }
    if (plan.add > 0 && cur.length + plan.add > MAX_NODE_QTY) {
      refusal = "bad-qty";
      return;
    }
    if (!plan.add && !plan.remove.length && !plan.set.size) return; // nothing changed
    let fresh: GridPlacement[] = [];
    if (plan.add > 0) {
      const drop = dropPoints(p, input.nodeKey, plan.add);
      if (typeof drop === "string") {
        refusal = drop;
        return;
      }
      fresh = newPlacements(drop, input.partId, input.optionId, input.by, Date.now());
      // D-GEM-20: markers added to an Auto-painted row stand in for that row
      // too, so the row's whole edited unit count is kept on a re-fill.
      const origin = cur.map((pl) => sanitizeAutoOrigin(pl.auto ?? pl.autoOrigin)).find((o) => o) ?? null;
      if (origin) fresh = fresh.map((pl) => ({ ...pl, autoOrigin: origin }));
    }
    const gone = new Set(plan.remove);
    const row = new Set(cur.map((pl) => pl.id));
    p.placements = [
      ...(p.placements || [])
        .filter((pl) => !gone.has(pl.id))
        .map((pl) => {
          if (!row.has(pl.id)) return pl;
          const next = withoutAuto({ ...pl });
          const q = plan.set.get(pl.id);
          if (q !== undefined) {
            if (q > 1) next.qty = q;
            else delete next.qty;
          }
          return next;
        }),
      ...fresh,
    ];
    if (gone.size && p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
    added = fresh.length;
    removed = gone.size;
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Missing | DropRefusal | "bad-qty" | "no-devices" | null;
  return r ? { ok: false, reason: r } : { ok: true, added, removed };
}

/** Swap the catalog part on every placement of a device row. A swap is a
 *  hand edit (#GEM, D-GEM-11): the row's placements lose their `auto` tag, so
 *  a later per-scope re-fill keeps the chosen part. Lot qty is kept. */
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
    p.placements = (p.placements || []).map((pl) => (ids.has(pl.id) ? { ...withoutAuto(pl), partId: input.toPartId } : pl));
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
