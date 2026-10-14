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
import type { ConditionLevel } from "../field-lists";

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
  /** #344 B2 — Bad → New level (0–4); old `cond` codes seed it once when absent (G 3, F 2, P 1, X 0). `null` = cleared, stays cleared. */
  condition?: ConditionLevel | null;
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

export function nextLinesetPosition(rows: LinesetRow[]): number {
  return rows.reduce((max, row) => {
    const position = Number.parseInt(row.pos, 10);
    return Number.isFinite(position) ? Math.max(max, position) : max;
  }, 0) + 1;
}

/* ---------- #344 B6: quantity-first schedule ---------- */

/** A set number: a whole number ≥ 1 and nothing else. Anything else is kept but sorts last. */
function setNumber(row: LinesetRow): number | null {
  const text = (row.pos ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number.parseInt(text, 10);
  return n >= 1 ? n : null;
}

/** Highest quantity the schedule offers. */
export const LINESET_QTY_MAX = 200;

/** Whole number in 0…200; anything else (NaN, negative, fractional) falls back to 0 / floors. */
export function clampLinesetQty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(LINESET_QTY_MAX, Math.max(0, Math.floor(n)));
}

/** Numbered rows in set-number order, then rows without a usable number in their stored order. */
export function sortLinesetRows(rows: LinesetRow[]): LinesetRow[] {
  const numbered = rows.map((row, i) => ({ row, n: setNumber(row), i })).filter((x) => x.n != null);
  const unnumbered = rows.filter((row) => setNumber(row) == null);
  numbered.sort((a, b) => (a.n as number) - (b.n as number) || a.i - b.i);
  return numbered.map((x) => x.row).concat(unnumbered);
}

/** Nothing recorded on the row besides its set number: every field blank, no condition. */
export function rowIsEmpty(row: LinesetRow): boolean {
  const blank = (v: unknown) => v == null || String(v).trim() === "";
  return (
    blank(row.distFromPL) && blank(row.setName) && blank(row.type) && blank(row.battenLength) &&
    blank(row.liftLines) && blank(row.goods) && blank(row.finishedWH) && blank(row.arborLoad) &&
    blank(row.trimLow) && blank(row.trimHigh) && blank(row.cond) && blank(row.notes) && row.condition == null
  );
}

/**
 * Make the schedule have set numbers 1…n. Existing rows keep their ids (matched by numeric `pos`);
 * missing numbers get a blank row. Rows numbered above n leave `rows`: empty ones silently, rows
 * with data are also returned in `dropped` so the caller can confirm before applying the plan.
 * A row with no usable set number is kept, after the numbered ones.
 */
export function linesetQuantityPlan(rows: LinesetRow[], n: number): { rows: LinesetRow[]; dropped: LinesetRow[] } {
  const qty = clampLinesetQty(n);
  const sorted = sortLinesetRows(rows);
  const kept: LinesetRow[] = [];
  const dropped: LinesetRow[] = [];
  const have = new Set<number>();
  for (const row of sorted) {
    const num = setNumber(row);
    if (num == null) continue;
    if (num > qty) {
      if (!rowIsEmpty(row)) dropped.push(row);
      continue;
    }
    have.add(num);
    kept.push(row);
  }
  for (let i = 1; i <= qty; i++) if (!have.has(i)) kept.push(blankLinesetRow(i));
  const result = sortLinesetRows(kept).concat(sorted.filter((row) => setNumber(row) == null));
  return { rows: result, dropped };
}

/** Add a blank row for every set number 1…n that has none. Never removes, reorders ids or touches data:
 *  rows numbered above n and rows without a usable number are all kept. */
export function addMissingSets(rows: LinesetRow[], n: number): LinesetRow[] {
  const qty = clampLinesetQty(n);
  const have = new Set<number>();
  for (const row of rows) {
    const num = setNumber(row);
    if (num != null) have.add(num);
  }
  const added: LinesetRow[] = [];
  for (let i = 1; i <= qty; i++) if (!have.has(i)) added.push(blankLinesetRow(i));
  return added.length ? sortLinesetRows(rows.concat(added)) : rows;
}

export type LinesetFillKey = Exclude<keyof LinesetRow, "id" | "pos">;

const cellBlank = (v: unknown) => v == null || String(v).trim() === "";

/** How many non-empty cells below the source row Fill down would change (differing values; a blank source counts every filled cell). */
export function fillDownImpact(rows: LinesetRow[], fromId: string, key: LinesetFillKey): number {
  const at = rows.findIndex((row) => row.id === fromId);
  if (at < 0) return 0;
  const source = rows[at][key];
  let n = 0;
  for (let i = at + 1; i < rows.length; i++) {
    const cell = rows[i][key];
    if (cellBlank(cell)) continue;
    if (cellBlank(source) || String(cell) !== String(source)) n++;
  }
  return n;
}

/** Copy one cell's value into the same column of every row after it (in the order given). */
export function fillDown(rows: LinesetRow[], fromId: string, key: LinesetFillKey): LinesetRow[] {
  const at = rows.findIndex((row) => row.id === fromId);
  if (at < 0) return rows;
  const source = rows[at][key];
  return rows.map((row, i) => {
    if (i <= at) return row;
    const next: Record<string, unknown> = { ...row };
    if (source === undefined) delete next[key];
    else next[key] = source;
    return next as unknown as LinesetRow;
  });
}

/** Mark sets fromPos…toPos as Open / spare where no type is set yet; typed sets are left and listed. */
export function markSpare(rows: LinesetRow[], fromPos: number, toPos: number): { rows: LinesetRow[]; skipped: string[] } {
  const lo = Math.min(fromPos, toPos);
  const hi = Math.max(fromPos, toPos);
  const skipped: string[] = [];
  const next = rows.map((row) => {
    const num = setNumber(row);
    if (num == null || num < lo || num > hi) return row;
    if (row.type) {
      skipped.push(row.pos.trim());
      return row;
    }
    return { ...row, type: "O" as const };
  });
  return { rows: next, skipped };
}

/** "12, 13, 14, 20" → "12–14, 20" (numbers sort; anything non-numeric is listed as written, after). */
export function formatSetRanges(positions: string[]): string {
  const nums = positions.map((p) => p.trim()).filter((p) => /^\d+$/.test(p)).map(Number).sort((a, b) => a - b);
  const words = positions.map((p) => p.trim()).filter((p) => p && !/^\d+$/.test(p));
  const out: string[] = [];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j + 1;
  }
  return out.concat(words).join(", ");
}
