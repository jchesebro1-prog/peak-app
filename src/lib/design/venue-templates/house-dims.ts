import type { AState } from "@/app/(app)/design/quick/engine";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import type { StretchDims } from "./types";

/**
 * House size for a proscenium room (#249) — the typed feet, or a default.
 * Pure; safe in client components. Width is inside faces at the back of the
 * house; depth is plaster line → back wall at the centreline.
 */
type HouseInput = Pick<AState, "width" | "wing"> & Partial<Pick<AState, "houseWidthFt" | "houseDepthFt" | "houseHalfFt">>;

export const HOUSE_DEPTH_LIM: [number, number] = [40, 200];
export const HOUSE_NARROW_WARNING = "The house is narrower than the stage, so its side walls slant inward.";

/** Never narrower than the proscenium opening, nor than the booth + vestibules the template keeps rigid (≈35') plus seats. */
export function houseWidthLim(s: Pick<AState, "width">): [number, number] {
  return [Math.max(45, Math.ceil(s.width || 0)), 200];
}

export function stageInsideWidthFt(s: Pick<AState, "width" | "wing">): number {
  return (s.width || 0) + 2 * (s.wing || 0);
}

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const clamp = (n: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, n));

export function houseDims(s: HouseInput): { widthFt: number; depthFt: number; warning: string | null } {
  // A Quick Design save from before #249 carries only its dragged half-width.
  const rawW = pos(s.houseWidthFt) ? s.houseWidthFt : pos(s.houseHalfFt) ? 2 * s.houseHalfFt : stageInsideWidthFt(s);
  const widthFt = clamp(rawW, houseWidthLim(s));
  const depthFt = clamp(pos(s.houseDepthFt) ? s.houseDepthFt : PROSCENIUM_KEYS.defaults.houseDepthFt, HOUSE_DEPTH_LIM);
  const warning = widthFt < stageInsideWidthFt(s) - 1e-9 ? HOUSE_NARROW_WARNING : null;
  return { widthFt, depthFt, warning };
}

/** The stretch inputs for a proscenium designer state. */
export function prosceniumDims(s: HouseInput & Pick<AState, "depth" | "sys">): StretchDims {
  const h = houseDims(s);
  return { proWidthFt: s.width, wingFt: s.wing || 0, stageDepthFt: s.depth, houseWidthFt: h.widthFt, houseDepthFt: h.depthFt, pit: !!s.sys?.pit };
}
