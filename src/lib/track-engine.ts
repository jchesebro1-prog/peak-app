import {
  TRACK_OPERATION_LABELS,
  hangerSpacingFor,
  isCordOperated,
  mountingRole,
  seriesSticks,
  type TrackMounting,
  type TrackOperation,
  type TrackRole,
  type TrackSeries,
  type TrackStick,
} from "@/lib/track-series";
import { ceilAlong, legHangingPoints, legPieces, pathErrors, pathLengthFt, resolvePath, trackLegs, type TrackSegment } from "@/lib/track-path";

/**
 * Track quantity engine (#274 §2). Pure — no prices, no catalog access: a
 * TrackConfig + its series → how many of each role. Pricing (Phase B,
 * estimator/track-bom.ts) resolves each role to the series' catalog part.
 *
 * Rules per track, then × qty:
 *   L         = runFt + (bi-parting ? series.overlapFt : 0)
 *   legs      (#291) 2 for a lapped bi-part (bi-parting on a series with an
 *             overlap — ADC builds it as two legs lapped at center by lap
 *             clamps; a stick never crosses the center and the legs are never
 *             spliced to each other), else 1; leg = L / legs
 *   straight  per leg n = ceil(leg / longest stick); each piece the shortest
 *             stick ≥ leg / n; sticks = legs × n; splices = legs × (n − 1)
 *   curved    (#369) a path: each leg is cut into its segments — straight
 *             pieces buy sticks (the shortest that covers), arcs buy
 *             ceil(arc / curvedSectionFt) sections; splices = pieces − 1 per
 *             leg; hanging points per leg = legHangingPoints (every joint
 *             supported). A pre-#369 curve is one arc and prices as before:
 *             per leg n = ceil(leg / curvedSectionFt); sections = legs × n,
 *             splices = legs × (n − 1); refused without curvedSectionFt, or
 *             radius < minRadiusFt
 *   carriers  ceil(runFt × 12 / carrierSpacingIn); masters 2 (bi-parting) or
 *             1, each replacing one ordinary carrier (floor 0)
 *   end stops 2 (Oct 15 #45: walk-along — 2 per curtain half, so 4 on a
 *             walk-along bi-part — as walk-along end stops when mapped)
 *   mounting  legs × (ceil(leg / spacing) + 1) batten clamps or ceiling
 *             hangers — hanging points per leg, both ends supported; spacing =
 *             the line's override, else (Oct 15 #45) the series' ceiling or
 *             batten spacing, else its shared hangerSpacingFt
 *   cord      (bi-parting, one-way) 1 live pulley, 1 dead pulley, 1 floor
 *             block, operating line ceil(2L + 2·trim + series.lineAllowanceFt)
 *             ft (trim default 20)
 *   optional  (#291, only when the series maps the role) ceiling splice
 *             replaces the splice on ceiling mounting; pipe clamp = one per
 *             batten hanging point; lap clamp = 2 per bi-parting batten track
 *             (series with an overlap); one-way dead-end pulley replaces the
 *             dead pulley on one-way; (Oct 15 #45) center pipe supports on a
 *             batten = ceil(L / series.centerSupportEveryFt) − 1, only when the
 *             series sets that number
 *   walk-along no pulleys, floor block or line. Oct 15 #45: a walk-along
 *             bi-part (`walkAlongBipart`) is built like a bi-parting track —
 *             the overlap, two lapped legs, 2 masters, lap clamps — with
 *             no cord
 */

