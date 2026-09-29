import { clampDimField, type AState } from "@/app/(app)/design/quick/engine";
import { ARENA_CORNER_R, ARENA_COURT_SHARE } from "./arena.keys";
import { CHURCH_CONTEMPORARY_KEYS } from "./church-contemporary.keys";
import { CHURCH_TRADITIONAL_KEYS } from "./church-traditional.keys";
import { GYM_STAGE_KEYS } from "./gym-stage.keys";
import { templateEntry } from "./index";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import type { StretchDims } from "./types";

/**
 * House / nave size per template (#249, #255) — the typed feet, or a default.
 * Pure; safe in client components. Called without a template id every
 * function behaves exactly as #249's proscenium version.
 */
export type HouseInput = Pick<AState, "width" | "wing"> & Partial<Pick<AState, "depth" | "houseWidthFt" | "houseDepthFt" | "houseHalfFt" | "movables" | "bowlDepthFt">>;

export const HOUSE_DEPTH_LIM: [number, number] = [40, 200];
export const HOUSE_NARROW_WARNING = "The house is narrower than the stage, so its side walls slant inward.";
export const CHURCH_NAVE_WARNING = "The nave needs 8' beside the platform on each side, so the plan widens it to fit.";
export const CONTEMPORARY_NAVE_WARNING = "The nave needs 12' beside the platform on each side at its widest, so the plan widens it to fit.";
/** #255 fix: Contemporary's pointed front loops past its splays on a platform deeper than this × its width. */
export const CONTEMPORARY_PLATFORM_DEPTH_RATIO = 2.2;
export const CONTEMPORARY_PLATFORM_WARNING = "The pointed front needs a platform no deeper than 2.2 × its width, so the plan shortens it.";
export const ARENA_STAGE_WARNING = "The stage is bigger than the floor takes there, so the plan shrinks it to fit.";
export const GYM_FLOOR_WARNING = "The gym floor needs room for the stage and its side rooms, so the plan widens it to fit.";
/** #255 fix: the Gym Stage Booth's length along a side wall (feet) — the shallowest gym floor. */
export const GYM_BOOTH_SIDE_FT = 21;

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
  /** #255 fix: the deepest stage / platform the drawing takes at this width (feet), and what to say when it bites. */
  stageDepthMax?: { max: (s: HouseInput) => number; warning: string };
  /** #255: a third row after width / depth (the arena's bowl depth): its field, label, limits and default (feet). */
  extra?: { key: "bowlDepthFt"; label: string; note: string; lim: [number, number]; dflt: number };
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
  "church-contemporary@1": {
    width: { label: "Nave width", note: "Inside, at its widest" },
    depth: { label: "Nave depth", note: "Platform tip to back wall" },
    widthLim: (s) => [Math.ceil(s.width || 0) + 24, 250],
    widthDefault: (s) => Math.max(CHURCH_CONTEMPORARY_KEYS.defaults.houseWidthFt, (s.width || 0) + 24),
    depthLim: [20, 200],
    depthDefault: CHURCH_CONTEMPORARY_KEYS.defaults.houseDepthFt,
    legacyHalf: false,
    warning: (_s, raw, widthFt) => (raw < widthFt - 1e-9 ? CONTEMPORARY_NAVE_WARNING : null),
    stageDepthMax: { max: (s) => CONTEMPORARY_PLATFORM_DEPTH_RATIO * (s.width || 0), warning: CONTEMPORARY_PLATFORM_WARNING },
  },
  "gym-stage@1": {
    width: { label: "Gym floor width", note: "Inside walls, wall to wall" },
    depth: { label: "Gym floor depth", note: "Stage front to back wall" },
    // The stage, its two 6" side walls and a little of each side room (≥ 4').
    widthLim: (s) => [Math.ceil(stageInsideWidthFt(s)) + 9, 250],
    widthDefault: (s) => Math.max(GYM_STAGE_KEYS.defaults.houseWidthFt, Math.ceil(stageInsideWidthFt(s)) + 9),
    // #255 fix: never shallower than the Booth is long on a side wall (20' + its two 6" walls = 21'), so the
    // Booth fits on every wall it may move to and never overhangs the floor's corners.
    depthLim: [GYM_BOOTH_SIDE_FT, 200],
    depthDefault: GYM_STAGE_KEYS.defaults.houseDepthFt,
    legacyHalf: false,
    warning: (_s, raw, widthFt) => (raw < widthFt - 1e-9 ? GYM_FLOOR_WARNING : null),
  },
  // #255: the arena floor (the drawing's inner outline) and its seating bowl. The lower limits keep the court's share of
  // the floor clear of the 13' corners (ARENA_COURT_SHARE): 59' across, 88' along.
  "arena@1": {
    width: { label: "Floor width", note: "Arena floor, side to side" },
    depth: { label: "Floor length", note: "Arena floor, end to end" },
    widthLim: () => [59, 250],
    widthDefault: () => 90,
    depthLim: [88, 400],
    depthDefault: 134,
    legacyHalf: false,
    warning: (s) => (arenaStageFor(s).clamped ? ARENA_STAGE_WARNING : null),
    extra: { key: "bowlDepthFt", label: "Bowl depth", note: "Seating, even all round", lim: [0, 60], dflt: 15 },
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

/** #255 fix: the stage / platform depth the plan draws — the typed depth, shortened to the drawing's limit. */
export function stageDepthFor(s: HouseInput & Pick<AState, "depth">, id?: string | null): { depthFt: number; clamped: boolean } {
  const lim = houseSpecFor(id).stageDepthMax;
  const max = lim ? lim.max(s) : Infinity;
  return s.depth > max + 1e-9 ? { depthFt: max, clamped: true } : { depthFt: s.depth, clamped: false };
}

export function houseDims(s: HouseInput, id?: string | null): { widthFt: number; depthFt: number; warning: string | null } {
  const spec = houseSpecFor(id);
  const raw = pos(s.houseWidthFt) ? s.houseWidthFt : spec.legacyHalf && pos(s.houseHalfFt) ? 2 * s.houseHalfFt : spec.widthDefault(s);
  const widthFt = clamp(raw, spec.widthLim(s));
  const depthFt = clamp(pos(s.houseDepthFt) ? s.houseDepthFt : spec.depthDefault, spec.depthLim);
  const stage = spec.stageDepthMax && typeof s.depth === "number" && stageDepthFor({ ...s, depth: s.depth }, id).clamped ? spec.stageDepthMax.warning : null;
  const warning = [spec.warning(s, raw, widthFt), stage].filter(Boolean).join(" ") || null;
  return { widthFt, depthFt, warning };
}

/**
 * The stretch inputs for a proscenium-family template. #255 fix: Quick Design's Gym Stage venue maps exactly like
 * a proscenium — width = the opening, wing = return wall → stage side wall, depth = the stage; the house fields
 * are the gym floor — the same numbers its pricing reads.
 * #255 hardening: width/wing/depth are clamped to LIM here — the single read the geometry takes them through —
 * so an already-stored (or forged) 1e6/-1e6/NaN/Infinity config can't blow up a HouseSpec's own width/depth
 * limits (several derive their lower bound FROM width/wing) or the drawing's loops.
 */
export function prosceniumDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string = "proscenium@1"): StretchDims {
  const width = clampDimField("width", s.width);
  const wing = clampDimField("wing", s.wing || 0);
  const depth = clampDimField("depth", s.depth);
  const h = houseDims({ ...s, width, wing }, id);
  return { proWidthFt: width, wingFt: wing, stageDepthFt: depth, houseWidthFt: h.widthFt, houseDepthFt: h.depthFt, pit: !!s.sys?.pit, movables: s.movables ?? undefined };
}

