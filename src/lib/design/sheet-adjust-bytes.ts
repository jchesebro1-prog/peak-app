// SERVER ONLY — pdf-lib + sharp (native). Never import from a "use client" file.
/**
 * #318 — the byte half of Adjust sheet: a root sheet's file in, the adjusted
 * file out. PDFs keep their vector content (pdf-lib sets each adjusted page's
 * /CropBox and /Rotate; untouched pages keep their boxes). Images (page 1
 * only) are EXIF-oriented, turned, cropped and re-encoded by sharp in their
 * own format (GIF → PNG). Pure in, bytes out — no storage, no store.
 */
import { degrees, PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { sniffImageType } from "@/lib/part-docs/files";
import { SHRINK_MAX_INPUT_PIXELS } from "@/lib/part-docs/shrink";
import { cropToPdfBox, cropToPixels, effectiveBox, pageAdjustOf, type AdjustPages } from "./sheet-adjust";

export type SheetKind = "pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export type AdjustBytesResult = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: "unsupported" | "encrypted" | "too-many-pixels" | "unreadable" };

/** What a sheet's bytes really are (the stored mime is not trusted for this). */
export function sheetKindOf(bytes: Uint8Array): SheetKind | null {
  const img = sniffImageType(bytes);
  if (img) return img;
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  const head = Array.from(bytes.subarray(0, 1024), (b) => String.fromCharCode(b)).join("");
  return head.includes("%PDF-") ? "pdf" : null;
}

export async function adjustSheetBytes(bytes: Uint8Array, pages: AdjustPages): Promise<AdjustBytesResult> {
  const kind = sheetKindOf(bytes);
  if (!kind) return { ok: false, reason: "unsupported" };
  return kind === "pdf" ? adjustPdf(bytes, pages) : adjustImage(bytes, kind, pages);
}

async function adjustPdf(bytes: Uint8Array, pages: AdjustPages): Promise<AdjustBytesResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    // pdf-lib 1.17 builds its errors with tslib's ES5 __extends(Error), so `e.name` is
    // just "Error" — the class name never shows; its message is the only tell.
    return { ok: false, reason: /encrypted/i.test(String((e as { message?: unknown } | null)?.message)) ? "encrypted" : "unreadable" };
  }
  try {
    const list = doc.getPages();
    for (const key of Object.keys(pages)) {
      const page = list[Number(key) - 1];
      if (!page) continue; // the file has no such page — nothing to adjust
      const m = page.getMediaBox();
      const c = page.getCropBox();
      const view = effectiveBox([m.x, m.y, m.x + m.width, m.y + m.height], [c.x, c.y, c.x + c.width, c.y + c.height]);
      const { box, rotate } = cropToPdfBox(view, page.getRotation().angle, pages[key]);
      page.setCropBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      page.setRotation(degrees(rotate));
    }
    return { ok: true, bytes: await doc.save(), mime: "application/pdf" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

async function adjustImage(bytes: Uint8Array, kind: Exclude<SheetKind, "pdf">, pages: AdjustPages): Promise<AdjustBytesResult> {
  const a = pageAdjustOf(pages, 1);
  try {
    const meta = await sharp(bytes, { failOn: "error", limitInputPixels: SHRINK_MAX_INPUT_PIXELS }).metadata();
    const w = meta.autoOrient?.width ?? meta.width;
    const h = meta.autoOrient?.height ?? meta.height;
    if (!w || !h) return { ok: false, reason: "unreadable" };
    let img = sharp(bytes, { failOn: "error", limitInputPixels: SHRINK_MAX_INPUT_PIXELS, autoOrient: true });
    if (a.rotate) img = img.rotate(a.rotate);
    img = img.extract(cropToPixels(w, h, a));
    if (kind === "image/jpeg") return { ok: true, bytes: await img.jpeg({ quality: 92 }).toBuffer(), mime: "image/jpeg" };
    if (kind === "image/webp") return { ok: true, bytes: await img.webp({ quality: 90 }).toBuffer(), mime: "image/webp" };
    return { ok: true, bytes: await img.png().toBuffer(), mime: "image/png" };
  } catch (e) {
    // sharp refuses an over-limit image with "Input image exceeds pixel limit" —
    // its own reason: "too-big" is the no-Blob storage cap, a different fix.
    return { ok: false, reason: /pixel limit/i.test(String((e as { message?: unknown } | null)?.message)) ? "too-many-pixels" : "unreadable" };
  }
}
