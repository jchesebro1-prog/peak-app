import type { AState } from "@/app/(app)/design/quick/engine";
import { familyDims } from "./house-dims";
import { keysById, stretchById } from "./templates";

/**
 * #255: the dimension-panel view of a template's movable rooms — wall choices (and whether each fits) and a
 * whole-foot position. `ft` is the room's distance along its wall's usable run (0 = flush with the run's start
 * corner), `maxFt` that run's length in feet — the engine's `t` is `ft / maxFt`, so a whole `ft` lands on a whole
 * foot exactly as a drag does (snapMovable). `maxFt` may be fractional (a 28'-6" run); only its far end is.
 */
export type MovableOption = { id: string; label: string; wall: string; ft: number; maxFt: number; walls: Array<{ id: string; label: string; fits: boolean }> };

/** The fields movableOptions reads — a Quick Design / Grid intake state (AState or its QuickScopeInputs slice). */
type MovableInput = Pick<AState, "width" | "wing" | "depth" | "sys"> & Partial<Pick<AState, "houseWidthFt" | "houseDepthFt" | "houseHalfFt" | "movables">>;

export function movableOptions(s: MovableInput, tpl: string): { items: MovableOption[]; warnings: string[] } {
  const keys = keysById(tpl);
  if (!keys.movables?.length) return { items: [], warnings: [] };
  const plan = stretchById(tpl, familyDims(s, tpl));
  const items = keys.movables.map((m) => {
    const p = plan.movables[m.id];
    const r = p.runs[p.wall];
    const maxFt = Math.max(0, Math.round(((r.hi - r.lo) / 12) * 1e6) / 1e6);
    return {
      id: m.id,
      label: plan.regionLabels[m.region] ?? m.region,
      wall: p.wall,
      ft: Math.round(p.t * maxFt),
      maxFt,
      walls: m.walls
        .filter((w) => p.runs[w])
        .map((w) => ({ id: w, label: keys.movableWallLabels?.[w] ?? w[0].toUpperCase() + w.slice(1), fits: p.runs[w].hi >= p.runs[w].lo })),
    };
  });
  return { items, warnings: plan.warnings };
}

/** Just one room's position changed; the others keep theirs. */
export function movablePatch(s: Pick<AState, "movables">, id: string, pos: { wall: string; t: number | null }): { movables: Record<string, { wall: string; t: number | null }> } {
  return { movables: { ...(s.movables || {}), [id]: pos } };
}
