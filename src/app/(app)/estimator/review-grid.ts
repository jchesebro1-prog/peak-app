import { isAdjustmentRow, partsRowItemName, partsRowNotes, reviewMoney, type ReviewSheetBlock } from "./parts-csv";
import { packageSellExtra, REVIEW_SHEET_HEADER, subtotalLabels } from "./review-sheet-xlsx";

/** Internal review's on-screen grid (#378, Jeff 2026-11-23) — the Review
 *  spreadsheet (review-sheet-xlsx.ts) as rows for the screen: the same model
 *  (`reviewSheetModel`), the same fourteen columns in the same order, and
 *  under each system the same five closing rows. Every number is the value the
 *  spreadsheet's formula would show. Pure: no React, no server imports. */

export const REVIEW_GRID_COLUMNS: readonly string[] = REVIEW_SHEET_HEADER;

/** Which columns hold numbers (right-aligned, mono) — Qty through Markup. */
export const REVIEW_GRID_NUMERIC: ReadonlySet<number> = new Set([5, 6, 7, 8, 9, 10]);

export type ReviewGridRow = {
  key: string;
  manufacturer: string;
  itemName: string;
  desc: string;
  room: string;
  system: string;
  qty: string;
  unitCost: string;
  unitSell: string;
  extCost: string;
  extSell: string;
  /** "35.0%"; "" when the cost is zero or the row is a cost adjustment. */
  markup: string;
  source: string;
  /** An absolute http(s) URL, or "". */
  link: string;
  notes: string;
};

/** A closing row: its label sits under Description, its amount under Ext Sell. */
export type ReviewGridClosingRow = { key: "cost" | "markup" | "accts" | "freight" | "sell"; label: string; amount: string; notes: string; rule: boolean };

export type ReviewGridBlock = { sectionId: string; system: string; rows: ReviewGridRow[]; closing: ReviewGridClosingRow[] };

/** A quantity as the grid prints it: up to two decimals, no trailing zeros. */
export function reviewQty(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

/** A row's markup on its own sell — the spreadsheet's `(Unit Sell − Unit Cost) / Unit Cost`. */
export function reviewRowMarkup(unitCost: number, unitSell: number): string {
  if (!Number.isFinite(unitCost) || !Number.isFinite(unitSell) || unitCost === 0) return "";
  const v = Math.round(((unitSell - unitCost) / unitCost) * 1000) / 10;
  return (v === 0 ? 0 : v).toFixed(1) + "%";
}

/** One system's block as the grid shows it. */
export function reviewGridBlock(block: ReviewSheetBlock): ReviewGridBlock {
  let costSum = 0;
  let sellSum = 0;
  const rows = block.rows.map((r, i): ReviewGridRow => {
    const extCost = r.qty * r.unitCost;
    const extSell = r.qty * r.lineSell;
    costSum += extCost;
    sellSum += extSell;
    return {
      key: `${block.sectionId}:${i}`,
      manufacturer: r.manufacturer,
      itemName: partsRowItemName(r),
      desc: r.desc,
      room: r.room,
      system: r.system,
      qty: reviewQty(r.qty),
      unitCost: reviewMoney(r.unitCost),
      unitSell: reviewMoney(r.lineSell),
      extCost: reviewMoney(extCost),
      extSell: reviewMoney(extSell),
      markup: isAdjustmentRow(r) ? "" : reviewRowMarkup(r.unitCost, r.lineSell),
      source: r.source,
      link: r.link,
      notes: partsRowNotes(r),
    };
  });
  const labels = subtotalLabels(block.system);
  const extra = packageSellExtra(block, sellSum);
  return {
    sectionId: block.sectionId,
    system: block.system,
    rows,
    closing: [
      { key: "cost", label: labels.cost, amount: reviewMoney(costSum), notes: "", rule: true },
      { key: "markup", label: labels.markup, amount: reviewMoney(sellSum - costSum), notes: "", rule: false },
      { key: "accts", label: labels.accts, amount: reviewMoney(block.fees.accts), notes: "", rule: false },
      { key: "freight", label: labels.freight, amount: reviewMoney(block.fees.freight), notes: "", rule: false },
      { key: "sell", label: labels.sell, amount: reviewMoney(block.price), notes: extra.note, rule: true },
    ],
  };
}

/** Every block, in the estimate's order. */
export function reviewGrid(blocks: ReviewSheetBlock[]): ReviewGridBlock[] {
  return blocks.map(reviewGridBlock);
}

/** A row's cells in column order (the Link cell is the URL; the screen renders it as a link). */
export function reviewGridCells(r: ReviewGridRow): string[] {
  return [r.manufacturer, r.itemName, r.desc, r.room, r.system, r.qty, r.unitCost, r.unitSell, r.extCost, r.extSell, r.markup, r.source, r.link, r.notes];
}