/** The stretch inputs for a church-family template: width / depth are the platform, the house fields the nave.
 *  #255 hardening: width/depth clamped to LIM first (see prosceniumDims). */
export function churchDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string): StretchDims {
  const width = clampDimField("width", s.width);
  const depth = clampDimField("depth", s.depth);
  const c = { ...s, width, depth };
  const h = houseDims(c, id);
  return { proWidthFt: width, wingFt: 0, stageDepthFt: stageDepthFor(c, id).depthFt, houseWidthFt: h.widthFt, houseDepthFt: h.depthFt, pit: false, movables: s.movables ?? undefined };
}

/** The stretch inputs for the blackbox family (#255): the room's own width/depth fields (blackbox and Conference
 *  kinds alike). #255 hardening: clamped to LIM first — blackboxDims has no HouseSpec to fall back on, so an
 *  unclamped width/depth would otherwise flow straight into the room's own house dims. */
export function blackboxDims(s: Pick<AState, "width" | "depth"> & Partial<Pick<AState, "movables">>): StretchDims {
  const width = clampDimField("width", s.width);
  const depth = clampDimField("depth", s.depth);
  return { proWidthFt: width, wingFt: 0, stageDepthFt: 0, houseWidthFt: width, houseDepthFt: depth, pit: false, movables: s.movables ?? undefined };
}

/** #255: the arena's bowl depth (feet) — the typed value (≥ 0), else the spec's default, within its limits; 0 for a spec without one. */
const bowlOf = (s: HouseInput, spec: HouseSpec) =>
  spec.extra ? clamp(typeof s.bowlDepthFt === "number" && Number.isFinite(s.bowlDepthFt) && s.bowlDepthFt >= 0 ? s.bowlDepthFt : spec.extra.dflt, spec.extra.lim) : 0;

/** A finite number ≥ 0, else 0. */
const nonNeg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);

/**
 * #255: the arena's end stage as the plan draws it (feet) — its typed width / depth (junk = 0), shrunk to fit the
 * floor where it sits: along its edge no longer than that edge's straight run (it never overhangs the round corners),
 * and no deeper than half the floor across it. `clamped` when either bit.
 */
