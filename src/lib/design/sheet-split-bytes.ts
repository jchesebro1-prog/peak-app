// SERVER ONLY — pdf-lib. Never import from a "use client" file.
/**
 * #319 — a multi-page PDF in, one single-page PDF per page out, in page order.
 * `copyPages` carries each page's own AND inherited /MediaBox, /CropBox,
 * /Rotate and /Resources onto the copied page (pdf-lib's copier), so every
 * one-page file displays exactly as that page did — checked against pdf.js
 * in the spec harness. Pure in, bytes out — no storage, no store.
 */
import { PDFDocument } from "pdf-lib";
import { sheetKindOf } from "./sheet-adjust-bytes";
import { GRID_SHEET_SPLIT_MAX_PAGES, GRID_SHEET_SPLIT_MAX_TOTAL_BYTES } from "./grid-sheet-split";

export type SplitPdfResult =
  | { ok: true; pages: Uint8Array[] }
  | { ok: false; reason: "not-pdf" | "single" | "too-many-pages" | "encrypted" | "unreadable" | "too-big"; pageCount?: number };

export async function splitPdfPages(bytes: Uint8Array, opts: { maxPages?: number; maxTotalBytes?: number } = {}): Promise<SplitPdfResult> {
  const maxPages = opts.maxPages ?? GRID_SHEET_SPLIT_MAX_PAGES;
  const maxTotal = opts.maxTotalBytes ?? GRID_SHEET_SPLIT_MAX_TOTAL_BYTES;
  if (sheetKindOf(bytes) !== "pdf") return { ok: false, reason: "not-pdf" };
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    // pdf-lib 1.17's errors are ES5-subclassed: `e.name` is always "Error"; the message is the only tell.
    return { ok: false, reason: /encrypted/i.test(String((e as { message?: unknown } | null)?.message)) ? "encrypted" : "unreadable" };
  }
  let count: number;
  try {
    count = src.getPageCount();
  } catch {
    // pdf-lib's loader is lenient: a file with no page tree loads, then throws on first use.
    return { ok: false, reason: "unreadable" };
  }
  if (count <= 1) return { ok: false, reason: "single", pageCount: count };
  if (count > maxPages) return { ok: false, reason: "too-many-pages", pageCount: count };
  try {
    const pages: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const out = await PDFDocument.create({ updateMetadata: false });
      const [page] = await out.copyPages(src, [i]);
      out.addPage(page);
      const one = await out.save();
      total += one.byteLength;
      if (total > maxTotal) return { ok: false, reason: "too-big", pageCount: count };
      pages.push(one);
    }
    return { ok: true, pages };
  } catch {
    return { ok: false, reason: "unreadable", pageCount: count };
  }
}
