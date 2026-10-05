/**
 * #299 Grid workspace — copy/paste rules (pure, DB-free, client-safe).
 *
 * `copySelection` snapshots a selection relative to its bounding-box
 * top-left; `pasteLayout` lays that snapshot onto the sheet. Auto tags and
 * provenance (auto/autoOrigin/seededFrom/optionId/by/at) are never copied, so
 * a pasted device is an ordinary hand placement. Type-only store import.
 */
import type { Point } from "@/lib/annotations";
import type { GridPlacement, GridRoute } from "@/lib/stores/grid-projects";

export type ClipItem = {
  srcId: string;
  dx: number;
  dy: number;
  partId: string;
  category?: string;
  curtain?: GridPlacement["curtain"];
  qty?: number;
};
export type Clipboard = {
  items: ClipItem[];
  routeIds: string[];
  sourceProjectId: string;
  sourceSheetId: string;
  sourcePage: number;
};

export const PASTE_OFFSET = 0.015;

export function copySelection(
  projectId: string,
  placements: GridPlacement[],
  routes: GridRoute[],
  ids: string[],
): Clipboard | null {
  const byId = new Map(placements.map((p) => [p.id, p]));
  const picked: GridPlacement[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const p = byId.get(id);
    if (p && !seen.has(id)) {
      seen.add(id);
      picked.push(p);
    }
  }
  if (picked.length === 0) return null;
  const minX = Math.min(...picked.map((p) => p.x));
  const minY = Math.min(...picked.map((p) => p.y));
  const items: ClipItem[] = picked.map((p) => {
    const item: ClipItem = { srcId: p.id, dx: p.x - minX, dy: p.y - minY, partId: p.partId };
    if (p.category !== undefined) item.category = p.category;
    if (p.curtain !== undefined) item.curtain = p.curtain;
    if (p.qty !== undefined) item.qty = p.qty;
    return item;
  });
  const routeIds = routes
    .filter((r) => r.fromPlacementId && r.toPlacementId && seen.has(r.fromPlacementId) && seen.has(r.toPlacementId))
    .map((r) => r.id);
  return {
    items,
    routeIds,
    sourceProjectId: projectId,
    sourceSheetId: picked[0].sheetId,
    sourcePage: picked[0].page,
  };
}

export function pasteLayout(
  clip: Clipboard,
  at: Point | null,
  last: Point | null,
): { anchor: Point; items: (ClipItem & { x: number; y: number })[] } {
  const w = Math.max(0, ...clip.items.map((i) => i.dx));
  const h = Math.max(0, ...clip.items.map((i) => i.dy));
  const raw: Point = at
    ? { x: at.x, y: at.y }
    : last
      ? { x: last.x + PASTE_OFFSET, y: last.y + PASTE_OFFSET }
      : { x: 0.5 - w / 2, y: 0.5 - h / 2 };
  const anchor: Point = {
    x: Math.min(Math.max(raw.x, 0), 1 - w),
    y: Math.min(Math.max(raw.y, 0), 1 - h),
  };
  return { anchor, items: clip.items.map((i) => ({ ...i, x: anchor.x + i.dx, y: anchor.y + i.dy })) };
}
