/**
 * Pop-out windows — opening one (spec §1) and remembering its frame (§4).
 * Client-only at call time: every function touches `window`, and only inside
 * the function, so importing this module is safe anywhere. Every
 * window.open / localStorage access sits in try/catch and degrades silently.
 */
import { isPopName, parsePopName, popName, type PopKind } from "./names";
import { clampGeo, featuresFor, geoKey, type Geo, type Screen } from "./geometry";
import {
  POP_BLOCKED_EVENT,
  POP_MIN_VIEWPORT,
  geoFromWindow,
  isPopoutClick,
  parseSavedGeo,
  type PopClickEvent,
} from "./click";
import { NATIVE_CLASS } from "./live";

/** True in a pop-out window (window.name is `peak-pop:…`). */
export function isPopWindow(): boolean {
  try {
    return isPopName(window.name);
  } catch {
    return false;
  }
}

/** Pop-outs are offered on a ≥ 900 px viewport outside the native shell. */
export function popoutsAvailable(): boolean {
  try {
    if (document.documentElement.classList.contains(NATIVE_CLASS)) return false;
    return window.innerWidth >= POP_MIN_VIEWPORT;
  } catch {
    return false;
  }
}

function savedGeo(kind: PopKind): Partial<Geo> | null {
  try {
    return parseSavedGeo(localStorage.getItem(geoKey(kind)));
  } catch {
    return null; // storage blocked — defaults
  }
}

function openerScreen(): Screen {
  const s = window.screen as globalThis.Screen & { availLeft?: number; availTop?: number };
  return {
    availLeft: typeof s.availLeft === "number" ? s.availLeft : 0,
    availTop: typeof s.availTop === "number" ? s.availTop : 0,
    availWidth: s.availWidth,
    availHeight: s.availHeight,
  };
}

function notifyBlocked(): void {
  try {
    window.dispatchEvent(new CustomEvent(POP_BLOCKED_EVENT));
  } catch {
    // no CustomEvent — nothing to show
  }
}

/**
 * Open (or focus) the pop-out `peak-pop:<kind>:<id>` at `url`. Returns false
 * when the browser blocked it (the blocked notice is shown; the page does
 * not navigate).
 *
 * The window is opened by name with an empty URL first: a fresh window comes
 * back as about:blank and is sent to `url`; an existing one comes back as it
 * is and is only focused, so popping the same item again never reloads it
 * over someone's unsaved typing.
 */
export function openPopout(kind: PopKind, id: string, url: string): boolean {
  const name = popName(kind, id);
  let w: Window | null = null;
  try {
    const features = featuresFor(clampGeo(savedGeo(kind), openerScreen(), kind));
    w = window.open("", name, features);
  } catch {
    w = null;
  }
  if (!w) {
    notifyBlocked();
    return false;
  }
  try {
    if (w.location.href === "about:blank") w.location.replace(new URL(url, window.location.origin).href);
  } catch {
    // the existing window is on another origin — leave it, just focus
  }
  try {
    w.focus();
  } catch {
    // the browser may refuse to raise it
  }
  return true;
}

/**
 * The shift-click handler for a row or link: on a pop-out click (see
 * isPopoutClick) where pop-outs are offered, stop the click and open the
 * pop-out; returns true when it did. Any other click returns false untouched.
 */
export function handlePopoutClick(
  e: PopClickEvent & { preventDefault(): void; stopPropagation(): void },
  kind: PopKind,
  id: string,
  url: string
): boolean {
  if (!isPopoutClick(e) || !popoutsAvailable()) return false;
  e.preventDefault();
  e.stopPropagation();
  try {
    // Shift-click on a row also extends the text selection — drop it.
    window.getSelection?.()?.removeAllRanges();
  } catch {
    // no selection API
  }
  openPopout(kind, id, url);
  return true;
}

/** In a pop-out window: save its frame under that window's kind. */
export function savePopGeometry(): void {
  try {
    const p = parsePopName(window.name);
    if (!p) return;
    const g = geoFromWindow(window);
    if (!g) return;
    localStorage.setItem(geoKey(p.kind), JSON.stringify(g));
  } catch {
    // storage blocked — the next open uses defaults
  }
}
