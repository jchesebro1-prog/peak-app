/**
 * #296 — the printed rack sheets' CSS, inlined by the signed print route (one
 * sheet per render, so each PDF has one page orientation) and by the staff
 * preview (all three sheets on named pages, so Print from the browser keeps
 * each sheet's own orientation). Plain strings: server-renderable.
 */
import type { RackSheetKind } from "@/lib/rack/sheet-format";

/** Screen + shared print styling for every rack sheet. Arial everywhere. */
const BASE = `
.rk-set { display: flex; flex-direction: column; align-items: center; gap: 28px; padding-bottom: 40px; }
.rk-sheet, .rk-sheet * { font-family: Arial, Helvetica, sans-serif !important; }
.rk-sheet { color: #16181d; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rk-paper { background: #fff; box-shadow: 0 2px 14px rgba(0, 0, 0, 0.1); box-sizing: border-box; padding: 0.5in; font-size: 9pt; line-height: 1.4; }
.rk-paper[data-orientation="landscape"] { width: 11in; min-height: 8.5in; }
.rk-paper[data-orientation="portrait"] { width: 8.5in; min-height: 11in; padding: 0.6in; }
.rk-head { display: flex; justify-content: space-between; align-items: center; gap: 12pt; border-bottom: 2px solid var(--accent); padding-bottom: 6pt; margin-bottom: 10pt; font-size: 9pt; color: #5b616e; }
.rk-head img { max-height: 0.5in; max-width: 2.2in; }
.rk-title { font-size: 14pt; font-weight: 700; margin: 0 0 2pt; color: #16181d; }
.rk-meta { font-size: 9pt; color: #5b616e; margin: 0 0 10pt; }
.rk-h { font-size: 10pt; font-weight: 700; margin: 14pt 0 5pt; border-bottom: 1pt solid #16181d; padding-bottom: 2pt; }
.rk-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
.rk-table thead { display: table-header-group; }
.rk-table tr { break-inside: avoid; page-break-inside: avoid; }
.rk-table th { text-align: left; font-weight: 700; border-bottom: 1pt solid #16181d; padding: 3pt 6pt 3pt 0; vertical-align: bottom; }
.rk-table td { border-bottom: 0.5pt solid #d7dae0; padding: 3pt 6pt 3pt 0; vertical-align: top; }
.rk-table .rk-num { text-align: right; }
.rk-table tr.rk-opt td { font-style: italic; color: #5b616e; }
.rk-table tr.rk-res td { color: #5b616e; }
.rk-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8pt; }
.rk-total { border: 0.75pt solid #d7dae0; border-radius: 3pt; padding: 6pt 8pt; }
.rk-total-label { font-size: 8pt; color: #5b616e; }
.rk-total-value { font-size: 11pt; font-weight: 700; margin-top: 2pt; }
.rk-list { margin: 0; padding-left: 14pt; list-style: disc; }
.rk-list li { margin: 2pt 0; }
.rk-err { color: #a0442b; font-weight: 700; }
.rk-warn { color: #8a6d1f; font-weight: 700; }
.rk-foot { border-top: 0.75pt solid #16181d; margin-top: 14pt; padding-top: 4pt; font-size: 8pt; color: #3d424e; }
.rk-elev { display: flex; flex-direction: column; height: 100%; gap: 6pt; }
.rk-elev-figs { flex: 1 1 auto; min-height: 0; display: flex; gap: 0.3in; }
.rk-elev-fig { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; margin: 0; }
.rk-elev-fig figcaption { font-size: 9pt; font-weight: 700; text-align: center; margin-bottom: 3pt; }
.rk-elev-svg { flex: 1 1 auto; min-height: 0; }
.rk-elev-svg svg { display: block; width: 100%; height: 100%; }
.rk-legend { display: flex; flex-wrap: wrap; gap: 4pt 14pt; align-items: center; font-size: 8pt; }
.rk-legend span { display: inline-flex; align-items: center; gap: 4pt; }
.rk-note { font-size: 8pt; font-style: italic; }
.rk-elev .rk-foot { margin-top: 0; }
`;

/** Print-only resets shared by every mode. */
const PRINT_RESET = `html, body { background: #fff !important; margin: 0; } nextjs-portal { display: none !important; } .pk-no-print { display: none !important; } .rk-set { display: block !important; padding: 0 !important; zoom: 1 !important; } .rk-paper { box-shadow: none !important; padding: 0 !important; width: auto !important; min-height: 0 !important; } .rk-sheet .pk-drawing-sheet, .pk-drawing-sheet.rk-sheet { box-shadow: none !important; }`;

/** The elevation: Letter landscape, edge to edge (the drawing frame carries its own margin). */
export const RACK_ELEVATION_CSS = `${BASE}@media print { @page { size: 11in 8.5in; margin: 0; } ${PRINT_RESET} }`;
/** The equipment schedule: Letter landscape, 0.5 in margins; the table header repeats on each page. */
export const RACK_LANDSCAPE_CSS = `${BASE}@media print { @page { size: 11in 8.5in; margin: 0.5in; } ${PRINT_RESET} }`;
/** The power/heat summary: Letter portrait, 0.6 in margins. */
export const RACK_PORTRAIT_CSS = `${BASE}@media print { @page { size: 8.5in 11in; margin: 0.6in; } ${PRINT_RESET} }`;
/** The staff preview: all three sheets, each on its own named page so mixed orientations print correctly. */
export const RACK_PREVIEW_CSS = `${BASE}@media screen { .rk-set { zoom: 0.85; } }
@media print {
  @page rk-elevation { size: 11in 8.5in; margin: 0; }
  @page rk-landscape { size: 11in 8.5in; margin: 0.5in; }
  @page rk-portrait { size: 8.5in 11in; margin: 0.6in; }
  ${PRINT_RESET}
  .rk-sheet[data-sheet="elevation"] { page: rk-elevation; }
  .rk-sheet[data-sheet="schedule"] { page: rk-landscape; }
  .rk-sheet[data-sheet="power"] { page: rk-portrait; }
  .rk-set > .rk-sheet { break-after: page; page-break-after: always; }
  .rk-set > .rk-sheet:last-child { break-after: auto; page-break-after: auto; }
}`;

/** The print route's CSS for one sheet. */
export function rackSheetCss(kind: RackSheetKind): string {
  return kind === "schedule" ? RACK_LANDSCAPE_CSS : kind === "power" ? RACK_PORTRAIT_CSS : RACK_ELEVATION_CSS;
}
