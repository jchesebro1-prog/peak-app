/**
 * #299 — The Grid workspace's pane sizes and collapse state, per browser
 * (localStorage), hydration-safe: the shell renders these defaults, then a
 * mount-time effect applies whatever was stored (the inbox-layout pattern).
 * DB-free so test:specs can pin the rules.
 */
export type PaneKey = "left" | "right" | "bottom";

export const PANE_DEFAULTS: Record<PaneKey, number> = { left: 280, right: 280, bottom: 220 };
export const PANE_LIMITS: Record<PaneKey, { min: number; max: number }> = {
  left: { min: 200, max: 520 },
  right: { min: 200, max: 520 },
  bottom: { min: 120, max: 480 },
};
export const NARROW_WIDTH = 1100;

export const PANE_SIZE_KEY = (k: PaneKey) => `pk.grid.pane.${k}.v1`;
export const PANE_COLLAPSED_KEY = (k: PaneKey) => `pk.grid.pane.${k}.collapsed.v1`;

export function clampPane(k: PaneKey, px: number | null | undefined): number {
  if (typeof px !== "number" || !Number.isFinite(px)) return PANE_DEFAULTS[k];
  const { min, max } = PANE_LIMITS[k];
  return Math.min(max, Math.max(min, Math.round(px)));
}

export function parsePaneSize(k: PaneKey, raw: string | null | undefined): number {
  if (!raw) return PANE_DEFAULTS[k];
  const n = Number(raw);
  return Number.isFinite(n) ? clampPane(k, n) : PANE_DEFAULTS[k];
}

export function parseCollapsed(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

/** Side panes start collapsed on a narrow window; the Library never does. */
export function defaultCollapsed(k: PaneKey, viewportWidth: number): boolean {
  return k !== "bottom" && viewportWidth < NARROW_WIDTH;
}
