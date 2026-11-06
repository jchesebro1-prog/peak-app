import { MAX_RUN_FT, MAX_TRACK_QTY } from "@/lib/track-engine";
import { PIPE_TYPES_HOME, type PipeConfig, type PipeType } from "./types";

/** #373 — how many of each pipe role one configuration buys. Pure; pricing is estimator/rigging-bom.ts. */
export type PipeRole = "stick" | "splice" | "clamp";
export type PipeRow = { role: PipeRole; qty: number; sku?: string; lengthFt?: number };
export type PipeResult = { rows: PipeRow[]; errors: string[] };

const ceilSafe = (x: number) => Math.ceil(x - 1e-9);

export function pipeQuantities(config: PipeConfig, type: PipeType): PipeResult {
  const errors: string[] = [];
  const { runFt: run, qty } = config;
  const spacing = config.hangerSpacingFt ?? type.hangerSpacingFt;
  if (!(typeof run === "number" && Number.isFinite(run) && run > 0)) errors.push("Enter the run length.");
  else if (run > MAX_RUN_FT) errors.push(`A run is at most ${MAX_RUN_FT}'.`);
  if (!(Number.isInteger(qty) && qty >= 1 && qty <= MAX_TRACK_QTY)) errors.push(`Quantity is a whole number from 1 to ${MAX_TRACK_QTY}.`);
  if (!(typeof spacing === "number" && Number.isFinite(spacing) && spacing > 0)) errors.push("Enter the hanger spacing.");
  const sticks = [...type.sticks].sort((a, b) => a.lengthFt - b.lengthFt);
  if (!sticks.length) errors.push(`${type.name} has no stick length — set it in ${PIPE_TYPES_HOME}.`);
  if (errors.length) return { rows: [], errors };

  const pieces = ceilSafe(run / sticks[sticks.length - 1].lengthFt);
  const stick = sticks.find((s) => s.lengthFt >= run / pieces - 1e-9) ?? sticks[sticks.length - 1];
  const rows: PipeRow[] = [
    { role: "stick", qty: pieces * qty, sku: stick.sku, lengthFt: stick.lengthFt },
    { role: "splice", qty: (pieces - 1) * qty },
    { role: "clamp", qty: (ceilSafe(run / spacing) + 1) * qty },
  ];
  return { rows: rows.filter((r) => r.qty > 0), errors: [] };
}
