// src/lib/design/room-shape/sanitize.ts
import { SHAPE_NEEDS_STAGE_HOUSE, SHAPE_STALE, SHAPE_UNREADABLE } from "./copy";
import { dist, selfCrosses } from "./geometry";
import { ROOM_ROLES, ROOM_TYPES, ROOM_TYPE_KEYS, SHAPE_LIMITS, type RoomRole, type RoomShape, type RoomTypeKey, type ShapeEdge, type ShapePt, type ShapeRoom } from "./types";

export type SanitizeResult = { ok: true; shape: RoomShape; notes: string[] } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, cap: number): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= cap ? v : null);
const pt = (v: unknown): ShapePt | null => {
  if (!isObj(v)) return null;
  const x = num(v.x, SHAPE_LIMITS.coordFt), y = num(v.y, SHAPE_LIMITS.coordFt);
  return x === null || y === null ? null : { x, y };
};

function edge(v: unknown): ShapeEdge | null {
  if (!isObj(v)) return null;
  const open = v.open === true ? { open: true as const } : {};
  if (v.kind === "line") return { kind: "line", ...open };
  if (v.kind === "arc") {
    const b = num(v.bulge, SHAPE_LIMITS.bulge);
    if (b === null) return null;
    return Math.abs(b) < 1e-6 ? { kind: "line", ...open } : { kind: "arc", bulge: b, ...open };
  }
  if (v.kind === "curve") {
    const c1 = pt(v.c1), c2 = pt(v.c2);
    return c1 && c2 ? { kind: "curve", c1, c2, ...open } : null;
  }
  return null;
}

/** Why a room can't be kept, or its clean form. */
function room(v: unknown): { room: ShapeRoom } | { reason: string; name: string } {
  if (!isObj(v)) return { reason: "it could not be read", name: "a room" };
  const type = typeof v.type === "string" && (ROOM_TYPE_KEYS as readonly string[]).includes(v.type) ? (v.type as RoomTypeKey) : null;
  const rawName = typeof v.name === "string" ? v.name.trim().slice(0, SHAPE_LIMITS.name) : "";
  const label = rawName || (type ? ROOM_TYPES[type].label : "a room");
  if (!type) return { reason: "it isn't a known room type", name: label };
  if (typeof v.id !== "string" || !/^rm_[0-9a-f]{8}$/.test(v.id)) return { reason: "its id could not be read", name: label };
  if (!Array.isArray(v.pts) || !Array.isArray(v.edges) || v.pts.length < SHAPE_LIMITS.minPts || v.pts.length > SHAPE_LIMITS.pts || v.edges.length !== v.pts.length)
    return { reason: `it needs ${SHAPE_LIMITS.minPts}–${SHAPE_LIMITS.pts} corners`, name: label };
  const pts = v.pts.map(pt), edges = v.edges.map(edge);
  if (pts.some((p) => !p) || edges.some((e) => !e)) return { reason: "a corner or wall could not be read", name: label };
  const P = pts as ShapePt[];
  if (P.some((p, i) => dist(p, P[(i + 1) % P.length]) < 0.01)) return { reason: "two corners are in the same place", name: label };
  const kind = v.kind === "room" || v.kind === "zone" ? v.kind : ROOM_TYPES[type].kind;
  const roles = Array.isArray(v.roles) ? [...new Set(v.roles.filter((r): r is RoomRole => (ROOM_ROLES as readonly string[]).includes(r as string)))] : [];
  const out: ShapeRoom = { id: v.id, type, name: label, kind, roles, pts: P, edges: edges as ShapeEdge[] };
  if (selfCrosses(out)) return { reason: "it crosses itself", name: label };
  return { room: out };
}

/**
 * #370: a client's room shape, never trusted. null when none was sent. Refused (with the user's sentence) when it
 * can't be read, was frozen from another template, or has no Stage / House; otherwise bad rooms are dropped and a
 * repeated role is cleared, each with a note.
 */
export function sanitizeRoomShape(raw: unknown, tpl: string | null, by: string, now: number): SanitizeResult | null {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw) || raw.v !== 1 || !Array.isArray(raw.rooms) || typeof raw.fromTemplate !== "string") return { ok: false, error: SHAPE_UNREADABLE };
  if (!tpl || raw.fromTemplate !== tpl) return { ok: false, error: SHAPE_STALE };
  const notes: string[] = [];
  const rooms: ShapeRoom[] = [];
  const ids = new Set<string>();
  const roleTaken = new Set<RoomRole>();
  for (const v of raw.rooms) {
    if (rooms.length >= SHAPE_LIMITS.rooms) break;
    const r = room(v);
    if ("reason" in r) { notes.push(`Left out "${r.name}": ${r.reason}.`); continue; }
    if (ids.has(r.room.id)) { notes.push(`Left out "${r.room.name}": it repeats another room.`); continue; }
    ids.add(r.room.id);
    const kept: RoomRole[] = [];
    for (const role of r.room.roles) {
      if (roleTaken.has(role)) notes.push(`"${r.room.name}" isn't the ${role} any more — another room is.`);
      else { roleTaken.add(role); kept.push(role); }
    }
    rooms.push({ ...r.room, roles: kept });
  }
  if (!roleTaken.has("stage") || !roleTaken.has("house")) return { ok: false, error: SHAPE_NEEDS_STAGE_HOUSE };
  return { ok: true, shape: { v: 1, fromTemplate: raw.fromTemplate, rooms, frozenAt: now, by }, notes };
}
