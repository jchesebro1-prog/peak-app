/**
 * BOM quote PDF (2026-10-20 spec) — pure, client-safe helpers shared by the
 * Build package → BOM quote tab and the render. The tab imports nothing from
 * a store (#333), so these live apart from bom-pdf-server.ts.
 */

/** "<estimate number> BOM.pdf" — the Cover PDF's character rule (coverPdfFileName). */
export function bomPdfFileName(number: string): string {
  return `${(number || "Estimate").replace(/[^A-Za-z0-9 _-]/g, "_")} BOM.pdf`;
}

/** The staff download route; `download` sends it as an attachment, else it opens inline. */
export function bomPdfPath(quoteId: string, download: boolean): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/bom-pdf${download ? "?download=1" : ""}`;
}
