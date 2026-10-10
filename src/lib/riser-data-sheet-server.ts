// SERVER ONLY — exceljs + stores. Never import from a "use client" file.
import ExcelJS from "exceljs";
import { typeLabel, typeOfPart, autoTypeEntries, type DeviceType } from "@/lib/design/device-types";
import { readSheetFile } from "@/lib/part-docs/photo-sheet-io";
import { MAX_RISER_SHEET_BYTES, MAX_RISER_SHEET_ROWS, RISER_SHEET_TOO_BIG, RISER_SHEET_TOO_MANY_ROWS, upsertPatchOf } from "@/lib/riser-data-preview";
import { parseRiserDataSheet, planRiserDataApply, riserDataRowCells, riserDataRows, RISER_DEVICE_HEADERS, type ExportRow, type ParseResult, type RiserChange } from "@/lib/riser-data-sheet";
import { getManyBySku, list as listCatalog, mergeUpsert } from "@/lib/stores/catalog";
import { getDeviceTypes, getTypeMap } from "@/lib/stores/device-types";

/**
 * #328 A2 — the riser data sheet's I/O: the Devices export from the live
 * catalog + device-type map, reading an uploaded workbook, and applying a plan
 * through `mergeUpsert` (only designatorCode / tagDefaults).
 */

export const RISER_SHEET_NAME = "Devices";

/** Devices rows from the live catalog. Reads the type map without writing: a category with no map entry but a high-confidence suggestion counts as mapped (the Grid's own auto-apply, in memory). */
export async function loadRiserExportRows(now = Date.now()): Promise<{ rows: ExportRow[]; types: DeviceType[] }> {
  const [parts, types, stored] = await Promise.all([listCatalog(), getDeviceTypes(), getTypeMap()]);
  const map = { ...stored, ...autoTypeEntries(parts, stored, types, now) };
  const rows = riserDataRows(parts, (p) => typeOfPart(p, map, types));
  rows.sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model) || a.sku.localeCompare(b.sku));
  return { rows, types };
}

const WIDTHS: Record<(typeof RISER_DEVICE_HEADERS)[number], number> = {
  Manufacturer: 18,
  Model: 22,
  SKU: 24,
  Description: 46,
  "Device type": 20,
  "Designator code": 15,
  Box: 8,
  Face: 9,
  Mount: 9,
  Height: 9,
  "P/D": 7,
  Source: 11,
};

/** One "Devices" sheet: bold frozen header, the editable columns tinted. */
export async function writeRiserDataSheet(rows: readonly ExportRow[], types: readonly DeviceType[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(RISER_SHEET_NAME);
  ws.addRow([...RISER_DEVICE_HEADERS]);
  for (const r of rows) ws.addRow(riserDataRowCells(r, (k) => typeLabel(k, types)));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  RISER_DEVICE_HEADERS.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = WIDTHS[h];
    if (i >= 5 && i <= 10) col.eachCell({ includeEmpty: false }, (cell, rowNo) => {
      if (rowNo > 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
    });
  });
  // Excel would turn 18" into a number-ish guess; keep every cell text.
  ws.eachRow((row) => row.eachCell((cell) => { cell.numFmt = "@"; }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type ReadRiserSheet = { ok: true; parse: ParseResult } | { ok: false; error: string };

/** An uploaded Devices workbook (.xlsx only) → parse result, size- and row-capped. */
export async function readRiserSheetFile(buf: Buffer, fileName: string): Promise<ReadRiserSheet> {
  if (!/\.xlsx$/i.test(fileName)) return { ok: false, error: "Pick the riser data sheet (.xlsx) you downloaded here." };
  if (buf.length > MAX_RISER_SHEET_BYTES) return { ok: false, error: RISER_SHEET_TOO_BIG };
  const read = await readSheetFile(buf, fileName, RISER_SHEET_NAME);
  if (!read.ok) return read;
  if (read.grid.length - 1 > MAX_RISER_SHEET_ROWS) return { ok: false, error: RISER_SHEET_TOO_MANY_ROWS };
  return { ok: true, parse: parseRiserDataSheet(read.grid) };
}

/** Resolve every parsed SKU to its live part (renames followed). */
export async function resolveSheetParts(parse: ParseResult) {
  return getManyBySku([...new Set(parse.rows.map((r) => r.sku))]);
}

export type ApplyOutcome = { applied: number; failed: { sku: string; error: string }[]; remaining: number };

/**
 * Write changes through mergeUpsert, ONLY designatorCode / tagDefaults, until
 * the budget is spent. `remaining` counts the changes not yet attempted;
 * a failed one is reported and left for the caller to skip next time.
 */
export async function applyRiserChanges(changes: readonly RiserChange[], budgetMs: number, now = () => Date.now()): Promise<ApplyOutcome> {
  const started = now();
  let applied = 0;
  const failed: ApplyOutcome["failed"] = [];
  let i = 0;
  for (; i < changes.length; i++) {
    if (i > 0 && now() - started > budgetMs) break;
    const c = changes[i];
    try {
      await mergeUpsert(c.sku, upsertPatchOf(c));
      applied++;
    } catch (e) {
      failed.push({ sku: c.sku, error: e instanceof Error && e.message ? e.message : "the write failed" });
    }
  }
  return { applied, failed, remaining: changes.length - i };
}

/** The plan for a parse, with `skip` SKUs (failed earlier this run) left out. */
export async function planRiserSheet(parse: ParseResult, skip: ReadonlySet<string> = new Set()) {
  const plan = planRiserDataApply(parse.rows, await resolveSheetParts(parse));
  return { ...plan, changes: plan.changes.filter((c) => !skip.has(c.sku)) };
}
