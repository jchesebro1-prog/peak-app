import type { AState } from "@/app/(app)/design/quick/engine";
import { CHURCH_TRADITIONAL_KEYS } from "./church-traditional.keys";
import { templateEntry } from "./index";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import type { StretchDims } from "./types";

/**
 * House / nave size per template (#249, #255) — the typed feet, or a default.
 * Pure; safe in client components. Called without a template id every
 * function behaves exactly as #249's proscenium version.
 */
type HouseInput = Pick<AState, "width" | "wing"> & Partial<Pick<AState, "houseWidthFt" | "houseDepthFt" | "houseHalfFt">>;

export const HOUSE_DEPTH_LIM: [number, number] = [40, 200];
export const HOUSE_NARROW_WARNING = "The house is narrower than the stage, so its side walls slant inward.";
export const CHURCH_NAVE_WARNING = "The nave needs 8' beside the platform on each side, so the plan widens it to fit.";

export function stageInsideWidthFt(s: Pick<AState, "width" | "wing">): number {
  return (s.width || 0) + 2 * (s.wing || 0);
}

export type HouseSpec = {
  width: { label: string; note: string };
  depth: { label: string; note: string };
  widthLim: (s: HouseInput) => [number, number];
  widthDefault: (s: HouseInput) => number;
  depthLim: [number, number];
  depthDefault: number;
  /** Reads a pre-#249 Quick Design save's dragged half-width (proscenium only). */
  legacyHalf: boolean;
  /** `raw` = the width asked for (typed or default), `widthFt` = the width in use. */
  warning: (s: HouseInput, raw: number, widthFt: number) => string | null;
};

export const HOUSE_SPECS: Record<string, HouseSpec> = {
  "proscenium@1": {
    width: { label: "House width", note: "Inside walls, at the back of the house" },
    depth: { label: "House depth", note: "Plaster line to back wall" },
    // Never narrower than the opening, nor than the booth + vestibules the template keeps rigid (≈35') plus seats.
    widthLim: (s) => [Math.max(45, Math.ceil(s.width || 0)), 200],
    widthDefault: (s) => stageInsideWidthFt(s),
    depthLim: HOUSE_DEPTH_LIM,
    depthDefault: PROSCENIUM_KEYS.defaults.houseDepthFt,
    legacyHalf: true,
    warning: (s, _raw, widthFt) => (widthFt < stageInsideWidthFt(s) - 1e-9 ? HOUSE_NARROW_WARNING : null),
  },
  "church-traditional@1": {
    width: { label: "Nave width", note: "Inside walls, wall to wall" },
    depth: { label: "Nave depth", note: "Platform front to the back-room wall" },
    widthLim: (s) => [Math.ceil(s.width || 0) + 16, 200],
    widthDefault: (s) => Math.max(CHURCH_TRADITIONAL_KEYS.defaults.houseWidthFt, Math.ceil(s.width || 0) + 16),
    depthLim: [20, 200],
    depthDefault: CHURCH_TRADITIONAL_KEYS.defaults.houseDepthFt,
    legacyHalf: false,
    warning: (_s, raw, widthFt) => (raw < widthFt - 1e-9 ? CHURCH_NAVE_WARNING : null),
  },
};

export function houseSpecFor(id?: string | null): HouseSpec {
  return (id && HOUSE_SPECS[id]) || HOUSE_SPECS["proscenium@1"];
}

export function houseWidthLim(s: Pick<AState, "width"> & Partial<Pick<AState, "wing">>, id?: string | null): [number, number] {
  return houseSpecFor(id).widthLim({ wing: 0, ...s });
}

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const clamp = (n: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, n));

export function houseDims(s: HouseInput, id?: string | null): { widthFt: number; depthFt: number; warning: string | null } {
  const spec = houseSpecFor(id);
  const raw = pos(s.houseWidthFt) ? s.houseWidthFt : spec.legacyHalf && pos(s.houseHalfFt) ? 2 * s.houseHalfFt : spec.widthDefault(s);
  const widthFt = clamp(raw, spec.widthLim(s));
  const depthFt = clamp(pos(s.houseDepthFt) ? s.houseDepthFt : spec.depthDefault, spec.depthLim);
  return { widthFt, depthFt, warning: spec.warning(s, raw, widthFt) };
}

/** The stretch inputs for a proscenium-family template. */
export function prosceniumDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string = "proscenium@1"): StretchDims {
  const h = houseDims(s, id);
  return { proWidthFt: s.width, wingFt: s.wing || 0, stageDepthFt: s.depth, houseWidthFt: h.widthFt, houseDepthFt: h.depthFt, pit: !!s.sys?.pit };
}

/** The stretch inputs for a church-family template: width / depth are the platform, the house fields the nave. */
export function churchDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string): StretchDims {
  const h = houseDims(s, id);
  return { proWidthFt: s.width, wingFt: 0, stageDepthFt: s.depth, houseWidthFt: h.widthFt, houseDepthFt: h.depthFt, pit: false };
}

/** The stretch inputs for any template, by its family. */
export function familyDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string): StretchDims {
  return templateEntry(id)?.family === "church" ? churchDims(s, id) : prosceniumDims(s, id);
}

export type HouseField = { key: "houseWidthFt" | "houseDepthFt"; label: string; note: string; v: number; lim: [number, number] };

/** The house / nave rows a dimension panel shows for a template; null = none. */
export function houseFields(s: HouseInput, id: string | null | undefined): { rows: HouseField[]; warning: string | null } | null {
  const spec = id ? HOUSE_SPECS[id] : undefined;
  if (!spec) return null;
  const h = houseDims(s, id);
  return {
    rows: [
      { key: "houseWidthFt", ...spec.width, v: Math.round(h.widthFt), lim: spec.widthLim(s) },
      { key: "houseDepthFt", ...spec.depth, v: Math.round(h.depthFt), lim: spec.depthLim },
    ],
    warning: h.warning,
  };
}
