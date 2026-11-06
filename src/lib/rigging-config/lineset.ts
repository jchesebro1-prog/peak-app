import type { LinesetConfig, LinesetRole, LinesetType } from "./types";
import { RIGGING_LIMITS } from "./types";

/**
 * #373 — what one configured lineset buys. The lines-per-set default, hand line
 * and termination counts follow Quick Design's counterweight equation
 * (design/quick/engine.ts). Cable is actual routing, not that equation's 2G + W:
 * up to the loft block, across on average half the width, plus an allowance.
 */
export type LinesetRow = { role: LinesetRole; qty: number };
export type LinesetResult = { rows: LinesetRow[]; errors: string[]; liftLines: number };

export const MAX_SETS = 300;
export const MAX_LINES_PER_SET = 20;
export const MAX_LINESET_DIM_FT = 500;

const ceilSafe = (x: number) => Math.ceil(x - 1e-9);
const inRange = (n: unknown, max: number) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= max;

export function defaultLinesPerSet(widthFt: number): number {
  return Math.min(MAX_LINES_PER_SET, Math.max(1, Math.floor(widthFt / 10)));
}

export function linesetQuantities(config: LinesetConfig, type: LinesetType): LinesetResult {
  const errors: string[] = [];
  const { sets, widthFt: w, gridHeightFt: g } = config;
  if (!(Number.isInteger(sets) && sets >= 1 && sets <= MAX_SETS)) errors.push(`Sets is a whole number from 1 to ${MAX_SETS}.`);
  if (!inRange(w, MAX_LINESET_DIM_FT)) errors.push(`Width is above 0 and at most ${MAX_LINESET_DIM_FT}'.`);
  if (!inRange(g, MAX_LINESET_DIM_FT)) errors.push(`Grid height is above 0 and at most ${MAX_LINESET_DIM_FT}'.`);
  const lines = config.linesPerSet ?? (inRange(w, MAX_LINESET_DIM_FT) ? defaultLinesPerSet(w) : 1);
  if (!(Number.isInteger(lines) && lines >= 1 && lines <= MAX_LINES_PER_SET)) errors.push(`Lift lines per set is a whole number from 1 to ${MAX_LINES_PER_SET}.`);
  const allowance = config.allowanceFt ?? type.allowanceFt;
  if (!(typeof allowance === "number" && Number.isFinite(allowance) && allowance >= 0 && allowance <= RIGGING_LIMITS.allowanceFt)) errors.push(`Cable allowance is 0 to ${RIGGING_LIMITS.allowanceFt}'.`);
  if (errors.length) return { rows: [], errors, liftLines: 0 };

  const liftLines = sets * lines;
  return {
    rows: [
      { role: "cable", qty: ceilSafe(liftLines * (g + w / 2 + allowance)) },
      { role: "handLine", qty: ceilSafe(sets * 2 * g) },
      { role: "termination", qty: liftLines * 2 },
      { role: "chainWrap", qty: liftLines },
    ],
    errors: [],
    liftLines,
  };
}
