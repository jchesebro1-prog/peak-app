/**
 * Pop-out windows — size and position memory (spec §4). Pure: the caller
 * reads/writes localStorage (in try/catch) and passes the screen in.
 */
import type { PopKind } from "./names";

export type Geo = { left: number; top: number; width: number; height: number };
export type Screen = { availLeft: number; availTop: number; availWidth: number; availHeight: number };

export const DEFAULT_GEO: Record<PopKind, { width: number; height: number }> = {
  estimate: { width: 1100, height: 800 },
  customer: { width: 900, height: 800 },
  thread: { width: 760, height: 800 },
  inbox: { width: 760, height: 800 },
};

/** At least this many px of the window must stay on the screen. */
export const MIN_VISIBLE = 100;

export function geoKey(kind: PopKind): string {
  return `peak-pop-geo:${kind}`;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** A saved geometry (or null → the kind's default, centred) forced onto the
 *  screen: size capped to the screen, and at least MIN_VISIBLE px showing. */
export function clampGeo(saved: Partial<Geo> | null | undefined, screen: Screen, kind: PopKind = "thread"): Geo {
  const def = DEFAULT_GEO[kind];
  const sw = Math.max(finite(screen.availWidth) ? screen.availWidth : def.width, MIN_VISIBLE);
  const sh = Math.max(finite(screen.availHeight) ? screen.availHeight : def.height, MIN_VISIBLE);
  const sl = finite(screen.availLeft) ? screen.availLeft : 0;
  const st = finite(screen.availTop) ? screen.availTop : 0;

  const usable = !!saved && finite(saved.width) && finite(saved.height) && saved.width > 0 && saved.height > 0;
  const width = Math.min(Math.round(usable ? (saved!.width as number) : def.width), Math.round(sw));
  const height = Math.min(Math.round(usable ? (saved!.height as number) : def.height), Math.round(sh));

  let left: number;
  let top: number;
  if (usable && finite(saved!.left) && finite(saved!.top)) {
    left = Math.round(saved!.left as number);
    top = Math.round(saved!.top as number);
    left = Math.min(Math.max(left, sl + MIN_VISIBLE - width), sl + sw - MIN_VISIBLE);
    top = Math.min(Math.max(top, st), st + sh - MIN_VISIBLE);
  } else {
    left = Math.round(sl + (sw - width) / 2);
    top = Math.round(st + (sh - height) / 2);
  }
  return { left, top, width, height };
}

export function featuresFor(geo: Geo): string {
  return `popup=yes,left=${geo.left},top=${geo.top},width=${geo.width},height=${geo.height}`;
}
