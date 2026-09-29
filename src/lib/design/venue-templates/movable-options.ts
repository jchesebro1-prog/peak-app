import type { AState } from "@/app/(app)/design/quick/engine";
import { familyDims } from "./house-dims";
import { TEMPLATE_IDS, keysById, stretchById } from "./templates";
import type { Pt } from "./types";

/**
 * #255: the dimension-panel view of a template's movable rooms — wall choices (and whether each fits) and a
 * whole-foot position. `ft` is the room's distance along its wall's usable run (0 = flush with the run's start
 * corner), `maxFt` that run's length in feet — the engine's `t` is `ft / maxFt`, so a whole `ft` lands on a whole
 * foot exactly as a drag does (snapMovable). `maxFt` may be fractional (a 28'-6" run); only its far end is.
 */
export type MovableOption = {
  id: string;
  label: string;
  wall: string;
  ft: number;
  maxFt: number;
  /** Which corner `ft` counts from, as seen on the plan ("left corner", "top corner"…). */
  from: string;
  /** Each allowed wall: whether the room fits on it, and its run's length in feet (the `maxFt` it would have there). */
  walls: Array<{ id: string; label: string; fits: boolean; lenFt: number }>;
};

/** A run's length in feet, float noise shed (a 28'-6" run is 28.5). */
const runFt = (r: { lo: number; hi: number }) => Math.max(0, Math.round(((r.hi - r.lo) / 12) * 1e6) / 1e6);

/** The plan corner a run starts at: drawing y is up, so +y reads as "top" on the plan (y down). */
function startCorner(r: { from: Pt; to: Pt }): string {
  const dx = r.to.x - r.from.x, dy = r.to.y - r.from.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "left corner" : "right corner") : dy > 0 ? "bottom corner" : "top corner";
}

/**
 * #255 review: each region's display name — a label two or more regions share is numbered in the keys' region
 * order ("Storage 1", "Storage 2"), so the dimension fields, the plan and the starter Spaces name the same room
 * the same way. Labels no other region repeats are returned as they are.
 */
export function numberedRegionLabels(regionLabels: Readonly<Record<string, string>>, order: readonly string[]): Record<string, string> {
  const ids = order.filter((id) => Object.hasOwn(regionLabels, id));
  const count = new Map<string, number>();
  for (const id of ids) count.set(regionLabels[id], (count.get(regionLabels[id]) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out: Record<string, string> = { ...regionLabels };
  for (const id of ids) {
    const l = regionLabels[id];
    if ((count.get(l) ?? 0) < 2) continue;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    out[id] = `${l} ${n}`;
  }
  return out;
}

/** The fields movableOptions reads — a Quick Design / Grid intake state (AState or its QuickScopeInputs slice). */
type MovableInput = Pick<AState, "width" | "wing" | "depth" | "sys"> & Partial<Pick<AState, "houseWidthFt" | "houseDepthFt" | "houseHalfFt" | "movables">>;

export function movableOptions(s: MovableInput, tpl: string): { items: MovableOption[]; warnings: string[] } {
  const keys = keysById(tpl);
  if (!keys.movables?.length) return { items: [], warnings: [] };
  const plan = stretchById(tpl, familyDims(s, tpl));
  const names = numberedRegionLabels(plan.regionLabels, Object.keys(keys.regions));
  const items = keys.movables.map((m) => {
    const p = plan.movables[m.id];
    const r = p.runs[p.wall];
    const maxFt = runFt(r);
    return {
      id: m.id,
      label: names[m.region] ?? m.region,
      wall: p.wall,
      ft: Math.round(p.t * maxFt),
      maxFt,
      from: startCorner(r),
      walls: m.walls
        .filter((w) => p.runs[w])
        .map((w) => ({ id: w, label: keys.movableWallLabels?.[w] ?? w[0].toUpperCase() + w.slice(1), fits: p.runs[w].hi >= p.runs[w].lo, lenFt: runFt(p.runs[w]) })),
    };
  });
  return { items, warnings: plan.warnings };
}

/** Moving a room to another wall: it lands on the whole foot nearest that wall's middle. */
export function wallChangeT(lenFt: number): number {
  return lenFt > 0 ? Math.round(lenFt / 2) / lenFt : 0.5;
}

/**
 * #255: a client's `movables` as the server stores it — never trusted. Only the effective template's own rooms
 * (walked from its keys, never from the payload's keys), each on a wall it may use, `t` a finite number clamped to
 * [0, 1] (anything else = null: home, or the middle of another wall). null when the payload isn't a plain object,
 * the template is unknown or has no rooms, or nothing survives.
 */
export function sanitizeMovables(raw: unknown, tpl: string | null | undefined): Record<string, { wall: string; t: number | null }> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !tpl || !TEMPLATE_IDS.includes(tpl)) return null;
  const keys = keysById(tpl);
  const out: Record<string, { wall: string; t: number | null }> = {};
  for (const m of keys.movables ?? []) {
    if (!Object.hasOwn(raw, m.id)) continue;
    const v = (raw as Record<string, unknown>)[m.id];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const { wall, t } = v as { wall?: unknown; t?: unknown };
    if (typeof wall !== "string" || !m.walls.includes(wall) || !keys.movableWalls || !Object.hasOwn(keys.movableWalls, wall)) continue;
    out[m.id] = { wall, t: typeof t === "number" && Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : null };
  }
  return Object.keys(out).length ? out : null;
}

/** Just one room's position changed; the others keep theirs. */
export function movablePatch(s: Pick<AState, "movables">, id: string, pos: { wall: string; t: number | null }): { movables: Record<string, { wall: string; t: number | null }> } {
  return { movables: { ...(s.movables || {}), [id]: pos } };
}
