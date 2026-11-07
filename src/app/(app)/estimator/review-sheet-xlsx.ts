import type { Worksheet } from "exceljs";
import { isAdjustmentRow, partsRowItemName, partsRowNotes, reviewMoney, type ReviewSheetBlock } from "./parts-csv";

/** The Estimator's "Review spreadsheet" (#363, Jeff 2026-10-22) — the parts
 *  list (and, since #374, each system's labor rows: man-hours, travel, shop,
 *  lift, allowance — all ordinary rows inside the SUM ranges) as a real .xlsx for reviewing an estimate: every listed part with a
 *  clickable Link, live Ext Cost / Ext Sell / Markup formulas
 *  on the line's own sell (before freight, rounding and bonuses), and under
 *  each system five bold rows (#377, Jeff 2026-11-06) — System cost, System
 *  markup, ACCTs (both bonuses, combined), Freight and Package sell, the system's
 *  price, with any round-up or typed-price adjustment named in its Notes.
 *  exceljs is imported on demand, so it never lands in the Estimator's main
 *  bundle; the module touches the DOM only inside `downloadReviewSheet`.
 *  Every text cell is written as a string, never a formula. */

export const REVIEW_SHEET_HEADER: string[] = [
  "Manufacturer",
  "Item name",
  "Description",
  "Room",
  "System",
  "Qty",
  "Unit Cost",
  "Unit Sell",
  "Ext Cost",
  "Ext Sell",
  "Markup",
  "Price source",
  "Link",
  "Notes",
];

/** Column letters, by header (#363). */
const COL = {
  qty: "F",
  unitCost: "G",
  unitSell: "H",
  extCost: "I",
  extSell: "J",
} as const;

const MONEY_FMT = "$#,##0.00";
const PCT_FMT = "0.0%";
const WIDTHS = [18, 20, 40, 14, 18, 7, 12, 12, 13, 13, 10, 22, 36, 40];

/** What Package sell adds beyond the rows above it (#377): the round-up or typed-price
 *  adjustment, plus anything in the system's price the sheet doesn't list, so the row
 *  always lands on the real price and says why. */
export function packageSellExtra(block: ReviewSheetBlock, sellSum: number): { amount: number; note: string } {
  const round = (n: number) => Math.round(n * 100) / 100;
  const { adjustment, typedPrice, total } = block.fees;
  const unlisted = round(block.price - sellSum - total);
  const parts: string[] = [];
  if (Math.abs(adjustment) >= 0.005) parts.push(`Includes ${typedPrice ? "typed price adjustment" : "price rounding"} ${reviewMoney(adjustment)}`);
  if (Math.abs(unlisted) >= 0.005) parts.push(`Includes ${reviewMoney(unlisted)} not listed above`);
  return { amount: round(adjustment + unlisted), note: parts.join(" · ") };
}

/** The closing rows' labels (#363, #377). ACCTs and Freight print exactly that. */
export function subtotalLabels(system: string): { cost: string; markup: string; accts: string; freight: string; sell: string } {
  return { cost: `System cost — ${system}`, markup: `System markup — ${system}`, accts: "ACCTs", freight: "Freight", sell: `Package sell — ${system}` };
}

