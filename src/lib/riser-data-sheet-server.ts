// SERVER ONLY — exceljs + stores. Never import from a "use client" file.
import ExcelJS from "exceljs";
import { typeLabel, typeOfPart, autoTypeEntries, type DeviceType } from "@/lib/design/device-types";
import { readSheetFile } from "@/lib/part-docs/photo-sheet-io";
import { cableUpsertPatchOf, MAX_RISER_SHEET_BYTES, MAX_RISER_SHEET_ROWS, RISER_SHEET_TOO_BIG, RISER_SHEET_TOO_MANY_ROWS, upsertPatchOf } from "@/lib/riser-data-preview";
import {
  parseRiserCablesSheet,
  parseRiserDataSheet,
  planRiserCablesApply,
  planRiserDataApply,
  riserCableRowCells,
  riserCableRows,
  riserDataRowCells,
  riserDataRows,
  RISER_CABLE_HEADERS,
  RISER_CABLE_SHEET_NAME,
  RISER_DEVICE_HEADERS,
  type CableChange,
  type CableExportRow,
  type CableParseResult,
  type ExportRow,
  type ParseResult,
  type RiserChange,
} from "@/lib/riser-data-sheet";
import { resolveWireTypes } from "@/lib/catalog-connect";
import { getManyBySku, list as listCatalog, mergeUpsert } from "@/lib/stores/catalog";
import { getDeviceTypes, getTypeMap } from "@/lib/stores/device-types";
import { listProjects } from "@/lib/stores/grid-projects";
import { getSettings } from "@/lib/settings";

/**
 * #328 A2 — the riser data sheet's I/O: the Devices export from the live
 * catalog + device-type map, reading an uploaded workbook, and applying a plan
 * through `mergeUpsert` (Devices rows: only designatorCode / tagDefaults;
 * Cables rows: only cableOdIn — #328 B1).
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

/**
 * Cables rows (#328 B1): per-length parts a wire type names (`cableSku`) or any
 * Grid route / RiserLink uses, with the stored diameter or the researched one.
 * Admin-only export, so one scan of every Grid project is acceptable. Renamed
 * SKUs are followed (getManyBySku) so a stale reference lands on the live part.
 */
export async function loadCableExportRows(): Promise<CableExportRow[]> {
  const [settings, projects] = await Promise.all([getSettings(), listProjects()]);
  const wanted = new Set<string>();
  for (const w of resolveWireTypes(settings.wireTypes)) if (w.cableSku) wanted.add(w.cableSku);
  for (const p of projects) {
    for (const r of p.routes || []) if (r.partId) wanted.add(r.partId);
    for (const doc of Object.values(p.riser || {})) for (const l of doc.links || []) if (l.partId) wanted.add(l.partId);
  }
  // Only the referenced parts are read (no second whole-catalog list); a renamed SKU resolves to its live part, deduped by SKU.
  const resolved = await getManyBySku([...wanted]);
  const parts = [...new Map([...resolved.values()].map((p) => [p.sku, p] as const)).values()];
  const rows = riserCableRows(parts, new Set(parts.map((p) => p.sku)));
  rows.sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model) || a.sku.localeCompare(b.sku));
  return rows;
}

