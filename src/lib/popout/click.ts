/**
 * Pop-out windows — the ways to open one (spec §3) and what they share.
 * Pure, no browser access — safe in the client bundle, in server
 * components, and in the Node test harness.
 */
import type { Geo } from "./geometry";

/** The shift-click rule: a primary-button click with Shift held and neither
 *  Cmd nor Ctrl. Plain clicks, Cmd-clicks and Ctrl-clicks keep their own
 *  behaviour (navigate, new tab). */
export type PopClickEvent = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; button: number };

export function isPopoutClick(e: PopClickEvent): boolean {
  return e.button === 0 && e.shiftKey && !e.metaKey && !e.ctrlKey;
}

/** Every pop-out affordance (⧉ button, nav hover ⧉) carries this label. */
export const POP_AFFORDANCE_LABEL = "Open in its own window";
/** The CSS class that hides affordances below 900 px and in the native shell. */
export const POP_AFFORDANCE_CLASS = "pk-popout-affordance";
/** Below this viewport width pop-outs are not offered (and shift-click is ordinary). */
export const POP_MIN_VIEWPORT = 900;

/** window.open returned null — the shared notice shows this. */
export const POP_BLOCKED_MESSAGE = "Your browser blocked the window — allow pop-ups for this site.";
/** The window event openPopout dispatches when the browser blocks the window. */
export const POP_BLOCKED_EVENT = "peak-popout-blocked";
/** How long the blocked notice stays up. */
export const POP_BLOCKED_MS = 6000;

/** The single-thread URL (the Inbox lands a bare ?thread= in its own mailbox). */
export function threadPopUrl(id: string): string {
  return `/inbox?thread=${encodeURIComponent(id)}`;
}

/** The customer record URL. */
export function customerPopUrl(id: string): string {
  return `/companies/${encodeURIComponent(id)}`;
}

/** A saved geometry from localStorage, or null when missing or junk. */
export function parseSavedGeo(raw: string | null | undefined): Partial<Geo> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const out: Partial<Geo> = {};
    for (const k of ["left", "top", "width", "height"] as const) {
      if (typeof o[k] === "number" && Number.isFinite(o[k])) out[k] = o[k] as number;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** What a pop-out window saves on resize / close: its screen position and its
 *  INNER (content) size — window.open's width/height features set the inner
 *  size, so saving the outer frame would grow the window by its chrome on
 *  every reopen. Null when the browser reports nothing usable (a minimised or
 *  closing window). */
export function geoFromWindow(w: { screenX: number; screenY: number; innerWidth: number; innerHeight: number }): Geo | null {
  const g = { left: w.screenX, top: w.screenY, width: w.innerWidth, height: w.innerHeight };
  if (![g.left, g.top, g.width, g.height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (g.width <= 0 || g.height <= 0) return null;
  return { left: Math.round(g.left), top: Math.round(g.top), width: Math.round(g.width), height: Math.round(g.height) };
}
