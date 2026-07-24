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
  /** Proscenium opening, edge to edge (ft). Drives drape widths. */
  proWidthFt: number;
  /** Proscenium opening, floor to header (ft). Drives drape heights. */
  proHeightFt: number;
  /** Wall to wall (ft). Drives batten length and line placement. */
  stageWidthFt: number;
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

/** Adapt an estimator AState. `width` is the proscenium opening; stage width is
 *  derived as the opening plus a wing on each side. */
export function venueDimsFromEstimator(s: {
  width: number;
  ph: number;
  depth: number;
  grid: number;
  wing: number;
}): VenueDims {
  return {
    proWidthFt: s.width,
    proHeightFt: s.ph,
    stageWidthFt: s.width + 2 * s.wing,
    stageDepthFt: s.depth,
    gridHeightFt: s.grid,
  };
}

/** Adapt a lineset input record. These fields are already unambiguous. */
export function venueDimsFromLineset(inp: {
  proWidthFt: number;
  proHeightFt: number;
  stageWidthFt: number;
  stageDepthFt: number;
}): VenueDims {
  return {
    proWidthFt: inp.proWidthFt,
    proHeightFt: inp.proHeightFt,
    stageWidthFt: inp.stageWidthFt,
    stageDepthFt: inp.stageDepthFt,
  };
}
