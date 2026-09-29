import {
  TRACK_OPERATION_LABELS,
  isCordOperated,
  mountingRole,
  type TrackMounting,
  type TrackOperation,
  type TrackRole,
  type TrackSeries,
} from "@/lib/track-series";

/**
 * Track quantity engine (#274 §2). Pure — no prices, no catalog access: a
 * TrackConfig + its series → how many of each role. Pricing (Phase B,
 * estimator/track-bom.ts) resolves each role to the series' catalog part.
 *
 * Rules per track, then × qty:
 *   L         = runFt + (bi-parting ? series.overlapFt : 0)
 *   straight  sticks = ceil(L / stickLengthFt), splices = sticks − 1
 *   curved    sections = ceil(L / curvedSectionFt), splices = sections − 1;
 *             refused without curvedSectionFt, or radius < minRadiusFt
 *   carriers  ceil(runFt × 12 / carrierSpacingIn); masters 2 (bi-parting) or
 *             1, each replacing one ordinary carrier (floor 0)
 *   end stops 2
 *   mounting  ceil(L / hangerSpacingFt) + 1 batten clamps or ceiling hangers
 *   cord      (bi-parting, one-way) 1 live pulley, 1 dead pulley, 1 floor
 *             block, operating line ceil(2L + 2·trim) ft (trim default 20)
 *   walk-along no pulleys, floor block or line
 */

export type TrackConfig = {
  seriesId: string;
  operation: TrackOperation;
  /** Straight: run length. Curved: arc length. ft. */
  runFt: number;
  curved: boolean;
  /** Curved only, ft. */
  radiusFt?: number;
  mounting: TrackMounting;
  /** Pulley-to-floor drop, cord-operated only (default 20), ft. */
  trimFt?: number;
  /** Identical tracks. */
  qty: number;
  /** Overrides the series default, in. */
  carrierSpacingIn?: number;
  /** Overrides the series default, ft. */
  hangerSpacingFt?: number;
  /** Optional name, e.g. "Main drape track". */
  label?: string;
};

export type TrackRow = { role: TrackRole; qty: number };
export type TrackResult = { rows: TrackRow[]; errors: string[] };

export const DEFAULT_TRIM_FT = 20;
export const MAX_RUN_FT = 1000;
export const MAX_TRACK_QTY = 100;
export const MAX_TRIM_FT = 200;

/** ceil that forgives float noise at exact multiples (30.3 / 10.1 → 3, not 4). */
function ceilSafe(x: number): number {
  return Math.ceil(x - 1e-9);
}

const OPERATIONS: ReadonlySet<string> = new Set(Object.keys(TRACK_OPERATION_LABELS));

/** Track length for one track: the run plus the bi-parting overlap. */
export function trackLengthFt(config: Pick<TrackConfig, "runFt" | "operation">, series: Pick<TrackSeries, "overlapFt">): number {
  return config.runFt + (config.operation === "biparting" ? series.overlapFt || 0 : 0);
}

/** An override when it's a positive finite number, else the series default. */
function spacing(override: number | undefined, fallback: number): number {
  return typeof override === "number" && Number.isFinite(override) && override > 0 ? override : fallback;
}

export function trackQuantities(config: TrackConfig, series: TrackSeries): TrackResult {
  const errors: string[] = [];
  const run = config.runFt;
  const qty = config.qty;

  if (!OPERATIONS.has(config.operation)) errors.push("Pick how the track operates.");
  if (config.mounting !== "batten" && config.mounting !== "ceiling") errors.push("Pick a mounting.");
  if (!(typeof run === "number" && Number.isFinite(run) && run > 0)) errors.push("Enter the run length.");
  else if (run > MAX_RUN_FT) errors.push(`A run is at most ${MAX_RUN_FT}'.`);
  if (!(Number.isInteger(qty) && qty >= 1 && qty <= MAX_TRACK_QTY)) errors.push(`Quantity is a whole number from 1 to ${MAX_TRACK_QTY}.`);

  const cord = isCordOperated(config.operation);
  const trim = config.trimFt ?? DEFAULT_TRIM_FT;
  if (cord && !(Number.isFinite(trim) && trim >= 0 && trim <= MAX_TRIM_FT)) errors.push(`Trim is 0 to ${MAX_TRIM_FT}'.`);

  if (config.curved) {
    if (!(series.curvedSectionFt && series.curvedSectionFt > 0)) errors.push(`${series.name || "This series"} has no curved track.`);
    const radius = config.radiusFt;
    if (!(typeof radius === "number" && Number.isFinite(radius) && radius > 0)) errors.push("Enter the curve radius.");
    else if (series.minRadiusFt && radius < series.minRadiusFt)
      errors.push(`${series.name || "This series"} bends to a ${series.minRadiusFt}' radius at the tightest — ${radius}' is too tight.`);
  } else if (!(series.stickLengthFt > 0)) {
    errors.push(`${series.name || "This series"} has no stick length — set it in Estimating Rules → Track series.`);
  }

  if (errors.length) return { rows: [], errors };

  const L = trackLengthFt(config, series);
  const pieces = config.curved ? ceilSafe(L / series.curvedSectionFt!) : ceilSafe(L / series.stickLengthFt);
  const splices = Math.max(0, pieces - 1);
  const carrierSpacing = spacing(config.carrierSpacingIn, series.carrierSpacingIn);
  const hangerSpacing = spacing(config.hangerSpacingFt, series.hangerSpacingFt);
  const allCarriers = ceilSafe((run * 12) / carrierSpacing);
  const masters = config.operation === "biparting" ? 2 : 1;
  const carriers = Math.max(0, allCarriers - masters);
  const mounts = ceilSafe(L / hangerSpacing) + 1;

  const per: TrackRow[] = [
    { role: config.curved ? "curved" : "track", qty: pieces },
    { role: "splice", qty: splices },
    { role: "carrier", qty: carriers },
    { role: "masterCarrier", qty: masters },
    { role: "endStop", qty: 2 },
    { role: mountingRole(config.mounting), qty: mounts },
  ];
  if (cord) {
    per.push(
      { role: "livePulley", qty: 1 },
      { role: "deadPulley", qty: 1 },
      { role: "floorBlock", qty: 1 },
      { role: "operatingLine", qty: ceilSafe(2 * L + 2 * trim) }
    );
  }
  return { rows: per.filter((r) => r.qty > 0).map((r) => ({ role: r.role, qty: r.qty * qty })), errors: [] };
}
