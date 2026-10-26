// src/lib/design/room-shape/edit.ts
import { add, arcInfo, bulgeForArcLength, bulgeForRadius, dist, edgeAt, mul, selfCrosses, splitEdge, sub, withOpen } from "./geometry";
import { ROOM_TYPES, SHAPE_LIMITS, type RoomShape, type RoomTypeKey, type ShapeEdge, type ShapePt, type ShapeRoom } from "./types";
import { fmtFeet } from "./units";

export type EditOp =
  | { op: "move"; room: string; i: number; to: ShapePt; glue: boolean }
  | { op: "addPoint"; room: string; edge: number }
  | { op: "setBulge"; room: string; edge: number; bulge: number }
  | { op: "toFreeform"; room: string; edge: number }
  | { op: "setHandles"; room: string; edge: number; c1: ShapePt; c2: ShapePt }
  | { op: "straighten"; room: string; edge: number }
  | { op: "setOpen"; room: string; edge: number; open: boolean }
  | { op: "setLength"; room: string; edge: number; ft: number; from: "far" | "near" }
  | { op: "setRadius"; room: string; edge: number; ft: number }
  | { op: "setArcLength"; room: string; edge: number; ft: number }
  | { op: "deletePoint"; room: string; i: number }
  | { op: "rename"; room: string; name: string }
  | { op: "retype"; room: string; type: RoomTypeKey }
  | { op: "deleteRoom"; room: string };

export type EditResult = { ok: true; shape: RoomShape } | { ok: false; reason: string };

const bad = (reason: string): EditResult => ({ ok: false, reason });

/** Move corner k of a room to `to`, carrying the Bezier handles on either side by the same delta. */
function movePt(r: ShapeRoom, k: number, to: ShapePt): void {
  const n = r.pts.length, d = sub(to, r.pts[k]);
  r.pts[k] = { x: to.x, y: to.y };
  const out = r.edges[k];
  if (out.kind === "curve") r.edges[k] = { ...out, c1: add(out.c1, d) };
  const inn = r.edges[(k - 1 + n) % n];
  if (inn.kind === "curve") r.edges[(k - 1 + n) % n] = { ...inn, c2: add(inn.c2, d) };
}

/** Every room touched must still be a valid outline. */
function check(next: RoomShape, touched: readonly string[]): EditResult {
  for (const id of touched) {
    const r = next.rooms.find((x) => x.id === id);
    if (!r) continue;
    if (r.pts.length < SHAPE_LIMITS.minPts) return bad("A room needs at least 3 corners.");
    if (r.pts.some((p, i) => dist(p, r.pts[(i + 1) % r.pts.length]) < 0.01)) return bad("Two corners can't sit in the same place.");
    if (selfCrosses(r)) return bad(`That would make the ${r.name} cross itself.`);
  }
  return { ok: true, shape: next };
}

/**
 * #370: one edit to a room shape — pure; the input is never mutated. A refusal names why in the user's words.
 * Glue (move / setLength): every other corner within 0.5" of the moved corner's old spot moves with it.
 */
