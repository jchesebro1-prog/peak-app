"use client";

/**
 * Client-side stores for the two browser-only inputs the Quick Design and
 * Design screens share, exposed via useSyncExternalStore so server render
 * and hydration stay consistent:
 *
 * - Tier definitions: global, per-browser (prototype localStorage key
 *   rss_tierdefs_v1). Server snapshot = the authored defaults.
 * - Resolved accent color: SVG fill attributes can't consume CSS variables,
 *   so the plan drawings need the concrete hex set on <html>.
 */

import { loadTierDefs, saveTierDefs, tierDefsDefault, type TierDefs } from "./engine";

const TIERDEFS_SERVER_SNAPSHOT: TierDefs = tierDefsDefault();

let cache: TierDefs | null = null;
const listeners = new Set<() => void>();

export function subscribeTierDefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getTierDefs(): TierDefs {
  if (!cache) cache = loadTierDefs();
  return cache;
}

export function getTierDefsServer(): TierDefs {
  return TIERDEFS_SERVER_SNAPSHOT;
}

/** Replace the tier definitions (persists to localStorage, notifies subscribers). */
export function putTierDefs(next: TierDefs): void {
  cache = next;
  saveTierDefs(next);
  listeners.forEach((l) => l());
}

/* ---- resolved accent (concrete hex for SVG fills) ---- */

const ACCENT_FALLBACK = "#b08d4a";

export function subscribeAccent(): () => void {
  return () => {};
}

export function getAccentHex(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return v || ACCENT_FALLBACK;
  } catch {
    return ACCENT_FALLBACK;
  }
}

export function getAccentHexServer(): string {
  return ACCENT_FALLBACK;
}