/** Writes the blocks onto the sheet (#363); returns nothing. */
function writeBlocks(ws: Worksheet, blocks: ReviewSheetBlock[]): void {
  const header = ws.addRow(REVIEW_SHEET_HEADER);
  header.font = { bold: true };
  let n = 1;
  blocks.forEach((block, bi) => {
    if (bi > 0) {
      ws.addRow([]);
      n++;
    }
    const first = n + 1;
    let costSum = 0;
    let sellSum = 0;
    for (const r of block.rows) {
      n++;
      const row = ws.getRow(n);
      const extCost = r.qty * r.unitCost;
      const extSell = r.qty * r.lineSell;
      costSum += extCost;
      sellSum += extSell;
      // Text as strings only (never a formula); an empty one stays a blank cell.
      const put = (c: number, v: string) => {
        if (v) row.getCell(c).value = String(v);
      };
      put(1, r.manufacturer);
      put(2, partsRowItemName(r));
      put(3, r.desc);
      put(4, r.room);
      put(5, r.system);
      row.getCell(6).value = r.qty;
      row.getCell(7).value = r.unitCost;
      row.getCell(8).value = r.lineSell;
      row.getCell(9).value = { formula: `${COL.qty}${n}*${COL.unitCost}${n}`, result: extCost };
      row.getCell(10).value = { formula: `${COL.qty}${n}*${COL.unitSell}${n}`, result: extSell };
      if (!isAdjustmentRow(r)) {
        const g = `${COL.unitCost}${n}`;
        const h = `${COL.unitSell}${n}`;
        row.getCell(11).value = { formula: `IF(${g}=0,"",(${h}-${g})/${g})`, result: r.unitCost === 0 ? "" : (r.lineSell - r.unitCost) / r.unitCost };
      }
      put(12, r.source);
      if (r.link) {
        row.getCell(13).value = { text: r.link, hyperlink: r.link };
        row.getCell(13).font = { color: { argb: "FF0563C1" }, underline: true };
      }
      put(14, partsRowNotes(r));
      for (const c of [7, 8, 9, 10]) row.getCell(c).numFmt = MONEY_FMT;
      row.getCell(11).numFmt = PCT_FMT;
    }
    const last = n;
    const costRange = `SUM(${COL.extCost}${first}:${COL.extCost}${last})`;
    const sellRange = `SUM(${COL.extSell}${first}:${COL.extSell}${last})`;
    const labels = subtotalLabels(block.system);
    const subtotal = (label: string, value: ExcelValue, notes: string, topBorder: boolean) => {
      n++;
      const row = ws.getRow(n);
      row.getCell(3).value = label;
      row.getCell(10).value = value;
      row.getCell(10).numFmt = MONEY_FMT;
      if (notes) row.getCell(14).value = notes;
      row.font = { bold: true };
      if (topBorder) for (let c = 1; c <= REVIEW_SHEET_HEADER.length; c++) row.getCell(c).border = { top: { style: "thin" } };
    };
    const closing = n + 1; // System cost; the next three rows follow it
    subtotal(labels.cost, { formula: costRange, result: costSum }, "", true);
    subtotal(labels.markup, { formula: `${sellRange}-${costRange}`, result: sellSum - costSum }, "", false);
    subtotal(labels.accts, block.fees.accts, "", false);
    subtotal(labels.freight, block.fees.freight, "", false);
    const extra = packageSellExtra(block, sellSum);
    const sum = [0, 1, 2, 3].map((i) => `${COL.extSell}${closing + i}`).join("+");
    const tail = Math.abs(extra.amount) < 0.005 ? "" : `${extra.amount < 0 ? "-" : "+"}${Math.abs(extra.amount).toFixed(2)}`;
    subtotal(labels.sell, { formula: `${sum}${tail}`, result: block.price }, extra.note, true);
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: REVIEW_SHEET_HEADER.length } };
  WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

type ExcelValue = number | { formula: string; result: number };

/** The Review spreadsheet's bytes (#363) — one sheet, "Review". */
export async function buildReviewWorkbook(blocks: ReviewSheetBlock[]): Promise<Uint8Array<ArrayBuffer>> {
  const mod = await import("exceljs");
  // exceljs is CommonJS: the namespace's default is the library; fall back to the namespace if a bundler flattens it.
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Quartzite";
  writeBlocks(wb.addWorksheet("Review"), blocks);
  // A Node Buffer in scripts, an ArrayBuffer-backed buffer in the browser — copied into a plain array either way.
  const buf: ArrayLike<number> | ArrayBuffer = await wb.xlsx.writeBuffer();
  return buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
}

/** Builds the Review spreadsheet and downloads it as `<stem>-review-spreadsheet.xlsx` (#363). */
export async function downloadReviewSheet(stem: string, blocks: ReviewSheetBlock[]): Promise<void> {
  const bytes = await buildReviewWorkbook(blocks);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem}-review-spreadsheet.xlsx`;
  a.click();
  // Revoked a beat later so a slow browser has started the download first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
