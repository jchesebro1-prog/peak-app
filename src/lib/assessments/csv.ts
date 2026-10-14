/* Assessments engine (#337) — CSV with a spreadsheet formula-injection guard. Pure. */

/**
 * One cell. A string with a leading = + - @ tab or CR is neutralised with a leading '; numbers and other
 * non-strings are written as plain String(v) (so the number -3 stays -3). Then quoted if it holds , " CR or LF.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** A BOM (so Excel reads UTF-8) then CRLF-terminated rows. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return "\uFEFF" + [header, ...rows].map((r) => r.map(csvCell).join(",") + "\r\n").join("");
}
