/* Grid workspace — selection rules (#299). Pure: no DB, no server-only imports. */
import type { Point } from "@/lib/annotations";

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** A rect from two opposite corners, in any order. */
export function normRect(a: Point, b: Point): Rect {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

/** Ids of the items inside the rect (edges inclusive), in input order. */
export function idsInRect(items: { id: string; x: number; y: number }[], r: Rect): string[] {
  return items
    .filter((it) => it.x >= r.x0 && it.x <= r.x1 && it.y >= r.y0 && it.y <= r.y1)
    .map((it) => it.id);
}

/** Add the id at the end, or remove it when already selected. */
export function toggleId(sel: readonly string[], id: string): string[] {
  return sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id];
}

/** Additive marquee keeps the base selection then appends new hits; otherwise the hits replace it. */
export function marqueeSelection(base: readonly string[], hits: string[], additive: boolean): string[] {
  if (!additive) return [...hits];
  const out = [...base];
  for (const id of hits) if (!out.includes(id)) out.push(id);
  return out;
}