export type TrackConfig = {
  seriesId: string;
  operation: TrackOperation;
  /** Straight: run length. Curved: arc length. ft. */
  runFt: number;
  curved: boolean;
  /** Curved only, ft. */
  radiusFt?: number;
  /**
   * #369 — curved only: the track's shape, 1–12 segments in order. When set it
   * IS the track: its length is the run (runFt is written to match) and it is
   * priced per segment. Absent on a curved track = a pre-#369 single arc of
   * runFt at radiusFt (resolvePath).
   */
  path?: TrackSegment[];
  mounting: TrackMounting;
  /** Pulley-to-floor drop, cord-operated only (default 20), ft. */
  trimFt?: number;
  /** Identical tracks. */
  qty: number;
  /** Overrides the series default, in. */
  carrierSpacingIn?: number;
  /** Overrides the series default, ft. */
  hangerSpacingFt?: number;
  /** Oct 15 #45 — walk-along only: two curtain halves walked apart (a walk-along bi-part). */
  walkAlongBipart?: boolean;
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

/** Oct 15 #45 — a track whose two halves part at center: bi-parting, or a walk-along bi-part. */
export function partsAtCenter(config: Pick<TrackConfig, "operation" | "walkAlongBipart">): boolean {
  return config.operation === "biparting" || (config.operation === "walkalong" && config.walkAlongBipart === true);
}

/** Track length for one track: the run plus the bi-parting overlap. */
export function trackLengthFt(config: Pick<TrackConfig, "runFt" | "operation" | "walkAlongBipart">, series: Pick<TrackSeries, "overlapFt">): number {
  return config.runFt + (partsAtCenter(config) ? series.overlapFt || 0 : 0);
}

/** An override when it's a positive finite number, else the series default. */
function spacing(override: number | undefined, fallback: number): number {
  return typeof override === "number" && Number.isFinite(override) && override > 0 ? override : fallback;
}

/** #369 — a curved track's pieces, splices and hanging points, leg by leg along its path. */
function curvedPieces(path: TrackSegment[], runFt: number, lapOverlapFt: number, series: TrackSeries, hangerSpacingFt: number): { pieces: TrackRow[]; splices: number; mounts: number } {
  const sticks = seriesSticks(series);
  const bySku = new Map<string, TrackRow>();
  let curved = 0;
  let splices = 0;
  let mounts = 0;
  for (const leg of trackLegs(runFt, lapOverlapFt)) {
    let n = 0;
    for (const p of legPieces(path, leg)) {
      if (p.kind === "arc") {
        const k = ceilAlong(p.lengthFt, series.curvedSectionFt!);
        curved += k;
        n += k;
        continue;
      }
      const longest = sticks[sticks.length - 1];
      const k = ceilAlong(p.lengthFt, longest.lengthFt);
      const stick = sticks.find((s) => s.lengthFt >= p.lengthFt / k - 1e-9) ?? longest;
      const row = bySku.get(stick.sku);
      if (row) row.qty += k;
      else bySku.set(stick.sku, { role: "track", qty: k, sku: stick.sku, lengthFt: stick.lengthFt });
      n += k;
    }
    splices += Math.max(0, n - 1);
    mounts += legHangingPoints(path, leg, hangerSpacingFt).length;
  }
  const pieces = [...bySku.values()];
  if (curved > 0) pieces.push({ role: "curved", qty: curved });
  return { pieces, splices, mounts };
}

export function trackQuantities(config: TrackConfig, series: TrackSeries): TrackResult {
  const errors: string[] = [];
  // #369: a curved track with a path is its segments, and its run is their length.
  const segmented = config.curved && Array.isArray(config.path);
  const run = segmented ? pathLengthFt(config.path!) : config.runFt;
  const qty = config.qty;

  if (!OPERATIONS.has(config.operation)) errors.push("Pick how the track operates.");
  if (config.mounting !== "batten" && config.mounting !== "ceiling") errors.push("Pick a mounting.");
  if (!segmented) {
    if (!(typeof run === "number" && Number.isFinite(run) && run > 0)) errors.push("Enter the run length.");
    else if (run > MAX_RUN_FT) errors.push(`A run is at most ${MAX_RUN_FT}'.`);
  }
  if (!(Number.isInteger(qty) && qty >= 1 && qty <= MAX_TRACK_QTY)) errors.push(`Quantity is a whole number from 1 to ${MAX_TRACK_QTY}.`);

  const cord = isCordOperated(config.operation);
  const trim = config.trimFt ?? DEFAULT_TRIM_FT;
  if (cord && !(Number.isFinite(trim) && trim >= 0 && trim <= MAX_TRIM_FT)) errors.push(`Trim is 0 to ${MAX_TRIM_FT}'.`);

  if (segmented) {
    errors.push(
      ...pathErrors(config.path!, { name: series.name, curvedSectionFt: series.curvedSectionFt, minRadiusFt: series.minRadiusFt, hasSticks: seriesSticks(series).length > 0 }, MAX_RUN_FT)
    );
  } else if (config.curved) {
    if (!(series.curvedSectionFt && series.curvedSectionFt > 0)) errors.push(`${series.name || "This series"} has no curved track.`);
    const radius = config.radiusFt;
    if (!(typeof radius === "number" && Number.isFinite(radius) && radius > 0)) errors.push("Enter the curve radius.");
    else if (series.minRadiusFt && radius < series.minRadiusFt)
      errors.push(`${series.name || "This series"} bends to a ${series.minRadiusFt}' radius at the tightest — ${radius}' is too tight.`);
  } else if (!seriesSticks(series).length) {
    errors.push(`${series.name || "This series"} has no stick length — set it in Estimating Rules → Track series.`);
  }

  if (errors.length) return { rows: [], errors };

  const bipart = partsAtCenter(config);
  const L = run + (bipart ? series.overlapFt || 0 : 0);
  // #291: a lapped bi-part is two legs that meet at center; neither a stick nor a splice crosses it.
  const lap = bipart && series.overlapFt > 0;
  const legs = lap ? 2 : 1;
  const leg = L / legs;
  const mapped = (role: TrackRole) => !!series.parts[role]?.sku;
  const carrierSpacing = spacing(config.carrierSpacingIn, series.carrierSpacingIn);
  const hangerSpacing = spacing(config.hangerSpacingFt, hangerSpacingFor(series, config.mounting));
  let pieces: TrackRow[];
  let splices: number;
  let mounts: number;
  const path = resolvePath(config);
  if (path && path.length) {
    ({ pieces, splices, mounts } = curvedPieces(path, run, lap ? series.overlapFt : 0, series, hangerSpacing));
  } else {
    const sticks = seriesSticks(series);
    const nLeg = ceilSafe(leg / sticks[sticks.length - 1].lengthFt);
    const stick: TrackStick = sticks.find((s) => s.lengthFt >= leg / nLeg - 1e-9) ?? sticks[sticks.length - 1];
    pieces = [{ role: "track", qty: legs * nLeg, sku: stick.sku, lengthFt: stick.lengthFt }];
    splices = legs * Math.max(0, nLeg - 1);
    mounts = legs * (ceilSafe(leg / hangerSpacing) + 1);
  }
  // #369: a path's length carries the 4-decimal sweep slack (PATH_LEN_EPS_FT); a straight track keeps the strict rule
  const onPath = !!(path && path.length);
  const allCarriers = onPath ? ceilAlong(run, carrierSpacing / 12) : ceilSafe((run * 12) / carrierSpacing);
  const masters = bipart ? 2 : 1;
  const carriers = Math.max(0, allCarriers - masters);
  const batten = config.mounting === "batten";

  const per: TrackRow[] = [
    ...pieces,
    { role: !batten && mapped("ceilingSplice") ? "ceilingSplice" : "splice", qty: splices },
    { role: "carrier", qty: carriers },
    { role: "masterCarrier", qty: masters },
    // Oct 15 #45: a walk-along curtain stops at both ends of each half (4 on a walk-along bi-part).
    config.operation === "walkalong"
      ? { role: mapped("walkAlongEndStop") ? "walkAlongEndStop" : "endStop", qty: 2 * (bipart ? 2 : 1) }
      : { role: "endStop", qty: 2 },
  ];
  if (bipart && batten && series.overlapFt > 0 && mapped("lapClamp")) per.push({ role: "lapClamp", qty: 2 });
  per.push({ role: mountingRole(config.mounting), qty: mounts });
  if (batten && mapped("pipeClamp")) per.push({ role: "pipeClamp", qty: mounts });
  const every = series.centerSupportEveryFt;
  if (batten && mapped("centerPipeSupport") && typeof every === "number" && every > 0) per.push({ role: "centerPipeSupport", qty: Math.max(0, (onPath ? ceilAlong(L, every) : ceilSafe(L / every)) - 1) });
  if (cord) {
    per.push(
      { role: "livePulley", qty: 1 },
      { role: config.operation === "oneway" && mapped("deadPulleyOneWay") ? "deadPulleyOneWay" : "deadPulley", qty: 1 },
      { role: "floorBlock", qty: 1 },
      { role: "operatingLine", qty: onPath ? ceilAlong(2 * L + 2 * trim + (series.lineAllowanceFt || 0), 1) : ceilSafe(2 * L + 2 * trim + (series.lineAllowanceFt || 0)) }
    );
  }
  return { rows: per.filter((r) => r.qty > 0).map((r) => ({ ...r, qty: r.qty * qty })), errors: [] };
}
