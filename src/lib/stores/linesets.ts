/**
 * Lineset schedule for Venue Assessments (D132, 2026-08-18).
 *
 * One unified table on the Theatre sheet's superset (12 printed columns,
 * 14 fields here — the sheet's "TRIM LOW / HIGH" is one printed cell holding
 * two values, and each row carries an internal id). The Auditorium sheet's
 * 7-column table is a subset: its "travel" maps onto trimLow/trimHigh and its
 * "arbor / motor capacity" onto arborLoad.
 *
 * Type and condition keep the sheets' printed legends — reps already write
 * these codes on paper. Deliberately NOT the assessment layer's
 * Good/Monitor/Replace scale, and deliberately not the Inspections rubric.
 *
 * Pure module — no DB imports.
 */

export type LinesetType = "" | "D" | "M" | "R" | "L" | "B" | "C" | "S" | "E" | "T" | "O";
export type LinesetCond = "" | "G" | "F" | "P" | "X";

export const LINESET_TYPES: Array<{ key: Exclude<LinesetType, "">; label: string }> = [
  { key: "D", label: "Draw / main" },
  { key: "M", label: "Midstage traveler" },
  { key: "R", label: "Rear traveler" },
  { key: "L", label: "Legs" },
  { key: "B", label: "Border" },
  { key: "C", label: "Cyc" },
  { key: "S", label: "Scrim / bounce" },
  { key: "E", label: "Electric" },
  { key: "T", label: "Track only" },
  { key: "O", label: "Open / spare" },
];

export const LINESET_CONDS: Array<{ key: Exclude<LinesetCond, "">; label: string }> = [
  { key: "G", label: "Good" },
  { key: "F", label: "Fair / monitor" },
  { key: "P", label: "Poor — repair or replace" },
  { key: "X", label: "Missing / inoperable" },
];

export interface LinesetRow {
  id: string;
  pos: string;
  distFromPL: string;
  setName: string;
  type: LinesetType;
  battenLength: string;
  liftLines: string;
  goods: string;
  finishedWH: string;
  arborLoad: string;
  trimLow: string;
  trimHigh: string;
  cond: LinesetCond;
  notes: string;
}

export function linesetTypeLabel(t: LinesetType): string {
  return LINESET_TYPES.find((x) => x.key === t)?.label || "";
}

export function linesetCondLabel(c: LinesetCond): string {
  return LINESET_CONDS.find((x) => x.key === c)?.label || "";
}

let lsSeq = 0;
export function newLinesetId(): string {
  lsSeq += 1;
  return "ls" + Date.now().toString(36) + lsSeq.toString(36);
}

export function blankLinesetRow(pos: number): LinesetRow {
  return {
    id: newLinesetId(), pos: String(pos), distFromPL: "", setName: "",
    type: "", battenLength: "", liftLines: "", goods: "", finishedWH: "",
    arborLoad: "", trimLow: "", trimHigh: "", cond: "", notes: "",
  };
}
