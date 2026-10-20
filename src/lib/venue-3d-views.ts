/**
 * Venue 3D preview — camera presets (#344 C8). Pure: no three.js, so the harness can test it.
 *
 * Model space (see venue-3d.tsx): x across the room (0 = centre line, +x = audience right),
 * y up (0 = house floor), z along the room (0 = plaster line; stage negative, house positive).
 * "Stage right" is the actor's right facing the audience = audience left = -x.
 */

export type ViewPreset = "orbit" | "plan" | "section" | "elevation";

export const VIEW_PRESETS: { id: ViewPreset; label: string }[] = [
  { id: "orbit", label: "Orbit" },
  { id: "plan", label: "Plan" },
  { id: "section", label: "Section" },
  { id: "elevation", label: "Elevation" },
];

export interface ModelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

type V3 = [number, number, number];

export interface ViewOptions {
  /** Viewport width / height (ortho extents keep it). Default 1.5. */
  aspect?: number;
  /** Where the plaster line sits on z. Default 0. */
  plasterZ?: number;
  /** Elevation eye height above the house floor, feet. Default 5. */
  eyeHeight?: number;
  /** Elevation look-at height (the stage opening). Default: eye level. */
  lookY?: number;
  /** The Orbit preset's camera (today's framing); derived from the bounds when omitted. */
  orbitHome?: { position: V3; target: V3 };
}

export interface PresetCamera {
  kind: "perspective" | "ortho";
  position: V3;
  target: V3;
  up: V3;
  /** Ortho only: frustum half-extents about the view axis (screen units = feet). */
  ortho?: { left: number; right: number; top: number; bottom: number };
  /** Section only: three.js Plane (normal, constant) — keeps points with normal·p + constant >= 0. */
  clip?: { normal: V3; constant: number };
  /** The viewer may rotate (Orbit, Elevation); ortho presets only zoom and pan. */
  rotate: boolean;
}

export const ORTHO_MARGIN = 1.12;
export const DEFAULT_ASPECT = 1.5;

/** Half-extents of a frustum that covers w × h with a margin at the given aspect, centred. */
export function fitOrtho(w: number, h: number, aspect: number = DEFAULT_ASPECT): { left: number; right: number; top: number; bottom: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : DEFAULT_ASPECT;
  let halfW = Math.max(w, 1) * ORTHO_MARGIN / 2;
  let halfH = Math.max(h, 1) * ORTHO_MARGIN / 2;
  if (halfW / halfH < a) halfW = halfH * a;
  else halfH = halfW / a;
  return { left: -halfW, right: halfW, top: halfH, bottom: -halfH };
}

export function presetCamera(preset: ViewPreset, b: ModelBounds, opts: ViewOptions = {}): PresetCamera {
  const aspect = opts.aspect ?? DEFAULT_ASPECT;
  const plasterZ = opts.plasterZ ?? 0;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const sx = b.maxX - b.minX;
  const sy = b.maxY - b.minY;
  const sz = b.maxZ - b.minZ;
  const reach = Math.max(sx, sy, sz, 1) * 1.5 + 10; // camera stand-off for ortho (zoom doesn't move it)

  if (preset === "plan") {
    // straight down at the centre; stage at the top of the screen (screen-up = -z)
    return {
      kind: "ortho",
      position: [cx, b.maxY + reach, cz],
      target: [cx, cy, cz],
      up: [0, 0, -1],
      ortho: fitOrtho(sx, sz, aspect),
      rotate: false,
    };
  }
  if (preset === "section") {
    // from stage right (-x) looking across at the centre line; the stage-right half is clipped away
    return {
      kind: "ortho",
      position: [b.minX - reach, cy, cz],
      target: [cx, cy, cz],
      up: [0, 1, 0],
      ortho: fitOrtho(sz, sy, aspect),
      clip: { normal: [1, 0, 0], constant: -cx },
      rotate: false,
    };
  }
  if (preset === "elevation") {
    const eye = opts.eyeHeight ?? 5;
    const houseDepth = b.maxZ - plasterZ;
    const z = plasterZ + (houseDepth > 1 ? houseDepth / 2 : 10);
    return {
      kind: "perspective",
      position: [cx, eye, z],
      target: [cx, opts.lookY ?? eye, plasterZ],
      up: [0, 1, 0],
      rotate: true,
    };
  }
  const home = opts.orbitHome;
  return {
    kind: "perspective",
    position: home ? home.position : [cx + sx * 0.35, b.minY + sy * 0.6, b.maxZ + sz * 0.15],
    target: home ? home.target : [cx, cy, plasterZ],
    up: [0, 1, 0],
    rotate: true,
  };
}
