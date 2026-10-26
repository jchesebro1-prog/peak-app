// src/lib/design/room-shape/snap.ts
import type { ShapePt } from "./types";

export type Snapped = { pt: ShapePt; guide: [ShapePt, ShapePt] | null };
const TOL = (4 * Math.PI) / 180;

/**
 * #370: a dragged corner snapped. Along a 45° direction from a neighbouring corner when within 4° of one (absolute,
 * or relative to that neighbour's other wall), its distance there rounded to the grid; otherwise to the grid.
 */
export function snapCorner(raw: ShapePt, neighbours: ReadonlyArray<{ at: ShapePt; wallDir: ShapePt | null }>, o: { gridFt: number; angles: boolean }): Snapped {
  const g = o.gridFt > 0 ? o.gridFt : 0.5;
  let best: { pt: ShapePt; d: number; from: ShapePt } | null = null;
  if (o.angles) {
    for (const nb of neighbours) {
      const v = { x: raw.x - nb.at.x, y: raw.y - nb.at.y }, len = Math.hypot(v.x, v.y);
      if (len < g) continue;
      const ang = Math.atan2(v.y, v.x);
      const cands = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
      if (nb.wallDir && Math.hypot(nb.wallDir.x, nb.wallDir.y) > 1e-9) {
        const w = Math.atan2(nb.wallDir.y, nb.wallDir.x);
        for (let k = 0; k < 8; k++) cands.push(w + (k * Math.PI) / 4);
      }
      for (const c of cands) {
        let diff = ang - c;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        if (Math.abs(diff) > TOL) continue;
        const L = Math.round((len * Math.cos(diff)) / g) * g;
        const pt = { x: nb.at.x + L * Math.cos(c), y: nb.at.y + L * Math.sin(c) };
        const d = Math.hypot(pt.x - raw.x, pt.y - raw.y);
        if (!best || d < best.d) best = { pt, d, from: nb.at };
      }
    }
  }
  if (best) return { pt: best.pt, guide: [best.from, best.pt] };
  return { pt: { x: Math.round(raw.x / g) * g, y: Math.round(raw.y / g) * g }, guide: null };
}
