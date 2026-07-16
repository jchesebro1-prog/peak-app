/**
 * Client-side export helpers for the Design Studio schedule tools. CSV opens
 * directly in Excel/Sheets; print uses the browser (the app's global print CSS
 * hides the nav so the schedule prints clean). Browser-only — import from
 * "use client" components.
 */

function esc(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Build CSV text from a header + rows. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

/** Trigger a CSV download. */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]): void {
  const blob = new Blob(["﻿" + toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : filename + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** Kebab-case a design/venue name into a safe file stem. */
export function fileStem(name: string, fallback: string): string {
  const s = (name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}
