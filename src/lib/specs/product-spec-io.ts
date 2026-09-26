import ExcelJS from "exceljs";
import { mergeUpsert } from "@/lib/stores/catalog";
import { cellText } from "@/lib/import/xlsx-to-csv";
import { parseCsv } from "@/app/(app)/import/parse";
import type { PartWrite, ProductSpecPlan, SpecSheet } from "@/lib/specs/product-spec-import";

/**
 * Product spec import (#205) — the server half: read the uploaded file into
 * sheets, and write a plan's parts. The rules (headers, matching, holder and
 * same-as, what is skipped) are all in product-spec-import.ts.
 *
 * SERVER-ONLY. exceljs pulls Node stream internals and the catalog store
 * pulls the database driver; import this only from server actions, route
 * handlers and scripts — never from a "use client" module.
 */

export type ReadSheetsResult = { ok: true; sheets: SpecSheet[] } | { ok: false; error: string };

/** .xlsx → every worksheet; .csv → one sheet. `rows[i]` is sheet row i+1
 *  for a workbook (empty rows kept as [] so line numbers match Excel). */
export async function readSpecSheets(buf: ArrayBuffer | Buffer, filename: string): Promise<ReadSheetsResult> {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".csv")) {
    const text = Buffer.from(buf as ArrayBuffer).toString("utf8");
    const t = parseCsv(text);
    if (!t.ok) return { ok: false, error: t.error || "That CSV has no rows." };
    return { ok: true, sheets: [{ name: filename, rows: [t.headers, ...t.rows] }] };
  }
  if (!name.endsWith(".xlsx")) return { ok: false, error: "Choose an .xlsx or .csv file." };

  const wb = new ExcelJS.Workbook();
  try {
    const ab = Buffer.isBuffer(buf) ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf;
    await wb.xlsx.load(ab as ArrayBuffer);
  } catch {
    return { ok: false, error: "That file couldn’t be read as an Excel workbook." };
  }
  const sheets: SpecSheet[] = wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cellText(cell.value);
      });
      for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
      rows[rowNumber - 1] = cells;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return { name: ws.name, rows };
  });
  if (!sheets.length) return { ok: false, error: "That workbook has no sheets." };
  return { ok: true, sheets };
}

export type ApplyResult = {
  written: number;
  sameAs: number;
  errors: Array<{ sku: string; error: string }>;
};

/**
 * Write a plan's parts, sequentially, through mergeUpsert (never upsert —
 * a part carries pricing, ports and datasheet fields this import knows
 * nothing about). Holders go first; if a holder's write fails, the same-as
 * parts that would point at it are skipped too, so a failure never leaves a
 * pointer at a part without text.
 */
export async function applyProductSpecPlan(plan: ProductSpecPlan, by: string): Promise<ApplyResult> {
  const now = Date.now();
  const out: ApplyResult = { written: 0, sameAs: 0, errors: [] };
  const failedHolders = new Set<string>();
  const ordered: PartWrite[] = [
    ...plan.writes.filter((w) => w.role === "holder"),
    ...plan.writes.filter((w) => w.role === "same-as"),
  ];
  for (const w of ordered) {
    const target = w.role === "same-as" ? w.patch.specSameAs || "" : "";
    if (target && failedHolders.has(target)) {
      out.errors.push({ sku: w.sku, error: `Skipped — ${target} could not be written.` });
      continue;
    }
    try {
      await mergeUpsert(w.sku, { ...w.patch, specUpdatedAt: now, specUpdatedBy: by });
      out.written++;
      if (w.role === "same-as") out.sameAs++;
    } catch (e) {
      console.error("applyProductSpecPlan", w.sku, e);
      if (w.role === "holder") failedHolders.add(w.sku);
      out.errors.push({ sku: w.sku, error: "Could not save the spec text." });
    }
  }
  return out;
}
