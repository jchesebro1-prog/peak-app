/**
 * Where a saved design opens (#GEM final review I2) — pure, shared by Home,
 * the Reviews queue and the Designs dashboard. A manual-layout (Grid) design
 * opens its linked Grid project; everything else is a Quick Design record.
 */
export function designOpenHref(d: { id: string; layoutMode?: string | null; gridProjectId?: string | null }): string {
  if (d.layoutMode === "manual" && d.gridProjectId) return `/design/grid/${encodeURIComponent(d.gridProjectId)}`;
  return `/design/quick?design=${encodeURIComponent(d.id)}`;
}
