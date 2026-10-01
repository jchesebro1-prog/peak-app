import {
  TRACK_OPERATION_LABELS,
  isCordOperated,
  mountingRole,
  seriesSticks,
  type TrackMounting,
  type TrackOperation,
  type TrackRole,
  type TrackSeries,
  type TrackStick,
} from "@/lib/track-series";

/**
 * Track quantity engine (#274 §2). Pure — no prices, no catalog access: a
 * TrackConfig + its series → how many of each role. Pricing (Phase B,
 * estimator/track-bom.ts) resolves each role to the series' catalog part.
 *
 * Rules per track, then × qty:
 *   L         = runFt + (bi-parting ? series.overlapFt : 0)
 *   straight  n = ceil(L / longest stick); each piece the shortest stick
 *             ≥ L / n; splices = n − 1
 *   curved    sections = ceil(L / curvedSectionFt), splices = sections − 1;
 *             refused without curvedSectionFt, or radius < minRadiusFt
 *   carriers  ceil(runFt × 12 / carrierSpacingIn); masters 2 (bi-parting) or
 *             1, each replacing one ordinary carrier (floor 0)
 *   end stops 2
 *   mounting  ceil(L / hangerSpacingFt) + 1 batten clamps or ceiling hangers
 *   cord      (bi-parting, one-way) 1 live pulley, 1 dead pulley, 1 floor
 *             block, operating line ceil(2L + 2·trim + series.lineAllowanceFt)
 *             ft (trim default 20)
 *   optional  (#291, only when the series maps the role) ceiling splice
 *             replaces the splice on ceiling mounting; pipe clamp = one per
 *             batten hanging point; lap clamp = 2 per bi-parting batten track
 *             (series with an overlap); one-way dead-end pulley replaces the
 *             dead pulley on one-way
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

/** sku/lengthFt: the straight stick the engine chose (#291) — set on the "track" row only. */
export type TrackRow = { role: TrackRole; qty: number; sku?: string; lengthFt?: number };
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
  } else if (!seriesSticks(series).length) {
    errors.push(`${series.name || "This series"} has no stick length — set it in Estimating Rules → Track series.`);
  }

  if (errors.length) return { rows: [], errors };

  const L = trackLengthFt(config, series);
  const mapped = (role: TrackRole) => !!series.parts[role]?.sku;
  let piece: TrackRow;
  if (config.curved) {
    piece = { role: "curved", qty: ceilSafe(L / series.curvedSectionFt!) };
  } else {
    const sticks = seriesSticks(series);
    const n = ceilSafe(L / sticks[sticks.length - 1].lengthFt);
    const stick: TrackStick = sticks.find((s) => s.lengthFt >= L / n - 1e-9) ?? sticks[sticks.length - 1];
    piece = { role: "track", qty: n, sku: stick.sku, lengthFt: stick.lengthFt };
  }
  const splices = Math.max(0, piece.qty - 1);
  const carrierSpacing = spacing(config.carrierSpacingIn, series.carrierSpacingIn);
  const hangerSpacing = spacing(config.hangerSpacingFt, series.hangerSpacingFt);
  const allCarriers = ceilSafe((run * 12) / carrierSpacing);
  const masters = config.operation === "biparting" ? 2 : 1;
  const carriers = Math.max(0, allCarriers - masters);
  const mounts = ceilSafe(L / hangerSpacing) + 1;
  const batten = config.mounting === "batten";

  const per: TrackRow[] = [
    piece,
    { role: !batten && mapped("ceilingSplice") ? "ceilingSplice" : "splice", qty: splices },
    { role: "carrier", qty: carriers },
    { role: "masterCarrier", qty: masters },
    { role: "endStop", qty: 2 },
  ];
  if (config.operation === "biparting" && batten && series.overlapFt > 0 && mapped("lapClamp")) per.push({ role: "lapClamp", qty: 2 });
  per.push({ role: mountingRole(config.mounting), qty: mounts });
  if (batten && mapped("pipeClamp")) per.push({ role: "pipeClamp", qty: mounts });
  if (cord) {
    per.push(
      { role: "livePulley", qty: 1 },
      { role: config.operation === "oneway" && mapped("deadPulleyOneWay") ? "deadPulleyOneWay" : "deadPulley", qty: 1 },
      { role: "floorBlock", qty: 1 },
      { role: "operatingLine", qty: ceilSafe(2 * L + 2 * trim + (series.lineAllowanceFt || 0)) }
    );
  }
  return { rows: per.filter((r) => r.qty > 0).map((r) => ({ ...r, qty: r.qty * qty })), errors: [] };
}
