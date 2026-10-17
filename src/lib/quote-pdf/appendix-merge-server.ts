import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { appendPdfPages, EncryptedPdfError } from "@/lib/part-docs/datasheet-book-server";
import { ESTIMATE_PDF_TARGET_MAX_BYTES, imagePagePlacement, type DrawingSkip, type DrawingSkipReason } from "./appendix-plan";

/**
 * Spec 2026-10-16 §4–5 — Chrome's estimate pages, then each drawing in list
 * order (a PDF's pages at their own size; a PNG / JPEG — WebP converted to
 * PNG — on one letter page of its orientation), then the datasheet links
 * page (`tail`), saved once. Never throws: an estimate pdf-lib can't read is
 * returned untouched (`merged: false`); a drawing that can't be used is
 * skipped and reported; `deadline` (epoch ms on `now`) skips the rest as late.
 * The datasheet book's load / copy / page-box rule (#329, appendPdfPages).
 *
 * Amendment A1 (Jeff, Oct 16): the saved file stays ≤ `maxBytes` (14 MB). The
 * caller already leaves out what doesn't fit by stored size; a file still over
 * after save() (a WebP grown into a PNG, pdf-lib's own overhead) drops
 * drawings from the END and is merged again — at most MERGE_SHRINK_TRIES
 * times, then the estimate + links page alone. Dropped drawings are
 * `over-total`. Server-only.
 */

export type DrawingInput = { name: string; contentType: string; bytes: Uint8Array | null; skip?: DrawingSkipReason };

/** Re-merges allowed after a file comes out over the ceiling, before falling back to the estimate + links only. */
export const MERGE_SHRINK_TRIES = 3;

const tick = () => new Promise<void>((r) => setImmediate(r));

type Built = { bytes: Buffer; skipped: DrawingSkip[]; tailAdded: boolean; included: number[] };

/** One merge, leaving out the drawings in `drop` (as over-total). Null when the estimate can't be read or the file can't be saved. */
async function mergeOnce(
  i: { main: Uint8Array; drawings: readonly DrawingInput[]; tail: Uint8Array | null; deadline?: number },
  drop: ReadonlySet<number>,
  now: () => number
): Promise<Built | null> {
  let out: PDFDocument;
  try {
    out = await PDFDocument.load(i.main, { updateMetadata: false });
  } catch (e) {
    console.warn("[quote-pdf] estimate PDF not mergeable — drawings left out", e instanceof Error ? e.message : e);
    return null;
  }
  const skipped: DrawingSkip[] = [];
  const included: number[] = [];
  for (const [n, d] of i.drawings.entries()) {
    if (d.skip) {
      skipped.push({ name: d.name, reason: d.skip });
      continue;
    }
    if (drop.has(n)) {
      skipped.push({ name: d.name, reason: "over-total" });
      continue;
    }
    if (i.deadline !== undefined && now() >= i.deadline) {
      skipped.push({ name: d.name, reason: "late" });
      continue;
    }
    if (!d.bytes || !d.bytes.byteLength) {
      skipped.push({ name: d.name, reason: "unreadable" });
      continue;
    }
    try {
      if (d.contentType === "application/pdf") {
        await appendPdfPages(out, d.bytes);
      } else {
        const img =
          d.contentType === "image/jpeg"
            ? await out.embedJpg(d.bytes)
            : await out.embedPng(d.contentType === "image/webp" ? await sharp(d.bytes).png().toBuffer() : d.bytes);
        const at = imagePagePlacement(img.width, img.height);
        if (!at) throw new Error("image has no size");
        out.addPage([at.pageW, at.pageH]).drawImage(img, { x: at.x, y: at.y, width: at.w, height: at.h });
      }
      included.push(n);
    } catch (e) {
      if (e instanceof EncryptedPdfError) skipped.push({ name: d.name, reason: "encrypted" });
      else {
        console.warn(`[quote-pdf] drawing "${d.name}" not merged: ${e instanceof Error ? e.message : String(e)}`);
        skipped.push({ name: d.name, reason: "unreadable" });
      }
    }
    await tick(); // let other I/O through between drawings
  }
  let tailAdded = false;
  if (i.tail) {
    try {
      const src = await PDFDocument.load(i.tail, { updateMetadata: false });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
      tailAdded = pages.length > 0;
    } catch (e) {
      console.warn("[quote-pdf] datasheet links page not merged", e instanceof Error ? e.message : e);
    }
  }
  try {
    return { bytes: Buffer.from(await out.save()), skipped, tailAdded, included };
  } catch (e) {
    console.warn("[quote-pdf] merged PDF not saved — drawings left out", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function mergeEstimateAppendices(i: {
  main: Uint8Array;
  drawings: readonly DrawingInput[];
  tail: Uint8Array | null;
  deadline?: number;
  now?: () => number;
  /** The saved file's ceiling (default ESTIMATE_PDF_TARGET_MAX_BYTES); a seam for the harness. */
  maxBytes?: number;
}): Promise<{ bytes: Buffer; skipped: DrawingSkip[]; tailAdded: boolean; merged: boolean }> {
  const now = i.now ?? Date.now;
  const max = i.maxBytes ?? ESTIMATE_PDF_TARGET_MAX_BYTES;
  const untouched = () => ({ bytes: Buffer.from(i.main), skipped: i.drawings.map((d) => ({ name: d.name, reason: d.skip ?? ("unreadable" as const) })), tailAdded: false, merged: false });
  try {
    const drop = new Set<number>();
    let r = await mergeOnce(i, drop, now);
    if (!r) return untouched();
    // A1: over the ceiling → drop drawings from the end, enough of their bytes to cover the overshoot (at least one), and merge again.
    for (let t = 0; t < MERGE_SHRINK_TRIES && r.bytes.length > max && r.included.length; t++) {
      const over = r.bytes.length - max;
      let freed = 0;
      for (let k = r.included.length - 1; k >= 0 && freed < over; k--) {
        drop.add(r.included[k]);
        freed += i.drawings[r.included[k]].bytes?.byteLength ?? 0;
      }
      const next = await mergeOnce(i, drop, now);
      if (!next) break;
      r = next;
    }
    if (r.bytes.length > max && r.included.length) {
      // Still too big after the tries: the estimate + links page alone.
      for (const n of r.included) drop.add(n);
      r = (await mergeOnce(i, drop, now)) ?? r;
    }
    return { bytes: r.bytes, skipped: r.skipped, tailAdded: r.tailAdded, merged: true };
  } catch (e) {
    console.warn("[quote-pdf] drawings not merged", e instanceof Error ? e.message : e);
    return untouched();
  }
}
