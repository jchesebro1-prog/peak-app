import ExcelJS from "exceljs";

/**
 * Sheet 1 of an .xlsx → CSV text (punch #81).
 *
 * SERVER-ONLY. exceljs pulls Node stream internals; importing it from a
 * "use client" module drags them into the browser bundle and 500s the page
 * — the exact trap that broke the Estimator once already (#78). Import this
 * only from route handlers, server actions, and scripts.
 *
 * Emitting CSV rather than a parsed table is deliberate: the import hub's
 * whole pipeline (auto-mapping, live preview, the authoritative server-side
 * re-parse in importRecords) already runs on CSV text. Converting here means
 * an uploaded workbook rejoins the existing paste path instead of forking it.
 *
 * NOT a replacement for scripts/convert-dealer-sheets.py, which handles 52
 * vendors' headerless, multi-tab, PDF-converted sheets for the one-time #39
 * build-out. This reads one ordinary sheet with a header row.
 */

export type XlsxToCsvResult =
  | { ok: true; csv: string; rows: number; sheetName: string }
  | { ok: false; error: string };

/** RFC-4180 escaping — quote when the value carries a comma, quote, CR or LF. */
function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/** One cell → its text. Dates go ISO; formulas use their cached result. */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result);
    if ("text" in value) return String(value.text ?? "");
    if ("richText" in value) return value.richText.map((r) => r.text ?? "").join("");
    // "hyperlink" implies the shape of CellHyperlinkValue, which also declares
    // `text` as required — but by this point control-flow narrowing has
    // already excluded CellHyperlinkValue from the union (the "text" check
    // above returned for every constituent that has a required `text`
    // property). A defensive fallback to `.text` here only matters for a
    // runtime value that carries `hyperlink` without `text`, which no
    // declared CellValue variant does; the cast documents that this branch
    // reads a property the narrowed type can no longer see, not a use we
    // expect to exercise.
    if ("hyperlink" in value)
      return String((value as { text?: unknown }).text ?? value.hyperlink ?? "");
    return "";
  }
  return String(value);
}

export async function xlsxToCsv(buf: ArrayBuffer | Buffer): Promise<XlsxToCsvResult> {
  let wb: ExcelJS.Workbook;
  try {
    wb = new ExcelJS.Workbook();
    const ab = Buffer.isBuffer(buf)
      ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      : buf;
    await wb.xlsx.load(ab as ArrayBuffer);
  } catch {
    return { ok: false, error: "That file couldn’t be read as an Excel workbook." };
  }

  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: "That workbook has no sheets." };

  // Trailing empty columns are common in hand-edited sheets; width comes from
  // the widest row actually present rather than the sheet's declared extent.
  const grid: string[][] = [];
  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value);
    });
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
    if (cells.some((c) => c.trim() !== "")) {
      grid.push(cells);
      width = Math.max(width, cells.length);
    }
  });

  if (grid.length < 2) {
    return { ok: false, error: "That sheet needs a header row and at least one data row." };
  }

  const csv = grid
    .map((r) => {
      const padded = r.slice();
      while (padded.length < width) padded.push("");
      return padded.map(csvCell).join(",");
    })
    .join("\n");

  return { ok: true, csv, rows: grid.length - 1, sheetName: ws.name };
}
