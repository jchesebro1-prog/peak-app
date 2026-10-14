/* Assessments engine (#337) — CSV with a spreadsheet formula-injection guard. Pure. */

/** One cell: a leading = + - @ tab or CR is neutralised with a leading ', then quoted if it holds , " CR or LF. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** A BOM (so Excel reads UTF-8) then CRLF-terminated rows. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",") + "\r\n").join("");
}
