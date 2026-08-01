/**
 * The canonical venue dimension block, shared by the lineset builder and the
 * design estimator so either can consume the other's saved records without a
 * migration (spec §3.1).
 *
 * There is deliberately NO bare `width` field. The estimator's `AState.width`
 * is the PROSCENIUM opening; the lineset builder's `stageWidthFt` is
 * WALL-TO-WALL stage. They are different numbers and mixing them silently
 * sizes every drape wrong.
 */
export type VenueDims = {
  /** Proscenium opening, edge to edge (ft). Drives drape widths AND, via
   *  battenLenFt(), every batten / pipe length. */
  proWidthFt: number;
  /** Proscenium opening, floor to header (ft). Drives drape heights. */
  proHeightFt: number;
  /** Wall to wall (ft). Estimator-only: it is the opening plus a wing each
   *  side. Optional because the lineset builder no longer collects it (punch
   *  #50); nothing in the goods or batten math reads it. */
  stageWidthFt?: number;
  /** Plaster line to back wall (ft). */
  stageDepthFt: number;
  /** Floor to grid steel (ft). Estimator-only today; the cyc is sized off PH. */
  gridHeightFt?: number;
};

export const DEFAULT_VENUE_DIMS: VenueDims = {
  proWidthFt: 40,
  proHeightFt: 20,
  stageWidthFt: 50,
  stageDepthFt: 30,
};

/* --------------------------- batten / pipe length --------------------------- */

/** Batten overhang past the proscenium opening, on EACH side (ft). */
export const BATTEN_OVERHANG_FT = 2;

/**
 * How long is the pipe? Proscenium width plus 2 ft of overhang on each side,
 * 4 ft total (Jeff, 2026-07-27, punch #50: "It is Pro Width, plus 2ft on each
 * side, so 4ft total. Track that into the estimator and anywhere else where
 * pipe width is calculated.").
 *
 * THIS IS THE ONLY DEFINITION. Every consumer (lineset weights, the schedule's
 * distribution allowance, the estimator's rigging pipe footage) calls this, so
 * the rule changes in exactly one edit. A per-line manual override still wins
 * over it, see WeightLine.batten in steel.ts.
 */
export function battenLenFt(proWidthFt: number): number {
  return Math.max(0, proWidthFt) + 2 * BATTEN_OVERHANG_FT;
}

/**
 * Adapt an estimator AState. `width` is the proscenium opening; stage width is
 * derived as the opening plus a wing on each side.
 *
 * CAVEAT (open question for Jeff, punch #50/#66): `AState.width` is only the
 * proscenium opening when the venue kind is "proscenium". For church / flat /
 * blackbox / arena it is wall to wall, and for gym it is sideline to sideline
 * (DIMSCHEMA in quick/engine.ts). Those kinds therefore size drapes off a
 * number that is wider than any opening. That `width -> proWidthFt` mapping
 * is UNCHANGED here on purpose (fixing it needs Jeff to say what a black
 * box's "drape width" is, and it is accepted, logged behavior — #66) — do
 * NOT branch it on venue kind.
 *
 * The WING double-count (#66, fixed here) is a separate bug from the above:
 * `wing` is "offstage, each side" (DIMSCHEMA), so `width + 2*wing` is only
 * correct when `width` is a true proscenium OPENING that the wings sit
 * outside of. For every other venue kind `width` is ALREADY wall-to-wall
 * (see the caveat above — it is the full room/floor measurement, wings
 * included, because there is no narrower opening carving a smaller area out
 * of it), so adding `2*wing` on top double-counts space the source
 * measurement already contains. `pipeLenFt` in quick/engine.ts already draws
 * this same distinction for the batten-overhang rule ("only adds the 4 ft
 * overhang for a real proscenium" — the sibling comment this one used to
 * reference); `stageWidthFt` never got the matching guard. `proscenium` is a
 * plain boolean, not `VenueKind`, so this module — imported BY
 * quick/engine.ts — never has to import VenueKind back and risk a cycle.
 */
export function venueDimsFromEstimator(s: {
  width: number;
  ph: number;
  depth: number;
  grid: number;
  wing: number;
  /** True only for a real proscenium house, where `width` is the opening and
   *  the wings sit outside it. Every other venue kind's `width` is already
   *  wall-to-wall (see caveat above), so `wing` must NOT be added again. */
  proscenium: boolean;
}): VenueDims {
  return {
    proWidthFt: s.width,
    proHeightFt: s.ph,
    stageWidthFt: s.width + (s.proscenium ? 2 * s.wing : 0),
    stageDepthFt: s.depth,
    gridHeightFt: s.grid,
  };
}

/** Adapt a lineset input record. These fields are already unambiguous.
 *  `stageWidthFt` is optional: the builder stopped collecting it (punch #50),
 *  but an older record that still carries one passes straight through. */
export function venueDimsFromLineset(inp: {
  proWidthFt: number;
  proHeightFt: number;
  stageWidthFt?: number;
  stageDepthFt: number;
}): VenueDims {
  return {
    proWidthFt: inp.proWidthFt,
    proHeightFt: inp.proHeightFt,
    stageWidthFt: inp.stageWidthFt,
    stageDepthFt: inp.stageDepthFt,
  };
}