export function arenaStageFor(s: HouseInput): { alongFt: number; depthFt: number; clamped: boolean } {
  const spec = HOUSE_SPECS["arena@1"];
  const w = clamp(pos(s.houseWidthFt) ? s.houseWidthFt : spec.widthDefault(s), spec.widthLim(s));
  const l = clamp(pos(s.houseDepthFt) ? s.houseDepthFt : spec.depthDefault, spec.depthLim);
  const wall = s.movables?.stage?.wall;
  const side = wall === "floorLeft" || wall === "floorRight";
  const r = (2 * ARENA_CORNER_R) / 12;
  const runFt = Math.max(0, (side ? l : w) - r), acrossFt = (side ? w : l) / 2;
  const along = nonNeg(s.width), depth = nonNeg(s.depth);
  return { alongFt: Math.min(along, runFt), depthFt: Math.min(depth, acrossFt), clamped: along > runFt + 1e-9 || depth > acrossFt + 1e-9 };
}

/**
 * The stretch inputs for the arena family (#255): floor, bowl, and the end stage's typed size (a code-sized movable,
 * fitted to the floor — arenaStageFor).
 * The floor's straight runs are the floor less a corner radius each end; the court keeps its share of the floor. Every
 * span is clamped ≥ 0 and the court never past the straight run, so no input (typed, stored or junk) folds the plan.
 */
export function arenaDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string): StretchDims {
  const spec = houseSpecFor(id);
  const h = houseDims(s, id);
  const r = ARENA_CORNER_R / 12;
  const runW = Math.max(0, h.widthFt - 2 * r), runL = Math.max(0, h.depthFt - 2 * r);
  return {
    proWidthFt: Math.min(runW, Math.max(0, h.widthFt * ARENA_COURT_SHARE.x)),
    wingFt: bowlOf(s, spec),
    stageDepthFt: Math.min(runL, Math.max(0, h.depthFt * ARENA_COURT_SHARE.y)),
    houseWidthFt: runW,
    houseDepthFt: runL,
    pit: false,
    movables: s.movables ?? undefined,
    movableSizes: { stage: (({ alongFt, depthFt }) => ({ alongFt, depthFt }))(arenaStageFor(s)) },
  };
}

/** The stretch inputs for any template, by its family. */
export function familyDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string): StretchDims {
  const f = templateEntry(id)?.family;
  return f === "church" ? churchDims(s, id) : f === "blackbox" ? blackboxDims(s) : f === "arena" ? arenaDims(s, id) : prosceniumDims(s, id);
}

export type HouseField = { key: "houseWidthFt" | "houseDepthFt" | "bowlDepthFt"; label: string; note: string; v: number; lim: [number, number] };

/** The house / nave rows a dimension panel shows for a template; null = none. */
export function houseFields(s: HouseInput, id: string | null | undefined): { rows: HouseField[]; warning: string | null } | null {
  const spec = id ? HOUSE_SPECS[id] : undefined;
  if (!spec) return null;
  const h = houseDims(s, id);
  return {
    rows: [
      { key: "houseWidthFt", ...spec.width, v: Math.round(h.widthFt), lim: spec.widthLim(s) },
      { key: "houseDepthFt", ...spec.depth, v: Math.round(h.depthFt), lim: spec.depthLim },
      ...(spec.extra ? [{ key: spec.extra.key, label: spec.extra.label, note: spec.extra.note, v: Math.round(bowlOf(s, spec)), lim: spec.extra.lim }] : []),
    ],
    warning: h.warning,
  };
}

/**
 * A saved config's house fields (houseWidthFt / houseDepthFt / bowlDepthFt), clamped to the effective
 * template's own limits (#255 hardening, save time) — houseDims/bowlOf already re-derive safely from a
 * junk stored value at READ time (a non-finite or negative one falls back to the spec's default, same as
 * here), but this keeps a forged huge value from ever being written. Only touches keys `cfg` carries;
 * `id` unresolved (or a spec without the `extra` row) leaves `bowlDepthFt` alone.
 */
export function clampHouseFieldsFor<T extends Partial<HouseInput>>(cfg: T, id: string | null | undefined): T {
  const spec = houseSpecFor(id);
  // widthLim reads width/wing (a missing width/wing — a partial Scope patch — falls back to 0, same as every
  // HouseSpec.widthLim implementation's own `|| 0`).
  const dims: HouseInput = { width: cfg.width ?? 0, wing: cfg.wing ?? 0 };
  const out: Record<string, unknown> = { ...cfg };
  if ("houseWidthFt" in cfg) out.houseWidthFt = pos(cfg.houseWidthFt) ? clamp(cfg.houseWidthFt as number, spec.widthLim(dims)) : null;
  if ("houseDepthFt" in cfg) out.houseDepthFt = pos(cfg.houseDepthFt) ? clamp(cfg.houseDepthFt as number, spec.depthLim) : null;
  if (spec.extra && "bowlDepthFt" in cfg) {
    const v = cfg.bowlDepthFt;
    out.bowlDepthFt = typeof v === "number" && Number.isFinite(v) && v >= 0 ? clamp(v, spec.extra.lim) : null;
  }
  return out as T;
}