/** The "Devices" sheet (bold frozen header, editable columns tinted) and the "Cables" sheet (#328 B1). */
export async function writeRiserDataSheet(rows: readonly ExportRow[], types: readonly DeviceType[], cableRows: readonly CableExportRow[] = []): Promise<Buffer> {
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

  const cs = wb.addWorksheet(RISER_CABLE_SHEET_NAME);
  cs.addRow([...RISER_CABLE_HEADERS]);
  for (const r of cableRows) cs.addRow(riserCableRowCells(r));
  cs.getRow(1).font = { bold: true };
  cs.views = [{ state: "frozen", ySplit: 1 }];
  const cableWidths = [18, 22, 24, 46, 20, 11, 60];
  cableWidths.forEach((w, i) => { cs.getColumn(i + 1).width = w; });
  cs.getColumn(5).eachCell({ includeEmpty: false }, (cell, rowNo) => {
    if (rowNo > 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
  });
  cs.eachRow((row) => row.eachCell((cell) => { cell.numFmt = "@"; }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** `cables` is null when the workbook has no Cables tab (an older download). */
export type ReadRiserSheet = { ok: true; parse: ParseResult; cables: CableParseResult | null } | { ok: false; error: string };

/**
 * An uploaded workbook (.xlsx only) → the Devices parse and, when the workbook
 * has a tab named Cables, the Cables parse; size- and row-capped per tab. A
 * workbook with neither tab name reads its first sheet as Devices (the
 * pre-Cables layout); a Cables-only workbook has no Devices rows.
 */
export async function readRiserSheetFile(buf: Buffer, fileName: string): Promise<ReadRiserSheet> {
  if (!/\.xlsx$/i.test(fileName)) return { ok: false, error: "Pick the riser data sheet (.xlsx) you downloaded here." };
  if (buf.length > MAX_RISER_SHEET_BYTES) return { ok: false, error: RISER_SHEET_TOO_BIG };
  const names = new ExcelJS.Workbook();
  try {
    await names.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  } catch {
    return { ok: false, error: "That file couldn't be read as an Excel workbook or CSV." };
  }
  const have = new Set(names.worksheets.map((w) => w.name));
  const hasCables = have.has(RISER_CABLE_SHEET_NAME);
  let parse: ParseResult = { rows: [], errors: [], notes: [] };
  if (have.has(RISER_SHEET_NAME) || !hasCables) {
    const read = await readSheetFile(buf, fileName, RISER_SHEET_NAME);
    if (!read.ok) return read;
    if (read.grid.length - 1 > MAX_RISER_SHEET_ROWS) return { ok: false, error: RISER_SHEET_TOO_MANY_ROWS };
    parse = parseRiserDataSheet(read.grid);
  }
  let cables: CableParseResult | null = null;
  if (hasCables) {
    const read = await readSheetFile(buf, fileName, RISER_CABLE_SHEET_NAME);
    if (!read.ok) return read;
    if (read.grid.length - 1 > MAX_RISER_SHEET_ROWS) return { ok: false, error: RISER_SHEET_TOO_MANY_ROWS };
    cables = parseRiserCablesSheet(read.grid);
  }
  return { ok: true, parse, cables };
}

/** Resolve every parsed SKU (either tab) to its live part (renames followed). */
export async function resolveSheetParts(parse: { rows: readonly { sku: string }[] }) {
  return getManyBySku([...new Set(parse.rows.map((r) => r.sku))]);
}

export type ApplyOutcome = { applied: number; failed: { sku: string; error: string }[]; remaining: number };

/**
 * Write changes through mergeUpsert, ONLY designatorCode / tagDefaults, until
 * the budget is spent. `remaining` counts the changes not yet attempted;
 * a failed one is reported and left for the caller to skip next time.
 */
export async function applyRiserChanges(changes: readonly RiserChange[], budgetMs: number, now = () => Date.now(), cableChanges: readonly CableChange[] = []): Promise<ApplyOutcome> {
  const started = now();
  let applied = 0;
  const failed: ApplyOutcome["failed"] = [];
  const total = changes.length + cableChanges.length;
  let i = 0;
  for (; i < total; i++) {
    if (i > 0 && now() - started > budgetMs) break;
    const dev = i < changes.length ? changes[i] : null;
    const cab = dev ? null : cableChanges[i - changes.length];
    const sku = (dev ?? cab!).sku;
    try {
      if (dev) {
        const c = dev;
        await mergeUpsert(c.sku, upsertPatchOf(c));
      } else await mergeUpsert(cab!.sku, cableUpsertPatchOf(cab!));
      applied++;
    } catch (e) {
      failed.push({ sku, error: e instanceof Error && e.message ? e.message : "the write failed" });
    }
  }
  return { applied, failed, remaining: total - i };
}

/** The plan for a parse, with `skip` SKUs (failed earlier this run) left out. */
export async function planRiserSheet(parse: ParseResult, skip: ReadonlySet<string> = new Set()) {
  const plan = planRiserDataApply(parse.rows, await resolveSheetParts(parse));
  return { ...plan, changes: plan.changes.filter((c) => !skip.has(c.sku)) };
}

/** The Cables plan for a parse (`null` = no Cables tab), with `skip` SKUs left out. */
export async function planCablesSheet(cables: CableParseResult | null, skip: ReadonlySet<string> = new Set()) {
  if (!cables) return { changes: [] as CableChange[], unknown: [] as string[] };
  const plan = planRiserCablesApply(cables.rows, await resolveSheetParts(cables));
  return { ...plan, changes: plan.changes.filter((c) => !skip.has(c.sku)) };
}
