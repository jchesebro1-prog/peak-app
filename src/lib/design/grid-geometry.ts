import type { Point } from "@/lib/annotations";

/* ------------------------------------------------------------------ *
 * The Grid — space geometry (D109). Pure and dependency-free (same
 * rule as grid-bom.ts): runs in the editor client bundle and on the
 * server, so placement→space assignment can never disagree between
 * the sidebar and the quote.
 *
 * Assignment is COMPUTED, never stored: a placement belongs to the
 * smallest space polygon containing it on its sheet+page. Redrawing a
 * space reassigns every device instantly, and deleting one can never
 * strand stale space ids on placements.
 * ------------------------------------------------------------------ */

/** The slice of a space the geometry needs — stores/grid-projects.GridSpace
 *  satisfies it structurally. */
export type SpaceLite = {
  id: string;
  sheetId: string;
  page: number;
  points: Point[];
};

/**
 * Ray casting: count edge crossings of a horizontal ray from p to +∞.
 * Odd = inside. Degenerate "polygons" (fewer than 3 vertices) contain
 * nothing rather than throwing — a half-drawn space must never claim
 * devices.
 */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const crosses =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Shoelace area (absolute — winding direction is a drawing accident). */
export function polygonArea(poly: Point[]): number {
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(s) / 2;
}

/** Label anchor. Proper area-weighted centroid; falls back to the vertex
 *  mean when the polygon is degenerate (zero area). */
export function polygonCentroid(poly: Point[]): Point {
  const n = poly.length;
  if (!n) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    s += cross;
    cx += (poly[j].x + poly[i].x) * cross;
    cy += (poly[j].y + poly[i].y) * cross;
  }
  if (Math.abs(s) < 1e-12) {
    return {
      x: poly.reduce((a, p) => a + p.x, 0) / n,
      y: poly.reduce((a, p) => a + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * s), y: cy / (3 * s) };
}

/**
 * The space a placement belongs to: smallest containing polygon on the
 * same sheet+page, or null. Smallest-wins is what makes nesting work —
 * a control booth drawn inside the house claims its own devices.
 */
export function spaceOf(
  pl: { sheetId: string; page: number; x: number; y: number },
  spaces: SpaceLite[]
): SpaceLite | null {
  let best: SpaceLite | null = null;
  let bestArea = Infinity;
  for (const s of spaces) {
    if (s.sheetId !== pl.sheetId || s.page !== pl.page) continue;
    if (!pointInPolygon({ x: pl.x, y: pl.y }, s.points)) continue;
    const a = polygonArea(s.points);
    if (a < bestArea) {
      best = s;
      bestArea = a;
    }
  }
  return best;
}
