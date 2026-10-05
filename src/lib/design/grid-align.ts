/* Grid workspace — align and distribute rules (#299). Pure: positions are fractions of the sheet (0..1). */

export type Pos = { id: string; x: number; y: number };
export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Line the items up on one edge or the midpoint of their extremes. Fewer than 2 items → unchanged copies. */
export function alignPositions(items: Pos[], mode: AlignMode): Pos[] {
  if (items.length < 2) return items.map((p) => ({ ...p }));
  const xs = items.map((p) => p.x);
  const ys = items.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return items.map((p) => {
    switch (mode) {
      case "left":
        return { ...p, x: minX };
      case "right":
        return { ...p, x: maxX };
      case "center":
        return { ...p, x: (minX + maxX) / 2 };
      case "top":
        return { ...p, y: minY };
      case "bottom":
        return { ...p, y: maxY };
      case "middle":
        return { ...p, y: (minY + maxY) / 2 };
    }
  });
}

/** Space the items evenly along one axis (lerp form: first + (last-first)*i/(n-1) without the float drift);
 *  the two end items keep their values. Fewer than 3 → unchanged copies. */
export function distributePositions(items: Pos[], axis: "x" | "y"): Pos[] {
  if (items.length < 3) return items.map((p) => ({ ...p }));
  const sorted = [...items].sort((a, b) => a[axis] - b[axis] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const first = sorted[0][axis];
  const last = sorted[sorted.length - 1][axis];
  const n = sorted.length;
  const next = new Map<string, number>();
  sorted.forEach((p, i) => {
    next.set(p.id, i === 0 ? first : i === n - 1 ? last : first * (1 - i / (n - 1)) + last * (i / (n - 1)));
  });
  return items.map((p) => ({ ...p, [axis]: next.get(p.id) as number }));
}

/** Entries of `after` whose x or y moved by more than 1e-9 from the same id in `before`. */
export function changedMoves(before: Pos[], after: Pos[]): Pos[] {
  const prev = new Map(before.map((p) => [p.id, p] as const));
  return after.filter((p) => {
    const b = prev.get(p.id);
    return !b || Math.abs(b.x - p.x) > 1e-9 || Math.abs(b.y - p.y) > 1e-9;
  });
}
