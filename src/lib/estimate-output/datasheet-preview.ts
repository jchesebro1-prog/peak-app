import type { ClientRowView } from "./client-package-ui";

/**
 * #379 (Jeff 2026-11-24) — Build package → Datasheets: what the live preview
 * shows for the current ticks. Pure and client-safe.
 */

export const DATASHEETS_TAB_COPY = {
  settings: "Datasheets to send",
  settingsHint: "Tick a product to send its datasheet. The preview on the right follows every tick.",
  showPages: "Show each datasheet's pages in the preview",
  live: "Live",
  liveNote: "shows unsaved choices. The downloaded PDF is built from the saved estimate.",
  saveFirst: "Save first — the PDF prints the saved estimate.",
  saveToCreate: "Save to create the PDF.",
  cover: "Cover",
  coverTitle: "Datasheet package",
  untitled: "Untitled project",
  coverCount: (n: number) => `${n} ${n === 1 ? "datasheet" : "datasheets"}, A to Z by manufacturer`,
  index: "Index",
  nothing: "No datasheets are going to the client yet.",
  missing: (n: number) => `${n} ${n === 1 ? "product has" : "products have"} no datasheet on file:`,
  open: "Open ↗",
} as const;

/** One datasheet in the package, as the preview lists and embeds it. */
export type DatasheetPreviewSheet = { sku: string; mfr: string; model: string; label: string; href: string; name: string; anchor: string; image: boolean };
export type DatasheetPreviewMissing = { sku: string; model: string };
export type DatasheetPreview = { sheets: DatasheetPreviewSheet[]; missing: DatasheetPreviewMissing[] };

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|svg)$/i;
const fold = (s: string) => s.trim().toLowerCase();

/** A DOM id for a sheet's section — letters, digits and dashes only. */
export function datasheetAnchor(sku: string): string {
  return "ds-" + sku.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The package for the current ticks: every ticked product with its own
 * datasheet file, A→Z by manufacturer then model (the downloaded book's
 * order), one entry per file; and the ticked products with no datasheet on
 * file (they go to the client with nothing to show — the gaps). A product
 * covered by a fixture's datasheet, one that needs none and one left out add
 * nothing.
 */
export function datasheetPreview(views: readonly ClientRowView[]): DatasheetPreview {
  const sheets: DatasheetPreviewSheet[] = [];
  const seen = new Set<string>();
  const missing: DatasheetPreviewMissing[] = [];
  for (const v of views) {
    if (!v.checked) continue;
    if (v.status.kind === "link") {
      if (seen.has(v.status.href)) continue;
      seen.add(v.status.href);
      sheets.push({ sku: v.row.sku, mfr: v.row.mfr, model: v.row.model, label: v.row.label, href: v.status.href, name: v.status.name, anchor: datasheetAnchor(v.row.sku), image: IMAGE_NAME.test(v.status.name) });
    } else if (v.row.state === "missing") missing.push({ sku: v.row.sku, model: v.row.model });
  }
  sheets.sort((a, b) => fold(a.mfr).localeCompare(fold(b.mfr)) || fold(a.model || a.sku).localeCompare(fold(b.model || b.sku)));
  return { sheets, missing };
}