export function applyEdit(shape: RoomShape, op: EditOp): EditResult {
  const next: RoomShape = structuredClone(shape);
  const r = next.rooms.find((x) => x.id === op.room);
  if (!r) return bad("That room is gone — try again.");
  const n = r.pts.length;
  const edgeIdx = "edge" in op ? op.edge : -1;
  if ("edge" in op && !(edgeIdx >= 0 && edgeIdx < n)) return bad("That wall is gone — try again.");
  const a = edgeIdx >= 0 ? r.pts[edgeIdx] : null, b = edgeIdx >= 0 ? r.pts[(edgeIdx + 1) % n] : null;
  const e: ShapeEdge | null = edgeIdx >= 0 ? r.edges[edgeIdx] : null;

  const moveGlued = (k: number, to: ShapePt, glue: boolean): string[] => {
    const from = r.pts[k], d = sub(to, from);
    const touched = [r.id];
    if (glue)
      for (const o of next.rooms)
        for (let q = 0; q < o.pts.length; q++)
          if (!(o === r && q === k) && dist(o.pts[q], from) <= SHAPE_LIMITS.glueFt) {
            movePt(o, q, add(o.pts[q], d));
            if (!touched.includes(o.id)) touched.push(o.id);
          }
    movePt(r, k, to);
    return touched;
  };

  switch (op.op) {
    case "move": {
      if (!(op.i >= 0 && op.i < n)) return bad("That corner is gone — try again.");
      if (![op.to.x, op.to.y].every((v) => Number.isFinite(v) && Math.abs(v) <= SHAPE_LIMITS.coordFt)) return bad("That's off the plan.");
      return check(next, moveGlued(op.i, op.to, op.glue));
    }
    case "addPoint": {
      if (n >= SHAPE_LIMITS.pts) return bad(`A room can have at most ${SHAPE_LIMITS.pts} corners.`);
      const s = splitEdge(a!, b!, e!, 0.5);
      r.pts.splice(edgeIdx + 1, 0, s.at);
      r.edges.splice(edgeIdx, 1, s.first, s.second);
      return check(next, [r.id]);
    }
    case "setBulge": {
      if (!Number.isFinite(op.bulge)) return bad("That curve can't be drawn.");
      const bl = Math.max(-SHAPE_LIMITS.bulge, Math.min(SHAPE_LIMITS.bulge, op.bulge));
      r.edges[edgeIdx] = withOpen(Math.abs(bl) < 1e-3 ? { kind: "line" } : { kind: "arc", bulge: bl }, !!e!.open);
      return check(next, [r.id]);
    }
    case "toFreeform": {
      r.edges[edgeIdx] = withOpen({ kind: "curve", c1: edgeAt(a!, b!, e!, 1 / 3), c2: edgeAt(a!, b!, e!, 2 / 3) }, !!e!.open);
      return check(next, [r.id]);
    }
    case "setHandles": {
      if (e!.kind !== "curve") return bad("That wall isn't free-form.");
      r.edges[edgeIdx] = { ...e!, c1: op.c1, c2: op.c2 };
      return check(next, [r.id]);
    }
    case "straighten":
      r.edges[edgeIdx] = withOpen({ kind: "line" }, !!e!.open);
      return check(next, [r.id]);
    case "setOpen":
      r.edges[edgeIdx] = withOpen(e!, op.open);
      return { ok: true, shape: next };
    case "setLength": {
      if (e!.kind !== "line") return bad("Only a straight wall takes a length — use Radius or Arc length for a curve.");
      if (!(op.ft > 0)) return bad("The length must be more than 0.");
      const L = dist(a!, b!);
      if (L < 1e-9) return bad("That wall has no direction to grow along.");
      const u = mul(sub(b!, a!), 1 / L);
      const touched = op.from === "far" ? moveGlued((edgeIdx + 1) % n, add(a!, mul(u, op.ft)), true) : moveGlued(edgeIdx, sub(b!, mul(u, op.ft)), true);
      return check(next, touched);
    }
    case "setRadius": {
      if (e!.kind !== "arc") return bad("Only a curved wall has a radius.");
      const L = dist(a!, b!);
      const bl = bulgeForRadius(L, op.ft, e!.bulge);
      if (bl === null) return bad(`The radius must be at least ${fmtFeet(L / 2)} — half the wall's straight length.`);
      r.edges[edgeIdx] = withOpen({ kind: "arc", bulge: bl }, !!e!.open);
      return check(next, [r.id]);
    }
    case "setArcLength": {
      if (e!.kind !== "arc") return bad("Only a curved wall has an arc length.");
      const L = dist(a!, b!);
      const bl = bulgeForArcLength(L, op.ft, e!.bulge);
      if (bl === null) return bad(`The arc must be longer than the straight distance (${fmtFeet(L)}).`);
      r.edges[edgeIdx] = withOpen({ kind: "arc", bulge: bl }, !!e!.open);
      return check(next, [r.id]);
    }
    case "deletePoint": {
      if (!(op.i >= 0 && op.i < n)) return bad("That corner is gone — try again.");
      if (n <= SHAPE_LIMITS.minPts) return bad("A room needs at least 3 corners.");
      const prev = (op.i - 1 + n) % n;
      const open = !!r.edges[prev].open && !!r.edges[op.i].open;
      r.pts.splice(op.i, 1);
      r.edges.splice(op.i, 1);
      r.edges[op.i === 0 ? r.edges.length - 1 : op.i - 1] = withOpen({ kind: "line" }, open);
      return check(next, [r.id]);
    }
    case "rename":
      r.name = op.name.trim().slice(0, SHAPE_LIMITS.name) || ROOM_TYPES[r.type].label;
      return { ok: true, shape: next };
    case "retype":
      if (!ROOM_TYPES[op.type]) return bad("That isn't a room type.");
      r.type = op.type;
      return { ok: true, shape: next };
    case "deleteRoom":
      if (r.roles.includes("stage") || r.roles.includes("house")) return bad("The Stage and the House can't be deleted.");
      next.rooms = next.rooms.filter((x) => x.id !== r.id);
      return { ok: true, shape: next };
  }
}

/** Arc info for the UI (radius / arc length boxes) — re-exported so the editor imports edits from one place. */
export { arcInfo };
