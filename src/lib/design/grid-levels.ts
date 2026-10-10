/**
 * Levels (#321) — the floor lines a riser's device tags sit on (Stage,
 * Catwalk, Orch pit). Pure: the project stores the list, a space may name
 * one, and a sheet may name a default; a device's level is its space's,
 * else its sheet's. Same shape as the engine's CRLevel.
 */

export type GridLevel = { id: string; label: string; elevation?: string; order: number };

export const MAX_LEVELS = 30;
export const LEVEL_LABEL_MAX = 40;
export const LEVEL_ELEVATION_MAX = 20;

const LEVEL_ID = /^lvl-[0-9a-f]{12}$/;

export function newLevelId(): string {
  return `lvl-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Clean an incoming level list: rows with a blank label drop, labels and
 * elevations are trimmed and capped, a valid `lvl-` id is kept (a missing,
 * malformed or repeated one is minted), at most 30 rows, and `order` is
 * renumbered 0..n−1 in array order.
 */
export function cleanLevels(raw: unknown): GridLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: GridLevel[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (out.length >= MAX_LEVELS) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, LEVEL_LABEL_MAX).trim() : "";
    if (!label) continue;
    const elevation = typeof o.elevation === "string" ? o.elevation.trim().slice(0, LEVEL_ELEVATION_MAX).trim() : "";
    let id = typeof o.id === "string" && LEVEL_ID.test(o.id) && !seen.has(o.id) ? o.id : "";
    if (!id) {
      do id = newLevelId();
      while (seen.has(id));
    }
    seen.add(id);
    out.push({ id, label, ...(elevation ? { elevation } : {}), order: out.length });
  }
  return out;
}

/** Levels in display order. */
export function sortedLevels(levels: GridLevel[] | undefined): GridLevel[] {
  return [...(levels || [])].sort((a, b) => a.order - b.order);
}

/**
 * The level a device sits on: the containing space's `levelId`, else its
 * sheet's default, else null. An id that isn't on the project's list is
 * ignored (a space's stale level never beats the sheet's good one).
 */
export function levelOfPlacement<P extends { sheetId: string }>(
  pl: P,
  spaceOf: (pl: P) => { levelId?: string } | null,
  project: { levels?: GridLevel[]; sheetLevels?: Record<string, string> }
): string | null {
  const known = new Set((project.levels || []).map((l) => l.id));
  const fromSpace = spaceOf(pl)?.levelId;
  if (fromSpace && known.has(fromSpace)) return fromSpace;
  const fromSheet = project.sheetLevels?.[pl.sheetId];
  if (fromSheet && known.has(fromSheet)) return fromSheet;
  return null;
}
