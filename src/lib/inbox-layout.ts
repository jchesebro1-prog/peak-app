/**
 * #126 — Inbox pane layout: the message-list width and the folder-rail
 * collapse state, both per browser (localStorage) and both hydration-safe —
 * the shell renders with the same defaults the server would, then a
 * mount-time effect applies whatever was stored, exactly like the
 * estimator's collapsible rails (estimator-client.tsx META_OPEN_KEY /
 * SIDE_OPEN_KEY). The clamp/parse rules live here, DB-free, so test:specs
 * can pin them without a component.
 */
export const LIST_WIDTH_KEY = "pk.inbox.listWidth.v1";
export const SIDE_COLLAPSED_KEY = "pk.inbox.sideCollapsed.v1";

export const LIST_WIDTH_DEFAULT = 392;
export const LIST_WIDTH_MIN = 300;
export const LIST_WIDTH_MAX = 620;

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Clamp a candidate list width to [LIST_WIDTH_MIN, LIST_WIDTH_MAX]; anything
 *  unusable (NaN, missing) falls back to the default. Whole pixels only. */
export function clampListWidth(width: number | null | undefined): number {
  const n = finite(width);
  if (n === null) return LIST_WIDTH_DEFAULT;
  return Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, Math.round(n)));
}

/** The stored width string → a clamped number; never throws. */
export function parseListWidth(raw: string | null | undefined): number {
  if (!raw) return LIST_WIDTH_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? clampListWidth(n) : LIST_WIDTH_DEFAULT;
}

/** The stored collapse flag ("1"/"0") → boolean; anything else is "not
 *  collapsed" (the shell's own default). */
export function parseSideCollapsed(raw: string | null | undefined): boolean {
  return raw === "1";
}
