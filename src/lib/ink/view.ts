/* Pure view math for InkPad (#344 C3): fit, zoom, pinch, pan clamp, coordinate mapping,
   pointer roles, export sizing, label hit-testing. No DOM globals — tested in test-va-notes.

   Coordinates: the stage is a CSS-pixel box (sw × sh). The background/doc is dw × dh doc units.
   `fit` is the contain scale (CSS px per doc unit at zoom 1); a View is the zoom `z` (0.5–4,
   relative to fit) plus the stage-pixel position (x, y) of the doc's top-left corner. */

import type { InkLabel } from "./model";

export type View = { z: number; x: number; y: number };
export type Pt = { x: number; y: number };

export const ZOOM = { min: 0.5, max: 4 } as const;
/** Max long edge of the flattened JPEG. */
export const EXPORT_LONG_EDGE = 1600;

const finite = (v: number, d: number) => (Number.isFinite(v) ? v : d);

export function clampZoom(z: number): number {
  z = finite(z, 1);
  return z < ZOOM.min ? ZOOM.min : z > ZOOM.max ? ZOOM.max : z;
}

/** CSS px per doc unit so the whole doc fits inside the stage less `pad` on each side. */
export function fitScale(sw: number, sh: number, dw: number, dh: number, pad = 12): number {
  const aw = Math.max(1, sw - pad * 2), ah = Math.max(1, sh - pad * 2);
  const s = Math.min(aw / Math.max(1, dw), ah / Math.max(1, dh));
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** Zoom 1, doc centred in the stage. */
export function fitView(sw: number, sh: number, dw: number, dh: number, pad = 12): View {
  const f = fitScale(sw, sh, dw, dh, pad);
  return { z: 1, x: (sw - dw * f) / 2, y: (sh - dh * f) / 2 };
}

export function screenToDoc(v: View, fit: number, sx: number, sy: number): Pt {
  const s = fit * v.z;
  return { x: (sx - v.x) / s, y: (sy - v.y) / s };
}

export function docToScreen(v: View, fit: number, dx: number, dy: number): Pt {
  const s = fit * v.z;
  return { x: v.x + dx * s, y: v.y + dy * s };
}

/** Zoom to `z` (clamped) keeping the doc point under stage point (cx, cy) fixed. */
export function zoomAt(v: View, z: number, cx: number, cy: number): View {
  const nz = clampZoom(z);
  const k = nz / v.z;
  return { z: nz, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
}

/** Two-finger pinch: zoom by the finger-distance ratio about the start midpoint, then follow the midpoint. */
export function pinchView(start: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const ratio = d0 > 1 && d1 > 0 ? d1 / d0 : 1;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const z = clampZoom(start.z * ratio);
  const k = z / start.z;
  return { z, x: m1.x - (m0.x - start.x) * k, y: m1.y - (m0.y - start.y) * k };
}

/** Keep the doc on screen: a doc smaller than the stage stays ≥ 75 % visible; a larger one
    keeps covering ≥ 75 % of the stage. Per axis, so the background can never be lost. */
export function clampView(v: View, fit: number, sw: number, sh: number, dw: number, dh: number): View {
  const s = fit * v.z;
  const axis = (pos: number, size: number, stage: number) => {
    const m = Math.min(size, stage) * 0.25;
    const lo = Math.min(0, stage - size) - m;
    const hi = Math.max(0, stage - size) + m;
    return pos < lo ? lo : pos > hi ? hi : pos;
  };
  return { z: v.z, x: axis(finite(v.x, 0), dw * s, sw), y: axis(finite(v.y, 0), dh * s, sh) };
}

export type Tap = { t: number; x: number; y: number };
/** A short touch that barely moved. */
export function isTap(down: Tap, up: Tap, maxMs = 250, maxPx = 10): boolean {
  return up.t - down.t <= maxMs && Math.hypot(up.x - down.x, up.y - down.y) <= maxPx;
}
/** Second tap within `ms` and `px` of the first. */
export function isDoubleTap(prev: Tap | null, now: Tap, ms = 300, px = 30): boolean {
  return !!prev && now.t - prev.t <= ms && now.t >= prev.t && Math.hypot(now.x - prev.x, now.y - prev.y) <= px;
}

/** Once a Pencil has been seen, fingers navigate and only the pen (or a mouse) draws. */
export function pointerRole(pointerType: string, penSeen: boolean): "draw" | "nav" {
  if (!penSeen) return "draw";
  return pointerType === "touch" ? "nav" : "draw";
}

/** Pen pressure as reported (a 0 on contact reads as light); mouse and pressure-less touch → 0.5. */
export function pointPressure(pointerType: string, pressure: number): number {
  if (pointerType === "mouse") return 0.5;
  const p = finite(pressure, 0);
  if (pointerType === "pen") return p <= 0 ? 0.1 : p > 1 ? 1 : p;
  return p > 0 && p < 1 ? p : 0.5;
}

/** Doc-unit pen width that reads as ~2–3 px on a fitted iPad stage (0.5 steps, ≥ 1). */
export function penWidthFor(dw: number, dh: number): number {
  return Math.max(1, Math.round((Math.max(dw, dh) / 400) * 2) / 2);
}

export function labelSizeFor(dw: number, dh: number): number {
  return Math.max(12, Math.round(Math.max(dw, dh) / 40));
}

/** Eraser radius in doc units: ≥ 2 × pen width, and ≥ 14 screen px at the current scale. */
export function eraserRadius(penWidth: number, screenScale: number): number {
  const s = screenScale > 0 && Number.isFinite(screenScale) ? screenScale : 1;
  return Math.max(penWidth * 2, 14 / s);
}

/** Flattened size: long edge = EXPORT_LONG_EDGE (never upscales a photo; an SVG may upscale to it). */
export function exportSize(dw: number, dh: number, allowUpscale: boolean, cap = EXPORT_LONG_EDGE): { w: number; h: number; k: number } {
  const long = Math.max(1, dw, dh);
  let k = cap / long;
  if (!allowUpscale) k = Math.min(1, k);
  return { w: Math.max(1, Math.round(dw * k)), h: Math.max(1, Math.round(dh * k)), k };
}

/** Topmost label whose text box (textBaseline "top") contains (x, y), padded by `pad` doc units. */
export function hitLabel(labels: InkLabel[], x: number, y: number, measure: (l: InkLabel) => number, pad = 4): string | null {
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i];
    const w = measure(l);
    if (x >= l.x - pad && x <= l.x + w + pad && y >= l.y - pad && y <= l.y + l.size * 1.2 + pad) return l.id;
  }
  return null;
}

/** Rough text width when no canvas is at hand. */
export function approxLabelWidth(l: InkLabel): number {
  return Array.from(l.text).length * l.size * 0.6;
}

/** SVG → data URL. The backgrounds hold non-ASCII glyphs (— ×), so never btoa. */
export function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
